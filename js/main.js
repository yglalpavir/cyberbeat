// ==================== 主入口 (性能优化版) ====================

let renderer;
let ui;
let _lastFrameTime = 0;

// ========== 启动加载遮罩 ==========
const _boot = {
    el: null,
    fill: null,
    text: null,
    startedAt: 0,

    init() {
        this.el = document.getElementById('bootOverlay');
        this.fill = document.getElementById('bootFill');
        this.text = document.getElementById('bootText');
        this.startedAt = performance.now();
    },

    /** 更新启动进度：text 文案，pct 0~1 */
    step(text, pct) {
        if (this.text && text) this.text.textContent = text;
        if (this.fill && typeof pct === 'number') {
            this.fill.style.width = Math.max(0, Math.min(1, pct)) * 100 + '%';
        }
    },

    /** 完成并淡出（至少展示 350ms，避免闪一下） */
    done() {
        if (!this.el) return;
        const wait = Math.max(0, 350 - (performance.now() - this.startedAt));
        setTimeout(() => {
            this.step('准备就绪', 1);
            this.el.classList.add('hidden');
        }, wait);
    },

    fail(message) {
        this.step(message || '加载失败，请刷新重试', 1);
        if (this.el) this.el.classList.add('boot-error');
    }
};

async function init() {
    _boot.init();
    _boot.step('正在加载…', 0.05);

    // 加载配置
    _boot.step('读取音频配置…', 0.2);
    await loadAudioConfig();
    _boot.step('读取判定配置…', 0.4);
    await loadJudgeConfig();

    // 皮肤：按存档设置预加载（失败自动回退内置扁平皮肤）
    _boot.step('载入皮肤…', 0.6);
    const skin = await initSkinFromSettings();

    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    renderer = new Renderer(canvas, ctx);
    if (skin) renderer.setSkin(skin);
    _boot.step('载入曲库…', 0.8);
    ui = new UIManager();

    // 等曲库首次加载完成（最多 6 秒，超时也放行，列表内还有重试入口）
    if (ui._libraryPromise) {
        await Promise.race([
            ui._libraryPromise,
            new Promise((resolve) => setTimeout(resolve, 6000))
        ]);
    }
    _boot.done();

    // 防止 canvas 被浏览器默认手势干扰
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('resize', () => {
        if (renderer) renderer.resize();
        repaintStartScreen();
    });

    // 移动端地址栏收起/展开会导致 innerHeight 变化，visualViewport 更可靠
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => {
            if (renderer) renderer.resize();
            repaintStartScreen();
        });
    }

    // 屏幕旋转后重算布局与安全区
    window.addEventListener('orientationchange', () => {
        // Safari 在 orientationchange 时 innerHeight 尚未更新，延迟两帧重算
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (renderer) renderer.resize();
            repaintStartScreen();
            showRotateToast();
        }));
    });

    // 移动端旋转提示：游戏进行中横竖屏切换时短暂显示 toast
    let _rotateToastTimer = null;
    let _lastOrientation = null;
    function showRotateToast() {
        if (!IS_TOUCH_DEVICE) return;
        const orientation = window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
        if (_lastOrientation !== null && _lastOrientation !== orientation) {
            const toast = document.getElementById('rotateToast');
            if (toast) {
                toast.classList.remove('hidden');
                requestAnimationFrame(() => toast.classList.add('visible'));
                clearTimeout(_rotateToastTimer);
                _rotateToastTimer = setTimeout(() => {
                    toast.classList.remove('visible');
                    _rotateToastTimer = setTimeout(() => toast.classList.add('hidden'), 350);
                }, 1800);
            }
        }
        _lastOrientation = orientation;
    }

    // 性能监控快捷切换: 按 ~ 键（触屏设备无键盘，连点暂停按钮 5 次切换）
    document.addEventListener('keydown', (e) => {
        if (e.key === '`' || e.key === '~') {
            e.preventDefault();
            perfMonitor.toggle();
        }
    });

    // 开始画面只有静态渐变背景：绘制一帧即停止 rAF 空转（移动端省电关键）
    _lastFrameTime = performance.now();
    requestAnimationFrame(renderStartScreen);
}

function renderStartScreen(ts) {
    if (gameState.screen !== 'start') return;

    // 开始画面只有静态渐变背景，无需持续重绘：
    // 绘制一帧后停止 rAF 循环，切回开始画面/resize 时再触发一次
    perfMonitor.beginFrame();
    const ctx = renderer.ctx;
    ctx.clearRect(0, 0, renderer.canvasWidth, renderer.canvasHeight);
    renderer.drawBackground(ts);
    perfMonitor.endFrame();
}

/** 重新绘制一帧开始画面（screen 切回 start / resize 后调用） */
function repaintStartScreen() {
    if (gameState.screen !== 'start') return;
    _lastFrameTime = performance.now();
    renderStartScreen(performance.now());
}

// 全局游戏循环 - 垂直同步平滑帧
function gameLoop(timestamp) {
    if (gameState.screen !== 'game') return;

    const now = performance.now();

    perfMonitor.beginFrame();

    // 每帧同步游戏内 DOM 控件（暂停按钮 / 跳过前奏按钮）
    if (ui) ui.updateInGameUI();

    // 暂停恢复倒计时：画面冻结在暂停瞬间，只画 3-2-1
    if (gameState.resumeCountdownUntil > 0 && !gameState.paused) {
        const ctx = renderer.ctx;
        ctx.clearRect(0, 0, renderer.canvasWidth, renderer.canvasHeight);
        renderer.drawBackground(0);
        renderer.drawTracks();
        renderer.drawNotes(gameState.pauseSnapshotTime);
        renderer.drawParticles();
        renderer.drawJudgments();
        renderer.drawHUD();
        renderer.drawCountdown((gameState.resumeCountdownUntil - now) / 1000, true);
        perfMonitor.endFrame();

        // 倒计时结束 → 平移时间轴恢复音乐
        if (ui && ui._tickResumeCountdown()) {
            _lastFrameTime = timestamp;
        }
        requestAnimationFrame(gameLoop);
        return;
    }

    // === 帧时序平滑 (VSync) ===
    // 限制最大帧间隔为 50ms (20fps 下限)，防止大跳帧导致的间断感
    let rawDelta = timestamp - _lastFrameTime;
    if (rawDelta <= 0) rawDelta = 16.67;
    const frameDelta = Math.min(rawDelta, 50);
    _lastFrameTime = timestamp;

    // 暂停：冻结场景时间，仅绘制遮罩（不推进、不判定）
    if (gameState.paused) {
        const ctx = renderer.ctx;
        ctx.clearRect(0, 0, renderer.canvasWidth, renderer.canvasHeight);
        renderer.drawBackground(0);
        renderer.drawTracks();
        renderer.drawNotes(gameState.pauseSnapshotTime);
        renderer.drawParticles();
        renderer.drawJudgments();
        renderer.drawTouchPoints();
        renderer.drawHUD();
        renderer.drawPauseOverlay();
        perfMonitor.endFrame();
        requestAnimationFrame(gameLoop);
        return;
    }

    const countdownRemaining = (gameState.startTime - now) / 1000;

    // 倒计时期间
    if (countdownRemaining > 0) {
        const ctx = renderer.ctx;
        ctx.clearRect(0, 0, renderer.canvasWidth, renderer.canvasHeight);
        renderer.drawBackground(0);
        renderer.drawTracks();
        renderer.drawCountdown(countdownRemaining);
        renderer.drawHUD();
        perfMonitor.endFrame();
        requestAnimationFrame(gameLoop);
        return;
    }

    const currentTime = now - gameState.startTime;

    // 统计间隔记录
    if (currentTime - (gameState.intervalStartTime - gameState.startTime) >= CONFIG.statsInterval) {
        gameState.recordIntervalStats();
        gameState.intervalStartTime = now;
    }

    // 游戏结束判断（音频可能比谱面更长，取较大值避免提前结束）
    const chartData = getLoadedChartData();
    const chartDuration = chartData
        ? chartData.meta.duration * 1000
        : (loadedMidiData ? loadedMidiData.duration * 1000 : CONFIG.songDuration);
    const audioDuration = audioEngine.audioBuffer ? audioEngine.audioBuffer.duration * 1000 : 0;
    const duration = Math.max(chartDuration, audioDuration);
    if (currentTime > duration + 2000 || gameState.health <= 0) {
        if (ui) ui.endGame();
        perfMonitor.endFrame();
        return;
    }

    // Frame delta for time-based effects
    if (renderer) renderer.setFrameDelta(frameDelta);

    // === 主渲染 ===
    const ctx = renderer.ctx;
    ctx.clearRect(0, 0, renderer.canvasWidth, renderer.canvasHeight);
    renderer.drawBackground(currentTime);
    renderer.drawTracks();
    renderer.drawLasers();
    renderer.drawNotes(currentTime);
    renderer.drawParticles();
    renderer.drawJudgments();
    renderer.drawTouchPoints();
    renderer.drawHUD();
    renderer.drawSkipIntroHint();

    // Hold 长条状态更新
    ui.updateHolds();

    perfMonitor.endFrame();
    requestAnimationFrame(gameLoop);
}

function onInitError(err) {
    console.error('Init failed:', err);
    _boot.fail('启动失败：' + ((err && err.message) || '未知错误'));
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init().catch(onInitError));
} else {
    init().catch(onInitError);
}