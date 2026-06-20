// Game Configuration Constants
const CONFIG = {
    trackCount: 4,
    trackWidth: 64,
    judgmentLineY: 0.85,
    perfectWindow: 40,    // ms
    greatWindow: 90,      // ms
    bpm: 180,
    songDuration: 50000,  // ms (for preset mode)
    statsInterval: 2000,  // ms
    
    // Difficulty presets
    difficulties: {
        'easy':       { interval: 400, trackInterval: 800, maxDensity: 3,  energyThreshold: 0.6 },
        'easy+':      { interval: 250, trackInterval: 500, maxDensity: 5,  energyThreshold: 0.5 },
        'normal':     { interval: 150, trackInterval: 250, maxDensity: 10, energyThreshold: 0.3 },
        'normal+':    { interval: 50,  trackInterval: 120, maxDensity: 25, energyThreshold: 0.1 }
    },
    
    maxJackLength: 5,
    maxTrillLength: 10
};

// Input mappings
const KEYS = ['d', 'f', 'j', 'k'];
const TRACK_COLORS = ['#69b7eb', '#89d868', '#ff77a9', '#ffef5e'];
const TRACK_KEYS = ['D', 'F', 'J', 'K'];
const UI_SCALE = 1.25;

// Speed settings
const MIN_SPEED = 6.0;
const MAX_SPEED = 21.0;
const SPEED_STEP = 0.5;

// Default settings
let noteSpeed = 16.0;
let selectedDifficulty = 'normal+';
let gameMode = 'custom';
let noteStyle = 'orb';  // 'pixel' or 'orb'
let loadedMidiData = null;