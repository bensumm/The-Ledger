---
name: cleanup
version: 1.1
description: A repeatable post-wave hygiene + architectural-integrity pass — run the CI guards, then a SESSION/WAVE-scoped judgment sweep for drift, duplication, dead code, doc-honesty, and worktree/branch staleness, and produce a proposed-fix list. Triggers — "clean up after this session/wave", "check the architecture", "did we leave a mess", "run a cleanup", "post-wave cleanup", "cleanup".
---

# /cleanup — post-wave hygiene + architectural-integrity pass

Skills-versioning note: this file's `version` bumps on material behavior change; skills NEVER bump
`APP_VERSION` (that marks the deployed app, which this skill never touches).

This is the DEEP, SEPARATE hygiene pass — the CODE/DOC/ARCHITECTURE half of "did we leave a mess",
run after a large feature session or a shipped wave. It orchestrates the mechanical guards the repo
already has, adds two non-gating report scripts, then spends judgment ONLY on the parts that are
irreducibly judgment — reading a diff for intent, deciding whether a worktree's deferred work is
still wanted, deciding whether a comment narrates history. The load-bearing cheapness rule: **every
judgment pass is scoped to the SESSION/WAVE diff, never a cold repo-wide re-audit.**

**Boundary with `/analyze`:** `/analyze` owns the DATA/RECORD/CALIBRATION retro (`suggestions.jsonl`/
`fills.json`/`positions.json`, track record, F1 tuning). `/cleanup` owns implementation integrity and
never interprets the trading record. If a `/cleanup` pass notices a dataset-health problem, it NAMES
it and points to `/analyze` — it does not absorb that analysis.

## 1. Run every mechanical guard once, in `checks.yml` order

- **Run the full CI suite locally first — same steps `.github/workflows/checks.yml` runs** —
  `judgment:` any red guard here is the SAME finding a CI run would produce; report it plainly, do
  NOT re-investigate what the guard already pinpointed.
```
node pipeline/ci/run-tests.mjs
node pipeline/ci/check-imports.mjs
node pipeline/ci/check-dead-exports.mjs
node pipeline/ci/check-daemon-safety.mjs
node pipeline/ci/check-forecast-guards.mjs
node pipeline/ci/lint-arch.mjs
node pipeline/ci/lint-skills.mjs
node pipeline/ci/lint-docs.mjs
```
- **Run the browser smoke ONLY if the session touched an app-imported module** — cross-check the
  touched files against the app-imported list in `docs/ARCHITECTURE.md`, then `pipeline/ci/smoke-test.mjs`.
  A pipeline/skill-only wave skips it.

## 2. Run the two non-gating report scripts

- **Gather plan-lifecycle + skill-coverage facts** — `pipeline/ci/lint-plan-lifecycle.mjs` flags any
  root `PLAN-*.md` whose Status reads complete with no deferred/partial marker (a doc past its
  fold-in point) and reports which `.claude/skills/*` are missing from `lint-skills.mjs`'s
  `SKILL_FILES`. Non-gating; read its `--- JSON ---` block.
- **Gather branch/worktree facts** — `pipeline/ci/report-branches.mjs` emits tip sha/date, ancestor-
  of-`origin/main`, and per-worktree dirty state as JSON. It ONLY gathers; the stale-vs-deferred
  verdict is the judgment pass in §6.
```
node pipeline/ci/lint-plan-lifecycle.mjs
node pipeline/ci/report-branches.mjs --pretty
```

## 3. One-line mechanical checks

- **Orphan untracked artifacts** — `judgment:` run `git status --porcelain` and cross-reference each
  `??` path against README's "Root data artifacts" / gitignore tables; a `??` that isn't a known
  expected artifact is the finding.
- **Suspected-stale fixtures** — `judgment:` for each `pipeline/test/fixtures/*` file touched or
  suspected stale, one `Grep` for its basename across `pipeline/test/*.test.mjs`; zero hits ⇒ a
  candidate (confirm it isn't shared/temporarily-skipped before proposing deletion).

## 4. Scope the judgment pass to the SESSION/WAVE diff

- **Determine the diff range FIRST — this is the single decision that keeps repeat runs cheap** —
  `judgment:` use `git log`/`git diff` since the wave's first commit (or against the last shipped
  `PLAN.md` Status-table sha for this wave). A `/cleanup` over a 5-file wave reads 5 files of
  context, not the whole `pipeline/` tree. Fall back to a repo-wide sweep ONLY on an explicit ask
  ("audit the whole repo"), and SAY SO before doing it — it is expensive and should be rare.

## 5. Judgment checks, scoped to that diff (cheapest/most-likely first)

- **Duplication / two-homes** — `judgment:` for each new concept/function this wave, grep for a
  same-shaped sibling elsewhere; the "one-home rule" table in `docs/ARCHITECTURE.md` is the reference
  list of current homes. A new function re-implementing a listed concept with no parity check is the
  finding (the pattern `PLAN-ARCHITECTURE-COHERENCE.md` chased by hand).
- **Unread spec fields** — `judgment:` for each new/changed field on a declarative spec (`js/flip-niches.mjs`
  entries, a validator's `spec` shape), confirm at least one non-test file actually READS it (grep,
  don't re-derive). Specs/config fields aren't exports, so `check-dead-exports.mjs` can't see this class.
- **README inventory completeness** — `judgment:` `git diff --stat` the wave; for each NEW file,
  confirm README's "Map of the repo" / "Files" section has an entry that captures its purpose
  accurately (presence is greppable; accuracy is the judgment).
- **ARCHITECTURE.md invariant-table freshness** — `judgment:` for each `(proposed)` guard row in
  `docs/ARCHITECTURE.md`, flag "flip to 🔒" ONLY if THIS wave shipped the guard it names — an event-
  triggered check, never a standing nag about a row that's allowed to stay proposed.
- **Comment/doc-hygiene sweep** — `judgment:` apply the §6 rubric to files touched this wave only.

## 6. Worktree/branch review (the judgment half of the branch report)

- **Classify each branch/worktree against three sources** — `judgment:` cross-reference
  `report-branches.mjs`'s facts against (a) `PLAN.md`'s Status table (sha → landed chunk), (b) every
  `PLAN-*.md`'s own "preserved UNCOMMITTED" / "do not delete" language, (c) `lint-plan-lifecycle.mjs`'s
  flags. A ref is CONFIRMED-STALE only if its tip is an ancestor of `origin/main` (or squash-landed
  per the Status table) AND no `PLAN-*.md` claims it as deferred work.
- **Confirmed-stale may be deleted without asking; anything ambiguous gets asked about** —
  `judgment:` per CLAUDE.md process rule 9 + memory `stale-branch-delete-ok`. Deletion stays an
  explicit git command the runbook issues AFTER the read — never auto-deleted from inside a script.
  A dirty worktree that a `PLAN-*.md` marks as deferred (e.g. `agent-a3e1ba12232696893`) is NOT-stale
  even when its tip is an ancestor of main.

## 7. Gap-analysis writeup

- **Synthesize §1–§6 into the gaps** — `judgment:` missing guards (a JUDG check that recurs often
  enough to deserve mechanizing), missing tests (a file with no `*.test.mjs` sibling that plausibly
  needs one), missing README entries (from §5), and `PLAN-*.md` files ready to fold (from §2). Name
  each with its evidence, not a vague "could be better".

## 8. Proposed-fix list — propose, never apply

- **One line per finding: what + where + the concrete fix + which doc/PLAN owns it** — `judgment:`
  a `docs/PLANNING.md`-shaped chunk if the fix is nontrivial, a same-commit doc reconciliation if
  it's a one-liner. **NEVER apply a fix in this skill** — same non-apply discipline `/analyze` holds;
  `/cleanup` proposes, a follow-up (this skill again, or a dispatched Opus chunk) implements.

## 9. The comment/doc-hygiene rubric (used by §5's last check)

- **The test: would this sentence still be TRUE and USEFUL if every prior version of the file were
  deleted and only `git log` remained?** — `judgment:` if yes, it's current-state; if its only value
  is narrating a SEQUENCE of past states, it's history-narration and belongs in `CHANGELOG.md` /
  `docs/LORE.md` / the commit message, not the header.
- **A header MAY cite ONE terse dated anchor incident (a legitimate WHY); it may NOT accumulate a
  changelog** — `judgment:` the cheap mechanical smell is a dated-parenthetical + plan-name
  ("(2026-07-22)", "PLAN-X:") stacked three-or-more-deep in the SAME paragraph/cell — flag it for a
  read, do NOT auto-rewrite prose (the repo refuses a semantic linter for exactly this, per
  `lint-docs.mjs`'s honesty note).
- **A `.md` is polluted when it restates a rule as a COPY rather than a pointer, or a `PLAN-*.md`
  accumulates narrative that belongs in `docs/LORE.md`** — `judgment:` run `lint-docs.mjs` CHECK 2
  as the mechanical first pass on the CLAUDE.md ⇆ README axis; the judgment layer is noticing the
  same copy-not-move pattern on OTHER doc pairs it doesn't scan (e.g. two `SKILL.md` files).
- **Where flagged history goes** — `judgment:` a one-line pointer stays ("history: see `git log`/
  `CHANGELOG.md`"); the narrative is usually already captured by the commit message (just delete the
  redundant doc prose), or rarely earns a short `docs/LORE.md` addition (LORE is for STORIES worth
  retelling, not routine "flag X added on date Y" bookkeeping).

## What this skill does NOT do

- **It does not re-run or interpret the trading retro** — `judgment:` `pipeline/commands/analyze-record.mjs`
  and the F1 calibration are `/analyze`'s exclusively; if a dataset-health problem surfaces
  incidentally, name it and point to `/analyze`, don't absorb it.
- **It does not do a cold repo-wide re-audit on a routine run** — `judgment:` the marginal value is
  in the wave-scoped judgment checks (§5); a whole-tree sweep is an explicit, announced one-off.
- **It does not auto-delete a branch/worktree or auto-rewrite prose** — `judgment:` both stay
  explicit steps a human/agent takes after the read, per §6 and §9.
