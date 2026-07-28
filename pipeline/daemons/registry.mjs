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
 * PHASING: Phase-1 seeded this with the daemons that exist TODAY as thin stubs (watch-log,
 * dev-server) PLUS the new `cache-warm` guard. Phase-2 (Chunk 7) then wired the residents' REAL
 * health checks by generalizing ensure-server.mjs's checkDaemon()/checkServer() into the shared
 * health.mjs (heartbeatHealth / httpProbeHealth), and registered `sync-fills` as a visibility-only
 * guard (see its entry). Node-only, no APP_VERSION bump.
 *
 * ── THE `autoRun` FIELD (Phase-2) ──
 * `local` says "safe to auto-run at all" (git-safety). `autoRun` says "SHOULD the manager auto-run
 * it in ensure()". Only the cache-warm guard is auto-run (autoRun omitted → defaults true). Every
 * other entry is `autoRun:false` — VISIBLE in status() but never started by ensure():
 *   • sync-fills — already rides EVERY read via sync-invoke.runLocalSync; registering it adds
 *     freshness VISIBILITY to status(), NOT a second auto-trigger.
 *   • watch-log / dev-server — residents started ATTENDED via serve.cmd (or ensure-server.mjs at
 *     /morning); ensure() must never surprise-spawn an HTTP server on a routine scan/quote pass.
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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { heartbeatHealth, httpProbeHealth } from './health.mjs';

// Repo root, for the resident/guard health checks below. Pure path math — NO fs/network at import
// (statSync/read only run when a healthCheck() is actually called), so importing stays side-effect-free.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');

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
      'backfill (loadAll24hRolling + loadBands) only when the newest bucket is older than ' +
      'WARM_THRESHOLD_HOURS (3h — kept BELOW the 4h Task Scheduler tick so the lag stays bounded). Keeps ' +
      'the LEADING EDGE current only; repairing holes already in the archive is the separate deliberate ' +
      'job pipeline/commands/backfill-archive.mjs. ZERO-GIT by construction (archive/marketfetch reads + ' +
      'backfills only; never imports sync-fills.mjs).',
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
    name: 'sync-fills',
    description: 'sync-fills.mjs --local — the ZERO-GIT book rebuild (RuneLite exchange logs → ' +
      'fills.json/positions.json/offers.json). This entry is the LOCAL form ONLY; the --publish git form ' +
      '(fetch/ff-pull + commit + PUSH to main) is the SEPARATE GIT_WRITER const above, never this entry. ' +
      'Guard: health = book freshness (positions.json mtime). autoRun:false — it already rides EVERY read ' +
      'via sync-invoke.runLocalSync, so registering it adds freshness VISIBILITY to status(), NOT a new ' +
      'auto-trigger the manager would fire.',
    kind: 'guard',
    local: true,
    autoRun: false,
    trigger: 'runLocalSync (sync-invoke.mjs) at the top of every scan/positions/watch/loop read; attended --publish at /overnight.',
    // Freshness only — a plain fs.statSync on the rebuilt artifact. Deliberately does NOT import or spawn
    // sync-fills.mjs (that would trip check-daemon-safety and, more importantly, is not this guard's job).
    healthCheck() {
      try {
        const st = fs.statSync(join(REPO_ROOT, 'positions.json'));
        const ageMin = Math.round((Date.now() - st.mtimeMs) / 60000);
        // "stale" past ~26h just flags a cold book; ensure() never acts on it (autoRun:false).
        return { ok: (Date.now() - st.mtimeMs) < 26 * 3600_000, detail: `book (positions.json) ${ageMin}m old`, lastRan: new Date(st.mtimeMs).toISOString() };
      } catch {
        return { ok: false, detail: 'positions.json not found', lastRan: null };
      }
    },
    start() { return { ok: null, detail: 'on-demand only — runs via runLocalSync every read (--local); attended at /overnight (--publish)' }; },
  },
  {
    name: 'watch-log',
    description: 'watch-log.mjs live-desk daemon (LW) — fs.watch on the exchange logs + a 30s heartbeat.json ' +
      'pulse; regenerates offers.json/fills.json in-process. ZERO-GIT always (no git call anywhere in the file). ' +
      'Resident: health = heartbeat.json freshness (the LW3 browser-facing pulse).',
    kind: 'resident',
    local: true,
    autoRun: false,
    trigger: 'serve.cmd (start /b) alongside dev-server.mjs; standalone; Ctrl+C to stop. No Task Scheduler job.',
    // Phase-2: real health-check via the shared health.mjs (generalized from ensure-server.checkDaemon()).
    // NOTE (Hardening finding #5): this resident's health source STAYS heartbeat.json (root-level, LW3,
    // browser-facing) — deliberately NOT unified with the manager's own .cache/daemon-state.json bookkeeping.
    // start() is attended-only (autoRun:false): ensure() must never surprise-spawn serve.cmd on a routine pass.
    healthCheck() { return heartbeatHealth({ path: join(REPO_ROOT, 'heartbeat.json') }); },
    start() { return { ok: null, detail: 'attended — started via serve.cmd (start /b, with dev-server); ensure() never auto-spawns a resident' }; },
  },
  {
    name: 'dev-server',
    description: 'dev-server.mjs localhost live desk — http.createServer static serve + POST /api/scan + ' +
      '/api/local-file. ZERO-GIT for its own writes. /api/scan shells `screen-flip-niches.mjs --mode all ' +
      "--publish`, but that --publish is SCREEN's own flag (rewrites screen.json LOCALLY, zero git) — NOT " +
      "sync-fills.mjs --publish's git-push. So this stays local:true despite the word \"publish\". " +
      'Resident: health = HTTP probe on :8000 (generalized ensure-server.checkServer()).',
    kind: 'resident',
    local: true,
    autoRun: false,
    trigger: 'serve.cmd (foreground; dies with the terminal).',
    // Phase-2: real health-check via the shared health.mjs (generalized from ensure-server.checkServer()).
    // async: httpProbeHealth awaits a localhost fetch. start() attended-only (autoRun:false) — same reason as watch-log.
    async healthCheck() { return httpProbeHealth({ url: `http://127.0.0.1:${Number(process.env.COFFER_DEV_PORT) || 8000}/` }); },
    start() { return { ok: null, detail: 'attended — started via serve.cmd (foreground); ensure() never auto-spawns a resident' }; },
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
