#!/usr/bin/env node
/**
 * sync-fills.test.mjs — acceptance fixtures for the git-FREE regeneration core (LW1).
 *
 * regenerate() is the reusable entry the `--local` flag and the watch-log.mjs daemon both run.
 * The whole point of the LW1 design is that this path does ZERO git operations, preserving the
 * FILLS-PIPELINE.md §12 invariant (no unattended writer to `main`). These fixtures pin that with
 * SYNTHETIC logs in a TEMP dir — never the real ~/.runelite or repo (CLAUDE.md rule 4). Importing
 * sync-fills.mjs is safe: its main() is behind an invocation guard, so nothing runs on import.
 * Run: `node pipeline/test/sync-fills.test.mjs`  (exits non-zero on any failure).
 *
 * BUSINESS REQUIREMENTS pinned here (diff a change against these):
 *   - regenerate({ write:true, logDir, repoDir }) writes fills.json / positions.json / offers.json
 *     to repoDir from the synthetic log, with correct reconstruction + live-offer snapshot.
 *   - It performs NO git of any kind: it runs to completion in a plain (non-git) temp dir — any
 *     execSync('git …') there would throw — AND its function source contains no git call token.
 *   - offers.json carries only resting (BUYING/SELLING) slots; a terminal BOUGHT does not surface
 *     as an offer but DOES become an open position.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { regenerate } from '../sync-fills.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

// One synthetic exchange-logger JSON line (plugin field names: item/qty/worth/max/offer).
const line = o => JSON.stringify(o);
function makeTempDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coffer-lw1-'));
  const logDir = path.join(root, 'exchange-logger');
  const repoDir = path.join(root, 'repo');
  fs.mkdirSync(logDir); fs.mkdirSync(repoDir);
  return { root, logDir, repoDir };
}

console.log('LW1 regenerate() git-free core acceptance:');

// --- 1. regenerate writes fills/positions/offers from a synthetic log, no git repo present ------
ok('writes fills/positions/offers.json into a NON-git temp repo (proves the path never shells git)', () => {
  const { logDir, repoDir } = makeTempDirs();
  fs.writeFileSync(path.join(logDir, 'exchange.log'), [
    // a completed BUY of 10 @ 50 → an open position of 10
    line({ date: '2026-07-05', time: '12:00:00', state: 'BOUGHT', slot: 1, item: 561, qty: 10, worth: 500, max: 10, offer: 50 }),
    // a resting BUY offer (filled 0) → surfaces in offers.json, NOT as a position
    line({ date: '2026-07-05', time: '12:05:00', state: 'BUYING', slot: 0, item: 4151, qty: 0, worth: 0, max: 5, offer: 100 }),
  ].join('\n') + '\n');

  // repoDir is a plain directory — NOT a git repo. If regenerate() shelled ANY git command with
  // cwd=repoDir it would throw ("not a git repository"); a clean completion proves it did none.
  const r = regenerate({ write: true, logDir, repoDir });

  assert.ok(fs.existsSync(path.join(repoDir, 'fills.json')), 'fills.json written');
  assert.ok(fs.existsSync(path.join(repoDir, 'positions.json')), 'positions.json written');
  assert.ok(fs.existsSync(path.join(repoDir, 'offers.json')), 'offers.json written');
  assert.ok(!fs.existsSync(path.join(repoDir, '.git')), 'no .git — regenerate never initialised/committed');

  // reconstruction: the BOUGHT 10 @ 50 is an open lot; the resting BUY is not a position.
  const pos = JSON.parse(fs.readFileSync(path.join(repoDir, 'positions.json'), 'utf8'));
  assert.deepEqual(pos.open.map(o => [o.itemId, o.qty, o.buyEach]), [[561, 10, 50]], 'the filled buy is one open lot');

  // offers.json: exactly the one resting BUY, mapped to the flat schema.
  const offers = JSON.parse(fs.readFileSync(path.join(repoDir, 'offers.json'), 'utf8'));
  assert.equal(offers.offers.length, 1, 'only the resting BUYING slot is an offer (terminal BOUGHT excluded)');
  assert.equal(offers.offers[0].side, 'buy');
  assert.equal(offers.offers[0].itemId, 4151);
  assert.equal(offers.offers[0].qty, 5, 'qty is the total offer size');

  assert.ok(r.changed, 'a fresh temp repo → changed');
});

// --- 2. structural guard: regenerate()'s source contains no git call token ---------------------
// A functional run in a non-git dir already proves no git ran; this second guard pins it at the
// source level so a future edit that sneaks a git op INTO regenerate (rather than the attended
// main() wrapper) fails loudly, even if that op were wrapped in a try/catch that swallowed a throw.
ok('regenerate() source contains no git CALL surface (git() / execSync / syncMainToRemote)', () => {
  const src = regenerate.toString();
  // Every git operation in this file goes through the module `git()` execSync helper or the
  // remote-reconcile `syncMainToRemote()`; the call SURFACES (not English prose like "commit")
  // are what must be absent from regenerate — they live only in the attended main() wrapper.
  for (const token of ['git(', 'execSync', 'syncMainToRemote']) {
    assert.ok(!src.includes(token), `regenerate() must not reference "${token}" — git belongs only in the attended main() wrapper`);
  }
});

console.log(`\nAll ${pass} acceptance checks passed.`);
