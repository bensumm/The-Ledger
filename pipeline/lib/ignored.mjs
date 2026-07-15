/* ignored.mjs — the MERCH-book quarantine (Ben, 2026-07-07). Some items Ben transacts are NOT
   flips: farming inputs (snapdragon seed planted, snapdragon herb harvested-and-sold), loot,
   personal-use consumables. Their raw trades still land in the exchange log and STAY in fills.json
   (full audit — nothing is deleted), but they pollute the derived merch views (positions.json
   phantom open lots, unmatched-sell clutter, watch CANCEL-BID noise). This module filters those
   views WITHOUT touching fills.json or the core FIFO.

   The hard constraint: intent isn't in the log — a snapdragon-seed BUY looks identical whether
   planted or flipped. So an ignored item is quarantined BY DEFAULT; a specific transaction is
   surfaced as a real flip ONLY if it matches a `greenlisted` entry {id, qty, price, ts} that the
   AGENT appends when Ben confirms a recommended flip (Ben only flips these on a recommendation, so
   every legit flip passes that gate — the default-quarantine is safe). Config: repo-root
   ignored-items.json. Pure + fixture-pinned (pipeline/test/ignored.test.mjs). */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// match tolerance (Ben-approved 2026-07-07): price within ±3%, ts within ±6h. qty is informational
// (partial fills make an exact event-level qty match brittle); id+price+ts scopes a flip cleanly.
export const PRICE_TOL = 0.03;
export const TS_TOL = 6 * 3600;

// Parse ignored-items.json → { ids:Set<number>, greenlisted:[{id,qty,price,ts,consumed}] }. Missing
// or unreadable file → empty (no quarantine) so the pipeline degrades safely.
export function loadIgnored(repoDir) {
  const p = join(repoDir, 'ignored-items.json');
  if (!existsSync(p)) return { ids: new Set(), greenlisted: [] };
  try {
    const o = JSON.parse(readFileSync(p, 'utf8'));
    return { ids: new Set((o.items || []).map(i => +i.id)), greenlisted: o.greenlisted || [] };
  } catch { return { ids: new Set(), greenlisted: [] }; }
}

// A greenlist entry matches a transaction on price + ts proximity (id already checked by caller).
// A `consumed:true` entry never matches again (agent may set it after the flip closes; the ±6h ts
// window is the primary guard so a farm buy days later can't accidentally re-match a stale entry).
export function greenlistMatch(cfg, itemId, price, ts) {
  return (cfg.greenlisted || []).find(g =>
    !g.consumed && +g.id === itemId &&
    price != null && Math.abs(price - g.price) <= g.price * PRICE_TOL &&
    ts != null && Math.abs(ts - g.ts) <= TS_TOL) || null;
}

// POSITIONS filter: keep an event unless it's a non-greenlisted ignored-item event. Applied to the
// reconstruct() INPUT only — fills.json keeps the full merged set (audit).
export function quarantineEvents(events, cfg) {
  if (!cfg || !cfg.ids || !cfg.ids.size) return events;
  return events.filter(e => !cfg.ids.has(e.itemId) || greenlistMatch(cfg, e.itemId, e.price, e.ts));
}

// LIVE-OFFER filter (watch/offers): an ignored-item offer is quarantined unless its price matches a
// live greenlist entry (no ts check — the offer is current). Returns true = drop it from the view.
export function offerQuarantined(cfg, itemId, offerPrice) {
  if (!cfg || !cfg.ids || !cfg.ids.has(itemId)) return false;
  const greenlit = (cfg.greenlisted || []).some(g =>
    !g.consumed && +g.id === itemId &&
    offerPrice != null && Math.abs(offerPrice - g.price) <= g.price * PRICE_TOL);
  return !greenlit;
}
