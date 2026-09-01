#!/usr/bin/env node
/**
 * retired-flag.test.mjs — the retired `--pressure-exit` flag must ERROR LOUDLY, never run
 * silent-neutral (pressure exit retirement — join-exit-ev.mjs's criterion, CHANGELOG 0.76.0).
 *
 * Spawns the three real entrypoints: the guards fire at arg-parse, before any fetch, so a wrong
 * (silent-neutral) outcome would hang on network — the timeout converts that into a failure too.
 * The `=`-value spellings are pinned separately because the first-shipped guards matched only the
 * bare token and `--pressure-exit=1` ran silent-neutral on all three CLIs (review find).
 * Deleting any guard, or narrowing it back to the exact token, reddens this suite.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

console.log('retired --pressure-exit flag — loud-error contract\n');

const MSG = /--pressure-exit was RETIRED/;
const CLIS = ['quote-items.mjs', 'watch-positions.mjs', 'screen-flip-niches.mjs'];
const SPELLINGS = ['--pressure-exit', '--pressure-exit=1', '--pressure-exit=true'];

function run(cli, flagArgs) {
  return spawnSync(process.execPath, [join(ROOT, 'pipeline', 'commands', cli), ...flagArgs],
    { cwd: ROOT, encoding: 'utf8', timeout: 30_000 });
}

for (const cli of CLIS) {
  ok(`${cli}: bare + =value spellings all exit 1 with the retirement message`, () => {
    for (const flag of SPELLINGS) {
      const r = run(cli, [flag]);
      assert.equal(r.status, 1, `${cli} ${flag}: expected exit 1, got ${r.status} (stderr: ${(r.stderr || '').slice(0, 120)})`);
      assert.match(r.stderr || '', MSG, `${cli} ${flag}: stderr must name the retirement`);
    }
  });
}

// screen's parseArgs also binds the SPACE form (`--pressure-exit 1` → value '1'); quote/watch treat
// the value as a positional but still see the bare token, so only screen has this extra shape.
ok('screen-flip-niches.mjs: the space-value form also exits 1 loudly', () => {
  const r = run('screen-flip-niches.mjs', ['--pressure-exit', '1']);
  assert.equal(r.status, 1, `expected exit 1, got ${r.status}`);
  assert.match(r.stderr || '', MSG);
});

console.log(`\nAll ${pass} retired-flag check(s) passed.`);
