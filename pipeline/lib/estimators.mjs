/**
 * estimators.mjs — per-thesis P(fill) + Time-to-Flip (TTF) estimators, and the ranking composite
 * that REPLACES the demoted `expGpDay` throughput metric (Pipeline v2, chunk P6b).
 *
 * WHY THIS EXISTS. Ben's 2026-07-09 ruling: "I despise gp/d as a metric; it makes so many
 * assumptions about fill speed and fill price… let's get something that's more accurate per thesis
 * and less hand wavey." `expGpDay` (min(limit×6, 10%×volDay) × modeNet — three compounding
 * unmeasured assumptions) is DEMOTED: it survives ONLY as the cheap pre-fetch pool orderer inside
 * gatecandidates.rankAndSlice (no fetch-semantics change) and as the 500k `--min-gpd` attention
 * pre-filter. It is NEVER again the displayed "best" number or the grade basis. The replacement,
 * ruled by Ben: **rank = net after tax × P(fill at the quoted prices) ÷ TTF**, evaluated PER THESIS.
 *
 * THE PRICE-BASIS PRINCIPLE (coordinator-ruled, Ben-vetoable). Every suggestion commits to ONE price
 * pair — the bid and ask the thesis itself would have Ben post — and net, P(fill) and TTF are all
 * evaluated at that SAME pair. Per thesis (see js/strategies.mjs `priceBasis`):
 *   spread → live quick pair (transact now); band/churn/scalp → 2h band edges; rising → near-current
 *   entry → forecast target (band edges are the best available forecast proxy today); value → durable
 *   floor entry → a recovery level the term structure says durably prints (NOT the raw ceiling).
 * The net is ALWAYS the ONE shared js/format.js `netMargin` (= (ask − tax(ask)) − bid) — no new tax.
 *
 * THREE ESTIMATOR FAMILIES (registry keyed by a spec's `estimator` field):
 *   intraday (band/spread/churn/scalp) — P(fill) from where the quoted bid sits in the live→2h-band
 *     span (reuses a real windowread reach read WHEN one is fetched; degrades to a band-depth heuristic
 *     on screen/quote, which do NOT fetch the 1h series — same discipline as reachValidator). TTF from
 *     intraday velocity (quoted size vs daily volume) around the intraday prior.
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
 * PURITY. DOM-free, fetch-free, fs-free ESM. Imports only the pure js/format.js helpers (the ONE
 * tax()/netMargin). Every ctx field is optional; every estimator degrades to an honest wide prior,
 * never throws. Lives in pipeline/lib/ (NOT js/) because its only consumers are pipeline surfaces
 * (screen.mjs, rating.mjs) — the app does not consume the rank fields (pipeline-only, no APP_VERSION).
 */
import { netMargin, clamp } from '../../js/format.js';

const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const num = x => (typeof x === 'number' && Number.isFinite(x)) ? x : null;
const estR = (value, n, basis) => ({ value, n, basis });

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
export const TTF_FLOOR_DAYS          = 1 / 24; // 1h min in the rank denominator — no divide-by-tiny blowup
export const RISING_PFILL_CONFIRMED  = 0.7;   // rising + not breaking down → entry near current fills readily
export const RISING_PFILL_UNCONFIRMED = 0.4;  // unconfirmed rising → the forecast entry is less certain

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
  let factor = 1;
  if (volDay != null && volDay > 0) factor = clamp(Math.sqrt(TTF_REF_VOL / volDay), TTF_VEL_MIN, TTF_VEL_MAX);
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

/* --- the registry (keyed by a spec's `estimator` family field) ------------------------------------ */
export const ESTIMATORS = Object.freeze({
  intraday: { pFill: pFillIntraday, ttf: ttfIntraday },
  value:    { pFill: pFillValue,    ttf: ttfValue },
  rising:   { pFill: pFillRising,   ttf: ttfRising },
});
export const ESTIMATOR_FAMILIES = Object.freeze(Object.keys(ESTIMATORS));

// estimatorFor(spec) → the { pFill, ttf } pair for a strategy spec. Degrades to the intraday family for
// an unknown/missing family (never throws) — strategies.mjs conformance separately pins the declared
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
  return { bid: row.optBuy ?? null, ask: row.optSell ?? null, basis: 'opt' };   // 'opt' default — 2h band edges
}

/* rankScore({ net, pFill, ttfSec }) → the ONE ranking metric (Ben's 2026-07-09 ruling): expected
   after-tax net PER UNIT, discounted by fill probability, per DAY of capital tied up. PER-UNIT (not
   per-slot) deliberately: volume/slot-count is exactly the hand-wavy throughput assumption Ben rejected
   — the quoted pair is ONE bid/ask the thesis posts, so the metric is the value of that one lap. Missing
   inputs degrade (net→0, pFill→0, ttf→intraday prior); the TTF floor stops a divide-by-tiny blowup. */
export function rankScore({ net, pFill, ttfSec } = {}) {
  const n = num(net) ?? 0;
  const p = clamp01(num(pFill) ?? 0);
  const days = Math.max(TTF_FLOOR_DAYS, (num(ttfSec) ?? TTF_INTRADAY_PRIOR_SEC) / 86400);
  return n * p / days;
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
    reach: extra.reach ?? null, velocity: extra.velocity ?? null, valueRanges: extra.valueRanges ?? null,
  };
  const pFill = est.pFill(ctx);
  const ttf = est.ttf(ctx);
  const rank = rankScore({ net, pFill: pFill.value, ttfSec: ttf.value });
  return { pair, net, pFill, ttf, rank };
}

/* fmtTtf(sec) → compact "45m" / "2.5h" / "3d" for the honest rank rendering. */
export function fmtTtf(sec) {
  const s = num(sec);
  if (s == null) return '—';
  if (s < 2 * 3600) return Math.round(s / 60) + 'm';
  if (s < 2 * 86400) return (s / 3600).toFixed(1).replace(/\.0$/, '') + 'h';
  return (s / 86400).toFixed(1).replace(/\.0$/, '') + 'd';
}
