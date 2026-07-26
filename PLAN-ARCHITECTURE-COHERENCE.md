# PLAN-ARCHITECTURE-COHERENCE — closing the blurred lines/duplication/non-determinism gaps

Status: **PARTIALLY LANDED (salvage subset) — `ceb538b` (2026-07-25).** The cleanly-isolated chunks
landed off the salvage worktree; the entangled/capital-math chunks stay parked:
- **LANDED (`ceb538b`, pipeline-only, no APP_VERSION bump, CI checks+smoke green):** **chunk 1**
  (read-buy-limits `maxTs` via `reduce`, not `Math.max(...spread)` — a V8 ~65k-arg crash fix) · **chunk 5**
  (marketfetch `series()` caches the in-flight PROMISE not the resolved value → no concurrent double-fetch;
  `declare-thesis` gets the `argv[1] &&` import-safety guard) · **chunk 6** (new `pipeline/lib/paths.mjs`
  owns `REPO_DIR`; `derive-cash-tiers`/`cash-anchor` import it from the LIB not the `sync-fills` COMMAND —
  killing the lib→command layering inversion + the top-level side-effect; `sync-fills` re-exports it;
  dead-import sweep `fileURLToPath`/`HERE`/`fmtP`/`LOCAL`). README file inventory updated.
- **DEFERRED — preserved UNCOMMITTED on worktree `agent-a3e1ba12232696893`:** **chunk 2 / LH2.4** (the
  restart-blind SUSPECT-bid escrow — `offers.mjs` `suspects` array + `derive-cash` forcing a suspect BID to
  COMMITTED so locked-in-game gp can't read as deployable) and **chunk 3** (`collapseOffers` fresh-placement
  split on a restart-blind gap). Held back at owner request: chunk 2 changes capital-deployability math and
  wants its own review; both touch the reconstruction chain. Do NOT delete this file or that worktree until
  2/3 are resolved (landed or formally dropped).

Per-topic working doc (PLANNING.md lifecycle step 1–2); folds into `PLAN.md` and is deleted when its last
chunk resolves. Executor rules = PLAN.md "Executor rules", verbatim (also CLAUDE.md process rules 1–9).
**EXCLUDES** the grade/rank rework (owned by `PLAN-GRADE-REWORK.md` — `js/rating.mjs`,
`js/estimators/families.mjs`'s `rankScore`/`estimateRank`, `GRADE_CUTOFFS`, the digest `capEff`/
`rankKey`); those findings are cross-referenced only, never re-planned here.

## 1. The drift thesis

The codebase's own stated ideals — one-definition-per-concept, a flag>config>default composition
layer, pure stage separation (estimator/probe/gate/validator/render) — are **already substantially
built and honored**. The composition resolver (`pipeline/lib/compose.mjs`, PC1–PC3) exists and is
wired into all three read-surfaces; the render layer (`pipeline/lib/render.mjs`) is a real single
seam; the reach/window math has one home (`js/windowread.mjs`) that the calibration study
(`pipeline/lib/fill-placement.mjs`) explicitly delegates to rather than forking. This is NOT a
codebase that hasn't tried — it is one where the discipline holds for *designed* concepts but
leaks at the **operational seams that got added later, once, per-surface** rather than as a shared
primitive: the sync-before-read invocation (copy-pasted identically three times), a second
fetch-pool admission algorithm living beside the first with no automated parity check, and one
genuine, documented but under-surfaced wall-clock non-determinism (`Date.now()`-keyed exploration
rotation) whose effect on WHY a row appears is invisible to the reader. The pattern across all
three: **a good idea shipped as a per-surface inline block instead of a registered shared
primitive**, which is exactly the RC-B/RC-C anti-pattern `docs/ARCHITECTURE.md` already names —
just not yet caught here because no guard watches for it.

## 2. Inventory of inconsistencies

Each entry: the thing, evidence, which adjective(s) it violates, severity.

1. **The sync-before-read invocation is copy-pasted three times, byte-for-byte.**
   `pipeline/commands/screen-flip-niches.mjs:1729-1734`, `pipeline/commands/quote-items.mjs:503-508`,
   `pipeline/commands/watch-positions.mjs:584-588` each hand-roll an identical
   `execFileSync(process.execPath, [.../sync-fills.mjs], {...})` + try/catch + regex-filtered
   summary-line print + an almost-identical (screen/quote differ from watch by one regex clause:
   watch's also matches `^Pushed`) fallback message. **CLEAN/LOGICAL** — one operational concern
   (SY1, "always sync first") implemented three times instead of once; a future change to the sync
   invocation (a new flag, a different failure message, a timeout) must be hand-applied at three
   sites or silently drifts (watch's slightly different regex is already a hairline crack). **Not
   determinism-breaking today** (all three shell out to the same script), but it is the textbook
   "two homes" risk this repo's own `docs-small-encode-in-scripts`/one-home doctrine warns about.
   Severity: **medium** — cheap to fix, real drift risk, zero behavior change once fixed.

2. **Two independent fetch-pool ranking algorithms coexist with no automated parity check.**
   `pipeline/lib/gatecandidates.mjs`'s `rankAndSlice` (legacy) and `pipeline/lib/admission.mjs`'s
   `pickFetchPool` (default, `--admission legacy` reverts) both re-implement the
   thin-lane/rising-reserve/held-reserve selection shape independently — `admission.mjs` imports
   `proxyDrift`/`softFactor`/the reserve-size constants from `gatecandidates.mjs` (good, no
   constant duplication), but the SELECTION LOGIC ITSELF (which candidates get a reserve slot, in
   what order, sliced how) is two separate functions with two separate test suites, not one
   function with a strategy switch. **FLEXIBLE** (the `--admission` flag IS a clean
   flag-driven swap — this is the pattern working correctly) but **CLEAN/LOGICAL** flagged: a
   future gate-stack change (e.g. a new reserve category) must be applied to both functions or the
   `legacy` fallback silently diverges further from `unified` every time only one is touched.
   `rankAndSlice` is kept deliberately as a fixture/golden-pinned rollback (`admission.mjs`
   header says so explicitly) — this is a **documented, deliberate** dual-path, not silent drift,
   but it has no expiry condition or "when does legacy get retired" note anywhere. Severity:
   **low-medium** — working as designed, but open-ended; worth a documented sunset trigger, not a
   structural fix.

3. **The exploration-reserve rotation is a genuine, wall-clock-keyed non-determinism with no
   reader-facing marker.** `pipeline/lib/admission.mjs:82-89` (`pickExploration`) buckets
   `Date.now()` into `ROTATE_MS` (30 min) windows to decide WHICH gated-but-excluded candidates get
   an exploration slot (`admission.mjs:142-152`). This is **intentional and documented** ("a
   deterministically-ROTATING exploration reserve" — the header is honest about it), and it is
   deterministic *within* a 30-minute bucket, but it means: **the same market state, screened
   twice, 31 minutes apart, can surface a different candidate set** — a property no other part of
   this pipeline has (every other selection is a pure function of fetched data). **DETERMINISTIC**
   violation, by design, but two gaps follow from it: (a) `now` defaults to `Date.now()` inside the
   function rather than being required at the call site, so a fixture/test that doesn't pass `now`
   explicitly gets real-wall-clock behavior — verify `admission.test.mjs` always injects `now`
   (E6 replay-golden risk if it doesn't); (b) survivors admitted via `exploredThin`/
   `exploredVelocity` (`admission.mjs:148,152`) carry NO distinguishing marker before being spread
   into `survivors` (`admission.mjs:154`) — so a row that appears ONLY because this was its
   30-minute exploration turn is indistinguishable, in the output, from a row that genuinely
   ranked in. This is an **actionability/honesty gap** (memory `actionable-first-dead-last`/
   `output-format-compact-lines`'s spirit: don't let the reader mistake a lottery slot for a
   ranked pick), not a decision-correctness bug. Severity: **medium** — no live-price impact
   (exploration only affects the FETCH pool, never the priced/ranked table a reader acts on
   directly… **verify this claim** — confirm no code path renders an `exploredThin`/
   `exploredVelocity` row into the final table without going through the SAME per-mode
   rate/gate/render pipeline every other survivor does; if confirmed, downgrade this entry's
   severity to low/cosmetic in the implementing chunk).

4. **The probe stage `'gate'` is declared in the type contract but has no implementation or
   consumer.** `pipeline/lib/probes.mjs:14-19`'s stage table lists `'gate'` with a `(FUTURE)`
   tag and a `(phase-rescue)` placeholder seed-probe name, and `STAGES` (`probes.mjs:87`) includes
   `'gate'` in the validated set — but `pipeline/probes/` has no gate-stage file, and
   `surviveMode`'s actual phase-rescue logic lives inline in `gatecandidates.mjs:394-399`, not as
   a registered probe. This is explicitly labeled FUTURE in the header, so it is **not** the
   RC-B "declared-but-unread field" anti-pattern (nothing claims it's wired) — but it is a
   half-built seam that a future reader could mistake for live. **CLEAN/LOGICAL**, cosmetic.
   Severity: **low** — a one-line doc clarification, not a code chunk (see §8).

5. **Screen's docs describe validators as universally "annotate-never-hide," but the actual
   hide/show decision is externalized per-thesis, in a way that isn't obvious from `validate.mjs`
   alone.** `docs/ARCHITECTURE.md`'s one-home table calls `js/validate.mjs` "pure `(ctx) →
   {status, reason, evidence}`" and separately (correctly) says "Screens DROP reject + FLAG
   caution + SHOW inform notes" — these two statements are NOT contradictory once you also read
   `runValidators(ctx, {specs})`'s gate-vs-inform dispatch (`validate.mjs`, per-thesis `specs` from
   `js/flip-niches.mjs`), but a reader who only skims the one-home table's one-line description
   could conclude `validate.mjs` itself hides rows. **Verified NOT a bug** — the layering is
   real and intentional (validator computes, caller-per-spec decides gate vs inform) — but the
   one-home table's `validate.mjs` row doesn't say so, unlike its neighbors. Severity: **low**,
   docs-only clarification, folded into the chunk-1 docs pass rather than its own chunk.

6. **`suggestions.jsonl`'s shadow-field surface has grown to ~15 independently-named optional
   objects with no registry, only a running README paragraph.** (`volSrc`, `askHeadroom`,
   `depthExit`, `reachable`, `demandRegime`, `expGpDay`/`expGpDayLegacy`, `winClear`, `windowExit`,
   `capEff`/`weakDeploy`, `asym`, …, per `README.md`'s `suggestions.jsonl` entry, ~50 lines long.)
   Each is individually well-documented (producer, consumer, honesty notes) and each was added
   additively (byte-identical-when-absent) — this is **not** duplication or non-determinism, and
   the per-field discipline is good. But there is no single **schema registry file** (e.g. a
   `pipeline/lib/suggestlog.mjs` header table of `{field: {shape, producer, consumer, since}}`) —
   the only registry is prose scattered across the README entry and `suggestlog.mjs`'s own header.
   **NO UNNECESSARY PROSE** — this is the closest thing in the repo to "a concept the code could
   express as a table but currently only expresses as a paragraph." Severity: **low** — a doc/
   structure nicety, not a bug; candidate for a light touch-up, not a dedicated chunk (see §8's
   "not scheduled" list).

7. **`docs/ARCHITECTURE.md`'s E8/E9 guards are still `(proposed)` with no target date, and this
   plan's own findings (#1, #3) are exactly the class E9 (app-import/blast-radius drift) and a
   general "convention with no checker" pattern would catch.** Not a contradiction (the doc is
   honest that they're proposed), but worth noting: **CLEAN/LOGICAL** — the mechanism to prevent
   future recurrences of finding #1's class (a rule duplicated instead of centralized) is already
   designed (E8, "tax/break-even math has exactly ONE home… a check outside quotecore/money-math")
   but the analogous check for "an operational block copy-pasted across command files" has no
   proposed guard at all. Severity: **informational** — an open question for §7, not a finding
   requiring its own chunk.

## 3. What this audit did NOT find (explicitly, to avoid inventing problems)

- **The composition layer is not "implicit and inconsistent"** — `pipeline/lib/compose.mjs` (PC1)
  is a real, documented, tested resolver; `--mode`/`--vol-source`/`--asym`/`--pressure-exit`/
  `--est-sell` are ALL routed through it in all three read-surfaces (verified by direct grep of
  `screen-flip-niches.mjs`, `quote-items.mjs`, `watch-positions.mjs`). `PLAN-REACH-CALIBRATION.md`'s
  PC1–PC3 chunks already shipped this (commits `ad7b3ec`, `97e0262`). No chunk needed here.
- **No estimator was found doing gate work, no validator found mutating state, no probe found
  touching a verdict/gate/rating** — `pipeline/lib/probes.mjs`'s empty-passthrough + PURE-w.r.t-ctx
  contract is honored by all four live probes (`anchor`/`decant`/`froth`/`dip`, all `observe`- or
  `price`-stage only).
- **The reach/window math has one home** — `js/windowread.mjs` owns `windowStats`/`reachedDays`/
  `placement`; `pipeline/lib/fill-placement.mjs`'s `cdf` explicitly DELEGATES to `placement` (per
  `PLAN-REACH-CALIBRATION.md` AC4, confirmed in that plan's own text) rather than forking the math.
  No duplication chunk needed.
- **The grade/rank incommensurability (three competing rankings)** is real but is
  `PLAN-GRADE-REWORK.md`'s G1–G6 — not re-planned here; if an implementer works both plans in the
  same wave, sequence GRADE-REWORK's G1 before anything in this plan touches `screen-flip-niches.mjs`'s
  render loop, since G1 also edits the capGrade call site this plan's chunk A leaves untouched.
- **The safe-quantile reach-calibration gap** is `PLAN-REACH-CALIBRATION.md`'s AC3–AC6 (currently
  gated — AC1's replication check came back NOT MET) — not re-planned here.

## 4. The honesty core (process rule 4 — read before touching any chunk)

1. Every chunk below is a **behavior-preserving refactor** unless explicitly flagged otherwise.
   None changes a gate threshold, a rank formula, or a rendered number.
2. Chunk A (dedup the sync invocation) must produce **byte-identical stdout** for the sync summary
   line and the fallback message on all three surfaces — prove it with a diff, not an assertion.
   Watch's extra `^Pushed` regex clause is a genuine behavioral difference between surfaces today;
   the dedup must EITHER preserve it as a per-caller option OR the implementer must confirm with
   Ben that unifying it (screen/quote gain the `^Pushed` match too — harmless, since neither
   publishes from this call path) is acceptable, and say so in the commit — never silently drop it.
3. Chunk B (admission legacy sunset note) and Chunk C (exploration marker) touch **no numbers** —
   B is a doc-only addition of a sunset condition; C adds a non-rendered-by-default marker field
   that existing renderers ignore unless explicitly consumed (see chunk C acceptance).
4. Nothing here claims the two admission algorithms should be MERGED — that is a bigger, riskier
   reorg (screen-architecture-level) that the repo's own `PLAN-SCREEN-ARCHITECTURE.md` owns if it's
   ever proposed; this plan only asks for an explicit sunset condition on the rollback path,
   not its removal.

## 5. Chunks

Ordered cheapest/safest-determinism-and-dedup-wins first.

### AR1 — dedup the sync-before-read invocation into one shared helper
**Changes:** new `runLocalSync({ label })` (or similarly named) function — recommend
`pipeline/lib/sync-invoke.mjs` (new, tiny, node-only file; NOT app-imported) — wrapping the
`execFileSync(process.execPath, [sync-fills.mjs path], {...})` + try/catch + regex-filtered
summary print, with the fallback-message text and the exact regex (union of screen/quote's
`^positions:|nothing to` and watch's `^positions:|^Pushed|nothing to`) as parameters or a single
shared regex (resolve per honesty-core item 2). Replace the three inline blocks
(`screen-flip-niches.mjs:1729-1734`, `quote-items.mjs:503-508`, `watch-positions.mjs:584-588`)
with one call each.
**Acceptance:** `node --check` all four touched files; a synthetic/mocked `execFileSync` fixture
(or a real local run against the current `sync-fills.mjs` with no fills to sync) proving each
surface's printed sync line is byte-identical before/after; `pipeline/ci/check-imports.mjs` passes
(new file's export is actually imported by all three).
**Docs:** README's `sync-fills.mjs` inventory entry — note the shared invocation home; `pipeline/
FILLS-PIPELINE.md` if it names the per-surface invocation anywhere (grep it first).
**APP_VERSION:** no bump — all three call sites are pipeline-only (Node CLIs), no app import.

### AR2 — document the admission legacy-path sunset condition
**Changes:** doc-only. `pipeline/lib/admission.mjs`'s header, plus `docs/ARCHITECTURE.md`'s
one-home table (`gatecandidates.mjs`/`admission.mjs` aren't currently listed there — add a row) —
state explicitly: `rankAndSlice` (legacy) stays only as a golden/fixture-pinned rollback path
selectable via `--admission legacy`; name the condition under which it can be deleted (e.g. "once
`pickFetchPool` has run as default through N weeks of `/scan` with no reported regression" — Ben's
call, phrase as a placeholder trigger, not a hard date). Cross-reference this plan's finding #2.
**Acceptance:** none (docs-only); `pipeline/ci/lint-arch.mjs` still passes (no new file-path claim
that doesn't resolve).
**APP_VERSION:** none.

### AR3 — mark exploration-admitted rows so the render layer CAN distinguish them (opt-in, non-rendering by default)
**Changes:** `pipeline/lib/admission.mjs` — tag `exploredThin`/`exploredVelocity` entries with a
non-enumerable-in-JSON-by-default marker, e.g. `{ ...c, via: 'explore' }` (spread order matters:
apply AFTER the existing spreads so it can't be clobbered), analogous to how `excluded` entries
already carry a `reason` (`admission.mjs:160`). Do NOT wire it into any renderer in this chunk —
this chunk only makes the fact available; a follow-up (unscheduled, Ben's call) decides whether
`screen-flip-niches.mjs`'s table ever surfaces it (e.g. a small `⚡` marker beside an
exploration-admitted row, mirroring the existing `⚡flushing-now` dip-pool convention).
**Acceptance:** fixture in `pipeline/test/admission.test.mjs` (exists) asserting (a) a
non-exploration survivor carries no `via` field (byte-identical shape to today); (b) an
exploration-admitted survivor carries `via:'explore'`; (c) `JSON.stringify` of a full `pickFetchPool`
result is unchanged for a fixture with `exploreReserve:0` (today's effective behavior when
exploration is disabled). Also add/confirm a fixture pins that `pickExploration`'s `now` is ALWAYS
explicitly supplied in every existing test (audit `admission.test.mjs` for a bare call relying on
the real clock — fix if found, since that is a live E6-golden flakiness risk independent of this
chunk's own change).
**Docs:** `admission.mjs` header — one line noting the marker exists and is currently unconsumed
(so a later renderer chunk isn't a surprise); this plan's finding #3 resolved-to-"marker added,
render-consumption deferred."
**APP_VERSION:** none (pipeline-only; no render change in this chunk).

### AR4 — one-home-table entries for gatecandidates.mjs/admission.mjs + validate.mjs clarification
**Changes:** `docs/ARCHITECTURE.md`'s "one-home rule" table — add a row for "fetch-pool admission
(screen)" → `pipeline/lib/admission.mjs` (`pickFetchPool`, default) / `pipeline/lib/
gatecandidates.mjs` (`rankAndSlice`, `--admission legacy` rollback, see AR2's sunset note). Extend
the existing `validate.mjs` row's "Notes" cell to state explicitly that gate-vs-hide is a
PER-THESIS caller decision (`runValidators`'s spec-driven dispatch), not something `validate.mjs`
itself does — resolving finding #5 without implying a code change (there isn't one; the layering
was already correct, only the doc's terseness was ambiguous).
**Acceptance:** `pipeline/ci/lint-arch.mjs` passes (every named path still resolves).
**APP_VERSION:** none.

## 6. Registry / ripple map

| Concept | Home (after this plan) | Every consumer |
| --- | --- | --- |
| Sync-before-read invocation | `pipeline/lib/sync-invoke.mjs` (new, AR1) | `screen-flip-niches.mjs`, `quote-items.mjs`, `watch-positions.mjs` |
| Fetch-pool admission (default) | `pipeline/lib/admission.mjs` (`pickFetchPool`) | `screen-flip-niches.mjs` (only consumer today) |
| Fetch-pool admission (legacy rollback) | `pipeline/lib/gatecandidates.mjs` (`rankAndSlice`) | `screen-flip-niches.mjs` under `--admission legacy`; ALSO still the sole selector for reserve-size constants (`THIN_RESERVE_DEFAULT` etc.) both files import |
| Probe stage contract | `pipeline/lib/probes.mjs` (`STAGES`) | `pipeline/probes/*.mjs` (observe/price only, live); `'gate'` stage documented FUTURE, no file yet |
| Composition precedence (mode/volSource/sellModel/asym/phaseRescue) | `pipeline/lib/compose.mjs` (`resolve`) | all three read-surfaces (already true; no change here) |

No implementer should need to touch more than the files named per chunk above — that's the point
of naming the ripple map before, not after.

## 7. Open questions / decisions for the owner (list only — don't action unprompted)

- **O1 — AR1's regex unification.** Should the shared sync-invoke helper adopt watch's `^Pushed`
  match for all three surfaces (harmless — screen/quote never publish via this call path — but a
  behavior change to their fallback-message matching), or keep a per-caller regex parameter and
  literally preserve today's three-way difference? Recommend unify (simpler, harmless); confirm.
- **O2 — AR2's sunset trigger wording.** What's the actual condition for deleting `rankAndSlice`
  as a rollback path — a time-based one (N weeks), an evidence-based one (a join-outcomes check
  showing `unified` non-regressive), or "keep indefinitely, it's cheap"? Recommend evidence-based
  (mirrors this repo's F1-gating discipline elsewhere) but it's a judgment call, not a technical one.
- **O3 — AR3's follow-up render consumption.** Once the `via:'explore'` marker exists, should
  `/scan`'s table actually surface it (a small marker glyph), or is "the data exists for an agent
  to notice on request" sufficient? Not decided here; flagged so it isn't silently forgotten the
  way finding #3 describes.
- **O4 — Finding #6 (suggestions.jsonl schema registry).** Worth a dedicated small chunk (a header
  table in `pipeline/lib/suggestlog.mjs` listing every shadow field + producer + consumer, replacing
  the scattered README prose with a pointer TO that table) or leave as-is? This plan does not
  schedule it — recommend a small opportunistic touch next time `suggestlog.mjs` is edited for
  another reason, not a standalone chunk given its low severity.

## 8. Hand-off notes for the Opus implementer

- **Recommended first chunk: AR1.** Purely mechanical (three copies → one shared function), the
  smallest surface area, and it removes the one place a future edit is most likely to silently
  fork behavior across surfaces (exactly the class of drift this whole plan is about).
- **AR2 and AR4 are docs-only — land together, quickly**, since they touch the same
  `docs/ARCHITECTURE.md` file (avoid two near-simultaneous edits to the same doc landing out of
  order).
- **AR3 is the only chunk with new (if unconsumed) data shape** — keep it inert (no renderer
  reads `via` yet) so it can't regress any table's output; the acceptance fixture's
  `JSON.stringify`-unchanged-at-`exploreReserve:0` check is the byte-parity proof for the common
  case (exploration effectively off).
- **Validation discipline (CLAUDE.md process rule 2):** `node --check` every touched file;
  `node pipeline/ci/run-tests.mjs`; `pipeline/ci/check-imports.mjs` after AR1 (new shared module);
  `pipeline/ci/lint-arch.mjs` after AR2/AR4 (new doc references must resolve). No chunk here
  touches `js/` app-imported modules, so no `serve.cmd`/Playwright smoke pass is required by this
  plan's own chunks — but confirm that's still true at implementation time (re-check the file list
  above before skipping the browser check).
- **Fold-out discipline.** When AR1–AR4 (or whichever subset the owner approves) all ship, fold
  this file's chunks into `PLAN.md`'s Status table with their shas and DELETE this file, per the
  standing per-topic-plan convention.

## 9. Minimum shippable

AR1 alone is a real, low-risk dedup win (removes the three-way copy-paste, the single clearest
"one concept, three homes" violation this audit found). AR2/AR4 are cheap doc-clarity wins that
can land in the same sitting. AR3 is optional/independent — skip it entirely if the owner judges
the exploration-marker gap too minor to act on now; nothing else in this plan depends on it.
