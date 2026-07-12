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
