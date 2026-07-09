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
import { loadMapping, fetchTs, fetchLatest } from './lib/marketfetch.mjs';
import { parseArgs, parseGp } from './lib/cli.mjs';
import { windowStats, quantLow, quantHigh, touchedDays, reachedDays, recencySplit, recentQuant, RECENT_NIGHTS, hourProfile, deriveDiurnalRange } from '../js/windowread.mjs';

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
// the bucketing/quantile math lives in windowread.mjs (shared with watch.mjs's window line)

const map = await loadMapping();
for (const want of positionals) {
  const r = map.resolve(want);
  if (!r) { console.log(`\n"${want}": not found in the item mapping — check spelling or pass an id.`); continue; }
  const [series, latest] = await Promise.all([fetchTs(r.id, '1h'), fetchLatest(r.id)]);

  // --profile: the hour-of-day diurnal read (peak-timing) — locates the daily dip/peak WINDOWS and
  // derives a stale-guarded bid/ask, instead of scoring one hand-picked --window. Same 1h series.
  if (A.profile !== undefined) {
    const prof = hourProfile(series, { nights: NIGHTS });
    console.log(`\n## ${r.name} — diurnal profile, last ${prof ? prof.nights : 0} day(s) (local hour-of-day, 1h series)`);
    if (!prof) { console.log('  too thin to profile — need ≥4 traded days of hourly history.'); continue; }
    const inDip = new Set(prof.dip.hours), inPeak = new Set(prof.peak.hours);
    for (const x of prof.hours) {
      const tag = inDip.has(x.h) ? ' ⬇dip' : inPeak.has(x.h) ? ' ⬆peak' : '';
      console.log(`  ${pad2(x.h)}:00  low ${fmt(x.lowRecent)} · high ${fmt(x.hiRecent)}  · n ${x.n}${tag}`);
    }
    const win = (w) => `${pad2(w.startH)}:00–${pad2(w.endH)}:00`;
    console.log(`  ---`);
    console.log(`  DIP window ${win(prof.dip)} — recent level ${fmt(prof.dip.level)}`);
    console.log(`  PEAK window ${win(prof.peak)} — recent level ${fmt(prof.peak.level)}`);
    console.log(`  intraday amplitude ~${fmt(prof.amplitude)}${prof.amplitudePct != null ? ` (${(prof.amplitudePct * 100).toFixed(1)}%)` : ''} · trend ${prof.trendPerDay == null ? '—' : (prof.trendPerDay >= 0 ? '+' : '') + fmt(Math.round(prof.trendPerDay)) + '/day'}${prof.trendDominates ? ' ⚠ trend-dominates' : ''}`);
    if (latest && latest.low != null) console.log(`  live instasell now: ${fmt(latest.low)}${latest.high != null ? ` · live instabuy now: ${fmt(latest.high)}` : ''}`);
    const dr = deriveDiurnalRange(prof, { liveLo: latest && latest.low != null ? latest.low : null, liveHi: latest && latest.high != null ? latest.high : null });
    if (dr) {
      console.log(`  → BID ${fmt(dr.bid)} (${dr.bidBasis}, ${win(dr.dipWindow)}) · ASK ${fmt(dr.ask)} (${win(dr.peakWindow)})`);
      for (const n of dr.notes) console.log(`    ⓘ ${n}`);
    }
    console.log(`  (hour-of-day medians, small sample — a guide, not a guarantee)`);
    continue;
  }

  const stats = windowStats(series, { nights: NIGHTS, wStart: W_START, wEnd: W_END });
  const winLabel = `${pad2(W_START)}:00–${pad2(W_END)}:00 local`;
  console.log(`\n## ${r.name} — window range, last ${stats ? stats.days.length : 0} day(s) (${winLabel}, 1h series)`);
  if (!stats) { console.log('no traded window-hours in the available history — too thin to read this window.'); continue; }
  const { days: scored, lows, his, medVolLo, medVolHi } = stats;
  for (const [key, n] of scored)
    console.log(`  ${key}  low ${fmt(n.low)} · high ${fmt(n.hi)}  · sell-vol ${fmt(n.volLo)} · buy-vol ${fmt(n.volHi)}`);

  console.log(`  ---`);
  const rq = (side, p) => { const v = recentQuant(scored, side, p, RECENT_NIGHTS); return v == null ? '' : ` · recent-${RECENT_NIGHTS} ~50%: ${fmt(v)}`; };
  if (lows.length) {
    console.log(`  BID side — touched on ~50% of days: ${fmt(quantLow(lows, 0.5))} · ~75%: ${fmt(quantLow(lows, 0.75))} · every day: ${fmt(lows[lows.length - 1])}${rq('bid', 0.5)}`);
    console.log(`    median window instasell volume: ${fmt(medVolLo)} u (the pool a resting bid competes for)`);
  }
  if (his.length) {
    console.log(`  ASK side — reached on ~50% of days: ${fmt(quantHigh(his, 0.5))} · ~75%: ${fmt(quantHigh(his, 0.75))} · every day: ${fmt(his[0])}${rq('ask', 0.5)}`);
    console.log(`    median window instabuy volume: ${fmt(medVolHi)} u (the pool a resting ask competes for)`);
  }
  if (latest && latest.low != null) console.log(`  live instasell now: ${fmt(latest.low)}${latest.high != null ? ` · live instabuy now: ${fmt(latest.high)}` : ''}`);
  // recency split on the scored candidate: recent-N hit rate beside the full count, ⚠ when the
  // full count is rosier than recent (stale-regime contamination — don't trust the full number)
  const splitNote = (side, level) => {
    const s = recencySplit(scored, side, level, RECENT_NIGHTS);
    let note = ` · recent ${s.recentHit}/${s.recentDays}`;
    if (s.staleOptimistic) note += ` ⚠ stale — the full count is concentrated in an older price regime; recent nights ${side === 'bid' ? "don't dip to this bid" : "don't reach this ask"}, discount it`;
    else if (s.diverges) note += ` (recent ${side === 'bid' ? 'dips lower/more often' : 'reaches higher/more often'} than the full window)`;
    return note;
  };
  if (BID != null && lows.length)
    console.log(`  --bid ${fmt(BID)} → would have been touched on ${touchedDays(lows, BID)}/${lows.length} day(s)${splitNote('bid', BID)}`);
  if (ASK != null && his.length)
    console.log(`  --ask ${fmt(ASK)} → would have been reached on ${reachedDays(his, ASK)}/${his.length} day(s)${splitNote('ask', ASK)}`);
  console.log(`  (touched/reached ≠ limit filled — small sample, ~${scored.length} days; a guide, not a guarantee)`);
}
