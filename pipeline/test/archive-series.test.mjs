#!/usr/bin/env node
/**
 * archive-series.test.mjs — acceptance fixtures for archiveSeries/aggregate1hTo6h
 * (pipeline/lib/market/archive-series.mjs), the AF4 adapter that lets a Stage-2 gate read the LOCAL
 * archive instead of paying a per-item /timeseries call.
 *
 * Fixtures ONLY — a fake archive handle, no sqlite and no fetch.
 *
 * BUSINESS REQUIREMENTS pinned here:
 *   - THE RENAME IS THE POINT: the archive stores `ts`, every consumer reads `timestamp`. Fed raw,
 *     archive rows are silently dropped by `quotecore.js:246`'s `p.timestamp != null` filter and by
 *     windowread's date builders — windowStats returns empty, gates degrade-to-pass, nothing throws.
 *     This test exists so that failure can never ship: the emitted rows MUST carry `timestamp` and
 *     MUST NOT carry `ts`.
 *   - the four value columns pass through byte-identical (verified live: 364 identical / 0 differing
 *     1h buckets per item across four price tiers).
 *   - an unstored grain ('6h', '24h') → [] so the caller falls back to a live fetch, never a silent
 *     "no trades".
 *   - 6h aggregation is VOLUME-WEIGHTED and exact over an aligned partition — NOT a mean of means.
 *   - a side with zero volume in the whole window → null on that side (matches how the wiki reports an
 *     untraded side, so downstream null-handling is unchanged), while the OTHER side still reports.
 *   - `sourceBuckets` counts the 1h buckets that fed each window: measured 6/6 → 0.000% error vs live,
 *     3/6 → ~1.3–1.7%, so a coverage-sensitive caller can refuse a thin window.
 */
import assert from 'node:assert/strict';
import { archiveSeries, aggregate1hTo6h, STORED_GRAINS } from '../lib/market/archive-series.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

// a fake archive handle: seriesFor returns `ts`-keyed rows, exactly like the real sqlite reader.
const handleOf = rows => ({
  seriesFor(_id, _grain, { from, to }) {
    return rows.filter(r => r.ts >= from && r.ts <= to).sort((a, b) => a.ts - b.ts);
  },
});
const row = (ts, hi, lo, hv = 1, lv = 1) => ({ ts, avgHighPrice: hi, avgLowPrice: lo, highPriceVolume: hv, lowPriceVolume: lv });

console.log('archive-series:');

ok('emits `timestamp`, never `ts` — the silent-drop guard', () => {
  const out = archiveSeries(handleOf([row(1000, 50, 40)]), 1, '1h', { from: 0, to: 9999 });
  assert.equal(out.length, 1);
  assert.equal(out[0].timestamp, 1000);
  assert.ok(!('ts' in out[0]), 'row must not carry `ts` — consumers key on `timestamp`');
});

ok('passes the four value columns through unchanged', () => {
  const out = archiveSeries(handleOf([row(1000, 51, 40, 7, 9)]), 1, '1h', { from: 0, to: 9999 });
  assert.deepEqual(out[0], { timestamp: 1000, avgHighPrice: 51, avgLowPrice: 40, highPriceVolume: 7, lowPriceVolume: 9 });
});

ok('unstored grain → [] (caller falls back to live, never a fake "no trades")', () => {
  const h = handleOf([row(1000, 50, 40)]);
  assert.deepEqual(archiveSeries(h, 1, '6h', { from: 0, to: 9999 }), []);
  assert.deepEqual(archiveSeries(h, 1, '24h', { from: 0, to: 9999 }), []);
  assert.ok(STORED_GRAINS.has('1h') && STORED_GRAINS.has('5m') && !STORED_GRAINS.has('6h'));
});

ok('null/absent handle → [] rather than throwing', () => {
  assert.deepEqual(archiveSeries(null, 1, '1h', { days: 1 }), []);
});

ok('`days` window is honoured against an injected now', () => {
  const now = 1_000_000;
  const h = handleOf([row(now - 5 * 86400, 10, 9), row(now - 1 * 86400, 20, 19)]);
  const out = archiveSeries(h, 1, '1h', { days: 2, now });
  assert.equal(out.length, 1);
  assert.equal(out[0].avgHighPrice, 20);
});

ok('6h aggregation is VOLUME-WEIGHTED, not a mean of means', () => {
  // one 6h window: 100gp on 1 unit, 200gp on 9 units → vw mean 190, NOT the naive 150.
  const src = [
    { timestamp: 0, avgHighPrice: 100, avgLowPrice: 100, highPriceVolume: 1, lowPriceVolume: 1 },
    { timestamp: 3600, avgHighPrice: 200, avgLowPrice: 200, highPriceVolume: 9, lowPriceVolume: 9 },
  ];
  const out = aggregate1hTo6h(src);
  assert.equal(out.length, 1);
  assert.equal(out[0].avgHighPrice, 190);
  assert.equal(out[0].highPriceVolume, 10);
});

ok('buckets align to 6h boundaries and sort ascending', () => {
  const SIX = 21600;
  const out = aggregate1hTo6h([
    { timestamp: SIX + 100, avgHighPrice: 10, avgLowPrice: 9, highPriceVolume: 1, lowPriceVolume: 1 },
    { timestamp: 50, avgHighPrice: 20, avgLowPrice: 19, highPriceVolume: 1, lowPriceVolume: 1 },
  ]);
  assert.deepEqual(out.map(r => r.timestamp), [0, SIX]);
});

ok('a side with no volume → null on that side, other side still reports', () => {
  const out = aggregate1hTo6h([
    { timestamp: 0, avgHighPrice: 100, avgLowPrice: null, highPriceVolume: 5, lowPriceVolume: 0 },
  ]);
  assert.equal(out[0].avgHighPrice, 100);
  assert.equal(out[0].avgLowPrice, null);
  assert.equal(out[0].lowPriceVolume, 0);
});

ok('sourceBuckets counts contributing 1h buckets (the coverage gate)', () => {
  const src = [0, 3600, 7200].map(t => ({ timestamp: t, avgHighPrice: 10, avgLowPrice: 9, highPriceVolume: 1, lowPriceVolume: 1 }));
  const out = aggregate1hTo6h(src);
  assert.equal(out[0].sourceBuckets, 3);   // 3 of 6 hours traded → measured ~1.3–1.7% drift vs live
});

ok('empty / malformed input degrades to [] rather than throwing', () => {
  assert.deepEqual(aggregate1hTo6h([]), []);
  assert.deepEqual(aggregate1hTo6h(null), []);
  assert.deepEqual(aggregate1hTo6h([null, { timestamp: null }]), []);
});

console.log(`  ${pass} assertion group(s) passed`);
