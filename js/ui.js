// ==================== UI 管理器 ====================

class UIManager {
    constructor() {
        this.songLibraryLoaded = false;

        this.cacheDOMElements();
        this.setupEventListeners();
        this.loadSongLibrary();
        this.updateSpeedDisplay();
        this.updateStartButtons();

        // 初始化音量（0-10）
        this.setVolume(CONFIG.defaultVolume);
        if (this.volumeSlider) this.volumeSlider.value = CONFIG.defaultVolume;
        if (this.volumeValue) this.volumeValue.textContent = CONFIG.defaultVolume + '/10';
    }

    // ========== DOM 缓存 ==========
    cacheDOMElements() {
        // 屏幕
        this.startScreen   = document.getElementById('startScreen');
        this.settingsScreen = document.getElementById('settingsScreen');
        this.resultScreen  = document.getElementById('resultScreen');

        // 选中信息
        this.selectedSongName   = document.getElementById('selectedSongName');
        this.selectedSongSourceEl = document.getElementById('selectedSongSource');

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
        this.settingsSongMeta   = document.getElementById('settingsSongMeta');
        this.speedValue         = document.getElementById('speedValue');

        // 音量
        this.volumeSlider = document.getElementById('volumeSlider');
        this.volumeValue  = document.getElementById('volumeValue');

        // 结果面板
        this.rankDisplay    = document.getElementById('rankDisplay');
        this.finalScore     = document.getElementById('finalScore');
        this.finalCombo     = document.getElementById('finalCombo');
        this.finalAccuracy  = document.getElementById('finalAccuracy');
        this.finalPerfect   = document.getElementById('finalPerfect');
        this.finalGreat     = document.getElementById('finalGreat');
        this.finalMiss      = document.getElementById('finalMiss');
    }

    // ========== 事件绑定 ==========
    setupEventListeners() {
        // 开始按钮 (统一入口)
        this.startBtn.addEventListener('click', () => this.handleStartOrConfig());
        this.settingsBtn.addEventListener('click', () => this.handleStartOrConfig());

        // 设置面板内按钮
        this.settingsStartBtn.addEventListener('click', () => this.startGame());
        this.settingsBackBtn.addEventListener('click', () => this.hideSettings());

        // 结果面板
        this.homeBtn.addEventListener('click', () => this.goToHome());
        this.exportBtn.addEventListener('click', () => this.exportResults());

        // 速度
        const speedUpBtn = document.getElementById('speedUp');
        const speedDownBtn = document.getElementById('speedDown');
        if (speedUpBtn) {
            speedUpBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.changeSpeed(SPEED_STEP);
            });
        }
        if (speedDownBtn) {
            speedDownBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.changeSpeed(-SPEED_STEP);
            });
        }

        // 难度
        document.querySelectorAll('.diff-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setDifficulty(btn.dataset.diff);
            });
        });

        // 样式
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
        this.midiUpload.addEventListener('change', (e) => this.handleMidiImport(e));

        // 音量滑块
        if (this.volumeSlider) {
            this.volumeSlider.addEventListener('input', () => {
                const vol = parseInt(this.volumeSlider.value);
                this.setVolume(vol);
            });
        }

        // 键盘
        this.setupKeyboardControls();

        // 移动端
        this.setupMobileControls();

        // 禁止右键菜单
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
            if (this.songEmpty) this.songEmpty.style.display = 'flex';
        } else {
            if (this.songEmpty) this.songEmpty.style.display = 'none';
            songLibrary.forEach((song, index) => {
                const card = this.createSongCard(song, index);
                this.songCards.appendChild(card);
            });
        }

        this.updateAllHighlights();
    }

    createSongCard(song, index) {
        const card = document.createElement('div');
        card.className = 'song-card';
        card.dataset.songIndex = index;

        card.innerHTML = `
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
                <div class="card-arrow">→</div>
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

    // ========== 选曲逻辑 ==========
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
                // 根据导入的 MIDI 文件名生成 title（去掉扩展名）
                selectedSongDisplayName = file.name.replace(/\.midi?$/i, '');

                this.updateSelectionDisplay();
                this.updateAllHighlights();
                this.updateStartButtons();

                event.target.value = ''; // 允许重新选择相同文件
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
            this.selectedSongName.style.color = 'var(--accent)';
            this.selectedSongSourceEl.textContent = 'LIBRARY';
            this.selectedSongSourceEl.style.color = '';
        } else if (selectedSongSource === 'import' && importedMidiFileName) {
            this.selectedSongName.textContent = importedMidiFileName;
            this.selectedSongName.style.color = 'var(--orange)';
            this.selectedSongSourceEl.textContent = 'IMPORTED';
            this.selectedSongSourceEl.style.color = 'var(--orange)';
        } else {
            this.selectedSongName.textContent = 'NONE';
            this.selectedSongName.style.color = '';
            this.selectedSongSourceEl.textContent = '';
        }
    }

    updateAllHighlights() {
        // 导入卡片
        this.importMidiCard.classList.toggle('selected', selectedSongSource === 'import');

        // 曲库卡片
        const cards = this.songCards.querySelectorAll('.song-card');
        cards.forEach(card => {
            const idx = parseInt(card.dataset.songIndex);
            const isSelected = selectedSongSource === 'library' &&
                selectedLibrarySong &&
                songLibrary[idx] === selectedLibrarySong;
            card.classList.toggle('selected', isSelected);
        });
    }

    updateStartButtons() {
        const hasSelection = selectedSongSource !== null;
        this.startBtn.disabled = !hasSelection;
        this.settingsBtn.disabled = !hasSelection;
    }

    // ========== 启动流程 ==========
    async handleStartOrConfig() {
        if (!selectedSongSource) return;

        // 如果选中的是曲库歌曲，需要先加载 MIDI
        if (selectedSongSource === 'library' && selectedLibrarySong) {
            const loaded = await this.loadLibraryMidi();
            if (!loaded) return;
        }

        if (!loadedMidiData) {
            alert('No MIDI data available. Please select a song or import a MIDI file.');
            return;
        }

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

            // 根据 MIDI 文件内容计算 bpm 和 duration，更新 song 对象
            if (loadedMidiData) {
                song.bpm = computeAverageBpm(loadedMidiData);
                song.duration = formatDuration(loadedMidiData.duration);
            }

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

        // 显示从 MIDI 计算的 BPM 和时长
        if (loadedMidiData) {
            const bpm = computeAverageBpm(loadedMidiData);
            const dur = formatDuration(loadedMidiData.duration);
            this.settingsSongMeta.textContent = `BPM ${bpm}  •  ${dur}`;
        } else {
            this.settingsSongMeta.textContent = '';
        }

        // 根据歌曲的 difficulties 字段过滤难度按钮
        this.filterDifficultyButtons();

        this.startScreen.classList.add('hidden');
        this.settingsScreen.classList.remove('hidden');
    }

    /**
     * 根据当前选中歌曲的 difficulties 数组，启用/禁用难度按钮
     * 导入的 MIDI 文件默认允许全部难度
     */
    filterDifficultyButtons() {
        let allowedDiffs = null;

        if (selectedSongSource === 'library' && selectedLibrarySong
            && selectedLibrarySong.difficulties && selectedLibrarySong.difficulties.length > 0) {
            allowedDiffs = selectedLibrarySong.difficulties;
        }
        // 导入的 MIDI 或空 difficulties 数组不限制难度（allowedDiffs 为 null 表示全部允许）

        const diffBtns = document.querySelectorAll('.diff-btn');
        let firstAvailable = null;

        diffBtns.forEach(btn => {
            const diff = btn.dataset.diff;
            const isAllowed = !allowedDiffs || allowedDiffs.includes(diff);
            btn.disabled = !isAllowed;
            btn.classList.toggle('disabled', !isAllowed);

            if (isAllowed && !firstAvailable) {
                firstAvailable = diff;
            }
        });

        // 如果当前选中的难度不在允许列表中，自动切换到第一个可用难度
        const currentAllowed = !allowedDiffs || allowedDiffs.includes(selectedDifficulty);
        if (!currentAllowed && firstAvailable) {
            this.setDifficulty(firstAvailable);
        }
    }

    hideSettings() {
        this.settingsScreen.classList.add('hidden');
        this.startScreen.classList.remove('hidden');
    }

    // ========== 游戏开始 ==========
    startGame() {
        if (!selectedSongSource) {
            alert('Please select a song first.');
            return;
        }

        if (!loadedMidiData) {
            alert('No MIDI data loaded. Please select a song or import a MIDI file first.');
            return;
        }

        // 隐藏所有 UI
        this.startScreen.classList.add('hidden');
        this.settingsScreen.classList.add('hidden');
        this.resultScreen.classList.add('hidden');

        // 生成谱面
        const notes = generateMidiBeatmap(loadedMidiData, selectedDifficulty);

        // 重置游戏状态
        gameState.reset();

        // 设置未来时间实现倒计时（谱面时间从倒计时结束时开始计算）
        const countdownMs = CONFIG.countdownDuration;
        gameState.startTime = performance.now() + countdownMs;

        // 手动设置游戏状态（不使用 initForGame 以兼容倒计时）
        gameState.screen = 'game';
        gameState.notes = notes;
        gameState.isPlaying = true;
        gameState.intervalStartTime = performance.now() + countdownMs;

        // 延迟启动 MIDI 音乐
        setTimeout(() => {
            audioEngine.startMidiMusic([...loadedMidiData.events]);
        }, countdownMs);

        // 确保 Canvas 尺寸正确
        if (renderer) {
            renderer.resize();
        }

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

        if (renderer) {
            renderer.drawLineChart(gameState.performanceHistory);
        }

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
        // 关键：更新全局 noteStyle 变量
        noteStyle = style;

        // 更新按钮的 active 状态
        document.querySelectorAll('.style-btn').forEach(b => b.classList.remove('active'));
        const btn = document.querySelector(`.style-btn[data-style="${style}"]`);
        if (btn) btn.classList.add('active');
    }

    updateSpeedDisplay() {
        if (this.speedValue) {
            this.speedValue.textContent = noteSpeed.toFixed(1);
        }
    }

    // ========== 音量控制 ==========
    setVolume(level) {
        // 限制在 0-10 范围
        currentVolume = Math.max(0, Math.min(10, level));

        // 同步到音频引擎
        audioEngine.setVolume(currentVolume);

        // 更新显示
        if (this.volumeValue) {
            this.volumeValue.textContent = currentVolume + '/10';
        }
    }

    // ========== 键盘控制 ==========
    setupKeyboardControls() {
        document.addEventListener('keydown', (e) => {
            // 忽略在输入框内的按键
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            const key = e.key.toLowerCase();

            // 开始画面按 Enter
            if (gameState.screen === 'start' && key === 'enter') {
                e.preventDefault();
                this.handleStartOrConfig();
                return;
            }

            // 游戏中的按键
            if (gameState.screen === 'game') {
                // 空格键快速结束（双击）
                if (key === ' ') {
                    e.preventDefault();
                    const now = performance.now();
                    if (now - gameState.lastSpacePressTime < 400) {
                        this.endGame();
                        return;
                    }
                    gameState.lastSpacePressTime = now;
                }

                // 轨道按键
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
        if (!renderer) return false;

        const judgmentY = renderer.canvasHeight * CONFIG.judgmentLineY;
        const currentTime = performance.now() - gameState.startTime;

        // 倒计时期间不判定
        if (currentTime < 0) return false;

        for (let i = 0; i < gameState.notes.length; i++) {
            const note = gameState.notes[i];
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

                renderer.createHitParticles(judgmentY, track, isPerfect ? '#ffd43b' : '#69db7c');
                renderer.createLaser(track);
                return true;
            }
        }
        return false;
    }
}