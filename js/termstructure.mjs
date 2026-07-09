/**
 * termstructure.mjs — PURE multi-day term-structure + typical-fluctuation math over a daily-mid
 * series (Pipeline-v2 chunk P3). Lives in js/ (NOT pipeline/lib/) for the same reason as
 * js/quotecore.js / js/windowread.mjs / js/validate.mjs: it must be importable from BOTH node
 * (every pipeline surface) AND — later — the app, and js/validate.mjs's floorValidator imports it
 * (a js/ module may not import pipeline/lib/, so the term-structure math it depends on has to live
 * in js/ too). No DOM, no fetch, no fs — the caller hands in an already-loaded series.
 *
 * WHAT THIS COMPUTES. Given an item's daily-mid series `[{ts, mid}]` (ascending unix-second `ts`,
 * e.g. screen.mjs's loadDaily regime proxy or the Tier-1 archive's daily mids), it derives:
 *   - the 1/3/7/14/28-day STRUCTURE: for each lookback, the median / low / high / count of mids
 *     inside it, and where the CURRENT level sits within that lookback's range (pctInRange).
 *   - a DURABLE FLOOR: a low quantile of the longest available multi-week lookback — the level
 *     price returns to but rarely breaks. This is the "we cannot judge falling without its history
 *     and typical fluctuations" amendment made concrete (CLAUDE.md falling-exclusion-AMENDED).
 *   - a TYPICAL FLUCTUATION: how wide this item NORMALLY swings, as the inter-quartile range (q25→q75)
 *     of the durable-lookback mids. IQR is used (not the full high−low) so a single recent spike/decay
 *     doesn't inflate "normal" — the spike lives in the tail, outside the quartiles.
 *
 * DEGRADE CONTRACT (mirrors validate.mjs). An empty / too-short series returns `{ hasData: false }`
 * and a null floor — NEVER throws. floorValidator turns a `hasData:false` structure into a
 * degrade-to-pass, so the common early case (the archive only began accruing 2026-07-08; many items
 * have little or no daily history yet) is a PASS, never a reject.
 *
 * THRESHOLDS ARE PLACEHOLDERS (process rule 4 — none validated; the study that would tune them is
 * F1/P6's walk-forward calibration). Each is named + commented with what would validate it.
 */

// --- PLACEHOLDER constants (rule 4 — unvalidated; F1/P6 would tune against realized outcomes) ----
export const DEFAULT_LOOKBACKS = [1, 3, 7, 14, 28];   // the term-structure horizons (days)
// Which lookback defines "durable multi-week support": prefer 28d, fall back to the longest that has
// FLOOR_MIN_POINTS. VALIDATE (F1/P6): which horizon best predicts a level price holds over the NEXT
// N days — 28d may be too long once the archive is deep, or too short pre-warm.
export const FLOOR_LOOKBACK_DAYS = 28;
export const FLOOR_FALLBACK_DAYS = 14;
// A lookback with fewer mids than this is too thin to assert a floor → that horizon degrades (null).
// VALIDATE: the min sample at which a quantile floor is stable rather than noise.
export const FLOOR_MIN_POINTS = 6;
// The durable-support quantile: the level price sits AT-OR-ABOVE ~85% of the time over the durable
// lookback. VALIDATE (F1/P6): which quantile best separates "returns to but rarely breaks" from noise.
export const FLOOR_QUANTILE = 0.15;
// The durable-CEILING quantile (symmetric to the floor): the robust upper level the cycle returns to
// but rarely exceeds. Used spike-resistantly (P5 value niche) as the cycle's sell ceiling — a lone
// spike lives in the top tail BEYOND this quantile, so it can't inflate the amplitude the way the raw
// max would. VALIDATE (F1/P6): the same question as the floor, from the top.
export const CEIL_QUANTILE = 1 - FLOOR_QUANTILE;   // 0.85
// "Typical swing" is the inter-quartile range over the durable lookback (q25→q75). VALIDATE: whether
// IQR, MAD, or a decile band best captures the NORMAL (non-spike) fluctuation an item shows.
export const TYPICAL_LO_Q = 0.25, TYPICAL_HI_Q = 0.75;
// Floor for the typical swing so a near-flat item can't yield a divide-by-~0 (a 2%-of-floor move
// counts as "one normal swing" at minimum). VALIDATE: the smallest swing that is economically real.
export const MIN_SWING_FRAC = 0.02;

/* quantile(sortedAsc, q) — linear-interpolated quantile of an ASCENDING numeric array. */
export function quantile(sortedAsc, q) {
  const n = sortedAsc.length;
  if (!n) return null;
  if (n === 1) return sortedAsc[0];
  const pos = (n - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

const median = sortedAsc => quantile(sortedAsc, 0.5);

/* Slice the mids whose ts falls within `days` of `now` (unix seconds), returning the ASCENDING-by-value
   mid array (values only). now defaults to the series' own last ts so the read is anchorable/testable. */
function midsWithin(series, days, nowSec) {
  const from = nowSec - days * 86400;
  const out = [];
  for (const p of series) {
    if (p && p.ts != null && p.mid != null && p.ts >= from && p.ts <= nowSec) out.push(p.mid);
  }
  return out.sort((a, b) => a - b);
}

/* lookbackStat(series, days, current, nowSec) → { days, n, median, low, high, pctInRange } | null.
   pctInRange = where `current` sits between the lookback's low (0) and high (1); null if degenerate. */
function lookbackStat(series, days, current, nowSec) {
  const vals = midsWithin(series, days, nowSec);
  if (!vals.length) return null;
  const low = vals[0], high = vals[vals.length - 1];
  const pctInRange = (current != null && high > low) ? (current - low) / (high - low) : null;
  return { days, n: vals.length, median: median(vals), low, high, pctInRange };
}

/**
 * termStructure(series, { now, lookbacks }) → the structure object, or a hasData:false degrade.
 *   series     ascending `[{ts, mid}]` (unix-second ts). Missing/short → { hasData:false }.
 *   now        Date | unix-seconds | ms — the "as of" instant (defaults to the last point's ts).
 *   lookbacks  the horizons in days (defaults to DEFAULT_LOOKBACKS).
 * Returns:
 *   { hasData, now, current, coverageDays,
 *     lookbacks: { [d]: {days,n,median,low,high,pctInRange} | null },
 *     floor, floorLookback, floorQuantile,
 *     typicalSwing, typicalSwingFrac }         // absolute gp IQR + as a fraction of the floor
 */
export function termStructure(series, { now = null, lookbacks = DEFAULT_LOOKBACKS } = {}) {
  const s = Array.isArray(series) ? series.filter(p => p && p.ts != null && p.mid != null) : [];
  if (s.length < 2) return { hasData: false, current: s.length ? s[s.length - 1].mid : null, lookbacks: {}, floor: null };
  // resolve `now` to unix seconds; a Date or ms-epoch is normalized to seconds.
  let nowSec;
  if (now == null) nowSec = s[s.length - 1].ts;
  else if (now instanceof Date) nowSec = Math.floor(now.getTime() / 1000);
  else nowSec = now > 1e12 ? Math.floor(now / 1000) : now;   // ms vs s heuristic

  const current = s[s.length - 1].mid;
  const coverageDays = (s[s.length - 1].ts - s[0].ts) / 86400;

  const lk = {};
  for (const d of lookbacks) lk[d] = lookbackStat(s, d, current, nowSec);

  // Durable floor + typical swing from the longest multi-week lookback that clears FLOOR_MIN_POINTS.
  let floorDays = null;
  for (const d of [FLOOR_LOOKBACK_DAYS, FLOOR_FALLBACK_DAYS]) {
    if (lk[d] && lk[d].n >= FLOOR_MIN_POINTS) { floorDays = d; break; }
  }
  let floor = null, ceiling = null, typicalSwing = null, typicalSwingFrac = null;
  if (floorDays != null) {
    const vals = midsWithin(s, floorDays, nowSec);   // ascending
    floor = quantile(vals, FLOOR_QUANTILE);
    ceiling = quantile(vals, CEIL_QUANTILE);         // robust high (spike-resistant), symmetric to floor
    const iqr = quantile(vals, TYPICAL_HI_Q) - quantile(vals, TYPICAL_LO_Q);
    typicalSwing = floor != null ? Math.max(iqr, floor * MIN_SWING_FRAC) : iqr;
    typicalSwingFrac = floor ? typicalSwing / floor : null;
  }

  return {
    hasData: true, now: nowSec, current, coverageDays,
    lookbacks: lk,
    floor, ceiling, floorLookback: floorDays, floorQuantile: FLOOR_QUANTILE,
    typicalSwing, typicalSwingFrac,
  };
}
