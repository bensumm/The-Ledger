/* fill-placement.mjs — the PURE calibration core for analyze-fill-placement.mjs (AC1/AC2,
 * PLAN-REACH-CALIBRATION). No IO, no fetch, no print — every function is pure over an already-fetched
 * 1h /timeseries array + the closed-lot record, so the command is a thin fetch/print shell (the
 * lib/analyze.mjs ⇆ analyze-record.mjs pattern) and this file is fixture-testable with synthetic points.
 *
 * WHAT IT COMPUTES (never a ruling — see the command header + PLAN §"The honesty core"):
 *   - lotPlacement: where a closed lot's realized sellEach/buyEach sits in the trailing daily-high/low
 *     distribution (the quantHigh/quantLow percentile machinery), + sizeShare on the CORRECTED
 *     rolling-24h denominator (never the broken /24h).
 *   - cdf / spearman / median / quant: the small stats the bucketing + monotone-association read use.
 * It builds NONE of safeQuantile/qEvidence/impactFold (AC3, gated on this study's findings).
 */
import { windowStats, placement } from '../../js/windowread.mjs';
import { rolling24FromTs1h } from './marketfetch.mjs';

export const FP_MIN_DAYS = 5;   // fewer scored trailing days than this ⇒ 'thin-history' (mirrors ASYM_MIN_DAYS)

// empirical CDF: fraction of the ascending-sorted sample AT OR BELOW x. sellEach vs daily-HIGHS: a high
// value ⇒ sold above most days' peaks (the small-clip premium). buyEach vs daily-LOWS: a LOW value ⇒
// bought below most days' troughs (a deep entry). One convention; the caller documents per use. null on
// an empty sample. THE ONE definition lives in js/windowread.mjs as `placement` (AC4a made it the shared
// price→percentile home the reach CLIs use); `cdf` is kept as this study's original name so AC1's call
// sites + fixtures read unchanged — same computation, one implementation.
export const cdf = placement;

export const median = arr => { const s = arr.filter(v => v != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
export const quant = (arr, p) => { const s = arr.filter(v => v != null).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] : null; };

// Spearman rank correlation (monotone association, robust to the nonlinearity a "knee" implies; ties get
// the average rank). null when n<3 or a side has zero variance. Negative ⇒ bigger x → smaller y.
export function spearman(pairs) {
  const n = pairs.length;
  if (n < 3) return null;
  const rank = arr => {
    const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(arr.length);
    let i = 0;
    while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; }
    return r;
  };
  const rx = rank(pairs.map(p => p[0])), ry = rank(pairs.map(p => p[1]));
  const mx = rx.reduce((a, b) => a + b, 0) / n, my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
  return (dx && dy) ? num / Math.sqrt(dx * dy) : null;
}

/* lotPlacement(lot, series1h, opts) → the per-lot placement + sizeShare read, PURE over an in-hand 1h
 * series. lot = { itemId, qty, buyEach, sellEach, buyTs, sellTs }. Returns
 *   { sellPlacement, buyPlacement, sizeShare, shareHpv, volDaySell, nDaysSell, coverage }
 * coverage: 'no-series' (empty series), 'thin-history' (<minDays trailing daily-highs as-of the sell —
 * the un-placeable early period before the live 1h reach), else 'ok'. The sell-day distribution is the
 * trailing `nights` COMPLETE days as-of the sell (the sell day itself excluded, exactly like the live
 * reach check); the series is pre-filtered to ts ≤ sellTs so no future data leaks in. */
export function lotPlacement(lot, series1h, { nights = 14, minDays = FP_MIN_DAYS } = {}) {
  const out = { sellPlacement: null, buyPlacement: null, sizeShare: null, shareHpv: null, volDaySell: null, nDaysSell: 0, coverage: 'ok' };
  if (!Array.isArray(series1h) || !series1h.length) { out.coverage = 'no-series'; return out; }

  const sFilt = series1h.filter(p => p.timestamp <= lot.sellTs);   // MUST pre-filter — no future leak
  const statsSell = windowStats(sFilt, { nights, wStart: 0, wEnd: 0, now: new Date(lot.sellTs * 1000) });
  if (statsSell && statsSell.his.length >= minDays) {
    out.sellPlacement = cdf(statsSell.his, lot.sellEach);
    out.nDaysSell = statsSell.his.length;
  } else { out.coverage = 'thin-history'; }

  const bFilt = series1h.filter(p => p.timestamp <= lot.buyTs);
  const statsBuy = windowStats(bFilt, { nights, wStart: 0, wEnd: 0, now: new Date(lot.buyTs * 1000) });
  if (statsBuy && statsBuy.lows.length >= minDays) out.buyPlacement = cdf(statsBuy.lows, lot.buyEach);

  // sizeShare on the CORRECTED rolling-24h denominator (composed from the in-hand 1h series). PRIMARY =
  // total transacted volume (matches "volDay"); shareHpv = qty ÷ instabuy-only flow (the mechanically
  // relevant sell-impact denominator). NEVER the broken /24h.
  const roll = rolling24FromTs1h(sFilt, lot.sellTs * 1000);
  if (roll) {
    const tot = (roll.highPriceVolume || 0) + (roll.lowPriceVolume || 0);
    if (tot > 0) { out.volDaySell = tot; out.sizeShare = lot.qty / tot; }
    if ((roll.highPriceVolume || 0) > 0) out.shareHpv = lot.qty / roll.highPriceVolume;
  }
  return out;
}

/* smoothingBias(oneHourSeries, fiveMinRows) → AC2 per-hour samples joining the archive's 5m buckets to
 * the live 1h series by CONTAINING hour: [{ hourTs, oneHourAvgHigh, fiveMax, bias, vol1hHigh }].
 * bias = max(5m avgHighPrice in the hour) ÷ (1h avgHighPrice) − 1. fiveMinRows = archive rows
 * ({ ts, avgHighPrice }). Only hours where BOTH a 1h avg and ≥1 5m bucket exist are emitted. NOTE the
 * 5m value is itself a 5-minute AVERAGE (the wiki exposes no raw tick), so this bias is a LOWER BOUND on
 * the true average-vs-execution smoothing gap. */
export function smoothingBias(oneHourSeries, fiveMinRows) {
  const oneHourByTs = new Map();
  for (const p of oneHourSeries || []) if (p && p.avgHighPrice != null) oneHourByTs.set(p.timestamp, { avg: p.avgHighPrice, vol: p.highPriceVolume || 0 });
  const fiveMaxByHour = new Map();
  for (const r of fiveMinRows || []) {
    if (!r || r.avgHighPrice == null) continue;
    const hourStart = Math.floor(r.ts / 3600) * 3600;
    const cur = fiveMaxByHour.get(hourStart);
    if (cur == null || r.avgHighPrice > cur) fiveMaxByHour.set(hourStart, r.avgHighPrice);
  }
  const out = [];
  for (const [hourTs, fiveMax] of fiveMaxByHour) {
    const oh = oneHourByTs.get(hourTs);
    if (!oh || !(oh.avg > 0)) continue;
    out.push({ hourTs, oneHourAvgHigh: oh.avg, fiveMax, bias: fiveMax / oh.avg - 1, vol1hHigh: oh.vol });
  }
  return out;
}
