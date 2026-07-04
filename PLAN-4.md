# PLAN-4 — readable tables, screening economics, overnight mode, local time, action logging (2026-07-04)

Sequel to `PLAN-2.md` / `PLAN-3.md`, written against main @ 0.33.0 (niche-rating Scan tab
with per-niche graded tables + `pipeline/rating.mjs`; PLAN-3 underwater gate tree shipped —
`diurnalRead`/`moveShape`/`underwaterHours` exist in `js/quotecore.js`, fixtures in
`pipeline/quotecore.test.mjs`). Same executor contract: **read
`CLAUDE.md` fully, then PLAN.md's "Executor rules" — they apply verbatim** (node --check every
touched file, real-browser smoke test, APP_VERSION bump on app changes, no PII, spec-style:
rule + cheap anchor, no live data pasted into this doc). Work happens **directly on main** —
no worktrees/PR for this plan (Ben, 2026-07-04: sole consumer, keep pushing to main). When
this plan changes the canonical table shape, **update CLAUDE.md's "standard output format"
section in the same commit** — doc and code must not disagree.

## The problems (Ben, 2026-07-04)

1. **The Scan tab is hard to read.** Too many numbers too close together; unit suffixes
   repeated per cell; `Mom` is cryptic; the `Net/u Quick / Opt (ROI)` composite is noisy; no
   color; header and item name scroll away. Same complaints apply to the standard quote table
   on Trends; and the Trends plan-card blurb is one wall of prose.
2. **Avernic defender hilt never shows up in scans** despite being a real 1m+/day flip.
3. **Sub-500k gp/day rows aren't worth the time.** Most SPREAD-niche rows fall below that —
   "consider removing this option entirely."
4. **No overnight posture.** Late at night the right play is slow-fill patient offers that
   won't be stale/underwater by morning; daytime is when reactive/real-time offers make sense.
   The screen has one clock-blind posture.
5. **Time references in Trends and Ledger must be Ben's local time.**
6. **The Trends tab is missing the detailed last-2h view** that momentum and patient pricing
   are derived from.
7. **App actions are unobservable** — the diagnostics ring exists but nearly nothing writes to
   it; debugging means the browser console or nothing.

## Findings that shape the plan (verified 2026-07-04 — don't re-derive)

- **Avernic hilt is excluded by THREE gates, not one.** Live read: mid ~31.6m, limiting-side
  volume **12/d**, optimistic net/u ~360k (+1.2%), rising regime. Fails: (a) the `--floor 50`
  limiting-side unit floor; (b) band-niche `MIN_ACTIVE ≥ 6` traded-5m-windows (a 12/d item
  trades ~1 window per 2h); (c) `--min-roi 1.5` (1.2%). Lowering the unit floor alone — to any
  value — does not surface it. Lesson: **unit-count liquidity is the wrong measure for
  big-ticket items.** 12 units/day at 31.6m is ~380m gp/day of two-sided flow, and 360k
  net/unit is a real edge. Ben's "go as low as 240/day" instinct maps to gp-flow, not units.
- **The Scan already grades, and Grade already sits after Item.** `screen.mjs` HEADERS =
  `['Item','Grade',...QUOTE_HEADERS.slice(1),'Score gp/d']`; `rateItem()` in
  `pipeline/rating.mjs` blends expGpDay with risk factors into S+..D (cutoffs/weights are
  documented placeholders). So "rating after the name" is DONE for Scan; the remaining move is
  **Finder v1**, whose Risk grade + Rating bar sit at columns 9–10 (`renderFinder`,
  `js/ui.js`). Chunk B's liquidity work lands as a `rateItem` factor, not a new rating.
- **`screen.json` rows are pre-rendered strings** (`stdCells` output). Color/regrouping in the
  app needs structure the strings don't carry → structured cells (A1).
- **`quoteCells` in `js/quotecore.js` is the single formatting source** for the app table
  (`js/quote.js` → Trends card, Finder expander, position review) and the scripts (`stdCells`
  in `pipeline/cli.mjs` wraps it). Restyle there once → every surface follows. Do NOT restyle
  per-view.
- **`momSymbol` has no strength dimension.** `computeQuote` derives `mom` from the pre-clamp
  band comparison but not *how far* outside the band the live price is.
- **Time handling is already mostly local** — `analyseHourly` buckets with `getHours()`,
  Ledger `periodKey` uses local getters, log times via `toLocaleTimeString`. Known suspects:
  the live-offers list (`js/ui.js` ~L267) prints raw `date`/`time` strings straight from the
  exchange log; main's PLAN.md future-notes flag UTC-day slippage in day bucketing. Chunk E is
  an audit + rule, not a rebuild.
- **Logging infra is done; call sites are missing.** `logEvent(level, scope, msg)` +
  `setHealth` + persisted 50-entry ring + Logs view exist in `js/state.js`. Callers today:
  storage init, guide/market fetch, fills sync — zero user actions. Chunk F is
  instrumentation only.
- **CLAUDE.md's followups are partly stale**: the Ledger redesign (watchlist filter, grouping
  + drill-in, period P&L) is BUILT on main (`renderLedger`/`periodKey`). Fixed alongside this
  plan's doc commit.

## Decisions taken (Ben, 2026-07-04 — do not re-litigate)

- `Mom` → **Momentum**: `–` (ndash) for clean, multi-arrow strength (↑↑/↓↓ for violent moves),
  color coded red/green/yellow.
- Units live in the **header only** (`Vol/d` header → cell `70`).
- Rating **immediately after the item name** everywhere a rating renders.
- `Net/u Quick / Opt (ROI)` composite → a **Quick column** and an **Optimistic column**, each
  self-contained (buy → sell · net · ROI).
- **Frozen header + frozen first column** on the big tables; treatment applies to **Trends**
  (and every standard-table surface), not just Scan.
- Trends plan-card blurb gets **sectioned with small headers**.
- **Expected gp/day < 500k is below the attention floor**; spread niche likely dies to it —
  measure, then remove if empty.
- **Overnight vs active posture** is a real screening dimension, not a nice-to-have.
- All displayed times are **local time**.
- Thin unit-liquidity is **reflected in the rating**, not hidden by gates.

---

## Chunk A — Standard table v2 (one renderer, every surface)

Goal: the standard market table becomes glanceable — grouped columns, color, momentum arrows,
sticky header/first column — changed in ONE place so Scan, Trends, Finder expander, position
review, and the pipeline scripts stay consistent.

**A1 — Structured cells in quotecore.** Replace `quoteCells`' plain strings with structured
cells (`{t, c}` text + optional css class, or equivalent minimal shape) plus a `cellText()`
helper so the markdown path (`stdCells`/`mdTable` in `pipeline/cli.mjs`) derives the same
strings it prints today. `screen.json` publishes structured cells (bump a `schema` field; the
file stays self-describing — `headers` keep traveling with rows). Script stdout stays plain
markdown; color/class is app-only.

**A2 — New canonical column set** (update `QUOTE_HEADERS`, screen.mjs `HEADERS`, CLAUDE.md's
format section together):

`Item | Guide | Quick | Optimistic | Vol/d | Momentum | Regime` — Scan inserts `Grade` after
Item and appends `Score gp/d` as today; `--positions` appends Held@/Break-even/Verdict.

- **Mid is dropped from app tables.** It's `(24h avgHigh+avgLow)/2` — redundant next to Guide
  and the live prices. (This answers Ben's "what does mid mean".) Scripts may keep it if
  removal churns them; app tables lose it.
- **Quick** cell: `31.2m → 32m · +115k (0.4%)` (buy → sell · net/u · ROI); **Optimistic**:
  same shape on the patient band-edge basis. Net/ROI colored gain/loss. Exact separators are
  the executor's call — requirement: each column reads as one self-contained trade plan, the
  two columns visually parallel.
- **No unit suffixes in cells** where the header carries the unit.

**A3 — Momentum column.** Header `Momentum`. Values: `–` (ndash, muted) clean; `↑`/`↓` single
arrow = live price outside its 2h band; `↑↑`/`↓↓` = far outside. Strength computed in
`computeQuote` at the existing pre-clamp comparison — expose the overshoot (distance beyond
the band edge as a fraction of band width or price; pick one, comment it, name the
double-arrow threshold constant). Color: single arrow yellow/amber (caution), double arrow
full red (↓↓ plummeting) / green (↑↑ skyrocketing). `momVerdict()` and the cut-trigger logic
consume the categorical `mom` and DO NOT change in this plan.

**A4 — Rating placement.** Scan is already Item→Grade (keep). Move Finder v1's Risk grade +
Rating bar to immediately after Item (`renderFinder` markup + `<th>` order in `index.html`;
sort wiring follows the headers).

**A5 — Sticky header + first column.** CSS-only: `.tablewrap` bounded height + `overflow:
auto`; `thead th { position: sticky; top: 0 }`; first column sticky-left; corner cell gets
both + higher z-index; sticky cells need opaque backgrounds matching row striping (test both
stripe states + hover). Applies to shared table styles → Scan, Trends, positions all get it.

**A6 — Apply everywhere + verify.** Trends quote card, Finder expander, and position review
all render through `quoteTableHtml` (`js/quote.js`) → inherit A1–A5 with at most markup glue.
Smoke test (real browser): Scan renders the new shape from a fresh `--publish`; a Trends item
shows the same column set; sticky header/first column hold while scrolling both axes on a
narrow viewport; momentum arrows/colors render; `quote.mjs`/`screen.mjs` markdown still
column-aligned, numbers matching the app.

---

## Chunk B — Screening economics: gp-flow gate, 500k attention floor, spread verdict

Goal: an Avernic-class item (huge gp-flow, single-digit unit count) passes the screen and is
honestly marked thin; rows not worth Ben's attention stop rendering at all.

**B1 — gp-flow alternative liquidity path** (`gateCandidates()` in `screen.mjs`; gates stay
shared across niches):
- The two-sided gate (`hpv>0 && lpv>0`) is **untouched** — the ghost-spread lesson is
  non-negotiable.
- Liquidity gate becomes: `limitVol ≥ FLOOR` (default 50, unchanged) **or**
  `limitVol × mid ≥ GP_FLOOR` (new `--gp-floor`, default ~250m gp/day two-sided flow — the
  Avernic read was ~380m; pick the default to pass it with margin, comment the rationale).
- gp-flow-only qualifiers get `thin: true` → fed to `rateItem` as a liquidity/exit-ease
  penalty (caps the grade mid-scale; tooltip: "thin: ~N trades/day — size in units, expect
  slow fills"). The rating carries the warning; the gate stops hiding the item.
- **Band-activity gate scales for thin items**: `MIN_ACTIVE ≥ 6`/2h is structurally impossible
  at 12 trades/day. For gp-flow qualifiers, relax it (e.g. ≥1 two-sided window over a longer
  lookback, or either-sided windows for the activity count only — executor picks one,
  documents inline; band *prices* keep the same loadBands basis).
- **ROI gate gains an absolute-gp alternative for thin items**: pass on `modeRoi ≥ MIN_ROI`
  or (`thin` && `modeNet ≥ MIN_NET_GP`, new constant ~100k/u). The percentage gate was built
  for cheap items and starves big tickets.

**B2 — The 500k/day attention floor.** New shared gate `--min-gpd` (default 500_000) on
realistic `expGpDay`: below it a row is not worth Ben's time regardless of grade — don't
render it (screens hide, same spirit as the falling-items rule; held/asked items are exempt
as always). Applied pre-rating so grades never advertise sub-floor rows.

**B3 — Spread-niche verdict.** Ben: most SPREAD rows fall under the floor — "consider removing
this option entirely." Sequence: apply B2, run `--mode all` for a few days of publishes; if
the spread table is empty/near-empty, drop spread from `--mode all` and the app Scan tab
(keep `--mode spread` runnable from the CLI until it's confirmed dead, then delete). Removal
is the expected outcome; the few-day check is just honesty about one data point.

**B4 — Verify with the live case + regression.** Post-B1, `screen.mjs --publish` must surface
Avernic defender hilt (or whichever big ticket currently fits the profile) with the thin
tooltip visible in the app — and the non-thin survivor set must be materially unchanged vs a
pre-change run (capture before/after; gp-flow should *add*, not reshuffle). Update CLAUDE.md's
screen-workflow flags (`--gp-floor`, `--min-gpd`) and note: the two-sided-liquidity *lesson*
stands; the unit floor was the wrong universal measure.

---

## Chunk C — Trends: sectioned plan card + the missing 2h view

Goal: the `sreason` prose run under the Suggested-plan grid (`runTrends`, `js/trends.js`)
becomes small labeled sections, and Trends gains the **detailed last-2h view** its own signals
come from.

**C1 — Sectioned blurb.** Only render sections that apply:
- **⚠ Warnings** — regime-shift guard + volatile flag (stays FIRST; it governs trust in the
  rest).
- **Flip now** — the instant-spread math (profitable / doesn't-clear-tax branches).
- **Patient pricing** / **Price to clear** — the `PT.falling` branch keeps its own header
  ("Price to clear"); the header IS the signal, don't merge the two.
- Fine-print caption (`.ccap`) stays the trailing footer outside any section.
- Styling reuses an existing small-header pattern (`.stitle` scale) — no new design language;
  plain blocks, not collapsibles (disclosure stays `trWhy`/`trTiming`'s job). Layout only —
  the copy stays (minor smoothing where a sentence assumed it followed another is fine).

**C2 — "Recent movement (last 2h)" section.** New block between the plan card and "Why this
trend?": the 2h detail behind Momentum and patient pricing, currently invisible. The 5m series
(`s5m`) is ALREADY fetched in `runTrends` — no new requests.
- Small 2h chart of the 5m series (reuse `js/charts.js` inline-SVG helpers) with the band
  edges (min avgLow / max avgHigh — the `patientTargets` basis) marked and the live quick
  buy/sell overlaid, so an outside-the-band break is *visible*, not just a glyph.
- One-line readout: band lo → hi, where the live price sits in the range (e.g. "live sell at
  the 85th pctl of its 2h range"), traded-window count (thin 2h activity should say so), and
  Momentum with the A3 arrows/colors — Trends and Scan speak the same language.
- Respect `showAnalysis` (off-screen quotes stay compact) and render only when the series has
  points.

**C3 — Rolled-in chart notes** (from main PLAN.md's future-enhancements list, which this plan
absorbs): try **overlaying the price + volume charts** on one axis set in the item detail
(volume as background bars; evaluate visually, keep separate if cluttered), and add a
**"now" vertical marker** to the hourly price/volume charts so the current moment is visible
in the daily cycle. Both small, both live in `js/charts.js`/`js/trends.js`.

---

## Chunk D — Overnight vs active posture

Goal: late at night, surface offers designed to fill slowly and still be safe by morning;
during active hours, keep the reactive real-time posture. (Ben: "if it's late at night we
should look for offers that will take a long time to fill and not be stale/underwater by
morning.")

- **`--posture overnight|active|auto`** on `screen.mjs` (auto = local clock: overnight
  roughly 22:00–06:00 local; named constants). Posture tunes the shared stack, not a new
  niche:
  - **overnight**: only flat/rising regimes with confident bands (no `thin` fast-lane, no
    breakdown momentum); prices at the patient band edges; ranking weights net edge over
    velocity (slow fills are the point); exclude items whose *yesterday overnight window*
    printed materially below the current bid — the "stale/underwater by morning" test. The
    ~30h depth of the 5m series covers exactly one prior night; **build this on the shipped
    `diurnalRead` in `js/quotecore.js`** (PLAN-3 chunk 2, live as of 0.33.0) rather than a
    parallel implementation, and extend `pipeline/quotecore.test.mjs` with posture fixtures.
  - **active** (default in daytime): current behavior.
- **Positions side:** `quote.mjs --positions` gains an overnight note when run late: flag any
  open SELL priced below break-even-by-morning risk (falling regime or breakdown momentum) —
  informational line, verdict logic unchanged.
- The published `screen.json` records the posture in `params` so the app's Scan banner says
  which posture it's looking at.
- **Honest limit** (process rule 4): one prior night is one sample; posture picks *which
  existing edges to prefer*, it must not manufacture new price predictions. Real overnight
  fill-time curves are PLAN-2 chunk D's outcomes-dataset job — note the dependency, don't
  fake it.

---

## Chunk E — Local-time audit

Goal: every rendered time in the app is Ben's local time, verified rather than assumed.

- Sweep all rendered timestamps (grep `toISOString|getUTC|\.date|\.time` over `js/`): known
  suspects are the live-offers list (`js/ui.js` ~L267) printing raw exchange-log `date`/`time`
  strings, and any day-bucket boundary that could slip a UTC day (main PLAN.md's note; verify
  `periodKey` day/week boundaries with a near-midnight fixture).
- Rule lands in CLAUDE.md (one line): all displayed times are local; UTC/ISO strings are for
  storage and logs' wire format only.
- Trends hourly buckets (`getHours()`) and Ledger period grouping verified local already —
  this chunk is confirm + fix stragglers, small by design.

---

## Chunk F — Action logging pass

Goal: every meaningful user action and app decision leaves a line in the existing log ring, so
"what just happened" is answerable from the Logs view on any device (doubly so on mobile — no
console).

- **Instrument, don't rebuild.** Use `logEvent(level, scope, msg)`; new scope `'action'` for
  user-initiated things; existing scopes for system events.
- **Call sites** (sweep `js/main.js`, `js/ui.js`, `js/trends.js`, `js/backup.js`): tab
  switches; manual refresh buttons (market, scan, fills/positions); watchlist add/remove (item
  + resulting count); trade add/edit/delete + fills-row hide/tombstone; Trends open (item +
  source: search/deep-link/finder); quote expander fetches; position review runs (+ verdict
  counts); backup export/import (import: counts + version); settings changes (NEVER log
  secret values — "PAT updated" only); scan deep-link clicks. One line each, includes the
  object of the action, no PII.
- **Ring + view scale up:** `LOG_MAX` 50 → 200 (lines are tiny; persistence already runs
  per-event). Minimal scope filter on the Logs view (All / actions / system) so action chatter
  doesn't bury fetch errors — a `<select>` + filter in `logRowsHtml`, not a log console.
- **Noise rule:** log state *changes* and explicit actions, never renders. Nothing in a render
  path may call `logEvent` unconditionally (re-check chunk-A code too).
- Smoke test: click through every instrumented action once → each appears exactly once; no
  line fires on a passive re-render/price tick.

---

## Rolled up / explicitly NOT rolled up

- **Rolled in from main PLAN.md's future-enhancement notes** (that list is absorbed here):
  local-TZ day bucketing (→ E), price+volume chart overlay and current-time marker (→ C3).
  The 100–200-item pattern-study note stays with the rating-validation work, not here.
- **Stays in PLAN-2** (data capture priority, unbuilt): chunk A outcomes dataset +
  suggestions ledger, chunk B mobile writes/GitHub-as-backend, chunk D algorithm feedback
  (gated). PLAN-2 chunk C shipped as 0.31.0 and was then superseded by the niche-rating Scan
  (0.32.0) — noted in PLAN-2.
- **PLAN-3 is fully built** (0.33.0 — gate tree, NO-READ/DIURNAL-WATCH/SHOCK-WATCH verdicts,
  fixtures): nothing to roll up; chunk D builds directly on its `diurnalRead`.
- **Stays in CLAUDE.md followups**: Refresh-positions button (natural home is PLAN-2 B4);
  per-item "recommend price adjustment" button (C2's readout is a step toward it, the button
  itself is deferred).

## Suggested order

**A → C → B → E → D → F.** A defines the cell/structure vocabulary everything else renders
into; C shares A's styling; B changes what rows exist (independent of A but its thin tooltip
uses A4); E is small and standalone; D builds on B's gate refactor; F last so it instruments
final shapes. A+C can land as one visual-refresh version bump; B, D, and E+F as their own.

## Out of scope

`momVerdict`/cut-trigger changes (momentum strength is display-only for now); rating
cutoff/weight calibration (placeholder values stay until the validation study); Exp gp/d
formula calibration (PLAN-2 chunk D); client-side re-scanning (PLAN-2 C3, deferred);
Ledger redesign (built — CLAUDE.md updated).

## Discovered

**Open:** _(none yet)_
