/* range-position.mjs — YF1: reconstruct the MARKET STATE AS OF a past timestamp (the shared seam #1(a)
   and #2 both need). Composes the two past-anchored fetchers in marketfetch (loadHistBands for the
   trailing-2h 5m band, loadHistDaily for the ~17d 6h series) and feeds them into the EXISTING PURE
   classifiers in js/quotecore.js (regimeDrift/regimeLabel/phase) — no market math is re-implemented
   here; this only ASSEMBLES already-shipped pieces at a historical time.

   The classification core `deriveState` is PURE (no fetch), so it is fixture-testable with synthetic
   values (range-position.test.mjs). `loadHistState` is the thin network wrapper around it.

   Honesty: a fill whose history is gone (past the /5m or /1h retention) yields reconstructed:false
   with nulled fields — NEVER a fabricated percentile/regime/phase. bandPct is 5m-bucket approximate
   (fine for percentile/regime/phase classification, NOT tick-exact). */
import { loadHistBands, loadHistDaily } from './marketfetch.mjs';
import { regimeDrift, regimeLabel, phase } from '../../js/quotecore.js';

/* deriveState({ band, series6h, price }) -> the stateAtFill record fields.
   band     : one loadHistBands result { bandLo, bandHi, covered, nWin, loVol, hiVol } (or null)
   series6h : one loadHistDaily result [{ avgLowPrice, avgHighPrice, timestamp }] (or null/[])
   price    : the fill/placement price (optional) -> band percentile within the trailing-2h band */
// Where `price` sits within a 2h traded band, clamped to [0,100]. `null` when the band is absent
// or degenerate (hi ≤ lo). `round` yields an integer percent (state-comparison callers); the raw
// float is kept for logging callers. ONE home for the formula (was duplicated in outcomes.mjs).
export function bandPercentile(price, lo, hi, { round = false } = {}) {
  if (price == null || lo == null || hi == null || hi <= lo) return null;
  const pct = Math.max(0, Math.min(100, (price - lo) / (hi - lo) * 100));
  return round ? Math.round(pct) : pct;
}

export function deriveState({ band, series6h, price } = {}) {
  const bandLo = band && band.bandLo != null ? band.bandLo : null;
  const bandHi = band && band.bandHi != null ? band.bandHi : null;
  const bandCovered = band && band.covered ? band.covered : 0;

  const bandPct = bandPercentile(price, bandLo, bandHi, { round: true });

  const pts = Array.isArray(series6h) ? series6h : [];
  const rd = regimeDrift(pts);
  const rl = regimeLabel(rd);
  const ph = phase(pts);

  const bandOk = bandLo != null && bandHi != null && bandCovered > 0;
  const reconstructed = bandOk || rd.ok || ph.phase !== 'unknown';

  return {
    bandLo, bandHi, bandPct,
    regime: rl.label,                                   // 'flat' | 'rising' | 'falling' | 'unknown'
    driftPct: rd.ok ? Math.round(rd.driftPct * 10) / 10 : null,
    phase: ph.phase,                                    // 'base' | 'spike' | 'decay' | 'basing' | 'unknown'
    reconstructed,
    coverage: { bandWindows: bandCovered, bandTotal: band && band.nWin ? band.nWin : 0, series6h: pts.length },
    source: 'hist-5m+1h@6h',
  };
}

/* loadHistState(reqs, opts) -> array aligned to reqs of deriveState records.
   reqs: [{ id, endUnix, price? }]. One batched loadHistBands + one batched loadHistDaily. */
export async function loadHistState(reqs, { bandHours = 2, regimeDays = 17, stepHours = 6 } = {}) {
  if (!reqs || !reqs.length) return [];
  const bands = await loadHistBands(reqs, bandHours);
  const series = await loadHistDaily(reqs, regimeDays, stepHours);
  return reqs.map((r, i) => deriveState({ band: bands[i], series6h: series[i], price: r.price }));
}
