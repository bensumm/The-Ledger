/**
 * campaigns.mjs — the SHARED sell/buy CAMPAIGN reconstruction primitive (WC2, PLAN-WINDOW-CLEAR-OUTCOMES).
 *
 * A CAMPAIGN = one intent to trade: a same-item/same-side chain of offers, `placed → … → terminal`,
 * with cancel-replace successions (a cancel then a re-place within REPRICE_GAP) STITCHED into ONE
 * campaign carrying a reprice list. This is the exact campaign build join-outcomes.mjs has always run
 * (dedupeSnapshots → collapseOffers → stampFirstFill → groupCampaigns), lifted here VERBATIM so the
 * forward-join siblings (join-window-clears.mjs, and any future outcome joiner) reuse ONE reconstruction
 * instead of re-implementing it — the CLAUDE.md reconstruction rule (matchTrades/collapseOffers are
 * NEVER re-implemented). join-outcomes.mjs now imports reconstructCampaigns from here; the move is pure
 * (its outcomes.json output is byte-identical — proven by diffing --json before/after the extraction).
 *
 * FIFO helpers (collapseOffers / matchTrades / dedupeSnapshots) still live in reconstruct.mjs — the ONE
 * home for the money path; this module only adds the campaign GROUPING + first-fill stamping + the base
 * per-campaign field derivation (campaignBase) on top of them.
 */
import { collapseOffers, matchTrades, dedupeSnapshots } from './reconstruct.mjs';

// --- tunable named constants (moved verbatim from join-outcomes.mjs; single source now) --------
export const REPRICE_GAP = 20 * 60;   // s: a re-place within this of a cancel = same campaign (a reprice)
// Hand-entered fills occupy SYNTHETIC slots, never a real GE slot (a real book has 0-7). The floor is
// what defines them, not a single value: coffer-manual.log writes slot 8, the app's mobile GitHub path
// writes 9, and FILLS-PIPELINE.md tells a backfill to pick '--slot <n> (>= 8)' — the live book already
// holds events on 10-14. This was `=== 8` while its own comment said 'mobile / manual', so every slot-9
// MOBILE campaign was reported manual:false and entered outcomes.json as an organic GE fill, which makes
// a hand-typed 'time to first fill' fiction in the F1 calibration set.
export const MANUAL_SLOT_MIN = 8;     // slot >= this is a synthetic/manual slot, not a real GE slot
export const isManualSlot = slot => Number.isFinite(slot) && slot >= MANUAL_SLOT_MIN;

// First-fill timing: collapseOffers loses intermediate event timing, so scan the raw events to
// stamp each offer's tsFirstFill (first event in its slot+item+type window with filled>0). Offers
// are contiguous non-overlapping per slot, so the (slot,item,type,ts∈[open,close]) match is unique.
export function stampFirstFill(events, offers) {
  const evs = [...events].sort((a, b) => a.ts - b.ts);
  for (const o of offers) {
    o.tsFirstFill = null;
    for (const e of evs) {
      if (e.slot === o.slot && e.itemId === o.itemId && e.type === o.type &&
          e.ts >= o.tsOpen && e.ts <= o.tsClose && (e.filled || 0) > 0) { o.tsFirstFill = e.ts; break; }
    }
  }
}

// Group offers into campaigns (cancel-replace stitching). A completed offer, or a gap > REPRICE_GAP,
// ends the current campaign for that item+side; anything else is a reprice appended to it.
export function groupCampaigns(offers) {
  const current = new Map();   // item:type -> in-progress campaign
  const camps = [];
  for (const o of [...offers].sort((a, b) => a.tsOpen - b.tsOpen)) {
    if (o.type === 'withdraw' || o.type === 'banked') continue;   // not a market flip intent
    const key = o.itemId + ':' + o.type;
    let c = current.get(key);
    if (c) {
      const prev = c.offers[c.offers.length - 1];
      if (prev.state === 'complete' || (o.tsOpen - prev.tsClose) > REPRICE_GAP) { camps.push(c); c = null; }
    }
    if (!c) { c = { itemId: o.itemId, type: o.type, offers: [] }; current.set(key, c); }
    c.offers.push(o);
  }
  for (const c of current.values()) camps.push(c);
  return camps.sort((a, b) => a.offers[0].tsOpen - b.offers[0].tsOpen);
}

// The FULL reconstruction: raw fills events → { deduped, offers, closed, campaigns }. This is the exact
// five-line sequence join-outcomes.build() used to run inline; both it and the forward-join siblings call
// this so the offer boundaries / first-fill stamps / FIFO closed lots / campaign grouping are computed
// ONCE, the same way. `closed` is the FIFO closed-lot list (matchTrades — never re-implemented); the
// campaign `offers` carry the tsFirstFill stamps stampFirstFill set.
export function reconstructCampaigns(events) {
  const deduped = dedupeSnapshots(events);
  const offers = collapseOffers(deduped);
  stampFirstFill(deduped, offers);
  const { closed } = matchTrades(offers);   // FIFO — never re-implemented
  const campaigns = groupCampaigns(offers);
  return { deduped, offers, closed, campaigns };
}

// The BASE per-campaign fields every outcome joiner needs (placement, first-fill, terminal, fill
// fraction) — the same derivation join-outcomes.build() does inline before it layers on band/state/
// realised enrichment. A forward-join sibling that only needs the base facts (join-window-clears.mjs)
// reads them from here so the "what did this campaign do" logic has ONE home. `firstFillTs` is the
// ABSOLUTE unix-second first-fill ts (for wall-clock window membership), not just the relative TTF.
export function campaignBase(c) {
  const first = c.offers[0], last = c.offers[c.offers.length - 1];
  const placementTs = first.tsOpen, placementPrice = first.price;
  const reprices = c.offers.slice(1).map(o => ({ ts: o.tsOpen, price: o.price }));
  const filledUnits = c.offers.reduce((s, o) => s + (o.filled || 0), 0);
  const targetQty = last.qty || c.offers.reduce((m, o) => Math.max(m, o.qty || 0), 0);
  const filledFraction = targetQty > 0 ? Math.min(1, filledUnits / targetQty) : null;
  const firstFillTs = c.offers.map(o => o.tsFirstFill).filter(t => t != null).sort((a, b) => a - b)[0] ?? null;
  const completeOffer = c.offers.find(o => o.state === 'complete');
  const tsComplete = completeOffer ? completeOffer.tsClose : null;
  const terminalState = last.state;
  const manual = c.offers.some(o => isManualSlot(o.slot));
  return {
    itemId: c.itemId, side: c.type, manual, placementTs, placementPrice, targetQty,
    filledUnits, filledFraction, firstFillTs,
    timeToFirstFill: firstFillTs != null ? firstFillTs - placementTs : null,
    tsComplete, timeToComplete: tsComplete != null ? tsComplete - placementTs : null,
    everFilled: filledUnits > 0, terminalState, repriceCount: reprices.length, reprices,
  };
}
