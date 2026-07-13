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
 * ESTIMATOR FAMILIES (registry keyed by a spec's `estimator` field):
 *   churn — P(fill)/TTF reuse the intraday family, but the rank is PER LAP: `lapUnits` (the exact buy
 *     limit, bounded by feasible depth) multiplies the per-unit net, because on a buy-limit-cycle
 *     commodity we always max the limit so the lap size is a fact (Step 6, Ben 2026-07-09, decision A).
 *   intraday (band/scalp) — P(fill) from where the quoted bid sits in the live→2h-band
 *     span (reuses a real windowread reach read WHEN one is fetched; degrades to a band-depth heuristic
 *     on screen/quote, which do NOT fetch the 1h series — same discipline as reachValidator). TTF from
 *     intraday velocity (quoted size vs daily volume) around the intraday prior. NOTE (2026-07-09, Step 1):
 *     screen.mjs NOW fetches the 1h series for surfaced SURVIVORS, so it passes a REAL bid-side reach read
 *     via `extra.reach` on the screen surface — P(fill) there is the reach fraction, not the band-depth
 *     prior. quote.mjs still fetches no 1h series → it keeps the honest band-depth/prior degrade.
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
 * tax()/netMargin) plus js/quotecore.js's breakEven (itself pure, format.js-only — no cycle: quotecore
 * does not import this module). Every ctx field is optional; every estimator degrades to an honest wide prior,
 * never throws. Lives in js/ (2026-07-10 — moved out of pipeline/lib/) as the ONE shared home so the
 * app can rank/grade on it too (the app↔console parity boundary — shared logic in js/, node re-imports
 * via the pipeline/lib/estimators.mjs re-export shim, byte-identical). The Finder wiring is AP4.
 */
import { netMargin, clamp, fmtP } from './format.js';
import { breakEven } from './quotecore.js';   // PLAN-OUTPUT-TABLE: the ONE model-free break-even (BE floor for estSell)
import { RECENCY_DIVERGE } from './windowread.mjs';   // PLAN-OUTPUT-TABLE rev1: reuse the RC1 recent-vs-full divergence threshold (windowread is a leaf — no import cycle)

const clamp01 = x => clamp(x, 0, 1);   // reuse the imported clamp — was a duplicate reimplementation
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
export const PFILL_ASKREACH_FLOOR    = 0.25;  // two-leg P (Proposal A, PLAN-GRADE-REACH): a flip only "fills"
                                              // if BOTH legs transact, so the family bid-fill P is discounted by
                                              // how often the ASK/exit reaches ACROSS DAYS. A 0/14-reach exit
                                              // floors the weight HERE (not to 0) so a stale fortnight demotes a
                                              // large-net item hard without zeroing it — SOFT by design
                                              // (rule 4: n≈14 per item, F1/retrojoin calibrates the magnitude).

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

// two-leg fill weight (Proposal A, PLAN-GRADE-REACH) — the family pFill above is the BID/ENTRY fill; the
// rank's `net` silently ASSUMES the exit at optSell prints. Discount that by the cross-day ASK reach so a
// mirage exit (e.g. a p90 band top reaching 2/14 days) can't carry a full rank. ABSENT an ask-reach read →
// 1 (byte-identical to the pre-askReach rank). Softened linear map: reachFrac 0 → PFILL_ASKREACH_FLOOR,
// 1 → 1 — a stale fortnight demotes, never zeroes (the false-negative guard for the n≈14 window).
export function askReachFactor(askReach) {
  const a = askReach || null;
  if (!a || !(num(a.nDays) > 0) || num(a.reachedDays) == null) return 1;
  const frac = clamp01(a.reachedDays / a.nDays);
  return clamp01(PFILL_ASKREACH_FLOOR + (1 - PFILL_ASKREACH_FLOOR) * frac);
}

/* --- asymmetric fill-shape estimate (PART II, PLAN-GRADE-REACH §II.1 — deep-buy / reliable-sell) ---
   Ben's mandate: "I'd much rather hit a 2/14 buy and a 12/14 sell than 50/50 both sides." The
   asymmetric rank re-targets the objective at the pair js/windowread.mjs asymPair derives (deep flush
   bid → high-reach ask, day-level quantiles) instead of the symmetric intraday p10/p90 band pair:
       asymRank = net(deepBid → highReachAsk) × P_ask ÷ TTF
   THE KEY NUANCE — P_bid NEVER multiplies the rank. A rare deep fill is a FEATURE (deeper entry =
   larger net, and the bigger net already carries that value); punishing a low bid-reach would re-punish
   exactly the entry the shape wants. P_bid is returned as an annotation ("fills ~N/14 — rest it as
   optionality", the patience-on-cancel-and-cut doctrine), never a weight. P_ask IS the fill weight —
   the exit is the flip's big assumption (Part I's whole diagnosis).
   ORDERING GUARDS (§II.2): the pair returned keeps bid ≤ quickBuy and ask ≥ quickSell (the min/max
   guards), so a quoted asym pair can never break optBuy ≤ quickBuy ≤ quickSell ≤ optSell. When the ask
   guard BINDS (live instabuy above the high-reach level) the exit is a transact-now sell, so the
   reported pAsk (measured at the unguarded quantile) is a floor, not exact — documented, not patched
   (F1 calibrates). The momentum tell (rawBandLo/rawBandHi) is quotecore's and is untouched here.
   STATUS (§II.3): SHIP-SAFE half = display + shadow-log this estimate (screen/quote inform lines +
   the suggestions.jsonl `asym` field). The repricing/sort flip is F1-GATED behind screen.mjs --asym
   (OFF by default). ASYM_P_LO/ASYM_P_HI (windowread) are PLACEHOLDERS, n≈14 (rule 4). */
export function asymEstimate(spec, row = {}, asym = null) {
  if (!asym || num(asym.deepBid) == null || num(asym.highReachAsk) == null) return null;
  const bid = num(row.quickBuy) != null ? Math.min(row.quickBuy, asym.deepBid) : asym.deepBid;
  const ask = num(row.quickSell) != null ? Math.max(row.quickSell, asym.highReachAsk) : asym.highReachAsk;
  // the ONE shared netMargin; BOND exception rides through row.bond/row.guide exactly like estimateRank.
  const net = netMargin(bid, ask, row.bond ? { bond: true, guide: row.guide } : null);
  const ttf = estimatorFor(spec).ttf({ volDay: row.volDay ?? null });
  const pAsk = clamp01(num(asym.pAsk) ?? 0);
  const pBid = clamp01(num(asym.pBid) ?? 0);
  return { bid, ask, net, pAsk, pBid, nDays: asym.nDays ?? null, ttf, rank: rankScore({ net, pFill: pAsk, ttfSec: ttf.value }) };
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
  const feasible = (volDay != null && volDay > 0) ? volDay : Infinity;
  if (limit != null && limit > 0) return Math.max(1, Math.min(limit, feasible));
  return (volDay != null && volDay > 0) ? volDay : 1;   // no known limit → a single volume-bounded lap
}

/* --- the registry (keyed by a spec's `estimator` family field) ------------------------------------ */
// `lapUnits` is OPTIONAL — only churn declares it; estimateRank multiplies the per-unit net by
// lapUnits(ctx) for the rank (families without it rank per unit, i.e. lapUnits ≡ 1 → byte-identical).
export const ESTIMATORS = Object.freeze({
  intraday: { pFill: pFillIntraday, ttf: ttfIntraday },
  value:    { pFill: pFillValue,    ttf: ttfValue },
  rising:   { pFill: pFillRising,   ttf: ttfRising },
  churn:    { pFill: pFillIntraday, ttf: ttfIntraday, lapUnits: churnLapUnits },
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
  // Proposal-A ask-reach discount entirely (and screen.mjs mirrors this for the REACH_GRADE_CAP letter).
  const pFillRaw = est.pFill(ctx);
  const askF = (spec && spec.fillShape === 'symmetric') ? 1 : askReachFactor(ctx.askReach);
  const pFill = askF < 1
    ? { value: clamp01(pFillRaw.value * askF), n: pFillRaw.n, basis: pFillRaw.basis + '×askreach' }
    : pFillRaw;
  const ttf = est.ttf(ctx);
  // Step 6 (churn): rank the LAP, not the unit — multiply the per-unit net by the family's lapUnits
  // (the exact buy limit, bounded by feasible depth). Families without lapUnits rank per unit (≡ 1), so
  // band/scalp/value/intraday are byte-identical. er.net stays PER-UNIT (the honest displayed margin).
  const lapUnits = est.lapUnits ? est.lapUnits(ctx) : 1;
  const rank = rankScore({ net: net * lapUnits, pFill: pFill.value, ttfSec: ttf.value });
  return { pair, net, pFill, ttf, rank, lapUnits };
}

/* fmtTtf(sec) → compact "45m" / "2.5h" / "3d" for the honest rank rendering. */
export function fmtTtf(sec) {
  const s = num(sec);
  if (s == null) return '—';
  if (s < 2 * 3600) return Math.round(s / 60) + 'm';
  if (s < 2 * 86400) return (s / 3600).toFixed(1).replace(/\.0$/, '') + 'h';
  return (s / 86400).toFixed(1).replace(/\.0$/, '') + 'd';
}

/* ============================================================================================
   PLAN-OUTPUT-TABLE (2026-07-13, + REVISIONS same day) — the RECONCILIATION ESTIMATOR: Est. buy / Est. sell.
   THE MOTIVE (Ben): the table's Quick + Optimistic cells are two theoretical, model-free pairs the
   operator reconciles BY HAND into the one number he posts (Optimistic ∩ diurnal ∩ reach ∩ anchor ∩
   BE-floor, synthesized every pass). estimatePair promotes that synthesis into first-class numbers.

   estSELL — the price you'll ACTUALLY clear at:
     • DECLARED-EXIT-ANCHORED (rev2, thesis-aware): when `extra.declaredExit` is passed, estSell anchors
       to THAT — the operator's stated target governs, NOT the generic band top (and it may sit ABOVE the
       band top, so it is NOT ceiling-clamped to the band — only floored to live + break-even). CALLER
       CONTRACT (FIX 1, 2026-07-13): a declared exit is a HELD-LOT sell plan, so a caller passes
       `declaredExit` ONLY for an item it actually HOLDS (an open lot in positions.json). The pure
       DISCOVERY screen (screen.mjs band/churn/value) NEVER passes it — a bare candidate is a buy read,
       not a held lot; anchoring it would inflate its Est. sell/net off a plan that doesn't apply.
     • else the band top DISCOUNTED BY REACH so a mirage exit collapses toward the live instabuy, blended
       with the diurnal peak ask + the asymPair high-reach ask.
     • BE-FLOORED always (never < breakEven — the ONE model-free honesty anchor; the floor binding IS the
       estimate saying "no trade").

   estBUY — STRATEGY-AWARE (rev2, `entryDoctrine(spec)` off EXISTING spec fields, no new field):
     • scalp (falling:'accept') → NEAR-LIVE: a deliberate intraday flip bids at the live instasell to
       FILL — the band low is not its entry (it accepts a falling tape and wants the fill).
     • value (priceBasis:'term') → TROUGH: a buy-hold bids the durable floor (the band low proxy), never
       folded toward live — a value entry wants the low, not a quick fill.
     • band/churn (priceBasis:'opt', falling:'exclude') → REACH-FOLD: the band low folded toward live by
       how rarely it TOUCHES, blended with the diurnal dip bid (the original behaviour).
   The asymPair DEEP bid is NEVER folded into estBuy (rev3) — DERIVED FROM THE STRATEGY MODEL: no
   strategy posts a ~4/14-flush deep bid as its EXPECTED entry (scalp bids to fill, value bids the floor,
   band ladders the low). A deep flush bid is rest-and-see OPTIONALITY, so it stays the separate `◆ asym`
   line, never inside an expected-price number.

   CONFIDENCE (rev1) — carried WITH the price as the RECENT-3 reach idiom, not the full window: the
   godsword read `2/14` fine but its RECENT reach was `0/3` = the mirage. Recent-3 (`recencySplit`,
   already computed) is the freshness-honest signal AND the fold basis; the full window is the
   sample-size backstop, shown BESIDE it only when the two DIVERGE (`0/3 · 2/14` — that divergence is the
   stale flag). The `(live)` span-0 fallback is dropped.

   CONSOLE-ONLY consumer set today (screen.mjs / quote.mjs stdout — --raw restores Quick/Optimistic);
   the app Finder/screen.json never call this → no APP_VERSION bump. PURE over the already-computed
   row/ctx — ZERO new fetch; every missing input degrades to the model-free edge (absent evidence ⇒ no
   discount, the askReachFactor absent→1 precedent). Quoted momentum tell, break-even, ordering
   invariant, and the value q15/q85 twin are all untouched.
   HONESTY (rule 4): EVERY constant/weight/per-strategy placement below is a NAMED PLACEHOLDER, n≈14 per
   item at best; the F1 retro-join (estBuy/estSell/estConfidence shadow fields on suggestions.jsonl) owns
   calibration.
   ============================================================================================ */
// Reach saturation: an edge reached on ≥ this fraction of the (recent-3, else full) days is treated as
// FULLY reachable (fold factor 1 → the robust band edge stands); below it the edge folds linearly toward
// live. PLACEHOLDER (n≈3–14) — e.g. a recent 0/3 ⇒ fold 0 ⇒ the mirage top collapses fully to live.
export const EST_REACH_SAT_FRAC = 0.75;
// Reconciliation weights: the reach-folded band edge and each present secondary source (diurnal
// dip/peak level; asym high-reach ask) blend as an EQUAL-WEIGHT mean, clamped inside [live, band edge].
// Deliberately the simplest documented default — PLACEHOLDER, no calibrated weighting exists yet.
export const EST_BLEND_EQUAL_WEIGHTS = true;   // (named so the placeholder choice is greppable/citable)
// The estimated-pair column set (shared by screen.mjs/quote.mjs so the header row can't drift).
export const EST_HEADERS = ['Est. buy', 'Est. sell', 'Net/u (ROI)', 'BE'];

/* entryDoctrine(spec) → 'near-live' | 'trough' | 'reach-fold' — the per-strategy ENTRY placement
   (rev2). DERIVED from existing spec fields so no new declarative field is added (and the app-parity
   registry stays untouched): a faller-ACCEPTING thesis (scalp) bids to fill (near-live); a term-basis
   thesis (value) bids the durable floor (trough); everything else (band/churn, opt basis) reach-folds.
   PLACEHOLDER mapping — F1 calibrates each niche's real entry aggression. */
export function entryDoctrine(spec) {
  if (spec && spec.falling === 'accept') return 'near-live';   // scalp — a deliberate flip bids to FILL
  if (spec && spec.priceBasis === 'term') return 'trough';     // value — a buy-hold bids the durable floor
  return 'reach-fold';                                         // band/churn — the original reach-folded edge
}

/* reachRead({ reachedDays, nDays, recentHit, recentDays }) → { frac, rec, full, diverges } | null.
   rev1: the FOLD basis is the RECENT-3 fraction when scored (freshness-honest), else the full window
   (the sample-size backstop). `diverges` reuses windowread's RECENCY_DIVERGE + its zero-recent clause. */
function reachRead(r) {
  if (!r) return null;
  const full = (num(r.nDays) > 0 && num(r.reachedDays) != null) ? { hit: r.reachedDays, days: r.nDays, frac: clamp01(r.reachedDays / r.nDays) } : null;
  const rec  = (num(r.recentDays) > 0 && num(r.recentHit) != null) ? { hit: r.recentHit, days: r.recentDays, frac: clamp01(r.recentHit / r.recentDays) } : null;
  if (!full && !rec) return null;
  const frac = rec ? rec.frac : full.frac;   // recent-3 IS the confidence; full is only the backstop
  const diverges = !!(rec && full && (Math.abs(rec.frac - full.frac) >= RECENCY_DIVERGE || (rec.hit === 0 && full.hit > 0 && full.frac >= 0.2)));
  return { frac, rec, full, diverges };
}

/* estimatePair(spec, row, extra, { nudge }) → { estBuy, estSell, estNet, estRoi, be, confidence } | null.
   extra (ALL optional — zero new fetch; the caller passes only what it already computed):
     bidReach  { reachedDays, nDays, recentHit?, recentDays? }  patient bid TOUCH counts (full + recent-3)
     askReach  { reachedDays, nDays, recentHit?, recentDays? }  patient ask REACH counts (full + recent-3)
     diurnal   { bid, ask }        deriveDiurnalRange's dip/peak-window levels
     asym      { highReachAsk }    asymPair's near-certain exit level (deepBid is NEVER consumed — rev3)
     declaredExit  number|null     the lot's declared thesis exit (hold-thesis.json) — anchors estSell
   nudge: optional (side, price) → { price }|null — the ⚓ anchor round-number nudge (pipeline passes
   modules/anchor.mjs anchorNudge; injected so this module stays pure/app-importable). Final pricing step.
   `spec` drives the per-strategy entry doctrine (rev2). Returns null when there is no live pair. */
export function estimatePair(spec, row = {}, extra = {}, { nudge = null } = {}) {
  const qb = num(row.quickBuy), qs = num(row.quickSell);
  if (qb == null || qs == null) return null;                    // no live pair → no estimate (degrade)
  const ob = num(row.optBuy) ?? qb, os = num(row.optSell) ?? qs;
  const bidR = reachRead(extra.bidReach), askR = reachRead(extra.askReach);
  const fold = f => f == null ? 1 : Math.min(1, f / EST_REACH_SAT_FRAC);   // absent read ⇒ 1 (no discount)
  const doctrine = entryDoctrine(spec);
  // --- BUY: per-strategy entry doctrine (rev2) ---
  let estBuy, buyReach = bidR;   // buyReach = the reach read that ANNOTATES the buy cell (null for near-live)
  if (doctrine === 'near-live') {
    estBuy = qb;                 // scalp bids the live instasell to FILL — the band-low reach doesn't apply
    buyReach = null;             // a live bid needs no cross-day touch caveat
  } else {
    // trough (value) anchors the band-low WITHOUT folding toward live; reach-fold (band/churn) folds it.
    const anchor = doctrine === 'trough' ? ob : Math.round(qb - (qb - ob) * fold(bidR ? bidR.frac : null));
    const bCands = [anchor];
    const dBid = extra.diurnal ? num(extra.diurnal.bid) : null;
    if (dBid != null) bCands.push(Math.round(clamp(dBid, Math.min(ob, qb), qb)));
    estBuy = Math.round(bCands.reduce((s, x) => s + x, 0) / bCands.length);
  }
  // --- SELL: declared-exit-anchored (thesis-aware, rev2) OR reach-folded band top ---
  const declared = num(extra.declaredExit);
  let estSell, declaredAnchored = false;
  if (declared != null && declared > 0) {
    estSell = declared;          // the operator's stated target governs — NOT ceiling-clamped to the band
    declaredAnchored = true;
  } else {
    const sCands = [Math.round(qs + (os - qs) * fold(askR ? askR.frac : null))];
    const dAsk = extra.diurnal ? num(extra.diurnal.ask) : null;
    if (dAsk != null) sCands.push(Math.round(clamp(dAsk, qs, Math.max(os, qs))));
    const aAsk = extra.asym ? num(extra.asym.highReachAsk) : null;
    if (aAsk != null) sCands.push(Math.round(clamp(aAsk, qs, Math.max(os, qs))));
    estSell = Math.round(sCands.reduce((s, x) => s + x, 0) / sCands.length);
  }
  // ⚓ anchor nudge (final step — nudge, never override), then re-clamp.
  if (typeof nudge === 'function') {
    const nb = nudge('bid', estBuy); if (nb && num(nb.price) != null) estBuy = nb.price;
    const na = nudge('ask', estSell); if (na && num(na.price) != null) estSell = na.price;
  }
  estBuy = Math.round(clamp(estBuy, Math.min(ob, qb), qb));
  // a declared exit is floored to live (never below the live instabuy), but not ceiling-clamped to the band.
  estSell = declaredAnchored ? Math.max(Math.round(estSell), qs) : Math.round(clamp(estSell, qs, Math.max(os, qs)));
  // BE floor — MODEL-FREE and applied LAST: never emit estSell < breakEven(estBuy). The floor binding
  // is the estimate self-reporting "no profitable trade at model prices" (estNet collapses to ~0).
  const bopt = row.bond ? { bond: true, guide: row.guide } : undefined;
  const be = breakEven(estBuy, bopt);
  const beFloored = estSell < be;
  if (beFloored) estSell = be;
  const estNet = netMargin(estBuy, estSell, bopt);
  const estRoi = (estNet != null && estBuy > 0) ? estNet / estBuy * 100 : null;
  const confidence = {
    bid: buyReach ? { rec: buyReach.rec, full: buyReach.full, diverges: buyReach.diverges } : null,
    ask: (!declaredAnchored && askR) ? { rec: askR.rec, full: askR.full, diverges: askR.diverges } : null,
    beFloored, declaredAnchored, doctrine,
  };
  return { estBuy, estSell, estNet, estRoi, be, confidence };
}

// compact reach token (rev1) — the RECENT-3 fraction is PRIMARY; the full window is appended only when
// the two DIVERGE (`0/3 · 2/14`). Recent-3 absent (thin) ⇒ the full window alone; no read ⇒ '–'.
const fracTok = f => f ? `${f.hit}/${f.days}` : null;
function reachTok(info) {
  if (!info) return '–';
  const recT = fracTok(info.rec), fullT = fracTok(info.full);
  if (recT && info.diverges && fullT) return `${recT} · ${fullT}`;   // divergence → show both (the stale flag)
  return recT || fullT || '–';                                       // recent-3 primary; full is the backstop
}

/* estPairCells(est) → the four structured {t, c} cells for the EST_HEADERS columns (screen + quote
   render from this ONE builder so the cell text can't drift). Confidence rides IN the price cells
   (Ben's rule): buy carries its touch fraction (recent-3 primary), sell its reach fraction OR a
   `(declared)` marker when anchored to a thesis exit; a bound BE floor is named on the sell cell
   (amber) — that row's estimate is saying "no trade at model prices". */
export function estPairCells(est) {
  if (!est) return [{ t: '—' }, { t: '—' }, { t: '—' }, { t: '—' }];
  const c = est.confidence;
  let sellSuffix;
  if (c.beFloored) sellSuffix = ` (BE-floored${c.ask ? `, ${reachTok(c.ask)}` : ''})`;
  else if (c.declaredAnchored) sellSuffix = ' (declared)';
  else sellSuffix = ` (${reachTok(c.ask)})`;
  const netTxt = est.estNet == null ? '—'
    : `${est.estNet > 0 ? '+' : ''}${fmtP(est.estNet)} (${est.estRoi != null ? (est.estRoi >= 0 ? '+' : '') + est.estRoi.toFixed(1) + '%' : '—'})`;
  return [
    { t: `${fmtP(est.estBuy)} (${reachTok(c.bid)})` },
    { t: `${fmtP(est.estSell)}${sellSuffix}`, c: c.beFloored ? 'amber' : (c.declaredAnchored ? 'gain' : undefined) },
    { t: netTxt, c: est.estNet == null ? undefined : (est.estNet >= 0 ? 'gain' : 'loss') },
    { t: fmtP(est.be), c: 'mini' },
  ];
}

/* estConfLean(est) → the lean suggestions.jsonl shadow object (F1 retro-join input) or null.
   Numbers, not strings, so the join can score "did estSell predict the realized sell" directly. Carries
   BOTH the recent-3 and full-window counts (rev1) + the entry doctrine + declared/BE flags. Lean
   discipline (YS2): a field is present only when there is evidence behind it. */
export function estConfLean(est) {
  if (!est) return null;
  const c = est.confidence, o = {};
  if (c.ask) { if (c.ask.rec) { o.askRecHit = c.ask.rec.hit; o.askRecDays = c.ask.rec.days; } if (c.ask.full) { o.askHit = c.ask.full.hit; o.askDays = c.ask.full.days; } }
  if (c.bid) { if (c.bid.rec) { o.bidRecHit = c.bid.rec.hit; o.bidRecDays = c.bid.rec.days; } if (c.bid.full) { o.bidHit = c.bid.full.hit; o.bidDays = c.bid.full.days; } }
  if (c.declaredAnchored) o.declaredAnchored = true;
  if (c.beFloored) o.beFloored = true;
  if (c.doctrine && c.doctrine !== 'reach-fold') o.doctrine = c.doctrine;
  return Object.keys(o).length ? o : null;
}
