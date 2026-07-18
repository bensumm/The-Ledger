#!/usr/bin/env node
/**
 * fill-placement.test.mjs — acceptance fixtures for the PURE calibration core (pipeline/lib/fill-placement.mjs,
 * AC1/AC2). No network, no live data — synthetic 1h points + synthetic lots (rule 4). The command
 * analyze-fill-placement.mjs is a fetch/print shell over these; pinning them here pins the study's math.
 * Run: `node pipeline/test/fill-placement.test.mjs`  (exits non-zero on any failure).
 *
 * BUSINESS REQUIREMENTS pinned here:
 *   - cdf = fraction of the sample at or below x (0 below all, 1 above all); null on empty.
 *   - spearman = +1 on a perfectly increasing relation, −1 on a decreasing one, ~0 on none.
 *   - lotPlacement: sell placement = the daily-HIGH-distribution CDF the realized sellEach cleared
 *     (p100 when sold above every daily high, p0 below all); sizeShare = qty ÷ CORRECTED rolling-24h
 *     volume (total); shareHpv = qty ÷ instabuy-only flow; coverage degrades to 'thin-history' /
 *     'no-series'; and FUTURE points (ts > sellTs) NEVER leak into the placement (the pre-filter).
 *   - smoothingBias joins 5m rows to the 1h series by containing hour: bias = max5m/1havg − 1, emitted
 *     only for hours present on BOTH sides.
 */
import assert from 'node:assert/strict';
import { cdf, spearman, median, quant, lotPlacement, smoothingBias, FP_MIN_DAYS } from '../lib/fill-placement.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };
console.log('fill-placement.mjs AC1/AC2 calibration-core acceptance:');

// --- 1. cdf ------------------------------------------------------------------------------------
ok('cdf: fraction at or below x; 0 below all, 1 above all; null on empty', () => {
  const s = [10, 20, 30, 40];        // ascending
  assert.equal(cdf(s, 25), 0.5);     // 10,20 ≤ 25 → 2/4
  assert.equal(cdf(s, 40), 1);       // all ≤ 40
  assert.equal(cdf(s, 5), 0);        // none
  assert.equal(cdf(s, 1000), 1);     // above every value
  assert.equal(cdf([], 5), null);
});

// --- 2. spearman -------------------------------------------------------------------------------
ok('spearman: +1 increasing, −1 decreasing, ~0 none; null under n<3', () => {
  assert.equal(spearman([[1, 1], [2, 2], [3, 3], [4, 4]]), 1);
  assert.equal(spearman([[1, 4], [2, 3], [3, 2], [4, 1]]), -1);
  assert.equal(spearman([[1, 5]]), null);
  const rho = spearman([[1, 2], [2, 1], [3, 4], [4, 3]]);   // no clean monotone relation
  assert.ok(Math.abs(rho) < 0.9);
});

ok('median / quant: basic order statistics', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([]), null);
  assert.equal(quant([10, 20, 30, 40], 0.5), 20);   // ceil(0.5*4)-1 = 1 → 20 (same ceil-index convention as quantLow)
});

// --- 3. lotPlacement ---------------------------------------------------------------------------
// synthetic contiguous hourly series: day d has constant avgHighPrice=100+d, avgLowPrice=50+d, and a
// flat volume so the rolling-24h sum is deterministic (24 buckets × (hpv 100 + lpv 100) = 4800).
const HOUR = 3600;
function series(days, startTs) {
  const pts = [];
  for (let d = 0; d < days; d++) for (let h = 0; h < 24; h++)
    pts.push({ timestamp: startTs + (d * 24 + h) * HOUR, avgHighPrice: 100 + d, avgLowPrice: 50 + d, highPriceVolume: 100, lowPriceVolume: 100 });
  return pts;
}
const START = 1_780_000_000 - (1_780_000_000 % HOUR);   // hour-aligned base
const s12 = series(12, START);
const sellTsDay10 = START + (10 * 24 + 12) * HOUR;       // sold midday on day 10 → ~10 prior complete days

ok('lotPlacement: sell above every daily high → p100; below all → p0; sizeShare on the corrected denom', () => {
  const hi = lotPlacement({ itemId: 1, qty: 480, buyEach: 40, sellEach: 100000, buyTs: sellTsDay10 - 24 * HOUR, sellTs: sellTsDay10 }, s12);
  assert.equal(hi.coverage, 'ok');
  assert.equal(hi.sellPlacement, 1);                     // above every trailing daily high
  assert.ok(hi.nDaysSell >= FP_MIN_DAYS);
  // rolling-24h total volume = 4800 (24 buckets × 200), instabuy-only = 2400
  assert.equal(hi.volDaySell, 4800);
  assert.ok(Math.abs(hi.sizeShare - 480 / 4800) < 1e-9);
  assert.ok(Math.abs(hi.shareHpv - 480 / 2400) < 1e-9);
  const lo = lotPlacement({ itemId: 1, qty: 10, buyEach: 40, sellEach: 1, buyTs: sellTsDay10 - 24 * HOUR, sellTs: sellTsDay10 }, s12);
  assert.equal(lo.sellPlacement, 0);                     // below every trailing daily high
});

ok('lotPlacement: FUTURE points (ts > sellTs) never leak into the placement', () => {
  // add a monstrous spike AFTER the sell — a naive (unfiltered) read would rank a mid sell as low.
  const withFuture = [...s12, { timestamp: sellTsDay10 + 5 * HOUR, avgHighPrice: 1e9, avgLowPrice: 1e9, highPriceVolume: 100, lowPriceVolume: 100 }];
  const base = lotPlacement({ itemId: 1, qty: 10, buyEach: 40, sellEach: 105, buyTs: sellTsDay10 - 24 * HOUR, sellTs: sellTsDay10 }, s12);
  const fut = lotPlacement({ itemId: 1, qty: 10, buyEach: 40, sellEach: 105, buyTs: sellTsDay10 - 24 * HOUR, sellTs: sellTsDay10 }, withFuture);
  assert.equal(base.sellPlacement, fut.sellPlacement);   // identical — the future spike is filtered out
});

ok('lotPlacement: buy placement reads the daily-LOW distribution (deep buy → low percentile)', () => {
  const deep = lotPlacement({ itemId: 1, qty: 10, buyEach: 1, sellEach: 105, buyTs: sellTsDay10, sellTs: sellTsDay10 + HOUR }, s12);
  assert.equal(deep.buyPlacement, 0);                    // bought below every trailing daily low
});

ok('lotPlacement: coverage degrades — thin-history under FP_MIN_DAYS, no-series on empty', () => {
  const s3 = series(3, START);
  const thin = lotPlacement({ itemId: 1, qty: 10, buyEach: 40, sellEach: 101, buyTs: START + 24 * HOUR, sellTs: START + (2 * 24 + 12) * HOUR }, s3);
  assert.equal(thin.coverage, 'thin-history');
  assert.equal(thin.sellPlacement, null);
  const none = lotPlacement({ itemId: 1, qty: 10, buyEach: 40, sellEach: 101, buyTs: START, sellTs: START + HOUR }, []);
  assert.equal(none.coverage, 'no-series');
});

// --- 4. smoothingBias (AC2) --------------------------------------------------------------------
ok('smoothingBias: max5m/1havg − 1 per containing hour; only hours present on BOTH sides', () => {
  const oneHour = [
    { timestamp: START, avgHighPrice: 100, highPriceVolume: 5000 },
    { timestamp: START + HOUR, avgHighPrice: 200, highPriceVolume: 10 },
    { timestamp: START + 2 * HOUR, avgHighPrice: 300, highPriceVolume: 1 },   // no 5m coverage → dropped
  ];
  const fiveRows = [
    { ts: START + 0, avgHighPrice: 101 }, { ts: START + 300, avgHighPrice: 110 },      // hour START: max 110 vs 100 → +0.10
    { ts: START + HOUR + 0, avgHighPrice: 202 }, { ts: START + HOUR + 600, avgHighPrice: 201 }, // hour START+1: max 202 vs 200 → +0.01
  ];
  const out = smoothingBias(oneHour, fiveRows).sort((a, b) => a.hourTs - b.hourTs);
  assert.equal(out.length, 2);                            // the 3rd 1h hour has no 5m rows
  assert.ok(Math.abs(out[0].bias - 0.10) < 1e-9);
  assert.equal(out[0].vol1hHigh, 5000);
  assert.ok(Math.abs(out[1].bias - 0.01) < 1e-9);
});

console.log(`\n${pass} assertions passed.`);
