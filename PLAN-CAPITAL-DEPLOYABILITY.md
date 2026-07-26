Status: **LEAN SCOPE — LANDED (Ben, 2026-07-26).** L1 was already satisfied (the `run-loop` scan-gate
tick has printed `deployable X (free Y + Z reclaimable from N deep bids · liquid W)` + the gate outcome
since the 07-15 rename — the plan's "does not PRINT" premise was a stale read). **L2 built + tested**
(`suspectBidEscrow`/`loadSuspectBidEscrow`/`suspectBidNote` in `offers.mjs` → the `⚠ N restart-suspect
bid(s) may be included` flag on `read-book`, the `run-loop` scan gate, and `screen --capital`; 3 new
acceptance checks in `offers.test.mjs`). **L3 doctrine** in `/scan` SKILL.md (v1.88) + memory
`deployable-shown-correct-at-source`. **C1 was already landed** — both reconstruct.mjs hunks (chunk-3
collapseOffers fresh-placement split + chunk-5 buildEvents purity) and their tests are on main (13
checks pass). The full automated redesign in §3-old (three-bucket `reservedSuspect` + confidence band +
injection-detector rewrite + `reconcile-suspects.mjs`) stays **SHELVED**, kept below §2 as the "if this
ever runs unattended" version. Ready to fold into `PLAN.md` + delete.

# PLAN-CAPITAL-DEPLOYABILITY — surface the deployable number, correct it at the source

## The decision (why lean)

The automated redesign modelled an uncertainty — "is this restart-blind bid still live in-game?" — that
**only needs modelling when no human can check**. Ben is a reliable human-in-the-loop who can look at his
GE offers and correct in one command. So the machinery (buckets, confidence band, injection-detector
surgery, auto-resolution) is over-built for how the tool is actually used. This is Ben's own
`gate-on-error-cost-not-n` doctrine: one console consumer, tight self-correcting loop — **surface it,
don't engineer a guard around it.** The error is visible when he acts (the number is shown at the point of
a sizing decision), cheap (a wrong rec the GE would reject, or a conservative under-deploy), and reversible
(one correction command). That profile says "make it transparent + correctable," not "model it."

Two moves replace the whole apparatus:

1. **Transparency at the point of use.** Wherever deployable capital gates or sizes a decision, show the
   number AND its composition — the same `free X · + reclaimable Y from N deep bids` breakdown `/book`
   already prints (`read-book.mjs:176-179`) — plus any restart-blind SUSPECT bids it may be silently
   counting. The composition data already exists in `deriveCash`'s output (`reservedDeep`/`restingDeepN`/
   `reservedCommitted`/`restingN`, `derive-cash-tiers.mjs:147-149`); this is surfacing, not new math.
2. **Correct at the source.** If the shown number is wrong, Ben says so and the fix routes through the
   source of truth (user memory `fix-at-the-source-not-derived-view`): a re-anchor
   (`derive-cash.mjs <amount>`) when the free-cash baseline drifted, or a manual-log correction /
   phantom-bid clear when a resting bid shown as reclaimable is actually gone. The conversational loop
   IS the override — no automatic expiry, no derived-view patch.

This dissolves the three open questions the shelved plan raised: suspect noise → shown at scan/size time,
where a decision is already being made (not nagged per tick); optimistic sizing → moot, the number is
corrected if wrong rather than the tool guessing a high end; dark-slot resolution → Ben tells me, I update.

## What exists today (verified, `file:line`)

- `deriveCash` (`derive-cash-tiers.mjs:127`) already returns the full composition:
  `deployablePool = availableCash + reservedDeep`, with `reservedDeep`/`restingDeepN`/`reservedCommitted`
  broken out. The three-tier model + injection detector are unchanged by this plan.
- `/book` (`read-book.mjs:176-179`) already prints `deployable X (free Y · + reclaimable Z from N deep
  bids) · liquid W`. This is the template the other surfaces mirror.
- `restartBlindSuspects` (`offers.mjs:152`) already detects restart-blind suspect offers and surfaces a
  "⚠ verify in-game" note on `watch-positions.mjs:1025-1032` and `monitor-offers.mjs:114` — but that
  detection is **disconnected** from the deployable-capital number. A suspect BID can sit in `deriveCash`'s
  `liveOffers` as a phantom resting bid and count toward `reservedDeep`/`reservedCommitted` with no flag.
- `run-loop.mjs` gates the scan on `deployablePool ≥ --min-idle` (`:29-35`, `:117`) but does not PRINT the
  number or its composition at the gate tick — the exact "indicate what we're using when we scan" gap.

## Chunks

### L1 — surface the deployable composition at the SCAN gate — *the core of Ben's ask*
`run-loop.mjs`'s scan-gate tick prints the same one-line composition `/book` prints (`deployable X (free
Y · + reclaimable Z from N deep bids)`), plus whether it cleared `--min-idle`, so every scan decision shows
what it sized against. Reuse `read-book.mjs`'s render helper if cleanly extractable, else mirror the format
(ONE format, not a second copy — factor the line into a shared helper if it would otherwise drift).
**Acceptance:** a loop tick that gates a scan prints the deployable figure + composition + the gate outcome;
a `--min-idle`-cleared tick shows the same. No new fetch (the gate already builds `marketRef` + derives cash).

### L2 — connect the SUSPECT flag to the deployable number — *the honest gap-closer*
Wherever the deployable number is shown for sizing (`read-book`, the L1 run-loop tick, `screen
--capital`'s capital-source line), append a `⚠ N restart-suspect bid(s) (~Xm) may be included — verify
in-game` note when `restartBlindSuspects` finds any for the current book. This connects the EXISTING
detection to the capital surface (failure mode #6) so a phantom-inflated deployable is flagged at the point
of use, not silently trusted. INFORM-ONLY — it does not change the number (that's Ben's correction call);
it just tells him the number might be soft so he knows to check. **Acceptance:** a book with a restart-blind
suspect bid shows the ⚠ note beside the deployable figure on all three surfaces; a clean book shows no note
(byte-identical to today).

### L3 — the correction doctrine (skills + memory, no code)
Document the standing rule in `/scan` and `/book` SKILL.md (and a user memory): the deployable number is
shown at the point of use; if it's wrong, correct at the SOURCE — re-anchor (`derive-cash.mjs`) for a
drifted free-cash baseline, or a manual-log fix for a phantom/gone resting bid — never a patch to a derived
view. Skills bump their own `version:`, never `APP_VERSION`.

### C1 — land chunk 3 (collapseOffers fresh-placement split) STANDALONE — *orthogonal correctness fix*
Unrelated to the suspect-display question: a relist after a lost terminal line currently merges into one
phantom lot, corrupting `spent`/`filled`/per-unit cost in the REALIZED-flow math (and thus `liquidCapital`'s
`netFlow` term). The fix + its acceptance fixture live UNCOMMITTED on worktree
`agent-a3e1ba12232696893` (`reconstruct.mjs` chunk-3 hunk + `reconstruct.test.mjs` "chunk 3" test).
Reconcile against `ceb538b` (which landed arch-coherence 1/5/6 but deliberately left `reconstruct.mjs`
untouched, so chunk 3 is still pending there). **Acceptance:** the worktree's two-offers-not-one-phantom
fixture passes; full `reconstruct.test.mjs` green; `positions.json` regenerates byte-identical on a log with
no lost-terminal relists (regression guard).

## What is SHELVED (kept for the unattended-future case)

The three-bucket `reservedSuspect` + `deployablePoolLow`/`High` confidence band + injection-detector
decoupling + `reconcile-suspects.mjs` design. Chunk 2 (forced-COMMITTED) is NOT landed either — its
`readSuspectsSnapshot`/`offersSnapshot.suspects` plumbing is not needed by the lean approach (L2 reads
`restartBlindSuspects` off the live log directly, same as watch/monitor already do). Revisit the shelved
design ONLY if this tool ever sizes capital unattended (no human to correct a wrong number).

## §2 (retained) — Failure-mode ledger

The analysis that justified the lean call — all six discussed modes CONFIRMED against code, plus two
build-order ones — is preserved here as the evidence base. Under the lean approach: #1 (injection-detector
false-trigger) is left AS-IS (the detector is unchanged; a wrong anchor bump surfaces as a wrong deployable
number Ben catches and re-anchors — the transparency covers it); #3/#5 (over-conservatism) is answered by
showing the composition so Ben sees exactly what's counted; #4 (no expiry) is intentional — Ben resolves it;
#6 (observability) is closed by L1+L2 putting the number and its suspects at the point of use.

| # | Failure mode | Verdict | Lean disposition |
|---|---|---|---|
| 1 | Injection-detector false-trigger from suspect escrow (`derive-cash-tiers.mjs:154-162`) | CONFIRMED | Left as-is; wrong anchor → wrong deployable → Ben re-anchors (transparency catches it downstream) |
| 2 | Forcing COMMITTED fixes the tier not the truth (`reconstruct.mjs:242-304`) | CONFIRMED | Not forcing anything; L2 flags the suspect, Ben resolves at source |
| 3 | Conservative direction fights deploy-biased posture | CONFIRMED tension | L1 shows the composition so the conservative number is legible, not silently trusted |
| 4 | No suspect resolution/expiry (`offers.mjs:152`) | PARTIAL | Intentional — Ben's one-command correction is the resolution |
| 5 | Compounding uncalibrated placeholders (`DEEP_BID_PCT` n≈0) | CONFIRMED | No second heuristic added; the number shows its work instead |
| 6 | Low observability / suspect flag disconnected from cash tiers | CONFIRMED | Closed by L1 + L2 |
| 7 | Single `offersSnapshot` writer (build-order) | CONFIRMED low-risk | N/A — lean approach doesn't add a `suspects` field |
| 8 | Confidence band invisible unless every print site updated | CONFIRMED | N/A — no band; L1/L2 update the three real sites |
