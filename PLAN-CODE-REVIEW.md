# PLAN-CODE-REVIEW — fixes from the 2026-07-16 script-by-script review

Status: **DRAFT — not yet executed.** Per-topic working doc (PLANNING.md lifecycle); folds into
PLAN.md and is deleted when its last chunk ships.

## Context / diagnosis

Two real bugs were found and fixed by hand earlier in this session (the `heldIds` module-scoping
bug in `screen-flip-niches.mjs`, and the multi-wipe gap in `offers.mjs`'s `restartBlindSuspects`).
Both share a shape — code that's syntactically valid and passes `node --check`/CI but is wrong in a
way only a live run or a repeated edge case reveals — so a Fable background agent was asked to
review the rest of the codebase (`pipeline/lib/`, `pipeline/commands/`, `js/`) hunting for the same
class, plus general correctness/refactor issues. It read every file, ran the full offline fixture
suite (60+ files, all pass) and an ESLint sweep (zero `no-undef`/`no-dupe-keys`/`no-unreachable`
errors — confirms no more scoping bugs of the exact `heldIds` shape are statically detectable), then
did a semantic read for the rest. Full report is in this session's transcript; distilled into
chunks below. **Verify every finding against current code (file:line) before executing** — the
review is a lead, not a verified patch.

## Rulings

- Ben, 2026-07-16: fix the findings via a drafted plan + an Opus subagent implementing it, reporting
  back to the coordinating Sonnet session for validation before landing.
- Chunk order follows the review's own suggested priority: the reuse gap that extends today's
  live fix first, then the deterministic future-crash bug, then the reconstruction correctness bug,
  then the already-staged parity fix, then the minor/refactor batch.

## Existing scaffolding

- `pipeline/lib/offers.mjs` `restartBlindSuspects()` + `activeOffers()` (LH2.4, same session) — the
  detector chunk 1/2 build on.
- `pipeline/lib/reconstruct.mjs` `collapseOffers`/`buildEvents` — the FIFO reconstruction chunk 3 touches.
- `pipeline/lib/watchstate.mjs` `computeDeltas`/`advanceState` — the duplicated-streak-logic chunk 6 touches.
- `pipeline/lib/derive-cash-tiers.mjs` — the escrow calc chunk 2 touches, and the layering fix chunk 6 touches.
- Working-tree (uncommitted) fix already staged: `quote-items.mjs`'s positions-mode `vol24` correction
  (the "PLAN-VOL24 parity fix" from earlier this session) — chunk 4 is "ship it", not "build it."

## Target architecture / staged chunks

### Chunk 1 — stack-overflow time bomb (HIGH priority, deterministic future crash)
`pipeline/lib/offers.mjs:47` `Math.max(...validEps)` and `pipeline/commands/read-buy-limits.mjs:71`
spread an array that grows with the exchange-logger's entire log history (all rotated files, forever
— `readOfferRows` never bounds it). V8's spread-argument limit (~65k) will be crossed by ordinary
log growth within months, crashing every log-reading surface (monitor-offers, watch-positions,
sync-fills local rebuild, watch-log daemon) simultaneously.
- **Fix:** replace both spreads with a `reduce` (or a manual loop) — no behavior change, same max
  value, no argument-count limit.
- **Related, same root (fold in if cheap, else a follow-up note):** `readOfferRows` re-reads and
  re-parses the *entire* log history every tick; a date-based file cutoff (e.g. skip files whose
  mtime is older than N days) would fix both the unbounded growth AND the per-tick cost. Do NOT
  silently drop old fills the reconstruction still needs — check `positions.json`'s open-lot ages
  before choosing a cutoff window; if any consumer needs older history, scope this note out and
  leave it for a dedicated follow-up rather than risking a silent data loss.
- **Verification:** a fixture with >65k synthetic log lines exercising `readExchangeLog()` without
  throwing (a fast, small unit test, not a real 65k-line file fixture). Existing `offers.test.mjs`
  suite stays green.

### Chunk 2 — restart-blindness reuse gap (HIGH priority, extends today's live fix)
`offersSnapshot()` (`pipeline/lib/offers.mjs:68`, feeds `offers.json`) only reads `activeOffers()` —
a restart-blind slot silently vanishes from the snapshot, re-introducing the exact false-negative
LH2.4 fixed, in every consumer of `offers.json`:
- `quote-items.mjs --positions` (`askFromSnapshot`/`bidFromSnapshot`) loses `askFilling` for a
  blind ask.
- `derive-cash-tiers.mjs`'s `restingBuyEscrow` — a blind resting BID's escrow vanishes, so
  `deployablePool` OVERSTATES available cash by the bid's remaining value. That inflated pool feeds
  `run-loop.mjs`'s scan gate and the value niche's `--capital` default — the tool could recommend
  deploying gp that's actually locked in a live in-game bid.
- The app's Watch tab (published nightly).
- **Fix:** `offersSnapshot()` gains a `suspects: []` field (from `restartBlindSuspects`, same
  never-merge-into-`offers` doctrine LH2.4 already established) alongside the existing `offers`
  array. Callers that need to distinguish "confirmed live" from "possibly still resting" opt into
  reading `suspects` explicitly (never silently merged — this is the same discipline the live-log
  readers already follow). `derive-cash-tiers.mjs`'s escrow calc should treat a suspect resting bid
  the same as a confirmed one for the purpose of NOT counting its gp as deployable (the safe
  direction — false-negative escrow is a real-money risk; false-positive "still committed" is not).
- **Verification:** extend `offers.test.mjs` with a restart-blind fixture asserting `suspects`
  populates and `offers` doesn't double-count it; a `derive-cash-tiers.test.mjs` case showing a
  blind bid's escrow is still excluded from `deployablePool`.

### Chunk 3 — collapseOffers offer-merge bug (MEDIUM-HIGH priority, data correctness)
`pipeline/lib/reconstruct.mjs:242-256` `collapseOffers` closes an in-progress offer only on a
terminal row or a different item/type — missing the case where a terminal line is LOST (a restart
blind spot) and Ben relists the SAME item on the SAME slot at a new price. The two distinct offers
merge into one: price gets overwritten, `filled`/`spent` become `max()` of two unrelated cumulative
counters → wrong per-unit cost and phantom fill counts in `positions.json`, propagating into
`limits.mjs`'s buy-window tracking.
- **Fix:** treat a `state:'placed'` row (`filled===0`) arriving while the open offer's `filled > 0`
  as an unambiguous NEW offer (a real offer's cumulative fill never decreases) and close the prior
  one there — before applying the current merge logic. A snapshot re-emission of an unfilled
  resting offer (`filled 0` → `filled 0`) is unaffected; this only fires when the log's own
  monotonic-fill invariant would otherwise be violated by treating it as one continuous offer.
  **Read `pipeline/FILLS-PIPELINE.md` §5.1 before touching this** (per CLAUDE.md's standing rule) —
  confirm this isn't already an accepted, documented tradeoff before changing the logic.
- **Verification:** a `reconstruct.test.mjs` fixture: SELLING (filled:3) → [missing terminal] →
  SELLING (filled:0, new price) on the same slot/item → asserts TWO closed offers at the right
  prices/fills, not one merged phantom. Existing collapseOffers fixtures stay byte-identical.

### Chunk 4 — ship the already-staged vol24 parity fix (LOW effort, already done)
Confirm the working-tree `quote-items.mjs` positions-mode `vol24` correction (feeding the SAME
`vol24FromInputs` correction the single-item path already uses) is intact and ship it — no new
work, just don't lose it in the shuffle.

### Chunk 5 — minor bugs / sharp edges (bundle, LOW-MEDIUM priority each)
- `pipeline/commands/declare-thesis.mjs:127` — add the `process.argv[1] &&` null-guard the other
  three entrypoints (`sync-fills.mjs`, `screen-flip-niches.mjs`, `trigger-alerts.mjs`) already have
  before `pathToFileURL(process.argv[1])`, for consistency and to stop a crash on import from a
  context with no `argv[1]`.
- `pipeline/lib/marketfetch.mjs:694-700` — `loadSnapshot().series(id)` memoizes the resolved value,
  not the in-flight promise; cache the promise so two concurrent `series(id)` calls for the same id
  don't double-fetch. Latent (current callers are sequential) — low urgency, cheap fix.
- `watch-positions.mjs` / `offers.mjs` `askFromSnapshot`/`bidFromSnapshot` — first-match-only offer
  pairing misses a second same-side offer on the same item across slots (a split lot, a relist
  mid-partial). Decide a deterministic policy (e.g. sum quantities, prefer the lowest ask) rather
  than "whichever the array happens to return first."
- `reconstruct.mjs:141-149` `buildEvents` — `delete e.empty` mutates its input, contradicting the
  module's "no side effects" doc comment. Either stop mutating (clone first) or fix the doc —
  prefer not mutating, since a future caller reusing the parsed array would be silently broken.
- `reconstruct.mjs:315-319` `eventId` — omits `price`/`qty` from the hash; two same-second,
  same-slot, same-item/type/state/filled/spent events differing only in price would collide (a
  REMOVE tombstone targeting one would purge both). Add price+qty to the hash input.
- **Verification:** one fixture per fix in the relevant existing test file; no new files needed.

### Chunk 6 — refactor / cleanup (LOW priority, do last)
- `pipeline/lib/watchstate.mjs` — `computeDeltas` and `advanceState` duplicate the whole
  underwater/belowSupport/breakdown streak+reset block. Extract one `streaks(prior, cur, now)`
  helper both call, so the "the two never disagree" invariant the doc comment claims becomes
  structural instead of hoped-for. MUST stay byte-identical against the existing fixture suite.
- `pipeline/lib/derive-cash-tiers.mjs:63` — imports `REPO_DIR` from
  `pipeline/commands/sync-fills.mjs` (a lib importing a command inverts the layering, and executes
  sync-fills' module top-level as a side effect). Move `REPO_DIR` to a lib module (`offers.mjs` or a
  new tiny `paths.mjs`); have `sync-fills.mjs` re-export it if anything still needs the old path.
- Dead imports (full list from the ESLint sweep — remove all, each a one-line diff): `watch-positions.mjs`
  `BIG_TICKET_GP`; `sync-fills.mjs` `fileURLToPath` + `LOCAL`; `screen-flip-niches.mjs` `valueScore`;
  `quote-items.mjs` `cost`; `join-outcomes.mjs` `fmtP`; `add-manual-fill.mjs` `HERE`;
  `js/validate.mjs` `termStructure`; `js/ui.js` `API`/`setHealth`/`netMargin`/`parseGp`/`fmtHour`/`pad2`;
  `js/trends.js` `Z_BAND`/`netMargin`; `js/charts-interactive.js` `fmt`; `js/ledger.js` `fmtP`.
- **Verification:** `node pipeline/ci/check-imports.mjs` (should already pass — dead imports still
  resolve, this is a cleanliness fix not a correctness one) + full test sweep unchanged.

## Encoding boundary

All chunks are pure code/fixture fixes — no judgment-layer prose changes.

## Bookkeeping & compatibility checklist

- No `APP_VERSION` bump unless a chunk touches `js/*.js` browser modules directly (chunk 6's
  `js/validate.mjs`/`js/ui.js`/`js/trends.js`/`js/ledger.js`/`js/charts-interactive.js` dead-import
  removals are the only browser-facing edits in this plan — confirm whether that alone warrants a
  bump per CLAUDE.md rule 5, or counts as a no-behavior-change cleanup; when in doubt, ask rather
  than guess).
- `pipeline/FILLS-PIPELINE.md` §5.1 gets a note if chunk 3's fix changes any documented
  reconstruction invariant.
- No new files beyond test fixtures; update README's file inventory only if a new lib file is
  created (chunk 6's optional `paths.mjs`).

## Honesty (process rule 4)

This plan is built entirely from a single Fable agent's read-only review — real findings, but
**verify each one against current code before touching it** (file:line evidence, not the review's
prose alone), since the review agent didn't have write access to confirm its own fixes compile/pass.
Chunk 1's real-world timeline ("a few months") is the review's estimate off current log growth rate,
not a measured constant.

## Verification (executor checklist)

- Every chunk: `node --check` on touched files, the relevant `pipeline/test/*.test.mjs` file (new
  fixtures added per chunk above), full `node pipeline/test/*.test.mjs` sweep stays green, and
  `pipeline/ci/check-imports.mjs` + `pipeline/ci/lint-docs.mjs` clean.
- Chunks 1-3 additionally get a live smoke run (`node pipeline/commands/watch-positions.mjs` /
  `monitor-offers.mjs` against the real local exchange-logger data) before being called done — the
  `heldIds` bug earlier this session passed every static check and only broke on a live run.
