#!/usr/bin/env node
/**
 * guideanchor.test.mjs — acceptance fixtures for YP1's PURE guide re-anchor model
 * (lib/guideanchor.mjs). Pure over synthetic history rows — no live data (rule 4).
 * Run: `node pipeline/test/guideanchor.test.mjs`.
 *
 * BUSINESS REQUIREMENTS pinned here (diff a change against these):
 *   - guideUpdates counts only real re-anchors (prev present, positive, != guide); a first sighting
 *     (prev:null) is the baseline, NOT an update.
 *   - THE HONESTY GATE: below GUIDE_MIN_UPDATES observed updates, guideAnchorModel is ok:false and
 *     guideAnchorLine returns null — no timing/magnitude claim off too little history. (This is why
 *     the model ships silent today: the wild history is all prev:null baselines.)
 *   - Above the gate: modalHour is the most common local update hour, medianDeltaPct the median step.
 *   - guideAnchorLine projects the next guide off the median step only when a current guide is given.
 */
import assert from 'node:assert/strict';
import { guideUpdates, guideAnchorModel, guideAnchorLine, GUIDE_MIN_UPDATES } from '../lib/guideanchor.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

// a ts at a given LOCAL hour on distinct days (so hours cluster, days differ)
const DAY = 86400;
const atHour = (h, dayOffset = 0) => { const d = new Date(2026, 6, 6 + dayOffset, h, 0, 0); return Math.floor(d.getTime() / 1000); };

console.log('YP1 guide re-anchor acceptance:');

ok('guideUpdates ignores prev:null baselines, keeps real changes', () => {
  const hist = [
    { id: 1, ts: atHour(23, 0), guide: 100, prev: null },      // baseline — not an update
    { id: 1, ts: atHour(23, 1), guide: 98, prev: 100 },        // real re-anchor
    { id: 1, ts: atHour(23, 2), guide: 96, prev: 96 },         // no change — not an update
    { id: 2, ts: atHour(10, 0), guide: 50, prev: 52 },         // different item
  ];
  const u = guideUpdates(hist, 1);
  assert.equal(u.length, 1, 'only the prev=100→98 change counts for item 1');
  assert.ok(Math.abs(u[0].deltaPct - (-2)) < 1e-9, 'deltaPct = (98-100)/100 = -2%');
});

ok('THE GATE: below GUIDE_MIN_UPDATES → ok:false and a null line', () => {
  const few = Array.from({ length: GUIDE_MIN_UPDATES - 1 }, (_, i) => ({ ts: atHour(23, i), guide: 100 - i, prev: 101 - i }));
  const u = few.map(r => ({ ts: r.ts, deltaPct: -1 }));
  const m = guideAnchorModel(u);
  assert.equal(m.ok, false, 'gated');
  assert.equal(m.nUpdates, GUIDE_MIN_UPDATES - 1);
  assert.equal(guideAnchorLine(m, 12345), null, 'no line when gated');
});

ok('above the gate: modal update hour + median step', () => {
  // 4 updates: three at hour 23, one at hour 22; steps -2,-2,-4,-2 → median -2
  const updates = [
    { ts: atHour(23, 0), deltaPct: -2 },
    { ts: atHour(23, 1), deltaPct: -2 },
    { ts: atHour(22, 2), deltaPct: -4 },
    { ts: atHour(23, 3), deltaPct: -2 },
  ];
  const m = guideAnchorModel(updates, { minUpdates: 3 });
  assert.equal(m.ok, true);
  assert.equal(m.modalHour, 23, 'most updates land at hour 23');
  assert.equal(m.medianDeltaPct, -2);
  assert.equal(m.hourConfident, true, 'all within ±1h of 23');
  const line = guideAnchorLine(m, 1000);
  assert.ok(line.includes('~23:00'), 'line names the modal hour');
  assert.ok(line.includes('≈980'), 'projects 1000 × (1 - 2%) = 980');
});

console.log(`\nAll ${pass} acceptance checks passed.`);
