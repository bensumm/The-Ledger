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

To retire this experiment: delete `pipeline/experiments/` entirely. Nothing elsewhere references it.
