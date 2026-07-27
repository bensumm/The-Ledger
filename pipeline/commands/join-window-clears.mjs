#!/usr/bin/env node
/**
 * join-window-clears.mjs — the WINDOW-CLEAR ASK-RUNG fill-attribution join (WC2, PLAN-WINDOW-CLEAR-OUTCOMES).
 *
 *   node pipeline/commands/join-window-clears.mjs            classify every windowExit shadow record against
 *                                                            the reconstructed sell campaigns; print per-record
 *                                                            rows + the aggregate counts + the D2 diagnostics
 *   node pipeline/commands/join-window-clears.mjs --json      dump the classified rows array (no file write)
 *   flags: --horizon <sec> (placement horizon, default 24h) · --price-tol <frac> (ABOVE list, default 0.5%)
 *          --price-tol-below <frac> (BELOW list, default 1.5% — the anchor-nudge room, see D2) · --min-n <N>
 *
 * THE QUESTION THIS DATASET WILL EVENTUALLY ANSWER (not this chunk — WC3): for a resting ask laddered into a
 * diurnal PEAK window, is daily-HIGH reach or 5m-grain reach the better fill predictor? WC1 logs the surfaced
 * rung + BOTH reach signals to suggestions.jsonl (the `windowExit` shadow). This joiner reads those forward
 * records and marks, per record, whether Ben ACTUALLY placed that rung and whether it filled inside its window.
 *
 * THE THREE-STATE (four-outcome) CLASSIFIER, false-positive-guarded (honesty core, rule 4). For each
 * windowExit record R = { itemId, surfaceTs, list, peakWindow, hiReach, fiveReach }:
 *   1. Candidate placement  = a SELL campaign C for R.itemId placed shortly AFTER the surface
 *                             (surfaceTs ≤ C.placementTs ≤ surfaceTs + HORIZON). Nearest-PRIOR attribution
 *                             (mirrors join-outcomes joinSuggestion): a campaign attributes to the NEWEST
 *                             surface preceding its placement — no double-counting across two surfaces.
 *   2. Price match          = C.placementPrice sits within tolerance of R.list. ASYMMETRIC (D2): Ben places
 *                             asks JUST UNDER round numbers, so real placements sit slightly BELOW `list` —
 *                             a symmetric band would clip the low side. So the band allows MORE room below
 *                             (--price-tol-below, 1.5%) than above (--price-tol, 0.5%), AND the signed
 *                             (placement−list)/list gap is emitted so the skew stays visible either way.
 *   3. Outcome:
 *        UNPLACED                    — no price-and-time-matched campaign. NOT a "no-fill": Ben never placed
 *                                      this rung, so it is a COUNT ONLY and EXCLUDED from every fill-rate
 *                                      (honesty item 2 — the whole reason this join is trustworthy). An
 *                                      unrelated LOWER dump for the same item fails the price gate → UNPLACED,
 *                                      never "filled" (the zero-false-positive guard, fixture-pinned).
 *        PLACED_NO_FILL              — matched campaign, !everFilled (terminal cancel/expire). The floor-night
 *                                      negative — the row this whole plan exists to make analyzable.
 *        PLACED_FILLED_IN_WINDOW     — matched, everFilled, first fill's LOCAL hour ∈ peakWindow (js/windowread
 *                                      inWindow, midnight-crossing handled). The ladder caught its window.
 *        PLACED_FILLED_OUT_OF_WINDOW — matched, everFilled, first fill OUTSIDE the peak window.
 *
 * HONESTY (rule 4, non-negotiable): this is DATA ACCRUAL / MATCHING DIAGNOSTICS, not calibration — it tunes
 * NO constant, moves no price/verdict. n≈0 at launch; weeks to accrue. HORIZON + the price tolerances are
 * NAMED PLACEHOLDERS (n≈0) whose job is to be CALIBRATED LATER from the emitted lag/gap distributions — read
 * the diagnostics, don't trust the guesses. n is printed on every aggregate; a rate below --min-n is refused.
 *
 * Reuses the SHARED campaign reconstruction (lib/campaigns.mjs reconstructCampaigns/campaignBase — the SAME
 * collapseOffers/matchTrades/stampFirstFill join-outcomes runs; never re-implemented) and js/windowread
 * inWindow. The pure join core (joinWindowClears / priceMatch / classifyOutcome) is EXPORTED + fixture-tested;
 * the CLI wiring (fills read, suggestions read) is guarded so importing the module fires no side effect.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconstructCampaigns, campaignBase } from '../lib/reconstruct/campaigns.mjs';
import { readSuggestionLines } from '../lib/render/suggestlog.mjs';
import { loadMapping } from '../lib/market/marketfetch.mjs';
import { parseArgs, median } from '../lib/render/cli.mjs';
import { inWindow } from '../../js/windowread.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const FILLS = path.join(ROOT, 'fills.json');

// --- named placeholder constants (D2 — n≈0 guesses, STATED in output, to be CALIBRATED from the diagnostics) ---
export const PLACE_HORIZON_SEC = 24 * 3600;   // a rung is placed the same session it is surfaced (forward mirror of SUGGEST_WINDOW)
export const PRICE_TOL_ABOVE = 0.005;         // placement ABOVE list: 0.5% tick-noise band on a big-ticket level
export const PRICE_TOL_BELOW = 0.015;         // placement BELOW list: 1.5% — the anchor-nudge room (Ben asks just under round numbers, D2)
// The report floor MIRRORS join-outcomes.mjs MIN_N_REPORT (8). join-outcomes runs build() at module scope so
// it can't be imported; the codebase pattern for these floors is duplicate-with-drift-guard (see
// f1-calibrate.mjs + its test) — joinwindowclears.test.mjs pins this equal to join-outcomes' MIN_N_REPORT.
export const REPORT_FLOOR = 8;

// The peak-window membership test for a first-fill LOCAL hour. peakWindow = [startH, endH] (js/windowread
// hourProfile). Reuses the ONE inWindow definition (midnight-crossing: startH>endH wraps). null window (a
// surface that carried no peak window) → not-in-window (can't claim IN without a window).
export function fillHourInWindow(firstFillTs, peakWindow) {
  if (firstFillTs == null || !Array.isArray(peakWindow) || peakWindow.length < 2) return false;
  const [s, e] = peakWindow;
  if (s == null || e == null) return false;
  const h = new Date(firstFillTs * 1000).getHours();   // LOCAL hour (repo rendered-times-are-local rule)
  return inWindow(h, s, e);
}

// The ASYMMETRIC price gate (D2). gap = (placementPrice − list)/list. Matched when the placement sits within
// PRICE_TOL_BELOW under list and PRICE_TOL_ABOVE over it. Returns { matched, gap } — the signed gap is always
// returned so the anchor-nudge skew is measurable even on a match.
export function priceMatch(placementPrice, list, { tolAbove = PRICE_TOL_ABOVE, tolBelow = PRICE_TOL_BELOW } = {}) {
  if (placementPrice == null || list == null || list === 0) return { matched: false, gap: null };
  const gap = (placementPrice - list) / list;
  return { matched: gap >= -tolBelow && gap <= tolAbove, gap };
}

// The three-state (four-outcome) classifier for ONE record given its matched campaign (null = none matched).
export function classifyOutcome(record, matchedCampaign) {
  if (!matchedCampaign) return 'UNPLACED';
  if (!matchedCampaign.everFilled) return 'PLACED_NO_FILL';
  return fillHourInWindow(matchedCampaign.firstFillTs, record.peakWindow)
    ? 'PLACED_FILLED_IN_WINDOW' : 'PLACED_FILLED_OUT_OF_WINDOW';
}

// nearest-PRIOR surface for a placement (mirrors join-outcomes joinSuggestion): the LATEST record for the
// item with surfaceTs ≤ placementTs AND placement within the horizon. recs must be ascending by surfaceTs.
function nearestPriorRecord(recs, placementTs, horizon) {
  let best = null;
  for (const r of recs) {
    if (r.surfaceTs > placementTs) break;                          // ascending → past the placement, stop
    if (placementTs - r.surfaceTs <= horizon) best = r;            // keep the newest within the horizon
  }
  return best;
}

/* joinWindowClears(records, sellCampaigns, opts) → { rows, counts, diagnostics }.  PURE — no fills/archive read.
 *   records       — [{ itemId, surfaceTs, list, live, peakWindow, hiReach, fiveReach, ... }] (any order).
 *   sellCampaigns — [{ itemId, placementTs, placementPrice, everFilled, firstFillTs, timeToFirstFill,
 *                      terminalState, ... }] (campaignBase shape, side==='sell').
 *   opts          — { horizon, tolAbove, tolBelow }.
 * Each sell campaign attributes to at most ONE record (its nearest-prior surface) so a placement is never
 * double-counted; a record keeps the EARLIEST-placed price-matched campaign as its rung. UNPLACED records are
 * counted but carry no fill. diagnostics = the D2 lag (surface→placement seconds) + signed price-gap
 * distributions over MATCHED placements, plus the count of time-attributed-but-price-FAILED candidates (the
 * lower dumps the guard rejected). */
export function joinWindowClears(records, sellCampaigns, { horizon = PLACE_HORIZON_SEC, tolAbove = PRICE_TOL_ABOVE, tolBelow = PRICE_TOL_BELOW } = {}) {
  // records ascending per item
  const recsByItem = new Map();
  for (const r of records) (recsByItem.get(r.itemId) || recsByItem.set(r.itemId, []).get(r.itemId)).push(r);
  for (const list of recsByItem.values()) list.sort((a, b) => a.surfaceTs - b.surfaceTs);

  // attribute each sell campaign to its nearest-prior record, price-gate it
  const matchByRecord = new Map();   // record -> chosen matched campaign
  const lags = [], gaps = [];
  let priceFailed = 0;               // time-attributed but the price gate rejected them (the lower-dump guard firing)
  for (const c of [...sellCampaigns].sort((a, b) => a.placementTs - b.placementTs)) {
    const recs = recsByItem.get(c.itemId);
    if (!recs) continue;
    const r = nearestPriorRecord(recs, c.placementTs, horizon);
    if (!r) continue;
    const { matched, gap } = priceMatch(c.placementPrice, r.list, { tolAbove, tolBelow });
    if (!matched) { priceFailed++; continue; }                     // unrelated dump / off-level: NOT this rung
    lags.push(c.placementTs - r.surfaceTs);
    if (gap != null) gaps.push(gap);
    if (!matchByRecord.has(r)) matchByRecord.set(r, c);            // earliest-placed matched campaign wins (sorted asc)
  }

  const rows = records.map(r => {
    const c = matchByRecord.get(r) || null;
    const outcome = classifyOutcome(r, c);
    return {
      itemId: r.itemId, surfaceTs: r.surfaceTs, list: r.list, live: r.live ?? null,
      peakWindow: r.peakWindow ?? null, hiReach: r.hiReach ?? null, fiveReach: r.fiveReach ?? null,
      outcome,
      matchedCampaign: c ? {
        placementTs: c.placementTs, price: c.placementPrice, gap: priceMatch(c.placementPrice, r.list, { tolAbove, tolBelow }).gap,
        ttf: c.timeToFirstFill ?? null, firstFillTs: c.firstFillTs ?? null,
        terminalState: c.terminalState ?? null, regime: r.regime ?? null,
      } : null,
    };
  });

  const counts = { total: rows.length, UNPLACED: 0, PLACED_NO_FILL: 0, PLACED_FILLED_IN_WINDOW: 0, PLACED_FILLED_OUT_OF_WINDOW: 0 };
  for (const row of rows) counts[row.outcome]++;
  const placed = counts.PLACED_NO_FILL + counts.PLACED_FILLED_IN_WINDOW + counts.PLACED_FILLED_OUT_OF_WINDOW;
  const filled = counts.PLACED_FILLED_IN_WINDOW + counts.PLACED_FILLED_OUT_OF_WINDOW;

  const dist = arr => arr.length ? { n: arr.length, min: Math.min(...arr), median: median(arr), max: Math.max(...arr) } : { n: 0 };
  const diagnostics = {
    lagSec: dist(lags),
    priceGap: (() => { const d = dist(gaps); if (d.n) { d.below = gaps.filter(g => g < 0).length; d.above = gaps.filter(g => g > 0).length; } return d; })(),
    priceFailed,
  };

  return { rows, counts, placed, filled, diagnostics };
}

// --- CLI (guarded; the pure core above is what tests import) -------------------------------------
// Read the windowExit shadow records from the FULL ledger (active + all monthly archives, SR1). A record
// carries the surfaced rung + both reach signals; surfaceTs is the row's `ts`.
export function readWindowExitRecords() {
  const out = [];
  for (const line of readSuggestionLines()) {
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (!r || r.windowExit == null || r.itemId == null || r.ts == null) continue;
    const w = r.windowExit;
    out.push({ itemId: r.itemId, surfaceTs: r.ts, list: w.list ?? null, live: w.live ?? null,
      peakWindow: w.peakWindow ?? null, hiReach: w.hiReach ?? null, fiveReach: w.fiveReach ?? null,
      script: r.script ?? null, mode: r.mode ?? null, regime: r.regime ?? null });
  }
  return out;
}

async function main() {
  const A = parseArgs(process.argv.slice(2));
  const asJson = !!A.json;
  const horizon = A.horizon != null ? +A.horizon : PLACE_HORIZON_SEC;
  const tolAbove = A['price-tol'] != null ? +A['price-tol'] : PRICE_TOL_ABOVE;
  const tolBelow = A['price-tol-below'] != null ? +A['price-tol-below'] : PRICE_TOL_BELOW;
  const minN = A['min-n'] != null ? +A['min-n'] : REPORT_FLOOR;

  const records = readWindowExitRecords();

  if (!fs.existsSync(FILLS)) { console.error('fills.json not found at ' + FILLS); process.exit(1); }
  const events = (JSON.parse(fs.readFileSync(FILLS, 'utf8')).events || []);
  const { campaigns } = reconstructCampaigns(events);
  const sellCampaigns = campaigns.map(campaignBase).filter(c => c.side === 'sell');

  const res = joinWindowClears(records, sellCampaigns, { horizon, tolAbove, tolBelow });

  if (asJson) { console.log(JSON.stringify(res, null, 2)); return; }

  let map = null; try { map = await loadMapping(); } catch { map = null; }
  const nameOf = id => (map && map.byId[id]?.name) || ('#' + id);
  const iso = ts => new Date(ts * 1000).toISOString();
  const pct = (x) => x == null ? '—' : (x * 100).toFixed(2) + '%';
  const hrs = (s) => s == null ? '—' : (s / 3600).toFixed(1) + 'h';

  console.log('# Window-clear ask-rung fill attribution (WC2 — data accrual / matching diagnostics, NOT calibration)');
  console.log(`windowExit surfaces logged: ${records.length} · sell campaigns reconstructed: ${sellCampaigns.length}`);
  console.log(`placeholders (n≈0, STATED — calibrate from the diagnostics below, do NOT trust): horizon ${hrs(horizon)} · price band [-${pct(tolBelow)} , +${pct(tolAbove)}] around list (asymmetric: anchor-nudge room below)`);

  if (!records.length) {
    console.log('\n_no windowExit records yet_ (n=0 — WC1 logs one only for a big-ticket held lot whose window read fired).');
    console.log('This is the honest, expected early state: the record starts empty and accrues a handful per night at most.');
    return;
  }

  const c = res.counts;
  console.log(`\n## Outcomes (n=${c.total})`);
  console.log(`  UNPLACED (no rung placed at/near list — EXCLUDED from every fill-rate): ${c.UNPLACED}`);
  console.log(`  PLACED_NO_FILL (rung placed, never filled — the floor-night negative):  ${c.PLACED_NO_FILL}`);
  console.log(`  PLACED_FILLED_IN_WINDOW (caught its peak window):                        ${c.PLACED_FILLED_IN_WINDOW}`);
  console.log(`  PLACED_FILLED_OUT_OF_WINDOW (filled, but outside the window):            ${c.PLACED_FILLED_OUT_OF_WINDOW}`);
  console.log(`  → placed (matched) rungs: ${res.placed}  ·  of those filled: ${res.filled}`);

  // Fill-rate — computed ONLY over PLACED rungs (UNPLACED excluded, honesty item 2); refused below the floor.
  console.log(`\n## Fill-rate (over PLACED rungs only — UNPLACED never counts as a no-fill)`);
  if (res.placed >= minN) {
    console.log(`  fill rate: ${res.filled}/${res.placed} = ${pct(res.filled / res.placed)}  ·  in-window share of fills: ${res.filled ? pct(c.PLACED_FILLED_IN_WINDOW / res.filled) : '—'}`);
  } else {
    console.log(`  n=${res.placed} placed rung(s) < floor ${minN} — RATE SUPPRESSED (rule 4: a rate off < ${minN} samples is noise). Counts above stand; let it accrue.`);
  }

  // D2 diagnostics — the distributions that calibrate the placeholders.
  const d = res.diagnostics;
  console.log(`\n## Matching diagnostics (D2 — CALIBRATE the placeholders from these, n≈0 for now)`);
  if (d.lagSec.n) console.log(`  surface→placement lag: median ${hrs(d.lagSec.median)} (min ${hrs(d.lagSec.min)} · max ${hrs(d.lagSec.max)}) over n=${d.lagSec.n} matched`);
  else console.log(`  surface→placement lag: no matched placements yet`);
  if (d.priceGap.n) console.log(`  signed (placement−list)/list gap: median ${pct(d.priceGap.median)} (min ${pct(d.priceGap.min)} · max ${pct(d.priceGap.max)}) over n=${d.priceGap.n} — ${d.priceGap.below} below list · ${d.priceGap.above} above (anchor-nudge skew is visible here)`);
  else console.log(`  signed price gap: no matched placements yet`);
  console.log(`  candidates time-attributed but PRICE-REJECTED (the lower-dump guard firing): ${d.priceFailed}`);

  console.log(`\n## Per-record`);
  const sorted = [...res.rows].sort((a, b) => a.surfaceTs - b.surfaceTs);
  for (const row of sorted) {
    const mc = row.matchedCampaign;
    const pw = Array.isArray(row.peakWindow) ? `${row.peakWindow[0]}-${row.peakWindow[1]}h` : '—';
    let tail = '';
    if (mc) tail = ` | placed @${mc.price} (gap ${pct(mc.gap)}, +${hrs(mc.placementTs - row.surfaceTs)}) ${mc.firstFillTs ? 'fill ' + iso(mc.firstFillTs) : mc.terminalState}`;
    console.log(`  ${iso(row.surfaceTs)} ${nameOf(row.itemId)} list ${row.list} win ${pw} → ${row.outcome}${tail}`);
  }

  console.log(`\nHONESTY (rule 4): this is EVIDENCE for F1/Ben, not a calibration — it tunes no constant, moves no price.`);
  console.log('n≈0 and weeks to accrue; read the matching diagnostics FIRST (they calibrate the horizon/price placeholders).');
  console.log('The "which reach signal predicts a fill" rollup (WC3) is gated on accrual and out of scope here.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => { console.error(e); process.exit(1); });
}
