/* paths.mjs — the PURE HELD-ITEM STRATEGY engine ("compare strategies", chunk P4a).
   DOM-free, dependency-free ESM (imports nothing — no fetch/fs, no window/document), importable by
   BOTH the browser app AND the node pipeline exactly like js/quotecore.js. Keep it that way.

   VOCAB (see docs/GLOSSARY.md): a "path" here IS a HELD-ITEM STRATEGY — one candidate approach for a
   lot you already hold (hold-recovery / cut / be-escape / list-to-clear / value-hold). "strategy" is
   reserved for THIS level; the screen's band/churn/scalp/value are FLIP-NICHES (strategies.mjs). The
   file → held-item-strategy.mjs rename is R2 (PLAN-RENAME.md).

   WHAT A "PATH" IS. A verdict in the v2 world is not "item → one label"; it is "item × THESIS → an
   action under that thesis". A held Dragon Warhammer can be, simultaneously: a value-hold above its
   multi-week floor, a be-escape if you just want your capital back, and a cut if the floor is eroding.
   Each of those is a PATH. The engine ENUMERATES the sensible candidate paths for an item given its
   (already-derived) context, then WEIGHS them by viability so the desk shows the dominant path as the
   headline and the rest as a weighed MENU. Per PLAN.md's Path-engine spec, the alternatives are
   decision SUPPORT — never an alert input; only the dominant path (once P4b's persistence gate says it
   has survived long enough) drives a headline.

   Path shape (PLAN.md ~line 241):
     { key, thesis, action, levels, tripwire, horizon, economics, viability, evidence }
       key       — stable path identifier (one of PATH_KEYS)
       thesis    — one-line human premise ("hold above the durable multi-week floor")
       action    — one of ACTIONS (BUY / HOLD / LIST / CUT / AVOID)
       levels    — { entry, exit, stop } price levels for the path (any may be null)
       tripwire  — the structural-break level that INVALIDATES the path (gp) or null
       horizon   — free-text plan horizon ("weeks", "multi-day", "intraday", "now")
       economics — { netPerUnit, roiPct } or null (pulled from ctx; not recomputed here)
       viability — 0..1 weight (null until weighPaths runs); PLACEHOLDER heuristic (see below)
       evidence  — [{ signal, delta, note }] — WHY the viability is what it is, incl. `no-data` notes

   PURITY / DEGRADE-NOT-THROW. Every ctx field is OPTIONAL (the momVerdict optional-degradation
   precedent). A path we cannot evidence gets a LOW (never zero, never thrown) viability with a
   `no-data` evidence note — absence of proof is never a decisive signal. Missing ctx never throws.

   ⚠ ALL numeric weights below are NAMED PLACEHOLDER heuristics — the same discipline as the
   rating.mjs grade cutoffs and the quotecore phase() thresholds. They encode the SHAPE of the
   judgment (a falling decay-knife's hold-family paths must rank below its exit-family paths), NOT a
   calibrated magnitude. P6 replaces these with evidence-based viability (walk-forward per item×path
   with printed sample sizes). Do NOT cite any constant here as validated. */

/* --- the path vocabulary (derived from the momVerdict verdict set + PLAN.md's path mentions) ------
   The verdict tree (momVerdict) already speaks HOLD / LIST-TO-CLEAR / CUT / WATCH; PLAN.md's P4a/P5
   specs name scalp, be-escape, hold-recovery, value-hold. This is that union, cast as first-class
   thesis-paths (WHY the six + AVOID: each is a distinct thesis a lot can be held/entered under —
   they are NOT mutually exclusive, which is the whole point of weighing them):
     scalp         — flip-only intraday: buy a wide fresh band edge, exit at today's high, hard stop.
     value-hold    — buy-and-hold above a durable multi-week floor; the floor IS the thesis.
     hold-recovery — a temporarily-underwater lot expected to mean-revert (a genuine dip, not a bleed).
     be-escape     — an underwater lot: list at/above break-even to exit at cost, free the capital.
     list-to-clear — exit at the live instabuy now (bank it / stop the bleed at market).
     cut           — take the loss at the instabuy to stop a confirmed decline (the knife).
     avoid         — (non-held) no path validates entry → don't buy. */
export const PATH_KEYS = Object.freeze({
  SCALP: 'scalp', VALUE_HOLD: 'value-hold', HOLD_RECOVERY: 'hold-recovery',
  BE_ESCAPE: 'be-escape', LIST_TO_CLEAR: 'list-to-clear', CUT: 'cut', AVOID: 'avoid',
});
export const ACTIONS = Object.freeze({ BUY: 'BUY', HOLD: 'HOLD', LIST: 'LIST', CUT: 'CUT', AVOID: 'AVOID' });

// --- PLACEHOLDER weight constants (every one named + unvalidated; see the header warning) ----------
// Magnitudes are deliberately kept small enough that a fully-loaded exit path lands < 1.0 (so the
// clamp doesn't erase the ordering between, e.g., cut and list-to-clear on a confirmed knife).
export const PATH_BASE_VIABILITY     = 0.30;  // neutral prior before any evidence is applied
export const NO_DATA_VIABILITY       = 0.10;  // a path with NO applicable evidence → low, not zero (no-data note)
export const UNRELIABLE_VIABILITY    = 0.05;  // ctx.reliable===false → no path is actionable off this read
// hold-family (value-hold / hold-recovery) adjustments
export const FALLING_HOLD_PENALTY    = 0.35;  // a falling regime erodes the premise of holding
export const DECAY_HOLD_PENALTY      = 0.25;  // a decay phase (lows still stepping down) compounds it
export const RISING_HOLD_BONUS       = 0.30;  // a confirmed uptrend rewards patience
export const BASING_RECOVERY_BONUS   = 0.25;  // a basing phase (lows flattened) supports a recovery hold
export const ABOVE_FLOOR_VALUE_BONUS = 0.30;  // live above a durable multi-week floor supports value-hold
export const BELOW_FLOOR_VALUE_PENALTY = 0.40; // live below the floor guts the value thesis
// exit-family (be-escape / list-to-clear / cut) adjustments
export const UNDERWATER_ESCAPE_BONUS = 0.15;  // underwater lot → escaping at cost becomes attractive
export const FALLING_EXIT_BONUS      = 0.20;  // a falling regime rewards clearing/cutting
export const DECAY_EXIT_BONUS        = 0.12;  // a decay phase (still bleeding) rewards it further
export const BREAKDOWN_EXIT_BONUS    = 0.12;  // a live 2h breakdown adds urgency to an exit
export const BE_UNREACHABLE_PENALTY  = 0.25;  // underwater AND falling → the band may never print BE
// scalp adjustments
export const SCALP_WIDE_BAND_BONUS   = 0.30;  // a fresh intraday band wide enough to clear tax+margin
export const SCALP_FALLING_PENALTY   = 0.20;  // scalping a faller is the adverse-selection knife (P5)
export const SCALP_MIN_BAND_PCT      = 0.03;  // band width ≥ this fraction ⇒ "wide enough" (placeholder)
// P5 scalp path SEMANTICS (the "unsold scalp lap → cut, never hold-recovery" rule): a lot ENTERED
// under scalp is flip-only/no-hold by construction — a lap that failed to sell is a cut, not a
// retroactive hold thesis. When ctx.enteredUnder === scalp, BOTH hold-family theses (value-hold and
// hold-recovery) take this penalty so an exit-family path (cut, on the falling tape a scalp lives on)
// dominates. PLACEHOLDER magnitude (n≈0), large enough to sink both holds below the exit family.
export const SCALP_NO_HOLD_PENALTY   = 0.40;

const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
const num = x => (typeof x === 'number' && Number.isFinite(x)) ? x : null;

/* enumeratePaths(ctx) → Path[] — the sensible CANDIDATE paths for an item given its derived context.
   Held lots get the five hold/exit theses; a fresh (unheld) candidate gets the entry theses. viability
   is null here (weighPaths fills it). ctx is the enriched ItemContext slice (all fields optional):
     held, breakEven, quickBuy, quickSell, optBuy, optSell, floor, economics, tripwire, ...
   Levels are pulled straight from ctx — never recomputed (that's the surface/quote stage's job). */
export function enumeratePaths(ctx = {}) {
  const c = ctx || {};
  const be   = num(c.breakEven);
  const buy  = num(c.quickBuy);           // live instasell (your buy fill)
  const sell = num(c.quickSell);          // live instabuy (your clear-now sell)
  const optBuy  = num(c.optBuy);
  const optSell = num(c.optSell);
  const floor = num(c.floor);
  const econ = (c.economics && typeof c.economics === 'object') ? c.economics : null;
  const tw = num(c.tripwire);
  const mk = (key, action, thesis, levels, horizon, tripwire = tw) => ({
    key, action, thesis, levels, horizon, tripwire, economics: econ, viability: null, evidence: [],
  });

  if (c.held) {
    return [
      mk(PATH_KEYS.HOLD_RECOVERY, ACTIONS.HOLD,
        'temporarily underwater; hold for mean-reversion back through break-even',
        { entry: null, exit: be, stop: floor }, 'multi-day'),
      mk(PATH_KEYS.VALUE_HOLD, ACTIONS.HOLD,
        'buy-and-hold above the durable multi-week floor',
        { entry: null, exit: optSell, stop: floor }, 'weeks'),
      mk(PATH_KEYS.BE_ESCAPE, ACTIONS.LIST,
        'list at/above break-even to exit at cost and free the capital',
        { entry: null, exit: be, stop: null }, 'days'),
      mk(PATH_KEYS.LIST_TO_CLEAR, ACTIONS.LIST,
        'list at the live instabuy now — bank it at market',
        { entry: null, exit: sell, stop: null }, 'now'),
      mk(PATH_KEYS.CUT, ACTIONS.CUT,
        'take the loss at the instabuy to stop a confirmed decline',
        { entry: null, exit: sell, stop: null }, 'now'),
    ];
  }
  // a fresh (unheld) candidate: the entry theses + the always-available AVOID.
  return [
    mk(PATH_KEYS.SCALP, ACTIONS.BUY,
      'flip-only intraday: buy the fresh band edge, exit at today’s high, hard stop',
      { entry: optBuy != null ? optBuy : buy, exit: optSell != null ? optSell : sell, stop: floor }, 'intraday'),
    mk(PATH_KEYS.VALUE_HOLD, ACTIONS.BUY,
      'accumulate above the durable multi-week floor and hold',
      { entry: buy, exit: optSell, stop: floor }, 'weeks'),
    mk(PATH_KEYS.AVOID, ACTIONS.AVOID,
      'no thesis validates entry here — don’t buy',
      { entry: null, exit: null, stop: null }, 'n/a', null),
  ];
}

/* score one path against ctx → { viability, evidence }. PURE; every branch either has evidence or a
   `no-data` note. The heuristics encode the SHAPE only (see the header). */
function scorePath(key, ctx) {
  const ev = [];
  let v = PATH_BASE_VIABILITY, realSignals = 0;
  const add = (delta, signal, note) => { v += delta; realSignals++; ev.push({ signal, delta, note }); };
  const nodata = note => ev.push({ signal: 'no-data', delta: 0, note });

  // a read we can't trust yields NO actionable path (Gate-0 spirit; never decisive off a bad feed).
  if (ctx.reliable === false) {
    return { viability: UNRELIABLE_VIABILITY, evidence: [{ signal: 'unreliable', delta: 0, note: 'quote not reliable — no path is actionable off this read' }] };
  }
  const regime = ctx.regime, phase = ctx.phase;
  const falling = regime === 'falling', rising = regime === 'rising';
  const decay = phase === 'decay', basing = phase === 'basing';
  const underwater = ctx.underwater === true;
  const breakdown = ctx.mom === 'breakdown';
  const haveRegime = regime != null && regime !== 'unknown';
  const havePhase  = phase != null && phase !== 'unknown';
  const scalpEntry = ctx.enteredUnder === PATH_KEYS.SCALP;   // P5: a lot entered as a scalp is flip-only/no-hold

  switch (key) {
    case PATH_KEYS.VALUE_HOLD: {
      if (ctx.aboveFloor === true)       add(+ABOVE_FLOOR_VALUE_BONUS, 'above-floor', 'live above the durable multi-week floor');
      else if (ctx.aboveFloor === false) add(-BELOW_FLOOR_VALUE_PENALTY, 'below-floor', 'live below the multi-week floor — value thesis gutted');
      else                                nodata('no multi-week floor read — value thesis unproven (P3 term structure)');
      if (falling) add(-FALLING_HOLD_PENALTY, 'falling', 'falling regime erodes the floor the value thesis rests on');
      else if (rising) add(+RISING_HOLD_BONUS, 'rising', 'confirmed uptrend rewards holding');
      if (decay) add(-DECAY_HOLD_PENALTY, 'decay', 'decay phase — the floor is still stepping down');
      if (scalpEntry) add(-SCALP_NO_HOLD_PENALTY, 'scalp-no-hold', 'entered as a scalp (flip-only) — an unsold lap is a cut, not a value hold');
      if (!haveRegime) nodata('no regime read');
      break;
    }
    case PATH_KEYS.HOLD_RECOVERY: {
      if (falling) add(-FALLING_HOLD_PENALTY, 'falling', 'falling regime — a recovery hold is fighting the trend');
      else if (rising) add(+RISING_HOLD_BONUS, 'rising', 'uptrend supports a recovery hold');
      if (decay) add(-DECAY_HOLD_PENALTY, 'decay', 'decay phase — lows still stepping down, not recovering');
      else if (basing) add(+BASING_RECOVERY_BONUS, 'basing', 'basing phase — lows flattened, a recovery is plausible');
      if (scalpEntry) add(-SCALP_NO_HOLD_PENALTY, 'scalp-no-hold', 'entered as a scalp (flip-only) — an unsold lap migrates to cut, never a recovery hold');
      if (!underwater) nodata('lot is not underwater — a recovery hold has little to recover');
      if (!haveRegime && !havePhase) nodata('no regime/phase read');
      break;
    }
    case PATH_KEYS.BE_ESCAPE: {
      if (underwater) add(+UNDERWATER_ESCAPE_BONUS, 'underwater', 'underwater — exiting at cost is a real objective');
      else nodata('not underwater — nothing to escape');
      if (underwater && falling) add(-BE_UNREACHABLE_PENALTY, 'be-unreachable', 'falling while underwater — the band may never print break-even');
      break;
    }
    case PATH_KEYS.LIST_TO_CLEAR: {
      if (falling) add(+FALLING_EXIT_BONUS, 'falling', 'falling regime rewards clearing at market');
      if (decay) add(+DECAY_EXIT_BONUS, 'decay', 'decay phase — bank it before it bleeds further');
      if (breakdown) add(+BREAKDOWN_EXIT_BONUS, 'breakdown', 'live 2h breakdown adds urgency to clear');
      if (!haveRegime && !havePhase) nodata('no regime/phase read — clear-at-market stays a neutral fallback');
      break;
    }
    case PATH_KEYS.CUT: {
      if (falling) add(+FALLING_EXIT_BONUS, 'falling', 'falling regime — cut to stop the decline');
      if (decay) add(+DECAY_EXIT_BONUS, 'decay', 'decay phase — the knife is still falling');
      if (breakdown) add(+BREAKDOWN_EXIT_BONUS, 'breakdown', 'live 2h breakdown confirms the cut');
      if (underwater) add(+UNDERWATER_ESCAPE_BONUS, 'underwater', 'already underwater — cutting caps the loss');
      if (!falling && !decay && !breakdown) nodata('no decline evidence — cutting is not indicated');
      break;
    }
    case PATH_KEYS.SCALP: {
      const bw = num(ctx.bandWidthPct);
      if (bw != null && bw >= SCALP_MIN_BAND_PCT) add(+SCALP_WIDE_BAND_BONUS, 'wide-band', 'fresh intraday band wide enough to clear tax+margin');
      else if (bw != null)                        add(-SCALP_WIDE_BAND_BONUS, 'narrow-band', 'intraday band too narrow to clear tax+margin');
      else                                         nodata('no intraday band-width read — scalp edge unproven');
      if (falling) add(-SCALP_FALLING_PENALTY, 'falling', 'scalping a faller is adverse selection on the knife (P5 provisional)');
      break;
    }
    case PATH_KEYS.AVOID: {
      // AVOID is the residual: viable exactly when nothing else is. A low, steady floor so an
      // attractive item's real paths outrank it, but a dead item's do not.
      add(0, 'residual', 'the do-nothing fallback');
      break;
    }
    default:
      nodata('unknown path key — no scoring rule');
  }
  // A path that collected NO applicable evidence (only no-data notes) floors to NO_DATA_VIABILITY —
  // low, never zero, never decisive. EXCEPT list-to-clear (the genuinely-neutral clear-at-market
  // fallback) and avoid (the residual), which are meaningful AT the base prior even with no evidence.
  if (realSignals === 0 && key !== PATH_KEYS.LIST_TO_CLEAR && key !== PATH_KEYS.AVOID) {
    return { viability: NO_DATA_VIABILITY, evidence: ev };
  }
  return { viability: clamp01(v), evidence: ev };
}

/* weighPaths(paths, ctx) → { dominant, weighed, enteredUnder, migration }.
   Scores each enumerated path (viability + evidence), returns them sorted by viability DESC (the
   `weighed` menu), with `dominant` = the top-ranked path. Tracks the declared entry path
   (ctx.enteredUnder) and raises a raw `migration` flag when the dominant path is no longer the one
   the lot was entered under. NOTE: migration here is the INSTANTANEOUS flag only — P4b adds the
   arm-then-confirm persistence gate + hysteresis so a flapping weight can't whiplash a headline.
   Stable sort by (viability desc, then original enumeration order) so ties are deterministic. */
export function weighPaths(paths, ctx = {}) {
  const c = ctx || {};
  const scored = (paths || []).map((p, i) => {
    const { viability, evidence } = scorePath(p.key, c);
    return { ...p, viability, evidence, _i: i };
  });
  scored.sort((a, b) => (b.viability - a.viability) || (a._i - b._i));
  const weighed = scored.map(({ _i, ...p }) => p);
  const dominant = weighed[0] || null;
  const enteredUnder = c.enteredUnder != null ? c.enteredUnder : null;
  const migration = !!(dominant && enteredUnder != null && dominant.key !== enteredUnder);
  return { dominant, weighed, enteredUnder, migration };
}
