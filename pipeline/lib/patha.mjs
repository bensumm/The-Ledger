/* patha.mjs — Path-A (intraday-flip) gp/day calculator (PLAN-LANE-ADMISSION Chunk C).
   PURE: no fetch, no fs, no archive handle. Takes Chunk A's already-loaded per-item daily-range data
   (the `ranges[id]` slice of `marketfetch.mjs` loadDailyRangeBulk → { [dateKey]: {hi, lo} }) plus the
   item's price / buyLimit / volDay / lane, and returns a comparable after-tax **Path-A gp/day**.

   WHAT PATH A IS (from the plan): the CALIBRATED intraday-flip base rate — buy and sell within the day,
   capturing a FRACTION of the intraday daily-range. It is validated against realized P/L (lots held
   <12h won 88–92% and printed +29.5m; realized margin ≈ 0.45× gear / 0.62× churn of the fetched
   intraday range). It is EXPLICITLY NOT the multi-day amplitude swing (Path B), and — critically for a
   future reader — it is EXPLICITLY NOT `expGpDay` (js/rating.mjs demoted that to a pre-fetch pool
   orderer at P6b; the live displayed quality composite is `rateItem`). This is a genuinely NEW sortable
   quantity — hence the deliberately distinct export name `pathAGpDay`. Do not conflate the three.

   captureFrac 0.45 (gear) / 0.62 (churn) are PLACEHOLDERS (process rule 4): n=13/12, own-book-biased
   (fast-flip-styled), modest samples — NOT outcome-calibrated. They are re-estimated FROM the forward
   join (H2/H4) once accrual supports it; until then Path-A gp/day is a COARSE TIERING signal, never a
   hard gate/auto-action (plan H4). The daily-range-percentile MATH itself (the median / quotecore
   quantile reuse) is validated infrastructure; only the captureFrac multiplier is the placeholder.

   METRIC DISCIPLINE (plan requirement #2, the make-or-break of this chunk): intradayDailyRange is the
   MEDIAN of the per-day (high − low) values — NOT max−min, NOT a single spike day — because captureFrac
   was calibrated against exactly that statistic (the median of per-day max-high − min-low). Using a
   different central statistic here silently invalidates the calibration.

   REUSE (do NOT reinvent): tax via `netMargin` (quotecore re-exports the ONE `tax()` from money-math.js
   — the after-tax per-day range is `netMargin(lo, hi) = (hi − tax(hi)) − lo`); the median via quotecore's
   ONE `median`/`quantileSorted` (SF-1) rather than a second percentile impl; the throughput (buy-limit
   ×6 refills ∧ 10% volume-share) via gatecandidates.mjs `expUnits` with capPerWindow = capital ÷ price —
   NO new refill/volume constants are invented here. (robustBand is quotecore's EDGE robustifier — p90/p10
   of prints — which is the wrong statistic for a CENTRAL range estimate, so we use `median`, quotecore's
   other percentile helper, not robustBand.) */
import { median, netMargin } from '../../js/quotecore.js';
import { expUnits } from './gatecandidates.mjs';

// captureFrac by admission lane (Chunk B's volume-regime split, orthogonal to FLIP_NICHES modes).
// PLACEHOLDERS — see header. gear (low-turnover, margin harvested over days) captures less of the
// intraday range than churn (high-turnover, harvested intraday).
export const CAPTURE_FRAC = { gear: 0.45, churn: 0.62 };
export const DEFAULT_CAPTURE_FRAC = CAPTURE_FRAC.gear;   // conservative default when lane is unknown
export function captureFracFor(lane) {
  return (lane && Object.prototype.hasOwnProperty.call(CAPTURE_FRAC, lane)) ? CAPTURE_FRAC[lane] : DEFAULT_CAPTURE_FRAC;
}

/* intradayDailyRange(dayRanges) — the robust CENTRAL after-tax intraday range for ONE item.
   dayRanges: { [dateKey]: {hi, lo} } (one item's slice of loadDailyRangeBulk's `ranges`).
   For each day computes the after-tax range `netMargin(lo, hi)` (reuses the ONE tax()), then takes the
   MEDIAN across days (the calibrated statistic). Days missing hi/lo are skipped. Returns the median gp
   (may be small/≤0 when tax dominates a thin range — kept honest, not floored), or null if no day has a
   usable hi/lo pair. */
export function intradayDailyRange(dayRanges) {
  if (!dayRanges || typeof dayRanges !== 'object') return null;
  const perDay = [];
  for (const dateKey in dayRanges) {
    const r = dayRanges[dateKey];
    if (!r) continue;
    const { hi, lo } = r;
    if (!(hi > 0) || !(lo > 0)) continue;     // need both sides of the day's range
    const afterTax = netMargin(lo, hi);       // (hi − tax(hi)) − lo — the ONE tax definition, reused
    if (afterTax == null) continue;
    perDay.push(afterTax);
  }
  if (!perDay.length) return null;
  return median(perDay);   // quotecore's ONE type-7 median (SF-1) — the calibrated central statistic
}

/* pathAGpDay(args) — the Path-A after-tax gp/day for ONE item.
   args:
     dayRanges  : { [dateKey]: {hi, lo} }  — this item's Chunk-A daily-range slice (required for a number)
     price      : buy price (mid / avgLow) used for affordability + capital sizing
     buyLimit   : GE 4h buy limit, or null (null → inferred from volDay, see below)
     volDay     : corrected trailing-24h volume (limiting side)
     lane       : 'gear' | 'churn' (Chunk B admission lane) → selects captureFrac
     capital    : deployable gp for one buy-window tranche (default Infinity = capital-blind)
     captureFrac: optional explicit override (Chunk-G recalibration hook); else derived from lane
     intradayRange: optional precomputed intradayDailyRange (skips recompute)

   Composition (each factor also returned so a reader/logger can see the build):
     marginU   = intradayDailyRange × captureFrac                         # after-tax gp/unit
     unitsCyc  = min(effLimit, floor(capital ÷ price))   (0 if unaffordable — never floored up to 1)
                 effLimit = buyLimit ?? volDay/24        (null-limit → volDay-inferred limit, plan)
     cyclesDay = throughput ÷ unitsCyc                                    # buy-limit refills ∧ vol-feasible
                 throughput = expUnits(effLimit, volDay, floor(capital÷price))   # reuses the ×6 + 10%-share
     gpDay     = marginU × unitsCyc × cyclesDay   (== marginU × throughput)

   `expUnits(limit, volDay, capPerWindow)` already IS the throughput this decomposes: its internal
   `perWindow = min(limit, capPerWindow)` is exactly unitsCyc, and its `min(perWindow×6, 0.10×volDay)`
   is unitsCyc × cyclesDay — so passing capPerWindow = floor(capital÷price) reuses the refill (×6) and
   volume-share (10%) constants WITHOUT re-deriving them, and cyclesDay = throughput ÷ unitsCyc falls out
   exactly (a plain flip where capital isn't binding gives cyclesDay = min(6, 0.10×volDay/limit), the
   legacy shape). gpDay is rounded for the headline; the factor fields are the raw values it was built
   from.

   Returns { gpDay, marginU, captureFrac, cyclesDay, units, price, intradayRange, lane } — the H1 `pathA`
   shape minus `rankInLane` (the ranker adds that). Returns null when no intraday range can be computed
   (cold/absent daily-range data) so a caller can cleanly omit the field. */
export function pathAGpDay({ dayRanges, price, buyLimit = null, volDay = 0, lane = 'gear', capital = Infinity, captureFrac, intradayRange } = {}) {
  const range = intradayRange != null ? intradayRange : intradayDailyRange(dayRanges);
  if (range == null) return null;               // no daily-range data → no Path-A number (honest omit)

  const frac = captureFrac != null ? captureFrac : captureFracFor(lane);
  const marginU = range * frac;

  // affordable units per cycle: floor so "unaffordable" (capital < price) → 0, never floored up to 1.
  const capUnits = (price > 0) ? Math.floor(capital / price) : 0;
  // null-limit fallback: infer a per-window limit from volume (volDay/24) so a limit=null item still
  // gets a per-cycle bound instead of leaning on capital alone.
  const effLimit = buyLimit != null ? buyLimit : (volDay > 0 ? volDay / 24 : null);
  const unitsCyc = effLimit != null ? Math.min(effLimit, capUnits) : capUnits;

  // throughput (units/day) via expUnits — reuses its ×6 buy-limit refills ∧ 10%-of-volDay share; passing
  // capUnits as capPerWindow makes expUnits' internal perWindow == unitsCyc, so the split is exact.
  const throughput = expUnits(effLimit, volDay, capUnits);

  const units = Number.isFinite(unitsCyc) ? unitsCyc : 0;   // guard the fully-unbounded degenerate case
  const cyclesDay = (units > 0 && Number.isFinite(throughput)) ? throughput / units : 0;
  const gpDay = Math.round(marginU * units * cyclesDay) || 0;

  return { gpDay, marginU, captureFrac: frac, cyclesDay, units, price: price ?? null, intradayRange: range, lane };
}
