# PLAN-DAEMON-SUBSYSTEM — a legible, self-maintaining background-task layer

Status: **HARDENED (Fable, 2026-07-25) — reconciled against actual code, chunked, ready to fold into
`PLAN.md` for execution.** Owner-approved scope + direction (Ben, 2026-07-25). Per-topic working doc
(`docs/PLANNING.md` lifecycle); folds into `PLAN.md` and is deleted once its chunks ship.

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

## Fleet inventory (HARDENED — Fable 2026-07-25, reconciled against actual code)

| Entrypoint | Kind | git-writer? | Launch today | Evidence |
| --- | --- | --- | --- | --- |
| `pipeline/commands/sync-fills.mjs` | Neither resident nor a guard — an **on-demand command**, run to completion each invocation | `--publish` fetches/ff-pulls/commits/pushes (`sync-fills.mjs:22-25,85`); bare/`--local`/`--dry` are zero-git (`:25,304-313`) | Manually at `/overnight`; as a subprocess via `runLocalSync` (`pipeline/lib/sync-invoke.mjs:42-51`) from `screen-flip-niches.mjs:2042`, `quote-items.mjs` (`--positions` path, via `pipeline/lib/sync-invoke.mjs` import at `run-loop.mjs` too), and `watch-positions.mjs:595` | `sync-fills.mjs:11-28,73,84-85` |
| `pipeline/commands/watch-log.mjs` | **Resident** (event-driven `fs.watch` + `setInterval` heartbeat, never exits) | Zero-git always — no git call anywhere in the file (`watch-log.mjs:8-11,88`) | `serve.cmd:10` (`start /b node …watch-log.mjs`) alongside `dev-server.mjs`; can be run standalone; Ctrl+C only, **no Task Scheduler job** (`watch-log.mjs:17-18`) | `watch-log.mjs:1-111` |
| `pipeline/commands/dev-server.mjs` | **Resident** (`http.createServer`, never exits) | Zero-git for its own writes (static serve + `/api/scan` + `/api/local-file`); `/api/scan` shells out `screen-flip-niches.mjs --mode all --publish` — **naming collision**: that `--publish` is screen's OWN flag (rewrites `screen.json` locally, zero git, per `screen-flip-niches.mjs`'s own header) — NOT `sync-fills.mjs --publish`'s git-publish. Flag this collision in the registry so `local:true` isn't misread off the word "publish" | `serve.cmd:12-16` (foreground, dies with the terminal) | `dev-server.mjs:1-30` |
| `pipeline/commands/run-loop.mjs` | Not itself resident — a **time-gated driver** invoked once per external tick (by the `/loop` skill's own interval mechanism), which internally executes `sync`→`watch`→`scan` as child actions if due | Zero-git: its own `sync` action is `sync-fills.mjs --local` (`run-loop.mjs:19-24`); `scan` uses `--mode all` (no `--publish`) | Fired by `/loop <cron>m node pipeline/commands/run-loop.mjs …` — the *harness* re-invokes it, the script itself never backgrounds | `run-loop.mjs:1-38` |
| `pipeline/commands/watch-positions.mjs` | Not resident — single-pass script, same driving model as `run-loop.mjs`'s `watch` action | Zero-git — calls `runLocalSync` itself (`watch-positions.mjs:60,595`) | Direct invocation, or as `run-loop.mjs`'s `watch` action | `watch-positions.mjs:60,595` |
| `pipeline/commands/ensure-server.mjs` | **Existing manager precedent, not itself a daemon** — a liveness-check-and-nudge utility for the `watch-log`+`dev-server` pair | N/A (read-only probe + one conditional `spawn('serve.cmd', … detached:true)`) | Called at the top of `/morning` today | `ensure-server.mjs:1-92` |
| **cache-warm** (NEW, PLAN-LANE-ADMISSION dependency) | **Guard** — no resident process, heartbeat-tracked | Zero-git by construction (must only call `archive.mjs`/`marketfetch.mjs` reads + `loadAll24hRolling`/`loadBands` backfills, never import `sync-fills.mjs`) | Does not exist yet — this plan's Phase-1 deliverable | n/a |

**Correction to the plan's framing:** `ensure-server.mjs` is already a hand-rolled, working instance of exactly
the manager pattern this plan wants to generalize (liveness probe + conditional restart, self-contained,
no retry loop) — its `checkDaemon()` (heartbeat-age check, `:34-53`) and `checkServer()` (HTTP probe, `:55-67`)
are the two `healthCheck()` shapes the registry needs for resident entries. Phase 2's `watch-log`/`dev-server`
migration should **generalize `ensure-server.mjs`'s two functions into the registry**, not write new
health-check logic from scratch.

## The "newest /1h ts" query — NOT yet built (correcting the plan's assumption)

The plan assumed PLAN-LANE-ADMISSION Chunk A's `dailyRangeBulk` (`pipeline/lib/archive.mjs:194-218`) already
gives a cheap global-freshness read. It doesn't: `dailyRangeBulk`'s `coverage` is *per-day, per-requested-id*
bucket counts (`{[dateKey]: nBuckets}`), not a single "how stale is the whole `/1h` archive" scalar, and it
requires an `ids` list to be useful. There is also no existing `newestBucket`/`MAX(ts)` helper — `bucketCount()`
(`archive.mjs:294-298`) is the closest sibling (a trivial aggregate over the `buckets` table) but counts rows,
doesn't find the newest one.

**Go — trivially addable**, same shape as `bucketCount()`: the `buckets` table's PRIMARY KEY is
`(grain, ts)` (`archive.mjs:74-79`), so `SELECT MAX(ts) AS ts FROM buckets WHERE grain = ?` is an
index-covered aggregate — O(log n), no table scan, no new index needed. This is Chunk-1a's job (below);
do not build it inside the cache-warm daemon module itself (it belongs on the `archive.mjs` handle, next to
`bucketCount`, so any future consumer gets it for free).

## Build chunks (HARDENED — Fable 2026-07-25)

Ordering rule: foundations (registry shape, the tiny archive addition) before anything that calls them;
the safety guard ships in the SAME chunk as `ensure()` (never a follow-up) since an `ensure()` without the
guard is briefly a live footgun if landed alone.

### Phase 1 — home, registry, manager, cache-warm, opportunistic hook, Task Scheduler

1. **`pipeline/daemons/` home + `registry.mjs`** (foundation, sequential-first)
   - New: `pipeline/daemons/registry.mjs` — exports `DAEMONS: []`, one entry per fleet member using the
     `{ name, description, kind: 'resident'|'guard', local: boolean, healthCheck(), start() }` shape from
     the plan's Design section. Seed it with the entries that exist TODAY even before Phase 2 wires their
     real health checks (`watch-log`, `dev-server` as `resident, local:true` stubs whose `healthCheck()`
     initially just `return { ok: null, detail: 'not yet wired — Phase 2' }`) plus the new `cache-warm` entry
     with a REAL `healthCheck()`/`start()` (this phase's actual deliverable).
   - Also record the `local:false` fact for `sync-fills --publish` **as a registry-adjacent constant**, not
     an entry — it must never be schedulable, so it does not get a `start()` the manager could call (see
     Hardening Finding 1 below on physical enforcement).
   - Gotchas: registry is pure data + tiny getters — no fetch, no fs write on import (importing it must be
     side-effect-free so `manager.mjs`/tests can import it freely). Node-only module → no APP_VERSION bump.
     README "Map of the repo" gets a new entry for `pipeline/daemons/` the moment the file exists (rule 8).
   - Verification: `node --check`, plus a small fixture test enumerating `DAEMONS` and asserting every entry
     has the required shape (name/kind/local are the required fields for Chunk 2's guard to check).
   - Parallelizable: independent of Chunk 1a (archive.mjs) — can run alongside it.

1a. **`archive.mjs` — add `newestBucket(grain)`** (foundation, parallel with Chunk 1)
   - Edit `pipeline/lib/archive.mjs`: add `newestBucket(grain) { return db.prepare('SELECT MAX(ts) AS ts FROM
     buckets WHERE grain = ?').get(String(grain)).ts ?? null; }` next to `bucketCount()` (`:294-298`), same
     "test/inspection helpers" comment block, same null-safe style as the rest of the handle.
   - Gotchas: `.get()` on an empty table returns `{ts: null}`, not `undefined` — must return `null` cleanly
     (cold archive, e.g. CI or a fresh clone) so the cache-warm daemon's ">23h cold" check treats "no data
     yet" as "cold" rather than throwing. Mirror `dailyRangeBulk`'s "degrades honestly, never throws" contract
     (`:190`).
   - Validated-vs-PLACEHOLDER: the query itself is validated (index-covered, mirrors `bucketCount`'s proven
     pattern); the *threshold* that consumes it (23h) is still a PLACEHOLDER — named as such in Chunk 4.
   - Verification: unit test against a temp SQLite fixture — empty table → `null`; one row → that `ts`;
     multiple grains → filters correctly.

2. **`pipeline/daemons/manager.mjs` — `status()` + `ensure()` + the safety guard** (sequential, depends on 1)
   - New: `pipeline/daemons/manager.mjs`. `status()` iterates `registry.mjs`'s `DAEMONS`, calls each
     `healthCheck()`, returns a fleet-health array (resident: up/down; guard: last-ran/stale — mirrors the
     Design section's "both" requirement). `ensure()` iterates the same list and for any unhealthy entry
     calls `start()` — **but ONLY if `local === true`**; any entry with `local: false` is skipped with a
     logged reason, never started.
   - **The safety guard is not a comment — it's an assertion inside `ensure()` itself**: `if (!d.local) { …
     log(`refusing to auto-run git-writer daemon '${d.name}'`); continue; }` runs BEFORE any `start()` call,
     unconditionally, for every entry, every call — this is the "manager physically refuses" line from the
     plan's Design section made real.
   - Self-throttle: `ensure()` reads/writes a per-daemon `lastChecked` timestamp (see Chunk 3's storage) and
     no-ops if checked within a `MIN_CHECK_INTERVAL_MS` (PLACEHOLDER — start at 5 min, unvalidated) — this is
     what makes calling `ensure()` at the top of every scan/quote/loop pass free on the common case.
   - Gotchas: `ensure()` must never throw out to its caller (same defensive contract as `runLocalSync` —
     `sync-invoke.mjs:16-18` — a manager hiccup must not abort a market read); wrap each daemon's
     `healthCheck()`/`start()` in try/catch individually so one broken entry doesn't take down the fleet
     status for the others.
   - Verification: unit test with a fake registry (2 residents, 1 guard, 1 `local:false` entry) asserting
     `ensure()` calls `start()` on exactly the down/stale `local:true` entries and NEVER on the `local:false`
     one, even when forced unhealthy.

3. **Heartbeat/guard-state storage** (small, can ride with Chunk 2)
   - New: `pipeline/.cache/daemon-state.json` (gitignored — `pipeline/.cache/` is already blanket-ignored,
     `.gitignore:4`, and is the established home for exactly this kind of desk-side runtime state —
     `loop-state.json`, `watch-state.json`, `session-thesis.json` are the existing siblings, README
     `README.md:1436-1454`). Shape: `{ [daemonName]: { lastRan: <ISO>, lastChecked: <ISO>, ok: bool,
     detail: string } }` — one map, not one file per daemon (mirrors `watch-state.json`'s single-keyed-map
     convention rather than `heartbeat.json`'s single-purpose file).
   - Gotchas: this is DIFFERENT from `heartbeat.json` (root-level, gitignored, LW3's 30s liveness pulse for
     `watch-log.mjs` specifically, read by the browser same-origin — `.gitignore:6`, `watch-log.mjs:35-40,59`).
     Don't conflate the two: `heartbeat.json` stays root-level/app-visible for the ONE resident that has a
     browser-facing liveness stamp; `daemon-state.json` is the manager's own internal bookkeeping, desk-only,
     never fetched by the app. README gets both entries distinguished.
   - Verification: read/write round-trip test; a missing/corrupt file degrades to an empty map (same
     resilience pattern as every other `.cache/*.json` reader in this repo), never throws.

4. **The cache-warm daemon module** (sequential, depends on 1, 1a, 2, 3)
   - New: `pipeline/daemons/cache-warm.mjs` — `healthCheck()` calls `archive.mjs`'s new `newestBucket('1h')`,
     compares against `Date.now()`, returns stale if `> WARM_THRESHOLD_HOURS` (PLACEHOLDER, **23h** per the
     plan's exact spec — named as unvalidated; state what would validate it: observed coverage-gap incidents,
     which this repo doesn't have yet since the gap was only just diagnosed). `start()` calls
     `loadAll24hRolling()` + `loadBands()` (both already zero-git, check-before-fetch — `marketfetch.mjs:250-
     257,303,378-384,422`) then updates `daemon-state.json`'s `lastRan`.
   - Registered in `registry.mjs` as `{ name: 'cache-warm', kind: 'guard', local: true, healthCheck, start }`.
   - Gotchas: `start()` must be idempotent and safe to call from multiple trigger paths in the same minute
     (opportunistic hook AND a Task Scheduler tick could both fire near-simultaneously) — rely on Chunk 2's
     self-throttle (`MIN_CHECK_INTERVAL_MS`) as the de-dupe, don't add a second lock file unless the throttle
     proves insufficient. Cheap check (Chunk 1a's query) must run on EVERY `ensure()` call regardless of
     throttle — only the expensive `start()` is throttled/guarded, per the plan's "cheap check often,
     expensive backfill only when needed" design.
   - Verification: fixture archive with a stale `MAX(ts)` (>23h) → `healthCheck()` reports unhealthy →
     `ensure()` calls `start()` → `newestBucket` advances. Fresh archive → no `start()` call (assert via a
     spy/counter, not just "no error").

5. **Opportunistic `ensure()` hook** (sequential, depends on 2 and 4; touches existing files — each
   insertion point is independently reviewable, so sub-chunk in parallel once 2+4 land)
   - Insertion points (exact, cheap, no added fetch on the common/fresh case):
     - `screen-flip-niches.mjs` — alongside the existing `runLocalSync({...})` call at `:2042` (same spot,
       same "before the read" seam already proven by AR1).
     - `quote-items.mjs` — alongside its own `runLocalSync` call (its `--positions` path, same file that
       imports `runLocalSync` from `sync-invoke.mjs`).
     - `run-loop.mjs` — top of the per-tick action dispatch, so an active `/loop` session also drives
       cache-warm on its own cadence without a separate Task Scheduler tick during active hours.
     - `dev-server.mjs` boot (once, not per-request) — call `manager.ensure()` synchronously right after the
       HTTP listener starts, so opening `serve.cmd` for the day also warms the cache without waiting for a
       scan.
   - Call `manager.ensure()` **directly, in-process** — unlike `runLocalSync` (which subprocesses
     `sync-fills.mjs` because that script does real git work best kept isolated), `manager.ensure()` is
     already cheap/local/self-throttling, so no subprocess wrapper is needed; a direct import keeps it
     lower-overhead than AR1's pattern, which is fine since AR1's subprocess isolation was about git safety,
     not a general convention to copy.
   - Gotchas: must never add latency/fetch on the fresh-cache common case (self-throttle in Chunk 2 is what
     guarantees this — verify with a timing assertion, not just correctness); must never crash the caller
     (wrap in the same defensive try/catch discipline).
   - Verification: each touched script's existing test/fixture run unmodified in wall-clock time (no
     measurable regression); a targeted test asserts `ensure()` is called at each seam.

6. **Windows Task Scheduler entry** (can run parallel with 4/5 — mostly ops/docs, one new tiny `.cmd`)
   - New: `pipeline/daemons/run-cache-warm.cmd` — a one-line wrapper (`cd /d "%~dp0..\.."` then `node
     pipeline\daemons\cache-warm.mjs --check-only` or similar CLI entry into the daemon module) so
     Task Scheduler has a stable, args-free target.
   - Document (do NOT auto-run) the exact registration command in this plan + `pipeline/FILLS-PIPELINE.md`
     (a sibling note, not inside §12 itself — that section is closed history about the ELIMINATED job; this
     is a new, deliberately different, read-only-consequence job and deserves its own line so a future reader
     doesn't conflate them):
     `schtasks /create /tn "TheCofferCacheWarm" /tr "C:\dev\The-Ledger\pipeline\daemons\run-cache-warm.cmd"
     /sc hourly /mo 4 /rl limited` (every 4h, limited/non-admin run level — no elevation needed since it only
     touches gitignored local files).
   - Gotchas (see Hardening Finding 2): registering a Task Scheduler job is a **one-time, machine-local, Ben-
     attended action** — an agent session should not silently run `schtasks /create` unattended; ship the
     command as documentation + the `.cmd` wrapper, let Ben (or an explicitly-asked-for follow-up chunk) run
     the registration once.
   - Verification: manually running `run-cache-warm.cmd` once behaves identically to the opportunistic hook's
     `ensure()` call (same code path); no separate logic to verify.

### Phase 2 — migrate existing daemons, status surface, dev-server cold-start

7. Migrate `sync-fills` (guard, on-demand-only entry — registered so `status()` can report "when did we
   last sync" even though `ensure()` never auto-runs it, since its useful form (`--local`) IS `local:true`
   but its trigger is "every read", already covered by `sync-invoke.mjs` — registering it is for VISIBILITY
   in `status()`, not to add a new auto-trigger), `watch-log` (resident — generalize `ensure-server.mjs`'s
   `checkDaemon()` into its `healthCheck()`), `dev-server` (resident — generalize `checkServer()`) into
   `registry.mjs`, replacing the Phase-1 stub entries.
8. `status` surface — `pipeline/commands/read-daemons.mjs` (or fold into an existing surface) printing
   `manager.status()`'s fleet table; no APP_VERSION bump (pipeline-only stdout).
9. Wire `manager.ensure()` into `dev-server.mjs`'s cold-start path for real (Chunk 5 already added the call;
   this chunk is migrating `watch-log`/`dev-server`'s OWN health into the registry so `status()` reflects
   them, not just cache-warm).
10. Deprecate/retire `ensure-server.mjs`'s standalone logic once its two functions are folded into the
    registry entries — or keep it as a thin wrapper calling `manager.status()` for `watch-log`+`dev-server`
    specifically (Ben's call — either is fine; don't delete a working, `/morning`-wired script without an
    explicit decision).

## Hardening findings (owner-decision items)

1. **Physical enforcement of "never auto-run a git-writer" needs more than the `ensure()` guard alone.**
   The Chunk-2 `if (!d.local) continue` check is necessary but not sufficient by itself — it only protects
   against a *registered* `local:false` entry being auto-started; it does nothing if some future chunk
   registers `sync-fills --publish` as `local:true` by mistake (a copy-paste of the cache-warm entry shape
   would not catch this since `local` is a plain boolean someone has to set correctly by hand). Recommend a
   CI guard mirroring `lint-skills.mjs`'s denylist style (`pipeline/ci/`) that greps `registry.mjs` for any
   `start()`/`healthCheck()` body invoking `sync-fills.mjs` with a `--publish` flag (or anything that
   `execFileSync`/`spawn`s a command containing `--publish` used as sync-fills' git flag) and fails the build
   — a structural, denylist-style check, same philosophy as `lint-docs.mjs`. This is an owner decision:
   ship the CI guard in Phase 1 (extra chunk) or accept the code-review-time check as sufficient for now
   given the fleet is ~4-5 entries and every registration is a reviewed diff.
2. **Windows Task Scheduler registration should stay a documented, attended, one-time step — not something
   an agent runs via `schtasks /create` inside a session.** Two reasons: (a) it's genuinely one-time
   (register once, forget); (b) the repo's own history has ONE prior Task Scheduler job
   (`CofferFillsSync`) that became exactly the kind of unattended-writer risk this whole plan exists to
   avoid a second version of (`pipeline/FILLS-PIPELINE.md:543-558`) — even though `run-cache-warm.cmd` is
   provably zero-git, an agent silently registering scheduled Windows tasks is a bigger blast-radius action
   than editing a file, and CLAUDE.md's process rules don't currently cover "may an agent register OS-level
   scheduled tasks unattended" at all. Recommend treating Task Scheduler registration the same way as a
   `git push --force` or a destructive git op under this repo's existing Bash-tool norms: describe the exact
   command, let Ben run it (or explicitly say "yes, register it").
3. **`dev-server.mjs`'s `/api/scan` uses `--publish` as screen's own local-write flag, colliding in name
   with `sync-fills.mjs --publish`'s git-publish.** Not a bug today (each script's `--publish` is
   well-documented in its own header), but the registry's `local: boolean` field sitting next to human-
   readable daemon descriptions is exactly the place a future reader skims the word "publish" and assumes
   git. Recommend each registry entry's `description` field explicitly states "zero-git" or "commits to
   main" in the phrase itself, not just relying on the `local` boolean underneath prose.
4. **`run-loop.mjs` is confirmed NOT a registry resident** — it has no background/detached process of its
   own; the `/loop` skill's own recurring-invocation mechanism is what re-fires it, and each invocation
   completes and exits (time-gated internal actions, `run-loop.mjs:1-38`). Registering it as a "resident"
   would misrepresent its lifecycle (there is no PID to health-check between ticks). Confirmed default:
   stays a session-driven tool that gains the opportunistic `ensure()` hook (Chunk 5) but is never itself a
   registry entry.
5. **`heartbeat.json` (root, LW3) and the new `daemon-state.json` (`.cache/`) are deliberately two different
   files with two different audiences** — the app (browser, same-origin fetch, one resident's liveness) vs.
   the manager (desk-only, whole-fleet bookkeeping). Phase 2's `watch-log` registry entry should keep
   reading `heartbeat.json` as its `healthCheck()` source (don't invent a second heartbeat mechanism for the
   same daemon) while `daemon-state.json` separately tracks the manager's own `lastChecked`/throttle state
   for ALL entries including `watch-log`. This is a "two files, one daemon" wrinkle worth a one-line note in
   the registry entry's comment so a future editor doesn't try to unify them.
