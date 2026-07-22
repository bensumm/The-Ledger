# PLAN-DRIFT-VS-CRASH — a phase-aligned floor + ceiling slope-asymmetry trajectory classifier

## Goal
Tell a **drift/cooldown** apart from a **crash** on a multi-day price series, by reading the **floor
track (daily lows)** and the **ceiling track (daily highs)** as TWO independent slopes instead of one
blended shape. The classifier's discriminators are **floor/ceiling slope asymmetry + a discrete
floor-break** — that IS the read. HEURISTIC, n≈0, inform-only (same discipline as `trajectoryRead`);
it never gates, never a verdict, never a `screen.json`/rank input.

## The gap
`trajectoryRead` in `js/windowread.mjs` already buckets a `windowStats().days` low/high series and
returns `{ scored, shape, floor, ceiling, floorKey, ceilKey, liveRef, livePos }`. But:
- it collapses the whole window to a SINGLE min-low `floor` and max-high `ceiling`, and
- it classifies `shape` off the blended daily MIDS (recent-third vs oldest-third drift).

That blend **washes out the real signal**: the floor and ceiling moving INDEPENDENTLY. Three cases we
hit this session that the blended read cannot distinguish:
- **Fang (crash)** — ceiling stepping DOWN ~376k/day while the floor BROKE its 14-day low (17.46m):
  decaying peaks + a floor break.
- **Godsword (crash, completed)** — daily highs stepped 42.1m→40.2m over a week and the floor broke
  39m→37.2m.
- **Maul (mild cooldown / stalled)** — floor ROSE 7 days straight (116.5k→125.0k) then PLATEAUED and
  ticked down 2 days (122.7k, 122.5k), while highs eased ~2k/day (135.8k→129.8k). **NOT a crash** — the
  floor still sits far above its prior trough and above break-even.
- **Soulreaper axe (healthy trend)** — both floor and ceiling rising hard, new highs daily.

`trajectoryRead` has existing test + consumer contracts (`read-window-range.mjs`, `quote-items.mjs`),
so this ships as a **sibling helper**, not a rewrite.

## What already exists (so I don't rebuild it)
- `windowStats(series,{…}).days` — the `[[key,{low,hi,volLo,volHi}],…]` oldest→newest per-day buckets;
  it already **excludes today** while inside its window. Both surfaces already hold one.
- `trajectoryRead(days,{liveRef})` — the shared shape read, rendered as the `read:` line
  (`read-window-range.mjs`) and the `⌁ read:` note (`quote-items.mjs`, per-item + `--positions`).
- `slopePerStep(ys)` — the module-internal least-squares slope-per-step helper (hoisted `function`).
- The NOTE_KINDS registry + `formatNote` in `pipeline/lib/render.mjs` (typed `{kind,text}` notes).

## Design

### 1. New shared helper — `floorCeilingTrack(days, opts)` in `js/windowread.mjs`
Pure over the SAME `days` series (zero new fetch), sibling to `trajectoryRead`. Its header comment is
the **load-bearing spec home** (per process rule 8).

```js
export const FC_MIN_DAYS = 5;        // fewer COMPLETED days ⇒ null (can't fit a robust slope)
export const FC_RECENT_N = 5;        // recent completed-day window the slope is fit over
export const FC_FLAT_FRAC = 0.005;   // |slope|/latest-level per day below this ⇒ 'flat' (PLACEHOLDER, F1)
export const FC_BREAK_LOOKBACK = 13; // floor-break = latest low vs min of the prior N lows

export function floorCeilingTrack(days, { todayKey = null, recentN = FC_RECENT_N, minDays = FC_MIN_DAYS,
                                          flatFrac = FC_FLAT_FRAC, breakLookback = FC_BREAK_LOOKBACK } = {})
```

**Return shape** (null when unreadable — degrade, never a fake read):
```js
{
  completed,        // the completed day buckets used (forming day dropped)
  forming,          // null | { key, low, hi }  — the provisional incomplete current day
  nDays,            // completed day count
  floor:   { series, slope, step, dir, run:{dir,len}, nUsed, latest },   // daily LOWS track
  ceiling: { series, slope, step, dir, run:{dir,len}, nUsed, latest },   // daily HIGHS track
  floorBreak: { broke, latest, priorFloor, gap, lookback },
  classification,   // one of the labels below
}
```
- **`slope`** = `slopePerStep` least-squares gp/day over the recent `recentN` completed days (robust —
  NOT a two-point diff), `step` = its rounded magnitude.
- **`dir`** = `rising | flat | falling`, thresholded at `flatFrac × latest-level` per day (relative, so
  it works across a 100k item and a 40m item alike).
- **`run`** = the trailing consecutive-same-direction micro-run by RAW SIGN (`{dir,len}`) — the DURATION
  signal ("floor flat over 5d, softened 2d"). Raw sign on purpose: the run's job is to expose a fresh
  softening/strengthening UNDER the robust trend; the flat band lives on `dir` (the trend), not the run.

### 2. Slope / asymmetry classification
Combine the two `dir`s (floor-break DOMINATES):

| floor `dir` | ceiling `dir` | label |
| --- | --- | --- |
| — | — | **`crash-risk`** when `floorBreak.broke` (overrides all below) |
| rising | rising | `healthy-trend` |
| rising | flat / falling | `compressing-up` (band tightening from below) |
| flat | falling | `mild-cooldown` (the maul — peaks ease, floor holds) |
| falling | falling | `cooling` (both tracks decaying, no break yet) |
| any other combo | | `ranging` (flat/flat, flat/rising, falling/rising\|flat — nothing decisive) |

### 3. Floor-break flag (the discrete crash trigger)
`broke` = the latest COMPLETED daily low `<` `priorFloor`, where `priorFloor` = `min` of the preceding
`breakLookback` completed lows (the rest of a 14-day window). `gap` = latest − priorFloor (negative when
broken). This is the fang/godsword shape: a floor that steps UNDER its multi-day trough.

### 4. REQUIREMENT #1 — phase alignment (the forming-day guard)
The live/incomplete current day must **NEVER** feed the slope fit or the floor-break test (an incomplete
bucket can fake a break or a slope). If the caller passes `todayKey` (local `'YYYY-MM-DD'`) and the
NEWEST day matches it, that day is **dropped** from the completed series and surfaced separately as
`forming` (provisional low/high). Only complete daily buckets, compared like-for-like, feed the
slopes/break. (`windowStats` already excludes today inside its window, so on the live surfaces `forming`
is usually null already — the guard is belt-and-suspenders AND the contract a raw caller relies on.) A
forming split that leaves fewer than `FC_MIN_DAYS` completed days degrades to null.

## Honesty rails (encoded — rule 4)
- **HEURISTIC, n≈0, INFORM-ONLY** — never gates, never a verdict, never a `screen.json`/rank input. Same
  framing as `trajectoryRead`'s header; every rendered line carries `(heuristic, n≈0 — inform-only,
  never gates)`.
- **≥ `FC_MIN_DAYS` (5) completed days** required for a slope — null below that.
- **A 2-day wiggle is NOT a trend** — `dir` is off the recent-window LEAST-SQUARES slope, so the last
  1–2 days alone cannot flip the classification (the maul: 7 up, 2 down still reads floor `flat`). The
  `run` field carries the DURATION so a caller reports "floor flat over 5d, softened 2d", never a verdict
  that flips on one day.
- All `FC_*` thresholds are **PLACEHOLDERS pending F1**.

## Surfacing
An inform note directly UNDER the existing trajectory line, on the SAME three surfaces `trajectoryRead`
feeds — rendered from ONE shared `formatFloorCeiling(fc, fmt, {label})` (fmt injected so windowread stays
dependency-free), so all surfaces are byte-identical:
- `pipeline/commands/read-window-range.mjs` — under the `read:` line in the DAILY TRAJECTORY block.
- `pipeline/commands/quote-items.mjs` — the `pushTrajectory` fold (per-item quote + `--positions` held
  lot), as a new `fcTrack` note.
- `pipeline/lib/render.mjs` — the new `fcTrack` NOTE_KIND (`⇅` sigil, context tier).

Wording (compact, one line): `floor <dir> <step>/d over <nUsed>d[ (<run> <len>d)] · ceiling <dir>
<step>/d[ (<run> <len>d)] · <classification>[ · ⚠ floor BROKE prior <N>d low by <gap>][ · today forming
low X/high Y (provisional)]`.

## Tests — `pipeline/test/windowread.test.mjs`
Synthetic series (no live data — rule 4) for the four real cases + the rails:
- **crash** — floor break + falling ceiling → `crash-risk`, `floorBreak.broke === true`.
- **mild-cooldown** (the maul) — flat/softening floor + easing ceiling → `mild-cooldown`, `broke ===
  false`, `floor.dir === 'flat'` (the 2-day dip does NOT flip it), `floor.run === {falling, 2}`.
- **healthy-trend** (soulreaper) — both rising → `healthy-trend`, no break.
- **forming-day guard** — an incomplete latest day with a deep low is EXCLUDED (`forming.key` set,
  `broke === false`); the SAME series WITHOUT the guard fakes a break (`broke === true`) — proving the
  guard matters.
- **rails** — thin/empty/null ⇒ null; a forming split that leaves < `FC_MIN_DAYS` ⇒ null.
- **`formatFloorCeiling`** — compact one-line note, null passthrough, label prefix, break + honesty rail
  surfaced.

Run the full existing suite (`node pipeline/test/windowread.test.mjs`) — no regressions; `node --check`
every touched file; `pipeline/ci/check-imports.mjs` resolves.

## Files touched
- `js/windowread.mjs` — `floorCeilingTrack` + `formatFloorCeiling` + `FC_*` consts (spec home = the header).
- `pipeline/commands/quote-items.mjs` — fold into `pushTrajectory` (both quote surfaces).
- `pipeline/commands/read-window-range.mjs` — render under the trajectory `read:` line.
- `pipeline/lib/render.mjs` — the `fcTrack` NOTE_KIND.
- `pipeline/test/windowread.test.mjs` — the six fixtures above.
- `README.md` — inventory entry (Map of the repo).

Pipeline/analysis change — **NO `APP_VERSION` bump** (not deployed-app code); no SKILL.md change.
```
