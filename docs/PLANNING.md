# PLANNING.md — how plans are made here (the process itself, versioned + iterable)

Ben, 2026-07-08: "document our planning process, so when skills/scripts try to create a plan to
improve they follow a consistent plan that we can iterate on." This file IS that process. When a
skill, script, or session produces an improvement plan, it follows this shape; when the process
itself proves wrong, fix it HERE (reconciliation, not append — the CLAUDE.md rule-8 discipline).

## Lifecycle

1. **Draft** anywhere (a `~/.claude/plans/` file, a scratch doc). Drafts are throwaway.
2. **Review round(s) with Ben.** Every review answers three questions: does it meet the goals,
   what are the gaps, what would differ built from scratch. Verify every code claim against the
   actual code (file:line) before asserting it — plans built on unverified claims rot instantly.
3. **Fold into `PLAN.md` at execution time** — the single master plan + scoreboard. The draft is
   then dead; per-topic `PLAN-*.md` files at the repo root are folded + deleted the moment their
   last chunk ships.
4. **Execute** per PLAN.md's Executor rules + dispatch model (coordinator + Opus subagents,
   worktree lanes only for parallel work, hand-serialized landing).

## Required sections of any plan

- **Context / diagnosis.** The problem in the owner's words + root causes CONFIRMED in code
  (file:line evidence, not vibes). Name the anchor incident (e.g. "the Hydra leather buy") — cheap
  named anchors survive; pasted live data rots.
- **Rulings.** Owner decisions recorded AS decisions, dated, with the quote when it matters.
  Every open question is either decided or given a proposed default explicitly flagged for veto —
  a plan with silent open questions isn't ready.
- **Existing scaffolding.** What already exists to build on (this repo rebuilds nothing that
  exists — check `git log` + `CHANGELOG.md` first; "not greenfield" is a section, not a hope).
- **Target architecture.** The layers/boundaries, plus WHERE new code lives (one home per concern
  — the two-homes topology is how forks are born).
- **Staged chunks.** See chunk rules below.
- **Encoding boundary.** What gets encoded in scripts vs what stays judgment, and the triage
  disposition for any prose rules the plan touches (encode / keep-as-judgment / retire).
- **Bookkeeping & compatibility checklist.** Per-chunk, not deferred: README inventory at file
  creation, `.gitignore` entries, schema back-compat notes, published-artifact shape freezes,
  CI wiring, APP_VERSION policy.
- **Honesty (process rule 4).** Name every placeholder/unvalidated threshold as such; state what
  data would validate it and whether the plan accrues that data.
- **Verification.** Per-chunk acceptance criteria concrete enough that an executor knows when
  it's done — fixtures named, invariants pinned, "byte-identical" claims diff-proven.

## Chunk design rules

- Small, independent, evidence-gated; each independently shippable and fixture-pinned.
- **Foundations first, bug-fixes first:** a chunk that kills live pain (the P0 pattern) lands
  before architecture; a data/layer foundation lands before its consumers.
- **Mechanical moves are separate chunks from behavior changes**, each refactor proven
  byte-identical (diff stdout / golden fixtures) so review is trivial.
- Every chunk lists primary files (the parallel-safety contract), its verification, and carries
  its own reconciling docs pass.
- A chunk that grows past ~2 concerns gets split (the P4a→P4a/P4b precedent).

## The improvement loop (skills/scripts self-improving → scripts, not notes)

Lessons land fixture-first (failing fixture + the code change that passes it); skill prose is the
tagged exception (`judgment:` tag or it's a defect); encoded rules leave pointers, not copies;
enforced by `pipeline/lint-skills.mjs` (pipeline-v2 P7). Full protocol: PLAN.md's Pipeline-v2
"Encoding boundary" section. Plans that touch skills MUST run the three-way triage and ship the
disposition table.

## Anti-patterns (each one has bitten this repo)

- Appending a new rule while an old contradictory one stands (the 0.30.0→0.33.0 reconciliation
  lesson) — grep-and-fix in place.
- A plan chunk that "wraps existing X" where X is actually spec-only — verify shipped vs specced.
- Unifying prose without unifying INPUTS (two scripts can't agree if they read different state).
- Deferring inventory/doc registration "to the docs chunk" — it's per-commit (rule 8).
- Working from a stale copy of anything — confirm current state before editing.
