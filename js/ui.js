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

        // 曲库（分 MIDI / SONGS 两个标签页）
        this.songCardsMidi  = document.getElementById('songCardsMidi');
        this.songCardsSongs = document.getElementById('songCardsSongs');
        this.songEmptyMidi  = document.getElementById('songEmptyMidi');
        this.songEmptySongs = document.getElementById('songEmptySongs');
        this.songCount      = document.getElementById('songCount');

        // 标签页
        this.tabMidi        = document.getElementById('tabMidi');
        this.tabSongs       = document.getElementById('tabSongs');
        this.tabContentMidi = document.getElementById('tabContentMidi');
        this.tabContentSongs= document.getElementById('tabContentSongs');
        this.activeTab      = 'midi';  // 当前活跃标签页

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
        this.difficultyGroup    = document.getElementById('difficultyGroup');
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

        // 标签页切换
        this.tabMidi.addEventListener('click', () => this.switchTab('midi'));
        this.tabSongs.addEventListener('click', () => this.switchTab('songs'));

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

    /**
     * 从 songLibrary 中筛选 MIDI 歌曲（beatmapType 不是 "mc" 的，包括 .mid）
     */
    _getMidiSongs() {
        return songLibrary.filter(s => !s.beatmapType || s.beatmapType !== 'mc');
    }

    /**
     * 从 songLibrary 中筛选 MC 谱面歌曲（beatmapType === 'mc'）
     */
    _getMcSongs() {
        return songLibrary.filter(s => s.beatmapType === 'mc');
    }

    renderSongList() {
        if (!this.songCardsMidi || !this.songCardsSongs) return;

        const midiSongs = this._getMidiSongs();
        const mcSongs = this._getMcSongs();

        // 更新计数（显示当前活跃标签页的曲目数）
        this._updateTabCount();

        // --- MIDI 标签页 ---
        this.songCardsMidi.innerHTML = '';
        if (midiSongs.length === 0) {
            if (this.songEmptyMidi) this.songEmptyMidi.style.display = 'flex';
        } else {
            if (this.songEmptyMidi) this.songEmptyMidi.style.display = 'none';
            midiSongs.forEach((song) => {
                const realIndex = songLibrary.indexOf(song);
                const card = this.createSongCard(song, realIndex);
                this.songCardsMidi.appendChild(card);
            });
        }

        // --- SONGS 标签页 ---
        this.songCardsSongs.innerHTML = '';
        if (mcSongs.length === 0) {
            if (this.songEmptySongs) this.songEmptySongs.style.display = 'flex';
        } else {
            if (this.songEmptySongs) this.songEmptySongs.style.display = 'none';
            mcSongs.forEach((song) => {
                const realIndex = songLibrary.indexOf(song);
                const card = this.createSongCard(song, realIndex);
                this.songCardsSongs.appendChild(card);
            });
        }

        this.updateAllHighlights();
    }

    /**
     * 切换标签页
     */
    switchTab(tab) {
        if (this.activeTab === tab) return;
        this.activeTab = tab;

        // 更新标签按钮状态
        this.tabMidi.classList.toggle('active', tab === 'midi');
        this.tabSongs.classList.toggle('active', tab === 'songs');

        // 切换内容区域
        this.tabContentMidi.classList.toggle('active', tab === 'midi');
        this.tabContentSongs.classList.toggle('active', tab === 'songs');

        // 更新计数
        this._updateTabCount();

        // 如果当前选中的歌曲不在活跃标签页中，清除选中
        if (selectedSongSource === 'library' && selectedLibrarySong) {
            const isMcSelected = selectedLibrarySong.beatmapType === 'mc';
            if ((tab === 'midi' && isMcSelected) || (tab === 'songs' && !isMcSelected)) {
                this.clearSelection();
            }
        }
        if (selectedSongSource === 'import' && tab === 'songs') {
            this.clearSelection();
        }
    }

    /**
     * 更新标签页曲目计数
     */
    _updateTabCount() {
        const midiSongs = this._getMidiSongs();
        const mcSongs = this._getMcSongs();
        const count = this.activeTab === 'midi' ? midiSongs.length : mcSongs.length;
        this.songCount.textContent = `${count} TRACKS`;
    }

    createSongCard(song, index) {
        const card = document.createElement('div');
        card.className = 'song-card';
        card.dataset.songIndex = index;

        // 难度徽章（右侧显示；MIDI 多难度时为一个容器包裹多个徽章）
        const levelBadgeHTML = this.buildLevelBadge(song);

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
                ${levelBadgeHTML}
                <div class="card-arrow">→</div>
            </div>
        `;

        card.addEventListener('click', () => this.selectLibrarySong(song, index));
        return card;
    }

    /**
     * 根据 level 数字推断颜色主题 CSS class
     * 范围：0-13(EASY), 14-23(NORMAL), 24-31(HARD), 32-37(EXPERT), 38+(MASTER)
     */
    _levelToTheme(level) {
        if (level <= 13) return 'lvl-easy';
        if (level <= 23) return 'lvl-normal';
        if (level <= 31) return 'lvl-hard';
        if (level <= 37) return 'lvl-expert';
        return 'lvl-master';
    }

    /**
     * 根据 song JSON 数据构建难度徽章 HTML（纯数据驱动）
     * - difficulties 为 [{name, level}] 数组 → 多徽章
     * - 否则使用 song.level + song.difficultyName → 单徽章
     */
    buildLevelBadge(song) {
        // --- 多难度（difficulties 为对象数组）---
        if (Array.isArray(song.difficulties) && song.difficulties.length > 0 &&
            typeof song.difficulties[0] === 'object') {
            const badges = song.difficulties.map(d => {
                const lv = typeof d.level === 'number' ? d.level : parseInt(d.level);
                if (isNaN(lv) || lv < 0) return '';
                const cls = this._levelToTheme(lv);
                const name = d.name || '';
                return this._buildSingleBadge(lv, cls, name);
            }).filter(Boolean);

            if (badges.length === 0) return '';
            return `<div class="card-levels">${badges.join('')}</div>`;
        }

        // --- 单难度（song.level + song.difficultyName）---
        const level = typeof song.level === 'number' ? song.level : parseInt(song.level);
        if (isNaN(level) || level < 0) return '';

        const cls = this._levelToTheme(level);
        const displayDiff = song.difficultyName || '';

        return this._buildSingleBadge(level, cls, displayDiff);
    }

    /**
     * 生成单个难度徽章 HTML
     */
    _buildSingleBadge(level, cssClass, diffName) {
        return `
            <div class="card-level ${cssClass}">
                <span class="level-label">LEVEL</span>
                <span class="level-number">${level}</span>
                <span class="level-diff">${this.escapeHTML(diffName)}</span>
            </div>
        `;
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
        loadedMcData = null;
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
                loadedMcData = null;

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
        loadedMcData = null;
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
        // 导入卡片（仅在 MIDI 标签页）
        this.importMidiCard.classList.toggle('selected', selectedSongSource === 'import');

        // 曲库卡片（两个标签页都更新）
        const allSongCards = document.querySelectorAll('.song-cards .song-card');
        allSongCards.forEach(card => {
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

        // 如果选中的是曲库歌曲，需要先加载音频
        if (selectedSongSource === 'library' && selectedLibrarySong) {
            // 先加载 MC beatmap（如果有）
            if (selectedLibrarySong.beatmapType === 'mc') {
                const mcLoaded = await this.loadLibraryMcBeatmap();
                if (!mcLoaded) return;
            }

            // 加载音频：MC 歌曲使用 audio 字段 + mc_audio 路径，MIDI 歌曲使用 file 字段 + songs 路径
            const song = selectedLibrarySong;
            const isMc = song.beatmapType === 'mc';
            const audioFile = isMc ? song.audio : song.file;

            if (audioFile) {
                const basePath = isMc ? 'assets/mc_audio/' : CONFIG.songBasePath;
                const loaded = await this.loadAudioForSong(audioFile, basePath, song);
                if (!loaded && !isMc) return;  // MIDI 必须加载成功
                // MC 允许音频加载失败（回退到预设音乐）
            }
        }

        // MC 模式允许没有 MIDI（使用预设音乐），但至少要有 MC 数据
        if (!loadedMidiData && !loadedMcData) {
            alert('No beatmap data available. Please select a song or import a MIDI file.');
            return;
        }

        this.showSettings();
    }

    /**
     * 通用音频加载方法
     * @param {string} fileName - 音频文件名
     * @param {string} basePath - 基础路径
     * @param {Object} song - 歌曲元数据对象（用于更新 bpm/duration）
     * @returns {Promise<boolean>}
     */
    async loadAudioForSong(fileName, basePath, song) {
        const filePath = basePath + fileName;
        const ext = fileName.split('.').pop().toLowerCase();
        const audioExts = ['ogg', 'mp3', 'wav', 'flac', 'aac', 'm4a', 'opus'];

        if (audioExts.includes(ext)) {
            // 音频文件加载
            try {
                const success = await audioEngine.loadAudioFile(filePath);
                if (success && audioEngine.audioBuffer) {
                    song.bpm = song.bpm || 120;
                    song.duration = formatDuration(audioEngine.audioBuffer.duration);
                }
                return success;
            } catch (err) {
                console.error('Failed to load audio file:', err);
                alert(`Failed to load audio: ${song.title}\nPlease check that the audio file exists at:\n${filePath}`);
                return false;
            }
        }

        // MIDI 文件加载
        try {
            const response = await fetch(filePath);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const arrayBuffer = await response.arrayBuffer();
            const parser = new MidiParser(arrayBuffer);
            loadedMidiData = parser.parse();

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

    // 保留旧方法名以兼容导入 MIDI 等其他调用处
    async loadLibraryMidi() {
        const song = selectedLibrarySong;
        return this.loadAudioForSong(song.file, CONFIG.songBasePath, song);
    }

    async loadLibraryMcBeatmap() {
        const song = selectedLibrarySong;
        const filePath = CONFIG.songBasePath + song.beatmap;

        try {
            const response = await fetch(filePath);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const jsonData = await response.json();

            // 校验 column
            const column = jsonData?.meta?.mode_ext?.column;
            if (column !== 4) {
                alert(
                    `Cannot load "${song.title}"\n\n` +
                    `This beatmap is ${column}K, but CyberBeat only supports 4K beatmaps.\n` +
                    `Please select a 4K chart.`
                );
                return false;
            }

            const parser = new McParser(jsonData);
            loadedMcData = parser.parse();

            // 用 .mc 文件中的元数据更新 song 信息
            if (loadedMcData && loadedMcData.meta) {
                song.bpm = loadedMcData.meta.bpm || song.bpm;
                song.duration = formatDuration(loadedMcData.meta.duration);
                // 如果 menu.json 中没有指定 title/artist，使用 mc 文件中的
                if (!song.title || song.title === 'Unknown') {
                    song.title = loadedMcData.meta.title;
                }
                if (!song.artist || song.artist === 'Unknown Artist') {
                    song.artist = loadedMcData.meta.artist;
                }
            }

            console.log('MC beatmap loaded:', loadedMcData.meta, `${loadedMcData.notes.length} notes`);
            return true;
        } catch (err) {
            console.error('Failed to load MC beatmap:', err);
            alert(
                `Failed to load beatmap for: ${song.title}\n\n` +
                `Error: ${err.message}\n\n` +
                `Please check that the .mc file exists at:\n${filePath}`
            );
            loadedMcData = null;
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

        // 显示 BPM 和时长
        let bpmText = '';
        let durText = '';

        if (loadedMcData && loadedMcData.meta) {
            // MC 谱面：使用 MC 元数据
            bpmText = `BPM ${loadedMcData.meta.bpm}`;
            durText = formatDuration(loadedMcData.meta.duration);
            if (loadedMcData.meta.version) {
                bpmText += `  •  ${loadedMcData.meta.version}`;
            }
        } else if (loadedMidiData) {
            // MIDI：使用 MIDI 计算的 BPM 和时长
            const bpm = computeAverageBpm(loadedMidiData);
            const dur = formatDuration(loadedMidiData.duration);
            bpmText = `BPM ${bpm}`;
            durText = dur;
        }

        this.settingsSongMeta.textContent = [bpmText, durText].filter(Boolean).join('  •  ');

        // MC 谱面不显示难度选择（谱面固定，难度无影响）
        const isMc = selectedLibrarySong?.beatmapType === 'mc';
        if (this.difficultyGroup) {
            this.difficultyGroup.style.display = isMc ? 'none' : '';
        }

        // 根据歌曲的 difficulties 字段过滤难度按钮
        if (!isMc) {
            this.filterDifficultyButtons();
        }

        this.startScreen.classList.add('hidden');
        this.settingsScreen.classList.remove('hidden');
    }

    /**
     * 根据当前选中歌曲的 difficulties 数组，启用/禁用难度按钮
     * difficulties 支持两种格式：
     *   - 字符串数组 ["normal", "normal+"] （key 直用）
     *   - 对象数组 [{key:"normal", name:"NORMAL", level:12}] （取 .key）
     * MC 谱面不限制难度（已固定谱面）
     * 导入的 MIDI 文件默认允许全部难度
     */
    filterDifficultyButtons() {
        let allowedKeys = null;

        if (selectedLibrarySong?.beatmapType === 'mc') {
            allowedKeys = null;
        } else if (selectedSongSource === 'library' && selectedLibrarySong
            && Array.isArray(selectedLibrarySong.difficulties) && selectedLibrarySong.difficulties.length > 0) {
            // 从 difficulties 提取 CONFIG 难度键
            const raw = selectedLibrarySong.difficulties;
            allowedKeys = raw.map(d => {
                if (typeof d === 'string') return d;
                if (typeof d === 'object' && d.key) return d.key;
                return null;
            }).filter(Boolean);
            if (allowedKeys.length === 0) allowedKeys = null;
        }
        // allowedKeys 为 null 表示全部允许

        const diffBtns = document.querySelectorAll('.diff-btn');
        let firstAvailable = null;

        diffBtns.forEach(btn => {
            const diff = btn.dataset.diff;
            const isAllowed = !allowedKeys || allowedKeys.includes(diff);
            btn.disabled = !isAllowed;
            btn.classList.toggle('disabled', !isAllowed);

            if (isAllowed && !firstAvailable) {
                firstAvailable = diff;
            }
        });

        // 如果当前选中的难度不在允许列表中，自动切换到第一个可用难度
        const currentAllowed = !allowedKeys || allowedKeys.includes(selectedDifficulty);
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

        const isMcMode = loadedMcData && selectedLibrarySong?.beatmapType === 'mc';

        if (!loadedMidiData && !isMcMode) {
            alert('No MIDI data loaded. Please select a song or import a MIDI file first.');
            return;
        }

        // 隐藏所有 UI
        this.startScreen.classList.add('hidden');
        this.settingsScreen.classList.add('hidden');
        this.resultScreen.classList.add('hidden');

        // 生成谱面：优先使用 MC 谱面，否则用 MIDI 算法生成
        let notes;
        if (isMcMode) {
            notes = loadedMcData.notes;
            console.log(`Using MC beatmap: ${notes.length} notes`);
        } else {
            notes = generateMidiBeatmap(loadedMidiData, selectedDifficulty);
            console.log(`Using MIDI-generated beatmap: ${notes.length} notes`);
        }

        // 重置游戏状态
        gameState.reset();

        // 重置渲染器对象池
        if (renderer) renderer.resetPools();

        // 设置未来时间实现倒计时（谱面时间从倒计时结束时开始计算）
        const countdownMs = CONFIG.countdownDuration;
        gameState.startTime = performance.now() + countdownMs;

        // 手动设置游戏状态（不使用 initForGame 以兼容倒计时）
        gameState.screen = 'game';
        gameState.notes = notes;
        gameState.isPlaying = true;
        gameState.intervalStartTime = performance.now() + countdownMs;

        // 计算音频偏移（MC 谱面的 sound offset，单位 ms）
        const audioOffset = (loadedMcData?.meta?.audioOffset) || 0;

        // 延迟启动音乐（倒计时 + 音频偏移）
        setTimeout(() => {
            if (loadedMidiData) {
                audioEngine.startMidiMusic([...loadedMidiData.events]);
            } else if (audioEngine.audioBuffer) {
                audioEngine.startAudioPlayback(audioOffset / 1000);
            } else {
                CONFIG.bpm = loadedMcData?.meta?.bpm || 120;
                audioEngine.startPresetMusic();
            }
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
        // 清除所有活跃 hold
        gameState.activeHolds = [null, null, null, null];
        gameState.holdReleaseTimes = [0, 0, 0, 0];

        const accuracy = gameState.calculateTotalAcc();
        let rank = 'C';
        if (accuracy >= 95 && gameState.miss === 0) rank = 'S';
        else if (accuracy >= 85) rank = 'A';
        else if (accuracy >= 70) rank = 'B';

        // 判断是否失败
        const isGameFailed = gameState.health <= 0;
        
        // 获取 DOM 元素
        const resultCard = document.getElementById('resultCard');
        const rankDisplay = document.getElementById('rankDisplay');
        const rankLabel = document.getElementById('rankLabel');
        const statusEl = document.getElementById('resultStatus');
        const statusIcon = document.getElementById('statusIcon');
        const statusText = document.getElementById('statusText');

        // 更新排名显示
        rankDisplay.textContent = rank;
        rankDisplay.className = 'rank';
        
        // 根据状态更新 UI 样式
        if (isGameFailed) {
            resultCard.classList.add('result-failed');
            statusEl.classList.add('failed');
            statusIcon.textContent = '❌';
            statusText.textContent = 'FAILED';
            rankLabel.textContent = 'FAILED';
        } else {
            resultCard.classList.remove('result-failed');
            statusEl.classList.remove('failed');
            statusIcon.textContent = '✓';
            statusText.textContent = 'COMPLETED';
            rankLabel.textContent = isGameFailed ? 'FAILED' : this.getRankLabel(rank);
        }

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
        
        // 播放结算音乐
        this.playResultAudio(isGameFailed);
    }

    // 根据等级返回标签文本
    getRankLabel(rank) {
        const rankLabels = {
            'S': 'PERFECT',
            'A': 'EXCELLENT',
            'B': 'GOOD',
            'C': 'PASS'
        };
        return rankLabels[rank] || 'PASS';
    }

    // 播放结算音乐
    async playResultAudio(isFailed) {
        // 获取结算音乐路径
        const audioPath = isFailed
            ? 'assets/result-audio/failed.mp3'
            : 'assets/result-audio/completed.mp3';

        // 使用 AudioEngine 的 Web Audio API 加载并播放
        const loaded = await audioEngine.loadAudioFile(audioPath);
        if (loaded) {
            audioEngine.startAudioPlayback(0);
        }
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
            const trackIndex = KEYS.indexOf(key);
            // Hold 释放检查
            if (trackIndex !== -1 && gameState.screen === 'game') {
                this.checkHoldRelease(trackIndex);
            }
            gameState.pressedKeys.delete(key);
        });
    }

    // ========== 移动端控制 (增强版) ==========
    setupMobileControls() {
        // 检测是否为触屏设备
        this._isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

        // HTML 按钮绑定
        const mobileBtns = document.querySelectorAll('.mobile-btn');
        mobileBtns.forEach((btn, index) => {
            // pointerdown/pointerup 同时支持触摸和鼠标
            btn.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                btn.classList.add('active');
                gameState.pressedKeys.add(KEYS[index]);

                if (gameState.screen === 'game') {
                    this.checkHit(index);
                }
            });

            btn.addEventListener('pointerup', (e) => {
                e.preventDefault();
                btn.classList.remove('active');
                if (gameState.screen === 'game') {
                    this.checkHoldRelease(index);
                }
                gameState.pressedKeys.delete(KEYS[index]);
            });

            btn.addEventListener('pointerleave', (e) => {
                btn.classList.remove('active');
                if (gameState.screen === 'game') {
                    this.checkHoldRelease(index);
                }
                gameState.pressedKeys.delete(KEYS[index]);
            });

            // 防止双击缩放
            btn.addEventListener('dblclick', (e) => e.preventDefault());
        });

        // Canvas 区域触控 (直接点击轨道)
        const canvas = document.getElementById('gameCanvas');
        if (canvas) {
            canvas.addEventListener('touchstart', (e) => {
                if (gameState.screen !== 'game') return;
                e.preventDefault();
                for (const touch of e.changedTouches) {
                    this._handleCanvasTouch(touch.clientX, touch.clientY, true);
                }
            }, { passive: false });

            canvas.addEventListener('touchend', (e) => {
                if (gameState.screen !== 'game') return;
                e.preventDefault();
                for (const touch of e.changedTouches) {
                    this._handleCanvasTouch(touch.clientX, touch.clientY, false);
                }
            }, { passive: false });

            canvas.addEventListener('touchcancel', (e) => {
                if (gameState.screen !== 'game') return;
                for (const touch of e.changedTouches) {
                    this._handleCanvasTouch(touch.clientX, touch.clientY, false);
                }
            });
        }
    }

    /** 处理 Canvas 上的触控，映射到轨道 */
    _handleCanvasTouch(clientX, clientY, isDown) {
        if (!renderer) return;
        const totalWidth = CONFIG.trackCount * CONFIG.trackWidth + (CONFIG.trackCount - 1) * CONFIG.trackSpacing;
        const startX = renderer.trackStartX;
        const endX = startX + totalWidth;

        // 在轨道区域外 → 忽略
        if (clientX < startX - 20 || clientX > endX + 20) return;

        // 计算轨道索引
        const relX = clientX - startX;
        const trackWidth = CONFIG.trackWidth + CONFIG.trackSpacing;
        const trackIndex = Math.floor(relX / trackWidth);
        if (trackIndex < 0 || trackIndex >= CONFIG.trackCount) return;

        const key = KEYS[trackIndex];

        if (isDown && !gameState.pressedKeys.has(key)) {
            gameState.pressedKeys.add(key);
            this.checkHit(trackIndex);
        } else if (!isDown) {
            this.checkHoldRelease(trackIndex);
            gameState.pressedKeys.delete(key);
        }
    }

    // ========== 打击判定 (双阈值提前终止) ==========
    checkHit(track) {
        if (!renderer) return false;

        const judgmentY = renderer.canvasHeight * CONFIG.judgmentLineY;
        const currentTime = performance.now() - gameState.startTime;

        if (currentTime < 0) return false;

        // hold 宽限期补按
        if (gameState.holdReleaseTimes[track] > 0) {
            if (currentTime - gameState.holdReleaseTimes[track] <= 40) {
                gameState.holdReleaseTimes[track] = 0;
                return true;
            }
        }

        const notes = gameState.notes;
        const noteCount = notes.length;
        const greatWindow = CONFIG.greatWindow;
        const perfectWindow = CONFIG.perfectWindow;
        const activeHolds = gameState.activeHolds;
        const pastDeadline = currentTime - greatWindow;
        const futureDeadline = currentTime + greatWindow;

        for (let i = 0; i < noteCount; i++) {
            const note = notes[i];
            const noteTime = note.time;

            // 时间检查优先于轨道检查（音符按时间排序）
            if (noteTime < pastDeadline) continue;   // 太旧，跳过
            if (noteTime > futureDeadline) break;     // 太远，后续也都太远

            // 轨道匹配 + 未命中
            if (note.track !== track || note.hit) continue;

            const timeDiff = Math.abs(currentTime - noteTime);

            // ===== Hold 长条头部 =====
            if (note.type === 'hold' && note.endTime) {
                note.hit = true;
                note.holdActive = true;
                const isPerfect = timeDiff <= perfectWindow;
                activeHolds[track] = note;

                if (isPerfect) {
                    gameState.perfect++;
                    gameState.intervalStats.perfect++;
                    gameState.score += 100;
                    renderer.addJudgment('PERFECT', judgmentY, track);
                    audioEngine.playHitSound('perfect');
                } else {
                    gameState.great++;
                    gameState.intervalStats.great++;
                    gameState.score += 50;
                    renderer.addJudgment('GREAT', judgmentY, track);
                    audioEngine.playHitSound('great');
                }

                gameState.combo++;
                gameState.maxCombo = Math.max(gameState.maxCombo, gameState.combo);
                gameState.health = Math.min(CONFIG.health.initial, gameState.health + CONFIG.health.gainOnHit);
                renderer.createHitParticles(judgmentY, track, isPerfect ? '#ffd43b' : '#69db7c');
                renderer.createLaser(track);
                return true;
            }

            // ===== Tap 音符 =====
            note.hit = true;
            const isPerfect = timeDiff <= perfectWindow;

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
            gameState.health = Math.min(CONFIG.health.initial, gameState.health + CONFIG.health.gainOnHit);
            renderer.createHitParticles(judgmentY, track, isPerfect ? '#ffd43b' : '#69db7c');
            renderer.createLaser(track);
            return true;
        }
        return false;
    }

    /**
     * Hold 长条释放检查（keyup 时触发）
     * 宽松判定：记录松开时间，40ms 内补按则不算 miss
     */
    checkHoldRelease(track) {
        if (!renderer) return;

        const currentTime = performance.now() - gameState.startTime;
        if (currentTime < 0) return;

        const holdNote = gameState.activeHolds[track];
        if (!holdNote || !holdNote.holdActive) return;

        // 检查是否在 hold 结束时间之前松开的
        if (holdNote.endTime && currentTime < holdNote.endTime - CONFIG.greatWindow) {
            // 记录松开时间，进入 40ms 宽限期（不立即判定 miss）
            gameState.holdReleaseTimes[track] = currentTime;
        }
    }

    /**
     * 每帧调用：检查 hold 状态
     * - 宽限期超时检查（40ms）
     * - 尾部到达自动完成
     */
    updateHolds() {
        const currentTime = performance.now() - gameState.startTime;
        if (currentTime < 0) return;

        for (let track = 0; track < 4; track++) {
            const holdNote = gameState.activeHolds[track];
            if (!holdNote || !holdNote.holdActive || !holdNote.endTime) {
                // 没有活跃 hold，清空释放时间
                gameState.holdReleaseTimes[track] = 0;
                continue;
            }

            // 检查宽限期：如果已松开超过 40ms 且未补按 → Miss
            const releaseTime = gameState.holdReleaseTimes[track];
            if (releaseTime > 0) {
                const elapsed = currentTime - releaseTime;
                if (elapsed > 40) {
                    // 宽限期超时 → Miss
                    holdNote.holdActive = false;
                    holdNote.holdReleased = true;
                    gameState.activeHolds[track] = null;
                    gameState.holdReleaseTimes[track] = 0;

                    const judgmentY = renderer.canvasHeight * CONFIG.judgmentLineY;
                    gameState.miss++;
                    gameState.intervalStats.miss++;
                    gameState.combo = 0;
                    gameState.health = Math.max(0, gameState.health - CONFIG.health.lossOnMiss);
                    renderer.addJudgment('MISS', judgmentY, track);
                    audioEngine.playHitSound('miss');
                    continue;
                }
            }

            // Hold 尾部到达判定线 → 自动完成（即使在宽限期内也正常完成）
            if (currentTime >= holdNote.endTime - CONFIG.greatWindow) {
                holdNote.holdActive = false;
                gameState.activeHolds[track] = null;
                gameState.holdReleaseTimes[track] = 0;

                const holdDuration = holdNote.endTime - holdNote.time;
                const holdBonus = Math.floor(holdDuration / 100) * 10;
                gameState.score += 100 + holdBonus;
                gameState.health = Math.min(CONFIG.health.initial, gameState.health + 1);

                const judgmentY = renderer.canvasHeight * CONFIG.judgmentLineY;
                renderer.createLaser(track);
            }
        }
    }
}