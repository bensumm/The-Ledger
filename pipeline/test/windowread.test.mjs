#!/usr/bin/env node
/**
 * windowread.test.mjs — acceptance fixtures for the pure window-range math (js/windowread.mjs).
 *
 * windowread moved js/ (P2) so it is node- AND app-importable, like js/quotecore.js; this test lives
 * in pipeline/ next to quotecore.test.mjs (the convention for js/-module tests). windowread is PURE
 * over an already-fetched 1h /timeseries array — fixtures are synthetic points, no live data (rule 4).
 * Run: `node pipeline/test/windowread.test.mjs`  (exits non-zero on any failure).
 *
 * BUSINESS REQUIREMENTS pinned here (diff a change against these):
 *   - quantLow returns the bid level touched on ≥p of nights (a bid ≥ the p-quantile of window
 *     lows fills on p of the nights); quantHigh mirrors it for asks (feeds /overnight fill-realism).
 *   - inWindow wraps past midnight: a 22→6 window includes 23:00 and 02:00, excludes 06:00 and noon.
 *   - windowStats buckets a cross-midnight window to the LOCAL morning it ENDS on (pre-midnight
 *     22:00/23:00 points merge with the post-midnight hours into ONE night), skips daytime hours,
 *     and returns null when the history has no traded window-hours.
 */
import assert from 'node:assert/strict';
import { inWindow, quantLow, quantHigh, touchedDays, reachedDays, placement, windowStats, recencySplit, recentQuant, hourProfile, deriveDiurnalRange, softBuyRead, formatSoftBuy, SOFT_BUY_AT_FLOOR_PCT, asymPair, ASYM_P_LO, ASYM_P_HI, ASYM_MIN_DAYS, reachMargin, MARGIN_MIN_DAYS } from '../../js/windowread.mjs';
import { SECOND_PROMINENCE_FRAC } from '../../js/windowread.mjs';   // PLAN-MULTI-PEAK-WINDOWS — the secondary-window prominence gate
import { windowClear, windowClearDiverges, WINCLEAR_MIN_DAYS } from '../../js/windowread.mjs';   // PLAN-WINDOW-CLEAR B1
import { clearableAsk } from '../../js/windowread.mjs';   // PLAN-DEPTH-EXIT DE1 (depthDays/clearableBid removed — PLAN-REMOVE-DEPTH-PRESSURE-READS)
import { demandPressure, reachableBand, PRESSURE_PHI_SLOPE, PRESSURE_MIN_VOL, PRESSURE_HEADROOM_MAX } from '../../js/windowread.mjs';   // PLAN-DEPTH-EXIT Extension A (PB1) — hourlyPressure/demandRegime (Ext B) removed, PLAN-REMOVE-DEPTH-PRESSURE-READS
import { trajectoryRead } from '../../js/windowread.mjs';   // the fang under-read fix — shared multi-day shape read (read-window-range + quote-items render from ONE definition)
import { floorCeilingTrack, formatFloorCeiling, FC_MIN_DAYS } from '../../js/windowread.mjs';   // PLAN-DRIFT-VS-CRASH — the phase-aligned floor+ceiling slope-asymmetry classifier
import { fmtHoldHorizon } from '../../js/windowread.mjs';   // PLAN-ESTIMATOR-HONEST-SELL follow-up — the shared "~Nh/Nd hold" renderer
import { hourConcentration, HOURCONC_MIN_DAYS, HOURCONC_MIN_R, diurnalTimedLap, DT_TRANCHE_COMFORT_VOL_PCT, DT_TRANCHE_CEILING_VOL_PCT } from '../../js/windowread.mjs';   // PLAN-DIURNAL-TIMING DT1 — the timed-lap layer
import { computeReality, realityClause, SPIKE_REACH_FRAC, SPIKE_PLACEMENT_PCTILE, SPIKE_MIN_GAP_FRAC, REALITY_TYPICAL_QUANT, REALITY_TYPICAL_RECENTN } from '../../js/windowread.mjs';   // PLAN-DIURNAL-RECENCY-GUARD — the level-reality guard + its renderer
import { formatTimedLap } from '../lib/emit.mjs';   // PLAN-DIURNAL-TIMING DT3 — the end-to-end quote-items/watch-positions wiring pin (real series → diurnalTimedLap → formatTimedLap)

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

console.log('windowread.js window-range acceptance:');

// --- 1. quantLow / quantHigh are the level touched/reached on ≥p of nights --------------------
ok('quantLow: bid at the p-quantile of window lows is touched on ≥p of nights', () => {
  const lows = [100, 200, 300, 400];                 // ascending, 4 nights
  // p=0.5 → 200: exactly 2 of 4 nights dipped to/below it (≥50%)
  assert.equal(quantLow(lows, 0.5), 200);
  assert.equal(touchedDays(lows, 200), 2);
  // p=1 → the max low (400): a bid ≥ that is touched EVERY night
  assert.equal(quantLow(lows, 1), 400);
  assert.equal(touchedDays(lows, 400), 4);
  // p=0.25 → the min low (100): only the cheapest night
  assert.equal(quantLow(lows, 0.25), 100);
  assert.equal(touchedDays(lows, 100), 1);
});
ok('quantHigh: ask at the p-quantile of window highs is reached on ≥p of nights', () => {
  const his = [100, 200, 300, 400];                  // ascending, 4 nights
  assert.equal(quantHigh(his, 0.5), 300);            // 2 of 4 highs sit at/above 300 (≥50%)
  assert.equal(reachedDays(his, 300), 2);
  assert.equal(quantHigh(his, 1), 100);              // min high → reached every night
  assert.equal(reachedDays(his, 100), 4);
  assert.equal(quantHigh(his, 0.25), 400);           // only the richest night reaches the top ask
  assert.equal(reachedDays(his, 400), 1);
});

// --- 1b. placement: price→percentile (AC4a) — the descriptive inverse of quantLow/quantHigh -----
ok('placement: empirical CDF — fraction of the ascending sample at or below x; 0 below all, 1 above all; null empty', () => {
  const his = [100, 200, 300, 400];
  assert.equal(placement(his, 250), 0.5);       // 100,200 ≤ 250 → 2/4
  assert.equal(placement(his, 400), 1);          // all ≤ 400
  assert.equal(placement(his, 99), 0);           // none
  assert.equal(placement(his, 1000), 1);         // above every printed value → p100 (a tail outlier, DESCRIPTIVE only)
  assert.equal(placement([], 5), null);          // empty sample → null (never a fake percentile)
  assert.equal(placement(null, 5), null);
});
ok('placement is the descriptive inverse of quantHigh/quantLow (same distribution, opposite direction)', () => {
  const his = [100, 200, 300, 400];              // ascending daily HIGHS
  // an ASK at the every-day-reached level (min high) sits at p25 of the daily-high distribution (1 of 4 ≤ it)
  assert.equal(placement(his, his[0]), 0.25);
  // placement counts AT-OR-BELOW (≤) while reachedDays counts AT-OR-ABOVE (≥) — DIFFERENT questions on the
  // SAME distribution: quantHigh(his,0.5)=300 is reached on 2/4 days (≥300), but placement(his,300)=3/4=p75
  // (≤300). An ask at p75 sits in the upper-middle of the printed band — the normal home of a resting ask.
  assert.equal(quantHigh(his, 0.5), 300);
  assert.equal(reachedDays(his, 300), 2);
  assert.equal(placement(his, 300), 0.75);
  const lows = [100, 200, 300, 400];             // ascending daily LOWS
  assert.equal(placement(lows, 50), 0);          // a BID below every daily low → p0 (a deep entry)
  assert.equal(placement(lows, 250), 0.5);
  // matches cdf (the AC1 study's name for this same computation — now a delegate, so they can't drift)
});

// --- 2. inWindow wraps midnight --------------------------------------------------------------
ok('inWindow: a normal 9→17 window is a simple half-open range', () => {
  assert.equal(inWindow(9, 9, 17), true);            // start inclusive
  assert.equal(inWindow(16, 9, 17), true);
  assert.equal(inWindow(17, 9, 17), false);          // end exclusive
  assert.equal(inWindow(8, 9, 17), false);
});
ok('inWindow: a 22→6 overnight window wraps past midnight', () => {
  assert.equal(inWindow(22, 22, 6), true);           // start inclusive
  assert.equal(inWindow(23, 22, 6), true);
  assert.equal(inWindow(2, 22, 6), true);            // small hours
  assert.equal(inWindow(5, 22, 6), true);
  assert.equal(inWindow(6, 22, 6), false);           // end exclusive
  assert.equal(inWindow(12, 22, 6), false);          // midday
});

// --- 3. windowStats buckets a cross-midnight night to the morning it ends on -----------------
// Build a 1h series for one overnight (22→6). Local Date construction matches windowStats' local
// getHours()/dayKey. `now` is set to a DAYTIME instant so no "today" bucket is skipped.
const ts = (y, mo, d, h) => Math.floor(new Date(y, mo, d, h, 0, 0).getTime() / 1000);
const pt = (t, low, hi, volLo = 10, volHi = 10) =>
  ({ timestamp: t, avgLowPrice: low, avgHighPrice: hi, lowPriceVolume: volLo, highPriceVolume: volHi });

ok('windowStats: pre- and post-midnight hours bucket to ONE night (the morning it ends on)', () => {
  const series = [
    pt(ts(2026, 0, 10, 22), 1000, 1010),   // Jan-10 22:00 (pre-midnight)
    pt(ts(2026, 0, 10, 23), 980, 1005),    // Jan-10 23:00 (pre-midnight)
    pt(ts(2026, 0, 11, 1), 950, 1002),     // Jan-11 01:00 — the lowest low
    pt(ts(2026, 0, 11, 2), 970, 1020),     // Jan-11 02:00 — the highest high
    pt(ts(2026, 0, 11, 12), 5, 5, 0, 0),   // Jan-11 12:00 — DAYTIME, must be excluded
  ];
  const now = new Date(2026, 0, 20, 12, 0, 0);       // daytime, well after the night → nothing skipped
  const stats = windowStats(series, { wStart: 22, wEnd: 6, now });
  assert.equal(stats.days.length, 1, 'all four window-hours collapse into one night');
  const [key, night] = stats.days[0];
  assert.equal(key, '2026-01-11', 'keyed to the morning the window ENDS on (not Jan-10)');
  assert.equal(night.low, 950, 'min across the whole cross-midnight span');
  assert.equal(night.hi, 1020, 'max across the whole cross-midnight span');
  assert.equal(night.volLo, 40, 'daytime hour excluded from the volume sum (4 window-hours × 10)');
});

ok('windowStats: returns null when the history has no traded window-hours', () => {
  const daytimeOnly = [pt(ts(2026, 0, 11, 12), 100, 110), pt(ts(2026, 0, 11, 14), 100, 110)];
  const now = new Date(2026, 0, 20, 12, 0, 0);
  assert.equal(windowStats(daytimeOnly, { wStart: 22, wEnd: 6, now }), null);
});

// --- 4. recencySplit: the reach-contamination guard (two-sided) ------------------------------
// days shape = windowStats().days: [[key,{low,hi}], …] oldest→newest. Model the two live anchors.
const day = (key, low, hi) => [key, { low, hi }];

ok('recencySplit ASK: a falling/crashed item reaches the ask on OLD days only → stale-optimistic', () => {
  // blood-rune shape: pre-crash highs 313–315 reach a 313 ask; recent recovery tops 299–310 do NOT.
  const days = [
    day('d1', 306, 313), day('d2', 305, 314), day('d3', 306, 315), day('d4', 300, 315), // old: reach 313
    day('d5', 272, 286), day('d6', 269, 281), day('d7', 272, 283),                        // crash: don't
    day('d8', 286, 299), day('d9', 290, 301), day('d10', 300, 310),                        // recent 3: don't
  ];
  const s = recencySplit(days, 'ask', 313);
  assert.equal(s.fullHit, 4, '313 reached on the 4 pre-crash days');
  assert.equal(s.recentHit, 0, 'the recent 3 nights top out 299–310 — none reach 313');
  assert.equal(s.diverges, true);
  assert.equal(s.staleOptimistic, true, 'full count (4/10) is rosier than recent (0/3) — the trap');
});

ok('recencySplit BID: a rising/repriced item was touched on OLD days only → stale-optimistic', () => {
  // floor repriced UP: a 100 bid was touched on old cheap days; recent nights bottom at 130+.
  const days = [
    day('d1', 95, 110), day('d2', 98, 112), day('d3', 90, 111), day('d4', 100, 115), // old: dip ≤100
    day('d5', 120, 140), day('d6', 128, 145), day('d7', 132, 150),                    // recent 3: don't
  ];
  const s = recencySplit(days, 'bid', 100);
  assert.equal(s.fullHit, 4, '100 touched on the 4 old cheap days');
  assert.equal(s.recentHit, 0, 'recent 3 nights bottom at 120+ — never dip to 100');
  assert.equal(s.staleOptimistic, true, 'the bid looks reachable only off a stale cheaper regime');
});

ok('recencySplit: a STABLE item does not flag (recent frac ≈ full frac)', () => {
  const days = [
    day('d1', 100, 200), day('d2', 102, 198), day('d3', 99, 201), day('d4', 101, 199),
    day('d5', 100, 200), day('d6', 98, 202), day('d7', 101, 199),
  ];
  const s = recencySplit(days, 'ask', 199);           // reached every day, old and recent alike
  assert.equal(s.diverges, false, 'a stable item is reached consistently → no divergence, no ⚠');
  assert.equal(s.staleOptimistic, false);
});

ok('recencySplit: too little history is unscored (no false ⚠ on a thin series)', () => {
  const days = [day('d1', 100, 200), day('d2', 100, 300), day('d3', 100, 400)]; // fullN < recentN+2
  const s = recencySplit(days, 'ask', 400);
  assert.equal(s.diverges, false, 'not enough days behind the recent window to make the call');
});

ok('recentQuant: returns the recent-N slice quantile, not the full window', () => {
  const days = [
    day('d1', 90, 300), day('d2', 92, 305), day('d3', 88, 310),  // old (ignored by recent-3)
    day('d4', 130, 200), day('d5', 132, 205), day('d6', 128, 210), // recent 3
  ];
  assert.equal(recentQuant(days, 'bid', 0.5, 3), 130, 'recent-3 median low, not the old ~90');
});

// --- reachMargin: the cushion-fade check (ask/bid symmetric) + today's pace ------------------
ok('reachMargin ASK: a collapsing cushion over the ask reads FADING (the godsword shape)', () => {
  const days = [day('d1', 90, 130), day('d2', 90, 128), day('d3', 90, 125),
                day('d4', 90, 122), day('d5', 90, 121), day('d6', 90, 120)];   // highs stepping toward the 100 ask
  const rm = reachMargin(days, 'ask', 100, { marginN: 6 });
  assert.equal(rm.trend, 'fading', 'newer-half cushion < older-half by > threshold ⇒ fading');
  assert.equal(rm.cushionNow, 20, 'most-recent cushion = 120 − 100');
  assert.equal(rm.reachedRecent, 6, 'all 6 recent highs still clear the ask (reached), but the cushion is shrinking');
  assert.ok(rm.cushionFrom > rm.cushionTo, 'older-half cushion is larger than newer-half (the collapse)');
});

ok('reachMargin R4: the rebased trend tracks the genuine multi-day cushion direction THROUGH a mid-series spike (least-squares, not a 2-bucket diff)', () => {
  // cushions over the 100 ask = hi−100 = [60,55,80,45,40,35,30] — a real decline with a d3 up-spike to 80.
  // the least-squares slope reads the genuine fade; the point is the trend is now the ONE shared
  // projectTrajectory primitive (consolidation), fitting ALL days, not the old oldest-3-vs-newest-3 diff.
  const days = [day('d1', 90, 160), day('d2', 90, 155), day('d3', 90, 180),
                day('d4', 90, 145), day('d5', 90, 140), day('d6', 90, 135), day('d7', 90, 130)];
  const rm = reachMargin(days, 'ask', 100, { marginN: 7 });
  assert.equal(rm.trend, 'fading', 'the fitted slope reads the genuine decline despite the mid-series spike');
  assert.ok(rm.cushionSlope < 0, 'cushionSlope is the robust per-day least-squares slope (negative = fading)');
});

ok('reachMargin ASK: a steady cushion reads STABLE; BID mirror scores level−low', () => {
  const flat = [day('d1', 90, 125), day('d2', 90, 125), day('d3', 90, 125),
                day('d4', 90, 125), day('d5', 90, 125), day('d6', 90, 125)];
  assert.equal(reachMargin(flat, 'ask', 100, { marginN: 6 }).trend, 'stable', 'cushion flat ⇒ stable');
  // BID side: cushion = level − dayLow; a low well under the bid is a comfortable fill
  const bidDays = [day('d1', 70, 130), day('d2', 72, 130), day('d3', 71, 130)];
  const rb = reachMargin(bidDays, 'bid', 100, { marginN: 6 });
  assert.equal(rb.cushionNow, 29, 'bid cushion = 100 − 71');
  assert.equal(rb.reachedRecent, 3, 'all lows dip below the bid (touched)');
});

ok('reachMargin: pace compares live-now to the reaching-day median at THIS hour (lagging when light)', () => {
  const days = [day('d1', 90, 120), day('d2', 90, 121), day('d3', 90, 122), day('d4', 90, 123)];
  const profile = { hours: [{ h: 16, lowRecent: 90, hiRecent: 130, n: 15 }] };
  const now = new Date(2026, 0, 20, 16, 0, 0);
  const rm = reachMargin(days, 'ask', 100, { marginN: 6, profile, live: { lo: 85, hi: 120 }, now });
  assert.equal(rm.pace.gap, -10, 'live instabuy 120 vs the 16:00 median high 130 ⇒ −10');
  assert.equal(rm.pace.onPace, false, 'running below the reaching-day median at this hour ⇒ lagging');
  assert.equal(rm.pace.n, 15, 'the hour sample size rides along (honesty: sparse still surfaces)');
  // no profile / no live ⇒ pace null, the rest still computes
  assert.equal(reachMargin(days, 'ask', 100, { marginN: 6 }).pace, null);
});

ok('reachMargin: a STALE live side yields a {stale} pace marker, never a false lagging/on-pace read (the 64-min godsword)', () => {
  const days = [day('d1', 90, 120), day('d2', 90, 121), day('d3', 90, 122), day('d4', 90, 123)];
  const profile = { hours: [{ h: 16, lowRecent: 90, hiRecent: 130, n: 15 }] };
  const now = new Date(2026, 0, 20, 16, 0, 0);
  // ask side driven by a stale instabuy (staleHi) ⇒ pace is a stale marker carrying the age, not a comparison
  const stale = reachMargin(days, 'ask', 100, { marginN: 6, profile, live: { lo: 85, hi: 120, staleHi: true, hiAgeMin: 64 }, now });
  assert.equal(stale.pace.stale, true, 'stale instabuy ⇒ pace.stale');
  assert.equal(stale.pace.ageMin, 64, 'the print age rides on the marker');
  assert.equal(stale.pace.gap, undefined, 'NO gap computed off a stale print (that was the false-lagging bug)');
  // the SAME numbers with the side marked fresh ⇒ the real comparison returns (guard only fires on stale)
  const fresh = reachMargin(days, 'ask', 100, { marginN: 6, profile, live: { lo: 85, hi: 120, staleHi: false }, now });
  assert.equal(fresh.pace.stale, undefined, 'fresh side ⇒ real pace, no stale marker');
  assert.equal(fresh.pace.gap, -10, 'fresh instabuy 120 vs the 16:00 median 130 ⇒ −10');
  // bid side reads its OWN freshness (staleLo), independent of the ask side
  const bidStale = reachMargin(days, 'bid', 100, { marginN: 6, profile, live: { lo: 85, hi: 120, staleLo: true, loAgeMin: 40 }, now });
  assert.equal(bidStale.pace.stale, true, 'stale instasell ⇒ bid pace stale');
  assert.equal(bidStale.pace.ageMin, 40, 'bid side carries the instasell age');
});

ok('reachMargin: fewer than MARGIN_MIN_DAYS recent days ⇒ trend null (no false classification)', () => {
  const days = [day('d1', 90, 120), day('d2', 90, 121)];
  const rm = reachMargin(days, 'ask', 100, { marginN: 6 });
  assert.equal(rm.trend, null, 'too thin to split halves ⇒ no trend');
  assert.equal(rm.cushionNow, 21, 'but the current cushion still reports');
  assert.equal(reachMargin([], 'ask', 100), null, 'empty days ⇒ null (degrade, never a fake read)');
  assert.equal(reachMargin([day('d1', 90, 120)], 'ask', null), null, 'null level ⇒ null');
});

// --- 5. hourProfile: locate + CLUSTER the daily dip and peak windows -------------------------
// Build a synthetic diurnal shape over 6 days: lows dip in the evening (21–23), highs peak in the
// early morning (04–06); everything else flat. now is a daytime instant so nothing special-cases.
function diurnal(days, { baseFn }) {
  const s = [];
  for (let di = 0; di < days; di++) for (let h = 0; h < 24; h++) {
    const base = baseFn(di);
    const low = base + ([21, 22, 23].includes(h) ? -50 : 0);
    const hi = base + ([4, 5, 6].includes(h) ? 70 : 10);
    s.push(pt(ts(2026, 0, 5 + di, h), low, hi, 20, 20));
  }
  return s;
}
const noonNow = new Date(2026, 0, 20, 12, 0, 0);

ok('hourProfile: finds the evening dip window and morning peak window, clustered', () => {
  const prof = hourProfile(diurnal(6, { baseFn: () => 1000 }), { nights: 14, now: noonNow });
  assert.ok(prof, 'a 6-day series is profilable');
  assert.deepEqual(prof.dip.hours, [21, 22, 23], 'dip clusters the three evening hours');
  assert.equal(prof.dip.startH, 21); assert.equal(prof.dip.endH, 0, 'dip window 21:00–00:00');
  assert.deepEqual(prof.peak.hours, [4, 5, 6], 'peak clusters the three morning hours');
  assert.equal(prof.peak.startH, 4); assert.equal(prof.peak.endH, 7, 'peak window 04:00–07:00');
  assert.equal(prof.dip.level, 950, 'dip level = the recent dip-hour low');
  assert.equal(prof.peak.level, 1070, 'peak level = the recent peak-hour high (base 1000 + 70)');
  assert.equal(prof.trendDominates, false, 'a flat base has no dominating trend');
  // PLAN-MULTI-PEAK-WINDOWS fixture (f) — the additive peaks/dips arrays exist, are single-window on a
  // one-hump-per-side shape, and their rank-1 is BYTE-IDENTICAL to the existing primary (deep-equal proof).
  assert.equal(prof.peaks.length, 1, 'a single morning peak ⇒ no manufactured secondary');
  assert.equal(prof.dips.length, 1, 'a single evening dip ⇒ no manufactured secondary');
  assert.deepEqual(prof.peaks[0], prof.peak, 'peaks[0] deep-equals the existing primary peak');
  assert.deepEqual(prof.dips[0], prof.dip, 'dips[0] deep-equals the existing primary dip');
});

ok('hourProfile: a rising floor sets trendDominates when drift outpaces the intraday swing', () => {
  const prof = hourProfile(diurnal(6, { baseFn: di => 900 + 50 * di }), { nights: 14, now: noonNow });
  assert.ok(prof);
  assert.deepEqual(prof.dip.hours, [21, 22, 23], 'shape survives the trend (dip still evening)');
  assert.ok(prof.trendPerDay > 0, 'the daily-low slope is positive');
  assert.equal(prof.trendDominates, true, '≈50/day drift ≥ 0.25×~120 amplitude → dominates');
  assert.deepEqual(prof.peaks[0], prof.peak, 'peaks[0] deep-equals the primary through a rising floor too');
  assert.deepEqual(prof.dips[0], prof.dip, 'dips[0] deep-equals the primary through a rising floor too');
});

ok('hourProfile: too little history is unprofilable (null, no false read)', () => {
  assert.equal(hourProfile(diurnal(2, { baseFn: () => 1000 }), { nights: 14, now: noonNow }), null,
    '2 days < HOURPROFILE_MIN_DAYS');
});

// --- PLAN-MULTI-PEAK-WINDOWS: multi-extremum / topographic-prominence detection ------------------
// A per-hour offset builder (flat lows OR flat highs on one side, a controlled two/one-hump shape on the
// other) so each fixture pins the prominence math exactly. base 1000; 6 days is profilable.
function shaped(days, { hiOff = () => 0, lowOff = () => 0, base = 1000 } = {}) {
  const s = [];
  for (let di = 0; di < days; di++) for (let h = 0; h < 24; h++) {
    s.push(pt(ts(2026, 0, 5 + di, h), base + lowOff(h), base + hiOff(h), 20, 20));
  }
  return s;
}

ok('hourProfile (a): a FLAT profile manufactures NO spurious secondary window (the load-bearing honesty pin)', () => {
  const prof = hourProfile(shaped(6, { hiOff: () => 100, lowOff: () => -100 }), { nights: 14, now: noonNow });
  assert.ok(prof, 'constant-shape series is still profilable');
  assert.equal(prof.peaks.length, 1, 'zero intraday shape ⇒ NO second peak (spread 0 ⇒ no candidates)');
  assert.equal(prof.dips.length, 1, 'zero intraday shape ⇒ NO second dip');
  assert.deepEqual(prof.peaks[0], prof.peak);
  assert.deepEqual(prof.dips[0], prof.dip);
});

ok('hourProfile (b): a genuine TWO-peak shape (boots-like: 4–6 primary + 12–16 secondary, real trough between) surfaces both', () => {
  const hiOff = h => [4, 5, 6].includes(h) ? 70 : ([12, 13, 14, 15, 16].includes(h) ? 50 : 0);
  const prof = hourProfile(shaped(6, { hiOff }), { nights: 14, now: noonNow });
  assert.equal(prof.peaks.length, 2, 'two genuinely elevated windows ⇒ both surface');
  assert.deepEqual(prof.peaks[0], prof.peak, 'peaks[0] is the unchanged primary (4–7)');
  assert.deepEqual(prof.peaks[0].hours, [4, 5, 6]);
  assert.deepEqual(prof.peaks[1].hours, [12, 13, 14, 15, 16], 'peaks[1] grows the 12–16 window');
  assert.equal(prof.peaks[1].startH, 12); assert.equal(prof.peaks[1].endH, 17, 'secondary span 12:00–17:00');
  assert.ok(prof.peaks[1].prominenceFrac >= SECOND_PROMINENCE_FRAC, `secondary clears the gate (frac ${prof.peaks[1].prominenceFrac.toFixed(3)})`);
  const shared = prof.peaks[1].hours.filter(h => prof.peaks[0].hours.includes(h));
  assert.equal(shared.length, 0, 'the two windows share NO hour (non-overlap by construction)');
  assert.equal(prof.dips.length, 1, 'flat lows ⇒ NO manufactured secondary dip on the peak-only fixture');
});

ok('hourProfile (c): a SHALLOW shoulder (real-but-weak bump, prominenceFrac < 0.3) is correctly REJECTED', () => {
  // primary 70 at 4–6, a mild 15 bump at 12–14, valley 0 between → frac = 15/70 ≈ 0.214 < 0.3.
  const hiOff = h => [4, 5, 6].includes(h) ? 70 : ([12, 13, 14].includes(h) ? 15 : 0);
  const prof = hourProfile(shaped(6, { hiOff }), { nights: 14, now: noonNow });
  assert.equal(prof.peaks.length, 1, 'the weak bump fails the prominence gate — distinct from (a) "no bump at all"');
  assert.deepEqual(prof.peaks[0], prof.peak);
});

ok('hourProfile (d): DIP-SIDE mirror — two genuine dips surface, a shallow dip shoulder is rejected (ship-together proof)', () => {
  // two-dip: primary −70 at 21–23, secondary −50 at 8–10, flat highs.
  const twoDip = h => [21, 22, 23].includes(h) ? -70 : ([8, 9, 10].includes(h) ? -50 : 0);
  const p2 = hourProfile(shaped(6, { lowOff: twoDip }), { nights: 14, now: noonNow });
  assert.equal(p2.dips.length, 2, 'two genuinely depressed windows ⇒ both surface (symmetric to the peak side)');
  assert.deepEqual(p2.dips[0], p2.dip, 'dips[0] is the unchanged primary');
  assert.deepEqual(p2.dips[1].hours, [8, 9, 10], 'dips[1] grows the 08–10 window');
  assert.ok(p2.dips[1].prominenceFrac >= SECOND_PROMINENCE_FRAC);
  assert.equal(p2.dips[1].hours.filter(h => p2.dips[0].hours.includes(h)).length, 0, 'non-overlapping');
  assert.equal(p2.peaks.length, 1, 'flat highs ⇒ NO manufactured secondary peak');
  // shallow-dip mirror of (c): primary −70 at 21–23, weak −15 shoulder at 8–10 → frac ≈ 0.214 rejected.
  const shallow = h => [21, 22, 23].includes(h) ? -70 : ([8, 9, 10].includes(h) ? -15 : 0);
  const ps = hourProfile(shaped(6, { lowOff: shallow }), { nights: 14, now: noonNow });
  assert.equal(ps.dips.length, 1, 'the weak dip shoulder is rejected symmetrically');
});

ok('hourProfile (e): thin history (< HOURPROFILE_MIN_DAYS) still returns null for the WHOLE profile — no peaks/dips to read', () => {
  const prof = hourProfile(shaped(2, { hiOff: h => [4, 5, 6].includes(h) ? 70 : 0 }), { nights: 14, now: noonNow });
  assert.equal(prof, null, '2 days < HOURPROFILE_MIN_DAYS ⇒ null, the pre-existing early-return is unregressed');
});

// --- 5b. PLAN-DIURNAL-RECENCY-GUARD: the level-reality read (spikeTop / staleOptimistic) --------
// Layer A mechanics: computeReality reads over a cluster's per-day HIGHS (ask) / LOWS (bid). Build the
// clusterDays array directly ([[key,{low,hi}], …] oldest→newest) so each flag's math is pinned exactly.
const cdays = (his, side = 'ask') => his.map((h, i) => [`d${String(i).padStart(2, '0')}`,
  side === 'bid' ? { low: h, hi: h + 1000 } : { low: h - 1000, hi: h }]);

ok('computeReality (spike): a recent 2-of-3 spike over a flat regime flags spikeTop, typicalLevel at the flat level, raw level UNCHANGED', () => {
  // 14 days flat highs 19.0m, the last 2 spike to 19.5m; the emitted (contaminated) level is 19.5m.
  const his = [...Array(12).fill(19_000_000), 19_500_000, 19_500_000];
  const r = computeReality(cdays(his, 'ask'), 19_500_000, 'ask');
  assert.equal(r.spikeTop, true, 'low reach + top placement + a recent print + a real gap ⇒ spikeTop');
  assert.equal(r.staleOptimistic, false, 'recent is ROSIER than full here — the opposite shape, not stale');
  assert.equal(r.reachedDays, 2); assert.equal(r.nDays, 14);
  assert.ok(r.reachedDays / r.nDays <= SPIKE_REACH_FRAC, 'reach fraction under the spike bar');
  assert.equal(r.typicalLevel, 19_000_000, 'typicalLevel = recent-7 q55 lands on the flat level, NOT the spike');
  // the guard FLAGS; it never rewrites the level — computeReality returns no `level`, and the caller's is intact
  assert.ok(Math.abs(19_500_000 - r.typicalLevel) / r.typicalLevel >= SPIKE_MIN_GAP_FRAC, 'the gap clears the min-gap floor');
});

ok('computeReality (bid spike): a flash-crash low dragging the recent dip DOWN flags spikeTop with the BOTTOM-of-distribution placement (direction flips by side)', () => {
  // dip LOWS flat 18.0m, the last 2 flash-crash to 17.5m; the emitted dip level is the 17.5m low.
  const lows = [...Array(12).fill(18_000_000), 17_500_000, 17_500_000];
  const r = computeReality(cdays(lows, 'bid'), 17_500_000, 'bid');
  assert.equal(r.spikeTop, true, 'bid-side spike uses placement ≤ 1−p (the bottom of the daily-LOW distribution)');
  assert.ok(r.placement <= 1 - SPIKE_PLACEMENT_PCTILE, 'placement is at the BOTTOM, not the top');
  assert.equal(r.typicalLevel, 18_000_000, 'typicalLevel = recent-7 q55 of lows lands on the flat floor');
});

ok('computeReality (crash): an old-high-now-crashed level flags staleOptimistic, NOT spikeTop', () => {
  // highs 19.0m for 11 days, then the recent 3 crash to 17.0m; score the OLD 19.0m high.
  const his = [...Array(11).fill(19_000_000), 17_000_000, 17_000_000, 17_000_000];
  const r = computeReality(cdays(his, 'ask'), 19_000_000, 'ask');
  assert.equal(r.staleOptimistic, true, 'recent 0/3 vs full 11/14 ⇒ stale-optimistic (the crash shape)');
  assert.equal(r.spikeTop, false, 'reach is HIGH (11/14) and recentHit is 0 ⇒ never spikeTop — the flags never steal each other');
  assert.equal(r.recentHit, 0, 'the old high does not print in the recent window');
});

ok('computeReality (clean): a flat stable regime raises NEITHER flag and typicalLevel ≈ level (the anti-cry-wolf floor)', () => {
  const his = Array(14).fill(19_000_000);
  const r = computeReality(cdays(his, 'ask'), 19_000_000, 'ask');
  assert.equal(r.spikeTop, false); assert.equal(r.staleOptimistic, false);
  assert.equal(r.typicalLevel, 19_000_000, 'typicalLevel == level on a flat series (no divergence to report)');
  assert.equal(realityClause(r, { side: 'ask', fmt: String, style: 'full' }), '', 'a clean read renders an EMPTY clause (byte-identical surfaces)');
});

// A spike series driven through the REAL hourProfile — proves the reality object rides the emitted
// peak, the raw level is the (contaminated) recent median, and the multi-peak deep-equal invariant holds.
function spikeProfileSeries() {
  const s = [];
  for (let di = 0; di < 14; di++) {
    const spike = di >= 12;                                  // the last 2 days spike (2-of-recent-3)
    for (let h = 0; h < 24; h++) {
      const peakHour = [4, 5, 6].includes(h);
      const hi = peakHour ? (spike ? 19_500_000 : 19_100_000) : 19_000_000;
      const low = [21, 22, 23].includes(h) ? 18_850_000 : 18_900_000;
      s.push(pt(ts(2026, 0, 5 + di, h), low, hi, 20, 20));
    }
  }
  return s;
}

ok('hourProfile: the emitted PEAK carries a spikeTop reality read on a recent-spike series (raw level unchanged, invariant intact)', () => {
  const prof = hourProfile(spikeProfileSeries(), { nights: 14, now: noonNow });
  assert.ok(prof && prof.peak.reality, 'a reality object rides the emitted peak');
  assert.equal(prof.peak.level, 19_500_000, 'the RAW level is still the contaminated recent median (we flag, not rewrite)');
  assert.equal(prof.peak.reality.spikeTop, true, 'the recent 2-day spike is flagged');
  assert.ok(prof.peak.reality.typicalLevel <= 19_100_000,
    `typicalLevel (${prof.peak.reality.typicalLevel}) points at the reachable ~19.1m level, not the 19.5m spike`);
  // §4 deep-equal invariant — peaks[0]/dips[0] SHARE the object by referential identity; every field
  // except the additive `reality` stays identical even if a future refactor drops the sharing.
  assert.strictEqual(prof.peaks[0], prof.peak, 'peaks[0] is the SAME reference as peak');
  assert.strictEqual(prof.dips[0], prof.dip, 'dips[0] is the SAME reference as dip');
  const { reality: _r1, ...peakRest } = prof.peaks[0];
  const { reality: _r2, ...peakBase } = prof.peak;
  assert.deepStrictEqual(peakRest, peakBase, 'every non-reality field of peaks[0] equals peak');
  assert.ok(prof.peak.reality === undefined || typeof prof.peak.reality === 'object');
});

// --- 6. deriveDiurnalRange: the stale-to-live guard (the Ghrazi lesson) -----------------------
const prof = (dipLevel, peakLevel, trendDominates) => ({
  dip: { level: dipLevel, startH: 21, endH: 0 }, peak: { level: peakLevel, startH: 4, endH: 7 },
  amplitude: peakLevel - dipLevel, amplitudePct: null, trendPerDay: trendDominates ? 50 : 0, trendDominates,
});

ok('deriveDiurnalRange: an erased dip (dip ≥ live) is priced to live, not to a stale low', () => {
  const r = deriveDiurnalRange(prof(1000, 1080, true), { liveLo: 990 });
  assert.equal(r.bid, 990, 'live instasell (990) is already below the stale 1000 dip → bid to live');
  assert.equal(r.bidBasis, 'live');
  assert.ok(r.notes.some(n => /trend-dominates/.test(n)));
});

ok('deriveDiurnalRange: a dip below live under a rising floor stays patient but is flagged may-miss', () => {
  const r = deriveDiurnalRange(prof(1000, 1080, true), { liveLo: 1010 });
  assert.equal(r.bid, 1000, 'the dip (1000) is genuinely below live (1010) → keep the patient bid');
  assert.equal(r.bidBasis, 'patient-dip');
  assert.ok(r.notes.some(n => /may miss/.test(n)), 'but warn the rising floor may starve it');
});

ok('deriveDiurnalRange: a clean dip below live with no trend is an unflagged patient bid', () => {
  const r = deriveDiurnalRange(prof(1000, 1080, false), { liveLo: 1010 });
  assert.equal(r.bid, 1000); assert.equal(r.bidBasis, 'patient-dip');
  assert.equal(r.notes.length, 0, 'no trend, dip below live → nothing to warn about');
  assert.equal(r.ask, 1080);
});

// --- 6b. softBuyRead / formatSoftBuy: the ADD-while-holding soft-buy timing read ---------------
// Reuses the deriveDiurnalRange `prof` helper (dip level + a 21:00–00:00 dip window). The floor is the
// dip level; live is the buy-side price; the @floor↔+X% marker flips at SOFT_BUY_AT_FLOOR_PCT (0.5%).
ok('softBuyRead: live at/below the dip floor ⇒ @floor · buy now', () => {
  const sb = softBuyRead(prof(1000, 1080, false), { live: 1000 });
  assert.equal(sb.floor, 1000);
  assert.deepEqual(sb.dipWindow, { startH: 21, endH: 0 }, 'the diurnal dip window is the cheapest add hours');
  assert.equal(sb.marker, '@floor'); assert.equal(sb.buyNow, true);
  assert.equal(formatSoftBuy(sb), 'soft-buy: dip 21:00–00:00 · live @floor · buy now');
});

ok('softBuyRead: live within the 0.5% threshold over the floor still reads @floor (buy now)', () => {
  const sb = softBuyRead(prof(1000, 1080, false), { live: 1004 });   // +0.4% ≤ 0.5%
  assert.ok(sb.overPct > 0 && sb.overPct <= SOFT_BUY_AT_FLOOR_PCT);
  assert.equal(sb.marker, '@floor'); assert.equal(sb.buyNow, true);
});

ok('softBuyRead: live above the dip ⇒ +X% · wait', () => {
  const sb = softBuyRead(prof(1000, 1080, false), { live: 1027 });   // +2.7%
  assert.equal(sb.marker, '+2.7%'); assert.equal(sb.buyNow, false);
  assert.equal(formatSoftBuy(sb), 'soft-buy: dip 21:00–00:00 · live +2.7% · wait');
});

ok('softBuyRead: no live reference ⇒ window-only note, no buy/wait cue', () => {
  const sb = softBuyRead(prof(1000, 1080, false), {});
  assert.equal(sb.marker, null); assert.equal(sb.buyNow, null);
  assert.equal(formatSoftBuy(sb), 'soft-buy: dip 21:00–00:00');
});

ok('softBuyRead: a null / dip-less profile ⇒ null ⇒ the note never renders', () => {
  assert.equal(softBuyRead(null, { live: 1000 }), null);
  assert.equal(softBuyRead({ peak: { level: 1080 } }, { live: 1000 }), null, 'no dip ⇒ null');
  assert.equal(softBuyRead({ dip: { level: null, startH: 21, endH: 0 } }, { live: 1000 }), null, 'no dip level ⇒ null');
  assert.equal(formatSoftBuy(null), null, 'null read ⇒ no note');
});

// --- PART II (PLAN-GRADE-REACH): asymPair — deep-buy / reliable-sell realizable pair ----------
// 14 synthetic nights. lows/his ascending (windowStats' contract); days only carries the count here.
const asymStats = (lows, his) => ({ days: Array.from({ length: Math.max(lows.length, his.length) }, (_, i) => [`d${i}`, {}]), lows: [...lows].sort((a, b) => a - b), his: [...his].sort((a, b) => a - b) });

ok('asymPair: deep bid = the ASYM_P_LO low quantile (rare fill), ask = the ASYM_P_HI high quantile (near-certain print)', () => {
  const lows = Array.from({ length: 14 }, (_, i) => 100 + i * 10);   // 100…230
  const his = Array.from({ length: 14 }, (_, i) => 300 + i * 10);   // 300…430
  const p = asymPair(asymStats(lows, his));
  assert.equal(p.deepBid, quantLow(lows, ASYM_P_LO), 'deep bid is the flush quantile');
  assert.equal(p.highReachAsk, quantHigh(his, ASYM_P_HI), 'ask is the high-reach quantile');
  // the realized fractions are consistent with the quantile definitions (ties can only push them ≥ p)
  assert.equal(p.pBid, touchedDays(lows, p.deepBid) / 14);
  assert.equal(p.pAsk, reachedDays(his, p.highReachAsk) / 14);
  assert.ok(p.pBid <= 0.5, 'the deep bid fills on a MINORITY of nights (the rare flush)');
  assert.ok(p.pAsk >= 0.75, 'the ask prints on a large MAJORITY of nights (the near-certain exit)');
  assert.equal(p.nDays, 14);
});

ok('asymPair degrades: null stats / empty sides / a sample thinner than ASYM_MIN_DAYS → null (never a fake pair)', () => {
  assert.equal(asymPair(null), null);
  assert.equal(asymPair({ days: [], lows: [], his: [] }), null);
  const thinN = ASYM_MIN_DAYS - 1;
  const thin = Array.from({ length: thinN }, (_, i) => 100 + i);
  assert.equal(asymPair(asymStats(thin, thin)), null, 'thin day sample → null');
});

// --- windowClear (PLAN-WINDOW-CLEAR B1): within-window reach + absorption pool + clearRatio -----
// one 15:00 point per day inside a 14–17 window; controlled window-high + high-side volume.
const dayPt = (d, hi, volHi) => pt(ts(2026, 0, d, 15), hi - 20, hi, 10, volHi);
const clearNow = new Date(2026, 0, 25, 12, 0, 0);   // daytime (hour 12 ∉ 14–17) → nothing skipped

ok('windowClear: window-reach fraction + absorption pool + clearRatio off the target window', () => {
  const series = [
    dayPt(10, 1050, 100), dayPt(11, 1050, 100),                              // two days reach 1040
    dayPt(12, 1020, 80), dayPt(13, 1020, 80), dayPt(14, 1020, 80), dayPt(15, 1020, 80),
  ];
  const opts = { wStart: 14, wEnd: 17, now: clearNow };
  // ask under every window-high → reaches all 6 days
  const dense = windowClear(series, { ask: 1000, units: 10, ...opts });
  assert.equal(dense.nDays, 6);
  assert.equal(dense.windowReach, 1, 'ask under every window-high → reaches all 6 days');
  // ask above most window-highs → only the two 1050-days print inside the window
  const thin = windowClear(series, { ask: 1040, units: 10, ...opts });
  assert.equal(thin.reachedDays, 2);
  assert.ok(Math.abs(thin.windowReach - 2 / 6) < 1e-9, 'low within-window reach even if all-day reach is fine');
  assert.equal(thin.pool, 100, 'pool = median window volHi on the days the ask printed');
  assert.ok(Math.abs(thin.clearRatio - 10 / 100) < 1e-9, 'clearRatio = units ÷ pool');
  // ask above EVERYTHING → 0 reached, pool 0, clearRatio null (never divide by zero)
  const none = windowClear(series, { ask: 2000, units: 10, ...opts });
  assert.equal(none.windowReach, 0);
  assert.equal(none.pool, 0);
  assert.equal(none.clearRatio, null);
  assert.equal(windowClear(series, { ask: null, ...opts }), null, 'no ask → no read');
});

ok('windowClear: null on a too-thin window; windowClearDiverges flags the two traps', () => {
  const few = [dayPt(10, 1050, 100), dayPt(11, 1050, 100), dayPt(12, 1050, 100)];   // 3 < WINCLEAR_MIN_DAYS (4)
  assert.equal(windowClear(few, { ask: 1000, wStart: 14, wEnd: 17, now: clearNow }), null, 'thin window → null');
  // days-reach healthy but within-window reach low → windowShort (the days-reach ≠ lap-clear trap)
  const short = windowClearDiverges({ windowReach: 0.2, clearRatio: 0.1 }, 0.9);
  assert.ok(short.diverges && short.windowShort && !short.sizeShort);
  // size ≫ pool → sizeShort even with a fine within-window reach
  const big = windowClearDiverges({ windowReach: 0.9, clearRatio: 3 }, 0.9);
  assert.ok(big.diverges && big.sizeShort && !big.windowShort);
  // both fine → no divergence; null read → no divergence
  assert.ok(!windowClearDiverges({ windowReach: 0.9, clearRatio: 0.1 }, 0.9).diverges);
  assert.ok(!windowClearDiverges(null).diverges);
});

// --- percentile-depth exit (PLAN-DEPTH-EXIT DE1) -----------------------------------------------
// Multi-bucket days: several 1h prints per day at different (price, volume) so depth distributes
// across price (windowStats collapses this to a day max/total; depth needs the point masses).
const dDay = (d, buckets) => buckets.map(b => pt(ts(2026, 0, d, b.h), b.hi - 500, b.hi, 10, b.volHi));
const dNow = new Date(2026, 0, 25, 12, 0, 0);              // hour 12 ∉ 14–17 → no "today" skip games
const dOpts = { wStart: 14, wEnd: 17, now: dNow, nights: 14 };

// PLAN-REMOVE-DEPTH-PRESSURE-READS chunk 1: the `depthDays` subsumption test was removed with depthDays.
ok('clearableAsk: deep book + small size books HIGH; a large lot books lower (size-honest, monotone)', () => {
  const series = [];   // every day trades deeply at 400 and 396 (1000 u each)
  for (let d = 10; d <= 16; d++) series.push(...dDay(d, [{ h: 14, hi: 400, volHi: 1000 }, { h: 15, hi: 396, volHi: 1000 }]));
  const small = clearableAsk(series, { qty: 10, ...dOpts });     // need 40 → clears the very top
  assert.equal(small.price, 400);
  assert.ok(small.clearFrac >= 0.75 && small.reason == null);
  assert.ok(small.competition === 4 && small.targetFrac === 0.75 && small.minBuckets === 2, 'return echoes the effective params (DE2 states them without importing the consts)');
  const large = clearableAsk(series, { qty: 400, ...dOpts });    // need 1600 → 400 alone (1000) can't; 396 cumulative (2000) can
  assert.ok(large.price != null && large.price < small.price, 'a large lot books LOWER (needs cumulative depth)');
});

ok('clearableAsk: a thin book / oversized lot collapses to null WITH a reason (mirage guard, surfaced)', () => {
  const thin = [];   // 6 days but ~nothing trades — flow can\'t absorb the lot at any level
  for (let d = 10; d <= 15; d++) thin.push(...dDay(d, [{ h: 14, hi: 400, volHi: 3 }, { h: 15, hi: 396, volHi: 3 }]));
  const r = clearableAsk(thin, { qty: 100, ...dOpts });          // need 400 ≫ 6 u/day
  assert.equal(r.price, null);
  assert.equal(r.reason, 'insufficient-depth', 'never a silent null — the liquidity collapse is named');
  const few = dDay(10, [{ h: 14, hi: 400, volHi: 1000 }]).concat(dDay(11, [{ h: 14, hi: 400, volHi: 1000 }]));
  assert.equal(clearableAsk(few, { qty: 1, ...dOpts }).reason, 'thin-history', '< minDays scored → thin-history');
});

ok('clearableAsk: monotone — higher qty/competition/targetFrac never books HIGHER', () => {
  const series = [];   // three price tiers/day: 410(200) · 400(400) · 390(800)
  for (let d = 10; d <= 16; d++) series.push(...dDay(d, [{ h: 14, hi: 410, volHi: 200 }, { h: 15, hi: 400, volHi: 400 }, { h: 16, hi: 390, volHi: 800 }]));
  const p = q => clearableAsk(series, { qty: q, ...dOpts }).price ?? -Infinity;
  assert.ok(p(10) >= p(100) && p(100) >= p(300), 'price non-increasing in qty');
  const byComp = c => clearableAsk(series, { qty: 50, competition: c, ...dOpts }).price ?? -Infinity;
  assert.ok(byComp(1) >= byComp(4) && byComp(4) >= byComp(8), 'price non-increasing in competition');
  const byFrac = f => clearableAsk(series, { qty: 50, targetFrac: f, ...dOpts }).price ?? -Infinity;
  assert.ok(byFrac(0.5) >= byFrac(0.75) && byFrac(0.75) >= byFrac(1), 'price non-increasing in targetFrac');
});

ok('clearableAsk: minBuckets guard — a lone fat bucket at the top cannot set the clearable ask', () => {
  const series = [...dDay(10, [{ h: 14, hi: 420, volHi: 100000 }])];   // one day, one huge 420 flier
  for (let d = 11; d <= 16; d++) series.push(...dDay(d, [{ h: 14, hi: 400, volHi: 1000 }, { h: 15, hi: 398, volHi: 1000 }]));
  const r = clearableAsk(series, { qty: 10, ...dOpts });               // 420 is supported by 1 bucket (< minBuckets 2) → skipped
  assert.ok(r.price != null && r.price <= 400, 'the lone 420 flier does not set the ask — the dense top ≤400 does');
});

// PLAN-REMOVE-DEPTH-PRESSURE-READS chunk 1: the DE6 clearableBid low-side-mirror tests (+ the `bDay`
// builder + the depthDays side:bid subsumption test) were removed with clearableBid.

// --- pressure-driven reachable band (PLAN-DEPTH-EXIT Extension A, PB1) --------------------------
// Build a windowStats-SHAPED object directly (days oldest→newest; lows/his ascending — the
// windowStats contract) so each fixture controls base/band/pressure exactly. reachableBand is pure
// over that shape; the live path always feeds it a real windowStats result.
const pStats = (pairs, { volLo, volHi }) => ({
  days: pairs.map(([low, hi], i) => [`d${String(i).padStart(2, '0')}`, { low, hi, volLo, volHi }]),
  lows: pairs.map(([low]) => low).sort((a, b) => a - b),
  his: pairs.map(([, hi]) => hi).sort((a, b) => a - b),
  medVolLo: volLo, medVolHi: volHi,
});

ok('demandPressure: ratio + log-symmetry + volume-based reliability; null on a missing side', () => {
  const buy = demandPressure({ medVolHi: 20000, medVolLo: 10000 });
  const sell = demandPressure({ medVolHi: 10000, medVolLo: 20000 });
  assert.ok(Math.abs(buy.ratio - 2) < 1e-9 && Math.abs(sell.ratio - 0.5) < 1e-9);
  assert.ok(Math.abs(buy.s + sell.s) < 1e-12, 's is log-symmetric: 2× and 0.5× mirror');
  assert.equal(buy.reliability, 1, 'both sides ≥ PRESSURE_MIN_VOL → fully trusted');
  const thin = demandPressure({ medVolHi: 600, medVolLo: PRESSURE_MIN_VOL * 10 });
  assert.ok(Math.abs(thin.reliability - 600 / PRESSURE_MIN_VOL) < 1e-9, 'reliability = thinner side ÷ minVol');
  assert.equal(demandPressure({ medVolHi: 1000, medVolLo: 0 }), null, 'a zero/absent side → null (never Infinity)');
  assert.equal(demandPressure(null), null);
});

ok('reachableBand: sign symmetry — buy-heavy lifts the ask + shallows the bid; sell-heavy mirrors', () => {
  // 7 flat days, symmetric dispersion on both sides (lows 990–1010 around 1000; his 1190–1210 around 1200).
  const pairs = [[1000, 1200], [995, 1205], [1005, 1195], [990, 1210], [1010, 1190], [1000, 1200], [1000, 1200]];
  const buy = reachableBand(pStats(pairs, { volLo: 10000, volHi: 20000 }));   // pressure 2×
  const sell = reachableBand(pStats(pairs, { volLo: 20000, volHi: 10000 }));  // pressure 0.5×
  const bal = reachableBand(pStats(pairs, { volLo: 10000, volHi: 10000 }));   // balanced 1×
  assert.ok(buy.phiAsk > bal.phiAsk && buy.phiBid < bal.phiBid, 'buy-heavy: MORE ask headroom, LESS bid depth');
  assert.ok(sell.phiBid > bal.phiBid && sell.phiAsk < bal.phiAsk, 'sell-heavy mirrors');
  assert.ok(Math.abs(buy.phiAsk - sell.phiBid) < 1e-12 && Math.abs(buy.phiBid - sell.phiAsk) < 1e-12,
    'one reflection: φ_ask(2×) ≡ φ_bid(0.5×) exactly');
  assert.ok(Math.abs(bal.phiAsk - 0.5) < 1e-12 && Math.abs(bal.phiBid - 0.5) < 1e-12, 'φ(0) = 0.5 — balanced sits half a band out');
});

ok('reachableBand: φ monotone in s and clamped at PRESSURE_HEADROOM_MAX (never > one band)', () => {
  const pairs = Array.from({ length: 7 }, () => [1000, 1200]);
  const mk = r => ({ ...pStats([[1000, 1200], [995, 1205], [1005, 1195], [990, 1210], [1010, 1190], [1000, 1200], [1000, 1200]], { volLo: 10000, volHi: Math.max(1, Math.round(10000 * r)) }) });
  const phiAt = r => reachableBand(mk(r)).phiAsk;
  assert.ok(phiAt(1) < phiAt(2) && phiAt(2) < phiAt(3), 'φ_ask monotone in pressure');
  assert.equal(phiAt(1000), PRESSURE_HEADROOM_MAX, 'extreme pressure clamps at the headroom cap');
  const crushed = reachableBand(mk(1e-6));
  assert.equal(crushed.phiAsk, 0, 'φ floors at 0 — a crushed side never gets NEGATIVE headroom');
  assert.ok(pairs.length === 7);   // (silence unused-var lint habits)
});

ok('reachableBand: thin volume collapses the headroom to the smoothed center (the guard, no peak-cap)', () => {
  const pairs = [[1000, 1200], [995, 1205], [1005, 1195], [990, 1210], [1010, 1190], [1000, 1200], [1000, 1200]];
  const thin = reachableBand(pStats(pairs, { volLo: 1, volHi: 3 }));   // "3×" off 3 units — noise
  assert.ok(thin.reliability < 0.01, 'a handful of units → ~no reliability');
  assert.equal(thin.ask, thin.baseHigh, 'ask collapses to the recent central high (no fake headroom)');
  assert.equal(thin.bid, thin.baseLow, 'bid collapses to the recent central low');
});

ok('reachableBand: side-specific bands — asymmetric volatility gives bandHigh ≠ bandLow', () => {
  // lows pinned tight at 1000; his disperse widely (1150…1280).
  const pairs = [[1000, 1150], [1000, 1280], [1000, 1200], [1000, 1260], [1000, 1180], [1000, 1240], [1000, 1220]];
  const r = reachableBand(pStats(pairs, { volLo: 10000, volHi: 10000 }));
  assert.equal(r.bandLow, 0, 'flat lows → no bid-side band');
  assert.ok(r.bandHigh > 0 && r.bandHigh !== r.bandLow, 'dispersed his → a real ask-side band');
});

ok('reachableBand: degrades to null on thin days / no pressure read (never a fake band)', () => {
  const four = [[1000, 1200], [1000, 1200], [1000, 1200], [1000, 1200]];   // 4 < PRESSURE_MIN_DAYS (5)
  assert.equal(reachableBand(pStats(four, { volLo: 10000, volHi: 10000 })), null, 'thin day sample → null');
  const seven = Array.from({ length: 7 }, () => [1000, 1200]);
  assert.equal(reachableBand(pStats(seven, { volLo: 0, volHi: 10000 })), null, 'no pressure read → null');
  assert.equal(reachableBand(null), null);
});

ok('reachableBand: SOUL-RUNE reasonableness pin (buy-heavy: high ask, shallow bid) — a φ/base/band change is visible here', () => {
  // Modeled on the real 2026-07-15 whole-day stats: daily lows 351…386 (IQR 4 here, recent-3 median
  // 384), daily his 376…402 (IQR 2, recent-3 median 400), medVolLo 11.01M / medVolHi 18.30M (1.66×).
  const lows = [351, 359, 367, 378, 378, 379, 380, 381, 382, 382, 384, 382, 384, 386];
  const his = [376, 380, 390, 394, 394, 394, 395, 396, 396, 396, 397, 396, 400, 402];
  const pairs = lows.map((l, i) => [l, his[i]]);
  const r = reachableBand(pStats(pairs, { volLo: 11012548, volHi: 18297822 }));
  assert.equal(r.ask, 403, 'reachable ask ~403 — ABOVE the smoothed depth floor (clearableAsk read 394; real 397 fills); PB5 band = recent-7 his IQR 4 (was full-window IQR 2 → 401)');
  assert.equal(r.bid, 383, 'shallow bid on a buy-heavy book — deep bids are slow tail-dip trickle fills (unchanged: recent-7 low IQR 2)');
  assert.ok(r.pressure > 1.6 && r.pressure < 1.7 && r.reliability === 1);
});

ok('reachableBand: PB5 — a stale OLD dip outside the recent-N band window no longer over-deepens the floor', () => {
  // 14 days: a deep dip regime in the OLD half (lows ~880–900), then a RECOVERED recent half that
  // cycles tight at ~1000 (lows 995–1005). The full-window low-IQR is wide (spans the old dip); the
  // recent-7 low-IQR is tight. Balanced pressure so the change is purely the band, not φ.
  const oldDip  = [[880, 1100], [900, 1100], [890, 1100], [885, 1100], [895, 1100], [900, 1100], [905, 1100]];
  const recent  = [[1000, 1100], [995, 1100], [1005, 1100], [1000, 1100], [998, 1100], [1002, 1100], [1000, 1100]];
  const pairs = [...oldDip, ...recent];   // oldest→newest
  const r = reachableBand(pStats(pairs, { volLo: 10000, volHi: 10000 }));
  // recent-7 lows = 995…1005 → IQR small; the full-window IQR would span down to ~885.
  assert.ok(r.bandLow <= 10, `PB5: band tracks the tight recent regime (got IQR ${r.bandLow}), not the old dip`);
  assert.ok(r.bid >= 990, `PB5: bid sits near the recent floor ~1000, not deep in the stale-dip tail (got ${r.bid})`);
  // Contrast: the OLD full-window behavior would have used all 14 lows → a wide band → a much deeper bid.
  const fullWindowBandLow = reachableBand(pStats(pairs, { volLo: 10000, volHi: 10000 }), { bandRecentN: 14 }).bandLow;
  assert.ok(fullWindowBandLow > r.bandLow + 50, `full-window band (${fullWindowBandLow}) is far wider than the recency-gated one (${r.bandLow}) — PB5 is what pulls the floor in`);
});

ok('reachableBand: SELL-HEAVY commodity reasonableness pin (deep bid, shallow ask) — the Coal shape', () => {
  // pressure 0.5× (s=−0.693): φ_bid = 0.5+0.43·0.693 = 0.798, φ_ask = 0.5−0.298 = 0.202.
  // recent central low 1000, low-IQR 40 → bid 1000−40·0.798 ≈ 968; recent high 1100, hi-IQR 20 → ask ≈ 1104.
  const pairs = [[950, 1080], [990, 1090], [1030, 1110], [1050, 1120], [1000, 1100], [1000, 1100], [1000, 1100]];
  const r = reachableBand(pStats(pairs, { volLo: 20000, volHi: 10000 }));
  assert.equal(r.baseLow, 1000); assert.equal(r.bandLow, 40);
  assert.equal(r.bid, Math.round(1000 - 40 * (0.5 + PRESSURE_PHI_SLOPE * Math.log(2))), 'deep bid = center − band·φ(−s), exact');
  assert.equal(r.ask, Math.round(1100 + 20 * Math.max(0, 0.5 - PRESSURE_PHI_SLOPE * Math.log(2))), 'shallow ask mirrors');
  assert.ok(r.bid < r.baseLow && r.ask < r.baseHigh + r.bandHigh, 'sell-heavy: catch the dump deep, don\'t over-ask');
});

// PLAN-REMOVE-DEPTH-PRESSURE-READS chunk 2: the Extension-B per-hour demand-cycle tests (hourlyPressure +
// demandRegime + the `demandSeries` builder) were removed with those functions.

// --- trajectoryRead — the shared multi-day shape read (both read-window-range + quote-items) --------
// days shape: [[key, {low, hi}], …] oldest→newest (windowStats().days). Pure heuristic, inform-only.
const zigzag = [   // mids alternate up/down (4 flips over 4 → oscFrac 1.0), floor 100 (d1), ceiling 140 (d2)
  ['2026-07-01', { low: 100, hi: 120 }],
  ['2026-07-02', { low: 110, hi: 140 }],
  ['2026-07-03', { low: 100, hi: 120 }],
  ['2026-07-04', { low: 115, hi: 135 }],
  ['2026-07-05', { low: 105, hi: 125 }],
  ['2026-07-06', { low: 112, hi: 132 }],
];
ok('trajectoryRead: floor/ceiling + the day each printed', () => {
  const tr = trajectoryRead(zigzag);
  assert.equal(tr.floor, 100); assert.equal(tr.ceiling, 140);
  assert.equal(tr.floorKey, '2026-07-01');   // first day the min low printed
  assert.equal(tr.ceilKey, '2026-07-02');
});
ok('trajectoryRead: many direction flips ⇒ oscillating (not rising/falling on a flat drift)', () => {
  assert.equal(trajectoryRead(zigzag).shape, 'oscillating floor↔ceiling');
});
ok('trajectoryRead: a steady climb reads rising, a steady drop falling', () => {
  const up = [0, 1, 2, 3, 4, 5].map(i => [`d${i}`, { low: 100 + i * 20, hi: 130 + i * 20 }]);
  const down = [0, 1, 2, 3, 4, 5].map(i => [`d${i}`, { low: 200 - i * 20, hi: 230 - i * 20 }]);
  assert.equal(trajectoryRead(up).shape, 'rising');
  assert.equal(trajectoryRead(down).shape, 'falling');
});
ok('trajectoryRead: livePos buckets the live print into FLOOR / mid / CEILING of the window', () => {
  assert.equal(trajectoryRead(zigzag, { liveRef: 101 }).livePos, 'at the FLOOR');   // (101-100)/40 ≈ 0.03
  assert.equal(trajectoryRead(zigzag, { liveRef: 120 }).livePos, 'mid-band');       // 0.5
  assert.equal(trajectoryRead(zigzag, { liveRef: 138 }).livePos, 'at the CEILING'); // 0.95
  assert.equal(trajectoryRead(zigzag).livePos, null);                                // no live ref ⇒ no note
});
ok('trajectoryRead: no usable data ⇒ null (never a false read)', () => {
  assert.equal(trajectoryRead([]), null);
  assert.equal(trajectoryRead(null), null);
  assert.equal(trajectoryRead([['d0', { low: null, hi: null }]]), null);
});

// --- floorCeilingTrack (PLAN-DRIFT-VS-CRASH): the phase-aligned floor+ceiling slope-asymmetry read ----
// days shape: [[key, {low, hi}], …] oldest→newest (windowStats().days). The FOUR real cases this session
// exposed as synthetic series (rule 4 — no live data): crash (floor break + falling ceiling), mild-cooldown
// (flat/softening floor + easing ceiling — the maul), healthy-trend (both rising), and the forming-day
// guard (an incomplete latest day must not trip a false floor-break). fcDay mirrors `day` above.
const fcDay = (key, low, hi) => [key, { low, hi }];

ok('floorCeilingTrack: CRASH — a floor BREAK dominates → crash-risk (the fang/godsword shape)', () => {
  // ceiling steps DOWN ~376k/day; the floor holds ~17.58-17.60m then BREAKS to 17.46m on the last day.
  const lows = [17600000, 17590000, 17600000, 17580000, 17590000, 17600000, 17580000, 17460000];
  const his  = [19000000, 18624000, 18248000, 17872000, 17496000, 17120000, 16744000, 16368000];
  const days = lows.map((l, i) => fcDay(`2026-07-0${i + 1}`, l, his[i]));
  const fc = floorCeilingTrack(days);
  assert.equal(fc.floorBreak.broke, true, 'the last low 17.46m < the prior-window floor 17.58m');
  assert.equal(fc.floorBreak.gap, 17460000 - 17580000, 'gap = latest − prior floor (negative = broken)');
  assert.equal(fc.classification, 'crash-risk', 'a floor break DOMINATES the label');
  assert.equal(fc.ceiling.dir, 'falling', 'the ceiling is stepping down independently');
});

ok('floorCeilingTrack: MILD-COOLDOWN — flat/softening floor + easing ceiling (the maul, NOT a crash)', () => {
  // floor ROSE 7 days then plateaued + ticked down 2 (116.5k→125.0k→124.5k); highs ease ~1k/day.
  const lows = [116500, 118500, 120500, 122500, 124000, 125000, 125500, 124800, 124500];
  const his  = [135800, 134800, 133800, 132800, 131800, 130800, 129800, 128800, 127800];
  const days = lows.map((l, i) => fcDay(`2026-07-0${i + 1}`, l, his[i]));
  const fc = floorCeilingTrack(days);
  assert.equal(fc.floorBreak.broke, false, 'the floor sits far above its prior trough — no break');
  assert.equal(fc.floor.dir, 'flat', 'the recent-window LSQ floor slope is flat — the 2-day dip does NOT flip it');
  assert.equal(fc.ceiling.dir, 'falling', 'highs ease ~1k/day → falling');
  assert.equal(fc.classification, 'mild-cooldown', 'flat floor + falling ceiling = mild cooldown, not a crash');
  // DURATION/confidence: the flat trend is the read, but the trailing softening is visible (rule 4 — a
  // 2-day wiggle is NOT a trend; the caller reports "floor flat over 5d, softened 2d", never a flip).
  assert.equal(fc.floor.run.dir, 'falling', 'the trailing micro-run captures the 2-day softening');
  assert.equal(fc.floor.run.len, 2, 'exactly 2 down-ticks at the end (125.5→124.8→124.5)');
});

ok('floorCeilingTrack: HEALTHY-TREND — both floor and ceiling rising, new highs (the soulreaper shape)', () => {
  const days = [0, 1, 2, 3, 4, 5, 6].map(i => fcDay(`2026-07-0${i + 1}`, 30000000 + i * 300000, 32000000 + i * 350000));
  const fc = floorCeilingTrack(days);
  assert.equal(fc.floor.dir, 'rising');
  assert.equal(fc.ceiling.dir, 'rising');
  assert.equal(fc.floorBreak.broke, false, 'the latest low is the HIGHEST low — a rising floor never breaks down');
  assert.equal(fc.classification, 'healthy-trend');
});

ok('floorCeilingTrack: FORMING-DAY GUARD (req #1) — an incomplete latest day never trips a false break', () => {
  // 6 COMPLETED flat days at a ~1000 floor, then a forming (mid-session) day whose low dipped to 500.
  const completed = [0, 1, 2, 3, 4, 5].map(i => fcDay(`2026-07-0${i + 1}`, 1000 + (i % 2), 1200));
  const forming = fcDay('2026-07-07', 500, 1150);   // incomplete — a deep intraday print, NOT a real daily low
  const days = [...completed, forming];
  // WITH the guard: the forming day is dropped from the completed series + surfaced separately.
  const fc = floorCeilingTrack(days, { todayKey: '2026-07-07' });
  assert.equal(fc.forming.key, '2026-07-07', 'the forming day is split off, not fed to the slope/break');
  assert.equal(fc.forming.low, 500);
  assert.equal(fc.nDays, 6, 'only the 6 completed days feed the read');
  assert.equal(fc.floorBreak.broke, false, 'the 500 forming dip is EXCLUDED → no false floor break');
  assert.ok(fc.floor.series.every(v => v >= 1000), 'the completed floor series never sees the forming 500');
  // WITHOUT the guard (no todayKey): the 500 IS counted as the latest low → a FALSE break. Proves the guard matters.
  const unguarded = floorCeilingTrack(days);
  assert.equal(unguarded.floorBreak.broke, true, 'counting the incomplete day fakes a break — exactly what the guard prevents');
  assert.equal(unguarded.classification, 'crash-risk', 'and would mislabel a stable item as a crash');
});

ok('floorCeilingTrack: honesty rails — thin history / no data ⇒ null (never a fake read)', () => {
  const thin = [0, 1, 2].map(i => fcDay(`d${i}`, 1000, 1200));   // 3 < FC_MIN_DAYS
  assert.equal(floorCeilingTrack(thin), null, `< FC_MIN_DAYS (${FC_MIN_DAYS}) completed days ⇒ null`);
  assert.equal(floorCeilingTrack([]), null);
  assert.equal(floorCeilingTrack(null), null);
  assert.equal(floorCeilingTrack([['d0', { low: null, hi: null }]]), null);
  // a forming day that leaves too few COMPLETED days also degrades to null
  const fivePlusForming = [0, 1, 2, 3].map(i => fcDay(`2026-07-0${i + 1}`, 1000, 1200)).concat([fcDay('2026-07-05', 1000, 1200)]);
  assert.equal(floorCeilingTrack(fivePlusForming, { todayKey: '2026-07-05' }), null, '4 completed after dropping the forming day ⇒ null');
});

ok('formatFloorCeiling: compact one-line note; null passes through; floor-break + forming surfaced', () => {
  const idfmt = n => String(n);   // identity fmt so the assertions read the raw numbers
  assert.equal(formatFloorCeiling(null, idfmt), null, 'null read ⇒ null (no note)');
  const lows = [17600000, 17590000, 17600000, 17580000, 17590000, 17600000, 17580000, 17460000];
  const his  = [19000000, 18624000, 18248000, 17872000, 17496000, 17120000, 16744000, 16368000];
  const crash = floorCeilingTrack(lows.map((l, i) => fcDay(`2026-07-0${i + 1}`, l, his[i])));
  const line = formatFloorCeiling(crash, idfmt, { label: "Osmumten's fang" });
  assert.ok(line.startsWith("Osmumten's fang: floor/ceiling:"), 'label prefixes the note');
  assert.ok(/crash-risk/.test(line) && /floor BROKE prior/.test(line), 'the classification + the break both surface');
  assert.ok(/inform-only, never gates/.test(line), 'the honesty rail rides on every line');
});

ok('fmtHoldHorizon: sub-day → hours, ≥1d → days unchanged, junk → ?d (the byte-identical-app pin)', () => {
  // band/churn/scalp's DRIFT_INTRADAY_HOLD_DAYS = 2/24 must read as "2h", never the ugly "~0.08d".
  assert.equal(fmtHoldHorizon(2 / 24), '2h', '~2h band horizon renders as hours');
  assert.equal(fmtHoldHorizon(6 / 24), '6h', 'a 6h horizon renders as hours');
  assert.equal(fmtHoldHorizon(0.5 / 24), '0.5h', 'sub-hour keeps one decimal');
  // ≥1-day horizons are byte-identical to the old `${d}d` render (app's renderForecast on the 1.5d default,
  // value's 14d) — this is the pin that the app-facing note never changed.
  assert.equal(fmtHoldHorizon(1.5), '1.5d', 'the 1.5d default is unchanged');
  assert.equal(fmtHoldHorizon(14), '14d', "value's 14d is unchanged");
  assert.equal(fmtHoldHorizon(1), '1d', 'exactly one day is days');
  // honest degrade (never a crash / NaN in the clause).
  assert.equal(fmtHoldHorizon(null), '?d', 'null ⇒ ?d');
  assert.equal(fmtHoldHorizon(undefined), '?d', 'undefined ⇒ ?d');
  assert.equal(fmtHoldHorizon(NaN), '?d', 'NaN ⇒ ?d');
});

// --- R6 (PLAN-SIGNAL-RECENCY): the oscillation flag + the live-band fold on floorCeilingTrack --------
// fc.oscillating preserves trajectoryRead's one unique signal (dead range vs actively bouncing) that fc's
// slope-direction classifier can't otherwise express; formatFloorCeiling folds the retired shape line's
// floor/ceiling band + livePos in via the `live` opt.
ok('R6 floorCeilingTrack: a flat-floor/flat-ceiling series with hard MID flips reads ranging + oscillating', () => {
  // floor ~100 flat, ceiling ~140 flat, but the daily MIDS alternate hard (near-floor / near-ceiling days)
  const lows = [100, 101, 100, 101, 100, 101, 100];
  const his  = [110, 179, 111, 178, 110, 179, 111];   // mid alternates ~105/140 → high flip density
  const fc = floorCeilingTrack(lows.map((l, i) => fcDay(`2026-07-0${i + 1}`, l, his[i])));
  assert.equal(fc.classification, 'ranging', 'flat floor + flat ceiling → ranging');
  assert.equal(fc.oscillating, true, 'the hard mid-flips flag oscillating (the bounce fc slopes miss)');
});
ok('R6 floorCeilingTrack: a DEAD flat range (no flips) is ranging but NOT oscillating', () => {
  const days = [0, 1, 2, 3, 4, 5, 6].map(i => fcDay(`2026-07-0${i + 1}`, 100 + (i % 2), 140 - (i % 2)));
  const fc = floorCeilingTrack(days);
  assert.equal(fc.classification, 'ranging');
  assert.equal(fc.oscillating, false, 'a monotone-ish dead band is not an oscillator');
});
ok('R6 floorCeilingTrack: a TRENDING item is never flagged oscillating (only ranging qualifies)', () => {
  const days = [0, 1, 2, 3, 4, 5, 6].map(i => fcDay(`2026-07-0${i + 1}`, 30000000 + i * 300000, 32000000 + i * 350000));
  const fc = floorCeilingTrack(days);
  assert.equal(fc.classification, 'healthy-trend');
  assert.equal(fc.oscillating, false, 'oscillating only qualifies a ranging classification');
});
ok('R6 formatFloorCeiling: renders the oscillating qualifier + the live band fold; omits band when no live', () => {
  const idfmt = n => String(n);
  const lows = [100, 101, 100, 101, 100, 101, 100];
  const his  = [110, 179, 111, 178, 110, 179, 111];
  const fc = floorCeilingTrack(lows.map((l, i) => fcDay(`2026-07-0${i + 1}`, l, his[i])));
  // with a live band read folded in
  const withLive = formatFloorCeiling(fc, idfmt, { live: { ref: 105, pos: 'at the FLOOR', floor: 100, ceiling: 179 } });
  assert.match(withLive, /oscillating floor↔ceiling/, 'the oscillation qualifier rides the ranging classification');
  assert.match(withLive, /band 100→179 · live 105 at the FLOOR/, 'the floor/ceiling band + livePos fold in (the retired shape fields)');
  // no live → the band clause is omitted (the shape line is gone entirely, not replaced by an empty one)
  const noLive = formatFloorCeiling(fc, idfmt);
  assert.doesNotMatch(noLive, /band /, 'no live read ⇒ no band clause');
  assert.match(noLive, /oscillating floor↔ceiling/, 'the oscillation qualifier still shows without a live read');
});

// --- PLAN-DIURNAL-TIMING DT1: hourConcentration + diurnalTimedLap -------------------------------
// Fixture helpers (fresh ts/pt so this section is self-contained against future reshuffles above).
const dts = (y, mo, d, h) => Math.floor(new Date(y, mo, d, h, 0, 0).getTime() / 1000);
const dpt = (t, low, hi, volLo = 10, volHi = 10) =>
  ({ timestamp: t, avgLowPrice: low, avgHighPrice: hi, lowPriceVolume: volLo, highPriceVolume: volHi });
const dtNow = new Date(2026, 0, 20, 12, 0, 0);

ok('hourConcentration: a bolts-shaped tight per-day trough/peak hour list reads HIGH R (clean true)', () => {
  const hours = [1, 2, 1, 3, 2];   // 5 days, all within 1-3 (bolts-shaped) — one point/day carries both sides
  const series = [];
  hours.forEach((h, di) => series.push(dpt(dts(2026, 0, 5 + di, h), 100, 110)));
  const conc = hourConcentration(series, { nights: 5, now: dtNow });
  assert.deepEqual(conc.troughHours, hours);
  assert.deepEqual(conc.peakHours, hours);
  assert.ok(conc.rTrough >= 0.9, `tight cluster ⇒ R ≈ 0.9+ (got ${conc.rTrough})`);
  assert.ok(conc.rPeak >= 0.9);
  assert.equal(conc.daysScored, 5);
  assert.equal(conc.clean, true, 'both sides pass the concentration + days floor');
});

ok('hourConcentration: a chin-shaped scattered per-day trough hour list (≈120° apart) reads LOW R (clean false)', () => {
  const hours = [0, 17, 3, 0, 17];   // ≥5 days, 3 hours spread ~120° apart on the 24h circle
  const series = [];
  hours.forEach((h, di) => series.push(dpt(dts(2026, 0, 5 + di, h), 100, 110)));
  const conc = hourConcentration(series, { nights: 5, now: dtNow });
  assert.ok(conc.rTrough < 0.6, `scattered ⇒ low R (got ${conc.rTrough})`);
  assert.equal(conc.clean, false);
});

ok('hourConcentration: the 23:00/01:00 wrap reads CLUSTERED (circular, not linear, variance)', () => {
  const troughHours = [23, 0, 1, 23, 0];   // straddles midnight — a linear variance would call this scattered
  const series = [];
  troughHours.forEach((h, di) => series.push(dpt(dts(2026, 0, 5 + di, h), 100, 110)));
  const peakHours = [12, 12, 12, 12, 12];
  const series2 = [...series];
  peakHours.forEach((h, di) => series2.push(dpt(dts(2026, 0, 5 + di, h), 100, 999)));
  const conc = hourConcentration(series2, { nights: 5, now: dtNow });
  assert.ok(conc.rTrough >= 0.9, `midnight-wrap hours are tightly clustered circularly (got ${conc.rTrough})`);
});

ok('hourConcentration: fewer than HOURCONC_MIN_DAYS scored days ⇒ clean false (too thin to judge)', () => {
  const series = [dpt(dts(2026, 0, 5, 2), 100, 110), dpt(dts(2026, 0, 6, 2), 100, 110)];
  const conc = hourConcentration(series, { nights: HOURCONC_MIN_DAYS, now: dtNow });
  assert.ok(conc.daysScored < HOURCONC_MIN_DAYS);
  assert.equal(conc.clean, false);
});

// diurnalTimedLap fixtures. dip cluster = hours 21-23, peak cluster = hours 4-6 throughout (the
// decoupled low/high offset model keeps the two axes independent so hourProfile's cluster growth
// isn't cross-contaminated — see the DT1 tuning notes in PLAN-DIURNAL-TIMING).
function boltsSeries(days) {
  const s = [];
  for (let di = 0; di < days; di++) for (let h = 0; h < 24; h++) {
    const base = 2900;
    const dipExtra = [21, 22, 23].includes(h) ? 39 : 0;
    const peakExtra = [4, 5, 6].includes(h) ? 85 : 0;
    const isPeak = [4, 5, 6].includes(h);
    const low = base - 45 - dipExtra, hi = base + 45 + peakExtra;
    const volHi = isPeak ? 149334 : 858000 / 24;   // peak-window medVolHi ≈ 448k (the §4 anchor)
    s.push(dpt(dts(2026, 0, 5 + di, h), low, hi, 858000 / 24, volHi));
  }
  return s;
}

ok('diurnalTimedLap: bolts-clean fixture — clean true, net matches the plan finding, tranche per §4 anchor', () => {
  const r = diurnalTimedLap(boltsSeries(14), { nights: 14, now: dtNow, buyLimit: 11000, volDay: 858000 });
  assert.equal(r.degraded, false);
  assert.equal(r.bid, 2816, 'the dip level — the plan finding\'s buy 2,816');
  assert.equal(r.ask, 3030, 'the peak level — the plan finding\'s sell 3,030');
  assert.equal(r.net, 154, 'netMargin(2816, 3030) matches the plan finding\'s +154/u');
  assert.equal(r.clean, true, 'a tight, consistent daily dip/peak hour ⇒ clean');
  assert.ok(r.instantNet != null && r.instantNet > 0 && r.instantNet < r.net, 'same-hour instant margin is smaller than the timed trough→peak lap, but still positive here');
  assert.equal(r.peakPool, 448002, 'medVolHi over the peak window ≈ the §4 anchor');
  assert.equal(r.trancheComfort, 4290, 'min(11000, 0.5%×858000=4290, 15%×peakPool) — the vol term binds');
  assert.equal(r.trancheCeiling, 8580, 'min(22000, 1%×858000=8580, 25%×peakPool) — the vol term binds');
});

ok('diurnalTimedLap: chin-scatter fixture — clean false, net small but positive', () => {
  const troughRot = [0, 17, 3], peakRot = [12, 5, 20];
  const s = [];
  for (let di = 0; di < 9; di++) {
    const tH = troughRot[di % 3], pH = peakRot[di % 3];
    for (let h = 0; h < 24; h++) {
      const dipExtra = h === tH ? 25 : 0;
      const peakExtra = h === pH ? 40 : 0;
      const low = 420 - 20 - dipExtra, hi = 420 + 20 + peakExtra;
      s.push(dpt(dts(2026, 0, 5 + di, h), low, hi, 420000 / 24, 420000 / 24));
    }
  }
  const r = diurnalTimedLap(s, { nights: 9, now: dtNow, volDay: 420000 });
  assert.equal(r.degraded, false);
  assert.equal(r.clean, false, 'the rotating trough/peak hour scatters the per-day read');
  assert.ok(r.net > 0 && r.net < 100, `small positive lap (got ${r.net})`);
  assert.equal(r.trancheComfort, 2100, '0.5%×420000 — the §4 chin anchor');
  assert.equal(r.trancheCeiling, 4200, '1%×420000 — the §4 chin anchor');
});

ok('diurnalTimedLap: blowpipe big-ticket fixture — instantNet NEGATIVE (thinner than tax), timed net POSITIVE (trough→peak clears it), falling base, scattered (not clean)', () => {
  // fixed dip(21-23)/peak(4-6) cluster every day (drives hourProfile's chosen levels/net); an INTRUDER
  // hour, rotating among 4 widely-spread hours and present every day, digs/spikes even further than the
  // cluster so the DAY-LEVEL global argmin/argmax (hourConcentration's basis) scatters, while the
  // per-HOUR median (hourProfile's basis) stays anchored on the consistent cluster.
  const troughIntruderRot = [3, 9, 15, 17], peakIntruderRot = [11, 13, 19, 1];
  const s = [];
  for (let di = 0; di < 10; di++) {
    const base = 10700000 - 60000 * di;   // falling base
    const tIH = troughIntruderRot[di % 4], pIH = peakIntruderRot[di % 4];
    for (let h = 0; h < 24; h++) {
      const isDip = [21, 22, 23].includes(h), isPeak = [4, 5, 6].includes(h);
      const dipExtra = isDip ? 110000 : 0;
      const peakExtra = isPeak ? 110000 : 0;
      const intruderLowExtra = h === tIH ? 150000 : 0;
      const intruderHiExtra = h === pIH ? 150000 : 0;
      const low = base - 100000 - dipExtra - intruderLowExtra;
      const hi = base + 100000 + peakExtra + intruderHiExtra;
      s.push(dpt(dts(2026, 0, 5 + di, h), low, hi, 5000, 5000));
    }
  }
  const r = diurnalTimedLap(s, { nights: 10, now: dtNow });
  assert.equal(r.degraded, false);
  assert.ok(r.instantNet < 0, `same-hour instant spread thinner than 2% tax ⇒ instantNet negative (got ${r.instantNet})`);
  assert.ok(r.net > 150000 && r.net < 280000, `trough→peak clears tax handily (got ${r.net}, expect ≈ +200-230k)`);
  assert.ok(r.net > 0 && r.instantNet < r.net, 'the two reads DIVERGE on a big-ticket item — this is the whole point, not a bug');
  assert.equal(r.lowTrend.dir, 'falling', 'the base is declining day over day');
  assert.equal(r.clean, false, 'the intruder scatters the day-level trough/peak hour read');
});

ok('diurnalTimedLap: degrades honestly on thin/empty history, never throws', () => {
  assert.deepEqual(diurnalTimedLap([]), { degraded: true, reason: 'thin-history' });
  assert.deepEqual(diurnalTimedLap(null), { degraded: true, reason: 'thin-history' });
  const thin = [dpt(dts(2026, 0, 5, 4), 100, 110), dpt(dts(2026, 0, 6, 4), 100, 110)];   // 2 days < HOURPROFILE_MIN_DAYS
  assert.deepEqual(diurnalTimedLap(thin, { nights: 14, now: dtNow }), { degraded: true, reason: 'thin-history' });
});

ok('diurnalTimedLap: a thin sell-side peakPool BINDS the tranche min() (the pool-bound branch, not just vol-bound)', () => {
  const s = [];
  for (let di = 0; di < 14; di++) for (let h = 0; h < 24; h++) {
    const isDip = [21, 22, 23].includes(h), isPeak = [4, 5, 6].includes(h);
    const dipExtra = isDip ? 39 : 0, peakExtra = isPeak ? 85 : 0;
    const low = 2900 - 45 - dipExtra, hi = 2900 + 45 + peakExtra;
    const volHi = isPeak ? 700 : 20000;   // tiny peak-window volume ⇒ small medVolHi
    s.push(dpt(dts(2026, 0, 5 + di, h), low, hi, 20000, volHi));
  }
  const r = diurnalTimedLap(s, { nights: 14, now: dtNow, buyLimit: 200000, volDay: 10000000 });
  assert.equal(r.degraded, false);
  assert.equal(r.peakPool, 2100, 'medVolHi over the (tiny) peak window');
  assert.equal(r.trancheComfort, 315, '0.15×2100 — the pool term binds under a huge buyLimit/volDay');
  assert.equal(r.trancheCeiling, 525, '0.25×2100 — the pool term binds the ceiling too');
});

ok('diurnalTimedLap: a rising day-to-day base (2800→2816→2948) flags lowTrend rising', () => {
  const bases = [2800, 2810, 2816, 2870, 2910, 2948];
  const s = [];
  for (let di = 0; di < bases.length; di++) for (let h = 0; h < 24; h++) {
    const isDip = [21, 22, 23].includes(h), isPeak = [4, 5, 6].includes(h);
    const dipExtra = isDip ? 39 : 0, peakExtra = isPeak ? 85 : 0;
    const low = bases[di] - 45 - dipExtra, hi = bases[di] + 45 + peakExtra;
    s.push(dpt(dts(2026, 0, 5 + di, h), low, hi, 20000, 20000));
  }
  const r = diurnalTimedLap(s, { nights: bases.length, now: dtNow });
  assert.equal(r.degraded, false);
  assert.equal(r.lowTrend.dir, 'rising');
  assert.equal(r.hiTrend.dir, 'rising');
});

// --- PLAN-DIURNAL-TIMING DT3: quote-items.mjs / watch-positions.mjs wiring pins -------------------
// (1) PARITY: watch-positions.mjs's two direct hourProfile+deriveDiurnalRange call sites now go
//     through diurnalTimedLap instead — for the SAME nights/liveLo/liveHi, dr.bid/dr.ask/dr.peakWindow
//     must come out byte-identical (the shadow-log co-log site uses nights:14, the diurnalAsk
//     cycle-fallback site uses nights:7 — pin both).
ok('DT3 parity: diurnalTimedLap(nights:14) reproduces the OLD hourProfile+deriveDiurnalRange pair exactly (watch-positions shadow-log site)', () => {
  const s = boltsSeries(14);
  const liveLo = 2830, liveHi = 3060;
  const oldProf = hourProfile(s, { nights: 14, now: dtNow });
  const oldDr = deriveDiurnalRange(oldProf, { liveLo, liveHi });
  const lap = diurnalTimedLap(s, { nights: 14, now: dtNow, liveLo, liveHi });
  assert.equal(lap.degraded, false);
  assert.equal(lap.bid, oldDr.bid);
  assert.equal(lap.ask, oldDr.ask);
  assert.equal(lap.bidBasis, oldDr.bidBasis);
  assert.deepEqual(lap.dipWindow, oldDr.dipWindow);
  assert.deepEqual(lap.peakWindow, oldDr.peakWindow);
  assert.equal(lap.trendDominates, oldDr.trendDominates);
});

ok('DT3 parity: diurnalTimedLap(nights:7) reproduces the OLD pair exactly (watch-positions diurnalAsk cycle-fallback site)', () => {
  const s = boltsSeries(10);
  const liveLo = 2830, liveHi = 3060;
  const oldProf = hourProfile(s, { nights: 7, now: dtNow });
  const oldDr = deriveDiurnalRange(oldProf, { liveLo, liveHi });
  const lap = diurnalTimedLap(s, { nights: 7, now: dtNow, liveLo, liveHi });
  assert.equal(lap.degraded, false);
  assert.equal(lap.bid, oldDr.bid);
  assert.equal(lap.ask, oldDr.ask);
});

ok('DT3 parity: thin history that made the OLD pair null (prof null) also degrades diurnalTimedLap — both surfaces treat it as "no fallback"', () => {
  const thin = [dpt(dts(2026, 0, 5, 2), 100, 110)];
  assert.equal(hourProfile(thin, { nights: 14, now: dtNow }), null);
  const lap = diurnalTimedLap(thin, { nights: 14, now: dtNow });
  assert.equal(lap.degraded, true);
});

// (2) END-TO-END WIRING: quote-items.mjs merges volDay/buyLimit onto the diurnalTimedLap result and
//     renders via formatTimedLap — the exact composition DT2 already wired for screen-flip-niches.mjs.
//     Pin it off REAL series fixtures (not literal lap objects, unlike render.test.mjs's DT2 pins) so
//     the two-hop pipe (real 1h series → diurnalTimedLap → formatTimedLap) is exercised end to end.
ok('DT3 end-to-end: a clean (bolts-shaped) fixture renders BOTH timed + same-hour net via the quote-items merge pattern', () => {
  const s = boltsSeries(14);
  const lap = { ...diurnalTimedLap(s, { nights: 14, now: dtNow, buyLimit: 5000, volDay: 858000, liveLo: 2830, liveHi: 3060 }), volDay: 858000, buyLimit: 5000 };
  const text = formatTimedLap(lap);
  assert.ok(text != null, 'a clean fixture with a priceable bid/ask must render a note');
  assert.ok(text.includes('BID '), 'clean cycle — dip/peak hours render');
  assert.ok(text.includes('timed +'), 'timed net present');
  assert.ok(text.includes('same-hour'), 'same-hour instant net present');
  assert.ok(text.includes('858k/d'), 'liquidity segment rides the merged volDay');
});

ok('DT3 end-to-end: a scattered (chin-shaped) fixture renders the range-churn frame, not specific hours', () => {
  const troughRot = [0, 17, 3], peakRot = [12, 5, 20];
  const s = [];
  for (let di = 0; di < 9; di++) {
    const tH = troughRot[di % 3], pH = peakRot[di % 3];
    for (let h = 0; h < 24; h++) {
      const dipExtra = h === tH ? 25 : 0;
      const peakExtra = h === pH ? 40 : 0;
      const low = 420 - 20 - dipExtra, hi = 420 + 20 + peakExtra;
      s.push(dpt(dts(2026, 0, 5 + di, h), low, hi, 420000 / 24, 420000 / 24));
    }
  }
  const lap = { ...diurnalTimedLap(s, { nights: 9, now: dtNow, volDay: 420000 }), volDay: 420000 };
  const text = formatTimedLap(lap);
  assert.ok(text != null);
  assert.ok(text.startsWith('range-churn — no timing edge'), `must lead with the range-churn frame (got: ${text})`);
  assert.ok(!text.includes('BID '), 'scattered per-day hours are unreliable — omitted');
});

ok('DT3 end-to-end: a degraded (too-thin) fixture renders no note at all — the §7 softened contract holds on the real wiring, not just literal lap fixtures', () => {
  const thin = [dpt(dts(2026, 0, 5, 2), 100, 110)];
  const lap = { ...diurnalTimedLap(thin, { nights: 14, now: dtNow }), volDay: 100000, buyLimit: 500 };
  assert.equal(formatTimedLap(lap), null);
});

console.log(`\nAll ${pass} acceptance checks passed.`);
