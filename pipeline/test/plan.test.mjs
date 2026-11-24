#!/usr/bin/env node
/* plan.test.mjs — planLines() over the REAL heldDisplay / renderHeldVerdict / heldListAt chain. */
import assert from 'node:assert/strict';
import { planLines } from '../lib/render/plan.mjs';
import { heldDisplay, renderHeldVerdict } from '../lib/market/item-context.mjs';
import { heldListAt } from '../lib/render/emit.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };
const NOW = Date.parse('2026-11-24T12:00:00Z'), BE = 1_400_000;
const ROW = { quickSell: 1_300_000, quickBuy: 1_290_000, optSell: 1_320_000, optBuy: 1_280_000, rawBandLo: 1_280_000, rawBandHi: 1_320_000, reliable: true, mom: 'clean' };
const CUT = { verdict: 'CUT-CANDIDATE', action: 'CUT', gate: 'D', listAt: 1_300_000, reason: 'r' };
const GATE2 = { verdict: 'CUT', action: 'CUT', gate: 2, listAt: 1_300_000, reason: 'r' };
const THESIS = { path: 'hold-recovery', tripwire: 1_200_000, exitPrice: 1_500_000, ts: new Date(NOW).toISOString() };
function lot({ name = 'X', mv = null, thesis = null, prior = null, row = ROW, prev = null } = {}) {
  const display = heldDisplay({ row, be: BE, mv, prior, nowMs: NOW, thesis });
  const ctx = { market: { row }, position: { be: BE, mv, display, thesis }, intraday: {} };
  return { name, qty: 1, be: BE, display, verdictText: renderHeldVerdict(ctx, { mode: 'compact' }), listAt: heldListAt(row, BE, mv),
    holdListAt: heldListAt(row, BE, null), live: row.quickSell, exitPrice: thesis?.exitPrice, tripwire: thesis?.tripwire, prev };
}
const price = l => /list @ (\S+)/.exec(l)[1];
const settled = v => ({ displayVerdict: v, verdictArmedKey: null, verdictArmedSince: null });

ok('empty book is one line', () => assert.deepEqual(planLines([]), ['no held lots']));
ok('an overridden CUT prints the DECLARED exit, never the cut price', () => {
  const [l] = planLines([lot({ mv: CUT, thesis: THESIS })]);
  assert.match(l, /^HOLD \(overrode cut\) X ×1/); assert.equal(price(l), '1.50m'); assert.ok(l.includes('abort < 1.20m'));
});
ok('a frame with no declared exit never lists under break-even', () => {
  const [l] = planLines([lot({ mv: CUT, thesis: { ...THESIS, exitPrice: null } })]);
  assert.match(l, /^HOLD \(overrode cut\)/); assert.equal(price(l), '1.40m');
});
ok('a Gate-2 breakdown CUT beats the frame and prints its own price', () => {
  const [l] = planLines([lot({ mv: GATE2, thesis: THESIS })]);
  assert.match(l, /^CUT X/); assert.equal(price(l), '1.30m');
});
ok('a CUT under an EXPIRED plan reads CUT, sorts first and says the plan expired', () => {
  const expired = { ...THESIS, horizon: '2026-09-24' };
  const out = planLines([lot({ name: 'H' }), lot({ name: 'E', mv: GATE2, thesis: expired })]);
  assert.match(out[0], /^CUT E .*plan expired — reassess/);
});
ok('an expired plan on a quiet lot still sorts with WATCH, ahead of HOLD', () => {
  const out = planLines([lot({ name: 'H', mv: null, row: { ...ROW, quickSell: 1_600_000, optSell: 1_620_000, rawBandHi: 1_620_000 } }), lot({ name: 'E', row: { ...ROW, quickSell: 1_600_000, optSell: 1_620_000, rawBandHi: 1_620_000 }, thesis: { ...THESIS, horizon: '2026-09-24' } })]);
  assert.ok(out[0].includes(' E '), out.join('|'));
});
ok('an arming CUT keeps the displayed word, never lists under break-even, and sorts ahead of HOLD', () => {
  const l = lot({ name: 'A', mv: CUT, prior: settled('HOLD') });
  assert.equal(l.display.arming, true, JSON.stringify(l.display));
  const out = planLines([lot({ name: 'H', row: { ...ROW, quickSell: 1_600_000, optSell: 1_620_000, rawBandHi: 1_620_000 } }), l]);
  assert.match(out[0], / A ×1 .*CUT-CANDIDATE arming/); assert.equal(price(out[0]), '1.40m');
});
ok('a framed lot sorts with HOLD even when the machinery says CUT', () => {
  const out = planLines([lot({ name: 'F', mv: CUT, thesis: THESIS }), lot({ name: 'C', mv: GATE2 })]);
  assert.deepEqual(out.map(l => l.match(/ ([FC]) ×/)[1]), ['C', 'F']);
});
const UP = { ...ROW, quickSell: 1_600_000, optSell: 1_620_000, rawBandHi: 1_620_000 };
ok('a falling lot prints the order the verdict gives: CUT under break-even, SELL above, both at the instabuy', () => {
  for (const thesis of [null, { ...THESIS, horizon: '2026-09-24' }]) {
    const a = lot({ name: 'A', row: { ...ROW, falling: true }, thesis }), b = lot({ name: 'B', row: { ...UP, falling: true }, thesis });
    if (!thesis) { assert.match(a.verdictText, /^CUT @ 1.30m/); assert.match(b.verdictText, /^SELL @ 1.60m/); }
    const out = planLines([lot({ name: 'H', row: UP }), b, a]);
    assert.match(out[0], /^CUT A/); assert.equal(price(out[0]), '1.30m');
    assert.match(out[1], /^SELL B/); assert.equal(price(out[1]), '1.60m');
  }
});
ok('a HOLD already listed over break-even keeps its band-top price', () => { assert.equal(price(planLines([lot({ row: UP, mv: { verdict: 'HOLD', action: 'HOLD', listAt: 1_700_000, reason: 'r' } })])[0]), '1.70m'); });
ok("'was' only when the stored verdict differs", () => {
  assert.ok(planLines([lot({ mv: GATE2, prior: settled('HOLD'), prev: 'HOLD' })])[0].endsWith('was HOLD'));
  assert.ok(!planLines([lot({ mv: GATE2, prior: settled('CUT'), prev: 'CUT' })])[0].includes('was'));
  assert.ok(!planLines([lot({ mv: GATE2 })])[0].includes('was'));
});
ok('one line per lot, each with a price and break-even', () => {
  const out = planLines([lot({ name: 'A' }), lot({ name: 'B', mv: GATE2 }), lot({ name: 'C', mv: CUT, thesis: THESIS })]);
  assert.equal(out.length, 3); assert.ok(out.every(l => !l.includes('\n') && /list @ \S+ \(BE 1\.40m\)/.test(l)));
});
ok('sweep: the plan never contradicts the rendered verdict, and only an exit word prices under break-even', () => {
  let n = 0;
  const mvs = [null, CUT, GATE2, { verdict: 'LIST-TO-CLEAR', action: 'CLEAR', gate: 2, listAt: 1_300_000, reason: 'r' }, { verdict: 'HOLD', action: 'HOLD', listAt: 1_300_000, reason: 'r' }];
  const theses = [null, THESIS, { ...THESIS, horizon: '2026-09-24' }, { ...THESIS, tripwire: 1_350_000 }, { ...THESIS, exitPrice: null }];
  for (const row of [ROW, UP]) for (const falling of [false, true]) for (const reliable of [true, false]) for (const mv of mvs) for (const thesis of theses)
    for (const prior of [null, settled('HOLD'), settled('CUT'), settled('FALLING'), settled('UNDERWATER')]) {
      const l = lot({ row: { ...row, falling, reliable }, mv, thesis, prior }), line = planLines([l])[0], kind = l.display.mvDisplay?.synthetic ? l.display.mvDisplay.kind : null;
      const word = line.split(' X ×')[0], exit = /^(CUT|LIST|SELL)/.test(word); n++;
      const real = /^(CUT|SELL|LIST-TO-CLEAR)/.exec(l.verdictText)?.[1];
      if (!kind && real) assert.ok(word.startsWith(real), line + ' vs ' + l.verdictText);
      if (!exit && !(kind === 'frame' && l.exitPrice != null)) assert.ok(l.listAt >= BE ? true : price(line) === '1.40m' || price(line) === '1.60m' || price(line) === '1.62m', line);
      if (l.display.raw && /^CUT/.test(l.display.raw) && kind === 'expired' && !l.display.arming) assert.ok(exit || l.display.token !== l.display.raw, line);
    }
  assert.ok(n === 2 * 2 * 2 * 5 * 5 * 5);
});
console.log(`plan.test.mjs: ${pass} passed`);
