#!/usr/bin/env node
/**
 * nightlows.mjs — historical overnight-dip read for /overnight bid pricing.
 *
 * The 2026-07-04 zero-fill night showed that a bid at the *evening* 2h-band floor answers
 * the wrong question: the floor is an extreme evening print, and whether an unattended bid
 * fills overnight depends on how deep the QUIET HOURS actually dip. This script measures
 * that directly from the /timeseries 1h endpoint (~15 days of history): for each of the
 * last N local nights, the lowest traded avgLow inside the sleep window and the instasell
 * volume that crossed down during it, then the bid levels that would have been touched on
 * ≥50% / ≥75% / all of those nights.
 *
 * "Touched" = some volume traded at/below that price in at least one window hour. It is
 * NOT "filled a 25k-unit limit" — pair the touch level with the overnight instasell
 * volume line (that volume is the pool a resting buy competes for). Honesty rule
 * (process rule 4): ~14 nights is a small sample; treat the levels as a guide, not a
 * guarantee.
 *
 * Usage:
 *   node pipeline/nightlows.mjs "Soul rune" "Death rune"
 *   node pipeline/nightlows.mjs 566 --nights 10 --window 0-8 --bid 371
 *
 * Flags:
 *   --nights <n>   how many recent local nights to score (default 14, capped by history)
 *   --window <a-b> local wall-clock sleep window, hours 0-23 (default 0-8; may cross
 *                  midnight, e.g. 23-7 — the night is keyed to the morning it ends on)
 *   --bid <gp>     also score a specific candidate bid ("touched k/N nights")
 */
import { loadMapping, fetchTs, fetchLatest } from './marketfetch.mjs';
import { parseArgs, parseGp } from './cli.mjs';

const argv = process.argv.slice(2);
const A = parseArgs(argv);
// positionals: tokens that aren't --flags and aren't a flag's value (mirror parseArgs's walk)
const positionals = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) { const v = argv[i + 1]; if (v !== undefined && !v.startsWith('--')) i++; continue; }
  positionals.push(a);
}
if (!positionals.length) { console.error('usage: node pipeline/nightlows.mjs "<item or id>" [...more] [--nights 14] [--window 0-8] [--bid <gp>]'); process.exit(1); }

const NIGHTS = Math.max(1, parseInt(A.nights, 10) || 14);
const wm = String(A.window || '0-8').match(/^(\d{1,2})-(\d{1,2})$/);
if (!wm) { console.error('error: --window expects local hours like 0-8 or 23-7'); process.exit(1); }
const [W_START, W_END] = [parseInt(wm[1], 10), parseInt(wm[2], 10)];
if (W_START > 23 || W_END > 23 || W_START === W_END) { console.error('error: --window hours must be 0-23 and distinct'); process.exit(1); }
const BID = A.bid !== undefined ? parseGp(A.bid) : null;
if (A.bid !== undefined && !Number.isFinite(BID)) { console.error('error: --bid is not a parseable gp amount'); process.exit(1); }

const fmt = n => n == null ? '—' : n.toLocaleString('en-US');
const pad2 = n => String(n).padStart(2, '0');
// night key = local date of the morning the window ends on
function nightKey(d) {
  const key = new Date(d);
  if (W_START > W_END && d.getHours() >= W_START) key.setDate(key.getDate() + 1); // pre-midnight hours belong to tomorrow's morning
  return `${key.getFullYear()}-${pad2(key.getMonth() + 1)}-${pad2(key.getDate())}`;
}
const inWindow = h => W_START < W_END ? (h >= W_START && h < W_END) : (h >= W_START || h < W_END);
// bid touched on ≥p of nights ⇔ bid ≥ the p-quantile of nightly lows (ascending)
const quant = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];

const map = await loadMapping();
for (const want of positionals) {
  const r = map.resolve(want);
  if (!r) { console.log(`\n"${want}": not found in the item mapping — check spelling or pass an id.`); continue; }
  const [series, latest] = await Promise.all([fetchTs(r.id, '1h'), fetchLatest(r.id)]);

  // bucket window-hours by night, newest-complete nights only (skip tonight if we're inside the window)
  const nights = new Map(); // key -> {low, vol}
  const now = new Date();
  const tonight = inWindow(now.getHours()) ? nightKey(now) : null;
  for (const pt of series) {
    const d = new Date(pt.timestamp * 1000);
    if (!inWindow(d.getHours())) continue;
    const key = nightKey(d);
    if (key === tonight) continue;
    const n = nights.get(key) || { low: null, vol: 0 };
    if (pt.avgLowPrice != null && (n.low == null || pt.avgLowPrice < n.low)) n.low = pt.avgLowPrice;
    n.vol += pt.lowPriceVolume || 0;
    nights.set(key, n);
  }
  const scored = [...nights.entries()].filter(([, n]) => n.low != null)
    .sort((a, b) => b[0].localeCompare(a[0])).slice(0, NIGHTS).reverse();

  const winLabel = `${pad2(W_START)}:00–${pad2(W_END)}:00 local`;
  console.log(`\n## ${r.name} — overnight lows, last ${scored.length} night(s) (${winLabel}, 1h series)`);
  if (!scored.length) { console.log('no traded window-hours in the available history — too thin to read overnight.'); continue; }
  for (const [key, n] of scored) console.log(`  ${key}  low ${fmt(n.low)}  · instasell vol ${fmt(n.vol)}`);

  const lows = scored.map(([, n]) => n.low).sort((a, b) => a - b);
  const vols = scored.map(([, n]) => n.vol).sort((a, b) => a - b);
  const medVol = vols[Math.floor(vols.length / 2)];
  console.log(`  ---`);
  console.log(`  bid to be touched on ~50% of nights: ${fmt(quant(lows, 0.5))} · ~75%: ${fmt(quant(lows, 0.75))} · every night: ${fmt(lows[lows.length - 1])}`);
  console.log(`  median overnight instasell volume: ${fmt(medVol)} u (the pool a resting bid competes for)`);
  if (latest && latest.low != null) console.log(`  live instasell now: ${fmt(latest.low)}`);
  if (BID != null) {
    const k = lows.filter(l => l <= BID).length;
    console.log(`  --bid ${fmt(BID)} → would have been touched on ${k}/${scored.length} night(s)`);
  }
  console.log(`  (touched ≠ limit filled — small sample, ~${scored.length} nights; a guide, not a guarantee)`);
}
