/* modules/froth.mjs — the froth CLASSIFIER probe (PM1).
 *
 * THEORY (under test; rule 4). On a spiking / rising item, is the move a HEALTHY reprice or a KNIFE?
 * Per the /scan froth doctrine this is a CLASSIFIER, not a predictor: read the recent-LOW trajectory —
 *   rising-then-holding lows (low-slope ≥ 0)  → 'healthy-reprice' (the floor moved up with the price)
 *   falling lows           (low-slope < 0)     → 'knife'          (price up but the floor is dropping)
 * A trajectory-STATE 'observe' tag; touches no number, feeds no verdict. It reads the low-slope the
 * shared quotecore phase() ALREADY computes off the ts6h series the row was quoted from (ctx.phase),
 * so it adds ZERO fetch and re-implements no market math.
 *
 * Only fires on a frothy row (phase 'spike' OR a rising regime) — a flat/base item isn't frothy, so
 * there is nothing to classify and the probe stays silent (empty-passthrough).
 */
// low-slope (fractional daily-low change, quotecore phase().lowSlope) below this = knife (falling lows);
// at/above = holding-or-rising = healthy. Matches PHASE_LOW_FLAT_PCT so "flat" reads as holding, not a knife.
export const KNIFE_SLOPE_PCT = -0.02;

export default {
  name: 'froth',
  version: 1,
  theory: 'on a spike/rising row, rising-or-holding lows = healthy reprice; falling lows = a knife (classifier, not predictor)',
  stage: 'observe',
  surfaces: ['screen', 'quote'],
  probe(row, ctx = {}) {
    if (!row || !row.reliable) return null;
    const ph = ctx.phase;
    const frothy = (ph && ph.phase === 'spike') || row.rising;
    if (!frothy) return null;                            // not frothy → nothing to classify
    if (!ph || ph.lowSlope == null) return null;         // no low-trajectory read → silent (positive-evidence)
    const slope = ph.lowSlope;
    const kind = slope < KNIFE_SLOPE_PCT ? 'knife' : 'healthy-reprice';
    const sym = kind === 'knife' ? '🔪froth' : '📈froth';
    return { tag: `${sym} ${kind}`, note: `low-slope ${(slope * 100).toFixed(1)}%` };
  },
};
