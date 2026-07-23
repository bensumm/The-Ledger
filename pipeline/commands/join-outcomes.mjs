#!/usr/bin/env node
/**
 * join-outcomes.mjs â€” THE JOIN (PLAN O1 step 3/4). Derived + rebuildable â†’ GITIGNORED (never commit
 * outcomes.json or the .cache/outcomes-bands/ data). Rebuilds the full "story of every offer" from
 * fills.json + suggestions.jsonl + historical market context, so the algorithm-feedback loop (F1)
 * becomes a query rather than a re-derivation.
 *
 *   node pipeline/commands/join-outcomes.mjs            rebuild + write outcomes.json, print a summary
 *   node pipeline/commands/join-outcomes.mjs --report   + fill-time DISTRIBUTIONS by band-percentile Ã— liquidity
 *                                          class, n PER CELL, refusing to summarize below --min-n
 *   node pipeline/commands/join-outcomes.mjs --no-bands  skip the historical band-percentile fetch (fast, offline)
 *   node pipeline/commands/join-outcomes.mjs --json      dump the campaigns array to stdout (no file write)
 *   flags: --min-n <N> (report cell floor, default 8) Â· --band-hours <H> (band basis, default 2)
 *
 * A CAMPAIGN = one intent to trade: a same-item/same-side chain of offers,
 * `placed â†’ â€¦ â†’ terminal`, with cancel-replace successions (a cancel then a re-place within
 * REPRICE_GAP) STITCHED into ONE campaign carrying a reprice list. Per campaign we record:
 *   placement ts/price Â· reprice count/steps Â· time-to-first-fill Â· time-to-complete (or the
 *   terminal state + filled fraction) Â· band percentile at placement (trailing-2h 5m band, the
 *   SAME basis as patientTargets) Â· 2h spread + limiting-side volume Â· realized net after tax
 *   where it closes a FIFO lot Â· the nearest PRIOR suggestion for the item.
 *
 * SCHEMA v2 (YS1, PLAN-YIELD) adds, per campaign: `stateAtFill` (band-pctl + regime + phase AS OF the
 * fill, via lib/range-position.mjs - reconstructed for EVERY fill, not just suggestion-matched ones, with
 * `reconstructed:false` honesty when the history is gone); the measured `holdTimeSec` (round-trip
 * buy->sell), `parkedSec` (rest before first fill, or whole lifetime if never filled), and
 * `velocityClass`; and `predicted` (posture/tripwire/fillWindowHrs/thesis - copied from the joined
 * suggestion, null on rows that predate YS2's forward logging - backfill can NEVER invent these).
 * Reconstruction now routes through `dedupeSnapshots` (was bypassed) so a snapshot re-emit can't
 * spawn a phantom campaign. Output stays derived + gitignored (outcomes.json).
 *
 * FIFO realized P/L reuses reconstruct.mjs matchTrades (NEVER re-implemented here); collapseOffers
 * gives the canonical offer boundaries. First-read purpose is SCHEMA VALIDATION, not conclusions:
 * the --report is honest about n and refuses per-cell summaries below the floor (process rule 4).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collapseOffers, matchTrades, dedupeSnapshots } from '../lib/reconstruct.mjs';
import { loadMapping, loadAll24h, loadHistBands } from '../lib/marketfetch.mjs';
import { loadHistState, bandPercentile } from '../lib/range-position.mjs';
import { velocityClass } from '../lib/velocity.mjs';
import { parkedStats } from '../lib/capital-utilization.mjs';
import { parseArgs, median } from '../lib/cli.mjs';
import { liqClassOf, readSuggestionLines } from '../lib/suggestlog.mjs';
import { fmtP, fmt, fmtTurn } from '../../js/money-format.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const FILLS = path.join(ROOT, 'fills.json');
const OUT = path.join(ROOT, 'outcomes.json');
// COD-3 — the /morning weekly descriptive-outcomes marker. `--report` stamps it; `--weekly-due` reads it
// so /morning can mechanically tell whether this week's weekly read already ran instead of asking Ben.
// Gitignored (under pipeline/.cache/, sibling of the market caches).
const WEEKLY_STAMP = path.join(HERE, '..', '.cache', 'last-weekly-report');

// --- tunable named constants (NOT magic numbers) ---------------------------------------------
const REPRICE_GAP = 20 * 60;        // s: a re-place within this of a cancel = same campaign (a reprice)
const SUGGEST_WINDOW = 6 * 3600;    // s: a suggestion older than this before placement is too stale to join
const MANUAL_SLOT = 8;              // coffer-manual.log slot (mobile / manual fills)
// --- --report cell floors (the numbers that GATE F1 â€” see FILLS-PIPELINE.md Â§10) --------------
const MIN_N_REPORT = 8;             // below this, a per-cell median/rate is noise â†’ suppressed in --report
const MIN_N_F1 = 30;               // below this per (percentile Ã— class Ã— regime) cell, F1 must NOT trust a curve
const MIN_CELLS_F1 = 5;            // and at least this many cells must clear MIN_N_F1 before F1 opens

const A = parseArgs(process.argv.slice(2));
const REPORT = !!A.report, NO_BANDS = !!A['no-bands'], JSON_OUT = !!A.json;
const WEEKLY_DUE = !!A['weekly-due'];   // COD-3: cheap check — is this week's weekly read due? (no rebuild)
const MIN_N = A['min-n'] != null ? +A['min-n'] : MIN_N_REPORT;
const BAND_HOURS = A['band-hours'] != null ? +A['band-hours'] : 2;

// COD-3 — the LOCAL Mon–Sun week key (that week's Monday date), so the weekly-read cadence is a mechanical
// same-week check, not "ask Ben if unsure". Local getters (the repo's rendered-times-are-local rule).
function weekKey(d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());   // local midnight of that day
  const dow = (x.getDay() + 6) % 7;                                 // 0=Mon … 6=Sun
  x.setDate(x.getDate() - dow);                                     // step back to Monday
  const p2 = n => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p2(x.getMonth() + 1)}-${p2(x.getDate())}`;
}
// --weekly-due — a cheap standalone check (NO rebuild): compares the last-report stamp's week to this
// week and prints `weekly-due: yes|no`. /morning §6 runs this instead of asking Ben whether it already ran.
if (WEEKLY_DUE) {
  let last = null;
  try { last = fs.readFileSync(WEEKLY_STAMP, 'utf8').trim() || null; } catch {}
  const cur = weekKey();
  const due = !last || weekKey(new Date(last)) !== cur;
  console.log(`weekly-due: ${due ? 'yes' : 'no'}${last ? ` (last weekly report ran ${last}${due ? '' : ' — same Mon–Sun week'})` : ' (no weekly report has ever run)'}`);
  process.exit(0);
}


// -------------------------------------------------------------------------------------------
// First-fill timing: collapseOffers loses intermediate event timing, so scan the raw events to
// stamp each offer's tsFirstFill (first event in its slot+item+type window with filled>0). Offers
// are contiguous non-overlapping per slot, so the (slot,item,type,tsâˆˆ[open,close]) match is unique.
function stampFirstFill(events, offers) {
  const evs = [...events].sort((a, b) => a.ts - b.ts);
  for (const o of offers) {
    o.tsFirstFill = null;
    for (const e of evs) {
      if (e.slot === o.slot && e.itemId === o.itemId && e.type === o.type &&
          e.ts >= o.tsOpen && e.ts <= o.tsClose && (e.filled || 0) > 0) { o.tsFirstFill = e.ts; break; }
    }
  }
}

// Group offers into campaigns (cancel-replace stitching). A completed offer, or a gap > REPRICE_GAP,
// ends the current campaign for that item+side; anything else is a reprice appended to it.
function groupCampaigns(offers) {
  const current = new Map();   // item:type -> in-progress campaign
  const camps = [];
  for (const o of [...offers].sort((a, b) => a.tsOpen - b.tsOpen)) {
    if (o.type === 'withdraw' || o.type === 'banked') continue;   // not a market flip intent
    const key = o.itemId + ':' + o.type;
    let c = current.get(key);
    if (c) {
      const prev = c.offers[c.offers.length - 1];
      if (prev.state === 'complete' || (o.tsOpen - prev.tsClose) > REPRICE_GAP) { camps.push(c); c = null; }
    }
    if (!c) { c = { itemId: o.itemId, type: o.type, offers: [] }; current.set(key, c); }
    c.offers.push(o);
  }
  for (const c of current.values()) camps.push(c);
  return camps.sort((a, b) => a.offers[0].tsOpen - b.offers[0].tsOpen);
}

// The nearest PRIOR suggestion for an item within SUGGEST_WINDOW of placement (null, never dropped).
function joinSuggestion(sugByItem, itemId, placementTs) {
  const list = sugByItem.get(itemId); if (!list) return null;
  let best = null;
  for (const s of list) {
    if (s.ts > placementTs) break;                       // list is ascending; past placement â†’ stop
    if (placementTs - s.ts <= SUGGEST_WINDOW) best = s;  // keep the latest within the window
  }
  if (!best) return null;
  return { ts: best.ts, script: best.script, mode: best.mode ?? null, verdict: best.verdict ?? null,
    quickBuy: best.quickBuy ?? null, optBuy: best.optBuy ?? null, quickSell: best.quickSell ?? null,
    optSell: best.optSell ?? null, mom: best.mom ?? null, regime: best.regime ?? null, class: best.class ?? null,
    // YS2 forward-enrichment fields (null on legacy rows that predate the enrichment - never fabricated):
    posture: best.posture ?? null, tripwire: best.tripwire ?? null, fillWindowHrs: best.fillWindowHrs ?? null,
    thesis: best.thesis ?? null, velocityClassPredicted: best.velocityClass ?? null,
    // RC (PLAN-REACHABILITY-CONSOLIDATION): did this read carry the five-way exit co-log? `reachable`
    // (the pressure band) is logged on EVERY co-logged read (held + discovery), so it's the universal
    // marker the readiness dashboard counts. Boolean only — the scorer reads the raw values off the
    // suggestion itself, not this projection.
    coLog: best.reachable != null,
    // Ring-3 readiness (PLAN-ESTIMATOR-HONEST-SELL): did this read co-log the FORWARD exit ("list at X")?
    // E2 enriched estConfLean (logged as `estConfidence`) with forwardPeak/forwardTrough/forwardConfidence,
    // so a row that carries estConfidence.forwardPeak is one the forward-vs-recency-vs-realized retro can
    // score (forward = estConfidence.forwardPeak, recency-fold = estSell, realized = the campaign's sell).
    // Boolean marker only, mirroring coLog — the scorer reads the raw forwardPeak/estSell off the suggestion.
    fwdLog: !!(best.estConfidence && best.estConfidence.forwardPeak != null),
    lagMin: Math.round((placementTs - best.ts) / 60) };
}

const pctBucket = p => p == null ? 'unknown'
  : p < 20 ? '0-20' : p < 40 ? '20-40' : p < 60 ? '40-60' : p < 80 ? '60-80' : '80-100';

// FIFO closed lots from the last build() (the money path — reused for the concentration read below,
// never re-derived). Set in build(); consumed by report(). Top-item share > this fraction prints the
// "per-item reads are ~one sample" caveat (process rule 4 — descriptive honesty on a concentrated set).
let CLOSED_LOTS = [];
const CONCENTRATION_CAVEAT = 0.40;

async function build() {
  if (!fs.existsSync(FILLS)) { console.error('fills.json not found at ' + FILLS); process.exit(1); }
  const events = (JSON.parse(fs.readFileSync(FILLS, 'utf8')).events || []);
  if (!events.length) { console.error('fills.json has no events.'); process.exit(1); }

  // reuse the canonical reconstruction: offers + FIFO closed lots (for realized P/L join by sellTs)
  // YS1: dedupeSnapshots FIRST — the same snapshot-re-emit dedupe reconstruct() applies (this path
  // used to bypass it, so a phantom terminal could spawn a phantom campaign; PLAN Discovered fix).
  const deduped = dedupeSnapshots(events);
  const offers = collapseOffers(deduped);
  stampFirstFill(deduped, offers);
  const { closed } = matchTrades(offers);   // FIFO â€” never re-implemented here
  CLOSED_LOTS = closed;                                       // expose for report()'s concentration read
  const realisedBySellTs = new Map();                        // sell offer tsOpen -> realised net after tax
  for (const t of closed) { if (t.withdrawn) continue; realisedBySellTs.set(t.sellTs, (realisedBySellTs.get(t.sellTs) || 0) + t.realised); }
  // YS1: round-trip hold (sellTs - buyTs) per closed lot, keyed by the sell offer tsOpen -> holdTimeSec
  const holdBySellTs = new Map();
  for (const t of closed) { if (t.withdrawn || t.buyTs == null || t.sellTs == null) continue;
    (holdBySellTs.get(t.sellTs) || holdBySellTs.set(t.sellTs, []).get(t.sellTs)).push(t.sellTs - t.buyTs); }

  const campaigns = groupCampaigns(offers);

  // suggestions ledger, ascending per item, for the nearest-prior join. SR1: read the ACTIVE
  // ledger + every monthly archive (readSuggestionLines) — after rotation the active root file
  // holds only the current month, so reading it alone would silently halve the F1 calibration set.
  const sugByItem = new Map();
  for (const line of readSuggestionLines()) {
    if (!line.trim()) continue;
    let s; try { s = JSON.parse(line); } catch { continue; }
    if (s.itemId == null || s.ts == null) continue;
    (sugByItem.get(s.itemId) || sugByItem.set(s.itemId, []).get(s.itemId)).push(s);
  }
  for (const list of sugByItem.values()) list.sort((a, b) => a.ts - b.ts);

  // current 24h volume â†’ liquidity class per item (honest caveat: CURRENT day, not at-placement â€”
  // an at-placement daily figure isn't in the historical endpoints; the 2h limiting volume below IS
  // at-placement and is recorded per campaign as the finer measure).
  const map = await loadMapping();
  let v24 = {};
  try { v24 = await loadAll24h(); } catch (e) { console.warn('(24h volume unavailable â€” liquidity class = unknown: ' + ((e && e.message) || e) + ')'); }
  const volDayOf = id => { const d = v24[id] || v24[String(id)]; return d ? Math.min(d.highPriceVolume || 0, d.lowPriceVolume || 0) : null; };

  // historical band at each placement (unless --no-bands). ONE batched fetch for all campaigns.
  let bands = null;
  if (!NO_BANDS) {
    const reqs = campaigns.map(c => ({ id: c.itemId, endUnix: c.offers[0].tsOpen }));
    process.stderr.write(`(fetching historical 2h bands for ${reqs.length} placements â€” this can take a moment; --no-bands to skip)\n`);
    try { bands = await loadHistBands(reqs, BAND_HOURS); }
    catch (e) { console.warn('(historical band fetch failed - band percentile = null: ' + ((e && e.message) || e) + ')'); bands = null; }
  }

  // YS1: market STATE AT FILL for EVERY campaign (band-pctl + regime + phase), anchored at the first
  // fill (or placement if never filled) - widens the base beyond the suggestion-matched subset.
  let states = null;
  if (!NO_BANDS) {
    const sreqs = campaigns.map(c => {
      const ff = c.offers.map(o => o.tsFirstFill).filter(t => t != null).sort((a, b) => a - b)[0];
      return { id: c.itemId, endUnix: ff ?? c.offers[0].tsOpen, price: c.offers[0].price };
    });
    try { states = await loadHistState(sreqs); }
    catch (e) { console.warn('(historical state fetch failed - stateAtFill = null: ' + ((e && e.message) || e) + ')'); states = null; }
  }

  const out = campaigns.map((c, idx) => {
    const first = c.offers[0], last = c.offers[c.offers.length - 1];
    const placementTs = first.tsOpen, placementPrice = first.price;
    const reprices = c.offers.slice(1).map(o => ({ ts: o.tsOpen, price: o.price }));
    const filledUnits = c.offers.reduce((s, o) => s + (o.filled || 0), 0);
    const targetQty = last.qty || c.offers.reduce((m, o) => Math.max(m, o.qty || 0), 0);
    const filledFraction = targetQty > 0 ? Math.min(1, filledUnits / targetQty) : null;
    const firstFillTs = c.offers.map(o => o.tsFirstFill).filter(t => t != null).sort((a, b) => a - b)[0] ?? null;
    const completeOffer = c.offers.find(o => o.state === 'complete');
    const tsComplete = completeOffer ? completeOffer.tsClose : null;
    const terminalState = last.state;
    const manual = c.offers.some(o => o.slot === MANUAL_SLOT);

    // band percentile at placement (where the placement price sat in the trailing-2h band)
    const b = bands ? bands[idx] : null;
    let bandLo = null, bandHi = null, bandPct = null, spread2h = null, limitVol2h = null, bandCovered = null;
    if (b) {
      bandLo = b.bandLo; bandHi = b.bandHi; bandCovered = b.covered;
      spread2h = (bandLo != null && bandHi != null) ? bandHi - bandLo : null;
      limitVol2h = Math.min(b.loVol, b.hiVol);
      bandPct = bandPercentile(placementPrice, bandLo, bandHi);   // raw float (logging); shared formula in range-position.mjs
    }

    // realized net after tax: sum FIFO closed lots whose sellTs is one of this (sell) campaign's offers
    let realised = null;
    if (c.type === 'sell') {
      realised = 0; let matched = false;
      for (const o of c.offers) if (realisedBySellTs.has(o.tsOpen)) { realised += realisedBySellTs.get(o.tsOpen); matched = true; }
      if (!matched) realised = null;   // an unmatched sell (pre-log inventory) â€” no fabricated profit
    }

    const volDay = volDayOf(c.itemId);
    // YS1 - measured velocity / parked primitives + fill-time state + predicted (copied from the join)
    const parkedSec = firstFillTs != null ? (firstFillTs - placementTs) : (last.tsClose - first.tsOpen);
    let holdTimeSec = null;
    if (c.type === 'sell') {
      const hs = [];
      for (const o of c.offers) { const arr = holdBySellTs.get(o.tsOpen); if (arr) hs.push(...arr); }
      if (hs.length) holdTimeSec = Math.round(median(hs));
    }
    const st = states ? states[idx] : null;
    const sug = joinSuggestion(sugByItem, c.itemId, placementTs);
    return {
      itemId: c.itemId, name: map.byId[c.itemId]?.name || ('#' + c.itemId), side: c.type, manual,
      placementTs, placementPrice, targetQty, filledUnits, filledFraction, terminalState,
      timeToFirstFill: firstFillTs != null ? firstFillTs - placementTs : null,
      timeToComplete: tsComplete != null ? tsComplete - placementTs : null,
      everFilled: filledUnits > 0,
      repriceCount: reprices.length, reprices,
      bandLo, bandHi, bandPct, bandCovered, spread2h, limitVol2h,
      volDayCurrent: volDay, liqClass: liqClassOf(volDay),
      realised,
      // YS1 additions (schema v2):
      stateAtFill: st ? { atTs: firstFillTs ?? placementTs, bandPct: st.bandPct, regime: st.regime,
        phase: st.phase, reconstructed: st.reconstructed, source: st.source } : null,
      holdTimeSec, parkedSec, velocityClass: velocityClass(holdTimeSec),
      suggestion: sug,
      predicted: sug ? { posture: sug.posture, tripwire: sug.tripwire, fillWindowHrs: sug.fillWindowHrs,
        thesis: sug.thesis, velocityClassPredicted: sug.velocityClassPredicted } : null,
    };
  });

  return { app: 'the-coffer-outcomes', version: 2, generatedAt: new Date().toISOString(),
    params: { bandHours: BAND_HOURS, repriceGapMin: REPRICE_GAP / 60, suggestWindowMin: SUGGEST_WINDOW / 60, noBands: NO_BANDS },
    campaigns: out };
}

// --- summary + --report --------------------------------------------------------------------
function summarize(o) {
  const c = o.campaigns;
  const filled = c.filter(x => x.everFilled), cancelled = c.filter(x => !x.everFilled);
  const ttf = filled.map(x => x.timeToFirstFill).filter(t => t != null);
  const sj = c.filter(x => x.suggestion).length;
  console.log(`# Outcomes â€” ${c.length} campaigns (rebuilt from fills.json)`);
  console.log(`  generatedAt ${o.generatedAt}`);
  console.log(`  sides: ${c.filter(x => x.side === 'buy').length} buy Â· ${c.filter(x => x.side === 'sell').length} sell   Â·   manual/mobile: ${c.filter(x => x.manual).length}`);
  console.log(`  filled: ${filled.length} (${c.length ? Math.round(filled.length / c.length * 100) : 0}%)  Â·  never filled: ${cancelled.length}  Â·  repriced at least once: ${c.filter(x => x.repriceCount > 0).length}`);
  console.log(`  time-to-first-fill: median ${ttf.length ? fmtTurn(median(ttf) / 3600) : 'â€”'} over n=${ttf.length}`);
  console.log(`  band percentile present: ${c.filter(x => x.bandPct != null).length}/${c.length}${o.params.noBands ? ' (--no-bands: skipped)' : ''}  Â·  suggestion joined: ${sj}/${c.length}`);
  const stated = c.filter(x => x.stateAtFill && x.stateAtFill.reconstructed).length;
  console.log(`  fill-time state reconstructed: ${stated}/${c.length}${o.params.noBands ? ' (--no-bands: skipped)' : ''}  Â·  velocity classed: ${c.filter(x => x.velocityClass && x.velocityClass !== 'n/a').length}/${c.length}`);
  const realisedC = c.filter(x => x.realised != null);
  console.log(`  realized (closed sell campaigns): n=${realisedC.length}, net ${realisedC.length ? (realisedC.reduce((s, x) => s + x.realised, 0) >= 0 ? '+' : '') + fmt(realisedC.reduce((s, x) => s + x.realised, 0)) : 'â€”'}`);
}

// fill-time distribution: band-percentile bucket (rows) Ã— liquidity class (cols), per side, with n
// per cell and MIN_N suppression. Cells: "median-ttf (n)" or "n<MIN_N" when too sparse.
function report(o) {
  const PCTS = ['0-20', '20-40', '40-60', '60-80', '80-100', 'unknown'];
  const CLASSES = ['thin', 'mid', 'liquid', 'unknown'];
  console.log(`\n# --report â€” fill-time distributions (median time-to-first-fill Â· n per cell; cells with n<${MIN_N} suppressed)`);
  console.log(`Bucketing: band percentile at placement (rows) Ã— current liquidity class (cols). Only FILLED campaigns count toward time; a low cell n is the expected first-read result (the dataset must accrue calendar time â€” that is why O1 starts now).`);

  for (const side of ['buy', 'sell']) {
    const rows = o.campaigns.filter(x => x.side === side && x.everFilled && x.timeToFirstFill != null);
    console.log(`\n## ${side.toUpperCase()} campaigns â€” n=${rows.length} filled with a fill-time`);
    // build cell map
    const cell = {};
    for (const r of rows) { const k = pctBucket(r.bandPct) + '|' + r.liqClass; (cell[k] = cell[k] || []).push(r.timeToFirstFill); }
    // header
    const head = ['pct\\class', ...CLASSES];
    const lines = [head, head.map(() => '---')];
    for (const p of PCTS) {
      const line = [p];
      for (const cl of CLASSES) {
        const arr = cell[p + '|' + cl] || [];
        line.push(arr.length === 0 ? 'Â·' : arr.length < MIN_N ? `n=${arr.length}<${MIN_N}` : `${fmtTurn(median(arr) / 3600)} (n=${arr.length})`);
      }
      lines.push(line);
    }
    console.log(lines.map(l => '| ' + l.join(' | ') + ' |').join('\n'));
    // fill-RATE by the same cells needs cancelled campaigns too (a cell's fill probability)
    const allSide = o.campaigns.filter(x => x.side === side);
    const clearedCells = PCTS.flatMap(p => CLASSES.map(cl => (cell[p + '|' + cl] || []).length)).filter(n => n >= MIN_N_F1).length;
    console.log(`side totals: ${allSide.length} campaigns, ${rows.length} with a fill-time; cells clearing the F1 floor (nâ‰¥${MIN_N_F1}): ${clearedCells}`);
  }

  // F1 gate verdict â€” the documented thresholds this chunk delivers
  const filledTimes = o.campaigns.filter(x => x.everFilled && x.timeToFirstFill != null);
  const cellCounts = {};
  // YS1: regime for the F1 cell now prefers the fill-time stateAtFill.regime (present for EVERY fill),
  // falling back to the joined suggestion's regime then 'noreg' - this widens the base beyond the
  // suggestion-matched subset (still gated; regime stays the first bucketing axis, the known confound).
  for (const r of filledTimes) {
    const reg = (r.stateAtFill && r.stateAtFill.regime && r.stateAtFill.regime !== 'unknown') ? r.stateAtFill.regime
      : (r.suggestion ? r.suggestion.regime : 'noreg');
    const k = r.side + '|' + pctBucket(r.bandPct) + '|' + r.liqClass + '|' + reg; cellCounts[k] = (cellCounts[k] || 0) + 1; }
  const f1Cells = Object.values(cellCounts).filter(n => n >= MIN_N_F1).length;
  console.log(`\n# F1 gate (documented thresholds)`);
  console.log(`  A per-cell fill-time/probability curve is trustworthy only at nâ‰¥${MIN_N_F1} per (side Ã— percentile Ã— class Ã— regime) cell, with â‰¥${MIN_CELLS_F1} such cells populated (bucket by regime FIRST â€” the known confound).`);
  console.log(`  Right now: ${f1Cells} cell(s) clear nâ‰¥${MIN_N_F1}. F1 ${f1Cells >= MIN_CELLS_F1 ? 'MAY open.' : `stays GATED (need â‰¥${MIN_CELLS_F1}). The pipeline + schema are validated; the sample is not yet large enough â€” let it accrue.`}`);
  // F1-gate progress (concise, reuses the same constants â€” never re-hardcode the thresholds)
  console.log(`  F1-gate progress: ${f1Cells}/${MIN_CELLS_F1} cells cleared (${f1Cells >= MIN_CELLS_F1 ? 'threshold met' : `${Math.max(0, MIN_CELLS_F1 - f1Cells)} more needed at nâ‰¥${MIN_N_F1}/cell`}).`);

  // --- Reachability head-to-head readiness (RC — PLAN-REACHABILITY-CONSOLIDATION) --------------
  // The SECOND gate, distinct from F1 above: the five-way exit-estimator co-log (reach·reachRelief·
  // asym·depth·pressure) is scored by the future aggregateReachability against the realized sell. This
  // is its ACCRUAL DASHBOARD — it counts the closed-sell round-trips whose nearest read carried the
  // co-log (marker: the joined suggestion's `coLog`), bucketed into the scorer's (side × class × regime)
  // cell, so we see WHEN the head-to-head is scorable without polling. The co-log clock started at RC-S1
  // (2026-07-15), so most historical rows won't carry it — that's expected, and it means this gate LAGS
  // F1. Reuses MIN_N (scorer floor) + MIN_N_F1 (robust) — no new thresholds. Honest bound: this is an
  // accrual COUNT off join-outcomes campaigns; aggregateReachability (a retrojoin sibling) scores the
  // exact per-cell |error| vs sellEach — build it once this line shows a scorable cell.
  const rcRows = o.campaigns.filter(x => x.side === 'sell' && x.realised != null && x.suggestion && x.suggestion.coLog);
  const rcCells = {};
  for (const r of rcRows) {
    const reg = (r.stateAtFill && r.stateAtFill.regime && r.stateAtFill.regime !== 'unknown') ? r.stateAtFill.regime
      : (r.suggestion ? r.suggestion.regime : 'noreg');
    const k = r.side + '|' + r.liqClass + '|' + reg; rcCells[k] = (rcCells[k] || 0) + 1; }
  const rcScorable = Object.values(rcCells).filter(n => n >= MIN_N).length;
  const rcRobust = Object.values(rcCells).filter(n => n >= MIN_N_F1).length;
  console.log(`\n# Reachability head-to-head (RC — the five-way exit-estimator retirement evidence)`);
  console.log(`  Closed sell round-trips whose read carried the co-log (reach·reachRelief·asym·depth·pressure): ${rcRows.length}`);
  console.log(`  Cells (side × class × regime) at n≥${MIN_N} (scorable): ${rcScorable} · at n≥${MIN_N_F1} (robust): ${rcRobust}`);
  console.log(`  → build+run aggregateReachability once a cell is SCORABLE; an RC1 retire needs a ROBUST cell sustained over a window. Status: ${rcScorable >= 1 ? 'SCORABLE — build the scorer' : 'gated — accruing (co-log clock started RC-S1)'}.`);

  // --- Ring-3 / rank-denoise readiness (PLAN-ESTIMATOR-HONEST-SELL, the display honest-sell redesign) --
  // The THIRD gate, distinct from F1 (fill-rate) and RC (five-way exit retire): promoting the drift-adjusted
  // FORWARD exit into estimateRank's net/pFill (the rank-level DENOISING lever that reaches screen.json for
  // every niche) is DEFERRED — gated on the forward exit proving it OUT-PREDICTS the recency reach-fold vs
  // the realized sell (and on a rank-level knife guard). This is that gate's ACCRUAL DASHBOARD: it counts
  // the closed-sell round-trips whose nearest read co-logged the forward exit (marker: fwdLog — E2's
  // estConfidence.forwardPeak), bucketed into the same (side × class × regime) cell, so we see WHEN the
  // forward-vs-recency-vs-realized head-to-head is scorable. The forward co-log clock started at the E1–E4
  // land (2026-07-22), so it LAGS both F1 and RC — most historical rows won't carry it, as expected. Reuses
  // MIN_N/MIN_N_F1 — no new thresholds. Honest bound: an accrual COUNT; the scorer (a retrojoin sibling,
  // aggregateForwardExit — designed, not built) computes the per-cell median |forward−realized| vs
  // |fold−realized| and only THEN does Ring-3's promotion clear its evidence gate (rule 4 — nothing off a
  // single week; the promotion is attended + needs the knife fallback too).
  const fwdRows = o.campaigns.filter(x => x.side === 'sell' && x.realised != null && x.suggestion && x.suggestion.fwdLog);
  const fwdCells = {};
  for (const r of fwdRows) {
    const reg = (r.stateAtFill && r.stateAtFill.regime && r.stateAtFill.regime !== 'unknown') ? r.stateAtFill.regime
      : (r.suggestion ? r.suggestion.regime : 'noreg');
    const k = r.side + '|' + r.liqClass + '|' + reg; fwdCells[k] = (fwdCells[k] || 0) + 1; }
  const fwdScorable = Object.values(fwdCells).filter(n => n >= MIN_N).length;
  const fwdRobust = Object.values(fwdCells).filter(n => n >= MIN_N_F1).length;
  console.log(`\n# Ring-3 rank-denoise (forward-vs-recency exit — the promotion evidence gate)`);
  console.log(`  Closed sell round-trips whose read co-logged the forward exit (estConfidence.forwardPeak): ${fwdRows.length}`);
  console.log(`  Cells (side × class × regime) at n≥${MIN_N} (scorable): ${fwdScorable} · at n≥${MIN_N_F1} (robust): ${fwdRobust}`);
  console.log(`  → build+run aggregateForwardExit once a cell is SCORABLE; Ring-3's promotion of the forward exit into estimateRank/screen.json needs a ROBUST cell where forward beats the recency-fold on |error| vs the realized sell, PLUS a rank-level knife guard. Status: ${fwdScorable >= 1 ? 'SCORABLE — build the scorer' : 'gated — accruing (forward co-log clock started 2026-07-22)'}.`);

  // #3 velocity + capital efficiency (YV1) â€” a DESCRIPTIVE read off the MEASURED velocityClass /
  // parkedSec YS1 records. Makes visible that yield leaks to idle capital + slow fills, not just bad
  // picks. Not a rate: a per-item velocity off a few lots is a LABEL (concentration caveat below).
  const ps = parkedStats(o.campaigns);
  const vd = ps.velocityDist;
  console.log(`\n# Velocity + capital efficiency (#3 â€” descriptive, measured; NOT a rate)`);
  console.log(`  velocity mix: ${['fast-cycler', 'mid', 'slow-hold', 'n/a'].map(k => `${k} ${vd[k] || 0}`).join(' Â· ')}`);
  console.log(`  bids: ${ps.nBids} (${ps.nFilledBids} filled, ${ps.nNeverFilled} never filled)  Â·  median time a filled bid sat before first fill: ${ps.medianParkedSec != null ? fmtTurn(ps.medianParkedSec / 3600) : 'â€”'}`);
  console.log(`  âš  yield leaks to idle capital + slow fills as much as to bad picks; treat a per-item velocity as a label, not a rate.`);

  // Concentration: how much of the closed-lot record is one item. When the top item dominates,
  // any "per-item" read is mostly one sample â€” print the caveat so the weekly read never oversells it.
  const realClosed = CLOSED_LOTS.filter(t => !t.withdrawn);
  console.log(`\n# Concentration`);
  if (!realClosed.length) { console.log(`  no closed lots yet â€” nothing to attribute per item.`); return; }
  const nameOf = id => (o.campaigns.find(c => c.itemId === id) || {}).name || ('#' + id);
  const byItem = new Map();   // itemId -> { lots, realised }
  for (const t of realClosed) { const e = byItem.get(t.itemId) || { lots: 0, realised: 0 }; e.lots++; e.realised += (t.realised || 0); byItem.set(t.itemId, e); }
  const [topId, top] = [...byItem.entries()].sort((a, b) => b[1].lots - a[1].lots)[0];
  const totalReal = realClosed.reduce((s, t) => s + (t.realised || 0), 0);
  const lotShare = top.lots / realClosed.length;
  const plShare = totalReal !== 0 ? top.realised / totalReal : null;
  console.log(`  top item by closed lots: ${nameOf(topId)} â€” ${top.lots}/${realClosed.length} lots (${Math.round(lotShare * 100)}%)${plShare != null ? `, ${Math.round(plShare * 100)}% of realised P/L` : ''} across ${byItem.size} item(s).`);
  if (lotShare > CONCENTRATION_CAVEAT)
    console.log(`  âš  top item is >${Math.round(CONCENTRATION_CAVEAT * 100)}% of closed lots â€” per-item reads are mostly ONE sample; treat per-item medians as anecdote, not a rate (process rule 4).`);
}

const o = await build();
if (JSON_OUT) { console.log(JSON.stringify(o.campaigns, null, 2)); }
else {
  fs.writeFileSync(OUT, JSON.stringify(o, null, 2) + '\n');
  summarize(o);
  if (REPORT) {
    report(o);
    // COD-3: stamp the weekly-read marker so `--weekly-due` (and /morning §6) knows this week ran. The
    // stamp is the descriptive-outcomes read's cadence memory — write is best-effort (never breaks --report).
    try { fs.mkdirSync(path.dirname(WEEKLY_STAMP), { recursive: true }); fs.writeFileSync(WEEKLY_STAMP, new Date().toISOString() + '\n'); } catch {}
  }
  console.log(`\n(wrote ${path.relative(ROOT, OUT)} â€” derived + gitignored; rebuild any time)`);
}
