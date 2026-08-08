#!/usr/bin/env node
/**
 * fill-surface.test.mjs — acceptance fixtures for the ask fill surface's keying/feature layer (AB2's
 * lib half) and for AB3's inversion `askAtFillRate` (pipeline/lib/market/fill-surface.mjs).
 *
 * Fixtures ONLY — a hand-built surface object, hand-built series, no sqlite, no fetch, no disk read.
 *
 * BUSINESS REQUIREMENTS pinned here:
 *   - `itemFeaturesFromSeries` is THE pinned mid definition (prior-24h mean avgHighPrice) and it reads
 *     STRICTLY BEFORE the reference instant. Base side/window are worth 5–15pp (PLAN-ASK-BACKTEST §10),
 *     so a second definition anywhere is a silent ±10pp bias; and a feature that peeked forward would
 *     make the whole surface unusable at decision time.
 *   - PRICE TIER is an ABSOLUTE key, not a sample tercile — omitting it overstates big-ticket fill by
 *     ~30pp (§10/B1), and the top tercile of a sample starts around 6.7k, so a 27m item would hide
 *     inside it.
 *   - VOLATILITY bands are SAMPLE-RELATIVE and must be read from the artifact's own stored cuts (§9.7
 *     limit 4). Never hardcoded.
 *   - AB3 REFUSES rather than extrapolates. Every refusal path below returns `ask: null` + a reason:
 *     no surface, no mid, no volatility, no density, a sparse ITEM (the surface describes dense items
 *     only — §10/M4), a sparse CELL, an unknown horizon, and a target the measured grid cannot reach.
 *   - a hit at the TOP of the grid is reported `capped: true` — the grid is censored above +8% and the
 *     honest answer is "at least this much", not a fabricated premium.
 *   - below the +2% separation floor the volatility band is NOT claimable (§10/M2) and the result says
 *     so, carrying the vol-pooled figure beside it.
 */
import assert from 'node:assert/strict';
import {
  askAtFillRate, itemFeaturesFromSeries, priceTierOf, volBandOf,
  cellKey, volPooledKey, PREMIUM_GRID, HORIZON_DAYS, SURFACE_SCHEMA, SEPARATION_PREMIUM,
  grainBiasPp,
} from '../lib/market/fill-surface.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };
const H = 3600, D = 86400;
const row = (timestamp, avgHighPrice) => ({ timestamp, avgHighPrice });

console.log('fill-surface (AB2 keying + AB3 inversion):');

// ── the pinned basis ────────────────────────────────────────────────────────────────────────────
ok('mid is the prior-24h MEAN avgHighPrice, computed strictly BEFORE `at`', () => {
  const at = 100 * D;
  const series = [
    row(at - 30 * H, 999999),     // outside the 24h mid window (but inside the 7d vol window)
    row(at - 3 * H, 100),
    row(at - 2 * H, 200),
    row(at - 1 * H, 300),
    row(at, 1e9),                 // AT the instant — must not leak in
    row(at + H, 1e9),             // after — must not leak in
  ];
  const f = itemFeaturesFromSeries(series, { at, midHours: 24, volDays: 7, bucketSeconds: 3600 });
  assert.equal(f.mid, 200);
  assert.equal(f.midBuckets, 3);
});

ok('relStd is the relative std over the prior vol window, and coverage is that window`s density', () => {
  const at = 100 * D;
  const series = [row(at - 2 * H, 90), row(at - 1 * H, 110)];
  const f = itemFeaturesFromSeries(series, { at, midHours: 24, volDays: 7, bucketSeconds: 3600 });
  assert.equal(f.mid, 100);
  assert.ok(Math.abs(f.relStd - 0.1) < 1e-12);        // population std 10 over mean 100
  assert.equal(f.volBuckets, 2);
  assert.ok(Math.abs(f.coverage - 2 / 168) < 1e-12);  // 2 of the 7×24 buckets 1h could hold
});

ok('no prior data → an empty feature set, never a guessed mid', () => {
  const f = itemFeaturesFromSeries([row(100 * D + H, 500)], { at: 100 * D });
  assert.equal(f.mid, null);
  assert.equal(f.priceTier, null);
});

ok('price tiers are ABSOLUTE and cover the §10/B1 table', () => {
  assert.equal(priceTierOf(99_999), '<100k');
  assert.equal(priceTierOf(100_000), '100k-1m');
  assert.equal(priceTierOf(999_999), '100k-1m');
  assert.equal(priceTierOf(1_000_000), '1-10m');
  assert.equal(priceTierOf(9_999_999), '1-10m');
  assert.equal(priceTierOf(10_000_000), '>=10m');
  assert.equal(priceTierOf(27_000_000), '>=10m');     // Ben's chaps lot lands in the tier that matters
  assert.equal(priceTierOf(0), null);
  assert.equal(priceTierOf(null), null);
});

ok('volatility bands read the artifact`s OWN cuts — sample-relative, never hardcoded', () => {
  assert.equal(volBandOf(0.01, [0.02, 0.10]), 'lowVol');
  assert.equal(volBandOf(0.05, [0.02, 0.10]), 'midVol');
  assert.equal(volBandOf(0.50, [0.02, 0.10]), 'highVol');
  assert.equal(volBandOf(0.05, [0.10, 0.20]), 'lowVol');   // different cuts ⇒ different band
  assert.equal(volBandOf(0.05, null), null);
  assert.equal(volBandOf(null, [0.02, 0.10]), null);
});

// ── a synthetic surface for AB3 ─────────────────────────────────────────────────────────────────
// Levels chosen to resemble the ≥10m column of §10/B1 (71.2 / 52.4 / 22.2 / 10.9 at +1/+2/+5/+8),
// so the refusal/selection behaviour is exercised on a realistically steep curve.
const P_BY_PREMIUM = { 0.005: 0.78, 0.01: 0.712, 0.02: 0.524, 0.03: 0.40, 0.05: 0.222, 0.08: 0.109 };
function makeSurface({ n = 200, nItems = 40, tiers = ['>=10m'], bands = ['lowVol'] } = {}) {
  const cells = {}, cellsVolPooled = {};
  for (const d of HORIZON_DAYS) for (const t of tiers) {
    for (const prem of PREMIUM_GRID) {
      const p = P_BY_PREMIUM[prem] * (d === 1 ? 0.88 : 1);
      cellsVolPooled[volPooledKey(d, t, prem)] = { n, nItems, p: p + 0.04, ci: [p - 0.05, p + 0.13], hits: Math.round(n * p) };
      for (const b of bands) cells[cellKey(d, t, b, prem)] = { n, nItems, p, hits: Math.round(n * p), ci: [p - 0.05, p + 0.05], windowSpread: 0.03 };
    }
  }
  return {
    schema: SURFACE_SCHEMA,
    meta: {
      premiums: PREMIUM_GRID, horizonsDays: HORIZON_DAYS, volBandCuts: [0.02, 0.10],
      minCoverage: 0.5, separationClaimableAtPremium: SEPARATION_PREMIUM, levelUncertaintyPp: 2.5,
    },
    cells, cellsVolPooled,
  };
}
const surface = makeSurface();
const bigItem = { mid: 27_000_000, relStd: 0.01, coverage: 0.9 };   // ≥10m × lowVol × dense

ok('picks the HIGHEST premium whose measured cell clears the target, priced off the pinned mid', () => {
  const r = askAtFillRate(bigItem, { targetP: 0.5, horizon: 3, surface });
  assert.equal(r.reason, null);
  assert.equal(r.premium, 0.02);                       // +3% reads 40% < 50%; +2% reads 52.4%
  assert.equal(r.ask, Math.round(27_000_000 * 1.02));
  assert.equal(r.p, 0.524);
  assert.equal(r.tier, '>=10m');
  assert.equal(r.volBand, 'lowVol');
  assert.equal(r.capped, false);
});

ok('a lower target buys a higher price — the lever points the right way', () => {
  const loose = askAtFillRate(bigItem, { targetP: 0.20, horizon: 3, surface });
  const tight = askAtFillRate(bigItem, { targetP: 0.70, horizon: 3, surface });
  assert.equal(loose.premium, 0.05);
  assert.equal(tight.premium, 0.01);
  assert.ok(loose.ask > tight.ask);
});

ok('the horizon is a real key — the same target yields a lower price at 1d', () => {
  const d3 = askAtFillRate(bigItem, { targetP: 0.5, horizon: 3, surface });
  const d1 = askAtFillRate(bigItem, { targetP: 0.5, horizon: 1, surface });
  assert.equal(d3.premium, 0.02);
  assert.equal(d1.premium, 0.01);                      // 1d levels are lower, so the same P costs price
  assert.ok(d1.ask < d3.ask);
});

ok('price tier changes the answer — the §10/B1 error cannot be reproduced by accident', () => {
  const both = makeSurface({ tiers: ['>=10m', '<100k'] });
  // give the cheap tier the §10/B1 cheap column, which clears the target two premiums higher
  for (const prem of PREMIUM_GRID) {
    both.cells[cellKey(3, '<100k', 'lowVol', prem)] = { n: 500, nItems: 90, p: { 0.005: 0.93, 0.01: 0.905, 0.02: 0.839, 0.03: 0.75, 0.05: 0.655, 0.08: 0.545 }[prem], ci: null };
  }
  const big = askAtFillRate({ mid: 27_000_000, relStd: 0.01, coverage: 0.9 }, { targetP: 0.5, horizon: 3, surface: both });
  const cheap = askAtFillRate({ mid: 27_000, relStd: 0.01, coverage: 0.9 }, { targetP: 0.5, horizon: 3, surface: both });
  assert.equal(big.premium, 0.02);
  assert.equal(cheap.premium, 0.08);                   // same target, 4 grid steps richer on a dust item
});

ok('a hit at the top of the grid is flagged `capped` — censored, not extrapolated', () => {
  const r = askAtFillRate(bigItem, { targetP: 0.10, horizon: 3, surface });
  assert.equal(r.premium, 0.08);
  assert.equal(r.capped, true);
  assert.ok(r.notes.some(n => /censored/.test(n)));
});

ok('below the +2% separation floor the volatility band is declared NOT claimable', () => {
  const r = askAtFillRate(bigItem, { targetP: 0.75, horizon: 3, surface });
  assert.equal(r.premium, 0.005);
  assert.equal(r.separationClaimable, false);
  assert.equal(r.volPooledP, 0.78 + 0.04);             // the vol-pooled read is carried alongside
  assert.ok(r.notes.some(n => /NOT claimable/.test(n)));
  // and at ≥2% it IS claimable
  assert.equal(askAtFillRate(bigItem, { targetP: 0.5, horizon: 3, surface }).separationClaimable, true);
});

ok('every result states a level uncertainty and the print-proxy limit', () => {
  const r = askAtFillRate(bigItem, { targetP: 0.5, horizon: 3, surface });
  assert.ok(r.notes.some(n => /±2\.5pp/.test(n)));        // narrow-spread cell → the pooled figure
  assert.ok(r.notes.some(n => /lower bound at qty=1/.test(n)));
});

ok('when the cell`s WINDOW spread beats its bootstrap CI, that is what gets reported', () => {
  // Measured on the real 2026-08-08 build: the median keyed cell moved 18.4pp between reference windows
  // against a median CI width of 8.5pp (>=10m × lowVol × +2%: 30.7pp vs ±4pp). An item-cluster bootstrap
  // cannot see window clustering, so a consumer quoting only the CI understates the uncertainty ~2×.
  const wide = makeSurface();
  for (const prem of PREMIUM_GRID) {
    Object.assign(wide.cells[cellKey(3, '>=10m', 'lowVol', prem)], { windowSpread: 0.307, nWindows: 6 });
  }
  const r = askAtFillRate(bigItem, { targetP: 0.5, horizon: 3, surface: wide });
  assert.equal(r.windowSpread, 0.307);
  assert.ok(r.notes.some(n => /moved 31pp across the 6 reference windows/.test(n)), r.notes.join(' | '));
  assert.ok(r.notes.some(n => /floor on the uncertainty/.test(n)));
});

// ── the refusals: the whole point of AB3 ────────────────────────────────────────────────────────
const refuses = (reason, item, opts) => {
  const r = askAtFillRate(item, { targetP: 0.5, horizon: 3, surface, ...opts });
  assert.equal(r.ask, null, `expected refusal ${reason}, got ask ${r.ask}`);
  assert.equal(r.reason, reason);
  return r;
};

ok('REFUSES with no surface (e.g. a pruned .cache) rather than answering from nothing', () => {
  const r = askAtFillRate(bigItem, { targetP: 0.5, horizon: 3, surface: null, surfacePath: '/definitely/not/a/surface.json' });
  assert.equal(r.ask, null);
  assert.equal(r.reason, 'no-surface');
});

ok('REFUSES without a pinned mid, without volatility, without density', () => {
  refuses('no-mid', { relStd: 0.01, coverage: 0.9 });
  refuses('no-mid', { mid: 0, relStd: 0.01, coverage: 0.9 });
  refuses('no-volatility', { mid: 27e6, coverage: 0.9 });
  refuses('no-density', { mid: 27e6, relStd: 0.01 });
});

ok('REFUSES a SPARSE item — the surface describes dense items only (§10/M4)', () => {
  const r = refuses('sparse-item', { mid: 27e6, relStd: 0.01, coverage: 0.2 });
  assert.ok(r.notes.some(n => /dense items only/.test(n)));
});

ok('REFUSES an unbuilt horizon rather than interpolating between horizons', () => {
  refuses('unknown-horizon', bigItem, { horizon: 7 });
});

ok('REFUSES a sparse CELL — n and item floors are enforced, not softened', () => {
  const thin = makeSurface({ n: 5, nItems: 2 });
  const r = askAtFillRate(bigItem, { targetP: 0.5, horizon: 3, surface: thin });
  assert.equal(r.ask, null);
  assert.equal(r.reason, 'sparse-cell');
  // …and the same cells pass once the floors are met
  assert.equal(askAtFillRate(bigItem, { targetP: 0.5, horizon: 3, surface: thin, minN: 4, minItems: 2 }).premium, 0.02);
});

ok('REFUSES a target the measured grid cannot reach — no extrapolation below the grid', () => {
  const r = refuses('target-unreachable', bigItem, { targetP: 0.95 });
  assert.ok(/only prints/.test(r.notes[0]));
});

ok('REFUSES a nonsense target', () => {
  refuses('bad-target', bigItem, { targetP: 0 });
  refuses('bad-target', bigItem, { targetP: 1 });
  refuses('bad-target', bigItem, { targetP: NaN });
});

ok('REFUSES a band with no cells at all (e.g. an item axis the build never populated)', () => {
  const r = askAtFillRate({ mid: 27e6, relStd: 0.9, coverage: 0.9 }, { targetP: 0.5, horizon: 3, surface });
  assert.equal(r.ask, null);
  assert.equal(r.reason, 'sparse-cell');
  assert.equal(r.volBand, 'highVol');
});

// ── the three 2026-08-08 adversarial-review fixes ───────────────────────────────────────────────
ok('D3 — an item above the calibrated ceiling REFUSES rather than borrowing a smaller item`s cell', () => {
  // `>=10m` is unbounded above: a 1.4b item was being priced off the same cell as a 27m one, quoting
  // 44.6% for a stratum that measures 37.3%. The tier cannot be split (whole tier n=653/115 items).
  const r = askAtFillRate({ mid: 1_400_000_000, relStd: 0.01, coverage: 0.9 }, { targetP: 0.4, horizon: 3, surface });
  assert.equal(r.reason, 'tier-out-of-range');
  assert.equal(r.ask, null, 'a refusal must not also carry a price');
  assert.ok(r.notes.some(n => /calibrated ceiling/.test(n)));
  // and the boundary still answers
  assert.equal(askAtFillRate({ mid: 99_000_000, relStd: 0.01, coverage: 0.9 }, { targetP: 0.5, horizon: 3, surface }).reason, null);
});

ok('D2 — when the between-window spread beats the bootstrap CI, the WIDER one is what gets quoted', () => {
  // The stored `ci` resamples ITEMS; it is blind to regime variance, which is usually the larger term
  // (median cell spread 18.4pp vs median CI width 8.5pp on the real build). Quoting the CI alone would
  // present a level as 4x more certain than it is.
  const wide = makeSurface();
  for (const k of Object.keys(wide.cells)) wide.cells[k] = { ...wide.cells[k], windowSpread: 0.31, nWindows: 6 };
  const r = askAtFillRate(bigItem, { targetP: 0.5, horizon: 3, surface: wide });
  assert.equal(r.windowSpread, 0.31, 'the spread rides on the result, not just in prose');
  assert.ok(r.notes.some(n => /moved 31pp across the 6 reference windows/.test(n)));
  assert.ok(!r.notes.some(n => /±2\.5pp/.test(n)), 'the reassuring pooled figure must not also appear');
});

ok('D1 — the 1h grain bias is SHOWN, never applied: p is untouched and the note carries both numbers', () => {
  const oneHour = makeSurface(); oneHour.meta.grain = '1h';
  const r = askAtFillRate(bigItem, { targetP: 0.5, horizon: 3, surface: oneHour });
  const cell = oneHour.cells[cellKey(3, '>=10m', 'lowVol', r.premium)];
  assert.equal(r.p, cell.p, 'THE POINT: a decision-mover ships as a visible comparison, not a silent swap');
  assert.ok(r.notes.some(n => /GRAIN BIAS/.test(n) && /Shown, NOT applied/.test(n)));

  const fiveMin = makeSurface(); fiveMin.meta.grain = '5m';
  assert.ok(!askAtFillRate(bigItem, { targetP: 0.5, horizon: 3, surface: fiveMin }).notes.some(n => /GRAIN BIAS/.test(n)),
    'no correction against the grain it was measured on');

  const cheap = makeSurface(); cheap.meta.grain = '1h';
  assert.ok(!askAtFillRate({ mid: 27_000, relStd: 0.01, coverage: 0.9 }, { targetP: 0.5, horizon: 3, surface: cheap }).notes.some(n => /GRAIN BIAS/.test(n)),
    'only >=10m is populated — pooled across tiers the gap is 0.7-2.0pp and within noise');

  // REGRESSION (2026-08-08): the guard tested only `grain === '5m'`, so an artifact with no
  // meta.grain was treated as 1h and reported "built at undefined grain, which understates ...".
  const unstamped = makeSurface(); delete unstamped.meta.grain;
  const u = askAtFillRate(bigItem, { targetP: 0.5, horizon: 3, surface: unstamped });
  assert.ok(!u.notes.some(n => /GRAIN BIAS/.test(n)),
    'an unstamped/legacy artifact gets NO correction — the bias was measured for 1h specifically');
  assert.ok(!u.notes.some(n => /undefined/.test(n)), 'and never names a grain it does not have');

  // The +5% cell was removed as unsourced — it must report no bias rather than a made-up one.
  const atFivePct = grainBiasPp('1h', '>=10m', 0.05);
  assert.equal(atFivePct, null, '+5% has no recorded measurement — no bias, not an invented one');
  assert.equal(grainBiasPp('1h', '>=10m', 0.02), 9.4, 'the documented cells still report');
});

console.log(`  ${pass} assertion group(s) passed`);
