/**
 * pace.mjs — the adaptive-loop pacing decision (PLAN-ADAPTIVE-LOOP AL1; input/tier spec in the
 * plan §4 + README entry). ONE pure function for both directions: pace(bookState) -> { tier,
 * nextWakeMin, stop, startable, reasons, idleTicks } picks the loop cadence, and the same tier is the
 * auto-start tier (R-AL-8). RECOMMENDS only (R-AL-2) — never sleeps, schedules, spawns, writes.
 * Zero imports by design (purity pinned in pace.test.mjs). HONESTY: every cadence constant is a
 * PLACEHOLDER pricing attention, never P(fill); validation path is AL2's recommend log.
 * A missing/stale offer `placement` reads committed, and a malformed qty stays exposure — the
 * FAST side, staleness can only slow the loop's loosening, never suppress a wake. `startable`
 * (real exposure on the book) is the auto-start predicate — TIER is not: an empty or
 * dip-armed-empty book paces as DRY/GLANCE but must never START a loop (R-AL-7).
 */

export const PACE_TIERS = ['ACTIVE', 'GLANCE', 'DEEP', 'DRY', 'IDLE'];

export const PACE_GLANCE_MIN = 15;        // = watch-positions CADENCE_LOOSE (kept literal: zero imports)
export const PACE_DEEP_MIN = 60;          // placeholder — deep-bid glance cadence
export const PACE_DRY_FALLBACK_MIN = 30;  // DRY wake when no --scan interval is supplied
export const PACE_ACTIVE_FALLBACK_MIN = 5;// ACTIVE wake when no class cadence is supplied (= CADENCE_MED)
export const PACE_CLASS_ACTIVE_MAX = 5;   // a class cadence at/under this is itself an ACTIVE trigger
export const PACE_IDLE_TICKS = 2;         // empty-book debounce before recommending STOP
export const PACE_DEAD_FACTOR = 2;        // presumed dead after this many missed wakes (R-AL-7)

const idx = t => PACE_TIERS.indexOf(t);
const n = v => (Number.isFinite(v) ? v : 0);

export function pace(input = {}) {
  const lots = n(input.lots);
  const offers = (Array.isArray(input.offers) ? input.offers : [])
    .filter(o => o && (!Number.isFinite(o.qty) || (o.qty - n(o.filled)) > 0));
  const alerts = Math.max(0, n(input.alerts)) + offers.filter(o => o.verdict === 'CANCEL-BID').length;
  const fills = n(input.fillsSince);
  const fresh = n(input.newExposure);
  const dipArmed = !!input.dipArmed;
  const classMin = Number.isFinite(input.classCadenceMin) ? input.classCadenceMin : null;

  const bids = offers.filter(o => o.side === 'buy');
  const asks = offers.filter(o => o.side === 'sell');
  const committed = bids.filter(o => o.placement !== 'deep' && o.verdict !== 'BID-BEHIND');
  const emptyBook = lots === 0 && offers.length === 0;

  const reasons = [];
  let tier;
  if (alerts > 0 || fills > 0 || fresh > 0 || (classMin != null && classMin <= PACE_CLASS_ACTIVE_MAX)) {
    tier = 'ACTIVE';
    if (alerts > 0) reasons.push(`${alerts} alert${alerts > 1 ? 's' : ''}`);
    if (fills > 0) reasons.push(`${fills} fill${fills > 1 ? 's' : ''} since last tick`);
    if (fresh > 0) reasons.push(`${fresh} new offer/lot${fresh > 1 ? 's' : ''}`);
    if (reasons.length === 0) reasons.push(`class cadence ${classMin}m`);
  } else if (lots > 0 || asks.length > 0 || committed.length > 0) {
    tier = 'GLANCE';
    if (lots > 0) reasons.push(`${lots} held lot${lots > 1 ? 's' : ''}`);
    if (asks.length > 0) reasons.push(`${asks.length} resting ask${asks.length > 1 ? 's' : ''}`);
    if (committed.length > 0) reasons.push(`${committed.length} near-live bid${committed.length > 1 ? 's' : ''}`);
  } else if (bids.length > 0) {
    tier = 'DEEP';
    reasons.push(`${bids.length} deep/behind bid${bids.length > 1 ? 's' : ''}, no held lots`);
  } else {
    tier = 'DRY';
    reasons.push('empty book');
  }

  // empty-book debounce toward STOP (only the DRY branch can ripen into IDLE)
  const idleTicks = emptyBook ? n(input.idleTicks) + 1 : 0;
  if (tier === 'DRY' && !dipArmed && idleTicks >= PACE_IDLE_TICKS) {
    tier = 'IDLE';
    reasons.push(`empty ${idleTicks} ticks`);
  }

  // R-AL-6: tightening jumps; loosening moves ONE tier per tick. No prevTier (fresh start,
  // R-AL-8) takes the computed tier directly — the IDLE debounce above already guards STOP.
  const prev = PACE_TIERS.includes(input.prevTier) ? input.prevTier : null;
  if (prev != null && idx(tier) > idx(prev) + 1) {
    tier = PACE_TIERS[idx(prev) + 1];
    reasons.push(`loosening one tier from ${prev}`);
  }

  // a --dip armed pool never loosens past GLANCE (flush latency), and never stops
  if (dipArmed && idx(tier) > idx('GLANCE')) {
    tier = 'GLANCE';
    reasons.push('dip pool armed');
  }

  if (n(input.awaitingRebuy) > 0) reasons.push(`${input.awaitingRebuy} awaitingRebuy (inform-only, does not hold the loop open)`);

  const stop = tier === 'IDLE';
  let nextWakeMin = null;
  if (tier === 'ACTIVE') nextWakeMin = Math.min(classMin ?? PACE_ACTIVE_FALLBACK_MIN, PACE_GLANCE_MIN);
  else if (tier === 'GLANCE') nextWakeMin = PACE_GLANCE_MIN;
  else if (tier === 'DEEP') nextWakeMin = PACE_DEEP_MIN;
  else if (tier === 'DRY') nextWakeMin = Number.isFinite(input.scanMin) ? input.scanMin : PACE_DRY_FALLBACK_MIN;
  if (nextWakeMin != null) nextWakeMin = Math.max(1, Math.round(nextWakeMin));

  return { tier, nextWakeMin, stop, reasons, idleTicks, startable: !emptyBook };
}

/**
 * loopPresumedDead(recommend, nowMs) — is the loop running? (R-AL-7)
 * DEAD ⇔ no recommend record, an explicit stop, or more than PACE_DEAD_FACTOR wakes elapsed since
 * the record was written. `recommend` is loop-state.json's { tier, nextWakeMin, stop, at } (at =
 * epoch ms). A record with no usable at/nextWakeMin is dead — an unreadable heartbeat is no heartbeat.
 */
// @provisional-api: consumers land in AL2 (run-loop recommend record) + AL5 (the auto-start check) — PLAN-ADAPTIVE-LOOP.
export function loopPresumedDead(recommend, nowMs = Date.now()) {
  if (!recommend || recommend.stop === true) return true;
  const at = Number(recommend.at), wake = Number(recommend.nextWakeMin);
  if (!Number.isFinite(at) || !Number.isFinite(wake) || wake <= 0) return true;
  return nowMs > at + PACE_DEAD_FACTOR * wake * 60_000;
}
