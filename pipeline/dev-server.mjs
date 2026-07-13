#!/usr/bin/env node
/**
 * dev-server.mjs — the local dev HTTP server for The Coffer (LW4).
 *
 * serve.cmd used to launch Python's `http.server` (static only). This node server REPLACES it:
 * it serves the repo-root static files exactly as before (ES modules over real HTTP, correct MIME
 * types — index.html can't load `js/main.js` over file://), AND it exposes ONE localhost-only
 * endpoint so the app's "Refresh scan" button can run a REAL scan on the local machine:
 *
 *   POST /api/scan  → runs `node pipeline/screen.mjs --mode all --publish` (which rewrites the
 *                     repo-root screen.json with ZERO git — see screen.mjs), then responds
 *                     { ok:true, generatedAt } (the new snapshot's timestamp) once the file is
 *                     written, or { ok:false, error } / { ok:false, busy:true } (single-flight).
 *
 * WHY this is safe / why zero-git: on the LOCAL dev server the browser reads screen.json off local
 * disk (this server serves the repo root; screen.json is ROOT-LOCKED). So a fresh LOCAL scan is
 * purely a local file write — it has NOTHING to do with git. This endpoint therefore does NO git
 * operations, ever (mirroring watch-log.mjs's zero-git rule): it only writes screen.json locally.
 * Publishing to Pages stays the attended, on-demand `sync-fills.mjs` flow, unchanged.
 *
 * SECURITY: bound to 127.0.0.1 ONLY. It runs a shell command (screen.mjs), so it must never be
 * reachable off-localhost. The deployed GitHub Pages app never talks to this server (its refresh
 * falls back to re-fetching the published screen.json) — this is a dev-desk convenience only.
 *
 * Started by serve.cmd (foreground) alongside the watch-log.mjs daemon; dies with the terminal.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');            // repo root — the static docroot (same as GitHub Pages)
const HOST = '127.0.0.1';                       // localhost ONLY — this endpoint runs a shell command
const PORT = Number(process.env.COFFER_DEV_PORT) || 8000;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.map': 'application/json',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.jsonl': 'application/json', '.log': 'text/plain', '.txt': 'text/plain', '.woff2': 'font/woff2' };

const hhmm = () => new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
const sendJson = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

// --- single-flight scan guard ---------------------------------------------------------------
// If a scan is already running, a second POST returns busy rather than launching a second
// screen.mjs (which would double-fetch the market and race the screen.json write).
let scanning = false;

function readGeneratedAt() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'screen.json'), 'utf8')).generatedAt || null; }
  catch { return null; }
}

// Run `node pipeline/screen.mjs --mode all --publish` and resolve when the file is (re)written.
// ZERO git — screen.mjs --publish only writes the local screen.json.
function runScan() {
  return new Promise(resolve => {
    const before = readGeneratedAt();
    const child = spawn(process.execPath, ['pipeline/screen.mjs', '--mode', 'all', '--publish'],
      { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', e => resolve({ ok: false, error: 'spawn failed: ' + (e && e.message || e) }));
    child.on('close', code => {
      if (code !== 0) return resolve({ ok: false, error: 'screen.mjs exited ' + code });
      const after = readGeneratedAt();
      if (!after) return resolve({ ok: false, error: 'screen.json missing after scan' });
      resolve({ ok: true, generatedAt: after, changed: after !== before });
    });
  });
}

async function handleScan(res) {
  if (scanning) { sendJson(res, 409, { ok: false, busy: true, error: 'a scan is already running' }); return; }
  scanning = true;
  console.log(`${hhmm()} /api/scan — running screen.mjs --mode all --publish …`);
  try {
    const r = await runScan();
    console.log(`${hhmm()} /api/scan — ${r.ok ? `done (screen.json ${r.changed ? 'updated' : 'unchanged'} @ ${r.generatedAt})` : 'FAILED: ' + r.error}`);
    sendJson(res, r.ok ? 200 : 500, r);
  } finally {
    scanning = false;
  }
}

// --- static file serving (repo root) --------------------------------------------------------
function serveStatic(req, res) {
  let rel = decodeURIComponent((req.url || '/').split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const fp = path.join(ROOT, rel);
  // path-traversal guard: never serve outside the repo root
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(fp).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/api/scan') {
    if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'POST only' }); return; }
    handleScan(res);
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`dev-server: serving http://${HOST}:${PORT}/ (repo root) — Ctrl+C to stop.`);
  console.log(`dev-server: POST /api/scan runs screen.mjs --mode all --publish locally (ZERO git).`);
});
server.on('error', e => {
  console.error(`dev-server: FAILED to bind ${HOST}:${PORT} — ${e && e.message || e}`);
  if (e && e.code === 'EADDRINUSE') console.error(`dev-server: port ${PORT} is in use (another serve.cmd running?).`);
  process.exit(1);
});
process.on('SIGINT', () => { console.log('\ndev-server: stopped.'); process.exit(0); });
