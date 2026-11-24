/* read-rows.test.mjs — the last-report row reader: cell shapes, matching, errors, drops, digest, age. Fixtures only. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tablesOf, rowLines, listLines, dropLines, digestLines, noteLines, ageLine, resolveCols } from '../lib/render/last-report-rows.mjs';

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const rep = (mode, rows) => ({ sections: [{ type: 'lines', lines: [`## ${mode} — x`] }, { type: 'table', headers: ['Item', 'Grade', 'Est. buy', 'Est. sell'], rows }] });
const cell = t => ({ t, c: 'x' });
const payload = {
  kind: 'screen', generatedAt: new Date(Date.now() - 4 * 60000).toISOString(),
  reports: [
    { ...rep('BAND', [[cell('Dragon claws'), cell('B'), '1m', cell('2m')], [cell('Zaryte vambraces'), cell('A-'), cell('81m'), cell('85m')]]),
      drops: { reject: 3, rejectReasons: { 'too thin': 2, 'elevated': 1 }, skippedUnprofitable: ['Rune ore'], winnersFiltered: [{ name: 'Coal', net: -6 }], crowdedOut: { count: 9, bestName: 'Elder maul', bestGpDay: '4.9m', reason: 'full' } } },
    rep('CHURN', [[cell('Dragon claws'), cell('S'), '3m', '4m']]),
  ],
};
const T = tablesOf(payload);

ok('modes come from the heading, cells may be strings or {t}', () => {
  assert.deepEqual(T.map(t => t.mode), ['band', 'churn']);
  assert.equal(T[0].rows[0][2], '1m');
});
ok('item filter is case-insensitive substring and several are OR', () => {
  assert.equal(rowLines(T, { items: ['ZARYTE', 'claws'] }).lines.filter(l => !l.startsWith('#')).length, 3);
});
ok('mode and cols and limit narrow the output', () => {
  assert.deepEqual(rowLines(T, { mode: 'band', cols: ['grade', 'est. sell'], limit: 1 }).lines, ['# band (1 of 2 rows)', 'Dragon claws | Grade=B | Est. sell=2m']);
});
ok('an unknown column, mode or item errors and names what exists', () => {
  assert.match(rowLines(T, { cols: ['nope'] }).error, /unknown column nope.*available: Item, Grade/);
  assert.match(rowLines(T, { mode: 'value' }).error, /available: band, churn/);
  assert.match(rowLines(T, { items: ['zzz'] }).error, /no row matches "zzz".*Dragon claws/);
});
ok('an ambiguous column substring is refused', () => { assert.deepEqual(resolveCols(['Est. buy', 'Est. sell'], ['est.']).bad, ['est.']); });
ok('the item column is the one headed Item, else the first', () => {
  const w = [{ mode: 'w', headers: ['Verdict', 'Item'], rows: [['CUT', 'Coal']] }, { mode: 'q', headers: ['Name', 'V'], rows: [['Ash', '1']] }];
  assert.equal(rowLines(w, { items: ['coal'] }).lines[1], 'Coal | Verdict=CUT');
  assert.equal(rowLines(w, { items: ['ash'] }).lines[1], 'Ash | V=1');
});
ok('list reports tables, drops and a missing digest', () => {
  const l = listLines(payload).join('\n');
  assert.match(l, /band: 2 rows/); assert.match(l, /drops: present/); assert.match(l, /digestRows: absent/);
});
ok('drops prints reasons by count, names, and the crowded-out line', () => {
  const d = dropLines(payload).join('\n');
  assert.match(d, /2x too thin/); assert.match(d, /winnerFiltered: Coal net -6/); assert.match(d, /crowdedOut: 9 never fetched \| best Elder maul 4\.9m\/d/);
});
ok('digest says so when absent; prints rows with nulls when present; filters by item and mode', () => {
  assert.match(digestLines(payload).error, /no digestRows/);
  const p = { ...payload, digestRows: [{ itemId: 1, name: 'Dragon claws', mode: 'band', grade: 'B', bid: 10, ask: null }, { itemId: 2, name: 'Coal', mode: 'churn', grade: 'S', bid: 1, ask: 2 }] };
  assert.deepEqual(digestLines(p, { items: ['claw'] }).lines, ['Dragon claws | itemId=1 | mode=band | grade=B | bid=10 | ask=—']);
  assert.equal(digestLines(p, { mode: 'churn' }).lines.length, 1);
  assert.match(digestLines(p, { cols: ['x'] }).error, /unknown column x/);
});
ok('age line flags stale past 30 minutes and a missing stamp', () => {
  const now = Date.parse('2026-01-01T01:00:00Z');
  assert.equal(ageLine('screen', '2026-01-01T00:56:00Z', now), 'screen 4m old');
  assert.match(ageLine('screen', '2026-01-01T00:00:00Z', now), /60m old - STALE/);
  assert.match(ageLine('screen', undefined, now), /age unknown/);
});
ok('markdown tables in lines sections are indexed and notes follow the item', () => {
  const md = { kind: 'screen', reports: [
    { sections: [{ type: 'lines', lines: ['## AMPLITUDE — 1', '| Item | Live |', '| --- | --- |', '| Coal | 5 |'] }, { type: 'lines', lines: ['  ↳ Coal — base p10', 'unrelated'] }] },
    { sections: [{ type: 'lines', lines: ['## WATCHLIST — 1', '| Item | Note |', '| --- | --- |', '| Ash | x |'] }] },
    { sections: [{ type: 'notes', items: [{ kind: 'regime', itemId: 7, text: '- Gem: flat' }, '  trajectory', { kind: 'dwell', itemId: 7, text: 'dwell: x' }, { kind: 'regime', itemId: 8, text: '- Rune: up' }, '  rune detail'] }] },
  ] };
  assert.deepEqual(tablesOf(md).map(t => t.mode), ['amplitude', 'watchlist']);
  assert.equal(rowLines(tablesOf(md), { items: ['coal'], mode: 'amplitude' }).lines[1], 'Coal | Live=5');
  assert.deepEqual(noteLines(md, { items: ['coal'] }), ['note: ↳ Coal — base p10']);
  assert.deepEqual(noteLines(md, { items: ['gem'] }).length, 3);
  assert.deepEqual(noteLines(md, { items: ['rune'] }), ['note: - Rune: up', 'note: rune detail']);
});
ok('drops --item names the rejected item with its reason', () => {
  const p2 = { reports: [{ sections: [{ type: 'lines', lines: ['## BAND — x'] }], drops: { reject: 1, rejected: [{ itemId: 1, name: 'Coal', reason: 'too thin' }] } }] };
  assert.deepEqual(dropLines(p2, { items: ['coal'] }), ['band: Coal REJECTED - too thin']);
  assert.match(dropLines(p2, { items: ['zzz'] })[0], /no drop record names "zzz"/);
});
ok('the command prints age first, exits 1 on no match and on a missing report', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-'));
  fs.writeFileSync(path.join(dir, 'screen.json'), JSON.stringify(payload));
  const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'commands', 'read-rows.mjs');
  const run = (...a) => spawnSync(process.execPath, [bin, '--dir', dir, ...a], { encoding: 'utf8' });
  const a = run('--item', 'zaryte', '--mode', 'band');
  assert.equal(a.status, 0);
  assert.match(a.stdout.split('\n')[0], /^screen 4m old$/);
  assert.match(a.stdout, /Zaryte vambraces \| Grade=A-/);
  assert.equal(run('--item', 'zzz').status, 1);
  assert.equal(run('quote').status, 1);
  fs.rmSync(dir, { recursive: true });
});
console.log(`\n${n} read-rows assertions passed.`);
