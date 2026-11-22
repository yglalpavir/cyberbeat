class AudioEngine {
    constructor() {
        this.context = null;
        this.masterGain = null;
        this.musicGain = null;      // 音乐总线：file / midi / preset → musicGain → masterGain
        this.limiter = null;
        this.isPlaying = false;
        this.nextNoteTime = 0;
        this.timerID = null;
        this.midiScheduleTimer = null;
        this.midiEvents = [];
        this.midiStartTime = 0;
        this.convolver = null;
        // 音频文件播放
        this.audioBuffer = null;
        this.audioSource = null;
        this.audioStartTime = 0;
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
        this._pauseStartTime = 0;   // 挂起时 audioContext 的 currentTime
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
        
        // 信号链：masterGain → [limiter] → destination
        if (this.limiter) {
            this.masterGain.connect(this.limiter);
            this.limiter.connect(this.context.destination);
        } else {
            this.masterGain.connect(this.context.destination);
        }

        // 音乐总线：所有伴奏（文件 / MIDI / 预设）都挂在这里，
        // 停止音乐时整条总线断开即可立刻静音，不会残留上一条音频
        this.musicGain = this.context.createGain();
        this.musicGain.gain.value = 1;
        this.musicGain.connect(this.masterGain);
    }

    /** 取得（必要时重建）音乐总线的连接，返回可连接的节点 */
    _musicBus() {
        this.init();
        if (!this.musicGain) {
            this.musicGain = this.context.createGain();
            this.musicGain.gain.value = 1;
        }
        try { this.musicGain.disconnect(); } catch (e) { /* 可能未连接 */ }
        this.musicGain.gain.value = 1;
        this.musicGain.connect(this.masterGain);
        return this.musicGain;
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
    
    playMidiNote(noteNumber, duration, velocity) {
        if (!this.context) return;
        const midiCfg = getMidiConfig();
        const freq = 440 * Math.pow(2, (noteNumber - 69) / 12);
        const type = noteNumber < midiCfg.lowNoteThreshold ? midiCfg.lowNoteType : midiCfg.highNoteType;
        const osc = this.context.createOscillator();
        const gain = this.context.createGain();
        const vol = (velocity / midiCfg.maxVelocity) * midiCfg.velocityGain;
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, this.context.currentTime);
        gain.gain.linearRampToValueAtTime(vol, this.context.currentTime + midiCfg.noteOnRampTime);
        gain.gain.setValueAtTime(vol, this.context.currentTime + duration);
        gain.gain.exponentialRampToValueAtTime(0.01, this.context.currentTime + duration + midiCfg.noteOffRampTime);
        osc.connect(gain);
        gain.connect(this.musicGain || this.masterGain);
        osc.start();
        osc.stop(this.context.currentTime + duration + midiCfg.noteStopPadding);
    }
    
    playHitSound(type) {
        if (!this.context) return;
        const hitCfg = getHitSoundConfig();
        // Oscillator 不能复用（只能 start 一次），必须每次新建
        const osc = this.context.createOscillator();
        // Gain 可以池化复用
        const gain = this._getGain();
        osc.type = 'square';
        if (type === 'perfect') osc.frequency.value = hitCfg.perfectFreq;
        else if (type === 'great') osc.frequency.value = hitCfg.greatFreq;
        else osc.frequency.value = hitCfg.missFreq;
        const now = this.context.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(hitCfg.gain, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + hitCfg.duration);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + hitCfg.duration);
        // Oscillator 用完即弃，Gain 归还池
        osc.onended = () => {
            this._releaseGain(gain);
            try { gain.disconnect(); } catch(e) {}
        };

        // 记录音频延迟
        if (perfMonitor) {
            const actualTime = this.context.currentTime;
            if (actualTime > now) {
                perfMonitor.recordAudioLatency((actualTime - now) * 1000);
            }
        }
    }

    // ========== Gain 节点池 (Oscillator 不可复用) ==========
    _gainPool = [];

    _getGain() {
        if (this._gainPool.length > 0) return this._gainPool.pop();
        return this.context.createGain();
    }

    _releaseGain(gain) {
        if (this._gainPool.length < 32) this._gainPool.push(gain);
    }
    
    startPresetMusic() {
        this.init();
        if (this.context.state === 'suspended') this.context.resume();
        // 先彻底停掉上一条音乐（含残留 source / 调度器），再开始新的
        this._silenceMusic();
        this.isPlaying = true;
        this._paused = false;
        this._mode = 'preset';
        this._activeAudioKey = null;
        this.nextNoteTime = this.context.currentTime;
        this._musicBus();
        this.scheduler();
    }
    
    scheduler() {
        const presetCfg = getPresetMusicConfig();
        while (this.nextNoteTime < this.context.currentTime + presetCfg.presetSchedulerLookAhead) this.scheduleNote();
        if (this.isPlaying) this.timerID = setTimeout(() => this.scheduler(), presetCfg.presetSchedulerInterval);
    }
    
    scheduleNote() {
        const presetCfg = getPresetMusicConfig();
        const beatDuration = 60 / CONFIG.bpm;
        const barBeat = gameState.beatIndex % 16;
        if (barBeat === 0 || barBeat === 4 || barBeat === 8 || barBeat === 12) this.playKick(0);
        if (barBeat % 2 === 0) this.playHiHat(0);
        if (barBeat === 0 || barBeat === 4 || barBeat === 8 || barBeat === 12) {
            this.playNote(presetCfg.bassFreqs[Math.floor(gameState.beatIndex / 16) % 4], presetCfg.bassDuration, 'triangle');
        }
        if (barBeat % 2 === 0) {
            this.playNote(presetCfg.leadFreqs[Math.floor(gameState.beatIndex / 2) % 4], presetCfg.leadDuration, 'square');
        }
        this.nextNoteTime += beatDuration / 4;
        gameState.beatIndex++;
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
    
    startMidiMusic(events) {
        this.init();
        if (this.context.state === 'suspended') this.context.resume();
        // 先彻底停掉上一条音乐（含残留 source / 调度器），再开始新的
        this._silenceMusic();
        this.isPlaying = true;
        this._paused = false;
        this._mode = 'midi';
        this._activeAudioKey = null;
        this.midiEvents = events;
        // 保存完整事件流，供 seek（跳过前奏）时重新注入已消费的事件
        this._midiAllEvents = events;
        this.midiStartTime = this.context.currentTime;
        const bus = this._musicBus();
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
        bus.connect(this.convolver);
        // 同步当前全局音量
        this.masterGain.gain.value = (typeof currentVolume !== 'undefined' ? currentVolume : CONFIG.defaultVolume) / 10;
        this.midiScheduler();
    }
    
    midiScheduler() {
        if (!this.isPlaying) return;
        const midiCfg = getMidiConfig();
        const currentTime = this.context.currentTime - this.midiStartTime;
        while (this.midiEvents.length > 0) {
            const event = this.midiEvents[0];
            if (event.time <= currentTime + midiCfg.schedulerLookAhead) {
                this.midiEvents.shift();
                if (event.type === 'noteOn') this.playMidiNote(event.noteNumber, event.duration, event.velocity);
            } else break;
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

    /**
     * 播放已加载的音频文件
     * @param {number} delaySeconds - 延迟秒数后播放
     */
    startAudioPlayback(delaySeconds = 0) {
        if (!this.context || !this.audioBuffer) return;
        if (this.context.state === 'suspended') this.context.resume();

        // 先停掉上一条音乐（含残留 source），保证同一时刻只有一条伴奏在播
        const buffer = this.audioBuffer;
        this._silenceMusic();

        this.isPlaying = true;
        this._paused = false;
        this._mode = 'file';
        this._activeAudioKey = this._currentAudioKey;
        this.audioBuffer = buffer;

        const bus = this._musicBus();

        this.audioSource = this.context.createBufferSource();
        this.audioSource.buffer = buffer;

        // 连接：audioSource → musicGain → masterGain → [limiter] → destination
        this.audioSource.connect(bus);

        const startTime = this.context.currentTime + delaySeconds;
        this.audioStartTime = startTime;
        this.audioSource.start(startTime);

        console.log(`Audio playback starting in ${delaySeconds}s`);
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

    /**
     * 将音乐时间轴跳转到 sceneMs（毫秒，0 = 音乐起点）
     * @param {number} sceneMs - 目标场景时间
     */
    seekMusic(sceneMs) {
        if (!this.isPlaying || this._paused) return;
        const t = Math.max(0, sceneMs) / 1000;

        // 音频文件：重建 source 并从目标位置重新起播
        if (this._mode === 'file' && this.audioBuffer) {
            try { this.audioSource.stop(); } catch (e) {}
            try { this.audioSource.disconnect(); } catch (e) {}
            this.audioSource = this.context.createBufferSource();
            this.audioSource.buffer = this.audioBuffer;
            this.audioSource.connect(this.musicGain || this.masterGain);
            this.audioSource.start(0, t);
            this.audioStartTime = this.context.currentTime - t;
            return;
        }

        // MIDI：平移基准时间，并重新注入已消费的音乐事件
        if (this._mode === 'midi') {
            const all = this._midiAllEvents || [];
            this.midiEvents = all.filter(ev => ev.time >= sceneMs).map(ev => Object.assign({}, ev));
            this.midiStartTime = this.context.currentTime - t;
            if (this.midiScheduleTimer) {
                clearTimeout(this.midiScheduleTimer);
                this.midiScheduleTimer = null;
            }
            this.midiScheduler();
            return;
        }

        // preset 节拍器音乐无前奏，无需处理
    }

    // ========== 暂停 / 恢复 ==========

    /**
     * 暂停当前播放的所有音乐（Web Audio suspend 冻结所有已调度声音）
     */
    pauseMusic() {
        if (!this.isPlaying || this._paused) return;
        this._paused = true;
        if (this._pauseStartTime === 0) this._pauseStartTime = this.context ? this.context.currentTime : 0;
        if (this.timerID) { clearTimeout(this.timerID); this.timerID = null; }
        if (this.midiScheduleTimer) { clearTimeout(this.midiScheduleTimer); this.midiScheduleTimer = null; }
        if (this.context && this.context.state === 'running') {
            this.context.suspend();
        }
    }

    /**
     * 恢复播放（对齐时间轴，重启对应调度器）
     */
    resumeMusic() {
        if (!this._paused) return;
        this._paused = false;

        if (this.context) {
            const pauseDuration = this.context.currentTime - this._pauseStartTime;
            // MIDI 时间轴整体平移，保证尚未排程的事件仍对齐
            if (this._mode === 'midi') this.midiStartTime += Math.max(0, pauseDuration);
            this._pauseStartTime = 0;
            if (this.context.state === 'suspended') this.context.resume();
        }

        if (!this.isPlaying) return;
        if (this._mode === 'preset') this.scheduler();
        else if (this._mode === 'midi') this.midiScheduler();
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
        this._pauseStartTime = 0;
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