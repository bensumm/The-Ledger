#!/usr/bin/env node
/**
 * lint-comments.test.mjs — drives pipeline/ci/lint-comments.mjs through its CLI against fixture trees.
 *
 * It shipped with no test and could not have one: ROOT and BASELINE were hard-coded, so the only way to
 * exercise it was mutating the live repo. Every case below is a hole that was found live after the guard
 * had already passed CI green — block interiors counted as CODE, trailing prose rewarded, a deleted JSON
 * key laundering a ceiling, a rename resetting the ratchet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = join(dirname(fileURLToPath(import.meta.url)), '..', 'ci', 'lint-comments.mjs');

function fixture(files, baseline = null) {
  const root = mkdtempSync(join(tmpdir(), 'lintcomments-'));
  mkdirSync(join(root, 'js'), { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(root, 'js', name), body);
  if (baseline) writeFileSync(join(root, 'comment-budget.json'), JSON.stringify(baseline, null, 2));
  return root;
}
const run = (root, ...args) => {
  const r = spawnSync(process.execPath, [GUARD, '--root', root, ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
const budget = root => JSON.parse(readFileSync(join(root, 'comment-budget.json'), 'utf8'));
const codeLines = n => Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join('\n');

test('block-comment INTERIORS count as comment, not code', () => {
  // The hole: a /* … */ body written without leading `*` matched no line-shape test, so it scored as
  // CODE — prose bought allowance. js/quotecore.js's whole canonical header is written this way.
  const body = ['/* header', ...Array.from({ length: 40 }, (_, i) => `   narrative line ${i}`), '*/', 'export const a = 1;'].join('\n');
  const root = fixture({ 'mod.mjs': body });
  const { out } = run(root, '--report');
  assert.match(out, /42c\/1k/, `expected 42 comment lines over 1 code line, got: ${out}`);
  rmSync(root, { recursive: true, force: true });
});

test('a dated ref inside a starless block interior is still caught', () => {
  const body = ['/* header', '   corrected 2026-08-09 — this used to read 2', '   again 2026-08-10',
    '   and once more 2026-08-11', '*/', 'export const a = 1;'].join('\n');
  const root = fixture({ 'mod.mjs': body });
  const { code, out } = run(root);
  assert.equal(code, 1, out);
  assert.match(out, /new-file-dated/);
  rmSync(root, { recursive: true, force: true });
});

test('moving prose from leading to trailing position is volume-NEUTRAL, never a discount', () => {
  const lead = fixture({ 'mod.mjs': `${Array.from({ length: 30 }, (_, i) => `// note ${i}`).join('\n')}\n${codeLines(30)}` });
  const trail = fixture({ 'mod.mjs': Array.from({ length: 30 }, (_, i) => `export const v${i} = ${i};   // note ${i}`).join('\n') });
  const a = run(lead, '--report'), b = run(trail, '--report');
  assert.match(a.out, /30c\/30k/, a.out);
  assert.match(b.out, /30c\/30k/, b.out);   // 1 comment AND 1 code, so the migration buys nothing
  rmSync(lead, { recursive: true, force: true });
  rmSync(trail, { recursive: true, force: true });
});

test('new file: under the allowance passes, over it fails', () => {
  const under = fixture({ 'mod.mjs': `${Array.from({ length: 20 }, () => '// x').join('\n')}\n${codeLines(60)}` });
  assert.equal(run(under).code, 0);
  const over = fixture({ 'mod.mjs': `${Array.from({ length: 40 }, () => '// x').join('\n')}\n${codeLines(60)}` });
  const r = run(over);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /new-file-volume/);
  rmSync(under, { recursive: true, force: true });
  rmSync(over, { recursive: true, force: true });
});

test('the allowance FLOOR lets a small file carry a real header, but not an essay', () => {
  // A `code >= N` minimum instead of a floor would exempt the worst shape there is: an essay over two
  // constants. The floor caps it at 20 while still leaving room for a genuine contract header.
  const okSmall = fixture({ 'mod.mjs': `${Array.from({ length: 20 }, () => '// x').join('\n')}\n${codeLines(2)}` });
  assert.equal(run(okSmall).code, 0);
  const essay = fixture({ 'mod.mjs': `${Array.from({ length: 21 }, () => '// x').join('\n')}\n${codeLines(2)}` });
  assert.equal(run(essay).code, 1);
  rmSync(okSmall, { recursive: true, force: true });
  rmSync(essay, { recursive: true, force: true });
});

test('the ratchet bites one added comment line on a baselined file', () => {
  const root = fixture({ 'mod.mjs': `// a\n${codeLines(40)}` }, { files: { 'js/mod.mjs': { dated: 0, block: 40, comments: 1 } } });
  assert.equal(run(root).code, 0);
  writeFileSync(join(root, 'js', 'mod.mjs'), `// a\n// b\n${codeLines(40)}`);
  const r = run(root);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /ratchet-volume/);
  rmSync(root, { recursive: true, force: true });
});

test('a baseline entry with NO comments field fails CLOSED, and bless will not launder it', () => {
  // Deleting one JSON key was a cheaper red-build reflex than typing --force, and it passed silently.
  const root = fixture({ 'mod.mjs': `${Array.from({ length: 30 }, () => '// x').join('\n')}\n${codeLines(40)}` },
    { files: { 'js/mod.mjs': { dated: 0, block: 40 } } });
  const r = run(root);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /ceiling 0/);
  assert.equal(run(root, '--bless').code, 1, 'bless must refuse without --force');
  rmSync(root, { recursive: true, force: true });
});

test('bless refuses to raise a ceiling without --force, and leaves the baseline untouched', () => {
  const root = fixture({ 'mod.mjs': `// a\n// b\n${codeLines(40)}` }, { files: { 'js/mod.mjs': { dated: 0, block: 40, comments: 1 } } });
  const before = readFileSync(join(root, 'comment-budget.json'), 'utf8');
  assert.equal(run(root, '--bless').code, 1);
  assert.equal(readFileSync(join(root, 'comment-budget.json'), 'utf8'), before, 'a refused bless must not write');
  assert.equal(run(root, '--bless', '--force').code, 0);
  assert.equal(budget(root).files['js/mod.mjs'].comments, 2);
  rmSync(root, { recursive: true, force: true });
});

test('a RENAME is surfaced at bless rather than silently resetting the ratchet', () => {
  const root = fixture({ 'mod.mjs': `${Array.from({ length: 60 }, () => '// x').join('\n')}\n${codeLines(200)}` },
    { files: { 'js/mod.mjs': { dated: 0, block: 40, comments: 1 } } });
  renameSync(join(root, 'js', 'mod.mjs'), join(root, 'js', 'mod2.mjs'));
  const r = run(root, '--bless');
  assert.match(r.out, /no file on disk — deleted or RENAMED: js\/mod\.mjs/, r.out);
  rmSync(root, { recursive: true, force: true });
});

test('bless refuses a NEW file that is over doctrine', () => {
  const root = fixture({ 'mod.mjs': `${Array.from({ length: 40 }, () => '// x').join('\n')}\n${codeLines(2)}` }, { files: {} });
  const r = run(root, '--bless');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /NEW file over doctrine/);
  rmSync(root, { recursive: true, force: true });
});

test('a DATA CAVEATS block exempts its dates; the same dates elsewhere do not', () => {
  const caveat = fixture({ 'mod.mjs': `// DATA CAVEATS\n// volDay absent before 2026-08-11\n${codeLines(40)}` });
  assert.equal(run(caveat).code, 0);
  const plain = fixture({ 'mod.mjs': `// volDay absent before 2026-08-11\n// and also 2026-08-12\n// and 2026-08-13\n${codeLines(40)}` });
  assert.equal(run(plain).code, 1);
  rmSync(caveat, { recursive: true, force: true });
  rmSync(plain, { recursive: true, force: true });
});
