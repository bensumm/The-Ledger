// windowread.mjs — the PURE window-range math shared by windowrange.mjs (the CLI read)
// and watch.mjs (the per-offer window-context line). Extracted 2026-07-05 so watch could
// print time-of-day context without duplicating the bucketing/quantile logic — one owner.
//
// All functions are pure over an already-fetched 1h /timeseries array; no fetching here.
// Window hours are LOCAL wall-clock — the machine clock IS Ben's wall clock (verified
// 2026-07-05; only UTC-printing stamps like the old watch header ever suggested otherwise).

// day key = local date of the morning the window ends on (pre-midnight hours belong to
// tomorrow's morning when the window crosses midnight)
function dayKey(d, wStart, wEnd) {
  const pad2 = n => String(n).padStart(2, '0');
  const key = new Date(d);
  if (wStart > wEnd && d.getHours() >= wStart) key.setDate(key.getDate() + 1);
  return `${key.getFullYear()}-${pad2(key.getMonth() + 1)}-${pad2(key.getDate())}`;
}

export const inWindow = (h, wStart, wEnd) =>
  wStart < wEnd ? (h >= wStart && h < wEnd) : (h >= wStart || h < wEnd);

// bid touched on ≥p of days ⇔ bid ≥ the p-quantile of window lows (ascending)
export const quantLow = (sortedLows, p) =>
  sortedLows[Math.min(sortedLows.length - 1, Math.max(0, Math.ceil(p * sortedLows.length) - 1))];

// ask reached on ≥p of days ⇔ ask ≤ the (1−p)-quantile of window highs (ascending): p of the
// highs sit at/above that level (mirror of quantLow; p=1 → the minimum high = reached every day)
export const quantHigh = (sortedHis, p) =>
  sortedHis[Math.max(0, Math.min(sortedHis.length - 1, sortedHis.length - Math.ceil(p * sortedHis.length)))];

export const touchedDays = (lows, bid) => lows.filter(l => l <= bid).length;
export const reachedDays = (his, ask) => his.filter(h => h >= ask).length;

/**
 * Bucket a 1h timeseries into per-day window stats.
 * @param {Array} series  raw /timeseries 1h points ({timestamp, avgLowPrice, avgHighPrice, lowPriceVolume, highPriceVolume})
 * @param {object} opts   { nights=14, wStart, wEnd, now=new Date() }
 * @returns {null | { days, lows, his, medVolLo, medVolHi }}
 *   days: [[key, {low, hi, volLo, volHi}], …] oldest→newest (complete days only — today is
 *   skipped while we're inside the window); lows/his: ascending-sorted arrays for the
 *   quantile helpers; null when no traded window-hours exist in the history.
 */
export function windowStats(series, { nights = 14, wStart, wEnd, now = new Date() } = {}) {
  const days = new Map();
  const today = inWindow(now.getHours(), wStart, wEnd) ? dayKey(now, wStart, wEnd) : null;
  for (const pt of series) {
    const d = new Date(pt.timestamp * 1000);
    if (!inWindow(d.getHours(), wStart, wEnd)) continue;
    const key = dayKey(d, wStart, wEnd);
    if (key === today) continue;
    const n = days.get(key) || { low: null, hi: null, volLo: 0, volHi: 0 };
    if (pt.avgLowPrice != null && (n.low == null || pt.avgLowPrice < n.low)) n.low = pt.avgLowPrice;
    if (pt.avgHighPrice != null && (n.hi == null || pt.avgHighPrice > n.hi)) n.hi = pt.avgHighPrice;
    n.volLo += pt.lowPriceVolume || 0;
    n.volHi += pt.highPriceVolume || 0;
    days.set(key, n);
  }
  const scored = [...days.entries()].filter(([, n]) => n.low != null || n.hi != null)
    .sort((a, b) => b[0].localeCompare(a[0])).slice(0, nights).reverse();
  if (!scored.length) return null;

  const lows = scored.map(([, n]) => n.low).filter(v => v != null).sort((a, b) => a - b);
  const his = scored.map(([, n]) => n.hi).filter(v => v != null).sort((a, b) => a - b);
  const medOf = arr => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  return {
    days: scored,
    lows,
    his,
    medVolLo: medOf(scored.map(([, n]) => n.volLo)),
    medVolHi: medOf(scored.map(([, n]) => n.volHi)),
  };
}
