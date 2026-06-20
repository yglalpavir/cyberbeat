// ==================== 主入口 ====================

let renderer;
let ui;

async function init() {
    // 先加载音频配置
    await loadAudioConfig();
    
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    renderer = new Renderer(canvas, ctx);
    ui = new UIManager();
    
    window.addEventListener('resize', () => {
        if (renderer) renderer.resize();
    });
    
    requestAnimationFrame(renderStartScreen);
}

function renderStartScreen(timestamp) {
    if (gameState.screen !== 'start') return;
    const ctx = renderer.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, renderer.canvasWidth, renderer.canvasHeight);
    renderer.drawBackground(timestamp || performance.now());
    requestAnimationFrame(renderStartScreen);
}

// 全局游戏循环
function gameLoop(timestamp) {
    if (gameState.screen !== 'game') return;
    
    const now = performance.now();
    const elapsed = now - gameState.startTime;
    const countdownRemaining = (gameState.startTime - now) / 1000; // 倒计时剩余秒数
    
    // 倒计时期间仍绘制界面
    if (countdownRemaining > 0) {
        const ctx = renderer.ctx;
        ctx.clearRect(0, 0, renderer.canvasWidth, renderer.canvasHeight);
        renderer.drawBackground(elapsed > 0 ? elapsed : 0);
        renderer.drawTracks();
        renderer.drawCountdown(countdownRemaining);
        renderer.drawHUD(); // 可选显示空白 HUD
        requestAnimationFrame(gameLoop);
        return;
    }
    
    const currentTime = elapsed;
    if (currentTime - (gameState.intervalStartTime - gameState.startTime) >= CONFIG.statsInterval) {
        gameState.recordIntervalStats();
        gameState.intervalStartTime = now;
    }
    
    const duration = loadedMcData
        ? loadedMcData.meta.duration * 1000
        : (loadedMidiData ? loadedMidiData.duration * 1000 : CONFIG.songDuration);
    if (currentTime > duration + 2000 || gameState.health <= 0) {
        if (ui) ui.endGame();
        return;
    }
    
    const ctx = renderer.ctx;
    ctx.clearRect(0, 0, renderer.canvasWidth, renderer.canvasHeight);
    renderer.drawBackground(currentTime);
    renderer.drawTracks();
    renderer.drawLasers();
    renderer.drawNotes(currentTime);
    renderer.drawParticles();
    renderer.drawJudgments();
    renderer.drawHUD();

    // Hold 长条状态更新（每帧检查）
    ui.updateHolds();

    requestAnimationFrame(gameLoop);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}