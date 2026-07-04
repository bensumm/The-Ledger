---
name: ship
version: 1.0
description: Push a change to main and verify it landed — rebase-push, then confirm the CI checks run and the Pages deploy are green; also holds the CI/workflow-editing and gh guardrails. Triggers — "ship it", "push this", "commit and push", "is it live", "check the deploy", "check CI", any push to main.
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

## 2. Push

The fills pipeline auto-commits to `main` every ~20 min (`CofferFillsSync`), so a
mid-session remote commit is NORMAL, not a conflict someone caused:

```
git fetch origin && git rebase origin/main && git push origin main
```

Rebase, never merge (standing rule). If the rebase conflicts on `fills.json`/
`positions.json`, take the remote side and re-run your change's path — those files are
pipeline-owned.

## 3. Verify — a push isn't done until the runs are green

```
gh run list -L 3
```

- The **`checks`** workflow run for your commit must reach `completed success`.
- For app-touching changes, the **`pages-build-deployment`** run must too (that's the
  live-site deploy). Follow one live with `gh run watch <databaseId>`.
- Don't call the change done (or end the session) before both are green.

Triage on red:
- Red on **your** commit → fix forward immediately; `main` is the deployed app.
- Red on a `fills: auto-sync` commit → the unattended pipeline landed something broken
  (CI is the *only* guard on those commits). Investigate the sync before anything else;
  don't just push your change on top.

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

## 6. Direction of travel — PR flow + merge queue (PLAN.md chunk G1, not yet enabled)

Ben wants PR-for-everything with a merge queue (concurrent agent work → conflicts on
`main`), sequenced BEFORE the M1/N1 big chunks. The blocker is the unattended 20-min
sync push; Ben's read is the manual/on-demand flow covers ~99% of his use, so G1 step 0
investigates demoting the schedule to on-demand or eliminating it — which would remove
the need for any bypass identity. Full migration order lives in PLAN.md G1. **Until G1
lands, direct-to-main (this skill) is the operative workflow** — don't half-adopt PRs.
