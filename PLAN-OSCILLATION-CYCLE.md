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
`pipeline/lib/marketfetch.mjs`'s `fetchTs(id,'1h')` + `js/windowread.mjs`'s `windowStats`.

**CORRECTION (2026-07-22, main session's independent re-run vs the implementer's first pass):** the
implementer's first walk-forward reported "fang/blowpipe/dragon boots OSC 10/10 days walked" — that
number was **an overstatement caused by a look-ahead bug in the harness**, not a legitimately
different valid measurement. The harness varied a synthetic `now` cutoff but passed the FULL fetched
series into `windowStats` unchanged; `windowStats`'s `now` param only strips the ONE calendar day
whose key matches `now` (the forming-day guard) — it does NOT truncate the series to data at-or-before
`now`. So on a ~16-day archive, `nights:14` kept grabbing (almost) the newest 14 days of the WHOLE
series on every iteration regardless of the synthetic as-of date, which is why nearly every "day
walked" silently re-scored (close to) the full window and read OSC.

The main session's independent harness truncates correctly (`days.slice(0, i+1)` on an already-ascending
`windowStats(...,{nights:40}).days` array — genuinely trailing-only) and found: **fang OSC 5/11 slices
walked, blowpipe OSC 6/11, dragon boots OSC 5/11 — all three OSC once the FULL ~15-day window is
reached, KNIFE on the shorter trailing slices.** The implementer reproduced this independently with a
second, differently-built correct harness (truncating the raw timestamp series itself before calling
`windowStats`) and got closely matching numbers (fang 6/12, blowpipe 7/12, boots 6/12 — small deltas
from a different `nights`/loop-start choice, same qualitative shape): **KNIFE on short trailing
windows (≤~9-10 days), transitioning to OSC once enough days accumulate to show ≥2 real reversals
(roughly ≥1.5 cycles at fang's ~8-day period).** This is the CORRECT, standing result — the earlier
"10/10" claim is retracted.

What this means for the fix: the STRUCTURAL bug (a smooth long-run oscillation reading KNIFE on the
FULL window) is still fixed — full-window fang/blowpipe/dragon boots all read OSC (previously false
KNIFE per the original evidence above), and a synthetic monotone-accelerating-decline fixture (no REAL
item in the current archive is currently monotone enough to exercise this half live) reads KNIFE
consistently across every walked slice. But the corrected walk-forward ALSO shows the redesigned
detector needs enough TRAILING HISTORY to see ≥2 real reversals before it calls a genuine oscillator
OSC — on a short window (a few days into a ~week-long down-leg, say) it will correctly read KNIFE
because, from inside that window, it genuinely cannot yet tell a real cycle from a monotone leg. That
is an honest, inherent sample-size limitation (not a re-introduction of the old bug), but it is real
production behavior worth knowing: `renderAmplitudeMode` calls this off `windowStats(...,{nights:14})`
via `AMP_NIGHTS=14`, i.e. right at the edge of the "needs ~10+ days" transition seen here — a newly
fetched or short-history item can still spend its early days reading KNIFE even under the fixed
detector. The wiki `/timeseries?timestep=1h` endpoint only returns ~16 calendar days of history in
practice, so the whole validation (both the original flawed pass and this correction) is bounded by
that ceiling. Honesty (rule 4): in-sample, n≈1 regime, correlated items (all three trended down
together this window) — this demonstrates the structural fix works on the real target class over a
full window, NOT a calibrated hit-rate, and the walked-slice numbers show a real (not hypothetical)
history-depth sensitivity worth carrying into any future calibration work. Pinned by the updated
`pipeline/test/oscillation-cycle.test.mjs` (a fang/blowpipe-SHAPED fixture built from the PLAN's own
described shape — smooth 4-day runs, not a daily zigzag — a mirror up-drift fixture, the monotone
case, and a perfectly-linear zero-residual case) — the unit fixtures are unaffected by this
correction (they exercise the metric directly on a fixed-length series, not a multi-step walk).

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

### F-C — LANDED-in-worktree (Fable, 2026-07-22): per-thesis HOLD HORIZONS
The main session's own audit of F-A/F-B flagged a real GAP: `driftExitFrom`'s `holdHorizonDays`
defaulted to `OSC_HOLD_HORIZON_DAYS=1.5` (the AMPLITUDE lane's own hold length) at EVERY call site
except `renderAmplitudeMode` (which correctly passes `AMP_HOLD_DAYS`). Chunk 6's band/churn/scalp
notes (real hold: hours) were OVERSTATING the residual-horizon drift shift; value's note (real hold:
multi-week) was WILDLY UNDERSTATING it.

**Fix — only where the code reliably KNOWS the thesis.** Two new NAMED PLACEHOLDER constants in
`js/flip-niches.mjs`, each anchored to an EXISTING codebase constant rather than invented fresh:
- `DRIFT_INTRADAY_HOLD_DAYS = 2/24` (~2h) — anchors to the screen's own "2h band" Bar-E edge window
  (`screen-flip-niches.mjs`'s `BAND_HOURS` default); band/churn/scalp are all same-day flip-first plays.
- `DRIFT_VALUE_HOLD_DAYS = 14` — anchors to `js/termstructure.mjs`'s `FLOOR_FALLBACK_DAYS=14`, the
  SAME "multi-week durable floor" window the value gate itself already reads, and matches value's own
  `reach` validator window (`{windowHours:24, nights:14}`).

Each spec's `driftInform` registry field gained an optional `holdDays` (band/churn/scalp →
`DRIFT_INTRADAY_HOLD_DAYS`, value → `DRIFT_VALUE_HOLD_DAYS`); `validateNicheSpec` now checks it's a
positive number when present. `screen-flip-niches.mjs`'s two Chunk-6 call sites (band/churn/scalp at
the per-row drift-exit note, value at its own) now read `FLIP_NICHES[mode].driftInform?.holdDays` and
pass it through to `driftExitFrom(..., {holdHorizonDays})` — a registry-line read, not an
`if(mode===)` branch, one-home (every caller still goes through the SAME `driftExitFrom`). Direction-
agnostic and inform-only throughout — no admission/gate changed.

**Deliberately left on the generic default (NOT a gap, a scoping decision):** `quote-items.mjs`'s bare
quote / `--positions` trajectory note, `read-window-range.mjs`, `js/trends.js`'s `renderForecast`, and
`watch-positions.mjs`'s non-`--cycle` render path have NO reliably-known per-item flip-niche thesis at
that call site (an arbitrary Trends-page item, or a bare quote, isn't tied to band/churn/scalp/value —
`js/flip-niches.mjs`/`held-item-strategy.mjs`'s path vocabulary isn't wired into any of them). Inventing
a guess there would be a bigger, riskier plumbing change for a display-only note than the actual bug
warranted. These stay on `OSC_HOLD_HORIZON_DAYS` (now re-documented in `js/forecast.mjs` as the
GENERIC no-known-thesis fallback, not "the" hold horizon) — and this is NOT a silent mis-scale: the
rendered clause already shows the ACTUAL `holdHorizonDays` used (`formatFloorCeiling` in
`js/windowread.mjs` reads `drift.holdHorizonDays` dynamically, never a hardcoded "1.5d" string), so a
reader always sees which horizon produced the number. `watch-positions.mjs --cycle` (Chunk 4) is
ALSO deliberately unchanged — it IS the multi-week oscillator/amplitude cycle-watch feature, so the
amplitude-shaped default is the CORRECT one there, not a gap.

**No APP_VERSION bump.** `js/flip-niches.mjs` is still not app-imported (confirmed by grep — only
`pipeline/lib/gatecandidates.mjs` and `pipeline/commands/screen-flip-niches.mjs` import it); the
Chunk-6 driftInform notes this touches are console-only (`driftNotes`/`valueInformNotes`, same as
Chunk 6 itself shipped with no bump). `js/trends.js`'s `renderForecast` — the one APP-VISIBLE
consumer of `driftExitFrom` — is UNCHANGED (deliberately left on the generic default, per above), so
nothing reaches the app differently than before. No browser smoke needed for that reason (run anyway
as part of the existing suite — unaffected, still green).

Tests: extended `pipeline/test/oscillation-thesis.test.mjs` (4 new checks) — each thesis declares its
real `holdDays`; passing it scales the residual-horizon shift proportionally to the horizon (intraday
< the old 1.5d default < value's multi-week); ±drift symmetry holds at each thesis's own horizon; the
new conformance rule catches a malformed `holdDays`.

## Status

| Chunk | State | SHA | Notes |
| --- | --- | --- | --- |
| 1 | ✅ LANDED | 53dab35 | driftAdjustedExit + oscillationVsKnife in js/forecast.mjs + oscillation-cycle.test.mjs (8 checks). FINDING: diurnalForecast ALREADY trend-extrapolates nextPeak/nextTrough to their eta (projHigh = baselineNow + trendPerHour·dt + devHi) — so drift over [now→eta] is already baked in; Chunk 1 shifts ONLY by the RESIDUAL horizon max(0, holdHorizonDays − etaDays), making it thin. Inform-only, wired into NO gate. Validated (main): direction-agnostic symmetry pinned, 76 suites + check-imports green. |
| 2 | ✅ LANDED | 035d41f | shadow-log the drift-adjusted margin in `renderAmplitudeMode` → `amplitudeShadow.drift` (INFORM-ONLY, no gate). CALLER PATTERN homed as `driftExitFrom(profile, days, ctx, opts)` in `js/forecast.mjs` (sources ceiling/floor slope from `floorCeilingTrack(stats.days)` + builds the diurnalForecast wrapper + calls `driftAdjustedExit` — Chunk 6 REUSES it). Tax-margin = `amplitudeDriftMargin(dae,{entry})` in `js/amplitudescreen.mjs` (afterTax path reused, `AMP_DRIFT_REQ_MARGIN=0` placeholder Chunk 3 reuses). Slopes from the IN-HAND `stats.days` — NO new fetch. Direction-agnostic (no sign branch), pinned by `oscillation-shadow.test.mjs` (6 checks). 77 suites + check-imports + lint-docs green. No APP_VERSION (console-only). |
| 3 | ✅ LANDED | a19ba3a | THE ONLY GATE. (A) `amplitudeGate` gains `margin-below-floor` — reject when `amplitudeDriftMargin().margin <= 0` (the `AMP_DRIFT_REQ_MARGIN` floor already subtracted inside the margin — one-home; direction-agnostic, no sign branch), sequenced AFTER trend/knife; the margin is computed ONCE at the gate stage in `renderAmplitudeMode` and REUSED for the Chunk-2 shadow-log (no double-compute); degrade-OPEN (null margin ≠ reject). (B) the knife guard is TEMPERED by `oscillationVsKnife` — a raw knife that `oscillating===true` is not a false knife, falls through to the margin gate (LOOSENS the guard; safe because the margin gate still has final say). Pinned by `pipeline/test/oscillation-gate.test.mjs` (8 checks: fang down-leg → margin-below-floor; Aldarium rising-floor + collapsed amplitude → margin-below-floor; healthy oscillator → pass; knife-temper both ways; direction-agnostic; degrade-open). Live `--mode amplitude` before/after: Twisted buckler DROPPED on margin-below-floor (live 16.98m fell below its 17.46m historical trough → forward peak after-tax 17.27m < entry → genuinely sub-floor); Old school bond / Dinh's bulwark ADMITTED (positive drift-adjusted margins, one rising one mildly falling). 78 suites + check-imports + lint-docs green. No APP_VERSION (console-only). |
| 4 | ✅ LANDED | b3a843c | the adaptive cycle-expectation loop. NEW `pipeline/lib/cyclewatch.mjs` (pure) + NEW gitignored repo-root sibling `cycle-watch.json` (keyed by item id; loadState/saveState REUSED from watchstate.mjs — not forked). PRIOR = Chunk 2's `driftExitFrom` (REUSED). HOOK = opt-in `--cycle` flag on `watch-positions.mjs`, purely ADDITIVE (loads/saves the state file only under the flag; pushes a nested `cycle — …` note AFTER the emit-contract block; default output byte-identical). Each tick: running realized min/max vs the stored expectation → `trackError()` (the ONE direction-agnostic comparator — branches on `sign(actual−expected)`, NEVER on the drift sign) → `sideRevision()` maps to shallower/deeper dip (revise Te up / drop the bid) + weaker/stronger peak (sell-velocity step-DOWN / ask-headroom ladder-UP, reusing those doctrines) + appends an `{expected, actual, adjustment}` triple. Band-breach → an INFORM-ONLY ABORT note (never an auto-cancel — ALERTS-never-places, the flushSignal precedent). All thresholds NAMED PLACEHOLDERS (n≈0), every note carries the "prior, not a validated forecast" caveat. Pinned by `pipeline/test/cyclewatch.test.mjs` (14 checks: up-drift AND down-drift via one code path, all four revisions, abort, reset/recycle, history cap+purity, persistence round-trip). No APP_VERSION (pipeline-only). 79 suites + check-imports + lint-docs green. |
| 5 | ✅ LANDED | 696fe55 | drift-adjusted exit on EVERY price suggestion (INFORM, display-only). `formatFloorCeiling` (`js/windowread.mjs`) gains an optional `drift` opt = a `driftAdjustedExit()` result the CALLER computes via the SHARED `driftExitFrom` off its in-hand `hourProfile`+`windowStats().days` (NO new fetch; windowread never imports forecast — the caller passes pre-computed numbers, one-way arrow intact). Renders a `drift-adj exit (~1.5d hold): peak ~X / trough ~Y (projected level, n≈0 — inform, not a direction)` clause — a projected LEVEL, NEVER a rising/falling verdict (direction is only the sign of the shift upstream). Wired at `quote-items.mjs` (bare quote + `--positions`, via `pushTrajectory` — prof+ctx from in-hand data) and `read-window-range.mjs` (`--trajectory` + DAILY TRAJECTORY blocks), and — app-visible — `js/trends.js` `renderForecast` (drift-adjusted peak/trough beside the naive next-trough/peak readout). Degrades cleanly (null projection ⇒ clause omitted). Direction-agnostic (±same-magnitude drift moves the note by identical arithmetic), NEVER a gate/verdict/price input. Pinned by `pipeline/test/oscillation-render.test.mjs` (6 checks: level renders; no direction word; ±drift symmetry; degrade both ways; end-to-end off `driftExitFrom`). **APP_VERSION 0.66.1→0.67.0** (reaches `js/trends.js`, like R2/R3). 81 suites + check-imports + lint-docs + browser smoke green. |
| F-A | ✅ LANDED-in-worktree | (this worktree) | `oscillationVsKnife` redesigned — legs+amplitude detector replaces the first-difference flip-fraction metric. **CORRECTED walk-forward (2026-07-22):** all three (fang/blowpipe/dragon boots) read OSC on the FULL ~15-day window (fixes the false-KNIFE bug); on trailing WALKED slices, fang OSC 5/11, blowpipe 6/11, boots 5/11 — KNIFE on short windows, OSC once enough days accumulate for ≥2 real reversals (the implementer's original "10/10 walked" claim was a look-ahead bug in that harness, retracted — see "Post-landing findings" for the full reconciliation). Synthetic monotone fixture stays KNIFE throughout. Pinned by the rebuilt `pipeline/test/oscillation-cycle.test.mjs` (unaffected by the walk-forward correction — those are fixed-length unit fixtures, not a multi-step walk). |
| F-B | ✅ LANDED | 62da022 | amplitude Stage-1 fetch pool gains a WATCHLIST RESERVE (`gatecandidates.mjs` + `admission.mjs`, both fetch-pool paths) — bypasses `AMP_STAGE1_MIN_PCT` + guarantees a slot below `AMP_TOP_DEFAULT` for a `watchlist.json` id. Live-proven: Toxic blowpipe reached the gate and passed on its real margin. Pinned by new fixtures in `gatecandidates.test.mjs` + `admission.test.mjs`. (Ben 2026-07-22: fang + dragon boots ADDED to `watchlist.json`, so the reserve now covers them.) |
| F-D | ✅ LANDED | (main) | general amplitude fetch-WIDEN `AMP_TOP_DEFAULT` 25→40 (`gatecandidates.mjs`) — "widen the net for now" (Ben 2026-07-22). Costs ~+15 fetches/scan. Live: `fetched 49 (top 40 + 11 watchlist-reserved)`, surfaces the big-ticket oscillator class (Virtus set/robe, Oathplate, Tormented synapse) the top-25 cut hid; but they verify sub-1% off the MEDIAN-peak basis (`AMP_ASK_Q=0.5`, LEFT unchanged per Ben) — VISIBILITY, not new edge; the margin gate + verify trio still govern. |
| F-E | ✅ LANDED-in-worktree | (this worktree) | expose `AMP_ASK_Q`/`AMP_BID_Q` (default 0.5/0.5, KEPT — Ben's call) as `amplitudeRanges(stats, live, { askQ, bidQ })` opts (unhardcoded the `quantLow`/`quantHigh` calls; the effective quantiles now ride on the result). CLI flags `--amp-ask-q` / `--amp-bid-q` on `screen-flip-niches.mjs` (mirrors the `--hold-days` parse convention; clamped [0,1]; absent ⇒ defaults ⇒ byte-identical). `amplitudeShadow` (`suggestlog.mjs`) LEAN-logs `askQ`/`bidQ` **only when non-default** — a default run keeps its exact prior ledger shape, a `--amp-ask-q 0.25` experiment run is now distinguishable in `suggestions.jsonl` (the load-bearing bit for F-G's later "which quantile nets more" compare). **DIRECTION NOTE (corrects the plan's illustrative "0.75"):** `quantHigh`/`quantLow` treat the arg as a REACH FRACTION, so a LOWER askQ = a HIGHER, less-reachable ask (more margin, less reach) — the dial's "better sell" direction is askQ↓, not ↑. Pinned by 2 new checks in `amplitudescreen.test.mjs` (higher-ask/lower-reach trade-off + omitted≡{}≡0.5/0.5 byte-identity) + 2 in `oscillation-shadow.test.mjs` (non-default logged / default+historical lean-omitted). Console-only, no APP_VERSION. 82 suites + check-imports + lint-docs green. |
| F-F | ✅ LANDED-in-worktree | (this worktree) | trough-vs-decay DISPLAY annotation on the amplitude reach cell — the pure `reachPhaseNote(osc, dae, driftShadow)` helper in `screen-flip-niches.mjs` (exported for test), rendered beside the reach cell. Classifier (all 3 signals ALREADY in scope at the gate stage — NO new compute/fetch): **oscillating + `dae.floorSlope >= 0`** → `"trough phase — floor holding, oscillation intact"` (BUY tell); **oscillating + floorSlope < 0** → `"oscillating into a falling floor — drift margin " + (driftShadow.margin > 0 ? "still clears" : "does not clear")`; **knife** → `"no real cycle to harvest"`. DIRECTION-AGNOSTIC: the knife bucket carries NO floor-direction word (`decay`/`rising`/`falling`) — verified the Aldarium rising-hollow mirage (`{oscillating:false, knife:true}`) also lands in `knife`, so "decay" would be a false label on a rising item. Cell also now shows FULL-window reach alongside recent-3 for BOTH legs (`recentHit/recentDays·fullHit/fullN` off `recencySplit`, format-only); header → `'Both-leg reach (recent / full) + phase'`. DISPLAY-ONLY — nothing upstream of the gate touched, no admission/rank change. Pinned by `pipeline/test/oscillation-reachphase.test.mjs` (13 checks: one fixture per branch incl. the load-bearing Aldarium rising-hollow direction-agnostic pin + degrade paths). Console-only, no APP_VERSION. 82 suites + check-imports + lint-docs green. |
| F-G (was #3) | ✅ LANDED-in-worktree | (this worktree) | REAL-fill amplitude retro. CONFIRMED the AGGREGATE already works with ZERO join code (`HORIZON_BY_MODE.amplitude=2d` + `aggregateOutcomes` per-niche → a synthetic closed amplitude round-trip surfaces a real `amplitude` row in `analyze-record`'s §2 rollup; nearest-prior-suggestion join handles the linkage, no schema field missing). BUILT: (1) ONE-LINE enrichment `base.amplitude = s ? (s.amplitude ?? null) : null` in `retrojoin.mjs` (mirrors the `path`/`refBuy` passthrough — additive, pure, degrades to null off non-amplitude/pre-F-G rows). (2) NEW pure `amplitudeRetro(retroRows,{minN})` in `lib/analyze.mjs` + a §2b section in `analyze-record.mjs`: per closed amplitude pick prints `shadow ampBid→ampAsk (net X, drift margin ±Y)` vs `realized buy→sell (net Z)`, plus the AGGREGATE **discount** = (Σ shadow net − Σ realized net)/Σ shadow net; both nets AFTER-TAX per unit (shadow = `afterTax(ampAsk) − ampBid`). n-gated by the EXISTING `MIN_N_CANDIDATE` floor (no new threshold) — n=0 today prints the honest "awaiting real fills" line (verified live), a below-floor n prints the per-pick FACTS but caveats the aggregate discount as not-a-conclusion. Deploy-small-to-learn/tuition posture: the CONCLUSION (does oscillating+positive-margin predict profit?) is gated on accrued REAL closed cycles — instrumentation for a manual Ben call, gates NOTHING (floors + real-breakdown cuts still hold). `join-amplitude-outcomes.mjs` untouched (stays the shadow upper-bound half). Pinned by +1 check in `retrojoin.test.mjs` (amplitude block carried through / null) + 3 checks in `analyze.test.mjs` (shadowNet+discount math, n-gating, degrade). No fork, no APP_VERSION (pipeline/console-only). |
| F-H (was #5) | ✅ LANDED-in-worktree | (this worktree) | detector short-window fix — DECOUPLED the detector's lookback from the gate's. NEW `OSC_DETECTOR_NIGHTS=21` in `js/forecast.mjs` (> `AMP_NIGHTS=14`, n≈0 placeholder). `renderAmplitudeMode` now feeds `oscillationVsKnife` a SEPARATE `windowStats(ts1h,{nights:OSC_DETECTOR_NIGHTS,wStart:0,wEnd:0}).days` (its own longer trailing window off the SAME in-hand `ts1h`, NO new fetch), while the GATE keeps its existing `AMP_NIGHTS` `stats` for `amplitudeRanges`/reach AND `dae`/`driftExitFrom` (basis UNTOUCHED — no SIGNAL-RECENCY regression). So the detector gets the ≥1.5 cycles / ≥3 legs it needs to fire OSCILLATING without widening the gate's daily-range/reach/recency reads. HONESTY (rule 4): the wiki `/timeseries?timestep=1h` endpoint returns only ~16 calendar days, so on real data `OSC_DETECTOR_NIGHTS` effectively caps near ~15d — `windowStats` returns all available days when `nights` exceeds series depth; a sample-size fix BOUNDED by the endpoint, NOT a calibration (a deeper `archive.mjs` series is a noted-not-built follow-up). Pinned by 2 new checks in `oscillation-cycle.test.mjs` (recently-down-legging oscillator: KNIFE at AMP_NIGHTS → OSCILLATING at OSC_DETECTOR_NIGHTS; + the gate's AMP_NIGHTS `amplitudeRanges` byte-unchanged while the two windows genuinely differ). 82 suites + check-imports + lint-docs green. No APP_VERSION (console-only). |
| #4 (generic hold-horizon) | SHELVED | — | F-C's scoping holds — the only numeric horizon source (`hold-thesis.json.horizon`) is `null` on every live entry; the held-lot path horizon is free-text. Not worth the plumbing for a display note. Backlog. |
| #6 (JSON-store consolidation) | SHELVED | — | 3 distinct schemas, no cross-reads, no decision impact. Opportunistic only. |
| F-C | ✅ LANDED-in-worktree | (this worktree) | per-thesis HOLD HORIZONS for the drift-adjusted-exit note (the audit's own GAP finding) — `DRIFT_INTRADAY_HOLD_DAYS` (band/churn/scalp, ~2h, anchored to `BAND_HOURS`) and `DRIFT_VALUE_HOLD_DAYS` (value, 14d, anchored to `termstructure.mjs`'s `FLOOR_FALLBACK_DAYS`) replace the blanket amplitude-shaped 1.5d default at the two Chunk-6 call sites that KNOW their thesis. Generic contexts with no known thesis (quote-items/read-window-range/trends.js/watch-positions non-cycle) deliberately kept on the default — the render already shows the real horizon used, so nothing is silently mis-scaled. No APP_VERSION bump (`js/flip-niches.mjs` still not app-imported; `js/trends.js` unchanged). Pinned by 4 new checks in `oscillation-thesis.test.mjs`. |
| 6 | ✅ LANDED | 7661a76 | per-thesis drift-adjusted-exit INFORM notes. Each surfacing spec (band/churn/scalp/value) gains an OPTIONAL `driftInform:{label}` registry field + the pure `driftInformNote(spec,dae,{entry,fmt})` helper in `js/flip-niches.mjs`; the render paths (renderMode band/churn/scalp + renderValueMode) compute the drift-adjusted exit ONCE via the SHARED `driftExitFrom` (off in-hand `prof`+`windowStats().days`, NO fetch — fork nothing) and push a sibling INFORM note (`driftNotes`/`valueInformNotes`). NO thesis gains a gate; DIRECTION-AGNOSTIC (reads `driftAdjustedPeak`, no sign branch); registry-line read, no `if(mode===)`. band = drift-adjusted band top (priced lower on a fader, NOT excluded); churn = "don't buy near the drift-adjusted weekly high" magnitude caution; scalp = sharpened exit-pricing on already-accepted fallers (admission unchanged); value = drift-adjusted after-tax amplitude vs buy-low (NOT a floor relax — R3b stays dropped). `DRIFT_NEAR_HIGH_FRAC=0.02` placeholder (n≈0). Pinned by `pipeline/test/oscillation-thesis.test.mjs` (7 checks incl. Aldarium rising-floor/fading-ceiling regression pin + ±drift symmetry) + a flip-niches.test.mjs conformance check. 79 suites + check-imports + lint-docs green. **NO APP_VERSION** — console-only notes (driftNotes/valueInformNotes → footer/console.log); does NOT alter screen.json cells or the returned rows, so `js/trends.js` reads nothing new (audited). |

## Wave 3 — make the DIGEST actually DENOISE (planned 2026-07-22; pending Fable harden)

**Problem (Ben, 2026-07-22).** The DECISION DIGEST is meant to be the DENOISED, focused output the
interpretation layer builds on. Today it's a `capEff`-ranked cross-niche leaderboard whose RANK
rewards the noise: cheap high-% **ghost spreads** (Jade necklace 259%/d, Ironwood plank 143%/d —
uncrossable, live instasell ≈ instabuy) and drift-blind **naive-net mirages** (Aldarium `capEff`
41–62%/d on EVERY pass, verified a fading ~1% mirage ~8× this session) top it. The denoising
signals (crossability, drift-margin, reach-fade) are shown as COLUMNS but don't drive the RANK, and
there's no session-verified-noise memory → the interpretation layer re-drills the same noise every
pass. The digest is inform-only (`capEff re-orders the DIGEST view only` — never gates / never
touches screen.json), so folding the denoisers into its RANK is the SAFE home for this (an n≈0
signal reordering a survey, not the graded board). **This SUBSUMES F-I** — F-I ("promote the
drift-margin to the screen.json rank/grade") is SHELVED in favor of doing it in the digest rank,
inform-only.

- **W3-1 — crossability / ghost-spread demotion (the biggest single denoiser).** ✅ **LANDED-in-worktree**
  (2026-07-22). NEW pure helper `liveCrossable(row)` (exported) near `digestVerdict` in
  `screen-flip-niches.mjs`: `row.quickRoi > LIVE_CROSSABLE_MIN_ROI(=0)` → true / false / null(no live
  print → UNKNOWN, never punished). Reuses `quickRoi` (the tax-inclusive live-spread margin `computeQuote`
  already sets — the ONE tax/margin home, no `netMargin` dup). `collectDigestRow` stores `crossable` on the
  row; `buildDigestBlock`'s comparator FLOORS the sort key to `-Infinity` when `crossable===false` (the row
  STILL renders — never silently dropped — and the displayed `capEff` column is NEVER mutated); `digestVerdict`
  gains a TOP-priority `if (crossable===false) return 'spread closed now'` (ahead of the soft `mirage top` —
  an uncrossable live spread is a harder fact). NAMED `liveCrossable`/`crossable`, NOT "ghost spread": the
  existing "ghost spread" is a ONE-SIDED book (`hpv<=0||lpv<=0`, the two-sided-liquidity gate) — a distinct
  concept, noted at the digest header (~416). INFORM/DIGEST-ONLY. Pinned by 5 new checks in
  `capeff-digest.test.mjs` (§10).
- **W3-2 — drift-margin into the digest RANK (the reshaped F-I).** ✅ **LANDED-in-worktree** (2026-07-22).
  At the amplitude `ampEr` construction the DIGEST rank basis `net` is substituted:
  `(driftShadow.margin != null) ? driftShadow.margin : ar.netPerCycle` — so a fading mirage (Aldarium: amplitude
  collapses → `driftShadow.margin` NEGATIVE → negative `capEff` via `roiPct`'s null-guard → sinks in the digest
  naturally). `ampEr` is built AFTER rank(1666)/grade(1667)/cells(1675) and (grep-confirmed) consumed ONLY by
  `collectDigestRow` — the per-niche `rank`, `grade`, and printed amplitude cells all keep `ar.netPerCycle`,
  untouched. **Scoped out (deliberately):** amplitude's `reachFrac`/`askPlacement` stay `null` (symmetric-exempt
  by design — populating risks a third reach vocabulary); band/churn/value's Chunk-6 drift is NOT folded into
  their digest rank (different time horizons — a separate Wave-4 harden). Inform-only (digest rank), NOT
  screen.json grade/rank. Pinned by 2 new checks in `capeff-digest.test.mjs` (§11) — the load-bearing
  simultaneous pin (digest capEff differs BETWEEN two drift margins while rank(1666) is byte-identical).
- **W3-3 — session-verified-noise suppression (the QoL win, the riskiest).** ⏸️ **DEFERRED** (not built in
  Phase 1). Carry a "drilled &
  rejected this session" mark so a verified mirage doesn't re-top the digest every pass (the ~8×
  Aldarium re-drill is the symptom). HARDEN: where does the state live + who sets it (the
  interpretation layer marks it; the digest suppresses/down-ranks next pass) — an existing session
  artifact to reuse, or genuinely new persistence? Worth the complexity vs W3-1+W3-2 alone?

**Honesty:** all n≈0, inform-only (the digest gates NOTHING). W3-1 is the highest-value first cut.
