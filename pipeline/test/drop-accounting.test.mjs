/**
 * drop-accounting.test.mjs — FD7 (PLAN-FLOW-DIET): the drop-accounting families print under --full
 * only, and the structured `drops` summary rides the report into the last-report dump on every view.
 *
 * WHY THIS SHAPE. A bare absence test ("--verbose prints no `rejected:`") passes for the wrong reason
 * the moment a family is renamed — a renamed string is also an absent string. So presence and absence
 * both assert off the SAME builder: the full view pins the exact wording (a rename fails here) and the
 * diet view pins emptiness on the SAME input (a flipped/dropped gate fails here). `drops` is pinned
 * identical across views so the accounting can never become view-dependent.
 *
 * Every case was confirmed RED against a named mutant before commit (inline notes).
 *
 * Run: `node pipeline/test/drop-accounting.test.mjs`. Auto-discovered by run-tests.mjs. PURE/synthetic
 * (importing screen-flip-niches.mjs never fires main() — the direct-invocation guard is pinned there).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { dropAccounting } from '../commands/screen-flip-niches.mjs';

const INPUT = {
  reject: 4,
  rejReasons: { floor: 3, reach: 1 },
  skippedNames: ['Cake', 'Bones'],
  winnersFiltered: [{ name: 'Yew logs', net: -6 }],
  crowded: { count: 12, bestName: 'Abyssal bludgeon', bestGpDay: '412k', reason: 'rank', rotation: '(exploration reserve: ~70h rotation over 140 excluded)' },
};

test('full view prints all families with the exact pre-FD7 wording', () => {
  // MUTANTS: any family reworded/dropped from the full render — red on the exact-string pins.
  const { footer, extra } = dropAccounting(INPUT, { diet: false });
  assert.deepEqual(footer, [
    'rejected: 4 (floor×3, reach×1)',
    'skipped 2 unprofitable at the shown pair: Cake · Bones',
  ]);
  assert.deepEqual(extra, [
    'crowded out: 12 gated candidate(s) never got a fetch slot (best excluded: Abyssal bludgeon, ~412k/d expected net, reason: rank)',
    '(exploration reserve: ~70h rotation over 140 excluded)',
  ]);
});

test('diet view prints NOTHING on the same input — the FD7 gate', () => {
  // MUTANT: `if (!diet)` flipped or removed — red (the full-view case above keeps the inverse honest).
  const { footer, extra } = dropAccounting(INPUT, { diet: true });
  assert.deepEqual(footer, []);
  assert.deepEqual(extra, []);
});

test('`drops` is identical across views and carries every family — the accounting never thins with the render', () => {
  // MUTANT: computing drops inside the `!diet` branch — red (diet view would lose its accounting).
  const full = dropAccounting(INPUT, { diet: false }).drops;
  const diet = dropAccounting(INPUT, { diet: true }).drops;
  assert.deepEqual(diet, full);
  assert.deepEqual(full, {
    reject: 4,
    rejectReasons: { floor: 3, reach: 1 },
    skippedUnprofitable: ['Cake', 'Bones'],
    winnersFiltered: [{ name: 'Yew logs', net: -6 }],
    crowdedOut: { count: 12, bestName: 'Abyssal bludgeon', bestGpDay: '412k', reason: 'rank' },
  });
});

test('nothing dropped → no lines on either view and drops null (serialized as `"drops":null`, never `{}`)', () => {
  // MUTANT: `drops` defaulting to `{}` — red. An empty object in every clean niche report would make
  // "does drops exist" meaningless as the suspicious-removal check.
  for (const diet of [true, false]) {
    const r = dropAccounting({}, { diet });
    assert.deepEqual(r.footer, []);
    assert.deepEqual(r.extra, []);
    assert.equal(r.drops, null);
  }
});

test('the FD1 winners filter is dump-only — it never prints a line on ANY view', () => {
  // The pre-FD7 `Skipped: N rows non-positive net…` stdout line is deleted; its line-of-record is
  // drops.winnersFiltered (name + shown net). MUTANT: reintroducing a winners-filter stdout line — red.
  const r = dropAccounting({ winnersFiltered: [{ name: 'Yew logs', net: -6 }] }, { diet: false });
  assert.deepEqual(r.footer, []);
  assert.deepEqual(r.extra, []);
  assert.deepEqual(r.drops, { winnersFiltered: [{ name: 'Yew logs', net: -6 }] });
});

test('rejected reasons: top-3 by count, desc — the pre-FD7 truncation preserved', () => {
  // MUTANT: sort or slice(0, 3) dropped in the extraction — red.
  const { footer } = dropAccounting({ reject: 10, rejReasons: { a: 1, b: 4, c: 2, d: 3 } }, { diet: false });
  assert.deepEqual(footer, ['rejected: 10 (b×4, d×3, c×2)']);
});

test('crowded-out without a rotation note prints one line, not a blank second', () => {
  const { extra } = dropAccounting({ crowded: { count: 1, bestName: 'X', bestGpDay: '5k', reason: 'rank', rotation: null } }, { diet: false });
  assert.deepEqual(extra, ['crowded out: 1 gated candidate(s) never got a fetch slot (best excluded: X, ~5k/d expected net, reason: rank)']);
});
