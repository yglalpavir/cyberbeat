// Main Entry Point
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Initialize renderer
const renderer = new Renderer(canvas, ctx);

// Initialize UI
const ui = new UIManager();

// Handle window resize
window.addEventListener('resize', () => renderer.resize());

// Game Loop
function gameLoop(timestamp) {
    if (gameState.screen !== 'game') return;
    
    const currentTime = performance.now() - gameState.startTime;
    
    // Record interval stats
    if (currentTime - (gameState.intervalStartTime - gameState.startTime) >= CONFIG.statsInterval) {
        gameState.recordIntervalStats();
        gameState.intervalStartTime = performance.now();
    }
    
    // Check if game should end
    const duration = gameMode === 'preset' ? CONFIG.songDuration : loadedMidiData.duration * 1000;
    if (currentTime > duration + 2000 || gameState.health <= 0) {
        ui.endGame();
        return;
    }
    
    // Render
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

// Start screen animation
function renderStartScreen() {
    if (gameState.screen !== 'start') return;
    
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, renderer.canvasWidth, renderer.canvasHeight);
    renderer.drawBackground(performance.now());
    
    requestAnimationFrame(renderStartScreen);
}

// Initial render
requestAnimationFrame(renderStartScreen);