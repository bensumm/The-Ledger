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
// hourlyDrift. Every point that carries at least one of low/high is keyed by `${date} ${h}` → {low,high}
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

// --- hourlyDrift (PLAN-HOURLY-3DAY-TREND HT0) — the per-hour DAY-OVER-DAY slope read -------------
// hourlyLMH (above) prints the raw per-hour grid; it leaves the day-over-day TREND for a human to eyeball.
// hourlyDrift computes it: for each local hour-of-day, a least-squares slope of that hour's MID across the
// last N (default 3) local dates, plus a whole-item synthesis (dominant direction/magnitude + whether every
// hour moves the same way, or it's a SPLIT shape) and an optional ask-reachability-decay sub-signal (the
// rapier catch: per-day count of hours whose HIGH reached a candidate ask, and whether that count is
// falling day-over-day). Reuses bucketSeries1h — the SAME (localDate, localHour) bucketing hourlyLMH uses;
// no second fetch, no duplicated bucketing logic.
//
// INFORM-ONLY, n≈0 — mirrors hourlyLMH's own disclaimer exactly: this NEVER gates, prices, ranks, or feeds
// a cut/alert input. It is a 3-point (by default) trend read, not a forecast — "this hour has been
// stepping down," never "it will continue." All thresholds below (HOURLY_DRIFT_FLAT_FRAC, the uniformity
// bar) are PLACEHOLDER constants pending an F1-style retro with a real sample; they only classify a
// DESCRIPTION (direction/uniformity), never a decision — the one place a drift number moves a displayed
// LABEL is the caller's job (screen-flip-niches.mjs HT3), always shown with the number inline, never silent.

const HOURLY_DRIFT_FLAT_FRAC = 0.003;   // PLACEHOLDER (n≈0) — |slope| below this × the reference level per day ⇒ 'flat'
const HOURLY_DRIFT_UNIFORM_FRAC = 0.7;  // PLACEHOLDER (n≈0) — ≥ this fraction of scored hours sharing the dominant dir ⇒ 'uniform'

// least-squares slope of y over x=0..n-1 (per-step, i.e. per-day when steps are consecutive local dates).
// null on <2 points (can't fit a line).
function leastSquaresSlope(ys) {
  const n = ys.length;
  if (n < 2) return null;
  const xbar = (n - 1) / 2;
  const ybar = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { const dx = i - xbar; num += dx * (ys[i] - ybar); den += dx * dx; }
  return den === 0 ? 0 : num / den;
}

function classifyDir(slope, refLevel, flatFrac = HOURLY_DRIFT_FLAT_FRAC) {
  if (slope == null) return null;
  const eps = Math.abs(refLevel || 0) * flatFrac;
  return slope > eps ? 'up' : slope < -eps ? 'down' : 'flat';
}

// AM/PM split description — the "mornings −800k/d, evenings flat" shape a non-uniform item shows.
function splitDescription(hours) {
  const amDrifts = hours.filter(h => h && h.h < 12).map(h => h.driftPerDay);
  const pmDrifts = hours.filter(h => h && h.h >= 12).map(h => h.driftPerDay);
  if (!amDrifts.length || !pmDrifts.length) return null;
  const amMed = median(amDrifts), pmMed = median(pmDrifts);
  const wordOf = m => m == null ? 'no read' : Math.abs(m) < 1 ? 'flat' : `${m > 0 ? '+' : '−'}${Math.round(Math.abs(m))}/d`;
  return `mornings ${wordOf(amMed)}, evenings ${wordOf(pmMed)}`;
}

/**
 * hourlyDrift(series1h, { days = 3, ask = null }) — the per-hour day-over-day slope read.
 * @param {Array} series1h  raw /timeseries 1h points (SAME series hourlyLMH/read-window-range already fetch)
 * @param {object} opts     { days = 3, ask = null } — how many of the most-recent local dates feed each
 *                          hour's slope; `ask` (optional) scores the ask-reachability-decay sub-signal.
 * @returns {null | { perHour, dominant, askReach }}
 *   perHour  : [{ h, driftPerDay, dir }|null, …] for h 0–23 — null when that hour has <2 dates of MID data.
 *              dir ∈ 'up'|'down'|'flat' (HOURLY_DRIFT_FLAT_FRAC of that hour's own mean level per day).
 *   dominant : { dir, magPerDay, uniform, split } — the whole-item synthesis:
 *                dir      — 'up'|'down'|'flat', off the MEDIAN of all scored per-hour slopes (signed),
 *                           thresholded against the item's own overall level (same flat-epsilon shape).
 *                magPerDay— that median slope (gp/day, signed).
 *                uniform  — true when ≥ HOURLY_DRIFT_UNIFORM_FRAC of scored hours share `dir` (a real
 *                           regime step, not intraday noise — the boots/rapier falling-knife tell).
 *                split    — a short AM/evening description (only set when !uniform; null otherwise).
 *              null when zero hours have ≥2 dates of data (nothing to synthesize).
 *   askReach : { perDay:[{date,hoursReached}], decaying } | null — per-day (oldest→newest) count of hours
 *              whose HIGH reached `ask`, and whether that count is falling day-over-day (non-increasing
 *              across the scored dates, with the newest strictly below the oldest). null when `ask` is
 *              absent or fewer than 2 scored dates.
 *   Returns null (top-level) on <2 total local dates in the series — degrade, never a fake read (mirrors
 *   hourlyLMH's own empty-series contract).
 */
export function hourlyDrift(series1h, { days = 3, ask = null } = {}) {
  const { byKey, allDates } = bucketSeries1h(series1h);
  if (allDates.length < 2) return null;
  const dates = allDates.slice(-Math.max(1, days));   // oldest → newest (chronological, for slope fitting)
  const at = (date, h) => byKey.get(`${date} ${h}`) || null;

  // per-hour slope: the hour's own MID series across `dates` (skipping dates with no point that hour).
  const allMids = [];   // every scored mid, across all hours/dates — the item's overall reference level
  const hours = [];
  for (let h = 0; h < 24; h++) {
    const mids = [];
    for (const date of dates) {
      const p = at(date, h);
      const m = p ? midOf(p.low, p.high) : null;
      if (m != null) { mids.push(m); allMids.push(m); }
    }
    if (mids.length < 2) { hours.push(null); continue; }
    const slope = leastSquaresSlope(mids);
    const level = mids.reduce((s, v) => s + v, 0) / mids.length;   // this hour's own mean level (per-hour epsilon basis)
    hours.push({ h, driftPerDay: slope == null ? null : Math.round(slope), dir: classifyDir(slope, level) });
  }

  const scoredHours = hours.filter(Boolean);
  let dominant = null;
  if (scoredHours.length) {
    const refLevel = median(allMids);   // the item's overall level — the whole-item epsilon basis
    const magPerDay = median(scoredHours.map(h => h.driftPerDay));
    const dir = classifyDir(magPerDay, refLevel);
    const matching = scoredHours.filter(h => h.dir === dir).length;
    const uniform = scoredHours.length > 0 && (matching / scoredHours.length) >= HOURLY_DRIFT_UNIFORM_FRAC;
    dominant = { dir, magPerDay, uniform, split: uniform ? null : splitDescription(hours) };
  }

  // ask-reachability decay: per-day (oldest→newest) how many of that day's LOGGED hours had a HIGH that
  // reached `ask`. Reported as a RATE (hoursReached / hoursLogged), not a raw count — the newest local date
  // is usually partial (fewer hours logged so far today), so a raw count drop (e.g. 24→24→11) overstates the
  // decay when today only has ~15 hours logged. `decaying` is judged on the rate, so a partial day can't
  // false-trigger; `hoursReached` is retained for callers that want the raw count.
  let askReach = null;
  if (ask != null && dates.length >= 2) {
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
    askReach = { perDay, decaying };
  }

  return { perHour: hours, dominant, askReach };
}
