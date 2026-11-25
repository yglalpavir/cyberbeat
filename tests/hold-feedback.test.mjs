import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const alphaOf = fill => {
    const match = /rgba\(\d+,\d+,\d+,([\d.]+)\)/.exec(String(fill));
    return match ? Number(match[1]) : null;
};

function setupRenderer() {
    const ops = [];
    const ctx = {
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        globalAlpha: 1,
        fillRect(x, y, w, h) { ops.push({ op: 'fillRect', x, y, w, h, fill: this.fillStyle }); },
        strokeRect(x, y, w, h) { ops.push({ op: 'strokeRect', x, y, w, h, stroke: this.strokeStyle }); },
        beginPath() {},
        roundRect(x, y, w, h, r) { ops.push({ op: 'roundRect', x, y, w, h, r }); },
        fill() { ops.push({ op: 'fill', fill: this.fillStyle }); },
        stroke() { ops.push({ op: 'stroke', stroke: this.strokeStyle }); },
        save() {},
        restore() {},
        rect(x, y, w, h) { ops.push({ op: 'rect', x, y, w, h }); },
        clip() {}
    };
    const sandbox = createContext({
        ctx,
        ops,
        CanvasRenderingContext2D: { prototype: {} },
        TRACK_COLORS: ['#4dabf7', '#69db7c', '#ff6b6b', '#ffd43b'],
        CONFIG: { trackWidth: 80, effects: {} },
        noteStyle: 'bar',
        gameState: {},
        audioEngine: {},
        perfMonitor: {},
        window: { matchMedia: () => ({ matches: false }) },
        IS_TOUCH_DEVICE: false
    });
    runInContext(readFileSync(new URL('../js/renderer.js', import.meta.url), 'utf8'), sandbox, { filename: 'renderer.js' });
    runInContext(`
        renderer = Object.create(Renderer.prototype);
        Object.assign(renderer, {
            ctx, canvasHeight: 720, _motionEnabled: false,
            skin: null, spritesReady: false, _skinScale: 1
        });
    `, sandbox);
    const run = code => runInContext(code, sandbox);
    return { run, ops };
}

function draw(run, ops, state, progress = 0, missedAt = 0) {
    ops.length = 0;
    run(`renderer._drawHoldBody(100, 100, 500, '#4dabf7', '${state}', ${progress}, 0, 1000, ${missedAt});`);
    return ops.slice();
}

test('flat hold keeps its geometry while pending, active, and missed are visually distinct', () => {
    const { run, ops } = setupRenderer();

    const pending = draw(run, ops, 'pending');
    const active = draw(run, ops, 'active', 0.5);
    const missed = draw(run, ops, 'missed');

    for (const [label, frames] of [['pending', pending], ['active', active], ['missed', missed]]) {
        const body = frames.find(op => op.op === 'fillRect' && op.x === 104 && op.y === 114);
        assert.ok(body, `${label} body must start at the same clipped hold top`);
        assert.deepEqual({ x: body.x, y: body.y, w: body.w, h: body.h }, { x: 104, y: 114, w: 72, h: 386 }, `${label} body geometry`);
        assert.ok(frames.some(op => op.op === 'roundRect' && op.x === 104 && op.y === 100 && op.w === 72 && op.h === 14), `${label} tail geometry`);
    }

    assert.equal(alphaOf(pending[0].fill), 0.38);
    assert.equal(alphaOf(active[0].fill), 0.54);
    assert.equal(alphaOf(missed[0].fill), 0.16);
    assert.equal(missed[0].fill.startsWith('rgba(255,107,107,'), true, 'missed hold is red');

    assert.ok(pending.some(op => op.op === 'fillRect' && op.y === 523 && op.h === 2), 'pending head marker');
    assert.ok(active.some(op => op.op === 'fillRect' && op.y === 523 && op.h === 2), 'active head marker');
    assert.equal(missed.some(op => op.op === 'fillRect' && op.y === 523), false, 'missed hold has broken head');
    assert.ok(active.some(op => op.op === 'fillRect' && op.fill === 'rgba(255, 255, 255, 0.9)'), 'active progress edge');
    assert.ok(active.some(op => op.op === 'fillRect' && op.fill === 'rgba(77,171,247,0.72)'), 'active lit portion');
});

test('skin hold uses the same geometry and state alphas, with red tint only when missed', () => {
    const { run, ops } = setupRenderer();
    run(`
        skin = {
            layout: { noteHeight: 50 },
            laneColor: () => '#947FFF',
            laneElement: () => ({}),
            spriteNameOf: () => 'YnoteL',
            drawSprite(ctx, name, x, y, w, h, opts = {}) {
                ops.push({ op: 'sprite', name, x, y, w, h, alpha: opts.alpha, tint: opts.tint });
                return true;
            }
        };
        renderer.skin = skin;
        renderer.spritesReady = true;
    `);

    const pending = draw(run, ops, 'pending');
    const active = draw(run, ops, 'active', 0.5);
    const missed = draw(run, ops, 'missed');

    for (const [label, frames] of [['pending', pending], ['active', active], ['missed', missed]]) {
        const body = frames.find(op => op.op === 'sprite' && op.x === 100 && op.y === 130);
        assert.ok(body, `${label} skin body`);
        assert.deepEqual({ w: body.w, h: body.h }, { w: 80, h: 370 }, `${label} skin body geometry`);
        const tail = frames.find(op => op.op === 'sprite' && op.x === 100 && op.y === 100);
        assert.ok(tail, `${label} skin tail`);
        assert.deepEqual({ w: tail.w, h: tail.h }, { w: 80, h: 30 }, `${label} skin tail geometry`);
        assert.ok(frames.some(op => op.op === 'strokeRect' && op.x === 100.5 && op.y === 130.5), `${label} skin outline`);
    }

    assert.equal(pending.find(op => op.op === 'sprite' && op.y === 130).alpha, 0.66);
    assert.equal(active.find(op => op.op === 'sprite' && op.y === 130).alpha, 0.86);
    assert.equal(active.some(op => op.op === 'sprite' && op.alpha === 1), true, 'active overlay is opaque');
    const missedBody = missed.find(op => op.op === 'sprite' && op.y === 130);
    assert.equal(missedBody.alpha, 0.4);
    assert.equal(missedBody.tint, '#ff6b6b');
    assert.equal(missed.some(op => op.op === 'sprite' && op.y === 487), false, 'missed skin hold has no head');

    run('skin.drawSprite = () => false');
    const fallback = draw(run, ops, 'pending');
    assert.ok(fallback.some(op => op.op === 'fillRect' && op.x === 100 && op.y === 130 && op.w === 80 && op.h === 370), 'missing skin body falls back to visible track fill');
    assert.ok(fallback.some(op => op.op === 'fillRect' && op.x === 100 && op.y === 100 && op.w === 80 && op.h === 30), 'missing skin tail falls back to visible tail');
});

function setupAudio() {
    const sources = [];
    const gains = [];
    const oscillators = [];
    const master = { gain: { value: 1 }, connect() {}, disconnect() {} };
    const ctx = {
        state: 'running',
        currentTime: 1,
        sampleRate: 48000,
        destination: {},
        createGain() {
            const gain = {
                gain: {
                    value: 1,
                    cancelScheduledValues() {},
                    setValueAtTime() {},
                    exponentialRampToValueAtTime() {},
                    linearRampToValueAtTime() {}
                },
                connect(target) { this.target = target; },
                disconnect() { this.disconnected = true; }
            };
            gains.push(gain);
            return gain;
        },
        createBuffer(channels, length, sampleRate) {
            const data = new Float32Array(length);
            return { length, duration: length / sampleRate, numberOfChannels: channels, getChannelData: () => data };
        },
        createBufferSource() {
            const source = {
                buffer: null,
                connect() {},
                disconnect() {},
                start(at) { this.startedAt = at; },
                stop() {}
            };
            sources.push(source);
            return source;
        },
        createOscillator() {
            const osc = { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {}, onended: null };
            oscillators.push(osc);
            return osc;
        }
    };
    const hitSound = {
        perfectFreq: 1850, greatFreq: 1450, holdEndFreq: 2300, missFreq: 145,
        duration: 0.045, click: 0.55, gain: 0.24,
        missGainScale: 0.75, holdEndGainScale: 0.82, maxVoices: 6
    };
    const sandbox = createContext({
        context: ctx,
        master,
        getHitSoundConfig: () => hitSound,
        getPresetMusicConfig: () => ({}),
        getMidiConfig: () => ({}),
        getReverbConfig: () => ({}),
        CONFIG: { bpm: 120, defaultVolume: 4 },
        console: { log() {}, warn() {} }
    });
    runInContext(readFileSync(new URL('../js/audio-engine.js', import.meta.url), 'utf8'), sandbox, { filename: 'audio-engine.js' });
    const engine = runInContext('new AudioEngine()', sandbox);
    engine.context = ctx;
    engine.masterGain = master;
    return { engine, ctx, master, sources, gains, oscillators };
}

test('hit sounds are short cached samples on the master bus, not oscillators', () => {
    const { engine, ctx, master, sources, gains, oscillators } = setupAudio();

    engine.playHitSound('perfect');
    assert.equal(sources.length, 1);
    assert.equal(oscillators.length, 0, 'hit sounds must not allocate oscillators');
    assert.equal(sources[0].startedAt, ctx.currentTime);
    assert.ok(sources[0].buffer.length / ctx.sampleRate <= 0.12);
    assert.equal(gains[0].target, master, 'hit gain feeds masterGain (volume + limiter)');
    assert.equal(gains[0].gain.value, 0.24);

    const firstBuffer = sources[0].buffer;
    engine.playHitSound('perfect');
    assert.equal(sources[1].buffer, firstBuffer, 'same type reuses the rendered buffer');

    ctx.state = 'suspended';
    engine.playHitSound('perfect');
    assert.equal(sources.length, 2, 'suspended context must not queue a hit sound');
    ctx.state = 'running';

    engine.playHoldEnd();
    assert.notEqual(sources.at(-1).buffer, firstBuffer);
    assert.equal(gains.at(-1).gain.value, 0.24 * 0.82);

    engine.playHitSound('miss');
    assert.equal(gains.at(-1).gain.value, 0.24 * 0.75);
});

test('hit voices are capped and released without touching transport state', () => {
    const { engine, ctx, sources, gains } = setupAudio();
    engine._hitVoices = 0;

    for (let i = 0; i < 6; i++) engine.playHitSound('perfect');
    assert.equal(sources.length, 6);
    engine.playHitSound('perfect');
    assert.equal(sources.length, 6, 'voice cap drops extra hits instead of stacking');

    for (const source of sources) source.onended();
    assert.equal(engine._hitVoices, 0);
    assert.equal(gains.every(gain => gain.disconnected), true);
    assert.equal(ctx.currentTime, 1, 'hit feedback must not move the audio clock');
});

function setupDrawNotes() {
    const draws = [];
    const sandbox = createContext({
        draws,
        CanvasRenderingContext2D: { prototype: {} },
        TRACK_COLORS: ['#4dabf7', '#69db7c', '#ff6b6b', '#ffd43b'],
        CONFIG: { trackWidth: 80, health: { lossOnMiss: 1 }, effects: {} },
        noteStyle: 'bar',
        noteSpeed: 16,
        gameState: {
            notes: [], miss: 0, combo: 0, health: 100, paused: false,
            intervalStats: { perfect: 0, great: 0, miss: 0 },
            activeHolds: [null, null, null, null]
        },
        audioEngine: { playHitSound() {} },
        perfMonitor: {},
        window: { matchMedia: () => ({ matches: false }) },
        IS_TOUCH_DEVICE: false
    });
    runInContext(readFileSync(new URL('../js/renderer.js', import.meta.url), 'utf8'), sandbox, { filename: 'renderer.js' });
    runInContext(`
        renderer = Object.create(Renderer.prototype);
        Object.assign(renderer, {
            ctx: {}, canvasHeight: 720, canvasWidth: 400,
            trackPositions: [0, 1, 2, 3].map(i => ({ x: 40 + i * 80, cx: 80 + i * 80 })),
            _judgmentY: 450, _dt: 16.67, _motionEnabled: false,
            skin: null, spritesReady: false, _skinScale: 1,
            _drawNoteByStyle() {},
            _addMissEffect() {},
            _drawHoldBody(x, yTop, yBottom, color, state, progress, track) {
                draws.push({ x, yTop, yBottom, state, track });
            }
        });
    `, sandbox);
    return { run: code => runInContext(code, sandbox), draws };
}

test('long active and broken holds stay drawn after their head leaves the search window', () => {
    const { run, draws } = setupDrawNotes();
    // 头部 2000ms、尾部 9000ms：currentTime=6000 时头部早已落在 startIdx 之外，
    // 但长条仍横跨整条轨道，必须继续绘制。
    run(`
        const notes = [];
        for (let i = 0; i < 20; i++) notes.push({ type: 'tap', time: 1000 + i * 500, track: i % 4 });
        const hold = { type: 'hold', time: 2000, endTime: 9000, track: 0, hit: true, holdActive: true, startTime: 2000 };
        notes.push(hold, { type: 'tap', time: 9500, track: 1 });
        notes.sort((a, b) => a.time - b.time);
        gameState.notes = notes;
        gameState.activeHolds[0] = hold;
        window.hold = hold;
    `);

    draws.length = 0;
    run('renderer.drawNotes(6000)');
    const active = draws.filter(d => d.state === 'active');
    assert.equal(active.length, 1, 'excluded active hold is still drawn once');
    assert.deepEqual({ yTop: active[0].yTop, yBottom: active[0].yBottom }, { yTop: -50, yBottom: 720 });

    run('gameState.activeHolds[0] = null; hold.holdActive = false; hold.holdReleased = true; renderer.markHoldMiss(hold, 5800)');
    draws.length = 0;
    run('renderer.drawNotes(6000)');
    assert.equal(draws.filter(d => d.state === 'missed').length, 1, 'broken hold stays until its tail passes');
    assert.equal(draws.filter(d => d.state === 'active').length, 0);

    // 尾部越过屏幕底部后才回收，避免漏击反馈提前消失或集合无限增长。
    draws.length = 0;
    run('renderer.drawNotes(9500)');
    assert.equal(draws.filter(d => d.state === 'missed').length, 0, 'hold is not drawn after the tail leaves');
    assert.equal(run('renderer._missedHolds.size'), 0, 'expired holds are pruned from the feedback set');
});
