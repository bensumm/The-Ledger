/* reverseflipstate.mjs — RF0: the AGENT-WRITTEN declared reverse-flip CYCLE store (PLAN-REVERSE-FLIP).
 *
 * The problem it solves. A reverse-flip is a two-leg cycle on an OWNED item: sell into the peak, then
 * rebuy at the dip. Between the two legs the item has NO open FIFO lot (a Case-B pre-log item was never
 * bought through the log) and NO GE-slot commitment (it's capital-free until a rebuy bid is placed) — so
 * the cycle would silently vanish from every surface between the sell and the rebuy. This store is the
 * DECLARED-CYCLE bookkeeping (scheduling / surfacing), NOT the source of ownership truth (that's the
 * computeOwnedQty fold in ownedledger.mjs). It decides nothing on its own — /schedule, /book, /positions
 * (RF4) READ it to keep the in-flight cycle visible; it never mutates fills/positions.
 *
 * AGENT-WRITTEN, surface-READ-ONLY (the hold-thesis.json pattern). The agent declares/advances state
 * when Ben reports what happened ("sold the hat at 57m" -> awaiting-rebuy; "bid resting at 54.05m" ->
 * rebuy-armed) via pipeline/commands/declare-reverse-flip.mjs — never a script inferring intent from raw
 * fills. TRACKED at repo root as reverse-flip-state.json (a declared cycle must survive across sessions/
 * machines, like hold-thesis.json). Carries item ids/prices/timestamps only — NO PII (repo is public).
 *
 * State machine (from the plan):
 *   holding        — declared, not yet sold (pre-trigger)
 *   awaiting-rebuy — sold, no rebuy bid resting yet (fully capital-free, invisible to held-lots + slots)
 *   rebuy-armed    — a rebuy bid IS resting (offers.json already tracks it as a normal buy offer)
 *   (rebought)     — cycle closes; the entry is cleared / pruned like hold-thesis.json's TTL
 *
 * Store shape: a flat ARRAY of entries (mirrors hold-thesis.json), one per declared cycle:
 *   { id, name, state, soldQty, soldEach, soldTs, beRebuy, targetQty, rebuyBidPrice, rebuyBidTs, declaredTs }
 *     id            — item id (number)
 *     name          — display name (convenience; ids are canonical)
 *     state         — one of REVERSE_FLIP_STATES above
 *     soldQty       — units sold on the sell leg
 *     soldEach      — gp each the sell leg filled at
 *     soldTs        — unix SECONDS of the sell (drives the awaiting-rebuy age / stale nudge)
 *     beRebuy       — break-even rebuy = soldEach − tax(soldEach); any rebuy strictly below this profits
 *     targetQty     — units to reacquire
 *     rebuyBidPrice — the resting rebuy bid gp each (set when state advances to rebuy-armed); null before
 *     rebuyBidTs    — unix SECONDS the rebuy bid was placed; null before rebuy-armed
 *     declaredTs    — unix SECONDS the cycle was declared; drives TTL prune
 *
 * Mirrors pipeline/lib/holdthesis.mjs verbatim in structure (load/save/lookup/upsert/clear/prune, all PURE).
 */
import fs from 'node:fs';

export const REVERSE_FLIP_STATES = ['holding', 'awaiting-rebuy', 'rebuy-armed'];
export const REVERSE_FLIP_TTL_DAYS = 30;   // a declared cycle older than this is stale intent → pruned (longer than hold-thesis: no rebuy deadline)

/* loadReverseFlip — read the tracked store. Degrades to [] on ANY failure (missing / corrupt / non-array)
   so a bad store file can never break a read — matches holdthesis.loadHoldThesis. */
export function loadReverseFlip(p) {
  try { const o = JSON.parse(fs.readFileSync(p, 'utf8')); return Array.isArray(o) ? o : []; }
  catch { return []; }
}
/* saveReverseFlip — write the whole array back (pretty, trailing newline) for a clean tracked diff. */
export function saveReverseFlip(p, store) {
  try { fs.writeFileSync(p, JSON.stringify(store || [], null, 2) + '\n'); } catch {}
}

/* reverseFlipFor — the active declared cycle for an item id (the most-recently-declared if several),
   or null. PURE. */
export function reverseFlipFor(store, id) {
  const matches = (store || []).filter(e => e && e.id === id);
  if (!matches.length) return null;
  return matches.reduce((a, b) => ((b.declaredTs ?? 0) >= (a.declaredTs ?? 0) ? b : a));
}

/* upsertReverseFlip — the agent's write path: replace any existing entry for the id, else append. PURE
   (returns a new array). Optional fields default to null; declaredTs stamps the declaration. Existing
   values are PRESERVED when a field is omitted (advance updates only what changed, e.g. state + bid). */
export function upsertReverseFlip(store,
  { id, name = null, state = null, soldQty = null, soldEach = null, soldTs = null,
    beRebuy = null, targetQty = null, rebuyBidPrice = null, rebuyBidTs = null } = {},
  now = Math.floor(Date.now() / 1000)) {
  const prev = (store || []).find(e => e && e.id === id) || {};
  const rest = (store || []).filter(e => !(e && e.id === id));
  const take = (v, p) => (v != null ? v : (p != null ? p : null));
  return [...rest, {
    id,
    name: take(name, prev.name),
    state: take(state, prev.state),
    soldQty: take(soldQty, prev.soldQty),
    soldEach: take(soldEach, prev.soldEach),
    soldTs: take(soldTs, prev.soldTs),
    beRebuy: take(beRebuy, prev.beRebuy),
    targetQty: take(targetQty, prev.targetQty),
    rebuyBidPrice: take(rebuyBidPrice, prev.rebuyBidPrice),
    rebuyBidTs: take(rebuyBidTs, prev.rebuyBidTs),
    declaredTs: now,
  }];
}

/* clearReverseFlip — drop every entry for an id (the cycle is done / abandoned). PURE. */
export function clearReverseFlip(store, id) { return (store || []).filter(e => !(e && e.id === id)); }

/* pruneReverseFlip — drop entries older than ttlDays (stale declared intent) or malformed. PURE. */
export function pruneReverseFlip(store, now = Math.floor(Date.now() / 1000), ttlDays = REVERSE_FLIP_TTL_DAYS) {
  const cutoff = now - ttlDays * 86400;
  return (store || []).filter(e => e && e.id != null && (e.declaredTs == null || e.declaredTs >= cutoff));
}
