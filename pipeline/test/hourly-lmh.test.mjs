#!/usr/bin/env node
/**
 * hourly-lmh.test.mjs — acceptance fixtures for hourlyLMH (pipeline/lib/hourly-lmh.mjs), the pure
 * per-LOCAL-hour LOW/MID/HIGH read behind `read-window-range.mjs --hourly`.
 *
 * Fixtures ONLY — a canned 1h array, no fetch. Points are built with `new Date(y, mo, d, h)` (a LOCAL
 * constructor), so the helper's getHours()/getDate() bucketing lands on exactly the (date, hour) the
 * fixture intends REGARDLESS of the machine timezone (Jan dates → no DST boundary to perturb an hour).
 *
 * BUSINESS REQUIREMENTS pinned here:
 *   - the 7d-avg block medians over the last 7 LOCAL dates (older dates excluded); L=median(avgLow),
 *     H=median(avgHigh), M=median(round((avgHigh+avgLow)/2)).
 *   - the per-day block breaks out the last N dates MOST-RECENT-FIRST (default 3); a date's own L/M/H.
 *   - an hour with no point → avg7 all-null AND every per-day entry null (never a fabricated number).
 *   - mid degrades to the present side when only one of low/high exists.
 *   - LOCAL hour-of-day bucketing (a point built at local hour H lands in row H).
 *   - empty series → null (degrade, never a fake read).
 */
import assert from 'node:assert/strict';
import { hourlyLMH, askReachDecay } from '../lib/market/hourly-lmh.mjs';
import * as MOD from '../lib/market/hourly-lmh.mjs';   // DT3 — namespace import for the stays-deleted pin below

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

// a 1h point at a LOCAL (year, month0, day, hour): TZ-independent bucketing (see header).
const pt = (y, mo, d, h, low, high) => ({
  timestamp: Math.floor(new Date(y, mo, d, h, 0, 0).getTime() / 1000),
  avgLowPrice: low, avgHighPrice: high,
});

console.log('hourlyLMH acceptance:');

// 8 local dates Jan 1–8 2026; hour 10 carries a ramp of lows (high = low+5). Jan 1 is the 8th-oldest
// → EXCLUDED from the 7-date average window (tests the last-7 slice).
const series = [];
const lowsByDay = { 1: 100, 2: 10, 3: 20, 4: 30, 5: 40, 6: 50, 7: 60, 8: 70 };
for (const d of [1, 2, 3, 4, 5, 6, 7, 8]) series.push(pt(2026, 0, d, 10, lowsByDay[d], lowsByDay[d] + 5));
// a low-only point at a different hour on the newest day (mid degrades to the low, high null)
series.push(pt(2026, 0, 8, 15, 200, null));

ok('avgDates = the last 7 local dates (oldest excluded), ascending', () => {
  const hl = hourlyLMH(series, { days: 3 });
  assert.deepEqual(hl.avgDates, ['2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08']);
});

ok('perDayDates = last 3 dates, MOST-RECENT-FIRST', () => {
  const hl = hourlyLMH(series, { days: 3 });
  assert.deepEqual(hl.perDayDates, ['2026-01-08', '2026-01-07', '2026-01-06']);
});

ok('hour 10 7d-avg = median L/M/H over the 7 dates', () => {
  const hl = hourlyLMH(series, { days: 3 });
  const h10 = hl.hours.find(r => r.h === 10);
  // lows Jan2..8 = [10,20,30,40,50,60,70] → median 40; highs = +5 → 45; mids = round(low+2.5) → median 43
  assert.deepEqual(h10.avg7, { low: 40, mid: 43, high: 45 });
});

ok('hour 10 per-day breaks out each date own L/M/H, most-recent-first', () => {
  const hl = hourlyLMH(series, { days: 3 });
  const h10 = hl.hours.find(r => r.h === 10);
  assert.deepEqual(h10.perDay, [
    { date: '2026-01-08', low: 70, mid: 73, high: 75 },   // round(72.5)=73
    { date: '2026-01-07', low: 60, mid: 63, high: 65 },
    { date: '2026-01-06', low: 50, mid: 53, high: 55 },
  ]);
});

ok('an empty hour → avg7 all null AND every per-day entry null', () => {
  const hl = hourlyLMH(series, { days: 3 });
  const h3 = hl.hours.find(r => r.h === 3);   // nothing traded at hour 3
  assert.deepEqual(h3.avg7, { low: null, mid: null, high: null });
  assert.deepEqual(h3.perDay, [null, null, null]);
});

ok('all 24 hours present in the grid', () => {
  const hl = hourlyLMH(series, { days: 3 });
  assert.equal(hl.hours.length, 24);
  assert.deepEqual(hl.hours.map(r => r.h), Array.from({ length: 24 }, (_, i) => i));
});

ok('mid degrades to the present side when only one of low/high exists (hour 15, low-only)', () => {
  const hl = hourlyLMH(series, { days: 1 });
  const h15 = hl.hours.find(r => r.h === 15);
  assert.deepEqual(h15.avg7, { low: 200, mid: 200, high: null });   // high absent → mid = low
  assert.deepEqual(h15.perDay, [{ date: '2026-01-08', low: 200, mid: 200, high: null }]);
});

ok('LOCAL-hour bucketing — the hour-10 ramp lands in row 10, not elsewhere', () => {
  const hl = hourlyLMH(series, { days: 3 });
  // only hours 10 and 15 carry data; every other hour is empty
  const nonEmpty = hl.hours.filter(r => r.avg7.low != null || r.avg7.high != null).map(r => r.h);
  assert.deepEqual(nonEmpty.sort((a, b) => a - b), [10, 15]);
});

ok('empty / non-array series → null', () => {
  assert.equal(hourlyLMH([], {}), null);
  assert.equal(hourlyLMH(null, {}), null);
  assert.equal(hourlyLMH([{ timestamp: 1, avgLowPrice: null, avgHighPrice: null }], {}), null);
});

// --- askReachDecay (PLAN-DIURNAL-TRIAGE DT3) acceptance ------------------------------------------
// BUSINESS REQUIREMENTS pinned here:
//   - per-day (oldest→newest) count + RATE of hours whose HIGH reached the ask, and whether that rate
//     is falling day-over-day.
//   - null when no `ask` is supplied (the read is meaningless without a level to score against).
//   - a partial newest day cannot false-trigger `decaying` (the RATE, not the raw count, is judged).
//   - <2 local dates in the series → null (degrade, never a fake read — mirrors hourlyLMH).
// These fixtures are PORTED from the deleted hourlyDrift acceptance block: the ask-decay sub-signal is
// the one piece of that read measured predictive, so its coverage survives the slope's deletion intact.
console.log('\naskReachDecay acceptance:');

// Fixture D — ASK-REACHABILITY DECAY (the rapier anchor): oldest date's HIGH reaches a 1.0m ask on 18
// hours, the middle date on 11, the newest on only 4 — the "stopped clearing intraday" tell.
const askDecayCounts = { 6: 18, 7: 11, 8: 4 };
const askDecaySeries = [];
for (const d of [6, 7, 8]) {
  const n = askDecayCounts[d];
  for (let h = 0; h < 24; h++) {
    const high = h < n ? 1_050_000 : 900_000;
    askDecaySeries.push(pt(2026, 0, d, h, high - 10_000, high));
  }
}
ok('ask-reachability decay: perDay counts oldest→newest, decaying=true', () => {
  const dr = askReachDecay(askDecaySeries, { days: 3, ask: 1_000_000 });
  assert.deepEqual(dr.perDay.map(x => x.hoursReached), [18, 11, 4]);
  assert.equal(dr.decaying, true);
});
ok('null when no ask is supplied (nothing to score reach against)', () => {
  assert.equal(askReachDecay(askDecaySeries, { days: 3 }), null);
});
ok('a RISING reach rate is not decay', () => {
  const rising = [];
  for (const [d, n] of [[6, 4], [7, 11], [8, 18]]) {
    for (let h = 0; h < 24; h++) {
      const high = h < n ? 1_050_000 : 900_000;
      rising.push(pt(2026, 0, d, h, high - 10_000, high));
    }
  }
  assert.equal(askReachDecay(rising, { days: 3, ask: 1_000_000 }).decaying, false);
});
ok('a PARTIAL newest day cannot false-trigger decay (the RATE is judged, not the raw count)', () => {
  // every logged hour reaches the ask on all three dates, but today has only 6 hours logged so far.
  const partial = [];
  for (const [d, hours] of [[6, 24], [7, 24], [8, 6]]) {
    for (let h = 0; h < hours; h++) partial.push(pt(2026, 0, d, h, 1_040_000, 1_050_000));
  }
  const dr = askReachDecay(partial, { days: 3, ask: 1_000_000 });
  assert.deepEqual(dr.perDay.map(x => x.hoursReached), [24, 24, 6], 'raw counts DO fall (24→24→6)');
  assert.equal(dr.decaying, false, 'but the rate is 100% every day, so this is NOT decay');
});
ok('degrade: fewer than 2 local dates → null (never a fake read)', () => {
  const oneDate = [];
  for (let h = 0; h < 24; h++) oneDate.push(pt(2026, 0, 6, h, 100, 100));
  assert.equal(askReachDecay(oneDate, { days: 3, ask: 100 }), null);
  assert.equal(askReachDecay([], { ask: 100 }), null);
  assert.equal(askReachDecay(null, { ask: 100 }), null);
});

// --- STAYS-DELETED pin (PLAN-DIURNAL-TRIAGE DT3) -------------------------------------------------
// The per-hour least-squares slope read (hourlyDrift + its two PLACEHOLDER constants) was deleted
// 2026-08-09 after measuring 49.7% direction and beating predict-no-change on 6 of 380 items. A deleted
// behaviour deserves a cheap stays-deleted pin, so a future agent rebuilding it from stale docs trips a
// test rather than shipping it. Full refutation + honesty limits: the tombstone in hourly-lmh.mjs.
ok('hourlyDrift and its constants stay deleted', () => {
  assert.equal(MOD.hourlyDrift, undefined, 'the per-hour slope read must not come back');
  assert.equal(MOD.HOURLY_DRIFT_FLAT_FRAC, undefined);
  assert.equal(MOD.HOURLY_DRIFT_UNIFORM_FRAC, undefined);
});

console.log(`\nAll ${pass} acceptance checks passed.`);
