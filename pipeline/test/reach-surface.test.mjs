#!/usr/bin/env node
/**
 * reach-surface.test.mjs — acceptance for js/reach-surface.mjs (PLAN-REACH-SURFACE chunk 1).
 *
 * Synthetic rows for every property; one FROZEN archive slice
 * (fixtures/reach-surface.json) for the curve pin and the grain diagnostic. No sqlite, no fetch,
 * no clock — `now` is passed everywhere.
 *
 * BUSINESS REQUIREMENTS pinned here:
 *   - NO LOOK-AHEAD. `referenceAsOf(series, t)` must equal the same call on a series truncated at t.
 *     If refHigh/disp ever see past t, every p in the surface is scored against a level the market
 *     had not yet revealed, and nothing downstream can detect it.
 *   - UNRESOLVED WINDOWS ARE DROPPED, never counted as misses. Counting them biases every rate down
 *     by exactly the truncation at the end of the archive.
 *   - p is NON-INCREASING in z and NON-DECREASING in H, after cleanup, simultaneously.
 *   - REFUSAL IS A WIDTH BOUND. A cell is thin by its Wilson half-width, not by a count; Wald would
 *     report half-width 0 at p=0 and price an empty cell as certain.
 *   - THE GRAIN BIAS IS REPORTED, NEVER APPLIED — passing `fiveMin` must not move a single grid cell.
 *   - A ~0 grain delta at low 5m coverage means NOT MEASURABLE, not unbiased; `coverage` and
 *     `measurable` ride beside every delta so the two cases are distinguishable.
 *
 * MUTATION-VERIFIED — every mutant below was applied to the source and the named group observed RED.
 * A group not carrying that marking is NOT verified and says so on its own line.
 *   drop-not-miss    covers() guard removed                          -> exact-accounting group RED
 *   fullwindow-req   short-history references admitted                -> full-window group RED
 *   nIndep           CI reads the raw count, not the thinned one      -> width-bound group RED
 *   no-look-ahead    reference reads the untruncated series          -> no-look-ahead group RED
 *   no-look-ahead-2  reference clock pinned to the future            -> fixture-pin group RED
 *   H-monotone       running max disabled                            -> H-monotone group RED
 *   width-not-count  Wilson replaced by Wald                         -> width group RED
 *   never-applied    grid built from the 5m series when fiveMin set  -> grain group RED
 *   refN             recent-3 median replaced by full-window median  -> fixture-pin group RED
 *   bail-in-gp       bail left in gp instead of z                    -> bail group RED
 *
 * A z-monotone mutant is deliberately ABSENT: the isotonic pass it would have targeted was deleted
 * after measuring 0 violations in 22,500 adjacent pairs, so the group below asserts the construction
 * rather than a correction.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  buildReachSurface, referenceAsOf, surfaceProb, surfaceShape,
  wilsonHalfWidth, DEFAULT_Z_GRID,
} from '../../js/reach-surface.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

const HOUR = 3600;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'reach-surface.json'), 'utf8'));
const unpack = rows => rows.map(([ts, avgHighPrice, avgLowPrice]) => ({ ts, avgHighPrice, avgLowPrice, highPriceVolume: 1, lowPriceVolume: 1 }));

/* A deterministic diurnal sawtooth with day-to-day variation. The variation is REQUIRED, not
 * decoration: a pure repeating sine has identical daily highs, so IQR(daily highs) is 0 and the
 * surface correctly refuses to build. `spread` scales how much the daily peak wanders. */
function synth({ days = 40, base = 1000, amp = 100, startTs = 1_750_000_000, drift = 0, spread = 40 } = {}) {
  const out = [];
  const t0 = startTs - (startTs % 86400);
  let seed = 12345;
  const dayOffset = [];
  for (let d = 0; d < days + 1; d++) { seed = (seed * 1103515245 + 12345) % 2147483648; dayOffset.push(((seed / 2147483648) - 0.5) * 2 * spread); }
  for (let i = 0; i < days * 24; i++) {
    const wave = Math.sin(((i % 24) / 24) * 2 * Math.PI);
    const mid = base + drift * (i / 24) + dayOffset[Math.floor(i / 24)];
    out.push({ ts: t0 + i * HOUR, avgHighPrice: Math.round(mid + amp * wave), avgLowPrice: Math.round(mid - amp * wave), highPriceVolume: 10, lowPriceVolume: 10 });
  }
  return out;
}
const NOW = new Date((synth().at(-1).ts + HOUR) * 1000);

// --- unit atoms ---------------------------------------------------------------------------------

ok('wilsonHalfWidth is POSITIVE at p=0 and p=1 — the Wald trap that would price an empty cell certain', () => {
  assert.ok(wilsonHalfWidth(0, 8) > 0.1, 'p=0, n=8 must be wide');
  assert.ok(wilsonHalfWidth(1, 8) > 0.1, 'p=1, n=8 must be wide');
  assert.ok(wilsonHalfWidth(0, 5000) < 0.01, 'p=0 at large n must be narrow');
  assert.ok(wilsonHalfWidth(0.5, 30) > wilsonHalfWidth(0.5, 300), 'width must fall with n');
  assert.equal(wilsonHalfWidth(0.5, 0), null);
  assert.equal(wilsonHalfWidth(null, 10), null);
});


// --- the load-bearing invariant -----------------------------------------------------------------

ok('NO LOOK-AHEAD: referenceAsOf(series, t) === referenceAsOf(truncate(series, t), t)  [MUTATION-VERIFIED]', () => {
  const s = synth({ days: 60, drift: 20 });                 // drifting, so later data would MOVE the ref
  let checked = 0;
  for (const at of [s[20 * 24].ts, s[35 * 24].ts, s[50 * 24].ts]) {
    const full = referenceAsOf(s, at);
    const trunc = referenceAsOf(s.filter(r => r.ts <= at), at);
    assert.ok(full, 'reference must exist this far into the series');
    assert.deepEqual(full, trunc, 'the reference at ' + at + ' saw data after it');
    checked++;
  }
  assert.equal(checked, 3);
  // and the drift is real, so the test could have failed: refs must differ across origins
  assert.notEqual(referenceAsOf(s, s[20 * 24].ts).refHigh, referenceAsOf(s, s[50 * 24].ts).refHigh);
});

ok('a reference needs the FULL nights window — a 3-day disp and a 14-day disp are different units', () => {
  const s = synth({ days: 40 });
  assert.equal(referenceAsOf(s, s[5 * 24].ts, { nights: 14 }), null, 'day 5 has no 14-day window behind it');
  assert.ok(referenceAsOf(s, s[20 * 24].ts, { nights: 14 }), 'day 20 does');
});

ok('UNRESOLVED WINDOWS ARE DROPPED, not counted as misses — EXACT accounting  [MUTATION-VERIFIED]', () => {
  // The first form of this group compared two builds and PASSED under its own mutant, because
  // removing covers() is largely masked by the separate no-print drop. Count origins instead:
  // an origin may be scored only if its window ENDS inside the archive. One extra means a partial
  // window was scored, which is exactly the end-of-archive truncation bias covers() prevents.
  const s = synth({ days: 40 }), strideH = 6, lastTs = s.at(-1).ts;
  for (const h of [6, 24, 96]) {
    const surf = buildReachSurface(s, { horizonsH: [h], strideH, now: NOW });
    const firstOrigin = s[0].ts + surf.skippedShortHistory * strideH * HOUR;
    let resolvable = 0;
    for (let i = 0; i < surf.nOrigins; i++) if (firstOrigin + i * strideH * HOUR + h * HOUR <= lastTs) resolvable++;
    assert.equal(surf.grid[0].n + surf.grid[0].noPrintDropped, resolvable,
      "H=" + h + ": scored " + surf.grid[0].n + " + dropped " + surf.grid[0].noPrintDropped +
      " but only " + resolvable + " of " + surf.nOrigins + " origins have a window inside the archive");
    assert.ok(resolvable < surf.nOrigins, "H=" + h + " must lose tail origins, or the group proves nothing");
  }
});

ok('H-MONOTONICITY is enforced against a REAL item that violates it  [MUTATION-VERIFIED]', () => {
  // Only the H axis can invert: its origin set SHRINKS with H (both from covers() and from the
  // no-print drop), so an unusually reachable tail lowers p as H grows. This is a REAL item that
  // does it — 12.1pp at z=-0.25 between H=2 and H=6, the largest of 155 raw violations measured
  // over 250 items. A synthetic violator is hard to build precisely because z re-normalizes per
  // origin and cancels a manufactured tail spike.
  const it = FIX.hviol["4980"];
  const surf = buildReachSurface(unpack(it.h1), { now: new Date((FIX.meta.frozenTo + HOUR) * 1000) });
  let worst = 0;
  for (let k = 0; k < surf.zGrid.length; k++) {
    for (let i = 1; i < surf.grid.length; i++) {
      worst = Math.max(worst, surf.grid[i - 1].cells[k].pRaw - surf.grid[i].cells[k].pRaw);
      assert.ok(surf.grid[i].cells[k].p >= surf.grid[i - 1].cells[k].p - 1e-12,
        "H-monotonicity broken at z=" + surf.zGrid[k] + " H=" + surf.grid[i - 1].h + "->" + surf.grid[i].h);
    }
  }
  assert.ok(worst > 0.05, "the fixture must carry a RAW inversion of real size, got " + (worst * 100).toFixed(2) + "pp");
});

ok('z-MONOTONICITY holds BY CONSTRUCTION — one origin set, one threshold per origin, no cleanup', () => {
  for (const s of [synth({ days: 50 }), synth({ days: 50, amp: 300, drift: -8 }), synth({ days: 50, drift: 15 })]) {
    const surf = buildReachSurface(s, { now: NOW });
    assert.ok(surf, 'surface must build');

    // pRaw, not p: the point is that the UNCLEANED rate is already ordered, so nothing corrects it.
    for (const row of surf.grid) {
      for (let k = 1; k < row.cells.length; k++) {
        assert.ok(row.cells[k].pRaw <= row.cells[k - 1].pRaw + 1e-12,
          "raw z-monotonicity broken at H=" + row.h + ", z=" + row.cells[k].z + " — the construction argument is wrong");
      }
    }
  }
});

ok('cleanup is VISIBLE and MEASURED NEAR-INERT on real data — it guarantees, it does not correct', () => {
  let moved = 0, cells = 0, worst = 0;
  for (const id of Object.keys(FIX.curve)) {
    const surf = buildReachSurface(unpack(FIX.curve[id].h1), { now: new Date((FIX.meta.frozenTo + HOUR) * 1000) });
    for (const c of surf.grid.flatMap(r => r.cells)) {
      cells++;
      assert.ok('pRaw' in c, 'every cell must carry its uncleaned rate');
      if (c.pRaw != null && Math.abs(c.p - c.pRaw) > 1e-9) { moved++; worst = Math.max(worst, Math.abs(c.p - c.pRaw)); }
    }
  }
  // MEASURED on THESE THREE items: 2 of 288 cells move, by under 0.005pp — their raw curves are
  // already ordered. That is NOT a general claim: over 250 items the H running max fires 155 times
  // with a median of 0.4pp and a maximum of 12.1pp (the hviol fixture above). So cleanup is inert
  // HERE and load-bearing elsewhere; this group is a drift detector for these three, nothing more.
  assert.ok(moved <= 10, `cleanup moved ${moved}/${cells} cells — it was 2; the raw curves stopped being monotone`);
  assert.ok(worst < 0.01, `cleanup moved a cell by ${(worst * 100).toFixed(2)}pp — it was under 0.005pp`);
});

// --- refusal ------------------------------------------------------------------------------------

ok('REFUSAL IS A WIDTH BOUND, not a count: long H refuses while short H prices  [MUTATION-VERIFIED]', () => {
  const surf = buildReachSurface(synth({ days: 60 }), { horizonsH: [2, 24, 96], strideH: 6, now: NOW });
  assert.equal(surf.thin[2], false, 'H=2 has one independent window per origin and must price');
  assert.equal(surf.thin[96], true, 'H=96 thins to a handful of independent windows and must refuse');
  assert.ok(surf.thinReason[96].includes('independent window'), 'a refusal must say why: ' + surf.thinReason[96]);
  assert.equal(surf.thinReason[2], null);
  assert.ok(surf.independentWindows[96] < surf.independentWindows[2] / 8, 'window thinning must scale with H');
});

ok('a p=0 cell is priceable or not BY ITS WIDTH — thin below ~9 independent windows, not above', () => {
  // Wilson at p=0 reduces to z²/(2n + z²), so the crossing against a ±15pp bound is n = 8.96. That
  // boundary is the whole point of a width bound: an empty cell is not automatically certain (Wald)
  // and not automatically unusable (a count floor) — it depends on how many windows produced it.
  assert.ok(wilsonHalfWidth(0, 8) > 0.15, 'p=0 on 8 windows is NOT resolved to ±15pp');
  assert.ok(wilsonHalfWidth(0, 10) < 0.15, 'p=0 on 10 windows IS');
  const surf = buildReachSurface(synth({ days: 60 }), { horizonsH: [96], now: NOW });
  const top = surf.grid[0].cells.at(-1);
  assert.equal(top.p, 0, 'the top of the z grid is unreachable on this fixture');
  assert.equal(top.thin, wilsonHalfWidth(0, surf.grid[0].nIndep) > 0.15,
    'the cell verdict must follow its own width, not the rate');
});

// --- the grain diagnostic -----------------------------------------------------------------------

ok('THE GRAIN BIAS IS REPORTED, NEVER APPLIED — fiveMin must not move a grid cell  [MUTATION-VERIFIED]', () => {
  const it = FIX.grain['566'];
  const opts = { horizonsH: [2, 6], nights: 5, now: new Date((it.h1.at(-1)[0] + HOUR) * 1000) };
  const without = buildReachSurface(unpack(it.h1), opts);
  const withFive = buildReachSurface(unpack(it.h1), { ...opts, fiveMin: unpack(it.m5) });
  assert.ok(withFive.grainBias, 'the diagnostic must be produced at all');
  assert.deepEqual(withFive.grid, without.grid, 'the grid changed when the 5m series was supplied');
});

ok('a ~0 delta at LOW 5m coverage is labelled not-measurable, not unbiased', () => {
  const liquid = FIX.grain['566'], thin = FIX.grain['20997'];
  const build = it => buildReachSurface(unpack(it.h1), {
    horizonsH: [6], nights: 5, fiveMin: unpack(it.m5), now: new Date((it.h1.at(-1)[0] + HOUR) * 1000),
  }).grainBias;
  const gL = build(liquid), gT = build(thin);
  assert.ok(gL.coverage > gT.coverage, `liquid 5m coverage ${gL.coverage} must exceed thin ${gT.coverage}`);
  assert.equal(gT.measurable, false, 'the thin item must be flagged unmeasurable');
  assert.ok(gT.byZH[0].deltaPp.some(d => d != null), 'the delta is still REPORTED, beside its coverage');
  assert.ok(gL.eraDays > 0 && gT.eraDays > 0);
  assert.ok(/never applied/i.test(gT.note) && /not measurable/i.test(gT.note));
});

// --- the frozen-archive curve pin ---------------------------------------------------------------

ok('FIXTURE PIN: the re-derived p(z, H=24) curves for the three plan exemplars', () => {
  const pin = {};
  for (const id of Object.keys(FIX.curve)) {
    const it = FIX.curve[id];
    const surf = buildReachSurface(unpack(it.h1), { horizonsH: [24], now: new Date((FIX.meta.frozenTo + HOUR) * 1000) });
    pin[it.name] = surf.grid[0].cells.map(c => Math.round(c.p * 1000) / 1000);
    assert.equal(surf.grid[0].cells.length, DEFAULT_Z_GRID.length);
    assert.ok(surf.grid[0].n > 250, `${it.name} must resolve a deep origin set, got ${surf.grid[0].n}`);
  }
  // Pinned so a refactor cannot move the curve silently. These are the RE-DERIVED numbers on the
  // uniform 1h instrument in z units — NOT the raw-% figures PLAN-REACH-SURFACE §1.5 printed.
  assert.deepEqual(pin['Soul rune'],          [0.806, 0.655, 0.587, 0.552, 0.548, 0.490, 0.465, 0.410, 0.381, 0.323, 0.261, 0.226, 0.074, 0.035, 0.019, 0.019]);
  assert.deepEqual(pin['Ranarr weed'],        [0.923, 0.865, 0.761, 0.632, 0.545, 0.461, 0.403, 0.339, 0.306, 0.277, 0.206, 0.190, 0.103, 0.055, 0.013, 0.000]);
  assert.deepEqual(pin['Ancestral robe top'], [0.829, 0.635, 0.487, 0.419, 0.377, 0.323, 0.271, 0.210, 0.165, 0.145, 0.039, 0.013, 0.000, 0.000, 0.000, 0.000]);
});

ok('the §1.5 taxonomy contrast does NOT survive z-normalization — pinned as a finding, not a hope', () => {
  const shapeOf = id => {
    const it = FIX.curve[id];
    const surf = buildReachSurface(unpack(it.h1), { horizonsH: [24], now: new Date((FIX.meta.frozenTo + HOUR) * 1000) });
    return surfaceShape(surf, 24);
  };
  const soul = shapeOf('566'), ranarr = shapeOf('257'), anc = shapeOf('21021');
  // §1.5 read Ranarr as the CLIFF (narrowest) and Ancestral as the FAT TAIL (widest). In z units the
  // order is the reverse, and all three land in one band — the contrast was mostly `disp`, which z
  // already carries as a single number. If this ever flips back, §1.5's premise is live again.
  assert.ok(soul.spread > ranarr.spread, `Soul ${soul.spread} should exceed Ranarr ${ranarr.spread}`);
  assert.ok(ranarr.spread > anc.spread, `Ranarr ${ranarr.spread} should exceed Ancestral ${anc.spread}`);
  assert.ok(soul.spread - anc.spread < 0.5, 'all three sit inside one narrow band of shape');
});

// --- query surface ------------------------------------------------------------------------------
// NOT mutation-verified: these pin the arithmetic of reading the surface, not a measured property.

ok('surfaceProb converts an ask to z, interpolates, and flags off-grid as extrapolated', () => {
  const surf = buildReachSurface(synth({ days: 50 }), { now: NOW });
  const at = surf.refHigh;
  const mid = surfaceProb(surf, at, 24);
  assert.equal(Math.abs(mid.z) < 1e-9, true, 'the reference itself is z=0');
  assert.ok(mid.p > 0 && mid.p <= 1);
  assert.equal(mid.extrapolated, false);
  const far = surfaceProb(surf, at + 99 * surf.disp, 24);
  assert.equal(far.extrapolated, true, 'far above the grid must be flagged, not extended');
  const below = surfaceProb(surf, at - 99 * surf.disp, 24);
  assert.equal(below.extrapolated, true);
  assert.ok(below.p >= mid.p, 'a lower ask cannot be less reachable');
  const between = surfaceProb(surf, at + 0.15 * surf.disp, 24);
  const lo = surfaceProb(surf, at + 0.1 * surf.disp, 24), hi = surfaceProb(surf, at + 0.2 * surf.disp, 24);
  assert.ok(between.p <= lo.p + 1e-12 && between.p >= hi.p - 1e-12, 'interpolation must sit between its nodes');
  assert.equal(surfaceProb(surf, at, 7), null, 'an off-grid horizon is a refusal, not a guess');
  assert.equal(surfaceProb(null, at, 24), null);
  assert.equal(surfaceProb(surf, NaN, 24), null);
});

ok('bailZOnMiss is carried in z, not gp — a pooled gp bail is not comparable to a current refHigh', () => {
  const surf = buildReachSurface(FIX.curve['21021'].h1.map(([ts, h, l]) => ({ ts, avgHighPrice: h, avgLowPrice: l })), {
    horizonsH: [24], now: new Date((FIX.meta.frozenTo + HOUR) * 1000),
  });
  const cells = surf.grid[0].cells.filter(c => c.bailZOnMiss != null);
  assert.ok(cells.length > 4, 'misses must exist to average over');
  // Ancestral fell ~20% across this window, so a gp median would land ABOVE the current refHigh.
  // In z the quantity is scale-free and reconstructs as refHigh + bailZ*disp at query time.
  assert.ok(cells.every(c => Math.abs(c.bailZOnMiss) < 20), 'a z-valued bail must be a small multiple of disp');
});

ok('a series too short to place a single origin returns null rather than an empty surface', () => {
  assert.equal(buildReachSurface([], {}), null);
  assert.equal(buildReachSurface(null, {}), null);
  assert.equal(buildReachSurface(synth({ days: 3 }), { now: NOW }), null);
});

ok('noPrintDropped is reported — an origin whose window never printed is dropped, and that biases p UP', () => {
  const s = synth({ days: 40 });
  // origins land on hours 0/6/12/18, so their H=1 windows are exactly hours 1/7/13/19. Punching
  // 1 and 13 empties HALF the windows; those origins must be dropped, not scored as misses.
  const holed = s.map((r, i) => (i % 12 === 1 ? { ...r, avgHighPrice: null } : r));
  const surf = buildReachSurface(holed, { horizonsH: [1], strideH: 6, now: NOW });
  const clean = buildReachSurface(s, { horizonsH: [1], strideH: 6, now: NOW });
  assert.ok(surf.grid[0].noPrintDropped > 0, 'the punched-out hours must show up as drops');
  assert.equal(surf.grid[0].n + surf.grid[0].noPrintDropped, clean.grid[0].n,
    'dropped + resolved must account for every origin the clean series resolved');
  assert.ok(surf.grid[0].n < clean.grid[0].n, 'the holed series must resolve strictly fewer origins');
});

console.log(`  ${pass} assertion group(s) passed`);
