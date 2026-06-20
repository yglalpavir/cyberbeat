// ==================== UI 管理器 ====================

class UIManager {
    constructor() {
        this.songLibraryLoaded = false;
        
        this.cacheDOMElements();
        this.setupEventListeners();
        this.loadSongLibrary();
        this.updateSpeedDisplay();
        this.updateStartButtons();
    }
    
    // ========== DOM 缓存 ==========
    
    cacheDOMElements() {
        // 屏幕
        this.startScreen   = document.getElementById('startScreen');
        this.settingsScreen = document.getElementById('settingsScreen');
        this.resultScreen  = document.getElementById('resultScreen');
        
        // 选中信息
        this.selectedSongName   = document.getElementById('selectedSongName');
        this.selectedSongSource = document.getElementById('selectedSongSource');
        
        // 曲库
        this.songCards  = document.getElementById('songCards');
        this.songEmpty  = document.getElementById('songEmpty');
        this.songCount  = document.getElementById('songCount');
        
        // 导入
        this.importMidiCard = document.getElementById('importMidiCard');
        this.midiUpload     = document.getElementById('midiUpload');
        
        // 按钮
        this.startBtn         = document.getElementById('startBtn');
        this.settingsBtn      = document.getElementById('settingsBtn');
        this.settingsStartBtn = document.getElementById('settingsStartBtn');
        this.settingsBackBtn  = document.getElementById('settingsBackBtn');
        this.homeBtn          = document.getElementById('homeBtn');
        this.exportBtn        = document.getElementById('exportBtn');
        
        // 设置面板
        this.settingsSongTitle  = document.getElementById('settingsSongTitle');
        this.settingsSongArtist = document.getElementById('settingsSongArtist');
        this.speedValue         = document.getElementById('speedValue');
        
        // 结果面板
        this.rankDisplay    = document.getElementById('rankDisplay');
        this.finalScore     = document.getElementById('finalScore');
        this.finalCombo     = document.getElementById('finalCombo');
        this.finalAccuracy  = document.getElementById('finalAccuracy');
        this.finalPerfect   = document.getElementById('finalPerfect');
        this.finalGreat     = document.getElementById('finalGreat');
        this.finalMiss      = document.getElementById('finalMiss');
    }
    
    // ========== 事件监听 ==========
    
    setupEventListeners() {
        // START / CONFIG 按钮
        this.startBtn.addEventListener('click', () => this.handleStartOrConfig());
        this.settingsBtn.addEventListener('click', () => this.handleStartOrConfig());
        this.settingsStartBtn.addEventListener('click', () => this.startGame());
        this.settingsBackBtn.addEventListener('click', () => this.hideSettings());
        
        // 结果按钮
        this.homeBtn.addEventListener('click', () => this.goToHome());
        this.exportBtn.addEventListener('click', () => this.exportResults());
        
        // 速度
        document.getElementById('speedUp').addEventListener('click', (e) => {
            e.stopPropagation();
            this.changeSpeed(SPEED_STEP);
        });
        document.getElementById('speedDown').addEventListener('click', (e) => {
            e.stopPropagation();
            this.changeSpeed(-SPEED_STEP);
        });
        
        // 难度按钮
        document.querySelectorAll('.diff-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setDifficulty(btn.dataset.diff);
            });
        });
        
        // 样式按钮
        document.querySelectorAll('.style-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setNoteStyle(btn.dataset.style);
            });
        });
        
        // 导入 MIDI 卡片点击 → 触发 file input
        this.importMidiCard.addEventListener('click', (e) => {
            if (e.target !== this.midiUpload) {
                this.midiUpload.click();
            }
        });
        
        // 文件选择
        this.midiUpload.addEventListener('change', (e) => this.handleMidiImport(e));
        
        // 键盘
        this.setupKeyboardControls();
        
        // 移动端
        this.setupMobileControls();
        
        // 禁止右键
        document.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    
    // ========== 曲库加载 ==========
    
    async loadSongLibrary() {
        try {
            const response = await fetch(CONFIG.songListUrl);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            songLibrary = data.songs || [];
        } catch (err) {
            console.error('Failed to load song library:', err);
            songLibrary = [];
        } finally {
            this.songLibraryLoaded = true;
            this.renderSongList();
        }
    }
    
    renderSongList() {
        if (!this.songCards) return;
        
        this.songCount.textContent = `${songLibrary.length} TRACKS`;
        this.songCards.innerHTML = '';
        
        if (songLibrary.length === 0) {
            this.songEmpty.style.display = 'flex';
        } else {
            this.songEmpty.style.display = 'none';
            songLibrary.forEach((song, index) => {
                const card = this.createSongCard(song, index);
                this.songCards.appendChild(card);
            });
        }
        
        // 恢复选中高亮
        this.updateAllHighlights();
    }
    
    createSongCard(song, index) {
        const card = document.createElement('div');
        card.className = 'song-card';
        card.dataset.songIndex = index;
        
        card.innerHTML = `
            <div class="card-accent"></div>
            <div class="card-body">
                <div class="card-icon">🎵</div>
                <div class="card-info">
                    <span class="card-title">${this.escapeHTML(song.title || 'Unknown')}</span>
                    <span class="card-sub">${this.escapeHTML(song.artist || 'Unknown Artist')}</span>
                </div>
                <div class="card-meta">
                    ${song.bpm ? `<span class="card-bpm">BPM ${song.bpm}</span>` : ''}
                    ${song.duration ? `<span class="card-duration">${this.escapeHTML(song.duration)}</span>` : ''}
                </div>
                <div class="card-arrow">▶</div>
            </div>
        `;
        
        card.addEventListener('click', () => this.selectLibrarySong(song, index));
        return card;
    }
    
    escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
    
    // ========== 选曲 ==========
    
    selectLibrarySong(song, index) {
        selectedSongSource = 'library';
        selectedLibrarySong = song;
        loadedMidiData = null;
        importedMidiFileName = null;
        selectedSongDisplayName = song.title;
        
        this.updateSelectionDisplay();
        this.updateAllHighlights();
        this.updateStartButtons();
    }
    
    handleMidiImport(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        importedMidiFileName = file.name;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const parser = new MidiParser(e.target.result);
                loadedMidiData = parser.parse();
                
                selectedSongSource = 'import';
                selectedLibrarySong = null;
                selectedSongDisplayName = file.name;
                
                this.updateSelectionDisplay();
                this.updateAllHighlights();
                this.updateStartButtons();
                
                // 清除 input 以允许重复导入同一文件
                event.target.value = '';
                
            } catch (err) {
                console.error('MIDI parse error:', err);
                alert('Failed to parse MIDI file.\nPlease ensure it is a valid Standard MIDI File.');
                this.clearSelection();
                event.target.value = '';
            }
        };
        
        reader.onerror = () => {
            alert('Failed to read file.');
            this.clearSelection();
            event.target.value = '';
        };
        
        reader.readAsArrayBuffer(file);
    }
    
    clearSelection() {
        selectedSongSource = null;
        selectedLibrarySong = null;
        loadedMidiData = null;
        importedMidiFileName = null;
        selectedSongDisplayName = null;
        
        this.updateSelectionDisplay();
        this.updateAllHighlights();
        this.updateStartButtons();
    }
    
    updateSelectionDisplay() {
        if (selectedSongSource === 'library' && selectedLibrarySong) {
            this.selectedSongName.textContent = selectedLibrarySong.title;
            this.selectedSongName.style.color = 'var(--pixel-cyan)';
            this.selectedSongSource.textContent = 'LIBRARY';
            this.selectedSongSource.style.color = '';
        } else if (selectedSongSource === 'import' && importedMidiFileName) {
            this.selectedSongName.textContent = importedMidiFileName;
            this.selectedSongName.style.color = 'var(--import-accent)';
            this.selectedSongSource.textContent = 'IMPORTED';
            this.selectedSongSource.style.color = 'var(--import-accent)';
        } else {
            this.selectedSongName.textContent = 'NONE';
            this.selectedSongName.style.color = '';
            this.selectedSongSource.textContent = '';
        }
    }
    
    updateAllHighlights() {
        // 导入卡片
        this.importMidiCard.classList.toggle('selected-song', selectedSongSource === 'import');
        
        // 曲库卡片
        const cards = this.songCards.querySelectorAll('.song-card');
        cards.forEach(card => {
            const idx = parseInt(card.dataset.songIndex);
            const isSelected = selectedSongSource === 'library' 
                && selectedLibrarySong 
                && songLibrary[idx] === selectedLibrarySong;
            card.classList.toggle('selected-song', isSelected);
        });
    }
    
    updateStartButtons() {
        const hasSelection = selectedSongSource !== null;
        this.startBtn.disabled = !hasSelection;
        this.settingsBtn.disabled = !hasSelection;
    }
    
    // ========== 启动流程 (核心修复) ==========
    
    /**
     * handleStartOrConfig - 统一的入口处理
     * 流程：
     *   1. 如果已选曲库歌曲 → 先加载 MIDI，再打开设置面板
     *   2. 如果已导入 MIDI → 直接打开设置面板
     *   3. 如果未选择 → 不执行（按钮已禁用）
     */
    async handleStartOrConfig() {
        if (!selectedSongSource) return;
        
        if (selectedSongSource === 'library' && selectedLibrarySong) {
            // 加载曲库 MIDI
            const loaded = await this.loadLibraryMidi();
            if (!loaded) return; // 加载失败
        }
        
        // 打开设置面板
        this.showSettings();
    }
    
    async loadLibraryMidi() {
        const song = selectedLibrarySong;
        const filePath = CONFIG.songBasePath + song.file;
        
        try {
            const response = await fetch(filePath);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const arrayBuffer = await response.arrayBuffer();
            const parser = new MidiParser(arrayBuffer);
            loadedMidiData = parser.parse();
            return true;
            
        } catch (err) {
            console.error('Failed to load MIDI:', err);
            alert(`Failed to load: ${song.title}\nPlease check that the MIDI file exists at:\n${filePath}`);
            return false;
        }
    }
    
    showSettings() {
        if (!selectedSongSource) return;
        
        // 更新设置面板的歌曲信息
        if (selectedSongSource === 'library' && selectedLibrarySong) {
            this.settingsSongTitle.textContent = selectedLibrarySong.title;
            this.settingsSongArtist.textContent = selectedLibrarySong.artist || '';
        } else if (selectedSongSource === 'import') {
            this.settingsSongTitle.textContent = importedMidiFileName || 'Imported MIDI';
            this.settingsSongArtist.textContent = 'Custom Import';
        }
        
        this.startScreen.classList.add('hidden');
        this.settingsScreen.classList.remove('hidden');
    }
    
    hideSettings() {
        this.settingsScreen.classList.add('hidden');
        this.startScreen.classList.remove('hidden');
    }
    
    // ========== 游戏开始 (从设置面板触发) ==========
    
    startGame() {
        if (!selectedSongSource) return;
        if (!loadedMidiData) {
            alert('No MIDI data loaded. Please select a song first.');
            return;
        }
        
        // 隐藏所有 UI 面板
        this.startScreen.classList.add('hidden');
        this.settingsScreen.classList.add('hidden');
        this.resultScreen.classList.add('hidden');
        
        // 生成谱面
        const notes = generateMidiBeatmap(loadedMidiData, selectedDifficulty);
        
        // 重置游戏状态
        gameState.reset();
        gameState.initForGame(notes);
        
        // 启动 MIDI 音频
        audioEngine.startMidiMusic([...loadedMidiData.events]);
        
        // 启动游戏循环
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
        
        this.rankDisplay.textContent = rank;
        this.rankDisplay.className = 'rank';
        
        this.finalScore.textContent    = gameState.score.toLocaleString();
        this.finalCombo.textContent    = gameState.maxCombo;
        this.finalAccuracy.textContent = accuracy.toFixed(2) + '%';
        this.finalPerfect.textContent  = gameState.perfect;
        this.finalGreat.textContent    = gameState.great;
        this.finalMiss.textContent     = gameState.miss;
        
        renderer.drawLineChart(gameState.performanceHistory);
        this.resultScreen.classList.remove('hidden');
    }
    
    goToHome() {
        window.location.reload();
    }
    
    // ========== 成绩导出 ==========
    
    exportResults() {
        const accuracy = gameState.calculateTotalAcc();
        let rank = 'C';
        if (accuracy >= 95 && gameState.miss === 0) rank = 'S';
        else if (accuracy >= 85) rank = 'A';
        else if (accuracy >= 70) rank = 'B';
        
        const now = new Date();
        
        let content = "============================\n";
        content += "      CYBER BEAT RESULT\n";
        content += "============================\n\n";
        content += `DATE: ${now.toLocaleDateString()} ${now.toLocaleTimeString()}\n`;
        content += `SONG: ${selectedSongDisplayName || 'Unknown'}\n`;
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
    
    // ========== 设置变更 ==========
    
    changeSpeed(delta) {
        noteSpeed += delta;
        noteSpeed = Math.round(noteSpeed * 10) / 10;
        noteSpeed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, noteSpeed));
        this.updateSpeedDisplay();
    }
    
    setDifficulty(diff) {
        selectedDifficulty = diff;
        document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
        const btn = document.querySelector(`.diff-btn[data-diff="${diff}"]`);
        if (btn) btn.classList.add('active');
    }
    
    setNoteStyle(style) {
        noteStyle = style;
        document.querySelectorAll('.style-btn').forEach(b => b.classList.remove('active'));
        const btn = document.querySelector(`.style-btn[data-style="${style}"]`);
        if (btn) btn.classList.add('active');
    }
    
    updateSpeedDisplay() {
        if (this.speedValue) {
            this.speedValue.textContent = noteSpeed.toFixed(1);
        }
    }
    
    // ========== 键盘控制 ==========
    
    setupKeyboardControls() {
        document.addEventListener('keydown', (e) => {
            // 防止在输入框中触发
            if (e.target.tagName === 'INPUT') return;
            
            const key = e.key.toLowerCase();
            
            if (gameState.screen === 'start' && key === 'enter') {
                e.preventDefault();
                this.handleStartOrConfig();
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
    }
    
    // ========== 移动端控制 ==========
    
    setupMobileControls() {
        const mobileBtns = document.querySelectorAll('.mobile-btn');
        mobileBtns.forEach((btn, index) => {
            btn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                btn.classList.add('active');
                gameState.pressedKeys.add(KEYS[index]);
                
                if (gameState.screen === 'start') {
                    this.handleStartOrConfig();
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
    
    // ========== 打击判定 ==========
    
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
}