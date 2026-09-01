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

## Results — 2026-08-30, wave 1 (the forward-record honesty wave, diff over 345b03d)

Both arms ran blind on the same uncommitted diff. Deviations from the design, recorded first:
NINE finders launched against the stated cap of 8 (orchestrator error — the cap stands for the
next run); one Arm-B candidate (the pace-refusal serializer) was a REDISCOVERY of an
already-recorded PLAN.md Discovered item, so it counts toward verify-stage adjudication value
(it forced the fold-into-this-wave decision) but not novel yield; and the wall-clock figures
for two agents are contaminated by session idle time between turns (duration_ms spans
notification gaps, not compute), so metric (5) is unusable this wave except for the clean
parallel-finder band.

| metric | Arm A (2 broad, session model) | Arm B (9 Sonnet finders + 2 strong verifiers) |
| --- | --- | --- |
| findings reported | 12 | 16 candidates |
| confirmed by shared judge | 10 | 11 (7 actioned + 4 confirmed-no-impact) |
| load-bearing after triage | 5 | 3 |
| total subagent tokens | 344,009 | 1,209,361 (find 1,018,739 + verify 190,622) |
| wall-clock | contaminated (see above) | finders 141,924–382,447 ms in parallel |
| verify-stage kill rate | — | 5/16 refuted (31%) |
| overlap | both: 4 · only-A: 8 · only-B: 12 (4 actioned) | same row, one measurement |

Pre-registered predictions, scored: **"A wins on cross-file findings and confirmed-rate" — TRUE**
(cross-file 8–0: the false "band rows are unchanged" claim caught against the ledger's actual
population, the un-rewritten PLAN Discovered entry, the untracked test file, the README schema
omission, two stale single-chain headers — Arm B's nine narrow finders missed every one, including
the CHANGELOG finder that verified that exact sentence against source but never against data).
**"B's kill rate lands high" — FALSE** (31%; the finder briefs' self-triage did its job, so the
kill-rate branch of the decision rule does NOT fire — the brief is not defective). **"B wins on
coverage breadth" — mixed**: B went deeper per cluster and produced the single highest-severity
find of the whole run — the join-outcomes bare-timestamp keying that was leaking one campaign's
realised P/L into other items' campaigns placed the same second, fixture-reproduced by a finder,
then scope-CORRECTED by the verify stage, which found the live cross-item instance on the real
book that the finder had missed and refuted the finder's "pre-change this was safe" causal claim.
Arm A's broad pass measured that exact code path as clean. The blind-spot branch of the decision
rule FIRES in both directions: B missed confirmed cross-file findings A caught (the predicted
class, now measured), and A missed a confirmed live-data defect B caught — any adopted hybrid
keeps a broad agent AND the verify stage.

Verify-stage value beyond the kill count: it killed one candidate quoting pre-wave text, proved
one shape unreachable at source, identified one proposed fix as a recorded anti-pattern (the
nights-literal pinning that was tried and reverted on 2026-08-10), and adjudicated the
fold-vs-defer call on the pace serializer with a live measurement (refusal rows were already the
majority pace shape). None of that came from the finders.

Token-efficiency this wave: A produced a load-bearing find per ~69k tokens, B per ~403k — but the
two arms' yields were disjoint in KIND (A: corpus/cross-file prose truth; B: deep per-cluster
code defects with runnable fixtures), so the per-token ratio understates B where severity is
concerned. n=1; no adoption call (rule above stands — 2–3 waves needed). Next run: cap finders
at 8, aim finder clusters at code seams rather than doc claims (docs were A's territory twice
over), and record wall-clock from launch-to-notification timestamps rather than duration_ms.

## Results — 2026-08-31, wave 2 (the pressure-retirement wave, diff over bdea911)

Both arms ran blind on the same uncommitted chunk-8 diff (40 files). Deviations, recorded first:
NINE finders launched AGAIN against the cap of 8 — the same orchestrator error as wave 1, now
2/2, so the cap is evidently not self-enforcing as prose and belongs in the launch checklist the
orchestrator actually reads at dispatch time. A mid-run session rate limit (429) killed Arm A1
and both verifiers mid-flight; all three were resumed after reset with context intact, so their
TOKEN totals are cumulative and usable but their wall-clock is contaminated (A1's duration_ms
reflects only the resumed segment). Clean wall-clock exists only for the 9 parallel finders and
Arm A2.

| metric | Arm A (2 broad, session model) | Arm B (9 Sonnet finders + 2 strong verifiers) |
| --- | --- | --- |
| findings reported | 12 | 16 deduped candidates |
| confirmed by shared judge | 10 | 12 |
| load-bearing after triage | 8 actioned | 9 actioned (all 7 code fixes + 2 doc) |
| total subagent tokens | 358,242 (A1 205,277 · A2 152,965) | 1,390,039 (find 1,117,674 + verify 272,365) |
| wall-clock | A2 497,552 ms · A1 contaminated | finders 109,735–416,583 ms in parallel · verifiers contaminated |
| verify-stage kill rate | — | 4/16 refuted (25%; 5/16 counting one mooted) |
| overlap | both: 4 · only-A: 4 actioned (+1 calibration) · only-B: 9 actioned | same row, one measurement |

Pre-registered predictions, scored: **"A wins on cross-file findings" — WEAKENED this wave**: A
still owned the doc-corpus class outright (the "all five competing exit estimators" README claim,
the folded plan still marked STILL LIVE, the "five-way" co-log comment — B's finders missed all
of them, reproducing wave 1), but Arm B's VERIFY stage — a strong model — independently produced
two genuinely cross-file confirmations (a README pointer dangling at a deleted plan section, and
an orphaned retraction asserted in README + `js/reach-surface.mjs` after the plan that retracted
it was deleted), so the structural blind spot is a property of the narrow FINDERS, not of the
arm. **"B's kill rate lands high" — FALSE again** (25%, 2/2 waves; the defective-brief branch
does not fire). **"B wins coverage breadth" — TRUE where it counts, 2/2 waves**: B produced the
wave's highest-severity live defect — the `--pressure-exit=1` spelling silently bypassing the
retirement guard on all three CLIs, plus the space-value form on screen — in a code path Arm A1
examined, PARTIALLY spotted, and self-triaged to LEAVE IT without measuring the `=` spelling.
The verify stage measured it, upgraded it, and it became the wave's top fix. The blind-spot
branch again fires in BOTH directions (B's finders missed corpus truth A caught; A missed or
mistriaged the top live code defect B caught) — n=2, consistent: any adopted hybrid keeps a
broad agent AND the verify stage.

New scoring nuance this wave: FOUND is not TRIAGED. A1 sighted two defects B later confirmed
(the value-form slip, the rerun re-nomination print) and filed both as LEAVE IT nitpicks; the
verify stage's discriminating tests reversed both. The shared-judge/verify layer is where
mistriage gets corrected, which no per-arm finding count captures.

Token-efficiency: A produced a load-bearing find per ~45k tokens, B per ~154k — the same ~3x
ratio as wave 1 (69k vs 403k), and the same disjointness in KIND (A: corpus/prose truth; B:
live code defects with measured reachability). Direction after two waves is CONSISTENT on both
counts, which is what the decision rule asked for; one more wave (or an owner ruling now) can
settle adoption. The composition the data points at is the wave-1 corollary restated: broad
agents + code-seam finders + a strong verify stage, with the finder cap ENCODED at dispatch.

## Honesty (rule 4)

Every threshold here (finder cap 8, ~15-candidate verifier split, ~70% kill rate, 2–3 waves) is
a PLACEHOLDER chosen by judgment, not measurement — the experiment exists to start accruing the
data that would replace them. Wave diffs differ in size and kind, so cross-wave comparison is
confounded by the diff itself; same-diff same-round is the only clean comparison, which is why
both arms run on one wave rather than alternating between waves. Judge bias is real and
undodgeable (the orchestrator wrote the code under review); it at least applies equally to both
arms.
