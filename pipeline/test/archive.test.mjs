/* archive.test.mjs — BUSINESS REQUIREMENTS pinned for the Tier-1 SQLite market archive (D0):
 *
 * 1. IDEMPOTENCY BY CONSTRUCTION: appending the same (grain, ts) bucket twice inserts each item row
 *    exactly once (PK (grain,ts,itemId) + INSERT OR IGNORE). A re-append reports inserted:0. This is
 *    the "no duplicates" invariant the whole archive rests on.
 * 2. hasBucket is the check-before-fetch predicate: false before the first append, true after.
 * 3. seriesFor returns the ascending raw rows for one item across a ts range — matching a
 *    hand-computed slice; marketAt returns the whole-market slice at one bucket — matching the
 *    hand-built map. Only the four RAW fields are stored (no derived values).
 * 4. exportFixture emits a deterministic, sorted, RAW-only fixture that ROUND-TRIPS: re-appending it
 *    into a fresh DB reproduces the same seriesFor/marketAt reads.
 * 5. pruneBefore (the shipped-unused utility) deletes strictly-older rows/buckets and nothing newer.
 * 6. append REFUSES a non-bucketed grain (guards the "never /latest" invariant).
 * 7. The daily-proxy backing (dailyMidsAt) derives mid1h from raw rows AND unions the one-time
 *    daily_seed mids — the byte-identical bridge for loadDaily's re-point.
 * 8. CI NEVER opens the real DB: every test here uses :memory: or an os.tmpdir() file — never
 *    archive.DEFAULT_DB. (Asserted structurally: we only ever pass ':memory:' / a tmp path.)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { open, DEFAULT_DB, GRAINS } from '../lib/archive.mjs';

let n = 0;
function ok(name, fn) { fn(); n++; console.log('  ✓ ' + name); }

// A synthetic whole-market /5m-shaped snapshot for a bucket.
const snap = (a, b, c) => ({
  2:   { avgHighPrice: a,   avgLowPrice: a - 8, highPriceVolume: 100, lowPriceVolume: 90 },
  560: { avgHighPrice: b,   avgLowPrice: b - 3, highPriceVolume: 5000, lowPriceVolume: 4000 },
  561: { avgHighPrice: c,   avgLowPrice: c - 1, highPriceVolume: 20, lowPriceVolume: 10 },
});

const T0 = 1783560000, T1 = 1783560300, T2 = 1783560600;   // three consecutive 5m buckets

ok('append is idempotent — same bucket twice = one row per item', () => {
  const h = open(':memory:');
  const first = h.append('5m', T0, snap(257, 100, 5));
  assert.equal(first.inserted, 3, 'three item rows on first append');
  assert.equal(first.bucketNew, true);
  const second = h.append('5m', T0, snap(999, 999, 999));   // same bucket ts → IGNORED, no overwrite
  assert.equal(second.inserted, 0, 're-append inserts nothing');
  assert.equal(second.bucketNew, false);
  assert.equal(h.observationCount(), 3, 'still exactly three rows');
  // and the ORIGINAL values are preserved (INSERT OR IGNORE never overwrites)
  assert.equal(h.marketAt('5m', T0)[2].avgHighPrice, 257);
  h.close();
});

ok('hasBucket is the check-before-fetch predicate', () => {
  const h = open(':memory:');
  assert.equal(h.hasBucket('5m', T0), false);
  h.append('5m', T0, snap(257, 100, 5));
  assert.equal(h.hasBucket('5m', T0), true);
  assert.equal(h.hasBucket('1h', T0), false, 'grain is part of the key');
  h.close();
});

ok('seriesFor returns the ascending raw slice, matching a hand-computed one', () => {
  const h = open(':memory:');
  h.append('5m', T0, snap(257, 100, 5));
  h.append('5m', T1, snap(258, 101, 6));
  h.append('5m', T2, snap(259, 102, 7));
  const s = h.seriesFor(560, '5m', {});
  assert.deepEqual(s.map(r => r.ts), [T0, T1, T2], 'ascending by ts');
  assert.deepEqual(s.map(r => r.avgHighPrice), [100, 101, 102]);
  assert.deepEqual(s.map(r => r.avgLowPrice), [97, 98, 99]);
  // ONLY raw fields present (no derived mid etc.)
  assert.deepEqual(Object.keys(s[0]).sort(),
    ['avgHighPrice', 'avgLowPrice', 'highPriceVolume', 'lowPriceVolume', 'ts'].sort());
  // bounded range
  const mid = h.seriesFor(560, '5m', { from: T1, to: T1 });
  assert.deepEqual(mid.map(r => r.ts), [T1]);
  h.close();
});

ok('marketAt returns the whole-market slice at a bucket, matching the hand-built map', () => {
  const h = open(':memory:');
  h.append('5m', T0, snap(257, 100, 5));
  const m = h.marketAt('5m', T0);
  assert.deepEqual(Object.keys(m).map(Number).sort((a, b) => a - b), [2, 560, 561]);
  assert.deepEqual(m[561], { avgHighPrice: 5, avgLowPrice: 4, highPriceVolume: 20, lowPriceVolume: 10 });
  assert.deepEqual(h.marketAt('5m', T2), {}, 'empty for an unstored bucket');
  h.close();
});

ok('append refuses a non-bucketed grain (never /latest)', () => {
  const h = open(':memory:');
  assert.throws(() => h.append('latest', T0, snap(1, 1, 1)), /non-bucketed grain/);
  assert.ok(!GRAINS.has('latest'));
  h.close();
});

ok('exportFixture is deterministic, RAW-only, and round-trips into a fresh DB', () => {
  const src = open(':memory:');
  src.append('5m', T0, snap(257, 100, 5));
  src.append('5m', T1, snap(258, 101, 6));
  src.append('1h', T0, snap(300, 200, 9));
  const fx = src.exportFixture({ grain: '5m' });
  // sorted grain→ts→itemId, only the four raw fields (+ keys grain/ts/itemId)
  assert.equal(fx.schema, 'coffer-archive-fixture/1');
  assert.deepEqual(fx.observations.map(o => [o.grain, o.ts, o.itemId]),
    [['5m', T0, 2], ['5m', T0, 560], ['5m', T0, 561], ['5m', T1, 2], ['5m', T1, 560], ['5m', T1, 561]]);
  assert.ok(fx.observations.every(o => Object.keys(o).sort().join() ===
    ['avgHighPrice', 'avgLowPrice', 'grain', 'highPriceVolume', 'itemId', 'lowPriceVolume', 'ts'].sort().join()));

  // round-trip: rebuild whole-market buckets from the fixture, append into a fresh DB, reads match
  const dst = open(':memory:');
  const byBucket = new Map();
  for (const o of fx.observations) {
    const key = o.grain + '@' + o.ts;
    if (!byBucket.has(key)) byBucket.set(key, { grain: o.grain, ts: o.ts, data: {} });
    byBucket.get(key).data[o.itemId] = {
      avgHighPrice: o.avgHighPrice, avgLowPrice: o.avgLowPrice,
      highPriceVolume: o.highPriceVolume, lowPriceVolume: o.lowPriceVolume };
  }
  for (const b of byBucket.values()) dst.append(b.grain, b.ts, b.data);
  assert.deepEqual(dst.seriesFor(560, '5m', {}), src.seriesFor(560, '5m', {}));
  assert.deepEqual(dst.marketAt('5m', T0), src.marketAt('5m', T0));

  // export to a temp FILE and confirm it parses back to the same object
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'd0-')), 'fx.json');
  src.exportFixture({ grain: '5m', path: tmp });
  // JSON-normalize both sides: node:sqlite hands back null-prototype row objects, so compare values.
  assert.deepEqual(JSON.parse(fs.readFileSync(tmp, 'utf8')), JSON.parse(JSON.stringify(fx)));
  src.close(); dst.close();
});

ok('pruneBefore deletes strictly-older rows/buckets, keeps newer', () => {
  const h = open(':memory:');
  h.append('5m', T0, snap(257, 100, 5));
  h.append('5m', T1, snap(258, 101, 6));
  h.append('5m', T2, snap(259, 102, 7));
  const r = h.pruneBefore(T2);                                 // drop T0 + T1, keep T2
  assert.equal(r.observations, 6);                            // two buckets × three items
  assert.equal(r.buckets, 2);
  assert.equal(h.hasBucket('5m', T0), false);
  assert.equal(h.hasBucket('5m', T2), true);
  assert.equal(h.observationCount(), 3);
  h.close();
});

ok('dailyMidsAt derives mid1h from raw AND unions the seeded mids (loadDaily bridge)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd0-seed-'));
  // a pre-D0 .cache/daily file: {window:{id:mid}} — derived mids only
  fs.writeFileSync(path.join(dir, '2026-06-19.json'),
    JSON.stringify({ [T0]: { 2: 288.5, 560: 150 }, [T1]: { 2: 290 } }));
  const dbf = path.join(dir, 'a.sqlite');
  const h = open(dbf);
  const res = h.seedDailyFromCache(dir);
  assert.equal(res.seeded, 3, 'three seed mids imported');
  assert.equal(h.seedDailyFromCache(dir).alreadyDone, true, 'seed runs at most once');
  // seed-only window
  assert.deepEqual(h.dailyMidsAt(T0), { 2: 288.5, 560: 150 });
  assert.equal(h.hasDailyWindow(T0), true);
  // now append a RAW 1h bucket at T1 — raw mid1h((avgLow+avgHigh)/2) OVERRIDES the seed for those ids
  h.append('1h', T1, { 2: { avgHighPrice: 258, avgLowPrice: 250 }, 999: { avgHighPrice: 10, avgLowPrice: 8 } });
  const m = h.dailyMidsAt(T1);
  assert.equal(m[2], 254, 'raw mid1h = (250+258)/2 overrides the 290 seed');
  assert.equal(m[999], 9, 'raw-only id present');
  assert.equal(h.hasDailyWindow(T2), false, 'unseen window');
  h.close();
});

const dkey = ts => new Date(ts * 1000).toISOString().slice(0, 10);   // the UTC day key dailyRangeBulk groups on

ok('dailyRangeBulk aggregates per-item per-day MAX-high/MIN-low off raw /1h, with coverage', () => {
  const h = open(':memory:');
  // Two consecutive whole UTC days of /1h buckets (midnight-aligned so +3600 steps stay same UTC day).
  const D1 = 1750291200;                       // a UTC midnight
  const D2 = D1 + 24 * 3600;                    // the next UTC midnight
  const K1 = dkey(D1), K2 = dkey(D2);
  // day 1: two 1h buckets for item 560 → hi=MAX(highs), lo=MIN(lows)
  h.append('1h', D1, { 560: { avgHighPrice: 100, avgLowPrice: 90, highPriceVolume: 5, lowPriceVolume: 4 } });
  h.append('1h', D1 + 3600, { 560: { avgHighPrice: 120, avgLowPrice: 80, highPriceVolume: 5, lowPriceVolume: 4 } });
  // day 2: one 1h bucket for 560 + one for 2
  h.append('1h', D2, { 560: { avgHighPrice: 110, avgLowPrice: 95, highPriceVolume: 5, lowPriceVolume: 4 },
                       2:   { avgHighPrice: 300, avgLowPrice: 250, highPriceVolume: 1, lowPriceVolume: 1 } });
  // a /5m bucket must NOT leak into the 1h daily-range aggregate
  h.append('5m', D1, { 560: { avgHighPrice: 9999, avgLowPrice: 1, highPriceVolume: 1, lowPriceVolume: 1 } });

  const { ranges, coverage } = h.dailyRangeBulk({});
  assert.deepEqual(ranges[560][K1], { hi: 120, lo: 80 }, 'MAX high / MIN low across the day 1h buckets');
  assert.deepEqual(ranges[560][K2], { hi: 110, lo: 95 });
  assert.deepEqual(ranges[2][K2], { hi: 300, lo: 250 });
  assert.equal(ranges[560][K1].hi, 120, '/5m never leaks into the 1h daily-range aggregate');
  // coverage counts distinct 1h buckets per day (2 on day 1, 1 on day 2) — the honesty field's source
  assert.equal(coverage[K1], 2);
  assert.equal(coverage[K2], 1);

  // ids whitelist restricts the aggregate
  const only560 = h.dailyRangeBulk({ ids: [560] });
  assert.ok(only560.ranges[560], 'whitelisted id present');
  assert.ok(!only560.ranges[2], 'non-whitelisted id absent');

  // sinceTs lower-bounds the window (drops day 1 entirely)
  const recent = h.dailyRangeBulk({ sinceTs: D2 });
  assert.ok(!recent.ranges[560][K1], 'day 1 excluded by sinceTs');
  assert.deepEqual(recent.ranges[560][K2], { hi: 110, lo: 95 });
  assert.equal(recent.coverage[K1], undefined, 'day 1 coverage also dropped by sinceTs');
  h.close();
});

ok('dailyRangeBulk degrades honestly on a cold archive (empty, never throws)', () => {
  const h = open(':memory:');
  const r = h.dailyRangeBulk({});
  assert.deepEqual(r, { ranges: {}, coverage: {} });
  const r2 = h.dailyRangeBulk({ ids: [560], sinceTs: 1750291200 });
  assert.deepEqual(r2, { ranges: {}, coverage: {} });
  h.close();
});

ok('dailyRangeBulk round-trips through an exported fixture (synthetic multi-day)', () => {
  const D1 = 1750291200, D2 = D1 + 24 * 3600;
  const src = open(':memory:');
  src.append('1h', D1, { 560: { avgHighPrice: 100, avgLowPrice: 90, highPriceVolume: 5, lowPriceVolume: 4 } });
  src.append('1h', D2, { 560: { avgHighPrice: 130, avgLowPrice: 88, highPriceVolume: 5, lowPriceVolume: 4 } });
  const fx = src.exportFixture({ grain: '1h' });
  // rebuild whole-market buckets from the fixture into a fresh DB (exportFixture round-trip shape)
  const dst = open(':memory:');
  const byBucket = new Map();
  for (const o of fx.observations) {
    const key = o.grain + '@' + o.ts;
    if (!byBucket.has(key)) byBucket.set(key, { grain: o.grain, ts: o.ts, data: {} });
    byBucket.get(key).data[o.itemId] = {
      avgHighPrice: o.avgHighPrice, avgLowPrice: o.avgLowPrice,
      highPriceVolume: o.highPriceVolume, lowPriceVolume: o.lowPriceVolume };
  }
  for (const b of byBucket.values()) dst.append(b.grain, b.ts, b.data);
  assert.deepEqual(dst.dailyRangeBulk({}), src.dailyRangeBulk({}), 'ranges+coverage survive the round-trip');
  src.close(); dst.close();
});

ok('the tests never target the real archive DB', () => {
  // structural guard: DEFAULT_DB is a real on-disk path outside .cache/, and this suite must not use it.
  assert.ok(/\.market-archive\.sqlite$/.test(DEFAULT_DB));
  assert.ok(!DEFAULT_DB.includes(`${path.sep}.cache${path.sep}`), 'archive lives OUTSIDE the disposable .cache tree');
});

console.log(`All ${n} checks passed.`);
