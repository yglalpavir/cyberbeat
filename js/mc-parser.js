// ==================== Malody .mc 谱面解析器 ====================

class McParser {
    /**
     * @param {Object} jsonData - .mc 文件解析后的 JSON 对象
     */
    constructor(jsonData) {
        this.data = jsonData;
        this.bpmTimeline = [];   // [{ beatPos, bpm }]  — beatPos 是节拍位置（直接是拍数）
        this.notes = [];
        this.meta = {};
    }

    /**
     * 解析 .mc 谱面数据
     * @returns {{ notes: Array, meta: Object }} 音符数组和元数据
     * @throws {Error} 如果 column ≠ 4 或数据无效
     */
    parse() {
        // 1. 校验 column
        const column = this.data?.meta?.mode_ext?.column;
        if (column !== 4) {
            throw new Error(
                `Unsupported column count: ${column}. ` +
                `CyberBeat only supports 4K (column=4) beatmaps.`
            );
        }

        // 2. 提取元数据
        this.meta = {
            title: this.data.meta?.song?.title || 'Unknown',
            artist: this.data.meta?.song?.artist || 'Unknown Artist',
            version: this.data.meta?.version || '',
            creator: this.data.meta?.creator || '',
            column: column,
            mode: this.data.meta?.mode ?? 0,
            audioOffset: 0  // 默认无偏移
        };

        // 3. 提取音频偏移（sound 类型音符中的 offset）
        this._extractAudioOffset();

        // 4. 构建 BPM 时间线
        this._buildBpmTimeline();

        // 5. 解析音符
        this._parseNotes();

        // 6. 计算总时长
        this.meta.bpm = this._computeAverageBpm();
        this.meta.duration = this._computeDuration();

        return {
            notes: this.notes,
            meta: this.meta
        };
    }

    /**
     * 从 note[] 中提取 sound 类型音符的 offset 值
     * offset 表示音频应延迟多少毫秒播放
     */
    _extractAudioOffset() {
        const rawNotes = this.data.note || [];
        for (const raw of rawNotes) {
            if (raw.type === 1 && raw.offset !== undefined) {
                this.meta.audioOffset = raw.offset;
                console.log('MC audio offset:', raw.offset + 'ms');
                return;
            }
        }
    }

    // ========== BPM 时间线构建 ==========

    /**
     * 从 time[] 数组构建 BPM 时间线
     * time 条目格式: { beat: [整数拍, 分子, 分母], bpm: number }
     * beat 直接表示"拍数"（非小节数）：a + b/c 拍
     */
    _buildBpmTimeline() {
        const timeEntries = this.data.time || [];

        if (timeEntries.length === 0) {
            this.bpmTimeline = [{ beatPos: 0, bpm: 120 }];
            return;
        }

        // beatPos = a + b/c，直接就是拍数
        this.bpmTimeline = timeEntries.map(entry => ({
            beatPos: this._beatToBeats(entry.beat),
            bpm: entry.bpm
        }));

        // 按位置排序
        this.bpmTimeline.sort((a, b) => a.beatPos - b.beatPos);

        // 确保第一个 BPM 点起始于 0
        if (this.bpmTimeline.length > 0 && this.bpmTimeline[0].beatPos > 0) {
            this.bpmTimeline.unshift({
                beatPos: 0,
                bpm: this.bpmTimeline[0].bpm
            });
        }
    }

    // ========== 音符解析 ==========

    /**
     * 解析 note[] 数组，过滤 sound 类型，转换时间为毫秒
     */
    _parseNotes() {
        const rawNotes = this.data.note || [];

        for (const raw of rawNotes) {
            // 过滤 sound 类型音符 (type === 1)
            if (raw.type === 1) continue;

            const column = raw.column;
            if (column === undefined || column < 0 || column > 3) continue;

            const startMs = this._beatToMs(raw.beat);

            // 判断是否有 endbeat（Hold 长条音符）
            let endMs = null;
            if (raw.endbeat) {
                endMs = this._beatToMs(raw.endbeat);
            }

            this.notes.push({
                track: column,
                time: startMs,
                y: -50,
                hit: false,
                type: raw.endbeat ? 'hold' : 'tap',
                endTime: endMs,           // Hold 结束时间（ms）
                holdActive: false,        // 长条是否正在被按住
                holdReleased: false       // 长条是否已被提前松开
            });
        }

        // 按时间排序
        this.notes.sort((a, b) => a.time - b.time);
    }

    // ========== Beat 转换 ==========

    /**
     * 将 beat 三元组 [a, b, c] 转换为拍数
     * Malody beat 格式：a + b/c 拍（直接是拍数，非小节数）
     */
    _beatToBeats(beat) {
        if (!beat || beat.length < 3) return 0;
        return beat[0] + beat[1] / beat[2];
    }

    /**
     * 将 beat 三元组转换为毫秒（相对于歌曲开头）
     * 
     * 算法：
     * 1. beat [a, b, c] = a + b/c 拍
     * 2. 遍历 BPM 时间线，逐段累加：时间 = 拍数 × 60 / BPM
     * 
     * @param {Array} beat - [a, b, c] 拍位置
     * @returns {number} 毫秒数
     */
    _beatToMs(beat) {
        if (!beat || beat.length < 3) return 0;

        const targetBeats = this._beatToBeats(beat);

        let accumulatedMs = 0;
        let prevBeatPos = 0;
        let currentBpm = this.bpmTimeline[0]?.bpm || 120;

        for (let i = 0; i < this.bpmTimeline.length; i++) {
            const changeBeatPos = this.bpmTimeline[i].beatPos;

            if (changeBeatPos >= targetBeats) {
                // 这个 BPM 变化点在目标之后，用当前 BPM 算完剩下的
                break;
            }

            if (changeBeatPos > prevBeatPos) {
                const segmentBeats = changeBeatPos - prevBeatPos;
                accumulatedMs += (segmentBeats * 60 / currentBpm) * 1000;
                prevBeatPos = changeBeatPos;
            }

            currentBpm = this.bpmTimeline[i].bpm;
        }

        // 最后一段
        if (targetBeats > prevBeatPos) {
            const remainingBeats = targetBeats - prevBeatPos;
            accumulatedMs += (remainingBeats * 60 / currentBpm) * 1000;
        }

        return Math.round(accumulatedMs);
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
