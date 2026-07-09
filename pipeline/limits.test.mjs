/* limits.test.mjs — BUSINESS REQUIREMENTS pinned here (LM1):
 *
 * 1. limitWindow implements a ROLLING 4h window: units age out at exactly 4h; boughtInWindow sums only
 *    in-window buys; nextFreeAt/fullResetAt are the oldest/newest in-window buy + 4h.
 * 2. A NULL limit means UNKNOWN, never unlimited → remaining is null.
 * 3. buysByItem extracts BUY fills the SAME way reconstruct does (collapseOffers∘dedupeSnapshots,
 *    final cumulative filled; sells/cancels/banked excluded).
 * 4. limitValidator: remaining 0 → reject; 0 < remaining < 25% → caution; else pass; absent/null-limit
 *    stage → degrade to pass (the P2/P3 precedent).
 * 5. A held/asked row is NEVER hidden by the validator — the SURFACE owns that; the validator only
 *    returns a status (a reject on a held lot is still just a status the surface renders as a note).
 */
import assert from 'node:assert/strict';
import { limitWindow, buysByItem, buysForItem, LIMIT_WINDOW_SEC } from './lib/limits.mjs';
import { limitValidator, runValidators, worstStatus, flags, LIMIT_CAUTION_FRAC } from '../js/validate.mjs';

let n = 0;
function ok(name, fn) { fn(); n++; console.log('  ✓ ' + name); }

const NOW = 1_800_000_000_000;                 // fixed unix-ms "now"
const nowSec = Math.floor(NOW / 1000);
const AGO = mins => nowSec - mins * 60;        // a ts `mins` minutes before now

// --- window math ------------------------------------------------------------------------------
ok('boughtInWindow sums only buys inside the last 4h', () => {
  const w = limitWindow({ buys: [{ ts: AGO(30), qty: 5 }, { ts: AGO(120), qty: 3 }], limit: 100, now: NOW });
  assert.equal(w.boughtInWindow, 8);
  assert.equal(w.remaining, 92);
  assert.equal(w.limit, 100);
});

ok('a buy older than 4h has aged out (not counted)', () => {
  const w = limitWindow({ buys: [{ ts: AGO(241), qty: 10 }], limit: 100, now: NOW });   // 4h01m ago
  assert.equal(w.boughtInWindow, 0);
  assert.equal(w.remaining, 100);
  assert.equal(w.nextFreeAt, null);
  assert.equal(w.fullResetAt, null);
});

ok('a buy exactly at the 4h edge is out (strict >, matches the reset instant)', () => {
  const w = limitWindow({ buys: [{ ts: AGO(240), qty: 10 }], limit: 100, now: NOW });    // exactly 4h ago
  assert.equal(w.boughtInWindow, 0);
});

ok('nextFreeAt = oldest in-window buy + 4h; fullResetAt = newest + 4h (partial free)', () => {
  const oldest = AGO(200), newest = AGO(20);
  const w = limitWindow({ buys: [{ ts: newest, qty: 1 }, { ts: oldest, qty: 1 }], limit: 100, now: NOW });
  assert.equal(w.nextFreeAt, oldest + LIMIT_WINDOW_SEC);
  assert.equal(w.fullResetAt, newest + LIMIT_WINDOW_SEC);
});

ok('remaining floors at 0 when over the limit (never negative)', () => {
  const w = limitWindow({ buys: [{ ts: AGO(10), qty: 150 }], limit: 100, now: NOW });
  assert.equal(w.boughtInWindow, 150);
  assert.equal(w.remaining, 0);
});

ok('null limit means UNKNOWN → remaining null (NOT unlimited)', () => {
  const w = limitWindow({ buys: [{ ts: AGO(10), qty: 5 }], limit: null, now: NOW });
  assert.equal(w.limit, null);
  assert.equal(w.boughtInWindow, 5);   // still counts what was bought
  assert.equal(w.remaining, null);     // but cannot advise remaining
});

ok('empty/absent buys → zero window, null reset instants', () => {
  const w = limitWindow({ buys: [], limit: 100, now: NOW });
  assert.equal(w.boughtInWindow, 0);
  assert.equal(w.remaining, 100);
  assert.equal(w.nextFreeAt, null);
  const w2 = limitWindow({ limit: 100, now: NOW });   // no buys key at all
  assert.equal(w2.boughtInWindow, 0);
});

// --- buysByItem extraction (mirrors reconstruct's derivation-layer interpretation) ------------
// One buy offer (placed→partial→complete, cumulative filled) + one sell + a cancelled buy + a banked
// lot. Only the completed GE buy's final filled should surface.
const EVENTS = [
  { ts: AGO(30), slot: 1, itemId: 555, type: 'buy',  state: 'placed',   price: 100, qty: 10, filled: 0,  spent: 0 },
  { ts: AGO(29), slot: 1, itemId: 555, type: 'buy',  state: 'partial',  price: 100, qty: 10, filled: 4,  spent: 400 },
  { ts: AGO(28), slot: 1, itemId: 555, type: 'buy',  state: 'complete', price: 100, qty: 10, filled: 10, spent: 1000 },
  { ts: AGO(20), slot: 2, itemId: 555, type: 'sell', state: 'complete', price: 120, qty: 10, filled: 10, spent: 1200 },
  { ts: AGO(15), slot: 3, itemId: 777, type: 'buy',  state: 'cancelled',price: 50,  qty: 5,  filled: 0,  spent: 0 },
  { ts: AGO(10), slot: 8, itemId: 888, type: 'banked',state: 'complete',price: 30,  qty: 7,  filled: 7,  spent: 210 },
];

ok('buysByItem keeps only completed GE BUY fills (final cumulative filled)', () => {
  const m = buysByItem(EVENTS);
  assert.deepEqual(m.get(555), [{ ts: AGO(28), qty: 10 }]);   // one offer, final filled=10, at close ts
  assert.equal(m.has(777), false);   // cancelled buy, filled 0 → excluded
  assert.equal(m.has(888), false);   // banked (pre-owned) → not a GE purchase → excluded
});

ok('buysForItem returns [] for an item with no logged buy', () => {
  assert.deepEqual(buysForItem(EVENTS, 999), []);
});

ok('a real 3-quarters-full window off extracted buys leaves the right remainder', () => {
  const buys = buysForItem(EVENTS, 555);
  const w = limitWindow({ buys, limit: 40, now: NOW });
  assert.equal(w.boughtInWindow, 10);
  assert.equal(w.remaining, 30);
});

// --- limitValidator ---------------------------------------------------------------------------
function vFor(win) { return limitValidator({ limits: { window: win } }); }

ok('remaining 0 → reject, names the count and next-frees time', () => {
  const w = limitWindow({ buys: [{ ts: AGO(30), qty: 100 }], limit: 100, now: NOW });
  const r = vFor(w);
  assert.equal(r.status, 'reject');
  assert.match(r.reason, /buy limit exhausted \(bought 100\/100 this 4h window\)/);
  assert.match(r.reason, /next frees ~/);
  assert.equal(r.evidence.remaining, 0);
});

ok('0 < remaining < 25% of limit → caution', () => {
  // limit 100, bought 80 → remaining 20 < 25 (25% of 100) → caution
  const w = limitWindow({ buys: [{ ts: AGO(30), qty: 80 }], limit: 100, now: NOW });
  const r = vFor(w);
  assert.equal(r.status, 'caution');
  assert.match(r.reason, /nearly exhausted \(bought 80\/100 this 4h window, 20 left\)/);
});

ok('remaining at/above the caution fraction → pass', () => {
  // limit 100, bought 70 → remaining 30 ≥ 25 → pass
  const w = limitWindow({ buys: [{ ts: AGO(30), qty: 70 }], limit: 100, now: NOW });
  assert.equal(vFor(w).status, 'pass');
  assert.ok(LIMIT_CAUTION_FRAC === 0.25);
});

ok('zero in-window buys → pass (byte-identity: no flag fires)', () => {
  const w = limitWindow({ buys: [], limit: 100, now: NOW });
  const r = vFor(w);
  assert.equal(r.status, 'pass');
});

ok('absent limits stage → degrade to pass (app supplies nothing)', () => {
  assert.equal(limitValidator({}).status, 'pass');
  assert.equal(limitValidator({ limits: {} }).status, 'pass');
});

ok('null limit → degrade to pass (UNKNOWN, never a reject/caution)', () => {
  const w = limitWindow({ buys: [{ ts: AGO(30), qty: 999 }], limit: null, now: NOW });
  assert.equal(vFor(w).status, 'pass');
});

ok('registry: runValidators includes limit; an exhausted buy is worst=reject and flagged', () => {
  const w = limitWindow({ buys: [{ ts: AGO(30), qty: 100 }], limit: 100, now: NOW });
  const res = runValidators({ limits: { window: w } });
  assert.ok(res.some(r => r.key === 'limit'));
  assert.equal(worstStatus(res), 'reject');
  assert.ok(flags(res).some(f => f.key === 'limit' && f.status === 'reject'));
});

ok('a HELD/asked row is never hidden by the validator — it only returns a status', () => {
  // The validator forms a status; hiding/dropping is the SURFACE's job. Even with position.held set,
  // limitValidator still returns its status (screen drops, but quote --positions / asks render a note).
  const w = limitWindow({ buys: [{ ts: AGO(30), qty: 100 }], limit: 100, now: NOW });
  const r = limitValidator({ position: { held: true }, limits: { window: w } });
  assert.equal(r.status, 'reject');   // still computed; the surface chooses to note-not-hide
});

console.log(`\n${n} limits assertions passed.`);
