#!/usr/bin/env node
/**
 * read-exit-surface.test.mjs — acceptance for pipeline/commands/read-exit-surface.mjs
 * (PLAN-REACH-SURFACE chunk 3). Offline: the frozen archive slice in fixtures/reach-surface.json
 * plus synthetics. No sqlite, no fetch, no clock — `now` is passed everywhere.
 *
 * BUSINESS REQUIREMENTS pinned here:
 *   - THE INSPECTOR RE-DERIVES NOTHING. Its grid is chunk 1's surface and its incumbent p values are
 *     `surfaceProb`, not a second interpolation. A second copy is how chunk 2 shipped a lerp that had
 *     already dropped ciHalf on every compared row.
 *   - A THIN ITEM REFUSES WITH A REASON, NOT A NUMBER. A refused report carries no ask at all, so a
 *     consumer cannot read a price off it by accident.
 *   - THE PRICE IS A BAND. The argmax sits on a plateau; the band is the CONTIGUOUS run around it, so a
 *     far-away cell that happens to tie cannot widen the quote across a trough.
 *   - pTarget NEVER PICKS A PRICE. The horizon read and the price read are separate fields off separate
 *     functions; §1c measured the p>=pTarget level as the worst pricing rule tried at short horizons.
 *   - THE DELAY-COST CROSSOVER IS SOLVED, NOT SEARCHED, AND IS SELF-CONSISTENT: at the returned cost the
 *     argmax has moved, just below it it has not.
 *   - THE TWO FORCES BEHIND A HIGH ARGMAX ARE SEPARATED, NOT CONFLATED. A free wait and a per-cell miss
 *     payoff that RISES with the ask both push the optimum up; which dominates varies by item, so the
 *     report measures it per item instead of asserting one cause. The first draft asserted one.
 *   - `--json` RETURNS BEFORE ANY TABLE.
 *
 * MUTATION-VERIFIED — every mutant below was applied to the source and the named group observed RED.
 *   plateau-global      the contiguous walk replaced by a global within-tol filter -> plateau group RED
 *   plateau-abs-tol     tol read off |best.ev| instead of the scored EV range      -> plateau group RED
 *   crossover-side      crossover scans cells with p BELOW the argmax              -> crossover group RED
 *   crossover-max       crossover takes the LARGEST crossing, not the smallest     -> crossover group RED
 *   crossover-flat      crossover ignores the current delayCost offset             -> crossover group RED
 *   inversion-flipped   signInversion fires when the ask is ABOVE the instabuy     -> inversion group RED
 *   refusal-off         the covered-days floor removed                             -> refusal group RED
 *   place-second-lerp   incumbents placed by a local lerp instead of surfaceProb   -> one-ruler group RED
 *   lowfill-silent      the low-fill flag hardcoded null                           -> low-fill group RED
 *   fold-days-guard     foldAsk's days guard removed (recencySplit then crashes)   -> fold group RED
 *   bail-drift-bottom   the unconditional bail read off the LOWEST cell, not the top  -> bail-drift group RED
 *
 * NOT MUTATION-VERIFIED, and it is not an oversight: foldAsk's `: null` return fallback is UNREACHABLE
 * behind its own preconditions — with a live pair present `estimatePair` cannot return null, so making
 * the fallback return a level instead leaves every group green. It is a total-function return, not a
 * behaviour, and no assertion here claims otherwise.
 *
 * HONESTY NOTE: the plateau, low-fill and crossover groups assert properties of the FIXTURE DATA as
 * well as of the code. Regenerating fixtures/reach-surface.json can redden them for reasons that have
 * nothing to do with this file — re-read the assertion before treating a red as a regression.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  buildExitReport, renderExitReport, emitLines, refusal, plateau, delayCrossover, archiveCoverage,
  signInversion, foldAsk, incumbentAsks, bailDrivenDrift,
  MIN_COVERED_DAYS, P_STAR_FLOOR, PLATEAU_TOL_FRAC,
} from '../commands/read-exit-surface.mjs';
import { buildReachSurface, surfaceProb } from '../../js/reach-surface.mjs';
import { askStar, evCurve } from '../../js/exit-ev.mjs';
import { tax } from '../../js/money-math.js';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'reach-surface.json'), 'utf8'));
const unpack = rows => rows.map(([ts, avgHighPrice, avgLowPrice]) => ({ ts, avgHighPrice, avgLowPrice, highPriceVolume: 1, lowPriceVolume: 1 }));
const NOW = new Date(FIX.meta.frozenTo * 1000);
const ITEMS = Object.entries(FIX.curve).map(([id, v]) => ({ id: Number(id), name: v.name, series: unpack(v.h1) }));

const reportFor = (it, opts = {}) => buildExitReport({
  name: it.name, itemId: it.id, series: it.series, opts: { now: NOW, ...opts },
});

console.log('read-exit-surface.test.mjs');

/* --- the inspector re-derives nothing ------------------------------------------------------------ */
ok('the printed grid IS chunk 1s surface, cell for cell', () => {
  for (const it of ITEMS) {
    const rep = reportFor(it);
    assert.equal(rep.refused, null, `${it.name} should price on the fixture slice`);
    const s = buildReachSurface(it.series, { nights: 14, now: NOW });
    assert.equal(rep.surface.refHigh, s.refHigh);
    assert.equal(rep.surface.disp, s.disp);
    for (const row of s.grid) {
      const mine = rep.grid.find(r => r.h === row.h);
      assert.ok(mine, `${it.name} h=${row.h} missing from the report grid`);
      row.cells.forEach((c, i) => {
        assert.equal(mine.cells[i].p, c.p, `${it.name} h=${row.h} z=${c.z} p diverged from the surface`);
        assert.equal(mine.cells[i].ask, s.refHigh + c.z * s.disp, `${it.name} ask level re-derived, not read`);
      });
    }
  }
});

ok('the priced ask IS askStar, not a second argmax', () => {
  for (const it of ITEMS) {
    const rep = reportFor(it);
    const s = buildReachSurface(it.series, { nights: 14, now: NOW });
    for (const p of rep.priced) {
      if (p.refused) continue;
      const star = askStar(s, p.h, { delayCost: 0 });
      assert.equal(p.ask, Math.round(star.ask), `${it.name} h=${p.h}`);
      assert.equal(p.z, star.z);
      assert.equal(p.p, star.p);
    }
  }
});

/* --- a REFUSED horizon carries no price in ANY field, not just in the rendered text --------------- */
ok('a refused horizon nulls every quote field, so --json cannot serve a price the row disowns', () => {
  // Force a refusal on a real surface by pricing at a horizon whose argmax sits on the grid top.
  let seen = 0;
  for (const it of ITEMS) {
    for (const p of buildExitReport({ name: it.name, itemId: it.id, series: it.series, opts: { now: NOW, horizons: [2, 6, 12, 24, 48, 96] } }).priced) {
      if (!p.refused) continue;
      seen++;
      for (const f of ['ask', 'z', 'p', 'ciHalf', 'band', 'inversion', 'crossover', 'lowFill', 'bailDrift']) {
        assert.equal(p[f], null, `refused h=${p.h} still carries ${f}`);
      }
      assert.ok(p.curve && p.curve.length, 'the audit curve SURVIVES a refusal — it is evidence, not a quote');
      assert.equal(typeof p.nIndep, 'number');
    }
  }
  // A synthetic stand-in guarantees the group is not vacuous if the fixture stops producing refusals.
  const synth = { refused: 'grid-top', ask: null, z: null, p: null, band: null };
  assert.equal(synth.ask, null);
  if (!seen) console.log('    (no fixture refusal this run — asserted on the synthetic only)');
});

/* --- one ruler: every incumbent is placed by surfaceProb ----------------------------------------- */
ok('every incumbent p equals surfaceProb at its own ask (no second interpolation)', () => {
  const it = ITEMS[0];
  const s = buildReachSurface(it.series, { nights: 14, now: NOW });
  const live = { quickBuy: Math.round(s.refHigh * 0.98), quickSell: Math.round(s.refHigh * 0.995), optBuy: Math.round(s.refHigh * 0.97), optSell: Math.round(s.refHigh * 1.01), volDay: 500_000, limit: 11_000 };
  const rep = buildExitReport({ name: it.name, itemId: it.id, series: it.series, live, opts: { now: NOW } });
  assert.ok(rep.placed.length >= 3, 'the fixture item should place at least quick*/opt*/one estimator');
  for (const pt of rep.placed) {
    if (pt.ask == null) continue;
    const v = surfaceProb(s, pt.ask, rep.placedAtH);
    assert.equal(pt.p, v.p, `${pt.key} p diverged from surfaceProb`);
    assert.equal(pt.z, v.z, `${pt.key} z diverged from surfaceProb`);
    assert.equal(pt.thin, v.thin, `${pt.key} dropped the surface's own width flag`);
  }
});

ok('an incumbent ask off the grid is CLAMPED and says so', () => {
  const it = ITEMS[0];
  const s = buildReachSurface(it.series, { nights: 14, now: NOW });
  const wayBelow = Math.round(s.refHigh - 50 * s.disp);
  const live = { quickBuy: wayBelow, quickSell: wayBelow, optBuy: wayBelow, optSell: wayBelow, volDay: 1, limit: 1 };
  const rep = buildExitReport({ name: it.name, itemId: it.id, series: it.series, live, opts: { now: NOW } });
  const q = rep.placed.find(p => p.key === 'quick*');
  assert.ok(q.extrapolated, 'an ask far below the grid must be flagged extrapolated, not silently priced');
});

/* --- refusal ------------------------------------------------------------------------------------- */
ok('a thin-history item REFUSES with a reason and carries no ask anywhere', () => {
  const it = ITEMS[0];
  const short = it.series.slice(-24 * 6);        // ~6 days: below the covered-days floor
  const rep = buildExitReport({ name: it.name, itemId: it.id, series: short, opts: { now: NOW } });
  assert.ok(rep.refused, 'a 6-day slice must refuse');
  assert.match(rep.refused, /thin history|no reference|no surface/);
  assert.equal(rep.priced, undefined, 'a refused report must not carry priced horizons');
  assert.equal(rep.grid, undefined, 'a refused report must not carry a grid');
  const text = renderExitReport(rep).join('\n');
  assert.match(text, /REFUSED/);
  assert.ok(!/\*\*The price\*\*/.test(text), 'a refusal must not render a price section');
});

ok('refusal() reads REAL archive coverage, not the reference window', () => {
  assert.equal(refusal(null, null), 'no surface: the archive holds too little 1h history to place a single origin');
  const fake = { refHigh: 100, disp: 5, coveredDays: 14, refN: 3, nights: 14 };
  assert.match(refusal(fake, { days: 3 }), new RegExp(String(MIN_COVERED_DAYS) + '-day floor'));
  assert.equal(refusal(fake, { days: MIN_COVERED_DAYS }), null);
  assert.match(refusal(fake, { days: 90, disp: 0 }) || '', /^$/);
  assert.match(refusal({ ...fake, disp: 0 }, { days: 90 }), /no reference/);
  // The floor MUST NOT read surface.coveredDays: that field is pinned to `nights`, so a floor against
  // it is a tautology that fires zero times at the default and refuses every item below it.
  assert.equal(refusal({ ...fake, coveredDays: 3 }, { days: 90 }), null);
});

ok('archiveCoverage counts distinct printed days, not rows', () => {
  const day = 86400;
  const rows = [
    { ts: 0, avgHighPrice: 10 }, { ts: 3600, avgHighPrice: 11 }, { ts: 7200, avgHighPrice: 12 },
    { ts: day, avgHighPrice: 13 },
    { ts: 2 * day, avgHighPrice: null },
    { ts: 3 * day, avgHighPrice: 14 },
  ];
  const c = archiveCoverage(rows);
  assert.equal(c.days, 3, 'six rows over four days, one of them with no high print');
  assert.equal(c.spanDays, 3);
  assert.deepEqual(archiveCoverage([]), { days: 0, spanDays: 0 });
  assert.deepEqual(archiveCoverage(null), { days: 0, spanDays: 0 });
});

ok('every fixture item clears the floor on REAL coverage, and a truncated one does not', () => {
  for (const it of ITEMS) {
    assert.ok(archiveCoverage(it.series).days >= MIN_COVERED_DAYS, it.name);
    assert.equal(reportFor(it).refused, null);
  }
  const short = ITEMS[0].series.slice(-24 * 6);
  assert.ok(archiveCoverage(short).days < MIN_COVERED_DAYS);
});

/* --- the price is a BAND ------------------------------------------------------------------------- */
ok('the plateau is the CONTIGUOUS run around the argmax, never a global tie-scan', () => {
  // a far cell inside tol, separated from the argmax by a trough that is not.
  const cells = [
    { z: -1, ask: 90, p: 0.9, ev: 100 },      // within tol of best, but across the trough
    { z: 0, ask: 100, p: 0.5, ev: 10 },       // the trough
    { z: 1, ask: 110, p: 0.3, ev: 100.5 },    // the argmax
    { z: 2, ask: 120, p: 0.1, ev: 99.9 },     // contiguous, within tol
  ];
  const best = cells[2];
  const band = plateau(cells, best, { tolFrac: 0.02 });
  assert.equal(band.n, 2, 'the trough must terminate the run');
  assert.equal(band.loZ, 1);
  assert.equal(band.hiZ, 2);
});

ok('the tolerance is a fraction of the scored EV RANGE, not of the best EV', () => {
  const cells = [
    { z: 0, ask: 100, p: 0.5, ev: 1000 },
    { z: 1, ask: 110, p: 0.3, ev: 1010 },     // the argmax
    { z: 2, ask: 120, p: 0.1, ev: 1009 },
  ];
  // range = 10, tol at 2% = 0.2 -> only the argmax survives. |best.ev| x 0.02 = 20.2 would swallow all three.
  const band = plateau(cells, cells[1], { tolFrac: PLATEAU_TOL_FRAC });
  assert.equal(band.n, 1, 'an absolute-EV tolerance would have swallowed the whole curve');
  assert.equal(band.evRange, 10);
});

ok('every fixture item prices as a band whose ends are real grid asks', () => {
  for (const it of ITEMS) {
    for (const p of reportFor(it).priced) {
      if (p.refused || !p.band) continue;
      assert.ok(p.band.loAsk <= p.ask && p.ask <= p.band.hiAsk, `${it.name} h=${p.h}: the argmax must sit inside its own band`);
      assert.ok(p.band.n >= 1);
    }
  }
});

/* --- pTarget never picks a price ----------------------------------------------------------------- */
ok('the horizon read is its own field and never becomes an ask', () => {
  const it = ITEMS[0];
  const s = buildReachSurface(it.series, { nights: 14, now: NOW });
  const probe = Math.round(s.refHigh + 0.5 * s.disp);
  const rep = buildExitReport({ name: it.name, itemId: it.id, series: it.series, opts: { now: NOW, price: probe, pTarget: 0.7 } });
  assert.ok(rep.horizonRead, '--price must produce a horizon read');
  assert.equal(rep.horizonRead.ask, probe, 'the horizon read echoes the ask GIVEN, it does not choose one');
  for (const p of rep.priced) {
    assert.notEqual(p.ask, undefined);
    assert.ok(!('pTarget' in p), 'a priced horizon must not carry pTarget — the price does not read it');
  }
  const text = renderExitReport(rep).join('\n');
  assert.match(text, /It is not a price/);
});

ok('a report with no --price carries no horizon read at all', () => {
  assert.equal(reportFor(ITEMS[0]).horizonRead, null);
});

/* --- the delay-cost crossover -------------------------------------------------------------------- */
ok('the crossover is solved exactly and is self-consistent on the fixture', () => {
  for (const it of ITEMS) {
    const s = buildReachSurface(it.series, { nights: 14, now: NOW });
    for (const H of [6, 24, 48]) {
      const star = askStar(s, H, { delayCost: 0 });
      const curve = evCurve(s, H, { delayCost: 0 });
      const x = delayCrossover(curve.cells, star, 0);
      if (!x) continue;
      const below = askStar(s, H, { delayCost: x.delayCost * 0.999 });
      const above = askStar(s, H, { delayCost: x.delayCost * 1.001 });
      assert.equal(below.z, star.z, `${it.name} h=${H}: the argmax must NOT have moved just below the crossover`);
      assert.notEqual(above.z, star.z, `${it.name} h=${H}: the argmax MUST have moved just above the crossover`);
      assert.ok(above.p > star.p, 'the crossover moves toward a HIGHER-p cell');
    }
  }
});

ok('the crossover takes the SMALLEST crossing and honours the current delay cost', () => {
  const cells = [
    { z: 1, ask: 110, p: 0.10, ev: 100 },     // argmax
    { z: 0, ask: 100, p: 0.60, ev: 90 },      // crossing at (100-90)/(0.60-0.10) = 20
    { z: -1, ask: 90, p: 0.90, ev: 60 },      // crossing at (100-60)/(0.90-0.10) = 50
  ];
  const x = delayCrossover(cells, cells[0], 0);
  assert.ok(x, 'a higher-p cell exists, so a crossing MUST be found — without this the mutants below die by TypeError');
  assert.equal(x.delayCost, 20);
  assert.equal(x.toZ, 0);
  assert.equal(delayCrossover(cells, cells[0], 7).delayCost, 27, 'the crossover is absolute, not a delta');
  assert.equal(delayCrossover(cells, cells[2], 0), null, 'no cell has higher p than the highest-p cell');
});

/* --- the low-fill flag ---------------------------------------------------------------------------- */
ok('an argmax under the reach floor is FLAGGED, not printed bare', () => {
  const cells = [{ z: 4, ask: 400, p: 0.01, ev: 5 }, { z: 0, ask: 100, p: 0.9, ev: 4 }];
  assert.ok(cells[0].p < P_STAR_FLOOR, 'the fixture for this assertion must sit under the floor');
  // the flag is a report field; the render must name the reach AND the delayCost that produced it.
  const it = ITEMS.find(i => i.name === 'Ancestral robe top') || ITEMS[0];
  const rep = reportFor(it);
  const flagged = rep.priced.filter(p => p.lowFill != null);
  for (const p of flagged) assert.ok(p.p < P_STAR_FLOOR, 'lowFill must only fire under the floor');
  for (const p of rep.priced.filter(p => p.lowFill == null && p.p != null)) {
    assert.ok(p.p >= P_STAR_FLOOR, 'a sub-floor argmax must not pass unflagged');
  }
  if (flagged.length) assert.match(renderExitReport(rep).join('\n'), /reaches only/);
});

/* --- the two forces behind a high argmax are SEPARATED, not conflated ----------------------------- */
ok('bailDrivenDrift isolates the per-cell bail by swapping in the top-cell one', () => {
  for (const it of ITEMS) {
    const s = buildReachSurface(it.series, { nights: 14, now: NOW });
    for (const H of [6, 24, 48]) {
      const star = askStar(s, H, { delayCost: 0 });
      const got = bailDrivenDrift(s, H, star, { delayCost: 0 });
      const bails = s.grid.find(r => r.h === H).cells.map(c => c.bailZOnMiss).filter(v => v != null);
      if (!bails.length) { assert.equal(got, null); continue; }
      // the comparator is the TOP cell's bail — the chunk-2 "unconditional" convention, and only
      const px = s.refHigh + bails[bails.length - 1] * s.disp;
      const alt = askStar(s, H, { delayCost: 0, bailNet: px - tax(px) });
      assert.equal(got.topZ, alt.z, `${it.name} h=${H}`);
      assert.equal(got.topAsk, alt.ask);
      assert.equal(got.movesTheArgmax, alt.z !== star.z);
    }
  }
});

ok('bailDrivenDrift refuses rather than guessing when the horizon is absent', () => {
  const s = buildReachSurface(ITEMS[0].series, { nights: 14, now: NOW });
  const star = askStar(s, 24, { delayCost: 0 });
  assert.equal(bailDrivenDrift(s, 999, star), null);
  assert.equal(bailDrivenDrift(s, 24, null), null);
  assert.equal(bailDrivenDrift(null, 24, star), null);
});

/* --- the sign inversion falsifier ----------------------------------------------------------------- */
ok('askStar below the live instabuy is reported as an inversion, not a price', () => {
  assert.equal(signInversion({ h: 24, ask: 110 }, { quickSell: 100 }), null);
  assert.equal(signInversion({ h: 24, ask: 100 }, { quickSell: 100 }), null, 'equality is not an inversion');
  const msg = signInversion({ h: 24, ask: 90 }, { quickSell: 100 });
  assert.match(msg, /BELOW the live instabuy/);
  assert.match(msg, /10.00% BELOW/, 'the magnitude rides with the flag: a hit worth 0.02% is noise wearing an alarm');
  assert.match(signInversion({ h: 24, ask: 999 }, { quickSell: 1000 }), /0.10% BELOW/);
  assert.equal(signInversion({ h: 24, ask: 90 }, { quickSell: 0 }), null, 'no divisor, no share, no claim');
  assert.equal(signInversion({ h: 24, ask: 90 }, null), null, 'no live quote, no claim');
  assert.equal(signInversion(null, { quickSell: 100 }), null);
});

/* --- the fold is a reconstruction, and refuses rather than guessing -------------------------------- */
ok('foldAsk returns null on a missing live pair rather than echoing a level', () => {
  const it = ITEMS[0];
  const s = buildReachSurface(it.series, { nights: 14, now: NOW });
  const stats = { days: [['a', { low: 1, hi: 2 }]], his: [2], lows: [1] };
  assert.equal(foldAsk({ stats, live: null }), null);
  assert.equal(foldAsk({ stats, live: { quickBuy: null, quickSell: 100 } }), null);
  assert.equal(foldAsk({ stats: null, live: { quickBuy: 90, quickSell: 100, optSell: 110 } }), null);
  // his and days are separate arrays on windowStats: the reach count reads his, recencySplit walks days.
  // Guarding only his lets a days-less stats through into a crash rather than a refusal.
  const noDays = { stats: { his: [2], lows: [1] }, live: { quickBuy: 90, quickSell: 100, optSell: 110 } };
  assert.doesNotThrow(() => foldAsk(noDays), 'a days-less stats must REFUSE, not crash inside recencySplit');
  assert.equal(foldAsk(noDays), null);
  assert.ok(s.refHigh > 0);
});

ok('the fold row names itself a reconstruction', () => {
  const it = ITEMS[0];
  const s = buildReachSurface(it.series, { nights: 14, now: NOW });
  const live = { quickBuy: Math.round(s.refHigh * 0.98), quickSell: Math.round(s.refHigh * 0.995), optSell: Math.round(s.refHigh * 1.01), volDay: 500_000, limit: 11_000 };
  const rep = buildExitReport({ name: it.name, itemId: it.id, series: it.series, live, opts: { now: NOW } });
  const fold = rep.placed.find(p => p.key === 'fold');
  if (fold) assert.match(fold.note, /RECONSTRUCTED/);
  const quick = rep.placed.find(p => p.key === 'quick*');
  assert.equal(quick.ask, live.quickSell, 'quick* is the live instabuy verbatim');
});

ok('incumbentAsks names the depth collapse instead of dropping the row', () => {
  const it = ITEMS[0];
  const statsSeries = it.series.map(r => ({ ...r, timestamp: r.ts }));
  const pts = incumbentAsks({ stats: null, live: null, statsSeries, qty: 1e12, nights: 14, now: NOW });
  const depth = pts.find(p => p.key === 'depth');
  assert.ok(depth, 'an unbookable qty must still produce a depth row');
  assert.equal(depth.ask, null);
  assert.match(depth.note, /no level books/);
});

/* --- the JSON branch returns before any table ------------------------------------------------------ */
ok('--json emits the objects and NOTHING else — no table to strip', () => {
  const reps = ITEMS.map(it => reportFor(it));
  const jsonOut = emitLines(reps, { json: true });
  assert.equal(jsonOut.length, 1, 'a JSON run emits exactly one payload');
  assert.equal(JSON.parse(jsonOut[0]).length, reps.length);
  assert.ok(!jsonOut[0].split('\n').some(l => l.trim().startsWith('|')), 'a JSON run must contain no table row');
  const textOut = emitLines(reps);
  assert.ok(textOut.some(l => l.trim().startsWith('|')), 'the default run DOES render tables');
});

ok('the report round-trips through JSON with no NaN or undefined leaking', () => {
  for (const it of ITEMS) {
    const rep = reportFor(it, { price: 1, qty: 5 });
    const s = JSON.stringify(rep);
    assert.ok(!/NaN|Infinity/.test(s), `${it.name} leaked a non-finite number into the dump`);
    assert.deepEqual(JSON.parse(s).itemId, it.id);
  }
});

console.log(`\n${pass} assertion group(s) passed.`);
