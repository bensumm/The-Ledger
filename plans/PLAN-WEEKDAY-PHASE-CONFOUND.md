# PLAN-WEEKDAY-PHASE-CONFOUND — is the trend read confounded with weekly phase?

**Status:** OPEN (pre-registered 2026-09-08). Owner-initiated. Inform-only; gates nothing.

## Origin

Owner, 2026-09-08, on being told an item was a falling knife:

> *"I'm beginning to feel like that knife rule is wrong, and that knives can actually be
> indications of good times to buy — it's crashing but generally recovers on the weekend."*

and, on being told the ceiling slope argued against the trade anyway:

> *"The ceiling slope is also kind of expected -- we could be missing a lot of potentially
> good trades."*

Both challenges landed. This plan records why, and pre-registers the experiment.

## §0. What was already settled (do not re-derive)

`PLAN-WEEKLY-CYCLE` (WK1–WK4, shipped 2026-09-08, full text `git show
6d0d970:plans/PLAN-WEEKLY-CYCLE.md`) established:

- **NO knife class exists at class level.** The pre-registered "deep deviation predicts
  continued fall" class did not materialize; closest bigticket call (−4,−2] at −0.21pp ns.
  So "at the floor of a descending band = falling knife = don't buy" is DOCTRINE, not a
  measured result, and must not be quoted as one.
- **The weekend effect is real at BASKET level** on the five big-ticket gear items
  (Avernic defender hilt, Nightmare staff, Armadyl crossbow, Venator ring, Osmumten's
  fang): weekend-minus-Tuesday **+1.395%**, paired **t=4.48** (df 13), **13/14 weeks**,
  peak Sat/Sun, trough Tue. Reproduced under the corrected null at +1.257%/wk, t=4.33,
  12/13 weeks.
- **Per-item it is NOT resolvable** at universe scale (crossbow p=0.89, ring p=0.66; those
  per-item weekday rows are fitted noise). It is a basket property.
- WK2's first-run 193 discoveries were an instrument artifact. **Never quote first-run
  numbers.**

## §1. The new hypothesis (H1)

**A floor/ceiling slope fitted over a window that is not weekday-balanced is confounded
with weekly phase, and will report a spurious downtrend whenever the window runs from a
weekend peak to a Tuesday trough.**

Mechanism: `read-trajectory.mjs` / `floorCeilingTrack` fit a slope over a trailing window
(5d for the floor label, 14d for the displayed band). A 14-day window is exactly two
cycles, but the *endpoint* is whatever today is. Ending on the measured trough day (Tue)
biases the fitted ceiling slope negative; ending on Sat biases it positive.

If H1 holds, the `⚠ breaking down` / `crash-risk` / `cooling` labels fire more often on
Mon–Wed than Fri–Sun for the same underlying item, and trades get rejected for being
"falling" when they are merely mid-cycle. That is the "missing a lot of potentially good
trades" the owner names.

## §2. First measurement (run 2026-09-08, motivating but NOT the registered test)

42 days of the local 1h archive, per item, daily high/low from hourly buckets.
Same-weekday week-over-week change in the daily HIGH, and the weekend-vs-Tuesday gap of
the daily mid detrended against its own 7-day centered mean:

| Item | Same-weekday WoW high | detrended weekend | detrended Tue | gap |
| --- | --- | --- | --- | --- |
| Armadyl crossbow | +0.44%/wk (t=0.57) | +1.15% | −0.96% | +2.10pp |
| Avernic defender hilt | +0.51%/wk (t=0.39) | +0.02% | −1.27% | +1.30pp |
| Nightmare staff | −0.70%/wk (t=−0.63) | +1.19% | −1.08% | +2.27pp |
| Osmumten's fang | +0.89%/wk (t=2.33) | +1.60% | −1.79% | +3.38pp |
| Venator ring | +0.25%/wk (t=0.26) | +0.99% | +0.24% | +0.75pp |

Read: **none of the five is in a significant downtrend once weekday is aligned**, and the
weekend gap is positive on all five (mean ≈ +1.96pp), independently consistent with WK's
basket figure. The Armadyl crossbow specifically was carrying a displayed ceiling slope of
**−220,578/d** over 14 days at the time of this run — which, weekday-aligned over 42 days,
is +0.44%/wk. That is the confound in one item.

**Limits — this measurement is motivating only.** Overlapping 7-day centered means induce
serial dependence, so the nominal n=36 WoW observations are ~5–6 independent weeks and the
quoted t-values are optimistic; five items chosen because they are the owner's book, i.e.
the same items WK's §1 basket was built from, so this is NOT an out-of-sample confirmation
of WK; one era, one season; hourly touch mids, not fills. Do not cite the table above as a
result. It exists to justify running §3.

## §3. The registered test (run 2026-09-08/09 — see §3+§6 RESULTS)

**Pre-registered before any run. Decision rule fixed here.**

Universe: all archive items with ≥ 28 days of 1h coverage and mid ≥ 100k. For each item and
each day, compute the displayed ceiling slope exactly as `floorCeilingTrack` does, then:

- **(a) Label-incidence by weekday.** Rate at which `crash-risk` / `cooling` /
  `breaking down` fires, split by the weekday the window ENDS on. H1 predicts a
  Mon–Wed excess over Fri–Sun.
- **(b) Slope decomposition.** Regress the fitted ceiling slope on (weekday dummies +
  a weekday-aligned trend estimate). H1 predicts the weekday dummies absorb a material
  share of the fitted slope.
- **(c) Forward yield conditioned on the label.** For items labelled "falling" on a
  Mon–Wed window-end, measure forward 4d net vs the same label on a Fri–Sun window-end.
  If the Mon–Wed cohort's forward yield is materially better, the label is firing on
  phase rather than on regime, and is costing trades.

**Branches, committed now:**
- **(i)** (a) and (b) both fire → the slope read needs a weekday-balanced window (fit over
  a multiple of 7 days ending on a fixed phase, or deseasonalize before fitting). Ship as
  a fix to the fit, not as a new signal.
- **(ii)** (a) or (b) fires but (c) does not → the label is phase-tilted but not costing
  money; ship at most an inform-only annotation, change no gate.
- **(iii)** Neither fires → H1 is refuted; the trend reads are sound and the 2026-09-08
  crossbow case was a single-item coincidence. Record it and close.

**Null branch is real:** (iii) is a live outcome. §2's five items are the owner's own book
and were pre-selected by WK; a universe run may well not reproduce them.

## §4. Live pre-registered trade (owner is placing this)

The owner is placing the offer himself on 2026-09-08 (a Tuesday, the measured trough day).
Logged HERE, before the outcome, so it can be scored honestly later.

- **Item:** Armadyl crossbow (id 11785), 1 unit.
- **Entry:** buy at the basing floor. Suggested **34.06m**; **PLACED at 34,101,000**
  (2026-09-08 ~22:34 local, slot 7) — +41k over the suggestion, recorded here rather than
  carrying the suggested number, since a pre-registered record that does not match the
  execution scores nothing. Break-even at the placed price **34,796,939**.
- **Exit:** list **35.30m**, targeting the Sat/Sun peak (2026-09-12 / 09-13).
  Verified at entry: 35.30m reached **13/14 days**, recent 2/3, p7, cushion +401,400,
  6/7 recent days. Net if filled at the PLACED entry **+493,000** (+1.45%); the +534,000
  (+1.57%) figure belonged to the 34.06m suggestion and is superseded.
- **Thesis:** buy the measured Tuesday trough of the five-item gear basket, sell the
  weekend peak. Entry at the FLOOR (basing, −56k/d) rather than the mid, so the item's
  own drift is largely sidestepped.
- **FILLED** 2026-09-08 22:48:55 local, 1 unit @ **34,101,000** — no slippage off the placed
  bid. Break-even confirmed by the pipeline at **34,796,939**. Exit listed at the registered
  35.30m; re-verified at listing time as 13/14 days, recent 2/3, p7, cushion +401,400, 6/7
  recent days (unchanged from entry). The exit was NOT raised despite recent-3 median 35.701m
  and the 75% level 36.246m making a higher weekend ask arguable — moving a registered exit
  after watching the entry fill is the hindsight adjustment this section exists to prevent.
- **AMENDED 2026-09-08, before any outcome — exit raised 35.30m → 36.25m.** Owner asked how
  35.30m was derived. Answer: it is the diurnal PEAK-WINDOW level (35.296m, window 01:00–10:00
  PDT), rounded — a ONE-DAY instrument applied to a FIVE-DAY thesis. That is a derivation
  error, not a market view, which is why amending is legitimate here where a
  post-fill re-think would not have been. Two compounding reasons:
  **(1) 13/14 is a same-day fill criterion.** A hold to Saturday needs one print in five days,
  not a print most days. At 36.25m reach is 11/14 — still ~100% over a 5-day window on an iid
  approximation (upper bound; daily highs are correlated) — for net **+1,420,080 (4.16%)**
  against +493,000 (1.45%) at 35.30m.
  **(2) The reach measure understates on thin books.** The archive stores `avgHighPrice` — the
  hourly AVERAGE of instabuy prints, not the max. Evidence from this book: the 2026-09-05
  crossbow lot sold at **37,990,000** inside an hour whose recorded high is **36,665,998 with
  highPriceVolume 3** — one print at 37.99m plus two near 36.0m averages to exactly that. The
  realised sell beat the archive's daily maximum by 3.6%.
  **Cost of the amendment, stated plainly:** §4 is now a weaker record than an untouched
  pre-registration. The failure condition below is restated against the NEW level, and the
  original 35.30m outcome should also be reported when this is scored, so the amendment cannot
  quietly improve the result.
- **Data-quality note (SUPERSEDES nothing yet, but it is bigger than this trade):** if
  `avgHighPrice` systematically caps below achievable prints on thin books, then EVERY reach,
  placement and `askSide` quantile the tool renders is biased low, and asks are being set below
  what the market would pay. That is a candidate for its own pre-registration — measure realised
  sell prices against the same hour's `avgHighPrice` across the closed record and quantify the
  gap by volume tier. (Registered AND measured 2026-09-09: `plans/PLAN-AVGHIGH-BIAS.md`
  — branch (B), not material; day-max beats are a ~2–4% tail and this very lot is the
  record's only date-only-stamped sell, so the hour attribution above was a
  reconstruction. Reach reads stay as-is.)
- **What would make this a FAILURE, stated in advance (restated at the amended level):** the
  ask does not reach 36.25m by
  end of Sunday 2026-09-13. A fill on Mon–Fri at a lower relist, or a hold into the
  following week, both count as the thesis not working — not as a scratch.
- **What it does NOT prove if it wins:** n=1. One filled trade is an anecdote and must not
  be quoted as evidence for H1 or for the weekend effect. It is logged to prevent
  hindsight reconstruction, not to accumulate a record.

## §5. Honest standing limits

One era, one season, one owner's book. The weekend effect is a basket property with no
resolvable per-item attribution. Everything in this plan is inform-only and gates nothing.
The `read-trajectory.mjs` / `floorCeilingTrack` outputs are unchanged until §3 runs and a
branch fires.

## §6. Extension (pre-registered 2026-09-08, BEFORE any §3 run): what is the warning worth?

Owner, 2026-09-08:

> *"How can we extend our findings to the knife warning and ceiling trend warning? Those
> are predictive i.e. item is falling, but the assumption that it's bad 100% of the time I
> think is overly cautious. This synergizes with the dislocation/yield surface aka
> amplitude v2."*

§3 asks whether the warnings fire on phase. This section asks what a warning is WORTH when
it fires — measured the way WK3/WK4 measured dislocation (class-conditional forward yield),
so the binary veto can become a graded read on the dislocation surface.

**H2:** the warning labels are treated as an unconditional "don't buy," but their
forward-yield content is CONDITIONAL — on class, on dislocation state, and (per H1) on
weekly phase. In some cells the label may mark an ENTRY (WK3 found no knife class, and deep
dislocation is a measured buy advantage in four classes); in others a real hazard (the
post-update gear dump).

**Label set, fixed now:** `floorCeilingTrack`'s `crash-risk` / `breaking down` / `cooling`
classifications, plus the regime `falling` as the screens print it. Every label must be
reconstructed USING ONLY DATA THROUGH day t (strictly trailing — the WK3 discipline; a
centered or hindsight-refit label disqualifies the cell). Feasibility note: this is a
per-day refit over the universe; if too slow, downsample every 2nd day — never shrink the
universe instead.

- **(d) Incremental-information test.** Per item-day: trailing label × WK4 dislocation
  bucket (`trailingDeviation` — deep/mid/shallow/normal/elevated) × WK3 class
  (`classifyItem`, imported, single source) → forward 4d net. Question, fixed now: within a
  (class × bucket) cell, does the label CHANGE the forward-yield read, or is it subsumed?
  Labelled-vs-unlabelled mean within cell, BH q=0.10 across cells, and the WK3
  volume-conditioned split (that fragility inverted a ranking once — it rides along).
- **(e) Where the warning earns its keep — candidate hazard cells named in advance:**
  (elevated ≥ +4%) × labelled (the sell-side mirror WK3 already measured negative), and
  gear/bigticket labelled falls (the update-dump mechanism, owner's-book doctrine). If
  labelled cells here are materially worse than their unlabelled cell, that is the
  warning's measured scope.

**Branches, committed now (independent of §3's i–iii):**
- **(iv) Subsumed** — within cells the label moves forward yield by nothing BH-significant:
  the warning carries no information the dislocation read doesn't; ship = when a quotable
  dislocation cell exists on the same item, the warning line defers to it (renders the
  measured cell beside, not instead of, the ⚠ — the label still describes the path).
- **(v) Scoped** — the label is informative in SOME cells (both directions allowed): the
  warning becomes class/bucket-conditional on the quote/digest surfaces via
  `dislocation.mjs`'s table machinery — hazard cells keep the ⚠ with the measured number;
  entry cells render the measured positive cell alongside the label ("falling — and in this
  class at this depth, that has been the entry: +Xpp/4d"). Only BH-significant cells enter,
  per the WK4 rule.
- **(vi) Confirmed veto** — labelled cells are materially worse than unlabelled broadly:
  the doctrine was right; record the numbers, change nothing, close.

**Interaction with §3, fixed now:** (d)/(e) run first on the label AS SHIPPED — that is
what is costing trades today. If §3 branch (i) fires and the fit gets a weekday-balanced
repair, re-run (d) on the repaired label before shipping any (v) cell — a cell earned by a
confounded label may vanish with the confound.

**Limits, stated now:** the labels and the dislocation depth are computed from the SAME
price series, so (d) is a nested-model question — "subsumed" means redundant given
depth+class, not useless. One era. Nothing here may gate, size, or auto-price; the ceiling
on any ship is an inform-only line.

## §7. THE PRIMARY QUESTION (owner reframe 2026-09-08): weekly-large vs rapid-attentive

Owner, on being told a higher weekend ask was "genuinely arguable":

> *"That's the entire test I want to do -- is it better to do weekly cycles for large
> amounts or is it better to do rapid cycles that require much more attention?"*

This supersedes §1–§6 as the motivating question. §3/§6 stay (they ask whether the trend
warnings misfire); §7 asks which LANE to run at all. The scarce resource is assumed to be
**slot-days** (8 GE slots) and **owner attention** (decisions), not capital.

### §7a-CORRECTED. Retrospective on the closed record

**⚠ The first version of §7a (2026-09-08, superseded within the hour) concluded "every bucket
past 12h has lost money or made nothing" and that big-ticket long holds are "worse, not
better". That conclusion was WRONG on three counts, all three caught by the owner, and the
corrected read below reverses it. The original is retained at the end of this section as a
worked example of the failure mode, because the errors are generic:**

1. **Pooled a non-stationary record.** 470 lots span 2026-07-02 → 09-09, a period of heavy
   strategy and tool change. Split by era, the LAST 30 DAYS show 12–24h at **+445k, 80% win**
   and 2–7d at **+1.18m, 295k/trade** — both positive. The negative pooled figure came from
   the early-to-mid record.
2. **Reported net totals, which hide the winners.** 12–24h is 28 wins / 21 losses (+3.54m of
   wins vs −5.12m of losses); **2–7d is 2 wins, 0 losses.** "Made nothing" was false. The
   −2.92m big-ticket figure is dominated by ONE event: 2026-07-21, three Osmumten's fang lots
   (−1.44m) plus a blowpipe (−579k), then 07-26 (−784k) and the 08-06 Snape grass (−667k) —
   the post-update gear dump, which has its own documented doctrine, not a property of
   holding.
3. **Attributed weekday gp by SELL date across lots of every hold length.** 392 of 470 lots
   are SAME-DAY, so the weekday table mostly restated same-day trades and said nothing about
   the multi-day lane it was being used to argue about.

**The natural experiment already in the record.** On 2026-09-02 two Armadyl crossbow lots were
bought at the SAME price, 36,050,000. One was flipped in 10 minutes for **+200,200**; the other
was held 73h to Saturday 09-05 for **+1,180,200** — same item, same entry, same day, **5.9×**
for the multi-day hold at one decision pair instead of one. n=1 and not a controlled trial, but
it is the closest thing to a paired observation the record contains, and it points the opposite
way from the original §7a.

**Multi-day lane, weekday-split properly** (n=78, +2.82m net): sell-Sat **+2.61m** over 18 lots
— essentially the entire multi-day profit — against sell-Wed **−2.09m** over 15. Buy-side, Mon
entries +1.57m best, Wed −958k worst. The weekend effect is STRONGER in the lane it applies to,
which is the reverse of what the pooled table implied.

**Attention axis, last 30 days:** 2–7d earns **295k/trade** against **99k** for sub-3h — 3× per
decision. Sub-3h still leads on gp/slot-day (2.56m vs 73k), but that metric assumes a 36m slot
can be instantly refilled with another equally good trade, repeatedly; buy limits (8/4h) and
opportunity supply do not allow it. §7b branch (viii) is where this points.

**What still stands from the original:** hold duration remains ENDOGENOUS — losers get held —
so none of the above attributes causation either. The 2–7d bucket is n=8. Only §7b's mechanical
forced exits can settle it. The corrected read does not prove the weekly lane works; it removes
the retrospective evidence that it does not.

Regenerate with `pipeline/experiments/hold-duration-lane-study.mjs`.

### §7a-ORIGINAL (SUPERSEDED — retained as the worked failure mode; do not quote)

`pipeline/experiments/hold-duration-lane-study.mjs`, 470 non-banked closed lots, 39.13m
realised, bucketed by hold duration:

| Hold | n | Total gp | gp/slot-day | med ROI/day | win% |
| --- | --- | --- | --- | --- | --- |
| <3h | 287 | 24.40m | 2.42m | 49.14% | 88% |
| 3–12h | 105 | 15.51m | 483k | 4.29% | 90% |
| 12–24h | 53 | −1.58m | −41k | 0.61% | 53% |
| 1–2d | 14 | −389k | −21k | −0.08% | 43% |
| 2–4d | 6 | 1.19m | 68k | 0.00% | 33% |
| 4–7d | 2 | 0 | 0 | 0.00% | 0% |

Big-ticket (≥10m) is worse in the long buckets, not better: 12–24h is −2.92m on a 13% win
rate. Sub-3h holds produced 62.4% of all lifetime realised gp.

**THE LOAD-BEARING CAVEAT — do not quote the table without it.** Hold duration is
**ENDOGENOUS**: a losing position is not sold in three hours, it sits. So "long holds lose
money" is substantially "losers become long holds", and the causal arrow may run entirely
backwards. Second, the weekly lane has **n=8 across 2–7d** — the strategy §7 asks about has
essentially never been run, so the table evaluates *ad hoc* long holds, a different thing.
Third, fast trades were selected because they looked good fast. This table motivates §7b;
it does not settle it, and any write-up quoting it must carry this paragraph.

**Sell-weekday split of the same record** (descriptive, same caveats): Sat is the best
selling day at 133k/trade and 1.86% median ROI over 66 lots, against Wed's 10k/trade over
57 — consistent in direction with §0's basket weekend effect, now on realised fills rather
than archive mids. Fri is the weakest ROI day (0.53%), which is what a "buy the run-up,
sell the peak" shape would look like.

### §7b. The registered forward test

**Pre-registered before any run.** The design exists to kill the endogeneity in §7a:
**both arms use MECHANICAL exits. Hold length is never chosen after seeing the outcome.**

- **Arm W (weekly-large):** entry Tue at the measured floor, one big-ticket item, full slot.
  Exit rule fixed at entry: list at the registered level; **forced reconciliation Sunday
  end-of-day** — if unfilled, mark to the instasell and record that as the outcome. No
  discretionary extension.
- **Arm R (rapid-attentive):** same capital, band-floor entry, list at the band top;
  **forced reconciliation at +12h** — mark to instasell if unfilled. Re-deploy immediately.

**Primary metric: gp per SLOT-DAY.** Secondary, and the axis the tool has never had:
**gp per DECISION** (a decision = one placement or one reprice), since Arm R spends far more
of them — the `gpDay` floor was lowered in 2026-08 precisely because it "had no attention
axis and flattered cheap churn", and that gap is what §7 is about. Also report drawdown and
capital idle-time per arm.

**Run it as a BACKTEST first** over the 1h archive (both arms are mechanical, so both are
simulable; mark-to-instasell is an upper bound on a real fill and must be labelled as such),
then live on alternating slots only if the backtest separates them.

**Branches, committed now:**
- **(vii) Rapid dominates** on gp/slot-day AND survives the per-decision normalisation →
  the weekly lane is a distraction at this capital; record and close §7.
- **(viii) Rapid dominates per slot-day but LOSES per decision** → the two lanes are
  attention-priced, not quality-priced; ship a `gp/decision` column so the trade-off is
  visible, and let the owner pick per session. This is the outcome §7a's shape most suggests.
- **(ix) Weekly competitive or better** once forced exits remove the disposition effect →
  §7a's verdict was an artifact of endogeneity, and the weekly lane is live.
- **(x) Neither separates** at the available n → say so plainly and change nothing.

**Third arm, added because the data suggested it and NOT because it was the hypothesis:**
**Arm RW (rapid, weekend-biased)** — Arm R's mechanics, but inventory deliberately timed to
sell Sat/Sun. §7a's weekday split and §0's basket effect both point at it, and it is neither
of the two lanes the owner named. It is registered here as exploratory: if it wins, that is
a hypothesis for a fresh pre-registration, **not** a result, because it was chosen after
seeing the weekday table.

**Limits.** One era, one book, one owner's attention profile — "attention" is proxied by
decision count, which is not the same as the cost of being at the desk. Mark-to-instasell
bounds fills from above in both arms, but not necessarily equally: Arm R marks 14× more
often, so any bias compounds against it. Nothing here may gate, size, or auto-price.

## §8. Extension (pre-registered 2026-09-08, before any run): the timing applies to reverse flips

Owner, 2026-09-08:

> *"Also this timing should probably reflect reverse flips as well."*

The reverse-flip lane (RF2, `screen-flip-niches.mjs --mode reverse`) sells an owned keep
into a peak and rebuys the dip — a full weekly-phase cycle run in the opposite order from
the buy lane. §0's basket shape maps onto it with the sign inverted: the weekend elevation
is the SELL window, the Tuesday trough the REBUY window, and the weekend−Tue gap is the
gross swing a reverse flip harvests per cycle. Today the reverse screen's Peak/dip windows
are DIURNAL (`hourProfile`) only; the weekly axis is absent from that surface.

**The central tension, stated before measuring:** WK settled that the weekend effect is a
BASKET property with no resolvable per-item attribution — and a reverse flip is by
construction one named item the owner holds. So the strongest honest ship is basket-level
WINDOW guidance ("weekend sell / Tue rebuy") on the timing surfaces, never a per-item
expected-value claim.

- **(f) Does the weekly swing clear the tax at basket level?** For the reverse-flip-eligible
  pool (owned-items `keep` ∪ `hold-thesis` `reverseFlip`, restricted to items with ≥28d 1h
  coverage), compute the WK-style detrended weekend-vs-Tue gap and net it through the
  tax-capped `breakEven()` mechanics (`js/quotecore.js`, the ONE definition) as a
  sell-weekend / rebuy-Tue round trip. Question fixed now: is the net-of-tax basket swing
  positive and stable across weeks (the WK criterion — week-count consistency, not a pooled
  t)? The eligible pool overlaps the WK basket heavily, so this is NOT out-of-sample
  confirmation of the effect — it is a costing of it in the reverse-flip's own mechanics.
- **(g) Label interaction, inherited from §6:** the reverse screen's regime read is
  INVERTED (falling/knife = wanted, rising/elevated = bad). §6's pre-named hazard cell —
  (elevated ≥ +4%) × labelled, measured negative forward — is, read from the sell side,
  exactly the reverse-flip SELL condition. If §6 fires branch (v), the reverse surface's
  inverted rendering must be re-derived from the measured cells, not assumed to be the
  buy-side table with signs flipped.

**Branches, committed now:**
- **(xi)** The net-of-tax basket swing is material and week-consistent → ship an
  inform-only weekday line on the reverse screen and `read-schedule.mjs` ("basket weekly
  window: sell Sat/Sun, rebuy Tue"), basket-scoped wording only, never per-item EV.
- **(xii)** It does not clear the tax, or is week-inconsistent → record the numbers and
  change nothing; the diurnal windows remain the only timing read on that surface.

**Limits:** one era; the eligible pool is the owner's book (selection); per-item
non-resolvability forbids any stronger claim in EITHER branch; inform-only, gates nothing,
and the owner places every offer. Runs after §3/§6 land, on the same strictly-trailing
discipline.

### §8 RESULTS (run 2026-09-09 — branch (xii): the weekly window does not clear the tax)

Instrument: `pipeline/experiments/reverse-flip-window-study.mjs` @ ab6a99e, committed
before this run; bars fixed in its header (the registration above left them qualitative).
Basket aggregates only in this text — the pool's composition is deliberately off the
public repo.

- **(f) → (xii), decisively.** Pool 26 (all owned keeps eligible; 0 reverseFlip theses),
  15 cycle-weeks. The real cycle — sell Sat/Sun raw mid, rebuy the following Tue, net of
  the ONE `tax()` — averages **−1.42%/cycle, 1/15 weeks positive, t=−5.41**. The
  registered bar (≥ +0.5% and ≥ 70% weeks positive) is not approached.
- **Why, and what it does NOT contradict:** the owned pool's own detrended weekend−Tue
  gap is ~0 (mixed sign week to week) — the weekend effect was measured on the FIVE-item
  gear basket, and per WK it is not per-item-resolvable; this 26-item bank-keep basket is
  a different basket and shows no usable weekly tilt. And even a +1.4%-gross tilt (the
  gear basket's) would not clear the ~2% sell tax as a mid-to-mid timing trade. The §4
  crossbow trade is not refuted by this: it enters at the band FLOOR and exits at the
  band peak — amplitude does the work, and weekly phase only tilts WHICH days offer the
  edges. A blanket "reverse-flip the pool weekly" lane would lose money; the reverse
  screen's diurnal peak/dip windows remain the timing read.
- **(g) is moot as registered:** it was conditional on §6 firing branch (v); §6 fired
  (iv), so no measured cells exist to re-derive the inverted rendering from. Nothing
  ships from §8; the weekday line registered under (xi) is NOT built.

One era, one pool, raw-mid costing (no band-edge execution modelled — that is the point
of the comparison, not a flaw in it). Inform-only; gates nothing.

## §9. Follow-on (owner directive 2026-09-09, registered, NOT run): the interpretation layer vs declared multi-day holds

Owner:

> *"We should also ensure that as part of this we fix the interpretation layer that runs
> on scan to not only recommend to cut items like the crossbow which we are planning to
> flip over several days — but that's a larger more complicated change."*

**The live case that proves it (measured 2026-09-09):** the §4 crossbow — a registered
five-day hold, entered at the Tue floor, one day in — rendered `CUT @ 34.52m (2h
breakdown & underwater — free capital)` on the positions read. That is §1's origin story
happening in real time to this plan's own registered trade, on the trough side of the
measured weekly cycle.

**What already exists, and the trap found while applying it:** `declare-thesis.mjs` +
`hold-thesis.json` DO gate the verdict — after declaring the trade with a numeric
tripwire the same read renders `CUT (2h breakdown) — live 34.52m still ~1.52m ABOVE
declared abort 33m; within plan — your call`, which is the designed deference. But the
convictionGate NO-OPS when the declared entry has no numeric tripwire
(`pipeline/lib/thesis/holdthesis.mjs`, by design "safe-degrade"), and `declare-thesis`
happily accepts a tripwire-less path declaration and prints "declared plan" — a
declared-but-non-gating entry, invisible to the declarer. Mitigation applied for the live
trade: crossbow declared `path wpc-weekly-cycle`, exit 36.25m, tripwire 33.0m recorded
explicitly as the SUPPRESSION-LAPSE level, not an exit order — §4's registration is
unchanged (failure stays time-based).

**Scope of the larger chunk (design work; own plan + owner sign-off; not now):**
1. `declare-thesis` should warn loudly (or refuse without an override) when a path
   declaration carries no numeric tripwire — today it writes an entry that looks armed
   and gates nothing.
2. The interpretation layer (scan/positions skills + verdict rendering) should treat a
   declared multi-day thesis as the FRAME: render progress against the declared exit and
   failure condition (the unused `horizon` field could carry a failure DATE for
   time-based theses like §4's) instead of a CUT recommendation the thesis already
   overrides. The `hold-thesis` machinery gates; the skill prose still leads with CUT.
3. §6(iv)'s ship shape rides along when built: where a quotable dislocation cell exists,
   the warning line defers to it (rendered beside, not instead of, the ⚠) — scoped by
   the RESULTS limit to {crash-risk, cooling} labels only.

Nothing here changes gates or doctrine by itself; it is presentation/interpretation
work, and per the process it needs its own per-topic plan before any of it is built.
**That plan now exists (drafted 2026-09-09): `plans/PLAN-THESIS-FRAME.md`** — TF1 = item
1 (refuse, with `--no-tripwire` override), TF2 = item 3 (+ the skill-prose sentence from
item 2), TF3 = item 2's frame rendering, mock-gated on owner sign-off. Execution and
results live there, not here.

## §3+§6 RESULTS (chunk WPC — registered run 2026-09-08, confirming rerun 2026-09-09)

**Instrument:** `pipeline/experiments/wpc-label-study.mjs` (committed before its first run,
2ce9be3; firing thresholds fixed in its header pre-run since the registration above left
them qualitative). Labels reconstructed by calling the real `floorCeilingTrack` on the last
20 completed local daily buckets ending day t−1 (strictly trailing, day t excluded);
regime `falling` = the real `REGIME_FALLING` mapping {crash-risk, cooling}; `classifyItem`
imported. Verified against the live surface: the reconstruction reproduces §2's crossbow
read to the gp (ceiling −220,578/d, floor −56k/d, mild-cooldown). Inference is item-level
only (per-item means first, t across items — overlapping 4d horizons forbid pooled
item-day t's). Registered universe: 711 items, 51,458 item-day reads, 31.3% carrying the
falling label. No downsample was needed.

**Deviations from the registration, flagged:** (1) §3(b) was operationalized as an
item-paired window-end-weekday contrast on the relative ceiling slope (+ the per-weekday
dummy table), not a pooled regression with a weekday-aligned-trend covariate — fixed
pre-run in the script header; the paired design controls the item's own trend by
construction. (2) The intraday "⚠ breaking down" (EC2 forming-day) variant is not
reproducible at daily grain; at day close it is crash-risk, which this study covers.
(3) A `--all-mids` supplementary (committed before ITS run, 0761dd8; post-registration,
decides no branch) drops the mid≥100k floor because that floor excludes ammo/herb/
bones-ashes — three of WK3's four robust classes: 3,648 items, 273,772 reads.

### §3 → branch (iii): H1 REFUTED — the trend reads are sound

- **(a) does NOT fire.** No Mon–Wed excess: paired Mon–Wed − Fri–Sun incidence
  −0.50pp (t=−0.84, 614 items). Incidence by end-weekday is nearly flat
  (Sun 29.3% … Fri 33.2%). In the supplementary wide universe the effect is
  significantly OPPOSITE to H1: −1.49pp, t=−6.69 — falling labels are slightly more
  common on Fri–Sun window-ends, not Mon–Wed.
- **(b) does NOT fire.** The paired end-weekday slope gap is in H1's direction but under
  the bar: −0.17%/d, t=−2.22 (needs |t|≥2.5). The dummy pattern also contradicts H1's
  mechanism: Fri-end windows carry the most negative slope (−1.23%/d), not Tue/Wed-end.
- **(c) does NOT fire** (barely): Mon–Wed-end labels ran +0.48pp/4d better than
  Fri–Sun-end (t=2.47, 548 items; needed ≥+0.5pp & t≥2.5). Suggestive of a mild phase
  tilt in the label's cost; not established, and nothing may be built on it.

Branch (iii)'s "single-item coincidence" wording, stated precisely (owner challenged it
2026-09-09, correctly): the crossbow's gap is REAL — displayed ceiling −220,578/d against
a +0.44%/wk weekday-aligned trend, reproduced to the gp — and §3 refutes only the claim
that window-end weekday CAUSED it ((b)'s own dummy table has Fri-end slopes most
negative, not Tue/Wed-end, backwards from H1's mechanism). What did cause it (the item's
own recent path is the unadjudicated candidate) is an n=1 question this design cannot
answer. Record and close §3. No fit repair; the §6 interaction rule is therefore moot
((v) never entered).

### §6 → branch (iv): SUBSUMED — the warning adds nothing the dislocation read doesn't

- **(d):** 0 of 16 registered cells BH-significant at q=0.10 (best p=0.057,
  midvalue-lowlimit × deep7, Δ−0.78pp). Supplementary all-mids: 0 of 48 cells. Within a
  (class × dislocation bucket) cell, labelled and unlabelled item-days earn statistically
  indistinguishable forward 4d nets. The volume-conditioned split flips several cell signs
  (the WK3 fragility, present here too) and rescues nothing.
- **(e) hazard cells:** directional but weak support only. Registered universe:
  bigticket-lowlimit × mid Δ−0.46pp (p=0.09). Supplementary: bulk-commodity × elevated
  Δ−5.16pp (p=0.012) and unclassified × elevated Δ−4.32pp (p=0.031) — nominally negative,
  neither survives BH across their 48-cell family, and both attenuate to nothing in the
  at-volume split. The update-dump hazard is not established at 4d horizon by this design.
- **Base rate worth recording:** the falling label sits on ~31% of all item-day reads in
  the tradeable (≥100k) universe — a warning that fires a third of the time and moves no
  within-cell yield read.

**Ship implied by (iv)** (NOT built here — follow-on after review + owner's call): when a
quotable dislocation cell exists on the same item, the warning line defers to it — render
the measured cell beside, not instead of, the ⚠; the label still describes the path.

**Limits:** one era (2026-05-28→09-09, one season); touch mids, not fills; labels are
daily-grain end-of-day while the live surface also fires intraday; the labels and the
dislocation depth share one price series, so "subsumed" = redundant given depth+class, not
useless. **(iv) covers the falling label {crash-risk, cooling} ONLY; mild-cooldown — the §2
crossbow's own classification, i.e. the ceiling-slope display that motivated this plan —
was outside the registered label set and its forward-yield content stays UNMEASURED, so no
ship may demote it.**
Inform-only; nothing gates. Reproduce: `node pipeline/experiments/wpc-label-study.mjs`
(registered) / `--all-mids` (supplementary).
