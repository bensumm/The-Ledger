/* campaigns.test.mjs — pins groupCampaigns' multi-chain grouping: the two defects the single-chain
 * map had (parallel listings stitched into false reprices; genuine parallel ladders interleaved)
 * and the successions it must keep (plain reprice, place-then-cancel overlap, complete-terminates).
 * The load-bearing cases name the mutant that turns them red. */
import assert from 'node:assert/strict';
import { groupCampaigns, REPRICE_GAP, REPLACE_OVERLAP_TOL } from '../lib/reconstruct/campaigns.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

const T0 = 1_700_000_000;
let seq = 0;
const offer = (tsOpen, tsClose, { item = 1, type = 'sell', state = 'cancelled', slot = 0, price = 100, qty = 1, filled = 0 } = {}) =>
  ({ itemId: item, type, tsOpen: T0 + tsOpen, tsClose: tsClose == null ? null : T0 + tsClose, state, slot, price, qty, filled, id: seq++ });

ok('a plain cancel-replace succession within REPRICE_GAP is ONE campaign', () => {
  const camps = groupCampaigns([offer(0, 100), offer(150, 400, { state: 'complete' })]);
  assert.equal(camps.length, 1);
  assert.equal(camps[0].offers.length, 2);
});

ok('a gap beyond REPRICE_GAP splits into two campaigns', () => {
  const camps = groupCampaigns([offer(0, 100), offer(100 + REPRICE_GAP + 1, 5000)]);
  assert.equal(camps.length, 2);
});

ok('a completed offer terminates its campaign — a re-place right after is a NEW intent', () => {
  const camps = groupCampaigns([offer(0, 100, { state: 'complete' }), offer(150, 400)]);
  assert.equal(camps.length, 2, 'completion ends the campaign regardless of the gap');
});

ok('place-then-cancel: replacement placed BEFORE the original cancel lands is still ONE campaign', () => {
  // MUTANT: drop REPLACE_OVERLAP_TOL (require gap >= 0) — red (the -30s overlap splits).
  const camps = groupCampaigns([offer(0, 130, { slot: 2 }), offer(100, 400, { slot: 6 })]);
  assert.equal(camps.length, 1, 'a 30s overlap on a different slot is a reprice, not a parallel listing');
  assert.equal(camps[0].offers.length, 2);
});

ok('a PARALLEL listing (predecessor live long past the open) is its OWN campaign — never a false reprice', () => {
  // MUTANT: the old single-chain boundary test — red (negative gap fails the > test and stitches).
  const camps = groupCampaigns([offer(0, 3000), offer(500, 2500)]);
  assert.equal(camps.length, 2, 'both offers live simultaneously for ~2000s — two intents');
  assert.ok(camps.every(c => c.offers.length === 1));
});

ok('two parallel ladders interleave and each is recovered as its OWN chain (the single-chain miss)', () => {
  // Ladder A: 0-100 -> 150-300. Ladder B: 20-900 -> 950-1000 (B1 spans all of A, so A2's only
  // eligible predecessor is A1, and B2's closest-closing is B1). Which chain an offer joins when
  // SEVERAL are eligible is closest-closing best-effort - timing alone cannot name the ladder - but
  // parallel OPEN offers must never merge and both ladders must come back whole here.
  // MUTANT: single-chain map - red (B1 forces A1's campaign closed; the ladders fragment).
  const A1 = offer(0, 100), B1 = offer(20, 900), A2 = offer(150, 300), B2 = offer(950, 1000);
  const camps = groupCampaigns([A1, B1, A2, B2]);
  assert.equal(camps.length, 2, 'two ladders, two campaigns');
  const ids = camps.map(c => c.offers.map(o => o.id)).sort((x, y) => x[0] - y[0]);
  assert.deepEqual(ids[0], [A1.id, A2.id], 'ladder A stitched whole');
  assert.deepEqual(ids[1], [B1.id, B2.id], 'ladder B stitched whole');
});

ok('an offer never joins a chain whose last offer is still open (tsClose null)', () => {
  const camps = groupCampaigns([offer(0, null, { state: 'open' }), offer(500, 900)]);
  assert.equal(camps.length, 2);
});

ok('same-slot succession wins over a closer cross-slot chain (slot reuse cannot be parallel)', () => {
  // MUTANT: drop the slotMatch preference (slotMatch = false) — red (joins the closer slot-9 chain).
  const camps = groupCampaigns([
    offer(0, 400, { slot: 3 }),          // chain A: slot 3, closes t=400
    offer(100, 450, { slot: 9 }),        // chain B: slot 9, closes t=450 (closer to the new offer)
    offer(500, 900, { slot: 3 }),        // reuses slot 3 — succeeds A despite B closing closer
  ]);
  assert.equal(camps.length, 2, 'two chains: A+successor, B alone');
  const joined = camps.find(c => c.offers.length === 2);
  assert.equal(joined.offers[0].slot, 3, 'the successor joined the same-slot chain, not the closer cross-slot one');
});

console.log(`campaigns.test: ${pass} passed`);
