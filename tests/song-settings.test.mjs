import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const script = readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');

function setup(globals = {}) {
    const sandbox = createContext(globals);
    runInContext(script, sandbox);
    const run = source => runInContext(source, sandbox);
    run('const ui = Object.create(UIManager.prototype);');
    return run;
}

test('best score requires an exact chart ID and ignores failed and legacy runs', () => {
    const run = setup({ leaderboard: { getPlayerName: () => 'Local', getRecords: () => [
        { score: 1000000, chartId: 'normal', playerName: 'Another player' },
        { score: 995000, chartId: 'extra' },
        { score: 990000, chartId: 'normal', isFailed: true },
        { score: 980000, chartId: 'normal', rank: 'F' },
        { score: 975000 },
        { score: 930000, chartId: 'normal' },
        { score: '940000', chartId: 'normal', isFailed: false, rank: 'S' }
    ] } });
    assert.equal(run("ui._getPreviousBestScore('normal', 'Song')"), 940000);
    assert.equal(run("ui._getPreviousBestScore('hard', 'Song')"), null);
    assert.equal(run("ui._getPreviousBestScore(null, 'Song')"), null);
});

test('local charts with the same name but different note timings have separate IDs', () => {
    const chart = { notes: [{ type: 'tap', track: 1, time: 1000 }] };
    const run = setup({ selectedSongSource: 'import', getLoadedChartData: () => chart });
    const id = run('ui._recordChartId()');
    assert.equal(run('ui._recordChartId()'), id);
    chart.notes[0].time = 1001;
    assert.notEqual(run('ui._recordChartId()'), id);
});

test('a renamed local chart still finds its existing best score', () => {
    const run = setup({ leaderboard: {
        getPlayerName: () => 'Local',
        getAllSongSummaries: () => [{ songName: 'Old filename' }],
        getRecords: name => name === 'Old filename' ? [{ chartId: 'local:fixed:1:a', score: 970000 }] : []
    } });
    assert.equal(run("ui._getPreviousBestScore('local:fixed:1:a', 'New filename')"), 970000);
});

test('imports cannot change the selected song from settings or during game startup', () => {
    const run = setup({ gameState: { screen: 'start' } });
    run(`let hidden = false; ui.startScreen = { classList: { contains: () => hidden } };`);
    assert.equal(run('ui._canImportSong()'), true);
    assert.equal(run('hidden = true; ui._canImportSong()'), false);
    assert.equal(run('hidden = false; ui._startingGame = true; ui._canImportSong()'), false);
    assert.equal(run('ui._startingGame = false; ui._importBusy = true; ui._canImportSong()'), false);
});

test('failed chart switch keeps the previous chart playable', async () => {
    const previous = { id: 'old', title: 'Song', beatmapType: 'osu' };
    const next = { ...previous, id: 'new' };
    const run = setup({ previous, next });
    await run(`
        let selectedLibrarySong = previous, loadedMcData = null, loadedMidiData = null;
        let loadedOsuData = { notes: [1] };
        const getLoadedChartData = () => loadedMcData || loadedOsuData;
        ui.settingsStartBtn = {};
        ui.chartDifficultySelector = { querySelectorAll: () => [] };
        ui.selectLibrarySong = song => { selectedLibrarySong = song; loadedOsuData = null; };
        ui.handleStartOrConfig = async () => {}; // network failure leaves no loaded chart
        ui.showSettings = mode => { ui.shownMode = mode; };
        ui._preloadSongAudio = song => { ui.preloaded = song; };
        ui._selectChartVariant(next);
    `);
    assert.equal(run('selectedLibrarySong'), previous);
    assert.equal(run('getLoadedChartData().notes.length'), 1);
    assert.equal(run('ui.settingsStartBtn.disabled'), false);
    assert.equal(run('ui.preloaded'), previous);
});

test('changing MIDI difficulty updates the song summary and preserves the legacy default', () => {
    const saved = new Map([['difficulty', 'normal+']]);
    const run = setup({
        settingsStore: { set: (key, value) => saved.set(key, value) },
        document: { querySelectorAll: () => [], querySelector: () => null }
    });
    run(`
        let selectedDifficulty = 'normal+', loadedMidiData = {};
        let selectedSongSource = 'library', selectedLibrarySong = { id: 'm1', difficulties: [
            { key: 'normal+', name: 'NORMAL+', level: 20 }, { key: 'normal', name: 'NORMAL', level: 7 }
        ] };
        ui._settingsMode = 'song'; ui._savedMidiDifficulties = {}; ui.songChartName = {}; ui.songChartLevel = {};
        ui.setDifficulty('normal');
    `);
    assert.equal(run('ui.songChartName.textContent'), 'NORMAL');
    assert.equal(run('ui.songChartLevel.textContent'), 'LV.7');
    assert.equal(saved.get('midiDifficulties').m1, 'normal');
    assert.equal(saved.get('difficulty'), 'normal+');
});

test('calibration reports a signed suggestion, rejects outliers, and requires Apply', () => {
    const run = setup();
    run(`ui.calibrationApply = {}; ui.calibrationPadSub = {}; ui.calibrationStatus = { dataset: {} };
        ui.setAudioOffset = value => { ui.applied = value; };
        ui._calibration = { samples: [-44, -42, -41, -40, -39, -38, -38, -37, 155, -201], oscillators: [] };
        ui._finishCalibration();`);
    assert.equal(run('ui._calSuggestion'), -40);
    assert.equal(run('ui.applied'), undefined);
    assert.equal(run('ui.calibrationApply.disabled'), false);
    run('ui._applyCalibrationSuggestion()');
    assert.equal(run('ui.applied'), -40);
    assert.equal(run('ui.calibrationApply.disabled'), true);
    run(`ui._calibration = { samples: [-180, -170, -160, -150, -140, 140, 150, 160, 170, 180], oscillators: [] };
         ui._finishCalibration();`);
    assert.equal(run('ui.calibrationApply.disabled'), true);
    assert.equal(run('ui.calibrationStatus.dataset.tone'), 'warn');
});
