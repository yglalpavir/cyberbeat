// Note/Beatmap Generator
function generateMidiBeatmap(midiData, difficulty) {
    const settings = CONFIG.difficulties[difficulty];
    const events = midiData.events;
    const notes = [];
    const windowSize = 1000;
    let recentVelocities = [];
    let consecutiveCount = [0, 0, 0, 0];
    let trillCount = 0;
    let lastTrack = -1;
    let lastHand = -1;
    let lastTimePerTrack = [-10000, -10000, -10000, -10000];
    let countPerTrack = [0, 0, 0, 0];
    let totalGenerated = 0;
    
    const getHand = (track) => track < 2 ? 0 : 1;
    
    const getLocalEnergy = (currentTime) => {
        recentVelocities = recentVelocities.filter(v => v.time > currentTime - windowSize);
        if (recentVelocities.length === 0) return 0.2;
        let sum = 0;
        recentVelocities.forEach(v => sum += v.vel);
        return (sum / recentVelocities.length) / 127.0;
    };
    
    events.sort((a, b) => a.time - b.time);
    
    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        const timeMs = event.time * 1000;
        recentVelocities.push({ time: timeMs, vel: event.velocity });
        
        const energy = getLocalEnergy(timeMs);
        const dynamicIntervalFactor = 1.5 - energy;
        const currentMinInterval = settings.interval * dynamicIntervalFactor;
        const currentTrackInterval = settings.trackInterval * dynamicIntervalFactor;
        const currentMaxDensity = Math.floor(settings.maxDensity * (0.5 + energy * 0.5));
        const velocityNorm = event.velocity / 127.0;
        
        // Skip low velocity notes
        if (velocityNorm < settings.energyThreshold) {
            if (energy < 0.6) continue;
            if (Math.random() > 0.3) continue;
        }
        
        // Check minimum interval
        if (notes.length > 0) {
            const lastNoteTime = notes[notes.length - 1].time;
            if (timeMs - lastNoteTime < currentMinInterval) {
                if (timeMs - lastNoteTime > 20 || velocityNorm < 0.8) continue;
            }
        }
        
        // Check density
        let windowStartIndex = notes.length - 1;
        while (windowStartIndex >= 0 && notes[windowStartIndex].time > timeMs - windowSize) {
            windowStartIndex--;
        }
        const notesInWindow = notes.length - windowStartIndex;
        if (notesInWindow >= currentMaxDensity) continue;
        
        // Find best track
        let candidates = [0, 1, 2, 3];
        let bestTrack = -1;
        let bestScore = -Infinity;
        const avgCount = totalGenerated / 4;
        
        for (const t of candidates) {
            let score = 0;
            
            if (timeMs - lastTimePerTrack[t] < currentTrackInterval) continue;
            if (consecutiveCount[t] >= CONFIG.maxJackLength) continue;
            
            const imbalance = countPerTrack[t] - avgCount;
            score -= imbalance * 25;
            score -= consecutiveCount[t] * 10;
            
            const hand = getHand(t);
            if (lastHand !== -1 && hand !== lastHand) score += 15;
            else score -= 5;
            
            const isTrill = (t !== lastTrack) && (hand === lastHand);
            if (isTrill && (trillCount + 1 >= CONFIG.maxTrillLength)) score -= 100;
            if (isTrill) score -= 5;
            
            score += Math.random() * 5;
            
            if (score > bestScore) {
                bestScore = score;
                bestTrack = t;
            }
        }
        
        if (bestTrack === -1) continue;
        
        // Update tracking variables
        const hand = getHand(bestTrack);
        const isTrill = (bestTrack !== lastTrack) && (hand === lastHand);
        
        for (let k = 0; k < 4; k++) {
            if (k === bestTrack) consecutiveCount[k]++;
            else consecutiveCount[k] = 0;
        }
        
        if (isTrill) trillCount++;
        else trillCount = 0;
        
        lastTrack = bestTrack;
        lastHand = hand;
        lastTimePerTrack[bestTrack] = timeMs;
        countPerTrack[bestTrack]++;
        totalGenerated++;
        
        notes.push({
            track: bestTrack,
            time: timeMs,
            y: -50,
            hit: false,
            type: 'tap'
        });
    }
    
    return notes;
}