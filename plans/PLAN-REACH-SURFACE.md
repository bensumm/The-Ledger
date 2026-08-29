# PLAN-REACH-SURFACE — one exit function: the reach surface `p(ask, H)`

**Status: CHUNKS 0-1 SHIPPED; 2-9 PROPOSED.** Drafted 2026-08-28, successor to
`PLAN-REACHABILITY-CONSOLIDATION` (whose scorer shipped and whose premise did not survive).
All measurements here were run against the live repo on that date. Spike measurements
(marked SPIKE) used ad-hoc scripts and MUST be reproduced by the chunk-1 fixtures before
being quoted anywhere else.

## 0. The reframe this plan is built on

`join-reach-outcomes.mjs` was built to rank the five co-logged exit estimators and could not,
for a reason its own footer states: its two columns derive from ONE per-row comparison
(`reached ⟺ gap ≥ 0`, at `pipeline/lib/render/reachability.mjs:52`) that is monotone in the ask
price, so the reach ordering it prints is a price-level ordering. (The two REPORTED columns are
different functionals of it and can rank differently — that does not rescue either ordering.) Verified
live (measured 2026-08-28, `--horizon 24`): on the matched pool the reach ordering is exactly
the inverse of the price ordering — pressure 37% (prices highest), reachFold 74%,
quickSell* 81% (prices lowest, "wins"). Read literally the metric says "always instasell."

The correct conclusion is not "build a better scorer." It is: **"which estimator is best" has
no answer, because there is no best ask independent of (a) how long you will wait and (b) what
a miss costs.** The five estimators are five points on a single surface — `p(ask, H)` = the
probability an ask is reached within horizon H — each with its price axis chosen by a
different unexamined convention. The thing to build is the surface itself, plus the two
inversions the owner asked for:

- **price for horizon**: given H, the EV-maximizing ask off the surface;
- **horizon for price**: given an ask, the smallest H at which its reach probability clears a
  stated target.

Everything needed already exists and needs **zero accrual**: the 1h archive is 92 days deep
over 4,495 items (measured 2026-08-28: 2,187 1h buckets 2026-05-29→2026-08-28, 91.1d span, 89
of 92 days at full 24-bucket coverage; per-item 1h rows p25=717 / p50=1,903 / p75=2,174; 3,369
items have ≥720 rows ≈ 30 full days; 5m grain 50.2d). The forward-scoring primitives exist
(`pipeline/lib/market/forward-reach.mjs`). The missing half — a cost model that makes
price-vs-probability comparable — exists in `join-reach-basis.mjs` (`mcnemarCost`, cost ratio
`r`, `rStar`, the four-regime map) and needs generalizing from a binary gate to a price choice.

## 1. Verified ground (read before disputing any design choice)

1. **The five-estimator registry** is `REACH_ESTIMATORS`, `reachability.mjs:23-31`: pressure
   (`reachableBand`, `js/windowread.mjs:1050`), reachFold / reachRelief (`estSell`, disjoint by
   whether relief fired, `reachability.mjs:17,25-26`), asym (`asymPair`, `windowread.mjs:823`),
   depth (`clearableAsk`, `windowread.mjs:983`), plus baselines quickSell*/optSell*. Co-log
   contract: `suggestlog.mjs:626-636` — `reachable` rides every row with an in-hand 1h series;
   `depthExit` only held rows (102 of 32,374 scored rows, 0.3%, measured 2026-08-28).
2. **Depth is already measured as not beating a one-line null** (README `join-depth-outcomes`:
   median residual +0.81% vs the window-median null's +0.83%, trend-dominated). **Asym's
   displayed probabilities are quantiles read back out** (displayed pAsk 86.8% measures 24.2%).
   Both are retirement candidates *before* this plan; the backtest gives the instrument.
3. **The cost model to port**: `join-reach-basis.mjs` `mcnemarCost`. What ports is the *idea* —
   a miss and a hit have different, operator-owned costs, and the answer is a function of `r`,
   not a winner — not the numbers, which score a binary tag rather than a price.
4. **Window choice interacts with trend** (measured 2026-08-28): Ancestral robe top's last 7
   complete daily highs are a falling staircase 100.00 → 92.73m; recent-3 median 94.50m sits
   ~5.5% below the 7-day top. Any fixed-lookback quantile of raw prices misprices a trender.
5. **The archive-only reach curve works and is cheap** (SPIKE, 2026-08-28: origins every 6h,
   level = recent-3 median daily high × (1+x), forward max via `maxHighWithin`):

   | item | P(reach ≤24h) at +0% / +1% / +3% over recent-3 median high |
   |---|---|
   | Soul rune (566) | 58% / 35% / 3% |
   | Ranarr weed (257) | 54% / 28% / 0% |
   | Ancestral robe top (21021) | 39% / 30% / 14% |

   The **shape difference IS the volatility taxonomy**, as numbers instead of labels: Ranarr's
   curve is a cliff (tight band — patience buys nothing past +1%), Ancestral's a fat shallow
   tail (trendy big ticket — nothing likely, nothing impossible), Soul between.
   ⚠ **These curves are DIFFERENTIALLY instrument-contaminated — see §1.5b: Ranarr's heavily,
   Ancestral's barely — so the contrast between them is partly an artifact of the measuring
   device. Chunk 1 must re-derive all three on the fixed instrument before the taxonomy claim is
   quoted, and the contrast shrinking is a live possibility, not a hypothetical.**
5b. **The 1h `avgHighPrice` outcome instrument understates reach, and the error GROWS with how
   far above the reference you price** (ADVERSARIAL REVIEW + independent re-measure, 2026-08-28;
   identical origins, 1h-average outcome vs 5m-average outcome, H=24, n=1184 each):

   | item | +0% | +1% | +3% |
   |---|---|---|---|
   | Soul rune (liquid) | +5.0pp | **+21.6pp** | +14.6pp |
   | Ranarr weed (mid) | +2.6pp | +13.3pp | **+18.5pp** |
   | Nature rune (liquid) | +3.0pp | +4.7pp | +6.2pp |

   `maxHighWithin` reads `avgHighPrice` — an AVERAGE of the hour's prints, structurally below the
   intra-hour max a resting limit ask actually fills against. The repo documents this bias twice
   already (`js/windowread.mjs`'s avg-bound header; the PB1 header on `clearableAsk`).

   **The bias is LIQUIDITY-GATED, and it disappears exactly where the patient ask matters most.**
   Extended across the liquidity range (2026-08-28, same method, `highPriceVolume` as the proxy):

   | item | prints/h | 5m buckets w/ a print | Δpp +0% | Δpp +1% | Δpp +3% |
   |---|---|---|---|---|---|
   | Soul rune | 714,649 | 100% | +5.0 | **+21.9** | +14.6 |
   | Nature rune | 622,733 | 99% | +3.0 | +4.7 | +6.1 |
   | Ranarr weed | 6,226 | 81% | +2.6 | +13.2 | **+18.8** |
   | Dragon boots | 148 | 95% | +7.0 | +6.7 | +2.9 |
   | Abyssal whip | 102 | 94% | +7.5 | +9.3 | +13.9 |
   | Bandos chestplate | 35 | 87% | +9.3 | +16.0 | +8.3 |
   | Twisted bow | 6 | 57% | −1.9 | +1.6 | +0.0 |
   | Scythe of vitur | 6 | 58% | −2.5 | +0.4 | +1.3 |
   | Ancestral robe top | 5 | 47% | +5.1 | −2.2 | +1.6 |
   | Elysian spirit shield | 3 | 55% | −0.4 | +1.8 | −0.6 |

   Above ~35 prints/h the bias is large and widens with ask distance; below it the bias is ~0 and
   sometimes NEGATIVE. The mechanism is the 5m-coverage column: on a thin item only about half the
   5m buckets carry a print, so a max over the sparse 5m series can MISS a print the 1h bucket
   caught. There is little to average away when an hour holds one or two prints, which is why the
   1h average is nearly unbiased there.
   ⚠ **THE THIN-ITEM HALF OF THAT TABLE IS CONFOUNDED — corrected on review, 2026-08-28.** The
   near-zero deltas below ~35 prints/h do NOT establish that thin items are unbiased. The 5m
   archive is **50.6 days deep against 1h's 91.5**, and within that era the thin items carry
   **2–3 of a possible 12 5m buckets per hour, with 0% of hours fully covered** (Twisted bow,
   Ancestral robe top, Elysian spirit shield: zero complete hours in 92 days). A max over a series
   that sparse cannot exceed the 1h max, so the measurement reads ~0 whether the bias is absent or
   merely unmeasurable. Those two cases are NOT distinguished by anything in the table.
   The a-priori mechanism still favours "genuinely small" — an hour holding one or two prints has
   little to average away, which is exactly what `js/windowread.mjs`'s avg-bound header already
   asserts — but that is a mechanism argument, not this measurement. Do not cite the table for it.

   **PRIOR ART — this question was already litigated in this repo, and the plan must not re-open it
   blind.** `pipeline/lib/market/fill-surface.mjs` carries `grainBiasPp(grain, tier, premium)`,
   measured on a PAIRED sample (n=330 over ~115 items, McNemar), and `build-fill-surface.mjs`
   settled the instrument choice explicitly: **build at 1h despite the measured bias**, because a
   5m build trades ~9pp of calibration bias for an unusable sample, and carry the bias as a
   REPORTED correction that is never applied. Note also that `grainBiasPp` finds the bias positive
   at LOW premiums and gone by +8%, while the spike above finds it GROWING out to +3%. Both are
   provisional and `grainBiasPp`'s own header says its SHAPE is not measured, only its direction —
   so the disagreement is recorded here, not resolved.

   **Consequences, all binding:**
   (a) **Chunk 1 builds the outcome at 1h — NOT a 1h/5m hybrid.** An earlier draft of this plan
       specified `max(1h, 5m)`; that is REVERSED. A max can only add information, so it is not
       *wrong*, but it makes the instrument NON-UNIFORM — denser on liquid items than thin ones,
       and present for only the recent 55% of the archive — and this surface's entire output is
       cross-item and cross-horizon comparison. A comparison instrument that varies in sensitivity
       with the thing being compared is the worse failure. This also restores consistency with the
       `build-fill-surface.mjs` precedent instead of contradicting it silently.
   (b) **The bias is REPORTED, not applied** — the same doctrine `grainBiasPp` already holds.
       Chunk 1 emits it as `grainBiasPp`-compatible output rather than minting a second name for
       one quantity, and emits **`fiveMinCoverage`** (fraction of the window's 5m buckets that
       carry a print) BESIDE it, so a reader can tell "measured, small" from "not measurable".
       Without that second field the first is unreadable on exactly the items that matter most.
   (c) §1.5's taxonomy exemplars are **differentially** contaminated — Ranarr's "cliff" is heavily
       instrument-shaped, Ancestral's "fat tail" of unknown contamination (unmeasurable, per the
       confound above) — so the cliff-vs-fat-tail contrast may be partly an artifact of the
       measuring device. Chunk 1 must re-derive all three and report `fiveMinCoverage` alongside
       before the taxonomy claim is quoted. If the contrast does not survive, §1.5's "shape
       difference IS the taxonomy" premise is weakened — a chunk-1 finding, not settled here.
   (d) chunk 4 must not read a `pressure` penalty as physical without checking the same axis:
       pressure exists to price into peaks a 1h average cannot see, and the correction is largest
       on liquid items rather than pressure's own big-ticket class.
   (e) §6.1's "upper bound" claim is retracted (see there), on the liquid half.
6. **Normalization does the work trend-conditioning was assumed to do — for the up-vs-down split
   specifically.** (Adversarially re-measured 2026-08-28 on an independent re-implementation: the
   inversion and its collapse under z both reproduce, and the "falling refs sit mechanically
   lower" confound is REFUTED by direction — falling items' refs sit FURTHER above the market, yet
   reach more; dispersion carries it. But a **flat-vs-trending residual of 4–7pp survives at fixed
   z**, the same magnitude that disqualified the raw grid. It is a dispersion-class effect, which
   is why chunk 7's dispersion-tercile cell key is load-bearing rather than a nicety.) (SPIKE, 2026-08-28, 120
   random items ≥60d coverage, H=24, origins every 12h): on a raw %-above-median grid the trend
   split is **inverted and confounded** (falling items reach +1% *more* often than rising — 35%
   vs 28% — because |slope| correlates with dispersion). Re-expressing the level in dispersion
   units (`z = (ask − recent-3 median high) / IQR(trailing-14d daily highs)`) collapses the
   split to a few pp (z=0.5: up 21% / flat 24% / dn 24%; z=1: 15/18/15). **Consequence: the
   level axis is z-normalized; trend becomes a guard flag, not a curve conditioner.** Must be
   re-verified by the chunk-4 fixture before chunk 7 keys on it.
7. **The plug-in seam already exists**: sell-top models are a file + one registry line
   (`js/estimators/sell-models/index.mjs:19-22`), the shell owns non-skippable floors (BE via
   `breakEven`, `js/quotecore.js:58`; ordering clamps), and `quote-items.mjs:101,584-585`
   already resolves the active model from `pipeline-config.json` with reach-fold as the
   always-on shadow.
8. **Circularity/selection constraints hold**: scoring an ask against the realized sell is
   circular; the archive is the only target the tool does not influence. Reach ≠ fill: queue
   position is invisible, so archive-derived P(reach) bounds P(fill) from ABOVE.

## 1b. WHAT CHUNK 1 MEASURED — read this before quoting §1.5 or designing chunk 2

Chunk 1 shipped and re-derived the curves on the uniform 1h instrument with z-normalized levels and
per-origin references. Five findings, all measured against the live archive.

**Nothing in this surface reads a trade.** Its only inputs are the 1h price archive and pure series
math (`windowStats`/`recentQuant`/`iqr` + the forward primitives) — no `fills.json`, no
`positions.json`, no `suggestions.jsonl`, no fitted constants. Which suggestions the operator acts on
therefore cannot bias it, and this is worth stating because it is NOT true of every surface here:
`join-depth-outcomes.mjs` scores against realized sells in `positions.json` and `analyze-record.mjs`
reads the logged record, so both inherit the operator's selection. This one does not.

1. **§1.5's taxonomy premise does NOT survive, and its ordering INVERTS.** §1.5 read Ranarr as a
   cliff, Ancestral as a fat shallow tail, Soul between. In z units the shape spread (z20 - z50) is
   **Soul 1.00 · Ranarr 0.80 · Ancestral 0.59** — the reverse order, all inside one narrow band, and
   at the 91st / 72nd / 53rd percentile of a 148-item sample. The contrast §1.5 saw was mostly
   `disp`, which z already carries as a single number. Pinned by test so a re-inversion is visible.

2. **PER-ITEM CURVES DO NOT PREDICT THEIR OWN FUTURE. The pooled curve does it better.** This
   supersedes an earlier, weaker and mis-framed version of this finding; the correction is recorded
   because the first framing would have led chunk 5 to ship the wrong estimator.

   *First, the variance read, which is TRUE but not decision-relevant.* Variance decomposition over
   364 items (H=24, median 78 independent windows): true between-item sd is 8.1pp at z=0 and 2.1-3.3pp
   at z >= 0.5, against a sampling sd of 2.3-5.7pp. An earlier draft read that as "shape is smallest
   exactly where the patient ask lives" — **that was an artifact of reading absolute percentage points
   on a mean that is itself shrinking.** As a FRACTION of the mean the variation is largest at high z:
   15% at z=0, 20% at z=0.25, 44% at z=2, 77% at z=4. Neither framing settles anything.

   *The decision-relevant test is out-of-sample skill, and it is blunt.* Train on the first 2/3 of each
   item's archive, score on the held-out last 1/3, pooled curve computed leave-one-out so an item never
   helps build its own baseline (156 items surviving train >= 120 / test >= 60 origins):

   | contender | held-out MAE on p, H=24 | cells won |
   |---|---|---|
   | **pooled curve** | **9.90pp** | **57.1%** |
   | item's own curve | 11.21pp | 42.9% |
   | shrunk (empirical Bayes) | 10.17pp | 46.4% |

   Pooled wins at 15 of the 16 z levels. This is not "items are alike" — it is overfitting: a 16-point
   curve estimated from ~78 independent windows fits its training era's noise.

   *Three rescue attempts, all failed, all on the same held-out split:*
   - **Partial pooling** with the exact empirical-Bayes weight `w = tau^2/(tau^2 + sigma_i^2)`, both
     terms measured on the TRAIN half only: 10.17pp, loses to pooled. The weights are substantial
     (w = 0.30-0.74), and that is the informative part — **the between-item variance measured above is
     largely NOT PERSISTENT across eras.** Item identity does not forecast item shape at 92 days.
   - **Detrended dispersion** (§1b.4's alternative basis): own-curve wins 45.0%. Still loses.
   - **A stabler reference.** refN 3 -> 7 -> 14 roughly DOUBLES measured between-item sd (z=0.5:
     3.2 -> 4.0 -> 6.4pp), which looked like reference noise blurring real shape. It is not: held-out
     own-curve win rate goes 42.9% -> 43.5% -> 41.5% and absolute pooled MAE at z=0 goes
     11.3 -> 15.1 -> 22.1pp. A longer reference spreads items apart WITHOUT making them predictable —
     it goes stale. **recent-3 is confirmed as the right anchor**, independently of RB-3's own evidence.

   **CONSEQUENCE — the estimator is POOLED p(z,H) + PER-ITEM refHigh/disp.** The surface's value is in
   the NORMALIZATION, not the curve. That is Option C, reached by measurement rather than preference.
   Chunk 7 is promoted from last-resort fallback to the PRIMARY path (and simplifies: no cell keys
   until a cell key is measured to help). Chunks 2 and 3 are structurally unaffected — askStar, the EV
   inversion and the inspector all work identically off a pooled curve. Chunk 5's per-item surface
   field becomes pooled + normalization. Chunk 4 is unchanged and matters more.

   **NEW CHUNK-2 ACCEPTANCE GATE, and it is a stop-or-go. IT RAN — the result is §1c, and it is GO.** Pooled leaves ~10pp of MAE on p. Whether
   that is tolerable for a PRICE depends entirely on how flat EV is near its optimum, which is a cheap
   chunk-2 computation: perturb the curve by +/-10pp and measure how far `askStar` moves. If the
   optimum is flat, 10pp is fine and the price is trustworthy. **If it is sharp, the surface cannot
   price at this archive depth and chunk 3 must not be built** — say so instead.

   *Limits: one 92-day era, one update cycle, H=24 only; 156 items after the train/test filter, drawn
   from the well-covered end (>=1900 1h rows). The held-out target is itself noisy, which inflates
   every absolute MAE above — but both contenders face the same target, so the RANKING is fair.
   `nIndep` may overstate independence, which would inflate the tau^2 estimate and therefore FLATTER
   the shrinkage contender, which still lost.*

3. **The obvious test for finding 2 has no power, and the design must not use it.** A split-half
   comparison (item vs its own other half, 144 items) gives RMSE 10.2pp against 4.8pp vs pooled — a
   2.1x ratio. Halving the origins doubles the noise, so a pure-noise null predicts **exactly 2x**.
   The test cannot distinguish "no shape" from "some shape" and was replaced by the decomposition
   above. Do not reinstate it.

4. **The `level` dispersion basis conflates trend with volatility, and the alternative measures
   better — but this is a DECISION, not a finding to apply.** IQR of the trailing-14d daily highs is
   mostly the trend on a trending item, which inflates z and cliffs the curve: pooled p falls
   **54% -> 33% between z=0 and z=0.1** and then spans only 33%->3% across the whole rest of the
   grid. On `dispMode:'detrended'` (IQR of day-over-day changes) the same pooled curve decays
   smoothly, 51% -> 37% -> 8% out to z=4, AND carries more true between-item sd in the patient
   region (4.4-5.2pp at z>=1 vs 2.3-3.2pp). It also REFUSES 22% more items (a zero detrended IQR is
   a flat day-over-day item). The seam is built and both bases run on the shipped code path;
   `'level'` remains the default because **which basis produces better PRICES is a chunk-4 question,
   not something a curve-shape read settles.** Do not swap it silently — it moves every price.

5. **The plan's isotonic cleanup was half dead code, and one half is load-bearing.** z-monotonicity
   holds BY CONSTRUCTION: every z cell in a row is scored over the same resolved origins against
   `top >= refHigh_o + z*disp_o` with disp_o > 0, so raising z can only turn a hit into a miss.
   Measured **0 violations in 22,500 adjacent pairs over 250 items** — the z-PAVA was deleted rather
   than shipped inert. The H axis genuinely inverts, because its origin set shrinks with H:
   **155 raw violations over 250 items, median 0.4pp, max 12.1pp**. The running max stays, and a
   real violator is now a fixture.

Two smaller corrections chunk 2 inherits:
   - **`bailZOnMiss`, not `bailNetOnMiss`.** Chunk 1 emits the miss payoff in z, not gp and not net.
     In gp it is not poolable — over this archive's span a big ticket moves 20%, and Ancestral's
     pooled gp bail landed 19% ABOVE its own current `refHigh`. Chunk 2 reconstructs the price as
     `refHigh + bailZ*disp` and applies `net()` at its single call site.
   - **Horizon-level refusal reads the DECISION cell, not "every cell".** "Every cell thin" cannot
     fire: a p=0 cell has a narrow Wilson width at any n, so a curve with a dead tail always keeps
     one non-thin cell, and H=96 at 19 independent windows read thin=false with its whole mid-range
     individually thin. The horizon's verdict is the cell nearest p=0.5 — the widest interval on the
     curve, and where an EV maximum sits.

## 1c. THE CHUNK-2 STOP-OR-GO GATE — measured, and the answer is GO

**SPIKE.** The harness is not in the tree and these numbers are not fixture-reproduced. Chunk 4's
`join-exit-ev.mjs` supersedes the whole section with realized gp; until it runs, quote §1c only from
here. Per §0's rule, nothing in it belongs in README or a module header as a number.

§1b left the estimator as pooled `p(z,H)` + per-item `refHigh`/`disp`, carrying ~9.9pp of held-out
MAE on p, and pre-registered a gate before chunk 3: perturb the curve by the error we measured and
see whether `askStar` survives it. That gate ran. It passes, and it also killed one default.

**The perturbation is PER-CELL**, because that is the shape of the measured error. sd = MAE / √(2/π)
= 12.4pp for a mean-zero normal. `iid-mono` (noise, then z-monotonicity repaired) is the INDEPENDENT
extreme, not the realistic case — a curve is wrong systematically as well as per-cell, and the
correlated rows below are WORSE at the tail than the row supplying the headline. Raw `iid` is the
pessimistic per-cell bound. 135 items, 120 draws each, H=24, `delayCost` 0 (the comparison table
below uses 183 — same criterion, different sample cap: 150 vs 200 candidate items). A uniform ±10pp shift is shown as a contrast —
note it does NOT leave the argmax alone, since ∂EV/∂p = net(ask) − net(bail) varies with z.

| perturbation | argmax moved | \|Δask\| med | p90 | p99 | EV regret, % of the achievable gain: med | p90 | p99 |
|---|---|---|---|---|---|---|---|
| iid (pessimistic) | 88.1% | 1.93% | 18.7% | 71.4% | 14.3% | 65.7% | 100% |
| **iid-mono (independent extreme — the headline)** | **81.0%** | **0.71%** | **6.86%** | **25.7%** | **8.2%** | **31.9%** | **76.9%** |
| uniform ±10pp shift | 50.0% | 0.08% | 18.7% | 66.0% | 0.0% | 47.4% | 92.7% |
| ±10pp tilt across z | 71.5% | 1.97% | 22.3% | 81.1% | 5.4% | 89.2% | 100% |

Read on its own this is ambiguous — the ask wanders (p90 of 6.9% of price) while the EV cost of the
wandering is small (median 8.2% of the gain). **"Flat" is only meaningful against an alternative**, so
the gate was decided on the comparison instead: what share of the achievable EV gain does each way of
picking a price capture? Normalized per item as
`(EV(contender) − EV(worst grid z)) / (EV(oracle) − EV(worst grid z))`, truth = the item's own curve,
pooled computed LEAVE-ONE-OUT, 183 items:

| contender | H=6 | H=24 | H=48 | H=96 |
|---|---|---|---|---|
| oracle (its own curve, in-sample — a ceiling, not a contender) | 100% | 100% | 100% | 100% |
| **pooled curve, leave-one-out** | **92.7%** | **91.2%** | **90.4%** | **88.5%** |
| **the best CONSTANT z, which is z=0 at every horizon** — ask the recent-3 median daily high | 87.3% | 87.2% | 84.8% | 81.7% |
| its own curve + the measured error | 86.0% | 86.6% | 85.6% | 85.3% |
| fixed z = +0.5 | 77.2% | 78.5% | 79.9% | 78.6% |
| fixed z = +1 | 70.9% | 71.2% | 73.3% | 74.4% |
| the p ≥ 0.70 level | 17.7% | 54.3% | 71.0% | 78.4% |

**GO.** The pooled curve captures 88–93% of the oracle's gain while using no item-specific shape at
all, and it beats the strongest simple null by **4.0–6.8pp**, with an item-bootstrap 95% CI clear of
zero and the same sign at all four horizons (H=6 +5.42 [2.79, 8.11] · H=24 +4.03 [1.65, 6.43] ·
H=48 +5.63 [3.36, 8.27] · H=96 +6.77 [4.59, 9.32]; win/tie/lose over items 101/32/50 · 83/42/58 ·
96/39/48 · 96/38/49 — it loses on about a third of items and wins bigger than it loses).
**"Strongest" was checked, not assumed**, after review challenged it: the null was re-maximized over
all 16 grid levels, in-sample AND leave-one-out, and z=0 is the argmax at every horizon — the margin
is identical to two decimals either way. The review's fixture-scale counter-example (the best
constant drifting up with H) does not survive 183 items. The margin is modest and the null is strong: most
of the value is in the z normalization, exactly as §1b concluded, and the curve adds a few points on
top — largely at the bad tail, where pooled holds a p10 of 78.8% against the null's 69.7% at H=24.

**And it killed a default. `pTarget` must never pick a price.** The p ≥ 0.70 level is the worst
contender at short horizons — 17.7% of the gain at H=6, against 87.3% for asking the median of the
last three daily highs — because a fixed probability target ignores what the ask is worth. *That
figure is partly a grid artifact: at short H the p≥0.70 level lands on the grid BOTTOM for most
items, which is also the denominator's worst cell, so widening the grid downward would make it look
worse still. The MECHANISM carries the rule, not the number.* It is a
sound answer to "how long will this take at price P" and an unsound one to "what should I ask".
Chunk 3 must present `horizonForAsk` as a horizon read and `askStar` as the price, never blend them.

**Limits, and they matter.** The leave-one-out is over ITEMS, not over TIME: the pooled curve is
built from the other 182 items over the SAME 92-day window the truth curve is measured on, so it
carries era-wide co-movement the fixed-z null structurally cannot. §1b's 9.90pp figure came from a
TEMPORAL split; this one does not, and "leave-one-out" here must not be read as out-of-sample. For
the same reason the four horizons are not four independent confirmations — same origins, nested
windows — and the item-level bootstrap treats items as independent, which era co-movement violates,
so the CIs are probably narrower than stated.
Truth is the item's OWN in-sample curve, so this measures the objective's
SENSITIVITY, not realized profit — every contender faces the same truth, which makes the RANKING fair
and the absolute levels optimistic. The denominator (`oracle − worst grid price`) includes deliberately
terrible prices, so "captures 87%" is not "earns 87% of available profit". 183 items at the
well-covered end (≥1900 1h rows), one 92-day era, one update cycle. **Chunk 4 remains the decisive
test** — this gate says the surface can carry a price, not that the price beats the incumbents on
realized gp.

## 2. The objective function (what makes ranking possible at all)

```
EV(ask, H) = p(ask,H) · net(ask)  +  (1 − p(ask,H)) · (net(bail) − delayCost(H))
```

- `net(x)` = `x − tax(x)` via `js/quotecore.js` — the ONE tax definition. The holder's basis
  cancels in every *comparison* of asks, so the surface price is basis-free; basis enters only
  at the shell's BE floor.
- `bail` = the miss policy: liquidate at the end-of-window instasell. In the backtest this is
  **measurable** (the 1h `avgLowPrice` at H — an approximation, labelled as such).
- `delayCost(H)` = capital/attention cost of waiting — **operator preference, PLACEHOLDER,
  default 0**, surfaced exactly as `--cost-ratio r` is in `join-reach-basis.mjs`.

EV is **not monotone in the ask** — a higher ask raises the win payoff and lowers p — so it has
an interior maximum and CAN rank, which is precisely what the failed metric lacked.
`askStar(H) = argmax EV` is "price for horizon"; "horizon for price" is the smallest grid H
with `p(ask,H) ≥ pTarget` (pTarget operator-owned, PLACEHOLDER default 0.7, always printed
with the full p-by-H row so the threshold hides nothing).

## 3. Options considered

### Option A — Nonparametric empirical reach surface (per item, from the archive) — RECOMMENDED
Brute replay: origins every `strideH` hours across the item's series; level grid in z-units;
outcome via `maxHighWithin`; unresolved windows dropped via `covers`. Isotonic cleanup for
monotonicity (violations are sampling noise by construction).
- **Buys**: zero model assumptions; zero accrual; per-item shape captured automatically;
  computable today for 3,369 items; the five incumbents become inspectable points on it.
- **Costs**: long-H cells thin per item (91d ⇒ ~23 *independent* 96h windows; 6h-stride origins
  overlap heavily — effective n must be reported as independent-window count, never origin
  count); a 92-day curve is a long-run average that can misprice a just-crashed item.
- **Falsified by**: held-out calibration — split origins by time; if first-half p̂ mispredicts
  second-half realized reach beyond binomial noise across the z×H grid on a ≥100-item sample,
  per-item curves are too unstable to price from and pooled becomes primary.
- **Failure mode**: regime shift. Mitigated by z-normalization + chunk-6 guards, not by
  pretending the curve adapts.

### Option B — Parametric distributional model
Fit a location-scale extreme-value family to the forward H-max; read p off the CDF.
- **Buys**: smooth interpolation, graceful small samples, three numbers per item.
- **Costs**: misspecification exactly in the tails, where a patient ask lives. The update-cycle
  dynamic makes the forward-max distribution multi-modal and era-dependent; a fit averages over
  that and is confidently wrong at z ≥ 1. Also violates "prefer measured over modelled" for no
  data-poverty reason — we are not data-poor.
- **Verdict**: rejected as the engine; retained as an explicitly-labelled *compression* of A if
  chunk 7 finds pooled grids too coarse.

### Option C — Volatility-taxonomy-first
Classify (via `floorCeilingTrack`, `windowread.mjs:466-506`) then price from per-class templates.
- **Buys**: the owner's "flavor of volatile" vocabulary; warning signs as first-class outputs.
- **Costs**: §1.6 says the pricing benefit is mostly absorbed by z-normalization. Hard class
  boundaries add cliff behavior (an item hopping `ranging`↔`cooling` flips its price) while
  duplicating what the per-item curve encodes continuously. `floorCeilingTrack` is a *direction*
  taxonomy; curve shape (cliff vs fat-tail) is a *dispersion-shape* taxonomy it cannot express.
- **Falsified by**: if per-cell curves split by fcTrack class diverge strongly *after*
  z-normalization on the chunk-4 fixtures, taxonomy graduates from guard to conditioner.
- **Verdict**: not the engine — but **its content ships anyway** as (a) the guard/refusal layer
  (chunk 6 — the "warning signs" ask), (b) the pooled-fallback cell key (chunk 7), and (c) a
  three-number flavor line derived *from the curve* (p(0,24) · dp/dz · dp/dH) — a measured
  taxonomy rather than a labelled one.

### Option D — Discrete-time hazard by clock hour
Per item and local clock hour, `h_c(z)` = P(reached during hour c | not yet), so
`p(ask,H,now) = 1 − Π(1 − h_c(z))`. Merges `hourProfile`'s diurnal read into the surface;
horizon-for-price becomes clock-aware ("an ask posted at 21:00 has the 00-03 window inside
H=6; the same ask at 09:00 does not").
- **Costs**: 24× thinner cells; more machinery day one; improvement unmeasured.
- **Falsified by** a cheap check: pooled p(z=0,H=6) at peak-window vs off-window starts on
  liquid items; under ~5pp spread and the refinement buys nothing.
- **Verdict**: not day one, but the natural v2 of A — and A's data layout (per-origin outcomes
  keyed by ts) is chosen so D is a re-aggregation, not a rebuild. Chunk 9, behind its falsifier.

### Option E — Relist-ladder policy
The operator's real behavior is a ladder — list high, step down on miss. The true object is a
policy `π: state → (ask, wait)` optimized by DP over the surface; a single (ask,H) understates
achievable EV. **Deliberately out of scope**: needs the surface as input anyway, the state space
multiplies the thin-cell problem, and shipping a price first is the constraint. Recorded so
nobody mistakes single-shot EV for the ceiling; chunk 4 scores a one-step ladder as a
sensitivity row to size what is being left on the table.

## 4. Recommendation

**Option A as the engine; the §2 EV objective as the port of the join-reach-basis cost model;
C's content as guards + pooling + the measured flavor line; D staged behind its falsifier; B
and E parked with re-entry conditions.**

A wins because it alone (i) ships a price with zero accrual, (ii) makes the five incumbents
commensurable (each becomes a point (ask → p) on a measured curve), (iii) captures per-item
volatility flavor as shape rather than label, and (iv) leaves an audit trail a skeptic can
re-run — no fitted constants inside the probability itself. Its weaknesses are handled by
honest labelling and guards, not a cleverer model, which is this repo's doctrine.

**One adjustment to the owner's framing.** There is no "ONE parameterized function that yields
the single informed price" — there is one measured **surface** plus **two operator-owned
parameters** (`delayCost`/`r`, `pTarget`) that turn it into a price. Collapsing those into the
function would be exactly the silent-threshold move `join-reach-basis` refused. The deliverable
is `surface + askStar(H; params) + horizonFor(ask; params)`, parameters printed beside every
number.

## 5. Chunks

Each lands independently, CI-green, with its acceptance check and falsifier named. Something
usable ships at chunk 3.

### Chunk 0 — Home the forward primitives where both sides can reach them  ✅ SHIPPED
Move `pipeline/lib/market/forward-reach.mjs` → `js/forward-reach.mjs` (pure, imports nothing);
old path becomes a re-export shim, the established `pipeline/lib/estimators.mjs` pattern. README
inventory entries for both.
**Acceptance**: joiner tests green; `check-imports` green; `join-reach-outcomes.mjs --horizon 24`
byte-identical across the move against a frozen archive fixture.
**Proves it wrong**: any behavior diff — byte-neutral or it doesn't land.

### Chunk 1 — `js/reach-surface.mjs`: the surface builder  ✅ SHIPPED (see §1b for what it measured)
`buildReachSurface(series, { nights=14, refN=3, horizonsH=[2,6,12,24,48,96], zGrid, strideH=6,
minIndependent=8, now })` → `{ refHigh, disp, grid, nOrigins, independentWindows, coveredDays,
thin }`. `refHigh` reuses `recentQuant(days,'ask',0.5,3)` (do not re-derive); `disp` = IQR of
trailing-14d daily highs (export windowread's `iqr` rather than duplicating); outcomes via
`maxHighWithin`/`covers` at **1h — a UNIFORM instrument, not a 1h/5m hybrid** (§1.5b(a), reversing
an earlier draft and matching the `build-fill-surface.mjs` precedent). The 1h↔5m delta is emitted as
a REPORTED diagnostic, never applied, reconciled with the existing `grainBiasPp` rather than named
afresh — and always **beside `fiveMinCoverage`**, since on a thin item a ~0 delta means "not
measurable", not "not biased" (§1.5b);
isotonic cleanup both axes; per-H refusal (`thin:true` + reason) when the **binomial CI half-width
at the surface's own p exceeds `maxCiHalfWidth` (default 15pp)** — a width bound, not a count,
because a count floor of 8 admits an interval tens of pp wide as a price input (review F6) — the
floor must bound the WIDTH, not the count. Short horizons
price while H=96 refuses. Chunk 1 ALSO emits **`bailNetOnMiss[z][H]`** — E[bail | the ask missed]
— from the same replay: conditional on missing, the market at H is systematically lower (measured
−0.53% at z=0.5 across 120 items), and §2's unconditional bail flatters high asks by an error that
grows with the ask (review F3). Also `surfaceProb(surface, ask, H)` and `surfaceShape(surface)`. Every constant PLACEHOLDER n≈0
except those measured here.
**Acceptance**: fixture-pinned against a frozen archive slice of Soul rune / Ranarr / Ancestral —
reproducing the **re-derived** §1.5 curves, NOT the contaminated ones printed there today (§1.5b);
**a thin-item fixture asserting `fiveMinCoverage` is reported and that a ~0 bias on a low-coverage
item is labelled unmeasurable rather than printed as zero** — the confound §1.5b names is only
caught by making it visible; property tests (monotone in z and H; refusal fires; unresolved
windows dropped not counted — **mutation-verify this one**, the vacuous-test failure has
happened twice in this repo's joiners).
**Proves it wrong**: held-out calibration failing beyond binomial noise on a ≥100-item sample —
demotes per-item curves to fallback-only and reopens Option C's conditioner question.
**As built**, differing from the spec above wherever measurement required it: the z-PAVA is DELETED
(§1b.5), `bailZOnMiss` replaces `bailNetOnMiss` (§1b), refusal reads the DECISION cell (§1b), the z
grid was densified to 16 points because the pooled curve cliffs between z=0 and z=0.25 (§1b.4), a
`dispMode` seam was added for §1b.4's comparison, and `referenceAsOf` is exported so the
no-look-ahead invariant is an EQUALITY rather than an inference. Every export carries
`@provisional-api` citing chunk 3 — **the plan's "each chunk lands independently, CI-green" claim is
FALSE for chunk 1 as written**: `check-dead-exports` refuses a library with no production consumer,
and the first consumer is chunk 3. 10 of 10 mutants killed; the two that the FIRST test draft let
live, and why, are named in the suite header.

### Chunk 2 — Inversions + EV  ✅ SHIPPED (the stop-or-go gate is §1c: GO)
`askStar(surface, H, { bailNet, delayCost=0 })` maximizes §2's EV over the z-grid using
`breakEven`/`tax`, taking the miss-branch payoff from chunk 1's **`bailNetOnMiss[z][H]`** rather
than an unconditional bail (review F3 — the unconditional form flatters high asks); `horizonForAsk(surface, ask, { pTarget })` returns the smallest grid H with
p ≥ pTarget *plus the full p-by-H row* (the threshold never travels alone).
**Acceptance**: fixture with an interior EV maximum (asserting non-monotonicity — the exact
property the old metric lacked); limiting cases pinned (`delayCost → ∞` ⇒ lowest z; p ≡ 1 ⇒
highest z); round-trip `horizonForAsk(askForHorizon(H,pTarget),pTarget) ≤ H`. **A grid-edge
assertion**: `askStar` landing on the top z is a REFUSAL (widen or say so), never a price —
measured 7 of 120 items hit the grid top, which is a too-short grid, not an optimum (review F2).
**Proves it wrong**: nothing empirical — this chunk is arithmetic; its correctness is the tests.
**As shipped**: `js/exit-ev.mjs` (`evCurve`/`askStar`/`askForHorizon`/`horizonForAsk`), 18
assertion groups, 11 mutants killed. `@provisional-api` on every export until chunk 3, so this lands
CI-green without the dead-export waiver chunk 1 needed.
**What self-review found** (three, and two are LATENT guards rather than live defects — a
non-positive ask needs `disp/refHigh > 1`, and a dropped TOP cell needs almost every origin to miss):
the ask guard, the grid edges reading the DECLARED zGrid rather than the SCORED cells, and
`horizonForAsk` trusting grid order for "smallest". Only the third was reachable on a real surface.
**What ADVERSARIAL review found, and it was the useful pass:** (1) the stated REASON for the
per-cell bail was BACKWARDS in four documents and the test pinned the wrong direction on an inverted
synthetic — E[bail|miss] RISES with the ask, so per-cell prices at or ABOVE the unconditional form
(measured above on 114 of 183 items at H=24, below on 8, and 9 of 9 fixture item×H cells); (2) four
mutants survived, two on properties README stated as contracts — `net()`'s tax was unpinned on both
legs, and a tax asymmetry is 2% of price against an EV spread of 0.4–3.7% of refHigh, so it would
swamp the signal it sits inside; (3) `horizonForAsk` carried a second copy of `surfaceProb`'s
interpolation that had already dropped `ciHalf` on 1,818 of 1,818 compared rows — DELETED, it now
calls `surfaceProb`; (4) `askForHorizon`'s own annotation handed chunk 3 the price §1c forbids.
One finding was REFUTED by re-measuring at scale: see §1c's strongest-null note. **CONSEQUENCE FOR CHUNK 3 (from §1c): `pTarget` must never pick a
price.** Present `horizonForAsk` as the horizon read and `askStar` as the price; do not offer the
p≥pTarget level as an ask.

### Chunk 3 — The inspector ships a price: `pipeline/commands/read-exit-surface.mjs`
`node pipeline/commands/read-exit-surface.mjs "<item>" [--horizon H] [--price P] [--qty N]
[--delay-cost gp] [--p-target f] [--json]`. Prints the p(z,H) table with levels in gp; `askStar`
at strategy-relevant horizons; `horizonForAsk` when `--price` given; **each incumbent's current
ask placed on the surface as a labelled point** (pressure/fold/asym/quick/opt, computed fresh
from the same series — the zoo becomes five rows of `(ask, p@H)` under one ruler); the flavor
line; the guards. Inform-only, gates nothing, honesty footer.
**Docs (house rule 8, same commit)**: README inventory; CLAUDE.md ask-row ("what should I ask
for X if I'll wait H?", "how long to clear X at price P?"); `docs/MARKET-ANALYSIS.md` pass.
**Acceptance**: matches chunk 1 on the fixture items; a <14-day-coverage item refuses with a
reason, not a number; `--json` returns before any table.
**Proves it wrong**: an operator-visible contradiction — e.g. `askStar(24h)` below quickSell on
a liquid item (a sign inversion). Add as an assertion, not a hope.

### Chunk 4 — The decisive backtest: `pipeline/commands/join-exit-ev.mjs`
The head-to-head the failed scorer could not be. **Recompute-per-origin** (the
`join-depth-outcomes` precedent): at each origin, truncate the series to `ts` (no look-ahead),
recompute each contender's ask from the truncated series, then score **realized net gp/unit** of
the policy "list at ask for H; if reached credit net(ask); else bail at H's 1h avgLow". **Before
any head-to-head number is quoted, an acceptance check must print the divergence between each
RECOMPUTED contender ask and the co-logged ask that estimator actually emitted, over the
overlapping (itemId, ts) rows** (~32k available). Chunk 4 scores reconstructions, not the deployed
estimators; "fully matched by construction" is bought with that swap, and nothing else in this
plan bounds it (review F4). `clearableAsk(series, opts)` also needs its qty/competition convention
stated per origin, or depth is not really in the matched pool. Every
quantity from the archive. This fixes both defects of the co-log scorer at once: the pool is
**fully matched by construction** (every contender priced at every origin) and the metric is
**not monotone in price**. Pre-registered in the file header before the first full run: decisive
H=24, sensitivity {6,48,96}; cells = liqClass × fcTrack-direction; item-cluster bootstrap;
independent-window thinning as a sensitivity row; a one-step-ladder variant (relist once at
−0.5z on miss) sizing Option E's headroom.
**Pre-registered retirement criterion**: an estimator retires *from the exit-pricing surfaces*
(not deleted — bid-side consumers survive: `watch-positions.mjs:748` uses the pressure **bid**,
`reverseListBand` the band) when its realized-EV deficit vs the best contender has an
item-clustered CI clear of zero at the decisive spec AND the same sign in ≥2 of 3 sensitivity
horizons, per cell.
**Pre-registered null branch**: if `askStar` does not beat the best incumbent under that
criterion, the surface still ships as the *description* layer (chunks 1-3 stand), the chunk-5
default swap is CANCELLED, and this plan's §0 claim is downgraded in the docs. Written here so
it cannot be reframed later.
**Acceptance**: mutation-verified no-look-ahead test (delete the truncation, watch it fail);
fixture-pinned pure core; the report prints the funnel, the effective-n honesty block, and the
`delayCost` crossover at which the ranking flips (the `rStar` idiom).
**Proves it wrong**: the null branch, or instability — a ranking flipping sign between era
halves invalidates the pooled headline and blocks retirement.

### Chunk 5 — Surface integration: the `curve` sell model + co-log
`js/estimators/sell-models/curve.mjs` + one registry line in `SELL_TOP_MODELS` (the seam PC3
built for exactly this). `propose(ctx)` reads `extra.reachSurface`; absent surface ⇒ degrade to
reach-fold. The shell's non-skippable floors apply unchanged — the curve can never propose past
break-even. Lean `exitSurface` shadow field via a reshaper in `suggestlog.mjs`.
**Visible comparison, not silent swap** (`gate-on-error-cost-not-n`): the console prints the
curve ask beside the incumbent until chunk 4's verdict; the default `sellModel` flip happens
only on that verdict, and reach-fold stays the always-on shadow either way.
**Acceptance**: model-contract tests; one real `quote-items.mjs` run on a held item showing both
numbers; co-log row round-trips through `readSuggestionLines`.
**Proves it wrong**: the run-the-path rule — if the changed line has not executed on a real
held-lot read, the chunk is not done.

### Chunk 6 — Guards and the flavor line (the taxonomy layer, scoped to warnings)
`surfaceGuards(surface, fc, recency)`: **(a)** `floorBreak`/`crash-risk` ⇒ refuse `askStar`
beyond the grid's short end and print why (the falling-knife ask is the known failure of every
trailing-window method); **(b)** curve-era divergence — rebuild on recent-30d origins only and
flag `curve stale` where p at the operative z diverges beyond the noise band (the `recencySplit`
idiom lifted to the curve); **(c)** thin/pooled provenance always printed. Each guard's
**reachability measured, not assumed**: report "fires on N of M real items" from a whole-archive
sweep in the commit message.
**Proves it wrong**: a guard measuring ~0 reachability on 4,495 real items gets DELETED, not
shipped (the measured-zero fail-open lesson).

### Chunk 7 — Pooled fallback surfaces for thin items
Bulk job building per-cell pooled surfaces (cell key: liqClass × dispersion-shape tercile —
*not* fcTrack direction, per §1.6's collapse; re-verify on chunk-4 fixtures first), cached under
`pipeline/.cache/`. Thin items price from pooled with `provenance:'pooled(cell)'` printed in
every consuming line. Report the coverage split across all 4,495 items.
**Proves it wrong**: pooled-vs-per-item held-out calibration — if pooled mispredicts worse than
refusing would cost, refusal beats fallback and the pooled path narrows.

### Chunk 8 — Retirement + reconciliation (gated on chunk 4's verdict)
Apply the pre-registered criterion (depth and asym enter as favorites given §1.2, but the
criterion decides, not the prior); `REACH_ESTIMATORS` keeps retired keys as historical readers
so past log rows still parse. Then the full doc-reconciliation pass: grep for superseded claims
across CLAUDE.md / README / `docs/MARKET-ANALYSIS.md` / module headers, fix in place; add retired
terms to `lint-docs.mjs`'s denylist so they cannot re-enter prose; `lint-plan-refs.mjs --refs`
before this plan is folded and deleted.
**Proves it wrong**: review finding a live consumer of a retired field.

### Optional chunk 9 — Clock-hour conditioning (Option D), behind its falsifier
Run D's cheap check first; ship the hazard re-aggregation only if the spread clears ~5pp
(PLACEHOLDER, stated in the check's output); otherwise record the negative result in the README
entry and stop.

## 6. Honest limits — what this will NOT know

1. **Reach ≠ fill, and the error runs BOTH WAYS — `p` is not a bound in either direction.**
   Queue position, partials and competition are invisible to the archive, which pushes `p` ABOVE
   the true fill rate. But the bucket-average instrument (§1.5b) pushes it BELOW — by up to ~20pp
   on a patient ask **on a liquid item**, and by ~0 on a thin one. **An earlier draft of this plan
   claimed `p` is permanently an upper bound on P(fill); that is RETRACTED — it is not a theorem.
   On liquid items the two errors are of comparable size with no established dominance; on thin
   items the instrument error is small and the upper-bound reading roughly holds.** So the
   direction of the net error is ITEM-DEPENDENT and must be read off `instrumentBiasPp`, never
   assumed. Both halves are *labelled, not modelled*. Estimating the queue haircut from our own placed offers inherits both traps: estimating it from our own placed offers inherits both traps
   (fills execute at the tool's own suggestion; offers exist only where the operator acted). A
   future accrual join over `offers.json` could bound it — F1-class, not a dependency here.
2. **One era.** 92 days, roughly one-and-a-bit update cycles. The update-cycle dynamic makes the
   forward-max distribution era-dependent for gear; the era-half stratification (chunk 4) and
   the staleness guard (chunk 6) DETECT this, they do not fix it.
3. **Effective n at long horizons is small per item** (~23 independent 96h windows) and origin
   overlap makes nominal counts a lie; every surface reports independent-window n and refuses
   below the floor. Treat any per-item H=96 number as a shape.
4. **The bail policy is a model.** "Instasell at H" via the 1h avgLow is an approximation (an
   average, not a tick; no size). It is the *same* approximation for every contender, so
   comparisons hold better than levels.
5. **PLACEHOLDER numbers**: `delayCost` (default 0), `pTarget` (default 0.7), the z-grid and
   stride, `minIndependent=8`, the chunk-9 5pp threshold, the retirement CI convention. Each is
   labelled at its definition site; none is quoted as calibrated anywhere.
6. **Out of scope**: bid-side pricing (ASK leg only), the relist ladder (Option E), and any
   change to the app's deployed Finder (console surfaces only).

## 7. Provenance — where every quantity comes from

| Quantity | Source | Notes |
|---|---|---|
| p(z,H) surfaces, dispersion, refs, flavor stats, guards | **archive** (1h) | never from logged trades; the only target the tool doesn't influence |
| Backtest EV, bail values, era/cell strata | **archive** | recompute-per-origin, no look-ahead, mutation-verified |
| Tax / break-even | `js/quotecore.js` | the ONE definition |
| Held-lot basis (BE floor only) | `positions.json` | logged trades as an *input cost*, never a scoring *target* — not circular |
| `delayCost` (r), `pTarget`, horizon per posture | **operator preference** | printed beside every number; crossovers reported |
| P(fill given reached) haircut | **unknown** | labelled, UNSIGNED (§6.1) — the queue haircut and the instrument bias push opposite ways; possible future `offers.json` join, not a dependency |
| Outcome instrument (`maxHighWithin`) | **archive, 1h ⋃ 5m** | bucket AVERAGES, so a floor on truth; per-item 1h↔5m delta printed as `instrumentBiasPp` (§1.5b) |
| Anything scored against realized sells | **forbidden as a target** | circularity — `reachability.mjs:6-9` |
