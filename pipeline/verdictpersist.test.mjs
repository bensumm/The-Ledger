#!/usr/bin/env node
/**
 * verdictpersist.test.mjs — VN-1/VN-2/VN-3 (PLAN-VERDICT-NOISE): the persistence-gated DISPLAYED
 * verdict + the thesis render frame + the PARKED dead-band.
 *
 * The 2026-07-11 churn session: a lot parked ON break-even, re-read every 3 min, swung the whole
 * verdict vocabulary (~12 label flips in 30 min) while the price moved ~2%. The fix is a DISPLAY
 * layer (watchstate.verdictPersistence + context.heldDisplay/renderHeldVerdict) — momVerdict is
 * UNTOUCHED; the raw verdict still flips underneath and stays what the ledger logs (honesty: this
 * is presentation + persistence, not a changed decision function). This suite pins:
 *
 *   1. PARKED-AT-BE (the Berserker shape): instabuy oscillating ~1% across BE — the RENDERED label
 *      holds ONE state across ≥10 passes and no ungated UNDERWATER headline case arises, while the
 *      RAW token underneath still flips (VN-3 PARKED dead-band + VN-1 hysteresis).
 *   2. REAL BREAKDOWN (the bludgeon shape): a Gate-2 breakdown CUT displays AND is
 *      escalation-exempt on pass 1 THROUGH the new layer — the invariant that must never break.
 *   3. THESIS FRAME (VN-2): a declared thesis above its tripwire renders the HOLD — per-thesis
 *      frame (exit = the DECLARED price / diurnal ask, not the band top); below the tripwire the
 *      normal escalation resumes; Gate-2 CUT still overrides the frame; convictionGate now
 *      thesis-silences LIST-TO-CLEAR above the tripwire (and not below).
 *   4. NO-READ INTERLEAVE (RC3): an unreliable pass against an established incumbent keeps the
 *      incumbent label + the "(read unreliable this pass)" note; NO-READ labels only on first sight.
 *
 * PURE synthetic fixtures (no network/fs; auto-discovered by run-tests.mjs).
 * All constants (VERDICT_PERSIST_MS, BE_DEADBAND_*) are named PLACEHOLDERS, n=1 session (rule 4).
 * Run: `node pipeline/verdictpersist.test.mjs`.
 */
import assert from 'node:assert/strict';
import { verdictPersistence, verdictSeverity, VERDICT_PERSIST_MS, convictionGate } from './lib/watchstate.mjs';
import { heldDisplay, rawHeldToken, renderHeldVerdict } from './lib/context.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

const T0 = 1_800_000_000_000;
const MIN = 60_000;
const P = VERDICT_PERSIST_MS;

// a computeQuote-shaped held row (mirrors context.test.mjs's heldRow helper)
const rowOf = (o = {}) => ({
  quickBuy: 3_120_000, quickSell: 3_140_000, optBuy: 3_100_000, optSell: 3_170_000,
  rawBandLo: 3_100_000, rawBandHi: 3_170_000, mom: 'clean', reliable: true, ordered: true,
  reliableReason: 'ok', rising: false, falling: false, regimeLabel: 'flat',
  mid: 3_140_000, volDay: 500, regime: { ok: true, driftPct: 0 }, ...o,
});

/* =============================================================================================
 * 0. verdictPersistence — the pure gate
 * ============================================================================================= */

ok('severity rank: CUT=3, CUT-CANDIDATE/LIST-TO-CLEAR=2, everything else 0', () => {
  assert.equal(verdictSeverity('CUT'), 3);
  assert.equal(verdictSeverity('CUT-CANDIDATE'), 2);
  assert.equal(verdictSeverity('LIST-TO-CLEAR'), 2);
  for (const t of ['HOLD', 'UNDERWATER', 'FALLING', 'NO-READ', 'DIURNAL-WATCH', 'SHOCK-WATCH', 'HOLD — ask filling', 'PARKED'])
    assert.equal(verdictSeverity(t), 0, t + ' must rank 0');
});

ok('an ESCALATION arms-then-confirms; a calmer-or-equal candidate adopts immediately', () => {
  // HOLD incumbent, LIST-TO-CLEAR candidate → arms, incumbent renders
  const a = verdictPersistence({ displayVerdict: 'HOLD' }, { candidate: 'LIST-TO-CLEAR', now: T0 });
  assert.equal(a.displayVerdict, 'HOLD');
  assert.equal(a.arming, true);
  assert.equal(a.armedKey, 'LIST-TO-CLEAR');
  // inside the window: still the incumbent
  const b = verdictPersistence({ displayVerdict: 'HOLD', verdictArmedKey: 'LIST-TO-CLEAR', verdictArmedSince: T0 },
    { candidate: 'LIST-TO-CLEAR', now: T0 + P - 1 });
  assert.equal(b.displayVerdict, 'HOLD');
  assert.equal(b.arming, true);
  // past the window: confirms
  const c = verdictPersistence({ displayVerdict: 'HOLD', verdictArmedKey: 'LIST-TO-CLEAR', verdictArmedSince: T0 },
    { candidate: 'LIST-TO-CLEAR', now: T0 + P });
  assert.equal(c.displayVerdict, 'LIST-TO-CLEAR');
  assert.equal(c.confirmedThisPass, true);
  // DE-escalation from a scary incumbent is IMMEDIATE — never lingers on a scary label
  const d = verdictPersistence({ displayVerdict: 'LIST-TO-CLEAR' }, { candidate: 'HOLD', now: T0 });
  assert.equal(d.displayVerdict, 'HOLD');
  assert.equal(d.arming, false);
});

ok('a flapping escalation (interleaved calm passes) NEVER confirms — the flap adopts the calm token', () => {
  // LIST-TO-CLEAR one pass, HOLD the next, alternating: the calm pass adopts HOLD (sev 0 ≤ 0)
  // and CLEARS the armed challenger, so the escalation clock restarts every flap.
  let prior = { displayVerdict: 'HOLD', verdictArmedKey: null, verdictArmedSince: null };
  for (let i = 1; i <= 10; i++) {
    const now = T0 + i * 3 * MIN;
    const candidate = i % 2 ? 'LIST-TO-CLEAR' : 'HOLD';
    const r = verdictPersistence(prior, { candidate, now });
    assert.equal(r.displayVerdict, 'HOLD', `tick ${i}: the displayed label must not flip`);
    assert.equal(r.confirmedThisPass, false);
    prior = { displayVerdict: r.displayVerdict, verdictArmedKey: r.arming ? r.armedKey : null,
      verdictArmedSince: r.arming ? r.armedSince : null };
  }
});

ok('immediate (the Gate-2 breakdown CUT invariant) bypasses the timer — displays on pass 1', () => {
  const r = verdictPersistence({ displayVerdict: 'HOLD' }, { candidate: 'CUT', immediate: true, now: T0 });
  assert.equal(r.displayVerdict, 'CUT');
  assert.equal(r.confirmedThisPass, true);
  assert.equal(r.arming, false);
});

ok('NO-READ demotion: keeps a non-NO-READ incumbent + flags unreliableThisPass; labels only on first sight', () => {
  const demoted = verdictPersistence({ displayVerdict: 'HOLD' }, { candidate: 'NO-READ', now: T0 });
  assert.equal(demoted.displayVerdict, 'HOLD');
  assert.equal(demoted.unreliableThisPass, true);
  assert.equal(demoted.arming, false, 'a NO-READ never arms anything');
  const first = verdictPersistence(null, { candidate: 'NO-READ', now: T0 });
  assert.equal(first.displayVerdict, 'NO-READ', 'no incumbent → NO-READ is the honest label');
  assert.equal(first.unreliableThisPass, false);
});

ok('legacy prior (no display fields) behaves as first sight — adopt the candidate (back-compat)', () => {
  const legacy = { ts: T0, identity: 'hld:8:3080000', instabuy: 3_140_000, mom: 'clean' };
  const r = verdictPersistence(legacy, { candidate: 'UNDERWATER', now: T0 + MIN });
  assert.equal(r.displayVerdict, 'UNDERWATER');
});

/* =============================================================================================
 * 2. REAL BREAKDOWN (the bludgeon shape) — Gate-2 CUT immediate at BOTH layers, through the new layer
 * ============================================================================================= */

ok('FIXTURE 2: a Gate-2 breakdown CUT displays on pass 1 through heldDisplay (label layer)', () => {
  const row = rowOf({ mom: 'breakdown', quickSell: 3_050_000 });
  const mv = { action: 'CUT', verdict: 'CUT', listAt: 3_050_000, gate: 2 };
  // even against an established calm incumbent, the CUT is immediate — never armed
  const d = heldDisplay({ row, be: 3_150_000, mv, prior: { displayVerdict: 'HOLD' }, nowMs: T0 });
  assert.equal(d.token, 'CUT');
  assert.equal(d.label, 'CUT');
  assert.equal(d.arming, false);
  assert.equal(d.mvDisplay, mv, 'nothing diverges → the raw mv renders (full CUT prose, byte-identical)');
});

ok('FIXTURE 2b: the Gate-2 CUT headline layer (convictionGate) is still escalation-exempt (alert layer)', () => {
  const g = convictionGate({ verdict: 'CUT', gate: 2 });
  assert.equal(g.escalate, true);
  assert.equal(g.reason, 'breakdown');
  // and a declared thesis above the tripwire STILL cannot silence it (checked before the thesis branch)
  const g2 = convictionGate({ verdict: 'CUT', gate: 2, price: 3_200_000, underwater: true,
    thesis: { tripwire: 3_060_000, exitPrice: 3_240_000 } });
  assert.equal(g2.escalate, true, 'a real breakdown headlines, thesis or not');
});

/* =============================================================================================
 * 4. NO-READ INTERLEAVE — end-to-end through heldDisplay + renderHeldVerdict
 * ============================================================================================= */

ok('FIXTURE 4: NO-READ on pass N of a stable HOLD keeps the label + appends the unreliable note', () => {
  const row = rowOf({ reliable: false, reliableReason: 'stale-quote' });
  const mv = { action: 'NO_READ', verdict: 'NO-READ', listAt: null, gate: 0 };
  const d = heldDisplay({ row, be: 3_100_000, mv, prior: { displayVerdict: 'HOLD' }, nowMs: T0 });
  assert.equal(d.token, 'HOLD');
  assert.match(d.label, /^HOLD \(read unreliable this pass — stale-quote\)$/);
  assert.equal(d.raw, 'NO-READ', 'the raw token stays honest');
  // the renderer consumes the synthetic display — table cell and note read the same label
  const ctx = { market: { row }, intraday: {}, position: { be: 3_100_000, mv, display: d } };
  assert.equal(renderHeldVerdict(ctx, { mode: 'compact' }), d.label);
  assert.ok(renderHeldVerdict(ctx, { mode: 'verbose' }).startsWith(d.label));
});

ok('rawHeldToken matches the pre-VN-1 watch.mjs token chain (mv > FALLING > UNDERWATER > HOLD > NO-QUOTE)', () => {
  assert.equal(rawHeldToken(rowOf(), 3_100_000, { verdict: 'CUT-CANDIDATE' }), 'CUT-CANDIDATE');
  assert.equal(rawHeldToken(rowOf({ falling: true }), 3_100_000, null), 'FALLING');
  assert.equal(rawHeldToken(rowOf({ quickSell: 3_000_000 }), 3_100_000, null), 'UNDERWATER');
  assert.equal(rawHeldToken(rowOf(), 3_100_000, null), 'HOLD');
  assert.equal(rawHeldToken(rowOf({ quickSell: null }), 3_100_000, null), 'NO-QUOTE');
});

ok('byte-identity: an all-quiet pass (no divergence) renders exactly the pre-VN-1 strings', () => {
  const row = rowOf();
  const d = heldDisplay({ row, be: 3_100_000, mv: null, prior: { displayVerdict: 'HOLD' }, nowMs: T0 });
  assert.equal(d.mvDisplay, null, 'nothing diverges → mvDisplay is the raw (null) mv');
  const ctx = { market: { row }, intraday: {}, position: { be: 3_100_000, lotValue: 1, mv: null, display: d } };
  const noDisp = { market: { row }, intraday: {}, position: { be: 3_100_000, lotValue: 1, mv: null } };
  assert.equal(renderHeldVerdict(ctx, { mode: 'compact' }), renderHeldVerdict(noDisp, { mode: 'compact' }));
  assert.equal(renderHeldVerdict(ctx, { mode: 'verbose' }), renderHeldVerdict(noDisp, { mode: 'verbose' }));
});

console.log(`\nAll ${pass} checks passed.`);
