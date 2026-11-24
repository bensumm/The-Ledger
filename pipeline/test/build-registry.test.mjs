/* build-registry.test.mjs — tag parsing, table escaping, region splicing. Fixtures only. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseTags, askTable, commandList, splice, MAX_TAG } from '../ci/build-registry.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };
const head = (...l) => ['#!/usr/bin/env node', ...l, 'code();'].join('\n');

ok('reads does, several asks and one caveat', () => {
  const t = parseTags(head('// @does Reads X', '// @ask "how\'s X?" => "<item>" [...]', '// @ask "bare" =>', '// @read inform-only'));
  assert.deepEqual(t, { does: 'Reads X', asks: [{ ask: '"how\'s X?"', args: '"<item>" [...]' }, { ask: '"bare"', args: '' }], read: 'inform-only', errors: [] });
});
ok('a flag the code reads passes', () => { assert.deepEqual(parseTags(head('// @does a', '// @ask b => --min-idle gp --dry', "A['min-idle']; argv.includes('--dry');")).errors, []); });
ok('CRLF sources parse the same', () => { assert.deepEqual(parseTags('// @does A\r\n// @ask b => c\r\n').asks, [{ ask: 'b', args: 'c' }]); });
for (const [name, src, re] of [
  ['missing @does', head('// @ask a => b'), /no @does/],
  ['two @does', head('// @does a', '// @does b'), /second @does/],
  ['an ask with no arrow', head('// @does a', '// @ask how'), /needs "phrases/],
  ['a flag the code never reads', head('// @does a', '// @ask b => --gone', '// --gone', 'A.gone2'), /--gone, which the code never reads/],
  ['a malformed tag', head('// @does a', '//@ask x => y'), /malformed/],
  ['an overlong tag', head('// @does ' + 'x'.repeat(MAX_TAG)), /over/],
  ['a tag buried below the header', head('// @does a', ...Array(14).fill('x();'), '// @ask b => c'), /below the header/],
]) ok('fails on ' + name, () => { assert.match(parseTags(src).errors.join(), re); });

const reg = [{ name: 'a.mjs', does: 'Does A', asks: [{ ask: '"x"', args: '--type buy|sell' }], read: 'careful' }, { name: 'b.mjs', does: 'Does B', asks: [], read: null }];
ok('the table escapes pipes, carries the caveat, and lists only asked commands', () => {
  assert.equal(askTable(reg).split('\n').slice(2).join('\n'), '| "x" | `a.mjs --type buy\\|sell` — careful |');
  assert.equal(commandList(reg), '- `a.mjs` — Does A\n- `b.mjs` — Does B');
});
ok('splice replaces only its region and refuses missing or repeated markers', () => {
  const doc = 'top\n<!-- registry:asks -->\nold\n<!-- /registry:asks -->\nend';
  assert.equal(splice(doc, 'asks', 'new'), 'top\n<!-- registry:asks -->\nnew\n<!-- /registry:asks -->\nend');
  assert.equal(splice('none', 'asks', 'x'), null);
  assert.equal(splice(doc + doc, 'asks', 'x'), null);
});

ok('the CLI fails when stale, writes, then passes; CRLF survives; an empty registry is refused', () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-')), cmds = path.join(t, 'pipeline', 'commands');
  fs.mkdirSync(cmds, { recursive: true });
  fs.writeFileSync(path.join(cmds, 'a.mjs'), '// @does A\n// @ask "x" =>\n');
  fs.writeFileSync(path.join(t, 'CLAUDE.md'), 'h\r\n<!-- registry:asks -->\r\n<!-- /registry:asks -->\r\n');
  fs.writeFileSync(path.join(t, 'README.md'), '<!-- registry:commands -->\n<!-- /registry:commands -->\n');
  const run = (...a) => spawnSync(process.execPath, [fileURLToPath(new URL('../ci/build-registry.mjs', import.meta.url)), '--root', t, ...a], { encoding: 'utf8' });
  assert.equal(run().status, 1); assert.match(run().stderr, /stale/);
  assert.equal(run('--write').status, 0); assert.equal(run().status, 0);
  const c = fs.readFileSync(path.join(t, 'CLAUDE.md'), 'utf8');
  assert.match(c, /\| "x" \| `a\.mjs` \|/); assert.ok(!/[^\r]\n/.test(c));
  fs.writeFileSync(path.join(cmds, 'a.mjs'), '// @does A changed\n');
  assert.match(run().stderr, /empty registry/);
  fs.rmSync(t, { recursive: true, force: true });
});

console.log(`All ${pass} checks passed.`);
