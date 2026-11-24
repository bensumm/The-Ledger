#!/usr/bin/env node
/* plan.test.mjs — planLines(): one action-ordered line per held lot (LN5). Run: node pipeline/test/plan.test.mjs */
import assert from 'node:assert/strict';
import { planLines } from '../lib/render/plan.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };
const lot = (o) => ({ name: 'Item', qty: 1, verdictText: 'HOLD — list @ 100', listAt: 100, be: 90, cur: 'HOLD', ...o });

ok('empty book is one line', () => assert.deepEqual(planLines([]), ['no held lots']));

ok('order: CUT, LIST, WATCH, HOLD; one line each, never joined', () => {
  const out = planLines([
    lot({ name: 'H1' }),
    lot({ name: 'W1', verdictText: 'WATCH — fresh entry @ 100 (x)' }),
    lot({ name: 'L1', verdictText: 'LIST-TO-CLEAR @ 95 (2h breakdown)' }),
    lot({ name: 'C1', verdictText: 'CUT-CANDIDATE @ 80 (underwater)' }),
    lot({ name: 'H2' }),
  ]);
  assert.equal(out.length, 5);
  assert.deepEqual(out.map(l => l.split(' ')[0]), ['CUT-CANDIDATE', 'LIST-TO-CLEAR', 'WATCH', 'HOLD', 'HOLD']);
  assert.ok(out[3].includes('H1') && out[4].includes('H2'));
  assert.ok(out.every(l => !l.includes('\n') && l.includes('list @') && l.includes('(BE ')));
});

ok('line shape and gp formatting', () => {
  const [l] = planLines([lot({ name: 'Abyssal whip', qty: 3, listAt: 1500000, be: 1200000,
    verdictText: 'LIST-TO-CLEAR @ 1,500,000 (2h breakdown — bank it)', cur: 'LIST-TO-CLEAR', prev: 'HOLD' })]);
  assert.equal(l, 'LIST-TO-CLEAR Abyssal whip ×3 · list @ 1.50m (BE 1.20m) · 2h breakdown — bank it · was HOLD');
});

ok('thesis-overridden CUT reads HOLD (overrode cut), with the tripwire as reason', () => {
  const [l] = planLines([lot({ verdictText: 'PLAN A · exit 1 · abort < 80', frame: true, raw: 'CUT-CANDIDATE', tripwire: 80 })]);
  assert.match(l, /^HOLD \(overrode cut\) Item/);
  assert.ok(l.includes('abort < 80'));
});

ok('a frame over a non-cut raw read is plain HOLD', () => {
  const [l] = planLines([lot({ verdictText: 'PLAN A', frame: true, raw: 'HOLD' })]);
  assert.match(l, /^HOLD Item/);
});

ok("'was' only when prev exists and differs", () => {
  assert.ok(!planLines([lot({ prev: 'HOLD' })])[0].includes('was'));
  assert.ok(!planLines([lot({})])[0].includes('was'));
  assert.ok(planLines([lot({ prev: 'WATCH' })])[0].endsWith('was WATCH'));
});

ok('a bare verdict still carries a list price', () => {
  assert.equal(planLines([lot({ verdictText: 'HOLD' })])[0], 'HOLD Item ×1 · list @ 100 (BE 90)');
});
console.log(`plan.test.mjs: ${pass} passed`);
