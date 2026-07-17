/**
 * estimators/pair.mjs (PC2, 2026-07-17) — the RECONCILIATION PRICE ESTIMATOR (Est. buy / Est. sell),
 * split out of the estimator monolith: entryDoctrine, reachRead (internal), estimatePair + its EST_*
 * constants. estimatePair is the ordering SPINE (per-strategy entry → reach-fold / declared-exit sell →
 * pressure override → anchor nudge → ordering clamps → BE floor LAST); the render cells that consume its
 * output live in ./cells.mjs. PURE: imports the money-math helpers, quotecore's breakEven (the ONE
 * model-free BE floor), windowread's RECENCY_DIVERGE (a leaf), and reach.mjs's reachRelief +
 * REACH_DEBIAS_MAX_FRAC. See the js/estimators.mjs barrel header for the full doctrine; every constant
 * here is an unvalidated PLACEHOLDER (rule 4).
 */
import { netMargin, clamp } from '../money-math.js';
import { breakEven } from '../quotecore.js';   // PLAN-OUTPUT-TABLE: the ONE model-free break-even (BE floor for estSell)
import { RECENCY_DIVERGE } from '../windowread.mjs';   // PLAN-OUTPUT-TABLE rev1: reuse the RC1 recent-vs-full divergence threshold (windowread is a leaf — no import cycle)
import { reachRelief, REACH_DEBIAS_MAX_FRAC } from './reach.mjs';   // PC2: liquidity/size relief + the Part-B de-bias cap

const clamp01 = x => clamp(x, 0, 1);   // reuse the imported clamp — was a duplicate reimplementation
const num = x => (typeof x === 'number' && Number.isFinite(x)) ? x : null;

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
       DISCOVERY screen (screen-flip-niches.mjs band/churn/value) NEVER passes it — a bare candidate is a buy read,
       not a held lot; anchoring it would inflate its Est. sell/net off a plan that doesn't apply.
     • else the band top DISCOUNTED BY REACH so a mirage exit collapses toward the live instabuy, blended
       with the diurnal peak ask + the asymPair high-reach ask. PLAN-LIQUIDITY-REACH (2026-07-13): the
       fold is liquidity/size-CONDITIONED — reachRelief softens it (and de-biases the top toward the
       observed 24h high, extra.dayHigh) ONLY on a liquid book with a small position÷flow ratio; a thin
       book keeps the FULL discount byte-identically (the mirage guard is the mechanism's reason to exist).
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

   CONSOLE-ONLY consumer set today (screen-flip-niches.mjs / quote-items.mjs stdout — --raw restores Quick/Optimistic);
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
// PB4 (PLAN-DEPTH-EXIT PB4 / PLAN-REACHABILITY-CONSOLIDATION): the reliability at/above which the
// pressure-exit ask may exceed the observed 24h high (the ruled reliability-gated peak-cap decision).
// reachableBand's reliability saturates to 1 on a liquid, well-sampled book; below it the dayHigh cap
// binds (the thin-book mirage guard). PLACEHOLDER (n≈0) — F1 owns whether/where this relaxes.
export const PRESSURE_EXIT_REL_FULL = 1;
// Reconciliation weights: the reach-folded band edge and each present secondary source (diurnal
// dip/peak level; asym high-reach ask) blend as an EQUAL-WEIGHT mean, clamped inside [live, band edge].
// Deliberately the simplest documented default — PLACEHOLDER, no calibrated weighting exists yet.
// @provisional-api: F1-pending placeholder — the est-blend weights each signal equally until the F1 retro sets real per-signal weights; exported so the choice is greppable and the retro can cite it.
export const EST_BLEND_EQUAL_WEIGHTS = true;

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
     dayHigh   number|null         PLAN-LIQUIDITY-REACH Part B: the observed trailing-24h high (the
                                   caller's dayHighFrom5m over its in-hand 5m series — the least-smoothed
                                   high the wiki exposes). With a positive liquidity/size relief the SELL
                                   top reference widens toward it (never above it); thin book / large
                                   size / absent → the band top stands byte-identically.
   nudge: optional (side, price) → { price }|null — the ⚓ anchor round-number nudge (pipeline passes
   modules/anchor.mjs anchorNudge; injected so this module stays pure/app-importable). Final pricing step.
   `spec` drives the per-strategy entry doctrine (rev2). Returns null when there is no live pair. */
export function estimatePair(spec, row = {}, extra = {}, { nudge = null, pressureExit = false } = {}) {
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
  // PLAN-LIQUIDITY-REACH (2026-07-13, ASK side only): on a LIQUID book where the position is small vs
  // flow (reachRelief > 0 — intendedUnits = the real held lot size on a positions surface, else the buy
  // limit proxy — the per-surface PLACEHOLDER deciding point):
  //   Part A — the reach fold SOFTENS toward 1 (fold' = fold + relief×(1−fold)): depth clears a small
  //     position at the top more readily than raw reach-frequency implies.
  //   Part B — the top REFERENCE de-biases from the smoothed band top toward extra.dayHigh (the observed
  //     trailing-24h 5m-bucket max — avgHighPrice averaging hides the peaks a resting LIMIT ask fills
  //     at), by REACH_DEBIAS_MAX_FRAC×relief of the gap, NEVER above dayHigh (the real ceiling).
  // THE MIRAGE GUARD IS UNTOUCHED: a thin book / large size / absent inputs ⇒ relief 0 ⇒ this whole
  // block is byte-identical to the flat fold (the Ancient-godsword protection). PLACEHOLDERS, n=1.
  // intendedUnits: a held-lot surface passes the REAL lot size (extra.intendedUnits — positions.json qty);
  // absent it (a discovery/per-item read with no held qty) we degrade to the buy limit, the standard
  // per-window accumulation proxy — byte-identical to the pre-override behaviour.
  const iu = num(extra.intendedUnits);
  const intendedUnits = iu != null ? iu : num(row.limit);
  const relief = reachRelief({ intendedUnits, volDay: num(row.volDay) });
  const sizeRatio = (intendedUnits != null && num(row.volDay) > 0) ? intendedUnits / row.volDay : null;
  const bandTop = Math.max(os, qs);
  const dayHi = num(extra.dayHigh);
  const topRef = (relief > 0 && dayHi != null && dayHi > bandTop)
    ? Math.min(dayHi, Math.round(bandTop + REACH_DEBIAS_MAX_FRAC * relief * (dayHi - bandTop)))
    : bandTop;
  const declared = num(extra.declaredExit);
  let estSell, declaredAnchored = false, reliefApplied = null;
  if (declared != null && declared > 0) {
    estSell = declared;          // the operator's stated target governs — NOT ceiling-clamped to the band
    declaredAnchored = true;
  } else {
    const f0 = fold(askR ? askR.frac : null);
    const fR = relief > 0 ? f0 + relief * (1 - f0) : f0;
    const sCands = [Math.round(qs + (topRef - qs) * fR)];
    const dAsk = extra.diurnal ? num(extra.diurnal.ask) : null;
    if (dAsk != null) sCands.push(Math.round(clamp(dAsk, qs, bandTop)));
    const aAsk = extra.asym ? num(extra.asym.highReachAsk) : null;
    if (aAsk != null) sCands.push(Math.round(clamp(aAsk, qs, bandTop)));
    estSell = Math.round(sCands.reduce((s, x) => s + x, 0) / sCands.length);
    // surface the relief only when it had an EFFECT (a softened fold or a de-biased top) — lean discipline.
    if (relief > 0 && ((askR && f0 < 1) || topRef > bandTop))
      reliefApplied = { relief, sizeRatio, debiasedTop: topRef > bandTop ? topRef : null };
  }
  // PB4 (PLAN-DEPTH-EXIT/PLAN-REACHABILITY-CONSOLIDATION) — the pressure-exit TRIAL override. When the
  // caller sets pressureExit AND passes a non-null reachableBand (extra.reachable), the pressure-driven
  // band REPLACES both legs: Est. BUY = the deep reachable bid, Est. SELL = the bold reachable ask. Still
  // BE-floored (below), still anchor-nudged, still ordering-clamped (bid ≤ live buy, sell ≥ live sell); a
  // DECLARED exit still wins the sell leg (the operator's plan governs). The reliability guard already
  // shrank a thin book's band toward the center, so a thin read is not bold. n≈0 — this is a TRIAL: the
  // caller renders a LOUD banner and the shadow log stays on the NEUTRAL estimate (unbiased retro).
  let pressureApplied = false;
  const rbx = extra.reachable;
  if (pressureExit && rbx && num(rbx.ask) != null && num(rbx.bid) != null) {
    estBuy = rbx.bid;
    if (!declaredAnchored) estSell = rbx.ask;
    pressureApplied = true;
  }
  // ⚓ anchor nudge (final step — nudge, never override), then re-clamp.
  if (typeof nudge === 'function') {
    const nb = nudge('bid', estBuy); if (nb && num(nb.price) != null) estBuy = nb.price;
    const na = nudge('ask', estSell); if (na && num(na.price) != null) estSell = na.price;
  }
  // a pressure deep bid may sit BELOW the band low (that's the point) — ceiling it at live, no band-low
  // floor; the reach-folded default keeps its [band-low, live] clamp.
  estBuy = pressureApplied ? Math.round(Math.min(estBuy, qb)) : Math.round(clamp(estBuy, Math.min(ob, qb), qb));
  // a declared exit is floored to live (never below the live instabuy), but not ceiling-clamped to the band.
  // topRef == bandTop unless the liquidity/size relief de-biased it (Part B) — the ceiling is then the
  // observed 24h high (dayHigh), never anything above what actually printed.
  // PB4 reliability-gated ceiling (the ruled peak-cap decision): a FULLY-reliable pressure ask may exceed
  // the observed 24h high (reachableBand caps its own headroom at PRESSURE_HEADROOM_MAX bands); a
  // reliability<1 read keeps the dayHigh cap (the thin-book mirage guard). The reach-folded default is
  // unchanged (clamped to topRef).
  if (declaredAnchored) estSell = Math.max(Math.round(estSell), qs);
  else if (pressureApplied) {
    const relFull = num(rbx.reliability) != null && rbx.reliability >= PRESSURE_EXIT_REL_FULL;
    const capped = relFull ? estSell : (dayHi != null ? Math.min(estSell, dayHi) : estSell);
    estSell = Math.max(qs, Math.round(capped));
  } else estSell = Math.round(clamp(estSell, qs, topRef));
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
    // PLAN-LIQUIDITY-REACH: non-null ONLY when the relief changed the sell estimate (softened fold or
    // de-biased top) — { relief, sizeRatio, debiasedTop|null }. Feeds the stdout note + the lean shadow.
    relief: reliefApplied,
    // PB4: non-null ONLY when the pressure-exit override drove the legs (the TRIAL marker) — the surface
    // renders "(pressure N×)" in the cell so the number never reads as the calibrated default (rule 4).
    pressureExit: pressureApplied ? { pressure: num(rbx.pressure), reliability: num(rbx.reliability) } : null,
  };
  return { estBuy, estSell, estNet, estRoi, be, confidence };
}
