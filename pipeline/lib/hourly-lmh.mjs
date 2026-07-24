// hourly-lmh.mjs — the PURE per-local-hour LOW/MID/HIGH detail read behind
// `read-window-range.mjs --hourly` (the raw diurnal-detail diagnostic).
//
// The dip/peak SUMMARY (hourProfile) distills the day into two windows — which HIDES the exact
// hour-by-hour shape a placement decision sometimes needs. This helper is the productionised form of a
// one-off that already proved its value twice: it exposed a churn item whose break-even sat ABOVE its
// typical hourly high, and another that had secretly broken out +7% in a day — both invisible in the
// dip/peak summary. It answers "what's the hour-by-hour pattern REALLY" as raw numbers.
//
// PURE over an already-fetched 1h /timeseries array (the SAME series read-window-range already pulls for
// its diurnal profile — no second fetch). LOCAL hours everywhere (getHours()/getDate() — the repo's
// displayed-times-are-LOCAL rule). INFORM-ONLY, n≈0 — it never gates, prices, or ranks; it's a
// diagnostic. Consumer: read-window-range.mjs (--hourly). No fetching here.

// median of a numeric array (middle element of the ascending sort; upper-middle on an even count —
// same convention as windowStats' medOf). null on empty.
function median(arr) {
  const s = arr.filter(v => v != null).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
}

// midOf(low, high) — round((high+low)/2), degrading to whichever side is present. null when neither is.
function midOf(low, high) {
  if (low != null && high != null) return Math.round((high + low) / 2);
  return low != null ? low : (high != null ? high : null);
}

const pad2 = n => String(n).padStart(2, '0');
const localDateKey = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/**
 * hourlyLMH(series1h, { days = 3 }) — per-local-hour (0–23) LOW/MID/HIGH detail off a 1h series.
 * @param {Array} series1h  raw /timeseries 1h points ({timestamp, avgLowPrice, avgHighPrice, …})
 * @param {object} opts     { days = 3 } — how many of the most-recent local dates to break out individually
 * @returns {null | { avgDates, perDayDates, hours }}
 *   avgDates    : the up-to-7 most-recent local dates the 7d-avg block medians over (ascending)
 *   perDayDates : the last `days` local dates, MOST-RECENT-FIRST (the per-day columns)
 *   hours       : [{ h, avg7:{low,mid,high}, perDay:[{date,low,mid,high}|null, …] }, …] for h 0–23
 *                 (every hour 0–23 is present; a field/entry is null when that hour/date had no point).
 *   null when the series is empty (nothing to read — degrade, never a fake read).
 *
 * The 7d-avg block: across the last 7 local dates, LOW = median(avgLowPrice), HIGH = median(avgHighPrice),
 * MID = median(round((avgHigh+avgLow)/2)) — each at that hour-of-day (one 1h point per date per hour).
 * The per-day block: for each of the last `days` dates, that date's own low / mid / high at that hour (null
 * when that date has no point in that hour). LOCAL hour bucketing throughout (getHours on the point's date).
 */
export function hourlyLMH(series1h, { days = 3 } = {}) {
  if (!Array.isArray(series1h) || !series1h.length) return null;
  // bucket every point by (localDate, localHour) → { low, high }. One point per date/hour in a 1h series;
  // on the rare duplicate keep the LAST seen (arbitrary — the series has at most one per key in practice).
  const byKey = new Map();       // `${date} ${h}` → { low, high }
  const dateSet = new Set();
  for (const pt of series1h) {
    if (!pt || pt.timestamp == null) continue;
    if (pt.avgLowPrice == null && pt.avgHighPrice == null) continue;
    const d = new Date(pt.timestamp * 1000);
    const date = localDateKey(d), h = d.getHours();
    dateSet.add(date);
    byKey.set(`${date} ${h}`, { low: pt.avgLowPrice ?? null, high: pt.avgHighPrice ?? null });
  }
  if (!dateSet.size) return null;
  const allDates = [...dateSet].sort();                 // ascending (oldest→newest)
  const avgDates = allDates.slice(-7);                  // up-to-7 most-recent dates the medians span
  const perDayDates = allDates.slice(-Math.max(1, days)).reverse();   // last N, most-recent-first

  const at = (date, h) => byKey.get(`${date} ${h}`) || null;
  const hours = [];
  for (let h = 0; h < 24; h++) {
    const lows = [], mids = [], highs = [];
    for (const date of avgDates) {
      const p = at(date, h);
      if (!p) continue;
      if (p.low != null) lows.push(p.low);
      if (p.high != null) highs.push(p.high);
      const m = midOf(p.low, p.high);
      if (m != null) mids.push(m);
    }
    const perDay = perDayDates.map(date => {
      const p = at(date, h);
      if (!p) return null;
      return { date, low: p.low, mid: midOf(p.low, p.high), high: p.high };
    });
    hours.push({ h, avg7: { low: median(lows), mid: median(mids), high: median(highs) }, perDay });
  }
  return { avgDates, perDayDates, hours };
}
