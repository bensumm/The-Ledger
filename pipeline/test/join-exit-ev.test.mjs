#!/usr/bin/env node
/**
 * join-exit-ev.test.mjs — acceptance for pipeline/commands/join-exit-ev.mjs (PLAN-REACH-SURFACE ch.4).
 * Offline: a deterministic synthetic 1h series. No sqlite, no fetch, no clock — `now` is derived from
 * the origin everywhere.
 *
 * BUSINESS REQUIREMENTS pinned here:
 *   - NO LOOK-AHEAD, and it is the load-bearing one. A record built at origin T from a series that
 *     continues past T must be identical to one built from the series truncated at T. The plan asks
 *     for this mutation specifically: delete the truncation and watch it fail.
 *   - THE BAIL BRANCH IS CONTENDER-INDEPENDENT. Every contender at an origin bails at the same price,
 *     so the whole ranking lives in the reached rows — `edgeFrac` is what strips the common term, and
 *     it must be exactly zero on a miss at delayCost 0.
 *   - delayCost IS CHARGED TO THE MISS BRANCH ONLY. On both branches it is a constant at fixed H and
 *     ranks nothing (chunk 2's property, re-pinned where it is now scored against realized outcomes).
 *   - THE POOL IS MATCHED BY CONSTRUCTION. An origin where any named contender declined is dropped for
 *     ALL of them; a ragged pool compares different markets and cannot rank.
 *   - THE DEPLOYABLE POLICY FALLS BACK. `askStar+fold` is the surface where it prices and reach-fold
 *     where it refuses, because bare askStar gates its own pool.
 *   - THE asym CONTENDER IS THE ORDERING-GUARDED LEVEL, max(quickSell, quantile) — what asymEstimate
 *     deploys. The raw quantile reconstructs ~2% low against the logged rows and moved asym from last
 *     place to first when corrected; this is the assertion that keeps it corrected.
 *   - THE BAIL CONVENTION IS A REAL SENSITIVITY, not a restatement: it shifts only the reached rows, so
 *     contenders that reach at different rates move apart under it.
 *   - INTERVALS RESAMPLE ITEMS, NEVER ORIGINS. An item's origins share one price path.
 *   - AN ERA SIGN FLIP INVALIDATES, whatever the pooled interval looks like.
 *   - A RETIREMENT NOMINATION IS BLOCKED BY AN UNBOUNDED RECONSTRUCTION. A contender the acceptance
 *     check could not score at all cannot retire a deployed estimator, however large its deficit —
 *     and a reference line is never nominated at all, because a ruler is not an estimator.
 *
 * MUTATION-VERIFIED — every mutant below was applied to the source and the named group observed RED.
 *   truncation-off-surface     the surface is built on the untruncated series -> no-look-ahead RED
 *   truncation-off-incumbents  the incumbents read the untruncated series     -> no-look-ahead RED
 *   asym-raw                   asks.asym is the raw quantile, unguarded       -> asym-guard RED
 *   delay-on-both              delayCost also charged on the reached branch   -> delay-cost RED
 *   edge-is-net                edgeFrac keeps the common bail term            -> edge RED
 *   matched-loose              matchedRows keeps a row missing a contender    -> matched RED
 *   fold-fallback-off          askStar+fold returns the star only             -> fallback RED
 *   bail-mode-ignored          scoreAsk always reads the avgLow bail          -> bail-mode RED
 *   cluster-rows               the bootstrap resamples ROWS, not items        -> cluster RED
 *   thin-noop                  thinIndependent returns its input unchanged    -> thinning RED
 *   era-flip-ignored           verdict drops the era-flip branch              -> verdict RED
 *   ladder-always              scoreLadder relists even on a first-window hit -> ladder RED
 *   baseline-blind             topIsBaseline hardcoded false                  -> baseline RED
 *   beats-baselines-pool-level the arm's baseline check reads the POOL flag   -> arm RED
 *   retire-ignores-unbounded   an unbounded reconstruction can be nominated   -> retirement RED
 *   retire-includes-baselines  reference lines enter the nomination table     -> retirement RED
 *   origin-bucket-readable     the cut includes the bucket AT the origin      -> no-look-ahead RED
 *
 * THREE OF THOSE ONLY EXIST BECAUSE A FIXTURE WAS TOO NARROW, which is the lesson worth keeping.
 * `asym-raw` and `baseline-blind` survived the first pass: the smooth sinusoid never bound the ordering
 * guard and no reference line ever topped its table, so the assertions ran over data that could not
 * reach the branch. And the whole `origin-bucket-readable` case was INVISIBLE to the original
 * no-look-ahead fixture, which perturbed only rows strictly PAST the origin — while the leak was the
 * bucket AT it. A green suite over a fixture that cannot reach the defect is not coverage.
 *
 * HONESTY NOTE: the synthetic series is a drifting sinusoid, not a market. Groups here assert
 * STRUCTURE (what is charged to which branch, what is dropped, what is resampled), never that any
 * contender wins — the ranking is an empirical question the command answers against the real archive.
 */
import assert from 'node:assert/strict';
import {
  CONTENDERS, CONTENDER_KEYS, ESTIMATOR_POOL_KEYS, DEPLOYABLE_POOL_KEYS, INCUMBENT_KEYS, BASELINE_KEYS,
  BAIL_MODES, LADDER_Z_STEP, DEFAULT_NIGHTS, ARM_KEYS, ACCEPTANCE_MIN_ROWS, EXECUTED_RETIREMENTS,
  liveAt, foldAskAt, incumbentAsksAt, buildOriginRecord, readableCut, askOf, scoreAsk, scoreLadder,
  matchedRows, summarize, topIsBaseline, pairedClusterCI, thinIndependent, headToHead, armVerdict, verdict, retirementTable,
  acceptanceRow, acceptanceSummary, unboundedKeys, ACCEPTANCE_FIELDS, CELL_OF, crossoverClosed,
} from '../commands/join-exit-ev.mjs';
import { tax } from '../../js/money-math.js';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };
const HOUR = 3600;
const DAY0 = 1780000000 - (1780000000 % 86400);

/* A drifting sinusoid on an hourly grid. Deterministic, no clock, no RNG: the daily highs vary enough
 * that the dispersion IQR is non-zero, which is what the surface needs to place a z axis at all. */
function synth({ days = 45, base = 10000, amp = 0.06, drift = 0.001, spread = 0.02, from = DAY0 } = {}) {
  const out = [];
  for (let h = 0; h < days * 24; h++) {
    const t = from + h * HOUR;
    const d = Math.floor(h / 24);
    const wobble = 1 + drift * d + amp * Math.sin((h / 24) * 2 * Math.PI) + 0.02 * Math.sin(h / 7.3);
    const mid = base * wobble;
    out.push({
      ts: t,
      avgHighPrice: Math.round(mid * (1 + spread / 2)),
      avgLowPrice: Math.round(mid * (1 - spread / 2)),
      highPriceVolume: 4000 + (h % 13) * 100,
      lowPriceVolume: 3800 + (h % 11) * 100,
    });
  }
  return out;
}

const ORIGIN = DAY0 + 35 * 86400;
const HS = [6, 24];
const recAt = (series, ts = ORIGIN, opts = {}) =>
  buildOriginRecord({ series, itemId: 1, ts, horizons: HS, delayCostFracs: [0, 0.01], ...opts });

const FULL = synth();
const TRUNC = FULL.filter(r => r.ts <= ORIGIN);
// The same series with a violent future: if any contender reads past the origin, these two diverge.
const SPIKED = FULL.map(r => (r.ts > ORIGIN ? { ...r, avgHighPrice: r.avgHighPrice * 5, avgLowPrice: r.avgLowPrice * 5 } : r));

console.log('join-exit-ev');

// --- no-look-ahead ---------------------------------------------------------------------------------
ok('no-look-ahead: every priced field at T is identical whether or not the series explodes after T', () => {
  const a = recAt(FULL), b = recAt(SPIKED);
  assert.ok(a && b, 'both records must build');
  assert.deepEqual(a.asks, b.asks, 'every contender ask must be blind to post-origin data');
  assert.equal(a.refHigh, b.refHigh);
  assert.equal(a.disp, b.disp);
  assert.equal(a.liqClass, b.liqClass);
  assert.equal(a.fcDir, b.fcDir);
  assert.deepEqual(a.byH[24].star, b.byH[24].star, 'askStar must not see the future either');
});

// The bucket stamped AT the origin covers the hour AFTER it — archive buckets carry a period START.
// Perturbing only that one bucket is the case the
// `ts > ORIGIN` fixture above cannot see, and it is where the real leak was.
const AT_ORIGIN = FULL.map(r => (r.ts === ORIGIN ? { ...r, avgHighPrice: r.avgHighPrice * 4, avgLowPrice: Math.round(r.avgLowPrice / 4) } : r));

ok('no-look-ahead: the bucket stamped AT the origin is future data and reaches NOTHING', () => {
  const a = recAt(FULL), b = recAt(AT_ORIGIN);
  assert.notDeepEqual(FULL.find(r => r.ts === ORIGIN), AT_ORIGIN.find(r => r.ts === ORIGIN), 'the fixture must actually differ');
  assert.deepEqual(a.asks, b.asks, 'a live pair read off the origin bucket is a one-hour leak');
  assert.equal(a.refHigh, b.refHigh);
  assert.deepEqual(a.byH[24], b.byH[24], 'and the outcome window starts AFTER it, so it moves nothing there either');
});

ok('no-look-ahead: the readable cut stops strictly before the origin', () => {
  const cut = readableCut(FULL, ORIGIN);
  assert.equal(FULL[cut].ts, ORIGIN, 'the origin bucket is the first EXCLUDED one');
  assert.ok(FULL[cut - 1].ts < ORIGIN);
  assert.equal(readableCut(FULL, FULL[0].ts), 0, 'nothing is readable at the very first bucket');
});

ok('no-look-ahead: an unaligned timestamp is FLOORED, so the bucket straddling it stays unread', () => {
  const mid = ORIGIN + 1799;                        // a wall-clock read, mid-hour, as the co-log carries
  assert.equal(readableCut(FULL, mid), readableCut(FULL, ORIGIN), 'a mid-hour read may not see its own hour');
  assert.ok(FULL[readableCut(FULL, mid)].ts >= ORIGIN);
});

ok('no-look-ahead: the OUTCOME does read forward — that is the point', () => {
  const b = recAt(SPIKED);
  assert.ok(b.byH[24].top > recAt(FULL).byH[24].top, 'the forward window must see the spike');
});

// --- the bail branch and the edge -------------------------------------------------------------------
ok('edge: a missed ask scores exactly the bail branch, and its edge is exactly zero', () => {
  const r = recAt(FULL);
  const unreachable = r.byH[24].top * 10;
  const sc = scoreAsk(r, 24, unreachable, 0);
  assert.equal(sc.reached, false);
  assert.equal(sc.edgeFrac, 0, 'no delayCost ⇒ a miss is worth exactly the bail, so the edge is 0');
  const bailNet = r.byH[24].bail - tax(r.byH[24].bail);
  assert.ok(Math.abs(sc.net - bailNet) < 1e-9);
});

ok('edge: the bail term is the SAME for two different missed asks, so it cannot rank them', () => {
  const r = recAt(FULL);
  const a = scoreAsk(r, 24, r.byH[24].top * 10, 0);
  const b = scoreAsk(r, 24, r.byH[24].top * 99, 0);
  assert.equal(a.net, b.net);
  assert.equal(a.edgeFrac, b.edgeFrac);
});

ok('edge: a reached ask scores net(ask) and its edge is net(ask) − net(bail)', () => {
  const r = recAt(FULL);
  const ask = r.byH[24].bail;                       // certainly at or below the window top
  const sc = scoreAsk(r, 24, ask, 0);
  assert.equal(sc.reached, true);
  const expect = ((ask - tax(ask)) - (r.byH[24].bail - tax(r.byH[24].bail))) / r.refHigh;
  assert.ok(Math.abs(sc.edgeFrac - expect) < 1e-9);
});

// --- delayCost --------------------------------------------------------------------------------------
ok('delay-cost: charged to the MISS branch only — a reached row is untouched by it', () => {
  const r = recAt(FULL);
  const ask = r.byH[24].bail;
  const at0 = scoreAsk(r, 24, ask, 0), at5 = scoreAsk(r, 24, ask, 0.05);
  assert.equal(at0.reached, true);
  assert.equal(at0.net, at5.net, 'the reached payoff cannot move with the cost of waiting');
  assert.ok(at5.edgeFrac > at0.edgeFrac, 'but the edge over a now-costlier miss must grow');
});

ok('delay-cost: a missed row pays it, once', () => {
  const r = recAt(FULL);
  const miss = r.byH[24].top * 10;
  const a = scoreAsk(r, 24, miss, 0), b = scoreAsk(r, 24, miss, 0.01);
  assert.ok(Math.abs((a.net - b.net) - 0.01 * r.refHigh) < 1e-6);
});

// --- the matched pool -------------------------------------------------------------------------------
ok('matched: an origin where one contender declined is dropped for ALL of them', () => {
  const r = recAt(FULL);
  const crippled = { ...r, asks: { ...r.asks, pressure: null } };
  assert.equal(matchedRows([crippled], 24, ['pressure', 'asym'], 0).length, 0);
  assert.equal(matchedRows([r], 24, ['pressure', 'asym'], 0).length, 1);
});

ok('matched: every returned row carries every requested key', () => {
  const rows = matchedRows([recAt(FULL)], 24, ESTIMATOR_POOL_KEYS, 0);
  for (const row of rows) for (const k of ESTIMATOR_POOL_KEYS) {
    assert.ok(row.per[k] && row.per[k].ask > 0, k + ' must be priced on a matched row');
  }
});

// --- the deployable fallback -------------------------------------------------------------------------
ok('fallback: askStar+fold is the star where it prices', () => {
  const r = recAt(FULL);
  if (r.byH[24].star[0] == null) return;            // nothing to assert on a refusing fixture
  assert.equal(askOf(r, 24, 'askStar+fold', 0), r.byH[24].star[0]);
});

ok('fallback: askStar+fold is reach-fold where the star refused, and bare askStar is null there', () => {
  const r = recAt(FULL);
  const refusing = { ...r, byH: { ...r.byH, 24: { ...r.byH[24], star: { 0: null, 0.01: null } } } };
  assert.equal(askOf(refusing, 24, 'askStar', 0), null);
  assert.equal(askOf(refusing, 24, 'askStar+fold', 0), r.asks.reachFold);
});

ok('fallback: the deployable pool is never smaller than the estimator pool', () => {
  const recs = [recAt(FULL), recAt(FULL, ORIGIN + 12 * HOUR)].filter(Boolean);
  const e = matchedRows(recs, 24, ESTIMATOR_POOL_KEYS, 0).length;
  const d = matchedRows(recs, 24, DEPLOYABLE_POOL_KEYS, 0).length;
  assert.ok(d >= e, `deployable ${d} must cover estimator ${e}`);
});

// --- the asym ordering guard -------------------------------------------------------------------------
// A series whose last day gapped UP: the live instabuy now sits above the 14-day ask quantile, so
// asymEstimate's ordering guard MUST bind. Without a fixture where it binds, the raw quantile and the
// guarded level are the same number and the assertion proves nothing.
const GAPPED = FULL.map(r => (r.ts > ORIGIN - 20 * HOUR && r.ts <= ORIGIN
  ? { ...r, avgHighPrice: r.avgHighPrice * 3, avgLowPrice: r.avgLowPrice * 3 } : r));

ok('asym-guard: the contender is the DEPLOYED guarded level, never below the live instabuy', () => {
  const cut = GAPPED.findIndex(r => r.ts > ORIGIN);
  const { asks, live, rawAsym, guardBound } = incumbentAsksAt({ series: GAPPED, cut, nights: DEFAULT_NIGHTS, now: new Date(ORIGIN * 1000) });
  assert.equal(guardBound, true, 'the fixture must actually bind the guard or this proves nothing');
  assert.ok(rawAsym < live.quickSell, 'the raw quantile must sit BELOW the gapped instabuy');
  assert.equal(asks.asym, live.quickSell, 'asymEstimate clamps the ask up to quickSell; so must this');
  assert.equal(asks.asym, Math.max(live.quickSell, rawAsym));
});

ok('asym-guard: where the guard binds the contender IS quickSell*, and the record says so', () => {
  const r = recAt(GAPPED);
  assert.equal(r.asymGuardBound, true);
  assert.equal(r.asks.asym, r.asks['quickSell*']);
  const unbound = recAt(FULL);
  assert.equal(unbound.asymGuardBound, unbound.asks.asym === unbound.asks['quickSell*']);
});

// --- the bail convention ------------------------------------------------------------------------------
ok('bail-mode: the two conventions are both offered and they differ on this fixture', () => {
  assert.deepEqual(BAIL_MODES, ['low', 'high']);
  const r = recAt(FULL);
  assert.notEqual(r.byH[24].bail, r.byH[24].bailHigh, 'a spread means the two bails are different prices');
  const ask = r.byH[24].bail;
  const lo = scoreAsk(r, 24, ask, 0, 'low'), hi = scoreAsk(r, 24, ask, 0, 'high');
  assert.notEqual(lo.edgeFrac, hi.edgeFrac, 'the bail choice moves the edge of a REACHED row');
});

ok('bail-mode: it leaves a MISSED row scoring its own bail, so the shift is confined to reached rows', () => {
  const r = recAt(FULL);
  const miss = r.byH[24].top * 10;
  assert.equal(scoreAsk(r, 24, miss, 0, 'low').edgeFrac, 0);
  assert.equal(scoreAsk(r, 24, miss, 0, 'high').edgeFrac, 0);
});

// --- clustering ----------------------------------------------------------------------------------------
const spread = (n, itemsEach = 1) => {
  const recs = [];
  for (let i = 0; i < n; i++) {
    const r = recAt(FULL, ORIGIN + i * 6 * HOUR);
    if (r) recs.push({ ...r, itemId: itemsEach === 1 ? i : Math.floor(i / itemsEach) });
  }
  return recs;
};

ok('cluster: an interval needs at least four ITEMS, however many origins there are', () => {
  const many = spread(12).map(r => ({ ...r, itemId: 7 }));
  const rows = matchedRows(many, 24, ['pressure', 'asym'], 0);
  assert.ok(rows.length >= 4, 'the fixture must supply origins for this to be a real test');
  assert.equal(pairedClusterCI(rows, 'pressure', 'asym'), null, 'one item is one cluster');
});

ok('cluster: with enough items it returns a seeded, reproducible interval bracketing its point', () => {
  const rows = matchedRows(spread(12), 24, ['pressure', 'asym'], 0);
  const a = pairedClusterCI(rows, 'pressure', 'asym');
  const b = pairedClusterCI(rows, 'pressure', 'asym');
  assert.ok(a, 'twelve items must yield an interval');
  assert.deepEqual(a, b, 'the seed must make this deterministic');
  assert.ok(a.lo <= a.point && a.point <= a.hi);
  assert.equal(a.items, 12);
});

// --- thinning ---------------------------------------------------------------------------------------
ok('thinning: overlapping origins of one item collapse to non-overlapping windows', () => {
  const recs = spread(8).map(r => ({ ...r, itemId: 1 }));      // 6h apart
  const kept = thinIndependent(recs, 24);
  assert.ok(kept.length < recs.length, 'a 6h stride at H=24 must drop origins');
  for (let i = 1; i < kept.length; i++) {
    assert.ok(kept[i].ts - kept[i - 1].ts >= 24 * HOUR, 'kept windows must not overlap');
  }
});

ok('thinning: it is per ITEM — two items at the same instants both survive', () => {
  const recs = [...spread(4).map(r => ({ ...r, itemId: 1 })), ...spread(4).map(r => ({ ...r, itemId: 2 }))];
  const kept = thinIndependent(recs, 24);
  assert.equal(new Set(kept.map(r => r.itemId)).size, 2);
});

// --- the ladder -------------------------------------------------------------------------------------
ok('ladder: a first-window hit is NOT relisted — it already sold', () => {
  const r = recAt(FULL);
  const ask = r.byH[24].bail;
  const single = scoreAsk(r, 24, ask, 0);
  const lad = scoreLadder(r, 24, ask, 0);
  assert.ok(lad, 'the fixture must resolve a second window');
  assert.equal(lad.net, single.net, 'a reached ask cannot be repriced afterwards');
});

ok('ladder: a miss relists exactly LADDER_Z_STEP dispersions lower', () => {
  const r = recAt(FULL);
  const miss = r.byH[24].top * 10;
  const lad = scoreLadder(r, 24, miss, 0);
  assert.ok(Math.abs(lad.relist - (miss - LADDER_Z_STEP * r.disp)) < 1e-9);
});

ok('ladder: it refuses rather than inventing a second window the archive does not cover', () => {
  const r = recAt(FULL);
  const noSecond = { ...r, byH: { ...r.byH, 24: { ...r.byH[24], top2: null, bail2: null } } };
  assert.equal(scoreLadder(noSecond, 24, r.asks.reachFold, 0), null);
});

// --- summaries and baselines -------------------------------------------------------------------------
ok('summary: contenders come back ordered by mean edge, best first', () => {
  const h = headToHead(spread(12), 24, 0, ESTIMATOR_POOL_KEYS);
  for (let i = 1; i < h.stats.length; i++) assert.ok(h.stats[i - 1].meanEdge >= h.stats[i].meanEdge);
});

ok('baseline: `best` names the best ESTIMATOR while `topOverall` can name a reference line', () => {
  const h = headToHead(spread(12), 24, 0, ESTIMATOR_POOL_KEYS);
  assert.ok(!BASELINE_KEYS.includes(h.best), 'best must never be a reference line');
  assert.equal(h.baselineWins, BASELINE_KEYS.includes(h.topOverall));
  if (h.baselineWins) assert.notEqual(h.best, h.topOverall);
});

ok('baseline: a reference line topping the table is DETECTED — the finding this report exists to state', () => {
  assert.equal(topIsBaseline([{ key: 'refHigh*' }, { key: 'asym' }]), true);
  assert.equal(topIsBaseline([{ key: 'quickSell*' }, { key: 'askStar' }]), true);
  assert.equal(topIsBaseline([{ key: 'asym' }, { key: 'refHigh*' }]), false);
  assert.equal(topIsBaseline([]), false);
  assert.equal(topIsBaseline(null), false);
});

ok('registry: the two pools partition the surface keys and neither drops an incumbent', () => {
  assert.ok(!ESTIMATOR_POOL_KEYS.includes('askStar+fold'));
  assert.ok(!DEPLOYABLE_POOL_KEYS.includes('askStar'));
  for (const k of INCUMBENT_KEYS) {
    assert.ok(ESTIMATOR_POOL_KEYS.includes(k) && DEPLOYABLE_POOL_KEYS.includes(k), k);
    assert.ok(!BASELINE_KEYS.includes(k), k + ' is a contender, not a reference line');
  }
  assert.equal(CONTENDER_KEYS.length, CONTENDERS.length);
});

// --- the verdict ---------------------------------------------------------------------------------------
const armStub = over => ({ key: 'x', bestIncumbent: 'asym', ci: { point: 1, lo: 0.5, hi: 1.5, items: 9 },
  clearOfZero: true, sign: 1, agreeing: 3, eraSigns: [1, 1], eraFlip: false, beatsBaselines: true, beats: true, ...over });

ok('verdict: both arms must clear before a default swap is licensed', () => {
  assert.ok(verdict(armStub(), armStub()).beats);
  assert.equal(verdict(armStub(), armStub({ beats: false })).beats, false);
  assert.equal(verdict(armStub({ beats: false }), armStub()).beats, false);
  assert.match(verdict(armStub(), armStub({ beats: false })).branch, /NULL BRANCH/);
});

ok('verdict: an era sign flip on EITHER arm invalidates, however tight the pooled interval', () => {
  const flipped = armStub({ eraSigns: [1, -1], eraFlip: true, beats: false });
  assert.match(verdict(flipped, armStub()).branch, /INVALIDATED/);
  assert.match(verdict(armStub(), flipped).branch, /INVALIDATED/);
  assert.equal(verdict(flipped, armStub()).beats, false);
});

ok('retirement: a reference line is never nominated — a ruler is not an estimator', () => {
  const h = headToHead(spread(12), 24, 0, DEPLOYABLE_POOL_KEYS);
  const rows = retirementTable(h, [h], [h, h]);
  for (const r of rows) assert.ok(!BASELINE_KEYS.includes(r.key), r.key + ' is a reference line');
  assert.ok(!rows.some(r => r.key === h.best), 'the winner cannot retire against itself');
});

ok('retirement: an EXECUTED nomination carries its date, so a re-run never reads as an open action item', () => {
  const h = headToHead(spread(12), 24, 0, DEPLOYABLE_POOL_KEYS);
  const rows = retirementTable(h, [h], [h, h]);
  const p = rows.find(r => r.key === 'pressure');
  assert.ok(p, 'pressure stays in the table (the record is re-runnable)');
  assert.equal(p.executed, EXECUTED_RETIREMENTS.pressure, "pressure's row carries the executed date");
  assert.equal(EXECUTED_RETIREMENTS.pressure, '2026-08-30');
  for (const r of rows) if (r.key !== 'pressure') assert.equal(r.executed, null, r.key + ' has no executed date');
});

ok('retirement: an UNBOUNDED reconstruction is BLOCKED however large its deficit', () => {
  const h = headToHead(spread(12), 24, 0, DEPLOYABLE_POOL_KEYS);
  const blocked = retirementTable(h, [h], [h, h], new Set(['depth'])).find(r => r.key === 'depth');
  assert.ok(blocked, 'depth must be in the table to be blocked in it');
  assert.equal(blocked.nominated, false);
  assert.match(blocked.blockedBy, /UNBOUNDED/);
  const free = retirementTable(h, [h], [h, h]).find(r => r.key === 'depth');
  assert.equal(free.blockedBy, null, 'without the flag it is judged on its numbers alone');
});

ok('retirement: the POLICIES UNDER TEST are not retirement candidates — nothing deployed to retire', () => {
  const h = headToHead(spread(12), 24, 0, DEPLOYABLE_POOL_KEYS);
  const keys = retirementTable(h, [h], [h, h]).map(r => r.key);
  for (const k of ARM_KEYS) assert.ok(!keys.includes(k), k + ' was never deployed');
  assert.ok(keys.includes('pressure'), 'a deployed incumbent still appears');
});

ok('retirement: a deficit under the reconstruction resolution is BLOCKED — it is not a measurement', () => {
  const h = headToHead(spread(12), 24, 0, DEPLOYABLE_POOL_KEYS);
  const free = retirementTable(h, [h], [h, h]);
  const scored = free.filter(r => r.ci);
  assert.ok(scored.length, 'the fixture must produce intervals for this to mean anything');
  const biggest = Math.max(...scored.map(r => Math.abs(r.ci.point)));
  const blocked = retirementTable(h, [h], [h, h], new Set(), { resolutionFloor: biggest * 2 });
  for (const r of blocked.filter(x => x.ci)) {
    assert.equal(r.underFloor, true);
    assert.equal(r.nominated, false);
    assert.match(r.blockedBy, /resolution floor/);
  }
  const open = retirementTable(h, [h], [h, h], new Set(), { resolutionFloor: 0 });
  assert.ok(open.every(r => !r.underFloor), 'a zero floor blocks nothing');
});

ok('retirement: an INVALIDATED verdict blocks every nomination, not just the flipping one', () => {
  const h = headToHead(spread(12), 24, 0, DEPLOYABLE_POOL_KEYS);
  const rows = retirementTable(h, [h], [h, h], new Set(), { invalidated: true });
  assert.ok(rows.length, 'the fixture must produce candidates for the block to mean anything');
  for (const r of rows) {
    assert.equal(r.nominated, false);
    assert.match(r.blockedBy, /INVALIDATED/);
  }
  assert.ok(retirementTable(h, [h], [h, h]).some(r => r.blockedBy == null), 'and unblocked without the flag');
});

ok('crossover: it is SOLVED off the identity, and only for contenders whose ask is fixed in the cost', () => {
  // edge(f) = edge(0) + f x reachRate, so a contender that reaches MORE overtakes one that earns more.
  const h = { stats: [
    { key: 'asym', meanEdge: 0.09, reachRate: 0.69 },
    { key: 'quickSell*', meanEdge: 0.06, reachRate: 0.93 },
    { key: 'pressure', meanEdge: 0.04, reachRate: 0.37 },
    { key: 'askStar+fold', meanEdge: 0.01, reachRate: 0.99 },
  ] };
  const c = crossoverClosed(h);
  assert.equal(c.lead, 'asym');
  assert.equal(c.first.key, 'quickSell*');
  assert.ok(Math.abs(c.first.at - (0.09 - 0.06) / (0.93 - 0.69)) < 1e-12, 'the closed form, not a search');
  assert.ok(!c.all.some(x => ARM_KEYS.includes(x.key)), 'an arm re-derives its ask, so it is not solvable here');
  // A contender that reaches LESS than the leader can never overtake it, at any cost.
  assert.ok(!c.all.some(x => x.key === 'pressure'));
});

ok('crossover: no contender reaching more often than the leader means no crossover exists at all', () => {
  const c = crossoverClosed({ stats: [
    { key: 'asym', meanEdge: 0.09, reachRate: 0.99 },
    { key: 'pressure', meanEdge: 0.04, reachRate: 0.37 },
  ] });
  assert.equal(c.first, null);
  assert.equal(c.all.length, 0);
});

ok('retirement: an era sign flip BLOCKS a nomination, whatever the pooled interval says', () => {
  const h = headToHead(spread(12), 24, 0, DEPLOYABLE_POOL_KEYS);
  const flip = { ...h, stats: h.stats.map(x => (x.key === h.best ? { ...x, meanEdge: -99 } : x)) };
  const r = retirementTable(h, [h], [h, flip]).find(x => x.eraSigns[0] !== x.eraSigns[1] && x.eraSigns[0] && x.eraSigns[1]);
  if (!r) return;                                   // the fixture may not produce a flip; nothing to assert
  assert.equal(r.nominated, false);
  assert.match(r.blockedBy, /era halves/);
});

ok('verdict: the null branch names what it cancels, so it cannot be reframed later', () => {
  const b = verdict(armStub({ beats: false }), armStub({ beats: false })).branch;
  assert.match(b, /DESCRIPTION/);
  assert.match(b, /CANCELLED/);
});

ok('arm: `beats every reference line` is about THIS arm, not about whoever tops the table', () => {
  const pool = stats => ({ stats, rows: [], baselineWins: BASELINE_KEYS.includes(stats[0].key) });
  const below = pool([{ key: 'refHigh*', meanEdge: 0.05 }, { key: 'asym', meanEdge: 0.04 }, { key: 'askStar', meanEdge: 0.03 }, { key: 'quickSell*', meanEdge: 0.01 }]);
  assert.equal(armVerdict('askStar', below, [], []).beatsBaselines, false, 'it sits under refHigh*');
  const above = pool([{ key: 'askStar', meanEdge: 0.09 }, { key: 'asym', meanEdge: 0.04 }, { key: 'refHigh*', meanEdge: 0.03 }, { key: 'quickSell*', meanEdge: 0.01 }]);
  assert.equal(armVerdict('askStar', above, [], []).beatsBaselines, true);
  // An ESTIMATOR topping the table says nothing about a different arm's standing against the reference
  // lines — this is the case a pool-level flag gets backwards, and it is the one that occurs in practice.
  const mixed = pool([{ key: 'asym', meanEdge: 0.05 }, { key: 'refHigh*', meanEdge: 0.04 }, { key: 'askStar', meanEdge: 0.03 }]);
  assert.equal(mixed.baselineWins, false, 'no reference line tops this table');
  assert.equal(armVerdict('askStar', mixed, [], []).beatsBaselines, false, 'yet askStar still sits under one');
  assert.equal(armVerdict('asym', mixed, [], []).beatsBaselines, true);
});

ok('arm: a straddling interval does not clear, whatever its sign', () => {
  const recs = spread(12);
  const d = headToHead(recs, 24, 0, ESTIMATOR_POOL_KEYS);
  const arm = armVerdict('askStar', d, [], [d, d]);
  if (arm.ci && arm.ci.lo <= 0 && arm.ci.hi >= 0) assert.equal(arm.clearOfZero, false);
  assert.equal(arm.beats, arm.clearOfZero && arm.sign > 0 && arm.agreeing >= 2 && !arm.eraFlip);
});

// --- the acceptance check --------------------------------------------------------------------------------
ok('acceptance: it reads the DEPLOYED logged field for every contender it claims to bound', () => {
  assert.deepEqual(Object.keys(ACCEPTANCE_FIELDS).sort(), ['asym', 'depth', 'pressure', 'quickSell*', 'reachFold'].sort());
  assert.ok(!('askStar' in ACCEPTANCE_FIELDS), 'askStar was never deployed; it has no logged counterpart');
});

ok('acceptance: reachFold reads estSell only when the relief did NOT fire — they are disjoint estimators', () => {
  const f = ACCEPTANCE_FIELDS.reachFold;
  assert.equal(f({ estSell: 100, estConfidence: { reachRelief: 0.5 } }), null);
  assert.equal(f({ estSell: 100, estConfidence: { reachRelief: 0 } }), 100);
  assert.equal(f({ estSell: 100, estConfidence: {} }), 100);
});

ok('acceptance: a row scores every field both sides carry, and reports a signed relative difference', () => {
  const s = { itemId: 1, ts: ORIGIN, quickSell: 1, asym: { ask: 1 }, reachable: { ask: 1 } };
  const row = acceptanceRow({ series: FULL, s, nights: DEFAULT_NIGHTS, depthQtyFrac: 0.005 });
  assert.ok(row && row['quickSell*'], 'the live pair is always reconstructible');
  assert.equal(row['quickSell*'].logged, 1);
  assert.ok(row['quickSell*'].relDiff > 0, 'a logged 1gp against a 10k fixture must read far high');
  const sum = acceptanceSummary([row]);
  const q = sum.find(x => x.key === 'quickSell*');
  assert.equal(q.n, 1);
  assert.equal(q.medRel, row['quickSell*'].relDiff);
});

ok('acceptance: an estimator with no overlapping rows reports n=0, not a silent pass', () => {
  const sum = acceptanceSummary([{ pressure: { logged: 1, recomputed: 1, relDiff: 0 } }]);
  assert.equal(sum.find(x => x.key === 'depth').n, 0);
  assert.equal(sum.find(x => x.key === 'pressure').exactFrac, 1);
});

ok('acceptance: ONE matched row is not a bound — the unbounded test is a row FLOOR, not n>0', () => {
  const rows = Array.from({ length: ACCEPTANCE_MIN_ROWS - 1 }, () => ({ depth: { logged: 1, recomputed: 1, relDiff: 0 } }));
  const sum = acceptanceSummary(rows);
  const d = sum.find(x => x.key === 'depth');
  assert.equal(d.n, ACCEPTANCE_MIN_ROWS - 1);
  assert.ok(d.n > 0, 'it scored rows...');
  assert.ok(d.n < ACCEPTANCE_MIN_ROWS, '...and is still unbounded');
  assert.ok(unboundedKeys(sum).has('depth'), 'a row floor, not n>0');
  const plenty = acceptanceSummary(Array.from({ length: ACCEPTANCE_MIN_ROWS }, () => ({ depth: { logged: 1, recomputed: 1, relDiff: 0 } })));
  assert.ok(!unboundedKeys(plenty).has('depth'), 'and it clears at the floor');
});

// --- cells and live reads ----------------------------------------------------------------------------------
ok('cells: the key is liquidity x floor/ceiling shape, both read as of the origin', () => {
  const r = recAt(FULL);
  assert.equal(CELL_OF(r), `${r.liqClass} × ${r.fcDir}`);
  assert.ok(['thin', 'mid', 'liquid', 'unknown'].includes(r.liqClass));
});

ok('live: the band proxy brackets the live pair the way computeQuote clamps it', () => {
  const live = liveAt(TRUNC, TRUNC.length);
  assert.ok(live.optSell >= live.quickSell, 'optSell >= quickSell is the ordering guarantee');
  assert.ok(live.optBuy <= live.quickBuy, 'optBuy <= quickBuy is the ordering guarantee');
  assert.ok(live.volDay > 0);
});

ok('fold: it refuses rather than guessing when the live pair or the daily sample is missing', () => {
  assert.equal(foldAskAt({ stats: { his: [1], days: [1] }, live: { quickBuy: null, quickSell: 1 } }), null);
  assert.equal(foldAskAt({ stats: null, live: { quickBuy: 1, quickSell: 2 } }), null);
  assert.equal(foldAskAt({ stats: { his: [1], days: [] }, live: { quickBuy: 1, quickSell: 2 } }), null);
});

ok('record: an origin the archive cannot resolve at any horizon yields no record at all', () => {
  assert.equal(recAt(TRUNC, TRUNC[TRUNC.length - 1].ts), null, 'no forward window ⇒ nothing to score');
  assert.equal(recAt(FULL, DAY0 + 2 * 86400), null, 'inside the reference warmup ⇒ no surface');
});

console.log(`\n${pass} assertion group(s) passed.`);
