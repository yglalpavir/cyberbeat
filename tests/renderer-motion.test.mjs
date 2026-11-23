import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

function setupRenderer() {
    const sandbox = createContext({
        CanvasRenderingContext2D: { prototype: {} },
        TRACK_COLORS: ['#4dabf7', '#69db7c', '#ff6b6b', '#ffd43b'],
        CONFIG: { bpm: 120, effects: { particleLifeDecay: 0.05, particleMaxDuration: 2 } },
        gameState: {
            combo: 0,
            health: 100,
            calculateFinalScore: () => ({ finalScore: 0 })
        },
        audioEngine: { getVisualizerData: () => null },
        window: { matchMedia: () => ({ matches: false }) },
        IS_TOUCH_DEVICE: false
    });
    runInContext(readFileSync(new URL('../js/renderer.js', import.meta.url), 'utf8'), sandbox);
    runInContext(`
        renderer = Object.create(Renderer.prototype);
        Object.assign(renderer, {
            _dt: 16.67,
            _motionEnabled: true,
            _lastCombo: 0,
            _comboPop: 0,
            _milestoneAge: Infinity,
            _milestoneCombo: 0,
            _displayScore: null,
            _displayHealth: null,
            _healthGhost: null,
            _beat: 0,
            _prevBassRaw: 0,
            _lastOnsetAt: -Infinity,
            _fallbackBeat: -1,
            _countdownSecond: null,
            _bars: new Float32Array(4),
            _ringAge: [Infinity, Infinity, Infinity, Infinity],
            _PARTICLE_POOL_MAX: 16,
            _particlePoolIdx: 1,
            _particlePool: [{ x: 2, y: 3, vx: 4, vy: 5, size: 8, color: '#fff', life: 1, active: true, timeElapsed: 0 }],
            ctx: { fillRect() {} }
        });
    `, sandbox);
    return { run: code => runInContext(code, sandbox) };
}

test('rhythm visualization stays finite, responds to chart time, and honors reduced motion', () => {
    const { run } = setupRenderer();
    run('renderer.updateRhythm(-3000)');
    run('renderer.updateRhythm(-2950)');
    assert.ok(run('renderer._beat > 0'));
    assert.ok(run('renderer._bars.every(Number.isFinite)'));
    assert.ok(run('renderer._bars.some(value => value > 0)'));

    run('gameState.combo = 50');
    run('renderer.updateRhythm(-2934)');
    assert.equal(run('renderer._milestoneCombo'), 50);

    run('renderer._motionEnabled = false; gameState.combo = 51');
    run('renderer.updateRhythm(0)');
    assert.equal(run('renderer._comboPop'), 0);
    assert.equal(run('renderer._bars.some(value => value > 0)'), false);
});

test('spectrum and hit ring stay frozen at zero frame delta', () => {
    const { run } = setupRenderer();
    run(`
        audioEngine.getVisualizerData = () => new Uint8Array(32).fill(160);
        renderer._ringAge[2] = 0;
        renderer.updateRhythm(100);
    `);
    assert.ok(run('renderer._beat > 0 && renderer._bars.every(value => value > 0)'));
    const snapshot = 'JSON.stringify([renderer._beat, renderer._bars, renderer._ringAge])';
    const before = run(snapshot);
    run('renderer.setFrameDelta(0); renderer.updateRhythm(100)');
    assert.equal(run(snapshot), before);
});

test('zero frame delta freezes pooled gameplay effects', () => {
    const { run } = setupRenderer();
    run('renderer.setFrameDelta(0); renderer.drawParticles()');
    assert.equal(run('renderer._dt'), 0);
    assert.equal(run('renderer._particlePool[0].x'), 2);
    assert.equal(run('renderer._particlePool[0].y'), 3);
    assert.equal(run('renderer._particlePool[0].timeElapsed'), 0);
    assert.equal(run('renderer._particlePool[0].life'), 1);
});
