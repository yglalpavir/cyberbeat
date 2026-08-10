// ==================== osu!mania .osu 谱面解析器 ====================

class OsuParser {
    /**
     * @param {string} text - .osu 文件内容（纯文本）
     */
    constructor(text) {
        this.text = text || '';
        this.sections = {};
        this.bpmTimeline = [];   // [{ time, bpm }] — 红线（uninherited）计时点
        this.notes = [];
        this.meta = {};
    }

    /**
     * 解析 .osu 谱面数据（仅支持 osu!mania 4K）
     * @returns {{ notes: Array, meta: Object }} 音符数组和元数据
     * @throws {Error} 如果不是 mania 模式或 column ≠ 4
     */
    parse() {
        this._splitSections();

        const general = this.sections['General'] || {};
        const metadata = this.sections['Metadata'] || {};
        const difficulty = this.sections['Difficulty'] || {};

        // 1. 校验模式（osu!mania = Mode 3）
        const modeRaw = general.Mode;
        const mode = modeRaw !== undefined ? parseInt(modeRaw) : NaN;
        if (mode !== 3) {
            throw new Error(
                `Unsupported osu! game mode: ${Number.isNaN(mode) ? 'unknown' : mode}. ` +
                `CyberBeat only supports osu!mania (Mode 3) beatmaps.`
            );
        }

        // 2. 校验键数（CircleSize = 键数）
        const column = parseInt(difficulty.CircleSize);
        if (column !== 4) {
            throw new Error(
                `Unsupported key count: ${Number.isNaN(column) ? 'unknown' : column}. ` +
                `CyberBeat only supports 4K (CircleSize=4) beatmaps.`
            );
        }

        // 3. 提取元数据
        this.meta = {
            title: metadata.Title || 'Unknown',
            artist: metadata.Artist || 'Unknown Artist',
            version: metadata.Version || '',
            creator: metadata.Creator || '',
            column: column,
            mode: 3,
            audioOffset: 0,          // 谱面时间均为音频起点绝对毫秒，无需额外偏移
            audioFile: general.AudioFilename || null,
            previewTime: general.PreviewTime !== undefined ? parseInt(general.PreviewTime) : null
        };

        // 4. 构建 BPM 时间线（仅红线）
        this._buildBpmTimeline();

        // 5. 解析音符
        this._parseHitObjects();

        // 6. 计算总时长
        this.meta.bpm = this._computeAverageBpm();
        this.meta.duration = this._computeDuration();

        return {
            notes: this.notes,
            meta: this.meta
        };
    }

    // ========== 文本分段 ==========

    /**
     * 将 .osu 文本拆分为 section 键值对 / 行数组
     * 示例: "[General]\nMode: 3" → sections['General'] = { Mode: '3' }
     *        "[HitObjects]\n64,192,694,1,0" → sections['HitObjects'] = ['64,192,694,1,0']
     */
    _splitSections() {
        this.sections = {};
        let current = null;

        // 这些 section 是"每行一条记录"的列表，其余是 key: value 形式
        const listSections = new Set(['TimingPoints', 'HitObjects', 'Events', 'Colours', 'Bookmarks']);

        const lines = this.text.split(/\r?\n/);
        for (const raw of lines) {
            const line = raw.trim();
            if (!line || line.startsWith('//')) continue;

            const headerMatch = line.match(/^\[(.+)\]$/);
            if (headerMatch) {
                current = headerMatch[1];
                this.sections[current] = listSections.has(current) ? [] : {};
                continue;
            }
            if (!current) continue;

            if (Array.isArray(this.sections[current])) {
                this.sections[current].push(line);
            } else {
                const sepIdx = line.indexOf(':');
                if (sepIdx === -1) continue;
                const key = line.slice(0, sepIdx).trim();
                const value = line.slice(sepIdx + 1).trim();
                this.sections[current][key] = value;
            }
        }
    }

    // ========== BPM 时间线构建 ==========

    /**
     * 从 [TimingPoints] 提取红线（beatLength > 0，uninherited）计时点
     * 行格式: time,beatLength,meter,sampleSet,sampleIndex,volume,uninherited,effects
     * BPM = 60000 / beatLength
     */
    _buildBpmTimeline() {
        const lines = this.sections['TimingPoints'] || [];
        this.bpmTimeline = [];

        for (const line of lines) {
            const parts = line.split(',');
            if (parts.length < 2) continue;

            const time = parseInt(parts[0]);
            const beatLength = parseFloat(parts[1]);
            if (!isFinite(time) || !isFinite(beatLength) || beatLength <= 0) continue;

            this.bpmTimeline.push({
                time: time,
                bpm: 60000 / beatLength
            });
        }

        this.bpmTimeline.sort((a, b) => a.time - b.time);

        // 确保第一个 BPM 点起始于 0
        if (this.bpmTimeline.length > 0 && this.bpmTimeline[0].time > 0) {
            this.bpmTimeline.unshift({
                time: 0,
                bpm: this.bpmTimeline[0].bpm
            });
        }
    }

    // ========== 音符解析 ==========

    /**
     * 解析 [HitObjects]
     * 行格式: x,y,time,type,hitSound[,endTime:hitSample]
     * - type 含 bit0(1) → tap；含 bit7(128) → hold
     * - 列 = floor(x * keyCount / 512)，截断并限制在 [0, keyCount-1]
     * - hold 的 endTime 在第 6 段（冒号前取整）
     */
    _parseHitObjects() {
        const lines = this.sections['HitObjects'] || [];
        const keyCount = this.meta.column;

        for (const line of lines) {
            const parts = line.split(',');
            if (parts.length < 5) continue;

            const x = parseInt(parts[0]);
            const time = parseInt(parts[2]);
            const type = parseInt(parts[3]);
            if (!isFinite(time) || !isFinite(type) || time < 0) continue;

            const column = Math.max(0, Math.min(Math.floor(x * keyCount / 512), keyCount - 1));

            const isHold = (type & 128) !== 0;
            let endMs = null;

            if (isHold && parts.length >= 6) {
                const endText = parts[5].split(':')[0];
                const end = parseInt(endText);
                if (isFinite(end)) {
                    endMs = Math.max(end, time + 1);
                }
            }

            this.notes.push({
                track: column,
                time: time,
                y: -50,
                hit: false,
                type: isHold && endMs !== null ? 'hold' : 'tap',
                endTime: endMs,           // Hold 结束时间（ms），tap 为 null
                holdActive: false,        // 长条是否正在被按住
                holdReleased: false       // 长条是否已被提前松开
            });
        }

        // 按时间排序
        this.notes.sort((a, b) => a.time - b.time);
    }

    // ========== 元数据计算 ==========

    _computeAverageBpm() {
        if (this.bpmTimeline.length === 0) return 120;
        const sum = this.bpmTimeline.reduce((acc, t) => acc + t.bpm, 0);
        return Math.round(sum / this.bpmTimeline.length);
    }

    _computeDuration() {
        if (this.notes.length === 0) return 0;
        let maxMs = 0;
        for (const note of this.notes) {
            const endMs = note.endTime || note.time;
            if (endMs > maxMs) maxMs = endMs;
        }
        return Math.ceil((maxMs + 2000) / 1000);
    }
}
