/* reach-surface.mjs — the empirical reach surface p(ask, H) for ONE item (PLAN-REACH-SURFACE ch.1).
 *
 * "Which exit estimator is best" has no answer: every estimator is one point on a surface, and the
 * best ask depends on how long you will wait and what a miss costs. This builds the surface itself,
 * by replaying the item's own 1h archive — no accrual, no logged suggestions, no fitted model.
 *
 * THE LEVEL AXIS IS z, NOT %. z = (ask - refHigh) / disp, where refHigh is the median of the last
 * `refN` complete daily highs and disp is the IQR of the last `nights`. A raw %-above-median grid
 * INVERTS the trend split (falling items reach +1% more often than rising, because |slope| tracks
 * dispersion); z collapses that split to a few pp. Trend is a guard flag, never a curve conditioner.
 *
 * NO LOOK-AHEAD, and this is the load-bearing invariant. refHigh and disp are RE-DERIVED at every
 * origin from complete days strictly before it, so a level scored 90 days ago never sees data from
 * day 91. The top-level `refHigh`/`disp` are the CURRENT ones and exist only to convert a live ask
 * into z at query time. Deleting the per-origin re-derivation is the mutation the tests hunt.
 */

/* THE INSTRUMENT IS 1h, UNIFORMLY. `maxHighWithin` reads `avgHighPrice` — an average of the hour's
 * prints, structurally below the intra-hour max a resting ask fills against — so reach is understated
 * on liquid items and the error grows with ask distance. A 1h/5m hybrid was specified, reviewed and
 * REVERSED: a max over two grains is denser on liquid items than thin ones and covers only the recent
 * half of the archive, and this surface's whole output is cross-item comparison. Same call
 * `build-fill-surface.mjs` already made. The bias is REPORTED (`grainBias`), never applied.
 *
 * A ~0 grain bias on a thin item means NOT MEASURABLE, not unbiased: thin items carry 2-3 of a
 * possible 12 5m buckets per hour and no fully-covered hours at all, and a max over a series that
 * sparse cannot exceed the 1h max. `grainBias.coverage` rides beside every delta so the two cases
 * are distinguishable; a delta without its coverage is unreadable.
 *
 * REACH IS NOT FILL. Queue position is invisible in bucketed aggregates, so p bounds P(fill) from
 * ABOVE. Every consumer must say so.
 */

/* REFUSAL IS A WIDTH BOUND, NOT A COUNT. A cell is `thin` when its Wilson half-width exceeds
 * `maxCiHalfWidth`; a count floor admits an interval tens of pp wide as a price input. Wilson, not
 * Wald, because Wald reports half-width 0 at p=0 and every empty cell would price as certain.
 * The CI uses `nIndep` (origins thinned to non-overlapping windows) while p uses every resolved
 * origin: overlapping windows share outcomes, so the raw count overstates precision.
 */
import { windowStats, recentQuant, iqr } from './windowread.mjs';
import { HOUR, firstIndexAfter, maxHighWithin, covers } from './forward-reach.mjs';

export const DEFAULT_HORIZONS_H = [2, 6, 12, 24, 48, 96];
export const DEFAULT_Z_GRID = [-1, -0.5, -0.25, -0.1, 0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.75, 1, 1.5, 2, 3, 4];
export const DEFAULT_STRIDE_H = 6;
export const DEFAULT_MAX_CI_HALF = 0.15;   // PLACEHOLDER, operator-owned
export const SHAPE_SPREAD_CLIFF = 0.6;     // PLACEHOLDER, re-derived by the chunk-1 fixtures
export const SHAPE_SPREAD_FAT = 1.6;       // PLACEHOLDER

const medianOf = a => { const s = a.filter(v => v != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

/* Wilson half-width at p over n trials. Well-behaved at p=0 and p=1, where Wald reads 0. */
export function wilsonHalfWidth(p, n, zCrit = 1.96) {
  if (!Number.isFinite(p) || !Number.isFinite(n) || n <= 0) return null;
  const d = 1 + (zCrit * zCrit) / n;
  return (zCrit / d) * Math.sqrt((p * (1 - p)) / n + (zCrit * zCrit) / (4 * n * n));
}

/* z-MONOTONICITY NEEDS NO CLEANUP. Every z cell in a row is scored over the SAME resolved origins,
 * each against `top >= refHigh_o + z*disp_o` with disp_o > 0, so raising z can only turn a hit into a
 * miss. An isotonic pass here was specified, built, and measured to fire 0 times in 22,500 adjacent
 * pairs over 250 items — impossible, not merely rare — so it was deleted rather than shipped inert.
 * The H axis is different and DOES need one: its origin set shrinks with H. */

/* windowStats reads `pt.timestamp`; the archive and forward-reach both use `.ts`. Bridged here rather
 * than in windowStats, whose every other caller already passes the `timestamp` shape. */
const statsView = series => series.map(p => ({ ...p, timestamp: p.ts }));

/* The end-of-window instasell: the LAST bucket in (from, from+windowH] printing an avgLowPrice. The
 * miss branch's payoff in §2's EV, returned as a PRICE — net() stays at chunk 2's single call site
 * rather than being applied twice. Pooled across origins it must be carried in z, never gp: over this
 * archive's span a big ticket moves 20%, so a pooled gp bail is not comparable to a current refHigh. */
function endLowWithin(series, from, windowH) {
  const end = from + windowH * HOUR;
  let last = null;
  for (let i = firstIndexAfter(series, from); i < series.length && series[i].ts <= end; i++) {
    if (series[i].avgLowPrice != null) last = series[i].avgLowPrice;
  }
  return last;
}

/* refHigh/disp as of `at`, from complete days strictly before it. windowStats drops the day
 * containing `at`, which is what makes this no-look-ahead. Requires the FULL `nights` window: a disp
 * from 3 days and one from 14 are different units, so admitting both would pool cells whose z means
 * two different things. Costs the archive's first `nights` days of origins, deliberately.
 *
 * dispMode 'level' is the plan's spec: IQR of the daily highs themselves, which on a trending item is
 * mostly the TREND rather than the volatility, inflating z and making the curve read as a cliff.
 * 'detrended' takes the IQR of day-over-day CHANGES instead. The seam exists so the two can be
 * compared on the shipped code path; 'level' stays the default until that comparison decides. */
// @test-only: exported so the no-look-ahead invariant is assertable as an EQUALITY rather than
// inferred from an aggregate. The chunk-3 inspector reads the built surface, not this.
export function referenceAsOf(series, at, { nights = 14, refN = 3, dispMode = 'level' } = {}) {
  if (!Array.isArray(series) || !series.length) return null;
  return referenceAt(series, statsView(series), at, nights, refN, dispMode);
}

function referenceAt(series, view, at, nights, refN, dispMode) {
  const cut = firstIndexAfter(series, at);
  if (cut <= 0) return null;
  const st = windowStats(view.slice(0, cut), { nights, wStart: 0, wEnd: 24, now: new Date(at * 1000) });
  if (!st || st.days.length < nights) return null;
  const refHigh = recentQuant(st.days, 'ask', 0.5, refN);
  const his = st.days.map(([, n]) => n.hi);
  const disp = dispMode === 'detrended' ? iqr(his.slice(1).map((v, i) => (v == null || his[i] == null) ? null : v - his[i])) : iqr(his);
  if (!Number.isFinite(refHigh) || !Number.isFinite(disp) || disp <= 0) return null;
  return { refHigh, disp, nDays: st.days.length };
}

/* Replay the z x H grid over one outcome series. Origins, refs and levels are supplied by the caller
 * so the 1h and 5m passes score IDENTICAL levels at IDENTICAL origins — the only difference is the
 * series the outcome is read from, which is the whole point of the grain-bias diagnostic.
 *
 * An origin whose window holds NO printing bucket is dropped, not scored as a miss, because the
 * archive cannot tell a quiet hour from an unfetched one. That drops the item's quietest windows, so
 * it biases p UP; `noPrintDropped` reports how many, per H, rather than leaving it assumed. */
function replay(outcomeSeries, origins, zGrid, horizonsH, strideH, maxCiHalfWidth, wantBail) {
  return horizonsH.map(h => {
    const step = Math.max(1, Math.ceil(h / strideH));
    const resolved = [];
    let noPrintDropped = 0;
    origins.forEach((o, i) => {
      if (!covers(outcomeSeries, o.ts + h * HOUR)) return;
      const top = maxHighWithin(outcomeSeries, o.ts, h);
      if (top == null) { noPrintDropped++; return; }
      resolved.push({ o, top, indep: i % step === 0, bail: wantBail ? endLowWithin(outcomeSeries, o.ts, h) : null });
    });
    const n = resolved.length;
    const nIndep = resolved.filter(r => r.indep).length;
    const raw = zGrid.map(z => {
      let hits = 0; const bails = [];
      for (const r of resolved) {
        if (r.top >= r.o.refHigh + z * r.o.disp) hits++;
        else if (r.bail != null) bails.push((r.bail - r.o.refHigh) / r.o.disp);
      }
      return { z, hits, p: n ? hits / n : null, bailZOnMiss: bails.length ? medianOf(bails) : null };
    });
    const cells = raw.map(c => ({ z: c.z, hits: c.hits, pRaw: c.p, p: c.p, ciHalf: null, thin: true, bailZOnMiss: c.bailZOnMiss }));
    return { h, n, nIndep, noPrintDropped, cells };
  });
}

/* Running max over H per z: p can only rise with more time, but the origin set SHRINKS with H, so a
 * raw row can invert (measured 155 times over 250 items, up to 12.1pp). A pointwise max over the
 * horizons preserves z-monotonicity, since a max of non-increasing functions of z is non-increasing.
 * Upward-biased by construction; `pRaw` sits beside every cell so what it moved stays visible. */
function enforceHorizonMonotone(grid) {
  for (let k = 0; k < (grid[0]?.cells.length || 0); k++) {
    let best = null;
    for (const row of grid) {
      const c = row.cells[k];
      if (c.p == null) continue;
      if (best != null && c.p < best) c.p = best; else best = c.p;
    }
  }
  return grid;
}

/* The ONE place a cell's interval is stamped. It was written in two, and the later write masked the
 * earlier — a mutant swapping the thinned count for the raw one survived the whole suite. */
function stampWidths(grid) {
  for (const row of grid) {
    for (const c of row.cells) {
      c.ciHalf = wilsonHalfWidth(c.p, row.nIndep);
      c.thin = c.ciHalf == null || c.ciHalf > row.maxCiHalfWidth;
    }
  }
  return grid;
}

/* The horizon's DECISION cell: the one nearest p=0.5. It carries the widest interval on the curve and
 * is where an EV maximum typically sits, so "can this horizon price at all" is its question. */
function decisionCell(row) {
  let best = null;
  for (const c of row.cells) {
    if (c.p == null) continue;
    if (!best || Math.abs(c.p - 0.5) < Math.abs(best.p - 0.5)) best = c;
  }
  return best;
}

/* The taxonomy as numbers, not labels: z50/z20 are where the H=24 curve crosses 0.5 and 0.2, and the
 * SPREAD between them is the shape. A tight band is a cliff (patience buys nothing past the edge); a
 * trendy big ticket is a fat shallow tail (nothing likely, nothing impossible). Thresholds are
 * PLACEHOLDER and the numbers are the read — never quote the label alone. */
export function surfaceShape(surface, atH = 24) {
  const row = surface?.grid?.find(r => r.h === atH) || surface?.grid?.[0];
  if (!row) return null;
  const cross = target => {
    const cs = row.cells.filter(c => c.p != null);
    for (let i = 1; i < cs.length; i++) {
      const a = cs[i - 1], b = cs[i];
      if (a.p >= target && b.p <= target) {
        const span = a.p - b.p;
        return span > 0 ? a.z + (b.z - a.z) * ((a.p - target) / span) : a.z;
      }
    }
    return null;
  };
  const z50 = cross(0.5), z20 = cross(0.2);
  const spread = (z50 != null && z20 != null) ? z20 - z50 : null;
  const label = spread == null ? null : spread < SHAPE_SPREAD_CLIFF ? 'cliff' : spread > SHAPE_SPREAD_FAT ? 'fat-tail' : 'mid';
  return { atH, z50, z20, spread, label };
}

/* p for a live ask at horizon H. Linear between z nodes; OUTSIDE the grid it clamps and flags
 * `extrapolated` rather than extending the curve — off-grid is a refusal to price, not a number. */
export function surfaceProb(surface, ask, H) {
  if (!surface || !Number.isFinite(ask)) return null;
  const row = surface.grid.find(r => r.h === H);
  if (!row || !Number.isFinite(surface.refHigh) || !(surface.disp > 0)) return null;
  const z = (ask - surface.refHigh) / surface.disp;
  const cs = row.cells.filter(c => c.p != null);
  if (!cs.length) return null;
  if (z <= cs[0].z) return { z, p: cs[0].p, ciHalf: cs[0].ciHalf, thin: cs[0].thin, extrapolated: z < cs[0].z };
  const last = cs[cs.length - 1];
  if (z >= last.z) return { z, p: last.p, ciHalf: last.ciHalf, thin: last.thin, extrapolated: z > last.z };
  for (let i = 1; i < cs.length; i++) {
    const a = cs[i - 1], b = cs[i];
    if (z <= b.z) {
      const f = (z - a.z) / (b.z - a.z);
      return { z, p: a.p + f * (b.p - a.p), ciHalf: Math.max(a.ciHalf ?? 0, b.ciHalf ?? 0), thin: a.thin || b.thin, extrapolated: false };
    }
  }
  return null;
}

/* The 1h-vs-5m delta at every cell, over the SAME origins and levels, plus the 5m coverage that says
 * whether the delta is readable at all. Reported, never applied. */
function grainDiagnostic(fiveMin, oneHourSeries, origins, zGrid, horizonsH, strideH, maxCiHalfWidth) {
  if (!fiveMin || fiveMin.length < 2) return null;
  const from = fiveMin[0].ts, to = fiveMin[fiveMin.length - 1].ts;
  const inEra = origins.filter(o => o.ts >= from && o.ts <= to);
  if (!inEra.length) return null;
  const withPrint = fiveMin.filter(p => p.avgHighPrice != null).length;
  const buckets = Math.max(1, Math.round((to - from) / 300) + 1);
  const fiveGrid = replay(fiveMin, inEra, zGrid, horizonsH, strideH, maxCiHalfWidth, false);
  const oneGrid = replay(oneHourSeries, inEra, zGrid, horizonsH, strideH, maxCiHalfWidth, false);
  const byZH = fiveGrid.map((row, i) => ({
    h: row.h,
    n: row.n,
    deltaPp: row.cells.map((c, k) => {
      const base = oneGrid[i].cells[k];
      return (c.pRaw == null || base.pRaw == null) ? null : (c.pRaw - base.pRaw) * 100;
    }),
  }));
  return {
    coverage: withPrint / buckets,
    eraDays: (to - from) / 86400,
    origins: inEra.length,
    zGrid: zGrid.slice(),
    byZH,
    measurable: withPrint / buckets >= 0.5,
    note: 'REPORTED, never applied. A ~0 delta at low coverage means not measurable, not unbiased.',
  };
}

/* buildReachSurface(series, opts) -> the item's p(z, H) surface.
 *   series:  ts-ascending 1h archive rows {ts, avgHighPrice, avgLowPrice, ...}.
 *   fiveMin: optional 5m rows, same shape, for the grain diagnostic only. Never an outcome source.
 * Returns null when the item lacks the history to place a single origin. */
export function buildReachSurface(series, {
  nights = 14,
  refN = 3,
  dispMode = 'level',
  horizonsH = DEFAULT_HORIZONS_H,
  zGrid = DEFAULT_Z_GRID,
  strideH = DEFAULT_STRIDE_H,
  maxCiHalfWidth = DEFAULT_MAX_CI_HALF,
  now = new Date(),
  fiveMin = null,
} = {}) {
  if (!Array.isArray(series) || series.length < 2) return null;
  const zs = [...zGrid].sort((a, b) => a - b);
  const hs = [...horizonsH].sort((a, b) => a - b);
  const view = statsView(series);

  const origins = [];
  let skippedShortHistory = 0;
  for (let ts = series[0].ts; ts <= series[series.length - 1].ts; ts += strideH * HOUR) {
    const ref = referenceAt(series, view, ts, nights, refN, dispMode);
    if (!ref) { skippedShortHistory++; continue; }
    origins.push({ ts, refHigh: ref.refHigh, disp: ref.disp });
  }
  if (!origins.length) return null;

  const grid = replay(series, origins, zs, hs, strideH, maxCiHalfWidth, true);
  grid.forEach(r => { r.maxCiHalfWidth = maxCiHalfWidth; });
  stampWidths(enforceHorizonMonotone(grid));

  const current = referenceAt(series, view, Math.floor(now.getTime() / 1000), nights, refN, dispMode);
  const spanDays = (series[series.length - 1].ts - series[0].ts) / 86400;

  const surface = {
    refHigh: current?.refHigh ?? null,
    disp: current?.disp ?? null,
    coveredDays: current?.nDays ?? 0,
    spanDays,
    nOrigins: origins.length,
    skippedShortHistory,
    strideH,
    nights,
    refN,
    dispMode,
    maxCiHalfWidth,
    zGrid: zs,
    grid,
    independentWindows: Object.fromEntries(grid.map(r => [r.h, r.nIndep])),
    thin: Object.fromEntries(grid.map(r => [r.h, decisionCell(r)?.thin ?? true])),
    thinReason: Object.fromEntries(grid.map(r => {
      const c = decisionCell(r);
      return [r.h, (c && !c.thin) ? null
        : `the decision cell (z=${c ? c.z : 'n/a'}, p=${c ? Math.round(c.p * 100) : 'n/a'}%) is ±${c && c.ciHalf != null ? Math.round(c.ciHalf * 100) : '?'}pp at ${r.nIndep} independent window(s), past the ±${Math.round(maxCiHalfWidth * 100)}pp bound`];
    })),
    grainBias: null,
    reachIsNotFill: true,
  };
  surface.grainBias = grainDiagnostic(fiveMin, series, origins, zs, hs, strideH, maxCiHalfWidth);
  surface.shape = surfaceShape(surface, hs.includes(24) ? 24 : hs[0]);
  return surface;
}
