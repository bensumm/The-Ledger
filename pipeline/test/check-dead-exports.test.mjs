#!/usr/bin/env node
/**
 * check-dead-exports.test.mjs — pins the RC-A guard's pure helpers (check-dead-exports.mjs).
 *
 * The guard's own occurrence-counter had a false-positive bug (2026-07-14): its naive regex
 * comment-stripper corrupted function bodies with template literals — it dropped `STAGES` from a
 * `${STAGES.join('|')}` interpolation, flagging a LIVE symbol as dead. A false-positive guard gets
 * disabled, so these fixtures pin the character-scanner stripComments (comments out, strings/templates/
 * regexes preserved verbatim) + the marker + owned-export + import parsers. No live data (rule 4).
 * Run: `node pipeline/test/check-dead-exports.test.mjs` (exits non-zero on any failure).
 */
import assert from 'node:assert/strict';
import { stripComments, ownedExports, testOnlyNames, namedImports } from '../ci/check-dead-exports.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };
const count = (src, name) => (stripComments(src).match(new RegExp(`(?<![\\w$])${name}(?![\\w$])`, 'g')) || []).length;

console.log('dead-export-check pure-helper acceptance:');

/* --- stripComments: the regression + the literal-awareness that fixes it ------------------- */
ok('REGRESSION: an identifier used inside a `${…}` template interpolation still counts', () => {
  // this is exactly the STAGES case: a decl + a use inside a template literal.
  const src = "export const STAGES = ['a','b'];\nfunction v(p){ if(!STAGES.includes(p.s)) warn(`want ${STAGES.join('|')}`); }";
  assert.equal(count(src, 'STAGES'), 3, 'declaration + code use + template-interp use all survive the strip');
});

ok('a real // line comment and /* block */ comment are removed', () => {
  const src = 'const x = 1; // FOO mentioned in a comment\n/* BAR mentioned in a block */ const y = 2;';
  assert.equal(count(src, 'FOO'), 0, 'line-comment mention stripped');
  assert.equal(count(src, 'BAR'), 0, 'block-comment mention stripped');
});

ok('a // or /* inside a STRING is NOT treated as a comment (string content preserved)', () => {
  const src = 'const u = "http://x/*y*/z QUX"; const q = QUX2;';
  // the string is preserved verbatim, so the code AFTER it (QUX2) is not swallowed by a phantom comment.
  assert.equal(count(src, 'QUX2'), 1, 'code after a string containing // and /* is intact');
});

ok('a regex literal containing / is not mis-parsed as a comment', () => {
  const src = 'const re = /a\\/\\/b/g; const AFTER = 1;';   // regex has an escaped // inside
  assert.equal(count(src, 'AFTER'), 1, 'code after a regex with // inside survives');
});

/* --- ownedExports: what the file OWNS (not re-exports / defaults) -------------------------- */
ok('ownedExports finds const/function/class + `export { a, b as c }`; skips default + re-exports', () => {
  const src = [
    'export const A = 1;',
    'export function B(){}',
    'export class C {}',
    'const d = 2, e = 3; export { d, e as ee };',
    'export default A;',            // name-agnostic → not owned
    "export * from './x.mjs';",     // pass-through → owned elsewhere
    "export { z } from './y.mjs';", // re-export → owned by y
  ].join('\n');
  const owned = ownedExports(src);
  assert.deepEqual([...owned].sort(), ['A', 'B', 'C', 'd', 'ee'], 'owns declared names + renamed local exports only');
  assert.ok(!owned.has('z'), 're-export from another module is not owned here');
});

/* --- testOnlyNames: the acknowledgement markers ------------------------------------------- */
ok('testOnlyNames detects @test-only and @provisional-api, incl. a multi-line reason', () => {
  const src = [
    '// @test-only: run by foo.test.mjs',
    'export function harness(){}',
    '// @provisional-api: pending PF2 surface — reason spans',
    '// a second comment line before the export',
    'export const KNOB = 12;',
    'export function notMarked(){}',
  ].join('\n');
  const marked = testOnlyNames(src);
  assert.ok(marked.has('harness'), '@test-only associates with the next export');
  assert.ok(marked.has('KNOB'), '@provisional-api with a multi-line reason still associates');
  assert.ok(!marked.has('notMarked'), 'an unmarked export is not skipped');
});

/* --- namedImports: consumers ------------------------------------------------------------- */
ok('namedImports collects named imports from relative specifiers (exported name before `as`)', () => {
  const src = "import { a, b as bb } from './m.mjs';\nimport def from './d.mjs';\nimport { c } from 'node:fs';";
  const imp = namedImports(src);
  assert.ok(imp.has('a') && imp.has('b'), 'named + renamed (exported name) collected');
  assert.ok(!imp.has('c'), 'a bare/node: specifier is not a relative import');
});

console.log(`\nAll ${pass} dead-export-check helper checks passed.`);
