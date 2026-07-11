// Game State Management
class GameState {
    constructor() {
        this.reset();
    }
    
    reset() {
        this.screen = 'start';
        this.score = 0;
        this.judgmentScore = 0;       // 判定分累计（900,000 上限）
        this.totalNotes = 0;          // 谱面总物量
        this.combo = 0;
        this.maxCombo = 0;
        this.perfect = 0;
        this.great = 0;
        this.miss = 0;
        this.health = CONFIG.health.initial;
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
        // Hold 长条跟踪：每个轨道当前按住的 hold note
        this.activeHolds = [null, null, null, null];
        // Hold 松开时间跟踪（用于 40ms 宽松判定）
        this.holdReleaseTimes = [0, 0, 0, 0];
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
        return ((perfect * 100 + great * 65) / total);
    }

    /**
     * 计算每个 Note 的最大判定分
     * 判定分满分 900,000 / 总物量
     */
    getPerNoteMaxScore() {
        if (this.totalNotes <= 0) return 0;
        return CONFIG.judgmentScoreMax / this.totalNotes;
    }

    /**
     * 计算最终总分 = 判定分 + 连击分
     * 判定分：各 Note 判定累计（Perfect=100%, Good=65%）
     * 连击分：floor(maxCombo / totalNotes * 100,000)
     * @returns {{ finalScore: number, judgmentScore: number, comboScore: number }}
     */
    calculateFinalScore() {
        const comboScore = this.totalNotes > 0
            ? Math.floor((this.maxCombo / this.totalNotes) * CONFIG.comboScoreMax)
            : 0;
        const finalScore = Math.min(this.judgmentScore + comboScore, CONFIG.maxScore);
        return {
            finalScore: Math.round(finalScore),
            judgmentScore: Math.round(this.judgmentScore),
            comboScore: comboScore
        };
    }

    /**
     * 根据最终分数计算等级
     * φ: 1,000,000 | V: 960,000+ | S: 920,000+ | A: 880,000+ | B: 820,000+ | C: 700,000+
     * @param {number} finalScore
     * @param {boolean} isFailed - 血量归零
     * @returns {{ rank: string, rankLabel: string }}
     */
    calculateRank(finalScore, isFailed) {
        if (isFailed) return { rank: 'F', rankLabel: 'FAILED' };
        if (finalScore >= 1000000) return { rank: 'φ', rankLabel: 'PHI' };
        if (finalScore >= 960000)  return { rank: 'V', rankLabel: 'WHITE V' };
        if (finalScore >= 920000)  return { rank: 'S', rankLabel: 'PERFECT' };
        if (finalScore >= 880000)  return { rank: 'A', rankLabel: 'EXCELLENT' };
        if (finalScore >= 820000)  return { rank: 'B', rankLabel: 'GOOD' };
        if (finalScore >= 700000)  return { rank: 'C', rankLabel: 'PASS' };
        return { rank: 'F', rankLabel: 'FAILED' };
    }
    
    recordIntervalStats() {
        const { perfect, great, miss } = this.intervalStats;
        const total = perfect + great + miss;
        let intervalAcc = 0;
        if (total > 0) {
            intervalAcc = (perfect * 100 + great * 65) / total;
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