#!/usr/bin/env node
/**
 * run-tests.mjs — the auto-discovery test runner (TD1.0).
 *
 * BUSINESS REQUIREMENTS (what an agent can rely on):
 *   - Every `*.test.mjs` under `pipeline/` (recursively) is a suite; the test suites live in
 *     `pipeline/test/` (R3), but discovery recurses so a suite anywhere under `pipeline/` still
 *     runs — adding a test file is the WHOLE job, nothing else wires it in.
 *   - Each suite runs in its OWN child process (so one suite's `process.exit`/state can't taint
 *     another); the suite's full stdout/stderr is passed through verbatim.
 *   - The run FAILS (non-zero exit) if ANY suite fails, AND if ZERO suites are discovered (a glob
 *     that silently matches nothing is itself the failure mode to guard).
 *   - Discovery is filesystem-based (fs.readdirSync recursion), never shell globbing, so the
 *     runner is identical on Windows and ubuntu CI.
 *
 * Run: `node pipeline/ci/run-tests.mjs`  (this file, run-tests.mjs, is NOT itself a *.test.mjs suite).
 */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const PIPELINE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');   // this file is in pipeline/ci; discover under pipeline/

function discover(dir) {
  const found = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '.cache' || ent.name.startsWith('.')) continue;
      found.push(...discover(full));
    } else if (ent.isFile() && ent.name.endsWith('.test.mjs')) {
      found.push(full);
    }
  }
  return found;
}

const suites = discover(PIPELINE_DIR).sort();

if (suites.length === 0) {
  console.error('✗ run-tests: discovered ZERO *.test.mjs files under pipeline/ — a silent empty glob is a failure.');
  process.exit(1);
}

console.log(`Discovered ${suites.length} test suite(s) under pipeline/:\n`);

let failures = 0;
for (const suite of suites) {
  const rel = relative(PIPELINE_DIR, suite).replace(/\\/g, '/');
  const res = spawnSync(process.execPath, [suite], { stdio: 'inherit' });
  const okRun = res.status === 0 && res.error === undefined;
  console.log(okRun ? `\n✓ ${rel}\n` : `\n✗ ${rel} (exit ${res.status})\n`);
  if (!okRun) failures++;
}

if (failures) {
  console.error(`✗ ${failures} of ${suites.length} suite(s) FAILED.`);
  process.exit(1);
}
console.log(`✓ All ${suites.length} suite(s) passed.`);
