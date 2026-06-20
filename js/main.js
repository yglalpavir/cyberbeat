// ==================== 主入口 ====================

// 全局实例（供 ui.js 和其他模块访问）
let renderer;
let ui;

function init() {
    // 获取 Canvas
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    
    // 初始化渲染器（全局）
    renderer = new Renderer(canvas, ctx);
    
    // 初始化 UI（全局）
    ui = new UIManager();
    
    // 监听窗口大小变化
    window.addEventListener('resize', () => {
        if (renderer) renderer.resize();
    });
    
    // 启动开始画面渲染循环
    requestAnimationFrame(renderStartScreen);
}

// ==================== 开始画面渲染循环 ====================

function renderStartScreen(timestamp) {
    if (gameState.screen !== 'start') return;
    
    const ctx = renderer.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, renderer.canvasWidth, renderer.canvasHeight);
    renderer.drawBackground(timestamp || performance.now());
    
    requestAnimationFrame(renderStartScreen);
}

// ==================== 游戏主循环 ====================

// 注意：此函数必须声明在全局作用域，因为 ui.js 通过 requestAnimationFrame(gameLoop) 调用
function gameLoop(timestamp) {
    if (gameState.screen !== 'game') {
        // 游戏结束，停止循环
        return;
    }
    
    const currentTime = performance.now() - gameState.startTime;
    
    // 定期记录统计数据
    if (currentTime - (gameState.intervalStartTime - gameState.startTime) >= CONFIG.statsInterval) {
        gameState.recordIntervalStats();
        gameState.intervalStartTime = performance.now();
    }
    
    // 检查游戏是否结束
    const duration = loadedMidiData ? loadedMidiData.duration * 1000 : CONFIG.songDuration;
    if (currentTime > duration + 2000 || gameState.health <= 0) {
        if (ui) ui.endGame();
        return;
    }
    
    // 渲染
    const ctx = renderer.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, renderer.canvasWidth, renderer.canvasHeight);
    
    renderer.drawBackground(currentTime);
    renderer.drawTracks();
    renderer.drawLasers();
    renderer.drawNotes(currentTime);
    renderer.drawParticles();
    renderer.drawJudgments();
    renderer.drawHUD();
    
    requestAnimationFrame(gameLoop);
}

// ==================== 启动 ====================

// DOM 加载完成后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}