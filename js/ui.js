// UI Management
class UIManager {
    constructor() {
        this.setupButtons();
        this.setupFileInput();
        this.setupMobileControls();
        this.setupKeyboardControls();
        this.updateMainDisplay();
        this.updateSpeedDisplay();
    }
    
    setupButtons() {
        document.getElementById('startBtn').addEventListener('click', () => this.startGame());
        document.getElementById('homeBtn').addEventListener('click', () => this.goToHome());
        document.getElementById('exportBtn').addEventListener('click', () => this.exportResults());
        document.getElementById('settingsBtn').addEventListener('click', () => this.showSettings());
        document.getElementById('backBtn').addEventListener('click', () => this.hideSettings());
        
        // Speed controls
        document.getElementById('speedUp').addEventListener('click', (e) => {
            e.stopPropagation();
            this.changeSpeed(SPEED_STEP);
        });
        
        document.getElementById('speedDown').addEventListener('click', (e) => {
            e.stopPropagation();
            this.changeSpeed(-SPEED_STEP);
        });
        
        // Difficulty buttons
        document.querySelectorAll('.diff-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setDifficulty(btn.dataset.diff);
            });
        });
        
        // Style buttons
        document.querySelectorAll('.style-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setNoteStyle(btn.dataset.style);
            });
        });
        
        // Mode buttons
        document.getElementById('modePreset').addEventListener('click', () => this.setMode('preset'));
        document.getElementById('modeCustom').addEventListener('click', () => this.setMode('custom'));
    }
    
    setupFileInput() {
        const fileInput = document.getElementById('midiUpload');
        const fileNameDisplay = document.getElementById('fileName');
        
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            fileNameDisplay.textContent = file.name;
            const reader = new FileReader();
            
            reader.onload = (event) => {
                try {
                    const parser = new MidiParser(event.target.result);
                    loadedMidiData = parser.parse();
                    fileNameDisplay.style.color = 'var(--pixel-green)';
                    fileNameDisplay.textContent = 'READY: ' + file.name;
                } catch (err) {
                    console.error(err);
                    fileNameDisplay.style.color = 'var(--pixel-red)';
                    fileNameDisplay.textContent = "ERROR";
                    loadedMidiData = null;
                }
            };
            
            reader.readAsArrayBuffer(file);
        });
    }
    
    setupMobileControls() {
        const mobileBtns = document.querySelectorAll('.mobile-btn');
        mobileBtns.forEach((btn, index) => {
            btn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                btn.classList.add('active');
                gameState.pressedKeys.add(KEYS[index]);
                
                if (gameState.screen === 'start') {
                    this.startGame();
                } else if (gameState.screen === 'game') {
                    this.checkHit(index);
                }
            });
            
            btn.addEventListener('touchend', (e) => {
                e.preventDefault();
                btn.classList.remove('active');
                gameState.pressedKeys.delete(KEYS[index]);
            });
        });
    }
    
    setupKeyboardControls() {
        document.addEventListener('keydown', (e) => {
            const key = e.key.toLowerCase();
            
            if (gameState.screen === 'start' && (key === 'enter' || key === ' ')) {
                e.preventDefault();
                this.startGame();
                return;
            }
            
            if (gameState.screen === 'game') {
                if (key === ' ') {
                    e.preventDefault();
                    const now = performance.now();
                    if (now - gameState.lastSpacePressTime < 400) {
                        this.endGame();
                        return;
                    }
                    gameState.lastSpacePressTime = now;
                }
                
                const trackIndex = KEYS.indexOf(key);
                if (trackIndex !== -1 && !gameState.pressedKeys.has(key)) {
                    gameState.pressedKeys.add(key);
                    this.checkHit(trackIndex);
                }
            }
        });
        
        document.addEventListener('keyup', (e) => {
            const key = e.key.toLowerCase();
            gameState.pressedKeys.delete(key);
        });
        
        document.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    
    checkHit(track) {
        const judgmentY = renderer.canvasHeight * CONFIG.judgmentLineY;
        const currentTime = performance.now() - gameState.startTime;
        
        for (const note of gameState.notes) {
            if (note.track !== track || note.hit) continue;
            
            const timeDiff = Math.abs(currentTime - note.time);
            if (timeDiff <= CONFIG.greatWindow) {
                note.hit = true;
                const isPerfect = timeDiff <= CONFIG.perfectWindow;
                
                if (isPerfect) {
                    gameState.perfect++;
                    gameState.intervalStats.perfect++;
                    gameState.score += 100 * (1 + gameState.combo * 0.1);
                    renderer.addJudgment('PERFECT', judgmentY, track);
                    audioEngine.playHitSound('perfect');
                } else {
                    gameState.great++;
                    gameState.intervalStats.great++;
                    gameState.score += 50 * (1 + gameState.combo * 0.05);
                    renderer.addJudgment('GREAT', judgmentY, track);
                    audioEngine.playHitSound('great');
                }
                
                gameState.combo++;
                gameState.maxCombo = Math.max(gameState.maxCombo, gameState.combo);
                gameState.health = Math.min(100, gameState.health + 2);
                
                renderer.createHitParticles(judgmentY, track, isPerfect ? '#ffef5e' : '#89d868');
                renderer.createLaser(track);
                return true;
            }
        }
        
        return false;
    }
    
    startGame() {
        if (gameMode === 'custom' && !loadedMidiData) {
            alert("Please load a MIDI file first!");
            return;
        }
        
        let notes;
        let duration;
        
        if (gameMode === 'preset') {
            notes = generatePresetBeatmap(selectedDifficulty);
            duration = CONFIG.songDuration;
            audioEngine.startPresetMusic();
        } else {
            notes = generateMidiBeatmap(loadedMidiData, selectedDifficulty);
            duration = loadedMidiData.duration * 1000;
            audioEngine.startMidiMusic(loadedMidiData.events);
        }
        
        gameState.reset();
        gameState.initForGame(notes);
        
        document.getElementById('startScreen').classList.add('hidden');
        document.getElementById('settingsScreen').classList.add('hidden');
        document.getElementById('resultScreen').classList.add('hidden');
        
        requestAnimationFrame(gameLoop);
    }
    
    endGame() {
        gameState.screen = 'result';
        gameState.isPlaying = false;
        audioEngine.stopMusic();
        gameState.recordIntervalStats();
        
        const accuracy = gameState.calculateTotalAcc();
        let rank = 'C';
        if (accuracy >= 95 && gameState.miss === 0) rank = 'S';
        else if (accuracy >= 85) rank = 'A';
        else if (accuracy >= 70) rank = 'B';
        
        document.getElementById('rankDisplay').textContent = rank;
        document.getElementById('rankDisplay').className = 'rank rank-' + rank.toLowerCase();
        document.getElementById('finalScore').textContent = gameState.score.toLocaleString();
        document.getElementById('finalCombo').textContent = gameState.maxCombo;
        document.getElementById('finalAccuracy').textContent = accuracy.toFixed(2) + '%';
        document.getElementById('finalPerfect').textContent = gameState.perfect;
        document.getElementById('finalGreat').textContent = gameState.great;
        document.getElementById('finalMiss').textContent = gameState.miss;
        
        renderer.drawLineChart(gameState.performanceHistory);
        document.getElementById('resultScreen').classList.remove('hidden');
    }
    
    goToHome() {
        window.location.reload();
    }
    
    exportResults() {
        const accuracy = gameState.calculateTotalAcc();
        let rank = 'C';
        if (accuracy >= 95 && gameState.miss === 0) rank = 'S';
        else if (accuracy >= 85) rank = 'A';
        else if (accuracy >= 70) rank = 'B';
        
        const now = new Date();
        const dateStr = now.toLocaleDateString();
        const timeStr = now.toLocaleTimeString();
        
        let content = "============================\n";
        content += "      CYBER BEAT RESULT\n";
        content += "============================\n\n";
        content += `DATE: ${dateStr} ${timeStr}\n`;
        content += `MODE: ${gameMode.toUpperCase()}\n`;
        content += `DIFFICULTY: ${selectedDifficulty.toUpperCase()}\n`;
        content += `STYLE: ${noteStyle.toUpperCase()}\n`;
        content += `SPEED: ${noteSpeed.toFixed(1)}\n\n`;
        content += "----------------------------\n";
        content += "SCORE:      " + gameState.score.toLocaleString() + "\n";
        content += "MAX COMBO:  " + gameState.maxCombo + "\n";
        content += "ACCURACY:   " + accuracy.toFixed(2) + "%\n";
        content += "RANK:       " + rank + "\n\n";
        content += "PERFECT:    " + gameState.perfect + "\n";
        content += "GREAT:      " + gameState.great + "\n";
        content += "MISS:       " + gameState.miss + "\n";
        content += "============================\n";
        content += "      THANKS FOR PLAYING\n";
        content += "============================\n";
        
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `CyberBeat_Result_${now.getTime()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    
    showSettings() {
        document.getElementById('startScreen').classList.add('hidden');
        document.getElementById('settingsScreen').classList.remove('hidden');
    }
    
    hideSettings() {
        document.getElementById('settingsScreen').classList.add('hidden');
        document.getElementById('startScreen').classList.remove('hidden');
    }
    
    changeSpeed(delta) {
        noteSpeed += delta;
        noteSpeed = Math.round(noteSpeed * 10) / 10;
        noteSpeed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, noteSpeed));
        this.updateSpeedDisplay();
    }
    
    setDifficulty(diff) {
        selectedDifficulty = diff;
        document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
        document.querySelector(`.diff-btn[data-diff="${diff}"]`).classList.add('active');
        this.updateMainDisplay();
    }
    
    setNoteStyle(style) {
        noteStyle = style;
        document.querySelectorAll('.style-btn').forEach(b => b.classList.remove('active'));
        document.querySelector(`.style-btn[data-style="${style}"]`).classList.add('active');
    }
    
    setMode(mode) {
        gameMode = mode;
        this.updateMainDisplay();
    }
    
    updateMainDisplay() {
        document.getElementById('displayMode').textContent = gameMode.toUpperCase();
        document.getElementById('displayDiff').textContent = selectedDifficulty.toUpperCase().replace('+', '+');
        
        const midiSection = document.getElementById('midiSection');
        const fileName = document.getElementById('fileName');
        
        if (gameMode === 'custom') {
            midiSection.style.display = 'flex';
            fileName.style.display = 'block';
        } else {
            midiSection.style.display = 'none';
            fileName.style.display = 'none';
        }
        
        // Update mode buttons
        document.getElementById('modePreset').classList.toggle('pink', gameMode === 'preset');
        document.getElementById('modeCustom').classList.toggle('pink', gameMode === 'custom');
        
        if (gameMode === 'preset') {
            document.getElementById('modePreset').classList.remove('dark');
            document.getElementById('modeCustom').classList.add('dark');
        } else {
            document.getElementById('modePreset').classList.add('dark');
            document.getElementById('modeCustom').classList.remove('dark');
        }
    }
    
    updateSpeedDisplay() {
        document.getElementById('speedValue').textContent = noteSpeed.toFixed(1);
    }
}