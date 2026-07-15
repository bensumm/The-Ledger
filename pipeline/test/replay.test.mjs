#!/usr/bin/env node
/**
 * replay.test.mjs — the snapshot-replay ACCEPTANCE HARNESS (Pipeline v2, chunk P1).
 *
 * Feeds a committed synthetic market SNAPSHOT (pipeline/test/fixtures/replay/snapshot.json, a documented
 * superset of D0's coffer-archive-fixture — see lib/replay.mjs header) through the FULL per-niche P1
 * funnel — gateCandidates → rankAndSlice → computeQuote/phase → surviveMode — for band + churn (active),
 * band (overnight posture), and scalp, and compares the stage-by-stage result to the committed
 * golden (pipeline/test/fixtures/replay/golden.json). Pure + offline: NO live API, NO real SQLite (the
 * :memory: precedent from archive.test.mjs) — the funnel runs entirely off the fixture.
 *
 * TZ pinned to UTC so phase()'s local-day low-slope bucketing is deterministic across dev/CI (phase is
 * display-only here — phaseRescue is off in the goldens — but pinning it keeps regeneration stable).
 *
 * Two guards, so a behavior change can't slip through silently:
 *   1. DRIFT GUARD — buildSnapshot() must still reproduce the committed snapshot.json byte-for-value
 *      (the fixture is generator output; a generator edit that changes it must be intentional + reviewed).
 *   2. GOLDEN GUARD — runReplay() over each scenario must equal the committed golden.json.
 * Regenerate BOTH after an intentional funnel/doctrine change: `node pipeline/test/replay.test.mjs --update`
 * (then hand-review the diff — that diff IS the behavior change, same discipline as survivemode.test.mjs).
 *
 * PIN (re-pinned at P5): the goldens encode the CURRENT pre-amendment falling-exclusion (falling ⇒
 * dropped in every niche). Ben's 2026-07-08 amendment lands at P5; these goldens change there.
 * Run: `node pipeline/test/replay.test.mjs`  (exits non-zero on any mismatch). No live data (CLAUDE.md rule 4).
 */
process.env.TZ = 'UTC';   // MUST precede any Date use (phase() local-day bucketing) — set before imports run below

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSnapshot, runReplay, ARCHETYPES } from '../lib/replay.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX_DIR = path.join(HERE, 'fixtures', 'replay');
const SNAP_PATH = path.join(FX_DIR, 'snapshot.json');
const GOLD_PATH = path.join(FX_DIR, 'golden.json');

// Scenario definitions — the runReplay opts each golden entry was produced with (kept in sync with the
// committed golden's `opts`). Adding a scenario = add it here + `--update`.
const SCENARIOS = {
  'active': { posture: 'active' },
  'overnight-band': { modes: ['band'], posture: 'overnight' },
  // P5 + Step 5 — the falling-doctrine amendment made concrete: the `scalp` niche's spec.falling ===
  // 'accept' stops surviveMode from dropping the decay-knife (2004) / falling-wide-band (2005) fallers it
  // drops in every 'exclude' niche, AND scalp's mode-confirm (Step 5, Ben 2026-07-09) now REQUIRES falling
  // — so the flat/rising rows (2001/2002/2003) are dropped 'notFalling' and ONLY the two fallers survive.
  // This scenario is the golden-visible doctrine change (the existing four-niche scenarios stay identical).
  'scalp': { modes: ['scalp'], posture: 'active' },
};

function computeGolden(snap) {
  const scenarios = {};
  for (const [name, opts] of Object.entries(SCENARIOS)) scenarios[name] = { opts, niches: runReplay(snap, opts) };
  return {
    schema: 'coffer-replay-golden/1',
    note: 'Golden per-niche funnel outputs for the P1 snapshot-replay harness. Regenerate + hand-review with `node pipeline/test/replay.test.mjs --update`. Steps 3+4: the spread + rising specs are DELETED (default niches band + churn). Falling-exclusion is PER-SPEC — band/churn keep it (exclude); the scalp scenario ACCEPTS fallers (spec.falling=accept) AND REQUIRES falling (scalp mode-confirm), so ONLY the fallers 2004/2005 survive scalp (the flat/rising 2001/2002/2003 drop notFalling).',
    scenarios,
  };
}

// --- --update: regenerate the committed fixtures (then a human reviews the diff) --------------------
if (process.argv.includes('--update')) {
  const snap = buildSnapshot();
  fs.mkdirSync(FX_DIR, { recursive: true });
  fs.writeFileSync(SNAP_PATH, JSON.stringify(snap, null, 2) + '\n');
  fs.writeFileSync(GOLD_PATH, JSON.stringify(computeGolden(snap), null, 2) + '\n');
  console.log('✓ regenerated snapshot.json + golden.json — HAND-REVIEW the diff before committing.');
  process.exit(0);
}

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };
// value-compare through JSON so we ignore key order / object prototype quirks (null-proto rows etc.)
const norm = o => JSON.parse(JSON.stringify(o));

console.log('replay.test.mjs — snapshot-replay acceptance:\n');

const committedSnap = JSON.parse(fs.readFileSync(SNAP_PATH, 'utf8'));
const committedGold = JSON.parse(fs.readFileSync(GOLD_PATH, 'utf8'));

/* --- guard 1: the generator still reproduces the committed fixture --------------------------------- */
ok('DRIFT GUARD — buildSnapshot() reproduces the committed snapshot.json', () => {
  assert.deepEqual(norm(buildSnapshot()), committedSnap,
    'buildSnapshot() drifted from snapshot.json — if intentional, run `node pipeline/test/replay.test.mjs --update` and review the diff.');
});

ok('snapshot is the documented superset schema with all five archetypes', () => {
  assert.equal(committedSnap.schema, 'coffer-replay-snapshot/1');
  assert.deepEqual(Object.keys(committedSnap.items).map(Number).sort((a, b) => a - b),
    ARCHETYPES.map(a => a.id).sort((a, b) => a - b));
});

/* --- guard 2: the funnel matches the golden, scenario by scenario --------------------------------- */
ok('GOLDEN GUARD — runReplay() matches golden.json for every scenario', () => {
  assert.deepEqual(norm(computeGolden(committedSnap)), committedGold,
    'the P1 funnel output diverged from golden.json — if this is an intended doctrine/funnel change, `--update` and review.');
});

/* --- readable per-archetype assertions (documentation value; each names the path it exercises).
   Steps 3+4: the niche set is band + churn (spread/rising deleted); scalp is its own scenario. --------- */
const active = committedGold.scenarios['active'].niches;
const overnight = committedGold.scenarios['overnight-band'].niches;
const scalp = committedGold.scenarios['scalp'].niches;

ok('stable band (2001): surfaced in band + churn; dropped notFalling in scalp (not falling)', () => {
  assert.ok(active.band.kept.includes(2001) && active.churn.kept.includes(2001));
  assert.equal(scalp.scalp.dropped['2001'], 'notFalling');
});

ok('genuine dip (2002): a confirmed riser survives band + churn; dropped notFalling in scalp', () => {
  for (const m of ['band', 'churn']) assert.ok(active[m].kept.includes(2002), `2002 kept in ${m}`);
  assert.equal(scalp.scalp.dropped['2002'], 'notFalling');
});

ok('thin big ticket (2003): gp-flow-admitted (thin), kept in band, dropped POSTURE overnight, absent from churn', () => {
  assert.ok(active.band.gated.find(g => g.id === 2003).thin, '2003 flagged thin (gp-flow admission)');
  assert.ok(active.band.kept.includes(2003));
  assert.equal(overnight.band.dropped['2003'], 'posture', 'overnight has no thin fast-lane');
  assert.ok(!active.churn.gated.some(g => g.id === 2003), '2003 never reaches the churn gate (limitVol<CHURN_MIN_VOL)');
});

ok('decay-knife (2004): dropped FALLING in band/churn but KEPT in scalp (falling is the thesis)', () => {
  for (const m of ['band', 'churn']) {
    assert.ok(active[m].gated.some(g => g.id === 2004), `2004 gated in ${m} (it clears liquidity+edge)`);
    assert.equal(active[m].dropped['2004'], 'falling', `2004 dropped falling in ${m}`);
  }
  assert.ok(scalp.scalp.kept.includes(2004), '2004 kept in scalp (spec.falling=accept + it IS falling)');
});

ok('falling wide-band (2005): a fat band edge does NOT rescue a faller in band/churn; KEPT in scalp', () => {
  for (const m of ['band', 'churn']) assert.equal(active[m].dropped['2005'], 'falling', `2005 dropped falling in ${m}`);
  assert.ok(scalp.scalp.kept.includes(2005), '2005 kept in scalp');
});

ok('scalp (Step 5): STRICT falling-only — exactly the two fallers survive, the flat/rising rows drop notFalling', () => {
  assert.deepEqual(scalp.scalp.kept, [2004, 2005]);
  for (const id of [2001, 2002, 2003]) assert.equal(scalp.scalp.dropped[id], 'notFalling', `${id} dropped notFalling`);
});

ok('overnight posture keeps only the confident flat/rising non-thin rows (2001, 2002)', () => {
  assert.deepEqual(overnight.band.kept, [2001, 2002]);
});

console.log(`\nAll ${pass} acceptance checks passed.`);
