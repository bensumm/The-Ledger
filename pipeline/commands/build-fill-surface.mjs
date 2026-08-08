#!/usr/bin/env node
/**
 * build-fill-surface.mjs — AB2 (PLAN-ASK-BACKTEST §4). OFFLINE surface BUILDER.
 *
 * Sweeps items × reference windows × a premium grid against the local archive and emits a versioned
 * lookup keyed by **premium × price tier × volatility band × horizon**, each cell carrying its n and a
 * confidence interval. The question every cell answers: *if I ask X% over mid, how often does the
 * market print at or above that within N days?*
 *
 * ── WHAT THIS IS NOT ──
 * It touches NO live surface. Nothing in `/scan`, `/positions`, the app, or any gate reads it; the scan
 * does not call it. It is a report/builder: it reads the archive, prints a table, writes one JSON
 * artifact. AB7 is the chunk that (console-only, INFORM) puts the LOOKUP on `read-window-range.mjs`.
 *
 * ── ARCHIVE SAFETY ──
 * Opens `open(undefined, { readonly: true })` ONLY. The archive is a multi-GB live DB and a plain
 * `open()` runs schema DDL against it.
 *
 * ── METHOD, AND THE FIVE THINGS IT IS BUILT TO NOT GET WRONG ──
 *  1. PREMIUM IS EXOGENOUS. We set the premium on a fixed grid rather than reading back asks the
 *     estimator chose. Reading back our own quotes is what made the earlier 91.5% study
 *     self-fulfilling (§8/M1): screen asks are quoted FROM recent reachability, so that study largely
 *     tested the estimator on the process that generated it.
 *  2. THE MID IS PINNED — prior-24h mean `avgHighPrice`, via the single `itemFeaturesFromSeries`
 *     definition. Base SIDE and WINDOW move every level 5–15pp (§10); VWAP is a no-op (−0.4pp).
 *  3. NO LEAKAGE. Features are computed strictly BEFORE the reference instant; the outcome window is
 *     strictly AFTER it (`printedAt` is exclusive at `from`).
 *  4. PRICE TIER IS A KEY, not a pooling accident. The pooled curve is dominated by sub-100k items and
 *     overstates big-ticket fill by ~30pp (§10/B1).
 *  5. THE CI IS AN ITEM-CLUSTER BOOTSTRAP, not Wilson. Outcomes are item-dominated (§8/M5: within-item
 *     variance share 0.648; 191 of 284 items all-print), so an i.i.d. interval on `n` observations is
 *     several times too narrow. We resample ITEMS with replacement. Even then it misses WINDOW
 *     clustering (§10/m1 — per-window +2% levels span 78.1–82.3%), so the artifact also carries
 *     `windowSpread` per cell and stamps `levelUncertaintyPp: 2.5` for consumers to report.
 *
 * ── WHAT THE OUTPUT MAY NOT BE USED TO CLAIM ──
 * The premium/horizon monotonicity is TRUE BY CONSTRUCTION — the events are nested (`printed ≥
 * mid×1.08` ⊂ … ⊂ `printed ≥ mid×1.005`; `(T,T+1d] ⊂ (T,T+3d]`), so the table is monotone for ANY
 * data including random noise. It is never evidence (§10/M1). What IS usable is the LEVELS, and only
 * for DENSE items, only to ±2–3pp, with item-axis separation claimable at premiums ≥2% only (§10/M2).
 *
 * Usage:
 *   node pipeline/commands/build-fill-surface.mjs                     # 1h grain, 6 windows, all dense items
 *   node pipeline/commands/build-fill-surface.mjs --grain 5m --windows 6
 *   node pipeline/commands/build-fill-surface.mjs --limit 400 --boot 200 --out /tmp/s.json
 *   node pipeline/commands/build-fill-surface.mjs --dry-run           # print only, write nothing
 */
import fs from 'node:fs';
import pathMod from 'node:path';
import { open } from '../lib/market/archive.mjs';
import { printedAt } from '../lib/market/printed-at.mjs';
import {
  PREMIUM_GRID, HORIZON_DAYS, PRICE_TIERS, SEPARATION_PREMIUM, LEVEL_UNCERTAINTY_PP,
  SURFACE_SCHEMA, DEFAULT_SURFACE_PATH, itemFeaturesFromSeries, volBandOf,
  cellKey, volPooledKey, pooledKey,
} from '../lib/market/fill-surface.mjs';

const DAY = 86400;
const argv = process.argv.slice(2);
const flag = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : dflt; };
const has = name => argv.includes(name);

const GRAIN = String(flag('--grain', '1h'));
const BUCKET_S = GRAIN === '5m' ? 300 : 3600;
const N_WINDOWS = Number(flag('--windows', 6));
const VOL_DAYS = Number(flag('--vol-days', 7));
const MID_HOURS = Number(flag('--mid-hours', 24));
const MIN_COVERAGE = Number(flag('--min-coverage', 0.5));
const MIN_MID_BUCKETS = Number(flag('--min-mid-buckets', GRAIN === '5m' ? 60 : 12));
const LIMIT = Number(flag('--limit', 0));            // 0 = every qualifying item
const BOOT = Number(flag('--boot', 400));
const OUT = flag('--out', DEFAULT_SURFACE_PATH);
const DRY = has('--dry-run');
const MAX_HORIZON = Math.max(...HORIZON_DAYS);

// --- deterministic PRNG so a rebuild reproduces its own CIs (a bootstrap that moves every run is not
//     evidence, it is noise the reader has to discount) ---
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pct = x => x == null ? '   — ' : (x * 100).toFixed(1).padStart(5);
const nowIso = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

// --- cell accumulation -------------------------------------------------------------------------
// A cell holds per-ITEM tallies (for the cluster bootstrap) and per-WINDOW tallies (for the spread the
// item bootstrap cannot see). Both are needed; neither substitutes for the other.
const makeCell = () => ({ n: 0, hits: 0, items: new Map(), windows: new Map() });
function bump(store, key, itemId, windowTs, hit) {
  let c = store.get(key); if (!c) { c = makeCell(); store.set(key, c); }
  c.n++; if (hit) c.hits++;
  let it = c.items.get(itemId); if (!it) { it = { n: 0, h: 0 }; c.items.set(itemId, it); }
  it.n++; if (hit) it.h++;
  let w = c.windows.get(windowTs); if (!w) { w = { n: 0, h: 0 }; c.windows.set(windowTs, w); }
  w.n++; if (hit) w.h++;
}

/* Item-cluster bootstrap: resample ITEMS with replacement, recompute the rate, take the 2.5/97.5
   percentiles. Deliberately NOT Wilson — see the header's point 5. */
function clusterCi(cell, rnd, B) {
  const arr = [...cell.items.values()];
  if (arr.length < 2) return null;
  const out = new Array(B);
  for (let b = 0; b < B; b++) {
    let h = 0, n = 0;
    for (let k = 0; k < arr.length; k++) { const s = arr[(rnd() * arr.length) | 0]; h += s.h; n += s.n; }
    out[b] = n ? h / n : 0;
  }
  out.sort((a, b) => a - b);
  return [out[Math.floor(0.025 * B)], out[Math.min(B - 1, Math.floor(0.975 * B))]];
}

function finalize(store, rnd, B) {
  const out = {};
  for (const [key, c] of store) {
    const byWindow = [...c.windows.entries()].sort((a, b) => a[0] - b[0]).map(([ts, w]) => ({ ts, n: w.n, p: w.n ? w.h / w.n : null }));
    const ps = byWindow.map(w => w.p).filter(p => p != null);
    out[key] = {
      n: c.n, hits: c.hits, p: c.n ? c.hits / c.n : null,
      nItems: c.items.size,
      ci: clusterCi(c, rnd, B),
      nWindows: byWindow.length,
      windowSpread: ps.length > 1 ? Math.max(...ps) - Math.min(...ps) : null,
      byWindow: byWindow.map(w => (w.p == null ? null : Number(w.p.toFixed(4)))),
    };
  }
  return out;
}

// --- main --------------------------------------------------------------------------------------
const h = open(undefined, { readonly: true });   // READONLY — never a plain open() against the live DB
try {
  const span = h.db.prepare('SELECT MIN(ts) a, MAX(ts) b FROM buckets WHERE grain = ?').get(GRAIN);
  if (!span || span.a == null) { console.error(`✗ no ${GRAIN} buckets in the archive — nothing to build.`); process.exit(1); }

  // Reference windows spread evenly across the archive's usable depth. "Usable" = enough history behind
  // it for the volatility/mid basis and enough ahead of it for the longest horizon. Even spacing over 61
  // days also de-correlates the diurnal phase, so a cell is not six reads of the same hour of day.
  const first = span.a + VOL_DAYS * DAY;
  const last = span.b - MAX_HORIZON * DAY;
  if (last <= first) { console.error('✗ archive span too short for the requested vol-days + horizon.'); process.exit(1); }
  const step = N_WINDOWS > 1 ? (last - first) / (N_WINDOWS - 1) : 0;
  const windows = Array.from({ length: N_WINDOWS }, (_, i) => Math.round(first + i * step));

  // Candidate pool: items with enough archived rows to have a chance of clearing the coverage floor.
  // A cheap SQL pre-filter only; the real density test is per-observation, on the PRIOR window.
  const minRows = Math.max(1, Math.round(MIN_COVERAGE * VOL_DAYS * DAY / BUCKET_S));
  let ids = h.db.prepare(
    `SELECT itemId, COUNT(*) n FROM observations WHERE grain = ? GROUP BY itemId HAVING n >= ? ORDER BY itemId`
  ).all(GRAIN, minRows).map(r => r.itemId);
  if (LIMIT > 0 && ids.length > LIMIT) {
    const k = ids.length / LIMIT;                    // deterministic even thinning across the id space
    ids = Array.from({ length: LIMIT }, (_, i) => ids[Math.floor(i * k)]);
  }

  console.log(`\nAB2 — building the ask fill surface (${GRAIN} grain)`);
  console.log(`  archive span   ${new Date(span.a * 1000).toISOString().slice(0, 10)} → ${new Date(span.b * 1000).toISOString().slice(0, 10)}  (${((span.b - span.a) / DAY).toFixed(0)}d)`);
  console.log(`  windows        ${windows.length} @ ${windows.map(w => new Date(w * 1000).toISOString().slice(5, 10)).join(' · ')}`);
  console.log(`  candidates     ${ids.length} items (≥${minRows} ${GRAIN} rows)`);
  console.log(`  mid basis      prior-${MID_HOURS}h mean avgHighPrice (PINNED)  ·  vol basis prior-${VOL_DAYS}d relStd  ·  density floor ${(MIN_COVERAGE * 100).toFixed(0)}%\n`);

  // ---- pass 1: observations (features + outcome max), no binning yet (vol terciles aren't known) ----
  //
  // READ SHAPE — one BULK RANGE SCAN PER WINDOW, not one query per item. The measured reason: the
  // `observations` table is WITHOUT ROWID on PK (grain, ts, itemId), so a per-item read walks the
  // secondary index and then does one random PK seek per row — ~4,000 items × ~1,700 rows = ~7M random
  // seeks into a multi-GB B-tree (22 minutes, timed). Reading `ts BETWEEN a AND b` instead is a
  // CONTIGUOUS scan of the primary key, and every item's window comes out of it for free.
  //
  // The ts→timestamp RENAME still has to happen here (archive rows carry `ts`; every consumer, this
  // module's `printedAt` and `itemFeaturesFromSeries` included, keys on `timestamp`) — that is
  // `archive-series.mjs`'s whole reason to exist, and skipping the adapter means owning its contract.
  // We do it at row construction below, and `printedAt` THROWS on a `ts`-shaped row as the backstop.
  const idSet = new Set(ids);
  const obs = [];   // { itemId, window, mid, relStd, coverage, tier, byHorizon: { [d]: maxHigh|null } }
  let skippedSparse = 0, skippedNoMid = 0, skippedNoVol = 0, skippedNoOutcome = 0;
  const t0 = Date.now();
  const rangeStmt = h.db.prepare(
    // No ORDER BY: neither `printedAt` nor `itemFeaturesFromSeries` assumes an order (both filter by
    // window), so forcing one would buy a 700k-row temp sort per window for nothing.
    'SELECT itemId, ts, avgHighPrice FROM observations WHERE grain = ? AND ts >= ? AND ts <= ?');
  for (let wi = 0; wi < windows.length; wi++) {
    const w = windows[wi];
    const lo = w - VOL_DAYS * DAY, hi = w + MAX_HORIZON * DAY;
    const byItem = new Map();
    for (const r of rangeStmt.all(GRAIN, lo, hi)) {
      if (!idSet.has(r.itemId)) continue;
      let a = byItem.get(r.itemId); if (!a) { a = []; byItem.set(r.itemId, a); }
      a.push({ timestamp: r.ts, avgHighPrice: r.avgHighPrice });   // THE RENAME (see the note above)
    }
    for (const [id, series] of byItem) {
      const f = itemFeaturesFromSeries(series, { at: w, midHours: MID_HOURS, volDays: VOL_DAYS, bucketSeconds: BUCKET_S });
      if (!Number.isFinite(f.mid) || f.midBuckets < MIN_MID_BUCKETS) { skippedNoMid++; continue; }
      if (!Number.isFinite(f.relStd)) { skippedNoVol++; continue; }
      if (f.coverage < MIN_COVERAGE) { skippedSparse++; continue; }
      const byHorizon = {};
      let any = false;
      for (const d of HORIZON_DAYS) {
        // ONE printedAt pass per (item, window, horizon) gives the window's observed max; every grid
        // premium is then the SAME comparison printedAt would make (`maxHigh >= mid × (1+premium)`),
        // arithmetic included — not a re-derivation through maxPremium, which would drift by float.
        // printedAt stays the single definition of the window semantics: exclusive at `from`, `>=` at
        // the threshold, and TRISTATE — `printed: null` means no archived bucket, which is dropped
        // rather than scored as a miss (§10/M4).
        const probe = printedAt(series, { mid: f.mid, premium: 0, horizon: d, from: w });
        if (probe.printed == null) { byHorizon[d] = null; continue; }
        byHorizon[d] = probe.maxHigh; any = true;
      }
      if (!any) { skippedNoOutcome++; continue; }
      obs.push({ itemId: id, window: w, mid: f.mid, relStd: f.relStd, coverage: f.coverage, tier: f.priceTier, byHorizon });
    }
    process.stdout.write(`  …window ${wi + 1}/${windows.length} (${obs.length} observations, ${((Date.now() - t0) / 1000).toFixed(0)}s)\r`);
  }
  process.stdout.write(' '.repeat(78) + '\r');

  if (!obs.length) { console.error('✗ zero usable observations — check --min-coverage / --windows.'); process.exit(1); }

  // ---- volatility terciles: SAMPLE-RELATIVE, measured here and stamped into the artifact ----
  const stds = obs.map(o => o.relStd).sort((a, b) => a - b);
  const q = p => stds[Math.min(stds.length - 1, Math.floor(p * stds.length))];
  const volBandCuts = [q(1 / 3), q(2 / 3)];

  // ---- pass 2: bin ----
  const cells = new Map(), volPooled = new Map(), pooled = new Map();
  const itemSet = new Set();
  for (const o of obs) {
    const band = volBandOf(o.relStd, volBandCuts);
    itemSet.add(o.itemId);
    for (const d of HORIZON_DAYS) {
      const maxHigh = o.byHorizon[d];
      if (maxHigh == null) continue;                 // no archived print in the window → NOT a miss
      for (const prem of PREMIUM_GRID) {
        // `printedAt`'s own test, byte-for-byte: avgHighPrice >= mid × (1 + premium).
        const hit = maxHigh >= o.mid * (1 + prem);
        bump(cells, cellKey(d, o.tier, band, prem), o.itemId, o.window, hit);
        bump(volPooled, volPooledKey(d, o.tier, prem), o.itemId, o.window, hit);
        bump(pooled, pooledKey(d, prem), o.itemId, o.window, hit);
      }
    }
  }

  const rnd = mulberry32(20260807);
  const surface = {
    schema: SURFACE_SCHEMA,
    builtAt: Math.floor(Date.now() / 1000),
    meta: {
      grain: GRAIN,
      bucketSeconds: BUCKET_S,
      midBasis: `prior-${MID_HOURS}h mean avgHighPrice`,
      midHours: MID_HOURS,
      volBasis: `prior-${VOL_DAYS}d relative std of avgHighPrice`,
      volDays: VOL_DAYS,
      premiums: PREMIUM_GRID,
      horizonsDays: HORIZON_DAYS,
      priceTiers: PRICE_TIERS.map(t => t.key),
      volBandCuts,
      minCoverage: MIN_COVERAGE,
      minMidBuckets: MIN_MID_BUCKETS,
      windows,
      archiveSpan: [span.a, span.b],
      nItems: itemSet.size,
      nObservations: obs.length,
      skipped: { sparse: skippedSparse, noMid: skippedNoMid, noVol: skippedNoVol, noOutcome: skippedNoOutcome },
      bootstrapB: BOOT,
      ciMethod: 'item-cluster bootstrap (resample items with replacement), seeded',
      separationClaimableAtPremium: SEPARATION_PREMIUM,
      levelUncertaintyPp: LEVEL_UNCERTAINTY_PP,
      limits: [
        'PRINT PROXY: avgHighPrice >= level proves buyers PAID >= level, not that YOUR ask was taken. A conservative lower bound at qty=1; silent about size.',
        'DENSE ITEMS ONLY: items below the coverage floor are excluded; on sparse items the levels are partly a coverage artifact (an unarchived bucket can never print).',
        'LEVELS ±2-3pp, not ±1pp: the stored CI is an item-cluster bootstrap and does NOT capture window clustering. See windowSpread per cell.',
        'ITEM-AXIS SEPARATION is claimable at premiums >=2% only; below ~1% the volatility ordering is unresolved.',
        'MONOTONICITY IN PREMIUM AND HORIZON IS TRUE BY CONSTRUCTION (nested events) and is NOT evidence of anything.',
        'ONE MARKET PERIOD: the reference windows sit inside a single ~70-day stretch. This rules out a lucky fortnight, not a different macro regime.',
      ],
    },
    cells: finalize(cells, rnd, BOOT),
    cellsVolPooled: finalize(volPooled, rnd, BOOT),
    pooled: finalize(pooled, rnd, BOOT),
  };

  // ---- report ----
  console.log(`observations ${obs.length} over ${itemSet.size} items · skipped: ${skippedSparse} sparse, ${skippedNoMid} no-mid, ${skippedNoVol} no-vol, ${skippedNoOutcome} no-outcome`);
  console.log(`vol band cuts (sample terciles of relStd): ${volBandCuts.map(c => c.toFixed(4)).join(' · ')}\n`);

  console.log('POOLED — P(print >= mid×(1+premium)) within the horizon   [levels only; the monotonicity is by construction]');
  console.log('  premium |   ≤1d  |   ≤3d  | n(3d)  | items | 95% CI (3d, item-cluster) | window spread');
  console.log('  ' + '-'.repeat(96));
  for (const prem of PREMIUM_GRID) {
    const c1 = surface.pooled[pooledKey(1, prem)], c3 = surface.pooled[pooledKey(3, prem)];
    const ci = c3 && c3.ci ? `${pct(c3.ci[0])}–${pct(c3.ci[1])}%` : '—';
    console.log(`  ${('+' + (prem * 100).toFixed(1) + '%').padStart(7)} | ${pct(c1 && c1.p)}% | ${pct(c3 && c3.p)}% | ${String(c3 ? c3.n : 0).padStart(6)} | ${String(c3 ? c3.nItems : 0).padStart(5)} |      ${ci.padEnd(20)} | ${c3 && c3.windowSpread != null ? (c3.windowSpread * 100).toFixed(1) + 'pp' : '—'}`);
  }

  console.log('\nBY PRICE TIER (3d horizon) — the key whose omission overstates big-ticket fill by ~30pp');
  console.log('  premium | ' + PRICE_TIERS.map(t => t.key.padStart(8)).join(' | '));
  console.log('  ' + '-'.repeat(60));
  for (const prem of PREMIUM_GRID) {
    const cellsRow = PRICE_TIERS.map(t => { const c = surface.cellsVolPooled[volPooledKey(3, t.key, prem)]; return (c && c.p != null ? (c.p * 100).toFixed(1) + '%' : '—').padStart(8); });
    console.log(`  ${('+' + (prem * 100).toFixed(1) + '%').padStart(7)} | ${cellsRow.join(' | ')}`);
  }
  console.log('  n       | ' + PRICE_TIERS.map(t => { const c = surface.cellsVolPooled[volPooledKey(3, t.key, 0.02)]; return String(c ? c.n : 0).padStart(8); }).join(' | '));

  console.log('\nBY VOLATILITY BAND (3d horizon) — the item axis; separation claimable at ≥2% only');
  console.log('  premium |   lowVol |   midVol |  highVol');
  console.log('  ' + '-'.repeat(44));
  for (const prem of PREMIUM_GRID) {
    const row = ['lowVol', 'midVol', 'highVol'].map(b => {
      let n = 0, hits = 0;
      for (const t of PRICE_TIERS) { const c = surface.cells[cellKey(3, t.key, b, prem)]; if (c) { n += c.n; hits += c.hits; } }
      return (n ? (hits / n * 100).toFixed(1) + '%' : '—').padStart(8);
    });
    console.log(`  ${('+' + (prem * 100).toFixed(1) + '%').padStart(7)} | ${row.join(' | ')}${prem < SEPARATION_PREMIUM ? '   ← band not claimable here' : ''}`);
  }

  if (DRY) { console.log('\n--dry-run: nothing written.'); }
  else {
    fs.mkdirSync(pathMod.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(surface, null, 2));
    console.log(`\n✓ wrote ${OUT} (${Object.keys(surface.cells).length} keyed cells + ${Object.keys(surface.cellsVolPooled).length} vol-pooled + ${Object.keys(surface.pooled).length} pooled) at ${nowIso()}`);
  }
  console.log('READ-ONLY BUILDER. No live surface reads this. See the module header for what these numbers may not be used to claim.');
} finally { h.close(); }
