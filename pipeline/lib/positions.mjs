/* positions.mjs — the ONE reader for OPEN positions from repo-root positions.json.
   Parses positions.json, filters open lots (qty>0), and groups them by itemId at
   weighted-average cost — the block that was copied verbatim into quote.mjs / watch.mjs /
   alerts.mjs (X1 dedup). READ-ONLY: positions.json is the DERIVED view, written solely by
   sync-fills.mjs (via reconstruct.mjs's WITHDRAWN/BANKED-aware FIFO). */
import fs from 'node:fs';

/* readOpenPositions(positionsPath) -> one of:
     { err }                                    // positions.json unreadable/unparseable
     { pos, groups, openLots, ageMin }          // success (groups may be empty)
   groups: [{ itemId, qty, cost, avgCost }] — open lots summed per item at weighted-avg cost
     (cost = Σ qty·buyEach; avgCost = cost/qty). Insertion order follows first-seen itemId in
     the open-lots list (stable, matches the prior inline grouping). openLots = number of open
     lots (pre-grouping) for the "N items, M lots" line. ageMin = minutes since pos.generatedAt
     (the ~sync-lag age), or null if absent.
   Callers own the error POLICY: quote.mjs exits, watch.mjs warns + continues, alerts.mjs skips. */
export function readOpenPositions(positionsPath) {
  let pos;
  try { pos = JSON.parse(fs.readFileSync(positionsPath, 'utf8')); }
  catch (e) { return { err: (e && e.message) || String(e) }; }
  const open = (pos.open || []).filter(l => l.qty > 0);
  const byItem = new Map();
  for (const l of open) {
    const g = byItem.get(l.itemId) || { qty: 0, cost: 0 };
    g.qty += l.qty; g.cost += l.qty * l.buyEach; byItem.set(l.itemId, g);
  }
  const groups = [...byItem].map(([itemId, g]) => ({ itemId, qty: g.qty, cost: g.cost, avgCost: g.cost / g.qty }));
  const ageMin = pos.generatedAt ? Math.round((Date.now() - Date.parse(pos.generatedAt)) / 60000) : null;
  return { pos, groups, openLots: open.length, ageMin };
}
