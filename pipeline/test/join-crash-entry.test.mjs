#!/usr/bin/env node
/**
 * join-crash-entry.test.mjs — the scorer's own logic (pipeline/commands/join-crash-entry.mjs, CRX2).
 * Synthetic per-event results only; no archive, no fetch.
 *
 * BUSINESS REQUIREMENTS pinned here:
 *   - REFUSAL: below MIN_CLUSTERS onset days a contrast carries a point and no interval.
 *   - HOLM: step-down adjusted p-values, monotone in the sorted order, nulls passed through.
 *   - BLOCKS: only big/1–10m events in blocks P and R are scored, and only block P feeds the primary.
 *   - BLOCK R: never an interval, however many onset days it holds.
 *   - NEVER-ENTER: every rule is measured against doing nothing, never-enter is a printed row, and the
 *     headline is computed from those rows — not written in.
 *   - VERDICT: "beats" needs the paired CI, ST-time's own CI and both horizon signs; anything less is
 *     "no detectable edge".
 */
import assert from 'node:assert/strict';
import { contrast, holm, splitBlocks, report, primaryVerdict, versusNothing, pTxt, MIN_CLUSTERS, SIGN_EXIT_H, SENSITIVITIES, RULE_KEYS } from '../commands/join-crash-entry.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };
const leg = frac => ({ status: 'entered', frac });
const res = (cluster, a, b, block = 'P', cls = '1-10m') => ({ ev: { cluster, block, cls }, per: { 'ST-time': leg(a), RB1: leg(b) } });
const days = n => Array.from({ length: n }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`);

ok('refusal: fewer than MIN_CLUSTERS onset days → point only, no interval', () => {
  const at = n => days(n).map((d, i) => res(d, 0.01 + i * 0.001, 0));
  const under = contrast(at(MIN_CLUSTERS - 1), 'ST-time', 'RB1');
  assert.equal(under.refused, true);
  assert.equal(under.lo, undefined);
  assert.ok(under.point > 0);
  const atFloor = contrast(at(MIN_CLUSTERS), 'ST-time', 'RB1');
  assert.equal(atFloor.refused, false);
  assert.ok(atFloor.lo > 0 && atFloor.hi >= atFloor.lo);
  const doubled = contrast([...at(MIN_CLUSTERS - 1), ...at(MIN_CLUSTERS - 1)], 'ST-time', 'RB1');
  assert.equal(doubled.refused, true, 'two events on one onset day add rows, not clusters');
});

ok('holm: step-down adjustment, monotone, nulls kept', () => {
  assert.deepEqual(holm([0.01, 0.04, 0.03, null]).map(p => (p == null ? null : +p.toFixed(6))), [0.03, 0.06, 0.06, null]);
  assert.deepEqual(holm([0.2, 0.001]), [0.2, 0.002]);
});

ok('blocks: only big/1–10m in P or R are scored', () => {
  const evs = [
    { block: 'P', cls: 'big' }, { block: 'P', cls: '10k-1m' }, { block: 'R', cls: '1-10m' }, { block: null, cls: 'big' }, { block: 'P', cls: '1-10m' },
  ];
  const { P, R } = splitBlocks(evs);
  assert.deepEqual(P, [evs[0], evs[4]]);
  assert.deepEqual(R, [evs[2]]);
});

const scored = (rows, persist = false) => rows.map(r => ({
  ev: r.ev, primary: r.per,
  horizons: Object.fromEntries(SIGN_EXIT_H.map(h => [h, r.per])),
  sens: Object.fromEntries(SENSITIVITIES.map(s => [s.key, r.per])),
  persist: persist ? r.per : null,
}));

ok('blocks: block R never feeds the primary; block P never feeds the case series', () => {
  const P = days(10).map(d => res(d, 0, 0));
  const R = days(10).map(d => res(d, 0.5, 0, 'R'));
  const r = report(scored([...P, ...R]));
  assert.equal(r.primary.point, 0);
  assert.equal(r.blockR.primary.point, 0.5);
});

ok('block R: no interval, even with more than MIN_CLUSTERS onset days', () => {
  const R = days(MIN_CLUSTERS + 4).map((d, i) => res(d, 0.01 + i * 0.001, 0, 'R'));
  const r = report(scored(R));
  assert.equal(r.blockR.primary.refused, true);
  assert.ok(!JSON.stringify(r.blockR).includes('"lo"'));
});

ok('verdict: "beats" only when every pre-registered condition holds', () => {
  const pos = { refused: false, lo: 0.01, point: 0.02 };
  assert.equal(primaryVerdict(pos, pos, [pos, pos]), 'ST-time beats RB1');
  assert.equal(primaryVerdict(pos, pos, [pos, { ...pos, point: -0.01 }]), 'no detectable edge');
  assert.equal(primaryVerdict(pos, { ...pos, lo: -0.01 }, [pos, pos]), 'no detectable edge');
  assert.equal(primaryVerdict({ ...pos, lo: -0.001 }, pos, [pos, pos]), 'no detectable edge');
  assert.equal(primaryVerdict({ ...pos, refused: true }, pos, [pos, pos]), 'no detectable edge');
});

ok('never-enter: a printed row, and the headline is computed from the own-mean rows', () => {
  const evs = (f) => days(10).map((d, i) => ({ ev: { cluster: d, block: 'P', cls: '1-10m' }, per: Object.fromEntries(RULE_KEYS.map(k => [k, leg(f(k, i))])) }));
  const none = versusNothing(evs(() => -0.01));
  assert.equal(none.rows[0].key, 'never-enter');
  assert.equal(none.rows[0].own.point, 0);
  assert.equal(none.headline, 'No rule beats never-enter on block P');
  const one = versusNothing(evs((k, i) => (k === 'R5' ? 0.02 + i * 0.001 : -0.01)));
  assert.equal(one.headline, 'R5 beats never-enter on block P');
  assert.equal(one.rows.find(x => x.key === 'R5').beats, true);
  assert.ok(one.rows.find(x => x.key === 'R5').entered.mean > 0.02);
});

ok('p prints "<0.001" at zero resamples beyond zero', () => {
  assert.equal(pTxt(0), '<0.001');
  assert.equal(pTxt(0.0421), '0.042');
});

console.log(`join-crash-entry.test.mjs: ${pass} assertions passed`);
