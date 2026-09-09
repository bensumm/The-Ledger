# Experiments — deliberately removable

Standalone probe logs, isolated from the main pipeline on purpose: nothing under `pipeline/commands/`,
`js/quotecore.js`, `suggestions.jsonl`, or `positions.json` reads this directory. Delete a file (or the
whole directory) and nothing else breaks — no import, no downstream consumer.

## ladder-probe-2026-07-16.jsonl

Ben's 2026-07-16 ladder probe: 4 tiny (100-unit, except the held-lot-sized R2 rungs) sell offers per
item on Raw anglerfish (#13439) and Ruby dragon bolts (e) (#21944), placed at once so all 4 GE slots
per item are live simultaneously, run for ~8h. Goal: replace guessed reliability-discount constants
(the pressure-exit volume-tier discussion) with real fill-time-vs-price data on two thin (~570-670k/d)
books, instead of tuning blind.

Each line: `{rung, item, itemId, price, qty, hypothesis, placedTs/Iso, filledTs/Iso, timeToFillSec, status}`.
`status` is `open` | `filled` | `expired` (no fill inside the 8h window — still a real data point, just
a different kind: it upper-bounds fill probability at that price rather than measuring a time).

Rungs, by design:
- **R1** — control, priced near the live clearing price. Predicted near-certain fill <2h. Anchors the
  fast end of the time axis so a "nothing filled" elsewhere is interpretable.
- **R2** — the reach-consistent level (the price the neutral reach-fold model already recommends).
  Predicted fill within ~4-6h.
- **R3** — the Optimistic-band top. Predicted ~25-40% chance in 8h.
- **R4** — a *revised* stretch, deliberately pulled in from the raw pressure-exit trial number
  (2,629 / 3,180) to the recent-3-night observed high-water mark (2,600 / 3,150) — the original picks
  were themselves stale-on-reach in the same way PB5 (`js/windowread.mjs`, `e034a37`) was built to
  fix, so they'd have produced a near-certain miss with low information value. Predicted ~30-40%: a
  genuine coin-flip region where reach-based and pressure-based estimates actually diverge.

**Result so far (2026-07-16, ~25 min in):**
- **R1 controls** — both filled fast, as predicted: anglerfish 2,480 in 114s, bolts 3,049 in 41s.
- **R2/R3** (both items) — still open/resting. Briefly *appeared* to have vanished from
  `monitor-offers.mjs`/`watch-positions.mjs` due to a RuneLite Exchange Logger restart-blindness
  event (a mass all-slots-EMPTY log wipe at 09:26:38 that wasn't a real cancel) — confirmed still
  genuinely live in-game, and the LH2.4 fix (same session, `pipeline/lib/offers.mjs`
  `restartBlindSuspects()`) now flags this case instead of silently misreporting it.
- **R4** (both items) — cancelled by Ben ~20min in, unfilled, before the 8h window closed. Not a
  real data point on R4's hypothesis (too short a window to conclude anything) — recorded as
  `cancelled_early`, not `expired`.
- **M-series** — an ad-hoc pivot to smaller (~10-unit) micro-clips at faster iteration speed,
  replacing the R4 stretch test. M1 (bolts 3,059) filled in 12s, M2 (bolts 3,069) in 54s, M3
  (anglerfish 2,498) in 118s; M4/M5 still open. These weren't pre-registered with a hypothesis
  before placement, so they're useful as extra fill-time data but not part of the original
  prediction scoring.

**Design correction (2026-07-16, Ben):** R2/R3/R4 on the SAME item are NOT independent parallel
tests — the GE matches a buyer against the CHEAPEST compatible sell offer first, so demand that would
clear at R3's price also clears at R2's (cheaper) price, meaning a higher rung can't fill before a
lower one does. **Corrected design: a rolling 2-deep queue, not simultaneous-3 or fully-serial.** R2
and R3 rest at the same time (R3 is naturally "next up," queued behind R2 by price — no need to wait
for R2 to place R3). Once R2 clears, R4 gets added behind R3, so there are always exactly two rungs
resting: the one currently absorbing demand and the one queued behind it. R4 was cancelled ~20min in
because all three were live from the start with nothing yet cleared — the queue hadn't advanced
enough to justify a third rung resting. It'll be re-placed once R2 clears and R3 becomes the front.

**Scoring, once the window closes:** compare `timeToFillSec` (or `expired`) per rung against the
predicted class. A clean result (predictions ordered correctly: R1 fastest, R4 slowest/most-likely-
unfilled) supports the existing reach-fold ordering; a surprise (e.g., R3 filling faster than R2, or
R4 filling at all) is the actual calibration signal the volume-tiered reliability discount and the
PB5 recency window should be tuned against — not a guess.

**Honesty (rule 4):** n=1 experiment, 2 items, one point in time. This validates or challenges the
model's *ordering* on these two specific thin books, not a general reliability curve. Repeat before
trusting any derived constant.

## The 2026-08-04 archive studies

Read-only research studies over the `/1h` SQLite market archive (`pipeline/lib/market/archive.mjs`),
run in one session to answer questions that came out of the Spider cave teleport lane closing. Each is a
`*-study.mjs` script plus a `*-FINDINGS.md` written report. None of them gates, scores, or writes anything
the pipeline reads — they exist to settle a question, and their conclusions live in prose, not in code.

- **`dt4-window-gate-study.mjs` → `DT4-WINDOW-GATE-FINDINGS.md`** — does a per-item split-half
  reliability gate select the items whose diurnal dip/peak window actually holds out of sample? **Yes, and
  this one SHIPPED** (unlike the studies below it, which are pure null results): it became DT4 /
  `windowReliability` on 2026-08-10 — CHANGELOG 0.72.0. Gate = parity split-half Pearson r on the
  de-trended 24h shape, `min(rLow,rHi) ≥ 0.6`. The findings doc carries TWO rounds of self-correction (an
  estimator bug and an asymmetric denominator found in review), plus a build-time addendum recording that
  the plan's implementation spec was not implementable and that the gate this replaced —
  `hourConcentration.clean` — measures nothing. Read the addendum before touching the gate.
- **`flow-crossover-study.mjs` → `FLOW-CROSSOVER-FINDINGS.md`** — does a net-order-flow crossover
  (`lowPriceVolume` dominance flipping to `highPriceVolume` dominance) mark a price bottom? **Clean null.**
  65 days, 1,968 items, 2,314 events: 60.2% hit vs a 52.9% base rate = lift 1.14, against a wrong-direction
  placebo of 1.08. Lead-time distribution flat across ±7d; forward returns run the wrong way. Verdict: no
  flow gate, column, or alert.
- **`volume-vs-band-study.mjs` → `VOLUME-VS-BAND-FINDINGS.md`** — does high trade volume mean a thin band?
  **Yes across items, no within one.** Controlling for the price-level confound (ρ(volume,price) = −0.561,
  ρ(price,band) = −0.506), ρ(volume, band) runs ≈−0.85 to −0.905 in the middle deciles (4–7) — at equal
  price, volume very nearly determines band width. It weakens sharply at BOTH extremes (decile 1 −0.507,
  decile 10 −0.368), and decile 10 is the big-ticket lane — so the strong claim does NOT cover the class
  Ben actually trades. But *within* a single item day to day the sign flips positive
  (median ρ +0.153, 77% of items): a liquid item is efficiently priced, while a liquid *day* is a volatile
  day. Pooled + per-decile + per-item Spearman; `--json` for machine output.
- **`edge-map-study.mjs` (+ `edge-map-lib.mjs`) → `EDGE-MAP-FINDINGS.md`** — four workstreams over one
  shared 132k-row item-day panel (`--section a|b|c|d`, `--json`). **A:** realized P&L vs pre-buy
  characteristics, item-clustered with strictly trailing joins — our own book independently supports a
  liquidity floor near ~600/d min-side. **B:** liquidity-gate placement plus the sparse-print artifact test,
  which came out **inverted** — thin items are not print-sparse at the hourly grain (17–23 two-sided hrs/day),
  and their wide bands are real prices at ~2–3 units of depth, so the gate protects against a size mirage,
  not a measurement artifact. **C:** does volume lead band? **Clean null** — hit rate equals the base rate
  (50%) against a band-persistence control at 71%. **D:** the price × volume exclusion map, every candidate
  rule strike-checked against our own realized lots (three proposed, three rejected on 7-figure strikes).
  `edge-map-lib.mjs` is the shared panel builder + stats helpers, consumed only by the study; it caches the
  panel to the gitignored `pipeline/.cache/edge-map-panel.jsonl` so reruns take ~2s instead of re-walking
  ~4.9M archive rows (`--no-cache` regenerates).

All three describe **one 68-day window (2026-05-29 → 2026-08-04) with no out-of-sample split** — descriptive
of that window, not predictive. Nothing in them has been encoded into a gate or a default.

## The 2026-08-09 bid-depth baseline

- **`bid-depth-baseline-20260809.json` → `BID-DEPTH-BASELINE-FINDINGS.md`** — the control record for
  Ben's live overnight test of the −5% queue-wall hypothesis (`plans/PLAN-BID-DEPTH-5PCT.md`): all 8
  resting buy offers captured at 2026-08-09 10:32 UTC against **both** anchors — the GE guide price and
  the live instasell — with the print ages that make the comparison trustworthy (4–13 min, inside
  `QUICK_FRESH_MIN`).

  Captured **by hand, because the pipeline cannot reproduce it after the fact.** Nothing persists the
  guide price at time T: the archive schema has no guide column, `pipeline/.cache/guide.json` is a
  10-minute-TTL snapshot overwritten in place, `pipeline/.guide-history.jsonl` holds only 26 real
  re-anchor events across 17 items (one item clears the n≥3 honesty gate), and `suggestions.jsonl`
  carries the field on 0 of 13,401 rows. Without this file the experiment would have been unmeasurable —
  the same reason the ~6,790 historical fills cannot be replayed against guide.

  **The finding:** guide diverges from the live print on every item, −5.04% to +2.56% — a spread wider
  than the 5% effect being hunted, and signed in *both* directions (Irit leaf's guide sits *below* live).
  Measured against guide, 6 of 8 bids sit past −5%; against live instasell, only one does. The two
  anchors make opposite predictions from the same 8 offers, which is what makes the night discriminating.
  INFORM-ONLY, n=8, one night — it establishes that the measurement question is real, not that the wall
  exists.

## The 2026-08-11 floor-strategy re-measurement

- **`floor-strategy-study.mjs` → `FLOOR-STRATEGY-FINDINGS.md`** — is "this item is at its N-day low"
  (N ∈ 1/3/7/14/30) a buy signal? **No.** A RE-MEASUREMENT, not a fresh investigation: Ben asked a
  near-identical question one day after PLAN.md's `DL-0/DL-1–3` row closed it as a measured
  negative, so this was run under a different construction to see whether that closure survived a
  second look. It does, cell-for-cell. `--section a|b|c|d`, `--json <path>`; read-only over the `/1h`
  SQLite archive via `pipeline/lib/market/archive.mjs`, tax from `js/money-math.js`; writes nothing
  the pipeline reads. **Not runnable on a clean checkout** — it needs the local archive and a
  populated `mapping.cache.json` (it now fails loudly on a missing mapping rather than degrading
  silently).

  **The finding:** an N-day low is a real, robust, *relative* signal — deeper and longer lows predict
  better forward drift than the same day's cross-section, monotonically in N (+0.31pp at 1d →
  +1.26pp at 30d for the "printed a new low" form), surviving an entry-lag control — **and it is not
  a trade.** The best absolute after-tax round trip, under the most generous execution assumption
  available, is **+0.26% over a 7-day hold** ≈ 15k gp/day on a 40m position, against the scan's
  250k gp/day attention floor. The prior art is already shipped: `termStructure` computes
  `pctInRange` at exactly 1/3/7/14/28d, so the gap was only presentational. **Don't build it.**

  **Read the retraction banner before quoting anything from §3 or §4.** An adversarial review found
  25 defects and overturned two of the three headline claims. Retracted: "a falling floor pays
  better" was one cherry-picked cell of six (the sign flips with the signal definition — rising wins
  4 of 6, falling 2 of 6), so **slope is unavailable as a discount-vs-knife discriminator**, neither
  supporting nor refuting the knife hypothesis. Partially retracted: the §4 drawdown-depth
  "refutation" rested on a test whose confirming outcome was algebraically guaranteed
  (`netPatient ≈ (1+spread)(1+drift)(1−tax)−1`, so any spread-sorted bucketing must show net
  tracking spread — the exact failure rule 11 names), and on a silent weighting switch: on per-ITEM
  medians the directional gradient *survives* monotonically (+0.17% → +1.96%). §4 now ends
  **unresolved**. The verdict is unchanged because it rests on §1/§2 (absolute magnitude), not on
  any discriminator.

  **Sample honesty:** 5 non-overlapping 7-day windows, ~2.4 non-overlapping 30-day trailing windows
  per item, one regime. Consecutive item-days at a 30-day low are not independent, and `new30` flips
  sign once de-overlapped. Under the shipped liquidity gate the sample holds **0 items priced
  1m–10m** and 1 above 10m — ~80% is 1k–10k commodities — so it **cannot speak to the big-ticket
  class Ben actually trades**. The review also found `LIQ_TWOSIDED_FRAC` is dead code that can never
  bind, and that 3,500 is PLAN-VOL24's `FLOOR`, not "the S1 gate".

## The 2026-08-11 range-persistence study

- **`range-persistence-study.mjs` → `RANGE-PERSISTENCE-FINDINGS.md`** — Ben's ask: *"if an item
  typically oscillates between two ranges and then is at the bottom, isn't it reasonable to suspect
  that it will rise again?"*, framed by him as "the value strategy but with less speculation".
  **Answer: DON'T BUILD.** Read-only over the `/1h` SQLite archive; canonical tax from
  `js/money-math.js`, `breakEven`/`quantileSorted` from `js/quotecore.js`, the same q15/q85
  `js/termstructure.mjs` ships, and the REAL `valueGate`/`valueTier` for the comparison arm. Writes
  nothing the pipeline reads. **Not runnable on a clean checkout.**

  **Design:** rolling-origin walk-forward (fit [T−28, T−1] → read T → enter T+1 → exit T+1+H) chosen
  over a 50/50 split-half, which 74 days cannot support. Six arms; **arm F (same ≥6% amplitude,
  repetition condition removed) is the load-bearing control** — arm A bundles two conditions and A−F
  is the study's actual question. Section D1 reproduces the in-sample circularity defect deliberately
  (46.2% vs 99.8% reach).

  **Findings:** the traversal criterion IS selective (26.2% of item-origins vs `oscillationVsKnife`'s
  98.4% at the same window) and still buys nothing — within-item A−F is null in 6 of 6 cells (max
  |t|=1.2), the amplitude-matched persistence lift is 0.70–0.83 (it *anti*-selects), and a 2-day entry
  lag turns the excess negative. It does not beat the shipped value lane (+0.55%, t=0.3). `netPatient`
  is ~59% spread; use `excessNet`/`driftLo`. **Big-ticket is absent** — zero arm-A items above 100k gp
  under the shipped units gate, 3 above 10m under a deliberately loose one — so Ben's multi-week
  oscillator question is left UNMEASURED, not refuted. Honest n: 41 non-overlapping entries across 36
  items (strict gate), one regime, cross-item dependence not handled — every t is an upper bound.

  **The incidental finding is the durable one:** `oscillationVsKnife`'s OSC label is a function of
  series LENGTH (`OSC_MIN_LEGS` is an absolute count) — 59.5% at 14d → 99.9% at 60d on the archive,
  and independently 63% → 100% by 30d on a synthetic driftless random walk with no cycle at all,
  identical across 3%/6%/12% per-step amplitude. Recorded as a don't-rebuild note in the function
  header, README's `js/forecast.mjs` entry, and `plans/PLAN-OSCILLATION-CYCLE.md`'s F-H row (whose
  "feed it a deeper archive series" follow-up is the live trap).

  **Read the correction banner first.** Two adversarial passes overturned seven headline claims (a
  false cross-study reconciliation with the floor study — same archive/window/feed, not independent; a
  ratio-of-medians "decomposition"; a placebo answering a different estimand; a paired control
  distorted by disjointification; a population error; an over-strong monotonicity claim) and found two
  real script bugs (a 15-day window called 14-day; leg lengths measured from the wrong anchor). The
  **verdict survived**; the numbers were re-derived. **The archive is LIVE** — counts move between
  runs; the script header is the authority, not the doc.

## `amp-cycle-reproduction.mjs` — did the DT1 amplitude study actually hold up? (2026-08-09)

A REPRODUCTION harness, not a study. Runs THREE columns on the same items and the same 1h
archive: (a) the day-grain `cycleCompletion` shipped in DT1, whose levels come from the same 14-day
window it then scores, and (b) the DT1 study's own design — `amplitudeRanges` levels fitted strictly
before each origin day (`p.timestamp < midnight(T)`, 15-day warmup), entry = the first day-T hour at or
below `ampBid`, completion = any later hour reaching `ampAsk` within 24h/96h; and (c) the SHIPPED
`ampWalkForward` itself, so a regression inside the production function moves a number here rather than
only in the reimplementation.

Written because the two disagreed by ~4× and it was not clear which was wrong. **The study reproduces
exactly** — Saturated heart 0.0% @96h (n=41) and Masori chaps 12.9% @24h (n=31) against its published
0% and 12.9%. The day-grain version reads 100% and 85.7% on those same items. The defect is CIRCULARITY:
median-of-the-scored-days levels are cleared by ~50% of those days by definition, and a multi-day horizon
compounds that to ~94%. This is why `pFillAmplitude` briefly reported an honest n=0 prior rather than the
in-sample figure — and why the out-of-sample design (which separated these 4 pre-build items 0% / 24% / 42% / 48% @96h)
became `ampWalkForward`, the production estimator shipped in **DT1b** the same day — which the harness
now runs as a THIRD column, so a regression inside the shipped function moves a number here. Reading the
output: cols 2 and 3 AGREEING is healthy (independent implementations of one design). Col 1 converging on
col 3 ⇒ the pre-origin fit broke in the shared `amplitudeRanges`/`windowStats` helpers; col 3 diverging
from col 2 ⇒ a regression inside `ampWalkForward`.

Reads the archive READ-ONLY and `js/` production code; writes nothing. Re-run:
`node pipeline/experiments/amp-cycle-reproduction.mjs`. SELF-CONTAINED as of 2026-08-09 — it loads
`pipeline/lib/market/archive.mjs` + `archive-series.mjs` directly and runs on a clean checkout (it briefly
depended on a session-scratch `hp-lib.mjs`, which is why two production headers cite it).

## The 2026-09-08 WK1 weekday-split study

- **`wk1-weekday-split-study.mjs`** (PLAN-WEEKLY-CYCLE §0, decisive measurement 1) — do the
  amplitude lane's own walk-forward entries complete at different rates by LOCAL entry weekday?
  Uses the PRODUCTION `ampWalkForward` with its opt-in `collect:true` per-entry detail (added for
  this study; aggregates byte-identical), 65 items = watchlist ∪ the plan's §1 five ∪ the DT1b
  validation four, 120d of the 1h archive, board defaults (4d horizon, 0.5/0.5 quantiles).
  **Decision rule PRE-REGISTERED in the script header before the first run** (within-item
  permutation test, seeded; α=0.05 on either a pooled or an item-aligned statistic; a ≥100 pooled
  judged power floor separating "null" from "underpowered"; the Wednesday game-update confound
  deferred to measurement 2 by construction).

  **The null branch fired.** Completion by entry weekday: 28.2 / 27.3 / 28.2 / 28.5 / 29.4 /
  28.6 / 29.5% (Sun–Sat), pooled 28.5% on 2,958 judged entries — a 2.2pp spread ≈ one naive
  binomial se per bucket. S1 p=0.9945, S2 p=1.0000. The p≈1 (flatter than chance) was
  investigated, not shrugged off: consecutive entries share overlapping 4d horizons, and measured
  lag-1 outcome agreement is 86.2% vs a 64.4% per-item pairs-weighted independence baseline
  (ρ≈0.61 — the script prints these; an earlier prose draft quoted a 59.2% pooled-rate baseline,
  which double-counts item mix, corrected in review) — outcome runs smear evenly across weekdays,
  deflating the statistic and cutting effective n to ≈712 (~102/bucket, per-bucket se ~4.5pp — so
  effects of several pp are not excluded). The i.i.d. p-values are not literal; the raw flatness
  is the finding. Entry counts are also flat — trough-touches don't cluster on Tuesdays. The raw
  net-if-completed spread by weekday is item MIX: within-item centered it is −1.1…+1.7pp, max
  1.6 se from zero — consistent with noise across 7 buckets (also printed).

  **What it means and does not mean:** it does NOT refute the plan's §1 basket price-level cycle;
  it shows the lane's trough-touch entry already conditions on level, and given that, no weekday
  structure is detectable at this grain in its completion record (a Tue entry rides the §1 up-leg
  and completes at 28.2%; a Sat entry rides the down-leg and completes at 29.5%). Per the pre-registration, measurement 2 is not
  motivated by this record and measurement 3 (full-universe period+phase on LEVELS — a different
  statistic) decides the program. Limits: median-quantile entries only (deep-quantile not split —
  recorded as a limit, not rerun), touch proxies, one archive era. `--json <path>`; needs the
  local archive + a populated `mapping.cache.json`, so it does NOT run on a clean checkout.
  Freely deletable; nothing imports it.

- **`wk2-period-phase-universe.mjs`** (PLAN-WEEKLY-CYCLE §0, decisive measurement 3 — the program
  decider after WK1's null) — over the full universe, which items cycle at the day scale on price
  LEVELS, at what period and phase, calendar-locked or free-running, and does the structure
  survive basket subtraction (item vs one-market-index, plan §6)? ONE bulk SQL aggregate → daily
  mids (local days), 15d-centered detrend (passes the 3–14d claim band near-uniformly where §1's
  7d window would attenuate the top), max-R² sinusoid detection on a 0.25d period grid, AR(1)
  red-noise surrogate null (binned by (r1, n), 10k seeded draws — the WK1 lesson that i.i.d.
  nulls overcall periodicity on red series), BH-FDR q=0.05 per family (raw / basket-subtracted).
  **The decision rule landed as its OWN commit before the first full run** (`b34bc7d` — closing
  WK1's single-commit pre-registration gap); only no-branch spot smokes preceded it.

  **Branch (c) fired on the corrected rerun: ZERO FDR discoveries of 2,516 — measured, too thin,
  don't build.** ⚠ The FIRST run reported branch (a) (193 discoveries, 83 clearing every floor);
  adversarial review found the null was never passed through the MA15 detrend — the filter's gain
  (up to ×1.22 at P≈10.5d, suppression above 15d) concentrates FILTERED noise exactly where the
  "discoveries" massed, and an end-to-end probe showed pure red noise produces ~220–310 false
  discoveries through the broken instrument, more than the 193 observed. Corrected (C1–C3 in the
  script header, kept as dated retractions): surrogate mids now go through the SAME
  deviations()/MA15 pipeline with φ matched on the filtered lag-1; the weekday +1 local/UTC bug
  is fixed; the header's "near-uniform band gain" claim is retracted (amplitudes carry ≤22%
  filter inflation + winner's curse). Under the honest null the basket is not significant
  (p=0.586 — §6 answered: not one index) and the residue is the locked weekly set at p<0.05,
  inform-only: Old school bond (p=0.0014 raw / 0.0002 basket-subtracted — the SUB-family's
  smallest p — trough SAT, p2t 4.2%), Mole skin (p=0.0050, trough SUN, ~330m gp/d), Toxic
  blowpipe (p=0.036, trough TUE); Osmumten's fang is suggestive-only (p=0.060, trough TUE —
  exact §4 agreement — but ≈0.106 under the round-2 persistence-matched null: the surrogate
  family's filtered lag-1 saturates at ≈0.61 and ~28% of items, all residue items included, sit
  above it where the null is anti-conservative — stated limit in the script's C1 block, branch
  (c) unaffected a fortiori). Not distinguishable from multiplicity (these 3 weekly-band items
  at p<0.05 vs ~6 expected by chance), and an FDR resolution floor applies (min achievable p
  1e-4 > the BH single-discovery threshold 2e-5 — no lone item could clear FDR at 10k draws;
  only a cluster could, and none did). §1-five: crossbow p=0.89 / ring p=0.66 (their §4 weekday rows were
  fitted noise — a STRONGER call under the corrected test); hilt p=0.049 at 14d, not a
  discovery. §1's five-item BASKET result is a different statistic and is not contradicted — it
  just doesn't generalize. Limits: one era, touch mids, filter+selection-inflated amplitudes;
  zero-discoveries partly reflects the resolution floor, not proof of absence. First-run numbers
  survive only in `git show fd3f769` and are not to be quoted. `--item`/`--limit` spot modes
  print no branch; `--json <path>`; needs the local archive + a populated `mapping.cache.json`,
  so it does NOT run on a clean checkout. Freely deletable; nothing imports it.

- **`wk3-class-cycle-study.mjs`** (PLAN-WEEKLY-CYCLE WK3 — the owner's class question, amended
  before any run by the yield reframe: judge whether an item is advantageous to buy and measure
  the yield as it fluctuates; no concrete cycle needed) — machinery copied from
  `wk2-period-phase-universe.mjs` @ `9fb2cd9` (C1/C2-corrected; WK2 is top-level, not
  importable). Metadata-only taxonomy (name + GE limit + archive era-mean mid; 10 named classes
  + unclassified, first match wins, 10 seeded samples printed per class; the §1 five qualify for
  `bigticket-lowlimit` by metadata, never enumeration). PRIMARY TEST Y: per item-day, deviation
  from the item's own STRICTLY TRAILING 15d mean (the centered detrend is lookahead — stated as
  disqualifying for a buy signal), bucketed by depth; forward after-tax mid-to-mid net at
  2/4/7d; advantage = item-paired conditional minus that item's own unconditional mean, t across
  items (kills overlapping-window dependence; cross-item same-day correlation stays a stated
  limit); BH q=0.05 over the 3 deep buckets × 4d decision cells; knife classes = significantly
  NEGATIVE deep-bucket advantage. Lane-increment check: advantage recomputed on bucket-days at
  or above the item's own era-p10 deviation (sub-p10 ≈ days the amplitude lane's trough-touch
  entry would already catch). **Pre-registered outcome (i) fired: 8 of 10 named classes show a
  BH-significant deep-dislocation advantage (≤−7% bucket: potion-dose +8.3pp, ammo +4.8pp,
  bulk-commodity +9.6pp, midvalue-lowlimit +1.8pp, bigticket-lowlimit +1.8pp over per-item
  baselines) — of the six that cleared the registered beyond-lane split, FOUR are robust under
  the review's honest TRAILING split (ammo t=4.3, herb t=5.0, bones-ashes t=7.8/3.4,
  midvalue-lowlimit t=5.9; encoded in the post-registration block) and TWO are unresolved
  (potion-dose t=1.0, bulk-commodity t=1.2 — magnitudes hold, significance does not); NO knife
  class cleared the registered bar (seed-sapling's −1.79pp p=0.025 near-miss noted); the
  elevated ≥+4% bucket is significantly negative nearly everywhere — the sell-side mirror.**
  ⚠ Caveats govern every number: deep-bucket conditional yields on thin/cheap classes are
  inflated by a daily-mid COMPOSITION artifact (a −7% mid print on a thin item is often
  one-sided trades, and its "recovery" is not a fill you can buy — and the paired advantage does
  NOT defend against this: the encoded volume-conditioned column shows the deep-dip edge mostly
  COLLAPSES on ≥median-volume days in the beyond-lane classes, herb the survivor, while the
  lane-confined bigticket cell survives), the honest actionable magnitudes are the encoded
  LAG-1d-ENTRY numbers (potion +4.9pp, ammo +3.3pp, herb +3.4pp, bones +0.7pp at its significant
  (−4,−2] cell — the deeper cell's +2.6pp never cleared BH — midvalue +1.6pp,
  bulk +6.6pp — same-day is the descriptive upper bound), and mid-to-mid at the daily mean mid
  is not an executable price — the profile RANKS classes and buckets, it does not promise
  returns; the next chunk's surface design must price executability (liquidity floor, bid-side
  entry, spread, volume-conditioned yield beside unconditional).
  Secondary: class baskets under persistence-matched nulls (AR(1) below the r1≈0.61 ceiling, a
  bisection-tuned MA-innovation family above it) → NO basket FDR discovery in either family; MW
  enrichment: bigticket/herb/raw-material BH✓ toward-cycle (with r1-saturation caveats), five
  classes DEAD at this resolution; §1's five reproduce (+1.26%/wk, t 4.33 vs the reported 4.48)
  and the 118-member metadata gear class CONFIRMS diluted (+0.36%/wk, t 2.18, one-sided α=0.05
  — §1's single registered prior). Decision rule committed before the run (`9eb2743`);
  `--audit`/`--limit` smokes are structurally unable to print class results; `--json <path>`;
  needs the local archive + a populated `mapping.cache.json`, so it does NOT run on a clean
  checkout. Freely deletable; nothing imports it.

To retire these experiments: delete `pipeline/experiments/` — with ONE exception. `amp-cycle-reproduction.mjs`
IS referenced: `js/amplitudescreen.mjs` and `js/estimators/families.mjs` both name it as the validation
source for ranking on the walk-forward, so deleting it orphans two production headers. Everything else in
here is genuinely free-standing.

## weekday-phase-confound-study.mjs

`PLAN-WEEKDAY-PHASE-CONFOUND` §2 — the motivating measurement, **not** the registered test (§3).
Asks whether a fitted floor/ceiling slope is confounded with weekly phase: a slope fitted over a
window that is not weekday-balanced runs from whatever phase it starts in to whatever phase today
is, so a window ending on the measured trough day (Tue) biases the fitted ceiling negative. Two
weekday-aligned statistics per item — same-weekday week-over-week change in the daily HIGH (strips
phase by construction), and the daily mid detrended against its own 7-day *centered* mean bucketed
into weekend vs Tuesday.

Defaults to the five-item big-ticket gear basket `PLAN-WEEKLY-CYCLE` §1 was built on;
`--items <id,id,...>` and `--days N` override. Read-only against `pipeline/.market-archive.sqlite`,
run from the repo root.

**The numbers live in the plan (§2), not here** — and they are motivating only: overlapping centered
means induce serial dependence, so the nominal n is ~6× the independent-week count and the printed
t-values are optimistic. The basket is also the same one WK's §1 selected, so this is not an
out-of-sample confirmation of anything. Do not cite its output as a result; it exists to justify
running §3.

## hold-duration-lane-study.mjs

`PLAN-WEEKDAY-PHASE-CONFOUND` §7a-CORRECTED — the retrospective lane split behind the owner's
weekly-large-vs-rapid-attentive question. Buckets non-banked closed lots from `positions.json`
by HOLD DURATION and reports four views, each of which exists because omitting it produced a
wrong answer the first time: **win/loss decomposition** (net totals hid 28 winning 12–24h lots
behind a loss cluster), an **era split** (early / late / last-30-days — the record spans heavy
strategy change and is not stationary, and the long buckets are POSITIVE in the last 30 days),
the **named long-hold lots** top and bottom, and **weekday keyed to BOTH buy and sell, split
same-day vs multi-day** (392 of 470 lots are same-day, so a pooled sell-weekday table mostly
restates same-day trades and says nothing about the multi-day lane).

**DESCRIPTIVE ONLY — hold duration is ENDOGENOUS.** A losing position is not sold in three
hours, it sits, so "long holds lose money" is substantially "losers become long holds" and the
causal arrow may run backwards. The 2–7d bucket carries n=8: the strategy the question is about
has essentially never been run. Read §7a-CORRECTED before quoting any row — it also retains the
superseded first version as a worked example of the pooling failure. The forward test that can
actually settle this is §7b, and it exists because this script cannot.

Read-only against `positions.json`; no archive fetch, no network.

## wpc-label-study.mjs

`PLAN-WEEKDAY-PHASE-CONFOUND` §3+§6 — the REGISTERED test (chunk WPC; plan committed
b7e294d, this script committed 2ce9be3, both BEFORE the first run; firing thresholds are
fixed in the script header). Reconstructs the trend-read labels per item-day by calling
the real `floorCeilingTrack` (js/windowread.mjs) on the last 20 completed local daily
buckets ending day t−1 — strictly trailing, day t excluded from its own reference — with
regime `falling` = the real `REGIME_FALLING` mapping and `classifyItem` imported from
`pipeline/lib/signal/dislocation.mjs`. Deviation/forward-net machinery copied from
`wk3-class-cycle-study.mjs`; inference is item-level only (per-item means first, then t
across items — overlapping 4d horizons forbid pooled item-day t's). `--all-mids` is a
labelled post-registration supplementary (0761dd8) that drops the mid≥100k universe floor
so the §6 answer also covers ammo/herb/bones-ashes; it decides no branch.

**Result (run 2026-09-08, confirming rerun 2026-09-09 — both null branches fired):**
**§3 → (iii), H1 refuted** — no Mon–Wed label excess (the wide universe is significantly
OPPOSITE to H1), the slope's weekday gap is under the bar with a dummy pattern that
contradicts H1's mechanism, and the labelled forward-yield tilt (+0.48pp/4d, t=2.47)
misses its threshold; the 2026-09-08 crossbow case was a single-item coincidence.
**§6 → (iv), subsumed** — 0 of 16 registered (and 0 of 48 supplementary) class × bucket
cells BH-significant at q=0.10: within a dislocation cell the falling label moves the
forward 4d read by nothing measurable, while sitting on ~31% of all tradeable-universe
reads. The pre-named hazard cells (elevated × labelled, bigticket falls) are directionally
negative but nothing survives BH and the at-volume split attenuates them. Full numbers,
deviations from the registration, and limits: the plan's §3+§6 RESULTS section — do not
restate them here. Read-only against `pipeline/.market-archive.sqlite` +
`pipeline/.cache/mapping.cache.json`; inform-only, gates nothing.

## avghigh-bias-study.mjs

`PLAN-AVGHIGH-BIAS` — the registered instrument (plan committed ff944a0, this script
committed before its first run; bars restated in the script header from the plan, which
owns them). Joins `positions.json` `closed[]` non-banked realized sells to the same-hour
1h archive bucket (`archive.mjs` `seriesFor`, read-only) and measures whether
`avgHighPrice` — the hourly AVERAGE of high-side prints — understates what the market
paid: (a) the hpv==1 instrument-validity gate, (b) same-hour exceedance descriptives by
`highPriceVolume` tier and class, (c) the branch decider — sells beating the local day's
max hourly `avgHighPrice` by ≥1%, per tier × era (last-30d vs earlier), per-item-first.
Deterministic offline join (a rerun reproduces exactly; instrument confidence rests on
(a)). Numbers live in the plan, not here; inform-only, gates nothing.
