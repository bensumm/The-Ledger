#!/usr/bin/env node
/**
 * watchcore.test.mjs — the in-app Watch tab's PURE decision layer (js/watchcore.js) + the SHARED
 * bid verdict (offerVerdict, js/quotecore.js) the console and the app now both consume.
 *
 * BUSINESS REQUIREMENTS (the Watch tab contract):
 *   - STRIPE FAMILY: a held verdict maps to exactly one severity — HOLD* → green(hold);
 *     CUT/CUT-CANDIDATE/LIST-TO-CLEAR/FALLING → red(cut); everything else (DIURNAL/SHOCK/NO-READ/
 *     UNDERWATER) → amber(watch). Semantic colour = state; gold is never good/bad.
 *   - ALERTS = CUT-family HELD verdicts + CANCEL-BID offers, and NOTHING else (the tab badge and
 *     the summary cell read this one count).
 *   - INCIDENTALS: a held lot under INCIDENTAL_GP total value is not a flip (collapsed, never a card).
 *   - TODAY is the LOCAL calendar day (CLAUDE.md time rule); the feed shows only completed fills
 *     from today, newest first, with after-tax net on SELLs (from the matched closed view) and
 *     never on buys; an unmatched sell shows a null net (honest, no fabricated profit).
 *   - SUMMARY: exposure = Σ deployed capital in open flips; day P/L = Σ realised of today's closes.
 *   - offerVerdict is byte-identical to watch.mjs's original bid gate ORDER (CANCEL-BID first).
 *
 * Synthetic fixtures only — no network, no positions.json. Run: `node pipeline/watchcore.test.mjs`.
 */
import assert from 'node:assert/strict';
import { verdictFamily, isHeldAlert, alertCount, splitHeld, INCIDENTAL_GP,
         isSameLocalDay, todaysFills, summary, capitalSplit, CANCEL_BID,
         briefDot, briefLine } from '../js/watchcore.js';
import { offerVerdict } from '../js/quotecore.js';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

/* --- verdict → severity family ------------------------------------------------------------ */
ok('HOLD family maps to the green (hold) stripe', () => {
  for (const v of ['HOLD', 'HOLD — list high', 'HOLD — watch']) assert.equal(verdictFamily(v), 'hold');
});
ok('CUT family + FALLING map to the red (cut) stripe', () => {
  for (const v of ['CUT', 'CUT-CANDIDATE', 'LIST-TO-CLEAR', 'FALLING']) assert.equal(verdictFamily(v), 'cut');
});
ok('caution verdicts map to the amber (watch) stripe', () => {
  for (const v of ['DIURNAL-WATCH', 'SHOCK-WATCH', 'NO-READ', 'UNDERWATER', 'NO-QUOTE', '']) assert.equal(verdictFamily(v), 'watch');
});

/* --- alert counting (the whole spec-D definition) ----------------------------------------- */
ok('isHeldAlert is true ONLY for the three CUT-family verdicts', () => {
  for (const v of ['CUT', 'CUT-CANDIDATE', 'LIST-TO-CLEAR']) assert.equal(isHeldAlert(v), true);
  for (const v of ['HOLD', 'DIURNAL-WATCH', 'FALLING', 'UNDERWATER']) assert.equal(isHeldAlert(v), false);
});
ok('alertCount = CUT-family held + CANCEL-BID offers, ignoring placement feedback', () => {
  const held = ['HOLD', 'CUT', 'DIURNAL-WATCH', 'LIST-TO-CLEAR'];   // 2 alerts
  const offers = ['BID-OK', 'CANCEL-BID', 'BID-BEHIND', 'CANCEL-BID'];  // 2 alerts
  assert.equal(alertCount(held, offers), 4);
  assert.equal(alertCount(['HOLD', 'HOLD'], ['BID-OK']), 0);
});

/* --- incidental split --------------------------------------------------------------------- */
ok('splitHeld sends sub-INCIDENTAL_GP lots to incidentals, the rest to flips', () => {
  const { flips, incidentals } = splitHeld([
    { id: 1, value: INCIDENTAL_GP },        // exactly the floor → a flip
    { id: 2, value: INCIDENTAL_GP - 1 },    // just under → incidental
    { id: 3, value: 50_000_000 },
  ]);
  assert.deepEqual(flips.map(l => l.id), [1, 3]);
  assert.deepEqual(incidentals.map(l => l.id), [2]);
});

/* --- local-day scoping -------------------------------------------------------------------- */
ok('isSameLocalDay compares LOCAL calendar days (a 23:55 fill is "today", 00:05 the next is not)', () => {
  const now = new Date(2026, 6, 5, 12, 0, 0).getTime();                       // Jul 5 2026, noon local
  const lateToday = Math.floor(new Date(2026, 6, 5, 23, 55, 0).getTime() / 1000);
  const earlyTomorrow = Math.floor(new Date(2026, 6, 6, 0, 5, 0).getTime() / 1000);
  assert.equal(isSameLocalDay(lateToday, now), true);
  assert.equal(isSameLocalDay(earlyTomorrow, now), false);
  assert.equal(isSameLocalDay(null, now), false);
});

/* --- today's fills feed ------------------------------------------------------------------- */
ok('todaysFills: completed fills today, newest first; sell net from the matched close, buy net null', () => {
  const now = new Date(2026, 6, 5, 18, 0, 0).getTime();
  const sellTs = Math.floor(new Date(2026, 6, 5, 10, 11, 0).getTime() / 1000);
  const buyTs = Math.floor(new Date(2026, 6, 5, 9, 32, 0).getTime() / 1000);
  const yTs = Math.floor(new Date(2026, 6, 4, 10, 0, 0).getTime() / 1000);   // yesterday → excluded
  const events = [
    { ts: buyTs, state: 'complete', type: 'buy', itemId: 13263, price: 17_400_000, filled: 1, qty: 1 },
    { ts: sellTs, state: 'complete', type: 'sell', itemId: 13263, price: 17_949_500, filled: 1, qty: 1 },
    { ts: sellTs, state: 'partial', type: 'sell', itemId: 13263, price: 17_949_500, filled: 1, qty: 1 }, // not terminal → skipped
    { ts: yTs, state: 'complete', type: 'sell', itemId: 999, price: 5, filled: 3, qty: 3 },              // yesterday → skipped
  ];
  // two FIFO-split closed flips at the same itemId+sellTs → their realised SUMS
  const closed = [
    { itemId: 13263, sellTs, realised: 100_000 },
    { itemId: 13263, sellTs, realised: 90_510 },
  ];
  const feed = todaysFills(events, closed, now);
  assert.equal(feed.length, 2);
  assert.equal(feed[0].ts, sellTs);                 // newest first
  assert.equal(feed[0].side, 'sell');
  assert.equal(feed[0].net, 190_510);               // summed matched realised
  assert.equal(feed[1].side, 'buy');
  assert.equal(feed[1].net, null);                  // buys never carry a net
});
ok('todaysFills: a sell with no matched close shows a null net (no fabricated profit)', () => {
  const now = new Date(2026, 6, 5, 18, 0, 0).getTime();
  const ts = Math.floor(new Date(2026, 6, 5, 8, 0, 0).getTime() / 1000);
  const feed = todaysFills([{ ts, state: 'complete', type: 'sell', itemId: 42, price: 100, filled: 5, qty: 5 }], [], now);
  assert.equal(feed.length, 1);
  assert.equal(feed[0].net, null);
});

/* --- summary aggregates ------------------------------------------------------------------- */
ok('summary sums deployed capital (exposure) and today\'s realised (day P/L) with counts', () => {
  const s = summary(
    [{ value: 10_000_000 }, { value: 18_460_000 }],
    [{ realised: 800_000 }, { realised: 425_529 }, { realised: 0 }],
  );
  assert.equal(s.exposureGp, 28_460_000);
  assert.equal(s.flipCount, 2);
  assert.equal(s.dayPL, 1_225_529);
  assert.equal(s.closedCount, 3);
});

ok('capitalSplit: working/(working+parked) %, null when nothing committed (YA1 #3)', () => {
  const u = capitalSplit(28_460_000, 11_540_000);
  assert.equal(u.committed, 40_000_000);
  assert.equal(u.utilizationPct, 71);
  assert.equal(capitalSplit(0, 500).utilizationPct, 0, 'all parked → 0% working');
  assert.equal(capitalSplit(500, 0).utilizationPct, 100, 'all held → 100%');
  assert.equal(capitalSplit(0, 0).utilizationPct, null, 'nothing committed → null, never a fake %');
});

/* --- shared offer verdict (byte-identical gate order to watch.mjs's original) -------------- */
const orow = o => ({ quickBuy: 100, optBuy: 95, mom: 'clean', reliable: true, falling: false, ...o });
ok('offerVerdict CANCEL-BID fires first on falling OR a reliable breakdown (adverse selection)', () => {
  assert.equal(offerVerdict(orow({ falling: true }), 90), CANCEL_BID);
  assert.equal(offerVerdict(orow({ mom: 'breakdown', reliable: true }), 90), CANCEL_BID);
  // a breakdown off an UNRELIABLE quote is NOT a cancel (Gate-0 discipline)
  assert.notEqual(offerVerdict(orow({ mom: 'breakdown', reliable: false }), 90), CANCEL_BID);
});
ok('offerVerdict: NO-QUOTE / CROSSING / BID-BEHIND / BID-OK by band position', () => {
  assert.equal(offerVerdict(orow({ quickBuy: null }), 90), 'NO-QUOTE');
  assert.equal(offerVerdict(orow(), 100), 'CROSSING');    // bid ≥ live instasell
  assert.equal(offerVerdict(orow(), 101), 'CROSSING');
  assert.equal(offerVerdict(orow(), 90), 'BID-BEHIND');   // below the 2h band low (95)
  assert.equal(offerVerdict(orow(), 97), 'BID-OK');       // inside the band
  assert.equal(offerVerdict(null, 90), 'NO-QUOTE');
});

/* --- P5: PATH-AWARE offerVerdict (the third arg). The app Watch tab calls offerVerdict(row, price)
   with NO path arg, so absent-path MUST be byte-identical to pre-P5 (the app-inertness proof). --- */
ok('P5 app-inertness: absent path context (undefined/null/{}) is byte-identical to the 2-arg call', () => {
  // sweep the full state matrix WITHOUT a path arg, then again with undefined/null/{} — all identical.
  const cases = [
    orow({ falling: true }), orow({ mom: 'breakdown', reliable: true }),
    orow({ mom: 'breakdown', reliable: false }), orow({ quickBuy: null }), orow(),
  ];
  const prices = [90, 97, 100, 101];
  for (const r of cases) for (const p of prices) {
    const base = offerVerdict(r, p);
    assert.equal(offerVerdict(r, p, undefined), base, 'undefined path ≡ 2-arg');
    assert.equal(offerVerdict(r, p, null), base, 'null path ≡ 2-arg');
    assert.equal(offerVerdict(r, p, {}), base, 'empty-object path (no .path) ≡ 2-arg');
  }
});
ok('P5 scalp path: a faller does NOT CANCEL-BID off falling alone; its 2h-breakdown tripwire DOES', () => {
  // ACCEPTANCE #1 — a path-less bid on the same faller still cancels; the scalp-path bid does not.
  const faller = orow({ falling: true });
  assert.equal(offerVerdict(faller, 90), CANCEL_BID, 'path-less faller → CANCEL-BID (pinned)');
  assert.notEqual(offerVerdict(faller, 90, 'scalp'), CANCEL_BID, 'scalp expects falling → not a cancel');
  assert.equal(offerVerdict(faller, 90, 'scalp'), 'BID-BEHIND', 'falls through to placement feedback');
  // scalp STILL cancels on its own tripwire: a live reliable 2h breakdown (the intraday band collapse).
  assert.equal(offerVerdict(orow({ mom: 'breakdown', reliable: true }), 90, 'scalp'), CANCEL_BID, 'scalp tripwire fires');
  // a bare key and a { path } object behave the same.
  assert.equal(offerVerdict(faller, 90, { path: 'scalp' }), 'BID-BEHIND');
});
ok('P5 value-hold path: falling & 2h-breakdown do NOT cancel; only a floor-break tripwire does', () => {
  const faller = orow({ falling: true });
  assert.notEqual(offerVerdict(faller, 90, 'value-hold'), CANCEL_BID, 'value holds through a soft tape');
  assert.notEqual(offerVerdict(orow({ mom: 'breakdown', reliable: true }), 90, 'value-hold'), CANCEL_BID, 'holds through froth');
  // floor break (live instasell below the declared floor tripwire) → cancel, the value thesis is dead.
  assert.equal(offerVerdict(orow({ quickBuy: 100 }), 90, { path: 'value-hold', tripwire: 105 }), CANCEL_BID);
  assert.notEqual(offerVerdict(orow({ quickBuy: 100 }), 90, { path: 'value-hold', tripwire: 95 }), CANCEL_BID, 'above the floor → no cancel');
});

/* --- --brief compact book (the SCRIPT-OWNED loop format) ----------------------------------- */
ok('briefDot maps verdicts to the right severity dot', () => {
  assert.equal(briefDot('CUT'), '🔴');
  assert.equal(briefDot('CUT-CANDIDATE'), '🔴');       // act-now family (matches MONITORING palette)
  assert.equal(briefDot('CANCEL-BID'), '🔴');
  assert.equal(briefDot('LIST-TO-CLEAR'), '🟠');       // decision pending
  assert.equal(briefDot('UNDERWATER'), '🟠');
  assert.equal(briefDot('CROSSING'), '🟡');            // watch
  assert.equal(briefDot('HOLD'), '🟢');
  assert.equal(briefDot('HOLD — list high'), '🟢');
  assert.equal(briefDot('BID-OK'), '🟢');
  assert.equal(briefDot('BID-BEHIND'), '🟡');            // watch family
  assert.equal(briefDot('WATCH — fresh entry'), '🟡');  // "WATCH…" is watch amber, not HOLD green
  assert.equal(briefDot('HOLD — ask filling'), '🟢');   // HOLD-prefix softening stays green
  assert.equal(briefDot('NO-READ'), '⚪');
});
ok('briefLine ALWAYS carries list @ X (BE Y) when a sell is known — even on a resting bid', () => {
  // a held lot
  assert.equal(
    briefLine({ verdict: 'HOLD', name: 'Crushed nest', position: '×7 @ 4,680 · NOT LISTED', listAt: 4821, breakEven: 4776 }),
    '🟢 Crushed nest · ×7 @ 4,680 · NOT LISTED → list 4,821 (BE 4,776) · HOLD');
  // a resting bid still states its intended sell (state-sell-price-in-loop, now mechanical)
  assert.equal(
    briefLine({ verdict: 'BID-OK', name: 'Super combat potion(4)', position: 'bid 0/550 @ 12,146', listAt: 12500, breakEven: 12394 }),
    '🟢 Super combat potion(4) · bid 0/550 @ 12,146 → list 12,500 (BE 12,394) · BID-OK');
});
ok('briefLine degrades gracefully when list-at is unknown (BE-only, then bare)', () => {
  assert.equal(briefLine({ verdict: 'NO-READ', name: 'X', position: 'ask 0/1 @ 35.6m', listAt: null, breakEven: 35510000 }),
    '⚪ X · ask 0/1 @ 35.6m (BE 35.51m) · NO-READ');
  assert.equal(briefLine({ verdict: 'UNBOOKED-ASK', name: 'Y', position: 'ask 1/1 @ 100', listAt: null, breakEven: null }),
    '⚪ Y · ask 1/1 @ 100 · UNBOOKED-ASK');
});

console.log(`\nAll ${pass} checks passed.`);
