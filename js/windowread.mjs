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

// --- recency split (reach-contamination guard) ------------------------------------------------
// The touched/reached COUNT above is over the whole N-night window, so on an item that changed
// price REGIME inside the window the count is dominated by stale days and misdescribes the level's
// CURRENT reachability. Two-sided, one bug — in BOTH the stale days are the OLDER, higher-priced ones:
//   • ask, FALLING/crashed item — reached 14/14 (or 4/14) full but ~0/3 recent: old higher days
//     cleared the ask; recent nights don't reach it, so it's stranded/pre-regime (super-restore,
//     nest, blood rune).
//   • bid, RISING/repriced item — touched 14/14 full but ~1/3 recent: old cheaper days cleared a low
//     bid; the floor has since risen, so the bid may not fill.
// The fix is NOT a looser threshold (that re-opens the DHCB band-top-artifact miss) — it's showing
// the recent-N hit rate BESIDE the full one and flagging when the full count is rosier than recent
// ("stale-optimistic"). Pure over windowStats().days ([[key,{low,hi}], …] oldest→newest).
export const RECENT_NIGHTS = 3;      // recent window compared against the full window
export const RECENCY_DIVERGE = 1 / 3; // hit-fraction gap that flags a stale-regime contamination

export function recencySplit(days, side, level, recentN = RECENT_NIGHTS) {
  const vals = days.map(([, n]) => (side === 'bid' ? n.low : n.hi)).filter(v => v != null);
  const hit = side === 'bid' ? (v => v <= level) : (v => v >= level);
  const recent = vals.slice(-recentN);           // days is oldest→newest ⇒ tail = most recent
  const fullN = vals.length, recentDays = recent.length;
  const fullHit = vals.filter(hit).length, recentHit = recent.filter(hit).length;
  const fullFrac = fullN ? fullHit / fullN : 0;
  const recentFrac = recentDays ? recentHit / recentDays : 0;
  // only a meaningful call with a full recent window AND a longer full window behind it
  const scored = recentDays >= recentN && fullN >= recentN + 2;
  // divergence: a big fraction gap, OR the definitive case — recent nights hit it ZERO times while
  // the full window shows a real rate (≥20%). The zero-clause catches a partial-rate crash like blood
  // rune (4/14 full → 0/3 recent, a 0.29 gap under the fraction threshold but unambiguously stale).
  const gap = fullFrac - recentFrac;
  const diverges = scored && (Math.abs(gap) >= RECENCY_DIVERGE || (recentHit === 0 && fullHit > 0 && fullFrac >= 0.2));
  const staleOptimistic = diverges && recentFrac < fullFrac; // full count rosier than recent = the trap
  return { fullN, fullHit, recentDays, recentHit, fullFrac, recentFrac, diverges, staleOptimistic };
}

// the recent-N slice's quantile, to sit beside the full-window quantile in a summary line.
export function recentQuant(days, side, p, recentN = RECENT_NIGHTS) {
  const vals = days.map(([, n]) => (side === 'bid' ? n.low : n.hi)).filter(v => v != null).slice(-recentN);
  if (!vals.length) return null;
  const sorted = [...vals].sort((a, b) => a - b);
  return side === 'bid' ? quantLow(sorted, p) : quantHigh(sorted, p);
}

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
