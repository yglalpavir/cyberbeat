class AudioEngine {
    constructor() {
        this.context = null;
        this.masterGain = null;
        this.isPlaying = false;
        this.nextNoteTime = 0;
        this.timerID = null;
        this.midiScheduleTimer = null;
        this.midiEvents = [];
        this.midiStartTime = 0;
        this.convolver = null;
    }
    
    init() {
        if (this.context) return;
        this.context = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.context.createGain();
        // 初始音量使用全局 currentVolume（若未定义则使用默认值）
        const vol = (typeof currentVolume !== 'undefined') ? currentVolume : CONFIG.defaultVolume;
        this.masterGain.gain.value = vol / 100;
        this.masterGain.connect(this.context.destination);
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
        const osc = this.context.createOscillator();
        const gain = this.context.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.3, this.context.currentTime + time);
        gain.gain.exponentialRampToValueAtTime(0.01, this.context.currentTime + time + duration);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(this.context.currentTime + time);
        osc.stop(this.context.currentTime + time + duration);
    }
    
    playMidiNote(noteNumber, duration, velocity) {
        if (!this.context) return;
        const freq = 440 * Math.pow(2, (noteNumber - 69) / 12);
        const type = noteNumber < 60 ? 'triangle' : 'square';
        const osc = this.context.createOscillator();
        const gain = this.context.createGain();
        const vol = (velocity / 127) * 0.5;
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, this.context.currentTime);
        gain.gain.linearRampToValueAtTime(vol, this.context.currentTime + 0.02);
        gain.gain.setValueAtTime(vol, this.context.currentTime + duration);
        gain.gain.exponentialRampToValueAtTime(0.01, this.context.currentTime + duration + 0.15);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start();
        osc.stop(this.context.currentTime + duration + 0.2);
    }
    
    playHitSound(type) {
        if (!this.context) return;
        const osc = this.context.createOscillator();
        const gain = this.context.createGain();
        osc.type = 'square';
        if (type === 'perfect') osc.frequency.value = 1200;
        else if (type === 'great') osc.frequency.value = 900;
        else osc.frequency.value = 200;
        gain.gain.setValueAtTime(0.2, this.context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.context.currentTime + 0.1);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start();
        osc.stop(this.context.currentTime + 0.1);
    }
    
    startPresetMusic() {
        this.init();
        if (this.context.state === 'suspended') this.context.resume();
        this.isPlaying = true;
        this.nextNoteTime = this.context.currentTime;
        this.masterGain.disconnect();
        this.masterGain.connect(this.context.destination);
        // 同步音量
        this.masterGain.gain.value = (typeof currentVolume !== 'undefined' ? currentVolume : CONFIG.defaultVolume) / 100;
        this.scheduler();
    }
    
    scheduler() {
        while (this.nextNoteTime < this.context.currentTime + 0.1) this.scheduleNote();
        if (this.isPlaying) this.timerID = setTimeout(() => this.scheduler(), 20);
    }
    
    scheduleNote() {
        const beatDuration = 60 / CONFIG.bpm;
        const barBeat = gameState.beatIndex % 16;
        if (barBeat === 0 || barBeat === 4 || barBeat === 8 || barBeat === 12) this.playKick(0);
        if (barBeat % 2 === 0) this.playHiHat(0);
        if (barBeat === 0 || barBeat === 4 || barBeat === 8 || barBeat === 12) {
            const bassFreqs = [110, 130, 146, 164];
            this.playNote(bassFreqs[Math.floor(gameState.beatIndex / 16) % 4], 0.1, 'triangle');
        }
        if (barBeat % 2 === 0) {
            const leadFreqs = [440, 523, 659, 784];
            this.playNote(leadFreqs[Math.floor(gameState.beatIndex / 2) % 4], 0.05, 'square');
        }
        this.nextNoteTime += beatDuration / 4;
        gameState.beatIndex++;
    }
    
    playKick(time) {
        if (!this.context) return;
        const osc = this.context.createOscillator();
        const gain = this.context.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(200, this.context.currentTime + time);
        osc.frequency.exponentialRampToValueAtTime(50, this.context.currentTime + time + 0.1);
        gain.gain.setValueAtTime(0.5, this.context.currentTime + time);
        gain.gain.exponentialRampToValueAtTime(0.01, this.context.currentTime + time + 0.15);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(this.context.currentTime + time);
        osc.stop(this.context.currentTime + time + 0.15);
    }
    
    playHiHat(time) {
        if (!this.context) return;
        const bufferSize = this.context.sampleRate * 0.02;
        const buffer = this.context.createBuffer(1, bufferSize, this.context.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        const noise = this.context.createBufferSource();
        const gain = this.context.createGain();
        noise.buffer = buffer;
        gain.gain.setValueAtTime(0.1, this.context.currentTime + time);
        gain.gain.exponentialRampToValueAtTime(0.01, this.context.currentTime + time + 0.02);
        noise.connect(gain);
        gain.connect(this.masterGain);
        noise.start(this.context.currentTime + time);
    }
    
    startMidiMusic(events) {
        this.init();
        if (this.context.state === 'suspended') this.context.resume();
        this.isPlaying = true;
        this.midiEvents = events;
        this.midiStartTime = this.context.currentTime;
        this.masterGain.disconnect();
        if (!this.convolver) {
            this.convolver = this.context.createConvolver();
            this.convolver.buffer = this.createReverbImpulse(3.5, 2.5, false);
        }
        this.masterGain.connect(this.context.destination);
        this.convolver.connect(this.context.destination);
        this.masterGain.connect(this.convolver);
        // 关键修复：显式同步当前全局音量到 masterGain
        this.masterGain.gain.value = (typeof currentVolume !== 'undefined' ? currentVolume : CONFIG.defaultVolume) / 100;
        this.midiScheduler();
    }
    
    midiScheduler() {
        if (!this.isPlaying) return;
        const currentTime = this.context.currentTime - this.midiStartTime;
        while (this.midiEvents.length > 0) {
            const event = this.midiEvents[0];
            if (event.time <= currentTime + 0.1) {
                this.midiEvents.shift();
                if (event.type === 'noteOn') this.playMidiNote(event.noteNumber, event.duration, event.velocity);
            } else break;
        }
        this.midiScheduleTimer = setTimeout(() => this.midiScheduler(), 25);
    }
    
    stopMusic() {
        this.isPlaying = false;
        if (this.timerID) clearTimeout(this.timerID);
        if (this.midiScheduleTimer) clearTimeout(this.midiScheduleTimer);
        if (this.masterGain && this.convolver) {
            try { this.masterGain.disconnect(this.convolver); } catch (e) {}
        }
    }
    
    // 设置音量 (0-100)
    setVolume(percent) {
        if (this.masterGain) {
            this.masterGain.gain.value = percent / 100;
        }
    }
}

const audioEngine = new AudioEngine();