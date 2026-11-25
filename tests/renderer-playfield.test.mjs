import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const rendererSource = read('../js/renderer.js');
const skinSource = read('../js/skin.js');
const skinScript = read('../assets/skins/yuxen/script-key-4K.mui');
const WIDTH = 844;
const HEIGHT = 390;
const TRACK_COLORS = ['#4dabf7', '#69db7c', '#ff6b6b', '#ffd43b'];

function setup({ width = WIDTH, height = HEIGHT, touch = true, malody = false, safeBottom = 0 } = {}) {
    const fills = [];
    const sprites = [];
    const ctx = {
        setTransform() {}, fillRect() {}, strokeRect() {}, beginPath() {}, stroke() {},
        save() {}, restore() {}, rect() {}, clip() {},
        roundRect(x, y, w, h) { this.shape = { x, y, w, h }; },
        fill() { fills.push({ ...this.shape, color: this.fillStyle }); }
    };
    const gameState = {
        notes: [], activeHolds: [null, null, null, null], pressedKeys: new Set(),
        combo: 0, health: 100, miss: 0, intervalStats: { miss: 0 }
    };
    const perfMonitor = {};
    const sandbox = createContext({
        ctx, gameState, perfMonitor, sprites, skinScript, malody,
        CanvasRenderingContext2D: { prototype: {} },
        document: { documentElement: {} },
        getComputedStyle: () => ({ getPropertyValue: name => name === '--safe-bottom' ? `${safeBottom}px` : '' }),
        window: { innerWidth: width, innerHeight: height, matchMedia: () => ({ matches: true }) },
        IS_TOUCH_DEVICE: touch,
        TRACK_COLORS,
        KEYS: ['d', 'f', 'j', 'k'],
        CONFIG: { trackCount: 4, judgmentLineY: 0.85, effects: {}, health: { lossOnMiss: 1 } },
        audioEngine: { playHitSound() {} },
        noteSpeed: 10, // 1000 canvas px / second
        noteStyle: 'bar'
    });
    runInContext(skinSource, sandbox, { filename: 'skin.js' });
    runInContext(rendererSource, sandbox, { filename: 'renderer.js' });
    const renderer = runInContext(`
        const renderer = new Renderer({ style: {} }, ctx);
        if (malody) {
            const skin = new MalodySkin('');
            const { elements, defines } = parseSkinScript(skinScript);
            Object.assign(skin, { elements, defines });
            skin._deriveLayout();
            skin._resolveSprite = () => ({});
            skin.drawSprite = (ctx, name, x, y, w, h, { tint } = {}) => {
                sprites.push({ name, x, y, w, h, tint });
                return true;
            };
            renderer.setSkin(skin);
        }
        renderer._addMissEffect = () => {};
        renderer;
    `, sandbox);
    return { renderer, gameState, perfMonitor, fills, sprites };
}

test('touch landscape lowers the line on both skins, with existing safe-area and orientation limits', () => {
    for (const malody of [false, true]) {
        const { renderer } = setup({ malody });
        assert.equal(renderer._judgmentY, 24 + (HEIGHT - 24) * 0.82);
        const { renderer: inset } = setup({ malody, safeBottom: 21 });
        assert.equal(inset._judgmentY, HEIGHT - 21 - 24 - 18);
        const { renderer: portrait } = setup({ malody, width: HEIGHT, height: WIDTH });
        assert.equal(portrait._judgmentY, 24 + (WIDTH - 24) * 0.78);
    }
    const { renderer: desktop } = setup({ touch: false });
    assert.equal(desktop._judgmentY, HEIGHT * 0.85);
});

test('Malody draws the track and press feedback but not the decorative Yhint sprites', () => {
    const { renderer, gameState, sprites } = setup({ malody: true });
    gameState.pressedKeys.add('d');
    renderer.drawTracks();
    assert.deepEqual(sprites.map(sprite => sprite.name), [
        'Ybg', 'Ybottom1', 'Ybottom2', 'Ybottom2', 'Ybottom1', 'Ypress-0',
        'Ynote1', 'Ynote2', 'Ynote2', 'Ynote1'
    ]);
    const press = sprites.find(sprite => sprite.name === 'Ypress-0');
    assert.equal(press.y + press.h, renderer._judgmentY);
});

for (const malody of [false, true]) {
    const skin = malody ? 'Malody' : 'built-in';
    test(`${skin} renders incoming notes at the top, with sky-blue hold heads and unchanged taps`, () => {
        const { renderer, gameState, perfMonitor, fills, sprites } = setup({ malody });
        const now = 1000;
        const time = now + renderer._judgmentY + 6;
        const tap = { type: 'tap', track: 0, time };
        const hold = { type: 'hold', track: 1, time, endTime: time + 180 };
        gameState.notes.push(tap, hold);
        renderer.drawNotes(now);

        assert.equal(perfMonitor.visibleNotes, 2);
        assert.ok(Math.abs(tap.y + 6) < 1e-9);
        assert.equal(hold.y, tap.y);
        if (malody) {
            const tapSprite = sprites.find(sprite => sprite.name === 'Ynote1');
            const headSprite = sprites.find(sprite => sprite.name === 'Ynote2');
            assert.equal(tapSprite.tint, undefined);
            assert.equal(headSprite.tint, '#87ceeb');
            assert.deepEqual([headSprite.y, headSprite.w, headSprite.h], [tapSprite.y, tapSprite.w, tapSprite.h]);
        } else {
            const [tapFill, headFill] = fills;
            assert.equal(tapFill.color, TRACK_COLORS[0]);
            assert.equal(headFill.color, '#87ceeb');
            assert.deepEqual([headFill.y, headFill.w, headFill.h], [tapFill.y, tapFill.w, tapFill.h]);
        }
    });

    test(`${skin} still reaches the receptors at chart time and keeps the original miss deadline`, () => {
        const { renderer, gameState } = setup({ malody });
        const time = 1000;
        const tap = { type: 'tap', track: 0, time };
        const hold = { type: 'hold', track: 1, time, endTime: time + 300 };
        gameState.notes.push(tap, hold);
        renderer.drawNotes(time);
        assert.equal(tap.y, renderer._judgmentY);
        assert.equal(hold.y, renderer._judgmentY);

        const oldLineY = 24 + (HEIGHT - 24) * 0.78;
        const oldMissDeadline = time + HEIGHT + 100 - oldLineY;
        renderer.drawNotes(oldMissDeadline - 1);
        assert.equal(gameState.miss, 0);
        renderer.drawNotes(oldMissDeadline + 1);
        assert.equal(gameState.miss, 2);
        assert.equal(tap.missed, true);
        assert.equal(hold.missed, true);
    });
}
