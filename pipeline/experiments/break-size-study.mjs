#!/usr/bin/env node
/* break-size-study.mjs — does the SIZE of a 2h breakdown predict a further drop? (GN-0)
 *
 *   node pipeline/experiments/break-size-study.mjs [--items 400] [--json]      read-only, no network
 *
 * RESULT 2026-11-24: registered verdict NULL. Read it with two defects found in review: the raw loss mean is too heavy-tailed
 *   to pass at any realistic effect (one item printed 7 -> 699), and "first break wins" drops controls that later break
 *   (look-ahead, which inflates excess). Re-run by the reviewer with losses clipped to 10%, with and without causal controls:
 *   the 7 of 15 cutoffs tried still fail (b), and excess does not rise with size. Do not quote price-class splits from this
 *   script: the >=100k continuation vanished with causal controls, top-5 removal or 3-day-matched controls.
 *
 * PRE-REGISTERED (committed before the first run)
 * Decision: may `mom` ignore breaks under a size cutoff, and on which scale.
 * Origin: hourly. Signal low L = avgLow of the last completed 5m bucket with a low, <= 10 min old. Band = the 24 five-minute
 *   slots before it, at least 20 archived and 12 with a low. BREAK: L < min(band lows). NEAR-FLOOR CONTROL: no break and
 *   L within the bottom 10% of the band. Loss = (entry - exit) / entry on the instabuy side, the price a CUT sells at:
 *   entry = mean avgHigh of the 3 slots AFTER the signal bucket (so the signal print cannot bounce into it), exit = 1h avgHigh
 *   of [t+h-1, t+h). Missing either = excluded. One origin per item per 4h (first break wins, else first control).
 * Excess = loss - that item's near-floor control mean (items with < 20 controls drop). CI: 95%, bootstrap over DATES.
 * Primary horizon 4h; 1h and 24h are sensitivity. Scales: pct (overshoot/floor), band (overshoot/2h band height),
 *   swing (overshoot/IQR of 14d hourly mids, the GN-0 scale). Cutoff grid per scale below.
 * PASS for a cutoff c on a scale, required in BOTH halves (dates split in two, chosen on the first, confirmed on the second):
 *   (a) breaks below c: excess CI upper bound < 0.25%; (b) breaks at or above c: excess CI lower bound > 0;
 *   (c) at least 200 breaks on each side per half. The largest passing c wins, by the scale with most breaks below it.
 * NULL: nothing passes -> `mom` stays as it is, the gn0-held branch is deleted, the result goes to BACKLOG Measured.
 * If (b) fails everywhere because breaks of EVERY size carry no excess, that is reported as its own finding, not acted on.
 * Limits: L is a 5m average, not the live print the tool uses, so sizes are smaller than live ones; entry is a touch. */
import { open } from '../lib/market/archive.mjs';
import { readSuggestionLines } from '../lib/render/suggestlog.mjs';
import { parseArgs } from '../lib/render/cli.mjs';

const A = parseArgs(process.argv.slice(2));
const N_ITEMS = +(A.items || 400), SEED = 20261124, ITERS = 2000;
export const GRID = { pct: [0.001, 0.0025, 0.005, 0.01, 0.02], band: [0.05, 0.1, 0.25, 0.5, 1], swing: [0.02, 0.05, 0.1, 0.25, 0.5] };
const HORIZONS = [1, 4, 24];

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const quant = (s, q) => s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1) + 0.5)))];

const arch = open(undefined, { readonly: true });
const bucket5 = new Set(arch.db.prepare("SELECT ts FROM buckets WHERE grain='5m'").all().map(r => r.ts));
const q = arch.db.prepare('SELECT ts, avgHighPrice hi, avgLowPrice lo, highPriceVolume hv, lowPriceVolume lv FROM observations INDEXED BY obs_item WHERE grain=? AND itemId=? ORDER BY ts');

const ids = [...new Set(readSuggestionLines().map(l => { try { return typeof l === 'string' ? JSON.parse(l).itemId : l.itemId; } catch { return null; } }).filter(Number.isFinite))].sort((a, b) => a - b);
const r0 = rng(SEED);
for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(r0() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
const sample = ids.slice(0, N_ITEMS);
const stats = { universe: ids.length, items: 0, origins: 0, breaks: 0, controls: 0, noOutcome: 0 };
const breaks = [];

for (const id of sample) {
  const m5 = new Map(q.all('5m', id).map(r => [r.ts, r])); if (m5.size < 500) continue;
  const h1 = q.all('1h', id); const mh = new Map(h1.map(r => [r.ts, r]));
  const mids = h1.filter(r => r.hi && r.lo).map(r => [r.ts, (r.hi + r.lo) / 2]);
  const t0 = Math.ceil(Math.min(...m5.keys()) / 3600) * 3600, t1 = Math.max(...m5.keys());
  const rows = []; let blockKey = null, blockRow = null, lo0 = 0, hi0 = 0;
  for (let t = t0; t <= t1; t += 3600) {
    let s = null; for (const back of [300, 600]) { const r = m5.get(t - back); if (r && r.lo) { s = t - back; break; } }
    if (s == null) continue;
    let arch24 = 0; const lows = [], highs = [];
    for (let k = 1; k <= 24; k++) { const b = s - k * 300; if (bucket5.has(b)) arch24++; const r = m5.get(b); if (r && r.lo) lows.push(r.lo); if (r && r.hi) highs.push(r.hi); }
    if (arch24 < 20 || lows.length < 12 || !highs.length) continue;
    const L = m5.get(s).lo, floor = Math.min(...lows), top = Math.max(...highs), height = top - floor;
    if (height <= 0) continue;
    stats.origins++;
    const isBreak = L < floor, isCtl = !isBreak && (L - floor) <= 0.1 * height;
    if (!isBreak && !isCtl) continue;
    const ent = [1, 2, 3].map(k => m5.get(s + k * 300)?.hi).filter(Boolean); if (!ent.length) { stats.noOutcome++; continue; }
    const entry = mean(ent), loss = {};
    for (const h of HORIZONS) { const x = mh.get(t + (h - 1) * 3600)?.hi; loss[h] = x ? (entry - x) / entry : null; }
    if (loss[4] == null) { stats.noOutcome++; continue; }
    while (hi0 < mids.length && mids[hi0][0] < t - 3600) hi0++;
    while (lo0 < hi0 && mids[lo0][0] < t - 14 * 86400) lo0++;
    const win = mids.slice(lo0, hi0).map(x => x[1]).sort((a, b) => a - b);
    const iqr = win.length >= 48 ? quant(win, 0.75) - quant(win, 0.25) : null;
    const over = floor - L;
    const row = { id, t, date: new Date(t * 1000).toISOString().slice(0, 10), isBreak, loss, price: entry, gp: over, pct: over / floor, band: over / height, swing: iqr > 0 ? over / iqr : null };
    const key = Math.floor(t / 14400);
    if (key !== blockKey) { blockKey = key; blockRow = row; rows.push(row); }
    else if (row.isBreak && !blockRow.isBreak) { rows[rows.length - 1] = row; blockRow = row; }
  }
  const ctl = rows.filter(r => !r.isBreak);
  if (ctl.length < 20) continue;
  stats.items++; stats.controls += ctl.length;
  const base = {}; for (const h of HORIZONS) base[h] = mean(ctl.map(r => r.loss[h]).filter(x => x != null));
  for (const r of rows) if (r.isBreak) { r.ex = {}; for (const h of HORIZONS) r.ex[h] = r.loss[h] == null ? null : r.loss[h] - base[h]; breaks.push(r); }
}
stats.breaks = breaks.length;

export function ci(rows, h) {
  const v = rows.filter(r => r.ex[h] != null); if (!v.length) return { n: 0 };
  const by = new Map(); for (const r of v) { const e = by.get(r.date) || [0, 0]; e[0] += r.ex[h]; e[1]++; by.set(r.date, e); }
  const d = [...by.values()], R = rng(SEED + h), out = [];
  for (let i = 0; i < ITERS; i++) { let s = 0, n = 0; for (let k = 0; k < d.length; k++) { const e = d[Math.floor(R() * d.length)]; s += e[0]; n += e[1]; } out.push(s / n); }
  out.sort((a, b) => a - b);
  return { n: v.length, mean: mean(v.map(r => r.ex[h])), lo: quant(out, 0.025), hi: quant(out, 0.975), drop1: mean(v.map(r => r.loss[h] >= 0.01 ? 1 : 0)) };
}

const dates = [...new Set(breaks.map(r => r.date))].sort(), mid = dates[Math.floor(dates.length / 2)];
const halves = [breaks.filter(r => r.date < mid), breaks.filter(r => r.date >= mid)];
const pc = x => x == null ? '—' : (x * 100).toFixed(2) + '%';
const show = c => c.n ? `n ${c.n} excess ${pc(c.mean)} [${pc(c.lo)}, ${pc(c.hi)}] P(drop≥1%) ${pc(c.drop1)}` : 'n 0';
const passes = [];
const lines = [];
for (const [scale, cuts] of Object.entries(GRID)) for (const c of cuts) {
  const cells = halves.map(hh => { const v = hh.filter(r => r[scale] != null); return { b: ci(v.filter(r => r[scale] < c), 4), a: ci(v.filter(r => r[scale] >= c), 4) }; });
  const pass = cells.every(x => x.b.n >= 200 && x.a.n >= 200 && x.b.hi < 0.0025 && x.a.lo > 0);
  if (pass) passes.push({ scale, c, below: cells[0].b.n + cells[1].b.n });
  lines.push(`${scale} ${c}${pass ? ' PASS' : ''}`, ...cells.flatMap((x, i) => [`   half ${i + 1} below: ${show(x.b)}`, `          above: ${show(x.a)}`]));
}
passes.sort((x, y) => y.below - x.below);
console.log(JSON.stringify(stats), 'dates', dates.length, 'split', mid);
for (const h of HORIZONS) console.log(`ALL breaks ${h}h: ${show(ci(breaks, h))}`);
console.log('controls P(drop≥1%) not shown: excess is already net of them\n' + lines.join('\n'));
console.log('\nsize deciles (pct scale, 4h):');
const s = breaks.slice().sort((a, b) => a.pct - b.pct);
for (let i = 0; i < 10; i++) { const v = s.slice(Math.floor(i * s.length / 10), Math.floor((i + 1) * s.length / 10)); console.log(`  ${pc(v[0]?.pct)}–${pc(v.at(-1)?.pct)}: ${show(ci(v, 4))}`); }
for (const [n, f] of [['1 gp breaks', r => r.gp <= 1], ['≥10m', r => r.price >= 1e7], ['<100k', r => r.price < 1e5]]) console.log(`${n} 4h: ${show(ci(breaks.filter(f), 4))}`);
console.log(passes.length ? `\nVERDICT: PASS — ${passes[0].scale} ${passes[0].c}` : '\nVERDICT: NULL — no cutoff passes');
