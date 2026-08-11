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
  near-identical question one day after `plans/PLAN-DAY-LOW-SURFACING.md` closed it as a measured
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

To retire these experiments: delete `pipeline/experiments/` — with ONE exception. `amp-cycle-reproduction.mjs`
IS referenced: `js/amplitudescreen.mjs` and `js/estimators/families.mjs` both name it as the validation
source for ranking on the walk-forward, so deleting it orphans two production headers. Everything else in
here is genuinely free-standing.
