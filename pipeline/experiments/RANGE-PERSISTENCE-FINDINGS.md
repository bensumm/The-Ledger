# RANGE-PERSISTENCE — does "it oscillates, and it's at the bottom" beat what we already ship?

> ## ⚠ CORRECTION BANNER — read before quoting anything
> This document was rewritten on 2026-08-11 after **two adversarial review passes** found seven
> critical and nine medium defects in the first complete draft. The **verdict did not change** — the
> reviewer who attacked the draft hardest confirmed it survived — but a great many *numbers*,
> *populations* and *strength claims* did. The full list is in §9. The headline corrections:
> - The first draft claimed the study "confirms at scale" that the shipped `oscillationVsKnife`
>   discriminates nothing. **Retracted.** That detector's fire rate is a function of how many days
>   it is fed (measured: 59.5% at 14d → 97.7% at 28d → 99.9% at 60d), and the shipped path feeds it
>   a ~15d endpoint-capped series. The 98.4% describes *this study's* 28d window, not the shipped gate.
> - The first draft reconciled arm B's payoff with `FLOOR-STRATEGY-FINDINGS`' +0.26%/7d as "a genuine
>   independent confirmation". **Retracted** — different metric, different signal family, different
>   weighting, and not independent (same archive, same window, same feed).
> - "~87% of the headline is spread" was a ratio of medians of different variables, which do not
>   decompose. **Corrected to 59% on the mean weighting**, the only one on which it is additive.
> - Two script bugs are fixed: the "14-day out-of-sample window" ran T…T+14 (**15 days, including the
>   decision day**), and the leg-length measure started from the first touch of a same-side group.
>   Both changed printed numbers. Every figure below is from the post-fix run.
> - The placebo (§5d) was **downgraded to a non-result**. Its null answers a different question than
>   the real statistic, which is disclosed in the script's own output rather than papered over.

**Answer: DON'T BUILD.** Conditioning on a demonstrated, repeatedly-traversed trading range shows no
measurable benefit over the amplitude condition it is bundled with, once amplitude and item identity
are both held fixed — and the criterion that detects such a range selects for items whose range is
*less* likely to hold out of sample, not more.

Study: `pipeline/experiments/range-persistence-study.mjs`. Read-only over the local `/1h` SQLite
archive; writes nothing the pipeline reads; removable per this directory's README.
**Not runnable on a clean checkout** — it needs the local archive (`pipeline/.market-archive.sqlite`)
and, for the item-class segment only, `pipeline/.cache/mapping.cache.json` (a missing mapping is
reported loudly, not degraded silently). Re-run:
`node pipeline/experiments/range-persistence-study.mjs [--section a|b|c|d|e] [--json <path>]`.

**Reproducibility note: the archive is LIVE.** It gained a day mid-session and every count moved
(56,852 → 58,787 scored rows). Numbers here are the run over **74 full days, 2026-05-30 → 2026-08-11**.
A later run will differ; the script prints its own day range in the header, and that header is the
authority, not this document.

---

## 1. The question

Ben, 2026-08-11: *"if an item typically oscillates between two ranges and then is at the bottom, isn't
it reasonable to suspect that it will rise again? (as long as the dip isn't explained by outside
factors)"* — and, approving the study: *"this is effectively the value strategy but with less
speculation."*

The claimed edge over the shipped `value`/Invest lane is **conditioning on demonstrated repetition**:
value bets an item *will* recover (one-shot, speculative); this bets an item that has *already*
recovered N times will recover again.

The predecessor study (`FLOOR-STRATEGY-FINDINGS.md`, one day earlier) asked the *unconditional*
version and found a real relative signal that was not a trade. Ben's objection to treating that as the
answer was correct: it pooled a universe that is ~80% 1k–10k commodities, and averaging oscillators
with trending items dilutes a conditional effect toward zero. **So no number here is a pooled
cross-sectional mean of the whole universe.** Every headline is a per-item distribution or a
within-item paired contrast, and both weightings (mean of per-item means, median of per-item medians)
are printed for every payoff cell.

---

## 2. Step 0 — the gate: what the archive supports

| | |
|---|---|
| usable FULL days (≥23 buckets) | **74** (2026-05-30 → 2026-08-11); 1 partial day dropped (2026-05-29), since a partial day fakes a low or a high |
| items with two-sided daily data | **4,365** in the panel |
| items surviving fit-coverage + the 1,000gp floor into scoring | **2,212** |
| scored item-origins | **58,787** |

Cycle arithmetic against Ben's hypothesised ~6–8 day period: fit window 28d = **3.5–4.7 cycles**;
test window 4d / 7d / 14d = 0.57 / 1.0 / 2.0 cycles.

A single 50/50 split-half of 74 days gives ~5 cycles per side and **two** scored windows — too few.
**A rolling-origin walk-forward was used instead** (fit on [T−28, T−1], read day T, enter T+1, exit
T+1+H, step the origin by one day), yielding 31 origins per item. The cost is overlap, which §8
accounts for explicitly. The gate PASSES.

What the study cannot escape: **74 days is one market regime.** That is asserted, not measured — no
regime test was run — but it bounds every number below and is unfixable with the data on hand.

### Circularity discipline

`amp-cycle-reproduction.mjs` established that fitting levels on the same days you then score inflates
completion (0.0% / 12.9% out-of-sample → ~100% / 85.7% in-sample on those two items). Every range level
here is fitted on days **strictly before** the origin. A second reviewer traced every field feeding
`qualifies`, `pir`, `tier` and both gates and confirmed none reads a price at or after the entry day.

Section D1 ships the in-sample version deliberately: out-of-sample reach@7d **46.2%** vs in-sample
**99.8%**. ⚠ **Do not quote "54 percentage points" as a measured quantity** (the first draft did). The
in-sample band is fitted on 8 days where the out-of-sample band is fitted on 28, so window *length* is
confounded with in-sample-ness; and the in-sample side is near-tautological, since a q85 of 8 daily
*mids* is tested against the max *high-side VWAP* over those same days, which exceeds the mid by
construction. The exhibit makes its point directionally and no more.

---

## 3. PRICE TIER, UP FRONT — does this cover the class Ben trades? **No.**

Stated first because it constrains everything after it. Distinct **items** reaching the
persistence-conditioned arm (arm A), by price tier and liquidity gate:

| tier | gate=strict (the shipped units screen) | gate=flow (price-neutral) | ungated |
|---|---|---|---|
| 1k–10k | 34 | 106 | 397 |
| 10k–100k | 2 | 94 | 223 |
| 100k–1m | **0** | 53 | 81 |
| 1m–10m | **0** | 14 | 20 |
| >10m | **0** | 3 | 4 |

Under the shipped units-based liquidity gate (median daily min-side units ≥ 3,500) the sample holds
**zero items above 100k gp**. That is the identical censoring that crippled the predecessor study, and
it is a property of the gate, not of this construction.

To give big-ticket any representation, a deliberately permissive **price-neutral** gate was added
(`flow`: median min-side ≥ 10 units/day **and** ≥ 1m gp/day min-side flow). It admits 14 items in
1m–10m and 3 above 10m — and those three produce arm A's worst cell in the study (net median −5.24%,
spread-free median −5.55% at 7d). **n = 3 items. That is not a finding in either direction; it is an
absence of data.**

**The study cannot answer Ben's question for the big-ticket class he actually trades.** Where
big-ticket appears at all it appears under a gate loose enough that the items are thin, and the
numbers there are dominated by an unexecutable spread (§5a).

---

## 4. Output (a) — PERSISTENCE: what fraction of items have a range that holds?

The selective criterion this study builds: the fitted band must be **repeatedly traversed**, not merely
non-monotone. Over the 28-day fit window, require ≥3 separate visits to the floor band (pir ≤ 0.15), ≥3
to the ceiling band (pir ≥ 0.85), ≥4 alternations between them, and an after-tax floor→ceiling
amplitude ≥6% (the bar `VALUE_MIN_CYCLE_PCT` sets, so the arms share one economic standard).

A reviewer hand-verified the traversal counter against seven synthetic series: it counts maximal runs
once, counts alternations correctly, and handles direct hi→lo transitions and interleaved mid-band
days. The criterion measured is the criterion described.

### 4a. It is selective — and here is the like-for-like comparison

| criterion (over this study's 28d fit window) | % of item-origins | % of items ever |
|---|---|---|
| shipped `oscillationVsKnife` → OSCILLATING | 98.4% | 99.7% |
| **traversal condition ALONE — the like-for-like number** | **26.2%** | 65.1% |
| amplitude ≥6% alone | 73.4% | — |
| both (arm A's qualifying criterion) | 17.7% | 47.4% |

### 4b. RETRACTED: the 98.4% is not a measurement of the shipped detector

The first draft wrote that PLAN.md's `MWO` Status row's 22/23 result "now reproduces at 4,363
items… It is confirmed." **That is wrong three times over** and is withdrawn:

1. The scored population is **2,212 items**, not 4,365 (that is the panel before fit-coverage and the
   price floor).
2. It is **ungated, all tiers**, dominated by cheap commodities — while §3 of this same document says
   the study holds zero items above 100k gp under the shipped gate. It cannot confirm a big-ticket
   finding.
3. Decisively: **`oscillationVsKnife` counts an absolute number of legs (`OSC_MIN_LEGS = 3`) over
   whatever window it is handed, with no normalisation for window length.** Its fire rate therefore
   saturates. Measured here, same code, same items, window swept:

| window fed | → OSCILLATING |
|---|---|
| 14d | 59.5% |
| **15d — approximately what the shipped path feeds** | **62.7%** |
| 21d (`OSC_DETECTOR_NIGHTS`, requested) | 88.9% |
| 28d (this study's fit window) | 97.7% |
| 42d | 99.6% |
| 60d | 99.9% |

The shipped call requests 21 nights but is **endpoint-capped at ~15 days** — `js/forecast.mjs:312`'s own
comment says so, and the series is a 365-point 1h fetch = 15.2 days. An independent reviewer measured
the shipped composition end to end and found `oscillationVsKnife` firing on **63–66%** of items there,
with the `knife` reject in `amplitudeGate` still firing on **3–4%** of rows. **So the shipped knife
guard is alive, and the "it discriminates nothing" reading does not transfer to it.**

PLAN.md's `MWO` Status row's own conclusion is also more careful than the draft made it: it says
the detector "cannot be used as evidence either way, **on this basket**," and the plan's status is
`SCOPING ONLY`.

**The real, transferable finding is different and more useful:** the detector's output is substantially
a function of series *length*. `js/forecast.mjs:307-311` floats sourcing a deeper series from the
archive as a follow-up, and `renderAmplitudeMode` already opens that archive in the same function.
Wiring it — a change that reads as a pure improvement — would take OSC to ~100% and **silently delete
the knife guard.** Nothing currently warns about that. It is the highest-value thing this study found.

### 4c. Period regularity: the criterion shows none

Among qualifying item-origins the median implied period is **6.0 days** (1k–1m tiers), 7.0d at 1m–10m,
9.0d at >10m, with leg-length CV 0.45–0.63. **This is not corroboration of Ben's 6–8 day figure** —
requiring ≥4 traversals inside a 28-day window mechanically bounds the period and pushes the median
into that range. The agreement is close to arithmetic. A reviewer went further and measured that
qualifying items' leg lengths are **more irregular than a driftless AR(1) random walk's** passing the
same criterion (legCV 0.693 vs 0.565 on the pre-fix measure). The regularity axis, which was the whole
point of building a criterion `oscillationVsKnife` lacks, shows no periodicity.

### 4d. And it does NOT select for persistence

"Persists" := ≥80% of the **14-day** out-of-sample window (T+1…T+14) lies inside
[floor − 0.15·range, ceiling + 0.15·range].

| gate | qualified | unqualified | lift |
|---|---|---|---|
| flow | 29.5% (n=3,327) | 31.2% (n=34,482) | 0.946 |
| strict | 28.2% (n=393) | 32.1% (n=9,742) | 0.881 |
| ungated | 34.3% (n=10,422) | 33.5% (n=48,336) | 1.024 |

Containment is partly a *volatility* measure — a flat item stays inside any band trivially, and the
unqualified pool is full of them. Holding amplitude fixed at ≥6% on both sides, and then further
conditioning on Ben's actual premise ("**and then it is at the bottom**"):

| gate | amplitude-matched lift | **conditioned on at-the-bottom, amplitude-matched** |
|---|---|---|
| flow | 0.784 | **0.826** — 22.9% (n=1,059) vs 27.8% (n=9,017) |
| strict | 0.697 | **0.500** — 15.6% (n=109) vs 31.2% (n=2,288) |
| ungated | 0.869 | 0.993 |

**Refuting test R1 fails, in the direction opposite to the hypothesis.** An item that has repeatedly
traversed its band is *less* likely to keep that band than an equally-wide-banded item that hasn't.

⚠ **Corrected strength claim.** The first draft wrote "there is no definition of 'persists' under which
the criterion selects for it." That is false — three of twelve sensitivity cells exceed 1, all at the
70% threshold (1.048 / 1.051 / 1.053), as does the ungated headline (1.024) and the 1m–10m tier (1.114).
The accurate statement: **lift is ~1.05 at a 70% containment threshold and falls below 1 at every
threshold ≥80%, reaching 0.462 at 100%. It is monotone in threshold, not in tolerance.**

⚠ **An unnamed rival explanation, surfaced in review and not excluded.** A reviewer measured that i.i.d.
white noise passes the traversal conditions **97.4%** of the time against a band fitted on the same
days, while AR(1) φ=0.85 passes **23.6%**. So the criterion is substantially a *low-autocorrelation*
(chop) detector. That gives a near-mechanical account of why qualified items keep their band less
often — noisy items are noisier out of sample — which the draft presented as a substantive fact about
oscillators. **The direction of §4d's result is not in doubt; its interpretation is.**

**So: ~29–34% of item-origins keep their fitted band out of sample; ~23% (flow) / ~16% (strict) do so
when the entry condition Ben described is also imposed. Knowing the item is a demonstrated oscillator
does not raise that number.**

---

## 5. Output (b) — PAYOFF: what a bottom-of-range entry pays

| arm | selection |
|---|---|
| **A** osc-bottom | traversal criterion + amp ≥6% + pir ≤ 0.15 |
| **F** amp-bottom | amp ≥6% + pir ≤ 0.15, **traversal criterion FAILS** — the load-bearing control |
| **B** bottom-only | pir ≤ 0.15 |
| **C** value-lane | the real `valueGate()` + `valueTier() === 'buy-now'` from `js/valuescreen.mjs`, called against a `termStructure` built from the same strictly-pre-origin fit window |
| **E** osc-any | traversal + amp, **not** at bottom |
| **D** all-days | base rate |

Arm A bundles *two* conditions. Arm F holds amplitude fixed and removes only the repetition half.
**A vs F is the study's actual question.**

⚠ **Arm C is a reconstruction of the value lane, not the value lane.** The functions called are the
real ones, but the world fed to them differs from production in two measured ways: production feeds
`termStructure` ~112 six-hourly samples (`loadDaily`, `DAILY_STEP_H=6`) where this feeds 28 daily
volume-weighted VWAP mids, which pre-smooths exactly the dispersion q15/q85 measures (median after-tax
amplitude 0.025 here vs 0.048 in production); and production's post-fetch `live` is `row.quickBuy`, the
**low** side, where this passes a mid. A reviewer measured the consequence: production yields ~2.5×
more buy-now rows. Production also demotes buy-now→watch on two informs and prints only a `valueScore`
top-N, neither of which arm C reproduces. **Treat every arm-C number as indicative of the gate's
*shape*, not of what the Invest lane actually surfaces.**

### 5a. The spread trap — read before any payoff number

`netPatient` buys the day's low-side VWAP and sells the day's high-side VWAP. With **zero** price
movement it still returns (spread − tax). Any filter that selects wide-band items therefore raises it
mechanically, with no forecasting content — the algebraic-tautology failure CLAUDE.md rule 11 names,
and the one that got `FLOOR-STRATEGY-FINDINGS` §4 retracted.

**On the mean weighting — the only one on which the decomposition is additive — 59% of arm A's 7-day
round trip is spread** (netPatient mean +13.60%, excessNet mean +5.52% → spread 8.08pp). ⚠ The draft's
"~87%" came from dividing a median spread by a median round trip; medians of different variables do not
sum (6.02 + 1.60 ≠ 6.89), and the same formula applied to arm D returns 188%, which is self-refuting.

Decomposition, gate=flow, H=7d, medians of per-item medians:

| arm | netPatient | same-day spread | excessNet (what waiting 7d added) | driftLo (spread-free) |
|---|---|---|---|---|
| A | +6.87% | +5.85% | +1.50% | +1.92% |
| F | +4.38% | +2.15% | +1.24% | +1.44% |
| B | +2.80% | +1.38% | +0.62% | +0.79% |
| C | +4.46% | +3.56% | +0.25% | +1.03% |
| D (base) | +0.79% | +1.42% | **−0.70%** | −0.41% |

The base arm's excessNet is negative — the decomposition's own null works, which is why the excess
column can be trusted. A reviewer verified algebraically that `excessNet` is genuinely spread-free
(`= (Sell_{T+1+H} − Sell_{T+1})(1−tax)/Buy_{T+1}`; the entry-day spread cancels).

**The execution bracket is wider than the effect.** Arm A at gate=flow: netPatient median **+6.87%** if
both legs fill patiently at VWAP, netCross median **−7.62%** if you cross the spread both ways. A
14-point bracket around a 1.5-point excess. **This study cannot tell you which end you would get.**

### 5b. Absolute payoff, gate=strict (the shipped screen), H=7d, medians of per-item medians

| arm | items | netPatient | excessNet | driftLo |
|---|---|---|---|---|
| A osc-bottom | 36 | +4.19% | +0.82% | +1.55% |
| F amp-bottom | 208 | +1.82% | +1.10% | +0.88% |
| B bottom-only | 320 | +0.52% | +0.35% | +0.52% |
| C value-lane | 145 | +1.84% | +0.81% | +0.48% |
| D base | 359 | −0.83% | −0.37% | −0.27% |

Note arm A's excessNet median (+0.82%) is now *below* arm F's (+1.10%) at this gate and horizon, while
its netPatient is more than double — the whole visible gap is spread.

⚠ **No cross-study equivalence is claimed.** The draft asserted that arm B's number "reproduces"
`FLOOR-STRATEGY-FINDINGS`' +0.26%/7d. Withdrawn: that figure is a `netPatient` (spread included) for the
`new30` signal on a per-origin-day cross-sectional median, and arm B's is an `excessNet` (spread
removed) for a `rest`-family signal on a median of per-item medians. FLOOR's own nearest analogue,
`rest30` netPatient, is **+0.02%**. And the two are not independent in any case: same archive, same
window, same upstream feed — which is exactly what `FLOOR-STRATEGY-FINDINGS:152-157` retracted for
itself. The only fair joint statement is that **two differently-constructed passes over this market
both put the ceiling at a few tenths of a percent per week.**

### 5c. The within-item paired test — where the hypothesis dies

Each arm above is a *different set of items*, so an arm-to-arm gap confounds signal with item
composition. Here each item is its own control (groups made disjoint; per-item difference computed
inside the item, then across items).

**A − F (repetition, amplitude and item identity both held fixed), Δ excessNet:**

| gate | H=4 | H=7 | H=14 |
|---|---|---|---|
| flow, mean (t) | −0.61% (−0.6) | +1.08% (0.8) | +0.89% (0.4) |
| flow, median | −1.02% | −0.31% | −0.44% |
| strict, mean (t) | −1.94% (−0.8) | −2.08% (−0.9) | −2.27% (−1.2) |
| strict, median | −1.47% | −0.71% | −1.13% |

**Refuting test R2 fails.** Six cells, both gates, three horizons: **not one is significantly positive**
(max |t| = 1.2), the robust median is negative in all six, and all three strict-gate means are negative.
A − B tells the same story. Once you control for amplitude and for which item you are looking at, the
demonstrated-repetition condition adds nothing measurable.

What *does* survive:

| comparison (gate=strict, H=7) | pairs | Δ excessNet | t |
|---|---|---|---|
| **B − D** — is being at the bottom itself worth it? | 314 | +6.25% | **7.6** |
| A − D | 36 | +6.59% | 2.7 |

**Position in the range is real; demonstrated repetition is not.**

⚠ **B − C is weaker than the draft claimed, and its explanation was computed on the wrong group.** The
disjointification means the control is C\B, not C — and **73–74% of arm C's rows are also arm B**,
precisely the deep ones. The control actually used has median pir **+0.283 (flow) / +0.315 (strict)**,
not the +0.014 / +0.008 the draft quoted for arm C. So most of the depth gap the draft used to explain
B − C was *created by the disjointification*. The script now prints both. Related: A − C is +4.37%
(t=3.3) at gate=**flow** but only **+0.55% (t=0.3)** at gate=**strict**, and **−1.19%** at strict/H=14 —
the draft quoted the flow figure without labelling the gate. A − B (+1.11%) + B − C (+6.78%) ≠ A − C
(+4.37%): the three run on different pair sets (246 / 367 / 236) and do not compose, so "that entire
gap is B − C" was an over-claim.

### 5d. The placebo (R5) — a NON-RESULT, and honestly so

Shuffle the `qualifies` label across items within **tier × amplitude decile**, metric **excessNet**,
200 shuffles. (A first version shuffled within price tier alone on `netPatient` and reported the 100th
percentile at all three horizons — a test that **could not fail**, since real qualified items carry a
wide spread random tier-mates do not. It was replaced, not reinterpreted.)

| H | real arm A excessNet | null mean | null p05 | null p95 | percentile of real |
|---|---|---|---|---|---|
| 4 | +3.70% | +3.65% | +3.06% | +4.26% | 58.0% |
| 7 | +5.52% | +5.24% | +4.40% | +6.19% | 68.0% |
| 14 | +4.95% | +5.96% | +4.94% | +6.92% | 6.0% |

**Read this as "no signal", not as "worse than random".** The real statistic requires the *origin* to
qualify; the null draws every bottom-of-range origin of a fake-labelled item (1,059 real rows across
267 items vs 3,339 rows for those same items — ~3× the rows). The null therefore estimates a different
quantity, so a low percentile is equally consistent with "the label is worthless" and with "qualifying
origins are a selected subset of an item's bottom days." **The placebo cannot separate them.** The
within-item A − F contrast in §5c is the test that can, and it is the one the verdict rests on. The
draft's "6.5 / 48.5 / 0.0" percentiles were pre-bugfix and are superseded.

### 5e. Entry-lag control (R6)

Re-entering two days later (T+3), same 7-day hold, gate=flow:

| arm | excess @ T+1 (mean / median) | excess @ T+3 (mean / median) |
|---|---|---|
| A | +5.52% / +1.50% | +3.26% / **−0.68%** |
| F | +3.93% / +1.24% | +2.34% / +0.53% |
| B | +3.27% / +0.62% | +2.14% / +0.15% |
| C | +2.33% / +0.25% | +1.88% / +0.28% |

Arm A's spread-free advantage does not merely shrink with a two-day lag; on the robust median it goes
negative. Most of what "at the bottom" is worth is a short-lived bounce, not a multi-day cycle
recovery — the opposite of what a ~6–8 day oscillation predicts. ⚠ Caveat the draft omitted: the lagged
arm requires days T+3 and T+10 where the base arm requires T+1 and T+8, so **the lag shifts the sample
as well as the entry.** `FLOOR-STRATEGY-FINDINGS` disclosed exactly this for its own lag control.

---

## 6. Ben's "outside factors" caveat — the gear-vs-commodity proxy

No game-update calendar exists in the archive, so this is **suggestive, not controlled.** Name-keyword
classifier; "100% coverage" means a name was found, not that the classification is good (`itemClass`
falls back to `'other'` for any named item, and that residual is 1,766 of 3,327 qualified rows).

| class | qualified persists | unqualified persists | lift |
|---|---|---|---|
| gear | 32.7% (n=1,134) | 30.0% (n=13,835) | 1.090 |
| consumable | 23.0% (n=427) | 31.8% (n=5,241) | 0.721 |
| other | 29.1% (n=1,766) | 32.1% (n=15,406) | 0.906 |

⚠ **Corrected inference.** The draft concluded "persistence failures do not cluster in gear." The table
reports within-class *lift*; clustering needs the across-class persistence *rate*, which is roughly flat
(unqualified: 30.0 / 31.8 / 32.1). The "consumables are worst" reading rests on 23.0% vs 31.8% at
n=427 — about 1.7σ, not established. **The honest statement is that this proxy provides no evidence
either way**, which is a weaker claim than the draft made and still leaves Ben's caveat open.

---

## 7. What survived an attack

A reviewer briefed to break the study confirmed these after trying:

- the traversal counter counts what the doc says it counts (hand-verified on 7 synthetic series);
- the `oscillationVsKnife` call is well-formed and fully exercises the detector's real path;
- strict pre-origin fitting holds for every selection field;
- `excessNet` is genuinely spread-free, and an atypical bottom-day entry spread does **not**
  contaminate the baseline;
- `tstat` is a correct one-sample t over the right unit; `ampDec` is a correct decile assignment;
- the archive coverage arithmetic; and the D3 lag control is not mis-displayed;
- **the verdict.** Nothing found turns A − F positive.

---

## 8. Honest n, weighting, multiplicity, survivorship

- **Non-overlapping observations.** Arm A: 333 non-overlapping entries (≥14d apart) across 267 items at
  gate=flow; **41 entries across 36 items at gate=strict.** Per item the archive supports 7 / 4 / 2
  non-overlapping windows at H = 4 / 7 / 14. The strict-gate arm-A result rests on **36 items in one
  regime** — that is the number to hold in mind, not the 1,059 item-origins.
- **Cross-item dependence is NOT handled.** Every t is a one-sample t over per-item differences, which
  disciplines within-item overlap but assumes items are independent across a common calendar. They are
  not — arm-B days concentrate on market-wide dip dates. **B − D's t = 7.6 over 314 items is not a
  de-correlated statistic.** The predecessor study handled this with per-origin-day cross-sections;
  this one does not. Treat every t here as an upper bound on significance.
- **Weighting.** Every payoff cell prints both mean-of-per-item-means and median-of-per-item-medians.
  ⚠ The draft claimed "no claim rests on only one of them" — false: the placebo (§5d) is mean-only and
  the lag control (§5e) was median-only in the draft. §5e now prints both; §5d remains mean-only and
  says so. The draft also said the two weightings "differ by 2–3× throughout"; measured, the ratio runs
  to **>12×** (arm C flow excessNet@7: mean 2.33% vs median 0.25%).
- **Multiplicity.** **593 cells** are computed and printed by the current script. ⚠ The draft's "588…
  all printed" was wrong: 36 of them printed nothing (a duplicate JSON rollup, now excluded from the
  count), while the counter simultaneously *under*-counted several printed blocks. The counter has been
  corrected but is an approximation, not an audited census — the honest reading is "several hundred
  cells, all printed, read the grid not one cell."
- **Survivorship.** Rejected before scoring: 39,640 fit-window gaps, 35,752 sub-1,000gp, 395 missing
  entry day, 31 degenerate range → 58,787 scored. (A further ~700 are dropped by a missing decision day,
  which the printed list does not itemise.) An item that delists or goes one-sided mid-window never
  enters a payoff mean. **That censoring is survivorship-favourable**: the true payoff of a bottom entry
  is *lower* than reported, by an amount this construction cannot measure.
- **`mid` is not spread-free.** It is the mean of the two side VWAPs, used here only as a *level* (range
  fitting, position-in-range), never as a return. ⚠ Note the shipped `pctInRange` uses a **raw min/max**
  basis where this study's `pir` uses **q15/q85**, so the 0.15 threshold does not transfer between them.

---

## 9. Verdict

**DON'T BUILD.**

1. **Does conditioning on demonstrated range-persistence beat the base rate?** Cross-sectionally arm A
   looks better than arms F, B and D — but that is item selection plus spread, not the condition.
   Within item, with amplitude held fixed, **A − F is not significantly positive in any of six cells**
   and its robust median is negative in all six; the amplitude-matched persistence lift is **0.70–0.83**
   (i.e. the criterion anti-selects); and a two-day entry lag turns arm A's excess median negative. The
   placebo is a non-result and is not counted as evidence.
2. **Does it beat the shipped value lane?** Not on the strength the draft claimed. A − C is +0.55%
   (t=0.3) at the shipped liquidity gate. And arm C is a *reconstruction* of the lane, not the lane.
   **Nothing here justifies a new lane.**
3. **Does it cover big-ticket?** **No.** Zero items above 100k gp under the shipped gate; 14 at 1m–10m
   and 3 above 10m under a gate loose enough to be unexecutable. The question is unanswered for the
   class Ben trades.

**The two separable numbers Ben asked for:**
- **Persistence:** ~29–34% of item-origins keep their fitted band out of sample; ~23% (flow) / ~16%
  (strict) when the "at the bottom" premise is also imposed. The oscillator criterion moves that lift to
  **0.83 (flow) / 0.50 (strict)** — down, not up.
- **Payoff:** conditional on the criterion, a bottom-of-range entry pays a median **+0.82% after tax
  over 7 days** at the shipped liquidity gate (netPatient +4.19%, of which the spread-free part is
  +0.82%) — of which the within-item, amplitude-matched, entry-lagged attributable part is **zero or
  negative**. The unconditional bottom entry pays **+0.35%/7d**. On a 40m position that is ~20k gp/day
  against a 250k gp/day attention floor.

**What IS worth keeping from this study:**
- **The `oscillationVsKnife` window-length trap (§4b) is the most valuable thing here** and is a live
  hazard: feeding the detector a deeper archive series — an available, obvious-looking improvement —
  would take it to ~100% OSC and silently delete the shipped knife guard. Nothing warns about this
  today. `docs/SIGNAL-AUDIT.md` has no row for this signal; that is where the measurement belongs.
- Position-in-range carries what signal there is (B − D), and `termStructure` already computes
  `pctInRange` at 1/3/7/14/28d — presentational, exactly as the predecessor study concluded. Note the
  basis mismatch in §8 before reusing any threshold.
- The observation that the value lane enters **shallower** than the band floor is now much weaker than
  the draft claimed (§5c) and should not be acted on without a clean, non-disjointified re-test that
  also prices what depth costs in fill probability.

**If revisited**, the missing ingredient is not a better detector — it is more history and a
cross-sectionally de-correlated statistic. Four cycles to fit and one to test is the floor of what the
question needs, and 74 days is one regime. Ask again at ~6 months of archive, keep the arm-F control
(it is what turned a +13% headline into a null), and add per-origin-day cross-sections.

---

## Appendix — review log

Recorded rather than deleted, per this repo's practice.

**Self-corrected in my own second pass, before external review:**
- The headline was an artifact: the first complete draft reported arm A at +13.6% netPatient@7d and
  would have read as a strong positive. The spread decomposition showed most of it is bid-ask spread
  the ≥6% amplitude filter selects for mechanically.
- The placebo could not fail; restratified on tier × amplitude decile with `excessNet`.
- Mean-only reporting was misleading; both weightings added.
- A large discrepancy against `FLOOR-STRATEGY-FINDINGS` was chased down by re-running that study rather
  than reasoning about it (rule 11: answer from a different data source).

**Overturned by adversarial review (two separate agents, one attacking this study's internals, one
scoped deliberately away from it):**

*Critical, all now corrected above:* the FLOOR-STRATEGY "independent confirmation" (wrong metric, wrong
signal family, wrong weighting, and not independent); the "87% is spread" ratio-of-medians; the
weighting-honesty claim in §8, contradicted by the placebo and lag control; the placebo's estimand
mismatch; the B − C disjointification and the depth diagnostic computed on a group not in the test; the
"reproduces at 4,363 items" population error compounded by the window-length trap; and "no definition
under which the criterion selects for persistence", contradicted by the table directly above it.

*Medium:* arm C is a reconstruction with ~2.5× fewer buy-now rows than production; the persistence
headline answered a question without Ben's "at the bottom" premise; the out-of-sample window ran 15 days
including the decision day; the 54pp circularity contrast is confounded by fit-window length; the cell
count was wrong in the paragraph about multiplicity honesty (the exact failure `FLOOR-STRATEGY-FINDINGS`
records for itself); the gear inference is unsupported by the table cited; cross-item correlation is
unaddressed; gates were mixed between sections; the lag control shifts the sample.

*Two real script bugs* were found by review and fixed: the containment window start, and leg lengths
measured from the first touch of a same-side group. Both moved printed numbers.

**The pattern, in the reviewer's words:** every critical defect was a *selection* or *labelling* error,
not a computation error — which weighting each headline used, which population a number was attributed
to, which group a test actually compared. Four of the seven were in or adjacent to the first
Appendix — **the corrections themselves carried the false claims.**

**Found outside this study, by the away-scoped pass** (relayed for triage; not part of this study's
verdict): `pFillValue` reads a `coverageDays` field `valueRanges` does not return, so every value row's
`estN` is structurally 0; the `/scan` skill quotes the value liquidity floor as 50 where the code says
3,500; the superseded 500k gp/day floor survives in two files in this very directory
(`EDGE-MAP-FINDINGS.md`, `VOLUME-VS-BAND-FINDINGS.md`) with no `lint-docs` rule covering it; two `gate`
validators declared on the value niche never execute; and several shipped per-topic plans remain in
`plans/` unfolded. All seven CI guards pass on the current tree.
