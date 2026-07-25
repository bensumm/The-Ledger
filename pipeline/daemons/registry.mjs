/**
 * registry.mjs — the declarative fleet list (PLAN-DAEMON-SUBSYSTEM Phase-1 Chunk 1).
 *
 * THE SINGLE LEGIBLE ROSTER of every background/maintenance daemon this repo runs. The repo
 * historically had an *implicit, scattered* fleet — nobody could answer "how many background
 * things do we have, what do they do, are they up?". This module is the answer: one entry per
 * daemon, pure data + tiny getters, side-effect-free on import (so `manager.mjs` and tests can
 * import it freely — NO fetch, NO fs write, NO network at module load).
 *
 * Entry shape (the tiny interface every fleet member conforms to):
 *   {
 *     name:        string,                    // stable id, also the daemon-state.json key
 *     description: string,                    // human-readable; MUST say "zero-git" / "commits to main"
 *                                             //   in the phrase so a reader never mis-reads `local` (see
 *                                             //   the --publish naming-collision note below)
 *     kind:        'resident' | 'guard',      // resident = live PID (health = process alive);
 *                                             //   guard   = no process, heartbeat-tracked (health = ran recently)
 *     local:       boolean,                   // TRUE = zero-git, safe to auto-run unattended.
 *                                             //   FALSE = commits/pushes → NEVER auto-runnable (manager
 *                                             //   physically refuses — see manager.mjs SAFETY INVARIANT).
 *     trigger:     string,                    // how it is launched today (docs, not executed here)
 *     healthCheck(): { ok, detail, lastRan? } // ok: true|false|null (null = not-yet-wired / unknown)
 *     start():       any                      // bring it up / run the guard once; may be async
 *   }
 *
 * ── THE `--publish` NAMING COLLISION (Hardening finding #3 — read before setting any `local`) ──
 * The word "publish" means TWO different things across this fleet and is the single easiest place
 * to mis-set `local`:
 *   • `sync-fills.mjs --publish`  → GIT-WRITER: fetch/ff-pull + commit + PUSH to main. `local:false`.
 *   • `screen-flip-niches.mjs --publish` (what dev-server's /api/scan shells out) → screen's OWN
 *     flag that rewrites the LOCAL `screen.json`. ZERO git. Does NOT make dev-server `local:false`.
 * Every `description` below states "zero-git" or "commits to main" in words so the `local` boolean
 * is never inferred from the bare token "publish".
 *
 * PHASING: Phase-1 seeds this with the daemons that exist TODAY as thin stubs (watch-log,
 * dev-server — their real health checks land in Phase 2 by generalizing ensure-server.mjs's
 * checkDaemon()/checkServer()) PLUS the new `cache-warm` guard (this phase's real deliverable —
 * its module is built in Chunk 4; the entry here is tolerant of that module not yet existing so
 * this file lands and imports cleanly ahead of it). Node-only, no APP_VERSION bump.
 */

/**
 * GIT_WRITER — recorded as a registry-ADJACENT constant, deliberately NOT a DAEMONS entry.
 *
 * `sync-fills.mjs --publish` is the one git-writer in the fleet. It is documented here for
 * legibility (so a future status surface can cite the fact) but it is NOT given a `start()` the
 * manager could ever call: the safest enforcement of "never auto-run a git-writer" is to not hand
 * the manager a callable in the first place. If a future chunk DOES register it, it MUST carry
 * `local:false`, and the manager's `if (!d.local) continue` guard is the second line of defence.
 * (CI-guard recommendation: Hardening finding #1.)
 *
 * @provisional-api: Phase-1 legibility constant; the Phase-2 `status` surface (read-daemons.mjs) will
 * cite it so `status()` can report "when did we last publish". Test-covered now, no consumer until then.
 */
export const GIT_WRITER = Object.freeze({
  name: 'sync-fills-publish',
  description: 'sync-fills.mjs --publish — the once-a-day /overnight book publish: fetch/ff-pull ' +
    '(fold phone trades) + commit + PUSH fills.json/positions.json to main. COMMITS TO MAIN — ' +
    'attended/on-demand FOREVER (the CofferFillsSync lesson). Never schedulable.',
  local: false,
});

export const DAEMONS = [
  {
    name: 'cache-warm',
    description: 'cache-warm guard — keeps the /1h SQLite market archive full so PLAN-LANE-ADMISSION ' +
      "Path-A's margin doesn't degrade. Cheap check (newest /1h bucket age) on every ensure(); expensive " +
      'backfill (loadAll24hRolling + loadBands) ONLY when the newest bucket is about to age out of the ' +
      'rolling-24h window. ZERO-GIT by construction (archive/marketfetch reads + backfills only; never ' +
      'imports sync-fills.mjs).',
    kind: 'guard',
    local: true,
    trigger: 'Opportunistic ensure() at the top of scan/positions/loop + one Windows Task Scheduler tick every ~4h (deduped via the heartbeat).',
    // Tolerant of the Chunk-4 module not existing yet: dynamic-import inside try/catch so this
    // registry lands and is import-safe BEFORE cache-warm.mjs is written. Once Chunk 4 ships
    // pipeline/daemons/cache-warm.mjs (exporting healthCheck()/start()), these delegate to it with
    // zero change here. Until then they report ok:null ("not yet wired") — which the manager treats
    // as "nothing to do", never a failure.
    async healthCheck() {
      let mod;
      try { mod = await import('./cache-warm.mjs'); }
      catch { return { ok: null, detail: 'cache-warm module not built yet (Chunk 4) — no-op', lastRan: null }; }
      return mod.healthCheck();
    },
    async start() {
      let mod;
      try { mod = await import('./cache-warm.mjs'); }
      catch { return { ok: null, detail: 'cache-warm module not built yet (Chunk 4) — no-op' }; }
      return mod.start();
    },
  },
  {
    name: 'watch-log',
    description: 'watch-log.mjs live-desk daemon (LW) — fs.watch on the exchange logs + a 30s heartbeat.json ' +
      'pulse; regenerates offers.json/fills.json in-process. ZERO-GIT always (no git call anywhere in the file). ' +
      'Resident: health = live PID (Phase 2 will read heartbeat.json via the generalized ensure-server.checkDaemon()).',
    kind: 'resident',
    local: true,
    trigger: 'serve.cmd (start /b) alongside dev-server.mjs; standalone; Ctrl+C to stop. No Task Scheduler job.',
    // Phase-2 stub: real health-check = generalize ensure-server.mjs checkDaemon() (heartbeat.json age).
    // NOTE (Hardening finding #5): this resident's health source stays heartbeat.json (root-level, LW3,
    // browser-facing) — do NOT unify it with the manager's own .cache/daemon-state.json bookkeeping.
    healthCheck() { return { ok: null, detail: 'not yet wired — Phase 2 (generalize ensure-server.checkDaemon)' }; },
    start() { return { ok: null, detail: 'not yet wired — Phase 2 (resident start via serve.cmd)' }; },
  },
  {
    name: 'dev-server',
    description: 'dev-server.mjs localhost live desk — http.createServer static serve + POST /api/scan + ' +
      '/api/local-file. ZERO-GIT for its own writes. /api/scan shells `screen-flip-niches.mjs --mode all ' +
      "--publish`, but that --publish is SCREEN's own flag (rewrites screen.json LOCALLY, zero git) — NOT " +
      "sync-fills.mjs --publish's git-push. So this stays local:true despite the word \"publish\". " +
      'Resident: health = HTTP probe on :8000 (Phase 2 = generalized ensure-server.checkServer()).',
    kind: 'resident',
    local: true,
    trigger: 'serve.cmd (foreground; dies with the terminal).',
    // Phase-2 stub: real health-check = generalize ensure-server.mjs checkServer() (HTTP probe :8000).
    healthCheck() { return { ok: null, detail: 'not yet wired — Phase 2 (generalize ensure-server.checkServer)' }; },
    start() { return { ok: null, detail: 'not yet wired — Phase 2 (resident start via serve.cmd)' }; },
  },
];

/**
 * getDaemon(name) — tiny getter; returns the entry or undefined. Pure, no side effects.
 * @provisional-api: Phase-1 registry accessor for the Phase-2 `status`/`read-daemons` surface;
 * test-covered now, no production consumer until that surface lands.
 */
export function getDaemon(name) {
  return DAEMONS.find(d => d.name === name);
}
