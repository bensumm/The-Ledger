# PLAN-POSITIONS-WINDOW-READ — auto-surface the ask-side window-clear ("typical exit") read on big-ticket held lots

## Goal
Fold the ask-side "typical exit timing" read (the block `read-window-range.mjs "<item>" --ask <level>`
prints) into `quote-items.mjs --positions` automatically, for **big-ticket held lots only**, so a
positions review answers "will this list price clear soon, in which window?" WITHOUT a separate manual
`read-window-range.mjs` call. Reuse the computation — do not duplicate the math.

## What already exists (so I don't rebuild it)
- **All the atomic math is already pure + shared** in `js/windowread.mjs`: `windowStats`,
  `quantHigh`, `recentQuant`/`RECENT_NIGHTS`, `reachedDays`, `recencySplit`, `placement`. BOTH
  `read-window-range.mjs` and `quote-items.mjs` already import and call these primitives.
- **`read-window-range.mjs`** assembles the ASK-side block inline (lines ~205–254): the
  `ASK side — reached on ~50%: X · ~75%: Y · every day: Z · recent-3 ~50%: W` summary, the
  `--ask <level> → reached R/N · recent m/3 · placement pXX` line, and the `↳ 5m-grain` archive line
  (`fiveMinStats(id)` maps archive rows → `windowStats`). It writes `result.askSide` / `result.ask`
  for `--json`/`--out` (consumed by the `/positions` verification TRIO and `/scan`).
- **`quote-items.mjs --positions`** already, for EVERY held lot, fetches `inp.ts1h` (the PLAN-VOL24
  parity fetch, ~line 526) and computes `astHeld = windowStats(inp.ts1h,{wStart:0,wEnd:0,nights:14})`,
  then emits a `reachPlacement` note (`ask <optSell> reached R/Nd (recent m/N) · placement pXX …`).
  So the 1h series is ALREADY in hand for the held lot — **the window read needs ZERO new network fetch.**
- `loadSnapshot` exposes `snap.archive` (`seriesFor(itemId,'5m')`) — the same read-only 5m archive
  `read-window-range.mjs` opens — so the 5m-grain line is available in positions mode too, best-effort.
- **`BIG_TICKET_GP = 10_000_000`** already exists in `js/quotecore.js` (the whole-lot capital-at-risk
  threshold `momVerdict` uses; documented in the `/positions` skill §5 as "10m lot value"). Reuse it.

## The duplication the requirement targets
The ATOMIC math is already shared; the risk is duplicating the ASSEMBLY (which primitives, in what
order, + the 5m-grain handling). So I factor ONE assembly function and call it from BOTH scripts.

## Design

### 1. New shared lib function — `askExitRead` in `js/windowread.mjs` (the ONE assembly)
Pure, no fetch/fs/archive. Takes ALREADY-computed `windowStats` results (both callers already have
one), so there is no re-bucketing and no network:

```js
export function askExitRead(stats, { ask = null, stats5m = null, recentN = RECENT_NIGHTS, minFiveDays = FIVE_MIN_MIN_DAYS } = {})
```
- `stats`   — a `windowStats()` result over the 1h series (or null).
- `stats5m` — a `windowStats()` result over the 5m archive series (or null → no grain line).
- Returns `null` when `!stats || !stats.his.length` (no traded window-highs → nothing to read).
- Otherwise:
```js
{
  nDays,                                             // = stats.his.length
  askSide: { q50, q75, everyDay, recent50, medVol }, // typical-exit levels (quantHigh 0.5/0.75, his[0], recentQuant, medVolHi)
  ask: ask == null ? null : { level, reachedDays, nDays, placement, recency },   // recency = recencySplit(stats.days,'ask',ask)
  grain5m: (stats5m && stats5m.his.length >= minFiveDays && ask != null)
    ? { reachedDays: reachedDays(stats5m.his, ask), nDays: stats5m.his.length, placement: placement(stats5m.his, ask) }
    : null,
}
```
`FIVE_MIN_MIN_DAYS` (3) is currently a local const in `read-window-range.mjs`; move it into
`js/windowread.mjs` as an exported const so the min-days gate has one home (read-window-range imports it).

### 2. `read-window-range.mjs` calls `askExitRead` (de-dup, value-preserving)
Replace the inline `quantHigh/recentQuant/reachedDays/placement` calls in the ASK-side render block +
the `result.askSide`/`result.ask` assignments with reads from `askExitRead(stats,{ask:ASK,stats5m:fiveStats})`.
Keep the exact stdout wording and the exact `result.askSide`/`result.ask` field set (byte-identical —
pinned by a new unit test that asserts the function's fields equal the old inline primitives). `splitNote`
(the recency message) stays as-is (it independently calls the `recencySplit` primitive — a message, not
the assembly). `FIVE_MIN_MIN_DAYS` is imported from windowread instead of declared locally.

### 3. `quote-items.mjs --positions` calls `askExitRead` for big-ticket held lots
In the positions loop, after `astHeld` is computed:
- `const bigTicket = cost >= BIG_TICKET_GP || watchlistIds.has(itemId);`
- Only when `bigTicket`: compute the window-exit read and emit a NEW `windowExit` note; **suppress the
  existing `reachPlacement` note for that lot** (the windowExit note is a superset — it also carries the
  placement/reach line — so emitting both would be redundant). Non-big-ticket lots keep `reachPlacement`
  unchanged.
- List price scored = `declaredExit ?? row.optSell` (the intended list-at; matches the forecast
  SELL-timing target already used in `runItems`).
- 5m grain: best-effort `snap && snap.archive.seriesFor(itemId,'5m')` → map rows → `windowStats(...,{wStart:0,wEnd:0})`
  → pass as `stats5m`; any throw / null snap → no grain line (never fatal).
- Window basis: FULL-DAY (`wStart:0,wEnd:0`) — this is the `/positions` skill's own big-ticket
  "trajectory read" doctrine (§3: "Use the FULL-DAY window, not the narrow demand slice"), and reuses
  the `astHeld` already computed. "Which window it prints in" is answered by appending the diurnal PEAK
  window label from a zero-fetch `hourProfile(inp.ts1h)`→`deriveDiurnalRange` (reuses the in-hand series).

**Note shape (ONE line, compact-output rule), stdout + JSON:**
```
<name>: window-clear — list <level> reached R/14d (recent m/3) · placement pXX of the 14-day daily-HIGH distribution · typical exit ~50% <q50> / ~75% <q75> / every-day <everyDay> · live instabuy <quickSell> · 5m-grain reached r/n pXX · peak window HH–HH  (touched ≠ filled, ~14d — a guide)
```
Clauses drop out cleanly: no 5m grain → omit that clause; no peak window → omit. The note item is
`{ kind:'windowExit', itemId, text, data:<the askExitRead result + list/live/peakWindow> }`. `render.mjs`
`formatNote` only reads `kind`/`text`, so `data` rides into the JSON dump for the skill without affecting
stdout. Register `windowExit` in `render.mjs` `NOTE_KINDS` (prefix `  ↗ `, tier `context`).

**Graceful degradation (requirement 4):** the whole windowExit block is wrapped in `try/catch`; on any
throw OR when `astHeld` is null (the `inp.ts1h` fetch failed → `windowStats` null), emit a single
`{ kind:'windowExit', text:'<name>: window read unavailable — no 1h series this pass' }` note and continue.
The table/verdict output is never affected — it is the critical output; the window read is enrichment.

### 4. Threshold constant + justification
Reuse `BIG_TICKET_GP = 10_000_000` (js/quotecore.js) — already the whole-lot ("qty×avgCost") capital-at-risk
threshold `momVerdict` uses and the `/positions` skill documents. A ≥10m lot is exactly where a stranded
premium / "which window does it clear" question costs real gp and is worth the extra note; below it the
read is noise. **Watchlist force-include** (`watchlistIds.has(itemId)`) mirrors the incidental-filter
exemption already in this file (a deliberately-tracked item is never filtered by value alone) — so a
watchlisted lot gets the read regardless of size. No NEW constant is introduced (avoids a second
big-ticket bar drifting from the canonical one).

### 5. Versioning
PIPELINE-ONLY change: `js/windowread.mjs` (a new pure export — imported by pipeline scripts and the app,
but NO app-loaded behavior changes; the app never calls `askExitRead`), `quote-items.mjs`,
`read-window-range.mjs`, `render.mjs`. **No `APP_VERSION` bump** (no change to app-rendered behavior; the
existing app imports of windowread are untouched). The `/positions` skill bumps its own `version:`
(1.40 → 1.41). Commit message notes the no-bump rationale (repo rule 5).

## Docs (reconciliation pass — rule 8)
- `README.md` "Map of the repo": note `askExitRead` as the shared ask-side typical-exit assembly in
  `js/windowread.mjs` (new export on an existing file — update its inventory entry, no new file).
- `.claude/skills/positions/SKILL.md`: the conditional "cross-check … `read-window-range.mjs --ask/--bid`
  … WHEN it adds something the notes block didn't already cover" language (notes display contract) becomes
  "the ask-side window-clear read is now AUTO-SURFACED for big-ticket held lots as the `windowExit` note —
  read it there; a manual `read-window-range.mjs --ask` is only needed for non-big-ticket lots or a
  different window/level." Bump `version:` 1.40 → 1.41.
- `docs/MARKET-ANALYSIS.md`: if it names the manual `read-window-range --ask` as the sell-leg verification
  home, add that big-ticket held lots now carry it inline. (Grep first; edit only what the change supersedes.)
- Header comment above the new note-emit block in `quote-items.mjs` and above `askExitRead` in
  `js/windowread.mjs` (the invariant lives with the code it governs).

## Tests
- New unit test `pipeline/test/askexitread.test.mjs`: pins `askExitRead` field-by-field against the
  raw primitives on synthetic 1h + 5m stats (byte-parity proof for the read-window-range refactor);
  asserts `null` on empty/thin stats, `grain5m:null` below `FIVE_MIN_MIN_DAYS`, `ask:null` when no ask.
- Register `windowExit` in `NOTE_KINDS`; the render.test golden hand-lists note kinds, so the new kind
  is additive and does not break it (optionally add a `windowExit` pair mirroring the `windowClear` pair).
- `node --check` every touched `.mjs`; run `node pipeline/ci/run-tests.mjs`,
  `node pipeline/ci/lint-docs.mjs`, `node pipeline/ci/lint-skills.mjs`, `node pipeline/ci/check-imports.mjs`.
- End-to-end: `node pipeline/commands/quote-items.mjs --positions --verbose` against the current book;
  confirm the `windowExit` note appears on the big-ticket lots (Ancient godsword ×2, Masori mask ×2) and
  that a forced `inp.ts1h=null` (simulated fetch failure) degrades to "window read unavailable" rather
  than crashing.

## Validation checklist (phase 2)
- (a) Reuse, not duplicate: `askExitRead` is the ONE assembly; both scripts call it; atomic math stays
  in the existing primitives. Verify the read-window-range refactor keeps `result.askSide/.ask`
  byte-identical via the new unit test + a before/after live diff if network permits.
- (b) Threshold sensible + watchlist handled: reuse `BIG_TICKET_GP`; watchlist force-includes.
- (c) Fetch failure non-crashing: try/catch + null-`astHeld` degrade note; positions table never blocked.
- (d) JSON backward-compatible: adds a new typed `notes` item (`kind:'windowExit'`) with an extra `data`
  field render.mjs ignores; no existing section shape changes; the skill reads `notes` generically.
- (e) Per-lot fetch cost: ZERO new fetch — `inp.ts1h` already fetched for every held lot; the read is
  gated to big-ticket lots only for OUTPUT-noise reasons, not fetch cost; 5m is a local archive read.
