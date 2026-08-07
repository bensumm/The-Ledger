# The edge map — realized P&L, gate placement, lead/lag, and the exclusion map (2026-08-04)

Four workstreams over one shared item-day panel. Scripts: `pipeline/experiments/edge-map-study.mjs`
(+ shared helpers `edge-map-lib.mjs`; `--section a|b|c|d`, `--json`; panel cached to
`pipeline/.cache/edge-map-panel.jsonl` so reruns take ~2s). Builds directly on
`VOLUME-VS-BAND-FINDINGS.md` (same measure definitions) and holds itself to
`FLOW-CROSSOVER-FINDINGS.md`'s bar (base rates, controls, nulls reported as nulls).

**Verdicts up front:**

- **A.** Our 383 closed flips (82 items, +30.69m, 82% win, med ROI 1.1%, med hold 1.5h) are far
  too concentrated for per-cell conclusions — but the one non-thin read supports the liquidity
  floor from our own book: item-weighted win rate collapses in the thin volume quintiles
  (13–45%) vs 95–100% at Q3+.
- **B.** **The low-volume wide band is NOT a sparse-print measurement artifact — the prescribed
  subsampling test came out INVERTED.** Subsampling a liquid item's day to k hourly prints
  *shrinks* the observed band (0.61× at k=3, 0.97× at k=18); it cannot manufacture an 85% band.
  What the wide band actually is: real extreme prints with a median depth of **~2–3 units** at
  the band-setting hours. The mirage is **size, not price** — and the widest cells cannot clear
  the 500k gp/d attention floor even capturing 100% of their flow.
- **C.** **Clean null.** Volume(t−1) does not lead band(t): median ρ +0.034 vs +0.380 for plain
  band persistence; P(band above own median | top-quintile volume yesterday) = **50% — exactly
  the base rate**. The intraday early-volume lead is equally null (+0.034). The prior study's
  +0.15 contemporaneous link is confirmed (+0.161) but it is recognition, not forecast.
- **D.** Two exclusions survive the strike check (**R-TAX0**: gate-passing items whose median
  after-tax robust edge ≤ 0; **R-1SIDED**: median flow imbalance ≥ 0.6), one measurement guard
  (**R-TICK**: price < 50gp). Three tempting rules are **contradicted by our own realized
  P&L** and must not be encoded: excluding the 500–3,500/d zone would have blocked **+13.2m**
  of our profit; excluding low-clear-rate items **+4.3m**; excluding 0–1%-edge items **+2.1m**
  of churn-lane profit.

## Method

Panel: **132,164 item-days × 1,895 items** (≥40 qualifying days each, of 4,488 archived),
2026-05-29 → 2026-08-04, `/1h` grain, UTC-day keys (analysis keys, not rendered timestamps). A
day qualifies with ≥12 hours in which both `avgHighPrice` and `avgLowPrice` printed — same rule
as the prior study, so `spreadPct` / `bandPct` / `madPct` are directly comparable. New measures:

| measure | definition | what it is |
| --- | --- | --- |
| `trimBandPct` | (2nd-highest hi − 2nd-lowest lo) / dayMid | band with ONE extreme print/side dropped |
| `robustBandPct` | (q90 of hourly highs − q10 of hourly lows) / dayMid | the band a patient flip can plausibly work |
| `edgePct` | (q90hi − tax(q90hi) − q10lo) / dayMid | **realizable after-tax robust edge**, canonical `tax()` from `js/quotecore.js` |
| `depthTop/Bot` | hv/lv in the single hour that set the day's max-hi / min-lo | units the band extreme was actually good for |

Bins (computed on full-window per-item medians — a mild bin-edge lookahead; bins are
coordinates, not signals): price deciles cut at 38 / 125 / 327 / 887 / 1,915 / 4,219 / 16,198 /
81,401 / 1.41m gp (matches the prior study); global min-side volume quintiles cut at 148 / 628 /
4,065 / 50,518 per day.

## A. Does realized P&L track item characteristics as of the buy date?

383 flip lots (3 banked keep-round-trips excluded), all 383 characterized against trailing
7-day pre-buy panel data (trailing-only — no same-day or future data in any join). **This is our
own self-selected trade log, not a sample of the opportunity set**: 82 distinct items, top 3
carry 22% of lots (Soul rune ×31, Abyssal bludgeon ×28, Enhanced crystal teleport seed ×27).
Item-weighted columns (itemW) weight each item once; cells with <10 distinct items are flagged
and no conclusion is drawn from them.

Overall: win 82.0% · med net/u 109gp · med ROI +1.11% · med hold 1.5h · total +30.69m.

### by min-side volume quintile (universe cuts: ≤148 / ≤628 / ≤4,065 / ≤50,518 / above)

| cell | lots | items | win% | med ROI | itemW win% | itemW ROI | |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| vol Q1 | 9 | 4 | 33% | 0.0% | **13%** | 0.0% | ⚠ <10 items |
| vol Q2 | 31 | 14 | 52% | 0.1% | **45%** | 0.0% | |
| vol Q3 | 159 | 26 | 84% | 1.0% | 95% | 0.9% | |
| vol Q4 | 31 | 6 | 100% | 4.2% | 100% | 4.3% | ⚠ <10 items |
| vol Q5 | 153 | 33 | 85% | 1.3% | 100% | 1.2% | |

The only strong cross-cell contrast in the whole workstream, and it points the same way as the
liquidity gate: **our win rate collapses below ~600/d min-side.** (Q1 is 4 items / 9 lots —
directional only.)

### by price decile

Every decile except 10 has <10 items. Decile 10 (>1.41m gp): 175 lots / 36 items, win 78%,
itemW ROI +0.3%, med net/u 54.8k — big tickets are half our activity, thin in %, real in gp.

### by pre-buy band / spread / regime

| axis | pattern | honest read |
| --- | --- | --- |
| band | itemW ROI 0.7% (<5%) → 1.2% (5–10%) → 3.5% (10–20%) → 7.8% (≥20%, ⚠ 5 items) | wider pre-buy band paid better, monotone across all four buckets — but the ≥20% cell is 5 items |
| spread | itemW ROI 0.6% (<2%) → 1.3% (2–4%) → 4.4% (≥4%, ⚠ 7 items) | same shape, same caveat |
| regime | itemW ROI: falling 0.4% (24 items) · flat 0.8% (40) · rising 1.2% (31); win 76/85/81% | falling-regime entries did worst — consistent with the update-cycle doctrine, but ranges overlap; no rule from this |

## B. Is the gate in the right place — and is the low-volume band an artifact?

### B1. Strata around the 3,500/d min-side gate (per-item medians)

| stratum | items | med price | med spread | med band | med robust band | med after-tax edge | med depth@top | med gp-flow/d |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| <100/d | 263 | 42.3k | 8.28% | 29.45% | 22.50% | 20.33% | **2** | 2.29m |
| 100–500/d | 444 | 52.8k | 5.27% | 18.31% | 13.53% | 11.39% | **8** | 10.19m |
| 500–3,500/d (below gate) | 409 | 1,743 | 4.70% | 23.95% | 17.64% | 15.87% | 39 | 2.59m |
| 3,500–20k/d | 262 | 961 | 3.33% | 15.41% | 11.44% | 9.55% | 261 | 9.42m |
| ≥20k/d | 517 | 344 | 2.17% | 9.66% | 7.13% | 5.25% | 5,464 | 66.32m |

The below-gate zone (500–3,500/d, 409 items) is genuinely edge-rich on paper: 227 items pass a
strict tradeability screen (robust after-tax edge ≥2% on ≥50% of days, imbalance <0.5, price
≥100gp) — Twisted buckler, Lightbearer, Burning claws, Aranea boots, Awakener's orb, etc. But
depth@top median 39 units: this is patient band/value territory sized in single units, not
churn throughput. **Workstream D's strike check settles the gate question: this zone holds
+13.2m of our own realized profit** — the gate is correctly placed only because side doors
(the 4.5b gp-flow door, value/dip/sub-floor lanes) keep admitting it. Two of our best lanes sit
just UNDER the gp-flow door: Enhanced crystal teleport seed (4.08b/d, +2.27m realised) and
Berserker ring (4.06b/d, +1.06m, 12/12 wins) vs the 4.5b threshold — archive-median gp-flow vs
the screen's live rolling-24h figure isn't identical, but a ~10% miss on our two best sub-gate
lanes is worth knowing when the door is next recalibrated.

### B2. THE CRITICAL TEST — is the wide low-volume band a sparse-print artifact?

Prescribed test: take 40 dense liquid reference items (min-side ≥3,500/d, 24 printed hrs/day,
300–20k gp), randomly keep only k of each day's 24 hourly observations (25 trials/day, seeded),
recompute `bandPct`. 2,134 complete item-days.

| k hours kept | med band(k)/band(24) | IQR | med subsampled band |
| ---: | ---: | --- | ---: |
| 3 | 0.612 | 0.530..0.691 | 4.39% |
| 4 | 0.684 | 0.605..0.760 | 4.85% |
| 6 | 0.777 | 0.702..0.841 | 5.49% |
| 8 | 0.837 | 0.771..0.886 | 5.86% |
| 12 | 0.907 | 0.862..0.943 | 6.37% |
| 18 | 0.968 | 0.944..0.983 | 6.75% |
| 24 | 1.000 | — | ~7% |

**The result is the opposite of the artifact hypothesis.** Fewer observations SHRINK the
observed band (a subsample's extremes are a subset of the full sample's) — and thin items
aren't even print-sparse at the hourly grain (med two-sided hrs/day: 17h even below 100/d, 23h
at 100–3,500/d, i.e. k≈17–23 where the shrinkage is only 3–7%). Subsampling a liquid item to
thin-item density produces a **4–7% band, not 85%**. The Q1 wide band is not reproduced;
bucket-count is exonerated. The prior findings doc's untested limit ("some of the Q1 85% band
is measurement") is now answered: **not sampling measurement — the prints are real.**

### B2b. So where does the 85% band come from? (decile 5, by vol quintile)

| vol Q | items | med min-side/d | raw band | trim band | robust band | after-tax edge | depth@top | depth@bot | units/printed-hr |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Q1 | 37 | 66 | 85.98% | 75.10% | 63.55% | 60.52% | **3** | **5** | 3.7 |
| Q2 | 37 | 655 | 26.76% | 22.64% | 20.24% | 18.09% | 26 | 23 | 29.8 |
| Q3 | 37 | 2,583 | 23.95% | 20.43% | 18.06% | 15.87% | 201 | 127 | 112.3 |
| Q4 | 37 | 24,859 | 11.04% | 9.17% | 7.88% | 5.81% | 1,076 | 1,118 | 1,130 |
| Q5 | 41 | 125,990 | 7.09% | 6.06% | 5.19% | 3.18% | 5,464 | 11,624 | 5,250 |

Robustification collapses Q1's band 85.98% → 63.55% (~26% of the width is 1–2 extreme prints
per side) — but the remaining 63% is genuine day-range **at ~3 units of depth**. The kill-shot
arithmetic: capturing **100%** of Q1's min-side flow at the **full** robust edge yields
66 × 1,350gp × 60.5% ≈ **54k gp/day** — an order of magnitude under the 500k attention floor.
The widest cells are mathematically incapable of paying attention costs. The gate is protecting
us from a **size mirage** (real prices, no size), not from a real-but-unreachable price edge —
and not from a statistical illusion.

## C. Is the within-item volume↔band link tradeable? NULL.

Per-item Spearman over consecutive-day pairs (1,895 items, ~50–65 pairs each):

| relation | median ρ | IQR | % positive |
| --- | ---: | --- | ---: |
| ρ(vol(t−1), band(t)) — **the lead under test** | **+0.034** | −0.084..+0.157 | 58% |
| ρ(vol(t), band(t)) — contemporaneous (prior study said +0.153) | +0.161 | +0.019..+0.288 | 77% |
| ρ(band(t−1), band(t)) — **control: plain persistence** | **+0.380** | +0.250..+0.500 | 98% |
| ρ(vol(t−1), vol(t)) — volume persistence | +0.332 | +0.189..+0.484 | 95% |
| ρ(vol(t−1), edge(t)) — lead onto after-tax edge | +0.036 | −0.086..+0.158 | 58% |

Conditional framing (the tradeable question), per item vs its own baseline:

| condition | items | med band(t)/own-median | med P(band > median) | base rate | med Δ after-tax edge |
| --- | ---: | ---: | ---: | ---: | ---: |
| vol(t−1) ≥ own q80 (SIGNAL) | 1,816 | 1.025 | **50%** | 50% | +0.15pp |
| band(t−1) ≥ own q80 (CONTROL) | 1,805 | 1.283 | **71%** | 50% | — |

The signal's hit rate **equals the base rate** (lift 1.0); the persistence control is lift
~1.42. The full vol(t−1)-quintile profile runs 0.987 → 1.024 in band ratio and −0.05pp →
+0.14pp in edge — against a 2% tax, nothing. Intraday is the same story: ρ(UTC 0–5h volume,
6–23h band) median +0.034 (59% positive) vs rest-band day-over-day persistence +0.335;
conditional early-vol ≥ q80 → P(rest-band above median) = 50%, Δ rest edge +0.15pp.

**Verdict: yesterday's (and this morning's) volume tells you nothing about today's band that
today's band doesn't tell you about tomorrow's better.** The +0.15 contemporaneous correlation
is co-movement you can only recognize in real time, not plan around. Do not build a
volume-leads-band column, gate, or timing rule. (Configs fixed a priori: lag 1d, q80
threshold, 0–5 UTC window, ±3% regime — no grid searched.)

## D. THE EXCLUSION MAP

Universe: 1,895 items · gate-passing (min-side ≥3,500/d): 779 · all 33 currently
screen-surfaced ids present. Full 10×5 grid (price decile × within-decile vol quintile,
per-item medians) — the raw table is in `.edge-map` output / `--section d`; the decision-relevant
extremes:

| cell (dec·volQ) | items | med price | med min-side | spread | robust band | after-tax edge | clear≥2% days | depth@top | note |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1·Q5 | 41 | 6gp | 859k | **0.00%** | 22.2% | 22.2% | 100% | 42.7k | tick-quantized garbage — spread unmeasurable |
| 5·Q1 | 37 | 1,350 | 66 | 15.6% | 63.6% | 60.5% | 100% | **3** | the size-mirage showcase (B2b) |
| 6·Q5 | 41 | 2,584 | 161.9k | 1.21% | 4.12% | 2.09% | 53% | 9,510 | churn territory, edge ≈ tax |
| **7·Q5** | 41 | 7,922 | 81.2k | **0.69%** | 2.25% | **0.23%** | **3%** | 2,867 | **the tax-eaten cell** — 7 of 33 current screen rows live here |
| 8·Q5 | 41 | 24.4k | 8,184 | 0.79% | 3.00% | 0.98% | 16% | 289 | marginal; imb 0.59 |
| 10·Q5 | 42 | 11.5m | 686 | 1.81% | 3.49% | 1.46% | 31% | 34 | big tickets: thin %, our main gp source (+11.9m of our lots) |

Regime cut (gate-passing item-days, trailing 7d ±3%): falling med edge 8.99% (90% of days
clear 2%), flat 3.79% (68%), rising 10.46% (91%). **Movement widens realizable bands in both
directions — no regime exclusion is supportable** (consistent with the amended per-strategy
falling doctrine; the risk in falling regimes is direction, not band absence).

### Candidate rules and the strike check

| rule | definition | items | gate-passing removed | screen removed (of 33) | our lots inside | realised inside | verdict |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| R-TAX0 | gate-passing AND med after-tax robust edge ≤ 0 | 35 | 35 | 0 | **0** | 0 | **ENCODE** |
| R-1SIDED | med \|hv−lv\|/(hv+lv) ≥ 0.6 | 162 | 62 | 1 (Grimy snapdragon) | **0** | 0 | **ENCODE (with caveat)** |
| R-TICK | price < 50gp | 225 | 164 | 1 (Ancient essence) | 0 | 0 | **ENCODE as measurement guard** |
| R-GHOST | min-side < 500/d | 707 | 0 | 3 (Tormented bracelet · Avernic defender hilt · Magus ring) | 57 (17 items) | **+3.18m** | already enforced via FLOOR; do NOT harden |
| R-SUBGATE | min-side 500–3,500/d | 409 | 0 | 5 (Berserker ring · Lassar tele (t) · Looting bag note · Twinflame staff · Mithril keel parts) | 142 (26 items) | **+13.18m** | **REJECT** |
| R-TAX1 | gate-passing AND edge 0–1% | 27 | 27 | 2 (Prayer potion(4) · Grimy snapdragon) | 27 (7 items) | **+2.05m** | **REJECT** |
| R-CLEAR | <25% of days clear 2% | 145 | 67 | 3 | 76 (17 items) | **+4.34m** | **REJECT** |

### Proposed exclusions (ranked; what to encode)

1. **R-TAX0 — never surface a gate-passing item whose median after-tax robust edge ≤ 0**
   (35 items, 1.8% of universe; all high-volume compressed-spread books of the 7·Q5 type: med
   spread 0.69%, 3% of days clear 2% after tax). Zero of our 383 lots ever touched one; zero
   currently surfaced (the ROI gates already catch them at quote time) — so this is
   belt-and-suspenders on the POOL, not a behavior change today; its value is that it is
   enforceable *before* pricing, and it hard-stops the churn lane if spreads compress further.
   Cost of being wrong: an excluded item is invisible, so pair with a monthly count of
   exclusions (visibility per the error-cost doctrine).
2. **R-TICK — treat every %-denominated measure as unreliable below 50gp** (225 items; 164
   gate-passing; decile 1's Q5 med spread prints 0.00% because integer prices quantize away the
   spread). These items are tax-exempt (sell < 50gp pays 0), so they are NOT necessarily
   unprofitable — the rule is *exclude from %-ranked niches / evaluate in gp-per-unit only*,
   not "never trade". One current screen row affected (Ancient essence, churn lane — which
   already ranks in gp terms).
3. **R-1SIDED — exclude items with median flow imbalance ≥ 0.6** (162 items, 62 gate-passing;
   a round trip needs both sides to print). Zero of our lots inside. Caveat honestly: one
   currently-surfaced item (Grimy snapdragon) trips it, and 0.6 was the only threshold tried —
   run the counterfactual log before hardening below 0.6.
4. **R-GHOST stays exactly as it is** — the <500/d zone is already excluded by the FLOOR door,
   and the strike check shows why it must keep its 4.5b gp-flow side door rather than harden:
   +3.18m of our realised P&L lives there, almost entirely in big-ticket gear that entered via
   gp-flow (Abyssal bludgeon +2.56m at 8.3b/d flow; also all four of our worst gear losses —
   Hydra leather −478k, Ancestral hat −512k, Virtus −253k, Spectral −175k: the zone is
   high-variance, per-item judgment, exactly what a side door + human veto is for).

### Explicitly rejected (these were the tempting ones)

- **R-SUBGATE (exclude 500–3,500/d):** +13.18m of our realised profit sits in this zone — the
  crystal-seed/Primordial/Berserker/blowpipe band lanes, 26 items. Half our winners. Also 227
  of its 409 items pass a strict paper-tradeability screen (B1). The 3,500 gate is a
  *throughput* filter for the churn scan, not an edge boundary; the value/dip/sub-floor side
  doors that admit this zone are load-bearing.
- **R-CLEAR (<25% of days clear 2%):** catches tight-band high-velocity items where we win on
  churn frequency, not band width — Primordial boots +2.16m, Ruby dragon bolts +1.04m,
  Mahogany plank 9/9 wins inside. Band-clear fraction is a BAND-strategy statistic; applying
  it across strategies is the per-strategy-gates lesson again.
- **R-TAX1 (edge 0–1%):** +2.05m strike — sub-1% robust edge with high velocity is precisely
  what the churn lane is for (Prayer potion(4) is in it, currently surfaced, 7/10 wins).
- **Any regime-based exclusion:** falling regimes carry MORE realizable band (8.99% vs flat's
  3.79%), and A's falling-entry underperformance (itemW ROI 0.4% vs 1.2% rising) is
  overlapping-range weak at 24 items.

## Honesty & limits (rule 4)

- **One 68-day window (Jun–Aug 2026), no out-of-sample split. Everything above is descriptive
  of this window, not predictive.** The late-July game-update churn sits inside it.
- Workstream A is our own signal-selected book: 383 lots, 82 items, top-3 items = 22% of lots.
  Item-weighted stats and <10-item flags throughout; nothing in A is causal.
- Panel qualification (≥12 two-sided hours, ≥40 days) censors thin items toward their active
  days and drops 2,593 of 4,488 archived items entirely; thin-strata "edge" figures describe
  the survivors' better days.
- `edgePct` is idealized: it assumes fills at the day's q10 low and q90 high. Real fills are
  worse; that biases *against* the tax-eaten exclusions being too aggressive (real edge is
  lower than measured), and *for* caution on the wide-band cells.
- Bin edges (deciles/quintiles) computed on the full window — a mild lookahead in coordinates
  only. Lot joins are strictly trailing (7d pre-buy).
- Configurations tried: exactly the ones reported. C: one lag, one threshold (q80), one early
  window (0–5 UTC). D: the 7 rules in the table — R-TAX1 and R-CLEAR were evaluated and
  REPORTED, not silently dropped. B2: one k-grid, 25 trials, seeded.
- gp-flow comparisons vs the screen's 4.5b door use archive UTC-day medians, not the screen's
  live corrected rolling-24h volume — treat the ECTS/Berserker "near-miss" as a flag to check
  at recalibration time, not a measured gate error.

## What would promote these from placeholder to validated

- **R-TAX0 / R-1SIDED / R-TICK:** (1) a second, non-overlapping archive window (the archive
  accrues ~30d/month — re-run this study in October on Sep-only data) reproducing the same
  cell assignments; (2) a shadow log: tag would-be-excluded items in `suggestions.jsonl` for
  ≥1 month and count how many a human would actually have traded (the error-cost test — an
  exclusion whose counterfactuals are all losers is validated; one that hides a winner is not);
  (3) for R-1SIDED, a threshold sweep with the same strike-check discipline before moving off
  0.6.
- **The B2 size-mirage finding** needs no promotion to act on — it *confirms* existing gates
  rather than proposing new behavior.
- **The C null** closes the volume-leads-band question for this data grain; reopening it would
  require a different mechanism hypothesis (e.g. 5m-grain intraday microstructure), not a
  re-run.
- **The near-miss gp-flow door finding (B1):** validated only by the door's own recalibration
  procedure (count-matched selectivity on live corrected volume), not by this archive study.

## README inventory lines (paste into "Map of the repo" — per process rule 8)

```
- `pipeline/experiments/edge-map-lib.mjs` — shared helpers for the EDGE-MAP study (2026-08-04): the item-day panel builder over the /1h SQLite archive (spread/band/mad + robust band, after-tax edgePct via the canonical quotecore tax(), depth-at-extremes, early/rest intraday split), JSONL panel cache (pipeline/.cache/edge-map-panel.jsonl), Spearman/median/quantile stats, and positions.json/mapping/screen.json loaders. Consumed only by edge-map-study.mjs; removable per pipeline/experiments/README.md.
- `pipeline/experiments/edge-map-study.mjs` — four-workstream research study (2026-08-04): A realized-P&L-vs-characteristics (item-clustered, trailing-only joins), B liquidity-gate placement + the subsampling artifact test (result: INVERTED — wide low-volume bands are real prices at ~2–3 units depth, a size mirage), C volume→band lead/lag (clean null vs persistence control), D the price×volume exclusion map with strike checks against our own lots. `--section a|b|c|d`, `--json`. Read-only; removable per pipeline/experiments/README.md.
- `pipeline/experiments/EDGE-MAP-FINDINGS.md` — the written findings report for edge-map-study.mjs: method, tables, the proposed exclusion list (R-TAX0 / R-1SIDED / R-TICK encode; R-SUBGATE / R-CLEAR / R-TAX1 rejected on +13.2m/+4.3m/+2.1m realized-profit strikes), and what would promote each from placeholder to validated.
- `pipeline/.cache/edge-map-panel.jsonl` — gitignored intermediate: the cached 132k-row item-day panel (line 1 = meta header) written/read by edge-map-lib.mjs `loadOrBuildPanel` so edge-map-study.mjs reruns take ~2s instead of re-walking ~4.9M archive rows; regenerate with `--no-cache`.
```
