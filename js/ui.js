// ==================== UI 管理器 ====================

class UIManager {
    constructor() {
        this.songLibraryLoaded = false;

        // 排行榜详情状态
        this._detailSongName = null;
        this._detailRecordId = null;
        this._pendingChartHistory = null;

        this._resumeTask = null;

        // 设置页模式：'song'（谱面/难度）| 'global'（延迟/流速/皮肤/音量）
        this._settingsMode = 'song';
        this._settingsOrigin = 'start';
        this._switchingChart = false;
        // 歌曲组内上次选择的谱面（组 key → songLibrary 下标）
        const savedChartPicks = settingsStore.get('chartSelections') || {};
        const savedMidiDifficulties = settingsStore.get('midiDifficulties') || {};
        this._savedChartPicks = { ...savedChartPicks };
        this._savedMidiDifficulties = { ...savedMidiDifficulties };
        // 音频延迟校准运行时状态
        this._calibration = null;

        // 曲库排序（持久化）：默认曲库顺序；recent / plays 使用本地记录
        const sortModes = ['default', 'title', 'recent', 'plays'];
        const savedSort = settingsStore.get('songSort');
        this._songSort = sortModes.includes(savedSort) ? savedSort : 'default';
        this._songOrder = settingsStore.get('songOrder') === 'desc' ? 'desc' : 'asc';

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
        this.updateHitSoundDisplay();

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

        // 曲库排序
        this.songSortSelect = document.getElementById('songSortSelect');
        this.songSortDir    = document.getElementById('songSortDir');
        this.songSortStatus = document.getElementById('songSortStatus');

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
        this.settingsTitle      = document.getElementById('settingsTitle');
        this.settingsSongInfo   = document.getElementById('settingsSongInfo');
        this.settingsSongTitle  = document.getElementById('settingsSongTitle');
        this.settingsSongArtist = document.getElementById('settingsSongArtist');
        this.settingsSongMeta   = document.getElementById('settingsSongMeta');
        this.difficultyGroup    = document.getElementById('difficultyGroup');
        this.songChartSummary  = document.getElementById('songChartSummary');
        this.songChartName     = document.getElementById('songChartName');
        this.songChartLevel    = document.getElementById('songChartLevel');
        this.songChartMeta     = document.getElementById('songChartMeta');
        this.chartDifficultyGroup = document.getElementById('chartDifficultyGroup');
        this.chartDifficultySelector = document.getElementById('chartDifficultySelector');
        this.settingsGlobalBtn  = document.getElementById('settingsGlobalBtn');
        this.speedValue         = document.getElementById('speedValue');

        // 音频延迟校准
        this.calibrationStatus  = document.getElementById('calibrationStatus');
        this.calibrationPad     = document.getElementById('calibrationPad');
        this.calibrationPadSub  = document.getElementById('calibrationPadSub');
        this.calibrationStart   = document.getElementById('calibrationStart');
        this.calibrationApply   = document.getElementById('calibrationApply');
        this.calibrationReset   = document.getElementById('calibrationReset');

        // 音量
        this.volumeSlider = document.getElementById('volumeSlider');
        this.volumeValue  = document.getElementById('volumeValue');

        // 打击音效音量
        this.hitSoundSlider  = document.getElementById('hitSoundSlider');
        this.hitSoundValue   = document.getElementById('hitSoundValue');
        this.hitSoundPreview = document.getElementById('hitSoundPreview');
        this.speedSlider     = document.getElementById('speedSlider');

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
        this.resultTiming   = document.getElementById('resultTiming');
        this.resultBest     = document.getElementById('resultBest');
        // 本局启动时锁定的 chart identity，避免结算前选歌/UI 状态变化混淆对比对象
        this._runChartId = null;
        this._runSongName = null;

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
        // 全局设置无需选曲即可进入；谱面/难度在歌曲设置里
        this.settingsBtn.addEventListener('click', () => this.showGlobalSettings());
        if (this.settingsGlobalBtn) {
            this.settingsGlobalBtn.addEventListener('click', () => this.showGlobalSettings());
        }

        // 开始画面的排行榜按钮
        if (this.leaderboardStartBtn) {
            this.leaderboardStartBtn.addEventListener('click', () => this.showLeaderboard(false));
        }

        // 设置面板内按钮
        this.settingsStartBtn.addEventListener('click', () => this.startGame());
        this.settingsBackBtn.addEventListener('click', () => this.hideSettings());

        // 延迟校准
        if (this.calibrationStart) {
            this.calibrationStart.addEventListener('click', () => {
                if (this._calibration && this._calibration.active) {
                    this._stopCalibration();
                } else {
                    this._startCalibration().catch((err) => {
                        console.warn('Calibration failed:', err);
                        this._stopCalibration();
                        this._setCalibrationStatus('校准启动失败 · 请重试', 'warn');
                    });
                }
            });
        }
        if (this.calibrationPad) {
            // pointerdown 比 click 更贴近实际按下时间
            this.calibrationPad.addEventListener('pointerdown', (e) => {
                if (!e.isPrimary || e.button !== 0) return;
                e.preventDefault();
                this._recordCalibrationTap();
            });
            this.calibrationPad.addEventListener('keydown', (e) => {
                if (e.key !== ' ' && e.key !== 'Enter') return;
                e.preventDefault();
                if (!e.repeat) this._recordCalibrationTap();
            });
        }
        if (this.calibrationApply) {
            this.calibrationApply.addEventListener('click', () => this._applyCalibrationSuggestion());
        }
        if (this.calibrationReset) {
            this.calibrationReset.addEventListener('click', () => {
                this._stopCalibration();
                this.setAudioOffset(0);
                this._setCalibrationStatus('已重置为 0ms · 可重新测量', 'reset');
            });
        }

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

        // 曲库排序
        if (this.songSortSelect) {
            this.songSortSelect.addEventListener('change', () => this._setSongSort(this.songSortSelect.value));
        }
        if (this.songSortDir) {
            this.songSortDir.addEventListener('click', () => this._setSongOrder(this._songOrder === 'asc' ? 'desc' : 'asc'));
        }
        this._syncSortControls();

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

        // 速度滑块与按钮
        if (this.speedSlider) {
            this.speedSlider.addEventListener('input', () => {
                this.setNoteSpeed(parseFloat(this.speedSlider.value));
            });
        }

        // 音量滑块
        if (this.volumeSlider) {
            this.volumeSlider.addEventListener('input', () => {
                const vol = parseInt(this.volumeSlider.value);
                this.setVolume(vol);
            });
        }

        // 打击音效音量滑块 + 试听
        if (this.hitSoundSlider) {
            this.hitSoundSlider.addEventListener('input', () => {
                this.setHitSoundVolume(parseInt(this.hitSoundSlider.value));
            });
        }
        if (this.hitSoundPreview) {
            this.hitSoundPreview.addEventListener('click', () => this.previewHitSound());
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

        // 旋转 / 改窗口后重绘可见的结算与记录图表，避免画布停在旧尺寸
        let chartResizeTimer = null;
        window.addEventListener('resize', () => {
            clearTimeout(chartResizeTimer);
            chartResizeTimer = setTimeout(() => this._redrawVisibleCharts(), 150);
        });
    }

    _redrawVisibleCharts() {
        if (this.resultScreen && !this.resultScreen.classList.contains('hidden')) {
            renderer?.drawLineChart(gameState.performanceHistory, { animate: false });
        }
        if (this.lbDetail && this.lbDetail.style.display !== 'none' && this.lbChartCanvas) {
            renderer?.drawPerformanceChart(this.lbChartCanvas, this._detailHistory || [], { animate: false });
        }
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
            if (document.hidden && this._calibration?.active) {
                this._stopCalibration();
            }
            if (gameState.screen !== 'game') return;
            if (document.hidden) {
                if (gameState.resumeCountdownUntil > 0) {
                    // 回前台时继续剩余倒计时，不重新采样已冻结的谱面位置。
                    gameState.resumeCountdownRemaining = Math.max(0, gameState.resumeCountdownUntil - performance.now());
                    this._pauseGame();
                } else if (!gameState.paused) {
                    if (gameState.currentTime() < 0 || gameState.initialCountdownFrozen) {
                        this._freezeInitialCountdown();
                    } else {
                        this._pauseGame();
                    }
                }
                return;
            }

            if (gameState.initialCountdownFrozen) {
                this._resumeInitialCountdown();
            } else if (gameState.resumeCountdownRemaining !== null) {
                this._beginResumeCountdown(gameState.resumeCountdownRemaining);
            }
            if (!gameState.paused) this._requestWakeLock();
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
        if (gameState.screen !== 'game' || gameState.paused || this._isResumeCounting() || gameState.initialCountdownFrozen) return false;
        if (!audioEngine.isPlaying || audioEngine._paused) return false;

        const sceneTime = gameState.currentTime();
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

    _canImportSong() {
        return gameState.screen === 'start' && !this.startScreen.classList.contains('hidden') &&
            !this._openingSettings && !this._startingGame && !this._importBusy;
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
            if (!this._canImportSong()) return;
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
            if (!this._canImportSong()) {
                this._notice('请先回到选曲界面并等待加载结束，再拖入谱面', 'warn');
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

    /** 谱面类歌曲的合并键：同曲名 + 同艺术家视为同一首歌的不同谱面 */
    _chartGroupKey(song) {
        return `${song?.title || ''}\u0000${song?.artist || ''}`;
    }

    /**
     * 把 SONGS 谱面按歌曲合并为谱面组。
     * 组内始终按等级从低到高排序（等级相同再按难度名），
     * 这样卡片上的等级区间、谱面芯片顺序和歌曲设置里的切换器一致。
     * @param {Array} [songs] 默认全部谱面歌曲
     * @returns {Array<{key:string,title:string,artist:string,charts:Array<{song:object,index:number}>}>}
     */
    _getChartGroups(songs = this._getChartSongs()) {
        const map = new Map();
        songs.forEach((song) => {
            const key = this._chartGroupKey(song);
            let group = map.get(key);
            if (!group) {
                group = { key, title: song.title || 'Unknown', artist: song.artist || '', charts: [] };
                map.set(key, group);
            }
            group.charts.push({ song, index: songLibrary.indexOf(song) });
        });
        for (const group of map.values()) {
            group.charts.sort((a, b) => this._compareChartDifficulty(a, b));
        }

        // 合并后的组沿用「首张谱面」在曲库中的位置，DEFAULT ORDER 才能保持稳定
        return Array.from(map.values()).sort((a, b) => a.charts[0].index - b.charts[0].index);
    }

    /**
     * 谱面排序规则：等级升序 → 难度名（自然序）→ 曲库原始顺序。
     * 等级缺失的谱面排在最后，不参与前两级比较。
     */
    _compareChartDifficulty(a, b) {
        const lvA = parseInt(a.song?.level);
        const lvB = parseInt(b.song?.level);
        const hasA = Number.isFinite(lvA);
        const hasB = Number.isFinite(lvB);
        if (hasA && hasB && lvA !== lvB) return lvA - lvB;
        if (hasA !== hasB) return hasA ? -1 : 1;
        return this._compareSongTitle(a.song?.difficultyName, b.song?.difficultyName)
            || (a.index - b.index);
    }

    /** 找到某首歌所属的谱面组 */
    _songGroupOf(song) {
        if (!song) return null;
        return this._getChartGroups().find(g => g.key === this._chartGroupKey(song)) || null;
    }

    // ========== 曲库排序 ==========
    /** 标题排序：忽略大小写和全/半角差异，数字按数值比较。 */
    _compareSongTitle(a, b) {
        return String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base', numeric: true });
    }

    _defaultOrderFor(mode) {
        return mode === 'recent' || mode === 'plays' ? 'desc' : 'asc';
    }

    _setSongSort(mode) {
        this._songSort = ['default', 'title', 'recent', 'plays'].includes(mode) ? mode : 'default';
        // 切分类时给出该分类最自然的初始方向，之后可用按钮翻转
        this._songOrder = this._defaultOrderFor(this._songSort);
        settingsStore.set('songSort', this._songSort);
        settingsStore.set('songOrder', this._songOrder);
        this._syncSortControls();
        this.renderSongList();
    }

    _setSongOrder(order) {
        this._songOrder = order === 'desc' ? 'desc' : 'asc';
        settingsStore.set('songOrder', this._songOrder);
        this._syncSortControls();
        this.renderSongList();
    }

    _syncSortControls() {
        if (this.songSortSelect) this.songSortSelect.value = this._songSort;
        if (this.songSortDir) {
            const descending = this._songOrder === 'desc';
            this.songSortDir.dataset.order = this._songOrder;
            this.songSortDir.querySelector('.sort-dir-icon').textContent = descending ? '↓' : '↑';
            this.songSortDir.querySelector('.sort-dir-text').textContent = descending ? 'DESC' : 'ASC';
            this.songSortDir.setAttribute('aria-label', descending ? 'Descending order' : 'Ascending order');
            this.songSortDir.title = descending ? 'Descending order' : 'Ascending order';
        }
        if (this.songSortStatus) {
            const label = this.songSortSelect?.selectedOptions?.[0]?.textContent || 'default';
            this.songSortStatus.textContent = `Sorted by ${label.toLowerCase()}, ${this._songOrder === 'desc' ? 'descending' : 'ascending'}.`;
        }
    }

    /**
     * 从本地记录统计「每首歌 / 每个谱面组」的游玩次数与最近时间。
     * chartId 优先；无 chartId 的旧记录仅在曲名唯一时归并，避免串歌。
     */
    _collectPlayStats(resolveKey) {
        const stats = new Map();
        if (typeof leaderboard === 'undefined') return stats;
        for (const record of leaderboard.getAllRecords()) {
            const key = resolveKey(record);
            if (!key) continue;
            const entry = stats.get(key) || { plays: 0, last: 0 };
            entry.plays++;
            const at = Date.parse(record.date);
            if (Number.isFinite(at) && at > entry.last) entry.last = at;
            stats.set(key, entry);
        }
        return stats;
    }

    _playStatsForSongs(songs) {
        const ids = new Set(songs.map(song => String(song.id)));
        // 同名歌曲无法确定归属：记成 null，旧记录不计入任何一首
        const titleIds = new Map();
        for (const song of songs) {
            titleIds.set(song.title, titleIds.has(song.title) ? null : String(song.id));
        }
        return this._collectPlayStats(record => {
            const base = record.chartId ? String(record.chartId).split(':')[0] : null;
            if (base && ids.has(base)) return base;
            if (!record.chartId) {
                const id = titleIds.get(record.songName);
                if (id) return id;
            }
            return null;
        });
    }

    _playStatsForGroups(groups) {
        const groupBySongId = new Map();
        for (const group of groups) {
            for (const chart of group.charts) {
                if (chart.song.id) groupBySongId.set(String(chart.song.id), group.key);
            }
        }
        const groupsByTitle = new Map();
        for (const group of groups) {
            const keys = groupsByTitle.get(group.title) || [];
            keys.push(group.key);
            groupsByTitle.set(group.title, keys);
        }
        return this._collectPlayStats(record => {
            const base = record.chartId ? String(record.chartId).split(':')[0] : null;
            if (base && groupBySongId.has(base)) return groupBySongId.get(base);
            if (!record.chartId) {
                const keys = groupsByTitle.get(record.songName);
                if (keys?.length === 1) return keys[0];
            }
            return null;
        });
    }

    _sortedSongs(songs) {
        const list = [...songs];
        const direction = this._songOrder === 'desc' ? -1 : 1;
        if (this._songSort === 'title') {
            return list.sort((a, b) => direction * this._compareSongTitle(a.title, b.title));
        }
        if (this._songSort === 'recent' || this._songSort === 'plays') {
            const stats = this._playStatsForSongs(list);
            const valueOf = song => {
                const entry = stats.get(String(song.id));
                if (!entry) return -1;
                return this._songSort === 'plays' ? entry.plays : entry.last;
            };
            return list.sort((a, b) => direction * (valueOf(a) - valueOf(b))
                || this._compareSongTitle(a.title, b.title));
        }
        return direction === 1 ? list : list.reverse();
    }

    _sortedChartGroups(groups) {
        const list = [...groups];
        const direction = this._songOrder === 'desc' ? -1 : 1;
        if (this._songSort === 'title') {
            return list.sort((a, b) => direction * this._compareSongTitle(a.title, b.title)
                || this._compareSongTitle(a.artist, b.artist));
        }
        if (this._songSort === 'recent' || this._songSort === 'plays') {
            const stats = this._playStatsForGroups(list);
            const valueOf = group => {
                const entry = stats.get(group.key);
                if (!entry) return -1;
                return this._songSort === 'plays' ? entry.plays : entry.last;
            };
            return list.sort((a, b) => direction * (valueOf(a) - valueOf(b))
                || this._compareSongTitle(a.title, b.title)
                || this._compareSongTitle(a.artist, b.artist));
        }
        return direction === 1 ? list : list.reverse();
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

        const midiSongs = this._sortedSongs(this._getMidiSongs());
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
            // 同一首歌的不同难度谱面合并为一张卡片，谱面在歌曲设置里切换
            this._sortedChartGroups(this._getChartGroups(chartSongs)).forEach((group) => {
                this.songCardsSongs.appendChild(this.createSongGroupCard(group));
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
        if (this.activeTab === 'midi') {
            this.songCount.textContent = `${this._getMidiSongs().length} TRACKS`;
        } else {
            const groups = this._getChartGroups();
            const charts = groups.reduce((sum, g) => sum + g.charts.length, 0);
            this.songCount.textContent = `${groups.length} SONGS / ${charts} CHARTS`;
        }
    }

    createSongCard(song, index) {
        const card = document.createElement('div');
        card.className = 'song-card';
        card.dataset.songIndex = index;
        card.tabIndex = 0;
        card.setAttribute('role', 'button');
        card.setAttribute('aria-pressed', 'false');

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

        card.addEventListener('click', () => this.selectLibrarySong(song));
        card.addEventListener('keydown', e => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            if (!e.repeat) card.click();
        });
        return card;
    }

    /**
     * SONGS 标签页的歌曲组卡片。
     * 卡片展示该曲所有谱面（难度名 + 等级），真正的谱面切换在歌曲设置页完成。
     */
    createSongGroupCard(group) {
        const charts = group.charts;
        const primary = charts[0];
        const card = document.createElement('div');
        card.className = 'song-card song-group-card';
        card.dataset.songGroup = group.key;
        card.dataset.songIndex = primary.index;
        card.tabIndex = 0;
        card.setAttribute('role', 'button');
        card.setAttribute('aria-pressed', 'false');
        card.setAttribute('aria-label', `${group.title}，${charts.length} 个谱面`);

        const levels = charts
            .map(c => parseInt(c.song.level))
            .filter(n => Number.isFinite(n));
        const levelText = levels.length
            ? (Math.min(...levels) === Math.max(...levels)
                ? `LV.${levels[0]}`
                : `LV.${Math.min(...levels)}–${Math.max(...levels)}`)
            : '';

        const chips = charts.map(({ song }) => `
            <span class="group-chart-chip" data-chart-id="${this.escapeHTML(song.id || '')}">
                <span class="group-chart-name">${this.escapeHTML(song.difficultyName || 'CHART')}</span>
                ${Number.isFinite(parseInt(song.level)) ? `<span class="group-chart-lv">${parseInt(song.level)}</span>` : ''}
            </span>`).join('');

        card.innerHTML = `
            <div class="card-body">
                <div class="card-icon">♫</div>
                <div class="card-info">
                    <span class="card-title">${this.escapeHTML(group.title)}</span>
                    <span class="card-sub">${this.escapeHTML(group.artist || 'Unknown Artist')}</span>
                </div>
                <div class="card-meta">
                    ${charts.length > 1 ? `<span class="card-chart-count">${charts.length} CHARTS</span>` : ''}
                    ${levelText ? `<span class="card-level-range">${levelText}</span>` : ''}
                </div>
                <div class="card-arrow">→</div>
            </div>
            ${charts.length > 1 ? `<div class="group-chart-strip" aria-hidden="true">${chips}</div>` : ''}
        `;

        card.addEventListener('click', (e) => {
            if (e.target.closest('.group-chart-chip')) return;
            this._selectGroupChart(group);
        });
        card.addEventListener('keydown', e => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            if (!e.repeat) card.click();
        });
        return card;
    }

    /** 选中歌曲组内的谱面：优先组内记忆，其次当前选中，最后第一张 */
    _selectGroupChart(group) {
        const rememberedId = this._savedChartPicks[group.key];
        const remembered = group.charts.find(c => c.song.id === rememberedId);
        const current = group.charts.find(c => c.song === selectedLibrarySong);
        const member = remembered || current || group.charts[0];
        if (!member) return;
        this.selectLibrarySong(member.song);
    }

    /** 组卡片在触屏双击时使用的谱面下标（组内记忆优先） */
    _groupChartIndex(groupKey) {
        const group = this._getChartGroups().find(g => g.key === groupKey);
        if (!group) return -1;
        const rememberedId = this._savedChartPicks[groupKey];
        const remembered = group.charts.find(c => c.song.id === rememberedId);
        const current = group.charts.find(c => c.song === selectedLibrarySong);
        return (remembered || current || group.charts[0]).index;
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
            // detail===0 是键盘（Enter/Space）合成的点击，不受滑动手势影响
            if (touchMoved && e.detail > 0) {
                e.stopPropagation();
                e.preventDefault();
                touchMoved = false;
            }
        }, true);

        // 双击进设置：在列表容器上代理双击（卡片是动态生成的）
        listWrapper.addEventListener('click', (e) => {
            const card = e.target.closest('.song-card');
            if (!card || card.classList.contains('import-card')) return;   // 导入卡片不参与双击
            if (e.detail === 0) return;   // 键盘选择不触发“双击进设置”
            const idx = card.dataset.songGroup
                ? this._groupChartIndex(card.dataset.songGroup)
                : card.dataset.songIndex;
            if (idx === undefined || idx < 0) return;

            const now = performance.now();
            const isDoubleTap = this._lastCardTapIndex === idx && (now - this._lastCardTapAt) <= 400;
            this._lastCardTapAt = now;
            this._lastCardTapIndex = idx;

            if (isDoubleTap) {
                this._lastCardTapIndex = -1;
                this._stopPreview();   // 双击进设置前停止试听
                // 已选中则直接进入设置；未选中先选中再进入
                if (selectedSongSource !== 'library' || selectedLibrarySong !== songLibrary[parseInt(idx)]) {
                    this.selectLibrarySong(songLibrary[parseInt(idx)]);
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
            const idx = card.dataset.songGroup
                ? this._groupChartIndex(card.dataset.songGroup)
                : card.dataset.songIndex;
            if (idx === undefined || idx < 0) return;
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
    selectLibrarySong(song) {
        if (this._openingSettings || this._startingGame) return;
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
        // 记住歌曲组内选择的谱面，回到选歌页时沿用
        if (this._isChartSong(song)) {
            this._savedChartPicks[this._chartGroupKey(song)] = song.id;
            settingsStore.set('chartSelections', this._savedChartPicks);
        } else if (Array.isArray(song.difficulties) && song.difficulties.length) {
            // MIDI 难度属于歌曲设置：按曲目 ID 记忆，旧存档的 global difficulty 仅作首次回退
            const rememberedDifficulty = this._savedMidiDifficulties[song.id];
            const allowed = song.difficulties.map(d => typeof d === 'string' ? d : d?.key).filter(Boolean);
            const legacyDefault = settingsStore.get('difficulty');
            const next = allowed.includes(rememberedDifficulty)
                ? rememberedDifficulty
                : (allowed.includes(legacyDefault) ? legacyDefault : allowed[0]);
            if (next) this.setDifficulty(next);
        }

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
        if (!this._canImportSong()) return;
        this._importBusy = true;
        try {
            this._showImportToast(`解析 ${file.name}`, { meta: this._formatBytes(file.size) });
            await this._yieldToUI();
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
            const key = this._localChartKey(loadedMidiData.events, 'midi');
            this.setDifficulty(this._savedMidiDifficulties[key] || settingsStore.get('difficulty'));

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
            this._importBusy = false;
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
        if (!this._canImportSong()) return;
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
        const indeterminate = opts.indeterminate ?? (state === 'loading' && !hasProgress);
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
            this._applyOszCandidate(0);
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
        if (this._canImportSong()) this._applyOszCandidate(index);
    }

    _applyOszCandidate(index) {
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
        const selection = this.selectedSongName.closest('.current-selection');
        const importName = importedOsuFileName || importedMcFileName || importedMidiFileName;
        const previousName = this.selectedSongName.textContent;
        const previousSource = this.selectedSongSourceEl.textContent;
        if (selectedSongSource === 'library' && selectedLibrarySong) {
            this.selectedSongName.textContent = selectedLibrarySong.title;
            this.selectedSongName.style.color = 'var(--accent)';
            this.selectedSongSourceEl.textContent = ['LIBRARY', selectedLibrarySong.difficultyName].filter(Boolean).join(' / ');
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
        selection.dataset.source = selectedSongSource || '';
        if (previousName !== this.selectedSongName.textContent || previousSource !== this.selectedSongSourceEl.textContent) {
            this._enterAnim(selection);
        }
    }

    updateAllHighlights() {
        // 导入卡片（仅在 MIDI 标签页）
        this.importMidiCard.classList.toggle('selected', selectedSongSource === 'import');

        // 曲库卡片（两个标签页都更新）
        const allSongCards = document.querySelectorAll('.song-cards .song-card');
        allSongCards.forEach(card => {
            let isSelected = false;
            if (card.dataset.songGroup) {
                const group = this._getChartGroups().find(g => g.key === card.dataset.songGroup);
                isSelected = !!(selectedSongSource === 'library' && selectedLibrarySong && group &&
                    group.charts.some(c => c.song === selectedLibrarySong));
                // 组内高亮当前谱面
                card.querySelectorAll('.group-chart-chip').forEach(chip => {
                    chip.classList.toggle('active', isSelected && !!selectedLibrarySong &&
                        chip.dataset.chartId === String(selectedLibrarySong.id ?? ''));
                });
            } else {
                const idx = parseInt(card.dataset.songIndex);
                isSelected = !!(selectedSongSource === 'library' &&
                    selectedLibrarySong &&
                    songLibrary[idx] === selectedLibrarySong);
            }
            card.classList.toggle('selected', isSelected);
            if (card.hasAttribute('aria-pressed')) card.setAttribute('aria-pressed', String(!!isSelected));
        });
    }

    updateStartButtons() {
        const hasSelection = selectedSongSource !== null;
        this.startBtn.disabled = !hasSelection;
        // 全局设置与选曲无关，始终可用
        this.settingsBtn.disabled = false;
    }

    // ========== 启动流程 ==========
    async handleStartOrConfig() {
        if (!selectedSongSource || this._importBusy) return;
        // 防连点：载入谱面是异步的，快速双击会重复请求并弹两次设置页
        if (this._openingSettings || this._startingGame) return;
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

    /**
     * 打开设置页。
     * - 'song'：歌曲设置（谱面/难度），需要已选曲
     * - 'global'：全局设置（延迟/校准/流速/皮肤/音量），无选曲也可打开
     * @param {'song'|'global'} mode
     * @param {'start'|'song'} [origin] 全局设置返回来源
     */
    showSettings(mode = 'song', origin) {
        if (mode !== 'global' && !selectedSongSource) return;

        if (mode === 'song') this._stopCalibration();
        this._settingsMode = mode;
        if (mode === 'global') {
            this._settingsOrigin = origin || 'start';
        }

        // 全局设置暂时隐藏进度；回到同一谱面时保留原状态。
        if (!this._pendingAudioKey) this._setAudioStatus('hidden');

        if (mode === 'global') {
            this.settingsTitle.textContent = 'GLOBAL SETTINGS';
            this.settingsSongInfo.classList.add('hidden');
            this._calSuggestion = null;
            if (this.calibrationApply) this.calibrationApply.disabled = true;
            this._setCalibrationStatus(
                `当前偏移 ${audioOffsetMs > 0 ? '+' : ''}${audioOffsetMs}ms · 可测量更精确的延迟`,
                'idle'
            );
        } else {
            this.settingsTitle.textContent = 'SONG SETTINGS';
            this.settingsSongInfo.classList.remove('hidden');
            this._renderSongSettingsInfo();
            this._renderChartDifficultySelector();
        }

        this._applySettingsMode();
        this.startScreen.classList.add('hidden');
        this.settingsScreen.classList.remove('hidden');
        this._enterAnim('.settings-card');
    }

    /** 全局设置入口（选歌页 / 歌曲设置内均可进入） */
    showGlobalSettings() {
        if (this._openingSettings || this._startingGame || this._switchingChart || this._importBusy) return;
        this._stopPreview();
        const origin = this._settingsMode === 'song' &&
            !this.settingsScreen.classList.contains('hidden') ? 'song' : 'start';
        this.showSettings('global', origin);
    }

    /** 按当前模式显示/隐藏设置分组与动作按钮 */
    _applySettingsMode() {
        const isGlobal = this._settingsMode === 'global';
        document.querySelectorAll('.global-setting-group').forEach(el => {
            el.classList.toggle('hidden', !isGlobal);
        });
        const group = this._isChartSong(selectedLibrarySong) ? this._songGroupOf(selectedLibrarySong) : null;
        const hasChartChoices = !!(group && group.charts.length > 1);
        document.querySelectorAll('.song-setting-group').forEach(el => el.classList.toggle('hidden', isGlobal));
        // 谱面切换器只在“歌曲设置 + 同曲多谱面”时出现；
        // 返回歌曲设置时必须恢复，不能把整组永久隐藏。
        this.chartDifficultyGroup.classList.toggle('hidden', isGlobal || !hasChartChoices);
        this.difficultyGroup.classList.toggle('hidden', isGlobal || !!getLoadedChartData());
        this.songChartSummary.classList.toggle('hidden', isGlobal);
        this.settingsScreen.dataset.mode = this._settingsMode;
        this.settingsStartBtn.classList.toggle('hidden', isGlobal);
        this.settingsStartBtn.disabled = this._switchingChart || (!loadedMidiData && !getLoadedChartData());
        this.settingsGlobalBtn?.classList.toggle('hidden', isGlobal);
        this.settingsBackBtn.textContent = isGlobal && this._settingsOrigin === 'song'
            ? '← SONG SETTINGS'
            : 'BACK';
    }

    /** 更新歌曲设置页的曲目元数据 */
    _renderSongSettingsInfo() {
        const importName = importedOsuFileName || importedMidiFileName;
        if (selectedSongSource === 'library' && selectedLibrarySong) {
            this.settingsSongTitle.textContent = selectedLibrarySong.title;
            this.settingsSongArtist.textContent = selectedLibrarySong.artist || '';
        } else if (selectedSongSource === 'import') {
            this.settingsSongTitle.textContent = importName || 'Imported MIDI';
            this.settingsSongArtist.textContent = 'Custom Import';
        }

        let bpmText = '';
        let durText = '';
        const chartData = getLoadedChartData();
        let level;
        if (!chartData) this.filterDifficultyButtons();
        if (chartData && chartData.meta) {
            const diff = new DifficultyCalculator(chartData.notes).calculate();
            level = diff.level;
            bpmText = `BPM ${chartData.meta.bpm}  •  ★ ${diff.star.toFixed(2)}  •  Lv.${diff.level}`;
            durText = formatDuration(chartData.meta.duration);
            if (chartData.meta.version) bpmText += `  •  ${chartData.meta.version}`;
            const creator = selectedLibrarySong?.creator || chartData.meta.creator;
            if (creator) bpmText += `  •  Chart by ${creator}`;
        } else if (loadedMidiData) {
            const bpm = computeAverageBpm(loadedMidiData);
            const dur = formatDuration(loadedMidiData.duration);
            bpmText = `BPM ${bpm}`;
            durText = dur;
        }
        this.settingsSongMeta.textContent = [bpmText, durText].filter(Boolean).join('  •  ');

        // 谱面摘要：单谱面歌曲也有一块明确的“当前谱面”信息
        const isChart = !!getLoadedChartData();
        const group = this._isChartSong(selectedLibrarySong) ? this._songGroupOf(selectedLibrarySong) : null;
        if (isChart) {
            this.songChartName.textContent = selectedLibrarySong?.difficultyName || chartData.meta?.version || 'CHART';
            this.songChartLevel.textContent = Number.isFinite(level) ? `LV.${level}` : '';
        } else {
            this._renderMidiDifficultySummary();
        }
        const noteCount = chartData?.notes?.length ?? 0;
        this.songChartMeta.textContent = [
            noteCount ? `${noteCount} NOTES` : '',
            isChart ? 'FIXED CHART' : 'GENERATED CHART',
            group && group.charts.length > 1 ? `${group.charts.length} CHARTS IN THIS SONG` : ''
        ].filter(Boolean).join('  ·  ');

        // 谱面（.mc / .osu）固定，不显示生成难度；MIDI 仍可选难度
        this.difficultyGroup.classList.toggle('hidden', isChart);
    }

    _renderMidiDifficultySummary() {
        const metadata = selectedLibrarySong?.difficulties?.find(d => d?.key === selectedDifficulty);
        const level = parseInt(metadata?.level);
        this.songChartName.textContent = metadata?.name || selectedDifficulty.toUpperCase();
        this.songChartLevel.textContent = Number.isFinite(level) ? `LV.${level}` : '';
    }

    /** 歌曲设置页：同曲多谱面时的谱面切换器 */
    _renderChartDifficultySelector() {
        if (!this.chartDifficultyGroup || !this.chartDifficultySelector) return;
        const group = this._isChartSong(selectedLibrarySong) ? this._songGroupOf(selectedLibrarySong) : null;
        const charts = group ? group.charts : [];
        const show = this._settingsMode === 'song' && charts.length > 1;
        this.chartDifficultyGroup.classList.toggle('hidden', !show);
        if (!show) {
            this.chartDifficultySelector.innerHTML = '';
            return;
        }

        this.chartDifficultySelector.innerHTML = charts.map(({ song }) => {
            const active = song === selectedLibrarySong;
            const lv = parseInt(song.level);
            return `
                <button class="chart-difficulty-btn${active ? ' active' : ''}" type="button"
                    data-song-index="${songLibrary.indexOf(song)}" aria-pressed="${active}">
                    <span class="cd-name">${this.escapeHTML(song.difficultyName || 'CHART')}</span>
                    ${Number.isFinite(lv) ? `<span class="cd-lv">LV.${lv}</span>` : ''}
                </button>`;
        }).join('');

        this.chartDifficultySelector.querySelectorAll('.chart-difficulty-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (this._switchingChart) return;
                const index = parseInt(btn.dataset.songIndex);
                const target = songLibrary[index];
                if (!target || target === selectedLibrarySong) return;
                this._selectChartVariant(target);
            });
        });
    }

    /** 切换到同曲的另一张谱面，并重新载入设置页元数据/伴奏 */
    async _selectChartVariant(song) {
        if (this._switchingChart || this._startingGame || this._openingSettings) return;
        this._switchingChart = true;
        this.settingsStartBtn.disabled = true;
        this.chartDifficultySelector.querySelectorAll('button').forEach(b => { b.disabled = true; });
        const previous = selectedLibrarySong;
        const previousMc = loadedMcData;
        const previousOsu = loadedOsuData;
        try {
            this.selectLibrarySong(song);
            await this.handleStartOrConfig();
            if (!getLoadedChartData() && previous && (previousMc || previousOsu)) {
                // 载入失败时继续使用原谱面，避免界面与实际选曲不一致。
                this.selectLibrarySong(previous);
                loadedMcData = previousMc;
                loadedOsuData = previousOsu;
                this.showSettings('song');
                this._preloadSongAudio(previous);
            }
        } finally {
            this._switchingChart = false;
            this.settingsStartBtn.disabled = !loadedMidiData && !getLoadedChartData();
            this.chartDifficultySelector.querySelectorAll('button').forEach(b => { b.disabled = false; });
        }
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
        if (this._startingGame || this._switchingChart) return;
        this._stopCalibration();
        // 从歌曲设置进入全局设置时，BACK 返回歌曲设置
        if (this._settingsMode === 'global' && this._settingsOrigin === 'song' && selectedSongSource) {
            this.showSettings('song');
            return;
        }
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
        if (this._startingGame || this._switchingChart || this._openingSettings || this._importBusy) return;
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

        // 锁定本局歌曲/谱面身份，供结算历史最佳比较使用。
        // 放在音频等待之后，确保身份对应真正开始游玩的谱面。
        this._runChartId = this._recordChartId();
        this._runSongName = selectedSongDisplayName || 'Unknown';
        this._runDifficulty = selectedLibrarySong?.difficultyName || chartData?.meta?.version || selectedDifficulty;

        // 停止一切残留播放（结算音乐/上一局音乐）。
        audioEngine.stopMusic();
        this._resumeTask = null;

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

        gameState.screen = 'game';
        gameState.notes = notes;
        gameState.totalNotes = notes.length;
        gameState.isPlaying = true;
        gameState.timingOffset = audioOffsetMs;

        // 提前在 AudioContext 上排程，倒计时和谱面无需各自计时。
        this._playGameMusic(CONFIG.countdownDuration / 1000);

        // 确保 Canvas 尺寸正确
        if (renderer) {
            renderer.resize();
        }
        this.updateInGameUI();

        // 首次游玩：弹出触屏操作指南并冻结初始倒计时，关闭后继续
        this._maybeShowTouchHint();
        if (document.hidden || this._isTouchHintVisible()) this._freezeInitialCountdown();

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
        this._resumeInitialCountdown();
    }

    _isTouchHintVisible() {
        return this.touchHint && !this.touchHint.classList.contains('hidden');
    }

    _freezeInitialCountdown() {
        gameState.pauseSnapshotTime = gameState.currentTime();
        gameState.initialCountdownFrozen = true;
        audioEngine.pauseMusic();
    }

    async _resumeInitialCountdown() {
        if (gameState.screen !== 'game' || !gameState.initialCountdownFrozen || document.hidden || this._isTouchHintVisible()) return;
        if (await audioEngine.resumeMusic()) gameState.initialCountdownFrozen = false;
    }

    _playGameMusic(delaySeconds) {
        const chart = getLoadedChartData();
        if (loadedMidiData) {
            audioEngine.startMidiMusic(loadedMidiData.events, delaySeconds);
        } else if (audioEngine.audioBuffer) {
            audioEngine.startAudioPlayback(delaySeconds, (chart?.meta?.audioOffset || 0) / 1000);
        } else {
            CONFIG.bpm = chart?.meta?.bpm || 120;
            audioEngine.startPresetMusic(delaySeconds);
        }
    }

    endGame() {
        gameState.recordIntervalStats();
        gameState.screen = 'result';
        gameState.isPlaying = false;
        gameState.paused = false;
        document.body.classList.remove('game-active');
        this._setPauseOverlayVisible(false);
        this.setSkipIntroVisible(false);
        this._releaseWakeLock();
        audioEngine.stopMusic();
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
        const rankClass = this._getRecordRankClass(rank);
        rankDisplay.className = `rank-stamp ${rankClass}`;
        resultCard.dataset.rank = rankClass;
        document.getElementById('resultTrack').textContent = [this._runSongName, this._runDifficulty].filter(Boolean).join(' / ');

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

        // 结算最佳成绩提示：在写入本局记录前读取同谱面历史最佳
        const previousBest = this._getPreviousBestScore(this._runChartId, this._runSongName);
        this._renderResultBest(previousBest, scoreResult.finalScore, isGameFailed);

        this.finalScore.textContent    = scoreResult.finalScore.toLocaleString();
        this.finalCombo.textContent    = gameState.maxCombo;
        this.finalAccuracy.textContent = accuracy.toFixed(2) + '%';
        this.finalPerfect.textContent  = gameState.perfect;
        this.finalGreat.textContent    = gameState.great;
        this.finalMiss.textContent     = gameState.miss;
        if (this.resultTiming) {
            this.resultTiming.innerHTML = this._timingSplitHtml(gameState.early, gameState.late);
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

    /** 重播结算进场，关闭或查看记录不改动实际数值。 */
    _enterResult() {
        // 揭示动画交给 CSS（chartFeed），避免画布 rAF 与入场裁剪叠加。
        renderer?.drawLineChart(gameState.performanceHistory, { animate: false });
        this._enterAnim('#resultCard');
    }

    /**
     * 当前谱面的历史最佳分（不包含失败局）。
     * 只匹配有明确谱面 ID 的记录。
     */
    _getPreviousBestScore(chartId, songName = this._runSongName) {
        if (!chartId || typeof leaderboard === 'undefined') return null;
        try {
            const player = leaderboard.getPlayerName();
            let best = null;
            const names = chartId.startsWith('local:')
                ? leaderboard.getAllSongSummaries().map(song => song.songName)
                : [songName || 'Unknown'];
            for (const r of names.flatMap(name => leaderboard.getRecords(name))) {
                if (r.isFailed || r.rank === 'F' || r.chartId !== chartId ||
                    (r.playerName || 'Local') !== player) continue;
                const score = Number(r.score);
                if (r.score != null && Number.isFinite(score) && (best === null || score > best)) best = score;
            }
            return best;
        } catch {
            return null;
        }
    }

    _renderResultBest(previousBest, score, isFailed) {
        if (!this.resultBest) return;
        this.resultBest.classList.remove('is-new', 'is-best', 'is-failed');
        if (isFailed) {
            this.resultBest.classList.add('is-failed');
            this.resultBest.innerHTML = previousBest === null
                ? `<span class="result-best-tag">NO RECORD</span><span class="result-best-value">RUN FAILED</span>`
                : `<span class="result-best-tag">BEST SCORE</span><span class="result-best-value">${previousBest.toLocaleString()}</span>`;
            return;
        }
        if (previousBest === null || score > previousBest) {
            const gain = previousBest === null ? null : score - previousBest;
            this.resultBest.classList.add('is-new');
            this.resultBest.innerHTML = `<span class="result-best-tag">NEW BEST</span>` +
                (gain !== null ? `<span class="result-best-value">+${gain.toLocaleString()}</span>` : '');
        } else {
            this.resultBest.classList.add('is-best');
            this.resultBest.innerHTML = `<span class="result-best-tag">BEST SCORE</span>` +
                `<span class="result-best-value">${previousBest.toLocaleString()}</span>`;
        }
    }

    /** 旧记录没有早/晚字段：返回 null 表示未知，避免把「没记录」误显示成 0。 */
    _timingCount(value) {
        if (value === null || value === undefined || value === '') return null;
        const count = Number(value);
        return Number.isFinite(count) && count >= 0 ? Math.floor(count) : null;
    }

    /**
     * Early / Late 分叉条：从中心零线向两侧生长，长度按双方占比分配。
     * 蓝色靠左、红色靠右，与游玩中的 combo 侧箭头保持同一套语义。
     */
    _timingSplitHtml(early, late) {
        const e = this._timingCount(early);
        const l = this._timingCount(late);
        const known = e !== null && l !== null;
        const total = known ? e + l : 0;
        const earlyShare = total ? (e / total) * 50 : 0;
        const lateShare = total ? (l / total) * 50 : 0;
        const middle = known
            ? `<span class="timing-track">
                <i class="timing-fill early" style="--fill:${earlyShare.toFixed(2)}%"></i>
                <i class="timing-fill late" style="--fill:${lateShare.toFixed(2)}%"></i>
            </span>`
            : '<span class="timing-unknown">NOT RECORDED</span>';
        return `
            <span class="timing-side early"><i class="timing-arrow" aria-hidden="true">◀</i>EARLY <b>${known ? e : '—'}</b></span>
            ${middle}
            <span class="timing-side late">LATE <b>${known ? l : '—'}</b><i class="timing-arrow" aria-hidden="true">▶</i></span>
        `;
    }

    // ========== 保存记录到排行榜 ==========
    _recordChartId() {
        if (selectedSongSource === 'library' && selectedLibrarySong?.id) {
            return this._isChartSong(selectedLibrarySong)
                ? selectedLibrarySong.id : `${selectedLibrarySong.id}:${selectedDifficulty}`;
        }
        if (selectedSongSource !== 'import') return null;
        // 本地谱面可能同名；按音符签名区分，不用文件名猜测。
        const chart = getLoadedChartData();
        const key = this._localChartKey(chart?.notes || loadedMidiData?.events, chart ? 'fixed' : 'midi');
        return key && !chart ? `${key}:${selectedDifficulty}` : key;
    }

    _localChartKey(notes, kind) {
        if (!notes?.length) return null;
        let hash = 2166136261;
        for (const n of notes) {
            const signature = `${n.time}|${n.track ?? n.noteNumber}|${n.type}|${n.endTime ?? n.duration}|${n.velocity ?? ''};`;
            for (let i = 0; i < signature.length; i++) {
                hash = Math.imul(hash ^ signature.charCodeAt(i), 16777619);
            }
        }
        return `local:${kind}:${notes.length}:${(hash >>> 0).toString(16)}`;
    }

    _saveToLeaderboard(accuracy, rank, isGameFailed) {
        if (typeof leaderboard === 'undefined') return;

        try {
            leaderboard.addRecord({
                songName: this._runSongName,
                chartId: this._runChartId,
                date: new Date().toISOString(),
                score: gameState.score,
                accuracy: accuracy,
                maxCombo: gameState.maxCombo,
                perfect: gameState.perfect,
                great: gameState.great,
                miss: gameState.miss,
                early: gameState.early,
                late: gameState.late,
                rank: isGameFailed ? 'F' : rank,
                difficulty: this._runDifficulty,
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

        // 现场加载若晚于重试完成，不能覆盖新一局的伴奏和时钟。
        const finishedNotes = gameState.notes;
        const loaded = await audioEngine.loadAudioFile(audioPath, { cacheKey, setCurrent: false });
        if (loaded && gameState.screen === 'result' && gameState.notes === finishedNotes && audioEngine.useCachedAudio(cacheKey)) {
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
        this._resumeTask = null;
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

        // 应用打击音效音量
        if (s.hitSoundVolume !== undefined) {
            hitSoundVolume = settingsStore._clampHitSoundVolume(s.hitSoundVolume);
            this.updateHitSoundDisplay();
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
            songName: this._runSongName,
            chartId: this._runChartId,
            date: now.toISOString(),
            score: gameState.score,
            accuracy: accuracy,
            maxCombo: gameState.maxCombo,
            perfect: gameState.perfect,
            great: gameState.great,
            miss: gameState.miss,
            early: gameState.early,
            late: gameState.late,
            rank: rank,
            difficulty: this._runDifficulty,
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
    /** 设置流速：接受任意来源（滑块/按钮），统一夹取并同步三处显示 */
    setNoteSpeed(value) {
        const num = Number(value);
        if (!Number.isFinite(num)) return;
        // 步进 0.1，避免浮点尾巴（如 15.700000000000001）
        noteSpeed = Math.round(Math.max(MIN_SPEED, Math.min(MAX_SPEED, num)) * 10) / 10;
        this.updateSpeedDisplay();
        this._syncSettingsToStore();
    }

    changeSpeed(delta) {
        this.setNoteSpeed(noteSpeed + delta);
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
        const key = selectedSongSource === 'import'
            ? this._localChartKey(loadedMidiData?.events, 'midi')
            : (!this._isChartSong(selectedLibrarySong) ? selectedLibrarySong?.id : null);
        if (key != null) {
            this._savedMidiDifficulties[key] = diff;
            settingsStore.set('midiDifficulties', this._savedMidiDifficulties);
        }
        document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
        const btn = document.querySelector(`.diff-btn[data-diff="${diff}"]`);
        if (btn) btn.classList.add('active');
        if (this._settingsMode === 'song' && loadedMidiData) this._renderMidiDifficultySummary();
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
            this.speedValue.textContent = `${noteSpeed.toFixed(1)}x`;
        }
        if (this.speedSlider) {
            this.speedSlider.value = noteSpeed.toFixed(1);
            this.speedSlider.setAttribute('aria-valuetext', `${noteSpeed.toFixed(1)}x`);
        }
    }

    // ========== 打击音效音量 ==========
    /** 设置打击音效音量（0-300%），只影响打击音，不动伴奏 */
    setHitSoundVolume(percent) {
        const num = Number(percent);
        hitSoundVolume = Number.isFinite(num) ? Math.max(0, Math.min(300, Math.round(num))) : 100;
        this.updateHitSoundDisplay();
        this._syncSettingsToStore();
    }

    updateHitSoundDisplay() {
        if (this.hitSoundValue) {
            this.hitSoundValue.textContent = `${hitSoundVolume}%`;
        }
        if (this.hitSoundSlider) {
            this.hitSoundSlider.value = hitSoundVolume;
            this.hitSoundSlider.setAttribute('aria-valuetext', `${hitSoundVolume}%`);
        }
    }

    /** 试听：按当前音量播一次 Perfect 打击音，0% 时给出明确提示 */
    previewHitSound() {
        audioEngine.unlock?.();
        if (hitSoundVolume <= 0) {
            this._notice('打击音效音量为 0%，调高后即可试听', 'warn', 2400);
            return;
        }
        audioEngine.playHitSound('perfect');
    }

    // ========== 音频延迟校准 ==========
    /**
     * 播放 120 BPM 节拍器并采样点按，计算建议偏移。
     * 采用「最接近节拍的带符号偏差」：early 为负、late 为正；
     * 结束后用中位数与 MAD 剔除离群值，再对保留样本取平均。
     */
    async _startCalibration() {
        if (this._calStarting) return;
        if (currentVolume <= 0) {
            this._setCalibrationStatus('音量为 0 · 请调高音量后测量', 'warn');
            return;
        }
        if (document.hidden) {
            this._setCalibrationStatus('页面不可见，无法测量 · 请回到设置页', 'warn');
            return;
        }
        this._calStarting = true;
        try {
            if (!audioEngine.context) audioEngine.init();
            const ctx = audioEngine.context;
            if (!ctx) {
                this._setCalibrationStatus('音频初始化失败 · 请重新打开设置页', 'warn');
                return;
            }
            this._setCalibrationStatus('正在启动音频…', 'listening');
            try { await ctx.resume(); } catch { /* 状态检查会兜底 */ }
            // 等待期间页面可能被关闭/隐藏，避免在后台启动节拍器
            if (document.hidden || this._settingsMode !== 'global' ||
                this.settingsScreen.classList.contains('hidden')) {
                this._setCalibrationStatus('测量已取消 · 请重新开始', 'warn');
                return;
            }
            if (ctx.state !== 'running') {
                this._setCalibrationStatus('音频未启动 · 点击页面后重试', 'warn');
                return;
            }

            this._teardownCalibration(this._calibration);
            this._stopPreview();
            this._calSuggestion = null;

            const interval = 0.5;          // 120 BPM
            const beats = 13;              // 2 拍预备 + 11 拍可采样
            const countIn = 2;
            const startAt = ctx.currentTime + 0.35;
            const state = {
                active: true,
                interval,
                countIn,
                beats,
                startAt,
                lastBeat: -1,
                samples: [],
                oscillators: [],
                timer: null,
                lastTapAt: -1
            };
            this._calibration = state;

            for (let i = 0; i < beats; i++) {
                this._scheduleCalibrationClick(ctx, startAt + i * interval, i % 4 === 0);
            }

            const endAt = startAt + (beats - 0.5) * interval;
            state.timer = setTimeout(() => this._finishCalibration(), Math.max(0, (endAt - ctx.currentTime) * 1000));

            this.calibrationPad.disabled = false;
            this.calibrationPad.classList.add('active');
            this.calibrationStart.textContent = 'STOP';
            this.calibrationApply.disabled = true;
            this.calibrationPadSub.textContent = '跟随节拍点击 · 0 / 10';
            this._setCalibrationStatus('聆听节拍 · 2 拍预备后开始计数', 'listening');
        } finally {
            this._calStarting = false;
        }
    }

    _scheduleCalibrationClick(ctx, time, accent) {
        const state = this._calibration;
        if (!state) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = accent ? 1760 : 1320;
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.exponentialRampToValueAtTime(accent ? 0.2 : 0.14, time + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.055);
        osc.connect(gain);
        // 与游戏音频走同一个输出链路，并遵守全局音量。
        gain.connect(audioEngine.masterGain);
        osc.start(time);
        osc.stop(time + 0.07);
        state.oscillators.push(osc);
    }

    _recordCalibrationTap() {
        const state = this._calibration;
        if (!state || !state.active) return;
        const ctx = audioEngine.context;
        if (ctx?.state !== 'running') return;
        const now = ctx.currentTime;
        if (now < state.startAt) return;

        // 物理按键抖动 / 连击去重
        if (state.lastTapAt >= 0 && now - state.lastTapAt < 0.2) return;

        const rel = (now - state.startAt) / state.interval;
        const beatIndex = Math.round(rel);
        if (beatIndex < state.countIn || beatIndex >= state.beats || beatIndex <= state.lastBeat) return;

        const deltaMs = (now - (state.startAt + beatIndex * state.interval)) * 1000;
        state.lastBeat = beatIndex;
        state.lastTapAt = now;
        state.samples.push(deltaMs);
        const n = state.samples.length;
        this.calibrationPadSub.textContent = `跟随节拍点击 · ${n} / 10`;
        this._setCalibrationStatus(`已采样 ${n} 次 · 保持稳定`, 'sampling');
        this.calibrationPad.classList.remove('hit');
        void this.calibrationPad.offsetWidth;
        this.calibrationPad.classList.add('hit');

        if (n >= 10) this._finishCalibration();
    }

    _finishCalibration() {
        const state = this._calibration;
        if (!state) return;
        this._teardownCalibration(state);

        if (state.samples.length < 5) {
            this._setCalibrationStatus(
                `样本不足（${state.samples.length}/10）· 请重新测量`,
                'warn'
            );
            return;
        }

        const samples = state.samples.slice().sort((a, b) => a - b);
        const median = samples[Math.floor(samples.length / 2)];
        const deviations = samples.map(v => Math.abs(v - median)).sort((a, b) => a - b);
        const mad = deviations[Math.floor(deviations.length / 2)];
        const limit = Math.max(28, mad * 2.5);
        const kept = samples.filter(v => Math.abs(v - median) <= limit);
        const mean = kept.reduce((sum, v) => sum + v, 0) / kept.length;
        const spread = Math.sqrt(
            kept.reduce((sum, v) => sum + (v - mean) ** 2, 0) / kept.length
        );

        // 点按节奏本身不稳定时，平均值没有校准意义；宁可要求重测。
        if (kept.length < 5 || spread > 75) {
            this._setCalibrationStatus(
                `节奏不够稳定（±${Math.round(spread)}ms）· 请跟随节拍重测`,
                'warn'
            );
            this.calibrationPadSub.textContent = '测量未保存 · 可重新开始';
            return;
        }

        const suggestion = Math.max(-200, Math.min(200, Math.round(mean)));
        const dropped = state.samples.length - kept.length;

        this._calSuggestion = suggestion;
        this.calibrationApply.disabled = false;
        this._setCalibrationStatus(
            `建议偏移 ${suggestion > 0 ? '+' : ''}${suggestion}ms · ` +
            `${kept.length} 个样本${dropped ? `，剔除 ${dropped} 个离群值` : ''}`,
            'ready'
        );
        this.calibrationPadSub.textContent = '测量完成 · 可应用建议或再测一次';
    }

    _applyCalibrationSuggestion() {
        if (this._calSuggestion === null || this._calSuggestion === undefined) return;
        this.setAudioOffset(this._calSuggestion);
        this._setCalibrationStatus(
            `已应用 ${this._calSuggestion > 0 ? '+' : ''}${this._calSuggestion}ms · 用实际歌曲再微调`,
            'applied'
        );
        this.calibrationApply.disabled = true;
        this._calSuggestion = null;
    }

    /** 停止并清理当前测量（不改动已应用的偏移） */
    _teardownCalibration(state) {
        if (!state) return;
        state.active = false;
        if (state.timer) clearTimeout(state.timer);
        state.oscillators.forEach((osc) => {
            try { osc.stop(); } catch { /* 已停止 */ }
        });
        state.oscillators.length = 0;
        if (this._calibration === state) this._calibration = null;
        if (this.calibrationPad) {
            this.calibrationPad.classList.remove('active', 'hit');
            this.calibrationPad.disabled = true;
        }
        if (this.calibrationStart) this.calibrationStart.textContent = 'START TAPPING';
        if (this.calibrationApply) this.calibrationApply.disabled = true;
        if (this.calibrationPadSub) this.calibrationPadSub.textContent = 'START TAPPING TO MEASURE';
    }

    _stopCalibration() {
        this._teardownCalibration(this._calibration);
        this._calSuggestion = null;
        this.calibrationApply.disabled = true;
        this._setCalibrationStatus('准备测量 · 120 BPM', 'idle');
    }

    _setCalibrationStatus(text, tone = 'idle') {
        if (!this.calibrationStatus) return;
        this.calibrationStatus.textContent = text;
        this.calibrationStatus.dataset.tone = tone;
    }

    // ========== 全局偏移控制 ==========
    setAudioOffset(ms, updateUI) {
        // 限制在 -200 ~ +200 范围（覆盖蓝牙耳机的较高延迟）
        audioOffsetMs = Math.max(-200, Math.min(200, ms));

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
        if (currentVolume === 0 && this._calibration?.active) {
            this._stopCalibration();
            this._setCalibrationStatus('音量为 0 · 测量已停止', 'warn');
        }

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
            if (key === 'enter' && !this.startScreen.classList.contains('hidden') &&
                !e.target.closest?.('button, a, [role="button"]')) {
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
        if (!this._canSkipIntro()) return;
        const target = this._getFirstNoteTime() - 5000;
        const delta = target - gameState.currentTime();
        audioEngine.seekMusic(target + gameState.timingOffset);
        gameState.intervalStartTime += delta;
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
        if (gameState.initialCountdownFrozen) {
            this._resumeInitialCountdown();
        } else if (gameState.paused) {
            this._beginResumeCountdown();
        } else if (gameState.currentTime() >= 0) {
            this._pauseGame();
        }
    }

    _pauseGame() {
        // 恢复倒计时里再次暂停时，currentTime() 仍是原先的快照。
        gameState.pauseSnapshotTime = gameState.currentTime();
        gameState.paused = true;
        gameState.resumeCountdownUntil = 0;
        this._resumeTask = null;
        this._releaseAllTouches();
        if (renderer) renderer.resetTouchPoints();
        audioEngine.pauseMusic();
        this._setPauseOverlayVisible(true);
    }

    _beginResumeCountdown(duration = CONFIG.countdownDuration) {
        gameState.resumeCountdownRemaining = null;
        gameState.resumeCountdownUntil = performance.now() + duration;
        gameState.paused = false;
        this._setPauseOverlayVisible(false);
    }

    /** 倒计时到点后，保持画面和判定冻结，直到音频上下文实际恢复。 */
    _tickResumeCountdown(now) {
        const deadline = gameState.resumeCountdownUntil;
        if (!deadline || this._resumeTask || document.hidden || now < deadline) return;
        const task = audioEngine.resumeMusic();
        this._resumeTask = task;
        task.then(resumed => {
            if (this._resumeTask !== task || gameState.screen !== 'game') return;
            this._resumeTask = null;
            if (!resumed) {
                this._pauseGame();
                return;
            }
            this._releaseAllTouches();
            gameState.resumeCountdownUntil = 0;
        });
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
        const currentTime = gameState.currentTime();

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

            const offset = currentTime - noteTime;
            const isPerfect = Math.abs(offset) <= perfectWindow;
            const timingSide = gameState.recordHitTiming(offset, currentTime, isPerfect);

            // ===== Hold 长条头部 =====
            if (note.type === 'hold' && note.endTime) {
                note.hit = true;
                note.holdActive = true;
                note.startTime = currentTime;   // 记录命中时刻，用于按住进度渐变
                activeHolds[track] = note;
                note._headTimingSide = timingSide;
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
        if (this._lbOrigin === 'result' && this.resultScreen) {
            // 从结算页面进入：返回结算页面（保留成绩显示）
            gameState.screen = 'result';
            this.resultScreen.classList.remove('hidden');
            this.startScreen.classList.add('hidden');
            this._enterResult();
        } else {
            // 从开始画面进入：恢复开始状态（静态背景，绘制一帧即可）
            gameState.reset();
            if (renderer) renderer.resetPools();
            gameState.screen = 'start';
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

        // 曲库谱面按稳定 ID 分组；旧记录仅在曲名唯一时合并到对应曲库条目。
        const songsByTitle = new Map();
        for (const song of songLibrary) {
            songsByTitle.set(song.title, songsByTitle.has(song.title) ? null : song);
        }
        // 导入数据可能把分数存成字符串，统一转成有限数值再比较。
        const scoreOf = r => {
            const n = Number(r.score);
            return Number.isFinite(n) ? n : 0;
        };
        const best = new Map();
        const chartKey = r => {
            const song = songsByTitle.get(r.songName);
            if (r.chartId || song?.id) {
                const id = r.chartId || (this._isChartSong(song) ? song.id : `${song.id}:${r.difficulty}`);
                return JSON.stringify([r.playerName, 'library', id]);
            }
            return songsByTitle.has(r.songName) ? null : JSON.stringify([r.playerName, 'import', r.songName, r.difficulty]);
        };
        records.forEach(r => {
            if (r.isFailed || r.rank === 'F') return;
            const key = chartKey(r);
            if (!key) return;
            const score = scoreOf(r);
            const previous = best.get(key);
            if (!previous || score > scoreOf(previous) || (score === scoreOf(previous) && r.date < previous.date)) {
                best.set(key, r);
            }
        });

        this.lbList.innerHTML = records.map((r, i) => {
            const date = new Date(r.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
            const isBest = best.get(chartKey(r)) === r;
            const rank = this._recordRank(r.rank);
            const [p, g, m] = [r.perfect, r.great, r.miss].map(n => Math.max(0, Number(n) || 0));
            const total = p + g + m;
            return `
                <button type="button" class="lb-record record-ticket${isBest ? ' is-best' : ''}">
                    <span class="rank-stamp ${this._getRecordRankClass(rank)}" aria-hidden="true">${rank}</span>
                    <span class="sr-only">Rank ${rank}.</span>
                    <span class="record-identity">
                        <span class="record-index">${String(i + 1).padStart(2, '0')}${isBest ? ' / PERSONAL BEST' : ''}</span>
                        <span class="lb-record-name">${this.escapeHTML(r.songName)}</span>
                        <span class="lb-record-meta">${this.escapeHTML(r.difficulty)} · ${this.escapeHTML(r.playerName)}</span>
                    </span>
                    <span class="record-totals">
                        <span class="lb-record-score">${scoreOf(r).toLocaleString()}</span>
                        <span class="lb-record-acc">${(Number(r.accuracy) || 0).toFixed(2)}%</span>
                    </span>
                    <span class="record-receipt">
                        <span class="record-date">${this.escapeHTML(date)}</span>
                        <span class="record-judges" aria-hidden="true" style="--p:${total ? p / total : 0};--g:${total ? g / total : 0};--m:${total ? m / total : 0}">
                            <span></span><span></span><span></span>
                        </span>
                        <span class="record-counts">P ${p} · G ${g} · M ${m}${this._timingTicketCounts(r)}</span>
                    </span>
                </button>`;
        }).join('');

        this.lbList.querySelectorAll('.record-ticket').forEach((button, i) => {
            button.addEventListener('click', () => {
                const r = records[i];
                this._showRecordDetail(r.songName, r.id);
            });
        });
    }

    /** 记录小票上的早/晚摘要；旧记录未记录时保持空白，不伪造 0。 */
    _timingTicketCounts(record) {
        const e = this._timingCount(record.early);
        const l = this._timingCount(record.late);
        if (e === null || l === null) return '';
        return ` · <i class="tc-early">E ${e}</i> · <i class="tc-late">L ${l}</i>`;
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
            const rank = this._recordRank(record.rank);
            this.lbDetailStats.innerHTML = `
                <div class="stat-mini">
                    <span class="stat-mini-label">SCORE</span>
                    <span class="stat-mini-value">${(Number(record.score) || 0).toLocaleString()}</span>
                </div>
                <div class="stat-mini">
                    <span class="stat-mini-label">ACC</span>
                    <span class="stat-mini-value">${(Number(record.accuracy) || 0).toFixed(2)}%</span>
                </div>
                <div class="stat-mini">
                    <span class="stat-mini-label">MAX COMBO</span>
                    <span class="stat-mini-value">${Number(record.maxCombo) || 0}</span>
                </div>
                <div class="stat-mini">
                    <span class="stat-mini-label">RANK</span>
                    <span class="rank-stamp ${this._getRecordRankClass(rank)}">${rank}</span>
                </div>
                <div class="stat-mini">
                    <span class="stat-mini-label">PERFECT</span>
                    <span class="stat-mini-value" style="color:#f4cf7b">${Number(record.perfect) || 0}</span>
                </div>
                <div class="stat-mini">
                    <span class="stat-mini-label">GREAT</span>
                    <span class="stat-mini-value" style="color:#94cce1">${Number(record.great) || 0}</span>
                </div>
                <div class="stat-mini">
                    <span class="stat-mini-label">MISS</span>
                    <span class="stat-mini-value" style="color:#ed938e">${Number(record.miss) || 0}</span>
                </div>
                <div class="stat-mini">
                    <span class="stat-mini-label">SPEED</span>
                    <span class="stat-mini-value">${(Number(record.speed) || 16).toFixed(1)}x</span>
                </div>
                <div class="timing-split is-detail" role="group" aria-label="Early and late hit counts">
                    ${this._timingSplitHtml(record.early, record.late)}
                </div>
            `;
        }

        // 存储当前查看的记录信息
        this._detailSongName = songName;
        this._detailRecordId = recordId;
        // 同时存下 history 引用，便于在布局完成后绘制图表 / resize 重绘
        this._detailHistory = (record.performanceHistory && record.performanceHistory.length > 0)
            ? record.performanceHistory : null;
        this._pendingChartHistory = this._detailHistory;

        // 关键：先让详情面板可见，浏览器完成布局后再绘制折线图
        this.lbDetail.style.display = 'flex';

        // 延迟一帧等待布局计算完成，确保 canvas 父容器有正确的尺寸
        requestAnimationFrame(() => {
            renderer?.drawPerformanceChart(this.lbChartCanvas, this._pendingChartHistory || []);
            this._pendingChartHistory = null;
        });
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

    _recordRank(rank) {
        return typeof rank === 'string' && /^[φVSABCF]$/.test(rank) ? rank : 'C';
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

    /**
     * Hold 长条释放检查（keyup 时触发）
     * 宽松判定：记录松开时间，40ms 内补按则不算 miss
     */
    checkHoldRelease(track) {
        if (!renderer) return;
        if (gameState.paused) return;
        if (this._isResumeCounting()) return;   // 恢复倒计时期间不判定

        const currentTime = gameState.currentTime();
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
        const currentTime = gameState.currentTime();
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

                    if (typeof renderer.markHoldMiss === 'function') renderer.markHoldMiss(holdNote, currentTime);

                    // 如果头部已被判定为 perfect/great，修正为 miss
                    if (holdNote._headWasPerfect === true) {
                        gameState.perfect--;
                        gameState.intervalStats.perfect = Math.max(0, gameState.intervalStats.perfect - 1);
                    } else if (holdNote._headWasPerfect === false) {
                        gameState.great--;
                        if (holdNote._headTimingSide) gameState[holdNote._headTimingSide]--;
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
                if (typeof audioEngine.playHoldEnd === 'function') audioEngine.playHoldEnd();
            }
        }
    }
}