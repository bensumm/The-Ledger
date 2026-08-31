/**
 * estimators.mjs — per-thesis P(fill) + Time-to-Flip (TTF) estimators, and the ranking composite
 * that REPLACES the demoted `expGpDay` throughput metric (Pipeline v2, chunk P6b).
 *
 * WHY THIS EXISTS. Ben's 2026-07-09 ruling: "I despise gp/d as a metric; it makes so many
 * assumptions about fill speed and fill price… let's get something that's more accurate per thesis
 * and less hand wavey." `expGpDay` (min(limit×2, 10%×volDay) × modeNet — ×2 = ACTIONABLE_WINDOWS_PER_DAY
 * since the 2026-08-08 haircut, NOT the physical 6 this line claimed until 2026-08-10 — three compounding
 * unmeasured assumptions) is DEMOTED: it survives ONLY as the cheap pre-fetch pool orderer inside
 * gatecandidates.rankAndSlice (no fetch-semantics change) and as the 250k `--min-gpd` attention
 * pre-filter. It is NEVER again the displayed "best" number or the grade basis. The replacement,
 * ruled by Ben: **rank = net after tax × P(fill at the quoted prices) ÷ TTF**, evaluated PER THESIS.
 *
 * THE PRICE-BASIS PRINCIPLE (coordinator-ruled, Ben-vetoable). Every suggestion commits to ONE price
 * pair — the bid and ask the thesis itself would have Ben post — and net, P(fill) and TTF are all
 * evaluated at that SAME pair. Per thesis (see js/flip-niches.mjs `priceBasis`):
 *   spread → live quick pair (transact now); band/churn/scalp → 2h band edges; rising → near-current
 *   entry → forecast target (band edges are the best available forecast proxy today); value → durable
 *   floor entry → a recovery level the term structure says durably prints (NOT the raw ceiling).
 * The net is ALWAYS the ONE shared js/money-math.js `netMargin` (= (ask − tax(ask)) − bid) — no new tax.
 *
 * ESTIMATOR FAMILIES (registry keyed by a spec's `estimator` field):
 *   churn — P(fill)/TTF reuse the intraday family, but the rank is PER LAP: `lapUnits` (the exact buy
 *     limit, bounded by feasible depth) multiplies the per-unit net, because on a buy-limit-cycle
 *     commodity we always max the limit so the lap size is a fact (Step 6, Ben 2026-07-09, decision A).
 *   intraday (band/scalp) — P(fill) from where the quoted bid sits in the live→2h-band
 *     span (reuses a real windowread reach read WHEN one is fetched; degrades to a band-depth heuristic
 *     on screen/quote, which do NOT fetch the 1h series — same discipline as reachValidator). TTF from
 *     intraday velocity (quoted size vs daily volume) around the intraday prior. NOTE (2026-07-09, Step 1):
 *     screen-flip-niches.mjs NOW fetches the 1h series for surfaced SURVIVORS, so it passes a REAL bid-side reach read
 *     via `extra.reach` on the screen surface — P(fill) there is the reach fraction, not the band-depth
 *     prior. quote-items.mjs still fetches no 1h series → it keeps the honest band-depth/prior degrade.
 *   value — P(fill at the floor bid) reuses the P5 valueScore components (proximity-to-low × floor
 *     stability); TTF is the historical trough→recovery duration proxy around the multi-day prior.
 *   rising — P(fill)/TTF off the regime-drift/forecast horizon.
 *
 * ⚠ HONESTY (CLAUDE.md rule 4 — n≈0 on EVERYTHING estimator-shaped today). EVERY constant below is a
 * NAMED PLACEHOLDER encoding the SHAPE of the judgment, NOT a calibrated magnitude. The archive began
 * accruing 2026-07-08 and the retro-join (pipeline/lib/retrojoin.mjs) is the calibrator that will
 * MEASURE realized suggestion→fill latency and replace these guesses. Every estimate returns
 * `{ value, n, basis }` so the honesty (what data, how many observations) travels WITH the number —
 * n:0 means "no observations, pure prior". Do NOT cite any constant here as validated.
 *
 * PURITY. DOM-free, fetch-free, fs-free ESM. Imports only the pure js/money-math.js helpers (the ONE
 * tax()/netMargin) plus js/quotecore.js's breakEven (itself pure, money-math.js-only — no cycle: quotecore
 * does not import this module). Every ctx field is optional; every estimator degrades to an honest wide prior,
 * never throws. Lives in js/ (2026-07-10 — moved out of pipeline/lib/) as the ONE shared home so the
 * app can rank/grade on it too (the app↔console parity boundary — shared logic in js/, node re-imports
 * via the pipeline/lib/estimators.mjs re-export shim, byte-identical). The Finder wiring is AP4.
 *
 * PC2 (2026-07-17) SPLIT: this file is now `js/estimators/families.mjs` — the P(fill)/TTF family
 * estimators + the ESTIMATORS registry + the rank composite (rankScore/estimateRank/quotedPair/fmtTtf).
 * The reach-conditioning helpers moved to ./reach.mjs, the reconciliation price estimator to ./pair.mjs,
 * the render cells to ./cells.mjs; `js/estimators.mjs` is now the barrel re-exporting all four. The
 * families↔reach edge is a runtime function-reference cycle (asymEstimate needs estimatorFor/rankScore;
 * estimateRank needs askReachFactor) — ESM-safe because both uses are at call time, not module eval.
 */
import { netMargin, clamp } from '../money-math.js';
import { askReachFactor } from './reach.mjs';   // PC2: the two-leg ask-reach discount (moved to reach.mjs); estimateRank calls it at runtime
import { amplitudeDeployUnits, AMP_HOLD_DAYS_DEFAULT, AMP_WF_MIN_JUDGED } from '../amplitudescreen.mjs';   // A2 (PLAN-AMPLITUDE-SCAN): the amplitude family's lapUnits min(); DT1b: the walk-forward sample floor below which pFillAmplitude falls back to the prior (ONE home — it lives with the function that produces `judged`)

const clamp01 = x => clamp(x, 0, 1);   // reuse the imported clamp — was a duplicate reimplementation
const num = x => (typeof x === 'number' && Number.isFinite(x)) ? x : null;
const estR = (value, n, basis) => ({ value, n, basis });

// estSampleN(...ests) — the observation-backed n behind a logged pair: min over legs with n>0 (a pure-
// prior leg carries no count and must not annihilate the other's via Math.min); all-priors → 0.
export const estSampleN = (...ests) => {
  const ns = ests.map(e => (e && e.n) || 0).filter(n => n > 0);
  return ns.length ? Math.min(...ns) : 0;
};

/* --- named PLACEHOLDER priors (rule 4 — unvalidated; retrojoin.mjs measures the real numbers) ------
   The intraday/multiday TTF priors intentionally MIRROR retrojoin.mjs's HORIZON_INTRADAY_SEC /
   HORIZON_MULTIDAY_SEC in magnitude, but they are a deliberate SIBLING, not an import: retrojoin's
   horizons are a JOIN CLAIM WINDOW ("how long after a suggestion a fill still counts as caused by it"),
   whereas these are an EXPECTED-LATENCY prior ("how long the flip typically takes"). Conflating the two
   by importing one into the other would couple distinct concepts (and drag reconstruct.mjs's module
   graph into this leaf); they are calibrated together but declared apart. */
export const PFILL_PRIOR             = 0.5;   // no usable data → a wide "coin-flip-ish" prior
export const PFILL_DEPTH_SLOPE       = 0.5;   // patient bid at the 2h band floor → PFILL_PRIOR; live bid → 1.0
export const PFILL_BREAKDOWN_PENALTY = 0.15;  // a live 2h breakdown clouds an intraday fill call
export const TTF_INTRADAY_PRIOR_SEC  = 12 * 3600;      // intraday flip family (mirrors retrojoin intraday horizon)
export const TTF_MULTIDAY_PRIOR_SEC  = 7 * 24 * 3600;  // accumulation family (mirrors retrojoin multi-day horizon)
export const TTF_REF_VOL             = 1000;  // volume at which the intraday prior applies unscaled
export const TTF_VEL_MIN             = 0.25;  // a deep book flips ≥4× faster than the prior … (floor)
export const TTF_VEL_MAX             = 4;     // … a thin book ≤4× slower (ceiling)
export const TTF_SAT_DAYS            = 1 / 24; // G5: the saturating-TTF knee — rank speed = 1/(days + this). At the knee a "1h flip" and an "instant flip" rank within 2× instead of unboundedly apart. Replaced the old TTF_FLOOR_DAYS divide-by-tiny floor (deleted — rankScore saturates now instead of flooring). PLACEHOLDER (n≈0)
export const RISING_PFILL_CONFIRMED  = 0.7;   // rising + not breaking down → entry near current fills readily
export const RISING_PFILL_UNCONFIRMED = 0.4;  // unconfirmed rising → the forecast entry is less certain
export const PFILL_ASKREACH_FLOOR    = 0.25;  // two-leg P (Proposal A, PLAN-GRADE-REACH): a flip only "fills"
                                              // if BOTH legs transact, so the family bid-fill P is discounted by
                                              // how often the ASK/exit reaches ACROSS DAYS. A 0/14-reach exit
                                              // floors the weight HERE (not to 0) so a stale fortnight demotes a
                                              // large-net item hard without zeroing it — SOFT by design
                                              // (rule 4: n≈14 per item, F1/retrojoin calibrates the magnitude).
// EF1(b) — the PLACEMENT BOUND on the 'symmetric' (churn) ask-reach exemption; single-sourced here,
// the digest's mirage-top rule imports it back. PLACEHOLDER (n≈0; "reuse, don't invent").
export const MIRAGE_PLACEMENT = 0.85;
// EF1(a) — the DEAD-BID floor: an entry-leg P (from a REAL reach read) below this marks the quoted bid
// as effectively dead, and estimateRank computes a REPRICED-ENTRY alternative (entry at the live
// crossable level, sell unchanged) beside the untouched headline rank. PLACEHOLDER (n≈0) — EF0(c)'s
// bid-side counterfactual owns the real value.
export const DEADBID_PFILL_FLOOR = 0.10;

/* symmetricExemptionHolds(spec, askPlacement) — EF1(b), PLAN-ESTIMATOR-FIDELITY. The 'symmetric'
   (churn) fillShape skips the ask-reach discount on the premise "sells into continuous two-sided flow
   NEAR a tight band top" (AC5/AC6 — the exemption fixed a real mismeasurement and must survive for
   tight laps). When the quoted ask sits ABOVE the daily-high distribution (placement > MIRAGE_PLACEMENT)
   that premise fails — the ask is not "near the tight top", it is the top's tail — so the exemption is
   BOUNDED: it holds only while placement ≤ the bound (or no placement read exists — an absent read never
   punishes, the standard degrade). Returns false for any non-symmetric spec (they were never exempt).
   ⚠ AMPLITUDE CAVEAT: the amplitude family is also fillShape 'symmetric', but its pFill ALREADY folds
   the exit leg (basis 'walkforward' — the measured round trip ends AT the ask being reached), so applying
   askReachFactor on top would DOUBLE-discount. NOTE the premise is genuinely weaker in the 'prior'
   fallback case, where pFill contains no exit leg at all; that is tolerated because the prior is already
   a deliberately wide, uninformative 0.5 and discounting it further would fake precision. The
   amplitude surface builds its own rank and passes NO askPlacement/askReach into estimateRank — keep it
   that way (the bound only ever fires when the caller passes a placement read). */
export function symmetricExemptionHolds(spec, askPlacement) {
  if (!spec || spec.fillShape !== 'symmetric') return false;
  const p = num(askPlacement);
  return !(p != null && p > MIRAGE_PLACEMENT);
}

/* --- P(fill) estimators — return { value∈[0,1], n, basis } ---------------------------------------- */

// intraday flip family (band/spread/churn/scalp). Prefer a REAL reach read (windowread) when the
// surface fetched the 1h series; degrade to a band-depth heuristic otherwise (screen/quote fetch only
// 5m/6h → reach is null here today, exactly like reachValidator — the honest degrade, not a fake number).
export function pFillIntraday(ctx = {}) {
  const c = ctx || {};
  const reach = c.reach;
  if (reach && num(reach.nDays) && reach.nDays > 0 && num(reach.reachedDays) != null) {
    return estR(clamp01(reach.reachedDays / reach.nDays), reach.nDays, 'reach');
  }
  const bid = num(c.bid), quickBuy = num(c.quickBuy), bandLo = num(c.bandLo);
  if (bid == null || quickBuy == null) return estR(PFILL_PRIOR, 0, 'prior');
  // A transact-now bid (≥ the live instasell) fills ~certainly; a patient bid parked toward the 2h
  // band floor is progressively less likely to fill intraday. depth ∈ [0,1] over the live→floor span.
  let p;
  if (bandLo == null || quickBuy <= bandLo) p = bid >= quickBuy ? 1 : PFILL_PRIOR;
  else {
    const depth = clamp01((quickBuy - bid) / (quickBuy - bandLo));
    p = clamp01(1 - PFILL_DEPTH_SLOPE * depth);
  }
  if (c.mom === 'breakdown') p = clamp01(p - PFILL_BREAKDOWN_PENALTY);
  return estR(p, 0, 'band-depth');
}

// value family — P(fill at the floor bid) IS proximity-to-low (the P5 valueScore component): live near
// the durable multi-week low ⇒ a floor bid fills soon; live far above ⇒ it rarely fills. n = coverage days.
export function pFillValue(ctx = {}) {
  const vr = (ctx && ctx.valueRanges) || null;
  if (vr && vr.hasData && num(vr.proximity) != null) {
    return estR(clamp01(vr.proximity), num(vr.coverageDays) ?? 0, 'floor-proximity');
  }
  return estR(PFILL_PRIOR, 0, 'prior');
}

// amplitude family — P(fill) is the WALK-FORWARD measured round-trip rate: given the trough bid
// actually filled, did the peak ask get reached inside the hold horizon? Computed by
// js/amplitudescreen.mjs `ampWalkForward` over the 1h archive and handed in via ctx.walkForward.
// Basis 'walkforward', n = `judged` (entries whose full horizon elapsed inside the data).
// Falls back to the bare prior when there is no read or the sample is under AMP_WF_MIN_JUDGED.
//
// THIS IS THE THIRD ESTIMATOR IN THIS SLOT. The two before it were both wrong, in instructive and
// DIFFERENT ways, and the whole point of this header is that neither failure gets reintroduced:
//
// 1. `pFill2leg` (deleted DT1) — a PRODUCT OF MARGINALS, bid-touch × ask-reach, standing in for a
//    joint. Independence is measured FALSE: trough-touch entry is adverse selection (unconditional
//    ask-reach ≤48h 43.1% vs 11.4% conditional on entry), so rows it predicted at ≥0.25 realized ~5%.
//    Reconciles with PLAN-BOTH-LEG-ENTRY's "approximately calibrated" reading (mean 0.102 vs realized
//    0.116): that measured the UNORDERED hold-≤1d joint — both legs printing in the window. This slot
//    needs the ORDERED, entry-conditional round trip, which the product badly overstates.
// 2. `cycleCompletion` (built and rejected the same day, DT1) — ordered, but CIRCULAR. `ampBid`/
//    `ampAsk` were the median low/high OF THE VERY DAYS then scored, so ~50% of those days cleared the
//    ask BY DEFINITION and a 4-day horizon compounded that to ≈1−0.5⁴ ≈ 94%. The live board confirmed
//    it exactly: 18 of 19 judged entries "completed", including Saturated heart at 5/5 — an item whose
//    real out-of-sample rate is 0 of 41 within 96h. A tautology, not a measurement. (An initial
//    diagnosis blamed sub-day grain; that was WRONG — grain contributes, circularity dominates.)
//
// WHY THIS ONE IS DIFFERENT: `ampWalkForward` fits the levels STRICTLY BEFORE each origin day and
// scores entry→completion at hour grain — the design of the DT1 study, which re-runs and reproduces
// its published figures exactly (Saturated heart 0.0% @96h n=41; Masori chaps 12.9% @24h n=31;
// harness pipeline/experiments/amp-cycle-reproduction.mjs). It discriminates strongly across live rows
// (0% / 24% / 42% / 48% @96h — the pre-build validation run on 4 items) where the in-sample figure read
// ~100% on all of them. Do not "simplify"
// it back onto the in-hand windowStats days — the pre-origin fit IS the correctness property.
//
// Unchanged from the original design: this REPLACES the Proposal-A ask-reach discount rather than
// stacking on it (the amplitude spec's fillShape is 'symmetric', so estimateRank's askReach discount
// is skipped, as for churn/value) — and that exemption is only sound BECAUSE this number already
// contains the ask leg. It was briefly unsound while this returned a bare prior; DT1b restores it.
//
// NEVER call it calibrated. It is a FILL PROXY on 1h aggregates — no queue, no partials, no
// competition — so it is an UPPER BOUND on a real round trip; see ampWalkForward's honesty limits.
export function pFillAmplitude(ctx = {}) {
  const wf = (ctx && ctx.walkForward) || null;
  if (wf && num(wf.frac) != null && (wf.judged ?? 0) >= AMP_WF_MIN_JUDGED) {
    return estR(clamp01(wf.frac), wf.judged, 'walkforward');
  }
  return estR(PFILL_PRIOR, 0, 'prior');
}

// amplitude family TTF = the hold-horizon prior in seconds (holdDays × 86400). holdDays is a spec/CLI
// parameter (default 4 since DT1's re-horizon, 2026-08-09 — the 1-day cycle premise measured 4.8%
// completion ≤24h given entry, median completion ~69h ≈ 3d, so a 4d prior is directionally right where
// 1d was not). PLACEHOLDER until the retro-join measures realized cycle time (§A5). Reads ctx.holdDays;
// defaults to AMP_HOLD_DAYS_DEFAULT.
export function ttfAmplitude(ctx = {}) {
  const hd = num(ctx && ctx.holdDays) ?? AMP_HOLD_DAYS_DEFAULT;
  return estR(Math.round(hd * 86400), 0, 'hold-horizon-prior');
}

// amplitude family lapUnits = the deployable-units min() (§2.2) — bankroll ÷ trough-bid, vol-share ×
// limiting-side volume × hold, buy-limit accumulation × hold. Delegates to amplitudeDeployUnits (the ONE
// home in js/amplitudescreen.mjs) so the rank is realizable after-tax gp/cycle of PARKED capital, per
// unit net staying the displayed honest margin — the same hook churn's lapUnits exercises.
export function amplitudeLapUnits(ctx = {}) {
  const c = ctx || {};
  return amplitudeDeployUnits({
    capGp: num(c.capGp), buyLow: num(c.ampBid),
    limitVol: num(c.limitVol), limit: num(c.limit), holdDays: num(c.holdDays) ?? AMP_HOLD_DAYS_DEFAULT,
  });
}

// rising family — entry is near current so P(fill) is high when the uptrend is confirmed and not
// breaking down; the forecast target's reach is the real risk (captured in TTF, not here). Prior-only.
export function pFillRising(ctx = {}) {
  const c = ctx || {};
  const confirmed = c.regime === 'rising' && c.mom !== 'breakdown';
  return estR(confirmed ? RISING_PFILL_CONFIRMED : RISING_PFILL_UNCONFIRMED, 0, 'regime-prior');
}

/* --- TTF estimators — return { value (SECONDS), n, basis } ----------------------------------------- */

// intraday flip family — a real velocity read (median fill latency from outcomes/retrojoin) when
// present; else scale the intraday prior by liquidity (deeper book → faster, thin book → slower).
export function ttfIntraday(ctx = {}) {
  const c = ctx || {};
  const vel = c.velocity;
  if (vel && num(vel.medianFillSec) != null && num(vel.n)) return estR(Math.round(vel.medianFillSec), vel.n, 'velocity');
  const volDay = num(c.volDay);
  // A MEASURED zero is the SLOWEST book we model, not the unscaled prior. Until 0.74.2 the `> 0` test
  // sent zero down the `factor = 1` path, so an item that traded NOTHING was modelled at the 12h
  // reference-volume prior while an item that traded 3 units hit TTF_VEL_MAX (48h) — i.e. a no-trade
  // item was modelled as flipping 4× FASTER than a barely-traded one, and it took rank #1 of the whole
  // Finder board (measured 2026-08-11: 222 zero-volume items in the browse pool, 4 in the top 20, 12 in
  // the top 50; #1 was also the maxRank denominator, so it squashed every real item's rating bar).
  // Zero now gets its own branch; the `> 0` test remains only to keep the division safe.
  // NULL stays on the unscaled prior DELIBERATELY — unknown ≠ measured-zero. The distinction is owned by
  // js/market.js's desirabilityOf header: an item absent from a PRESENT /24h map traded zero (measured:
  // 0.0% of them traded during the day the map covers) and maps to 0; null is reserved for an
  // UNAVAILABLE map, where a wide prior is the honest answer rather than a fabricated worst case.
  let factor = 1;
  if (volDay != null && volDay <= 0) factor = TTF_VEL_MAX;
  else if (volDay != null && volDay > 0) factor = clamp(Math.sqrt(TTF_REF_VOL / volDay), TTF_VEL_MIN, TTF_VEL_MAX);
  return estR(Math.round(TTF_INTRADAY_PRIOR_SEC * factor), 0, 'volume-velocity-prior');
}

// value family — trough→recovery duration proxy: nearer the floor (high proximity) ⇒ the cycle-up is
// nearer, so scale the multi-day prior mildly by (1.5 − proximity). Placeholder until the archive warms.
export function ttfValue(ctx = {}) {
  const vr = (ctx && ctx.valueRanges) || null;
  let factor = 1;
  if (vr && vr.hasData && num(vr.proximity) != null) factor = clamp(1.5 - vr.proximity, 0.5, 1.5);
  return estR(Math.round(TTF_MULTIDAY_PRIOR_SEC * factor), 0, 'multiday-prior');
}

// rising family — the forecast/regime horizon: a mid-reprice move plays out over multi-day. Prior-only.
export function ttfRising() {
  return estR(TTF_MULTIDAY_PRIOR_SEC, 0, 'regime-horizon-prior');
}

/* --- churn family (Step 6, decision A — Ben 2026-07-09) -------------------------------------------
   A buy-limit-cycle commodity is ranked PER LAP, not per unit: on these high-volume/low-price staples
   we ALWAYS max the buy limit, so the exact `limit` is a FACT (not the demoted ×windows/day gp/d
   extrapolation). P(fill) + TTF reuse the intraday family (same band-depth fill + volume-velocity TTF);
   the churn-specific part is `lapUnits` — the size of ONE lap — which estimateRank multiplies into the
   per-unit net so the rank reflects the LAP's after-tax net. lapUnits = min(limit, feasibleDepth):
   the buy limit, bounded by a feasible single-lap depth (volDay, so a `limit` bigger than the market
   trades in a day can't inflate it). NAMED PLACEHOLDER (rule 4): only ONE lap's limit sizing enters —
   the multi-window/day gp/d extrapolation stays DEAD. Missing limit → volume-bounded single lap. */
export function churnLapUnits(ctx = {}) {
  const c = ctx || {};
  const limit = num(c.limit), volDay = num(c.volDay);
  // A MEASURED zero means zero feasible depth, so the Math.max(1,…) floor takes it down to a one-unit
  // lap. Until 0.74.2 this read `volDay > 0 ? volDay : Infinity`, which handed a no-trade item its
  // ENTIRE buy limit as one lap — and estimateRank multiplies lapUnits straight into the rank, so the
  // escape was a rank multiplier, not a rounding error. Infinity remains correct for NULL (depth
  // unknown → the buy limit is the only bound we can honestly claim). See ttfIntraday's header for the
  // measured-zero vs unknown distinction; both escapes were the same bug.
  const feasible = (volDay != null) ? volDay : Infinity;
  if (limit != null && limit > 0) return Math.max(1, Math.min(limit, feasible));
  return (volDay != null && volDay > 0) ? volDay : 1;   // no known limit → a single volume-bounded lap
}

/* --- the registry (keyed by a spec's `estimator` family field) ------------------------------------ */
// `lapUnits` is OPTIONAL — only churn declares it; estimateRank multiplies the per-unit net by
// lapUnits(ctx) for the rank (families without it rank per unit, i.e. lapUnits ≡ 1 → byte-identical).
export const ESTIMATORS = Object.freeze({
  intraday:  { pFill: pFillIntraday,  ttf: ttfIntraday },
  value:     { pFill: pFillValue,     ttf: ttfValue },
  rising:    { pFill: pFillRising,    ttf: ttfRising },
  churn:     { pFill: pFillIntraday,  ttf: ttfIntraday,  lapUnits: churnLapUnits },
  // amplitude family (DT1b): measured WALK-FORWARD round-trip pFill (NOT the rejected circular
  // cycle-completion rate — see pFillAmplitude's header), hold-horizon ttf,
  // deployable-units lapUnits. Rank/grade/suggestions machinery carries amplitude unchanged.
  amplitude: { pFill: pFillAmplitude, ttf: ttfAmplitude, lapUnits: amplitudeLapUnits },
});
// @test-only: estimator-family list; flip-niches.mjs VALID_ESTIMATORS mirrors it and flip-niches.test.mjs cross-checks the two so a family-name drift bites.
export const ESTIMATOR_FAMILIES = Object.freeze(Object.keys(ESTIMATORS));

// estimatorFor(spec) → the { pFill, ttf } pair for a strategy spec. Degrades to the intraday family for
// an unknown/missing family (never throws) — flip-niches.mjs conformance separately pins the declared
// family to ESTIMATOR_FAMILIES so a typo is caught at test time, not silently defaulted in production.
export function estimatorFor(spec) {
  const key = spec && spec.estimator;
  return ESTIMATORS[key] || ESTIMATORS.intraday;
}

/* quotedPair(spec, row) → { bid, ask, basis } — the ONE price pair the thesis posts (the price-basis
   principle). Reads the computeQuote row's live quick pair or patient 2h band edges per the spec's
   `priceBasis`. 'term' (value) returns a null pair — the value surface computes its own floor→recovery
   pair off the term structure (renderValueMode), not off the row's clamped edges. */
export function quotedPair(spec, row = {}) {
  const basis = spec && spec.priceBasis;
  if (basis === 'quick') return { bid: row.quickBuy ?? null, ask: row.quickSell ?? null, basis: 'quick' };
  if (basis === 'term')  return { bid: null, ask: null, basis: 'term' };
  // A2 — amplitude posts daily-quantile trough/peak levels the surface computes itself (renderAmplitudeMode),
  // like 'term'; a null pair here means estimateRank isn't the amplitude rank path (the surface is).
  if (basis === 'daily') return { bid: null, ask: null, basis: 'daily' };
  return { bid: row.optBuy ?? null, ask: row.optSell ?? null, basis: 'opt' };   // 'opt' default — 2h band edges
}

/* rankScore({ net, pFill, ttfSec }) → the ONE ranking metric (Ben's 2026-07-09 ruling): expected
   after-tax net PER UNIT, discounted by fill probability, per DAY of capital tied up. PER-UNIT (not
   per-slot) deliberately: volume/slot-count is exactly the hand-wavy throughput assumption Ben rejected
   — the quoted pair is ONE bid/ask the thesis posts, so the metric is the value of that one lap. Missing
   inputs degrade (net→0, pFill→0, ttf→intraday prior).
   G5 (PLAN-GRADE-REWORK — Fix D): the TTF term SATURATES — speed = 1/(days + TTF_SAT_DAYS) instead of a
   raw 1/days floored at a minimum. TTF is the most-leveraged, LEAST-measured input (Flaw 5: in production
   it's always a prior, never a measured velocity), so an extreme near-zero TTF must not unboundedly
   inflate the rank. 1/(days + K) is still monotonically DECREASING in days (a slower flip never ranks
   higher) but BOUNDED as days→0 (→ 1/K), so a mirage tiny-TTF can't blow the rank up. K is a NAMED
   PLACEHOLDER (n≈0) — the saturation knee, not a tuned magnitude; G7/F1 calibrate it against real velocity. */
export function rankScore({ net, pFill, ttfSec } = {}) {
  const n = num(net) ?? 0;
  const p = clamp01(num(pFill) ?? 0);
  const days = Math.max(0, (num(ttfSec) ?? TTF_INTRADAY_PRIOR_SEC) / 86400);
  return n * p / (days + TTF_SAT_DAYS);
}

/* estimateRank(spec, row, extra) → { pair, net, pFill, ttf, rank } — the whole bundle a surface needs
   for one row. Builds the estimator ctx from the computeQuote row (band edges, momentum, regime, volume)
   plus any richer data the caller has (extra.reach / extra.velocity / extra.valueRanges — all null on
   screen/quote today, wired for when a surface fetches them). PURE; degrade-not-throw. */
export function estimateRank(spec, row = {}, extra = {}) {
  const pair = quotedPair(spec, row);
  // the ONE shared tax(); null when a price is missing. BOND exception rides through row.bond/row.guide
  // (computeQuote set them) so a bond's rank reflects the 10%-guide retrade fee + tax exemption, not a
  // phantom tax-only spread — else a ~0-spread bond could still rank/grade positive.
  const net = netMargin(pair.bid, pair.ask, row.bond ? { bond: true, guide: row.guide } : null);
  const est = estimatorFor(spec);
  const ctx = {
    bid: pair.bid, ask: pair.ask,
    quickBuy: row.quickBuy ?? null, quickSell: row.quickSell ?? null,
    optBuy: row.optBuy ?? null, optSell: row.optSell ?? null,
    bandLo: row.band ? (row.band.lo ?? null) : null, bandHi: row.band ? (row.band.hi ?? null) : null,
    mom: row.mom ?? null,
    regime: row.falling ? 'falling' : row.rising ? 'rising' : (row.regime && row.regime.ok ? 'flat' : null),
    reliable: row.reliable, volDay: row.volDay ?? null, limit: row.limit ?? null,
    reach: extra.reach ?? null, askReach: extra.askReach ?? null, velocity: extra.velocity ?? null, valueRanges: extra.valueRanges ?? null,
  };
  // P is a TWO-LEG fill prob (Proposal A): the family pFill (entry) discounted by the ASK/exit reach. No
  // askReach passed (quote/watch surfaces, value niche) → factor 1 → byte-identical rank. The discounted P
  // is what BOTH the rank AND the returned pFill report, so the displayed "P~X" now honestly means both legs.
  // PART II CHURN EXEMPTION (Ben 2026-07-12, spec.fillShape 'symmetric'): a buy-limit-cycle commodity
  // SELLS INTO CONTINUOUS TWO-SIDED FLOW near a tight band top — its exit does not need the day-HIGH to
  // print, and the day-level reach read (1h avg-high aggregates vs a tight 5m band top) systematically
  // mismeasures a small-margin band. The lap thesis is fill-every-lap, the anti-shape of the asymmetric
  // objective (§II.2 "a deep-flush bid is anti-churn") — so a 'symmetric' fillShape spec skips the
  // Proposal-A ask-reach discount entirely (and screen-flip-niches.mjs mirrors this for the REACH_GRADE_CAP letter).
  // EF1(b) (PLAN-ESTIMATOR-FIDELITY): the exemption is now PLACEMENT-BOUNDED — it holds only while the
  // quoted ask sits inside the daily-high distribution (extra.askPlacement ≤ MIRAGE_PLACEMENT, or no
  // placement read — symmetricExemptionHolds). An above-the-distribution churn ask (the Sapphire-bolts
  // mirage: ask at p100 reaching 1/14d yet ranked #1 at P~0.93) takes the standard askReachFactor
  // discount; a tight in-distribution lap (the Ancient-essence class AC5/AC6 fixed) keeps the exemption
  // byte-identically. Callers that pass no askPlacement (quote/watch/app Finder/amplitude) are unchanged.
  const pFillRaw = est.pFill(ctx);
  const symmetric = !!(spec && spec.fillShape === 'symmetric');
  const exemptionBounded = symmetric && !symmetricExemptionHolds(spec, extra.askPlacement);
  const askF = (symmetric && !exemptionBounded) ? 1 : askReachFactor(ctx.askReach);
  const pFill = askF < 1
    ? { value: clamp01(pFillRaw.value * askF), n: pFillRaw.n, basis: pFillRaw.basis + '×askreach' }
    : pFillRaw;
  const ttf = est.ttf(ctx);
  // Step 6 (churn): rank the LAP, not the unit — multiply the per-unit net by the family's lapUnits
  // (the exact buy limit, bounded by feasible depth). Families without lapUnits rank per unit (≡ 1), so
  // band/scalp/value/intraday are byte-identical. er.net stays PER-UNIT (the honest displayed margin).
  const lapUnits = est.lapUnits ? est.lapUnits(ctx) : 1;
  const rank = rankScore({ net: net * lapUnits, pFill: pFill.value, ttfSec: ttf.value });
  // EF1(a) (PLAN-ESTIMATOR-FIDELITY) — the DEAD-BID REPRICE ALTERNATIVE. When the ENTRY leg's P
  // collapses below DEADBID_PFILL_FLOOR on a REAL reach read (basis 'reach' — a prior/band-depth call
  // never fires this) while the SELL leg is scored (a real askReach read exists), the correct response
  // is to REPRICE the entry to the live crossable level (ctx.quickBuy — the transact-now buy) and
  // re-evaluate, not to bury the row (the Helm-of-neitiznot class: a dead band-low bid zeroed a row
  // whose ask reached 14/14d). `repriced` is a LABELED ALTERNATIVE beside the untouched headline
  // rank/pFill (R-1: nothing reorders on it until EF0(c) scores the band-low-bid class); the repriced
  // entry P re-runs the family estimator at the live bid with the (now-wrong-level) reach read dropped —
  // the honest band-depth "transact-now fills ~certainly" prior, breakdown honesty kept — then takes the
  // SAME (placement-bounded) ask-leg discount the headline takes. Null whenever the condition misses.
  let repriced = null;
  if (pFillRaw.basis === 'reach' && pFillRaw.value < DEADBID_PFILL_FLOOR
      && ctx.askReach && num(ctx.askReach.nDays) > 0 && num(ctx.askReach.reachedDays) != null
      && num(ctx.quickBuy) != null && num(pair.ask) != null && num(pair.bid) != null && ctx.quickBuy > pair.bid) {
    const liveBid = ctx.quickBuy;
    const pEntryR = est.pFill({ ...ctx, bid: liveBid, reach: null });
    const pR = clamp01(pEntryR.value * askF);
    const netR = netMargin(liveBid, pair.ask, row.bond ? { bond: true, guide: row.guide } : null);
    repriced = { bid: liveBid, ask: pair.ask, net: netR, pFill: pR,
      rank: rankScore({ net: netR * lapUnits, pFill: pR, ttfSec: ttf.value }) };
  }
  // EF1(c): the P LEG SPLIT — entry-family P and the ask-leg factor, so a surface can label WHICH leg
  // collapsed a near-zero product ("P~0.00 (bid leg)") instead of printing two contradictory P's.
  const pLegs = { entry: pFillRaw.value, askF };
  return { pair, net, pFill, ttf, rank, lapUnits, pLegs, exemptionBounded, repriced };
}

/* fmtTtf(sec) → compact "45m" / "2.5h" / "3d" for the honest rank rendering. */
export function fmtTtf(sec) {
  const s = num(sec);
  if (s == null) return '—';
  if (s < 2 * 3600) return Math.round(s / 60) + 'm';
  if (s < 2 * 86400) return (s / 3600).toFixed(1).replace(/\.0$/, '') + 'h';
  return (s / 86400).toFixed(1).replace(/\.0$/, '') + 'd';
}
