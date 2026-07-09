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
import { computeQuote, QUOTE_HEADERS, isOvernightNow, phase } from '../js/quotecore.js';
import { fmtP } from '../js/format.js';
import { loadMapping, loadGuide, fetchItemInputs, loadSnapshot } from './lib/marketfetch.mjs';
import { readOpenPositions } from './lib/positions.mjs';
import { readOffersSnapshot, askFromSnapshot, bidFromSnapshot } from './lib/offers.mjs';   // P0 — offers.json book (the askFilling source quote lacked)
import { mdTable, stdCells } from './lib/cli.mjs';
import { loadModules, runProbes, logFirings } from './lib/modules.mjs';   // PM1 — probe-module system (per-item read surface); PM2 — firing log
import { logSuggestions, suggestionEntry, liqClass } from './lib/suggestlog.mjs';
import { runValidators, flags, leanValidators } from '../js/validate.mjs';   // P2 — validator registry (reachValidator); quote NEVER hides a row, only annotates
import { loadGuideHistory, guideUpdates, guideAnchorModel, guideAnchorLine } from './lib/guideanchor.mjs';   // YP1 advisory
import { buildItemContext, renderHeldVerdict } from './lib/context.mjs';   // P0 — the shared context chain + held-verdict renderer
import { loadState, ALERT_PERSIST_MS } from './lib/watchstate.mjs';   // P0 — READ the watch loop's cross-pass state (conviction timers; quote never writes it)
import { loadHoldThesis, pruneHoldThesis, thesisFor } from './lib/holdthesis.mjs';   // P0 — declared-hold-thesis (silences expected-underwater), READ-ONLY

const HERE = path.dirname(fileURLToPath(import.meta.url));
const POSITIONS = path.join(HERE, '..', 'positions.json');
const OFFERS = path.join(HERE, '..', 'offers.json');   // P0: flat live-offer snapshot (LW1); the book for askFilling
const GUIDE_HISTORY = path.join(HERE, '.guide-history.jsonl');   // YP1: watch.mjs writes it, we read it advisory
const WATCH_STATE = path.join(HERE, '.cache', 'watch-state.json');   // P0: gitignored cross-pass state written by watch.mjs (read-only here)
const HOLD_THESIS_PATH = path.join(HERE, '..', 'hold-thesis.json');   // P0: tracked declared-hold-thesis store (read-only here)

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
    // P2 validators — score the patient ask (optSell) against the reach window. quote does NOT fetch
    // the 1h series (fetchItemInputs default ts1h:false), so reachValidator DEGRADES to pass/no-data
    // here; the wiring is real (it fires the moment a caller carries ts1h). An explicit ask is NEVER
    // hidden — a fired flag is a NOTE + logged; the table row is untouched.
    const vres = runValidators({ intraday: { ts1h: inp.ts1h ?? null, reach: row.optSell != null ? { side: 'ask', level: row.optSell } : null } });
    for (const f of flags(vres)) lines.push(`  ⚠ ${f.key}: ${f.reason}`);
    sugg.push(suggestionEntry(row, { itemId: id, cls: liqClass(row), verdict: null, posture: isOvernightNow() ? 'overnight' : 'active', validators: leanValidators(vres) }));  // per-item read has no verdict
    // PM1: probes over this per-item read (OUTPUT-ONLY — no verdict/gate/rating input). ctx carries the
    // 24h avg (dip) + the phase trajectory (froth) + an advisory ask price (anchor). decant stays silent
    // here (no whole-market map on the per-item surface — see modules.mjs NEEDS).
    const ph = phase(inp.ts6h);
    const fired = runProbes(row, 'quote', {
      surface: 'quote', owned: false, id, name, thin: false,
      phase: ph, avgLow24: inp.vol24?.avgLowPrice ?? null, avgHigh24: inp.vol24?.avgHighPrice ?? null,
      series5m: inp.ts5m, series6h: inp.ts6h, map,
      price: row.optSell != null ? { side: 'ask', proposed: row.optSell } : undefined,
    });
    // PM2: record every firing to pipeline/modules/<module>.log (failure-safe, stdout-untouched).
    logFirings(fired, { surface: 'quote', id, name, quickBuy: row.quickBuy, quickSell: row.quickSell, guide: row.guide, regimeLabel: row.regimeLabel, phase: ph?.phase ?? null });
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

async function runPositions() {
  const { err, groups, openLots } = readOpenPositions(POSITIONS);
  if (err) { console.error('cannot read positions.json: ' + err); process.exit(1); }
  if (!groups.length) { console.log('No open positions in positions.json.'); return; }
  // P0: one loadSnapshot() per pass — the position surface's mapping/guide + the passive Tier-1
  // archive append (quote.mjs is, with watch.mjs, loadSnapshot's first consumer). Robust fallback:
  // if the archive/snapshot can't open, degrade to the plain loaders so the read never breaks.
  const ids = groups.map(g => g.itemId);
  let snap = null;
  try { snap = await loadSnapshot({ budgetIds: ids }); } catch { snap = null; }
  const map = snap ? snap.mapping : await loadMapping();
  const guide = snap ? snap.guide : await loadGuide();
  const getInputs = async id => (snap ? (await snap.series(id)) : null) ?? await fetchItemInputs(id);
  // P0: the live book (offers.json) + the watch loop's cross-pass state + declared hold theses —
  // the inputs quote.mjs never read before, so it can now print HOLD — ask filling + conviction.
  const offers = readOffersSnapshot(OFFERS);
  const nowMs = Date.now();
  const priorState = loadState(WATCH_STATE);   // READ-ONLY: quote never persists (only the watch loop owns the write)
  const holdThesisStore = pruneHoldThesis(loadHoldThesis(HOLD_THESIS_PATH));
  const headers = [...QUOTE_HEADERS, 'Held@', 'Break-even', 'Verdict'];
  const hist = loadGuideHistory(GUIDE_HISTORY);   // YP1 advisory (gated → silent until history accrues)
  const rows = [], lines = [], sugg = [], staleRisk = [], convLines = [];
  for (const { itemId, qty, cost, avgCost, buyTs } of groups) {
    const name = map.byId[itemId]?.name || ('#' + itemId);
    const inp = await getInputs(itemId);
    // Build the shared item context: identity → market → history → intraday → position. The position
    // stage folds in the live ask (askFilling), the cross-pass state (conviction), and any hold thesis.
    const ctx = buildItemContext({
      identity: { id: itemId, name },
      market: { inp, guide: guide[itemId] ?? null, limit: map.byId[itemId]?.limit ?? null, held: true, asked: true },
      history: { ts6h: inp.ts6h },
      intraday: { ts5m: inp.ts5m, ts6h: inp.ts6h, ts1h: inp.ts1h ?? null },
      position: {
        held: true, qty, avgCost, buyTs,
        ask: askFromSnapshot(offers, itemId), bid: bidFromSnapshot(offers, itemId),
        // support/cutTrigger need the 1h window series (not fetched on this booked-lots view) → null;
        // conviction still covers underwater/breakdown/thesis persistence off the shared state.
        watchStatePrior: priorState['held:' + itemId] || null, nowMs, thesisEntry: thesisFor(holdThesisStore, itemId),
      },
    });
    const row = ctx.market.row;
    const be = ctx.position.be;
    const v = renderHeldVerdict(ctx, { mode: 'compact' });   // the shared held-verdict renderer (P0)
    // P2 validators — the level we'd list the held lot at (patient band top). Set the reach candidate
    // on the built ctx (row now available) and run the registry. ts1h is NOT fetched here → degrade to
    // pass/no-data; a held lot is NEVER hidden, a fired flag is a NOTE + logged (verdict unchanged).
    ctx.intraday.reach = row.optSell != null ? { side: 'ask', level: row.optSell } : null;
    const vres = runValidators(ctx);
    rows.push([...stdCells(name + ` ×${qty}`, row), fmtP(Math.round(avgCost)), fmtP(be), v]);
    lines.push(regimeLine(name, row, map.byId[itemId]?.limit ?? null));
    const gl = guideAnchorLine(guideAnchorModel(guideUpdates(hist, itemId)), guide[itemId] ?? null);
    if (gl) lines.push('  ' + gl);
    for (const f of flags(vres)) lines.push(`  ⚠ ${name} ${f.key}: ${f.reason}`);
    sugg.push(suggestionEntry(row, { itemId, cls: liqClass(row), verdict: v, posture: isOvernightNow() ? 'overnight' : 'active', validators: leanValidators(vres) }));  // the emitted per-position verdict string
    // P0: conviction timers — surfaced as an informational line (the table's Verdict column is
    // unchanged). Mirrors watch.mjs's armed/escalated read off the SAME shared watch-state, so the
    // two surfaces agree on how long a lot has been underwater / whether an escalation has confirmed.
    const g = ctx.position.gate, d = ctx.position.deltas;
    const persistMin = Math.round(ALERT_PERSIST_MS / 60000);
    const heldMin = ms => Math.max(0, Math.round((ms || 0) / 60000));
    if (g && g.armed && g.reason === 'cut-candidate-armed')
      convLines.push(`  ${name}: CUT-CANDIDATE armed — underwater ~${heldMin(d && d.underwaterMs)}m through a liquid window; confirms once it persists ~${persistMin}m (per shared watch-state).`);
    else if (g && g.armed && g.reason === 'thesis-armed')
      convLines.push(`  ${name}: expected-underwater — silenced above declared tripwire ${fmtP(ctx.position.thesis?.tripwire)} (per hold thesis).`);
    else if (g && g.escalate && g.reason === 'cut-candidate')
      convLines.push(`  ${name}: CUT-CANDIDATE confirmed — underwater sustained ~${heldMin(d && d.underwaterMs)}m (≥ ${persistMin}m) through a liquid window.`);
    // S2 morning-staleness watch (informational only — the Verdict column above is UNCHANGED). A resting
    // SELL is at risk of being stale/underwater by morning if it can't clear at profit now (instabuy <
    // break-even) or the market is weakening (falling regime / live 2h breakdown).
    if (row.reliable && ((row.quickSell != null && row.quickSell < be) || row.falling || row.mom === 'breakdown')) staleRisk.push(name);
  }
  // O1 suggestions ledger: log the position verdicts at emit time, unconditionally.
  logSuggestions('quote', { mode: null, params: { positions: true } }, sugg);
  if (snap) { try { snap.archive.close(); } catch {} }   // P0: loadSnapshot leaves the archive open when it owns it
  console.log(`# Open positions vs market (${groups.length} items, ${openLots} lots)\n`);
  console.log(mdTable(headers, rows));
  console.log('');
  console.log(lines.join('\n'));
  if (convLines.length) {
    console.log('');
    console.log('Conviction (shared watch-state):');
    console.log(convLines.join('\n'));
  }
  if (isOvernightNow() && staleRisk.length) {
    console.log('');
    console.log(`ℹ Late-night: ${staleRisk.length} held position(s) may be stale/underwater by morning — re-verdict at the morning liquid window (${staleRisk.join(', ')}).`);
  }
}

if (POSITIONS_MODE) await runPositions();
else await runItems();
