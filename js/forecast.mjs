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
// @provisional-api: PF1 forecast fn — no surface consumes it yet (app uses diurnalForecast's return; the console PF2–8 forecast surface is unbuilt). Implement-vs-drop is tracked; keep pending that decision.
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
// @provisional-api: PF1 forecast fn — twin of whenBuyable; no surface consumes it yet. Implement-vs-drop tracked; keep pending that decision.
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
