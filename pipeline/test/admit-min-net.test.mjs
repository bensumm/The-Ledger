/**
 * admit-min-net.test.mjs — the per-niche displayed-net admission floor (`spec.admitMinNet`).
 *
 * WHY THIS EXISTS. The screen already dropped a row whose `er.net` — the RAW thesis pair the rank is
 * built on — was non-positive. It never checked the pair it actually PRINTS. Those disagree whenever
 * the sell model moves the exit, so a churn row ranked on +41/u rendered a sell netting -6/u and still
 * graded S+, in the table `/scan` pastes. This pins the second check.
 *
 * Every case below was confirmed RED against a reverted predicate before being committed; the mutant
 * each one kills is named inline. A test that passes both ways is not a regression test.
 *
 * Run: `node pipeline/test/admit-min-net.test.mjs`. Auto-discovered by run-tests.mjs. PURE/synthetic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { FLIP_NICHES, belowAdmitNet } from '../../js/flip-niches.mjs';

test('a negative displayed net is dropped on every lane that REACHES the gate', () => {
  // MUTANT: `return false` — red.
  for (const key of ['band', 'churn', 'scalp']) {
    assert.equal(belowAdmitNet(FLIP_NICHES[key], -6), true, `${key} must drop a -6/u shown net`);
  }
});

test('a ZERO displayed net is dropped — work for nothing is not a candidate', () => {
  // MUTANT: `estNet < floor` instead of `<=` — red. Pins the boundary choice deliberately.
  assert.equal(belowAdmitNet(FLIP_NICHES.band, 0), true);
});

test('a positive displayed net is kept, including a single gp', () => {
  // MUTANT: `estNet <= floor + 1` — red. Guards against the floor creeping into a margin gate,
  // which would silently gut churn (the deliberate sub-MIN_ROI volume lane).
  assert.equal(belowAdmitNet(FLIP_NICHES.band, 1), false);
  assert.equal(belowAdmitNet(FLIP_NICHES.churn, 30), false);
});

test('value, amplitude and reverse opt OUT — they render on their own branches', () => {
  // MUTANT: default the floor to 0 when null — red. renderValueMode / renderAmplitudeMode / the reverse
  // early-return each bypass renderMode, so a floor here would be dormant metadata claiming a protection
  // that never runs — the failure this case exists to prevent, which `value` shipped with for one pass.
  assert.equal(FLIP_NICHES.value.admitMinNet, null);
  assert.equal(FLIP_NICHES.amplitude.admitMinNet, null);
  assert.equal(FLIP_NICHES.reverse.admitMinNet, null);
  assert.equal(belowAdmitNet(FLIP_NICHES.value, -6), false);
  assert.equal(belowAdmitNet(FLIP_NICHES.amplitude, -6), false);
  assert.equal(belowAdmitNet(FLIP_NICHES.reverse, -6), false);
});

test('an ABSENT net never drops a row — refuse to act on information we do not have', () => {
  // MUTANT: treat null as 0 — red. `estimatePair` returns null on a missing leg; reading that as
  // "net 0" would silently delete every row whose estimate could not be computed.
  assert.equal(belowAdmitNet(FLIP_NICHES.band, null), false);
  assert.equal(belowAdmitNet(FLIP_NICHES.band, undefined), false);
});

test('a missing/garbage spec never drops a row', () => {
  assert.equal(belowAdmitNet(null, -6), false);
  assert.equal(belowAdmitNet({}, -6), false);
});

test('every niche declares admitMinNet explicitly — no lane silently un-governed', () => {
  // The registry is the contract: a new niche added without deciding this is the omission that
  // would reintroduce the bug on a fresh lane.
  for (const [key, spec] of Object.entries(FLIP_NICHES)) {
    assert.ok('admitMinNet' in spec, `${key} must declare admitMinNet (0 to gate, null to opt out)`);
    assert.ok(spec.admitMinNet === null || typeof spec.admitMinNet === 'number',
      `${key}.admitMinNet must be a number or null`);
  }
});
