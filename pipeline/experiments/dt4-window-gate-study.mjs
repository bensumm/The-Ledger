#!/usr/bin/env node
/* dt4-window-gate-study.mjs — does a per-item split-half reliability gate on the diurnal window
 * actually SELECT items whose window holds out-of-sample?  (PLAN-DIURNAL-TRIAGE DT4, measurement.)
 *
 * WHY THIS EXISTS BEFORE THE BUILD. DT4 proposes: compute a split-half correlation r on the per-hour
 * shape, render the window when r >= ~0.6, else print "no reliable window". The triage already measured
 * that the window carries ~ZERO information for a resting offer in aggregate (71.2% vs 70.5% random).
 * The DT4 premise is that a SUBSET of items is different, and that split-half r finds it. That premise
 * is UNTESTED. Shipping the gate without testing it would encode a threshold that might only be
 * selecting low-noise items rather than genuinely-cyclical ones — a distinction invisible from the gate
 * statistic alone, because a flat, quiet item correlates beautifully with itself.
 *
 * THE DESIGN — the gate and the test must be measured on DIFFERENT axes, or the result is circular:
 *   GATE (parity split): partition an item's days into even/odd, run `hourProfile` on each half, Pearson-
 *     correlate the two 24-hour devLow vectors (and devHi). Interleaving in TIME means both halves see
 *     the same regime, which is what makes this a reliability measure rather than a stability one.
 *   TEST (temporal holdout): fit `hourProfile` on the FIRST 2/3 of days, then on each HELD-OUT later day
 *     ask whether the fitted dip hour actually printed below that day's median (and the peak hour above).
 *     Score against the honest baseline — a RANDOM hour on the same day, which by construction sits below
 *     the median ~50% of the time. Lift over that baseline is the only thing that matters.
 * The question is then answerable: does hit-rate lift RISE with the gate statistic? If gate-pass items
 * show the same lift as gate-fail items, the gate selects nothing and DT4 should not ship as specified.
 *
 * READ-ONLY. Opens the /1h SQLite archive with { readonly: true } (a bare open() would run schema DDL
 * against the multi-GB live DB), performs no fetches and no writes. Removable per this directory's README.
 *
 * Run: node pipeline/experiments/dt4-window-gate-study.mjs [--days 45] [--min-days 21] [--out <path>]
 */
import fs from 'node:fs';
import { open } from '../lib/market/archive.mjs';
import { hourProfile } from '../../js/windowread.mjs';

const A = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean)
  .map(s => s.trim().split(/\s+/)).map(([k, ...v]) => [k, v.length ? v.join(' ') : true]));
const DAYS = parseInt(A.days || '45', 10);          // history window pulled from the archive
const MIN_DAYS = parseInt(A['min-days'] || '21', 10); // an item needs this many distinct days to qualify
const OUT = A.out || null;

const pearson = (xs, ys) => {
  const pairs = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => x != null && y != null && Number.isFinite(x) && Number.isFinite(y));
  const n = pairs.length;
  if (n < 6) return null;                            // too few shared hours to mean anything
  const mx = pairs.reduce((s, p) => s + p[0], 0) / n;
  const my = pairs.reduce((s, p) => s + p[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pairs) { const dx = x - mx, dy = y - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (sxx <= 0 || syy <= 0) return null;             // a perfectly FLAT half has no shape to correlate
  return sxy / Math.sqrt(sxx * syy);
};
const median = a => { const s = a.filter(v => v != null).sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const q = (a, p) => { const s = a.filter(v => v != null).sort((x, y) => x - y); if (!s.length) return null; const i = Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1)))); return s[i]; };

// ── pull the panel ───────────────────────────────────────────────────────────
const a = open(undefined, { readonly: true });
const maxTs = a.db.prepare(`SELECT MAX(ts) AS m FROM observations WHERE grain = '1h'`).get().m;
if (!maxTs) { console.error('archive has no 1h observations'); process.exit(1); }
const since = maxTs - DAYS * 86400;
process.stderr.write(`reading 1h archive since ${new Date(since * 1000).toISOString().slice(0, 10)} …\n`);

const stmt = a.db.prepare(`
  SELECT itemId, ts, avgHighPrice AS hi, avgLowPrice AS lo, highPriceVolume AS hv, lowPriceVolume AS lv
  FROM observations
  WHERE grain = '1h' AND ts >= ? AND (avgLowPrice IS NOT NULL OR avgHighPrice IS NOT NULL)
  ORDER BY itemId, ts
`);
const iter = stmt.iterate ? stmt.iterate(since) : stmt.all(since);

const results = [];
let cur = null, nRows = 0;

// dayIndex → integer day number, used for BOTH the parity split and the temporal holdout
const dayIdx = ts => Math.floor(new Date(ts * 1000).setHours(0, 0, 0, 0) / 86400000);

function scoreItem(itemId, pts) {
  const days = [...new Set(pts.map(p => dayIdx(p.timestamp)))].sort((x, y) => x - y);
  if (days.length < MIN_DAYS) return null;

  // The fit/test boundary is chosen FIRST, because the gate must be computed on fit-period data only.
  const cut = days[Math.floor(days.length * 2 / 3)];
  const fitPts = pts.filter(p => dayIdx(p.timestamp) < cut);

  // ---- GATE: parity split, computed on the FIT PERIOD ONLY ----
  // NO LEAKAGE: an earlier version split all 45 days, so the held-out third fed the gate statistic AND
  // the score — an item that happened to be stable in the test window got both a higher r and a higher
  // hit rate, manufacturing part of the very correlation the study set out to test. Restricting the gate
  // to fit-period days is also the only honest simulation of live use, where the future is not available.
  const even = fitPts.filter(p => dayIdx(p.timestamp) % 2 === 0);
  const odd = fitPts.filter(p => dayIdx(p.timestamp) % 2 !== 0);
  const pe = hourProfile(even, { nights: 999 });
  const po = hourProfile(odd, { nights: 999 });
  if (!pe || !po) return null;
  const byH = p => { const m = new Map(p.hours.map(x => [x.h, x])); return h => m.get(h) || null; };
  const ge = byH(pe), go = byH(po);
  const hs = [...Array(24).keys()];
  const rLow = pearson(hs.map(h => ge(h)?.devLow ?? null), hs.map(h => go(h)?.devLow ?? null));
  const rHi = pearson(hs.map(h => ge(h)?.devHi ?? null), hs.map(h => go(h)?.devHi ?? null));
  if (rLow == null || rHi == null) return null;

  // ---- TEST: fit on the same first 2/3 of days, evaluate on the held-out tail ----
  const fit = hourProfile(fitPts, { nights: 999 });
  if (!fit) return null;
  const dipH = fit.dip?.atHour, peakH = fit.peak?.atHour;   // the profile's own field names (dip/peak objects)
  if (dipH == null || peakH == null) return null;

  // group the held-out days
  const heldByDay = new Map();
  for (const p of pts) {
    const d = dayIdx(p.timestamp);
    if (d < cut) continue;
    if (!heldByDay.has(d)) heldByDay.set(d, []);
    heldByDay.get(d).push(p);
  }
  let dipHit = 0, dipN = 0, peakHit = 0, peakN = 0, randDipHit = 0, randPeakHit = 0;
  // deterministic pseudo-random hour per (item, day) — no Math.random, so the run reproduces
  const pick = (d, salt) => { const x = Math.sin(itemId * 7919 + d * 104729 + salt) * 10000; return Math.floor((x - Math.floor(x)) * 24); };
  for (const [d, dayPts] of heldByDay) {
    const lows = dayPts.map(p => p.avgLowPrice).filter(v => v != null);
    const his = dayPts.map(p => p.avgHighPrice).filter(v => v != null);
    if (dayPts.length < 12) continue;                  // a sparse day can't establish its own median
    const medLow = median(lows), medHi = median(his);
    const atHour = (h, key) => { const s = dayPts.find(p => new Date(p.timestamp * 1000).getHours() === h); return s ? s[key] : null; };
    const dv = atHour(dipH, 'avgLowPrice');
    if (dv != null && medLow != null) {
      dipN++; if (dv <= medLow) dipHit++;
      const rv = atHour(pick(d, 1), 'avgLowPrice');
      if (rv != null && rv <= medLow) randDipHit++;
    }
    const pv = atHour(peakH, 'avgHighPrice');
    if (pv != null && medHi != null) {
      peakN++; if (pv >= medHi) peakHit++;
      const rv = atHour(pick(d, 2), 'avgHighPrice');
      if (rv != null && rv >= medHi) randPeakHit++;
    }
  }
  if (dipN < 5 || peakN < 5) return null;
  return {
    itemId, nDays: days.length, rLow, rHi, rMin: Math.min(rLow, rHi),
    dipN, dipRate: dipHit / dipN, dipRand: randDipHit / dipN,
    peakN, peakRate: peakHit / peakN, peakRand: randPeakHit / peakN,
    amplitude: fit.amplitude ?? null,
    medVol: median(pts.map(p => (p.lowPriceVolume || 0) + (p.highPriceVolume || 0))),
  };
}

const flush = () => {
  if (!cur) return;
  try { const r = scoreItem(cur.itemId, cur.pts); if (r) results.push(r); } catch { /* skip malformed item */ }
  cur = null;
};
for (const r of iter) {
  if (++nRows % 1_000_000 === 0) process.stderr.write(`  … ${(nRows / 1e6).toFixed(0)}M rows\n`);
  if (!cur || cur.itemId !== r.itemId) { flush(); cur = { itemId: r.itemId, pts: [] }; }
  cur.pts.push({ timestamp: r.ts, avgLowPrice: r.lo, avgHighPrice: r.hi, lowPriceVolume: r.lv, highPriceVolume: r.hv });
}
flush();

// ── report ───────────────────────────────────────────────────────────────────
console.log(`\nDT4 window-gate study — ${results.length} items with >= ${MIN_DAYS}d over the last ${DAYS}d\n`);
if (!results.length) { console.log('no qualifying items'); process.exit(0); }

const pct = v => v == null ? '  n/a' : `${(v * 100).toFixed(1)}%`;
console.log('split-half r (the GATE statistic) distribution:');
for (const [lbl, key] of [['devLow', 'rLow'], ['devHi', 'rHi'], ['min(both)', 'rMin']]) {
  const vs = results.map(r => r[key]);
  console.log(`  ${lbl.padEnd(10)} p10 ${q(vs, .10).toFixed(2)}  p25 ${q(vs, .25).toFixed(2)}  median ${q(vs, .50).toFixed(2)}  p75 ${q(vs, .75).toFixed(2)}  p90 ${q(vs, .90).toFixed(2)}`);
}
const passFrac = results.filter(r => r.rMin >= 0.6).length / results.length;
console.log(`\n  items passing the PROPOSED r>=0.60 gate (on min of both sides): ${pct(passFrac)} (${results.filter(r => r.rMin >= 0.6).length}/${results.length})`);

console.log('\nOUT-OF-SAMPLE hit rate by gate bucket — the question DT4 actually turns on.');
console.log('(dip = fitted dip hour printed at/below that held-out day\'s median low; rand = a random hour, same day)');
console.log('\n  r bucket        n     dip hit   dip rand   LIFT      peak hit  peak rand  LIFT');
const buckets = [[-1, 0.2], [0.2, 0.4], [0.4, 0.6], [0.6, 0.8], [0.8, 1.01]];
for (const [lo, hi] of buckets) {
  const g = results.filter(r => r.rMin >= lo && r.rMin < hi);
  if (!g.length) continue;
  const w = (key, nKey) => g.reduce((s, r) => s + r[key] * r[nKey], 0) / g.reduce((s, r) => s + r[nKey], 0);
  const dh = w('dipRate', 'dipN'), dr = w('dipRand', 'dipN');
  const ph = w('peakRate', 'peakN'), pr = w('peakRand', 'peakN');
  const lbl = lo < 0 ? '   r < 0.2' : `${lo.toFixed(1)}–${hi >= 1 ? '1.0' : hi.toFixed(1)}`;
  console.log(`  ${lbl.padEnd(14)} ${String(g.length).padStart(4)}   ${pct(dh)}    ${pct(dr)}    ${(dh - dr >= 0 ? '+' : '') + ((dh - dr) * 100).toFixed(1)}pp    ${pct(ph)}    ${pct(pr)}    ${(ph - pr >= 0 ? '+' : '') + ((ph - pr) * 100).toFixed(1)}pp`);
}

const pass = results.filter(r => r.rMin >= 0.6), fail = results.filter(r => r.rMin < 0.6);
const agg = (g, key, nKey) => g.length ? g.reduce((s, r) => s + r[key] * r[nKey], 0) / g.reduce((s, r) => s + r[nKey], 0) : null;
console.log('\nHEADLINE — gate-pass vs gate-fail:');
for (const [lbl, g] of [['PASS (r>=0.6)', pass], ['FAIL (r<0.6)', fail]]) {
  if (!g.length) { console.log(`  ${lbl}: none`); continue; }
  const dh = agg(g, 'dipRate', 'dipN'), dr = agg(g, 'dipRand', 'dipN');
  const ph = agg(g, 'peakRate', 'peakN'), pr = agg(g, 'peakRand', 'peakN');
  console.log(`  ${lbl.padEnd(15)} n=${String(g.length).padStart(4)}  dip ${pct(dh)} vs rand ${pct(dr)} (${((dh - dr) * 100).toFixed(1)}pp)  ·  peak ${pct(ph)} vs rand ${pct(pr)} (${((ph - pr) * 100).toFixed(1)}pp)`);
}
console.log('\nREAD THIS AS: if PASS and FAIL show the same lift, the gate selects nothing and DT4 as');
console.log('specified should NOT ship — it would print "no reliable window" on items whose window is');
console.log('exactly as good as the ones it keeps. Lift near 0pp in BOTH rows means the window itself');
console.log('is uninformative out-of-sample, which is the DT triage result reproduced on held-out days.');

if (OUT) { fs.writeFileSync(OUT, JSON.stringify({ generatedAt: maxTs, days: DAYS, minDays: MIN_DAYS, results }, null, 1)); console.log(`\nwrote ${OUT}`); }
