/* bidthesis.mjs — FD4: the declared deep/long BID store (the holdthesis.mjs pattern, keyed item+side).
 *
 * A declared bid is Ben's stated intent to let an offer rest (deep ladder, multi-day accumulation) —
 * it SILENCES the FD4 stale-bid flag and nothing else: never a verdict/alert input (it only quiets a
 * known-expected signal, the TG1 exception). AGENT-WRITTEN via declare-thesis.mjs `bid`/`bid-clear`;
 * watch-positions.mjs reads it READ-ONLY. TRACKED at repo root as bid-thesis.json (mirrors
 * hold-thesis.json: a declaration must survive sessions/machines; ids + free text only, no PII).
 *
 * Shape: flat array of { id, side ('buy'|'sell'), note (free text, display only), ts (unix seconds) }.
 * TTL: BID_THESIS_TTL_DAYS — a declaration older than this is stale intent and the flag re-arms.
 * A ts-less entry is kept forever (same deliberate holdthesis.mjs gap: the CLI saves the pruned
 * store, so expiring one would delete a hand-written declaration on the next write).
 */
import fs from 'node:fs';

export const BID_THESIS_TTL_DAYS = 14;

export function loadBidThesis(p) {
  try { const o = JSON.parse(fs.readFileSync(p, 'utf8')); return Array.isArray(o) ? o : []; }
  catch { return []; }
}
export function saveBidThesis(p, store) {
  try { fs.writeFileSync(p, JSON.stringify(store || [], null, 2) + '\n'); } catch {}
}

/* Active declaration for (id, side) — most recent ts wins — or null. PURE; the one read path. */
export function bidThesisFor(store, id, side = 'buy') {
  const matches = (store || []).filter(e => e && e.id === id && (e.side || 'buy') === side);
  if (!matches.length) return null;
  return matches.reduce((a, b) => ((b.ts ?? 0) >= (a.ts ?? 0) ? b : a));
}

/* Replace any entry for (id, side), else append. PURE. */
export function upsertBidThesis(store, { id, side = 'buy', note = null } = {},
  now = Math.floor(Date.now() / 1000)) {
  const rest = (store || []).filter(e => !(e && e.id === id && (e.side || 'buy') === side));
  return [...rest, { id, side, note, ts: now }];
}

/* Drop entries for an id (one side, or both when side is null). PURE. */
export function clearBidThesis(store, id, side = null) {
  return (store || []).filter(e => !(e && e.id === id && (side == null || (e.side || 'buy') === side)));
}

/* Drop malformed rows + entries past the TTL (ts-less kept — see header). PURE. */
export function pruneBidThesis(store, now = Math.floor(Date.now() / 1000), ttlDays = BID_THESIS_TTL_DAYS) {
  const cutoff = now - ttlDays * 86400;
  return (store || []).filter(e => e && e.id != null && (e.ts == null || e.ts >= cutoff));
}
