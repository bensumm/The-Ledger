/* velocitytag.mjs — Build 2 (the deferred YV1 #3 scan tag). PURE per-item velocity read over the
   gitignored outcomes.json campaigns (YV1), so screen-flip-niches.mjs can annotate a scan row with how that item
   has historically behaved: how fast it cycles, its typical time-to-first-fill, and how often its
   bids never filled. DESCRIPTIVE — a label off a handful of lots, NEVER a rate/sort/gate (the
   concentration + F1 caveats carry). Kept pure (no fs): screen-flip-niches.mjs reads outcomes.json and passes the
   parsed object in; absent/empty → an empty index → screen stays silent. */
import { median } from './cli.mjs';

const SHORT = { 'fast-cycler': 'fast', 'mid': 'mid', 'slow-hold': 'slow' };

/* buildVelocityIndex(outcomes) -> { generatedAt, byItem: Map(itemId -> {
     name, velocityClass (dominant measured class, null if none), n (campaigns with a class),
     medianFillSec (median time-to-first-fill of FILLED campaigns), nBids, nNeverFilled }) }.
   Aggregates the outcomes campaigns by item. Robust to a null/Shapeless input (→ empty index). */
export function buildVelocityIndex(outcomes) {
  const campaigns = (outcomes && Array.isArray(outcomes.campaigns)) ? outcomes.campaigns : [];
  const acc = new Map();   // id -> { name, classes:{}, fillSecs:[], nBids, nNeverFilled }
  for (const c of campaigns) {
    if (c == null || c.itemId == null) continue;
    let e = acc.get(c.itemId);
    if (!e) { e = { name: c.name || ('#' + c.itemId), classes: {}, fillSecs: [], nBids: 0, nNeverFilled: 0 }; acc.set(c.itemId, e); }
    if (c.velocityClass && c.velocityClass !== 'n/a') e.classes[c.velocityClass] = (e.classes[c.velocityClass] || 0) + 1;
    if (c.side === 'buy') { e.nBids++; if (!c.everFilled) e.nNeverFilled++; }
    if (c.everFilled && c.timeToFirstFill != null) e.fillSecs.push(c.timeToFirstFill);
  }
  const byItem = new Map();
  for (const [id, e] of acc) {
    const ranked = Object.entries(e.classes).sort((a, b) => b[1] - a[1]);
    byItem.set(id, {
      name: e.name,
      velocityClass: ranked.length ? ranked[0][0] : null,
      n: ranked.reduce((s, [, k]) => s + k, 0),
      medianFillSec: e.fillSecs.length ? median(e.fillSecs) : null,
      nBids: e.nBids,
      nNeverFilled: e.nNeverFilled,
    });
  }
  return { generatedAt: (outcomes && outcomes.generatedAt) || null, byItem };
}

/* velocityTag(entry, {minN}) -> compact string | null. Null (no tag) when the item lacks enough
   classed history (< minN) — we never label off an anecdote. Format: `fast·~9m` (+ ` N% unfilled`
   when ≥ minN bids and ≥20% of them never filled — the parked-capital tell). */
export function velocityTag(entry, { minN = 5 } = {}) {
  if (!entry || !entry.velocityClass || entry.n < minN) return null;
  let s = SHORT[entry.velocityClass] || entry.velocityClass;
  if (entry.medianFillSec != null) {
    const m = Math.round(entry.medianFillSec / 60);
    s += m < 60 ? `·~${m}m` : `·~${(m / 60).toFixed(1)}h`;
  }
  if (entry.nBids >= minN && entry.nNeverFilled > 0) {
    const pct = Math.round((entry.nNeverFilled / entry.nBids) * 100);
    if (pct >= 20) s += ` ${pct}% unfilled`;
  }
  return s;
}
