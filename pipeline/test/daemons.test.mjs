#!/usr/bin/env node
/**
 * daemons.test.mjs — the daemon subsystem (PLAN-DAEMON-SUBSYSTEM Phase-1 Chunks 1+2+3, Phase-2 Chunk 7).
 *
 * Pins the load-bearing guarantees of pipeline/daemons/registry.mjs + manager.mjs + health.mjs with
 * SYNTHETIC registry entries (never the real DAEMONS for status/ensure, so no fetch/archive/process
 * is touched):
 *   - registry.mjs's real DAEMONS is well-shaped (every entry has name/kind/local + callable hooks)
 *     and importing it is side-effect-free; the Phase-2 residents + sync-fills are registered autoRun:false.
 *   - status() classifies resident-vs-guard and merges the stored heartbeat.
 *   - ensure() STARTS a stale (ok:false) local guard.
 *   - ensure() REFUSES a local:false entry, even when forced unhealthy — THE SAFETY INVARIANT (mandatory).
 *   - ensure() SKIPS an autoRun:false entry (visible-but-not-auto-started), even when forced unhealthy.
 *   - the heartbeat store (loadState/saveState) round-trips, and a missing/corrupt file degrades to {}.
 *   - health.mjs's heartbeatHealth/httpProbeHealth classify fresh/stale/missing and never throw.
 *
 * Run: `node pipeline/test/daemons.test.mjs` (exits non-zero on failure). Synthetic fixtures only.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DAEMONS, GIT_WRITER, getDaemon } from '../daemons/registry.mjs';
import { status, ensure, loadState, saveState } from '../daemons/manager.mjs';
import { heartbeatHealth, httpProbeHealth } from '../daemons/health.mjs';

let pass = 0;
const ok = (name, fn) => { const r = fn(); if (r && typeof r.then === 'function') return r.then(() => { pass++; console.log('  ✓ ' + name); }); pass++; console.log('  ✓ ' + name); };

const tmpState = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'daemons-')), 'daemon-state.json');
const NOW = 1_800_000_000_000;

// A spy start() that records how many times it fired.
function spyDaemon(over = {}) {
  const spy = { starts: 0 };
  return {
    entry: {
      name: over.name || 'spy',
      description: 'synthetic zero-git test daemon',
      kind: over.kind || 'guard',
      local: over.local ?? true,
      trigger: 'test',
      healthCheck: over.healthCheck || (() => ({ ok: over.ok ?? false, detail: 'synthetic' })),
      start: () => { spy.starts++; return { ok: true, detail: 'started (spy)' }; },
    },
    spy,
  };
}

/* --- registry shape ------------------------------------------------------------------------- */
await ok('DAEMONS is well-shaped (name/kind/local + callable hooks), import is side-effect-free', () => {
  assert.ok(Array.isArray(DAEMONS) && DAEMONS.length >= 1);
  for (const d of DAEMONS) {
    assert.equal(typeof d.name, 'string');
    assert.ok(d.kind === 'resident' || d.kind === 'guard', `${d.name}: kind must be resident|guard`);
    assert.equal(typeof d.local, 'boolean', `${d.name}: local must be a boolean`);
    assert.equal(typeof d.healthCheck, 'function');
    assert.equal(typeof d.start, 'function');
  }
  // The cache-warm guard is seeded, zero-git, and the ONLY auto-run entry (autoRun defaults true).
  const cw = getDaemon('cache-warm');
  assert.ok(cw && cw.kind === 'guard' && cw.local === true);
  assert.notEqual(cw.autoRun, false, 'cache-warm must be auto-run (autoRun !== false)');
  // Phase-2: the three migrated daemons are registered, zero-git, and autoRun:false (visible, not auto-started).
  for (const [name, kind] of [['sync-fills', 'guard'], ['watch-log', 'resident'], ['dev-server', 'resident']]) {
    const d = getDaemon(name);
    assert.ok(d, `${name} must be registered (Phase 2)`);
    assert.equal(d.kind, kind, `${name} kind`);
    assert.equal(d.local, true, `${name} is zero-git`);
    assert.equal(d.autoRun, false, `${name} must be autoRun:false — visible in status(), never auto-started`);
  }
  // The one git-writer is recorded ADJACENT (never a schedulable entry) and is local:false.
  assert.equal(GIT_WRITER.local, false);
  assert.ok(!DAEMONS.some(d => d.name === GIT_WRITER.name), 'git-writer must NOT be a DAEMONS entry');
});

/* --- status: resident-vs-guard classification ----------------------------------------------- */
await ok('status() classifies resident-vs-guard and merges stored heartbeat', async () => {
  const sp = tmpState();
  saveState(sp, { g: { lastRan: '2020-01-01T00:00:00.000Z' } });
  const registry = [
    { name: 'r', kind: 'resident', local: true, healthCheck: () => ({ ok: true, detail: 'up' }), start: () => ({}) },
    { name: 'g', kind: 'guard', local: true, healthCheck: () => ({ ok: false, detail: 'stale' }), start: () => ({}) },
  ];
  const rows = await status({ registry, statePath: sp });
  const r = rows.find(x => x.name === 'r'), g = rows.find(x => x.name === 'g');
  assert.equal(r.kind, 'resident');
  assert.equal(r.ok, true);
  assert.equal(g.kind, 'guard');
  assert.equal(g.ok, false);
  assert.equal(g.lastRan, '2020-01-01T00:00:00.000Z');   // merged from stored heartbeat
});

/* --- ensure: starts a stale local guard ----------------------------------------------------- */
await ok('ensure() STARTS a stale (ok:false) local guard and stamps lastRan', async () => {
  const sp = tmpState();
  const { entry, spy } = spyDaemon({ name: 'stale-guard', kind: 'guard', local: true, ok: false });
  const actions = await ensure({ registry: [entry], statePath: sp, now: NOW });
  assert.equal(spy.starts, 1, 'stale local guard must be started exactly once');
  assert.equal(actions[0].action, 'started');
  const state = loadState(sp);
  assert.equal(state['stale-guard'].lastRan, new Date(NOW).toISOString());
});

await ok('ensure() does NOT start a healthy guard', async () => {
  const sp = tmpState();
  const { entry, spy } = spyDaemon({ name: 'fresh', kind: 'guard', local: true, ok: true });
  const actions = await ensure({ registry: [entry], statePath: sp, now: NOW });
  assert.equal(spy.starts, 0);
  assert.equal(actions[0].action, 'ok');
});

/* --- THE SAFETY INVARIANT (mandatory) ------------------------------------------------------- */
await ok('ensure() REFUSES a local:false entry even when forced unhealthy (SAFETY INVARIANT)', async () => {
  const sp = tmpState();
  // A git-writer forced ok:false — the manager must NEVER call its start().
  const { entry, spy } = spyDaemon({ name: 'git-writer', kind: 'guard', local: false, ok: false });
  const logs = [];
  const actions = await ensure({ registry: [entry], statePath: sp, now: NOW, log: m => logs.push(m) });
  assert.equal(spy.starts, 0, 'a local:false daemon must NEVER be auto-started');
  assert.equal(actions[0].action, 'refused-git-writer');
  assert.ok(logs.some(l => /refusing to auto-run/.test(l)), 'refusal must be logged');
});

await ok('ensure() starts the local guard but STILL refuses the git-writer in a mixed fleet', async () => {
  const sp = tmpState();
  const good = spyDaemon({ name: 'warm', kind: 'guard', local: true, ok: false });
  const bad = spyDaemon({ name: 'publish', kind: 'guard', local: false, ok: false });
  await ensure({ registry: [good.entry, bad.entry], statePath: sp, now: NOW, log: () => {} });
  assert.equal(good.spy.starts, 1);
  assert.equal(bad.spy.starts, 0);
});

/* --- autoRun:false is visible-but-never-auto-started ---------------------------------------- */
await ok('ensure() SKIPS an autoRun:false local entry even when forced unhealthy', async () => {
  const sp = tmpState();
  const { entry, spy } = spyDaemon({ name: 'manual', kind: 'guard', local: true, ok: false });
  entry.autoRun = false;   // on-demand/attended — must NOT be auto-started
  const actions = await ensure({ registry: [entry], statePath: sp, now: NOW, log: () => {} });
  assert.equal(spy.starts, 0, 'an autoRun:false entry must NEVER be auto-started');
  assert.equal(actions[0].action, 'skipped-manual');
  // ...but it is still surfaced by status() (visibility is the whole point of registering it).
  const rows = await status({ registry: [entry], statePath: sp });
  assert.equal(rows[0].autoRun, false);
  assert.equal(rows[0].ok, false);
});

/* --- self-throttle -------------------------------------------------------------------------- */
await ok('ensure() throttles a repeat start within MIN_CHECK_INTERVAL_MS', async () => {
  const sp = tmpState();
  const { entry, spy } = spyDaemon({ name: 'throttled', kind: 'guard', local: true, ok: false });
  await ensure({ registry: [entry], statePath: sp, now: NOW });                          // starts (1)
  const actions = await ensure({ registry: [entry], statePath: sp, now: NOW + 60_000 }); // 1 min later → throttled
  assert.equal(spy.starts, 1, 'second call within the throttle window must NOT restart');
  assert.equal(actions[0].action, 'throttled');
  // Past the window it starts again.
  const later = await ensure({ registry: [entry], statePath: sp, now: NOW + 6 * 60_000 });
  assert.equal(spy.starts, 2);
  assert.equal(later[0].action, 'started');
});

/* --- heartbeat store round-trip + resilience ------------------------------------------------ */
await ok('heartbeat store round-trips and a missing/corrupt file degrades to {}', () => {
  const sp = tmpState();
  assert.deepEqual(loadState(sp), {});                     // missing → {}
  const map = { a: { lastRan: '2020-01-01T00:00:00.000Z', ok: true, detail: 'x' } };
  saveState(sp, map);
  assert.deepEqual(loadState(sp), map);                    // round-trip
  fs.writeFileSync(sp, '{ not json');
  assert.deepEqual(loadState(sp), {});                     // corrupt → {}
});

/* --- never throws out to the caller --------------------------------------------------------- */
await ok('ensure() swallows a throwing healthCheck/start (never breaks the caller)', async () => {
  const sp = tmpState();
  const boom = { name: 'boom', kind: 'guard', local: true, healthCheck: () => { throw new Error('nope'); }, start: () => { throw new Error('nope'); } };
  const actions = await ensure({ registry: [boom], statePath: sp, now: NOW, log: () => {} });
  // healthCheck threw → treated as ok:false → start attempted → start threw → start-failed, no throw.
  assert.equal(actions[0].action, 'start-failed');
});

/* --- health.mjs: shared resident probes (Phase-2 Chunk 7) ----------------------------------- */
await ok('heartbeatHealth classifies fresh / stale / missing / unparseable (never throws)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-'));
  const hb = path.join(dir, 'heartbeat.json');
  const NOWMS = 1_800_000_000_000;
  // fresh: generatedAt 10s ago
  fs.writeFileSync(hb, JSON.stringify({ generatedAt: new Date(NOWMS - 10_000).toISOString() }));
  let h = heartbeatHealth({ path: hb, now: NOWMS });
  assert.equal(h.ok, true);
  assert.ok(/10s old/.test(h.detail));
  assert.equal(h.lastRan, new Date(NOWMS - 10_000).toISOString());
  // stale: generatedAt 5 min ago (> 90s default)
  fs.writeFileSync(hb, JSON.stringify({ generatedAt: new Date(NOWMS - 300_000).toISOString() }));
  h = heartbeatHealth({ path: hb, now: NOWMS });
  assert.equal(h.ok, false);
  assert.ok(/stale/.test(h.detail));
  // missing file
  h = heartbeatHealth({ path: path.join(dir, 'nope.json'), now: NOWMS });
  assert.equal(h.ok, false);
  assert.equal(h.lastRan, null);
  // unparseable
  fs.writeFileSync(hb, '{ not json');
  h = heartbeatHealth({ path: hb, now: NOWMS });
  assert.equal(h.ok, false);
  assert.ok(/unparseable/.test(h.detail));
});

await ok('httpProbeHealth reports up on success, down on refusal/timeout (injected fetchFn, never throws)', async () => {
  let h = await httpProbeHealth({ url: 'http://x/', fetchFn: async () => ({ ok: true }) });
  assert.equal(h.ok, true);
  h = await httpProbeHealth({ url: 'http://x/', fetchFn: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal(h.ok, false);
  assert.equal(h.detail, 'connection refused');
  h = await httpProbeHealth({ url: 'http://x/', fetchFn: async () => { throw new Error('The operation was aborted'); } });
  assert.equal(h.ok, false);
  assert.equal(h.detail, 'timed out');
});

console.log(`\n${pass} assertion group(s) passed.`);
