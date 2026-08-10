/**
 * structural-admission.mjs — the STRUCTURAL fetch-pool admission gate (PLAN-LANE-ADMISSION, Chunk B).
 *
 * Ben's 2026-07-25 admission redesign (PLAN-LANE-ADMISSION.md "The validated admission system"): the
 * current pre-fetch gate (`gatecandidates.mjs` `eachLiquidCandidate` + `admission.mjs`) mixes EDGE
 * thresholds into "what to fetch" (the `volDay×mid ≥ 4.5b` turnover floor is a crowding-out mechanism —
 * the Abyssal-bludgeon/Sanguinesti starvation incident). This module replaces the ADMISSION criteria
 * with ONE universal, EDGE-BLIND structural gate + a volume-based lane split. Edge judgment moves
 * entirely to a later ranking stage (Chunks C/D) — nothing here computes an edge.
 *
 * SCOPE (Chunk B — library only, purely additive behind a flag):
 *   - This is a NEW ALTERNATE iterator with the SAME callback shape as
 *     `eachLiquidCandidate` (gatecandidates.mjs:211), selected via the library-level `t.GATE` (default
 *     `legacy`). With `--gate legacy` (or the flag omitted) NOTHING here runs and the screen is
 *     byte-identical to today. It does NOT replace `eachLiquidCandidate`, and it does NOT touch
 *     `spec.edge`/`rankAndSlice`/`surviveMode` — the per-mode edge STILL runs post-admission in this
 *     chunk (edge-blind admission end-to-end is Chunk D's job; here we only swap the admission criteria).
 *
 * The universal gate (bulk, no per-item fetch — every input comes off the /24h `v24` record + mapping):
 *   value    = mid = (avgHigh+avgLow)/2            ≥ MIN_VALUE (100 gp)       — dust cut
 *   thin     = min(hpv, lpv)                       ≥ max(limit, MIN_THIN)     — two-sidedness + reliability
 *                                                    (null limit → MIN_THIN=25 fallback, NOT exclude)
 *   notional = value × volDay                      ≥ MIN_NOTIONAL (25m/day)   — 2-D money-flow floor
 * LANE (the margin-regime discriminator, off TOTAL daily volume):
 *   volDay ≥ CHURN_VOL_CUT (20k) → 'churn'  (high-turnover; margin harvested intraday)
 *   volDay <  CHURN_VOL_CUT      → 'gear'   (low-turnover;  margin harvested over multiple days)
 *
 * volDay here = hpv + lpv (total two-sided daily volume). `thin` (the ADMISSION field name) is the
 * min-side DEPTH, an ABSOLUTE floor — deliberately NOT a balance ratio (min/max): a ratio mis-flags
 * hugely-liquid-but-lopsided items (bird nests, moon armour sets) as ghost books. The real question is
 * "can I fill a limit's worth on the thin side?" → absolute depth. See PLAN-LANE-ADMISSION.md "Why each
 * rule" for the full hard-won lessons — do NOT "simplify" these back to a single value/volume/ratio axis.
 *
 * NAMING (PLAN-LANE-ADMISSION finding #2 — a real collision risk): the lane field is `volLane`
 * ('gear'|'churn'). It is ORTHOGONAL to the existing `churn` **flip-niche mode** in `js/flip-niches.mjs`
 * (`FLIP_NICHES.churn`). A mode is an EDGE-COMPUTATION strategy; `volLane` is a PRE-EDGE structural
 * bucket every mode's candidates fall into. A future grep for "churn" will hit both — they are unrelated.
 * Never reuse `mode`/bare `lane` for this concept near `FLIP_NICHES`.
 *
 * THRESHOLDS ARE PLACEHOLDERS (process rule 4): MIN_NOTIONAL 25m/day, MIN_THIN 25, CHURN_VOL_CUT 20k
 * are snapshot+own-book calibrated (they sit in real gaps and hold 59/60 real-flip recall on the live
 * cache) but are NOT outcome-calibrated — re-check once ranking + real fills accrue (join-outcomes, à la
 * SC5). `thin ≥ max(limit,25)` is a RELIABILITY line, not an outcome-validated one. Do not present these
 * as calibrated.
 *
 * PURE: no fetch, no fs, no CLI/network state — fixture-testable with synthetic v24 data, exactly like
 * `gatecandidates.mjs`/`admission.mjs`. No live data in the tests (CLAUDE.md rule 4).
 */

// --- PLACEHOLDER thresholds (rule 4) — see header. -------------------------------------------------
export const MIN_VALUE = 100;               // gp — dust cut (item price = mid)
export const MIN_THIN = 25;                 // min-side depth floor + null-limit fallback (~1 thin-side trade/hr)
export const MIN_NOTIONAL = 25_000_000;     // value × volDay ≥ 25m/day — the 2-D money-flow floor
export const CHURN_VOL_CUT = 20_000;        // volDay ≥ this → churn lane; below → gear lane

// The structural thresholds bundled (mirrors DEFAULT_THRESHOLDS' role) — fixtures/import callers that
// don't pass an override use these; screen-flip-niches.mjs may fold overrides into its THRESHOLDS object.
export const DEFAULT_STRUCTURAL = {
  minValue: MIN_VALUE, minThin: MIN_THIN, minNotional: MIN_NOTIONAL, churnVolCut: CHURN_VOL_CUT,
};

// classifyVolLane(volDay) -> 'gear' | 'churn'. The ONLY lane discriminator: total daily volume (NOT
// value — a 4m item at limit-8 trades like gear, a 10k item at 1.14m/day trades like churn; value does
// not separate the regimes, volume does). Pure, total-order, no null branch (a null/NaN volDay is < the
// cut → 'gear', the conservative low-turnover bucket).
export function classifyVolLane(volDay, { churnVolCut = CHURN_VOL_CUT } = {}) {
  return (volDay >= churnVolCut) ? 'churn' : 'gear';
}

/* structuralGate(item, thresholds?) -> { pass, reason, thinDepth, notional, volLane }
   The universal structural admission predicate, evaluated on ONE item's bulk numbers. Pure — takes
   explicit named inputs so a fixture can drive it unambiguously:
     value  — the item price (mid). volDay — TOTAL two-sided daily volume (hpv+lpv).
     hpv/lpv — the two-sided daily volumes (min → the thin-side depth). limit — the 4h GE buy limit
               (null ⇒ MIN_THIN fallback, NOT exclude — ~89 newer gear items carry limit=null).
   `reason` names the FIRST failed rule (null when pass), so a caller can report WHY (SC1-style) instead
   of a silent drop. `thinDepth`/`notional`/`volLane` are returned even on a fail (they're computed
   regardless) for logging/inspection. The three gates are ANDed — order (value → thin → notional) is
   cheapest-first and only affects which `reason` a multi-failure item reports. */
export function structuralGate({ value, volDay, hpv, lpv, limit = null }, t = DEFAULT_STRUCTURAL) {
  const minValue = t.minValue ?? MIN_VALUE, minThin = t.minThin ?? MIN_THIN;
  const minNotional = t.minNotional ?? MIN_NOTIONAL, churnVolCut = t.churnVolCut ?? CHURN_VOL_CUT;
  const thinDepth = Math.min(hpv || 0, lpv || 0);              // ABSOLUTE min-side depth (NOT a ratio)
  const notional = (value || 0) * (volDay || 0);
  const volLane = classifyVolLane(volDay, { churnVolCut });
  // null limit → MIN_THIN fallback (max(0, 25) = 25) rather than exclude — the documented newer-gear case.
  const thinFloor = Math.max(limit != null ? limit : 0, minThin);
  let reason = null;
  if (!(value >= minValue)) reason = 'value';                 // dust cut
  else if (!(thinDepth >= thinFloor)) reason = 'thin';        // two-sidedness + reliability (kills ghosts)
  else if (!(notional >= minNotional)) reason = 'notional';  // 2-D money-flow floor
  return { pass: reason === null, reason, thinDepth, notional, volLane };
}

/* eachStructuralCandidate(ctx, thresholds, fn) -> [candidate]
   The ALTERNATE iterator, SAME callback shape + return contract as `eachLiquidCandidate`
   (gatecandidates.mjs:211): iterate v24, apply the UNIVERSAL structural gate (replacing the two-sided +
   floorVol/gpFloor admission), and call `fn(ctx) -> candidate|null` for each survivor; collect the
   non-null candidates. `gateCandidates` can therefore swap this in for `eachLiquidCandidate` without
   changing the per-mode `fn` (spec.edge) at all.

   ctx = { v24, map } — v24 is the /24h record map; map.byId[id].limit is the GE buy limit (structural
   admission needs it for the thin floor; `eachLiquidCandidate` didn't, since its floor was volume-only).

   The context object handed to `fn` carries the SAME keys `eachLiquidCandidate` provides
   ({ id, d, hpv, lpv, limitVol, avgHigh, avgLow, mid, thin }) PLUS the structural extras
   ({ volDay, volLane, thinDepth }). One deliberate semantic bridge: `fn`'s `thin` flag historically
   means "admitted below the unit floor via gp-flow → treat as a big-ticket" (grade cap, thin reserve,
   attention-floor EXEMPT). The structural world has no unit-floor/gp-flow split; its analogue of a
   low-turnover big-ticket is the GEAR lane. So `thin := (volLane === 'gear')` — gear items ride the
   existing big-ticket handling (exempt from the MIN_GPD attention floor, thin reserve), churn items are
   treated as ordinary liquid rows. `limitVol` is set to the min-side depth (the same quantity
   `eachLiquidCandidate` puts there: min(hpv,lpv)), so the downstream `expUnits(limit, limitVol)` math is
   unchanged in shape. Every survivor candidate additionally gets `volLane`/`thinDepth`/`volDay` attached
   (additive — downstream ignores unknown fields; the returned object is a CLONE so `fn`'s own fields win). */
export function eachStructuralCandidate({ v24, map }, t = DEFAULT_STRUCTURAL, fn) {
  const out = [];
  const byId = (map && map.byId) || {};
  for (const idStr in v24) {
    const id = +idStr; const d = v24[idStr]; if (!d) continue;
    const hpv = d.highPriceVolume || 0, lpv = d.lowPriceVolume || 0;
    const avgHigh = d.avgHighPrice, avgLow = d.avgLowPrice;
    if (!avgHigh || !avgLow) continue;                          // no price → can't value it
    const mid = (avgHigh + avgLow) / 2;
    const volDay = hpv + lpv;                                   // TOTAL two-sided daily volume
    const limit = byId[id]?.limit ?? null;
    const g = structuralGate({ value: mid, volDay, hpv, lpv, limit }, t);
    if (!g.pass) continue;                                      // structural admission: value ∧ thin ∧ notional
    const thin = g.volLane === 'gear';                          // gear = the big-ticket analogue (see header)
    const c = fn({ id, d, hpv, lpv, limitVol: g.thinDepth, avgHigh, avgLow, mid, thin,
                   volDay, volLane: g.volLane, thinDepth: g.thinDepth });
    if (c) out.push({ volLane: g.volLane, thinDepth: g.thinDepth, volDay, ...c });
  }
  return out;
}
