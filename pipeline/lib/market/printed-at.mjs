/**
 * printed-at.mjs — AB1 (PLAN-ASK-BACKTEST §4). The ATOM the whole ask-fill surface is built from.
 *
 * ONE QUESTION, ASKED PURELY: within `horizon` days after `from`, did ANY bucket in this series print
 * `avgHighPrice >= mid × (1 + premium)`? Plus the observed maximum, so a caller can see how far the
 * level was missed (or cleared) by rather than only a boolean.
 *
 * ── WHY `mid` IS AN INPUT AND NEVER COMPUTED HERE (the load-bearing design decision) ──
 * PLAN-ASK-BACKTEST §10 measured the cost of getting the base wrong: same items, 3d horizon, +2%
 * premium — pinned base 80.5% · VWAP 80.1% · instasell-side 93.4% · 72h window 78.0% · 6h window 81.2%
 * · last-print 73.3%. So the SIDE and the WINDOW of the mid move every level by 5–15pp, while
 * volume-weighting is a no-op (−0.4pp). If this module computed its own mid, every consumer would
 * silently inherit whichever choice it happened to make, and two consumers could disagree by ~10pp
 * while both "using the surface". Instead `mid` is a required argument, so the pinned definition
 * (prior-24h mean `avgHighPrice`, see `fill-surface.mjs:itemFeaturesFromSeries`) is enforced at the
 * CALL SITE and is visible in every caller's diff.
 *
 * ── PREMIUM IS OVER MID, NEVER OVER OUR OWN BID (§9.1) ──
 * `(ask − bid) / bid` conflates how greedy the ask is with how good the entry was: Ben's Masori chaps
 * order reads +5.84% over his buy and +1.59% over market mid. Only the market-relative one ranks.
 * This module has no concept of a bid, deliberately.
 *
 * ── ROW SHAPE: `timestamp`, NEVER `ts` ──
 * The archive stores `ts`; every estimator/consumer keys on `timestamp` (see archive-series.mjs's
 * header — the silent-drop trap). Feeding raw archive rows here would produce "nothing printed" with
 * no error, which is exactly the failure mode that surface would then bake in. So a `ts`-shaped row
 * THROWS: a contract violation is a programming error and must be loud. Genuine data gaps are
 * different and degrade honestly — see the return contract.
 *
 * ── RETURN CONTRACT: `printed` is TRISTATE ──
 *   true  — a bucket in the window printed at or above the threshold
 *   false — buckets exist in the window and none reached it
 *   null  — we cannot say (bad inputs, or no archived bucket in the window at all), with `reason` set.
 * `null` must NOT be collapsed to `false` by a caller. §10/M4: an unarchived bucket can never print,
 * so counting missing coverage as a miss mechanically depresses the measured level — the surface
 * builder drops these observations instead of scoring them.
 *
 * ── HONEST LIMIT (§5 risk 1, as CORRECTED by §8) ──
 * `avgHighPrice >= P` means buyers PAID >= P; it does not prove YOUR ask was taken. For a 1-unit lot
 * this is a conservative LOWER BOUND (a print at q >= P implies the ask book was empty below q, so a
 * resting 1-unit ask at P <= q would have been hit first) — the original plan text had this hedge
 * pointed the wrong way. It says nothing safe about SIZE: with qty above the flow at the level the
 * proxy over-states. Flow-at-level is a separate necessary check (AB4), not this function's job.
 *
 * Pure: no fetch, no archive handle, no clock, no I/O. Fixture-pinned in
 * pipeline/test/printed-at.test.mjs.
 */

const DAY = 86400;

/* printedAt(series, { mid, premium, horizon, from }) → the tristate result above.
 *   series  : ascending-or-not rows [{ timestamp, avgHighPrice, … }] (order is not required)
 *   mid     : the PINNED reference mid, in gp. REQUIRED — never derived here (see header).
 *   premium : fraction over mid, e.g. 0.02 for +2%. The threshold is mid × (1 + premium).
 *   horizon : window length in DAYS (not seconds — the surface is keyed by 1d/3d).
 *   from    : unix seconds; the window is EXCLUSIVE at `from`, INCLUSIVE at `from + horizon×86400`.
 *             Exclusive at the open end because `from` is the instant the mid was measured up to —
 *             letting the reference bucket also score the outcome would leak the answer into the input.
 */
export function printedAt(series, { mid, premium, horizon, from } = {}) {
  const bad = (reason) => ({
    printed: null, reason, threshold: null, maxHigh: null, maxPremium: null,
    atTs: null, buckets: 0, from: from ?? null, to: null,
  });
  if (!Number.isFinite(mid) || mid <= 0) return bad('no-mid');
  if (!Number.isFinite(premium)) return bad('no-premium');
  if (!Number.isFinite(horizon) || horizon <= 0) return bad('no-horizon');
  if (!Number.isFinite(from)) return bad('no-from');

  const to = from + horizon * DAY;
  const threshold = mid * (1 + premium);

  let maxHigh = null, atTs = null, buckets = 0;
  for (const r of series || []) {
    if (r == null) continue;
    if (r.timestamp == null) {
      // The archive's own row shape. Silent skipping here is how a whole surface reads "never printed".
      if ('ts' in r) throw new Error('printedAt: row carries `ts` but no `timestamp` — pass rows through archiveSeries() first (see archive-series.mjs header)');
      continue;
    }
    const t = Number(r.timestamp);
    if (!(t > from && t <= to)) continue;
    const hi = r.avgHighPrice;
    if (hi == null || !Number.isFinite(Number(hi))) continue;   // a bucket that traded no high side
    buckets++;
    if (maxHigh == null || Number(hi) > maxHigh) { maxHigh = Number(hi); atTs = t; }
  }

  if (buckets === 0) {
    // No archived high-side print in the window at all. NOT a miss — see the tristate note in the header.
    return { printed: null, reason: 'no-buckets', threshold, maxHigh: null, maxPremium: null, atTs: null, buckets: 0, from, to };
  }

  return {
    printed: maxHigh >= threshold,
    reason: null,
    threshold,
    maxHigh,
    maxPremium: maxHigh / mid - 1,   // the observed max expressed on the SAME basis as `premium`
    atTs,
    buckets,
    from,
    to,
  };
}
