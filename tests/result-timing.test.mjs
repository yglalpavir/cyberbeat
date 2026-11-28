import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const read = name => readFileSync(new URL(`../js/${name}`, import.meta.url), 'utf8');

function setupGameState() {
    const sandbox = createContext({
        CONFIG: {
            health: { initial: 100 },
            judgmentScoreMax: 900000,
            comboScoreMax: 100000,
            maxScore: 1000000
        },
        audioEngine: { musicTimeMs: () => 0 }
    });
    runInContext(read('game-state.js'), sandbox, { filename: 'game-state.js' });
    return code => runInContext(code, sandbox);
}

function setupLeaderboard(seed = {}) {
    const store = new Map(Object.entries(seed));
    const sandbox = createContext({
        localStorage: {
            getItem: key => store.has(key) ? store.get(key) : null,
            setItem: (key, value) => store.set(key, String(value)),
            removeItem: key => store.delete(key)
        },
        console: { warn() {} }
    });
    runInContext(read('leaderboard.js'), sandbox, { filename: 'leaderboard.js' });
    return {
        run: code => runInContext(code, sandbox),
        store
    };
}

function setupUI(globals = {}) {
    const sandbox = createContext({ console: { warn() {} }, ...globals });
    runInContext(read('ui.js'), sandbox, { filename: 'ui.js' });
    const raw = code => runInContext(code, sandbox);
    raw('const ui = Object.create(UIManager.prototype);');
    // vm 上下文的数组原型不同，转成宿主值再比较
    return code => {
        const value = raw(code);
        return Array.isArray(value) ? JSON.parse(JSON.stringify(value)) : value;
    };
}

test('perfect hits are excluded from early/late and timing history expires after ten seconds', () => {
    const run = setupGameState();
    assert.equal(run('gameState.recordHitTiming(-50, 0, true)'), null);
    assert.equal(run('gameState.early'), 0);
    assert.equal(run('gameState.late'), 0);

    assert.equal(run('gameState.recordHitTiming(-30, 10, false)'), 'early');
    assert.equal(run('gameState.recordHitTiming(25, 5000, false)'), 'late');
    assert.equal(run('gameState.early'), 1);
    assert.equal(run('gameState.late'), 1);
    assert.equal(run('gameState.timingCueAt.early'), 10);
    assert.equal(run('gameState.timingCueAt.late'), 5000);

    assert.equal(run('gameState.recentTimingHits(9999).length'), 3);
    // 0ms 的命中在 age >= 10000 时移除，边界不保留
    assert.equal(run('gameState.recentTimingHits(10000).length'), 2);
    assert.equal(run('gameState.recentTimingHits(10009).length'), 2);
    assert.equal(run('gameState.recentTimingHits(10010).length'), 1);
    assert.equal(run('gameState.recentTimingHits(15000).length'), 0);

    run('gameState.reset()');
    assert.equal(run('gameState.early'), 0);
    assert.equal(run('gameState.late'), 0);
    assert.equal(run('gameState.timingHits.length'), 0);
    assert.equal(run('gameState.timingCueAt.early'), -Infinity);
});

test('leaderboard persists real zeroes, keeps legacy timing unknown, and round-trips through JSON', () => {
    const { run } = setupLeaderboard();
    const base = {
        songName: 'Timing Song', chartId: 'osz-a', date: '2024-01-01T00:00:00.000Z',
        score: 900000, accuracy: 98, maxCombo: 100, perfect: 90, great: 10, miss: 0
    };

    const clean = JSON.parse(JSON.stringify(run(`leaderboard.addRecord(${JSON.stringify({ ...base, early: 0, late: 0 })})`)));
    assert.equal(clean.early, 0);
    assert.equal(clean.late, 0);

    const legacy = JSON.parse(JSON.stringify(run(`leaderboard.addRecord(${JSON.stringify(base)})`)));
    assert.equal(legacy.early, null);
    assert.equal(legacy.late, null);

    assert.equal(run('leaderboard.getAllRecords().length'), 2);
    assert.equal(run(`leaderboard.getRecords('Timing Song').find(r => r.id === '${clean.id}').early`), 0);

    // 导出 → 清空 → 导入：0 仍是 0，未知仍是 null
    const exported = run('leaderboard.exportAll()');
    run('leaderboard.clearAll()');
    assert.equal(run(`leaderboard.importData(${JSON.stringify(exported)}, 'replace').success`), true);
    assert.equal(run(`leaderboard.getRecords('Timing Song').find(r => r.id === '${clean.id}').early`), 0);
    assert.equal(run(`leaderboard.getRecords('Timing Song').find(r => r.id === '${legacy.id}').early`), null);
});

test('music library sorting supports default, title, recent, and most played in both directions', () => {
    const songs = [
        { id: 'a', title: 'Beta', artist: 'X' },
        { id: 'b', title: 'alpha', artist: 'Y' },
        { id: 'c', title: 'Gamma', artist: 'Z' }
    ];
    const records = [
        { songName: 'Beta', chartId: 'a', date: '2024-01-01T00:00:00.000Z' },
        { songName: 'Beta', chartId: 'a', date: '2024-03-01T00:00:00.000Z' },
        { songName: 'alpha', chartId: 'b', date: '2024-05-01T00:00:00.000Z' },
        // 旧记录没有 chartId：曲名唯一时才归并
        { songName: 'Gamma', date: '2024-02-01T00:00:00.000Z' }
    ];
    const run = setupUI({
        songLibrary: songs,
        leaderboard: { getAllRecords: () => records }
    });
    run('ui._songSort = "default"; ui._songOrder = "asc";');
    assert.deepEqual(run('ui._sortedSongs(songLibrary).map(s => s.id)'), ['a', 'b', 'c']);
    run('ui._songOrder = "desc"');
    assert.deepEqual(run('ui._sortedSongs(songLibrary).map(s => s.id)'), ['c', 'b', 'a']);

    run('ui._songSort = "title"; ui._songOrder = "asc"');
    assert.deepEqual(run('ui._sortedSongs(songLibrary).map(s => s.id)'), ['b', 'a', 'c']);
    run('ui._songOrder = "desc"');
    assert.deepEqual(run('ui._sortedSongs(songLibrary).map(s => s.id)'), ['c', 'a', 'b']);

    run('ui._songSort = "recent"; ui._songOrder = "desc"');
    assert.deepEqual(run('ui._sortedSongs(songLibrary).map(s => s.id)'), ['b', 'a', 'c']);
    run('ui._songOrder = "asc"');
    assert.deepEqual(run('ui._sortedSongs(songLibrary).map(s => s.id)'), ['c', 'a', 'b']);

    run('ui._songSort = "plays"; ui._songOrder = "desc"');
    assert.deepEqual(run('ui._sortedSongs(songLibrary).map(s => s.id)'), ['a', 'b', 'c']);

    // 排序只返回副本，不改变曲库顺序和原始数组
    assert.deepEqual(run('songLibrary.map(s => s.id)'), ['a', 'b', 'c']);

    // 无 chartId 且曲名重复时不猜测归属
    const ambiguous = setupUI({
        songLibrary: [...songs, { id: 'd', title: 'Beta', artist: 'W' }],
        leaderboard: { getAllRecords: () => [{ songName: 'Beta', date: '2024-03-01T00:00:00.000Z' }] }
    });
    ambiguous('ui._songSort = "plays"; ui._songOrder = "desc"');
    assert.deepEqual(ambiguous('ui._sortedSongs(songLibrary).map(s => s.id)'), ['b', 'a', 'd', 'c']);
});

test('chart groups sort by aggregated plays and latest run using stable chart IDs', () => {
    const chartSongs = [
        { id: 'a1', title: 'Song A', artist: 'X', beatmapType: 'osu' },
        { id: 'a2', title: 'Song A', artist: 'X', beatmapType: 'osu' },
        { id: 'b1', title: 'Song B', artist: 'Y', beatmapType: 'osu' }
    ];
    const records = [
        { songName: 'Song A', chartId: 'a1', date: '2024-01-01T00:00:00.000Z' },
        { songName: 'Song A', chartId: 'a2', date: '2024-04-01T00:00:00.000Z' },
        { songName: 'Song B', chartId: 'b1', date: '2024-06-01T00:00:00.000Z' },
        { songName: 'Song B', chartId: 'b1', date: '2024-02-01T00:00:00.000Z' },
        { songName: 'Song B', chartId: 'b1', date: '2024-03-01T00:00:00.000Z' }
    ];
    const run = setupUI({
        songLibrary: chartSongs,
        leaderboard: { getAllRecords: () => records }
    });
    run('ui._songSort = "plays"; ui._songOrder = "desc"');
    assert.deepEqual(run('ui._sortedChartGroups(ui._getChartGroups()).map(g => g.title)'), ['Song B', 'Song A']);
    run('ui._songSort = "recent"; ui._songOrder = "desc"');
    assert.deepEqual(run('ui._sortedChartGroups(ui._getChartGroups()).map(g => g.title)'), ['Song B', 'Song A']);
    run('ui._songSort = "default"; ui._songOrder = "desc"');
    assert.deepEqual(run('ui._sortedChartGroups(ui._getChartGroups()).map(g => g.title)'), ['Song B', 'Song A']);
});

test('early/late split renders proportions, unknown records, and ticket summaries honestly', () => {
    const run = setupUI();

    const known = run('ui._timingSplitHtml(3, 1)');
    assert.match(known, /EARLY <b>3<\/b>/);
    assert.match(known, /LATE <b>1<\/b>/);
    assert.match(known, /--fill:37\.50%/);
    assert.match(known, /--fill:12\.50%/);
    assert.doesNotMatch(known, /NOT RECORDED/);

    const zero = run('ui._timingSplitHtml(0, 0)');
    assert.match(zero, /EARLY <b>0<\/b>/);
    assert.match(zero, /LATE <b>0<\/b>/);
    assert.doesNotMatch(zero, /NOT RECORDED/);

    const legacy = run('ui._timingSplitHtml(null, null)');
    assert.match(legacy, /EARLY <b>—<\/b>/);
    assert.match(legacy, /LATE <b>—<\/b>/);
    assert.match(legacy, /NOT RECORDED/);

    assert.equal(run('ui._timingTicketCounts({ early: 2, late: 5 })'), ' · <i class="tc-early">E 2</i> · <i class="tc-late">L 5</i>');
    assert.equal(run('ui._timingTicketCounts({ early: 0, late: 0 })'), ' · <i class="tc-early">E 0</i> · <i class="tc-late">L 0</i>');
    assert.equal(run('ui._timingTicketCounts({})'), '');
});

test('sort category picks a natural direction and persists the choice', () => {
    const saved = new Map();
    const run = setupUI({
        settingsStore: {
            get: key => saved.get(key),
            set: (key, value) => saved.set(key, value)
        }
    });
    run('ui._syncSortControls = () => {}; ui.renderSongList = () => {}; ui._setSongSort("recent")');
    assert.equal(run('ui._songOrder'), 'desc');
    assert.equal(saved.get('songSort'), 'recent');
    assert.equal(saved.get('songOrder'), 'desc');

    run('ui._setSongOrder("asc")');
    assert.equal(saved.get('songOrder'), 'asc');
    assert.equal(saved.get('songSort'), 'recent');

    run('ui._setSongSort("title")');
    assert.equal(run('ui._songOrder'), 'asc');
});
