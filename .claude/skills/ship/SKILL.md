---
name: ship
version: 2.3
description: Land a change on main (attended direct-push under the admin bypass today; PR + checks once the gh token is refreshed) and verify it — confirm the CI checks run and the Pages deploy are green; also holds the CI/workflow-editing and gh guardrails. Triggers — "ship it", "push this", "open a PR", "commit and push", "is it live", "check the deploy", "check CI", any change landing on main.
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

## 2. Land the change

Since G1 (2026-07-04) `main` carries a protection ruleset (PR + green `checks` required, no
force-push, no branch deletion). **Two current limitations** shape how you actually land work
— be honest about them (§6 has the full state):
- **No merge queue.** It is unavailable on this *user-owned* repo (the ruleset `merge_queue`
  rule is rejected; a queue needs an org on Team/Enterprise). Enforcement is ruleset PR +
  `checks` only — nothing serializes concurrent PRs automatically.
- **PR creation is currently blocked by the gh token.** `createPullRequest` returns
  `FORBIDDEN` (the token can read PRs and do admin writes, but not open them). Fixing it
  needs an interactive `gh auth refresh -s repo` (Ben) — see §5. Until then the PR path
  cannot be exercised.

**Practical landing path today — attended direct-push under the admin bypass.** Ben and
agents acting as him are repo admin and have an always-on ruleset bypass, so they push to
`main` directly (this is also exactly how the on-demand sync pushes). Rebase on
`origin/main` first; **never force-push `main`.**

```
git fetch origin && git rebase origin/main && git push origin main
```

**The intended path once the token is refreshed** (checks gate it; still no queue, so
serialize by hand if lanes overlap):

```
git switch -c <short-branch>
git push -u origin <short-branch>
gh pr create --fill                 # NOT --draft when it's ready to land
# wait for `checks` green, then:
gh pr merge --squash                # or --squash --auto (auto-merge on green)
```

**On-demand data syncs always push direct to `main`** regardless — `node
pipeline/commands/sync-fills.mjs` writes `fills.json`/`positions.json`/`suggestions.jsonl`, riding the
admin bypass; the sync is on-demand (no unattended writer exists anymore — the 20-min
`CofferFillsSync` job was eliminated, FILLS-PIPELINE.md §12), and its clobber-guard
fast-forwards onto the current `main` before committing. On a rebase conflict on those files,
take the remote side — they're pipeline-owned.

## 3. Verify — not done until the runs are green

```
gh run list -L 3
```

- The **`checks`** run for your commit/PR must reach `completed success`.
- For app-touching changes the **`pages-build-deployment`** run on `main` must too (that's
  the live-site deploy). Follow one live with `gh run watch <databaseId>`.
- Don't call the change done (or end the session) before both are green.

Triage on red:
- Red on **your** commit/PR → fix forward immediately; `main` is the deployed app. (Note:
  an admin direct-push bypasses the required check, so CI runs *after* the push — watch it.)
- Red on a `fills: sync` commit (an attended data sync that pushed direct to `main`, §2) →
  CI is the guard on those. Investigate the sync before anything else; don't stack a change
  on top of a broken `main`.

## 4. CI / workflow editing (agents may add & improve — Ben, 2026-07-04)

`.github/workflows/checks.yml` runs on push to `main`, PRs, `merge_group`, and manual
dispatch. Two jobs: a cheap **`checks`** job (`node --check` over `js/*.js` + `pipeline/*.mjs`,
the auto-discovered acceptance fixtures `node pipeline/ci/run-tests.mjs` — one runner that
recursively finds and runs every `pipeline/**/*.test.mjs`, so adding a test file needs no CI
edit — and JSON-parse of `fills.json`/`positions.json`) and a
separate **`smoke`** job (CI1) that installs Playwright chromium and runs
`node pipeline/ci/smoke-test.mjs` — a headless DOM smoke of `index.html` with all external network
stubbed, failing on any page error / app console error / empty pane. Split jobs so the cheap
one fails fast. Constraints on any workflow change:

- **Public repo → public logs.** No PII in output; no secrets in output — and none are
  currently needed anywhere in CI: keep it that way if at all possible.
- **Nothing that reads `~/.runelite` can run in CI.** The fills sync runs on Ben's machine
  on demand (`node pipeline/commands/sync-fills.mjs`) — the scheduled job was eliminated
  (FILLS-PIPELINE.md §12), but CI still can never see the local logs.
- **Keep CI seconds-fast.** Cheap invariants only on the hosted runner. A fixture test
  shipped without a CI hook is a wasted fixture — wire new ones into checks.yml.
- Keep the `merge_group` trigger — harmless now (no queue on this user-owned repo, §6) but
  required if the repo ever moves under an org and a merge queue becomes available.
- A workflow change is a normal change: describe it to Ben, and verify its own run goes
  green after pushing.
- Ben has a **Mac mini available as a self-hosted runner** — future enhancement for jobs
  needing a real browser or local resources (e.g. Playwright smoke of the deployed app).
  Don't set it up unprompted.

## 5. gh guardrails

- git operations stay on **git-over-SSH**; `gh` is the API layer (runs, logs, `gh api`,
  ruleset management, and PR management — but PR *creation* is currently token-blocked, §6).
- **To unblock the PR path:** `gh auth refresh -s repo` (interactive — Ben only; the current
  token returns `FORBIDDEN` on `createPullRequest` and lacks the `workflow` scope). This is a
  one-time fix; it does not change git's SSH transport.
- **Never run `gh auth setup-git`** — it would hijack git's credential helper onto the gh
  token. If git ever starts prompting for credentials, check
  `git config --get-all credential.helper`.

## 6. Branch protection as landed by G1 (2026-07-04) — honest state

`main` carries a GitHub ruleset (id `18520289`, "main protection"): rules = `pull_request`
(0 approvals — Ben is solo), `required_status_checks` (context `checks`), `non_fast_forward`,
`deletion`; **bypass = repository-admin role, mode `always`.** The enabling decision (why the
schedule died, the full dependency inventory) is FILLS-PIPELINE.md §12.

What actually works vs. what was intended:
- **Schedule eliminated → on-demand sync: DONE and verified.** No unattended writer to
  `main`; no machine/deploy-key bypass identity exists.
- **Admin bypass DONE and verified** — a direct `sync-fills.mjs` push landed on protected
  `main`, so Ben/agents-as-Ben can push directly (the practical path, §2).
- **Merge queue: NOT AVAILABLE.** This is a *user-owned* repo; the ruleset `merge_queue` rule
  is rejected (a queue needs an org on GitHub Team/Enterprise). Enforcement is ruleset PR +
  `checks` only — no automatic serialization of concurrent PRs. Revisit only if the repo
  moves under an org.
- **PR creation: BLOCKED by the current gh token** (`createPullRequest` → `FORBIDDEN`). The
  token reads PRs and does admin writes but can't open them, and lacks the `workflow` scope a
  standard `gh auth login` grants. **To enable the PR path, Ben runs `gh auth refresh -s
  repo` (interactive)**; agents can't do this (no interactive auth). Until then, land via
  attended direct-push under the admin bypass (§2).

Net: the ruleset scaffolding is in place and the sync-cadence half of G1 is fully live; the
PR-for-everything flow is available/encouraged but not yet exercisable (token) and not
queue-serialized (user repo). Don't claim a working merge queue.

## 7. Multi-lane dispatch (coordinator + subagents)

The dispatch model when a wave has multiple lanes (PLAN.md's "Dispatch model"). Per lane:

1. **Coordinator commits the plan file into the lane worktree** — the subagent starts with the
   plan already on disk in its isolated worktree (`isolation: "worktree"`).
2. **An Opus subagent implements the chunk** chunk-by-chunk with local commits, running
   `node --check` on every touched file and `node pipeline/ci/run-tests.mjs` when a tested module
   is touched.
3. **Coordinator verifies** the result against the chunk's Acceptance criteria.
4. **On Ben's "merge":** `git fetch && git rebase origin/main` → re-run the tests →
   `git push origin HEAD:main` (§2 admin bypass — never force-push `main`).
5. **Poll `gh run list`** until both `checks` and (for app changes) `pages-build-deployment`
   go green (§3).
6. **`git pull --ff-only` the desk checkout** (`C:\dev\The-Ledger`), removing any untracked
   copy of a file the branch newly tracks (an untracked local file blocks the ff of a newly
   tracked path).

**Overlapping lanes are hand-serialized** — land one at a time, rebasing each on the prior
(there is no merge queue on this user-owned repo, §6). Disjoint-file lanes may land in any
order; same-function overlaps must be sequenced.
