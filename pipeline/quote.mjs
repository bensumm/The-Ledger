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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeQuote, QUOTE_HEADERS, breakEven, momVerdict, BIG_TICKET_GP } from '../js/quotecore.js';
import { fmtP } from '../js/format.js';
import { loadMapping, loadGuide, fetchLatest, fetchTs, fetch24hOne, sleep } from './marketfetch.mjs';
import { mdTable, stdCells } from './cli.mjs';
import { logSuggestions, suggestionEntry, liqClass } from './suggestlog.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const POSITIONS = path.join(HERE, '..', 'positions.json');

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

async function fetchInputs(id) {
  // small spacing keeps us polite across a multi-item ask
  const latest = await fetchLatest(id); await sleep(60);
  const ts5m = await fetchTs(id, '5m'); await sleep(60);
  const ts6h = await fetchTs(id, '6h'); await sleep(60);
  const vol24 = await fetch24hOne(id);
  return { latest, ts5m, ts6h, vol24 };
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
  const rows = [], lines = [], sugg = [];
  for (const { id, name } of resolved) {
    const inp = await fetchInputs(id);
    const row = computeQuote({ ...inp, guide: guide[id] ?? null, limit: map.byId[id]?.limit ?? null, asked: true });
    rows.push(stdCells(name, row));
    lines.push(regimeLine(name, row, map.byId[id]?.limit ?? null));
    sugg.push(suggestionEntry(row, { itemId: id, cls: liqClass(row), verdict: null }));  // per-item read has no verdict
  }
  // O1 suggestions ledger: log every emitted read at emit time, unconditionally (analytics only).
  logSuggestions('quote', { mode: null, params: { positions: false } }, sugg);
  if (!rows.length) process.exit(1);
  console.log(mdTable(QUOTE_HEADERS, rows));
  console.log('');
  console.log(lines.join('\n'));
}

/* verdict reuses the quotecore regime/trend flags on the row (no separate trend math).
   The precise 2h `mom` cut-trigger (chunk 6) runs FIRST via the SHARED momVerdict() — identical
   matrix to the app's reviewPositions — so a held breakdown escalates toward CUT / clear before
   the regime-only branches. lotValue = qty × avgCost (capital at risk). mom clean → fall through. */
function verdict(row, breakEven, lotValue, ts5m) {
  const instabuy = row.quickSell;         // what you'd clear at right now
  const mv = momVerdict(row, breakEven, lotValue, ts5m);
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
  let pos;
  try { pos = JSON.parse(fs.readFileSync(POSITIONS, 'utf8')); }
  catch (e) { console.error('cannot read positions.json: ' + (e && e.message || e)); process.exit(1); }
  const open = (pos.open || []).filter(l => l.qty > 0);
  if (!open.length) { console.log('No open positions in positions.json.'); return; }
  // group by itemId at weighted-avg cost
  const byItem = new Map();
  for (const l of open) {
    const g = byItem.get(l.itemId) || { qty: 0, cost: 0 };
    g.qty += l.qty; g.cost += l.qty * l.buyEach; byItem.set(l.itemId, g);
  }
  const map = await loadMapping();
  const guide = await loadGuide();
  const headers = [...QUOTE_HEADERS, 'Held@', 'Break-even', 'Verdict'];
  const rows = [], lines = [], sugg = [];
  for (const [itemId, g] of byItem) {
    const name = map.byId[itemId]?.name || ('#' + itemId);
    const avgCost = g.cost / g.qty;
    const be = breakEven(avgCost);
    const inp = await fetchInputs(itemId);
    const row = computeQuote({ ...inp, guide: guide[itemId] ?? null, limit: map.byId[itemId]?.limit ?? null, held: true, asked: true });
    const v = verdict(row, be, g.cost, inp.ts5m);
    rows.push([...stdCells(name + ` ×${g.qty}`, row), fmtP(Math.round(avgCost)), fmtP(be), v]);
    lines.push(regimeLine(name, row, map.byId[itemId]?.limit ?? null));
    sugg.push(suggestionEntry(row, { itemId, cls: liqClass(row), verdict: v }));  // the emitted per-position verdict string
  }
  // O1 suggestions ledger: log the position verdicts at emit time, unconditionally.
  logSuggestions('quote', { mode: null, params: { positions: true } }, sugg);
  console.log(`# Open positions vs market (${byItem.size} items, ${open.length} lots)\n`);
  console.log(mdTable(headers, rows));
  console.log('');
  console.log(lines.join('\n'));
}

if (POSITIONS_MODE) await runPositions();
else await runItems();
