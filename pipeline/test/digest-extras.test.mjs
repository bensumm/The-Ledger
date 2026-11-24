/** digest-extras.test.mjs — the lines under the scan digest and the numeric rows behind them. PURE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDigestRows } from '../lib/render/digest-extras.mjs';
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
