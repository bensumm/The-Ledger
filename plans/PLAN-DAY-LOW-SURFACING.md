# PLAN-DAY-LOW-SURFACING — surfacing items resting on their 1/3/7/28-day lows

Status: **CLOSED — MEASURED NEGATIVE (2026-08-10)**. Requested by Ben, sequenced after DT4c.
**Nothing was built, and nothing should be.** Chunk 0 was BLOCKING and 0a/0b/0c/0d have all RUN:
- **0a/0b** — the plan's own central hypothesis (that "at every low at once" is a falling knife) was
  measured and **REFUTED**. The effect is monotone in depth-of-low and survives de-marketing, per-item
  equal weighting, a price floor and a one-day entry lag (~40% attenuation).
- **0c** — the transactable round trip under the WORST execution (cross the spread twice) is **NET
  NEGATIVE IN EVERY BUCKET**; the best bucket loses ~2.5%.
- **0d** — the round trip under the BEST execution (both legs fill patiently) on the LIQUID population
  is **still not tradeable**. Best bucket: **+0.26% median over 7 days**. See below.

**Verdict: a real relative signal that is not a trade.** The cross-horizon position genuinely predicts
relative mid drift — that survived four controls and both execution bounds. It does not convert into
absolute profit at a size worth attention. This file is KEPT (not deleted) as the record of a
well-supported idea that lost, in the same spirit as `hourlyDrift` in PLAN-DIURNAL-TRIAGE.

## The ask

Ben, 2026-08-10: *"a new item surfacing strategy based on items resting on their 1/3/7/30 day lows."*

## What already exists — do NOT rebuild (CLAUDE.md: check before building something that feels new)

The primitive is already shipped and shared. `js/termstructure.mjs` `termStructure(series)` computes
`DEFAULT_LOOKBACKS = [1, 3, 7, 14, 28]`, returning per horizon
`{ days, n, median, low, high, qlow, qhigh, pctInRange }` where
`pctInRange = (current − low) / (high − low)`. That IS "where does this item sit inside its N-day
range", already computed, already tested, already imported by the app and the console.

Also in hand, and all reusable without new math:

| Component | What it already answers |
|---|---|
| `termStructure` (`js/termstructure.mjs`) | per-horizon low/high/`pctInRange` for 1/3/7/14/28d |
| `basePosition(ts)` | quotes exactly ONE horizon (14d) as an inform note — the cross-horizon read does not exist |
| `classifyTrajectory` | shape: knife / based / flat / rising / elevated / oscillating / unknown |
| `floorCeilingTrack` (`js/windowread.mjs`) | floor+ceiling SLOPES → crash-risk / cooling / healthy-trend / compressing-up / ranging |
| `floorValidator` (`js/validate.mjs`) | is a level near DURABLE 28d support, in typical-swing units |
| `valueRanges` (`js/valuescreen.mjs`) | the Invest lane: recency-anchored durable q15 floor, artifact-low rejection, buy-near-the-multi-week-low |

**So the missing piece is not the data — it is the CROSS-HORIZON read and a surfacing lane.** That
keeps this cheap, and it matches the architecture the repo prefers (`diurnalTimedLap` is the model: a
composition layer over existing primitives, zero forked math, zero new fetch).

**The Invest lane is the closest existing thing and this plan must justify itself against it.**
`--mode value`/`invest` already buys near a multi-week low and holds for the cycle. If the day-low read
turns out to be "Invest with extra columns", it should become columns ON that lane, not a new board.

## Two honest constraints on the data (flagged, not silently worked around)

1. **28, not 30.** `termStructure` ships 1/3/7/14/28, and 28d is also `FLOOR_LOOKBACK_DAYS` — the
   horizon the durable floor and `floorValidator` already use. Recommend using the existing 28 rather
   than adding a 30: a new lookback means new coverage gating and a second, near-identical multi-week
   horizon that can disagree with the floor for no gain. Ben's call, but the difference is ~2 days.
2. **The "1-day low" is the weak one.** `termStructure` consumes DAILY MIDS bucketed from the 6h
   archive series, so the 1d lookback rests on ~4 points and is a coarse daily-mid low, NOT an intraday
   low. The genuine intraday read already exists elsewhere and is better (`hourProfile`'s dip window +
   the `⏳ soft-buy` cue off the 1h series). Expect the 1d bit to carry the least information here; do
   not present it as an intraday signal.

## ⚠ THE CENTRAL HYPOTHESIS BELOW WAS MEASURED AND **REFUTED** — read this first

Everything in the next section was written BEFORE Chunk 0's first pass ran. It argues that "at every
low at once" (`1111`) is a falling knife and must never rank first. **That is wrong, and the measurement
says so clearly.** It is kept in place, not deleted, because the reasoning is the repo's own standing
doctrine and the refutation is the finding — deleting it would hide that a well-supported prior lost.

Walk-forward over the 1h archive (184 items, 5,799 origins, 38 origin days, daily mids, price ≥1,000gp,
`pctInRange ≤ 0.15` = "resting on"), 7-day forward return:

| bucket | de-marketed median | per-ITEM median | items | P(up) |
|---|---:|---:|---:|---:|
| `1111` — at every low | **+2.29%** | **+3.96%** | 124 | 67% |
| `1110` | +0.55% | +1.27% | 97 | 54% |
| `0001` | +0.81% | +0.40% | 37 | 56% |
| `1100` | −0.45% | 0.00% | 108 | 47% |
| `1000` | −0.59% | −0.01% | 130 | 45% |
| `0000` — at NO low | **−1.33%** | **−1.95%** | 174 | 40% |

The ordering is monotone in depth-of-low, which is the exact opposite of the hypothesis. It survives
the three artifacts that could have manufactured it:
- **Market drift** — de-marketed against each origin day's cross-sectional median. The market FELL
  (−0.32%/7d), so de-marketing made `1111` *stronger*, not weaker. Not beta.
- **Per-origin pooling** — the per-ITEM column equal-weights 124 distinct items rather than letting one
  volatile item contribute hundreds of origins. It is the strongest column.
- **Penny items** — a 1,000gp floor is applied. (v1 without it produced a +61% mean, which was the tell.)

**The entry-lag control (Chunk 0b) — RUN, and it SURVIVES with ~40% attenuation.** The sharpest remaining
artifact was that the entry mid IS the print that produced the signal: if a low mid is partly noise, the
rebound is unbuyable. Re-run with the signal at day *t* but entry at *t+1* (184 items, 5,642 origins):

| bucket | per-item median, entry at *t* | per-item median, **entry at *t+1*** | P(up) t+1 |
|---|---:|---:|---:|
| `1111` | +3.96% | **+2.76%** | 61% |
| `0000` | −1.95% | **−0.85%** | 45% |

The per-item spread narrows from 5.91pp to 3.61pp and the ordering stays monotone. So roughly 40% of the
naive edge was entry-print artifact and ~60% is real — a materially smaller but still present effect.

**A fidelity caveat on the harness itself.** These runs build daily mids as the median of each day's
~24 HOURLY archive points, whereas production `termStructure` is fed a 6h series (~4 points/day). Both
bucket to one mid per local day, so the horizons line up, but the daily mid here is smoother than the
one production computes. A prototype must be re-measured on the production input before its numbers are
quoted as production numbers — do not carry these figures across.

**What this still does NOT license.** Measured on MIDS, untaxed, over 37 origin days in ONE regime. A
mid-to-mid move of ~2.8% is NOT a round trip: you buy at the ask and sell at the bid, and the tax is ~2%.
The deciding test before anything is sized is therefore entry at the ASK side (`avgHighPrice`) with tax
applied — until that runs, this is a promising signal, not a tradeable edge.
Small buckets (`0111`, `0110`, `0100` — 1 to 5 items) are noise and must not be quoted. And note the
tension with Ben's `base-position-caution-not-credit` ruling: this measurement supports treating a deep
low as a CREDIT, which is the opposite of that ruling. Ben's ruling was about a different thing (a
multi-week position note used to justify an entry after the fact) and is about RISK, not expected value —
but the two need reconciling explicitly before anything ships, not silently resolved in favour of the
newer number.

## The central design claim — and the trap this lane must not walk into
> **SUPERSEDED — see the refutation above.** Retained as the record of a prior that lost.

The obvious implementation ranks items by how many horizons they sit at the low of, most-lows first.
**That is backwards, and it is the single most important thing in this plan.** An item at its 1d AND
3d AND 7d AND 28d low simultaneously is, by construction, making new lows on every horizon — a
sustained decline. Ranking it first is a knife-catching machine.

This is not a hypothetical. It collides with two things the repo already knows:

- **Ben's standing ruling** (`base-position-caution-not-credit`, 2026-07-23): the multi-week price
  position signal is a **WARNING at extremes**, *not* a positive "you bought at a good moment" credit.
  A lane that ranks by depth-of-low would directly contradict a ruling already made.
- **The documented loss pattern** (`update-cycle-timing`): every large loss was held gear bought into
  a post-update dump; the fang sat `@floor` reading "favourable" while it dumped ~32m. The existing
  `@floor · ▽ caution — floor breaking ↓` cue exists precisely because at-the-floor ≠ discount.

**So the signal is the DIVERGENCE BETWEEN horizons, not the depth of the low.**

## Proposed taxonomy — the 4-bit position vector `[1d][3d][7d][28d]`

Read each horizon as "resting on that low" (definition in Open Question 2), and treat the vector as a
CLASSIFIER, not a score:

| Vector | Reading | Disposition |
|---|---|---|
| `1000` | intraday/short dip inside a range that is otherwise mid or high | **Not this lane's job** — already served by the diurnal dip window + soft-buy cue |
| `1100` / `1110` | a short pullback while the longer horizon is NOT at its low → a dip within an uptrend | The classic buy-the-dip candidate |
| `1111` | at every low at once → sustained downtrend, making new lows | **HYPOTHESIS: the worst forward bucket.** Surface as a CAUTION; never rank it first |
| `0001` / `0011` | near the multi-week low but NOT at the 1d/3d low → lifting off the base | **HYPOTHESIS: the best entry** — a base forming rather than a fall in progress. This is what the Invest lane's RC1 recency anchor was groping toward |

The two HYPOTHESIS rows are exactly what Chunk 0 exists to test. They are stated as hypotheses on
purpose: they are reasoning from the repo's loss history, and reasoning is not evidence.

## Chunk 0 — MEASURE FIRST (blocking) — **first pass RUN 2026-08-10, see the refutation above**

Status: pass 1 (raw), pass 2 (de-marketed + per-item + price floor) are DONE and reported above. The
hypothesis lost; the depth-of-low ordering is monotone and survives the three obvious artifacts.

**Chunk 0b — the entry-lag control — RUN, SURVIVED (~40% attenuation).** Numbers in the table above.
The edge did not collapse under a one-day entry lag, so it is not purely a print artifact.

**Chunk 0c — the transactable round trip — RUN. EVERY BUCKET LOSES MONEY.** Buy at *t+1*'s daily median
ask (`avgHighPrice`), sell at *t+8*'s daily median bid (`avgLowPrice`), GE tax on the sale (185 items,
5,877 origins):

| bucket | net median | per-ITEM net median | P(net>0) | de-marketed |
|---|---:|---:|---:|---:|
| `1111` — best | −3.96% | **−2.51%** | 27% | +2.65% |
| BASELINE | −7.01% | — | 19% | — |
| `0000` — worst | −8.37% | −9.10% | 16% | −1.28% |

**The ordering holds perfectly — and every bucket is still net negative.** The median round trip on this
population costs ~7%, which swallows the ~2.8% mid-drift edge whole. `1111` is the least-bad bucket, not
a profitable one.

**Verdict: a real signal, not yet a trade.** What is established is that cross-horizon position predicts
relative MID drift, robustly (three controls + an entry lag). What is refuted is that this pays as a
naive market-taking round trip.

**Chunk 0d — RUN 2026-08-10. The rescue FAILED; this plan closes.** Buy at *t+1*'s daily median
**bid** (`avgLowPrice` — a resting bid that filled), sell at *t+8*'s daily median **ask**
(`avgHighPrice` — a resting ask), GE tax on the sale, restricted to the liquid population
(median `min(hv,lv)` ≥ 3,500/day, two-sided on >90% of days). **417 items screened → 112 passed the
liquidity gate → 42 actually generated origins** (the 1,000gp floor and `termStructure` coverage drop
the rest); 1,434 origins over 37 origin-days:

| bucket | n | net med | de-mkt | P(net>0) | per-ITEM med | items |
|---|---:|---:|---:|---:|---:|---:|
| `1110` | 139 | **+0.26%** | +1.15% | 54% | +0.69% | 23 |
| `0111` | 27 | +0.28% | +1.83% | 59% | +1.05% | 4 |
| `1111` | 233 | −0.47% | +0.83% | 48% | −0.39% | 29 |
| `1000` | 182 | −1.42% | −0.18% | 38% | −0.46% | 35 |
| `1100` | 137 | −1.81% | −0.32% | 31% | −1.66% | 30 |
| `0000` | 511 | −1.75% | −0.56% | 34% | −1.85% | 40 |
| BASELINE | 1434 | −1.32% | — | 41% | — | 42 |

**The ordering holds a fourth time — and it still doesn't pay.** The de-market column is genuinely
positive for the low buckets (+0.83 to +1.83pp over the day's cross-section), so the signal is real.
But de-market is a RESIDUAL and OSRS has no short: what you can actually collect is the absolute
column, and the best bucket is **+0.26% over a 7-day hold** — under the most generous execution
assumption available, since 0d assumes BOTH legs fill patiently. True execution sits between this and
0c, i.e. below +0.26%.

**Why it fails on magnitude, independent of everything above.** Take `1110` at face value and even add
back a full ~1.2% of assumed market drag: ~1.4%/7d on a 40m position is ~80k gp/day against the scan's
**250k gp/day** attention floor. Clearing that floor would need a ~125m single-item position — a size
the Invest and amplitude lanes already serve better.

**Two honesty bounds that both cut against the strategy.** (1) Origins are daily but the hold is 7 days,
so consecutive origins overlap ~6/7 — `1110`'s n=139 is roughly **20 independent windows**. The two
positive buckets are the least trustworthy on the board, and `0111` (4 items) must not be quoted at all.
(2) The population is 42 items, not the 112 that passed the gate.

**Why the −1.32% baseline is negative (three tests, two of my own hypotheses refuted en route).**
The obvious answers were checked and killed before the real one was accepted:
- *"Liquid spreads are narrower than the 2% tax."* Measured across all 112 gate-passers: median daily
  spread **2.80%**, above tax, 69/112 exceeding it. **Refuted as stated.**
- *"The sample window was a market-wide downtrend."* Median 7d mid→mid move **0.00%**, 48% of origins
  negative, 12/37 origin-days negative. The market was **flat**. **Refuted.**
- *Per-origin decomposition on the exact population:* entry-day spread **1.82%** (mean 2.69%), ask-side
  drift **−0.05%**, giving a predicted `0.98·(1+A)·(1+B)−1 = −0.27%` against the observed −1.32%.
  **The first hypothesis was right and mis-tested**: the origin population's spread (1.82%) sits BELOW
  the tax, while the all-items figure (2.80%) does not — the 70 items that never generate origins are
  the wide-spread ones. ~1pp of residual is unexplained; a median of a product is not the product of
  medians when the terms are correlated per-origin, but that was not measured and should not be quoted
  as the cause.

**The lesson worth keeping** (CLAUDE.md rule 11): the spread hypothesis was stated, "refuted" by a test
run on the WRONG population, and only survived because the decomposition was run on the origin set
itself. A refuting test measured against a different population than the claim is not a refuting test.

### Original framing of 0d (pre-measurement)

0c makes the most pessimistic possible
execution assumption: it CROSSES THE SPREAD TWICE (instabuy now, instasell later). That is not how this
desk trades — Ben places limit orders, buying at/below the dip and selling at/above the band, which is
the entire premise of flipping. 0c also runs on the UNFILTERED archive, including illiquid wide-spread
items that the existing gates (two-sided liquidity, the 250k gp/d attention floor, `valueGate`'s unit
liquidity floor) would never admit — a ~7% median spread is itself evidence the population is mostly
un-tradeable. So 0d = re-run 0c **on the gate-surviving liquid population, with limit-order fills** (buy
at the dip level, sell at the peak level, counting only legs that actually reached). If the edge does not
clear costs there either, this plan CLOSES as a measured negative — a "looks like a signal, isn't a
trade" record, which is worth writing down given how strong 0a/0b looked.

### Original framing of Chunk 0 (pre-measurement)

Walk-forward over the local 1h SQLite archive: build daily mids, run the **real** `termStructure` at
each origin day (strictly pre-origin history — no in-sample level fitting, the DT1 circularity lesson),
bucket each origin by the 4-bit vector, and measure forward return at 3d/7d/14d plus P(up).

**The question it must answer:** does the taxonomy actually SEPARATE? Specifically, is `1111`
materially worse than baseline and is `0001`/`0011` materially better? If the buckets do not separate,
this lane is a dressed-up way of buying falling items and **this plan should be closed as a measured
negative**, exactly as PLAN-DIURNAL-TRIAGE closed `hourlyDrift` (49.7% direction — beat no-change on 6
of 380 items) rather than shipping it.

Honesty bounds (rule 4): one archive window, in-sample over the same market regime, forward return on
MIDS not on transactable bid/ask, and no tax applied. It is a **feasibility screen, not a calibration**
— it can kill the idea or license a prototype; it cannot size a position or justify a gate.

## Chunks — NOT BUILT, and not to be built

> **DEAD.** Chunk 0 gated these on the signal being tradeable. It separates but does not pay (0d),
> so DL-1/DL-2/DL-3 were never started and should not be. Retained to show what was scoped.

| # | Chunk | What | Surfaces |
|---|---|---|---|
| DL-1 | **The cross-horizon read** | One pure function over `termStructure`'s existing lookbacks → the vector + its label. Zero new math, zero new fetch. One home, like `softBuyRead` | `js/termstructure.mjs` or a thin new module |
| DL-2 | **Surfacing** | Decide AFTER Chunk 0: a column/note on the existing Invest + scan lanes, or its own `--mode`. Default to enriching existing lanes — a new board needs to earn itself | `screen-flip-niches.mjs` |
| DL-3 | **Caution integration** | Compose with `floorCeilingTrack` (is the floor breaking?) and `floorValidator` (is it near durable support?) so a `1111` renders as the knife it is. Reuses the existing `@floor` cue vocabulary rather than inventing a second one | the soft-buy / digest cues |

## Open questions for Ben

1. **Horizons** — take the existing 1/3/7/28 (recommended), or add a true 30-day lookback?
2. **"Resting on" definition** — `pctInRange ≤ X` (a fixed fraction of the range), or **within one
   `typicalSwing` of the low**? *Recommend typicalSwing*: it is scale-free, already computed, and is the
   unit `floorValidator` already judges levels in — so the two reads stay in one vocabulary.
3. **A new `--mode`, or columns on the existing Invest/band lanes?** *Recommend columns first.*
4. **Inform or gate?** *Recommend inform-only* at n≈0, consistent with every other timing read.

## Anti-goals

- Do NOT rank by depth-of-low (see the trap above).
- Do NOT fork a second "where is it in its range" number — `pctInRange` is the one home.
- Do NOT present the 1d bit as an intraday signal; it is a daily-mid low over ~4 points.
- Do NOT ship a score before Chunk 0 reports.
