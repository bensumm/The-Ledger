# PLAN-OSCILLATION-CYCLE — drift-adjusted margin gate for oscillator flips

Per-topic working doc (PLANNING.md lifecycle — folded into `PLAN.md` and deleted when its
last chunk ships). Designed 2026-07-22 (Ben + main), hardened + sequenced by the Fable review
agent against the live code.

## Why

For multi-week oscillator items (Osmumten's fang, Toxic blowpipe — combat gear on a ~6–8 day
cycle, ~10–11% swing), the same-cycle daily flip (buy the evening dip, sell the next-morning
peak, after 2% tax) nets **+2–4%/cycle on the up-leg of the multi-week oscillation but −1–3%/cycle
on the down-leg** — measured this session. The scan's amplitude lane does NOT surface these:
(1) they rank below the top-25 amplitude-proxy fetch cut (`AMP_TOP_DEFAULT`); (2) even fetched,
the current Stage-2 gates drop them (`trend`/`ask-unreachable`) — and the lane has **zero
multi-week phase input** anywhere.

## The corrected mechanism (Ben's ruling, 2026-07-22 — the load-bearing decision)

**The margin comes from AMPLITUDE relative to DRIFT, not from the DIRECTION of the drift.**
We do NOT gate on floor/ceiling direction in either direction:

- **NOT greenlighting rising floors.** Anchor: Aldarium was a rising floor (`compressing-up`,
  +1,147/day) on every scan pass this session and verified as a fading-ceiling ~1% mirage every
  time. Rising floor ≠ winner.
- **NOT vetoing falling floors.** An oscillating item drifting DOWN still has a harvestable flip
  if its daily amplitude exceeds the per-cycle decline + tax — price the exit lower (at the
  drift-adjusted reachable peak, not yesterday's peak). Consistent with the amended per-strategy
  falling doctrine (falling ≠ auto-bad).

Multi-week drift is consumed as a **number**, never a label:
`driftAdjustedPeak = diurnal peak projection + ceilingSlope × cyclesToHold`. The gate is
`afterTax(driftAdjustedPeak) − entry − requiredMargin > 0` — computed **identically whether the
drift number is positive or negative**. This reconciles the fang down-leg losses (drift-adjusted
exit was genuinely below entry → negative margin → correctly rejected) AND the Aldarium
rising-floor mirage (amplitude collapsed → negative margin → correctly rejected) with ONE
direction-agnostic formula.

**R3b (the `floorValidator` relax-direction gate) is DROPPED entirely** — no governance step,
no relax-direction fixtures, no gate-relaxation review anywhere in this program. We are not
gating on floor direction at all, so there is nothing to relax.

**The knife guard stays.** A monotone collapse with no stable oscillation to project a peak from
is a different failure mode (no cycle to harvest) — the existing `knife`/`trend` Stage-2 guard
handles it. The detection line is *oscillating-while-drifting-down* (harvest it) vs *monotone
knife* (drop it).

## Verification carryover (Fable, against the live code — unchanged by the reframe)

- `diurnalForecast` (`js/forecast.mjs`, PF1) already produces next-trough/next-peak with level,
  hour (ETA), and a dispersion-scaled confidence band. **Reuse it** — do not re-derive its math
  (the SIGNAL-RECENCY one-home anti-pattern).
- `floorCeilingTrack.oscillating` (`js/windowread.mjs`) fires only when `classification==='ranging'`
  (flat regime) — it **structurally cannot fire** on a drifting-floor-plus-weekly-bounce shape.
  The drift-aware oscillation-vs-knife detector (Chunk 1) is the genuinely-new piece.
- The amplitude spec declares a `floor: gate` validator that is **dormant** (`renderAmplitudeMode`
  never calls `runValidators`) — a live RC-B instance. It answers an orthogonal ENTRY-side
  "distance above durable support" question; it is **NOT** the margin mechanism. Optional
  inform-mode wire-up only.
- Fusion home = `js/forecast.mjs` (or a tiny new module), NEVER `js/windowread.mjs` — the
  `forecast.mjs → windowread.mjs` dependency arrow is one-way and load-bearing.
- Runtime state (Chunk 4) = a NEW sibling file `cycle-watch.json`, NOT an extension of
  `hold-thesis.json` (already flagged as an overloaded two-store concern, P4a). Follow
  `pipeline/lib/watchstate.mjs`'s `loadState`/`saveState` + `persistMs` arm-then-confirm idiom.
- Honesty joiner = reuse `join-amplitude-outcomes.mjs` (the shadow both-leg replay, upper bound,
  n≈0) — do not build a second joiner.
- The adaptive loop is genuinely NEW, NOT a `--dip`/`flushSignal` extension (DL2 is reactive,
  stateless, no expected-trough persistence).

## Chunks

### Chunk 1 — exit-projection primitive (drift as input, not gate) — FOUNDATION
Home: `js/forecast.mjs`. A thin fusion `{driftAdjustedTrough, driftAdjustedPeak, confidence}`
(NO phase/direction field): pull ceiling-slope as a magnitude+sign number, pull
`diurnalForecast`'s trough/peak (reused as-is), shift the projection by the slope over the hold
horizon. **New sub-piece:** the drift-aware oscillation-vs-knife detector (feeds the EXISTING
knife guard's boolean, not a new gate — so it stops over-rejecting a down-leg oscillator as a
false knife). First confirm whether `diurnalForecast`'s own trend term already applies the
adjustment before building a second one.
- Depends on: nothing.
- Gate/inform: **inform** (a projection number).
- Tests: fang/blowpipe-shaped fixture (multi-week decline + weekly bounce) → detector labels it
  "oscillating, not knife" AND `driftAdjustedPeak` comes out **below** naive `nextPeak.level`;
  mirror up-drift fixture → **above** naive, same code path. Byte-identity check on the
  un-adjusted half against `diurnalForecast`'s existing fixtures.
- APP_VERSION: none (pipeline module, no `js/trends.js` consumer yet).
- Composition vs new: ~65% composition / ~35% new (detector + adjustment arithmetic).

### Chunk 2 — amplitude: shadow-log the drift-adjusted margin (no gating yet)
`renderAmplitudeMode` (`pipeline/commands/screen-flip-niches.mjs`) computes Chunk 1's margin for
every Stage-2 survivor and logs it to the `amplitudeShadow` block (`pipeline/lib/suggestlog.mjs`)
**alongside** the naive `ampBid`/`ampAsk` — computed, not acted on. Existing knife/`trendDominates`
checks untouched.
- Depends on: Chunk 1.
- Gate/inform: **inform** (shadow-logged, nothing reaches the printed table).
- Tests: shadow log carries both pairs; margin computed identically for a same-magnitude
  opposite-sign fixture pair (the direct guard against re-introducing a directional gate).
- APP_VERSION: none (console-only).

### Chunk 3 — amplitude: the margin BECOMES the gate — THE ONLY GATE IN THE PROGRAM
After a short shadow bake, `amplitudeGate` (`js/amplitudescreen.mjs`) gains a `margin-below-floor`
reject computed from Chunk 1's `driftAdjustedPeak` vs entry vs a named placeholder threshold —
**direction-agnostic by construction** (no `if (drift < 0)` branch anywhere). Sequenced AFTER the
existing `ask-unreachable`/`bid-unreachable`/`trend`/`knife` rejects.
- Depends on: Chunk 1, Chunk 2.
- Gate/inform: **GATE.** Review bar = R2/R3: acceptance-fixture diff on `--mode amplitude`,
  before/after row-by-row.
- Tests (the load-bearing regression pins): fang down-leg fixture rejects on `margin-below-floor`
  (correct reason, not "falling"); **Aldarium fixture** (rising floor, `compressing-up`,
  +1,147/day, collapsed amplitude) **ALSO rejects on the same reason** — the concrete disproof of
  the greenlight-rising-floors flaw.
- APP_VERSION: none (console-only), but full acceptance-fixture discipline.
- Honesty: n≈0 placeholder threshold; ships under the amplitude lane's "make-or-break, do not
  trade on this yet" disclaimer.

### Chunk 4 — adaptive monitoring loop (the one genuinely-new engineering chunk)
New persisted per-item state in sibling `cycle-watch.json` (`loadState`/`saveState`/`persistMs`
idiom from `watchstate.mjs`). The prior = Chunk 1's `driftAdjustedTrough`/`driftAdjustedPeak`.
Each `watch-positions.mjs` tick does a tracking-error update (dip shallower/deeper → revise Te /
bid; peak weaker/stronger → step ask down (sell-velocity) / ladder up (ask-headroom)) and appends
an `{expected, actual, adjustment}` triple for calibration. Band-breach → **inform-only ABORT
note** (ALERTS-never-places, `flushSignal` precedent), never an auto-cancel at first landing.
- Depends on: Chunk 1 (prior), Chunk 3 (only track a gate-validated number).
- Gate/inform: **inform** (alerts, never places/cancels).
- Tests: `pipeline/test/cyclewatch.test.mjs` — up-drift AND down-drift tick sequences, symmetric
  code path; persistence round-trip mirroring `watchstate.test.mjs`.
- APP_VERSION: none (pipeline).
- Composition vs new: ~80% new / ~20% reuse (persistence idiom, step-down/ladder primitives).

### Chunk 5 — cross-cutting: drift-adjusted exit on every price suggestion
Fold Chunk 1's numbers into the existing `trajectoryRead`/`floorCeilingTrack` note path so they
appear beside every suggestion (a projected level, never a rising/falling verdict).
- Depends on: Chunk 1; sequence after Chunk 3 proves the arithmetic on the cheap-blast-radius
  amplitude lane.
- Gate/inform: **inform**, display-only.
- APP_VERSION: **LIKELY YES** — reaches `js/trends.js` rendering (like R2/R3). Needs the browser
  smoke, not just `node --check`.

### Chunk 6 — per-thesis integration (drift as input everywhere, no direction gating)
Wire Chunk 1's number into each thesis's per-spec `extra`/validators (R5 `extra.askMargin`
precedent — a registry-line change, never a new `if (mode===...)` branch):
- **value** — informs the value-amplitude proximity read as a NUMBER; explicitly NOT a floor
  relax/un-gate (R3b stays dropped).
- **band** — informs (never gates) the band-top fold; a down-drifting band item sells at its
  drift-adjusted top, priced lower, not excluded.
- **scalp** — sharpens exit pricing on its already-accepted falling regimes; admission unchanged.
- **churn** — a "don't buy near the drift-adjusted weekly high" caution note (magnitude, not
  direction).
- Depends on: Chunk 1; parallel-safe across theses (disjoint `js/flip-niches.mjs` spec entries).
- Gate/inform: **inform** everywhere in v1.
- APP_VERSION: audit `js/validate.mjs`/`js/trends.js` consumption per thesis before assuming none.

## Dependency graph

```
Chunk 1 (exit-projection primitive + drift-aware oscillation detector)
    │
    ├─▶ Chunk 2 (amplitude: shadow-log the margin) ─▶ Chunk 3 (margin BECOMES the gate)
    │                                                      │
    │                                                      ├─▶ Chunk 4 (adaptive loop)
    │                                                      └─▶ Chunk 5 (cross-cutting render, APP_VERSION)
    │
    └─▶ Chunk 6 (per-thesis integration — parallel-safe across theses)
```

Chunk 3 is the ONLY gate; it gates on a **magnitude** (drift-adjusted margin), never a **sign**.

## Status

| Chunk | State | SHA | Notes |
| --- | --- | --- | --- |
| 1 | ✅ LANDED | 53dab35 | driftAdjustedExit + oscillationVsKnife in js/forecast.mjs + oscillation-cycle.test.mjs (8 checks). FINDING: diurnalForecast ALREADY trend-extrapolates nextPeak/nextTrough to their eta (projHigh = baselineNow + trendPerHour·dt + devHi) — so drift over [now→eta] is already baked in; Chunk 1 shifts ONLY by the RESIDUAL horizon max(0, holdHorizonDays − etaDays), making it thin. Inform-only, wired into NO gate. Validated (main): direction-agnostic symmetry pinned, 76 suites + check-imports green. |
| 2 | READY (unblocked) | — | shadow-log the margin; depends on Chunk 1 (landed) |
| 3 | BLOCKED on 2 | — | the only gate |
| 4 | BLOCKED on 3 | — | genuinely-new engineering |
| 5 | BLOCKED on 3 | — | APP_VERSION bump |
| 6 | READY (unblocked) | — | parallel-safe across theses; depends on Chunk 1 (landed) |
