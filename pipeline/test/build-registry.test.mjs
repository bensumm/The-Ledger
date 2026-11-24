/* build-registry.test.mjs — tag parsing, table escaping, region splicing. Fixtures only. */
import assert from 'node:assert/strict';
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

console.log(`All ${pass} checks passed.`);
