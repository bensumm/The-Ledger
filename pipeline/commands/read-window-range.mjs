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
 *   --depth <qty>  (PLAN-DEPTH-EXIT DE2 + DE6) percentile-DEPTH read for a lot of <qty> units, BOTH
 *                  edges: the per-day instabuy flow at/above the scored --ask (clears qty×competition?),
 *                  the clearableAsk ("BOOK AT ≤ X"), the per-day instasell flow at/below a scored --bid,
 *                  and the clearableBid ("CATCH AT ≥ X" — how deep a bid still fills). A thin book prints
 *                  its COLLAPSE REASON, never a bare null. Estimate from bucket AVERAGES, not an order
 *                  book (inform-only, n≈0).
 *   --niche <n>    (PLAN-ESTIMATOR-POSTURE AC8) which strategy spec the reach-FOLD data point is computed
 *                  against — band (default) | churn | scalp. With a scored --bid/--ask/--exit + a live
 *                  pair, prints one `fold: best-case X → reach-folded Y` line (the estimator's fold, moved
 *                  out of the discovery price into validation) + a `result.fold` in --json/--out. churn
 *                  inherits the AC5/AC6 fold exemption (fold ≈ best-case). Zero new fetch; inform-only.
 *   --pressure     (PLAN-DEPTH-EXIT Extension A, PB2) the demand-balance reachable band: pressure =
 *                  medVolHi/medVolLo (buy-heavy > 1 / sell-heavy < 1), the regime label, and the
 *                  reachableBid/reachableAsk = base ± band·φ(±s)·reliability with the band + reliability
 *                  inline. The manual φ-tuning surface. Inform-only, n≈0 — φ/PRESSURE_* are placeholders.
 *   --out <path>   ALWAYS write JSON.stringify(results, null, 2) (the same array --json prints) to this
 *                  path, regardless of whether --json was also passed — combine with normal markdown
 *                  stdout to keep the human read while also saving a machine-readable dump for a later
 *                  interpretation pass (e.g. pipeline/.cache/last-report/verify.json). Creates parent
 *                  directories as needed. Default (no --out) is unchanged.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadMapping, fetchTs, fetchLatest } from '../lib/marketfetch.mjs';
import { parseArgs, parseGp } from '../lib/cli.mjs';
import { windowStats, quantLow, quantHigh, touchedDays, reachedDays, placement, recencySplit, recentQuant, RECENT_NIGHTS, hourProfile, deriveDiurnalRange, depthDays, clearableAsk, clearableBid, demandPressure, reachableBand, demandRegime } from '../../js/windowread.mjs';   // DE2: --depth reads the percentile-depth model (DE6 added the clearableBid mirror); PB2: --pressure reads the demand-balance band; DC2: --pressure surfaces the per-hour demand cycle + windows; AC4a: placement = price→percentile for --ask/--bid
import { maxBuyForExit, breakEven } from '../../js/quotecore.js';   // #9 (PLAN-WINDOW-CLEAR B3): --exit back-solves the max profitable buy from an intended exit ask
import { open as openArchive } from '../lib/archive.mjs';   // AC4a: read-only 5m-grain reach where the Tier-1 archive has coverage (degrades to 1h-only when it doesn't)
import { estimatePair, estConfLean } from '../lib/estimators.mjs';   // PLAN-ESTIMATOR-POSTURE AC8: the SHARED reconciliation estimator — the reach-FOLD moved out of the discovery price INTO this validation flow as a DATA POINT (zero new fetch, byte-parity with the screen's fold)
import { FLIP_NICHES } from '../../js/flip-niches.mjs';   // AC8: the per-niche spec the fold is computed against (--niche, default band)

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
if (!positionals.length) { console.error('usage: node pipeline/commands/read-window-range.mjs "<item or id>" [...more] [--nights 14] [--window 0-8] [--bid <gp>] [--ask <gp>] [--exit <ask> [--margin <gp>]] [--depth <qty>] [--pressure] [--profile] [--niche band|churn|scalp] [--json] [--out <path>]'); process.exit(1); }

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
// PB2 — --pressure: the pressure-driven reachable band (demand-balance read; no qty). A bare flag.
const PRESSURE = A.pressure !== undefined && A.pressure !== false;
// AC8 — --niche <band|churn|scalp>: which strategy spec the fold-datapoint is computed against (default
// band). churn inherits AC5/AC6's fold exemption, so its fold line reads fold ≈ best-case (itself
// informative). value is term-basis (no opt band pair) → excluded here.
const NICHE = (A.niche !== undefined ? String(A.niche) : 'band').toLowerCase();
if (!['band', 'churn', 'scalp'].includes(NICHE)) { console.error('error: --niche expects band, churn, or scalp'); process.exit(1); }
// AO2 — --json: emit the assembled result object(s) as JSON instead of markdown; default stdout stays
// byte-identical when absent (the analyze-record/analyze-fill-placement `--json`→stdout convention, NOT
// writeLastReport — this command builds no render.mjs section objects). A bare flag.
const JSON_OUT = A.json !== undefined && A.json !== false;
// --out <path>: always write the plain results array to this path, independent of --json (which
// stays stdout-only, wrapped with kind/generatedAt/window metadata). A different, simpler shape —
// not the writeLastReport {kind,generatedAt,reports:[...]} convention.
const OUT_PATH = A.out !== undefined ? String(A.out) : null;

const fmt = n => n == null ? '—' : n.toLocaleString('en-US');
const pad2 = n => String(n).padStart(2, '0');
const pctStr = f => f == null ? '—' : 'p' + Math.round(f * 100);   // placement fraction → pXX label
// stdout is markdown by default; --json suppresses it and dumps the results array once at the end.
const log = (...a) => { if (!JSON_OUT) console.log(...a); };
// the bucketing/quantile math lives in windowread.mjs (shared with watch-positions.mjs's window line)

// AC4a — grain-aware reach: the Tier-1 SQLite archive stores whole-market 5m snapshots opportunistically
// (AC1 read the accrual as ~5 buckets/day; it has since grown to hundreds of whole-market snapshots, so a
// liquid item over a broad window often HAS coverage, while a narrow/off-peak window frequently has none —
// coverage is per-item AND per-time-of-day). Open it read-only + best-effort — a missing/locked/absent DB
// degrades cleanly to null (1h-only), never an error. The 5m avgHighPrice/avgLow is LESS smoothed than the
// 1h average (its per-day max sits ~0.4–0.6% above per AC2 — and that is itself a LOWER BOUND, since a 5m
// value is a 5-minute average, not a raw tick). We surface the 5m figure ALONGSIDE the 1h one, labeled,
// never replacing it, and gate it on ≥ FIVE_MIN_MIN_DAYS covered days so a one-off snapshot can't fake a read.
const FIVE_MIN_MIN_DAYS = 3;   // fewer scored 5m-grain window-days than this ⇒ don't surface (too sparse to read)
let archive = null;
try { archive = openArchive(undefined, { readonly: true }); } catch { archive = null; }
function fiveMinStats(id) {
  if (!archive) return null;
  let rows = [];
  try { rows = archive.seriesFor(id, '5m'); } catch { return null; }
  if (!rows || !rows.length) return null;
  // archive rows use `ts`; windowStats reads `timestamp` (same field set otherwise).
  const mapped = rows.map(r => ({ timestamp: r.ts, avgLowPrice: r.avgLowPrice, avgHighPrice: r.avgHighPrice, lowPriceVolume: r.lowPriceVolume, highPriceVolume: r.highPriceVolume }));
  return windowStats(mapped, { nights: NIGHTS, wStart: W_START, wEnd: W_END });
}

const results = [];   // AO2: one entry per positional (the --json payload)
const map = await loadMapping();
for (const want of positionals) {
  const r = map.resolve(want);
  if (!r) { log(`\n"${want}": not found in the item mapping — check spelling or pass an id.`); results.push({ item: want, error: 'not-found' }); continue; }
  const [series, latest] = await Promise.all([fetchTs(r.id, '1h'), fetchLatest(r.id)]);
  const result = { item: r.name, id: r.id, window: { start: W_START, end: W_END } };
  results.push(result);

  // --profile: the hour-of-day diurnal read (peak-timing) — locates the daily dip/peak WINDOWS and
  // derives a stale-guarded bid/ask, instead of scoring one hand-picked --window. Same 1h series.
  if (A.profile !== undefined) {
    const prof = hourProfile(series, { nights: NIGHTS });
    result.mode = 'profile';
    log(`\n## ${r.name} — diurnal profile, last ${prof ? prof.nights : 0} day(s) (local hour-of-day, 1h series)`);
    if (!prof) {
      log('  too thin to profile — need ≥4 traded days of hourly history.');
      result.profile = null;
    } else {
      const inDip = new Set(prof.dip.hours), inPeak = new Set(prof.peak.hours);
      for (const x of prof.hours) {
        const tag = inDip.has(x.h) ? ' ⬇dip' : inPeak.has(x.h) ? ' ⬆peak' : '';
        log(`  ${pad2(x.h)}:00  low ${fmt(x.lowRecent)} · high ${fmt(x.hiRecent)}  · n ${x.n}${tag}`);
      }
      const win = (w) => `${pad2(w.startH)}:00–${pad2(w.endH)}:00`;
      log(`  ---`);
      log(`  DIP window ${win(prof.dip)} — recent level ${fmt(prof.dip.level)}`);
      log(`  PEAK window ${win(prof.peak)} — recent level ${fmt(prof.peak.level)}`);
      log(`  intraday amplitude ~${fmt(prof.amplitude)}${prof.amplitudePct != null ? ` (${(prof.amplitudePct * 100).toFixed(1)}%)` : ''} · trend ${prof.trendPerDay == null ? '—' : (prof.trendPerDay >= 0 ? '+' : '') + fmt(Math.round(prof.trendPerDay)) + '/day'}${prof.trendDominates ? ' ⚠ trend-dominates' : ''}`);
      if (latest && latest.low != null) log(`  live instasell now: ${fmt(latest.low)}${latest.high != null ? ` · live instabuy now: ${fmt(latest.high)}` : ''}`);
      const dr = deriveDiurnalRange(prof, { liveLo: latest && latest.low != null ? latest.low : null, liveHi: latest && latest.high != null ? latest.high : null });
      if (dr) {
        log(`  → BID ${fmt(dr.bid)} (${dr.bidBasis}, ${win(dr.dipWindow)}) · ASK ${fmt(dr.ask)} (${win(dr.peakWindow)})`);
        for (const n of dr.notes) log(`    ⓘ ${n}`);
      }
      log(`  (hour-of-day medians, small sample — a guide, not a guarantee)`);
      result.profile = { nights: prof.nights, dip: prof.dip, peak: prof.peak, amplitude: prof.amplitude, amplitudePct: prof.amplitudePct, trendPerDay: prof.trendPerDay, trendDominates: prof.trendDominates };
      result.diurnalRange = dr ? { bid: dr.bid, ask: dr.ask, bidBasis: dr.bidBasis, notes: dr.notes } : null;
    }
    // compose: only short-circuit the rest of the per-item loop (window-range table + ask/bid/exit/depth
    // blocks below) when NONE of those flags were also given — a bare --profile keeps today's exact
    // profile-only output, while --profile combined with --ask/--bid/--exit/--depth falls through so
    // this same `result` object also picks up the window-range read.
    if (BID == null && ASK == null && EXIT == null && DEPTH_QTY == null) continue;
  }

  const stats = windowStats(series, { nights: NIGHTS, wStart: W_START, wEnd: W_END });
  const winLabel = `${pad2(W_START)}:00–${pad2(W_END)}:00 local`;
  result.winLabel = winLabel;
  log(`\n## ${r.name} — window range, last ${stats ? stats.days.length : 0} day(s) (${winLabel}, 1h series)`);
  if (!stats) { log('no traded window-hours in the available history — too thin to read this window.'); result.daysScored = 0; continue; }
  const { days: scored, lows, his, medVolLo, medVolHi } = stats;
  result.daysScored = scored.length;
  result.days = scored.map(([key, n]) => ({ key, low: n.low, hi: n.hi, volLo: n.volLo, volHi: n.volHi }));
  for (const [key, n] of scored)
    log(`  ${key}  low ${fmt(n.low)} · high ${fmt(n.hi)}  · sell-vol ${fmt(n.volLo)} · buy-vol ${fmt(n.volHi)}`);

  // AC4a — 5m-grain (less-smoothed) window stats where the archive has coverage; sparse, null when not.
  const fiveStats = (BID != null || ASK != null || EXIT != null) ? fiveMinStats(r.id) : null;
  const fiveOk = fiveStats && (fiveStats.his.length >= FIVE_MIN_MIN_DAYS || fiveStats.lows.length >= FIVE_MIN_MIN_DAYS);

  log(`  ---`);
  const rq = (side, p) => { const v = recentQuant(scored, side, p, RECENT_NIGHTS); return v == null ? '' : ` · recent-${RECENT_NIGHTS} ~50%: ${fmt(v)}`; };
  if (lows.length) {
    log(`  BID side — touched on ~50% of days: ${fmt(quantLow(lows, 0.5))} · ~75%: ${fmt(quantLow(lows, 0.75))} · every day: ${fmt(lows[lows.length - 1])}${rq('bid', 0.5)}`);
    log(`    median window instasell volume: ${fmt(medVolLo)} u (the pool a resting bid competes for)`);
    result.bidSide = { q50: quantLow(lows, 0.5), q75: quantLow(lows, 0.75), everyDay: lows[lows.length - 1], recent50: recentQuant(scored, 'bid', 0.5, RECENT_NIGHTS), medVol: medVolLo, nDays: lows.length };
  }
  if (his.length) {
    log(`  ASK side — reached on ~50% of days: ${fmt(quantHigh(his, 0.5))} · ~75%: ${fmt(quantHigh(his, 0.75))} · every day: ${fmt(his[0])}${rq('ask', 0.5)}`);
    log(`    median window instabuy volume: ${fmt(medVolHi)} u (the pool a resting ask competes for)`);
    result.askSide = { q50: quantHigh(his, 0.5), q75: quantHigh(his, 0.75), everyDay: his[0], recent50: recentQuant(scored, 'ask', 0.5, RECENT_NIGHTS), medVol: medVolHi, nDays: his.length };
  }
  if (latest && latest.low != null) { log(`  live instasell now: ${fmt(latest.low)}${latest.high != null ? ` · live instabuy now: ${fmt(latest.high)}` : ''}`); result.live = { instasell: latest.low, instabuy: latest.high != null ? latest.high : null }; }
  // recency split on the scored candidate: recent-N hit rate beside the full count, ⚠ when the
  // full count is rosier than recent (stale-regime contamination — don't trust the full number)
  const splitNote = (side, level) => {
    const s = recencySplit(scored, side, level, RECENT_NIGHTS);
    let note = ` · recent ${s.recentHit}/${s.recentDays}`;
    if (s.staleOptimistic) note += ` ⚠ stale — the full count is concentrated in an older price regime; recent nights ${side === 'bid' ? "don't dip to this bid" : "don't reach this ask"}, discount it`;
    else if (s.diverges) note += ` (recent ${side === 'bid' ? 'dips lower/more often' : 'reaches higher/more often'} than the full window)`;
    return note;
  };
  // AC4a — placement: WHERE the scored --bid/--ask sits in the trailing daily-low/high distribution
  // (a percentile, the inverse of the ~50%/~75% quantiles above). This is the descriptive reframe of
  // Finding 3: "reached k/N" only asks whether the 1h AVERAGE crossed the level; placement says where a
  // resting order priced above/below that average actually sits historically. Purely descriptive — NO
  // "safe ≈ pXX" verdict (AC3's calibrated threshold did not land; its gate failed — see the placement()
  // header). The reach-count framing STAYS on the same line (they coexist); the sample size (n days) is
  // stated beside every placement (process rule 4). The 5m-grain figure rides ALONGSIDE, labeled, when
  // the archive has ≥ FIVE_MIN_MIN_DAYS of coverage — never replacing the 1h number.
  if (BID != null && lows.length) {
    const bidPlace = placement(lows, BID);
    log(`  --bid ${fmt(BID)} → would have been touched on ${touchedDays(lows, BID)}/${lows.length} day(s)${splitNote('bid', BID)} · placement ${pctStr(bidPlace)} of the ${lows.length}-day daily-LOW distribution`);
    result.bid = { level: BID, touchedDays: touchedDays(lows, BID), nDays: lows.length, placement: bidPlace, recency: recencySplit(scored, 'bid', BID, RECENT_NIGHTS), grain5m: null };
    if (fiveStats && fiveStats.lows.length >= FIVE_MIN_MIN_DAYS) {
      const t5 = touchedDays(fiveStats.lows, BID), p5 = placement(fiveStats.lows, BID);
      log(`    ↳ 5m-grain (archive, less-smoothed; a LOWER BOUND on the true gap per AC2): touched ${t5}/${fiveStats.lows.length} · placement ${pctStr(p5)} (n=${fiveStats.lows.length} days)`);
      result.bid.grain5m = { touchedDays: t5, nDays: fiveStats.lows.length, placement: p5 };
    }
  }
  if (ASK != null && his.length) {
    const askPlace = placement(his, ASK);
    log(`  --ask ${fmt(ASK)} → would have been reached on ${reachedDays(his, ASK)}/${his.length} day(s)${splitNote('ask', ASK)} · placement ${pctStr(askPlace)} of the ${his.length}-day daily-HIGH distribution`);
    result.ask = { level: ASK, reachedDays: reachedDays(his, ASK), nDays: his.length, placement: askPlace, recency: recencySplit(scored, 'ask', ASK, RECENT_NIGHTS), grain5m: null };
    if (fiveStats && fiveStats.his.length >= FIVE_MIN_MIN_DAYS) {
      const r5 = reachedDays(fiveStats.his, ASK), p5 = placement(fiveStats.his, ASK);
      log(`    ↳ 5m-grain (archive, less-smoothed; a LOWER BOUND on the true gap per AC2): reached ${r5}/${fiveStats.his.length} · placement ${pctStr(p5)} (n=${fiveStats.his.length} days)`);
      result.ask.grain5m = { reachedDays: r5, nDays: fiveStats.his.length, placement: p5 };
    }
  }
  if (!fiveOk && (BID != null || ASK != null)) log(`    (no 5m-grain reach: the archive has <${FIVE_MIN_MIN_DAYS} covered window-days overlapping this ${winLabel} — 5m accrual is opportunistic per time-of-day, so a narrow/off-peak window often has none; 1h-only)`);
  // #9 (PLAN-WINDOW-CLEAR B3): --exit back-solve — the LARGEST buy whose break-even+margin still clears
  // the intended exit ask (maxBuyForExit, the tax-exact inverse of breakEven). The exit's REACHABILITY in
  // this window is shown beside it: an exit that rarely prints in-window over-states the sell, so the
  // back-solved buy is optimistic (the days-reach ≠ lap-clear caveat — pick a reachable exit).
  if (EXIT != null) {
    const buy = maxBuyForExit(EXIT, MARGIN);
    if (buy == null || buy <= 0) {
      log(`  --exit ${fmt(EXIT)} (margin ${fmt(MARGIN)}) → no profitable buy (the exit can't carry break-even + margin)`);
      result.exit = { level: EXIT, margin: MARGIN, maxBuy: null };
    } else {
      log(`  --exit ${fmt(EXIT)} (margin ${fmt(MARGIN)}) → max profitable BUY ${fmt(buy)}  (break-even ${fmt(breakEven(buy))} clears the exit after 2% tax; tax-exact back-solve)`);
      result.exit = { level: EXIT, margin: MARGIN, maxBuy: buy, breakEven: breakEven(buy), reachedDays: null, nDays: his.length, placement: null };
      if (his.length) {
        const reached = reachedDays(his, EXIT), N = his.length;
        const exitPlace = placement(his, EXIT);
        log(`    exit ${fmt(EXIT)} reached on ${reached}/${N} day(s) in this ${winLabel}${splitNote('ask', EXIT)} · placement ${pctStr(exitPlace)} of the ${N}-day daily-HIGH distribution`);
        result.exit.reachedDays = reached; result.exit.placement = exitPlace;
        if (reached / N < EXIT_REACH_MIN)
          log(`    ⚠ this exit rarely prints in-window (${reached}/${N}) — it OVER-states the reachable sell, so the back-solved buy ${fmt(buy)} is optimistic; pick a lower, more-reachable exit`);
      } else {
        log(`    (no window highs to score the exit's reachability against — treat the buy as an upper bound)`);
      }
    }
  }
  // PLAN-ESTIMATOR-POSTURE AC8 — the reach-FOLD as a VALIDATION DATA POINT (its new home). Discovery
  // (the screen) now shows the BEST-CASE price; the fold moved OUT of that price and INTO this validation
  // flow. From the live pair + the window reach counts ALREADY in hand (ZERO new fetch), build a synthetic
  // estimator row and call the SHARED estimatePair (sellModel 'reach-fold') — reusing the estimator, not
  // re-deriving the fold math, guarantees byte-parity with what the screen would fold. The operator sees
  // `best-case X → reach-folded Y` at the moment capital is committed and picks with BOTH numbers in hand.
  // Inform-only PLACEHOLDER (n≈14) — the estimator's fold, NOT a verdict; never gates/overrides the
  // reach/placement/depth reads. churn inherits AC5/AC6's exemption, so its fold line reads fold ≈ best-case.
  if (latest && latest.high != null && latest.low != null && (BID != null || ASK != null || EXIT != null)) {
    const askScoreLevel = ASK != null ? ASK : (EXIT != null ? EXIT : null);   // an explicit sell/exit level
    // synthetic row: live pair from latest; opt edges from the scored levels (or the window ~50% quantile).
    const synthRow = {
      quickBuy: latest.high, quickSell: latest.low,
      optBuy: BID != null ? BID : (lows.length ? quantLow(lows, 0.5) : latest.high),
      optSell: askScoreLevel != null ? askScoreLevel : (his.length ? quantHigh(his, 0.5) : latest.low),
    };
    const extra = {};
    // ask/exit reach → askReach (full hit + recent split); same field remap the screen does at its :583.
    if (askScoreLevel != null && his.length) {
      const rc = recencySplit(scored, 'ask', askScoreLevel, RECENT_NIGHTS);
      extra.askReach = { reachedDays: reachedDays(his, askScoreLevel), nDays: his.length, recentHit: rc.recentHit, recentDays: rc.recentDays };
    }
    // bid touch → bidReach (only the buy leg of a faller-accepting 'scalp' niche folds it; band/churn price the band low).
    if (BID != null && lows.length) {
      const rc = recencySplit(scored, 'bid', BID, RECENT_NIGHTS);
      extra.bidReach = { reachedDays: touchedDays(lows, BID), nDays: lows.length, recentHit: rc.recentHit, recentDays: rc.recentDays };
    }
    const est = estimatePair(FLIP_NICHES[NICHE], synthRow, extra, { sellModel: 'reach-fold' });
    if (est) {
      const nicheTag = NICHE === 'band' ? '' : ` [--niche ${NICHE}]`;
      const recFull = r => r ? ` (recent ${r.recentHit != null ? r.recentHit : '—'}/${r.recentDays != null ? r.recentDays : '—'} · full ${r.reachedDays}/${r.nDays})` : '';
      // the SELL fold line (the mirage guard's home): best-case ask → the estimator's reach-folded exit.
      if (askScoreLevel != null) {
        const net = est.estNet, sign = net != null && net > 0 ? '+' : '';
        log(`  fold${nicheTag}: best-case ask ${fmt(askScoreLevel)} → reach-folded ${fmt(est.estSell)}${recFull(extra.askReach)} · net at folded pair ${sign}${fmt(net)} (BE ${fmt(est.be)})`);
      }
      // a BUY fold line ONLY when the entry doctrine actually folds it (scalp bids-to-fill toward live) —
      // band/churn price the band low unfolded (AC1/AC6), so there is nothing to show there.
      if (BID != null && est.estBuy !== synthRow.optBuy)
        log(`  fold${nicheTag}: best-case bid ${fmt(BID)} → reach-folded ${fmt(est.estBuy)}${recFull(extra.bidReach)}`);
      result.fold = { niche: NICHE, estBuy: est.estBuy, estSell: est.estSell, estNet: est.estNet, be: est.be, confidence: estConfLean(est) };
    }
  }
  // DE2 (PLAN-DEPTH-EXIT) — --depth <qty>: percentile-DEPTH read, BOTH edges (DE6 added the low
  // side). Per-day instabuy flow at/above the scored ask (does it clear qty×competition?), then
  // clearableAsk — the highest ask <qty> can actually book — and clearableBid — the deepest bid that
  // still fills off the instasell flow (the two-sided size-aware band). A thin book collapses to a
  // null WITH its reason (never a silent degrade — the surfacing rule).
  if (DEPTH_QTY != null) {
    result.depth = { qty: DEPTH_QTY };
    const scoreAsk = ASK ?? EXIT ?? null;   // reuse a hand-given --ask/--exit for the per-day flow table
    if (scoreAsk != null) {
      const dd = depthDays(series, scoreAsk, { qty: DEPTH_QTY, wStart: W_START, wEnd: W_END, nights: NIGHTS });
      if (dd) {
        log(`  --depth ${fmt(DEPTH_QTY)}u @ ask ${fmt(scoreAsk)} — per-day instabuy flow at/above the ask:`);
        for (const d of dd.perDay) log(`    ${d.key}  flow ${fmt(d.flow)} u  ${d.clears ? '✓ clears' : '· short'}`);
        log(`    → clears the ${fmt(DEPTH_QTY)}u lot on ${dd.clearedDays}/${dd.nDays} day(s)${dd.recentFrac != null ? ` (recent-${RECENT_NIGHTS} ${dd.recentClears}/${dd.recentDays})` : ''}`);
        result.depth.askFlow = { scoreAsk, clearedDays: dd.clearedDays, nDays: dd.nDays, recentClears: dd.recentClears, recentDays: dd.recentDays };
      }
    }
    if (BID != null) {   // DE6 — the low-side per-day flow table for a scored --bid
      const db = depthDays(series, BID, { qty: DEPTH_QTY, side: 'bid', wStart: W_START, wEnd: W_END, nights: NIGHTS });
      if (db) {
        log(`  --depth ${fmt(DEPTH_QTY)}u @ bid ${fmt(BID)} — per-day instasell flow at/below the bid:`);
        for (const d of db.perDay) log(`    ${d.key}  flow ${fmt(d.flow)} u  ${d.clears ? '✓ fills' : '· short'}`);
        log(`    → fills the ${fmt(DEPTH_QTY)}u lot on ${db.clearedDays}/${db.nDays} day(s)${db.recentFrac != null ? ` (recent-${RECENT_NIGHTS} ${db.recentClears}/${db.recentDays})` : ''}`);
        result.depth.bidFlow = { bid: BID, clearedDays: db.clearedDays, nDays: db.nDays, recentClears: db.recentClears, recentDays: db.recentDays };
      }
    }
    const ca = clearableAsk(series, { qty: DEPTH_QTY, wStart: W_START, wEnd: W_END, nights: NIGHTS });
    const compTxt = `×${ca.competition} comp · ≥${Math.round(ca.targetFrac * 100)}% of ${ca.nDays}d · ≥${ca.minBuckets} buckets`;
    if (ca.price != null)
      log(`  --depth ${fmt(DEPTH_QTY)}u → BOOK AT ≤ ${fmt(ca.price)}  (clears ${Math.round(ca.clearFrac * 100)}% of days at this size · ${compTxt})`);
    else if (ca.reason === 'insufficient-depth')
      log(`  --depth ${fmt(DEPTH_QTY)}u → NO clearable ask — the book can't absorb ${fmt(ca.need)}u (${fmt(DEPTH_QTY)}×${ca.competition}) at any level in this window: LIQUIDITY collapse, reach fallback (${compTxt})`);
    else
      log(`  --depth ${fmt(DEPTH_QTY)}u → no read (${ca.reason === 'thin-history' ? 'too little window history' : 'no traded window buckets'}); reach fallback`);
    result.depth.clearableAsk = { price: ca.price, clearFrac: ca.clearFrac, reason: ca.reason, competition: ca.competition };
    // DE6 — the mirror edge: how deep a bid still fills off the instasell flow.
    const cb = clearableBid(series, { qty: DEPTH_QTY, wStart: W_START, wEnd: W_END, nights: NIGHTS });
    if (cb.price != null)
      log(`  --depth ${fmt(DEPTH_QTY)}u → CATCH AT ≥ ${fmt(cb.price)}  (a bid this deep fills ${Math.round(cb.clearFrac * 100)}% of days at this size · ×${cb.competition} comp)`);
    else if (cb.reason === 'insufficient-depth')
      log(`  --depth ${fmt(DEPTH_QTY)}u → NO clearable bid — the instasell flow can't fill ${fmt(cb.need)}u (${fmt(DEPTH_QTY)}×${cb.competition}) at any level in this window; bid to live instead`);
    else
      log(`  --depth ${fmt(DEPTH_QTY)}u → no bid-side read (${cb.reason === 'thin-history' ? 'too little window history' : 'no traded window buckets'})`);
    result.depth.clearableBid = { price: cb.price, clearFrac: cb.clearFrac, reason: cb.reason, competition: cb.competition };
    log(`    (depth estimated from 1h bucket AVERAGES + volumes — NOT an order book; competition ×${ca.competition} is a PLACEHOLDER, n≈0 — inform-only)`);
  }
  // PB2 (PLAN-DEPTH-EXIT Extension A) — --pressure: the demand-balance reachable band. pressure =
  // medVolHi/medVolLo drives one monotone φ(ln pressure); the band is the daily-high/low IQR; a
  // thin-VOLUME book degrades to the smoothed center via the reliability guard (no peak-cap). The φ
  // slope + PRESSURE_* are n≈0 placeholders — this is the manual tuning surface, inform-only.
  if (PRESSURE) {
    const dp = demandPressure(stats);
    const rb = reachableBand(stats);
    if (!dp) {
      log(`  --pressure → no read (a window side has no traded volume — can't form the ratio)`);
      result.pressure = null;
    } else {
      const regime = dp.ratio >= 1.1 ? 'buy-heavy (favors the SELLER — high ask, shallow bid)'
        : dp.ratio <= 0.9 ? 'sell-heavy (favors the BUYER — deep bid, shallow ask)' : 'balanced';
      const relTxt = dp.reliability < 1 ? ` · reliability ${dp.reliability.toFixed(2)} (thin volume — headroom shrunk toward the center)` : ' · reliability 1.00';
      log(`  --pressure → ${dp.ratio.toFixed(2)}× ${regime}${relTxt}`);
      log(`    (buy flow ${fmt(dp.medVolHi)} u/d vs sell flow ${fmt(dp.medVolLo)} u/d · median over ${stats.days.length}d)`);
      result.pressure = { ratio: dp.ratio, reliability: dp.reliability, medVolHi: dp.medVolHi, medVolLo: dp.medVolLo, reachableAsk: rb ? rb.ask : null, reachableBid: rb ? rb.bid : null };
      if (rb) {
        log(`    reachable ASK ${fmt(rb.ask)}  (center ${fmt(rb.baseHigh)} + band ${fmt(rb.bandHigh)} × φ ${rb.phiAsk.toFixed(2)})`);
        log(`    reachable BID ${fmt(rb.bid)}  (center ${fmt(rb.baseLow)} − band ${fmt(rb.bandLow)} × φ ${rb.phiBid.toFixed(2)})`);
      } else {
        log(`    (too few scored days to form a band — need ≥5)`);
      }
      // DC2 (PLAN-DEPTH-EXIT Extension B) — the per-hour demand CYCLE + the buy/sell timing windows,
      // cross-checked against the PRICE-shape diurnal read (hourProfile). The demand read says WHEN
      // buyers are hungry / sellers dump; the price read says when price peaks/dips. When they AGREE the
      // timing is demand-CONFIRMED; a divergence is a lean, not a contradiction (both are small-sample).
      const dReg = demandRegime(series, { nights: NIGHTS });
      if (dReg && dReg.hours) {
        const cell = t => t.pressure == null ? `${pad2(t.hour)}:—` : `${pad2(t.hour)}:${t.pressure.toFixed(1)}${t.reliability < 0.5 ? '?' : ''}`;
        log(`    per-hour pressure (local h · ? = thin): ${dReg.hours.map(cell).join(' ')}`);
        const winTxt = w => w ? `${pad2(w.startH)}:00–${pad2(w.endH)}:00 (peak ${pad2(w.atHour)}h ${w.pressure.toFixed(2)}×)` : 'none';
        log(`    SELL window (buyers hungry): ${winTxt(dReg.sellWindow)} · BUY window (sellers dump): ${winTxt(dReg.buyWindow)}`);
        // cross-check the demand windows against the PRICE dip/peak windows (deriveDiurnalRange).
        const prof = hourProfile(series, { nights: NIGHTS });
        const dRange = prof ? deriveDiurnalRange(prof, {}) : null;
        if (dRange) {
          const expand = (a, b) => { const s = new Set(); if (a === b) { for (let h = 0; h < 24; h++) s.add(h); return s; } for (let h = a; h !== b; h = (h + 1) % 24) s.add(h); return s; };
          const agrees = (pw, dw) => (!pw || !dw) ? null : dw.hours.some(h => expand(pw.startH, pw.endH).has(h));
          const sellAgree = agrees(dRange.peakWindow, dReg.sellWindow);
          const buyAgree = agrees(dRange.dipWindow, dReg.buyWindow);
          const mark = a => a == null ? '(one side absent)' : a ? '✓ demand-confirmed' : '✗ diverge (lean only)';
          log(`    cross-check vs price shape: SELL — price peak ${pad2(dRange.peakWindow.startH)}–${pad2(dRange.peakWindow.endH)}h ${mark(sellAgree)} · BUY — price dip ${pad2(dRange.dipWindow.startH)}–${pad2(dRange.dipWindow.endH)}h ${mark(buyAgree)}`);
        }
      }
      log(`    (pressure = medVolHi/medVolLo; φ slope + PRESSURE_* are PLACEHOLDERS, n≈0 — the reachable price is where price TRADED, not a verified fill · inform-only)`);
    }
  }
  log(`  (touched/reached ≠ limit filled — small sample, ~${scored.length} days; a guide, not a guarantee)`);
}
if (archive) { try { archive.close(); } catch { /* best-effort */ } }

// AO2 — --json: dump the assembled per-item result objects once. NOT the writeLastReport render-object
// convention (this command has no render.mjs sections); the analyze-record/analyze-fill-placement
// `--json`→stdout convention for non-render analysis commands. Default (markdown) stdout is untouched.
if (JSON_OUT) console.log(JSON.stringify({ kind: 'windowrange', generatedAt: new Date().toISOString(), nights: NIGHTS, window: { start: W_START, end: W_END }, items: results }, null, 2));
// --out: always dump the plain results array (regardless of --json), for a later interpretation
// pass to read without re-running/re-deriving the checks by hand.
if (OUT_PATH) {
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
}
