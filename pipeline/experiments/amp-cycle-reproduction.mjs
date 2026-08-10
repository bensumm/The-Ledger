#!/usr/bin/env node
/**
 * amp-cycle-reproduction.mjs — the standing regression check on DT1b's core correctness property.
 *
 * WHAT IT ANSWERS. Two ways of measuring the amplitude lane's round-trip rate disagreed by ~4×, and it
 * was not clear which was wrong:
 *   (a) IN-SAMPLE, day grain — `cycleCompletion`, whose ampBid/ampAsk are the median low/high of the
 *       very 14 days it then scores. Shipped briefly at DT1, rejected the same day.
 *   (b) OUT-OF-SAMPLE, hour grain — the DT1 study's design, reimplemented here: `amplitudeRanges`
 *       levels fitted STRICTLY before each origin day (`p.timestamp < midnight(T)`, 15-day warmup),
 *       entry = the first day-T hour at or below ampBid, completion = any later hour reaching ampAsk
 *       within 24h/96h. This is what shipped as `ampWalkForward` (DT1b).
 *
 * THE ANSWER. The study reproduces EXACTLY — Saturated heart 0.0% @96h (n=41) and Masori chaps 12.9%
 * @24h (n=31), against its published 0% and 12.9%. The day-grain version reads 100% and 85.7% on those
 * same items. The defect is CIRCULARITY: median-of-the-scored-days levels are cleared by ~50% of those
 * days by definition, and a multi-day horizon compounds that to ~94%.
 *
 * WHY IT STAYS. `js/amplitudescreen.mjs` and `js/estimators/families.mjs` both cite this harness as the
 * validation source for ranking on the walk-forward. It runs THREE columns — the rejected in-sample
 * figure, an independent reimplementation of the study, and the SHIPPED `ampWalkForward` itself — so it
 * catches both a break in the shared helpers (col 1 converging on col 3) and a regression inside the
 * production function (col 3 diverging from col 2). That is the regression this file exists to catch.
 *
 * Reads the archive READ-ONLY and `js/` production code; writes nothing. Self-contained (2026-08-09 —
 * it briefly depended on a session-scratch `hp-lib.mjs` and could not run on a clean checkout).
 * Run: `node pipeline/experiments/amp-cycle-reproduction.mjs`
 */
import { pathToFileURL } from 'node:url';
import * as path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const imp = rel => import(pathToFileURL(path.join(ROOT, rel)).href);

const { open } = await imp('pipeline/lib/market/archive.mjs');
const { archiveSeries } = await imp('pipeline/lib/market/archive-series.mjs');
const { windowStats } = await imp('js/windowread.mjs');
const { amplitudeRanges, cycleCompletion, ampWalkForward, AMP_WF_WARMUP_DAYS, AMP_WF_FIT_DAYS, AMP_WF_MIN_HOURS } = await imp('js/amplitudescreen.mjs');

const ITEMS = [
  { id: 27641, name: 'Saturated heart' },
  { id: 6585,  name: 'Amulet of fury' },
  { id: 26241, name: 'Virtus armour set' },
  { id: 27232, name: 'Masori chaps' },
];

// LOCAL day bucketing — matches windowStats' dayKey and ampWalkForward's midnightOf.
const dayKeyOf = ts => { const d = new Date(ts * 1000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const midnightTs = key => { const [y, m, d] = key.split('-').map(Number); return Math.floor(new Date(y, m - 1, d).getTime() / 1000); };
function indexDays(series) {
  const days = new Map();
  for (const p of series) {
    const key = dayKeyOf(p.timestamp);
    let e = days.get(key);
    if (!e) { e = { hours: new Map(), nLow: 0, nHi: 0 }; days.set(key, e); }
    e.hours.set(new Date(p.timestamp * 1000).getHours(), { low: p.avgLowPrice, high: p.avgHighPrice });
    if (p.avgLowPrice != null) e.nLow++;
    if (p.avgHighPrice != null) e.nHi++;
  }
  return days;
}

// READONLY IS NON-NEGOTIABLE — a plain open() runs schema DDL against the multi-GB live DB.
const h = open(undefined, { readonly: true });
const pct = v => v == null ? '—' : (100 * v).toFixed(1) + '%';

console.log('item                | IN-SAMPLE (day grain) | STUDY (reimplemented)    | SHIPPED ampWalkForward');
console.log('                    | completion ≤4d        | ≤24h    ≤96h    n        | ≤96h (completed/judged)');
for (const it of ITEMS) {
  const series = archiveSeries(h, it.id, '1h', { days: 90 });
  if (series.length < 24 * 20) { console.log(`${it.name}: too little archive (${series.length} pts)`); continue; }

  // ---- MINE: levels from the SAME 14-day window that is then scored (the circularity) ----
  const recent = series.slice(-24 * 14);
  const st = windowStats(recent, { nights: 14, wStart: 0, wEnd: 0 });
  const ar = (st && amplitudeRanges(st, null, { holdDays: 4 })) || null;
  const mine = (ar && ar.hasData) ? cycleCompletion(st.days, { bid: ar.ampBid, ask: ar.ampAsk, horizonDays: 4 }) : null;

  // ---- STUDY: levels fitted strictly PRE-T, entry+completion at hour grain ----
  const days = indexDays(series);
  const dayKeys = [...days.keys()].sort();
  let origins = 0, entries = 0, d24 = 0, d96 = 0;
  for (let di = 15; di < dayKeys.length; di++) {
    const T = dayKeys[di], eT = days.get(T);
    if (!eT || eT.nLow < 12 || eT.nHi < 12) continue;
    const cut = midnightTs(T);
    const fitPts = series.filter(p => p.timestamp < cut && p.timestamp >= cut - 20 * 86400);
    const stats = windowStats(fitPts, { nights: 14, wStart: 0, wEnd: 0, now: new Date(cut * 1000) });
    if (!stats) continue;
    const a2 = amplitudeRanges(stats, null, { holdDays: 1 });
    if (!a2 || !a2.hasData || a2.ampBid == null || a2.ampAsk == null) continue;
    origins++;
    let entryH = null;
    for (let hh = 0; hh < 24; hh++) { const v = eT.hours.get(hh); if (v && v.low != null && v.low <= a2.ampBid) { entryH = hh; break; } }
    if (entryH == null) continue;
    entries++;
    const eTs = cut + entryH * 3600;
    const reach = hours => {
      for (const p of series) {
        if (p.timestamp <= eTs) continue;
        if (p.timestamp > eTs + hours * 3600) break;
        if (p.avgHighPrice != null && p.avgHighPrice >= a2.ampAsk) return true;
      }
      return false;
    };
    if (reach(24)) d24++;
    if (reach(96)) d96++;
  }
  // ---- SHIPPED: the PRODUCTION estimator itself. Without this column the harness would validate the
  // study's DESIGN but never touch `ampWalkForward`, so a regression INSIDE it — dropping the
  // `p.timestamp < cut` pre-origin filter, say — would not move a single number here. Now it does.
  const wf = ampWalkForward(series, { horizonDays: 4 });
  const mineTxt = mine && mine.frac != null ? `${mine.completed}/${mine.judged} = ${pct(mine.frac)}` : '—';
  const wfTxt = wf && wf.frac != null ? `${pct(wf.frac)} (${wf.completed}/${wf.judged})` : '—';
  console.log(`${it.name.padEnd(19)} | ${mineTxt.padEnd(21)} | ${pct(entries ? d24 / entries : null).padEnd(7)} ${pct(entries ? d96 / entries : null).padEnd(7)} ${String(entries).padEnd(8)} | ${wfTxt}`);
}
console.log(`\nwalk-forward params: warmup ${AMP_WF_WARMUP_DAYS}d · fit ${AMP_WF_FIT_DAYS}d · min ${AMP_WF_MIN_HOURS} logged hrs/day`);
console.log('EXPECT column 1 (in-sample) ~100% and columns 2-3 far lower.');
console.log('Columns 2 and 3 are INDEPENDENT implementations of the same design and should broadly agree');
console.log('(they differ by construction: col 2 has no PENDING exclusion and a fixed 90d read).');
console.log('NOTE both columns read 90d here; a live scan reads a wider window at the row\'s own quantiles, so');
console.log('its `judged` counts differ from these. Compare RATES, not sample sizes, against the board.');
console.log('  col 1 converging on col 3  ⇒ the pre-origin fit has broken somewhere shared (amplitudeRanges/windowStats).');
console.log('  col 3 diverging from col 2 ⇒ a regression INSIDE ampWalkForward itself.');
console.log('The unit-level guard on the same property is the downtrend fixture in pipeline/test/amplitudescreen.test.mjs.');
h.close?.();
