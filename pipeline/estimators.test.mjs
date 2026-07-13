#!/usr/bin/env node
/**
 * estimators.test.mjs — the per-thesis P(fill)+TTF estimator conformance + math suite (Pipeline v2
 * chunk P6b, pipeline/lib/estimators.mjs).
 *
 * TWO jobs:
 *   1. CONFORMANCE — every strategy spec's estimator (via estimatorFor) is PURE, NO-THROW over the
 *      shared replay archetypes AND a degrade (empty-ctx) path, DETERMINISTIC, and returns the
 *      { value, n, basis } honesty shape. So a future spec/family gets checked for free.
 *   2. FIXTURE MATH — at least one estimator's math pinned per family (intraday / value / rising),
 *      plus rankScore, quotedPair and the estimateRank integration.
 *
 * Pure + offline — NO live API (CLAUDE.md rule 4). The thresholds under test are NAMED PLACEHOLDERS
 * (n≈0 today); these fixtures pin STRUCTURE + ORDERING + degrade behavior, never a calibrated value.
 * Run: `node pipeline/estimators.test.mjs`. Auto-discovered by run-tests.mjs.
 */
import assert from 'node:assert/strict';
import { computeQuote, breakEven } from '../js/quotecore.js';
import { STRATEGY_LIST, STRATEGIES } from '../js/strategies.mjs';
import { buildSnapshot } from './lib/replay.mjs';
import {
  estimatorFor, ESTIMATORS, ESTIMATOR_FAMILIES,
  pFillIntraday, ttfIntraday, pFillValue, ttfValue, pFillRising, ttfRising, churnLapUnits,
  quotedPair, rankScore, estimateRank, fmtTtf, askReachFactor, asymEstimate,
  estimatePair, estPairCells, estConfLean, EST_REACH_SAT_FRAC, EST_HEADERS,
  PFILL_PRIOR, PFILL_DEPTH_SLOPE, PFILL_BREAKDOWN_PENALTY,
  TTF_INTRADAY_PRIOR_SEC, TTF_MULTIDAY_PRIOR_SEC, TTF_REF_VOL, TTF_FLOOR_DAYS,
  RISING_PFILL_CONFIRMED, RISING_PFILL_UNCONFIRMED,
} from './lib/estimators.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };
const isShaped = r => r && typeof r === 'object' && typeof r.value === 'number' && Number.isFinite(r.value)
  && typeof r.n === 'number' && typeof r.basis === 'string';

console.log('estimators.mjs conformance + math:');

// Build the real computeQuote rows for every replay archetype (same inputs replay.mjs feeds).
const snap = buildSnapshot();
const ROWS = Object.entries(snap.items).map(([idStr, it]) => ({
  id: +idStr, name: it.name,
  row: computeQuote({ latest: it.latest, ts5m: it.ts5m, ts6h: it.ts6h, vol24: it.v24, guide: it.guide, limit: it.limit, now: snap.anchorTs * 1000 }),
}));

/* --- conformance ---------------------------------------------------------------------------------- */
ok('estimatorFor returns a { pFill, ttf } pair for every registered spec', () => {
  for (const s of STRATEGY_LIST) {
    const est = estimatorFor(s);
    assert.equal(typeof est.pFill, 'function', `${s.key} pFill is a function`);
    assert.equal(typeof est.ttf, 'function', `${s.key} ttf is a function`);
  }
  // an unknown/missing family degrades to the intraday family (never throws / undefined).
  assert.equal(estimatorFor({ estimator: 'nope' }), ESTIMATORS.intraday);
  assert.equal(estimatorFor(null), ESTIMATORS.intraday);
});

ok('the registry families are exactly {intraday, value, rising, churn}', () => {
  assert.deepEqual([...ESTIMATOR_FAMILIES].sort(), ['churn', 'intraday', 'rising', 'value']);
});

ok('every spec estimator runs over every archetype WITHOUT throwing + returns the {value,n,basis} shape', () => {
  for (const s of STRATEGY_LIST) {
    const est = estimatorFor(s);
    for (const { name, row } of ROWS) {
      // build the ctx estimateRank would build (band edges/mom/regime/volume) so estimators see real data.
      const ctx = {
        bid: row.optBuy, ask: row.optSell, quickBuy: row.quickBuy, quickSell: row.quickSell,
        bandLo: row.band ? row.band.lo : null, mom: row.mom,
        regime: row.falling ? 'falling' : row.rising ? 'rising' : 'flat', volDay: row.volDay,
      };
      let pf, tt;
      assert.doesNotThrow(() => { pf = est.pFill(ctx); }, `${s.key} pFill on ${name}`);
      assert.doesNotThrow(() => { tt = est.ttf(ctx); }, `${s.key} ttf on ${name}`);
      assert.ok(isShaped(pf), `${s.key}/${name} pFill shaped`);
      assert.ok(isShaped(tt), `${s.key}/${name} ttf shaped`);
      assert.ok(pf.value >= 0 && pf.value <= 1, `${s.key}/${name} pFill ∈ [0,1]`);
      assert.ok(tt.value > 0, `${s.key}/${name} ttf > 0`);
    }
  }
});

ok('every estimator DEGRADES on an empty ctx (no throw, shaped, honest n:0 prior)', () => {
  for (const fn of [pFillIntraday, ttfIntraday, pFillValue, ttfValue, pFillRising, ttfRising]) {
    let r;
    assert.doesNotThrow(() => { r = fn({}); }, `${fn.name}({}) no-throw`);
    assert.ok(isShaped(r), `${fn.name}({}) shaped`);
    assert.doesNotThrow(() => fn(), `${fn.name}() no-arg no-throw`);
  }
});

ok('estimators are DETERMINISTIC — same ctx twice is deep-equal', () => {
  const ctx = { bid: 98_000, quickBuy: 100_000, bandLo: 98_000, mom: 'clean', volDay: 5_000, regime: 'flat', valueRanges: { hasData: true, proximity: 0.8, coverageDays: 20 } };
  for (const fam of Object.values(ESTIMATORS)) {
    assert.deepEqual(fam.pFill(ctx), fam.pFill(ctx));
    assert.deepEqual(fam.ttf(ctx), fam.ttf(ctx));
  }
});

/* --- intraday family math ------------------------------------------------------------------------- */
ok('intraday pFill: transact-now bid → ~1.0, band-floor bid → PFILL_PRIOR, breakdown penalised', () => {
  // bid AT the live instasell fills immediately.
  assert.equal(pFillIntraday({ bid: 100_000, quickBuy: 100_000, bandLo: 98_000 }).value, 1);
  // bid at the 2h band floor → depth 1 → 1 − slope.
  assert.equal(pFillIntraday({ bid: 98_000, quickBuy: 100_000, bandLo: 98_000 }).value, 1 - PFILL_DEPTH_SLOPE);
  // a live 2h breakdown knocks the fill call down by the penalty.
  const bd = pFillIntraday({ bid: 100_000, quickBuy: 100_000, bandLo: 98_000, mom: 'breakdown' });
  assert.equal(bd.value, 1 - PFILL_BREAKDOWN_PENALTY);
  // no usable data → the wide prior, honestly n:0.
  const pr = pFillIntraday({});
  assert.equal(pr.value, PFILL_PRIOR); assert.equal(pr.n, 0); assert.equal(pr.basis, 'prior');
});

ok('intraday pFill: a real reach read (windowread) is used when present, with its n', () => {
  const r = pFillIntraday({ reach: { reachedDays: 9, nDays: 12 }, bid: 1, quickBuy: 2, bandLo: 1 });
  assert.equal(r.value, 9 / 12); assert.equal(r.n, 12); assert.equal(r.basis, 'reach');
});

ok('intraday ttf: deeper book (higher volume) is faster than the prior; a real velocity read wins', () => {
  const deep = ttfIntraday({ volDay: 100_000 });   // >> TTF_REF_VOL → factor floored, faster
  const thin = ttfIntraday({ volDay: 10 });         // << TTF_REF_VOL → factor ceiled, slower
  assert.ok(deep.value < TTF_INTRADAY_PRIOR_SEC, 'deep book faster than the prior');
  assert.ok(thin.value > TTF_INTRADAY_PRIOR_SEC, 'thin book slower than the prior');
  assert.ok(deep.value < thin.value, 'deeper is faster than thinner');
  // at the reference volume the prior applies unscaled.
  assert.equal(ttfIntraday({ volDay: TTF_REF_VOL }).value, TTF_INTRADAY_PRIOR_SEC);
  // a measured velocity overrides the prior and carries its n.
  const v = ttfIntraday({ velocity: { medianFillSec: 1234, n: 7 }, volDay: 5 });
  assert.equal(v.value, 1234); assert.equal(v.n, 7); assert.equal(v.basis, 'velocity');
});

/* --- value family math ---------------------------------------------------------------------------- */
ok('value pFill IS floor-proximity (carries coverageDays as n); value ttf scales the multi-day prior', () => {
  const near = pFillValue({ valueRanges: { hasData: true, proximity: 0.9, coverageDays: 18 } });
  const far  = pFillValue({ valueRanges: { hasData: true, proximity: 0.1, coverageDays: 18 } });
  assert.equal(near.value, 0.9); assert.equal(near.n, 18); assert.equal(near.basis, 'floor-proximity');
  assert.ok(near.value > far.value, 'nearer the floor ⇒ higher fill probability');
  // no term structure → the prior.
  assert.equal(pFillValue({}).value, PFILL_PRIOR);
  // ttf: nearer the floor (high proximity) ⇒ the cycle-up is sooner ⇒ shorter than a far one.
  const tNear = ttfValue({ valueRanges: { hasData: true, proximity: 0.9 } });
  const tFar  = ttfValue({ valueRanges: { hasData: true, proximity: 0.1 } });
  assert.ok(tNear.value < tFar.value, 'nearer the floor recovers sooner');
  assert.equal(ttfValue({}).value, TTF_MULTIDAY_PRIOR_SEC, 'no data → the multi-day prior unscaled');
});

/* --- rising family math --------------------------------------------------------------------------- */
ok('rising pFill: confirmed uptrend (not breaking down) > unconfirmed; ttf is the multi-day horizon', () => {
  assert.equal(pFillRising({ regime: 'rising', mom: 'clean' }).value, RISING_PFILL_CONFIRMED);
  assert.equal(pFillRising({ regime: 'rising', mom: 'breakdown' }).value, RISING_PFILL_UNCONFIRMED);
  assert.equal(pFillRising({ regime: 'flat' }).value, RISING_PFILL_UNCONFIRMED);
  assert.ok(RISING_PFILL_CONFIRMED > RISING_PFILL_UNCONFIRMED);
  assert.equal(ttfRising().value, TTF_MULTIDAY_PRIOR_SEC);
});

/* --- churn family math (Step 6, decision A) -------------------------------------------------------- */
ok('churn lapUnits = min(limit, volDay); estimateRank ranks the LAP (net × lapUnits), net stays per-unit', () => {
  assert.equal(churnLapUnits({ limit: 25_000, volDay: 2_000_000 }), 25_000, 'limit ≤ volDay → the exact limit');
  assert.equal(churnLapUnits({ limit: 5_000_000, volDay: 1_000 }), 1_000, 'limit > volDay → capped at feasible depth');
  assert.equal(churnLapUnits({ volDay: 3_000 }), 3_000, 'no limit → a single volume-bounded lap');
  assert.equal(churnLapUnits({}), 1, 'no data → 1 (honest floor)');
  // estimateRank on the churn spec multiplies the per-unit net by lapUnits: a churn row ranks the LAP.
  const row = { optBuy: 100, optSell: 110, volDay: 100_000, limit: 20_000, mid: 105 };
  const erChurn = estimateRank(STRATEGIES.churn, row);
  const erBand = estimateRank(STRATEGIES.band, row);   // same inputs, per-unit rank (lapUnits ≡ 1)
  assert.equal(erChurn.pair.basis, 'opt');
  assert.equal(erChurn.lapUnits, Math.min(20_000, 100_000));
  assert.equal(erBand.lapUnits, 1, 'band ranks per-unit');
  assert.ok(Math.abs(erChurn.rank - erBand.rank * erChurn.lapUnits) < 1e-6, 'churn rank = per-unit rank × lapUnits');
  assert.equal(erChurn.net, erBand.net, 'er.net stays PER-UNIT (only the rank is per-lap)');
});

/* --- rankScore + quotedPair + estimateRank -------------------------------------------------------- */
ok('rankScore = net × P(fill) ÷ TTF(days), with the TTF floor guarding a divide-by-tiny', () => {
  // 12k net, P 0.5, ttf 1 day → 6000/unit/day.
  assert.equal(rankScore({ net: 12_000, pFill: 0.5, ttfSec: 86_400 }), 6_000);
  // faster ttf (half a day) doubles the rate; higher pFill scales linearly.
  assert.equal(rankScore({ net: 12_000, pFill: 0.5, ttfSec: 43_200 }), 12_000);
  assert.equal(rankScore({ net: 12_000, pFill: 1, ttfSec: 86_400 }), 12_000);
  // degrade: missing net → 0; missing pFill → 0.
  assert.equal(rankScore({ pFill: 0.5, ttfSec: 86_400 }), 0);
  assert.equal(rankScore({ net: 12_000, ttfSec: 86_400 }), 0);
  // a near-zero ttf is floored at TTF_FLOOR_DAYS so the rate can't blow up.
  assert.equal(rankScore({ net: 100, pFill: 1, ttfSec: 1 }), 100 / TTF_FLOOR_DAYS);
});

ok('quotedPair posts the thesis pair: band/churn/scalp=opt, value=term(null); quick still served', () => {
  const row = { quickBuy: 100, quickSell: 110, optBuy: 95, optSell: 115 };
  assert.deepEqual(quotedPair(STRATEGIES.band, row), { bid: 95, ask: 115, basis: 'opt' });
  assert.deepEqual(quotedPair(STRATEGIES.churn, row), { bid: 95, ask: 115, basis: 'opt' });
  assert.deepEqual(quotedPair(STRATEGIES.scalp, row), { bid: 95, ask: 115, basis: 'opt' });
  assert.deepEqual(quotedPair(STRATEGIES.value, row), { bid: null, ask: null, basis: 'term' });
  // no shipped spec posts the 'quick' pair since spread was deleted (Steps 3+4), but quotedPair still serves it.
  assert.deepEqual(quotedPair({ priceBasis: 'quick' }, row), { bid: 100, ask: 110, basis: 'quick' });
});

ok('estimateRank bundles pair/net/pFill/ttf/rank off a real archetype row (band + churn = opt pair)', () => {
  const stable = ROWS.find(r => r.name === 'Stable band commodity').row;
  const erBand = estimateRank(STRATEGIES.band, stable);
  const erChurn = estimateRank(STRATEGIES.churn, stable);
  assert.equal(erBand.pair.basis, 'opt');
  assert.equal(erChurn.pair.basis, 'opt');
  for (const er of [erBand, erChurn]) {
    assert.ok(Number.isFinite(er.rank) && er.rank >= 0, 'rank finite ≥ 0');
    assert.ok(isShaped(er.pFill) && isShaped(er.ttf), 'components shaped');
  }
  // value spec on a plain row has a null (term) pair → net null → rank 0 (value ranks off its own vr).
  assert.equal(estimateRank(STRATEGIES.value, stable).rank, 0);
});

/* --- PART II (PLAN-GRADE-REACH): asymmetric fill shape ---------------------------------------------- */
ok('PART II golden (Lightbearer archetype): a 3/14-bid + 11/14-ask pick OUT-RANKS a 12/14-bid + 2/14-ask pick of EQUAL net', () => {
  // same realizable pair (equal net), opposite fill shapes. A = Ben's ideal (rare deep entry, near-
  // certain exit); B = the mirage-exit shape Part I diagnosed.
  const row = { quickBuy: 3_900_000, quickSell: 3_950_000, volDay: 500 };
  const A = { deepBid: 3_800_000, highReachAsk: 4_050_000, pAsk: 11 / 14, pBid: 3 / 14, nDays: 14 };
  const B = { deepBid: 3_800_000, highReachAsk: 4_050_000, pAsk: 2 / 14, pBid: 12 / 14, nDays: 14 };
  const eA = asymEstimate(STRATEGIES.band, row, A);
  const eB = asymEstimate(STRATEGIES.band, row, B);
  assert.equal(eA.net, eB.net, 'equal band net by construction');
  assert.ok(eA.rank > eB.rank, 'asym objective: the near-certain EXIT wins the rank');
  assert.ok(Math.abs(eA.rank / eB.rank - (11 / 2)) < 1e-9, 'rank scales by P_ask alone (11/14 vs 2/14)');
  // …and under the OLD symmetric two-leg P (bid-fill × ask-reach factor) B would out-rank A — the
  // exact inversion Part II exists to fix (pinned so the contrast can't silently regress).
  const oldP = (pBid, pAsk) => pBid * askReachFactor({ reachedDays: pAsk * 14, nDays: 14 });
  assert.ok(oldP(12 / 14, 2 / 14) > oldP(3 / 14, 11 / 14), 'the symmetric objective preferred the wrong shape');
});

ok('asymEstimate: P_bid NEVER multiplies the rank (a rare deep fill is a feature, not a defect)', () => {
  const row = { quickBuy: 1000, quickSell: 1010, volDay: 5000 };
  const base = { deepBid: 900, highReachAsk: 1100, pAsk: 0.8, nDays: 14 };
  const rare = asymEstimate(STRATEGIES.band, row, { ...base, pBid: 1 / 14 });
  const often = asymEstimate(STRATEGIES.band, row, { ...base, pBid: 13 / 14 });
  assert.equal(rare.rank, often.rank, 'pBid is an annotation, not a weight');
  assert.equal(rare.pBid, 1 / 14, 'but it IS surfaced for the rest-it-as-optionality line');
});

ok('asymEstimate: ordering guards hold (bid ≤ quickBuy, ask ≥ quickSell); degrades to null without a pair', () => {
  const row = { quickBuy: 1000, quickSell: 1010, volDay: 5000 };
  // a deep bid ABOVE live clamps down to quickBuy; a high-reach ask BELOW live instabuy clamps up.
  const e = asymEstimate(STRATEGIES.band, row, { deepBid: 1200, highReachAsk: 990, pAsk: 0.9, pBid: 0.9, nDays: 14 });
  assert.ok(e.bid <= row.quickBuy, 'optBuy ≤ quickBuy guard');
  assert.ok(e.ask >= row.quickSell, 'optSell ≥ quickSell guard');
  assert.equal(asymEstimate(STRATEGIES.band, row, null), null);
  assert.equal(asymEstimate(STRATEGIES.band, row, { deepBid: null, highReachAsk: 1100 }), null);
});

ok('PART II churn exemption: a symmetric-fillShape spec skips the Proposal-A ask-reach discount; band still discounts', () => {
  const row = { optBuy: 100, optSell: 110, quickBuy: 101, quickSell: 109, volDay: 100_000, limit: 20_000, mid: 105 };
  const badAskReach = { reachedDays: 2, nDays: 14 };   // a 2/14 mirage exit
  assert.equal(STRATEGIES.churn.fillShape, 'symmetric');
  assert.equal(STRATEGIES.band.fillShape, 'asym');
  const churnNo = estimateRank(STRATEGIES.churn, row);
  const churnWith = estimateRank(STRATEGIES.churn, row, { askReach: badAskReach });
  assert.equal(churnWith.pFill.value, churnNo.pFill.value, 'churn P untouched by ask-reach');
  assert.equal(churnWith.rank, churnNo.rank, 'churn rank untouched by ask-reach');
  const bandNo = estimateRank(STRATEGIES.band, row);
  const bandWith = estimateRank(STRATEGIES.band, row, { askReach: badAskReach });
  assert.ok(bandWith.pFill.value < bandNo.pFill.value, 'band (asym fillShape) still takes the Part-I discount');
});

/* --- PLAN-OUTPUT-TABLE + REVISIONS: the reconciliation estimator (Est. buy / Est. sell) ------------- */
ok('estimatePair MIRAGE EXIT (full-window only, no recent split): a 4/14d ask folds estSell below the raw top', () => {
  const row = { quickBuy: 23_900_000, quickSell: 24_000_000, optBuy: 23_600_000, optSell: 24_440_000 };
  const e = estimatePair(STRATEGIES.band, row, { askReach: { reachedDays: 4, nDays: 14 } });
  assert.ok(e.estSell < row.optSell, 'estSell discounted below the raw band top');
  assert.ok(e.estSell > row.quickSell, 'but not collapsed past the live instabuy');
  const fold = Math.min(1, (4 / 14) / EST_REACH_SAT_FRAC);   // no recent counts → full-window basis
  assert.equal(e.estSell, Math.round(row.quickSell + (row.optSell - row.quickSell) * fold));
  const rawNet = row.optSell - Math.floor(row.optSell * 0.02) - row.optBuy;
  assert.ok(e.estNet < rawNet / 2, `estNet ${e.estNet} collapses vs raw ${rawNet}`);
  assert.equal(e.estBuy, row.optBuy, 'no bid read ⇒ the band bid stands');
  // rev1 confidence shape: full window present, recent-3 absent, not diverging.
  assert.equal(e.confidence.ask.full.hit, 4); assert.equal(e.confidence.ask.full.days, 14);
  assert.equal(e.confidence.ask.rec, null);
  assert.equal(e.confidence.bid, null);
  assert.equal(e.confidence.beFloored, false);
});

ok('rev1 RECENT-3 is the fold basis + the primary token: a good 12/14 full that CRASHED to 0/3 recent collapses estSell to live and shows BOTH', () => {
  // the true mirage: the full window looks great (12/14) but the RECENT reach is 0/3 = it stopped printing.
  const row = { quickBuy: 24_500_000, quickSell: 25_000_000, optBuy: 24_000_000, optSell: 27_000_000 };
  const e = estimatePair(STRATEGIES.band, row, { askReach: { reachedDays: 12, nDays: 14, recentHit: 0, recentDays: 3 } });
  assert.equal(e.estSell, row.quickSell, 'recent 0/3 folds the ask fully to live (BE non-binding here)');
  assert.equal(e.confidence.beFloored, false);
  // the token shows recent-3 PRIMARY with the full window BESIDE it (divergence = the stale flag).
  const cells = estPairCells(e);
  assert.ok(/0\/3 · 12\/14/.test(cells[1].t), `sell cell shows both tokens: ${cells[1].t}`);
  const lean = estConfLean(e);
  assert.equal(lean.askRecHit, 0); assert.equal(lean.askRecDays, 3);
  assert.equal(lean.askHit, 12); assert.equal(lean.askDays, 14);
});

ok('rev1 recent + full AGREEING shows the recent token ALONE (no divergence clutter)', () => {
  const row = { quickBuy: 100, quickSell: 110, optBuy: 90, optSell: 130 };
  const e = estimatePair(STRATEGIES.band, row, { askReach: { reachedDays: 12, nDays: 14, recentHit: 3, recentDays: 3 } });
  const cells = estPairCells(e);
  assert.ok(/\(3\/3\)/.test(cells[1].t) && !/·/.test(cells[1].t), `sell shows recent only: ${cells[1].t}`);
});

ok('estimatePair CLEAN DENSE: a 12/14d + 3/3-recent ask keeps estSell at the band top', () => {
  const row = { quickBuy: 23_900_000, quickSell: 24_000_000, optBuy: 23_600_000, optSell: 24_440_000 };
  const rc = { reachedDays: 12, nDays: 14, recentHit: 3, recentDays: 3 };
  const e = estimatePair(STRATEGIES.band, row, { askReach: rc, bidReach: rc });
  assert.equal(e.estSell, row.optSell, 'clean reach ⇒ the robust band top stands');
  assert.equal(e.estBuy, row.optBuy, 'clean touch ⇒ the band bid stands');
});

ok('rev2 STRATEGY-AWARE entry: scalp bids near-live, value bids the trough, band reach-folds → three different estBuy', () => {
  const row = { quickBuy: 1000, quickSell: 1010, optBuy: 900, optSell: 1100 };
  const reach = { bidReach: { reachedDays: 7, nDays: 14 } };   // a mid touch-reach so band folds partway
  const scalp = estimatePair(STRATEGIES.scalp, row, reach);
  const value = estimatePair(STRATEGIES.value, row, reach);
  const band  = estimatePair(STRATEGIES.band,  row, reach);
  assert.equal(scalp.estBuy, row.quickBuy, 'scalp → near-live (the live instasell)');
  assert.equal(value.estBuy, row.optBuy, 'value → the trough (band low, unfolded)');
  assert.ok(band.estBuy > value.estBuy && band.estBuy < scalp.estBuy, `band reach-folds between the two: ${band.estBuy}`);
  // scalp's buy cell carries NO reach caveat (a live bid fills); value/band do.
  assert.equal(scalp.confidence.bid, null);
  assert.ok(value.confidence.bid && band.confidence.bid, 'value/band annotate the trough touch-reach');
  // the entry doctrine is surfaced in the lean shadow (non-default only).
  assert.equal(estConfLean(scalp).doctrine, 'near-live');
  assert.equal(estConfLean(value).doctrine, 'trough');
  assert.equal(estConfLean(band).doctrine, undefined, 'reach-fold is the default → omitted');
});

ok('rev2 DECLARED-EXIT anchors estSell to the thesis target (above the band top), not the reach-folded ask', () => {
  // crystal-seed shape: a declared 6.27m evening-peak exit ABOVE the band top.
  const row = { quickBuy: 6_000_000, quickSell: 6_100_000, optBuy: 5_900_000, optSell: 6_200_000 };
  const e = estimatePair(STRATEGIES.band, row, { askReach: { reachedDays: 3, nDays: 14, recentHit: 0, recentDays: 3 }, declaredExit: 6_270_000 });
  assert.equal(e.estSell, 6_270_000, 'estSell = the declared exit, NOT ceiling-clamped to the band top');
  assert.equal(e.confidence.declaredAnchored, true);
  assert.equal(e.confidence.ask, null, 'a declared exit suppresses the generic ask-reach token');
  const cells = estPairCells(e);
  assert.ok(/\(declared\)/.test(cells[1].t), `sell cell marks it declared: ${cells[1].t}`);
  assert.equal(estConfLean(e).declaredAnchored, true);
  // a declared exit BELOW break-even is STILL BE-floored (BE never overridden).
  const e2 = estimatePair(STRATEGIES.band, { quickBuy: 100_000, quickSell: 100_500, optBuy: 99_000, optSell: 103_000 }, { declaredExit: 50_000 });
  assert.equal(e2.estSell, breakEven(e2.estBuy), 'BE still floors a declared exit below break-even');
  assert.equal(e2.confidence.beFloored, true);
});

ok('estimatePair BE FLOOR: a fully-collapsed ask is clamped UP to breakEven(estBuy) and flagged', () => {
  const row = { quickBuy: 100_000, quickSell: 100_500, optBuy: 99_000, optSell: 103_000 };
  const e = estimatePair(STRATEGIES.band, row, { askReach: { reachedDays: 0, nDays: 14 } });
  assert.equal(e.estBuy, 99_000);
  assert.equal(e.estSell, breakEven(99_000), 'estSell clamped to the model-free break-even');
  assert.equal(e.confidence.beFloored, true, 'the floor binding is surfaced in the confidence');
  assert.ok(e.estNet >= 0 && e.estNet <= 2, 'net collapses to ~0 — the estimate self-reports "no trade"');
  assert.deepEqual(estConfLean(e), { askHit: 0, askDays: 14, beFloored: true });
});

ok('rev3 the asym DEEP bid is NEVER folded into estBuy (optionality, not an expected entry)', () => {
  const row = { quickBuy: 1000, quickSell: 1010, optBuy: 950, optSell: 1100 };
  const withAsym = estimatePair(STRATEGIES.band, row, { asym: { deepBid: 700, highReachAsk: 1200 } });
  const without  = estimatePair(STRATEGIES.band, row, {});
  assert.equal(withAsym.estBuy, without.estBuy, 'deepBid never enters estBuy');
  assert.ok(withAsym.estBuy >= row.optBuy, 'estBuy stays at/above the band low');
});

ok('estimatePair degrades honestly: no reads ⇒ the model-free edge; no live pair ⇒ null; blends clamp; nudge applies', () => {
  const row = { quickBuy: 1000, quickSell: 1010, optBuy: 950, optSell: 1100 };
  const bare = estimatePair(STRATEGIES.band, row, {});
  assert.equal(bare.estBuy, 950); assert.equal(bare.estSell, 1100);   // absent evidence ⇒ no discount
  assert.equal(estimatePair(STRATEGIES.band, { optBuy: 950, optSell: 1100 }, {}), null, 'no live pair → null');
  // diurnal/asym levels are clamped INSIDE the live↔band span before blending (a flier can't drag the pair out).
  const wild = estimatePair(STRATEGIES.band, row, { diurnal: { bid: 1, ask: 99_999 }, asym: { highReachAsk: 99_999 } });
  assert.ok(wild.estBuy >= row.optBuy && wild.estBuy <= row.quickBuy, 'estBuy stays in [optBuy, quickBuy]');
  assert.ok(wild.estSell >= row.quickSell && wild.estSell <= row.optSell, 'estSell stays in [quickSell, optSell]');
  const nudged = estimatePair(STRATEGIES.band, row, {}, { nudge: (side, p) => side === 'ask' ? { price: p - 1 } : null });
  assert.equal(nudged.estSell, 1099, 'nudge applied as the final pricing step');
  assert.equal(EST_HEADERS.length, 4);
  const cells = estPairCells(bare);
  assert.equal(cells.length, 4);
  assert.ok(cells[0].t.includes('(–)') && cells[1].t.includes('(–)'), 'no-read confidence token rendered');
  assert.equal(estPairCells(null).length, 4, 'null estimate renders em-dash cells, never throws');
});

ok('fmtTtf renders compact minutes/hours/days', () => {
  assert.equal(fmtTtf(30 * 60), '30m');
  assert.equal(fmtTtf(3 * 3600), '3h');
  assert.equal(fmtTtf(3 * 86400), '3d');
  assert.equal(fmtTtf(null), '—');
});

console.log(`\nAll ${pass} estimator checks passed.`);
