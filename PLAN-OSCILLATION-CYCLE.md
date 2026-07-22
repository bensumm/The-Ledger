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

### F-A — LANDED-in-worktree (Fable, 2026-07-22): `oscillationVsKnife` redesigned
Retired the first-difference flip-fraction metric entirely (it measured day-to-day noisiness, not
harvestable oscillation — the exact bug this section diagnosed). The redesign detrends the daily
mids via the SAME shared `projectTrajectory` slope (one-home, unchanged), then splits the residuals
into maximal same-direction LEGS: a leg counts as real only past `OSC_MIN_LEG_DAYS` (≥2 days —
filters a one-day blip) AND `OSC_AMP_NOISE_MULT`× the series' own day-to-day noise floor (filters a
leg that's itself just noise). `oscillating` fires at `OSC_MIN_LEGS=3` (≥2 direction reversals) —
load-bearing, because a genuinely monotone series (even a CURVED/accelerating one) detrended by a
single straight line generically produces exactly ONE hump (2 legs) as a pure linear-fit artifact,
not a real cycle; requiring ≥3 legs is what tells that apart from an actual multi-leg oscillation.
Output contract UNCHANGED (`{oscillating, knife, slope, nDays, …}`, `knife = !oscillating`) so the
Chunk-3B knife-temper in `amplitudeGate` needed no changes. Direction-agnostic (no branch on the
sign of `slope` or any leg's direction — only leg COUNT/amplitude feed `oscillating`).

**Walk-forward validation (trailing-data-only, no look-ahead)** over the real 1h series for
Osmumten's fang (#26219), Toxic blowpipe (empty) (#12924), Dragon boots (#11840) via
`pipeline/lib/marketfetch.mjs`'s `fetchTs(id,'1h')` + `js/windowread.mjs`'s `windowStats`, walking
`oscillationVsKnife` day-by-day exactly as `renderAmplitudeMode` calls it (each as-of day only sees
data strictly before it): **all three read OSC on the FULL ~15-day window (the production case),
where the old metric said KNIFE** — the structural false-KNIFE bug is fixed. Across the shorter
walked slices the split is ~half (main-session independent re-run: fang OSC 5/11, blowpipe OSC
6/11, dragon boots OSC 5/11), because the `OSC_MIN_LEGS=3` (≥1.5-cycle) requirement CONSERVATIVELY
reads KNIFE until enough trailing history accrues — the correct failure direction, not the old bug.
(An earlier draft of this doc claimed "OSC 10/10 walked"; that was an implementer overstatement,
corrected here against the main session's own walk-forward. The old-metric evidence — blowpipe KNIFE
10/10 at +2.36% — stands.) A
synthetic monotone-accelerating-decline fixture (no REAL item in the current archive is currently
monotone enough to exercise this half live — honestly noted, not papered over) stayed KNIFE across
all 9 walked days (legs 1–2, never reaching `OSC_MIN_LEGS`). The wiki `/timeseries?timestep=1h`
endpoint only returns ~16 calendar days of history in practice — short of AMP_NIGHTS=14 plus enough
prior days for a long walk, so the walk ran from day 5 (not the production 14-night floor) to get
more than 1–2 as-of days; this is an HONEST SAMPLE-SIZE CONSTRAINT of the endpoint, not a shortcut
in the fix. Honesty (rule 4): this is in-sample, n≈1 regime, correlated items (all three trended
down together this window) — it demonstrates the STRUCTURAL fix (a smooth run reads oscillating
through its cycle) works on the real target class, not a calibrated hit-rate. Pinned by the updated
`pipeline/test/oscillation-cycle.test.mjs` (a fang/blowpipe-SHAPED fixture built from the PLAN's own
described shape — smooth 4-day runs, not a daily zigzag — a mirror up-drift fixture, the monotone
case, and a perfectly-linear zero-residual case).

### F-B — LANDED-in-worktree (Fable, 2026-07-22): amplitude watchlist RESERVE
Chose a targeted RESERVE over a blind `AMP_TOP_DEFAULT` raise — a raised top-N costs one more live
per-item fetch for EVERY candidate in the widened band, on EVERY scan, forever, to fix a handful of
named items; a reserve costs fetches ONLY for items actually on `watchlist.json` (currently 1 entry
— trivially small). `gateAmplitudeCandidates` (`pipeline/lib/gatecandidates.mjs`) takes a
`watchedIds` set (the SAME ids the S3 always-scanned watchlist pass already reads, wired in at
`screen-flip-niches.mjs`'s `WATCHLIST_IDS` right after map load): a watched id bypasses the
`AMP_STAGE1_MIN_PCT` proxy floor (still subject to the shared two-sided-liquidity + price-window
gate — non-negotiable) and is marked `watched:true`. BOTH fetch-pool paths — the legacy
`rankAndSlice` AND the DEFAULT `pickFetchPool` (`admission.mjs`, since `ADMISSION==='unified'` is
the live default) — now reserve a watched straggler a guaranteed slot below the top-N cut,
mirroring the existing unbounded held-reserve shape. Pinned by new fixtures in
`pipeline/test/gatecandidates.test.mjs` and `pipeline/test/admission.test.mjs`.

**Live proof:** temporarily added "Toxic blowpipe (empty)" to `watchlist.json` and ran `--mode
amplitude`. Footer: `fetched 27 (top 25 by amplitude proxy + 2 watchlist-reserved)` — Crystal armour
seed and Toxic blowpipe both rode the reserve. Toxic blowpipe reached the real Stage-2
`amplitudeGate` and was JUDGED on its actual margin — it PASSED (net +330.5k/cycle, 3.1%, grade
A-), appearing in the AMPLITUDE table. `watchlist.json` was reverted to its original content
immediately after (this repo's runtime artifacts are restored, never left mutated).

## Status

| Chunk | State | SHA | Notes |
| --- | --- | --- | --- |
| 1 | ✅ LANDED | 53dab35 | driftAdjustedExit + oscillationVsKnife in js/forecast.mjs + oscillation-cycle.test.mjs (8 checks). FINDING: diurnalForecast ALREADY trend-extrapolates nextPeak/nextTrough to their eta (projHigh = baselineNow + trendPerHour·dt + devHi) — so drift over [now→eta] is already baked in; Chunk 1 shifts ONLY by the RESIDUAL horizon max(0, holdHorizonDays − etaDays), making it thin. Inform-only, wired into NO gate. Validated (main): direction-agnostic symmetry pinned, 76 suites + check-imports green. |
| 2 | ✅ LANDED | 035d41f | shadow-log the drift-adjusted margin in `renderAmplitudeMode` → `amplitudeShadow.drift` (INFORM-ONLY, no gate). CALLER PATTERN homed as `driftExitFrom(profile, days, ctx, opts)` in `js/forecast.mjs` (sources ceiling/floor slope from `floorCeilingTrack(stats.days)` + builds the diurnalForecast wrapper + calls `driftAdjustedExit` — Chunk 6 REUSES it). Tax-margin = `amplitudeDriftMargin(dae,{entry})` in `js/amplitudescreen.mjs` (afterTax path reused, `AMP_DRIFT_REQ_MARGIN=0` placeholder Chunk 3 reuses). Slopes from the IN-HAND `stats.days` — NO new fetch. Direction-agnostic (no sign branch), pinned by `oscillation-shadow.test.mjs` (6 checks). 77 suites + check-imports + lint-docs green. No APP_VERSION (console-only). |
| 3 | ✅ LANDED | a19ba3a | THE ONLY GATE. (A) `amplitudeGate` gains `margin-below-floor` — reject when `amplitudeDriftMargin().margin <= 0` (the `AMP_DRIFT_REQ_MARGIN` floor already subtracted inside the margin — one-home; direction-agnostic, no sign branch), sequenced AFTER trend/knife; the margin is computed ONCE at the gate stage in `renderAmplitudeMode` and REUSED for the Chunk-2 shadow-log (no double-compute); degrade-OPEN (null margin ≠ reject). (B) the knife guard is TEMPERED by `oscillationVsKnife` — a raw knife that `oscillating===true` is not a false knife, falls through to the margin gate (LOOSENS the guard; safe because the margin gate still has final say). Pinned by `pipeline/test/oscillation-gate.test.mjs` (8 checks: fang down-leg → margin-below-floor; Aldarium rising-floor + collapsed amplitude → margin-below-floor; healthy oscillator → pass; knife-temper both ways; direction-agnostic; degrade-open). Live `--mode amplitude` before/after: Twisted buckler DROPPED on margin-below-floor (live 16.98m fell below its 17.46m historical trough → forward peak after-tax 17.27m < entry → genuinely sub-floor); Old school bond / Dinh's bulwark ADMITTED (positive drift-adjusted margins, one rising one mildly falling). 78 suites + check-imports + lint-docs green. No APP_VERSION (console-only). |
| 4 | ✅ LANDED | b3a843c | the adaptive cycle-expectation loop. NEW `pipeline/lib/cyclewatch.mjs` (pure) + NEW gitignored repo-root sibling `cycle-watch.json` (keyed by item id; loadState/saveState REUSED from watchstate.mjs — not forked). PRIOR = Chunk 2's `driftExitFrom` (REUSED). HOOK = opt-in `--cycle` flag on `watch-positions.mjs`, purely ADDITIVE (loads/saves the state file only under the flag; pushes a nested `cycle — …` note AFTER the emit-contract block; default output byte-identical). Each tick: running realized min/max vs the stored expectation → `trackError()` (the ONE direction-agnostic comparator — branches on `sign(actual−expected)`, NEVER on the drift sign) → `sideRevision()` maps to shallower/deeper dip (revise Te up / drop the bid) + weaker/stronger peak (sell-velocity step-DOWN / ask-headroom ladder-UP, reusing those doctrines) + appends an `{expected, actual, adjustment}` triple. Band-breach → an INFORM-ONLY ABORT note (never an auto-cancel — ALERTS-never-places, the flushSignal precedent). All thresholds NAMED PLACEHOLDERS (n≈0), every note carries the "prior, not a validated forecast" caveat. Pinned by `pipeline/test/cyclewatch.test.mjs` (14 checks: up-drift AND down-drift via one code path, all four revisions, abort, reset/recycle, history cap+purity, persistence round-trip). No APP_VERSION (pipeline-only). 79 suites + check-imports + lint-docs green. |
| 5 | ✅ LANDED | 696fe55 | drift-adjusted exit on EVERY price suggestion (INFORM, display-only). `formatFloorCeiling` (`js/windowread.mjs`) gains an optional `drift` opt = a `driftAdjustedExit()` result the CALLER computes via the SHARED `driftExitFrom` off its in-hand `hourProfile`+`windowStats().days` (NO new fetch; windowread never imports forecast — the caller passes pre-computed numbers, one-way arrow intact). Renders a `drift-adj exit (~1.5d hold): peak ~X / trough ~Y (projected level, n≈0 — inform, not a direction)` clause — a projected LEVEL, NEVER a rising/falling verdict (direction is only the sign of the shift upstream). Wired at `quote-items.mjs` (bare quote + `--positions`, via `pushTrajectory` — prof+ctx from in-hand data) and `read-window-range.mjs` (`--trajectory` + DAILY TRAJECTORY blocks), and — app-visible — `js/trends.js` `renderForecast` (drift-adjusted peak/trough beside the naive next-trough/peak readout). Degrades cleanly (null projection ⇒ clause omitted). Direction-agnostic (±same-magnitude drift moves the note by identical arithmetic), NEVER a gate/verdict/price input. Pinned by `pipeline/test/oscillation-render.test.mjs` (6 checks: level renders; no direction word; ±drift symmetry; degrade both ways; end-to-end off `driftExitFrom`). **APP_VERSION 0.66.1→0.67.0** (reaches `js/trends.js`, like R2/R3). 81 suites + check-imports + lint-docs + browser smoke green. |
| F-A | ✅ LANDED | 62da022 | `oscillationVsKnife` redesigned — legs+amplitude detector replaces the first-difference flip-fraction metric. Walk-forward (main-session independent re-run): all three read OSC on the FULL ~15-day window (was KNIFE under the old metric — structural bug fixed); shorter walked slices ~half OSC (fang 5/11, blowpipe 6/11, boots 5/11) — the `OSC_MIN_LEGS=3` conservative short-window degrade (correct direction). Synthetic monotone stays KNIFE 10/10; clean 8d sine → OSC once ≥1.5 periods seen. (Implementer's "OSC 10/10 walked" claim was an overstatement, corrected.) Pinned by the rebuilt `pipeline/test/oscillation-cycle.test.mjs`. n≈0, in-sample, ~16d history — fixes the mislabel, NOT a calibrated hit-rate. |
| F-B | ✅ LANDED | 62da022 | amplitude Stage-1 fetch pool gains a WATCHLIST RESERVE (`gatecandidates.mjs` + `admission.mjs`, both fetch-pool paths) — bypasses `AMP_STAGE1_MIN_PCT` + guarantees a slot below `AMP_TOP_DEFAULT` for a `watchlist.json` id. Live-proven (main-session re-run): footer `fetched 26 (top 25 + 1 watchlist-reserved)`, watchlisted Toxic blowpipe reached the gate and passed on its real margin. Pinned by new fixtures in `gatecandidates.test.mjs` + `admission.test.mjs`. **CAVEAT: only helps WATCHLIST members** — fang + dragon boots are NOT on `watchlist.json`, so they still don't surface; add them to the watchlist to reserve them a slot. |
| 6 | ✅ LANDED | 7661a76 | per-thesis drift-adjusted-exit INFORM notes. Each surfacing spec (band/churn/scalp/value) gains an OPTIONAL `driftInform:{label}` registry field + the pure `driftInformNote(spec,dae,{entry,fmt})` helper in `js/flip-niches.mjs`; the render paths (renderMode band/churn/scalp + renderValueMode) compute the drift-adjusted exit ONCE via the SHARED `driftExitFrom` (off in-hand `prof`+`windowStats().days`, NO fetch — fork nothing) and push a sibling INFORM note (`driftNotes`/`valueInformNotes`). NO thesis gains a gate; DIRECTION-AGNOSTIC (reads `driftAdjustedPeak`, no sign branch); registry-line read, no `if(mode===)`. band = drift-adjusted band top (priced lower on a fader, NOT excluded); churn = "don't buy near the drift-adjusted weekly high" magnitude caution; scalp = sharpened exit-pricing on already-accepted fallers (admission unchanged); value = drift-adjusted after-tax amplitude vs buy-low (NOT a floor relax — R3b stays dropped). `DRIFT_NEAR_HIGH_FRAC=0.02` placeholder (n≈0). Pinned by `pipeline/test/oscillation-thesis.test.mjs` (7 checks incl. Aldarium rising-floor/fading-ceiling regression pin + ±drift symmetry) + a flip-niches.test.mjs conformance check. 79 suites + check-imports + lint-docs green. **NO APP_VERSION** — console-only notes (driftNotes/valueInformNotes → footer/console.log); does NOT alter screen.json cells or the returned rows, so `js/trends.js` reads nothing new (audited). |
