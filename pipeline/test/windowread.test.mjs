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
import { inWindow, quantLow, quantHigh, touchedDays, reachedDays, placement, windowStats, recencySplit, recentQuant, hourProfile, deriveDiurnalRange, asymPair, ASYM_P_LO, ASYM_P_HI, ASYM_MIN_DAYS, reachMargin, MARGIN_MIN_DAYS } from '../../js/windowread.mjs';
import { windowClear, windowClearDiverges, WINCLEAR_MIN_DAYS } from '../../js/windowread.mjs';   // PLAN-WINDOW-CLEAR B1
import { depthDays, clearableAsk, clearableBid } from '../../js/windowread.mjs';   // PLAN-DEPTH-EXIT DE1 + DE6 (low-side mirror)
import { demandPressure, reachableBand, PRESSURE_PHI_SLOPE, PRESSURE_MIN_VOL, PRESSURE_HEADROOM_MAX } from '../../js/windowread.mjs';   // PLAN-DEPTH-EXIT Extension A (PB1)
import { hourlyPressure, demandRegime } from '../../js/windowread.mjs';   // PLAN-DEPTH-EXIT Extension B (DC1)
import { trajectoryRead } from '../../js/windowread.mjs';   // the fang under-read fix — shared multi-day shape read (read-window-range + quote-items render from ONE definition)

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
});

ok('hourProfile: a rising floor sets trendDominates when drift outpaces the intraday swing', () => {
  const prof = hourProfile(diurnal(6, { baseFn: di => 900 + 50 * di }), { nights: 14, now: noonNow });
  assert.ok(prof);
  assert.deepEqual(prof.dip.hours, [21, 22, 23], 'shape survives the trend (dip still evening)');
  assert.ok(prof.trendPerDay > 0, 'the daily-low slope is positive');
  assert.equal(prof.trendDominates, true, '≈50/day drift ≥ 0.25×~120 amplitude → dominates');
});

ok('hourProfile: too little history is unprofilable (null, no false read)', () => {
  assert.equal(hourProfile(diurnal(2, { baseFn: () => 1000 }), { nights: 14, now: noonNow }), null,
    '2 days < HOURPROFILE_MIN_DAYS');
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

ok('depthDays: qty→0 clearedDays ≡ reachedDays (the reach count is the model\'s zero-size limit)', () => {
  const series = [];
  for (let d = 10; d <= 15; d++) series.push(...dDay(d, [{ h: 14, hi: 400, volHi: 50 }, { h: 15, hi: 396, volHi: 50 }]));
  const stats = windowStats(series, dOpts);
  for (const ask of [395, 397, 399, 401]) {
    const dd = depthDays(series, ask, { qty: 0, ...dOpts });
    assert.equal(dd.clearedDays, reachedDays(stats.his, ask), `qty→0 clears ≡ reachedDays @${ask}`);
  }
});

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

ok('clearableAsk/depthDays: monotone — higher qty/competition/targetFrac never books HIGHER', () => {
  const series = [];   // three price tiers/day: 410(200) · 400(400) · 390(800)
  for (let d = 10; d <= 16; d++) series.push(...dDay(d, [{ h: 14, hi: 410, volHi: 200 }, { h: 15, hi: 400, volHi: 400 }, { h: 16, hi: 390, volHi: 800 }]));
  const p = q => clearableAsk(series, { qty: q, ...dOpts }).price ?? -Infinity;
  assert.ok(p(10) >= p(100) && p(100) >= p(300), 'price non-increasing in qty');
  const byComp = c => clearableAsk(series, { qty: 50, competition: c, ...dOpts }).price ?? -Infinity;
  assert.ok(byComp(1) >= byComp(4) && byComp(4) >= byComp(8), 'price non-increasing in competition');
  const byFrac = f => clearableAsk(series, { qty: 50, targetFrac: f, ...dOpts }).price ?? -Infinity;
  assert.ok(byFrac(0.5) >= byFrac(0.75) && byFrac(0.75) >= byFrac(1), 'price non-increasing in targetFrac');
  const cf = ask => depthDays(series, ask, { qty: 50, ...dOpts }).clearFrac;
  assert.ok(cf(390) >= cf(400) && cf(400) >= cf(410), 'depthDays clearFrac non-increasing in the ask');
});

ok('clearableAsk: minBuckets guard — a lone fat bucket at the top cannot set the clearable ask', () => {
  const series = [...dDay(10, [{ h: 14, hi: 420, volHi: 100000 }])];   // one day, one huge 420 flier
  for (let d = 11; d <= 16; d++) series.push(...dDay(d, [{ h: 14, hi: 400, volHi: 1000 }, { h: 15, hi: 398, volHi: 1000 }]));
  const r = clearableAsk(series, { qty: 10, ...dOpts });               // 420 is supported by 1 bucket (< minBuckets 2) → skipped
  assert.ok(r.price != null && r.price <= 400, 'the lone 420 flier does not set the ask — the dense top ≤400 does');
});

// --- clearableBid (PLAN-DEPTH-EXIT DE6): the low-side mirror — "how deep can I bid and still fill" --
// Low-side point masses: dDay writes lo = hi−500 with volLo 10, so build a dedicated builder with
// controlled (avgLowPrice, lowPriceVolume) buckets instead.
const bDay = (d, buckets) => buckets.map(b => pt(ts(2026, 0, d, b.h), b.lo, b.lo + 500, b.volLo, 10));

ok('depthDays side:bid — qty→0 clearedDays ≡ touchedDays (the touch count is the zero-size limit)', () => {
  const series = [];
  for (let d = 10; d <= 15; d++) series.push(...bDay(d, [{ h: 14, lo: 300, volLo: 50 }, { h: 15, lo: 304, volLo: 50 }]));
  const stats = windowStats(series, dOpts);
  for (const bid of [299, 301, 303, 305]) {
    const dd = depthDays(series, bid, { qty: 0, side: 'bid', ...dOpts });
    assert.equal(dd.clearedDays, touchedDays(stats.lows, bid), `qty→0 clears ≡ touchedDays @${bid}`);
  }
});

ok('clearableBid: deep book + small size catches DEEP; a large lot must bid shallower (mirror-monotone)', () => {
  const series = [];   // three low tiers/day: 290(800) · 300(400) · 310(200) — the dump is deepest at 290
  for (let d = 10; d <= 16; d++) series.push(...bDay(d, [{ h: 14, lo: 290, volLo: 800 }, { h: 15, lo: 300, volLo: 400 }, { h: 16, lo: 310, volLo: 200 }]));
  const small = clearableBid(series, { qty: 10, ...dOpts });      // need 40 → the 290 tier alone absorbs it
  assert.equal(small.price, 290, 'a small lot catches the deepest printed tier');
  assert.ok(small.clearFrac >= 0.75 && small.reason == null);
  const p = q => clearableBid(series, { qty: q, ...dOpts }).price ?? Infinity;
  assert.ok(p(10) <= p(150) && p(150) <= p(300), 'bid non-DEcreasing in qty — a big lot must bid SHALLOWER (cumulative flow at/below rises with the level)');
  const byComp = c => clearableBid(series, { qty: 50, competition: c, ...dOpts }).price ?? Infinity;
  assert.ok(byComp(1) <= byComp(4) && byComp(4) <= byComp(8), 'bid non-decreasing in competition');
});

ok('clearableBid: thin book collapses UP-or-null WITH a reason (mirage guard mirrored, surfaced)', () => {
  const thin = [];
  for (let d = 10; d <= 15; d++) thin.push(...bDay(d, [{ h: 14, lo: 290, volLo: 3 }, { h: 15, lo: 300, volLo: 3 }]));
  const r = clearableBid(thin, { qty: 100, ...dOpts });           // need 400 ≫ 6 u/day
  assert.equal(r.price, null);
  assert.equal(r.reason, 'insufficient-depth', 'never a silent null — the liquidity collapse is named');
  assert.ok(r.need === 400);
  const few = bDay(10, [{ h: 14, lo: 300, volLo: 1000 }]).concat(bDay(11, [{ h: 14, lo: 300, volLo: 1000 }]));
  assert.equal(clearableBid(few, { qty: 1, ...dOpts }).reason, 'thin-history', '< minDays scored → thin-history');
});

ok('clearableBid: minBuckets guard — a lone fat flush at the bottom cannot set the bid', () => {
  const series = [...bDay(10, [{ h: 14, lo: 250, volLo: 100000 }])];   // one day, one huge 250 flush
  for (let d = 11; d <= 16; d++) series.push(...bDay(d, [{ h: 14, lo: 290, volLo: 1000 }, { h: 15, lo: 292, volLo: 1000 }]));
  const r = clearableBid(series, { qty: 10, ...dOpts });               // 250 has 1 supporting bucket (< 2) → skipped
  assert.ok(r.price != null && r.price >= 290, 'the lone 250 flier does not set the bid — the dense floor ≥290 does');
});

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

// --- per-hour demand-cycle classifier (PLAN-DEPTH-EXIT Extension B, DC1) -----------------------
// Build a 6-day series with CONSTANT prices (so hourProfile is profilable) but a controlled per-hour
// volume pattern, so pressure = per-hour medVolHi/medVolLo is exactly what volFn dictates.
function demandSeries(days, volFn) {
  const s = [];
  for (let di = 0; di < days; di++) for (let h = 0; h < 24; h++) {
    const { volHi, volLo } = volFn(h, di);
    s.push(pt(ts(2026, 0, 5 + di, h), 1000, 1010, volLo, volHi));   // flat prices; volumes carry the signal
  }
  return s;
}
const dcNow = new Date(2026, 0, 25, 12, 0, 0);

ok('hourlyPressure: per-hour pressure is the ratio of per-hour MEDIAN volumes (aggregate, not median-of-ratios)', () => {
  // hour 18 is doubly buy-heavy (volHi 6000), the rest 3000; sell side flat 2000.
  const track = hourlyPressure(demandSeries(6, h => ({ volHi: (h >= 16 && h <= 20) ? 6000 : 3000, volLo: 2000 })), { nights: 14, now: dcNow });
  assert.ok(track && track.length >= 20, 'a 6-day series profiles into a per-hour track');
  const h18 = track.find(t => t.hour === 18), h3 = track.find(t => t.hour === 3);
  assert.ok(Math.abs(h18.pressure - 3) < 1e-9, 'hour 18: 6000/2000 = 3×');
  assert.ok(Math.abs(h3.pressure - 1.5) < 1e-9, 'hour 3: 3000/2000 = 1.5×');
  assert.equal(h18.reliability, 1, 'thick hour → full reliability');
});

ok('hourlyPressure: a zero-volume side yields null pressure (no divide-by-zero — the aggregation rule)', () => {
  const track = hourlyPressure(demandSeries(6, h => ({ volHi: 3000, volLo: (h === 4) ? 0 : 3000 })), { nights: 14, now: dcNow });
  const h4 = track.find(t => t.hour === 4);
  assert.equal(h4.pressure, null, 'hour 4 sell side never traded → null, never Infinity');
  assert.ok(Number.isFinite(track.find(t => t.hour === 5).pressure), 'other hours are unaffected + finite');
});

ok('demandRegime: an all-buy-heavy item classifies buy-heavy with a SELL window and NO buy window', () => {
  // (Extension B model: high-buy-pressure hours ARE the sell window; an all-buy-heavy item has no
  // genuine dip-buy hour. This DIVERGES from the plan bullet's "no sell window" wording — see the
  // demandRegime header. Implemented per the model.)
  const dr = demandRegime(demandSeries(6, h => ({ volHi: (h >= 16 && h <= 20) ? 6000 : 3000, volLo: 2000 })), { nights: 14, now: dcNow });
  assert.equal(dr.regime, 'buy-heavy');
  assert.ok(dr.pooled > 1.1, 'pooled pressure is buy-heavy');
  assert.ok(dr.sellWindow && dr.sellWindow.atHour >= 16 && dr.sellWindow.atHour <= 20, 'SELL window at the buy-pressure peak');
  assert.equal(dr.buyWindow, null, 'no buy window — no hour is genuinely sell-heavy');
});

ok('demandRegime: a troughing item classifies sell-heavy with the BUY window at the trough hours', () => {
  const dr = demandRegime(demandSeries(6, h => ({ volHi: 2000, volLo: (h >= 2 && h <= 6) ? 8000 : 3000 })), { nights: 14, now: dcNow });
  assert.equal(dr.regime, 'sell-heavy');
  assert.ok(dr.pooled < 0.9, 'pooled pressure is sell-heavy');
  assert.ok(dr.buyWindow && dr.buyWindow.atHour >= 2 && dr.buyWindow.atHour <= 6, 'BUY window at the sell-pressure trough');
  assert.equal(dr.sellWindow, null, 'no sell window — no hour is genuinely buy-heavy');
});

ok('demandRegime: a flat item is balanced with no windows; thin volume degrades reliability', () => {
  const flat = demandRegime(demandSeries(6, () => ({ volHi: 3000, volLo: 3000 })), { nights: 14, now: dcNow });
  assert.equal(flat.regime, 'balanced');
  assert.equal(flat.buyWindow, null); assert.equal(flat.sellWindow, null);
  const thin = demandRegime(demandSeries(6, h => ({ volHi: (h >= 16 && h <= 20) ? 6 : 3, volLo: 2 })), { nights: 14, now: dcNow });
  assert.ok(thin.hours.every(t => t.reliability < 0.01), 'a handful of units per hour → ~0 reliability (the lean, not a law)');
});

ok('hourlyPressure / demandRegime: too-thin history degrades to null (no false read)', () => {
  assert.equal(hourlyPressure(demandSeries(2, () => ({ volHi: 3000, volLo: 2000 })), { nights: 14, now: dcNow }), null, '2 days < HOURPROFILE_MIN_DAYS');
  assert.equal(demandRegime([], { now: dcNow }), null, 'empty series → null');
});

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

console.log(`\nAll ${pass} acceptance checks passed.`);
