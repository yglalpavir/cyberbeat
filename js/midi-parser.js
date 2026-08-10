// MIDI File Parser
class MidiParser {
    constructor(arrayBuffer) {
        this.buffer = new DataView(arrayBuffer);
        this.pos = 0;
        this.ticksPerBeat = 0;
        this.tempos = [];
        this.notes = [];
    }
    
    parse() {
        const headerId = this.readString(4);
        if (headerId !== 'MThd') throw new Error("Invalid MIDI file");
        
        this.readUint(4); // header size
        const format = this.readUint(2);
        const trackCount = this.readUint(2);
        const division = this.readUint(2);
        this.ticksPerBeat = division & 0x7FFF;
        
        for (let t = 0; t < trackCount; t++) {
            this.readTrack();
        }
        
        return this.convertToSeconds();
    }
    
    readTrack() {
        const trackId = this.readString(4);
        const length = this.readUint(4);
        const endPos = this.pos + length;
        let currentTicks = 0;
        let runningStatus = 0;
        
        while (this.pos < endPos) {
            const delta = this.readVarInt();
            currentTicks += delta;
            
            let status = this.readUint(1);
            if (status < 0x80) {
                this.pos--;
                status = runningStatus;
            } else {
                runningStatus = status;
            }
            
            const messageType = status & 0xF0;
            
            if (messageType === 0x90) { // Note On
                const note = this.readUint(1);
                const velocity = this.readUint(1);
                if (velocity > 0) {
                    this.notes.push({
                        ticks: currentTicks,
                        noteNumber: note,
                        velocity,
                        duration: 0
                    });
                } else {
                    // velocity=0 的 NoteOn 按 NoteOff 处理（MIDI 常见写法）
                    this._noteOff(note, currentTicks);
                }
            } else if (messageType === 0x80) { // Note Off
                const note = this.readUint(1);
                const velocity = this.readUint(1);
                this._noteOff(note, currentTicks);
            } else if (status === 0xFF) { // Meta Event
                const metaType = this.readUint(1);
                const length = this.readVarInt();
                if (metaType === 0x51) { // Tempo
                    const microseconds = (this.readUint(1) << 16) + (this.readUint(1) << 8) + this.readUint(1);
                    this.tempos.push({
                        ticks: currentTicks,
                        bpm: 60000000 / microseconds
                    });
                } else {
                    this.pos += length;
                }
            } else if (messageType === 0xB0 || messageType === 0xE0) {
                this.pos += 2;
            } else if (messageType === 0xC0 || messageType === 0xD0) {
                this.pos += 1;
            } else if (status === 0xF0 || status === 0xF7) {
                const length = this.readVarInt();
                this.pos += length;
            }
        }
        
        this.pos = endPos;
    }

    /** 关闭音高为 note 的音符（从后向前找第一个未结束的） */
    _noteOff(note, currentTicks) {
        for (let i = this.notes.length - 1; i >= 0; i--) {
            if (this.notes[i].noteNumber === note && this.notes[i].duration === 0) {
                this.notes[i].duration = currentTicks - this.notes[i].ticks;
                break;
            }
        }
    }
    
    convertToSeconds() {
        const events = [];
        const sortedTempos = [...this.tempos].sort((a, b) => a.ticks - b.ticks);
        
        const timeline = [];
        sortedTempos.forEach(t => {
            timeline.push({ type: 'tempo', ticks: t.ticks, bpm: t.bpm });
        });
        
        this.notes.forEach(n => {
            if (n.duration > 0) {
                timeline.push({
                    type: 'noteOn',
                    ticks: n.ticks,
                    noteNumber: n.noteNumber,
                    duration: n.duration,
                    velocity: n.velocity
                });
            }
        });
        
        timeline.sort((a, b) => a.ticks - b.ticks);
        
        let lastTicks = 0;
        let lastSeconds = 0;
        let lastTempo = 120;
        const processedEvents = [];
        let totalDuration = 0;
        
        timeline.forEach(event => {
            const deltaTicks = event.ticks - lastTicks;
            const ticksPerSecond = (lastTempo / 60) * this.ticksPerBeat;
            const deltaSeconds = deltaTicks / ticksPerSecond;
            const eventSeconds = lastSeconds + deltaSeconds;
            
            if (event.type === 'tempo') {
                lastTempo = event.bpm;
            } else {
                const durationSeconds = event.duration / ticksPerSecond;
                processedEvents.push({
                    type: 'noteOn',
                    time: eventSeconds,
                    noteNumber: event.noteNumber,
                    duration: durationSeconds,
                    velocity: event.velocity
                });
                
                if (eventSeconds + durationSeconds > totalDuration) {
                    totalDuration = eventSeconds + durationSeconds;
                }
            }
            
            lastTicks = event.ticks;
            lastSeconds = eventSeconds;
        });
        
        return {
            events: processedEvents,
            duration: totalDuration,
            tempos: sortedTempos
        };
    }
    
    readString(len) {
        let str = "";
        for (let i = 0; i < len; i++) {
            str += String.fromCharCode(this.buffer.getUint8(this.pos++));
        }
        return str;
    }
    
    readUint(len) {
        let val = 0;
        for (let i = 0; i < len; i++) {
            val = (val << 8) + this.buffer.getUint8(this.pos++);
        }
        return val;
    }
    
    readVarInt() {
        let val = 0;
        let byte;
        do {
            byte = this.buffer.getUint8(this.pos++);
            val = (val << 7) + (byte & 0x7F);
        } while (byte & 0x80);
        return val;
    }
}