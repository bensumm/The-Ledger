/** digest-extras.test.mjs — the lines under the scan digest and the numeric rows behind them. PURE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sizeTranche } from '../lib/capital/book-model.mjs';
import { buildDigestRows, sizeDigestRow, sizeLine, digestDiffLine, readDigestPrev, writeDigestPrev, nicheLine, coverageLine } from '../lib/render/digest-extras.mjs';
import { selectDigestRows, buildDigestBlock } from '../commands/screen-flip-niches.mjs';
import { digestReachAndPlacement } from '../lib/signal/digest.mjs';

const R = { id: 1, name: 'X', nicheKey: 'band', grade: 'A', verdict: 'fill-now', bid: 1000, ask: 1100, netEach: 78, be: 1021,
  reachHit: 2, reachDays: 3, reachBasis: 'recent', limit: 100, volDay: 1e6, deployUnits: 250 };

test('digestRows: numeric, and null where unknown', () => {
  const [d] = buildDigestRows([R], { prevOf: () => 'mirage top' });
  assert.deepEqual(d, { itemId: 1, name: 'X', mode: 'band', grade: 'A', verdict: 'fill-now', bid: 1000, ask: 1100, netEach: 78, roi: 7.8,
    be: 1021, reachHit: 2, reachDays: 3, reachBasis: 'recent', limit: 100, units: null, gp: null, windows: null, bound: null, prev: 'mirage top' });
  const [n] = buildDigestRows([{ id: 2, name: 'Y' }]);
  for (const k of ['bid', 'ask', 'netEach', 'roi', 'be', 'reachHit', 'reachDays', 'limit', 'units', 'gp', 'windows', 'bound', 'prev']) assert.equal(n[k], null, k);
});

test('selectDigestRows is exactly the set buildDigestBlock renders', () => {
  const pool = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: `item${i + 1}`, rank: 100 - i, bigTicket: i > 9 }));
  const { main, bigExtra } = selectDigestRows(pool);
  assert.equal(main.length, 8);
  assert.deepEqual(bigExtra.map(r => r.id), [11, 12]);
  const block = buildDigestBlock(pool);
  for (const r of pool) assert.equal(block.includes(`| ${r.name} |`), main.includes(r) || bigExtra.includes(r), r.name);
});

test('reach counts follow the basis the fraction was read on', () => {
  const his = [10, 20, 30, 40], row = { optSell: 35, quickBuy: 25 }, spec = { fillShape: 'asym' };
  const recent = digestReachAndPlacement({ spec, row, his, askReachExtra: { reachedDays: 4, nDays: 14, recentHit: 1, recentDays: 3 } });
  assert.deepEqual([recent.reachHit, recent.reachDays], [1, 3]);
  const full = digestReachAndPlacement({ spec, row, his, askReachExtra: { reachedDays: 4, nDays: 14 } });
  assert.deepEqual([full.reachHit, full.reachDays], [4, 14]);
  const guarded = digestReachAndPlacement({ spec, row: { ...row, quickStale: { sell: true } }, his });
  assert.deepEqual([guarded.reachHit, guarded.reachDays], [2, 4]);
  const none = digestReachAndPlacement({ spec: { fillShape: 'symmetric' }, row: { optSell: 20 }, his });
  assert.deepEqual([none.reachHit, none.reachDays], [null, null]);
});

const size = (over, opts = {}) => sizeDigestRow({ ...R, ...over }, { capital: 1e9, ...opts });
test('size: the smallest of limit, clearability and capital binds', () => {
  assert.deepEqual(size({}), { units: 100, gp: 100_000, windows: 3, bound: 'buy-limit' });
  assert.deepEqual(size({ volDay: 8000 }), { units: 40, gp: 40_000, windows: 7, bound: 'clearability' });
  assert.deepEqual(size({}, { capital: 30_500 }), { units: 30, gp: 30_000, windows: 9, bound: 'capital' });
  assert.equal(size({ volDay: 8000 }).units, sizeTranche({ capital: 1e9, unitCost: 1000, limitRemaining: 100, dailyVol: 8000 }).recommendedQty);
});
test('size: what was bought in the window comes off this window only', () => {
  assert.deepEqual(size({}, { bought: 70 }), { units: 30, gp: 30_000, windows: 4, bound: 'buy-limit' });
  assert.deepEqual(size({}, { bought: 100 }), { units: 0, gp: 0, windows: 3, bound: 'buy-limit' });
});
test('size: thin, capital-less and unknown inputs never invent a size', () => {
  assert.deepEqual(size({ volDay: 113 }), { units: 0, gp: 0, windows: null, bound: 'clearability' });
  assert.deepEqual(size({}, { capital: 0 }), { units: 0, gp: 0, windows: null, bound: 'capital' });
  assert.deepEqual(size({ bid: null }), { units: null, gp: null, windows: null, bound: null });
  assert.equal(size({ deployUnits: 0.4 }).windows, null);
  assert.equal(size({ deployUnits: 100 }).windows, 1);
});
test('size line: null limit prints limit unknown; the label separates it from deploy', () => {
  const line = sizeLine(buildDigestRows([R, { ...R, id: 2, name: 'Y', limit: null }, { ...R, id: 3, name: 'Z', volDay: 113 }], { sizeOf: r => sizeDigestRow(r, { capital: 1e9 }) }));
  assert.match(line, /^size per 4h window .*deploy.*2-day/);
  assert.match(line, /X 100u 100k x3w limit |/);
  assert.match(line, /Y 5,000u .*clear, limit unknown/);
  assert.match(line, /Z <1u clear/);
  assert.ok(!/Infinity|NaN|unlimited/.test(line));
  assert.equal(line.split('\n').length, 1);
  assert.equal(sizeLine([]), null);
});

const D = (itemId, verdict) => ({ itemId, name: 'i' + itemId, mode: 'band', verdict, grade: 'A' });
const PREV = { ts: 1e12, rows: { 1: { name: 'i1', mode: 'band', verdict: 'fill-now' }, 2: { name: 'i2', mode: 'band', verdict: 'fill-now' }, 9: { name: 'i9', mode: 'churn', verdict: 'fill-now' }, 8: { name: 'i8', mode: 'band', verdict: 'fill-now' } } };
test('diff: NEW, changed and GONE with a reason only when known', () => {
  const line = digestDiffLine(PREV, [D(1, 'fill-now'), D(2, 'mirage top'), D(3, 'fill-now')], { now: 1e12 + 14 * 60e3, goneWhy: (id, p) => id === 9 ? `${p.mode} falling` : null });
  assert.equal(line, 'Δ vs 14m ago: NEW i3 · i2 fill-now→mirage top · GONE i8, i9 (churn falling)');
  assert.equal(digestDiffLine({ ts: 1e12, rows: { 1: PREV.rows[1] } }, [D(1, 'fill-now')], { now: 1e12 + 3 * 3600e3 }), 'Δ vs 3.0h ago: no change');
});
test('diff: first run prints nothing, a partial scan never reports GONE', () => {
  assert.equal(digestDiffLine(null, [D(1, 'fill-now')]), null);
  assert.equal(digestDiffLine(null, [], { partial: ['digest empty'] }), null);
  const line = digestDiffLine(PREV, [D(1, 'fill-now')], { now: 1e12, partial: ['band windows 3/24'] });
  assert.match(line, /^Δ skipped: partial scan \(band windows 3\/24\); baseline from 0m ago kept$/);
});
test('digest-prev: scoped, survives corruption, never overwritten by a partial or empty scan', () => {
  const dir = mkdtempSync(join(tmpdir(), 'digest-prev-')), f = join(dir, 'digest-prev.json');
  try {
    assert.equal(readDigestPrev(f, 'all'), null);
    assert.equal(writeDigestPrev(f, 'all', [D(1, 'a')], { now: 5 }), true);
    assert.equal(writeDigestPrev(f, 'band', [D(2, 'b')], { now: 6 }), true);
    assert.equal(writeDigestPrev(f, 'all', [D(3, 'c')], { now: 7, partial: ['x'] }), false);
    assert.equal(writeDigestPrev(f, 'all', [], { now: 8 }), false);
    assert.deepEqual(readDigestPrev(f, 'all'), { ts: 5, rows: { 1: { name: 'i1', mode: 'band', verdict: 'a', grade: 'A' } } });
    assert.ok(readDigestPrev(f, 'band').rows[2]);
    writeFileSync(f, '{oops');
    assert.equal(readDigestPrev(f, 'all'), null);
    assert.equal(writeDigestPrev(f, 'all', [D(4, 'd')]), true);
    for (let i = 0; i < 20; i++) writeDigestPrev(f, 's' + i, [D(1, 'a')], { now: 1e15 + i });
    assert.equal(Object.keys(JSON.parse(readFileSync(f, 'utf8')).scopes).length, 8);
    assert.ok(readDigestPrev(f, 's19'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const N = { mode: 'band', gated: 192, fetched: 103, shown: 44, excluded: [{ id: 1, name: 'Maul', expGpDay: 5e6, reason: 'thin-reserve-full' }, { id: 2, name: 'Rune', expGpDay: 1e5, reason: 'top-n-full' }], picks: [{ name: 'A', expGpDay: 9e6 }, { name: 'B', expGpDay: 3e6 }] };
test('niche line: counts close, and the crowded-out name prints only when it beats the weakest digest row', () => {
  assert.equal(nicheLine(N), 'band: 44 shown · 59 rejected · 2 crowded out · ⚠ Maul ~5m/d beats digest row B ~3m/d (thin-reserve-full, never fetched)');
  assert.equal(nicheLine({ ...N, picks: [{ name: 'B', expGpDay: 5e6 }] }), 'band: 44 shown · 59 rejected · 2 crowded out');
  assert.ok(!nicheLine({ ...N, picks: [] }).includes('Maul'));
  assert.ok(!nicheLine({ ...N, picks: [{ name: 'B', expGpDay: null }] }).includes('Maul'));
  const watch = nicheLine({ ...N, excluded: [{ ...N.excluded[0], reason: 'watch-reserve-full' }] });
  assert.match(watch, /0 crowded out$/);
  assert.match(nicheLine({ ...N, mode: 'churn', elsewhere: 50 }), /44 shown · 9 rejected · 50 shown in band/);
});
test('niche line: an empty niche says why', () => {
  assert.match(nicheLine({ mode: 'churn', gated: 0, fetched: 0, shown: 0 }), /nothing: gate empty$/);
  assert.match(nicheLine({ mode: 'churn', gated: 9, fetched: 3, shown: 0, why: ['falling', 'x', 'falling'] }), /nothing: falling x2$/);
  assert.match(nicheLine({ mode: 'band', gated: 9, fetched: 3, shown: 0, subFloor: 'sub-floor fallback (liquidity)' }), /nothing: sub-floor fallback \(liquidity\)$/);
});
test('coverage line: a lane that did not run says so', () => {
  assert.equal(coverageLine([{ label: 'Dips', n: 4, note: 'added / 15 watched' }, { label: 'Band big-tickets', n: 0 }, { label: 'Churn', n: 6, top: 'Rune' }, { label: 'Amplitude', n: null }]),
    'coverage: Dips 4 added / 15 watched · Band big-tickets 0 · Churn 6 (top Rune) · Amplitude NOT RUN');
});
