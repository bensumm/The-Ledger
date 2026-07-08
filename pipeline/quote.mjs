#!/usr/bin/env node
/**
 * quote.mjs — the canonical market read for a Claude session. ONE command, finished table.
 * NEVER hand-write a `node -e` fetch for a market read again — this is the workflow.
 *
 * Two modes:
 *   node pipeline/quote.mjs "Abyssal bludgeon" 23959 "Crystal seed" ...
 *       Per-item read: resolves each name/id, fetches latest/5m/6h/24h + GE guide, and
 *       prints the standard Quick/Optimistic market table (one combined table, one regime
 *       line per item).
 *   node pipeline/quote.mjs --positions
 *       Positions-vs-market: reads OPEN lots from repo-root positions.json, groups by item
 *       at weighted-avg cost, quotes each held item live, and prints the standard table
 *       PLUS Held@ / Break-even columns + a HOLD / list-at-X / CUT verdict per row.
 *
 * ALL quote/tax/regime math comes from js/quotecore.js (imported) — this file only fetches
 * and formats. The ordering invariant optBuy ≤ quickBuy ≤ quickSell ≤ optSell is guaranteed
 * by computeQuote; a ⚠ basis flag prints if a feed inversion ever breaks it.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeQuote, QUOTE_HEADERS, breakEven, momVerdict, BIG_TICKET_GP, isOvernightNow, phase } from '../js/quotecore.js';
import { fmtP } from '../js/format.js';
import { loadMapping, loadGuide, fetchItemInputs } from './lib/marketfetch.mjs';
import { readOpenPositions } from './lib/positions.mjs';
import { mdTable, stdCells } from './lib/cli.mjs';
import { loadModules, runProbes } from './lib/modules.mjs';   // PM1 — probe-module system (per-item read surface)
import { logSuggestions, suggestionEntry, liqClass } from './lib/suggestlog.mjs';
import { loadGuideHistory, guideUpdates, guideAnchorModel, guideAnchorLine } from './lib/guideanchor.mjs';   // YP1 advisory

const HERE = path.dirname(fileURLToPath(import.meta.url));
const POSITIONS = path.join(HERE, '..', 'positions.json');
const GUIDE_HISTORY = path.join(HERE, '.guide-history.jsonl');   // YP1: watch.mjs writes it, we read it advisory

const args = process.argv.slice(2);
const POSITIONS_MODE = args.includes('--positions');
const tokens = args.filter(a => !a.startsWith('--'));

function regimeLine(name, row, limit) {
  const r = row.regime;
  const drift = (r && r.ok) ? `${r.driftPct >= 0 ? '+' : ''}${r.driftPct.toFixed(1)}% (3d vs prior ~2wk median)` : 'insufficient history';
  // buy limit per ~4h window — already fetched (loadMapping); /overnight sizing reads it here
  const lim = limit != null ? ` · buy limit ${limit.toLocaleString()}/4h` : '';
  const inv = row.ordered ? '' : '  ⚠ feed inversion — quote basis unreliable';
  return `- ${name}: regime ${row.regimeLabel} ${drift}${lim}${inv}`;
}

async function runItems() {
  if (!tokens.length) { console.error('usage: node pipeline/quote.mjs "<item or id>" [...more]  |  node pipeline/quote.mjs --positions'); process.exit(1); }
  const map = await loadMapping();
  const guide = await loadGuide();
  const resolved = [];
  for (const t of tokens) {
    const hit = map.resolve(t);
    if (!hit) { console.error(`! no item named "${t}" — check spelling or pass a numeric id`); continue; }
    resolved.push(hit);
  }
  const hist = loadGuideHistory(GUIDE_HISTORY);   // YP1 advisory (gated → silent until history accrues)
  await loadModules();   // PM1: discover pipeline/modules/*.mjs once (empty/absent dir → zero probes → byte-identical)
  const rows = [], lines = [], sugg = [], probeStrs = [];
  for (const { id, name } of resolved) {
    const inp = await fetchItemInputs(id);
    const row = computeQuote({ ...inp, guide: guide[id] ?? null, limit: map.byId[id]?.limit ?? null, asked: true });
    rows.push(stdCells(name, row));
    lines.push(regimeLine(name, row, map.byId[id]?.limit ?? null));
    const gl = guideAnchorLine(guideAnchorModel(guideUpdates(hist, id)), guide[id] ?? null);
    if (gl) lines.push('  ' + gl);
    sugg.push(suggestionEntry(row, { itemId: id, cls: liqClass(row), verdict: null, posture: isOvernightNow() ? 'overnight' : 'active' }));  // per-item read has no verdict
    // PM1: probes over this per-item read (OUTPUT-ONLY — no verdict/gate/rating input). ctx carries the
    // 24h avg (dip) + the phase trajectory (froth) + an advisory ask price (anchor). decant stays silent
    // here (no whole-market map on the per-item surface — see modules.mjs NEEDS).
    const fired = runProbes(row, 'quote', {
      surface: 'quote', owned: false, id, name, thin: false,
      phase: phase(inp.ts6h), avgLow24: inp.vol24?.avgLowPrice ?? null, avgHigh24: inp.vol24?.avgHighPrice ?? null,
      series5m: inp.ts5m, series6h: inp.ts6h, map,
      price: row.optSell != null ? { side: 'ask', proposed: row.optSell } : undefined,
    });
    probeStrs.push(fired.map(f => f.tag).join(' · '));
  }
  // O1 suggestions ledger: log every emitted read at emit time, unconditionally (analytics only).
  logSuggestions('quote', { mode: null, params: { positions: false } }, sugg);
  if (!rows.length) process.exit(1);
  // PM1: append the `Probes` column ONLY when a probe fired (byte-identical table otherwise — the
  // removability guarantee). stdout-only; no app/publish path on the per-item quote surface.
  const anyProbe = probeStrs.some(Boolean);
  const headers = anyProbe ? [...QUOTE_HEADERS, 'Probes'] : QUOTE_HEADERS;
  const outRows = anyProbe ? rows.map((r, i) => [...r, { t: probeStrs[i], c: 'mini' }]) : rows;
  console.log(mdTable(headers, outRows));
  console.log('');
  console.log(lines.join('\n'));
}

/* verdict reuses the quotecore regime/trend flags on the row (no separate trend math).
   The precise 2h `mom` cut-trigger (chunk 6) runs FIRST via the SHARED momVerdict() — identical
   matrix to the app's reviewPositions — so a held breakdown escalates toward CUT / clear before
   the regime-only branches. lotValue = qty × avgCost (capital at risk). mom clean → fall through. */
function verdict(row, breakEven, lotValue, ts5m, buyTs) {
  const instabuy = row.quickSell;         // what you'd clear at right now
  // V3: pass the lot's buy timestamp so a fresh (<FRESH_HOURS) underwater lot isn't cut on the
  // instant read. askFilling is undefined here — quote.mjs has no live offer view (degrades fine).
  const mv = momVerdict(row, breakEven, lotValue, ts5m, undefined, { buyTs });
  if (mv) {
    const at = mv.listAt != null ? ` @ ${fmtP(mv.listAt)}` : '';
    // PLAN-3 gate-tree tags (each names the gate/evidence in one line).
    const tag = mv.action === 'NO_READ'       ? ` (unreliable: ${row.reliableReason} — no action, keep ask ≥ break-even)`
              : mv.action === 'DIURNAL_WATCH' ? ' (quiet-hour trough; dipped+recovered yesterday — hold ≥ break-even, re-check at a liquid hour)'
              : mv.action === 'SHOCK_WATCH'   ? ' (one-off shock not a bleed — hold one more cycle; cut on a fresh low)'
              : mv.gate === 'D'               ? ' (underwater through a liquid window — persistence, not the clock)'
              : mv.action === 'CUT'           ? ' (2h breakdown & underwater — free capital)'
              : mv.action === 'CLEAR'         ? (row.rising ? ` (2h breakdown vs uptrend; big-ticket ≥ ${BIG_TICKET_GP/1e6}m → clearing)` : ' (2h breakdown — bank it, don’t hold for the premium)')
              : mv.action === 'HOLD_WATCH'    ? ` (2h pullback vs uptrend on a sub-${BIG_TICKET_GP/1e6}m lot — may reabsorb)`
              : ' (2h breakup — patient on the sell, don’t sell into strength)';
    return `${mv.verdict}${at}${tag}`;
  }
  if (instabuy == null) return 'NO QUOTE';
  if (row.falling) {
    return instabuy >= breakEven
      ? `SELL @ ${fmtP(instabuy)} (falling — clear in profit)`
      : `CUT @ ${fmtP(instabuy)} (falling & underwater — free capital)`;
  }
  // stable / rising: hold and list at the patient optimistic sell if it clears break-even
  const listAt = (row.optSell != null && row.optSell >= breakEven) ? row.optSell
               : (instabuy >= breakEven ? instabuy : breakEven);
  if (listAt >= breakEven && (row.optSell != null && row.optSell >= breakEven)) return `HOLD — list @ ${fmtP(listAt)}`;
  if (instabuy >= breakEven) return `HOLD — list @ ${fmtP(instabuy)}`;
  return `HOLD — underwater, list ≥ ${fmtP(breakEven)} (break-even)`;
}

async function runPositions() {
  const { err, groups, openLots } = readOpenPositions(POSITIONS);
  if (err) { console.error('cannot read positions.json: ' + err); process.exit(1); }
  if (!groups.length) { console.log('No open positions in positions.json.'); return; }
  const map = await loadMapping();
  const guide = await loadGuide();
  const headers = [...QUOTE_HEADERS, 'Held@', 'Break-even', 'Verdict'];
  const hist = loadGuideHistory(GUIDE_HISTORY);   // YP1 advisory (gated → silent until history accrues)
  const rows = [], lines = [], sugg = [], staleRisk = [];
  for (const { itemId, qty, cost, avgCost, buyTs } of groups) {
    const name = map.byId[itemId]?.name || ('#' + itemId);
    const be = breakEven(avgCost);
    const inp = await fetchItemInputs(itemId);
    const row = computeQuote({ ...inp, guide: guide[itemId] ?? null, limit: map.byId[itemId]?.limit ?? null, held: true, asked: true });
    const v = verdict(row, be, cost, inp.ts5m, buyTs);
    rows.push([...stdCells(name + ` ×${qty}`, row), fmtP(Math.round(avgCost)), fmtP(be), v]);
    lines.push(regimeLine(name, row, map.byId[itemId]?.limit ?? null));
    const gl = guideAnchorLine(guideAnchorModel(guideUpdates(hist, itemId)), guide[itemId] ?? null);
    if (gl) lines.push('  ' + gl);
    sugg.push(suggestionEntry(row, { itemId, cls: liqClass(row), verdict: v, posture: isOvernightNow() ? 'overnight' : 'active' }));  // the emitted per-position verdict string
    // S2 morning-staleness watch (informational only — the Verdict column above is UNCHANGED). A resting
    // SELL is at risk of being stale/underwater by morning if it can't clear at profit now (instabuy <
    // break-even) or the market is weakening (falling regime / live 2h breakdown).
    if (row.reliable && ((row.quickSell != null && row.quickSell < be) || row.falling || row.mom === 'breakdown')) staleRisk.push(name);
  }
  // O1 suggestions ledger: log the position verdicts at emit time, unconditionally.
  logSuggestions('quote', { mode: null, params: { positions: true } }, sugg);
  console.log(`# Open positions vs market (${groups.length} items, ${openLots} lots)\n`);
  console.log(mdTable(headers, rows));
  console.log('');
  console.log(lines.join('\n'));
  if (isOvernightNow() && staleRisk.length) {
    console.log('');
    console.log(`ℹ Late-night: ${staleRisk.length} held position(s) may be stale/underwater by morning — re-verdict at the morning liquid window (${staleRisk.join(', ')}).`);
  }
}

if (POSITIONS_MODE) await runPositions();
else await runItems();
