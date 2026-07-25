#!/usr/bin/env node
/**
 * daemons.test.mjs — the daemon subsystem (PLAN-DAEMON-SUBSYSTEM Phase-1 Chunks 1+2+3).
 *
 * Pins the load-bearing guarantees of pipeline/daemons/registry.mjs + manager.mjs with SYNTHETIC
 * registry entries (never the real DAEMONS, so no fetch/archive/process is touched):
 *   - registry.mjs's real DAEMONS is well-shaped (every entry has name/kind/local + callable hooks)
 *     and importing it is side-effect-free.
 *   - status() classifies resident-vs-guard and merges the stored heartbeat.
 *   - ensure() STARTS a stale (ok:false) local guard.
 *   - ensure() REFUSES a local:false entry, even when forced unhealthy — THE SAFETY INVARIANT (mandatory).
 *   - the heartbeat store (loadState/saveState) round-trips, and a missing/corrupt file degrades to {}.
 *
 * Run: `node pipeline/test/daemons.test.mjs` (exits non-zero on failure). Synthetic fixtures only.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DAEMONS, GIT_WRITER, getDaemon } from '../daemons/registry.mjs';
import { status, ensure, loadState, saveState } from '../daemons/manager.mjs';

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
  // The cache-warm guard is seeded and zero-git.
  const cw = getDaemon('cache-warm');
  assert.ok(cw && cw.kind === 'guard' && cw.local === true);
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

console.log(`\n${pass} assertion group(s) passed.`);
