/* statetransition.mjs — YP2 (#2, PLAN-YIELD). Flags an item sitting in a TRANSITION state worth
   watching closely, off the shipped phase() classifier (js/quotecore.js): a faller that has
   FLATTENED to 'basing' (a potential bottom — the case the screen's falling-exclusion otherwise
   drops), and a 'spike' split by its recent daily-low slope into a HEALTHY reprice (lows rising →
   more holdable) vs FROTH (lows falling → fragile, don't chase). PURE — a DESCRIPTIVE prompt, NOT a
   buy/verdict signal; it populates a "watch closely" list. Slope thresholds inherited from phase(). */
import { PHASE_LOW_FLAT_PCT } from '../../../js/quotecore.js';

/* stateTransition(ph) -> { state, watch, note } | null.
   ph = a phase() result { phase, lowSlope, … }. Returns null for base/decay/unknown (not a
   watch-closely transition). */
export function stateTransition(ph) {
  if (!ph || ph.phase === 'unknown') return null;
  if (ph.phase === 'basing')
    return { state: 'basing', watch: true, note: 'faller flattened — potential bottom forming; watch for a base to enter (not yet a buy)' };
  if (ph.phase === 'spike') {
    const s = ph.lowSlope;
    // D (2026-08-06, the Snape grass entry): the old wording here was "healthy reprice, more holdable
    // than froth" — an unconditional ENDORSEMENT, and it was one of three green signals that talked over
    // the 28d floor check saying "1.68× typical swing above the durable floor — not near durable support"
    // on the same item, the same pass. (That quoted tail is the PRE-2026-08-08 reason text — the
    // "durable support" claim was retired from floorValidator that day; see its MEASURED block. The
    // quote stays as the incident record, not as current phrasing.)
    // The label cannot earn that word: rising lows in a spike's first
    // days is very nearly TAUTOLOGICAL, because the spike is what lifted the lows. All this classifier
    // can honestly separate is rising-lows from falling-lows; whether the new base is PROVEN is a LEVEL
    // question it does not measure. So it now says what it knows and defers to the check that owns the
    // rest (floorValidator, surfaced on the row as the ⚠N×floor probe and in the soft-buy cue) rather
    // than becoming a fourth place that re-derives durable support.
    if (s != null && s > PHASE_LOW_FLAT_PCT)
      return { state: 'spike-rising-lows', watch: true, note: 'spike on RISING lows — better than froth, but the base is UNPROVEN: check the level against durable support (the ⚠N×floor probe) before treating it as holdable' };
    if (s != null && s < -PHASE_LOW_FLAT_PCT)
      return { state: 'spike-falling-lows', watch: true, note: 'spike on FALLING lows — froth, fragile; do not chase' };
    return { state: 'spike', watch: true, note: 'spike — elevated off base; watch whether the lows hold or roll over' };
  }
  return null;   // base / decay → not a watch-closely transition
}
