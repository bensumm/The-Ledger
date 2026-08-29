#!/usr/bin/env node
/**
 * exit-ev.test.mjs — acceptance for js/exit-ev.mjs (PLAN-REACH-SURFACE chunk 2).
 *
 * Chunk 2 is arithmetic: there is nothing empirical to be wrong about, so its correctness IS this
 * suite. Hand-built surfaces for every property (the shape is small and explicit); the frozen
 * archive slice only for the assertions that must hold on real curves.
 *
 * BUSINESS REQUIREMENTS pinned here:
 *   - EV HAS AN INTERIOR MAXIMUM on a real curve. If the argmax always sits at an edge, EV cannot
 *     rank and the whole plan reduces to the monotone metric it was built to replace.
 *   - THE MISS PAYOFF IS PER-CELL — the conditional expectation the decomposition asks for. Its
 *     measured direction is the OPPOSITE of the intuition: at a low ask only a catastrophic window
 *     misses, so E[bail|miss] is WORST there and rises toward the unconditional value as the ask
 *     climbs. Per-cell therefore prices at or ABOVE the unconditional form.
 *   - net() IS THE ONE TAX DEFINITION, on BOTH branches. A tax asymmetry is 2% of price, larger
 *     than the whole EV spread being optimized over (0.4-3.7% of refHigh on these fixtures).
 *   - delayCost MOVES THE PRICE. Charged to both branches it is a constant at fixed H and cannot
 *     move the argmax at all — so a mutant that "fixes" the asymmetry must turn this suite red.
 *   - A MAXIMUM ON THE TOP GRID z IS A REFUSAL, not a price.
 *   - horizonForAsk RETURNS THE SMALLEST clearing horizon, and returns the full p-by-H row even
 *     when nothing clears.
 *
 * MUTATION-VERIFIED — every mutant below was applied to the source and observed RED. Groups abort on
 * the first failure, so a mutant may redden an earlier group than the one it targets; where that
 * happened the target group was confirmed red for it separately.
 *   bail-unconditional   per-cell bail replaced by the LOWEST cell's bail   -> per-cell-bail group
 *   bail-unconditional-2 per-cell bail replaced by the TOP cell's bail      -> per-cell-bail group
 *   tax-dropped          net() returns the raw price                       -> tax group
 *   tax-asymmetric       the bail leg left untaxed, the win leg taxed      -> tax group
 *   delay-both-branches  delayCost charged to the win branch too           -> delay-cost group
 *   argmax-edge          argmax replaced by highest-z-with-p               -> interior-max group
 *   gridtop-silent       grid-top refusal flag dropped                     -> grid-edge group
 *   gridbottom-silent    atGridBottom hardcoded false                      -> grid-bottom group
 *   scored-edge          grid edges read from the declared zGrid           -> scored-edge group
 *   askfor-lowest        askForHorizon returns the LOWEST clearing level   -> ask-for-horizon group
 *   horizon-largest      horizonForAsk returns the LAST clearing H         -> round-trip group
 *
 * TWO GROUPS ASSERT PROPERTIES OF THE DATA as well as the code — the interior-max and non-monotone
 * groups read the shared frozen fixture, so regenerating it can redden chunk 2 for reasons that have
 * nothing to do with chunk-2 code. Both still have real code power (argmax-edge takes the interior
 * count from 3 to 0), but read a failure there as "check the fixture era" first.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildReachSurface } from '../../js/reach-surface.mjs';
import { evCurve, askStar, askForHorizon, horizonForAsk, DEFAULT_P_TARGET } from '../../js/exit-ev.mjs';
import { tax } from '../../js/money-math.js';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'reach-surface.json'), 'utf8'));
const unpack = rows => rows.map(([ts, avgHighPrice, avgLowPrice]) => ({ ts, avgHighPrice, avgLowPrice, highPriceVolume: 1, lowPriceVolume: 1 }));
const built = rows => {
  const series = unpack(rows);
  return buildReachSurface(series, { now: new Date((series.at(-1).ts + 3600) * 1000) });
};

/* A surface literal: only the fields the inversions read. Explicit beats generated here — every
 * limiting case below is a statement about ONE curve, and a generator would hide which. */
const surf = (zGrid, ps, { refHigh = 10000, disp = 1000, bailZ = -1, h = 24, nIndep = 40 } = {}) => ({
  refHigh, disp, zGrid: [...zGrid],
  grid: [{
    h, n: nIndep, nIndep,
    cells: zGrid.map((z, i) => ({
      z, p: ps[i], thin: false, ciHalf: 0.05,
      bailZOnMiss: typeof bailZ === 'function' ? bailZ(z) : bailZ,
    })),
  }],
});

const Z = [-1, -0.5, 0, 0.5, 1, 2, 3];

// --- limiting cases -----------------------------------------------------------------------------

ok('p identically 1 puts askStar on the HIGHEST z — and calls it a refusal, not a price', () => {
  const s = surf(Z, Z.map(() => 1));
  const r = askStar(s, 24);
  assert.equal(r.z, 3, 'with certainty everywhere the best ask is the highest one scored');
  assert.ok(r.atGridTop, 'and it sits on the grid edge');
  assert.match(r.refused, /grid-top/, 'a maximum at the last z scored is a refusal to price');
});

ok('delayCost -> huge collapses askStar to the LOWEST z — the miss branch is what waiting costs', () => {
  const s = surf(Z, [1, 0.95, 0.8, 0.6, 0.4, 0.15, 0.05]);
  const free = askStar(s, 24, { delayCost: 0 });
  const costly = askStar(s, 24, { delayCost: 1e9 });
  assert.equal(costly.z, -1, 'an unbounded miss cost maximizes p, which is the lowest z');
  assert.ok(costly.z < free.z, 'and it must move the price DOWN from the free-wait optimum');
});

ok('askStar is unmoved by delayCost when p is 1 everywhere — nothing can miss, so nothing is charged', () => {
  const s = surf(Z, Z.map(() => 1));
  assert.equal(askStar(s, 24, { delayCost: 1e9 }).z, askStar(s, 24, { delayCost: 0 }).z);
});

// --- the per-cell miss payoff -------------------------------------------------------------------

ok('the miss payoff is PER-CELL, and on real curves that prices at or ABOVE the unconditional form', () => {
  // On a REAL curve, not a synthetic: an earlier version of this group used an invented DECREASING
  // bail and asserted the opposite direction. E[bail|miss] rises with the ask, because at a low ask
  // only a catastrophic window misses while at a high ask nearly everything does.
  let strictlyAbove = 0, cells = 0;
  for (const it of Object.values(FIX.curve)) {
    const s = built(it.h1);
    for (const H of [6, 24, 48]) {
      const bails = s.grid.find(r => r.h === H).cells.map(c => c.bailZOnMiss).filter(v => v != null);
      const unconditional = bails[bails.length - 1];      // the top cell: nearly every window misses there
      assert.ok(bails[0] < unconditional,
        `${it.name} H=${H}: the bail must be WORST at the lowest ask (got ${bails[0]} vs ${unconditional})`);
      const perCell = askStar(s, H);
      const uncond = askStar(s, H, { bailNet: (s.refHigh + unconditional * s.disp) * 0.98 });
      assert.ok(perCell.z >= uncond.z,
        `${it.name} H=${H}: per-cell must not price BELOW the unconditional form (${perCell.z} vs ${uncond.z})`);
      if (perCell.z > uncond.z) strictlyAbove++;
      cells++;
    }
  }
  assert.ok(strictlyAbove >= 3, `the two forms must actually differ somewhere (${strictlyAbove} of ${cells})`);
});

ok('net() is the ONE tax definition, applied to the win AND the bail leg', () => {
  const s = surf(Z, [1, 0.9, 0.7, 0.5, 0.3, 0.1, 0.02], { refHigh: 10000, disp: 1000, bailZ: -0.5 });
  for (const c of evCurve(s, 24).cells) {
    assert.equal(c.netWin, c.ask - tax(c.ask), `win leg untaxed at z=${c.z}`);
    assert.equal(c.netBail, 9500 - tax(9500), `bail leg untaxed at z=${c.z}`);
  }
});

ok('a cell with no bail and p<1 is DROPPED, not scored against an invented payoff', () => {
  const s = surf(Z, [1, 0.9, 0.7, 0.5, 0.3, 0.1, 0.02], { bailZ: null });
  const curve = evCurve(s, 24);
  assert.deepEqual(curve.cells.map(c => c.z), [-1], 'only the p=1 cell survives, where the bail weight is 0');
});

// --- the interior maximum, on real curves --------------------------------------------------------

ok('EV has an INTERIOR maximum on the fixture items — the property the monotone metric lacked', () => {
  const interior = [];
  for (const it of Object.values(FIX.curve)) {
    const name = it.name;
    const r = askStar(built(it.h1), 24);
    assert.ok(r, `${name}: askStar must produce a cell`);
    assert.ok(r.curve.length > 3, `${name}: too few scorable cells to speak of a maximum`);
    if (!r.atGridTop && !r.atGridBottom) interior.push(name);
  }
  assert.ok(interior.length >= 2,
    `at least two of the three fixture items must maximize strictly inside the grid (got ${interior.join(', ') || 'none'})`);
});

ok('EV is NON-MONOTONE in the ask on a real curve — it rises then falls', () => {
  const ranarr = Object.values(FIX.curve).find(it => it.name === 'Ranarr weed');
  const evs = evCurve(built(ranarr.h1), 24).cells.map(c => c.ev);
  const up = evs.slice(1).some((v, i) => v > evs[i]);
  const down = evs.slice(1).some((v, i) => v < evs[i]);
  assert.ok(up && down, 'a metric monotone in price cannot rank; EV must do both');
});

// --- horizonForAsk / askForHorizon ----------------------------------------------------------------

ok('askForHorizon returns the HIGHEST clearing level, not merely a clearing one', () => {
  const s = surf(Z, [1, 0.95, 0.9, 0.85, 0.3, 0.1, 0.02]);
  const a = askForHorizon(s, 24, 0.7);
  assert.equal(a.z, 0.5, 'z=0.5 clears at 0.85; every lower level clears too and must lose');
  assert.equal(a.ask, 10500);
  assert.equal(askForHorizon(surf(Z, [0.9, 0.8, 0.7, 0.6, 0.3, 0.1, 0.02]), 24, 0.95), null,
    'nothing clears -> null, not the nearest');
});

ok('atGridBottom marks the low edge — the counterpart of the grid-top refusal', () => {
  const s = surf(Z, [1, 0.95, 0.8, 0.6, 0.4, 0.15, 0.05]);
  const low = askStar(s, 24, { delayCost: 1e9 });
  assert.equal(low.atGridBottom, true);
  assert.equal(low.atGridTop, false);
  const high = askStar(surf(Z, Z.map(() => 1)), 24);
  assert.equal(high.atGridBottom, false);
  assert.equal(high.atGridTop, true);
});

ok('round trip: horizonForAsk(askForHorizon(H, pTarget)) never exceeds H', () => {
  for (const it of Object.values(FIX.curve)) {
    const name = it.name;
    const s = built(it.h1);
    for (const H of s.grid.map(r => r.h)) {
      const a = askForHorizon(s, H, DEFAULT_P_TARGET);
      if (!a) continue;
      const back = horizonForAsk(s, a.ask, { pTarget: DEFAULT_P_TARGET });
      assert.ok(back.met, `${name} H=${H}: the ask that cleared at H must clear at some horizon`);
      assert.ok(back.h <= H, `${name} H=${H}: got ${back.h}, which is LARGER — horizonForAsk must return the smallest`);
    }
  }
});

ok('horizonForAsk returns the full p-by-H row even when NOTHING clears — the threshold never travels alone', () => {
  const s = surf(Z, [0.4, 0.3, 0.2, 0.1, 0.05, 0.01, 0]);
  const r = horizonForAsk(s, 12000, { pTarget: 0.9 });
  assert.equal(r.met, false);
  assert.equal(r.h, null);
  assert.equal(r.byH.length, 1, 'the row is present regardless');
  assert.ok(Number.isFinite(r.byH[0].p), 'and it carries the number the threshold was compared against');
});

ok('an ask past the last z is flagged offGrid rather than extrapolated into a number', () => {
  const s = surf(Z, [1, 0.9, 0.7, 0.5, 0.3, 0.1, 0.02]);
  assert.equal(horizonForAsk(s, 10000 + 5 * 1000, {}).offGrid, true);
  assert.equal(horizonForAsk(s, 10000 + 0.5 * 1000, {}).offGrid, false);
});

ok('the grid edges are the SCORED ones — a dropped top cell still counts as the edge', () => {
  // The top z has p<1 and no bail, so evCurve drops it. The optimum then sits on the last SCORABLE
  // cell, which is still "past the end of what we know" and must refuse.
  const cells = [-1, -0.5, 0, 0.5, 1, 2, 3].map((z, i) => ({
    z, p: i === 6 ? 0.5 : 1, thin: false, ciHalf: 0.05, bailZOnMiss: i === 6 ? null : -1,
  }));
  const s = { refHigh: 10000, disp: 1000, zGrid: [...Z], grid: [{ h: 24, n: 40, nIndep: 40, cells }] };
  const r = askStar(s, 24);
  assert.equal(r.z, 2, 'the p<1 top cell is unscorable, so z=2 is the last scored level');
  assert.ok(r.atGridTop, 'and the optimum sitting there is still a grid edge');
  assert.match(r.refused, /grid-top/);
});

ok('an ask at or below zero is dropped rather than priced — a deep z on a cheap item', () => {
  const s = surf(Z, Z.map(() => 0.9), { refHigh: 400, disp: 1000 });   // z=-1 puts the ask at -600
  const cells = evCurve(s, 24).cells;
  assert.ok(cells.every(c => c.ask > 0), 'no non-positive ask may reach the EV curve');
  assert.ok(cells.length < Z.length, 'and the offending levels must actually have been dropped');
});

ok('horizonForAsk reads horizons in ASCENDING order regardless of grid order', () => {
  const mk = h => ({ h, n: 40, nIndep: 40, cells: Z.map(z => ({ z, p: h >= 24 ? 0.9 : 0.2, thin: false, ciHalf: 0.05, bailZOnMiss: -1 })) });
  const s = { refHigh: 10000, disp: 1000, zGrid: [...Z], grid: [mk(48), mk(6), mk(24)] };
  assert.equal(horizonForAsk(s, 10000, { pTarget: 0.7 }).h, 24, 'the SMALLEST clearing horizon, not the first row listed');
  assert.deepEqual(horizonForAsk(s, 10000, {}).byH.map(r => r.h), [6, 24, 48]);
});

// --- degenerate inputs ----------------------------------------------------------------------------

ok('a surface with no dispersion prices nothing rather than dividing by zero', () => {
  const s = surf(Z, Z.map(() => 0.5), { disp: 0 });
  assert.equal(askStar(s, 24), null);
  assert.equal(horizonForAsk(s, 10000, {}), null);
  assert.equal(askForHorizon(s, 24), null);
});

ok('a horizon absent from the grid returns null, not the nearest one', () => {
  const s = surf(Z, Z.map(() => 0.5));
  assert.equal(askStar(s, 999), null);
  assert.equal(askForHorizon(s, 999), null);
});

console.log(`  ${pass} assertion group(s) passed`);
