// capital.mjs — PURE freed-capital detector for the watch loop (chunk V6 Companion).
//
// SURFACE-ONLY. The watch loop knows DEPLOYED capital (held lots + resting bids) but NOT free cash —
// that isn't in the RuneLite logs, so we assume it's reinvested. What we CAN detect, anchor-free, is
// capital FREED between two consecutive passes: a held lot whose quantity dropped (a SELL filled and
// booked) since last pass. When that freed value clears a threshold, the loop SURFACES an inline
// prompt to consider a scan to redeploy. It NEVER auto-places an offer and NEVER runs the scan itself
// — Ben places every offer; the LLM/Ben runs /scan. It rides V1's watchstate deltas (the prior-pass
// state map) and is guarded in try/catch by the caller like every other state use.
//
// HONEST + SIMPLE: it fires only on a REAL qty drop of a previously-seen lot within a CONSECUTIVE
// pass (a fresh/empty prior, a first-seen lot, or a stale-gap pass → NO event, so it never misfires
// on startup, a reset, or an overnight pause where a lot merely "vanished" from an old snapshot).

import { STALE_GAP_MS } from './watchstate.mjs';

// Freed value (proceeds of a booked SELL) at/above which a redeploy prompt is worth surfacing.
// DOCUMENTED PLACEHOLDER (Ben, 2026-07-06) — ~5m is "a real position closed, worth a scan"; below it
// is incidental. Cited nowhere as calibrated; tune against real loop cadence.
export const FREED_CAPITAL_SCAN_GP = 5_000_000;

// Parse a held-lot identity string ("hld:<qty>:<avgCost>", the key watch.mjs stores) back into its
// qty + avgCost. Tolerant: a malformed / non-held identity → null (the caller skips it).
function parseHeldIdentity(identity) {
  if (typeof identity !== 'string') return null;
  const m = identity.match(/^hld:(\d+):(\d+)$/);
  if (!m) return null;
  return { qty: Number(m[1]), avgCost: Number(m[2]) };
}

/* PURE. Detect capital freed by SELLs between the prior pass and this pass.
     prior   — the loadState() map from watchstate.mjs (keys `held:<id>`, entries carry
               `{ identity:'hld:<qty>:<avgCost>', instabuy, ts, ... }`)
     curHeld — this pass's held lots: [{ id, qty, sellPrice }] (sellPrice = live instabuy, the
               clear-now price used to value the units that left the book; optional)
     opts.now       — ms (default Date.now()); a prior entry older than STALE_GAP_MS is NOT a
                      consecutive pass → its lots are ignored (no overnight-pause false positive)
     opts.threshold — freed-gp floor to set `prompt` (default FREED_CAPITAL_SCAN_GP)
   Returns { totalFreed, events: [{ id, unitsSold, freed }], prompt }.
   A lot whose qty DROPPED (or vanished) since last pass freed `unitsSold × unitValue`, valued at the
   prior pass's instabuy when available, else its avg cost. A lot that grew / is unchanged / is
   first-seen contributes nothing. */
export function freedCapital(prior, curHeld, { now = Date.now(), threshold = FREED_CAPITAL_SCAN_GP } = {}) {
  const events = [];
  const curById = new Map((curHeld || []).map(h => [h.id, h]));
  for (const [key, entry] of Object.entries(prior || {})) {
    if (!key.startsWith('held:')) continue;
    if (now != null && entry && entry.ts != null && (now - entry.ts) > STALE_GAP_MS) continue; // stale prior → not consecutive
    const pid = parseHeldIdentity(entry && entry.identity);
    if (!pid || !(pid.qty > 0)) continue;
    const id = Number(key.slice('held:'.length));
    const cur = curById.get(id);
    const curQty = cur ? (cur.qty || 0) : 0;
    const unitsSold = pid.qty - curQty;
    if (unitsSold <= 0) continue;   // grew / unchanged → not a sell
    const unit = (entry && entry.instabuy != null && entry.instabuy > 0) ? entry.instabuy : pid.avgCost;
    const freed = unitsSold * unit;
    if (freed > 0) events.push({ id, unitsSold, freed });
  }
  const totalFreed = events.reduce((n, e) => n + e.freed, 0);
  return { totalFreed, events, prompt: totalFreed >= threshold };
}
