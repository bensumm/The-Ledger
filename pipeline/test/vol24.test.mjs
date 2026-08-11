#!/usr/bin/env node
/**
 * vol24.test.mjs — pins the rolling-24h volume correction (PLAN-VOL24).
 *
 * WHY THIS FILE EXISTS. On 2026-08-10 the ENTIRE correction was reverted as a mutation experiment —
 * `vol24FromInputs` made to return the raw endpoint value unconditionally — and all 109 suites passed.
 * Nothing anywhere pinned it. That is the strongest possible statement of a test gap, and this file
 * closes it: the suite FAILS under that mutation, which is what a pin has to do.
 * ⚠ Be precise about how much it fails by. This line used to claim "every assertion below fails under
 * that mutation"; measured 2026-08-11 by building the mutation as a shim and running this file against
 * it, THREE of the thirteen groups fail (the mutation guard, the F4 anchor-boundary case, and the F5
 * bucket count) and ten pass. Ten passing assertions are ones that hold under a broken implementation
 * and therefore carry no weight ALONE — that is normal for a suite that also pins window arithmetic and
 * degradation shape, but it is not what the old sentence said.
 *
 * WHAT IS ACTUALLY BROKEN (re-measured 2026-08-11 — the ONE home is the loadAll24hRolling header):
 *   • BULK /24h        — a complete, bit-exact UTC-DAY aggregate whose newest data is ~24–48h old. Genuinely
 *                        broken as a trailing-24h source; loadAll24hRolling is the load-bearing fix.
 *   • PER-ITEM /24h?id= — ALSO a complete UTC-DAY aggregate, one day FRESHER than bulk (30/30 exact
 *                        against the day its own timestamp labels, 4/30 against the true trailing
 *                        window). ⚠ Earlier headers here called it "the TRUE trailing-24h" on 22/24 and
 *                        then 19/24 bit-identical; both were measured inside the 00:00–01:00 UTC hour
 *                        where the composed window coincides with the served day. Corrected 2026-08-11.
 *                        So `vol24FromInputs` is presently a NO-OP in production. It is kept as
 *                        zero-fetch insurance, and these tests pin the MECHANISM so a future
 *                        regression (or another silent endpoint change) is caught rather than assumed.
 * The tests below are all deterministic and offline — they construct series directly and never fetch.
 *
 * Run: `node pipeline/test/vol24.test.mjs`  (exits non-zero on any failure).
 */
import assert from 'node:assert/strict';
import { rolling24FromTs1h, vol24FromInputs, ROLL24_HOURS } from '../lib/market/marketfetch.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

// Build a series of hourly buckets ending at the last COMPLETE hour relative to `now`.
// mirrors marketfetch's own lastCompleteHour so the fixtures line up with the window under test.
const HOUR = 3600;
const lastCompleteHour = (now) => Math.floor(now / 1000 / HOUR) * HOUR - HOUR;
const NOW = Date.UTC(2026, 7, 10, 12, 34, 56);           // fixed clock — no Date.now() anywhere
const ANCHOR = lastCompleteHour(NOW);
const FROM = ANCHOR - (ROLL24_HOURS - 1) * HOUR;

// n buckets ending at `end`, each carrying vol units on both sides at a fixed price.
const series = ({ end = ANCHOR, n = 24, vol = 10, hi = 100, lo = 90 } = {}) => {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push({ timestamp: end - i * HOUR, avgHighPrice: hi, avgLowPrice: lo, highPriceVolume: vol, lowPriceVolume: vol });
  }
  return out;
};
const RAW = { highPriceVolume: 999999, lowPriceVolume: 888888, avgHighPrice: 1, avgLowPrice: 1 };

ok('ROLL24_HOURS is 24 (the window the whole correction is defined over)', () => {
  assert.equal(ROLL24_HOURS, 24);
});

// --- the window arithmetic -------------------------------------------------------------------
ok('rolling24FromTs1h sums EXACTLY the 24 buckets in [anchor-23h, anchor], both ends inclusive', () => {
  const r = rolling24FromTs1h(series({ n: 24, vol: 10 }), NOW);
  assert.equal(r.highPriceVolume, 240, '24 buckets × 10 units');
  assert.equal(r.lowPriceVolume, 240);
});

ok('buckets OUTSIDE the window are excluded at both ends (older than `from`, newer than `anchor`)', () => {
  const s = series({ n: 24, vol: 10 });
  s.unshift({ timestamp: FROM - HOUR, avgHighPrice: 100, avgLowPrice: 90, highPriceVolume: 5000, lowPriceVolume: 5000 });
  s.push({ timestamp: ANCHOR + HOUR, avgHighPrice: 100, avgLowPrice: 90, highPriceVolume: 7000, lowPriceVolume: 7000 });
  const r = rolling24FromTs1h(s, NOW);
  assert.equal(r.highPriceVolume, 240, 'the out-of-window buckets must not be summed');
  assert.equal(r.lowPriceVolume, 240);
});

ok('avg prices are VOLUME-WEIGHTED, not a plain mean (a real VWAP, unlike /24h single average)', () => {
  const s = [
    { timestamp: ANCHOR - HOUR, avgHighPrice: 100, avgLowPrice: 100, highPriceVolume: 1, lowPriceVolume: 1 },
    { timestamp: ANCHOR, avgHighPrice: 200, avgLowPrice: 200, highPriceVolume: 99, lowPriceVolume: 99 },
  ];
  const r = rolling24FromTs1h(s, NOW);
  // plain mean would be 150; VWAP is (100×1 + 200×99)/100 = 199
  assert.equal(r.avgHighPrice, 199);
  assert.equal(r.avgLowPrice, 199);
});

// --- THE mutation guard: does the correction happen at all? ----------------------------------
ok('MUTATION GUARD — a full 24h series OVERRIDES the raw endpoint value (volSrc rolling)', () => {
  const { vol24, volSrc } = vol24FromInputs({ vol24: RAW, ts1h: series({ n: 24, vol: 10 }) }, NOW);
  assert.equal(volSrc, 'rolling', 'must not fall through to the raw read');
  assert.equal(vol24.highPriceVolume, 240);
  assert.notEqual(vol24.highPriceVolume, RAW.highPriceVolume, 'the raw value must NOT survive');
});

// --- the degradation contract ----------------------------------------------------------------
ok('DEGRADES to the raw read when no 1h series is present', () => {
  const { vol24, volSrc, buckets } = vol24FromInputs({ vol24: RAW, ts1h: null }, NOW);
  assert.equal(volSrc, 'peritem-24h');
  assert.equal(vol24, RAW);
  assert.equal(buckets, 0);
});

ok('DEGRADES when the series is too SHORT to reach the window start (a partial sum would under-report)', () => {
  const { volSrc, vol24 } = vol24FromInputs({ vol24: RAW, ts1h: series({ n: 6, vol: 10 }) }, NOW);
  assert.equal(volSrc, 'peritem-24h', '6 buckets cannot cover 24h');
  assert.equal(vol24, RAW);
});

// --- F4: the END-OF-WINDOW hole (this assertion FAILED before 2026-08-10) ---------------------
ok('F4 — DEGRADES when the series reaches BACK far enough but stops short of the anchor', () => {
  // 24 buckets, but ending 6h before the anchor: it covers `from`, so the old `earliest <= from`
  // guard passed and summed a window missing its most recent 6 hours — silently, with volSrc 'rolling'.
  const stale = series({ end: ANCHOR - 6 * HOUR, n: 24, vol: 10 });
  const { volSrc, vol24 } = vol24FromInputs({ vol24: RAW, ts1h: stale }, NOW);
  assert.equal(volSrc, 'peritem-24h', 'a series that stops short of the anchor must NOT be trusted');
  assert.equal(vol24, RAW, 'it must fall back rather than report a partial window as a full one');
});

ok('F4 — the boundary case: a series ending EXACTLY at the anchor is still accepted', () => {
  const { volSrc } = vol24FromInputs({ vol24: RAW, ts1h: series({ end: ANCHOR, n: 24 }) }, NOW);
  assert.equal(volSrc, 'rolling', 'the guard must not be off-by-one against a perfectly-covering series');
});

// --- F5: bucket count is reported as a DIAGNOSTIC (no production caller reads it — see the
//         vol24FromInputs header; this test is currently the only thing exercising the field) ---
ok('F5 — `buckets` reports how many in-window buckets backed the answer', () => {
  assert.equal(vol24FromInputs({ vol24: RAW, ts1h: series({ n: 24 }) }, NOW).buckets, 24);
  assert.equal(vol24FromInputs({ vol24: RAW, ts1h: series({ n: 6 }) }, NOW).buckets, 6);
});

// --- the zero-volume contract -----------------------------------------------------------------
ok('an all-zero-volume window falls back rather than reporting a confident 0', () => {
  const { volSrc } = vol24FromInputs({ vol24: RAW, ts1h: series({ n: 24, vol: 0 }) }, NOW);
  assert.equal(volSrc, 'peritem-24h', '0/0 is indistinguishable from "no data" — prefer the endpoint');
});

ok('a null/empty input degrades without throwing', () => {
  assert.equal(rolling24FromTs1h(null, NOW), null);
  assert.equal(rolling24FromTs1h([], NOW), null);
  assert.equal(vol24FromInputs(null, NOW).vol24, null);
  assert.equal(vol24FromInputs({}, NOW).vol24, null);
});

// --- F7: string timestamps must not silently half-work ----------------------------------------
ok('F7 — a STRING-timestamped series degrades safely (guard rejects it; no partial sum is trusted)', () => {
  const s = series({ n: 24 }).map(p => ({ ...p, timestamp: String(p.timestamp) }));
  const { volSrc, vol24 } = vol24FromInputs({ vol24: RAW, ts1h: s }, NOW);
  // rolling24FromTs1h's `>=` WOULD coerce these and sum them; the guard's Number.isFinite does not.
  // The disagreement is real, but it fails in the SAFE direction — pinned here so a future
  // "cleanup" that unifies the coercion has to do so deliberately, not by accident.
  assert.equal(volSrc, 'peritem-24h');
  assert.equal(vol24, RAW);
});

console.log(`\n✓ vol24: ${pass} assertion group(s) passed.`);
