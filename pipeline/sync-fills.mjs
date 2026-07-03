#!/usr/bin/env node
/**
 * sync-fills.mjs — The Coffer fill-data pipeline (Windows / RuneLite side)
 *
 * Reads Exchange Logger plugin output (.runelite/exchange-logger/*),
 * normalizes GE offer events into fills.json, commits and pushes to the
 * repo that GitHub Pages serves. The Coffer fetches fills.json same-origin.
 *
 * Usage:
 *   node sync-fills.mjs            manual run: parse -> merge -> new commit -> push
 *   node sync-fills.mjs --auto     scheduled run: same, but amends the previous
 *                                  commit (force-push) if it was itself an --auto
 *                                  commit, so Task Scheduler doesn't pile up a new
 *                                  commit every 15-30 min forever. Use this from
 *                                  Task Scheduler; use the no-flag form for one-off
 *                                  manual/Claude-driven syncs, which stay as their
 *                                  own distinct checkpoint commits.
 *   node sync-fills.mjs --probe    print first raw lines of each log file
 *                                  (use this ONCE to verify field mapping)
 *   node sync-fills.mjs --dry      parse + merge + report, no git push
 *   --log-dir <dir> / --repo-dir <dir>   override the source log dir / output
 *                                  repo dir — for isolated fixture tests only
 *                                  (never point a test at the real dirs).
 *
 * Manual-line vocabulary (coffer-manual.log, slot 8 — see PLAN.md chunk 1):
 *   BOUGHT / SOLD                  normal manual fills (add-manual-fill.mjs / the app)
 *   WITHDRAWN                      inventory taken for personal use — consumes open lots
 *                                  FIFO into closed rows with realised 0
 *   BANKED                         pre-owned inventory entering the flip flow at a
 *                                  declared basis (worth/qty); tagged banked:true
 *   {"state":"REMOVE","target":"<eventId>"}   tombstone: deletes that event id from the
 *                                  merged set, including events already persisted in
 *                                  fills.json (source-level corrections propagate).
 *
 * Design: idempotent. Every run re-reads all log files, normalizes, and
 * dedupes by a content-derived event id. No watermark state to corrupt.
 * Personal trade volume is small; simplicity beats incremental cleverness.
 */

import { readFileSync, readdirSync, writeFileSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { tax as GE_TAX } from '../js/quotecore.js'; // the ONE tax impl (chunk 4.1) — no private copy

/* ======================= CONFIG — edit these ======================= */
// --log-dir / --repo-dir overrides exist for isolated fixture tests (see the
// Acceptance block in PLAN.md chunk 1): point them at a temp dir so a test run
// never reads/writes Ben's real log or the live fills.json/positions.json.
function argVal(name){ const i = process.argv.indexOf(name); return (i >= 0 && i + 1 < process.argv.length) ? process.argv[i + 1] : undefined; }
const LOG_DIR   = argVal('--log-dir') || join(homedir(), '.runelite', 'exchange-logger'); // plugin output
const REPO_DIR  = argVal('--repo-dir') || 'C:\\dev\\The-Ledger';    // your git clone
const FILLS_REL = 'fills.json';                                    // raw event stream, repo-relative
const POSITIONS_REL = 'positions.json';                            // reconstructed trades/positions (app auto-populates Ledger from this)
const MAX_AGE_DAYS = 180;   // drop events older than this
const MAX_EVENTS   = 20000; // hard cap on stored events
const GIT_PUSH  = true;     // set false to stage commits without pushing
/* =================================================================== */

const args = new Set(process.argv.slice(2));
const PROBE = args.has('--probe'), DRY = args.has('--dry'), AUTO = args.has('--auto');
const AUTO_TRAILER = 'Auto-Fills-Sync: true'; // marks a commit as safe to amend-over on the next --auto run

/* ---------------------------------------------------------------------
 * ADAPTER — verified against a real log (2026-07-01, one buy + one
 * cancel). Exchange Logger (JSON mode) writes one line per slot-state
 * change, shaped like:
 *   {"date":"2026-07-01","time":"20:02:55","state":"BUYING","slot":3,
 *    "item":12695,"qty":0,"worth":0,"max":10,"offer":12600}
 * Field names are NOT what the schema calls them:
 *   item -> itemId, offer -> price, max -> qty (total offer size),
 *   qty -> filled (cumulative filled so far), worth -> spent (cumulative).
 * date+time are separate local-time strings, combined below.
 *
 * The plugin emits explicit "CANCELLED_BUY"/"CANCELLED_SELL" states
 * (confirmed against a live log 2026-07-02) — normalizeStateStr() maps
 * any CANCEL* to 'cancelled'. It can ALSO drop an offer straight to
 * state:"EMPTY" without a cancel line, so buildEvents() below keeps a
 * sequence-aware fallback: any slot event that never reached 'complete'
 * before the slot goes EMPTY (or a different item appears in the slot) is
 * retroactively marked 'cancelled'. Keep both paths. parseJsonLine() here
 * only normalizes one line; it returns `{ empty: true }` markers for
 * EMPTY/unrecognized lines so the sequencer can see slot-clear events.
 *
 * Normalized trade event: { ts, type:'buy'|'sell',
 *   state:'placed'|'partial'|'complete'|'cancelled', itemId, slot,
 *   price, qty, filled, spent }
 * ------------------------------------------------------------------- */
function pick(o, ...names) {
  for (const n of names) {
    if (o[n] !== undefined && o[n] !== null) return o[n];
    // case-insensitive fallback
    const k = Object.keys(o).find(k => k.toLowerCase() === n.toLowerCase());
    if (k !== undefined && o[k] !== null) return o[k];
  }
  return undefined;
}

function normalizeStateStr(s) {
  s = String(s || '').toUpperCase();
  if (s.includes('CANCEL')) return 'cancelled'; // explicit CANCELLED_BUY/SELL states (confirmed live 2026-07-02)
  // WITHDRAWN (inventory taken for personal use) and BANKED (pre-owned stock entering the
  // flip flow) are one-shot synthetic manual events — treat as terminal 'complete' so
  // collapseOffers marks them done and the cancel-inference sequencer leaves them alone.
  if (s.includes('WITHDRAW') || s.includes('BANK')) return 'complete';
  if (s.includes('BOUGHT') || s.includes('SOLD') || s === 'COMPLETE' || s.includes('COMPLETED')) return 'complete';
  if (s.includes('BUYING') || s.includes('SELLING')) return 'partial'; // in-progress update; may be refined to 'placed' below
  return null;
}

function parseTs(o) {
  const dateStr = pick(o, 'date');
  const timeStr = pick(o, 'time');
  if (dateStr && timeStr) {
    const t = Math.floor(Date.parse(`${dateStr}T${timeStr}`) / 1000);
    if (Number.isFinite(t)) return t;
  }
  let raw = pick(o, 'time', 'timestamp', 'date', 'dateTime');
  if (typeof raw === 'string') return Math.floor(Date.parse(raw) / 1000);
  if (typeof raw === 'number') return raw > 1e12 ? Math.floor(raw / 1000) : raw;
  return NaN;
}

// Parses one JSON log line. Returns null for garbage/non-JSON lines,
// { empty: true, ts, slot } for EMPTY/unrecognized slot states (needed
// by the sequencer to detect cancellations), or a full trade-event
// candidate { empty: false, ts, slot, type, state, itemId, price, qty,
// filled, spent } otherwise.
function parseJsonLine(line) {
  line = line.trim();
  if (!line || line[0] !== '{') return null; // JSON mode expected; skip non-JSON (e.g. legacy TEXT lines)
  let o;
  try { o = JSON.parse(line); } catch { return null; }

  // Tombstone directive (see PLAN.md chunk 1.4): a REMOVE line targets an event id and, on
  // merge, deletes the matching event from fills.json even if already persisted. Returned as
  // a marker so main() can collect it; it carries no ts/slot of its own.
  if (String(pick(o, 'state', 'status', 'offerState') ?? '').toUpperCase() === 'REMOVE') {
    return { remove: String(pick(o, 'target', 'id', 'event') ?? '') };
  }

  const ts = parseTs(o);
  if (!Number.isFinite(ts)) return null;
  const slot = Number(pick(o, 'slot'));

  const rawState = String(pick(o, 'state', 'status', 'offerState') ?? '').toUpperCase();
  const rawType = rawState;
  // 'withdraw'/'banked' are manual-only sides (WITHDRAWN removes inventory with no sale;
  // BANKED enters pre-owned inventory at a declared basis) — see matchTrades().
  const type = rawType.includes('WITHDRAW') ? 'withdraw'
             : rawType.includes('BANK') ? 'banked'
             : rawType.includes('BUY') || rawType.includes('BOUGHT') ? 'buy'
             : rawType.includes('SELL') || rawType.includes('SOLD') ? 'sell' : null;

  const itemId = Number(pick(o, 'itemId', 'item_id', 'id', 'item'));

  if (rawState === 'EMPTY' || !type || !Number.isFinite(itemId) || itemId === 0) {
    return { empty: true, ts, slot };
  }

  const filled = Number(pick(o, 'qty', 'quantitySold', 'qtySold', 'filled', 'sold')) || 0;
  let state = normalizeStateStr(rawState);
  if (state === 'partial' && filled === 0) state = 'placed'; // just placed, nothing filled yet

  return {
    empty: false,
    ts,
    slot,
    type,
    state,
    itemId,
    price:  Number(pick(o, 'offer', 'price', 'offerPrice', 'pricePerItem')) || 0, // offer price each
    qty:    Number(pick(o, 'max', 'quantity', 'totalQuantity', 'amount')) || 0,   // total offer size
    filled,                                                                       // cumulative filled
    spent:  Number(pick(o, 'worth', 'spent', 'totalSpent', 'total_price', 'value')) || 0 // cumulative gp
  };
}

// Sequences raw per-line parses into final trade events, resolving
// cancellations: if a slot's last trade event never reached 'complete'
// before the slot goes EMPTY (or a different item appears in the same
// slot), that last event is retroactively marked 'cancelled'.
function buildEvents(rawLinesParsed) {
  const sorted = [...rawLinesParsed].sort((a, b) => a.ts - b.ts);
  const lastBySlot = new Map(); // slot -> last trade event object (mutated in place)
  const events = [];
  for (const r of sorted) {
    const prev = lastBySlot.get(r.slot);
    const slotChangedItem = prev && !r.empty && r.itemId !== prev.itemId;
    if ((r.empty || slotChangedItem) && prev && prev.state !== 'complete' && prev.state !== 'cancelled') {
      prev.state = 'cancelled';
    }
    if (r.empty || slotChangedItem) lastBySlot.delete(r.slot);
    if (r.empty) continue;
    events.push(r);
    lastBySlot.set(r.slot, r);
  }
  for (const e of events) delete e.empty;
  return events;
}
/* ------------------------- end adapter ---------------------------- */

/* =================== position/trade reconstruction ==================
 * fills.json is a per-transition stream. To drive the app's Ledger we
 * reduce it twice:
 *   collapseOffers() — one row per OFFER (a contiguous slot+item+type run),
 *     carrying the final cumulative filled/spent. `spent` is GROSS (pre-tax,
 *     verified in FILLS-PIPELINE.md §5), so executed price-each = spent/filled.
 *   matchTrades() — FIFO-match buy fills against sell fills per item →
 *     closed trades (real prices, 2% tax, realized P/L after tax) + open lots
 *     (unsold inventory at real avg cost).
 * A sell with no matching buy lot means the buy predates logging (the log
 * started mid-stream) — we can't know its cost basis, so it goes to
 * `unmatched` (informational only), never a fabricated profit.
 * ================================================================== */
// GE_TAX is imported from js/quotecore.js (format.js `tax`) — see the import at the top.

function collapseOffers(events) {
  const cur = new Map(); // slot -> in-progress offer
  const offers = [];
  for (const e of [...events].sort((a, b) => a.ts - b.ts)) {
    let o = cur.get(e.slot);
    if (o && (o.done || o.itemId !== e.itemId || o.type !== e.type)) { offers.push(o); o = null; cur.delete(e.slot); }
    if (!o) { o = { slot: e.slot, itemId: e.itemId, type: e.type, price: e.price, qty: e.qty, tsOpen: e.ts, tsClose: e.ts, filled: 0, spent: 0, state: e.state, done: false }; cur.set(e.slot, o); }
    o.tsClose = e.ts; o.state = e.state;
    o.filled = Math.max(o.filled, e.filled || 0); o.spent = Math.max(o.spent, e.spent || 0); // cumulative -> final
    if (e.price) o.price = e.price; if (e.qty) o.qty = e.qty;
    if (e.state === 'complete' || e.state === 'cancelled') o.done = true;
  }
  for (const o of cur.values()) offers.push(o);
  return offers.sort((a, b) => a.tsOpen - b.tsOpen);
}

function matchTrades(offers) {
  const filled = offers.filter(o => o.filled > 0).sort((a, b) => a.tsOpen - b.tsOpen);
  const lots = new Map(); // itemId -> [{qty, each, ts}] FIFO queue of open buy lots
  const closed = [], unmatched = [];
  for (const o of filled) {
    const each = o.spent / o.filled; // actual executed gross price per item
    if (o.type === 'buy' || o.type === 'banked') {
      // BANKED = pre-owned stock committed to flipping at a declared basis (each). It enters
      // the FIFO queue exactly like a bought lot but carries banked:true so its eventual
      // realised P/L (and any leftover open position) stays distinguishable from cash buys.
      (lots.get(o.itemId) || lots.set(o.itemId, []).get(o.itemId)).push({ qty: o.filled, each, ts: o.tsOpen, banked: o.type === 'banked' });
    } else if (o.type === 'withdraw') {
      // WITHDRAWN = inventory taken for personal use: consume open lots FIFO into closed rows
      // flagged withdrawn:true with realised 0 (no sale, no proceeds). If nothing is open to
      // withdraw against, there's nothing to record — drop it silently (unlike a sell, a
      // withdrawal with no cost basis carries no information worth surfacing).
      let remain = o.filled; const q = lots.get(o.itemId) || [];
      while (remain > 0 && q.length) {
        const lot = q[0], take = Math.min(remain, lot.qty);
        closed.push({ itemId: o.itemId, qty: take, buyEach: Math.round(lot.each), sellEach: 0,
          tax: 0, realised: 0, withdrawn: true, banked: !!lot.banked, buyTs: lot.ts, sellTs: o.tsOpen });
        lot.qty -= take; remain -= take; if (lot.qty <= 0) q.shift();
      }
    } else { // sell — consume buy lots FIFO
      let remain = o.filled; const q = lots.get(o.itemId) || [];
      while (remain > 0 && q.length) {
        const lot = q[0], take = Math.min(remain, lot.qty), taxEach = GE_TAX(each);
        closed.push({ itemId: o.itemId, qty: take, buyEach: Math.round(lot.each), sellEach: Math.round(each),
          tax: taxEach * take, realised: Math.round(((each - taxEach) - lot.each) * take), banked: !!lot.banked, buyTs: lot.ts, sellTs: o.tsOpen });
        lot.qty -= take; remain -= take; if (lot.qty <= 0) q.shift();
      }
      if (remain > 0) unmatched.push({ itemId: o.itemId, qty: remain, sellEach: Math.round(each), tax: GE_TAX(each) * remain, sellTs: o.tsOpen });
    }
  }
  // remaining lots = open inventory; merge same item+price+origin lots into one position
  // (keep earliest buyTs). Banked and cash lots at the same price stay separate so the tag
  // survives.
  const openMap = new Map();
  for (const [itemId, q] of lots) for (const lot of q) {
    if (lot.qty <= 0) continue;
    const each = Math.round(lot.each), k = itemId + ':' + each + ':' + (lot.banked ? 'b' : ''), m = openMap.get(k);
    if (m) { m.qty += lot.qty; m.buyTs = Math.min(m.buyTs, lot.ts); }
    else openMap.set(k, lot.banked ? { itemId, qty: lot.qty, buyEach: each, buyTs: lot.ts, banked: true } : { itemId, qty: lot.qty, buyEach: each, buyTs: lot.ts });
  }
  const open = [...openMap.values()].sort((a, b) => a.buyTs - b.buyTs);
  return { closed, open, unmatched };
}

function reconstruct(events) {
  const { closed, open, unmatched } = matchTrades(collapseOffers(events));
  return { app: 'the-coffer-positions', version: 1, generatedAt: new Date().toISOString(), closed, open, unmatched };
}
function positionsSig(p) { return JSON.stringify({ closed: p.closed, open: p.open, unmatched: p.unmatched }); } // ignore generatedAt

function eventId(e) {
  return createHash('sha1')
    .update([e.ts, e.slot, e.itemId, e.type, e.state, e.filled, e.spent].join('|'))
    .digest('hex').slice(0, 16);
}

function readLogFiles() {
  if (!existsSync(LOG_DIR)) {
    console.error(`Log dir not found: ${LOG_DIR}\nIs the Exchange Logger plugin installed and has it logged at least one trade?`);
    process.exit(1);
  }
  return readdirSync(LOG_DIR)
    .filter(f => /\.(log|txt|json)$/i.test(f))
    .map(f => join(LOG_DIR, f))
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
}

function main() {
  const files = readLogFiles();
  if (!files.length) { console.log('No log files found in ' + LOG_DIR); return; }

  if (PROBE) {
    for (const f of files.slice(-3)) {
      console.log('\n=== ' + f + ' (last 10 lines) ===');
      const lines = readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).slice(-10);
      for (const l of lines) {
        console.log('RAW    :', l.slice(0, 300));
        console.log('PARSED :', JSON.stringify(parseJsonLine(l)));
      }
    }
    console.log('\nIf PARSED shows empty:true for real trade lines, or wrong itemId/price/qty/filled/spent, fix parseJsonLine()/pick() names to match RAW.');
    console.log('Note: cancellation is resolved across lines by buildEvents(), not visible per-line here — a cancelled offer\'s last line will show state:"partial"/"placed" here even though it ends up "cancelled" in fills.json.');
    return;
  }

  // parse everything
  let rawLines = 0, parsedLines = 0;
  const rawParsed = [];
  const removeTargets = new Set(); // event ids tombstoned by REMOVE lines (chunk 1.4)
  for (const f of files) {
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      rawLines++;
      const r = parseJsonLine(line);
      if (r && r.remove !== undefined) { if (r.remove) removeTargets.add(r.remove); continue; }
      if (r) { rawParsed.push(r); parsedLines++; }
    }
  }
  const events = buildEvents(rawParsed);
  const parsed = events.length;
  for (const e of events) e.id = eventId(e);

  // merge with existing fills.json (keeps events whose source logs rotated away)
  const fillsPath = join(REPO_DIR, FILLS_REL);
  let prior = [];
  if (existsSync(fillsPath)) {
    try { prior = JSON.parse(readFileSync(fillsPath, 'utf8')).events || []; }
    catch { console.warn('Existing fills.json unreadable — rebuilding from logs only.'); }
  }
  const byIdMap = new Map();
  for (const e of [...prior, ...events]) byIdMap.set(e.id, e);

  const cutoff = Math.floor(Date.now() / 1000) - MAX_AGE_DAYS * 86400;
  // Apply tombstones: a REMOVE line deletes its target event id from the merged set even if
  // that event was already persisted in fills.json (byIdMap seeded it from `prior`). Because
  // the REMOVE line itself lives on in coffer-manual.log, this stays idempotent across syncs —
  // a re-parsed source event is filtered out again every run.
  let merged = [...byIdMap.values()]
    .filter(e => e.ts >= cutoff && !removeTargets.has(e.id))
    .sort((a, b) => a.ts - b.ts);
  if (merged.length > MAX_EVENTS) merged = merged.slice(-MAX_EVENTS);
  if (removeTargets.size) console.log(`${removeTargets.size} tombstone target(s); ${[...byIdMap.values()].filter(e => removeTargets.has(e.id)).length} event(s) removed`);

  // Compare against prior *content* (events only), not the full JSON blob —
  // generatedAt always differs run-to-run, so comparing the whole blob would
  // make every run look "changed" and commit even with zero new trade
  // events. Both `merged` and `prior` are independently cutoff-filtered and
  // sorted the same way, so a real diff here means genuinely new/aged-out
  // events, not just a fresh timestamp.
  const eventsChanged = JSON.stringify(merged) !== JSON.stringify(prior);

  // reconstruct trades/positions from the full merged history
  const positionsPath = join(REPO_DIR, POSITIONS_REL);
  const pos = reconstruct(merged);
  let priorPosSig = null;
  if (existsSync(positionsPath)) { try { priorPosSig = positionsSig(JSON.parse(readFileSync(positionsPath, 'utf8'))); } catch { /* rebuild */ } }
  const positionsChanged = positionsSig(pos) !== priorPosSig;
  const changed = eventsChanged || positionsChanged;
  const realisedTotal = pos.closed.reduce((s, t) => s + t.realised, 0);

  console.log(`${files.length} log file(s), ${rawLines} lines (${parsedLines} valid trade line(s)), ${parsed} events after sequencing, ${merged.length} after merge${eventsChanged ? '' : ' (no change)'}`);
  console.log(`positions: ${pos.closed.length} closed lot(s) (realised ${realisedTotal >= 0 ? '+' : ''}${realisedTotal} after tax), ${pos.open.length} open, ${pos.unmatched.length} unmatched sell(s)${positionsChanged ? '' : ' (no change)'}`);
  if (DRY) {
    for (const e of merged) {
      console.log(`  ${new Date(e.ts * 1000).toISOString()} slot${e.slot} ${e.type} ${e.state} item=${e.itemId} price=${e.price} filled=${e.filled}/${e.qty} spent=${e.spent}`);
    }
    console.log('--- reconstructed ---');
    for (const t of pos.closed) console.log(t.withdrawn
      ? `  WITHDRAWN item=${t.itemId} qty=${t.qty} basis=${t.buyEach} (used, realised 0)`
      : `  CLOSED item=${t.itemId} qty=${t.qty} buy=${t.buyEach} sell=${t.sellEach} tax=${t.tax} realised=${t.realised >= 0 ? '+' : ''}${t.realised}${t.banked ? ' [banked basis]' : ''}`);
    for (const o of pos.open) console.log(`  OPEN   item=${o.itemId} qty=${o.qty} @ ${o.buyEach}${o.banked ? ' [banked]' : ''}`);
    for (const u of pos.unmatched) console.log(`  UNMATCHED SELL item=${u.itemId} qty=${u.qty} @ ${u.sellEach} (no logged buy — pre-log inventory)`);
    if (changed) console.log('[dry] would write + push');
    return;
  }
  if (!changed) return;

  if (eventsChanged) writeFileSync(fillsPath, JSON.stringify({
    app: 'the-coffer-fills', version: 1, generatedAt: new Date().toISOString(), events: merged
  }));
  if (positionsChanged) writeFileSync(positionsPath, JSON.stringify(pos));

  // commit + push
  //
  // --auto (Task Scheduler) runs collapse into a single rolling commit via
  // --amend + --force-with-lease, instead of piling up a new commit every
  // 15-30 min forever. This is only safe because we check the marker below:
  // we only amend when HEAD is itself a prior auto-sync commit (identified
  // by the AUTO_TRAILER footer), so a manual/Claude-driven commit always
  // starts a fresh chain rather than getting silently absorbed. Manual runs
  // (no --auto) never amend — every manual run is its own checkpoint.
  const git = cmd => execSync(`git ${cmd}`, { cwd: REPO_DIR, stdio: 'pipe' }).toString().trim();
  try {
    git(`add ${FILLS_REL} ${POSITIONS_REL}`);
    const status = git(`status --porcelain ${FILLS_REL} ${POSITIONS_REL}`);
    if (!status) { console.log('Nothing to commit.'); return; }

    const nowIso = new Date().toISOString().slice(0, 16) + 'Z';
    let amend = false, sinceIso = nowIso;
    if (AUTO) {
      let headMsg = '';
      try { headMsg = git('log -1 --pretty=%B'); } catch { /* no commits yet */ }
      const sinceMatch = headMsg.match(/Auto-Fills-Sync-Since:\s*(\S+)/);
      if (headMsg.includes(AUTO_TRAILER) && sinceMatch) {
        amend = true;
        sinceIso = sinceMatch[1];
      }
    }

    const summary = AUTO
      ? `fills: auto-sync ${amend ? `${sinceIso}–${nowIso}` : nowIso} (${merged.length} events)`
      : `fills: sync ${nowIso} (${merged.length} events)`;
    const message = AUTO ? `${summary}\n\n${AUTO_TRAILER}\nAuto-Fills-Sync-Since: ${sinceIso}` : summary;

    const tmpMsgFile = join(REPO_DIR, '.fills-commit-msg.tmp');
    writeFileSync(tmpMsgFile, message);
    try {
      git(`commit ${amend ? '--amend' : ''} -F "${tmpMsgFile}"`);
    } finally {
      unlinkSync(tmpMsgFile);
    }

    if (GIT_PUSH) {
      git(amend ? 'push --force-with-lease' : 'push');
      console.log(amend ? 'Amended + force-pushed.' : 'Pushed.');
    } else {
      console.log(`Committed${amend ? ' (amended)' : ''} (push disabled).`);
    }
  } catch (err) {
    console.error('Git step failed:', err.message);
    console.error('fills.json was written locally; resolve git manually or re-run.');
    process.exit(1);
  }
}

main();
