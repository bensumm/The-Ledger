/**
 * guard-lists.test.mjs — acceptance tests for pipeline/ci/lint-guard-lists.mjs.
 *
 * Every case drives main() through the CLI against a synthetic --root, not the helpers in isolation.
 * That is deliberate: the predecessor guard's tests passed against a stubbed-out gate because they
 * only ever called the helper, so they proved the helper worked while the guard did nothing. The
 * acceptance bar here is MUTATION: each case below was confirmed to go RED against a deliberately
 * broken copy of the guard before being committed (see the mutants named in each test's comment).
 *
 * Run: `node pipeline/test/guard-lists.test.mjs`. Auto-discovered by run-tests.mjs. PURE/synthetic —
 * no network, no live data; the one real-repo case reads the tree read-only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GOVERNED_DOCS } from '../ci/lint-guard-lists.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const GUARD = join(ROOT, 'pipeline', 'ci', 'lint-guard-lists.mjs');
// IMPORTED, not restated: a hardcoded copy here is a second home for the governed set, and it went
// stale the first time a doc was added — the fixture wrote 3 docs while the guard demanded 4.
const DOCS = GOVERNED_DOCS;

const workflow = (checksScripts, smokeScripts = []) => `name: checks
jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
${checksScripts.map((s) => `      - name: ${s}\n        run: node pipeline/ci/${s}`).join('\n')}
  smoke:
    runs-on: ubuntu-latest
    steps:
${smokeScripts.map((s) => `      - name: ${s}\n        run: node pipeline/ci/${s}`).join('\n')}
`;

/** A synthetic repo root: the workflow, the three governed docs, and real files under pipeline/ci. */
function fixture({ checks = [], smoke = [], docText = null, ciFiles = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'guardlists-'));
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  mkdirSync(join(root, 'docs'), { recursive: true });
  mkdirSync(join(root, '.claude', 'skills', 'cleanup'), { recursive: true });
  mkdirSync(join(root, 'pipeline', 'ci'), { recursive: true });
  writeFileSync(join(root, '.github', 'workflows', 'checks.yml'), workflow(checks, smoke));
  for (const f of ciFiles ?? [...checks, ...smoke]) writeFileSync(join(root, 'pipeline', 'ci', f), '// stub\n');
  const body = docText ?? checks.map((s) => `- \`${s}\``).join('\n');
  for (const d of DOCS) writeFileSync(join(root, d), `# doc\n${body}\n`);
  return root;
}

const run = (root) => {
  const r = spawnSync(process.execPath, [GUARD, '--root', root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

test('baseline: docs naming every checks-job script pass', () => {
  const root = fixture({ checks: ['a-guard.mjs', 'b-guard.mjs'] });
  const { code, out } = run(root);
  assert.equal(code, 0, out);
  assert.match(out, /2 pipeline\/ci script\(s\)/);
  rmSync(root, { recursive: true, force: true });
});

test('a script missing from ONE doc fails and names the doc + script', () => {
  // MUTANT: `missing: []` — this case goes red.
  const root = fixture({ checks: ['a-guard.mjs', 'b-guard.mjs'] });
  writeFileSync(join(root, 'docs', 'FLOW.md'), '# doc\n- `a-guard.mjs`\n');
  const { code, out } = run(root);
  assert.equal(code, 1, out);
  assert.match(out, /MISSING from docs\/FLOW\.md: b-guard\.mjs/);
  assert.doesNotMatch(out, /MISSING from CLAUDE\.md/);
  rmSync(root, { recursive: true, force: true });
});

test('a doc citing a pipeline/ci path that does not exist fails as STALE', () => {
  // MUTANT: `stale: []` — this case goes red.
  const root = fixture({ checks: ['a-guard.mjs'] });
  writeFileSync(join(root, 'CLAUDE.md'), '# doc\n- `a-guard.mjs`\n- `pipeline/ci/ghost-guard.mjs`\n');
  const { code, out } = run(root);
  assert.equal(code, 1, out);
  assert.match(out, /STALE in CLAUDE\.md: pipeline\/ci\/ghost-guard\.mjs/);
  rmSync(root, { recursive: true, force: true });
});

test('ZERO discovered scripts is a hard failure, never a clean report', () => {
  // The guard-scope bug class: "0 missing" and "0 examined" are indistinguishable downstream.
  // MUTANT: drop the `if (!gating.length)` refusal — this case goes red (exits 0, prints ✓).
  const root = fixture({ checks: [] });
  const { code, out } = run(root);
  assert.equal(code, 1, out);
  assert.match(out, /no 'node pipeline\/ci\/\*\.mjs' steps found/);
  assert.doesNotMatch(out, /✓/);
  rmSync(root, { recursive: true, force: true });
});

test('job-scoped: a script that runs only in the smoke job is NOT demanded of the docs', () => {
  // MUTANT: scan the whole file instead of the `checks` job body — this case goes red.
  const root = fixture({ checks: ['a-guard.mjs'], smoke: ['smoke-test.mjs'] });
  const { code, out } = run(root);
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /smoke-test\.mjs/);
  rmSync(root, { recursive: true, force: true });
});

test('the .mjs suffix is optional — FLOW.md-style bare names satisfy the check', () => {
  // MUTANT: require the suffix (`text.includes(script)`) — this case goes red, which is the
  // false-FAILURE direction: it would fail three docs that are correct as written.
  const root = fixture({ checks: ['a-guard.mjs'], docText: '- `a-guard` runs in CI' });
  const { code, out } = run(root);
  assert.equal(code, 0, out);
  rmSync(root, { recursive: true, force: true });
});

test('an absent workflow is fatal, not a vacuous pass', () => {
  const root = mkdtempSync(join(tmpdir(), 'guardlists-'));
  const { code, out } = run(root);
  assert.equal(code, 1, out);
  assert.match(out, /workflow not found/);
  rmSync(root, { recursive: true, force: true });
});

test('the real repo passes its own guard', () => {
  const { code, out } = run(ROOT);
  assert.equal(code, 0, out);
});
