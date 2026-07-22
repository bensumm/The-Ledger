# PLAN-REMOVE-DEPTH-PRESSURE-READS

Per-topic working doc (PLANNING.md lifecycle). Ben's decision (verbatim): *"Remove reads and
fixtures and note their removal in a standalone commit, we can revive them later if needed."*
Drafted by the Fable review agent (2026-07-22) off an actual repo grep pass — **it corrects a stale
claim** in `docs/SIGNAL-AUDIT.md` §36 and `PLAN-SIGNAL-RECENCY.md` R8, which both describe
`clearableAsk`/`reachableBand` as "inspector-only" when they've had LIVE shadow-log consumers since
2026-07-15 (RC-S1/RC-S2/DE3).

**STATUS: chunks 1–3 (NARROW) EXECUTED 2026-07-22** — Ben chose narrow. Chunk 4 (broad — remove the pressure
sell-model + Gate B too) DECLINED for now; kept below as the documented future option (via RC1's retire flag).

## 1. What "the reads" are
| Symbol | Defined (js/windowread.mjs) | Nature |
|---|---|---|
| `depthDays` | ~680 | per-day flow-beyond-a-level table (DE1) |
| `clearableLevel` (internal) | ~707 | shared engine behind clearableAsk/Bid |
| `clearableAsk` | ~743 | DE1 high-side percentile-depth price |
| `clearableBid` | ~754 | DE6 low-side mirror |
| `demandPressure` | ~799 | buy/sell volume-ratio + reliability |
| `reachableBand` | ~817 | PB1 two-sided pressure-driven reachable price |
| `hourlyPressure` | ~1143 | DC1 per-hour demand-cycle track |
| `demandRegime` | ~1192 | DC1/DC3 per-hour regime classifier |
| `PRESSURE_PHI_SLOPE`/`PRESSURE_MIN_VOL`/`PRESSURE_HEADROOM_MAX` | ~787-789 | placeholder constants |

## 2. Consumer inventory (the load-bearing part)
- **`depthDays` — clean.** Only `read-window-range.mjs --depth` + windowread tests + docs. Deletable.
- **`clearableBid` — clean.** Only `read-window-range.mjs --depth` "CATCH AT ≥X" + tests + docs. Deletable.
- **`clearableAsk` — ENTANGLED.** Also a LIVE shadow: `quote-items.mjs:451,680` (`depthExit` on
  `--positions`), `watch-positions.mjs:727` (every held lot), `emit.mjs depthReachClause`,
  `suggestlog.mjs depthExit` field (DE3 shadow, one of Gate B's five challengers). Not console-only.
- **`demandPressure` — internal dep.** `reachableBand`'s + `hourlyPressure`'s ratio engine. Not
  independently removable while `reachableBand` survives.
- **`reachableBand` — THE BIG ONE.** Powers the PRESSURE sell-model (`js/estimators/sell-models/pressure.mjs`,
  `--est-sell pressure`/`--pressure-exit` across quote-items/watch-positions/screen-flip-niches, and
  reranks the console scan), the live `reachable` shadow field, and is the **SOLE marker**
  `join-outcomes.mjs:147` (`coLog: best.reachable != null`) uses to gate the weekly **Gate B —
  Reachability head-to-head** dashboard the `/morning` skill reads. Removing it kills a working CLI
  feature + zeroes Gate B.
- **`hourlyPressure` — clean-ish.** No live shadow consumer; internal to `demandRegime`. Removable with it.
- **`demandRegime` — live shadow, but orthogonal.** `screen-flip-niches.mjs` DC3 `demReg` inform + a
  `suggestlog.mjs demandRegime` schema field. NOT part of Gate B's marker (that keys off `reachable`).
  Removable independent of the reachableBand decision, but touches a live schema field + test.
- **`PRESSURE_*` constants** — `reachableBand`'s tuning surface; can't go while it stays.

## 3. The decision (Ben's call)
**Clean-cut, safe under any reading:** `depthDays`, `clearableBid`, `hourlyPressure`, `demandRegime`
(+ their inspector blocks, the DC3 shadow field, and the demand-cycle tests).

**Entangled — a real decision, not a mechanical cleanup:** `clearableAsk` + `reachableBand`
(+ `demandPressure` + `PRESSURE_*`). These aren't inert reads — they're the live price source for a
working opt-in feature (the PRESSURE sell-model) and the accrual marker for a dashboard Ben reads weekly.

**Fable's recommendation: NARROW removal.** Delete the clean-cut four; KEEP `clearableAsk`/
`reachableBand`/`demandPressure`/`PRESSURE_*`. Deleting the latter wouldn't retire dead code — it would
silently kill `--est-sell pressure` and zero Gate B mid-flight, a feature regression rather than a
dead-read cleanup. Their retirement already has an intended mechanism (`PLAN-REACHABILITY-CONSOLIDATION`
RC1's retire flag), gated on the head-to-head accrual — use that later, not this cleanup.

## 4. Phased chunks
- **Chunk 1 — retire DE1/DE6 depth (`depthDays`, `clearableBid`).** Delete both; trim `clearableLevel`'s
  bid-only path (KEEP the ask path — `clearableAsk` survives); remove `--depth` askFlow/bidFlow tables +
  the "CATCH AT ≥X" block (KEEP "BOOK AT ≤X"); delete their windowread tests (inline literals, no fixture
  files). `check-imports` + suite green.
- **Chunk 2 — retire Extension-B demand-cycle (`hourlyPressure`, `demandRegime`).** Delete both; remove the
  `--pressure` DC2 per-hour block (KEEP the base ratio/band lines); remove `screen-flip-niches.mjs` DC3
  `demReg` import/compute/row-field/shadow; remove `demandRegime` from `suggestlog.mjs` (param + schema +
  doc); delete the DC1/DC3 tests. Historical `suggestions.jsonl` rows keep their field (append-only, YS2).
- **Chunk 3 — doc reconciliation** (own commit, refs the code SHAs): SIGNAL-AUDIT rows §33/§36 + "Dead
  signals" §252-264 (fix the stale clearableAsk claim); read-window-range header; README inventory §108-123
  + §599-605; PLAN-DEPTH-EXIT archival status note; PLAN-SIGNAL-RECENCY R8 → RESOLVED (correct its stale
  "inspector-only" framing). Under NARROW: PLAN-REACHABILITY-CONSOLIDATION + /morning Gate B untouched.
- **Chunk 4 — OPTIONAL, broad reading only (Ben's explicit "yes the pressure model too").** Remove
  `clearableAsk`/`reachableBand`/`demandPressure`/`PRESSURE_*`, the pressure sell-model + its CLI flags
  across 3 commands, the `depthExit`/`reachable` shadow fields + `emit.mjs depthReachClause`, and
  RETIRE/redefine Gate B via RC1's retire flag (+ the /morning skill + PLAN-REACHABILITY-CONSOLIDATION
  rewrite). Materially larger; touches a working feature + a weekly dashboard. NOT default.

## 5. Risk / invariants
- `node pipeline/ci/check-imports.mjs` (green: 402 imports/11 entrypoints) + the full suite must pass
  after each chunk; delete a function and its tests together.
- Do NOT touch `clearableLevel`'s ask-side branch (still `clearableAsk`'s engine).
- No archive-in-place: full deletion, git history is the revival path (Ben's framing). Two code commits
  (depth, then demand-cycle) + one doc commit, each single-concern for a clean `git revert`.
- The stale-doc find is load-bearing: if Chunk 3's doc pass is skipped, the next reader repeats the wrong
  "clearableAsk is dead" assumption and could delete a live shadow — the exact failure this plan prevents.
