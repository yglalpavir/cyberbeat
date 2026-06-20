// ==================== 游戏配置常量 ====================

const CONFIG = {
    // 轨道配置
    trackCount: 4,
    trackWidth: 64,
    judgmentLineY: 0.85,
    
    // 判定窗口 (ms)
    perfectWindow: 40,
    greatWindow: 90,
    
    // 默认 BPM
    bpm: 180,
    
    // 预设模式保留的默认时长 (仅作后备)
    songDuration: 50000,
    
    // 统计数据记录间隔 (ms)
    statsInterval: 2000,
    
    // 难度预设
    difficulties: {
        'easy':       { interval: 400, trackInterval: 800, maxDensity: 3,  energyThreshold: 0.6 },
        'easy+':      { interval: 250, trackInterval: 500, maxDensity: 5,  energyThreshold: 0.5 },
        'normal':     { interval: 150, trackInterval: 250, maxDensity: 10, energyThreshold: 0.3 },
        'normal+':    { interval: 50,  trackInterval: 120, maxDensity: 25, energyThreshold: 0.1 }
    },
    
    // 谱面生成约束
    maxJackLength: 5,
    maxTrillLength: 10,
    
    // 曲库配置
    songListUrl: 'assets/songs/menu.json',
    songBasePath: 'assets/songs/'
};

// ==================== 输入映射 ====================

const KEYS = ['d', 'f', 'j', 'k'];
const TRACK_COLORS = ['#69b7eb', '#89d868', '#ff77a9', '#ffef5e'];
const TRACK_KEYS = ['D', 'F', 'J', 'K'];
const UI_SCALE = 1.25;

// ==================== 速度设置 ====================

const MIN_SPEED = 6.0;
const MAX_SPEED = 21.0;
const SPEED_STEP = 0.5;

// ==================== 运行时设置 ====================

let noteSpeed = 16.0;
let selectedDifficulty = 'normal+';
let noteStyle = 'orb';  // 'pixel' | 'orb'

// ==================== 选曲状态 ====================

// 曲库中的歌曲列表
let songLibrary = [];

// 当前选中的歌曲来源: 'library' | 'import' | null
let selectedSongSource = null;

// 当前选中的曲库歌曲 (当 source === 'library')
let selectedLibrarySong = null;

// 当前导入的 MIDI 数据 (当 source === 'import')
let loadedMidiData = null;

// 导入的 MIDI 文件名 (当 source === 'import')
let importedMidiFileName = null;

// 当前选中的歌曲显示名称
let selectedSongDisplayName = null;