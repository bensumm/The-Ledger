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
import { tax, grossFromNet } from '../../../js/quotecore.js'; // the ONE tax impl (chunk 4.1) + its exact inverse (PLAN-SALE-LOG-TAX)

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
 * WORTH CONVENTION (PLAN-SALE-LOG-TAX): a sell's `worth` is GROSS in `.log`/`.txt` sources but
 * NET OF TAX in `.json` ones (the plugin's format switch — FILLS-PIPELINE.md §5.1/§10 own the
 * record). Decided per SOURCE FILE via isNetWorthSource(), never per timestamp (manual/mobile
 * logs are `.log` → gross); rides SELL events as `worthNet: true` (absent = gross, so all
 * history means what it always meant); never hashed into eventId(). §3a: `.json` also RECORDS the
 * cumulative tax — carried as `taxAmt` (either convention, unhashed): gross = spent + taxAmt,
 * a read not an inversion; grossFromNet is the fallback without it.
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
// Worth convention of a source FILE: `.json` → NET, anything else → GROSS (see WORTH CONVENTION above).
export function isNetWorthSource(filename) {
  return /\.json$/i.test(String(filename ?? ''));
}

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
// `worthNet` option (per source file) or a stamped `worthNet:true` raw field marks a SELL's spent net-of-tax.
export function parseJsonLine(line, { worthNet = false } = {}) {
  line = line.trim();
  if (!line || line[0] !== '{') return null; // JSON mode expected; skip non-JSON (e.g. legacy TEXT lines)
  let o;
  try { o = JSON.parse(line); } catch { return null; }

  // Tombstone directive (see PLAN.md chunk 1.4): a REMOVE line targets an event id and, on
  // merge, deletes the matching event from fills.json even if already persisted. Returned as
  // a marker so the runner (sync-fills.mjs main()) can collect it; it carries no ts/slot of
  // its own. Non-runner consumers (monitor-offers.mjs) filter these markers out before buildEvents.
  const marker = String(pick(o, 'state', 'status', 'offerState') ?? '').toUpperCase();
  if (marker === 'REMOVE') {
    return { remove: String(pick(o, 'target', 'id', 'event') ?? '') };
  }
  // REVIVE directive (PLAN-BOOK-SELF-HEAL H1): exempts one open short from the age settle AND from
  // the time/price gate on its next rebuy. A marker like REMOVE — no ts/slot, never an event, never
  // hashed. `target` is the short's sellTs; null = the item's only short. buildEvents drops it.
  if (marker === 'REVIVE') {
    const t = Number(pick(o, 'target', 'sellTs'));
    return { revive: { itemId: Number(pick(o, 'item', 'itemId', 'item_id')), target: Number.isFinite(t) ? t : null } };
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

  const ev = {
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
  if (type === 'sell') {
    if (worthNet || o.worthNet === true) ev.worthNet = true;
    const t = Number(pick(o, 'tax')); // §3a recorded cumulative tax — either convention (the audit reads it)
    if (Number.isFinite(t)) ev.taxAmt = t;
  }
  return ev;
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
    if (r.empty || r.remove !== undefined || r.revive !== undefined) continue; // markers are never events
    events.push(r);
  }
  for (const e of events) delete e.empty;
  return events;
}

// LH1: slot-state transition validator — the LOUD, conservative catch for the "impossible
// transition" class (a re-emitted stale slot state after a relog). A GE slot is a state machine: a
// terminal (BOUGHT/SOLD/CANCELLED_*) closes it, so a second terminal on the same slot with nothing
// re-opening it between is impossible. Strictly identical to the prior terminal (sameTerminal) ⇒ a
// provable re-emit: DROP + warn LOUDLY, at INGEST, so it never enters fills.json. ANY field differs
// ⇒ a possible fast re-trade whose placement line was missed: WARN but KEEP (fail toward preserving
// data; a REMOVE tombstone is the manual override). Manual slots 8/9 are not state machines and are
// EXEMPT. A SUPERSET of dedupeSnapshots(), which stays the silent derivation-layer backstop for a
// phantom already persisted in an older fills.json. This is NOT the deleted cancel-to-EMPTY
// inference: EMPTY lines are consumed by buildEvents and never reach here. Full story: §10.
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
// LATENT, recorded 2026-08-09 (not fixed — no live impact, and fixing changes historical realised):
// matchTrades taxes EVERY sell, but the Old School Bond (13190) is TAX-EXEMPT (`js/money-math.js`).
// Harmless ONLY because the bond is quarantined (`ignored-items.json`) and dropped BEFORE
// reconstruction; if ever un-quarantined its closed rows over-tax — route through a bond branch then.
// The grossFromNet inverse (matchTrades below) shares this fate — tax()-based, nothing unconditional ships.

// P1 (2026-07-05): snapshot-re-emission dedupe. RuneLite re-broadcasts every GE slot's state on
// login / world-hop / GE-open, so a completed-but-uncollected offer re-logs its terminal line and
// collapseOffers would read it as a SECOND trade — a phantom open lot on a duplicate BUY, a
// phantom orphan on a duplicate SELL (the 2026-07-04 soul/blowpipe/bludgeon incident,
// FILLS-PIPELINE.md §10). Discriminator: a GENUINE repeat trade always has a fresh BUYING/SELLING
// placement line between two same-slot terminals; a re-emission never does. Walking each slot's
// events in ts order, drop a terminal whose immediately-preceding same-slot event is an IDENTICAL
// terminal; a placement (or differing terminal) between them keeps the second. EMPTY lines for
// OTHER slots in a login burst belong to different slots (consumed by buildEvents()), so they
// never count as an intervening placement for the traded slot. Runs at the DERIVATION layer as the
// SILENT BACKSTOP to LH1's loud ingest catch: a phantom ALREADY persisted in an older fills.json —
// which the ingest pass never re-reads — is still dropped from the derived positions.json. Both
// layers use the SAME sameTerminal() discriminator.
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
    if (e.worthNet) o.worthNet = true;
    if (e.taxAmt != null) o.taxAmt = Math.max(o.taxAmt ?? 0, e.taxAmt); // cumulative → final, like spent
    if (e.state === 'complete' || e.state === 'cancelled') o.done = true;
  }
  for (const o of cur.values()) offers.push(o);
  return offers.sort((a, b) => a.tsOpen - b.tsOpen);
}

// sellNetEach(offer) — per-item net proceeds of a filled SELL, exact under both worth conventions.
// The ONE net formula: matchTrades' realised and deriveCash's sellIn both go through it.
export function sellNetEach(o) {
  const each = o.filled > 0 ? o.spent / o.filled : 0;
  return o.worthNet ? each : each - GE_TAX(each);
}

// auditWorthConvention(rows, assignedNet, filename) — recurrence guard (PLAN-SALE-LOG-TAX §9d + §3a):
// (a) exact gross/net formula matches over sell terminals (tax-0 and above-ask rows skipped);
// ≥1 opposite match with 0 assigned ⇒ oppositeExact. (b) the recorded tax field: presence on a
// GROSS-assigned file, or NET-assigned spent + taxAmt < price × filled (above-ask only exceeds) ⇒
// warn. mismatch = any. PURE — the caller warns; NEVER abort/auto-flip. Limits: FILLS-PIPELINE §5.1.
export function auditWorthConvention(rows, assignedNet, filename) {
  let checked = 0, grossMatches = 0, netMatches = 0, taxFieldRows = 0, sumViolations = 0;
  for (const r of rows || []) {
    if (!r || r.empty || r.remove !== undefined) continue;
    if (r.type !== 'sell' || r.state !== 'complete') continue;
    if (!(r.filled > 0) || !(r.price > 0) || !(r.spent > 0)) continue;
    if (Number.isFinite(r.taxAmt)) {
      taxFieldRows++;
      if (assignedNet && r.spent + r.taxAmt < r.price * r.filled) sumViolations++;
    }
    const taxItem = GE_TAX(r.price);
    if (taxItem <= 0) continue;                                  // gross == net — ambiguous, skip
    const gross = r.price * r.filled;
    if (r.spent === gross) grossMatches++;
    else if (r.spent === gross - taxItem * r.filled) netMatches++;
    else continue;                                               // filled above ask / mid-cumulative — skip
    checked++;
  }
  const assigned = assignedNet ? netMatches : grossMatches;
  const opposite = assignedNet ? grossMatches : netMatches;
  const oppositeExact = opposite >= 1 && assigned === 0;
  return { file: filename, checked, grossMatches, netMatches, taxFieldRows, sumViolations,
    assignedNet: !!assignedNet, oppositeExact,
    mismatch: oppositeExact || (taxFieldRows >= 1 && !assignedNet) || sumViolations >= 1 };
}

/* matchTrades — FIFO reconstruction. SYMMETRIC since SM1 (PLAN-SYMMETRIC-MATCHING):
   buy→sell pairs into a closed flip, and sell→buy pairs into a closed KEEP ROUND TRIP.

   `keeps` is an OPTIONAL Set of itemIds classified 'keep' in owned-items.json. It is a PARAMETER,
   never an import: matchTrades stays pure/IO-free, and every existing direct caller that passes
   nothing (campaigns.mjs, join-outcomes.mjs) keeps byte-identical behavior — an empty keep set makes
   the short path unreachable, so the function degrades exactly to its pre-SM1 form.

   Why the short queue exists: selling an item you OWN (bank gear) leaves no buy lot to consume, so
   pre-SM1 the sell fell into `unmatched` and its proceeds contributed ZERO realised P/L (SM0 Result B
   measured 2,636,600 gp lost across two cycles). Intent is NOT discriminated — a deliberate reverse
   flip and a liquidation to free capital are byte-identical in the log, and the round-trip P/L is the
   meaningful number for both. Hence the neutral `keepRoundTrip` tag, never `reverseFlip`.

   SHORT LIFECYCLE (H1 — supersedes the former "an open short has no deadline, never add a timeout"):
   a DECLARED short (`declared`, from hold-thesis reverseFlip:true) or a REVIVEd one (`revives`, from a
   log REVIVE line) has no deadline and no gate. An UNDECLARED short takes a rebuy only within
   SHORT_MAX_AGE_DAYS AND at or below its `beRebuy`; refused on price the buy opens an ordinary lot,
   past the age the short SETTLES at breakeven (realised 0 by construction, lifetime realised unmoved).
   Without it an intent-blind close ate a fresh flip's buy and orphaned its sell — a clean day read red.
   `declared`/`revives`/`now` are PARAMETERS like `keeps`: omitting them on a book whose shorts are
   inside the gate reproduces pre-H1 output exactly. */
export const SHORT_MAX_AGE_DAYS = 14;   // ⚖ judgment: covers the measured multi-week-oscillator class (~6-8d) and ends the 3-5-week tripwires
export function matchTrades(offers, { keeps, declared, revives, now = Math.floor(Date.now() / 1000) } = {}) {
  const keepSet = keeps instanceof Set ? keeps : new Set(keeps || []);
  const declaredSet = declared instanceof Set ? declared : new Set(declared || []);
  const reviveList = revives || [];
  const maxAge = SHORT_MAX_AGE_DAYS * 86400;
  const isRevived = s => reviveList.some(r => r && Number(r.itemId) === s.itemId && (r.target == null || Number(r.target) === s.ts));
  const settled = [], refusedCloses = [];
  const settle = (s, tsAt) => settled.push({ itemId: s.itemId, qty: s.qty, sellEach: Math.round(s.each),
    tax: s.taxEach * s.qty, beRebuy: s.beRebuy, sellTs: s.ts, settledTs: tsAt, reason: 'aged-out' });
  const filled = offers.filter(o => o.filled > 0).sort((a, b) => a.tsOpen - b.tsOpen);
  const lots = new Map();   // itemId -> [{qty, each, ts}] FIFO queue of open buy lots
  const shorts = new Map(); // itemId -> [{qty, each, taxEach, ts}] FIFO queue of open KEEP SELL legs
  const closed = [], unmatched = [];
  for (const o of filled) {
    const each = o.spent / o.filled; // executed price per item — GROSS, except NET on a worthNet sell (see WORTH CONVENTION)
    if (o.type === 'buy' || o.type === 'banked') {
      // BANKED = pre-owned stock committed to flipping at a declared basis (each). It enters
      // the FIFO queue exactly like a bought lot but carries banked:true so its eventual
      // realised P/L (and any leftover open position) stays distinguishable from cash buys.
      let remain = o.filled;
      // SM1: drain any open short FIRST — a rebuy closes the outstanding keep sell before it can
      // open new flip inventory. (banked drains too, matching the SM0-validated prototype; whether a
      // BANKED declaration *should* close a short rather than open a lot is a live question — see
      // PLAN-SYMMETRIC-MATCHING SM4. Behavior here is what SM0 verified against the real book.)
      const sq = shorts.get(o.itemId) || [];
      const buyEach = Math.round(each);
      while (remain > 0 && sq.length) {
        const s = sq[0];
        // H1 gate: an undeclared, un-revived short only takes a rebuy inside the age AND at/below beRebuy.
        if (!declaredSet.has(o.itemId) && !isRevived(s)) {
          if (o.tsOpen - s.ts > maxAge) {
            refusedCloses.push({ itemId: o.itemId, reason: 'age', buyEach, beRebuy: s.beRebuy, sellTs: s.ts, buyTs: o.tsOpen });
            settle(s, o.tsOpen); sq.shift(); continue;
          }
          if (buyEach > s.beRebuy) {
            refusedCloses.push({ itemId: o.itemId, reason: 'price', buyEach, beRebuy: s.beRebuy, sellTs: s.ts, buyTs: o.tsOpen });
            break;
          }
        }
        const take = Math.min(remain, s.qty);
        closed.push({ itemId: o.itemId, qty: take, buyEach: Math.round(each), sellEach: Math.round(s.each),
          tax: s.taxEach * take, realised: Math.round(((s.each - s.taxEach) - each) * take),
          keepRoundTrip: true, buyTs: o.tsOpen, sellTs: s.ts });
        s.qty -= take; remain -= take; if (s.qty <= 0) sq.shift();
      }
      if (remain > 0) (lots.get(o.itemId) || lots.set(o.itemId, []).get(o.itemId)).push({ qty: remain, each, ts: o.tsOpen, banked: o.type === 'banked' });
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
      // Net is primary (realised), gross recovered for display (sellEach/tax) — PLAN-SALE-LOG-TAX §9c.
      // A gross-convention offer reduces byte-identically to the pre-flag formulas.
      const netEach = sellNetEach(o);
      // Gross is a READ when the tax was recorded (exact, §3a); grossFromNet = fallback without it.
      const grossEach = o.worthNet ? (o.taxAmt != null ? (o.spent + o.taxAmt) / o.filled : grossFromNet(each)) : each;
      const taxEach = o.worthNet ? grossEach - netEach : GE_TAX(each);
      let remain = o.filled; const q = lots.get(o.itemId) || [];
      while (remain > 0 && q.length) {
        const lot = q[0], take = Math.min(remain, lot.qty);
        closed.push({ itemId: o.itemId, qty: take, buyEach: Math.round(lot.each), sellEach: Math.round(grossEach),
          tax: taxEach * take, realised: Math.round((netEach - lot.each) * take), banked: !!lot.banked, buyTs: lot.ts, sellTs: o.tsOpen });
        lot.qty -= take; remain -= take; if (lot.qty <= 0) q.shift();
      }
      // SM1: a leftover sell on a KEEP opens a short (an open round-trip leg awaiting its rebuy);
      // anything else stays `unmatched` — "basis unknown", which is what that bucket is for. The gate
      // is deliberately narrow: 13 of 14 historical unmatched rows were non-keep pre-log commodity
      // sells, and matching those against later flip buys would invent round trips that never
      // happened while orphaning the flips that did (PLAN-SYMMETRIC-MATCHING §5). The short stores
      // gross + taxEach, so the close (s.each − s.taxEach = net) and beRebuy are convention-blind.
      if (remain > 0) {
        if (keepSet.has(o.itemId)) {
          (shorts.get(o.itemId) || shorts.set(o.itemId, []).get(o.itemId)).push({ itemId: o.itemId, qty: remain,
            each: grossEach, taxEach, beRebuy: Math.round(grossEach - taxEach), ts: o.tsOpen });
        } else {
          unmatched.push({ itemId: o.itemId, qty: remain, sellEach: Math.round(grossEach), tax: taxEach * remain, sellTs: o.tsOpen });
        }
      }
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
  // SM1: leftover shorts = keeps sold and not yet rebought. beRebuy is the break-even on the capital
  // reallocation (rebuy below it and the reallocation was free; above it, the gap is what it cost).
  // H1 settle sweep: a short still open at `now`, undeclared and un-revived, past the age settles at
  // breakeven rather than waiting forever to grab a future buy.
  const awaitingRebuy = [];
  for (const [itemId, sq] of shorts) for (const s of sq) {
    if (s.qty <= 0) continue;
    if (!declaredSet.has(itemId) && !isRevived(s) && now - s.ts > maxAge) { settle(s, now); continue; }
    awaitingRebuy.push({ itemId, qty: s.qty, sellEach: Math.round(s.each), tax: s.taxEach * s.qty,
      beRebuy: s.beRebuy, sellTs: s.ts });
  }
  awaitingRebuy.sort((a, b) => a.sellTs - b.sellTs);
  settled.sort((a, b) => a.sellTs - b.sellTs);
  return { closed, open, unmatched, awaitingRebuy, settled, refusedCloses };
}

export function reconstruct(events, { keeps, declared, revives, now } = {}) {
  // dedupeSnapshots first (P1): strip snapshot re-emissions before offers are collapsed, so a
  // phantom duplicate terminal never becomes a second offer. monitor-offers.mjs shares reconstruct(), so
  // its live held count gets the same fix. (The forward-join siblings do NOT go through here — they use
  // campaigns.mjs's reconstructCampaigns — but that runs dedupeSnapshots itself (campaigns.mjs:63), so
  // campaign boundaries ARE deduped. The older note here said they were not; corrected 2026-08-09.)
  // `keeps` (SM1) is threaded through to matchTrades; omitting it disables the keep-round-trip path
  // entirely, so callers that don't supply it keep pre-SM1 behavior.
  // H1: `declared` (hold-thesis reverseFlip ids), `revives` (REVIVE markers) and `now` ride the same
  // parameter contract — the caller does the IO; omitting them keeps a young book's output unchanged.
  const { closed, open, unmatched, awaitingRebuy, settled, refusedCloses } =
    matchTrades(collapseOffers(dedupeSnapshots(events)), { keeps, declared, revives, now });
  return { app: 'the-coffer-positions', version: 1, generatedAt: new Date().toISOString(),
    closed, open, unmatched, awaitingRebuy, settled, refusedCloses };
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
