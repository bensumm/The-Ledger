/* lint-skills-scope.test.mjs — fail-path proofs for lint-skills.mjs's SCOPE gate.
 *
 * WHY THIS EXISTS: `SKILL_FILES` is a hand-kept array, and the only thing ever comparing it to disk was
 * `lint-plan-lifecycle.mjs`'s skillDrift REPORT — which is not in checks.yml. So a new skill could be
 * added and never linted while CI kept printing a green "every rule-block is tagged" over a silently
 * shrunken scope. Same shape as check-daemon-safety.mjs reading one directory while most of the fleet
 * lived in another.
 *
 * ⚠ EVERY CASE DRIVES main() THROUGH THE CLI, NOT the exported helper. The first version of this file
 * tested `scopeDrift()` alone and was MUTATION-BLIND: stubbing the failure branch to `if (false && …)`
 * left all of its assertions green while a real unlisted skill went unlinted. A test that cannot tell a
 * working gate from a disabled one is not a regression test — it is the CLAUDE.md rule 10 anchor ("a
 * regression check that never called the function it guarded") reproduced inside the fix for it. The
 * `--root` flag exists for exactly this reason. Keep the helper-level checks as a SUPPLEMENT, never as
 * the proof.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scopeDrift, SKILL_FILES } from '../ci/lint-skills.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const GUARD = path.join(ROOT, 'pipeline', 'ci', 'lint-skills.mjs');

const rel = (n) => `.claude/skills/${n}/SKILL.md`;
/** Every skill the real SKILL_FILES declares, by directory name. */
const DECLARED = SKILL_FILES.map((p) => p.split('/')[2]);

/**
 * A fixture repo root holding `.claude/skills/<name>/SKILL.md` for each name. The stubs are
 * rule-block-free on purpose: they lint clean, so any non-zero exit is attributable to the SCOPE gate
 * and not to an untagged block.
 */
function fixture(names) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-scope-'));
  for (const n of names) {
    const dir = path.join(root, '.claude', 'skills', n);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '# stub\n\nNo rule-blocks here.\n');
  }
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, '--root', root], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

test('BASELINE: a fixture mirroring the declared set exits 0 — so a red below means the gate, not the fixture', () => {
  const { code, out } = run(fixture(DECLARED));
  assert.equal(code, 0, out);
});

test('GATE ACTS: a skill on disk but absent from SKILL_FILES FAILS the run (the silent coverage-loss direction)', () => {
  const { code, out } = run(fixture([...DECLARED, 'newskill']));
  assert.equal(code, 1, 'an unlisted skill must fail the build, not merely be computed\n' + out);
  assert.match(out, /NOT LINTED/);
  assert.match(out, /newskill/);
});

test('GATE ACTS: a SKILL_FILES entry with no file on disk FAILS the run (the stale-entry direction)', () => {
  // Dropping a declared skill from the fixture is exactly a rename/delete in the real repo.
  const { code, out } = run(fixture(DECLARED.filter((n) => n !== DECLARED[0])));
  assert.equal(code, 1, 'a stale SKILL_FILES entry must fail the build\n' + out);
  assert.match(out, /STALE ENTRY/);
  assert.match(out, new RegExp(DECLARED[0]));
});

test('GATE ACTS: the scope check runs BEFORE linting — a stale entry names the cause, not a raw ENOENT', () => {
  // The ordering IS the feature: readFileSync on a missing declared path would otherwise throw first and
  // bury the cause in a loader stack. This is the assertion the docstring's claim rests on.
  const { out } = run(fixture(DECLARED.filter((n) => n !== DECLARED[0])));
  assert.match(out, /SKILL_FILES no longer matches/);
  assert.doesNotMatch(out, /ENOENT/);
});

test('GATE ACTS: an unreadable skills directory still reports the declared files as missing', () => {
  // scopeDrift's catch covers the readdir, which only informs `unlisted`. If it suppressed `missing` too,
  // a repo with no .claude/skills at all would report clean and fall through into readFileSync.
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-scope-none-'));
  const { code, out } = run(empty);
  assert.equal(code, 1, 'a root with no skills dir must fail, not pass vacuously\n' + out);
  assert.match(out, /STALE ENTRY/);
});

test('a directory without a SKILL.md is not a skill — it must not be reported as unlisted', () => {
  // .claude/skills/ can hold a non-skill subdirectory (shared assets, a scratch dir). Counting one would
  // fail the build on something that can never be linted.
  const root = fixture(DECLARED);
  fs.mkdirSync(path.join(root, '.claude', 'skills', 'shared'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'shared', 'notes.md'), 'x\n');
  const { code, out } = run(root);
  assert.equal(code, 0, out);
});

test('THE REAL REPO: declared scope matches disk, and the guard exits 0 on it', () => {
  assert.deepEqual(scopeDrift(ROOT, SKILL_FILES), { unlisted: [], missing: [] });
  const r = spawnSync(process.execPath, [GUARD], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
