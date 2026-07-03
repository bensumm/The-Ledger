#!/usr/bin/env node
/**
 * screen.mjs — opportunity screen. ONE command, finished Tier A / Tier B table.
 *
 *   node pipeline/screen.mjs [--mode band|spread|rising|churn]
 *     [--floor 50] [--min-roi 1.5] [--min-price 0] [--max-price 45m] [--top 40]
 *     [--band-hours 2] [--min-active 6]
 *
 * The screen has ONE shared gate stack for every mode; --mode only swaps the step-3 EDGE
 * DEFINITION + ranking (chunk 9.2). Shared gates: two-sided liquidity (highPriceVolume>0 &&
 * lowPriceVolume>0, limiting side ≥ --floor — the ghost-spread lesson), --min-price/--max-price
 * on mid, top-N per-item regime confirm via computeQuote, falling-regime items SILENTLY excluded
 * (CLAUDE.md screen rule), grouped Tier A (stable) / Tier B (rising/unconfirmed — size small).
 *
 * Modes (step-3 edge):
 *   band  (DEFAULT) — the crystal-teleport-seed niche: a liquid, regime-stable item with a wide
 *                     INTRADAY band. Edge = after-tax net of bandLo→bandHi from loadBands
 *                     (--band-hours, default 2); gate bandRoi ≥ --min-roi AND the band must be
 *                     TRADED (≥ --min-active two-sided 5m windows, not one spike). Ladder buys at
 *                     the band low / sell at the band top, never below break-even.
 *   spread          — the ORIGINAL screen, renamed: after-tax ROI of the 24h-average spread. The
 *                     bludgeon-style wide-spread mid-liquidity flips. Kept as-is; it works.
 *   rising          — formalizes what the old ROI screen surfaced by accident: rising regime +
 *                     mom ≠ breakdown, entry priced at the band low. Always Tier B (frothy —
 *                     size small).
 *   churn           — buy-limit-cycle commodities: volDay ≥ 2000 && limit > 0, tiny ROI accepted
 *                     (no --min-roi gate), ranked purely by expected gp/day. The high-frequency
 *                     small-margin niche the ROI gate kills outright.
 *
 *   --mode dip is DESIGNED-NOT-BUILT (flat regime + mom↓ wick-bids): it INVERTS the "don't buy a
 *   breakdown" rule, so it needs live validation before shipping. Out of scope here on purpose.
 *
 * Ranking (chunk 9.3): every mode ranks by realistic expected gp/day, not raw ROI (raw ROI
 * over-ranks illiquid margins). expUnits/day = min(limit×6, 10% × volDay) [null limit → vol share
 * only]; expGpDay = expUnits × the mode's net/u. Surfaced as a TRAILING `Exp gp/d` column in this
 * script's output ONLY — the canonical 9-column table (QUOTE_HEADERS, app views, quote.mjs) is
 * untouched; this is a screen-side appendix, same pattern as the existing stdCells wrapper.
 *
 * ALL quote/tax/regime math is js/quotecore.js (imported). This file only fetches + gates + ranks.
 */
import { computeQuote, quoteCells, QUOTE_HEADERS } from '../js/quotecore.js';
import { tax, fmtP } from '../js/format.js';
import { loadMapping, loadGuide, loadAll24h, loadAllLatest, loadBands, fetchTs, sleep } from './marketfetch.mjs';

// --- args ---
const A = {};
for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith('--')) { const k = a.slice(2); const v = process.argv[i + 1]; if (v === undefined || v.startsWith('--')) A[k] = true; else { A[k] = v; i++; } } }
const parseGp = s => { const t = String(s).trim().toLowerCase().replace(/,/g, ''); const m = t.match(/^(\d+(?:\.\d+)?)\s*([kmb])?$/); if (!m) return NaN; const mult = m[2] === 'b' ? 1e9 : m[2] === 'm' ? 1e6 : m[2] === 'k' ? 1e3 : 1; return Math.round(parseFloat(m[1]) * mult); };
const MODES = ['band', 'spread', 'rising', 'churn'];
const MODE = A.mode != null && A.mode !== true ? String(A.mode).toLowerCase() : 'band';
if (!MODES.includes(MODE)) { console.error(`! unknown --mode "${A.mode}". Use one of: ${MODES.join(', ')} (or omit for band).`); process.exit(1); }
const FLOOR = A.floor != null ? +A.floor : 50;
const MIN_ROI = A['min-roi'] != null ? +A['min-roi'] : 1.5;
const MIN_PRICE = A['min-price'] != null ? parseGp(A['min-price']) : 0;
const MAX_PRICE = A['max-price'] != null ? parseGp(A['max-price']) : 45e6;
const TOP = A.top != null ? +A.top : 40;
const BAND_HOURS = A['band-hours'] != null ? +A['band-hours'] : 2;
const MIN_ACTIVE = A['min-active'] != null ? +A['min-active'] : 6;

const usesBands = MODE === 'band' || MODE === 'rising' || MODE === 'churn';

const mdTable = (headers, rows) => ['| ' + headers.join(' | ') + ' |', '| ' + headers.map(() => '---').join(' | ') + ' |', ...rows.map(r => '| ' + r.join(' | ') + ' |')].join('\n');
const stdCells = (name, row) => { const c = quoteCells(name, row); return [c.item, c.guide, c.mid, c.buy, c.sell, c.net, c.vol, c.mom, c.regime]; };
// realistic expected units/day (chunk 9.3): buy-limit refreshes ~every 4h → 6 limits/day, capped
// at a 10% share of the limiting-side daily volume. Null limit → volume share only.
const expUnits = (limit, volDay) => { const vShare = 0.10 * (volDay || 0); return limit != null ? Math.min(limit * 6, vShare) : vShare; };

async function main() {
  const map = await loadMapping();
  const [v24, latest, guide] = [await loadAll24h(), await loadAllLatest(), await loadGuide()];
  const bands = usesBands ? await loadBands(BAND_HOURS) : null;

  // ---- shared gate stack + mode-specific step-3 edge/gate + gp/day rank key ----
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
    let modeNet, modeRoi, entryPrice;
    if (MODE === 'spread') {
      entryPrice = avgLow;
      modeNet = (avgHigh - tax(avgHigh)) - avgLow;      // 24h-avg spread, after tax
      modeRoi = modeNet / avgLow * 100;
      if (modeRoi < MIN_ROI) continue;
    } else {
      // band / rising / churn all price the edge off the traded intraday band
      const b = bands[id]; if (!b || b.bandLo == null || b.bandHi == null) continue;
      if (b.active5m < MIN_ACTIVE) continue;            // band must be TRADED, not one spike
      entryPrice = b.bandLo;
      modeNet = (b.bandHi - tax(b.bandHi)) - b.bandLo;  // band low → band top, after tax
      modeRoi = modeNet / b.bandLo * 100;
      if (MODE === 'churn') {
        if (!(limitVol >= 2000 && limit != null && limit > 0)) continue;  // buy-limit-cycle commodity
        // tiny ROI accepted for churn — no --min-roi gate; ranked purely by gp/day
      } else {
        if (modeRoi < MIN_ROI) continue;               // band + rising need a real edge
      }
    }
    if (modeNet <= 0) continue;
    const expGpDay = Math.round(expUnits(limit, limitVol) * modeNet);
    cand.push({ id, limitVol, mid, limit, modeNet, modeRoi, entryPrice, expGpDay });
  }
  cand.sort((a, b) => b.expGpDay - a.expGpDay);          // realistic gp/day ranking (all modes)
  const survivors = cand.slice(0, TOP);

  // ---- per-survivor series ONLY (rate limits) → regime confirm + full quotecore row ----
  const tierA = [], tierB = [];
  for (const s of survivors) {
    const ts5m = await fetchTs(s.id, '5m'); await sleep(70);
    const ts6h = await fetchTs(s.id, '6h'); await sleep(70);
    const lt = latest[s.id] || latest[String(s.id)] || null;
    const row = computeQuote({ latest: lt, ts5m, ts6h, vol24: v24[s.id], guide: guide[s.id] ?? null, limit: s.limit });
    if (row.falling) continue;                            // screen rule: never surface fallers
    if (MODE === 'rising' && !(row.rising && row.mom !== 'breakdown')) continue;  // rising-mode confirm
    const name = map.byId[s.id]?.name || ('#' + s.id);
    const cells = [...stdCells(name, row), fmtP(s.expGpDay)];   // trailing Exp gp/d appendix column
    // rising mode → always Tier B (frothy). Else Tier A = confirmed stable, Tier B = rising/unconfirmed.
    const tierBits = MODE === 'rising' || !(row.regime && row.regime.ok) || row.rising;
    (tierBits ? tierB : tierA).push(cells);
  }

  const headers = [...QUOTE_HEADERS, 'Exp gp/d'];
  const playbook = {
    band:   'Playbook: ladder BUYS at the band low, SELL at the band top; never list below break-even (ceil(buy/0.98)).',
    spread: 'Playbook: mid-liquidity wide-spread flips (bludgeon-style). Buy the 24h avg low, sell the avg high.',
    rising: 'Playbook: rising + not-breaking-down; enter at the band low. FROTHY — size small, these are mid-reprice moves.',
    churn:  'Playbook: high-frequency buy-limit-cycle commodities. Thin per-unit, volume does the work — buy every limit, flip fast.'
  }[MODE];
  console.log(`# Opportunity screen — mode ${MODE.toUpperCase()}, floor ${FLOOR}/d, min ROI ${MIN_ROI}%, ${MIN_PRICE.toLocaleString()}–${MAX_PRICE.toLocaleString()} gp, top ${TOP} by exp gp/day`);
  if (usesBands) console.log(`(band basis: ${BAND_HOURS}h, ≥${MIN_ACTIVE} traded 5m windows)`);
  console.log(`(${survivors.length} survivors quoted from ${cand.length} that passed the gate + edge; falling-regime items excluded)`);
  console.log(playbook + '\n');
  console.log('## Tier A — stable regime');
  console.log(tierA.length ? mdTable(headers, tierA) : '_none_');
  console.log('\n## Tier B — recently repriced / unconfirmed regime (size small)');
  console.log(tierB.length ? mdTable(headers, tierB) : '_none_');
}

await main();
