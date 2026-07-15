#!/usr/bin/env node
/**
 * lint-arch.test.mjs — pins archlint's pure helpers (the ARCHITECTURE.md doc-reference guard).
 *
 * extractRefs must pick FILE tokens (path or bare basename with a known extension) and skip function/
 * field names, spaced phrases, `.test.mjs` suffix fragments, and transient PLAN-*.md working docs.
 * resolveRef must accept a real path, a bare basename resolved against the source dirs, and a PROPOSED
 * future file, and reject a missing one. No live data (rule 4). Run: node pipeline/test/lint-arch.test.mjs
 */
import assert from 'node:assert/strict';
import { extractRefs, resolveRef } from '../ci/lint-arch.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

console.log('archlint pure-helper acceptance:');

ok('extractRefs picks file tokens; skips fn names, phrases, .test.mjs fragments, PLAN-*.md', () => {
  const refs = extractRefs(
    'see `js/state.js` and `pipeline/commands/screen-flip-niches.mjs`, call `computeQuote`, field `spec.confirm`, ' +
    'pinned by `foo.test.mjs` (+ `.test.mjs`), history in `PLAN-X.md`, and `a phrase.md here`.'
  );
  assert.ok(refs.has('js/state.js'), 'a path token is extracted');
  assert.ok(refs.has('pipeline/commands/screen-flip-niches.mjs'), 'a second path token is extracted');
  assert.ok(refs.has('foo.test.mjs'), 'a full test basename is extracted');
  assert.ok(!refs.has('computeQuote'), 'a function name (no extension) is skipped');
  assert.ok(!refs.has('spec.confirm'), 'a field name (no source extension) is skipped');
  assert.ok(![...refs].some(r => r.startsWith('.')), 'a bare `.test.mjs` fragment is skipped');
  assert.ok(!refs.has('PLAN-X.md'), 'a transient PLAN-*.md working doc is skipped');
  assert.ok(![...refs].some(r => r.includes(' ')), 'a spaced phrase is never a ref');
});

ok('resolveRef: real path resolves; bare basename resolves against source dirs', () => {
  assert.equal(resolveRef('js/state.js'), true, 'existing repo-relative path resolves');
  assert.equal(resolveRef('sync-fills.mjs'), true, 'bare basename resolves against pipeline/');
  assert.equal(resolveRef('quotecore.js'), true, 'bare basename resolves against js/');
});

ok('resolveRef: a PROPOSED future file is exempt; a missing file fails', () => {
  assert.equal(resolveRef('docs/FLOW.md'), true, 'PROPOSED future file passes (marked (proposed) in the doc)');
  assert.equal(resolveRef('js/does-not-exist-xyz.js'), false, 'a missing path fails');
  assert.equal(resolveRef('totally-not-a-file.mjs'), false, 'a missing bare basename fails');
});

console.log(`\nAll ${pass} archlint helper checks passed.`);
