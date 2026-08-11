# The floor strategy — is "at its N-day low" a buy signal? (2026-08-11)

Ben, 2026-08-11: *"investigate the floor strategy of finding items that are at their 1/3/7/14/30 day lows."*

Script: `floor-strategy-study.mjs` (`--section a|b|c|d`, `--json <path>`). Read-only over the local `/1h`
SQLite archive through the shipped `pipeline/lib/market/archive.mjs` handle; tax from `js/money-math.js`.
Writes nothing the pipeline reads; removable per this directory's README. **Not runnable on a clean
checkout** — see Limits.

> **⚠ READ THE PRIOR ART FIRST — THIS QUESTION WAS CLOSED YESTERDAY.**
> `plans/PLAN-DAY-LOW-SURFACING.md` is **`CLOSED — MEASURED NEGATIVE (2026-08-10)`**, from Ben's own
> near-identical ask one day earlier (*"a new item surfacing strategy based on items resting on their
> 1/3/7/30 day lows"*). Four measurement passes ran; nothing was built; the file says *"nothing should
> be."* **This document is a re-measurement, not a fresh investigation** — different construction, run
> to see whether that closure survives a second look. It does. If you are here to decide whether to
> build something, the decision was already made and this doc only strengthens it.

> **⚠ THIS DOC WAS MATERIALLY WRONG IN ITS FIRST DRAFT.** An adversarial review pass found 25 defects,
> including two of the three "new findings" being cherry-picked or weighting-dependent. Sections 3 and 4
> are rewritten retractions. The **verdict is unchanged** — it rests on sections 1 and 2, which
> reproduced cell-for-cell — but the discriminator conclusions are much weaker than first written. The
> retracted claims are recorded rather than deleted, per this repo's practice.

## Verdict up front

**An N-day low is a real, robust, *relative* signal and it is not a trade.** Deeper and longer lows
predict better forward drift than the same day's cross-section, monotonically in N for the "printed a
new low" form, surviving an entry-lag control — and the best absolute after-tax round trip it produces,
under the most generous execution assumption available, is **+0.26% over a 7 day hold**. That is
~15k gp/day on a 40m position against the scan's **250k gp/day** attention floor.

What I can and cannot add beyond the prior pass:

1. **No discriminator was found.** The falling-floor knife hypothesis is **not supported and not
   refuted** — the sign flips with the signal definition (rising wins 4 of 6 comparisons, falling 2 of
   6), so slope is simply unavailable as a discount-vs-knife separator here. My first draft claimed
   "falling is *better*"; that was **one cherry-picked cell of six** and is retracted (§3A).
2. **Drawdown depth: the NET gradient is a spread artifact; the DIRECTIONAL gradient is not killed.**
   Deep-drawdown lows appear to pay far better on net return (+1.67% vs −1.65%) purely because their
   entry spread runs 3.40% vs 0.25%. But on the direction-only metric, equal-weighted by item, the
   gradient **survives** (+0.17% → +1.96% across drawdown buckets for `new7`). My first draft called
   this "refuted"; that was **weighting-dependent and overstated** (§4).
3. **The study cannot speak to the class Ben actually trades.** Under the shipped liquidity gate the
   sample holds **0 items priced 1m–10m** and 1 above 10m. ~80% of observations are 1k–10k commodities.

The honest sample size: **5 non-overlapping 7-day windows**, 2.4 non-overlapping 30-day trailing
windows per item, one regime.

**None of this changes the decision**, because the decision turns on the absolute magnitude in §1, not
on any discriminator: even the best-conditioned bucket cannot turn a −0.84% baseline round trip into
something worth attention.

## Prior art — what already exists, and what the ask actually names

Everything this ask needs is already computed. The gap is not data and not math.

| Component | Horizons | Disposition |
|---|---|---|
| `termStructure` (`js/termstructure.mjs`) | **1 / 3 / 7 / 14 / 28d** — `low`, `high`, `qlow`, `qhigh`, **`pctInRange`** | shipped primitive; app + console |
| `basePosition` | **14d only** (`BASEPOS_LOOKBACK_DAYS`) | inform-only, stdout-only, n≈0 |
| `floorValidator` (`js/validate.mjs`) | **28d** q15 durable floor, distance in IQR swing units | **the only validator that still drops rows** |
| `valueRanges` / Invest lane (`js/valuescreen.mjs`) | 28d durable, **7d** RC1 recency anchor, 3d-vs-14d knife delta | buy-near-the-multi-week-low, its own gate |
| `floorCeilingTrack` (`js/windowread.mjs`) | **5d** slope, **13d** floor-break | inform; drives the `@floor` cue |
| `softBuyRead` | intraday dip cluster over 7 nights | inform-only, never gates |
| `nominateDip` (DL4) | live vs 24h floor | watch-nomination, not a low read |

`termStructure` returns `pctInRange = (current − low)/(high − low)` over raw daily-mid low/high
(`js/termstructure.mjs:102`) for **1/3/7/14/28** — four of Ben's five horizons, already computed and
already tested.

**So the gap Ben's ask names is exactly three things, and they are all presentational:** (a) a
**cross-horizon** read — `basePosition` quotes one horizon, nothing composes five; (b) a **surfacing
lane**; (c) a settled **"resting on"** definition. Ben's `30` is the only genuinely absent number, and
it is 2 days from the shipped `28` (`FLOOR_LOOKBACK_DAYS`) — the prior plan's recommendation to reuse
28 rather than fork a second near-identical multi-week horizon still stands.

**And that gap is closed by a measured negative, not by an unbuilt feature.** The cross-horizon read was
prototyped inside the 2026-08-10 harness; its chunk 0d — 1,434 origins over **42 items**, taxed and
liquidity-gated — topped out at +0.26%/7d.

## Method

| | |
|---|---|
| Source | `pipeline/.market-archive.sqlite`, `/1h` grain, whole-market bulk observations |
| Span | **73 complete days**, 2026-05-30 → 2026-08-10 (partial edge days dropped; 72 days at 24 stored buckets, one at 23) |
| Panel | 4,363 items have a two-sided daily print; after the 30-day-warmup, price-floor and forward-window filters, **2,020** items contribute the **60,151** item-day observations, over **35 origin days** |
| Liquid universe | median trailing-14d `min(hiVol,loVol) ≥ 3,500` → **11,770 obs / 391 items** |
| Price floor | mid ≥ 1,000 gp (the prior study's penny-item artifact guard) |
| Decision timing | signal computed at the **close of day D** on complete data; entry **D+1**; exit **D+1+h** |

**Every signal and segment column reads only days ≤ D, with ONE exception: `entrySpread` (day D+1)**,
which is used solely as a mechanism diagnostic in §4 and as C3's matching variable. It is not
pre-decision and nothing may be built on it — see Limits.

Two signal definitions, both fixed before results were seen:

| measure | definition | what it is |
|---|---|---|
| `newN` | `dayLow(D) ≤ min(dayLow[D−N … D−1])` | today **printed** a new N-day low |
| `restN` | `pctInRange` over the trailing N daily mids `≤ 0.15` | today is **resting on** the N-day low (the shipped `pctInRange` shape) |

`rest1` is structurally impossible — a one-point window has `high === low`, so `pctInRange` is null and
the flag never fires. It appears in no table.

Three return metrics:

| metric | construction | reads as |
|---|---|---|
| `midR` | mid(D+1+h) / mid(D+1) − 1 | **directional drift**, untaxed. ⚠ **NOT spread-free** — `mid = (lowVWAP + highVWAP)/2`, so a spread that compresses over the hold drags mid down mechanically. This matters in §4. |
| `netPatient` | buy at D+1 low-side VWAP, sell at D+1+h high-side VWAP, GE tax on the sale | **best-case execution** — both legs fill patiently. An upper bound, not an estimate. |
| `netTaking` | buy at the high side, sell at the low side, taxed | **worst case** — cross the spread twice |

**The comparison is the study.** An absolute "62% of N-day lows were higher a week later" means nothing
without the unconditional rate. So every headline is a **per-origin-day cross-section**: on each calendar
day, the signal group's median minus the non-signal group's median (days with fewer than 3 rows on either
side are dropped). `DIFF` is the **mean of those 35 daily differences**; `t(day)` is a one-sample t over
the same 35 values. This cancels market-wide moves and collapses within-item serial correlation into one
number per day. It does **not** fix the overlap between consecutive origin days — §5, which is why
`t(day)` is descriptive and never a p-value.

## 1. Base rate comparison — the signal is real and monotone in N for `new`

Liquid universe, +7d. All nine signals shown on every metric, so the row sets are comparable.

| signal | nSig | items | `midR` sig / base / **DIFF** | `netPatient` sig / base / **DIFF** | `netTaking` **DIFF** |
|---|---:|---:|---|---|---:|
| `new1` | 5,771 | 386 | −0.04% / −0.25% / **+0.31%** | −0.64% / −1.01% / **+0.41%** | +0.36% |
| `new3` | 3,534 | 378 | +0.10% / −0.27% / **+0.52%** | −0.37% / −1.01% / **+0.76%** | +0.62% |
| `new7` | 2,156 | 367 | +0.34% / −0.26% / **+0.69%** | −0.04% / −0.98% / **+0.91%** | +0.89% |
| `new14` | 1,302 | 336 | +0.45% / −0.21% / **+0.99%** | +0.11% / −0.94% / **+1.25%** | +1.00% |
| `new30` | 789 | 259 | +0.72% / −0.19% / **+1.26%** | **+0.26%** / −0.91% / **+1.37%** | +1.33% |
| `rest3` | 5,248 | 382 | +0.08% / −0.38% / **+0.54%** | −0.37% / −1.15% / **+0.84%** | +0.63% |
| `rest7` | 4,023 | 368 | +0.32% / −0.43% / **+0.80%** | +0.07% / −1.19% / **+1.31%** | +0.90% |
| `rest14` | 3,359 | 357 | +0.41% / −0.39% / **+0.79%** | +0.23% / −1.16% / **+1.35%** | +0.88% |
| `rest30` | 3,177 | 322 | +0.32% / −0.34% / **+0.62%** | +0.02% / −1.11% / **+0.93%** | +0.70% |

**For the `new` family the DIFF gradient is strictly monotone in N on all three metrics** — `midR` runs
+0.31 → +0.52 → +0.69 → +0.99 → +1.26pp across 1/3/7/14/30d, and `netPatient` and `netTaking` run the
same way. **The `rest` family is not monotone**: it peaks at 7–14d and falls back at 30d on every metric
(`midR` +0.80 → +0.79 → +0.62; `netPatient` +1.31 → +1.35 → +0.93; `netTaking` +0.90 → +0.88 → +0.70).
That asymmetry is itself the most interesting structural result here: *printing a new low* sharpens with
horizon, *sitting in the bottom 15% of the range* does not.

**N=1 is the weakest** — +0.31pp relative, negative absolute — independently confirming the prior plan's
warning not to present the 1-day bit as a signal.

**The absolute column is what you collect, and it is approximately zero.** `new30` at +0.26%/7d is the
ceiling of this idea, and `netTaking` is net negative everywhere (`new30` −2.49% against a −3.88% base).

The prior study's best bucket was also +0.26%/7d. **That agreement is weaker evidence than my first
draft claimed** and the claim is retracted: the two runs share the same SQLite archive, an overlapping
window and the same upstream wiki feed, so they are *not* independent; and they estimate different
things (its `1110` bucket over 139 origins / **23 items**, vs `new30`'s median over 789 origins / 259
items). Agreement to two decimals is coincidence. What is fair to say is narrower and still useful: two
differently-constructed passes over this market both put the ceiling at *a few tenths of a percent per
week*.

## 2. Why the baseline round trip loses

| liquid universe, +7d | this study | PLAN-DAY-LOW 0d |
|---|---:|---:|
| median entry-day spread | **+1.94%** | +1.82% |
| median mid drift | −0.15% | 0.00% |
| median net, both legs patient | **−0.84%** | −1.32% |
| median net, crossing both ways | −3.77% | — |
| P(net > 0) | 43.7% | 41% |

The direction is clear and matches: **the origin population's spread sits below the 2% GE tax**, so
buying at the bid and selling at the ask a week later is a structurally losing trade on this population
before any signal is applied.

**But the decomposition does not fully close, and I will not call it confirmed.** 0.98 × 1.0194 × 0.9985
− 1 = **−0.25%** against the observed **−0.84%** — ~0.6pp unexplained, the same shortfall
`PLAN-DAY-LOW-SURFACING.md:221-223` reported (~1pp) and explicitly warned *"should not be quoted as the
cause"* (a median of a product is not the product of medians when the terms are correlated per-origin).
My first draft wrote "the mechanism is arithmetic and it is now confirmed twice"; that reproduced the
exact error the prior art flagged, and is retracted. The sign and rough magnitude replicate; the
mechanism is **consistent with**, not established by, this data.

## 3. The discriminator hunt — nothing separates discount from knife

The brief's central question: *under what conditions does an N-day low mean "discount" rather than "the
floor is breaking"?* Liquid universe, +7d. **Answer: on this evidence, nothing tested does.**

**A. Floor slope — no consistent direction. RETRACTION.**

My first draft quoted only the `new7`/`midR` cell and concluded "falling is *better*." Here is the full
grid (pooled median / per-item median):

| | rising | flat | falling | winner |
|---|---|---|---|---|
| `new7` `midR` | +0.57 / +1.12 (n449) | +0.17 / +0.34 | **+0.80 / +1.52** (n784) | falling |
| `new7` `netPatient` | +0.80 / +0.98 | −0.80 / +0.36 | +0.78 / **+1.66** | split |
| `new30` `midR` | +3.18 / +6.18 (n31, i27 — **too thin to quote**) | +0.61 / +0.69 | +0.74 / +1.29 | — |
| `new30` `netPatient` | +6.92 / +6.92 (n31 — **too thin**) | −0.32 / +0.09 | +0.58 / +2.00 | — |
| `rest30` `midR` | **+0.62 / +1.79** (n101, i50) | +0.21 / +0.76 | +0.44 / +1.56 | rising |
| `rest30` `netPatient` | **+2.82 / +3.25** (n101) | −0.76 / +0.44 | +0.60 / +1.87 | rising |

Excluding the two `new30`-rising cells as too thin (n=31), **rising wins `rest30` on both metrics and
falling wins `new7` on both**. The sign flips with the signal definition. So:

**The knife hypothesis is NOT SUPPORTED and NOT REFUTED. Slope is simply unavailable as a separator on
this evidence** — and my draft's "falling is better, matching the value-knife inversion" was one
cherry-picked cell presented as the result. The `docs/LORE.md` value-knife comparison was also a
category error: that measured `classifyTrajectory` *class* against 28d excess return, not 30d OLS
floor-slope sign against 7d mid drift. Different variable, metric and horizon.

The one pattern consistent across all six cells is that **`flat` is the worst bucket** — both a rising
and a falling floor beat a flat one. With 4 independent-ish windows, no test statistic, and no per-day
cross-section computed for any segment, that is an observation to re-measure, not a finding.

**B. Drawdown depth — the net gradient is spread; the directional one may be real. See §4.**

**C. Item class — the measurement is silent, and my draft's numbers were wrong.**

Corrected (`new30`, +7d): gear `midR` **+0.97%** (n=88, **44 items**, P(>0) 76%), consumable +0.76%
(n=300, 81 items), other **+0.41%**. On `netPatient`: gear **+0.11%**, consumable +0.14%, other
**+0.42%**. *(My first draft printed +0.98% / 46 items / n=91 / other +0.38%, and reported the
consumable `netPatient` value as gear's — six wrong numbers in one paragraph.)*

Every cell is inside noise at 88 observations. More importantly the `update-cycle-timing` loss pattern
is a **rare event study** — a handful of post-update gear dumps — which 73 days cannot resolve. Read
this segment as **silent**, not as clean, and certainly not as licence to buy gear lows.

**D. Price tier — see §5. The tier Ben trades is absent.**

## 4. Drawdown depth — a partial retraction

Drawdown depth produces the cleanest gradient on the board. `rest30`, `netPatient`, +7d: dd<5% −1.65% →
dd 5-15% −0.59% → dd 15-30% +1.07% → dd>30% +1.67%. My first draft declared this **refuted** as a
mean-reversion effect. That was **half right and overstated**.

| `rest30` bucket | n | **items** | entrySpread | 30d range width | `midR` pooled | `midR` **per-item** | `netPatient` |
|---|---:|---:|---:|---:|---:|---:|---:|
| dd <5% | 183 | **25** | +0.25% | +1.34% | +0.12% | +0.16% | −1.65% |
| dd 5-15% | 724 | **117** | +1.15% | +9.08% | +0.43% | +0.80% | −0.59% |
| dd 15-30% | 1,214 | **181** | +2.12% | +21.62% | +0.82% | +2.11% | +1.07% |
| dd >30% | 1,056 | **123** | +3.40% | +54.99% | **−0.05%** | **+2.10%** | +1.67% |

**What holds.** The `netPatient` gradient is spread: `entrySpread` rises 0.25% → 3.40% in lockstep, and a
"deep 30-day low" is overwhelmingly a statement that the item's 30-day mid range spans 55% of its own
price — i.e. that it is volatile and thinly priced. Nobody should read the net column as reversion.

**What does NOT hold, and is retracted.**

1. **The test is close to tautological.** By construction `netPatient ≈ (1+entrySpread)(1+askDrift)(1−tax) − 1`,
   so *any* bucketing that sorts on spread must show net tracking spread. A test whose confirming outcome
   is guaranteed by the metric's algebra is not a refuting test (CLAUDE.md rule 11). I presented it as one.
2. **"`net − spread` flat at ≈−1.7%" was wrong.** The values are −1.90 / −1.74 / **−1.04** / −1.73. Backing
   out the algebra leaves ~0.9pp of genuine ask-side drift gradient (+0.10% → +0.96%) that I reported as
   absent.
3. **The kill was weighting-dependent, and I silently switched weightings.** On per-ITEM medians — the
   weighting this doc prefers in §3A and which the prior plan called *"the strongest column"* — the
   directional gradient **survives**: `new7` runs +0.17% → +0.52% → +0.93% → **+1.96%** (fully monotone)
   and `rest30` runs +0.16% → +0.80% → +2.11% → +2.10% (monotone then plateau). Only the *pooled* median
   goes negative in the deepest bucket, because a handful of high-frequency volatile items dominate it.
4. **`midR` is not spread-free**, as the Method table now says. `mid = (lowVWAP + highVWAP)/2`, so a
   spread that compresses over the hold pushes mid down mechanically — biasing precisely the wide-spread
   bucket the whole argument turns on.
5. **The items column was omitted**, hiding that dd<5% rests on **25 items** against 123 for dd>30%.

**Honest position:** the *net* gradient is an execution artifact and must not be built on. Whether deep
drawdown carries real directional mean reversion is **unresolved** — it survives on the item-weighted
view and dies on the pooled one, and the metric that would arbitrate is itself spread-contaminated.
Settling it needs a spread-orthogonal return measure this study does not have.

Two controls the *headline* §1 signal passes:

- **C2 — no spread selection.** The signal group does not buy wider spreads than base
  (`rest30` 1.97% vs 1.93%; `new7` 1.88% vs 1.95%; `new30` 1.63% vs 1.96%). §1's diff is not the §4
  artifact in disguise.
- **C4 — entry lag.** The relative edge decays but persists (`rest30` `midR` DIFF +0.66% → +0.49% →
  +0.37% at lag 1/2/3), matching the prior study's ~40% attenuation. The **absolute** number goes
  negative immediately: +0.02% → −0.09% → −0.32%. Even the zero-ish payoff requires acting the next day.

**C3 is downgraded to a diagnostic, not a control.** Matching on entry-spread deciles gives a surviving
+0.66pp (`rest30`) / +0.75pp (`new7`) `netPatient` diff — but `entrySpread` is a **post-treatment**
variable (realized on D+1, driven by the same price action as the return). Conditioning on it can bias
the estimate either way. My draft's "the relative edge is genuine" overstated what C3 licenses; the
edge's real support is §1's cross-sectional DIFF and C4, not C3.

## 5. What the sample can and cannot bear

| | |
|---|---:|
| complete days in panel | 73 |
| usable origin days (30d warmup + 8d forward) | **35** |
| non-overlapping 7-day-hold windows | **5** (D = 30, 38, 46, 54, 62) |
| non-overlapping 30-day trailing windows per item | **2.4** |
| liquid items | 391 |
| liquid items ever firing `rest30` | 322 |

Every n in §1 — 3,177 for `rest30`, 789 for `new30` — is an overlapping count. Consecutive origin days
share 7 of 8 days of their forward window and 29 of 30 of their trailing window. **Treat `t(day)` as
descriptive of this window, never as a p-value.**

On the non-overlapping subsample (5 origin days):

| signal | `midR` DIFF | `netPatient` DIFF |
|---|---:|---:|
| `new7` | +0.52% | +0.45% |
| `new14` | +0.62% | +0.75% |
| `new30` | **−0.09%** | +0.23% |
| `rest7` | +0.99% | +1.22% |
| `rest30` | +0.66% | +0.65% |

**`new30`'s sign flips.** The 30-day horizon — the one Ben named and the one with the largest DIFF in §1
— has the fewest independent windows and does not hold up. Five windows cannot refute anything; the
honest reading is that **the 30-day result is the least trustworthy number here, not the most.**

**The big-ticket coverage hole.** Under the shipped liquidity gate:

| price tier | items | obs | `rest30` items |
|---|---:|---:|---:|
| 1k–10k | 322 | 9,386 | 261 |
| 10k–100k | 77 | 2,282 | 63 |
| 100k–1m | 5 | 66 | 2 |
| **1m–10m** | **0** | **0** | **0** |
| >10m | 1 | 35 | 1 |

**9,386 of the 11,769 liquid observations with a +7d exit (~80%) are 1k–10k gp commodities.** (Item
counts sum above 391 because an item can cross a tier boundary across the window.) Ben's book is not
this. Dropping the liquidity gate puts 138 items above 10m in frame, and there the directional signal
disappears: `rest30` `midR` reads −0.04% (100k–1m), −0.13% (1m–10m), +0.39% (>10m) against +0.72% for
1k–10k. The `netPatient` column in that ungated view (+5.67% at 1k–10k on a 5.86% spread) is the §4
artifact at full strength and **must not be quoted as a return**. Same scope limit as
`VOLUME-VS-BAND-FINDINGS.md`: *the strong claim does not cover the class Ben actually trades.*

## Is this actionable?

**No.** Concretely:

- **Do not build a low-surfacing lane or `--mode`.** The relative signal is real and worth ~+0.5 to
  +1.3pp of 7-day drift against the day's cross-section. The absolute, collectable number is +0.26%/7d
  at the ceiling — **~15k gp/day on a 40m position** against a 250k gp/day floor. Clearing that floor
  needs 1.75m gp of profit per 7-day cycle, i.e. a **~673m single-item position**, far past what this
  population absorbs.
- **Do not treat a deep low as a credit.** Not because §4 refutes it — §4 is now a partial retraction —
  but because the only *collectable* version of the effect is an illiquidity premium, and no tested
  condition separates a discount from a breaking floor (§3). Ben's `base-position-caution-not-credit`
  ruling is a **risk** rule; nothing here gives grounds to relax it, and the prior plan's request that
  the two be reconciled is answered by "the credit reading has no support that survives review."
- **The 1-day low is not worth surfacing.** Weakest DIFF, negative absolute, and at daily grain it is not
  the intraday read it sounds like. `softBuyRead`'s `@floor` cue already owns that job on the right grain.
- **What the data supports is already shipped.** "Buy near a multi-week low and hold for the cycle" is the
  Invest lane. If anything is ever added, the prior plan's call stands: **columns on Invest, at horizon 28
  not 30, inform-only** — not a new board.

## Limits (rule-4 honesty)

- **One window, one regime, no out-of-sample split.** 73 days, 2026-05-30 → 2026-08-10. Descriptive of
  that window, not predictive.
- **5 independent 7-day windows.** Every large n above is overlapping. `new30` specifically rests on 5
  origin days and flips sign when de-overlapped.
- **Multiplicity.** §1 emitted 162 cells (180 by design, less 18 structurally-impossible `rest1` cells)
  and §3 emitted **84** discriminator cells — not the 24 my first draft claimed, in the very paragraph
  meant to be about multiplicity honesty. Judge the **pattern across the grid**, never a single cell.
  §3A is a live example of what happens otherwise.
- **`entrySpread` is not pre-decision, deliberately.** Measured on D+1, used only as a §4 mechanism
  diagnostic and C3's matching variable — the latter being post-treatment conditioning, which is a
  diagnostic and not a clean control. Nothing may be filtered on it. Every other signal and segment
  column reads only days ≤ D.
- **`midR` is not spread-free** (`mid` is the mean of the two side VWAPs), so it is not a clean
  arbitrator of spread-vs-direction questions. This is the main reason §4 ends unresolved.
- **`netPatient` is a ceiling, not an estimate.** It assumes a bid fills at the day's low-side VWAP and an
  ask at the high-side VWAP seven days later. Real execution sits between it and `netTaking` (−3.77%).
- **Forward-looking sample condition.** An item whose D+1 goes one-sided is dropped from the sample
  entirely rather than counted as a failed entry. It cuts both groups, but it is a condition on the
  future and is not neutral.
- **C4's lag control shifts the sample as well as the lag** (3,177 → 3,073 → 2,979 origins), so a little
  of the measured decay is a different set of days.
- **The two-sided-fraction half of the liquidity gate is dead code.** `LIQ_TWOSIDED_FRAC = 0.90` can never
  bind: the panel build already drops any day where either side is null, so `min(loVol,hiVol) > 0` always
  and the ratio is always 1.0. The real selection is stricter than advertised — **100%** two-sided across
  all 31 trailing days — and happens upstream. Also, the **3,500** constant is PLAN-VOL24's `FLOOR`
  (`pipeline/lib/signal/gatecandidates.mjs:69`), applied there to corrected rolling-24h volume; it is not
  "the S1 gate" (`docs/MARKET-ANALYSIS.md:580` — two-sided + ~100/day + the 250k gpd floor), and here it
  is applied to a 14-day median of daily min-side. Related but not the same threshold.
- **The gear/consumable split is a name-keyword proxy** and the post-update dump it exists to test is a
  rare event 73 days cannot resolve. Read it as silent.
- **Selection, not survivorship.** The `/1h` bulk endpoint archives every item that traded, so this is not
  a watchlist — but it is a snapshot of items trading *today*, and the liquidity gate is hard selection
  on top.
- **Not runnable on a clean checkout, and the numbers drift on re-run.** Both inputs are gitignored:
  `pipeline/.market-archive.sqlite` (`.gitignore:17`) and `pipeline/.cache/` (`:4`). With no archive the
  script **throws `ERR_SQLITE_ERROR`** at `open()`. With no `mapping.cache.json` it degrades *silently* —
  every item classifies `unknown` and §3C collapses to one row — so the script now prints a mapping
  coverage line to make that visible. And because the archive is append-forever, a later re-run reads a
  longer, later window and will not reproduce these figures; the tables are pinned to the Method window.
- **UTC day boundaries.** `date(ts,'unixepoch')` is an internal aggregation key, not a rendered timestamp,
  so the local-time display convention does not apply — but "day low" is a UTC day low, not the boundary
  Ben experiences.

## README inventory lines (paste into "Map of the repo" AND `pipeline/experiments/README.md`)

```
- **`floor-strategy-study.mjs` → `FLOOR-STRATEGY-FINDINGS.md`** — is "this item is at its 1/3/7/14/30-day
  low" a tradeable BUY signal? **Re-measurement of `plans/PLAN-DAY-LOW-SURFACING.md`, which closed the same
  question as a measured negative on 2026-08-10 — and it CONFIRMS the closure.** 73 days, 2,020 contributing
  items, 60,151 item-days, 35 origin days. The signal is real and, for the "printed a new N-day low" form,
  monotone in N against a per-origin-day cross-sectional base rate (+0.31pp at 1d → +1.26pp at 30d of 7-day
  mid drift), surviving an entry-lag control; the "resting in the bottom 15% of the range" form peaks at
  7–14d and is NOT monotone. The absolute after-tax round trip is ~0% (best +0.26%/7d) because the origin
  population's 1.94% spread sits under the 2% tax. **NO discriminator was found**: floor slope flips sign
  with the signal definition (rising wins 4 of 6 comparisons), and the drawdown-depth gradient is spread
  capture on the NET metric but survives on item-weighted direction — left explicitly unresolved. The liquid
  sample holds **0 items at 1m–10m**, so it cannot speak to the big-ticket class. Honest sample: **5
  non-overlapping 7-day windows**; `new30`'s sign flips when de-overlapped. **The doc carries a retraction
  banner** — an adversarial pass found 25 defects in the first draft, including two cherry-picked/
  weighting-dependent "findings"; §3 and §4 are the rewritten retractions. Read those before quoting any
  discriminator. `--section a|b|c|d`, `--json`.
```
