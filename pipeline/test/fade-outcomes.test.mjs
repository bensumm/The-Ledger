#!/usr/bin/env node
/**
 * fade-outcomes.test.mjs — acceptance fixtures for join-fade-outcomes.mjs's pure core
 * (PLAN-HOLD-FADE-ALERT HF1). No archive, no fetch — synthetic series only (rule 4).
 *
 * BUSINESS REQUIREMENTS pinned here:
 *   - breakdownAt replays the shipped 2h-momentum breakdown HONESTLY: it DECLINES (ok:false) on a
 *     stale live print, a thin band, or a one-sided band — the Gate-0 analogue — and never counts a
 *     declined origin as a quiet one.
 *   - pairedCost is a genuine PAIRED contrast: hand-computed error cells, a positive-crossing-only
 *     r*, dominance when the cost lines never cross in r>0, crossovers vs the two null models.
 *   - bootstrapM refuses a CI without enough discordant ITEMS (a concordant-only CI looks tight
 *     while carrying nothing).
 *   - scoreItem runs the whole funnel end-to-end on a synthetic item: the Diamond-bolts shape
 *     produces fadeHours=12 at the noon origin; a real afternoon drop produces y=true; horizon
 *     coverage is enforced (an origin the archive can't resolve is excluded, never a miss).
 */
import assert from 'node:assert/strict';
import { breakdownAt, pairedCost, bootstrapM, beats, scoreItem,
         OUTCOME_HORIZON_H, K_GRID, ORIGIN_HOURS, MIN_TRAIL_DAYS, MIN_DISCORDANT_ITEMS } from '../commands/join-fade-outcomes.mjs';
import { MIN_BAND_WINDOWS } from '../../js/quotecore.js';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

const ts = (y, mo, d, h, min = 0) => Math.floor(new Date(y, mo, d, h, min, 0).getTime() / 1000);
const pt1h = (y, mo, d, h, low, high) => ({ timestamp: ts(y, mo, d, h), avgLowPrice: low, avgHighPrice: high });

console.log('breakdownAt (the 2h-momentum replay) acceptance:');

// a 2h band of 5m buckets ending at T0 (exclusive), then the "live" bucket at T0.
const T0 = ts(2026, 0, 10, 14);
const band5m = (bandLow, liveLow, { bandHigh = bandLow + 10, buckets = 24 } = {}) => {
  const rows = [];
  for (let i = buckets; i >= 1; i--) rows.push({ timestamp: T0 - i * 300, avgLowPrice: bandLow, avgHighPrice: bandHigh });
  rows.push({ timestamp: T0, avgLowPrice: liveLow, avgHighPrice: bandHigh });
  return rows;
};

ok('fires when the last completed low undercuts the 2h band min', () => {
  const r = breakdownAt(band5m(100, 95), T0 + 300);
  assert.deepEqual(r, { ok: true, fired: true });
});
ok('in-band live low ⇒ ok but not fired', () => {
  assert.deepEqual(breakdownAt(band5m(100, 100), T0 + 300), { ok: true, fired: false });
});
ok('a STALE live print DECLINES (Gate-0 analogue), never reads as quiet', () => {
  assert.equal(breakdownAt(band5m(100, 95), T0 + 90 * 60).ok, false, '90 min old > the 60-min freshness bar');
});
ok('a band thinner than MIN_BAND_WINDOWS declines', () => {
  assert.equal(breakdownAt(band5m(100, 95, { buckets: MIN_BAND_WINDOWS - 1 }), T0 + 300).ok, false);
});
ok('a one-sided band (no high prints) declines', () => {
  const rows = band5m(100, 95).map(r => ({ ...r, avgHighPrice: null }));
  assert.equal(breakdownAt(rows, T0 + 300).ok, false);
});
ok('no low print at all ⇒ declines (empty series too)', () => {
  assert.equal(breakdownAt(band5m(100, 95).map(r => ({ ...r, avgLowPrice: null })), T0 + 300).ok, false);
  assert.equal(breakdownAt([], T0).ok, false);
  assert.equal(breakdownAt(null, T0).ok, false);
});

console.log('\npairedCost / bootstrapM acceptance:');

// hand-computed cells: n=10, drops=3; a: FA 1, miss 1; b: FA 3, miss 2.
const rowsDominant = [
  { itemId: 1, a: true, b: true, y: true },     // both hit
  { itemId: 1, a: true, b: false, y: true },    // a hits, b misses
  { itemId: 2, a: false, b: false, y: true },   // both miss
  { itemId: 2, a: true, b: false, y: false },   // a false-alarms
  { itemId: 3, a: false, b: true, y: false },   // b false-alarms ×3
  { itemId: 3, a: false, b: true, y: false },
  { itemId: 4, a: false, b: true, y: false },
  { itemId: 4, a: false, b: false, y: false },
  { itemId: 5, a: false, b: false, y: false },
  { itemId: 5, a: false, b: false, y: false },
];
ok('hand-computed cells, M, and dominance when the cost lines never cross in r>0', () => {
  const m = pairedCost(rowsDominant, 1);
  assert.deepEqual({ faA: m.faA, msA: m.msA, faB: m.faB, msB: m.msB, drops: m.drops },
    { faA: 1, msA: 1, faB: 3, msB: 2, drops: 3 });
  assert.equal(m.costA, 2); assert.equal(m.costB, 5);
  assert.ok(Math.abs(m.M - 0.3) < 1e-12, 'M(1) = 3/10');
  assert.equal(m.rStar, null, 'A=2, B=1 — never crosses at r>0');
  assert.equal(m.dominance, 'a', 'the candidate is cheaper at EVERY positive cost ratio');
  assert.equal(m.crossovers.aBeatsNeverAbove, 0.5, 'faA 1 / hitsA 2');
  assert.equal(m.crossovers.bBeatsNeverAbove, 3, 'faB 3 / hitsB 1');
  assert.equal(m.crossovers.aBeatsAllBelow, 6, '(7−1)/1');
  assert.equal(m.crossovers.bBeatsAllBelow, 2, '(7−3)/2');
});
ok('a POSITIVE r* crossing, and cheaperBelowRStar follows sign(B), not a fixed sentence', () => {
  // a: FA 4, miss 0; b: FA 1, miss 2 → A=−3, B=+2 → r*=1.5, b cheaper below it.
  const rows = [
    { itemId: 1, a: true, b: false, y: true }, { itemId: 2, a: true, b: false, y: true },
    { itemId: 1, a: true, b: false, y: false }, { itemId: 2, a: true, b: false, y: false },
    { itemId: 3, a: true, b: true, y: false }, { itemId: 3, a: true, b: false, y: false },
    { itemId: 4, a: false, b: false, y: false }, { itemId: 4, a: false, b: false, y: false },
  ];
  const m = pairedCost(rows, 1);
  assert.deepEqual({ faA: m.faA, msA: m.msA, faB: m.faB, msB: m.msB }, { faA: 4, msA: 0, faB: 1, msB: 2 });
  assert.equal(m.rStar, 1.5);
  assert.equal(m.cheaperBelowRStar, 'b');
  assert.ok(pairedCost(rows, 1).M < 0 && pairedCost(rows, 2).M > 0, 'the sign flips across r*');
  assert.equal(pairedCost([], 1), null, 'empty pool ⇒ null');
});
ok('bootstrapM refuses without MIN_DISCORDANT_ITEMS discordant items; grants a CI with them', () => {
  assert.ok(MIN_DISCORDANT_ITEMS > 4, 'fixture assumes the shipped floor');
  const concordant = Array.from({ length: 20 }, (_, i) => ({ itemId: i % 6, a: true, b: true, y: i % 3 === 0 }));
  assert.equal(bootstrapM(concordant, 1), null, 'no discordant items ⇒ refuse');
  // 10 items, each: a catches the drop b misses (+3 quiet rows) → M > 0 with a tight positive CI.
  const good = [];
  for (let it = 1; it <= 10; it++) {
    good.push({ itemId: it, a: true, b: false, y: true });
    for (let j = 0; j < 3; j++) good.push({ itemId: it, a: false, b: false, y: false });
  }
  const ci = bootstrapM(good, 1);
  assert.ok(ci && ci.lo > 0, 'every item favours a ⇒ the CI excludes 0');
  assert.equal(ci.discordantItems, 10);
  const b = beats(good);
  assert.ok(b.length >= 1 && b.every(x => x.M > 0 && x.ci.lo > 0), 'beats() applies the pre-registered criterion');
});

console.log('\nscoreItem end-to-end acceptance:');

// A 20-local-date synthetic item (Jan 1–20 2026), every hour: low 990 / high 1000 — except:
//   Jan 18 hours 0–11: high 960 (the Diamond-bolts 12h under-print shape, deficit 40 ≥ minGp 10);
//   Jan 19 hours 12–23: high 900 (a REAL afternoon drop — the outcome the fade should predict).
// 5m rows: constant low 990 / high 1000 every 5 minutes across the whole span (breakdown stays quiet).
const rows1h = [], rows5m = [];
for (let d = 1; d <= 20; d++) {
  for (let h = 0; h < 24; h++) {
    let high = 1000;
    if (d === 18 && h < 12) high = 960;
    if (d === 19 && h >= 12) high = 900;
    rows1h.push(pt1h(2026, 0, d, h, 990, high));
    for (let m = 0; m < 60; m += 5) rows5m.push({ timestamp: ts(2026, 0, d, h, m), avgLowPrice: 990, avgHighPrice: 1000 });
  }
}
const RES = scoreItem(rows1h, rows5m, 42);
const at = (d, h) => RES.scored.find(s => s.ts === ts(2026, 0, d, h));

ok('the origin grid: dates after MIN_TRAIL_DAYS × ORIGIN_HOURS, minus the horizon-uncovered tail', () => {
  // dates idx 14–19 (Jan 15–20) × 6 origin hours = 36, minus Jan 20 22:00 (t+3h > last bucket).
  assert.equal(MIN_TRAIL_DAYS, 14, 'fixture assumes the shipped trail');
  assert.equal(RES.scored.length, 6 * ORIGIN_HOURS.length - 1);
  assert.equal(RES.drop.unresolved, 1, 'the uncovered origin is EXCLUDED, never a miss');
  assert.equal(RES.drop.noBand, 0, 'constant 5m coverage ⇒ the baseline is evaluable everywhere');
});
ok('the Diamond-bolts shape: fadeHours=12 at the noon origin of the under-print day', () => {
  const o = at(18, 12);
  assert.equal(o.fadeHours, 12, 'hours 0–11 sat 40 under the 7d-profile 1000 (bar = 1% of h0)');
  assert.equal(o.y, false, 'the fixture day did NOT drop afterwards — fade fires, outcome quiet');
  assert.equal(o.brk, false, 'the 5m band never broke');
});
ok('a real afternoon drop scores y=true (h0 1000 → h4 900 < 1000 − 10)', () => {
  const o = at(19, 12);
  assert.equal(o.fadeHours, 0, 'Jan 19 morning printed AT profile — no fade warning');
  assert.equal(o.y, true);
});
ok('quiet origins: no fade, no breakdown, no drop; secondaries evaluable (not null)', () => {
  const o = at(16, 14);
  assert.deepEqual({ fadeHours: o.fadeHours, brk: o.brk, y: o.y }, { fadeHours: 0, brk: false, y: false });
  assert.equal(o.sDecay, false, 'constant reach ⇒ decay evaluable and false');
  assert.equal(o.sMargin, false, 'healthy cushion + on-pace live ⇒ composite evaluable and false');
});
ok('too-short a series ⇒ zero origins (degrade, never a fake pool)', () => {
  const r = scoreItem(rows1h.slice(0, 100), rows5m, 42);
  assert.equal(r.scored.length, 0);
});
ok('the pre-registered grids hold their shipped values', () => {
  assert.deepEqual(K_GRID, [2, 3, 4, 6]);
  assert.deepEqual(ORIGIN_HOURS, [12, 14, 16, 18, 20, 22]);
  assert.equal(OUTCOME_HORIZON_H, 4);
});

console.log(`\nAll ${pass} acceptance checks passed.`);
