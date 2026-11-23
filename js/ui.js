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

        // 移动端 / 游戏内 UI 状态
        this._isTouchDevice = typeof IS_TOUCH_DEVICE !== 'undefined' ? IS_TOUCH_DEVICE : false;
        this._skipIntroVisible = false;
        this._pauseOverlayVisible = false;
        this._wakeLock = null;
        // 音频：当前歌曲的伴奏缓存 key / 预加载状态
        this._gameAudioKey = null;      // 谱面歌曲 → 'song:<id>'；导入音频 → 'import:<...>'；MIDI → null
        this._pendingAudioKey = null;
        this._pendingAudioReady = null;
        this._pendingAudioFailed = false;

        // 应用持久化设置到运行时变量
        if (typeof settingsStore !== 'undefined') {
            settingsStore.applyToRuntime();
        }

        this.cacheDOMElements();
        this.setupEventListeners();
        this._setupDragAndDrop();
        // 记录首屏曲库加载 promise，供启动遮罩等待
        this._libraryPromise = this.loadSongLibrary();
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

        // 游戏内触控 UI
        this.gamePauseBtn    = document.getElementById('gamePauseBtn');
        this.skipIntroBtn    = document.getElementById('skipIntroBtn');
        this.pauseOverlay    = document.getElementById('pauseOverlay');
        this.pauseResumeBtn  = document.getElementById('pauseResumeBtn');
        this.pauseRetryBtn   = document.getElementById('pauseRetryBtn');
        this.pauseHomeBtn    = document.getElementById('pauseHomeBtn');
        this.pauseSongTitle  = document.getElementById('pauseSongTitle');
        this.pauseScore      = document.getElementById('pauseScore');
        this.pauseAcc        = document.getElementById('pauseAcc');
        this.pauseCombo      = document.getElementById('pauseCombo');
        this.skinHint        = document.getElementById('skinHint');
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

        // 速度（支持长按连发：按住 500ms 后每 100ms 重复一步，松开停止）
        const speedUpBtn = document.getElementById('speedUp');
        const speedDownBtn = document.getElementById('speedDown');
        if (speedUpBtn) {
            this._bindSpeedButton(speedUpBtn, SPEED_STEP);
        }
        if (speedDownBtn) {
            this._bindSpeedButton(speedDownBtn, -SPEED_STEP);
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

        // 皮肤（Malody V / 内置扁平）
        document.querySelectorAll('.skin-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setSkin(btn.dataset.skin);
            });
        });

        // 标签页切换
        this.tabMidi.addEventListener('click', () => this.switchTab('midi'));
        this.tabSongs.addEventListener('click', () => this.switchTab('songs'));

        // 移动端选曲增强（仅触屏设备）：
        // 1. 双击歌曲卡片 → 直接进入设置页（省一次 START 点按）
        // 2. 滚动惯性中抑制卡片 click（防止滑动列表时误选歌）
        if (IS_TOUCH_DEVICE) {
            this._setupTouchSongListEnhancements();
        }

        // 触屏操作指南（首次进入游戏时显示一次）
        this.touchHint = document.getElementById('touchHint');
        this.touchHintClose = document.getElementById('touchHintClose');
        if (this.touchHintClose) {
            this.touchHintClose.addEventListener('click', () => this._hideTouchHint(true));
        }
        let touchHintSeen = false;
        try { touchHintSeen = !!localStorage.getItem('cyberbeat_touch_hint_seen'); } catch (e) { /* ignore */ }
        this._pendingTouchHint = IS_TOUCH_DEVICE && !touchHintSeen;

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

        // 触控点显示开关（仅触屏设备显示该分组）
        this.touchFeedbackToggle = document.getElementById('touchFeedbackToggle');
        this.touchFeedbackGroup = document.getElementById('touchFeedbackGroup');
        if (this.touchFeedbackToggle) {
            this.touchFeedbackToggle.addEventListener('click', () => {
                touchFeedbackEnabled = !touchFeedbackEnabled;
                this._updateTouchFeedbackToggle();
                this._syncSettingsToStore();
            });
            this._updateTouchFeedbackToggle();
        }

        // 游戏内触控 UI
        if (this.gamePauseBtn) {
            this.gamePauseBtn.addEventListener('click', () => this.togglePause());
            // 触屏设备：连点 5 次（500ms 内）切换性能监控面板
            this._perfTapCount = 0;
            this._perfTapTimer = null;
            this.gamePauseBtn.addEventListener('pointerdown', () => {
                if (!IS_TOUCH_DEVICE) return;
                this._perfTapCount++;
                clearTimeout(this._perfTapTimer);
                this._perfTapTimer = setTimeout(() => { this._perfTapCount = 0; }, 500);
                if (this._perfTapCount >= 5) {
                    this._perfTapCount = 0;
                    perfMonitor.toggle();
                }
            });
        }
        if (this.skipIntroBtn) {
            this.skipIntroBtn.addEventListener('click', () => this.skipIntro());
        }
        if (this.pauseResumeBtn) {
            this.pauseResumeBtn.addEventListener('click', () => this.togglePause());
        }
        if (this.pauseRetryBtn) {
            this.pauseRetryBtn.addEventListener('click', () => this.retryGame());
        }
        if (this.pauseHomeBtn) {
            this.pauseHomeBtn.addEventListener('click', () => this.goToHome());
        }

        // 键盘
        this.setupKeyboardControls();

        // 移动端
        this._setupTouchInput();

        // 首次用户手势解锁音频（iOS 静音策略）
        this._setupAudioUnlock();

        // 切到后台自动暂停 + 唤醒锁
        this._setupVisibilityHandling();

        // 禁止右键菜单
        document.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    // ========== 音频解锁 ==========
    _setupAudioUnlock() {
        const unlock = () => {
            if (typeof audioEngine !== 'undefined' && audioEngine.unlock) {
                audioEngine.unlock();
            }
        };
        ['pointerdown', 'touchstart', 'keydown', 'click'].forEach((evt) => {
            document.addEventListener(evt, unlock, { once: true, passive: true });
        });
    }

    // ========== 页面可见性 / 唤醒锁 ==========
    _setupVisibilityHandling() {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                if (gameState.screen !== 'game') return;

                if (gameState.resumeCountdownUntil > 0) {
                    // 恢复倒计时中切后台：回到暂停态（画面冻结、判定暂停），
                    // 记录剩余倒计时与待平移量，回前台后重新走 3-2-1
                    const hiddenAt = performance.now();
                    const remaining = gameState.resumeCountdownUntil - hiddenAt;
                    gameState.resumeCountdownUntil = 0;
                    gameState._stashedResumeShift = gameState._pendingResumeShift || 0;
                    gameState._pendingResumeShift = 0;
                    gameState._resumeCountdownRemaining = Math.max(0, remaining);
                    gameState.paused = true;
                    gameState.pauseStartedAt = hiddenAt;
                    if (renderer) renderer.resetTouchPoints();
                    this._clearCanvasTouchTracks();
                    this._setPauseOverlayVisible(true);
                    return;
                }

                if (!gameState.paused) {
                    // 触屏指南打开时倒计时已冻结，后台切换无需处理
                    if (gameState._initialCountdownFrozen) return;

                    const currentTime = performance.now() - gameState.startTime;
                    if (currentTime < 0) {
                        // 初始倒计时中切后台：冻结剩余倒计时（回到前台时重设），
                        // 防止后台期间 performance.now() 继续走消耗倒计时、音乐调度错位
                        gameState._initialCountdownRemaining = -currentTime;
                        gameState._initialCountdownFrozen = true;
                        // 暂停挂起的音乐启动定时器
                        if (this._musicStartTimeout) {
                            clearTimeout(this._musicStartTimeout);
                            this._musicStartTimeout = null;
                            this._musicRestartDelay = Math.max(0, this._musicDelayMs - (performance.now() - this._musicScheduledAt));
                        }
                        return;
                    }
                    this.togglePause();
                }
            } else {
                // 回到前台
                const inGame = gameState.screen === 'game';
                // 触屏指南打开中：倒计时保持冻结，等指南关闭时统一恢复
                if (inGame && this.touchHint && !this.touchHint.classList.contains('hidden')) {
                    return;
                }
                // 初始倒计时被冻结：以剩余量重设倒计时与音乐调度
                if (inGame && gameState._initialCountdownFrozen) {
                    const remaining = Math.max(0, gameState._initialCountdownRemaining || 0);
                    gameState._initialCountdownFrozen = false;
                    gameState._initialCountdownRemaining = 0;
                    gameState.startTime = performance.now() + remaining;
                    gameState.intervalStartTime = gameState.startTime;
                    this._musicDelayMs = remaining;
                    this._musicScheduledAt = performance.now();
                    if (this._musicRestartDelay > 0 || remaining > 0) {
                        if (this._musicStartTimeout) clearTimeout(this._musicStartTimeout);
                        this._musicStartTimeout = setTimeout(() => {
                            this._musicStartTimeout = null;
                            this._playGameMusic((getLoadedChartData()?.meta?.audioOffset) || 0);
                        }, remaining);
                        this._musicRestartDelay = 0;
                    }
                } else if (inGame && gameState._resumeCountdownRemaining > 0) {
                    // 恢复倒计时被冻结：重新走 3-2-1（还原待平移量）
                    gameState.paused = false;
                    gameState._pendingResumeShift = gameState._stashedResumeShift || 0;
                    gameState._stashedResumeShift = 0;
                    gameState.resumeCountdownUntil = performance.now() + gameState._resumeCountdownRemaining;
                    gameState._resumeCountdownRemaining = 0;
                    this._setPauseOverlayVisible(false);
                }
                if (inGame && !gameState.paused) {
                    this._requestWakeLock();
                }
            }
        });
    }

    async _requestWakeLock() {
        if (!('wakeLock' in navigator) || document.hidden) return;
        try {
            if (this._wakeLock) return;
            this._wakeLock = await navigator.wakeLock.request('screen');
            this._wakeLock.addEventListener('release', () => {
                this._wakeLock = null;
            });
        } catch (err) {
            this._wakeLock = null;
        }
    }

    _releaseWakeLock() {
        if (this._wakeLock) {
            try { this._wakeLock.release(); } catch (err) { /* ignore */ }
            this._wakeLock = null;
        }
    }

    // ========== 游戏内 UI 状态 ==========
    /** 每帧调用，按需显示/隐藏跳过前奏按钮与暂停按钮 */
    updateInGameUI() {
        const inGame = gameState.screen === 'game';
        // 恢复倒计时期间保持暂停按钮可见（可再按取消恢复）
        const resuming = gameState.resumeCountdownUntil > 0;
        if (this.gamePauseBtn) {
            this.gamePauseBtn.classList.toggle('hidden', !inGame || (gameState.paused && !resuming));
        }
        if (!inGame || gameState.paused) {
            this.setSkipIntroVisible(false);
            return;
        }
        this.setSkipIntroVisible(this._canSkipIntro());
    }

    _canSkipIntro() {
        if (gameState.screen !== 'game' || gameState.paused) return false;
        if (!audioEngine.isPlaying || audioEngine._paused) return false;

        const sceneTime = performance.now() - gameState.startTime;
        if (sceneTime < 0 || sceneTime > 10000) return false;

        const firstNoteTime = this._getFirstNoteTime();
        if (firstNoteTime === null) return false;
        return sceneTime < firstNoteTime - 5000;
    }

    setSkipIntroVisible(visible) {
        if (!this.skipIntroBtn || this._skipIntroVisible === visible) return;
        this._skipIntroVisible = visible;
        this.skipIntroBtn.classList.toggle('hidden', !visible);
    }

    _setPauseOverlayVisible(visible) {
        this._pauseOverlayVisible = visible;
        document.body.classList.toggle('paused', visible);
        if (this.pauseOverlay) {
            this.pauseOverlay.classList.toggle('hidden', !visible);
        }
        if (visible) {
            this.setSkipIntroVisible(false);
            this._updatePauseStats();
        }
        if (this.gamePauseBtn) {
            this.gamePauseBtn.classList.toggle('hidden', visible || gameState.screen !== 'game');
        }
    }

    /** 刷新暂停面板中的曲目与实时成绩 */
    _updatePauseStats() {
        const info = renderer && renderer._songInfo;
        if (this.pauseSongTitle) {
            this.pauseSongTitle.textContent = (info && info.title) || selectedSongDisplayName || '—';
        }
        if (this.pauseScore) {
            this.pauseScore.textContent = gameState.calculateFinalScore().finalScore.toLocaleString();
        }
        if (this.pauseAcc) {
            this.pauseAcc.textContent = gameState.calculateTotalAcc().toFixed(2) + '%';
        }
        if (this.pauseCombo) {
            this.pauseCombo.textContent = String(gameState.combo);
        }
    }

    // ========== 曲库加载 ==========
    async loadSongLibrary() {
        // 先铺骨架屏（首屏/重试时都能立刻看到"正在加载"而不是空列表）
        this.renderSongList();
        try {
            const response = await fetch(CONFIG.songListUrl);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            songLibrary = data.songs || [];
            this._libraryLoadFailed = false;
        } catch (err) {
            console.error('Failed to load song library:', err);
            songLibrary = [];
            this._libraryLoadFailed = true;
        } finally {
            this.songLibraryLoaded = true;
            this.renderSongList();
        }
    }

    /** 曲库加载失败重试（弱网/服务器临时不可用时用户可手动重试） */
    async retryLoadSongLibrary() {
        if (this._libraryRetrying) return;
        this._libraryRetrying = true;
        document.querySelectorAll('.library-retry-btn').forEach(btn => {
            btn.disabled = true;
            btn.textContent = 'RETRYING…';
        });
        await this.loadSongLibrary();
        this._libraryRetrying = false;
    }

    /** 拖拽导入：把 .mid / .osu / .osz 拖进页面即可导入（仅选曲界面） */
    _setupDragAndDrop() {
        const hint = document.getElementById('dropHint');
        const show = (on) => { if (hint) hint.classList.toggle('hidden', !on); };
        const isFileDrag = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
        let depth = 0;

        window.addEventListener('dragenter', (e) => {
            if (!isFileDrag(e)) return;
            e.preventDefault();
            if (gameState.screen !== 'start') return;
            depth++;
            show(true);
        });
        window.addEventListener('dragover', (e) => {
            if (!isFileDrag(e)) return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        });
        window.addEventListener('dragleave', (e) => {
            if (!isFileDrag(e)) return;
            depth = Math.max(0, depth - 1);
            if (depth === 0) show(false);
        });
        window.addEventListener('drop', (e) => {
            if (!isFileDrag(e)) return;
            e.preventDefault();
            depth = 0;
            show(false);
            if (gameState.screen !== 'start') {
                this._notice('请先回到选曲界面再拖入谱面', 'warn');
                return;
            }
            const file = e.dataTransfer.files && e.dataTransfer.files[0];
            if (!file) return;
            this._importDroppedFile(file);
        });
    }

    /** 按扩展名分发拖入的文件 */
    _importDroppedFile(file) {
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        if (ext === 'mid' || ext === 'midi') return this._loadMidiFile(file);
        if (ext === 'osu' || ext === 'osz') return this._importOsuOrOsz(file);
        this._notice('不支持的文件类型，支持 .mid / .osu / .osz', 'warn');
        return null;
    }

    /** 曲库加载中的骨架屏 */
    _skeletonHtml() {
        const row = `
            <div class="song-skeleton" aria-hidden="true">
                <span class="sk-icon"></span>
                <span class="sk-lines"><i></i><i></i></span>
            </div>`;
        return row.repeat(3);
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

        // 曲库还在加载：先给两个标签页铺骨架屏，避免空白列表
        if (!this.songLibraryLoaded) {
            const skeleton = this._skeletonHtml();
            this.songCardsMidi.innerHTML = skeleton;
            this.songCardsSongs.innerHTML = skeleton;
            if (this.songEmptyMidi) this.songEmptyMidi.style.display = 'none';
            if (this.songEmptySongs) this.songEmptySongs.style.display = 'none';
            this.songCount.textContent = 'LOADING…';
            return;
        }

        const midiSongs = this._getMidiSongs();
        const chartSongs = this._getChartSongs();

        // 更新计数（显示当前活跃标签页的曲目数）
        this._updateTabCount();

        // 曲库加载失败：两个标签页都显示错误态 + 重试按钮
        const retryHtml = this._libraryLoadFailed ? `
            <div class="library-error" id="libraryErrorState">
                <span class="empty-icon">⚠</span>
                <span>曲库加载失败，请检查网络后重试</span>
                <span class="empty-hint">Library failed to load</span>
                <button class="btn btn-primary library-retry-btn" type="button">↻ RETRY</button>
            </div>` : '';

        // --- MIDI 标签页 ---
        this.songCardsMidi.innerHTML = retryHtml;
        if (this._libraryLoadFailed) {
            this.songCardsMidi.querySelector('.library-retry-btn')
                ?.addEventListener('click', () => this.retryLoadSongLibrary());
            if (this.songEmptyMidi) this.songEmptyMidi.style.display = 'none';
        } else if (midiSongs.length === 0) {
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
        this.songCardsSongs.innerHTML = retryHtml;
        if (this._libraryLoadFailed) {
            this.songCardsSongs.querySelector('.library-retry-btn')
                ?.addEventListener('click', () => this.retryLoadSongLibrary());
            if (this.songEmptySongs) this.songEmptySongs.style.display = 'none';
        } else {
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

    // ========== 移动端选曲增强 ==========
    /**
     * 触屏设备选曲列表增强：
     * 1. 双击歌曲卡片 → 直接进入设置页（选中 + handleStartOrConfig 一步到位）
     * 2. 滚动惯性中抑制卡片 click——手指位移超过 10px 视为滑动而非点选，
     *    防止滑动列表浏览时误选歌曲
     */
    _setupTouchSongListEnhancements() {
        const listWrapper = document.getElementById('songListWrapper');
        if (!listWrapper) return;

        // 双击检测（选卡后 400ms 内再点同一张卡 = 双击）
        this._lastCardTapAt = 0;
        this._lastCardTapIndex = -1;

        // 滑动抑制：capture 阶段监听，位移超阈值则拦截本次 click
        let touchStartX = 0, touchStartY = 0, touchMoved = false;
        listWrapper.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            touchMoved = false;
        }, { passive: true });
        listWrapper.addEventListener('touchmove', (e) => {
            const dx = Math.abs(e.touches[0].clientX - touchStartX);
            const dy = Math.abs(e.touches[0].clientY - touchStartY);
            if (dx > 10 || dy > 10) touchMoved = true;
        }, { passive: true });
        listWrapper.addEventListener('click', (e) => {
            if (touchMoved) {
                e.stopPropagation();
                e.preventDefault();
                touchMoved = false;
            }
        }, true);

        // 双击进设置：在列表容器上代理双击（卡片是动态生成的）
        listWrapper.addEventListener('click', (e) => {
            const card = e.target.closest('.song-card');
            if (!card || card.classList.contains('import-card')) return;   // 导入卡片不参与双击
            const idx = card.dataset.songIndex;
            if (idx === undefined) return;

            const now = performance.now();
            const isDoubleTap = this._lastCardTapIndex === idx && (now - this._lastCardTapAt) <= 400;
            this._lastCardTapAt = now;
            this._lastCardTapIndex = idx;

            if (isDoubleTap) {
                this._lastCardTapIndex = -1;
                this._stopPreview();   // 双击进设置前停止试听
                // 已选中则直接进入设置；未选中先选中再进入
                if (selectedSongSource !== 'library' || selectedLibrarySong !== songLibrary[parseInt(idx)]) {
                    this.selectLibrarySong(songLibrary[parseInt(idx)], parseInt(idx));
                }
                this.handleStartOrConfig();
            }
        });

        // 长按试听：按住已选中的歌曲卡片 600ms → 播放该曲伴奏预览，
        // 松手/滑动/切页即停。MC 歌曲用 mc_audio 伴奏，MIDI 无音频跳过。
        this._previewTimer = null;
        listWrapper.addEventListener('touchstart', (e) => {
            const card = e.target.closest('.song-card');
            if (!card || card.classList.contains('import-card')) return;
            const idx = card.dataset.songIndex;
            if (idx === undefined) return;
            const song = songLibrary[parseInt(idx)];
            if (!song || !this._isChartSong(song)) return;   // MIDI 无独立音频文件

            // 仅已选中的歌曲触发（避免与单击选中/双击进设置时序冲突）
            if (selectedLibrarySong !== song) return;

            this._clearPreviewTimer();
            this._previewTimer = setTimeout(() => {
                this._previewTimer = null;
                this._startPreview(song);
            }, 600);
        }, { passive: true });
        const cancelPreview = () => this._clearPreviewTimer();
        listWrapper.addEventListener('touchmove', cancelPreview, { passive: true });
        listWrapper.addEventListener('touchend', cancelPreview, { passive: true });
        listWrapper.addEventListener('touchcancel', cancelPreview, { passive: true });
    }

    // ========== 歌曲试听（长按预览） ==========
    _clearPreviewTimer() {
        if (this._previewTimer) {
            clearTimeout(this._previewTimer);
            this._previewTimer = null;
        }
    }

    /** 开始试听：加载（走缓存）并循环播放该曲伴奏 */
    async _startPreview(song) {
        if (!this._isChartSong(song) || !song.audio) return;
        const cacheKey = this._songAudioCacheKey(song);
        this._showImportToast(`试听 ${song.title}…`);
        const ok = await audioEngine.loadAudioFile(this._songAudioUrl(song), { cacheKey, setCurrent: false });
        this._hideImportToast();
        if (!ok) return;

        // 用户已切换选择/离开选曲页 → 放弃播放
        if (selectedLibrarySong !== song || gameState.screen !== 'start') return;

        // 停掉现有播放（含结算音乐残留），从缓存取解码结果循环播放
        audioEngine.stopMusic();
        if (!audioEngine.useCachedAudio(cacheKey)) return;   // 缓存里没有就不播（避免串台）
        audioEngine.startAudioPlayback(0);
        this._previewLoop = true;
        if (audioEngine.audioSource) audioEngine.audioSource.loop = true;
        this._previewingSong = song;
    }

    /** 停止试听 */
    _stopPreview() {
        this._clearPreviewTimer();
        if (this._previewingSong) {
            audioEngine.stopMusic();
            this._previewingSong = null;
        }
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
        // 切歌时停止试听
        this._stopPreview();
        selectedSongSource = 'library';
        selectedLibrarySong = song;
        loadedMidiData = null;
        loadedMcData = null;
        loadedOsuData = null;
        importedMidiFileName = null;
        importedOsuFileName = null;
        importedMcFileName = null;
        selectedSongDisplayName = song.title;

        // 切歌：清掉上一首的待播音频引用与预加载状态，
        // 防止尚未完成的旧预加载把旧伴奏写进新歌的播放
        audioEngine.audioBuffer = null;
        audioEngine.stopAudio();                    // 停掉可能还在播的上一条音源
        this._pendingAudioReady = null;
        this._pendingAudioKey = null;
        // 本局应使用的伴奏缓存 key（谱面歌曲才有；MIDI 歌曲走合成器）
        this._gameAudioKey = this._isChartSong(song) ? this._songAudioCacheKey(song) : null;

        this.updateSelectionDisplay();
        this.updateAllHighlights();
        this.updateStartButtons();
    }

    handleMidiImport(event) {
        const file = event.target.files[0];
        event.target.value = '';   // 允许重新选择相同文件
        if (!file) return;
        return this._loadMidiFile(file);
    }

    /**
     * 解析并载入本地 MIDI 文件（文件选择与拖拽共用）
     * @param {File} file
     */
    async _loadMidiFile(file) {
        this._showImportToast(`解析 ${file.name}`, { meta: this._formatBytes(file.size) });
        await this._yieldToUI();

        try {
            const buffer = await file.arrayBuffer();
            const parser = new MidiParser(buffer);
            loadedMidiData = parser.parse();
            loadedMcData = null;
            loadedOsuData = null;

            importedMidiFileName = file.name;
            importedOsuFileName = null;
            importedMcFileName = null;

            selectedSongSource = 'import';
            selectedLibrarySong = null;
            // MIDI 走实时合成器：不再持有上一首的伴奏
            this._gameAudioKey = null;
            audioEngine.stopAudio();
            // 根据导入的 MIDI 文件名生成 title（去掉扩展名）
            selectedSongDisplayName = file.name.replace(/\.midi?$/i, '');

            this.updateSelectionDisplay();
            this.updateAllHighlights();
            this.updateStartButtons();

            const noteCount = loadedMidiData && loadedMidiData.notes ? loadedMidiData.notes.length : 0;
            this._notice(`已导入 ${selectedSongDisplayName}${noteCount ? '（' + noteCount + ' 音符）' : ''}`);
        } catch (err) {
            console.error('MIDI parse error:', err);
            this._notice('MIDI 解析失败，请确认是标准 MIDI 文件', 'error', 4000);
            this.clearSelection();
        } finally {
            this._hideImportToast();
        }
    }

    /**
     * 处理 .osu / .osz 文件导入
     * - .osu：直接解析文本谱面（无音频时回退到预设音乐）
     * - .osz：解压并选择第一个合法的 osu!mania 4K 谱面，同时加载其音频
     * 移动端大文件（.osz 可达 90MB+）解析耗时较长：显示进度 toast + 防重复触发
     */
    async handleOsuImport(event) {
        const file = event.target.files[0];
        if (!file) return;
        event.target.value = '';   // 允许重新选择相同文件
        return this._importOsuOrOsz(file);
    }

    /**
     * 导入 .osu / .osz（文件选择与拖拽共用）
     * @param {File} file
     */
    async _importOsuOrOsz(file) {
        // 防重复：上一次导入尚未完成时忽略本次
        if (this._importBusy) return;
        this._importBusy = true;

        const ext = file.name.split('.').pop().toLowerCase();
        const isOsz = ext === 'osz';
        try {
            if (isOsz) {
                this._showImportToast(`读取 ${file.name}`, { meta: this._formatBytes(file.size) });
                // 让出主线程，确保 toast 先渲染
                await new Promise(r => setTimeout(r, 50));
            }
            if (ext === 'osu') {
                await this._importOsuFile(file);
            } else if (isOsz) {
                await this._importOszFile(file);
            } else {
                this._notice('不支持的文件类型，请选择 .osu / .osz', 'warn');
            }
        } catch (err) {
            console.error('osu! import error:', err);
            this._notice(`导入失败：${err.message.split('\n')[0]}`, 'error', 4000);
            this.clearSelection();
        } finally {
            this._importBusy = false;
            this._hideImportToast();
        }
    }

    /** 导入进度 toast */
    _showImportToast(text, opts = {}) {
        const toast = document.getElementById('importToast');
        if (!toast) return;
        this._updateImportToast({ text, ...opts });
        toast.classList.remove('hidden');
    }

    /**
     * 更新导入进度
     * @param {{text?: string, progress?: number|null, meta?: string, indeterminate?: boolean, error?: boolean}} opts
     */
    _updateImportToast(opts = {}) {
        const textEl = document.getElementById('importToastText');
        const metaEl = document.getElementById('importToastMeta');
        const track = document.getElementById('importToastTrack');
        const fill = document.getElementById('importToastFill');
        if (opts.text !== undefined && textEl) textEl.textContent = opts.text;
        if (opts.meta !== undefined && metaEl) metaEl.textContent = opts.meta;
        if (!track || !fill) return;
        track.classList.toggle('is-error', !!opts.error);
        const hasProgress = typeof opts.progress === 'number' && Number.isFinite(opts.progress);
        const indeterminate = opts.indeterminate !== undefined ? opts.indeterminate : !hasProgress;
        track.classList.toggle('indeterminate', indeterminate);
        if (hasProgress) {
            fill.style.width = Math.max(0, Math.min(100, opts.progress * 100)).toFixed(1) + '%';
        } else {
            fill.style.width = '';
        }
    }

    /** 轻提示：不阻塞操作的顶部小条 */
    _notice(text, kind = 'info', duration = 2600) {
        const el = document.getElementById('noticeToast');
        if (!el) return;
        el.textContent = text;
        el.className = 'notice-toast ' + (kind === 'info' ? '' : kind);
        el.classList.remove('hidden');
        if (this._noticeTimer) clearTimeout(this._noticeTimer);
        this._noticeTimer = setTimeout(() => {
            el.classList.add('hidden');
            this._noticeTimer = null;
        }, duration);
    }

    /** 字节数 → 人类可读 */
    _formatBytes(bytes) {
        if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    }

    /** 字节/秒 → 人类可读 */
    _formatSpeed(bytesPerSecond) {
        if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '';
        if (bytesPerSecond < 1024) return Math.round(bytesPerSecond) + ' B/s';
        if (bytesPerSecond < 1048576) return (bytesPerSecond / 1024).toFixed(0) + ' KB/s';
        return (bytesPerSecond / 1048576).toFixed(1) + ' MB/s';
    }

    /**
     * 设置页伴奏状态条
     * @param {'hidden'|'loading'|'ready'|'error'} state
     * @param {{text?: string, meta?: string, progress?: number|null, indeterminate?: boolean}} [opts]
     */
    _setAudioStatus(state, opts = {}) {
        const box = document.getElementById('audioStatus');
        const textEl = document.getElementById('audioStatusText');
        const metaEl = document.getElementById('audioStatusMeta');
        const track = document.getElementById('audioStatusTrack');
        const fill = document.getElementById('audioStatusFill');
        if (!box) return;
        if (state === 'hidden') {
            box.classList.add('hidden');
            return;
        }
        box.classList.remove('hidden');
        box.dataset.state = state;
        if (opts.text !== undefined && textEl) textEl.textContent = opts.text;
        if (opts.meta !== undefined && metaEl) metaEl.textContent = opts.meta;
        if (!track || !fill) return;
        const hasProgress = typeof opts.progress === 'number' && Number.isFinite(opts.progress);
        const indeterminate = opts.indeterminate !== undefined ? opts.indeterminate : !hasProgress;
        track.classList.toggle('indeterminate', indeterminate);
        if (hasProgress) {
            fill.style.width = Math.max(0, Math.min(100, opts.progress * 100)).toFixed(1) + '%';
        } else {
            fill.style.width = state === 'ready' ? '100%' : '';
        }
    }

    _hideImportToast() {
        const toast = document.getElementById('importToast');
        if (toast) toast.classList.add('hidden');
    }

    /** 让出主线程一帧（大文件解析循环中保持 UI 可响应） */
    _yieldToUI() {
        return new Promise(r => setTimeout(r, 0));
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
                    this._gameAudioKey = null;
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
     * 每解析一个条目让出主线程并更新进度，避免移动端 UI 冻结
     */
    async _importOszFile(file) {
        this._showImportToast(`读取 ${file.name}`, { meta: this._formatBytes(file.size) });
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
        for (let i = 0; i < allEntries.length; i++) {
            const cand = allEntries[i];
            this._updateImportToast({
                text: `解析谱面 ${i + 1}/${allEntries.length}`,
                progress: i / allEntries.length,
                meta: cand.entry.name.split('/').pop()
            });
            await this._yieldToUI();
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

        // 难度计算（谱面多时较耗时，同样分批让出主线程）
        for (let i = 0; i < candidates.length; i++) {
            const c = candidates[i];
            this._updateImportToast({
                text: `计算难度 ${i + 1}/${candidates.length}`,
                progress: i / candidates.length,
                meta: ''
            });
            c.difficulty = new DifficultyCalculator(c.parsed.notes).calculate();
            if (i % 5 === 4) await this._yieldToUI();
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
                this._loadOszAudio(zip, audioEntry).then((ok) => {
                    this._notice(`已载入 ${selectedSongDisplayName}${ok === false ? '（伴奏加载失败）' : ''}`);
                }).catch(err => {
                    console.warn('Failed to load osz audio:', err);
                    this._gameAudioKey = null;
                    audioEngine.stopAudio();
                    this._notice(`已载入 ${selectedSongDisplayName}（伴奏加载失败）`, 'warn', 3600);
                });
            } else {
                this._gameAudioKey = null;
                audioEngine.stopAudio();
                this._notice(`已载入 ${selectedSongDisplayName}（无伴奏，使用内置节拍）`, 'warn', 3200);
            }
        } catch (err) {
            console.error('Apply osz candidate error:', err);
            this._notice(`载入谱面失败：${err.message.split('\n')[0]}`, 'error', 4000);
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
        const audioName = audioEntry.name.split('/').pop();
        this._showImportToast(`解码音频 ${audioName}`, { meta: this._formatBytes(audioEntry.size || 0) });
        try {
            const blob = await zip.readBlob(audioEntry);
            // 释放上一次导入的音频 URL
            if (this._importedOsuAudioUrl) {
                URL.revokeObjectURL(this._importedOsuAudioUrl);
            }
            this._importedOsuAudioUrl = URL.createObjectURL(blob);
            // 导入音频也走 key，重试 / 下一局还能按 key 取回，不会串到别的曲目
            const cacheKey = 'import:' + audioName + ':' + (this._importedOsuAudioUrl.slice(-36));
            this._gameAudioKey = cacheKey;
            const ok = await audioEngine.loadAudioFile(this._importedOsuAudioUrl, {
                cacheKey,
                setCurrent: true,
                onProgress: (p) => {
                    if (p.phase === 'decode') {
                        this._updateImportToast({ text: `解码音频 ${audioName}`, indeterminate: true, meta: this._formatBytes(p.loaded) });
                    } else if (p.phase === 'download') {
                        const pct = p.total > 0 ? p.loaded / p.total : null;
                        this._updateImportToast({
                            text: `读取音频 ${audioName}`,
                            progress: pct,
                            indeterminate: pct === null,
                            meta: this._formatBytes(p.loaded) + (p.total > 0 ? ' / ' + this._formatBytes(p.total) : '')
                        });
                    }
                }
            });
            if (!ok) this._gameAudioKey = null;
            return ok;
        } finally {
            this._hideImportToast();
        }
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
        this._gameAudioKey = null;   // 音频稍后由 _loadOszAudio 写入
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

        // 同步清空待播音频引用与预加载状态
        audioEngine.stopAudio();
        this._gameAudioKey = null;
        this._pendingAudioReady = null;
        this._pendingAudioKey = null;

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
        // 防连点：载入谱面是异步的，快速双击会重复请求并弹两次设置页
        if (this._openingSettings) return;
        this._openingSettings = true;
        this._stopPreview();   // 离开选曲页前停止歌曲试听

        try {
            if (selectedSongSource === 'library' && selectedLibrarySong) {
                // 谱面（.mc / .osu，几十 KB）与 MIDI（.mid，几十 KB）都很小，
                // 同步加载以保证设置页元数据完整 / MIDI 谱面生成可用；
                // 弱网下可能要等几百毫秒，用 toast 告知"正在载入"，避免点击无反馈
                this._showImportToast(`载入谱面 ${selectedLibrarySong.title}`, { indeterminate: true, meta: '' });
                await this._yieldToUI();

                if (selectedLibrarySong.beatmapType === 'mc') {
                    const mcLoaded = await this.loadLibraryMcBeatmap();
                    if (!mcLoaded) return;
                } else if (selectedLibrarySong.beatmapType === 'osu') {
                    const osuLoaded = await this.loadLibraryOsuBeatmap();
                    if (!osuLoaded) return;
                } else if (!loadedMidiData) {
                    const midiLoaded = await this.loadLibraryMidi();
                    if (!midiLoaded) return;   // MIDI 必须加载成功（谱面由它生成）
                }
            }

            if (!loadedMidiData && !getLoadedChartData()) {
                this._notice('没有可用的谱面数据，请重新选择或导入', 'error', 3600);
                return;
            }

            // 立即显示设置页——几 MB 的伴奏音频改为后台预加载，
            // 避免移动端下载 + decodeAudioData 数秒的空白等待
            this.showSettings();

            // 设置页出现后立刻预载伴奏（进度显示在设置页的状态条里）
            if (selectedSongSource === 'library' && selectedLibrarySong) {
                this._preloadSongAudio(selectedLibrarySong);
            }
        } finally {
            this._hideImportToast();
            this._openingSettings = false;
        }
    }

    /** 获取歌曲音频的缓存键（曲目 id 优先，回退文件路径） */
    _songAudioCacheKey(song) {
        const audioFile = this._isChartSong(song) ? song.audio : song.file;
        return song.id != null ? `song:${song.id}` : `path:${audioFile}`;
    }

    /** 获取歌曲音频的完整 URL */
    _songAudioUrl(song) {
        const audioFile = this._isChartSong(song) ? song.audio : song.file;
        if (!audioFile) return null;

        let basePath;
        if (song.beatmapType === 'osu') {
            basePath = CONFIG.osuBasePath + (song.folder ? song.folder + '/' : '');
        } else if (song.beatmapType === 'mc') {
            basePath = CONFIG.mcAudioBasePath;
        } else {
            basePath = CONFIG.songBasePath;
        }
        return basePath + audioFile;
    }

    /**
     * 后台预加载当前选中歌曲的伴奏音频。
     * - MIDI 歌曲（.mid 很小）仍在 START GAME 前同步加载（谱面生成依赖它）
     * - 谱面歌曲（.mc / .osu 的 ogg/mp3 伴奏）异步下载解码并写入缓存，
     *   START GAME 时从缓存取用；失败则游戏内回退预设音乐
     */
    _preloadSongAudio(song) {
        const cacheKey = this._songAudioCacheKey(song);
        this._pendingAudioKey = cacheKey;

        // MIDI：文件小且 startGame 的谱面生成强依赖 loadedMidiData，保持同步加载语义
        if (!this._isChartSong(song)) {
            if (loadedMidiData) return;   // 已加载过
            const url = this._songAudioUrl(song);
            if (!url) return;
            this.loadAudioForSong(song.file, CONFIG.songBasePath, song).catch(err => {
                console.warn('MIDI preload failed:', err);
            });
            return;
        }

        // 谱面歌曲：已缓存 → 直接恢复为当前待播曲目，无需网络
        if (audioEngine.useCachedAudio(cacheKey)) {
            this._pendingAudioReady = true;
            this._pendingAudioFailed = false;
            this._setAudioStatus('ready', { text: '伴奏已就绪（缓存）', meta: '' });
            return;
        }

        const url = this._songAudioUrl(song);
        if (!url) return;

        this._pendingAudioReady = false;
        this._pendingAudioFailed = false;
        this._setAudioStatus('loading', { text: '伴奏加载中…', progress: null, meta: '0%' });
        const startedAt = performance.now();
        let lastPaint = 0;

        audioEngine.loadAudioFile(url, {
            cacheKey,
            setCurrent: false,
            onProgress: (p) => {
                if (this._pendingAudioKey !== cacheKey) return;   // 已切歌，忽略旧进度
                const now = performance.now();

                if (p.phase === 'download') {
                    // 进度条按 10Hz 刷新即可；未到刷新间隔直接丢弃本次采样
                    if (now - lastPaint < 100) return;
                    lastPaint = now;
                    const pct = p.total > 0 ? p.loaded / p.total : null;
                    const parts = [];
                    if (pct !== null) parts.push(Math.round(pct * 100) + '%');
                    parts.push(this._formatBytes(p.loaded) + (p.total > 0 ? ' / ' + this._formatBytes(p.total) : ''));
                    const speed = this._formatSpeed(p.speed);
                    if (speed) parts.push(speed);
                    this._setAudioStatus('loading', {
                        text: '伴奏下载中…',
                        progress: pct,
                        indeterminate: pct === null,
                        meta: parts.join(' · ')
                    });
                } else if (p.phase === 'decode') {
                    this._setAudioStatus('loading', {
                        text: '伴奏解码中…',
                        indeterminate: true,
                        meta: this._formatBytes(p.loaded)
                    });
                }
            }
        }).then(success => {
            // 只在自己仍是"当前待加载曲目"时回写，避免旧请求覆盖新歌
            if (this._pendingAudioKey === cacheKey) {
                this._pendingAudioReady = success;
                this._pendingAudioFailed = !success;
                if (success && this._gameAudioKey === cacheKey) {
                    audioEngine.useCachedAudio(cacheKey);
                    const buf = audioEngine.audioBuffer;
                    const elapsed = Math.max(0.001, (performance.now() - startedAt) / 1000);
                    const size = buf ? buf.duration.toFixed(0) + 's' : '';
                    this._setAudioStatus('ready', {
                        text: '伴奏已就绪',
                        meta: [size, '用时 ' + elapsed.toFixed(1) + 's'].filter(Boolean).join(' · ')
                    });
                } else if (!success) {
                    this._setAudioStatus('error', { text: '伴奏加载失败，将使用内置节拍', meta: '' });
                }
            }
        }).catch(() => {
            if (this._pendingAudioKey === cacheKey) {
                this._pendingAudioReady = false;
                this._pendingAudioFailed = true;
                this._setAudioStatus('error', { text: '伴奏加载失败，将使用内置节拍', meta: '' });
            }
        });
    }

    /**
     * 等待后台预加载完成（谱面歌曲伴奏），带 8 秒超时。
     * MIDI 歌曲在预加载里同步处理，通常瞬间完成。
     * @returns {Promise<boolean>} 音频是否就绪（false = 超时/失败，游戏将回退预设音乐）
     */
    async _waitForSongAudio(song) {
        const cacheKey = this._songAudioCacheKey(song);

        // MIDI：同步加载（若尚未完成）
        if (!this._isChartSong(song)) {
            if (!loadedMidiData && song.file) {
                await this.loadAudioForSong(song.file, CONFIG.songBasePath, song);
            }
            return !!loadedMidiData;
        }

        // 已缓存：直接恢复
        if (audioEngine.useCachedAudio(cacheKey)) {
            return true;
        }

        // 等预加载完成（最多 8s，超时回退预设音乐）
        const deadline = performance.now() + 8000;
        while (performance.now() < deadline) {
            if (audioEngine.useCachedAudio(cacheKey)) {
                return true;
            }
            if (this._pendingAudioKey !== cacheKey) break;          // 已切歌
            if (this._pendingAudioFailed && this._pendingAudioKey === cacheKey) break;   // 预加载失败
            await new Promise(r => setTimeout(r, 100));
        }
        return audioEngine.useCachedAudio(cacheKey);
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
                this._notice(`伴奏加载失败：${song.title}`, 'error', 4000);
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
            this._notice(`MIDI 文件加载失败：${song.title}`, 'error', 4000);
            return false;
        }
    }    // 保留旧方法名以兼容导入 MIDI 等其他调用处
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
                this._notice(
                    `「${song.title}」是 ${column}K 谱面，本作仅支持 4K`,
                    'error', 4200
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
            this._notice(`「${song.title}」谱面加载失败：${err.message.split('\n')[0]}`, 'error', 4200);
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
            this._notice(`「${song.title}」谱面加载失败：${err.message.split('\n')[0]}`, 'error', 4200);
            loadedOsuData = null;
            return false;
        }
    }

    showSettings() {
        if (!selectedSongSource) return;

        // 每次进入设置页先收起上一首的伴奏状态，等本曲预载回调再显示
        this._setAudioStatus('hidden');

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
        this._enterAnim('.settings-card');
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
        this._enterAnim('.start-layout');
        repaintStartScreen();
    }

    // ========== 游戏开始 ==========
    async startGame() {
        if (!selectedSongSource) {
            this._notice('请先选择一首歌曲', 'warn');
            return;
        }
        // 防重复点击：startGame 含异步等待，快速双击会启动两局
        if (this._startingGame) return;
        this._startingGame = true;
        try {
            await this._startGameInner();
        } finally {
            this._startingGame = false;
        }
    }

    async _startGameInner() {
        // 开始游戏前停止歌曲试听，防止预览音乐混入游戏伴奏
        this._stopPreview();

        const chartData = getLoadedChartData();
        const isChartMode = !!chartData;

        if (!loadedMidiData && !isChartMode) {
            this._notice('没有可用的谱面数据，请先选择歌曲或导入谱面', 'error', 3600);
            return;
        }

        // 曲库歌曲：确保伴奏音频就绪（通常预加载已完成，此处最多短暂等待）。
        // 等待期间按钮显示 LOADING，并复用设置页的伴奏进度条（下载 % / 大小 / 速度）。
        if (selectedSongSource === 'library' && selectedLibrarySong) {
            const btn = this.settingsStartBtn;
            const originalText = btn ? btn.textContent : null;
            const showLoading = (on) => {
                if (btn && originalText !== null) {
                    btn.textContent = on ? 'LOADING…' : originalText;
                    btn.disabled = on;
                }
            };
            const song = selectedLibrarySong;
            // MIDI 歌曲的谱面生成强依赖 loadedMidiData；预加载可能还在进行
            if (!this._isChartSong(song) && !loadedMidiData) showLoading(true);
            if (this._isChartSong(song) && !audioEngine.hasCachedAudio(this._songAudioCacheKey(song))) {
                showLoading(true);
                // 进度由 _preloadSongAudio 的 onProgress 回调持续刷新；此时兜底文案
                if (!this._pendingAudioFailed) {
                    this._setAudioStatus('loading', { text: '等待伴奏…', indeterminate: true, meta: '' });
                }
            }
            const audioReady = await this._waitForSongAudio(song);
            if (!audioReady && this._isChartSong(song)) {
                console.warn('Song audio not ready, falling back to preset music.');
                this._setAudioStatus('error', { text: '伴奏未就绪，已回退内置节拍', meta: '' });
                this._notice('伴奏未就绪，本局使用内置节拍', 'warn', 3000);
            }
            showLoading(false);
        }

        // 停止一切残留播放（结算音乐/上一局音乐），并清掉可能挂起的启动定时器
        audioEngine.stopMusic();
        if (audioEngine.unlock) audioEngine.unlock();
        if (this._musicStartTimeout) {
            clearTimeout(this._musicStartTimeout);
            this._musicStartTimeout = null;
        }

        // 本局伴奏：只允许"当前这首歌"的解码结果进入播放，避免串到上一首。
        // 放在预加载结算音乐之前，让当前伴奏先成为缓存中的"在用槽位"，不会被挤掉。
        // （`_gameAudioKey` 在选歌/导入时确定；MIDI 歌曲为 null，走合成器）
        if (this._gameAudioKey) {
            if (!audioEngine.useCachedAudio(this._gameAudioKey)) {
                console.warn('[audio] 伴奏未就绪，回退预设音乐：', this._gameAudioKey);
                audioEngine.audioBuffer = null;
            }
        } else {
            audioEngine.audioBuffer = null;
        }

        // 进入游戏态：显示触控轨道与游戏内按钮
        document.body.classList.add('game-active');
        this._setPauseOverlayVisible(false);
        this.setSkipIntroVisible(false);
        this._requestWakeLock();
        // 后台预加载结算音乐（2MB completed.mp3，多数局为完成）
        this._preloadResultAudio();

        // 隐藏所有 UI
        this.startScreen.classList.add('hidden');
        this.settingsScreen.classList.add('hidden');
        this.resultScreen.classList.add('hidden');
        if (this.leaderboardScreen) this.leaderboardScreen.classList.add('hidden');

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

        // 顶部 HUD 曲目信息
        if (renderer) {
            const chart = getLoadedChartData();
            const difficultyLabel = chart
                ? (chart.meta.version || 'CHART')
                : (selectedDifficulty || 'normal').toUpperCase();
            const artist = selectedLibrarySong && selectedLibrarySong.artist
                ? selectedLibrarySong.artist
                : (selectedSongSource === 'import' ? 'CUSTOM IMPORT' : '');
            renderer.setSongInfo({
                title: selectedSongDisplayName || 'UNKNOWN',
                artist,
                difficulty: difficultyLabel
            });
        }

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
        this.updateInGameUI();

        // 首次游玩：弹出触屏操作指南并冻结初始倒计时，关闭后继续
        this._maybeShowTouchHint();
        if (this.touchHint && !this.touchHint.classList.contains('hidden')) {
            const remaining = Math.max(0, gameState.startTime - performance.now());
            gameState._initialCountdownRemaining = remaining;
            gameState._initialCountdownFrozen = true;
            if (this._musicStartTimeout) {
                clearTimeout(this._musicStartTimeout);
                this._musicStartTimeout = null;
                this._musicRestartDelay = Math.max(0, this._musicDelayMs - (performance.now() - this._musicScheduledAt));
            }
        }

        // 启动游戏循环
        requestAnimationFrame(gameLoop);
    }

    _hideTouchHint(markSeen) {
        if (this.touchHint) {
            this.touchHint.classList.add('hidden');
        }
        if (markSeen) {
            try { localStorage.setItem('cyberbeat_touch_hint_seen', '1'); } catch (e) { /* ignore */ }
        }
        // 若初始倒计时因指南冻结，恢复倒计时与音乐调度
        if (gameState._initialCountdownFrozen) {
            const remaining = Math.max(0, gameState._initialCountdownRemaining || 0);
            gameState._initialCountdownFrozen = false;
            gameState._initialCountdownRemaining = 0;
            gameState.startTime = performance.now() + remaining;
            gameState.intervalStartTime = gameState.startTime;
            this._musicDelayMs = remaining;
            this._musicScheduledAt = performance.now();
            if (this._musicStartTimeout) clearTimeout(this._musicStartTimeout);
            this._musicStartTimeout = setTimeout(() => {
                this._musicStartTimeout = null;
                this._playGameMusic((getLoadedChartData()?.meta?.audioOffset) || 0);
            }, remaining);
            this._musicRestartDelay = 0;
        }
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
        document.body.classList.remove('game-active');
        this._setPauseOverlayVisible(false);
        this.setSkipIntroVisible(false);
        this._releaseWakeLock();
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
        this._enterResult();

        // 保存游玩记录到本地排行榜
        this._saveToLeaderboard(accuracy, rank, isGameFailed);

        // 播放结算音乐
        this.playResultAudio(isGameFailed);
    }

    // ========== 进场动效 ==========
    /**
     * 重新触发某个容器的入场动画（先移除再强制回流，允许重复播放）
     * @param {string|Element} target 选择器或元素
     */
    _enterAnim(target) {
        const el = typeof target === 'string' ? document.querySelector(target) : target;
        if (!el) return;
        el.classList.remove('enter-anim');
        void el.offsetWidth;   // 强制一次布局，让动画可重放
        el.classList.add('enter-anim');
    }

    /** 结算页入场：卡片上浮 + 等级弹跳 */
    _enterResult() {
        const card = document.getElementById('resultCard');
        if (!card) return;
        card.classList.remove('result-enter');
        void card.offsetWidth;
        card.classList.add('result-enter');
        this._enterAnim(card);
        if (this._resultEnterTimer) clearTimeout(this._resultEnterTimer);
        this._resultEnterTimer = setTimeout(() => card.classList.remove('result-enter'), 600);
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

    // 播放结算音乐（优先用预加载缓存，未命中时现场加载）
    async playResultAudio(isFailed) {
        const audioPath = isFailed
            ? 'assets/result-audio/failed.mp3'
            : 'assets/result-audio/completed.mp3';
        const cacheKey = 'result-audio:' + (isFailed ? 'failed' : 'completed');

        // 结算音乐走自己的缓存槽；不触碰当前歌曲的伴奏引用
        if (audioEngine.useCachedAudio(cacheKey)) {
            audioEngine.startAudioPlayback(0);
            return;
        }

        // 现场加载（首次游玩未预载完成的情形）
        const loaded = await audioEngine.loadAudioFile(audioPath, { cacheKey });
        if (loaded && audioEngine.useCachedAudio(cacheKey)) {
            audioEngine.startAudioPlayback(0);
        }
    }

    /** 后台预加载结算音乐（成功曲较小 2MB，进入游戏时提前拉取） */
    _preloadResultAudio() {
        const cacheKey = 'result-audio:completed';
        if (audioEngine.hasCachedAudio(cacheKey)) return;
        audioEngine.loadAudioFile('assets/result-audio/completed.mp3', { cacheKey, setCurrent: false })
            .catch(() => { /* 预载失败不影响游戏，结算时再现场加载 */ });
    }

    goToHome() {
        // 停止所有音频（含歌曲试听）
        this._stopPreview();
        audioEngine.stopMusic();
        // 退出游戏态 UI
        document.body.classList.remove('game-active');
        this._setPauseOverlayVisible(false);
        this.setSkipIntroVisible(false);
        this._releaseWakeLock();
        // 重置游戏状态
        gameState.reset();
        // 重置渲染器对象池
        if (renderer) renderer.resetPools();
        // 隐藏所有覆盖画面（结果/排行榜/设置/osz 选择器）
        this.resultScreen.classList.add('hidden');
        if (this.leaderboardScreen) this.leaderboardScreen.classList.add('hidden');
        this.settingsScreen.classList.add('hidden');
        if (this.oszPicker) this.oszPicker.classList.add('hidden');
        // 显示开始画面（静态背景，绘制一帧即可）
        this.startScreen.classList.remove('hidden');
        this._enterAnim('.start-layout');
        repaintStartScreen();
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

        // 应用皮肤选择（贴图在 main.js 启动时已预加载）
        if (typeof skinMode !== 'undefined') {
            const mode = (typeof activeSkin !== 'undefined' && activeSkin) ? 'malody' : 'builtin';
            document.querySelectorAll('.skin-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.skin === mode);
            });
            // 未选中 Malody 时禁用音符样式（皮肤自带形状）
            this._updateNoteStyleAvailability(mode);
        }

        // 应用全局偏移
        if (s.audioOffset !== undefined && typeof audioOffsetMs !== 'undefined') {
            audioOffsetMs = s.audioOffset;
            if (this.offsetSlider) this.offsetSlider.value = audioOffsetMs;
            if (this.offsetValue) this.offsetValue.textContent = (audioOffsetMs > 0 ? '+' : '') + audioOffsetMs + 'ms';
        }

        // 应用触控点显示开关
        if (s.touchFeedback !== undefined && typeof touchFeedbackEnabled !== 'undefined') {
            touchFeedbackEnabled = !!s.touchFeedback;
            this._updateTouchFeedbackToggle();
        }
    }

    // ========== 设置变更时同步持久化 ==========
    _syncSettingsToStore() {
        if (typeof settingsStore !== 'undefined') {
            settingsStore.syncFromRuntime();
        }
    }

    /** 同步触控点开关 UI 状态 */
    _updateTouchFeedbackToggle() {
        if (this.touchFeedbackToggle) {
            this.touchFeedbackToggle.setAttribute('aria-checked', touchFeedbackEnabled ? 'true' : 'false');
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
        this._notice('已导出本局成绩 JSON');
    }

    // ========== 设置变更 ==========
    changeSpeed(delta) {
        noteSpeed += delta;
        noteSpeed = Math.round(noteSpeed * 10) / 10;
        noteSpeed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, noteSpeed));
        this.updateSpeedDisplay();
        this._syncSettingsToStore();
    }

    /**
     * 绑定速度按钮：单击 ±1 步，长按 500ms 后每 100ms 连发。
     * pointerdown/up 兼容触屏与鼠标；到达上下限时自动停止连发。
     */
    _bindSpeedButton(btn, delta) {
        if (btn.dataset.speedBound === '1') return;   // 防止重复绑定
        btn.dataset.speedBound = '1';

        let repeatTimer = null;
        let holdTimeout = null;

        const stopRepeat = () => {
            if (holdTimeout) { clearTimeout(holdTimeout); holdTimeout = null; }
            if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = null; }
        };

        btn.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            this.changeSpeed(delta);

            // 长按连发：500ms 延迟后启动，100ms 间隔
            holdTimeout = setTimeout(() => {
                repeatTimer = setInterval(() => {
                    // 到达边界时自动停止
                    const atMax = delta > 0 && noteSpeed >= MAX_SPEED;
                    const atMin = delta < 0 && noteSpeed <= MIN_SPEED;
                    if (atMax || atMin) {
                        stopRepeat();
                        return;
                    }
                    this.changeSpeed(delta);
                }, 100);
            }, 500);
        });

        ['pointerup', 'pointercancel', 'pointerleave'].forEach(evt => {
            btn.addEventListener(evt, stopRepeat);
        });
        // 防止长按呼出菜单 / 双击缩放
        btn.addEventListener('contextmenu', (e) => e.preventDefault());
        btn.addEventListener('dblclick', (e) => e.preventDefault());
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

    // ========== 皮肤切换 ==========
    /**
     * 切换游玩界面皮肤
     * @param {'builtin'|'malody'} kind
     */
    async setSkin(kind) {
        const btns = Array.from(document.querySelectorAll('.skin-btn'));
        if (btns.some(b => b.disabled)) return;   // 正在切换
        btns.forEach(b => { b.disabled = true; });
        if (this.skinHint) this.skinHint.textContent = kind === 'malody' ? '皮肤载入中…' : '';

        let skin = null;
        try {
            if (typeof switchSkin === 'function') {
                skin = await switchSkin(kind);
            } else if (kind === 'builtin') {
                skin = null;
            }
        } catch (err) {
            console.warn('切换皮肤失败：', err);
            skin = null;
        }

        const active = (typeof skinMode !== 'undefined' && skinMode === 'malody' && skin) ? 'malody' : 'builtin';
        btns.forEach(b => {
            b.disabled = false;
            b.classList.toggle('active', b.dataset.skin === active);
        });
        this._updateNoteStyleAvailability(active);
        if (this.skinHint) {
            this.skinHint.textContent = active === 'malody'
                ? 'MALODY V：Yuxen 4K 皮肤（判定线高度由 HITPOSITION 控制）'
                : '内置扁平皮肤（纯色块 + 1px 描边）';
        }

        if (renderer) {
            renderer.setSkin(active === 'malody' ? skin : null);
            repaintStartScreen();
        }
        this._syncSettingsToStore();
    }

    /** Malody 皮肤接管音符外观时，音符样式按钮置灰 */
    _updateNoteStyleAvailability(mode) {
        const disabled = mode === 'malody';
        document.querySelectorAll('.style-btn').forEach(b => {
            b.classList.toggle('is-disabled', disabled);
            b.disabled = disabled;
            b.title = disabled ? 'Malody 皮肤已接管音符外观' : '';
        });
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
        this.setSkipIntroVisible(false);
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
            // 恢复：启动 3 秒重现倒计时，倒计时结束后时间轴再整体平移，
            // 让玩家从暂停画面回到操作状态，避免恢复瞬间手忙脚乱漏判
            const pendingShift = performance.now() - gameState.pauseStartedAt;
            gameState.resumeCountdownUntil = performance.now() + CONFIG.countdownDuration;
            gameState._pendingResumeShift = pendingShift;
            gameState.paused = false;
            this._setPauseOverlayVisible(false);
        } else {
            // 恢复倒计时期间允许再暂停（取消恢复）
            if (gameState.resumeCountdownUntil > 0) {
                gameState.resumeCountdownUntil = 0;
                gameState._pendingResumeShift = 0;
            }
            const currentTime = performance.now() - gameState.startTime;
            if (currentTime < 0) return; // 初始倒计时中不允许暂停
            gameState.paused = true;
            gameState.pauseStartedAt = performance.now();
            gameState.pauseSnapshotTime = currentTime;
            // 清空按键状态，避免暂停期间的按键在恢复后被当作长按
            gameState.pressedKeys.clear();
            if (renderer) renderer.resetTouchPoints();
            this._clearCanvasTouchTracks();

            // 音乐尚未启动（定时器挂起中）：暂停时顺延其剩余时间
            if (this._musicStartTimeout) {
                clearTimeout(this._musicStartTimeout);
                this._musicStartTimeout = null;
                this._musicRestartDelay = Math.max(0, this._musicDelayMs - (performance.now() - this._musicScheduledAt));
            } else {
                this._musicRestartDelay = 0;
            }

            audioEngine.pauseMusic();
            this._setPauseOverlayVisible(true);
        }
    }

    /** 每帧调用：恢复倒计时结束时平移时间轴并恢复音乐。返回 true 表示刚完成恢复 */
    _tickResumeCountdown() {
        if (gameState.screen !== 'game' || gameState.paused) return false;
        if (!gameState.resumeCountdownUntil || performance.now() < gameState.resumeCountdownUntil) return false;

        // 时间轴整体平移暂停时长（含恢复倒计时本身）
        const shift = gameState._pendingResumeShift || 0;
        gameState.startTime += shift;
        gameState.intervalStartTime += shift;
        gameState.resumeCountdownUntil = 0;
        gameState._pendingResumeShift = 0;
        gameState.pauseStartedAt = 0;

        audioEngine.resumeMusic();

        // 若音乐启动定时器挂起中，按剩余延迟重新调度
        if (this._musicRestartDelay > 0 && this._musicDelayMs > 0) {
            this._musicStartTimeout = setTimeout(() => {
                this._musicStartTimeout = null;
                this._playGameMusic((getLoadedChartData()?.meta?.audioOffset) || 0);
            }, this._musicRestartDelay);
            this._musicRestartDelay = 0;
        }
        return true;
    }

    // ========== 触屏输入（按可见轨道多点触控） ==========
    _setupTouchInput() {
        // 使用全局设备检测（避免触屏笔记本被误判）
        this._isTouchDevice = typeof IS_TOUCH_DEVICE !== 'undefined' ? IS_TOUCH_DEVICE : false;
        // 仅触屏设备启用游戏内手势拦截（桌面端无需）
        if (this._isTouchDevice) {
            // 阻止 iOS Safari 双指捏合缩放游戏画面
            document.addEventListener('gesturestart', (e) => {
                if (gameState.screen === 'game') e.preventDefault();
            }, { passive: false });

            // 双指/多指同时触屏时阻止整页滚动缩放
            document.addEventListener('touchmove', (e) => {
                if (gameState.screen === 'game' && e.touches.length > 0) {
                    // 只阻止游戏区域的滚动，不阻塞面板内部滚动
                    const t = e.target;
                    const inScrollable = t.closest && t.closest('.settings-card, .lb-list-wrapper, .song-list-wrapper, .result-card, .osz-picker-list, .lb-card');
                    if (!inScrollable) e.preventDefault();
                }
            }, { passive: false });
        }

        const canvas = document.getElementById('gameCanvas');
        if (canvas) {
            const handleTouch = (e) => {
                const releasing = e.type === 'touchend' || e.type === 'touchcancel';
                if (gameState.screen !== 'game' || (gameState.paused && !releasing)) return;
                e.preventDefault();
                this._updateCanvasTouches(canvas, e.changedTouches, e.type === 'touchstart', releasing);
            };
            for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
                canvas.addEventListener(type, handleTouch, { passive: false });
            }

            // 切后台 / 失焦：释放所有触控，避免回来时按键卡住
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) this._releaseAllTouches();
            });
            window.addEventListener('blur', () => this._releaseAllTouches());
        }
    }

    /** 批量更新触点，再结算轨道：同一事件中两指换位不会把持续按住的轨道误判为松开。 */
    _updateCanvasTouches(canvas, changedTouches, isStart, releasing) {
        if (!renderer) return;
        if (!this._canvasTouchTracks) this._canvasTouchTracks = new Map();
        const tracks = this._canvasTouchTracks;
        const before = new Set(tracks.values());
        const rect = releasing ? null : canvas.getBoundingClientRect();
        if (rect && (!rect.width || !rect.height)) return;

        for (const touch of changedTouches) {
            const id = 'c' + touch.identifier;
            const previousTrack = tracks.get(id);
            // 有效落点才开始跟踪；暂停清空后，遗留的移动和抬起也不会触发新击键。
            if (!isStart && previousTrack === undefined) continue;

            if (releasing) {
                tracks.delete(id);
                renderer.removeTouchPoint(id);
                continue;
            }

            // 用渲染坐标（CSS 像素），不使用 Canvas backing store 的 DPR 尺寸。
            const x = (touch.clientX - rect.left) * renderer.canvasWidth / rect.width;
            const y = (touch.clientY - rect.top) * renderer.canvasHeight / rect.height;
            const track = renderer.getTouchTrack(x, previousTrack);
            if (isStart && track === null) continue;
            // 已跟踪的手指滑出有效区时释放；滑回来仍可重新按下。
            tracks.set(id, track);
            if (track === null) {
                renderer.removeTouchPoint(id);
            } else if (previousTrack === undefined || previousTrack === null) {
                renderer.addTouchPoint(id, x, y, track);
            } else {
                renderer.moveTouchPoint(id, x, y, track);
            }
        }

        const after = new Set(tracks.values());
        for (const track of before) {
            if (track !== null && !after.has(track)) {
                this.checkHoldRelease(track);
                gameState.pressedKeys.delete(KEYS[track]);
            }
        }
        for (const track of after) {
            if (track === null || before.has(track)) continue;
            const key = KEYS[track];
            if (!gameState.pressedKeys.has(key)) {
                gameState.pressedKeys.add(key);
                this.checkHit(track);
            }
        }
    }

    /** 清除滑动换轨的手指轨道映射（暂停/重开时调用） */
    _clearCanvasTouchTracks() {
        if (this._canvasTouchTracks) this._canvasTouchTracks.clear();
    }

    /** 清除所有触控状态（切后台 / 失焦 / 暂停重开）：不判定、不结算，只防止按键卡住 */
    _releaseAllTouches() {
        if (this._canvasTouchTracks) {
            for (const stateKey of this._canvasTouchTracks.keys()) {
                if (renderer) renderer.removeTouchPoint(stateKey);
            }
            this._canvasTouchTracks.clear();
        }
        if (typeof gameState !== 'undefined' && gameState.pressedKeys) {
            gameState.pressedKeys.clear();
        }
    }

    // ========== 触屏操作指南 ==========
    /** 首次进入游戏时显示触屏操作指南（点「知道了」后不再出现） */
    _maybeShowTouchHint() {
        if (!this._pendingTouchHint) return;
        this._pendingTouchHint = false;
        if (this.touchHint) {
            this.touchHint.classList.remove('hidden');
        }
    }

    /** 是否处于暂停恢复倒计时阶段（画面冻结、判定暂停，但 DOM 界面活跃） */
    _isResumeCounting() {
        return gameState.resumeCountdownUntil > 0 && !gameState.paused;
    }

    // ========== 打击判定 (双阈值提前终止) ==========
    checkHit(track) {
        if (!renderer) return false;
        if (gameState.paused) return false;
        if (this._isResumeCounting()) return false;   // 恢复倒计时期间不判定

        // 使用渲染器实际绘制的判定线位置
        const judgmentY = renderer._judgmentY;
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
                note.startTime = currentTime;   // 记录命中时刻，用于按住进度渐变
                const isPerfect = timeDiff <= perfectWindow;
                gameState.lastHitOffset = currentTime - noteTime;
                gameState.lastHitAt = performance.now();
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
            gameState.lastHitOffset = currentTime - noteTime;
            gameState.lastHitAt = performance.now();

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
            // 触屏设备：详情标题行整行点击均可关闭（扩大热区）
            if (IS_TOUCH_DEVICE) {
                const header = this.lbDetailClose.closest('.lb-detail-header');
                if (header) {
                    header.addEventListener('click', (e) => {
                        if (e.target !== this.lbDetailClose && this.lbDetail) {
                            this.lbDetail.style.display = 'none';
                        }
                    });
                }
            }
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
            this._enterAnim('.lb-card');
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
            // 从开始画面进入：返回开始画面（静态背景，绘制一帧即可）
            this.startScreen.classList.remove('hidden');
            repaintStartScreen();
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
        this._notice('已导出全部成绩记录');
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
                    this._notice(result.message);
                } else {
                    this._notice('导入失败：' + result.message, 'error', 4000);
                }
                this._populateSongFilter();
                this._renderLeaderboardList();
            } catch (err) {
                this._notice('导入出错：' + err.message, 'error', 4000);
            }
            event.target.value = '';
        };

        reader.onerror = () => {
            this._notice('文件读取失败', 'error', 3600);
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
        if (this._isResumeCounting()) return;   // 恢复倒计时期间不判定

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
        if (this._isResumeCounting()) return;   // 恢复倒计时期间冻结 hold 判定

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

                    const judgmentY = renderer._judgmentY;
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

                renderer.createLaser(track);
            }
        }
    }
}