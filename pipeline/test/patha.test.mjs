#!/usr/bin/env node
/**
 * patha.test.mjs — pins Path-A (intraday-flip) gp/day (PLAN-LANE-ADMISSION Chunk C, pipeline/lib/patha.mjs).
 * Fixture-tested against SYNTHETIC daily-range inputs shaped exactly like the `ranges[id]` slice
 * loadDailyRangeBulk returns ({ [dateKey]: {hi, lo} }) — NO live archive/data (process rule 4).
 * Asserts:
 *   - intradayDailyRange is the MEDIAN of per-day after-tax ranges, NOT max−min / a spike day
 *   - it reuses the ONE tax() (via netMargin) — a day's range is (hi − tax(hi)) − lo, not raw hi−lo
 *   - captureFrac splits 0.45 gear / 0.62 churn, default gear on unknown lane
 *   - unaffordable capital → 0 units → gpDay 0 (never floored up to 1)
 *   - null buyLimit → volDay/24 inferred limit (no crash, sane bound)
 *   - the gpDay composition equals marginU × units × cyclesDay and reuses expUnits' throughput
 * Run: `node pipeline/test/patha.test.mjs`  (exits non-zero on any failure).
 */
import assert from 'node:assert/strict';
import { pathAGpDay, intradayDailyRange, captureFracFor, CAPTURE_FRAC } from '../lib/patha.mjs';
import { median, netMargin, tax } from '../../js/quotecore.js';
import { expUnits } from '../lib/gatecandidates.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };
const approx = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !≈ ${b}`);

// A synthetic 4-day daily-range slice with ONE spike day, to prove median ≠ max−min ≠ spike.
// per-day raw ranges: 1000, 1200, 1100, 20000 (the spike). After-tax each day = netMargin(lo,hi).
// Priced ~10k so the 2% tax leaves a genuine positive intraday margin (a 100k lot would have tax
// eat these thin ranges — the point here is the median-vs-spike statistic, not the tax edge case).
const spikeRanges = {
  '2026-07-20': { lo: 10000, hi: 11000 },   // raw 1000
  '2026-07-21': { lo: 10000, hi: 11200 },   // raw 1200
  '2026-07-22': { lo: 10000, hi: 11100 },   // raw 1100
  '2026-07-23': { lo: 10000, hi: 30000 },   // raw 20000 — the spike day
};
const PX = 10000;   // a coherent buy price for the fixture (affordability is a separate input)

ok('intradayDailyRange = MEDIAN of per-day AFTER-TAX ranges (not max−min, not the spike)', () => {
  const perDayAfterTax = [
    netMargin(10000, 11000),
    netMargin(10000, 11200),
    netMargin(10000, 11100),
    netMargin(10000, 30000),
  ];
  const expected = median(perDayAfterTax);
  assert.equal(intradayDailyRange(spikeRanges), expected);
  // and it must be nowhere near the spike (max) or the max−min
  const maxDay = Math.max(...perDayAfterTax);
  assert.ok(intradayDailyRange(spikeRanges) < maxDay * 0.5, 'median must not track the spike day');
});

ok('after-tax reuses the ONE tax() — a day range is (hi − tax(hi)) − lo, not raw hi−lo', () => {
  const single = { d: { lo: 100000, hi: 101000 } };
  const raw = 101000 - 100000;                       // 1000 if tax were ignored
  const afterTax = (101000 - tax(101000)) - 100000;  // tax(101000) = 2020 → afterTax = -1020
  assert.equal(intradayDailyRange(single), afterTax);
  assert.notEqual(intradayDailyRange(single), raw);
});

ok('null / empty / malformed daily-range → null (honest omit, never throws)', () => {
  assert.equal(intradayDailyRange(null), null);
  assert.equal(intradayDailyRange({}), null);
  assert.equal(intradayDailyRange({ d: null }), null);
  assert.equal(intradayDailyRange({ d: { lo: 0, hi: 5 } }), null);     // lo not > 0
  assert.equal(pathAGpDay({ dayRanges: {}, price: 1000, buyLimit: 10, volDay: 5000 }), null);
});

ok('captureFrac splits 0.45 gear / 0.62 churn, unknown lane → gear default', () => {
  assert.equal(captureFracFor('gear'), 0.45);
  assert.equal(captureFracFor('churn'), 0.62);
  assert.equal(captureFracFor(undefined), CAPTURE_FRAC.gear);
  assert.equal(captureFracFor('nonsense'), CAPTURE_FRAC.gear);
  // marginU reflects the lane split for the same range
  const base = { dayRanges: spikeRanges, price: PX, buyLimit: 100, volDay: 50000, capital: 1e9 };
  const gear = pathAGpDay({ ...base, lane: 'gear' });
  const churn = pathAGpDay({ ...base, lane: 'churn' });
  approx(gear.marginU, gear.intradayRange * 0.45);
  approx(churn.marginU, churn.intradayRange * 0.62);
  assert.ok(churn.marginU > gear.marginU);
});

ok('explicit captureFrac override wins over lane (Chunk-G recalibration hook)', () => {
  const r = pathAGpDay({ dayRanges: spikeRanges, price: PX, buyLimit: 100, volDay: 50000, capital: 1e9, lane: 'gear', captureFrac: 0.9 });
  assert.equal(r.captureFrac, 0.9);
  approx(r.marginU, r.intradayRange * 0.9);
});

ok('unaffordable capital → 0 units → gpDay 0 (never floored up to 1)', () => {
  // price 5000, capital 3000 → floor(3000/5000)=0 units
  const r = pathAGpDay({ dayRanges: spikeRanges, price: 5000, buyLimit: 100, volDay: 50000, lane: 'churn', capital: 3000 });
  assert.equal(r.units, 0);
  assert.equal(r.cyclesDay, 0);
  assert.equal(r.gpDay, 0);
  assert.ok(r.marginU > 0, 'marginU still computed even when unaffordable');
});

ok('capital binds units per cycle (min of limit and afford)', () => {
  // limit 100, price 10000, capital 400000 → afford floor(40)=40 < limit → units 40
  const r = pathAGpDay({ dayRanges: spikeRanges, price: PX, buyLimit: 100, volDay: 5_000_000, lane: 'churn', capital: 400000 });
  assert.equal(r.units, 40);
});

ok('null buyLimit → volDay/24 inferred limit (no crash, sane bound)', () => {
  // limit null, volDay 48000 → effLimit 2000; capital-blind → units = min(2000, Inf) = 2000
  const r = pathAGpDay({ dayRanges: spikeRanges, price: PX, buyLimit: null, volDay: 48000, lane: 'gear', capital: Infinity });
  assert.equal(r.units, 48000 / 24);   // 2000
  assert.ok(r.gpDay >= 0 && Number.isFinite(r.gpDay));
});

ok('gpDay composition == marginU × units × cyclesDay, and throughput reuses expUnits', () => {
  const args = { dayRanges: spikeRanges, price: PX, buyLimit: 100, volDay: 50000, lane: 'churn', capital: 1e9 };
  const r = pathAGpDay(args);
  // the parts must multiply back to the headline (within rounding)
  approx(r.gpDay, Math.round(r.marginU * r.units * r.cyclesDay), 1);
  // throughput = expUnits(effLimit, volDay, floor(capital/price)); units×cyclesDay must equal it
  const capUnits = Math.floor(1e9 / PX);
  const throughput = expUnits(100, 50000, capUnits);
  approx(r.units * r.cyclesDay, throughput, 1e-6);
});

ok('volume-bound throughput: tiny volDay caps cyclesDay below 6 refills', () => {
  // limit 100, volDay 300 → 0.10×300 = 30 unit/day share; units bound by limit/capital.
  const r = pathAGpDay({ dayRanges: spikeRanges, price: PX, buyLimit: 100, volDay: 300, lane: 'gear', capital: 1e9 });
  const throughput = expUnits(100, 300, Math.floor(1e9 / PX));   // = min(100×6, 30) = 30
  approx(r.units * r.cyclesDay, throughput, 1e-6);
  assert.ok(r.units * r.cyclesDay <= 30 + 1e-6);
});

ok('returns the H1 pathA field shape (minus rankInLane)', () => {
  const r = pathAGpDay({ dayRanges: spikeRanges, price: PX, buyLimit: 100, volDay: 50000, lane: 'churn', capital: 1e9 });
  for (const k of ['gpDay', 'marginU', 'captureFrac', 'cyclesDay', 'units', 'price', 'intradayRange', 'lane']) {
    assert.ok(k in r, `missing field ${k}`);
  }
  assert.equal(r.lane, 'churn');
  assert.equal(r.price, PX);
});

console.log(`\nAll ${pass} acceptance checks passed.`);
