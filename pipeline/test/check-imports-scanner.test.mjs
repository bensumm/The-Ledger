#!/usr/bin/env node
/**
 * check-imports-scanner.test.mjs — acceptance fixtures for the UNBOUND-CONSTANT scanner
 * (`unboundConstantsIn`, pipeline/ci/check-imports.mjs Part 2).
 *
 * WHY THIS FILE EXISTS. That scanner shipped BROKEN four times in one day, and each time it was
 * "verified" the same worthless way: run the CLI, see green. The CLI's aggregate pass/fail says nothing
 * about WHICH shapes it detects, so a scanner that had silently stopped scanning most of a file still
 * reported ✓. The repo already learned this lesson once as "a regression check that never called the
 * function it guarded". Every failure shape below is therefore a direct assertion on the function.
 *
 * The four shipped failures, all pinned here:
 *   1. `${…}` matched with [^{}]* → could not see NESTED braces, so it missed the very expression whose
 *      ReferenceError motivated the guard (`${liveAgeTag(x, { freshMin: QUICK_FRESH_MIN })}`).
 *   2. No regex-literal state → a quote/backtick inside a regex (`.replace(/"/g, …)`) opened a phantom
 *      string and everything to EOF went unscanned, silently.
 *   3. `return /"/…` still blinded it after fix 2, because REGEX_PREV_OK's 'return' entry is unreachable
 *      (both consumers set prevSig to a single CHARACTER), so it read as division.
 *   4. The parameter-list pattern also matched `if (X) {` / `while (X) {` / `switch (X) {`, and since
 *      bindings are per-file, ONE such line bound X for the whole file and masked a real unbound use.
 *
 * Run: `node pipeline/test/check-imports-scanner.test.mjs`  (exits non-zero on any failure).
 */
import assert from 'node:assert/strict';
import { unboundConstantsIn } from '../ci/check-imports.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };
const un = src => unboundConstantsIn(src).unbound;

/* ---- it catches a genuinely unbound constant, in the shapes that matter ---- */

ok('the base case: a bare unbound SCREAMING_SNAKE reference is reported', () => {
  assert.deepEqual(un('export const a = MISSING_ONE + 1;'), ['MISSING_ONE']);
});

ok('FAILURE 1 — inside a template ${…} with NESTED braces (the original ReferenceError shape)', () => {
  // This is the literal shape that crashed quote-items.mjs: a call with an options object inside an
  // interpolation. A [^{}]* match cannot span it.
  const src = 'export const t = (x) => `live ${fmt(x)}${tag(x.a, { freshMin: MISSING_TWO })}`;';
  assert.ok(un(src).includes('MISSING_TWO'), 'must see through a nested-brace interpolation');
});

ok('FAILURE 1b — a template nested inside another template interpolation', () => {
  const src = 'export const t = (x) => `a ${x ? `b ${MISSING_NEST}` : ``} c`;';
  assert.ok(un(src).includes('MISSING_NEST'));
});

ok('FAILURE 2 — a regex containing a quote does not blind the rest of the file', () => {
  const src = [
    "export const a = 'x'.replace(/\"/g, '&quot;');",
    'export const b = /[\'"]/g;',
    'export const c = /https?:\\/\\//;',
    'export const d = /[`]/;',
    'export const z = MISSING_AFTER_REGEX + 1;',
  ].join('\n');
  assert.ok(un(src).includes('MISSING_AFTER_REGEX'), 'a quote/backtick inside a regex must not open a phantom literal');
});

ok('FAILURE 3 — `return /"/…` is a REGEX, not division, so the file stays scanned', () => {
  const src = 'export function g(s){ return /"/.test(s); }\nexport function h(){ return MISSING_AFTER_RETURN + 1; }';
  assert.ok(un(src).includes('MISSING_AFTER_RETURN'), "REGEX_PREV_OK's word entries are unreachable via a 1-char prevSig — keywords must be matched by word");
});

ok('FAILURE 4 — control-flow parens do NOT bind, so they cannot mask a real use', () => {
  // The masking form: the same name appears in an `if (…)` head AND as a genuine unbound reference.
  for (const kw of ['if', 'while', 'switch']) {
    const src = `export function g(o) {\n  ${kw} (o.MASKED_CONST) { }\n  return MASKED_CONST + 1;\n}`;
    assert.ok(un(src).includes('MASKED_CONST'), `${kw} (…) { } must not bind MASKED_CONST`);
  }
});

ok('FAILURE 5 — a brace inside a STRING inside `${…}` does not unbalance the scan', () => {
  // Counting a quoted brace as a real brace left depth permanently open, so the closing backtick
  // re-entered scanTemplate() and the scan ran to EOF. Latent when found (no tracked file triggered it).
  for (const interior of ['f("{")', "f('{')", 'f("}")']) {
    const src = 'export const a = `x ${' + interior + '} y`;\nexport const z = MISSING_BRACE_STR + 1;';
    assert.ok(un(src).includes('MISSING_BRACE_STR'), `a quoted brace in ${interior} must not blind the rest of the file`);
  }
});

ok('a TERNARY consequent is a reference, not an object key', () => {
  // `c ? MAX_X : 0` looks exactly like a key to the trailing-colon heuristic.
  assert.ok(un('export const a = (c) => c ? MISSING_TERNARY : 0;').includes('MISSING_TERNARY'));
});

ok('a `case X:` label is a REFERENCE, not an object key', () => {
  const src = 'export function p(v){ switch (v) { case MISSING_CASE: return 1; default: return 0; } }';
  assert.ok(un(src).includes('MISSING_CASE'));
});

/* ---- and it stays SILENT on correct code (a false positive is worse than a miss:
       it is a mysterious CI failure that teaches people to distrust the guard) ---- */

ok('parameters bind — plain, arrow, and destructured', () => {
  assert.deepEqual(un('export function f(MAX_P) { return MAX_P; }'), []);
  assert.deepEqual(un('export const f = (MAX_A) => MAX_A;'), []);
  assert.deepEqual(un('export function f({ MAX_D }) { return MAX_D; }'), []);
});

ok('catch params, labels and class fields bind', () => {
  assert.deepEqual(un('export function f(){ try { g(); } catch (SOME_ERR) { return SOME_ERR; } }'), []);
  assert.deepEqual(un('export function f(){ OUTER_LOOP: for (;;) { continue OUTER_LOOP; } }'), []);
  assert.deepEqual(un('export class K { static MAX_FIELD = 3; m(){ return K.MAX_FIELD; } }'), []);
});

ok('a multi-declarator const list binds EVERY name, not just the first', () => {
  // The first draft reported six false positives, all of this shape.
  assert.deepEqual(un('const A_ONE = 1, B_TWO = 2;\nexport const z = A_ONE + B_TWO;'), []);
});

ok('a for-of head does not bind the ITERATED expression', () => {
  // `for (const h of f(X))` must not "declare" X — that would wave through real errors.
  assert.ok(un('export function g(){ for (const h of f(MISSING_ITER)) { void h; } }').includes('MISSING_ITER'));
  assert.deepEqual(un('export function g(){ for (const OK_NAME of [1]) { void OK_NAME; } }'), []);
});

ok('member accesses and object keys are not references', () => {
  assert.deepEqual(un('export const a = o.MAX_Q + o . MAX_R;'), []);
  assert.deepEqual(un('export const a = { MAX_KEY: 1, OTHER_KEY : 2 };'), []);
});

ok('a string literal inside an interpolation is not code', () => {
  assert.deepEqual(un("export const g = (c) => `${c ? 'NOT_LISTED_YET' : ''}`;"), []);
});

ok('a RE-EXPORT is neither a binding nor a reference', () => {
  // `export { X } from './y.mjs'` creates no local binding and is not a use. Counting it produced four
  // false positives in js/estimators/pair.mjs the moment the scanner was pointed outside commands/.
  assert.deepEqual(un("export { EST_SOME_CONST } from './sell-models/reach-fold.mjs';"), []);
});

ok('comments never contribute a reference', () => {
  assert.deepEqual(un('// mentions MISSING_IN_COMMENT\n/* and MISSING_IN_BLOCK */\nexport const a = 1;'), []);
});

ok('imported names count as bound', () => {
  assert.deepEqual(un("import { REAL_CONST } from './x.mjs';\nexport const a = REAL_CONST + 1;"), []);
  assert.deepEqual(un("import { A_B as LOCAL_NAME } from './x.mjs';\nexport const a = LOCAL_NAME + 1;"), []);
});

console.log(`\nAll ${pass} acceptance checks passed.`);
