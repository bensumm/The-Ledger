/**
 * reconstruct.mjs — shared trade reconstruction for the fill pipeline.
 *
 * Pure functions extracted from sync-fills.mjs so both the pipeline AND the live
 * monitor (pipeline/commands/monitor-offers.mjs) reconstruct positions the SAME way — the monitor
 * runs this in-memory over the live log for a rock-solid, real-time held-position
 * count (no positions.json lag, no naive-log-sum double-count). No side effects.
 *
 * Pipeline: readLog -> parseJsonLine per line -> buildEvents -> reconstruct.
 */
import { createHash } from 'node:crypto';
import { tax } from '../../js/quotecore.js'; // the ONE tax impl (chunk 4.1)

/* ---------------------------------------------------------------------
 * ADAPTER — Exchange Logger (JSON mode) writes one line per slot-state
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
 * any CANCEL* to 'cancelled' — and that explicit line is the ONLY source of
 * a cancel: the old cancel-to-EMPTY inference was REMOVED 2026-07-05 (a
 * logout EMPTY-burst fabricated phantom cancels; see buildEvents() below
 * and FILLS-PIPELINE.md §10). parseJsonLine() here
 * only normalizes one line; it returns `{ empty: true }` markers for
 * EMPTY/unrecognized lines so the sequencer can see slot-clear events.
 *
 * Normalized trade event: { ts, type:'buy'|'sell',
 *   state:'placed'|'partial'|'complete'|'cancelled', itemId, slot,
 *   price, qty, filled, spent }
 * ------------------------------------------------------------------- */
export function pick(o, ...names) {
  for (const n of names) {
    if (o[n] !== undefined && o[n] !== null) return o[n];
    // case-insensitive fallback
    const k = Object.keys(o).find(k => k.toLowerCase() === n.toLowerCase());
    if (k !== undefined && o[k] !== null) return o[k];
  }
  return undefined;
}

export function normalizeStateStr(s) {
  s = String(s || '').toUpperCase();
  if (s.includes('CANCEL')) return 'cancelled'; // explicit CANCELLED_BUY/SELL states (confirmed live 2026-07-02)
  // WITHDRAWN (inventory taken for personal use) and BANKED (pre-owned stock entering the
  // flip flow) are one-shot synthetic manual events — treat as terminal 'complete' so
  // collapseOffers marks them done as single-line offers.
  if (s.includes('WITHDRAW') || s.includes('BANK')) return 'complete';
  if (s.includes('BOUGHT') || s.includes('SOLD') || s === 'COMPLETE' || s.includes('COMPLETED')) return 'complete';
  if (s.includes('BUYING') || s.includes('SELLING')) return 'partial'; // in-progress update; may be refined to 'placed' below
  return null;
}

export function parseTs(o) {
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
export function parseJsonLine(line) {
  line = line.trim();
  if (!line || line[0] !== '{') return null; // JSON mode expected; skip non-JSON (e.g. legacy TEXT lines)
  let o;
  try { o = JSON.parse(line); } catch { return null; }

  // Tombstone directive (see PLAN.md chunk 1.4): a REMOVE line targets an event id and, on
  // merge, deletes the matching event from fills.json even if already persisted. Returned as
  // a marker so the runner (sync-fills.mjs main()) can collect it; it carries no ts/slot of
  // its own. Non-runner consumers (monitor-offers.mjs) filter these markers out before buildEvents.
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

// Sequences raw per-line parses into final trade events. EMPTY lines are consumed as
// slot-boundary markers only — they NEVER derive an event.
//
// The cancel-to-EMPTY inference that used to live here (offer → EMPTY with no terminal ⇒
// retro-mark 'cancelled') was REMOVED 2026-07-05: a logout wrote an all-slots-EMPTY burst
// while four offers were live in-game, and the inference fabricated four phantom cancels
// (poisoning fills.json/positions.json — the "vanished offers" incident). A RUNNING plugin
// always writes an explicit terminal (BOUGHT/SOLD/CANCELLED_*) for a real event, so an
// EMPTY without one is never evidence of anything but "GE widgets not loaded". Plugin-OFF
// gaps are handled the honest way — manual injection / tombstones in coffer-manual.log —
// not by inferring events from absence. (P/L is unaffected by the removal: matchTrades
// only consumes filled>0 offers, and collapseOffers closes an offer on the next
// different-item event in the slot regardless of a 'cancelled' marking.)
export function buildEvents(rawLinesParsed) {
  const sorted = [...rawLinesParsed].sort((a, b) => a.ts - b.ts);
  const events = [];
  for (const r of sorted) {
    if (r.empty) continue;
    events.push(r);
  }
  for (const e of events) delete e.empty;
  return events;
}

// LH1 (2026-07-05): slot-state transition validator — the LOUD, conservative catch for the
// "impossible transition" artifact class (the 13:25:53/13:29:01 double-BOUGHT of a 17.4m item on
// slot 7, only one real). A GE slot is a state machine: a terminal event (BOUGHT/SOLD/CANCELLED_*)
// closes it, so a SECOND terminal on the same slot with NO intervening placement/progress line is
// IMPOSSIBLE unless the plugin re-emitted a stale slot state after a relog (visible as the
// simultaneous EMPTY burst on the OTHER slots at that second). Walking each GE slot's event
// subsequence in ts order, when a terminal follows a terminal on the same slot with nothing
// re-opening the slot between them:
//   - STRICTLY identical to the prior terminal (same item+type+qty+price+filled+spent, via
//     sameTerminal) ⇒ a provable re-emit: DROP it and console.warn LOUDLY (never silent; and,
//     because this runs at INGEST — next to buildEvents, before the fills.json merge — never
//     written into fills.json either).
//   - ANY field differs ⇒ a possible fast re-trade whose placement line we may just have missed:
//     WARN but KEEP (fail toward preserving data; a REMOVE tombstone stays the manual override for
//     anything the heuristic can't prove).
// Manual-log slots 8 (desktop/CLI) and 9 (mobile) are NOT GE-slot state machines — they carry
// independent one-shot lines (BANKED/WITHDRAWN/manual BOUGHT/SOLD) that legitimately repeat — so
// they are EXEMPT entirely. This is a SUPERSET of the derivation-layer dedupeSnapshots() (it also
// covers CANCELLED terminals and is loud); dedupeSnapshots() remains inside reconstruct() as the
// silent backstop that additionally cleans a phantom ALREADY persisted in an older fills.json (the
// merged set reconstruct() sees can still carry a pre-LH1 duplicate this ingest pass never re-reads).
// This does NOT resurrect the deleted cancel-to-EMPTY inference: EMPTY lines are already consumed by
// buildEvents() and never reach here, so absence is still never evidence — only two REAL terminals.
function isTerminalState(s) { return s === 'complete' || s === 'cancelled'; }
// `warn` (default true) controls the LOUD console.warn per suspect. The attended sync passes it
// true (the visible deliverable + a summary count); the frequently-re-run callers (the watch-log
// daemon, --local desk freshness, monitor's per-tick poll) pass it FALSE so months-old historical
// re-emits — re-seen on every whole-log re-read — don't spam a background terminal. The DROP itself
// is unconditional either way; only the chattiness is gated.
export function validateSlotTransitions(events, { warn = true } = {}) {
  const lastBySlot = new Map(); // GE slot -> last KEPT event on it (ts order)
  const kept = [], dropped = [];
  const iso = ts => new Date(ts * 1000).toISOString();
  for (const e of [...events].sort((a, b) => a.ts - b.ts)) {
    if (e.slot === 8 || e.slot === 9) { kept.push(e); continue; } // manual slots: no state machine
    const prev = lastBySlot.get(e.slot);
    if (isTerminalState(e.state) && prev && isTerminalState(prev.state)) {
      // two terminals in a row on this slot with nothing re-opening it between (a placement/progress
      // line would have replaced prev with a non-terminal) — the impossible transition.
      if (sameTerminal(prev, e)) {
        dropped.push({ event: e, priorTs: prev.ts });
        if (warn) console.warn(`⚠ suspected re-emit dropped: ${e.type.toUpperCase()} item ${e.itemId} qty ${e.qty} @${e.price} slot ${e.slot} at ${iso(e.ts)} — identical to the prior terminal at ${iso(prev.ts)}; a slot cannot close twice with no offer placed between.`);
        continue; // drop e; prev stays as this slot's last terminal
      }
      if (warn) console.warn(`⚠ same-slot terminal after a terminal with no placement between, fields DIFFER — KEEPING (not provably a phantom): ${e.type.toUpperCase()} item ${e.itemId} qty ${e.qty} @${e.price} slot ${e.slot} at ${iso(e.ts)} (prior: item ${prev.itemId} qty ${prev.qty} @${prev.price} at ${iso(prev.ts)}).`);
    }
    kept.push(e);
    lastBySlot.set(e.slot, e);
  }
  return { events: kept, dropped };
}

export const GE_TAX = tax; // 2% floored/item, capped 5m — re-export the shared impl (chunk 4.1)

// P1 (2026-07-05): snapshot-re-emission dedupe. RuneLite re-broadcasts every GE slot's current
// state on login / world-hop / GE-open (visible as a burst of simultaneous EMPTY lines for the
// idle slots), so a completed-but-uncollected offer re-logs its terminal (BOUGHT/SOLD) line and
// collapseOffers would read the second terminal as a SECOND trade — a phantom open lot on a
// duplicate BUY, a phantom orphan on a duplicate SELL (the 2026-07-04 soul/blowpipe/bludgeon
// incident, FILLS-PIPELINE.md §10). Discriminator: a GENUINE repeat trade always has a fresh
// BUYING/SELLING placement line between two terminals on the same slot; a re-emission never does.
// So, walking each slot's event subsequence in ts order, drop a terminal whose immediately-
// preceding same-slot event is an IDENTICAL terminal (same itemId/type + offer-size/price/
// cumulative-filled/cumulative-spent). A placement (or a differing terminal) between them makes
// the preceding slot-event a non-match, so the second terminal is kept. EMPTY lines for the OTHER
// slots in a login burst are already consumed by buildEvents() and belong to different slots, so
// they never count as an intervening placement for the traded slot. Runs at the DERIVATION layer
// (reconstruct below): with LH1 (2026-07-05) this is now the SILENT BACKSTOP — validateSlotTransitions()
// catches the same class LOUDLY at ingest (next to buildEvents, before the fills.json merge), so a
// FRESH re-emit no longer reaches fills.json at all. dedupeSnapshots() still runs here so a phantom
// ALREADY persisted in an older (pre-LH1) fills.json — which the ingest pass never re-reads — is
// still dropped from the derived positions.json. Both layers use the SAME sameTerminal() discriminator.
function sameTerminal(a, b) {
  return a.itemId === b.itemId && a.type === b.type && a.qty === b.qty &&
         a.price === b.price && a.filled === b.filled && a.spent === b.spent;
}
export function dedupeSnapshots(events) {
  const prevBySlot = new Map(); // slot -> last KEPT event for that slot (ts order)
  const out = [];
  for (const e of [...events].sort((a, b) => a.ts - b.ts)) {
    const prev = prevBySlot.get(e.slot);
    if (e.state === 'complete' && prev && prev.state === 'complete' && sameTerminal(prev, e)) {
      continue; // snapshot re-emission — drop, keep the earlier identical terminal as the slot's prev
    }
    out.push(e);
    prevBySlot.set(e.slot, e);
  }
  return out;
}

export function collapseOffers(events) {
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

export function matchTrades(offers) {
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

export function reconstruct(events) {
  // dedupeSnapshots first (P1): strip snapshot re-emissions before offers are collapsed, so a
  // phantom duplicate terminal never becomes a second offer. monitor-offers.mjs shares reconstruct(), so
  // its live held count gets the same fix. (join-outcomes.mjs calls collapseOffers/matchTrades directly
  // for campaign boundaries and does NOT go through here — see the Discovered note in PLAN.md.)
  const { closed, open, unmatched } = matchTrades(collapseOffers(dedupeSnapshots(events)));
  return { app: 'the-coffer-positions', version: 1, generatedAt: new Date().toISOString(), closed, open, unmatched };
}

export function eventId(e) {
  return createHash('sha1')
    .update([e.ts, e.slot, e.itemId, e.type, e.state, e.filled, e.spent].join('|'))
    .digest('hex').slice(0, 16);
}

// buildTombstonedEvents (ARCH-1) — the LIVE-LOG → tombstone-filtered event list, the shared home
// monitor-offers.mjs reconstructs its held book from. Parses raw JSON log lines (or pre-parsed markers),
// collects REMOVE tombstone targets, sequences via buildEvents, LH1-validates the slot machine,
// stamps each surviving event's content-hash id, then DROPS any event whose id was tombstoned — the
// same correction sync-fills.mjs applies inline (its ~lines 193-227) so both answer "what do I hold?"
// the same way. This is the LIVE-log reconstruction ONLY: it does NOT merge the fills.json archive
// (that + the age cutoff + the mobile source are sync's concern), so a tombstone targeting an event
// that has already rotated out of the source logs is a harmless no-op here. `warn` gates the LH1
// re-emit chatter (monitor passes false — a frequently-re-run poll shouldn't spam months-old dups).
export function buildTombstonedEvents(rawLines, { warn = false } = {}) {
  const parsed = rawLines.map(l => (typeof l === 'string' ? parseJsonLine(l) : l));
  const removeTargets = new Set();
  for (const r of parsed) if (r && r.remove) removeTargets.add(r.remove);
  const { events } = validateSlotTransitions(buildEvents(parsed.filter(r => r && r.remove === undefined)), { warn });
  for (const e of events) e.id = eventId(e);
  return events.filter(e => !removeTargets.has(e.id));
}
