#!/usr/bin/env node
/* floor-strategy-study.mjs — is "this item is at its N-day low" a tradeable BUY signal? (2026-08-11)
 *
 * Ben's ask: "investigate the floor strategy of finding items that are at their 1/3/7/14/30 day lows."
 * Companion report: FLOOR-STRATEGY-FINDINGS.md. Removable per this directory's README — nothing in the
 * pipeline imports it, and it writes nothing the pipeline reads.
 *
 * READ-ONLY. Reads the local `/1h` SQLite market archive through the shipped handle in
 * `pipeline/lib/market/archive.mjs`: `dailyRangeBulk()` supplies per-item per-day hi/lo, and a sibling
 * aggregate over the same `observations` table supplies side VWAPs and volumes. Tax comes from
 * `js/money-math.js` — the ONE tax home; no money math is re-implemented here.
 *
 * PRIOR ART, READ IT FIRST: `plans/PLAN-DAY-LOW-SURFACING.md` measured this exact idea on 2026-08-10 and
 * CLOSED it as a negative. This study is an INDEPENDENT RE-MEASUREMENT on a different construction
 * (30d not 28d, new-low + position-in-range not a 4-bit vector, side-VWAP legs not daily medians), run
 * to see whether that closure survives a fresh look and to segment on the discriminators the prior pass
 * did not: floor slope, drawdown depth, price tier, item class.
 *
 * Sections:  --section a  base-rate comparison across N and forward horizon
 *            --section b  discriminator hunt (floor slope / drawdown / price tier / item class)
 *            --section c  refuting tests (spread mechanism, spread-matched control, entry lag)
 *            --section d  independence accounting + big-ticket coverage
 * Default: all four.  --json <path> writes the machine-readable rollup.
 */
import { open } from '../lib/market/archive.mjs';
import { tax } from '../../js/money-math.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ── knobs (all fixed before any result was seen) ──────────────────────────────────────────────────
const HORIZONS_N = [1, 3, 7, 14, 30];   // Ben's ask verbatim. The repo's own multi-week horizon is 28.
const FWD = [1, 3, 7];                  // forward hold, days
const PIR_RESTING = 0.15;               // "resting on" the low — matches PLAN-DAY-LOW-SURFACING
const PRICE_FLOOR = 1000;               // gp; the prior study's penny-item artifact guard
/* 3,500 is PLAN-VOL24's `FLOOR` (pipeline/lib/signal/gatecandidates.mjs:69), where it is applied to
   CORRECTED ROLLING-24h volume. Here it is applied to a 14-day median of daily min-side volume — a
   related but NOT identical threshold, and NOT "the S1 gate" (docs/MARKET-ANALYSIS.md §: two-sided +
   ~100/day + the 250k gp/d attention floor). Stated because the first draft mislabelled it. */
const LIQ_MIN_UNITS = 3500;             // median daily min(hiVol,loVol)
/* ⚠ DEAD THRESHOLD, kept only so its deadness is documented rather than rediscovered. It can never
   bind: the panel build drops any day where either side VWAP is null, which requires loVol > 0 AND
   hiVol > 0, so min(loVol,hiVol) > 0 on every retained day and this ratio is always 1.0. The REAL
   selection is stricter than this constant advertises — 100% two-sided across all 31 trailing days —
   and it happens upstream in the panel build. */
const LIQ_TWOSIDED_FRAC = 0.90;         // share of trailing days printing BOTH sides (never binds — see above)

const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SECTION = argOf('--section', 'abcd');
const want = s => SECTION.includes(s);

// ── panel ────────────────────────────────────────────────────────────────────────────────────────
const h = open(undefined, { readonly: true });
// Only FULL days are usable; the archive's partial first/last day would fake a low or a high.
const cov = h.db.prepare(
  `SELECT date(ts,'unixepoch') d, COUNT(*) n FROM buckets WHERE grain='1h' GROUP BY d ORDER BY d`).all();
const DAYS = cov.filter(r => r.n >= 23).map(r => r.d);
const dayIdx = new Map(DAYS.map((d, i) => [d, i]));

const { ranges } = h.dailyRangeBulk({});
const vw = h.db.prepare(`
  SELECT itemId, date(ts,'unixepoch') AS d,
    SUM(CASE WHEN avgLowPrice  IS NOT NULL AND lowPriceVolume  > 0 THEN avgLowPrice  * lowPriceVolume  ELSE 0 END) loNum,
    SUM(CASE WHEN avgLowPrice  IS NOT NULL AND lowPriceVolume  > 0 THEN lowPriceVolume  ELSE 0 END) loVol,
    SUM(CASE WHEN avgHighPrice IS NOT NULL AND highPriceVolume > 0 THEN avgHighPrice * highPriceVolume ELSE 0 END) hiNum,
    SUM(CASE WHEN avgHighPrice IS NOT NULL AND highPriceVolume > 0 THEN highPriceVolume ELSE 0 END) hiVol
  FROM observations WHERE grain='1h' GROUP BY itemId, d`).all();

/* panel: itemId → array indexed by day-index. `buy`/`sell` are the day's SIDE VWAPs — the price a
   patient bid would have averaged, and the price a patient ask would have averaged. A day printing
   only one side is dropped: it cannot support a round trip in either direction. */
const panel = new Map();
for (const r of vw) {
  const di = dayIdx.get(r.d); if (di == null) continue;
  const rg = ranges[r.itemId] && ranges[r.itemId][r.d]; if (!rg) continue;
  const buy = r.loVol > 0 ? r.loNum / r.loVol : null;
  const sell = r.hiVol > 0 ? r.hiNum / r.hiVol : null;
  if (buy == null || sell == null) continue;
  let a = panel.get(r.itemId); if (!a) { a = new Array(DAYS.length).fill(null); panel.set(r.itemId, a); }
  a[di] = { lo: rg.lo, hi: rg.hi, mid: (buy + sell) / 2, buy, sell, loVol: r.loVol, hiVol: r.hiVol };
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const pct = x => x == null ? '   —  ' : ((x * 100 >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%');
function olsSlope(ys) {
  const n = ys.length; if (n < 3) return null;
  const mx = (n - 1) / 2, my = mean(ys);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - mx) * (ys[i] - my); den += (i - mx) ** 2; }
  return den > 0 ? num / den : null;
}
function tstat(xs) {
  const n = xs.length; if (n < 3) return null;
  const m = mean(xs), sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1));
  return sd > 0 ? m / (sd / Math.sqrt(n)) : null;
}

/* `pipeline/.cache/` is GITIGNORED, so on a clean checkout this file is absent. A bare `catch {}` made
   that failure SILENT — every item classified `unknown`, the item-class segment collapsed to one row,
   and a total mapping failure was indistinguishable from a clean run. Report coverage instead. */
let mapping = {}, mappingOk = false;
try {
  mapping = JSON.parse(fs.readFileSync(path.join(HERE, '..', '.cache', 'mapping.cache.json'), 'utf8'));
  mappingOk = Object.keys(mapping).length > 0;
} catch {}
if (!mappingOk) console.log('⚠ mapping.cache.json missing/empty — every item classifies `unknown`; '
  + 'the section-B item-class segment is NOT reproducible on this machine.');
/* Coarse GEAR/CONSUMABLE proxy for the update-cycle question (`update-cycle-timing`: combat/PvM GEAR
   dumps after a game update; consumables are update-insensitive). Name-keyword based, so it is a PROXY
   — its coverage is reported in section b rather than assumed. */
const GEAR_RE = /\b(sword|scimitar|longsword|dagger|rapier|whip|tentacle|maul|hammer|claws|halberd|spear|hasta|battleaxe|axe|mace|bow|blowpipe|crossbow|staff|wand|trident|shield|defender|helm|coif|hood|platebody|chestplate|platelegs|plateskirt|chainbody|body|top|legs|chaps|robe|boots|gloves|vambraces|bracers|cape|ring|amulet|necklace|bracelet|kiteshield|godsword|fang|armour|armor|torso|faceguard|assembler|blessing)\b/i;
const CONSUM_RE = /\b(potion|brew|restore|antidote|antifire|seed|sapling|herb|grimy|ore|bar|log|plank|rune|essence|coal|arrow|bolt|dart|javelin|bones|ashes|scale|dust|feather|nail|fish|shark|karambwan|pie|pizza|stew|bait|charge|vial|tar|blood|soul|death|nature|law|chaos|astral|cosmic|wrath)\b/i;
function itemClass(id) {
  const n = (mapping[id] && mapping[id].name) || ''; if (!n) return 'unknown';
  const g = GEAR_RE.test(n), c = CONSUM_RE.test(n);
  if (g) return 'gear';                     // "Rune platebody" — the noun wins over the material
  if (c) return 'consumable';
  return 'other';
}

// ── observations ─────────────────────────────────────────────────────────────────────────────────
/* Decision is made at the CLOSE of day D on complete data; the trade is entered on D+1 and exited on
   D+1+fwd. Every field on the row is strictly pre-decision — nothing reads a price at or after entry. */
const MAXN = Math.max(...HORIZONS_N), MAXF = Math.max(...FWD);
const obs = [];
for (const [id, a] of panel) {
  const cls = itemClass(id);
  for (let D = MAXN; D + 1 + MAXF < DAYS.length; D++) {
    const d0 = a[D]; if (!d0 || d0.mid < PRICE_FLOOR) continue;
    let ok = true; for (let k = D - MAXN; k <= D; k++) if (!a[k]) { ok = false; break; }
    if (!ok) continue;
    const entry = a[D + 1]; if (!entry) continue;

    const units = []; for (let k = D - 13; k <= D; k++) units.push(Math.min(a[k].loVol, a[k].hiVol));
    const liquid = median(units) >= LIQ_MIN_UNITS
      && units.filter(u => u > 0).length / units.length >= LIQ_TWOSIDED_FRAC;

    const sig = {};
    for (const N of HORIZONS_N) {
      const prior = []; for (let k = D - N; k <= D - 1; k++) prior.push(a[k].lo);
      sig['new' + N] = d0.lo <= Math.min(...prior);          // today PRINTED a new N-day low
      const winM = []; for (let k = D - N + 1; k <= D; k++) winM.push(a[k].mid);
      const lo = Math.min(...winM), hi = Math.max(...winM);
      const p = hi > lo ? (d0.mid - lo) / (hi - lo) : null;   // the shipped pctInRange shape
      sig['pir' + N] = p;
      sig['rest' + N] = p != null && p <= PIR_RESTING;        // RESTING ON its N-day low
    }
    const lows30 = [], highs30 = [], mids30 = [];
    for (let k = D - 29; k <= D; k++) { lows30.push(a[k].lo); highs30.push(a[k].hi); mids30.push(a[k].mid); }
    const s30 = olsSlope(lows30), loM = Math.min(...mids30), hiM = Math.max(...mids30);

    const rets = {};
    for (const fwd of FWD) {
      const exit = a[D + 1 + fwd]; if (!exit) { rets[fwd] = null; continue; }
      rets[fwd] = {
        midR: exit.mid / entry.mid - 1,                                              // directional, gross
        netPatient: (exit.sell - tax(Math.round(exit.sell)) - entry.buy) / entry.buy, // both legs patient
        netTaking: (exit.buy - tax(Math.round(exit.buy)) - entry.sell) / entry.sell,  // cross both ways
      };
    }
    obs.push({ id, D, cls, mid: d0.mid, liquid, sig, rets,
      floorSlopePct30: s30 != null ? s30 / d0.mid : null,
      drawdown30: (Math.max(...highs30) - d0.mid) / Math.max(...highs30),
      rangeWidth30: hiM > loM ? (hiM - loM) / loM : 0,
      entrySpread: (entry.sell - entry.buy) / entry.buy });
  }
}
const LQ = obs.filter(o => o.liquid);
const out = { meta: {}, a: {}, b: {}, c: {}, d: {} };
out.meta = { days: DAYS.length, dayRange: [DAYS[0], DAYS[DAYS.length - 1]],
  itemsInPanel: panel.size, observations: obs.length,
  originDays: new Set(obs.map(o => o.D)).size,
  liquidObs: LQ.length, liquidItems: new Set(LQ.map(o => o.id)).size };
console.log('=== PANEL ===\n' + JSON.stringify(out.meta, null, 1));

// ── A. base-rate comparison ──────────────────────────────────────────────────────────────────────
/* THE WHOLE STUDY IS THIS DIFFERENCE. An absolute "62% of N-day lows were higher a week later" is
   meaningless without the unconditional rate. The diff is computed as a per-ORIGIN-DAY cross-section
   (signal median − non-signal median on the same calendar day) so that (i) market-wide moves cancel
   and (ii) within-item serial correlation collapses to one number per day. What survives is the
   forward-horizon overlap between consecutive origin days — hence section d. */
function dayDiffs(sel, key, fwd, metric) {
  const byDay = new Map();
  for (const o of sel) {
    const r = o.rets[fwd]; if (!r) continue;
    let b = byDay.get(o.D); if (!b) { b = { s: [], n: [] }; byDay.set(o.D, b); }
    (o.sig[key] ? b.s : b.n).push(r[metric]);
  }
  return [...byDay].sort((x, y) => x[0] - y[0]).filter(([, b]) => b.s.length >= 3 && b.n.length >= 3)
    .map(([, b]) => median(b.s) - median(b.n));
}
if (want('a')) for (const [uname, U] of [['all', obs], ['liquid', LQ]]) {
  console.log(`\n\n===== A. BASE-RATE COMPARISON — universe ${uname} (obs ${U.length}, items ${new Set(U.map(o => o.id)).size}) =====`);
  for (const metric of ['midR', 'netPatient', 'netTaking']) {
    console.log(`\n-- ${metric} --`);
    console.log('signal   fwd    nSig   nBase   sigMed   baseMed     DIFF   t(day)   sign   items');
    for (const kind of ['new', 'rest']) for (const N of HORIZONS_N) {
      const key = kind + N;
      for (const fwd of FWD) {
        const sel = U.filter(o => o.rets[fwd] && o.sig[key] != null);
        const S = sel.filter(o => o.sig[key]), B = sel.filter(o => !o.sig[key]);
        if (S.length < 20 || !B.length) continue;
        const dd = dayDiffs(sel, key, fwd, metric), t = tstat(dd);
        console.log(key.padEnd(8) + String(fwd).padStart(3) + String(S.length).padStart(8) + String(B.length).padStart(8)
          + pct(median(S.map(o => o.rets[fwd][metric]))).padStart(9) + pct(median(B.map(o => o.rets[fwd][metric]))).padStart(10)
          + pct(mean(dd)).padStart(9) + (t == null ? '  —' : t.toFixed(2)).padStart(8)
          + `${dd.filter(x => x > 0).length}/${dd.length}`.padStart(8) + String(new Set(S.map(o => o.id)).size).padStart(7));
        out.a[`${uname}|${metric}|${key}|${fwd}`] = { nSig: S.length, nBase: B.length,
          items: new Set(S.map(o => o.id)).size, sigMed: median(S.map(o => o.rets[fwd][metric])),
          baseMed: median(B.map(o => o.rets[fwd][metric])), meanDayDiff: mean(dd), t, nDays: dd.length,
          posDays: dd.filter(x => x > 0).length };
      }
    }
  }
}

// ── B. discriminator hunt ────────────────────────────────────────────────────────────────────────
/* The brief's real question: under what conditions does an N-day low mean DISCOUNT rather than THE
   FLOOR IS BREAKING? ANSWER, after review: nothing tested here separates them — see FINDINGS §3.
   ⚠ SEGMENTS ARE PRE-DECISION *EXCEPT* THE `spread` COLUMN, which is `entrySpread` (day D+1) and is a
   MECHANISM DIAGNOSTIC ONLY. An earlier version of this comment claimed all segments were strictly
   pre-decision; that was false and is exactly the kind of claim that gets copied into a doc.
   Read section C before believing any of these — the drawdown gradient is partly a spread artifact,
   and the pooled-vs-per-item weightings disagree (per-item is printed alongside for that reason). */
const SEGS = {
  'floor slope (30d)': [o => o.floorSlopePct30 == null ? 'unknown' : o.floorSlopePct30 > 0.002 ? 'floor rising' : o.floorSlopePct30 < -0.002 ? 'floor falling' : 'floor flat',
    ['floor rising', 'floor flat', 'floor falling']],
  'drawdown from 30d high': [o => o.drawdown30 < 0.05 ? 'dd <5%' : o.drawdown30 < 0.15 ? 'dd 5-15%' : o.drawdown30 < 0.30 ? 'dd 15-30%' : 'dd >30%',
    ['dd <5%', 'dd 5-15%', 'dd 15-30%', 'dd >30%']],
  'price tier': [o => o.mid < 1e4 ? '1k-10k' : o.mid < 1e5 ? '10k-100k' : o.mid < 1e6 ? '100k-1m' : o.mid < 1e7 ? '1m-10m' : '>10m',
    ['1k-10k', '10k-100k', '100k-1m', '1m-10m', '>10m']],
  'item class': [o => o.cls, ['gear', 'consumable', 'other', 'unknown']],
};
if (want('b')) {
  console.log('\n\n===== B. DISCRIMINATOR HUNT (liquid universe, +7d) =====');
  for (const metric of ['midR', 'netPatient']) for (const key of ['new7', 'new30', 'rest30']) {
    const sel = LQ.filter(o => o.rets[7] && o.sig[key]);
    const base = median(LQ.filter(o => o.rets[7] && !o.sig[key]).map(o => o.rets[7][metric]));
    for (const [title, [fn, names]] of Object.entries(SEGS)) {
      console.log(`\n${title}  [${key}, +7d, ${metric}]   base rate (non-signal) ${pct(base)}`);
      console.log('  segment           n   items   median  perItemMed   P(>0)   spread');
      for (const sn of names) {
        const g = sel.filter(o => fn(o) === sn); if (g.length < 5) continue;
        const byItem = new Map();
        for (const o of g) { let v = byItem.get(o.id); if (!v) { v = []; byItem.set(o.id, v); } v.push(o.rets[7][metric]); }
        const rec = { n: g.length, items: byItem.size, med: median(g.map(o => o.rets[7][metric])),
          perItem: median([...byItem.values()].map(median)),
          pUp: g.filter(o => o.rets[7][metric] > 0).length / g.length,
          spread: median(g.map(o => o.entrySpread)) };
        console.log('  ' + sn.padEnd(16) + String(rec.n).padStart(5) + String(rec.items).padStart(8)
          + pct(rec.med).padStart(9) + pct(rec.perItem).padStart(12)
          + (rec.pUp * 100).toFixed(0).padStart(7) + '%' + pct(rec.spread).padStart(9));
        out.b[`${metric}|${key}|${title}|${sn}`] = rec;
      }
    }
  }
}

// ── C. refuting tests ────────────────────────────────────────────────────────────────────────────
if (want('c')) {
  console.log('\n\n===== C. REFUTING TESTS =====');
  const ddFn = SEGS['drawdown from 30d high'][0], ddNames = SEGS['drawdown from 30d high'][1];

  console.log('\nC1. Is the drawdown gradient DIRECTIONAL EDGE or SPREAD CAPTURE?');
  console.log('    Falsified as "deeper low = stronger bounce" if entrySpread tracks dd while midR does not.');
  console.log('sig      bucket        n   entrySpread  30dRangeW     midR  netPatient  net−spread');
  for (const [nm, sel] of [['rest30', LQ.filter(o => o.rets[7] && o.sig.rest30)], ['new7', LQ.filter(o => o.rets[7] && o.sig.new7)], ['ALL', LQ.filter(o => o.rets[7])]]) {
    for (const b of ddNames) {
      const g = sel.filter(o => ddFn(o) === b); if (g.length < 20) continue;
      const sp = median(g.map(o => o.entrySpread)), np = median(g.map(o => o.rets[7].netPatient));
      console.log(nm.padEnd(8) + b.padEnd(12) + String(g.length).padStart(5) + pct(sp).padStart(12)
        + pct(median(g.map(o => o.rangeWidth30))).padStart(11) + pct(median(g.map(o => o.rets[7].midR))).padStart(10)
        + pct(np).padStart(11) + pct(np - sp).padStart(12));
      out.c[`C1|${nm}|${b}`] = { n: g.length, spread: sp, netPatient: np, midR: median(g.map(o => o.rets[7].midR)) };
    }
    console.log('');
  }

  /* C1b. The unconditional round trip, so section 2 of the findings doc is reproducible from here.
     This is the number that decides the study: if buying the bid and selling the ask a week later
     already loses on this population, no ~1pp relative signal rescues it. */
  const b7 = LQ.filter(o => o.rets[7]);
  const baseline = { n: b7.length, spread: median(b7.map(o => o.entrySpread)),
    midR: median(b7.map(o => o.rets[7].midR)), netPatient: median(b7.map(o => o.rets[7].netPatient)),
    netTaking: median(b7.map(o => o.rets[7].netTaking)),
    pNetPos: b7.filter(o => o.rets[7].netPatient > 0).length / b7.length };
  out.c.C1b_baseline = baseline;
  console.log(`C1b. UNCONDITIONAL baseline, liquid universe, +7d (n=${baseline.n}):`);
  console.log(`     entry spread ${pct(baseline.spread)} · mid drift ${pct(baseline.midR)} · `
    + `net PATIENT ${pct(baseline.netPatient)} · net TAKING ${pct(baseline.netTaking)} · `
    + `P(netPatient>0) ${(baseline.pNetPos * 100).toFixed(1)}%`);
  console.log('     The spread sits BELOW the 2% GE tax — the round trip loses before any signal.\n');

  console.log('C2. Does the SIGNAL select wider spreads than the base rate? (if yes, the headline is spread selection)');
  for (const key of ['rest30', 'new7', 'new30']) {
    const S = LQ.filter(o => o.rets[7] && o.sig[key]), B = LQ.filter(o => o.rets[7] && !o.sig[key]);
    const rec = { sigSpread: median(S.map(o => o.entrySpread)), baseSpread: median(B.map(o => o.entrySpread)) };
    console.log(`  ${key.padEnd(8)} signal spread ${pct(rec.sigSpread)}  vs base ${pct(rec.baseSpread)}`);
    out.c[`C2|${key}`] = rec;
  }

  console.log('\nC3. SPREAD-MATCHED control — the netPatient diff inside entry-spread deciles.');
  const sorted = LQ.filter(o => o.rets[7]).sort((a, b) => a.entrySpread - b.entrySpread);
  const dec = Math.ceil(sorted.length / 10);
  for (const key of ['rest30', 'new7']) {
    const diffs = [];
    for (let i = 0; i < 10; i++) {
      const g = sorted.slice(i * dec, (i + 1) * dec);
      const S = g.filter(o => o.sig[key]), B = g.filter(o => !o.sig[key]);
      if (S.length < 20 || B.length < 20) continue;
      diffs.push(median(S.map(o => o.rets[7].netPatient)) - median(B.map(o => o.rets[7].netPatient)));
    }
    console.log(`  ${key.padEnd(8)} median across ${diffs.length} deciles ${pct(median(diffs))}   [${diffs.map(pct).join(' ')}]`);
    out.c[`C3|${key}`] = { deciles: diffs, median: median(diffs) };
  }

  console.log('\nC4. ENTRY-LAG control — a pure entry-print artifact decays fast with lag.');
  console.log('lag  sig      nSig   sigMidR  baseMidR     DIFF  |  sigNet  baseNet     DIFF');
  for (const LAG of [1, 2, 3]) {
    const rows = [];
    for (const [id, a] of panel) for (let D = 30; D + LAG + 7 < DAYS.length; D++) {
      const d0 = a[D]; if (!d0 || d0.mid < PRICE_FLOOR) continue;
      let ok = true; for (let k = D - 30; k <= D; k++) if (!a[k]) { ok = false; break; }
      if (!ok) continue;
      const en = a[D + LAG], ex = a[D + LAG + 7]; if (!en || !ex) continue;
      const u = []; for (let k = D - 13; k <= D; k++) u.push(Math.min(a[k].loVol, a[k].hiVol));
      if (!(median(u) >= LIQ_MIN_UNITS && u.filter(x => x > 0).length / u.length >= LIQ_TWOSIDED_FRAC)) continue;
      const m30 = [], p7 = [];
      for (let k = D - 29; k <= D; k++) m30.push(a[k].mid);
      for (let k = D - 7; k <= D - 1; k++) p7.push(a[k].lo);
      const lo = Math.min(...m30), hi = Math.max(...m30);
      rows.push({ rest30: hi > lo && (d0.mid - lo) / (hi - lo) <= PIR_RESTING, new7: d0.lo <= Math.min(...p7),
        midR: ex.mid / en.mid - 1, net: (ex.sell - tax(Math.round(ex.sell)) - en.buy) / en.buy });
    }
    for (const key of ['rest30', 'new7']) {
      const S = rows.filter(o => o[key]), B = rows.filter(o => !o[key]);
      const rec = { nSig: S.length, sigMidR: median(S.map(o => o.midR)), baseMidR: median(B.map(o => o.midR)),
        sigNet: median(S.map(o => o.net)), baseNet: median(B.map(o => o.net)) };
      console.log(String(LAG).padEnd(5) + key.padEnd(8) + String(rec.nSig).padStart(6)
        + pct(rec.sigMidR).padStart(10) + pct(rec.baseMidR).padStart(10) + pct(rec.sigMidR - rec.baseMidR).padStart(9)
        + '  |' + pct(rec.sigNet).padStart(8) + pct(rec.baseNet).padStart(9) + pct(rec.sigNet - rec.baseNet).padStart(9));
      out.c[`C4|lag${LAG}|${key}`] = rec;
    }
  }
}

// ── D. independence + coverage ───────────────────────────────────────────────────────────────────
if (want('d')) {
  console.log('\n\n===== D. INDEPENDENCE ACCOUNTING + BIG-TICKET COVERAGE =====');
  const originDays = new Set(LQ.map(o => o.D)).size;
  // ceil, not floor: the subsample below keeps indices 0,8,16,… of `originDays`, which is
  // ceil(n/8) days (35 → 5: D = 30,38,46,54,62). `floor` reported 4 and disagreed with the
  // subsample the study actually runs — caught in adversarial review.
  const indep = { panelDays: DAYS.length, originDays,
    nonOverlapping7dWindows: Math.ceil(originDays / 8),
    nonOverlapping30dTrailing: +(DAYS.length / 30).toFixed(1),
    liquidItems: new Set(LQ.map(o => o.id)).size,
    liquidItemsEverFiringRest30: new Set(LQ.filter(o => o.sig.rest30).map(o => o.id)).size };
  out.d.independence = indep;
  for (const [k, v] of Object.entries(indep)) console.log('  ' + k.padEnd(30) + v);

  console.log('\n  Non-overlapping +7d subsample (every 8th origin day):');
  const oDays = [...new Set(LQ.map(o => o.D))].sort((a, b) => a - b);
  const keep = new Set(oDays.filter((_, i) => i % 8 === 0));
  const sub = LQ.filter(o => keep.has(o.D) && o.rets[7]);
  console.log('  signal   metric        nSig  nBase   sigMed   baseMed     DIFF');
  for (const key of ['new1', 'new3', 'new7', 'new14', 'new30', 'rest7', 'rest30'])
    for (const metric of ['midR', 'netPatient']) {
      const S = sub.filter(o => o.sig[key]), B = sub.filter(o => !o.sig[key]);
      if (S.length < 10) continue;
      const ms = median(S.map(o => o.rets[7][metric])), mb = median(B.map(o => o.rets[7][metric]));
      console.log('  ' + key.padEnd(8) + metric.padEnd(13) + String(S.length).padStart(5) + String(B.length).padStart(7)
        + pct(ms).padStart(9) + pct(mb).padStart(10) + pct(ms - mb).padStart(9));
      out.d[`NONOVER|${key}|${metric}`] = { nSig: S.length, sigMed: ms, baseMed: mb, diff: ms - mb, days: keep.size };
    }

  console.log('\n  Price-tier coverage — does the big-ticket class Ben trades exist in this sample?');
  const tier = SEGS['price tier'][0];
  for (const [nm, U] of [['liquid-gated', LQ], ['ALL (no liquidity gate)', obs]]) {
    console.log('  ' + nm);
    for (const t of SEGS['price tier'][1]) {
      const g = U.filter(o => tier(o) === t && o.rets[7]); if (!g.length) { console.log('    ' + t.padEnd(10) + 'items     0'); continue; }
      const gs = g.filter(o => o.sig.rest30);
      const rec = { items: new Set(g.map(o => o.id)).size, obs: g.length, sigObs: gs.length,
        sigItems: new Set(gs.map(o => o.id)).size, midR: median(gs.map(o => o.rets[7].midR)),
        netPatient: median(gs.map(o => o.rets[7].netPatient)), spread: median(g.map(o => o.entrySpread)) };
      console.log('    ' + t.padEnd(10) + `items ${String(rec.items).padStart(5)}  obs ${String(rec.obs).padStart(6)}`
        + ` | rest30 obs ${String(rec.sigObs).padStart(5)} items ${String(rec.sigItems).padStart(4)}`
        + `  midR ${pct(rec.midR)}  netPatient ${pct(rec.netPatient)}  spread ${pct(rec.spread)}`);
      out.d[`TIER|${nm}|${t}`] = rec;
    }
  }
}

const jsonPath = argOf('--json', null);
if (jsonPath) { fs.writeFileSync(jsonPath, JSON.stringify(out, null, 1)); console.log('\nwrote ' + jsonPath); }
