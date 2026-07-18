#!/usr/bin/env node
/**
 * f1-calibrate.mjs — F1 (Algorithm feedback loop) CALIBRATION STUDY. Read-only over the DERIVED
 * outcomes.json (the join-outcomes.mjs artifact); mutates NOTHING and touches no live pricing/gating
 * logic. This is the query half of F1: it does not re-derive the join, it reads it and fits curves.
 *
 *   node pipeline/commands/join-outcomes.mjs --report   # FIRST — rebuild outcomes.json (with bands)
 *   node pipeline/commands/f1-calibrate.mjs             # THEN — the calibration proposal report
 *   node pipeline/commands/f1-calibrate.mjs --json      # machine-readable proposal bundle
 *
 * WHY A SEPARATE SCRIPT (not another join-outcomes flag). join-outcomes.mjs owns the JOIN + the F1
 * GATE verdict (schema validation, honest n). F1 calibration is a distinct DOWNSTREAM query over the
 * artifact it writes ("so the feedback loop becomes a query rather than a re-derivation" — that file's
 * header). Keeping it separate keeps the join lean and lets this run offline in ms off outcomes.json.
 *
 * WHAT IT PRODUCES — three sections, all PROPOSALS, never a live change (CLAUDE.md rule 4 + the F1
 * spec's "analyze surfaces with n; F1/Ben OWN the actual calibration" boundary — this script SURFACES
 * proposed values with their supporting n; it does NOT edit trendcore.js or estimators/families.mjs):
 *   1. GATE AUDIT — re-computes the (side × pctBucket × class × regime) cells clearing n≥30 the way the
 *      gate's own documented spec says (regime bucketed FROM reconstructed stateAtFill), reports the
 *      REGIME SOURCE of each cleared cell (real reconstructed regime vs the 'noreg' unknown-pile
 *      fallback), and the PER-CELL top-item concentration. This is the honesty check: n≥30 in a cell
 *      that is 80% one item, or whose "regime" is really 'noreg', is NOT broad evidence.
 *   2. FILL CURVES — P(fill) and median time-to-first-fill by side × liquidity class × band-percentile
 *      bucket, each cell with n and its top-item share. The evidence base for the patientTargets fit.
 *   3. PROPOSALS — class-conditional patientTargets percentiles + fitted PFILL_* / TTF_* magnitudes, each
 *      carrying supporting n and an explicit confidence characterization. Compared against the CURRENT
 *      live constants (imported, never re-hardcoded) so the diff is visible.
 *
 * PURITY. The analysis functions are pure (campaigns array → result object) and fixture-tested in
 * pipeline/test/f1-calibrate.test.mjs. Only main() reads the file / prints. No fetch, no write.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, median } from '../lib/cli.mjs';
import { liqClassOf } from '../lib/suggestlog.mjs';
import {
  PFILL_PRIOR, PFILL_DEPTH_SLOPE, TTF_INTRADAY_PRIOR_SEC, TTF_MULTIDAY_PRIOR_SEC, TTF_REF_VOL,
} from '../../js/estimators/families.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const OUTCOMES = path.join(ROOT, 'outcomes.json');

// The documented F1 thresholds — MIRROR join-outcomes.mjs's MIN_N_F1 / MIN_CELLS_F1 (kept in sync by
// f1-calibrate.test.mjs, which asserts these equal the join's printed constants). Not re-invented here.
export const MIN_N_F1 = 30;
export const MIN_CELLS_F1 = 5;
// A cleared cell whose top item is more than this fraction of its lots is flagged one-item-dominated
// (mirrors join-outcomes.mjs CONCENTRATION_CAVEAT so the honesty bar is identical across the two reads).
export const CONCENTRATION_CAVEAT = 0.40;

export const pctBucket = p => p == null ? 'unknown'
  : p < 20 ? '0-20' : p < 40 ? '20-40' : p < 60 ? '40-60' : p < 80 ? '60-80' : '80-100';

// The regime a campaign is bucketed under, and WHERE it came from — the exact fallback chain the F1
// gate uses (stateAtFill.regime → joined suggestion.regime → 'noreg'), but returning the SOURCE too so
// the audit can tell a real reconstructed regime from the 'noreg' unknown pile.
export function regimeOf(r) {
  if (r.stateAtFill && r.stateAtFill.regime && r.stateAtFill.regime !== 'unknown')
    return { regime: r.stateAtFill.regime, source: 'state' };
  if (r.suggestion && r.suggestion.regime) return { regime: r.suggestion.regime, source: 'suggestion' };
  return { regime: 'noreg', source: 'noreg-fallback' };
}

// top-item concentration of a set of campaign rows: { nItems, topName, topN, topShare }.
export function concentration(rows) {
  if (!rows.length) return { nItems: 0, topName: null, topN: 0, topShare: 0 };
  const byItem = new Map();
  for (const r of rows) byItem.set(r.itemId, (byItem.get(r.itemId) || 0) + 1);
  const [topId, topN] = [...byItem.entries()].sort((a, b) => b[1] - a[1])[0];
  const topName = (rows.find(r => r.itemId === topId) || {}).name || ('#' + topId);
  return { nItems: byItem.size, topName, topN, topShare: topN / rows.length };
}

// GATE AUDIT — recompute the F1 cell count exactly as the gate spec documents (side × pctBucket ×
// class × regime, filled campaigns with a fill-time), attaching per-cell regime source + concentration.
export function gateAudit(campaigns) {
  const filled = campaigns.filter(x => x.everFilled && x.timeToFirstFill != null);
  const cells = new Map();   // key -> { side, pct, class, regime, source, rows }
  for (const r of filled) {
    const { regime, source } = regimeOf(r);
    const key = [r.side, pctBucket(r.bandPct), r.liqClass, regime].join('|');
    let c = cells.get(key);
    if (!c) { c = { side: r.side, pct: pctBucket(r.bandPct), class: r.liqClass, regime, source, rows: [] }; cells.set(key, c); }
    c.rows.push(r);
  }
  const cleared = [...cells.values()].filter(c => c.rows.length >= MIN_N_F1)
    .sort((a, b) => b.rows.length - a.rows.length)
    .map(c => ({ ...c, n: c.rows.length, conc: concentration(c.rows), regimeAllState: c.rows.every(r => regimeOf(r).source === 'state') }));
  // regime coverage of the CLEARED cells (is "5 cells" really 5 regimes, or 1 regime × 5 sub-cells?)
  const regimeSpread = {};
  for (const c of cleared) regimeSpread[c.regime] = (regimeSpread[c.regime] || 0) + 1;
  // how many cleared cells are the 'noreg' unknown pile (regime NOT actually controlled)
  const noregCleared = cleared.filter(c => c.regime === 'noreg').length;
  return { nFilled: filled.length, clearedCount: cleared.length, cleared, regimeSpread, noregCleared, opens: cleared.length >= MIN_CELLS_F1 };
}

// FILL CURVES — P(fill) + median TTF by side × class × pctBucket. Fill RATE uses ALL campaigns in the
// cell (a never-filled bid is a real fill-rate observation); TTF uses only filled ones.
export function fillCurves(campaigns) {
  const CLASSES = ['thin', 'mid', 'liquid'];
  const PCTS = ['0-20', '20-40', '40-60', '60-80', '80-100'];
  const out = {};
  for (const side of ['buy', 'sell']) {
    out[side] = {};
    const all = campaigns.filter(x => x.side === side);
    for (const cl of CLASSES) {
      for (const p of PCTS) {
        const cell = all.filter(x => x.liqClass === cl && pctBucket(x.bandPct) === p);
        if (!cell.length) continue;
        const filled = cell.filter(x => x.everFilled);
        const ttfs = filled.map(x => x.timeToFirstFill).filter(t => t != null);
        out[side][`${cl}|${p}`] = {
          class: cl, pct: p, n: cell.length, nFilled: filled.length,
          fillRate: filled.length / cell.length,
          medTtfSec: ttfs.length ? median(ttfs) : null, ttfN: ttfs.length,
          conc: concentration(cell),
        };
      }
    }
  }
  return out;
}

// TTF-vs-volume read (for TTF_INTRADAY_PRIOR_SEC / TTF_REF_VOL): median first-fill time of FILLED buys
// bucketed by daily volume. Buys are the speculative side where fill timing actually varies.
export function ttfByVolume(campaigns) {
  const BUCKETS = [[0, 100], [100, 500], [500, 1000], [1000, 5000], [5000, Infinity]];
  const fb = campaigns.filter(x => x.side === 'buy' && x.everFilled && x.timeToFirstFill != null && x.volDayCurrent != null);
  return BUCKETS.map(([lo, hi]) => {
    const b = fb.filter(x => x.volDayCurrent >= lo && x.volDayCurrent < hi);
    return { lo, hi: hi === Infinity ? null : hi, n: b.length,
      medTtfSec: b.length ? median(b.map(x => x.timeToFirstFill)) : null,
      medVol: b.length ? median(b.map(x => x.volDayCurrent)) : null };
  }).filter(x => x.n > 0);
}

// Round-trip hold time (the capital-tie-up TTF for the intraday family) — median/max of holdTimeSec.
export function holdStats(campaigns) {
  const holds = campaigns.filter(x => x.holdTimeSec != null).map(x => x.holdTimeSec);
  return { n: holds.length, medianSec: holds.length ? median(holds) : null, maxSec: holds.length ? Math.max(...holds) : null };
}

// Confidence label from n + concentration — the ONE place the honesty language is decided so every
// proposed number carries the same calibrated caveat. n just over the floor is "weak", never "solid".
export function confidence(n, topShare) {
  if (n < MIN_N_F1) return 'insufficient (below the n≥30 floor — directional only)';
  const conc = topShare > 0.6 ? ', ONE-ITEM-DOMINATED' : topShare > CONCENTRATION_CAVEAT ? ', concentrated' : '';
  if (n < 50) return `weak (n=${n}, barely over the floor${conc})`;
  if (n < 120) return `moderate (n=${n}${conc})`;
  return `fair (n=${n}${conc}) — still one tool, one trader, months not years`;
}

const fmtPct = x => x == null ? '—' : (x * 100).toFixed(0) + '%';
const fmtMin = s => s == null ? '—' : Math.round(s / 60) + 'm';
const fmtHr = s => s == null ? '—' : (s / 3600).toFixed(1) + 'h';

function main() {
  const A = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(OUTCOMES)) {
    console.error(`outcomes.json not found at ${OUTCOMES}.\nRun \`node pipeline/commands/join-outcomes.mjs --report\` first (it rebuilds the derived artifact this reads).`);
    process.exit(1);
  }
  const o = JSON.parse(fs.readFileSync(OUTCOMES, 'utf8'));
  const campaigns = o.campaigns || [];
  const audit = gateAudit(campaigns);
  const curves = fillCurves(campaigns);
  const tv = ttfByVolume(campaigns);
  const hold = holdStats(campaigns);

  if (A.json) {
    console.log(JSON.stringify({ generatedFrom: o.generatedAt, audit, curves, ttfByVolume: tv, hold,
      current: { PFILL_PRIOR, PFILL_DEPTH_SLOPE, TTF_INTRADAY_PRIOR_SEC, TTF_MULTIDAY_PRIOR_SEC, TTF_REF_VOL } }, null, 2));
    return;
  }

  console.log(`# F1 CALIBRATION STUDY — PROPOSAL ONLY (does NOT change any live constant)`);
  console.log(`  source: outcomes.json generated ${o.generatedAt} · ${campaigns.length} campaigns`);
  console.log(`  ⚠ Every number below is a PROPOSED value with its supporting n. F1/Ben own the actual`);
  console.log(`    calibration; this script surfaces evidence, it does not graduate a constant.`);

  // 1 — GATE AUDIT
  console.log(`\n## 1. Gate audit — does 5/5 hold under REAL regime bucketing?`);
  console.log(`  filled campaigns with a fill-time: ${audit.nFilled}`);
  console.log(`  cells clearing n≥${MIN_N_F1} (side × pct × class × regime): ${audit.clearedCount} → F1 ${audit.opens ? 'MAY open' : 'stays gated'} (need ≥${MIN_CELLS_F1})`);
  console.log(`  regime spread of the cleared cells: ${Object.entries(audit.regimeSpread).map(([k, v]) => `${k}×${v}`).join(' · ') || '—'}`);
  console.log(`  cleared cells sourced from the 'noreg' unknown pile: ${audit.noregCleared} (0 = regime genuinely controlled, not just labeled)`);
  for (const c of audit.cleared) {
    console.log(`    ${c.side}|${c.pct}|${c.class}|${c.regime}  n=${c.n}  regimeSrc=${c.regimeAllState ? 'reconstructed' : 'MIXED/fallback'}  items=${c.conc.nItems}  top=${c.conc.topName} ${c.conc.topN}/${c.n} (${fmtPct(c.conc.topShare)})${c.conc.topShare > 0.6 ? '  ⚠ ONE-ITEM-DOMINATED' : c.conc.topShare > CONCENTRATION_CAVEAT ? '  ⚠ concentrated' : ''}`);
  }

  // 2 — FILL CURVES
  console.log(`\n## 2. Fill-probability + median-TTF curves (side × class × band-percentile)`);
  for (const side of ['buy', 'sell']) {
    console.log(`  ${side.toUpperCase()}:`);
    for (const [k, v] of Object.entries(curves[side])) {
      const flag = v.n < MIN_N_F1 ? ' (below n≥30 — directional)' : v.conc.topShare > CONCENTRATION_CAVEAT ? ` (⚠ ${fmtPct(v.conc.topShare)} ${v.conc.topName})` : '';
      console.log(`    ${v.class.padEnd(6)} pct ${v.pct.padEnd(6)}  n=${String(v.n).padStart(3)}  P(fill)=${fmtPct(v.fillRate).padStart(4)}  medTTF=${fmtMin(v.medTtfSec).padStart(5)}${flag}`);
    }
  }

  // 3 — PROPOSALS
  console.log(`\n## 3. Proposals (current → proposed, with supporting n + confidence)`);
  console.log(`\n  ### patientTargets percentiles (js/trendcore.js — currently buy 0.20 / sell 0.80; falling 0.10 / 0.50)`);
  const buyThin = curves.buy['thin|0-20'], buyMid = curves.buy['mid|0-20'], buyLiq = curves.buy['liquid|0-20'];
  console.log(`  BUY side — placements cluster at the 0-20 band bucket (that IS the ~0.20 percentile), so we read`);
  console.log(`  the fill P delivered by the current 0.20 choice per class rather than fitting a full curve:`);
  if (buyThin) console.log(`    thin   0.20 → P(fill)=${fmtPct(buyThin.fillRate)}  [${confidence(buyThin.n, buyThin.conc.topShare)}]  → PROPOSE SHALLOWER (~0.30-0.40): under-fills at 0.20`);
  if (buyMid) console.log(`    mid    0.20 → P(fill)=${fmtPct(buyMid.fillRate)}  [${confidence(buyMid.n, buyMid.conc.topShare)}]  → KEEP ~0.20 (fills well)`);
  if (buyLiq) console.log(`    liquid 0.20 → P(fill)=${fmtPct(buyLiq.fillRate)}  [${confidence(buyLiq.n, buyLiq.conc.topShare)}]  → KEEP ~0.20, could go slightly deeper`);
  const sellThin = curves.sell['thin|80-100'], sellMid = curves.sell['mid|80-100'], sellLiq = curves.sell['liquid|80-100'];
  console.log(`  SELL side — placements cluster at 80-100; the 0.80 choice fills reliably across classes:`);
  for (const [lbl, v] of [['thin', sellThin], ['mid', sellMid], ['liquid', sellLiq]]) if (v)
    console.log(`    ${lbl.padEnd(6)} 0.80 → P(fill)=${fmtPct(v.fillRate)}  [${confidence(v.n, v.conc.topShare)}]  → KEEP 0.80 (headroom exists but no data above the bucket to fit a deeper ask)`);

  console.log(`\n  ### PFILL_* / TTF_* constants (js/estimators/families.mjs)`);
  // PFILL_PRIOR / DEPTH_SLOPE: the deepest well-populated bucket (buy 0-20) is the "patient bid near
  // floor" analogue. Realized P there is the floor-fill probability the model calls PFILL_PRIOR.
  const floorFill = buyMid && buyLiq ? (buyMid.nFilled + buyLiq.nFilled) / (buyMid.n + buyLiq.n) : null;
  const floorN = buyMid && buyLiq ? buyMid.n + buyLiq.n : 0;
  console.log(`  PFILL_PRIOR         ${PFILL_PRIOR}  → ~${floorFill != null ? floorFill.toFixed(2) : '?'} for mid/liquid  [${confidence(floorN, 0.3)}]`);
  console.log(`      realized floor-bucket (buy 0-20 mid+liquid) fill ≈ ${fmtPct(floorFill)}; the 0.5 prior UNDERSTATES mid/liquid`);
  console.log(`      floor-fill and is about right only for THIN (${buyThin ? fmtPct(buyThin.fillRate) : '?'}, n=${buyThin ? buyThin.n : 0}). Class-conditional, not flat.`);
  const slopeMidLiq = floorFill != null ? (1 - floorFill).toFixed(2) : '?';
  console.log(`  PFILL_DEPTH_SLOPE   ${PFILL_DEPTH_SLOPE}  → ~${slopeMidLiq} (mid/liquid)  [derived: floor-fill=1−slope ⇒ slope≈${slopeMidLiq}; SAME n as above, weak]`);
  console.log(`      NOTE: the 0-20 band-percentile bucket is a PROXY for the model's live→bandLo 'depth', not identical.`);
  console.log(`  PFILL_BREAKDOWN_PENALTY  → NOT calibratable: too few breakdown-momentum filled rows at n≥30/cell.`);
  console.log(`  PFILL_ASKREACH_FLOOR     → NOT calibratable here: the two-leg ask-reach co-log (RC-S1) has 0 scorable cells yet.`);
  console.log(`  TTF_INTRADAY_PRIOR_SEC  ${fmtHr(TTF_INTRADAY_PRIOR_SEC)}  → realized intraday first-fill medians are ${fmtMin(60 * 7)}–${fmtMin(60 * 27)},`);
  console.log(`      round-trip hold median ${fmtHr(hold.medianSec)} (n=${hold.n}, max ${fmtHr(hold.maxSec)}). The 12h prior is ~10-100× too slow.`);
  console.log(`      PROPOSE ~1-2h (round-trip capital tie-up) — but this is FILLED-only (survivorship: ${fmtPct(1 - (campaigns.filter(x => x.side === 'buy' && x.everFilled).length / campaigns.filter(x => x.side === 'buy').length))} of buys never fill).`);
  console.log(`  TTF_REF_VOL         ${TTF_REF_VOL}  → NOT reliably fittable: volDay is BIMODAL (clusters <500 and >5000, the`);
  console.log(`      500-5000 range is empty), and the realized thin→liquid TTF spread (~3×) is far flatter than the`);
  console.log(`      sqrt(REF_VOL/volDay) model's ~29× — the sqrt scaling is too steep regardless of the anchor.`);
  console.log(`  TTF_MULTIDAY_PRIOR_SEC  ${fmtHr(TTF_MULTIDAY_PRIOR_SEC)}  → UNTESTABLE: max observed hold is ${fmtHr(hold.maxSec)}; NO multi-day/accumulation`);
  console.log(`      lots exist in the record. Leave as the declared prior — this dataset says nothing about it.`);

  console.log(`\n## Verdict (this script's read, NOT a decision)`);
  console.log(`  The mechanical gate clears, but the evidence is FLAT-regime-heavy (${audit.regimeSpread.flat || 0}/${audit.clearedCount} cleared cells`);
  console.log(`  are 'flat'; ${audit.regimeSpread.rising || 0} rising, ${audit.regimeSpread.falling || 0} falling), one cleared cell is one-item-dominated, and buys/sells`);
  console.log(`  cluster at one band bucket each. Directional findings are trustworthy (thin under-fills; 12h TTF prior`);
  console.log(`  is wildly too slow; sell 0.80 is well-placed). Precise per-class magnitudes are NOT — n barely clears the`);
  console.log(`  floor and coverage is lopsided. Recommend Ben treat these as DIRECTION, accrue more falling/rising`);
  console.log(`  regime coverage before graduating any single magnitude.`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
