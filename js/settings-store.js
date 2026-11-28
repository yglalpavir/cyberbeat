// ==================== 全局设置持久化 ====================
// 使用 localStorage 记住玩家的全局设置，减少每次调整时间

const SETTINGS_KEY = 'cyberbeat_settings';

const DEFAULT_SETTINGS = {
    noteSpeed: 16.0,
    volume: 4,
    hitSoundVolume: 100,    // 打击音效音量百分比（0-300）
    noteStyle: 'bar',
    skin: 'builtin',        // 'builtin' | 'malody'
    difficulty: 'normal+',
    audioOffset: 0,
    touchFeedback: true,
    songSort: 'default',
    songOrder: 'asc'
};

class SettingsStore {
    constructor() {
        this._settings = null;
        // 触屏设备默认音频偏移建议值（ms）：
        // 移动端触控 + 蓝牙耳机/扬声器普遍存在 40~80ms 音频延迟，
        // 正偏移使音符更晚到达判定线，抵消延迟带来的"提前按"惯性。
        // 玩家仍可在设置页 ±100ms 内自由微调。
        this._touchDefaultOffset = 40;
    }

    /** 首次游玩（无任何存档）时的默认值：触屏设备预置触控偏移 */
    _defaults() {
        const base = { ...DEFAULT_SETTINGS };
        if (typeof IS_TOUCH_DEVICE !== 'undefined' && IS_TOUCH_DEVICE) {
            base.audioOffset = this._touchDefaultOffset;
        }
        return base;
    }

    /** 加载设置（如果不存在则返回默认值） */
    load() {
        if (this._settings !== null) return this._settings;
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                // 合并默认值以处理新增字段
                this._settings = { ...this._defaults(), ...parsed };
            } else {
                this._settings = this._defaults();
            }
        } catch {
            this._settings = this._defaults();
        }
        // 旧存档迁移：原「球皮 orb」已改为扁平条 bar
        if (this._settings.noteStyle === 'orb' || !this._settings.noteStyle) {
            this._settings.noteStyle = 'bar';
        }
        // 皮肤设置只允许已知取值
        if (this._settings.skin !== 'malody') this._settings.skin = 'builtin';
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
        this._settings = this._defaults();
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
        if (s.hitSoundVolume !== undefined) {
            hitSoundVolume = this._clampHitSoundVolume(s.hitSoundVolume);
        }
        if (s.noteStyle !== undefined) {
            noteStyle = s.noteStyle;
        }
        if (s.skin !== undefined && typeof skinMode !== 'undefined') {
            skinMode = s.skin === 'malody' ? 'malody' : 'builtin';
        }
        // 旧存档的难度仅用于未设置过难度的 MIDI 曲目。
        if (s.difficulty !== undefined) {
            selectedDifficulty = s.difficulty;
        }
        if (s.audioOffset !== undefined && typeof audioOffsetMs !== 'undefined') {
            audioOffsetMs = s.audioOffset;
        }
        if (s.touchFeedback !== undefined && typeof touchFeedbackEnabled !== 'undefined') {
            touchFeedbackEnabled = !!s.touchFeedback;
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
            hitSoundVolume: typeof hitSoundVolume !== 'undefined'
                ? this._clampHitSoundVolume(hitSoundVolume) : 100,
            noteStyle: noteStyle,
            skin: typeof skinMode !== 'undefined' ? skinMode : 'builtin',
            audioOffset: typeof audioOffsetMs !== 'undefined' ? audioOffsetMs : 0,
            touchFeedback: typeof touchFeedbackEnabled !== 'undefined' ? touchFeedbackEnabled : true
        });
    }

    /** 打击音效音量只接受 0-300 的整数百分比，非法值回落到 100。 */
    _clampHitSoundVolume(value) {
        const num = Number(value);
        if (!Number.isFinite(num)) return 100;
        return Math.max(0, Math.min(300, Math.round(num)));
    }
}

// 全局单例
const settingsStore = new SettingsStore();
