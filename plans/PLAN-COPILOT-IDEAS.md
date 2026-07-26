# PLAN-COPILOT-IDEAS — porting concrete techniques from Flipping Copilot / FlipSmart

Status: **PB-COPILOT-1 (margin-reduction budget) LANDED 2026-07-16. Held-item exception (both the
falling-exclusion AND the 500k gp/day floor) code-enforced 2026-07-16 — a separate but related fix,
folded in here since it surfaced from the same session's validation pass. Restart-blindness
recovery SCOPED DOWN, not landed — see honest limitation below.** Per-topic working doc
(PLANNING.md lifecycle); folds into PLAN.md and is deleted when its last chunk ships.

## Context / diagnosis

A background research agent (2026-07-16) read the real source of two open-source RuneLite GE
flip-assistant plugins — `cbrewitt/flipping-copilot` and `Flip-Smart/flip-smart-runelite-plugin`
(both BSD-2-Clause) — to see whether any of their algorithms/heuristics were worth porting into
our own pipeline. Neither plugin's actual opportunity-ranking algorithm is inspectable (both are
thin clients over proprietary backends), but their client-side offer-lifecycle machinery is fully
visible and surfaced several ideas. Ben picked two to act on now: (1) their offline/missed-fill
recovery around a RuneLite client restart, and (2) FlipSmart's cumulative margin-reduction budget
on a repricing ladder.

**Anchor incident:** the same 2026-07-16 session hit exactly the restart-blindness class this
research targeted — a RuneLite client restart/relog wiped `~/.runelite/exchange-logger`'s slot
state to `EMPTY` for every open offer (twice), and separately the anglerfish position got stepped
down 2,579→2,549→2,509→2,499→2,489→2,474 over ~25 minutes chasing a live breakdown with no memory
of how much had already been given back.

## Rulings

- Ben, 2026-07-16: "I think solving 1 and then 2 sound good to me" — build both, in that order of
  research priority; landed in the reverse order here because #1 turned out to be blocked (see
  below) and #2 was immediately actionable.
- No retroactive backfill of the margin-reduction tracker's history — it starts counting from the
  session it's added, honestly, rather than fabricating a give-back number for reprices that
  happened before the tracker existed.

## Existing scaffolding

- `pipeline/lib/offers.mjs` `restartBlindSuspects()` (LH2.4, same session) already detects a
  restart-wiped slot and flags "possibly still listed" — but it only recovers PRESENCE (is the
  offer still there), not FILL STATE (did units transact while blind). That's the actual gap #1
  targets, and it's a different, harder problem.
- `pipeline/lib/watchstate.mjs` (V1/V4/V7/TG1/P4b) is the pure cross-pass memory layer for the
  watch loop — the natural home for a NEW piece of cross-pass memory (the ask-price history), same
  pattern as the existing underwater-streak/band-top-drift trackers.
- `pipeline/lib/emit.mjs` `heldNoteBlock()` is the ONE shared renderer for a held lot's note block
  (the V5 EMIT CONTRACT) — any new advisory line renders through it, not a bespoke print.

## Target architecture

- **PB-COPILOT-1 (margin budget):** lives entirely in `watchstate.mjs` (pure) +
  `watch-positions.mjs` (wiring: feed the resting ask price in, read the note out) +
  `emit.mjs` (one new optional `heldNoteBlock` field). No new files, no schema break — the
  persisted `watch-state.json` entry gains 4 new fields (`initialAsk`, `lastAsk`,
  `consecutiveAskDecreases`, `cumulativeReductionPct`), additive and null-safe on old entries.
- **Restart-blind fill recovery:** NOT built this pass — see honest limitation.

## Staged chunks

### Chunk 1 — restart-blind fill recovery: SCOPED DOWN, not landed

**Honest limitation, confirmed against our actual log data (not assumed):** Copilot and FlipSmart
solve this INSIDE the RuneLite client process — they listen to the raw `GrandExchangeOfferChanged`
event stream directly, so they see the ~2-tick "login burst" RuneLite re-emits for every slot on
reconnect, and FlipSmart additionally scans the in-game **GE History widget** (group 383) to
recover exact offline fill prices. Both mechanisms require being a RuneLite plugin running in the
client. We are not — we are a script reading a THIRD-PARTY plugin's (`~/.runelite/exchange-logger`)
already-written log file. Checked directly in this session's log: after a restart, the affected
slots show a bare `EMPTY` row and then **nothing further** until Ben manually re-touches that exact
slot — there is no "resumed state with an updated fill count" ever written to the log for us to
diff against. **We cannot recover data the log never captured.** Building this for real means
either forking the Exchange Logger plugin (a different codebase, Ben would need to install a
custom build) or writing a new companion RuneLite plugin that reads the GE History widget like
FlipSmart does — both are out of scope for a log-reader script and a real, separate decision for
Ben, not a pipeline chunk.

**What IS achievable purely from the log we already have** (deferred, not built this pass): flag
the case where a restart-wiped slot's LAST known state showed active partial-fill progress
(`qty > 0`) before going blind — i.e. "this offer had already started filling when the log went
dark; double-check your GE history / bank against `positions.json`, the reconstruction may be
undercounting this lot specifically." That's a narrower, honest, verify-manually prompt, not fill
recovery — worth a small follow-up chunk if it recurs, not built today because no such case has
been observed yet in the actual log data (every restart-wiped slot this session had `qty:0`, i.e.
untouched since placement).

### Chunk 2 — PB-COPILOT-1: cumulative margin-reduction budget — LANDED 2026-07-16

**Shipped:**
- `pipeline/lib/watchstate.mjs`: `advanceState()` now tracks, per held lot, `initialAsk` (the
  first resting-ask price seen this hold episode — same reset policy as everything else in this
  module: a changed identity or a gap > `STALE_GAP_MS` re-baselines it), `lastAsk`,
  `consecutiveAskDecreases` (a streak of straight step-downs, broken by any increase or
  no-change), and `cumulativeReductionPct` (give-back from the ORIGINAL ask; increases never
  count against it — laddering UP is free). New `marginBudgetNote(state)` (pure) returns an
  inform-only note once `cumulativeReductionPct ≥ MARGIN_BUDGET_PCT` (0.05, placeholder) OR
  `consecutiveAskDecreases ≥ MARGIN_BUDGET_STREAK` (3, placeholder) — either condition alone
  fires it.
- `pipeline/commands/watch-positions.mjs`: feeds the held lot's resting ask (confirmed OR
  restart-blind-suspect — a suspect ask still counts as the price being chased down from) into
  the state object; reads `marginBudgetNote(newState[key])` after `advanceState` and threads it
  through `heldNoteBlock`.
- `pipeline/lib/emit.mjs`: `heldNoteBlock()` gained one new optional field (`marginBudget`),
  rendered as note 4c (between the dominant-path line and the guaranteed sell line) — additive,
  never breaks the V5 EMIT CONTRACT ordering for a lot with no budget note.
- `pipeline/test/watchstate.test.mjs`: 7 new fixture checks (fresh-hold baseline, increase-never-
  counts, streak-alone trips, %-alone trips, episode-reset re-baselines, null-safety).

**Verification:** `node pipeline/test/watchstate.test.mjs` (34/34 pass, up from 27); full pipeline
test sweep re-run clean; `check-imports.mjs` + `lint-docs.mjs` clean; live-verified against the
real anglerfish chase this session (state file correctly pinned `initialAsk: 2474` fresh — no
retroactive fabrication of the earlier 2,579→2,499 give-back that happened before the tracker
existed).

## Encoding boundary

Both chunks are pure-function encoding (no new judgment prose) — the margin-budget NOTE is
inform-only (never a verdict, never an alert, never auto-cancels/relist) same as every other V6/P4b
advisory line in this module.

## Bookkeeping & compatibility checklist

- No new files created — no README inventory entry needed.
- `watch-state.json` schema: additive only, old entries missing the 4 new fields degrade via `?? null`/`|| 0` — never throws on an old cache file.
- No `APP_VERSION` bump (pipeline-only; `js/*.js` untouched).
- This doc: fold into `PLAN.md`'s Discovered list and delete once chunk 1 either lands (via a
  companion-plugin decision) or is explicitly dropped.

## Honesty (process rule 4)

`MARGIN_BUDGET_PCT` (5%) and `MARGIN_BUDGET_STREAK` (3) are PLACEHOLDERS ported from FlipSmart's
own (also placeholder-ish, hardcoded) constants — n≈0 on our own retro data. No claim these
thresholds are calibrated; they're a reasonable starting shape, flagged as such in the note text
itself. The chunk-1 limitation above is not a threshold question — it's a hard data-source
boundary, stated plainly rather than worked around with a fake partial fix.

## Verification (chunk 2, restated for the executor)

- `node pipeline/test/watchstate.test.mjs` — all margin-budget fixtures pass.
- `node pipeline/commands/watch-positions.mjs --pressure-exit` on a real held lot with a
  multi-step reprice history shows the note once the streak/pct threshold trips, and shows nothing
  on a fresh hold or a laddered-up ask.

### Chunk 3 — held-item exception, code-enforced (both halves) — LANDED 2026-07-16

Surfaced during a manual `/scan` judgment-filter validation pass the same session: the `/scan`
skill's prose rule *"items Ben holds ... always show, with price-to-clear"* had **zero code
behind it** — confirmed by grep, twice. Two independent gaps, two independent fixes:

1. **Falling-exclusion bypass** (`surviveMode()`, `pipeline/lib/gatecandidates.mjs`) — a held item
   whose regime flips to `falling` between passes would previously vanish from band/churn with no
   warning. New `held` opt bypasses ONLY the falling-exclusion drop (not `notFalling`/posture —
   those aren't part of the stated exception); returns `heldFallingOverride:true` so the caller can
   print an explicit note (`screen-flip-niches.mjs`: `⚠ <item>: shown despite falling ... you HOLD
   this item; price-to-clear, not a buy signal`) instead of a silent appearance.
2. **500k gp/day attention-floor bypass** (`gateCandidates()`, same file) — the `MIN_GPD` check had
   a comment claiming "held/asked items are exempt too" immediately beside it with no enforcement.
   New `heldIds` param (4th arg, default empty `Set`) exempts a held item the same way the existing
   thin-gp-flow path does. Paired with an **unbounded held reserve** in `rankAndSlice()` (same
   family as the existing thin/rising reserves) so a held item that clears the gate can't still get
   silently dropped at the top-N fetch cutoff — unbounded because there are only ever a handful of
   held lots at once, unlike the thin/rising pools which need a cap.

Both wired from `screen-flip-niches.mjs` via a module-level `HELD_IDS` (read once from
`positions.json`, read-only, no fetch, empty-set-safe on any error) — **caught and fixed a real bug
while testing this live**: the first cut used a `main()`-local `let heldIds`, unreachable from the
separate `renderMode()` function (`ReferenceError: heldIds is not defined`) — fixed by promoting it
to the same module-level-`let`-set-in-`main()` pattern `BUYS_BY_ITEM` already uses. A reminder that
"the fixture suite is green" and "it runs against real data without crashing" are different bars —
this shipped only after both.

**Verification:** `node pipeline/test/gatecandidates.test.mjs` (29/29, up from 22) — 5 fixtures for
the falling-exclusion bypass, 2 for the gp-floor exemption + held reserve. Had to update
`survivemode.test.mjs`'s 16 exact-shape `deepEqual` assertions to include the new
`heldFallingOverride` field (a byte-identical-shape test catching an actual shape change — working
as intended, not a false failure). Full pipeline test sweep (60+ files) re-run clean after both
fixes; `check-imports.mjs` + `lint-docs.mjs` clean. Live-verified: `--mode all` on the real book
shows fetch counts grew exactly enough for the 3 held items to claim reserved slots (band 40→41,
churn 40→43) with no held-falling-override needed yet (none of today's 3 held items classify as
`falling` by the regime metric currently) — the mechanism is standing by, proven correct via
fixtures, not yet exercised live.

**Encoding boundary:** both are gate/reserve LOGIC changes (not judgment prose) — the
`/scan` skill's exception text can now be trimmed to point at the code rather than restate it (a
follow-up doc pass, not done in this chunk to keep the diff reviewable).

**Bookkeeping:** no new files; `positions.json` read is additive/optional (degrades to empty set on
any read error — a missing file is not a regression, it's today's behavior byte-for-byte); no
`APP_VERSION` bump (pipeline-only).
