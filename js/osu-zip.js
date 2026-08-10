// ==================== .osz (ZIP) 最小读取器 ====================
// 零依赖实现：仅支持 STORED(0) 和 DEFLATE(8) 方法
// 解压用浏览器原生 DecompressionStream('deflate-raw')（Chrome 103+ / Firefox 113+ / Safari 16.4+）

class OsZipReader {
    /**
     * @param {ArrayBuffer} arrayBuffer - .osz 文件二进制
     */
    constructor(arrayBuffer) {
        this.buffer = new DataView(arrayBuffer);
        this.bytes = new Uint8Array(arrayBuffer);
        this.entries = [];
        this._parse();
    }

    // ========== ZIP 结构解析 ==========

    /**
     * 查找 End of Central Directory 记录（从文件末尾向前搜索）
     */
    _findEocd() {
        const view = this.buffer;
        const maxBack = Math.min(view.byteLength, 65557);
        const start = view.byteLength - maxBack;
        for (let i = view.byteLength - 22; i >= start; i--) {
            if (view.getUint32(i, true) === 0x06054b50) {
                return i;
            }
        }
        throw new Error('Not a valid .osz file (EOCD not found).');
    }

    _parse() {
        const view = this.buffer;
        const eocd = this._findEocd();

        const totalEntries = view.getUint16(eocd + 10, true);
        const cdOffset = view.getUint32(eocd + 16, true);

        let cursor = cdOffset;
        for (let i = 0; i < totalEntries; i++) {
            if (cursor + 46 > view.byteLength) break;
            if (view.getUint32(cursor, true) !== 0x02014b50) break;

            const method = view.getUint16(cursor + 10, true);
            const compSize = view.getUint32(cursor + 20, true);
            const uncompSize = view.getUint32(cursor + 24, true);
            const nameLen = view.getUint16(cursor + 28, true);
            const extraLen = view.getUint16(cursor + 30, true);
            const commentLen = view.getUint16(cursor + 32, true);
            const localOffset = view.getUint32(cursor + 42, true);

            const nameStart = cursor + 46;
            const nameBytes = this.bytes.subarray(nameStart, nameStart + nameLen);
            const name = this._decodeName(nameBytes);

            if (!name.endsWith('/') && !name.startsWith('__MACOSX/')) {
                this.entries.push({
                    name: name,
                    method: method,
                    compSize: compSize,
                    uncompSize: uncompSize,
                    localOffset: localOffset
                });
            }

            cursor = nameStart + nameLen + extraLen + commentLen;
        }
    }

    /**
     * ZIP 文件名编码：UTF-8（General Purpose Bit 11）或 CP437
     */
    _decodeName(bytes) {
        try {
            return new TextDecoder('utf-8').decode(bytes);
        } catch (e) {
            return new TextDecoder('iso-8859-1').decode(bytes);
        }
    }

    /**
     * 读取本地文件头，计算压缩数据在文件中的起点
     */
    _locateData(entry) {
        const view = this.buffer;
        const off = entry.localOffset;

        if (off + 30 > view.byteLength || view.getUint32(off, true) !== 0x04034b50) {
            throw new Error(`Corrupt .osz entry: ${entry.name}`);
        }

        const nameLen = view.getUint16(off + 26, true);
        const extraLen = view.getUint16(off + 28, true);
        return off + 30 + nameLen + extraLen;
    }

    // ========== 条目读取 ==========

    /**
     * 解压单个条目
     * @returns {Promise<Uint8Array>}
     */
    async readBytes(entry) {
        const dataStart = this._locateData(entry);
        const compressed = this.bytes.subarray(dataStart, dataStart + entry.compSize);

        if (entry.method === 0) {
            // STORED：直接复制
            return compressed;
        }

        if (entry.method === 8) {
            // DEFLATE：原始 deflate 流（ZIP 标准）
            if (typeof DecompressionStream === 'undefined') {
                throw new Error(
                    'This browser does not support DecompressionStream.\n' +
                    'Please use Chrome 103+, Firefox 113+ or Safari 16.4+, or extract the .osz manually.'
                );
            }
            const stream = new Blob([compressed]).stream().pipeThrough(
                new DecompressionStream('deflate-raw')
            );
            const arrayBuffer = await new Response(stream).arrayBuffer();
            return new Uint8Array(arrayBuffer);
        }

        throw new Error(`Unsupported compression method (${entry.method}) in .osz entry: ${entry.name}`);
    }

    /**
     * 读取条目为 UTF-8 文本
     * @returns {Promise<string>}
     */
    async readText(entry) {
        const bytes = await this.readBytes(entry);
        return new TextDecoder('utf-8').decode(bytes);
    }

    /**
     * 读取条目为 Blob（用于音频解码）
     * @returns {Promise<Blob>}
     */
    async readBlob(entry) {
        const bytes = await this.readBytes(entry);
        return new Blob([bytes]);
    }

    /**
     * 按文件名（不区分目录层次、不区分大小写）查找条目，支持正斜杠路径
     * @param {string} fileName - 如 "Ma-5.mp3" 或 "文件夹/音频.mp3"
     * @returns {Object|null}
     */
    findEntry(fileName) {
        if (!fileName) return null;
        const normalized = fileName.replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase();
        const baseName = normalized.split('/').pop();

        // 先精确匹配完整路径（忽略大小写）
        let entry = this.entries.find(e => e.name.toLowerCase() === normalized);
        if (entry) return entry;
        // 再按文件名匹配（忽略大小写）
        entry = this.entries.find(e => e.name.split('/').pop().toLowerCase() === baseName);
        return entry || null;
    }

    /**
     * 列出所有 .osu 谱面条目
     * @returns {Array<Object>}
     */
    listOsuEntries() {
        return this.entries.filter(e => /\.osu$/i.test(e.name));
    }

    /**
     * 列出所有 Malody .mc 谱面条目
     * @returns {Array<Object>}
     */
    listMcEntries() {
        return this.entries.filter(e => /\.mc$/i.test(e.name));
    }
}