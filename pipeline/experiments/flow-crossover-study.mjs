#!/usr/bin/env node
/**
 * flow-crossover-study.mjs — does daily net order flow LEAD price turns? (research study, 2026-08-04)
 *
 * HYPOTHESIS (from ONE observed episode — item 29782 "Spider cave teleport", late July 2026):
 *   1. sustained negative net flow (lowPriceVolume > highPriceVolume, i.e. instasell-dominant)
 *      accompanies/precedes falling price;
 *   2. the flow flip negative→positive LEADS the price bottom (by ~3 days in the episode);
 *   3. flow reverting negative after a positive run precedes the rollover (top).
 *
 * DATA: the Tier-1 SQLite archive (pipeline/lib/market/archive.mjs), /1h grain, 2026-05-29 →
 * 2026-08-04. Daily panel is aggregated IN-DATABASE (one GROUP BY, no per-item fetch).
 * Day key = date(ts,'unixepoch') — UTC days, the same internal-aggregate convention as
 * archive.dailyRangeBulk (bucket ts is epoch UTC; these day keys are analysis keys, never
 * rendered timestamps, so the app's local-display convention does not apply). Only FULL days
 * (24/24 buckets market-wide) enter the panel — the partial first/last days are dropped.
 *
 * METHOD (defaults fixed BEFORE results were seen; the sensitivity grid is the multiplicity
 * disclosure — 27 configurations per side (X ∈ {3,5,8}% × k ∈ {1,2,3} × L ∈ {3,5,7}d), all
 * reported, none cherry-picked):
 *   panel     : per item per UTC day — instabuy vol (Σ highPriceVolume), instasell vol
 *               (Σ lowPriceVolume), flow ratio fr = (buy−sell)/(buy+sell), daily lo/hi/mid,
 *               volume-weighted mid (the price series used everywhere below).
 *   universe  : coverage ≥ MIN_COV of the full days AND median daily min(buyVol, sellVol)
 *               ≥ MIN_SIDE (two-sided liquidity — one-sided/ghost books produce fr = ±1 noise).
 *   turns     : bottom at t ⇔ vwMid[t] is the min of t±W, max(prior P days) ≥ (1+X)·vwMid[t],
 *               and max(next P days) ≥ (1+X)·vwMid[t]. Tops symmetric. W=2, P=7.
 *   crossover : k consecutive fr<0 days followed by k consecutive fr>0 days; the SIGNAL day is
 *               the day confirmation completes (last of the k positive days) — no lookahead.
 *   central   : hit = a labeled bottom within [signal, signal+L]; base rate = same-window
 *               probability over ALL evaluable item-days; LIFT = hit/base. Symmetric for tops.
 *   forward   : pooled fr-quintile → forward log-return distributions at +1/+3/+7d
 *               (median + IQR + mean + n), plus Spearman of fr vs SAME-day return
 *               (the mechanical-coupling confound) vs fr vs forward returns.
 *   fills     : positions.json closed lots joined to entry-day flow state — anecdote-with-
 *               numbers only (small n, concentrated), never validation.
 *
 * FINDINGS (2026-08-04 run, 65 full days, universe n=1,968 items; full report in
 * FLOW-CROSSOVER-FINDINGS.md):
 *   · The n=1 story does NOT generalize. Default config: bottom-crossover hit 60.2% vs base
 *     52.9% → lift 1.14 (n=2,314 events); tops 61.3% vs 51.3% → lift 1.19 (n=2,380). Whole
 *     grid: lift 1.09–1.29, never higher.
 *   · THE PLACEBO KILLS IT: the same events scored against the WRONG-side turn produce lift
 *     0.97–1.17 — nearly all of the "signal" is undirectional activity-clustering near turns,
 *     not order-flow information. Directional edge ≈ 0.03–0.10 lift (~2–4pp of hit rate).
 *   · The lead-time distribution is FLAT across ±7d (no peak at +3d or anywhere) — the
 *     episode's "flow flips 3 days before the bottom" is not a population regularity.
 *   · No forward signal in returns either: Spearman fr vs +1d return = −0.03 (fr vs same-day
 *     = +0.02 — even the feared mechanical coupling turns out negligible at daily grain); Q5
 *     heavy-buying days have slightly WORSE +1d medians than Q1 (−0.31% vs +0.01%) — mild
 *     mean reversion, the opposite sign to the hypothesis. Robust on a liquid-only universe
 *     (--min-side 1000, n=1,197 items: lift 1.18/1.24 vs placebo 1.14/1.14).
 *   · Verdict: NOT actionable. Do not build a flow-crossover gate/signal off this.
 *
 * USAGE:
 *   node pipeline/experiments/flow-crossover-study.mjs [--json] [--min-side N] [--min-cov N]
 *        [--seed-item ID]
 *   --json       machine-readable dump of every table
 *   --min-side   universe floor on median daily min(buyVol, sellVol)   (default 100)
 *   --min-cov    universe floor on days-with-data                       (default 60)
 *   --seed-item  item whose daily flow/price table is printed as the case anchor (default 29782)
 *
 * Removable per pipeline/experiments/README.md — nothing imports this.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from '../lib/market/archive.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');

// ---------- args ----------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return (i >= 0 && argv[i + 1] != null) ? Number(argv[i + 1]) : dflt;
};
const JSON_OUT = flag('--json');
const MIN_SIDE = opt('--min-side', 100);   // median daily min(buyVol, sellVol) floor
const MIN_COV = opt('--min-cov', 60);      // days-with-data floor
const SEED_ITEM = opt('--seed-item', 29782);

// Defaults for the turn/crossover machinery — FIXED before results were seen.
const W = 2;              // local-extremum half-window (days)
const P = 7;              // prior-decline / post-rise lookback-lookahead (days)
const DEF_X = 0.05;       // turn amplitude threshold (5%)
const DEF_K = 2;          // crossover sustain (days each side)
const DEF_L = 5;          // hit window after signal day (days)
const GRID_X = [0.03, 0.05, 0.08];
const GRID_K = [1, 2, 3];
const GRID_L = [3, 5, 7];

// ---------- helpers ----------
const fmtN = (v, d = 0) => v == null || Number.isNaN(v) ? '—'
  : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v, d = 1) => v == null || Number.isNaN(v) ? '—' : (v * 100).toFixed(d) + '%';
function table(rows, aligns) {
  // rows: array of string arrays (first = header). aligns: 'l'/'r' per column.
  const w = [];
  for (const r of rows) r.forEach((c, i) => { w[i] = Math.max(w[i] || 0, String(c).length); });
  return rows.map(r => r.map((c, i) =>
    (aligns && aligns[i] === 'l') ? String(c).padEnd(w[i]) : String(c).padStart(w[i])
  ).join('  ')).join('\n');
}
function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }
function spearman(pairs) {
  // pairs: [[x,y],...] → Spearman rho (Pearson on average ranks).
  const n = pairs.length;
  if (n < 3) return null;
  const rank = (vals) => {
    const idx = vals.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(n);
    for (let i = 0; i < n;) {
      let j = i; while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(pairs.map(p => p[0])), ry = rank(pairs.map(p => p[1]));
  const mx = mean(rx), my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = rx[i] - mx, b = ry[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  return (dx && dy) ? num / Math.sqrt(dx * dy) : null;
}

// ---------- 1. daily panel (in-database aggregation) ----------
const a = open(undefined, { readonly: true });
const db = a.db;

// Full days only: 24/24 whole-market 1h buckets.
const covRows = db.prepare(
  `SELECT date(ts,'unixepoch') AS d, COUNT(*) AS n FROM buckets WHERE grain='1h' GROUP BY d ORDER BY d`).all();
const fullDays = covRows.filter(r => r.n === 24).map(r => r.d);
const dayIdx = new Map(fullDays.map((d, i) => [d, i]));
const D = fullDays.length;
const droppedDays = covRows.filter(r => r.n !== 24).map(r => `${r.d}(${r.n})`);

const panelRows = db.prepare(`
  SELECT itemId, date(ts,'unixepoch') AS d,
         SUM(COALESCE(highPriceVolume,0)) AS bv,
         SUM(COALESCE(lowPriceVolume,0))  AS sv,
         MIN(avgLowPrice)  AS lo,
         MAX(avgHighPrice) AS hi,
         SUM(CASE WHEN avgHighPrice IS NOT NULL THEN CAST(avgHighPrice AS REAL)*COALESCE(highPriceVolume,0) ELSE 0 END
           + CASE WHEN avgLowPrice  IS NOT NULL THEN CAST(avgLowPrice  AS REAL)*COALESCE(lowPriceVolume,0)  ELSE 0 END) AS pnum,
         SUM(CASE WHEN avgHighPrice IS NOT NULL THEN COALESCE(highPriceVolume,0) ELSE 0 END
           + CASE WHEN avgLowPrice  IS NOT NULL THEN COALESCE(lowPriceVolume,0)  ELSE 0 END) AS pden,
         COUNT(*) AS nb
    FROM observations WHERE grain='1h'
   GROUP BY itemId, d`).all();

// items: Map<itemId, { bv,sv,fr,vw,mid: Float64Array-ish arrays length D (null = missing) }>
const items = new Map();
function blank() {
  return {
    bv: new Array(D).fill(null), sv: new Array(D).fill(null),
    fr: new Array(D).fill(null), vw: new Array(D).fill(null), mid: new Array(D).fill(null),
  };
}
for (const r of panelRows) {
  const di = dayIdx.get(r.d);
  if (di == null) continue;                       // partial day — dropped
  let it = items.get(r.itemId);
  if (!it) { it = blank(); items.set(r.itemId, it); }
  const bv = Number(r.bv || 0), sv = Number(r.sv || 0), tot = bv + sv;
  it.bv[di] = bv; it.sv[di] = sv;
  it.fr[di] = tot > 0 ? (bv - sv) / tot : null;
  it.vw[di] = (r.pden > 0) ? r.pnum / r.pden : null;
  it.mid[di] = (r.lo != null && r.hi != null) ? (r.lo + r.hi) / 2
    : (r.lo != null ? r.lo : (r.hi != null ? r.hi : null));
}

// ---------- 2. universe ----------
const universe = [];
for (const [id, it] of items) {
  let cov = 0; const minSides = [];
  for (let t = 0; t < D; t++) {
    if (it.vw[t] != null && it.fr[t] != null) cov++;
    if (it.bv[t] != null) minSides.push(Math.min(it.bv[t], it.sv[t]));
  }
  if (cov >= MIN_COV && median(minSides) >= MIN_SIDE) universe.push(id);
}
universe.sort((x, y) => x - y);
const uniSet = new Set(universe);

// item names (best-effort, from the shared mapping cache; degrade to ids).
let names = {};
try {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'pipeline', '.cache', 'mapping.cache.json'), 'utf8'));
  for (const id in m) names[id] = m[id] && m[id].name;
} catch { /* names optional */ }
const nameOf = id => names[id] || `#${id}`;

// ---------- 3. turn labeling ----------
function labelTurns(vw, X) {
  // returns { bottoms:Set<dayIdx>, tops:Set<dayIdx> }
  const bottoms = new Set(), tops = new Set();
  for (let t = P; t <= D - 1 - P; t++) {
    const v = vw[t]; if (v == null) continue;
    let winOk = true, isMin = true, isMax = true;
    for (let j = t - W; j <= t + W; j++) {
      if (vw[j] == null) { winOk = false; break; }
      if (j !== t && vw[j] < v) isMin = false;
      if (j !== t && vw[j] > v) isMax = false;
    }
    if (!winOk) continue;
    if (isMin) {
      let priorMax = -Infinity, nextMax = -Infinity;
      for (let j = t - P; j < t; j++) if (vw[j] != null && vw[j] > priorMax) priorMax = vw[j];
      for (let j = t + 1; j <= t + P; j++) if (vw[j] != null && vw[j] > nextMax) nextMax = vw[j];
      if (priorMax >= v * (1 + X) && nextMax >= v * (1 + X)) bottoms.add(t);
    }
    if (isMax) {
      let priorMin = Infinity, nextMin = Infinity;
      for (let j = t - P; j < t; j++) if (vw[j] != null && vw[j] < priorMin) priorMin = vw[j];
      for (let j = t + 1; j <= t + P; j++) if (vw[j] != null && vw[j] < nextMin) nextMin = vw[j];
      if (priorMin <= v * (1 - X) && nextMin <= v * (1 - X)) tops.add(t);
    }
  }
  return { bottoms, tops };
}

// ---------- 4. crossovers ----------
function crossovers(fr, k, dir) {
  // dir +1: k consecutive fr<0 then k consecutive fr>0 (signal = last positive day).
  // dir −1: symmetric. Missing/zero fr breaks a run. Signal day has NO lookahead.
  const out = [];
  for (let t = 0; t <= D - 1; t++) {
    let ok = true;
    for (let j = t - k + 1; j <= t; j++) {                 // k confirm days ending at t
      const v = (j >= 0) ? fr[j] : null;
      if (v == null || (dir > 0 ? v <= 0 : v >= 0)) { ok = false; break; }
    }
    if (!ok) continue;
    for (let j = t - 2 * k + 1; j <= t - k; j++) {         // k prior opposite-sign days
      const v = (j >= 0) ? fr[j] : null;
      if (v == null || (dir > 0 ? v >= 0 : v <= 0)) { ok = false; break; }
    }
    if (ok) out.push(t);
  }
  return out;
}

// ---------- 5. THE CENTRAL TEST: hit rate vs base rate, over the full grid ----------
function centralTest(X, k, L) {
  // Evaluable signal days: t ∈ [P, D-1-P-L] so [t, t+L] sits fully inside the turn-labelable range.
  const tMin = P, tMax = D - 1 - P - L;
  let hitB = 0, nB = 0, hitT = 0, nT = 0, baseHitB = 0, baseHitT = 0, baseN = 0, plaB = 0, plaT = 0;
  const leadsB = [], leadsT = [];
  for (const id of universe) {
    const it = items.get(id);
    const { bottoms, tops } = labelTurns(it.vw, X);
    // base rate: all evaluable item-days with data
    for (let t = tMin; t <= tMax; t++) {
      if (it.fr[t] == null || it.vw[t] == null) continue;
      baseN++;
      let hb = false, ht = false;
      for (let j = t; j <= t + L; j++) { if (bottoms.has(j)) hb = true; if (tops.has(j)) ht = true; }
      if (hb) baseHitB++;
      if (ht) baseHitT++;
    }
    // events (placebo: the SAME event scored against the WRONG-side turn — if a neg→pos
    // crossover "predicts" tops as well as bottoms, the lift is undirectional activity-
    // clustering near turns, not order-flow information)
    for (const t of crossovers(it.fr, k, +1)) {
      if (t < tMin || t > tMax) continue;
      nB++;
      let hit = false, phit = false;
      for (let j = t; j <= t + L; j++) {
        if (bottoms.has(j)) hit = true;
        if (tops.has(j)) phit = true;
      }
      if (hit) hitB++;
      if (phit) plaB++;
      for (let j = t - P; j <= t + P; j++) if (bottoms.has(j)) leadsB.push(j - t); // context distribution
    }
    for (const t of crossovers(it.fr, k, -1)) {
      if (t < tMin || t > tMax) continue;
      nT++;
      let hit = false, phit = false;
      for (let j = t; j <= t + L; j++) {
        if (tops.has(j)) hit = true;
        if (bottoms.has(j)) phit = true;
      }
      if (hit) hitT++;
      if (phit) plaT++;
      for (let j = t - P; j <= t + P; j++) if (tops.has(j)) leadsT.push(j - t);
    }
  }
  const hrB = nB ? hitB / nB : null, brB = baseN ? baseHitB / baseN : null;
  const hrT = nT ? hitT / nT : null, brT = baseN ? baseHitT / baseN : null;
  return {
    X, k, L, baseN,
    bottoms: { n: nB, hit: hitB, hitRate: hrB, baseRate: brB, lift: (hrB != null && brB) ? hrB / brB : null, placeboLift: (nB && brT) ? (plaB / nB) / brT : null, leads: leadsB },
    tops: { n: nT, hit: hitT, hitRate: hrT, baseRate: brT, lift: (hrT != null && brT) ? hrT / brT : null, placeboLift: (nT && brB) ? (plaT / nT) / brB : null, leads: leadsT },
  };
}

const grid = [];
for (const X of GRID_X) for (const k of GRID_K) for (const L of GRID_L) grid.push(centralTest(X, k, L));
const def = grid.find(g => g.X === DEF_X && g.k === DEF_K && g.L === DEF_L);
const N_CONFIGS = GRID_X.length * GRID_K.length * GRID_L.length; // per side

// ---------- 6. forward returns by flow-ratio quintile + coupling ----------
const HORIZONS = [1, 3, 7];
const pooled = [];   // { fr, r0, r1, r3, r7 } per universe item-day
for (const id of universe) {
  const it = items.get(id);
  for (let t = 1; t < D; t++) {
    const fr = it.fr[t], v = it.vw[t];
    if (fr == null || v == null || v <= 0) continue;
    const row = { fr };
    const vPrev = it.vw[t - 1];
    row.r0 = (vPrev != null && vPrev > 0) ? Math.log(v / vPrev) : null;
    for (const h of HORIZONS) {
      const vF = (t + h < D) ? it.vw[t + h] : null;
      row['r' + h] = (vF != null && vF > 0) ? Math.log(vF / v) : null;
    }
    pooled.push(row);
  }
}
const frSorted = pooled.map(r => r.fr).sort((x, y) => x - y);
const qBreaks = [0.2, 0.4, 0.6, 0.8].map(q => quantile(frSorted, q));
const quintOf = fr => { let q = 0; while (q < 4 && fr > qBreaks[q]) q++; return q; };
const quintiles = Array.from({ length: 5 }, () => ({ fr: [], r0: [], r1: [], r3: [], r7: [] }));
for (const r of pooled) {
  const q = quintiles[quintOf(r.fr)];
  q.fr.push(r.fr);
  for (const key of ['r0', 'r1', 'r3', 'r7']) if (r[key] != null) q[key].push(r[key]);
}
const quintileStats = quintiles.map((q, i) => {
  const st = { quintile: i + 1, n: q.fr.length, frMedian: median(q.fr) };
  for (const key of ['r0', 'r1', 'r3', 'r7']) {
    const s = [...q[key]].sort((x, y) => x - y);
    st[key] = { n: s.length, median: median(s), p25: quantile(s, 0.25), p75: quantile(s, 0.75), mean: mean(s) };
  }
  return st;
});
const rhoSame = spearman(pooled.filter(r => r.r0 != null).map(r => [r.fr, r.r0]));
const rhoF1 = spearman(pooled.filter(r => r.r1 != null).map(r => [r.fr, r.r1]));
const rhoF3 = spearman(pooled.filter(r => r.r3 != null).map(r => [r.fr, r.r3]));
const rhoF7 = spearman(pooled.filter(r => r.r7 != null).map(r => [r.fr, r.r7]));

// sustained-run framing: ≥3-day same-sign flow runs → forward returns from the 3rd day
const runBuckets = { 'neg-run≥3': { r1: [], r3: [], r7: [] }, 'pos-run≥3': { r1: [], r3: [], r7: [] } };
for (const id of universe) {
  const it = items.get(id);
  for (let t = 2; t < D; t++) {
    const s0 = it.fr[t], s1 = it.fr[t - 1], s2 = it.fr[t - 2], v = it.vw[t];
    if (s0 == null || s1 == null || s2 == null || v == null || v <= 0) continue;
    let key = null;
    if (s0 > 0 && s1 > 0 && s2 > 0) key = 'pos-run≥3';
    else if (s0 < 0 && s1 < 0 && s2 < 0) key = 'neg-run≥3';
    if (!key) continue;
    for (const h of HORIZONS) {
      const vF = (t + h < D) ? it.vw[t + h] : null;
      if (vF != null && vF > 0) runBuckets[key]['r' + h].push(Math.log(vF / v));
    }
  }
}

// ---------- 7. real-fills cross-check (anecdote-with-numbers ONLY) ----------
let fills = null;
try {
  const pos = JSON.parse(fs.readFileSync(path.join(ROOT, 'positions.json'), 'utf8'));
  const buckets = {
    'fr < −0.1': { n: 0, wins: 0, realised: [], items: new Set() },
    '−0.1 … +0.1': { n: 0, wins: 0, realised: [], items: new Set() },
    'fr > +0.1': { n: 0, wins: 0, realised: [], items: new Set() },
    'no flow data': { n: 0, wins: 0, realised: [], items: new Set() },
  };
  let total = 0;
  const perItem = new Map();
  for (const c of pos.closed || []) {
    if (!c.buyTs) continue;
    const d = new Date(c.buyTs * 1000).toISOString().slice(0, 10);
    const di = dayIdx.get(d);
    const it = items.get(c.itemId);
    const fr = (di != null && it) ? it.fr[di] : null;
    const key = fr == null ? 'no flow data' : fr < -0.1 ? 'fr < −0.1' : fr > 0.1 ? 'fr > +0.1' : '−0.1 … +0.1';
    const b = buckets[key];
    b.n++; if (c.realised > 0) b.wins++;
    b.realised.push(c.realised); b.items.add(c.itemId);
    total++;
    perItem.set(c.itemId, (perItem.get(c.itemId) || 0) + 1);
  }
  const top = [...perItem.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3);
  fills = { total, buckets, topConcentration: top.map(([id, n]) => ({ id, name: nameOf(id), n })) };
} catch { /* positions.json unreadable → skip */ }

// ---------- 8. structural comparison (EXPLORATORY; crude name-pattern classes) ----------
const classes = { teleport: [], rune: [], 'potion(4)': [], other: [] };
for (const id of universe) {
  const n = (names[id] || '').toLowerCase();
  if (/teleport/.test(n)) classes.teleport.push(id);
  else if (/ rune$/.test(n)) classes.rune.push(id);
  else if (/\(4\)$/.test(n) || /potion/.test(n)) classes['potion(4)'].push(id);
  else classes.other.push(id);
}
const structural = {};
for (const [cls, ids] of Object.entries(classes)) {
  const same = [], fwd3 = [], fwd3Pos = [], fwd3Neg = [];
  for (const id of ids) {
    const it = items.get(id);
    for (let t = 1; t < D - 3; t++) {
      const fr = it.fr[t], v = it.vw[t], vPrev = it.vw[t - 1], vF = it.vw[t + 3];
      if (fr == null || v == null || v <= 0) continue;
      if (vPrev != null && vPrev > 0) same.push([fr, Math.log(v / vPrev)]);
      if (vF != null && vF > 0) {
        const r = Math.log(vF / v);
        fwd3.push([fr, r]);
        if (fr > 0) fwd3Pos.push(r); else if (fr < 0) fwd3Neg.push(r);
      }
    }
  }
  structural[cls] = {
    nItems: ids.length,
    rhoSameDay: spearman(same),
    rhoFwd3: spearman(fwd3),
    fwd3MedPosFlow: median(fwd3Pos), nPos: fwd3Pos.length,
    fwd3MedNegFlow: median(fwd3Neg), nNeg: fwd3Neg.length,
  };
}

// ---------- 9. seed-item case table ----------
let seedCase = null;
{
  const it = items.get(SEED_ITEM);
  if (it) {
    seedCase = { id: SEED_ITEM, name: nameOf(SEED_ITEM), inUniverse: uniSet.has(SEED_ITEM), days: [] };
    for (let t = 0; t < D; t++) {
      if (fullDays[t] < '2026-07-20') continue;
      if (it.bv[t] == null) continue;
      seedCase.days.push({
        day: fullDays[t], buyVol: it.bv[t], sellVol: it.sv[t],
        net: it.bv[t] - it.sv[t], fr: it.fr[t], vwMid: it.vw[t],
      });
    }
  }
}

a.close();

// ---------- output ----------
const results = {
  generatedAt: new Date().toISOString(),
  convention: 'UTC day buckets over /1h archive observations; full 24/24-bucket days only',
  panel: { fullDays: D, firstDay: fullDays[0], lastDay: fullDays[D - 1], droppedPartialDays: droppedDays, itemsInArchive: items.size },
  universeFilter: { minMedianDailyMinSideVol: MIN_SIDE, minCoverageDays: MIN_COV, itemsSurviving: universe.length },
  method: { W, P, defaults: { X: DEF_X, k: DEF_K, L: DEF_L }, grid: { X: GRID_X, k: GRID_K, L: GRID_L }, configurationsPerSide: N_CONFIGS },
  centralTest: { default: def, grid: grid.map(g => ({ X: g.X, k: g.k, L: g.L, baseN: g.baseN, bottoms: { ...g.bottoms, leads: undefined }, tops: { ...g.tops, leads: undefined } })) },
  leadDistribution: {
    note: 'signed day-offset of every labeled turn within ±' + P + 'd of a crossover signal day (default config); negative = turn BEFORE the signal',
    bottoms: def.bottoms.leads, tops: def.tops.leads,
  },
  forwardReturns: { quintileBreaks: qBreaks, quintiles: quintileStats, runBuckets: Object.fromEntries(Object.entries(runBuckets).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([h, xs]) => { const s = [...xs].sort((a, b) => a - b); return [h, { n: s.length, median: median(s), p25: quantile(s, 0.25), p75: quantile(s, 0.75) }]; }))])) },
  coupling: { rhoSameDay: rhoSame, rhoFwd1: rhoF1, rhoFwd3: rhoF3, rhoFwd7: rhoF7 },
  fills,
  structural,
  seedCase,
};

if (JSON_OUT) {
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}

console.log(`flow-crossover-study — daily net order flow vs price turns`);
console.log(`panel: ${D} full UTC days (${fullDays[0]} → ${fullDays[D - 1]}); dropped partial: ${droppedDays.join(', ') || 'none'}`);
console.log(`universe: ${universe.length} of ${items.size} archived items (coverage ≥ ${MIN_COV}d AND median daily min-side vol ≥ ${fmtN(MIN_SIDE)})`);
console.log(`configs tried: ${N_CONFIGS} per side (X ∈ {${GRID_X.map(x => pct(x, 0)).join(',')}} × k ∈ {${GRID_K.join(',')}} × L ∈ {${GRID_L.join(',')}}d) — ALL reported below\n`);

if (seedCase) {
  console.log(`── seed case: ${seedCase.name} (#${seedCase.id})${seedCase.inUniverse ? '' : '  [NOT in universe]'} — from 2026-07-20 ──`);
  console.log(table([
    ['day', 'instabuy', 'instasell', 'net', 'flowRatio', 'vwMid'],
    ...seedCase.days.map(r => [r.day, fmtN(r.buyVol), fmtN(r.sellVol), fmtN(r.net), r.fr == null ? '—' : r.fr.toFixed(3), fmtN(r.vwMid)]),
  ], ['l', 'r', 'r', 'r', 'r', 'r']));
  console.log('');
}

console.log(`── CENTRAL TEST: crossover hit rate vs base rate (default X=${pct(DEF_X, 0)} k=${DEF_K} L=${DEF_L}d) ──`);
const ct = (side, s, br) => [side, fmtN(s.n), fmtN(s.hit), pct(s.hitRate), pct(br),
  s.lift == null ? '—' : s.lift.toFixed(2), s.placeboLift == null ? '—' : s.placeboLift.toFixed(2)];
console.log(table([
  ['side', 'events', 'hits', 'hitRate', 'baseRate', 'LIFT', 'placeboLIFT'],
  ct('neg→pos ⇒ bottom≤' + DEF_L + 'd', def.bottoms, def.bottoms.baseRate),
  ct('pos→neg ⇒ top≤' + DEF_L + 'd', def.tops, def.tops.baseRate),
], ['l', 'r', 'r', 'r', 'r', 'r', 'r']));
console.log(`  (placeboLIFT = the SAME events scored against the WRONG-side turn ÷ that side's base rate;`);
console.log(`   placebo ≈ real ⇒ the lift is activity-clustering near turns, not directional information)`);

const leadHist = (leads) => {
  const h = new Map();
  for (const l of leads) h.set(l, (h.get(l) || 0) + 1);
  return [...h.entries()].sort((a, b) => a[0] - b[0]).map(([l, n]) => `${l >= 0 ? '+' : ''}${l}d:${n}`).join('  ');
};
console.log(`\nlead-time distribution (turn-day − signal-day, all turns within ±${P}d; NEGATIVE = turn happened BEFORE the signal):`);
console.log(`  bottoms: ${leadHist(def.bottoms.leads) || 'none'}`);
console.log(`  tops:    ${leadHist(def.tops.leads) || 'none'}`);

console.log(`\n── sensitivity grid (${N_CONFIGS} configs/side — the multiplicity disclosure) ──`);
console.log(table([
  ['X', 'k', 'L', 'B-events', 'B-hit', 'B-base', 'B-LIFT', 'B-plac', 'T-events', 'T-hit', 'T-base', 'T-LIFT', 'T-plac'],
  ...grid.map(g => [
    pct(g.X, 0), g.k, g.L + 'd',
    fmtN(g.bottoms.n), pct(g.bottoms.hitRate), pct(g.bottoms.baseRate), g.bottoms.lift == null ? '—' : g.bottoms.lift.toFixed(2),
    g.bottoms.placeboLift == null ? '—' : g.bottoms.placeboLift.toFixed(2),
    fmtN(g.tops.n), pct(g.tops.hitRate), pct(g.tops.baseRate), g.tops.lift == null ? '—' : g.tops.lift.toFixed(2),
    g.tops.placeboLift == null ? '—' : g.tops.placeboLift.toFixed(2),
  ]),
], ['r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r']));

console.log(`\n── forward returns by flow-ratio quintile (pooled universe item-days, n=${fmtN(pooled.length)}) ──`);
const qRow = (st) => {
  const f = (o) => o.n ? `${pct(o.median, 2)} [${pct(o.p25, 1)},${pct(o.p75, 1)}]` : '—';
  return [`Q${st.quintile}`, st.frMedian.toFixed(3), fmtN(st.n), f(st.r0), f(st.r1), f(st.r3), f(st.r7)];
};
console.log(table([
  ['quint', 'fr-med', 'n', 'same-day r [IQR]', '+1d', '+3d', '+7d'],
  ...quintileStats.map(qRow),
], ['l', 'r', 'r', 'r', 'r', 'r', 'r']));

console.log(`\n── mechanical-coupling check (Spearman rho, flow ratio vs log return) ──`);
console.log(table([
  ['horizon', 'rho', 'n'],
  ['same day (CONTEMPORANEOUS)', rhoSame.toFixed(3), fmtN(pooled.filter(r => r.r0 != null).length)],
  ['+1d forward', rhoF1.toFixed(3), fmtN(pooled.filter(r => r.r1 != null).length)],
  ['+3d forward', rhoF3.toFixed(3), fmtN(pooled.filter(r => r.r3 != null).length)],
  ['+7d forward', rhoF7.toFixed(3), fmtN(pooled.filter(r => r.r7 != null).length)],
], ['l', 'r', 'r']));

console.log(`\n── sustained-run forward returns (3rd consecutive same-sign flow day) ──`);
console.log(table([
  ['bucket', '+1d med [IQR]', 'n', '+3d med', 'n', '+7d med', 'n'],
  ...Object.entries(runBuckets).map(([k, v]) => {
    const s = (xs) => { const so = [...xs].sort((a, b) => a - b); return `${pct(median(so), 2)} [${pct(quantile(so, 0.25), 1)},${pct(quantile(so, 0.75), 1)}]`; };
    const m = (xs) => pct(median([...xs].sort((a, b) => a - b)), 2);
    return [k, s(v.r1), fmtN(v.r1.length), m(v.r3), fmtN(v.r3.length), m(v.r7), fmtN(v.r7.length)];
  }),
], ['l', 'r', 'r', 'r', 'r', 'r', 'r']));

if (fills) {
  console.log(`\n── real fills cross-check (positions.json closed lots, n=${fills.total} — ANECDOTE, not validation) ──`);
  console.log(table([
    ['entry-day flow state', 'lots', 'wins', 'winRate', 'median realised', 'items'],
    ...Object.entries(fills.buckets).map(([k, b]) => [
      k, fmtN(b.n), fmtN(b.wins), b.n ? pct(b.wins / b.n) : '—', fmtN(median(b.realised)), fmtN(b.items.size),
    ]),
  ], ['l', 'r', 'r', 'r', 'r', 'r']));
  console.log(`  concentration: top items by lot count — ${fills.topConcentration.map(t => `${t.name} ×${t.n}`).join(', ')}`);
}

console.log(`\n── structural comparison (EXPLORATORY — crude name-pattern classes, not a validated taxonomy) ──`);
console.log(table([
  ['class', 'items', 'rho same-day', 'rho +3d', '+3d med | fr>0', 'n', '+3d med | fr<0', 'n'],
  ...Object.entries(structural).map(([k, s]) => [
    k, fmtN(s.nItems),
    s.rhoSameDay == null ? '—' : s.rhoSameDay.toFixed(3),
    s.rhoFwd3 == null ? '—' : s.rhoFwd3.toFixed(3),
    pct(s.fwd3MedPosFlow, 2), fmtN(s.nPos), pct(s.fwd3MedNegFlow, 2), fmtN(s.nNeg),
  ]),
], ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r']));

console.log(`\nHonesty notes: single ${D}-day window (no out-of-sample); turn labels use ±${P}d of FUTURE data`);
console.log(`by construction (fine for measuring lead/lag, unusable as a live signal); ${N_CONFIGS} configs/side`);
console.log(`were evaluated — judge lift stability across the WHOLE grid, not any single cell.`);
