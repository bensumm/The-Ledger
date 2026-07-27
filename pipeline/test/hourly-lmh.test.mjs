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
import { hourlyLMH, hourlyDrift } from '../lib/market/hourly-lmh.mjs';

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

// --- hourlyDrift (PLAN-HOURLY-3DAY-TREND HT0) acceptance -----------------------------------------
// BUSINESS REQUIREMENTS pinned here:
//   - a UNIFORM down-drift across every hour → dominant.dir='down', uniform=true, split=null.
//   - a MIXED (split) shape (half the hours drift, half flat) → uniform=false, a non-null split string.
//   - an item flat across all 3 dates → dominant.dir='flat', magPerDay=0, uniform=true.
//   - the ask-reachability-decay sub-signal: per-day (oldest→newest) count of hours whose HIGH reached
//     the ask, and whether that count is falling day-over-day; absent when no `ask` is passed.
//   - <2 local dates in the series → null (degrade, never a fake read — mirrors hourlyLMH).
console.log('\nhourlyDrift acceptance:');

// Fixture A — UNIFORM DOWN: 3 local dates (Jan 6/7/8), every hour's mid steps down EXACTLY 5000/day
// (~1%/day at these price levels — comfortably over the 0.3%/day flat-epsilon). low=high=level so
// mid=level exactly; a perfectly linear 3-point series gives an exact least-squares slope.
const uniformDownSeries = [];
for (const [dOff, d] of [[0, 6], [1, 7], [2, 8]]) {
  for (let h = 0; h < 24; h++) {
    const level = (500000 + h * 1000) - dOff * 5000;
    uniformDownSeries.push(pt(2026, 0, d, h, level, level));
  }
}
ok('uniform down-drift: dominant.dir=down, uniform=true, split=null, magPerDay=-5000', () => {
  const dr = hourlyDrift(uniformDownSeries, { days: 3 });
  assert.equal(dr.dominant.dir, 'down');
  assert.equal(dr.dominant.uniform, true);
  assert.equal(dr.dominant.split, null);
  assert.equal(dr.dominant.magPerDay, -5000);
});
ok('uniform down-drift: every one of the 24 hours individually reads down', () => {
  const dr = hourlyDrift(uniformDownSeries, { days: 3 });
  const scored = dr.perHour.filter(Boolean);
  assert.equal(scored.length, 24);
  assert.ok(scored.every(h => h.dir === 'down' && h.driftPerDay === -5000));
});

// Fixture B — MIXED (split): mornings (h<12) drop 6000/day, evenings (h≥12) sit dead flat. The whole-item
// median lands on the flat evening half (per the existing upper-middle median convention), so uniform must
// fail (only ~half the hours share the dominant dir) and a split description must name both halves.
const splitSeries = [];
for (const [dOff, d] of [[0, 6], [1, 7], [2, 8]]) {
  for (let h = 0; h < 24; h++) {
    const base = 500000 + h * 1000;
    const level = h < 12 ? base - dOff * 6000 : base;
    splitSeries.push(pt(2026, 0, d, h, level, level));
  }
}
ok('mixed drift: not uniform, split description names mornings and evenings', () => {
  const dr = hourlyDrift(splitSeries, { days: 3 });
  assert.equal(dr.dominant.uniform, false);
  assert.equal(typeof dr.dominant.split, 'string');
  assert.ok(/mornings/.test(dr.dominant.split) && /evenings/.test(dr.dominant.split), dr.dominant.split);
});

// Fixture C — FLAT: identical level across all 3 dates at every hour → zero slope everywhere.
const flatSeries = [];
for (const [dOff, d] of [[0, 6], [1, 7], [2, 8]]) {
  for (let h = 0; h < 24; h++) {
    const level = 500000 + h * 1000;   // same value every date → zero slope (dOff unused on purpose)
    flatSeries.push(pt(2026, 0, d, h, level, level));
  }
}
ok('flat drift: dominant.dir=flat, magPerDay=0, uniform=true', () => {
  const dr = hourlyDrift(flatSeries, { days: 3 });
  assert.equal(dr.dominant.dir, 'flat');
  assert.equal(dr.dominant.magPerDay, 0);
  assert.equal(dr.dominant.uniform, true);
});

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
  const dr = hourlyDrift(askDecaySeries, { days: 3, ask: 1_000_000 });
  assert.deepEqual(dr.askReach.perDay.map(x => x.hoursReached), [18, 11, 4]);
  assert.equal(dr.askReach.decaying, true);
});
ok('ask reach is null when no ask is supplied', () => {
  const dr = hourlyDrift(askDecaySeries, { days: 3 });
  assert.equal(dr.askReach, null);
});

ok('degrade: fewer than 2 local dates → null (never a fake read)', () => {
  const oneDate = [];
  for (let h = 0; h < 24; h++) oneDate.push(pt(2026, 0, 6, h, 100, 100));
  assert.equal(hourlyDrift(oneDate, { days: 3 }), null);
  assert.equal(hourlyDrift([], {}), null);
  assert.equal(hourlyDrift(null, {}), null);
});

console.log(`\nAll ${pass} acceptance checks passed.`);
