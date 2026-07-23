// forecast.mjs — the PURE forward 12h/24h price projection (PF1). CONSUMES an `hourProfile` object
// (js/windowread.mjs) and produces a forward diurnal+trend forecast: the projected next trough / next
// peak (level + uncertainty band + eta window) and the answer helper for Ben's canonical ask —
// "blood runes aren't buyable at a profitable price now, but based on the hourly history they should
// be in ~4 hours." NEW module (PF1); node- AND app-importable, like windowread/quotecore.
//
// ── What this claims, and what it deliberately does NOT (the honesty core — read before editing) ──
// OSRS prices carry EXOGENOUS shocks (updates, meta shifts, news) that are FUNDAMENTALLY ABSENT from
// price history — the /scan froth-ignition lesson (the explosive first leg fires out of a flat base
// with NO leading price/volume signal). This model therefore projects EXACTLY TWO things and nothing
// else: (a) the RECURRING DIURNAL SHAPE (hourProfile's de-trended per-hour deviations) and (b) the
// CURRENT MULTI-DAY TREND, dumbly extrapolated. It is a "tomorrow rhymes with the last week" model.
// It CANNOT predict ignitions, crashes, update reactions, or regime changes — and it DEGRADES LOUDLY
// to `{ forecast:null, reason }` when its own premises fail (post-shock phase, live band violation,
// thin series, unreliable quote, trend-erased dip). Every constant is a NAMED PLACEHOLDER pending the
// PF8 backtest; `confidence` is a coarse ORDINAL (high/med/low) from sample coverage + dispersion, NOT
// a probability; nothing gates on this at rollout (inform-only everywhere, like reach/trajectory).
//
// Dependency arrow points ONE way: this imports only windowread.mjs. `phase`/`mom`/`reliable` arrive
// as PLAIN ctx values (quotecore concepts) so forecast never imports the quote engine.
import { projectTrajectory, floorCeilingTrack } from './windowread.mjs';

// ── Named PLACEHOLDER constants (all pending PF8 calibration) ─────────────────────────────────────
export const FC_HORIZON_DEFAULT = 24;   // hours the trough/peak scan covers by default
// @provisional-api: forecast horizon knob a PF2–PF8 console surface (unbuilt) may request for a tighter band; the shipped default is FC_HORIZON_DEFAULT.
export const FC_HORIZON_SHORT   = 12;
export const FC_TREND_ERR_FRAC  = 0.5;  // trend-extrapolation error as a fraction of the moved trend, per hour:
                                        //   the band's horizon-growing term = |trendPerHour|·Δt·this
export const FC_DISP_FALLBACK_FRAC = 0.25; // when an hour has no dispersion sample, fall back to this ×|amplitude|
export const FC_CONF_HIGH_NIGHTS = 10;  // ≥ this many scored nights ⇒ eligible for 'high' confidence
export const FC_CONF_MED_NIGHTS  = 6;   // ≥ this ⇒ 'med'; below ⇒ 'low' (small-sample honesty)
export const FC_DISP_SLOPPY_FRAC = 0.6; // median per-hour IQR ≥ this ×|amplitude| ⇒ the dip/peak prints
                                        //   sloppily → knock confidence one step

const median = arr => { const s = arr.filter(v => v != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const down = c => (c === 'high' ? 'med' : c === 'med' ? 'low' : 'low');

/** fmtEta(etaH) — a terse "~Nh" eta token for the compact console surfaces. null → 'n/a'. */
export function fmtEta(etaH) {
  if (etaH == null) return 'n/a';
  const h = Math.round(etaH);
  return h <= 0 ? 'now' : `~${h}h`;
}
const pad2 = n => String(n).padStart(2, '0');
const fmtWindow = atHours => (atHours ? `${pad2(atHours[0])}:00–${pad2(atHours[1])}:00` : null);

// coverage + dispersion + trend/phase agreement → coarse ordinal. NOT a probability (honesty §4).
function confidenceOf(profile, ctx) {
  let c = profile.nights >= FC_CONF_HIGH_NIGHTS ? 'high'
    : profile.nights >= FC_CONF_MED_NIGHTS ? 'med' : 'low';
  // sloppy dip/peak: the median per-hour IQR is large relative to the intraday amplitude
  const iqrs = (profile.hours || []).flatMap(h => [h.devLowSpread, h.devHiSpread]).filter(v => v != null);
  const medIqr = median(iqrs);
  if (medIqr != null && profile.amplitude && Math.abs(profile.amplitude) > 0
      && medIqr >= FC_DISP_SLOPPY_FRAC * Math.abs(profile.amplitude)) c = down(c);
  if (profile.trendDominates) c = down(c);
  // a non-base phase we DIDN'T outright refuse (e.g. 'basing'/'unknown') caps confidence at med
  if (ctx.phase && ctx.phase !== 'base' && c === 'high') c = 'med';
  // trend-vs-regime sign disagreement (optional ctx.regimeDrift) → knock
  if (ctx.regimeDrift && profile.trendPerDay != null) {
    const rs = ctx.regimeDrift === 'rising' ? 1 : ctx.regimeDrift === 'falling' ? -1 : 0;
    const ts = Math.sign(profile.trendPerDay);
    if (rs && ts && rs !== ts) c = down(c);
  }
  return c;
}

/**
 * diurnalForecast(profile, ctx) — forward projection from an hourProfile.
 * @param {object|null} profile  an hourProfile(series) result (null ⇒ degrade)
 * @param {object} ctx {
 *   liveLo, liveHi,               // live instasell/instabuy — the projection ANCHOR (back out today's baseline)
 *   now = new Date(),             // local wall-clock now (currentHour = now.getHours())
 *   phase,                        // quotecore phase(): 'base'|'basing'|'spike'|'decay'|'unknown' — spike/decay REFUSE
 *   mom,                          // momentum tell: 'breakdown'|'breakup'|… — a live band violation REFUSES
 *   reliable = true,              // quote-row reliability — an unreliable row REFUSES
 *   regimeDrift,                  // optional 'rising'|'falling'|'flat' — a sign clash knocks confidence
 *   horizonH = FC_HORIZON_DEFAULT
 * }
 * @returns {{ forecast: object|null, reason: string|null }}
 *   forecast = { nextTrough, nextPeak, series, baselineNow, trendPerHour, horizonH, nights, confidence }
 *   nextTrough/nextPeak = { level, band:{lo,hi}, etaH, atHours:[startH,endH]|null, window, confidence,
 *                           mode:'diurnal'|'trend-only', note? }
 *   DEGRADE (forecast=null) reasons: no-profile · unreliable-quote · post-shock-shape · band-violation-live
 *                                    · no-anchor · flat-window
 */
export function diurnalForecast(profile, ctx = {}) {
  const nul = reason => ({ forecast: null, reason });
  if (!profile || !profile.hours || !profile.dip || !profile.peak) return nul('no-profile');
  if (ctx.reliable === false) return nul('unreliable-quote');
  // a post-SHOCK shape is not the recurring shape — refuse to project it
  if (ctx.phase === 'spike' || ctx.phase === 'decay') return nul('post-shock-shape');
  // the price is violating its own 2h band RIGHT NOW — the live anchor is untrustworthy
  if (ctx.mom === 'breakdown' || ctx.mom === 'breakup') return nul('band-violation-live');

  const liveMid = (ctx.liveLo != null && ctx.liveHi != null) ? (ctx.liveLo + ctx.liveHi) / 2
    : (ctx.liveLo ?? ctx.liveHi ?? null);
  if (liveMid == null) return nul('no-anchor');

  const now = ctx.now || new Date();
  const curH = now.getHours();
  const horizonH = ctx.horizonH || FC_HORIZON_DEFAULT;
  const hourMap = new Map(profile.hours.map(x => [x.h, x]));
  const curHr = hourMap.get(curH);
  // baselineNow: back out today's day-median from the live mid via the current hour's mid deviation, so
  // the CURRENT-hour projection reproduces ~the live price by construction (the anchor boundary condition).
  const devMidCur = (curHr && curHr.devMid != null) ? curHr.devMid : 0;
  const baselineNow = liveMid - devMidCur;
  const trendPerHour = (profile.trendPerDay != null ? profile.trendPerDay : 0) / 24;
  const fallbackDisp = FC_DISP_FALLBACK_FRAC * Math.abs(profile.amplitude || 0);

  // ── project the hour-indexed series over the horizon; band is cumulative-max ⇒ NEVER shrinks in Δt ──
  const series = [];
  let runHalfLow = 0, runHalfHi = 0;
  for (let dt = 1; dt <= horizonH; dt++) {
    const h = (curH + dt) % 24;
    const hr = hourMap.get(h);
    if (!hr) continue;                                    // no history for this hour → skip
    const projLow = baselineNow + trendPerHour * dt + (hr.devLow ?? 0);
    const projHigh = baselineNow + trendPerHour * dt + (hr.devHi ?? 0);
    const trendErr = Math.abs(trendPerHour) * dt * FC_TREND_ERR_FRAC;   // grows linearly with horizon
    const dispLow = (hr.devLowSpread != null ? hr.devLowSpread : fallbackDisp) / 2 + trendErr;
    const dispHi = (hr.devHiSpread != null ? hr.devHiSpread : fallbackDisp) / 2 + trendErr;
    runHalfLow = Math.max(runHalfLow, dispLow);           // monotone: the band never narrows looking further out
    runHalfHi = Math.max(runHalfHi, dispHi);
    series.push({
      etaH: dt, h, projLow, projHigh,
      lowBand: { lo: projLow - runHalfLow, hi: projLow + runHalfLow },
      hiBand: { lo: projHigh - runHalfHi, hi: projHigh + runHalfHi },
    });
  }
  if (!series.length) return nul('no-profile');

  const confidence = confidenceOf(profile, ctx);

  // ── next trough (bid side) ────────────────────────────────────────────────────────────────────
  // trend-dominates on the DIP side (rising floor erases the intraday dip — the Ghrazi lesson): withdraw
  // the diurnal claim, price the floor to live+trend, drop the eta. trendPerDay>0 ⇒ dip erased.
  const dipWindow = [profile.dip.startH, profile.dip.endH];
  const peakWindow = [profile.peak.startH, profile.peak.endH];
  let nextTrough;
  if (profile.trendDominates && trendPerHour > 0) {
    const last = series[series.length - 1];
    nextTrough = {
      level: (ctx.liveLo ?? baselineNow) + trendPerHour * horizonH, mode: 'trend-only',
      band: last.lowBand, etaH: null, atHours: null, window: null, confidence: down(confidence),
      note: 'trend-dominates — the rising floor erases the intraday dip; floor priced to live+trend, no dip eta',
    };
  } else {
    const t = series.reduce((a, b) => (b.projLow < a.projLow ? b : a));
    nextTrough = {
      level: t.projLow, band: t.lowBand, etaH: t.etaH, atHours: dipWindow,
      window: fmtWindow(dipWindow), confidence, mode: 'diurnal',
    };
    if (profile.trendDominates) nextTrough.note = 'trend-dominates — dip is below live but the rising floor may starve a resting bid';
  }

  // ── next peak (ask side) — mirror; a FALLING ceiling (trendPerDay<0) erases the peak ─────────────
  let nextPeak;
  if (profile.trendDominates && trendPerHour < 0) {
    const last = series[series.length - 1];
    nextPeak = {
      level: (ctx.liveHi ?? baselineNow) + trendPerHour * horizonH, mode: 'trend-only',
      band: last.hiBand, etaH: null, atHours: null, window: null, confidence: down(confidence),
      note: 'trend-dominates — the falling ceiling erases the intraday peak; peak priced to live+trend, no eta',
    };
  } else {
    const p = series.reduce((a, b) => (b.projHigh > a.projHigh ? b : a));
    nextPeak = {
      level: p.projHigh, band: p.hiBand, etaH: p.etaH, atHours: peakWindow,
      window: fmtWindow(peakWindow), confidence, mode: 'diurnal',
    };
  }

  // degenerate flat window: the peak isn't above the trough (thin/flat series)
  if (nextTrough.level != null && nextPeak.level != null && nextPeak.level <= nextTrough.level
      && nextTrough.mode === 'diurnal' && nextPeak.mode === 'diurnal') return nul('flat-window');

  return {
    forecast: { nextTrough, nextPeak, series, baselineNow, trendPerHour, horizonH, nights: profile.nights, confidence },
    reason: null,
  };
}

// ── the canonical-ask helpers ────────────────────────────────────────────────────────────────────
// accept either the diurnalForecast wrapper ({forecast,reason}) or a bare forecast object.
const inner = fc => (fc && fc.forecast !== undefined ? fc.forecast : fc);

/**
 * whenBuyable(fc, targetBid) — the first horizon hour whose PROJECTED LOW is at/under the target bid.
 * The honest answer to "not buyable at a profitable price now — when should it be?". Returns
 * { etaH, atHours:[startH,endH], window, projLevel, band } | null (null = "not within the horizon on
 * this model" — itself a useful answer). Scans the central projected low (the median dip), band exposed
 * so the caller sees the uncertainty. NOT a fill guarantee (touched ≠ filled — the standing caveat).
 */
// CONSUMED by pipeline/commands/quote-items.mjs (#6, Ben 2026-07-15) — the inform-only "not profitably
// buyable now → buyable ~Xh" line off the in-hand hourProfile (the module's motivating ask, resolved).
export function whenBuyable(fc, targetBid) {
  const f = inner(fc);
  if (!f || !f.series || targetBid == null) return null;
  for (const s of f.series) {
    if (s.projLow <= targetBid) {
      return { etaH: s.etaH, atHours: [s.h, (s.h + 1) % 24], window: `${pad2(s.h)}:00`, projLevel: s.projLow, band: s.lowBand };
    }
  }
  return null;
}

/**
 * whenSellable(fc, targetAsk) — mirror: the first horizon hour whose PROJECTED HIGH is at/above the
 * target ask (held-position sell timing). Returns the same shape | null.
 */
// CONSUMED by pipeline/commands/quote-items.mjs (#6, Ben 2026-07-15) — the sell-side twin: on a HELD lot
// (heldIds), "not sellable at your target ask now → sellable ~Xh" off the same in-hand hourProfile as
// whenBuyable (zero extra fetch). Pinned by pipeline/test/forecast.test.mjs (whenSellable + unreachable→null).
export function whenSellable(fc, targetAsk) {
  const f = inner(fc);
  if (!f || !f.series || targetAsk == null) return null;
  for (const s of f.series) {
    if (s.projHigh >= targetAsk) {
      return { etaH: s.etaH, atHours: [s.h, (s.h + 1) % 24], window: `${pad2(s.h)}:00`, projLevel: s.projHigh, band: s.hiBand };
    }
  }
  return null;
}

// ── PLAN-OSCILLATION-CYCLE Chunk 1 — the exit-projection primitive (INFORM-ONLY, NO gate) ─────────
// The multi-week oscillator lane (fang/blowpipe: a ~6–8-day ~10% swing riding a slowly drifting floor/
// ceiling) needs the peak/trough it will SELL/BUY into projected over a MULTI-DAY hold, shifted by the
// multi-week drift. This module homes that projection here (NOT windowread.mjs — the forecast→windowread
// arrow is one-way; this file already only imports downward). Two pieces, both n≈0 inform-only:
//   (1) driftAdjustedExit  — composes diurnalForecast's next trough/peak with a multi-week slope number.
//   (2) oscillationVsKnife — the drift-aware detector that tells an oscillating-while-drifting item
//       (harvestable) from a monotone knife (no cycle to harvest).
// The CORRECTED-MECHANISM ruling (PLAN §"corrected mechanism"): drift is consumed as a NUMBER, never a
// direction LABEL. driftAdjustedExit returns levels + a confidence and DELIBERATELY exposes NO phase
// field and NO rising/falling classification — direction is only ever an intermediate of the arithmetic
// (the sign of `slope`), so nothing downstream can gate on a direction. Chunk 1 gates on nothing at all.
//
// ── THE LOAD-BEARING FINDING (PLAN "CRITICAL FIRST STEP") ────────────────────────────────────────
// diurnalForecast ALREADY places nextPeak.level / nextTrough.level on a TREND-EXTRAPOLATED line:
//   projHigh = baselineNow + trendPerHour·dt + devHi,  trendPerHour = profile.trendPerDay / 24
// so the drift over [now → the peak/trough eta] is ALREADY baked in (via the hourProfile's OWN fitted
// multi-day slope). It is NOT applied twice here. What diurnalForecast does NOT do: extend that drift
// PAST the next-peak eta out to a multi-DAY hold horizon (its horizon is ≤24h and it uses trendPerDay,
// not the ceiling-track slope). So driftAdjustedExit shifts ONLY by the RESIDUAL horizon
// max(0, holdHorizonDays − etaDays) — the portion diurnalForecast did not already cover. This is what
// makes Chunk 1 thin: the near-term adjustment was already done for us; we add the multi-day tail only.

// hold-horizon-to-slope multiplier — the number of DAYS of ceiling/floor drift applied to the diurnal
// projection BEYOND the next peak/trough eta. n≈0 PLACEHOLDER (the fang cycle is ~6–8d; a same-cycle
// daily flip holds ~1–1.5d — the amplitude lane's AMP_HOLD_DAYS default). NOT validated; F1 owns it.
//
// F-C (PLAN-OSCILLATION-CYCLE post-landing follow-up, 2026-07-22): this is the AMPLITUDE lane's OWN
// hold horizon — `renderAmplitudeMode` passes its real `AMP_HOLD_DAYS` explicitly and never relies on
// this default. Every OTHER `driftExitFrom` caller that KNOWS its thesis's real hold now passes its own
// `holdHorizonDays` too (band/churn/scalp → `DRIFT_INTRADAY_HOLD_DAYS`, value → `DRIFT_VALUE_HOLD_DAYS`,
// both in js/flip-niches.mjs, wired at their `driftInform.holdDays` registry field). This INCLUDES the
// two per-item estimator surfaces (PLAN-ESTIMATOR-HONEST-SELL follow-up, 2026-07-22): `quote-items.mjs`
// quotes every row against FLIP_NICHES.band so it passes band's ~2h `holdDays`, and `read-window-range.mjs`
// passes the `--niche` it computes the fold against — over a ~2h horizon the multi-week drift is negligible,
// so the forward "list at X" ≈ the projected diurnal peak (the honest same-session flip exit; the old 1.5d
// default OVERSTATED it by adding ~1.5 days of ceiling drift to a band flip). This constant remains the
// GENERIC FALLBACK for callers with NO per-niche FLIP context at the call site: the standalone TRAJECTORY
// drift-adj-exit note (the `⇅ floor/ceiling` line — quote-items.mjs's + read-window-range.mjs's bare
// `driftExitFrom(prof, days, ctx)`, deliberately a multi-day oscillation/drift read, NOT the flip exit), the
// non-`--cycle` render path in watch-positions.mjs, and js/trends.js's `renderForecast` — an item there may
// belong to any thesis or none, so this is an honest, clearly-surfaced default rather than a guess. The two
// horizons can legitimately co-render on one item (a ~2h flip-exit "list at X" beside a ~1.5d trajectory
// drift note) because they answer different questions, and the rendered clause always shows the ACTUAL
// `holdHorizonDays` used via `fmtHoldHorizon` (`formatFloorCeiling` in js/windowread.mjs) — nothing is
// silently mis-scaled: a reader always sees which horizon produced each number. The
// `watch-positions.mjs --cycle` loop (PLAN-OSCILLATION-CYCLE Chunk 4) is DELIBERATELY left on this
// default too — it is specifically the multi-week oscillator/amplitude cycle-watch feature, not a
// generic per-position note, so the amplitude-shaped horizon is the CORRECT one there, not a gap.
export const OSC_HOLD_HORIZON_DAYS = 1.5;
// oscillation-vs-knife detector thresholds (n≈0 PLACEHOLDERS, pending F1):
export const OSC_MIN_DAYS = 5;            // fewer completed daily mids than this ⇒ null (can't read a cycle)
// PLAN-OSCILLATION-CYCLE F-H (2026-07-22) — the DETECTOR's OWN trailing lookback, DECOUPLED from the
// amplitude GATE's AMP_NIGHTS (=14) window. WHY: `oscillationVsKnife` needs ≥1.5 cycles / ≥3 real legs
// of history to fire OSCILLATING; at a ~6–8d cycle that is ~9–12 trailing days, so a 14-night window
// sits right at the transition edge and can read a false KNIFE on a real oscillator on its shorter
// slices (the F-A walk-forward finding: KNIFE on ≤~9–10 trailing days, OSC once enough accumulate).
// Feeding the detector a SEPARATE, LONGER trailing window buys it that history WITHOUT widening the
// gate's daily-range/reach/recency reads (AMP_NIGHTS + RECENT_NIGHTS stay a deliberately separate,
// working SIGNAL-RECENCY concern — do NOT conflate the two by bumping AMP_NIGHTS).
// HONESTY CEILING (rule 4): the wiki `/timeseries?timestep=1h` endpoint returns only ~16 calendar days
// in practice, so on the in-hand 1h series this value EFFECTIVELY CAPS near ~15 completed days no matter
// how high it is set — `windowStats` simply returns all available days when `nights` exceeds the series
// depth. This is a SAMPLE-SIZE fix bounded by the endpoint, NOT a calibration. (Sourcing a deeper series
// from pipeline/lib/archive.mjs would be a larger optional follow-up — only worth it if the in-hand
// series genuinely cannot reach this depth; NOT built here.) Must be > AMP_NIGHTS to actually decouple.
export const OSC_DETECTOR_NIGHTS = 21;    // detector's own trailing window (> AMP_NIGHTS=14; endpoint-capped ~15d)
// PLAN-OSCILLATION-CYCLE F-A (2026-07-22) — the detector was REDESIGNED; the old OSC_FLIP_FRAC
// first-difference metric is RETIRED (see the header comment above oscillationVsKnife for the full
// finding). Replacement thresholds:
export const OSC_MIN_LEG_DAYS = 2;        // a same-direction detrended run shorter than this (days) is a
                                           // one-day blip, not a real leg of a cycle — dropped before counting.
export const OSC_AMP_NOISE_MULT = 1.5;    // a leg's detrended peak-to-trough amplitude must clear this × the
                                           // series' own day-to-day noise floor to count as a REAL leg (vs jitter).
export const OSC_MIN_LEGS = 3;            // fewer than this many REAL legs ⇒ knife. Load-bearing: a genuinely
                                           // monotone (even ACCELERATING/decelerating, i.e. curved) series
                                           // detrended by a SINGLE straight line always produces exactly one
                                           // hump in the residuals (one up-leg + one down-leg — 2 legs) purely
                                           // as a linear-fit artifact, NOT a real cycle. Requiring ≥3 real legs
                                           // (≥2 direction reversals) is what separates that artifact from an
                                           // actual multi-leg oscillation (fang/blowpipe's alternating runs).

/**
 * driftAdjustedExit(fc, opts) — compose diurnalForecast's next trough/peak with a multi-week drift NUMBER.
 * @param {object} fc            a diurnalForecast() wrapper ({forecast,reason}) OR a bare forecast object
 * @param {object} opts {
 *   ceilingSlope,               // the CEILING-track slope (gp/DAY, magnitude+SIGN) the caller already computed
 *                               //   — floorCeilingTrack(...).ceiling.slope or termStructure.recentTrend. NO refetch.
 *   floorSlope,                 // the FLOOR-track slope (gp/day) — floorCeilingTrack(...).floor.slope
 *   holdHorizonDays = OSC_HOLD_HORIZON_DAYS
 * }
 * @returns {null | { driftAdjustedTrough, driftAdjustedPeak, confidence, holdHorizonDays, ceilingSlope, floorSlope,
 *                    naivePeak, naiveTrough }}
 *   NO phase / NO direction field — direction is only the sign of the slope, never a returned label (PLAN ruling).
 *   Slope null on a side ⇒ that side passes diurnalForecast's level through UNSHIFTED (degrade, not a fake number).
 *   PURE: does NOT mutate `fc` — the un-adjusted forecast is byte-identical after this call (wrapping changes nothing).
 */
export function driftAdjustedExit(fc, { ceilingSlope = null, floorSlope = null, holdHorizonDays = OSC_HOLD_HORIZON_DAYS } = {}) {
  const f = inner(fc);
  if (!f || !f.nextPeak || !f.nextTrough) return null;
  const naivePeak = f.nextPeak.level;
  const naiveTrough = f.nextTrough.level;
  // diurnalForecast already trend-extrapolated each level to its OWN eta (see the finding above) — so the
  // drift we ADD is only the RESIDUAL horizon past that eta. Direction-agnostic: `slope` may be ±; the SAME
  // `level + slope·residDays` line produces below-naive for a down-drift and above-naive for an up-drift.
  const residDays = etaH => Math.max(0, holdHorizonDays - (etaH != null ? etaH / 24 : 0));
  const driftAdjustedPeak = (naivePeak != null && ceilingSlope != null)
    ? naivePeak + ceilingSlope * residDays(f.nextPeak.etaH) : naivePeak;
  const driftAdjustedTrough = (naiveTrough != null && floorSlope != null)
    ? naiveTrough + floorSlope * residDays(f.nextTrough.etaH) : naiveTrough;
  // confidence: the diurnal projection's own coarse ordinal, knocked one step when we applied a drift shift
  // we cannot yet validate (honesty §4 — a projected multi-day drift is softer than the intraday shape).
  const base = f.confidence ?? f.nextPeak.confidence ?? 'low';
  const shifted = (ceilingSlope != null && ceilingSlope !== 0) || (floorSlope != null && floorSlope !== 0);
  const confidence = shifted ? down(base) : base;
  return { driftAdjustedTrough, driftAdjustedPeak, confidence, holdHorizonDays, ceilingSlope, floorSlope, naivePeak, naiveTrough };
}

/**
 * driftExitFrom(profile, days, ctx, opts) — the ONE slope-sourcing + drift-adjusted-exit COMPOSITION.
 * PLAN-OSCILLATION-CYCLE Chunk 2 established this caller pattern; Chunk 6 (per-thesis integration) REUSES
 * it rather than forking the three steps (one-home discipline — the amplitude lane is the FIRST caller).
 * Steps, all off data ALREADY in the caller's hand (NO fetch): (1) source the CEILING-track and FLOOR-track
 * slopes from floorCeilingTrack(days) — the same daily windowStats().days series the caller already built;
 * (2) build the diurnalForecast wrapper from the in-hand hourProfile; (3) call driftAdjustedExit with those
 * slopes. PURE and TAX-FREE: forecast.mjs deliberately never imports the quote engine, so the after-tax
 * MARGIN (afterTax(peak) − entry − requiredMargin) stays the caller's concern (js/amplitudescreen.mjs
 * amplitudeDriftMargin for the amplitude lane). Direction-agnostic: the slope reaches driftAdjustedExit as a
 * signed NUMBER — there is no branch on its sign here or downstream.
 * @param {object|null} profile   an hourProfile(series) result (→ diurnalForecast). null ⇒ degrade → null.
 * @param {Array|null} days       a windowStats().days series [[key,{low,hi}],…] (→ floorCeilingTrack slopes).
 *                                Below FC_MIN_DAYS completed days floorCeilingTrack returns null ⇒ slopes null
 *                                ⇒ driftAdjustedExit passes the naive levels through UNSHIFTED (honest degrade).
 * @param {object} ctx            diurnalForecast ctx ({liveLo, liveHi, phase, mom, reliable, now, …}).
 * @param {object} opts { holdHorizonDays } — forwarded to driftAdjustedExit (slopes are sourced HERE).
 * @returns {null | driftAdjustedExit-result}  null when diurnalForecast degrades (no nextPeak/nextTrough).
 */
export function driftExitFrom(profile, days, ctx = {}, { holdHorizonDays } = {}) {
  const fc = diurnalForecast(profile, ctx);
  const fct = floorCeilingTrack(days);
  const ceilingSlope = fct && fct.ceiling && fct.ceiling.slope != null ? fct.ceiling.slope : null;
  const floorSlope = fct && fct.floor && fct.floor.slope != null ? fct.floor.slope : null;
  const opts = { ceilingSlope, floorSlope };
  if (holdHorizonDays != null) opts.holdHorizonDays = holdHorizonDays;
  return driftAdjustedExit(fc, opts);
}

/**
 * oscillationVsKnife(days, opts) — the drift-aware oscillation-vs-knife detector (PLAN Chunk 1 sub-piece;
 * REDESIGNED at F-A, 2026-07-22 — see below for why).
 *
 * ── F-A: the ORIGINAL metric was structurally miscalibrated for its OWN target class ──────────────
 * The original version detrended the daily mids (via the shared projectTrajectory slope) and counted
 * SIGN-FLIPS IN THE FIRST DIFFERENCE of the residuals — i.e. how often day-to-day direction reverses.
 * That measures day-to-day NOISINESS, not harvestable multi-day oscillation. A clean slow oscillation
 * (fang/blowpipe's real shape: smooth ~4-day up-runs alternating with ~4-day down-runs riding a slow
 * decline) has very FEW day-to-day reversals — maybe 2 across a 14-day window — so its flip-fraction
 * was LOW and it was labeled a false KNIFE, including through its profitable up-legs (walk-forward:
 * blowpipe KNIFE 10/10 days, fang KNIFE 9/10 days). Meanwhile a merely JITTERY item (noisy day-to-day,
 * no real cycle) flips sign constantly and scored HIGH → OSCILLATING. The metric had the discriminant
 * backwards for its stated purpose.
 *
 * ── The fix: detrended EXCURSION over legs, not first-difference sign density ──────────────────────
 * Still detrends via the SAME shared projectTrajectory slope (one-home — no second trend fit). Then,
 * instead of counting day-to-day flips, it walks the residual series into maximal same-direction RUNS
 * ("legs") and asks whether the series makes REAL excursions to BOTH sides of the trend line over the
 * window: a leg only counts as real when it (a) spans ≥ OSC_MIN_LEG_DAYS days (filters a one-day blip)
 * and (b) its peak-to-trough amplitude clears OSC_AMP_NOISE_MULT × the series' own day-to-day noise
 * floor (the median absolute residual step — filters legs that are themselves just noise). This
 * rewards fang/blowpipe's long alternating runs (few, but real+large legs) instead of penalizing them.
 *
 * A genuinely MONOTONE series (even a CURVED one — accelerating or decelerating, never straight) will
 * still generically produce exactly ONE hump when detrended by a single straight line (an unavoidable
 * linear-fit artifact: one up-leg then one down-leg, or vice versa — 2 legs). That is NOT oscillation;
 * it is curvature, not a cycle. OSC_MIN_LEGS=3 (≥2 direction reversals) is the line between "one
 * linear-fit-artifact hump" and "an actual multi-leg oscillation" — this is the load-bearing guard
 * against re-introducing a false positive on a monotone knife.
 *
 * Direction-agnostic by construction: nothing here branches on the sign of `slope` or of any leg's
 * direction — only leg COUNT and amplitude feed `oscillating`.
 *
 * @param {Array} days   a windowStats().days series — [[key, {low, hi}], …] oldest→newest
 * @param {object} opts { minDays = OSC_MIN_DAYS, minLegDays = OSC_MIN_LEG_DAYS,
 *                        ampNoiseMult = OSC_AMP_NOISE_MULT, minLegs = OSC_MIN_LEGS }
 * @returns {null | { oscillating, knife, slope, nDays, legs, amplitude, noiseFloor }}
 *   `knife` = !oscillating — the boolean intended to TEMPER the EXISTING knife guard so it stops
 *   over-rejecting a down-drift oscillator as a false knife. Wired into NO gate directly (inform-only
 *   at Chunk 1; the amplitude gate's Chunk-3B temper reads `.oscillating`). null when fewer than
 *   minDays usable daily mids (degrade, never a fake read). `legs` = count of REAL legs found;
 *   `amplitude` = the largest real leg's peak-to-trough gp swing; `noiseFloor` = the day-to-day
 *   residual-step median used to qualify a leg as real (all diagnostic, for callers/tests).
 *   HEURISTIC, n≈0 — a shape tell, not a probability (rule 4).
 */
export function oscillationVsKnife(days, { minDays = OSC_MIN_DAYS, minLegDays = OSC_MIN_LEG_DAYS, ampNoiseMult = OSC_AMP_NOISE_MULT, minLegs = OSC_MIN_LEGS } = {}) {
  const scored = Array.isArray(days) ? days.filter(([, n]) => n && (n.low != null || n.hi != null)) : [];
  const midOf = n => (n.low != null && n.hi != null) ? (n.low + n.hi) / 2 : (n.low ?? n.hi);
  const mids = scored.map(([, n]) => midOf(n)).filter(v => v != null);
  if (mids.length < minDays) return null;
  // detrend line = the shared recency-weighted slope primitive fit over the WHOLE series (recentN = length),
  // so we reuse floorCeilingTrack's trend math rather than re-deriving it (one-home discipline).
  const rt = projectTrajectory(scored, midOf, { minDays, recentN: mids.length });
  const slope = rt && rt.slope != null ? rt.slope : 0;
  // residual of each day's mid from the fitted drift line, CENTERED (mean-zeroed) — the intercept of the
  // fit is arbitrary, so centering makes "amplitude around the trend" a meaningful, comparable quantity.
  const raw = mids.map((m, i) => m - slope * i);
  const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
  const resid = raw.map(r => r - mean);

  // noise floor: the MEDIAN absolute day-to-day residual step — a robust (not mean, so one big real leg
  // can't inflate its own floor) estimate of ordinary one-day jitter unrelated to a multi-day cycle.
  const steps = [];
  for (let i = 1; i < resid.length; i++) steps.push(Math.abs(resid[i] - resid[i - 1]));
  const sortedSteps = [...steps].sort((a, b) => a - b);
  const noiseFloor = sortedSteps.length ? sortedSteps[Math.floor(sortedSteps.length / 2)] : 0;

  // split the residual series into maximal same-direction runs ("legs"); a flat (zero) step extends the
  // current leg rather than breaking it (a literal tie carries no directional information either way).
  const legsRaw = [];
  let dir = null, start = 0;
  for (let i = 1; i < resid.length; i++) {
    const d = Math.sign(resid[i] - resid[i - 1]);
    if (d === 0) continue;
    if (dir == null) { dir = d; start = i - 1; continue; }
    if (d !== dir) { legsRaw.push({ dir, start, end: i - 1 }); dir = d; start = i - 1; }
  }
  if (dir != null) legsRaw.push({ dir, start, end: resid.length - 1 });

  // a REAL leg clears BOTH the min-length and the amplitude-over-noise-floor bars (filters a single-day
  // blip and a leg that's itself just noise riding the fit).
  const realLegs = legsRaw
    .map(l => ({ dir: l.dir, days: l.end - l.start, amp: Math.abs(resid[l.end] - resid[l.start]) }))
    .filter(l => l.days >= minLegDays && (noiseFloor === 0 ? l.amp > 0 : l.amp >= noiseFloor * ampNoiseMult));

  // ≥minLegs REAL legs (≥2 direction reversals) is the line between a monotone linear-fit hump (≤2 legs,
  // never a real cycle) and an actual multi-leg oscillation. Legs strictly alternate direction by
  // construction, so ≥2 legs already implies both an up-leg and a down-leg — the count IS the discriminant.
  const oscillating = realLegs.length >= minLegs;
  const amplitude = realLegs.length ? Math.max(...realLegs.map(l => l.amp)) : 0;
  return { oscillating, knife: !oscillating, slope, nDays: mids.length, legs: realLegs.length, amplitude, noiseFloor };
}
