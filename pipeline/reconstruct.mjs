/**
 * reconstruct.mjs — shared trade reconstruction for the fill pipeline.
 *
 * Pure functions extracted from sync-fills.mjs so both the pipeline AND the live
 * monitor (pipeline/monitor.mjs) reconstruct positions the SAME way — the monitor
 * runs this in-memory over the live log for a rock-solid, real-time held-position
 * count (no positions.json lag, no naive-log-sum double-count). No side effects.
 *
 * Pipeline: readLog -> parseJsonLine per line -> buildEvents -> reconstruct.
 */
import { createHash } from 'node:crypto';
import { tax } from '../js/quotecore.js'; // the ONE tax impl (chunk 4.1)

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

  const ts = parseTs(o);
  if (!Number.isFinite(ts)) return null;
  const slot = Number(pick(o, 'slot'));

  const rawState = String(pick(o, 'state', 'status', 'offerState') ?? '').toUpperCase();
  const rawType = rawState;
  const type = rawType.includes('BUY') || rawType.includes('BOUGHT') ? 'buy'
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
export function buildEvents(rawLinesParsed) {
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

export const GE_TAX = tax; // 2% floored/item, capped 5m — re-export the shared impl (chunk 4.1)

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
    if (o.type === 'buy') {
      (lots.get(o.itemId) || lots.set(o.itemId, []).get(o.itemId)).push({ qty: o.filled, each, ts: o.tsOpen });
    } else { // sell — consume buy lots FIFO
      let remain = o.filled; const q = lots.get(o.itemId) || [];
      while (remain > 0 && q.length) {
        const lot = q[0], take = Math.min(remain, lot.qty), taxEach = GE_TAX(each);
        closed.push({ itemId: o.itemId, qty: take, buyEach: Math.round(lot.each), sellEach: Math.round(each),
          tax: taxEach * take, realised: Math.round(((each - taxEach) - lot.each) * take), buyTs: lot.ts, sellTs: o.tsOpen });
        lot.qty -= take; remain -= take; if (lot.qty <= 0) q.shift();
      }
      if (remain > 0) unmatched.push({ itemId: o.itemId, qty: remain, sellEach: Math.round(each), tax: GE_TAX(each) * remain, sellTs: o.tsOpen });
    }
  }
  // remaining buy lots = open inventory; merge same item+price lots into one position (keep earliest buyTs)
  const openMap = new Map();
  for (const [itemId, q] of lots) for (const lot of q) {
    if (lot.qty <= 0) continue;
    const each = Math.round(lot.each), k = itemId + ':' + each, m = openMap.get(k);
    if (m) { m.qty += lot.qty; m.buyTs = Math.min(m.buyTs, lot.ts); }
    else openMap.set(k, { itemId, qty: lot.qty, buyEach: each, buyTs: lot.ts });
  }
  const open = [...openMap.values()].sort((a, b) => a.buyTs - b.buyTs);
  return { closed, open, unmatched };
}

export function reconstruct(events) {
  const { closed, open, unmatched } = matchTrades(collapseOffers(events));
  return { app: 'the-coffer-positions', version: 1, generatedAt: new Date().toISOString(), closed, open, unmatched };
}

export function eventId(e) {
  return createHash('sha1')
    .update([e.ts, e.slot, e.itemId, e.type, e.state, e.filled, e.spent].join('|'))
    .digest('hex').slice(0, 16);
}
