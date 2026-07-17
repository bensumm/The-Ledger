/**
 * estimators/sell-models/reach-fold.mjs (PC3, 2026-07-17) — the NEUTRAL sell-top model, extracted
 * verbatim from estimatePair's inline math. This is the DEFAULT + the always-on shadow: it is the
 * unbiased number the F1 retro co-logs on every pass (suggestions.jsonl estBuy/estSell/estConfidence),
 * whether it is the active display model or a shadow beside a non-neutral active (--est-sell pressure).
 *
 * THE SELL-MODEL CONTRACT (what every model in SELL_TOP_MODELS must honour — pressure.mjs + the future
 * safe-quantile.mjs obey the same shape):
 *   propose(ctx) → { estBuy, buyLo, estSell, sellHi, confidence }
 *     estBuy   — the proposed buy leg (raw, PRE-nudge/clamp). The model owns the BUY doctrine.
 *     buyLo    — the model's buy FLOOR for the shell's clamp. The shell ALWAYS ceils the buy at the
 *                live instabuy (qb) regardless — buyLo only lets a model widen the floor DOWN (pressure
 *                bids below the band low: buyLo = -Infinity). reach-fold floors at the band low.
 *     estSell  — the model's INTRINSIC sell proposal (raw, PRE-nudge/clamp). The shell overrides this
 *                with a declared thesis exit when one is passed (declared governs the sell leg for EVERY
 *                model — the operator's plan wins); the model never sees/handles declaredExit.
 *     sellHi   — the model's sell CEILING for the shell's clamp (Infinity = uncapped). The shell ALWAYS
 *                floors the sell at the live instasell (qs) regardless.
 *     confidence — the per-model evidence the cell/shadow render off: { bid, ask, relief, pressureExit }.
 *                The shell adds the model-free flags (beFloored, declaredAnchored, doctrine).
 *
 * NON-SKIPPABLE FLOORS a model CANNOT bypass (they live in the estimatePair SHELL, applied after propose):
 *   • the ORDERING clamps — buy ≤ live instabuy (qb), sell ≥ live instasell (qs). A model may only choose
 *     its OUTER bound (buyLo / sellHi); the inner live bound is the shell's and is non-negotiable.
 *   • the BE FLOOR — estSell is never emitted below breakEven(estBuy) (the ONE model-free honesty anchor).
 *   • the declared-exit anchor + the anchor round-number nudge (shell spine).
 * A model proposes a price; it can never propose its way past break-even or past the live book.
 *
 * PURE: imports only clamp (money-math). Every constant here is an unvalidated PLACEHOLDER (rule 4);
 * calibration is the F1 retro-join over the shadow fields. See js/estimators/pair.mjs for the shell.
 */
import { clamp } from '../../money-math.js';

const num = x => (typeof x === 'number' && Number.isFinite(x)) ? x : null;

// Reach saturation: an edge reached on ≥ this fraction of the (recent-3, else full) days is treated as
// FULLY reachable (fold factor 1 → the robust band edge stands); below it the edge folds linearly toward
// live. PLACEHOLDER (n≈3–14) — e.g. a recent 0/3 ⇒ fold 0 ⇒ the mirage top collapses fully to live.
export const EST_REACH_SAT_FRAC = 0.75;
// Reconciliation weights: the reach-folded band edge and each present secondary source (diurnal
// dip/peak level; asym high-reach ask) blend as an EQUAL-WEIGHT mean, clamped inside [live, band edge].
// Deliberately the simplest documented default — PLACEHOLDER, no calibrated weighting exists yet.
// @provisional-api: F1-pending placeholder — the est-blend weights each signal equally until the F1 retro sets real per-signal weights; exported so the choice is greppable and the retro can cite it.
export const EST_BLEND_EQUAL_WEIGHTS = true;

/* reachFoldModel — the neutral fold. estBUY is the per-strategy entry doctrine (scalp near-live / value
   trough / band reach-fold), blended with the diurnal dip. estSELL is the band top DISCOUNTED BY REACH
   (a mirage exit collapses toward live), softened + de-biased toward the observed 24h high by the
   liquidity/size relief (ctx.relief > 0 on a liquid book with a small position÷flow ratio; a thin book
   keeps the FULL discount byte-identically — the Ancient-godsword mirage guard), blended with the
   diurnal peak ask + the asym high-reach ask. All shared inputs (reads, doctrine, relief, topRef) are
   computed once by the shell and handed in via ctx. */
export const reachFoldModel = {
  name: 'reach-fold',
  // defaultShadow: this model RUNS + logs to suggestions.jsonl every pass (the unbiased retro co-log),
  // whether active or shadow. The resolver puts it in the `shadow` list whenever a non-neutral model is
  // active, so its number always reaches the ledger's estBuy/estSell/estConfidence slot.
  defaultShadow: true,
  propose(ctx) {
    const { qb, qs, ob, os, bidR, askR, doctrine, relief, sizeRatio, bandTop, topRef, extra } = ctx;
    const fold = f => f == null ? 1 : Math.min(1, f / EST_REACH_SAT_FRAC);   // absent read ⇒ 1 (no discount)
    // --- BUY: per-strategy entry doctrine (rev2) ---
    let estBuy, buyReach = bidR;   // buyReach ANNOTATES the buy cell (null for near-live)
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
    // --- SELL: reach-folded band top (declared-exit anchoring is the SHELL's job) ---
    // PLAN-LIQUIDITY-REACH Part A — the reach fold SOFTENS toward 1 (fold' = fold + relief×(1−fold)) on a
    // liquid book with a small position÷flow ratio; Part B (the de-biased topRef) is already folded into
    // ctx.topRef by the shell. Thin book / large size / absent ⇒ relief 0 ⇒ byte-identical to the flat fold.
    const f0 = fold(askR ? askR.frac : null);
    const fR = relief > 0 ? f0 + relief * (1 - f0) : f0;
    const sCands = [Math.round(qs + (topRef - qs) * fR)];
    const dAsk = extra.diurnal ? num(extra.diurnal.ask) : null;
    if (dAsk != null) sCands.push(Math.round(clamp(dAsk, qs, bandTop)));
    const aAsk = extra.asym ? num(extra.asym.highReachAsk) : null;
    if (aAsk != null) sCands.push(Math.round(clamp(aAsk, qs, bandTop)));
    const estSell = Math.round(sCands.reduce((s, x) => s + x, 0) / sCands.length);
    // surface the relief only when it had an EFFECT (a softened fold or a de-biased top) — lean discipline.
    let reliefApplied = null;
    if (relief > 0 && ((askR && f0 < 1) || topRef > bandTop))
      reliefApplied = { relief, sizeRatio, debiasedTop: topRef > bandTop ? topRef : null };
    return {
      estBuy, buyLo: Math.min(ob, qb),
      estSell, sellHi: topRef,
      confidence: {
        bid: buyReach ? { rec: buyReach.rec, full: buyReach.full, diverges: buyReach.diverges } : null,
        ask: askR ? { rec: askR.rec, full: askR.full, diverges: askR.diverges } : null,
        relief: reliefApplied,
        pressureExit: null,
      },
    };
  },
};
