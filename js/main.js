// ==================== 主入口 (性能优化版) ====================

let renderer;
let ui;
let _lastFrameTime = 0;

async function init() {
    // 加载配置
    await loadAudioConfig();
    await loadJudgeConfig();

    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    renderer = new Renderer(canvas, ctx);
    ui = new UIManager();

    // 防止 canvas 被浏览器默认手势干扰
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('resize', () => {
        if (renderer) renderer.resize();
    });

    // 性能监控快捷切换: 按 ~ 键
    document.addEventListener('keydown', (e) => {
        if (e.key === '`' || e.key === '~') {
            e.preventDefault();
            perfMonitor.toggle();
        }
    });

    _lastFrameTime = performance.now();
    requestAnimationFrame(renderStartScreen);
}

function renderStartScreen(ts) {
    if (gameState.screen !== 'start') return;
    perfMonitor.beginFrame();
    const ctx = renderer.ctx;
    ctx.clearRect(0, 0, renderer.canvasWidth, renderer.canvasHeight);
    renderer.drawBackground(ts);
    perfMonitor.endFrame();
    requestAnimationFrame(renderStartScreen);
}

// 全局游戏循环 - 垂直同步平滑帧
function gameLoop(timestamp) {
    if (gameState.screen !== 'game') return;

    perfMonitor.beginFrame();

    // === 帧时序平滑 (VSync) ===
    // 限制最大帧间隔为 50ms (20fps 下限)，防止大跳帧导致的间断感
    let rawDelta = timestamp - _lastFrameTime;
    if (rawDelta <= 0) rawDelta = 16.67;
    const frameDelta = Math.min(rawDelta, 50);
    _lastFrameTime = timestamp;

    const now = performance.now();

    // 暂停：冻结场景时间，仅绘制遮罩（不推进、不判定）
    if (gameState.paused) {
        const ctx = renderer.ctx;
        ctx.clearRect(0, 0, renderer.canvasWidth, renderer.canvasHeight);
        renderer.drawBackground(0);
        renderer.drawTracks();
        renderer.drawNotes(gameState.pauseSnapshotTime);
        renderer.drawParticles();
        renderer.drawJudgments();
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
    renderer.drawHUD();

    // Hold 长条状态更新
    ui.updateHolds();

    perfMonitor.endFrame();
    requestAnimationFrame(gameLoop);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}