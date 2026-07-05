# PLAN — Local log-watcher: real-time app freshness without an unattended writer

**Origin:** Ben, 2026-07-05 — "Can we have some process watch the log file and
automatically sync?" Decision: **option 1** — regenerate locally on every log change,
never auto-commit/push. Keeps the §12 invariant (FILLS-PIPELINE.md: *no unattended
writer to `main`*) fully intact: the daemon does **zero git operations**. Publishing to
Pages (and therefore the phone) stays attended and on-demand, exactly as today.

## Goal

While Ben is at the PC with RuneLite running, the locally-served app
(`serve.cmd` → localhost) shows positions **and active offers** fresh within ~seconds
of every fill/cancel/reprice — no keystrokes, no commits. The deployed
(bensumm.github.io) app is unchanged: as-of-last-attended-sync, honestly stamped.
This is the enabling layer for the planned in-app Watch tab (mockup reviewed by Ben
2026-07-05): it removes the "offers are stale in the browser" gap at the desk.

## Design (two small chunks + docs)

### Chunk LW1 — `--local` mode on sync-fills + `offers.json` emitter + the daemon

1. **`sync-fills.mjs --local`**: a flag that runs the existing pipeline
   (read `~/.runelite/exchange-logger/*` + manual log + tombstones → merge with
   existing `fills.json` → reconstruct → write `fills.json` / `positions.json`)
   but **skips every git step** (no fetch/ff, no commit, no push; `syncMainToRemote`
   not called). Reuse, don't duplicate: the daemon gets tombstones, dedupe, and the
   FIFO matcher for free, and the artifacts stay byte-compatible with an attended
   sync. Note in-file: `--local` does NOT fold un-pulled phone writes
   (`mobile-fills.log` beyond the local checkout's version) — that's the attended
   sync's job; acceptable because local mode serves desk-side freshness only.
2. **New root artifact `offers.json`** (written in BOTH modes, tracked like
   `positions.json` so the deployed app can render it with a staleness banner later):
   `{ generatedAt, offers: [{ slot, side ('buy'|'sell'), itemId, item, price, qty,
   filled, lastUpdateTs }] }` — source: the existing `pipeline/lib/offers.mjs`
   reader (`readExchangeLog()` + `activeOffers()`). Keep the schema dumb and flat;
   the app/Watch-tab does presentation.
3. **`pipeline/watch-log.mjs`** — the daemon: `fs.watch` on
   `~/.runelite/exchange-logger/` (the dir, so log rotation is caught), debounce
   ~10s, then run the `--local` regeneration in-process (import the same entry
   function; child-process spawn acceptable if the import refactor is invasive).
   Console line per regeneration (`hh:mm regenerated — N events, M open offers`).
   Started manually (`node pipeline/watch-log.mjs`, plus a `watch-log.cmd`
   convenience wrapper); dies with the terminal; **no Task Scheduler job — that's
   the point.** Known cache caveat: on a client restart the plugin re-emits nothing
   until slots change (the 2026-07-05 EMPTY-burst lesson) — the daemon inherits
   whatever the log says; `buildEvents()` already ignores EMPTY lines, so restarts
   regenerate identical artifacts, harmlessly.
4. **Tests** (auto-discovered by `pipeline/run-tests.mjs`, no CI edits): a fixture
   test for the offers.json emitter (synthetic log lines → snapshot shape,
   filled/qty carried, EMPTY slots excluded); an invocation-guard check that
   `--local` performs no git calls (e.g. inject/spy the git exec fn, or assert the
   git module is never imported on that path — match how the repo already tests
   sync behavior in `sync-fills.test.mjs` if present).

### Chunk LW2 — app: localhost live-refresh (APP_VERSION bump)

1. When served from localhost (`location.hostname === 'localhost' || '127.0.0.1'`),
   poll `positions.json` + `offers.json` every ~30s (compare `generatedAt`; only
   re-render on change). On the deployed origin: behavior unchanged (M1
   Refresh-positions button + staleness banner remain the mechanism).
2. Freshness stamp in the header/Ledger panel: "book synced hh:mm" from
   `generatedAt`, colored stale past ~10 min **only on localhost** (on Pages the
   existing M1 banner semantics stand — don't double-banner).
3. No Watch-tab UI in this plan — that's its own future chunk (mockup exists);
   this chunk just guarantees the data under it is live at the desk.

### Chunk LW3 — documentation reconciliation (process rule 8)

- `pipeline/FILLS-PIPELINE.md`: new §14 (local watcher — what it writes, what it
  never does: no git, no phone-fold); **amend §12 in place** to say the no-unattended-
  writer invariant is about *writers to `main`* and the local daemon doesn't breach it
  (grep §12/§13 for "no unattended writer" phrasings and reconcile each).
- `README.md` map: `offers.json` joins the app-fetched root artifacts;
  `watch-log.mjs` + `watch-log.cmd` join pipeline-only.
- `CLAUDE.md`: one Done pointer; add `offers.json` to the ROOT-LOCKED/app-fetched
  artifact split sentence; note serve.cmd is now the *live* desk experience.
- `pipeline/MONITORING.md`: note that console `watch.mjs` remains the zero-lag
  authority; the app's localhost view trails it by the debounce only.

## Constraints / guardrails for the implementer

- **No git in the daemon path, ever** — that's the §12 invariant this design exists
  to preserve. If a future need for auto-*publish* appears, that's a separate Ben
  decision (it reverses §12), not scope creep here.
- Never touch `~/.runelite` sources as anything but read-only input (existing rule).
- `positions.json`/`fills.json`/`offers.json` are pipeline-owned root artifacts: the
  daemon writing them mid-session means the working tree is often dirty with
  regenerated artifacts — the attended sync already regenerates before committing,
  so this is benign; do NOT "fix" it by gitignoring tracked artifacts.
- Pipeline-only parts ship without an APP_VERSION bump (noted in commit message);
  LW2 bumps APP_VERSION (deployed-app change).
- Windows: `fs.watch` on a directory is fine on NTFS but fires duplicate/rename
  events — debounce handles it; don't add a polling fallback unless it proves flaky
  in practice (keep it simple first).

## Status — ALL SHIPPED (2026-07-05)

| Chunk | What | Status | Sha |
| --- | --- | --- | --- |
| LW1 | `--local` mode + `regenerate()` core + `offers.json` emitter + `watch-log.mjs` daemon + tests | **shipped** | `b97c87b` (+ initial `offers.json` `d395864`) |
| LW2 | app localhost live-refresh (poll `positions.json`/`offers.json`, "book synced" stamp; APP_VERSION 0.48.0) | **shipped** | `9da9910` |
| LW3 | documentation reconciliation (FILLS-PIPELINE §14 + §12 amend, README map, CLAUDE.md Done, CHANGELOG 0.48.0, MONITORING authority note) | **shipped** | this commit |

## Acceptance

1. Daemon running + a GE offer placed/filled in-game → localhost app reflects it
   within ~40s (debounce + poll) with no keystrokes and **zero new git commits**.
2. `git log` after a 2h daemon session shows only attended sync commits.
3. Attended `sync-fills.mjs` (no flag) behavior byte-identical to today, plus the
   new `offers.json` in its commit set.
4. All suites green via `pipeline/run-tests.mjs` (new tests auto-discovered).
5. Deployed Pages app behavior unchanged except the (stale-stamped) `offers.json`
   availability.
