#!/usr/bin/env node
/**
 * cache-warm-hook.test.mjs — the opportunistic cache-warm hook (PLAN-DAEMON-SUBSYSTEM Phase-1 Chunk 5).
 *
 * Chunk 5 wires `manager.ensure()` into the four common workflow entry points so a scan / positions
 * review / active /loop / a freshly-booted dev-server all opportunistically top up the /1h archive.
 * This suite pins the two load-bearing guarantees of that wiring:
 *
 *   1. STRUCTURAL — each of the four host scripts imports `ensure` from the daemons manager and calls
 *      it at the documented seam (screen/quote: right AFTER the pre-read runLocalSync; run-loop: at the
 *      top of the per-tick dispatch, before the runScript actions; dev-server: inside the listen
 *      callback, i.e. once at boot). We assert on source text rather than executing the scripts because
 *      running them would fetch/read the live book — the point of the hook is exactly that it must never
 *      add that cost, so the test stays offline.
 *   2. BEHAVIORAL / TIMING — using the REAL manager.ensure() with a SYNTHETIC registry (never the real
 *      DAEMONS, so no archive/fetch is touched), the "fresh cache" and "throttled" common cases must be
 *      a cheap no-op: the expensive start() is NEVER entered, and the call returns far faster than the
 *      one path that does pay for a backfill. This is the "must never add latency on the fresh-cache
 *      common case" guarantee, asserted as a RELATIVE timing comparison (hermetic, not a wall-clock
 *      threshold that could flake under CI load).
 *
 * Timezone-hermetic (TZ=UTC + injected `now`) and fully synthetic/offline — never the live archive or
 * network. Run: `node pipeline/test/cache-warm-hook.test.mjs` (exits non-zero on failure).
 */
process.env.TZ = 'UTC';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensure } from '../daemons/manager.mjs';

let pass = 0;
const ok = (name, fn) => { const r = fn(); if (r && typeof r.then === 'function') return r.then(() => { pass++; console.log('  ✓ ' + name); }); pass++; console.log('  ✓ ' + name); };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CMD = path.join(HERE, '..', 'commands');
const read = f => fs.readFileSync(path.join(CMD, f), 'utf8');
const tmpState = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cwhook-')), 'daemon-state.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NOW = 1_800_000_000_000;

/* ─── 1. STRUCTURAL: the hook is present at each of the four seams ───────────────────────────── */

// Every host script must import ensure from the daemons manager (the in-process, not-subprocessed call).
const IMPORT_RE = /import\s*\{[^}]*\bensure\b[^}]*\}\s*from\s*['"]\.\.\/daemons\/manager\.mjs['"]/;
const MARK = 'PLAN-DAEMON-SUBSYSTEM Chunk 5';

await ok('screen-flip-niches.mjs — imports ensure and calls it right AFTER the pre-read runLocalSync', () => {
  const src = read('screen-flip-niches.mjs');
  assert.ok(IMPORT_RE.test(src), 'must import ensure from ../daemons/manager.mjs');
  assert.ok(src.includes(MARK), 'must carry the Chunk 5 seam comment');
  const syncAt = src.indexOf("runLocalSync({ offBookNote: 'screening off the current book' })");
  const hookAt = src.indexOf('ensureDaemons(', syncAt);
  assert.ok(syncAt >= 0 && hookAt > syncAt, 'the ensure() call must sit just after the runLocalSync seam');
});

await ok('quote-items.mjs — imports ensure and calls it right AFTER the --positions runLocalSync', () => {
  const src = read('quote-items.mjs');
  assert.ok(IMPORT_RE.test(src), 'must import ensure from ../daemons/manager.mjs');
  assert.ok(src.includes(MARK), 'must carry the Chunk 5 seam comment');
  const syncAt = src.indexOf("runLocalSync({ offBookNote: 'reading off the current book' })");
  const hookAt = src.indexOf('ensureDaemons(', syncAt);
  assert.ok(syncAt >= 0 && hookAt > syncAt, 'the ensure() call must sit just after the runLocalSync seam');
});

await ok('run-loop.mjs — imports ensure and calls it at the top of the per-tick dispatch (before runScript)', () => {
  const src = read('run-loop.mjs');
  assert.ok(IMPORT_RE.test(src), 'must import ensure from ../daemons/manager.mjs');
  assert.ok(src.includes(MARK), 'must carry the Chunk 5 seam comment');
  const hookAt = src.indexOf('ensureDaemons(');
  const dispatchAt = src.indexOf('const runScript =');
  assert.ok(hookAt >= 0 && dispatchAt >= 0 && hookAt < dispatchAt, 'the hook must precede the runScript dispatch');
});

await ok('dev-server.mjs — imports ensure and calls it ONCE inside the listen callback (boot, not per-request)', () => {
  const src = read('dev-server.mjs');
  assert.ok(IMPORT_RE.test(src), 'must import ensure from ../daemons/manager.mjs');
  assert.ok(src.includes(MARK), 'must carry the Chunk 5 seam comment');
  const listenAt = src.indexOf('server.listen(');
  const hookAt = src.indexOf('ensureDaemons(', listenAt);
  const handlerAt = src.indexOf('http.createServer(');
  assert.ok(listenAt >= 0 && hookAt > listenAt, 'the hook must sit inside/after the listen() callback');
  // ...and NOT inside the per-request handler (which is created earlier in the file).
  assert.ok(hookAt > handlerAt, 'the hook must not live in the request handler');
  // exactly one call site (boot-once, not per-request).
  assert.equal(src.split('ensureDaemons(').length - 1, 1, 'exactly one ensure() call site in dev-server');
});

/* ─── 2. BEHAVIORAL / TIMING: fresh + throttled common cases are a cheap no-op ───────────────── */

// A synthetic guard whose expensive start() BLOCKS for ~60ms — so if it ever ran on the common case the
// timing would betray it. healthCheck is instant. local:true (auto-runnable), zero real work.
const START_MS = 60;
function slowGuard(over = {}) {
  const spy = { starts: 0 };
  return {
    entry: {
      name: over.name || 'slow-warm',
      description: 'synthetic zero-git test guard (blocking start)',
      kind: 'guard',
      local: true,
      trigger: 'test',
      healthCheck: () => ({ ok: over.ok ?? false, detail: 'synthetic' }),
      start: async () => { spy.starts++; await sleep(START_MS); return { ok: true, detail: 'warmed (spy)' }; },
    },
    spy,
  };
}
const timed = async fn => { const t0 = Date.now(); await fn(); return Date.now() - t0; };

// Baseline: the ONE path that actually pays for a backfill — stale + not throttled → start() runs.
let tBackfill, startsBackfill;
await ok('ensure() runs the expensive start() ONLY when the archive is stale and unthrottled (baseline)', async () => {
  const sp = tmpState();
  const { entry, spy } = slowGuard({ ok: false });
  tBackfill = await timed(() => ensure({ registry: [entry], statePath: sp, now: NOW, log: () => {} }));
  startsBackfill = spy.starts;
  assert.equal(spy.starts, 1, 'stale + unthrottled must start exactly once');
  assert.ok(tBackfill >= START_MS - 5, `backfill path must pay the ~${START_MS}ms start cost (was ${tBackfill}ms)`);
});

await ok('FRESH cache (healthCheck ok:true) — start() is never entered and the call is far cheaper than a backfill', async () => {
  const sp = tmpState();
  const { entry, spy } = slowGuard({ ok: true });
  const t = await timed(() => ensure({ registry: [entry], statePath: sp, now: NOW, log: () => {} }));
  assert.equal(spy.starts, 0, 'a fresh guard must NOT be started');
  assert.ok(t < tBackfill, `fresh-case latency (${t}ms) must be well under the backfill cost (${tBackfill}ms)`);
  assert.ok(t < START_MS, `fresh case must add no backfill latency (${t}ms < ${START_MS}ms)`);
});

await ok('THROTTLED (stale but checked <MIN_CHECK_INTERVAL_MS ago) — start() is skipped and the call stays cheap', async () => {
  const sp = tmpState();
  const { entry, spy } = slowGuard({ ok: false });
  // Pre-seed a recent lastChecked so the throttle short-circuits before start().
  const recentIso = new Date(NOW - 60_000).toISOString();  // 1 min ago, well inside the 5-min window
  fs.mkdirSync(path.dirname(sp), { recursive: true });
  fs.writeFileSync(sp, JSON.stringify({ 'slow-warm': { lastChecked: recentIso, lastRan: recentIso, ok: false, detail: '' } }));
  const t = await timed(() => ensure({ registry: [entry], statePath: sp, now: NOW, log: () => {} }));
  assert.equal(spy.starts, 0, 'a throttled guard must NOT restart within the interval');
  assert.ok(t < tBackfill, `throttled-case latency (${t}ms) must be well under the backfill cost (${tBackfill}ms)`);
  assert.ok(t < START_MS, `throttled case must add no backfill latency (${t}ms < ${START_MS}ms)`);
});

console.log(`\n${pass} assertion group(s) passed.`);
