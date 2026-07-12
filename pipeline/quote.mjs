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
import { computeQuote, QUOTE_HEADERS, isOvernightNow, phase, pressureText, askHeadroomText, rebidAdvice } from '../js/quotecore.js';
import { fmtP, fmt, fmtHour, tax } from '../js/format.js';
import { hourProfile, deriveDiurnalRange } from '../js/windowread.mjs';   // COD-4 — diurnal BID/ASK timing off the now-in-hand 1h series
import { trajectoryFrom1h } from './lib/richterm.mjs';   // COD-4 — warm trajectory off ts1h so trajectoryValidator FIRES on the explicit-ask surface
import { loadMapping, loadGuide, fetchItemInputs, loadSnapshot, loadDaily, loadAll24hWarm, fetchTsCached } from './lib/marketfetch.mjs';   // SF-3 — warm-only bulk /24h read (fetch-free class convergence); fetchTsCached — Proposal C's targeted 1h read
import { staleExitRead, STALE_EXIT_RECENT_FRAC } from './lib/staleexit.mjs';   // Proposal C — stale declared-exit auto-flag (inform-only)
import { readOpenPositions } from './lib/positions.mjs';
import { readOffersSnapshot, askFromSnapshot, bidFromSnapshot } from './lib/offers.mjs';   // P0 — offers.json book (the askFilling source quote lacked)
import { mdTable, stdCells } from './lib/cli.mjs';
import { loadModules, runProbes, logFirings } from './lib/modules.mjs';   // PM1 — probe-module system (per-item read surface); PM2 — firing log
import { logSuggestions, suggestionEntry, classAndSource } from './lib/suggestlog.mjs';   // SF-3 — classAndSource picks class + volSrc from a warm bulk map (or per-item fallback)
import { runValidators, flags, leanValidators } from '../js/validate.mjs';   // P2 — validator registry (reachValidator); quote NEVER hides a row, only annotates
import { buysByItem, limitWindow } from './lib/limits.mjs';   // LM1 — per-item 4h buy-limit window (regime-line + limitValidator)
import { termStructure } from '../js/termstructure.mjs';   // P3 — term structure / durable floor for floorValidator
import { loadGuideHistory, guideUpdates, guideAnchorModel, guideAnchorLine } from './lib/guideanchor.mjs';   // YP1 advisory
import { buildItemContext, renderHeldVerdict, renderPathLine, staleBookBanner } from './lib/context.mjs';   // P0 — the shared context chain + held-verdict renderer; P4b — the shared dominant-path line; COD-4 — the shared positions.json-age banner
import { loadState, ALERT_PERSIST_MS } from './lib/watchstate.mjs';   // P0 — READ the watch loop's cross-pass state (conviction timers; quote never writes it)
import { loadHoldThesis, pruneHoldThesis, thesisFor } from './lib/holdthesis.mjs';   // P0 — declared-hold-thesis (silences expected-underwater), READ-ONLY

const HERE = path.dirname(fileURLToPath(import.meta.url));
const POSITIONS = path.join(HERE, '..', 'positions.json');
const OFFERS = path.join(HERE, '..', 'offers.json');   // P0: flat live-offer snapshot (LW1); the book for askFilling
const GUIDE_HISTORY = path.join(HERE, '.guide-history.jsonl');   // YP1: watch.mjs writes it, we read it advisory
const WATCH_STATE = path.join(HERE, '.cache', 'watch-state.json');   // P0: gitignored cross-pass state written by watch.mjs (read-only here)
const HOLD_THESIS_PATH = path.join(HERE, '..', 'hold-thesis.json');   // P0: tracked declared-hold-thesis store (read-only here)
const FILLS = path.join(HERE, '..', 'fills.json');   // LM1: RuneLite-logged fills → per-item 4h buy-limit windows (no fetch)

// Proposal C: the stale declared-exit read needs the 1h series, which this booked-lots view doesn't
// otherwise fetch. The fetch is TARGETED (only lots with a declared numeric thesis exit — typically
// 0–2 items) and TTL-cached (same fetchTsCached mechanism as screen.mjs's Leg-B survivor fetch), so
// a re-run inside the TTL is fetch-free. Same 15-min TTL as screen's TS_TTL_1H.
const TS_TTL_1H_EXIT = 15 * 60 * 1000;

const args = process.argv.slice(2);
const POSITIONS_MODE = args.includes('--positions');
const tokens = args.filter(a => !a.startsWith('--'));

// LM1: per-item 4h buy-limit windows, built ONCE per run from the repo-root fills.json (local file, no
// fetch). Empty map (absent/unreadable) ⇒ every item has zero in-window buys ⇒ byte-identical output.
function loadBuysByItem() {
  try { return buysByItem(JSON.parse(fs.readFileSync(FILLS, 'utf8')).events || []); }
  catch { return new Map(); }
}
// LOCAL wall-clock HH:MM for a unix-SECONDS instant (repo rule: rendered times are local).
function hhmm(tsSec) { return tsSec == null ? '—' : new Date(tsSec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

function regimeLine(name, row, limit, win) {
  const r = row.regime;
  const drift = (r && r.ok) ? `${r.driftPct >= 0 ? '+' : ''}${r.driftPct.toFixed(1)}% (3d vs prior ~2wk median)` : 'insufficient history';
  // buy limit per ~4h window — already fetched (loadMapping); /overnight sizing reads it here. LM1: when
  // there ARE in-window logged buys, append what's been bought / left / when capacity next frees (local).
  let lim = limit != null ? ` · buy limit ${limit.toLocaleString()}/4h` : '';
  if (win && win.boughtInWindow > 0) {
    const left = win.remaining == null ? 'limit unknown' : `${win.remaining.toLocaleString()} left`;
    lim += ` (bought ${win.boughtInWindow.toLocaleString()} this window — ${left}, next frees ~${hhmm(win.nextFreeAt)})`;
  }
  // buy/sell pressure — realized trailing-24h flow imbalance (zero extra fetch; see the
  // SHORTCOMINGS comment in computeQuote — flow proxy, not an order book, lags intraday shifts)
  const pt = pressureText(row.pressure);
  const press = pt ? ` · pressure ${pt}` : '';
  const inv = row.ordered ? '' : '  ⚠ feed inversion — quote basis unreliable';
  // BOND note: bonds are tax-exempt but cost 10% of guide to make re-tradeable, so the net already
  // shown reflects sell − (buy + fee). Surface the fee so the tax-free-but-fee'd basis is explicit.
  const bnd = row.bond ? `  · bond: TAX-EXEMPT, but +${fmtP(row.retradeFee || 0)} retrade fee (10% guide) on buy — net = sell − (buy + fee)` : '';
  return `- ${name}: regime ${row.regimeLabel} ${drift}${lim}${press}${bnd}${inv}`;
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
  const buysByItemMap = loadBuysByItem();   // LM1: per-item 4h buy-limit windows (regime-line + limitValidator)
  await loadModules();   // PM1: discover pipeline/modules/*.mjs once (empty/absent dir → zero probes → byte-identical)
  // P3: read-only daily mids from whatever the Tier-1 archive already holds (noFetch → zero network,
  // no fetch-semantics change on this surface) → floorValidator's term structure. Cold archive → empty
  // series → floorValidator degrades to pass. Best-effort: any archive error leaves daily empty.
  let daily = {};
  try { ({ series: daily } = await loadDaily(28, 6, { noFetch: true })); } catch { daily = {}; }
  // SF-3: warm-ONLY bulk /24h map (null unless a recent screen wrote all24h.json within its TTL). When
  // warm, the logged liquidity `class` converges with screen.mjs (both read the bulk snapshot) and tags
  // volSrc:'bulk'; when cold it's null → classAndSource keeps the per-item volume, tags volSrc:'peritem'.
  // NEVER fetches — loadAll24hWarm is a pure file read; a 1-item ask never triggers the ~4000-item dump.
  const warm24h = loadAll24hWarm();
  const rows = [], lines = [], sugg = [], probeStrs = [];
  for (const { id, name } of resolved) {
    // COD-4: BUDGETED ts1h fetch (1–2 items/invocation — cheap). Fixes the A4 asymmetry: the explicit-ask
    // surface used to fetch NO 1h series, so reach/trajectory DEGRADED to pass on exactly the surface Ben
    // uses most ("how's X?"). Now the 1h series is in hand, so reachValidator FIRES (real window read) and
    // trajectoryValidator fires off the warm 1h-derived term structure, and we print the diurnal timing line.
    // SF-2 (2026-07-10): this ts1h fetch is UNCAPPED — the "1–2 items/invocation" budget is a usage
    // convention, NOT enforced, so `quote A B C … J` amplifies the 1h fetch count one-per-item linearly.
    // Fine at the intended handful; if large-batch quotes ever become routine, add a soft cap here
    // (skip the ts1h enrichment past N items, degrading reach/diurnal to "not fetched — batch too large").
    const inp = await fetchItemInputs(id, { ts1h: true });
    const row = computeQuote({ ...inp, id, guide: guide[id] ?? null, limit: map.byId[id]?.limit ?? null, asked: true });
    rows.push(stdCells(name, row));
    const limWin = limitWindow({ buys: buysByItemMap.get(id) || [], limit: map.byId[id]?.limit ?? null });
    lines.push(regimeLine(name, row, map.byId[id]?.limit ?? null, limWin));
    const gl = guideAnchorLine(guideAnchorModel(guideUpdates(hist, id)), guide[id] ?? null);
    if (gl) lines.push('  ' + gl);
    // P2/P3 validators. reachValidator scores the patient ask (optSell) against the reach window — NOW it
    // FIRES because ts1h is fetched above (COD-4). P3's floorValidator scores the patient BUY (optBuy) —
    // a per-item quote IS a buy-interest read — against the durable multi-week floor from the read-only
    // daily mids (cold archive → degrade); its .trajectory is OVERRIDDEN with the WARM 1h-derived shape
    // (trajectoryFrom1h, the same richterm.mjs helper screen.mjs uses) so trajectoryValidator fires too.
    // An explicit ask is NEVER hidden: a fired flag is a NOTE + logged; the table row is untouched.
    const ts = termStructure(daily[id]);
    const richTraj = trajectoryFrom1h(inp.ts1h);
    if (richTraj) ts.trajectory = richTraj;
    const vres = runValidators({
      market: { row },
      history: { termStructure: ts },
      intraday: {
        ts1h: inp.ts1h ?? null,
        ts5m: inp.ts5m ?? null,                          // DP1: dip-posture reads the 5m direction shape
        avgLow24: inp.vol24?.avgLowPrice ?? null,        // DP1: dip-depth reference (24h avg low)
        reach: row.optSell != null ? { side: 'ask', level: row.optSell } : null,
      },
      floor: { level: row.optBuy != null ? row.optBuy : null },
      limits: { window: limWin },   // LM1: a buy read — limitValidator flags an exhausted/near buy limit as a NOTE (never hides the row)
    });
    for (const f of flags(vres)) lines.push(`  ⚠ ${f.key}: ${f.reason}`);
    // COD-4: diurnal BID/ASK timing line — the SAME hourProfile/deriveDiurnalRange the screen's Diurnal
    // block uses, now feasible on quote because the 1h series is in hand. Support, not a gate; the bid is
    // stale-guarded to live (the Ghrazi lesson lives in deriveDiurnalRange). tax() nets the after-tax swing.
    const prof = hourProfile(inp.ts1h, { nights: 7 });
    const dr = prof ? deriveDiurnalRange(prof, { liveLo: row.quickBuy ?? null, liveHi: row.quickSell ?? null }) : null;
    if (dr && dr.bid != null && dr.ask != null) {
      const win = w => `${fmtHour(w.startH)}–${fmtHour(w.endH)}`;
      const net = Math.round(dr.ask - tax(dr.ask) - dr.bid);
      const roi = dr.bid ? (net / dr.bid * 100) : null;
      const trend = prof.trendDominates ? ' ⚠ trend-dominates → bid to live' : '';
      lines.push(`  ↳ diurnal: BID ${fmt(dr.bid)} (${dr.bidBasis}, dip ${win(dr.dipWindow)}) · ASK ${fmt(dr.ask)} (peak ${win(dr.peakWindow)})${net != null ? ` · ~${fmt(net)}/u${roi != null ? ` (${roi.toFixed(1)}%)` : ''}` : ''}${trend}`);
    }
    // Bar E ask-headroom (inform-only): the robust p90 shaved a TRADED in-band top off the quoted ask —
    // ladder up, don't relist down (the GE better-price rule makes the ladder cheap). Null unless trusted.
    const ah = askHeadroomText(row);
    if (ah) lines.push(`  ⤴ ask headroom: ${ah}`);
    const cs = classAndSource(row, id, warm24h);   // SF-3: class + volSrc ('bulk' when warm24h had it, else 'peritem')
    sugg.push(suggestionEntry(row, { itemId: id, cls: cs.cls, volSrc: cs.volSrc, verdict: null, posture: isOvernightNow() ? 'overnight' : 'active', validators: leanValidators(vres) }));  // per-item read has no verdict
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
  const { err, groups, openLots, ageMin } = readOpenPositions(POSITIONS);
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
  // SF-3: the bulk /24h map for the logged liquidity `class` (converges with screen.mjs). On the normal
  // path loadSnapshot ALREADY fetched the whole-market /24h (snap.v24) — reusing it adds ZERO fetch and
  // tags volSrc:'bulk'; on the degraded no-snapshot path fall back to the warm-only file read (still
  // fetch-free — never forces the bulk dump), null → classAndSource keeps per-item volume, volSrc:'peritem'.
  const warm24h = snap ? snap.v24 : loadAll24hWarm();
  // P0: the live book (offers.json) + the watch loop's cross-pass state + declared hold theses —
  // the inputs quote.mjs never read before, so it can now print HOLD — ask filling + conviction.
  const offers = readOffersSnapshot(OFFERS);
  const nowMs = Date.now();
  const priorState = loadState(WATCH_STATE);   // READ-ONLY: quote never persists (only the watch loop owns the write)
  const holdThesisStore = pruneHoldThesis(loadHoldThesis(HOLD_THESIS_PATH));
  const headers = [...QUOTE_HEADERS, 'Held@', 'Break-even', 'Verdict'];
  const hist = loadGuideHistory(GUIDE_HISTORY);   // YP1 advisory (gated → silent until history accrues)
  const buysByItemMap = loadBuysByItem();   // LM1: per-item 4h buy-limit windows (regime-line + limitValidator — accumulation awareness on a held lot)
  // COD-3: read-only daily mids (noFetch — zero network) → the multi-week trajectory SHAPE the rebid
  // advisory reads. Cold archive → { hasData:false } → trajectory 'unknown' → the friction-bar branch
  // (the arithmetic still governs). Best-effort: any archive error leaves it empty.
  let dailyPos = {};
  try { ({ series: dailyPos } = await loadDaily(28, 6, { noFetch: true })); } catch { dailyPos = {}; }
  const rows = [], lines = [], sugg = [], staleRisk = [], convLines = [], pathLines = [], rebidLines = [];
  for (const { itemId, qty, cost, avgCost, buyTs } of groups) {
    const name = map.byId[itemId]?.name || ('#' + itemId);
    const inp = await getInputs(itemId);
    const thesisEntry = thesisFor(holdThesisStore, itemId);   // Proposal C reads it too (declared exit)
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
        watchStatePrior: priorState['held:' + itemId] || null, nowMs, thesisEntry,
      },
      // P4b: the path stage — weigh the lot's thesis-paths + run the persistence gate off the SAME
      // shared watch-state entry watch.mjs persists. READ-ONLY here (P0 contract): quote renders the
      // armed/current path state but never saves it — only the watch loop writes the state file.
      paths: { watchStatePrior: priorState['held:' + itemId] || null, nowMs },
    });
    const row = ctx.market.row;
    const be = ctx.position.be;
    const v = renderHeldVerdict(ctx, { mode: 'compact' });   // the shared held-verdict renderer (P0)
    // P2 validators — the level we'd list the held lot at (patient band top). Set the reach candidate
    // on the built ctx (row now available) and run the registry. ts1h is NOT fetched here → degrade to
    // pass/no-data; a held lot is NEVER hidden, a fired flag is a NOTE + logged (verdict unchanged).
    ctx.intraday.reach = row.optSell != null ? { side: 'ask', level: row.optSell } : null;
    // LM1: buy-limit window overlay — accumulation awareness on a held lot (if you'd top up, how much
    // room is left this 4h window). limitValidator flags an exhausted/near limit as a NOTE (never hides).
    const limWin = limitWindow({ buys: buysByItemMap.get(itemId) || [], limit: map.byId[itemId]?.limit ?? null });
    ctx.limits = { window: limWin };
    const vres = runValidators(ctx);
    rows.push([...stdCells(name + ` ×${qty}`, row), fmtP(Math.round(avgCost)), fmtP(be), v]);
    lines.push(regimeLine(name, row, map.byId[itemId]?.limit ?? null, limWin));
    const gl = guideAnchorLine(guideAnchorModel(guideUpdates(hist, itemId)), guide[itemId] ?? null);
    if (gl) lines.push('  ' + gl);
    for (const f of flags(vres)) lines.push(`  ⚠ ${name} ${f.key}: ${f.reason}`);
    const cs = classAndSource(row, itemId, warm24h);   // SF-3: class + volSrc ('bulk' via snap.v24 on the normal path)
    sugg.push(suggestionEntry(row, { itemId, cls: cs.cls, volSrc: cs.volSrc, verdict: v, posture: isOvernightNow() ? 'overnight' : 'active', validators: leanValidators(vres) }));  // the emitted per-position verdict string
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
    // P4b: the shared dominant-path line (same renderPathLine watch.mjs's note block uses) — the
    // persistence-gated path read off the SAME state, so the two surfaces agree on the current path.
    const pl = renderPathLine(ctx);
    if (pl) pathLines.push(`  ${name}: ${pl}`);
    // Bar E ask-headroom (inform-only, PLAN Bar-E-signal): on a HELD lot the verdict's "list @ X" is a
    // FLOOR, not a ceiling — surface upside above it so the ask ladders UP, not down. Class 1 = the robust
    // p90 shaved a TRADED in-band top (askHeadroomText); Class 2 = a live breakup above the 2h band (the
    // EXISTING mom tell re-voiced as ladder guidance, no new number). Sibling line off the verdict (the
    // renderPathLine pattern) — the verdict string + momVerdict are UNTOUCHED (no APP_VERSION, no
    // byte-identity break); never an alert/reprice input. The lean askHeadroom field is logged via suggestionEntry.
    // Proposal C (2026-07-12): stale declared-exit auto-flag — INFORM-ONLY. When the hold thesis
    // declares a numeric exit, score it against the recent full-day reach history (lib/staleexit.mjs
    // — windowread's own windowStats/recencySplit/recentQuant, the reachValidator machinery). A
    // declared exit recent nights no longer print gets a NOTE naming the reachable level (the
    // 44.34m-Masori / 3.24m-Berserker miss). NEVER moves a quoted number, verdict, gate, or the
    // break-even floor; the thesis stays as declared until Ben re-declares it. The 1h fetch is
    // targeted (declared-exit lots only) + TTL-cached — see TS_TTL_1H_EXIT above.
    if (thesisEntry && typeof thesisEntry.exitPrice === 'number' && Number.isFinite(thesisEntry.exitPrice)) {
      let ts1hExit = inp.ts1h ?? null;                       // reuse a series if one is ever in hand
      if (!ts1hExit) { try { ts1hExit = await fetchTsCached(itemId, '1h', TS_TTL_1H_EXIT); } catch { ts1hExit = null; } }
      const se = staleExitRead({ ts1h: ts1hExit, exitLevel: thesisEntry.exitPrice, now: new Date(nowMs) });
      if (se && se.stale) {
        const reach = se.reachable != null ? `; recent reachable peak ~${fmtP(se.reachable)}` : '';
        lines.push(`  ⚠ ${name}: declared exit ${fmtP(thesisEntry.exitPrice)} looks STALE on reach — printed ${se.recentHit}/${se.recentDays} recent nights (${se.fullHit}/${se.fullN} over ~14d, bar <${Math.round(STALE_EXIT_RECENT_FRAC * 3)}/3 recent)${reach}. Inform-only (PLACEHOLDER threshold, n≈0; touched ≠ filled) — verdict/thesis unchanged; re-declare via thesis.mjs if you agree.`);
      }
    }
    const ahHeld = askHeadroomText(row);
    if (ahHeld) lines.push(`  ⤴ ${name}: ask headroom — ${ahHeld}`);
    else if (row.mom === 'breakup' && row.optSell != null) lines.push(`  ⤴ ${name}: list @ ${fmtP(row.optSell)} is a FLOOR, not a target — live broke +${(row.momPct * 100).toFixed(1)}% above the 2h band; step the ask above the live print (the GE better-price rule fills higher if depth is there). Inform-only, n=1.`);
    // COD-3: on a CUT-family verdict (CUT / CUT-CANDIDATE / LIST-TO-CLEAR), surface the cut-and-rebid
    // advisory so the agent stops re-deriving the friction arithmetic. TRAJECTORY-AWARE (Ben 2026-07-10):
    // rebidAdvice reads the multi-week shape — a KNIFE says don't rebid; an OSCILLATING faller says rebid
    // at the diurnal trough & sell the daily peak; else the friction bar (tax + ½-spread below the clear)
    // governs. diurnal is null here (this booked-lots view doesn't fetch the 1h series) → the oscillating
    // branch names the diurnal dip/peak qualitatively; the friction bar (the SOLID half) is always exact.
    // Inform-grade decision SUPPORT — it never overrides momVerdict.
    if (/^(CUT|LIST-TO-CLEAR)/.test(v) && row.quickSell != null) {
      const trajectory = (termStructure(dailyPos[itemId]) || {}).trajectory || null;
      const spread = (row.quickSell != null && row.quickBuy != null) ? row.quickSell - row.quickBuy : 0;
      const adv = rebidAdvice({ clear: row.quickSell, spread, trajectory, diurnal: null });
      rebidLines.push(`  ${name}: ${adv.why}`);
    }
    // S2 morning-staleness watch (informational only — the Verdict column above is UNCHANGED). A resting
    // SELL is at risk of being stale/underwater by morning if it can't clear at profit now (instabuy <
    // break-even) or the market is weakening (falling regime / live 2h breakdown).
    if (row.reliable && ((row.quickSell != null && row.quickSell < be) || row.falling || row.mom === 'breakdown')) staleRisk.push(name);
  }
  // O1 suggestions ledger: log the position verdicts at emit time, unconditionally.
  logSuggestions('quote', { mode: null, params: { positions: true } }, sugg);
  if (snap) { try { snap.archive.close(); } catch {} }   // P0: loadSnapshot leaves the archive open when it owns it
  console.log(`# Open positions vs market (${groups.length} items, ${openLots} lots)\n`);
  // COD-4: the SHARED stale-book banner (context.mjs staleBookBanner) — watch.mjs already prints this off
  // positions.json's mtime; quote.mjs --positions read the same file silently, so the surface Ben uses
  // most never warned when the book was stale (the A4 inversion). Now both surfaces word it identically.
  console.log(staleBookBanner(ageMin) + '\n');
  console.log(mdTable(headers, rows));
  console.log('');
  console.log(lines.join('\n'));
  if (convLines.length) {
    console.log('');
    console.log('Conviction (shared watch-state):');
    console.log(convLines.join('\n'));
  }
  if (pathLines.length) {
    console.log('');
    console.log('Paths (persistence-gated dominant per held lot — decision support, placeholder weights):');
    console.log(pathLines.join('\n'));
  }
  if (rebidLines.length) {
    console.log('');
    console.log('Rebid advisory (cut-and-rebid friction bar + multi-week trajectory — support, never overrides the verdict):');
    console.log(rebidLines.join('\n'));
  }
  if (isOvernightNow() && staleRisk.length) {
    console.log('');
    console.log(`ℹ Late-night: ${staleRisk.length} held position(s) may be stale/underwater by morning — re-verdict at the morning liquid window (${staleRisk.join(', ')}).`);
  }
}

if (POSITIONS_MODE) await runPositions();
else await runItems();
