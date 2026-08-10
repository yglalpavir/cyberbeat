class AudioEngine {
    constructor() {
        this.context = null;
        this.masterGain = null;
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
        gain.connect(this.masterGain);
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
        gain.connect(this.masterGain);
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
        this.isPlaying = true;
        this._paused = false;
        this._mode = 'preset';
        this.nextNoteTime = this.context.currentTime;
        this.masterGain.disconnect();
        this.masterGain.connect(this.limiter || this.context.destination);
        this.masterGain.gain.value = (typeof currentVolume !== 'undefined' ? currentVolume : CONFIG.defaultVolume) / 10;
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
        gain.connect(this.masterGain);
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
        gain.connect(this.masterGain);
        noise.start(this.context.currentTime + time);
    }
    
    startMidiMusic(events) {
        this.init();
        if (this.context.state === 'suspended') this.context.resume();
        this.isPlaying = true;
        this._paused = false;
        this._mode = 'midi';
        this.midiEvents = events;
        // 保存完整事件流，供 seek（跳过前奏）时重新注入已消费的事件
        this._midiAllEvents = events;
        this.midiStartTime = this.context.currentTime;
        this.masterGain.disconnect();
        const reverbCfg = getReverbConfig();
        if (!this.convolver) {
            this.convolver = this.context.createConvolver();
            this.convolver.buffer = this.createReverbImpulse(reverbCfg.duration, reverbCfg.decay, false);
        }
        // 确保 convolver 输出有效连接（可能已被 stopMusic 摘除）
        try { this.convolver.disconnect(); } catch (e) {}
        // convolver → limiter（混响信号也经过 limiter 保护）
        this.convolver.connect(this.limiter || this.context.destination);
        // masterGain → limiter / destination（干信号）
        this.masterGain.connect(this.limiter || this.context.destination);
        // masterGain → convolver（混响发送）
        this.masterGain.connect(this.convolver);
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
     * @param {string} url - 音频文件路径
     * @returns {Promise<boolean>} 是否加载成功
     */
    async loadAudioFile(url) {
        this.init();
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const arrayBuffer = await response.arrayBuffer();
            this.audioBuffer = await this.context.decodeAudioData(arrayBuffer);
            console.log('Audio file loaded:', url, `duration: ${this.audioBuffer.duration.toFixed(1)}s`);
            return true;
        } catch (err) {
            console.error('Failed to load audio file:', url, err);
            this.audioBuffer = null;
            return false;
        }
    }

    /**
     * 播放已加载的音频文件
     * @param {number} delaySeconds - 延迟秒数后播放
     */
    startAudioPlayback(delaySeconds = 0) {
        if (!this.context || !this.audioBuffer) return;
        if (this.context.state === 'suspended') this.context.resume();
        this.isPlaying = true;
        this._paused = false;
        this._mode = 'file';

        // 确保 masterGain 连接到了音频输出
        try {
            this.masterGain.disconnect();
        } catch (e) { /* 可能未连接 */ }
        // 摘除可能残留的混响发送（stopMusic 已摘输出，这里兜底）
        if (this.convolver) {
            try { this.convolver.disconnect(); } catch (e) {}
        }
        if (this.limiter) {
            this.masterGain.connect(this.limiter);
            this.limiter.connect(this.context.destination);
        } else {
            this.masterGain.connect(this.context.destination);
        }

        this.audioSource = this.context.createBufferSource();
        this.audioSource.buffer = this.audioBuffer;

        // 连接：audioSource → masterGain → [limiter] → destination
        this.audioSource.connect(this.masterGain);

        const startTime = this.context.currentTime + delaySeconds;
        this.audioStartTime = startTime;
        this.audioSource.start(startTime);

        console.log(`Audio playback starting in ${delaySeconds}s`);
    }

    /**
     * 停止音频文件播放
     */
    stopAudio() {
        if (this.audioSource) {
            try { this.audioSource.stop(); } catch (e) { /* 可能已停止 */ }
            this.audioSource.disconnect();
            this.audioSource = null;
        }
        this.audioBuffer = null;
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
            this.audioSource.connect(this.masterGain);
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

    stopMusic() {
        this.isPlaying = false;
        this._paused = false;
        this._pauseStartTime = 0;
        this._mode = null;
        if (this.timerID) clearTimeout(this.timerID);
        if (this.midiScheduleTimer) clearTimeout(this.midiScheduleTimer);
        this.stopAudio();
        if (this.masterGain) {
            try { this.masterGain.disconnect(); } catch (e) {}
            if (this.limiter) {
                try { this.limiter.disconnect(); } catch (e) {}
            }
        }
        // 摘除混响输出，避免残留信号继续发声
        if (this.convolver) {
            try { this.convolver.disconnect(); } catch (e) {}
        }
    }
    
    // 设置音量 (0-10)
    setVolume(level) {
        if (this.masterGain) {
            this.masterGain.gain.value = level / 10;
        }
    }
}

const audioEngine = new AudioEngine();