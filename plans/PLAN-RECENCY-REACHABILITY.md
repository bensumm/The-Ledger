# PLAN-RECENCY-REACHABILITY — recency-aware "is the target legitimately reachable" read

Status: **PLAN ONLY — not implemented.** No tracked source changed. Prototype checks referenced
below were run ad hoc against the live wiki API and are not committed anywhere.

Owner note (rule 4, CLAUDE.md process rule 4 / user memory `docs-small-encode-in-scripts` /
`multi-week-oscillator-class`): everything here is honesty-labeled. Nothing in §2's "safe now"
column claims more than it can prove; anything with a calibration threshold is marked
**F1-GATED** and must not ship as a gate/verdict input until it clears F1's evidence bar, same as
the rest of this codebase's PLACEHOLDER constants (`FC_FLAT_FRAC`, `MARGIN_FADE_FRAC`, `ASYM_P_LO`,
etc. all carry the identical caveat already).

---

## 0. The reproduced anchor (Primordial boots, 2026-07-23)

Command: `node pipeline/commands/read-window-range.mjs "Primordial boots" --profile --nights N`

Ran N=14, N=7, N=5 back to back. Per-hour `low`/`high` columns are **byte-identical across all
three** (only the `n` sample-count column and which hours get the ⬆peak/⬇dip tag differ):

```
  00:00  low 18,887,894 · high 19,275,518   (identical at N=14, 7, 5)
  12:00  low 19,143,507 · high 19,554,413   (identical at N=14, 7, 5)
```

But the derived **PEAK WINDOW** differs:

| `--nights` | PEAK window | recent level (ASK) |
|---|---|---|
| 14 | 00:00–03:00 PDT | 19,252,194 |
| 7  | 12:00–16:00 PDT | 19,486,203 |
| 5  | 12:00–16:00 PDT | 19,486,203 |

Gap between the two labeled peaks: **19,486,203 − 19,252,194 = 234,009 gp** — inside the
150k–250k mislabel range the task description cites, confirmed live. On a ×4 lot that's ~936k of
mispriced exit guidance from trusting the 14-night default's window pick alone.

`--nights 3` returns `too thin to profile — need ≥4 traded days of hourly history` (the
`HOURPROFILE_MIN_DAYS = 4` floor in `js/windowread.mjs:863`).

---

## 1. Root cause of the frozen-`--nights` bug — CORRECTED DIAGNOSIS

**The initial diagnosis in this section was wrong and has been replaced.** The first pass of this
plan proposed rewiring `hourProfile`'s `recentN` to track the caller's `--nights` value. That is
**mis-targeted** — verified against the code, `recentN`/`RECENT_NIGHTS = 3` is not an oversight
local to `hourProfile`; it is a single, deliberate, repo-wide "recent = last 3 days" constant
(`js/windowread.mjs:71`) shared identically by:

| consumer | file:line | what it means there |
|---|---|---|
| `recencySplit` | `windowread.mjs:74,77,83` | the "recent 3/3 reached" hit-count split vs the full window |
| `recentQuant` | `windowread.mjs:94-95` | the "recent-3 ~50%" quantile level beside the full-window quantile |
| `hourProfile` | `windowread.mjs:911,932` | the per-hour `lowRecent`/`hiRecent` LEVELS |
| `askExitRead` | `windowread.mjs:481,488,496` | wires the same `recentN` into `recentQuant`+`recencySplit` for the ask-side read |
| `reachMargin` | `windowread.mjs:529` | the cushion-trend read's recent window |
| `reachableBand` | `windowread.mjs:820,825-826` | the pressure-band base center |

All of these are printed **side by side** on the same surfaces (`read-window-range.mjs --profile`,
`quote-items.mjs`, `screen-flip-niches.mjs`'s digest) and all mean "the last 3 days" by the same
convention. Rewiring `hourProfile`'s `recentN` alone to track `--nights` would desync its printed
`lowRecent`/`hiRecent` levels from the "recent 3/3" reach count and "recent-3" quantile rendered
right beside them on the exact same line — i.e. it would fix one number while breaking its
relationship to three others that are supposed to mean the same "recent" and currently do. That is
a regression, not a fix. **The frozen per-hour levels are recent-3 by convention, correctly — this
plan's Chunk 1 no longer touches that.**

**The actual mechanism behind the boots mislabel** is in the SHAPE/window-*detection* path, which
already does honor `--nights` — that's precisely why reducing `--nights` moved the peak label
00:00–03:00 → 12:00–16:00 in §0's reproduction. Tracing it:

```
js/windowread.mjs:930     const keep = new Set(allDays.slice(-nights));   // the nights-scoped day sample
js/windowread.mjs:937     const baseline = new Map([...dayMids].map(([day, mids]) => [day, median(mids)]));  // per-day median mid
js/windowread.mjs:946-947 const devLow = samples.map(s => ... s.low - baseline.get(s.day) ...);   // de-trended SHAPE
                           const devHi  = samples.map(s => ... s.hi  - baseline.get(s.day) ...);
js/windowread.mjs:975-976 const dipHour  = withLow.reduce((a, b) => (b.devLow < a.devLow ? b : a));
                           const peakHour = withHi.reduce((a, b) => (b.devHi > a.devHi ? b : a));
```

`devLow`/`devHi` are each hour's deviation from *that day's own median mid* — this de-trending is
deliberate and correctly documented (`windowread.mjs:933-936`: it cancels a multi-day price
*level* drift so the hour-of-day shape read isn't swamped by the item simply trending up or down).
But de-trending a LEVEL shift does nothing for a PHASE shift: if the hour that prints the daily
high **moves** (e.g. from the small hours to early afternoon) partway through the `nights` window,
averaging `devHi` per hour-of-day across all `keep` days blends the old-phase days and the
new-phase days into one smeared shape. At `nights=14`, the blend is dominated by however many of
those 14 days sat in the OLD phase, so the aggregate peak hour reported is stale; at `nights=5/7`,
the window only spans the NEW phase, so the shape read (correctly) reflects it. **This is a
shape-window-recency problem** — the de-trended shape is computed over a window that is too long
relative to how recently the diurnal phase itself shifted — **not a level/recentN problem.**

**Live evidence (2026-07-23, both confirmed against the owner's own book):**
- Primordial boots (§0): PEAK window 00:00–03:00 PDT (14-day) → 12:00–16:00 PDT (5/7-day).
- Black dragon leather: PEAK window 02:00–03:00 PDT (14-day) → 19:00–20:00 PDT (5-day) — a full
  phase inversion the 14-day read got wrong.
- Both declared exits were over-set off the stale 14-day read: boots' 19.33m ask reached only 1/5
  recent days (p80); leather's 4,450 ask reached 0/5 recent days (p100 — never touched in the last
  5 days at all).

**Correct behavior:** the fix is not "make the level recency-aware" (it already is, by the shared
3-day convention, correctly) — it is "detect when the shape/window read itself is stale," i.e.
surface a divergence flag comparing the shape computed at a short `nights` vs the 14-day default,
so a phase shift like leather's gets caught automatically instead of requiring a human to rerun
`--nights` three times by hand. That is Chunk 1 below.

---

## 2. Design for the five-question reachability read

Every row composes **existing** primitives — no parallel cycle-detection system. Each question
below: signal → recency lever → thin-sample degrade.

### Q1 — What's the typical cycle length?

- **Existing signal:** none, honestly. `amplitudescreen.mjs` (`js/amplitudescreen.mjs:1-30`) *assumes*
  a 24h cycle (`windowStats(series, { wStart:0, wEnd:0 })`, one bucket per calendar day) — it does not
  detect one. `hourProfile` also assumes 24h (buckets by hour-of-day, 0–23). `termstructure.mjs`'s
  `basePosition` (`js/termstructure.mjs:297-311`) reads a multi-day (14/28d) position but likewise
  never fits a period — it reports *where in the 14d range* the price sits, not *how long the
  oscillation actually takes*. Grepping the whole repo (`js/`, `pipeline/`) for
  `autocorrel|periodicity|cycle.?length|fft` returns **zero hits**. There is no periodicity/FFT/
  autocorrelation code anywhere.
- **Honest answer:** cycle-length is **not estimable** off ~a week of hourly data with anything
  resembling statistical rigor. A real autocorrelation-based period estimate needs many multiples
  of the candidate period to separate signal from noise — 5–14 days is at best 5–14 samples of a
  candidate 24h period, or well under one full cycle of a multi-week oscillator (the `fang` anchor
  in memory `multi-week-oscillator-class`: real period ~6–8 days, discovered only because Ben
  manually noticed it recur across *weeks*, not because any script measured it). **Minimal new
  computation, deliberately cheap and NOT a periodogram:** a coarse **daily-vs-multiday
  discriminator**, not a period estimate — compare `hourConcentration`'s per-day trough/peak-hour
  clustering (`js/windowread.mjs:1136-1170`, `rTrough`/`rPeak`) against `floorCeilingTrack`'s
  multi-day floor/ceiling slope classification (`js/windowread.mjs:321-363`). If hour-of-day is
  tightly concentrated (`clean: true`, `rTrough`/`rPeak` ≥ `HOURCONC_MIN_R`) **and** the multi-day
  floor/ceiling track reads `ranging`/`oscillating` (not a monotone trend) → label **"daily
  rhythm"**. If hour-of-day concentration is weak (`clean: false`) but the floor/ceiling track shows
  a clean oscillating pattern over many days → label **"multi-day rhythm, period unknown — do not
  force a 24h read"**. If neither → **"range-churn, no timing edge"** (ties directly into Q3). This
  is a 3-way *classification*, not a period-length *number* — reporting a number ("~6.4 day cycle")
  off 5–14 days of data would be exactly the "laundering a few days into a cycle" trap rule 4 warns
  against. **Degrade:** `hourConcentration` needs `HOURCONC_MIN_DAYS = 5` (`windowread.mjs:1133`);
  `floorCeilingTrack` needs `FC_MIN_DAYS = 5` completed days (`windowread.mjs:236`). Below either →
  "insufficient history to classify cycle type," never a guess.

### Q2 — Where are we in the cycle right now?

- **Existing signal, reuse as-is:** `diurnalPhase(profile, { now })` (`js/windowread.mjs:1088-1117`)
  already answers this for the *daily* clock — `in-peak`/`pre-peak`/`post-peak` off the profile's
  peak window vs the wall clock, plus `hoursToPeakClose`/`hoursToNextPeak`. For the *multi-day*
  clock, `basePosition(ts)` (`js/termstructure.mjs:297-311`) already returns `{ pct, days, label }`
  — e.g. "p18 of 14d range, range-bound" — which is a coarse multi-day phase read (low pct + falling
  shape ≈ near a trough; high pct + rising ≈ near a peak). **Recency enters via the diurnal window
  itself, not a `recentN` change** (§1's corrected diagnosis): `diurnalPhase` is a pure function of
  `profile.peak`, and `profile.peak`'s window ALREADY moves with `nights` today (that's why the
  boots/leather windows shifted in §0/§1's evidence) — the fix this section needs is not new math,
  it's knowing WHICH `nights` value to trust. That's exactly what Chunk 1's divergence guard exists
  to tell the caller: when the short-window and 14-day peak windows disagree, `diurnalPhase` should
  be evaluated against the SHORT window's `profile.peak` (the one the guard flags as current), not
  silently against whichever default happened to be passed in.
- **Degrade:** both already degrade cleanly (`diurnalPhase` → null on no peak window;
  `basePosition` → null below `BASEPOS_MIN_POINTS = 4`, `termstructure.mjs:295`).

### Q3 — Is there a genuine diurnal peak/trough, or range-churn with no timing edge?

- **Existing signal, reuse as-is:** `hourConcentration(series, { nights })` (`js/windowread.mjs:1136-1170`)
  is built for exactly this — the circular-concentration `clean` flag distinguishes "every day's
  trough/peak lands at ~the same hour" from "scattered around the clock." This is *narrower and
  more honest* than `hourProfile`'s aggregate dip/peak cluster width (its own header at
  `windowread.mjs:1119-1132` says so explicitly: an aggregate cluster can be narrow while individual
  days still wander inside it). **Recency enters** the same way as `hourProfile` — `hourConcentration`
  already takes `nights` directly (`windowread.mjs:1136`) and is NOT affected by the §1 bug (it computes
  its own per-day argmin/argmax fresh each call, no frozen `recentN` anywhere in it) — this is the one
  piece of the five-question read that is *already* recency-correct today.
- **Degrade:** `daysScored < HOURCONC_MIN_DAYS (5)` → `clean: null`-equivalent (the `clean` boolean
  itself requires `daysScored >= HOURCONC_MIN_DAYS`, `windowread.mjs:1167-1168`) — "not enough days
  to call it clean or churny," not a forced verdict.

### Q4 — Did we just buy during the peak? (entry-timing quality)

- **Minimal new computation** (genuinely missing today — nothing reads entry price against cycle
  phase at buy time): compose two already-existing reads *retrospectively*, anchored to the FIFO
  lot's buy timestamp instead of `now`:
  1. `basePosition`-style pctInRange **at the historical buy time** — needs `termstructure`'s
     lookback structure computed with the series truncated to "as of the buy timestamp" (a slice,
     not a new stat — `midsWithin`/lookback logic in `termstructure.mjs` already takes a series and
     a reference point; it is currently only ever called with `now`).
  2. `diurnalPhase`-style hour-of-day phase **at the historical buy time** — `hourProfile`'s dip/peak
     windows are stable properties of the item (not of `now`), so scoring "was 14:32 inside the
     20-day-old peak window?" only needs `inWindow(buyHour, peak.startH, peak.endH)`
     (`js/windowread.mjs:24-25`, already exported and pure) against the buy lot's local hour.
  3. Render: `"bought at 14:32 local — inside the PEAK window (12:00-16:00) · multi-day pctInRange
     p82 at entry (elevated)"` — a plain descriptive flag, not a verdict. This is genuinely new
     wiring (a few lines composing `inWindow` + a `termstructure` lookback against a historical
     timestamp instead of `now`), not new math.
  4. **F1-GATED, do not ship yet:** any "bought-at-peak ⇒ bad entry" cutoff/threshold/score. The
     descriptive flag above is safe to ship now (rule 4's "descriptive, safe now" column); a
     probability-of-good-entry number is not.
- **Degrade:** identical to `basePosition`/`hourProfile`'s existing floors — if the buy predates the
  archive's history depth, or the item's per-item 1h series doesn't reach back that far, the
  historical-phase read returns null (state "no history at entry time," never fabricate a phase).

### Q5 — When is our exit? (peak-window ETA + reachable price in that window)

- **Existing signal, reuse as-is:** `diurnalPhase`'s `hoursToNextPeak`/`hoursToPeakClose`
  (`windowread.mjs:1088-1117`) is the ETA; `askExitRead`/`reachMargin`
  (`windowread.mjs:472-577`) is the reachability-of-the-price-in-that-window check — cushion
  trend (fading/stable/extending), today's pace vs the reaching-day median at this hour, already
  wired symmetrically for ask/bid. `diurnalForecast` (`js/forecast.mjs:70` area) already projects
  the level forward. Nothing new needed here structurally — **the Q5 answer is corrupted whenever
  the 14-day default's SHAPE/window has gone stale relative to a recent phase shift** (§1's
  corrected diagnosis: `dr.ask`/`dr.bid` are derived from `hourProfile`'s peak/dip *window*, and
  that window is exactly what a phase shift like leather's silently mislabels at `nights=14`). The
  fix is Chunk 1's divergence guard (flag it) plus, when the guard fires, evaluating
  `askExitRead`/`reachMargin` against the SHORT-window `dr.ask`/`dr.bid` rather than the stale
  14-day one — no new composition beyond choosing the recommended window.
- **Degrade:** unchanged from today (`FIVE_MIN_MIN_DAYS`, `MARGIN_MIN_DAYS`, etc., all already
  degrade honestly per their existing headers).

---

## 3. Implementation plan (ordered chunks)

Legend: **[SAFE]** presentation/descriptive only, ships without calibration. **[F1-GATED]** needs a
threshold/verdict/probability validated against realized outcomes before it can gate/rank/verdict
anything — ships as an inform-only annotation at most, same discipline as every other PLACEHOLDER
constant in this codebase.

**Chunk 1 — [SAFE] Divergence guard: recent peak/dip SHAPE vs the 14-day default.**
- *What:* compute the peak/dip window (`hourProfile`'s shape/window detection, `windowread.mjs:930,
  937, 946-947, 975-998`) at a short recency (5–7 nights) AND at the 14-day default off the SAME
  already-fetched series (zero new fetch), then compare the resulting peak/dip *window* (start/end
  hours — not the level, which stays the shared recent-3 convention per §1). When the short-window
  and 14-day peak (or dip) window disagree beyond a threshold — different start/end hours by more
  than a small tolerance, e.g. the leather case (02:00–03:00 vs 19:00–20:00) or the boots case
  (00:00–03:00 vs 12:00–16:00) — flag `⚠ recent peak/dip window disagrees with the 14-day one —
  trust recent`. This is the alarm that would have caught both live mislabels automatically instead
  of requiring a human to rerun `--nights` by hand.
- *Why:* directly targets the actual mechanism identified in §1 — a diurnal PHASE shift blended away
  by the 14-day de-trended shape average, not a level/`recentN` issue. It is descriptive (states a
  fact: "these two windows disagree"), so it's safe to ship without calibration — the one F1-gated
  number inside an otherwise-safe chunk is the disagreement THRESHOLD itself (start with a generous
  placeholder — e.g. window start differs by ≥2h — clearly labeled PLACEHOLDER pending F1, mirroring
  `recencySplit`'s existing `RECENCY_DIVERGE = 1/3` pattern at `windowread.mjs:72`, the same shaped
  guard already shipped for the reach-count case). **Changes no existing numbers** — it only adds an
  alarm alongside the unchanged output, which is why this can be Chunk 1 (cheap, safe, no prerequisite).
- *Files:* `js/windowread.mjs` (a new small pure function, e.g. `diurnalWindowDivergence(profShort,
  profLong)`, mirroring `windowClearDiverges`'s existing shape at `windowread.mjs:651-656`); rendered
  from `pipeline/commands/read-window-range.mjs`'s `--profile` block (~line 169) and folded into
  `quote-items.mjs`'s diurnal note and `screen-flip-niches.mjs`'s digest diurnal column, since this
  becomes part of the DEFAULT validation trio per the task's requirement, not an opt-in flag.
- *Regression fixture:* `pipeline/test/windowread.test.mjs` — a synthetic series with an engineered
  phase shift partway through the 14-day history (flat peak at hour-H for the older days, hour-H′ for
  the most recent 5–7), asserting the guard fires at the short-vs-long comparison and stays silent on
  a stable-phase control series.

**Chunk 2 — [F1-GATED, calibration] Shorten the default shape-detection window (14 → 7 nights).**
- *What:* the deeper lever behind Chunk 1's alarm: rather than only flagging a stale 14-day shape
  read, consider shrinking `hourProfile`'s *default* `nights` for shape/window detection itself
  (independent of the shared `recentN=3` level convention, which is untouched) so the default read
  is less prone to blending a mid-window phase shift in the first place.
- *Why F1-gated, not safe:* this is a real stability-vs-recency tradeoff, not a pure descriptive
  add. A shorter default window reduces staleness risk (per the leather/boots evidence) but also
  shrinks the sample the shape/cluster detection fits over (`HOURPROFILE_MIN_DAYS = 4`,
  `DIP_CLUSTER_FRAC`, `HOURCONC_MIN_DAYS` all assume a certain depth) — a 7-day default could make
  the window MORE reactive to a single noisy day, trading one failure mode (stale phase) for another
  (jumpy phase). This needs the §4 backtest to show shortening the default actually improves
  predicted-vs-realized exit accuracy before it changes behavior for every surface that calls
  `hourProfile` with no explicit `nights` (a change with the same blast radius as the mis-scoped
  original Chunk 1 would have had, which is exactly why it's gated here instead of shipped bare).
  Chunk 1's divergence guard is the safe interim: it recommends trusting the recent window WITHOUT
  silently changing the default everyone else relies on.
- *Files (if/when it clears F1):* the `nights = 14` defaults in `hourProfile`'s callers
  (`read-window-range.mjs:169,228,274`, `quote-items.mjs:224,337,759,822`,
  `screen-flip-niches.mjs:939,1552,1682`, `watch-positions.mjs:850`) — a coordinated, evidence-backed
  change, not a silent one.

**Chunk 3 — [SAFE] Q1 cycle-type classifier (daily-rhythm / multi-day-rhythm / range-churn).**
- *What:* the 3-way composition described in §2 Q1 — `hourConcentration.clean` × `floorCeilingTrack`
  classification → one of the three labels, rendered as a plain descriptive note, never a gate.
  Independent of Chunks 1–2 — it reads `hourConcentration` (already recency-correct, see §2 Q3) and
  `floorCeilingTrack` (its own multi-day slope classifier), neither of which touch `hourProfile`'s
  `recentN` or its shape-window default.
- *Why:* answers Q1 honestly (a classification, not a fabricated period length) and is the thing
  that would catch a `fang`-shaped multi-week oscillator being forced through a 24h diurnal read.
- *Files:* `js/windowread.mjs` (new pure function composing two existing exported functions — zero
  new fetch, both already computed by any caller that runs `--profile`+`--trajectory` together).

**Chunk 4 — [SAFE] Q4 entry-timing composition (historical phase-at-buy).**
- *What:* the `inWindow(buyHour, peak.startH, peak.endH)` + historical-pctInRange composition from
  §2 Q4, surfaced on `/positions`' held-lot read (the one surface that has a FIFO buy timestamp in
  hand — `positions.json`'s `open` lots carry it already per `pipeline/FILLS-PIPELINE.md`). Should
  evaluate `peak.startH/endH` from whichever window Chunk 1's guard currently recommends (recent vs
  14-day) rather than blindly using the 14-day default, so a stale phase doesn't also poison the
  entry-timing read.
- *Why:* directly answers "did we buy at the peak," the question that motivated this whole plan
  (the blowpipe/dragon-boots anchors in memory `buy-soft-while-holding-for-peak`).
- *Files:* `pipeline/commands/quote-items.mjs` (the `--positions` held-lot block, ~line 759/822
  where `hourProfile` is already called); needs the historical-series-slice helper for
  `termstructure.mjs`'s lookback math (currently only ever evaluated at `now`) — small, additive,
  not a rewrite of `termstructure.mjs`'s existing API.

**Chunk 5 — [F1-GATED] Wire the divergence flag + cycle-type label into the default validation
trio for `/scan` + `/positions`.**
- *What:* once Chunks 1, 3, 4 are landed and stable, fold the divergence flag (Chunk 1) and the
  cycle-type label (Chunk 3) into the skills' default output — not behind `--profile`/`--trajectory`
  flags a human has to remember to pass, but automatically whenever a held/candidate lot's window
  read is rendered. This is the "part of the DEFAULT validation trio, not opt-in" requirement.
- *Why:* the whole point of this plan is that Ben should never again need to manually run
  `--nights 5/7/14` three times to catch a mislabel — the tool should flag it unprompted.
- *Files:* `.claude/skills/scan/SKILL.md`, `.claude/skills/positions/SKILL.md` (the judgment-layer
  prose that already routes to `read-window-range.mjs`/`quote-items.mjs` — per CLAUDE.md, this
  judgment layer lives in the skills, not CLAUDE.md itself); `pipeline/commands/screen-flip-niches.mjs`
  digest diurnal column; `pipeline/commands/quote-items.mjs --positions` block.
- *Gate:* labeled F1-GATED not because the divergence/classification labels themselves need
  calibration (they're descriptive, Chunks 1/3 already ship them) but because making them part of
  the *default* (always-on) output for every scan/positions pass is a workflow-surface decision that
  should wait until Chunks 1/3/4 have run for a while without producing noisy/wrong flags — i.e. this
  chunk is really "graduate Chunks 1/3 from opt-in flag to default render," gated on a quiet burn-in
  period, not on a numeric threshold.

**Chunk 6 — [F1-GATED] Any actual threshold tuning** (divergence-flag sensitivity, the Chunk 2
default-window shortening decision itself, "bought at peak" cutoff, cycle-classification
`HOURCONC_MIN_R`/`FC_FLAT_FRAC` retuning, a reachability probability).
- *What:* NOT built until §4's backtest produces real |predicted−realized| numbers per the existing
  F1 gate discipline (`join-outcomes.mjs`'s `n≥30 per cell` bar, `PLAN.md` row O1).
- *Why:* rule 4 — no calibration claim off n≈0.

---

## 4. Validation / hardening strategy

**Fixtures (chunk-adjacent, land with each chunk):**
- Chunk 1's divergence guard: `pipeline/test/windowread.test.mjs` already has synthetic `diurnal()`
  series generators used by the existing `hourProfile` tests (`pipeline/test/forecast.test.mjs`,
  `pipeline/test/oscillation-*.test.mjs` reuse the same generator). Add a fixture pair:
  1. A "stable phase" series where the peak/dip hour is constant across the whole history — the
     short-window (5–7 nights) and 14-day shape reads land on the SAME window → no flag.
  2. A "phase-shift" series with a KNOWN engineered peak-hour change partway through the 14-day
     history (flat peak at hour-H for the older days, hour-H′ for the most recent 5–7) — literally
     reproducing the Primordial-boots/black-dragon-leather shape synthetically — asserting the
     short-window read lands on hour-H′, the 14-day read lands nearer hour-H (blended/stale), and
     the divergence guard fires between them.
  This mirrors the existing `recencySplit`/`RECENCY_DIVERGE` test pattern already in
  `pipeline/test/windowread.test.mjs`, applied to window/shape comparison instead of reach-count.
- Chunk 3's cycle classifier: reuse `pipeline/test/oscillation-cycle.test.mjs`'s existing flat/
  trending/oscillating synthetic series as the three expected classifications.
- Chunk 2 (if it clears the F1 gate to become buildable): a fixture set comparing shape-detection
  accuracy (synthetic phase-shift series, varying how many days ago the shift happened) between a
  14-day and a 7-day default window, to give the F1 backtest something concrete to score before any
  live default changes.

**Backtest — join the recency read against realized fills (the RC/Ring-3 spine, not a parallel
one):**
- The repo already has the exact template for this: `pipeline/commands/join-amplitude-outcomes.mjs`
  is a "shadow both-leg replay" — for every past suggestion, replay whether the (bid, ask) pair it
  quoted would have filled within the stated hold horizon against the ACTUAL forward archive data,
  reporting an upper-bound would-have-filled rate, explicitly labeled as an upper bound (no
  queue/size/intra-day-order model), same honesty discipline this plan must inherit. The recency-
  reachability backtest should be built the same shape, NOT a new parallel pipeline:
  1. Log, at suggestion time, which `hourProfile` window (short vs 14-day, and whether Chunk 1's
     guard fired) and cycle-type classification (Chunk 3) produced the quoted ask/bid — this is a
     `suggestions.jsonl` shadow field addition, following the existing pattern other estimator
     families already use there (`amplitude`'s shadow block per `join-amplitude-outcomes.mjs`'s own
     header).
  2. A joiner (`join-recency-outcomes.mjs`, or fold into `join-outcomes.mjs`'s existing per-cell
     bucketing rather than adding a fifth standalone script — the RC co-log at
     `.claude/skills/morning/SKILL.md` Gate B already buckets a FIVE-way estimator co-log by
     (side × class × regime); the recency-aware ask/bid should become a sixth column in that SAME
     co-log, not a new gate letter) compares the recency-aware exit level against the level the
     stale 14-day default would have quoted, for every closed-sell round trip, and reports which one
     was closer to the realized fill.
  3. Gate discipline identical to Gate B/C in `.claude/skills/morning/SKILL.md`: nothing promotes
     off a single week; needs the same `n≥30`-per-cell (or the RC gate's own floor) bar before any
     claim "recency beats 14-day default" is asserted as validated, not just directionally
     plausible from the one reproduced anchor.
- **Primordial-boots / black-dragon-leather worked anchors:** the reproduced numbers in §0/§1 ARE
  the n=2 case this backtest needs to accumulate more of — record them as the first co-logged data
  points once Chunk 5 wires the shadow field, not as proof of anything on their own.

**What can't be validated yet (n≈0, be explicit):**
- Whether the SHORT-window (recent) peak/dip read is *actually* more predictive of the next fill
  than the 14-day default — both anchors show the two reads DISAGREED and give a plausible story
  for why recent should win (a visible phase shift toward a different hour-of-day), but "plausible
  on two items" is not "validated." This needs the backtest above to accrue real cells before Chunk
  2 (shortening the default) can be justified.
- Any cycle-length number (Q1) — explicitly declared inestimable off current history depth in §2;
  don't chase this until the archive is deep enough that autocorrelation over many multiples of a
  candidate period is even statistically meaningful (probably months, not days, for a multi-week
  candidate).
- Any "bought at peak = X% worse outcome" quantification (Q4) — the descriptive flag ships (Chunk
  4); the quantified claim needs the same retro-join volume as everything else in this section.

---

## 5. Honesty section (rule 4)

**Descriptive, safe to ship now (no calibration needed):**
- Chunk 1 (divergence flag) — states a fact ("the short-window and 14-day peak/dip windows
  disagree"), no threshold claims predictive power, and **changes no existing number** — it only
  adds an alarm beside unchanged output. The FIRE threshold itself is a placeholder (see below).
- Chunk 3 (cycle-type label) — a classification off already-existing, already-shipped primitives
  (`hourConcentration.clean`, `floorCeilingTrack.classification`), same honesty tier those already
  carry.
- Chunk 4 (entry-timing flag) — states where the buy fell relative to the window, no verdict
  attached.

**Hypotheses needing evidence before they gate/rank/verdict anything:**
- Any specific divergence-flag numeric threshold (Chunk 1's "disagrees enough").
- **Chunk 2 in full** (shortening `hourProfile`'s default shape-detection window from 14 to 7
  nights) — this is the one chunk in this plan that changes a live default's OUTPUT for every
  caller with no explicit `nights`, so it is gated behind the §4 backtest showing the shorter
  default actually improves predicted-vs-realized exit accuracy, not shipped off the two live
  anchors alone.
- Any cycle-classification threshold (`HOURCONC_MIN_R`, `FC_FLAT_FRAC` — both already documented
  PLACEHOLDERs in `windowread.mjs`, unchanged by this plan, just reused).
- "Short/recent window beats 14-day default" as a general claim (needs the §4 backtest, n≥30/cell).
- Any "bought at peak" outcome-quality number.
- Promoting Chunks 1/3 from opt-in flag to default-render surface (Chunk 5) — burn-in judgment call,
  not a numeric gate, but still not "ship day one."

**Small-sample traps to name explicitly:**
- **A "cycle" fit to 5 days is noise.** This plan explicitly does NOT attempt a period-length
  estimate (Q1) for exactly this reason — 5–14 days can't distinguish a real ~24h rhythm from a
  coincidental one, let alone measure a multi-week period like `fang`'s (memory:
  `multi-week-oscillator-class`).
- **The hour-of-day median blends reaching and non-reaching days.** `hourProfile`'s `lowRecent`/
  `hiRecent` are a median across whatever days land in the recency window (the shared `recentN=3`
  convention, §1) — a small recency value is still a median over very few points, which HIDES which
  specific days actually printed vs which didn't. The existing `recencySplit`/`reachedDays`
  machinery (which *does* report per-day hit/miss, not a blended median) is the mechanism callers
  should already reach for when they need "did it print on ≥X of the recent days," not
  `hourProfile`'s level alone — this plan does not change that distinction, only adds the divergence
  alarm on top of it.
- **A phase-shift blend is a DIFFERENT small-sample trap from a level blend**, and it's the one
  this plan's diagnosis corrects: the initial hypothesis (rewire `recentN`) would have "fixed" a
  level-blend framing of a problem that was actually a window/phase-blend — de-trending cancels a
  level drift but not an hour-of-day shift, so a 14-day de-trended shape average can silently blend
  an old phase and a new one into a stale composite. Catching this needed comparing two window
  reads against each other (Chunk 1), not adjusting one constant.
- **Two reproduced anchors are not a validated improvement.** Sections 0/1/4 are explicit about
  this: Primordial boots and black dragon leather show the divergence and give a plausible story
  for why recent should win, but neither has a realized sell to compare against yet (both were open
  positions at investigation time) — "plausible on two items" is not "validated." The backtest in
  §4 is the only path to that claim, and it needs many co-logged cells, not two lots.
