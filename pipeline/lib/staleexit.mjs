/* staleexit.mjs — Proposal C (2026-07-12): the STALE DECLARED-EXIT read for a held lot.
 *
 * THE MISS IT ENCODES. A hold-thesis exit (`thesis.mjs set … --exit <gp>`, hold-thesis.json) is
 * declared ONCE, off the peaks visible at declaration time — and then the market moves. The
 * 2026-07-12 case: declared exits 44.34m (Masori) / 3.24m (Berserker) were set off old peaks that
 * recent nights no longer print, so the rendered `HOLD — per thesis: exit <X>` frame kept naming an
 * ask the market had stopped reaching. This module answers ONE question, inform-only: "does the
 * recent reach history still support the DECLARED exit level, and if not, what level DOES it
 * support?"
 *
 * REUSE, NOT RE-DERIVATION (the reachValidator discipline, js/validate.mjs). All the math is
 * js/windowread.mjs's existing reach machinery over an already-fetched 1h series:
 *   - windowStats over the FULL local day (wStart=0, wEnd=0 → every hour; complete nights only) —
 *     an exit can print at any hour, so the stale check scores whole nights, not an 8h slice;
 *   - recencySplit(days, 'ask', exit) — the RC1 recent-vs-full hit split (RECENT_NIGHTS=3);
 *   - recentQuant(days, 'ask', 0.5) — the recent-nights ~50% reachable high, the level we NAME
 *     instead of the stale one.
 * The min-sample floor is imported from reachValidator (REACH_MIN_DAYS) so the two reads can't
 * drift apart. NOTHING here fetches — the caller owns the (TTL-cached, targeted) 1h series.
 *
 * INFORM-ONLY CONTRACT (hard): the result is a NOTE on quote.mjs --positions. It NEVER moves a
 * quoted number, never changes a gate/verdict/momVerdict, never touches the break-even floor, and
 * never edits the declared thesis — Ben re-declares the exit if he agrees with the read.
 *
 * HONESTY (process rule 4): STALE_EXIT_RECENT_FRAC is a PLACEHOLDER (n≈0 — anchored on exactly the
 * two 2026-07-12 lots, not a calibrated cutoff). "Reached" is windowread's touch semantics over 1h
 * avgHigh buckets — touched ≠ filled, and ~14 nights is a small sample; the read degrades to null
 * (silent) on any thin/missing history rather than crying stale off nothing.
 */
import { windowStats, recencySplit, recentQuant, RECENT_NIGHTS } from '../../js/windowread.mjs';
import { REACH_MIN_DAYS, REACH_NIGHTS } from '../../js/validate.mjs';

// PLACEHOLDER (n≈0): the declared exit is STALE when it printed on FEWER than this fraction of the
// recent nights (recencySplit's RECENT_NIGHTS=3 ⇒ stale = reached ≤1/3 recent; 2/3 exactly is fresh).
export const STALE_EXIT_RECENT_FRAC = 2 / 3;
// The named replacement level: the recent-nights ~50% quantile high — "half the recent nights print
// at/above this", the same quantile family windowrange.mjs's summary line quotes.
export const STALE_EXIT_REACHABLE_P = 0.5;

/* staleExitRead({ ts1h, exitLevel, now }) → null | {
 *     stale,                          — true when the declared exit fails the recent-reach bar
 *     recentHit, recentDays,          — reached N of the last RECENT_NIGHTS complete nights
 *     fullHit, fullN,                 — …and N of the full ~REACH_NIGHTS-night window
 *     reachable,                      — the recent ~50% reachable high (may be null on a thin tail)
 *   }
 * null = unscorable (no series / thinner than reachValidator's own REACH_MIN_DAYS floor / recency
 * split unscored) — the caller stays SILENT, never flags off missing data. PURE, no fetch. */
export function staleExitRead({ ts1h, exitLevel, now = new Date() } = {}) {
  if (!Array.isArray(ts1h) || !ts1h.length) return null;
  if (typeof exitLevel !== 'number' || !Number.isFinite(exitLevel)) return null;
  // Full-day window: wStart === wEnd → inWindow() admits every hour; complete nights only (today is
  // always inside the window, so windowStats skips it — the same semantics the reach read relies on).
  const stats = windowStats(ts1h, { nights: REACH_NIGHTS, wStart: 0, wEnd: 0, now });
  if (!stats) return null;
  const rc = recencySplit(stats.days, 'ask', exitLevel);
  // degrade like reachValidator: an unscored split (short recent tail / short full window) or a full
  // window thinner than the reach min-sample floor never yields a stale call.
  if (rc.fullN < REACH_MIN_DAYS || !(rc.recentDays >= RECENT_NIGHTS && rc.fullN >= RECENT_NIGHTS + 2)) return null;
  return {
    stale: rc.recentFrac < STALE_EXIT_RECENT_FRAC,
    recentHit: rc.recentHit, recentDays: rc.recentDays,
    fullHit: rc.fullHit, fullN: rc.fullN,
    reachable: recentQuant(stats.days, 'ask', STALE_EXIT_REACHABLE_P),
  };
}
