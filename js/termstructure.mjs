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
 * degrade-to-pass, so a newly-tracked item with little/no daily history yet (the archive is backfilled
 * to ~2026-06-19, but not every item has a deep slice) is a PASS, never a reject.
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

// --- TRAJECTORY (shape) PLACEHOLDER constants (rule 4 — none validated; inform-only until F1/P6 tunes) --
// The trajectory classifier answers a DIFFERENT question from the durable floor: not "how far ABOVE
// support is the buy" (a LEVEL check — floorValidator) but "what SHAPE is the recent path" — is it a
// knife still stepping down, an OSCILLATING faller you can buy at the local min (Hydra leather), a
// flat base at the floor (Berserker ring), or elevated. This is the encoded form of the phase()
// spike/decay/basing read, promoted from the 6h display-only tag to a MULTI-WEEK daily-series read
// (the 3-day regime window is exactly what let Nightmare staff read "Flat" while it decayed for a week).
export const TRAJ_MIN_POINTS   = 6;     // fewer daily-mid points than this ⇒ shape 'unknown' (degrade)
export const TRAJ_SPIKE_FRAC   = 0.10;  // a durable-window high > current×(1+this) ⇒ a spike happened above current
export const TRAJ_DECLINE_FRAC = 0.03;  // short-median this far BELOW the longer-median ⇒ a decline in progress
export const TRAJ_RECOVER_FRAC = 0.02;  // short-median this far ABOVE the longer-median ⇒ recovering
export const TRAJ_OSC_REVERSALS = 3;    // ≥ this many direction reversals in the recent leg ⇒ oscillating (not a monotone knife)
export const TRAJ_OSC_MIN_AMP  = 0.02;  // …AND the recent peak-to-trough span ≥ this fraction (a real tradeable rhythm, not noise)
export const TRAJ_RECENT_DAYS  = 7;     // the recent leg the reversal/oscillation read is scored over
export const TRAJ_ELEVATED_PIR = 0.70;  // current in the top (1-this) of the 14d range, no spike ⇒ 'elevated'
export const TRAJ_BASED_PIR    = 0.35;  // current in the bottom this of the 14d range + flat ⇒ 'based'

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

  const trajectory = classifyTrajectory(s, { lookbacks: lk, floor, ceiling, current, nowSec });

  return {
    hasData: true, now: nowSec, current, coverageDays,
    lookbacks: lk,
    floor, ceiling, floorLookback: floorDays, floorQuantile: FLOOR_QUANTILE,
    typicalSwing, typicalSwingFrac,
    trajectory,
  };
}

/**
 * classifyTrajectory(series, ctx) → { shape, evidence } — the SHAPE of the recent multi-week path.
 *   series  ascending, already-filtered `[{ts, mid}]` (termStructure's own `s`).
 *   ctx     { lookbacks, floor, ceiling, current, nowSec } — the per-lookback stats + current level.
 *
 * shape ∈ 'knife' | 'oscillating' | 'based' | 'rising' | 'elevated' | 'flat' | 'unknown'
 *   knife       — a monotone decline (few reversals), stepping down; if a prior spike sits above, it's
 *                 the spike unwinding (Nightmare staff), else a plain downtrend. The "don't catch it" case.
 *   oscillating — the recent leg REVERSES direction ≥ TRAJ_OSC_REVERSALS times with a real span: the
 *                 lows REPEAT (a tradeable rhythm) rather than stepping monotonically down. Buy the local
 *                 min even when the mean drifts down (Ben's Hydra-leather case — checked BEFORE knife so a
 *                 falling-but-oscillating item is not mislabeled a knife).
 *   based       — current near the bottom of the 14d range AND flat (short≈long median): a value-low floor.
 *   rising      — short median above the longer median: recovering / a healthy reprice leg.
 *   elevated    — current in the top of the 14d range with no spike below: bought high, not a dip.
 *   flat        — none of the above (ranging mid-band).
 *   unknown     — too few points (degrade; never asserts a shape off a thin series).
 *
 * PURE, never throws. THRESHOLDS ARE PLACEHOLDERS (rule 4). This is descriptive shape math ONLY — the
 * gate/inform POLICY (does a 'knife' downgrade a buy) lives in js/validate.mjs's trajectoryValidator,
 * per the thesis's declared mode. Kept here because termstructure.mjs is the ONE home for the
 * multi-week structure read and already holds the series.
 */
export function classifyTrajectory(series, { lookbacks = {}, floor = null, ceiling = null, current = null, nowSec = null } = {}) {
  const s = Array.isArray(series) ? series.filter(p => p && p.ts != null && p.mid != null) : [];
  if (s.length < TRAJ_MIN_POINTS) return { shape: 'unknown', evidence: { note: 'thin-series', n: s.length } };
  const now = nowSec != null ? nowSec : s[s.length - 1].ts;
  const cur = current != null ? current : s[s.length - 1].mid;
  const denom = (floor && floor > 0) ? floor : (cur || 1);
  const med = d => (lookbacks[d] && lookbacks[d].median != null) ? lookbacks[d].median : null;
  const m1 = med(1), m3 = med(3), m7 = med(7), m14 = med(14);

  // spike above current: the durable-window high sits well over the current level.
  const hi = (lookbacks[14] && lookbacks[14].high != null) ? lookbacks[14].high
           : (lookbacks[7] && lookbacks[7].high != null) ? lookbacks[7].high : null;
  const spiked = hi != null && cur != null && hi > cur * (1 + TRAJ_SPIKE_FRAC);

  // trend from short-vs-longer medians: declPct > 0 ⇒ the recent median sits below the older one.
  const shortMed = m1 != null ? m1 : m3;
  const longMed = m7 != null ? m7 : m14;
  const declPct = (shortMed != null && longMed != null && longMed > 0) ? (longMed - shortMed) / longMed : null;
  const declining = declPct != null && declPct > TRAJ_DECLINE_FRAC;
  const recovering = declPct != null && declPct < -TRAJ_RECOVER_FRAC;

  // oscillation over the recent leg: count direction reversals in the mid subsequence + its span.
  const from = now - TRAJ_RECENT_DAYS * 86400;
  const recent = s.filter(p => p.ts >= from).map(p => p.mid);
  let reversals = 0, lastDir = 0, rHi = -Infinity, rLo = Infinity;
  for (let i = 0; i < recent.length; i++) {
    if (recent[i] > rHi) rHi = recent[i];
    if (recent[i] < rLo) rLo = recent[i];
    if (i > 0) {
      const dir = Math.sign(recent[i] - recent[i - 1]);
      if (dir !== 0 && lastDir !== 0 && dir !== lastDir) reversals++;
      if (dir !== 0) lastDir = dir;
    }
  }
  const span = (rHi > rLo && denom > 0) ? (rHi - rLo) / denom : 0;
  const oscillating = reversals >= TRAJ_OSC_REVERSALS && span >= TRAJ_OSC_MIN_AMP;

  const pir = (lookbacks[14] && lookbacks[14].pctInRange != null) ? lookbacks[14].pctInRange : null;

  let shape;
  if (oscillating) shape = 'oscillating';                              // rhythm first — a falling-but-oscillating item is buyable at the min
  else if (declining) shape = 'knife';                                 // monotone decline (spike-unwind or downtrend) — don't catch it
  else if (recovering) shape = 'rising';
  else if (pir != null && pir >= TRAJ_ELEVATED_PIR && !spiked) shape = 'elevated';
  else if (pir != null && pir <= TRAJ_BASED_PIR) shape = 'based';
  else shape = 'flat';

  return {
    shape,
    evidence: {
      spiked, declPct: declPct == null ? null : Math.round(declPct * 1000) / 1000,
      reversals, span: Math.round(span * 1000) / 1000, pctInRange14: pir,
      current: cur, floor, ceiling, recentPoints: recent.length,
    },
  };
}
