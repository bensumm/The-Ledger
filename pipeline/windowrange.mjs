#!/usr/bin/env node
/**
 * windowrange.mjs — historical time-of-day RANGE read (lows AND highs) for price placement.
 * (Renamed from nightlows.mjs 2026-07-05 when the high side was added — the tool outgrew
 * overnight-bid pricing and became the standing time-of-day context read required by
 * CLAUDE.md's market-analysis contract on every price recommendation.)
 *
 * The 2026-07-04 zero-fill night showed that a bid at the *evening* 2h-band floor answers
 * the wrong question, and the same day's bludgeon retro showed the mirror image on the
 * sell side (an ask above what the window actually prints is a stranded premium). This
 * script measures both directly from the /timeseries 1h endpoint (~15 days of history):
 * for each of the last N local days, the lowest traded avgLow AND highest traded avgHigh
 * inside the wall-clock window, with the instasell/instabuy volume that crossed during it,
 * then the bid levels touched on ≥50% / ≥75% / all of those days and the ask levels
 * reached on the same fractions.
 *
 * "Touched"/"reached" = some volume traded at-or-beyond that price in at least one window
 * hour. It is NOT "filled a 25k-unit limit" — pair the level with the window volume line
 * (that volume is the pool a resting offer competes for). Honesty rule (process rule 4):
 * ~14 days is a small sample; treat the levels as a guide, not a guarantee.
 *
 * Usage:
 *   node pipeline/windowrange.mjs "Soul rune" "Death rune"
 *   node pipeline/windowrange.mjs 566 --nights 10 --window 0-8 --bid 371 --ask 395
 *
 * Flags:
 *   --nights <n>   how many recent local days to score (default 14, capped by history)
 *   --window <a-b> local wall-clock window, hours 0-23 (default 0-8; may cross midnight,
 *                  e.g. 23-7 — the day is keyed to the morning the window ends on)
 *   --bid <gp>     score a specific candidate bid ("touched k/N days")
 *   --ask <gp>     score a specific candidate ask ("reached k/N days")
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
if (!positionals.length) { console.error('usage: node pipeline/windowrange.mjs "<item or id>" [...more] [--nights 14] [--window 0-8] [--bid <gp>] [--ask <gp>]'); process.exit(1); }

const NIGHTS = Math.max(1, parseInt(A.nights, 10) || 14);
const wm = String(A.window || '0-8').match(/^(\d{1,2})-(\d{1,2})$/);
if (!wm) { console.error('error: --window expects local hours like 0-8 or 23-7'); process.exit(1); }
const [W_START, W_END] = [parseInt(wm[1], 10), parseInt(wm[2], 10)];
if (W_START > 23 || W_END > 23 || W_START === W_END) { console.error('error: --window hours must be 0-23 and distinct'); process.exit(1); }
const BID = A.bid !== undefined ? parseGp(A.bid) : null;
if (A.bid !== undefined && !Number.isFinite(BID)) { console.error('error: --bid is not a parseable gp amount'); process.exit(1); }
const ASK = A.ask !== undefined ? parseGp(A.ask) : null;
if (A.ask !== undefined && !Number.isFinite(ASK)) { console.error('error: --ask is not a parseable gp amount'); process.exit(1); }

const fmt = n => n == null ? '—' : n.toLocaleString('en-US');
const pad2 = n => String(n).padStart(2, '0');
// night key = local date of the morning the window ends on
function nightKey(d) {
  const key = new Date(d);
  if (W_START > W_END && d.getHours() >= W_START) key.setDate(key.getDate() + 1); // pre-midnight hours belong to tomorrow's morning
  return `${key.getFullYear()}-${pad2(key.getMonth() + 1)}-${pad2(key.getDate())}`;
}
const inWindow = h => W_START < W_END ? (h >= W_START && h < W_END) : (h >= W_START || h < W_END);
// bid touched on ≥p of days ⇔ bid ≥ the p-quantile of window lows (ascending)
const quant = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
// ask reached on ≥p of days ⇔ ask ≤ the (1−p)-quantile of window highs (ascending): p of the
// highs sit at/above that level (mirror of quant; p=1 → the minimum high = reached every day)
const quantHi = (sorted, p) => sorted[Math.max(0, Math.min(sorted.length - 1, sorted.length - Math.ceil(p * sorted.length)))];

const map = await loadMapping();
for (const want of positionals) {
  const r = map.resolve(want);
  if (!r) { console.log(`\n"${want}": not found in the item mapping — check spelling or pass an id.`); continue; }
  const [series, latest] = await Promise.all([fetchTs(r.id, '1h'), fetchLatest(r.id)]);

  // bucket window-hours by day, newest-complete days only (skip today if we're inside the window)
  const days = new Map(); // key -> {low, hi, volLo, volHi}
  const now = new Date();
  const today = inWindow(now.getHours()) ? nightKey(now) : null;
  for (const pt of series) {
    const d = new Date(pt.timestamp * 1000);
    if (!inWindow(d.getHours())) continue;
    const key = nightKey(d);
    if (key === today) continue;
    const n = days.get(key) || { low: null, hi: null, volLo: 0, volHi: 0 };
    if (pt.avgLowPrice != null && (n.low == null || pt.avgLowPrice < n.low)) n.low = pt.avgLowPrice;
    if (pt.avgHighPrice != null && (n.hi == null || pt.avgHighPrice > n.hi)) n.hi = pt.avgHighPrice;
    n.volLo += pt.lowPriceVolume || 0;
    n.volHi += pt.highPriceVolume || 0;
    days.set(key, n);
  }
  const scored = [...days.entries()].filter(([, n]) => n.low != null || n.hi != null)
    .sort((a, b) => b[0].localeCompare(a[0])).slice(0, NIGHTS).reverse();

  const winLabel = `${pad2(W_START)}:00–${pad2(W_END)}:00 local`;
  console.log(`\n## ${r.name} — window range, last ${scored.length} day(s) (${winLabel}, 1h series)`);
  if (!scored.length) { console.log('no traded window-hours in the available history — too thin to read this window.'); continue; }
  for (const [key, n] of scored)
    console.log(`  ${key}  low ${fmt(n.low)} · high ${fmt(n.hi)}  · sell-vol ${fmt(n.volLo)} · buy-vol ${fmt(n.volHi)}`);

  const lows = scored.map(([, n]) => n.low).filter(v => v != null).sort((a, b) => a - b);
  const his  = scored.map(([, n]) => n.hi).filter(v => v != null).sort((a, b) => a - b);
  const medOf = arr => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const medVolLo = medOf(scored.map(([, n]) => n.volLo));
  const medVolHi = medOf(scored.map(([, n]) => n.volHi));
  console.log(`  ---`);
  if (lows.length) {
    console.log(`  BID side — touched on ~50% of days: ${fmt(quant(lows, 0.5))} · ~75%: ${fmt(quant(lows, 0.75))} · every day: ${fmt(lows[lows.length - 1])}`);
    console.log(`    median window instasell volume: ${fmt(medVolLo)} u (the pool a resting bid competes for)`);
  }
  if (his.length) {
    console.log(`  ASK side — reached on ~50% of days: ${fmt(quantHi(his, 0.5))} · ~75%: ${fmt(quantHi(his, 0.75))} · every day: ${fmt(his[0])}`);
    console.log(`    median window instabuy volume: ${fmt(medVolHi)} u (the pool a resting ask competes for)`);
  }
  if (latest && latest.low != null) console.log(`  live instasell now: ${fmt(latest.low)}${latest.high != null ? ` · live instabuy now: ${fmt(latest.high)}` : ''}`);
  if (BID != null && lows.length) {
    const k = lows.filter(l => l <= BID).length;
    console.log(`  --bid ${fmt(BID)} → would have been touched on ${k}/${lows.length} day(s)`);
  }
  if (ASK != null && his.length) {
    const k = his.filter(h => h >= ASK).length;
    console.log(`  --ask ${fmt(ASK)} → would have been reached on ${k}/${his.length} day(s)`);
  }
  console.log(`  (touched/reached ≠ limit filled — small sample, ~${scored.length} days; a guide, not a guarantee)`);
}
