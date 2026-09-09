#!/usr/bin/env node
/* reverse-flip-window-study.mjs — PLAN-WEEKDAY-PHASE-CONFOUND §8(f), the registered
 * reverse-flip weekly-window costing (committed before its first run). Read-only.
 * Numbers live in the plan's §8 RESULTS; committed text carries BASKET AGGREGATES ONLY —
 * owned-items.json is deliberately held off the public repo, so per-item console lines
 * here must never be pasted into tracked files.
 *
 * The trade being costed is the real reverse-flip cycle ORDER: sell into the weekend peak
 * of week w (S = mean raw daily mid, Sat+Sun local), rebuy the FOLLOWING Tuesday
 * (T = raw Tue mid of week w+1). Net per cycle = (S - tax(S)) / T - 1, tax = the ONE
 * quotecore impl. Raw mids on purpose: a real rebuy pays the drift too. The WK-style
 * detrended weekend-Tue gap is reported beside it for comparability, decides nothing.
 * Bars, fixed here pre-run (the registration left them qualitative): branch (xi) fires
 * iff basket mean net >= +0.5%/cycle AND >= 70% of cycle-weeks positive; else (xii).
 * Inference: basket-level per cycle-week (mean across pool items), then across weeks —
 * mean, t, k/n weeks positive (weeks are the independent unit, the WK discipline).
 * Eligibility: pool = owned-items classification 'keep' ∪ hold-thesis reverseFlip:true,
 * needing >= 28 local days with >= 12 hourly mids. Empty pool exits cleanly (the public
 * repo's owned-items.json is an empty stub).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from '../lib/market/archive.mjs';
import { tax } from '../../js/quotecore.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = f => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { return null; } };

const oi = readJson('owned-items.json');
const ht = readJson('hold-thesis.json');
const keeps = (Array.isArray(oi) ? oi : (oi && oi.items) || []).filter(x => x.classification === 'keep');
const rf = (Array.isArray(ht) ? ht : (ht && (ht.items || ht.theses)) || []).filter(x => x.reverseFlip);
const poolIds = [...new Set([...keeps.map(x => x.id), ...rf.map(x => x.id ?? x.itemId)])].filter(Number.isFinite);
if (!poolIds.length) { console.log('no eligible reverse-flip pool (owned-items empty/stub, no reverseFlip theses)'); process.exit(0); }
const nameOf = new Map([...keeps, ...rf].map(x => [x.id ?? x.itemId, x.name]));

const archive = open(path.join(ROOT, 'pipeline', '.market-archive.sqlite'), { readonly: true });

// local daily mids: dayKey (local y-m-d) -> mean of hourly (high+low)/2, >=12 rows required
function dailyMids(itemId) {
  const rows = archive.seriesFor(itemId, '1h', {});
  const byDay = new Map();
  for (const r of rows) {
    if (r.avgHighPrice == null || r.avgLowPrice == null) continue;
    const d = new Date(r.ts * 1000);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!byDay.has(key)) byDay.set(key, { sum: 0, n: 0, dow: d.getDay(), ms: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() });
    const b = byDay.get(key); b.sum += (r.avgHighPrice + r.avgLowPrice) / 2; b.n++;
  }
  return [...byDay.values()].filter(b => b.n >= 12).sort((a, b) => a.ms - b.ms)
    .map(b => ({ mid: b.sum / b.n, dow: b.dow, ms: b.ms }));
}

// per item: cycles of (weekend-of-week-w -> following Tue). Also the detrended wkend-Tue gap.
const perItemCycles = new Map();   // ms of the cycle's Sat -> [{itemId, netPct, detrGapPp}]
let eligible = 0;
for (const id of poolIds) {
  const days = dailyMids(id);
  if (days.length < 28) { console.log(`  ${nameOf.get(id) || id}: only ${days.length} full days — excluded`); continue; }
  eligible++;
  const centered = days.map((d, i) => {
    const win = days.slice(Math.max(0, i - 3), i + 4);
    return win.length >= 5 ? d.mid / (win.reduce((s, x) => s + x.mid, 0) / win.length) - 1 : null;
  });
  for (let i = 0; i < days.length; i++) {
    if (days[i].dow !== 6) continue;                       // Saturday anchors the cycle
    const sun = days[i + 1] && days[i + 1].dow === 0 ? days[i + 1] : null;
    const S = sun ? (days[i].mid + sun.mid) / 2 : days[i].mid;
    const tue = days.slice(i + 1, i + 5).find(d => d.dow === 2);   // following Tuesday
    if (!tue) continue;
    const netPct = (S - tax(S)) / tue.mid * 100 - 100;
    const j = days.indexOf(tue);
    const detrGapPp = (centered[i] != null && centered[j] != null) ? (centered[i] - centered[j]) * 100 : null;
    if (!perItemCycles.has(days[i].ms)) perItemCycles.set(days[i].ms, []);
    perItemCycles.get(days[i].ms).push({ itemId: id, netPct, detrGapPp });
  }
}

const weeks = [...perItemCycles.entries()].sort((a, b) => a[0] - b[0])
  .map(([ms, arr]) => ({
    date: new Date(ms).toLocaleDateString(), n: arr.length,
    net: arr.reduce((s, x) => s + x.netPct, 0) / arr.length,
    detr: arr.filter(x => x.detrGapPp != null).length
      ? arr.filter(x => x.detrGapPp != null).reduce((s, x) => s + x.detrGapPp, 0) / arr.filter(x => x.detrGapPp != null).length : null,
  }));
console.log(`\npool ${poolIds.length} (keeps ${keeps.length}, reverseFlip theses ${rf.length}), eligible ${eligible}; cycle-weeks ${weeks.length}`);
console.log('per cycle-week basket means (sell Sat/Sun -> rebuy next Tue, net of tax):');
for (const w of weeks) console.log(`  wkend ${w.date}  n=${String(w.n).padStart(2)}  net ${w.net >= 0 ? '+' : ''}${w.net.toFixed(2)}%  detrGap ${w.detr == null ? '-' : (w.detr >= 0 ? '+' : '') + w.detr.toFixed(2) + 'pp'}`);

const nets = weeks.map(w => w.net);
const mean = nets.reduce((s, x) => s + x, 0) / nets.length;
const sd = Math.sqrt(nets.reduce((s, x) => s + (x - mean) ** 2, 0) / (nets.length - 1));
const t = mean / (sd / Math.sqrt(nets.length));
const pos = nets.filter(x => x > 0).length;
console.log(`\nbasket across ${weeks.length} cycle-weeks: mean net ${mean >= 0 ? '+' : ''}${mean.toFixed(2)}%/cycle, t=${t.toFixed(2)}, positive ${pos}/${weeks.length}`);
const fired = mean >= 0.5 && pos / weeks.length >= 0.70 ? '(xi) material and week-consistent' : '(xii) does not clear';
console.log(`VERDICT (bars in header): branch ${fired}`);
console.log('\nNOTE: committed text takes AGGREGATES ONLY — never paste per-item lines into tracked files.');
