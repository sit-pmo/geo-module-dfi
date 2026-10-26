// Tests de la logique du module : node test/dfi-data.test.mjs
import assert from 'node:assert/strict';
import {
    SUPPORTED_FORMAT, DfiError, parseIdu, parcelKey, splitKey, parcelLabel, formatDate, dataUrl, loadJson,
    checkIndex, loadIndex, loadCommune, buildLookup, describeLot, buildGraph, parcelSummary, layoutGraph
} from '../src/js/dfi-data.js';

let failures = 0;
async function test(name, fn) {
    try { await fn(); console.log('  ok  ' + name); }
    catch (e) { failures++; console.error('  ÉCHEC  ' + name + '\n    ' + (e && e.stack || e)); }
}

// Filiation d'essai : AH 65 + AH 72 -> (lot 0) -> AH 261 -> (lot 1) -> AH 264 -> (lot 2) -> AH 280, AH 281
const LOTS = [
    ['0000100', '00001', 1, '1990-03-01', ['AH0065', 'AH0072'], ['AH0261']],
    ['0000200', '00001', 7, '2001-05-10', ['AH0261'], ['AH0264', 'AH0300']],
    ['0001294', '00001', 7, '2008-01-28', ['AH0264'], ['AH0280', 'AH0281']],
    ['0000300', '00001', 2, '2010-01-05', ['AH0500'], []],                       // disparition
    ['0000400', '00001', 4, '2012-02-02', [], ['AH0600']]                       // création
];
const lookup = buildLookup({ insee: '38544', lots: LOTS });

await test('parseIdu : découpe, majuscules, espaces', () => {
    const p = parseIdu(' 38544000bi0498 ');
    assert.deepEqual([p.insee, p.commune, p.prefix, p.section, p.number, p.key], ['38544', '544', '000', 'BI', '0498', 'BI0498']);
    assert.equal(parseIdu('38544014AH0001').key, '014AH0001');
    assert.equal(parseIdu('2A004000AB0001').insee, '2A004');
});
await test('parseIdu : refuse ce qui n\'est pas un IDU', () => {
    for (const bad of ['', null, undefined, '38544000BI498', '3854400BI0498', 'abc', '38544000BI04980']) {
        assert.equal(parseIdu(bad), null, String(bad));
    }
});
await test('clés, libellés et dates', () => {
    assert.equal(parcelKey('000', 'AH', '0280'), 'AH0280');
    assert.equal(parcelKey('014', 'AH', '0280'), '014AH0280');
    assert.deepEqual(splitKey('014AH0280', '38544'), { insee: '38544', prefix: '014', section: 'AH', number: '0280', idu: '38544014AH0280', key: '014AH0280' });
    assert.equal(splitKey('0C0637', '38544').idu, '385440000C0637');
    assert.equal(parcelLabel('AH0280'), 'AH 280');
    assert.equal(parcelLabel('0C0637'), 'C 637');
    assert.equal(parcelLabel('014AH0001'), '014 AH 1');
    assert.equal(parcelLabel('AH0000'), 'AH 0');
    assert.equal(formatDate('2008-01-28'), '28/01/2008');
    assert.equal(formatDate(''), '');
    assert.equal(dataUrl('https://exemple.fr/d/', 'index.json'), 'https://exemple.fr/d/index.json');
});
await test('checkIndex : format et structure', () => {
    assert.throws(() => checkIndex(null), (e) => e.code === 'index');
    assert.throws(() => checkIndex({ format: 1 }), (e) => e.code === 'index');
    assert.throws(() => checkIndex({ format: 2, communes: {} }), (e) => e instanceof DfiError && e.code === 'format' && /mettre le module à jour/.test(e.message));
    const ok = { format: SUPPORTED_FORMAT, communes: {} };
    assert.equal(checkIndex(ok), ok);
});

const response = (status, body) => ({ status, ok: status >= 200 && status < 300, json: () => body === undefined ? Promise.reject(new Error('x')) : Promise.resolve(body) });
await test('loadJson : réussite, 404, erreur HTTP, JSON illisible, réseau', async () => {
    assert.deepEqual(await loadJson(() => Promise.resolve(response(200, { a: 1 })), 'u'), { a: 1 });
    await assert.rejects(loadJson(() => Promise.resolve(response(404, {})), 'u'), (e) => e.code === 'notfound');
    await assert.rejects(loadJson(() => Promise.resolve(response(500, {})), 'u'), (e) => e.code === 'http');
    await assert.rejects(loadJson(() => Promise.resolve(response(200, undefined)), 'u'), (e) => e.code === 'json');
    await assert.rejects(loadJson(() => Promise.reject(new TypeError('Failed to fetch')), 'u'), (e) => e.code === 'network');
});
await test('loadJson : n\'envoie aucune identification', async () => {
    let options;
    await loadJson((url, o) => { options = o; return Promise.resolve(response(200, {})); }, 'u');
    assert.equal(options.credentials, 'omit');
});
await test('loadIndex et loadCommune', async () => {
    const calls = [];
    const fetchFn = (url) => { calls.push(url); return Promise.resolve(response(200, url.endsWith('index.json')
        ? { format: 1, communes: { 38544: { lots: 5 } } } : { insee: '38544', lots: LOTS })); };
    const index = await loadIndex(fetchFn, 'https://exemple.fr/d/');
    const data = await loadCommune(fetchFn, 'https://exemple.fr/d/', index, '38544');
    assert.equal(data.lots.length, 5);
    assert.deepEqual(calls, ['https://exemple.fr/d/index.json', 'https://exemple.fr/d/38544.json']);
    await assert.rejects(loadCommune(fetchFn, 'https://exemple.fr/d/', index, '38999'), (e) => e.code === 'commune');
    assert.equal(calls.length, 2); // commune absente : aucune requête inutile
    await assert.rejects(loadCommune(() => Promise.resolve(response(200, { lots: 'x' })), 'b', index, '38544'), (e) => e.code === 'json');
});
await test('describeLot : type d\'opération', () => {
    const kinds = LOTS.map((l) => describeLot(l).kind);
    assert.deepEqual(kinds, ['Réunion', 'Division', 'Division', 'Disparition', 'Création']);
    assert.equal(describeLot(['1', '00001', 5, '2020-01-02', ['A'], ['B']]).kind, 'Changement de numérotation');
    assert.equal(describeLot(['1', '00001', 5, '2020-01-02', ['A', 'B'], ['C', 'D']]).kind, 'Réorganisation');
    const d = describeLot(LOTS[2]);
    assert.deepEqual([d.natureLabel, d.dateLabel, d.dfi], ['Lotissement', '28/01/2008', '0001294']);
    assert.equal(describeLot(['1', '00001', 9, '2020-01-02', [], []]).natureLabel, 'Nature 9');
});

const byId = (g) => Object.fromEntries(g.nodes.map((n) => [n.id, n]));
await test('buildGraph : ancêtres, descendants et niveaux', () => {
    const g = buildGraph(lookup, 'AH0264');
    const n = byId(g);
    assert.equal(n['p:AH0264'].level, 0);
    assert.equal(n['p:AH0261'].level, -1);
    assert.equal(n['p:AH0065'].level, -2);
    assert.equal(n['p:AH0072'].level, -2);
    assert.equal(n['l:0'].level, -1.5);
    assert.equal(n['l:1'].level, -0.5);
    assert.equal(n['l:2'].level, 0.5);
    assert.equal(n['p:AH0280'].level, 1);
    assert.equal(n['p:AH0281'].level, 1);
    assert.equal(n['p:AH0300'].level, 0, 'sœur de la parcelle cherchée : même niveau, non explorée');
    assert.equal(n['p:AH0300'].explored, false);
    assert.ok(g.edges.some((e) => e.from === 'p:AH0261' && e.to === 'l:1'));
    assert.ok(g.edges.some((e) => e.from === 'l:1' && e.to === 'p:AH0264'));
    assert.ok(g.edges.some((e) => e.from === 'l:1' && e.to === 'p:AH0300'));
    assert.equal(g.hasHistory, true);
    assert.equal(g.truncated, false);
    assert.ok(!n['l:3'] && !n['l:4'], 'lots sans rapport absents');
});
await test('buildGraph : parcelle sans historique', () => {
    const g = buildGraph(lookup, 'ZZ0001');
    assert.equal(g.nodes.length, 1);
    assert.equal(g.hasHistory, false);
});
await test('buildGraph : parcelle créée et parcelle disparue', () => {
    const created = buildGraph(lookup, 'AH0600');
    assert.deepEqual(created.nodes.map((n) => n.id).sort(), ['l:4', 'p:AH0600']);
    const gone = buildGraph(lookup, 'AH0500');
    assert.deepEqual(gone.nodes.map((n) => n.id).sort(), ['l:3', 'p:AH0500']);
});
await test('buildGraph : cas pathologiques (parcelle mère et fille d\'un même lot, cycle) : le calcul se termine', () => {
    // Absent des départements 38 et 69 (0 lot sur 674 787) : on garantit seulement la terminaison et l'absence de doublon.
    const loop = buildLookup({ lots: [
        ['1', '00001', 1, '2000-01-01', ['AB0001'], ['AB0001', 'AB0002']],
        ['2', '00001', 1, '2001-01-01', ['AB0002'], ['AB0003']]
    ] });
    const g = buildGraph(loop, 'AB0001');
    const ids = g.nodes.map((n) => n.id);
    assert.equal(new Set(ids).size, ids.length, 'doublon');
    assert.ok(ids.includes('l:0') && ids.includes('p:AB0001') && ids.includes('p:AB0002'));
    const cycle = buildLookup({ lots: [
        ['1', '00001', 1, '2000-01-01', ['AB0001'], ['AB0002']],
        ['2', '00001', 1, '2001-01-01', ['AB0002'], ['AB0001']]
    ] });
    assert.ok(buildGraph(cycle, 'AB0001').nodes.length <= 4);   // se termine
});
await test('buildGraph : limites (nœuds, sœurs masquées)', () => {
    const many = Array.from({ length: 30 }, (_, i) => 'AB' + String(i + 10).padStart(4, '0'));
    const big = buildLookup({ lots: [['1', '00001', 4, '2000-01-01', ['AB0001'], many]] });
    const g = buildGraph(big, 'AB0001', { maxNodes: 1000 });
    assert.equal(g.nodes.filter((n) => n.type === 'parcel').length, 1 + 30, 'toutes les filles sont des descendants');
    const fromDaughter = buildGraph(big, many[0]);
    const lot = fromDaughter.nodes.find((n) => n.type === 'lot');
    assert.equal(lot.hidden, 21, '29 sœurs : 8 montrées, 21 masquées');
    const tiny = buildGraph(big, 'AB0001', { maxNodes: 5 });
    assert.equal(tiny.nodes.length, 5);
    assert.equal(tiny.truncated, true);
});
await test('parcelSummary', () => {
    const s = parcelSummary(lookup, 'AH0264');
    assert.deepEqual(s.origin.map((l) => l.dfi), ['0000200']);
    assert.deepEqual(s.future.map((l) => l.dfi), ['0001294']);
    assert.deepEqual(parcelSummary(lookup, 'AH0280').future, []);
});
await test('layoutGraph : lignes par niveau, pas de chevauchement', () => {
    const g = buildGraph(lookup, 'AH0264');
    const labelOf = (n) => n.type === 'parcel' ? 'P ' + n.key : 'L ' + n.index;
    const l = layoutGraph(g, labelOf);
    assert.ok(Number.isFinite(l.width) && Number.isFinite(l.height) && l.width > 0 && l.height > 0);
    const n = byId(g);
    assert.ok(n['p:AH0065'].y < n['p:AH0261'].y && n['p:AH0261'].y < n['p:AH0264'].y && n['p:AH0264'].y < n['p:AH0280'].y);
    const rows = {};
    g.nodes.forEach((x) => { (rows[x.y] = rows[x.y] || []).push(x); });
    Object.values(rows).forEach((row) => {
        row.sort((a, b) => a.x - b.x);
        for (let i = 1; i < row.length; i++) { assert.ok(row[i].x >= row[i - 1].x + row[i - 1].w, 'chevauchement'); }
    });
    g.nodes.forEach((x) => { assert.ok(x.x >= 0 && x.x + x.w <= l.width && x.y + x.h <= l.height); });
    assert.equal(l.paths.length, g.edges.length);
    assert.ok(l.paths.every((p) => /^M[\d.]+,[\d.]+ C/.test(p.d)));
});
await test('layoutGraph : un seul nœud', () => {
    const l = layoutGraph(buildGraph(lookup, 'ZZ0001'), () => 'ZZ 1');
    assert.equal(l.nodes.length, 1);
    assert.equal(l.paths.length, 0);
});

if (failures) { console.error('\n' + failures + ' test(s) en échec'); process.exit(1); }
console.log('\nTous les tests de la logique passent.');
