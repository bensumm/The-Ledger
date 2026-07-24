# PLAN-MULTI-PEAK-WINDOWS — surfacing prominent secondary peaks/dips (design only)

Status: **BUILD-READY** — re-scoped 2026-07-23 to the owner's revised design (multiple local
extrema, ranked by topographic prominence, up to 2 windows shown per side). Supersedes the
original single-secondary ("grow the one adjacent candidate") draft in every section below. Per
`docs/PLANNING.md`'s lifecycle this folds into `PLAN.md` (and is deleted from the repo root) the
moment its last IN-SCOPE chunk ships; chunks 4/5 are explicitly deferred to the backlog, not
blocking that fold-in.

## Context / diagnosis

Every diurnal read in this repo (`js/windowread.mjs` `hourProfile`, and everything built on it —
`deriveDiurnalRange`, `softBuyRead`, `diurnalTimedLap`, the `diurnal` note rendered by
`pipeline/lib/emit.mjs` `formatTimedLap`) collapses a day's hour-of-day shape to **one** dip
cluster and **one** peak cluster. That is a real information loss: several items have **two**
genuinely elevated (or genuinely depressed) windows in their 24h profile, not one.

**Anchor 1 — Primordial boots (2026-07-23, Ben).** The tool flags PEAK **00:00–03:00 PDT**
(recent-3 median high ≈19.25m — the *most reliably reached* window, UK-morning demand, the
window `hourProfile`'s single-extreme-then-cluster algorithm happens to pick because its
deviation-from-baseline is the single highest hour). But **12:00–17:00 PDT** prints *higher*
hour-of-day median highs (≈19.55m at 12:00, ≈19.57m at 16:00, vs ≈19.27m overnight) — a real
second, higher-ceiling window. Ben's own declared hold-thesis window (12–16) targets exactly that
second window; the tool has never told him it exists. Neither window is wrong — overnight is the
reliable-reach window, afternoon is the higher-ceiling window, and Ben wants **both** surfaced,
every time, not just whichever one `hourProfile`'s point-then-cluster pick happens to land on.

**Anchor 2 — Black dragon leather** shows the same two-elevated-window shape (flagged peak
02:00–03:00 PDT, Ben's declared exit window 19:00–20:00 PDT).

**Root cause, re-confirmed in code** (`js/windowread.mjs:975-998`, `hourProfile`, current on-disk
line numbers as of this re-scope): the peak is found by
`withHi.reduce((a,b) => b.devHi > a.devHi ? b : a)` (line 976) — a single global argmax over the
de-trended hour-of-day deviations — then grown into a **contiguous** cluster via `cluster()`
(lines 980–988) using `DIP_CLUSTER_FRAC` (0.34, line 864) off that side's OWN deviation spread
(`hiSpread`/`lowSpread`, lines 992–994 — NOT the combined `amplitude`, a deliberate existing
design choice this plan reuses, see Detection design below). There is no step anywhere that looks
for a **second, non-adjacent** local extremum. The mirror is true for `dip`. Every downstream
reader (`deriveDiurnalRange`, `softBuyRead`, `diurnalTimedLap`, `diurnalPhase`,
`read-window-range.mjs`'s `--profile` block, `quote-items.mjs`'s diurnal note, `js/trends.js`'s
diurnal chart readout) only ever sees `profile.dip` / `profile.peak` — one window each.

The memory `surface-secondary-local-peaks.md` (read in full before this plan) states the intent
and anchors verbatim; this plan operationalizes it.

## THE DESIGN CHANGE (owner's re-scope, 2026-07-23 — supersedes the original draft)

The original draft detected **at most one** secondary candidate per side by growing outward from
"the single highest remaining hour," gated by a hand-tuned hour-gap constant
(`SECOND_MIN_GAP_H`) plus a separate prominence-style trough check
(`SECOND_PROMINENCE_FRAC`). The owner's revised design **replaces the seed-and-grow heuristic
with a proper local-extrema search**, ranked by **topographic prominence** — a single, principled
statistic that subsumes both the old "how far away" and "how deep a trough" gates in one number.
This is a strictly better algorithm, not a bigger one: it finds every candidate honestly instead
of assuming there's at most one worth looking for, and the prominence math (below) makes the
separate hour-gap constant unnecessary (see "Why the old `SECOND_MIN_GAP_H` constant is dropped").

**The five ruling points, as given:**
1. Detect **all** local extrema per side, rank by prominence, keep the **top 2 that clear the
   threshold** (primary + at most one secondary — the cap is on OUTPUT, not on how many
   candidates get scored).
2. **Prominence is the gate AND the noise guard** — one statistic, not two.
3. Dip and peak detection ship **together**, one chunk, symmetric algorithm.
4. Chunks 4 (Trends chart marker) and 5 (declare-thesis echo) are **DEFERRED to the backlog** —
   v1 is console/pipeline-only. **No `APP_VERSION` bump in this plan's in-scope chunks.**
5. (Carried over, unchanged from the original draft) v1 is surfacing only — no
   auto-relist/auto-split automation; inform-only `context` tier, n≈0; a flat/single-peak profile
   must not manufacture a fake secondary window.

## Existing scaffolding (build on this, don't re-derive)

- `hourProfile(series, opts)` (`js/windowread.mjs:911-1011`) already computes, per hour 0–23:
  `devLow`/`devHi` (de-trended shape), `lowRecent`/`hiRecent` (absolute recent-N level),
  `volLo`/`volHi`, plus the PF1 dispersion fields `devMid`/`devLowSpread`/`devHiSpread`. This is
  the ONE per-hour dataset; the multi-extremum detector reads the same `hours` array (and the
  already-built `withLow`/`withHi` filtered views, lines 971–972) the primary detector already
  built — **zero new fetch, zero new per-hour computation.**
- `cluster(startH, within, levelFn)` (lines 980–988) — the existing contiguous-run grower
  (circular, stops at the first neighbour that fails `within` or is absent from `hourMap`). The
  secondary-window grower reuses this **exact closure, unmodified**, seeded from the secondary's
  own extremum hour, with `within` extended by one extra AND-clause: "not already in the primary
  cluster's hour set" (see Detection design step 6 — this is how overlap between the primary and
  secondary windows is made structurally impossible, no new hour-gap constant needed).
- `spanOf(hrsSet)` (lines 891–901) — turns an hour-set into a `{startH,endH}` label; reused
  unchanged for the secondary window's span.
- `lowSpread`/`hiSpread` (lines 992–994) — the per-side deviation range (`max − min` of that
  side's `devLow`/`devHi` across all scored hours) **already computed** for the primary cluster's
  own growth threshold. This plan's prominence fraction reuses these SAME two numbers as its
  normalizing denominator (see Detection design) — zero new spread computation, and it keeps the
  secondary gate on the identical per-side scale `DIP_CLUSTER_FRAC` already uses (a one-sided
  spike on `devHi` doesn't inflate the dip-side threshold or vice versa — the Ghrazi lesson this
  file's own header comment names, lines 856–860).
- The **reach/level machinery is already window-generic** — nothing about it is hard-coded to
  "the primary window": `windowStats(series, {wStart, wEnd, ...})` takes ANY hour range,
  `recencySplit`/`askExitRead`/`reachMargin`/`projectTrajectory` all operate on whatever
  `windowStats` result is handed to them. `diurnalTimedLap` (`js/windowread.mjs:1210-1254`)
  already demonstrates the exact pattern a secondary read needs: it calls
  `windowStats(series, {wStart: profile.peak.startH, wEnd: profile.peak.endH, ...})` then
  `recencySplit(peakStats.days, 'ask', dr.ask, recentN)` (lines 1226–1229) to score the chosen
  peak level. A secondary read is the **identical call**, with the secondary window's bounds
  substituted — no new reach primitive.
- `formatTimedLap` (`pipeline/lib/emit.mjs:146-191`) is the **one render owner** of the `diurnal`
  NOTE_KIND text (confirmed the single site to extend, not three — its own doc comment already
  states this).

## Target architecture

**One home, unchanged:** all detection math stays in `js/windowread.mjs` (already the ONE
band/window/diurnal-math home per `docs/ARCHITECTURE.md`'s one-home table). All rendering stays
in `pipeline/lib/emit.mjs`'s `formatTimedLap`. No new file, no forked second implementation — this
plan is entirely additive fields inside two existing functions, plus one small pure helper
(the prominence search) added next to `hourProfile`.

### Detection design — local extrema ranked by topographic prominence

This section is the load-bearing rewrite; read it in full before Chunk 1.

**What "prominence" means here.** For a candidate local extremum, prominence is the depth of the
valley you'd have to cross to reach a *more extreme* point, expressed on the same per-side
deviation scale (`hiSpread` for peaks, `lowSpread` for dips) `DIP_CLUSTER_FRAC` already uses. This
is the standard topographic-prominence definition (the "island height before it merges with
taller land") applied to the circular 24-point `devHi`/`devLow` series instead of terrain
elevation. It is a SINGLE statistic that answers both of the old draft's separate questions at
once — "is it far enough from the primary?" and "is there a real trough between them?" — because a
candidate that is close to the primary (or sits on the same plateau) necessarily has a shallow
intervening valley, and therefore low prominence, with no separate hour-gap constant required.

**Algorithm, concretely, per side (peak side shown; dip side is the exact mirror — negate the
comparisons, use `devLow`/`lowSpread` in place of `devHi`/`hiSpread`, "local minima" in place of
"local maxima"):**

1. **Build the circular candidate list.** Take `withHi` (line 972, already the filtered
   hours-with-`devHi` view), sorted ascending by hour `h`. This is a circular sequence — index
   arithmetic wraps mod `withHi.length`, exactly like `cluster()`'s own `(startH + dir*step + 24)
   % 24` wraparound, so the day-boundary case (an extremum near 23:00/00:00) needs no special
   case.
2. **Flatten plateaus, find local-maxima candidates.** Walk the circular list once; a contiguous
   run of hours with equal (or monotonically non-decreasing-then-non-increasing, i.e. a flat top)
   `devHi` that is strictly higher than the hours immediately outside the run on both ends is one
   candidate, represented by the run's FIRST hour (mirrors the existing tie-break behavior of
   `reduce((a,b) => b.devHi > a.devHi ? b : a)`, which keeps the earlier hour on a tie since `b >
   a` is false when equal). A run that wraps the ENTIRE circle (a perfectly flat profile) yields
   **zero candidates** — this is exactly the flat-profile no-spurious-window case, falling out of
   the algorithm by construction rather than a special-cased flag.
3. **Score each candidate's prominence.** For candidate `i` with value `v = devHi[i]`, walk the
   circular list clockwise, tracking a running minimum `m` (starting at `+Infinity`, updated
   BEFORE the comparison each step so `m` never includes `v` itself). At each step, if the next
   point's value is strictly greater than `v`, stop and record `colR = m` (the lowest point seen
   before the first strictly-taller point). If the walk completes a full lap (every other point
   visited) without finding anything taller, record `colR = m` anyway (the running min over the
   WHOLE remaining circle) — this is `i`'s fallback when it is the circular global max; no
   separate branch is needed, the bounded loop produces the correct fallback automatically.
   Repeat counter-clockwise for `colL`. **`prominence = v − max(colL, colR)`** (the higher of the
   two cols is the one first reached as you conceptually lower a "flood level" down from above the
   peak — the standard prominence derivation; using the LOWER of the two cols would overstate
   prominence). For the single circular global max, `colL === colR ===` the series' own global
   min by construction, so its prominence is trivially `v − globalMin` — the largest possible
   value, which is exactly why the existing primary pick (today's global argmax) is ALWAYS the
   rank-1 candidate under this scheme: nothing can outrank it. This is the plan's proof that the
   existing `profile.peak`/`profile.dip` fields are unaffected — see Emit-shape below.
4. **Normalize to a fraction and rank.** `prominenceFrac = prominence / hiSpread` (the same
   `hiSpread` computed at line 993 today). Sort all candidates by `prominenceFrac` descending.
5. **Gate.** Keep candidates with `prominenceFrac >= SECOND_PROMINENCE_FRAC`
   (**PLACEHOLDER: 0.3** — n≈0, chosen to sit at the same order of magnitude as
   `DIP_CLUSTER_FRAC`'s 0.34 primary-cluster-growth threshold; not independently calibrated, see
   Honesty section). Take the top 2 that clear the bar. Because rank-1 (the existing primary) has
   `prominenceFrac === 1.0` by construction (step 3), it always clears the bar trivially — the
   gate only ever screens candidates in the rank-2+ position, i.e. it only ever decides whether a
   SECONDARY window gets reported. **Fewer than 2 clearing the bar (including zero beyond the
   primary) is the expected, common case — never manufacture a window to fill the slot.**
6. **Grow the accepted secondary's cluster.** Once a rank-2 candidate clears the gate, grow it with
   the SAME `cluster()` closure used for the primary (line 998's `peakC`/line 997's `dipC` call
   pattern), but with the growth predicate `within` extended by `&& !peakC.set.has(x.h)` (mirror:
   `&& !dipC.set.has(x.h)` for dips) — growth simply cannot re-absorb an hour already claimed by
   the primary cluster, so the two windows are non-overlapping BY CONSTRUCTION, with no separate
   hour-gap constant needed to enforce it.
7. **Minimum sample.** Inherits `HOURPROFILE_MIN_DAYS` (line 863) and the existing `withLow.length
   < 2 || withHi.length < 2` early-return (line 973) — no separate threshold, since the secondary
   read shares every per-hour bucket with the primary and runs inside the same already-gated
   function body.

**Why the old `SECOND_MIN_GAP_H` constant is dropped.** The original draft needed it because its
seed-and-grow heuristic had no principled way to reject "the next hour over" as a spurious second
peak other than a hard-coded minimum distance. Topographic prominence makes that check redundant:
two nearby extrema on the same rise/plateau necessarily have a shallow (or zero, after plateau
flattening in step 2) valley between them, hence near-zero prominence, hence they fail the
`SECOND_PROMINENCE_FRAC` gate on their own. One constant now does the work two constants did
before — simpler, and it removes a magic number the original draft's own "Open questions" section
flagged as needing Ben's separate sanity-check.

**Elevation floor — dropped as a separate gate, folded into prominence.** The original draft's
gate 5 ("the candidate's own `devHi` must still be `≥ 0`") is now REDUNDANT: a candidate that is
below the day's baseline can still have real prominence (a genuine secondary dip does, tautologically,
sit below baseline), and a candidate that is merely "the least-bad point of a flat remainder" will
have near-zero prominence relative to `hiSpread`/`lowSpread` and fail step 5's gate anyway. Not
carrying this forward as a separate check is a simplification enabled by the stronger single
statistic, not an oversight — call this out explicitly in the Chunk 1 PR description so a future
reader doesn't think it was silently dropped.

### Emit-shape decision — ADDITIVE ordered lists, existing `dip`/`peak` fields UNTOUCHED

**This supersedes the original draft's "additive nullable `secondaryPeak`/`secondaryDip`" decision
outright — the owner's new instruction is explicit that the emit shape is a per-side ORDERED
LIST, not a single nullable field.** But the original draft's reasoning for why a wholesale
list-shape rename would be costly (eight+ call sites destructure `profile.peak.startH` /
`profile.dip.hours` etc. as a single object, not `profile.peaks[0]`) is still correct and still
matters — so the two constraints are reconciled the same way, additively:

**`hourProfile`'s return gains two NEW keys, `peaks` and `dips`, each an array of 1–2 window
objects** (never 0 — `hourProfile` already early-returns `null` for the whole profile, line
931/973, before a peak or dip can fail to exist; every non-null profile has at least the primary),
ordered by prominence descending, shaped `{startH, endH, hours, level, atHour, prominenceFrac}`
(identical shape to today's `peak`/`dip` objects, plus one extra field). **`profile.peak` and
`profile.dip` themselves are BYTE-IDENTICAL to today, unchanged** — and by construction (see
Detection design step 3) `profile.peak` is always deep-equal to `profile.peaks[0]`, and
`profile.dip` to `profile.dips[0]`. `profile.peaks[1]`/`profile.dips[1]` (present only when a
secondary clears the prominence gate) is the ONLY genuinely new information.

This is not a compromise, it's the correct reconciliation: it satisfies the owner's "ranked list,
0–2 per side" instruction on the `peaks`/`dips` keys, while leaving every one of the eight+
existing call sites that destructure `profile.peak`/`profile.dip` as a single object completely
untouched (they never look at `peaks`/`dips`, so they don't need to change, exactly the
zero-ripple property the original draft argued for). Consumers opt in to the secondary by reading
`profile.peaks[1]` (or checking `profile.peaks.length > 1`) in a later chunk; nothing is forced to
change in Chunk 1.

**Confirmed call sites unaffected (re-verified against current `git grep`):** `js/trends.js`,
`pipeline/commands/quote-items.mjs` (four call sites), `pipeline/commands/read-window-range.mjs`
(three call sites), and `js/windowread.mjs` itself (`deriveDiurnalRange`, `diurnalTimedLap`) all
read `profile.peak`/`profile.dip` as singular objects — none read `peaks`/`dips`, so none need to
change to keep compiling or behaving identically.

### Reach/level read for each window — reuse, don't reinvent

`diurnalTimedLap` gains two new **additive, array-shaped** fields, `askReaches` / `bidReaches`,
index-aligned with `profile.peaks`/`profile.dips` (so `askReaches[0]` is always the SAME
computation as today's `askReach`, `askReaches[1]` — present only when `profile.peaks.length >
1` — is the new secondary read):

```
askReaches = profile.peaks.map(pk => {
  const stats = windowStats(series, { wStart: pk.startH, wEnd: pk.endH, nights, now });
  return {
    level: pk.level,
    window: { startH: pk.startH, endH: pk.endH },
    reach: stats ? recencySplit(stats.days, 'ask', pk.level, recentN) : null,
    pool: stats ? stats.medVolHi : null,
  };
});
```
(mirrored for `bidReaches` off `profile.dips`, side `'bid'`, `medVolLo`). This is the exact
`peakStats`/`askReach` pattern already at `js/windowread.mjs:1226-1229`, called once per entry in
the (length-1-or-2) array instead of once for the singular window — no new primitive, no new gate
logic. The existing scalar `bidReach`/`askReach` fields on `diurnalTimedLap`'s return stay
UNCHANGED (still computed off `profile.dip`/`profile.peak` exactly as today, lines 1227/1229) —
`bidReaches[0]`/`askReaches[0]` are simply the same numbers again, index-aligned, for callers that
want to iterate uniformly instead of reading two differently-named scalar fields.

## Staged chunks

Each chunk is independently landable and fixture-pinned per `docs/PLANNING.md`'s chunk rules.

### Chunk 1 — `hourProfile` multi-extremum/prominence detection (foundation, BOTH sides together)
- **What:** add the prominence search (Detection design above) inside `hourProfile`, computing it
  symmetrically for peaks (`devHi`/`hiSpread`) and dips (`devLow`/`lowSpread`) in the same pass,
  returning `peaks`/`dips` (arrays, length 1–2) alongside the unchanged `peak`/`dip`. Add the one
  new named constant `SECOND_PROMINENCE_FRAC` next to the existing `DIP_CLUSTER_FRAC`/
  `TREND_DOM_FRAC` block (line ~864-867), same PLACEHOLDER/n≈0 comment style. Add the small pure
  prominence helper (circular clockwise/counter-clockwise scan, Detection design step 3) as a
  private function next to `cluster()` (line 980) — not exported, mirrors how `cluster` itself is
  private to `hourProfile`'s closure today.
- **Why:** the one piece of net-new math; everything else in this plan composes it.
- **Files touched:** `js/windowread.mjs` only.
- **Acceptance (fixtures in `pipeline/test/windowread.test.mjs`):**
  - (a) **Flat-profile no-spurious-window fixture** — a synthetic series with no real intraday
    shape (constant devHi/devLow across all hours, or noise well under `SECOND_PROMINENCE_FRAC`)
    asserts `peaks.length === 1` and `dips.length === 1` (primary only; the single most important
    fixture in this plan — carried forward unchanged in spirit from the original draft, now
    phrased against the list shape).
  - (b) **Genuine-two-peak fixture** modeled on the Primordial boots shape (elevated 00–03 AND
    12–17 on the high side, a real trough between, e.g. midday-low well below both) asserts
    `peaks.length === 2`, `peaks[0]` spans 00–03 (unchanged from today), `peaks[1]` spans 12–17
    with `prominenceFrac >= SECOND_PROMINENCE_FRAC`, and `peaks[1].hours` shares NO hour with
    `peaks[0].hours`.
  - (c) **Shallow-shoulder-rejected fixture** — a series with one dominant peak and a mild
    secondary bump whose intervening trough is shallow (prominenceFrac computed by hand to sit
    just under 0.3) asserts `peaks.length === 1` — the gate correctly rejects a real-but-weak
    bump, distinct from fixture (a)'s "no bump at all."
  - (d) **Dip-side mirror** of (b) and (c) — same shapes, asserting `dips` behaves symmetrically
    (this is the "ship together" requirement's acceptance proof, not just a claim).
  - (e) **Thin-history fixture** (`< HOURPROFILE_MIN_DAYS`) still returns `null` for the WHOLE
    profile as today (unchanged early-return at line 931, pinned so this chunk can't regress the
    existing null-profile contract).
  - (f) **No-op-on-existing-fields fixture** — every existing `hourProfile` fixture already in the
    test file must stay byte-identical for `peak`/`dip`/`amplitude`/every other pre-existing field
    (a diff-proven no-op on the unchanged fields), AND additionally assert `peaks[0]` deep-equals
    `peak` and `dips[0]` deep-equals `dip` on every one of those existing fixtures (the "rank-1 is
    always the existing primary" proof from Detection design step 3, pinned in code not just
    argued in prose).
- **Docs to reconcile:** none required yet — no consumer reads the new fields, so
  `docs/MARKET-ANALYSIS.md`/`CLAUDE.md` describe unchanged behavior until Chunk 3. Note the
  addition in `CHANGELOG.md`'s "Recent" section (process rule 8 still applies to a pure-fn change,
  even with no visible behavior yet) and in `README.md`'s `js/windowread.mjs` entry (add
  `peaks`/`dips` to the field list already documented there for `hourProfile`).
- **APP_VERSION:** `js/windowread.mjs` is app-imported (per `docs/ARCHITECTURE.md`'s blast-radius
  table — reachable via `js/trends.js`), so editing it *can* bump `APP_VERSION`, but the bump is
  conditional on **app-visible behavior changing**. Chunk 1 adds fields nothing reads yet
  (`js/trends.js` is explicitly deferred, Chunk 4) — **no bump**, note this explicitly in the
  commit message so it isn't mistaken for an oversight.

### Chunk 2 — `diurnalTimedLap` secondary reach/level read (both sides)
- **What:** add `askReaches`/`bidReaches` (arrays, index-aligned with `profile.peaks`/
  `profile.dips`) to `diurnalTimedLap`'s return, per the reuse pattern above. The existing scalar
  `bidReach`/`askReach` fields stay unchanged (still the same single computation, now also
  duplicated at index 0 of the new arrays).
- **Why:** turns "here's a second window" into "here's a second window AND whether it actually
  prints" — the same reach discipline every other window read in this file carries; without it
  the secondary window would be a bare hour-range with no evidence behind the level.
- **Files touched:** `js/windowread.mjs` only (`diurnalTimedLap`).
- **Acceptance:** extend `pipeline/test/dt4-timedlap-coverage.test.mjs` with a two-window fixture
  asserting `askReaches[1].reach`/`bidReaches[1].reach` populate identically to how `askReach`/
  `bidReach` populate for the primary window (byte-identical use of `recencySplit`, just a
  different window's bounds), and `askReaches[0]` deep-equals `{ level: dr.ask, window:
  peakWindow, reach: askReach, pool: peakPool }` on every existing fixture (index-0 parity proof).
  A profile with `peaks.length === 1` asserts `askReaches.length === 1` (no fabricated secondary
  read off an absent window).
- **Docs:** none yet (still no renderer reads it). `CHANGELOG.md` note.
- **APP_VERSION:** same reasoning as Chunk 1 — no bump (no renderer wired yet).

### Chunk 3 — render up to 2 secondary clauses on the SAME diurnal line
- **What:** extend `formatTimedLap` (`pipeline/lib/emit.mjs`) to append a trailing clause per
  secondary window present — i.e. `lap.askReaches[1]` and/or `lap.bidReaches[1]`, e.g.:
  `· also ASK <level> (peak <window>, reach N/M) — second elevated window (n≈0, inform)` and/or
  `· also BID <level> (dip <window>, reach N/M) — second depressed window (n≈0, inform)`.
  **Both appended to the existing single joined line (`bits.join(' · ')`), never a second note
  line** — this directly follows the standing house rule (`output-format-compact-lines` /
  `salient-subtask-crowds-out-mandate` memories): ONE line per item, never a second `·`-joined or
  separately-printed note for the same item. **Rendering 0/1/2 secondary clauses:**
  - Neither `askReaches[1]` nor `bidReaches[1]` exists (the common case) → zero trailing clauses,
    output byte-identical to today (the no-regression pin).
  - Only one side has a secondary → exactly one trailing clause appended.
  - Both sides have a secondary (both a second elevated AND a second depressed window) → both
    clauses append, still joined into the SAME line by the same `' · '` separator everything else
    uses — `bits.join(' · ')` doesn't care how many bits there are, so this "just works" with no
    branching beyond "push a bit if present, once per side."
- **Why:** this is the actual "Ben sees it" moment — chunks 1–2 are inert without this.
- **Files touched:** `pipeline/lib/emit.mjs` (`formatTimedLap`) only. Consumers
  (`quote-items.mjs`, `screen-flip-niches.mjs`, `watch-positions.mjs`) already call
  `formatTimedLap` and push its return as the existing `diurnal` NOTE_KIND — **zero changes
  needed at any of those three call sites**.
- **Acceptance:** extend `pipeline/test/render.test.mjs`'s `formatTimedLap` fixtures — a lap with
  only `askReaches[1]` set renders one trailing clause; a lap with both `askReaches[1]` AND
  `bidReaches[1]` set renders both, still one line (assert no embedded newline, assert the output
  still splits on `' · '` into the expected bit count); a lap with neither renders byte-identical
  to today's existing fixtures.
- **Sub-check — shadow log:** confirm during this chunk whether `suggestlog.mjs` needs a matching
  additive field so the secondary clause's TEXT (not just the structured numbers) reaches the
  shadow log the same way the primary note does — the existing diurnal-lap reshape may already
  flow the full `formatTimedLap` string through unchanged (in which case nothing to do), but this
  must be CONFIRMED, not assumed, since it's the one place a silent gap could hide.
- **Docs to reconcile:** `docs/MARKET-ANALYSIS.md`'s diurnal-timing section (the "Diurnal timing
  (auto)" paragraph, currently describing a single peak/dip window per item) gets one added
  sentence: up to one additional elevated AND one additional depressed window may render as
  trailing clauses on the same line, inform-only. `.claude/skills/positions/SKILL.md` and
  `.claude/skills/scan/SKILL.md` — grep both for "diurnal peak window" phrasing that implies
  exactly one window exists; add a one-line acknowledgment that a second window (per side) may
  also be flagged. `README.md`'s `pipeline/lib/emit.mjs` entry (`formatTimedLap`'s doc line) gets
  the extended shape noted. **`PLAN-SCHEDULE.md`'s own compatibility note (its lines ~101–111)
  currently describes the SUPERSEDED single-nullable-field shape (`secondaryPeak`/`secondaryDip`)
  — it must be corrected in this same pass to say `peaks`/`dips` (arrays, index-aligned, `[1]` is
  the secondary) so a future reader of that plan isn't working from the stale shape. This is a
  reconciliation this plan's Chunk 3 owns, even though the edit lands in a different file** (see
  Schedule-compatibility re-verification below for exactly what changes).
- **Render-tier registry (`pipeline/lib/render.mjs`):** NO new entry required — the secondary
  clause(s) ride the existing `diurnal` NOTE_KIND (already `tier: TIER.context`), it does not
  introduce a new note kind. State this explicitly so a future drift-scan doesn't go looking for
  a `secondaryDiurnal` tier entry that was deliberately never created.
- **APP_VERSION:** `pipeline/lib/emit.mjs` is Node-only (`pipeline/lib/`), never imported by the
  browser app — **no bump** regardless.

### Chunk 4 (DEFERRED — backlog, not scheduled) — `js/trends.js` diurnal chart secondary marker
- **What:** the Trends tab's diurnal chart would gain a light visual marker (a second shaded band)
  at the secondary window's hours, when `profile.peaks[1]`/`profile.dips[1]` is present.
- **Status: explicitly OUT of this plan's v1 scope** per the owner's ruling — console/pipeline
  surfacing only. Listed here only so a future session doesn't rediscover it as new; it gets its
  own chunk (with its own fixture/acceptance detail) only if/when Ben pulls it forward. **Do not
  build this as part of landing chunks 1–3.**
- **APP_VERSION note (for whenever this is eventually picked up):** this remains the one chunk in
  the whole plan that would need a bump — the only app-visible (browser) surface touched anywhere
  in this plan.

### Chunk 5 (DEFERRED — backlog, not scheduled) — `declare-thesis.mjs --window` secondary awareness
- **What:** per the memory's "how to apply" — when Ben runs `declare-thesis.mjs set ... --window
  <h-h>`, if the declared window matches `profile.peaks[1]`/`profile.dips[1]`'s span rather than
  the primary (index 0), the thesis note/echo could say so instead of staying silent about which
  window was picked.
- **Status: explicitly OUT of this plan's v1 scope**, same reasoning as Chunk 4 — listed for
  future reference only, not scheduled, not blocking this plan's fold-in to `PLAN.md`.
- **APP_VERSION:** none (`declare-thesis.mjs` is pipeline-only) — this note carries forward
  unchanged from the original draft in case Chunk 5 is later picked up.

## Schedule-compatibility re-verification (`PLAN-SCHEDULE.md`)

Re-checked against the NEW emit shape (the original draft's compatibility claim was written
against the superseded single-nullable-field design and is now stale in `PLAN-SCHEDULE.md`
itself, not just in this plan):

- `PLAN-SCHEDULE.md` states (its own text, ~lines 101–111) that `read-schedule.mjs` built against
  `profile.dip`/`profile.peak` today "will automatically keep working unchanged" once this plan
  lands, and that a later chunk could opt in to `secondaryPeak`/`secondaryDip` rows. **The
  "unaffected" half of that claim still holds** — `profile.dip`/`profile.peak` are unchanged by
  this plan (Emit-shape decision above), so `read-schedule.mjs` needs zero changes to keep
  compiling and behaving identically. **The "opt-in" half needs its field names corrected** — a
  future schedule chunk would iterate `profile.peaks`/`profile.dips` (arrays, 1–2 entries,
  `[startH,endH,level,atHour,prominenceFrac]` shape) and emit a row per entry beyond index 0,
  rather than reading a single nullable `secondaryPeak`/`secondaryDip` field. Concretely: "each
  item contributes up to 2 rows" (today, `PLAN-SCHEDULE.md`'s own line 101) would become "each
  item contributes up to 2 rows per side" once a schedule chunk opts in — 2 dip rows + 2 peak
  rows = up to 4, not the "up to 2 total" the current text implies. **This correction is Chunk 3's
  docs responsibility** (listed above) since it's this plan's field-shape change causing the
  drift, even though the edit lands in `PLAN-SCHEDULE.md`.
- No shared refactor is forced by combining the two plans — `read-schedule.mjs` remains free to
  never opt in at all; nothing in this plan requires touching it.

## Slot-efficiency application (v1 scope) vs. deferred automation

**v1 (in scope, delivered by chunks 1–3):** faithfully SURFACE that a second, genuinely prominent
elevated (or depressed) window exists, with its own reach evidence, on the SAME line the diurnal
note already prints. That is the entire v1 deliverable. Knowing "this item has a reliable-reach
window at 00–03 AND a higher-ceiling window at 12–17, both with reach evidence" is what lets Ben
(a human, doing manual GE actions — process rule, Ben places every market offer) decide for
himself whether to:
- List into window 1, then free the slot and relist for window 2 once window 1 either fills or
  visibly cools (the "slot efficiency" win named as the priority in the memory).
- Split a stack — list part of it for window 1, hold the rest for window 2.
- Simply ignore the secondary and keep the current single-window habit — nothing about this plan
  removes that option; the secondary is an added clause, never a forced re-plan.

**Explicitly DEFERRED, not v1 (flag for a future, separate plan if Ben wants it built):**
- Any automated "cancel/relist the slot for window 2 once window 1 closes" behavior.
- Any automated stack-splitting sizing logic across the two windows.
- Treating "two elevated windows" as a new flip-niche or scan-mode trigger.
- A "watch both windows" mode in `watch-positions.mjs`/`run-loop.mjs` that changes cadence based
  on which window is approaching.
- Chunks 4 (Trends chart marker) and 5 (declare-thesis echo) — see their entries above.

These are named here only so a future session doesn't rediscover them as if new — see PLAN.md's
"Discovered" list precedent — but they get their OWN plan + rulings if/when Ben wants them
scheduled; this plan's in-scope chunks (1–3) do not touch any automation surface
(`watch-positions.mjs`, `run-loop.mjs`, `dip-watchlist.json`'s auto-nomination logic in
`screen-flip-niches.mjs`'s `--mode all`).

## Encoding boundary

Everything in chunks 1–3 is **encoded**, not judgment prose: the prominence gate is a named
constant in `js/windowread.mjs`, mechanically applied, fixture-pinned. The one piece that stays
judgment (⚖️, not machine-checkable) is what a human DOES once shown two windows — list into which
one first, split or not, whether to cancel-and-relist — that decision correctly stays with Ben per
the standing "Ben places every market offer" rule and is explicitly out of scope for automation
(see deferred list above). No skill prose rule is being retired or newly encoded by this plan;
`.claude/skills/positions/SKILL.md`/`scan/SKILL.md` get only the one-sentence acknowledgments
named in Chunk 3's docs section.

## Honesty / non-goals (rule 4)

- **n≈0 for the one threshold in this plan.** `SECOND_PROMINENCE_FRAC` (0.3) is a PLACEHOLDER
  reasoned from the Primordial boots/black dragon leather anchors and the existing
  `DIP_CLUSTER_FRAC` scale (0.34) — NOT independently calibrated. State this in the code comment
  exactly like every other PLACEHOLDER constant in the file (`FC_FLAT_FRAC`, `MARGIN_FADE_FRAC`,
  etc. all carry this same honest label). This plan carries ONE placeholder constant, not two —
  the prominence math retiring `SECOND_MIN_GAP_H` (see Detection design) is a genuine reduction in
  hand-tuned surface area versus the original draft, not just a rename.
- **This never gates, never prices, never ranks.** `peaks`/`dips` and `askReaches`/`bidReaches`
  are `context`-tier, inform-only fields exactly like the diurnal note they extend. No
  gate/`screen.json`/`suggestions.jsonl` rank input reads them in this plan (a future F1-gated
  calibration chunk, if any, is out of scope here — per the `f1-gates-decisions-not-description`
  memory, this descriptive read ships at build time without an F1 gate specifically BECAUSE it
  never moves a decision).
- **The no-spurious-window guard is the load-bearing honesty claim of this whole plan.** Chunk 1's
  flat-profile fixture (a) is the single most important acceptance check — if it regresses, this
  feature turns into exactly the "manufactured pattern from noise" failure mode rule 4 warns
  about. Any future threshold retune MUST re-run that fixture, AND fixture (c) (the
  shallow-shoulder-rejected case) — a plan that only tests "zero real structure ⇒ nothing" without
  also testing "weak-but-real structure ⇒ still nothing" has a gap a single lenient retune could
  slip through.
- **What would validate the threshold:** a real-fills retro (via `/analyze` →
  `analyze-record.mjs`) once enough items have carried a rendered secondary-window clause for a
  few weeks — comparing realized fills against BOTH windows' reach predictions, the same
  discipline `PLAN-REACH-CALIBRATION.md`/F1 already apply to the primary window's reach numbers.
  This plan does not build that retro; it only creates the data (the rendered clause + whatever
  shadow-log the `/analyze` skill already scrapes from `suggestions.jsonl`) for F1 to eventually
  consume.

## Verdict — is this additive-and-zero-ripple to existing consumers?

**Yes, confirmed both by design and by an explicit fixture.** `profile.peak`/`profile.dip` are
byte-unchanged (Emit-shape decision), and `profile.peaks[0]`/`profile.dips[0]` are PROVEN
deep-equal to them by construction (Detection design step 3: the circular global max/min always
has the maximal prominence, so it is always rank-1) — pinned as an explicit assertion in Chunk 1's
fixture (f), not left as an unverified claim. The eight+ existing call sites across `js/trends.js`,
`quote-items.mjs`, `read-window-range.mjs`, and `windowread.mjs` itself never read the new
`peaks`/`dips`/`askReaches`/`bidReaches` keys, so none of them need to change. `diurnalTimedLap`'s
existing scalar `bidReach`/`askReach` fields are similarly untouched.

## Residual risk

- **Single new placeholder constant (`SECOND_PROMINENCE_FRAC = 0.3`), still n≈0.** This plan
  reduces the original draft's two hand-tuned constants to one, but that one constant is still an
  eyeballed guess pending a real retro (see Honesty section). Ben should sanity-check it against a
  couple more items he knows do/don't have a genuine second window before Chunk 1 lands, the same
  way `DIP_CLUSTER_FRAC` was originally tuned by eyeballing Ghrazi.
- **Plateau-flattening (Detection design step 2) is new logic with no precedent elsewhere in the
  file** — it's simple (a contiguous equal-or-monotone run bounded by strictly-lower neighbours on
  both ends) but is the one piece of this plan without a direct existing-code analogue to lean on;
  give it its own small fixture set beyond (a)/(b)/(c) if a genuinely flat multi-hour plateau shows
  up in real data during Chunk 1's implementation (a synthetic fixture can be added ad hoc; not
  pre-specified here since no real anchor item currently exhibits it).
- **`PLAN-SCHEDULE.md` drift is real but contained** — its compatibility note needs the field-name
  correction described above; until that lands, a reader following that plan's stale text would
  look for `secondaryPeak`/`secondaryDip` and not find them. Flagged as a Chunk 3 doc task, not a
  blocker to landing chunks 1–2 first.
- **Chunks 4/5 deferral is a scope cut, not a technical risk** — both remain trivially buildable
  later off the `peaks[1]`/`dips[1]` fields this plan produces; deferring them only means Ben
  doesn't see a Trends-chart marker or a declare-thesis echo until a later, separate decision to
  build them.
