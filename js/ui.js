// ==================== UI 管理器 ====================

class UIManager {
    constructor() {
        this.songLibraryLoaded = false;

        // 排行榜详情状态
        this._detailSongName = null;
        this._detailRecordId = null;
        this._pendingChartHistory = null;

        // 音乐启动定时器状态（暂停时需要顺延）
        this._musicStartTimeout = null;
        this._musicDelayMs = 0;
        this._musicScheduledAt = 0;
        this._musicRestartDelay = 0;

        // 排行榜返回来源
        this._lbOrigin = 'start';

        // 空格双击检测（跳过前奏）
        this._lastSpaceDownAt = 0;

        // 应用持久化设置到运行时变量
        if (typeof settingsStore !== 'undefined') {
            settingsStore.applyToRuntime();
        }

        this.cacheDOMElements();
        this.setupEventListeners();
        this.loadSongLibrary();
        this.updateSpeedDisplay();
        this.updateStartButtons();

        // 用持久化的设置覆盖 UI 初始状态
        this.applyStoredSettingsToUI();

        // 初始化音量（0-10）- 使用持久化的音量
        this.setVolume(currentVolume);
        if (this.volumeSlider) this.volumeSlider.value = currentVolume;
        if (this.volumeValue) this.volumeValue.textContent = currentVolume + '/10';

        // 初始化全局偏移（ms）- 使用持久化的偏移值
        this.setAudioOffset(audioOffsetMs, /* updateUI */ true);
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
        this.importOsuCard  = document.getElementById('importOsuCard');
        this.osuUpload      = document.getElementById('osuUpload');

        // 按钮
        this.startBtn         = document.getElementById('startBtn');
        this.settingsBtn      = document.getElementById('settingsBtn');
        this.settingsStartBtn = document.getElementById('settingsStartBtn');
        this.settingsBackBtn  = document.getElementById('settingsBackBtn');
        this.homeBtn          = document.getElementById('homeBtn');
        this.exportBtn        = document.getElementById('exportBtn');
        this.leaderboardStartBtn = document.getElementById('leaderboardStartBtn');

        // 设置面板
        this.settingsSongTitle  = document.getElementById('settingsSongTitle');
        this.settingsSongArtist = document.getElementById('settingsSongArtist');
        this.settingsSongMeta   = document.getElementById('settingsSongMeta');
        this.difficultyGroup    = document.getElementById('difficultyGroup');
        this.speedValue         = document.getElementById('speedValue');

        // 音量
        this.volumeSlider = document.getElementById('volumeSlider');
        this.volumeValue  = document.getElementById('volumeValue');

        // 全局偏移
        this.offsetSlider = document.getElementById('offsetSlider');
        this.offsetValue  = document.getElementById('offsetValue');

        // 结果面板
        this.rankDisplay    = document.getElementById('rankDisplay');
        this.finalScore     = document.getElementById('finalScore');
        this.finalCombo     = document.getElementById('finalCombo');
        this.finalAccuracy  = document.getElementById('finalAccuracy');
        this.finalPerfect   = document.getElementById('finalPerfect');
        this.finalGreat     = document.getElementById('finalGreat');
        this.finalMiss      = document.getElementById('finalMiss');

        // 结果面板 - 新按钮
        this.retryBtn       = document.getElementById('retryBtn');
        this.leaderboardBtn = document.getElementById('leaderboardBtn');

        // 排行榜面板
        this.leaderboardScreen = document.getElementById('leaderboardScreen');
        this.lbSongFilter      = document.getElementById('lbSongFilter');
        this.lbList            = document.getElementById('lbList');
        this.lbDetail          = document.getElementById('lbDetail');
        this.lbDetailTitle     = document.getElementById('lbDetailTitle');
        this.lbDetailStats     = document.getElementById('lbDetailStats');
        this.lbChartCanvas     = document.getElementById('lbChartCanvas');

        // 排行榜操作按钮
        this.lbCloseBtn       = document.getElementById('lbCloseBtn');
        this.lbBackBtn        = document.getElementById('lbBackBtn');
        this.lbExportAllBtn   = document.getElementById('lbExportAllBtn');
        this.lbImportBtn      = document.getElementById('lbImportBtn');
        this.lbImportFile     = document.getElementById('lbImportFile');
        this.lbDetailClose    = document.getElementById('lbDetailClose');
        this.lbDetailDelete   = document.getElementById('lbDetailDelete');

        // .osz 谱面选择器
        this.oszPicker       = document.getElementById('oszPicker');
        this.oszPickerList   = document.getElementById('oszPickerList');
        this.oszPickerCancel = document.getElementById('oszPickerCancel');
    }

    // ========== 事件绑定 ==========
    setupEventListeners() {
        // 开始按钮 (统一入口)
        this.startBtn.addEventListener('click', () => this.handleStartOrConfig());
        this.settingsBtn.addEventListener('click', () => this.handleStartOrConfig());

        // 开始画面的排行榜按钮
        if (this.leaderboardStartBtn) {
            this.leaderboardStartBtn.addEventListener('click', () => this.showLeaderboard(false));
        }

        // 设置面板内按钮
        this.settingsStartBtn.addEventListener('click', () => this.startGame());
        this.settingsBackBtn.addEventListener('click', () => this.hideSettings());

        // 结果面板
        this.homeBtn.addEventListener('click', () => this.goToHome());
        this.exportBtn.addEventListener('click', () => this.exportResults());

        // 结果面板 - 新按钮
        if (this.retryBtn) {
            this.retryBtn.addEventListener('click', () => this.retryGame());
        }
        if (this.leaderboardBtn) {
            this.leaderboardBtn.addEventListener('click', () => this.showLeaderboard());
        }

        // 排行榜面板事件
        this._setupLeaderboardEvents();

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

        // 导入 .osu / .osz 卡片点击 → 触发 file input
        if (this.importOsuCard && this.osuUpload) {
            this.importOsuCard.addEventListener('click', (e) => {
                if (e.target !== this.osuUpload) {
                    this.osuUpload.click();
                }
            });
            this.osuUpload.addEventListener('change', (e) => this.handleOsuImport(e));
        }

        // .osz 谱面选择器
        if (this.oszPickerCancel) {
            this.oszPickerCancel.addEventListener('click', () => this.hideOszPicker());
        }
        if (this.oszPickerList) {
            this.oszPickerList.addEventListener('click', (e) => {
                const item = e.target.closest('.osz-pick-item');
                if (item && item.dataset.index !== undefined) {
                    this.applyOszCandidate(parseInt(item.dataset.index));
                }
            });
        }

        // 音量滑块
        if (this.volumeSlider) {
            this.volumeSlider.addEventListener('input', () => {
                const vol = parseInt(this.volumeSlider.value);
                this.setVolume(vol);
            });
        }

        // 全局偏移滑块
        if (this.offsetSlider) {
            this.offsetSlider.addEventListener('input', () => {
                this.setAudioOffset(parseInt(this.offsetSlider.value));
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
     * 判断是否为谱面类歌曲（.mc / .osu，谱面固定，不生成谱面）
     */
    _isChartSong(song) {
        return !!song && (song.beatmapType === 'mc' || song.beatmapType === 'osu');
    }

    /**
     * 从 songLibrary 中筛选 MIDI 歌曲（beatmapType 不是 "mc" / "osu" 的，包括 .mid）
     */
    _getMidiSongs() {
        return songLibrary.filter(s => !this._isChartSong(s));
    }

    /**
     * 从 songLibrary 中筛选谱面歌曲（.mc / .osu）
     */
    _getChartSongs() {
        return songLibrary.filter(s => this._isChartSong(s));
    }

    renderSongList() {
        if (!this.songCardsMidi || !this.songCardsSongs) return;

        const midiSongs = this._getMidiSongs();
        const chartSongs = this._getChartSongs();

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
        const hasOsuImport = selectedSongSource === 'import' &&
            (loadedOsuData || loadedMcData || importedOsuFileName || importedMcFileName);
        if (chartSongs.length === 0 && !hasOsuImport) {
            if (this.songEmptySongs) this.songEmptySongs.style.display = 'flex';
        } else {
            if (this.songEmptySongs) this.songEmptySongs.style.display = 'none';
            chartSongs.forEach((song) => {
                const realIndex = songLibrary.indexOf(song);
                const card = this.createSongCard(song, realIndex);
                this.songCardsSongs.appendChild(card);
            });
            // 导入的 .osu / .osz 谱面：显示为合成卡片，避免切标签丢失选择
            if (hasOsuImport) {
                const card = this.createImportedOsuCard();
                this.songCardsSongs.appendChild(card);
            }
        }

        this.updateAllHighlights();
    }

    /** 生成「已导入 .osu/.osz/.mc」合成卡片 */
    createImportedOsuCard() {
        const card = document.createElement('div');
        card.className = 'song-card import-card selected';
        const isMc = !!(loadedMcData || importedMcFileName);
        card.innerHTML = `
            <div class="card-body">
                <div class="card-icon">▣</div>
                <div class="card-info">
                    <span class="card-title import-title">${isMc ? 'IMPORTED .MC (.OSZ)' : 'IMPORTED .OSU/.OSZ'}</span>
                    <span class="card-sub">${this.escapeHTML(selectedSongDisplayName || '')}</span>
                </div>
                <div class="card-arrow">→</div>
            </div>
        `;
        return card;
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

        // 如果当前选中的曲库歌曲不在活跃标签页中，清除选中
        if (selectedSongSource === 'library' && selectedLibrarySong) {
            const isChartSelected = this._isChartSong(selectedLibrarySong);
            if ((tab === 'midi' && isChartSelected) || (tab === 'songs' && !isChartSelected)) {
                this.clearSelection();
            }
        }
        // 重新渲染当前标签内容（导入的 osu 谱面在 SONGS 标签显示为合成卡片）
        this.renderSongList();
    }

    /**
     * 更新标签页曲目计数
     */
    _updateTabCount() {
        const midiSongs = this._getMidiSongs();
        const chartSongs = this._getChartSongs();
        const count = this.activeTab === 'midi' ? midiSongs.length : chartSongs.length;
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
                <div class="card-icon">♪</div>
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
        loadedOsuData = null;
        importedMidiFileName = null;
        importedOsuFileName = null;
        importedMcFileName = null;
        selectedSongDisplayName = song.title;

        this.updateSelectionDisplay();
        this.updateAllHighlights();
        this.updateStartButtons();
    }

    handleMidiImport(event) {
        const file = event.target.files[0];
        if (!file) return;

        importedMidiFileName = file.name;
        importedOsuFileName = null;
        importedMcFileName = null;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const parser = new MidiParser(e.target.result);
                loadedMidiData = parser.parse();
                loadedMcData = null;
                loadedOsuData = null;

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

    /**
     * 处理 .osu / .osz 文件导入
     * - .osu：直接解析文本谱面（无音频时回退到预设音乐）
     * - .osz：解压并选择第一个合法的 osu!mania 4K 谱面，同时加载其音频
     */
    async handleOsuImport(event) {
        const file = event.target.files[0];
        if (!file) return;

        const ext = file.name.split('.').pop().toLowerCase();
        try {
            if (ext === 'osu') {
                await this._importOsuFile(file);
            } else if (ext === 'osz') {
                await this._importOszFile(file);
            } else {
                alert('Unsupported file type. Please select a .osu or .osz file.');
            }
        } catch (err) {
            console.error('osu! import error:', err);
            alert(`Failed to import osu! beatmap.\n\n${err.message}`);
            this.clearSelection();
        } finally {
            event.target.value = ''; // 允许重新选择相同文件
        }
    }

    /**
     * 导入单个 .osu 文件
     */
    _importOsuFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const parser = new OsuParser(e.target.result);
                    const result = parser.parse();
                    this._applyImportedOsu(result, file.name);
                    // 无音频：清空残留的音频缓冲，回退到预设音乐
                    audioEngine.stopAudio();
                    resolve();
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = () => reject(new Error('Failed to read file.'));
            reader.readAsText(file, 'utf-8');
        });
    }

    /**
     * 导入 .osz 压缩包：枚举全部可玩谱面（osu!mania 4K + Malody .mc 4K）
     * - 只有一个谱面：直接导入
     * - 多个谱面：弹出选择器让用户挑选
     */
    async _importOszFile(file) {
        const arrayBuffer = await file.arrayBuffer();
        const zip = new OsZipReader(arrayBuffer);
        const osuEntries = zip.listOsuEntries();
        const mcEntries = zip.listMcEntries();
        if (osuEntries.length === 0 && mcEntries.length === 0) {
            throw new Error('No .osu or .mc beatmap found in this .osz file.');
        }

        // 解析全部候选（跳过解析失败 / 非 4K / 无音符的条目）
        const candidates = [];
        const allEntries = [
            ...osuEntries.map(e => ({ entry: e, kind: 'osu' })),
            ...mcEntries.map(e => ({ entry: e, kind: 'mc' }))
        ];
        for (const cand of allEntries) {
            try {
                const text = await zip.readText(cand.entry);
                let parsed;
                if (cand.kind === 'osu') {
                    parsed = new OsuParser(text).parse();
                } else {
                    const clean = text.replace(/^\uFEFF/, '');
                    parsed = new McParser(JSON.parse(clean)).parse();
                }
                if (parsed.notes.length > 0) {
                    candidates.push({ kind: cand.kind, entry: cand.entry, parsed: parsed });
                }
            } catch (err) {
                console.warn('Skip unplayable entry:', cand.entry.name, '-', err.message.split('\n')[0]);
            }
        }

        if (candidates.length === 0) {
            throw new Error(
                'No playable 4K beatmap (osu!mania or Malody) found in this .osz file.\n\n' +
                'CyberBeat only supports 4K keycount beatmaps.'
            );
        }

        // 自动计算难度（参考 osu!mania 应变算法），按难度由小到大排序展示
        for (const c of candidates) {
            c.difficulty = new DifficultyCalculator(c.parsed.notes).calculate();
        }
        candidates.sort((a, b) => a.difficulty.star - b.difficulty.star);

        this._oszZip = zip;
        this._oszCandidates = candidates;
        this._oszAssignAudio(candidates);

        if (candidates.length === 1) {
            this.applyOszCandidate(0);
        } else {
            this.showOszPicker(candidates);
        }
    }

    /**
     * 包级音频分配：先按条目规则配对，剩余未配对者
     * 仅当「恰好剩一个」且包内有唯一的 audio* 通用文件时，才把它留给这一个谱面
     */
    _oszAssignAudio(candidates) {
        for (const c of candidates) {
            c.audioEntry = this.oszPickAudioEntry(c);
        }
        const unmatched = candidates.filter(c => !c.audioEntry && c.kind === 'mc');
        if (unmatched.length === 1) {
            const zip = this._oszZip;
            if (zip) {
                const baseOf = (name) => name.replace(/\\/g, '/').split('/').pop().toLowerCase();
                const generic = zip.entries
                    .filter(e => /\.(ogg|mp3|wav|m4a)$/i.test(e.name))
                    .filter(a => baseOf(a.name).startsWith('audio'));
                if (generic.length === 1) unmatched[0].audioEntry = generic[0];
            }
        }
    }

    /** 弹出谱面选择器 */
    showOszPicker(candidates) {
        if (!this.oszPicker || !this.oszPickerList) return;
        this.oszPickerList.textContent = '';

        for (let i = 0; i < candidates.length; i++) {
            const c = candidates[i];
            const meta = c.parsed.meta;
            const audioEntry = c.audioEntry;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'osz-pick-item';
            btn.dataset.index = String(i);

            const versionEl = document.createElement('span');
            versionEl.className = 'osz-pick-version';
            versionEl.textContent =
                (c.kind === 'osu' ? 'osu!mania :: ' : 'Malody :: ') +
                (meta.version || meta.title || c.entry.name.split('/').pop());

            const metaEl = document.createElement('span');
            metaEl.className = 'osz-pick-meta';
            metaEl.textContent =
                (meta.title || 'Unknown') + ' — ' + (meta.artist || '') + ' · ' +
                (meta.column || 4) + 'K · ' + c.parsed.notes.length.toLocaleString() + ' NOTES';

            const diff = c.difficulty || new DifficultyCalculator(c.parsed.notes).calculate();
            const diffEl = document.createElement('span');
            diffEl.className = 'osz-pick-diff ' + this._levelToTheme(diff.level);
            diffEl.textContent = '★ ' + diff.star.toFixed(2) + ' · LEVEL ' + diff.level;

            const audioEl = document.createElement('span');
            audioEl.className = 'osz-pick-audio';
            audioEl.textContent = audioEntry
                ? '♪ ' + audioEntry.name.split('/').pop()
                : '♪ no audio found in pack — preset music will be used';

            btn.append(versionEl, metaEl, diffEl, audioEl);
            this.oszPickerList.appendChild(btn);
        }

        this.oszPicker.classList.remove('hidden');
    }

    /** 应用选择器中的某个候选谱面 */
    applyOszCandidate(index) {
        const c = (this._oszCandidates || [])[index];
        if (!c) return;
        const zip = this._oszZip;
        this.hideOszPicker();

        try {
            if (c.kind === 'osu') {
                this._applyImportedOsu(c.parsed, c.entry.name);
            } else {
                this._applyImportedMc(c.parsed, c.entry.name);
            }

            // 加载配套音频；找不到则停止旧音频（回退预设音乐）
            const audioEntry = c.audioEntry;
            if (audioEntry) {
                this._loadOszAudio(zip, audioEntry).catch(err => {
                    console.warn('Failed to load osz audio:', err);
                    audioEngine.stopAudio();
                });
            } else {
                audioEngine.stopAudio();
            }
        } catch (err) {
            console.error('Apply osz candidate error:', err);
            alert('Failed to apply beatmap.\n\n' + err.message);
            this.clearSelection();
        }
    }

    /** 关闭谱面选择器 */
    hideOszPicker() {
        if (this.oszPicker) this.oszPicker.classList.add('hidden');
        this._oszZip = null;
        this._oszCandidates = null;
    }

    /** 为候选谱面挑选配套音频条目（不含通用 fallback；包级处理见 _oszAssignAudio） */
    oszPickAudioEntry(c) {
        const zip = this._oszZip;
        if (!zip) return null;

        if (c.kind === 'osu') {
            // .osu：AudioFilename 指定（osu-zip 内已做大小写不敏感匹配）
            return c.parsed.meta.audioFile ? zip.findEntry(c.parsed.meta.audioFile) : null;
        }

        // Malody .mc：音频是包内独立文件，按以下优先级配对
        const audioEntries = zip.entries.filter(e => /\.(ogg|mp3|wav|m4a)$/i.test(e.name));
        if (audioEntries.length === 0) return null;

        const baseOf = (name) => name.replace(/\\/g, '/').split('/').pop().replace(/\.[^.]+$/, '').toLowerCase();

        // 1) 同名（.mc 与音频共用时间戳/文件名）
        const mcBase = baseOf(c.entry.name);
        const sameName = audioEntries.find(a => baseOf(a.name) === mcBase);
        if (sameName) return sameName;

        // 2) 曲名关键词匹配（title/version 中的有效词语）
        const keywords = this.mcAudioKeywords(c.parsed);
        if (keywords.length > 0) {
            let best = null;
            let bestScore = 0;
            for (const a of audioEntries) {
                const base = baseOf(a.name);
                let score = 0;
                for (const kw of keywords) {
                    if (base.includes(kw)) score++;
                }
                if (score > bestScore) {
                    best = a;
                    bestScore = score;
                }
            }
            if (best && bestScore > 0) return best;
        }

        // 3) 版本速度数字匹配（如 "(1.05x)" ↔ "audio 1.050x (pitch raised).ogg"、"0.95x" ↔ "audio95.ogg"）
        const speedMatch = String(c.parsed.meta.version || '').match(/\((\d+(?:\.\d+)?)x?\)/i);
        if (speedMatch && Number(speedMatch[1]) > 0) {
            const full = String(Number(speedMatch[1]));
            const frac = speedMatch[1].split('.')[1];
            const nums = frac && frac.length >= 2 && frac !== full ? [full, frac] : [full];
            for (const num of nums) {
                const hit = audioEntries.find(a => baseOf(a.name).includes(num));
                if (hit) return hit;
            }
        }

        return null;
    }

    /** 从 .mc 的 title/version 提取音频匹配关键词（去掉序号、通用词） */
    mcAudioKeywords(parsed) {
        const raw = String((parsed.meta.title || '') + ' ' + (parsed.meta.version || ''));
        const stop = new Set([
            'reg', 'dan', 'pack', 'part', 'the', 'of', 'and', 'mix', 'extended',
            'remix', 'pitch', 'raised', 'audio', 'speed', 'ver', 'section', 'mini', 'jack',
            'in', 'at', 'to', 'on', 'it', 'or', 'from', 'feat', 'with', 'for'
        ]);
        const seen = new Set();
        const words = raw.toLowerCase()
            .replace(/[()\[\]{}<>'"]/g, ' ')
            .replace(/[-_]+/g, ' ')
            .split(/\s+/)
            .map(w => w.replace(/^\d+\.?\d*x?\s*/, '').replace(/^\d+$/, ''));

        const out = [];
        for (const w of words) {
            if (w.length < 2) continue;
            if (stop.has(w)) continue;
            if (/^[ivx]+$/.test(w)) continue;   // I/II/III 等序号
            if (!seen.has(w)) {
                seen.add(w);
                out.push(w);
            }
        }
        return out;
    }

    /** 从 .osz 中读取音频并送入音频引擎 */
    async _loadOszAudio(zip, audioEntry) {
        const blob = await zip.readBlob(audioEntry);
        // 释放上一次导入的音频 URL
        if (this._importedOsuAudioUrl) {
            URL.revokeObjectURL(this._importedOsuAudioUrl);
        }
        this._importedOsuAudioUrl = URL.createObjectURL(blob);
        await audioEngine.loadAudioFile(this._importedOsuAudioUrl);
    }

    /**
     * 应用导入的 osu! 谱面到全局状态
     */
    _applyImportedOsu(parsed, displayName) {
        loadedOsuData = parsed;
        loadedMcData = null;
        loadedMidiData = null;

        importedOsuFileName = displayName.replace(/\.osu$/i, '');
        importedMidiFileName = null;

        selectedSongSource = 'import';
        selectedLibrarySong = null;
        selectedSongDisplayName =
            (parsed.meta.title || importedOsuFileName) +
            (parsed.meta.version ? ' [' + parsed.meta.version + ']' : '');

        this.updateSelectionDisplay();
        this.updateAllHighlights();
        this.updateStartButtons();
    }

    /**
     * 应用导入的 Malody .mc 谱面到全局状态
     */
    _applyImportedMc(parsed, displayName) {
        loadedOsuData = null;
        loadedMcData = parsed;
        loadedMidiData = null;

        importedMcFileName = displayName.replace(/\.mc$/i, '');
        importedOsuFileName = null;
        importedMidiFileName = null;

        selectedSongSource = 'import';
        selectedLibrarySong = null;
        selectedSongDisplayName =
            (parsed.meta.title || importedMcFileName) +
            (parsed.meta.version ? ' [' + parsed.meta.version + ']' : '');

        this.updateSelectionDisplay();
        this.updateAllHighlights();
        this.updateStartButtons();
    }

    clearSelection() {
        selectedSongSource = null;
        selectedLibrarySong = null;
        loadedMidiData = null;
        loadedMcData = null;
        loadedOsuData = null;
        importedMidiFileName = null;
        importedOsuFileName = null;
        importedMcFileName = null;
        selectedSongDisplayName = null;

        this.updateSelectionDisplay();
        this.updateAllHighlights();
        this.updateStartButtons();
        // 重新渲染，清理可能残留的「导入 osu」合成卡片
        this.renderSongList();
    }

    updateSelectionDisplay() {
        const importName = importedOsuFileName || importedMcFileName || importedMidiFileName;
        if (selectedSongSource === 'library' && selectedLibrarySong) {
            this.selectedSongName.textContent = selectedLibrarySong.title;
            this.selectedSongName.style.color = 'var(--accent)';
            this.selectedSongSourceEl.textContent = 'LIBRARY';
            this.selectedSongSourceEl.style.color = '';
        } else if (selectedSongSource === 'import' && importName) {
            this.selectedSongName.textContent = importName;
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

        // 如果选中的是曲库歌曲，需要先加载谱面和音频
        if (selectedSongSource === 'library' && selectedLibrarySong) {
            // 先加载谱面（.mc 或 .osu，如果有）
            if (selectedLibrarySong.beatmapType === 'mc') {
                const mcLoaded = await this.loadLibraryMcBeatmap();
                if (!mcLoaded) return;
            } else if (selectedLibrarySong.beatmapType === 'osu') {
                const osuLoaded = await this.loadLibraryOsuBeatmap();
                if (!osuLoaded) return;
            }

            // 加载音频：谱面歌曲（mc/osu）使用 audio 字段 + 对应目录，MIDI 使用 file 字段 + songs 路径
            const song = selectedLibrarySong;
            const isChart = this._isChartSong(song);
            const audioFile = isChart ? song.audio : song.file;

            if (audioFile) {
                let basePath;
                if (song.beatmapType === 'osu') {
                    basePath = CONFIG.osuBasePath + (song.folder ? song.folder + '/' : '');
                } else if (song.beatmapType === 'mc') {
                    basePath = CONFIG.mcAudioBasePath;
                } else {
                    basePath = CONFIG.songBasePath;
                }
                const loaded = await this.loadAudioForSong(audioFile, basePath, song);
                if (!loaded && !isChart) return;  // MIDI 必须加载成功
                // 谱面歌曲允许音频加载失败（回退到预设音乐）
            }
        }

        // 谱面/导入模式允许没有 MIDI（使用预设音乐），但至少要有谱面数据
        if (!loadedMidiData && !getLoadedChartData()) {
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

    /**
     * 加载曲库中的 osu!mania .osu 谱面（assets/osu/<folder>/<file>）
     * @returns {Promise<boolean>}
     */
    async loadLibraryOsuBeatmap() {
        const song = selectedLibrarySong;
        const filePath = CONFIG.osuBasePath + (song.folder ? song.folder + '/' : '') + song.file;

        try {
            const response = await fetch(filePath);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const text = await response.text();
            const parser = new OsuParser(text);
            loadedOsuData = parser.parse();
            loadedMcData = null;

            // 用 .osu 文件中的元数据更新 song 信息
            if (loadedOsuData && loadedOsuData.meta) {
                const meta = loadedOsuData.meta;
                song.bpm = meta.bpm || song.bpm;
                song.duration = formatDuration(meta.duration);
                if (!song.title || song.title === 'Unknown') {
                    song.title = meta.title;
                }
                if (!song.artist || song.artist === 'Unknown Artist') {
                    song.artist = meta.artist;
                }
                // 若 menu.json 未指定音频，使用谱面内 AudioFilename
                if (!song.audio && meta.audioFile) {
                    song.audio = meta.audioFile;
                }
            }

            console.log(
                'osu! beatmap loaded:', loadedOsuData.meta,
                `${loadedOsuData.notes.length} notes`
            );
            return true;
        } catch (err) {
            console.error('Failed to load osu! beatmap:', err);
            alert(
                `Failed to load beatmap for: ${song.title}\n\n` +
                `Error: ${err.message}\n\n` +
                `Please check that the .osu file exists at:\n${filePath}`
            );
            loadedOsuData = null;
            return false;
        }
    }

    showSettings() {
        if (!selectedSongSource) return;

        // 更新设置面板的歌曲信息
        const importName = importedOsuFileName || importedMidiFileName;
        if (selectedSongSource === 'library' && selectedLibrarySong) {
            this.settingsSongTitle.textContent = selectedLibrarySong.title;
            this.settingsSongArtist.textContent = selectedLibrarySong.artist || '';
        } else if (selectedSongSource === 'import') {
            this.settingsSongTitle.textContent = importName || 'Imported MIDI';
            this.settingsSongArtist.textContent = 'Custom Import';
        }

        // 显示 BPM 和时长
        let bpmText = '';
        let durText = '';

        const chartData = getLoadedChartData();
        if (chartData && chartData.meta) {
            // 谱面（.mc / .osu）：使用谱面元数据 + 自动计算难度
            const diff = new DifficultyCalculator(chartData.notes).calculate();
            bpmText = `BPM ${chartData.meta.bpm}  •  ★ ${diff.star.toFixed(2)}  •  Lv.${diff.level}`;
            durText = formatDuration(chartData.meta.duration);
            if (chartData.meta.version) {
                bpmText += `  •  ${chartData.meta.version}`;
            }
        } else if (loadedMidiData) {
            // MIDI：使用 MIDI 计算的 BPM 和时长
            const bpm = computeAverageBpm(loadedMidiData);
            const dur = formatDuration(loadedMidiData.duration);
            bpmText = `BPM ${bpm}`;
            durText = dur;
        }

        this.settingsSongMeta.textContent = [bpmText, durText].filter(Boolean).join('  •  ');

        // 谱面（.mc / .osu，含导入的 osu）不显示难度选择（谱面固定，难度无影响）
        const isChart = !!getLoadedChartData();
        if (this.difficultyGroup) {
            this.difficultyGroup.style.display = isChart ? 'none' : '';
        }

        // 根据歌曲的 difficulties 字段过滤难度按钮
        if (!isChart) {
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

        if (this._isChartSong(selectedLibrarySong)) {
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

        const chartData = getLoadedChartData();
        const isChartMode = !!chartData;

        if (!loadedMidiData && !isChartMode) {
            alert('No beatmap data loaded. Please select a song or import a beatmap first.');
            return;
        }

        // 停止一切残留播放（结算音乐/上一局音乐），并清掉可能挂起的启动定时器
        audioEngine.stopMusic();
        if (this._musicStartTimeout) {
            clearTimeout(this._musicStartTimeout);
            this._musicStartTimeout = null;
        }

        // 隐藏所有 UI
        this.startScreen.classList.add('hidden');
        this.settingsScreen.classList.add('hidden');
        this.resultScreen.classList.add('hidden');

        // 生成谱面：优先使用谱面（.mc / .osu），否则用 MIDI 算法生成
        // 谱面音符深拷贝：清除上一局的 hit/missed/holdActive 等运行时状态，保证 RETRY 正确
        let notes;
        if (isChartMode) {
            notes = chartData.notes.map(n => ({
                track: n.track,
                time: n.time,
                y: -50,
                hit: false,
                missed: false,
                type: n.type,
                endTime: n.endTime !== undefined ? n.endTime : null,
                holdActive: false,
                holdReleased: false
            }));
            console.log(`Using beatmap (${chartData.meta.version || 'chart'}): ${notes.length} notes`);
        } else {
            notes = generateMidiBeatmap(loadedMidiData, selectedDifficulty);
            console.log(`Using MIDI-generated beatmap: ${notes.length} notes`);
        }

        // 重置游戏状态
        gameState.reset();

        // 重置渲染器对象池
        if (renderer) renderer.resetPools();

        // 设置未来时间实现倒计时（谱面时间从倒计时结束时开始计算）
        // 全局偏移：正值使音符更晚到达判定线，负值反之
        const countdownMs = CONFIG.countdownDuration;
        gameState.startTime = performance.now() + countdownMs + audioOffsetMs;

        // 手动设置游戏状态（倒计时通过 startTime 指向未来实现）
        gameState.screen = 'game';
        gameState.notes = notes;
        gameState.totalNotes = notes.length;
        gameState.isPlaying = true;
        gameState.intervalStartTime = performance.now() + countdownMs + audioOffsetMs;

        // 计算音频偏移（MC 谱面的 sound offset，单位 ms）
        const audioOffset = (getLoadedChartData()?.meta?.audioOffset) || 0;

        // 延迟启动音乐（倒计时 + 音频偏移）；记录调度信息以便暂停时顺延
        this._musicDelayMs = countdownMs;
        this._musicScheduledAt = performance.now();
        this._musicRestartDelay = 0;
        this._musicStartTimeout = setTimeout(() => {
            this._musicStartTimeout = null;
            this._playGameMusic(audioOffset);
        }, countdownMs);

        // 确保 Canvas 尺寸正确
        if (renderer) {
            renderer.resize();
        }

        // 启动游戏循环
        requestAnimationFrame(gameLoop);
    }

    /** 按当前加载的数据启动游戏音乐（供倒计时结束或暂停恢复时调用） */
    _playGameMusic(audioOffset) {
        if (loadedMidiData) {
            audioEngine.startMidiMusic([...loadedMidiData.events]);
        } else if (audioEngine.audioBuffer) {
            audioEngine.startAudioPlayback(audioOffset / 1000);
        } else {
            CONFIG.bpm = getLoadedChartData()?.meta?.bpm || 120;
            audioEngine.startPresetMusic();
        }
    }

    endGame() {
        gameState.screen = 'result';
        gameState.isPlaying = false;
        gameState.paused = false;
        // 清除可能挂起的启动音乐定时器（防止结算后音乐再响起）
        if (this._musicStartTimeout) {
            clearTimeout(this._musicStartTimeout);
            this._musicStartTimeout = null;
        }
        audioEngine.stopMusic();
        gameState.recordIntervalStats();
        // 清除所有活跃 hold
        gameState.activeHolds = [null, null, null, null];
        gameState.holdReleaseTimes = [0, 0, 0, 0];

        // 判断是否失败
        const isGameFailed = gameState.health <= 0;

        // 计算最终分数（判定分 + 连击分）
        const scoreResult = gameState.calculateFinalScore();
        gameState.score = scoreResult.finalScore;

        const accuracy = gameState.calculateTotalAcc();

        // 根据分数计算等级
        const rankResult = gameState.calculateRank(scoreResult.finalScore, isGameFailed);
        const rank = rankResult.rank;
        
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
        
        // 根据等级设置特殊样式
        resultCard.classList.remove('result-failed', 'result-phi', 'result-v', 'result-s', 'result-a');
        if (isGameFailed) {
            resultCard.classList.add('result-failed');
        } else if (rank === 'φ') {
            resultCard.classList.add('result-phi');
        } else if (rank === 'V') {
            resultCard.classList.add('result-v');
        } else if (rank === 'S') {
            resultCard.classList.add('result-s');
        } else if (rank === 'A') {
            resultCard.classList.add('result-a');
        }

        // 根据状态更新 UI 样式
        if (isGameFailed) {
            statusEl.classList.add('failed');
            statusIcon.textContent = '✕';
            statusText.textContent = 'FAILED';
        } else {
            statusEl.classList.remove('failed');
            statusIcon.textContent = '✓';
            statusText.textContent = 'COMPLETED';
        }

        rankLabel.textContent = rankResult.rankLabel;

        this.finalScore.textContent    = scoreResult.finalScore.toLocaleString();
        this.finalCombo.textContent    = gameState.maxCombo;
        this.finalAccuracy.textContent = accuracy.toFixed(2) + '%';
        this.finalPerfect.textContent  = gameState.perfect;
        this.finalGreat.textContent    = gameState.great;
        this.finalMiss.textContent     = gameState.miss;

        if (renderer) {
            renderer.drawLineChart(gameState.performanceHistory);
        }

        this.resultScreen.classList.remove('hidden');

        // 保存游玩记录到本地排行榜
        this._saveToLeaderboard(accuracy, rank, isGameFailed);

        // 播放结算音乐
        this.playResultAudio(isGameFailed);
    }

    // ========== 保存记录到排行榜 ==========
    _saveToLeaderboard(accuracy, rank, isGameFailed) {
        if (typeof leaderboard === 'undefined') return;

        try {
            leaderboard.addRecord({
                songName: selectedSongDisplayName || 'Unknown',
                date: new Date().toISOString(),
                score: gameState.score,
                accuracy: accuracy,
                maxCombo: gameState.maxCombo,
                perfect: gameState.perfect,
                great: gameState.great,
                miss: gameState.miss,
                rank: isGameFailed ? 'F' : rank,
                difficulty: selectedDifficulty,
                speed: noteSpeed,
                style: noteStyle,
                isFailed: isGameFailed,
                performanceHistory: gameState.performanceHistory
            });
        } catch (e) {
            console.warn('Failed to save leaderboard record:', e);
        }
    }

    // 根据等级返回标签文本
    getRankLabel(rank) {
        const rankLabels = {
            'φ': 'PHI',
            'V': 'WHITE V',
            'S': 'PERFECT',
            'A': 'EXCELLENT',
            'B': 'GOOD',
            'C': 'PASS',
            'F': 'FAILED'
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
        // 停止所有音频
        audioEngine.stopMusic();
        // 重置游戏状态
        gameState.reset();
        // 重置渲染器对象池
        if (renderer) renderer.resetPools();
        // 隐藏结果和排行榜画面
        this.resultScreen.classList.add('hidden');
        if (this.leaderboardScreen) this.leaderboardScreen.classList.add('hidden');
        // 显示开始画面
        this.startScreen.classList.remove('hidden');
        // 重新渲染开始画面
        _lastFrameTime = performance.now();
        requestAnimationFrame(renderStartScreen);
    }

    // ========== 重新游玩 ==========
    retryGame() {
        // 停止结算音乐等残留播放
        audioEngine.stopMusic();
        if (this._musicStartTimeout) {
            clearTimeout(this._musicStartTimeout);
            this._musicStartTimeout = null;
        }
        // 隐藏结果画面
        this.resultScreen.classList.add('hidden');
        // 直接重新开始当前歌曲
        this.startGame();
    }

    // ========== 持久化设置应用到 UI ==========
    applyStoredSettingsToUI() {
        if (typeof settingsStore === 'undefined') return;

        const s = settingsStore.load();

        // 应用速度
        if (s.noteSpeed !== undefined) {
            noteSpeed = s.noteSpeed;
            this.updateSpeedDisplay();
        }

        // 应用难度
        if (s.difficulty !== undefined) {
            selectedDifficulty = s.difficulty;
            document.querySelectorAll('.diff-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.diff === s.difficulty);
            });
        }

        // 应用样式
        if (s.noteStyle !== undefined) {
            noteStyle = s.noteStyle;
            document.querySelectorAll('.style-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.style === s.noteStyle);
            });
        }

        // 应用全局偏移
        if (s.audioOffset !== undefined && typeof audioOffsetMs !== 'undefined') {
            audioOffsetMs = s.audioOffset;
            if (this.offsetSlider) this.offsetSlider.value = audioOffsetMs;
            if (this.offsetValue) this.offsetValue.textContent = (audioOffsetMs > 0 ? '+' : '') + audioOffsetMs + 'ms';
        }
    }

    // ========== 设置变更时同步持久化 ==========
    _syncSettingsToStore() {
        if (typeof settingsStore !== 'undefined') {
            settingsStore.syncFromRuntime();
        }
    }

    // ========== 成绩导出 (JSON) ==========
    exportResults() {
        const accuracy = gameState.calculateTotalAcc();
        // 与结算一致的等级算法
        const scoreResult = gameState.calculateFinalScore();
        const isFailed = gameState.health <= 0;
        const rank = gameState.calculateRank(scoreResult.finalScore, isFailed).rank;

        const now = new Date();
        const record = {
            version: 1,
            exportedAt: now.toISOString(),
            playerName: typeof leaderboard !== 'undefined' ? leaderboard.getPlayerName() : 'Local',
            songName: selectedSongDisplayName || 'Unknown',
            date: now.toISOString(),
            score: gameState.score,
            accuracy: accuracy,
            maxCombo: gameState.maxCombo,
            perfect: gameState.perfect,
            great: gameState.great,
            miss: gameState.miss,
            rank: rank,
            difficulty: selectedDifficulty,
            speed: noteSpeed,
            style: noteStyle,
            isFailed: gameState.health <= 0,
            performanceHistory: gameState.performanceHistory
        };

        const jsonStr = JSON.stringify(record, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `CyberBeat_Result_${now.getTime()}.json`;
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
        this._syncSettingsToStore();
    }

    setDifficulty(diff) {
        selectedDifficulty = diff;
        document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
        const btn = document.querySelector(`.diff-btn[data-diff="${diff}"]`);
        if (btn) btn.classList.add('active');
        this._syncSettingsToStore();
    }

    setNoteStyle(style) {
        // 关键：更新全局 noteStyle 变量
        noteStyle = style;

        // 更新按钮的 active 状态
        document.querySelectorAll('.style-btn').forEach(b => b.classList.remove('active'));
        const btn = document.querySelector(`.style-btn[data-style="${style}"]`);
        if (btn) btn.classList.add('active');

        this._syncSettingsToStore();
    }

    updateSpeedDisplay() {
        if (this.speedValue) {
            this.speedValue.textContent = noteSpeed.toFixed(1);
        }
    }

    // ========== 全局偏移控制 ==========
    setAudioOffset(ms, updateUI) {
        // 限制在 -100 ~ +100 范围
        audioOffsetMs = Math.max(-100, Math.min(100, ms));

        if (this.offsetSlider) {
            this.offsetSlider.value = audioOffsetMs;
        }
        if (this.offsetValue) {
            this.offsetValue.textContent = (audioOffsetMs > 0 ? '+' : '') + audioOffsetMs + 'ms';
        }

        this._syncSettingsToStore();
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

        this._syncSettingsToStore();
    }

    // ========== 键盘控制 ==========
    setupKeyboardControls() {
        document.addEventListener('keydown', (e) => {
            // 忽略在输入框内的按键
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

            const key = e.key.toLowerCase();

            // Escape: 关闭排行榜
            if (key === 'escape' && this.leaderboardScreen && !this.leaderboardScreen.classList.contains('hidden')) {
                e.preventDefault();
                this.hideLeaderboard();
                return;
            }

            // 开始画面按 Enter
            if (gameState.screen === 'start' && key === 'enter') {
                e.preventDefault();
                this.handleStartOrConfig();
                return;
            }

            // 游戏中的按键
            if (gameState.screen === 'game') {
                // 暂停中快捷操作
                if (gameState.paused) {
                    if (key === 'r') {
                        this.retryGame();
                        return;
                    }
                    if (key === 'h') {
                        audioEngine.stopMusic();
                        this.goToHome();
                        return;
                    }
                }

                // 双击空格：跳过前奏（音乐开始后 10s 内、首个音符尚未出现）
                if (key === ' ') {
                    const nowMs = performance.now();
                    const isDouble = this._lastSpaceDownAt && (nowMs - this._lastSpaceDownAt <= 500);
                    this._lastSpaceDownAt = nowMs;
                    if (isDouble) {
                        e.preventDefault();
                        this.skipIntro();
                        return;
                    }
                }

                // ESC / P 暂停或继续
                if (key === 'escape' || key === 'p') {
                    e.preventDefault();
                    this.togglePause();
                    return;
                }

                // 轨道按键（暂停时不触发判定）
                const trackIndex = KEYS.indexOf(key);
                if (trackIndex !== -1 && !gameState.paused && !gameState.pressedKeys.has(key)) {
                    gameState.pressedKeys.add(key);
                    this.checkHit(trackIndex);
                }
            }
        });

        document.addEventListener('keyup', (e) => {
            const key = e.key.toLowerCase();
            const trackIndex = KEYS.indexOf(key);
            // Hold 释放检查
            if (trackIndex !== -1 && gameState.screen === 'game' && !gameState.paused) {
                this.checkHoldRelease(trackIndex);
            }
            gameState.pressedKeys.delete(key);
        });
    }

    // ========== 跳过前奏 ==========

    /**
     * 跳过前奏：音乐已播放且开始后 10s 内首个音符尚未出现时，
     * 双击空格将场景时间轴与音乐时间轴整体跳到「首个音符前 5s」
     */
    skipIntro() {
        if (gameState.screen !== 'game' || gameState.paused) return;
        if (!audioEngine.isPlaying || audioEngine._paused) return;   // 音乐尚未启动

        const now = performance.now();
        const sceneTime = now - gameState.startTime;
        if (sceneTime < 0 || sceneTime > 10000) return;              // 仅限音乐开始后 10s 内

        const firstNoteTime = this._getFirstNoteTime();
        if (firstNoteTime === null) return;
        if (sceneTime >= firstNoteTime - 5000) return;               // 已进入音符 5s 缓冲区

        const target = Math.max(0, firstNoteTime - 5000);
        const delta = target - sceneTime;                 // 场景时间需前进的量
        gameState.startTime = now - target;               // 直接重定位场景时间轴起点
        gameState.intervalStartTime -= delta;             // 保持与 startTime 的相对偏移不变
        audioEngine.seekMusic(target);
        console.log(`Skipped intro: jumped ${delta.toFixed(0)}ms to T+${target.toFixed(0)}ms`);
    }

    /** 获取当前谱面的首个音符场景时间（ms），无音符返回 null */
    _getFirstNoteTime() {
        if (Array.isArray(gameState.notes) && gameState.notes.length > 0) {
            return gameState.notes[0].time;
        }
        const chartData = getLoadedChartData();
        if (chartData && Array.isArray(chartData.notes) && chartData.notes.length > 0) {
            return chartData.notes[0].time;
        }
        if (loadedMidiData && Array.isArray(loadedMidiData.notes) && loadedMidiData.notes.length > 0) {
            return loadedMidiData.notes[0].time;
        }
        return null;
    }

    // ========== 暂停 / 恢复 ==========
    togglePause() {
        if (gameState.screen !== 'game') return;

        if (gameState.paused) {
            // 恢复：时间轴整体平移暂停时长
            const pauseDuration = performance.now() - gameState.pauseStartedAt;
            gameState.startTime += pauseDuration;
            gameState.intervalStartTime += pauseDuration;
            gameState.paused = false;
            audioEngine.resumeMusic();

            // 若音乐启动定时器挂起中，按剩余延迟重新调度
            if (this._musicRestartDelay > 0 && this._musicDelayMs > 0) {
                this._musicStartTimeout = setTimeout(() => {
                    this._musicStartTimeout = null;
                    this._playGameMusic((getLoadedChartData()?.meta?.audioOffset) || 0);
                }, this._musicRestartDelay);
                this._musicRestartDelay = 0;
            }
        } else {
            const currentTime = performance.now() - gameState.startTime;
            if (currentTime < 0) return; // 倒计时中不允许暂停
            gameState.paused = true;
            gameState.pauseStartedAt = performance.now();
            gameState.pauseSnapshotTime = currentTime;
            // 清空按键状态，避免暂停期间的按键在恢复后被当作长按
            gameState.pressedKeys.clear();

            // 音乐尚未启动（定时器挂起中）：暂停时顺延其剩余时间
            if (this._musicStartTimeout) {
                clearTimeout(this._musicStartTimeout);
                this._musicStartTimeout = null;
                this._musicRestartDelay = Math.max(0, this._musicDelayMs - (performance.now() - this._musicScheduledAt));
            } else {
                this._musicRestartDelay = 0;
            }

            audioEngine.pauseMusic();
        }
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

                if (gameState.screen === 'game' && !gameState.paused) {
                    this.checkHit(index);
                }
            });

            btn.addEventListener('pointerup', (e) => {
                e.preventDefault();
                btn.classList.remove('active');
                if (gameState.screen === 'game' && !gameState.paused) {
                    this.checkHoldRelease(index);
                }
                gameState.pressedKeys.delete(KEYS[index]);
            });

            btn.addEventListener('pointerleave', (e) => {
                btn.classList.remove('active');
                if (gameState.screen === 'game' && !gameState.paused) {
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
                if (gameState.screen !== 'game' || gameState.paused) return;
                e.preventDefault();
                for (const touch of e.changedTouches) {
                    this._handleCanvasTouch(touch.clientX, touch.clientY, true);
                }
            }, { passive: false });

            canvas.addEventListener('touchend', (e) => {
                if (gameState.screen !== 'game' || gameState.paused) return;
                e.preventDefault();
                for (const touch of e.changedTouches) {
                    this._handleCanvasTouch(touch.clientX, touch.clientY, false);
                }
            }, { passive: false });

            canvas.addEventListener('touchcancel', (e) => {
                if (gameState.screen !== 'game' || gameState.paused) return;
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
        if (gameState.paused) return false;

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
                // 存储头部判定结果，用于后续提前松开时修正计数
                note._headWasPerfect = isPerfect;

                if (isPerfect) {
                    gameState.perfect++;
                    gameState.intervalStats.perfect++;
                    renderer.addJudgment('PERFECT', judgmentY, track);
                    audioEngine.playHitSound('perfect');
                } else {
                    gameState.great++;
                    gameState.intervalStats.great++;
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
                renderer.addJudgment('PERFECT', judgmentY, track);
                audioEngine.playHitSound('perfect');
            } else {
                gameState.great++;
                gameState.intervalStats.great++;
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

    // ========== 排行榜 UI ==========

    /** 设置排行榜相关事件监听 */
    _setupLeaderboardEvents() {
        // 关闭按钮
        if (this.lbCloseBtn) {
            this.lbCloseBtn.addEventListener('click', () => this.hideLeaderboard());
        }
        if (this.lbBackBtn) {
            this.lbBackBtn.addEventListener('click', () => this.hideLeaderboard());
        }

        // 歌曲筛选
        if (this.lbSongFilter) {
            this.lbSongFilter.addEventListener('change', () => this._renderLeaderboardList());
        }

        // 排序按钮
        document.querySelectorAll('.lb-sort-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.lb-sort-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this._renderLeaderboardList();
            });
        });

        // 导出全部
        if (this.lbExportAllBtn) {
            this.lbExportAllBtn.addEventListener('click', () => this._exportAllRecords());
        }

        // 导入
        if (this.lbImportBtn && this.lbImportFile) {
            this.lbImportBtn.addEventListener('click', () => this.lbImportFile.click());
            this.lbImportFile.addEventListener('change', (e) => this._importRecords(e));
        }

        // 详情关闭
        if (this.lbDetailClose) {
            this.lbDetailClose.addEventListener('click', () => {
                if (this.lbDetail) this.lbDetail.style.display = 'none';
            });
        }

        // 详情删除
        if (this.lbDetailDelete) {
            this.lbDetailDelete.addEventListener('click', () => this._deleteDetailedRecord());
        }
    }

    /** 显示排行榜 */
    showLeaderboard(fromResult = true) {
        if (typeof leaderboard === 'undefined') {
            alert('Leaderboard system not available.');
            return;
        }

        this._lbOrigin = fromResult ? 'result' : 'start';

        // 按来源设置默认筛选与排序：
        // 首页 → 全部歌曲 + 按分数；结算页 → 仅当前歌曲 + 按分数
        this._lbDefaultFilter = (fromResult && selectedSongDisplayName) ? selectedSongDisplayName : '__all__';
        this._lbDefaultSort = 'score';

        // 根据来源隐藏对应画面
        if (fromResult && this.resultScreen) {
            this.resultScreen.classList.add('hidden');
        } else if (!fromResult && this.startScreen) {
            this.startScreen.classList.add('hidden');
        }

        // 激活默认排序按钮
        document.querySelectorAll('.lb-sort-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.sort === this._lbDefaultSort);
        });

        this._populateSongFilter();
        this._renderLeaderboardList();

        // 隐藏详情面板
        if (this.lbDetail) this.lbDetail.style.display = 'none';

        if (this.leaderboardScreen) {
            this.leaderboardScreen.classList.remove('hidden');
        }
    }

    /** 隐藏排行榜 */
    hideLeaderboard() {
        if (this.leaderboardScreen) {
            this.leaderboardScreen.classList.add('hidden');
        }
        // 重置游戏状态，确保界面干净
        gameState.reset();
        if (renderer) renderer.resetPools();
        if (this._lbOrigin === 'result' && this.resultScreen) {
            // 从结算页面进入：返回结算页面（保留成绩显示）
            this.resultScreen.classList.remove('hidden');
            this.startScreen.classList.add('hidden');
        } else {
            // 从开始画面进入：返回开始画面
            this.startScreen.classList.remove('hidden');
            _lastFrameTime = performance.now();
            requestAnimationFrame(renderStartScreen);
        }
        this._lbOrigin = 'start';
    }

    /** 填充歌曲筛选下拉框 */
    _populateSongFilter() {
        if (!this.lbSongFilter) return;

        const summaries = leaderboard.getAllSongSummaries();

        this.lbSongFilter.innerHTML = '<option value="__all__">All Songs</option>';

        summaries.forEach(s => {
            const option = document.createElement('option');
            option.value = s.songName;
            option.textContent = `${s.songName} (${s.recordCount})`;
            this.lbSongFilter.appendChild(option);
        });

        // 按来源默认值选中（返回结算页时只看当前歌曲；首页看全部）
        if (this._lbDefaultFilter && [...this.lbSongFilter.options].some(o => o.value === this._lbDefaultFilter)) {
            this.lbSongFilter.value = this._lbDefaultFilter;
        } else {
            this.lbSongFilter.value = '__all__';
        }
    }

    /** 获取当前排序方式 */
    _getCurrentSortBy() {
        const activeBtn = document.querySelector('.lb-sort-btn.active');
        return activeBtn ? activeBtn.dataset.sort : 'score';
    }

    /** 渲染排行榜列表 */
    _renderLeaderboardList() {
        if (!this.lbList) return;

        const songFilter = this.lbSongFilter ? this.lbSongFilter.value : '__all__';
        const sortBy = this._getCurrentSortBy();
        let records = [];

        if (songFilter === '__all__') {
            // 显示所有歌曲的记录
            const summaries = leaderboard.getAllSongSummaries();
            for (const summary of summaries) {
                const songRecords = leaderboard.getRecords(summary.songName, sortBy);
                records = records.concat(songRecords);
            }
            // 重新按全局排序
            switch (sortBy) {
                case 'score':
                    records.sort((a, b) => b.score - a.score);
                    break;
                case 'accuracy':
                    records.sort((a, b) => b.accuracy - a.accuracy);
                    break;
                case 'date':
                default:
                    records.sort((a, b) => new Date(b.date) - new Date(a.date));
                    break;
            }
        } else {
            records = leaderboard.getRecords(songFilter, sortBy);
        }

        if (records.length === 0) {
            this.lbList.innerHTML = `
                <div class="lb-empty">
                    <span class="lb-empty-icon">-</span>
                    <span>No records yet</span>
                    <span class="lb-empty-hint">Play a song to record your score!</span>
                </div>`;
            return;
        }

        let html = '';
        records.forEach((r, i) => {
            const dateStr = new Date(r.date).toLocaleDateString();
            const timeStr = new Date(r.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const rankClass = this._getRecordRankClass(r.rank);

            // 排名标记
            let rankIcon = '';
            if (sortBy === 'score' || sortBy === 'accuracy') {
                if (i === 0) rankIcon = '<span class="lb-record-rank top1">1</span>';
                else if (i === 1) rankIcon = '<span class="lb-record-rank top2">2</span>';
                else if (i === 2) rankIcon = '<span class="lb-record-rank top3">3</span>';
                else rankIcon = `<span class="lb-record-rank">${i + 1}</span>`;
            } else {
                rankIcon = `<span class="lb-record-rank">${i + 1}</span>`;
            }

            html += `
                <div class="lb-record" data-record-id="${r.id}" data-song="${this._escapeAttr(r.songName)}">
                    ${rankIcon}
                    <div class="lb-record-info">
                        <span class="lb-record-name">${this.escapeHTML(r.songName)}</span>
                        <span class="lb-record-meta">${r.playerName} · ${r.difficulty.toUpperCase()} · ${r.speed.toFixed(1)}x · ${dateStr} ${timeStr}</span>
                    </div>
                    <div class="lb-record-stats">
                        <span class="lb-record-score">${r.score.toLocaleString()}</span>
                        <span class="lb-record-acc">${r.accuracy.toFixed(2)}%</span>
                    </div>
                    <span class="lb-record-rank-badge ${rankClass}">${r.rank}</span>
                </div>`;
        });

        this.lbList.innerHTML = html;

        // 绑定点击事件以展开详情
        this.lbList.querySelectorAll('.lb-record').forEach(recordEl => {
            recordEl.addEventListener('click', () => {
                const recordId = recordEl.dataset.recordId;
                const songName = recordEl.dataset.song;
                this._showRecordDetail(songName, recordId);
            });
        });
    }

    /** 显示记录详情（含折线图） */
    _showRecordDetail(songName, recordId) {
        if (!this.lbDetail) return;

        const records = leaderboard.getRecords(songName, 'date');
        const record = records.find(r => r.id === recordId);
        if (!record) return;

        // 更新标题
        if (this.lbDetailTitle) {
            const dateStr = new Date(record.date).toLocaleString();
            this.lbDetailTitle.textContent = `${record.songName} - ${dateStr}`;
        }

        // 更新统计信息
        if (this.lbDetailStats) {
            this.lbDetailStats.innerHTML = `
                <div class="stat-mini">
                    <span class="stat-mini-label">SCORE</span>
                    <span class="stat-mini-value">${record.score.toLocaleString()}</span>
                </div>
                <div class="stat-mini">
                    <span class="stat-mini-label">ACC</span>
                    <span class="stat-mini-value">${record.accuracy.toFixed(2)}%</span>
                </div>
                <div class="stat-mini">
                    <span class="stat-mini-label">MAX COMBO</span>
                    <span class="stat-mini-value">${record.maxCombo}</span>
                </div>
                <div class="stat-mini">
                    <span class="stat-mini-label">RANK</span>
                    <span class="stat-mini-value" style="color:${this._getRankColor(record.rank)}">${record.rank}</span>
                </div>
                <div class="stat-mini">
                    <span class="stat-mini-label">PERFECT</span>
                    <span class="stat-mini-value" style="color:#ffd43b">${record.perfect}</span>
                </div>
                <div class="stat-mini">
                    <span class="stat-mini-label">GREAT</span>
                    <span class="stat-mini-value" style="color:#69db7c">${record.great}</span>
                </div>
                <div class="stat-mini">
                    <span class="stat-mini-label">MISS</span>
                    <span class="stat-mini-value" style="color:#ff6b6b">${record.miss}</span>
                </div>
                <div class="stat-mini">
                    <span class="stat-mini-label">SPEED</span>
                    <span class="stat-mini-value">${record.speed.toFixed(1)}x</span>
                </div>
            `;
        }

        // 存储当前查看的记录信息
        this._detailSongName = songName;
        this._detailRecordId = recordId;
        // 同时存下 history 引用，便于在布局完成后绘制图表
        this._pendingChartHistory = (record.performanceHistory && record.performanceHistory.length > 0)
            ? record.performanceHistory : null;

        // 关键：先让详情面板可见，浏览器完成布局后再绘制折线图
        this.lbDetail.style.display = 'flex';

        // 延迟一帧等待布局计算完成，确保 canvas 父容器有正确的尺寸
        requestAnimationFrame(() => {
            if (this._pendingChartHistory) {
                this._drawDetailChart(this._pendingChartHistory);
            } else if (this.lbChartCanvas) {
                const parent = this.lbChartCanvas.parentElement;
                const w = parent ? parent.clientWidth : 300;
                const h = parent ? parent.clientHeight : 140;
                this.lbChartCanvas.width = w;
                this.lbChartCanvas.height = h;
                const ctx = this.lbChartCanvas.getContext('2d');
                ctx.clearRect(0, 0, w, h);
                ctx.fillStyle = 'rgba(255,255,255,0.3)';
                ctx.font = '12px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('No performance data', w / 2, h / 2);
            }
            this._pendingChartHistory = null;
        });
    }

    /** 绘制详情折线图（对齐 renderer.drawLineChart 的实现） */
    _drawDetailChart(history) {
        if (!this.lbChartCanvas) return;

        const canvas = this.lbChartCanvas;
        const parent = canvas.parentElement;
        if (!parent) return;

        // 使用 clientWidth/clientHeight 获取 CSS 布局尺寸（与 renderer 版本一致）
        const w = parent.clientWidth;
        const h = parent.clientHeight;
        if (w <= 0 || h <= 0) return;

        canvas.width = w;
        canvas.height = h;

        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, w, h);

        if (!history || history.length === 0) return;

        const leftMargin = 40, topMargin = 18, bottomMargin = 22, rightMargin = 14;
        const chartW = w - leftMargin - rightMargin;
        const chartH = h - topMargin - bottomMargin;

        if (chartW <= 0 || chartH <= 0) return;

        // 背景
        ctx.fillStyle = 'rgba(255,255,255,0.02)';
        ctx.fillRect(0, 0, w, h);

        // ---- 动态 Y 轴范围 ----
        let minAcc = 100, maxAcc = 0;
        for (let i = 0; i < history.length; i++) {
            const acc = history[i].totalAcc;
            if (acc < minAcc) minAcc = acc;
            if (acc > maxAcc) maxAcc = acc;
        }

        // 如果所有值相同，给它一点呼吸空间
        if (minAcc === maxAcc) {
            minAcc = Math.max(0, minAcc - 10);
            maxAcc = Math.min(100, maxAcc + 10);
        }

        const range = maxAcc - minAcc;
        const padding = range * 0.1;
        const yMin = Math.max(0, minAcc - padding);
        const yMax = Math.min(100, maxAcc + padding);
        const yRange = yMax - yMin;

        // ---- Y 轴刻度和网格 ----
        const yTicks = this._generateYTicks(yMin, yMax);

        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';

        for (let i = 0; i < yTicks.length; i++) {
            const yPos = topMargin + chartH - (chartH * (yTicks[i] - yMin) / yRange);
            ctx.fillText(yTicks[i].toFixed(0) + '%', leftMargin - 5, yPos);
        }

        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        for (let i = 0; i < yTicks.length; i++) {
            const yPos = topMargin + chartH - (chartH * (yTicks[i] - yMin) / yRange);
            ctx.beginPath();
            ctx.moveTo(leftMargin, yPos);
            ctx.lineTo(leftMargin + chartW, yPos);
            ctx.stroke();
        }

        // ---- X 轴标签 ----
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '8px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        const totalDuration = history[history.length - 1].time;
        const xSteps = Math.min(5, history.length);
        for (let i = 0; i <= xSteps; i++) {
            const fraction = xSteps > 0 ? i / xSteps : 0;
            const x = leftMargin + chartW * fraction;
            const sec = Math.round((totalDuration / 1000) * fraction);
            ctx.fillText(sec + 's', x, topMargin + chartH + 6);
        }

        // ---- 折线 ----
        const pointSpacing = history.length > 1 ? chartW / (history.length - 1) : 0;

        ctx.strokeStyle = '#4dabf7';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < history.length; i++) {
            const x = leftMargin + i * pointSpacing;
            const normAcc = (history[i].totalAcc - yMin) / yRange;
            const y = topMargin + chartH - (chartH * normAcc);
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();

        // ---- 数据点 ----
        ctx.fillStyle = '#4dabf7';
        for (let i = 0; i < history.length; i++) {
            const x = leftMargin + i * pointSpacing;
            const normAcc = (history[i].totalAcc - yMin) / yRange;
            const y = topMargin + chartH - (chartH * normAcc);
            ctx.beginPath();
            ctx.arc(x, y, 2.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /** 生成 Y 轴刻度（与 renderer._generateYTicks 一致） */
    _generateYTicks(min, max) {
        const range = max - min;
        let interval = 10;
        if (range <= 10) interval = 2;
        else if (range <= 20) interval = 5;
        else if (range <= 50) interval = 10;
        else if (range <= 100) interval = 20;

        const ticks = [];
        const start = Math.ceil(min / interval) * interval;
        const end = Math.floor(max / interval) * interval;
        for (let i = start; i <= end; i += interval) {
            if (i >= min && i <= max) ticks.push(i);
        }
        if (ticks.length < 3) {
            ticks.push(Math.round(min));
            ticks.push(Math.round(max));
            ticks.sort((a, b) => a - b);
        }
        return [...new Set(ticks)];
    }

    /** 删除当前查看的记录（多重防护） */
    _deleteDetailedRecord() {
        if (!this._detailSongName || !this._detailRecordId) return;

        // 防护 1：确认弹窗 - 明确告知不可撤销
        const recordDate = this.lbDetailTitle
            ? this.lbDetailTitle.textContent.replace(/^.* - /, '')
            : 'this record';
        const warnMsg = [
            'WARNING: This action cannot be undone!',
            '',
            `You are about to permanently delete:`,
            `  Song: ${this._detailSongName}`,
            `  Date: ${recordDate}`,
            '',
            'This record will be removed from your local leaderboard forever.',
            '',
            'Are you sure you want to continue?'
        ].join('\n');

        if (!confirm(warnMsg)) return;

        // 防护 2：二次确认 - 要求明确输入 DELETE 才执行
        const secondMsg = [
            'FINAL CONFIRMATION',
            '',
            'This is your last chance to cancel.',
            'The record will be permanently erased.',
            '',
            'Type "DELETE" (all caps) in the box below to confirm.'
        ].join('\n');

        const userInput = prompt(secondMsg, '');
        if (userInput !== 'DELETE') {
            if (userInput !== null) {
                alert('Deletion cancelled.\nYou must type "DELETE" exactly to confirm.');
            }
            return;
        }

        // 防护 3：执行删除前短暂高亮警示（视觉反馈）
        if (this.lbDetail) {
            this.lbDetail.style.transition = 'box-shadow 0.15s ease';
            this.lbDetail.style.boxShadow = 'inset 0 0 40px rgba(255, 107, 107, 0.5)';
        }

        // 实际删除
        const deleted = leaderboard.deleteRecord(this._detailSongName, this._detailRecordId);

        // 清除高亮
        setTimeout(() => {
            if (this.lbDetail) {
                this.lbDetail.style.boxShadow = '';
                this.lbDetail.style.transition = '';
            }
        }, 300);

        if (deleted) {
            // 清除当前详情引用
            this._detailSongName = null;
            this._detailRecordId = null;

            // 隐藏详情面板
            if (this.lbDetail) this.lbDetail.style.display = 'none';

            // 刷新列表
            this._populateSongFilter();
            this._renderLeaderboardList();
        }
    }

    /** 导出全部排行榜数据 */
    _exportAllRecords() {
        if (typeof leaderboard === 'undefined') return;

        const jsonStr = leaderboard.exportAll();
        const now = new Date();
        leaderboard.downloadFile(jsonStr, `CyberBeat_Leaderboard_${now.getTime()}.json`);
    }

    /** 导入排行榜数据 */
    _importRecords(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const result = leaderboard.importData(e.target.result, 'merge');
                if (result.success) {
                    alert(result.message);
                } else {
                    alert('Import failed: ' + result.message);
                }
                this._populateSongFilter();
                this._renderLeaderboardList();
            } catch (err) {
                alert('Import error: ' + err.message);
            }
            event.target.value = '';
        };

        reader.onerror = () => {
            alert('Failed to read file.');
            event.target.value = '';
        };

        reader.readAsText(file);
    }

    /** 获取记录排名等级 CSS class */
    _getRecordRankClass(rank) {
        switch (rank) {
            case 'φ': return 'rank-phi';
            case 'V': return 'rank-v';
            case 'S': return 'rank-s';
            case 'A': return 'rank-a';
            case 'B': return 'rank-b';
            case 'C': return 'rank-c';
            case 'F': return 'rank-f';
            default: return 'rank-c';
        }
    }

    /** 获取排名颜色 */
    _getRankColor(rank) {
        switch (rank) {
            case 'φ': return '#ffd700';
            case 'V': return '#e0e0e0';
            case 'S': return '#ffd43b';
            case 'A': return '#4dabf7';
            case 'B': return '#69db7c';
            case 'C': return '#ffffff';
            case 'F': return '#ff6b6b';
            default: return '#ffffff';
        }
    }

    /** HTML 属性转义 */
    _escapeAttr(str) {
        return (str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /**
     * Hold 长条释放检查（keyup 时触发）
     * 宽松判定：记录松开时间，40ms 内补按则不算 miss
     */
    checkHoldRelease(track) {
        if (!renderer) return;
        if (gameState.paused) return;

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
        if (gameState.paused) return;

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
                    // 宽限期超时 → 将头部判定修正为 Miss（防止同一音符双重计数）
                    holdNote.holdActive = false;
                    holdNote.holdReleased = true;
                    gameState.activeHolds[track] = null;
                    gameState.holdReleaseTimes[track] = 0;

                    // 如果头部已被判定为 perfect/great，修正为 miss
                    if (holdNote._headWasPerfect === true) {
                        gameState.perfect--;
                        gameState.intervalStats.perfect = Math.max(0, gameState.intervalStats.perfect - 1);
                    } else if (holdNote._headWasPerfect === false) {
                        gameState.great--;
                        gameState.intervalStats.great = Math.max(0, gameState.intervalStats.great - 1);
                    }
                    gameState.miss++;
                    gameState.intervalStats.miss++;
                    gameState.combo = 0;
                    gameState.health = Math.max(0, gameState.health - CONFIG.health.lossOnMiss);

                    const judgmentY = renderer.canvasHeight * CONFIG.judgmentLineY;
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

                gameState.health = Math.min(CONFIG.health.initial, gameState.health + 1);

                const judgmentY = renderer.canvasHeight * CONFIG.judgmentLineY;
                renderer.createLaser(track);
            }
        }
    }
}