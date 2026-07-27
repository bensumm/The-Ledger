/* velocity.mjs — PURE velocity classification off a MEASURED round-trip hold time (#3, PLAN-YIELD).
   A fast-cycler frees capital quickly; a slow-hold ties it up. The class is derived from the
   observed buy-fill→sell-fill hold (join-outcomes.mjs holdTimeSec), never guessed from liquidity.

   The thresholds are NAMED PLACEHOLDERS pending validation — same discipline as phase()/rating
   cutoffs; do NOT cite them as calibrated. A per-item class off a handful of lots is a LABEL, not a
   rate (the ~116-lot concentration caveat applies). */
export const VELOCITY_FAST_HRS = 6;    // round-trip under this = fast-cycler
export const VELOCITY_SLOW_HRS = 48;   // round-trip at/over this = slow-hold

/* velocityClass(holdTimeSec) -> 'fast-cycler' | 'mid' | 'slow-hold' | 'n/a'
   n/a when there is no measured round-trip (open lot, unmatched sell, buy campaign). */
export function velocityClass(holdTimeSec) {
  if (holdTimeSec == null || !(holdTimeSec >= 0)) return 'n/a';
  const h = holdTimeSec / 3600;
  if (h < VELOCITY_FAST_HRS) return 'fast-cycler';
  if (h < VELOCITY_SLOW_HRS) return 'mid';
  return 'slow-hold';
}
