# PLAN-CLEANUP-SKILL — a repeatable post-wave hygiene + architectural-integrity pass

Status: **LANDED (core) — `5fea8bd`…`5f3ac4b` (2026-07-26).** The `/cleanup` skill
(`.claude/skills/cleanup/SKILL.md` v1.0) + its two non-gating report guards
(`pipeline/ci/lint-plan-lifecycle.mjs`, `pipeline/ci/report-branches.mjs`) + fixture-pinned tests
shipped; `lint-skills.mjs` now covers `cleanup` + `analyze`. **ONE chunk remains (C11 tail):**
tag the rule-blocks in `book`/`schedule`/`ship` SKILL.md and add them to `SKILL_FILES` (they carry
4/5/9 untagged blocks — needs per-skill judgment, deferred). `lint-plan-lifecycle.mjs` keeps them
visible until done. Do NOT delete this doc until that tail ships. Per-topic working doc
(`docs/PLANNING.md` lifecycle); folds into `PLAN.md` when C11 closes. Every claim below is a direct
`file:line` read, verified 2026-07-25.

## 0. What this is, in one line

A new `/cleanup` project skill (`.claude/skills/cleanup/SKILL.md`) that runs AFTER a large
feature session or a shipped wave, orchestrates the CI guards the repo already has, adds a small
number of new committed scripts for the checks those guards don't cover, and spends LLM tokens
**only** on the parts that are irreducibly judgment (reading a diff for intent, deciding whether
a worktree's deferred work is still wanted, deciding whether a comment narrates history).

---

## 1. Goals (each tied to one of Ben's 8 coverage areas)

| # | Goal | Coverage area |
| --- | --- | --- |
| G1 | Confirm the stated architectural ideals (one-definition-per-concept, flag>config>default composition, pure stage separation, lib→command layering, 🔒 vs ⚖️) still hold, and name where they've drifted | 1 |
| G2 | Surface duplicated logic / parallel implementations with no parity check (the "two homes" pattern) | 2 |
| G3 | Flag orphaned/dead code: unused exports, unreachable spec branches, stale fixtures, abandoned files not in the README inventory | 3 |
| G4 | For every finding in G1–G3, propose a concrete, scoped fix (not just a flag) — sized as a `docs/PLANNING.md`-shaped chunk | 4 |
| G5 | Review worktrees + branches: confirm which are stale (ancestor-of-main / squash-landed per `PLAN.md`) vs deliberately-deferred (a `PLAN-*.md` says so), and catch orphan untracked artifacts | 5 |
| G6 | Doc sanity: catch prose bloat, doc-drift/duplication beyond what `lint-docs.mjs` denylists, and code comments that narrate HISTORY instead of describing CURRENT state | 6 |
| G7 | Gap analysis: missing guards, missing tests, missing README inventory entries, `PLAN-*.md` files that should have folded/deleted already | 7 |
| G8 | Keep `/cleanup` itself cheap and repeatable — every mechanical check runs as a deterministic script, never a hand-authored one-off | the hard requirement |

---

## 2. Capability inventory — the heart of the "cheap + repeatable" requirement

Legend: **MECH** = deterministic script/CI guard, ~0 LLM tokens beyond reading its output.
**JUDG** = reserved for the agent, tightly scoped. Token costs are rough orders of magnitude for
an Opus-class pass reading the check's *output*, not re-deriving it.

| # | Check | MECH/JUDG | Existing script reused (file:line) OR new script (see §3) | Token cost |
| --- | --- | --- | --- | --- |
| C1 | Imports resolve against real exports | MECH | `pipeline/ci/check-imports.mjs` (whole file; entrypoint list `check-imports.mjs:32-36`) | ~0 (pass/fail line) |
| C2 | No export kept alive only by its own test (RC-A vestigial code) | MECH | `pipeline/ci/check-dead-exports.mjs` (whole file; `@test-only`/`@provisional-api` exemption at `check-dead-exports.mjs:110-122`) | ~0 |
| C3 | No local/auto-runnable daemon imports/shells the git-writer | MECH | `pipeline/ci/check-daemon-safety.mjs` (whole file) | ~0 |
| C4 | Every SKILL.md rule-block is tagged (`code-pointer` or `judgment:`) | MECH | `pipeline/ci/lint-skills.mjs` — **but only for the 4 files in `SKILL_FILES`** (`lint-skills.mjs:42-47`: scan/positions/overnight/morning). `analyze`, `book`, `schedule`, `ship`, and the new `cleanup` skill are NOT covered today. | ~0 (+ see NS1 below) |
| C5 | Denylisted superseded terms don't resurface; no verbatim-duplicated ruling across the CLAUDE.md⇆README axis | MECH | `pipeline/ci/lint-docs.mjs` (whole file; `POINTER_DOCS` scope `lint-docs.mjs:47-50`, deliberately excludes PLAN/CHANGELOG/LORE/module headers/SKILL.md) | ~0 |
| C6 | Every `docs/ARCHITECTURE.md`/`docs/GLOSSARY.md` code-font file reference resolves on disk | MECH | `pipeline/ci/lint-arch.mjs` (whole file; `DOCS` list `lint-arch.mjs:27`) | ~0 |
| C7 | Every `*.test.mjs` suite passes | MECH | `pipeline/ci/run-tests.mjs` (whole file) | ~0 |
| C8 | Browser app loads/paints with no console error (deployed-app changes only) | MECH | `pipeline/ci/smoke-test.mjs` (whole file) — run only if the session touched an app-imported module (see `docs/ARCHITECTURE.md:94-96`'s app-imported list) | ~0 |
| C9 | Full CI suite green, in one shot, matching `.github/workflows/checks.yml` | MECH | orchestrate C1–C7 via the exact step list in `.github/workflows/checks.yml:24-61` (no new script — this is just "run what CI runs, locally, first") | ~0 |
| C10 | Which `PLAN-*.md` files exist at repo root, and are any past their fold-in point (their own Status line says LANDED/DONE but the file wasn't deleted) | MECH | **new**: `pipeline/ci/lint-plan-lifecycle.mjs` (§3.1) | ~0 |
| C11 | Which SKILL.md files exist vs which are in `lint-skills.mjs`'s `SKILL_FILES` (drift in the linted set itself) | MECH | **new**: fold into lint-plan-lifecycle.mjs or a 5-line check inline in the skill's own script (§3.1) | ~0 |
| C12 | Branch/worktree staleness classification (ancestor-of-main vs not; tip sha vs `PLAN.md`'s Status table shas) | MECH (data gather) + JUDG (verdict on ambiguous cases) | **new**: `pipeline/ci/report-branches.mjs` (§3.2), NOT wired into CI (it's a report tool for `/cleanup`, not a gate) | ~0 gather, small JUDG per ambiguous branch |
| C13 | Orphan untracked artifacts (files `git status` shows as `??` that aren't a known gitignore-expected artifact) | MECH | `git status --porcelain` + the README "Root data artifacts" / gitignore tables as the known-list — **no new script needed**, this is one `git` command plus a lookup against README's own tables (already machine-readable as markdown tables; a future refinement could script the cross-check, see NS2) | ~0 |
| C14 | A concept implemented in >1 place with no automated parity check (the two-homes pattern) | JUDG, scoped | none — this is exactly what `PLAN-ARCHITECTURE-COHERENCE.md` did by hand; scope the agent's grep to files touched THIS session/wave (git diff, not the whole repo) | medium (bounded by diff size) |
| C15 | Unreachable / declared-but-unread spec branches (RC-B: a config field set but no code reads it) | JUDG, scoped | none — `docs/ARCHITECTURE.md:167-169` names this as a "possible future add" for a generic unread-field lint; until it exists this stays judgment, scoped to specs touched this session | medium |
| C16 | Stale/abandoned fixtures (a `pipeline/test/fixtures/*` file no test reads) | MECH (candidate detection) + JUDG (confirm intentional) | **new**: `pipeline/ci/check-dead-exports.mjs`-style scan is NOT the right tool (fixtures aren't exports); simplest is grep-for-basename across `pipeline/test/*.test.mjs` — cheap enough to leave as a one-line `grep`/`Grep`-tool call in the skill runbook, not worth a dedicated script (see §7, "too thin to mechanize") | small |
| C17 | README "Map of the repo" inventory completeness (every NEW file this session has an entry) | JUDG, scoped | none — requires knowing intent (is this file's purpose captured accurately), not just presence; scope to `git diff --stat` of the session/wave | small–medium |
| C18 | 🔒 vs ⚖️ invariant table in `docs/ARCHITECTURE.md` still matches reality (a `(proposed)` guard that actually shipped, or an 🔒 row whose guard was deleted) | JUDG, scoped | cross-check the invariant table (`docs/ARCHITECTURE.md:50-64`) against `pipeline/ci/*.mjs` file existence — the EXISTENCE half is mechanizable (does the named guard file exist), the "does it actually enforce the described rule" half is judgment | small |
| C19 | Code-comment / doc-hygiene rubric (current-state vs history-narrating, prose bloat) | JUDG, scoped | none — see §6 for the rubric; scoped to files touched this session, not a repo-wide sweep | medium |
| C20 | Gap analysis: missing guards / missing tests / plan docs overdue for fold | JUDG (synthesis over C1–C19's output) | none — this is a synthesis step over everything above, not a new check | small |

**Total mechanical checks: 13 (C1–C13). Total judgment checks: 7 (C14–C20), every one explicitly
scoped to the session/wave diff, never a cold repo-wide re-audit** — that scoping is what keeps
the judgment half cheap on a repeat run (see §5, step 3).

---

## 3. New scripts/guards to build (for a later Opus implementer — none built here)

### 3.1 `pipeline/ci/lint-plan-lifecycle.mjs` (covers C10 + C11)

**Why no existing guard covers it:** `lint-arch.mjs` checks that files ARCHITECTURE.md/GLOSSARY.md
*name* resolve on disk — the inverse problem (a `PLAN-*.md` file that exists on disk but should
have been deleted per its own Status line) has no guard. `docs/PLANNING.md:15-16` states the rule
("per-topic `PLAN-*.md` files … folded + deleted the moment their last chunk ships") but nothing
checks it — confirmed by grep: no script in `pipeline/ci/` reads `PLAN-*.md` filenames. Evidence
this actually happens: `PLAN-ARCHITECTURE-COHERENCE.md:3-4` self-reports "PARTIALLY LANDED" and
is explicitly kept alive on purpose (deferred chunk) — a GOOD case the guard must not flag; a
`PLAN-*.md` whose Status line instead says "SHIPPED"/"DONE — all chunks landed" with no deferred
note would be the BAD case (found none currently, which is itself worth reporting: the two
present today, `PLAN-ARCHITECTURE-COHERENCE.md` and presumably others per `git status`, are
correctly still-open).

**Contract:**
- Inputs: none (scans repo root for `PLAN-*.md`, excluding `PLAN.md` itself).
- For each file, read its first ~10 lines for a `Status:` line (same convention this very doc
  uses — `Status: DRAFT` / `Status: SHIPPED` / `Status: PARTIALLY LANDED` / etc., matching the
  pattern already used by `PLAN-ARCHITECTURE-COHERENCE.md:3`).
- Output shape (stdout, human-readable list + a JSON block for `/cleanup` to parse):
  `{ path, statusLine, flag: 'ok' | 'review' }` — `flag: 'review'` when the status text matches
  `/\b(SHIPPED|DONE|LANDED)\b/i` AND does NOT also match `/\b(PARTIAL|DEFERRED|PENDING|AWAITING)\b/i`
  (i.e., it reads as fully complete with no stated reason to still exist).
- Also emit the `SKILL_FILES` drift check (C11): read `.claude/skills/*/SKILL.md` via `fs.readdirSync`,
  diff against `lint-skills.mjs`'s exported `SKILL_FILES` array (already exported, `lint-skills.mjs:42`),
  report any `.claude/skills/*/SKILL.md` NOT in that list.
- Exit behavior: **never exits non-zero** — this is a REPORT, not a gate (a plan doc legitimately
  stays open for a while; failing CI on it would fight the natural editing cadence `docs/PLANNING.md`
  describes). `/cleanup` reads its stdout/JSON, CI does not run it. This mirrors why `report-branches.mjs`
  below is also non-gating.
- Must stay structural (regex on a Status line), never semantic — same discipline as `lint-docs.mjs`'s
  own honesty note (`lint-docs.mjs:24-29`).

### 3.2 `pipeline/ci/report-branches.mjs` (covers the mechanical half of C12)

**Why no existing guard covers it:** nothing in `pipeline/ci/` touches git branches/worktrees at
all — confirmed by grep (no `git branch`/`git worktree` invocation anywhere under `pipeline/`).
CLAUDE.md process rule 9 states the STALE-branch-delete rule in prose only ("verify each landed
against PLAN.md's Status table, NOT `git branch --merged`") — this script gives that prose a
cheap, repeatable data source instead of a fresh manual `git log`/`merge-base` investigation each
time (which is exactly what this task itself just did by hand — see the branch/worktree findings
folded into §5 step 4 below as the worked example).

**Contract:**
- Inputs: none (invokes `git branch -a`, `git worktree list`, `git merge-base --is-ancestor <tip>
  origin/main` per branch/worktree tip).
- Output (JSON to stdout): one row per local branch AND per worktree —
  `{ ref, tipSha, tipDate, tipSubject, isAncestorOfMain: bool, worktreePath?: string, dirty?: bool }`.
  `dirty` (worktrees only) = `git status --porcelain` non-empty in that worktree.
- Classification is left to the CALLER (the skill's judgment pass), not the script — the script
  only gathers facts. **Do not** have the script itself decide "stale" — staleness also requires
  cross-referencing `PLAN.md`'s Status table (which chunk shipped under which sha) and any
  `PLAN-*.md`'s explicit "preserved UNCOMMITTED, do not delete" note (exactly the sentence
  `PLAN-ARCHITECTURE-COHERENCE.md:16` carries for worktree `agent-a3e1ba12232696893`) — that
  cross-reference is unavoidably a text-understanding step, i.e. judgment, scoped and cheap once
  the facts are gathered mechanically.
- Exit behavior: never exits non-zero (report tool, not a gate); not wired into `checks.yml`.

### 3.3 No new script for C13/C16/C17 — deliberately left as direct tool calls in the runbook

`git status --porcelain` (C13) and a `Grep` for a fixture basename (C16) are each single tool
calls with a fixed, well-known invocation — writing a wrapper script for either would be the
"hand-authored ad-hoc scanner" this plan is trying to eliminate FOR THE AGENT, not reproduce as a
committed indirection layer. The line: a check gets a script when its logic has more than one
step or needs to be run identically from CI; a check that's genuinely one shell command stays a
named step in the skill runbook (§5), not a `.mjs` file.

---

## 4. Reconciling `/cleanup` against `/analyze` — the boundary

Read in full: `.claude/skills/analyze/SKILL.md` (95 lines) and `pipeline/commands/analyze-record.mjs`
(191 lines, pure core `pipeline/lib/analyze.mjs`).

**`/analyze` owns:** the DATA/RECORD/CALIBRATION retro. It reads `suggestions.jsonl`, `fills.json`,
`positions.json`, and derives: did we log the right fields, what's our realized track record per
flip-niche, which thresholds are candidates for F1 calibration (gated on O1's sample thresholds).
Its §5 "Guidelines guard" is explicitly a **prompt-level checklist over the session's edits**
(`analyze/SKILL.md:76-93`) — encoding boundary, docs reconciliation, version discipline,
small-sample honesty, PII, green-before-done — run informally, not against committed guard
scripts beyond citing that `lint-docs.mjs`/`run-tests.mjs` are the real gate
(`analyze/SKILL.md:79,92`).

**`/cleanup` owns:** CODE/DOC/ARCHITECTURE hygiene — whether the *implementation* (not the
trading record) is internally consistent, whether structure has drifted from the stated ideals,
whether anything is dead/orphaned/duplicated, whether comments and docs are honest about current
state, whether worktrees/branches need attention. It never touches `suggestions.jsonl`/
`fills.json`/`positions.json` interpretation and never proposes a threshold tuning — that is
`/analyze`'s (routed to F1) job exclusively, per `analyze/SKILL.md:64-68,100-101` ("Never edit a
strategy/rating constant to 'act on' a retro in this skill").

**Overlap that must NOT duplicate:** `/analyze` §5's guidelines-guard checklist bullets
("Encoding boundary", "Docs reconciliation", "Version discipline", "Green before done") sound like
`/cleanup` territory. Resolution: `/analyze` §5 stays a LIGHTWEIGHT session-scoped prompt run as
part of the data retro (it already exists, keep it — it's cheap and it's already there). `/cleanup`
is the DEEPER, SEPARATE pass — same subject area (architectural/doc integrity) but broader scope
(the whole wave, not just "this session's diff"), backed by the mechanical guard inventory in §2,
and it is the one that does G2/G3/G5 (duplication, dead code, worktrees) which `/analyze` never
attempts. **Handoff, not merge:** `/cleanup`'s runbook (§5) explicitly does NOT re-run
`analyze-record.mjs` or interpret the trading retro — if a `/cleanup` pass notices a dataset-health
problem (a stale `positions.json`, a dropped log field) incidentally, it names it and POINTS to
`/analyze`, it does not absorb that analysis. Two skills, two non-overlapping deliverables, one
optional pointer between them.

---

## 5. The `/cleanup` skill runbook (ordered)

Numbering matches the intended `SKILL.md` section numbering.

**§1 — Run every mechanical guard once, in the exact order `checks.yml` runs them** (C1–C9):
```
node pipeline/ci/run-tests.mjs
node pipeline/ci/check-imports.mjs
node pipeline/ci/check-dead-exports.mjs
node pipeline/ci/check-daemon-safety.mjs
node pipeline/ci/lint-arch.mjs
node pipeline/ci/lint-skills.mjs
node pipeline/ci/lint-docs.mjs
```
Run `pipeline/ci/smoke-test.mjs` only if the session/wave touched an app-imported module (cross-
check the file list against `docs/ARCHITECTURE.md`'s app-imported table, `ARCHITECTURE.md:94-96`).
**All output is parsed, none re-derived by hand.** Any red guard here is the SAME finding a CI run
would produce — report it plainly, do not re-investigate what the guard already pinpointed.

**§2 — Run the two new report scripts** (C10–C12, once §3 ships):
```
node pipeline/ci/lint-plan-lifecycle.mjs
node pipeline/ci/report-branches.mjs
```
Both are non-gating reports; read their JSON.

**§3 — One-line mechanical checks** (C13, C16):
```
git status --porcelain          # orphan untracked artifacts (cross-ref README's known-artifact tables)
```
For each `pipeline/test/fixtures/*` file touched or suspected stale, one `Grep` for its basename
across `pipeline/test/*.test.mjs`.

**§4 — Scope the judgment pass to the SESSION/WAVE diff, not the whole repo.** Determine the diff
range first (`git log` since the wave's first commit, or `git diff` against the last shipped
`PLAN.md` Status-table sha for this wave) — this is the single decision that keeps repeat runs
cheap: a `/cleanup` pass over a 5-file wave reads 5 files' worth of context, not the whole
`pipeline/` tree. Only fall back to a repo-wide sweep on an EXPLICIT ask ("audit the whole repo"),
and say so before doing it (it is expensive and should be rare, mirroring why
`PLAN-ARCHITECTURE-COHERENCE.md`'s own audit was a deliberate one-off, not a routine).

**§5 — Judgment checks, scoped to that diff** (C14–C19, in this order — cheapest/most-likely-to-
matter first):
1. **Duplication / two-homes (C14).** For each new concept/function introduced this wave, grep
   for a same-shaped sibling elsewhere (`docs/ARCHITECTURE.md`'s "one-home rule" table,
   `ARCHITECTURE.md:73-86`, is the reference list of current homes — a new function that
   re-implements a listed concept is the finding).
2. **Unread spec fields (C15).** For each new/changed field on a declarative spec (`js/flip-niches.mjs`
   entries, a validator's `spec` shape), confirm at least one non-test file actually reads it
   (grep, not re-derive — this is the same shape `check-dead-exports.mjs` already proves for
   exports; specs/config fields aren't exports so the guard doesn't cover them, hence judgment).
3. **README inventory completeness (C17).** `git diff --stat` the wave; for each NEW file, confirm
   README's "Map of the repo" / "Files" section has an entry (§1718+ and §43+ respectively).
4. **ARCHITECTURE.md invariant-table freshness (C18).** For each `(proposed)` guard row
   (`ARCHITECTURE.md:61-63`, E8/E9 today), check whether this wave shipped the guard it names —
   if so, flag "flip to 🔒" per the doc's own instruction (`ARCHITECTURE.md:181-182`).
5. **Comment/doc-hygiene sweep (C19).** Apply the rubric in §6 to files touched this wave only.

**§6 — Worktree/branch review (C12's judgment half).** Cross-reference `report-branches.mjs`'s
facts against: (a) `PLAN.md`'s Status table (sha → landed chunk), (b) every `PLAN-*.md`'s own
"preserved UNCOMMITTED" / "do not delete" language, (c) `lint-plan-lifecycle.mjs`'s flags. A branch/
worktree is CONFIRMED-STALE only if its tip is an ancestor of `origin/main` (or squash-landed per
Status table) AND no `PLAN-*.md` claims it as deferred work — per CLAUDE.md process rule 9 and
memory `stale-branch-delete-ok`, confirmed-stale may be deleted without asking; anything ambiguous
gets asked about, never assumed.

**§7 — Gap-analysis writeup (C20).** Synthesize §1–§6 into: missing guards (a check this plan's
§2 marks JUDG that recurs often enough to deserve mechanizing), missing tests (a file with no
`*.test.mjs` sibling that plausibly needs one), missing README entries (already caught in §5.3),
and `PLAN-*.md` files ready to fold (already caught in §2).

**§8 — Proposed-fix list.** For every finding across §1–§7, one line: what + where (`file:line`)
+ the concrete fix + which existing doc/PLAN it belongs in (a `docs/PLANNING.md`-shaped chunk if
the fix is nontrivial, a same-commit doc reconciliation if it's a one-liner). **Never apply a fix
in this skill** — same non-apply discipline `/analyze` already holds (`analyze/SKILL.md:100-101`);
`/cleanup` proposes, a follow-up (this skill run again, or a dispatched Opus chunk) implements.

---

## 6. The comment/doc-hygiene rubric (C19)

**The test:** would this sentence still be TRUE and USEFUL if every prior version of this file
had been deleted and only `git log` remained as the historical record? If yes, it's current-state.
If the sentence's only value is narrating a SEQUENCE of past states or decisions, it's
history-narration and belongs in `CHANGELOG.md` / `docs/LORE.md` / the commit message, not the
header.

**Real example from this codebase — `pipeline/lib/admission.mjs:1-38`** (read in full above).
The header does TWO things at once:
- **Current-state (keep in the header):** "This module is the NEW default admission path
  (`pickFetchPool`)... `rankAndSlice` stays selectable via `--admission legacy` for rollback,"
  the three numbered fixes (SC1/SC2/SC3) described as WHAT the module does today, the
  track-record-boost paragraph's CURRENT behavior ("a BOOST-ONLY multiplier... can only ever ADD
  fetch priority, never subtract").
- **History-narration (candidate to trim/relocate):** "Anchor incident (2026-07-17): the screen
  never surfaced Abyssal bludgeon or Sanguinesti staff..." — this is valuable CONTEXT for why the
  design is shaped this way, which is a legitimate thing for a header to carry (WHY, not just
  WHAT) **as long as it stays terse and doesn't accumulate**. The genuinely narrating example is
  one step further down the stack, in **`README.md:1766`**'s `admission.mjs` inventory row, which
  reads as a literal changelog: "AR2 (PLAN-ARCHITECTURE-COHERENCE): a survivor admitted by the...
  F-B (2026-07-22): `pickFetchPool`'s amplitude branch... PLAN-FETCH-POOL-SCALING (2026-07-24):
  `pickFetchPool`'s value branch gained the SAME `VALUE_RESERVE` carve-out..." — three
  chronologically-stacked "as of DATE, plan X added Y" clauses in one inventory-table cell. A
  reader who wants to know what `admission.mjs` DOES TODAY has to mentally diff three historical
  deltas instead of reading one current description.

**Before (README.md:1766, illustrative excerpt, not a live edit):**
> "...F-B (2026-07-22): `pickFetchPool`'s amplitude branch (the DEFAULT admission path — this is
> the one a real scan actually runs) mirrors `gatecandidates.mjs`'s watchlist reserve, since the
> amplitude flip-niche's own top-N slice lives here too, not only in the legacy `rankAndSlice`.
> PLAN-FETCH-POOL-SCALING (2026-07-24): `pickFetchPool`'s value branch gained the SAME
> `VALUE_RESERVE` carve-out as legacy `rankAndSlice`..."

**After (what a current-state rewrite would say):**
> "`pickFetchPool`'s amplitude and value branches each carve out their own reserve slice
> (mirroring `gatecandidates.mjs`'s watchlist/value reserves) so neither flip-niche's admission
> depends on the legacy path. See git log / CHANGELOG.md for the sequence this was added in."

This is a **judgment** call, not mechanizable: telling "this sentence justifies a design decision
(legitimate WHY)" from "this sentence is a changelog entry wearing a header's clothes" requires
reading intent. The rubric's cheap proxy an agent CAN apply mechanically as a first pass: a
sentence that starts with a **dated parenthetical + a plan-name** ("(2026-07-22)", "PLAN-X:", "as
of...") stacked three-or-more-deep in the SAME paragraph/cell is a strong smell — flag it for a
judgment read, don't auto-rewrite it (auto-rewriting prose is exactly the kind of thing this repo
already refuses to hand to a semantic linter, per `lint-docs.mjs`'s own honesty note,
`lint-docs.mjs:24-29`).

**Prose-pollution rubric for `.md` files (separate from code comments):** a doc is polluted when
(a) it restates a rule `lint-docs.mjs`'s CHECK 2 would flag as a copy rather than a pointer (run
CHECK 2 as the mechanical first pass — `lint-docs.mjs` already IS this check for the CLAUDE.md⇆
README axis; the judgment layer is noticing the same pattern on OTHER doc pairs it doesn't scan,
e.g. two SKILL.md files), or (b) a `PLAN-*.md` accumulates narrative that belongs in
`docs/LORE.md` once its chunks ship (the doc's own "Status" + "chunks" sections should stay, the
"here's the whole story of how we got here" prose should not survive past the fold-in).

**Where flagged history goes:** a one-line pointer stays ("history: see `git log`/`CHANGELOG.md`");
the narrative content itself either (a) is ALREADY adequately captured by the commit message (most
common — just delete the doc prose, it's redundant with `git log`), or (b) is genuinely worth a
narrative home and gets a short addition to `docs/LORE.md` (rare — LORE is for STORIES worth
retelling, e.g. the 0.30.0→0.33.0 verdict-vocabulary contradiction anchor CLAUDE.md rule 8 itself
cites, not routine "flag X added on date Y" bookkeeping).

---

## 7. Honest scoping — what stays judgment, and what's too noisy to include

**Cannot be mechanized (stays judgment, permanently, not a "TODO: write a linter"):**
- C14 (two-homes duplication) — requires recognizing that two DIFFERENTLY-NAMED, differently-
  shaped functions solve the same problem; `check-dead-exports.mjs`'s name-based approach
  (`check-dead-exports.mjs:14-21`) is explicitly conservative and can't see this class at all.
- C15 (unread spec fields) — RC-B per `docs/ARCHITECTURE.md:167-169`, which itself says a generic
  version is only a "possible future add," not committed to.
- C19's "does this justify a design decision vs narrate history" distinction — the dated-
  parenthetical-stacking heuristic is a cheap SMELL DETECTOR, not a classifier; a header can
  legitimately cite one dated anchor incident (the `admission.mjs:4` example) without being
  history-polluted.
- C17's "is this README entry ACCURATE, not just present" — presence is mechanizable (grep for
  the filename in README), accuracy requires reading both the code and the prose.

**Deliberately left OUT — too noisy/low-signal for a repeat-run skill:**
- A repo-wide dead-code sweep on every `/cleanup` run. `check-dead-exports.mjs` already runs
  every CI pass — a `/cleanup` invocation gets nothing extra by re-running it against the whole
  tree; the wave-scoped judgment checks (§5 step 4) are where the marginal value is.
- Auto-flagging every `(proposed)` guard as overdue — `docs/ARCHITECTURE.md:64` explicitly
  accepts E8/E9 staying proposed indefinitely until someone builds them; nagging about it every
  run would be noise (per Ben's own `docs-small-encode-in-scripts` preference against boilerplate
  nagging). §5 step 4 only flags a `(proposed)` row when THIS WAVE shipped something that could
  retire it — an event-triggered check, not a standing complaint.
- A generic "count adjectives in this doc" or LLM-semantic prose-quality score — explicitly
  forbidden by the denylist/structural-only discipline every existing lint carries
  (`lint-docs.mjs:24-29`, `lint-arch.mjs:16`, `lint-skills.mjs:25-33`). `/cleanup`'s judgment
  passes are a human/agent reading real files, not a heuristic score.
- Fixture staleness (C16) beyond a cheap basename grep — a fixture legitimately used only by ONE
  test that's temporarily skipped, or shared across suites in a way a basename grep won't catch
  perfectly, is accepted noise; not worth a dedicated AST-aware script for the rare miss.

---

## 8. Chunked implementation plan (for the later Opus pass — not built here)

Ordered cheapest/foundation-first, per `docs/PLANNING.md`'s chunk rules.

**NS1 — `lint-plan-lifecycle.mjs` (§3.1).** New file, no dependents yet. Acceptance: run against
the CURRENT repo state (two `PLAN-*.md` files present per `git status`: `PLAN-ARCHITECTURE-COHERENCE.md`,
`PLAN-DIURNAL-RECENCY-GUARD.md`, `PLAN-GRADE-REWORK.md`, `PLAN-RECENCY-REACHABILITY.md`,
`PLAN-WINDOW-CLEAR-OUTCOMES.md` — five, per the gitStatus snapshot) and confirm it correctly
reports each as `flag:'ok'` (none currently reads as unconditionally-complete) or correctly flags
one if its Status line does read that way — verify by hand against each file's actual Status line
at implementation time, since this plan's snapshot may be stale by then. Also implements C11
(SKILL_FILES drift report). `node --check`; no CI wiring (non-gating report tool — do not add it
to `checks.yml`).

**NS2 — `report-branches.mjs` (§3.2).** New file, no dependents. Acceptance: run against the
current worktree/branch state (this investigation found, live: `agent-a3e1ba12232696893` — tip
IS an ancestor of `origin/main` but the worktree carries uncommitted deferred changes per
`PLAN-ARCHITECTURE-COHERENCE.md:16`, correctly a NOT-stale case; `agent-a9590cfca9710921f` — tip
`babaa36` NOT an ancestor of `origin/main`, clean working tree, needs a judgment read against
`PLAN.md`'s Status table to classify; local branch `g1-readme-inventory` — NOT an ancestor,
~156k-line diff vs main, dated 2026-07-04 against a G1 that CLAUDE.md rule 6 says already
shipped that day — a strong stale candidate for the judgment pass to confirm) — use these three
as the acceptance fixture's real-world proof rather than a synthetic one. `node --check`; no CI
wiring.

**NS3 — wire NS1+NS2's report format into a shared JSON shape** (optional consolidation — only
if the skill's own parsing turns out to want one call instead of two; not required for correctness,
skip if it doesn't earn its keep).

**NS4 — write `.claude/skills/cleanup/SKILL.md`** itself, following the `/analyze`+`/scan` format
(YAML frontmatter with `name`/`version`/`description`/trigger phrases; every top-level `- **…**`
rule-block tagged `code-pointer` or `judgment:` per `lint-skills.mjs`'s convention). Encodes the
§5 runbook verbatim as the skill's numbered sections. Depends on NS1+NS2 existing (the runbook
names them).

**NS5 — add the new skill to `lint-skills.mjs`'s `SKILL_FILES`** (`lint-skills.mjs:42-47`) — this
is the moment C11's own finding (that `analyze`/`book`/`schedule`/`ship` are missing from that
list) should be resolved TOO, in the same chunk, for all five currently-unlinted skills — don't
ship a NEW unlinted skill while flagging that pattern as a gap in the very same plan. Acceptance:
`node pipeline/ci/lint-skills.mjs` passes with 9 files scanned (5 currently-unlinted + scan/positions/
overnight/morning), 0 untagged.

**NS6 — README "Map of the repo" / inventory entries** for `pipeline/ci/lint-plan-lifecycle.mjs`,
`pipeline/ci/report-branches.mjs`, and `.claude/skills/cleanup/SKILL.md` (process rule 8 — every
new file gets an entry at creation, same commit).

**NS7 — CLAUDE.md's ask→command table** gets one new row: "clean up after this session/wave" →
`/cleanup` (mirroring the existing table shape), plus a doc-reconciliation pass over any CLAUDE.md
section this plan's own findings touch (the SKILL_FILES gap, if NS5 doesn't already cover it
fully in prose).

**No chunk here touches `js/` or any app-imported module** — the whole feature is pipeline/skill-
only, so no `APP_VERSION` bump at any chunk (CLAUDE.md process rule 5); `SKILL.md`'s own `version:`
frontmatter is what bumps (starts at `1.0`).

---

## 9. Open design questions (list only, not actioned)

- **Q1 — should `report-branches.mjs`'s judgment classification (§5 step 6) ever auto-delete a
  CONFIRMED-stale branch/worktree, or always just report + let the agent delete per CLAUDE.md rule
  9's existing discretion?** Recommend: never auto-delete from inside the script — deletion stays
  an explicit git command the skill's runbook issues after the judgment read, matching how rule 9
  already works today (report, then act, not a single opaque step).
- **Q2 — how often should `/cleanup` run?** Not specified by Ben's ask. Recommend: after any wave
  marked complete in `PLAN.md`'s Status table, or on explicit request ("clean up", "check
  architecture", "did we leave a mess") — NOT on a schedule, since the whole design point is that
  it's cheap per-invocation but still shouldn't run unprompted (mirrors `/analyze`'s own
  invocation model — asked-for, not scheduled).
- **Q3 — C13's orphan-artifact check currently leans on README's tables being human-readable
  markdown, not a machine-checkable list.** A future refinement could extract the "Root data
  artifacts" / "Pipeline-only / movable" tables (`README.md:1730-1747`) into a small parseable
  registry `report-branches.mjs`-style script could diff against `git status --porcelain`
  automatically. Not proposed as a chunk here (§3.3's reasoning: a `git status` + human table-read
  is one step, not worth a wrapper YET) — revisit if orphan-artifact misses recur.
