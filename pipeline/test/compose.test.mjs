#!/usr/bin/env node
/**
 * compose.test.mjs — the PC1 composition resolver (pipeline/lib/compose.mjs).
 *
 * Pins the whole PC1 contract:
 *   - PRECEDENCE: CLI flag > pipeline-config.json > hardcoded fallback.
 *   - the ACTIVE-PLUS-SHADOW return shape { active, shadow: [] } (shadow always [] for PC1).
 *   - BYTE-IDENTITY: with no config value present, resolve() returns exactly `flag ?? fallback`,
 *     i.e. the same value the pre-PC1 inline ternaries produced — for every flag the three CLIs route
 *     (mode / volSource / pressureExit / asym / phaseRescue).
 *   - the shared refusePublishIfNonNeutral() guard: explicit-publish under a non-neutral estimator is a
 *     hard error; default-on publish is quietly downgraded; a neutral run is untouched; order-of-checks.
 *
 * No fs / no fetch beyond the resolver's own lazy config read, which is exercised via a temp file +
 * resetPipelineConfigCache(). Run: `node pipeline/test/compose.test.mjs` (exits non-zero on any failure).
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { resolve, refusePublishIfNonNeutral, shadowModelsOf } from '../lib/compose.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

console.log('compose.mjs — PC1 resolver + publish guard\n');

/* --- resolve(): precedence + shape --------------------------------------------------------------- */
ok('flag wins over config and fallback', () => {
  assert.deepEqual(resolve('mode', { flag: 'churn', config: 'value', fallback: 'band' }), { active: 'churn', shadow: [] });
});
ok('config wins over fallback when no flag', () => {
  assert.deepEqual(resolve('mode', { flag: undefined, config: 'value', fallback: 'band' }), { active: 'value', shadow: [] });
});
ok('fallback stands when neither flag nor config provided', () => {
  assert.deepEqual(resolve('mode', { flag: undefined, config: undefined, fallback: 'band' }), { active: 'band', shadow: [] });
});
ok('null is "not provided" (falls through), false is a real value', () => {
  assert.equal(resolve('x', { flag: null, config: null, fallback: 'fb' }).active, 'fb');
  // an explicit boolean false from a flag is a provided value and MUST win over config/fallback true
  assert.equal(resolve('x', { flag: false, config: true, fallback: true }).active, false);
});
ok('shadow is empty when no shadowPool is passed (byte-identical to PC1)', () => {
  assert.deepEqual(resolve('anything', { flag: 'a', config: 'b', fallback: 'c' }).shadow, []);
});

/* --- PC3: shadowPool → shadow = pool minus active; shadowModelsOf(registry) ---------------------- */
ok('PC3 shadowPool: shadow is the pool minus the active selection (a variant never shadows itself)', () => {
  // active reach-fold (default) ⇒ nothing shadows it (it IS the display number).
  assert.deepEqual(resolve('sellModel', { flag: undefined, config: undefined, fallback: 'reach-fold', shadowPool: ['reach-fold'] }),
    { active: 'reach-fold', shadow: [] });
  // active pressure ⇒ the neutral reach-fold moves to shadow (still logged as the unbiased retro co-log).
  assert.deepEqual(resolve('sellModel', { flag: 'pressure', config: undefined, fallback: 'reach-fold', shadowPool: ['reach-fold'] }),
    { active: 'pressure', shadow: ['reach-fold'] });
  // a multi-member pool drops only the active member; order preserved.
  assert.deepEqual(resolve('sellModel', { flag: 'pressure', fallback: 'reach-fold', shadowPool: ['reach-fold', 'safe-quantile'] }).shadow,
    ['reach-fold', 'safe-quantile']);
  assert.deepEqual(resolve('sellModel', { flag: 'safe-quantile', fallback: 'reach-fold', shadowPool: ['reach-fold', 'safe-quantile'] }).shadow,
    ['reach-fold']);
});
ok('PC3 shadowModelsOf: only defaultShadow:true models are pooled', () => {
  const registry = {
    'reach-fold': { name: 'reach-fold', defaultShadow: true },
    'pressure': { name: 'pressure', defaultShadow: false },
    'safe-quantile': { name: 'safe-quantile', defaultShadow: true },
  };
  assert.deepEqual(shadowModelsOf(registry).sort(), ['reach-fold', 'safe-quantile']);
  assert.deepEqual(shadowModelsOf({}), []);
  assert.deepEqual(shadowModelsOf(null), []);
});

/* --- BYTE-IDENTITY: absent config ⇒ resolve() == the pre-PC1 inline ternary --------------------- */
ok('no-config resolve reproduces the old ternaries exactly', () => {
  // mode: A.mode absent → 'band'; present → lowercased value
  assert.equal(resolve('mode', { flag: undefined, config: undefined, fallback: 'band' }).active, 'band');
  assert.equal(resolve('mode', { flag: 'churn', config: undefined, fallback: 'band' }).active, 'churn');
  // volSource: absent → 'rolling'; 'legacy' → 'legacy'
  assert.equal(resolve('volSource', { flag: undefined, config: undefined, fallback: 'rolling' }).active, 'rolling');
  assert.equal(resolve('volSource', { flag: 'legacy', config: undefined, fallback: 'rolling' }).active, 'legacy');
  // boolean flags: absent → false; present → true
  for (const cat of ['pressureExit', 'asym', 'phaseRescue']) {
    assert.equal(resolve(cat, { flag: undefined, config: undefined, fallback: false }).active, false);
    assert.equal(resolve(cat, { flag: true, config: undefined, fallback: false }).active, true);
  }
});

/* --- refusePublishIfNonNeutral() ----------------------------------------------------------------- */
ok('neutral run: publish stays whatever it was', () => {
  assert.equal(refusePublishIfNonNeutral({ publish: true, publishExplicit: true, checks: [{ on: false, message: 'x' }] }), true);
  assert.equal(refusePublishIfNonNeutral({ publish: false, publishExplicit: false, checks: [{ on: false, message: 'x' }] }), false);
});
ok('default-on publish is quietly downgraded under a non-neutral estimator', () => {
  assert.equal(refusePublishIfNonNeutral({ publish: true, publishExplicit: false, checks: [{ on: true, message: 'should not print' }] }), false);
});
ok('publish already off: a non-neutral check is a no-op (no exit)', () => {
  assert.equal(refusePublishIfNonNeutral({ publish: false, publishExplicit: true, checks: [{ on: true, message: 'x' }] }), false);
});

/* The explicit-publish HARD ERROR (console.error + process.exit(1)) can't be asserted in-process
   without killing the runner, so drive it as a child process and assert exit code + first message. */
const HERE = dirname(fileURLToPath(import.meta.url));
const COMPOSE_URL = pathToFileURL(join(HERE, '..', 'lib', 'compose.mjs')).href;
function runGuard(publish, publishExplicit, checks) {
  const src = `import { refusePublishIfNonNeutral } from ${JSON.stringify(COMPOSE_URL)};` +
    `refusePublishIfNonNeutral(${JSON.stringify({ publish, publishExplicit, checks })});`;
  try {
    execFileSync(process.execPath, ['--input-type=module', '-e', src], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stderr: '' };
  } catch (e) { return { code: e.status, stderr: (e.stderr || '').toString() }; }
}
ok('explicit --publish under a non-neutral estimator exits 1 with the loud message', () => {
  const r = runGuard(true, true, [{ on: true, message: '! nope' }]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /! nope/);
});
ok('order: the FIRST on-check that conflicts prints first (asym before pressure)', () => {
  const r = runGuard(true, true, [
    { on: true, message: '! asym-first' },
    { on: true, message: '! pressure-second' },
  ]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /! asym-first/);
  assert.doesNotMatch(r.stderr, /pressure-second/);   // exits on the first before reaching the second
});

/* --- loadPipelineConfig(): absent-by-default + the precedence chain end-to-end through a temp file - */
ok('absent config reads as {} (byte-identical defaults) and a real file drives config precedence', () => {
  // fresh child so the config-cache state can't leak between cases; assert both branches in one child.
  const cfgPath = join(HERE, '..', 'pipeline-config.json');
  const script = `
    import { loadPipelineConfig, resetPipelineConfigCache, resolve } from ${JSON.stringify(COMPOSE_URL)};
    import { writeFileSync, rmSync } from 'node:fs';
    import assert from 'node:assert/strict';
    const p = ${JSON.stringify(cfgPath.replace(/\\/g, '/'))};
    try { rmSync(p); } catch {}
    try {
      // 1) absent → {} → fallback stands
      resetPipelineConfigCache();
      assert.deepEqual(loadPipelineConfig(), {});
      assert.equal(resolve('mode', { flag: undefined, config: loadPipelineConfig().mode, fallback: 'band' }).active, 'band');
      // 2) config present → config wins over fallback, flag still wins over config
      writeFileSync(p, JSON.stringify({ mode: 'value', volSource: 'legacy', pressureExit: true }));
      resetPipelineConfigCache();
      const cfg = loadPipelineConfig();
      assert.equal(resolve('mode', { flag: undefined, config: cfg.mode, fallback: 'band' }).active, 'value');
      assert.equal(resolve('mode', { flag: 'churn', config: cfg.mode, fallback: 'band' }).active, 'churn');
      assert.equal(resolve('volSource', { flag: undefined, config: cfg.volSource, fallback: 'rolling' }).active, 'legacy');
      assert.equal(resolve('pressureExit', { flag: undefined, config: cfg.pressureExit, fallback: false }).active, true);
      // 3) malformed → {} (never throws)
      writeFileSync(p, '{ not json');
      resetPipelineConfigCache();
      assert.deepEqual(loadPipelineConfig(), {});
      console.log('child-ok');
    } finally { try { rmSync(p); } catch {} }   // never leave a config file behind, even on assert failure
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.match(out, /child-ok/);
});

console.log(`\nAll ${pass} checks passed.`);
