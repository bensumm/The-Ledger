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
import { isOvernightNow, overnightStaleRisk, OVERNIGHT_START_HOUR, OVERNIGHT_END_HOUR } from '../js/quotecore.js';   // S2 posture helpers
import { regimeLabel, momCell, MOM_STRONG_PCT } from '../js/quotecore.js';   // TD3 derivation/display helpers

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

// ============================================================================================
// S2 POSTURE FIXTURES (overnight vs active) — appended block, independent of the momVerdict tree
// above. Exercises the new pure helpers isOvernightNow / overnightStaleRisk only.
// ============================================================================================
console.log('\nS2 posture acceptance:');

// --- 9. isOvernightNow honors the local overnight window ----------------------------------
ok('isOvernightNow: inside window true, daytime false, boundaries correct', () => {
  const atHour = h => new Date(2026, 0, 15, h, 0, 0).getTime();   // local wall-clock h:00
  assert.equal(isOvernightNow(atHour(23)), true);                 // deep overnight
  assert.equal(isOvernightNow(atHour(2)), true);                  // small hours
  assert.equal(isOvernightNow(atHour(12)), false);               // midday
  assert.equal(isOvernightNow(atHour(OVERNIGHT_START_HOUR)), true);      // 22:00 inclusive
  assert.equal(isOvernightNow(atHour(OVERNIGHT_END_HOUR)), false);       // 06:00 exclusive
  assert.equal(isOvernightNow(atHour(OVERNIGHT_END_HOUR - 1)), true);    // 05:00 still overnight
});

// --- 10. overnightStaleRisk flags a bid the last overnight window printed below ------------
// yesterday's forward-8h overnight span is the [now-24h, now-16h] slice (ha ∈ [16,24)).
function nightSeries(yesterdayOvernightLow) {
  return mk5m((ha) => {
    const low = (ha >= 16 && ha < 24) ? yesterdayOvernightLow : 1000;   // set only the yesterday-overnight window
    return { low, high: low + 20, vol: 500 };
  });
}
ok('overnightStaleRisk: yesterday overnight dipped below the bid → true', () => {
  const ts5m = nightSeries(900);                    // 900 ≤ 1000×(1-0.03)=970 → risk
  assert.equal(overnightStaleRisk(ts5m, 1000, NOW_MS), true);
});
ok('overnightStaleRisk: yesterday overnight held above the bid → false', () => {
  const ts5m = nightSeries(1000);                   // never below the bid overnight
  assert.equal(overnightStaleRisk(ts5m, 1000, NOW_MS), false);
});
ok('overnightStaleRisk: positive-evidence discipline (null bid / short series → false)', () => {
  assert.equal(overnightStaleRisk(nightSeries(900), null, NOW_MS), false);   // no bid to test
  const shortSeries = mk5m(() => ({ low: 900, high: 920, vol: 500 }), 1);    // <24 points
  assert.equal(overnightStaleRisk(shortSeries, 1000, NOW_MS), false);
});

// ============================================================================================
// BE1 BREAK-EVEN FIXTURES — breakEven(buy) = smallest integer sell price s with s - tax(s) ≥ buy,
// piecewise-consistent with format.js tax() across its THREE regions (exempt / uncapped / capped).
// A local brute-force reference (independent of the implementation) proves smallest-s correctness
// at every region boundary; explicit expected values pin the named cases.
// ============================================================================================
console.log('\nBE1 break-even acceptance:');
const TAXCAP = 5_000_000;
const taxRef = p => (!p || p < 50) ? 0 : Math.min(Math.floor(p * 0.02), TAXCAP);   // mirror format.js tax()
// smallest integer s ≥ 0 with s - taxRef(s) ≥ buy, by linear scan up from max(0,buy) (net ≤ s)
const bruteMin = buy => { for (let s = Math.max(0, buy); ; s++) if (s - taxRef(s) >= buy) return s; };

// --- 11. Three named regions hit their exact expected values ------------------------------
ok('breakEven: three regions (exempt / uncapped / capped) exact values', () => {
  assert.equal(breakEven(40), 40);                          // exempt: sell <50gp is tax-free → s = buy
  assert.equal(breakEven(49), 49);
  assert.equal(breakEven(18_052_000), Math.ceil(18_052_000 / 0.98));  // uncapped: unchanged legacy ceil (no-op)
  assert.equal(breakEven(1_633_000_000), 1_638_000_000);    // capped: 1.633b bow → buy+5m (was 1.666b uncapped — 28m too high)
  assert.equal(breakEven(300_000_000), 305_000_000);        // capped: buy+TAXCAP
});

// --- 12. Every result is VALID (nets ≥ buy) and, in the exempt+capped regions, truly minimal --
ok('breakEven: brute-force smallest-s at every region boundary', () => {
  const inExemptOrCapped = buy => buy < 50 || buy > TAXCAP / 0.02 - TAXCAP;   // 250m−5m = 245m crossover
  const sample = [];
  for (let b = 0; b <= 120; b++) sample.push(b);                              // exempt→uncapped boundary (50)
  for (let b = 244_999_990; b <= 245_000_010; b++) sample.push(b);            // uncapped→capped boundary (245m)
  sample.push(250_000_000, 400_000_000, 1_000_000_000, 5_000_000_000);        // deep capped
  for (const buy of sample) {
    const be = breakEven(buy);
    assert.ok(be - taxRef(be) >= buy, `breakEven(${buy})=${be} must net ≥ buy`);   // always valid (never lists below true BE)
    if (inExemptOrCapped(buy)) assert.equal(be, bruteMin(buy), `breakEven(${buy}) must be the smallest valid s`);
    else assert.ok(be >= bruteMin(buy), `breakEven(${buy}) must not undershoot true min`);  // uncapped ceil: valid, may +1
  }
  // the exact crossover: last uncapped value stays ceil, first capped value flips to buy+TAXCAP
  assert.equal(breakEven(245_000_000), Math.ceil(245_000_000 / 0.98));         // 250,000,000 (uncapped branch)
  assert.equal(breakEven(245_000_001), 250_000_001);                           // capped branch = brute min
  assert.equal(bruteMin(245_000_001), 250_000_001);
});

// ============================================================================================
// TD3.1 — computeQuote DERIVATION + display helpers (ordering clamp, mom, falling cap, labels).
// Pins the row-model derivation the app tables + scripts all read, independent of the momVerdict
// tree above. Synthetic 5m/6h series only.
//   BUSINESS REQUIREMENTS pinned here:
//     - The optimistic edges are CLAMPED so optBuy ≤ quickBuy ≤ quickSell ≤ optSell ALWAYS holds —
//       the direct guard on the 2026-07-03 base-mixing incident (opt can never cross quick).
//     - `mom` is derived from the PRE-clamp live-vs-band comparison: instasell below the 2h floor →
//       'breakdown'; instabuy above the 2h top → 'breakup'; in-band → 'clean' (survives even when
//       the display clamp annihilates the opt price).
//     - A falling regime caps optSell at the live instabuy — never price a sell above a dropping
//       market (the 0.20.0 price-to-clear rule).
//     - regimeLabel flips at ±5% drift (falling ≤ −5, rising ≥ +5, else flat; unknown when !ok).
//     - momCell renders a strong (double) arrow at/above MOM_STRONG_PCT past the band edge, a single
//       arrow below it; clean → a muted en-dash.
// ============================================================================================
console.log('\nTD3.1 computeQuote derivation + display:');

// a flat band of [lo, hi] over 24×5m windows (ts6h empty → regime unknown, falling=false)
const bandRow = (latest, lo, hi, opts = {}) => rowOf(latest, mk5m(() => ({ low: lo, high: hi, vol: 500 })), opts);

// 6h series whose recent-3d median vs prior-3-to-17d median sets the regime drift (falling/rising).
function mk6h(recentMid, priorMid, days = 18) {
  const pts = [], n = days * 4, tEnd = NOW_SEC - 6 * 3600, recentCut = tEnd - 3 * 86400;
  for (let k = n; k >= 1; k--) {
    const ts = NOW_SEC - k * 6 * 3600, m = ts >= recentCut ? recentMid : priorMid;
    pts.push({ timestamp: ts, avgLowPrice: m - 5, avgHighPrice: m + 5 });
  }
  return pts;
}

// --- TD3.1a. ordering clamp holds — both a normal wide band and a pathological inside-spread band
ok('ordering clamp: optBuy ≤ quickBuy ≤ quickSell ≤ optSell (base-mixing guard)', () => {
  const latest = { low: 1000, high: 1010, lowTime: FRESH, highTime: FRESH };
  const wide = bandRow(latest, 990, 1020);                 // band wider than the live spread
  assert.ok(wide.optBuy <= wide.quickBuy && wide.quickBuy <= wide.quickSell && wide.quickSell <= wide.optSell);
  assert.equal(quoteOrdered(wide), true);
  assert.equal(wide.optBuy, 990); assert.equal(wide.optSell, 1020);
  // pathological: the 2h band sits ENTIRELY inside the live spread — the clamp must stop opt crossing
  const inside = bandRow(latest, 1003, 1007);
  assert.equal(quoteOrdered(inside), true);
  assert.equal(inside.optBuy, 1000, 'optBuy clamped up to quickBuy, never above it');
  assert.equal(inside.optSell, 1010, 'optSell clamped down to quickSell, never below it');
});

// --- TD3.1b. mom derives from the PRE-clamp comparison (breakdown / breakup / clean)
ok('mom: pre-clamp live-vs-band → breakdown / breakup / clean (survives the clamp)', () => {
  // breakdown: instasell 980 below the 2h floor 990 — the opt display is annihilated (optBuy==quickBuy)
  const bd = bandRow({ low: 980, high: 1010, lowTime: FRESH, highTime: FRESH }, 990, 1020);
  assert.equal(bd.mom, 'breakdown');
  assert.equal(bd.optBuy, bd.quickBuy, 'clamp collapses optBuy onto quickBuy, yet mom is still breakdown');
  assert.ok(Math.abs(bd.momPct - (990 - 980) / 990) < 1e-9);
  // breakup: instabuy 1030 above the 2h top 1020
  const bu = bandRow({ low: 1000, high: 1030, lowTime: FRESH, highTime: FRESH }, 990, 1020);
  assert.equal(bu.mom, 'breakup');
  assert.equal(bu.optSell, bu.quickSell, 'clamp collapses optSell onto quickSell, yet mom is still breakup');
  // clean: both live prices inside the band
  const cl = bandRow({ low: 1000, high: 1010, lowTime: FRESH, highTime: FRESH }, 990, 1020);
  assert.equal(cl.mom, 'clean');
  assert.equal(cl.momPct, 0);
});

// --- TD3.1c. falling regime caps optSell at the live instabuy (0.20.0 price-to-clear)
ok('falling regime caps optSell at the live instabuy (never price above a dropping market)', () => {
  const latest = { low: 1000, high: 1010, lowTime: FRESH, highTime: FRESH };
  const flat = bandRow(latest, 990, 1050);                                  // ts6h empty → not falling
  assert.equal(flat.falling, false);
  assert.equal(flat.optSell, 1050, 'without a falling regime, optSell reaches the 2h top');
  const falling = bandRow(latest, 990, 1050, { ts6h: mk6h(900, 1000) });    // recent 900 vs prior 1000 = −10%
  assert.equal(falling.regimeLabel, 'falling');
  assert.equal(falling.falling, true);
  assert.equal(falling.optSell, 1010, 'falling caps optSell at the live instabuy, not the 2h top');
});

// --- TD3.1d. regimeLabel flips at ±5%
ok('regimeLabel: falling ≤ −5%, rising ≥ +5%, else flat; unknown when !ok', () => {
  assert.deepEqual(regimeLabel({ ok: true, driftPct: -5 }), { label: 'falling', falling: true, rising: false });
  assert.equal(regimeLabel({ ok: true, driftPct: -4.99 }).label, 'flat');
  assert.equal(regimeLabel({ ok: true, driftPct: 0 }).label, 'flat');
  assert.equal(regimeLabel({ ok: true, driftPct: 4.99 }).label, 'flat');
  assert.deepEqual(regimeLabel({ ok: true, driftPct: 5 }), { label: 'rising', falling: false, rising: true });
  assert.equal(regimeLabel({ ok: false }).label, 'unknown');
  assert.equal(regimeLabel(null).label, 'unknown');
});

// --- TD3.1e. momCell strength arrows at MOM_STRONG_PCT
ok('momCell: strong (double) arrow at/above MOM_STRONG_PCT, single arrow below, muted when clean', () => {
  assert.deepEqual(momCell('breakdown', MOM_STRONG_PCT), { sym: '↓↓', cls: 'loss' });
  assert.deepEqual(momCell('breakdown', MOM_STRONG_PCT - 0.0001), { sym: '↓', cls: 'amber' });
  assert.deepEqual(momCell('breakdown', 0), { sym: '↓', cls: 'amber' });
  assert.deepEqual(momCell('breakup', MOM_STRONG_PCT), { sym: '↑↑', cls: 'gain' });
  assert.deepEqual(momCell('breakup', MOM_STRONG_PCT - 0.0001), { sym: '↑', cls: 'amber' });
  assert.deepEqual(momCell('clean', 0), { sym: '–', cls: 'mommuted' });
});

console.log(`\nAll ${pass} acceptance checks passed.`);
