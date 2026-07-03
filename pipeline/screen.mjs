#!/usr/bin/env node
/**
 * screen.mjs — opportunity screen. ONE command, finished Tier A / Tier B table.
 *
 *   node pipeline/screen.mjs [--floor 50] [--min-roi 1.5] [--max-price 45m] [--top 40]
 *
 * Pipeline:
 *   1. bulk /mapping + /24h + /latest (all cached ~10 min under pipeline/.cache/).
 *   2. two-sided liquidity gate: highPriceVolume>0 && lowPriceVolume>0, limiting side ≥ floor
 *      (the ghost-spread lesson — a one-sided /volumes count is not a tradable market).
 *   3. price ≤ max-price, coarse after-tax ROI ≥ min-roi (24h avg basis — a cheap pre-filter).
 *   4. rank by liquidity VALUE (limiting-side vol × mid) and keep the top-N ONLY.
 *   5. fetch 5m + 6h series for those survivors ONLY (rate limits) → computeQuote → band+regime.
 *   6. FALLING-regime items are silently excluded (CLAUDE.md screen rule). Output grouped
 *      Tier A (stable/flat regime) / Tier B (rising or unconfirmed regime — size small).
 *
 * ALL quote/tax/regime math is js/quotecore.js (imported). This file only fetches + ranks.
 */
import { computeQuote, quoteCells, QUOTE_HEADERS } from '../js/quotecore.js';
import { tax } from '../js/format.js';
import { loadMapping, loadGuide, loadAll24h, loadAllLatest, fetchTs, sleep } from './marketfetch.mjs';

// --- args ---
const A = {};
for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith('--')) { const k = a.slice(2); const v = process.argv[i + 1]; if (v === undefined || v.startsWith('--')) A[k] = true; else { A[k] = v; i++; } } }
const parseGp = s => { const t = String(s).trim().toLowerCase().replace(/,/g, ''); const m = t.match(/^(\d+(?:\.\d+)?)\s*([kmb])?$/); if (!m) return NaN; const mult = m[2] === 'b' ? 1e9 : m[2] === 'm' ? 1e6 : m[2] === 'k' ? 1e3 : 1; return Math.round(parseFloat(m[1]) * mult); };
const FLOOR = A.floor != null ? +A.floor : 50;
const MIN_ROI = A['min-roi'] != null ? +A['min-roi'] : 1.5;
const MAX_PRICE = A['max-price'] != null ? parseGp(A['max-price']) : 45e6;
const TOP = A.top != null ? +A.top : 40;

const mdTable = (headers, rows) => ['| ' + headers.join(' | ') + ' |', '| ' + headers.map(() => '---').join(' | ') + ' |', ...rows.map(r => '| ' + r.join(' | ') + ' |')].join('\n');
const stdCells = (name, row) => { const c = quoteCells(name, row); return [c.item, c.guide, c.mid, c.buy, c.sell, c.net, c.vol, c.regime]; };

async function main() {
  const map = await loadMapping();
  const [v24, latest, guide] = [await loadAll24h(), await loadAllLatest(), await loadGuide()];

  // gate + coarse pre-rank on bulk 24h data only (no per-item series yet)
  const cand = [];
  for (const idStr in v24) {
    const id = +idStr; const d = v24[idStr]; if (!d) continue;
    const hpv = d.highPriceVolume || 0, lpv = d.lowPriceVolume || 0;
    if (hpv <= 0 || lpv <= 0) continue;                 // two-sided liquidity gate
    const limitVol = Math.min(hpv, lpv);
    if (limitVol < FLOOR) continue;
    const avgHigh = d.avgHighPrice, avgLow = d.avgLowPrice;
    if (!avgHigh || !avgLow) continue;
    const mid = (avgHigh + avgLow) / 2;
    if (mid > MAX_PRICE) continue;
    const coarseNet = (avgHigh - tax(avgHigh)) - avgLow;   // after-tax, 24h avg basis
    const coarseRoi = coarseNet / avgLow * 100;
    if (coarseRoi < MIN_ROI) continue;
    cand.push({ id, limitVol, mid, liqValue: limitVol * mid });
  }
  cand.sort((a, b) => b.liqValue - a.liqValue);
  const survivors = cand.slice(0, TOP);

  // per-survivor series ONLY (rate limits) → full quotecore row
  const tierA = [], tierB = [];
  for (const s of survivors) {
    const ts5m = await fetchTs(s.id, '5m'); await sleep(70);
    const ts6h = await fetchTs(s.id, '6h'); await sleep(70);
    const lt = latest[s.id] || latest[String(s.id)] || null;
    const row = computeQuote({ latest: lt, ts5m, ts6h, vol24: v24[s.id], guide: guide[s.id] ?? null, limit: map.byId[s.id]?.limit ?? null });
    if (row.falling) continue;                            // screen rule: never surface fallers
    const name = map.byId[s.id]?.name || ('#' + s.id);
    const cells = stdCells(name, row);
    // Tier A = confirmed stable (flat regime). Tier B = rising OR regime unconfirmed (size small).
    (row.regime && row.regime.ok && !row.rising ? tierA : tierB).push(cells);
  }

  console.log(`# Opportunity screen — floor ${FLOOR}/d, min ROI ${MIN_ROI}%, ≤ ${MAX_PRICE.toLocaleString()} gp, top ${TOP} by liquidity`);
  console.log(`(${survivors.length} survivors quoted from ${cand.length} that passed the two-sided gate; falling-regime items excluded)\n`);
  console.log('## Tier A — stable regime');
  console.log(tierA.length ? mdTable(QUOTE_HEADERS, tierA) : '_none_');
  console.log('\n## Tier B — recently repriced / unconfirmed regime (size small)');
  console.log(tierB.length ? mdTable(QUOTE_HEADERS, tierB) : '_none_');
}

await main();
