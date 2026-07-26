/**
 * reverseflip.mjs — PURE gate + edge math for the `--mode reverse` HARVEST-AN-OWNED-ITEM niche
 * (PLAN-REVERSE-FLIP chunk RF1). Mirrors js/valuescreen.mjs / js/amplitudescreen.mjs's shape exactly:
 * DOM-free, fetch-free, fs-free ESM, importable from BOTH node (screen-flip-niches.mjs /
 * gatecandidates.mjs, wired in RF2) AND — later — the app. The caller hands in an already-computed
 * `classifyTrajectory` shape (js/termstructure.mjs) + the sell/rebuy reference prices + per-leg
 * liquidity — no fetch here.
 *
 * THE NICHE (PLAN-REVERSE-FLIP, Ben 2026-07-24). Normal flipping deploys capital and treats the SELL
 * as the risky mandatory leg (stranding = can't sell). Reverse-flip INVERTS this for an item Ben
 * already owns and wants to keep: sell into the diurnal/multi-day PEAK, then rebuy at the DIP. It is
 * capital-free (monetizes an owned asset, nothing deployed to enter) and its failure mode is bounded
 * ("can't rebuy cheap enough" — no deadline to reacquire your own item; worst case wait for the next dip).
 *
 * THE REGIME INVERSION (the load-bearing idea — see the Regime-asymmetry table in PLAN-REVERSE-FLIP).
 * Every OTHER flip-niche reads `classifyTrajectory`'s shape with `rising` = good (upside) and a decline
 * = stranding risk. Reverse-flip inverts that mapping (`invertedRegimeGate` below):
 *   rising     → REJECT — sell now, rebuy at a HIGHER floor tomorrow; the cycle loses by construction.
 *   elevated   → REJECT — top of range; the same "buy back higher" risk on the rebuy leg.
 *   knife      → PASS   — the monotone-decline case: sell high off a hold you'd otherwise ride DOWN,
 *                         rebuy lower. This PROTECTS the hold's value instead of bleeding it. `knife` is
 *                         `classifyTrajectory`'s "falling" analog — there is NO `falling`/`cooling` shape.
 *   oscillating/based → PASS — a repeatable peak→dip lap, the exact shape the strategy wants.
 *   flat       → PASS   — neutral; no clear lap but not disqualifying.
 *   unknown / missing / short data → CAUTION — degrade, never throw (the momVerdict precedent).
 * `classifyTrajectory` emits `knife|oscillating|based|rising|elevated|flat|unknown` and NEVER `falling`
 * or `cooling`; a `case 'falling'`/`case 'cooling'` branch here would be a silent dead gate (it was the
 * plan's original bug, fixed in Ruling §7 — do NOT reintroduce it).
 *
 * WHY THE REBUY LEG IS THE BINDING CONSTRAINT (Anchor incident, 2026-07-24). Selling 1 Ancestral hat
 * @57m FILLED INSTANTLY on live demand — a WANTED thin item clears its SELL leg immediately, falsifying
 * the naive "thin ⇒ the sell is risky" read. The risk is the REBUY: a deep rebuy bid can strand while
 * you're out of the position and price ranges/rises away. So `reverseFlipGate` weights liquidity
 * asymmetrically — a thin SELL leg is CAUTION-not-reject (live demand clears it), a thin REBUY leg is a
 * real risk (reject). Honesty (rule 4): the thin-rebuy read is a screening posture, never a block on Ben
 * placing the bid — the strategy's own risk framing is that the rebuy miss is BOUNDED.
 *
 * HONESTY (rule 4 — n≈0). Every threshold below is a NAMED PLACEHOLDER; this lane has no record yet. Do
 * NOT cite any constant here as validated.
 */
import { tax } from './money-math.js';

const num = x => (typeof x === 'number' && Number.isFinite(x)) ? x : null;

// --- PLACEHOLDER constants (rule 4 — unvalidated; the reverse-flip suggestions accrual would tune them) --
// The peak→dip amplitude (as a fraction of the sell reference) a lap must clear to be worth harvesting.
// A reverse-flip pays the 2% GE tax ONCE (on the sell) and rebuys strictly below `beRebuy`, so the swing
// must clear roughly the tax fraction plus a working margin. PLACEHOLDER (n≈0) — starting hypothesis only.
// @provisional-api: PLAN-REVERSE-FLIP — consumed by RF2's `--mode reverse` gate wiring (screen-flip-niches.mjs / gatecandidates.mjs); node-only until then.
export const REVERSE_MIN_SWING_PCT = 0.03;
// Per-leg daily-volume floor below which a leg is "thin". The reverse-flip population IS mostly thin
// big-ticket owned gear (the hat trades ~135/d), so this is deliberately LOW — its ROLE is asymmetric
// (see reverseFlipGate): thin SELL leg = caution, thin REBUY leg = reject. PLACEHOLDER (n≈0).
export const REVERSE_MIN_LEG_VOL = 50;

// decision severity ordering, so a later check can only DOWNGRADE (pass → caution → reject), never upgrade.
const RANK = { pass: 0, caution: 1, reject: 2 };
const worse = (a, b) => (RANK[b] > RANK[a] ? b : a);

/* invertedRegimeGate(trajectory) → { decision, shape, reason }. Re-maps `classifyTrajectory`'s existing
   shape per the Regime-asymmetry table (this does NOT recompute shape — it re-reads the one already in
   hand). Accepts EITHER a bare shape string OR a classifyTrajectory result object ({ shape, ... }).
   decision ∈ 'pass' | 'reject' | 'caution'; reason is null on a clean pass. Never throws — a missing /
   unknown / short-data shape degrades to caution (the momVerdict optional-degradation precedent). */
export function invertedRegimeGate(trajectory) {
  const shape = typeof trajectory === 'string'
    ? trajectory
    : (trajectory && typeof trajectory.shape === 'string' ? trajectory.shape : null);
  switch (shape) {
    // sell now, rebuy at a HIGHER floor tomorrow → loses by construction.
    case 'rising':   return { decision: 'reject', shape, reason: 'regime-rising' };
    // top of range; the "buy back higher" risk on the rebuy leg → reject the surfacing.
    case 'elevated': return { decision: 'reject', shape, reason: 'regime-elevated' };
    // knife IS the "falling" case the strategy wants (sell high, rebuy lower — protect the hold).
    case 'knife':       return { decision: 'pass', shape, reason: null };
    // ideal — a repeatable peak→dip lap.
    case 'oscillating': return { decision: 'pass', shape, reason: null };
    case 'based':       return { decision: 'pass', shape, reason: null };
    // neutral — no clear lap but not disqualifying.
    case 'flat':        return { decision: 'pass', shape, reason: null };
    // 'unknown', null, or any unrecognized value → degrade, never assert a harvest off thin data.
    case 'unknown': return { decision: 'caution', shape, reason: 'regime-unknown' };
    default:        return { decision: 'caution', shape: shape || null, reason: shape ? 'regime-unrecognized' : 'no-trajectory' };
  }
}

/* reverseFlipEdge(ctx) → the edge fields, or { hasData:false }. DIRECTION-AGNOSTIC.
   ctx — { sellRef, rebuyRef?, swingPct? }:
     sellRef  — the peak / sell reference price (the level the owned item is sold into).
     rebuyRef — (optional) the expected rebuy / dip level; if given, the peak→dip swing is derived from it.
     swingPct — (optional) the peak→dip amplitude as a fraction of sellRef, handed in directly; wins over
                a derived one.
   Computes:
     beRebuy — sellRef − tax(sellRef) via the CANONICAL js/money-math.js tax() (floored, 5m-capped —
               Ruling §1, NOT a "×0.98" approximation). Any rebuy STRICTLY BELOW beRebuy profits after tax.
     swingPct — swingPct ?? (sellRef>0 && rebuyRef!=null ? (sellRef − rebuyRef)/sellRef : null).
     amplitudeFloorMet — swingPct != null && swingPct ≥ REVERSE_MIN_SWING_PCT (a null/unknown swing is NOT
               "unmet" — it's unknown; the gate treats it as no-signal, not a caution).
   Missing/invalid sellRef ⇒ { hasData:false } (degrade, never throw). */
export function reverseFlipEdge(ctx = {}) {
  const sellRef = num(ctx.sellRef);
  if (sellRef == null || sellRef <= 0) return { hasData: false };
  const beRebuy = sellRef - tax(sellRef);
  const rebuyRef = num(ctx.rebuyRef);
  const givenSwing = num(ctx.swingPct);
  const swingPct = givenSwing != null
    ? givenSwing
    : (rebuyRef != null ? (sellRef - rebuyRef) / sellRef : null);
  const amplitudeFloorMet = swingPct != null && swingPct >= REVERSE_MIN_SWING_PCT;
  return { hasData: true, sellRef, beRebuy, rebuyRef, swingPct, amplitudeFloorMet };
}

/* reverseFlipGate(ctx) → { decision, reasons, regime, edge }. Composes the inverted regime gate + the
   amplitude floor + a REBUY-LEG-WEIGHTED liquidity check into ONE structured decision. Never throws.
   ctx — { trajectory, sellRef, rebuyRef?, swingPct?, sellLegVol?, rebuyLegVol? }:
     trajectory                — classifyTrajectory shape/result (→ invertedRegimeGate).
     sellRef/rebuyRef/swingPct — → reverseFlipEdge.
     sellLegVol / rebuyLegVol  — per-leg daily volume (units/day) for the liquidity asymmetry.
   Composition (severity can only DOWNGRADE — pass → caution → reject):
     1. Regime dominates: a `reject` regime (rising/elevated — loses by construction) is a hard reject.
     2. Amplitude floor: a KNOWN sub-floor swing → caution ('swing-below-floor'); a null swing is
        no-signal, not a caution (degrade-friendly).
     3. Liquidity, rebuy-leg-binding (the Anchor incident): a thin REBUY leg → reject ('rebuy-leg-thin');
        a thin SELL leg (rebuy leg OK) → caution-not-reject ('sell-leg-thin', live demand clears the sell);
        an UNKNOWN rebuy leg → caution ('rebuy-liquidity-unknown', can't confirm the binding leg).
   reasons[] collects every fired reason (empty on a clean pass). */
// @provisional-api: PLAN-REVERSE-FLIP — RF2's gateReverseFlipCandidates (screen-flip-niches.mjs / gatecandidates.mjs, `--mode reverse`) is the consumer; node-only until RF2 wires it.
export function reverseFlipGate(ctx = {}) {
  const regime = invertedRegimeGate(ctx.trajectory);
  const edge = reverseFlipEdge(ctx);
  const reasons = [];

  // 1. regime dominates — a rising/elevated item loses by construction; short-circuit to reject.
  if (regime.decision === 'reject') {
    return { decision: 'reject', reasons: [regime.reason], regime, edge };
  }
  let decision = regime.decision;                 // 'pass' or 'caution'
  if (regime.reason) reasons.push(regime.reason); // carries 'regime-unknown'/'no-trajectory' forward

  // 2. amplitude floor — a KNOWN sub-floor swing is no worthwhile lap (caution, never a hard reject on a
  //    wanted item). A null/unknown swing is treated as no-signal (degrade), not a caution.
  if (edge.hasData && edge.swingPct != null && !edge.amplitudeFloorMet) {
    decision = worse(decision, 'caution');
    reasons.push('swing-below-floor');
  }

  // 3. liquidity — the rebuy leg is the binding constraint (Anchor incident). A thin rebuy leg is a real
  //    risk (reject); a thin sell leg is not (live demand clears it → caution); an unknown rebuy leg
  //    degrades to caution because the binding leg can't be confirmed.
  const rebuyVol = num(ctx.rebuyLegVol);
  const sellVol = num(ctx.sellLegVol);
  if (rebuyVol != null && rebuyVol < REVERSE_MIN_LEG_VOL) {
    decision = worse(decision, 'reject');
    reasons.push('rebuy-leg-thin');
  } else {
    if (rebuyVol == null) {
      decision = worse(decision, 'caution');
      reasons.push('rebuy-liquidity-unknown');
    }
    if (sellVol != null && sellVol < REVERSE_MIN_LEG_VOL) {
      decision = worse(decision, 'caution');
      reasons.push('sell-leg-thin');
    }
  }

  return { decision, reasons, regime, edge };
}
