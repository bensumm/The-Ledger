# PLAN-HYBRID-REVIEW — swarm-find + strong-verify vs few-broad-agents, measured head-to-head

Status: **ARMED — runs at the NEXT wave's review round** (not the 2026-08-29 reach-margin wave,
whose rounds 1–4 are the motivating data and are already contaminated as a test bed).
Owner ruling: Ben, 2026-08-29 — "Set up the hybrid experiment for the next wave."

## Context / diagnosis

The repo's adversarial-review default (CLAUDE.md rule 10) runs a FEW broad, strong agents per
round. Four rounds over the 2026-08-29 reach-margin wave measured its shape:

- The highest-yield findings were CROSS-FILE and REQUIRED STRONG REASONING: a degenerate scoring
  metric recognized via an invariant (`campaigns + steps` constant, so over/under-merge errors
  cancel); a claim retracted in one plan file and re-asserted in two other files; a reviewer
  refuting ITS OWN arithmetic by importing the canonical `breakEven` instead of hand-rolling it.
  A narrowly-scoped agent structurally cannot find the first two classes and a weaker model is
  less likely to perform the third (self-refutation before filing).
- The measured weakness is CONVERGENCE ON ITS OWN TAIL: passes re-audit the previously-named
  region; the single most productive briefing change on record was scoping one pass AWAY from
  the worked region (rule 10's 2026-08-09 measurement, reproduced this wave).
- Reviewer findings run ~1/5 load-bearing (rule 12), so the orchestrator's at-source
  verification is the bottleneck. A finder swarm shifts volume toward MORE unverified findings;
  whether a dedicated verify stage absorbs that is the open question this experiment measures.
- The stopping rule ("keep going until a round returns nothing real") needs rounds that CAN
  return empty. A swarm essentially never does; the hybrid moves the empty-round signal to the
  verify stage's output, and whether that signal stays legible is itself a measured outcome.

## Rulings

- Ben, 2026-08-29: run the experiment (quote above). Arm definitions, metrics, and decision rule
  below are PROPOSED DEFAULTS, flagged for veto at run time — none has been separately ruled on.
- Standing (rule 12 / `review-triage-by-decision-impact`): the shared judge for "confirmed" is
  the orchestrator's at-source verification, identical for both arms.
- Standing (`docs-small-encode-in-scripts`): any swarm check that proves repeatedly mechanical
  GRADUATES to a CI guard and leaves the swarm — the swarm is not a home for checks a denylist
  script can run for free.

## Existing scaffolding

Nothing to build. The Agent tool runs both arms (finders take a `sonnet` model override;
verifiers and Arm A inherit the session model). Token cost per agent arrives in each task
notification (`subagent_tokens`), wall-clock likewise (`duration_ms`) — OBSERVED in this
session's live notifications, not documented in any repo contract, so HYB1's first step is
confirming the fields still arrive; if they don't, record figures from the agents' own transcript
metadata instead of skipping metrics (4)/(5). The briefs below are templates, not scripts; no repo file
executes this plan.

## Design — two arms, one diff, blind to each other

Both arms run on the SAME wave diff in the same round, launched together. No agent in either arm
sees the other arm's output; the orchestrator dedups and verifies after both complete.

**Arm A (control — the current default): 2 broad strong agents.**
One briefed to attack the orchestrator's own last pass first; one scoped away from the region
just worked. Standard rule-10/12 briefing (decision impact, DELETE/LEAVE IT/ENCODE, reachability
not shape, self-triage, verified-clean list).

**Arm B (hybrid): finder swarm → verify stage. No broad agent — arms stay pure.**
- *Find stage:* N narrow finders on `sonnet`, N = one per concern cluster derived from the wave
  diff at run time (per-file or per-concept), capped at 8. Each gets ONLY its cluster + the
  finder brief template below. Candidate generation only — their individual judgment is not
  trusted and they are told so.
- *Verify stage:* 1 strong agent (2 if the deduped list exceeds ~15 candidates) briefed to
  REFUTE each deduped candidate at source, running the discriminating test where it costs under
  a minute. Only survivors reach the orchestrator.

The production recommendation "keep one broad agent regardless" is deliberately NOT in Arm B:
the experiment measures the pure forms; production composition is a later decision.

### Finder brief template (Arm B find stage)
> Scope: exactly <cluster>. Report CANDIDATE defects only — you are one finder in a swarm and
> your findings will be adversarially verified, so file anything plausible but LABEL each:
> (1) claim in one sentence, (2) file:line, (3) "measured on <path>" or "shape only — unmeasured",
> (4) the discriminating test a verifier should run. Do not fix anything. Do not audit outside
> your cluster. Self-triage: mark findings you suspect are nitpicks.

### Verifier brief template (Arm B verify stage)
> For each candidate: try to REFUTE it at source. Run the named discriminating test if under a
> minute; name a better one if the finder's is wrong. Verdict per candidate: CONFIRMED (with
> evidence) / REFUTED (with the refutation) / UNVERIFIABLE (say why). Then rule-12 triage on the
> confirmed set. An all-refuted result is a valid, reportable outcome.

## Pre-registered metrics (declared here, before any run)

Per arm: (1) findings reported · (2) confirmed by the shared judge · (3) load-bearing after
decision-impact triage · (4) total subagent tokens · (5) wall-clock · (6) verify-stage kill rate
(Arm B only). Across arms: overlap (both / only-A / only-B), with cross-file findings tagged —
the class Arm B is predicted to miss. Predictions on record, falsifiable: A wins on cross-file
findings and confirmed-rate; B wins on coverage breadth and wall-clock; B's kill rate lands high.

## Decision rule (pre-registered)

One wave is n=1 — NO process adoption off a single run (rule 4). What one run CAN decide:
- Verify-stage kill rate ≥ ~70% ⇒ the finder brief is defective as written; iterate the brief
  before running the comparison again (that outcome scores the BRIEF, not the architecture).
- Arm B misses a confirmed cross-file finding Arm A catches ⇒ records the predicted blind spot
  as measured, and any adopted hybrid must keep a broad agent.
- Adoption/rejection of the hybrid needs 2–3 waves of consistent direction on confirmed
  load-bearing yield per token. Until then the current default stands.

## Encoding boundary

The experiment itself stays judgment/prose (a process trial, wrong home for a script). Two
things graduate out of it: mechanical swarm checks → CI guards (ruling above), and — if adopted
after enough waves — the process itself → a rule-10 amendment in CLAUDE.md, at which point this
plan folds and dies per lifecycle.

## Chunks

- **HYB1 — run both arms** at the next wave's review round. Acceptance: both arms launched
  together on one diff, blind; all notifications' token/duration figures recorded; every finding
  verified by the shared judge before scoring.
- **HYB2 — score + write up.** Acceptance: the metrics table above filled from recorded figures
  (NOT re-derived from memory — rule 12: derived numbers live in the writeup's table once, tied
  to the wave's sha, never restated in prose); overlap analysis done; the kill-rate branch of
  the decision rule evaluated; result appended HERE under a dated Results heading.
- **HYB3 — iterate or conclude** (conditional on HYB2): repeat on a following wave, or record
  rejection/adoption per the decision rule. On adoption, amend CLAUDE.md rule 10 + fold this
  plan; on rejection, record the result in PLAN.md Discovered + fold this plan.

## Honesty (rule 4)

Every threshold here (finder cap 8, ~15-candidate verifier split, ~70% kill rate, 2–3 waves) is
a PLACEHOLDER chosen by judgment, not measurement — the experiment exists to start accruing the
data that would replace them. Wave diffs differ in size and kind, so cross-wave comparison is
confounded by the diff itself; same-diff same-round is the only clean comparison, which is why
both arms run on one wave rather than alternating between waves. Judge bias is real and
undodgeable (the orchestrator wrote the code under review); it at least applies equally to both
arms.
