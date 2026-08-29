/* exit-ev.mjs — the inversions that turn a reach surface into a PRICE (PLAN-REACH-SURFACE ch.2).
 *
 * EV(ask,H) = p(ask,H)·net(ask) + (1−p(ask,H))·(net(bail) − delayCost) — not monotone in the ask,
 * so it has an interior maximum and can rank, which the co-log scorer could not.
 *
 * Three things here are counter-intuitive and each has a killed mutant in the suite: delayCost is
 * charged to the MISS branch ONLY (on both it is a constant at fixed H and moves nothing); the miss
 * payoff is per-cell, which prices at or ABOVE the unconditional form rather than below; and a
 * maximum on the last SCORED z is a refusal, not a price. Why, and the measured directions:
 * README's `exit-ev.mjs` entry.
 */
import { tax } from './money-math.js';
import { surfaceProb } from './reach-surface.mjs';

export const DEFAULT_P_TARGET = 0.7;   // PLACEHOLDER, operator-owned
export const DEFAULT_DELAY_COST = 0;   // PLACEHOLDER, operator preference

const netOf = px => (Number.isFinite(px) ? px - tax(px) : null);
const rowAt = (surface, H) => surface?.grid?.find(r => r.h === H) || null;
const priceAt = (surface, z) => surface.refHigh + z * surface.disp;

/* Every scorable cell of one horizon, ask in gp. A cell with no bail and p < 1 is dropped rather
 * than scored against an invented payoff. */
// @provisional-api: consumed by PLAN-REACH-SURFACE chunk 3 (read-exit-surface.mjs) and chunk 4.
export function evCurve(surface, H, { bailNet = null, delayCost = DEFAULT_DELAY_COST } = {}) {
  const row = rowAt(surface, H);
  if (!row || !Number.isFinite(surface.refHigh) || !(surface.disp > 0)) return null;
  const out = [];
  for (const c of row.cells) {
    if (c.p == null) continue;
    const ask = priceAt(surface, c.z);
    if (!(ask > 0)) continue;
    const win = netOf(ask);
    if (win == null) continue;
    let bail = bailNet;
    if (bail == null && c.bailZOnMiss != null) bail = netOf(priceAt(surface, c.bailZOnMiss));
    if (bail == null) { if (c.p < 1) continue; bail = 0; }
    out.push({
      z: c.z, ask, p: c.p, thin: c.thin, ciHalf: c.ciHalf,
      netWin: win, netBail: bail,
      ev: c.p * win + (1 - c.p) * (bail - delayCost),
    });
  }
  return out.length ? { h: H, n: row.n, nIndep: row.nIndep, cells: out } : null;
}

/* argmax EV over the z grid. Returns the winning cell plus the refusal flags a consumer must print. */
// @provisional-api: consumed by PLAN-REACH-SURFACE chunk 3 and scored by chunk 4.
export function askStar(surface, H, opts = {}) {
  const curve = evCurve(surface, H, opts);
  if (!curve) return null;
  let best = curve.cells[0];
  for (const c of curve.cells) if (c.ev > best.ev) best = c;
  // the edges of what was SCORED, not of the declared grid: a dropped cell would otherwise let an
  // optimum at the last scorable z pass as interior.
  const topZ = curve.cells[curve.cells.length - 1].z;
  const botZ = curve.cells[0].z;
  return {
    ...best, h: H, n: curve.n, nIndep: curve.nIndep,
    atGridTop: best.z === topZ,
    atGridBottom: best.z === botZ,
    refused: best.z === topZ ? 'grid-top: the optimum is past the last z scored — widen the grid, do not quote this'
      : best.thin ? 'thin: the winning cell is wider than the surface bound' : null,
    curve: curve.cells,
  };
}

/* The highest grid ask whose p at H clears pTarget. ITS `ask` IS NOT A PRICE — a probability target
 * ignores what the ask is worth, and PLAN-REACH-SURFACE §1c measured it as the worst rule tried at
 * short horizons. Round-trip partner of `horizonForAsk`; do not print its `ask`. */
// @provisional-api: the round-trip partner of horizonForAsk (PLAN-REACH-SURFACE chunk 3).
export function askForHorizon(surface, H, pTarget = DEFAULT_P_TARGET) {
  const row = rowAt(surface, H);
  if (!row || !Number.isFinite(surface.refHigh) || !(surface.disp > 0)) return null;
  let best = null;
  for (const c of row.cells) if (c.p != null && c.p >= pTarget && (!best || c.z > best.z)) best = c;
  return best ? { z: best.z, ask: priceAt(surface, best.z), p: best.p, thin: best.thin } : null;
}

/* The smallest grid horizon whose p at this ask clears pTarget, WITH the full p-by-H row — the
 * threshold never travels alone, and `met:false` still returns the row. Reads p through
 * `surfaceProb`, the ONE interpolation, so every row carries its `ciHalf`. */
// @provisional-api: consumed by PLAN-REACH-SURFACE chunk 3 (--price).
export function horizonForAsk(surface, ask, { pTarget = DEFAULT_P_TARGET } = {}) {
  if (!surface?.grid?.length || !Number.isFinite(ask) || !Number.isFinite(surface.refHigh) || !(surface.disp > 0)) return null;
  const z = (ask - surface.refHigh) / surface.disp;
  const byH = [];
  for (const row of [...surface.grid].sort((a, b) => a.h - b.h)) {
    const v = surfaceProb(surface, ask, row.h);
    if (v) byH.push({ h: row.h, p: v.p, thin: v.thin, ciHalf: v.ciHalf, extrapolated: v.extrapolated, nIndep: row.nIndep });
  }
  const hit = byH.find(r => r.p >= pTarget) || null;
  return {
    z, ask, pTarget, byH,
    h: hit ? hit.h : null,
    p: hit ? hit.p : null,
    met: !!hit,
    offGrid: byH.some(r => r.extrapolated),
  };
}
