// ==================== 全局设置持久化 ====================
// 使用 localStorage 记住玩家的全局设置，减少每次调整时间

const SETTINGS_KEY = 'cyberbeat_settings';

const DEFAULT_SETTINGS = {
    noteSpeed: 16.0,
    volume: 4,
    noteStyle: 'orb',
    difficulty: 'normal+'
};

class SettingsStore {
    constructor() {
        this._settings = null;
    }

    /** 加载设置（如果不存在则返回默认值） */
    load() {
        if (this._settings !== null) return this._settings;
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                // 合并默认值以处理新增字段
                this._settings = { ...DEFAULT_SETTINGS, ...parsed };
            } else {
                this._settings = { ...DEFAULT_SETTINGS };
            }
        } catch {
            this._settings = { ...DEFAULT_SETTINGS };
        }
        return this._settings;
    }

    /** 保存设置 */
    save(settings) {
        this._settings = { ...this._settings, ...settings };
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(this._settings));
        } catch (e) {
            console.warn('SettingsStore: Failed to save:', e);
        }
    }

    /** 获取单个设置项 */
    get(key) {
        return this.load()[key];
    }

    /** 设置单个设置项并保存 */
    set(key, value) {
        this.save({ [key]: value });
    }

    /** 重置为默认值 */
    reset() {
        this._settings = { ...DEFAULT_SETTINGS };
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(this._settings));
        } catch { /* ignore */ }
        return this._settings;
    }

    /**
     * 应用设置到全局变量
     * 在页面加载时调用，将持久化设置恢复到运行时变量
     */
    applyToRuntime() {
        const s = this.load();

        if (s.noteSpeed !== undefined) {
            noteSpeed = s.noteSpeed;
        }
        if (s.volume !== undefined) {
            currentVolume = s.volume;
        }
        if (s.noteStyle !== undefined) {
            noteStyle = s.noteStyle;
        }
        if (s.difficulty !== undefined) {
            selectedDifficulty = s.difficulty;
        }
    }

    /**
     * 从运行时变量同步到持久化存储
     * 在设置变更时调用
     */
    syncFromRuntime() {
        this.save({
            noteSpeed: noteSpeed,
            volume: currentVolume,
            noteStyle: noteStyle,
            difficulty: selectedDifficulty
        });
    }
}

// 全局单例
const settingsStore = new SettingsStore();
