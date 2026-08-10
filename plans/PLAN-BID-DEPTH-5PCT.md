# PLAN-BID-DEPTH-5PCT — does a bid more than 5% under guide simply not fill?

**Status: INVESTIGATED 2026-08-09 (adversarial Opus lane A). VERDICT — NOT SUPPORTED.**
The in-game mechanic is real and Ben described it correctly. The *market consequence* he inferred
from it is not detectable, on two independent datasets, after the confound controls that killed
three prior findings in this repo. **Confidence: moderate-to-high on "no wall of decision-relevant
size"; see §9 for what is genuinely still open.**

The lane also produced two findings that ARE actionable and are worth more than the original
hypothesis would have been — §8.

---

## 1. What the hypothesis was

The OSRS GE offer UI opens at the guide price with quick-set **−5% / +5%** buttons. If the common
workflow is "click −5%, done", resting BUY offers pile up at exactly `guide × 0.95`, and a bid below
that sits behind a queue wall — filling only on a genuine flush. Prediction: **P(fill) drops
DISCONTINUOUSLY at −5%**, not smoothly with depth. Since our `asym` deep-bid levels mostly sit past
−5%, this would indict levels we actively quote.

## 2. The mechanic — VERIFIED, and Ben's description is accurate

Established from the RuneScape Wiki's Grand Exchange offer-interface documentation, corroborated on
the OSRS wiki:

- **"When making an offer, item prices are initially set to guide value."** ✔ The default anchor IS
  the guide price.
- **"This can be adjusted in amounts of −5%, +5%, customisable decrease (between −1% and −99%,
  initially displaying as '…'), customisable increase (between +1% and +99%), or a custom price can
  be entered."** ✔ The ±5% buttons exist exactly as described.
- The interface also shows a **Recent Trading Price** — "the average value of the last 10 completed
  trades" — so a second, non-guide reference sits on the same screen.
- OSRS-specific, 23 May 2024: *"Players may now set their own +x% and −x% values in the Grand
  Exchange by right clicking the button to alter the value."*

**So one click from the default lands at exactly `guide × 0.95`. The mechanism Ben posits is real
and correctly specified.** Three caveats that bound it:

1. **NOT established: whether repeated clicks compound.** One low-confidence secondary source says
   the buttons adjust by 5% *of the current offered price*, which would put successive clicks at
   −5.00% / −9.75% / −14.26% rather than −5/−10/−15. I could not confirm this against the wiki and
   am flagging it as unverified. It does not affect the primary test: the **first** click lands at
   −5.00% of guide either way, and that is the "click −5%, done" workflow the hypothesis is about.
2. The 2024 custom-percentage update actively **dilutes** any spike — players who set their own value
   scatter across the axis instead of stacking at −5%.
3. **We cannot observe other players' resting offers.** The wiki API exposes no order book. So the
   hypothesis is testable only through its consequences, which is what §5–§7 do.

## 3. The blocker that was called fatal — and why it is not

An earlier validator pass concluded the historical replay was impossible, because nothing in the
pipeline persists the guide at time T. **That finding is correct about the repo and I confirm every
part of it:** the archive schema has no guide column; `pipeline/.cache/guide.json` is a 10-minute TTL
snapshot overwritten in place; `pipeline/.guide-history.jsonl` has 97 rows / 26 real re-anchors / 17
items; `suggestions.jsonl` carries `guide` on 0 of 13,401 rows. See
`pipeline/experiments/BID-DEPTH-BASELINE-FINDINGS.md`.

**But the guide is recoverable from outside the repo.** `api.weirdgloop.org/exchange/history/osrs/
last90d?id=<id>` returns the historical **GE guide price** series — the same source family as the
`chisel.weirdgloop.org os_dump.json` that `loadGuide()` already reads. Reconstructed as a step
function (last value at or before T), it was validated two independent ways:

| Validation | Result |
| --- | --- |
| Final point vs our own current `guide.json` dump, 118 items | **118 / 118 exact integer match** |
| Historical values vs our own `.guide-history.jsonl` observations at their exact timestamps | **93 / 93 exact integer match** |

The second check spans re-anchor boundaries, so the step-function reconstruction is verified at
points in time, not merely at the endpoint. **This is the correct anchor, not a mid substitute** —
the failure mode the brief warned about is avoided, not risked.

**Resolution of the secondary flag:** `guideanchor.mjs`'s header claims the guide "re-anchors
~once/day per item". The internal record (26 events) was too sparse to check. The reconstructed
series settles it: across **10,400 re-anchor steps on 118 items**, the median gap is **25.2h** (p25
17.0h, p75 30.5h). **The module's premise is CORRECT** — only its own observation record was
sampling-limited. No repair needed.

**Measurement resolution.** The series is ~daily, so a lookup can be up to ~25h stale, and the median
absolute guide step is 0.92% (p90 3.18%). Depth-vs-guide therefore carries roughly **±1pp of noise**.
That is the honest resolution limit, and §7's high-precision subsample controls for it.

## 4. What was measured

Two datasets, both read-only (archive opened `open(undefined, { readonly: true })` throughout).

- **Dataset A — our own bids.** `fills.json` collapsed via `collapseOffers` into offer chains:
  **693 buy offers across 118 items, 2026-07-02 → 2026-08-09.** Critically, `fills.json` records
  `placed` and `cancelled` states, not only fills — so this yields a **genuine fill RATE**, not the
  fill-only distribution §3 assumed. Outcomes: 267 fully filled, 77 partial, 330 cancelled unfilled,
  16 still resting. Overall anyFill **50.1%**. Enriched with the live instasell (archive 5m
  `avgLowPrice` at placement, n=428), price-reach (n=322), and 7-day band width (n=391).
- **Dataset B — the market itself.** The wall is a claim about *other players' orders*, so it should
  show as price **support** at `guide × 0.95`. Measured on **1,995 item-days across 111 items**: the
  deepest 5m low-side print each day vs that day's guide. No selection on our behaviour at all, and
  ~3× the n.

## 5. Result — the discriminating test (§3.3) finds no step

Fill rate by fine depth bin, Dataset A (n=693):

| bin (% vs guide) | n | anyFill | 95% CI |
| --- | ---: | ---: | --- |
| [−12, −8) | 18 | 55.6% | 34–75% |
| [−8, −6) | 34 | 50.0% | 34–66% |
| [−6, −5.5) | 9 | 33.3% | 12–65% |
| [−5.5, −5) | 14 | 42.9% | 21–67% |
| **[−5, −4.5)** | 15 | 53.3% | 30–75% |
| [−4.5, −4) | 25 | 32.0% | 17–52% |
| [−4, −3) | 117 | 53.8% | 45–63% |
| [−3, −2) | 122 | 53.3% | 44–62% |
| [−2, −1) | 140 | 48.6% | 40–57% |
| [−1, 0) | 52 | 32.7% | 22–46% |

Non-monotonic and noisy, with **no step at −5%**. The −8% and −12% bins fill *better* than the
−4.5% bin. Pooled: past −5% **42.5% (n=87)** vs inside −5% **51.2% (n=606)** — an 8.7pp gap, which
§6 dissolves.

**The placebo cut-point scan is the honest form of the question.** Testing every cut-point from −9%
to −1% (w=1.5pp), the step at −5% ranks **7th of 26** (5.6pp, z=0.57); the largest step sits at −4%
(14.7pp, z=1.88 — not significant across 26 correlated tests). On the live-controlled subsample it
ranks **5th of 24** (11.0pp, z=0.87). **−5% is unremarkable.**

**The real discontinuity is elsewhere, and it is enormous.** Running the identical scan against the
**live instasell** anchor, the largest step is at **−1.25%, 33.2pp, z=5.35**. Fill rate vs live depth
is a clean monotonic gradient:

| depth vs live | n | anyFill |
| --- | ---: | ---: |
| < −4% | 32 | 28.1% |
| −4 … −2% | 65 | 35.4% |
| −2 … −1% | 83 | 33.7% |
| −1 … −0.5% | 61 | 47.5% |
| −0.5 … 0% | 89 | 58.4% |
| 0 … +0.5% | 68 | 79.4% |
| > +0.5% | 30 | 80.0% |

That step is at the **touch** — crossing the spread fills immediately. Expected, mechanical, and it
is the only discontinuity in the data.

## 6. The confounds — three of them dissolve the raw 8.7pp gap

**(a) Exposure / cancellation — the big one.** Median offer exposure is **0.30h (18 min)**.
Cancelling is *our* behaviour, not the market's; a bid pulled in 10 minutes never had a chance.
Restricting to genuinely-rested offers, the deep-bid deficit **reverses sign**:

| rested ≥ | n | deep (past −5%) | inside −5% | diff | z |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0h | 693 | 43% (n=87) | 51% (n=606) | −8.6pp | −1.50 |
| 0.5h | 293 | 56% (n=43) | 52% (n=250) | **+3.4pp** | 0.41 |
| 2h | 141 | 57% (n=28) | 52% (n=113) | **+4.9pp** | 0.47 |
| 6h | 77 | 73% (n=15) | 58% (n=62) | **+15.3pp** | 1.09 |

**Honest caveat, stated because it cuts against a clean story:** conditioning on exposure is
conditioning on a *post-treatment* variable — it also removes instant fills from the shallow arm. So
the unconditional estimate is biased by cancel-behaviour and the conditioned one by a collider.
Neither is clean. The defensible conclusion is that the effect **is not robustly signed**: it flips
from −8.6pp to +15.3pp on a defensible analysis choice, and no version is significant.

**(b) Within-item (the composition trap).** Items with ≥2 bids on both sides of −5%: only **8
items**. Mean deep−shallow = −22.0pp, sign test 2 better / 5 worse / 1 tie, **exact p = 0.453**. Under
exposure control only 4 items qualify and the mean **flips to +11.5pp (p = 1.00)**. Underpowered in
both directions; it supports nothing.

**(c) Band width.** Deep bids do sit on wider-band items (mean 2.63% vs 2.18%) — the composition
confound is real. Stratified, **wide-band items show no depth effect at all** (56.3% / 55.0% / 53.4%
across deep / mid / shallow); the mild gradient survives only in the narrow-band stratum.

**(d) The mechanism signature — the cleanest single test.** "Price reached the bid but it did not
fill" is the *direct* queue-wall fingerprint. Among offers whose price the market actually reached
(n=146): deep bids filled **95.5% (n=22)**, shallow **80.6% (n=124)** — **diff +14.8pp, z=+1.70**.
Of the 25 reached-but-unfilled cases, **24 were INSIDE −5% and 1 was past it.** The wall predicts
this concentrates *past* −5%. It concentrates on the other side. **Sign opposite to prediction.**

## 7. The one thing that looked like a wall — and the test that killed it

Dataset B initially looked like support for Ben. Daily lows vs guide, 1,995 item-days: the
support-ratio statistic (mass just above a level ÷ mass just below) peaked **exactly at −5.0%,
ratio 1.91, RANK 1 of 23 levels tested**, against a "no wall anywhere" baseline median of 1.27. The
bin-to-bin jump across the −5 boundary was +61% where neighbouring steps ran ~20%. That is what a
density spike would look like, and it was not item-concentration driven (85 distinct items in the
bin, top contributor 4%, leave-one-out worst case 1.85).

**It fails the placebo-anchor test.** The in-game button is anchored to the **guide**. It has no
mechanism whatsoever to create support at −5% of *yesterday's mid*. Re-running the identical
statistic against that non-guide anchor:

| anchor | −5% ratio | rank | baseline median |
| --- | ---: | --- | ---: |
| vs GUIDE (the button's anchor) | 1.91 | **1 / 23** | 1.27 |
| vs PRIOR-DAY MID (placebo — button cannot act here) | **1.71** | **2 / 22** | 1.36 |

The feature appears **almost as strongly against an anchor the button cannot touch**. It is a shape
artifact of a unimodal decaying daily-low distribution — the ratio statistic peaks near the steepest
part of the decay, which lands near −5% whichever anchor you use — not a button artifact.

Three further checks agree:

- **Smooth-fit residual:** fitting log-count across [−9,−2) excluding the boundary bins, the observed
  [−5,−4.5) count is 103 vs 90.0 expected — **Poisson z = +1.37**, with z = −1.22 on the bin just
  below. Ordinary noise around a smooth curve; |z| > 2 would be needed.
- **Bin alignment:** the ratio degrades smoothly as the boundary moves off −5.0 (1.91 → 1.84 → 1.78 →
  1.72). A genuine step would sit on a sharp peak.
- **Split-half:** first half ratio 1.41 (rank 3/9, its own peak at −4.5%); second half 2.02 (rank
  1/23). **Does not replicate.**

**And the wall is not a wall even on its own terms:** daily lows penetrate below −5% of guide on
**568 of 1,995 item-days (28.5%)**. The fall-off from −4%→−5% (39.6%→28.5%) is no sharper than
−3%→−4% (55.4%→39.6%). Crossing −5% is routine, not a flush event.

**This is the finding I was most at risk of shipping as a fourth false positive.** It ranked #1,
survived item-concentration and leave-one-out, and had a plausible mechanism attached. The placebo
anchor is what killed it, and no amount of within-item control would have.

## 8. What the data DOES support — two real, actionable findings

**8.1 "% under guide" is a contaminated variable; "% under live" is the predictive one.**
Across n=428 offers, guide diverges from live by median **+1.39%** (p5 −2.02%, p75 +3.18%, p95
+7.21%); guide sits above live **72%** of the time and **46% of offers have |divergence| > 2%**. The
two anchors disagree on whether an offer is "past −5%" for **52 of 428 offers**. This confirms the
earlier n=8 baseline finding at 50× the sample, including its key point that the lag is **two-sided**
and so cannot be corrected with a constant.

Operationally: depth-vs-live predicts fill smoothly and strongly (§5 table, z=5.35 at the touch);
depth-vs-guide predicts it noisily and near-uselessly. **We should be quoting and reasoning in
depth-vs-live.**

**8.2 A large guide-over-live gap is a stale-guide / fallen-item marker — and it does predict.**
The single significant cell in the controlled test was bids at/above live but still past −5% of
guide: **59.1% fill (n=22) vs 85.5% (n=76)**, z=−2.71. By construction that cell is exactly "guide
sits far above live" (mean guideVsLive **11.86%** vs 3.24% in the reference), i.e. the guide has not
yet re-anchored to a price that fell. Spread across **14 distinct items**, so not single-item
concentration. This is a genuine risk marker — but it is about **guide staleness on a falling item**,
not queue position. Note it is one cell of four tested and deserves confirmation before it gates
anything.

## 9. What this does NOT establish — the honest limits

- **Power.** On Dataset A the minimum detectable drop is **≈19.2pp** (80% power, α=.05, n=62 vs 366
  with live control). **A wall smaller than ~19pp would be invisible to our own fill data.** Dataset
  B is far better powered for the *density* claim and finds nothing that survives placebo, but the
  two are not interchangeable.
- **Our bids are shallow.** Median depth −2.12%, p5 −7.56%; only 87 of 693 sit past −5% and 30 past
  −8%. The deep zone is thinly sampled *by us*, which is precisely why Dataset B was needed.
- **Compounding clicks unverified** (§2). If clicks compound, secondary spikes would sit at −9.75%
  and −14.26%, not −10%/−15%. Not tested; n in those bins is too small either way.
- **`reached` is conservative.** It uses 5m `avgLowPrice`, a 5-minute *average*, not the true tick
  minimum — so it understates reach and the §6(d) test is noisier than its z suggests.
- **One desk, 38 days, one player's behaviour.** Nothing here is a market law.
- **Not tested: size.** All of this is at Ben's typical tranche. A wall could bind on large orders
  and not small ones.

## 10. Confidence, stated separately from findings

- **The mechanic exists as described (one click → guide × 0.95):** *high* — direct wiki documentation.
- **No fill-rate discontinuity at −5% of guide, at decision-relevant magnitude:** *moderate-to-high*.
  Six independent tests agree, the mechanism signature points the opposite way, and the one
  supporting feature failed a targeted placebo. Bounded by the ~19pp power floor.
- **No market-wide density spike at guide × 0.95:** *moderate*. The placebo anchor is a strong test
  and split-half non-replication supports it, but a small real spike could hide under a shape
  artifact of similar size.
- **Depth-vs-live beats depth-vs-guide as a fill predictor:** *high* — large effect, huge z, obvious
  mechanism.
- **Stale-guide-as-risk-marker (§8.2):** *low-to-moderate* — one cell, n=22, needs replication.

---

## 11. Build-ready chunks

### 11a. Because the hypothesis did NOT hold — what changes

| Chunk | Change | Notes |
| --- | --- | --- |
| **BD1** | **Do NOT build the §6-original queue-position term.** No discrete P(fill) haircut below `guide × 0.95` in `asym`, and no bid-side `askReachFactor` analogue keyed to guide depth. | This is the primary deliverable. The proposed change would have degraded every deep-optionality level on no evidence. Record the negative in `docs/LORE.md` so it is not re-proposed. |
| **BD2** | **Re-express bid depth against LIVE, not guide,** wherever a "% under" figure is computed for a decision (`asym` deep-bid derivation, the deep-bid rationale strings, any `% under guide` shown on a bid recommendation). Keep guide as a *displayed* column. | §5/§8.1. The two anchors disagree on 52 of 428 offers; guide-depth is the noisier variable and is what made these levels *look* extreme. Behaviour-changing → ship as a visible comparison (show both) per the gate-on-error-cost rule, not a silent swap. |
| **BD3** | **Persist `guide` AND the live prints on every suggestion row** (`suggestions.jsonl`, lean YS2-pattern fields: `guide`, `liveLow`, `liveHigh`, `liveTs`). | Currently 0 of 13,401 rows carry `guide`. Cheap, and it makes this class of question permanently answerable in-repo instead of via an external API. Neither anchor alone is interpretable — §8.1. |
| **BD4** | **Add a `guideStale` inform-only flag** when `guide / liveLow − 1 ≥ 5%`: "guide has not re-anchored to a fallen price". | §8.2, the one genuinely predictive thing found. **INFORM-ONLY** — n=22 in one cell. Do not let it gate or move a number until replicated. |
| **BD5** | **No change to `guideanchor.mjs`.** Its "~once/day" premise is now *validated* (median re-anchor gap 25.2h over 10,400 steps, 118 items). Optionally record the validation in the header. | Resolves the flag raised against it — the sparse internal record was a sampling artifact, not a wrong claim. |
| **BD6** | Fold this document into `PLAN.md` (Discovered → resolved-negative) and delete it from `plans/` once BD1–BD4 land. | Per the per-topic-plan lifecycle rule in CLAUDE.md. |

### 11b. If it HAD held / what would revive it

The hypothesis returns to the table only on a **pre-registered** trigger, to prevent re-litigating it
from noise:

1. **Density evidence:** a −5%-of-guide support ratio that (i) exceeds the placebo-anchor ratio by a
   clear margin, (ii) replicates in both halves of the sample, and (iii) shows smooth-fit residual
   |z| > 2 at the boundary. None of the three holds today.
2. **Outcome evidence:** with `guide` logged per BD3, a fill-rate step at −5% that survives the
   placebo cut-point scan (i.e. ranks 1st, not 7th, of ~25 cut-points) **and** the exposure control
   **and** the reach-conditioned test.

Only if both fire should BD1 be reversed and a queue-position term built — and even then it should
enter as a visible comparison, never a silent P(fill) haircut.

### 11c. Forward-measurement design (what makes this permanently answerable)

BD3 is the whole fix, but to size it honestly: the discriminating test needs **~40+ offers per 1pp
depth bin** across the −3% to −8% range to resolve a 15pp step, i.e. roughly **250–300 deep offers**.
At the observed rate (87 past −5% in 38 days ≈ 2.3/day) that is **~4 months** of ordinary trading —
or ~6 weeks if deep bids are deliberately over-sampled. **Do not expect a verdict from this inside a
month.** Fields required on every suggestion and every placed offer: `guide`, `liveLow`, `liveHigh`,
`liveTs`, and offer `tsOpen`/`tsClose`/`filled`/`qty` (already present in `fills.json`).

### 11d. Reading the overnight experiment (executable without me)

8 offers from 2026-08-09, baseline in `pipeline/experiments/bid-depth-baseline-20260809.json`. The
two anchors make **opposite predictions**, which is what makes it discriminating:

- **Supports the wall:** fills cluster at/above −5%-of-guide *regardless* of live depth — i.e. only
  `Dragon javelin tips` (−1.91% guide) and `Irit leaf` (+0.77% guide) fill, while the six deep-in-
  guide-terms offers sit unfilled despite being only 2–5% under live.
- **Refutes it (and matches everything above):** fills track **%-under-live** and ignore the guide
  boundary — i.e. `Irit leaf` (−1.75% live), `Dragon javelin tips` (−0.14% live), `Teak logs` (−2.66%),
  `Bastion potion(4)` (−2.88%), `Saturated heart` (−3.17%) fill, while `Looting bag note` (−12.52%
  live) does not.
- **n=8, one night, one desk — a lean, not a law.** It cannot overturn §5–§7; it can only agree or
  flag a surprise worth re-opening. Record the outcome in the baseline file, do not re-verdict this
  plan off it alone.

### 11e. Reproduction

Scripts are in the job scratch dir (`…/jobs/950fdd1e/tmp/`), not committed: `fetch-guide.mjs`
(weirdgloop guide history), `build-dataset.mjs` + `enrich-live.mjs` (Dataset A), `analyze.mjs` /
`analyze2.mjs` / `analyze3.mjs` (tests §5/§6/§8), `wall-test.mjs` + `wall-robust.mjs` (Dataset B and
the placebo). All open the archive `open(undefined, { readonly: true })`. If any of this is worth
keeping, it belongs under `pipeline/experiments/` with a README entry — it is currently evidence,
not source.

---

## Appendix — adversarial hardening lanes queued 2026-08-09 (dispatch roster)

Ben's instruction: adversarial Opus subagents investigate and harden each, Claude validates, parallel
where it makes sense. Full backlog context in PLAN.md "Discovered" + the 2026-08-09 session.

| Lane | Topic | Notes |
| --- | --- | --- |
| **A** | This document — the −5% bid-depth wall | Independent; does not need the fills join. **DONE 2026-08-09 — NOT SUPPORTED; see BD1–BD6** |
| **B** | `THIN_RESERVE` is a fixed 6 governing a capital-dependent problem | Measured 2026-08-09: at 116m the binding constraint is `thin-reserve-full` (best excluded `Masori body (f)`, 3.34m/d); at 28m it was not binding at all |
| **C** | The suggestion→fill join | Root instrumentation blocker; also unblocks PLAN-REACH-HORIZON Chunk 3 and F1. **Note: BD3 above is a strict subset — do them together** |
| **D** | Four verified bugs | (1) hourly Δ/d reads a peak's position as a trend on 2-point slopes; (2) `windowHours > 24` silently wraps mod 24 to a full-day read; (3) no way to clear a phantom offer after a mobile cancel; (4) `capeff-digest.test.mjs:270,297` pins `MIRAGE_PLACEMENT`/`REACH_GRADE_CAP_FRAC` as bare literals |
| **E** | The attention axis — the unbuilt half of the 2026-08-09 ruling | Band/amp round-trip costs BOTH windows, churn costs one. Sequence AFTER B: both touch ranking/admission, and E interacts with the `MIN_GPD` re-derivation |
