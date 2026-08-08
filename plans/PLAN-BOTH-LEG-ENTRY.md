# PLAN-BOTH-LEG-ENTRY — solve for the entry that makes BOTH legs reach

**Status: PROPOSED — REVISED after adversarial review (2026-08-08).** Nothing built.

> **Revision note.** The first draft of this plan (sha `9e5a9e3`) was attacked and did not survive.
> Its motivating table presented bid-reach and ask-reach side by side without ever multiplying them
> through the joint the plan itself proposed — the exact product-of-marginals error §2.1 diagnoses in
> the code. Measured through its own objective, the motivating pair's EV collapses from a "+533k/u"
> headline to **~100k gp/u/day in-sample and 14–56k held-out**. The objective was also shown to
> overfit by construction (§3.3). §1, §3, §4 and §5 below are re-derived. The diagnosis in §2 stands;
> the solution did not. Full prior text: `git show 9e5a9e3:plans/PLAN-BOTH-LEG-ENTRY.md`.

## 1. Why — the Dinh's bulwark miss, measured honestly

Every surface quotes **an** entry. None solves for **which** entry makes both legs reach. That gap is
real. What follows is the case that exposed it, with the numbers the first draft should have shown.

- `--mode amplitude` quotes the **median daily low** (`AMP_BID_Q = 0.5`) → 12.25m. Recent reach **1/3**.
- `quote-items` quotes a **reach-folded bid** → 12.80m. Break-even 13.06m, which is *above* mid (13.02m).
- Both were evaluated and Dinh's bulwark (21015) was called dead. Ben proposed **12,501,000** by hand.

**Marginals** (5m archive, the 16 most recent complete local days, 07-23..08-07 — see §5.1 on that window):

| level | reach | note |
| --- | --- | --- |
| bid 12,501,000 | 14/16 · recent 3/3 | BE 12,756,123 |
| ask 13,147,360 | 8/16 · recent 3/3 | +383,413/u (3.07%) |
| ask 13,300,000 | 6/16 · recent 3/3 | +533,000/u (4.26%) |

**The same pairs through this plan's own objective** — `low ≤ bid AND high ≥ ask AND t(low) < t(high)`:

| pair | joint, no order | joint, ordered | marginal product | EV = net × joint |
| --- | --- | --- | --- | --- |
| (12,501,000 · 13,147,360) | 6/16 | **3/16** | 0.438 | **71,890 gp** |
| (12,501,000 · 13,300,000) | 4/16 | **3/16** | 0.328 | **99,938 gp** |

And the recent-3 story fails its own ordering: on 08-06 the high printed 01:00 and the low 14:50, so
the **ordered** recent-3 joint is **2/3, not 3/3**.

**What survives.** The hand-picked entry is still materially better than the quantile-pinned one — the
marginal bid reach roughly triples (14/16 vs the median-low bid's 1/3 recent) at ~2% higher cost, and
that *is* the miss worth fixing. **What does not survive** is the framing: a 4.26% headline on a pair
whose ordered cycle completes 3 days in 16. **The objective was never optimised — it was pinned at a
quantile.** That remains the chunk. The claim of how much it is worth does not.

**The attention-floor check the first draft never ran.** At 1 unit (the clearability rule's answer for
a 350/d item), 99,938 gp/u × 3/16 completion is **~100k gp/day in-sample**, ~200k if the hold horizon
is relaxed to ≤1 day, and **14–56k held-out** (§3.3). The `/scan` doctrine's attention floor is
**500k gp/d**. On its own numbers the motivating opportunity is **2.5× to 36× below the floor** unless
multi-unit fills at daily extremes are assumed — which §6 explicitly declines to assume. **BL2 must
print gp/day against that floor.** If the honest answer is "below floor," the tool must say so.

## 2. Three verified defects in the current both-leg read

All in `js/amplitudescreen.mjs`; all three line references verified at HEAD.

1. **`pFill2leg = clamp01(bidFrac) * clamp01(askFrac)` (:161) is a PRODUCT OF MARGINALS, not a measured
   joint.** Days the bid was touched and days the ask was reached are counted independently and
   multiplied. For a mean-reverting oscillator these are not independent in either direction: a deep-dip
   day may be a down-day that never rallies (negative dependence), or a wide-range day may do both
   (positive dependence). The product cannot tell those apart. On the motivating pair the product reads
   0.328–0.438 where the ordered joint is 0.1875 — **the product overstates by 1.7–2.3×**.
2. **No ORDERING check.** `legOk` (:199-202) tests each leg separately. A day whose HIGH printed at
   09:00 and whose LOW at 22:00 counts as a both-leg day but is not tradeable buy→sell within the
   horizon. `AMP_HOLD_DAYS_DEFAULT = 1` is documented at :89-91 as *"buy the trough, sell the peak, same
   local day"*, so ordering is load-bearing at the default — **but see §3.2: the first draft's version of
   this constraint was itself wrong in two ways.**
3. **The levels are quantile-pinned, not chosen** — `ampBid = quantLow(lows, 0.5)`,
   `ampAsk = quantHigh(his, 0.5)` (:151-152). There is no search. `--amp-bid-q`/`--amp-ask-q` move the
   quantile but still do not optimise anything. **The quantile's robustness is a genuine virtue** that
   any replacement must earn past — §3.3.

## 3. The objective — re-derived

### 3.1 Base form

For a candidate pair `(bid, ask)` over N complete local days:

```
net(bid, ask) = afterTax(ask) − bid          // the shared tax-capped helper, never a private copy
joint(bid, ask) = |{ tradeable cycles }| / N // §3.2 — measured, NEVER bidFrac × askFrac
EVgpd(bid, ask) = net × joint ÷ holdDays     // gp per unit per DAY — comparable to the 500k floor
```

Reporting **gp/day, not gp/cycle** is not cosmetic: it is what makes the number comparable to the
attention floor and to the existing rank (§3.4), and it is what would have flagged the motivating case
as sub-floor at the point of the pitch.

### 3.2 What "tradeable" means — two corrections to the first draft

The first draft defined the ordering as `t(low) < t(high)` on the day's **extremes**, scoped to a
**single day**. Both halves are wrong.

- **Extremes-based ordering is the wrong event.** Tradeability needs *any* bid-touch before *any*
  ask-touch, not the day's extreme low before its extreme high. A day can dip to the bid at 08:00, run
  to the ask at 14:00, and print its extreme low at 22:00 — tradeable, but scored 0 by extreme-ordering.
  Measured at (12.501m · 13.147m): correct touch-ordering **4/30** vs extreme-ordering **3/30** — a
  third of the EV misattributed.
- **Same-day scoping contradicts the lane's own hold model.** `AMP_HOLD_DAYS_DEFAULT` is a
  parameter, and `--hold-days 1.5` deliberately crosses the day boundary. Allowing the ask to clear
  within `holdDays` of the bid-touch: joint at 13.30m goes **3/16 → 6/16**; at 13.147m **4/16 → 8/16**.
  Hardcoding same-day both halves the EV of the strategy actually run *and* biases the grid toward pairs
  that happened to complete same-day.

So: **`joint` = fraction of days on which the bid was touched and the ask was subsequently touched
within `holdDays` of that touch.** This is a first-touch-time computation over the underlying rows, not
a day-bar computation — which changes BL1's API (§4).

### 3.3 The overfitting problem — and why it is structural

**The argmax lands on an observed extreme by construction.** `joint` is a step function that changes
only at observed daily lows/highs; `net` is monotone decreasing in `bid` and increasing in `ask`. So
within any plateau of constant `joint`, EV is maximised by pushing the bid down and the ask up until
the joint is about to break — landing exactly on an order statistic, **with zero out-of-sample margin**.
Every day that barely reached is counted; noise of one tick flips it. This is not a tuning artifact to
be dialled out. It is the shape of the objective.

Measured on 21015, 30 days, ~870 candidate pairs:

| test | result |
| --- | --- |
| full-sample argmax | bid 12,392,392 · ask 13,508,496 — **exactly the low and high of the single most recent day** |
| its in-sample EV | 84,594 gp/u/day (joint 3/30, net 845,935) |
| split-half validation | train-EV 67k–169k → **test-EV = 0 in 7 of 8 splits** |
| leave-one-out | 56k (extreme-ordered) / 14k (touch-ordered) vs 84.6k in-sample = **33–83% optimism** |

At N=16 each day is worth 6.25% of `joint`, and the binomial sd at p≈0.2 is ±1.6 days — the argmax
selects noise the size of the signal. **This is why the quantile the plan set out to replace is not
obviously worse.** A median is a robust estimator; a 16-day argmax over 870 correlated candidates is
not. Any claim that the search beats the quantile must be made **out-of-sample or not at all**.

Two spec'd consequences, both required, both in BL1:

- **Grid points must not sit on order statistics.** Use a fixed price lattice (a fraction of a percent
  across the observed range), and require a **margin buffer** — a level counts as reached only if the
  day's print cleared it by more than a stated tolerance. A pair that survives with buffer is a pair
  whose joint is not one tick of noise wide.
- **The headline number is the held-out one.** BL1 computes walk-forward (or LOO) EV alongside
  in-sample EV, and BL2 leads with the held-out figure. In-sample EV may be shown beside it, labelled.
  A surface that headlines an unvalidated argmax is worse than the quantile board it replaces.

### 3.4 What the objective still omits — stated, not hidden

- **No adverse-selection term.** At the motivating pair the bid touches 14/16 days while the ordered
  cycle completes 3/16: on ~11 days in 16 you buy and are not out within the horizon — on an item whose
  daily lows fell ~13.4m → 12.0m across that window. EV scores those days **0**; they are actually
  inventory into a decline. **BL1 must report `bidOnlyFrac` and the observed mark change on bid-only
  days** as a companion figure. It is measurable from the same bars, and leaving it out biases EV upward
  on exactly the items the lane is most likely to surface.
- **It duplicates part of an existing rank.** The repo's ruled composite is
  `net × P(fill) ÷ TTF` (`js/estimators/families.mjs:11`), and the amplitude family already has a TTF
  (`ttfAmplitude`, holdDays × 86400, :165-168). `EVgpd = net × joint ÷ holdDays` **is that composite**
  with a measured joint substituted for the modelled `P(fill)`. It should be framed and named as an
  improvement to the amplitude family's `P(fill)` input, not as a parallel scoring system. BL3 must not
  introduce a second ranking vocabulary.

## 4. Chunks

| id | what | dep | size |
| --- | --- | --- | --- |
| **BL1** | `pipeline/lib/signal/bothleg.mjs` — the PURE core. `dayCells(rows, {tz})` → per-day rows retained (NOT just `{lo,hi}` — first-touch times are level-dependent, so the bars cannot be pre-reduced). `jointReach(cells, bid, ask, {holdDays, buffer})` → measured touch-ordered joint per §3.2. `bothLegFrontier(cells, {taxFn, lattice, holdDays, buffer})` → `[{bid, ask, joint, jointNoOrder, net, evGpd, evGpdHeldOut, bidOnlyFrac, bidOnlyDrift}]` + `best`. Lattice grid, NOT order statistics (§3.3). Walk-forward/LOO EV computed here, not bolted on later. No fetch, no archive handle, no clock. Fixture-pinned: ordering flips a known day; `joint ≤ min(bidFrac, askFrac)` always; held-out EV ≤ in-sample EV on a synthetic pure-noise series; empty/1-day input → null, never a fabricated read. | — | **L** |
| **BL2** | `pipeline/commands/read-both-leg.mjs "<item>"` — READ-ONLY console surface. Opens the archive `open(undefined, {readonly:true})` ONLY. Prints the frontier with the **held-out EV as the headline**, in **gp/day against the 500k floor**, plus `bidOnlyFrac`, the grain and day count used, and the window definition (§5.1). Writes no artifact, never in a commit/sync path. | BL1 | **M** |
| **BL3** | Fold the measured joint into `amplitudeRead` as a better `P(fill)` for the existing family rank — `pFill2leg` becomes the measured joint (touch-ordered, horizon-aware) instead of the product. Surfaces the frontier pair **beside** the quantile-pinned pair, never replacing it, and introduces **no new ranking vocabulary** (§3.4). Behind `--both-leg`, DEFAULT OFF. | BL1 | **M** |
| **BL4** | Validation sweep over the amplitude pool, and it is a **gate, not a report**: does the frontier pair beat the median pair **out-of-sample**, across items? How often does ordering flip a both-leg day to false? What is the realised `bidOnlyFrac`? **If the held-out comparison does not favour the frontier, BL3 stays off and this plan is closed as a negative result** — that is an acceptable outcome and cheaper than shipping an overfit board. | BL2, BL3 | **M** |

## 5. Grain and window

### 5.1 The window is a free parameter — define it, don't hide it

The 5m archive holds **30** complete local days for 21015; every headline number in the first draft was
computed on the **last 16** (the post-break regime). That choice nearly doubles the apparent bid reach
(14/16 = 88% vs 14/30 = 47%), was made after seeing the data, and was never stated. "Complete" was also
never defined — measured 5m coverage on those days is **53–198 of 288 buckets**, so no day is complete
in a coverage sense. BL2 must **state the window rule, the day count, and the coverage floor**, and
**print the full-window numbers beside the recency-scoped ones**. A recency scope is defensible; an
undeclared one chosen post-hoc is not.

### 5.2 Grain — 1h default, 5m as confirmation (reversed from the first draft)

The first draft preferred 5m on a measurement taken at amplitude's 12.25m bid (1h 8/16 vs 5m 10/16).
At **the pair BL2 would actually quote**, on the identical 30-day window, the gain is **zero**:

| level | 1h reach | 5m reach |
| --- | --- | --- |
| bid 12,501,000 | 14/30 | 14/30 |
| ask 13,300,000 | 20/30 | 20/30 |
| ask 13,147,360 | 22/30 | 21/30 |

So the plan was paying 5m's cost — **~30 days of window vs 1h's ~71** — for a precision benefit that
does not exist at its own operating point. Worse, on a 350/d item a 5m bucket holds ~1.2 trades, so 5m
"precision" increasingly means *one print touched the level*, which is **weaker** fill evidence per day,
not stronger. **Default 1h; 5m is a confirmation read.** BL2 prints which grain it used either way.

**Direction of the bias, which the first draft got half-right:** 1h understates the daily low *and*
overstates nothing — it also understates the daily HIGH. So **both** legs read harder at 1h than they
truly were. The bias is **conservative on both sides**: biased against finding candidates, safe when
acting on one. That is the favourable direction, and it is an argument *for* the 1h default, not against.

Unchanged from the first draft, and still true: **even 5m is an average.** `avgLowPrice` is the mean of
instasell prints in the bucket, so the true minimum print is below either grain. No grain gives tick
data; the wiki exposes none. Ordering is measured at bucket resolution — fine for a day-long cycle,
not for an intraday scalp.

## 6. What this is NOT

- **Not a validated edge.** The frontier is an argmax over correlated candidates on a short window;
  §3.3 measured 33–83% in-sample optimism and test-EV = 0 in 7 of 8 split-halves on the motivating item.
  Until BL4 says otherwise, the honest position is **"the quantile may well be better."** This is the
  hazard the first draft omitted entirely while inoculating itself against the familiar ones below.
- **Not a forecast.** `joint` is historical co-occurrence over N days. It says the pair was jointly
  reachable that often, not that it will be. Same n≈0 status as everything in the amplitude lane.
- **Not a fill model.** A day whose low ≤ bid means trades printed there; it does not mean *your* unit
  filled — queue position and size are unmodelled. Upper bound, exactly as `printedAt` is on the ask side.
- **Not a sizing tool.** Thin big-tickets stay thin: Dinh's is 350/d and the clearability rule still says
  1 unit. Finding a better entry does not make the exit deeper — and at 1 unit the motivating case is
  **below the 500k gp/d attention floor** (§1).
- **Not a complete P&L.** EV scores bid-only days as 0 when they are really inventory into whatever the
  item did next; `bidOnlyFrac`/`bidOnlyDrift` report that exposure but do not price it (§3.4).
- **Not a replacement for the quantile board** until BL4 says so — and BL4 is allowed to say no.

## 7. Open questions

- Should `joint` be recency-weighted rather than a flat N-day count? Dinh's reads **6/16 full but 3/3
  recent** at the 13.30m ask (2/3 once ordered) while the ceiling climbs +211.2k/d. The existing
  `recencySplit`/`staleOptimistic` machinery already models this; reuse it rather than inventing a second
  recency basis (PLAN-RECENCY-BASIS: one recency basis, one home). **Note the tension with §5.1** —
  recency weighting and a post-hoc recency window are the same free parameter twice; pick one home.
- Does the EV-max pair beat the median pair on *realised* fills? BL4 answers it out-of-sample on history;
  `join-amplitude-outcomes.mjs`'s shadow replay is where realised fills would later confirm or kill it.
- Does this generalise off the amplitude lane? The same objective applies to band. Out of scope here.
