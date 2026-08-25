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
 *   - The run FAILS (non-zero exit) if ANY suite fails, if ZERO suites are discovered (a glob
 *     that silently matches nothing is itself the failure mode to guard), AND if a suite produces
 *     NO OUTPUT. Exit code alone cannot tell a suite that ran its assertions from one that ran none:
 *     `render.test.mjs` (31 assertions) emitted zero bytes and collected a green tick here for an
 *     unknown period, because a module it imports stubbed global `console.log` at import scope. The
 *     assertions did run and the suite did gate — but an empty file looks identical, and nothing in
 *     CI could separate them. Output is therefore CAPTURED and re-emitted verbatim rather than
 *     inherited, so emptiness is observable. A FLOOR, not a ceiling: it proves a suite SPOKE, never
 *     that what it asserted was meaningful.
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

/* isSilent(res) — a spawnSync result that produced no observable output on either stream.
   Whitespace-only counts as silent: a lone newline is not evidence an assertion ran.
   @test-only: exported for run-tests-silence.test.mjs. The runner is a CLI, and a permanently
   silent fixture suite cannot live under pipeline/test/ — this runner would fail it by design. */
export function isSilent(res) {
  return ((res && res.stdout) || '').trim() === '' && ((res && res.stderr) || '').trim() === '';
}

/* ENTRYPOINT GUARD. This body used to run at IMPORT scope, so importing `isSilent` from a test
   spawned all 122 suites — one of which is that test, which imports this file again. Unbounded
   recursion, and the same class of defect the silence check above exists to catch: a module doing
   work merely because it was imported. Guard is the one pipeline/commands/ already uses. */
function main() {
  const suites = discover(PIPELINE_DIR).sort();

  if (suites.length === 0) {
    console.error('✗ run-tests: discovered ZERO *.test.mjs files under pipeline/ — a silent empty glob is a failure.');
    process.exit(1);
  }

  console.log(`Discovered ${suites.length} test suite(s) under pipeline/:\n`);

  let failures = 0;
  for (const suite of suites) {
    const rel = relative(PIPELINE_DIR, suite).replace(/\\/g, '/');
    // CAPTURE, don't inherit — emptiness is only observable if we hold the bytes. Re-emitted verbatim
    // on the next two lines, so the pass-through contract above is unchanged. maxBuffer sits well clear
    // of the measured worst case (largest suite ~13 KB, whole run ~172 KB).
    const res = spawnSync(process.execPath, [suite], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    const spoke = !isSilent(res);
    const okRun = res.status === 0 && res.error === undefined && spoke;
    console.log(okRun ? `\n✓ ${rel}\n`
      : (!spoke && res.status === 0) ? `\n✗ ${rel} — SILENT: exited 0 but produced no output, so nothing here shows an assertion ran\n`
      : `\n✗ ${rel} (exit ${res.status})\n`);
    if (!okRun) failures++;
  }

  if (failures) {
    console.error(`✗ ${failures} of ${suites.length} suite(s) FAILED.`);
    process.exit(1);
  }
  console.log(`✓ All ${suites.length} suite(s) passed.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
