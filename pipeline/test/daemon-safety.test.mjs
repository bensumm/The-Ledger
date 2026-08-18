/* daemon-safety.test.mjs — fail-path proofs for pipeline/ci/check-daemon-safety.mjs.
 *
 * WHY THIS EXISTS: the guard shipped with no test, and its scope was a readdir of pipeline/daemons/
 * while 3 of the 4 REGISTERED daemons are implemented in pipeline/commands/. It passed green for
 * months over a quarter of the fleet, including a `local:true` resident that statically imports the
 * git-writer module. A guard whose fail path is never exercised proves nothing when it is silent, so
 * every rule below is driven to RED against a synthetic fixture — the green run is only meaningful
 * because these reds are reproducible.
 *
 * The guard is exercised through its CLI (`--dir` + `--commands-dir`) rather than by importing its
 * internals: check-dead-exports.mjs forbids an export kept alive only by its own test, so widening the
 * module's export surface to make it testable would break a different guard.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GUARD = path.join(HERE, '..', 'ci', 'check-daemon-safety.mjs');

/** A minimal but structurally faithful fixture pair: a daemons/ dir and a commands/ dir. */
function fixture({ daemons = {}, commands = {}, names = ['alpha'] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daemon-safety-'));
  const dDir = path.join(root, 'daemons');
  const cDir = path.join(root, 'commands');
  fs.mkdirSync(dDir); fs.mkdirSync(cDir);
  const entries = names.map(n => `  { name: '${n}', kind: 'guard', local: true },`).join('\n');
  fs.writeFileSync(path.join(dDir, 'registry.mjs'),
    `export const GIT_WRITER = Object.freeze({ name: 'sync-fills-publish', local: false });\n` +
    `export const DAEMONS = [\n${entries}\n];\n`);
  for (const [name, src] of Object.entries(daemons)) fs.writeFileSync(path.join(dDir, name), src);
  for (const [name, src] of Object.entries(commands)) fs.writeFileSync(path.join(cDir, name), src);
  return { root, dDir, cDir };
}

function run({ dDir, cDir }) {
  const r = spawnSync(process.execPath, [GUARD, '--dir', dDir, '--commands-dir', cDir], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

// A well-formed git-writer: invocation-guarded, exporting only the zero-git surface.
const GOOD_WRITER = `
import { pathToFileURL } from 'node:url';
export function regenerate() { return 1; }
export { REPO_DIR };
function main() {}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
`;

test('registered implementations OUTSIDE pipeline/daemons are scanned at all', () => {
  const fx = fixture({
    names: ['watchy'],
    commands: { 'watchy.mjs': `import { execSync } from 'node:child_process';\nexecSync('git push');\n` },
  });
  const { code, out } = run(fx);
  assert.equal(code, 1, 'a commands/-implemented daemon must be in scope');
  assert.match(out, /spawn-git-writer/);
});

test('a daemon may import the zero-git bindings from sync-fills, but nothing else', () => {
  const ok = fixture({
    names: ['watchy', 'sync-fills'],
    commands: {
      'watchy.mjs': `import { regenerate, REPO_DIR } from './sync-fills.mjs';\n`,
      'sync-fills.mjs': GOOD_WRITER,
    },
  });
  assert.equal(run(ok).code, 0, 'the documented zero-git import must stay legal');

  const bad = fixture({
    names: ['watchy', 'sync-fills'],
    commands: {
      'watchy.mjs': `import { regenerate, syncMainToRemote } from './sync-fills.mjs';\n`,
      'sync-fills.mjs': GOOD_WRITER,
    },
  });
  const r = run(bad);
  assert.equal(r.code, 1, 'importing a git-touching binding must fail');
  assert.match(r.out, /syncMainToRemote/);
});

test('a namespace import of sync-fills is refused — it exposes the whole surface', () => {
  const fx = fixture({
    names: ['watchy', 'sync-fills'],
    commands: { 'watchy.mjs': `import * as sf from './sync-fills.mjs';\n`, 'sync-fills.mjs': GOOD_WRITER },
  });
  const r = run(fx);
  assert.equal(r.code, 1);
  assert.match(r.out, /sync-fills-wide-import/);
});

test('the git-writer losing its invocation guard is caught', () => {
  // Without the guard, importing sync-fills runs main() in the IMPORTER's process — and PUBLISH is read
  // from that process's argv, so `node watch-log.mjs --publish` would fetch/commit/push.
  const fx = fixture({
    names: ['sync-fills'],
    commands: { 'sync-fills.mjs': `export function regenerate() {}\nfunction main() {}\nmain();\n` },
  });
  const r = run(fx);
  assert.equal(r.code, 1);
  assert.match(r.out, /missing-invocation-guard/);
});

test('the git-writer growing a non-zero-git export is caught — the allowlist cannot rot silently', () => {
  const fx = fixture({
    names: ['sync-fills'],
    commands: { 'sync-fills.mjs': GOOD_WRITER + `\nexport function syncMainToRemote() {}\n` },
  });
  const r = run(fx);
  assert.equal(r.code, 1);
  assert.match(r.out, /git-writer-export-surface/);
  assert.match(r.out, /syncMainToRemote/);
});

test('a registered daemon with no implementation fails loudly instead of dropping out of scope', () => {
  // This is the exact shape of the original defect: coverage silently shrinking to whatever happens to
  // sit in one directory. A rename must turn the build red, not quietly narrow the guard.
  const fx = fixture({ names: ['ghost'] });
  const r = run(fx);
  assert.equal(r.code, 1);
  assert.match(r.out, /unresolved-daemon/);
  assert.match(r.out, /ghost/);
});

test("`--publish` alone is NOT a git signal — screen-flip-niches' local write must stay legal", () => {
  // The regression that widening scope exposed: dev-server.mjs spawns `screen-flip-niches.mjs --publish`,
  // which only rewrites the local screen.json. The git-writer is identified by NAME, not by the flag.
  const fx = fixture({
    names: ['devy'],
    commands: {
      'devy.mjs': `import { spawn } from 'node:child_process';\n` +
        `spawn(process.execPath, ['pipeline/commands/screen-flip-niches.mjs', '--mode', 'all', '--publish']);\n`,
    },
  });
  assert.equal(run(fx).code, 0, 'a non-sync-fills --publish must not trip the guard');

  const gitty = fixture({
    names: ['devy'],
    commands: {
      'devy.mjs': `import { spawn } from 'node:child_process';\n` +
        `spawn(process.execPath, ['pipeline/commands/sync-fills.mjs', '--publish']);\n`,
    },
  });
  const r = run(gitty);
  assert.equal(r.code, 1, 'sync-fills --publish must still be caught');
  assert.match(r.out, /sync-fills --publish/);
});
