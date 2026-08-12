# PLAN-MULTIWEEK-OSCILLATOR — scoping the "repeats every ~6–8 days" taxonomy hole

**Status: SCOPING ONLY, no code changed.** Investigates `PLAN-BLINDSPOT-AUDIT.md` finding #3
("the repeatable multi-week oscillator — the fang quadrant"). READ-ONLY: read code, ran
`oscillationVsKnife` (already in the tree) against archived market history, produced this doc.

**Honesty up front (CLAUDE.md rule 4).** The headline result below is a genuine surprise that
changes the shape of the ask: **this is substantially already built**, not a green-field gap —
but the live test run in §3 also surfaces a real calibration problem with the existing detector
that the blindspot audit didn't know to look for. Read that section before concluding anything.

---

## 1. The premise, and why it's now stale

The blindspot audit (2026-07-24) framed finding #3 as: *"the niche taxonomy is 3 cycle periods
on one axis — band (~2h), amplitude (~24h), value (7d+, one-shot) — nothing models 'repeats
every ~6–8 days.'"* That framing is **out of date the same day it was written**. A full six-chunk
program, `PLAN-OSCILLATION-CYCLE.md` (designed + landed 2026-07-22, plus five lettered
follow-ups F-A through F-H), already built almost exactly this:

- **Detection** — `oscillationVsKnife(days)` in `js/forecast.mjs` (redesigned at F-A): detrends
  daily mids against the shared trend line, walks the residuals into same-direction "legs", and
  calls an item OSCILLATING when it has ≥`OSC_MIN_LEGS=3` real legs (≥2 direction reversals)
  clearing an amplitude-vs-noise-floor bar. This is a genuine multi-leg period-shape detector,
  not a threshold tweak.
- **Margin gate** — `amplitudeGate` (`js/amplitudescreen.mjs`, Chunk 3) computes
  `driftAdjustedPeak` (the diurnal peak projection shifted by the multi-week ceiling/floor slope)
  and rejects on `margin-below-floor` when the drift-adjusted after-tax margin doesn't clear —
  **direction-agnostic**: it doesn't care if the item is drifting up or down, only whether the
  amplitude clears the drift + tax. Pinned against both a fang down-leg fixture AND an Aldarium
  rising-floor mirage fixture (both correctly reject on the same reason).
- **Discoverability fix** — F-B added a `watchlist.json` fetch-pool RESERVE so a named oscillator
  bypasses the amplitude Stage-1 proxy floor even if it doesn't rank in the top-N by daily-swing
  proxy; F-D separately widened `AMP_TOP_DEFAULT` 25→40 generally. Fang, Toxic blowpipe (empty),
  and Dragon boots are **already on `watchlist.json`** (Ben, 2026-07-22) specifically to ride
  this reserve.
- **Re-entry, not close-out** — `watch-positions.mjs --cycle` (Chunk 4) is the adaptive loop
  Ben's memory anchor asks for: it persists a per-item expected trough/peak in
  `cycle-watch.json`, ticks a `trackError()` comparator each pass, revises the next expected dip/
  peak as reality diverges, and (per the cyclewatch test suite) has a reset/recycle path —
  i.e. after a leg completes it re-arms for the next one rather than terminating. This is the
  literal mechanism the `multi-week-oscillator-class` memory describes ("when fang sells at
  peak, RE-ENTER the next floor, don't close out").
- **Retro loop** — F-G wired a real-fill amplitude retro into `analyze-record.mjs` (zero new join
  code — the existing per-niche outcome aggregator already handles a closed amplitude round-trip)
  so accrued real fills will eventually judge whether "oscillating + positive drift margin"
  actually predicts profit. It reports "awaiting real fills" today (n=0) — honestly gated, not
  hidden.

**What's true and NOT yet built:** it isn't its own flip-niche with a ~week `defaultPath`/hold
horizon in `js/flip-niches.mjs` — it lives as a temper inside the amplitude lane's knife guard,
still framed around a ~1–1.5 day hold (`AMP_HOLD_DAYS`). The `--cycle` watch loop is the piece
that actually carries a multi-day expectation forward; the *discovery* surface (the scan table)
still prices/labels these as amplitude (1-day) plays. Whether that mismatch matters in practice
is closer to a framing/labeling question than a missing-detector question at this point.

**Process note:** `PLAN-OSCILLATION-CYCLE.md` is a per-topic doc that should have folded into
`PLAN.md` and been deleted once its chunks shipped (the CLAUDE.md convention) — it is still at
the repo root because Wave 3 (digest denoising) has deferred phases (W3-3, Phase 2). That's
administrative debt, not something this doc needs to fix, but it explains why the blindspot audit
missed the existing work: the per-topic doc never got folded into the one place (`PLAN.md`) an
auditor would think to check for "has this been built."

---

## 2. What the audit's own anchor (fang, n=1) still doesn't establish

Even with the detector built, the blindspot audit's underlying question — **does the
repeatable-multi-week shape generalize beyond fang, or is fang a lucky accident?** — was never
answered. `PLAN-OSCILLATION-CYCLE.md`'s own walk-forward explicitly flags this as unresolved:
its 3-item sample (fang, blowpipe, dragon boots) is called out in the plan's own honesty section
as "correlated items — all three trended down together this window," i.e. n≈1 regime, not n=3
independent confirmations.

This scoping pass ran the actual generalization check, using data the original walk-forward
didn't have access to a week ago.

---

## 3. New evidence this session — and the finding that reframes the ask

`pipeline/lib/archive.mjs` (the Tier-1 SQLite market archive, D0) now holds **1h data back to
2026-06-11** — 44 days, well past the wiki live endpoint's ~15–16 day ceiling that
`OSC_DETECTOR_NIGHTS=21` was noted as being "endpoint-capped" against. That's enough depth to run
`oscillationVsKnife` over a real ~24-day trailing window for a broad, UNCORRELATED basket, not
just the 3 known anchors.

Ran it (read-only, `node --check`-safe, no writes) against 23 unrelated big-ticket combat/skilling
items (Twisted bow, Scythe-adjacent gear, godswords, boots, defenders, staves, etc. — full list in
the script output, item ids resolved from `pipeline/.cache/mapping.cache.json`), each over a
24-day trailing window via `windowStats` + `oscillationVsKnife` exactly as `renderAmplitudeMode`
calls it:

```
Granite maul                     OSC legs=4    Amulet of fury               OSC legs=6
Dragonfire shield                OSC legs=6    Armadyl godsword             OSC legs=5
Bandos chestplate                OSC legs=6    Dragon boots                 OSC legs=6
Elysian spirit shield            OSC legs=4    Toxic blowpipe (empty)       OSC legs=5
Serpentine helm (uncharged)      OSC legs=5    Primordial boots             OSC legs=5
Abyssal bludgeon                 OSC legs=6    Dragon warhammer             OSC legs=7
Dragon claws                     OSC legs=5    Twisted bow                  KNIFE legs=2
Ghrazi rapier                    OSC legs=3    Avernic defender hilt        OSC legs=6
Sanguinesti staff (uncharged)    OSC legs=6    Lightbearer                  OSC legs=5
Osmumten's fang                  OSC legs=6    Ancient godsword             OSC legs=6
Zaryte crossbow                  OSC legs=3    Masori body                  OSC legs=5
Webweaver bow (u)                OSC legs=4
```

**22 of 23 (96%) read OSCILLATING.** Only Twisted bow reads KNIFE.

**Honest reading: this is not confirmation the fang-class shape generalizes — it's evidence the
detector, as currently calibrated (`OSC_MIN_LEGS=3`, `OSC_MIN_LEG_DAYS=2`,
`OSC_AMP_NOISE_MULT=1.5`), doesn't discriminate a rare "repeatable ~week-period" item from
ordinary big-ticket price wobble.** Almost every liquid big-ticket item has ≥3 detrended
direction-reversals over 24 days purely from normal volatility — that's a low bar to clear, not a
selective signature of a genuine repeating cycle. If the detector fired OSC on ~1 in 20 items,
that would be real corroborating evidence of a distinct fang-class quadrant; firing on 22/23 means
it's currently closer to "is this a non-monotone item" (almost everything, most of the time) than
"does this have a real ~6–8 day period." The function reports `legs`/`amplitude`/`slope` but not
leg-LENGTH or period regularity — it cannot currently distinguish a clean ~4-day-up/~4-day-down
rhythm (fang's actual described shape) from three ragged, irregularly-spaced swings that happen to
each clear the noise floor. That distinction is exactly what a period estimate would need to add,
and it doesn't exist today.

This matters for the audit's finding #3 in a specific way: it does NOT mean the fang anchor is
wrong or that no such class exists — it means **the currently-built detector cannot be used as
evidence either way**, because it says nearly everything qualifies. The margin-gate half (Chunk
3, whether the drift-adjusted economics clear tax) is the part doing real selective work today;
the oscillation/knife LABEL feeding into it is closer to a formality than a discriminator on this
basket.

---

## 4. What a real period-detector would need (scoping, not building)

If Ben wants to actually test "does item X repeat on a ~6–8 day clock" as a distinct, falsifiable
question:

- **Autocorrelation on daily mids**, not leg-counting. Compute the series' autocorrelation
  function (ACF) over lags 1–14 days and look for a genuine peak at lag ≈6–8 with an amplitude
  well above the lag-1 noise floor. A true periodic item shows a repeatable peak at its period and
  its harmonics (14–16d for a 7d period); a merely-volatile item shows a decaying ACF with no
  distinct peak. This is a different, stricter test than leg-counting and would likely fail on
  most of the 22 "OSC" items above.
- **Minimum history**: at least 3 full periods to distinguish a real ~6–8d cycle from noise
  (≥18–24 days) — the archive's 44 days now supports this where the live wiki endpoint's ~15–16
  day cap didn't (this is itself a small, concrete win from D0's archive existing — worth noting
  since `OSC_DETECTOR_NIGHTS=21`'s own comment flagged the endpoint cap as a known, unaddressed
  limitation as of F-H).
- **A genuinely separate hold horizon.** Even with a real period detector, nothing currently wires
  a ~6–8 day hold into the entry path or the estimator family — `estimator:'amplitude'` and
  `AMP_HOLD_DAYS` are tuned for the daily lane. Whether that's worth building as a `defaultPath`/
  estimator distinct from amplitude, or whether the existing `--cycle` watch loop (which already
  tracks an arbitrary multi-day expectation) is sufficient without a new niche, is a real open
  design question — not resolved here.
- **A join-in-progress that's already the right mechanism to lean on**: F-G's amplitude retro in
  `analyze-record.mjs` will eventually tell us, off REAL fills, whether "oscillating (by whatever
  detector)+positive drift margin" predicts profit. That's the honest gate this whole class should
  sit behind before more model work — not a new autocorrelation build first.

---

## 5. Verdict for Ben

- **Don't build a new "multi-week-oscillator niche" from scratch.** Most of the machinery already
  exists (`PLAN-OSCILLATION-CYCLE.md`'s Chunks 1–6 + F-A/F-B/F-D/F-G), console-only, behind a
  "do not trade on this yet" disclaimer, already covering fang/blowpipe/dragon boots via the
  watchlist reserve.
- **The one real open finding from this pass**: the `oscillationVsKnife` detector's
  OSC-vs-KNIFE label, tested against a broad unrelated basket for the first time, is not
  selective (96% OSC) — so it currently can't be used as evidence that the fang-class shape is
  common OR rare. This is worth a note in `PLAN-OSCILLATION-CYCLE.md`'s own honesty section (or a
  small follow-up chunk) rather than a new plan, since the fix (if pursued) is a metric refinement
  on an existing detector, not new infrastructure.
  - **MECHANISM FOUND, 2026-08-11 — this is no longer an open puzzle.** `OSC_MIN_LEGS` is an
    ABSOLUTE leg count over a variable-length window with no normalisation, so the label tracks
    SERIES LENGTH, not shape: 59.5% OSC at 14d → 88.9% at 21d → 99.9% at 60d on the real archive,
    and ~66% → ~100% by 30d on a synthetic DRIFTLESS RANDOM WALK with no cycle in the generating
    process at all. The 22-of-23 result above is that artifact, not a statement about big-tickets.
    Two consequences for this plan: (1) the "is the fang shape common?" question is still
    **unanswered** — nothing here measured it; and (2) a selective criterion WAS built and measured
    (repeated traversals of the same two levels + leg-regularity, firing on 26.2% of item-origins
    vs the detector's 98.4%) and **conditioning on it bought nothing** — the amplitude-matched
    persistence lift came out 0.70–0.83, i.e. it anti-selects. So a metric refinement alone does not
    unlock a lane. Full study + the caveat that it has ZERO big-ticket coverage (so the fang-class
    case remains genuinely unmeasured, not refuted): `pipeline/experiments/RANGE-PERSISTENCE-FINDINGS.md`.
- **Administrative**: `PLAN-OSCILLATION-CYCLE.md` should be folded into `PLAN.md` and deleted per
  the standing convention once Wave 3's deferred phases (W3-3, Phase 2) get a decision — flagging
  this since it's the reason the blindspot audit didn't find the existing work.
- **Real next step, if any**: let `analyze-record.mjs`'s F-G amplitude retro accrue real closed
  cycles (n=0 today) before building anything further. That is the actual falsification path for
  "does this class generalize" — an autocorrelation rebuild would be premature model work ahead of
  its own evidence gate, the same discipline `PLAN-REACH-CALIBRATION.md`'s AC1 already applied
  successfully to a different question (see `PLAN-REACH-VALIDATOR-AUDIT.md`, the companion doc to
  this one).
