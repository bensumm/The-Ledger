#!/usr/bin/env node
/**
 * ledgercore.test.mjs — the Ledger's day-boundary money bucketing + per-item grouping (TD2.1).
 *
 * periodKey + groupTrades were moved out of js/ledger.js (DOM-pinned) into the pure module
 * js/ledgercore.js so this — the highest-value extraction, the code that decides WHICH day/
 * week/month a realised flip counts in — finally gets a COMMITTED fixture. E1 audited the
 * near-midnight boundary by hand in 2026-07-04; this pins it.
 *
 * BUSINESS REQUIREMENTS (what an agent changing the Ledger must not break):
 *   - periodKey uses LOCAL Date getters by design: a local 23:55 dip buckets to THAT local day,
 *     never the UTC-rolled next day (the project time-display rule — rendered times are local).
 *   - Week buckets split at the LOCAL Monday: a Sun and its preceding Mon share a week key; the
 *     next Mon starts a new one.
 *   - Month key is local year-month; day key is local year-month-day.
 *   - groupTrades folds trades into one bucket per item (by itemId when present, else by name),
 *     preserving every row so the caller can sum per-item qty / realised aggregates.
 *
 * All fixtures are built with LOCAL-time Date construction (new Date(y, m, d, ...)) so they pass
 * in ANY timezone — CI runs UTC, the dev machine does not. Synthetic data only.
 * Run: `node pipeline/test/ledgercore.test.mjs`  (exits non-zero on any failure).
 */
import assert from 'node:assert/strict';
import { periodKey, groupTrades } from '../../js/ledgercore.js';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

// periodKey takes epoch SECONDS; build the ts from a LOCAL-time Date so the assertion is tz-robust.
const secs = d => Math.floor(d.getTime() / 1000);

/* --- day boundary: local 23:55 stays on its local day (the E1 near-midnight guard) --------- */
ok('local 23:55 buckets to that local day, not the UTC-rolled next day', () => {
  const late = new Date(2026, 6, 4, 23, 55, 0);   // local Jul 4 2026 23:55 (month is 0-based: 6=July)
  const { key } = periodKey(secs(late), 'day');
  assert.equal(key, '2026-07-04');                // local day — a getUTC* impl in a +TZ would roll to 07-05
  // a point 10 minutes later crosses into the next local day
  const next = new Date(2026, 6, 5, 0, 5, 0);
  assert.equal(periodKey(secs(next), 'day').key, '2026-07-05');
});

ok('day key + label are local year-month-day / MM/DD', () => {
  const noon = new Date(2026, 6, 4, 12, 0, 0);
  const { key, label } = periodKey(secs(noon), 'day');
  assert.equal(key, '2026-07-04');
  assert.equal(label, '07/04');
});

/* --- week boundary: split at the local Monday --------------------------------------------- */
ok('week buckets split at the local Monday (Sun + preceding Mon share, next Mon differs)', () => {
  const mon = new Date(2026, 5, 29, 12, 0, 0);    // Mon Jun 29 2026 (verified weekday below)
  const sun = new Date(2026, 6, 5, 12, 0, 0);     // Sun Jul 5 2026 — same Mon–Sun week as Jun 29
  const nextMon = new Date(2026, 6, 6, 12, 0, 0); // Mon Jul 6 2026 — new week
  assert.equal(mon.getDay(), 1);                  // precondition: fixture really is a Monday
  assert.equal(sun.getDay(), 0);
  const kMon = periodKey(secs(mon), 'week').key;
  assert.equal(periodKey(secs(sun), 'week').key, kMon);            // Sun shares the week's Monday key
  assert.notEqual(periodKey(secs(nextMon), 'week').key, kMon);     // next Monday is a different week
  assert.equal(kMon, 'w2026-06-29');                               // key anchors on the Monday's date
});

ok('a late-Sunday-night point still buckets to that week (Monday key), not the next', () => {
  const sunLate = new Date(2026, 6, 5, 23, 55, 0); // Sun Jul 5 23:55 local
  assert.equal(periodKey(secs(sunLate), 'week').key, 'w2026-06-29');
});

/* --- month key ---------------------------------------------------------------------------- */
ok('month key is local year-month; a local 23:55 on the last day stays in that month', () => {
  const lastDayLate = new Date(2026, 6, 31, 23, 55, 0); // Jul 31 2026 23:55 local
  assert.equal(periodKey(secs(lastDayLate), 'month').key, '2026-07');
});

/* --- groupTrades: one bucket per item, rows preserved for per-item aggregation ------------- */
ok('groupTrades folds trades per item (by id) and preserves every row for qty/realised sums', () => {
  const trades = [
    { itemId: 4151, name: 'Abyssal whip', qty: 2, realised: 100 },
    { itemId: 4151, name: 'Abyssal whip', qty: 3, realised: 150 },
    { itemId: 11832, name: 'Bandos chestplate', qty: 1, realised: 500 },
  ];
  const groups = groupTrades(trades);
  assert.equal(groups.length, 2);                       // two distinct items
  const whip = groups.find(g => g.itemId === 4151);
  assert.equal(whip.rows.length, 2);
  assert.equal(whip.rows.reduce((s, t) => s + t.qty, 0), 5);        // per-item qty aggregate
  assert.equal(whip.rows.reduce((s, t) => s + t.realised, 0), 250); // per-item realised aggregate
  const bcp = groups.find(g => g.itemId === 11832);
  assert.equal(bcp.rows.length, 1);
  assert.equal(bcp.rows[0].realised, 500);
});

ok('groupTrades keys by NAME when itemId is null (legacy pre-id local entries)', () => {
  const trades = [
    { itemId: null, name: 'Mystery item', qty: 1, realised: 10 },
    { itemId: null, name: 'Mystery item', qty: 1, realised: 20 },
    { itemId: null, name: 'Other', qty: 1, realised: 5 },
  ];
  const groups = groupTrades(trades);
  assert.equal(groups.length, 2);
  const mystery = groups.find(g => g.name === 'Mystery item');
  assert.equal(mystery.rows.length, 2);
  assert.equal(mystery.rows.reduce((s, t) => s + t.realised, 0), 30);
});

console.log(`\nAll ${pass} checks passed.`);
