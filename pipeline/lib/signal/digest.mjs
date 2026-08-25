/**
 * digest.mjs — the digest's ASK-REACH INTERPRETATION: which basis the reach column reads, and how a
 * stale live print is guarded against before reach/placement/trend are scored.
 *
 * WHY IT IS ITS OWN MODULE. This logic lived inside `screen-flip-niches.mjs`, a 3,000-line command, so
 * nothing could import it. The concrete cost: `join-reach-basis.mjs` — the script written to SCORE this
 * very threshold — had to keep a hand-copied duplicate of `MIRAGE_REACH_FRAC`, with a comment warning
 * that the copy would not track the source. That comment's line reference had already gone stale. A
 * scorer that cannot import the thing it scores is the shape this extraction exists to remove.
 *
 * BYTE-IDENTICAL MOVE. Every line below is the original, unchanged; only its address moved. The screen's
 * stdout must not differ by a byte, and that is the falsifier for this change.
 *
 * WHAT DELIBERATELY DID NOT MOVE, and why — `digestVerdict` and `capEfficiency`. Both reach back into
 * command-local helpers (`weakDeploy` → `isBigTicket`, `gradeAtLeast`, `holdDays`), so moving them now
 * would either drag those along or create an import cycle. `isBigTicket` is additionally slated for
 * replacement by two explicitly-named predicates, so moving it first would be churn against the
 * byte-identical guarantee. They follow once that lands.
 */
import { placement, reachMargin, RECENCY_DIVERGE, RECENT_NIGHTS } from '../../../js/windowread.mjs';
import { MIRAGE_PLACEMENT, reachFraction } from './estimators.mjs';

// EXPORTED so the scorer can import it instead of hand-copying it (see the header).
export const MIRAGE_REACH_FRAC = 0.70;    // PLACEHOLDER (n≈0, freshly invented) — "still mediocre" recent-reach bar for the mirage rule
// digestReachFrac(askReachExtra): the RECENT ask-reach fraction for the digest's reach ✓/✗ column and
// verdict rules 1/2 — prefers the RC1 recent-3 count, full window fallback; no read → null. Whether a
// symmetric (churn/amplitude) niche is reach-EXEMPT (→ null, renders '—' NOT '✗' — a false alarm, §3.4)
// is decided by the CALLER (digestReachAndPlacement) since EF1(b) made the exemption placement-bounded.
// ⚠ DELIBERATELY RECENT-BASED — DO NOT "FIX" THIS BACK TO THE FULL WINDOW (RB-5, PLAN-RECENCY-BASIS).
// The rule has ONE home, the shared `reachFraction`; if it ever flips, flip it THERE, never by re-forking
// a local implementation. This column DISAGREES with the estimator's fold price and with `screen.json`'s
// rank/grade, and that split is MEASURED and deliberate, not drift:
//   · the fold price + its pFill (js/estimators/pair.mjs) are FULL-window — recent-3 is four-valued at
//     n=3, and forward-scoring found the full-window read is what discriminates (+9.8pp within-item,
//     p=0.0001, n=6,016); the RANK is full-window too, deferred pending a fills-joined study
//     (js/estimators/families.mjs:389);
//   · this column is RECENT — join-reach-basis.mjs (PLAN-REACH-BASIS-DECISION) forward-scored 7,904
//     deduped rows / 635 items against the 1h archive: recent-3 is the cheaper basis HERE, M(1)=+2.3pp,
//     item-clustered 95% CI [0.8, 3.8], sign stable across four horizons and both fold bases.
// ⚠ THE BIGGER RESULT IS ABOUT THE TAG, NOT THE BASIS: at equal error costs BOTH bases lose to never
// gating at all (never 2950 · recent 3493 · full 3668), so `sell unreliable` only pays for itself when a
// false green-light costs ≥ ~1.29× a false gate, and recent-3 only wins below r*=1.76 — a narrow
// 1.29<r<1.76 window. Do not read this column as a filter. Whether 0.5 is the right cut at all is F1's
// call, not a hand-tune.
function digestReachFrac(askReachExtra) {
  return reachFraction(askReachExtra, { prefer: 'recent' });
}
// POLISH 3 — STALE-LIVE GUARD for the digest's reach ✓/✗ + mirage read. A row's quoted optSell can be
// pinned to a STALE live instabuy print (an old /latest tick, not a live one — the SAME failure quote-
// items.mjs's `staleLiveNote` catches off `row.quickStale`, the QUICK_FRESH_MIN freshness flags computeQuote
// sets). When the SELL-side live print is stale, the ask-reach read (scored at that stale optSell) is a
// FALSE positive — the honest reference is the FRESHER instasell (row.quickBuy). This recomputes reach +
// placement against that fresher level off the 14-day daily-HIGH distribution (rbStats.his, already in hand),
// so a stale-inflated reach ✓ flips to the honest read. DIGEST-SCOPED: it touches ONLY the digest's
// reach/placement/mirage — never the screen's own reach validator notes, screen.json, or quote-items output.
// Non-stale rows fall straight through to the unchanged askReachExtra/optSell path (byte-identical).
// R4b (PLAN-SIGNAL-RECENCY): `days` is rbStats.days (the per-day windowStats buckets already in hand) — it
// feeds the ask-side reachMargin CUSHION-TREND token (fading|stable|extending), the digest-surface wiring of
// R4's rebased reachMargin. It informs the reach ✓/✗ column WITHOUT replacing it: a reach ✓ whose cushion
// over the ask is `fading` is a peak cooling ONTO the quoted sell (the godsword shape). Scored at the SAME
// `refLevel` the reach/placement use, so a stale-guarded row's trend reads at the fresher reference too;
// non-symmetric only (a symmetric churn/amplitude ask trend mismeasures the tight two-sided band → null → '—').
export function digestReachAndPlacement({ spec, row, askReachExtra, his, days } = {}) {
  const symmetric = !!(spec && spec.fillShape === 'symmetric');
  const optSell = (row && row.optSell != null) ? row.optSell : null;
  // reuse row.quickStale (the staleLiveNote source): sell-side live print stale → the fresher instasell is
  // the honest current reference. Only guards when a distinct fresher level exists.
  const staleSell = !!(row && row.quickStale && row.quickStale.sell);
  const fresher = (row && row.quickBuy != null) ? row.quickBuy : null;
  const guarded = staleSell && optSell != null && fresher != null && fresher !== optSell;
  const refLevel = guarded ? fresher : optSell;
  const askPlacement = (his && his.length && refLevel != null) ? placement(his, refLevel) : null;
  // EF1(b) (PLAN-ESTIMATOR-FIDELITY): the symmetric reach EXEMPTION is placement-bounded here exactly
  // as in the rank/fold (families.mjs symmetricExemptionHolds — same MIRAGE_PLACEMENT bound, evaluated
  // at the SAME stale-guarded refLevel this function's placement uses). A tight in-distribution churn
  // lap stays exempt (reach '—', no trend — byte-identical); an above-the-distribution churn ask takes
  // the standard reach/trend/divergence read, so the digest verdict can name the mirage instead of
  // exempting it ('Sapphire dragon bolts (e)': churn #1 while its ask read 1/14d). Amplitude rows never
  // route through here (renderAmplitudeMode passes reachFrac/askPlacement null directly) — untouched.
  const exempt = symmetric && !(askPlacement != null && askPlacement > MIRAGE_PLACEMENT);
  let reachFrac;
  if (exempt) reachFrac = null;
  else if (guarded && his && his.length)
    // recompute reach off the daily-HIGH distribution at the honest (fresher) reference — the validator's
    // recent-3 reach was scored against the stale optSell, so it can't be trusted here.
    reachFrac = his.filter(h => h != null && h >= refLevel).length / his.length;
  else reachFrac = digestReachFrac(askReachExtra);
  // R4b: the ask-side cushion trend at refLevel. reachMargin only needs the per-day buckets + the level for
  // its trend (pace/profile omitted — the digest surfaces trend only), so this is zero new fetch. Degrades
  // to null (→ '—') on a symmetric niche, a thin day sample, or no in-hand buckets — never a fake read.
  const marginTrend = (!exempt && Array.isArray(days) && days.length && refLevel != null)
    ? (reachMargin(days, 'ask', refLevel)?.trend ?? null) : null;
  // R5: the recent-vs-full placement DIVERGENCE (the whole-window-CDF analogue of RC1's recencySplit hit-count
  // idiom). askPlacement is the level's percentile in the FULL 14-day daily-HIGH distribution; recentPlacement
  // is its percentile in just the recent-3 days' highs. When the level sits HIGHER in the recent CDF than the
  // full one by ≥ RECENCY_DIVERGE (recent days abandoned that top), it's a stale-optimistic top — the SECOND
  // confirming signal the mirage rule ANDs with a falling cushion trend to escalate confidence. Directional
  // (recent − full ≥ threshold), not |diff|: a level that got EASIER recently is the opposite of a mirage.
  let placementDiverges = false;
  if (!exempt && Array.isArray(days) && days.length && refLevel != null && askPlacement != null) {
    const recentHis = days.slice(-RECENT_NIGHTS).map(([, n]) => n && n.hi).filter(x => x != null).sort((a, b) => a - b);
    if (recentHis.length) {
      const recentPlacement = placement(recentHis, refLevel);
      placementDiverges = (recentPlacement - askPlacement) >= RECENCY_DIVERGE;
    }
  }
  return { reachFrac, askPlacement, staleGuarded: guarded, marginTrend, placementDiverges };
}
