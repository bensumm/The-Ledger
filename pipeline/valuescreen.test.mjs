#!/usr/bin/env node
/**
 * valuescreen.test.mjs — acceptance fixtures for the PURE value niche math (js/valuescreen.mjs, P5 /
 * PLAN-VALUE). The gate/rank/tier are DOM-free + dependency-light, so they're fixture-testable with
 * synthetic daily-mid series fed through the real js/termstructure.mjs — NO live data (CLAUDE.md rule 4).
 *
 * BUSINESS REQUIREMENTS pinned here (PLAN-VALUE §A/§B/§F):
 *   - a flat-floor item with ≥ the after-tax cycle-amplitude floor, near the multi-week low, PASSES
 *     the value gate and lands in the buy-now tier ("buy the base").
 *   - a DECAY/downtrend knife (recent median well below the 2-week median) is REJECTED ("never the knife").
 *   - an item whose cycle amplitude can't clear the floor is REJECTED (amp-below-floor).
 *   - valueScore ranks a bigger-amplitude, nearer-the-low, more-stable-floor item ABOVE a weaker one
 *     (the §F ranking that makes the expected-large pool usable).
 * Run: `node pipeline/valuescreen.test.mjs` (exits non-zero on any failure). Auto-discovered by run-tests.mjs.
 */
import assert from 'node:assert/strict';
import { termStructure } from '../js/termstructure.mjs';
import {
  valueRanges, valueScore, valueGate, valueTier,
  VALUE_MIN_CYCLE_PCT, VALUE_KNIFE_PCT, VALUE_BUYNOW_PROX, VALUE_MAX_BELOW_LOW_PCT,
} from '../js/valuescreen.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

const DAY = 86400, TEND = 1_700_000_000;
// build a daily {ts,mid} series from mids (oldest→newest), one day apart, ending at TEND. Daily spacing
// keeps the multi-week BASE inside the 14d window so a recent down-leg reads as a median decline.
const series = mids => mids.map((m, i) => ({ ts: TEND - (mids.length - 1 - i) * DAY, mid: m }));
const ts = mids => termStructure(series(mids), { now: TEND });
const alt = (n, lo, hi) => Array.from({ length: n }, (_, i) => (i % 2 === 0 ? lo : hi));

// a flat-floor value item: lows ~1000, highs ~1100 across the whole multi-week window (20 daily points).
const FLAT = [...alt(19, 1000, 1100), 1000];
// a decay knife: an established ~1000/1100 base that has broken DOWN over the last ~5 days.
const KNIFE = [...alt(15, 1000, 1100), 950, 920, 900, 880, 860];
// a razor-thin range: lows ~1000, highs ~1030 (<6% after-tax amplitude).
const THIN_AMP = [...alt(19, 1000, 1030), 1000];
// a REGIME SHIFT (Contract-of-sensory-clouding shape): an established HIGH band (~3000/3600) that
// crashed to a LOW band (~1300/2000) over the window and is now recovering. The full-window q85 ceiling
// (~3600) is a DEAD regime the item left; a mid-recovery live must NOT read as "near the low → buy-now".
const SHIFT = [
  ...alt(6, 3000, 3600),                     // old high regime (~28d ago)
  2600, 2200, 1900, 1600, 1400, 1300,        // the crash
  ...alt(8, 1350, 2000),                      // the recent low regime it now oscillates in (last ~8d)
];

console.log('valuescreen.mjs acceptance:');

ok('flat-floor item near the low: PASSES the gate, buy-now tier, amplitude ≥ floor', () => {
  const vr = valueRanges(ts(FLAT), 1000);   // live at the floor
  assert.equal(vr.hasData, true);
  assert.ok(vr.afterTaxAmpPct >= VALUE_MIN_CYCLE_PCT, `amp ${vr.afterTaxAmpPct} ≥ ${VALUE_MIN_CYCLE_PCT}`);
  assert.ok((vr.knifeDelta || 0) <= VALUE_KNIFE_PCT, 'a flat base is not a knife');
  const g = valueGate(vr, {});
  assert.deepEqual(g, { pass: true, reason: null });
  assert.ok(vr.proximity >= VALUE_BUYNOW_PROX, `live at the low → high proximity (${vr.proximity})`);
  assert.equal(valueTier(vr), 'buy-now');
});

ok('a mid-range flat-floor item PASSES the gate but lands in the WATCH tier (rank, don\'t gate)', () => {
  const vr = valueRanges(ts(FLAT), 1090);   // live near the top of the range → wait for the dip
  assert.equal(valueGate(vr, {}).pass, true, 'still admitted — proximity ranks, never gates');
  assert.ok(vr.proximity < VALUE_BUYNOW_PROX, `mid-range → lower proximity (${vr.proximity})`);
  assert.equal(valueTier(vr), 'watch');
});

ok('a DECAY KNIFE (recent median well below the 2-week median) is REJECTED', () => {
  const vr = valueRanges(ts(KNIFE), 860);
  assert.ok(vr.knifeDelta > VALUE_KNIFE_PCT, `knife delta ${vr.knifeDelta} > ${VALUE_KNIFE_PCT}`);
  assert.deepEqual(valueGate(vr, {}), { pass: false, reason: 'knife' });
});

ok('a post-fetch decay PHASE is rejected even if the term-structure delta didn\'t catch it', () => {
  const vr = valueRanges(ts(FLAT), 1000);   // passes the pre-fetch gate
  assert.equal(valueGate(vr, {}).pass, true);
  assert.deepEqual(valueGate(vr, { phase: 'decay' }), { pass: false, reason: 'decay' });   // phase confirm
  assert.equal(valueGate(vr, { phase: 'basing' }).pass, true, 'basing is a valid value-low');
});

ok('an ARTIFACT low (live implausibly below the durable floor) is REJECTED, not ranked #1', () => {
  // Gloves-of-silence shape: a real ~1000/1100 multi-week floor, but the live instasell prints a lone
  // off-market 201 — proximity would clamp to 1 and rocket valueScore. The proximity-sanity guard rejects.
  const structure = ts(FLAT);
  const vr = valueRanges(structure, 201);           // live 80% below the ~1000 floor
  assert.ok(vr.liveVsLowPct < -VALUE_MAX_BELOW_LOW_PCT, `live is far below the floor (${vr.liveVsLowPct})`);
  assert.deepEqual(valueGate(vr, {}), { pass: false, reason: 'artifact-low' });
  // a REAL dip — live at/just under the q15 floor — still PASSES (the guard is generous, not a floor-hugger).
  const atFloor = valueRanges(structure, 990);      // ~1% under the floor: a genuine dip
  assert.ok(atFloor.liveVsLowPct >= -VALUE_MAX_BELOW_LOW_PCT, 'a shallow dip is within tolerance');
  assert.equal(valueGate(atFloor, {}).pass, true, 'a real at-the-floor dip is not an artifact');
});

ok('a REGIME SHIFT range is RECENCY-ANCHORED — a stale prior-regime high can\'t fake a buy-now (RC1)', () => {
  // live ~1700, mid-recovery in the RECENT ~1350→2000 band. The full 28d q85 ceiling sits up near the
  // dead ~3000+ regime; without anchoring, proximity vs that stale top would read "near the low → buy-now".
  const vr = valueRanges(ts(SHIFT), 1700);
  assert.equal(vr.ceilingStale, true, 'the durable ceiling is flagged as a prior regime');
  assert.ok(vr.durableHigh < vr.rawDurableHigh, `effective ceiling ${vr.durableHigh} anchored below the durable ${vr.rawDurableHigh}`);
  // scored on the recent band, a mid-recovery live is NOT near the low → WATCH, not buy-now.
  assert.ok(vr.proximity < VALUE_BUYNOW_PROX, `mid-recovery → not near the recent low (${vr.proximity})`);
  assert.equal(valueTier(vr), 'watch');
  // a live down AT the recent floor IS a buy-now (the anchor didn't just blanket-demote the item).
  const atLow = valueRanges(ts(SHIFT), 1350);
  assert.ok(atLow.proximity >= VALUE_BUYNOW_PROX, `at the recent floor → near the low (${atLow.proximity})`);
  assert.equal(valueTier(atLow), 'buy-now');
});

ok('an item whose cycle amplitude can\'t clear the after-tax floor is REJECTED', () => {
  const vr = valueRanges(ts(THIN_AMP), 1000);
  assert.ok(vr.afterTaxAmpPct < VALUE_MIN_CYCLE_PCT, `amp ${vr.afterTaxAmpPct} < ${VALUE_MIN_CYCLE_PCT}`);
  assert.deepEqual(valueGate(vr, {}), { pass: false, reason: 'amp-below-floor' });
});

ok('no history (too-short series) DEGRADES to a no-history reject, never throws', () => {
  const vr = valueRanges(termStructure([{ ts: TEND, mid: 1000 }]), 1000);
  assert.equal(vr.hasData, false);
  assert.deepEqual(valueGate(vr, {}), { pass: false, reason: 'no-history' });
  assert.equal(valueScore(vr), 0, 'no score without data');
  assert.equal(valueTier(vr), 'watch', 'degrades to the safe tier');
});

ok('valueScore ranks a bigger-amplitude, nearer-the-low item ABOVE a weaker one (§F ranking)', () => {
  const strong = valueScore(valueRanges(ts(FLAT), 1000));         // near the low, full 1000→1100 amplitude
  const weakerProx = valueScore(valueRanges(ts(FLAT), 1090));     // same item, mid-range (lower proximity)
  assert.ok(strong > weakerProx, `nearer-the-low outranks mid-range (${strong} > ${weakerProx})`);
  assert.ok(strong > 0);
});

console.log(`\nAll ${pass} acceptance checks passed.`);
