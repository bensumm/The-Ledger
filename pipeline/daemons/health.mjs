/**
 * health.mjs — shared resident health-check primitives for the daemon fleet
 * (PLAN-DAEMON-SUBSYSTEM Phase-2 Chunk 7).
 *
 * GENERALIZES the two hand-rolled probes that already existed in ensure-server.mjs —
 * `checkDaemon()` (heartbeat-age) and `checkServer()` (HTTP probe) — into ONE reusable place
 * so the registry's resident entries (watch-log, dev-server) AND ensure-server.mjs itself share
 * a single implementation instead of two copies drifting apart (the plan's Phase-2 directive:
 * "generalize ensure-server.mjs's two functions into the registry, not write new logic from
 * scratch"). Returns the registry `healthCheck()` shape `{ ok, detail, lastRan? }`; ensure-server
 * maps `ok → running` for its own prose.
 *
 * Both probes are INJECTABLE for hermetic tests (a temp heartbeat path / a stub `fetchFn`) and
 * NEVER throw — a probe failure is reported as `ok:false`, never an exception, matching the
 * manager's defensive contract. Pure library: NO module-load side effects (no fs/network at
 * import). Node-only, no APP_VERSION bump.
 */
import fs from 'node:fs';

// Was ensure-server.mjs's local const — 3× watch-log's 30s heartbeat pulse, a safety margin against
// one missed tick. Exported so both the registry entry and ensure-server share the one threshold.
export const HEARTBEAT_STALE_MS = 90_000;
export const HTTP_TIMEOUT_MS = 2_000;

/**
 * heartbeatHealth({ path, now, staleMs }) → { ok, detail, lastRan }
 *
 * Reads a heartbeat.json (`{ generatedAt }`) and classifies fresh / stale / missing. Never throws.
 *   - missing / unparseable / no generatedAt → ok:false (down),  lastRan:null
 *   - age > staleMs                          → ok:false (stale), lastRan = generatedAt ISO
 *   - else                                   → ok:true,          lastRan = generatedAt ISO
 */
export function heartbeatHealth({ path, now = Date.now(), staleMs = HEARTBEAT_STALE_MS } = {}) {
  let raw;
  try { raw = fs.readFileSync(path, 'utf8'); }
  catch { return { ok: false, detail: 'no heartbeat.json found', lastRan: null }; }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { return { ok: false, detail: 'heartbeat.json unparseable', lastRan: null }; }
  const gen = parsed && parsed.generatedAt ? new Date(parsed.generatedAt).getTime() : NaN;
  if (!Number.isFinite(gen)) return { ok: false, detail: 'heartbeat.json missing generatedAt', lastRan: null };
  const ageS = Math.round((now - gen) / 1000);
  const lastRan = new Date(gen).toISOString();
  if ((now - gen) > staleMs) return { ok: false, detail: `heartbeat ${ageS}s old (stale)`, lastRan };
  return { ok: true, detail: `${ageS}s old heartbeat`, lastRan };
}

/**
 * httpProbeHealth({ url, timeoutMs, fetchFn }) → { ok, detail }  (async)
 *
 * GET-probes an HTTP endpoint; any connect error / timeout → ok:false. Never throws. `fetchFn`
 * defaults to the global fetch; a test passes a stub to stay offline.
 */
export async function httpProbeHealth({ url, timeoutMs = HTTP_TIMEOUT_MS, fetchFn = fetch } = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await fetchFn(url, { signal: ctrl.signal });
    return { ok: true, detail: 'responding' };
  } catch (e) {
    const msg = (e && e.message) || String(e);
    return { ok: false, detail: /abort/i.test(msg) ? 'timed out' : 'connection refused' };
  } finally {
    clearTimeout(to);
  }
}
