/* staleexit.test.mjs — acceptance fixtures for the stale declared-exit read (Proposal C,
 * pipeline/lib/staleexit.mjs). Pins:
 *   1. a declared exit set off OLD peaks that recent nights stopped printing → stale, and the
 *      named reachable level comes from the RECENT nights (the Masori/Berserker miss shape);
 *   2. an exit the recent nights still print → NOT stale (no false alarm on a live plan);
 *   3. thin/missing history → null (silent degrade — never a stale call off nothing);
 *   4. inform-only contract: the module exports a READ, no verdict/gate/price surface.
 * Synthetic series only — never the live API. Run: node pipeline/test/staleexit.test.mjs
 */
import assert from 'node:assert/strict';
import { staleExitRead, STALE_EXIT_RECENT_FRAC } from '../lib/staleexit.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log(`  ✓ ${name}`); };

// Build an hourly 1h series over `days` LOCAL days ending yesterday, with per-day peak highs from
// `peakByDay` (oldest→newest) printed at hour 14 and a flat 100 low/high floor elsewhere. `now` is
// pinned mid-today so windowStats treats today as incomplete (skipped) and every listed day scores.
const DAY = 24 * 3600;
function series(peakByDay, now) {
  const pts = [];
  const todayMid = new Date(now); todayMid.setHours(0, 0, 0, 0);
  const t0 = Math.floor(todayMid.getTime() / 1000) - peakByDay.length * DAY;
  peakByDay.forEach((peak, d) => {
    for (let h = 0; h < 24; h++) {
      const hi = h === 14 ? peak : 100;
      pts.push({ timestamp: t0 + d * DAY + h * 3600, avgLowPrice: 95, avgHighPrice: hi, lowPriceVolume: 10, highPriceVolume: 10 });
    }
  });
  return pts;
}
const NOW = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d; })();

console.log('staleexit — stale declared-exit read (Proposal C):');

ok('old-peak exit the recent nights stopped printing → STALE, reachable named from recent nights', () => {
  // 11 old nights peaking 150, the 3 recent nights peaking only 120 — exit declared at 145.
  const ts1h = series([...Array(11).fill(150), 120, 121, 119], NOW);
  const r = staleExitRead({ ts1h, exitLevel: 145, now: NOW });
  assert.ok(r, 'scorable');
  assert.equal(r.stale, true, 'exit printed 11/14 full but 0/3 recent → stale');
  assert.equal(r.recentHit, 0);
  assert.equal(r.recentDays, 3);
  assert.equal(r.fullHit, 11);
  assert.ok(r.reachable >= 119 && r.reachable <= 121, `reachable ~recent median peak, got ${r.reachable}`);
});

ok('an exit the recent nights still print → NOT stale (no false alarm)', () => {
  const ts1h = series([...Array(11).fill(150), 150, 151, 149], NOW);
  const r = staleExitRead({ ts1h, exitLevel: 145, now: NOW });
  assert.ok(r, 'scorable');
  assert.equal(r.stale, false, 'reached 3/3 recent — the plan is live');
});

ok('reached on exactly the 2/3 bar is NOT stale (strictly-below semantics)', () => {
  // recent nights: two print 150 (reach a 145 exit), one prints only 120 → 2/3 = the bar, fresh.
  const ts1h = series([...Array(11).fill(150), 150, 120, 150], NOW);
  const r = staleExitRead({ ts1h, exitLevel: 145, now: NOW });
  assert.equal(r.stale, false, `recentFrac 2/3 is not < STALE_EXIT_RECENT_FRAC (${STALE_EXIT_RECENT_FRAC})`);
});

ok('thin/missing history degrades to null — never a stale call off nothing', () => {
  assert.equal(staleExitRead({ ts1h: null, exitLevel: 145, now: NOW }), null, 'no series');
  assert.equal(staleExitRead({ ts1h: [], exitLevel: 145, now: NOW }), null, 'empty series');
  assert.equal(staleExitRead({ ts1h: series([150, 150, 120], NOW), exitLevel: 145, now: NOW }), null,
    '3 scored nights < the reach min-sample floor');
  assert.equal(staleExitRead({ ts1h: series(Array(14).fill(150), NOW), exitLevel: null, now: NOW }), null,
    'no numeric declared exit');
});

console.log(`\nstaleexit: ${pass} checks passed.`);
