# PLAN-WINDOW-CLEAR-OUTCOMES — a forward outcome log for window-clear ask ladders (which reach signal predicts a fill?)

Status: **DRAFT — not yet scheduled. A prototype implementation (WC2 — `join-window-clears.mjs` +
`pipeline/lib/campaigns.mjs` + `joinwindowclears.test.mjs`, the fill-attribution join + shared campaign
primitive) is PRESERVED on the salvage worktree `agent-a9590cfca9710921f` (branch tip `babaa36`).**
Deferred at owner call during the 2026-07-25 salvage sweep: this is data-accrual with no urgency
(no constant tuned, INFORM-ONLY), so it waits for a scheduled slot rather than landing opportunistically.
Do NOT delete that worktree or this file until WC2 lands or is formally dropped.
Per-topic working doc (PLANNING.md lifecycle step 1–2);
folds into `PLAN.md` and is deleted when its last chunk ships. Executor rules = PLAN.md
"Executor rules", verbatim. This plan builds a DATA-ACCRUAL mechanism feeding F1 — it is NOT a
calibration and it tunes NO constant (honesty core below).

## Problem / motivation (the floor-night anchor)

We run "window-clear ladder" sells: to exit a big-ticket held lot, we place resting asks priced
to catch a DIURNAL PEAK window (a Masori mask laddered into its ~02:00–03:00 local peak). The rung
levels are chosen off the ask-side window read now auto-surfaced on `quote-items.mjs --positions`
(the `↗ windowExit` note, PLAN-POSITIONS-WINDOW-READ) / `watch-positions.mjs`. That read reports
**two competing reachability signals** for a given ask level:

- **daily-HIGH reach** — `reachedDays(his, ask)/N` off the 1h `avgHighPrice` window maxima
  (`aer.ask.reachedDays/nDays` + recency + `placement`). Smoothed; counts a brief intraday spike
  the same as a sustained day. Reads OPTIMISTIC (touched ≠ filled).
- **5m-grain reach** — the less-smoothed archive read (`aer.grain5m.reachedDays/nDays`,
  `placement`). Sustained reachability; more honest, but only where the Tier-1 archive has
  ≥ `FIVE_MIN_MIN_DAYS` covered window-days.

**The incident (2026-07-20).** A mask ladder priced off the daily-high tail printed ZERO fills —
the peak window came in ~0.7m below the recent-3 median (a "floor night"). We could not analyze it
afterward because **the surfaced ask levels and their fill/no-fill outcomes are never persisted.**
The `↗ windowExit` note is rendered to the human and thrown away; the rungs themselves are Ben's
manual GE offers, made off the read but not FROM the log. So today there is no dataset that could
ever answer the question the two signals pose: **for a resting ask into a peak window, is
daily-high reach or 5m-grain reach the better fill predictor?**

An hour-by-hour cross-check the same session sharpened the motivation: the labeled "peak window"
(01:00–03:00) is NOT where the mask's highest prices print — the elevated hours were the waking
UK-day/evening (10:00, 18:00–19:00). We have been laddering into a *convenient* window (Ben asleep,
UK awake), not the *price-high* window — and we have no logged evidence to confirm or refute which
window actually fills a resting ask. This plan starts accruing that evidence.

This plan adds the cheapest possible forward-data mechanism to start answering that — a lean shadow
record each time a window-clear ask level is SURFACED, later joined against `fills.json` to mark
whether that level actually filled within its window. It accrues the diurnal-peak-reliability
dataset F1 (PLAN.md, GATED) can use to decide which signal to trust. It moves no price, no verdict,
no constant.

## What was verified (evidence, not theory — read directly 2026-07-20)

- **The surface already computes everything the record needs; it just discards it.** The big-ticket
  `windowExit` note in `pipeline/commands/quote-items.mjs` (~L655–693) builds, off ONE shared
  `askExitRead(astHeld, { ask, stats5m })` (`js/windowread.mjs`) + `deriveDiurnalRange`, exactly:
  the list level, the daily-HIGH reach `{reachedDays, nDays, recency, placement}`, the 5m-grain
  reach `{reachedDays, nDays, placement}`, the peak window `[startH, endH]`, and the live instabuy
  (`row.quickSell`). It already stashes them on `note.data = { list, live, peakWindow, ...aer }` —
  but nothing shadow-logs `note.data`. The gap is one lean field, not a subsystem.
- **The lean-field pattern is the established forward-data idiom (YS2).** `pipeline/lib/suggestlog.mjs`
  `suggestionEntry(row, {...})` already threads ~20 lean-included fields (`winClear`, `reachable`,
  `depthExit`, `asym`, `amplitude`, …), each written ONLY when supplied, so a row without the new
  context stays byte-identical. There are dedicated reshapers (`reachableShadow`,
  `depthExitShadow`, `amplitudeShadow`, `asymShadow`) that take a raw `js/windowread` result and
  return the lean object — the exact home for a `windowExitShadow`.
- **A narrower `winClear` field already exists but does NOT answer this question.** The
  `quote-items.mjs --positions` row already logs `winClear` (the `windowClear` lap-vs-days read:
  `{windowReach, reachedDays, nDays, pool, clearRatio, wStart, wEnd, diverges}`, keyed on
  `row.optSell`). It carries neither the daily-HIGH-vs-5m-grain PAIR, nor the level's placement,
  nor the surfaced list level when that differs from `optSell` (a declared `thesisEntry.exitPrice`
  overrides it). So `winClear` is not a substitute — the new field records the two competing reach
  signals side-by-side for the ACTUAL surfaced rung.
- **The join engine already reconstructs sell campaigns with everything the attribution needs.**
  `pipeline/commands/join-outcomes.mjs` `build()` produces, per sell campaign: `placementTs`,
  `placementPrice`, `timeToFirstFill`, `terminalState`, `everFilled`, `filledFraction`, and
  `stateAtFill.regime` — all off the shared `collapseOffers`/`matchTrades`/`stampFirstFill`
  reconstruction (never re-implemented). It joins the nearest PRIOR suggestion within
  `SUGGEST_WINDOW`; the window-clear join is the FORWARD mirror (nearest sell placement AFTER a
  surface). A suggestion-keyed forward join already has precedent (`join-amplitude-outcomes.mjs`).
- **The critical asymmetry (verified against the workflow).** Ben places every GE offer MANUALLY;
  the app cannot detect a placement. So a surface is NOT a placement, and the absence of a fill is
  ambiguous — it could mean "the ask didn't reach" (the data point we want) OR "Ben never placed
  the ladder that night" (no data point at all). Conflating those two would manufacture false
  "floor nights." The join MUST distinguish them (three-state classifier below), or the dataset is
  worse than useless.

## The honesty core (process rule 4 — read before any chunk)

1. **This is data accrual, not calibration. n≈0 at first; weeks to accrue.** The record starts
   empty and grows one row per big-ticket window-clear surface (a handful per night at most). No
   chunk here concludes anything; the payoff is a queryable dataset. F1/Ben own any decision about
   which reach signal to trust — this plan never tunes a constant, never moves a price/verdict/grade.
2. **No fabricated negatives.** A surfaced level with no matching placement is `UNPLACED`, NOT a
   "no-fill" — it is EXCLUDED from any fill-rate. Only a surfaced level that Ben actually placed
   (price-and-time-matched to a real sell campaign) and that then did/didn't fill is evidence. This
   is the whole reason the floor-night incident is analyzable and a lazy night is not.
3. **Fill attribution is a claim about OUR order, bounded by price + time + window.** We never count
   an unrelated lower dump as "the ask filled." A fill counts for a surfaced rung only when a sell
   campaign was placed AT OR NEAR the surfaced level, within a forward horizon, and its first fill
   lands inside the named peak window. Every guard is a named placeholder with its n beside it.
4. **Both reach signals are logged; NEITHER is endorsed.** The record stores daily-HIGH reach AND
   5m-grain reach as-computed, plus the placement of each. The "which predicts better" comparison
   (WC3) is DESCRIPTIVE and refuses to summarize below a per-cell floor, exactly like
   `join-outcomes.mjs --report`.
5. **5m-grain coverage is opportunistic and a LOWER BOUND.** The archive covers a liquid item over
   a broad window but often nothing on a narrow/off-peak one; a 5m value is itself a 5-minute
   average, not a tick. Where 5m is absent the record says so (null), never faking a read — and the
   comparison must segment on 5m-present vs 1h-only so the missing-not-at-random coverage can't be
   read as signal.

## The record schema (a lean `windowExit` shadow field on the positions/watch suggestion row)

Written via a new `windowExitShadow(aer, { list, live, peakWindow })` reshaper in
`pipeline/lib/suggestlog.mjs` (beside the existing reshapers), lean-included on the
`quote-items.mjs --positions` and `watch-positions.mjs` held-lot rows exactly like the sibling
shadows (absent → byte-identical row). Shape (ids/prices/fractions/timestamps only — NO PII; the
ledger is public + tracked):

    windowExit?: {
      list,                    // the surfaced ask/list level (thesisEntry.exitPrice ?? optSell)
      live,                    // live instabuy at surface (row.quickSell) — the "vs list" anchor
      peakWindow: [startH,endH],   // local wall-clock hours the rung is priced to catch
      hiReach: {               // the daily-HIGH (1h avgHigh) reach signal for `list`
        reached, n, recentHit, recentDays, placement
      },
      fiveReach: {             // the 5m-grain (archive, less-smoothed) reach signal, or null
        reached, n, placement
      } | null
    }

The row's existing `ts` (unix seconds at emit) is the surface timestamp; `itemId`, `class`,
`regime` already ride the row. `list` may equal `optSell` or a declared `exitPrice` — store what was
surfaced. `fiveReach:null` when the archive lacks ≥ `FIVE_MIN_MIN_DAYS` coverage (honesty item 5).
Lean discipline (SR1): the field is written only for a big-ticket held lot whose window read fired,
so the vast majority of suggestion rows are unchanged.

## The fill-attribution join (three-state, false-positive-guarded)

A read-only join over `readSuggestionLines()` (active ledger + all monthly archives — never the
active file alone, per SR1) ⇆ the sell campaigns `join-outcomes.mjs` already reconstructs. For each
`windowExit` shadow record R = { itemId, ts (surfaceTs), list, peakWindow, hiReach, fiveReach }:

1. **Candidate placements** = sell campaigns C for `R.itemId` with
   `surfaceTs ≤ C.placementTs ≤ surfaceTs + PLACE_HORIZON_SEC` (the rung is placed shortly AFTER
   the read that motivated it — the forward mirror of `SUGGEST_WINDOW`). If a NEWER `windowExit`
   record for the same item precedes C.placementTs, C attributes to the newer record (nearest-prior
   surface, mirroring `joinSuggestion`) — no double counting.
2. **Price match** = `abs(C.placementPrice − R.list) / R.list ≤ PRICE_TOL` — the placed rung was the
   surfaced level, not a lower dump. A campaign that fails price match is NOT this rung.
3. **Outcome classification** (per matched campaign; a record with no matched campaign = `UNPLACED`):
   - `PLACED_FILLED_IN_WINDOW` — `C.everFilled` AND the local hour of `C.timeToFirstFill`'s absolute
     ts ∈ `R.peakWindow` (midnight-crossing handled). The ladder caught its window.
   - `PLACED_FILLED_OUT_OF_WINDOW` — `C.everFilled` but first fill outside the peak window (filled,
     but not in the window it was priced for — a different, weaker signal).
   - `PLACED_NO_FILL` — matched campaign, `!everFilled` (terminal cancel/expire). The floor-night
     negative — the row this whole plan exists to make analyzable.
4. **Record, don't conclude.** Emit per record: `{ itemId, surfaceTs, list, peakWindow, hiReach,
   fiveReach, outcome, matchedCampaign? (placementTs/price/ttf/terminalState/regime) }`. `UNPLACED`
   rows are reported as a COUNT and excluded from every fill-rate (honesty item 2).

`PLACE_HORIZON_SEC` (propose 24h — a rung is placed the same session it's surfaced) and `PRICE_TOL`
(propose 0.5% — the tick-noise band on a big-ticket level) are NAMED PLACEHOLDERS, n≈0, stated in
the output. No constant here feeds a live price/gate. (Decisions D1–D3 below.)

## Chunks (each carries its own reconciling docs pass + README inventory in the same commit)

### WC1 — log the `windowExit` shadow field (the forward record) — *independently shippable*
`windowExitShadow(aer, { list, live, peakWindow })` in `pipeline/lib/suggestlog.mjs` (beside the
existing reshapers) + the `if (windowExit != null) e.windowExit = windowExit;` lean block in
`suggestionEntry` + the schema doc-comment. Wire it at the two surfaces that already compute the
read: `quote-items.mjs --positions` (pass the shadow into the existing `suggestionEntry(... winClear,
... )` call ~L422, sourced from the `windowExit` note's `data`) and the `watch-positions.mjs`
held-lot list-into-peak surface. **Acceptance:** a `--positions` run on a big-ticket held lot writes
one `windowExit` row carrying both reach signals + the peak window + list/live; a non-big-ticket row
and every other script log a byte-identical shape (pinned like `winClear` in `suggestlog.test.mjs`).
Changes NO stdout, no price, no verdict; console-only → no `APP_VERSION`. Honesty: `fiveReach:null`
when the archive is thin — never faked.

### WC2 — the fill-attribution join + three-state classifier — *independently shippable*
A read-only join that reads the `windowExit` shadow rows and classifies each `UNPLACED /
PLACED_NO_FILL / PLACED_FILLED_IN_WINDOW / PLACED_FILLED_OUT_OF_WINDOW` against the reconstructed
sell campaigns, with the price + forward-horizon + peak-window guards above. Reuses
`collapseOffers`/`matchTrades` (never re-implemented) or the already-built campaigns array
(see decision D1). Prints per-record rows + counts; `--json` for the brief. **Acceptance:** on the
current ledger it runs, reports the `UNPLACED` count separately, and attributes zero false fills
(a fixture with an unrelated lower dump for the same item classifies `UNPLACED`, not filled). n is
printed on every aggregate; refuses to summarize a rate below the floor. No file write beyond an
optional gitignored `--out`. README inventory entry at creation.

### WC3 — the reach-signal comparison rollup (DESCRIPTIVE, n-gated) — *gated on accrual*
A rollup over WC2's classified rows: for placed rungs, cross-tabulate outcome against which signal
was more optimistic (daily-HIGH placement vs 5m-grain placement) and against each signal's
reached-fraction, SEGMENTED by 5m-present vs 1h-only (honesty item 5) and by regime. **Acceptance:**
it refuses per-cell summaries below `MIN_N` (reuse `join-outcomes.mjs`'s floors — never re-hardcode),
prints the F1-style "let it accrue" line while n is small, and states plainly that the output is
evidence for F1/Ben, not a calibration. Ships the moment WC2 lands (empty-but-honest); becomes
informative only after weeks. Tunes nothing.

## Docs / registry pass (rule 8, per chunk)

- **`docs/MARKET-ANALYSIS.md` §4 (WINDOW-CLEAR) + the reach doctrine (the `↗ windowExit`
  paragraph):** add that the surfaced rung + both reach signals are now shadow-logged for F1, and
  grep the reach paragraphs for any "we can't measure whether the ask filled" phrasing to reconcile
  in place (WC1/WC2).
- **`README.md` inventory:** extend the `suggestions.jsonl` entry with the `windowExit` field;
  add the WC2 join command to the join-command list (beside `join-outcomes.mjs` /
  `join-amplitude-outcomes.mjs`) at creation, naming producer (the two positions/watch surfaces) +
  consumer (F1 accrual).
- **`pipeline/lib/suggestlog.mjs` header schema block:** the `windowExit?` line, same style as
  `winClear?`/`reachable?` (WC1).
- **CLAUDE.md:** untouched unless WC2 becomes a bare-ask workflow surface (it is an analysis command,
  like `join-outcomes.mjs` — no ask→command mapping needed); revisit only if that changes.
- **PLAN.md:** fold this file's chunks into the Status table when scheduled; delete this file when
  WC3 ships (fold-out discipline).

## Files/functions a builder extends (verified paths, 2026-07-20)

- **`pipeline/lib/suggestlog.mjs`** — add `windowExitShadow(aer, {...})` beside `reachableShadow`/
  `depthExitShadow`/`amplitudeShadow`/`asymShadow`; add `windowExit` to the `suggestionEntry`
  options bag + a lean `if (windowExit != null) e.windowExit = windowExit;` block (near the
  `winClear` block); extend the header schema doc (beside the `winClear?` entry).
- **`pipeline/commands/quote-items.mjs`** — the `↗ windowExit` note block (~L655–693) already builds
  `note.data = { list, live, peakWindow, ...aer }` off `askExitRead`; pass a `windowExit:` shadow
  into the existing `suggestionEntry(... winClear, ...)` call (~L422). Uses `askExitRead`,
  `hourProfile`, `deriveDiurnalRange` already imported.
- **`pipeline/commands/watch-positions.mjs`** — the sibling held-lot list-into-peak surface (imports
  `deriveDiurnalRange`/`hourProfile`/`clearableAsk`; held-lot clause ~L744/791). Add the same shadow
  so watch-run rungs are captured too.
- **`pipeline/commands/join-outcomes.mjs`** — the reconstruction + campaign build
  (`collapseOffers`/`matchTrades`/`stampFirstFill`, `groupCampaigns`, `joinSuggestion` nearest-prior
  idiom, `readSuggestionLines`, the `MIN_N`/`MIN_N_F1` floors) is what WC2/WC3 reuse or mirror
  (forward-join variant).
- **`js/windowread.mjs`** — `askExitRead`, `placement`, `deriveDiurnalRange`, `FIVE_MIN_MIN_DAYS`
  (the read primitives) are already the source of every field; no change expected. A tiny pure
  peak-window-membership helper (hour ∈ `[startH,endH]`, midnight-crossing) can live in the WC2
  command.

## Open questions / decisions for Ben (list only — don't action unprompted)

- **D1 — new sibling command vs a `--window-clears` section on `join-outcomes.mjs`.** The section
  reuses the already-built `campaigns` array (zero new reconstruct) but grows a large file; a sibling
  `join-window-clears.mjs` is cleaner + independently testable but re-reads the reconstruction.
  Recommend the sibling for isolation (WC2 is fixture-pinned on attribution logic that
  `join-outcomes` shouldn't carry). Ben's call.
- **D2 — placeholder values `PLACE_HORIZON_SEC` (24h) and `PRICE_TOL` (0.5%).** Both are n≈0
  guesses; flag for veto. They only affect attribution strictness in the read-only join, never a
  live price.
- **D3 — log manual `read-window-range.mjs --ask/--exit` reads too?** Those are agent-driven
  INSPECTION, not a placement intent — logging them would pollute the set with hypothetical levels
  Ben never placed. Recommend NO (auto positions/watch surfaces only). Confirm.

## Minimum shippable

WC1 alone is the whole forward-data mechanism (it starts the clock and stops losing floor-night
data); WC2 makes it queryable; WC3 is the payoff and is honestly empty for weeks.
