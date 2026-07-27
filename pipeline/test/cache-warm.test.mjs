/* cache-warm.test.mjs — BUSINESS REQUIREMENTS for the cache-warm guard daemon
 * (PLAN-DAEMON-SUBSYSTEM Phase-1 Chunk 4).
 *
 * HERMETIC + OFFLINE + TIMEZONE-INVARIANT by construction:
 *   - TZ is pinned to UTC and every `now` is injected, so nothing reads wall-clock or a local zone
 *     (CI runs UTC; a new test that buckets by hour / reads the clock must pin both — this one does).
 *   - The archive is always a synthetic :memory: handle passed in via `db` (NEVER the real .sqlite).
 *   - The network backfills (loadAll24hRolling / loadBands) are INJECTED spies — the module never
 *     touches the wiki here. Production defaults stay wired to the real functions (asserted by the
 *     arg-free import contract, exercised indirectly through the injectable seams).
 *   - The heartbeat file is a fresh os.tmpdir() path (NEVER the real pipeline/.cache/daemon-state.json).
 *
 * Requirements pinned:
 *   1. healthCheck: a COLD archive (no /1h buckets) reads as ok:false ("needs warming"), never a crash.
 *   2. healthCheck: a STALE archive (newest /1h bucket > WARM_THRESHOLD_HOURS old) → ok:false;
 *      a FRESH one (≤ threshold) → ok:true.
 *   3. start(): calls BOTH backfills, stamps daemon-state.json's lastRan for 'cache-warm', and once a
 *      backfill actually appends a fresh bucket, healthCheck flips ok:true (age resets). Idempotent.
 *   4. Through the manager's ensure() guard: the STALE case calls start() (spy === 1); the FRESH case
 *      does NOT call the expensive backfill (spy === 0) — asserted by a counter, not merely "no error".
 *   5. NEVER-THROWS contract: a broken age-probe (healthCheck) and a throwing backfill (start) both
 *      return ok:false instead of raising.
 */
process.env.TZ = 'UTC';   // pin BEFORE any Date use; every `now` below is also injected explicitly

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { open } from '../lib/market/archive.mjs';
import { loadState } from '../daemons/manager.mjs';
import { ensure } from '../daemons/manager.mjs';
import { healthCheck, start, WARM_THRESHOLD_HOURS } from '../daemons/cache-warm.mjs';

let n = 0;
function ok(name, fn) { fn(); n++; console.log('  ✓ ' + name); }
async function okAsync(name, fn) { await fn(); n++; console.log('  ✓ ' + name); }

// A fixed injected clock (UTC midnight 2026-01-01) — no wall-clock, no local zone anywhere.
const NOW = Date.UTC(2026, 0, 1, 0, 0, 0);
const nowSec = Math.floor(NOW / 1000);
const oneBucket = (a = 100) => ({ 560: { avgHighPrice: a, avgLowPrice: a - 5, highPriceVolume: 5, lowPriceVolume: 4 } });
const freshStatePath = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cwarm-')), 'daemon-state.json');

// ── 1. COLD archive reads as needs-warming, never crashes ────────────────────────────────────────
ok('healthCheck: COLD archive (no /1h buckets) → ok:false, no throw', () => {
  const h = open(':memory:');
  const r = healthCheck({ now: NOW, db: h });
  assert.equal(r.ok, false, 'cold archive treated as stale/needs-warming');
  assert.match(r.detail, /COLD/i);
  h.close();
});

// ── 2. STALE > threshold → ok:false ; FRESH ≤ threshold → ok:true ────────────────────────────────
ok('healthCheck: STALE newest /1h bucket (> threshold) → ok:false', () => {
  const h = open(':memory:');
  const staleTs = nowSec - (WARM_THRESHOLD_HOURS + 7) * 3600;   // ~7h past the threshold
  h.append('1h', staleTs, oneBucket());
  const r = healthCheck({ now: NOW, db: h });
  assert.equal(r.ok, false, 'a bucket older than the threshold needs warming');
  assert.match(r.detail, /needs warming/i);
  h.close();
});

ok('healthCheck: FRESH newest /1h bucket (≤ threshold) → ok:true', () => {
  const h = open(':memory:');
  h.append('1h', nowSec - 3600, oneBucket());                   // 1h old → fresh
  const r = healthCheck({ now: NOW, db: h });
  assert.equal(r.ok, true, 'a recent bucket is fresh');
  assert.match(r.detail, /fresh/i);
  h.close();
});

// ── 3. start(): runs both backfills, stamps lastRan, and (when a backfill appends) the age resets ──
await okAsync('start(): calls both backfills, stamps lastRan, resets newestBucket age', async () => {
  const h = open(':memory:');
  const staleTs = nowSec - (WARM_THRESHOLD_HOURS + 7) * 3600;
  h.append('1h', staleTs, oneBucket());
  assert.equal(healthCheck({ now: NOW, db: h }).ok, false, 'stale before warming');

  const statePath = freshStatePath();
  let n24 = 0, nBands = 0;
  const warm24h = async () => { n24++; h.append('1h', nowSec - 3600, oneBucket(101)); };  // append a FRESH bucket
  const warmBands = async () => { nBands++; };

  const res = await start({ now: NOW, statePath, warm24h, warmBands });
  assert.equal(res.ok, true);
  assert.equal(n24, 1, 'loadAll24hRolling backfill called exactly once');
  assert.equal(nBands, 1, 'loadBands backfill called exactly once');

  // lastRan stamped into the ONE keyed map under this daemon's name
  const state = loadState(statePath);
  assert.ok(state['cache-warm'], 'daemon-state.json has a cache-warm entry');
  assert.equal(state['cache-warm'].lastRan, new Date(NOW).toISOString(), 'lastRan advanced to injected now');

  // age reset: the fresh bucket the backfill appended flips healthCheck to ok:true
  assert.equal(healthCheck({ now: NOW, db: h }).ok, true, 'after warming, the archive reads fresh');

  // idempotent: a second start() is safe and re-stamps (backfills are check-before-fetch / no-op re-appends)
  const res2 = await start({ now: NOW, statePath, warm24h, warmBands });
  assert.equal(res2.ok, true, 'second start() is safe (idempotent)');
  assert.equal(n24, 2);
  h.close();
});

// ── 4. Through ensure(): STALE calls start (spy 1); FRESH does NOT (spy 0) ────────────────────────
await okAsync('ensure(): STALE guard → start() called once (counter === 1)', async () => {
  const h = open(':memory:');
  h.append('1h', nowSec - (WARM_THRESHOLD_HOURS + 7) * 3600, oneBucket());   // stale
  let starts = 0;
  const entry = {
    name: 'cache-warm', kind: 'guard', local: true,
    healthCheck: () => healthCheck({ now: NOW, db: h }),
    start: async () => { starts++; return { ok: true, detail: 'warmed' }; },
  };
  const actions = await ensure({ registry: [entry], statePath: freshStatePath(), now: NOW, minCheckIntervalMs: 0 });
  assert.equal(starts, 1, 'stale guard warmed exactly once');
  assert.equal(actions[0].action, 'started');
  h.close();
});

await okAsync('ensure(): FRESH guard → start() NOT called (counter === 0, not merely no-error)', async () => {
  const h = open(':memory:');
  h.append('1h', nowSec - 3600, oneBucket());                                // fresh
  let starts = 0;
  const entry = {
    name: 'cache-warm', kind: 'guard', local: true,
    healthCheck: () => healthCheck({ now: NOW, db: h }),
    start: async () => { starts++; return { ok: true, detail: 'warmed' }; },
  };
  const actions = await ensure({ registry: [entry], statePath: freshStatePath(), now: NOW, minCheckIntervalMs: 0 });
  assert.equal(starts, 0, 'a fresh archive must NOT trigger the expensive backfill');
  assert.equal(actions[0].action, 'ok');
  h.close();
});

// ── 5. NEVER-THROWS on a broken probe / broken backfill ──────────────────────────────────────────
ok('healthCheck: a throwing age-probe is caught → ok:false, no throw', () => {
  const boom = () => { throw new Error('archive exploded'); };
  let r;
  assert.doesNotThrow(() => { r = healthCheck({ now: NOW, ageHours: boom }); });
  assert.equal(r.ok, false, 'a broken probe fails safe toward needs-warming');
});

await okAsync('start(): a throwing backfill is caught → ok:false, no throw', async () => {
  const statePath = freshStatePath();
  const boom = async () => { throw new Error('fetch exploded'); };
  let res;
  await assert.doesNotReject(async () => { res = await start({ now: NOW, statePath, warm24h: boom, warmBands: async () => {} }); });
  assert.equal(res.ok, false, 'a broken backfill is reported, not raised');
  assert.match(res.detail, /warm failed/i);
});

console.log(`All ${n} checks passed.`);
