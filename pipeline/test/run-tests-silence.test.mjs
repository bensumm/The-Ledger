#!/usr/bin/env node
/**
 * run-tests-silence.test.mjs — the runner must not pass a suite that produced NO OUTPUT.
 *
 * WHY THIS EXISTS. `run-tests.mjs` graded suites on exit code alone, with `stdio: 'inherit'`, so it
 * never held the bytes and could not see emptiness. `render.test.mjs` (31 assertions) emitted zero
 * bytes and collected a `✓` for an unknown period, because `quote-items.mjs` stubbed global
 * `console.log` at import scope and the suite imported it. The assertions ran and the suite did gate
 * via exit code — but an empty file is indistinguishable from that, which is the whole defect.
 *
 * WHY A SOURCE-LEVEL PREDICATE TEST rather than a silent fixture suite: a permanently-silent suite
 * under `pipeline/test/` would be failed by the very runner it is meant to exercise. So the runner
 * exports `isSilent` and this pins it, plus an END-TO-END check that spawns a real silent child.
 *
 * Run: `node pipeline/test/run-tests-silence.test.mjs`. Auto-discovered by run-tests.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { isSilent } from '../ci/run-tests.mjs';

test('a result with nothing on either stream is SILENT', () => {
  // MUTANT: `return false` in isSilent — red. This is the shape render.test.mjs had.
  assert.equal(isSilent({ stdout: '', stderr: '' }), true);
  assert.equal(isSilent({ stdout: null, stderr: undefined }), true);
  assert.equal(isSilent({}), true);
});

test('whitespace alone is SILENT — a bare newline is not evidence an assertion ran', () => {
  // MUTANT: drop the .trim() — red. A suite whose only output is `console.log()` would otherwise
  // read as having spoken, which is exactly the false negative this guard exists to refuse.
  assert.equal(isSilent({ stdout: '\n', stderr: '' }), true);
  assert.equal(isSilent({ stdout: '   \n\t ', stderr: '\n' }), true);
});

test('any real output on EITHER stream counts as spoken', () => {
  // MUTANT: check only stdout — red. A suite reporting solely on stderr is loud, not silent.
  assert.equal(isSilent({ stdout: 'All 3 checks passed.', stderr: '' }), false);
  assert.equal(isSilent({ stdout: '', stderr: 'AssertionError' }), false);
});

test('END-TO-END: a real child that exits 0 and prints nothing is classified SILENT', () => {
  // The predicate above is pure; this pins that a genuine spawnSync result flows through it the way
  // the runner's loop uses it — captured (not inherited), so the bytes exist to be judged.
  const quiet = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { encoding: 'utf8' });
  assert.equal(quiet.status, 0, 'fixture premise: the child exits clean');
  assert.equal(isSilent(quiet), true, 'exit 0 with no output must not read as a pass');

  const loud = spawnSync(process.execPath, ['-e', 'console.log("All 1 checks passed.")'], { encoding: 'utf8' });
  assert.equal(loud.status, 0);
  assert.equal(isSilent(loud), false, 'a child that spoke must not be flagged');
});

test('the runner CAPTURES output rather than inheriting it — the property that makes silence visible', () => {
  // MUTANT: restore `stdio: 'inherit'` — red. Source-scanned because the runner is a CLI that
  // spawns 122 children; invoking it from here to assert this would be circular and slow.
  const src = fs.readFileSync(new URL('../ci/run-tests.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /stdio:\s*'inherit'/, 'inherited stdio leaves no bytes to judge');
  assert.match(src, /encoding:\s*'utf8'/, 'the spawn must capture');
  assert.match(src, /process\.stdout\.write\(res\.stdout\)/, 'and re-emit verbatim — the pass-through contract');
});
