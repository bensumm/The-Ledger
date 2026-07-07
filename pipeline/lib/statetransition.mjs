/* statetransition.mjs — YP2 (#2, PLAN-YIELD). Flags an item sitting in a TRANSITION state worth
   watching closely, off the shipped phase() classifier (js/quotecore.js): a faller that has
   FLATTENED to 'basing' (a potential bottom — the case the screen's falling-exclusion otherwise
   drops), and a 'spike' split by its recent daily-low slope into a HEALTHY reprice (lows rising →
   more holdable) vs FROTH (lows falling → fragile, don't chase). PURE — a DESCRIPTIVE prompt, NOT a
   buy/verdict signal; it populates a "watch closely" list. Slope thresholds inherited from phase(). */
import { PHASE_LOW_FLAT_PCT } from '../../js/quotecore.js';

/* stateTransition(ph) -> { state, watch, note } | null.
   ph = a phase() result { phase, lowSlope, … }. Returns null for base/decay/unknown (not a
   watch-closely transition). */
export function stateTransition(ph) {
  if (!ph || ph.phase === 'unknown') return null;
  if (ph.phase === 'basing')
    return { state: 'basing', watch: true, note: 'faller flattened — potential bottom forming; watch for a base to enter (not yet a buy)' };
  if (ph.phase === 'spike') {
    const s = ph.lowSlope;
    if (s != null && s > PHASE_LOW_FLAT_PCT)
      return { state: 'spike-rising-lows', watch: true, note: 'spike on RISING lows — healthy reprice, more holdable than froth' };
    if (s != null && s < -PHASE_LOW_FLAT_PCT)
      return { state: 'spike-falling-lows', watch: true, note: 'spike on FALLING lows — froth, fragile; do not chase' };
    return { state: 'spike', watch: true, note: 'spike — elevated off base; watch whether the lows hold or roll over' };
  }
  return null;   // base / decay → not a watch-closely transition
}
