#!/usr/bin/env node
/**
 * archive-6h-pin.test.mjs — acceptance fixtures for AF5b's 6h read: `archive6h` (the WINDOW PIN) and
 * `sixHourReader` (the seam that makes "flag off is byte-identical" a property, not a promise).
 * Both live in pipeline/lib/market/archive-series.mjs. See PLAN-ARCHIVE-FIRST-FUNNEL §8.
 *
 * Fixtures ONLY — a fake archive handle, no sqlite, no fetch, no clock (an injected `now`).
 *
 * BUSINESS REQUIREMENTS pinned here:
 *   - THE PIN IS THE POINT, and it is a STANDING contract, not a migration-day detail. `phase()` is
 *     DEPTH-DEPENDENT (baseMid = median of points OLDER than the lookback, js/quotecore.js:252;
 *     peakMid = max over ALL points, :255-256), and the live `/timeseries?timestep=6h` endpoint caps at
 *     365 points ≈ 91d. The archive holds ~70d TODAY but accrues forever — past ~2026-08-28 it is
 *     DEEPER than live, and an unpinned read would silently drift phase verdicts from then on. The
 *     depth-flip test below builds exactly that future and shows the flip (spike→base) an unpinned read
 *     produces and the pin prevents. A 165-item study measured 4/165 such flips full-series vs 0/165
 *     same-span — but see the DEPTH FLOOR note below: the 0/165 same-span figure was later FALSIFIED as
 *     a general claim (2/60 same-span flips in the 00:00–02:00 window), so the pin fixes the DEPTH
 *     artifact only, never "the archive and live agree".
 *   - `regimeDrift` is IMMUNE (windowStats nights:20 keeps the last 20 local days whatever you feed
 *     it) — asserted, because that asymmetry is why the pin can live at the source and cover both.
 *   - `sourceBuckets` NEVER leaves this module. It is an archive-only descriptive field; leaking it
 *     into anything that serialises a 6h point (suggestions.jsonl, screen.json, an item-context dump)
 *     would produce a diff that looks like data and is not.
 *   - an empty archive series → [] and the reader FALLS BACK TO LIVE. An empty ts6h is not neutral:
 *     regimeDrift returns {ok:false}, which un-gates the falling exclusion instead of failing loudly.
 *   - DEFAULT-OFF BYTE-IDENTITY: with no handle the reader returns the live call's own object,
 *     unchanged, from one call with the same id — i.e. exactly what the screen's three call sites got
 *     from `fetchTsCached(id,'6h',TS_TTL_6H)` before AF5b existed.
 */
import assert from 'node:assert/strict';
import { archive6h, sixHourReader, archiveSeries, aggregate1hTo6h, LIVE_TS6H_BUCKETS, REGIME_MIN_6H_BUCKETS } from '../lib/market/archive-series.mjs';
import { phase, regimeDrift } from '../../js/quotecore.js';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };
// the reader is async by contract, so its groups are AWAITED — a bare fn() would let a rejection escape
// as an unhandled rejection AFTER the "✓" had already printed.
const okA = async (name, fn) => { await fn(); pass++; console.log('  ✓ ' + name); };

const SIX = 21600, HOUR = 3600, DAY = 86400;
// a fake archive handle: seriesFor returns `ts`-keyed rows, exactly like the real sqlite reader.
const handleOf = rows => ({
  seriesFor(_id, _grain, { from, to }) {
    return rows.filter(r => r.ts >= from && r.ts <= to).sort((a, b) => a.ts - b.ts);
  },
});

// NOW aligned to a 6h boundary so bucket keys are exact and the fixture is clock-free.
const NOW = 1_800_000_000 - (1_800_000_000 % SIX);
/* One 1h row per hour going back `days`, priced by a function of "days ago". */
const hourly = (days, priceAt) => {
  const out = [];
  for (let h = 0; h < days * 24; h++) {
    const ts = NOW - h * HOUR, p = priceAt(h / 24);
    out.push({ ts, avgHighPrice: p + 1, avgLowPrice: p - 1, highPriceVolume: 10, lowPriceVolume: 10 });
  }
  return out;
};

console.log('archive-6h-pin:');

ok('LIVE_TS6H_BUCKETS is the /timeseries 6h cap (365 points ≈ 91d)', () => {
  assert.equal(LIVE_TS6H_BUCKETS, 365);   // verified against a live fetch 2026-08-07: 365 pts, 91.0d span
});

ok('a DEEPER-than-live archive is pinned to the newest 365×6h buckets', () => {
  const h = handleOf(hourly(250, () => 1000));                       // 250d of history — well past live's 91d
  const out = archive6h(h, 1, { now: NOW });
  assert.equal(out.length, LIVE_TS6H_BUCKETS, 'exactly the live cap, never the archive depth');
  assert.equal(out[out.length - 1].timestamp, NOW, 'pinned to the NEWEST end');
  assert.equal(out[0].timestamp, NOW - (LIVE_TS6H_BUCKETS - 1) * SIX, 'and spans exactly 364 intervals back');
});

ok('THE PIN IS A CEILING, NOT A FLOOR — a shallow archive stays shallow, and phase() knows it', () => {
  // Measured on build day (2026-08-07): the archive held 285 of 365 buckets (71.0d vs live's 91.0d), and
  // that gap is NOT closable by the pin — it can trim depth, never add it. So while the archive is short,
  // phase() is not live-equivalent, which is why the caller must report the achieved bucket count.
  const priceAt = d => (d <= 2 ? 1200 : d <= 45 ? 1000 : 3000);
  const deep = archive6h(handleOf(hourly(250, priceAt)), 1, { now: NOW });    // ≥ live depth → pinned to 365
  const shallow = archive6h(handleOf(hourly(70, priceAt)), 1, { now: NOW });  // < live depth → stays short
  assert.equal(deep.length, LIVE_TS6H_BUCKETS);
  assert.ok(shallow.length < LIVE_TS6H_BUCKETS, 'no padding, no throw — just fewer buckets');
  assert.equal(shallow[shallow.length - 1].timestamp, NOW, 'still anchored to the newest end');
  // and the consequence, stated as an assertion rather than a comment: the shortfall moves phase().
  assert.notEqual(phase(deep).baseMid, phase(shallow).baseMid,
    'a short archive changes phase()\'s baseMid — AF6 must not promote the phase() read until the archive passes 91.25d');
});

ok('THE BLOCKER: an UNPINNED deep read flips phase(); the pin prevents it', () => {
  // A future-archive shape: flat 1000 for the last ~95 days, a much higher 3000 plateau before that,
  // and the last 2 days elevated to 1200. Live (91d) can only ever see the 1000/1200 part.
  const priceAt = d => (d <= 2 ? 1200 : d <= 95 ? 1000 : 3000);
  const h = handleOf(hourly(250, priceAt));

  const pinned = archive6h(h, 1, { now: NOW });
  // the naive read the pin exists to forbid: everything the archive holds, aggregated
  const unpinned = aggregate1hTo6h(archiveSeries(h, 1, '1h', { from: -Infinity, to: NOW }));

  assert.equal(phase(pinned).phase, 'spike', 'pinned = live depth ⇒ elevated over a 1000 base, recent peak');
  assert.equal(phase(unpinned).phase, 'base', 'unpinned drags in an OLD 3000 plateau ⇒ base median 3000, peak not recent');
  assert.notEqual(phase(pinned).phase, phase(unpinned).phase, 'the depth artifact §8 measured at 4/165, reproduced');
  // and the mechanism, named: both of phase()'s depth-dependent inputs move.
  assert.equal(phase(pinned).baseMid, 1000);
  assert.equal(phase(unpinned).baseMid, 3000);
  assert.equal(phase(pinned).peakMid, 1200);
  assert.equal(phase(unpinned).peakMid, 3000);
});

ok('regimeDrift is IMMUNE to the same depth change (windowStats nights:20)', () => {
  const priceAt = d => (d <= 2 ? 1200 : d <= 95 ? 1000 : 3000);
  const h = handleOf(hourly(250, priceAt));
  const pinned = archive6h(h, 1, { now: NOW });
  const unpinned = aggregate1hTo6h(archiveSeries(h, 1, '1h', { from: -Infinity, to: NOW }));
  const a = regimeDrift(pinned), b = regimeDrift(unpinned);
  assert.equal(a.ok, b.ok);
  assert.equal(a.classification, b.classification, 'same 6-way label — depth cannot reach it');
  assert.equal(a.driftPct, b.driftPct);
});

ok('emits the FIVE wire keys only — sourceBuckets never escapes', () => {
  const out = archive6h(handleOf(hourly(3, () => 1000)), 1, { now: NOW });
  assert.ok(out.length > 0);
  for (const r of out) {
    assert.deepEqual(Object.keys(r).sort(),
      ['avgHighPrice', 'avgLowPrice', 'highPriceVolume', 'lowPriceVolume', 'timestamp']);
    assert.ok(!('sourceBuckets' in r), 'sourceBuckets is archive-only description — it must not reach a serialiser');
    assert.ok(!('ts' in r), 'consumers key on `timestamp` (the AF4 rename)');
  }
});

ok('volume-weighting survives the pin (6h volumes are SUMS of the 1h sides)', () => {
  const out = archive6h(handleOf(hourly(3, () => 1000)), 1, { now: NOW });
  const full = out.find(r => r.timestamp === NOW - SIX);   // a complete 6-hour window
  assert.equal(full.highPriceVolume, 60);                  // 6 × 10 — a SUM, not the wiki's own 6h count
  assert.equal(full.avgHighPrice, 1001);
});

ok('unknown item / cold archive → [] (never a fake "no trades")', () => {
  assert.deepEqual(archive6h(handleOf([]), 1, { now: NOW }), []);
  assert.deepEqual(archive6h(null, 1, { now: NOW }), []);
});

await okA('reader with NO handle is a pure pass-through — the default-off byte-identity guard', async () => {
  const live = [{ timestamp: 1, avgHighPrice: 10, avgLowPrice: 9, highPriceVolume: 1, lowPriceVolume: 1 }];
  const seen = [];
  const read6h = sixHourReader({ live: id => { seen.push(id); return Promise.resolve(live); } });
  const out = await read6h(4151);
  assert.equal(out, live, 'the SAME object the live fetch returned — not a copy, not a remap');
  assert.deepEqual(seen, [4151], 'called exactly once, with the same id');
});

await okA('reader with a handle but no archive rows FALLS BACK to live, and says so', async () => {
  const live = [{ timestamp: 1, avgHighPrice: 10, avgLowPrice: 9 }];
  const src = [];
  const read6h = sixHourReader({ handle: handleOf([]), live: async () => live, onSource: s => src.push(s) });
  const out = await read6h(1);
  assert.equal(out, live);
  assert.deepEqual(src, ['fallback'], 'the split must be reportable — silent fallback would overstate coverage');
});

await okA('reader with a handle and rows serves the ARCHIVE and reports the ACHIEVED depth', async () => {
  let liveCalls = 0;
  const src = [];
  const read6h = sixHourReader({
    handle: handleOf(hourly(30, () => 1000)), now: NOW,
    live: async () => { liveCalls++; return []; }, onSource: (s, id, n) => src.push([s, id, n]),
  });
  const out = await read6h(7);
  assert.equal(liveCalls, 0);
  assert.deepEqual(src, [['archive', 7, out.length]],
    'the bucket count rides with the hook — a caller that cannot see depth cannot warn that phase() is short');
  assert.ok(out.length < LIVE_TS6H_BUCKETS, 'this fixture IS short — exactly the condition to surface');
});

/* THE DEPTH FLOOR (2026-08-08 adversarial review, D3). Guarding only `rows.length === 0` reproduced the
   exact fail-open the empty-case fallback exists to prevent: a SHORT non-empty series makes regimeDrift
   return {ok:false} → label `unknown` → the falling exclusion un-gates, silently. Measured floor on the
   real archive was 19 buckets; 4.9% of items sat under 20. These two groups pin the boundary and, more
   importantly, pin the REASON — the second one asserts that the rejected series really would have
   broken regimeDrift, so the threshold can never drift away from what it protects. */
await okA('a TOO-SHORT archive series is served LIVE and reported as `shallow`, not as archive data', async () => {
  const live = [{ timestamp: 1, avgHighPrice: 10, avgLowPrice: 9 }];
  const src = [];
  // 4 days hourly → 17 six-hour buckets (96h spans 17 partial+full buckets), under the (5+1)×4 = 24 floor.
  const read6h = sixHourReader({
    handle: handleOf(hourly(4, () => 1000)), now: NOW,
    live: async () => live, onSource: (s, id, n) => src.push([s, id, n]),
  });
  assert.equal(await read6h(3), live, 'a series too short for regimeDrift must not be served as archive data');
  assert.deepEqual(src, [['shallow', 3, 17]],
    '`shallow` is distinct from `fallback` — the banner must be able to say WHY it went live, and with what depth');
});

await okA('the floor is CONSERVATIVE BY COUNT: a two-sided series it admits drives the gate, and a genuinely short one really does break it', async () => {
  // The safety property is one-directional, and deliberately so. `windowStats` buckets by LOCAL day, so
  // bucket count maps to usable days only loosely (a 17-bucket fixture can still span 5 local days and
  // satisfy regimeDrift). The floor therefore sits AT OR ABOVE the true minimum — it may serve live for a
  // series regimeDrift could have handled, which costs one fetch; the reverse would cost a silent
  // un-gating of the falling exclusion. Do not "tighten" this to the exact breaking point.
  //
  // SCOPE (corrected 2026-08-08): this pins the COUNT property on a TWO-SIDED fixture. It is NOT true
  // that everything the floor admits drives the gate — a one-sided series (highs but no lows) clears the
  // bucket count and still returns {ok:false}, pinned by the sibling assertion below. See the
  // REGIME_MIN_6H_BUCKETS block in archive-series.mjs for why that is stated rather than guarded.
  const enough = archive6h(handleOf(hourly(9, () => 1000)), 1, { now: NOW });
  assert.ok(enough.length >= REGIME_MIN_6H_BUCKETS, 'fixture precondition: this one is admitted');
  assert.equal(regimeDrift(enough).ok, true,
    'ADMITTED (two-sided) ⇒ the gate runs. If this ever fails the floor is too LOW by count.');

  const tooShort = archive6h(handleOf(hourly(2, () => 1000)), 1, { now: NOW });
  assert.ok(tooShort.length < REGIME_MIN_6H_BUCKETS, 'and this one is rejected');
  assert.equal(regimeDrift(tooShort).ok, false,
    'the failure mode being prevented is real: too few days ⇒ {ok:false} ⇒ label `unknown` ⇒ falling exclusion un-gates');
});

await okA('the floor does NOT close the fail-open for a ONE-SIDED book — deep by count, still `unknown`', async () => {
  // Pins the honest scope of REGIME_MIN_6H_BUCKETS. floorCeilingTrack projects each SIDE separately and
  // each needs FC_MIN_DAYS(5) non-null points, so an instabuy-only book (no lows) clears the bucket count
  // and still breaks the gate. Deliberately NOT guarded: live for the same item is equally one-sided, so
  // falling back would spend a fetch and return `unknown` anyway. If this ever starts passing as ok:true,
  // the wording in archive-series.mjs and the banner can be strengthened — until then they must not be.
  const oneSided = hourly(9, () => 1000).map(r => ({ ...r, avgLowPrice: null, lowPriceVolume: 0 }));
  const rows = archive6h(handleOf(oneSided), 1, { now: NOW });
  assert.ok(rows.length >= REGIME_MIN_6H_BUCKETS,
    `precondition: admitted by count (${rows.length} >= ${REGIME_MIN_6H_BUCKETS})`);

  const src = [];
  const read6h = sixHourReader({
    handle: handleOf(oneSided), now: NOW,
    live: async () => 'LIVE', onSource: (s, id, n) => src.push([s, id, n]),
  });
  assert.notEqual(await read6h(1), 'LIVE', 'it is served as archive data, not fallen back');
  assert.equal(src[0][0], 'archive', 'and reported as a SUCCESS — which is exactly the overclaim risk');
  assert.equal(regimeDrift(rows).ok, false,
    'yet the gate does NOT run: count depth is not side coverage');
});

await okA('a throwing archive handle degrades to the live fetch rather than killing the scan', async () => {
  const live = [{ timestamp: 1 }];
  const bad = { seriesFor() { throw new Error('database is locked'); } };
  const read6h = sixHourReader({ handle: bad, live: async () => live });
  assert.equal(await read6h(1), live);
});

console.log(`  ${pass} assertion group(s) passed`);
