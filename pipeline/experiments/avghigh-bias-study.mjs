#!/usr/bin/env node
/* avghigh-bias-study.mjs — PLAN-AVGHIGH-BIAS registered instrument (committed before its
 * first run). Joins positions.json closed[] realized sells to the 1h archive and measures
 * whether avgHighPrice understates what the market actually paid. Read-only; numbers live
 * in the plan, do not cite this output as a result elsewhere.
 *
 * Registered pieces (bars fixed in the plan, restated here so the code can fire them):
 *  (a) validity gate: qty==1 sells in hpv==1 hours must match avgHighPrice within 0.1%;
 *      match rate <70% on n>=10 → branch (C). avgLowPrice match reported too.
 *  (b) same-hour exceedance descriptives per hpv tier (1-3, 4-10, 11-30, >30) and class.
 *  (c) branch decider: sells beating the LOCAL day's max hourly avgHighPrice by >=1%;
 *      branch (A) iff some tier with n>=20 (either era) has rate >=15%.
 *  Era split: last 30d (vs the record's latest sellTs) vs earlier. Per-item-first for
 *  items with >=5 joined sells. Deterministic offline join — a rerun reproduces exactly,
 *  so instrument confidence rests on (a), not a confirming rerun.
 * Known blur, stated: qty>1 lots average their sell fills into sellEach and stamp the
 * final fill's ts; classifyItem's eraMid is proxied by the joined day's mean mid.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from '../lib/market/archive.mjs';
import { classifyItem } from '../lib/signal/dislocation.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const positions = JSON.parse(fs.readFileSync(path.join(ROOT, 'positions.json'), 'utf8'));
const mapping = JSON.parse(fs.readFileSync(path.join(ROOT, 'pipeline', '.cache', 'mapping.cache.json'), 'utf8'));
const archive = open(path.join(ROOT, 'pipeline', '.market-archive.sqlite'), { readonly: true });

const sells = (positions.closed || []).filter(r => !r.banked && r.sellTs > 0 && r.sellEach > 0);
const lastTs = Math.max(...sells.map(r => r.sellTs));
const ERA_CUT = lastTs - 30 * 86400;

const tierOf = hpv => hpv == null ? null : hpv <= 3 ? '1-3' : hpv <= 10 ? '4-10' : hpv <= 30 ? '11-30' : '>30';
const TIERS = ['1-3', '4-10', '11-30', '>30'];
const median = a => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const pct = (x, ref) => (x - ref) / ref * 100;

const joined = [];
let noSeries = 0, noHourRow = 0, noHighInHour = 0;
for (const r of sells) {
  const hourTs = Math.floor(r.sellTs / 3600) * 3600;
  const d = new Date(r.sellTs * 1000);
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000;
  const rows = archive.seriesFor(r.itemId, '1h', { from: dayStart - 3600, to: dayStart + 86400 - 1 });
  if (!rows.length) { noSeries++; continue; }
  const hour = rows.find(x => x.ts === hourTs) || null;
  const prev = rows.find(x => x.ts === hourTs - 3600) || null;
  if (!hour) { noHourRow++; continue; }
  if (hour.avgHighPrice == null) { noHighInHour++; continue; }
  const dayRows = rows.filter(x => x.ts >= dayStart && x.avgHighPrice != null);
  const dayMax = dayRows.length ? Math.max(...dayRows.map(x => x.avgHighPrice)) : null;
  const mids = dayRows.filter(x => x.avgLowPrice != null).map(x => (x.avgHighPrice + x.avgLowPrice) / 2);
  const eraMid = mids.length ? mids.reduce((s, x) => s + x, 0) / mids.length : hour.avgHighPrice;
  const info = mapping[r.itemId] || {};
  joined.push({
    itemId: r.itemId, name: info.name || `#${r.itemId}`, qty: r.qty, sellEach: r.sellEach,
    recent: r.sellTs >= ERA_CUT, hpv: hour.highPriceVolume, tier: tierOf(hour.highPriceVolume),
    cls: classifyItem({ name: info.name, limit: info.limit ?? null, eraMid }),
    hourHigh: hour.avgHighPrice, hourLow: hour.avgLowPrice,
    prevHigh: prev ? prev.avgHighPrice : null, dayMax,
  });
}

console.log(`PLAN-AVGHIGH-BIAS study — ${sells.length} non-banked sells, ${joined.length} joined`
  + ` (no series ${noSeries}, no hour bucket ${noHourRow}, hour has no high-side print ${noHighInHour})`);
console.log(`era cut: last-30d = sellTs >= ${ERA_CUT} (${new Date(ERA_CUT * 1000).toLocaleDateString()})`);

// (a) validity gate
const aRows = joined.filter(j => j.qty === 1 && j.hpv === 1);
const near = (x, ref) => ref != null && Math.abs(x - ref) / x <= 0.001;
const aHigh = aRows.filter(j => near(j.sellEach, j.hourHigh)).length;
const aLow = aRows.filter(j => near(j.sellEach, j.hourLow)).length;
const aRate = aRows.length ? aHigh / aRows.length : null;
console.log(`\n(a) validity: n=${aRows.length} qty==1 sells in hpv==1 hours; sellEach==avgHighPrice(0.1%):`
  + ` ${aHigh} (${aRows.length ? (100 * aRate).toFixed(0) : '-'}%); ==avgLowPrice: ${aLow}`);
const aFails = aRows.length >= 10 && aRate < 0.70;
for (const j of aRows.filter(j => !near(j.sellEach, j.hourHigh)))
  console.log(`    mismatch: ${j.name} sold ${j.sellEach} vs hourHigh ${j.hourHigh} (prev ${j.prevHigh ?? '-'})${near(j.sellEach, j.prevHigh) ? ' — matches PREV hour' : ''}`);

// (b) + (c) per tier x era
const line = (tag, rows, exceedOf) => {
  const ex = rows.filter(exceedOf.test);
  const mag = median(ex.map(exceedOf.mag));
  return `  ${tag.padEnd(14)} n=${String(rows.length).padStart(3)}  exceed ${rows.length ? (100 * ex.length / rows.length).toFixed(0).padStart(3) : '  -'}%`
    + `  med-mag ${mag == null ? '-' : mag.toFixed(2) + '%'}`;
};
const bTest = { test: j => j.sellEach > j.hourHigh, mag: j => pct(j.sellEach, j.hourHigh) };
const cTest = { test: j => j.dayMax != null && j.sellEach > j.dayMax * 1.01, mag: j => pct(j.sellEach, j.dayMax) };
for (const [label, t] of [['(b) same-hour', bTest], ['(c) day-max +1%', cTest]]) {
  console.log(`\n${label} exceedance by hpv tier x era:`);
  for (const era of [['recent-30d', j => j.recent], ['earlier', j => !j.recent]]) {
    for (const tier of TIERS) {
      const rows = joined.filter(j => j.tier === tier && era[1](j));
      if (rows.length) console.log(line(`${era[0]} ${tier}`, rows, t));
    }
  }
}

// (b) by class, pooled (descriptive only)
console.log('\n(b) same-hour exceedance by class (pooled, descriptive):');
for (const cls of [...new Set(joined.map(j => j.cls))].sort()) {
  const rows = joined.filter(j => j.cls === cls);
  if (rows.length >= 10) console.log(line(cls, rows, bTest));
}

// per-item-first (c)
const byItem = new Map();
for (const j of joined) { if (!byItem.has(j.itemId)) byItem.set(j.itemId, []); byItem.get(j.itemId).push(j); }
const itemRates = [...byItem.entries()].filter(([, v]) => v.length >= 5)
  .map(([id, v]) => ({ name: v[0].name, n: v.length, rate: v.filter(cTest.test).length / v.length }));
console.log(`\n(c) per-item (items with >=5 joined sells): ${itemRates.length} items,`
  + ` mean rate ${(100 * (itemRates.reduce((s, x) => s + x.rate, 0) / (itemRates.length || 1))).toFixed(1)}%,`
  + ` items with any day-max beat: ${itemRates.filter(x => x.rate > 0).length}`);
for (const x of itemRates.filter(x => x.rate > 0).sort((a, b) => b.rate - a.rate))
  console.log(`    ${x.name}: ${(100 * x.rate).toFixed(0)}% of ${x.n}`);

// sensitivity: same-hour exceedance vs best of {containing, previous} hour
const sens = joined.filter(j => j.sellEach > Math.max(j.hourHigh, j.prevHigh ?? -Infinity));
console.log(`\nsensitivity (b vs best of containing/prev hour): ${sens.length}/${joined.length} still exceed`
  + ` (was ${joined.filter(bTest.test).length})`);

// verdict per the registered bars
let fired = null;
if (aFails) fired = '(C) instrument fails (a)';
else {
  for (const era of [j => j.recent, j => !j.recent]) for (const tier of TIERS) {
    const rows = joined.filter(j => j.tier === tier && era(j));
    if (rows.length >= 20 && rows.filter(cTest.test).length / rows.length >= 0.15) fired = '(A) material';
  }
  if (!fired) fired = '(B) not material';
}
console.log(`\nVERDICT (registered bars): branch ${fired}`);
