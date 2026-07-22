// windowread.mjs — the PURE window-range math shared by read-window-range.mjs (the CLI read)
// and watch-positions.mjs (the per-offer window-context line). Extracted 2026-07-05 so watch could
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

// placement(sortedAsc, x) — price→PERCENTILE, the INVERSE of quantLow/quantHigh (which map
// percentile→price). Returns the fraction of the ascending sample AT OR BELOW x (the empirical CDF):
//   • ASK vs the daily-HIGH distribution — p62 = "62% of trailing daily highs sat at/below this ask"
//     (upper-middle of the historically-printed band; the normal place a small resting ask lives).
//   • BID vs the daily-LOW distribution — a LOW placement = "below most daily lows" (a deep entry).
// PURELY DESCRIPTIVE — it says WHERE a level sits in the printed distribution, NOT what is "achievable"
// or "safe". Whether an upper-percentile placement is trustworthy is a liquidity-conditioned judgment
// that lives in the human/skill layer (distrust near the historical extreme on a thin book; trust
// deeper into the tail on a deep book). The calibrated liquidity-scaled "safe ≈ pXX" threshold (AC3)
// did NOT ship — its gate failed (the Finding-2 knee is unobservable on our own fills; see
// PLAN-REACH-CALIBRATION AC1 "GATE RESULT: NOT MET"). This is the ONE price→percentile home the reach
// CLIs use; fill-placement.mjs's `cdf` (AC1's calibration core) is the same computation and delegates
// here, so there is a single definition. null on an empty sample. Same ceil-index-free CDF convention
// as the AC1 study (count ≤ x, divide by n).
export const placement = (sortedAsc, x) => {
  if (!sortedAsc || !sortedAsc.length) return null;
  let c = 0; for (const v of sortedAsc) if (v <= x) c++;
  return c / sortedAsc.length;
};

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

// --- multi-day trajectory shape read (the fang under-read fix) -----------------------------------
// The heuristic SHAPE classification over a windowStats().days series — the exact under-read the fang
// incident exposed: reach/placement said "fill-now A-" while the multi-day `days` array (in the same
// dump) showed an oscillator sitting at its 2-week floor. Extracted here as ONE pure helper so BOTH
// read-window-range.mjs (the manual trio) AND quote-items.mjs (every quote surface) render an
// identical trajectory read from the same numbers — no re-derivation, no fetch. HEURISTIC (n≈0),
// inform-only — never gates, never a verdict; a shape label + the window floor/ceiling + where the
// live print sits between them.
// R6 (PLAN-SIGNAL-RECENCY): the `shape` field is NO LONGER PRINTED by any surface — its blended-mid
// rising/falling/based/elevated verdict was weaker than (and could visibly contradict) floorCeilingTrack's
// independent-slope classification, which supersedes it. The code is KEPT (the unique floor/ceiling/livePos
// fields still ride the fcTrack note via formatFloorCeiling's `live` opt, and `shape` stays available for a
// future programmatic consumer — today none reads it). The one genuinely-unique read `shape` had, oscillation
// DENSITY, migrated INTO floorCeilingTrack as fc.oscillating so it survives the retire.
//   days:    windowStats().days — [[key, {low, hi}], …] oldest→newest.
//   liveRef: the live price to position against the window floor/ceiling (or null → no live note).
// Returns null when the series can't be read; otherwise
//   { scored, shape, floor, ceiling, floorKey, ceilKey, liveRef, livePos }
//   livePos ∈ 'at the FLOOR' | 'mid-band' | 'at the CEILING' | null.
export function trajectoryRead(days, { liveRef = null } = {}) {
  const scored = Array.isArray(days) ? days.filter(([, n]) => n && (n.low != null || n.hi != null)) : [];
  if (!scored.length) return null;
  const lowsAll = scored.map(([, n]) => n.low).filter(v => v != null);
  const hisAll = scored.map(([, n]) => n.hi).filter(v => v != null);
  const floor = lowsAll.length ? Math.min(...lowsAll) : null;
  const ceiling = hisAll.length ? Math.max(...hisAll) : null;
  const floorKey = floor != null ? (scored.find(([, n]) => n.low === floor) || [])[0] || null : null;
  const ceilKey = ceiling != null ? (scored.find(([, n]) => n.hi === ceiling) || [])[0] || null : null;
  // one-line shape off the chronological daily MIDs — rising / falling / oscillating / based / elevated.
  const mids = scored.map(([, n]) => (n.low != null && n.hi != null) ? (n.low + n.hi) / 2 : (n.low ?? n.hi)).filter(v => v != null);
  let shape = 'ranging';
  if (mids.length >= 3 && floor != null && ceiling != null && ceiling > floor) {
    const range = ceiling - floor;
    const third = Math.max(1, Math.floor(mids.length / 3));
    const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
    const drift = (mean(mids.slice(-third)) - mean(mids.slice(0, third))) / range;   // recent-third vs oldest-third, in range-units
    let flips = 0;   // direction changes → oscillation density
    for (let i = 2; i < mids.length; i++) { const a = Math.sign(mids[i - 1] - mids[i - 2]), b = Math.sign(mids[i] - mids[i - 1]); if (a && b && a !== b) flips++; }
    const oscFrac = flips / (mids.length - 2);
    const pos = (mids[mids.length - 1] - floor) / range;   // where the latest day's mid sits in the band
    if (drift >= 0.33) shape = 'rising';
    else if (drift <= -0.33) shape = 'falling';
    else if (oscFrac >= 0.4) shape = 'oscillating floor↔ceiling';
    else if (pos <= 0.34) shape = 'based (sitting near the floor)';
    else if (pos >= 0.66) shape = 'elevated (sitting near the ceiling)';
    else shape = 'ranging (mid-band)';
  }
  let livePos = null;
  if (liveRef != null && floor != null && ceiling != null && ceiling > floor) {
    const lp = (liveRef - floor) / (ceiling - floor);
    livePos = lp <= 0.34 ? 'at the FLOOR' : lp >= 0.66 ? 'at the CEILING' : 'mid-band';
  }
  return { scored, shape, floor, ceiling, floorKey, ceilKey, liveRef, livePos };
}

// --- phase-aligned floor + ceiling track (PLAN-DRIFT-VS-CRASH — the drift-vs-crash classifier) ---
// trajectoryRead (above) collapses the window to ONE min-low `floor` + ONE max-high `ceiling` and reads
// `shape` off the blended daily MIDS — which WASHES OUT the exact signal a crash-vs-cooldown call needs:
// the FLOOR track (daily lows) and the CEILING track (daily highs) moving INDEPENDENTLY. Three real cases
// this session's blend could not tell apart:
//   • FANG (crash)       — ceiling stepping DOWN ~376k/day while the floor BROKE its 14-day low (17.46m):
//                          decaying peaks + a floor break.
//   • GODSWORD (crash)   — daily highs stepped 42.1m→40.2m over a week and the floor broke 39m→37.2m.
//   • MAUL (cooldown)    — floor ROSE 7 days (116.5k→125.0k) then PLATEAUED + ticked down 2 days; highs
//                          eased ~2k/day. NOT a crash — the floor still sits far above its prior trough.
//                          A 2-day wiggle is NOT a trend (the robustness lesson this helper must encode).
//   • SOULREAPER (trend) — floor AND ceiling rising hard, new highs daily → healthy.
// floorCeilingTrack reads the two tracks SEPARATELY — a robust recent-window LEAST-SQUARES slope on each,
// classified rising|flat|falling with a per-day gp step — and combines the two slopes + a discrete
// FLOOR-BREAK flag into an asymmetry label. THE CLASSIFIER'S DISCRIMINATORS ARE floor/ceiling slope
// ASYMMETRY + the floor-break; that IS the drift-vs-crash trajectory classifier.
//
// CLASSIFICATION LABELS (floor-break DOMINATES; documented here as the load-bearing spec home):
//   crash-risk      floorBreak fires (latest completed low < the prior-lookback floor) — the discrete crash trigger
//   healthy-trend   floor rising  &  ceiling rising
//   compressing-up  floor rising  &  ceiling flat|falling   (band tightening from below)
//   mild-cooldown   floor flat    &  ceiling falling         (the maul — peaks ease, floor holds)
//   cooling         floor falling &  ceiling falling         (both tracks decaying, no break yet)
//   ranging         any other combo (flat/flat, flat/rising, falling/rising|flat) — nothing decisive
//
// REQUIREMENT #1 — PHASE ALIGNMENT (the forming-day guard): the live/incomplete current day must NEVER
// feed the slope fit or the floor-break test (an incomplete bucket can fake a break or a slope). Pass
// `todayKey` (local 'YYYY-MM-DD'); if the NEWEST day matches it, that day is DROPPED from the completed
// series and surfaced SEPARATELY as `forming` (provisional low/high). Only complete daily buckets,
// compared like-for-like, feed the slopes + break. (windowStats already excludes today while inside its
// window, so on the live surfaces `forming` is usually null already — this guard is belt-and-suspenders
// AND the contract a raw caller who passes an includes-today series relies on.)
//
// HONESTY RAILS (rule 4, same discipline as trajectoryRead): HEURISTIC, n≈0, INFORM-ONLY — never gates,
// never a verdict, never a screen.json / rank input. Needs ≥ FC_MIN_DAYS COMPLETED days for a slope (null
// below that — degrade, never a fake read). `dir` is off a recent-window least-squares slope, NOT the
// last two days, so a 2-day wiggle CANNOT flip the classification (the maul); each track ALSO carries
// `run` (the trailing consecutive-same-direction micro-run, raw-sign) + `nUsed` so a caller reports
// DURATION ("floor flat over 5d, softened 2d") instead of a verdict that flips on one day. All FC_*
// thresholds are PLACEHOLDERS pending F1.
export const FC_MIN_DAYS = 5;          // fewer COMPLETED days than this ⇒ null (can't fit a robust slope)
export const FC_RECENT_N = 5;          // the recent completed-day window the slope is fit over
export const FC_FLAT_FRAC = 0.005;     // |slope|/latest-level per day below this ⇒ 'flat' (0.5%/day; PLACEHOLDER, F1)
export const FC_BREAK_LOOKBACK = 13;   // floor-break = latest low vs the min of the prior N lows (the rest of a 14-day window)
export const FC_OSC_FRAC = 0.4;        // R6: daily-mid direction-flip fraction ≥ this on a 'ranging' item ⇒ 'oscillating' (PLACEHOLDER, F1; carried over from trajectoryRead's retired shape read — the one signal fc's slope-direction classifier can't express)
export const PT_PROJECT_N = 1;         // forward-projection horizon in periods (days); 1 = "next period". PLACEHOLDER, F1

// projectTrajectory(days, extractFn, opts) — THE ONE recency-weighted trajectory primitive (PLAN-SIGNAL-RECENCY R1).
// Generalizes floorCeilingTrack's inner per-track read (a robust recent-window LEAST-SQUARES slope → dir, a
// trailing raw-sign micro-run for DURATION, and an optional discrete DOWNWARD break) to an ARBITRARY per-day
// scalar pulled by `extractFn`, and ADDS a forward projection (`latest + slope × projectN`) so the read points
// FORWARD ("where's the level likely to be next period"), not only backward. floorCeilingTrack is now a
// two-call wrapper over this (n=>n.low WITH the break test, n=>n.hi WITHOUT); the other stale-aggregate
// consumers (regimeDrift, floorValidator, reachMargin — later PLAN-SIGNAL-RECENCY chunks) rebase onto it
// instead of re-deriving trend math per surface.
//
// INPUT: the windowStats().days shape ([[key,{low,hi,…}], …] oldest→newest) every caller already holds
// (ZERO new fetch). `extractFn:(n)=>number|null` pulls the tracked scalar (n=>n.low, n=>n.hi, n=>cushionOf(n)…).
// FORMING-DAY GUARD (req #1): pass `todayKey` ('YYYY-MM-DD'); if the NEWEST day matches, it is peeled off the
// completed series and surfaced as `forming` (provisional) so an incomplete bucket never feeds the slope/break.
// floorCeilingTrack pre-splits its shared series and passes todayKey:null (the guard already applied — see there).
//
// RETURN (or null when < minDays completed extracted points — degrade, never a fake read):
//   { series, latest, slope, step, dir, run:{dir,len}, nUsed, forming, break, projected }
//   break     : { broke, latest, priorExtreme, gap, lookback } ONLY when breakLookback is supplied, else null
//               (a DOWNWARD break: latest < min(prior lookback) — the generalized floor-break)
//   projected : { value, confidence } — latest + slope×projectN, the recent line extended one horizon forward;
//               confidence 'low' on a partial-window fit OR a broken series, else 'ok'. null when slope is null.
//               NOTE (R1 deviation from the draft contract's `{low,high}`): the primitive tracks ONE scalar, so
//               it projects ONE value; a caller composes a floor-call value + a ceiling-call value into a
//               {low,high} band (floorCeilingTrack / the read-trajectory CLI do exactly this).
//
// HONESTY RAILS (rule 4, inherited unchanged from floorCeilingTrack): HEURISTIC, n≈0, INFORM-ONLY — the
// primitive NEVER gates; a CALLER'S policy may (e.g. R2/R3). `break` is null unless breakLookback is supplied
// (never a false negative). All thresholds (recentN/minDays/flatFrac/breakLookback) are the shared FC_*
// PLACEHOLDERS pending F1.
export function projectTrajectory(days, extractFn, {
  recentN = FC_RECENT_N, minDays = FC_MIN_DAYS, flatFrac = FC_FLAT_FRAC,
  todayKey = null, breakLookback = null, projectN = PT_PROJECT_N,
} = {}) {
  if (typeof extractFn !== 'function' || !Array.isArray(days) || !days.length) return null;
  // req #1: peel the newest day when it is the incomplete current day so it never feeds the slope/break.
  let forming = null, completed = days;
  const last = days[days.length - 1];
  if (todayKey != null && last && last[0] === todayKey) {
    forming = { key: last[0], value: last[1] ? (extractFn(last[1]) ?? null) : null };
    completed = days.slice(0, -1);
  }
  // extract the tracked scalar from completed days, dropping nulls (like-for-like comparison only).
  const series = completed.map(([, n]) => (n ? extractFn(n) : null)).filter(v => v != null);
  if (series.length < minDays) return null;

  const ref = series[series.length - 1];                        // latest level = the relative-threshold ref
  const window = series.slice(-recentN);
  const slope = slopePerStep(window);                           // least-squares gp/period over the recent window
  const band = Math.abs(ref) * flatFrac;
  const dir = slope == null ? null : slope >= band ? 'rising' : slope <= -band ? 'falling' : 'flat';
  // trailing micro-run: consecutive steps from the newest end sharing a RAW-SIGN direction. Raw sign
  // (not the flat band) on purpose — the run's job is to expose a fresh softening/strengthening under a
  // robust trend (the maul's "flat over 5d, softened 2d"); the flat band lives on `dir`, the trend read.
  const catOf = d => d > 0 ? 'rising' : d < 0 ? 'falling' : 'flat';
  let run = { dir: null, len: 0 };
  for (let i = series.length - 1; i >= 1; i--) {
    const c = catOf(series[i] - series[i - 1]);
    if (run.dir == null) run = { dir: c, len: 1 };
    else if (c === run.dir) run.len++;
    else break;
  }
  // optional discrete DOWNWARD break: latest vs the min of the prior-lookback points (the floor-break shape:
  // a track that steps UNDER its multi-day trough — the fang/godsword crash trigger).
  let brk = null;
  if (breakLookback != null) {
    const prior = series.slice(Math.max(0, series.length - 1 - breakLookback), series.length - 1);
    const priorExtreme = prior.length ? Math.min(...prior) : null;
    const broke = priorExtreme != null && ref < priorExtreme;
    brk = { broke, latest: ref, priorExtreme, gap: priorExtreme != null ? ref - priorExtreme : null, lookback: prior.length };
  }
  // forward projection: extend the recent least-squares line one horizon forward. confidence LOW on a
  // partial-window fit or a broken series (an honest token, not a bare number presented as certain).
  const lowConf = window.length < recentN || (brk != null && brk.broke);
  const projected = slope == null ? null : { value: Math.round(ref + slope * projectN), confidence: lowConf ? 'low' : 'ok' };

  return { series, latest: ref, slope, step: slope == null ? null : Math.round(slope), dir, run, nUsed: window.length, forming, break: brk, projected };
}

export function floorCeilingTrack(days, { todayKey = null, recentN = FC_RECENT_N, minDays = FC_MIN_DAYS, flatFrac = FC_FLAT_FRAC, breakLookback = FC_BREAK_LOOKBACK } = {}) {
  const usable = Array.isArray(days) ? days.filter(([, n]) => n && (n.low != null || n.hi != null)) : [];
  if (!usable.length) return null;
  // REQUIREMENT #1: split off the forming (incomplete) current day so it never feeds a slope / the break.
  let forming = null, completed = usable;
  if (todayKey != null && usable[usable.length - 1][0] === todayKey) {
    const [key, n] = usable[usable.length - 1];
    forming = { key, low: n.low ?? null, hi: n.hi ?? null };
    completed = usable.slice(0, -1);
  }
  const nDays = completed.length;
  if (nDays < minDays) return null;
  // two-call wrapper over the shared projectTrajectory primitive (R1): the floor track WITH the discrete
  // break test, the ceiling track WITHOUT. `completed` is already forming-stripped ⇒ todayKey:null here
  // (the guard above did the split, exactly as before — this keeps the split predicate byte-identical).
  const floor = projectTrajectory(completed, n => n.low, { recentN, minDays, flatFrac, breakLookback });
  const ceiling = projectTrajectory(completed, n => n.hi, { recentN, minDays, flatFrac });
  if (!floor || !ceiling) return null;
  // map the primitive's generalized `break` back to the floorBreak field names this surface has always used
  // (priorExtreme → priorFloor) so every downstream consumer of fc.floorBreak stays byte-identical.
  const b = floor.break;
  const floorBreak = { broke: b.broke, latest: b.latest, priorFloor: b.priorExtreme, gap: b.gap, lookback: b.lookback };

  const classification = floorBreak.broke ? 'crash-risk'
    : floor.dir === 'rising' && ceiling.dir === 'rising' ? 'healthy-trend'
    : floor.dir === 'rising' && (ceiling.dir === 'flat' || ceiling.dir === 'falling') ? 'compressing-up'
    : floor.dir === 'flat' && ceiling.dir === 'falling' ? 'mild-cooldown'
    : floor.dir === 'falling' && ceiling.dir === 'falling' ? 'cooling'
    : 'ranging';

  // R6 (PLAN-SIGNAL-RECENCY): the ONE signal fc's slope-DIRECTION classifier structurally cannot express —
  // oscillation DENSITY. fc's `ranging` lumps a DEAD range together with an item actively BOUNCING between a
  // known floor and ceiling (the amplitude-hold setup this codebase cares about). Preserve trajectoryRead's
  // flip-fraction test here, so retiring its printed shape (R6) doesn't silently lose it: count daily-MID
  // direction changes over the completed days; a flip fraction ≥ FC_OSC_FRAC on a `ranging` item flags
  // `oscillating`. INFORM-only (n≈0, never gates) — formatFloorCeiling renders it as a `ranging` qualifier.
  const mids = completed.map(([, n]) => (n.low != null && n.hi != null) ? (n.low + n.hi) / 2 : (n.low ?? n.hi)).filter(v => v != null);
  let flips = 0;
  for (let i = 2; i < mids.length; i++) { const a = Math.sign(mids[i - 1] - mids[i - 2]), b2 = Math.sign(mids[i] - mids[i - 1]); if (a && b2 && a !== b2) flips++; }
  const oscillating = classification === 'ranging' && mids.length >= 3 && (flips / (mids.length - 2)) >= FC_OSC_FRAC;

  return { completed, forming, nDays, floor, ceiling, floorBreak, classification, oscillating };
}

/* formatFloorCeiling(fc, fmt, opts) — the ONE compact one-line render of a floorCeilingTrack result, so
 * read-window-range.mjs and quote-items.mjs (via render.mjs) print it byte-identically (the same
 * one-owner rule the trajectory read follows). PURE: `fmt` (money-format) is INJECTED so windowread
 * stays dependency-free. Returns the note TEXT (no sigil — the caller's NOTE_KIND owns that).
 * R6 (PLAN-SIGNAL-RECENCY): this note now ALSO carries what trajectoryRead's retired `shape` line used to —
 * the `oscillating` qualifier on a ranging item (fc.oscillating) + the absolute 2-week band and where the
 * live price sits in it (`live` opt = { ref, pos, floor, ceiling } from trajectoryRead), so ONE combined
 * note per pass replaces the two that could visibly disagree. `live` absent ⇒ the band clause is omitted.
 * PLAN-OSCILLATION-CYCLE Chunk 5: an OPTIONAL `drift` opt = a driftAdjustedExit() result (js/forecast.mjs,
 * computed BY THE CALLER off its in-hand hourProfile + days — windowread never imports forecast, the
 * one-way arrow) folds the drift-adjusted exit LEVEL beside every price suggestion. It is a projected
 * LEVEL (the drift-adjusted diurnal peak/trough over the hold horizon), NEVER a rising/falling verdict —
 * direction is only ever the sign of the arithmetic upstream, never a word here. `drift` absent / null
 * levels ⇒ the clause is omitted (honest degrade, like the band clause). INFORM-only, n≈0 — never a gate. */
export function formatFloorCeiling(fc, fmt, { label = '', live = null, drift = null } = {}) {
  if (!fc) return null;
  const dirStep = t => t.dir == null ? 'n/a'
    : `${t.dir}${t.step == null ? '' : ` ${t.step >= 0 ? '+' : '−'}${fmt(Math.abs(t.step))}/d`}`;
  const soft = t => (t.run && t.run.dir && t.run.dir !== t.dir && t.run.len >= 2) ? ` (${t.run.dir} ${t.run.len}d)` : '';
  // R6: the classification, qualified with `(oscillating floor↔ceiling)` when the ranging item is actually
  // bouncing between its floor and ceiling — the one read fc's slope-direction classifier can't otherwise say.
  const classTxt = fc.oscillating ? `${fc.classification} (oscillating floor↔ceiling)` : fc.classification;
  const parts = [
    `floor ${dirStep(fc.floor)} over ${fc.floor.nUsed}d${soft(fc.floor)}`,
    `ceiling ${dirStep(fc.ceiling)}${soft(fc.ceiling)}`,
    classTxt,
  ];
  if (fc.floorBreak.broke) parts.push(`⚠ floor BROKE prior ${fc.floorBreak.lookback}d low by ${fmt(Math.abs(fc.floorBreak.gap))}`);
  if (fc.forming) parts.push(`today forming low ${fmt(fc.forming.low)}/high ${fmt(fc.forming.hi)} (provisional)`);
  // R6: the absolute 2-week band + where the live print sits in it (folded from trajectoryRead's retired
  // shape line — nothing else computes livePos). Rendered only when a usable live band read was passed.
  if (live && live.pos && live.floor != null && live.ceiling != null)
    parts.push(`band ${fmt(live.floor)}→${fmt(live.ceiling)}${live.ref != null ? ` · live ${fmt(live.ref)} ${live.pos}` : ''}`);
  // PLAN-OSCILLATION-CYCLE Chunk 5: the drift-adjusted exit LEVEL (projected diurnal peak/trough shifted by
  // the multi-week floor/ceiling drift over the hold horizon). Levels ONLY — no direction word (the sign of
  // the shift never surfaces as a rising/falling label — the corrected-mechanism ruling). Rendered only when
  // the caller passed a drift result with at least one usable level (degrade otherwise).
  if (drift && (drift.driftAdjustedPeak != null || drift.driftAdjustedTrough != null)) {
    const hd = drift.holdHorizonDays != null ? drift.holdHorizonDays : '?';
    const pk = drift.driftAdjustedPeak != null ? `~${fmt(Math.round(drift.driftAdjustedPeak))}` : '—';
    const tr = drift.driftAdjustedTrough != null ? `~${fmt(Math.round(drift.driftAdjustedTrough))}` : '—';
    parts.push(`drift-adj exit (~${hd}d hold): peak ${pk} / trough ${tr} (projected level${drift.confidence ? `, conf ${drift.confidence}` : ''}, n≈0 — inform, not a direction)`);
  }
  return `${label ? label + ': ' : ''}floor/ceiling: ${parts.join(' · ')}  (heuristic, n≈0 — inform-only, never gates)`;
}

// --- day-of-week seasonality (A3, PLAN-AMPLITUDE-SCAN §2.4 — GENUINELY NEW) ---------------------
// The 1.5-day amplitude hold crosses a day boundary (fill day-1's trough, sell into day-2's peak), so
// the leg-2 sell lands on a DIFFERENT weekday — and weekday rhythm (the UK weekly cycle, weekend→weekday
// transitions) can matter. §1's honesty correction: NO day-of-week tooling existed anywhere in the repo
// (hourProfile is hour-of-day only) — this is the net-new weekday sibling. It buckets the per-day daily
// range by LOCAL weekday over ~3–4 weeks of the 1h archive and reports the per-weekday MEDIAN amplitude %
// with the n PER CELL (n≈3–4/weekday over 28 nights — state it EVERY print; a lean, not a law, rule 4).
// PURE over an already-fetched 1h series (reuses windowStats — the same full-day per-day hi/lo buckets).
export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAY_MIN_DAYS = 7;   // fewer scored days than this ⇒ null (can't bucket a week across weekdays)

export function weekdayProfile(series, { nights = 28, now = new Date() } = {}) {
  const stats = windowStats(series, { nights, wStart: 0, wEnd: 0, now });
  if (!stats || !Array.isArray(stats.days) || stats.days.length < WEEKDAY_MIN_DAYS) return null;
  const byDow = new Map();   // dow(0–6) → [ampPct, …]
  for (const [key, n] of stats.days) {
    if (n.low == null || n.hi == null || n.low <= 0) continue;
    const d = new Date(key + 'T00:00:00');            // key is local 'YYYY-MM-DD' (windowStats dayKey)
    const dow = d.getDay();
    if (Number.isNaN(dow)) continue;
    const amp = (n.hi - n.low) / n.low;               // RAW daily amplitude % (tax-agnostic — the caller frames it)
    if (!byDow.has(dow)) byDow.set(dow, []);
    byDow.get(dow).push(amp);
  }
  const cells = [];
  for (const [dow, amps] of byDow) {
    const s = amps.slice().sort((a, b) => a - b);
    cells.push({ dow, label: WEEKDAY_LABELS[dow], ampPct: s[Math.floor(s.length / 2)], n: s.length });
  }
  if (cells.length < 2) return null;
  cells.sort((a, b) => b.ampPct - a.ampPct);          // widest amplitude first
  return { cells, best: cells[0], worst: cells[cells.length - 1], nDays: stats.days.length };
}

// --- ask-side "typical exit" read (PLAN-POSITIONS-WINDOW-READ) ---------------------------------
// The ONE assembly of the ask-side window-clear read that read-window-range.mjs's `--ask <level>`
// block prints (the daily-HIGH typical-exit levels + the scored list-price reach/placement + the
// less-smoothed 5m-grain reach). Factored here so BOTH read-window-range.mjs (the manual CLI read)
// and quote-items.mjs --positions (the auto-surfaced big-ticket held-lot note) render from ONE
// definition instead of re-sequencing the primitives (quantHigh/recentQuant/reachedDays/placement)
// per surface. PURE: it takes ALREADY-computed windowStats results (each caller has one in hand —
// zero re-bucketing, zero fetch) and returns structured numbers; the caller owns the wording.
// The 5m-grain figure is the archive's less-smoothed per-day max (a LOWER BOUND on the true gap per
// AC2) — surfaced ALONGSIDE the 1h number, labeled, never replacing it, and gated on ≥ FIVE_MIN_MIN_DAYS
// covered days so a one-off snapshot can't fake a read. n≈14 nights — a guide, not a guarantee (rule 4).
export const FIVE_MIN_MIN_DAYS = 3;   // fewer scored 5m-grain window-days than this ⇒ don't surface (too sparse)

/**
 * askExitRead(stats, opts) — the ask-side typical-exit read off a windowStats result.
 * @param {object|null} stats     a windowStats() result over the 1h series (or null)
 * @param {object} opts { ask=null, stats5m=null, recentN=RECENT_NIGHTS, minFiveDays=FIVE_MIN_MIN_DAYS }
 *   ask      — the list/exit level to score (null ⇒ summary-only, no scored/grain block)
 *   stats5m  — a windowStats() result over the 5m archive series (or null ⇒ no grain block)
 * @returns {null | { nDays, askSide:{q50,q75,everyDay,recent50,medVol}, ask:null|{level,reachedDays,nDays,placement,recency}, grain5m:null|{reachedDays,nDays,placement} }}
 *   null when the 1h series has no traded window-highs (nothing to read — degrade, never a fake read).
 */
export function askExitRead(stats, { ask = null, stats5m = null, recentN = RECENT_NIGHTS, minFiveDays = FIVE_MIN_MIN_DAYS, profile = null, live = null, now = new Date() } = {}) {
  if (!stats || !Array.isArray(stats.his) || !stats.his.length) return null;
  const his = stats.his;   // ascending
  const askSide = {
    q50: quantHigh(his, 0.5),
    q75: quantHigh(his, 0.75),
    everyDay: his[0],                                    // min daily high = reached every scored day
    recent50: recentQuant(stats.days, 'ask', 0.5, recentN),
    medVol: stats.medVolHi,
  };
  const scored = (ask != null) ? {
    level: ask,
    reachedDays: reachedDays(his, ask),
    nDays: his.length,
    placement: placement(his, ask),
    recency: recencySplit(stats.days, 'ask', ask, recentN),
    reachMargin: reachMargin(stats.days, 'ask', ask, { recentN, profile, live, now }),   // the fade check, folded in (zero extra fetch)
  } : null;
  const grain5m = (ask != null && stats5m && Array.isArray(stats5m.his) && stats5m.his.length >= minFiveDays)
    ? { reachedDays: reachedDays(stats5m.his, ask), nDays: stats5m.his.length, placement: placement(stats5m.his, ask) }
    : null;
  return { nDays: his.length, askSide, ask: scored, grain5m };
}

// --- reach-margin FADE check (the godsword/mask pair, 2026-07-20) -------------------------------
// The reach COUNT + placement percentile say "does this level print", but not whether the CUSHION over
// (ask) / under (bid) the level is FADING — the signal that a "recent 3/3 reached" ask is quietly
// settling ONTO a cooling peak (godsword: 40.6m reached 3/3 recent while the cushion collapsed +1.3m→
// +0.1m; "rising vs the 2-week base" masked it). reachMargin folds three reads off the SAME per-day
// windowStats buckets (zero new fetch) + the in-hand hourProfile:
//   trend        fading|stable|extending — the robust least-squares SLOPE of the cushion over the recent
//                marginN days (R4: projectTrajectory, was mean-of-halves — a single volatile end-day swung
//                both half-means), the FITTED first→last change thresholded at MARGIN_FADE_FRAC × level.
//   cushionNow   the most-recent day's cushion (how much room is left over/under the level TODAY).
//   pace         today's live vs the reaching-day median for THIS hour-of-day (from hourProfile) — a
//                same-day "is today tracking the days that reached?" read; null when there's no live or
//                no current-hour row (honest — no pace read at an unsampled hour). Emitted whenever data
//                exists, sparse or not: sparse still informs a low-liquidity item, and it's a strong
//                signal on a liquid one (Ben, 2026-07-20).
// SYMMETRIC: side='ask' scores dayHigh−level cushions + the high side; side='bid' scores level−dayLow +
// the low side (a bid running too DEEP to fill is the mirror error). INFORM-ONLY (tier: context) — like
// windowClear/askHeadroom it never moves the verdict, the quoted price, or a gate. n≈small, thresholds
// are PLACEHOLDERS pending F1 (rule 4); it TEMPERS a tail price toward a reachable one, not a fill model.
export const MARGIN_NIGHTS = 7;      // recent days considered for the cushion trend
export const MARGIN_MIN_DAYS = 4;    // fewer scored recent days than this ⇒ trend null (can't split halves)
export const MARGIN_FADE_FRAC = 0.003; // |older→newer cushion delta| ≥ this × level flips stable→fading/extending (PLACEHOLDER, F1; 0.3% keeps night-to-night noise from over-firing "fading")
export const PACE_TOL_FRAC = 0.001;  // live within this × level of the hour median counts as on-pace (PLACEHOLDER)

export function reachMargin(days, side, level, { recentN = RECENT_NIGHTS, marginN = MARGIN_NIGHTS, minDays = MARGIN_MIN_DAYS, profile = null, live = null, now = new Date() } = {}) {
  if (!Array.isArray(days) || !days.length || level == null) return null;
  const extremeOf = n => side === 'bid' ? n.low : n.hi;
  const cushionOf = e => side === 'bid' ? (level - e) : (e - level);
  const all = days.map(([key, n]) => { const e = extremeOf(n); return e == null ? null : { key, extreme: e, cushion: cushionOf(e), reached: cushionOf(e) >= 0 }; })
    .filter(Boolean);
  if (!all.length) return { side, level, trend: null, cushionNow: null, cushionFrom: null, cushionTo: null, cushionSlope: null, reachedRecent: 0, nRecent: 0, perDay: [], pace: pace() };
  const recent = all.slice(-marginN);                    // days is oldest→newest ⇒ tail = most recent
  const cushionNow = recent[recent.length - 1].cushion;
  const reachedRecent = recent.filter(d => d.reached).length;
  let trend = null, cushionFrom = null, cushionTo = null, cushionSlope = null;
  if (recent.length >= minDays) {
    // R4 (PLAN-SIGNAL-RECENCY): the cushion TREND is the robust least-squares SLOPE over the recent cushion
    // series (projectTrajectory), NOT the mean-of-halves difference — a single volatile day at either end
    // swung both half-means (the single-noisy-sample sensitivity the primitive exists to resist). SAME
    // level-relative threshold: classify the FITTED total change (slope × span) vs level × MARGIN_FADE_FRAC.
    // we consume only rt.slope/rt.nUsed here (NOT rt.dir/rt.run) — projectTrajectory's own flat-band is
    // relative to `latest`, which for a cushion is degenerate near zero, so we threshold the fitted change
    // against level × MARGIN_FADE_FRAC below (the item's PRICE level, the right basis) instead.
    const rt = projectTrajectory(recent.map(d => [d.key, d]), d => d.cushion, { minDays, recentN: marginN });
    cushionSlope = rt ? rt.slope : null;
    const delta = (rt && rt.slope != null) ? rt.slope * (rt.nUsed - 1) : null;   // robust fitted first→last cushion change
    const thresh = level * MARGIN_FADE_FRAC;
    trend = delta == null ? null : delta <= -thresh ? 'fading' : delta >= thresh ? 'extending' : 'stable';
    cushionFrom = recent[0].cushion;   // display endpoints (first recent day → today), replacing the half-means
    cushionTo = cushionNow;
  }
  return { side, level, trend, cushionNow, cushionFrom, cushionTo, cushionSlope, reachedRecent, nRecent: recent.length, perDay: recent, pace: pace() };

  // today's pace vs the reaching-day median at THIS hour-of-day (closure over side/level/live/profile/now)
  // STALE-LIVE GUARD: `live` may carry the driving side's freshness (staleLo/staleHi + loAgeMin/hiAgeMin,
  // set by the caller from row.quickStale/row.quoteAgeMin). A pace read off a stale /latest print is a
  // FALSE "lagging/ahead" signal — the number isn't today's live price (the 64-min godsword anchor,
  // 2026-07-21). When the driving side is stale we return a {stale} marker instead of a bogus comparison.
  function pace() {
    if (!profile || !Array.isArray(profile.hours) || !live) return null;
    const h = now.getHours();
    const row = profile.hours.find(x => x.h === h);
    if (!row || !(row.n > 0)) return null;
    const stale = side === 'bid' ? live.staleLo : live.staleHi;
    if (stale) return { hour: h, stale: true, ageMin: side === 'bid' ? (live.loAgeMin ?? null) : (live.hiAgeMin ?? null), n: row.n };
    const liveNow = side === 'bid' ? live.lo : live.hi;
    const medianAtHour = side === 'bid' ? row.lowRecent : row.hiRecent;
    if (liveNow == null || medianAtHour == null) return null;
    const gap = liveNow - medianAtHour, tol = level * PACE_TOL_FRAC;
    const onPace = side === 'bid' ? gap <= tol : gap >= -tol;   // ask: live at/above median = on pace; bid: at/below
    return { hour: h, liveNow: Math.round(liveNow), medianAtHour: Math.round(medianAtHour), gap: Math.round(gap), onPace, n: row.n };
  }
}

// --- asymmetric realizable pair (PART II, PLAN-GRADE-REACH — deep-buy / reliable-sell) ---------
// Ben's mandate: "I'd much rather hit a 2/14 buy and a 12/14 sell than 50/50 both sides." The ideal
// flip is a RARE DEEP entry (a bid that fills only on a genuine flush) paired with a NEAR-CERTAIN
// exit (an ask that prints most nights). The symmetric intraday p10/p90 band pair is structurally the
// 50/50 shape; asymPair instead derives a day-level DEEP bid + HIGH-REACH ask from windowStats' lows/
// his arrays (the same quantile machinery the reach validator scores against — one vocabulary):
//   deepBid      = quantLow(lows, ASYM_P_LO)   — touched on only ~ASYM_P_LO of nights (the flush)
//   highReachAsk = quantHigh(his, ASYM_P_HI)   — reached on ~ASYM_P_HI of nights (near-certain exit)
//   pAsk / pBid  = the realized reach/touch fractions AT those levels (ties can push them past p)
// DOCTRINE (§II.1): pAsk is the fill WEIGHT of the asymmetric rank (the exit is the flip's big
// assumption); pBid is an ANNOTATION ONLY — "rest the bid as optionality, expect ~pBid×n fills" —
// NEVER a rank multiplier (that would re-punish exactly the deep entry the shape wants). The deep
// bid's value is already captured by the larger net. asymEstimate (js/estimators.mjs) is the consumer.
// HONESTY (rule 4): n≈14 nights per item — every quantile below is a PLACEHOLDER pending F1/retro
// calibration; a sample thinner than ASYM_MIN_DAYS returns null (degrade, never a fake pair).
export const ASYM_P_LO = 0.25;    // flush-bid quantile — fills ~3-4/14 nights (PLACEHOLDER, F1 tunes)
export const ASYM_P_HI = 0.8;     // high-reach-ask quantile — prints ~11/14 nights (PLACEHOLDER, F1 tunes)
export const ASYM_MIN_DAYS = 5;   // thinner day sample than this ⇒ no read (mirrors REACH_MIN_DAYS)

export function asymPair(stats, { pLo = ASYM_P_LO, pHi = ASYM_P_HI, minDays = ASYM_MIN_DAYS } = {}) {
  if (!stats || !Array.isArray(stats.lows) || !Array.isArray(stats.his)
    || !stats.lows.length || !stats.his.length) return null;
  const nDays = stats.days ? stats.days.length : Math.max(stats.lows.length, stats.his.length);
  if (nDays < minDays || stats.lows.length < minDays || stats.his.length < minDays) return null;
  const deepBid = quantLow(stats.lows, pLo);
  const highReachAsk = quantHigh(stats.his, pHi);
  return {
    deepBid, highReachAsk,
    pAsk: reachedDays(stats.his, highReachAsk) / stats.his.length,
    pBid: touchedDays(stats.lows, deepBid) / stats.lows.length,
    nDays,
  };
}

// --- within-window CLEARING read (PLAN-WINDOW-CLEAR B1) ----------------------------------------
// windowStats/asymPair/reach all answer "did this level print on N of M DAYS". But a churn/scalp LAP
// is a WITHIN-WINDOW round trip, so the honest question is different: inside the TARGET window (the 4h
// lap, or the diurnal spike window the ask targets), does the ask PRINT, and does the window's volume
// ABSORB my size? windowClear reads exactly that off the SAME per-day window buckets (ZERO new fetch —
// it just re-runs windowStats over [wStart,wEnd]):
//   windowReach = fraction of window-days whose window-high reached the ask (the within-window twin of
//                 reachedDays — NOT the all-day reach the reachValidator scores)
//   pool        = median window volHi on the days the ask WAS reachable (the absorption pool; HONESTY
//                 (rule 4): 1h volHi is the SUMMED high-side bucket volume over the window hours, so
//                 "volume at/above the ask" is approximated by the reachable days' totals — a guide,
//                 not an order book)
//   clearRatio  = units ÷ pool (the size leg — the within-window cousin of PLAN-LIQUIDITY-REACH's sizeRatio)
// The FLAG that turns this into the days-reach ≠ lap-clear signal (healthy all-day reach but LOW
// windowReach, or size ≫ pool — the Hydra "spike is behind you today" trap) is windowClearDiverges below;
// the NOTE is render-stage (B2, screen/quote). Degrades to null on too thin a window sample (mirrors
// ASYM_MIN_DAYS). n≈0 → the WINCLEAR_* thresholds are NAMED PLACEHOLDERS pending F1.
export const WINCLEAR_MIN_DAYS = 4;    // fewer window-days than this ⇒ null (too thin to read)
export const WINCLEAR_MIN_FRAC = 0.5;  // windowReach below this (against a healthy all-day reach) ⇒ diverges (PLACEHOLDER)
export const WINCLEAR_SIZE_MAX = 0.5;  // clearRatio above this (size ≥ half the window pool) ⇒ diverges (PLACEHOLDER)

export function windowClear(series, { ask, units = null, wStart, wEnd, nights = 14, now = new Date(), minDays = WINCLEAR_MIN_DAYS } = {}) {
  if (ask == null) return null;
  const stats = windowStats(series, { nights, wStart, wEnd, now });
  if (!stats || !stats.his.length || stats.his.length < minDays) return null;
  const nDays = stats.his.length;
  const reached = reachedDays(stats.his, ask);
  // absorption pool = median window volHi on the days the ask actually printed (window-high ≥ ask)
  const reachedVols = stats.days.filter(([, n]) => n.hi != null && n.hi >= ask).map(([, n]) => n.volHi);
  const pool = reachedVols.length ? median(reachedVols) : 0;
  const clearRatio = (units != null && pool > 0) ? units / pool : null;
  return { ask, units, wStart, wEnd, nDays, reachedDays: reached, windowReach: reached / nDays, pool, clearRatio };
}

// Pure divergence predicate for the B2 render-stage note: given the within-window read + the item's
// ALL-DAY reach fraction (from the existing reach machinery), is this the days-reach ≠ lap-clear trap?
// Diverges when the all-day reach is healthy (≥ minFrac, or unknown) but the WINDOW reach lags it, OR
// the size can't clear the window pool. Inform-only — the caller formats/gates the note, never a price.
export function windowClearDiverges(clear, dayReachFrac = null, { minFrac = WINCLEAR_MIN_FRAC, sizeMax = WINCLEAR_SIZE_MAX } = {}) {
  if (!clear) return { diverges: false, windowShort: false, sizeShort: false };
  const windowShort = clear.windowReach < minFrac && (dayReachFrac == null || dayReachFrac >= minFrac);
  const sizeShort = clear.clearRatio != null && clear.clearRatio > sizeMax;
  return { diverges: windowShort || sizeShort, windowShort, sizeShort };
}

// --- percentile-depth exit/entry (PLAN-DEPTH-EXIT DE1) ----------------------------------------
// THE GOAL — answer "what can I actually BOOK at?" (the price my size clears), not "how often does
// the top print?" (that's reachedDays/touchedDays above — and it is the qty→0 LIMIT of this model,
// pinned as a fixture). windowStats reads each day's MAX high; depth reads the WHOLE window's volume
// distributed ACROSS price. The wiki exposes no order book, so we reconstruct the distribution from
// the only thing it gives: each 1h bucket is a POINT MASS — highPriceVolume units transacted at
// avgHighPrice (bid side: lowPriceVolume at avgLowPrice). depthAbove_d(P) = the instabuy flow that
// printed at/above P on day d; a day "clears" my lot when that flow is COMPETITION× my size (I don't
// take the whole pool — other sellers queue too). Full data-availability analysis + bias structure:
// PLAN-DEPTH-EXIT.md. ALL constants are NAMED PLACEHOLDERS (n≈0 — the soul-rune anchor); F1 owns the
// magnitudes (process rule 4). Kept module-internal for now (surfaced via the function returns);
// promote to `export` when a cross-file consumer (DE2/DE3) actually imports one.
//
// LIQUIDITY BIAS — SURFACED BY DESIGN (Ben, 2026-07-15): a flat COMPETITION× makes this a LIQUID-CLASS
// tool. A thin book whose whole-window flow is under COMPETITION×qty at every level returns a null read
// WITH A REASON ('insufficient-depth') — honest deflation for held-lot pricing, but it means depth
// cannot rescue a thin item's buried edge (only surface liquid ones). A null NEVER degrades silently;
// the caller reads the reason and says "reach fallback — book absorbs <N× your lot". F1 must validate
// whether the flat ×4 systematically nulls a class we'd want to price (DE3 shadow-logs the reason+class).
const DEPTH_COMPETITION_MULT = 4;    // required flow = COMPETITION × qty (queue-position safety factor; Ben-accepted 2026-07-15 conditional on the surfacing above)
const DEPTH_TARGET_FRAC      = 0.75; // a level "clears" when ≥ this fraction of scored days absorb the lot (echoes EST_REACH_SAT_FRAC's "reachable-enough")
const DEPTH_MIN_DAYS         = 5;    // fewer scored window-days than this ⇒ null 'thin-history' (mirrors ASYM_MIN_DAYS)
const DEPTH_MIN_BUCKETS      = 2;    // a candidate level needs ≥ this many distinct supporting buckets at/beyond it (within-bucket misattribution guard)

/* Group the in-window 1h buckets by day, KEEPING each bucket's (price, volume) point mass — the piece
 * windowStats discards when it collapses a day to max-hi/total-vol. Returns
 *   [[key, { hi:[{p,v},…], lo:[{p,v},…] }], …]  oldest→newest, complete days only (today skipped while
 * inside the window, exactly like windowStats), capped at `nights`. Only buckets that actually TRADED
 * (vol>0) are kept — a zero-volume average is a quote, not depth. Module-internal engine for both funcs. */
function windowBuckets(series, { nights = 14, wStart, wEnd, now = new Date() } = {}) {
  const days = new Map();
  const today = inWindow(now.getHours(), wStart, wEnd) ? dayKey(now, wStart, wEnd) : null;
  for (const pt of series) {
    const d = new Date(pt.timestamp * 1000);
    if (!inWindow(d.getHours(), wStart, wEnd)) continue;
    const key = dayKey(d, wStart, wEnd);
    if (key === today) continue;
    const rec = days.get(key) || { hi: [], lo: [] };
    if (pt.avgHighPrice != null && (pt.highPriceVolume || 0) > 0) rec.hi.push({ p: pt.avgHighPrice, v: pt.highPriceVolume });
    if (pt.avgLowPrice  != null && (pt.lowPriceVolume  || 0) > 0) rec.lo.push({ p: pt.avgLowPrice,  v: pt.lowPriceVolume  });
    days.set(key, rec);
  }
  return [...days.entries()].filter(([, r]) => r.hi.length || r.lo.length)
    .sort((a, b) => b[0].localeCompare(a[0])).slice(0, nights).reverse();
}

// PLAN-REMOVE-DEPTH-PRESSURE-READS chunk 1 (2026-07-22): `depthDays` (DE1 per-day flow-beyond table) and
// its `flowBeyond` helper were REMOVED (narrow removal — the DE1/DE6 percentile-depth INSPECTOR reads that
// never fed a main decision surface). `clearableLevel`/`clearableAsk` (below) SURVIVE — clearableAsk still
// powers the live DE3 `depthExit` shadow on watch-positions/quote-items. Revive from git if ever needed.

/* clearableLevel — the ONE side-generic engine behind clearableAsk (DE1); the 'bid' path (DE6) is retained
   for symmetry/revival but has no live caller after chunk-1's clearableBid removal.
 *   ask side: candidate levels = distinct hi-bucket prices scanned HIGH→LOW; flow-beyond = at/ABOVE.
 *   bid side: distinct lo-bucket prices scanned LOW→HIGH; flow-beyond = at/BELOW (instasell flow).
 * clearFrac is monotone toward the flow (non-increasing in the ask / non-decreasing in the bid), so
 * the FIRST clearing level in scan order is the extreme one — the max bookable ask / min catchable
 * bid. Both by construction stay inside the observed data (a real bucket price — the ask never above
 * the max print, the bid never below the min print). Module-internal. */
function clearableLevel(series, side, { qty, competition = DEPTH_COMPETITION_MULT, targetFrac = DEPTH_TARGET_FRAC, minBuckets = DEPTH_MIN_BUCKETS, minDays = DEPTH_MIN_DAYS, wStart, wEnd, nights = 14, now = new Date() } = {}) {
  const scored = windowBuckets(series, { nights, wStart, wEnd, now });
  const nDays = scored.length;
  // meta echoes the effective params so a caller can state "×4 comp, ≥75% target" without importing the consts.
  const res = (price, clearFrac, reason, extra = {}) => ({ price, clearFrac, reason, nDays, competition, qty, targetFrac, minBuckets, ...extra });
  if (nDays < minDays) return res(null, null, 'thin-history');
  const pick = r => (side === 'bid' ? r.lo : r.hi);
  const levels = [...new Set(scored.flatMap(([, r]) => pick(r).map(b => b.p)))]
    .sort((a, b) => (side === 'bid' ? a - b : b - a));   // bid low→high, ask high→low: first clear = the extreme
  if (!levels.length) return res(null, null, 'no-prints');
  const need = competition * qty;
  for (const P of levels) {
    let supporting = 0, cleared = 0;
    for (const [, r] of scored) {
      const beyond = pick(r).filter(b => (side === 'bid' ? b.p <= P : b.p >= P));
      supporting += beyond.length;
      const flow = beyond.reduce((s, b) => s + b.v, 0);
      if (flow > 0 && flow >= need) cleared++;
    }
    if (supporting < minBuckets) continue;                 // misattribution guard: too few prints to trust P
    if (cleared / nDays >= targetFrac) return res(P, cleared / nDays, null);
  }
  return res(null, 0, 'insufficient-depth', { need });
}

/* clearableAsk(series, opts) → { price, clearFrac, reason, nDays, competition, qty }.
 *   price  = the HIGHEST ask whose flow clears the lot on ≥ targetFrac of days AND has ≥ minBuckets
 *            distinct supporting buckets at/above it — "what I can actually book at" (null when none).
 *   reason = why price is null: 'thin-history' (< minDays scored), 'no-prints' (no traded buckets),
 *            'insufficient-depth' (the book can't absorb competition×qty at ANY level — the liquidity
 *            collapse Ben predicted; the caller MUST surface it, never silently fall back to reach).
 * Candidate levels = the distinct bucket prices only (no interpolation — that would invent data).
 * By construction price never exceeds the observed data (a real bucket price); the caller still
 * caps a rendered ask at dayHighFrom5m. */
// @provisional-api: PLAN-DEPTH-EXIT DE1 — the "book at X" ask, consumed by DE2 (--depth inspector) and
// DE3 (watch-positions line/shadow log); F1 (DE4) later promotes it into estimatePair's held-lot sell.
export function clearableAsk(series, opts = {}) { return clearableLevel(series, 'ask', opts); }

// PLAN-REMOVE-DEPTH-PRESSURE-READS chunk 1 (2026-07-22): `clearableBid` (DE6 low-side mirror) was REMOVED
// (narrow removal — the low-side depth inspector had no live consumer). `clearableAsk` above survives.
// Revive from git (`clearableLevel(series, 'bid', opts)` — the engine's bid path is intact) if needed.

// --- pressure-driven reachable band (PLAN-DEPTH-EXIT Extension A, PB1) --------------------------
// THE GAP the depth model left open (the Soul-rune 394 problem): clearableAsk reads 1h bucket
// AVERAGES, which smooth away the peaks a resting limit ask actually fills at — on a deep book the
// depth read is a strictly-conservative FLOOR that under-prices the top. The reachable price is set
// by the BUYER/SELLER BALANCE: you clear high when you're the lowest ask into impatient buyers; you
// buy deep when sellers dump into your bid. That balance is already in windowStats: medVolHi
// (instabuy flow) vs medVolLo (instasell flow). With s = ln(medVolHi/medVolLo) and one monotone
// curve φ(x) = clamp(0.5 + PRESSURE_PHI_SLOPE·x, 0, PRESSURE_HEADROOM_MAX):
//   reachableAsk = baseHigh + bandHigh·φ(+s)     · reachableBid = baseLow − bandLow·φ(−s)
// base = the RECENT-N central daily high/low (recentQuant p=0.5 — the smoothing-honest center, RC1
// reused not re-derived); band = the q75−q25 DISPERSION of the RECENT-N daily highs/lows (PB5: the
// SAME recency window as the base, so a stale-regime dip/reprice outside it can't inflate the width
// and over-deepen the floor — side-specific: band is CAPACITY, pressure is REALIZATION). One
// reflection gives the whole coherent doctrine:
// buy-heavy favors the seller (high ask, shallow bid), sell-heavy the buyer (deep bid, shallow ask).
// PRESSURE IS A DISTRIBUTION READ, NOT A BINARY: it predicts the CENTER + DIRECTION + fill
// VELOCITY; size/dispersion set how far into the tail a given size reaches (Ben's 50k/day 381
// trickle-fills on buy-heavy Soul rune — slow tail-dip fills, exactly as the sign predicts).
// GUARD — sample RELIABILITY replaces a peak-cap: the thin-book mirage risk here is that a ratio
// off a handful of units is NOISE, so reliability shrinks toward 0 as the thinner side's median
// daily volume falls under PRESSURE_MIN_VOL and the headroom blends back to the smoothed center.
// A liquid book predicts boldly (even above the last peak); a thin one degrades to conservative.
// VALIDATED FOR REASONABLENESS ONLY (2026-07-15, n≈0 fills): one slope across 2gp–10k gp
// commodities lands the deep bid inside the daily-low lower tail ([min…q25]: Coal 137/min 137 exact,
// Adamantite 535 vs 533–548 cluster, Raw lobster 113 vs 112–116, Runite 10038 vs 9980–10162, Wine of
// zamorak 869 vs 831–861), and the buy-heavy ask on Soul rune reads ~397–401 vs real 397 fills where
// the depth floor said 394. The IQR band beat the avgHigh−avgLow spread (the spread over-deepens a
// wide-spread book BELOW anything that printed — Magic logs 769 < min 774; resolved open question).
// It matches where price TRADED, not verified FILLS — φ/minVol are PLACEHOLDERS (n≈0), F1 owns them,
// and the slope + band measure are COUPLED (they jointly set magnitude; calibrate together). It
// captures the CYCLICAL tail, never the event-driven macro extreme (Soul 351, Magic logs 774).
export const PRESSURE_PHI_SLOPE    = 0.43; // φ slope on s=ln(pressure) — PLACEHOLDER fit on Soul rune's ask, reasonableness-checked on 10 commodities (n≈0 fills)
export const PRESSURE_MIN_VOL      = 2000; // thinner-side median daily volume at which the pressure ratio is fully trusted (reliability 1); below it the headroom shrinks linearly (PLACEHOLDER, n≈0)
export const PRESSURE_HEADROOM_MAX = 1;    // φ clamp — never more than ONE band of headroom beyond the center absent F1 evidence
export const PRESSURE_MIN_DAYS    = 5;     // thinner day sample than this ⇒ null (dispersion off <5 days is noise; mirrors ASYM_MIN_DAYS)
export const PRESSURE_BAND_RECENT_N = 7;   // PB5: the band WIDTH (dispersion) is measured over the RECENT-N nights, not the full window — a dip/reprice older than this can't inflate the band and over-deepen the floor (the Ranarr/anglerfish trial finding). WIDER than the 3-night base center on purpose: a median is stable at n=3 but an IQR is not, so dispersion needs more points (7 ≈ the recent half of the 14-night default). Falls back to the full window when the recent slice is too thin. PLACEHOLDER, n≈0.

/* demandPressure(stats) → { ratio, s, reliability, medVolHi, medVolLo } | null.
 * ratio = medVolHi/medVolLo off a windowStats result (>1 buy-heavy, <1 sell-heavy); s = ln(ratio)
 * so 2× and 0.5× are symmetric; reliability ∈ [0,1] = how much volume stands behind the ratio
 * (min side ÷ PRESSURE_MIN_VOL, clamped — the noise guard). Null when either side is absent/zero. */
// @provisional-api: PLAN-DEPTH-EXIT Extension A (PB1) — consumed by reachableBand below and by DC1's
// hourlyPressure (the per-hour demand-cycle track); PB2's --pressure inspector prints it directly.
export function demandPressure(stats, { minVol = PRESSURE_MIN_VOL } = {}) {
  if (!stats || !(stats.medVolHi > 0) || !(stats.medVolLo > 0)) return null;
  const ratio = stats.medVolHi / stats.medVolLo;
  const reliability = Math.max(0, Math.min(1, Math.min(stats.medVolHi, stats.medVolLo) / minVol));
  return { ratio, s: Math.log(ratio), reliability, medVolHi: stats.medVolHi, medVolLo: stats.medVolLo };
}

const pressurePhi = (x, slope, cap) => Math.max(0, Math.min(cap, 0.5 + slope * x));

/* reachableBand(stats, opts) → the two-sided pressure-driven reachable prices, or null (thin days /
 * no pressure read / no priced side — degrade, never a fake band).
 *   { bid, ask, pressure, sSigned, reliability, baseLow, baseHigh, bandLow, bandHigh, phiBid, phiAsk, nDays }
 * The headroom each side adds/subtracts is band·φ(±s)·reliability — a thin-volume book collapses to
 * the smoothed center (the guard above), a balanced liquid book sits half a band out, a one-sided
 * liquid book reaches up to one full band (the clamp). Monotone in s on both sides by construction. */
// @provisional-api: PLAN-DEPTH-EXIT Extension A (PB1) — consumed by DE3's watch-positions held-lot
// line + suggestions.jsonl shadow fields and PB2's read-window-range --pressure inspector; PB4
// (F1-gated) later promotes it into estimatePair's liquid-tier sell/buy reference.
export function reachableBand(stats, { slope = PRESSURE_PHI_SLOPE, headroomMax = PRESSURE_HEADROOM_MAX, minVol = PRESSURE_MIN_VOL, minDays = PRESSURE_MIN_DAYS, recentN = RECENT_NIGHTS, bandRecentN = PRESSURE_BAND_RECENT_N } = {}) {
  const dp = demandPressure(stats, { minVol });
  if (!dp || !stats.days || !Array.isArray(stats.lows) || !Array.isArray(stats.his)) return null;
  const nDays = stats.days.length;
  if (nDays < minDays || stats.lows.length < minDays || stats.his.length < minDays) return null;
  const baseLow = recentQuant(stats.days, 'bid', 0.5, recentN);
  const baseHigh = recentQuant(stats.days, 'ask', 0.5, recentN);
  // PB5 (2026-07-15 live trial): the band WIDTH tracks the RECENT regime's dispersion, NOT the full
  // window — a dip or reprice OLDER than the recent window must not inflate the band and push the floor
  // below where the item currently trades (the Ranarr/anglerfish finding: full-window IQR anchored the
  // deep bid to a stale dip/pre-reprice level the item had left). bandRecentN (7) is WIDER than the
  // 3-night base center — a median is stable at n=3 but an IQR needs more points — so the width uses the
  // recent HALF of the window while the center stays at recent-3. Falls back to the full-window arrays
  // when the recent slice is too thin for an IQR (<2 points), so a short history degrades to the pre-PB5
  // behavior rather than nulling.
  const recentDays = stats.days.slice(-bandRecentN);
  const recentLows = recentDays.map(([, n]) => n.low).filter(v => v != null);
  const recentHis  = recentDays.map(([, n]) => n.hi).filter(v => v != null);
  const bandLow = iqr(recentLows.length >= 2 ? recentLows : stats.lows);
  const bandHigh = iqr(recentHis.length >= 2 ? recentHis : stats.his);
  if (baseLow == null || baseHigh == null || bandLow == null || bandHigh == null) return null;
  const phiAsk = pressurePhi(+dp.s, slope, headroomMax) * dp.reliability;
  const phiBid = pressurePhi(-dp.s, slope, headroomMax) * dp.reliability;
  return {
    bid: Math.round(baseLow - bandLow * phiBid),
    ask: Math.round(baseHigh + bandHigh * phiAsk),
    pressure: dp.ratio, sSigned: dp.s, reliability: dp.reliability,
    baseLow, baseHigh, bandLow, bandHigh, phiBid, phiAsk, nDays,
  };
}

// --- hour-of-day diurnal profile (the peak-timing read) ---------------------------------------
// windowStats scores ONE fixed wall-clock window; hourProfile instead buckets the SAME 1h series by
// LOCAL hour-of-day (0–23) across the last N days, so a caller can SEE where the daily dip and peak
// print and derive a bid/ask from the shape rather than guessing a window up front. This is Ben's
// default pricing method (peak-timing): bid at the recent dip-hour level, ask at the recent peak-hour
// level. Two robustness guards are baked in, both learned the hard way (Ghrazi, 2026-07-09):
//   • CLUSTER, don't point-pick — a single hour over ~7 nights is ≤7 samples (noisy). The dip/peak are
//     the CONTIGUOUS run of hours near the extreme (Ben: "analyse the hourly output to define the range").
//   • TREND-DOMINATES flag — when the multi-day floor drifts faster than the intraday swing is deep, a
//     "dip" bid never fills (the floor rises past it). deriveDiurnalRange then prices the bid to LIVE.
// SHAPE (which hours are low/high) reads off the FULL-window median (more samples, stabler); the LEVEL
// quoted reads off the RECENT-N median (trend-accurate). PURE over an already-fetched 1h series.
export const HOURPROFILE_MIN_DAYS = 4;   // fewer scored days than this ⇒ too thin to profile → null
export const DIP_CLUSTER_FRAC = 0.34;    // an hour within this fraction of the intraday amplitude of the
                                         //   extreme joins the dip/peak cluster (the contiguous window)
export const TREND_DOM_FRAC = 0.25;      // |daily-low drift/day| ≥ this fraction of amplitude ⇒ the
                                         //   multi-day trend dominates the intraday swing (price to live)

const median = arr => { const s = arr.filter(v => v != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
// IQR (q75−q25) of a numeric sample — the small-sample DISPERSION statistic the PF1 forecast band is
// built from. IQR not stdev on purpose: 7–14 samples/hour is a small sample and a lone flier print must
// not blow up the band (the Bar E robustness lesson). null when fewer than 2 non-null samples. Uses the
// same ceil-quantile index convention as quantLow so it stays legible next to the reach math.
const iqr = arr => {
  const s = arr.filter(v => v != null).sort((a, b) => a - b);
  if (s.length < 2) return null;
  const q = p => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
  return q(0.75) - q(0.25);
};

// least-squares slope per step of a numeric series (oldest→newest); null if <2 points.
function slopePerStep(ys) {
  const n = ys.length; if (n < 2) return null;
  const xm = (n - 1) / 2, ym = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - xm) * (ys[i] - ym); den += (i - xm) ** 2; }
  return den ? num / den : null;
}

// the [start,end) span of a circular-contiguous set of hours (for a readable "20–00" window label).
function spanOf(hrsSet) {
  const arr = [...hrsSet];
  if (arr.length >= 24) return { startH: 0, endH: 0 };
  let startH = arr.find(h => !hrsSet.has((h + 23) % 24));
  if (startH == null) startH = Math.min(...arr);
  let endH = startH;
  for (let step = 0; step < 24; step++) {
    if (hrsSet.has((startH + step) % 24) && !hrsSet.has((startH + step + 1) % 24)) { endH = (startH + step + 1) % 24; break; }
  }
  return { startH, endH };
}

/**
 * hourProfile(series, opts) — per-local-hour dip/peak structure of a 1h /timeseries.
 * @param {object} opts { nights=14, now=new Date(), recentN=RECENT_NIGHTS }
 * @returns {null | { hours, dip, peak, amplitude, amplitudePct, trendPerDay, trendDominates, nights }}
 *   hours: [{ h, n, lowFull, hiFull, lowRecent, hiRecent, volLo, volHi }] (hours with data, ascending)
 *   dip:  { startH, endH, hours:[…], level, atHour }  level = recent dip-cluster low (the bid candidate)
 *   peak: { startH, endH, hours:[…], level, atHour }  level = recent peak-cluster high (the ask candidate)
 */
export function hourProfile(series, { nights = 14, now = new Date(), recentN = RECENT_NIGHTS } = {}) {
  const pad2 = n => String(n).padStart(2, '0');
  const dk = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const byHour = new Map();       // h → [{ day, low, hi, volLo, volHi }]
  const dayMids = new Map();      // day → [mids] (for the per-day baseline that DE-TRENDS the shape)
  const dayLow = new Map();       // day → min avgLowPrice across the day (the trend series)
  const daySet = new Set();
  for (const pt of series || []) {
    if (pt.avgLowPrice == null && pt.avgHighPrice == null) continue;
    const d = new Date(pt.timestamp * 1000);
    const h = d.getHours(), day = dk(d);
    daySet.add(day);
    if (!byHour.has(h)) byHour.set(h, []);
    byHour.get(h).push({ day, low: pt.avgLowPrice, hi: pt.avgHighPrice, volLo: pt.lowPriceVolume || 0, volHi: pt.highPriceVolume || 0 });
    const mid = (pt.avgLowPrice != null && pt.avgHighPrice != null) ? (pt.avgLowPrice + pt.avgHighPrice) / 2 : (pt.avgLowPrice ?? pt.avgHighPrice);
    if (mid != null) { if (!dayMids.has(day)) dayMids.set(day, []); dayMids.get(day).push(mid); }
    if (pt.avgLowPrice != null) { const c = dayLow.get(day); if (c == null || pt.avgLowPrice < c) dayLow.set(day, pt.avgLowPrice); }
  }
  const allDays = [...daySet].sort();                    // ascending (oldest→newest)
  const keep = new Set(allDays.slice(-nights));
  if (keep.size < HOURPROFILE_MIN_DAYS) return null;
  const recentSet = new Set(allDays.slice(-recentN));
  // per-day baseline = median of that day's hourly mids. Subtracting it DE-TRENDS the shape read so the
  // multi-day drift (which otherwise swamps the ~intraday swing and picks dip/peak hours off which OLD
  // cheap days each hour happened to sample — the Ghrazi contamination) cancels out. SHAPE reads off the
  // deviation-from-baseline; the LEVEL quoted still reads off the RECENT absolute low/high (trend-accurate).
  const baseline = new Map([...dayMids].map(([day, mids]) => [day, median(mids)]));

  const hours = [];
  for (let h = 0; h < 24; h++) {
    const byDay = new Map();                              // one sample/day (dedupe any intra-hour dupes)
    for (const s of (byHour.get(h) || [])) if (keep.has(s.day)) byDay.set(s.day, s);
    if (!byDay.size) continue;
    const samples = [...byDay.values()];
    const recent = samples.filter(s => recentSet.has(s.day));
    const devLow = samples.map(s => (s.low != null && baseline.has(s.day)) ? s.low - baseline.get(s.day) : null);
    const devHi = samples.map(s => (s.hi != null && baseline.has(s.day)) ? s.hi - baseline.get(s.day) : null);
    // per-sample MID deviation — the anchor axis PF1's forecast projects on (`baselineNow = liveMid −
    // devMid(currentHour)`), so the current-hour projection reproduces the live price by construction.
    const devMidS = samples.map(s => {
      if (!baseline.has(s.day)) return null;
      const m = (s.low != null && s.hi != null) ? (s.low + s.hi) / 2 : (s.low ?? s.hi);
      return m != null ? m - baseline.get(s.day) : null;
    });
    const rlows = recent.map(s => s.low).filter(v => v != null);
    const rhis = recent.map(s => s.hi).filter(v => v != null);
    hours.push({
      h, n: samples.length,
      devLow: median(devLow), devHi: median(devHi),                       // de-trended SHAPE
      // ADDITIVE PF1 dispersion fields — the forecast BAND is built from these so it isn't re-derived
      // outside hourProfile (the one-owner rule). devMid = de-trended mid shape (the projection anchor);
      // devLowSpread/devHiSpread = IQR of that hour's low/high deviation samples (how tightly the dip/peak
      // prints across days). Every field ABOVE/BELOW is byte-unchanged — existing consumers ignore these.
      devMid: median(devMidS),
      devLowSpread: iqr(devLow), devHiSpread: iqr(devHi),
      lowRecent: rlows.length ? median(rlows) : median(samples.map(s => s.low)),   // absolute LEVEL
      hiRecent: rhis.length ? median(rhis) : median(samples.map(s => s.hi)),
      volLo: median(samples.map(s => s.volLo)), volHi: median(samples.map(s => s.volHi)),
    });
  }
  const withLow = hours.filter(x => x.devLow != null);
  const withHi = hours.filter(x => x.devHi != null);
  if (withLow.length < 2 || withHi.length < 2) return null;

  const dipHour = withLow.reduce((a, b) => (b.devLow < a.devLow ? b : a));
  const peakHour = withHi.reduce((a, b) => (b.devHi > a.devHi ? b : a));
  const amplitude = peakHour.devHi - dipHour.devLow;      // trend-free intraday swing (dip-low → peak-high)
  const hourMap = new Map(hours.map(x => [x.h, x]));
  // grow a contiguous (circular) cluster out from an extreme while neighbours stay within band AND exist
  const cluster = (startH, within, levelFn) => {
    const set = new Set([startH]);
    for (const dir of [1, -1]) for (let step = 1; step < 24; step++) {
      const x = hourMap.get((startH + dir * step + 24) % 24);
      if (!x || !within(x)) break;
      set.add(x.h);
    }
    return { set, level: median([...set].map(h => levelFn(hourMap.get(h)))), hours: [...set].sort((a, b) => a - b) };
  };
  // cluster each side off its OWN deviation spread, NOT the combined amplitude — else a one-sided signal
  // (Ghrazi's evening HIGHS spike but its LOWS are flat) inflates the other side's threshold and the dip
  // cluster swallows the whole day. A flat side keeps a tight threshold → a small (or single-hour) cluster.
  const lowDevs = withLow.map(x => x.devLow), hiDevs = withHi.map(x => x.devHi);
  const lowSpread = Math.max(...lowDevs) - Math.min(...lowDevs);
  const hiSpread = Math.max(...hiDevs) - Math.min(...hiDevs);
  const dipThresh = dipHour.devLow + DIP_CLUSTER_FRAC * lowSpread;
  const peakThresh = peakHour.devHi - DIP_CLUSTER_FRAC * hiSpread;
  const dipC = cluster(dipHour.h, x => x.devLow != null && x.devLow <= dipThresh, x => x.lowRecent);
  const peakC = cluster(peakHour.h, x => x.devHi != null && x.devHi >= peakThresh, x => x.hiRecent);

  const trendSeries = allDays.slice(-nights).map(d => dayLow.get(d)).filter(v => v != null);
  const trendPerDay = slopePerStep(trendSeries);
  const trendDominates = amplitude > 0 && trendPerDay != null && Math.abs(trendPerDay) >= TREND_DOM_FRAC * amplitude;

  return {
    hours,
    dip: { ...spanOf(dipC.set), hours: dipC.hours, level: dipC.level, atHour: dipHour.h },
    peak: { ...spanOf(peakC.set), hours: peakC.hours, level: peakC.level, atHour: peakHour.h },
    amplitude, amplitudePct: dipHour.lowRecent ? amplitude / dipHour.lowRecent : null,
    trendPerDay, trendDominates, nights: keep.size,
  };
}

/**
 * deriveDiurnalRange(profile, { liveLo, liveHi }) — turn an hourProfile into a bid/ask with the
 * stale-to-live guard applied. PURE and tax-agnostic: it returns levels + basis + notes; the CALLER
 * owns tax/break-even/grading (windowread is timing math, not the quote engine). The guard: if the
 * recent dip level is NOT below the live instasell (a trend-erased dip), a resting bid there won't
 * fill — price it to live instead. This is the ONE home for the Ghrazi lesson so screen + windowrange
 * derive an identical range.
 */
export function deriveDiurnalRange(profile, { liveLo = null, liveHi = null } = {}) {
  if (!profile || !profile.dip || !profile.peak) return null;
  const notes = [];
  let bid = profile.dip.level, bidBasis = 'patient-dip';
  if (liveLo != null && bid != null && bid >= liveLo) {
    bid = liveLo; bidBasis = 'live';
    notes.push(profile.trendDominates
      ? 'trend-dominates — the rising floor erases the intraday dip; priced to fill at live instasell'
      : 'dip not below live — priced to fill at live instasell');
  } else if (bid != null && profile.trendDominates) {
    notes.push('trend-dominates — dip is below live but the floor is rising; a resting bid may miss if the trend holds');
  }
  const ask = profile.peak.level;
  if (bid != null && ask != null && ask <= bid) notes.push('degenerate — peak level not above dip level (flat/thin window)');
  return {
    bid, ask, bidBasis,
    dipWindow: { startH: profile.dip.startH, endH: profile.dip.endH },
    peakWindow: { startH: profile.peak.startH, endH: profile.peak.endH },
    amplitude: profile.amplitude, amplitudePct: profile.amplitudePct,
    trendDominates: profile.trendDominates, trendPerDay: profile.trendPerDay, notes,
  };
}

// --- soft-buy timing (the ADD-while-holding entry read, INFORM-ONLY n≈0) -----------------------
// The DECISION DIGEST already carries a soft-buy column (dip window + live-vs-floor marker), but the
// digest EXCLUDES held items — so it's blind to the case that actually costs money: mistiming an ADD to
// a lot we ALREADY hold/accumulate (Dragon boots bought into the daytime peak ~350k over; blowpipe at
// 10.67m vs the 10.40m dip, both while holding). Doctrine (memory "buy-soft-while-holding-for-peak"):
// holding a position to sell into a LATER peak is NOT a reason to sit idle on the BUY side — buy its
// diurnal dip when it's soft. softBuyRead answers "when is it cheapest to ADD, and is NOW that time?"
// off the SAME hourProfile the diurnal note already computes (ZERO new fetch — same inputs as
// deriveDiurnalRange):
//   dipWindow — the diurnal DIP window (the cheapest hours-of-day to add), from profile.dip.startH/endH.
//   floor     — profile.dip.level, the recent dip-cluster low (the add-here bid candidate).
//   marker    — '@floor' when live sits ≤ SOFT_BUY_AT_FLOOR_PCT % over the dip floor (or below it) → buy
//               now; '+X%' when live sits X% above the dip → wait for the window to come round.
//   buyNow    — the boolean the render turns into the plain "buy now / wait" cue.
// SYMMETRIC with screen-flip-niches.mjs's digest soft-buy column (same HH:00–HH:00 · @floor / +X% cell
// format + the same SOFT_BUY_AT_FLOOR_PCT boundary) so both surfaces read consistently once both land —
// the digest's digestSoftBuy is meant to reconcile onto THIS helper. INFORM-ONLY (tier: context) — n≈0,
// a HEURISTIC, never gates, never a verdict, never a screen.json/rank input (rule 4). A null/absent
// profile (or no dip level) ⇒ null ⇒ the note simply doesn't render (degrade like trajectoryRead).
export const SOFT_BUY_AT_FLOOR_PCT = 0.5;   // live within this % over the dip floor (or below) ⇒ @floor / buy now (mirrors the digest branch)

export function softBuyRead(profile, { live = null } = {}) {
  if (!profile || !profile.dip || profile.dip.level == null) return null;
  const floor = profile.dip.level;
  const dipWindow = { startH: profile.dip.startH, endH: profile.dip.endH };
  let marker = null, overPct = null, buyNow = null;
  if (live != null && floor > 0) {
    overPct = (live - floor) / floor * 100;
    buyNow = overPct <= SOFT_BUY_AT_FLOOR_PCT;                // at/below the floor, or within the threshold over it
    marker = buyNow ? '@floor' : `+${overPct.toFixed(1)}%`;
  }
  return { dipWindow, floor, live, marker, overPct, buyNow };
}

// formatSoftBuy(read, opts) — the ONE one-line render off a softBuyRead result, shared so both surfaces
// phrase it identically. Null read ⇒ null (no note). `fmtHour` defaults to the HH:00 formatter that
// money-format's fmtHour produces, so windowread stays import-free; a caller may pass its own to match.
export function formatSoftBuy(read, { fmtHour = h => String(h).padStart(2, '0') + ':00' } = {}) {
  if (!read) return null;
  const win = `${fmtHour(read.dipWindow.startH)}–${fmtHour(read.dipWindow.endH)}`;
  if (read.marker == null) return `soft-buy: dip ${win}`;                // no live reference ⇒ window only
  return `soft-buy: dip ${win} · live ${read.marker} · ${read.buyNow ? 'buy now' : 'wait'}`;
}

// --- diurnal-phase entry-timing (INFORM-ONLY PLACEHOLDER, n≈0) ---------------------------------
// WHERE does NOW sit in this item's daily demand cycle relative to its peak WINDOW? The reach/asym/
// windowClear reads all say WHERE a level prints; this says WHEN in today's cycle you're ENTERING —
// the miss that stranded 5 blowpipe units: we maxed the 8/8 buy limit as the 03–09 peak was CLOSING,
// caught the tail-of-peak fast fills, then it cooled with the next peak ~16h away. Had the screen said
// "post-peak — cooling, next peak ~16h" at entry we'd have sized a starter, not the full limit.
// PURE over the profile's peak window + the wall clock (LOCAL hours — the peak startH/endH are already
// local, and inWindow's wrap convention handles a midnight-crossing peak, so NO timezone math here —
// the displayed-times-are-LOCAL convention holds). Phase off the LOCAL current hour vs the peak
// [startH,endH):
//   in-peak    — inside the window (hoursToPeakClose = forward hours to endH).
//   pre-peak   — outside, and NEARER the next OPEN than the last CLOSE (the ramp is approaching).
//   post-peak  — outside, and NEARER the last CLOSE (cooling; the next peak is a cycle away).
// hoursToNextPeak = forward hours to the window's next open (always defined outside the window).
// INFORM-ONLY: n≈0, NO threshold — it NEVER gates/drops a pick or moves grade/rank (a placeholder
// timing read pending F1, rule 4). The screen prints it as the ⏲ token appended to the Diurnal timing
// line; stdout-only (the diurnal block never reaches screen.json), so no APP_VERSION dependence.
export function diurnalPhase(profile, { now = new Date() } = {}) {
  if (!profile || !profile.peak || profile.peak.startH == null || profile.peak.endH == null) return null;
  const { startH, endH } = profile.peak;
  const h = now.getHours();
  const hoursToNextPeak = ((startH - h + 24) % 24) || 24;   // forward hours to the next window open
  if (inWindow(h, startH, endH)) {
    const hoursToPeakClose = ((endH - h + 24) % 24) || 24;  // forward hours to this window's close
    return { phase: 'in-peak', hoursToPeakClose, hoursToNextPeak, startH, endH };
  }
  const hoursSinceClose = ((h - endH + 24) % 24);
  const phase = hoursToNextPeak <= hoursSinceClose ? 'pre-peak' : 'post-peak';
  return { phase, hoursToPeakClose: null, hoursToNextPeak, hoursSinceClose, startH, endH };
}

// PLAN-REMOVE-DEPTH-PRESSURE-READS chunk 2 (2026-07-22): the Extension-B per-hour demand-CYCLE
// classifier — `hourlyPressure` (DC1 per-hour track), `pressureWindow` (the buy/sell window grower),
// `demandRegime` (DC1/DC3 regime + windows), and their PRESSURE_REGIME_S / DEMAND_CLUSTER_FRAC constants
// — were REMOVED (narrow removal: these powered only the --pressure DC2 inspector block + the scan's
// DC3 inform annotation, never a gate/rank/screen.json). `demandPressure` (PB1) + `reachableBand`
// (Extension A) SURVIVE above (they are the pressure sell-model's price source). `spanOf` is kept — it's
// shared with hourProfile's dip/peak windows. Revive the cycle read from git history if ever needed.
