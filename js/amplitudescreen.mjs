/**
 * amplitudescreen.mjs — PURE gate + rank math for the `--mode amplitude` 24h-cycle niche
 * (PLAN-AMPLITUDE-SCAN chunk A1). Mirrors js/valuescreen.mjs's shape: DOM-free, fetch-free, fs-free
 * ESM, importable from BOTH node (screen-flip-niches.mjs / gatecandidates.mjs) AND the app. The caller
 * hands in an already-loaded per-item series' windowStats() result (js/windowread.mjs) + the daily
 * archive slice — no fetch here.
 *
 * THE NICHE (PLAN-AMPLITUDE-SCAN, Ben 2026-07-19). The band screen prices the 2h band and ranks
 * `net × P(fill) ÷ TTF` — which BURIES a big-ticket that oscillates ~4% over a FULL DAY (Masori body:
 * Quick +0.0% / Optimistic +1.2% at the 2h grain, rank ~12,881 with P~0.06 / ttf ~26h). That daily
 * swing is a real, repeatable edge the band screen is STRUCTURALLY BLIND to. Amplitude is the lane that
 * sees it: buy the daily TROUGH, sell the daily PEAK, hold ~a day, cycle. The organizing frame (§1):
 * band/amplitude/invest are ONE operation at three cycle periods (2h / 24h / multi-week).
 *
 * TWO-STAGE GATE (§2.1 — like value's). At gate time the screen has only bulk data (the corrected
 * rolling-24h volumes, the 2h bands, and the daily archive = whole-market /1h at 6h spacing = 4 mid
 * samples/day). Per-day TRUE hi/lo needs the per-item 1h series, fetched only for the top-N pool. So:
 *   Stage 1 (pre-fetch, bulk daily archive) — amplitudeProxy(): recent-5d median of the daily
 *            (max-mid − min-mid) range off the 6h-spaced archive, thresholded at a LOWER placeholder
 *            than the true gate (the 4-samples/day grain reads MIDS not hi/lo and misses intra-6h
 *            extremes, so it systematically ATTENUATES the range). Its only job is picking the fetch
 *            pool, exactly like proxyDrift. Cold slice ⇒ null (degrade honestly, never a fake amplitude).
 *   Stage 2 (post-fetch, per-item 1h series) — amplitudeRanges()/amplitudeGate() off ONE
 *            windowStats(series1h, { wStart:0, wEnd:0 }) call: the daily-amplitude median floor, the
 *            both-leg recent-3 daily reach (bid TOUCHED + ask REACHED on ≥2 of recent-3 days via
 *            recencySplit), and a trend/knife guard (the caller passes trendDominates + knife flags —
 *            a trending item's "amplitude" is drift you get run over on, not a cycle).
 *
 * RANKING (§2.2 — NOT a bespoke ampScore). Amplitude registers an `'amplitude'` ESTIMATOR FAMILY
 * (js/estimators/families.mjs) so the standard rank = net × P(fill) ÷ TTF machinery carries it:
 *   pFill    = the two-leg recent-reach PRODUCT at the quoted daily pair (bid-touch × ask-reach) — the
 *              honest "will the round trip complete?" number as a first-class rank input from day one.
 *   ttf      = the hold-horizon prior (holdDays × 86400).
 *   lapUnits = the deployable-units min() (bankroll ÷ trough-bid, vol-share, buy-limit accumulation) —
 *              bankroll = TOTAL REALIZABLE capital (liquidCapital) UNDIVIDED (concentration lane, no ÷slots).
 * amplitudeDeployUnits() below is that min(), floored honestly (0 = unaffordable → caller drops the pick);
 * the family reads it. No parallel ranking composite.
 *
 * HONESTY (rule 4 — n≈0). EVERY threshold below is a NAMED PLACEHOLDER. The lane is a hypothesis
 * surfaced inform-first until it has a record (§4): the make-or-break question — do BOTH legs actually
 * fill within the hold horizon, repeatably? — is measured by the §A5 shadow both-leg replay (an UPPER
 * bound: a printed level ≠ your fill) + the realized retro-join. Do NOT cite any constant here as
 * validated.
 */
import { tax } from './money-math.js';
import { quantLow, quantHigh, recencySplit, RECENT_NIGHTS } from './windowread.mjs';

const num = x => (typeof x === 'number' && Number.isFinite(x)) ? x : null;
const afterTax = p => p - tax(p);
const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
// recencySplit() does NOT expose a `scored` flag — recompute it with the SAME rule recencySplit uses
// internally (a full recent window AND a longer full window behind it), so a thin recent slice honestly
// falls back to the full-window fraction instead of over-trusting a 0/1-day recent read.
const recencyScored = (rs, recentN) => rs.recentDays >= recentN && rs.fullN >= recentN + 2;

// --- PLACEHOLDER constants (rule 4 — unvalidated; the shadow replay + retro-join would tune them) ---
// The after-tax DAILY amplitude floor: the recent-5d median of per-day (afterTax(hi) − low)/low must
// clear this for one taxed round trip to net meaningfully. Measured on the DAILY range (windowStats
// per-day hi/lo), NOT the 2h band — the edge the band can't see. PLACEHOLDER.
// The recent-5d median of per-day after-tax amplitude ((afterTax(hi) − low)/low) must clear this. Note
// this MEDIAN-per-day basis reads LOWER than the raw hi↔lo range the lane's origin cited (Masori body's
// raw 41.3m↔43.9m ≈ 6% is ~2.1% on the taxed median-per-day basis) — the floor is set to the median
// basis, so ~2% here IS the ~4-6% raw-range class the lane targets. PLACEHOLDER (n≈0).
export const AMP_MIN_AMP_PCT   = 0.02;
// Stage-1 pre-fetch proxy floor — LOWER than the true gate because the 6h-spaced archive reads mids
// (not hi/lo) and misses intra-6h extremes, so it under-reads the true daily range. Its only job is
// picking the fetch pool; the exact gate is Stage 2. PLACEHOLDER.
export const AMP_STAGE1_MIN_PCT = 0.015;
// Amplitude is a big-ticket capital-deployment lane (Masori ≈42m); a sub-threshold item's % swing is
// book noise. Its own price window (§2.1): the shared default MAX_PRICE 45m nearly CLIPS the anchor
// example, so the lane carries NO upper cap and a real capital-deployment MIN. PLACEHOLDERS.
export const AMP_MIN_PRICE     = 1_000_000;
export const AMP_MAX_PRICE     = Infinity;
// Both-leg daily reach: the trough-bid touches on ~AMP_BID_Q of window days and the peak-ask reaches on
// ~AMP_ASK_Q of them (the DAILY median trough/peak — the levels the cycle actually prints). Quoting the
// median daily low/high keeps both legs genuinely two-sided-reachable (the thesis). PLACEHOLDERS.
export const AMP_BID_Q         = 0.5;      // trough-bid = median daily low
export const AMP_ASK_Q         = 0.5;      // peak-ask  = median daily high
// The load-bearing viability test (§4): the quoted bid AND ask must each hit on ≥ AMP_MIN_RECENT_HITS
// of the recent AMP_RECENT_N (=3) days (recencySplit's staleOptimistic guard honored). PLACEHOLDERS.
export const AMP_RECENT_N        = RECENT_NIGHTS;   // 3 — the recency window recencySplit compares against
export const AMP_MIN_RECENT_HITS = 2;               // ≥2 of recent-3 is the STRONG both-leg reach signal
export const AMP_MIN_FULL_FRAC   = 0.5;             // …or the level prints on ≥ half the FULL window (recent-3 is the strong signal, the full window the fallback — the staleOptimistic guard still bites)
export const AMP_MIN_DAYS        = 5;               // thinner day sample than this ⇒ no read (mirrors ASYM_MIN_DAYS)
// Deployable-units bound (mirrors valueScore's three-way min + expUnits): bankroll ÷ trough-bid,
// vol-share × limiting-side volume × hold days, buy-limit × windows/day × hold days. PLACEHOLDERS.
export const AMP_VOL_SHARE       = 0.10;
export const AMP_WINDOWS_PER_DAY = 6;
// Hold horizon (§2.4): default 1 (buy the trough, sell the peak, same local day); 1.5 crosses a day
// boundary (the A3 experiment). Feeds the family ttf + the §A5 shadow-replay horizon. PLACEHOLDER.
export const AMP_HOLD_DAYS_DEFAULT = 1;

/* --- Stage 1: the pre-fetch amplitude PROXY off the 6h-spaced daily archive -----------------------
   points — a loadDaily {ts,mid} array for one item (whole-market /1h @ 6h spacing = 4 mids/day).
   Groups the mids by LOCAL day, takes each day's (max − min) mid range / min, and returns the recent-5d
   median as an amplitude %. ATTENUATED by construction (mids, 4 samples/day) — thresholded LOW (Stage-1
   floor) upstream. Null on a cold/short slice (the honest degrade — never a fake amplitude). */
export function amplitudeProxy(points, { recentDays = 5, minDays = 3 } = {}) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const byDay = new Map();
  for (const p of points) {
    if (p == null || p.mid == null || !Number.isFinite(p.ts)) continue;
    const d = new Date(p.ts * 1000);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    const rec = byDay.get(key) || { min: Infinity, max: -Infinity };
    if (p.mid < rec.min) rec.min = p.mid;
    if (p.mid > rec.max) rec.max = p.mid;
    byDay.set(key, rec);
  }
  const keys = [...byDay.keys()].sort();                 // chronological (YYYY-M-D lexical is monotone within a year)
  const recent = keys.slice(-recentDays);
  const pcts = [];
  for (const k of recent) {
    const r = byDay.get(k);
    if (r.min > 0 && r.max >= r.min && r.min !== Infinity) pcts.push((r.max - r.min) / r.min);
  }
  if (pcts.length < minDays) return null;                // too little archive → unknown (fall back to raw)
  pcts.sort((a, b) => a - b);
  return pcts[Math.floor(pcts.length / 2)];              // recent-N median daily range %
}

/* --- Stage 2: the exact per-day amplitude SHAPE off a windowStats result --------------------------
   stats — a js/windowread.mjs windowStats(series1h, { wStart:0, wEnd:0 }) result (its .days carry
           per-day {low, hi}; .lows/.his are the ascending quantile arrays).
   live  — the current live price (the instasell post-fetch), for a proximity note (optional).
   opts  — { holdDays } feeds the family ttf + the shadow-replay horizon.
   Returns the amplitude SHAPE features, or { hasData:false }. */
export function amplitudeRanges(stats, live, { holdDays = AMP_HOLD_DAYS_DEFAULT, recentN = AMP_RECENT_N } = {}) {
  if (!stats || !Array.isArray(stats.days) || !Array.isArray(stats.lows) || !Array.isArray(stats.his)
    || !stats.lows.length || !stats.his.length) return { hasData: false };
  const nDays = stats.days.length;
  if (nDays < AMP_MIN_DAYS || stats.lows.length < AMP_MIN_DAYS || stats.his.length < AMP_MIN_DAYS)
    return { hasData: false, cold: true };

  // recent-N median of the per-day after-tax amplitude % ((afterTax(hi) − low) / low). Measured on the
  // DAILY range (the edge the 2h band can't see). Uses the newest `recentDaysForAmp` complete days.
  const recentDaysForAmp = Math.max(recentN, 5);
  const dayPcts = stats.days.slice(-recentDaysForAmp)
    .map(([, n]) => (n.low != null && n.hi != null && n.low > 0) ? (afterTax(n.hi) - n.low) / n.low : null)
    .filter(v => v != null).sort((a, b) => a - b);
  const medAmpPct = dayPcts.length ? dayPcts[Math.floor(dayPcts.length / 2)] : null;

  const ampBid = quantLow(stats.lows, AMP_BID_Q);        // trough-bid — touched on ~AMP_BID_Q of days
  const ampAsk = quantHigh(stats.his, AMP_ASK_Q);        // peak-ask   — reached on ~AMP_ASK_Q of days
  const bidTouch = recencySplit(stats.days, 'bid', ampBid, recentN);
  const askReach = recencySplit(stats.days, 'ask', ampAsk, recentN);
  const netPerCycle = (ampBid != null && ampAsk != null) ? afterTax(ampAsk) - ampBid : null;
  const ampPct = (netPerCycle != null && ampBid > 0) ? netPerCycle / ampBid : null;
  // two-leg fill probability = bid-touch × ask-reach, recent-3-weighted (the recentFrac each carries),
  // degrading to the full-window frac when the recent slice was too thin to score (recencySplit.scored).
  const bidFrac = recencyScored(bidTouch, recentN) ? bidTouch.recentFrac : bidTouch.fullFrac;
  const askFrac = recencyScored(askReach, recentN) ? askReach.recentFrac : askReach.fullFrac;
  const pFill2leg = clamp01(bidFrac) * clamp01(askFrac);

  return {
    hasData: true, live: num(live), nDays,
    ampBid, ampAsk, netPerCycle, ampPct, medAmpPct,
    bidTouch, askReach, pFill2leg, holdDays,
    liveVsBidPct: (num(live) != null && ampBid > 0) ? (live - ampBid) / ampBid : null,
  };
}

/* amplitudeGate(ar, { trendDominates, knife, oscillating, driftMargin }) → { pass, reason }. Two-sided
   liquidity + the price window are the CALLER's (shared stack, kept); this owns the amplitude-specific gate:
   the daily after-tax amplitude floor, the both-leg recent-3 reach viability test, the trend/knife guard
   (a trending item's "amplitude" is drift — reject; oscillation around a flat level is the thesis), and
   PLAN-OSCILLATION-CYCLE Chunk 3's drift-adjusted `margin-below-floor` gate — THE ONLY GATE in that program.
   reason is null on pass; reject reasons (in order): no-history / amp-below-floor / bid-unreachable /
   ask-unreachable / trend / knife / margin-below-floor.

   Chunk 3B — the knife guard is now TEMPERED by `oscillating` (from js/forecast.mjs oscillationVsKnife):
   a raw knife signal (`knife`) that is ALSO an oscillator riding a drift (`oscillating===true`) is NOT a
   false knife — it is NOT rejected here and falls through to the margin gate, which admits it only if its
   drift-adjusted margin clears the floor. This deliberately LOOSENS the knife guard; it is safe because
   every survivor it lets past must still clear the margin gate below.

   Chunk 3A — `driftMargin` is the amplitudeDriftMargin() result (afterTax(driftAdjustedPeak) − entry −
   AMP_DRIFT_REQ_MARGIN; the floor is ALREADY subtracted inside it — one-home threshold). DIRECTION-AGNOSTIC
   by construction: `.margin` is the SIGNED consequence of the drift NUMBER, so the reject is a single
   `margin <= 0` comparison — identical arithmetic whether the drift was + or −; there is NO sign branch.
   Degrade-OPEN: a null/absent driftMargin (exit projection degraded — thin days, refused forecast) is NOT a
   reject; only a POSITIVELY-computed sub-floor margin drops the row (honesty §4 — never a fake rejection). */
export function amplitudeGate(ar, { trendDominates = false, knife = false, oscillating = false, driftMargin = null, recentN = AMP_RECENT_N } = {}) {
  if (!ar || !ar.hasData) return { pass: false, reason: 'no-history' };
  if (!(ar.medAmpPct != null && ar.medAmpPct >= AMP_MIN_AMP_PCT)) return { pass: false, reason: 'amp-below-floor' };
  // both-leg daily reach — the load-bearing viability test (§4). A leg is reachable when the level prints
  // on ≥2 of recent-3 days (the STRONG signal) OR on ≥ half the FULL window (the fallback the plan spells
  // out: "the full-window count shown BESIDE recent-3"), and — either way — is NOT staleOptimistic (a
  // level the full window reaches but recent days have abandoned is stranded/pre-regime; recencySplit's guard).
  const legOk = rs => !rs.staleOptimistic
    && ((recencyScored(rs, recentN) && rs.recentHit >= AMP_MIN_RECENT_HITS) || rs.fullFrac >= AMP_MIN_FULL_FRAC);
  if (!legOk(ar.bidTouch)) return { pass: false, reason: 'bid-unreachable' };
  if (!legOk(ar.askReach)) return { pass: false, reason: 'ask-unreachable' };
  if (trendDominates) return { pass: false, reason: 'trend' };   // drift swamps the swing
  // knife guard, TEMPERED (Chunk 3B): a monotone decline-in-progress is dropped — UNLESS the drift-aware
  // oscillationVsKnife detector says the shape is an oscillator riding a drift, in which case it is NOT a
  // false knife and falls through to the margin gate below (which still has final say). LOOSENS the guard.
  if (knife && !oscillating) return { pass: false, reason: 'knife' };
  // margin-below-floor (Chunk 3A) — sequenced LAST so a knife is still attributed to `knife`, not `margin`.
  // Direction-agnostic single comparison; the AMP_DRIFT_REQ_MARGIN floor already lives inside `.margin`.
  if (driftMargin && driftMargin.margin != null && driftMargin.margin <= 0) return { pass: false, reason: 'margin-below-floor' };
  return { pass: true, reason: null };
}

// --- PLAN-OSCILLATION-CYCLE Chunk 2 — the drift-adjusted margin (INFORM-ONLY here; the gate is Chunk 3) ---
// The required per-cycle after-tax profit BUFFER the drift-adjusted margin must clear. n≈0 PLACEHOLDER
// (rule 4 — F1 owns it): 0 gp = "any positive drift-adjusted net qualifies", the honest floor until the
// Chunk-2 shadow bake yields a real buffer. Chunk 3's `margin-below-floor` gate reuses THIS constant, so
// the shadow-logged number and the eventual gate read the SAME threshold (one-home).
export const AMP_DRIFT_REQ_MARGIN = 0;

/* amplitudeDriftMargin(dae, { entry, requiredMargin }) → the drift-adjusted margin off a js/forecast.mjs
   driftAdjustedExit() result, or null. THE margin (PLAN "corrected mechanism"):
     margin = afterTax(driftAdjustedPeak) − entry − requiredMargin
   computed through the SAME `afterTax` path netPerCycle uses (the ONE tax definition, money-math.js), and
   IDENTICALLY regardless of the drift's sign — there is NO branch on ceilingSlope/floorSlope direction (the
   corrected-mechanism ruling: drift is a NUMBER, the margin its consequence, never a direction gate). `entry`
   is the amplitude trough-bid the row already quotes (ar.ampBid). Chunk 2 SHADOW-LOGS this alongside the
   naive ampBid/ampAsk (computed, not acted on); Chunk 3 turns the same number into the gate. Null when the
   exit projection degraded (no driftAdjustedPeak) or no entry — degrade, never a fake margin. */
export function amplitudeDriftMargin(dae, { entry, requiredMargin = AMP_DRIFT_REQ_MARGIN } = {}) {
  if (!dae || dae.driftAdjustedPeak == null || entry == null) return null;
  const margin = afterTax(dae.driftAdjustedPeak) - entry - requiredMargin;
  const r = x => x == null ? null : Math.round(x);
  return {
    driftAdjustedPeak: r(dae.driftAdjustedPeak),
    driftAdjustedTrough: r(dae.driftAdjustedTrough),
    naivePeak: r(dae.naivePeak),
    margin: r(margin),
    requiredMargin,
    ceilingSlope: r(dae.ceilingSlope),
    floorSlope: r(dae.floorSlope),
    confidence: dae.confidence,
  };
}

/* amplitudeDeployUnits({ capGp, buyLow, limitVol, limit, holdDays }) → the deployable units bound, floored
   HONESTLY to an integer (0 when you can't afford even ONE unit). Amplitude is a big-ticket CONCENTRATION
   lane (Ben 2026-07-19), NOT value's diversify-across-N-slots lane: `capGp` is TOTAL REALIZABLE capital
   (liquidCapital — free cash + liquidation value of every hold), used UNDIVIDED — there is NO ÷slots
   divisor. The owner's rule: "the only sizing gate that matters is — can you afford ≥1 unit if all your
   lots were liquid." So the min() bounds are bankroll ÷ trough-bid, vol-share × limiting-side vol × hold,
   buy-limit accumulation × hold; and Math.floor makes an UNAFFORDABLE pick (capGp < buyLow) 0 units — the
   caller DROPS it as `unaffordable` rather than showing a phantom 1u. With no bound known (no capGp) it
   degrades to 1. PLACEHOLDERS (rule 4): an UPPER bound (assumes you catch the full swing + transact your
   whole volume share both sides). */
export function amplitudeDeployUnits({ capGp = null, buyLow = null, limitVol = null, limit = null, holdDays = AMP_HOLD_DAYS_DEFAULT } = {}) {
  const bounds = [];
  if (capGp != null && buyLow != null && buyLow > 0) bounds.push(capGp / buyLow);
  if (limitVol != null) bounds.push(AMP_VOL_SHARE * limitVol * Math.max(1, holdDays));
  if (limit != null) bounds.push(limit * AMP_WINDOWS_PER_DAY * Math.max(1, holdDays));
  if (!bounds.length) return 1;
  return Math.floor(Math.min(...bounds));    // honest floor: 0 when capGp can't cover even one unit
}
