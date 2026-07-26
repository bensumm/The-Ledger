#!/usr/bin/env node
/**
 * reverse-flip-cli.test.mjs — RF0: round-trip the two declare-* CLIs against a TEMP store
 * (declare-owned.mjs, declare-reverse-flip.mjs, PLAN-REVERSE-FLIP). NEVER touches the real root
 * owned-items.json / reverse-flip-state.json — the COFFER_OWNED_PATH / COFFER_REVERSE_FLIP_PATH env
 * overrides point each CLI at a tmpdir store. Numeric ids are used so item resolution never fetches
 * the live mapping (offline + TZ-hermetic).
 *
 * Run: `node pipeline/test/reverse-flip-cli.test.mjs`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OWNED_CLI = path.join(HERE, '..', 'commands', 'declare-owned.mjs');
const RF_CLI = path.join(HERE, '..', 'commands', 'declare-reverse-flip.mjs');

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

function run(cli, args, env) {
  const res = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(res.status, 0, `${path.basename(cli)} ${args.join(' ')} exited ${res.status}\n${res.stderr}`);
  return res.stdout;
}

/* --- declare-owned: seed → classify → list ------------------------------------------------------- */
ok('declare-owned round-trips seed/classify/list against a temp store', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf0-owned-'));
  const store = path.join(dir, 'owned-items.json');
  const env = { COFFER_OWNED_PATH: store, COFFER_FILLS_PATH: path.join(dir, 'no-fills.json') };

  run(OWNED_CLI, ['seed', '21018', '--qty', '1'], env);
  let disk = JSON.parse(fs.readFileSync(store, 'utf8'));
  assert.equal(disk.items.length, 1);
  assert.equal(disk.items[0].id, 21018);
  assert.equal(disk.items[0].seedQty, 1);
  assert.equal(disk.items[0].classification, 'keep', 'seed defaults to keep');
  assert.equal('reverseFlipEligible' in disk.items[0], false, 'no eligibility flag (Ruling 8)');

  run(OWNED_CLI, ['classify', '21018', 'flip'], env);
  disk = JSON.parse(fs.readFileSync(store, 'utf8'));
  assert.equal(disk.items[0].classification, 'flip', 'classify persisted');

  const listed = run(OWNED_CLI, ['list'], env);
  assert.match(listed, /21018/);
});

/* --- declare-reverse-flip: set → list → advance → clear → list empty ----------------------------- */
ok('declare-reverse-flip round-trips set/list/advance/clear against a temp store', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf0-cycle-'));
  const store = path.join(dir, 'reverse-flip-state.json');
  const env = { COFFER_REVERSE_FLIP_PATH: store };

  run(RF_CLI, ['set', '21018', '--state', 'awaiting-rebuy', '--sold-each', '57m', '--qty', '1'], env);
  let disk = JSON.parse(fs.readFileSync(store, 'utf8'));
  assert.equal(disk.length, 1);
  assert.equal(disk[0].state, 'awaiting-rebuy');
  assert.equal(disk[0].soldEach, 57_000_000);
  assert.equal(disk[0].beRebuy, 57_000_000 - 1_140_000, 'beRebuy = soldEach − tax(soldEach); tax(57m)=floor(57m*2%)=1.14m (5m cap only binds >250m)');

  const listed = run(RF_CLI, ['list'], env);
  assert.match(listed, /21018/);
  assert.match(listed, /awaiting-rebuy/);

  run(RF_CLI, ['advance', '21018', '--state', 'rebuy-armed', '--bid', '54.05m'], env);
  disk = JSON.parse(fs.readFileSync(store, 'utf8'));
  assert.equal(disk[0].state, 'rebuy-armed');
  assert.equal(disk[0].rebuyBidPrice, 54_050_000);
  assert.equal(disk[0].soldEach, 57_000_000, 'sell-leg preserved through advance');

  run(RF_CLI, ['clear', '21018'], env);
  disk = JSON.parse(fs.readFileSync(store, 'utf8'));
  assert.deepEqual(disk, [], 'clear empties the store');

  const empty = run(RF_CLI, ['list'], env);
  assert.match(empty, /no reverse-flip cycles/);
});

console.log(`\nAll ${pass} checks passed.`);
