#!/usr/bin/env node
/**
 * wk2-period-phase-universe.mjs — WK2 (plans/PLAN-WEEKLY-CYCLE.md §0, decisive measurement 3):
 * over the FULL item universe, which items cycle at the day scale on price LEVELS, which of those
 * are calendar-locked vs free-running vs inverted, and does the structure survive basket
 * subtraction (item vs one-market-index, plan §6)? This measurement DECIDES the program after
 * WK1's null. DIAGNOSTIC / INFORM-ONLY: nothing here gates, sizes, or auto-prices.
 *
 * ── PRE-REGISTERED DECISION RULE (committed BEFORE the first full run — the WK1 process gap,
 *    closed: this header + skeleton land as their own commit; results land as a second commit) ──
 *
 * SERIES. Per item, daily mid = mean over that LOCAL day's 1h buckets of (avgHigh+avgLow)/2
 * (hours with both sides present only; local day = display convention). Era = all full local days
 * in the archive up to yesterday. Deviation series d_t = mid_t / MA15(mid)_t − 1, MA15 = 15-day
 * CENTERED mean (loses 7 days each end). Window choice: a 15d centered detrend passes the whole
 * 3–14d band near-uniformly (gain ≈ 0.93+), where §1's 7d window would attenuate P≳10d — §1's
 * exact method is reproduced only in the five-item consistency check, not in detection.
 * QUALIFICATION (else item is NOT TESTED, reported as untested): ≥ 70 valid daily deviations AND
 * ≥ 85% day-coverage over the item's span (the contiguity the surrogate null assumes).
 *
 * DETECTION. Trial periods P = 3.00–14.00d step 0.25 (45 periods; the honest band: ≥ ~7 cycles at
 * P=14 over ~100d — NO claim outside it). Per P: least-squares fit d_t ≈ c + a·sin(2πt/P) +
 * b·cos(2πt/P) on actual day indices t; statistic S = max_P R²(P).
 * NULL: AR(1) surrogates — WK1 measured strong serial dependence (ρ≈0.61 on overlapping outcomes),
 * so an i.i.d. shuffle would call everything periodic; the null must carry the red-noise spectrum.
 * Fit r1 = lag-1 autocorrelation of d (consecutive-day pairs). Surrogate: x_t = r1·x_{t−1} + ε,
 * ε ~ N(0,1), 50-sample burn-in, contiguous length n, same S computed on the same period grid.
 * Calibration is BINNED (r1 clamped to [−0.30, 0.95] rounded to 0.05; n rounded to nearest 5),
 * ≥ 10,000 draws per bin, seeded mulberry32(20260908) — S is scale-free so unit innovation
 * variance suffices. Approximations, accepted and stated: Gaussian innovations (heavy tails mostly
 * rescale, which R² ignores) and contiguous surrogates vs ≤15% real gaps (bounded by the 85%
 * coverage floor). p_item = (1 + #{S* ≥ S}) / (1 + N_bin).
 * MULTIPLICITY: Benjamini–Hochberg FDR at q = 0.05 across all TESTED items, raw and
 * basket-subtracted runs each corrected within their own family; expected false discoveries
 * ≈ q × discoveries is REPORTED next to every discovery count.
 *
 * PER-DISCOVERY MEASUREMENTS (descriptive): dominant period P* = argmax R²; amplitude A from the
 * P* fit (peak-to-trough 2A, and "after-tax full-capture bound" 2A − 2.0% — an UPPER bound, full
 * amplitude capture is the §2a saturation trap); phase drift = |circular Δphase| between the P*
 * fits on the era's two halves, in days; for P* ∈ [6.5, 7.5]: CALENDAR-LOCKED iff drift ≤ 1.0d
 * (a locked trough stays pinned to the weekday; free-running drifts ~the era/2 × (P−7)/7),
 * trough WEEKDAY from the full-era 7.00d fit. Weekday classes (descriptive, §4 frame): trough
 * Mon–Wed = "basket-aligned", trough Fri–Sun = "inverted", else "other".
 *
 * BASKET SUBTRACTION (plan §6 item-vs-index). Basket_t = equal-weighted mean d_t over qualified
 * items with mean traded value ≥ 1m gp/day (dead items excluded from the index, not from testing).
 * d'_t = d_t − Basket_t; the whole detection pipeline reruns on d' (r1 refit on d'). The basket
 * series itself is also tested as if an item.
 *
 * PROGRAM-DECIDING BRANCHES (evaluated in order; thresholds fixed here, before the run):
 *  (a) PER-ITEM STRUCTURE WORTH BUILDING — ≥ 15 items that are FDR discoveries BOTH raw and
 *      basket-subtracted AND have 2A ≥ 4% (raw fit) AND mean traded value ≥ 5m gp/day AND phase
 *      drift ≤ 1.5d at P*. → measurements 2 and 4 revive; per-item derived-window overlay design
 *      becomes worth building.
 *  (b) ONE MARKET INDEX — (a) failed AND the basket tests p < 0.01 with P* ∈ [6, 8] AND more than
 *      half of the raw discoveries meeting (a)'s amplitude+liquidity floors are NOT discoveries
 *      after basket subtraction. → market-wide inform-only timing note at most; no per-item lane.
 *  (c) OTHERWISE — the plan closes "measured, too thin, don't build".
 * The five §1 items are ALWAYS reported with their §4 table signs as a consistency check; a
 * disagreement is reported plainly, never reconciled silently.
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * HONESTY. ONE era (~104d), one season; ~15 cycles at 7d, ~7 at 14d — stability claims are
 * half-era-vs-half-era, nothing finer. Mids off 1h touch aggregates; no depth/fill claim anywhere.
 * §4's class-story axes beyond the printed tiers (limit, price, gp/day) need metadata the repo
 * doesn't hold; any name-based tagging in the write-up is post hoc and flagged there.
 *
 * Reads the archive READ-ONLY via ONE bulk GROUP BY (not 4.6k per-item reads); no cache files
 * written. `--item "<name>"` spot-checks named items (detection only, no branch print);
 * `--limit N` caps the universe for smoke runs (no branch print); `--json <path>` dumps results.
 * Run: `node pipeline/experiments/wk2-period-phase-universe.mjs`
 */
import { pathToFileURL } from 'node:url';
import * as path from 'node:path';
import * as fs from 'node:fs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const imp = rel => import(pathToFileURL(path.join(ROOT, rel)).href);
const { open } = await imp('pipeline/lib/market/archive.mjs');

const SEED = 20260908;
const PERIODS = []; for (let p = 3; p <= 14.0001; p += 0.25) PERIODS.push(Number(p.toFixed(2)));
const SURR_N = 10_000;
const FDR_Q = 0.05;
const MIN_DAYS = 70, MIN_COVERAGE = 0.85;
const MA_W = 15, MA_HALF = 7;
const TAX_PCT = 2.0;
const LOCK_BAND = [6.5, 7.5], LOCK_DRIFT_D = 1.0;
const BR_A_MIN_ITEMS = 15, BR_A_MIN_P2T = 4.0, BR_A_MIN_GPD = 5e6, BR_A_MAX_DRIFT = 1.5;
const BR_B_BASKET_P = 0.01, BR_B_BASKET_BAND = [6, 8];
const BASKET_MIN_GPD = 1e6;
const DAYS_LBL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const argAt = f => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : null; };
const spotNames = process.argv.flatMap((a, i) => a === '--item' ? [process.argv[i + 1]] : []);
const limitN = argAt('--limit') ? Number(argAt('--limit')) : null;
const smoke = spotNames.length > 0 || limitN != null;

// ---- daily series for the whole universe in ONE bulk aggregate ---------------------------------
const mapping = JSON.parse(fs.readFileSync(path.join(ROOT, 'pipeline', '.cache', 'mapping.cache.json'), 'utf8'));
const h = open(undefined, { readonly: true });   // READONLY NON-NEGOTIABLE (schema DDL on the live DB)
const now = new Date(); now.setHours(0, 0, 0, 0);            // start of local today
const eraEnd = Math.floor(now.getTime() / 1000) - 1;         // full local days only
const rows = h.db.prepare(`
  SELECT itemId, date(ts, 'unixepoch', 'localtime') AS d,
         AVG((avgHighPrice + avgLowPrice) / 2.0) AS mid,
         COUNT(*) AS nh,
         SUM(COALESCE(highPriceVolume,0)*COALESCE(avgHighPrice,0)
           + COALESCE(lowPriceVolume,0)*COALESCE(avgLowPrice,0)) AS gp
    FROM observations
   WHERE grain = '1h' AND ts <= ? AND avgHighPrice IS NOT NULL AND avgLowPrice IS NOT NULL
   GROUP BY itemId, d ORDER BY itemId, d`).all(eraEnd);
h.close?.();

const dayIdx = dstr => Math.round(Date.parse(dstr + 'T12:00:00') / 86400000);  // local noon — DST-safe
const byItem = new Map();
for (const r of rows) {
  let it = byItem.get(r.itemId); if (!it) byItem.set(r.itemId, it = []);
  it.push({ di: dayIdx(r.d), d: r.d, mid: r.mid, gp: r.gp });
}

// ---- per-item deviation series (15d centered detrend) ------------------------------------------
function deviations(days) {
  const byDi = new Map(days.map(x => [x.di, x]));
  const out = [];
  for (const x of days) {
    let s = 0, n = 0;
    for (let k = -MA_HALF; k <= MA_HALF; k++) { const y = byDi.get(x.di + k); if (y) { s += y.mid; n++; } }
    if (n === MA_W && x.mid > 0) out.push({ di: x.di, d: x.d, v: x.mid / (s / n) - 1 });
  }
  return out;
}

// ---- fit machinery ------------------------------------------------------------------------------
function fitPeriod(ts, vs, P) {   // LS fit v ≈ c + a·sin + b·cos at period P; → {r2, a, b}
  const w = 2 * Math.PI / P;
  let Ss = 0, Sc = 0, Sss = 0, Scc = 0, Ssc = 0, Sv = 0, Svs = 0, Svc = 0;
  const n = ts.length;
  for (let i = 0; i < n; i++) {
    const s = Math.sin(w * ts[i]), c = Math.cos(w * ts[i]), v = vs[i];
    Ss += s; Sc += c; Sss += s * s; Scc += c * c; Ssc += s * c; Sv += v; Svs += v * s; Svc += v * c;
  }
  // normal equations for [c0, a, b] via 3x3 elimination
  const M = [[n, Ss, Sc, Sv], [Ss, Sss, Ssc, Svs], [Sc, Ssc, Scc, Svc]];
  for (let col = 0; col < 3; col++) {
    let piv = col; for (let r2 = col + 1; r2 < 3; r2++) if (Math.abs(M[r2][col]) > Math.abs(M[piv][col])) piv = r2;
    [M[col], M[piv]] = [M[piv], M[col]];
    if (Math.abs(M[col][col]) < 1e-12) return { r2: 0, a: 0, b: 0 };
    for (let r2 = 0; r2 < 3; r2++) if (r2 !== col) {
      const f = M[r2][col] / M[col][col];
      for (let c2 = col; c2 < 4; c2++) M[r2][c2] -= f * M[col][c2];
    }
  }
  const c0 = M[0][3] / M[0][0], a = M[1][3] / M[1][1], b = M[2][3] / M[2][2];
  let sse = 0, sst = 0; const vbar = Sv / n;
  for (let i = 0; i < n; i++) {
    const s = Math.sin(w * ts[i]), c = Math.cos(w * ts[i]);
    const e = vs[i] - (c0 + a * s + b * c);
    sse += e * e; sst += (vs[i] - vbar) * (vs[i] - vbar);
  }
  return { r2: sst > 0 ? 1 - sse / sst : 0, a, b };
}
const maxR2 = (ts, vs) => {
  let best = { r2: -1, P: null, a: 0, b: 0 };
  for (const P of PERIODS) { const f = fitPeriod(ts, vs, P); if (f.r2 > best.r2) best = { ...f, P }; }
  return best;
};
function lag1(devs) {
  let sxy = 0, sxx = 0, syy = 0, sx = 0, sy = 0, n = 0;
  for (let i = 1; i < devs.length; i++) if (devs[i].di === devs[i - 1].di + 1) {
    const x = devs[i - 1].v, y = devs[i].v; sxy += x * y; sxx += x * x; syy += y * y; sx += x; sy += y; n++;
  }
  if (n < 10) return 0;
  const cov = sxy / n - (sx / n) * (sy / n), vx = sxx / n - (sx / n) ** 2, vy = syy / n - (sy / n) ** 2;
  return vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : 0;
}
function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(SEED);
function gauss() { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// binned surrogate null: key (r1 bin, n bin) → sorted S* draws
const surrCache = new Map();
function surrDraws(r1, n) {
  const r1b = Math.max(-0.30, Math.min(0.95, Math.round(r1 / 0.05) * 0.05));
  const nb = Math.max(MIN_DAYS, Math.round(n / 5) * 5);
  const key = `${r1b.toFixed(2)}|${nb}`;
  if (surrCache.has(key)) return surrCache.get(key);
  const ts = Array.from({ length: nb }, (_, i) => i);
  const draws = new Float64Array(SURR_N);
  const vs = new Array(nb);
  for (let k = 0; k < SURR_N; k++) {
    let x = 0; for (let i = 0; i < 50; i++) x = r1b * x + gauss();
    for (let i = 0; i < nb; i++) { x = r1b * x + gauss(); vs[i] = x; }
    draws[k] = maxR2(ts, vs).r2;
  }
  draws.sort();
  surrCache.set(key, draws);
  return draws;
}
const pOf = (draws, S) => { let lo = 0, hi = draws.length; while (lo < hi) { const m = (lo + hi) >> 1; if (draws[m] < S) lo = m + 1; else hi = m; } return (1 + (draws.length - lo)) / (1 + draws.length); };

function phaseDrift(devs, P) {   // |circular Δphase| between era halves at period P, in days
  const half = Math.floor(devs.length / 2);
  const fit = part => { const f = fitPeriod(part.map(x => x.di), part.map(x => x.v), P); return Math.atan2(f.b, f.a); };
  let d = fit(devs.slice(half)) - fit(devs.slice(0, half));
  while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d) * P / (2 * Math.PI);
}
function troughWeekday(devs) {   // full-era 7.00d fit → local weekday of the sinusoid minimum
  const f = fitPeriod(devs.map(x => x.di), devs.map(x => x.v), 7);
  const phi = Math.atan2(f.b, f.a);              // v ≈ A·sin(w·t + phi)
  const tMin = ((-phi - Math.PI / 2) / (2 * Math.PI)) * 7;   // sin minimal at w·t+phi = −π/2
  const anchor = devs[0].di;
  // weekday of absolute day index k: day 0 of Date.parse-epoch days is Thu(4) — derive from a known date instead
  const wd0 = new Date((anchor * 86400000) + 12 * 3600000).getDay();
  const off = ((tMin - anchor) % 7 + 7) % 7;     // days from anchor to a minimum, mod 7
  return (wd0 + Math.round(off)) % 7;
}

// ---- assemble the universe ----------------------------------------------------------------------
let universe = [];
for (const [id, days] of byItem) {
  const span = days.length ? days[days.length - 1].di - days[0].di + 1 : 0;
  const devs = deviations(days);
  const gpd = days.length ? days.reduce((s, x) => s + (x.gp || 0), 0) / days.length : 0;
  const midNow = days.length ? days[days.length - 1].mid : 0;
  universe.push({
    id, name: mapping[id]?.name || `#${id}`, limit: mapping[id]?.limit ?? null,
    days, devs, gpd, midNow,
    tested: devs.length >= MIN_DAYS && span > 0 && days.length / span >= MIN_COVERAGE,
  });
}
if (spotNames.length) {
  const wanted = new Set(spotNames);
  universe = universe.filter(u => wanted.has(u.name));
  const missing = spotNames.filter(n => !universe.some(u => u.name === n));
  if (missing.length) { console.error(`FATAL: not in archive/mapping: ${missing.join(', ')}`); process.exit(1); }
}
if (limitN != null) universe = universe.slice(0, limitN);

// ---- basket (equal-weighted mean deviation over liquid qualified items) ------------------------
const basketMembers = universe.filter(u => u.tested && u.gpd >= BASKET_MIN_GPD);
const basketAcc = new Map();
for (const u of basketMembers) for (const x of u.devs) {
  const e = basketAcc.get(x.di) || { s: 0, n: 0 }; e.s += x.v; e.n++; basketAcc.set(x.di, e);
}
const basket = new Map([...basketAcc].map(([di, e]) => [di, e.s / e.n]));

// ---- detection: raw and basket-subtracted -------------------------------------------------------
function detect(devs) {
  const ts = devs.map(x => x.di), vs = devs.map(x => x.v);
  const best = maxR2(ts, vs);
  const r1 = lag1(devs);
  const p = pOf(surrDraws(r1, devs.length), best.r2);
  const A = Math.hypot(best.a, best.b);
  return { p, P: best.P, r2: best.r2, r1, p2t: 200 * A, drift: phaseDrift(devs, best.P) };
}
const t0 = Date.now();
for (const u of universe) {
  if (!u.tested) continue;
  u.raw = detect(u.devs);
  const sub = u.devs.filter(x => basket.has(x.di)).map(x => ({ di: x.di, v: x.v - basket.get(x.di) }));
  u.sub = sub.length >= MIN_DAYS ? detect(sub) : null;
}
const basketDevs = [...basket].sort((a, b) => a[0] - b[0]).map(([di, v]) => ({ di, v }));
const basketDet = basketDevs.length >= MIN_DAYS ? detect(basketDevs) : null;

// ---- BH-FDR across tested items, each family separately ----------------------------------------
function bhFdr(items, get) {
  const ps = items.map(get).filter(p => p != null).sort((a, b) => a - b);
  let cut = 0;
  for (let i = 0; i < ps.length; i++) if (ps[i] <= FDR_Q * (i + 1) / ps.length) cut = ps[i];
  return cut;
}
const tested = universe.filter(u => u.tested);
const rawCut = bhFdr(tested, u => u.raw.p);
const subCut = bhFdr(tested.filter(u => u.sub), u => u.sub.p);
for (const u of tested) {
  u.rawDisc = u.raw.p <= rawCut && rawCut > 0;
  u.subDisc = !!u.sub && u.sub.p <= subCut && subCut > 0;
}

// ---- report -------------------------------------------------------------------------------------
const gpdTier = g => g >= 1e8 ? 'T3 ≥100m' : g >= 1e7 ? 'T2 10–100m' : g >= 1e6 ? 'T1 1–10m' : 'T0 <1m';
const m = v => v >= 1e6 ? (v / 1e6).toFixed(1) + 'm' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'k' : String(Math.round(v));
const rawDisc = tested.filter(u => u.rawDisc);
const bothDisc = rawDisc.filter(u => u.subDisc);

console.log(`WK2 period+phase universe scan — ${universe.length} archive items, ${tested.length} tested (≥${MIN_DAYS} valid days, ≥${MIN_COVERAGE * 100}% coverage), era to ${new Date(eraEnd * 1000).toISOString().slice(0, 10)}${smoke ? '  [SMOKE/SPOT MODE — no branch decision]' : ''}`);
console.log(`basket: ${basketMembers.length} members (tested ∧ gp/day ≥ ${m(BASKET_MIN_GPD)})${basketDet ? ` — basket itself: P*=${basketDet.P}d, p=${basketDet.p.toFixed(4)}, peak-to-trough ${basketDet.p2t.toFixed(2)}%` : ''}`);
console.log(`FDR q=${FDR_Q}: RAW discoveries ${rawDisc.length} (expected false ≈ ${(FDR_Q * rawDisc.length).toFixed(1)}), surviving basket subtraction ${bothDisc.length} of them\n`);

const lockOf = u => u.raw.P >= LOCK_BAND[0] && u.raw.P <= LOCK_BAND[1] ? (u.raw.drift <= LOCK_DRIFT_D ? 'LOCKED' : 'free-run') : '—';
const wdClass = wd => [1, 2, 3].includes(wd) ? 'aligned' : [5, 6, 0].includes(wd) ? 'inverted' : 'other';
function row(u) {
  const wd = u.raw.P >= LOCK_BAND[0] && u.raw.P <= LOCK_BAND[1] ? troughWeekday(u.devs) : null;
  return `${u.name.slice(0, 28).padEnd(28)} P*${String(u.raw.P).padStart(5)}d p${u.raw.p.toFixed(4)} p2t${u.raw.p2t.toFixed(1).padStart(5)}% drift${u.raw.drift.toFixed(1).padStart(4)}d ${lockOf(u).padEnd(8)}${wd != null ? (DAYS_LBL[wd] + ' ' + wdClass(wd)).padEnd(12) : ''.padEnd(12)} ${u.sub ? (u.subDisc ? 'SUB✓' : 'sub×') : 'sub—'} ${gpdTier(u.gpd).padEnd(10)} gp/d ${m(u.gpd)}`;
}

console.log('RAW discoveries (sorted by traded value):');
for (const u of rawDisc.sort((a, b) => b.gpd - a.gpd).slice(0, 60)) console.log('  ' + row(u));
if (rawDisc.length > 60) console.log(`  … ${rawDisc.length - 60} more (see --json)`);

console.log('\n§1 FIVE consistency check (§4 table: fang expresses Tue→Sat, crossbow/ring Wed/Thu trough, staff null, hilt INVERTED Thu/Fri peak):');
const FIVE = ['Avernic defender hilt', 'Nightmare staff', 'Armadyl crossbow', 'Venator ring', "Osmumten's fang"];
for (const nm of FIVE) {
  const u = universe.find(x => x.name === nm);
  console.log('  ' + (u && u.raw ? row(u) + (u.rawDisc ? '  [FDR ✓]' : '  [not a discovery]') : `${nm} — not tested`));
}

const brA = bothDisc.filter(u => u.raw.p2t >= BR_A_MIN_P2T && u.gpd >= BR_A_MIN_GPD && u.raw.drift <= BR_A_MAX_DRIFT);
const rawFloorSet = rawDisc.filter(u => u.raw.p2t >= BR_A_MIN_P2T && u.gpd >= BR_A_MIN_GPD);
const lostToBasket = rawFloorSet.filter(u => !u.subDisc);
console.log(`\nbranch inputs: |brA set| = ${brA.length} (floors: both-FDR, p2t ≥ ${BR_A_MIN_P2T}%, gp/d ≥ ${m(BR_A_MIN_GPD)}, drift ≤ ${BR_A_MAX_DRIFT}d); raw floor set ${rawFloorSet.length}, of which lost after basket subtraction ${lostToBasket.length}`);
if (!smoke) {
  let branch;
  if (brA.length >= BR_A_MIN_ITEMS) branch = `(a) PER-ITEM STRUCTURE WORTH BUILDING — measurements 2 and 4 revive; derived-window overlay design proceeds (${brA.length} qualifying items)`;
  else if (basketDet && basketDet.p < BR_B_BASKET_P && basketDet.P >= BR_B_BASKET_BAND[0] && basketDet.P <= BR_B_BASKET_BAND[1] && rawFloorSet.length > 0 && lostToBasket.length > rawFloorSet.length / 2) branch = '(b) ONE MARKET INDEX — market-wide inform-only note at most; no per-item lane';
  else branch = '(c) TOO THIN — the plan closes "measured, too thin, don\'t build"';
  console.log(`\nPRE-REGISTERED BRANCH: ${branch}`);
}
// POST-HOC SENSITIVITY (added after the registered run; labeled, decides NOTHING — the reproducer
// for the band-edge caveat in the write-up). The registered band caps at 14d; if a discovery's R²
// over an EXTENDED 3–30d grid peaks BEYOND 14.25d, its in-band P* is a truncation of longer-period
// power — and claims outside 3–14d are refused by the pre-registration, so such items are flagged
// band-edge-unreliable rather than re-branched.
const EXT = []; for (let p = 3; p <= 30.0001; p += 0.25) EXT.push(Number(p.toFixed(2)));
const extBest = devs => { let b = { r2: -1, P: null }; const ts = devs.map(x => x.di), vs = devs.map(x => x.v); for (const P of EXT) { const f = fitPeriod(ts, vs, P); if (f.r2 > b.r2) b = { r2: f.r2, P }; } return b; };
for (const u of rawDisc) u.ext = extBest(u.devs);
const edgeUnreliable = rawDisc.filter(u => u.ext.P > 14.25);
const brAclean = brA.filter(u => u.ext.P <= 14.25);
console.log(`\nPOST-HOC band-edge sensitivity (decides nothing): ${edgeUnreliable.length}/${rawDisc.length} raw discoveries peak beyond 14.25d on a 3–30d grid (in-band P* is truncated longer-period power; ${rawDisc.filter(u => u.raw.P >= 12).length} had in-band P* ≥ 12d). brA set excluding them: ${brAclean.length} of ${brA.length}.`);

console.log(`\n(universe ${universe.length}, tested ${tested.length}, surrogate bins ${surrCache.size}, ${((Date.now() - t0) / 1000).toFixed(1)}s detection)`);

const jsonAt = argAt('--json');
if (jsonAt) {
  fs.writeFileSync(jsonAt, JSON.stringify({
    generatedAt: new Date().toISOString(),
    params: { PERIODS: [PERIODS[0], PERIODS[PERIODS.length - 1], 0.25], SURR_N, FDR_Q, MIN_DAYS, MIN_COVERAGE, MA_W, SEED, branches: { BR_A_MIN_ITEMS, BR_A_MIN_P2T, BR_A_MIN_GPD, BR_A_MAX_DRIFT, BR_B_BASKET_P, BR_B_BASKET_BAND } },
    counts: { universe: universe.length, tested: tested.length, rawDisc: rawDisc.length, bothDisc: bothDisc.length, brA: brA.length, rawFloorSet: rawFloorSet.length, lostToBasket: lostToBasket.length },
    basket: basketDet, basketMembers: basketMembers.length,
    items: tested.map(u => ({
      id: u.id, name: u.name, limit: u.limit, gpd: Math.round(u.gpd), midNow: Math.round(u.midNow),
      raw: u.raw, sub: u.sub, rawDisc: u.rawDisc, subDisc: u.subDisc, ext: u.ext ?? null,
      lock: lockOf(u), troughWd: u.raw && u.raw.P >= LOCK_BAND[0] && u.raw.P <= LOCK_BAND[1] ? troughWeekday(u.devs) : null,
    })),
  }, null, 1));
  console.log(`json → ${jsonAt}`);
}
