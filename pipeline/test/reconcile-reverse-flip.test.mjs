#!/usr/bin/env node
/**
 * reconcile-reverse-flip.test.mjs — RF3: the BANKED-backfill reconciliation advisory
 * (reconcile-reverse-flip.mjs, PLAN-REVERSE-FLIP). READ-ONLY script — it PRINTS a command, never runs
 * it, never writes a file. This suite drives it against TEMP fixtures via the COFFER_*_PATH env
 * overrides (never the real root stores) and asserts on stdout.
 *
 * TZ-HERMETIC: the emitted --time is formatted with toISOString() (always UTC, host-timezone-
 * independent), so the exact-string assertion holds identically on Ben's box and in UTC CI. The child
 * is spawned with TZ=UTC anyway as belt-and-braces; the expected string is a literal, not recomputed.
 *
 * Run: `node pipeline/test/reconcile-reverse-flip.test.mjs`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'commands', 'reconcile-reverse-flip.mjs');

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

/* write a temp fixture set and return the env pointing the CLI at it. */
function fixture({ rf = [], owned = { items: [] }, positions = { unmatched: [] } } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf3-'));
  const rfPath = path.join(dir, 'reverse-flip-state.json');
  const ownedPath = path.join(dir, 'owned-items.json');
  const posPath = path.join(dir, 'positions.json');
  fs.writeFileSync(rfPath, JSON.stringify(rf));
  fs.writeFileSync(ownedPath, JSON.stringify(owned));
  fs.writeFileSync(posPath, JSON.stringify(positions));
  return {
    dir, rfPath, ownedPath, posPath,
    env: {
      COFFER_REVERSE_FLIP_PATH: rfPath,
      COFFER_OWNED_PATH: ownedPath,
      COFFER_POSITIONS_PATH: posPath,
      TZ: 'UTC',
    },
  };
}

function run(env, args = []) {
  const res = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(res.status, 0, `exited ${res.status}\n${res.stderr}`);
  return res.stdout;
}

// The live Ancestral-hat Case-B shape: sold 1 @ 57m (sits in positions.unmatched with no prior buy),
// owned seed acquired earlier at a DISTINCT basis (52m) with seedTs 1753315200 (2025-07-24T00:00:00Z).
const HAT_OWNED = {
  id: 21018, name: 'Ancestral hat', seedQty: 1, seedTs: 1753315200,
  classification: 'keep', source: 'seed', seedBasis: 52_000_000,
};
const HAT_RF = {
  id: 21018, name: 'Ancestral hat', state: 'awaiting-rebuy',
  soldQty: 1, soldEach: 57_000_000, soldTs: 1753400000,   // sale ~23.5h AFTER the seedTs — a different ISO
  beRebuy: 55_860_000, targetQty: 1, declaredTs: 1753400100,
};
const HAT_UNMATCHED = { itemId: 21018, qty: 1, sellEach: 57_000_000, tax: 1_140_000, sellTs: 1753400000 };

// The EXACT expected command — item via --item, qty from the unmatched sell, --price = the owned
// seedBasis (52m, NOT the 57m sell price), --time = seedTs (2025-07-24T00:00:00Z), NOT the sellTs.
const EXPECTED_CMD =
  'node pipeline/commands/add-manual-fill.mjs --item "Ancestral hat" --type banked --qty 1 --price 52000000 --time "2025-07-24T00:00:00Z"';

/* --- happy path: declared cycle + matching unmatched sell → exact backfill command ---------------- */
ok('prints the EXACT add-manual-fill --type banked command for a declared Case-B unmatched sell', () => {
  const { env } = fixture({ rf: [HAT_RF], owned: { items: [HAT_OWNED] }, positions: { unmatched: [HAT_UNMATCHED] } });
  const out = run(env);
  assert.ok(out.includes(EXPECTED_CMD), `stdout missing the exact command.\n--- got ---\n${out}`);
  // seedTs-vs-sellTs discipline: the acquisition ISO is present; the SALE-time ISO is NOT.
  assert.ok(out.includes('--time "2025-07-24T00:00:00Z"'), 'must use the seedTs acquisition ISO');
  assert.ok(!out.includes('2025-07-24T23:33:20Z'), 'must NOT use the sellTs sale-time ISO');
  // basis, not sell price: 52m appears as the price, 57m does not appear as a --price value.
  assert.ok(out.includes('--price 52000000'), 'price is the acquisition basis');
  assert.ok(!out.includes('--price 57000000'), 'price must NOT be the sell price');
});

/* filtering by name/id targets the same single item without changing the emitted command. */
ok('item filter (name and id) yields the same exact command', () => {
  const { env } = fixture({ rf: [HAT_RF], owned: { items: [HAT_OWNED] }, positions: { unmatched: [HAT_UNMATCHED] } });
  assert.ok(run(env, ['Ancestral hat']).includes(EXPECTED_CMD), 'name filter');
  assert.ok(run(env, ['21018']).includes(EXPECTED_CMD), 'id filter');
});

/* --- no-declaration case: an unmatched sell with NO reverse-flip declaration → nothing, no FP ------ */
ok('no declaration → "nothing to reconcile", never a false-positive suggestion', () => {
  const { env } = fixture({ rf: [], owned: { items: [HAT_OWNED] }, positions: { unmatched: [HAT_UNMATCHED] } });
  const out = run(env);
  assert.equal(out.trim(), 'nothing to reconcile');
  assert.ok(!out.includes('add-manual-fill'), 'no command emitted without a declaration');
});

/* --- no-unmatched-match case: a declaration whose item has NO unmatched sell → nothing, no FP ------ */
ok('declaration but no matching unmatched sell → "nothing to reconcile", never a false positive', () => {
  const otherUnmatched = { itemId: 9999, qty: 5, sellEach: 100, tax: 0, sellTs: 1753400000 };
  const { env } = fixture({ rf: [HAT_RF], owned: { items: [HAT_OWNED] }, positions: { unmatched: [otherUnmatched] } });
  const out = run(env);
  assert.equal(out.trim(), 'nothing to reconcile');
  assert.ok(!out.includes('add-manual-fill'), 'no command emitted without a matching unmatched sell');
});

/* --- empty everything → nothing to reconcile ----------------------------------------------------- */
ok('empty stores → "nothing to reconcile"', () => {
  const { env } = fixture();
  assert.equal(run(env).trim(), 'nothing to reconcile');
});

console.log(`\nAll ${pass} checks passed.`);
