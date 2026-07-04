#!/usr/bin/env node
/**
 * screen.mjs — opportunity screen. ONE command → a finished, RATED table per niche.
 *
 *   node pipeline/screen.mjs [--mode band|spread|rising|churn|all]
 *     [--floor 50] [--min-roi 1.5] [--min-price 0] [--max-price 45m] [--top 40]
 *     [--band-hours 2] [--min-active 6]
 *
 * The screen has ONE shared gate stack for every mode; --mode only swaps the step-3 EDGE
 * DEFINITION + ranking. Shared gates: two-sided liquidity (highPriceVolume>0 && lowPriceVolume>0,
 * limiting side ≥ --floor — the ghost-spread lesson), --min-price/--max-price on mid, top-N per-item
 * regime confirm via computeQuote, falling-regime items SILENTLY excluded (CLAUDE.md screen rule).
 *
 * Output (chunk 0 rework): ONE table PER niche (no more Tier A / Tier B split), each sorted by a
 * letter GRADE. The grade is a desirability heuristic — "which of these do I actually put offers in
 * for?" — that blends the realistic expected gp/day with a risk-quality multiplier (regime, momentum,
 * liquidity, capital, band confidence). See rating.mjs for the full rationale; the grade cutoffs +
 * factor weights there are PLACEHOLDERS pending the validation study. `Score gp/d` = the risk-adjusted
 * gp/day the grade is read off. `--mode all` runs all four niches and shares one per-item fetch cache
 * (items common to several niches are fetched once). A grade-distribution footer per table lets us
 * SEE whether the score separates best-from-good (if a batch clumps at one grade, the factors — not
 * the letter scale — need work).
 *
 * Modes (step-3 edge):
 *   band  (DEFAULT) — the crystal-teleport-seed niche: a liquid, regime-stable item with a wide
 *                     INTRADAY band. Edge = after-tax net of bandLo→bandHi from loadBands
 *                     (--band-hours, default 2); gate bandRoi ≥ --min-roi AND the band must be
 *                     TRADED (≥ --min-active two-sided 5m windows, not one spike).
 *   spread          — the ORIGINAL screen: after-tax ROI of the 24h-average spread (bludgeon-style).
 *   rising          — rising regime + mom ≠ breakdown, entry priced at the band low. Frothy.
 *   churn           — buy-limit-cycle commodities: volDay ≥ 2000 && limit > 0, tiny ROI accepted
 *                     (no --min-roi gate), the high-frequency small-margin niche.
 *   all             — run band, spread, rising, churn in sequence (shared fetch cache).
 *
 *   --mode dip is DESIGNED-NOT-BUILT (flat regime + mom↓ wick-bids). Out of scope here on purpose.
 *
 * Ranking: the fetch pool is still picked by realistic expected gp/day (expUnits/day = min(limit×6,
 * 10% × volDay); expGpDay = expUnits × the mode's net/u). The DISPLAYED table is then sorted by the
 * risk-adjusted grade/score from rating.mjs.
 *
 * ALL quote/tax/regime math is js/quotecore.js (imported); rating math is rating.mjs. This file only
 * fetches + gates + rates + renders.
 */
import { computeQuote, QUOTE_HEADERS } from '../js/quotecore.js';
import { tax, fmtP } from '../js/format.js';
import { loadMapping, loadGuide, loadAll24h, loadAllLatest, loadBands, fetchTs, sleep } from './marketfetch.mjs';
import { parseArgs, parseGp, mdTable, stdCells } from './cli.mjs';
import { rateItem, GRADE_CUTOFFS } from './rating.mjs';

// --- args ---
const A = parseArgs(process.argv.slice(2));
const MODES = ['band', 'spread', 'rising', 'churn'];
const MODE = A.mode != null && A.mode !== true ? String(A.mode).toLowerCase() : 'band';
if (MODE !== 'all' && !MODES.includes(MODE)) { console.error(`! unknown --mode "${A.mode}". Use one of: ${MODES.join(', ')}, all (or omit for band).`); process.exit(1); }
const FLOOR = A.floor != null ? +A.floor : 50;
const MIN_ROI = A['min-roi'] != null ? +A['min-roi'] : 1.5;
const MIN_PRICE = A['min-price'] != null ? parseGp(A['min-price']) : 0;
const MAX_PRICE = A['max-price'] != null ? parseGp(A['max-price']) : 45e6;
const TOP = A.top != null ? +A.top : 40;
const BAND_HOURS = A['band-hours'] != null ? +A['band-hours'] : 2;
const MIN_ACTIVE = A['min-active'] != null ? +A['min-active'] : 6;

const RUN_MODES = MODE === 'all' ? MODES : [MODE];
const NEED_BANDS = RUN_MODES.some(m => m !== 'spread');
const N_WIN = Math.max(1, Math.ceil(BAND_HOURS * 3600 / 300));   // 5m windows in the band (confidence denom)

// realistic expected units/day: buy-limit refreshes ~every 4h → 6 limits/day, capped at a 10% share
// of the limiting-side daily volume. Null limit → volume share only.
const expUnits = (limit, volDay) => { const vShare = 0.10 * (volDay || 0); return limit != null ? Math.min(limit * 6, vShare) : vShare; };

// --- gate stack + mode-specific step-3 edge, ranked by realistic gp/day (picks the fetch pool) ---
function gateCandidates(mode, { v24, map, bands }) {
  const cand = [];
  for (const idStr in v24) {
    const id = +idStr; const d = v24[idStr]; if (!d) continue;
    const hpv = d.highPriceVolume || 0, lpv = d.lowPriceVolume || 0;
    if (hpv <= 0 || lpv <= 0) continue;                 // two-sided liquidity gate (shared)
    const limitVol = Math.min(hpv, lpv);
    if (limitVol < FLOOR) continue;                     // limiting-side floor (shared)
    const avgHigh = d.avgHighPrice, avgLow = d.avgLowPrice;
    if (!avgHigh || !avgLow) continue;
    const mid = (avgHigh + avgLow) / 2;
    if (mid < MIN_PRICE || mid > MAX_PRICE) continue;   // price window (shared)
    const limit = map.byId[id]?.limit ?? null;

    // --- step 3: mode swaps ONLY the edge definition + gate here ---
    let modeNet, activeWin = null;
    if (mode === 'spread') {
      modeNet = (avgHigh - tax(avgHigh)) - avgLow;      // 24h-avg spread, after tax
      if ((modeNet / avgLow * 100) < MIN_ROI) continue;
    } else {
      // band / rising / churn all price the edge off the traded intraday band
      const b = bands[id]; if (!b || b.bandLo == null || b.bandHi == null) continue;
      if (b.active5m < MIN_ACTIVE) continue;            // band must be TRADED, not one spike
      activeWin = b.active5m;
      modeNet = (b.bandHi - tax(b.bandHi)) - b.bandLo;  // band low → band top, after tax
      if (mode === 'churn') {
        if (!(limitVol >= 2000 && limit != null && limit > 0)) continue;  // buy-limit-cycle commodity
        // tiny ROI accepted for churn — no --min-roi gate; volume does the work
      } else {
        if ((modeNet / b.bandLo * 100) < MIN_ROI) continue;   // band + rising need a real edge
      }
    }
    if (modeNet <= 0) continue;
    const expGpDay = Math.round(expUnits(limit, limitVol) * modeNet);
    cand.push({ id, limitVol, mid, limit, expGpDay, activeWin });
  }
  cand.sort((a, b) => b.expGpDay - a.expGpDay);         // realistic gp/day ranking picks the fetch pool
  return cand;
}

const PLAYBOOK = {
  band:   'Playbook: ladder BUYS at the band low, SELL at the band top; never list below break-even (ceil(buy/0.98)).',
  spread: 'Playbook: mid-liquidity wide-spread flips (bludgeon-style). Buy the 24h avg low, sell the avg high.',
  rising: 'Playbook: rising + not-breaking-down; enter at the band low. FROTHY — size small, these are mid-reprice moves.',
  churn:  'Playbook: high-frequency buy-limit-cycle commodities. Thin per-unit, volume does the work — buy every limit, flip fast.',
};
const HEADERS = ['Item', 'Grade', ...QUOTE_HEADERS.slice(1), 'Score gp/d'];

// grade-distribution footer, in GRADE_CUTOFFS (best→worst) order, present grades only
function gradeDist(dist) {
  const parts = GRADE_CUTOFFS.map(([g]) => g).filter(g => dist[g]).map(g => `${g}×${dist[g]}`);
  return parts.length ? parts.join('  ') : '—';
}

// render one niche: filter the fetched pool, rate, sort by grade/score, print table + footer
function renderMode(mode, { cand, survivors }, qcache, map) {
  const rows = [];
  const dist = {};
  for (const s of survivors) {
    const row = qcache.get(s.id);
    if (!row) continue;
    if (row.falling) continue;                              // screen rule: never surface fallers
    if (mode === 'rising' && !(row.rising && row.mom !== 'breakdown')) continue;  // rising-mode confirm
    const name = map.byId[s.id]?.name || ('#' + s.id);
    const r = rateItem({ row, expGpDay: s.expGpDay, activeWin: s.activeWin, nWin: s.activeWin != null ? N_WIN : null });
    const std = stdCells(name, row);                        // [item, guide, mid, buy, sell, net, vol, mom, regime]
    rows.push({ cells: [std[0], r.grade, ...std.slice(1), fmtP(r.score)], score: r.score });
    dist[r.grade] = (dist[r.grade] || 0) + 1;
  }
  rows.sort((a, b) => b.score - a.score);                   // display sorted by risk-adjusted grade/score

  console.log(`## ${mode.toUpperCase()} — ${rows.length} rated (from ${cand.length} gated, top ${survivors.length} fetched; fallers excluded)`);
  console.log(PLAYBOOK[mode]);
  console.log(mode !== 'spread' ? `(band basis: ${BAND_HOURS}h, ≥${MIN_ACTIVE} traded 5m windows)` : '(basis: 24h-average spread)');
  console.log(rows.length ? mdTable(HEADERS, rows.map(r => r.cells)) : '_none_');
  console.log(`Grades: ${gradeDist(dist)}\n`);
}

async function main() {
  const map = await loadMapping();
  const [v24, latest, guide] = [await loadAll24h(), await loadAllLatest(), await loadGuide()];
  const bands = NEED_BANDS ? await loadBands(BAND_HOURS) : null;
  const ctx = { v24, map, bands };

  // gate every mode we'll run, pick each mode's top-N fetch pool
  const gated = {};
  for (const m of RUN_MODES) {
    const cand = gateCandidates(m, ctx);
    gated[m] = { cand, survivors: cand.slice(0, TOP) };
  }

  // fetch each unique survivor's series ONCE (shared across modes in --mode all), quote it
  const ids = new Set();
  for (const m of RUN_MODES) for (const s of gated[m].survivors) ids.add(s.id);
  const qcache = new Map();
  for (const id of ids) {
    const ts5m = await fetchTs(id, '5m'); await sleep(70);
    const ts6h = await fetchTs(id, '6h'); await sleep(70);
    const lt = latest[id] || latest[String(id)] || null;
    const limit = map.byId[id]?.limit ?? null;
    qcache.set(id, computeQuote({ latest: lt, ts5m, ts6h, vol24: v24[id], guide: guide[id] ?? null, limit }));
  }

  console.log(`# Opportunity screen — mode ${MODE.toUpperCase()}, floor ${FLOOR}/d, min ROI ${MIN_ROI}%, ${MIN_PRICE.toLocaleString()}–${MAX_PRICE.toLocaleString()} gp, top ${TOP} fetched/niche`);
  console.log(`(${ids.size} unique items fetched; grade cutoffs are PLACEHOLDERS pending the validation study)\n`);
  for (const m of RUN_MODES) renderMode(m, gated[m], qcache, map);
}

await main();
