/* forward-reach.mjs — the shared FORWARD-SCORING primitives over the 1h archive.
 *
 * A level printed at time `ts` is scored by walking the archive FORWARD from it: was the level
 * touched (bid side, avgLow) or reached (ask side, avgHigh) inside a window, and how far did the
 * market actually get. Lifted VERBATIM from join-asym-outcomes.mjs so the reach joiners share ONE
 * implementation of "did the market get there" — the same extraction campaigns.mjs made for the
 * campaign build. Side convention is pinned by js/quotecore.js: a BUY fills against avgLow, a SELL
 * against avgHigh. PURE: no fs, no fetch, no clock — the caller supplies the ts-ascending series.
 *
 * Homed in js/ (not pipeline/lib/market/, which keeps a re-export shim) so js/reach-surface.mjs can
 * build its surface from the same walk the joiners score with: js/ never imports pipeline/.
 */
export const HOUR = 3600;

/* The first index whose bucket is strictly later than ts. */
export function firstIndexAfter(series, ts) {
  let lo = 0, hi = series.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (series[m].ts <= ts) lo = m + 1; else hi = m; }
  return lo;
}

/* The ts of the first bucket in (from, from+windowH] printing avgLowPrice ≤ level, or null. */
export function touchedAt(series, from, level, windowH) {
  if (!series || !series.length || level == null) return null;
  const end = from + windowH * HOUR;
  for (let i = firstIndexAfter(series, from); i < series.length && series[i].ts <= end; i++) {
    const lo = series[i].avgLowPrice;
    if (lo != null && lo <= level) return series[i].ts;
  }
  return null;
}

/* Did any bucket in (from, from+windowH] print avgHighPrice ≥ level. */
export function reachedWithin(series, from, level, windowH) {
  if (!series || !series.length || level == null) return false;
  const end = from + windowH * HOUR;
  for (let i = firstIndexAfter(series, from); i < series.length && series[i].ts <= end; i++) {
    const h = series[i].avgHighPrice;
    if (h != null && h >= level) return true;
  }
  return false;
}

/* The highest avgHighPrice printed in (from, from+windowH], or null. The best an ask could have
 * done — what an under-called level left on the table. */
export function maxHighWithin(series, from, windowH) {
  if (!series || !series.length) return null;
  const end = from + windowH * HOUR;
  let max = null;
  for (let i = firstIndexAfter(series, from); i < series.length && series[i].ts <= end; i++) {
    const h = series[i].avgHighPrice;
    if (h != null && (max == null || h > max)) max = h;
  }
  return max;
}

/* Does the archive extend far enough to RESOLVE an outcome ending at `until`. An unresolved row is
 * DROPPED, never counted as a miss — counting it would bias every rate down by the truncation at the
 * end of the archive. */
export function covers(series, until) {
  return !!(series && series.length && series[series.length - 1].ts >= until);
}
