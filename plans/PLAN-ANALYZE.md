# PLAN-ANALYZE.md — the analysis engine (`analyze.mjs` + `/analyze` skill)

Status: **PROPOSAL v2 — re-scoped 2026-07-10 under Ben's analysis-first ruling.** Supersedes the
desk-agent framing (`PLAN-DESK-AGENT.md`, same file, now dead): startup orchestration, server-launch,
workflow-walkthrough, loop-tracking, and ask-routing are all **de-scoped as low-value** (routing is
already one utterance; `serve.cmd` already backgrounds the daemon; a skill can't reliably own a
console). The subagent-dispatch idea is **dropped** — I (the interactive session) am the orchestrator;
wrapping cheap `node` reads in cold-start subagents adds no compute. What remains is the part that was
always the real value: **analysis**. Approved chunks fold into `PLAN.md`; this file dies when the last
ships.

## The ruling (Ben, 2026-07-10)
The construct's job is to **make our analysis good and our record honest**, not to run the desk:
1. **Ensure we're logging everything properly** and **storing the right data** so the analysis we want
   later is actually possible (a completeness/health audit of the dataset).
2. **Prompt retros and suggest data-backed improvements** — turn the raw joins into "what worked, what
   didn't, what to tune, and why," with the sample honesty rule 4 demands.
3. **Guard that our edits follow project guidelines** (CLAUDE.md: move-never-copy, docs-reconciliation
   pass, APP_VERSION discipline, honesty labels on small samples, no PII).
4. To do (1)–(3) it must **know session context** — what we did previously — so it can retro against it.

## What already exists (verified, not assumed) — the two-homes guard
The **data layer and the joins are DONE and mature.** `analyze.mjs` orchestrates them; it re-implements
NOTHING.

| Concern | Home | Status |
| --- | --- | --- |
| "What the tool SAID" — every quote/scan/watch rec, rich fields | `pipeline/lib/suggestlog.mjs` → tracked `suggestions.jsonl` | Done. Also the de-facto **mechanical session record** (every script I run is logged with `ts`). |
| "What actually FILLED" | `fills.json` (+ `positions.json` FIFO) | Done. |
| Suggestion→fill **forward** join (per-niche/per-path TTF, realized-vs-suggested, honest n) | `pipeline/retrojoin.mjs` + pure `pipeline/lib/retrojoin.mjs` | Done. READ-ONLY. |
| Campaign→suggestion **backward** join (band-pctl × liquidity fill-time cells, F1 schema) | `pipeline/outcomes.mjs` | Done. Gitignored/rebuildable. |
| Structural doc-drift lint (denylist + duplicate-phrase, CLAUDE.md⇆README) | `pipeline/doclint.mjs` (CI) | Done — **structural only, never semantic**. |
| Skill-prose disposition lint | `pipeline/skill-lint.mjs` (CI) | Done. |

**The gap** is that nothing (a) checks the dataset is COMPLETE/healthy, (b) turns the honest join tables
into a RETRO + tuning proposals, or (c) checks a session's edits against the CLAUDE.md rules at
session level (doclint/skill-lint are CI-time + structural, not a session retro of judgment rules).

## Encoding boundary (hard)
- **`analyze.mjs` = mechanical.** Audit + orchestrate the existing joins + derive flagged candidates.
  READ-ONLY (like `retrojoin.mjs`): reads the ledger/fills/artifacts, writes at most a gitignored brief.
  It **calls** `retroJoin`/`aggregateOutcomes`/`readSuggestionLines`/reconstruct helpers — never forks
  them. It emits **evidence with n**, never a calibrated verdict.
- **`/analyze` skill = judgment.** Interpret the brief into a retro, propose improvements *with why* and
  honesty labels, run the guidelines checklist. Judgment lines are POINTERS to CLAUDE.md/skills, not
  restated doctrine.
- **F1 stays the calibration home.** `analyze.mjs` SURFACES tuning candidates; it does NOT change any
  constant. Actually retuning `SCALP_MIN_ROI` / `rating.mjs` cutoffs / horizon placeholders is F1's job,
  gated on O1 sample thresholds. The analyst's output is "worth F1's attention," never "done."

## Chunks (sequenced)

### AZ1 — `pipeline/analyze.mjs`, the analysis engine  ·  ✅ SHIPPED (pure core `lib/analyze.mjs` + `analyze.test.mjs`, 14 assertions; 57 suites + doclint green; README + CLAUDE.md routing row landed)
- **Deliverable:** a READ-ONLY script, `node pipeline/analyze.mjs [--since <hrs>] [--json]`, with three
  sections, each n-honest:
  1. **DATASET AUDIT (the new mechanical work).** Health of the record so later analysis is possible:
     - ledger freshness + volume (rows in the last `--since`, gaps — "3 scans logged but 0 in the last
       6h despite a running loop?"); malformed/legacy rows; fields going null that shouldn't
       (`class`/`regime`/`validators` absent on recent rows ⇒ an emit path stopped logging).
     - `fills.json` ⇆ ledger coherence: BUY fills with **no** plausible prior suggestion (un-attributed
       trades — mobile/manual), and suggestions with rich forward fields vs. bare legacy rows.
     - rebuildability: does `outcomes.mjs --no-bands` reconstruct cleanly? is `positions.json` fresh vs
       `fills.json`? — surfaced as pass/flag, not rebuilt here.
     - **forward-data recommendations:** fields we WISH we'd logged for an analysis we can't yet do
       (e.g. "no `spread`/`depth` snapshot at emit ⇒ can't retro fill-rate vs book depth") → a
       lean-included schema suggestion for `suggestlog.mjs`, à la YS2. Proposal text only.
  2. **RETRO ROLLUP.** Invoke the existing joins and surface their honest output compactly: per-niche
     and per-path fill-rate / not-taken / realized-vs-suggested + TTF (from `retrojoin`), and the
     band-pctl × liquidity fill-time cells above `--min-n` (from `outcomes`). Every cell carries n.
  3. **TUNING CANDIDATES (flagged, never applied).** Derived purely from (2)'s aggregates, each gated on
     a minimum n and printed WITH it: e.g. a niche with n≥floor and a ~0 fill rate → "review its gate /
     min-ROI"; grades clumping (all S+) → "cutoffs uncalibrated — F1"; a validator that `reject`s rows
     that would have filled profitably → "validator may be over-tight." Output is a list of
     `{signal, evidence:{...,n}, points-at: <F1 / a spec constant / a validator>}`. **No constant is
     ever mutated; F1 owns that.**
- **Primary files:** `pipeline/analyze.mjs` (new), README inventory entry, CLAUDE.md ask→command row.
  Reuses `lib/retrojoin.mjs`, `outcomes.mjs` exports (refactor its report core into `lib/` only if a
  clean pure export doesn't already exist — check first; prefer invoking over refactoring).
- **Acceptance:** runs read-only against the live ledger/fills without writing a tracked file; every
  aggregate prints n; a synthetic-fixture test (`pipeline/analyze.test.mjs`) covers the audit flags
  (null-field detection, un-attributed-fill detection) and that a candidate never fires below its n
  floor. Added to `run-tests.mjs`. Pipeline-only → no APP_VERSION.
- **Risk:** low-med. Main risk is overclaiming from a weeks-cold sample — mitigated by the hard n gates
  and rule-4 labels baked into the output strings, not left to the skill.

### AZ2 — `/analyze` skill, the judgment + retro wrapper  ·  ✅ SHIPPED (`.claude/skills/analyze/SKILL.md` v1.0; 20 rule-blocks all tagged to the skill-lint convention; CLAUDE.md routing row updated)
- **Deliverable:** `.claude/skills/analyze/SKILL.md` (new). Flow:
  1. **Load session context** from what's ALREADY persisted — recent `suggestions.jsonl` rows (the
     mechanical "what we ran/said"), `fills.json` deltas, and the session's `git log`/working changes —
     plus the AZ3 journal *if it exists*. No new data required for v1.
  2. **Run `analyze.mjs`** and read the brief.
  3. **Retro:** interpret into "what worked / what didn't / what's un-attributed," honestly bounded by n.
  4. **Improvement proposals:** each as *proposal + why + honesty label + which chunk (usually F1) owns
     the actual change* — never an auto-edit.
  5. **Guidelines guard:** a checklist over edits made/proposed THIS session — move-never-copy, docs
     reconciliation done (not append-only), APP_VERSION bumped iff the deployed app changed, small-sample
     honesty present, no PII in tracked content, tests + doclint green. POINTERS to CLAUDE.md rules; it
     flags, Ben/I decide.
- **Primary files:** `.claude/skills/analyze/SKILL.md`, CLAUDE.md routing row, README.
- **Acceptance:** lints clean under `skill-lint.mjs` conventions; a dry run from a cold session produces
  a retro + proposals + a guidelines pass without restating judgment that lives elsewhere (pointers
  only). SKILL `version:` frontmatter, never APP_VERSION.
- **Risk:** low; wrapper. Scope-creep risk = re-encoding market judgment → acceptance is pointers-only.

### AZ3 — session journal (SPECULATIVE, deferred; Ben-vetoable)
- **Why deferred, not core:** `suggestions.jsonl` ALREADY records every script I run, so the *mechanical*
  "what we did" is covered — the analyst has plenty to retro on at v1. The journal's UNIQUE value is the
  *narrative* layer the ledger can't hold: "held X through the CUT because Y," "14:02 alert resolved as
  noise." Add it only once AZ1/AZ2 prove the analyst is blind without it.
- **Deliverable (if approved):** gitignored `pipeline/.cache/session-journal.jsonl`, append-only
  `{ts, kind: decision|resolved-alert|placed|cancelled, itemId?, note}`, written by me at those moments;
  AZ2 reads the last N lines. Check **L1 action-logging overlap first** — L1 is browser-side (`STATE.LOG`)
  and NOT readable by node, so it likely does not substitute, but confirm at execution.
- **Honesty:** value depends on write discipline CI can't enforce (`WILL` be forgotten sometimes); the
  reader must always present it as PARTIAL. This is the doc's own rule-4 caveat, carried forward.

## Explicitly NOT proposed (carried from the desk-agent veto)
- A long-running/SDK/scheduled agent process; subagent dispatch for routine reads; a startup skill that
  claims to own `serve.cmd`; re-encoding the ask→command table in an agent def. Reasons in git history
  of this file (the desk-agent version) + `docs/PLANNING.md` (owner ruling required for standing
  constructs; PLAN.md rules skill→subagent conversion out of scope).

## Bookkeeping & compatibility
- AZ1: README inventory + Map-of-repo entry at creation; CLAUDE.md ask→command row ("analyze my track
  record" / "what should we tune?" / "did we log everything?" → `/analyze`). Pipeline-only, no APP_VERSION.
- AZ2: README + CLAUDE.md routing row; SKILL `version:` frontmatter.
- AZ3: README inventory; `.gitignore` already covers `.cache/`.
- CI: add `analyze.test.mjs` to `run-tests.mjs`. `analyze.mjs` is READ-ONLY — it must never enter a
  commit/sync path (like `retrojoin.mjs`).

## Honesty (process rule 4)
- The whole point is honest accounting on a **weeks-cold, mostly-not-taken** sample (the archive began
  2026-07-08). Every candidate is a *flag for F1*, never a calibrated conclusion; the n gates live in
  `analyze.mjs` so the skill can't launder them away.
- The guidelines guard is a **checklist prompt**, not an enforcement gate — it reduces missed-rule
  incidents, it doesn't prove compliance (CI's doclint/skill-lint remain the structural enforcers).
