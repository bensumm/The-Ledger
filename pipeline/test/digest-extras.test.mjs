/** digest-extras.test.mjs — the lines under the scan digest and the numeric rows behind them. PURE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { sizeTranche } from '../lib/capital/book-model.mjs';
import { buildDigestRows, sizeDigestRow, sizeLine } from '../lib/render/digest-extras.mjs';
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
