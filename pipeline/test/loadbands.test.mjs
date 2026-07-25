/* loadbands.test.mjs — PERF-1 (2026-07-19): loadBands migrated off a flat-file-per-day cache under
 * .cache/bands/ onto the Tier-1 SQLite archive (marketAt('5m', w) instead of parsing every retained
 * day-file — the fix for the ~2.1-2.4s/scan-pass bottleneck, PLAN discussion 2026-07-19). Pinned here:
 *
 * 1. When every needed window is ALREADY in the archive, loadBands does zero network (hasBucket
 *    short-circuits the backfill loop) — verified by NOT mocking fetch and expecting no throw/hang.
 * 2. Aggregation across windows matches computeQuote's min-low/max-high-over-the-window basis,
 *    robustified per Bar E (robustBand) — same contract loadBands always had.
 * 3. active5m / tradedWin / sawLow / sawHigh (Bar D) compute the same as the old flat-file version.
 * 4. Accepts a shared `db` handle (mirrors loadAll24hRolling) so a caller can share one archive
 *    across a pass instead of loadBands opening/closing its own every call.
 */
import assert from 'node:assert/strict';
import { open } from '../lib/archive.mjs';
import { loadBands, loadDailyRangeBulk, FULL_DAY_1H_BUCKETS } from '../lib/marketfetch.mjs';

let n = 0;
async function ok(name, fn) { await fn(); n++; console.log('  ✓ ' + name); }

await (async () => {
  await ok('loadBands aggregates a fully-archived window with zero network calls', async () => {
    const h = open(':memory:');
    const step = 300;
    const now = Math.floor(Date.now() / 1000);
    const latest = Math.floor(now / step) * step - step;
    const hours = 2, nWin = Math.ceil(hours * 3600 / step);   // 24 windows
    for (let i = 0; i < nWin; i++) {
      const w = latest - i * step;
      // item 560: two-sided every window, a rising low so robustBand has spread to work with.
      h.append('5m', w, { 560: { avgHighPrice: 200 + i, avgLowPrice: 150 + i, highPriceVolume: 50, lowPriceVolume: 40 } });
    }
    const bands = await loadBands(hours, { db: h });
    assert.ok(bands[560], 'item present in the aggregated result');
    assert.equal(bands[560].tradedWin, nWin, 'every window counted as traded');
    assert.equal(bands[560].sawLow, true);
    assert.equal(bands[560].sawHigh, true);
    assert.equal(bands[560].active5m, nWin, 'two-sided in every window');
    // low ranges 150..150+nWin-1, high ranges 200..200+nWin-1 — robustBand on a dense (24-print) side
    // takes p10/p90, so the edges sit INSIDE the raw min/max, never outside it.
    assert.ok(bands[560].bandLo >= 150 && bands[560].bandLo <= 150 + nWin - 1);
    assert.ok(bands[560].bandHi >= 200 && bands[560].bandHi <= 200 + nWin - 1);
    assert.equal(bands[560].rawBandLo, 150, 'raw extremum preserved for audit');
    assert.equal(bands[560].rawBandHi, 200 + nWin - 1, 'raw extremum preserved for audit');
    h.close();
  });

  await ok('loadBands: a one-sided window (buy-only) marks sawLow but not sawHigh/active5m', async () => {
    const h = open(':memory:');
    const step = 300;
    const now = Math.floor(Date.now() / 1000);
    const latest = Math.floor(now / step) * step - step;
    h.append('5m', latest, { 561: { avgHighPrice: null, avgLowPrice: 100, highPriceVolume: 0, lowPriceVolume: 15 } });
    const bands = await loadBands(1 / 60 * 5 / 60, { db: h });   // 1 window's worth (5m in hours)
    assert.equal(bands[561].sawLow, true);
    assert.equal(bands[561].sawHigh, false);
    assert.equal(bands[561].active5m, 0, 'one-sided window is not "active" (both-sides-in-one-bucket)');
    assert.equal(bands[561].tradedWin, 1, 'still counts as a traded (density) window');
    h.close();
  });

  await ok('loadBands: an item absent from every window never appears in the result', async () => {
    const h = open(':memory:');
    const step = 300;
    const now = Math.floor(Date.now() / 1000);
    const latest = Math.floor(now / step) * step - step;
    h.append('5m', latest, { 2: { avgHighPrice: 10, avgLowPrice: 8, highPriceVolume: 1, lowPriceVolume: 1 } });
    const bands = await loadBands(1 / 720, { db: h });
    assert.equal(bands[999999], undefined);
    h.close();
  });

  await ok('loadDailyRangeBulk reports coverageDays honestly (full vs partial days), zero fetch', async () => {
    const h = open(':memory:');
    const HOUR = 3600, DAY = 24 * HOUR;
    // anchor two whole UTC days INSIDE the default lookback window (recent, so sinceTs keeps them).
    const todayMid = Math.floor(Date.now() / 1000 / DAY) * DAY;
    const fullDay = todayMid - 2 * DAY;          // give this day all 24 hourly buckets
    const partialDay = todayMid - 1 * DAY;       // give this day only 3 hourly buckets
    for (let i = 0; i < FULL_DAY_1H_BUCKETS; i++)
      h.append('1h', fullDay + i * HOUR, { 560: { avgHighPrice: 200 + i, avgLowPrice: 150 - i, highPriceVolume: 5, lowPriceVolume: 4 } });
    for (let i = 0; i < 3; i++)
      h.append('1h', partialDay + i * HOUR, { 560: { avgHighPrice: 300, avgLowPrice: 100, highPriceVolume: 5, lowPriceVolume: 4 } });
    const r = loadDailyRangeBulk(7, { db: h });   // shared handle ⇒ read-only, no network
    assert.equal(r.coverageDays, 1, 'exactly one FULLY-covered (24-bucket) day');
    assert.equal(r.partialDays, 1, 'the 3-bucket day is partial, not counted as full');
    // range math still correct on the full day: MAX high = 200+23, MIN low = 150-23
    assert.equal(r.ranges[560][Object.keys(r.ranges[560]).sort()[0]] !== undefined, true);
    const fullKey = new Date(fullDay * 1000).toISOString().slice(0, 10);
    assert.deepEqual(r.ranges[560][fullKey], { hi: 200 + 23, lo: 150 - 23 });
    h.close();
  });

  await ok('loadDailyRangeBulk degrades to coverageDays 0 on a cold archive', async () => {
    const h = open(':memory:');
    const r = loadDailyRangeBulk(14, { db: h });
    assert.deepEqual(r, { ranges: {}, coverageDays: 0, partialDays: 0, coverage: {} });
    h.close();
  });

  console.log(`All ${n} checks passed.`);
})();

