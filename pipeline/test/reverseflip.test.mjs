#!/usr/bin/env node
/**
 * reverseflip.test.mjs — acceptance fixtures for the PURE reverse-flip niche math (js/reverseflip.mjs,
 * PLAN-REVERSE-FLIP chunk RF1). Gate/edge are DOM-free + fetch-free + fs-free, so they're fixture-testable
 * with synthetic inputs — NO live data (CLAUDE.md rule 4). TZ-hermetic (no Date/timezone use here).
 *
 * BUSINESS REQUIREMENTS pinned here (the INVERTED regime read + the rebuy-leg-binding liquidity rule):
 *   - the regime mapping, off the REAL classifyTrajectory 7-value enum: rising→reject, elevated→reject,
 *     oscillating→pass, based→pass, flat→pass, and — THE ANTI-REGRESSION PIN — knife→pass (knife IS the
 *     "falling" case the strategy wants; the old `falling`/`cooling` vocab bug would have matched nothing).
 *   - unknown / missing / unrecognized shape → caution (degrade, never throw).
 *   - beRebuy = sellRef − tax(sellRef) via the CANONICAL money-math.js tax() (57m → tax 1.14m → 55.86m).
 *   - liquidity asymmetry: a thin SELL leg (rebuy leg OK) → caution-NOT-reject; a thin REBUY leg → reject.
 * Run: `node pipeline/test/reverseflip.test.mjs` (exits non-zero on any failure). Auto-discovered.
 */
import assert from 'node:assert/strict';
import { tax } from '../../js/money-math.js';
import {
  invertedRegimeGate, reverseFlipEdge, reverseFlipGate,
  REVERSE_MIN_SWING_PCT, REVERSE_MIN_LEG_VOL,
  // RF6 — thin big-ticket predicate + display-guard helpers
  isThinBigTicket, reverseListBand, reverseListBandCell, askSpreadFlag, askSpreadNote, rebuyStrandNote,
  THIN_VOL_FLOOR, SPREAD_MATERIAL_PCT, SPREAD_RARE_FRAC,
} from '../../js/reverseflip.mjs';
import { BIG_TICKET_GP } from '../../js/quotecore.js';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

console.log('reverseflip.mjs:');

// --- invertedRegimeGate — the FIXED Regime-asymmetry table over the real 7-value enum ----------------
ok('rising → reject (sell now, rebuy at a HIGHER floor tomorrow — loses by construction)', () => {
  const g = invertedRegimeGate('rising');
  assert.equal(g.decision, 'reject');
  assert.equal(g.reason, 'regime-rising');
});

ok('elevated → reject (top of range — same buy-back-higher risk as rising)', () => {
  const g = invertedRegimeGate('elevated');
  assert.equal(g.decision, 'reject');
  assert.equal(g.reason, 'regime-elevated');
});

ok('ANTI-REGRESSION: knife → pass (knife IS the "falling" case — sell high, rebuy lower)', () => {
  // The load-bearing pin: classifyTrajectory NEVER emits `falling`/`cooling`; `knife` is the monotone-
  // decline analog. The old draft's `case 'falling'` would have matched nothing and silently never passed.
  const g = invertedRegimeGate('knife');
  assert.equal(g.decision, 'pass', 'knife MUST pass — it is the falling-case the reverse-flip harvests');
  assert.equal(g.reason, null);
});

ok('oscillating → pass (the ideal repeatable peak→dip lap)', () => {
  assert.equal(invertedRegimeGate('oscillating').decision, 'pass');
});

ok('based → pass (a value-low floor — harvestable)', () => {
  assert.equal(invertedRegimeGate('based').decision, 'pass');
});

ok('flat → pass (neutral — no clear lap but not disqualifying)', () => {
  const g = invertedRegimeGate('flat');
  assert.equal(g.decision, 'pass');
  assert.equal(g.reason, null);
});

ok('unknown / short-data → caution (degrade, no throw)', () => {
  assert.equal(invertedRegimeGate('unknown').decision, 'caution');
  assert.equal(invertedRegimeGate('unknown').reason, 'regime-unknown');
});

ok('missing / unrecognized trajectory → caution, never throws', () => {
  assert.equal(invertedRegimeGate(null).decision, 'caution');
  assert.equal(invertedRegimeGate(null).reason, 'no-trajectory');
  assert.equal(invertedRegimeGate(undefined).decision, 'caution');
  assert.equal(invertedRegimeGate('cooling').decision, 'caution', 'a bogus/legacy shape degrades, not throws');
  assert.equal(invertedRegimeGate('cooling').reason, 'regime-unrecognized');
});

ok('accepts a classifyTrajectory RESULT object ({shape,...}), not just a bare string', () => {
  assert.equal(invertedRegimeGate({ shape: 'knife', evidence: {} }).decision, 'pass');
  assert.equal(invertedRegimeGate({ shape: 'rising', evidence: {} }).decision, 'reject');
});

// --- reverseFlipEdge — beRebuy uses the REAL tax(), the swing measure, the amplitude-floor flag --------
ok('beRebuy = sellRef − tax(sellRef) via the canonical tax() (57m → 1.14m tax → 55.86m)', () => {
  const e = reverseFlipEdge({ sellRef: 57_000_000 });
  assert.equal(e.hasData, true);
  assert.equal(tax(57_000_000), 1_140_000, 'canonical tax = floor(2%), uncapped here');
  assert.equal(e.beRebuy, 55_860_000, 'beRebuy is sellRef − real tax, NOT a ×0.98 approximation');
});

ok('the 5m tax CAP flows through beRebuy (a 400m sell caps tax at 5m, not 8m)', () => {
  const e = reverseFlipEdge({ sellRef: 400_000_000 });
  assert.equal(tax(400_000_000), 5_000_000, 'tax capped at 5m');
  assert.equal(e.beRebuy, 395_000_000, 'beRebuy honors the cap (not 392m)');
});

ok('swingPct derives from rebuyRef, and the amplitude floor flags correctly', () => {
  const met = reverseFlipEdge({ sellRef: 57_000_000, rebuyRef: 53_500_000 });   // ~6.1% swing
  assert.ok(met.swingPct > REVERSE_MIN_SWING_PCT, `swing ${met.swingPct} clears floor ${REVERSE_MIN_SWING_PCT}`);
  assert.equal(met.amplitudeFloorMet, true);
  const thin = reverseFlipEdge({ sellRef: 57_000_000, rebuyRef: 56_500_000 });  // ~0.9% swing
  assert.ok(thin.swingPct < REVERSE_MIN_SWING_PCT);
  assert.equal(thin.amplitudeFloorMet, false);
});

ok('a directly-supplied swingPct wins over a derived one; a null swing is unknown, not "unmet"', () => {
  assert.equal(reverseFlipEdge({ sellRef: 57_000_000, rebuyRef: 56_900_000, swingPct: 0.10 }).amplitudeFloorMet, true);
  const noSwing = reverseFlipEdge({ sellRef: 57_000_000 });   // no rebuyRef, no swingPct
  assert.equal(noSwing.swingPct, null);
  assert.equal(noSwing.amplitudeFloorMet, false, 'null swing ⇒ floor NOT met, but the gate treats it as no-signal');
});

ok('missing/invalid sellRef → { hasData:false } (degrade, never throw)', () => {
  assert.equal(reverseFlipEdge({}).hasData, false);
  assert.equal(reverseFlipEdge({ sellRef: 0 }).hasData, false);
  assert.equal(reverseFlipEdge({ sellRef: -5 }).hasData, false);
  assert.equal(reverseFlipEdge().hasData, false);
});

// --- reverseFlipGate — composition + the REBUY-LEG-BINDING liquidity asymmetry ------------------------
const LIQUID = REVERSE_MIN_LEG_VOL * 5;    // comfortably above the thin floor
const THIN = REVERSE_MIN_LEG_VOL - 1;      // below the thin floor

ok('a harvestable regime + adequate swing + both legs liquid → PASS', () => {
  const g = reverseFlipGate({
    trajectory: 'oscillating', sellRef: 57_000_000, rebuyRef: 53_500_000,
    sellLegVol: LIQUID, rebuyLegVol: LIQUID,
  });
  assert.equal(g.decision, 'pass', `expected pass, got ${g.decision} (${g.reasons.join(',')})`);
  assert.deepEqual(g.reasons, []);
});

ok('a rising regime hard-rejects regardless of swing/liquidity (loses by construction)', () => {
  const g = reverseFlipGate({
    trajectory: 'rising', sellRef: 57_000_000, rebuyRef: 53_500_000,
    sellLegVol: LIQUID, rebuyLegVol: LIQUID,
  });
  assert.equal(g.decision, 'reject');
  assert.deepEqual(g.reasons, ['regime-rising']);
});

ok('THIN SELL leg (rebuy leg OK) → CAUTION-not-reject (live demand clears the sell — Anchor incident)', () => {
  const g = reverseFlipGate({
    trajectory: 'knife', sellRef: 57_000_000, rebuyRef: 53_500_000,
    sellLegVol: THIN, rebuyLegVol: LIQUID,
  });
  assert.equal(g.decision, 'caution', 'a thin sell leg must NOT reject — it degrades to caution');
  assert.ok(g.reasons.includes('sell-leg-thin'));
  assert.ok(!g.reasons.includes('rebuy-leg-thin'));
});

ok('THIN REBUY leg → REJECT (the rebuy leg is the binding constraint)', () => {
  const g = reverseFlipGate({
    trajectory: 'knife', sellRef: 57_000_000, rebuyRef: 53_500_000,
    sellLegVol: LIQUID, rebuyLegVol: THIN,
  });
  assert.equal(g.decision, 'reject', 'a thin rebuy leg is a real risk → reject');
  assert.ok(g.reasons.includes('rebuy-leg-thin'));
});

ok('a KNOWN sub-floor swing → caution (no worthwhile lap), never a hard reject on a wanted item', () => {
  const g = reverseFlipGate({
    trajectory: 'oscillating', sellRef: 57_000_000, rebuyRef: 56_500_000,   // ~0.9% swing < floor
    sellLegVol: LIQUID, rebuyLegVol: LIQUID,
  });
  assert.equal(g.decision, 'caution');
  assert.ok(g.reasons.includes('swing-below-floor'));
});

ok('an UNKNOWN rebuy leg degrades to caution (the binding leg can not be confirmed)', () => {
  const g = reverseFlipGate({
    trajectory: 'oscillating', sellRef: 57_000_000, rebuyRef: 53_500_000, sellLegVol: LIQUID,
    // rebuyLegVol omitted
  });
  assert.equal(g.decision, 'caution');
  assert.ok(g.reasons.includes('rebuy-liquidity-unknown'));
});

ok('never throws on an empty ctx (fully degraded) — caution, structured decision', () => {
  const g = reverseFlipGate({});
  assert.equal(g.decision, 'caution');
  assert.equal(g.edge.hasData, false);
  assert.equal(g.regime.decision, 'caution');
});

// --- RF6 — isThinBigTicket predicate (the ONE switch every thin-item display guard reads) -------------
// A synthetic computeQuote `row` carries only the fields the predicate reads: guide + volDay.
const rowOf = (guide, volDay) => ({ guide, volDay });

ok('isThinBigTicket: a THIN big-ticket (guide 30m, 135/d) → true', () => {
  assert.equal(isThinBigTicket(rowOf(30_000_000, 135)), true);
});

ok('isThinBigTicket: a LIQUID big-ticket (guide 20m, thousands/d) → false (fails the liquidity-thin AND)', () => {
  assert.equal(isThinBigTicket(rowOf(20_000_000, 5000)), false, `THIN_VOL_FLOOR=${THIN_VOL_FLOOR}: 5000/d is not thin`);
});

ok('isThinBigTicket: a THIN CHEAP item (guide 1m, 50/d) → false (not big-ticket)', () => {
  assert.ok(1_000_000 < BIG_TICKET_GP, 'guard sanity: 1m is under the 10m big-ticket line');
  assert.equal(isThinBigTicket(rowOf(1_000_000, 50)), false);
});

ok('isThinBigTicket: the tranche override — a big-ticket item clearing ≤2 units is thin even if vol is unknown', () => {
  assert.equal(isThinBigTicket(rowOf(30_000_000, null), { tranche: 1 }), true);
  assert.equal(isThinBigTicket(rowOf(30_000_000, null)), false, 'no tranche, no vol ⇒ degrade to NOT thin (conservative)');
});

ok('isThinBigTicket: null/garbage row → false, never throws', () => {
  assert.equal(isThinBigTicket(null), false);
  assert.equal(isThinBigTicket({}), false);
  assert.equal(isThinBigTicket(rowOf(null, 50)), false);
});

// --- RF6 — reverseListBand / reverseListBandCell (RANGE-not-a-point; byte-identical degrade) ----------
ok('reverseListBand: a real reachable band → {lo,hi,center} bracketing sellRef', () => {
  const b = reverseListBand(57_000_000, { baseHigh: 55_000_000, ask: 58_000_000 });
  assert.equal(b.center, 57_000_000);
  assert.equal(b.lo, 55_000_000);
  assert.equal(b.hi, 58_000_000);
});

ok('reverseListBand: widens to CONTAIN sellRef when it falls outside the reachable band', () => {
  const b = reverseListBand(59_000_000, { baseHigh: 55_000_000, ask: 58_000_000 });
  assert.equal(b.lo, 55_000_000);
  assert.equal(b.hi, 59_000_000, 'sellRef above the band top widens hi');
});

ok('reverseListBand: no reachable band, or degenerate → null (caller keeps the single number)', () => {
  assert.equal(reverseListBand(57_000_000, null), null);
  assert.equal(reverseListBand(57_000_000, {}), null);
  assert.equal(reverseListBand(null, { baseHigh: 55_000_000, ask: 58_000_000 }), null);
});

ok('reverseListBandCell BYTE-IDENTICAL degrade: no band ⇒ the exact single-number render the table uses', () => {
  // The pre-RF6 cell is `fmtP(e.sellRef)`; with no reachable band the cell helper must reproduce it verbatim.
  const fmtP = n => `${(n / 1e6).toFixed(2)}m`;
  assert.equal(reverseListBandCell(57_000_000, null, { fmt: fmtP }), fmtP(57_000_000));
  assert.equal(reverseListBandCell(57_000_000, {}, { fmt: fmtP }), '57.00m');
  // and WITH a band → the range form
  assert.equal(reverseListBandCell(57_000_000, { baseHigh: 55_000_000, ask: 58_000_000 }, { fmt: fmtP }), '~55.00m–58.00m');
});

// --- RF6 — askSpreadFlag / askSpreadNote (traded-mid vs standing-ask; thin-only) -----------------------
ok('askSpreadFlag: a lone ask materially above the guide AND rarely reached → fires', () => {
  const flag = askSpreadFlag({ guide: 55_000_000, askLevel: 58_000_000, reachedDays: 2, nDays: 14 });   // +5.5%, 2/14≈0.14
  assert.ok(flag, 'expected the flag to fire');
  assert.ok(flag.abovePct >= SPREAD_MATERIAL_PCT);
  assert.ok(flag.frac <= SPREAD_RARE_FRAC);
  assert.equal(askSpreadNote(flag, { fmt: n => `${(n / 1e6).toFixed(1)}m` }), 'trades ~55.0m; lone asks to 58.0m, reached 2/14d');
});

ok('askSpreadFlag: an ask reached OFTEN (frequently traded) → null (not a lone ask)', () => {
  assert.equal(askSpreadFlag({ guide: 55_000_000, askLevel: 58_000_000, reachedDays: 12, nDays: 14 }), null);
});

ok('askSpreadFlag: an ask NOT materially above the guide → null', () => {
  assert.equal(askSpreadFlag({ guide: 55_000_000, askLevel: 55_500_000, reachedDays: 1, nDays: 14 }), null);   // +0.9% < floor
});

ok('askSpreadNote(null) → null; askSpreadFlag degrades on missing data, never throws', () => {
  assert.equal(askSpreadNote(null), null);
  assert.equal(askSpreadFlag({}), null);
  assert.equal(askSpreadFlag({ guide: 55_000_000, askLevel: 58_000_000, reachedDays: null, nDays: null }), null);
});

// --- RF6 — rebuyStrandNote (the reverse-flip-specific rebuy-reliability caution) -----------------------
ok('rebuyStrandNote: carries the vol/d; degrades to "thin book" when vol is unknown', () => {
  assert.equal(rebuyStrandNote({ volDay: 135, fmt: String }), '⚠ rebuy may strand (thin, 135/d)');
  assert.equal(rebuyStrandNote({ volDay: null }), '⚠ rebuy may strand (thin, thin book)');
});

console.log(`\nreverseflip.mjs: ${pass} assertions passed.`);
