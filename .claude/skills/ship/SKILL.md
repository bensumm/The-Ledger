---
name: ship
version: 2.0
description: Land a change via PR + merge queue and verify it — open the PR, confirm the CI checks run and the Pages deploy are green; also holds the CI/workflow-editing and gh guardrails. Triggers — "ship it", "push this", "open a PR", "commit and push", "is it live", "check the deploy", "check CI", any change landing on main.
---

# /ship — push to main + verify it actually landed

Skills-versioning note: `version` here bumps on material behavior change; skills never bump
`APP_VERSION`.

## 1. Preflight (CLAUDE.md process rules, condensed)

- Change described to Ben in prose before/with the push (rule 6). Pipeline auto-commits are
  exempt — no agent is present for those.
- Doc reconciliation pass done (rule 8) — grep for statements the change supersedes.
- Version bump correct (rule 5): app change → `APP_VERSION` in `js/state.js`; skills-only →
  the SKILL.md `version:`; pipeline-stdout-only → no bump, note it in the commit message.
- No PII in any tracked file — the repo is public.

## 2. Land the change — branch → PR → merge queue

Since G1 (2026-07-04) `main` is protected: it takes a **pull request** with the `checks`
run green, and a **merge queue** serializes concurrent work. Do NOT push commits straight to
`main` for ordinary changes.

```
git switch -c <short-branch>
# ... your commits ...
git push -u origin <short-branch>
gh pr create --fill                 # NOT --draft when it's ready to land
gh pr merge --squash --auto         # queues it; the queue merges once checks pass
```

The queue re-runs `checks` on the `merge_group` ref before merging, so a green PR that goes
stale behind another merge is re-verified automatically. Rebase your branch on `origin/main`
if it drifts far; **never force-push `main` itself.** git stays on git-over-SSH; `gh` does the
PR/queue management (§5).

**The one exception — attended on-demand data syncs.** `node pipeline/sync-fills.mjs` still
pushes `fills.json`/`positions.json`/`suggestions.jsonl` **directly to `main`**, riding Ben's
admin ruleset bypass (the attended actor is Ben or an agent acting as him). Deliberate: those
are pipeline-owned artifacts, the sync is on-demand (no unattended writer exists anymore — the
20-min `CofferFillsSync` job was eliminated, FILLS-PIPELINE.md §12), and the sync's
clobber-guard fast-forwards onto a PR-merged `main` before committing. If a manual sync push
is ever rejected by the ruleset, re-run the sync (the guard reconciles) or land the data via a
PR like anything else. On a rebase conflict on `fills.json`/`positions.json`, take the remote
side — those files are pipeline-owned.

## 3. Verify — not done until the runs are green

```
gh run list -L 3
```

- The **`checks`** run on your PR (and its `merge_group` re-run) must reach
  `completed success` — the queue won't merge otherwise.
- After the merge, for app-touching changes the **`pages-build-deployment`** run on `main`
  must too (that's the live-site deploy). Follow one live with `gh run watch <databaseId>`.
- Don't call the change done (or end the session) before both are green.

Triage on red:
- Red on **your PR** → fix forward on the branch; the queue re-verifies. `main` is the
  deployed app, so nothing lands until the check passes — that's the point of the gate.
- Red on a `fills: sync` commit (an attended data sync that pushed direct to `main`, §2) →
  CI is the guard on those. Investigate the sync before anything else; don't stack a change
  on top of a broken `main`.

## 4. CI / workflow editing (agents may add & improve — Ben, 2026-07-04)

`.github/workflows/checks.yml` runs on push to `main`, PRs, `merge_group`, and manual
dispatch: `node --check` over `js/*.js` + `pipeline/*.mjs`, the quotecore acceptance
fixtures (`node pipeline/quotecore.test.mjs`), and JSON-parse of `fills.json`/
`positions.json`. Constraints on any workflow change:

- **Public repo → public logs.** No PII in output; no secrets in output — and none are
  currently needed anywhere in CI: keep it that way if at all possible.
- **Nothing that reads `~/.runelite` can run in CI.** The fills sync is permanently a
  Task Scheduler job on Ben's machine.
- **Keep CI seconds-fast.** Cheap invariants only on the hosted runner. A fixture test
  shipped without a CI hook is a wasted fixture — wire new ones into checks.yml.
- Keep the `merge_group` trigger — it's required for the future merge queue.
- A workflow change is a normal change: describe it to Ben, and verify its own run goes
  green after pushing.
- Ben has a **Mac mini available as a self-hosted runner** — future enhancement for jobs
  needing a real browser or local resources (e.g. Playwright smoke of the deployed app).
  Don't set it up unprompted.

## 5. gh guardrails

- git operations stay on **git-over-SSH**; `gh` is the API layer only (runs, logs,
  `gh api`, and PR management once the PR flow lands).
- **Never run `gh auth setup-git`** — it would hijack git's credential helper onto the
  gh token. If git ever starts prompting for credentials, check
  `git config --get-all credential.helper`.

## 6. PR flow + merge queue — NOW OPERATIVE (G1 landed 2026-07-04)

`main` is protected by a GitHub ruleset requiring a PR + the `checks` status check; a merge
queue serializes concurrent agent work (the reason G1 existed — parallel subagents kept
colliding on `main`). `checks.yml` runs on `merge_group`, so the queue re-verifies each PR
against the just-merged tip.

- **Everything lands via PR** (§2), including agent chunk work. The coordinator no longer
  rebases parallel lanes onto `main` by hand — the queue does the serialization.
- **Attended data syncs are the sole direct-to-main exception** (§2), riding Ben's admin
  bypass. No machine/deploy-key bypass identity exists — the schedule that would have
  needed one was eliminated (FILLS-PIPELINE.md §12).
- The enabling decision (why the schedule died, the full dependency inventory) is
  FILLS-PIPELINE.md §12; the ruleset/queue config as landed is recorded there and in the G1
  commit.
