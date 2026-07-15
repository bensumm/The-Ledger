/* positions.mjs — the ONE reader for OPEN positions from repo-root positions.json.
   Parses positions.json, filters open lots (qty>0), and groups them by itemId at
   weighted-average cost — the block that was copied verbatim into quote-items.mjs / watch-positions.mjs /
   trigger-alerts.mjs (X1 dedup). READ-ONLY: positions.json is the DERIVED view, written solely by
   sync-fills.mjs (via reconstruct.mjs's WITHDRAWN/BANKED-aware FIFO). */
import fs from 'node:fs';

/* readOpenPositions(positionsPath) -> one of:
     { err }                                    // positions.json unreadable/unparseable
     { pos, groups, openLots, ageMin }          // success (groups may be empty)
   groups: [{ itemId, qty, cost, avgCost, buyTs }] — open lots summed per item at weighted-avg
     cost (cost = Σ qty·buyEach; avgCost = cost/qty). buyTs (V3) = the OLDEST lot's buy timestamp
     (unix seconds) in the group, so the momVerdict entry-age softening treats a grouped position
     as "fresh" only when the ENTIRE position is recent (a stale lot with a fresh top-up is not
     softened). null when no lot carries a buyTs. Insertion order follows first-seen itemId in
     the open-lots list (stable, matches the prior inline grouping). openLots = number of open
     lots (pre-grouping) for the "N items, M lots" line. ageMin = minutes since pos.generatedAt
     (the ~sync-lag age), or null if absent.
   Callers own the error POLICY: quote-items.mjs exits, watch-positions.mjs warns + continues, trigger-alerts.mjs skips. */
export function readOpenPositions(positionsPath) {
  let pos;
  try { pos = JSON.parse(fs.readFileSync(positionsPath, 'utf8')); }
  catch (e) { return { err: (e && e.message) || String(e) }; }
  const open = (pos.open || []).filter(l => l.qty > 0);
  const byItem = new Map();
  for (const l of open) {
    const g = byItem.get(l.itemId) || { qty: 0, cost: 0, buyTs: null };
    g.qty += l.qty; g.cost += l.qty * l.buyEach;
    if (l.buyTs != null) g.buyTs = (g.buyTs == null) ? l.buyTs : Math.min(g.buyTs, l.buyTs); // oldest lot
    byItem.set(l.itemId, g);
  }
  const groups = [...byItem].map(([itemId, g]) => ({ itemId, qty: g.qty, cost: g.cost, avgCost: g.cost / g.qty, buyTs: g.buyTs }));
  const ageMin = pos.generatedAt ? Math.round((Date.now() - Date.parse(pos.generatedAt)) / 60000) : null;
  return { pos, groups, openLots: open.length, ageMin };
}
