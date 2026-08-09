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

// bucketSeries1h(series1h) — the ONE (localDate, localHour) bucketing pass shared by hourlyLMH and
// askReachDecay. Every point that carries at least one of low/high is keyed by `${date} ${h}` → {low,high}
// (LOCAL date/hour via getFullYear/getMonth/getDate/getHours); on the rare duplicate the LAST seen wins
// (arbitrary — a 1h series has at most one point per key in practice). Returns { byKey, allDates } where
// allDates is the ascending-sorted (oldest→newest) list of local dates that had ≥1 point anywhere in the
// series; { byKey: new Map(), allDates: [] } on an empty/non-array series (degrade, never throw).
function bucketSeries1h(series1h) {
  const byKey = new Map();
  const dateSet = new Set();
  if (Array.isArray(series1h)) {
    for (const pt of series1h) {
      if (!pt || pt.timestamp == null) continue;
      if (pt.avgLowPrice == null && pt.avgHighPrice == null) continue;
      const d = new Date(pt.timestamp * 1000);
      const date = localDateKey(d), h = d.getHours();
      dateSet.add(date);
      byKey.set(`${date} ${h}`, { low: pt.avgLowPrice ?? null, high: pt.avgHighPrice ?? null });
    }
  }
  return { byKey, allDates: [...dateSet].sort() };
}

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
  const { byKey, allDates } = bucketSeries1h(series1h);
  if (!allDates.length) return null;
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

// --- askReachDecay — the ask-reachability-decay read ---------------------------------------------
//
// DON'T-REBUILD TOMBSTONE (PLAN-DIURNAL-TRIAGE DT3, 2026-08-09). This module used to export
// `hourlyDrift` — a per-hour least-squares slope of each hour-of-day's MID across the last N local
// dates, plus a `dominant` direction/uniformity synthesis (PLAN-HOURLY-3DAY-TREND HT0). **It was
// deleted because it was measured to carry no information.** Leakage-clean out-of-sample scoring of
// the production code at its shipped days=3 config: median per-item MAE **276.7bp vs 197.8bp** for
// simply predicting no change, and it beat that baseline on **6 of 380 items**. Direction was
// **49.7%** — a coin flip. (An earlier "43–46%, worse than chance" read was a design artifact: with
// 3 equally-spaced points the fitted slope shares its most recent term with the next-day target,
// forcing corr = −0.5 under pure noise. The honest answer is zero information, not anti-signal.)
// No window length rescues it — days=4/7/14 all lose to no-change, an hours-anchored window is just
// a cleaner measurement of the same non-signal, and a dynamic window's own selected length changes
// day-over-day for the median item on 43% of days. This is why `js/reverseflip.mjs`'s
// `THIN_DRIFT_DAYS = 7` patch (a thin book's 3-day slope "whipsaws") never worked: the whipsaw was
// the n=2 fit itself, not the window. Do not rebuild the slope read.
// Honesty limits on the refutation: one 74-day era, one update cycle, item-day clustering means
// effective n is well below nominal. It is a strong null, not a proof of impossibility.
//
// What SURVIVED is the sub-signal that was buried inside it: the per-day rate at which a candidate
// ask level is actually being REACHED, and whether that rate is sliding. Measured out-of-sample it
// predicts next-day ask reach at **12.2% vs 30.8%**, and survives stratifying on yesterday's reach
// (at prev 70–100%: 18.6% vs 68.3%; n=5,096 signals / 293 items — one 20-day eval window, a
// synthetic ask level, and reach-of-high is a FILL PROXY, not an executed fill). That is the one
// piece worth keeping, so it is extracted here as its own first-class export.
//
// Reuses bucketSeries1h — the SAME (localDate, localHour) bucketing hourlyLMH uses; no second fetch.
// INFORM-ONLY, n≈0: this never gates, prices, ranks, or feeds a cut/alert input.

/**
 * askReachDecay(series1h, { days = 3, ask }) — is a candidate ask level sliding out of reach?
 * @param {Array} series1h  raw /timeseries 1h points (SAME series hourlyLMH/read-window-range fetch)
 * @param {object} opts     { days = 3, ask } — how many of the most-recent local dates to score, and
 *                          the ask level to test reach against. days=3 is the validated config.
 * @returns {null | { perDay, decaying }}
 *   perDay   : [{ date, hoursReached, hoursLogged, frac }, …] oldest→newest — per local date, how many
 *              of that date's LOGGED hours had a HIGH that reached `ask`.
 *   decaying : true when that RATE is non-increasing across the scored dates AND the newest is
 *              strictly below the oldest.
 *   null when `ask` is absent, or fewer than 2 local dates are available — degrade, never a fake read.
 */
export function askReachDecay(series1h, { days = 3, ask = null } = {}) {
  if (ask == null) return null;
  const { byKey, allDates } = bucketSeries1h(series1h);
  if (allDates.length < 2) return null;
  const dates = allDates.slice(-Math.max(1, days));   // oldest → newest
  const at = (date, h) => byKey.get(`${date} ${h}`) || null;
  if (dates.length < 2) return null;

  // Reported as a RATE (hoursReached / hoursLogged), not a raw count — the newest local date is
  // usually partial (fewer hours logged so far today), so a raw count drop (e.g. 24→24→11) overstates
  // the decay when today only has ~15 hours logged. `decaying` is judged on the rate, so a partial day
  // can't false-trigger; `hoursReached` is retained for callers that want the raw count.
  const perDay = dates.map(date => {
    let hoursReached = 0, hoursLogged = 0;
    for (let h = 0; h < 24; h++) {
      const p = at(date, h);
      if (p && p.high != null) { hoursLogged++; if (p.high >= ask) hoursReached++; }
    }
    return { date, hoursReached, hoursLogged, frac: hoursLogged ? hoursReached / hoursLogged : null };
  });
  const fr = perDay.map(p => p.frac);
  let nonIncreasing = true;   // on the RATE, with a tiny epsilon so equal rates don't count as an increase
  for (let i = 1; i < fr.length; i++) if (fr[i] != null && fr[i - 1] != null && fr[i] > fr[i - 1] + 1e-9) { nonIncreasing = false; break; }
  const decaying = nonIncreasing && fr[0] != null && fr[fr.length - 1] != null && fr[fr.length - 1] < fr[0];
  return { perDay, decaying };
}
