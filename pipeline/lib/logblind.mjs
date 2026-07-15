/**
 * logblind.mjs — LH2 restart-blindness detector for monitor-offers.mjs / watch-positions.mjs headers.
 *
 * THE PROBLEM (2026-07-05, the 10:21 all-slots-blank read): the Exchange Logger plugin emits
 * only on a slot STATE CHANGE. After a client restart it re-emits nothing until each slot next
 * changes, so for minutes-to-hours the live exchange log shows NO active offers even though offers
 * are resting in-game. monitor-offers.mjs / watch-positions.mjs then read "NOT LISTED / no active bids" and a session
 * burns rounds chasing offers that "vanished." This is a plugin emit-on-change artifact, NOT fixable
 * in reconstruction — but it IS detectable, and the fix is a single honest warning line.
 *
 * CHOSEN HEURISTIC (and why): the simplest signal that is both reliable and fully SELF-CONTAINED —
 * it needs only values monitor-offers.mjs / watch-positions.mjs already read, no fragile RuneLite launcher.log /
 * client.log mtime parsing (client.log is rewritten continuously while running, so its mtime is not
 * a clean restart marker, and the launcher is not always used). Fire the warning when ALL of:
 *   (1) the newest exchange-log line is STALE (age ≥ BLIND_STALE_MIN) — the log is not currently
 *       tracking live slot changes; AND
 *   (2) the log shows ZERO active offers right now; AND
 *   (3) there IS committed capital the log should be reflecting — proxied by open held lots > 0
 *       (held inventory is normally resting as sell offers).
 * The three conditions coinciding is exactly the post-restart blind state and is very unlikely
 * otherwise (a genuinely idle desk with no positions fails condition 3; an actively-updating log
 * fails condition 1; a log showing your offers fails condition 2). Low false-positive by design.
 *
 * HONEST LIMITATION (documented, not hidden): it cannot see a blind state where you hold NO
 * inventory but have only resting BIDS (condition 3 is inventory-based). That case wasn't the
 * incident and adding launcher parsing to cover it would trade reliability for reach — deliberately
 * not done. The warning is a heads-up to restart-check RuneLite / nudge a slot to force a re-emit;
 * it changes no verdict or annotation (plan LH2.2).
 */

// Minutes of exchange-log silence past which, combined with held inventory and no visible offers,
// the log is treated as possibly blind. 20m is comfortably longer than an active flipping cadence
// (offers change every few minutes when live) yet short enough to catch a fresh restart quickly.
export const BLIND_STALE_MIN = 20;

/**
 * Pure header-line assembler (plan LH2.3 tests THIS, never the filesystem probe). Returns the
 * warning string when the blind heuristic fires, else null.
 * @param {{ staleMin:number, activeOfferCount:number, openLotCount:number, thresholdMin?:number }} x
 */
export function blindWarningLine({ staleMin, activeOfferCount, openLotCount, thresholdMin = BLIND_STALE_MIN }) {
  if (!(staleMin >= thresholdMin)) return null;      // log is fresh — not blind (NaN-safe: NaN fails)
  if (activeOfferCount !== 0) return null;           // the log IS showing offers — not blind
  if (!(openLotCount > 0)) return null;              // no committed inventory that should be listed
  return `⚠ log may be blind — the exchange log has shown no active offers for ${staleMin}m while you hold ${openLotCount} open lot(s); the plugin re-emits nothing after a client restart, so resting offers may be stale/missing. Restart-check RuneLite or nudge a slot to force a re-emit.`;
}
