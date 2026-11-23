import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

function setup() {
    let wallTime = 100;
    let hidden = false;
    let visibilityChanged;
    let timerId = 0;
    const timers = new Set();
    const play = [];
    const stubNode = () => ({ gain: { value: 1 }, connect() {}, disconnect() {} });
    const context = {
        state: 'running', currentTime: 4,
        createGain: stubNode,
        createBufferSource: () => ({ ...stubNode(), start: (...args) => play.push(args), stop() {} }),
        suspend() { this.state = 'suspended'; return Promise.resolve(); },
        resume() { this.state = 'running'; return Promise.resolve(); }
    };
    const sandbox = createContext({
        context, play,
        console: { log() {} },
        document: {
            get hidden() { return hidden; },
            addEventListener(type, callback) { if (type === 'visibilitychange') visibilityChanged = callback; }
        },
        performance: { now: () => wallTime },
        setTimeout: () => (timers.add(++timerId), timerId),
        clearTimeout: id => timers.delete(id),
        renderer: null,
        CONFIG: { countdownDuration: 3000, health: { initial: 100 }, bpm: 120, defaultVolume: 5 },
        getMidiConfig: () => ({ schedulerLookAhead: 0.1, schedulerInterval: 25 }),
        getPresetMusicConfig: () => ({
            presetSchedulerLookAhead: 0.1, presetSchedulerInterval: 20, bassFreqs: [1], leadFreqs: [2]
        })
    });
    const run = code => runInContext(code, sandbox);
    for (const name of ['game-state', 'audio-engine', 'ui']) {
        runInContext(readFileSync(new URL(`../js/${name}.js`, import.meta.url), 'utf8'), sandbox, { filename: `${name}.js` });
    }
    run(`
        const ui = Object.create(UIManager.prototype);
        ui._setPauseOverlayVisible = ui._requestWakeLock = () => {};
        ui._setupVisibilityHandling();
        audioEngine.context = context;
        audioEngine.masterGain = context.createGain();
        audioEngine.audioBuffer = { duration: 60 };
        gameState.screen = 'game';
    `);
    return {
        context, timers, run, play,
        visibility: value => { hidden = value; visibilityChanged(); },
        advance(ms) { wallTime += ms; if (context.state === 'running') context.currentTime += ms / 1000; },
        async tick() {
            run('ui._tickResumeCountdown(performance.now())');
            await run('ui._resumeTask');
        }
    };
}

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.001, `${actual} != ${expected}`);

test('repeated pause and countdown cancellation preserve the file and chart positions', async () => {
    const { run, advance, tick, play } = setup();
    run('gameState.timingOffset = 40; audioEngine.startAudioPlayback(3, 0.12);');
    assert.deepEqual(play, [[7.12, 0]]);
    advance(6000);
    run('gameState.intervalStartTime = 2000;');
    let position = 2960;
    for (let i = 0; i < 4; i++) {
        run('ui.togglePause()');
        near(run('gameState.currentTime()'), position);
        advance(6000);
        run('ui.togglePause()');
        advance(1200);
        await tick();
        assert.ok(run('gameState.resumeCountdownUntil > 0'));
        run('ui.togglePause()');
        near(run('gameState.pauseSnapshotTime'), position);
        advance(10000);
        run('ui.togglePause()');
        advance(3100);
        await tick();
        assert.equal(run('gameState.resumeCountdownUntil'), 0);
        near(run('gameState.currentTime()'), position);
        advance(500);
        position += 500;
        near(run('gameState.currentTime()'), position);
    }
    assert.equal(play.length, 1, 'file resume must not recreate or seek the source');
    assert.equal(run('gameState.intervalStartTime'), 2000);
});

test('backgrounding freezes both opening and recovery countdowns without losing calibration', async () => {
    const { run, advance, tick, visibility } = setup();
    run('gameState.timingOffset = -40; audioEngine.startAudioPlayback(3, 0.2);');
    advance(1000);
    visibility(true);
    advance(15000);
    near(run('gameState.currentTime()'), -1960);
    visibility(false);
    await new Promise(resolve => setImmediate(resolve));
    advance(3000);
    near(run('gameState.currentTime()'), 1040);
    run('ui.togglePause(); ui.togglePause()');
    advance(750);
    visibility(true);
    assert.equal(run('gameState.resumeCountdownRemaining'), 2250);
    advance(20000);
    visibility(false);
    advance(2249);
    await tick();
    assert.ok(run('gameState.resumeCountdownUntil > 0'));
    advance(1);
    await tick();
    assert.equal(run('gameState.resumeCountdownUntil'), 0);
    near(run('gameState.currentTime()'), 1040);
});

test('repausing while Web Audio resume is pending invalidates the old attempt', async () => {
    const { run, advance, tick, context } = setup();
    run('audioEngine.startAudioPlayback(); ui.togglePause(); ui.togglePause()');
    let finish;
    const resume = context.resume;
    context.resume = () => new Promise(resolve => { finish = resolve; });
    advance(3100);
    const pending = tick();
    run('ui.togglePause()');
    finish();
    await pending;
    assert.equal(run('gameState.paused && audioEngine._paused'), true);
    near(run('gameState.currentTime()'), 0);
    context.resume = resume;
    run('ui.togglePause()');
    advance(3100);
    await tick();
    assert.equal(run('gameState.resumeCountdownUntil'), 0);
    advance(500);
    near(run('gameState.currentTime()'), 500);
});

test('skipping the intro preserves both calibration and positive or negative file offsets', () => {
    for (const offset of [-0.25, 0.25]) {
        const { run, advance, play } = setup();
        run(`
            gameState.timingOffset = 40;
            gameState.notes = [{ time: 17000 }];
            audioEngine.startAudioPlayback(3, ${offset});
        `);
        near(play[0][0], 7 + offset);
        advance(4100);
        run('ui.setSkipIntroVisible = () => {}; ui.skipIntro()');
        near(run('gameState.currentTime()'), 12000);
        near(play[1][1], 12.04 - offset);
    }
});

test('MIDI uses original event times after pause and seek; preset retains beat phase on resume', async () => {
    const { run, advance, tick, play, timers } = setup();
    run(`
        audioEngine._connectMidiReverb = () => {};
        audioEngine.playMidiNote = (note, duration, velocity, when) => play.push(when);
        audioEngine.startMidiMusic([{ type: 'noteOn', time: 0, noteNumber: 60 }, { type: 'noteOn', time: 1, noteNumber: 61 }], 0.05);
    `);
    near(play[0], 4.05);
    advance(1000);
    run('clearTimeout(audioEngine.midiScheduleTimer); audioEngine.midiScheduler()');
    near(play[1], 5.05);
    run('audioEngine.seekMusic(990)');
    near(play[2], 5.01);
    run('ui.togglePause(); ui.togglePause()');
    advance(3000);
    await tick();
    near(run('gameState.currentTime()'), 990);
    assert.equal(play.length, 3);
    run(`
        audioEngine.stopMusic();
        audioEngine.playKick = delay => play.push(delay);
        audioEngine.playHiHat = audioEngine.playNote = () => {};
        audioEngine.startPresetMusic(0.05);
        ui._pauseGame(); ui._beginResumeCountdown();
    `);
    near(play[3], 0.05);
    advance(4000);
    await tick();
    near(run('gameState.currentTime()'), -50);
    assert.equal(play.length, 4);
    // Stop cancels the live scheduler, including when the next track is a file.
    run('audioEngine.stopMusic()');
    assert.equal(run('audioEngine.timerID'), null);
    assert.equal(timers.size, 0);
});
