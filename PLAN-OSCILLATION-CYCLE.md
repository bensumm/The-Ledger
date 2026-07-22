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

## Post-landing findings (2026-07-22) — NOT closed; two follow-ups open

All 6 chunks landed, but a walk-forward backtest (fang/blowpipe/dragon boots, trailing-data-only)
surfaced two problems. **This plan does NOT fold into PLAN.md until these are resolved.**

**F-A — `oscillationVsKnife`'s flip-fraction metric is STRUCTURALLY MISCALIBRATED for the target
class (the important one).** The metric counts sign-flips in the *first difference* of the
detrended daily mids. A clean slow oscillation moves in **smooth multi-day runs**
(fang: `+ + + + − − − − + + + + − −` — a textbook ~8-day cycle) → only ~2 flips/period → flip-frac
~0.23 → labeled **KNIFE**. A *jittery* item (dragon boots) alternates day-to-day → high flip-frac
→ **OSCILLATING**. So the 0.4 threshold separates items by **day-to-day noisiness, not by
harvestable multi-week oscillation** — it labels the exact fang/blowpipe class this feature targets
as knives, *including during their profitable up-legs* (walk-forward: blowpipe KNIFE 10/10 days at a
+2.36% mean flip; fang KNIFE 9/10 at +1.74%). This is a **metric redesign**, not a threshold tweak:
a slow-oscillation detector should measure **detrended excursion to BOTH sides of the trend line
over a ~cycle window** (amplitude around the detrend), rewarding the long alternating runs, not
penalizing them. Until then the Chunk-3B knife-temper is unreliable (safe only because it's
console-only, n≈0, behind the "do not trade yet" disclaimer). Evidence is in-sample + n≈1 regime,
BUT the sign-run mechanism is deterministic (a smooth sine inherently yields few first-diff flips),
so the structural conclusion is robust even if the exact numbers aren't calibration-grade.

**F-B — the crowded-out-fetch fix never landed.** `AMP_TOP_DEFAULT` is still 25; fang/dragon
boots/blowpipe rank below the top-25 amplitude-proxy fetch cut, so they never reach the (now
working) margin gate via a normal scan. Fable's original plan had this as a Chunk-2 sub-item; the
reframe dropped it. A follow-up should widen/rework the amplitude fetch admission so the target
class is actually fetched — otherwise the whole lane can't see the items it was built for.

**What IS sound and validated-enough:** the drift-adjusted **margin** economics (Chunk 1–3, 5–6) —
it discounts the stale median peak to the honest forward peak (fang: 18.51m median → 17.87m
forward), so the margin reflects real amplitude-vs-drift-vs-tax. The margin gate correctly admits a
falling-but-oscillating item and rejects a rising-floor mirage. The DETECTOR half (F-A) is the weak
link.

## Status

| Chunk | State | SHA | Notes |
| --- | --- | --- | --- |
| 1 | ✅ LANDED | 53dab35 | driftAdjustedExit + oscillationVsKnife in js/forecast.mjs + oscillation-cycle.test.mjs (8 checks). FINDING: diurnalForecast ALREADY trend-extrapolates nextPeak/nextTrough to their eta (projHigh = baselineNow + trendPerHour·dt + devHi) — so drift over [now→eta] is already baked in; Chunk 1 shifts ONLY by the RESIDUAL horizon max(0, holdHorizonDays − etaDays), making it thin. Inform-only, wired into NO gate. Validated (main): direction-agnostic symmetry pinned, 76 suites + check-imports green. |
| 2 | ✅ LANDED | 035d41f | shadow-log the drift-adjusted margin in `renderAmplitudeMode` → `amplitudeShadow.drift` (INFORM-ONLY, no gate). CALLER PATTERN homed as `driftExitFrom(profile, days, ctx, opts)` in `js/forecast.mjs` (sources ceiling/floor slope from `floorCeilingTrack(stats.days)` + builds the diurnalForecast wrapper + calls `driftAdjustedExit` — Chunk 6 REUSES it). Tax-margin = `amplitudeDriftMargin(dae,{entry})` in `js/amplitudescreen.mjs` (afterTax path reused, `AMP_DRIFT_REQ_MARGIN=0` placeholder Chunk 3 reuses). Slopes from the IN-HAND `stats.days` — NO new fetch. Direction-agnostic (no sign branch), pinned by `oscillation-shadow.test.mjs` (6 checks). 77 suites + check-imports + lint-docs green. No APP_VERSION (console-only). |
| 3 | ✅ LANDED | a19ba3a | THE ONLY GATE. (A) `amplitudeGate` gains `margin-below-floor` — reject when `amplitudeDriftMargin().margin <= 0` (the `AMP_DRIFT_REQ_MARGIN` floor already subtracted inside the margin — one-home; direction-agnostic, no sign branch), sequenced AFTER trend/knife; the margin is computed ONCE at the gate stage in `renderAmplitudeMode` and REUSED for the Chunk-2 shadow-log (no double-compute); degrade-OPEN (null margin ≠ reject). (B) the knife guard is TEMPERED by `oscillationVsKnife` — a raw knife that `oscillating===true` is not a false knife, falls through to the margin gate (LOOSENS the guard; safe because the margin gate still has final say). Pinned by `pipeline/test/oscillation-gate.test.mjs` (8 checks: fang down-leg → margin-below-floor; Aldarium rising-floor + collapsed amplitude → margin-below-floor; healthy oscillator → pass; knife-temper both ways; direction-agnostic; degrade-open). Live `--mode amplitude` before/after: Twisted buckler DROPPED on margin-below-floor (live 16.98m fell below its 17.46m historical trough → forward peak after-tax 17.27m < entry → genuinely sub-floor); Old school bond / Dinh's bulwark ADMITTED (positive drift-adjusted margins, one rising one mildly falling). 78 suites + check-imports + lint-docs green. No APP_VERSION (console-only). |
| 4 | ✅ LANDED | b3a843c | the adaptive cycle-expectation loop. NEW `pipeline/lib/cyclewatch.mjs` (pure) + NEW gitignored repo-root sibling `cycle-watch.json` (keyed by item id; loadState/saveState REUSED from watchstate.mjs — not forked). PRIOR = Chunk 2's `driftExitFrom` (REUSED). HOOK = opt-in `--cycle` flag on `watch-positions.mjs`, purely ADDITIVE (loads/saves the state file only under the flag; pushes a nested `cycle — …` note AFTER the emit-contract block; default output byte-identical). Each tick: running realized min/max vs the stored expectation → `trackError()` (the ONE direction-agnostic comparator — branches on `sign(actual−expected)`, NEVER on the drift sign) → `sideRevision()` maps to shallower/deeper dip (revise Te up / drop the bid) + weaker/stronger peak (sell-velocity step-DOWN / ask-headroom ladder-UP, reusing those doctrines) + appends an `{expected, actual, adjustment}` triple. Band-breach → an INFORM-ONLY ABORT note (never an auto-cancel — ALERTS-never-places, the flushSignal precedent). All thresholds NAMED PLACEHOLDERS (n≈0), every note carries the "prior, not a validated forecast" caveat. Pinned by `pipeline/test/cyclewatch.test.mjs` (14 checks: up-drift AND down-drift via one code path, all four revisions, abort, reset/recycle, history cap+purity, persistence round-trip). No APP_VERSION (pipeline-only). 79 suites + check-imports + lint-docs green. |
| 5 | ✅ LANDED | 696fe55 | drift-adjusted exit on EVERY price suggestion (INFORM, display-only). `formatFloorCeiling` (`js/windowread.mjs`) gains an optional `drift` opt = a `driftAdjustedExit()` result the CALLER computes via the SHARED `driftExitFrom` off its in-hand `hourProfile`+`windowStats().days` (NO new fetch; windowread never imports forecast — the caller passes pre-computed numbers, one-way arrow intact). Renders a `drift-adj exit (~1.5d hold): peak ~X / trough ~Y (projected level, n≈0 — inform, not a direction)` clause — a projected LEVEL, NEVER a rising/falling verdict (direction is only the sign of the shift upstream). Wired at `quote-items.mjs` (bare quote + `--positions`, via `pushTrajectory` — prof+ctx from in-hand data) and `read-window-range.mjs` (`--trajectory` + DAILY TRAJECTORY blocks), and — app-visible — `js/trends.js` `renderForecast` (drift-adjusted peak/trough beside the naive next-trough/peak readout). Degrades cleanly (null projection ⇒ clause omitted). Direction-agnostic (±same-magnitude drift moves the note by identical arithmetic), NEVER a gate/verdict/price input. Pinned by `pipeline/test/oscillation-render.test.mjs` (6 checks: level renders; no direction word; ±drift symmetry; degrade both ways; end-to-end off `driftExitFrom`). **APP_VERSION 0.66.1→0.67.0** (reaches `js/trends.js`, like R2/R3). 81 suites + check-imports + lint-docs + browser smoke green. |
| 6 | ✅ LANDED | 7661a76 | per-thesis drift-adjusted-exit INFORM notes. Each surfacing spec (band/churn/scalp/value) gains an OPTIONAL `driftInform:{label}` registry field + the pure `driftInformNote(spec,dae,{entry,fmt})` helper in `js/flip-niches.mjs`; the render paths (renderMode band/churn/scalp + renderValueMode) compute the drift-adjusted exit ONCE via the SHARED `driftExitFrom` (off in-hand `prof`+`windowStats().days`, NO fetch — fork nothing) and push a sibling INFORM note (`driftNotes`/`valueInformNotes`). NO thesis gains a gate; DIRECTION-AGNOSTIC (reads `driftAdjustedPeak`, no sign branch); registry-line read, no `if(mode===)`. band = drift-adjusted band top (priced lower on a fader, NOT excluded); churn = "don't buy near the drift-adjusted weekly high" magnitude caution; scalp = sharpened exit-pricing on already-accepted fallers (admission unchanged); value = drift-adjusted after-tax amplitude vs buy-low (NOT a floor relax — R3b stays dropped). `DRIFT_NEAR_HIGH_FRAC=0.02` placeholder (n≈0). Pinned by `pipeline/test/oscillation-thesis.test.mjs` (7 checks incl. Aldarium rising-floor/fading-ceiling regression pin + ±drift symmetry) + a flip-niches.test.mjs conformance check. 79 suites + check-imports + lint-docs green. **NO APP_VERSION** — console-only notes (driftNotes/valueInformNotes → footer/console.log); does NOT alter screen.json cells or the returned rows, so `js/trends.js` reads nothing new (audited). |
