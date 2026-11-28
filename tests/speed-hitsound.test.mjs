import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const read = name => readFileSync(new URL(`../js/${name}`, import.meta.url), 'utf8');

/** 精简版音频引擎沙箱：只关心 _hitLevel 的增益计算。 */
function setupHitLevel(globals = {}) {
    const sandbox = createContext({
        console: { log() {}, warn() {} },
        window: {},
        ...globals
    });
    runInContext(read('audio-engine.js'), sandbox, { filename: 'audio-engine.js' });
    return code => runInContext(code, sandbox);
}

function setupUI(globals = {}) {
    const saved = new Map();
    const sandbox = createContext({
        console: { warn() {}, log() {} },
        document: { querySelectorAll: () => [], querySelector: () => null },
        settingsStore: {
            get: key => saved.get(key),
            set: (key, value) => saved.set(key, value),
            syncFromRuntime: () => saved.set('_synced', true),
            _clampHitSoundVolume: value => {
                const num = Number(value);
                return Number.isFinite(num) ? Math.max(0, Math.min(300, Math.round(num))) : 100;
            }
        },
        ...globals
    });
    runInContext(read('ui.js'), sandbox, { filename: 'ui.js' });
    runInContext('const ui = Object.create(UIManager.prototype);', sandbox);
    const run = code => runInContext(code, sandbox);
    return { run, saved };
}

test('scroll speed accepts fine 0.1 steps across a much wider range', () => {
    const { run, saved } = setupUI({
        MIN_SPEED: 1.0, MAX_SPEED: 30.0, SPEED_STEP: 0.1, noteSpeed: 16.0, hitSoundVolume: 100
    });
    run('ui.speedValue = {}; ui.speedSlider = null;');

    run('ui.setNoteSpeed(16.3)');
    assert.equal(run('noteSpeed'), 16.3);
    assert.equal(run('ui.speedValue.textContent'), '16.3x');

    // 步进 0.1 不应留下浮点尾巴
    run('ui.changeSpeed(0.1)');
    run('ui.changeSpeed(0.1)');
    assert.equal(run('noteSpeed'), 16.5);

    // 上下限夹取
    run('ui.setNoteSpeed(999)');
    assert.equal(run('noteSpeed'), 30);
    run('ui.setNoteSpeed(-5)');
    assert.equal(run('noteSpeed'), 1);
    run('ui.setNoteSpeed(Number.NaN)');
    assert.equal(run('noteSpeed'), 1, 'NaN is ignored instead of poisoning the setting');

    assert.equal(saved.get('_synced'), true, 'every change is flushed to the store');
});

test('hit sound volume scales gain up to 300% without touching music volume', () => {
    const run = setupHitLevel();
    run('hitSoundVolume = 100;');
    const cfg = `{ gain: 0.24, missGainScale: 0.75, holdEndGainScale: 0.82 }`;

    const base = run(`new AudioEngine()._hitLevel('perfect', ${cfg})`);
    assert.ok(Math.abs(base - 0.24) < 1e-9);

    run('hitSoundVolume = 300;');
    assert.ok(Math.abs(run(`new AudioEngine()._hitLevel('perfect', ${cfg})`) - 0.72) < 1e-9);

    run('hitSoundVolume = 0;');
    assert.equal(run(`new AudioEngine()._hitLevel('perfect', ${cfg})`), 0);

    // miss / holdEnd 的相对比例在放大后仍然保持
    run('hitSoundVolume = 200;');
    assert.ok(Math.abs(run(`new AudioEngine()._hitLevel('miss', ${cfg})`) - 0.24 * 0.75 * 2) < 1e-9);
    assert.ok(Math.abs(run(`new AudioEngine()._hitLevel('holdEnd', ${cfg})`) - 0.24 * 0.82 * 2) < 1e-9);

    // 非法值回落到 100%
    run('hitSoundVolume = Number.NaN;');
    assert.ok(Math.abs(run(`new AudioEngine()._hitLevel('perfect', ${cfg})`) - 0.24) < 1e-9);
});

test('settings store clamps and persists hit sound volume', () => {
    const store = new Map();
    const sandbox = createContext({
        console: { warn() {} },
        localStorage: {
            getItem: key => (store.has(key) ? store.get(key) : null),
            setItem: (key, value) => store.set(key, String(value)),
            removeItem: key => store.delete(key)
        },
        IS_TOUCH_DEVICE: false
    });
    runInContext(read('settings-store.js'), sandbox, { filename: 'settings-store.js' });
    const run = code => runInContext(code, sandbox);

    assert.equal(run('settingsStore.get("hitSoundVolume")'), 100);
    assert.equal(run('settingsStore._clampHitSoundVolume(420)'), 300);
    assert.equal(run('settingsStore._clampHitSoundVolume(-20)'), 0);
    assert.equal(run('settingsStore._clampHitSoundVolume("150")'), 150);
    assert.equal(run('settingsStore._clampHitSoundVolume(undefined)'), 100);

    // syncFromRuntime 读取全局运行时变量：先按 config.js 的声明补齐
    run(`
        let noteSpeed = 16.0, currentVolume = 4, noteStyle = 'bar';
        let hitSoundVolume = 250, audioOffsetMs = 0, touchFeedbackEnabled = true;
        settingsStore.syncFromRuntime();
    `);
    assert.equal(JSON.parse(store.get('cyberbeat_settings')).hitSoundVolume, 250);
});

test('charts inside one song are ordered from low level to high', () => {
    const { run } = setupUI({
        songLibrary: [
            { id: 'a', title: 'Song', artist: 'X', level: 30, difficultyName: 'Hard', beatmapType: 'osu' },
            { id: 'b', title: 'Song', artist: 'X', level: 11, difficultyName: 'Easy', beatmapType: 'osu' },
            { id: 'c', title: 'Song', artist: 'X', level: 19, difficultyName: 'Normal', beatmapType: 'osu' },
            // 等级缺失的谱面排在最后
            { id: 'd', title: 'Song', artist: 'X', difficultyName: 'Unknown LV', beatmapType: 'mc' },
            { id: 'e', title: 'Other', artist: 'Y', level: 5, difficultyName: 'Only', beatmapType: 'mc' }
        ]
    });
    const groups = run('JSON.stringify(ui._getChartGroups().map(g => ({ title: g.title, ids: g.charts.map(c => c.song.id) })))');
    assert.deepEqual(JSON.parse(groups), [
        { title: 'Song', ids: ['b', 'c', 'a', 'd'] },
        { title: 'Other', ids: ['e'] }
    ]);
});
