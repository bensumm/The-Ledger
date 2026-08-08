/**
 * fill-surface.mjs — AB2's KEYING/feature layer + AB3's INVERSION (PLAN-ASK-BACKTEST §4).
 *
 * WHAT THE SURFACE IS. A measured lookup: "if I ask X% over mid, how often does the market print at or
 * above that within N days?" Built offline from the local archive by
 * `pipeline/commands/build-fill-surface.mjs`; read here. It replaces the reads the tooling offers today,
 * every one of which is a LEVEL rather than a fill probability — `windowread`'s "reached on ~50% of
 * days" is the median of the daily highs, so its 50% is TRUE BY CONSTRUCTION and cannot carry
 * information about its own quantile.
 *
 * ── THE FOUR KEYS, AND WHY EACH IS NOT OPTIONAL ──
 *  1. PREMIUM over MID (§9.1). Premium over our own BID conflates ask greed with entry quality: the
 *     same Masori chaps order reads +5.84% over Ben's buy and +1.59% over market mid.
 *  2. PRICE TIER (§10/B1). At +2% over mid, 3d horizon: sub-100k prints 83.9%, ≥10m prints 52.4%.
 *     7,634 of 9,416 observations in the original pooled cut were sub-100k items, so the pooled curve
 *     described dust. Omitting this key overstates big-ticket fill by ~30pp — precisely where a wrong
 *     verdict costs most.
 *  3. VOLATILITY BAND (§10/M3). The item axis is measured RELATIVE VOLATILITY, not trade frequency.
 *     Spearman(freq, relStd) = −0.41; conditioning on volatility collapses the +8% frequency gap from
 *     25.6pp to 2.8–8.5pp, and volatility alone spans 19.1% → 77.6% at +8%. Frequency is the proxy;
 *     volatility is the thing.
 *  4. HORIZON. An unfilled ask waits, so P(print within N days) — not the daily rate — is the
 *     decision-relevant number.
 *
 * ── THE MID IS PINNED, AND THAT IS A CORRECTNESS REQUIREMENT (§10) ──
 * `itemFeaturesFromSeries` is the ONE definition: mid = arithmetic mean of `avgHighPrice` over the
 * bucketed observations strictly inside [at − 24h, at). Measured sensitivity at +2%/3d on the same
 * items: this base 80.5% · VWAP 80.1% · instasell-side 93.4% · 72h window 78.0% · 6h window 81.2% ·
 * last-print 73.3%. Volume-weighting is a no-op; SIDE and WINDOW are worth 5–15pp. A consumer that
 * computes its own mid inherits a silent ±10pp bias, so consumers call this function rather than
 * reimplementing it.
 *
 * ── WHAT THE SURFACE IS NOT ALLOWED TO CLAIM ──
 *  · Levels are good to ±2–3pp, not ±1pp (§10/m1 — per-window +2% levels span 78.1–82.3%, a spread an
 *    item-cluster bootstrap alone does not see). AND THAT FIGURE IS THE POOLED ONE: measured on the
 *    2026-08-08 build, the median KEYED cell moved 18.4pp across the six reference windows against a
 *    median bootstrap CI width of 8.5pp, so on the cells this module actually reads the CI is a FLOOR on
 *    the uncertainty, not the whole of it. `askAtFillRate` says so on any cell where that is true.
 *  · Item-axis separation is claimable at premiums ≥2% only; at +0.5% the ordering is unresolved
 *    (§10/M2, P(low>high at every premium)=0.056). `askAtFillRate` flags this rather than hiding it.
 *  · DENSE items only (§10/M4): sparse items read 76.5% at +0.5% vs dense 91.3%, partly mechanically
 *    (an unarchived bucket can never print). `askAtFillRate` REFUSES a sparse item.
 *  · The premium/horizon monotonicity is TRUE BY CONSTRUCTION (nested events — §10/M1) and is never
 *    evidence of anything. Do not cite it.
 *  · It is the print PROXY, a lower bound at qty=1, and says nothing safe about size.
 *
 * Pure except `loadSurface`, which reads one JSON file.
 */
import fs from 'node:fs';
import pathMod from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = pathMod.dirname(fileURLToPath(import.meta.url));
const DAY = 86400;

/* The artifact `build-fill-surface.mjs` writes and this module reads. Under pipeline/.cache/ because it
   is DERIVED from the machine-local archive and reproducible from it — it is evidence, not source. A
   cache prune therefore makes `askAtFillRate` refuse with `no-surface`, which is the intended loud
   degradation (never a silent fallback to a pooled guess). */
export const DEFAULT_SURFACE_PATH = pathMod.join(HERE, '..', '..', '.cache', 'fill-surface.json');
export const SURFACE_SCHEMA = 'coffer-fill-surface/1';

/* The grid the builder sweeps and the lookup inverts. Matches §9/§10 exactly so the emitted levels are
   directly comparable to the validation record. */
export const PREMIUM_GRID = [0.005, 0.01, 0.02, 0.03, 0.05, 0.08];
export const HORIZON_DAYS = [1, 3];

/* Absolute price tiers (§10/B1's table). Absolute, NOT sample terciles: the whole point of B1 is that a
   27m item sits far into the tail of even the top tercile, so a sample-relative cut would keep hiding it. */
export const PRICE_TIERS = [
  { key: '<100k', lo: 0, hi: 1e5 },
  { key: '100k-1m', lo: 1e5, hi: 1e6 },
  { key: '1-10m', lo: 1e6, hi: 1e7 },
  { key: '>=10m', lo: 1e7, hi: Infinity },
];

/* Below this premium the item axis (volatility band) is NOT claimable (§10/M2). Above it, separation is
   robust (P=1.000 at each of +2/+3/+5/+8%). `askAtFillRate` reports the vol-pooled figure alongside the
   banded one under this threshold so the operator can see they disagree rather than trusting a band. */
export const SEPARATION_PREMIUM = 0.02;

/* Levels are trusted to ±2–3pp (§10/m1) POOLED. ⚠ That figure does NOT survive keying: across the 144
   cells the median between-window spread is 18.4pp against a median bootstrap CI width of 8.5pp, and
   31/72 3d cells have window variance more than DOUBLE the bootstrap. Rebuilding with 5 or 7 windows
   instead of 6 moves the worst cells 16.6–18.8pp. So this constant is the pooled fallback only —
   `askAtFillRate` prefers the cell's own `windowSpread` whenever it is the wider of the two, because the
   uncertainty an item-bootstrap cannot see is usually the larger one (2026-08-08 adversarial review). */
export const LEVEL_UNCERTAINTY_PP = 2.5;

/* THE CALIBRATED CEILING. `>=10m` is unbounded above; above this the tier's own strata diverge by a
   factor of ~2 and the cell level stops describing the item. See the refusal in askAtFillRate. */
export const TIER_CALIBRATED_MAX = 100_000_000;

/* MEASURED 1h-vs-5m grain bias, in PERCENTAGE POINTS to ADD to a 1h-built level (2026-08-08 adversarial
   review; identical (item, window, mid) pairs, 3 windows the 5m archive covers, n=330 over ~115 items).
   ONLY `>=10m` is populated: pooled across all tiers the gap is 0.7–2.0pp and within noise, but on big
   tickets it is materially positive at low premiums and gone by +8%. PROVISIONAL, one measurement, one
   market period. It is reported, never applied.

   PRECISION LIMIT — read before quoting a cell (2026-08-08 second review). These are five values from
   ONE paired sample; the SE on each paired difference is ~2pp and the strongest cell (+2%) rests on
   just 29 discordant items (McNemar χ²=27.3, p<0.001). So the DIRECTION is measured — positive at low
   premiums, converging to 0 by +8% — but the SHAPE is not: adjacent cells differ by 1–2 SE, and the
   earlier claim that the bias "PEAKS at +2%" rested on 9.4 vs 8.5, which is 0.9pp and inside noise.
   Do not read these as a per-premium curve.

   The 0.05 (+5%) cell was REMOVED 2026-08-08: it carried the value 2.9 with no provenance anywhere in
   the repo — PLAN-ASK-BACKTEST §12's measurement table documents five premiums and +5% is not one of
   them. An unsourced constant in a measured-not-assumed module is worse than a missing one, so +5%
   now simply reports no bias. Re-add it only with a recorded measurement. */
const GRAIN_BIAS_PP = { '>=10m': { 0.005: 5.5, 0.01: 8.5, 0.02: 9.4, 0.03: 5.8, 0.08: 0.0 } };
export function grainBiasPp(grain, tier, premium) {
  // The bias was measured for a 1h-built surface specifically. Anything else — 5m (already the finer
  // grain) or an unstamped/legacy artifact — gets no correction; guarding only `=== '5m'` made an
  // absent meta.grain report "built at undefined grain, which understates >=10m by ~9.4pp".
  if (grain !== '1h') return null;
  const byPrem = GRAIN_BIAS_PP[tier];
  if (!byPrem) return null;
  const bias = byPrem[premium];
  return Number.isFinite(bias) && bias > 0 ? bias : null;
}

export function priceTierOf(mid) {
  if (!Number.isFinite(mid) || mid <= 0) return null;
  for (const t of PRICE_TIERS) if (mid >= t.lo && mid < t.hi) return t.key;
  return null;
}

/* Volatility bands are SAMPLE-RELATIVE terciles (§9.7 limit 4) — the cut points are measured by the
   builder and stored in the artifact, so a lookup classifies an item on the same cuts the surface was
   built with. Never hardcode them. */
export function volBandOf(relStd, cuts) {
  if (!Number.isFinite(relStd) || !cuts || cuts.length !== 2) return null;
  if (relStd < cuts[0]) return 'lowVol';
  if (relStd < cuts[1]) return 'midVol';
  return 'highVol';
}

export const cellKey = (horizon, tier, volBand, premium) => `${horizon}d|${tier}|${volBand}|${premium}`;
export const volPooledKey = (horizon, tier, premium) => `${horizon}d|${tier}|${premium}`;
export const pooledKey = (horizon, premium) => `${horizon}d|${premium}`;

/* itemFeaturesFromSeries(series, { at, midHours, volDays, bucketSeconds }) → the PINNED basis.
 * Everything is computed STRICTLY BEFORE `at`, so the same call is valid at build time (where the
 * outcome is known) and at decision time (where it is not) — no leakage, no second definition.
 *
 *   mid       : mean avgHighPrice over [at − midHours×3600, at). THE pinned base (see header).
 *   relStd    : population std / mean of avgHighPrice over [at − volDays×86400, at) — the item axis.
 *   coverage  : archived high-side buckets in the volatility window ÷ buckets the grain could hold.
 *               The density measure; the surface describes dense items only (§10/M4). Computed on the
 *               PRIOR window on purpose — a forward-looking density is unknowable at decision time, so
 *               builder and lookup must agree on a backward-looking one.
 *   priceTier : from mid.
 * Rows are `timestamp`-keyed (archiveSeries shape), never `ts`. */
export function itemFeaturesFromSeries(series, { at, midHours = 24, volDays = 7, bucketSeconds = 3600 } = {}) {
  const empty = { mid: null, midBuckets: 0, relStd: null, volBuckets: 0, coverage: 0, priceTier: null, at: at ?? null };
  if (!Number.isFinite(at) || !series || !series.length) return empty;

  const midFrom = at - midHours * 3600;
  const volFrom = at - volDays * DAY;
  const midVals = [], volVals = [];
  for (const r of series) {
    if (r == null || r.timestamp == null) continue;
    const t = Number(r.timestamp);
    if (t >= at) continue;                              // strictly before `at`
    const hi = r.avgHighPrice;
    if (hi == null || !Number.isFinite(Number(hi))) continue;
    if (t >= volFrom) volVals.push(Number(hi));
    if (t >= midFrom) midVals.push(Number(hi));
  }
  if (!midVals.length) return { ...empty, volBuckets: volVals.length };

  const mid = midVals.reduce((a, b) => a + b, 0) / midVals.length;
  let relStd = null;
  if (volVals.length >= 2) {
    const m = volVals.reduce((a, b) => a + b, 0) / volVals.length;
    const varp = volVals.reduce((a, b) => a + (b - m) * (b - m), 0) / volVals.length;
    relStd = m > 0 ? Math.sqrt(varp) / m : null;
  }
  const possible = Math.max(1, Math.round(volDays * DAY / bucketSeconds));
  return {
    mid,
    midBuckets: midVals.length,
    relStd,
    volBuckets: volVals.length,
    coverage: Math.min(1, volVals.length / possible),
    priceTier: priceTierOf(mid),
    at,
  };
}

let _cache = null;
/* loadSurface(path) → the parsed artifact, or null if absent/unreadable/wrong-schema. Cached per path.
   Returning null (rather than throwing or substituting a default) is what makes `askAtFillRate` refuse
   loudly on a pruned cache instead of quietly answering from nothing. */
export function loadSurface(path = DEFAULT_SURFACE_PATH) {
  if (_cache && _cache.path === path) return _cache.surface;
  let surface = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(path, 'utf8'));
    if (parsed && parsed.schema === SURFACE_SCHEMA) surface = parsed;
  } catch { surface = null; }
  _cache = { path, surface };
  return surface;
}

/* askAtFillRate(item, { targetP, horizon, … }) — AB3, the INVERSION.
 *
 * "The highest premium over mid whose measured cell still clears `targetP`, converted to gp." The lever
 * Ben asked for, pointed the right way round: you name the confidence, the surface names the price.
 *
 * IT REFUSES RATHER THAN EXTRAPOLATES. Every `reason` below returns `ask: null`:
 *   no-surface        — artifact missing/stale-schema (e.g. .cache pruned). Rebuild it.
 *   no-mid            — no pinned mid supplied. Call itemFeaturesFromSeries; do not invent one.
 *   no-volatility     — relStd unknown, so the item axis cannot be keyed. Pooling instead would
 *                       reintroduce exactly the §10/B1-class error the keys exist to prevent.
 *   no-density        — density (coverage) not supplied.
 *   sparse-item       — below the surface's own density floor. §10/M4: the levels describe DENSE items;
 *                       on sparse ones they are partly a coverage artifact, not a market fact.
 *   unknown-horizon   — horizon not on the built grid. No interpolation between horizons.
 *   sparse-cell       — every cell for this (tier, band, horizon) is under the n / item floors.
 *   target-unreachable— even the SMALLEST premium on the grid does not clear targetP. Answering would
 *                       mean extrapolating below the measured grid, i.e. asking under mid on the
 *                       strength of a curve that was never measured there.
 * A hit at the TOP of the grid returns the price with `capped: true` — the grid is censored above +8%,
 * and the honest statement is "at least this much", not a fabricated higher premium.
 *
 * `item` = { mid, relStd, coverage, id?, name? } — the exact output of itemFeaturesFromSeries.
 */
// @provisional-api: AB3 of PLAN-ASK-BACKTEST. No surface consumes it yet BY DESIGN — AB7 is the chunk
// that puts it on `read-window-range.mjs --fill-rate` (console-only, INFORM), and AB8/AB9 gate any
// promotion to a default ask basis. Built ahead of its caller so the refusal contract is fixture-pinned
// before anything can depend on a silent fallback.
export function askAtFillRate(item, { targetP, horizon = 3, surface = null, surfacePath = DEFAULT_SURFACE_PATH, minN = 30, minItems = 8 } = {}) {
  const base = { ask: null, premium: null, p: null, ci: null, windowSpread: null, n: 0, nItems: 0, tier: null, volBand: null, horizon, capped: false, separationClaimable: null, volPooledP: null, notes: [] };
  const refuse = (reason, extra = {}) => ({ ...base, ...extra, reason });

  const surf = surface || loadSurface(surfacePath);
  if (!surf || !surf.cells) return refuse('no-surface');
  if (!Number.isFinite(targetP) || targetP <= 0 || targetP >= 1) return refuse('bad-target');

  const mid = item && item.mid;
  if (!Number.isFinite(mid) || mid <= 0) return refuse('no-mid');
  const relStd = item && item.relStd;
  if (!Number.isFinite(relStd)) return refuse('no-volatility');
  const coverage = item && item.coverage;
  if (!Number.isFinite(coverage)) return refuse('no-density');

  const meta = surf.meta || {};
  const minCoverage = Number.isFinite(meta.minCoverage) ? meta.minCoverage : 0.5;
  if (coverage < minCoverage) {
    return refuse('sparse-item', { notes: [`coverage ${(coverage * 100).toFixed(0)}% < surface floor ${(minCoverage * 100).toFixed(0)}% — the surface describes dense items only (§10/M4)`] });
  }

  const horizons = meta.horizonsDays || HORIZON_DAYS;
  if (!horizons.includes(horizon)) return refuse('unknown-horizon', { notes: [`built horizons: ${horizons.join('d, ')}d`] });

  const tier = priceTierOf(mid);
  const volBand = volBandOf(relStd, meta.volBandCuts);
  if (!tier) return refuse('no-mid');
  if (!volBand) return refuse('no-volatility');

  // D3 (2026-08-08 adversarial review): `>=10m` is UNBOUNDED ABOVE, and it was silently pricing a 1.4b
  // item off the same cell as a 27m one. Measured sub-tier heterogeneity inside `>=10m` at 3d: +2% prints
  // 47.2% (10–30m) / 48.7% (30–100m) / 37.3% (>=100m, n=169 over 31 items); at +8% it is 14.0 / 8.5 / 6.5%
  // — a factor-2 spread. The cell would have quoted 44.6% for an item whose own stratum reads 37%. This
  // cannot be fixed by splitting the tier (the WHOLE tier is n=653 / 115 items), so it refuses instead.
  // The prose amendment (§11.2.3) existed but was never encoded — that gap is the actual defect here.
  if (mid > TIER_CALIBRATED_MAX) {
    return refuse('tier-out-of-range', { tier, volBand, notes: [
      `mid ${Math.round(mid).toLocaleString()} is above the calibrated ceiling ${TIER_CALIBRATED_MAX.toLocaleString()} — the \`>=10m\` tier is unbounded above and its >=100m stratum prints materially lower than the tier level (37.3% vs 44.6% at +2%/3d). Refusing rather than quoting a level measured on smaller items.`,
    ] });
  }

  const premiums = (meta.premiums || PREMIUM_GRID).slice().sort((a, b) => a - b);
  let sawCell = false, lowestP = null, lowestPrem = null;
  for (let i = premiums.length - 1; i >= 0; i--) {
    const prem = premiums[i];
    const cell = surf.cells[cellKey(horizon, tier, volBand, prem)];
    if (!cell || cell.n < minN || cell.nItems < minItems) continue;
    sawCell = true;
    if (cell.p >= targetP) {
      const pooledCell = surf.cellsVolPooled ? surf.cellsVolPooled[volPooledKey(horizon, tier, prem)] : null;
      const claimable = prem >= (meta.separationClaimableAtPremium ?? SEPARATION_PREMIUM);
      const ciWidth = cell.ci ? cell.ci[1] - cell.ci[0] : null;
      const notes = [];
      // THE CI IS THE NARROWER OF THE TWO UNCERTAINTIES, AND USUALLY NOT THE BINDING ONE. It resamples
      // ITEMS; `windowSpread` is how far this cell's own level moved between reference windows, and on
      // the 2026-08-08 build the MEDIAN cell spread was 18.4pp against a median CI width of 8.5pp
      // (`≥10m × lowVol × +2%`: spread 30.7pp, CI ±4pp). The plan's "±2–3pp" is the POOLED figure and
      // does not transfer to a keyed cell. Quote the wider one.
      if (cell.windowSpread != null && ciWidth != null && cell.windowSpread > ciWidth) {
        notes.push(`⚠ this cell's level moved ${(cell.windowSpread * 100).toFixed(0)}pp across the ${cell.nWindows ?? '?'} reference windows — WIDER than the ±${(ciWidth * 50).toFixed(0)}pp bootstrap CI. Read the CI as a floor on the uncertainty, not the whole of it.`);
      } else {
        notes.push(`levels trusted to ±${meta.levelUncertaintyPp ?? LEVEL_UNCERTAINTY_PP}pp (pooled window spread), not ±1pp`);
      }
      // D1 (2026-08-08 adversarial review): the surface is built at 1h grain, and on `>=10m` that
      // UNDERSTATES fill by 5.5–9.4pp across the whole usable premium range (identical item/window/mid
      // pairs, n=330 over ~115 items: +0.5% 77.3→82.7, +1% 65.5→73.9, +2% 46.4→55.8 (McNemar p<0.001),
      // +3% 33.9→39.7, +8% 7.6→7.6). Pooled across all tiers the gap is only 0.7–2.0pp, which is why it
      // hid; the "converges to zero at +8%" story is true POOLED and false CONDITIONALLY — on `>=10m` the
      // gap PEAKS at +2%, the working range. Rebuilding at 5m is NOT the fix: the 5m archive is 30d deep
      // and yields n=10 per `>=10m` cell against 576 at 1h, trading a 9pp bias for an unusable sample.
      // So the bias is SHOWN, never silently applied — a decision-mover ships as a visible comparison,
      // not a swap (Ben, gate-on-error-cost-not-n). The consumer decides whether to lean on it.
      const bias = grainBiasPp(meta.grain, tier, prem);
      if (bias != null) {
        notes.push(`⚠ GRAIN BIAS: built at ${meta.grain} grain, which understates ${tier} by ~${bias.toFixed(1)}pp at +${(prem * 100).toFixed(1)}% (measured against 5m on identical item/window pairs, n=330). Shown, NOT applied: p reads ${(cell.p * 100).toFixed(1)}%, 5m-calibrated ≈ ${((cell.p + bias / 100) * 100).toFixed(1)}%. Direction is conservative for P and costly for net.`);
      }
      if (!claimable) notes.push(`premium ${(prem * 100).toFixed(1)}% is below the ${((meta.separationClaimableAtPremium ?? SEPARATION_PREMIUM) * 100).toFixed(0)}% separation floor — the volatility band is NOT claimable here (§10/M2); vol-pooled reads ${pooledCell ? (pooledCell.p * 100).toFixed(1) + '%' : 'n/a'}`);
      if (i === premiums.length - 1) notes.push(`grid is censored at +${(prem * 100).toFixed(1)}% — the true clearing premium may be higher; refusing to extrapolate`);
      notes.push('print PROXY: buyers paid ≥ this level; a lower bound at qty=1 and silent about size (AB4 is the flow check)');
      return {
        ask: Math.round(mid * (1 + prem)),
        premium: prem, p: cell.p, ci: cell.ci || null, windowSpread: cell.windowSpread ?? null,
        n: cell.n, nItems: cell.nItems,
        tier, volBand, horizon,
        capped: i === premiums.length - 1,
        separationClaimable: claimable,
        volPooledP: pooledCell ? pooledCell.p : null,
        mid, targetP, reason: null, notes,
      };
    }
    // remember the smallest-premium cell we actually saw, for the unreachable message
    lowestP = cell.p; lowestPrem = prem;
  }
  if (!sawCell) return refuse('sparse-cell', { tier, volBand, notes: [`no cell for ${tier} × ${volBand} × ${horizon}d clears n≥${minN} / items≥${minItems}`] });
  return refuse('target-unreachable', {
    tier, volBand,
    notes: [`even +${(lowestPrem * 100).toFixed(1)}% only prints ${lowestP != null ? (lowestP * 100).toFixed(1) + '%' : '—'} within ${horizon}d — below target ${(targetP * 100).toFixed(0)}%. Answering would extrapolate below the measured grid.`],
  });
}
