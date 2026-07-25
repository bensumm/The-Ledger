# PLAN-DAEMON-SUBSYSTEM — a legible, self-maintaining background-task layer

Status: **DRAFT — for Fable hardening (reconcile against actual code + chunk it).** Owner-approved
scope + direction (Ben, 2026-07-25). Per-topic working doc (`docs/PLANNING.md` lifecycle); folds
into `PLAN.md` and is deleted once its chunks ship.

## Why

The repo already has an **implicit, scattered daemon fleet** — nobody can currently answer "how many
background things do we have, what do they do, and are they up?" Known members (Fable to inventory
precisely): `pipeline/commands/sync-fills.mjs` (RuneLite → book), `watch-log.mjs` (the LW live-desk
daemon, zero-git), `dev-server.mjs` (localhost LW desk / `POST /api/scan`), the `run-loop.mjs` /
`watch-positions.mjs` monitor loop, and the NEW **cache-warm** need (PLAN-LANE-ADMISSION Chunk A's
`/1h` archive must stay full or Path-A's margin degrades — coverage only accrues today as a
side-effect of a manual scan/positions run; a >1-day gap punches a permanent hole).

Goal: **organize them into one home + registry + a lightweight manager**, and make the maintenance
guards (esp. cache-warm) **forward-looking** — act when an invariant is about to break, not on a dumb
timer. This is the polling → forward-looking transition: guards maintain invariants (coverage-fresh,
book-synced) and the accrual harness (PLAN-LANE-ADMISSION H1–H3) is the forward-looking *data* layer.

## Design

### Two KINDS of daemon (the distinction that makes the manager tractable)
- **Resident process** (`watch-log`, `dev-server`) — "running" = a live PID; tracked via a lock/PID
  file. Health = process alive.
- **Periodic guard** (`cache-warm`, on-demand `sync-fills`) — no resident process; "running" is
  meaningless. Tracked via a **last-successful-run heartbeat**. Health = ran recently enough.

The manager MUST model both; a `status` shows resident up/down AND guard last-ran/stale.

### The registry (declarative)
`pipeline/daemons/registry.mjs` — one entry per daemon: `{ name, description, kind:'resident'|'guard',
trigger, local:boolean, healthCheck(), start() }`. Each daemon is a small module in
`pipeline/daemons/` conforming to a tiny interface. The registry is the single legible list
("how many, what they do").

### The manager (lightweight — NOT a general supervisor framework)
`pipeline/daemons/manager.mjs` — `status()` (fleet health) + `ensure()` (start any down resident /
run any stale guard, self-throttling). Do not build systemd for ~4 daemons.

### The SAFETY INVARIANT (reconciles this with the deliberately-eliminated CofferFillsSync)
`CofferFillsSync` was killed because it **wrote to git unattended** (clobber/PII risk,
`pipeline/FILLS-PIPELINE.md` §12). The rule the manager MUST encode: **unattended/scheduled runs are
allowed ONLY for `local:true` (zero-git) daemons** (cache-warm, local fills rebuild). Anything that
commits/pushes (`sync-fills --publish`) stays `local:false` → **attended/on-demand forever**; the
manager physically refuses to auto-run a git-writer. This is not reviving CofferFillsSync — it's the
read-only cousin it should have been.

### Two triggers (Windows reality — no systemd)
- **Opportunistic** (covers ~all active use, zero infra): `manager.ensure()` as a silent, cheap,
  self-throttling check hooked into common workflows — top of scan/positions/loop, and dev-server
  boot (the cold-start hook). Costs nothing when everything's fresh.
- **External** (covers the away case): ONE Windows Task Scheduler entry running the warm daemon every
  few hours, so a weekend away doesn't punch a coverage hole. Same daemon; the manager dedupes via the
  heartbeat.

### The cache-warm daemon (forward-looking, data-driven — Ben's exact spec)
NOT a fixed-timer poll. The **check** runs cheaply (hourly, or on any opportunistic `ensure()`): read
the **newest `/1h` timestamp in the archive** (one indexed query). If it's **> 23h cold** (about to
lose a bucket to the rolling-24-window walk / wiki retention), **warm** — run the backfilling read
(`loadAll24hRolling` + `loadBands`). Cheap check often; expensive backfill only when an invariant is
about to break. `local:true`, zero-git.

## Phasing

- **Phase 1 (now — unblocks Path-A coverage):** `pipeline/daemons/` home + `registry.mjs` +
  `manager.mjs` (`status`/`ensure`, self-throttle, the `local`-only-unattended guard) + the
  **cache-warm daemon** (data-driven >23h rule) + the opportunistic `ensure()` hook on common
  workflows + the Windows Task Scheduler entry. Coverage insurance AND the structure, born organized.
- **Phase 2 (follow-up):** migrate `sync-fills` / `watch-log` / `dev-server` into the registry; add
  the `status` view (a `/daemons` or `read-daemons.mjs` surface); wire cold-start `ensure()` into
  dev-server boot.

## Open items / for Fable hardening (rule 4)

- **Precise fleet inventory** — enumerate every long-running / background entrypoint in
  `pipeline/commands/`, classify each resident-vs-guard and `local`-vs-git-writer.
- **The "newest archived /1h ts" query** — confirm the archive schema supports a cheap
  `MAX(ts) WHERE grain='1h'` (Chunk A's archive already added a read path; reuse it).
- **Heartbeat storage** — where the last-run timestamps live (a small `pipeline/.cache/daemon-state.json`?
  gitignored, local-only).
- **Resident health check** — PID/lock-file mechanics for `watch-log`/`dev-server` on Windows.
- **Windows Task Scheduler** — exact registration (a `.cmd` + `schtasks` invocation?) and whether to
  ship a one-time installer or document it.
- **Throttle constants** — the >23h warm threshold + the opportunistic-check min-interval are
  PLACEHOLDERS until observed; name them as such.
- **Relationship to `run-loop.mjs`** — the loop already backfills via its scan; does the loop become a
  registry-managed resident, or stay a session-driven tool the manager just observes?
