/**
 * wpc-label-study.mjs — PLAN-WEEKDAY-PHASE-CONFOUND §3 + §6, the REGISTERED test.
 * Pre-registration: plans/PLAN-WEEKDAY-PHASE-CONFOUND.md @ b7e294d (committed BEFORE this ran).
 * This header fixes the operational firing thresholds (registration left them qualitative); the
 * script is committed before its first result run, dated 2026-09-08.
 *
 *   node pipeline/experiments/wpc-label-study.mjs [--limit N]
 *
 * QUESTION. §3: is the floor/ceiling trend read confounded with weekly phase (H1)?
 *           §6: what is a "falling" warning WORTH, conditioned on class × dislocation state (H2)?
 *
 * INSTRUMENTS — the REAL producers, never reimplemented:
 *   - floorCeilingTrack (js/windowread.mjs), called per item-day on the last 20 COMPLETED local
 *     daily buckets ending day t−1 (strictly trailing; day t never feeds its own read). Default
 *     FC_* constants — the shipped fit. Labels = its classification.
 *   - regime `falling` = REGIME_FALLING (js/quotecore.js) applied to that classification — the
 *     exact screen mapping {crash-risk, cooling}. NOTE: the intraday "⚠ breaking down" variant
 *     (EC2 forming-day under-trough) is not reproducible at daily grain; at day close it IS
 *     crash-risk, so this study covers it through crash-risk and says so.
 *   - classifyItem (pipeline/lib/signal/dislocation.mjs) — the WK3/WK4 taxonomy, single source.
 *   - Deviation/bucket/forward-net machinery copied from wk3-class-cycle-study.mjs @ 449ef0f
 *     (trailing-15 ≥12 reference, net4 = (0.98·mid[t+4] − mid[t])/mid[t], local-date day grouping).
 *   DATA-SOURCE NOTE: daily low/hi here are 1h-archive extremes (the read-trajectory/
 *   read-window-range family §1 names). The screen GATE classifies off the 6h archive and can
 *   disagree per item (quotecore's own documented divergence); this study measures the 1h family.
 *
 * UNIVERSE (per §3): ≥28 local days of 1h coverage, era-mean mid ≥ 100k. No downsample (measured
 * fast enough; the registered every-2nd-day fallback was not needed).
 *
 * INFERENCE SHAPE (WK1 lesson — overlapping 4d horizons serialize item-days): per-ITEM statistics
 * first, then a t across items. No pooled item-day t is quoted anywhere.
 *
 * FIRING THRESHOLDS, fixed before the first run:
 *   §3(a) fires: per-item paired (Mon–Wed-END incidence − Fri–Sun-END incidence) of the FALLING
 *         label: mean > +1pp absolute AND |t| ≥ 2.5 (items need ≥5 reads per side).
 *   §3(b) fires: per-item paired end-weekday gap in RELATIVE ceiling slope (slope/latest, %/day),
 *         Mon–Wed minus Fri–Sun: mean < 0, |t| ≥ 2.5, AND |gap| ≥ 0.1%/day (= 0.2×FC_FLAT_FRAC —
 *         a gap that size shifts reads across the flat band, i.e. it can flip labels).
 *   §3(c) fires: among FALLING-labelled reads, per-item paired forward net4 (Mon–Wed-END labels
 *         minus Fri–Sun-END labels): mean ≥ +0.5pp AND |t| ≥ 2.5 (≥3 labelled reads per side).
 *   §6(d) cell = class × bucket (deep7 ≤−7 / deep4 (−7,−4] / deep2 (−4,−2] / mid (−2,+4) /
 *         elevated ≥+4): per-item delta = mean net4 on FALLING-labelled in-bucket days − mean net4
 *         on unlabelled in-bucket days (≥3 days each side per item; cells need ≥8 items). BH
 *         q=0.10 across all qualifying cells on the item-level two-sided p. The at-volume delta
 *         (day-t traded gp ≥ item's own median) rides along per cell, outside the BH set.
 *   §6 branches: (iv) no cell survives BH; (v) ≥1 survives (either sign) → scoped; (vi) survivors
 *         broadly negative (≥3/4 of survivors negative across ≥3 classes) → confirmed veto.
 *
 * HONEST LIMITS: one era (2026-05-28→09-08), one season; touch mids, not fills; the label is
 * daily-grain end-of-day, the live surface also fires intraday; inform-only — nothing here may
 * gate, size, or auto-price. If §3(i) fires, any §6(v) entry cell awaits re-earning on the
 * repaired label (plan §6 interaction rule).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const imp = rel => import(pathToFileURL(path.join(ROOT, rel)).href);
const { open } = await imp('pipeline/lib/market/archive.mjs');
const { floorCeilingTrack } = await imp('js/windowread.mjs');
const { REGIME_FALLING } = await imp('js/quotecore.js');
const { classifyItem } = await imp('pipeline/lib/signal/dislocation.mjs');

const MIN_DAYS = 28, MIN_MID = 1e5, FC_WINDOW = 20;
const Y_TRAIL = 15, Y_TRAIL_MIN = 12, H = 4, TAX = 0.98;
const T_FIRE = 2.5, A_MIN_PP = 1.0, B_MIN_GAP = 0.1, C_MIN_PP = 0.5;
const CELL_MIN_ITEMS = 8, ITEM_MIN_SIDE = 3, INC_MIN_READS = 5;
const BH_Q = 0.10;
const BUCKETS = [['deep7', d => d <= -7], ['deep4', d => d > -7 && d <= -4], ['deep2', d => d > -4 && d <= -2], ['mid', d => d > -2 && d < 4], ['elevated', d => d >= 4]];
const DOW_LBL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONWED = new Set([1, 2, 3]), FRISUN = new Set([5, 6, 0]);

const argAt = f => { const i = process.argv.indexOf(f); return i !== -1 ? Number(process.argv[i + 1]) : null; };
const limitN = argAt('--limit');

// t CDF (copied from wk3-class-cycle-study.mjs @ 449ef0f)
function ibetacf(a, b, x) { let m2, aa, c = 1, d = 1 - (a + b) * x / (a + 1); if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d; let h2 = d; for (let mm = 1; mm <= 200; mm++) { m2 = 2 * mm; aa = mm * (b - mm) * x / ((a + m2 - 1) * (a + m2)); d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30; c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30; d = 1 / d; h2 *= d * c; aa = -(a + mm) * (a + b + mm) * x / ((a + m2) * (a + m2 + 1)); d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30; c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30; d = 1 / d; const del = d * c; h2 *= del; if (Math.abs(del - 1) < 3e-7) break; } return h2; }
function lgamma(x) { const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]; let y = x, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp); let ser = 1.000000000190015; for (let j = 0; j < 6; j++) ser += g[j] / ++y; return -tmp + Math.log(2.5066282746310005 * ser / x); }
function ibeta(a, b, x) { if (x <= 0) return 0; if (x >= 1) return 1; const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x)); return x < (a + 1) / (a + b + 2) ? bt * ibetacf(a, b, x) / a : 1 - bt * ibetacf(b, a, 1 - x) / b; }
const tTwoSided = (t, df) => df > 0 ? ibeta(df / 2, 0.5, df / (df + t * t)) : 1;
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
function pairedT(diffs) {
  if (diffs.length < 2) return null;
  const m = mean(diffs);
  const sd = Math.sqrt(diffs.map(x => (x - m) ** 2).reduce((a, b) => a + b, 0) / (diffs.length - 1));
  const se = sd / Math.sqrt(diffs.length);
  const t = se > 0 ? m / se : 0;
  return { m, t, p: tTwoSided(t, diffs.length - 1), n: diffs.length };
}
const fmt = v => (v >= 0 ? '+' : '') + v.toFixed(2);

const mapping = JSON.parse(fs.readFileSync(path.join(ROOT, 'pipeline', '.cache', 'mapping.cache.json'), 'utf8'));
const metaBy = new Map(mapping.map(m => [m.id, m]));
const h0 = open(undefined, { readonly: true });
const now = new Date(); now.setHours(0, 0, 0, 0);
const eraEnd = Math.floor(now.getTime() / 1000) - 1;
const rows = h0.db.prepare(`
  SELECT itemId, date(ts, 'unixepoch', 'localtime') AS d,
         AVG((avgHighPrice + avgLowPrice) / 2.0) AS mid,
         MIN(avgLowPrice) AS lo, MAX(avgHighPrice) AS hi,
         SUM(COALESCE(highPriceVolume,0)*COALESCE(avgHighPrice,0)
           + COALESCE(lowPriceVolume,0)*COALESCE(avgLowPrice,0)) AS gp
    FROM observations
   WHERE grain = '1h' AND ts <= ? AND avgHighPrice IS NOT NULL AND avgLowPrice IS NOT NULL
   GROUP BY itemId, d ORDER BY itemId, d`).all(eraEnd);
h0.close?.();

const dayIdx = dstr => Math.round(Date.parse(dstr + 'T12:00:00') / 86400000);
const dowOf = dstr => new Date(dstr + 'T12:00:00').getDay();   // local date string, never UTC index math (WK2 C2)
const byItem = new Map();
for (const r of rows) {
  let it = byItem.get(r.itemId); if (!it) byItem.set(r.itemId, it = []);
  it.push({ di: dayIdx(r.d), d: r.d, mid: r.mid, lo: r.lo, hi: r.hi, gp: r.gp || 0 });
}

const items = [];
for (const [id, days] of byItem) {
  if (days.length < MIN_DAYS) continue;
  const eraMid = mean(days.map(x => x.mid));
  if (eraMid < MIN_MID) continue;
  const meta = metaBy.get(id);
  items.push({ id, name: meta?.name || String(id), cls: classifyItem({ name: meta?.name, limit: meta?.limit ?? null, eraMid }), days });
  if (limitN && items.length >= limitN) break;
}
console.log(`# WPC §3+§6 registered run — ${items.length} items (≥${MIN_DAYS}d, mid ≥ ${MIN_MID / 1e3}k), era end ${new Date(eraEnd * 1000).toISOString().slice(0, 10)}`);

// per item-day reads: trailing fc label + trailing deviation bucket + forward net4
let nReads = 0, nLabelled = 0;
for (const u of items) {
  const byDi = new Map(u.days.map(x => [x.di, x]));
  const gps = u.days.map(x => x.gp).sort((a, b) => a - b);
  u.gpMed = gps[Math.floor(gps.length / 2)];
  u.reads = [];
  for (const x of u.days) {
    const t = x.di;
    if (!byDi.has(t - 1)) continue;                      // window-end day must exist (defines end weekday)
    const win = [];
    for (let k = FC_WINDOW; k >= 1; k--) { const y = byDi.get(t - k); if (y) win.push([y.d, { low: y.lo, hi: y.hi }]); }
    const fc = floorCeilingTrack(win);                   // completed days only ⇒ no todayKey (guard already applied)
    if (!fc) continue;
    let s = 0, n = 0;
    for (let k = 1; k <= Y_TRAIL; k++) { const y = byDi.get(t - k); if (y) { s += y.mid; n++; } }
    if (n < Y_TRAIL_MIN || x.mid <= 0) continue;
    const dev = (x.mid / (s / n) - 1) * 100;
    const fwd = byDi.get(t + H);
    const net4 = fwd ? (TAX * fwd.mid - x.mid) / x.mid * 100 : null;
    const endDow = dowOf(byDi.get(t - 1).d);
    const read = {
      endDow, label: fc.classification, falling: REGIME_FALLING.has(fc.classification),
      slopeRel: fc.ceiling.slope != null && fc.ceiling.latest ? fc.ceiling.slope / fc.ceiling.latest * 100 : null,
      dev, bucket: BUCKETS.find(([, f]) => f(dev))[0], net4, atVol: x.gp >= u.gpMed,
    };
    u.reads.push(read); nReads++; if (read.falling) nLabelled++;
  }
}
console.log(`# ${nReads} item-day reads, ${nLabelled} FALLING-labelled (${(nLabelled / nReads * 100).toFixed(1)}%)\n`);

// ---- §3(a): FALLING incidence by window-end weekday --------------------------------------------
console.log('§3(a) — FALLING-label incidence by window-END weekday (item-paired Mon–Wed vs Fri–Sun):');
const incByDow = Array.from({ length: 7 }, () => ({ f: 0, n: 0 }));
const aDiffs = [];
for (const u of items) {
  for (const r of u.reads) { incByDow[r.endDow].n++; if (r.falling) incByDow[r.endDow].f++; }
  const mw = u.reads.filter(r => MONWED.has(r.endDow)), fs2 = u.reads.filter(r => FRISUN.has(r.endDow));
  if (mw.length >= INC_MIN_READS && fs2.length >= INC_MIN_READS)
    aDiffs.push(mean(mw.map(r => r.falling ? 100 : 0)) - mean(fs2.map(r => r.falling ? 100 : 0)));
}
console.log('  ' + incByDow.map((e, i) => `${DOW_LBL[i]} ${(e.f / e.n * 100).toFixed(1)}%`).join('  '));
const aT = pairedT(aDiffs);
const aFire = aT && aT.m > A_MIN_PP && Math.abs(aT.t) >= T_FIRE;
console.log(`  paired Mon–Wed − Fri–Sun: ${fmt(aT.m)}pp  t=${aT.t.toFixed(2)}  p=${aT.p.toFixed(4)}  nItems=${aT.n}  → (a) ${aFire ? 'FIRES' : 'does NOT fire'} (needs >+${A_MIN_PP}pp & |t|≥${T_FIRE})\n`);

// ---- §3(b): fitted ceiling slope (relative, %/day) by window-end weekday -----------------------
console.log('§3(b) — fitted RELATIVE ceiling slope (%/day) by window-END weekday:');
const slopeByDow = Array.from({ length: 7 }, () => []);
const bDiffs = [];
for (const u of items) {
  const perDow = Array.from({ length: 7 }, () => []);
  for (const r of u.reads) if (r.slopeRel != null) perDow[r.endDow].push(r.slopeRel);
  perDow.forEach((a, i) => { if (a.length) slopeByDow[i].push(mean(a)); });
  const mw = u.reads.filter(r => MONWED.has(r.endDow) && r.slopeRel != null).map(r => r.slopeRel);
  const fs2 = u.reads.filter(r => FRISUN.has(r.endDow) && r.slopeRel != null).map(r => r.slopeRel);
  if (mw.length >= INC_MIN_READS && fs2.length >= INC_MIN_READS) bDiffs.push(mean(mw) - mean(fs2));
}
console.log('  ' + slopeByDow.map((a, i) => `${DOW_LBL[i]} ${fmt(mean(a))}`).join('  ') + '  (item-averaged)');
const bT = pairedT(bDiffs);
const bFire = bT && bT.m < 0 && Math.abs(bT.t) >= T_FIRE && Math.abs(bT.m) >= B_MIN_GAP;
console.log(`  paired Mon–Wed − Fri–Sun: ${fmt(bT.m)}%/d  t=${bT.t.toFixed(2)}  p=${bT.p.toFixed(4)}  nItems=${bT.n}  → (b) ${bFire ? 'FIRES' : 'does NOT fire'} (needs <0, |gap|≥${B_MIN_GAP}%/d & |t|≥${T_FIRE})\n`);

// ---- §3(c): forward net4 of FALLING-labelled reads, by window-end weekday group ----------------
console.log('§3(c) — forward 4d net of FALLING-labelled reads (item-paired Mon–Wed-end vs Fri–Sun-end):');
const cDiffs = [];
for (const u of items) {
  const mw = u.reads.filter(r => r.falling && MONWED.has(r.endDow) && r.net4 != null).map(r => r.net4);
  const fs2 = u.reads.filter(r => r.falling && FRISUN.has(r.endDow) && r.net4 != null).map(r => r.net4);
  if (mw.length >= ITEM_MIN_SIDE && fs2.length >= ITEM_MIN_SIDE) cDiffs.push(mean(mw) - mean(fs2));
}
const cT = pairedT(cDiffs);
const cFire = cT && cT.m >= C_MIN_PP && Math.abs(cT.t) >= T_FIRE;
if (cT) console.log(`  paired: ${fmt(cT.m)}pp  t=${cT.t.toFixed(2)}  p=${cT.p.toFixed(4)}  nItems=${cT.n}  → (c) ${cFire ? 'FIRES' : 'does NOT fire'} (needs ≥+${C_MIN_PP}pp & |t|≥${T_FIRE})\n`);
else console.log('  insufficient items with labelled reads on both sides → (c) does NOT fire\n');

// ---- §6(d): label worth within class × dislocation bucket --------------------------------------
console.log('§6(d) — FALLING-labelled minus unlabelled forward 4d net, within class × bucket (item-level t; at-volume delta rides along):');
const cells = [];
const classes = [...new Set(items.map(u => u.cls))].sort();
for (const cls of classes) {
  const ms = items.filter(u => u.cls === cls);
  for (const [bk] of BUCKETS) {
    const diffs = [], volDiffs = [];
    for (const u of ms) {
      const inB = u.reads.filter(r => r.bucket === bk && r.net4 != null);
      const lab = inB.filter(r => r.falling), unl = inB.filter(r => !r.falling);
      if (lab.length >= ITEM_MIN_SIDE && unl.length >= ITEM_MIN_SIDE) {
        diffs.push(mean(lab.map(r => r.net4)) - mean(unl.map(r => r.net4)));
        const lv = lab.filter(r => r.atVol), uv = unl.filter(r => r.atVol);
        if (lv.length >= ITEM_MIN_SIDE && uv.length >= ITEM_MIN_SIDE) volDiffs.push(mean(lv.map(r => r.net4)) - mean(uv.map(r => r.net4)));
      }
    }
    if (diffs.length < CELL_MIN_ITEMS) continue;
    const t = pairedT(diffs), vt = volDiffs.length >= CELL_MIN_ITEMS ? pairedT(volDiffs) : null;
    cells.push({ cls, bk, ...t, vol: vt });
  }
}
cells.sort((a, b) => a.p - b.p);
const m = cells.length;
let bhK = 0;
cells.forEach((c, i) => { if (c.p <= BH_Q * (i + 1) / m) bhK = i + 1; });
for (let i = 0; i < cells.length; i++) {
  const c = cells[i];
  console.log(`  ${(c.cls + ' × ' + c.bk).padEnd(32)} Δ ${fmt(c.m)}pp  t=${c.t.toFixed(2)}  p=${c.p.toFixed(4)}  nItems=${c.n}` +
    (c.vol ? `  | at-vol Δ ${fmt(c.vol.m)}pp t=${c.vol.t.toFixed(2)} n=${c.vol.n}` : '  | at-vol thin') +
    (i < bhK ? '  ← BH-SIGNIFICANT' : ''));
}
const survivors = cells.slice(0, bhK);
console.log(`  BH q=${BH_Q}: ${bhK} of ${m} cells significant\n`);

// ---- §6(e): named hazard cells -----------------------------------------------------------------
console.log('§6(e) — pre-named hazard cells (from the (d) machinery):');
for (const c of cells) {
  if (c.bk === 'elevated' || (c.cls === 'bigticket-lowlimit' && c.bk !== 'elevated'))
    console.log(`  ${(c.cls + ' × ' + c.bk).padEnd(32)} Δ ${fmt(c.m)}pp  t=${c.t.toFixed(2)}  p=${c.p.toFixed(4)}  nItems=${c.n}`);
}

// ---- branch verdicts ---------------------------------------------------------------------------
console.log('\n=== BRANCHES ===');
const s3 = aFire && bFire ? '(i)' : (aFire || bFire) && !cFire ? '(ii)' : (aFire || bFire) && cFire ? '(i/ii — see plan: (c) fired too)' : '(iii)';
console.log(`§3: (a) ${aFire ? 'FIRED' : 'no'}, (b) ${bFire ? 'FIRED' : 'no'}, (c) ${cFire ? 'FIRED' : 'no'} → branch ${s3}`);
const negShare = survivors.length ? survivors.filter(c => c.m < 0).length / survivors.length : 0;
const negClasses = new Set(survivors.filter(c => c.m < 0).map(c => c.cls)).size;
const s6 = !survivors.length ? '(iv) subsumed' : (negShare >= 0.75 && negClasses >= 3) ? '(vi) confirmed veto' : '(v) scoped';
console.log(`§6: ${survivors.length} BH survivors (${survivors.filter(c => c.m < 0).length} negative) → branch ${s6}`);
