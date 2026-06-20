// ==================== 游戏配置常量 ====================

const CONFIG = {
    trackCount: 4,
    trackWidth: 64,
    judgmentLineY: 0.85,
    perfectWindow: 40,
    greatWindow: 90,
    bpm: 180,
    songDuration: 50000,
    statsInterval: 2000,
    
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
    
    // 音量默认值 (百分比)
    defaultVolume: 25
};

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
let noteStyle = 'orb';

let songLibrary = [];
let selectedSongSource = null;
let selectedLibrarySong = null;
let loadedMidiData = null;
let importedMidiFileName = null;
let selectedSongDisplayName = null;

// 当前音量 (0-100)
let currentVolume = CONFIG.defaultVolume;