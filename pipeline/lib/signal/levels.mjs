// levels.mjs — PURE structural-support / cut-trigger levels for the watch loop (chunk V2).
//
// Given a recent per-day LOW series (which watch-positions.mjs derives from the 1h /timeseries it ALREADY
// fetches for its window-context line — no new network here), compute the recent STRUCTURAL
// SUPPORT and a cut-trigger level below it. OUTPUT-ONLY in V2: watch-positions.mjs prints these as context
// on held rows; they change NO verdict and raise NO alert (conviction gating off a broken tripwire
// is chunk V4, not here). Pure, DOM-free, fs-free, network-free — node-importable + fixture-tested.

// --- named tunables ------------------------------------------------------------------------
// Lookback (most recent N daily lows) over which structural support is read. ~5 days = enough to
// see a swing without dragging in a stale regime.
export const SUPPORT_LOOKBACK_DAYS = 5;
// Cut-trigger sits this fraction below support: a break of MORE than δ is a convincing structural
// break (the level Ben's live 2026-07-06 webweaver example measured against). PLACEHOLDER pending
// validation — cited nowhere as calibrated; a display level only in V1/V2 (it gates nothing until V4).
export const CUT_TRIGGER_DELTA = 0.005;   // 0.5% below support

/* Recent structural support from a per-day LOW series (chronological, oldest→newest).
   Definition: the most recent HIGHER-LOW — the pivot low that HELD, i.e. the earlier low of the
   most recent adjacent pair where the later day's low did NOT undercut it (low[i] >= low[i-1] ⇒
   low[i-1] is support that held). If the series only steps DOWN (no higher-low anywhere in the
   lookback), support degrades to the N-day minimum low (the ultimate recent floor).
   Graceful degradation: fewer than 2 usable lows → null (too little to call a level). */
export function structuralSupport(dayLows, lookback = SUPPORT_LOOKBACK_DAYS) {
  const lows = (dayLows || []).filter(v => v != null && v > 0).slice(-lookback);
  if (lows.length < 2) return null;
  for (let i = lows.length - 1; i >= 1; i--) {
    if (lows[i] >= lows[i - 1]) return lows[i - 1];   // the level the later day held above
  }
  return Math.min(...lows);   // monotonic decline → the recent floor is the only support
}

/* Cut-trigger = support × (1 − δ). null-safe (null support → null trigger). */
export function cutTrigger(support, delta = CUT_TRIGGER_DELTA) {
  if (support == null) return null;
  return support * (1 - delta);
}

