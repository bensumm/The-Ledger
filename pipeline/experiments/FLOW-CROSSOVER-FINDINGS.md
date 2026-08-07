# Flow-crossover study — does daily net order flow lead price turns?

**2026-08-04.** Study script: `pipeline/experiments/flow-crossover-study.mjs` (re-runnable;
`--json` for the machine-readable dump). Removable per this directory's README — nothing
imports it.

## The claim under test

From ONE observed episode (item 29782 "Spider cave teleport", late July 2026): daily net flow
(`highPriceVolume − lowPriceVolume`, instabuy-minus-instasell) turns positive ~3 days before the
price bottom, sustained negative flow accompanies the fall, and flow reverting negative precedes
the rollover.

**Verdict up front: it does not generalize. The apparent lift is almost entirely a placebo
artifact (activity clustering near turns, direction-free), the lead-time distribution is flat,
and forward returns show a slight *mean-reversion* — the opposite sign. Not actionable.**

## Data & conventions

- `/1h` grain of the SQLite archive, aggregated in-database to a per-item per-**UTC-day** panel
  (same internal-aggregate convention as `archive.dailyRangeBulk`; these are analysis keys, not
  rendered timestamps, so the app's local-display rule doesn't apply).
- **65 full days** (24/24 buckets market-wide), 2026-05-30 → 2026-08-03. Dropped partial days:
  2026-05-29 (21 buckets), 2026-06-30 (23), 2026-08-04 (22).
- Per item-day: instabuy vol, instasell vol, flow ratio `fr = (buy−sell)/(buy+sell)`, daily
  lo/hi/mid, and the **volume-weighted mid** (the price series for all returns/turns).
- **Universe: 1,968 of 4,488 archived items** — coverage ≥ 60/65 days AND median daily
  min(buyVol, sellVol) ≥ 100 (two-sided floor; one-sided books produce fr = ±1 noise).
  Robustness re-run at min-side ≥ 1,000 → 1,197 items (results unchanged, below).

## Method (defaults fixed before results were seen)

- **Turn labels**: bottom at day *t* ⇔ vwMid[t] is the minimum of *t*±2, the prior-7d max ≥
  (1+X)·vwMid[t], and the next-7d max ≥ (1+X)·vwMid[t]. Tops symmetric. X default 5%.
  Note turn labels use ±7d of *future* data by construction — fine for measuring lead/lag,
  unusable as a live signal.
- **Crossover events**: k consecutive fr<0 days then k consecutive fr>0 days (k default 2); the
  signal day is the day confirmation completes — **no lookahead in the signal**.
- **Central test**: hit = a labeled bottom within [signal, signal+L] (L default 5d); base rate =
  same-window probability over ALL evaluable item-days; **lift = hit/base**. Symmetric for tops.
- **Placebo**: the *same* events scored against the *wrong-side* turn (neg→pos crossover ⇒ top).
  If placebo ≈ real, the lift is direction-free clustering, not order-flow information.
- **Multiplicity**: 27 configurations per side (X ∈ {3,5,8}% × k ∈ {1,2,3} × L ∈ {3,5,7}d), all
  reported, none cherry-picked.

## 1. Central test — hit rate vs base rate vs placebo

Default config (X=5%, k=2, L=5d), universe n=1,968:

| side | events | hits | hit rate | base rate | **LIFT** | placebo LIFT |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| neg→pos ⇒ bottom ≤5d | 2,314 | 1,393 | 60.2% | 52.9% | **1.14** | 1.08 |
| pos→neg ⇒ top ≤5d | 2,380 | 1,458 | 61.3% | 51.3% | **1.19** | 1.10 |

Two things to absorb:

1. **The base rate is enormous.** At a 5% amplitude threshold, ~53% of *all* item-days are
   within 5 days of a labeled bottom — turns of this size are ubiquitous in this universe. A
   60% hit rate that *sounds* good is nearly worthless against that base.
2. **The placebo carries most of the lift.** A neg→pos flow crossover "predicts" a *top*
   almost as well as it predicts a bottom (1.08 vs 1.14). What a crossover actually marks is
   "an active, two-sided, choppy stretch" — and turns cluster in those stretches regardless of
   flow direction. The directional information content is the residual: **~0.03–0.10 of lift,
   i.e. ~2–4 percentage points of hit rate.** (With n≈2,300 events the SE on the hit rate is
   ~1pp, so the residual is statistically nonzero at the default — but economically negligible
   and unstable across the grid.)

### Sensitivity grid (all 27 configs/side — the multiplicity disclosure)

Lift ranges, bottoms **1.09–1.21**, tops **1.10–1.29**; placebo ranges 0.97–1.17. The
directional edge (lift − placebo) never exceeds ~0.21 and is usually < 0.10; it is largest in
the smallest-n cells (k=3, ~650 events), exactly where noise lives. No configuration reaches
lift 1.3. Full table in the script output; abridged:

| X | k | L | B-events | B-lift | B-placebo | T-events | T-lift | T-placebo |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 3% | 1 | 5d | 10,115 | 1.10 | 1.09 | 10,177 | 1.11 | 1.08 |
| 3% | 2 | 5d | 2,314 | 1.13 | 1.07 | 2,380 | 1.15 | 1.07 |
| 5% | 2 | 5d | 2,314 | 1.14 | 1.08 | 2,380 | 1.19 | 1.10 |
| 5% | 3 | 5d | 656 | 1.16 | 1.05 | 682 | 1.20 | 1.14 |
| 8% | 2 | 5d | 2,314 | 1.18 | 1.14 | 2,380 | 1.26 | 1.14 |
| 8% | 3 | 3d | 684 | 1.18 | 0.97 | 721 | 1.29 | 1.13 |

The effect does not *vanish* under threshold changes — it is *uniformly tiny* under all of
them, and the placebo tracks it everywhere. That IS the finding.

### Lead-time distribution (the "leads by ~3 days" claim)

Signed offset of every labeled turn within ±7d of a signal day (default config; negative =
turn happened *before* the crossover):

```
bottoms: -7d:224 -6d:280 -5d:235 -4d:187 -3d:210 -2d:285 -1d:272  0d:292 +1d:303 +2d:254 +3d:255 +4d:277 +5d:282 +6d:253 +7d:269
tops:    -7d:244 -6d:255 -5d:288 -4d:175 -3d:200 -2d:266 -1d:282  0d:291 +1d:298 +2d:286 +3d:272 +4d:305 +5d:265 +6d:272 +7d:251
```

**Flat.** No peak at +3d, no peak anywhere; turns are as likely to *precede* the crossover as
to follow it. The episode's 3-day lead is not a population regularity — it is one draw from a
uniform distribution.

## 2. Forward returns by flow state (the cleaner framing)

Pooled universe item-days (n = 125,944), flow-ratio quintiles, forward **log** returns on the
volume-weighted mid — medians with [IQR]:

| quint | fr med | n | same-day | +1d | +3d | +7d |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Q1 (heavy sell) | −0.651 | 25,189 | −0.03% [−2.7,2.0] | **+0.01%** [−2.3,2.4] | −0.05% | −0.24% |
| Q2 | −0.259 | 25,189 | −0.10% | −0.07% | −0.32% | −0.75% |
| Q3 | −0.016 | 25,188 | −0.13% | −0.13% | −0.32% | −0.78% |
| Q4 | +0.204 | 25,189 | −0.18% | −0.13% | −0.29% | −0.65% |
| Q5 (heavy buy) | +0.580 | 25,189 | 0.00% [−3.4,4.2] | **−0.31%** [−4.3,3.2] | −0.35% | −0.38% |

- The gradient runs the **wrong way**: heavy-instabuy days (Q5) have the *worst* next-day
  median (−0.31%) and heavy-instasell days (Q1) the best (+0.01%). Mild **mean reversion**,
  not momentum-confirmation. The spread (~0.3pp/day) is well inside the GE tax (2%) — not
  tradeable either.
- Dispersion dwarfs the medians everywhere (IQR ±2–4%); nothing here supports a directional
  bet.
- Sustained runs say the same: after a 3rd consecutive negative-flow day, +1d median −0.04%
  (n=42,026); after a 3rd positive-flow day, −0.13% (n=37,763).

### Mechanical-coupling check (the leakage confound)

Spearman ρ, flow ratio vs log return, pooled:

| horizon | ρ | n |
| --- | ---: | ---: |
| same day (contemporaneous) | +0.018 | 125,936 |
| +1d forward | −0.030 | 123,968 |
| +3d forward | +0.005 | 120,032 |
| +7d forward | +0.029 | 112,160 |

The feared tautology (price-up ⇒ more prints at the high ⇒ fr co-moves with same-day return)
turns out **negligible at daily aggregation** (ρ ≈ +0.02 pooled; it exists within some classes,
e.g. teleports +0.17). So the null is clean: the hypothesis doesn't fail because leakage was
masking it — daily flow ratio is simply near-orthogonal to both same-day and forward price
moves in this window.

## 3. The seed episode, re-read from the archive

Archive UTC-day numbers differ in detail from the claimed table (different day boundaries /
source view) but the shape reproduces: flow flips positive 07-25, vw-mid bottoms 07-28 (28,534),
breakout 07-31 → 08-01. **But note what the episode itself shows on the way up:** the two
breakout days, 07-31 and 08-01, had *negative* net flow (−1,164 and −270), and the +55% rally
ran against it — contradicting sub-claim 1 *inside the anchor episode*. The story only reads
cleanly if you stop quoting flow the day the rally starts, which is what after-the-fact
selection does.

## 4. Real-fills cross-check (anecdote-with-numbers — NOT validation)

385 closed lots (positions.json), joined to entry-day flow state; heavily concentrated (top 3
items: Soul rune ×31, Abyssal bludgeon ×28, Enhanced crystal teleport seed ×27), and our
entries were already signal-selected, so no causal reading:

| entry-day flow state | lots | win rate | median realised | items |
| --- | ---: | ---: | ---: | ---: |
| fr < −0.1 (sell-dominant) | 47 | 72.3% | 14,894 | 17 |
| −0.1 … +0.1 | 176 | 82.4% | 80,310 | 37 |
| fr > +0.1 (buy-dominant) | 144 | 83.3% | 57,254 | 33 |
| no flow data | 18 | 94.4% | 32,219 | 7 |

If anything, buying into sell-dominant days did *worse* (72% vs 82–83%, and a 5× smaller
median win) — directionally consistent with "negative flow is not a discount signal", but at
n=47 vs 320 across a lopsided item mix this is an anecdote, nothing more.

## 5. Structural question (exploratory — crude name-pattern classes)

The seed item is a reflexive-supply boss teleport (kills produce it, going to the boss consumes
it). A reliable "boss-drop teleport vs crafted consumable vs gear" taxonomy is **not derivable
from the archive** (the mapping has names only), so this stayed a light name-pattern cut:

| class | items | ρ same-day | ρ +3d | +3d med (fr>0) | n | +3d med (fr<0) | n |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| teleport | 60 | **+0.168** | +0.048 | −0.33% | 2,277 | −0.97% | 1,383 |
| rune | 23 | −0.132 | −0.004 | +0.24% | 1,200 | +0.07% | 203 |
| potion(4) | 120 | +0.060 | −0.040 | −0.51% | 5,249 | +0.18% | 2,070 |
| other | 1,765 | +0.012 | +0.006 | −0.33% | 49,189 | −0.16% | 58,329 |

Teleport-class items do show the strongest *contemporaneous* flow-price coupling (+0.17 vs
+0.01 for everything else) — consistent with the reflexive-population story — but their
*forward* ρ is still ≈ 0 (+0.05). So the structure plausibly explains why the seed episode's
flow and price moved together so legibly, **not** a predictive edge. The "teleport" bucket also
mixes boss scrolls with house tabs etc.; treat the whole section as exploratory only.

## Is this actionable?

**No.**

- Lift 1.09–1.29 across every threshold combination, with the placebo (wrong-direction) test
  at 0.97–1.17 — the directional information content is ~2–4pp of hit rate against a ~50% base.
- Lead-time distribution flat: nothing to time an entry off.
- Forward-return gradient is slightly *inverted* (mean reversion) and ~10× smaller than the GE
  tax.
- The seed episode contradicts its own rule on the breakout days.

Do **not** build a flow-crossover gate, column, or alert. The one defensible descriptive reuse:
a heavy-*instabuy* day (Q5) is, if anything, a mildly *worse* next-day entry — which the
existing "don't chase strength / buy the dip window" doctrine already encodes without this data.

## Limits (rule-4 honesty)

- **One 65-day window**, no out-of-sample split — every number is descriptive of Jun–Aug 2026,
  not a forecast. Season/update effects (e.g. the late-July game-update churn) sit inside it.
- Turn labels consume ±7d of future data (necessary for lead/lag measurement; never a live
  signal).
- 27 configs/side evaluated — judge only the *pattern across the grid*, never one cell.
- Universe survivorship is minimal (archive stores the whole market; the coverage filter drops
  ~4% of item-days) but the panel starts when the archive does — no pre-June history.
- Real-fills section: n=385, concentrated, self-selected entries.

## README inventory lines (paste into "Map of the repo" — do not commit from this study)

```
- `pipeline/experiments/flow-crossover-study.mjs` — one-shot research study (2026-08-04): does daily net order flow (instabuy−instasell) lead price turns? Reads the /1h SQLite archive read-only; hit-rate-vs-base-rate + placebo + forward-return tests; `--json` for machine output. Result: null — lift 1.09–1.29 with placebo ≈ equal; not actionable. Removable per `pipeline/experiments/README.md`.
- `pipeline/experiments/FLOW-CROSSOVER-FINDINGS.md` — the written findings report for flow-crossover-study.mjs: method, tables, honest verdict (n=1 story does not generalize; no flow-crossover signal ships).
```
