/** digest.mjs — the digest's ask-reach read: basis selection + the stale-live guard. Importable so
 *  join-reach-basis.mjs scores the value the screen applies, not a copy. Rationale: CHANGELOG. */
import { placement, reachMargin, RECENCY_DIVERGE, RECENT_NIGHTS } from '../../../js/windowread.mjs';
import { MIRAGE_PLACEMENT, reachFraction, reachBasis } from './estimators.mjs';

export const MIRAGE_REACH_FRAC = 0.70;    // PLACEHOLDER n≈0; F1 owns the value.
// ⚠ recent-3 is deliberate — it disagrees with the full-window fold/rank by design, measured, not drift.
// One home: `reachFraction`. Not a FILTER either: below cost ratio ~1.29 never gating beats both bases
// (README join-reach-basis.mjs). The symmetric exemption is the caller's — see digestReachAndPlacement.
function digestReachFrac(askReachExtra) {
  return reachFraction(askReachExtra, { prefer: 'recent' });
}
// A stale live sell print fakes reach, so reach/placement re-score against the fresher instasell off
// the in-hand daily-HIGH distribution. Digest-scoped. `days` adds the ask cushion trend; null on
// symmetric niches, whose tight two-sided band mismeasures it.
export function digestReachAndPlacement({ spec, row, askReachExtra, his, days } = {}) {
  const symmetric = !!(spec && spec.fillShape === 'symmetric');
  const optSell = (row && row.optSell != null) ? row.optSell : null;
  const staleSell = !!(row && row.quickStale && row.quickStale.sell);
  const fresher = (row && row.quickBuy != null) ? row.quickBuy : null;
  const guarded = staleSell && optSell != null && fresher != null && fresher !== optSell;
  const refLevel = guarded ? fresher : optSell;
  const askPlacement = (his && his.length && refLevel != null) ? placement(his, refLevel) : null;
  // Placement-bounded, matching families.mjs symmetricExemptionHolds at the same bound and refLevel: an
  // above-distribution churn ask takes the full read so the verdict can name the mirage, not exempt it.
  const exempt = symmetric && !(askPlacement != null && askPlacement > MIRAGE_PLACEMENT);
  let reachFrac, basis = null;
  if (exempt) reachFrac = null;
  else if (guarded && his && his.length) {
    // The validator's reach was scored at the stale optSell.
    reachFrac = his.filter(h => h != null && h >= refLevel).length / his.length;
    basis = 'guarded';
  } else {
    reachFrac = digestReachFrac(askReachExtra);
    if (reachFrac != null) basis = reachBasis(askReachExtra, { prefer: 'recent' });
  }
  // Zero new fetch; degrades to null rather than inventing a read.
  const marginTrend = (!exempt && Array.isArray(days) && days.length && refLevel != null)
    ? (reachMargin(days, 'ask', refLevel)?.trend ?? null) : null;
  // Higher in the recent-3 CDF than the full one = recent days abandoned that top; the mirage rule ANDs
  // it with a falling cushion. DIRECTIONAL, not |diff| — a level that got EASIER is the opposite.
  let placementDiverges = false;
  if (!exempt && Array.isArray(days) && days.length && refLevel != null && askPlacement != null) {
    const recentHis = days.slice(-RECENT_NIGHTS).map(([, n]) => n && n.hi).filter(x => x != null).sort((a, b) => a - b);
    if (recentHis.length) {
      const recentPlacement = placement(recentHis, refLevel);
      placementDiverges = (recentPlacement - askPlacement) >= RECENCY_DIVERGE;
    }
  }
  return { reachFrac, reachBasis: basis, askPlacement, staleGuarded: guarded, marginTrend, placementDiverges };
}
