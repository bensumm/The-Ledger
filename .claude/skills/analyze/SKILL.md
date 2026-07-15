---
name: analyze
version: 1.1
description: Retro our own track record, audit that we're logging/storing the right data, and surface data-backed tuning proposals — then check the session's edits against the project guidelines. Triggers — "analyze our track record", "what should we tune", "did we log everything", "run a retro", "how are our suggestions doing", "analyze".
---

# /analyze — dataset audit, retro, tuning proposals, guidelines guard

Skills-versioning note: this file's `version` bumps on material behavior change; skills NEVER
bump `APP_VERSION` (that marks the deployed app, which this skill never touches).

This is the JUDGMENT half of the analysis construct. The MECHANICAL half is `pipeline/analyze.mjs`
(AZ1) — it audits the dataset, orchestrates the joins, and derives n-gated flags. Your job is to
INTERPRET its brief into a retro + proposals and to run the guidelines checklist. The plan of record
is `PLAN-ANALYZE.md`; the calibration home is F1 (PLAN.md).

## 1. Run the engine — never hand-analyze

```
node pipeline/analyze.mjs            # audit + per-niche retro rollup + n-gated candidates
node pipeline/analyze.mjs --since 24 # restrict the freshness/window audit to the last N hours
node pipeline/analyze.mjs --json     # the structured brief (parse it instead of re-deriving)
```

- **That command IS the analysis** — it reads `suggestions.jsonl` (+ archives), `fills.json`, and
  `positions.json` and prints the three honest sections; the pure core is `pipeline/lib/analyze.mjs`.
  NEVER hand-write a join or a `node -e` over the ledger — every number here must be byte-identical to
  what the engine (and thus `retrojoin.mjs`) computes.
- **The n-gates already ran inside the engine** — `judgment:` your job is to READ the flags, not to
  re-derive them or lower their bar; a candidate is `pipeline/lib/analyze.mjs`'s call, not yours.

## 2. Load session context — all of it is already persisted

Before interpreting, know what WE did this session so the retro is grounded, not generic:

- **The ledger is the mechanical session record** — `judgment:` every quote/scan/watch you ran is
  already a row in `suggestions.jsonl` (written by `pipeline/lib/suggestlog.mjs`) with its `ts`; skim
  the recent tail (or `analyze.mjs --since`) for what was surfaced and under which niche/posture. No
  extra logging is needed for v1.
- **The realized side is `fills.json` / `positions.json`** — what actually filled + the FIFO view;
  the engine's un-attributed count already tells you how much trading happened off-book (mobile/manual).
- **The code side is `git log` + the working tree** — `judgment:` read what changed THIS session so the
  guidelines guard (§5) has something concrete to check; a retro that ignores the edits we made is half a retro.
- **If `pipeline/.cache/session-journal.jsonl` exists (AZ3), read its last lines** — `judgment:` the
  narrative layer (decisions, resolved alerts) the ledger can't hold; present it as PARTIAL (write-
  discipline isn't enforced). Absent → say so and lean on the ledger; do not fabricate a narrative.

## 3. Interpret → the retro (honest, n-bounded)

- **Lead with the dataset-health flags, not the rollup** — `judgment:` a stale `positions.json`, a
  dropped log field, or a spike in un-attributed fills INVALIDATES the retro beneath it; surface and
  (where you can) FIX the data problem first (e.g. run `node pipeline/sync-fills.mjs` for a stale book),
  then re-run `analyze.mjs`.
- **Every claim carries its n, and a ~0% taken rate is the BASELINE, not a finding** —
  `judgment:` the sample is weeks-cold and mostly not-taken by design (`lib/retrojoin.mjs` header);
  the engine already demotes that to a context note, so DON'T re-promote it into "niche X is broken."
  Speak to what the data can bear: "n=3 realized on rising — not enough to conclude anything."
- **Distinguish the three engine `kind`s when you relay them** — `judgment:` a `candidate` (a real
  net-negative anomaly past the n-floor) is worth F1's time; an `inform` (e.g. a most-firing reject
  validator) is a study-FIRST pointer, NOT a verdict that it's over-tight; `context` is scope-setting.

## 4. Improvement proposals — propose, never apply

- **Each proposal is: what + why + honesty label + which chunk OWNS the change** — `judgment:` state
  the tweak, the evidence (with n), the confidence given the sample, and route it — calibration of any
  constant (`rating.mjs` cutoffs, `SCALP_MIN_ROI`, the retrojoin horizons) is **F1's** job, gated on
  O1's sample thresholds, never a same-session edit off a thin signal.
- **A forward-DATA gap is often the highest-value proposal** — `judgment:` when the engine reports "can't
  answer Y because field Z was never logged" (e.g. grade letter, book depth), the fix is a lean field on
  `pipeline/lib/suggestlog.mjs` (the YS2 pattern) so the analysis becomes possible LATER — cheap now,
  compounding value.
- **Never edit a strategy/rating constant to "act on" a retro in this skill** — `judgment:` that is the
  exact overclaim-from-small-n failure rule 4 guards; the deliverable here is a well-evidenced proposal
  for Ben, not a code change.

## 5. Guidelines guard — checklist over the session's edits

Run this over what changed THIS session (from §2's `git log`/working tree). It is a PROMPT that reduces
missed-rule incidents, not an enforcer — CI's `lint-docs.mjs`/`lint-skills.mjs` remain the structural gate.

- **Encoding boundary** — `judgment:` app-needed logic MOVED into `js/` (never copied/forked); a new
  shared concern has ONE home (the two-homes anti-pattern CLAUDE.md rule 8 + `lint-docs.mjs` guard).
- **Docs reconciliation, not append-only** — `judgment:` did the change update `README.md` inventory,
  the relevant `CLAUDE.md`/`pipeline/*.md` section, AND fix any statement it now contradicts? (rule 8).
- **Version discipline** — `judgment:` `APP_VERSION` (`js/state.js`) bumped IFF the deployed app changed;
  skills bump their own `version:`; pipeline-only stdout tweaks may ship unbumped — confirm the change
  matches its lane.
- **Small-sample honesty** — `judgment:` every ported/surfaced provisional number keeps its inform label;
  no n≈0 signal is stated as calibrated (rule 4).
- **Public repo, no PII** — `judgment:` no RSNs/real names/emails/account names in tracked content
  (code, docs, `suggestions.jsonl`, commit messages) — the repo is public.
- **Green before done** — `judgment:` `node pipeline/run-tests.mjs` + `node pipeline/lint-docs.mjs` pass;
  a deployed-app change also needs the browser smoke (CI runs it on push).

## What this skill does NOT do

- **It does not re-run the slow campaign join** — `pipeline/outcomes.mjs` (`--report`) is the
  band-percentile × liquidity fill-time view; point Ben there rather than duplicating it. The engine
  does a rebuildability PROXY only.
- **It does not launder a thin sample into a confident claim, tune a constant, or write any artifact** —
  `judgment:` propose to F1, keep the n visible, and leave the calibration to the chunk that owns it.
