/**
 * manager.mjs — the lightweight fleet manager (PLAN-DAEMON-SUBSYSTEM Phase-1 Chunk 2 + 3).
 *
 * TWO functions, no supervisor framework (there are ~4 daemons — do NOT build systemd):
 *   • status()  — read fleet health: for each registry entry call healthCheck() and merge the
 *                 stored heartbeat. Residents report up/down; guards report last-ran/stale. READ-ONLY.
 *   • ensure()  — bring the fleet to health: start any DOWN resident / run any STALE guard,
 *                 self-throttling so calling it at the top of every scan/quote/loop pass is free on
 *                 the common (already-fresh) case.
 *
 * ════════════════════════ THE SAFETY INVARIANT (non-negotiable) ════════════════════════
 * `ensure()` MUST REFUSE to auto-run ANY `local:false` daemon. A `local:false` daemon is a
 * git-writer (commits/pushes — e.g. `sync-fills.mjs --publish`); auto-running one unattended is
 * exactly the CofferFillsSync mistake that got that scheduler ELIMINATED (clobber/PII risk,
 * FILLS-PIPELINE.md §12). The guard is a physical `if (!d.local) { …; continue; }` that runs BEFORE
 * any start() call, for EVERY entry, EVERY call — see the line tagged `SAFETY INVARIANT` in ensure()
 * below. This is not a comment or a convention; it is an unconditional branch the start() path
 * cannot be reached without passing. (Second line of defence per Hardening finding #1; registry.mjs
 * additionally withholds a callable start() from the one known git-writer — see its GIT_WRITER const.)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * DEFENSIVE CONTRACT (mirrors sync-invoke.mjs's runLocalSync): neither status() nor ensure() may
 * ever throw out to its caller — a manager hiccup must NOT abort a market read. Each daemon's
 * healthCheck()/start() is wrapped in its own try/catch so one broken entry can't take down the
 * fleet report or block the others.
 *
 * PURE-ish / library: reads and writes only the local heartbeat file — NO network, NO fetch. Node-only,
 * no APP_VERSION bump.
 */
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DAEMONS } from './registry.mjs';

// ── Heartbeat / guard-state storage (Chunk 3) ─────────────────────────────────────────────
// A small gitignored map at pipeline/.cache/daemon-state.json (pipeline/.cache/ is blanket-ignored,
// .gitignore:4 — the established home for desk-side runtime state, siblings loop-state.json /
// watch-state.json / session-thesis.json). ONE keyed map, not one file per daemon:
//   { [daemonName]: { lastRan: <ISO|null>, lastChecked: <ISO|null>, ok: bool|null, detail: string } }
//
// DELIBERATELY SEPARATE from root-level heartbeat.json (LW3 — watch-log.mjs's 30s browser-facing
// liveness pulse, fetched same-origin by the app). Do NOT unify them (Hardening finding #5):
// heartbeat.json is app-visible and single-purpose; daemon-state.json is the manager's own internal,
// desk-only, whole-fleet bookkeeping and is never fetched by the app.
const HERE = dirname(fileURLToPath(import.meta.url));
export const STATE_PATH = join(HERE, '..', '.cache', 'daemon-state.json');

// Self-throttle: the min gap between expensive start() attempts for the SAME daemon. Calling
// ensure() more often than this is a cheap no-op (the cheap healthCheck still runs every call; only
// the expensive start() is throttled — per the plan's "cheap check often, expensive backfill only
// when needed" design). PLACEHOLDER (5 min) pending observation — unvalidated.
export const MIN_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/** loadState(statePath) — read the heartbeat map; a missing/corrupt file degrades to {} (never throws). */
export function loadState(statePath = STATE_PATH) {
  try {
    const obj = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return (obj && typeof obj === 'object') ? obj : {};
  } catch {
    return {};
  }
}

/** saveState(statePath, state) — write the whole keyed map compactly, creating .cache/ if needed. */
export function saveState(statePath, state) {
  try {
    fs.mkdirSync(dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state ?? {}, null, 2));
  } catch { /* desk-side bookkeeping; a write failure must not break a read */ }
}

// Run a daemon hook (healthCheck/start) defensively — supports sync OR async, never throws.
async function safeCall(fn, fallbackDetail) {
  try {
    const r = await fn();
    return (r && typeof r === 'object') ? r : { ok: null, detail: '' };
  } catch (e) {
    return { ok: false, detail: `${fallbackDetail}: ${(e && e.message) || e}` };
  }
}

/**
 * status(opts) — READ-ONLY fleet health.
 * @returns {Promise<Array>} one row per registry entry:
 *   { name, kind, local, trigger, ok, detail, lastRan }
 *   - ok: true (healthy) | false (down/stale) | null (unknown / not-yet-wired)
 *   - lastRan: from the stored heartbeat (guards) or the healthCheck (if it reports one)
 */
export async function status({ registry = DAEMONS, statePath = STATE_PATH } = {}) {
  const state = loadState(statePath);
  const rows = [];
  for (const d of registry) {
    const health = await safeCall(() => d.healthCheck(), `healthCheck('${d.name}') threw`);
    const stored = state[d.name] || {};
    rows.push({
      name: d.name,
      kind: d.kind,
      local: d.local,
      autoRun: d.autoRun !== false,   // default true; only the cache-warm guard is actually auto-run
      trigger: d.trigger || '',
      ok: health.ok ?? null,
      detail: health.detail || '',
      lastRan: health.lastRan ?? stored.lastRan ?? null,
    });
  }
  return rows;
}

/**
 * ensure(opts) — start any down resident / run any stale guard, self-throttling. Never throws.
 * @param {object}   [opts]
 * @param {Array}    [opts.registry]           default DAEMONS
 * @param {string}   [opts.statePath]          default STATE_PATH
 * @param {number}   [opts.now]                injectable clock (ms) for tests
 * @param {number}   [opts.minCheckIntervalMs] override the throttle (tests pass 0 to disable)
 * @param {Function} [opts.log]                where refuse/action notes go (default console.error — stderr,
 *                                             so it never pollutes a stdout market table)
 * @returns {Promise<Array>} one action row per entry: { name, action, detail }
 *   action ∈ 'refused-git-writer' | 'skipped-manual' | 'started' | 'ok' | 'throttled' | 'start-failed'
 */
export async function ensure({
  registry = DAEMONS,
  statePath = STATE_PATH,
  now = Date.now(),
  minCheckIntervalMs = MIN_CHECK_INTERVAL_MS,
  log = (...a) => console.error(...a),
} = {}) {
  const state = loadState(statePath);
  const actions = [];

  for (const d of registry) {
    // Cheap health check runs on EVERY entry, EVERY call (regardless of throttle).
    const health = await safeCall(() => d.healthCheck(), `healthCheck('${d.name}') threw`);

    // ── SAFETY INVARIANT ──────────────────────────────────────────────────────────────────
    // Never auto-run a git-writer. This branch is evaluated for EVERY entry BEFORE any start()
    // path is reachable — a `local:false` daemon can never be started here, healthy or not.
    if (!d.local) {
      log(`daemon-manager: refusing to auto-run non-local (git-writer) daemon '${d.name}'`);
      actions.push({ name: d.name, action: 'refused-git-writer', detail: 'local:false — attended/on-demand only' });
      continue;
    }
    // ──────────────────────────────────────────────────────────────────────────────────────

    // autoRun:false → VISIBLE in status() but the manager never auto-starts it here. This is distinct
    // from the git-writer refusal above: these ARE local/zero-git-safe, but their trigger is elsewhere
    // (sync-fills rides every read via runLocalSync; residents are started attended via serve.cmd), so
    // ensure() must not surprise-run them on a routine scan/quote/loop pass. Checked BEFORE health so an
    // unhealthy manual daemon is reported as skipped, never started.
    if (d.autoRun === false) {
      actions.push({ name: d.name, action: 'skipped-manual', detail: 'autoRun:false — on-demand/attended only' });
      continue;
    }

    // Healthy (or unknown/not-yet-wired) → nothing to start. `ok === false` is the only "act" case.
    if (health.ok !== false) {
      actions.push({ name: d.name, action: 'ok', detail: health.detail || '' });
      continue;
    }

    // Unhealthy + local → throttle the EXPENSIVE start(): skip if we started/checked it recently.
    const stored = state[d.name] || {};
    const lastChecked = stored.lastChecked ? new Date(stored.lastChecked).getTime() : 0;
    if (minCheckIntervalMs > 0 && Number.isFinite(lastChecked) && (now - lastChecked) < minCheckIntervalMs) {
      actions.push({ name: d.name, action: 'throttled', detail: `checked ${Math.round((now - lastChecked) / 1000)}s ago` });
      continue;
    }

    // Start it (defensively). Update the heartbeat regardless of throttle bookkeeping.
    const nowIso = new Date(now).toISOString();
    const res = await safeCall(() => d.start(), `start('${d.name}') threw`);
    const started = res.ok !== false;
    state[d.name] = {
      lastRan: started ? nowIso : (stored.lastRan ?? null),
      lastChecked: nowIso,
      ok: res.ok ?? null,
      detail: res.detail || '',
    };
    log(`daemon-manager: ${started ? 'started' : 'FAILED to start'} '${d.name}'${res.detail ? ` (${res.detail})` : ''}`);
    actions.push({ name: d.name, action: started ? 'started' : 'start-failed', detail: res.detail || '' });
  }

  saveState(statePath, state);
  return actions;
}
