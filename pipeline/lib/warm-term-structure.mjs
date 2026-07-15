/**
 * warm-term-structure.mjs — build a WARM multi-week term structure from a freshly-fetched 1h /timeseries.
 *
 * WHY. The `loadDaily` regime-proxy archive only began accruing 2026-07-08, so a `termStructure` off it
 * is COLD (classifyTrajectory → 'unknown', the 7d lookback thin) — but the 1h /timeseries spans weeks.
 * This aggregates the 1h series into a full-day daily-mid series (`windowStats` over a 0–0 window) and
 * returns the WARM `termStructure` so callers get a firing `.trajectory` (and the recent-week `.lookbacks`
 * value-amplitude reads) NOW instead of degrading on the cold archive.
 *
 * EXTRACTED (COD-4, 2026-07-10): this was inline in screen.mjs; quote.mjs's budgeted-ts1h read needs the
 * SAME warm trajectory so reach/trajectory FIRE on the explicit-ask surface (fixing the A4 asymmetry).
 * ONE home so the two surfaces can't drift. Pure over an already-fetched 1h array — no fetch/fs/DOM.
 *
 * floorValidator deliberately keeps the loadDaily source (its documented, thresholds-tuned durable-floor
 * proxy — a LEVEL read that wants the archive's regime-proxy spacing, not the 1h shape); callers override
 * only `.trajectory` on the loadDaily-based structure with `trajectoryFrom1h`.
 */
import { windowStats } from '../../js/windowread.mjs';
import { termStructure } from '../../js/termstructure.mjs';

/* richFrom1h(ts1h, nights) → the WARM termStructure off the 1h series, or null when thin (<6 daily
   buckets) / absent. Returns the full structure so callers can take BOTH the warm .trajectory AND the
   warm recent-week .lookbacks (value-amplitude's basis). */
export function richFrom1h(ts1h, nights = 28) {
  if (!ts1h || !ts1h.length) return null;
  const now = new Date();
  const ws = windowStats(ts1h, { nights, wStart: 0, wEnd: 0, now });
  if (!ws || !ws.days || ws.days.length < 6) return null;
  const N = ws.days.length, DAY = 86400, nowSec = Math.floor(now.getTime() / 1000);
  const series = ws.days.map(([, n], i) => ({
    ts: nowSec - (N - 1 - i) * DAY,
    mid: (n.low != null && n.hi != null) ? (n.low + n.hi) / 2 : (n.low != null ? n.low : n.hi),
  }));
  const rich = termStructure(series, { now: nowSec });
  return rich && rich.hasData !== false ? rich : null;
}

/* trajectoryFrom1h(ts1h, nights) → the warm .trajectory (or null when thin/unknown) — the shape override
   a caller applies to its loadDaily-based structure so trajectory FIRES while the archive is still cold. */
export function trajectoryFrom1h(ts1h, nights = 28) {
  const rich = richFrom1h(ts1h, nights);
  return rich && rich.trajectory && rich.trajectory.shape !== 'unknown' ? rich.trajectory : null;
}
