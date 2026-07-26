/* ownedledger.mjs — RF0: the owned-item registry store + the pure owned-qty fold (PLAN-REVERSE-FLIP).
 *
 * The problem it solves. Reverse-flip harvests items Ben ALREADY OWNS (personal-use gear, long-held
 * boss drops, a flip-pipeline hold he isn't ready to fully exit): sell into the peak, rebuy at the dip,
 * capital-free. To surface those candidates the tool needs to know WHAT is owned and HOW MANY — and
 * that ownership number must go DOWN when a reverse-flip sell fills and back UP when the rebuy fills,
 * with ZERO reverse-flip-specific logic (a sell is a sell, a buy is a buy).
 *
 * Two feeds, one registry (Rulings §3):
 *   - one-time curated SEED (hand-typed / bank-export paste) for pre-log ownership, AND
 *   - CAPTURE-ON-BUY: the exchange logger already sees every real BUY; a big-ticket small-qty buy the
 *     registry doesn't recognize gets queued for a one-line classify prompt (foldPendingBuys).
 *
 * Store shape (owned-items.json, tracked repo root — mirrors ignored-items.json's {_doc, items:[]}):
 *   { _doc, items: [ {id,name,seedQty,seedTs,classification,source} ],
 *     pendingClassification?: [ {id,name?,qty,buyEach,buyTs,firstSeenTs} ] }
 *     seedQty  — the qty at the seed moment (pre-log baseline, or the qty a classified capture carried)
 *     seedTs   — unix SECONDS the seed was declared; the fold only counts fills with ts >= seedTs
 *     classification — 'keep' | 'flip' | 'consumable'. classification:'keep' IS the reverse-flip
 *                    candidate pool (Ruling 8 — no per-item opt-in flag; RF1's oscillator filter +
 *                    Ben's per-run table selection pick the actual candidates from the kept set).
 *     source   — 'seed' | 'capture'
 *
 * qty is NEVER stored / incrementally mutated — it is RECOMPUTED every read via computeOwnedQty over
 * raw fills.json events, the same never-patch-a-derived-number philosophy positions.json uses.
 *
 * PURE + fs helpers only; no fetch, DOM-free. Mirrors pipeline/lib/holdthesis.mjs's load/save shape.
 * The GATE/screen logic (inverted regime, edge, --mode reverse) is RF1/RF2 — NOT here (foundation only).
 */
import fs from 'node:fs';
import { collapseOffers } from './reconstruct.mjs';   // raw snapshot lines -> final per-offer filled/spent (shared, pure)
import { BIG_TICKET_GP } from '../../js/quotecore.js'; // the ONE big-ticket threshold (one-home; = 10m)

export const PENDING_QTY_MAX = 5;    // a "keep" buy is bought in singles; a commodity flip in hundreds/thousands — placeholder ceiling
export const MAX_PENDING = 20;       // cap pendingClassification so a busy session can't flood the list — placeholder

/* loadOwned — read the tracked store. Degrades to an empty {items:[]} shape on ANY failure
   (missing / corrupt / wrong shape) so a bad store file can never break a read — matches
   holdthesis.loadHoldThesis's degrade-not-throw. Always returns items[] + pendingClassification[]. */
export function loadOwned(p) {
  try {
    const o = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!o || typeof o !== 'object' || !Array.isArray(o.items)) return { items: [], pendingClassification: [] };
    return { ...o, items: o.items, pendingClassification: Array.isArray(o.pendingClassification) ? o.pendingClassification : [] };
  } catch { return { items: [], pendingClassification: [] }; }
}

/* saveOwned — write the whole store back (pretty, trailing newline) for a clean tracked diff.
   Preserves _doc and pendingClassification if present. */
export function saveOwned(p, store) {
  const out = {
    _doc: store?._doc,
    items: store?.items || [],
    ...(store?.pendingClassification?.length ? { pendingClassification: store.pendingClassification } : {}),
  };
  if (out._doc === undefined) delete out._doc;
  try { fs.writeFileSync(p, JSON.stringify(out, null, 2) + '\n'); } catch {}
}

/* ownedFor — the registered items[] entry for an id, or null. PURE. */
export function ownedFor(store, id) {
  return (store?.items || []).find(e => e && e.id === id) || null;
}

/* upsertOwnedItem — replace any existing items[] entry for the id, else append. PURE (new store).
   Defaults the optional fields; the caller supplies whatever it knows. */
export function upsertOwnedItem(store, entry) {
  const items = store?.items || [];
  const prev = items.find(e => e && e.id === entry.id) || {};
  const rest = items.filter(e => !(e && e.id === entry.id));
  const merged = {
    id: entry.id,
    name: entry.name ?? prev.name ?? ('#' + entry.id),
    seedQty: entry.seedQty ?? prev.seedQty ?? 0,
    seedTs: entry.seedTs ?? prev.seedTs ?? Math.floor(Date.now() / 1000),
    classification: entry.classification ?? prev.classification ?? 'flip',
    source: entry.source ?? prev.source ?? 'seed',
  };
  return { ...store, items: [...rest, merged] };
}

/* removePending — drop an id from pendingClassification (e.g. once classified into items[]). PURE. */
export function removePending(store, id) {
  return { ...store, pendingClassification: (store?.pendingClassification || []).filter(p => p && p.id !== id) };
}

/* computeOwnedQty — the rolling owned balance for one registered item, folded over RAW fills.json
   events (Q1). PURE. NOT positions.json's derived rows — the raw event stream.
 *
 *   qty = seedQty + Σ(buy/banked filled) − Σ(sell/withdraw filled)   over events with ts >= seedTs
 *
 * Raw fills.json carries per-snapshot lines (placed/partial/complete) whose `filled` is CUMULATIVE, so
 * we collapse them to final per-offer offers first (shared collapseOffers — the exact normalization
 * positions.json uses), then fold. There is ZERO reverse-flip-specific branch here: a reverse-flip SELL
 * is an ordinary 'sell' offer (subtracts, drives qty toward 0) and the REBUY is an ordinary 'buy'
 * offer (adds, brings it back) — the same code path as any other trade. That is exactly why qty tracks
 * to 0 and back with no special-casing. */
export function computeOwnedQty(item, fillsEvents) {
  const seedQty = item?.seedQty ?? 0;
  const seedTs = item?.seedTs ?? 0;
  const id = item?.id;
  if (id == null) return seedQty;
  const relevant = (fillsEvents || []).filter(e => e && e.itemId === id && (e.ts ?? 0) >= seedTs);
  let qty = seedQty;
  for (const o of collapseOffers(relevant)) {
    if (!o || !(o.filled > 0)) continue;
    if (o.type === 'buy' || o.type === 'banked') qty += o.filled;
    else if (o.type === 'sell' || o.type === 'withdraw') qty -= o.filled;
  }
  return qty;
}

/* @provisional-api foldPendingBuys — capture-on-buy (PLAN-REVERSE-FLIP RF2 wiring; not yet consumed by
   a surface in RF0, will be called from sync-fills.mjs's regenerate pass). PURE. Walks the buy/banked
   offers and returns candidate pendingClassification entries for any itemId that is: NOT already known
   (in items[] or already pending) ∧ big-ticket (executed each >= BIG_TICKET_GP) ∧ small-qty
   (filled <= qtyMax) — the "a keep purchase is bought in singles" heuristic. Deduped by id, capped at
   MAX_PENDING. Never blocks/alters the sync; purely additive enrichment. */
export function foldPendingBuys(fillsEvents, ownedStore, { qtyMax = PENDING_QTY_MAX, valueFloor = BIG_TICKET_GP, max = MAX_PENDING } = {}) {
  const known = new Set((ownedStore?.items || []).map(i => i && i.id));
  const alreadyPending = new Set((ownedStore?.pendingClassification || []).map(p => p && p.id));
  const buys = (fillsEvents || []).filter(e => e && (e.type === 'buy' || e.type === 'banked'));
  const out = [], seen = new Set();
  for (const o of collapseOffers(buys)) {
    if (!o || !(o.filled > 0)) continue;
    if (known.has(o.itemId) || alreadyPending.has(o.itemId) || seen.has(o.itemId)) continue;
    const each = o.spent / o.filled;   // actual executed gross price per item
    if (each >= valueFloor && o.filled <= qtyMax) {
      out.push({ id: o.itemId, qty: o.filled, buyEach: Math.round(each), buyTs: o.tsClose, firstSeenTs: o.tsOpen });
      seen.add(o.itemId);
    }
  }
  return out.slice(0, max);
}
