#!/usr/bin/env node
/**
 * read-window-range.mjs — historical time-of-day RANGE read (lows AND highs) for price placement.
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
 *   node pipeline/commands/read-window-range.mjs "Soul rune" "Death rune"
 *   node pipeline/commands/read-window-range.mjs 566 --nights 10 --window 0-8 --bid 371 --ask 395
 *
 * Flags:
 *   --nights <n>   how many recent local days to score (default 14, capped by history)
 *   --window <a-b> local wall-clock window, hours 0-23 (default 0-8; may cross midnight,
 *                  e.g. 23-7 — the day is keyed to the morning the window ends on)
 *   --bid <gp>     score a specific candidate bid ("touched k/N days")
 *   --ask <gp>     score a specific candidate ask ("reached k/N days")
 *   --exit <gp>    back-solve the LARGEST profitable buy from an intended exit ask (#9, PLAN-WINDOW-CLEAR
 *                  B3 — maxBuyForExit, the tax-exact inverse of breakEven) + how reachable the exit is in
 *                  the window (a rarely-printed exit over-states the sell → the buy is optimistic)
 *   --margin <gp>  minimum after-tax net/u the back-solve must leave (default 0 = break-even-clearing)
 *   --depth <qty>  (PLAN-DEPTH-EXIT DE2) percentile-DEPTH read for a lot of <qty> units: the per-day
 *                  instabuy flow at/above the scored --ask, whether it clears qty×competition, and the
 *                  clearableAsk ("what can I actually book at?"). A thin book prints its COLLAPSE REASON,
 *                  never a bare null. Estimate from bucket AVERAGES, not an order book (inform-only, n≈0).
 */
import { loadMapping, fetchTs, fetchLatest } from '../lib/marketfetch.mjs';
import { parseArgs, parseGp } from '../lib/cli.mjs';
import { windowStats, quantLow, quantHigh, touchedDays, reachedDays, recencySplit, recentQuant, RECENT_NIGHTS, hourProfile, deriveDiurnalRange, depthDays, clearableAsk } from '../../js/windowread.mjs';   // DE2: --depth reads the percentile-depth model
import { maxBuyForExit, breakEven } from '../../js/quotecore.js';   // #9 (PLAN-WINDOW-CLEAR B3): --exit back-solves the max profitable buy from an intended exit ask

// #9: exit reached on < this fraction of the scored days ⇒ the exit OVER-states the reachable sell,
// so the back-solved buy is optimistic (the days-reach ≠ lap-clear caveat). PLACEHOLDER (n≈0).
const EXIT_REACH_MIN = 0.5;

const argv = process.argv.slice(2);
const A = parseArgs(argv);
// positionals: tokens that aren't --flags and aren't a flag's value (mirror parseArgs's walk)
const positionals = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) { const v = argv[i + 1]; if (v !== undefined && !v.startsWith('--')) i++; continue; }
  positionals.push(a);
}
if (!positionals.length) { console.error('usage: node pipeline/commands/read-window-range.mjs "<item or id>" [...more] [--nights 14] [--window 0-8] [--bid <gp>] [--ask <gp>] [--exit <ask> [--margin <gp>]] [--depth <qty>]'); process.exit(1); }

const NIGHTS = Math.max(1, parseInt(A.nights, 10) || 14);
const wm = String(A.window || '0-8').match(/^(\d{1,2})-(\d{1,2})$/);
if (!wm) { console.error('error: --window expects local hours like 0-8 or 23-7'); process.exit(1); }
const [W_START, W_END] = [parseInt(wm[1], 10), parseInt(wm[2], 10)];
if (W_START > 23 || W_END > 23 || W_START === W_END) { console.error('error: --window hours must be 0-23 and distinct'); process.exit(1); }
const BID = A.bid !== undefined ? parseGp(A.bid) : null;
if (A.bid !== undefined && !Number.isFinite(BID)) { console.error('error: --bid is not a parseable gp amount'); process.exit(1); }
const ASK = A.ask !== undefined ? parseGp(A.ask) : null;
if (A.ask !== undefined && !Number.isFinite(ASK)) { console.error('error: --ask is not a parseable gp amount'); process.exit(1); }
// #9 — --exit <ask> [--margin <gp>]: back-solve the LARGEST profitable buy from an intended exit.
const EXIT = A.exit !== undefined ? parseGp(A.exit) : null;
if (A.exit !== undefined && !Number.isFinite(EXIT)) { console.error('error: --exit is not a parseable gp amount'); process.exit(1); }
const MARGIN = A.margin !== undefined ? parseGp(A.margin) : 0;
if (A.margin !== undefined && !Number.isFinite(MARGIN)) { console.error('error: --margin is not a parseable gp amount'); process.exit(1); }
// DE2 — --depth <qty>: the percentile-depth read for a lot of <qty> units.
const DEPTH_QTY = A.depth !== undefined ? parseGp(A.depth) : null;
if (A.depth !== undefined && (!Number.isFinite(DEPTH_QTY) || DEPTH_QTY <= 0)) { console.error('error: --depth expects a positive unit quantity'); process.exit(1); }

const fmt = n => n == null ? '—' : n.toLocaleString('en-US');
const pad2 = n => String(n).padStart(2, '0');
// the bucketing/quantile math lives in windowread.mjs (shared with watch-positions.mjs's window line)

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
  // #9 (PLAN-WINDOW-CLEAR B3): --exit back-solve — the LARGEST buy whose break-even+margin still clears
  // the intended exit ask (maxBuyForExit, the tax-exact inverse of breakEven). The exit's REACHABILITY in
  // this window is shown beside it: an exit that rarely prints in-window over-states the sell, so the
  // back-solved buy is optimistic (the days-reach ≠ lap-clear caveat — pick a reachable exit).
  if (EXIT != null) {
    const buy = maxBuyForExit(EXIT, MARGIN);
    if (buy == null || buy <= 0) {
      console.log(`  --exit ${fmt(EXIT)} (margin ${fmt(MARGIN)}) → no profitable buy (the exit can't carry break-even + margin)`);
    } else {
      console.log(`  --exit ${fmt(EXIT)} (margin ${fmt(MARGIN)}) → max profitable BUY ${fmt(buy)}  (break-even ${fmt(breakEven(buy))} clears the exit after 2% tax; tax-exact back-solve)`);
      if (his.length) {
        const reached = reachedDays(his, EXIT), N = his.length;
        console.log(`    exit ${fmt(EXIT)} reached on ${reached}/${N} day(s) in this ${winLabel}${splitNote('ask', EXIT)}`);
        if (reached / N < EXIT_REACH_MIN)
          console.log(`    ⚠ this exit rarely prints in-window (${reached}/${N}) — it OVER-states the reachable sell, so the back-solved buy ${fmt(buy)} is optimistic; pick a lower, more-reachable exit`);
      } else {
        console.log(`    (no window highs to score the exit's reachability against — treat the buy as an upper bound)`);
      }
    }
  }
  // DE2 (PLAN-DEPTH-EXIT) — --depth <qty>: percentile-DEPTH read. Per-day instabuy flow at/above the
  // scored ask (does it clear qty×competition?), then clearableAsk — the highest ask <qty> can actually
  // book. A thin book collapses to a null WITH its reason (never a silent degrade — the surfacing rule).
  if (DEPTH_QTY != null) {
    const scoreAsk = ASK ?? EXIT ?? null;   // reuse a hand-given --ask/--exit for the per-day flow table
    if (scoreAsk != null) {
      const dd = depthDays(series, scoreAsk, { qty: DEPTH_QTY, wStart: W_START, wEnd: W_END, nights: NIGHTS });
      if (dd) {
        console.log(`  --depth ${fmt(DEPTH_QTY)}u @ ask ${fmt(scoreAsk)} — per-day instabuy flow at/above the ask:`);
        for (const d of dd.perDay) console.log(`    ${d.key}  flow ${fmt(d.flow)} u  ${d.clears ? '✓ clears' : '· short'}`);
        console.log(`    → clears the ${fmt(DEPTH_QTY)}u lot on ${dd.clearedDays}/${dd.nDays} day(s)${dd.recentFrac != null ? ` (recent-${RECENT_NIGHTS} ${dd.recentClears}/${dd.recentDays})` : ''}`);
      }
    }
    const ca = clearableAsk(series, { qty: DEPTH_QTY, wStart: W_START, wEnd: W_END, nights: NIGHTS });
    const compTxt = `×${ca.competition} comp · ≥${Math.round(ca.targetFrac * 100)}% of ${ca.nDays}d · ≥${ca.minBuckets} buckets`;
    if (ca.price != null)
      console.log(`  --depth ${fmt(DEPTH_QTY)}u → BOOK AT ≤ ${fmt(ca.price)}  (clears ${Math.round(ca.clearFrac * 100)}% of days at this size · ${compTxt})`);
    else if (ca.reason === 'insufficient-depth')
      console.log(`  --depth ${fmt(DEPTH_QTY)}u → NO clearable ask — the book can't absorb ${fmt(ca.need)}u (${fmt(DEPTH_QTY)}×${ca.competition}) at any level in this window: LIQUIDITY collapse, reach fallback (${compTxt})`);
    else
      console.log(`  --depth ${fmt(DEPTH_QTY)}u → no read (${ca.reason === 'thin-history' ? 'too little window history' : 'no traded window buckets'}); reach fallback`);
    console.log(`    (depth estimated from 1h bucket AVERAGES + volumes — NOT an order book; competition ×${ca.competition} is a PLACEHOLDER, n≈0 — inform-only)`);
  }
  console.log(`  (touched/reached ≠ limit filled — small sample, ~${scored.length} days; a guide, not a guarantee)`);
}
