// ==================== 本地排行榜系统 ====================
// 使用 localStorage 持久化存储游玩记录

const LEADERBOARD_KEY = 'cyberbeat_leaderboard';
const PLAYER_NAME_KEY = 'cyberbeat_playerName';

class LeaderboardManager {
    constructor() {
        this._cache = null;
        this._playerName = null;
    }

    // ========== 玩家名称 ==========
    /** 获取玩家名称（默认 "Local"） */
    getPlayerName() {
        if (this._playerName !== null) return this._playerName;
        try {
            const stored = localStorage.getItem(PLAYER_NAME_KEY);
            this._playerName = stored || 'Local';
        } catch {
            this._playerName = 'Local';
        }
        return this._playerName;
    }

    /** 设置玩家名称（预留接口） */
    setPlayerName(name) {
        const trimmed = (name || '').trim();
        if (!trimmed) return false;
        this._playerName = trimmed;
        try {
            localStorage.setItem(PLAYER_NAME_KEY, trimmed);
        } catch { /* ignore */ }
        return true;
    }

    // ========== 数据加载/保存 ==========
    /** 加载全部排行榜数据 */
    _loadAll() {
        if (this._cache !== null) return this._cache;
        try {
            const raw = localStorage.getItem(LEADERBOARD_KEY);
            this._cache = raw ? JSON.parse(raw) : {};
        } catch {
            this._cache = {};
        }
        return this._cache;
    }

    /** 保存全部排行榜数据 */
    _saveAll() {
        try {
            localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(this._cache));
        } catch (e) {
            console.warn('Leaderboard: Failed to save to localStorage:', e);
        }
    }

    /** 生成歌曲唯一标识 */
    _getSongId(songDisplayName) {
        // 使用歌曲显示名称作为 key
        return (songDisplayName || 'Unknown').trim();
    }

    // ========== 记录管理 ==========
    /**
     * 添加一条游玩记录
     * @param {Object} record - 游玩数据
     * @returns {Object} 添加的记录（含 id）
     */
    addRecord(record) {
        const all = this._loadAll();
        const songId = this._getSongId(record.songName);

        if (!all[songId]) {
            all[songId] = [];
        }

        const entry = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            playerName: record.playerName || this.getPlayerName(),
            songName: record.songName || 'Unknown',
            date: record.date || new Date().toISOString(),
            score: record.score || 0,
            accuracy: record.accuracy || 0,
            maxCombo: record.maxCombo || 0,
            perfect: record.perfect || 0,
            great: record.great || 0,
            miss: record.miss || 0,
            rank: record.rank || 'C',
            difficulty: record.difficulty || 'normal+',
            speed: record.speed || 16.0,
            style: record.style || 'orb',
            isFailed: record.isFailed || false,
            performanceHistory: record.performanceHistory || []
        };

        all[songId].push(entry);
        this._cache = all;
        this._saveAll();

        return entry;
    }

    /**
     * 获取指定歌曲的排行榜记录
     * @param {string} songName - 歌曲名称
     * @param {string} sortBy - 排序字段: 'date' | 'score' | 'accuracy'
     * @returns {Array}
     */
    getRecords(songName, sortBy = 'date') {
        const all = this._loadAll();
        const songId = this._getSongId(songName);
        const records = all[songId] || [];

        // 返回副本，按指定字段排序
        const sorted = [...records];
        switch (sortBy) {
            case 'score':
                sorted.sort((a, b) => b.score - a.score);
                break;
            case 'accuracy':
                sorted.sort((a, b) => b.accuracy - a.accuracy);
                break;
            case 'date':
            default:
                sorted.sort((a, b) => new Date(b.date) - new Date(a.date));
                break;
        }
        return sorted;
    }

    /**
     * 获取所有有记录的歌曲列表
     * @returns {Array<{songName, recordCount, bestScore, bestAccuracy}>}
     */
    getAllSongSummaries() {
        const all = this._loadAll();
        const summaries = [];

        for (const [songId, records] of Object.entries(all)) {
            if (!records || records.length === 0) continue;
            let bestScore = 0;
            let bestAccuracy = 0;
            for (const r of records) {
                if (r.score > bestScore) bestScore = r.score;
                if (r.accuracy > bestAccuracy) bestAccuracy = r.accuracy;
            }
            summaries.push({
                songName: songId,
                recordCount: records.length,
                bestScore,
                bestAccuracy,
                lastPlayed: records.reduce((latest, r) => {
                    const d = new Date(r.date);
                    return d > latest ? d : latest;
                }, new Date(0)).toISOString()
            });
        }

        // 按最近游玩时间排序
        summaries.sort((a, b) => new Date(b.lastPlayed) - new Date(a.lastPlayed));
        return summaries;
    }

    /**
     * 删除某条记录
     * @param {string} songName
     * @param {string} recordId
     */
    deleteRecord(songName, recordId) {
        const all = this._loadAll();
        const songId = this._getSongId(songName);
        if (!all[songId]) return false;

        const idx = all[songId].findIndex(r => r.id === recordId);
        if (idx === -1) return false;

        all[songId].splice(idx, 1);
        if (all[songId].length === 0) {
            delete all[songId];
        }
        this._cache = all;
        this._saveAll();
        return true;
    }

    /**
     * 清除某首歌曲的全部记录
     */
    clearSongRecords(songName) {
        const all = this._loadAll();
        const songId = this._getSongId(songName);
        delete all[songId];
        this._cache = all;
        this._saveAll();
    }

    /**
     * 清除全部排行榜数据
     */
    clearAll() {
        this._cache = {};
        this._saveAll();
    }

    // ========== 导入/导出 ==========
    /**
     * 导出全部排行榜数据为 JSON 字符串
     */
    exportAll() {
        const all = this._loadAll();
        return JSON.stringify({
            version: 1,
            exportedAt: new Date().toISOString(),
            playerName: this.getPlayerName(),
            records: all
        }, null, 2);
    }

    /**
     * 导出指定歌曲的记录为 JSON 字符串
     */
    exportSong(songName) {
        const all = this._loadAll();
        const songId = this._getSongId(songName);
        return JSON.stringify({
            version: 1,
            exportedAt: new Date().toISOString(),
            playerName: this.getPlayerName(),
            songName: songId,
            records: all[songId] || []
        }, null, 2);
    }

    /**
     * 导入排行榜数据
     * @param {string} jsonStr - JSON 字符串
     * @param {string} mode - 'merge' 合并 | 'replace' 替换
     * @returns {{ success: boolean, importedCount: number, message: string }}
     */
    importData(jsonStr, mode = 'merge') {
        try {
            const data = JSON.parse(jsonStr);

            // 验证格式
            if (!data || typeof data !== 'object') {
                return { success: false, importedCount: 0, message: 'Invalid JSON format.' };
            }

            let records = null;

            // 格式1: 含 records 字段的完整导出
            if (data.records && typeof data.records === 'object') {
                records = data.records;
            }
            // 格式2: 直接是歌曲->记录映射
            else if (Object.values(data).some(v => Array.isArray(v))) {
                records = data;
            }
            else {
                return { success: false, importedCount: 0, message: 'Unrecognized leaderboard data format.' };
            }

            // 导入玩家名称（如果存在）
            if (data.playerName && data.playerName !== 'Local') {
                // 不自动覆盖，但可供用户选择
            }

            let importedCount = 0;
            const all = mode === 'replace' ? {} : this._loadAll();

            for (const [songId, entries] of Object.entries(records)) {
                if (!Array.isArray(entries)) continue;

                if (mode === 'replace' || !all[songId]) {
                    all[songId] = [];
                }

                for (const entry of entries) {
                    // 确保必要字段存在
                    if (!entry.score && entry.score !== 0) continue;

                    const normalized = {
                        id: entry.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
                        playerName: entry.playerName || 'Local',
                        songName: entry.songName || songId,
                        date: entry.date || new Date().toISOString(),
                        score: entry.score || 0,
                        accuracy: entry.accuracy || 0,
                        maxCombo: entry.maxCombo || 0,
                        perfect: entry.perfect || 0,
                        great: entry.great || 0,
                        miss: entry.miss || 0,
                        rank: entry.rank || 'C',
                        difficulty: entry.difficulty || 'normal+',
                        speed: entry.speed || 16.0,
                        style: entry.style || 'orb',
                        isFailed: entry.isFailed || false,
                        performanceHistory: entry.performanceHistory || []
                    };

                    // 去重：检查是否已有相同 id 的记录
                    const exists = all[songId].some(r => r.id === normalized.id);
                    if (!exists) {
                        all[songId].push(normalized);
                        importedCount++;
                    }
                }
            }

            this._cache = all;
            this._saveAll();

            return {
                success: true,
                importedCount,
                message: `Successfully imported ${importedCount} record(s).`
            };
        } catch (e) {
            return { success: false, importedCount: 0, message: `Parse error: ${e.message}` };
        }
    }

    /**
     * 触发文件下载
     */
    downloadFile(content, filename) {
        const blob = new Blob([content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

// 全局单例
const leaderboard = new LeaderboardManager();
