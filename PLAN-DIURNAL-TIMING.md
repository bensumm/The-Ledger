# PLAN-DIURNAL-TIMING — the timed-lap layer on every suggestion

Per-topic working doc (PLANNING.md lifecycle). HARDENED by Fable 2026-07-22 against the real
codebase. Status: ready for Ben's confirm on the two renamed/retuned constants (§3) and the
reconciliation scope (§5) before DT1 starts.

## Why (the finding) — unchanged

Every flippable item has **two viable paths**, and we only surface one on most rows today. See the
original finding below (kept verbatim — still the motivating case):

1. **Churn** — time-AGNOSTIC: cycle the buy limit near band-low→top, many thin laps/day (bolts ≈ +17/u).
   Ranked today (throughput). This is on the board.
2. **Diurnal "buy softest"** — time-TARGETED: bid the daily trough hour, sell the daily peak hour,
   ~1 cycle/day, fatter lap. For bolts on 2026-07-21 this was
   `buy 2,816 @02:00 → sell 3,030 @20:00 = +214 gross ≈ +154/u (5.5%)`.

## ⚠ LOAD-BEARING CORRECTION — this is NOT a new read, it's an existing one that needs richening

The investigation found that **path 2 is already on the board, in three places**, via
`hourProfile` + `deriveDiurnalRange` (`js/windowread.mjs`):

1. **`screen-flip-niches.mjs`** (`renderMode`, ~L1312–1353) — the "Diurnal timing" extraSection:
   bid/ask, net/roi, `trendDominates` flag, a `★` clean-candidate flag, and the `⏲` diurnalPhase
   entry-timing token. Printed for the niche's TOP PICKS only (rows with `r.prof`/`r.dr` already
   computed in the survivor loop above), band/churn/scalp niches only (`renderAmplitudeMode` and
   `renderValueMode` are separate functions that don't call this block).
2. **`quote-items.mjs`** (~L337–348, shared by the bare-quote AND `--positions` code paths) —
   pushes a **typed** `{ kind: 'diurnal', text }` note (already registered in `render.mjs`
   `NOTE_KINDS.diurnal`, prefix `'  ↳ '`, tier `context`) with the identical bid/ask/net/roi text,
   computed per row whenever `hourProfile` succeeds. Degrades **silently** (no note) when the
   profile is null/thin — there is no `n/a` marker today.
3. **`watch-positions.mjs`** (~L754–758, L813–818) — calls `hourProfile`/`deriveDiurnalRange`
   directly twice: once to shadow-log `{bid,ask}` alongside the window-clear ask-rung outcome
   record, once as the `diurnalAsk` fallback exit price for the cycle-watch loop.
4. **`js/trends.js`** (the APP's Trends tab, NOT pipeline) — imports `hourProfile`,
   `deriveDiurnalRange`, `windowStats` from `js/windowread.mjs` and `diurnalForecast`/
   `driftExitFrom` from `js/forecast.mjs` **directly**, and renders its own diurnal chart, a
   locally-computed `clean` → `★` badge, the forward forecast section, and the drift-adjusted
   exit line. **This answers open question #3 the OPPOSITE of the plan's default assumption: an
   app surface already renders diurnal timing.** (The `net`/`roi` computed inline at
   quote-items.mjs L341 is also just `Math.round(dr.ask - tax(dr.ask) - dr.bid)` — algebraically
   `netMargin(dr.bid, dr.ask)` from `js/money-math.js`, hand-inlined rather than called. Prefer
   calling `netMargin` in the new code so there is one tax-arithmetic call site, not two.)

**Consequence:** adding a second, sibling `⧗ diurnal` note beside the existing `↳ diurnal` note on
the same row — as drafted — is precisely the two-homes anti-pattern CLAUDE.md's process rule §8
and the 0.30→0.33 `momVerdict` story warn against: two notes computing overlapping bid/ask/net/roi
numbers on one row that could visibly disagree the moment one drifts. **DT4's "one shared call
site" guarantee mechanism already has the right instinct — it just needs to point at the EXISTING
three (four, with trends.js) call sites, not add a fourth kind alongside them.**

### The resolution (open question #5, resolved concretely)

`diurnalTimedLap` is not a parallel computation — it is `deriveDiurnalRange`'s output, EXTENDED
with the genuinely new fields (recent-3 trend, liquidity pools, tranche sizing, the concentration
classifier), then **substituted into the same three-plus-one call sites** so there is exactly one
rendered diurnal note per row, richer than before. No new `NOTE_KINDS` entry, no new sigil — the
existing `diurnal` kind's text simply grows. Concretely:

```js
// js/windowread.mjs — NEW, additive, calls existing fns, adds nothing that forks their math
export function diurnalTimedLap(series, { nights = 7, recentN = RECENT_NIGHTS, buyLimit = null, volDay = null } = {}) {
  const profile = hourProfile(series, { nights });
  if (!profile) return null;                                  // degrade — see §4 on what "degrade" means downstream
  const dr = deriveDiurnalRange(profile, { liveLo, liveHi });  // liveLo/liveHi passed by caller (already in hand)
  if (!dr || dr.bid == null || dr.ask == null) return null;
  // ... recent-3 trend, reach, liquidity, tranche — see §2/§3 below, all NEW math
  return { ...dr, lowTrend, hiTrend, bidReach, askReach, dipPool, peakPool,
           trancheComfort, trancheCeiling, clean, holdHrs, degraded: false };
}
```

DT2/DT3 then change the THREE existing call sites (screen inline block, quote-items note push,
watch-positions shadow calls) to call `diurnalTimedLap` once and render the extended text, instead
of calling `hourProfile`+`deriveDiurnalRange` separately as they do today. **DT5 (new, added below)**
reconciles `js/trends.js`'s locally-computed `clean` badge onto the same classifier — see §6.

## §1 — the new fields, precisely

| field | source | status |
| --- | --- | --- |
| `bid`/`ask`/`bidBasis`/`dipWindow`/`peakWindow`/`trendDominates` | `deriveDiurnalRange` (unchanged, reused) | existing |
| `net`/`roi` | `netMargin(dr.bid, dr.ask)` — the TIMED lap (trough→peak) — from `js/money-math.js` (not hand-inlined) | existing math, new call site |
| `instantNet`/`instantRoi` | **COMPUTE BOTH (Ben 2026-07-23):** median over scored hours of `netMargin(h.avgLowPrice, h.avgHighPrice)` — the SAME-HOUR/churn flip margin. On a big-ticket the instant and timed answers DIVERGE (blowpipe: instant ≈ −14k tax-negative, timed ≈ +230k positive) and both are useful — the note renders both. | new, real reuse |
| `holdHrs` | `(peakHr − dipHr.atHour) mod 24` off `profile.dip.atHour`/`profile.peak.atHour` | new, trivial |
| `lowTrend`, `hiTrend` | `projectTrajectory(windowStats(series,{wStart:0,wEnd:0}).days, n=>n.low/n.hi, {recentN})` — REUSES the existing recency-weighted slope primitive (`js/windowread.mjs`), not a new trend fit | new, real reuse |
| `bidReach`, `askReach` | see §2 — REUSES `recencySplit`, corrected from the draft's "reuse `amplitudeRanges`" | new, corrected reuse |
| `clean` | see §3 — a genuinely NEW metric, not reusable from `oscillationVsKnife` or `amplitudeRanges` | new |
| `dipPool`, `peakPool` | `windowStats(series,{wStart:dip.startH,wEnd:dip.endH}).medVolLo` / the peak-window twin's `medVolHi` — REUSES `windowStats`, zero new bucketing code | new, real reuse |
| `trancheComfort`, `trancheCeiling` | see §4 — retuned against the actual reach-relief evidence | new, corrected constants |

## §2 — correcting "reuse `amplitudeRanges`" (open question #1/reach)

`amplitudeRanges(stats, live, opts)` does not accept an externally-supplied trough/peak level —
it **derives its own** `ampBid`/`ampAsk` via `quantLow(stats.lows, bidQ)` / `quantHigh(stats.his, askQ)`
(median-by-default) off whatever `windowStats` slice you hand it. If DT1 calls `amplitudeRanges`
wholesale on a `windowStats(series, {wStart: dip.startH, wEnd: dip.endH})` slice, it will produce a
**second, independently-derived trough level** (the median LOW across all hours inside the dip
window, treating every in-window hour equally) that can silently diverge from `hourProfile`'s
`dip.level` (a cluster-grown median off the SPECIFIC contiguous low-deviation hours,
de-trended by the per-day baseline). Two numbers claiming to be "the trough" on one row is a
two-homes bug at the NUMBER level, not just the note-text level — worse, because it's invisible
until they disagree.

**The correct reuse is the primitive `amplitudeRanges` itself calls internally: `recencySplit`.**
Call it directly against the levels `hourProfile` already chose:

```js
const winStats = windowStats(series, { wStart: profile.dip.startH, wEnd: profile.dip.endH, nights });
const bidReach = winStats ? recencySplit(winStats.days, 'bid', dr.bid, recentN) : null;
const peakStats = windowStats(series, { wStart: profile.peak.startH, wEnd: profile.peak.endH, nights });
const askReach = peakStats ? recencySplit(peakStats.days, 'ask', dr.ask, recentN) : null;
```

This is the SAME pattern `askExitRead`/`reachMargin` already use (score a given level against a
window-scoped `windowStats`, not re-derive the level). It gives an honest "does the QUOTED level
print inside its own hour-window on ≥N/recentN days" read with zero risk of a second trough
definition. Do not import `amplitudeRanges` for this feature at all — the plan's "reuse
`amplitudeRanges`" language should be read as "reuse the primitives amplitude is built from,"
not "call the amplitude wrapper function."

## §3 — the clean-cycle vs range-churn concentration metric (open question #1/design)

Neither existing detector answers this. `oscillationVsKnife` (js/forecast.mjs) detrends the
**daily MID series across the whole window** and counts real multi-day LEGS — a multi-day
drift-vs-cycle read (fang/blowpipe's ~6–8 day swing), completely orthogonal to "does the trough
happen at the same hour-of-day each day." `hourProfile`'s dip/peak CLUSTER width (`DIP_CLUSTER_FRAC`)
is closer but still measures something different: the width of the low-price plateau in the
**aggregate, de-trended 24h profile**, not whether each individual day's trough hour lines up. An
item could have a narrow aggregate cluster while its per-day trough hour still wanders inside that
cluster's span, or vice versa — the two are correlated but not the same signal, and the plan's own
fixtures (bolts trough hours 00-05 vs chin's 00:00/17:00/03:00) are stated in per-day-hour terms, so
the metric must be built on that basis.

**New pure function**, homed in `js/windowread.mjs` beside `hourProfile`:

```js
export const HOURCONC_MIN_DAYS = 5;   // fewer scored days than this ⇒ null (can't judge concentration)
export const HOURCONC_MIN_R    = 0.6; // PLACEHOLDER, n≈0 — circular concentration floor for "clean"

export function hourConcentration(series, { nights = 14, now = new Date() } = {}) {
  // 1. bucket `series` by LOCAL calendar day (reuse windowStats' day-grouping convention).
  // 2. per day: troughHour = argmin(avgLowPrice) hour-of-day; peakHour = argmax(avgHighPrice) hour-of-day.
  // 3. circular concentration R of each hour list: θ_i = 2π·h_i/24; R = |mean(e^{iθ_i})| ∈ [0,1].
  //    R→1 = every day's extreme falls at ~the same hour; R→0 = scattered uniformly round the clock.
  // 4. clean = daysScored >= HOURCONC_MIN_DAYS && Rtrough >= HOURCONC_MIN_R && Rpeak >= HOURCONC_MIN_R.
  return { troughHours, peakHours, rTrough, rPeak, daysScored, clean };
}
```

Circular concentration (the mean resultant length, a standard circular-statistics measure) is the
right tool because hours wrap at 24 — a plain variance of the raw hour numbers would wrongly
penalize a trough that sits at 23:00 on one day and 01:00 the next as "scattered" when it's
actually tightly clustered around midnight. **Deterministic and unit-testable**: feed a synthetic
per-day trough-hour fixture `[1,2,1,3,2]` (bolts-shaped, expect R ≈ 0.9+, `clean: true`) against
`[0,17,3]` (chin-shaped — three points ~120° apart on the 24h circle, expect R ≈ 0.1–0.3,
`clean: false`). Both `HOURCONC_MIN_DAYS`/`HOURCONC_MIN_R` are named PLACEHOLDER constants, n≈0,
same honesty discipline as every other threshold in this file.

This does NOT replace `oscillationVsKnife` (still the right tool for the multi-week drift-vs-knife
question elsewhere) or `hourProfile`'s cluster width (kept as-is, still drives the dip/peak WINDOW
boundaries the bid/ask levels quote against) — it is a third, narrower classifier answering a third,
narrower question. Do not print all three; `diurnalTimedLap`'s `clean` field is `hourConcentration`'s
verdict alone.

## §4 — the tranche heuristic, retuned against the ACTUAL evidence (open question #2)

The draft's constants (`trancheComfort` ~1%·volDay, `trancheCeiling` ~2.5%·volDay) were checked
against a **misremembered** version of the reach-relief finding. The actual documented finding
(`js/estimators/reach.mjs` header, "REAL-FILL FOLLOWUP 2026-07-17, n≈6 items", also cited in
`.claude/skills/scan/SKILL.md` and `PLAN-REACH-CALIBRATION.md`) is:

> the relief-collapse point tracks tranche-size-as-%-of-daily-volume … **clean under ~0.5%,
> visibly degraded ~0.7–1%, gone by ~5–7%** … that measured degradation knee (~0.5–1% of daily
> volume) sits BELOW the coded `REACH_RELIEF_SIZE_FULL` of 2%.

The draft's 2.5%-of-volDay `trancheCeiling` sits **2.5–5× past** the "visibly degraded" evidence
band — it is not a safe ceiling by the only real-fill data this repo has; it is already inside
(or past) the "expect a materially worse realized net than quoted" zone. This is the single most
consequential correction in this hardening pass because it changes the headline numbers Ben will
see on every row, not just an internal implementation detail.

**Retuned constants (still PLACEHOLDER, n≈0 for THIS specific use — the n≈6 evidence is a
different feature's calibration and is borrowed as the best available anchor, not validated for
diurnal tranches specifically — say so in the code comment):**

```js
export const DT_TRANCHE_COMFORT_VOL_PCT = 0.005;  // ~0.5%·volDay — the n≈6 "clean" edge
export const DT_TRANCHE_CEILING_VOL_PCT = 0.01;    // ~1%·volDay — the n≈6 "visibly degraded but still executable" edge
trancheComfort = Math.min(buyLimit, DT_TRANCHE_COMFORT_VOL_PCT * volDay, 0.15 * peakPool);
trancheCeiling = Math.min(2 * buyLimit, DT_TRANCHE_CEILING_VOL_PCT * volDay, 0.25 * peakPool);
```

**Recomputed session anchors (replacing the draft's ✓-checked numbers):**

| | vol/d | buyLimit | peakPool | comfort = min(limit, 0.5%vol, 15%pool) | ceiling = min(2×limit, 1%vol, 25%pool) |
| --- | --- | --- | --- | --- | --- |
| bolts | 858k | 11k | ~448k | min(11k, 4.3k, 67.2k) = **~4.3k** | min(22k, 8.58k, 112k) = **~8.6k** |
| chin | 420k | (n/a) | ~132k | min(_, 2.1k, 19.8k) = **~2.1k** | min(_, 4.2k, 33k) = **~4.2k** |

Both anchors land materially SMALLER than the draft's "~10k comfortable / ~20k ceiling" — because
the draft's ceiling constant was checked against the wrong reference threshold (2%, the coded-but-
not-evidenced `REACH_RELIEF_SIZE_FULL`) rather than the evidenced knee (~0.5–1%). **Binding
constraint**: in both anchors the volDay-percentage term binds tightest — confirms the plan's
assumption that the sell-side pool is usually NOT the binding constraint at these smaller
percentages, but that conclusion should be re-verified with a THIRD fixture where `peakPool` is
deliberately thin relative to `volDay` (e.g. an item whose trade concentrates off-peak), so the
`min()` correctly falls through to the pool term in the unit tests — don't only pin the two cases
where volDay wins.

**Anything sized above `trancheCeiling` must render an explicit caveat** ("expect a worse realized
net than quoted at this size — n≈6 reach-relief finding, not validated for diurnal specifically"),
never a bare bigger number.

## §5 — the item separator (open question #4)

`render.mjs`'s section model has no existing "block-grouping" primitive, but building one is
unnecessary and carries real regression risk. **Recommendation: use a plain empty-string note item
as the separator**, not a new render primitive:

```js
notes.push('');           // a bare '' string — formatNote() passes strings through unchanged (line 114),
                           // so this renders as a blank line with ZERO changes to render.mjs, ZERO new
                           // section type, and ZERO change to the notes[] item count/shape a consumer
                           // might index into.
```

This is lower-risk than restructuring `sections[]` into one `notes` section per item (the
alternative considered and rejected): that restructuring changes `report.sections`'s length/shape,
which risks two things worth checking before ANY sections-shape change: (1) `pipeline/lib/cli.mjs`'s
`writeLastReport` dumps `sections[]` verbatim to `pipeline/.cache/last-report/<kind>.json` for the
agent `--quiet` read path — an agent consumer that does positional indexing (`sections[2]`) rather
than filtering by `type`/`kind` would silently misread; (2) `render.mjs`'s own `renderHtmlTable`
(the app's Scan tab) builds its HTML from the SEPARATE `cells`/`rows` path in `screen.json`, NOT
from `sections[]` at all — confirmed safe, the app's Scan tab is unaffected either way. Still,
grep every `report.sections` / `.cache/last-report` consumer for positional access before landing
DT2 if the empty-string approach is ever abandoned in favor of restructuring.

**Fixture pin**: extend `pipeline/test/render.test.mjs` with a case asserting `formatNote('')` (or
the render of a `''` item) produces exactly one blank line, and a screen/quote fixture asserting a
blank line appears between two items' note blocks and NOT within one item's block.

## §6 — the `js/trends.js` reconciliation (new — DT5)

`js/trends.js` already computes its own ad hoc `clean` boolean (concentrated dip/peak windows +
`!trendDominates` + a ROI floor — the same shape as `screen-flip-niches.mjs`'s inline `candidate`
predicate) to decide whether to show the `★` badge on its diurnal chart. Once `hourConcentration`
(§3) exists as the canonical "is this a real diurnal cycle" answer, leaving `trends.js`'s
independent predicate in place is exactly the two-competing-definitions failure this file exists to
avoid — just at the METRIC level instead of the NOTE-TEXT level (§0's resolution only fixed the
latter). **DT5**: swap `trends.js`'s local `clean` computation for `hourConcentration`'s `clean`
field (or the fuller `diurnalTimedLap` if trends.js also wants the tranche/liquidity fields — likely
not needed there, the Trends tab's own per-item context makes tranche sizing less relevant, but
`clean`/`lowTrend`/`hiTrend` are natural adds to the existing chart). **This chunk bumps
`APP_VERSION`** (`js/state.js`) per process rule 5 — it is the one point in this program that
touches deployed app rendering, not pipeline stdout. DT1–DT4 proper (pure fn + pipeline wiring) do
NOT require a bump on their own, correcting the plan's "default assumption = pipeline-only, no
bump" — that assumption was right for DT1–DT4 in isolation but wrong for the program as a whole
once DT5 is counted, and DT5 must not be silently dropped as a "someday" follow-up (the exact
failure mode process rule §8 warns about: a new section landing while an old, now-contradicting one
is left in place).

## §7 — the always-emit / honest-degrade contract, softened

The draft's guarantee mechanism #2/#3 wants an explicit `⧗ diurnal: n/a (no 1h series this pass)`
line printed for EVERY survivor row, enforced by a coverage test on the RENDERED text. Recommend
splitting this into two separate guarantees, because forcing a rendered `n/a` line on every thin/
new/cold item would flood every screen pass (many rows are naturally sub-`HOURPROFILE_MIN_DAYS`,
e.g. a newly-tracked item) with a line carrying zero information — a regression in the "actionable
first, dead last" ordering discipline the user has flagged before:

1. **Data guarantee (hard, CI-enforced)**: the per-row COMPUTED structure — the object screen/
   quote/watch already builds per row before rendering — always carries a `timedLap` field, either
   the `diurnalTimedLap` result or `{ degraded: true, reason: 'no-1h-series' | 'thin-history' }`.
   The DT4 coverage test asserts against THIS structure (or the `suggestions.jsonl` shadow-log
   entry DT4 adds), not the console text stream — robust to future render-format changes and
   trivially fast to check.
2. **Render guarantee (soft, existing precedent)**: the rendered `↳ diurnal` note follows the SAME
   pattern `validator`/`staleLive` notes already use — it prints when there's something to say
   (a value, OR a degrade worth flagging on a row Ben would otherwise expect one for, e.g. a
   previously-clean item that just went thin) — not unconditionally on every cold/new row. The
   existing paste-trim collapse still applies on top.

This keeps "every row is COVERED" (testable, never silently skipped) without making "every row
PRINTS a line" (which the draft conflated with it) — flag this split explicitly to Ben as a
judgment call, since the draft's sample output implies the opposite; either is buildable, but the
softened version is the safer default given the existing render conventions. **CONFIRMED by Ben
2026-07-23: take the softened version** — compute every row (CI-enforced at the data/shadow-log
level), print only when there's something to say.

## Implementation sequence (revised)

- **DT1 — pure fns + unit tests.** `js/windowread.mjs` gains `hourConcentration` (§3) and
  `diurnalTimedLap` (§0/§1, composing `hourProfile` + `deriveDiurnalRange` + `recencySplit` on
  window-scoped `windowStats` slices (§2) + `projectTrajectory` for `lowTrend`/`hiTrend` +
  `netMargin` from `js/money-math.js` for `net`/`roi`). New constants `HOURCONC_MIN_DAYS`,
  `HOURCONC_MIN_R`, `DT_TRANCHE_COMFORT_VOL_PCT`, `DT_TRANCHE_CEILING_VOL_PCT` (§4). Pins in
  `pipeline/test/windowread.test.mjs`: bolts-clean fixture (R high, tranche per §4 table),
  chin-scatter fixture (R low), degrade (no ts1h / < `HOURCONC_MIN_DAYS`), the corrected tranche
  arithmetic against ALL THREE anchor rows (vol-bound, AND a thin-peakPool fixture that exercises
  the pool-bound branch), the recent-3 rising-base flag (bolts' 2800→2816→2948 case).
- **DT2 — screen-flip-niches.mjs wiring + item separator.** Replace the inline "Diurnal timing"
  extraSections block (~L1312–1353) with a call to `diurnalTimedLap`; extend from top-picks-only to
  every niche survivor (posture/paste-trim still collapses the dust tail for READABILITY, not
  coverage — §7's data guarantee is what's actually enforced). Item separator via the `''` empty
  note item (§5). No new `NOTE_KINDS` entry.
- **DT3 — quote-items.mjs / watch-positions.mjs wiring.** Replace the existing `kind:'diurnal'`
  push in `quote-items.mjs` (~L337–348, covers bare-quote AND `--positions`) and the two direct
  `hourProfile`/`deriveDiurnalRange` call sites in `watch-positions.mjs` (~L754, ~L816) with
  `diurnalTimedLap`. Same `NOTE_KINDS.diurnal` kind, richer text.
- **DT4 — coverage test + shadow-log.** CI structural test asserting the §7 DATA guarantee (not
  rendered text) on a fixture screen pass. `pipeline/lib/suggestlog.mjs` `suggestionEntry` gains an
  optional `timedLap` field (mirrors the existing `amplitude`/`winClear`/`windowExit` fields — same
  file, same pattern, log only what's honestly computed).
- **DT5 — `js/trends.js` reconciliation (new, §6).** Swap the Trends tab's local ad hoc `clean`
  predicate for `hourConcentration`'s verdict (and optionally fold `lowTrend`/`hiTrend` into the
  existing chart annotations). **Bumps `APP_VERSION`** — the one chunk in this program that
  touches deployed app rendering.
- **DT6 — the "base position" note (multi-week, Ben 2026-07-23).** _Motivation:_ this session
  proved the intraday/recent reads (DT1–DT5) are necessary but NOT sufficient — three live cases
  needed the MULTI-WEEK shape to price correctly. Bludgeon read "+180k flip" (scan-smoothed) → "knife"
  (3-day grid) → "low end of a mean-reverting range, a value level" (90-day base) — only the third was
  right. Fang read "oscillator at a floor" (14d) → "decaying oscillation in a downtrend" (90d). The
  distinguishing signal is **where live sits in the multi-week daily-low distribution + the multi-week
  regime (range-bound vs trending vs decaying)** — which DT1's recent-3 `lowTrend` cannot see (it's a
  3-day slope). Add a **light** base-position field to the row: `base pXX of the <N>d range · <range-bound|
  trending↑/↓|decaying>`, where the percentile is live-vs-the-multi-week daily-low distribution.
  _Data source — the scope constraint (Ben-flagged):_ this needs DAILY/multi-week data, NOT the 1h
  series DT1 rides. **Do NOT do a live 90-day 6h fetch per row** (too heavy × 40 rows/scan). Instead
  **reuse the value flip-niche's existing term-structure** (`js/termstructure.mjs` — it already computes
  live-vs-multi-week-low, recency-anchored range, off the **daily archive already on disk, ~20–30d,
  zero extra fetch**) and surface its position read as an inform note on band/churn/amplitude rows too
  (the same "compute-once-surface-everywhere" move DT1–DT5 make for the diurnal read). Reconcile with
  the value niche's own rendering so there's ONE term-structure computation, not two (the two-homes
  rule). The **full 90-day 6h look stays a MANUAL drill** for a big-ticket hold decision — not on the
  board. Inform-only, PLACEHOLDER thresholds, n≈0. **Fable to spec the exact field + confirm the
  termstructure reuse + the archive depth actually available.** Sequence: after DT1–DT5 (independent of
  them — different data source — so it can land in parallel with DT3/DT4 once DT1 is in). APP_VERSION
  only if it touches an app surface (likely pipeline-only like DT1–DT4; Fable to confirm).

## Scope / honesty — updated

- **Inform-only, never gates/prices.** Zero new fetch (ts1h in hand per survivor on every one of
  the four existing call sites — screen/quote/positions/watch all already fetch it per COD-4).
  Shadow-logged for retro, n≈0 — every tranche/knee/concentration number is a labeled PLACEHOLDER,
  and the tranche constants specifically borrow a DIFFERENT feature's n≈6 evidence as the best
  available anchor, not a validated calibration for diurnal tranches (say so at the constant, not
  just in this doc).
- **APP_VERSION:** bump at DT5 only (§6) — DT1–DT4 are pipeline-only (pure fn + CLI wiring +
  shadow-log), confirmed by grepping every current `hourProfile`/`deriveDiurnalRange` import site
  (screen/quote/watch = pipeline; trends.js = app, DT5's job).
- Docs pass: README inventory (new fns/fields in `js/windowread.mjs`), `docs/MARKET-ANALYSIS.md`
  (the timed-lap read + the corrected tranche table), the `/scan` + `/positions` skills (relay the
  richer note — same kind, more text, no new relay rule needed since `diurnal` is already tier
  `context`/default-relay), CLAUDE.md pointer. Fold + delete this file when DT5 ships.

## Open questions — resolved

1. **Concentration metric**: `hourConcentration` (§3) — a new per-day argmin/argmax-hour circular-
   concentration (mean resultant length) function; not reusable from `oscillationVsKnife` (measures
   multi-day drift-legs, a different axis) or `hourProfile`'s cluster width (a related but distinct
   aggregate-profile signal, kept as-is for window-boundary derivation).
2. **Tranche constants**: retuned to 0.5%/1% of volDay (§4), not the drafted 1%/2.5% — the drafted
   2.5% ceiling sat past the actual n≈6 reach-relief evidence band. Sell-side pool confirmed usually
   non-binding at the corrected percentages, but pin a thin-peakPool fixture to exercise the
   pool-bound branch too.
3. **APP_VERSION**: YES, an app surface (`js/trends.js`, Trends tab) already renders diurnal timing
   — the draft's default assumption was wrong. DT1–DT4 stay pipeline-only (no bump); DT5 (new)
   reconciles trends.js's local clean-flag onto the shared metric and bumps `APP_VERSION`.
4. **Item separator**: a plain `''` empty-string note item (§5) — zero new render.mjs primitive,
   zero risk to the `sections[]`/`screen.json` structure (the app's Scan tab reads `cells`, not
   `sections`, confirmed independent).
5. **Reconciliation with `↳ diurnal`**: SUPERSEDE, not coexist (§0) — the new function replaces the
   existing three call sites' computation and prints richer text under the SAME note kind/sigil,
   rather than adding a sibling `⧗ diurnal` note. The `js/trends.js` local `clean` predicate is a
   second, previously-unaddressed reconciliation point, handled by the new DT5 chunk (§6).
