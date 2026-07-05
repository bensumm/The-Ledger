#!/usr/bin/env node
/**
 * windowread.test.mjs — acceptance fixtures for the pure window-range math (pipeline/lib/windowread.mjs).
 *
 * Colocated NEXT TO its subject in pipeline/lib/. windowread is PURE over an already-fetched 1h
 * /timeseries array — fixtures are synthetic points, no live data (CLAUDE.md rule 4).
 * Run: `node pipeline/lib/windowread.test.mjs`  (exits non-zero on any failure).
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
import { inWindow, quantLow, quantHigh, touchedDays, reachedDays, windowStats } from './windowread.mjs';

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

console.log(`\nAll ${pass} acceptance checks passed.`);
