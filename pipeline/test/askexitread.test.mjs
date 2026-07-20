#!/usr/bin/env node
/**
 * askexitread.test.mjs — acceptance fixtures for askExitRead (js/windowread.mjs), the ONE ask-side
 * "typical exit" assembly shared by read-window-range.mjs's `--ask` block and quote-items.mjs
 * --positions' auto-surfaced big-ticket windowExit note (PLAN-POSITIONS-WINDOW-READ).
 *
 * The point of the test is the DE-DUPLICATION guarantee: askExitRead's fields must equal the raw
 * primitives read-window-range.mjs used to compute inline, so the refactor is byte-parity. It also
 * pins the degrade paths (empty/thin stats → null; no ask → ask:null; sparse 5m → grain5m:null).
 * PURE synthetic stats, no live data (rule 4). Run: `node pipeline/test/askexitread.test.mjs`.
 */
import assert from 'node:assert/strict';
import { windowStats, askExitRead, quantHigh, reachedDays, placement, recencySplit, recentQuant, RECENT_NIGHTS, FIVE_MIN_MIN_DAYS } from '../../js/windowread.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

console.log('askExitRead acceptance:');

// Build a synthetic 1h series over a full-day window (wStart:0,wEnd:0 = all 24h) across several days.
// Each day gets one point; per-day high climbs so the ascending `his` is easy to reason about.
function synthSeries(dayHighs, { baseTs = Date.UTC(2026, 0, 1, 12, 0, 0) / 1000, volHi = 500, volLo = 500 } = {}) {
  const DAY = 86400;
  return dayHighs.map((hi, i) => ({
    timestamp: baseTs + i * DAY,
    avgLowPrice: hi - 50,            // a low below the high so windowStats has both sides
    avgHighPrice: hi,
    lowPriceVolume: volLo,
    highPriceVolume: volHi,
  }));
}

// A "now" AFTER the last synthetic day so windowStats doesn't drop today (full-day window is always "in window").
const NOW = new Date(Date.UTC(2026, 0, 20, 12, 0, 0));
const WS = { nights: 14, wStart: 0, wEnd: 0, now: NOW };

ok('null / thin stats → null (degrade, never a fake read)', () => {
  assert.equal(askExitRead(null, { ask: 100 }), null);
  assert.equal(askExitRead({ his: [] }, { ask: 100 }), null);
  assert.equal(askExitRead({}, { ask: 100 }), null);
});

ok('askSide + scored fields equal the raw primitives (the de-dup byte-parity guarantee)', () => {
  const series = synthSeries([100, 110, 120, 130, 140, 150, 160]);
  const stats = windowStats(series, WS);
  assert.ok(stats && stats.his.length === 7, 'fixture built 7 scored days');
  const ASK = 135;
  const aer = askExitRead(stats, { ask: ASK });
  // askSide == the exact inline expressions read-window-range.mjs used
  assert.equal(aer.askSide.q50, quantHigh(stats.his, 0.5));
  assert.equal(aer.askSide.q75, quantHigh(stats.his, 0.75));
  assert.equal(aer.askSide.everyDay, stats.his[0]);
  assert.equal(aer.askSide.recent50, recentQuant(stats.days, 'ask', 0.5, RECENT_NIGHTS));
  assert.equal(aer.askSide.medVol, stats.medVolHi);
  assert.equal(aer.nDays, stats.his.length);
  // scored ask == the exact inline expressions
  assert.equal(aer.ask.level, ASK);
  assert.equal(aer.ask.reachedDays, reachedDays(stats.his, ASK));
  assert.equal(aer.ask.nDays, stats.his.length);
  assert.equal(aer.ask.placement, placement(stats.his, ASK));
  assert.deepEqual(aer.ask.recency, recencySplit(stats.days, 'ask', ASK, RECENT_NIGHTS));
});

ok('ask omitted → summary-only (ask:null, grain5m:null); askSide still computed', () => {
  const stats = windowStats(synthSeries([100, 110, 120, 130, 140]), WS);
  const aer = askExitRead(stats, {});
  assert.equal(aer.ask, null);
  assert.equal(aer.grain5m, null);
  assert.equal(aer.askSide.q50, quantHigh(stats.his, 0.5));
});

ok('grain5m: present at ≥ FIVE_MIN_MIN_DAYS covered days, null below it', () => {
  const stats = windowStats(synthSeries([100, 110, 120, 130, 140, 150]), WS);
  const ASK = 125;
  // a 5m stats with EXACTLY FIVE_MIN_MIN_DAYS highs → grain surfaces
  const s5ok = windowStats(synthSeries(Array.from({ length: FIVE_MIN_MIN_DAYS }, (_, i) => 120 + i * 5)), WS);
  const withGrain = askExitRead(stats, { ask: ASK, stats5m: s5ok });
  assert.ok(withGrain.grain5m, 'grain present at the floor');
  assert.equal(withGrain.grain5m.nDays, s5ok.his.length);
  assert.equal(withGrain.grain5m.reachedDays, reachedDays(s5ok.his, ASK));
  assert.equal(withGrain.grain5m.placement, placement(s5ok.his, ASK));
  // one fewer day than the floor → no grain
  const s5thin = windowStats(synthSeries(Array.from({ length: FIVE_MIN_MIN_DAYS - 1 }, (_, i) => 120 + i * 5)), WS);
  assert.equal(askExitRead(stats, { ask: ASK, stats5m: s5thin }).grain5m, null);
  // grain requires an ask (a summary-only read never scores the 5m level)
  assert.equal(askExitRead(stats, { ask: null, stats5m: s5ok }).grain5m, null);
});

console.log(`\n${pass} assertions passed.`);
