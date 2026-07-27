#!/usr/bin/env node
/**
 * move-lib-cluster.test.mjs — pins the cluster-mover's pure helpers (PLAN-LIB-SUBDIRS chunk 0).
 *
 * The mover rewrites import specifiers by RESOLVING each one to an absolute path and comparing against
 * the moved set, rather than pattern-matching import "cases" — so these tests pin the two pure pieces that
 * correctness rests on: the specifier PARSER (must see `export … from` and `export * from`, not just
 * `import`, and must report exact offsets) and the specifier BUILDER (must emit POSIX './'-prefixed paths).
 *
 * The six import edge cases the plan enumerates are exercised end-to-end by specifierFrom here; the live
 * tree is verified by the script's own --dry-run. No live data (rule 4).
 * Run: node pipeline/test/move-lib-cluster.test.mjs
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { relativeSpecifiers, specifierFrom } from '../ci/move-lib-cluster.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

console.log('move-lib-cluster pure-helper acceptance:');

ok('relativeSpecifiers finds import, export-from, export-star, and bare side-effect specifiers', () => {
  const src = [
    `import { a } from './sibling.mjs';`,
    `import def from '../up.mjs';`,
    `export * from '../../js/estimators.mjs';`,
    `export { b } from './other.mjs';`,
    `import './side-effect.mjs';`,
    `import fs from 'node:fs';`,
  ].join('\n');
  const found = relativeSpecifiers(src).map(s => s.specifier);
  assert.ok(found.includes('./sibling.mjs'), 'named import');
  assert.ok(found.includes('../up.mjs'), 'default import');
  assert.ok(found.includes('../../js/estimators.mjs'), 'export * from — the barrel-shim case check-imports misses');
  assert.ok(found.includes('./other.mjs'), 'export { } from');
  assert.ok(found.includes('./side-effect.mjs'), 'bare side-effect import');
  assert.ok(!found.some(s => s.includes('node:')), 'bare/node specifiers are skipped');
});

ok('relativeSpecifiers reports offsets that index the ORIGINAL source exactly', () => {
  const src = `import { a } from './sibling.mjs';\nexport * from '../../js/x.mjs';\n`;
  for (const s of relativeSpecifiers(src)) {
    assert.equal(src.slice(s.index, s.index + s.length), s.specifier,
      `offset ${s.index} must slice back to ${s.specifier} (rewrites splice by index)`);
  }
});

ok('relativeSpecifiers ignores commented-out imports but keeps later offsets valid', () => {
  const src = `// import { x } from './commented.mjs';\nimport { y } from './real.mjs';\n`;
  const found = relativeSpecifiers(src);
  assert.ok(!found.some(s => s.specifier === './commented.mjs'), 'a line-commented import is not rewritten');
  const real = found.find(s => s.specifier === './real.mjs');
  assert.ok(real, 'the real import is still found');
  assert.equal(src.slice(real.index, real.index + real.length), './real.mjs',
    'comment blanking preserves length, so the surviving offset still lines up');
});

ok('specifierFrom builds POSIX relative specifiers for each move edge case', () => {
  const lib = path.join('/repo', 'pipeline', 'lib');
  const cluster = path.join(lib, 'render');
  // case: sibling inside the new cluster (both moved) — stays './x.mjs'
  assert.equal(specifierFrom(cluster, path.join(cluster, 'cli.mjs')), './cli.mjs');
  // case: a lib file that STAYED importing INTO the cluster
  assert.equal(specifierFrom(lib, path.join(cluster, 'cli.mjs')), './render/cli.mjs');
  // case: a MOVED file importing a lib file that stayed at lib/ root
  assert.equal(specifierFrom(cluster, path.join(lib, 'reconstruct.mjs')), '../reconstruct.mjs');
  // case: a commands/ or test/ importer
  assert.equal(specifierFrom(path.join('/repo', 'pipeline', 'commands'), path.join(cluster, 'cli.mjs')),
    '../lib/render/cli.mjs');
  // case: the external js/ depth-bump — the highest-volume edit
  assert.equal(specifierFrom(cluster, path.join('/repo', 'js', 'quotecore.js')), '../../../js/quotecore.js');
  // case: an already-moved file importing across clusters (the SECOND depth-bump)
  assert.equal(specifierFrom(path.join(lib, 'signal'), path.join(cluster, 'cli.mjs')), '../render/cli.mjs');
});

ok('specifierFrom always emits a relative specifier (never a bare/absolute-looking one)', () => {
  const dir = path.join('/repo', 'pipeline', 'lib', 'render');
  const spec = specifierFrom(dir, path.join(dir, 'emit.mjs'));
  assert.ok(spec.startsWith('./') || spec.startsWith('../'),
    'a bare specifier would be resolved by Node as a package, not a file');
});

console.log(`\nAll ${pass} move-lib-cluster helper checks passed.`);
