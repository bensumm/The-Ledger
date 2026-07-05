#!/usr/bin/env node
/**
 * table.test.mjs — the reusable sortable-table comparator (TD2.2).
 *
 * The comparator was factored out of makeSortable (which calls getElementById at construction)
 * into the pure exported compareRows(column, dir) so the sort rules can be fixture-tested in
 * node with no DOM. compareRows drives every sortable table in the app (Finder, Watchlist,
 * Ledger closed-flips), so these rules are the contract every column descriptor relies on.
 *
 * BUSINESS REQUIREMENTS:
 *   - Numeric columns sink a missing/null field to -Infinity so blanks always sort LAST
 *     (the Finder's `?? -Infinity` null-handling).
 *   - String columns compare with a locale-naive `>`/`<`; numeric columns compare numbers.
 *   - `invert:true` (the risk-grade quirk — a LOWER riskIndex is a BETTER grade) flips the
 *     NUMERIC direction only; a string column ignores `invert`.
 *   - `dir` flips the whole ordering: -1 descending, +1 ascending.
 *
 * Synthetic rows only. Run: `node pipeline/table.test.mjs`  (exits non-zero on any failure).
 */
import assert from 'node:assert/strict';
import { compareRows } from '../js/table.js';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

// sort a copy with a column descriptor + direction, returning the ordered key list for asserts.
const order = (rows, col, dir, keyGet = r => r.k) => rows.slice().sort(compareRows(col, dir)).map(keyGet);

const numCol = { type: 'num', get: r => r.v };
const strCol = { type: 'str', get: r => r.v };
const riskCol = { type: 'num', get: r => r.v, invert: true };

/* --- numeric null-sinking --------------------------------------------------------------- */
ok('numeric column sinks null/undefined to -Infinity — blanks sort LAST on a desc sort', () => {
  const rows = [{ k: 'a', v: 5 }, { k: 'b', v: null }, { k: 'c', v: 20 }, { k: 'd', v: undefined }];
  // dir -1 (desc): 20, 5, then the two blanks (order among equal -Infinity is stable → b before d)
  assert.deepEqual(order(rows, numCol, -1), ['c', 'a', 'b', 'd']);
});

ok('numeric column ascending puts blanks FIRST (still -Infinity, now smallest wins first)', () => {
  const rows = [{ k: 'a', v: 5 }, { k: 'b', v: null }, { k: 'c', v: 20 }];
  assert.deepEqual(order(rows, numCol, +1), ['b', 'a', 'c']);
});

/* --- string vs numeric ------------------------------------------------------------------ */
ok('string column compares lexicographically, not numerically', () => {
  const rows = [{ k: 'x', v: 'Bandos' }, { k: 'y', v: 'Abyssal' }, { k: 'z', v: 'Cannon' }];
  // dir +1 (asc): Abyssal, Bandos, Cannon
  assert.deepEqual(order(rows, strCol, +1), ['y', 'x', 'z']);
  // a numeric column would order '10' < '9'; a string column keeps them lexical
  const nums = [{ k: 'a', v: '10' }, { k: 'b', v: '9' }];
  assert.deepEqual(order(nums, strCol, +1), ['a', 'b']);   // '10' < '9' lexically
});

ok('numeric column orders by value (10 > 9), unlike the string comparator', () => {
  const rows = [{ k: 'a', v: 10 }, { k: 'b', v: 9 }];
  assert.deepEqual(order(rows, numCol, -1), ['a', 'b']);   // 10 first on desc
});

/* --- the risk-grade invert quirk -------------------------------------------------------- */
ok('invert flips numeric direction: lower riskIndex sorts as "better" (first) on a desc sort', () => {
  // riskIndex 0 = grade A (best), 4 = worst. "desc" (dir -1, the default) should show A first.
  const rows = [{ k: 'C', v: 2 }, { k: 'A', v: 0 }, { k: 'B', v: 1 }];
  assert.deepEqual(order(rows, riskCol, -1), ['A', 'B', 'C']);           // inverted: ascending by index
  // a NON-inverted numeric column on the same data goes the other way
  assert.deepEqual(order(rows, numCol, -1), ['C', 'B', 'A']);
});

ok('invert is ignored by string columns (only numeric direction flips)', () => {
  const invStr = { type: 'str', get: r => r.v, invert: true };
  const rows = [{ k: 'x', v: 'b' }, { k: 'y', v: 'a' }];
  // string comparator uses the RAW dir regardless of invert → asc gives a, b
  assert.deepEqual(order(rows, invStr, +1), ['y', 'x']);
});

/* --- direction flip --------------------------------------------------------------------- */
ok('flipping dir reverses the ordering', () => {
  const rows = [{ k: 'a', v: 1 }, { k: 'b', v: 2 }, { k: 'c', v: 3 }];
  assert.deepEqual(order(rows, numCol, -1), ['c', 'b', 'a']);
  assert.deepEqual(order(rows, numCol, +1), ['a', 'b', 'c']);
});

console.log(`\nAll ${pass} checks passed.`);
