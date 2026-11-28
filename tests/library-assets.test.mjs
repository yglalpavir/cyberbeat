import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const menu = JSON.parse(readFileSync(path.join(root, 'assets/songs/menu.json'), 'utf8'));
const imported = menu.songs.filter(song => /^(?:osz|mcz)-/.test(song.id));
const parsers = createContext({ console: { log() {}, warn() {} } });
for (const name of ['osu-parser.js', 'mc-parser.js', 'difficulty.js']) {
    runInContext(readFileSync(path.join(root, 'js', name), 'utf8'), parsers, { filename: name });
}

function asHost(value) {
    return JSON.parse(JSON.stringify(value));
}

test('all imported catalog entries have unique IDs and extant chart/audio paths', () => {
    assert.equal(imported.length, 114);
    assert.equal(new Set(imported.map(song => song.id)).size, imported.length);

    // 「Stream Regular-5/7」已按需求下架：目录与资源都不应再引用它们
    const titles = menu.songs.map(song => song.title);
    assert.equal(titles.includes('Stream Regular-5'), false);
    assert.equal(titles.includes('Stream Regular-7'), false);

    for (const song of imported) {
        assert.ok(song.title && song.artist && song.creator && song.version && song.origin, song.id);
        const chartPath = song.beatmapType === 'osu'
            ? path.join(root, 'assets/osu', song.folder, song.file)
            : path.join(root, 'assets/songs', song.beatmap);
        const audioPath = song.beatmapType === 'osu'
            ? path.join(root, 'assets/osu', song.folder, song.audio)
            : path.join(root, 'assets/mc_audio', song.audio);
        assert.ok(existsSync(chartPath), `missing chart for ${song.id}: ${chartPath}`);
        assert.ok(existsSync(audioPath), `missing audio for ${song.id}: ${audioPath}`);
    }
});

test('all imported charts parse as playable 4K and retain catalog metadata/audio pairing', () => {
    const counts = { osu: 0, mc: 0 };
    const computedLevels = {};
    for (const song of imported) {
        let chart;
        if (song.beatmapType === 'osu') {
            counts.osu++;
            const file = path.join(root, 'assets/osu', song.folder, song.file);
            const text = readFileSync(file, 'utf8');
            const parsed = asHost(runInContext(`new OsuParser(${JSON.stringify(text)}).parse()`, parsers));
            chart = parsed;
            assert.equal(parsed.meta.column, 4, song.id);
            assert.ok(parsed.notes.length > 0, song.id);
            assert.equal(parsed.meta.audioFile, song.audio, song.id);
            assert.equal(parsed.meta.artist, song.artist, song.id);
            assert.equal(parsed.meta.creator, song.creator, song.id);
            assert.equal(parsed.meta.version, song.version, song.id);
        } else {
            counts.mc++;
            const file = path.join(root, 'assets/songs', song.beatmap);
            const data = JSON.parse(readFileSync(file, 'utf8'));
            const parsed = asHost(runInContext(`new McParser(${JSON.stringify(data)}).parse()`, parsers));
            chart = parsed;
            assert.equal(parsed.meta.column, 4, song.id);
            assert.ok(parsed.notes.length > 0, song.id);
            assert.equal(parsed.meta.version, song.version, song.id);
            assert.equal(parsed.meta.creator, song.creator, song.id);
            assert.ok(parsed.meta.audioOffset >= 0, song.id);
            const sound = data.note.find(note => note.type === 1 && typeof note.sound === 'string');
            assert.ok(sound, `missing Malody audio reference for ${song.id}`);
            const soundStem = path.basename(sound.sound, path.extname(sound.sound)).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
            assert.equal(path.basename(song.audio, path.extname(song.audio)), soundStem, song.id);
        }
        computedLevels[song.id] = asHost(runInContext(`new DifficultyCalculator(${JSON.stringify(chart.notes)}).calculate()`, parsers));
        assert.equal(song.title, chart.meta.title, `${song.id} must keep the chart's original title`);
        assert.equal(song.level, computedLevels[song.id].level, `${song.id} computed level`);
        assert.ok(song.difficultyName, `${song.id} must retain chart difficulty metadata`);
    }
    for (const title of new Set(imported.map(song => song.title))) {
        const sameTitle = imported.filter(song => song.title === title);
        if (sameTitle.length > 1) {
            assert.equal(new Set(sameTitle.map(song => song.difficultyName)).size, sameTitle.length,
                `duplicate chart title ${title} needs distinct difficulty metadata`);
        }
    }
    assert.deepEqual(counts, { osu: 95, mc: 19 });
});

test('the three MiniJack packs are merged into one chart set ordered by level', () => {
    const mini = menu.songs.filter(song => song.id.startsWith('mcz-140-minijack-practice-'));
    assert.equal(mini.length, 5, 'all five MiniJack charts stay in the catalog');
    assert.equal(new Set(mini.map(song => song.title)).size, 1, 'one shared song title groups them');
    assert.equal(mini[0].title, '140 MiniJack Practice');
    assert.equal(new Set(mini.map(song => song.difficultyName)).size, 5,
        'each chart keeps its own difficulty name');
    // 卡片上的等级区间按从低到高呈现
    const levels = mini.map(song => song.level).sort((a, b) => a - b);
    assert.deepEqual(levels, [19, 22, 22, 23, 24]);
});
