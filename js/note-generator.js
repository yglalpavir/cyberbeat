// Note/Beatmap Generator
function generatePresetBeatmap(difficulty) {
    const notes = [];
    const beatInterval = 60000 / CONFIG.bpm;
    const startTime = 2500;
    let time = startTime;
    let lastTracks = [];
    
    const patterns = {
        'easy': [
            [0], [1], [2], [3], [0, 2], [1, 3], [0, 1], [2, 3], [0], [3], [1], [2]
        ],
        'easy+': [
            [0], [1], [2], [3], [0, 2], [1, 3], [0, 3], [1, 2],
            [0, 1, 2], [1, 2, 3], [0, 1, 3], [0, 2, 3],
            [0, 1], [2, 3], [0, 1, 2, 3], [0, 2], [1, 3], [0], [2]
        ],
        'normal': [
            [0], [1], [2], [3], [0, 2], [1, 3], [0, 3], [1, 2],
            [0, 1, 2], [1, 2, 3], [0, 1, 3], [0, 2, 3],
            [0, 1, 2, 3], [0, 1, 2, 3], [0, 1], [2, 3],
            [0, 1], [2, 3], [0, 3], [1, 2], [0, 2], [1, 3]
        ]
    };
    
    while (time < CONFIG.songDuration) {
        let pattern;
        let timeStepMultiplier = 1.0;
        
        if (difficulty === 'easy') {
            pattern = patterns.easy[Math.floor(Math.random() * patterns.easy.length)];
            timeStepMultiplier = (Math.random() < 0.3) ? 0.5 : 1.0;
            lastTracks = pattern;
        } else if (difficulty === 'easy+') {
            pattern = patterns['easy+'][Math.floor(Math.random() * patterns['easy+'].length)];
            timeStepMultiplier = (Math.random() < 0.5) ? 0.5 : 1.0;
            lastTracks = pattern;
        } else if (difficulty === 'normal') {
            pattern = patterns.normal[Math.floor(Math.random() * patterns.normal.length)];
            timeStepMultiplier = (Math.random() < 0.7) ? 0.5 : 1.0;
            lastTracks = pattern;
        } else if (difficulty === 'normal+') {
            // Dynamic generation for highest difficulty
            const rand = Math.random();
            let chosenTracks = [];
            let available = [0, 1, 2, 3].filter(t => !lastTracks.includes(t));
            
            if (available.length === 0) available = [0, 1, 2, 3];
            
            if (rand < 0.7) {
                const note = available[Math.floor(Math.random() * available.length)];
                chosenTracks = [note];
                timeStepMultiplier = 0.25;
            } else {
                const count = Math.random() < 0.8 ? 2 : 3;
                const actualCount = Math.min(count, available.length);
                
                // Shuffle available tracks
                for (let i = available.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [available[i], available[j]] = [available[j], available[i]];
                }
                
                chosenTracks = available.slice(0, actualCount);
                timeStepMultiplier = 0.5;
            }
            
            pattern = chosenTracks;
            lastTracks = chosenTracks;
        }
        
        for (const track of pattern) {
            notes.push({
                track,
                time,
                y: -50,
                hit: false,
                type: 'tap'
            });
        }
        
        time += beatInterval * timeStepMultiplier;
    }
    
    return notes;
}

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