# PLAN-BOTH-LEG-ENTRY — CLOSED, NEGATIVE RESULT

**Status: CLOSED (2026-08-08). Nothing was built, and nothing should be.** The plan's own BL4 gate —
*"if the frontier does not beat the median out-of-sample, BL3 stays off and this plan is closed as a
negative result"* — was run **before** BL1, on the real archive, and it failed. This file is kept as a
don't-rebuild record.

Prior drafts: `git show 9e5a9e3:plans/PLAN-BOTH-LEG-ENTRY.md` (original),
`git show 3d28259:plans/PLAN-BOTH-LEG-ENTRY.md` (re-derived after the first adversarial pass).

## What was proposed

Replace `js/amplitudescreen.mjs`'s quantile-pinned entry pair (`AMP_BID_Q`/`AMP_ASK_Q` = 0.5) with a
grid search maximising `EV = net(bid,ask) × joint(bid,ask)`, where `joint` is the measured fraction of
days on which both legs were reachable. Motivated by a live miss on Dinh's bulwark (21015), where a
hand-picked 12,501,000 bid tripled entry reach over the median-low bid the tool quoted.

## Why it was closed — three measurements, all adverse

Measured on the live archive, 1h grain, 14 complete LOCAL days, 238 items passing the lane's own gates.

**1. The search loses out-of-sample.** Walk-forward (train 9 days, test 4 buy-days, 238 items):

| basis | in-sample EV/price | out-of-sample |
| --- | --- | --- |
| grid argmax | 3.80% | **0.48%** |
| median pin (shipped) | 1.84% | **0.49%** |

Statistically identical OOS, and the argmax *loses* the paired comparison — beats the median on 28/238
items, loses on 45, ties 165. Its `joint` shrinks 0.394 → 0.079 under holdout. Shipping it would have
displayed an ~8× inflated EV to the operator while delivering nothing.

This is structural, not a tuning failure: `joint` is a step function changing only at observed extremes
and `net` is monotone in both legs, so the argmax always lands exactly **on** an order statistic with
zero out-of-sample margin. Split-half on the motivating item: test-EV = 0 in **7 of 8** splits.
**The median it set out to replace is the robust estimator.**

**2. The proposed ordering constraint was wrong twice, and worse than the error it fixed.** The plan
defined tradeability as `t(low) < t(high)` on the day's *extremes*, scoped to one day. Both halves fail:
extremes-ordering is the wrong event (pool-wide it keeps 52% of both-leg days where correct
first-touch-before-later-reach keeps 62%), and same-day scoping contradicts `AMP_HOLD_DAYS_DEFAULT`
being a parameter at all (`js/amplitudescreen.mjs:89-91`; `--hold-days 1.5` deliberately crosses the
boundary). Aggregate joint under the plan's definition: **0.057**, against a strategy-correct
hold-≤1d joint of **0.161** — a **2.8× undercount**, larger in magnitude than the ~1.6× overcount it
claimed to fix. The plan also mischaracterised the code: `legOk` (`:199-200`) never counts both-leg days
at all; each leg is scored on its own day set.

**3. The product-of-marginals defect is real in construction but ~zero in effect on the shipped path.**
`pFill2leg = bidFrac × askFrac` (`:161`) genuinely cannot represent dependence, and on the **full-window
fallback** basis it overstates by **2.3–3.5×** (median-pinned levels force both marginals ≈ 0.5, so the
product is ≈0.25 for essentially every item by construction — 236/238 items had `bidFrac` exactly 0.50).
But the **shipped** basis is the recent-3 fracs, which `recencyScored` selects almost always on a 14-day
window: mean `pFill2leg` **0.102** vs realized recent-3 hold-≤1d joint **0.116** — approximately
calibrated, slightly conservative, overstating on only **35/312 (11%)** of items. At n=3 a measured
joint is {0, ⅓, ⅔, 1} noise anyway; the product borrows strength from the marginals and lands about
right in aggregate.

## What the motivating case actually was

Re-measured through the plan's own objective, the Dinh's pair collapses: bid 12,501,000 reaches 14/16
and ask 13,300,000 reaches 6/16 (the marginals the first draft headlined as "+533k/u"), but the ordered
joint is **3/16** and the "recent 3/3" story is **2/3** once ordered (on 08-06 the high printed 01:00 and
the low 14:50). At the 1 unit the clearability rule allows on a 350/d item that is ~100k gp/day
in-sample and **14–56k held-out**, against the `/scan` doctrine's **500k gp/d** attention floor. The
first draft never ran that check.

The hand-picked entry was still *better than what the tool quoted* — that part was real. What was not
real is that a search would have found it reliably.

## What survives — two narrow items, neither a rebuild of this plan

1. **The full-window fallback overstatement is worth a cheap fix.** When `recencyScored` fails and
   `pFill2leg` falls back to `fullFrac × fullFrac`, the number is 2.3–3.5× optimistic *and* is ≈0.25 for
   every item, i.e. carries no information. Either measure the joint on that path or mark the row's
   two-leg probability as unscored. Small, contained, and does not touch the shipped recent-3 path.
2. **The bid quantile may want to be shallower, and the dial already exists.** A sweep of 36 fixed
   `(bidQ, askQ)` pairs under the same walk-forward put the shipped 0.5/0.5 at rank 16/36, with the best
   cell at bidQ 0.7 / askQ 0.4 (shallower entry, greedier ask) — weak directional support for exactly
   Ben's hand-picked move. **Every cell's OOS median is 0.000%**; the differences are tail-driven on one
   test window and are not significant. This is an **F-G experiment note** reachable through the
   existing `--amp-bid-q` flag, **not a code change and not a default change.**

## The lesson worth keeping

The plan diagnosed a real gap — the tool quotes *an* entry and never solves for *which* entry — and then
proposed a solution that was worse than the thing it replaced, on every axis that was measured. Two of
its three cited defects did not survive contact with data, and it missed the one unambiguous bug in the
file it was attacking: `amplitudeProxy`'s unpadded day key, which served a stale "recent-5" to Stage-1
pool selection for two-thirds of every month (fixed `b7cbf64`).

**A median is a robust estimator. An argmax over ~870 correlated candidates on 16 days is not.** If this
question is reopened, the entry point is a *shrunk* or *regularised* estimator evaluated out-of-sample
from the start — never an unpenalised in-sample maximum.
