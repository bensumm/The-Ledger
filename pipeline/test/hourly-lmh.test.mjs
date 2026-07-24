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
import { hourlyLMH } from '../lib/hourly-lmh.mjs';

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

console.log(`\nAll ${pass} acceptance checks passed.`);
