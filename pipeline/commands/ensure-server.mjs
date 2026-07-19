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
import fs from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const HEARTBEAT_STALE_MS = 90_000; // 3x the daemon's 30s heartbeat interval — safety margin against a missed tick
const HTTP_TIMEOUT_MS = 2_000;
const SERVER_URL = 'http://127.0.0.1:8000/';

const argVal = name => { const i = process.argv.indexOf(name); return (i >= 0 && i + 1 < process.argv.length) ? process.argv[i + 1] : undefined; };
const REPO_DIR = argVal('--repo-dir') || 'C:\\dev\\The-Ledger';

function checkDaemon() {
  const heartbeatPath = join(REPO_DIR, 'heartbeat.json');
  let raw;
  try {
    raw = fs.readFileSync(heartbeatPath, 'utf8');
  } catch {
    return { running: false, detail: 'no heartbeat.json found' };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { running: false, detail: 'heartbeat.json unparseable' };
  }
  const generatedAt = parsed && parsed.generatedAt ? new Date(parsed.generatedAt).getTime() : NaN;
  if (!Number.isFinite(generatedAt)) return { running: false, detail: 'heartbeat.json missing generatedAt' };
  const ageMs = Date.now() - generatedAt;
  if (ageMs > HEARTBEAT_STALE_MS) return { running: false, detail: `heartbeat is ${Math.round(ageMs / 1000)}s old (stale)` };
  return { running: true, detail: `${Math.round(ageMs / 1000)}s old heartbeat` };
}

async function checkServer() {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    await fetch(SERVER_URL, { signal: ctrl.signal });
    return { running: true, detail: '' };
  } catch (e) {
    const msg = (e && e.message) || String(e);
    return { running: false, detail: msg.includes('abort') ? 'timed out' : 'connection refused' };
  } finally {
    clearTimeout(to);
  }
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
