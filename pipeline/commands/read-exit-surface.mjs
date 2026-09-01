#!/usr/bin/env node
/* read-exit-surface.mjs — the reach surface as a PRICE (PLAN-REACH-SURFACE ch.3).
 *
 * Answers two different questions and never blends them: "what should I ask for X if I will wait H"
 * (askStar, the EV argmax) and "how long to clear X at price P" (horizonForAsk). The p≥pTarget level
 * is NOT offered as an ask — §1c measured it as the worst rule tried at short horizons.
 *
 * The incumbent exit estimators are placed on the same surface as (ask, p@H) points, which is the
 * whole point of the plan: one ruler instead of parallel conventions. (`pressure` left that ruler
 * 2026-08-30 — retired from exit pricing by join-exit-ev.mjs's criterion; its logged history stays
 * readable via reachability.mjs.) The fold row is a RECONSTRUCTION off
 * a synthetic quote row, the read-window-range.mjs precedent — it is labelled as one because the
 * deployed estimator sees inputs this surface does not build.
 *
 * Inform-only. Gates nothing, writes nothing but its report dump. Every parameter is operator-owned
 * and printed beside the number it moved. Limits + what the gate measured: README's entry.
 *
 * Usage:
 *   node pipeline/commands/read-exit-surface.mjs "<item or id>" [...more]
 *     [--horizon H[,H…]]  horizons to price at, from the surface grid 2/6/12/24/48/96 (default 6,24,48)
 *     [--price P]         the horizon read: smallest H whose p at P clears --p-target
 *     [--qty N]           lot size — enables the depth incumbent and sizes the fold's relief
 *     [--delay-cost gp]   per-unit cost charged to the MISS branch only (default 0)
 *     [--p-target f]      probability target for the HORIZON read only (default 0.7)
 *     [--nights N]        trailing daily highs the dispersion reads (default 14)
 *     [--json]            the report objects as JSON; no table
 */
import { pathToFileURL } from 'node:url';
import { loadMapping, fetchItemInputs } from '../lib/market/marketfetch.mjs';
import { parseArgs, parseGp, mdTable, writeLastReport } from '../lib/render/cli.mjs';
import { open as openArchive } from '../lib/market/archive.mjs';
import { buildReachSurface, surfaceProb, DEFAULT_HORIZONS_H as SURFACE_HORIZONS_H } from '../../js/reach-surface.mjs';
import { evCurve, askStar, horizonForAsk, DEFAULT_P_TARGET, DEFAULT_DELAY_COST } from '../../js/exit-ev.mjs';
import { windowStats, asymPair, clearableAsk, reachedDays, recencySplit, RECENT_NIGHTS } from '../../js/windowread.mjs';
import { estimatePair } from '../lib/signal/estimators.mjs';
import { FLIP_NICHES } from '../../js/flip-niches.mjs';
import { computeQuote } from '../../js/quotecore.js';
import { tax } from '../../js/money-math.js';

// Fewer covered days than this and the dispersion the z axis is measured in has no sample: refuse.
export const MIN_COVERED_DAYS = 14;
// A cell counts as on the plateau when its EV is within this fraction of the scored EV RANGE of the
// best. PLACEHOLDER, operator-owned — it sets how wide a band gets printed, nothing else.
export const PLATEAU_TOL_FRAC = 0.02;
// An argmax below this reach probability gets a flag, not a silent number. PLACEHOLDER, operator-owned.
export const P_STAR_FLOOR = 0.10;
export const DEFAULT_REPORT_HORIZONS = [6, 24, 48];

const pct = p => (p == null ? '—' : (p * 100).toFixed(0) + '%');
// Exact gp, not fmt/fmtP: both compress, and compression collapses adjacent z cells onto one label at
// BOTH ends of the range (6,043 -> "6k"; 1,379,500,000 -> "1.38b", same as the cell below it). An
// inspector whose price column cannot distinguish two prices is not an inspector. Locale pinned so the
// rendered text is deterministic under test.
const gp = v => (v == null || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString('en-US'));

/* Distinct days the ARCHIVE actually holds a high print for. NOT `surface.coveredDays`, which counts
 * the reference window and is therefore pinned to `nights` — measured 111 of 111 priced items at
 * exactly 14, so a floor against it fired zero times and `--nights 10` refused every item for being
 * "thin" at the operator's own setting. UTC day keys: an internal bucketing count, never rendered. */
export function archiveCoverage(series) {
  if (!Array.isArray(series) || !series.length) return { days: 0, spanDays: 0 };
  const d = new Set();
  for (const r of series) if (r.avgHighPrice != null && Number.isFinite(r.ts)) d.add(Math.floor(r.ts / 86400));
  return { days: d.size, spanDays: (series[series.length - 1].ts - series[0].ts) / 86400 };
}

/* Why this surface cannot be priced off, or null. A refusal is a sentence, never a number. */
export function refusal(surface, coverage, { minCoveredDays = MIN_COVERED_DAYS } = {}) {
  if (!surface) return 'no surface: the archive holds too little 1h history to place a single origin';
  if (coverage && coverage.days < minCoveredDays) {
    return `thin history: the archive holds ${coverage.days} day(s) with a high print against the ${minCoveredDays}-day floor — the z axis has no dispersion sample`;
  }
  if (!Number.isFinite(surface.refHigh) || !(surface.disp > 0)) {
    return `no reference: refHigh=${surface.refHigh} disp=${surface.disp} — the last ${surface.refN} daily highs or the ${surface.nights}-day dispersion are missing`;
  }
  return null;
}

/* The contiguous run of cells around the argmax whose EV is within tol of the best, as a BAND. The
 * argmax is over a plateau — adjacent cells sit basis points apart — so a single number is a false
 * point and §1c forbids printing one. */
export function plateau(cells, best, { tolFrac = PLATEAU_TOL_FRAC } = {}) {
  if (!Array.isArray(cells) || !cells.length || !best) return null;
  const evs = cells.map(c => c.ev);
  const range = Math.max(...evs) - Math.min(...evs);
  const tol = range > 0 ? range * tolFrac : 0;
  const i = cells.findIndex(c => c.z === best.z);
  if (i < 0) return null;
  let lo = i, hi = i;
  while (lo > 0 && best.ev - cells[lo - 1].ev <= tol) lo--;
  while (hi < cells.length - 1 && best.ev - cells[hi + 1].ev <= tol) hi++;
  return {
    loZ: cells[lo].z, hiZ: cells[hi].z,
    loAsk: cells[lo].ask, hiAsk: cells[hi].ask,
    loP: cells[lo].p, hiP: cells[hi].p,
    n: hi - lo + 1, tolFrac, evRange: range,
  };
}

/* Report prices are whole gp everywhere, including a band's ends — a fractional ask in the dump is a
 * price no one can place. */
const roundBand = b => (b ? { ...b, loAsk: Math.round(b.loAsk), hiAsk: Math.round(b.hiAsk) } : b);

/* The smallest delayCost at which the argmax moves to a HIGHER-p cell, in absolute gp/unit. EV is
 * linear in delayCost per cell (slope −(1−p)), so the crossing is solved, not searched. Null when no
 * cell ever overtakes. This is the audit the operator actually needs: what would have to be true about
 * the cost of waiting for this recommendation to change. */
export function delayCrossover(cells, best, atDelayCost = 0) {
  if (!Array.isArray(cells) || !cells.length || !best) return null;
  let dd = null, to = null;
  for (const c of cells) {
    if (!(c.p > best.p)) continue;
    const d = (best.ev - c.ev) / (c.p - best.p);
    if (d > 0 && (dd == null || d < dd)) { dd = d; to = c; }
  }
  return dd == null ? null : { delayCost: atDelayCost + dd, toZ: to.z, toAsk: to.ask, toP: to.p };
}

/* Two DIFFERENT forces push the argmax above the reference, and which dominates varies by item, so the
 * report names both rather than asserting one. (a) delayCost 0: a miss costs only the bail. (b) the
 * per-cell miss payoff RISES with the ask, so a high ask is credited with a better consolation prize.
 * Swapping (b) for the TOP-CELL bail while holding (a) fixed separates them: if the argmax drops, (b)
 * was doing the work. Top-cell, not unconditional — the two coincide only when that cell reaches ~0.
 * The result is per-item and is PRINTED, not asserted here. */
export function bailDrivenDrift(surface, H, star, { delayCost = 0 } = {}) {
  const row = surface?.grid?.find(r => r.h === H);
  if (!row || !star) return null;
  const bails = row.cells.map(c => c.bailZOnMiss).filter(v => v != null);
  if (!bails.length) return null;
  const topZ = bails[bails.length - 1];
  const topPrice = surface.refHigh + topZ * surface.disp;
  const alt = askStar(surface, H, { delayCost, bailNet: topPrice - tax(topPrice) });
  if (!alt) return null;
  return { topZ: alt.z, topAsk: alt.ask, topP: alt.p, movesTheArgmax: alt.z !== star.z };
}

/* The incumbents' current asks, computed fresh from the same series. `fold` is a reconstruction and
 * says so: the deployed estimator also sees diurnal/asym/dayHigh/placement and an anchor nudge that
 * are not built here, so its relief is structurally 0 (the read-window-range.mjs precedent). */
export function incumbentAsks({ stats, live, statsSeries, qty = null, nights = 14, now = new Date() }) {
  const out = [];
  const push = (key, ask, note) => {
    if (Number.isFinite(ask) && ask > 0) out.push({ key, ask: Math.round(ask), note });
  };
  if (live) {
    push('quick*', live.quickSell, 'live instabuy — the true null, sell fills here now');
    push('opt*', live.optSell, "the tool's own 2h band edge — a sibling, not an outside check");
  }
  // (`pressure` was placed here as an incumbent until 2026-08-30 — RETIRED from exit pricing by
  // join-exit-ev.mjs's pre-registered criterion; it is no longer computed as an exit-price candidate.)
  const ap = stats ? asymPair(stats) : null;
  if (ap) push('asym', ap.highReachAsk, `quantile level — its printed pAsk ${pct(ap.pAsk)} is that quantile read back, not a fill rate`);
  if (qty != null && Array.isArray(statsSeries) && statsSeries.length) {
    const ca = clearableAsk(statsSeries, { qty, nights, wStart: 0, wEnd: 0, now });
    if (ca && ca.price != null) push('depth', ca.price, `books ${qty} units on ${pct(ca.clearFrac)} of days`);
    else if (ca) out.push({ key: 'depth', ask: null, note: `no level books ${qty} units: ${ca.reason}` });
  }
  const fold = foldAsk({ stats, live });
  if (fold != null) push('fold', fold, 'RECONSTRUCTED reach-fold — the deployed estimator sees inputs this surface does not build');
  return out;
}

/* The reach-fold ask off a synthetic quote row. Returns null rather than a guess when the live pair
 * or the daily-high sample is missing. */
export function foldAsk({ stats, live }) {
  if (!live || live.quickBuy == null || live.quickSell == null) return null;
  if (!stats || !Array.isArray(stats.his) || !stats.his.length) return null;
  if (!Array.isArray(stats.days) || !stats.days.length) return null;   // recencySplit walks days, not his
  const synthRow = {
    quickBuy: live.quickBuy, quickSell: live.quickSell,
    optBuy: live.optBuy ?? live.quickBuy, optSell: live.optSell ?? live.quickSell,
    volDay: live.volDay ?? null, limit: live.limit ?? null,
  };
  const level = synthRow.optSell;
  const rc = recencySplit(stats.days, 'ask', level, RECENT_NIGHTS);
  const extra = {
    askReach: { reachedDays: reachedDays(stats.his, level), nDays: stats.his.length, recentHit: rc.recentHit, recentDays: rc.recentDays },
  };
  const est = estimatePair(FLIP_NICHES.band, synthRow, extra, { sellModel: 'reach-fold' });
  return est && Number.isFinite(est.estSell) ? est.estSell : null;
}

/* askStar below the live instabuy is a sign inversion, not a price: the EV-max ask would be under what
 * an instant sell already pays. The plan named this as chunk 3's falsifier, so it is detected, not hoped. */
export function signInversion(star, live) {
  if (!star || !live || live.quickSell == null || !(live.quickSell > 0)) return null;
  if (star.ask >= live.quickSell) return null;
  // The MAGNITUDE rides with it: a hit worth 0.02% of a 515m item is noise wearing an alarm, and
  // without the share printed the flag reads far stronger than it is.
  const pctBelow = (live.quickSell - star.ask) / live.quickSell * 100;
  return `askStar(${star.h}h) ${gp(star.ask)} sits ${pctBelow.toFixed(2)}% BELOW the live instabuy ${gp(live.quickSell)} — a sign inversion, not a price`;
}

/* One item's whole report. PURE — every input is passed in, including `now`. */
export function buildExitReport({ name, itemId, series, fiveMin = null, live = null, opts = {} }) {
  const {
    horizons = DEFAULT_REPORT_HORIZONS, price = null, qty = null,
    delayCost = DEFAULT_DELAY_COST, pTarget = DEFAULT_P_TARGET,
    nights = 14, now = new Date(), minCoveredDays = MIN_COVERED_DAYS,
  } = opts;
  const surface = buildReachSurface(series, { nights, now, fiveMin });
  const coverage = archiveCoverage(series);
  const refused = refusal(surface, coverage, { minCoveredDays });
  const base = { name, itemId, coverage, params: { horizons, delayCost, pTarget, nights, qty, minCoveredDays, plateauTolFrac: PLATEAU_TOL_FRAC } };
  if (refused) return { ...base, refused, surface: surface ? { coveredDays: surface.coveredDays, spanDays: surface.spanDays, nOrigins: surface.nOrigins } : null };

  // windowread reads `timestamp`; the archive stores `ts`. One mapped copy, shared by every incumbent.
  const statsSeries = series.map(r => ({ ...r, timestamp: r.ts }));
  const stats = windowStats(statsSeries, { nights, wStart: 0, wEnd: 0, now });
  const priced = [];
  for (const H of horizons) {
    const curve = evCurve(surface, H, { delayCost });
    if (!curve) { priced.push({ h: H, unavailable: 'no scorable cell at this horizon — the surface grid holds ' + surface.grid.map(r => r.h).join('/') + 'h' }); continue; }
    const star = askStar(surface, H, { delayCost });
    // A REFUSED horizon carries NO price in ANY field. The render already skipped it, but `--json` and
    // the dump did not, so a machine consumer read an ask off a row whose own text says do not quote it.
    // The audit fields (curve, edges, counts) stay — they are evidence, not a recommendation.
    const quote = star.refused ? {
      ask: null, z: null, p: null, ciHalf: null, thin: null,
      band: null, inversion: null, crossover: null, lowFill: null, bailDrift: null,
    } : {
      ask: Math.round(star.ask), z: star.z, p: star.p, ciHalf: star.ciHalf, thin: star.thin,
      band: roundBand(plateau(curve.cells, star)),
      inversion: signInversion(star, live),
      crossover: delayCrossover(curve.cells, star, delayCost),
      lowFill: star.p < P_STAR_FLOOR ? star.p : null,
      bailDrift: star.p < P_STAR_FLOOR ? bailDrivenDrift(surface, H, star, { delayCost }) : null,
    };
    priced.push({
      h: H, n: curve.n, nIndep: curve.nIndep,
      refused: star.refused, atGridTop: star.atGridTop, atGridBottom: star.atGridBottom,
      ...quote,
      curve: curve.cells.map(c => ({ z: c.z, ask: c.ask, p: c.p, netWin: c.netWin, netBail: c.netBail, ev: c.ev })),
      surfaceThin: surface.thin[H] === true,
      thinReason: surface.thinReason[H] || null,
    });
  }

  const points = incumbentAsks({ stats, live, statsSeries, qty, nights, now });
  // The incumbents are placed at a horizon the SURFACE actually holds: placing them at a requested-but-
  // absent one silently renders a table of dashes under a header naming that horizon.
  const gridHs = surface.grid.map(r => r.h);
  const placeAt = gridHs.includes(24) ? 24 : (horizons.find(h => gridHs.includes(h)) ?? gridHs[0]);
  // ΔEV against the argmax at ONE horizon, so the plateau the band names is auditable cell by cell.
  // Its horizon is a PRICED one, not the incumbent placement horizon: --horizon 6 placed at 24 and
  // rendered a ΔEV@24h header over sixteen dashes, the exact defect the placement fallback avoids.
  const evRow = priced.find(pr => pr.h === placeAt && pr.curve) || priced.find(pr => pr.curve) || null;
  const bestEv = evRow ? Math.max(...evRow.curve.map(c => c.ev)) : null;
  const deltaEv = evRow ? evRow.curve.map(c => ({ z: c.z, deltaEv: c.ev - bestEv })) : null;
  const placed = points.map(pt => {
    if (pt.ask == null) return { ...pt, h: placeAt };
    const v = surfaceProb(surface, pt.ask, placeAt);
    return { ...pt, h: placeAt, z: v ? v.z : null, p: v ? v.p : null, thin: v ? v.thin : null, extrapolated: v ? v.extrapolated : null };
  });

  return {
    ...base,
    refused: null,
    surface: {
      refHigh: surface.refHigh, disp: surface.disp, dispMode: surface.dispMode,
      coveredDays: surface.coveredDays, spanDays: surface.spanDays, nOrigins: surface.nOrigins,
      strideH: surface.strideH, refN: surface.refN, zGrid: surface.zGrid,
      independentWindows: surface.independentWindows, thin: surface.thin, thinReason: surface.thinReason,
      maxCiHalfWidth: surface.maxCiHalfWidth, grainBias: surface.grainBias, shape: surface.shape,
    },
    grid: surface.grid.map(r => ({ h: r.h, n: r.n, nIndep: r.nIndep, cells: r.cells.map(c => ({ z: c.z, ask: surface.refHigh + c.z * surface.disp, p: c.p, thin: c.thin, ciHalf: c.ciHalf })) })),
    priced,
    placed,
    placedAtH: placeAt,
    deltaEvAtPlaceH: deltaEv,
    deltaEvH: evRow ? evRow.h : null,
    horizonRead: price != null ? horizonForAsk(surface, price, { pTarget }) : null,
    live: live ? { quickSell: live.quickSell, optSell: live.optSell, quickBuy: live.quickBuy, volDay: live.volDay } : null,
  };
}

/* The report as stdout lines. Separate from the build so the shape can be tested without a terminal. */
export function renderExitReport(rep) {
  const L = [];
  L.push('', `### ${rep.name} (${rep.itemId})`);
  if (rep.refused) {
    L.push('', `REFUSED — ${rep.refused}`);
    L.push('This is a refusal, not a price. Nothing below would be measured.');
    return L;
  }
  const s = rep.surface;
  L.push(`reference ${gp(s.refHigh)} (median of the last ${s.refN} daily highs) · dispersion ${gp(s.disp)} (IQR of ${rep.params.nights} daily highs, ${s.dispMode})`);
  L.push(`archive ${rep.coverage.days} day(s) with a high print over a ${rep.coverage.spanDays.toFixed(1)}d span · ${s.nOrigins} origins every ${s.strideH}h · reference window ${rep.params.nights} nights`);
  if (s.shape && s.shape.spread != null) {
    L.push(`flavor: z50 ${s.shape.z50.toFixed(2)} · z20 ${s.shape.z20.toFixed(2)} · spread ${s.shape.spread.toFixed(2)} → ${s.shape.label} (read the numbers, the label is a PLACEHOLDER cut)`);
  }

  L.push('', '**p(ask reached within H)** — ask levels in gp, p by horizon');
  const hs = rep.grid.map(r => r.h);
  const zs = rep.grid[0].cells.map(c => c.z);
  const dEv = new Map((rep.deltaEvAtPlaceH || []).map(e => [e.z, e.deltaEv]));
  const rows = zs.map((z, i) => [
    (z >= 0 ? '+' : '') + z,
    gp(rep.grid[0].cells[i].ask),
    ...rep.grid.map(r => {
      const c = r.cells[i];
      return c.p == null ? '—' : pct(c.p) + (c.thin ? ' ~' : '');
    }),
    dEv.has(z) ? (dEv.get(z) === 0 ? '**0**' : Math.round(dEv.get(z)).toLocaleString('en-US')) : '—',
  ]);
  L.push(mdTable(['z', 'ask', ...hs.map(h => h + 'h'), 'ΔEV@' + rep.deltaEvH + 'h'], rows));
  L.push(`\`~\` = the cell is wider than the ±${Math.round(s.maxCiHalfWidth * 100)}pp bound and must not be priced off. ΔEV is gp/unit against the ${rep.deltaEvH}h argmax.`);

  L.push('', '**The price** — argmax of EV(ask,H) = p·net(ask) + (1−p)·(net(bail) − delayCost)');
  for (const p of rep.priced) {
    if (p.unavailable) { L.push(`- ${p.h}h — ${p.unavailable}`); continue; }
    if (p.refused) { L.push(`- ${p.h}h — REFUSED: ${p.refused}`); continue; }
    const b = p.band;
    // The band's tolerance is a share of the scored EV RANGE, whose floor is the worst cell, so on a
    // dead curve it can reach a cell that never printed. Its endpoint reach is printed for that reason.
    const band = b && b.n > 1
      ? `band ${gp(b.loAsk)}–${gp(b.hiAsk)}, reach ${pct(b.loP)}→${pct(b.hiP)} (${b.n} cells within ${(b.tolFrac * 100).toFixed(0)}% of the scored EV range)`
      : 'no band — the argmax cell alone clears the tolerance';
    if (p.inversion) L.push(`⚠ ${p.inversion} — read that BEFORE the number below.`);
    L.push(`- **${p.h}h — ask ${gp(p.ask)}** (z ${p.z >= 0 ? '+' : ''}${p.z}, p ${pct(p.p)} ±${p.ciHalf != null ? Math.round(p.ciHalf * 100) : '?'}pp, ${p.nIndep} independent windows) · ${band}`);
    if (p.surfaceThin) L.push(`  ⚠ this horizon is THIN: ${p.thinReason}`);
    if (p.atGridBottom) L.push('  ⚠ the optimum is the LOWEST z scored — the grid may be too narrow below.');
    if (p.lowFill != null) {
      L.push(`  ⚠ the argmax reaches only ${pct(p.lowFill)} of the time. Two forces push it up and they are NOT the same claim: delayCost ${gp(rep.params.delayCost)} makes a miss cost little more than the bail, and the per-cell miss payoff RISES with the ask, crediting a high ask with a better consolation prize.`);
      if (p.bailDrift) {
        L.push(p.bailDrift.movesTheArgmax
          ? `  on THIS item the second force is the one doing the work: swap the per-cell bail for the TOP-CELL one and the argmax drops to ${gp(p.bailDrift.topAsk)} (z ${p.bailDrift.topZ >= 0 ? '+' : ''}${p.bailDrift.topZ}, p ${pct(p.bailDrift.topP)}).`
          : '  on THIS item the per-cell bail is NOT the cause: the top-cell bail leaves the argmax where it is, so the free wait and the curve shape carry it.');
      }
    }
    if (p.crossover) {
      const share = rep.surface.refHigh > 0 ? ` = ${(p.crossover.delayCost / rep.surface.refHigh * 100).toFixed(2)}% of the reference` : '';
      L.push(`  at delayCost ${gp(p.crossover.delayCost)}/unit${share} this answer changes to ${gp(p.crossover.toAsk)} (z ${p.crossover.toZ >= 0 ? '+' : ''}${p.crossover.toZ}, p ${pct(p.crossover.toP)}) — the cost of waiting that would have to be true. Read it against the price: a crossover worth a fraction of a percent is a fragile recommendation.`);
    }
  }
  L.push('Where a band is printed, any ask inside it is within the stated tolerance of the best EV; where none is, the tolerance is tighter than one grid step and the single cell IS the answer.');

  if (rep.horizonRead) {
    const hr = rep.horizonRead;
    L.push('', `**The horizon read** — how long to clear ${gp(hr.ask)} (z ${hr.z.toFixed(2)}) at p ≥ ${pct(hr.pTarget)}`);
    L.push(mdTable(['H', 'p', '±pp', 'n indep'], hr.byH.map(r => [r.h + 'h', pct(r.p) + (r.thin ? ' ~' : ''), r.ciHalf != null ? Math.round(r.ciHalf * 100) : '?', String(r.nIndep)])));
    L.push(hr.met ? `→ clears at **${hr.h}h** (p ${pct(hr.p)}).` : `→ never clears ${pct(hr.pTarget)} inside the scored horizons.`);
    if (hr.offGrid) L.push('⚠ this price sits off the scored z grid — p is CLAMPED at the edge, not extended.');
    L.push('This answers HOW LONG. It is not a price: a probability target ignores what the ask is worth, and was the worst pricing rule the gate tried at short horizons.');
  }

  if (rep.placed.length) {
    L.push('', `**The incumbents on one ruler** — each estimator's current ask, placed on this surface at ${rep.placedAtH}h`);
    L.push(mdTable(['estimator', 'ask', 'z', `p@${rep.placedAtH}h`, 'note'], rep.placed.map(p => [
      p.key,
      gp(p.ask),
      p.z == null ? '—' : (p.z >= 0 ? '+' : '') + p.z.toFixed(2),
      p.p == null ? '—' : pct(p.p) + (p.extrapolated ? ' (clamped)' : '') + (p.thin ? ' ~' : ''),
      p.note,
    ])));
  }

  const gb = s.grainBias;
  L.push('', '**Guards.**');
  L.push('- Reach is not fill: a level the market printed is not a lot that cleared. Every p bounds a real offer from ABOVE.');
  L.push(`- delayCost ${gp(rep.params.delayCost)}/unit and pTarget ${pct(rep.params.pTarget)} are OPERATOR-OWNED placeholders, not measured. They move the answer; change them and re-read.`);
  if (gb) {
    L.push(`- 1h-vs-5m grain: 5m coverage ${pct(gb.coverage)} over ${gb.eraDays.toFixed(0)}d, ${gb.measurable ? 'measurable' : 'NOT measurable — a ~0 delta here means unreadable, not unbiased'}. Reported, never applied.`);
  } else {
    L.push('- 1h-vs-5m grain: no overlapping 5m era, so the instrument bias is unmeasured here.');
  }
  L.push('- Inform-only: this gates nothing and prices no offer. Chunk 4 scores it against realized gp; until then it describes.');
  return L;
}

/* Everything the command writes to stdout, as lines. `json` is a RETURN, not a suffix: a JSON run emits
 * the objects and nothing else, so a caller piping it never has to strip a table. */
export function emitLines(reports, { json = false } = {}) {
  if (json) return [JSON.stringify(reports, null, 2)];
  const out = [];
  for (const rep of reports) out.push(...renderExitReport(rep));
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const A = parseArgs(argv);
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const v = argv[i + 1]; if (v !== undefined && !v.startsWith('--')) i++; continue; }
    positionals.push(a);
  }
  if (!positionals.length) {
    console.error('usage: node pipeline/commands/read-exit-surface.mjs "<item or id>" [...more] [--horizon 6,24,48] [--price <gp>] [--qty N] [--delay-cost <gp>] [--p-target 0.7] [--nights 14] [--json]');
    process.exit(1);
  }
  const JSON_ONLY = A.json !== undefined && A.json !== false;
  const horizons = A.horizon !== undefined && A.horizon !== true
    ? String(A.horizon).split(',').map(x => parseInt(x, 10)).filter(Number.isFinite)
    : DEFAULT_REPORT_HORIZONS;
  if (!horizons.length) { console.error('error: --horizon expects one or more integers, e.g. 6,24,48'); process.exit(1); }
  const offGrid = horizons.filter(h => !SURFACE_HORIZONS_H.includes(h));
  if (offGrid.length) { console.error('error: --horizon ' + offGrid.join(',') + ' is not on the surface grid (' + SURFACE_HORIZONS_H.join(',') + ')'); process.exit(1); }
  const price = A.price !== undefined ? parseGp(A.price) : null;
  if (A.price !== undefined && !(Number.isFinite(price) && price > 0)) { console.error('error: --price expects a positive gp amount'); process.exit(1); }
  const qty = A.qty !== undefined ? parseGp(A.qty) : null;
  if (A.qty !== undefined && (!Number.isFinite(qty) || qty <= 0)) { console.error('error: --qty expects a positive unit quantity'); process.exit(1); }
  const delayCost = A['delay-cost'] !== undefined ? parseGp(A['delay-cost']) : DEFAULT_DELAY_COST;
  if (A['delay-cost'] !== undefined && !Number.isFinite(delayCost)) { console.error('error: --delay-cost is not a parseable gp amount'); process.exit(1); }
  const pTarget = A['p-target'] !== undefined ? parseFloat(A['p-target']) : DEFAULT_P_TARGET;
  if (!(pTarget > 0 && pTarget <= 1)) { console.error('error: --p-target expects a fraction in (0,1]'); process.exit(1); }
  const nights = Math.max(2, parseInt(A.nights, 10) || 14);

  const map = await loadMapping();
  const db = openArchive(undefined, { readonly: true });
  const now = new Date();
  const reports = [];
  try {
    for (const want of positionals) {
      const r = map.resolve(want);
      if (!r) { reports.push({ name: want, itemId: null, refused: 'not found in the item mapping — check spelling or pass an id' }); continue; }
      const series = db.seriesFor(r.id, '1h');
      const fiveMin = db.seriesFor(r.id, '5m');
      let live = null;
      try {
        const inp = await fetchItemInputs(r.id);
        live = computeQuote({ ...inp, id: r.id, limit: map.byId[r.id]?.limit ?? null, asked: true });
      } catch { /* a live-quote failure costs the incumbent rows, never the surface */ }
      reports.push(buildExitReport({
        name: r.name, itemId: r.id, series, fiveMin: fiveMin.length ? fiveMin : null, live,
        opts: { horizons, price, qty, delayCost, pTarget, nights, now },
      }));
    }
  } finally { try { db.db.close(); } catch { /* a close failure must not mask the read */ } }

  const dump = writeLastReport('exit-surface', reports);   // written on EVERY path, --json included
  console.log(emitLines(reports, { json: JSON_ONLY }).join('\n'));
  if (!JSON_ONLY) console.log('\ndump: ' + dump);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
