/* thesisframe.test.mjs — PLAN-THESIS-FRAME acceptance fixtures (TF1 + TF3, plus the TF2 digest
 * grouping). TF2's quote-items adjacency is pinned in-situ by the ordering assertions here against
 * the note-push contract; the digest grouping is pinned against buildDigestBlock directly (the
 * digest is THE decision surface — owner, 2026-09-09 — so it gets the fixture first).
 */
import assert from 'node:assert/strict';
import { pathDeclGate } from '../commands/declare-thesis.mjs';
import { parseHorizonDate } from '../lib/thesis/holdthesis.mjs';
import { thesisUntil, machineryShort, expiredPlanWrap, heldDisplay, renderHeldVerdict } from '../lib/market/item-context.mjs';
import { buildDigestBlock } from '../commands/screen-flip-niches.mjs';

let pass = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}`); throw e; } };

// a local-noon ms for a given local calendar date (keeps every assertion timezone-independent)
const noon = (y, m, d) => new Date(y, m - 1, d, 12).getTime();
const rowOf = o => ({ quickBuy: null, quickSell: null, optBuy: null, optSell: null,
  rawBandLo: null, rawBandHi: null, falling: false, rising: false, ...o });

/* ============================== TF1 — pathDeclGate ============================== */

ok('TF1: a path declaration with no failure condition is REFUSED', () => {
  const g = pathDeclGate({ tripwire: null, horizon: null, noTripwire: false });
  assert.equal(g.ok, false);
  assert.match(g.reason, /DECLARED BUT NON-GATING/);
  assert.match(g.reason, /--tripwire|--until|--no-tripwire/, 'the refusal names every remedy');
});
ok('TF1: a numeric tripwire satisfies the gate', () =>
  assert.equal(pathDeclGate({ tripwire: 33_000_000 }).ok, true));
ok('TF1: an explicit --no-tripwire override satisfies the gate (deliberate frame-only intent)', () =>
  assert.equal(pathDeclGate({ noTripwire: true }).ok, true));
ok('TF1: a DATE horizon satisfies the gate; legacy free text does NOT (it is not a failure condition)', () => {
  assert.equal(pathDeclGate({ horizon: '2026-09-13' }).ok, true);
  assert.equal(pathDeclGate({ horizon: 'multi-day' }).ok, false);
});

/* ============================== TF3 — parseHorizonDate ============================== */

ok('parseHorizonDate: real date parses to LOCAL midnight; free text / junk / impossible dates → null', () => {
  const d = parseHorizonDate('2026-09-13');
  assert.equal(d.getFullYear(), 2026); assert.equal(d.getMonth(), 8); assert.equal(d.getDate(), 13);
  assert.equal(d.getHours(), 0, 'local midnight, not UTC');
  assert.equal(parseHorizonDate('multi-day'), null);
  assert.equal(parseHorizonDate('2026-02-31'), null, 'impossible dates rejected by round-trip');
  assert.equal(parseHorizonDate(null), null);
  assert.equal(parseHorizonDate(20260913), null);
});

/* ============================== TF3 — thesisUntil ============================== */

const CROSSBOW = { id: 11785, exitPrice: 36_250_000, tripwire: 33_000_000,
  horizon: '2026-09-13', window: null, path: 'wpc-weekly-cycle', enteredUnder: 'wpc-weekly-cycle',
  ts: Math.floor(noon(2026, 9, 9) / 1000) };

ok('thesisUntil: day k/n counts local days inclusively from the declaration (day 1 = declared day)', () => {
  const tu = thesisUntil(CROSSBOW, noon(2026, 9, 9));
  assert.equal(tu.expired, false);
  assert.equal(tu.dayBit, ' · day 1/5');
  assert.match(tu.untilBit, /^ · until \S+ 09-13$/);
  assert.equal(thesisUntil(CROSSBOW, noon(2026, 9, 12)).dayBit, ' · day 4/5');
});
ok('thesisUntil: EOD semantics — live THROUGH its date, expired only after it', () => {
  assert.equal(thesisUntil(CROSSBOW, noon(2026, 9, 13)).expired, false, 'the plan is live ON its failure date');
  assert.equal(thesisUntil(CROSSBOW, noon(2026, 9, 14)).expired, true);
});
ok('thesisUntil: legacy free-text horizon → null (no date frame, no expiry)', () =>
  assert.equal(thesisUntil({ ...CROSSBOW, horizon: 'multi-day' }, noon(2026, 9, 9)), null));

/* ============================== TF3 — machineryShort ============================== */

ok('machineryShort: HOLD-family reads agree → null (no parens noise)', () => {
  assert.equal(machineryShort(rowOf({ quickSell: 34_000_000 }), 33_000_000,
    { action: 'HOLD_STRONG', verdict: 'HOLD' }), null);
  assert.equal(machineryShort(rowOf({ quickSell: 34_000_000 }), 33_000_000, null), null, 'mv-null HOLD agrees');
});
ok('machineryShort: a bare mv-null UNDERWATER is SUPPRESSED — being underwater IS the plan', () =>
  assert.equal(machineryShort(rowOf({ quickSell: 32_000_000 }), 33_000_000, null), null));
ok('machineryShort: mv-null FALLING shows (informative disagreement)', () =>
  assert.equal(machineryShort(rowOf({ quickSell: 34_000_000, falling: true }), 33_000_000, null), 'FALLING'));
ok('machineryShort: fired verdicts show with a terse gate reason', () => {
  assert.equal(machineryShort(rowOf({}), 1, { action: 'CLEAR', verdict: 'LIST-TO-CLEAR', gate: 2 }),
    'LIST-TO-CLEAR — 2h breakdown');
  assert.equal(machineryShort(rowOf({}), 1, { action: 'CUT', verdict: 'CUT-CANDIDATE', gate: 'D' }),
    'CUT-CANDIDATE — underwater through a liquid window');
});

/* ============================== TF3 — the frame label (the signed-off mock) ============================== */

ok('MOCK line 1: machinery agrees → the frame alone, with day count and until date', () => {
  const row = rowOf({ quickSell: 34_830_000, optSell: 34_830_000 });
  const d = heldDisplay({ row, be: 34_800_000, mv: null, prior: null, nowMs: noon(2026, 9, 9), thesis: CROSSBOW });
  assert.equal(d.frame, true);
  assert.match(d.label, /^PLAN wpc-weekly-cycle · day 1\/5 · exit 36\.25m · abort < 33m · until \S+ 09-13$/);
  assert.ok(!d.label.includes('machinery:'), 'agreement shows no parens');
});
ok('MOCK line 2: machinery disagrees → shown beside the frame, never hidden', () => {
  const row = rowOf({ quickSell: 34_000_000, mom: 'breakdown' });
  const mv = { action: 'CLEAR', verdict: 'LIST-TO-CLEAR', listAt: 34_000_000, gate: 2 };
  const d = heldDisplay({ row, be: 34_800_000, mv, prior: null, nowMs: noon(2026, 9, 9), thesis: CROSSBOW });
  assert.equal(d.frame, true);
  assert.match(d.label, / \(machinery: LIST-TO-CLEAR — 2h breakdown\)$/);
});
ok('MOCK line 3: past the failure date the frame HARD-LAPSES — machinery back in front, wrapped loudly', () => {
  const row = rowOf({ quickSell: 34_830_000 });
  const d = heldDisplay({ row, be: 34_800_000, mv: null, prior: null, nowMs: noon(2026, 9, 14), thesis: CROSSBOW });
  assert.equal(d.frame, false, 'the frame no longer governs');
  assert.match(d.label, /^PLAN EXPIRED 09-13 \(wpc-weekly-cycle\) — reassess · machinery: /);
  const ctx = { market: { row }, intraday: {}, position: { be: 34_800_000, mv: null, display: d, thesis: CROSSBOW } };
  assert.equal(renderHeldVerdict(ctx, { mode: 'compact' }), d.label);
  assert.match(renderHeldVerdict(ctx, { mode: 'verbose' }), /failure date has passed/);
});
// the display-less renderer wrap reads the REAL clock (renderHeldVerdict has no nowMs seam), so
// these two fixtures use a permanently-past date rather than the CROSSBOW future date.
const LAPSED = { ...CROSSBOW, horizon: '2020-01-02', ts: Math.floor(noon(2020, 1, 1) / 1000) };

ok('EXPIRED reaches the display-less call sites too (renderer-level wrap, full compact text kept)', () => {
  const row = rowOf({ quickSell: 34_830_000, optSell: 35_000_000 });
  const ctx = { market: { row }, intraday: {}, position: { be: 34_800_000, mv: null, thesis: LAPSED } };
  // no display object at all — the pre-VN-1 minimal-ctx shape
  const c = renderHeldVerdict(ctx, { mode: 'compact' });
  assert.match(c, /^PLAN EXPIRED 01-02 \(wpc-weekly-cycle\) — reassess · machinery: HOLD — list @ 35m$/);
});
ok('EXPIRED kills the VN-4 "within plan" annotation — a lapsed plan vouches for nothing', () => {
  const row = rowOf({ quickSell: 34_000_000 });
  const mv = { action: 'CUT', verdict: 'CUT', listAt: 34_000_000, gate: 2 };
  const ctx = { market: { row }, intraday: {}, position: { be: 34_800_000, mv, thesis: LAPSED } };
  const c = renderHeldVerdict(ctx, { mode: 'compact' });
  assert.ok(!c.includes('within plan'), 'no deference from a dead plan');
  assert.match(c, /^PLAN EXPIRED/);
});
ok('an un-dated frame is unchanged in structure (no day/until segments), and expiredPlanWrap is null', () => {
  const th = { ...CROSSBOW, horizon: 'multi-day' };
  const row = rowOf({ quickSell: 34_830_000 });
  const d = heldDisplay({ row, be: 34_800_000, mv: null, prior: null, nowMs: noon(2026, 9, 9), thesis: th });
  assert.equal(d.label, 'PLAN wpc-weekly-cycle · exit 36.25m · abort < 33m');
  assert.equal(expiredPlanWrap(th, 'X', noon(2027, 1, 1)), null, 'free text never expires');
});

/* ============================== TF2 — the digest per-item note grouping ============================== */

const digestRow = (id, name, extra = {}) => ({ id, name, capEff: 1, deployable: 1_000_000, rank: 10 - id,
  reachFrac: null, reachBasis: null, marginTrend: null, phase: null, softBuy: null, grade: 'B',
  verdict: 'fill-now', crossable: true, bigTicket: false, ...extra });

ok('TF2 digest: notes group PER ITEM (◇ dislocation under the item), not in per-kind sections', () => {
  const pool = [digestRow(1, 'Alpha'), digestRow(2, 'Beta'), digestRow(3, 'Gamma')];
  const disloc = (id) => id === 1 ? 'dislocated −7.2% vs trailing 15d mean — herb class …' : null;
  const out = buildDigestBlock(pool, { disloc });
  assert.match(out, /per-item notes \(inform-only, never gates/);
  assert.match(out, /  Alpha:\n    ◇ dislocated −7\.2%/, 'the note sits under its item');
  assert.ok(!out.includes('dislocation (WK4 — class-conditional measured yield, inform-only, never gates):'),
    'the old per-kind section header is gone');
  assert.ok(!/Beta:\n {4}/.test(out), 'items with no notes get no block');
});
ok('TF2 digest: zero notes → no section at all (table unchanged)', () => {
  const out = buildDigestBlock([digestRow(1, 'Alpha')], { disloc: () => null });
  assert.ok(!out.includes('per-item notes'));
});

console.log(`\n✓ thesisframe: ${pass} assertion group(s) passed.`);
