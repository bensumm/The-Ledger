#!/usr/bin/env node
/**
 * quotecore.test.mjs — PLAN-3 acceptance fixtures for the underwater-triage decision tree.
 *
 * quotecore is PURE (no DOM, no network), so the whole gate tree is fixture-testable with
 * synthetic series — NO live data (per CLAUDE.md rule 4 / PLAN-3 "no live data in tests").
 * Run: `node pipeline/quotecore.test.mjs`  (exits non-zero on any failure).
 *
 * Coverage (PLAN-3 "Acceptance"):
 *   - stale-quote            → NO-READ, never CUT
 *   - seed-incident replica  → DIURNAL-WATCH; same fixture at a liquid window → falls through → CUT
 *   - bludgeon replica       → CUT (regression guard: the gates must not soften the real case)
 *   - ambiguous-shape break  → falls through to the momVerdict matrix (CUT)
 *   - shock shape            → SHOCK-WATCH (Gate 2 shock branch)
 *   - clean underwater thru a liquid window → CUT-CANDIDATE (D-escalation)
 *   - missing instabuy       → NO-READ (never CUT)
 *   - feed inversion (Q1)    → NO-READ (crossed feed: reliable:false/ordered:false, never a verdict)
 *   - quoteOrdered invariant untouched by the new fields
 */
import assert from 'node:assert/strict';
import { computeQuote, momVerdict, quoteOrdered, diurnalRead, moveShape, breakEven, BIG_TICKET_GP } from '../js/quotecore.js';

const NOW_SEC = 1_720_000_000;          // arbitrary fixed "now" (unix seconds)
const NOW_MS  = NOW_SEC * 1000;
const FRESH   = NOW_SEC - 120;          // a 2-min-old print (not stale)

// Build a 5m series ending at NOW_SEC. fn(hoursAgo, idxFromEnd) → {low, high, vol}.
// idxFromEnd 0 = most recent window. Points are oldest-first (as the wiki returns them).
function mk5m(fn, hours = 30) {
  const pts = [], n = hours * 12;
  for (let k = n; k >= 1; k--) {
    const ts = NOW_SEC - k * 300, ha = (NOW_SEC - ts) / 3600, idxFromEnd = k - 1;
    const { low, high, vol } = fn(ha, idxFromEnd);
    pts.push({ timestamp: ts, avgLowPrice: low, avgHighPrice: high, lowPriceVolume: vol, highPriceVolume: vol });
  }
  return pts;
}
const rowOf = (latest, ts5m, opts = {}) =>
  computeQuote({ latest, ts5m, ts6h: [], vol24: null, guide: null, now: NOW_MS, ...opts });

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

console.log('PLAN-3 quotecore acceptance:');

// --- 1. Stale quote → NO-READ, never CUT --------------------------------------------------
ok('stale-quote → NO-READ (never CUT)', () => {
  const ts5m = mk5m(() => ({ low: 990, high: 1010, vol: 500 }));   // dense, liquid → stale thresh = 90m
  const latest = { low: 980, high: 1010, lowTime: NOW_SEC - 5 * 3600, highTime: NOW_SEC - 5 * 3600 }; // 5h stale
  const row = rowOf(latest, ts5m);
  assert.equal(row.reliable, false);
  assert.equal(row.reliableReason, 'stale-quote');
  const be = breakEven(1200);                     // 1225 > instabuy 1010 → underwater + breakdown
  const mv = momVerdict(row, be, 5000, ts5m, NOW_MS);
  assert.equal(mv.action, 'NO_READ');
  assert.notEqual(mv.action, 'CUT');
});

// --- 2. Seed-incident replica → DIURNAL-WATCH; liquid variant → CUT ------------------------
// Two liquidity troughs (now, and ~24h ago) with a busy, higher-priced day between them.
function seedSeries(currentWindowBusy) {
  return mk5m((ha) => {
    const inTrough = ha < 2 || (ha >= 24 && ha < 26);
    const busy = inTrough ? (ha < 2 ? currentWindowBusy : false) : true;
    const vol = busy ? 1000 : 100;                // trough windows print, just thin (interpretation A, not E)
    const low = inTrough ? 28500 : 29800;
    const high = inTrough ? 29000 : 30200;
    return { low, high, vol };
  });
}
ok('seed incident (quiet trough, dipped+recovered yesterday) → DIURNAL-WATCH', () => {
  const ts5m = seedSeries(false);                 // current window quiet
  const d = diurnalRead(ts5m, NOW_MS);
  assert.equal(d.quiet, true);
  assert.equal(d.yesterdayDipped, true);
  assert.equal(d.yesterdayRecovered, true);
  const latest = { low: 28400, high: 29000, lowTime: FRESH, highTime: FRESH };  // underwater + a live breakdown
  const row = rowOf(latest, ts5m);
  assert.equal(row.reliable, true, 'a quiet-but-printing trough is still a reliable quote');
  const be = breakEven(30000);                    // 30613 > instabuy 29000 → underwater
  const mv = momVerdict(row, be, 1_000_000, ts5m, NOW_MS);
  assert.equal(mv.action, 'DIURNAL_WATCH');
  assert.equal(mv.gate, 1);
});
ok('seed fixture at a LIQUID window (defense spent) → falls through → CUT', () => {
  const ts5m = seedSeries(true);                  // current window now busy → not quiet
  assert.equal(diurnalRead(ts5m, NOW_MS).quiet, false);
  const latest = { low: 28400, high: 29000, lowTime: FRESH, highTime: FRESH };
  const row = rowOf(latest, ts5m);
  const be = breakEven(30000);
  const mv = momVerdict(row, be, 1_000_000, ts5m, NOW_MS);
  assert.equal(mv.action, 'CUT');
});

// --- 3. Bludgeon replica → CUT (regression guard: byte-identical verdict identity) ---------
ok('bludgeon (volume-qualified bleed, liquid hours, big-ticket, underwater) → CUT', () => {
  const ts5m = mk5m((ha, i) => {
    if (ha >= 2) return { low: 99000, high: 99200, vol: 500 };     // flat high before the last 2h (no yday dip)
    const low = 99000 - (23 - i) * 90;            // monotone lower-lows across the last 24 → bleed
    return { low, high: low + 200, vol: 500 };    // uniform volume → no spike
  });
  assert.equal(moveShape(ts5m), 'bleed');
  const latest = { low: 96900, high: 97200, lowTime: FRESH, highTime: FRESH };
  const row = rowOf(latest, ts5m);
  assert.equal(row.reliable, true);
  assert.equal(row.mom, 'breakdown');
  const be = breakEven(105000);                   // 107143 > instabuy 97200 → underwater
  const lotValue = 200 * 105000;                  // 21m ≥ BIG_TICKET_GP
  assert.ok(lotValue >= BIG_TICKET_GP);
  const mv = momVerdict(row, be, lotValue, ts5m, NOW_MS);
  assert.equal(mv.action, 'CUT');
  assert.equal(mv.verdict, 'CUT');
  assert.equal(mv.cls, 'loss');
  assert.equal(mv.listAt, 97200);                 // = the live instabuy
  assert.ok(mv.why.includes('cut at the instabuy'));
});

// --- 4. Ambiguous-shape breakdown → falls through to the matrix (CUT) ----------------------
ok('ambiguous breakdown, underwater → matrix → CUT (no softening)', () => {
  const ts5m = mk5m((ha, i) => {
    const low = i <= 1 ? 4950 : 5000;             // one shallow new low, no spike → ambiguous
    return { low, high: low + 100, vol: 500 };
  });
  assert.equal(moveShape(ts5m), 'ambiguous');
  const latest = { low: 4900, high: 4930, lowTime: FRESH, highTime: FRESH };
  const row = rowOf(latest, ts5m);
  assert.equal(row.mom, 'breakdown');
  const be = breakEven(5000);                     // 5103 > 4930 → underwater
  const mv = momVerdict(row, be, 50_000, ts5m, NOW_MS);
  assert.equal(mv.action, 'CUT');
});

// --- 5. Shock shape → SHOCK-WATCH (Gate 2 shock branch) ------------------------------------
ok('small-lot shock (spike then stabilized) → SHOCK-WATCH', () => {
  const ts5m = mk5m((ha, i) => {
    if (ha >= 2) return { low: 5000, high: 5100, vol: 500 };
    let low = 5000, vol = 500;                    // last 24 windows (idxFromEnd 0..23)
    if (i === 4 || i === 5) { low = 4700; vol = 3000; }   // the dump: 2 windows, volume spike
    else if (i <= 3) low = 4700;                  // stabilized at the low since (trough not at the very end)
    return { low, high: low + 200, vol };
  });
  assert.equal(moveShape(ts5m), 'shock');
  const latest = { low: 4650, high: 4720, lowTime: FRESH, highTime: FRESH };
  const row = rowOf(latest, ts5m);
  assert.equal(row.mom, 'breakdown');
  const be = breakEven(5000);                     // 5103 > 4720 → underwater
  const mv = momVerdict(row, be, 50_000, ts5m, NOW_MS);   // small lot, regime intact (ts6h empty)
  assert.equal(mv.action, 'SHOCK_WATCH');
  assert.equal(mv.listAt, be);
});

// --- 6. Clean mom, underwater through a liquid window → CUT-CANDIDATE (D-escalation) -------
ok('clean+underwater through a liquid peak → CUT-CANDIDATE (gate D)', () => {
  const ts5m = mk5m(() => ({ low: 4850, high: 4950, vol: 500 }));  // avgHigh 4950 < break-even for the whole span
  const latest = { low: 4880, high: 4900, lowTime: FRESH, highTime: FRESH };  // inside the band → mom clean
  const row = rowOf(latest, ts5m);
  assert.equal(row.mom, 'clean');
  const be = breakEven(5000);                     // 5103 > 4900 → underwater
  const mv = momVerdict(row, be, 50_000, ts5m, NOW_MS);
  assert.equal(mv.action, 'CUT');
  assert.equal(mv.verdict, 'CUT-CANDIDATE');
  assert.equal(mv.gate, 'D');
});

// --- 7. Missing instabuy → NO-READ (never CUT) --------------------------------------------
ok('missing instabuy → NO-READ (never CUT)', () => {
  const ts5m = mk5m(() => ({ low: 990, high: 1010, vol: 500 }));
  const latest = { low: 980, high: null, lowTime: FRESH, highTime: FRESH };
  const row = rowOf(latest, ts5m);
  assert.equal(row.reliableReason, 'no-quote');
  const mv = momVerdict(row, breakEven(1200), 5000, ts5m, NOW_MS);
  assert.equal(mv.action, 'NO_READ');
});

// --- 7b. Feed inversion (crossed live feed) → NO-READ, never a decisive verdict (Q1) ------
// Live instasell (low) above the live instabuy (high) — a crossed feed, not a real price.
// Pre-Q1 this row was `reliable:true` (dense, fresh, two-sided band) but `ordered:false`, so
// momVerdict printed a decisive verdict off it (live 2026-07-04: CUT-CANDIDATE under the
// "⚠ feed inversion" footnote). Post-Q1 it must gate to NO-READ.
ok('feed inversion (instasell > instabuy) → NO-READ (never a decisive verdict)', () => {
  const ts5m = mk5m(() => ({ low: 990, high: 1010, vol: 500 }));   // healthy dense two-sided band
  const latest = { low: 1020, high: 1000, lowTime: FRESH, highTime: FRESH }; // CROSSED: instasell 1020 > instabuy 1000
  const row = rowOf(latest, ts5m);
  assert.equal(row.ordered, false, 'a crossed feed fails the ordering invariant');
  assert.equal(row.reliable, false, 'inversion is folded into the single reliability signal');
  assert.equal(row.reliableReason, 'feed-inversion');
  const be = breakEven(1100);                     // 1123 > instabuy 1000 → underwater (would have cut pre-Q1)
  const mv = momVerdict(row, be, 5000, ts5m, NOW_MS);
  assert.equal(mv.action, 'NO_READ');
  assert.equal(mv.verdict, 'NO-READ');
  assert.equal(mv.gate, 0);
  assert.notEqual(mv.action, 'CUT');
  assert.ok(mv.why.includes('feed-inversion'));
});

// --- 8. quoteOrdered invariant untouched, clean reliable row returns null verdict ----------
ok('quoteOrdered invariant holds + reliable clean not-underwater → null verdict', () => {
  const ts5m = mk5m(() => ({ low: 995, high: 1005, vol: 500 }));
  const latest = { low: 1000, high: 1002, lowTime: FRESH, highTime: FRESH };
  const row = rowOf(latest, ts5m);
  assert.equal(row.reliable, true);
  assert.equal(row.ordered, true);
  assert.equal(quoteOrdered(row), true);
  const be = breakEven(900);                      // 919 < instabuy 1002 → NOT underwater
  assert.equal(momVerdict(row, be, 5000, ts5m, NOW_MS), null);
});

console.log(`\nAll ${pass} PLAN-3 acceptance checks passed.`);
