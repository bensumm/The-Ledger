#!/usr/bin/env node
/**
 * lint-plan-refs.test.mjs — acceptance for the plan-reference gate's two pure readers.
 *
 * Pins the behaviours that were WRONG before they were pinned, since those are the ones a future
 * edit will get wrong again:
 *   · `unwrap` — a long plan name wrapped mid-token across two comment lines read as two separate
 *     plans, which is a FALSE POSITIVE that fails a green build for no reason.
 *   · `chunkIdsIn` — chunk lists are written three ways in this corpus, and reading only two of them
 *     silently UNDER-reports, which is worse: the guard prints a clean run it has not earned.
 * Fixtures are literal strings, never the live tree, so the suite cannot flap as plans come and go.
 */
import assert from 'node:assert';
import { unwrap, chunkIdsIn } from '../ci/lint-plan-refs.mjs';

let passed = 0;
const ok = (name, fn) => { fn(); console.log(`  ✓ ${name}`); passed++; };

const PLAN_RE = /PLAN-[A-Z0-9]+(?:-[A-Z0-9]+)*/g;
const names = txt => unwrap(txt).match(PLAN_RE) || [];

// --- unwrap: the wrapped-name false positive ------------------------------------------
ok('a plan name wrapped mid-token across a JSDoc break rejoins to ONE name', () => {
  // The real shape that produced two bogus names: `PLAN-SCREEN-` / ` * ARCHITECTURE`.
  assert.deepStrictEqual(names(' * ... the PLAN-SCREEN-\n * ARCHITECTURE rework ...'),
    ['PLAN-SCREEN-ARCHITECTURE']);
});
ok('wrapping works across `//` and `#` continuations too, not just JSDoc', () => {
  assert.deepStrictEqual(names('// PLAN-REACH-\n// CALIBRATION'), ['PLAN-REACH-CALIBRATION']);
  assert.deepStrictEqual(names('# PLAN-REACH-\n# CALIBRATION'), ['PLAN-REACH-CALIBRATION']);
});
ok('an unwrapped name on one line is untouched, and two distinct names stay two', () => {
  assert.deepStrictEqual(names('see PLAN-VOL24 and PLAN-FORECAST'), ['PLAN-VOL24', 'PLAN-FORECAST']);
});
ok('unwrap does not fuse a hyphen that ends a real line of prose into the next word', () => {
  // A trailing hyphen with no PLAN- prefix cannot become a plan name — the join is harmless.
  assert.deepStrictEqual(names('a well-\nknown case, plus PLAN-VOL24'), ['PLAN-VOL24']);
});

// --- chunkIdsIn: all three declaration forms ------------------------------------------
ok('reads a chunk id from a HEADING', () => {
  assert.deepStrictEqual([...chunkIdsIn('### AC1 — the reader\n')], ['AC1']);
});
ok('reads a chunk id from a leading TABLE CELL, bold or bare', () => {
  assert.deepStrictEqual([...chunkIdsIn('| DT4b | what | files | ✅ |\n')], ['DT4b']);
  assert.deepStrictEqual([...chunkIdsIn('| **AF5b** | what | files | ✅ |\n')], ['AF5b']);
});
ok('reads a chunk id from a dashed BULLET — the form that hid a real three-way clash', () => {
  // PLAN-PERF-1H-ARCHIVE declares AC1–AC6 only like this; missing it hid the AC1 collision.
  assert.deepStrictEqual([...chunkIdsIn('- **AC1** — `makeTs1hArchiveReader` + predicate\n')], ['AC1']);
  assert.deepStrictEqual([...chunkIdsIn('- AC2 — shadow gate\n')], ['AC2']);
});
ok('an ordinary prose bullet with no trailing dash is NOT a chunk declaration', () => {
  assert.deepStrictEqual([...chunkIdsIn('- V2 of the thing is better than V1 was\n')], []);
});
ok('prose headings without a digit are dropped without needing a wordlist', () => {
  assert.deepStrictEqual([...chunkIdsIn('## Status\n## Chunks\n## Honesty (process rule 4)\n')], []);
});
ok('a PLAN- token is never mistaken for a chunk id', () => {
  assert.deepStrictEqual([...chunkIdsIn('## PLAN-VOL24 rollup\n| PLAN-FORECAST | x | y | z |\n')], []);
});
ok('compound ids used by real plans survive intact', () => {
  assert.deepStrictEqual([...chunkIdsIn('### V2-P4a — path engine\n')], ['V2-P4a']);
  assert.deepStrictEqual([...chunkIdsIn('### MT-V2/2 — the sibling reserve\n')], ['MT-V2/2']);
});
ok('the same id declared twice in one plan collapses to one entry', () => {
  assert.deepStrictEqual([...chunkIdsIn('### RF2 — surface\n| RF2 | done | f | ✅ |\n')], ['RF2']);
});
ok('a plan declaring several ids returns all of them, in first-seen order', () => {
  assert.deepStrictEqual([...chunkIdsIn('### AB1 — a\n### AB2 — b\n- **AB3** — c\n')],
    ['AB1', 'AB2', 'AB3']);
});

console.log(`\n✓ lint-plan-refs.test.mjs — ${passed} assertion group(s) passed`);
