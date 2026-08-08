# PLAN-BOTH-LEG-ENTRY — solve for the entry that makes BOTH legs reach

**Status: PROPOSED (2026-08-08).** Nothing built. Motivated by a live miss the same night — see §1.

## 1. Why — the Dinh's bulwark miss

Every surface quotes **an** entry. None solves for **which** entry makes both legs reach.

- `--mode amplitude` quotes the **median daily low** (`AMP_BID_Q = 0.5`) → 12.25m. Recent reach **1/3**.
- `quote-items` quotes a **reach-folded bid** → 12.80m. Break-even 13.06m, which is *above* mid (13.02m).
- Both were evaluated and Dinh's bulwark was called dead.

Ben proposed **12,501,000** by hand. Measured on the 5m archive, 16 complete days:

| level | reach | note |
| --- | --- | --- |
| bid 12,501,000 | **14/16 · recent 3/3** | BE 12,756,123 |
| ask 13,147,360 | 8/16 · recent 3/3 | +383k/u (3.07%) |
| ask 13,300,000 | 6/16 · recent 3/3 | **+533k/u (4.26%)** |

The hand-picked entry is ~2% *higher* than amplitude's, costs almost nothing in net (both sit far below
the exit), and roughly triples entry reach. **The objective was never optimised — it was pinned at a
quantile.** That is the whole chunk.

## 2. Three verified defects in the current both-leg read

All in `js/amplitudescreen.mjs`:

1. **`pFill2leg = clamp01(bidFrac) * clamp01(askFrac)` (:161) is a PRODUCT OF MARGINALS, not a measured
   joint.** Days the bid was touched and days the ask was reached are counted independently and
   multiplied. For a mean-reverting oscillator these are not independent in either direction: a deep-dip
   day may be a down-day that never rallies (negative dependence), or a wide-range day may do both
   (positive dependence). The product cannot tell those apart.
2. **No same-day ORDERING check.** `legOk` (:199-202) tests each leg separately. A day whose HIGH printed
   at 09:00 and whose LOW printed at 22:00 counts as a both-leg day, but is not tradeable buy→sell that
   day. The amplitude playbook is explicitly *"buy the daily TROUGH, sell the daily PEAK, hold ~a day"*,
   so ordering is load-bearing, not a refinement.
3. **The levels are quantile-pinned, not chosen** — `ampBid = quantLow(lows, 0.5)`,
   `ampAsk = quantHigh(his, 0.5)` (:151-152). There is no search. `--amp-bid-q`/`--amp-ask-q` move the
   quantile but still do not optimise anything.

## 3. The objective

For a candidate pair `(bid, ask)` over N complete local days:

```
joint(bid, ask) = |{ days where low ≤ bid AND high ≥ ask AND t(low) < t(high) }| / N
net(bid, ask)   = afterTax(ask) − bid          // the shared tax-capped helper, never a private copy
EV(bid, ask)    = net(bid, ask) × joint(bid, ask)
```

Maximise `EV` over a grid drawn from the item's own observed daily low/high distribution. Report the
argmax AND the frontier, because Ben picks the risk/return point, not the tool.

**`joint` is measured, never `bidFrac × askFrac`.** That is defect 2.1, and the fix is to count
co-occurrence directly — it costs nothing extra, the day bars are already in hand.

## 4. Chunks

| id | what | dep | size |
| --- | --- | --- | --- |
| **BL1** | `pipeline/lib/signal/bothleg.mjs` — the PURE core. `dailyBars(series)` → per-day `{lo, hi, tLo, tHi, n}` from a 5m/1h series (ordering needs the timestamps, so bars carry them). `bothLegFrontier(bars, {taxFn, bidGrid, askGrid, requireOrder=true})` → `[{bid, ask, joint, jointNoOrder, net, ev, recentJoint}]` + `best`. No fetch, no archive handle, no clock. Fixture-pinned: ordering flips a known day; `joint ≤ min(bidFrac, askFrac)` always; empty/1-day input → null, never a fabricated read. | — | **M** |
| **BL2** | `pipeline/commands/read-both-leg.mjs "<item>"` — READ-ONLY console surface. Opens the archive `open(undefined, {readonly:true})` ONLY, prefers **5m** grain (see §5), builds bars, prints the EV-max pair + the frontier + a recent-3 column beside the full-window one. Writes no artifact, never in a commit/sync path. | BL1 | **M** |
| **BL3** | Fold the measured joint into `amplitudeRead` — `pFill2leg` becomes the measured `joint` (ordering enforced) instead of the product, and the row surfaces the EV-max `(bid, ask)` **beside** the quantile-pinned pair rather than replacing it. Behind `--both-leg`, DEFAULT OFF; the shipped board is unchanged until BL4 compares them. | BL1 | **M** |
| **BL4** | Validation sweep over the amplitude pool: how often does ordering flip a both-leg day to false? How far does the EV-max bid sit from the median-low bid, and how much EV is left on the table? Report only — no threshold changes. | BL2, BL3 | **S** |

## 5. Grain — 5m, and why (measured 2026-08-08)

The reach annotations across the scan ride on the **1h** series (`reachValidator` scores 1h). Measured on
Dinh's, 1h understates the true daily low by **2k–55k typically (~0.3%), with outliers to 277k (2.2%)**,
and at the 12.25m level that is worth **2 days out of 16** (8/16 at 1h vs 10/16 at 5m). So BL2 prefers 5m.

Three honest limits on that:
- The 5m archive spans only **~30 days** vs 1h's ~71, so a 5m read buys precision and pays in window
  count — the same trade the AB fill surface faced, where a 5m rebuild collapsed `>=10m` cells to n=10.
  **BL2 must print which grain it used and the day count**, and fall back to 1h with a loud note.
- **Even 5m is an average.** `avgLowPrice` is the mean of instasell prints in the bucket, so the true
  minimum print is lower than either grain shows. No grain gives tick data; the wiki exposes none.
- Ordering (`tLo < tHi`) is measured at bucket resolution. At 5m that is fine for a day-long cycle; it
  would not be for an intraday scalp.

## 6. What this is NOT

- **Not a forecast.** `joint` is historical co-occurrence frequency over N days. It says the pair was
  jointly reachable that often, not that it will be. Same n≈0 status as everything in the amplitude lane.
- **Not a fill model.** A day whose low ≤ bid means trades printed there; it does not mean *your* unit
  filled — queue position and size are unmodelled. Upper bound, exactly as `printedAt` is on the ask side.
- **Not a sizing tool.** Thin big-tickets stay thin: Dinh's is 350/d, and the clearability rule still says
  1 unit. Finding a better entry does not make the exit deeper.
- **Not a replacement for the quantile board** until BL4 says so. BL3 ships default-off and additive.

## 7. Open questions

- Should `joint` be recency-weighted rather than a flat N-day count? Dinh's reads **6/16 full but 3/3
  recent** at the 13.30m ask — the regime shifted (ceiling +211.2k/d) and the flat count understates it.
  The existing `recencySplit`/`staleOptimistic` machinery already models this; reuse it rather than
  inventing a second recency basis (PLAN-RECENCY-BASIS: one recency basis, one home).
- Does the EV-max pair beat the median pair on *realised* fills? Unanswerable until fills accrue —
  the `join-amplitude-outcomes.mjs` shadow replay is the natural place to log both and compare.
- Does this generalise off the amplitude lane? The same objective applies to band. Out of scope here.
