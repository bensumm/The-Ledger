# PLAN — Exchange-log hardening: impossible-transition validation + restart-blindness warning

**Origin:** Ben, 2026-07-05 — "we've had a ton of problems with the log discrepancies…
missing bids, phantom bids." A live-session catalogue of the failure classes found four,
two already fixed (the EMPTY-burst phantom-cancel inference was deleted 2026-07-05; the
stale-positions basis is solved by LW1's `watch-log.mjs`). This plan is the remaining two.

## The two live defect classes (with today's incidents as fixtures)

### A. Phantom duplicate terminals (the 13:25/13:29 double-buy)

At 13:25:53 and 13:29:01 on 2026-07-05 the log carries TWO `BOUGHT Abyssal bludgeon qty 1
@ ~17,401,000` events on the **same slot**, with no new offer placed between them. Only one
buy was real (Ben confirmed). Effect: the session read "two bludgeons bought, 34.8m
committed" and positions briefly carried a phantom open lot.

**The invariant that catches it:** a GE slot is a state machine. A terminal event
(`BOUGHT` / `SOLD` / `CANCELLED_*`) closes a slot; a second terminal on the same slot is
IMPOSSIBLE unless a new offer (a `BUYING`/`SELLING` placement line, or any state
re-opening the slot) appeared in between. Re-emits after relogs violate this invariant;
real repeat trades (same item, same price, minutes apart — which legitimately happen,
e.g. today's two real blowpipe bids) do NOT, because the second trade's placement line
re-opens the slot first.

### B. Restart display-blindness (the 10:21 all-slots-blank read)

After a client restart the plugin re-emits nothing until each slot's state changes, so
`monitor.mjs`/`watch.mjs` read live offers as missing (NOT LISTED / no active bids) for
minutes-to-hours. Root cause is the plugin's emit-on-change semantics — **not fixable in
reconstruction** — but it is *detectable*, and today it cost a session two rounds of
"your offers vanished" analysis before being recognized.

## Chunk LH1 — slot-state validation in reconstruction

1. In `pipeline/lib/reconstruct.mjs`, add a validation pass (own exported function, e.g.
   `validateSlotTransitions(events)`) run inside/next to `buildEvents()`: track per-slot
   open/closed state through the sorted event stream; when a terminal event arrives on a
   slot whose previous event was already a terminal **with no intervening
   placement/progress line for that slot**, mark the later event as a suspected re-emit.
2. **Disposition: drop it from the event stream, but loudly** — a `console.warn` per
   dropped event (`suspected re-emit dropped: SOLD <item> @<price> slot N, prior terminal
   at <ts>`) and a count in the sync summary line. Never drop silently; never write the
   suspect into `fills.json`. (Manual-log events — slots 8/9 — are exempt: they have no
   slot state machine.)
3. **Conservatism guard:** only drop when the duplicate is *strictly* identical in
   item+side+qty+price to the prior terminal on that slot. A same-slot terminal with any
   differing field still warns but is KEPT (fail toward preserving data; tombstones remain
   the manual override for anything the heuristic misses).
4. **Fixtures** (`pipeline/reconstruct.test.mjs` or a new colocated test file, banner of
   business requirements per house style):
   - the 13:25/13:29 double-buy verbatim → one event survives, one dropped, warn emitted;
   - same two events WITH an intervening placement line → both survive (the real-repeat case);
   - near-duplicate with differing price → both survive + warn;
   - manual-log slot-8/9 lines never touched.
5. P/L safety: `matchTrades` consumes only `filled>0` events, so the fix's only P/L
   effect is removing phantoms — assert in the fixture that totals match the
   one-real-buy reconstruction.

## Chunk LH2 — restart-blindness warning line in monitor/watch

1. Detection: the RuneLite `launcher.log` (or `client.log`) timestamp gives the last
   client start. If (a) a restart happened after the newest exchange-log line's slot
   activity, or (b) simpler heuristic — the newest log line is older than N minutes while
   `positions.json` shows open non-manual offers — print one warning line in `watch.mjs`
   and `monitor.mjs` headers: `⚠ log may be blind — client restarted <time> and slots
   have not re-emitted; offers shown may be stale/missing`. Prefer the simplest reliable
   signal found at build time; the header line is the deliverable, the detection heuristic
   is implementer's choice (document what was chosen and why in the file header).
2. No behavioral change beyond the printed line — verdicts/annotations stay as-is.
3. Test: fixture the header assembly (pure function) rather than the filesystem probe.

## Chunk LH3 — docs (process rule 8)

- `pipeline/FILLS-PIPELINE.md` §10 (cancel/restart semantics): add the re-emit class and
  the validation pass; reconcile any "the log is append-only truth" phrasing to name the
  two known artifact classes and the validator.
- `pipeline/MONITORING.md`: one line on the blindness warning in the watch header.
- `CLAUDE.md`: Done pointer only.
- Pipeline-only chunks — no APP_VERSION bump; note in commit messages.

## Guardrails

- **Fail toward keeping data.** The validator drops only provably-impossible exact
  duplicates; everything else warns. Tombstones (`coffer-manual.log` REMOVE lines) remain
  the manual correction path and must keep working on dropped-or-kept events alike.
- Do not resurrect anything resembling the deleted cancel-to-EMPTY inference — EMPTY
  lines stay non-evidence (R1 lesson, 2026-07-05).
- `~/.runelite` stays read-only input.
- All tests via `pipeline/run-tests.mjs` auto-discovery; no CI edits.

## Status — ALL SHIPPED (2026-07-05)

| Chunk | What | Status | Sha |
| --- | --- | --- | --- |
| LH1 | `validateSlotTransitions()` — loud ingest drop of impossible same-slot re-emit terminals (before the `fills.json` merge); `dedupeSnapshots` stays as the silent derivation backstop; warnings gated `warn:false` in the daemon/`--local`/`monitor`; fixtures in `validateslots.test.mjs` | **shipped** | `c0fc711` |
| LH2 | `blindWarningLine()` restart-blindness header line in `monitor.mjs`/`watch.mjs` (`pipeline/lib/logblind.mjs`); fixtures in `logblind.test.mjs` | **shipped** | `f7bd006` |
| LH3 | docs reconciliation (FILLS-PIPELINE §5.1/§10 two artifact classes + validator, MONITORING blindness line, CLAUDE.md Done pointer, CHANGELOG entry, this Status table) | **shipped** | this commit |

Pipeline-only — **no `APP_VERSION` bump** on any chunk. Real-log acceptance: 17 historical re-emits
dropped (incl. the known 13:29), positions byte-identical to the committed `positions.json`; 14 test
suites green via `node pipeline/run-tests.mjs`.

## Acceptance

1. Re-running the full reconstruction over the real logs drops exactly the known 13:29
   duplicate (and any siblings it finds), warns for each, and produces `positions.json`
   identical to today's Ben-confirmed state (1 bludgeon bought at 13:25, not 2).
2. The blowpipe two-real-bids case (slots 5+6, 14:09/14:27 on 2026-07-05) is untouched.
3. A client restart while offers rest produces the blindness warning line in `watch.mjs`
   output within one pass, and no phantom events.
4. All suites green.
