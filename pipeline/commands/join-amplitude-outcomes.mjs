#!/usr/bin/env node
/**
 * join-amplitude-outcomes.mjs — the AMPLITUDE lane's SHADOW BOTH-LEG REPLAY (PLAN-AMPLITUDE-SCAN §4/§A5).
 *
 *   node pipeline/commands/join-amplitude-outcomes.mjs            replay every amplitude pick, print the
 *                                                                 shadow both-leg would-have-fill rate
 *   node pipeline/commands/join-amplitude-outcomes.mjs --json     dump the per-pick replay array
 *
 * THE MAKE-OR-BREAK QUESTION (§4): the amplitude gate measures the levels PRINTED (the daily trough/peak
 * reached on N of M days); it does NOT measure whether BOTH legs actually FILL within the hold horizon,
 * repeatably. The daily low/high ARE reached each day but not at predictable times, so a same-day round
 * trip isn't guaranteed. This joiner is the CHEAP FALSIFIER (n-rich, zero real fills needed): for every
 * amplitude pick the screen logged to suggestions.jsonl (the `amplitude` shadow block — ampBid/ampAsk/
 * holdDays), it replays against the NEXT holdDays of the per-item 1h archive:
 *   leg-1 would-fill = a daily LOW ≤ ampBid printed inside the horizon.
 *   leg-2 would-fill = a daily HIGH ≥ ampAsk printed on the leg-1 day OR later, inside the horizon.
 *
 * HONESTY LABEL, ALWAYS ATTACHED (rule 4): a printed level ≠ your fill (no queue/size/intra-day-order
 * model — daily buckets can't prove the trough printed before the peak within a day). This is an UPPER
 * BOUND on the realized rate: if even the upper bound is low, the lane is dead; if high, it earns the
 * realized test (the retro-join half — retrojoin.mjs already attributes amplitude BUY→SELL round trips
 * to the lane's suggestions, reported in /analyze). At launch n≈0 and the report says so.
 *
 * The pure replay core (replayAmplitudePick / dayBuckets) is EXPORTED + fixture-tested (no live archive);
 * the CLI wiring (archive read, suggestions read) is guarded so importing the module fires no side effect.
 */
import { fileURLToPath } from 'node:url';
import { readSuggestionLines } from '../lib/suggestlog.mjs';
import { loadMapping } from '../lib/marketfetch.mjs';
import * as archive from '../lib/archive.mjs';

// Bucket a forward 1h series (archive rows mapped to windowStats shape) into per-LOCAL-day {low, hi,
// firstTs} within [from, to], chronological. PURE. Mirrors windowStats' per-day min-low/max-hi, but
// keeps every day (no nights cap, no today-skip) and carries firstTs for ordering + horizon membership.
export function dayBuckets(series, { from = -Infinity, to = Infinity } = {}) {
  const days = new Map();
  for (const pt of series || []) {
    const t = pt.timestamp;
    if (!Number.isFinite(t) || t < from || t > to) continue;
    const d = new Date(t * 1000);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    const rec = days.get(key) || { low: null, hi: null, firstTs: t };
    if (pt.avgLowPrice != null && (rec.low == null || pt.avgLowPrice < rec.low)) rec.low = pt.avgLowPrice;
    if (pt.avgHighPrice != null && (rec.hi == null || pt.avgHighPrice > rec.hi)) rec.hi = pt.avgHighPrice;
    if (t < rec.firstTs) rec.firstTs = t;
    days.set(key, rec);
  }
  return [...days.values()].sort((a, b) => a.firstTs - b.firstTs);
}

/* replayAmplitudePick(series, pick, opts) → the both-leg shadow replay for one pick.
 *   series — the item's forward 1h series (windowStats-shaped points; ascending).
 *   pick   — { ts (suggestion unix sec), ampBid, ampAsk, holdDays }.
 *   opts   — { nowSec } (default: max series ts) decides resolvability.
 * Returns { resolved, pending, leg1Fill, leg2Fill, bothFill, nDaysInHorizon, reason }. `pending` =
 * the archive doesn't yet cover the whole horizon and the round trip hasn't completed (too new to judge —
 * NOT a miss). UPPER BOUND (see the header). */
export function replayAmplitudePick(series, pick, { nowSec = null } = {}) {
  const { ts, ampBid, ampAsk, holdDays = 1 } = pick || {};
  if (ts == null || ampBid == null || ampAsk == null) return { resolved: false, pending: false, reason: 'no-levels' };
  const horizonSec = Math.max(1, holdDays) * 86400;
  const horizonEnd = ts + horizonSec;
  const days = dayBuckets(series, { from: ts, to: horizonEnd });
  const lastTs = (series && series.length) ? series[series.length - 1].timestamp : null;
  const now = nowSec != null ? nowSec : (lastTs != null ? lastTs : ts);
  const leg1Idx = days.findIndex(d => d.low != null && d.low <= ampBid);
  const leg1Fill = leg1Idx >= 0;
  // leg-2: the earliest day at or after the leg-1 day whose HIGH reached the ask (§A5: on the leg-1 day
  // or later — daily buckets can't order intra-day, so a same-day trough+peak counts, flagged UPPER BOUND).
  const leg2Idx = leg1Fill ? days.findIndex((d, i) => i >= leg1Idx && d.hi != null && d.hi >= ampAsk) : -1;
  const leg2Fill = leg2Idx >= 0;
  const bothFill = leg1Fill && leg2Fill;
  // resolved when the round trip completed OR the archive covers the whole horizon (so a miss is a real
  // miss, not just missing data). Otherwise pending (too new to judge).
  const horizonCovered = lastTs != null && lastTs >= horizonEnd;
  const resolved = bothFill || horizonCovered;
  return {
    resolved, pending: !resolved,
    leg1Fill, leg2Fill, bothFill,
    nDaysInHorizon: days.length,
    reason: resolved ? null : 'insufficient-forward-archive',
  };
}

// --- CLI (guarded; the pure core above is what tests import) -------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const lines = readSuggestionLines();
  const picks = [];
  for (const line of lines) {
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (r.mode !== 'amplitude' || !r.amplitude || r.itemId == null) continue;
    picks.push({ ts: r.ts, itemId: r.itemId, ampBid: r.amplitude.ampBid, ampAsk: r.amplitude.ampAsk, holdDays: r.amplitude.holdDays ?? 1 });
  }
  if (!picks.length) {
    console.log('# Amplitude shadow both-leg replay');
    console.log('_no amplitude picks logged yet_ (n=0 — the lane is inform-first; run `screen-flip-niches.mjs --mode amplitude` to accrue picks).');
    return;
  }
  const db = archive.open(archive.DEFAULT_DB, { readonly: true });
  const nowSec = Math.floor(Date.now() / 1000);
  const results = [];
  const byItemSeries = new Map();
  let map = null;
  try { map = await loadMapping(); } catch { map = null; }
  for (const p of picks) {
    let series = byItemSeries.get(p.itemId);
    if (!series) {
      const raw = db.seriesFor(p.itemId, '1h', { from: p.ts, to: nowSec });
      series = raw.map(r => ({ timestamp: r.ts, avgLowPrice: r.avgLowPrice, avgHighPrice: r.avgHighPrice, lowPriceVolume: r.lowPriceVolume, highPriceVolume: r.highPriceVolume }));
      byItemSeries.set(p.itemId, series);
    }
    const rep = replayAmplitudePick(series, p, { nowSec });
    results.push({ ...p, name: (map && map.byId[p.itemId]?.name) || ('#' + p.itemId), ...rep });
  }
  try { db.db.close(); } catch {}

  if (asJson) { console.log(JSON.stringify(results, null, 2)); return; }
  const resolved = results.filter(r => r.resolved);
  const pending = results.filter(r => r.pending);
  const both = resolved.filter(r => r.bothFill).length;
  const leg1 = resolved.filter(r => r.leg1Fill).length;
  console.log('# Amplitude shadow both-leg replay (UPPER BOUND — a printed level ≠ your fill; §A5)');
  console.log(`picks logged: ${results.length} · resolved (archive covers the horizon): ${resolved.length} · pending (too new to judge): ${pending.length}`);
  if (resolved.length) {
    const pct = n => `${(n / resolved.length * 100).toFixed(0)}%`;
    console.log(`\nOf the ${resolved.length} resolved picks:`);
    console.log(`  leg-1 (bid touched)         : ${leg1}/${resolved.length} (${pct(leg1)})`);
    console.log(`  BOTH legs (round trip would complete): ${both}/${resolved.length} (${pct(both)}) — UPPER BOUND`);
    console.log('\nHONESTY (rule 4): this is the would-have-fill CEILING (no queue/size model; daily buckets');
    console.log('can\'t prove the trough printed before the peak). If even this is low, the 24h thesis is dead.');
    console.log('The realized truth is the retro-join half (retrojoin.mjs → /analyze), n≈0 at launch.');
  } else {
    console.log('\n(no resolved picks yet — every pick is still inside its hold horizon / the archive is too');
    console.log(' young to cover it. Re-run once the archive has accrued past the picks\' horizons.)');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => { console.error(e); process.exit(1); });
}
