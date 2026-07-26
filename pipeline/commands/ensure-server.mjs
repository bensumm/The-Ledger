#!/usr/bin/env node
/**
 * ensure-server.mjs — liveness check + auto-start nudge for the local live desk.
 *
 * `/morning` used to ASSUME `serve.cmd` (dev-server.mjs + the watch-log.mjs daemon) was
 * already running. This script checks instead of assuming: it probes the daemon's
 * heartbeat.json (LW1 liveness signal — see watch-log.mjs's header, "HEARTBEAT" section) and
 * does a quick HTTP probe of the static server on :8000, and if EITHER is down, spawns
 * `serve.cmd` detached (which starts both dev-server.mjs and watch-log.mjs together via
 * `start /b` — see serve.cmd) so Ben never has to remember to run it by hand before an
 * AI-driven morning pass touches anything.
 *
 * This is a liveness-check-and-nudge utility, NOT a supervisor — no retry loops, no polling,
 * no waiting for the freshly-started server to actually come up (the caller can proceed
 * immediately; the next command in the morning flow, sync-fills.mjs, doesn't depend on the
 * local HTTP server — only Ben's browser tab does).
 *
 * Usage:
 *   node pipeline/commands/ensure-server.mjs [--repo-dir <dir>]
 *       --repo-dir   override the repo root (mirrors sync-fills.mjs's existing convention);
 *                    not expected to be used in real invocations, only for testability.
 */
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { heartbeatHealth, httpProbeHealth } from '../daemons/health.mjs';   // Phase-2 Chunk 10: ONE source of truth

const SERVER_URL = 'http://127.0.0.1:8000/';

const argVal = name => { const i = process.argv.indexOf(name); return (i >= 0 && i + 1 < process.argv.length) ? process.argv[i + 1] : undefined; };
const REPO_DIR = argVal('--repo-dir') || 'C:\\dev\\The-Ledger';

// These two probes were the ORIGINAL hand-rolled versions this whole daemon subsystem generalized —
// they now delegate to the shared health.mjs so ensure-server and the registry can never drift apart.
// Kept as thin { running, detail } adapters because main() below (and its /morning contract) speak that shape.
function checkDaemon() {
  const h = heartbeatHealth({ path: join(REPO_DIR, 'heartbeat.json') });
  return { running: h.ok === true, detail: h.detail };
}

async function checkServer() {
  const h = await httpProbeHealth({ url: SERVER_URL });
  return { running: h.ok === true, detail: h.detail };
}

function startServeCmd() {
  const child = spawn('serve.cmd', [], { cwd: REPO_DIR, detached: true, stdio: 'ignore', shell: true });
  child.unref();
}

async function main() {
  const daemon = checkDaemon();
  const server = await checkServer();

  console.log(daemon.running
    ? `daemon (watch-log.mjs): running (${daemon.detail})`
    : `daemon (watch-log.mjs): NOT running (${daemon.detail}) — starting serve.cmd`);
  console.log(server.running
    ? `server (dev-server.mjs): running`
    : `server (dev-server.mjs): NOT running (${server.detail}) — starting serve.cmd`);

  if (!daemon.running || !server.running) {
    startServeCmd();
    console.log('started serve.cmd (detached) — give it ~2-3s to come up before the next check');
  }
}

main();
