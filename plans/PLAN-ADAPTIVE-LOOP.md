# PLAN-ADAPTIVE-LOOP — the loop paces itself off the book, and stops when there is nothing to do

Drafted 2026-09-19 (Ben: "a smarter loop system that can control its own timing — recognize when
bids aren't likely to fill or are deep placements or the book cleared entirely and slow down or
stop the loop"). Executor: Fable. Chunk prefix `AL*` (checked free with `lint-plan-refs.mjs --collisions`
before writing). Status: ACTIVE — reviewed with Ben and registered in `PLAN.md` 2026-09-19
(R-AL-9 decided: fresh exposure always un-mutes; picks-only scan → OFFER, start on Ben's "placed").
This file is deleted + folded the moment AL5 (or AL4 if taken) ships.

## 1. Context / diagnosis

**The problem in the owner's words.** The loop today is a fixed-cadence cron (`/loop 15m
node pipeline/commands/run-loop.mjs --watch 15 --scan 30`). It fires every 15 minutes regardless of
whether anything CAN change: on 2026-09-19 it ran with an EMPTY book (0 open lots, 0 offers) and
kept firing — every tick a sync + a "Nothing to watch" + a full `--mode all` scan (~1–2 min of
API fetches) + an agent turn to read and relay it. The cost is not the script; it is the AGENT TURN
per tick (context, tokens, Ben's attention on "nothing changed" lines). A deep resting bid that
touches its level 4 days in 14 does not need a 15-minute glance either; nor does a bid the watch
already verdicted `BID-BEHIND`.

**Root causes, confirmed in code.**

1. `run-loop.mjs` is a pure TIME multiplexer. `due()` (`pipeline/commands/run-loop.mjs:78`) compares
   `now − state[key]` against the CLI interval and nothing else; state is two timestamps
   (`pipeline/.cache/loop-state.json` = `{"watch":…, "scan":…}`). The only state-aware gate is the
   scan's capital floor (`:113–:123`, `deployablePool < --min-idle` → skip), which is the wrong
   direction for this problem — it skips discovery when there is NO cash; it never slows anything
   when there is nothing HELD.
2. The cadence intelligence that exists is per-ITEM and only ever TIGHTENS. `watch-positions.mjs`
   classifies each lot/offer into a class with a cadence (`:159–:175`, `CADENCE_TIGHT/MED/LOOSE` =
   3/5/15m) and recommends the TIGHTEST across the book (`:888`, printed at `:1265` as a paste-ready
   `/loop` line). There is no "nothing needs attention → loosen" branch, and an empty book prints
   "Nothing to watch" (`last-report/watch.json` headline) with no cadence at all.
3. The bid-placement read exists but is not consumed for pacing. `bidAction()` (`:350–:370`) yields
   `BID-OK / BID-BEHIND / CROSSING / CANCEL-BID`; `derive-cash-tiers.mjs classifyBid()` (`:90–:100`)
   yields `deep | committed` at `DEEP_BID_PCT = 0.05` below the band low. Both are rendered, neither
   feeds `run-loop.mjs`.
4. The loop's DRIVER cannot be steered by the script. `/loop 15m …` is a `CronCreate` — the script
   has no channel to change the cron. The `/loop` skill's DYNAMIC mode (no interval → the agent
   calls `ScheduleWakeup` with a `delaySeconds` it chooses each turn, and `stop: true` to end) is
   the only mechanism by which a computed cadence can actually reduce agent wakeups. So the plan
   has two halves that must ship together: the SCRIPT computes a recommendation, and the DRIVER
   honours it. Neither alone changes the number of turns.

**Anchor incident:** the 2026-09-19 evening loop — empty book, cash re-anchored at 130m, three picks
already verified and waiting on Ben to place them; the loop fired 15-minutely into that state,
including one tick that landed 5 minutes before anything was due and reported "nothing due".

## 2. Rulings (decided / proposed-for-veto)

- **R-AL-1 (decided, Ben 2026-09-19):** the loop must be able to SLOW DOWN and STOP itself off book
  state. Speeding up is already covered by the per-class cadence; this plan adds the other direction.
- **R-AL-2 (proposed default — veto?):** the script RECOMMENDS, the agent DRIVES. `run-loop.mjs`
  emits a machine-readable next-wake recommendation; it never sleeps, spawns, or schedules. This
  keeps the daemon-safety and "tool holds state, Ben drives timing" doctrine intact — a script that
  decides to stop polling is not the same as a script that decides to place an offer, but it is the
  same shape of "the tool acting on its own", so it stays a recommendation the agent (or Ben) applies.
- **R-AL-3 (proposed default — veto?):** STOP is recommended only on an EMPTY book (no open lots, no
  active offers, no `--dip` pool armed) AND no pending agent action — the "pending agent action"
  half is judged by the DRIVER at apply time (R-AL-2), not an input to `pace()`. A book with even one resting deep
  bid never stops — it slows to the deep-bid floor cadence (§4) because a fill is still a real event.
- **R-AL-4 (proposed default — veto?):** the pending reverse-flip rebuy (`awaitingRebuy`, the
  Armadyl crossbow 9.4d case) does NOT hold the loop open. It is inform-only PENDING by doctrine
  (`tool-holds-state-ben-drives-timing`); the loop is not the surface that will act on it.
- **R-AL-5 (proposed default — veto?):** every tier's cadence is a NAMED CONSTANT with the same
  ≥-cron-granularity floor `run-loop.mjs` already assumes (`GRACE_MS`, 1-minute cron floor), and
  the loop NEVER recommends faster than the tightest per-item class already recommends — this plan
  only adds tiers ABOVE 15m.
- **R-AL-6 (proposed default — veto?):** a fill, a new offer, a new lot, a CANCEL-BID/CUT/FLUSH alert,
  or Ben's own message resets the cadence to the tight side immediately (the "something happened"
  branch). Loosening is gradual (one tier per quiet tick); tightening is instant.
- **R-AL-7 (proposed default — veto?):** AUTO-START is the symmetric half of stop (Ben 2026-09-19:
  "if the loop isn't running we could automatically start it when bids are placed"). Any agent turn
  that OBSERVES a startable book (`pace().startable` — REAL EXPOSURE on the book; tier is NOT the
  predicate, since an empty book paces `DRY` and a dip-armed empty book paces `GLANCE`, and
  starting a loop into either rebuilds the anchor incident) while the loop is presumed dead starts it in that
  same turn and reports one line — no ask. Detection is PASSIVE: nothing polls for this; the
  observation rides surfaces that already read a fresh book (the SY1 auto-sync under `/scan` and
  `/positions`, `/morning`, a bare sync, or Ben saying "placed"). No daemon, no scheduler — the
  trigger only ever fires inside a turn that was happening anyway, so daemon-safety is untouched.
- **R-AL-8 (proposed default — veto?):** ONE decision function for both directions — the start tier
  IS `pace()` of the fresh book. No separate start heuristic: a deep-bid-only book auto-starts
  straight at `DEEP` ~60m, never at a hot 15m default; a held lot starts at `GLANCE`; an alert on
  tick 0 starts `ACTIVE`. The start values are the existing caps (`--watch 30 --scan 15
  --min-idle` — the script's own defaults, echo the CONFIGURED values, never a literal) — auto-start changes WHEN the loop exists, never its knobs.
- **R-AL-9 (decided, Ben 2026-09-19 — "fresh exposure is always enough"):** Ben's explicit "stop
  the loop / keep it off" MUTES auto-start (persisted flag + offer-key snapshot,
  `run-loop.mjs --mute`); a NEW offer key vs that snapshot ALWAYS un-mutes — fresh exposure trumps
  an old stop, no exceptions. The loop stopping ITSELF (`IDLE`) never mutes: auto-start stays
  armed, which is exactly what makes STOP safe to recommend.
- **R-AL-10 (proposed default — veto?):** `/overnight` does NOT auto-start the loop — Ben is asleep,
  so there is no actor for its output and `/morning` is the designated catch-up surface (which DOES
  auto-start on a non-empty book). An explicit overnight watch ask overrides, as always.

## 3. Existing scaffolding (not greenfield)

| Piece | Where | Reused as |
|---|---|---|
| Time multiplexer + `loop-state.json` | `run-loop.mjs` | the ONE home for the pacing decision; state file grows a `recommend` field |
| Per-item class → cadence, tightest-of-book | `watch-positions.mjs:159–175, :888, :1265` | the FAST side; untouched, consumed by AL2 |
| Bid placement verdicts `BID-OK/BEHIND/CROSSING/CANCEL-BID` | `watch-positions.mjs bidAction()` | input to the "unlikely to fill" tier |
| `deep|committed` classifier, `DEEP_BID_PCT` | `pipeline/lib/capital/derive-cash-tiers.mjs classifyBid()` | input to the "deep placement" tier — already fetched by `run-loop.mjs buildMarketRef()` on scan-due ticks |
| Window-touch context (`bid X touched N/14d`) | `watch-positions.mjs windowLine()` | the deep-bid expected-time-to-touch read |
| `last-report/watch.json` (headline, alerts, items) | `pipeline/lib/render/cli.mjs writeLastReport` | the machine-readable input `run-loop.mjs` reads instead of re-deriving |
| Scan capital gate (`--min-idle`) | `run-loop.mjs:113–123` | stays; it is the "no cash" gate, orthogonal to "no book" |
| `/loop` dynamic mode (`ScheduleWakeup`, `stop`) | `/loop` skill (harness) | the DRIVER that turns the recommendation into fewer agent turns |
| `check-daemon-safety.mjs` | `pipeline/ci/` | pins that AL adds no git/scheduling side-effects |

Not existing (verified absent): any "loosen" branch; any consumer of `watch.json` for pacing; any
`stop` signal; any record of WHY a tick was skipped beyond the capital note; any START trigger —
today the loop exists only when Ben (or a skill run) types the `/loop` line by hand.

## 4. Target architecture

**One new pure module, one consumer, one driver change.**

```
pipeline/lib/loop/pace.mjs            ← NEW, pure: bookState → {tier, nextWakeMin, reasons[], stop}
pipeline/commands/run-loop.mjs        ← consumer: reads watch.json + offers/positions, calls pace(),
                                         prints `# pace:` line, writes loop-state.recommend, exits
.claude/skills/loop/… (harness skill)  ← NOT ours to edit; instead:
CLAUDE.md `/loop` row + MONITORING §Cadence ← the driver doctrine: run run-loop under /loop DYNAMIC
                                         mode and pass the printed nextWakeMin to ScheduleWakeup
```

**Tiers (all named constants in `pace.mjs`, every value a PLACEHOLDER):**

| Tier | Trigger (evaluated top-down; first match wins) | nextWake | stop? |
|---|---|---|---|
| `ACTIVE` | any watch alert this tick (CUT / LIST-TO-CLEAR / CANCEL-BID / FLUSH / fill since last tick / new lot or offer) OR any item's class cadence ≤ 5m | tightest per-item class cadence (3/5m) — unchanged | no |
| `GLANCE` | held lots exist, or ≥1 `committed` (near-live) bid with `BID-OK`/`CROSSING` | 15m (= `CADENCE_LOOSE`) | no |
| `DEEP` | every resting bid is `deep` (≥5% under band low) or `BID-BEHIND`, and no held lots | `PACE_DEEP_MIN` = 60m — a deep bid's touch cadence is days, not minutes; a fill is caught at the next tick and the book sync is what matters, not the glance | no |
| `DRY` | no held lots, no offers — the pre-debounce empty book (the cash gate stays `run-loop.mjs`'s `--min-idle`, not a `pace()` input) | scan cadence only (`--scan`), watch OFF until an offer appears | no |
| `IDLE` | empty book (0 lots, 0 offers) for ≥ `PACE_IDLE_TICKS` = 2 consecutive ticks and no `--dip` pool armed | recommend **STOP** — print the restart line | **yes** |

Loosening moves at most ONE tier per tick (R-AL-6); tightening jumps straight to the matching tier.
A `--dip` armed loop never goes below `GLANCE` (the flush window is ~5m latency — MONITORING DL2).

**Inputs, and where each already comes from (no new fetches on a quiet tick):**
- lots / offers: `positions.json` `open`, `offers.json` `offers` (already read by sync/watch).
- per-offer placement: `watch.json` items' bid verdict (BID-OK / BEHIND / CROSSING / CANCEL-BID).
- deep vs committed: `classifyBid` off the `buildMarketRef()` the scan gate already builds — on a
  watch-only tick reuse the LAST scan tick's classification from `loop-state.json` (stale by ≤ one
  scan interval; a stale `deep` can only keep the loop SLOWER, never faster, which is the safe side —
  and a fill/new-offer event tightens regardless of it).
- alerts / fills: `watch.json` `alerts`; fills = `positions.json` closed-count delta vs last tick.

**Output contract (the one thing the driver reads):**
```
# pace: DEEP → next wake ~60m (2 deep bids: Nightmare staff 28.001m touched 3/14d · Opal bolts 2,829 8/14d; no held lots) · tighten on: fill / new offer / alert
```
and `loop-state.json.recommend = { tier, nextWakeMin, stop, startable, reasons, at }`. On `stop`, the line is:
```
# pace: IDLE → STOP the loop (empty book 2 ticks). Restart: /loop node pipeline/commands/run-loop.mjs --watch 30 --scan 15
```

**Driver doctrine (the half that actually saves turns):** the `/loop` row in CLAUDE.md and
MONITORING §Cadence change from `/loop <gcd>m node …run-loop.mjs …` (fixed cron) to
`/loop node …run-loop.mjs …` (dynamic mode). The agent's per-tick rule: read `# pace:`; call
`ScheduleWakeup(delaySeconds = nextWakeMin×60, noop = nothing changed)`; on `stop`, call
`ScheduleWakeup(stop:true)` + `PushNotification` with the restart line. The script's `--watch/--scan`
become CAPS (the fastest the loop will go), not the cadence. Fixed-cron `/loop 15m …` still works
unchanged (the `# pace:` line is then informational) — no behaviour change for anyone not on the
new doctrine.

**Auto-start (the symmetric half — R-AL-7..R-AL-10).** "Running" is decided from
`loop-state.json.recommend`: presumed DEAD ⇔ no record, or `stop: true`, or
`now > at + PACE_DEAD_FACTOR × nextWakeMin` (`PACE_DEAD_FACTOR` = 2, a placeholder — one missed
wake is a hiccup, two is a dead driver). `pace.mjs` exports `loopPresumedDead(recommend, now)` so
the check is one import, not re-derived prose arithmetic. The per-turn agent rule: after any
surface that just refreshed the book, if `loopPresumedDead` AND not muted AND the book is
startable, run one `run-loop.mjs` tick immediately (tick 0 doubles as the first watch pass), read
`# pace:`, and enter dynamic mode at the recommended wake. Report ONE line
(`loop started: GLANCE ~15m — 2 open bids`), never a paragraph.

| Situation (observed inside an agent turn) | Auto-start? | Why / start values |
|---|---|---|
| Ben says he placed offers / "watch this" | **yes, same turn** | the anchor case; one tick now, then `ScheduleWakeup(pace().nextWakeMin)` under the standard caps |
| A synced read (SY1 under `/scan`/`/positions`, a bare sync) shows an offer key or open lot NOT in loop-state's last snapshot | **yes** | new exposure appeared since the loop last looked — same values |
| `/morning` ends with a non-empty book | **yes** | Ben is back at the desk; the loop is the attention layer for the day |
| `/scan` ends with picks but nothing placed yet | no — **offer** (Ben 2026-09-19) | picks are not exposure; the agent offers in ONE line ("start the loop when you place?") and starts the turn Ben says "placed" — his statement is the trigger, not the picks |
| `/overnight` | no (R-AL-10) | no actor overnight; `/morning` catches up and starts it |
| dip pool armed, book empty | no | DL2 stays an explicit ask — a flush watch is a choice, not ambient state |
| muted (Ben's explicit stop) and no NEW offer since | no (R-AL-9) | an old stop holds until fresh exposure overrides it |

## 5. Staged chunks

**AL1 — `pace.mjs`, pure + fixture-pinned (foundation).**
Files: `pipeline/lib/loop/pace.mjs` (new), `pipeline/test/pace.test.mjs` (new), README inventory.
Input is a plain object (`{lots, offers:[{side,qty,filled,verdict,placement}], alerts, fillsSince,
newExposure, awaitingRebuy, dipArmed, prevTier, idleTicks, classCadenceMin, scanMin}` — the cash
gate's `deployable`/`--min-idle` stay in `run-loop.mjs`, never `pace()` inputs); output as §4 plus
`startable` (the R-AL-7 auto-start predicate — real exposure, never tier) and the carried
`idleTicks`. Fixtures: empty
book ×1 tick → `DRY`/`IDLE` progression; one deep bid → `DEEP` 60m; deep bid + one alert → `ACTIVE`;
held lot → never below `GLANCE`; `--dip` armed → never below `GLANCE`; tightening is instant,
loosening one tier per tick (a `DEEP`→`IDLE` jump in one tick must FAIL the fixture). Verification:
`run-tests.mjs` green; the module imports nothing from the network or fs (pin with a test that
greps its import list — same pattern as `check-daemon-safety`). Also exports
`loopPresumedDead(recommend, now)` (R-AL-7) with boundary fixtures at `at + 2×nextWakeMin ± ε`,
no record, and `stop: true`.

**AL2 — `run-loop.mjs` consumes it (behaviour, additive).**
Files: `pipeline/commands/run-loop.mjs`, `pipeline/.cache/loop-state.json` schema (+`recommend`,
+`lastClosedCount`, +`lastOfferKeys`, +`idleTicks`, +`bidClass` cache). Reads `watch.json` after
the watch pass; computes `pace()`; prints the `# pace:` line LAST (after `# next due:`); writes
`recommend`. A watch-only tick reuses the cached bid classes. `--watch/--scan` semantics unchanged
when a tier is faster than or equal to them; when the tier is SLOWER the printed `# next due:` line
names the tier's time and the reason. Also lands `--mute`/`--unmute` (R-AL-9): `--mute` writes
`muted: true` + the current offer-key set into `loop-state.json`; the normal tick clears `muted`
when it sees an offer key outside that snapshot. Verification: golden-stdout diff on a fixture book
proves the existing lines are byte-identical with the `# pace:` line appended;
`check-daemon-safety.mjs` green; a run on the real empty book prints `DRY` then `IDLE → STOP` on
the second tick; mute → synthetic new offer → un-muted, fixture-pinned.

**AL3 — driver doctrine + docs reconciliation (prose, no code).**
Files: `CLAUDE.md` (`/loop` row), `pipeline/MONITORING.md` (§Cadence + the `/loop` paste lines),
`README.md` (`run-loop.mjs` entry), `docs/FLOW.md` if it names the loop. Replace every
`/loop <gcd>m node …run-loop.mjs` with the dynamic form and state the per-tick ScheduleWakeup rule;
grep-and-fix, not append (rule 8). Verification: `lint-docs.mjs` green; `lint-skills.mjs` green; a
grep for `/loop 15m node pipeline/commands/run-loop` returns only CHANGELOG/LORE.

**AL4 — event tighteners beyond the watch pass (optional, after AL1–3 measure).**
A cheap `offers.json` mtime / `positions.json` closed-count poll so a fill detected on a DEEP tick
snaps to `ACTIVE` without waiting for a full watch pass; and a `--dip` pool interaction test. Ship
only if AL2's measured tick log shows fills being noticed late (>1 tier interval) in practice.

**AL5 — auto-start doctrine (prose + skill hooks; needs AL1's `loopPresumedDead` + AL2's mute).**
Files: `.claude/skills/scan/SKILL.md`, `.claude/skills/positions/SKILL.md`,
`.claude/skills/morning/SKILL.md` (each gains ONE closing step: "book refreshed → if
`loopPresumedDead` and not muted and `pace().startable`, start the loop, report one line" — tagged
`judgment:` where `lint-skills` requires; `/scan`'s step additionally carries the picks-only
OFFER variant: book empty but picks survived → one line "start the loop when you place?", start
the turn Ben says "placed"), `.claude/skills/overnight/SKILL.md` (the explicit
NON-start note, R-AL-10), `CLAUDE.md` `/loop` row (one clause), `pipeline/MONITORING.md` §Cadence
(the trigger table's one home — the skills POINT there, never copy it). SKILL.md `version:` bumps,
no `APP_VERSION`. Verification: grep proves each named skill carries the hook and no skill copies
the table; `lint-skills.mjs` + `lint-docs.mjs` green.

## 6. Encoding boundary

| Rule | Disposition |
|---|---|
| Tier thresholds, ordering, one-tier-per-tick loosening, stop condition | ENCODE (`pace.mjs`, fixture-pinned) |
| "Deep bid touch cadence is days" — the 60m number | ENCODE as a named PLACEHOLDER constant; judgment stays on the VALUE (see §8) |
| Whether to actually stop / restart | JUDGMENT — the agent applies `stop`; Ben can always say "keep it running" (R-AL-2) |
| The pending reverse-flip does not hold the loop open | ENCODE (R-AL-4; fixture: `awaitingRebuy` alone → `IDLE`) |
| Driver rule (read `# pace:` → ScheduleWakeup) | PROSE in CLAUDE.md/MONITORING (the harness skill is not ours) — tagged `judgment:` per `lint-skills` if it lands in a project skill |
| Presumed-dead test, start tier = pace() (R-AL-8), mute/un-mute mechanics | ENCODE (`loopPresumedDead` + the same `pace()`; `--mute` flag + offer-key snapshot — fixture-pinned) |
| WHEN to auto-start (the trigger table), overnight exception | PROSE (MONITORING §Cadence, one home) — it fires inside agent turns, and Ben can always override either way |

## 7. Bookkeeping & compatibility

- README inventory entries for `pipeline/lib/loop/pace.mjs` and `pipeline/test/pace.test.mjs` in
  the AL1 commit; `run-loop.mjs` entry updated in AL2.
- `loop-state.json` is gitignored cache; the new fields are additive and a missing/old file
  degrades to `prevTier = null, idleTicks = 0` (fixture-pinned).
- No `APP_VERSION` bump (pipeline-only). Pipeline version bump in AL2's commit message.
- `check-daemon-safety.mjs` must stay green: `pace.mjs` imports nothing that can write; `run-loop.mjs`
  gains no scheduling/git calls.
- `lint-plan-refs.mjs --refs PLAN-ADAPTIVE-LOOP` before the fold-and-delete.

## 8. Honesty (process rule 4)

Every cadence number in §4 is a PLACEHOLDER: 60m for `DEEP` is chosen because a deep bid touches its
level on the order of days (`touched 3/14d`) and a fill is captured by the next sync regardless of
glance frequency — it is not measured against how quickly a missed fill costs money. `PACE_IDLE_TICKS = 2`
is a debounce, not a measurement. `PACE_DEAD_FACTOR = 2` is likewise a guess at "one missed wake is
a hiccup, two is dead" — a wrong value costs either a redundant tick 0 (too eager) or a late start
bounded by the next book-reading turn (too lax), both cheap. What would validate them: AL2's tick log (tier, reason, and whether
the next tick found a fill/alert) accrued over a few weeks — the "fill noticed N minutes after it
happened" distribution per tier. The plan accrues that data (the `recommend` record + closed-count
delta per tick); it does not yet consume it. The tiers speak to attention cost, not to P(fill) —
they must never be read as a fill-likelihood model (the `◆ asym` caveat applies: touched ≠ filled).
The tier LADDER is trigger-precedence order, not cadence order, so a quiet run-down's wake sequence
is deliberately non-monotonic (GLANCE 15m → DEEP 60m → DRY 30m on an emptying book) — the ladder is
pinned by fixture; don't "fix" the sawtooth by reordering tiers.

## 9. Verification summary

- AL1: fixtures listed above; import-list pin.
- AL2: golden stdout byte-identical plus the appended line; live empty-book run reaches STOP on tick 2;
  a synthetic offer file with one deep bid yields `DEEP → ~60m`; adding an alert to `watch.json`
  yields `ACTIVE` on the same tick (tightening is instant).
- AL3: grep-proven no stale fixed-cron paste line outside the dated record; CI doc lints green.
- AL5: grep-proven each named skill carries the auto-start hook and none copies the trigger table;
  `loopPresumedDead` boundary fixtures (AL1) + mute/un-mute fixture (AL2) green; a live dry-run —
  place one real bid with the loop stopped, run `/positions`, confirm the loop starts at the
  pace() tier in that same turn and reports one line.
- Adversarial review (CLAUDE.md rule 10): one pass briefed to attack the tier ordering (can a state
  ever LOOSEN past a live alert?), one pass scoped AWAY — the `--dip` and `awaitingRebuy`
  interactions, plus the auto-start edges (can mute + a stale snapshot start a loop Ben just
  stopped? can auto-start fire twice in one turn off two surfaces?).
