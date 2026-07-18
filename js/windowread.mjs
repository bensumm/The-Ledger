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

// Flow at/beyond a level within one day's buckets. ask side = instabuy volume at/ABOVE the ask;
// bid side = instasell volume at/BELOW the bid (the DE6 low-side mirror rides this same engine).
const flowBeyond = (buckets, level, side) =>
  buckets.reduce((s, b) => s + ((side === 'bid' ? b.p <= level : b.p >= level) ? b.v : 0), 0);

/* depthDays(series, level, opts) → per-day flow-beyond + clear counts, or null when no window data.
 *   { perDay:[{key, flow, clears}], nDays, clearedDays, clearFrac, recentDays, recentClears, recentFrac }
 * A day "clears" when flow ≥ competition×qty (qty>0); with qty→0 it degenerates to flow>0 — "a bucket
 * beyond the level actually traded" — which IS reachedDays/touchedDays (the pinned subsumption proof:
 * the reach count is this model's zero-size limit). `side` selects ask (default) vs the low-side mirror. */
// @provisional-api: PLAN-DEPTH-EXIT DE1 — the per-day depth read consumed by DE2 (read-window-range --depth)
// and DE3 (watch-positions held-lot line + suggestions.jsonl shadow fields), the tracked next surfaces.
export function depthDays(series, level, { qty = 0, competition = DEPTH_COMPETITION_MULT, side = 'ask', wStart, wEnd, nights = 14, now = new Date(), recentN = RECENT_NIGHTS } = {}) {
  if (level == null) return null;
  const scored = windowBuckets(series, { nights, wStart, wEnd, now });
  if (!scored.length) return null;
  const need = competition * qty;
  const perDay = scored.map(([key, r]) => {
    const flow = flowBeyond(side === 'bid' ? r.lo : r.hi, level, side);
    return { key, flow, clears: qty > 0 ? flow >= need : flow > 0 };
  });
  const nDays = perDay.length;
  const clearedDays = perDay.filter(d => d.clears).length;
  const recent = perDay.slice(-recentN);
  const recentClears = recent.filter(d => d.clears).length;
  return {
    perDay, nDays, clearedDays, clearFrac: clearedDays / nDays,
    recentDays: recent.length, recentClears,
    recentFrac: recent.length ? recentClears / recent.length : null,
  };
}

/* clearableLevel — the ONE side-generic engine behind clearableAsk (DE1) and clearableBid (DE6).
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

/* clearableBid(series, opts) → the DE6 low-side mirror: the LOWEST bid P whose instasell flow at/
 * BELOW it clears competition×qty on ≥ targetFrac of days (≥ minBuckets support) — "how deep can I
 * bid and still get filled". Same subsumption proof (qty→0 ≡ touchedDays — depthDays side:'bid'),
 * same structural mirage guard (a thin book's clearableBid collapses UP toward where flow trades,
 * never below it), same floor (never below the observed data — a real bucket price). With
 * clearableAsk this is the TWO-SIDED size-aware band: the honest version of the asym deep-bid →
 * high-ask shape, priced off real depth instead of quantiles. Inform-only; rank effect is DE7. */
// @provisional-api: PLAN-DEPTH-EXIT DE6 — consumed by DE2's --depth inspector (both edges) and the
// DE3-era held-lot/quote surfaces; DE7 (F1-gated) later promotes the two-sided band into screen rank.
export function clearableBid(series, opts = {}) { return clearableLevel(series, 'bid', opts); }

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

// --- per-hour demand-cycle classifier (PLAN-DEPTH-EXIT Extension B, DC1) -----------------------
// Pressure is not static — it CYCLES by hour (Soul rune ran 1.26–2.49× across the day; sell-heavy
// commodities trough below 1). hourlyPressure exposes that cycle; demandRegime classifies the item
// and names the timing windows. Two payoffs the pooled-window pressure hides: (1) TIMING — the
// high-buy-pressure hours are the SELL window, the sell-pressure hours are the BUY window (the
// demand-side complement to hourProfile's PRICE-shape diurnal read); (2) a flip-SIDE classifier —
// sell-heavy = dip-buy flips, buy-heavy = sell-into-demand/accumulation (DC3's inform column).
//
// THE AGGREGATION RULE (the design correction, Ben 2026-07-15): per-hour pressure is the ratio of
// per-hour volume AGGREGATES (the MEDIAN across days of each hour's bucket volume), NOT the median
// of per-day RATIOS — a zero-volume hour on some day would otherwise divide by zero and a single
// noisy day would swing the ratio. hourProfile ALREADY computes exactly those per-hour median
// volumes (its hours[].volHi/volLo), so hourlyPressure reuses them + demandPressure (PB1) — one
// vocabulary, no re-bucketing. Per-cell reliability (demandPressure's volume floor) handles thin
// hours: a handful of units reads reliability ~0, so the regime label degrades honestly.
// n≈0 — the per-hour median is a ~14-day sample per cell; the regime label is a LEAN, not a law,
// and a demand-window is NEVER a guaranteed fill time (rule 4). All thresholds are placeholders.
const PRESSURE_REGIME_S   = 0.2;   // |ln pressure| below this ⇒ 'balanced' (ratio within ~0.82–1.22); PLACEHOLDER
const DEMAND_CLUSTER_FRAC = 0.34;  // an hour within this fraction of the per-hour s-amplitude of the extreme joins the window (mirrors DIP_CLUSTER_FRAC)

/* hourlyPressure(series, opts) → per-local-hour demand-balance track, or null (too thin to profile).
 *   [{ hour, pressure, s, reliability, medVolHi, medVolLo, n }]  (hours with data, ascending)
 * pressure/s/reliability come from demandPressure({medVolHi, medVolLo}) off hourProfile's per-hour
 * MEDIAN volumes (the aggregate-then-ratio rule above); null pressure on an hour whose sell side never
 * traded. REUSES hourProfile — same hour buckets, de-trend machinery, and MIN_DAYS degrade. */
// @provisional-api: PLAN-DEPTH-EXIT Extension B (DC1) — consumed by demandRegime below + DC2's
// read-window-range --pressure per-hour track and DC3's scan flip-side inform column.
export function hourlyPressure(series, { nights = 14, now = new Date(), recentN = RECENT_NIGHTS } = {}) {
  const prof = hourProfile(series, { nights, now, recentN });
  if (!prof) return null;
  return prof.hours.map(h => {
    const dp = demandPressure({ medVolHi: h.volHi, medVolLo: h.volLo });
    return {
      hour: h.h,
      pressure: dp ? dp.ratio : null, s: dp ? dp.s : null,
      reliability: dp ? dp.reliability : 0,
      medVolHi: h.volHi, medVolLo: h.volLo, n: h.n,
    };
  });
}

// Grow a circular-contiguous hour window out from the pressure extreme, but ONLY when that extreme
// hour genuinely crosses into the regime the window names (a sell window needs a buy-heavy peak; a
// buy window needs a sell-heavy trough) — so an all-buy-heavy item reports a SELL window and NO buy
// window (there is no dip-buy hour), and vice versa. Reuses spanOf for the readable "HH–HH" label.
function pressureWindow(track, side) {
  const rel = track.filter(t => t.s != null && t.reliability > 0);
  if (rel.length < 2) return null;
  const ext = side === 'sell' ? rel.reduce((a, b) => b.s > a.s ? b : a) : rel.reduce((a, b) => b.s < a.s ? b : a);
  // a genuine window only when the extreme hour actually crosses into the regime (else it's noise)
  if (side === 'sell' ? ext.s < PRESSURE_REGIME_S : ext.s > -PRESSURE_REGIME_S) return null;
  const sVals = rel.map(t => t.s), amp = Math.max(...sVals) - Math.min(...sVals);
  const within = amp > 0 ? DEMAND_CLUSTER_FRAC * amp : 0;
  const has = new Map(rel.map(t => [t.hour, t]));
  const inC = t => side === 'sell' ? t.s >= ext.s - within : t.s <= ext.s + within;
  const set = new Set([ext.hour]);
  for (const dir of [1, -1]) for (let step = 1; step < 24; step++) {
    const h = (ext.hour + dir * step + 24) % 24, t = has.get(h);
    if (!t || !inC(t)) break;
    set.add(h);
  }
  return { ...spanOf(set), hours: [...set].sort((a, b) => a - b), atHour: ext.hour, pressure: Math.exp(ext.s) };
}

/* demandRegime(series, opts) → { regime, pooled, s, reliability, buyWindow, sellWindow, hours } | null.
 *   regime      — 'buy-heavy' | 'sell-heavy' | 'balanced' off the POOLED whole-window pressure.
 *   pooled/s    — the pooled ratio + its ln (the classification basis).
 *   sellWindow  — the peak-buy-pressure hours (buyers hungry → SELL here); null if no buy-heavy peak.
 *   buyWindow   — the trough (sell-pressure) hours (sellers dump → BUY here); null if no sell-heavy trough.
 *   hours       — the full hourlyPressure track (for the caller's per-hour render).
 * DIVERGENCE FROM THE PLAN'S DC1 ONE-LINER (surfaced, resolved per Extension B's model): the plan bullet
 * said an all-buy-heavy item has "no sell window", but Extension B's model is "high-buy-pressure hours ARE
 * the sell window" — so an all-buy-heavy item HAS a sell window (its best hours to sell) and lacks a BUY
 * window (no genuine dip-buy hour). Implemented per the model; the fixtures assert that. */
// @provisional-api: PLAN-DEPTH-EXIT Extension B (DC1) — consumed by DC2 (--pressure regime + window
// labels) and DC3 (scan flip-side inform column). No rank/gate effect (DC3's rank half is F1-gated).
export function demandRegime(series, { nights = 14, now = new Date(), recentN = RECENT_NIGHTS } = {}) {
  const stats = windowStats(series, { nights, wStart: 0, wEnd: 0, now });
  const pooled = stats ? demandPressure(stats) : null;
  const hours = hourlyPressure(series, { nights, now, recentN });
  if (!pooled && !hours) return null;
  const regime = !pooled ? 'balanced'
    : pooled.s >= PRESSURE_REGIME_S ? 'buy-heavy'
    : pooled.s <= -PRESSURE_REGIME_S ? 'sell-heavy' : 'balanced';
  return {
    regime,
    pooled: pooled ? pooled.ratio : null, s: pooled ? pooled.s : null,
    reliability: pooled ? pooled.reliability : 0,
    sellWindow: hours ? pressureWindow(hours, 'sell') : null,
    buyWindow: hours ? pressureWindow(hours, 'buy') : null,
    hours,
  };
}
