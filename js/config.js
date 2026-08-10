// ==================== 游戏配置常量 ====================

const CONFIG = {
    trackCount: 4,
    trackWidth: 80,
    trackSpacing: 12,
    judgmentLineY: 0.85,
    perfectWindow: 40,
    greatWindow: 90,
    bpm: 180,
    songDuration: 50000,
    statsInterval: 2000,

    // 血量
    health: {
        initial: 100,
        gainOnHit: 2,
        lossOnMiss: 10
    },

    // 视觉效果时长
    effects: {
        judgmentRiseSpeed: 0.8,
        judgmentFadeRate: 0.01,
        judgmentInitialBounce: 1.2,
        judgmentMaxDuration: 1.5,

        particleLifeDecay: 0.025,
        particleSpeed: 4,
        particleCount: 8,
        particleMaxDuration: 1.2,

        laserGrowSpeed: 10,
        laserFadeRate: 0.025,
        laserMaxDuration: 1.0
    },
    
    difficulties: {
        'easy':       { interval: 400, trackInterval: 800, maxDensity: 3,  energyThreshold: 0.6 },
        'easy+':      { interval: 250, trackInterval: 500, maxDensity: 5,  energyThreshold: 0.5 },
        'normal':     { interval: 150, trackInterval: 250, maxDensity: 10, energyThreshold: 0.3 },
        'normal+':    { interval: 50,  trackInterval: 120, maxDensity: 25, energyThreshold: 0.1 }
    },
    
    maxJackLength: 5,
    maxTrillLength: 10,
    
    songListUrl: 'assets/songs/menu.json',
    songBasePath: 'assets/songs/',
    osuBasePath: 'assets/osu/',
    mcAudioBasePath: 'assets/mc_audio/',
    
    // 默认音量 (0-10)
    defaultVolume: 4,
    
    // 倒计时时长 (ms)
    countdownDuration: 3000,

    // ==================== 积分系统 ====================
    // 单曲满分 1,000,000 = 判定分 900,000 + 连击分 100,000
    maxScore: 1000000,
    judgmentScoreMax: 900000,
    comboScoreMax: 100000

};

// ==================== 从 judge.json 加载判定配置 ====================
let JUDGE_CONFIG = null;

async function loadJudgeConfig() {
    try {
        const response = await fetch('data/judge.json');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        JUDGE_CONFIG = await response.json();

        // 合并到 CONFIG
        if (JUDGE_CONFIG.perfectWindow !== undefined) CONFIG.perfectWindow = JUDGE_CONFIG.perfectWindow;
        if (JUDGE_CONFIG.greatWindow !== undefined)   CONFIG.greatWindow   = JUDGE_CONFIG.greatWindow;
        if (JUDGE_CONFIG.judgmentLineY !== undefined)  CONFIG.judgmentLineY  = JUDGE_CONFIG.judgmentLineY;

        if (JUDGE_CONFIG.health) {
            if (JUDGE_CONFIG.health.initial    !== undefined) CONFIG.health.initial    = JUDGE_CONFIG.health.initial;
            if (JUDGE_CONFIG.health.gainOnHit  !== undefined) CONFIG.health.gainOnHit  = JUDGE_CONFIG.health.gainOnHit;
            if (JUDGE_CONFIG.health.lossOnMiss !== undefined) CONFIG.health.lossOnMiss = JUDGE_CONFIG.health.lossOnMiss;
        }

        if (JUDGE_CONFIG.effects) {
            const e = JUDGE_CONFIG.effects;
            if (e.judgmentRiseSpeed     !== undefined) CONFIG.effects.judgmentRiseSpeed     = e.judgmentRiseSpeed;
            if (e.judgmentFadeRate      !== undefined) CONFIG.effects.judgmentFadeRate      = e.judgmentFadeRate;
            if (e.judgmentInitialBounce !== undefined) CONFIG.effects.judgmentInitialBounce = e.judgmentInitialBounce;
            if (e.judgmentMaxDuration   !== undefined) CONFIG.effects.judgmentMaxDuration   = e.judgmentMaxDuration;
            if (e.particleLifeDecay     !== undefined) CONFIG.effects.particleLifeDecay     = e.particleLifeDecay;
            if (e.particleSpeed         !== undefined) CONFIG.effects.particleSpeed         = e.particleSpeed;
            if (e.particleCount         !== undefined) CONFIG.effects.particleCount         = e.particleCount;
            if (e.particleMaxDuration   !== undefined) CONFIG.effects.particleMaxDuration   = e.particleMaxDuration;
            if (e.laserGrowSpeed        !== undefined) CONFIG.effects.laserGrowSpeed        = e.laserGrowSpeed;
            if (e.laserFadeRate         !== undefined) CONFIG.effects.laserFadeRate         = e.laserFadeRate;
            if (e.laserMaxDuration      !== undefined) CONFIG.effects.laserMaxDuration      = e.laserMaxDuration;
        }

        console.log('Judge config loaded:', JUDGE_CONFIG);
        return JUDGE_CONFIG;
    } catch (err) {
        console.warn('Failed to load data/judge.json, using built-in defaults:', err);
        JUDGE_CONFIG = null;
        return null;
    }
}

// ==================== 输入映射 ====================

const KEYS = ['d', 'f', 'j', 'k'];
const TRACK_COLORS = ['#4dabf7', '#69db7c', '#ff6b6b', '#ffd43b'];
const TRACK_KEYS = ['D', 'F', 'J', 'K'];
const UI_SCALE = 1.25;

// ==================== 速度设置 ====================

const MIN_SPEED = 6.0;
const MAX_SPEED = 21.0;
const SPEED_STEP = 0.5;

let noteSpeed = 16.0;
let selectedDifficulty = 'normal+';
let noteStyle = 'orb';   // 'pixel' | 'orb'

let songLibrary = [];
let selectedSongSource = null;
let selectedLibrarySong = null;
let loadedMidiData = null;
let loadedMcData = null;         // MC 谱面解析结果 { notes, meta }
let loadedOsuData = null;        // osu!mania 谱面解析结果 { notes, meta }
let importedMidiFileName = null;
let importedOsuFileName = null;
let importedMcFileName = null;
let selectedSongDisplayName = null;

/**
 * 获取当前加载的谱面数据（.mc 或 .osu，MC 优先）
 * @returns {Object|null} { notes, meta }
 */
function getLoadedChartData() {
    return loadedMcData || loadedOsuData;
}

// 当前音量 (0-10)
let currentVolume = CONFIG.defaultVolume;

// 全局音频延迟校准（ms）：正值使音符更晚到达判定线（相当于判定线相对音乐延后），负值反之
let audioOffsetMs = 0;

// ==================== 音频配置（从 data/audio.json 加载） ====================

let AUDIO_CONFIG = null;

async function loadAudioConfig() {
    try {
        const response = await fetch('data/audio.json');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        AUDIO_CONFIG = await response.json();
        
        // 用 audio.json 中的 defaultVolume 覆盖 CONFIG 默认值
        if (AUDIO_CONFIG.defaultVolume !== undefined) {
            CONFIG.defaultVolume = AUDIO_CONFIG.defaultVolume;
            currentVolume = AUDIO_CONFIG.defaultVolume;
        }
        
        console.log('Audio config loaded:', AUDIO_CONFIG);
        return AUDIO_CONFIG;
    } catch (err) {
        console.warn('Failed to load data/audio.json, using built-in defaults:', err);
        AUDIO_CONFIG = null;
        return null;
    }
}

// 获取 limiter 配置，返回带 fallback 默认值的对象
function getLimiterConfig() {
    if (AUDIO_CONFIG && AUDIO_CONFIG.limiter) {
        return AUDIO_CONFIG.limiter;
    }
    return { enabled: true, threshold: -6, knee: 0, ratio: 20, attack: 0.002, release: 0.05 };
}

// 获取 MIDI 播放器配置，返回带 fallback 默认值的对象
function getMidiConfig() {
    if (AUDIO_CONFIG && AUDIO_CONFIG.midi) {
        return AUDIO_CONFIG.midi;
    }
    return {
        schedulerInterval: 25, schedulerLookAhead: 0.1,
        noteOnRampTime: 0.02, noteOffRampTime: 0.15, noteStopPadding: 0.2,
        maxVelocity: 127, velocityGain: 0.5,
        lowNoteThreshold: 60, lowNoteType: 'triangle', highNoteType: 'square'
    };
}

// 获取预设音乐配置
function getPresetMusicConfig() {
    if (AUDIO_CONFIG && AUDIO_CONFIG.presetMusic) {
        return AUDIO_CONFIG.presetMusic;
    }
    return {
        bassFreqs: [110, 130, 146, 164],
        leadFreqs: [440, 523, 659, 784],
        kickFreqStart: 200, kickFreqEnd: 50, kickGain: 0.5, kickDuration: 0.15,
        hiHatGain: 0.1, hiHatDuration: 0.02,
        bassDuration: 0.1, leadDuration: 0.05,
        noteGain: 0.3,
        presetSchedulerInterval: 20, presetSchedulerLookAhead: 0.1
    };
}

// 获取混响配置
function getReverbConfig() {
    if (AUDIO_CONFIG && AUDIO_CONFIG.reverb) {
        return AUDIO_CONFIG.reverb;
    }
    return { duration: 3.5, decay: 2.5 };
}

// 获取打击音效配置
function getHitSoundConfig() {
    if (AUDIO_CONFIG && AUDIO_CONFIG.hitSound) {
        return AUDIO_CONFIG.hitSound;
    }
    return { perfectFreq: 1200, greatFreq: 900, missFreq: 200, duration: 0.1, gain: 0.2 };
}

// ==================== MIDI 元数据计算 ====================

/**
 * 从 MIDI 解析数据中计算平均 BPM
 * @param {Object} midiData - MidiParser.parse() 的返回结果
 * @returns {number} 平均 BPM，若无法计算则返回 120
 */
function computeAverageBpm(midiData) {
    if (!midiData || !midiData.tempos || midiData.tempos.length === 0) {
        return 120;
    }
    const sum = midiData.tempos.reduce((acc, t) => acc + t.bpm, 0);
    return Math.round(sum / midiData.tempos.length);
}

/**
 * 将秒数格式化为 "M:SS" 字符串
 * @param {number} seconds
 * @returns {string}
 */
function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, '0')}`;
}