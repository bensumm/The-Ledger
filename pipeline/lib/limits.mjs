/**
 * limits.mjs — pure GE BUY-LIMIT WINDOW MATH (LM1). Node-importable, DOM-free, no fetch, no fs
 * (except the one explicit file helper at the bottom). The market judgment "never suggest a buy qty
 * over the 4h GE limit; a bigger size is a multi-window accumulation; a null limit is UNKNOWN, never
 * unlimited" (memory `buy-limit-caps-every-size`) is encoded HERE so every suggesting surface shares
 * one window model.
 *
 * THE MODEL. A GE buy limit is a ROLLING 4-hour window: each purchased UNIT counts against the item's
 * limit for 4h after it is bought, then ages out. So capacity is not a clock that resets on the hour —
 * it frees continuously as the oldest buys pass their 4h mark. `limitWindow` reduces an item's buy
 * fills to { limit, boughtInWindow, remaining, nextFreeAt, fullResetAt } off that model.
 *
 * HONESTY — READ THIS BEFORE TRUSTING A NUMBER (process rule 4):
 *   - fills.json only sees RuneLite-logged fills. A MOBILE or otherwise-unlogged buy is INVISIBLE to
 *     this math. So `boughtInWindow` is a LOWER bound (real purchases may be higher) and `remaining`
 *     is an UPPER bound (you may actually have LESS room than it says). Never treat `remaining` as a
 *     green light to size to the brim — treat it as "at most this much is left".
 *   - The 4h-rolling-window behavior is the COMMUNITY-DOCUMENTED GE mechanic, not an oracle we can
 *     observe directly; Jagex has never published the exact accounting. Per-unit fill timestamps
 *     inside one offer aren't logged either — we attribute all of an offer's units to its CLOSE time
 *     (the last fill update). That skews conservative: it keeps units in-window slightly longer
 *     (a touch higher boughtInWindow) and pushes nextFreeAt slightly later — the safe direction.
 *   - `remaining === null` means the item's limit is UNKNOWN (mapping had no `limit`). Callers MUST
 *     treat unknown as "cannot advise a size", NOT as "no limit / unlimited".
 *
 * All DISPLAYED times are the CALLER's concern (repo rule: rendered times are LOCAL) — this module
 * returns unix-SECONDS instants (nextFreeAt / fullResetAt); pipeline/limits.mjs formats them local.
 */
import { collapseOffers, dedupeSnapshots } from './reconstruct.mjs';

export const LIMIT_WINDOW_SEC = 4 * 60 * 60;   // GE buy limit is a rolling 4h window

/**
 * limitWindow({ buys, limit, now }) — the window reduction.
 *   buys  = [{ ts (unix SECONDS), qty }] of the item's BUY fills (see buysByItem for the canonical
 *           extraction from fills.json). Entries outside the window / with qty ≤ 0 are ignored.
 *   limit = the item's 4h buy limit (from the mapping), or null when UNKNOWN.
 *   now   = unix MILLISECONDS (Date.now()); defaults to now.
 * Returns:
 *   limit           the passed limit (null when unknown).
 *   boughtInWindow  Σ qty of buys with ts within the last 4h (LOWER bound — see honesty note).
 *   remaining       max(0, limit − boughtInWindow), or null when limit is null (UNKNOWN, not unlimited).
 *   nextFreeAt      oldest in-window buy ts + 4h — when capacity NEXT frees (unix sec); null if none in window.
 *   fullResetAt     newest in-window buy ts + 4h — when the window is FULLY clear again (unix sec); null if none.
 */
export function limitWindow({ buys, limit, now = Date.now() } = {}) {
  const nowSec = Math.floor(now / 1000);
  const cutoff = nowSec - LIMIT_WINDOW_SEC;
  const inWin = (buys || []).filter(b => b && b.ts != null && b.ts > cutoff && b.qty > 0);
  const boughtInWindow = inWin.reduce((s, b) => s + b.qty, 0);
  const lim = (limit == null) ? null : limit;
  const remaining = lim == null ? null : Math.max(0, lim - boughtInWindow);
  let nextFreeAt = null, fullResetAt = null;
  if (inWin.length) {
    let oldest = Infinity, newest = -Infinity;
    for (const b of inWin) { if (b.ts < oldest) oldest = b.ts; if (b.ts > newest) newest = b.ts; }
    nextFreeAt = oldest + LIMIT_WINDOW_SEC;
    fullResetAt = newest + LIMIT_WINDOW_SEC;
  }
  return { limit: lim, boughtInWindow, remaining, nextFreeAt, fullResetAt };
}

/**
 * buysByItem(events) — the CANONICAL per-item buy-fill extraction from the fills.json event stream.
 * Uses the SAME derivation-layer interpretation reconstruct.mjs uses (FILLS-PIPELINE §5.1): collapse
 * the per-transition stream to one row per offer via `collapseOffers(dedupeSnapshots(events))` (taking
 * each offer's FINAL cumulative `filled`), then keep only real GE BUY offers that actually filled
 * (`type === 'buy' && filled > 0`). BANKED lots (pre-owned stock, type 'banked') are NOT GE purchases
 * and are excluded — a buy limit only counts things bought through the GE. Each buy contributes one
 * { ts: offer close time (unix sec), qty: filled } entry.
 * Returns Map<itemId, [{ ts, qty }]>.
 */
export function buysByItem(events) {
  const offers = collapseOffers(dedupeSnapshots(events || []));
  const byItem = new Map();
  for (const o of offers) {
    if (o.type !== 'buy' || !(o.filled > 0)) continue;
    const arr = byItem.get(o.itemId) || byItem.set(o.itemId, []).get(o.itemId);
    arr.push({ ts: o.tsClose, qty: o.filled });
  }
  return byItem;
}

