// Game State Management
class GameState {
    constructor() {
        this.reset();
    }
    
    reset() {
        this.screen = 'start';
        this.score = 0;
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
        // Hold 长条跟踪：每个轨道当前按住的 hold note
        this.activeHolds = [null, null, null, null];
        // Hold 松开时间跟踪（用于 40ms 宽松判定）
        this.holdReleaseTimes = [0, 0, 0, 0];
        // 暂停状态
        this.paused = false;
        this.pauseStartedAt = 0;       // 暂停时的 performance.now()
        this.pauseSnapshotTime = 0;    // 暂停时的场景时间（ms）
    }

    /**
     * 获取当前场景时间（ms）：游戏开始后经过的时间（含全局 offset 校准）
     */
    currentTime() {
        return performance.now() - this.startTime;
    }
    
    calculateTotalAcc() {
        const { perfect, great, miss } = this;
        const total = perfect + great + miss;
        if (total === 0) return 100.00;
        return ((perfect * 100 + great * 65) / total);
    }

    /**
     * 实时判定分（基于 perfect/great 计数实时计算，消除浮点累加误差）
     * 满分 900,000 = 判定分上限
     * 公式：900,000 × (perfect + 0.65 × great) / totalNotes
     */
    get judgmentScore() {
        if (this.totalNotes <= 0) return 0;
        return Math.round(
            CONFIG.judgmentScoreMax * (this.perfect + 0.65 * this.great) / this.totalNotes
        );
    }

    /**
     * 计算最终总分 = 判定分 + 连击分
     * 判定分：各 Note 判定累计（Perfect=100%, Great=65%）
     * 连击分：floor(maxCombo / totalNotes × 100,000)
     * @returns {{ finalScore: number, judgmentScore: number, comboScore: number }}
     */
    calculateFinalScore() {
        const judgmentScore = this.judgmentScore;
        const comboScore = this.totalNotes > 0
            ? Math.floor((this.maxCombo / this.totalNotes) * CONFIG.comboScoreMax)
            : 0;
        const finalScore = Math.min(judgmentScore + comboScore, CONFIG.maxScore);
        return {
            finalScore: Math.round(finalScore),
            judgmentScore: judgmentScore,
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