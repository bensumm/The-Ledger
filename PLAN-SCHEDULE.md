# PLAN-SCHEDULE — the buy/sell window agenda (`/schedule`)

**Status: BUILD-READY (Fable, 2026-07-23).** Owner's final decisions folded in below; every
file:line anchor re-verified against the live repo during this pass (all held, one line-range
correction noted in Chunk 3). Pipeline-only — no deployed-app change, no `APP_VERSION` bump. An
Opus implementer can execute this without further design work.

**Straightforwardness verdict: yes, materially simpler than a fresh feature — nearly every
building block already exists and is already exported/reusable, and prospects' removal (below)
makes this now genuinely ALL existing-parts, zero new data stores.** `hourProfile` is already
exported from `js/windowread.mjs`, `fmtHourRange` is already the dual-zone label helper, the `-c`
join is two existing one-line reader calls, and the `-w` fetch-cost worry is pre-solved by an
existing 15-minute disk cache on every timeseries fetch. The one place that still deserves real
care is the `In (h)` midnight-wrap/rounding math — worth its own fixture file. See "Risks" at the
bottom for the residual honest list.

## OWNER'S FINAL DECISIONS (2026-07-23 — binding, folded in throughout this doc)

1. **Ship `-c` (current position) + `-w` (watchlist) ONLY. Prospects are DROPPED.** No
   `prospects.json`, no `declare-prospect.mjs`, no `-p` flag, anywhere — in code, docs, or chunk
   list. This was the plan's only genuinely-new surface; removing it means the whole feature is
   built from parts that already exist today. **Default scope with no flag = `-c`.**
2. **The `In (h)` column** (hours to each window's next start, nearest 0.5h, table sorted by it
   ascending) ships exactly as hardened in the prior pass — unchanged below.
3. **The loop one-liner** `⏭ next: <item> <ACTION> <window PDT> (~Xh)`, scoped to `-c` only, ships
   as designed — including the fragile-chain comment at the wiring point (disk-cache warmth from
   `watch-positions.mjs`'s same-tick fetch is what makes it cheap, not in-process shared state).
4. **The watchlist audit stays in scope**, as its own chunk, fully detailed below (enumeration,
   join, output shape, and a recommendation on where it lives).

## Problem / motivation
Every tracked item runs its own daily **buy(dip) / sell(peak) clock** (boots peaks overnight 01–03
PDT, seed peaks midday 11–17 PDT, chins/bludgeon peak US-evening, etc.). Today these are
re-derived by hand each pass. We want (a) a consolidated, **time-sorted agenda** of what to buy/sell
when, across a chosen set of items, and (b) a **one-line "next window"** on every loop pass so the
upcoming action is always visible.

The windows are exactly the `hourProfile` dip/peak that `read-window-range.mjs --profile` already
prints — this is a **presentation/aggregation layer over existing data**, NOT a new market model.

## The two source lists (selectable by flag)
Each item's list membership is tagged in the output (C / W). Flags UNION the lists; an item in
both shows both tags. Precisely:

- **`-c` / `--current-position`** — anything with **money in GE or an item in a GE slot**: the open
  lots in `positions.json` (`open`) **∪** the open offers in `offers.json` (resting BUYs = cash
  committed, resting SELLs = item listed). This is the actionable set, and the **default scope**
  when no flag is passed. Built from two EXISTING reader helpers, `readOpenPositions()`
  (`pipeline/lib/positions.mjs:20`) and `readOffersSnapshot()` (`pipeline/lib/offers.mjs:89`) — a
  plain `Set` union of their itemIds, no new helper. Re-verified live: `readOpenPositions`
  confirmed at `positions.mjs:20`, `readOffersSnapshot` confirmed at `offers.mjs:89`.
- **`-w` / `--watchlist`** — the existing `watchlist.json` (flat array of item NAME strings,
  re-confirmed live — `["Abyssal bludgeon", "Armadyl crossbow", ...]`, no ids), resolved via the
  existing `loadMapping()` (`pipeline/lib/marketfetch.mjs:103`, re-confirmed live) the same way
  every other CLI does.

**Default scope (no flag): `-c` only.** Rationale unchanged from the prior pass: `-c` is the only
scope with real money on the line — a watchlist item with no position has no window urgency yet.
`-w` is an explicit opt-in for a deliberate "what's coming up across everything I track" pass, not
the default noise floor. This also keeps the default invocation cheap (see "Fetch cost" below) —
`-c` is typically 2-6 items (`positions.json`'s `open` + `offers.json`'s `offers`, deduped), not the
`-w` ~25-item case.

## Output — one time-sorted table
Sorted by **`In (h)` ascending** (soonest window first):

| In (h) | Window (PDT / UK) | Item | Action | Level | List |
| --- | --- | --- | --- | --- | --- |
| 2.5 | 01:00–03:00 / 09–11 | Primordial boots | SELL peak | 19.15m | C |
| 4.0 | 02:00–08:00 / 10–16 | Enhanced crystal seed | BUY dip | 3.34m | C |
| … | | | | | |

- **`In (h)`** — hours from **now** to the window's **next start**, **rounded to nearest 0.5h**.
  - **Math:** `startH` is a LOCAL hour-of-day integer 0-23 (`hourProfile`'s `dip.startH`/`peak.startH`,
    derived from `d.getHours()` at `js/windowread.mjs:921` — already local, repo rule satisfied with
    zero extra work). `deltaH = ((startH - now.getHours() - now.getMinutes()/60) + 24) % 24`, then
    round to nearest 0.5. This is a plain "next occurrence of an hour-of-day, wrapping past
    midnight" computation — the `% 24` after adding 24 handles the wrap uniformly, no separate
    midnight-special-case branch needed.
  - **Currently inside a window:** render `now` (0.0h), clamped — never negative. Test:
    `startH <= endH` (non-wrapping window) → inside iff `startH <= nowH < endH`; a
    **midnight-spanning window** (`startH > endH`, e.g. `18-00` meaning 18:00→00:00, or `22-3`)
    → inside iff `nowH >= startH || nowH < endH`. `spanOf()` (`js/windowread.mjs:891-901`) already
    returns `endH` as the wrapped value (e.g. `endH: 0` for a cluster that runs into midnight), so
    the schedule reads `startH`/`endH` off the SAME cluster shape every other consumer already
    reads — no new span representation.
  - **Window that spans midnight for the `In (h)` NEXT-START calc itself:** unaffected by the
    span's own wrap — `In (h)` only ever needs `startH` (when does BUYING/SELLING begin), not
    `endH`; the wrap-past-midnight logic is identical whether the window's END also crosses
    midnight or not. Don't conflate "the window spans midnight" with "the next start wraps past
    midnight" — they're independent and only the latter matters for this column.
  - **Rounding at a 0.25h boundary:** standard round-half-up to the nearest 0.5 (`Math.round(deltaH
    * 2) / 2`); no special tie-break needed since `now` carries seconds-precision, a true exact
    0.25 tie essentially never occurs in practice, and if it did either rounding direction is
    equally defensible for an inform-only display column.
  - **DST:** confirmed NOT a concern at this grain. `hourProfile` buckets by LOCAL `getHours()` per
    historical sample (so a DST-shifted day's data already lands in its OWN local hour, no
    correction needed there), and `In (h)`'s own `now.getHours()`/`getMinutes()` read is likewise
    already-local. The only theoretical wrinkle is the ~1h "spring forward" evening the wall clock
    itself skips an hour, and a 0.5h-rounded inform-only agenda column is not worth special-casing
    for that one evening a year — same discipline as the rest of the repo's "displayed times are
    local, DST is the OS's problem" convention (no existing renderer special-cases it either).
- **Window** — the dip or peak hour range, **both zones** (`fmtHourRange(startH, endH)` —
  `js/money-format.js:64`, already dual-labels PDT/UK, confirmed reusable as-is, zero changes; line
  re-verified live).
- **Action** — `BUY dip` / `SELL peak`.
- **Level** — the dip/peak recent level (the buy/sell price guide from `hourProfile`, i.e.
  `dip.level`/`peak.level` — the recent-cluster median, `js/windowread.mjs:1006-1007`).
- **List** — C / W tag(s).

Each item contributes up to **2 rows** (its dip + its peak). When the multi-peak work
(`PLAN-MULTI-PEAK-WINDOWS.md`) lands, secondary windows simply add rows — **re-confirmed compatible
against that plan's SHIPPED emit shape (its "Emit-shape decision" section, corrected here to the
final prominence-ranked design that superseded the old single-nullable-field draft):** `hourProfile`'s
return gains two new ADDITIVE keys, `peaks` and `dips`, each an **array of 1–2 window objects**
(prominence-ranked), `peaks[0]`/`dips[0]` byte-identical to (deep-equal) the unchanged
`profile.peak`/`profile.dip`, and `peaks[1]`/`dips[1]` (present only when a second window clears the
prominence gate) the secondary — shaped `{startH, endH, hours, level, atHour, prominenceFrac}`.
The **"unaffected" half of the compat claim still holds**: `profile.peak`/`profile.dip` are unchanged,
so `read-schedule.mjs` built against them today keeps working unchanged after that plan landed, zero
rework. The **"opt-in" half is corrected to the array shape**: a later, separate chunk of
`read-schedule.mjs` would iterate `profile.peaks`/`profile.dips` (arrays, index `[1]` is the
secondary) and emit a row per entry beyond index 0 — so "each item contributes up to 2 rows" would
become **up to 2 rows PER SIDE (2 dip + 2 peak = up to 4)**, not the "up to 2 total" the line above
implies. **Not part of this plan's chunk list**, noted only as a natural future extension; nothing in
the multi-peak plan forces `read-schedule.mjs` to opt in at all.

**Position-aware action: option A (show BOTH rows always) for v1.** Reasoning: `-c` items are the
primary scope, and a held-but-still-accumulating lot legitimately wants both its dip (buy more) and
peak (sell the existing stack) windows visible — collapsing to "the position-relevant one" requires
a HELD-vs-BIDDING classification `read-schedule.mjs` doesn't otherwise need (that classification
already exists elsewhere, e.g. `heldDisplay`/`rawHeldToken` in `pipeline/lib/item-context.mjs`, but
importing it just to hide a row is added surface for a cosmetic filter). Option B (position-relevant
only) is a cheap v2 refinement once the plain agenda has been used for a few sessions and Ben has an
opinion on the noise level — not worth guessing the cut now.

## The loop one-liner
`⏭ next: <item> <ACTION> <window PDT> (~Xh)` — the single soonest upcoming window among
**current positions (`-c`)**, printed at the TOP of each loop pass. Only `-c` scope — that's what's
actionable mid-loop.

`run-loop.mjs` is a pure DRIVER — it `execFileSync`s `watch-positions.mjs`/`screen-flip-niches.mjs`
as SEPARATE node processes and streams their stdout, so the header is NOT a free read off
in-process state. **Re-verified live (line numbers corrected from the prior pass — the driver has
moved slightly since):**
- The action-sequencing block (`plan.push('sync'/'watch'/'scan'...)`, the header `console.log`s) is
  now at `pipeline/commands/run-loop.mjs:116-129` (was cited as 17-36 in the prior draft — corrected).
- The actual `execFileSync('node', args, { cwd: REPO, stdio: 'inherit' })` call inside the shared
  `runScript(label, args)` helper is at `pipeline/commands/run-loop.mjs:134` (was cited as 41-47 —
  corrected; `execFileSync` is `import`ed at line 47, which is likely the source of the prior
  citation's off-by-block).
- **Wiring point, concretely:** add the header print as its own small step right after the header
  `console.log`s at `run-loop.mjs:128-129`, inside the same `watch`-due branch, calling
  `read-schedule.mjs`'s row-building function directly (in-process, no subprocess) if
  `read-schedule.mjs` is factored per Chunk 2's acceptance criteria (pure row-builder, thin CLI
  print wrapper) — do NOT spawn a third `execFileSync` subprocess for this if the in-process import
  is available cheaply; only fall back to a fourth `execFileSync node read-schedule.mjs -c --top1`
  step if the row-builder can't be cleanly imported (e.g. an ESM/CJS or cwd mismatch surfaces during
  implementation).

What makes it cheap (unchanged from the prior pass, still true):
1. `positions.json`/`offers.json` are local JSON file reads (no market fetch) — trivial either way.
2. The market fetch this needs (1h timeseries per `-c` item, for `hourProfile`) is **very likely
   already warm** by the time the header prints: `watch-positions.mjs` itself already fetches
   `ts1h` and calls `hourProfile` for every held item on every tick (confirmed —
   `pipeline/commands/quote-items.mjs:224,337,759,822` and its `fetchTsCached`/`fetchTs` calls,
   which `watch-positions.mjs` shares logic with) and every timeseries fetch is disk-cached for 15
   minutes (`FETCH_TTL.tsSlow`, `pipeline/lib/marketfetch.mjs:79`, re-verified live as
   `tsSlow: 15 * 60e3`, honored transparently inside `fetchTs`/`cachedJget`). So a same-tick "next
   window" computation pays no marginal network cost for `-c` items — it hits the disk cache the
   watch pass just filled.

**FRAGILE-CHAIN COMMENT — put this literally at the wiring point in the code, not just in this
plan:** the "cheap" claim depends on `watch-positions.mjs` continuing to call `hourProfile` for
every held item on every tick. If a future change ever makes `watch-positions.mjs` skip that call
for a fast-path optimization, the loop header would silently start paying full fetch cost again with
no assertion catching it. A one-line code comment at the header-print call site (`run-loop.mjs`,
near line 129) stating this dependency explicitly is a Chunk 3 acceptance requirement, not optional
polish.

## The watchlist audit (its own chunk)
Review `fills.json` / `positions.json` `closed` for items we've **actually flipped** that are **NOT
in `watchlist.json`**, and surface them (with trade count + realised P/L) as **proposed additions**
for Ben to greenlight. This is a review output, not an auto-mutation — it never edits
`watchlist.json` itself.

**Enumeration + output shape (re-verified against the live `positions.json` in this pass):**
- Source: `positions.json`'s `closed` array. Confirmed live shape of one entry:
  `{ itemId, qty, buyEach, sellEach, tax, realised, banked, buyTs, sellTs }` — `itemId` and
  `realised` are exactly the two fields this audit needs, no other field required.
  `closed` is the simpler source than re-deriving from `fills.json`'s raw `events` since it's
  already the FIFO-matched, realised-P/L view.
- **Join:** group `closed` by `itemId`, `count = entries.length`, `sumRealised = Σ realised`.
  Resolve each id's NAME via `loadMapping()` (`pipeline/lib/marketfetch.mjs:103`). Build a `Set` of
  `watchlist.json`'s names (confirmed live: a flat array of item-name strings, e.g.
  `"Abyssal bludgeon"`, `"Armadyl crossbow"`, …). Filter to ids whose resolved name is NOT a member
  of that `Set` — a plain name-keyed membership check (the join is name-keyed, not id-keyed, because
  `watchlist.json` has no ids).
- **Output shape:** a simple table, sorted by trade count descending (most-flipped-but-unwatchlisted
  first — the strongest signal): `Item | Trades | Realised P/L`. No `In (h)`/window columns —
  distinct audit output, not a schedule row.
- **Recommended home: a `--audit` flag branch on `read-schedule.mjs`**, not a separate script file.
  Reasoning: it shares `loadMapping()` and the `watchlist.json` read with the main agenda path, adds
  no new CLI surface for Ben to remember, and is small enough (group-count-sum-filter-sort, no
  market fetch at all — it reads two already-local JSON files) that a separate file would be pure
  process overhead. Implementation: `read-schedule.mjs --audit` short-circuits BEFORE the `-c`/`-w`
  list-selection and `hourProfile` fetch path entirely (this mode touches no market data, so it
  should exit fast and never trigger the fetch-cost concerns below) and prints the audit table
  instead of the agenda table. `-c`/`-w`/`--audit` are mutually exclusive modes of the same
  entrypoint, not combinable flags.

## Mechanics / reuse / constraints
- **Windows** come from `windowread.mjs` `hourProfile` — the SAME dip/peak `read-window-range`
  prints, and **already exported** (`export function hourProfile(series, opts)`,
  `js/windowread.mjs:911`, re-verified live) — no factoring-out needed, see "Reusable window
  function" below.
- **`In (h)` math** — resolved in full above ("Output — one time-sorted table").
- **Times rendered LOCAL** (repo rule) — satisfied automatically since `hourProfile` already buckets
  by local `getHours()`; dual-zone label via `fmtHourRange` (`js/money-format.js:64`).
- **Honesty (rule 4):** windows are `hourProfile` medians, n≈0, inform-only — same class as the
  diurnal notes. The schedule PLANS, it never gates.
- **Pipeline-only:** no app change, no `APP_VERSION` bump. New `read-schedule.mjs` → README
  inventory entry; `/schedule` skill; CLAUDE.md ask→command row. **No new data file at all** — with
  prospects dropped, this plan introduces exactly ONE new tracked file: `read-schedule.mjs` itself.

### Reusable window function — RESOLVED

`hourProfile(series, { nights, now, recentN })` is **already exported** from `js/windowread.mjs`
and is exactly what `read-schedule.mjs` needs: feed it a 1h `/timeseries` array (the same shape
`fetchTs(id, '1h')` returns, `pipeline/lib/marketfetch.mjs:169`, re-verified live), get back `{ dip:
{startH, endH, level, ...}, peak: {startH, endH, level, ...}, ... }` (or `null` if too thin —
`HOURPROFILE_MIN_DAYS = 4` floor, `js/windowread.mjs:863`, re-verified live, same honest-degrade
contract every other windowread.mjs helper follows). `read-window-range.mjs --profile`
(`pipeline/commands/read-window-range.mjs:169`) already calls it end-to-end exactly this way:
`loadMapping()` → resolve item → `fetchTs(r.id, '1h')` → `hourProfile(series, { nights })` → print
`fmtHourRange(prof.dip.startH, prof.dip.endH)` + `fmt(prof.dip.level)`. `read-schedule.mjs`'s
per-item computation is this SAME four-step call sequence, just looped over the selected list and
feeding a sortable row array instead of printing per-item. Nothing needs factoring out.

### `-c` definition — RESOLVED

The join is two existing reader calls, no new helper:
- `readOpenPositions(positionsPath)` (`pipeline/lib/positions.mjs:20`, re-verified live) →
  `{ groups }`, where `groups` is `[{ itemId, qty, cost, avgCost, buyTs }]` (open lots already summed
  per item at weighted-avg cost, `qty > 0` only).
- `readOffersSnapshot(offersPath)` (`pipeline/lib/offers.mjs:89`, re-verified live) → `offers`, an
  array of `{ slot, side, itemId, item, price, qty, filled, lastUpdateTs }` (confirmed against the
  live `offers.json`).

`-c`'s item-id set = `new Set([...groups.map(g => g.itemId), ...offers.map(o => o.itemId)])`. Both
readers already degrade safely on a missing/corrupt file (`{err}` / `[]` respectively) — no new
error-handling needed, just check for `.err` the way `watch-positions.mjs` already does.

### `-w` definition — RESOLVED

`watchlist.json` (repo root, tracked) is a flat array of item NAME strings (re-verified live —
`["Abyssal bludgeon", "Armadyl crossbow", "Avernic defender hilt", ...]`). Resolve each name to an
id via the existing `loadMapping()` (`pipeline/lib/marketfetch.mjs:103`) the same way every other
CLI in the repo resolves a name argument — no new lookup helper. A name that fails to resolve
(typo, delisted item) should print a one-line warning and skip that entry rather than aborting the
whole run — match the degrade-gracefully convention the rest of the pipeline uses for a bad id.

### Fetch cost — RESOLVED

**The heavy-path worry is largely pre-solved by an existing mechanism, not something to newly
build.** `fetchTs(id, '1h')` already routes through `cachedJget` with a 15-minute disk TTL
(`FETCH_TTL.tsSlow = 15 * 60e3`, `pipeline/lib/marketfetch.mjs:79`, re-verified live, cache files
under `pipeline/.cache/fetch/`) — this applies to EVERY caller, automatically, with zero code in
`read-schedule.mjs` needed to opt in. Concrete mitigation plan:
1. **Parallelize** the per-item `fetchTs` calls with a modest concurrency cap. **Re-verified
   live:** `screen-flip-niches.mjs` uses `FETCH_CONCURRENCY = 5` (`pipeline/commands/
   screen-flip-niches.mjs:2077`, comment: "keep modest; the wiki API sees ≤15 concurrent requests")
   with a worker-pool pattern at line 2101 (`Promise.all(Array.from({ length:
   Math.min(FETCH_CONCURRENCY, ids.size) || 1 }, worker))`). **`read-schedule.mjs` should copy this
   exact constant and pattern** — `FETCH_CONCURRENCY = 5` — rather than invent a new number.
2. **Rely on the existing 15-min disk cache** for repeat runs within a window — a second
   `/schedule -w` call inside 15 minutes of the first (or of any OTHER script that already fetched
   the same item's 1h series recently — `quote-items.mjs`/`screen-flip-niches.mjs`/
   `watch-positions.mjs` all do) costs ZERO network round-trips, just a disk read.
3. **Realistic estimate for a cold `-w` run (~25 items, nothing cached):** ~25
   `/timeseries?timestep=1h` HTTP calls, each independently cheap, at concurrency 5 ⇒ roughly 5
   sequential fetch rounds. Real-world per-call latency for this endpoint elsewhere in the repo is
   well under a second; a cold ~25-item `-w` pass should land in low single-digit seconds, not
   minutes. A WARM run (anything already fetched by a recent `/scan` or `/positions` pass in the
   last 15 min) is near-instant — most of the disk reads hit.
4. No need for a NEW cache TTL or a loop-snapshot-reuse mechanism beyond what already exists.

## Chunks (build in this order — 3 chunks, prospects removed)

**Chunk 1 — `read-schedule.mjs` core (agenda + audit modes).**
- **Files:** new `pipeline/commands/read-schedule.mjs`.
- **Scope:** list selection (`-c` default / `-w` via `readOpenPositions` + `readOffersSnapshot` /
  `watchlist.json` + `loadMapping`), per-item `fetchTs('1h')` + `hourProfile` (parallelized,
  `FETCH_CONCURRENCY = 5`, matching `screen-flip-niches.mjs`'s pool pattern at
  `screen-flip-niches.mjs:2077,2101`), the `In (h)` column as a small **pure exported function**
  (e.g. `hoursUntil(startH, now)` returning the rounded delta, and a separate `isInsideWindow(startH,
  endH, nowH)` boolean helper) so it's independently fixture-testable AND reusable by the loop
  one-liner (Chunk 3) without re-deriving the math, sorted agenda table (`In (h)` ascending), C/W
  tags, and the `--audit` mode (short-circuits before any market fetch, per "The watchlist audit"
  above).
- **Structure requirement (needed by Chunk 3):** factor the file as a pure row-building function
  (e.g. `buildAgenda({ scope, now })` returning `Row[]`) plus a thin CLI wrapper that calls it and
  prints — mirroring the "pure function + thin CLI wrapper" split most `pipeline/lib/*` modules
  already follow. This is what lets Chunk 3 import the row-builder in-process instead of spawning a
  subprocess.
- **Acceptance checks:**
  1. `hoursUntil`/`isInsideWindow` fixture file covering: (a) ordinary case (`startH` a few hours
     ahead of `now`), (b) midnight-wrap next-start (`now` late evening, `startH` early morning —
     e.g. `now=23:10`, `startH=2` ⇒ ~2.83h, rounds to 3.0h), (c) currently-inside-window, both
     non-wrapping (`startH<=endH`) and midnight-spanning (`startH>endH`, e.g. `startH=22, endH=3`)
     — renders `0.0`, never negative, (d) a rounding-boundary case at exactly `X.25`h confirming
     round-half-up behavior.
  2. `-c`-with-no-positions-and-no-offers: renders an empty agenda (a clean "nothing to schedule"
     message, not an error / not a crash on an empty `Set`).
  3. `-w` name→id resolution: one fixture watchlist name that resolves via `loadMapping()`, and one
     deliberately-unresolvable fake name confirming the skip-with-warning behavior (not an abort).
  4. End-to-end run against a 1-2 item fixture (mocked or a real cheap live call) confirming row
     count (up to 2 rows/item) and sort order (`In (h)` ascending).
  5. `--audit` mode: a small fixture `closed` array with one itemId present in `watchlist.json` and
     one absent, confirms only the absent one surfaces, with correct trade count + summed realised.
  6. Manual timed run (cold and warm) of a `-w` pass to empirically confirm the "low single-digit
     seconds cold / near-instant warm" fetch-cost estimate — not just trust the estimate in this doc
     (Risk 2 below).

**Chunk 2 — Loop one-liner wiring.**
- **Files:** `pipeline/commands/run-loop.mjs` (edit), reusing `read-schedule.mjs`'s exported
  row-building function from Chunk 1.
- **Scope:** wire the `⏭ next: <item> <ACTION> <window PDT> (~Xh)` header into the `watch`-due
  branch, right after the existing header `console.log`s at `run-loop.mjs:128-129` (re-verified
  live line numbers — corrected from the prior draft's stale 17-36/41-47 citations). Prefer the
  in-process import of Chunk 1's row-builder over spawning a fourth `execFileSync` subprocess;
  fall back to the subprocess form only if the import proves awkward during implementation (note
  which path was taken in the commit message). **Include the fragile-chain code comment** at the
  wiring point per "The loop one-liner" section above — this is a required acceptance item, not
  optional.
- **Acceptance checks:**
  1. With a fixture/live `-c` set of 1+ items, the header line renders with the single soonest
     window among them, correctly picking the minimum `In (h)` across all rows (dip AND peak) of
     all `-c` items — not just the first item's own soonest row.
  2. With an empty `-c` set (no positions, no offers), the header line is omitted or renders a
     clean "nothing scheduled" form — no crash, no blank/garbled line.
  3. A manual `run-loop.mjs` tick confirms no marginal fetch latency is visibly added when
     `watch-positions.mjs` has just run in the same tick (i.e. the disk-cache-warmth claim holds in
     practice, not just in theory) — a quick manual timing check, not a formal benchmark.
  4. The fragile-chain comment is present at the call site and names `watch-positions.mjs`'s
     per-held-item `hourProfile` call as the thing this depends on.

**Chunk 3 — `/schedule` skill + docs reconciliation.**
- **Files:** new `.claude/skills/schedule/SKILL.md`; `README.md` (new inventory entry for
  `read-schedule.mjs`); `CLAUDE.md` (new ask→command table row).
- **Scope:**
  - `README.md`: add `read-schedule.mjs` to the pipeline command inventory (purpose, `-c`/`-w`
    flags, `--audit` mode, what it reads — `positions.json`/`offers.json`/`watchlist.json` — and
    that it produces no new tracked file). Use the existing command entries (e.g.
    `read-window-range.mjs`, `read-buy-limits.mjs`) as the template for format/depth, not the
    `dip-watchlist.json`/`hold-thesis.json` DATA-file entries (there is no new data file here).
  - `CLAUDE.md`: add one row to the ask→command table, matching asks like "what's my agenda",
    "what should I buy/sell and when", "when's the next window", "schedule" → `node
    pipeline/commands/read-schedule.mjs [-c|-w] [--audit]` (default `-c`), following the existing
    row format exactly (backtick-quoted trigger phrases, one exact command).
  - Per rule 8, grep CLAUDE.md/README/docs for any stale "no consolidated agenda exists" framing to
    correct in the same pass — **checked during this hardening pass: none currently exists**, but
    re-confirm at execution time since the plan may drift before it lands.
  - **Version lane:** pipeline-only change — `read-schedule.mjs` and the `run-loop.mjs` edit ship
    with **NO `APP_VERSION` bump** (js/state.js is untouched by this whole plan). The new
    `.claude/skills/schedule/SKILL.md` gets its own `version:` frontmatter field (start at `1.0.0`),
    per rule 5's "skills-only changes bump the SKILL.md version instead" rule.
- **Acceptance checks:**
  1. `/schedule` (or however the skill is invoked) actually runs `read-schedule.mjs` and interprets
     its table into a short spoken summary, per the pattern the other skills (`/scan`, `/positions`)
     already follow.
  2. `git diff` for this chunk touches no file under `js/`, confirming the no-`APP_VERSION`-bump
     rule is honored by construction, not just by intent.
  3. README/CLAUDE.md grep-for-staleness pass documented as done (even if it found nothing to fix)
     in the commit message, per rule 8.

## Risks / where this is NOT as straightforward as the one-table framing suggests

1. **`In (h)` is genuinely fiddly, even though it's "just" modular arithmetic.** Midnight-wrap +
   inside-window + rounding is exactly the kind of logic that reads simple and ships an off-by-one
   — it deserves its own small fixture file (Chunk 1's acceptance criteria call for this explicitly)
   rather than being trusted inline and eyeballed. Budget real review time here, not "it's just
   math."
2. **The fetch-cost mitigation leans on an EXISTING cache behaving as documented — worth a smoke
   check, not just a read of the constant.** The 15-minute TTL and `cachedJget` code path are real
   and re-verified by reading `pipeline/lib/marketfetch.mjs` in this pass, but this plan has not
   actually RUN a cold `-w` pass to confirm the "low single-digit seconds" estimate empirically.
   Chunk 1's acceptance explicitly includes one manual timed run (cold and warm) before calling the
   fetch-cost question fully closed.
3. **The loop one-liner's "cheap" claim depends on a fragile chain of reasoning** (disk-cache
   warmth from `watch-positions.mjs`'s same-tick fetch, not in-process shared state). If a future
   change ever makes `watch-positions.mjs` skip its per-item `hourProfile` call for held items
   (e.g. a fast-path optimization), the loop header would silently start paying full fetch cost
   again with no assertion catching it — mitigated by the required code comment at the wiring point
   (Chunk 2), but that comment is a documentation mitigation, not a hard guard; a future change could
   still miss it.
4. **Dropping prospects removes the plan's only genuinely-new surface, which is a feature of this
   revision, not a residual risk** — noted here only for completeness: if a future session wants a
   "tracking but not yet committed" list again, it should be scoped and designed fresh rather than
   resurrected from this plan's earlier draft (the removed shape mirrored `hold-thesis.json` minus
   gating fields; that reasoning is preserved in git history at the commit that dropped it, not
   repeated here).
5. **Three chunks is a reasonable size for the actual code volume now that prospects and its
   dedicated file/CLI are gone** — no further folding recommended; each chunk (agenda+audit core,
   loop wiring, skill+docs) is independently landable and reviewable at roughly the granularity
   `docs/PLANNING.md` calls for.
