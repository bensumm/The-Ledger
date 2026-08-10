/**
 * amplitudescreen.mjs — PURE gate + rank math for the `--mode amplitude` MULTI-DAY-cycle niche
 * (PLAN-AMPLITUDE-SCAN chunk A1). Mirrors js/valuescreen.mjs's shape: DOM-free, fetch-free, fs-free
 * ESM, importable from BOTH node (screen-flip-niches.mjs / gatecandidates.mjs) AND the app. The caller
 * hands in an already-loaded per-item series' windowStats() result (js/windowread.mjs) + the daily
 * archive slice — no fetch here.
 *
 * THE NICHE (PLAN-AMPLITUDE-SCAN, Ben 2026-07-19). The band screen prices the 2h band and ranks
 * `net × P(fill) ÷ TTF` — which BURIES a big-ticket that oscillates ~4% over a FULL DAY (Masori body:
 * Quick +0.0% / Optimistic +1.2% at the 2h grain, rank ~12,881 with P~0.06 / ttf ~26h). That daily
 * swing is a real, repeatable edge the band screen is STRUCTURALLY BLIND to. Amplitude is the lane that
 * sees it: buy the TROUGH, sell the PEAK, cycle. The organizing frame (§1): band/amplitude/invest are
 * ONE operation at three cycle periods (2h / multi-day / multi-week).
 *
 * RE-HORIZONED 2026-08-09 (PLAN-DIURNAL-TRIAGE DT1). The lane shipped as a 24h-CYCLE screen — "hold ~a
 * day" — and that specific premise was measured and REFUTED: over 92 items ≥5m and 4,881 item-days,
 * completion within 24h GIVEN entry is 4.8%. The EDGE is real but the CLOCK was wrong; completion climbs
 * to 22.6% at 96h and 34.6% at 7d, and the survivors are the repeatable multi-DAY oscillator class (Masori
 * chaps 71% at 7d; fang ~6–8d), which is exactly the taxonomy gap the standing multi-week-oscillator note
 * describes. So the default horizon moved 1 → 4 days and the refuted `pFill2leg` product-of-marginals was
 * DELETED. Its intended replacement `cycleCompletion` proved CIRCULAR (in-sample levels) and is neither shown
 * nor ranked on; DT1b replaced it with `ampWalkForward` — levels fitted STRICTLY PRE-ORIGIN, scored at hour
 * grain — which now drives `pFillAmplitude` directly.
 * The study itself REPRODUCES EXACTLY when re-run (Saturated heart 0.0% @96h n=41; Masori chaps 12.9% @24h
 * n=31), so the refutation is solid. Full numbers: AMP_HOLD_DAYS_DEFAULT below.
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
 *            both-leg reach test (bid TOUCHED + ask REACHED via recencySplit — but READ ITS HEADER: at
 *            the default 0.5/0.5 quantiles this reduces to a STALENESS check, it is not the viability
 *            gate it reads as), and a trend/knife guard (the caller passes trendDominates + knife flags —
 *            a trending item's "amplitude" is drift you get run over on, not a cycle).
 *
 * RANKING (§2.2 — NOT a bespoke ampScore). Amplitude registers an `'amplitude'` ESTIMATOR FAMILY
 * (js/estimators/families.mjs) so the standard rank = net × P(fill) ÷ TTF machinery carries it:
 *   pFill    = the MEASURED walk-forward round-trip rate since DT1b (2026-08-09) — `ampWalkForward`.
 *              Two predecessors sat here and were both refuted: a two-leg recent-reach PRODUCT (independence
 *              measured false) and an in-sample day-grain completion rate (circular). See pFillAmplitude's
 *              header for why each died and what makes this one valid. Prior at n=0 when unmeasurable.
 *   ttf      = the hold-horizon prior (holdDays × 86400).
 *   lapUnits = the deployable-units min() (bankroll ÷ trough-bid, vol-share, buy-limit accumulation) —
 *              bankroll = TOTAL REALIZABLE capital (liquidCapital) UNDIVIDED (concentration lane, no ÷slots).
 * amplitudeDeployUnits() below is that min(), floored honestly (0 = unaffordable → caller drops the pick);
 * the family reads it. No parallel ranking composite.
 *
 * HONESTY (rule 4 — n≈0). EVERY threshold below is a NAMED PLACEHOLDER. The lane is a hypothesis
 * surfaced inform-first until it has a record (§4). The make-or-break question — do BOTH legs actually
 * fill within the hold horizon, repeatably? — is now answered HISTORICALLY by `ampWalkForward` (DT1b),
 * which drives the rank; the §A5 shadow both-leg replay is the FORWARD check and the realized retro-join
 * the only ground truth (a printed level ≠ your fill, so every rate here is an upper bound). Do NOT cite
 * any constant here as validated.
 */
import { tax } from './money-math.js';
import { quantLow, quantHigh, recencySplit, windowStats, RECENT_NIGHTS } from './windowread.mjs';
import { ACTIONABLE_WINDOWS_PER_DAY } from './desk-cadence.mjs';

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
// ⚠ THESE TWO CONSTANTS ARE INERT AT THE DEFAULT QUANTILES — measured 2026-08-09, do not read them as
// live tuning knobs. `ampBid`/`ampAsk` are the MEDIAN low/high of the very days recencySplit then counts
// touches over, so `fullFrac` ≥ 0.5 = AMP_MIN_FULL_FRAC BY CONSTRUCTION whenever AMP_BID_Q/AMP_ASK_Q are
// 0.5. That makes legOk's second disjunct always true, the AMP_MIN_RECENT_HITS branch unreachable, and
// the whole test equivalent to bare `!staleOptimistic`. Measured across 335 items / 670 legs: fullFrac
// min = p10 = median = p90 = 0.500 (sd 0.000), 100% of legs cleared the floor, and legOk returned an
// IDENTICAL verdict to `!staleOptimistic` on 670/670. This is the same in-sample-level defect that sank
// `cycleCompletion` (see pFillAmplitude's header) — a level scored against its own fitting window.
// They bind only BELOW 0.5 (`--amp-ask-q 0.25` ⇒ fullFrac ≈ 0.25). At q ABOVE 0.5 the level is even more
// often touched, so fullFrac only rises and they stay inert — "non-default" is NOT the condition, `q < 0.5`
// is. That narrow case is the only reason they are still here. The honest repair is to make the legs walk-forward like `ampWalkForward`; that is
// a GATE-BEHAVIOUR change (it moves which rows appear) and is deliberately NOT done unilaterally.
// PLACEHOLDERS either way.
export const AMP_RECENT_N        = RECENT_NIGHTS;   // 3 — the recency window recencySplit compares against
export const AMP_MIN_RECENT_HITS = 2;               // ≥2 of recent-3 — UNREACHABLE branch at default quantiles (see above)
export const AMP_MIN_FULL_FRAC   = 0.5;             // …or the level prints on ≥ half the FULL window — TAUTOLOGICALLY satisfied at default quantiles (see above); only the staleOptimistic guard actually bites
export const AMP_MIN_DAYS        = 5;               // thinner day sample than this ⇒ no read (mirrors ASYM_MIN_DAYS)
// Deployable-units bound (mirrors valueScore's three-way min + expUnits): bankroll ÷ trough-bid,
// vol-share × limiting-side volume × hold days, buy-limit × windows/day × hold days. PLACEHOLDERS.
export const AMP_VOL_SHARE       = 0.10;
// ATTENTION-HAIRCUT (Ben 2026-08-09) — was a bare 6 under a comment claiming to mirror expUnits;
// the 6→2 haircut (2026-08-08) moved expUnits and left this behind. Now shares the ONE home.
export const AMP_WINDOWS_PER_DAY = ACTIONABLE_WINDOWS_PER_DAY;
// Hold horizon. Feeds the family ttf + the §A5 shadow-replay horizon + the deploy-units bounds.
//
// RE-HORIZONED 1 → 4 on 2026-08-09 (PLAN-DIURNAL-TRIAGE DT1). The lane's founding premise — "buy the
// daily TROUGH, sell the daily PEAK, hold ~a day, cycle" — was measured and REFUTED. Over 92 items ≥5m
// and 4,881 item-days, running the production amplitudeRanges/amplitudeGate: entry (the trough bid gets
// touched) fires 56.9% of the time, but **completion within 24h GIVEN entry is 4.8%** — ≤48h 11.4%,
// ≤96h 22.6%, ≤7d 34.6%, with median completion when it happens at all around 69h ≈ 3 days. The two-leg
// independence assumption behind the old `pFill2leg` is measured FALSE: trough-touch entry is adverse
// selection (unconditional ask-reach ≤48h is 43.1% vs 11.4% conditional on entry, a ~4× haircut), and
// rows predicted ≥0.25 realized ~5%. EV per entered cycle came out at −813k (48h mark-to-mid, untaxed),
// with a +48h strand mark of −643k across 2,114 strandings.
//
// The lane is MIS-HORIZONED, not signal-free — which is why this is a re-horizon rather than a deletion.
// Completion climbs 4.8% → 22.6% → 34.6% across 24h → 96h → 7d, and the survivors are exactly the
// repeatable multi-DAY oscillator class the standing `multi-week-oscillator-class` note describes:
// Masori chaps completes 12.9% at 24h but **71% at 7d**; the fang's period is ~6–8d. Saturated heart, by
// contrast, completed 0% at 96h and 5% at 7d while its row advertised +5.88m/cycle — the kind of row the
// new per-row completion column now makes self-indicting.
//
// 4 rather than 7 is a sample trade-off, not a measured period: at AMP_NIGHTS = 14 a 4-day horizon leaves
// ~9–10 judgeable entry days per row for cycleCompletion, where 7 leaves ~6 and halves an already thin n.
// `--hold-days 7` remains available. STILL A PLACEHOLDER (n≈0 per item) — now a measured-DIRECTION one.
// Honesty limits: one ~73-day archive era, one update cycle; completion measured from hourly avgLow/avgHigh
// aggregates, NOT executed fills, so every rate here is an UPPER BOUND on a real round trip; item-day
// clustering ⇒ effective n well below nominal.
export const AMP_HOLD_DAYS_DEFAULT = 4;

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
    const pad2 = n => String(n).padStart(2, '0');
    const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const rec = byDay.get(key) || { min: Infinity, max: -Infinity };
    if (p.mid < rec.min) rec.min = p.mid;
    if (p.mid > rec.max) rec.max = p.mid;
    byDay.set(key, rec);
  }
  // chronological. The key MUST be zero-padded (YYYY-MM-DD): unpadded `YYYY-M-D` is NOT lexically
  // monotone — "2026-8-14" < "2026-8-4" and "2026-10-11" < "2026-9-30" — so slice(-recentDays) silently
  // returned the SINGLE-DIGIT days (stale by up to a week for ~2/3 of every month, and never a new
  // month's days while the old month's remained). Fixed 2026-08-08; matches windowStats' dayKey pad2.
  const keys = [...byDay.keys()].sort();
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

/* cycleCompletion(days, { bid, ask, horizonDays }) → { entries, judged, completed, pending, frac }
   DT1 (PLAN-DIURNAL-TRIAGE, 2026-08-09) — built as the ordered replacement for the deleted `pFill2leg`,
   then REJECTED the same day as CIRCULAR and superseded by `ampWalkForward` (DT1b). It is neither shown
   nor ranked on; read the ⚠ block below before using it for anything.

   The question this answers is the lane's make-or-break one and the old estimator could not represent it:
   once the trough bid actually fills, does the peak ask get reached WITHIN the hold horizon? `pFill2leg`
   multiplied two marginal leg rates, which assumes independence — measured FALSE (trough-touch entry is
   adverse selection: unconditional ask-reach ≤48h 43.1% vs 11.4% conditional on entry). So this counts
   the ordered event directly over the in-hand day window instead of inferring it.

   `days` — a windowStats `.days` array of [key, {low, hi}] in CHRONOLOGICAL order.
   An ENTRY is a day whose `low <= bid`. It COMPLETES if some day STRICTLY LATER, within `horizonDays`,
   has `hi >= ask`. An entry whose horizon runs past the end of the window without completing is PENDING
   and is EXCLUDED from the denominator — never scored as a miss (mirrors join-amplitude-outcomes.mjs's
   `pending` contract; counting it would manufacture failure at the window edge).

   SAME-DAY completion is deliberately NOT counted. Day buckets cannot prove the low preceded the high
   within a day, and counting it would silently re-import the ordering assumption this function exists to
   remove. That makes `frac` CONSERVATIVE for genuinely intraday items — stated, not hidden.

   ⚠ CIRCULAR BY CONSTRUCTION — DISPLAY-ONLY, NEVER A RANK INPUT. `bid`/`ask` as passed by
   amplitudeRanges are the MEDIAN low/high OF THE SAME DAYS scored here, so ~50% of those days clear the
   ask BY DEFINITION and over an H-day horizon P(some later day clears) ≈ 1−0.5^H ≈ 94% at H=4. That is a
   tautology, not a measurement. Confirmed on the live board the day it was built: 18 of 19 (5/5, 6/7,
   7/7), including Saturated heart at 5/5 — an item whose real out-of-sample rate is 0 of 41 within 96h.
   The DT1 study avoided this by fitting levels strictly BEFORE each origin day and scoring at hour grain;
   re-running that design reproduces its numbers exactly. Do NOT read this as a round-trip completion
   rate, and do NOT wire it into pFillAmplitude (see that function's header). What it honestly answers is
   the weaker "after an entry day, does this ask still print at all in-window?" — `0/N` is damning, a high
   figure near-uninformative. The real per-item estimator is `ampWalkForward` below (DT1b), which is what
   the board shows and ranks on; this survives only in the shadow log, for continuity with rows logged
   between DT1 and DT1b. It is NOT displayed — printing ~95% beside the walk-forward's ~6% for the same
   item would invite reading the flattering one. Do not put it back on a surface.

   `frac` is null when `judged === 0` (no scoreable entry ⇒ no claim). n is small by construction
   (~9–10 judged at AMP_NIGHTS=14 and a 4-day horizon), so `judged` is returned and printed alongside it.
   NEVER call this calibrated: a descriptive in-window rate on hourly aggregates (a FILL PROXY, not
   executed fills), bounding a real round trip from ABOVE, and saturated on top of that. */
export function cycleCompletion(days, { bid = null, ask = null, horizonDays = AMP_HOLD_DAYS_DEFAULT } = {}) {
  if (!Array.isArray(days) || bid == null || ask == null) return null;
  const H = Math.max(1, Math.floor(horizonDays));
  let entries = 0, judged = 0, completed = 0, pending = 0;
  for (let i = 0; i < days.length; i++) {
    const d = days[i] && days[i][1];
    if (!d || d.low == null || d.low > bid) continue;      // not an entry day
    entries++;
    const last = Math.min(days.length - 1, i + H);
    let done = false;
    for (let j = i + 1; j <= last; j++) {                  // strictly later — same-day never counts
      const n = days[j] && days[j][1];
      if (n && n.hi != null && n.hi >= ask) { done = true; break; }
    }
    if (done) { completed++; judged++; continue; }
    // no completion found: only a FULL horizon inside the window is a judged miss.
    if (i + H <= days.length - 1) judged++;
    else pending++;
  }
  return { entries, judged, completed, pending, frac: judged ? completed / judged : null };
}

/* --- DT1b: the WALK-FORWARD per-item round-trip rate ---------------------------------------------
   ampWalkForward(series1h, { horizonDays, askQ, bidQ, nights, fitDays, warmupDays }) →
     { origins, entries, judged, completed, pending, frac, horizonDays, askQ, bidQ } | null

   THIS is the honest answer to "once the trough bid fills, does the peak ask get reached inside the
   hold horizon?" — the question `pFill2leg` got wrong by multiplying marginals and `cycleCompletion`
   got wrong by fitting its levels to the very days it scored. Read both of those headers before
   touching this; they are the two failure modes this function is shaped to avoid.

   THE TWO PROPERTIES THAT MAKE IT VALID, neither of which is optional:
   1. LEVELS ARE FITTED STRICTLY PRE-ORIGIN. For each origin day T the bid/ask come from
      `amplitudeRanges` over the `fitDays` window ENDING AT LOCAL MIDNIGHT OF T — never including T or
      anything after it. That is the entire difference between this and the circular in-sample figure:
      the levels cannot have been chosen with knowledge of the day being scored.
   2. ENTRY AND COMPLETION ARE SCORED AT HOUR GRAIN. Entry is the FIRST hour of T whose 1h avgLow
      touches the bid (a resting trough bid filling); completion is any LATER hour, within
      horizonDays, whose avgHigh reaches the ask. Day buckets cannot express "the low preceded the
      high", which is why `cycleCompletion` had to refuse same-day completions entirely and this does
      not have to.

   PENDING is excluded from the denominator (the join-amplitude-outcomes contract): an entry whose
   horizon runs past the end of the series is unresolved, not a miss. `judged = completed + missed`.

   VALIDATION. This is the design of the DT1 study (PLAN-DIURNAL-TRIAGE), which re-runs and reproduces
   its published figures exactly — Saturated heart 0.0% @96h (n=41), Masori chaps 12.9% @24h (n=31);
   harness `pipeline/experiments/amp-cycle-reproduction.mjs`. It discriminates strongly across live
   items (0% / 24% / 42% / 48% @96h on Saturated heart / Virtus / Masori chaps / Fury — the PRE-BUILD
   validation run, not the shipped board), which is the property the saturated in-sample figure lacked.
   The shipped DT1b board is a separate set; CHANGELOG 0.71.6 is its one home.

   HONESTY LIMITS — carry them, they are not boilerplate. The touch proxies are 1h avgLow/avgHigh
   AGGREGATES, not executed fills: no queue position, no partial fills, no competition for the same
   level, so every rate here is an UPPER BOUND on what a real offer would achieve. Origin days overlap
   in their fit windows, so effective n is well below `judged`. One 73-day archive era, one update
   cycle. `frac` is a DESCRIPTIVE historical rate for this item under this strategy, not a forecast.

   Returns null when the series is too short to yield any scoreable origin — an honest absence that
   callers must degrade to the prior on, never coerce to 0. */
export const AMP_WF_FIT_DAYS    = 20;   // lookback the pre-origin levels are fitted over
export const AMP_WF_WARMUP_DAYS = 15;   // origin days before this many days of history are skipped
export const AMP_WF_MIN_HOURS   = 12;   // an origin day needs this many logged low AND high hours to score
// Below this many judged entries the rate is too thin to rank on and callers fall back to the prior.
// 10 is a judgment floor, not a power calculation: at ~58 origin days a healthy item judges 30–48, so
// this only excludes genuinely cold/illiquid items — exactly the ones whose 1h series is sparse anyway.
export const AMP_WF_MIN_JUDGED  = 10;

export function ampWalkForward(series1h, {
  horizonDays = AMP_HOLD_DAYS_DEFAULT, askQ = AMP_ASK_Q, bidQ = AMP_BID_Q,
  nights = 14, fitDays = AMP_WF_FIT_DAYS, warmupDays = AMP_WF_WARMUP_DAYS,
} = {}) {
  if (!Array.isArray(series1h) || series1h.length < 24 * (warmupDays + 1)) return null;
  const pts = series1h.filter(p => p && typeof p.timestamp === 'number').sort((a, b) => a.timestamp - b.timestamp);
  if (!pts.length) return null;
  const lastTs = pts[pts.length - 1].timestamp;
  const horizonSec = Math.max(1, Math.floor(horizonDays)) * 86400;

  // LOCAL day buckets (repo convention — every day boundary in this codebase is local wall-clock;
  // windowStats' own dayKey is local too, so the fit window and the origin day agree by construction).
  const days = new Map();
  for (const p of pts) {
    const d = new Date(p.timestamp * 1000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let e = days.get(key);
    if (!e) { e = { hours: [], nLow: 0, nHi: 0 }; days.set(key, e); }
    e.hours.push(p);
    if (p.avgLowPrice != null) e.nLow++;
    if (p.avgHighPrice != null) e.nHi++;
  }
  const keys = [...days.keys()].sort();
  const midnightOf = key => { const [y, m, d] = key.split('-').map(Number); return Math.floor(new Date(y, m - 1, d).getTime() / 1000); };

  let origins = 0, entries = 0, judged = 0, completed = 0, pending = 0;
  for (let di = warmupDays; di < keys.length; di++) {
    const T = keys[di], eT = days.get(T);
    if (!eT || eT.nLow < AMP_WF_MIN_HOURS || eT.nHi < AMP_WF_MIN_HOURS) continue;   // a half-logged day can't be scored
    const cut = midnightOf(T);
    const fit = pts.filter(p => p.timestamp < cut && p.timestamp >= cut - fitDays * 86400);
    // `now: cut` pins windowStats' today-exclusion to the origin, not the wall clock — so this function
    // is deterministic and a fixture doesn't rot. (Nothing at/after `cut` is in `fit` anyway.)
    const stats = windowStats(fit, { nights, wStart: 0, wEnd: 0, now: new Date(cut * 1000) });
    if (!stats) continue;
    // SAME level derivation as the live board — not a re-implementation — so the measured rate belongs
    // to the levels the row actually quotes. holdDays is irrelevant here (it feeds cycleCompletion only;
    // ampBid/ampAsk depend solely on bidQ/askQ), but pass it for shape parity.
    const ar = amplitudeRanges(stats, null, { holdDays: horizonDays, askQ, bidQ });
    if (!ar || !ar.hasData || ar.ampBid == null || ar.ampAsk == null) continue;
    origins++;

    let entryTs = null;
    for (const p of eT.hours) {                                   // eT.hours is already chronological
      if (p.avgLowPrice != null && p.avgLowPrice <= ar.ampBid) { entryTs = p.timestamp; break; }
    }
    if (entryTs == null) continue;                                // the bid never filled on T
    entries++;

    let done = false;
    for (const p of pts) {
      if (p.timestamp <= entryTs) continue;                       // STRICTLY later than the fill
      if (p.timestamp > entryTs + horizonSec) break;
      if (p.avgHighPrice != null && p.avgHighPrice >= ar.ampAsk) { done = true; break; }
    }
    if (done) { completed++; judged++; }
    else if (entryTs + horizonSec <= lastTs) judged++;             // a FULL horizon elapsed → a real miss
    else pending++;                                                // horizon runs past the data → unresolved
  }
  if (!origins) return null;
  return {
    origins, entries, judged, completed, pending,
    frac: judged ? completed / judged : null,
    horizonDays, askQ, bidQ,
  };
}

/* --- Stage 2: the exact per-day amplitude SHAPE off a windowStats result --------------------------
   stats — a js/windowread.mjs windowStats(series1h, { wStart:0, wEnd:0 }) result (its .days carry
           per-day {low, hi}; .lows/.his are the ascending quantile arrays).
   live  — the current live price (the instasell post-fetch), for a proximity note (optional).
   opts  — { holdDays } feeds the family ttf + the shadow-replay horizon.
           { askQ, bidQ } (PLAN-OSCILLATION-CYCLE F-E) are the reach-vs-margin DIAL — the daily
           high/low quantiles the peak-ask / trough-bid quote from. They DEFAULT to the module
           constants AMP_ASK_Q / AMP_BID_Q (0.5 / 0.5 = the median peak/trough, Ben's KEPT default
           board — an absent caller is byte-identical to pre-F-E). ⚠ DIRECTION: askQ/bidQ are REACH
           FRACTIONS, not price percentiles — `quantHigh(his, p) = his[n − ceil(p·n)]`, so a HIGHER askQ
           quotes a LOWER, MORE-reachable ask. To quote a better-but-less-reachable sell you want a
           LOWER askQ (e.g. 0.25): a strictly HIGHER ampAsk, a LOWER reach and a HIGHER ampPct. (The
           F-E plan row illustrated this backwards as "0.75 → higher ampAsk"; the test at
           amplitudescreen.test.mjs pins `easy.ampAsk < base.ampAsk` against exactly that inversion.)
   Returns the amplitude SHAPE features (incl. the effective askQ/bidQ, so a shadow-log can record
   WHICH quantiles a row was quoted at — an experiment run is then ledger-distinguishable), or
   { hasData:false }. */
export function amplitudeRanges(stats, live, { holdDays = AMP_HOLD_DAYS_DEFAULT, recentN = AMP_RECENT_N, askQ = AMP_ASK_Q, bidQ = AMP_BID_Q } = {}) {
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

  const ampBid = quantLow(stats.lows, bidQ);             // trough-bid — touched on ~bidQ of days (default AMP_BID_Q)
  const ampAsk = quantHigh(stats.his, askQ);             // peak-ask   — reached on ~askQ of days (default AMP_ASK_Q)
  const bidTouch = recencySplit(stats.days, 'bid', ampBid, recentN);
  const askReach = recencySplit(stats.days, 'ask', ampAsk, recentN);
  const netPerCycle = (ampBid != null && ampAsk != null) ? afterTax(ampAsk) - ampBid : null;
  const ampPct = (netPerCycle != null && ampBid > 0) ? netPerCycle / ampBid : null;
  // DT1 (2026-08-09): `pFill2leg = bidFrac × askFrac` is DELETED. It was a PRODUCT OF MARGINALS standing
  // in for a joint, and the independence it assumed is measured FALSE — entry is adverse selection, so
  // rows it predicted at ≥0.25 realized ~5%. `cycleCompletion` below measures the ordered round trip
  // directly instead of multiplying two leg rates that don't compose. bidTouch/askReach SURVIVE, but the
  // DT1 claim that they "still gate leg printability" was measured WRONG on 2026-08-09: at the default
  // quantiles the level is the median of the days being counted, so the test collapses to staleness (see
  // AMP_MIN_FULL_FRAC's header). They remain honest as a DISPLAYED recent-vs-full divergence read.
  const cycle = cycleCompletion(stats.days, { bid: ampBid, ask: ampAsk, horizonDays: holdDays });

  return {
    hasData: true, live: num(live), nDays,
    ampBid, ampAsk, netPerCycle, ampPct, medAmpPct,
    bidTouch, askReach, cycle, holdDays,
    askQ, bidQ,                                          // F-E: the effective reach-vs-margin quantiles this row was quoted at
    liveVsBidPct: (num(live) != null && ampBid > 0) ? (live - ampBid) / ampBid : null,
  };
}

/* amplitudeGate(ar, { trendDominates, knife, oscillating, driftMargin }) → { pass, reason }. Two-sided
   liquidity + the price window are the CALLER's (shared stack, kept); this owns the amplitude-specific gate:
   the daily after-tax amplitude floor, the both-leg reach test (⚠ a STALENESS check at default quantiles,
   not a reachability gate — see AMP_MIN_FULL_FRAC's header), the trend/knife guard
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
  // both-leg daily reach. ⚠ AT THE DEFAULT QUANTILES THIS IS A STALENESS CHECK, NOT A REACHABILITY GATE:
  // the fullFrac disjunct is satisfied by construction (median level vs its own window ⇒ fullFrac ≡ 0.5),
  // so the recentHit branch never binds and legOk ≡ !staleOptimistic — verified identical on 670/670 legs.
  // Full measurement + why it is not silently "fixed" here: AMP_MIN_FULL_FRAC's header. The disjuncts DO
  // bind at non-default --amp-bid-q/--amp-ask-q, so the structure is kept rather than collapsed.
  // NOTE the 'bid-unreachable'/'ask-unreachable' reasons below are therefore MISNAMED on a default run —
  // every such drop is a stale-optimistic drop (the full window reaches a level recent days abandoned).
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
