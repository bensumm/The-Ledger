#!/usr/bin/env node
/**
 * joindepth.test.mjs — the PURE depth-outcome scoring core (join-depth-outcomes.mjs).
 * Synthetic 1h series only — no archive, no live data (rule 4).
 *
 * ── WHY THE LOOK-AHEAD TESTS LOOK OVER-ENGINEERED ──────────────────────────────────────────────
 * The v1 of this file had a test named "NO LOOK-AHEAD" that was VACUOUS: an adversarial review
 * rebuilt the source with the truncation parameterised and proved the assertion PASSED with the
 * `ts < sellTs` filter deleted ENTIRELY. Two things masked it: the synthetic spike landed on the
 * sell's own local day, which `windowBuckets`' today-skip drops regardless, and `targetFrac = 0.75`
 * absorbs contamination under ~11 of 14 days. The `now:` pin was not tested at all, yet dropping it
 * changes the prediction on 42% of real lots.
 *
 * So both guards are now tested through their OBSERVABLE CONSEQUENCE, with contamination placed
 * where the today-skip cannot hide it (whole days AFTER the sell, enough of them to swing the
 * window). If you touch these, re-verify by deliberately breaking the source and WATCHING THEM
 * FAIL — a look-ahead test you have not seen fail is not evidence (rule 10's corollary).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  scoreDepthLot, bucketBy, clusterBootstrapCI, sellEpisodes, readClosedLots,
  SIZE_BUCKETS, TREND_BUCKETS,
} from '../commands/join-depth-outcomes.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

// Build `days` of 24 hourly buckets ending just before `endTs`.
const series = (endTs, days, { hi = 1000, low = 980, vol = 100, volHi = null } = {}) => {
  const out = [];
  for (let h = days * 24; h >= 1; h--) {
    out.push({ timestamp: endTs - h * 3600, avgLowPrice: low, avgHighPrice: hi, lowPriceVolume: vol, highPriceVolume: volHi ?? vol });
  }
  return out;
};
// A local midnight, so day boundaries in the test line up with windowBuckets' local-day keys.
const midnightAfter = ts => { const d = new Date(ts * 1000); d.setHours(24, 0, 0, 0); return Math.floor(d.getTime() / 1000); };
const T = midnightAfter(1_700_000_000);

console.log('join-depth-outcomes.mjs scoring core:');

ok('declines a lot with no qty / no sell price / no sell ts', () => {
  const s = series(T, 20);
  assert.equal(scoreDepthLot(s, { qty: 0, sellEach: 1000, sellTs: T }).reason, 'no-qty');
  assert.equal(scoreDepthLot(s, { qty: 10, sellEach: 0, sellTs: T }).reason, 'no-sell-price');
  assert.equal(scoreDepthLot(s, { qty: 10, sellEach: 1000, sellTs: null }).reason, 'no-sell-ts');
});

ok('declines on a short / empty / absent series rather than throwing', () => {
  assert.equal(scoreDepthLot(series(T, 2), { qty: 10, sellEach: 1000, sellTs: T }).reason, 'archive-too-short');
  assert.equal(scoreDepthLot([], { qty: 10, sellEach: 1000, sellTs: T }).reason, 'no-archive-before-sell');
  assert.equal(scoreDepthLot(null, { qty: 10, sellEach: 1000, sellTs: T }).reason, 'no-archive-before-sell');
  assert.equal(scoreDepthLot(series(T, 20), null).resolved, false);
});

ok('NO LOOK-AHEAD (truncation): whole spiked days AFTER the sell must not reach the prediction', () => {
  // 20 clean days ending at the sell, then 20 SPIKED days after it. If `ts < sellTs` were removed,
  // windowBuckets takes the LATEST `nights` days present — i.e. the spiked ones — and the prediction
  // moves hard. Placing the spike on later whole days is what makes this non-vacuous: the today-skip
  // cannot drop them and 20 contaminated days is far past the 0.75 day-threshold.
  const before = series(T, 20, { hi: 1000, low: 980 });
  const after = [];
  for (let h = 1; h <= 20 * 24; h++) {
    after.push({ timestamp: T + h * 3600, avgLowPrice: 9000, avgHighPrice: 9500, lowPriceVolume: 5000, highPriceVolume: 5000 });
  }
  const lot = { qty: 10, sellEach: 1000, sellTs: T };
  const clean = scoreDepthLot(before, lot);
  const contaminated = scoreDepthLot(before.concat(after), lot);
  assert.equal(clean.resolved, true, 'baseline must resolve');
  assert.equal(contaminated.resolved, true);
  assert.equal(contaminated.predictedAsk, clean.predictedAsk, 'post-sell days must not move predictedAsk');
  assert.equal(contaminated.volDay, clean.volDay, 'post-sell days must not move volDay');
  assert.equal(contaminated.nullAsk, clean.nullAsk, 'post-sell days must not move the null model');
  // Guard the guard: prove the contamination WOULD have been visible, so this test can never pass
  // vacuously the way v1's did. Scoring a sell placed AFTER the spike must see a different world.
  const later = scoreDepthLot(before.concat(after), { qty: 10, sellEach: 1000, sellTs: T + 20 * 24 * 3600 });
  assert.equal(later.resolved, true);
  assert.notEqual(later.predictedAsk, clean.predictedAsk, 'the spiked days must be capable of moving the prediction');
});

ok('NO LOOK-AHEAD (`now` pin): the sell\'s OWN PARTIAL DAY must be excluded from the window', () => {
  // This is where the `now:` pin actually bites, and the first version of this test missed it: with
  // the `ts < sellTs` truncation already in place the series ENDS at the sell, so the last N days
  // present are the N days before it whether or not `now` is pinned. `now` only decides whether the
  // sell's OWN partial day is dropped by windowBuckets' today-skip. Mutation-proved: without a
  // partial day in the fixture, deleting the pin passed. (On the real book it moves 42% of lots.)
  //
  // So: 20 complete days at 1,000, then 6 hours of the sell's own day at 5,000, then the sell.
  // Pinned  ⇒ those 6 hours are "today", skipped, prediction stays near 1,000.
  // Unpinned ⇒ `now` is the real clock, the sell's day is not today, and the 5,000 hours enter the
  //            window as a day — moving the prediction.
  const complete = series(T, 20, { hi: 1000, low: 980 });
  const partial = [];
  for (let h = 0; h < 6; h++) {
    partial.push({ timestamp: T + h * 3600, avgLowPrice: 4900, avgHighPrice: 5000, lowPriceVolume: 100, highPriceVolume: 100 });
  }
  const sellTs = T + 7 * 3600;   // mid-day, after the partial day's prints
  const r = scoreDepthLot(complete.concat(partial), { qty: 10, sellEach: 1000, sellTs });
  assert.equal(r.resolved, true);
  assert.ok(r.nullAsk <= 1000, `the null model must exclude the sell's own partial day, got ${r.nullAsk}`);
  assert.ok(r.volDay <= 2500, `volDay must exclude the sell's own partial day, got ${r.volDay}`);
  assert.ok(Math.abs(r.drift) < 0.01, `drift must not read the sell's own partial day, got ${r.drift}`);
});

// HONESTY ABOUT WHAT IS *NOT* COVERED (rule 4, and the reason v1's test was worthless):
// the `now:` pin handed to `clearableAsk` has NO unit test, because its effect is not observable in a
// fixture of reasonable size. `clearableLevel`'s `targetFrac = 0.75` means a level must be cleared on
// ~11 of 14 days, so ONE contaminated partial day cannot move `predictedAsk` no matter what price it
// carries — mutation-checked: deleting the pin leaves the prediction bit-identical on every fixture
// tried here. Its effect IS real on live data (an adversarial review measured the prediction moving on
// 163 of 392 lots, 42%, when the pin is dropped), which is precisely the shape of guard a unit test
// cannot reach. DO NOT remove the pin on the strength of "no test covers it"; the assertions above
// cover the complete-day boundary THIS module owns (volDay / nullAsk / drift), which is the part that
// is genuinely testable. Verify the pin by running the CLI with and without it against the real
// archive and diffing predictedAsk.

ok('volDay uses the LIMITING side min(hi,lo), not both sides summed (the 2.24× v1 error)', () => {
  // Asymmetric book: 40 units/h on the low side, 200 on the high side. The limiting side is 40/h
  // ⇒ ~960/day. Summing both sides would give ~5,760/day — a 6× different size bucket.
  const s = series(T, 20, { vol: 40, volHi: 200 });
  const r = scoreDepthLot(s, { qty: 10, sellEach: 1000, sellTs: T });
  assert.equal(r.resolved, true);
  assert.ok(Math.abs(r.volDay - 960) < 60, `volDay should track the limiting side (~960), got ${r.volDay}`);
  assert.ok(Math.abs(r.sizeFrac - 10 / 960) < 0.002, `sizeFrac should be qty ÷ limiting-side volDay, got ${r.sizeFrac}`);
});

ok('drift is measured across the model window and signs correctly', () => {
  const rising = [];
  for (let d = 20; d >= 1; d--) {
    for (let h = 0; h < 24; h++) {
      const p = 1000 + (20 - d) * 25;
      rising.push({ timestamp: T - d * 86400 + h * 3600, avgLowPrice: p - 20, avgHighPrice: p, lowPriceVolume: 100, highPriceVolume: 100 });
    }
  }
  const r = scoreDepthLot(rising, { qty: 10, sellEach: 1500, sellTs: T });
  assert.equal(r.resolved, true);
  assert.ok(r.drift > 0.05, `a steadily rising window must read positive drift, got ${r.drift}`);
  const flat = scoreDepthLot(series(T, 20), { qty: 10, sellEach: 1000, sellTs: T });
  assert.ok(Math.abs(flat.drift) < 0.01, `a flat window must read ~0 drift, got ${flat.drift}`);
});

ok('sellEpisodes merges FIFO fragments into one same-hour episode, quantity-weighting the price', () => {
  const lots = [
    { itemId: 7, qty: 10, sellEach: 100, sellTs: T + 60 },
    { itemId: 7, qty: 30, sellEach: 200, sellTs: T + 120 },     // same item, same hour ⇒ merge
    { itemId: 7, qty: 5, sellEach: 999, sellTs: T + 4000 },     // next hour ⇒ separate
    { itemId: 8, qty: 5, sellEach: 50, sellTs: T + 60 },        // different item ⇒ separate
  ];
  const eps = sellEpisodes(lots);
  assert.equal(eps.length, 3);
  const merged = eps.find(e => e.itemId === 7 && e.nRows === 2);
  assert.equal(merged.qty, 40, 'qty must SUM — a 40-unit sell is not four 10-unit sells');
  assert.equal(merged.sellEach, (10 * 100 + 30 * 200) / 40, 'price must be QUANTITY-weighted, not a plain mean');
  assert.equal(merged.sellTs, T + 120, 'the episode ends at its last fragment');
});

ok('sellEpisodes skips unusable rows without throwing', () => {
  assert.deepEqual(sellEpisodes([{ itemId: 1, qty: 0, sellEach: 5, sellTs: T }]), []);
  assert.deepEqual(sellEpisodes([{ itemId: 1, qty: 5, sellEach: 0, sellTs: T }]), []);
  assert.deepEqual(sellEpisodes([{ itemId: 1, qty: 5, sellEach: 5, sellTs: null }]), []);
  assert.deepEqual(sellEpisodes(null), []);
});

ok('bucketBy partitions on the named field and takes a MEDIAN, not a mean', () => {
  const mk = (sizeFrac, residualPct) => ({ resolved: true, sizeFrac, residualPct, residual: residualPct });
  const by = Object.fromEntries(bucketBy([mk(0.001, 0.01), mk(0.002, 0.02), mk(0.003, 100), mk(0.007, -0.05)], SIZE_BUCKETS, 'sizeFrac').map(x => [x.key, x]));
  assert.equal(by['<0.5%'].n, 3);
  assert.equal(by['<0.5%'].medianPct, 0.02, 'median must ignore the 100 outlier');
  assert.equal(by['0.5–1%'].underFrac, 1);
  assert.equal(by['2–5%'].n, 0);
  assert.equal(by['2–5%'].medianPct, null, 'an empty bucket reports null, never 0');
});

ok('bucketBy works over TREND_BUCKETS on the drift field too', () => {
  const mk = (drift, residualPct) => ({ resolved: true, drift, residualPct, residual: residualPct });
  const by = Object.fromEntries(bucketBy([mk(-0.10, -0.01), mk(0.0, 0.005), mk(0.08, 0.04)], TREND_BUCKETS, 'drift').map(x => [x.key, x]));
  assert.equal(by.falling.n, 1);
  assert.equal(by.flat.n, 1);
  assert.equal(by.rising.n, 1);
});

ok('bucketBy ignores unresolved rows and rows with a null field', () => {
  const by = Object.fromEntries(bucketBy([
    { resolved: false, sizeFrac: 0.001, residualPct: 1, residual: 1 },
    { resolved: true, sizeFrac: null, residualPct: 1, residual: 1 },
    { resolved: true, sizeFrac: 0.001, residualPct: 0.5, residual: 0.5 },
  ], SIZE_BUCKETS, 'sizeFrac').map(x => [x.key, x]));
  assert.equal(by['<0.5%'].n, 1);
  assert.equal(by['<0.5%'].medianPct, 0.5);
});

ok('bucket boundaries are half-open [lo,hi) — contiguous, and a boundary value lands in exactly one', () => {
  for (const set of [SIZE_BUCKETS, TREND_BUCKETS]) {
    for (let i = 1; i < set.length; i++) assert.equal(set[i].lo, set[i - 1].hi, 'buckets must be contiguous');
  }
  const on = bucketBy([{ resolved: true, sizeFrac: 0.005, residualPct: 0.1, residual: 0.1 }], SIZE_BUCKETS, 'sizeFrac');
  assert.equal(on.filter(b => b.n > 0).length, 1);
  assert.equal(on.find(b => b.n > 0).key, '0.5–1%');
});

ok('clusterBootstrapCI REFUSES when the split is perfectly nested inside items', () => {
  // Item 1 is all-small, item 2 is all-big. "big vs small" and "item 1 vs item 2" are then the SAME
  // contrast: every valid resample returns the identical difference and the interval comes back with
  // width 0 — tight enough to look like proof, and meaningless. Measured on the first build, which is
  // why this refusal exists rather than a wide-interval expectation.
  const rows = [];
  for (let i = 0; i < 20; i++) rows.push({ resolved: true, itemId: 1, sizeFrac: 0.001, residualPct: 0.00, residual: 0 });
  for (let i = 0; i < 20; i++) rows.push({ resolved: true, itemId: 2, sizeFrac: 0.010, residualPct: 0.10, residual: 0.1 });
  assert.equal(clusterBootstrapCI(rows, s => s.sizeFrac >= 0.005, { iters: 500 }), null);
});

ok('clusterBootstrapCI is deterministic and stays WIDE when items genuinely span both arms', () => {
  // Two items, each selling BOTH sizes — now the contrast is identifiable within item.
  const rows = [];
  for (const [id, base] of [[1, 0.00], [2, 0.10], [3, -0.05]]) {
    for (let i = 0; i < 8; i++) rows.push({ resolved: true, itemId: id, sizeFrac: 0.001, residualPct: base, residual: base });
    for (let i = 0; i < 8; i++) rows.push({ resolved: true, itemId: id, sizeFrac: 0.010, residualPct: base + 0.02, residual: base + 0.02 });
  }
  const split = s => s.sizeFrac >= 0.005;
  const a = clusterBootstrapCI(rows, split, { iters: 500 });
  const b = clusterBootstrapCI(rows, split, { iters: 500 });
  assert.ok(a, 'a spanning design must yield an interval');
  assert.deepEqual(a, b, 'seeded ⇒ identical across runs (a report that moves each run is not evidence)');
  assert.ok(a.hi > a.lo, 'the interval must have real width');
});

ok('clusterBootstrapCI refuses rather than inventing an interval from too little', () => {
  assert.equal(clusterBootstrapCI([], s => true), null);
  assert.equal(clusterBootstrapCI([{ resolved: true, itemId: 1, sizeFrac: 0.001, residualPct: 0, residual: 0 }], s => s.sizeFrac >= 0.005), null);
  const oneItem = Array.from({ length: 10 }, () => ({ resolved: true, itemId: 9, sizeFrac: 0.001, residualPct: 0, residual: 0 }));
  assert.equal(clusterBootstrapCI(oneItem, s => s.sizeFrac >= 0.005), null);
});

ok('readClosedLots excludes withdrawn tombstones and banked rows, keeps real sells', () => {
  const tmp = new URL('./.joindepth-fixture.json', import.meta.url);
  fs.writeFileSync(tmp, JSON.stringify({ closed: [
    { itemId: 1, qty: 5, sellEach: 100, sellTs: T },
    { itemId: 2, qty: 1, sellEach: 0, sellTs: T, withdrawn: true },
    { itemId: 3, qty: 5, sellEach: 100, sellTs: T, banked: true },
    { itemId: 4, qty: 0, sellEach: 100, sellTs: T },
    { itemId: 5, qty: 5, sellEach: 100, sellTs: null },
  ] }));
  const got = readClosedLots(tmp);
  fs.unlinkSync(tmp);
  assert.equal(got.length, 1);
  assert.equal(got[0].itemId, 1);
});

ok('readClosedLots degrades to [] on a missing/corrupt positions file, never throws', () => {
  assert.deepEqual(readClosedLots('/definitely/not/a/path/positions.json'), []);
});

console.log(`\n✓ join-depth-outcomes core: ${pass} check(s) passed`);
