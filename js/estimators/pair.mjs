/**
 * estimators/pair.mjs (PC2, 2026-07-17; PC3 sell-model split 2026-07-17) — the RECONCILIATION PRICE
 * ESTIMATOR (Est. buy / Est. sell): entryDoctrine, reachRead (internal), estimatePair. estimatePair is
 * now the ordering SPINE / SHELL ONLY — it prepares the shared inputs, delegates the buy+sell PROPOSAL to
 * a named model from SELL_TOP_MODELS (js/estimators/sell-models/), then applies the NON-SKIPPABLE floors
 * a model can't bypass: the declared-exit anchor → anchor nudge → ordering clamps (buy ≤ live, sell ≥ live)
 * → BE floor LAST. The sell-top variants (neutral reach-fold, PB4 pressure, and later safe-quantile) are
 * named files + one registry line, NOT boolean options threading through this function (PC3 — the
 * composition seam). The render cells that consume the output live in ./cells.mjs. PURE: imports the
 * money-math helpers, quotecore's breakEven (the ONE model-free BE floor), windowread's RECENCY_DIVERGE (a
 * leaf), reach.mjs's reachRelief + REACH_DEBIAS_MAX_FRAC, and the sell-model registry. Every constant here
 * is an unvalidated PLACEHOLDER (rule 4). See the js/estimators.mjs barrel header for the full doctrine and
 * ./sell-models/reach-fold.mjs for the model contract.
 */
import { netMargin, clamp } from '../money-math.js';
import { breakEven } from '../quotecore.js';   // PLAN-OUTPUT-TABLE: the ONE model-free break-even (BE floor for estSell)
import { RECENCY_DIVERGE } from '../windowread.mjs';   // PLAN-OUTPUT-TABLE rev1: reuse the RC1 recent-vs-full divergence threshold (windowread is a leaf — no import cycle)
import { reachRelief, REACH_DEBIAS_MAX_FRAC, askReachFactor } from './reach.mjs';   // PC2: liquidity/size relief + the Part-B de-bias cap; PLAN-ESTIMATOR-HONEST-SELL E1: askReachFactor — the SAME P(fill) the rank uses (families.mjs:291), reused (never forked) so the display honestly matches the rank pattern (raw margin × P(fill))
import { driftExitFrom } from '../forecast.mjs';   // PLAN-ESTIMATOR-HONEST-SELL E1: the forward-projected exit LEVEL ("list at X") — computed in the SHELL off extra.forward (profile+days already in the caller's hand → zero new fetch). forecast→windowread(leaf) only, no cycle.
import { SELL_TOP_MODELS } from './sell-models/index.mjs';   // PC3: the named sell-top proposal models (reach-fold / pressure / …)

// PC3: re-export the sell-model registry + each model's PLACEHOLDER constants through this module so the
// js/estimators.mjs barrel (export * from ./pair.mjs) keeps every existing import path valid byte-for-byte
// (estimators.test.mjs imports EST_REACH_SAT_FRAC from the barrel; the app/pipeline shim import the barrel).
export { SELL_TOP_MODELS } from './sell-models/index.mjs';
export { EST_REACH_SAT_FRAC, EST_BLEND_EQUAL_WEIGHTS, EST_FADE_DISCOUNT } from './sell-models/reach-fold.mjs';
export { PRESSURE_EXIT_REL_FULL } from './sell-models/pressure.mjs';

const clamp01 = x => clamp(x, 0, 1);   // reuse the imported clamp — was a duplicate reimplementation
const num = x => (typeof x === 'number' && Number.isFinite(x)) ? x : null;

/* ============================================================================================
   PLAN-OUTPUT-TABLE (2026-07-13, + REVISIONS same day) — the RECONCILIATION ESTIMATOR: Est. buy / Est. sell.
   THE MOTIVE (Ben): the table's Quick + Optimistic cells are two theoretical, model-free pairs the
   operator reconciles BY HAND into the one number he posts (Optimistic ∩ diurnal ∩ reach ∩ anchor ∩
   BE-floor, synthesized every pass). estimatePair promotes that synthesis into first-class numbers.

   PC3 (2026-07-17): the buy+sell PROPOSAL is now a NAMED MODEL (js/estimators/sell-models/) the shell
   dispatches to — the neutral reach-fold, the PB4 pressure trial, and later safe-quantile. What each
   model proposes (the per-strategy entry doctrine, the reach-folded/relief-softened band-top sell, the
   pressure override) is documented in its own file + the SELL-MODEL CONTRACT header in
   ./sell-models/reach-fold.mjs. What stays HERE, in the shell, is the ordering spine every model obeys:

     estSELL — DECLARED-EXIT anchor is the SHELL's, not a model's: when `extra.declaredExit` is passed the
       operator's stated target governs the sell leg for EVERY model (it may sit ABOVE the band top — not
       ceiling-clamped, only floored to live + break-even). CALLER CONTRACT (FIX 1, 2026-07-13): a declared
       exit is a HELD-LOT sell plan, so a caller passes it ONLY for an item it HOLDS; the pure DISCOVERY
       screen (band/churn/value) NEVER passes it.
     estSELL is BE-FLOORED always (never < breakEven — the ONE model-free honesty anchor; the floor binding
       IS the estimate saying "no trade") and ORDERING-CLAMPED (≥ the live instasell). A model chooses only
       its outer ceiling (sellHi); the live floor + BE floor are the shell's and non-negotiable.
     estBUY is ORDERING-CLAMPED (≤ the live instabuy). A model chooses only its outer floor (buyLo).
     The asymPair DEEP bid is NEVER folded into estBuy (rev3) — a deep flush bid is rest-and-see
       OPTIONALITY (the separate `◆ asym` line), never inside an expected-price number.

   CONFIDENCE (rev1) — carried WITH the price as the RECENT-3 reach idiom, not the full window: the
   godsword read `2/14` fine but its RECENT reach was `0/3` = the mirage. Recent-3 (`recencySplit`,
   already computed) is the freshness-honest signal AND the fold basis; the full window is the
   sample-size backstop, shown BESIDE it only when the two DIVERGE (`0/3 · 2/14` — that divergence is the
   stale flag). The `(live)` span-0 fallback is dropped.

   CONSOLE-ONLY consumer set today (screen-flip-niches.mjs / quote-items.mjs stdout — --raw restores Quick/Optimistic);
   the app Finder/screen.json never call estimatePair. PURE over the already-computed row/ctx — ZERO new
   fetch; every missing input degrades to the model-free edge (absent evidence ⇒ no discount, the
   askReachFactor absent→1 precedent). Quoted momentum tell, break-even, ordering invariant, and the value
   q15/q85 twin are all untouched.
   HONESTY (rule 4): EVERY constant/weight/per-strategy placement in the models is a NAMED PLACEHOLDER,
   n≈14 per item at best; the F1 retro-join (estBuy/estSell/estConfidence shadow fields on
   suggestions.jsonl) owns calibration. EST_REACH_SAT_FRAC / EST_BLEND_EQUAL_WEIGHTS (reach-fold.mjs) and
   PRESSURE_EXIT_REL_FULL (pressure.mjs) are re-exported through this module for the barrel.
   ============================================================================================ */

/* entryDoctrine(spec) → 'near-live' | 'trough' | 'band-low' — the per-strategy ENTRY placement (rev2;
   PLAN-ESTIMATOR-POSTURE AC1 split band off the fold, AC6 folded churn's buy in with it). DERIVED from
   existing spec fields so no new declarative field is added (the app-parity registry stays untouched): a
   faller-ACCEPTING thesis (scalp) bids to fill (near-live); a term-basis thesis (value) bids the durable
   floor (trough); everything else (the opt-basis flip niches band + churn) PRICES the band low ('band-low').
     • band (fillShape 'asym') — AC1 removed the fill-now fold from its buy leg (a quiet-band day was
       collapsing real patient band flips to "+1 (BE-floored)"); estBuy is `ob` (band low, diurnal-dip
       blended), the same anchor value's 'trough' branch emits — 'band-low' is a distinct LABEL (shadow
       doctrine field + the buy-cell reach/percentile annotation), not distinct math.
     • churn (fillShape 'symmetric') — AC6: the day-level reach read mismeasures a tight symmetric lap on
       BOTH legs (rank/families.mjs:251 + grade already skip it), so churn's BUY leg no longer folds toward
       live either — it prices the same band low. The 'reach-fold' entry doctrine now has NO producer (the
       buy-fold branch was deleted from reach-fold.mjs); churn carries a `foldExempt:'symmetric'` marker so
       the cell drops the invalidated reach caution while the shadow keeps logging the counts.
   Routing off falling/priceBasis keeps this derived-from-declarative-fields; scalp is 'asym' too but returns
   'near-live' above. PLACEHOLDER mapping — F1 calibrates each niche's real entry aggression. */
export function entryDoctrine(spec) {
  if (spec && spec.falling === 'accept') return 'near-live';   // scalp — a deliberate flip bids to FILL
  if (spec && spec.priceBasis === 'term') return 'trough';     // value — a buy-hold bids the durable floor
  return 'band-low';   // band + churn (AC6) — price the band low, annotate reach/placement; churn adds foldExempt
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

/* estimatePair(spec, row, extra, { nudge, sellModel, pressureExit }) → { estBuy, estSell, estNet, estRoi,
   be, estSellFloorBind, pFill, estSellForward, forwardPeak, forwardTrough, forwardConfidence,
   holdHorizonDays, confidence } | null.
   PLAN-ESTIMATOR-HONEST-SELL E1 — THE HONESTY FIX: estSell is NO LONGER overwritten to break-even. Because
   netMargin(buy, breakEven(buy)) ≡ +1 for the whole price range, any BE-clamped "+1 (BE X)" was a clamp
   ARTIFACT hiding a possibly-real edge (the operator read it and SKIPPED). estSell now keeps the model's
   honest (possibly-sub-BE, possibly-negative-net) proposal; `estSellFloorBind = beFloored ? be : null` carries
   the floor as a DISPLAY FACT (an annotation on the SECONDARY reach-fold), never a number substitution.
   `pFill` reuses askReachFactor (the SAME fn the rank calls) so the display matches the rank's honest
   pattern (raw margin × P(fill)); `estSellForward`/forward fields are the phase-aware "list at X" projection.
   extra (ALL optional — zero new fetch; the caller passes only what it already computed):
     bidReach  { reachedDays, nDays, recentHit?, recentDays? }  patient bid TOUCH counts (full + recent-3)
     askReach  { reachedDays, nDays, recentHit?, recentDays? }  patient ask REACH counts (full + recent-3)
     diurnal   { bid, ask }        deriveDiurnalRange's dip/peak-window levels
     asym      { highReachAsk }    asymPair's near-certain exit level (deepBid is NEVER consumed — rev3)
     askMargin { trend }          R5: the ask-side reachMargin CUSHION trend (fading|stable|extending) — a
                                   `fading` trend tightens the sell fold even on a clean reach (the mirage
                                   fix). Absent → no fade (byte-identical). reach-fold reads only .trend.
     declaredExit  number|null     the lot's declared thesis exit (hold-thesis.json) — anchors estSell
     dayHigh   number|null         PLAN-LIQUIDITY-REACH Part B: the observed trailing-24h high (the
                                   caller's dayHighFrom5m over its in-hand 5m series — the least-smoothed
                                   high the wiki exposes). With a positive liquidity/size relief the SELL
                                   top reference widens toward it (never above it); thin book / large
                                   size / absent → the band top stands byte-identically.
     reachable { ask, bid, pressure, reliability }  the pressure model's price source (ignored by reach-fold).
     forward   { profile, days, holdHorizonDays?, now? }  PLAN-ESTIMATOR-HONEST-SELL E1 — the "list at X"
                                   FORWARD projection inputs the CALLER already has in hand (an hourProfile +
                                   a windowStats().days series — ZERO new fetch). When present the shell
                                   computes driftExitFrom(profile, days, <ctx built from the live pair>,
                                   {holdHorizonDays}) and returns estSellForward/forwardPeak/forwardTrough/
                                   forwardConfidence/holdHorizonDays. ABSENT → all forward fields null (honest
                                   degrade — the reach-fold read is byte-identical). On a KNIFE driftExitFrom
                                   degrades to a labeled trend-only level (never a crash), so the number/label
                                   communicates and no new detector call site is added. `now` (optional) pins
                                   diurnalForecast's clock for deterministic tests.
   nudge: optional (side, price) → { price }|null — the ⚓ anchor round-number nudge (pipeline passes
   modules/anchor.mjs anchorNudge; injected so this module stays pure/app-importable). Final pricing step.
   sellModel: PC3 — which SELL_TOP_MODELS entry proposes the buy+sell legs ('reach-fold' default,
   'pressure', later 'safe-quantile'). pressureExit:true is LEGACY SUGAR for sellModel:'pressure' (kept so
   the three call sites + tests read identically); an explicit sellModel wins. An unknown name degrades to
   'reach-fold'. `spec` drives the per-strategy entry doctrine (rev2). Returns null when there is no live pair. */
export function estimatePair(spec, row = {}, extra = {}, { nudge = null, sellModel = null, pressureExit = false } = {}) {
  const qb = num(row.quickBuy), qs = num(row.quickSell);
  if (qb == null || qs == null) return null;                    // no live pair → no estimate (degrade)
  const ob = num(row.optBuy) ?? qb, os = num(row.optSell) ?? qs;
  const bidR = reachRead(extra.bidReach), askR = reachRead(extra.askReach);
  const doctrine = entryDoctrine(spec);
  // --- shared PREP (model-independent; computed once, handed to the model via ctx) ------------------
  // PLAN-LIQUIDITY-REACH (2026-07-13): the liquidity/size relief + the Part-B de-biased top reference the
  // reach-fold model folds on. intendedUnits: a held-lot surface passes the REAL lot size
  // (extra.intendedUnits — positions.json qty); absent it (a discovery/per-item read) we degrade to the
  // buy limit, the standard per-window accumulation proxy. THE MIRAGE GUARD: a thin book / large size /
  // absent inputs ⇒ relief 0 ⇒ topRef == bandTop ⇒ the model is byte-identical to the flat fold.
  const iu = num(extra.intendedUnits);
  const intendedUnits = iu != null ? iu : num(row.limit);
  const relief = reachRelief({ intendedUnits, volDay: num(row.volDay) });
  const sizeRatio = (intendedUnits != null && num(row.volDay) > 0) ? intendedUnits / row.volDay : null;
  const bandTop = Math.max(os, qs);
  const dayHi = num(extra.dayHigh);
  const topRef = (relief > 0 && dayHi != null && dayHi > bandTop)
    ? Math.min(dayHi, Math.round(bandTop + REACH_DEBIAS_MAX_FRAC * relief * (dayHi - bandTop)))
    : bandTop;
  // --- MODEL PROPOSAL: the named sell-top model proposes both legs + its clamp bounds + confidence ----
  // (js/estimators/sell-models/). An explicit sellModel wins; else pressureExit:true is legacy sugar for
  // 'pressure'; else the neutral reach-fold. An unknown name degrades to reach-fold (never throws).
  const modelName = sellModel != null ? sellModel : (pressureExit ? 'pressure' : 'reach-fold');
  const model = SELL_TOP_MODELS[modelName] || SELL_TOP_MODELS['reach-fold'];
  const ctx = { spec, row, extra, qb, qs, ob, os, bidR, askR, doctrine, relief, sizeRatio, bandTop, dayHi, topRef };
  const prop = model.propose(ctx);
  let estBuy = prop.estBuy, estSell = prop.estSell;
  const buyLo = prop.buyLo;
  let sellHi = prop.sellHi;
  let { bid: cBid, ask: cAsk, relief: cRelief, pressureExit: cPressure } = prop.confidence;
  const cFoldExempt = prop.confidence.foldExempt || null;   // AC5: churn sell-fold exemption marker (pressure model omits it → null)
  let cFade = prop.confidence.fade || null;   // R5: cushion-fade marker (pressure model omits it → null)
  // --- SHELL SPINE (the non-skippable floors — a model can propose a price, never bypass these) -------
  // DECLARED-EXIT anchor: the operator's stated target governs the SELL leg for EVERY model (NOT
  // ceiling-clamped to the band; floored to live + break-even). A declared exit suppresses the generic
  // ask-reach token + the relief note (they describe a fold that no longer drives the sell).
  const declared = num(extra.declaredExit);
  let declaredAnchored = false;
  if (declared != null && declared > 0) {
    estSell = declared; declaredAnchored = true; sellHi = Infinity; cAsk = null; cRelief = null; cFade = null;
  }
  // ⚓ anchor nudge (final proposal step — nudge, never override), then the ordering clamps.
  if (typeof nudge === 'function') {
    const nb = nudge('bid', estBuy); if (nb && num(nb.price) != null) estBuy = nb.price;
    const na = nudge('ask', estSell); if (na && num(na.price) != null) estSell = na.price;
  }
  // ORDERING clamps — the shell's, non-negotiable: buy ≤ the live instabuy (qb); sell ≥ the live
  // instasell (qs). A model only chose the OUTER bound (buyLo can dip below the band low for a pressure
  // deep bid; sellHi can be Infinity for a fully-reliable pressure ask or a declared exit above the band).
  estBuy = Math.round(clamp(estBuy, buyLo, qb));
  estSell = declaredAnchored ? Math.max(Math.round(estSell), qs) : Math.round(clamp(estSell, qs, sellHi));
  // BE floor — MODEL-FREE, computed LAST but NO LONGER an OVERWRITE (PLAN-ESTIMATOR-HONEST-SELL E1). The
  // old `if (beFloored) estSell = be` substitution made a sub-BE fold read a false "+1 (BE X)" — a clamp
  // artifact (netMargin(buy, breakEven(buy)) ≡ +1 for the entire range) that hid a possibly-real edge and
  // got SKIPPED. estSell stays the model's HONEST proposal (already ordering-clamped to ≥ the live
  // instasell); `estSellFloorBind` carries the break-even as a DISPLAY FACT (a caution on the SECONDARY
  // reach-fold — "nothing to price above break-even"), never a number the cell shows in place of the truth.
  const bopt = row.bond ? { bond: true, guide: row.guide } : undefined;
  const be = breakEven(estBuy, bopt);
  const beFloored = estSell < be;
  const estSellFloorBind = beFloored ? be : null;
  const estNet = netMargin(estBuy, estSell, bopt);   // HONEST: the real (possibly-negative) net at the honest sell, never the clamped +1
  const estRoi = (estNet != null && estBuy > 0) ? estNet / estBuy * 100 : null;
  // pFill — the SAME two-leg ask/exit reach probability the RANK carries (askReachFactor, families.mjs:291),
  // REUSED not forked: a first-class field so the display honestly reads "raw margin × P(fill)" like the rank
  // (a stale exit demotes the probability, it does not haircut the price into a false break-even). Absent
  // ask-reach → 1 (the byte-identical degrade the rank uses). No relief arg — mirrors families.mjs's rank pFill.
  const pFill = askReachFactor(extra.askReach);
  // FORWARD "list at X" (PLAN-ESTIMATOR-HONEST-SELL E1) — the phase-aware forward-projected exit LEVEL, homed
  // in the SHELL (the sell-model ctx carries no profile/days). driftExitFrom off the caller's in-hand
  // hourProfile + windowStats().days (extra.forward — ZERO new fetch); the diurnal ctx is built from the live
  // pair (liveLo = the instasell qs, liveHi = the instabuy qb) + the row's momentum/reliability/phase. Absent
  // extra.forward → all forward fields null (honest degrade); on a KNIFE driftExitFrom returns a labeled
  // trend-only level (no crash, no new detector call site). holdHorizonDays is the forward number's own tunable.
  let estSellForward = null, forwardPeak = null, forwardTrough = null, forwardConfidence = null, holdHorizonDays = null;
  const fwd = extra.forward;
  if (fwd && fwd.profile) {
    const fwdCtx = { liveLo: qs, liveHi: qb, mom: row.mom ?? null, reliable: row.reliable, phase: row.phase, now: fwd.now };
    const dae = driftExitFrom(fwd.profile, fwd.days ?? null, fwdCtx, fwd.holdHorizonDays != null ? { holdHorizonDays: fwd.holdHorizonDays } : {});
    if (dae) {
      forwardPeak = num(dae.driftAdjustedPeak);
      forwardTrough = num(dae.driftAdjustedTrough);
      forwardConfidence = dae.confidence ?? null;
      holdHorizonDays = num(dae.holdHorizonDays);
      estSellForward = forwardPeak;   // the sell "list at X" is the projected next peak
    }
  }
  const confidence = {
    bid: cBid, ask: cAsk,
    beFloored, declaredAnchored, doctrine,
    // AC5/AC6: the churn fold-exemption marker ('symmetric') — the cell suppresses the reach caution token
    // and the shadow segments on it. A declared exit already nulled cAsk above, but foldExempt is orthogonal
    // (a declared churn lot still folds nothing) so it rides regardless.
    foldExempt: cFoldExempt,
    // PLAN-LIQUIDITY-REACH: non-null ONLY when the relief changed the sell estimate (softened fold or
    // de-biased top) — { relief, sizeRatio, debiasedTop|null }. Feeds the stdout note + the lean shadow.
    relief: cRelief,
    // R5: non-null ONLY when a fading ask cushion tightened the sell fold — { trend:'fading', discount }.
    // Feeds the F1 shadow (segments the mirage-discounted sells) + a caution token; nulled by a declared exit.
    fade: cFade,
    // PB4: non-null ONLY when the pressure model drove the legs (the TRIAL marker) — the surface renders
    // "(pressure N×)" in the cell so the number never reads as the calibrated default (rule 4).
    pressureExit: cPressure,
  };
  return {
    estBuy, estSell, estNet, estRoi, be,
    estSellFloorBind,   // E1: break-even as a DISPLAY FACT when the honest sell is sub-BE (else null) — a caution, not a substitution
    pFill,              // E1: the reused askReachFactor P(fill) (never forked), a first-class field
    estSellForward, forwardPeak, forwardTrough, forwardConfidence, holdHorizonDays,   // E1: the forward "list at X" (null when extra.forward absent — degrade)
    confidence,
  };
}
