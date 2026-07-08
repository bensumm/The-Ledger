# PLAN-VALUE — `--mode value`: the buy-hold value niche

**Goal:** a new screen niche that surfaces items to **buy near a multi-week low and HOLD for the
range to cycle back up**, rather than flip fast. The edge is **one tax-paid sell of a big move**, not
many small taxed flips — structurally tax-efficient (2% paid once per cycle, not per lap). Ben's
framing (2026-07-08): "our current niches highlight things to turn over fast NOW; this highlights
things to buy and hold, knowing the price will run up. Fewer small flips = less tax."

Status: SPEC. Unproven theory (n≈0, rule 4) — everything below ships OFF-by-default and
provisional until the firing log (PM2) accrues evidence. Pipeline-only unless an app surface is
added later (that would bump APP_VERSION).

## Why a NICHE, not a probe (the load-bearing distinction)
- A **probe** only ANNOTATES rows the shared bouncer already passed — it can't gate or rank
  (PM1 invariant). A **niche** brings its OWN gate + edge; it selects and ranks.
- Value candidates would be **thrown out by the current bouncer**: the 500k **gp/day** attention
  floor is a *throughput* test, and a great slow-hold item has low daily throughput but big cycle
  appreciation. A probe can't rescue a gated-out item; a niche defines its own entry rules. So value
  MUST be a niche (its own gate), which is exactly why "add a mode" is the right call over "add a probe."
- (A `⏳value-low` observe-probe MAY still exist later to *annotate* value-lows that show up on the
  FAST screens — "this fast-flip item is also at a multi-week low" — but that's a nice-to-have, not
  the strategy's home.)

## Pipeline design — reuse the shared stack, swap the gate + edge (the GC1 seam)
`value` is a new `mode` inside `gateCandidates(mode, ctx, thresholds)` + a post-fetch value gate in
`renderMode` + its own output table. Steps 1 (universe), 4 (fetch), 6 (rate) are shared. What changes:

### A. Candidate gate (step 2/3 — value-specific)
Keep: two-sided liquidity (`hpv>0 && lpv>0` — must be exitable). Change:
1. **Drop the 500k gp/day throughput floor.** Replace with a **cycle-amplitude floor**: the
   multi-week `(high − low)/low` after 2% tax must clear `VALUE_MIN_CYCLE_PCT` (placeholder ~5–6%) —
   enough that one tax-paid sell of the full move nets meaningfully. Amplitude, not daily velocity, is
   the value edge.
2. **Lower the liquidity floor vs fast-flip** (you hold for days–weeks, not minutes, so you need
   *eventual* exitability, not fast churn): `limitVol ≥ VALUE_LIQ_FLOOR` (placeholder, well below the
   fast-flip floor) OR the gp-flow path. Still must be genuinely two-sided.
3. **Reject a real downtrend / falling knife.** This is NOT the blanket falling-exclusion (a value
   low often reads flat/slightly-soft). Use `phase()`: ACCEPT `base` / `basing` / flat / rising;
   REJECT `decay` (lows STILL stepping down — a knife) and a long-range multi-week downtrend. "Buy the
   base, never the knife."

### B. The edge / score (step 3 — how to rank)
Rank by an after-tax, hold-aware value score, roughly:
`valueScore = afterTaxCycleAmplitudePct  ×  proximityToLowWeight  ×  floorStabilityWeight`
- **afterTaxCycleAmplitudePct** — `(sellCeiling·0.98 − buyLow)/buyLow`, the profit if you catch the
  full cycle. The headline number.
- **proximityToLowWeight** — how close LIVE sits to the multi-week low right now (0..1; at-the-low =
  1, mid-range = lower). Ranks the *buyable-today* items above the *wait-for-a-dip* ones. (Don't GATE
  on proximity — surface mid-range candidates too, but show the proximity so the reader picks.)
- **floorStabilityWeight** — how durable/defended the floor is: flat recent lows (small `lowSlope`) +
  `basing`/`base` phase + the multi-week low consistent with the long-range base ⇒ higher weight.

### C. Multi-range TERM STRUCTURE (Ben's explicit ask — decided: 1/3/7/14/28d)
Compute the **low AND high at five ranges: 1d / 3d / 7d / 14d / 28d** (all derivable from the ~21-day
`ts6h` the screen already fetches for `phase()`; extend the fetch to ~28d if needed). The VALUE of the
five ranges is the **SHAPE of the term structure**, not any single number — read the lows (and highs)
across the five and the pattern tells you the regime:
- **Lows flat across all five (1d ≈ 3d ≈ 7d ≈ 14d ≈ 28d)** → a stable range → the classic value-hold:
  bid the range low, hold for the cycle. The safest floor.
- **Lows RISING as you shorten (28d < 14d < 7d < 3d < 1d)** → higher-lows / appreciating / repricing
  up → holdable, and a dip toward the shorter-range low is a buy into strength.
- **1d/3d low far BELOW the 14d/28d lows** → breaking DOWN now (a knife) → REJECT even if the
  14/28d window still looks like a dip. This is the guard the single-window read misses.
The four jobs the term structure does, mapped to ranges:
- **Entry** ← the **14d low** (Ben's core "1–2 week low, hold to profit").
- **Is-it-dipping-NOW** ← the **1d/3d low** vs live (is today actually near the entry, or mid-range?).
- **Safety/durability** ← **14d low ≈ 28d low** (a low that's low across the long ranges is a real
  floor; a 14d low far under the 28d base is a decline).
- **Upside** ← the **28d high** (the ceiling the cycle can run to) + the **14d high** (the realistic
  near-term sell target).
A value pick wants the whole structure to line up: low across the long ranges (durable floor) AND not
collapsing on the short ranges (not a knife). Surface the five-range low/high compactly on each row so
the shape is readable at a glance.

### D. Output (its own table)
`## VALUE — buy-hold near the multi-week low (hold for the cycle)`
Columns (proposed): `Item | Guide | Live | Multi-wk range (low→high) | Live vs low (%) | Cycle net/u
(after-tax %) | Floor (phase · stability) | Hold horizon`.
Playbook line: *"buy near the multi-week low, HOLD for the range to cycle up; the edge is one
tax-paid sell of a big move, not fast churn. State the hold horizon at entry."*
- **OFF by default** (explicit `--mode value` only; NOT in `--mode all`) — the NY2/churn precedent
  until validated.
- Every pick flagged **provisional** (unproven theory).
- Each pick STATES the hold horizon at entry (the peak-throughput labeling rule + Ben's "we hold to
  profit"): call it a multi-day/week hold up front, not a flip.

### E. Honesty + invariants (load-bearing)
- Value picks NEVER feed the fast-flip verdicts/alerts/rating of other niches (isolated, like a probe's
  no-verdict rule).
- All thresholds (`VALUE_MIN_CYCLE_PCT`, `VALUE_LIQ_FLOOR`, proximity/stability weights, the range
  lengths) are NAMED PLACEHOLDERS pending validation — same discipline as `rating.mjs` cutoffs / `phase()`.
- Buy-limit-aware sizing (scan v1.24) applies to every value bid; a deep resting bid LOCKS gp while it
  waits (capital-lock opportunity cost) — recommend the deep-low + a shallower rung ladder so capital
  isn't all idle on the rare deep dip.
- Firing/scoring: log value-mode picks via the PM2 firing-log convention so hit/miss accrues before we
  ever promote it past provisional.

## Build chunks (proposed, small + independent)
- **V-A** `gateCandidates('value', …)` — the value gate (cycle-amplitude floor, lowered liquidity,
  phase-based knife rejection) + the value edge/score. Pure, fixture-tested (`gatecandidates.test.mjs`
  already exists as the home).
- **V-B** multi-range read helper — a pure `valueRanges(series)` (recent/medium/long low·high +
  consistency flag), fixture-tested; reuses `windowread.mjs`/`phase()` primitives, no new market math.
- **V-C** `renderMode` value branch + the VALUE table + provisional/hold-horizon framing; OFF by
  default; PM2 firing-log wired.
- **V-D** docs: `/scan` gets a one-line "value niche" pointer (deferred until it graduates), CLAUDE.md
  niche list + README inventory updated, this file folded into PLAN.md on ship.

## Decisions (Ben, 2026-07-08 — LOCKED)
1. **Proximity → RANK, don't gate.** Surface all stable-amplitude candidates and rank by proximity to
   the low (buyable-today items float to the top; mid-range ones stay as a watch tail). Show the
   proximity; never filter on it.
2. **Ranges → the 1/3/7/14/28d term structure** (low AND high at each) — see §C.
3. **Explicit until proven** — `--mode value` only, NOT in `--mode all`, until the firing log validates
   it (the churn/NY2 precedent).
4. **Console-only** — no app tab, no APP_VERSION; an app VALUE surface is a later, separate step
   (yield-program honesty discipline).
