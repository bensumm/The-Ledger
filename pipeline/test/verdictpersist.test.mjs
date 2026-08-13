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
 * Run: `node pipeline/test/verdictpersist.test.mjs`.
 */
import assert from 'node:assert/strict';
import { verdictPersistence, verdictSeverity, VERDICT_PERSIST_MS, convictionGate } from '../lib/thesis/watchstate.mjs';
import { heldDisplay, rawHeldToken, renderHeldVerdict } from '../lib/market/item-context.mjs';
import { computeReality, diurnalTimedLap } from '../../js/windowread.mjs';   // 2c — the reality read the frame's diurnal-ask fallback now carries, and the lap that produces it

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

const T0 = 1_800_000_000_000;
const MIN = 60_000;
const P = VERDICT_PERSIST_MS;

// a computeQuote-shaped held row (mirrors item-context.test.mjs's heldRow helper)
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
 * 1. PARKED-AT-BE (the Berserker shape) — the label holds ONE state while the raw token flips
 * ============================================================================================= */
import { parkedDeadband, BE_DEADBAND_BAND_FRAC, BE_DEADBAND_MIN_PCT } from '../lib/market/item-context.mjs';

ok('FIXTURE 1: instabuy oscillating across BE inside the dead-band → ONE rendered state over ≥10 passes, raw still flips', () => {
  const BE = 3_150_000;                       // Berserker: BE 3.15m, 2h raw band 3.10–3.17m
  const band = { rawBandLo: 3_100_000, rawBandHi: 3_170_000 };
  let prior = null;
  const labels = new Set(), raws = new Set();
  for (let i = 0; i < 12; i++) {
    const live = i % 2 ? 3_130_000 : 3_160_000;   // alternating below/above BE, inside the dead-band
    const row = rowOf({ ...band, quickSell: live });
    const d = heldDisplay({ row, be: BE, mv: null, prior, nowMs: T0 + i * 3 * MIN });
    labels.add(d.token); raws.add(d.raw);
    assert.equal(d.parked, true, `pass ${i}: inside the dead-band the display is PARKED`);
    assert.match(d.label, /^PARKED — at break-even \(±.+\) — list ≥ 3\.15m$/);
    prior = { ...d.state };                      // chain the persisted display fields
  }
  assert.deepEqual([...labels], ['PARKED'], 'ONE rendered state across all passes');
  assert.deepEqual([...raws].sort(), ['HOLD', 'UNDERWATER'], 'honesty: the raw token still flips underneath');
});

ok('PARKED never masks an escalated/softened verdict, a falling regime, or an out-of-band print', () => {
  const BE = 3_150_000;
  // an mv fired (CUT-CANDIDATE) → parked unreachable even at BE
  const d1 = heldDisplay({ row: rowOf({ quickSell: 3_150_000 }), be: BE,
    mv: { action: 'CUT', verdict: 'CUT-CANDIDATE', gate: 'D', listAt: 3_150_000 }, prior: null, nowMs: T0 });
  assert.equal(d1.parked, false);
  // falling regime → parkedDeadband is null (the FALLING alert path is untouched)
  assert.equal(parkedDeadband(rowOf({ falling: true, quickSell: 3_150_000 }), BE), null);
  // a print outside the dead-band → normal HOLD/UNDERWATER token
  const dead = Math.max(BE_DEADBAND_BAND_FRAC * 70_000, BE_DEADBAND_MIN_PCT * BE);
  const d2 = heldDisplay({ row: rowOf({ quickSell: BE - dead - 60_000 }), be: BE, mv: null, prior: null, nowMs: T0 });
  assert.equal(d2.parked, false);
  assert.equal(d2.raw, 'UNDERWATER');
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
 * 3. THESIS FRAME (VN-2) — the declared plan governs the render above its tripwire
 * ============================================================================================= */

// the Masori shape: entered on the diurnal thesis, exit 44.22m @ the 23-06h peak window,
// abort 42.5m; band-flip frame keeps emitting LIST-TO-CLEAR at the band top (43.60m) pre-peak.
const MASORI_THESIS = { id: 27235, exitPrice: 44_220_000, tripwire: 42_500_000,
  horizon: 'overnight', window: '23-6', path: 'value-hold', enteredUnder: 'value-hold' };

ok('FIXTURE 3: above the tripwire, the frame renders the DECLARED exit (not the band top) on both surfaces', () => {
  const row = rowOf({ quickBuy: 43_000_000, quickSell: 43_110_000, optBuy: 42_900_000,
    optSell: 43_600_000, rawBandLo: 42_900_000, rawBandHi: 43_600_000, mom: 'breakdown' });
  const mv = { action: 'CLEAR', verdict: 'LIST-TO-CLEAR', listAt: 43_110_000, gate: 2 };
  const d = heldDisplay({ row, be: 43_070_000, mv, prior: null, nowMs: T0, thesis: MASORI_THESIS });
  assert.equal(d.frame, true);
  assert.equal(d.token, 'HOLD — per thesis');
  assert.match(d.label, /HOLD — per thesis \(value-hold\): exit 44\.22m @ 23-6h local · abort < 42\.50m/);
  assert.equal(d.raw, 'LIST-TO-CLEAR', 'the raw band-flip read stays honest underneath');
  const ctx = { market: { row }, intraday: {}, position: { be: 43_070_000, mv, display: d } };
  assert.equal(renderHeldVerdict(ctx, { mode: 'compact' }), d.label);
  assert.ok(renderHeldVerdict(ctx, { mode: 'verbose' }).includes('raw band-flip read this pass: LIST-TO-CLEAR'));
});

ok('FIXTURE 3b: the frame exit falls back to the caller-supplied diurnal ASK when no exitPrice declared', () => {
  const row = rowOf({ quickSell: 43_110_000 });
  const th = { ...MASORI_THESIS, exitPrice: null };
  const d = heldDisplay({ row, be: 43_070_000, mv: null, prior: null, nowMs: T0, thesis: th, diurnalAsk: 44_000_000 });
  assert.match(d.label, /exit 44m/);
  const d2 = heldDisplay({ row, be: 43_070_000, mv: null, prior: null, nowMs: T0, thesis: th });
  assert.match(d2.label, /exit per plan/, 'no declared exit + no diurnal ask → honest "exit per plan"');
});

ok('FIXTURE 3c: live AT/BELOW the tripwire → frame off, normal escalation resumes', () => {
  const row = rowOf({ quickSell: 42_400_000, mom: 'breakdown' });
  const mv = { action: 'CLEAR', verdict: 'LIST-TO-CLEAR', listAt: 42_400_000, gate: 2 };
  // incumbent was the frame; the raw LIST-TO-CLEAR (sev 2 vs sev 0) arms-then-confirms per VN-1
  const d = heldDisplay({ row, be: 43_070_000, mv, prior: { displayVerdict: 'HOLD — per thesis' },
    nowMs: T0, thesis: MASORI_THESIS });
  assert.equal(d.frame, false);
  assert.equal(d.arming, true, 'the real escalation arms against the frame incumbent');
  assert.equal(d.armedKey, 'LIST-TO-CLEAR');
});

ok('FIXTURE 3d: a Gate-2 breakdown CUT OVERRIDES the frame — immediate at the label layer', () => {
  const row = rowOf({ quickSell: 43_000_000, mom: 'breakdown' });
  const mv = { action: 'CUT', verdict: 'CUT', listAt: 43_000_000, gate: 2 };
  const d = heldDisplay({ row, be: 43_070_000, mv, prior: { displayVerdict: 'HOLD — per thesis' },
    nowMs: T0, thesis: MASORI_THESIS });   // live 43.0m is still ABOVE the 42.5m tripwire — the CUT wins anyway
  assert.equal(d.frame, false);
  assert.equal(d.token, 'CUT');
  assert.equal(d.label, 'CUT');
});

ok('FIXTURE 3e (alert layer): convictionGate thesis-silences LIST-TO-CLEAR above the tripwire only', () => {
  const above = convictionGate({ verdict: 'LIST-TO-CLEAR', gate: 2, price: 43_110_000, underwater: false,
    thesis: MASORI_THESIS, breakdownMs: 10 * MIN, persistMs: 4 * MIN });
  assert.equal(above.escalate, false);
  assert.equal(above.reason, 'thesis-armed');
  const below = convictionGate({ verdict: 'LIST-TO-CLEAR', gate: 2, price: 42_400_000, underwater: false,
    thesis: MASORI_THESIS, breakdownMs: 10 * MIN, persistMs: 4 * MIN });
  assert.equal(below.escalate, true, 'below the tripwire the V7 escalation stands');
  assert.equal(below.reason, 'clear');
});

/* =============================================================================================
 * 3f–3i. PLAN-DIURNAL-RECENCY-GUARD 2c — the frame's DIURNAL-ASK fallback carries its reality clause
 *
 * The frame's exit is a HELD-LOT EXIT PRICE rendered on /positions, /morning and every watch tick.
 * When no exitPrice is declared it falls back to the DERIVED diurnal peak, which can be a spike-top
 * artifact — the 2026-08-12 Green dragon leather miss, where 1,904 was quoted bare on one line while
 * the same run tagged it `⚠ spike-top (3/14d · p86 · typical ~1,828)` two screens up.
 *
 * The fixture below is those REAL per-day window highs (verbatim from the live run that produced the
 * miss, oldest→newest — the same series reality-render-coverage.test.mjs pins), used at their own
 * scale rather than rescaled: `computeReality` is fed the real distribution, not a spike-shaped
 * synthetic that would reach the flag for a different reason.
 * ============================================================================================= */
const gdlHighs = [1864, 1890, 1812, 1979, 1855, 1880, 1854, 1817, 1808, 1807, 1889, 1904, 1910, 1828];
const gdlDays = gdlHighs.map((hi, i) => [`2026-07-${String(29 + i).padStart(2, '0')}`, { low: null, hi }]);
const GDL_SPIKE = computeReality(gdlDays, 1904, 'ask');    // the flagged level
const GDL_CLEAN = computeReality(gdlDays, 1820, 'ask');    // a typical level — no flag fires
// a leather-scale lot with a declared tripwire but NO declared exit → the diurnal-ask fallback governs
const gdlRow = () => rowOf({ quickBuy: 1740, quickSell: 1750, optBuy: 1720, optSell: 1780,
  rawBandLo: 1720, rawBandHi: 1780, mid: 1750 });
const GDL_THESIS = { id: 1745, exitPrice: null, tripwire: 1700, horizon: 'overnight',
  window: '23-6', path: 'value-hold', enteredUnder: 'value-hold' };
const gdlFrame = extra => heldDisplay({ row: gdlRow(), be: 1720, mv: null, prior: null, nowMs: T0,
  thesis: GDL_THESIS, diurnalAsk: 1904, ...extra });

ok('FIXTURE 3f: a SPIKE-TOP diurnal-ask fallback renders the reality clause on the exit price', () => {
  assert.equal(GDL_SPIKE.spikeTop, true, 'fixture drifted: 1,904 on the real GDL series must flag spikeTop');
  const d = gdlFrame({ peakReality: GDL_SPIKE });
  assert.equal(d.frame, true);
  assert.equal(d.label,
    'HOLD — per thesis (value-hold): exit 1,904 ⚠ spike-top — typical ~1,828 @ 23-6h local · abort < 1,700');
  // and it reaches BOTH rendered surfaces, not just the display object
  const ctx = { market: { row: gdlRow() }, intraday: {}, position: { be: 1720, mv: null, display: d } };
  assert.equal(renderHeldVerdict(ctx, { mode: 'compact' }), d.label);
  assert.ok(renderHeldVerdict(ctx, { mode: 'verbose' }).startsWith(d.label));
});

ok('FIXTURE 3g: a CLEAN diurnal ask (and an absent reality) is BYTE-IDENTICAL to the pre-2c string', () => {
  const bare = gdlFrame({});                                  // the pre-2c call shape (no peakReality)
  assert.equal(bare.label, 'HOLD — per thesis (value-hold): exit 1,904 @ 23-6h local · abort < 1,700');
  assert.equal(GDL_CLEAN.spikeTop, false);
  assert.equal(GDL_CLEAN.staleOptimistic, false);
  assert.equal(gdlFrame({ peakReality: GDL_CLEAN }).label, bare.label, 'a clean read must add NOTHING');
  assert.equal(gdlFrame({ peakReality: null }).label, bare.label);
});

ok('FIXTURE 3h: a DECLARED exitPrice NEVER gets a clause — even when peakReality is spike-top', () => {
  // Ben's own number. `peakReality` describes the DERIVED peak level, not his plan; tagging it would
  // label the declared exit with a different level's conditions. This is the constraint 2c must not break.
  const th = { ...GDL_THESIS, exitPrice: 1_950 };
  const withR = heldDisplay({ row: gdlRow(), be: 1720, mv: null, prior: null, nowMs: T0,
    thesis: th, diurnalAsk: 1904, peakReality: GDL_SPIKE });
  const without = heldDisplay({ row: gdlRow(), be: 1720, mv: null, prior: null, nowMs: T0,
    thesis: th, diurnalAsk: 1904 });
  assert.equal(withR.label, 'HOLD — per thesis (value-hold): exit 1,950 @ 23-6h local · abort < 1,700');
  assert.equal(withR.label, without.label);
  assert.ok(!/spike-top|typical/.test(withR.label), 'a declared exit must never carry a reality clause');
  // …and the same holds when there is no fallback level at all (the "exit per plan" degrade)
  const noExit = heldDisplay({ row: gdlRow(), be: 1720, mv: null, prior: null, nowMs: T0,
    thesis: GDL_THESIS, peakReality: GDL_SPIKE });
  assert.match(noExit.label, /exit per plan @ 23-6h local/);
  assert.ok(!/spike-top/.test(noExit.label), 'no level printed → nothing for the clause to describe');
});

ok('FIXTURE 3i: the watch-positions WIRING — `lap.peakReality` is a real field of the lap the ask comes from', () => {
  // The threading bug this chunk fixes was a DISCARDED field, so the field NAME is the load-bearing
  // part: a typo would silently render bare forever and no unit test on heldDisplay would see it.
  // Reproduce watch-positions.mjs:845-851's composition (series → diurnalTimedLap → ask + peakReality
  // → heldDisplay) on a synthetic 14-night series.
  const dts = (y, mo, d, h) => Math.floor(new Date(y, mo, d, h, 0, 0).getTime() / 1000);
  const s = [];
  for (let di = 0; di < 14; di++) for (let h = 0; h < 24; h++) {
    const dip = [21, 22, 23].includes(h) ? 39 : 0, pk = [4, 5, 6].includes(h) ? 85 : 0;
    s.push({ timestamp: dts(2026, 0, 5 + di, h), avgLowPrice: 2900 - 45 - dip, avgHighPrice: 2900 + 45 + pk,
      lowPriceVolume: 35750, highPriceVolume: [4, 5, 6].includes(h) ? 149334 : 35750 });
  }
  const lap = diurnalTimedLap(s, { nights: 7, now: new Date(2026, 0, 20, 12, 0, 0), liveLo: 2860, liveHi: 2990 });
  assert.equal(lap.degraded, false);
  assert.ok(lap.ask != null, 'the fallback ask resolves');
  assert.ok('peakReality' in lap, 'diurnalTimedLap must expose `peakReality` — watch-positions.mjs reads it by that name');
  assert.ok(lap.peakReality && typeof lap.peakReality.spikeTop === 'boolean',
    'peakReality must be a computeReality read (a renamed/absent field would render the exit bare again)');
  const th = { ...GDL_THESIS, tripwire: 2800 };
  const d = heldDisplay({ row: rowOf({ quickBuy: 2860, quickSell: 2900, optBuy: 2850, optSell: 2990,
    rawBandLo: 2850, rawBandHi: 2990, mid: 2900 }), be: 2870, mv: null, prior: null, nowMs: T0,
    thesis: th, diurnalAsk: lap.ask, peakReality: lap.peakReality });
  assert.equal(d.frame, true);
  assert.ok(d.label.includes(`exit ${lap.ask.toLocaleString()}`), 'the lap ask is what the frame prints');
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

ok('rawHeldToken matches the pre-VN-1 watch-positions.mjs token chain (mv > FALLING > UNDERWATER > HOLD > NO-QUOTE)', () => {
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
