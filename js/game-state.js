// Game State Management
class GameState {
    constructor() {
        this.reset();
    }
    
    reset() {
        this.screen = 'start';
        this.score = 0;
        this.combo = 0;
        this.maxCombo = 0;
        this.perfect = 0;
        this.great = 0;
        this.miss = 0;
        this.health = 100;
        this.startTime = 0;
        this.notes = [];
        this.particles = [];
        this.lasers = [];
        this.judgments = [];
        this.pressedKeys = new Set();
        this.isPlaying = false;
        this.beatIndex = 0;
        this.performanceHistory = [];
        this.totalNotesProcessed = 0;
        this.intervalStartTime = 0;
        this.intervalStats = { perfect: 0, great: 0, miss: 0 };
        this.lastSpacePressTime = 0;
    }
    
    initForGame(notes) {
        this.screen = 'game';
        this.startTime = performance.now();
        this.notes = notes;
        this.isPlaying = true;
        this.intervalStartTime = performance.now();
    }
    
    calculateTotalAcc() {
        const { perfect, great, miss } = this;
        const total = perfect + great + miss;
        if (total === 0) return 100.00;
        return ((perfect * 100 + great * 50) / total);
    }
    
    recordIntervalStats() {
        const { perfect, great, miss } = this.intervalStats;
        const total = perfect + great + miss;
        let intervalAcc = 0;
        if (total > 0) {
            intervalAcc = (perfect * 100 + great * 50) / total;
        }
        
        this.performanceHistory.push({
            time: performance.now() - this.startTime,
            intervalAcc: intervalAcc,
            totalAcc: this.calculateTotalAcc()
        });
        
        this.intervalStats = { perfect: 0, great: 0, miss: 0 };
    }
}

const gameState = new GameState();