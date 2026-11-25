class AudioEngine {
    constructor() {
        this.context = null;
        this.masterGain = null;
        this.musicGain = null;      // 音乐总线：file / midi / preset → musicGain → masterGain
        this.limiter = null;
        this.analyser = null;       // 画面律动的频谱取样点（masterGain 之后）
        this._visualizerData = null;
        this.visualizerGainComp = 1;
        this.isPlaying = false;
        this.nextNoteTime = 0;
        this.timerID = null;
        this.midiScheduleTimer = null;
        this.midiEvents = [];
        this.convolver = null;
        // 音频文件播放
        this.audioBuffer = null;
        this.audioSource = null;
        this._musicStartTime = 0;   // AudioContext 时间轴上的谱面零点（未应用玩家校准）
        this._fileOffsetSeconds = 0;
        this._transportVersion = 0;
        this._currentAudioUrl = null;
        // 解码结果缓存：按曲目 key 分槽（LRU），避免不同曲目互相串台
        this._audioCache = new Map();          // key → AudioBuffer（越靠后越新）
        this._audioCacheBytes = 0;
        this._audioCacheMaxItems = 6;
        this._audioCacheMaxBytes = 96 * 1024 * 1024;
        this._currentAudioKey = null;          // 当前 audioBuffer 对应的缓存 key
        this._activeAudioKey = null;           // 正在播放的 key（淘汰时跳过）
        this._lastCachedKey = null;            // 最近写入的 key（淘汰时优先保留）
        // 暂停支持
        this._paused = false;
        this._mode = null;          // 'midi' | 'preset' | 'file'
        // 打击音效：预渲染的短促机械点击；每次只需一个 BufferSource + 一个 Gain
        this._hitBuffers = new Map();   // type → AudioBuffer（按配置懒生成）
        this._hitBufferConfigKey = null; // 只对采样参数签名，支持无配置文件的 fallback
        this._hitVoices = 0;

    }
    
    init() {
        if (this.context) return;
        this.context = new (window.AudioContext || window.webkitAudioContext)();
        
        // 从 AUDIO_CONFIG 读取 limiter 配置
        const limiterCfg = getLimiterConfig();
        
        // 创建 limiter（DynamicsCompressorNode 配置成限制器模式）
        if (limiterCfg.enabled) {
            this.limiter = this.context.createDynamicsCompressor();
            this.limiter.threshold.value = limiterCfg.threshold;
            this.limiter.knee.value = limiterCfg.knee;
            this.limiter.ratio.value = limiterCfg.ratio;
            this.limiter.attack.value = limiterCfg.attack;
            this.limiter.release.value = limiterCfg.release;
        }
        
        this.masterGain = this.context.createGain();
        // 音量映射：0-10 → 0-1
        const vol = (typeof currentVolume !== 'undefined') ? currentVolume : CONFIG.defaultVolume;
        this.masterGain.gain.value = vol / 10;

        // 频谱只读支路：analyser 是直通节点，不改变声音。
        // 放在 masterGain 之后可同时响应伴奏与打击音，暂停时 AudioContext 挂起，数据随之冻结。
        if (typeof this.context.createAnalyser === 'function') {
            try {
                this.analyser = this.context.createAnalyser();
                this.analyser.fftSize = 512;
                this.analyser.smoothingTimeConstant = 0.3;
                this._visualizerData = new Uint8Array(this.analyser.frequencyBinCount);
            } catch (err) {
                this.analyser = null;
                this._visualizerData = null;
            }
        }

        // 取样支路不接扬声器，保留原来的播放信号链。
        if (this.analyser) this.masterGain.connect(this.analyser);
        this.masterGain.connect(this.limiter || this.context.destination);
        if (this.limiter) this.limiter.connect(this.context.destination);
    }

    /**
     * 读取一帧频谱供 Canvas 律动使用。
     * 返回 AudioEngine 复用的 Uint8Array；没有 analyser 或音频未运行时返回 null。
     */
    getVisualizerData() {
        if (!this.analyser || !this._visualizerData) return null;
        if (!this.context || this.context.state !== 'running') return null;
        try {
            this.analyser.getByteFrequencyData(this._visualizerData);
        } catch (err) {
            return null;
        }
        const gain = this.masterGain ? this.masterGain.gain.value : 1;
        // 低音量时适度补偿，避免频谱随音量变小；上限防止底噪被过度放大
        this.visualizerGainComp = Math.min(2, 1 / Math.max(0.5, gain));
        return this._visualizerData;
    }

    unlock() {
        this.init();
        if (!this._paused) {
            this.context.resume().catch(() => { /* 等待下一次用户手势 */ });
        }
    }

    _startMusic(mode, delaySeconds) {
        this.init();
        this._transportVersion++;
        this._silenceMusic();
        this.isPlaying = true;
        this._paused = false;
        this._mode = mode;
        this._activeAudioKey = mode === 'file' ? this._currentAudioKey : null;
        this._musicStartTime = this.context.currentTime + delaySeconds;
        this._connectMusicBus();
        this.unlock();
    }

    _connectMusicBus() {
        // 新总线隔离上一首或跳转前已排程的合成音符。
        this.musicGain = this.context.createGain();
        this.musicGain.connect(this.masterGain);
    }

    /** 谱面与伴奏共用的时钟（ms）；开场倒计时期间为负数。 */
    musicTimeMs() {
        return this.isPlaying ? (this.context.currentTime - this._musicStartTime) * 1000 : 0;
    }
    
    createReverbImpulse(duration, decay, reverse) {
        const sampleRate = this.context.sampleRate;
        const length = sampleRate * duration;
        const impulse = this.context.createBuffer(2, length, sampleRate);
        for (let channel = 0; channel < 2; channel++) {
            const channelData = impulse.getChannelData(channel);
            for (let i = 0; i < length; i++) {
                const n = reverse ? length - i : i;
                channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - n / length, decay);
            }
        }
        return impulse;
    }
    
    playNote(freq, duration, type = 'square', time = 0) {
        if (!this.context) return;
        const presetCfg = getPresetMusicConfig();
        const osc = this.context.createOscillator();
        const gain = this.context.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(presetCfg.noteGain, this.context.currentTime + time);
        gain.gain.exponentialRampToValueAtTime(0.01, this.context.currentTime + time + duration);
        osc.connect(gain);
        gain.connect(this.musicGain || this.masterGain);
        osc.start(this.context.currentTime + time);
        osc.stop(this.context.currentTime + time + duration);
    }
    
    playMidiNote(noteNumber, duration, velocity, when) {
        if (!this.context) return;
        const midiCfg = getMidiConfig();
        const freq = 440 * Math.pow(2, (noteNumber - 69) / 12);
        const type = noteNumber < midiCfg.lowNoteThreshold ? midiCfg.lowNoteType : midiCfg.highNoteType;
        const osc = this.context.createOscillator();
        const gain = this.context.createGain();
        const vol = (velocity / midiCfg.maxVelocity) * midiCfg.velocityGain;
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, when);
        gain.gain.linearRampToValueAtTime(vol, when + midiCfg.noteOnRampTime);
        gain.gain.setValueAtTime(vol, when + duration);
        gain.gain.exponentialRampToValueAtTime(0.01, when + duration + midiCfg.noteOffRampTime);
        osc.connect(gain);
        gain.connect(this.musicGain || this.masterGain);
        osc.start(when);
        osc.stop(when + duration + midiCfg.noteStopPadding);
    }
    
    /**
     * 打击音效：立即在 AudioContext 当前时间播放一段预渲染的机械点击。
     * 只接 masterGain（共享玩家音量与 limiter），不触碰音乐总线与谱面时钟。
     * @param {'perfect'|'great'|'miss'|'holdEnd'} type
     */
    playHitSound(type) {
        if (!this.context || !this.masterGain || this.context.state !== 'running') return;
        const hitCfg = getHitSoundConfig();
        const maxVoices = Math.max(1, Math.floor(Number(hitCfg.maxVoices) || 6));
        if (this._hitVoices >= maxVoices) return;
        const buffer = this._getHitBuffer(type, hitCfg);
        if (!buffer) return;

        const source = this.context.createBufferSource();
        const gain = this._getGain();
        const now = this.context.currentTime;
        source.buffer = buffer;
        gain.gain.cancelScheduledValues?.(now);
        gain.gain.value = this._hitLevel(type, hitCfg);
        source.connect(gain);
        gain.connect(this.masterGain);
        this._hitVoices++;
        source.onended = () => {
            this._hitVoices = Math.max(0, this._hitVoices - 1);
            try { source.disconnect(); } catch (e) { /* ignore */ }
            try { gain.disconnect(); } catch (e) { /* ignore */ }
            this._releaseGain(gain);
        };
        source.start(now);

        // 保留原有音频延迟采样（预渲染采样从 currentTime 立即起播）
        if (typeof perfMonitor !== 'undefined' && perfMonitor && typeof perfMonitor.recordAudioLatency === 'function') {
            const actualTime = this.context.currentTime;
            if (actualTime > now) perfMonitor.recordAudioLatency((actualTime - now) * 1000);
        }
    }

    /** Hold 成功收尾：只播一次短促收束音，不参与谱面时钟。 */
    playHoldEnd() {
        this.playHitSound('holdEnd');
    }

    _hitLevel(type, cfg) {
        const base = Number.isFinite(cfg.gain) ? cfg.gain : 0.24;
        const scale = type === 'miss' ? cfg.missGainScale : (type === 'holdEnd' ? cfg.holdEndGainScale : 1);
        return Math.max(0, Math.min(1, base * (Number.isFinite(scale) ? scale : (type === 'miss' ? 0.75 : 0.85))));
    }

    /** 按采样参数签名懒生成并缓存；兼容 getHitSoundConfig 每次创建新 fallback 对象。 */
    _getHitBuffer(type, cfg) {
        const configKey = JSON.stringify([
            cfg.perfectFreq, cfg.greatFreq, cfg.holdEndFreq, cfg.missFreq,
            cfg.duration, cfg.click
        ]);
        if (this._hitBufferConfigKey !== configKey) {
            this._hitBuffers.clear();
            this._hitBufferConfigKey = configKey;
        }
        const kind = ['perfect', 'great', 'miss', 'holdEnd'].includes(type) ? type : 'miss';
        if (!this._hitBuffers.has(kind)) this._hitBuffers.set(kind, this._renderHitBuffer(kind, cfg));
        return this._hitBuffers.get(kind);
    }

    _renderHitBuffer(type, cfg) {
        if (typeof this.context.createBuffer !== 'function') return null;
        const sampleRate = this.context.sampleRate || 48000;
        const isMiss = type === 'miss';
        const duration = Math.max(0.015, Math.min(0.12, Number(cfg.duration) || 0.045));
        const length = Math.max(1, Math.round(sampleRate * duration));
        const buffer = this.context.createBuffer(1, length, sampleRate);
        const data = buffer.getChannelData(0);
        const freq = Number(type === 'perfect' ? cfg.perfectFreq
            : type === 'great' ? cfg.greatFreq
            : type === 'holdEnd' ? cfg.holdEndFreq
            : cfg.missFreq) || (isMiss ? 150 : 1600);
        const click = Math.max(0, Math.min(1, Number.isFinite(cfg.click) ? cfg.click : 0.55));
        const bodyDecay = isMiss ? 0.018 : 0.012;
        const clickDecay = isMiss ? 0.004 : 0.0018;
        let seed = 0x9e3779b9 ^ Math.round(freq);
        let peak = 0;
        for (let i = 0; i < length; i++) {
            const t = i / sampleRate;
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            const noise = seed / 2147483648 - 1;
            const body = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t / bodyDecay);
            const overtone = Math.sin(2 * Math.PI * freq * 2.37 * t) * Math.exp(-t / (bodyDecay * 0.45)) * 0.35;
            const transient = noise * Math.exp(-t / clickDecay) * click;
            const fadeOut = Math.min(1, (length - i) / Math.max(1, sampleRate * 0.003));
            const value = (body + overtone + transient) * fadeOut;
            data[i] = value;
            peak = Math.max(peak, Math.abs(value));
        }
        if (peak > 0) for (let i = 0; i < length; i++) data[i] /= peak;
        return buffer;
    }

    // ========== Gain 节点池 ==========
    _gainPool = [];

    _getGain() {
        if (this._gainPool.length > 0) return this._gainPool.pop();
        return this.context.createGain();
    }

    _releaseGain(gain) {
        if (this._gainPool.length < 32) this._gainPool.push(gain);
    }
    
    startPresetMusic(delaySeconds = 0) {
        this._startMusic('preset', delaySeconds);
        this.nextNoteTime = this._musicStartTime;
        this._beatIndex = 0;
        this.scheduler();
    }
    
    scheduler() {
        if (!this.isPlaying || this._paused) return;
        const presetCfg = getPresetMusicConfig();
        while (this.nextNoteTime < this.context.currentTime + presetCfg.presetSchedulerLookAhead) this.scheduleNote();
        this.timerID = setTimeout(() => this.scheduler(), presetCfg.presetSchedulerInterval);
    }
    
    scheduleNote() {
        const presetCfg = getPresetMusicConfig();
        const beatDuration = 60 / CONFIG.bpm;
        const delay = Math.max(0, this.nextNoteTime - this.context.currentTime);
        if (this._beatIndex % 4 === 0) {
            this.playKick(delay);
            this.playNote(presetCfg.bassFreqs[Math.floor(this._beatIndex / 16) % 4], presetCfg.bassDuration, 'triangle', delay);
        }
        if (this._beatIndex % 2 === 0) {
            this.playHiHat(delay);
            this.playNote(presetCfg.leadFreqs[Math.floor(this._beatIndex / 2) % 4], presetCfg.leadDuration, 'square', delay);
        }
        this.nextNoteTime += beatDuration / 4;
        this._beatIndex++;
    }
    
    playKick(time) {
        if (!this.context) return;
        const presetCfg = getPresetMusicConfig();
        const osc = this.context.createOscillator();
        const gain = this.context.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(presetCfg.kickFreqStart, this.context.currentTime + time);
        osc.frequency.exponentialRampToValueAtTime(presetCfg.kickFreqEnd, this.context.currentTime + time + presetCfg.kickDuration);
        gain.gain.setValueAtTime(presetCfg.kickGain, this.context.currentTime + time);
        gain.gain.exponentialRampToValueAtTime(0.01, this.context.currentTime + time + presetCfg.kickDuration);
        osc.connect(gain);
        gain.connect(this.musicGain || this.masterGain);
        osc.start(this.context.currentTime + time);
        osc.stop(this.context.currentTime + time + presetCfg.kickDuration);
    }
    
    playHiHat(time) {
        if (!this.context) return;
        const presetCfg = getPresetMusicConfig();
        const bufferSize = this.context.sampleRate * presetCfg.hiHatDuration;
        const buffer = this.context.createBuffer(1, bufferSize, this.context.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        const noise = this.context.createBufferSource();
        const gain = this.context.createGain();
        noise.buffer = buffer;
        gain.gain.setValueAtTime(presetCfg.hiHatGain, this.context.currentTime + time);
        gain.gain.exponentialRampToValueAtTime(0.01, this.context.currentTime + time + presetCfg.hiHatDuration);
        noise.connect(gain);
        gain.connect(this.musicGain || this.masterGain);
        noise.start(this.context.currentTime + time);
    }
    
    startMidiMusic(events, delaySeconds = 0) {
        this._startMusic('midi', delaySeconds);
        this._midiAllEvents = events;
        this.midiEvents = events.slice();
        this._connectMidiReverb();
        this.masterGain.gain.value = (typeof currentVolume !== 'undefined' ? currentVolume : CONFIG.defaultVolume) / 10;
        this.midiScheduler();
    }

    _connectMidiReverb() {
        const reverbCfg = getReverbConfig();
        if (!this.convolver) {
            this.convolver = this.context.createConvolver();
            this.convolver.buffer = this.createReverbImpulse(reverbCfg.duration, reverbCfg.decay, false);
        }
        // 确保 convolver 输出有效连接（可能已被 stopMusic 摘除）
        try { this.convolver.disconnect(); } catch (e) {}
        // convolver → limiter（混响信号也经过 limiter 保护）
        this.convolver.connect(this.limiter || this.context.destination);
        // musicGain → convolver（混响发送）
        this.musicGain.connect(this.convolver);
    }
    
    midiScheduler() {
        if (!this.isPlaying || this._paused) return;
        const midiCfg = getMidiConfig();
        const now = this.context.currentTime;
        while (this.midiEvents.length > 0) {
            const event = this.midiEvents[0];
            const when = this._musicStartTime + event.time;
            if (when > now + midiCfg.schedulerLookAhead) break;
            this.midiEvents.shift();
            if (event.type === 'noteOn') this.playMidiNote(event.noteNumber, event.duration, event.velocity, Math.max(now, when));
        }
        this.midiScheduleTimer = setTimeout(() => this.midiScheduler(), midiCfg.schedulerInterval);
    }
    
    // ========== 音频文件播放 ==========

    /**
     * 加载音频文件（.ogg / .mp3 / .wav）
     * 支持两种调用形态：
     *   - loadAudioFile(url)                 兼容旧调用，直接设置为当前曲目
     *   - loadAudioFile(url, { cacheKey })   带 key 走解码缓存
     * @param {string} url - 音频文件路径或 blob URL
     * @param {Object} [opts]
     * @param {string} [opts.cacheKey] - 缓存键（如曲目 id）；命中时跳过下载与解码
     * @param {boolean} [opts.setCurrent=true] - 是否把结果设为当前待播曲目
     * @param {(p: {phase: string, loaded: number, total: number, speed: number}) => void} [opts.onProgress]
     *   进度回调：phase = 'start' | 'cache' | 'download' | 'decode' | 'done'
     * @returns {Promise<boolean>} 是否加载成功
     */
    async loadAudioFile(url, opts = {}) {
        const { cacheKey = null, setCurrent = true, onProgress = null } = opts;
        this.init();
        const report = (phase, loaded = 0, total = 0, speed = 0) => {
            if (!onProgress) return;
            try { onProgress({ phase, loaded, total, speed }); } catch (e) { /* 回调异常不影响加载 */ }
        };

        // 缓存命中：跳过 fetch + decodeAudioData（移动端解码 3MB ogg 可达数秒）
        if (cacheKey && this.hasCachedAudio(cacheKey)) {
            if (setCurrent) {
                this.useCachedAudio(cacheKey);
                this._currentAudioUrl = url;
            }
            const buf = this.getCachedAudio(cacheKey);
            report('cache', buf ? AudioEngine._bufferBytes(buf) : 0, buf ? AudioEngine._bufferBytes(buf) : 0, 0);
            report('done', 0, 0, 0);
            return true;
        }

        try {
            report('start', 0, 0, 0);
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const total = Number(response.headers.get('content-length')) || 0;
            let arrayBuffer;

            // 流式读取：能拿到实时的"已下载 / 总大小 / 速度"用于进度条
            if (response.body && typeof response.body.getReader === 'function') {
                const reader = response.body.getReader();
                const chunks = [];
                let received = 0;
                const startedAt = performance.now();
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    received += value.length;
                    const seconds = Math.max(0.001, (performance.now() - startedAt) / 1000);
                    report('download', received, total, received / seconds);
                }
                const merged = new Uint8Array(received);
                let offset = 0;
                for (const chunk of chunks) {
                    merged.set(chunk, offset);
                    offset += chunk.length;
                }
                arrayBuffer = merged.buffer;
            } else {
                arrayBuffer = await response.arrayBuffer();
                report('download', arrayBuffer.byteLength, total || arrayBuffer.byteLength, 0);
            }

            report('decode', arrayBuffer.byteLength, total || arrayBuffer.byteLength, 0);
            const buffer = await this.context.decodeAudioData(arrayBuffer);

            if (cacheKey) this._cacheBuffer(cacheKey, buffer);
            if (setCurrent) {
                this.audioBuffer = buffer;
                this._currentAudioKey = cacheKey || null;
                this._currentAudioUrl = url;
            }
            console.log('Audio file loaded:', url, `duration: ${buffer.duration.toFixed(1)}s`);
            report('done', arrayBuffer.byteLength, total || arrayBuffer.byteLength, 0);
            return true;
        } catch (err) {
            console.error('Failed to load audio file:', url, err);
            if (setCurrent) {
                this.audioBuffer = null;
                this._currentAudioKey = null;
            }
            report('error', 0, 0, 0);
            return false;
        }
    }

    /** 音频缓冲占用字节数（用于缓存淘汰） */
    static _bufferBytes(buffer) {
        if (!buffer) return 0;
        return (buffer.length || 0) * (buffer.numberOfChannels || 1) * 4;
    }

    /**
     * 写入解码缓存（按 key 分槽 + LRU 淘汰）
     * 不同曲目各占一个 key，避免"切歌后仍拿到上一首的 buffer"。
     */
    _cacheBuffer(key, buffer) {
        if (!key || !buffer) return;
        const old = this._audioCache.get(key);
        if (old) {
            this._audioCacheBytes -= AudioEngine._bufferBytes(old);
            this._audioCache.delete(key);
        }
        this._audioCache.set(key, buffer);
        this._audioCacheBytes += AudioEngine._bufferBytes(buffer);
        this._lastCachedKey = key;
        this._evictAudioCache();
    }

    /** 缓存淘汰：超条数或超内存时，从最久未使用的开始丢（跳过在用槽位与最后一个） */
    _evictAudioCache() {
        while (this._audioCache.size > 1 || this._audioCacheBytes > this._audioCacheMaxBytes) {
            // 条数/内存都在预算内就停
            if (this._audioCache.size <= this._audioCacheMaxItems && this._audioCacheBytes <= this._audioCacheMaxBytes) break;
            // 只保留最后一个（最近写入）——单个超大伴奏（如 6 分钟曲目解码后 140MB）
            // 也比预算大时必须留下，否则预加载等于白做、开局直接掉回预设音乐
            if (this._audioCache.size <= 1) break;

            let evicted = false;
            for (const [key, buffer] of this._audioCache) {
                if (key === this._currentAudioKey || key === this._activeAudioKey) continue;
                // 保住最后写入的那一条
                if (key === this._lastCachedKey) continue;
                this._audioCache.delete(key);
                this._audioCacheBytes -= AudioEngine._bufferBytes(buffer);
                evicted = true;
                break;
            }
            if (!evicted) break;   // 全都在用：宁可不淘汰
        }
    }

    /** 查询某个 key 是否已缓存解码结果 */
    hasCachedAudio(cacheKey) {
        return !!(cacheKey && this._audioCache.has(cacheKey));
    }

    /** 从缓存取解码结果（不改变当前曲目）；命中时刷新 LRU 顺序 */
    getCachedAudio(cacheKey) {
        if (!cacheKey) return null;
        const buffer = this._audioCache.get(cacheKey);
        if (!buffer) return null;
        // 命中即刷新为最新
        this._audioCache.delete(cacheKey);
        this._audioCache.set(cacheKey, buffer);
        return buffer;
    }

    /**
     * 把某个 key 的解码结果设为"当前待播曲目"
     * @returns {boolean} 是否命中
     */
    useCachedAudio(cacheKey) {
        const buffer = this.getCachedAudio(cacheKey);
        this.audioBuffer = buffer;
        this._currentAudioKey = buffer ? cacheKey : null;
        return !!buffer;
    }

    /** 延迟到谱面零点，并应用谱面定义的伴奏提前/延后量（秒）。 */
    startAudioPlayback(delaySeconds = 0, offsetSeconds = 0) {
        if (!this.audioBuffer) return;
        this._startMusic('file', delaySeconds);
        this._fileOffsetSeconds = offsetSeconds;
        this._scheduleAudioSource();
    }

    _scheduleAudioSource() {
        this._stopAudioSource();
        const now = this.context.currentTime;
        const audioZero = this._musicStartTime + this._fileOffsetSeconds;
        const position = Math.max(0, now - audioZero);
        if (position >= this.audioBuffer.duration) return;
        this.audioSource = this.context.createBufferSource();
        this.audioSource.buffer = this.audioBuffer;
        this.audioSource.connect(this.musicGain);
        this.audioSource.start(Math.max(now, audioZero), position);
    }

    /** 只停止当前文件音源，不动 buffer / 缓存 */
    _stopAudioSource() {
        if (this.audioSource) {
            try { this.audioSource.stop(); } catch (e) { /* 可能已停止 */ }
            try { this.audioSource.disconnect(); } catch (e) { /* ignore */ }
            this.audioSource = null;
        }
    }

    /**
     * 停止音频文件播放
     */
    stopAudio() {
        this._stopAudioSource();
        // 只解除"当前待播"引用；解码缓存保留，RETRY 时免重复下载解码
        this.audioBuffer = null;
        this._currentAudioKey = null;
    }

    // ========== 跳过前奏（时间轴跳转） ==========

    /** 跳到未应用玩家校准的谱面时间（ms），同时重排伴奏。 */
    seekMusic(timeMs) {
        if (!this.isPlaying || this._paused) return;
        const seconds = timeMs / 1000;
        this._musicStartTime = this.context.currentTime - seconds;
        if (this._mode === 'file' && this.audioBuffer) {
            this._scheduleAudioSource();
            return;
        }

        this._silenceMusic();
        this._connectMusicBus();
        if (this._mode === 'midi') {
            this.midiEvents = this._midiAllEvents.filter(event => event.time >= seconds);
            this._connectMidiReverb();
            this.midiScheduler();
        } else if (this._mode === 'preset') {
            const step = 60 / CONFIG.bpm / 4;
            this._beatIndex = Math.max(0, Math.ceil(seconds / step));
            this.nextNoteTime = this._musicStartTime + this._beatIndex * step;
            this.scheduler();
        }
    }

    // ========== 暂停 / 恢复 ==========

    /** 暂停同一个音频时钟，已排程的采样和合成音符随之冻结。 */
    pauseMusic() {
        if (!this.isPlaying) return;
        this._transportVersion++;
        this._paused = true;
        if (this.timerID) { clearTimeout(this.timerID); this.timerID = null; }
        if (this.midiScheduleTimer) { clearTimeout(this.midiScheduleTimer); this.midiScheduleTimer = null; }
        this.context.suspend().catch(() => { /* 上下文可能已关闭 */ });
    }

    async resumeMusic() {
        if (!this.isPlaying) return false;
        if (!this._paused) return true;
        const version = ++this._transportVersion;
        try {
            await this.context.resume();
        } catch {
            return false;
        }
        // 恢复过程中可能再次暂停、重试或换曲。过期的恢复不能启动调度器。
        if (version !== this._transportVersion) return false;
        this._paused = false;
        if (this._mode === 'preset') this.scheduler();
        else if (this._mode === 'midi') this.midiScheduler();
        return true;
    }

    // ========== 停止所有音乐 ==========

    /**
     * 立刻静音所有音乐：停调度器、停文件音源、断开音乐总线。
     * 只切断声音通路，不改动 audioBuffer / 解码缓存（重试、暂停恢复还能继续用）。
     */
    _silenceMusic() {
        if (this.timerID) { clearTimeout(this.timerID); this.timerID = null; }
        if (this.midiScheduleTimer) { clearTimeout(this.midiScheduleTimer); this.midiScheduleTimer = null; }
        this.midiEvents = [];
        this._stopAudioSource();
        if (this.musicGain) {
            try { this.musicGain.disconnect(); } catch (e) { /* 未连接 */ }
        }
        // 混响是并行支路，单独断开，避免残留信号继续发声
        if (this.convolver) {
            try { this.convolver.disconnect(); } catch (e) { /* ignore */ }
        }
    }

    stopMusic() {
        this.isPlaying = false;
        this._paused = false;
        this._transportVersion++;
        this._midiAllEvents = [];
        this._mode = null;
        this._activeAudioKey = null;
        this._silenceMusic();
    }
    
    // 设置音量 (0-10)
    setVolume(level) {
        if (this.masterGain) {
            this.masterGain.gain.value = level / 10;
        }
    }
}

const audioEngine = new AudioEngine();