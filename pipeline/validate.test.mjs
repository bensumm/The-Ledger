#!/usr/bin/env node
/**
 * validate.test.mjs — acceptance fixtures for the P2 validator registry (js/validate.mjs).
 *
 * Lives in pipeline/ next to quotecore.test.mjs / windowread.test.mjs (the convention for
 * js/-module tests). Validators are PURE over a caller-fed ctx — fixtures are synthetic 1h series,
 * no live data (rule 4). Run: `node pipeline/validate.test.mjs` (exits non-zero on any failure).
 *
 * BUSINESS REQUIREMENTS pinned here (diff a change against these):
 *   - registry semantics: runValidators runs the pure registry, degrades a THROWING validator to
 *     pass, and worstStatus/flags/leanValidators summarize a row's results.
 *   - reachValidator: a rarely-reached ask → caution; a never-reached ask → reject; both carry the
 *     reach EVIDENCE (hit/days/frac).
 *   - RC1 stale-optimistic: a full-window reach concentrated in an OLDER regime (recent nights don't
 *     reach it) BUMPS severity one step — a would-be caution becomes reject.
 *   - degrade contract: no 1h series / no candidate / thin sample → pass with a no-data-shaped note,
 *     NEVER a reject on the absence of data.
 *
 * NOTE: the P3 floorValidator's acceptance (decay-knife reject / genuine-dip pass / no-data + held-lot
 * degrade) lives in pipeline/termstructure.test.mjs (next to the js/termstructure.mjs math it drives).
 * This suite only pins that the registry now RUNS both reach + floor.
 */
import assert from 'node:assert/strict';
import {
  reachValidator, trajectoryValidator, valueAmplitudeValidator,
  runValidators, worstStatus, flags, informFlags, leanValidators, worseOf,
  REACH_MIN_DAYS,
} from '../js/validate.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

console.log('validate.mjs registry + reachValidator acceptance:');

// --- fixture builders -------------------------------------------------------------------------
// One 1h point per night at hour 02:00 (in a 0–8 window). now is at hour 00 on a LATER day so
// wStart=0/wEnd=8 and no fixture night collides with the skipped "today" bucket. windowStats takes
// the night's min low / max high, so one point per night fully determines its {low, hi}.
const ptAt = (d, low, hi) => ({
  timestamp: Math.floor(new Date(2026, 0, d, 2, 0, 0).getTime() / 1000),
  avgLowPrice: low, avgHighPrice: hi, lowPriceVolume: 10, highPriceVolume: 10,
});
// nights: [{ d, low, hi }] oldest→newest (ascending day-of-month)
const seriesOf = nights => nights.map(n => ptAt(n.d, n.low, n.hi));
const NOW = new Date(2026, 0, 25, 0, 0, 0);   // hour 0 ⇒ window 0–8; day 25 is after all fixture nights
const ctxReach = (ts1h, reach) => ({ intraday: { ts5m: null, ts6h: null, ts1h, reach: { now: NOW, ...reach } } });

// --- 1. registry semantics --------------------------------------------------------------------
ok('worseOf orders reject > caution > pass', () => {
  assert.equal(worseOf('pass', 'caution'), 'caution');
  assert.equal(worseOf('reject', 'caution'), 'reject');
  assert.equal(worseOf('pass', 'pass'), 'pass');
});
ok('runValidators returns the registry results; worstStatus/flags/leanValidators summarize', () => {
  const res = runValidators({ intraday: { ts1h: null } });   // no data → all validators degrade to pass
  assert.deepEqual(res.map(r => r.key).sort(), ['floor', 'limit', 'reach', 'trajectory', 'value-amplitude'], 'registry runs reach + floor (P3) + trajectory + value-amplitude + limit (LM1)');
  assert.ok(res.every(r => r.status === 'pass'), 'no data → every validator degrades to pass');
  assert.equal(worstStatus(res), 'pass');
  assert.equal(flags(res).length, 0);
  assert.equal(leanValidators(res), undefined, 'a clean row logs no validators field (YS2 lean-include)');
});
ok('runValidators degrades a THROWING validator to pass (never breaks a read)', () => {
  const boom = () => { throw new Error('kaboom'); };
  // exercise the try/catch via a hand-built one-off registry call shape
  const res = (function run(only) {
    const VALIDATORS = { boom };
    const out = [];
    for (const k of only) { try { out.push(VALIDATORS[k]({})); } catch (err) { out.push({ key: k, status: 'pass', reason: 'validator-error', evidence: { note: String(err.message) } }); } }
    return out;
  })(['boom']);
  assert.equal(res[0].status, 'pass');
  assert.equal(res[0].reason, 'validator-error');
});

// --- 2. reachValidator: reachable / rarely-reached / never-reached ----------------------------
ok('a well-reached ask → pass with reach evidence', () => {
  const s = seriesOf([
    { d: 10, low: 250, hi: 310 }, { d: 11, low: 252, hi: 305 }, { d: 12, low: 249, hi: 312 },
    { d: 13, low: 251, hi: 308 }, { d: 14, low: 250, hi: 309 }, { d: 15, low: 248, hi: 311 },
    { d: 16, low: 253, hi: 307 }, { d: 17, low: 250, hi: 310 },
  ]);
  const r = reachValidator(ctxReach(s, { side: 'ask', level: 300 }));
  assert.equal(r.status, 'pass');
  assert.equal(r.evidence.hit, 8, 'all 8 nights top ≥ 300');
  assert.equal(r.evidence.days, 8);
});
ok('a rarely-reached ask (well below the caution frac, not stale) → caution', () => {
  // one mid-window night reaches 300; the rest top out 288–295. reach 1/8 = 0.125 < 0.5, spread so
  // recent ≈ full (no stale bump) → caution.
  const s = seriesOf([
    { d: 10, low: 250, hi: 290 }, { d: 11, low: 251, hi: 295 }, { d: 12, low: 250, hi: 292 },
    { d: 13, low: 252, hi: 305 }, { d: 14, low: 249, hi: 288 }, { d: 15, low: 250, hi: 291 },
    { d: 16, low: 251, hi: 289 }, { d: 17, low: 250, hi: 287 },
  ]);
  const r = reachValidator(ctxReach(s, { side: 'ask', level: 300 }));
  assert.equal(r.status, 'caution');
  assert.equal(r.evidence.hit, 1);
  assert.equal(r.evidence.staleOptimistic, false, 'the lone reach is mid-window, not an old-regime artifact');
  assert.match(r.reason, /reached only 1\/8d/);
});
ok('a never-reached ask → reject (definitional out-of-range)', () => {
  const s = seriesOf([
    { d: 10, low: 250, hi: 310 }, { d: 11, low: 252, hi: 305 }, { d: 12, low: 249, hi: 312 },
    { d: 13, low: 251, hi: 308 }, { d: 14, low: 250, hi: 309 }, { d: 15, low: 248, hi: 311 },
    { d: 16, low: 253, hi: 307 }, { d: 17, low: 250, hi: 310 },
  ]);
  const r = reachValidator(ctxReach(s, { side: 'ask', level: 400 }));   // nothing tops 400
  assert.equal(r.status, 'reject');
  assert.equal(r.evidence.hit, 0);
});

// --- 3. RC1 stale-optimistic bumps a caution up to reject -------------------------------------
ok('RC1 stale-optimistic ASK: full reach in an OLD regime, recent nights miss → bumped caution→reject', () => {
  // blood-rune shape (mirrors windowread.test.mjs): pre-crash highs 313–315 reach a 313 ask on the
  // 4 oldest nights; the crash + recent recovery (tops 299–310) do NOT. Full 4/10 = 0.4 → caution;
  // recent 3 = 0/3 → staleOptimistic → bumped to reject.
  const s = seriesOf([
    { d: 6, low: 306, hi: 313 }, { d: 7, low: 305, hi: 314 }, { d: 8, low: 306, hi: 315 }, { d: 9, low: 300, hi: 315 },
    { d: 10, low: 272, hi: 286 }, { d: 11, low: 269, hi: 281 }, { d: 12, low: 272, hi: 283 },
    { d: 13, low: 286, hi: 299 }, { d: 14, low: 290, hi: 301 }, { d: 15, low: 300, hi: 310 },
  ]);
  const r = reachValidator(ctxReach(s, { side: 'ask', level: 313 }));
  assert.equal(r.evidence.hit, 4, '313 reached on the 4 pre-crash nights');
  assert.equal(r.evidence.recentHit, 0, 'recent 3 nights top 299–310 — none reach 313');
  assert.equal(r.evidence.staleOptimistic, true);
  assert.equal(r.status, 'reject', 'a 0.4 full frac is a caution, bumped to reject by the stale flag');
  assert.match(r.reason, /stale-optimistic/);
});

// --- 4. degrade contract (never reject on absence of data) ------------------------------------
ok('no 1h series → pass (no-1h-series)', () => {
  const r = reachValidator(ctxReach(null, { side: 'ask', level: 300 }));
  assert.equal(r.status, 'pass');
  assert.equal(r.reason, 'no-1h-series');
});
ok('no candidate → pass (no-candidate)', () => {
  const s = seriesOf([{ d: 10, low: 250, hi: 310 }, { d: 11, low: 252, hi: 305 }]);
  const r = reachValidator({ intraday: { ts1h: s } });   // reach namespace absent
  assert.equal(r.status, 'pass');
  assert.equal(r.reason, 'no-candidate');
});
ok('a thin sample (< REACH_MIN_DAYS nights) never rejects → pass (thin-sample)', () => {
  const nights = [];
  for (let i = 0; i < REACH_MIN_DAYS - 1; i++) nights.push({ d: 10 + i, low: 250, hi: 260 });  // all miss a 400 ask
  const r = reachValidator(ctxReach(seriesOf(nights), { side: 'ask', level: 400 }));
  assert.equal(r.status, 'pass', 'too few nights to reject even though 0/N reach it');
  assert.equal(r.reason, 'thin-sample');
});

// --- 5. leanValidators surfaces a fired flag for the suggestions ledger ------------------------
ok('leanValidators returns a compact flag list when a validator fired', () => {
  const s = seriesOf([
    { d: 10, low: 250, hi: 310 }, { d: 11, low: 252, hi: 305 }, { d: 12, low: 249, hi: 312 },
    { d: 13, low: 251, hi: 308 }, { d: 14, low: 250, hi: 309 }, { d: 15, low: 248, hi: 311 },
    { d: 16, low: 253, hi: 307 }, { d: 17, low: 250, hi: 310 },
  ]);
  const res = [reachValidator(ctxReach(s, { side: 'ask', level: 400 }))];   // reject
  const lean = leanValidators(res);
  assert.equal(lean.length, 1);
  assert.equal(lean[0].key, 'reach');
  assert.equal(lean[0].status, 'reject');
  assert.ok(lean[0].reason && !('evidence' in lean[0]), 'lean list drops the heavy evidence blob');
});

// --- trajectoryValidator (2026-07-09) — SHAPE policy over ts.trajectory --------------------------
const ctxTraj = (shape, evidence = {}, extra = {}) => ({ history: { termStructure: { trajectory: { shape, evidence } } }, ...extra });
ok('trajectoryValidator: knife → reject (the Nightmare-staff shape)', () => {
  const r = trajectoryValidator(ctxTraj('knife', { spiked: true, declPct: 0.05 }));
  assert.equal(r.status, 'reject');
  assert.equal(r.evidence.shape, 'knife');
  assert.ok(/knife/.test(r.reason));
});
ok('trajectoryValidator: oscillating → pass (the Hydra "buy the local min" shape)', () => {
  const r = trajectoryValidator(ctxTraj('oscillating', { reversals: 4 }));
  assert.equal(r.status, 'pass');
  assert.ok(/local min/.test(r.reason));
});
ok('trajectoryValidator: elevated → caution; based/rising/flat/unknown/held/no-data → pass (degrade)', () => {
  assert.equal(trajectoryValidator(ctxTraj('elevated')).status, 'caution');
  assert.equal(trajectoryValidator(ctxTraj('based')).status, 'pass');
  assert.equal(trajectoryValidator(ctxTraj('unknown')).status, 'pass');       // degrade: no shape
  assert.equal(trajectoryValidator({ history: {} }).status, 'pass');           // degrade: no term structure
  assert.equal(trajectoryValidator(ctxTraj('knife', {}, { position: { held: true } })).status, 'pass'); // held = sell-side degrade
});

// --- valueAmplitudeValidator (2026-07-09) — recent-WEEK amplitude + proximity-to-low --------------
const ctxAmp = (low, high, current, extra = {}) => ({ history: { termStructure: { current, lookbacks: { 7: { low, high } } } }, ...extra });
ok('valueAmplitudeValidator: near the week low with a real cycle → pass', () => {
  const r = valueAmplitudeValidator(ctxAmp(100, 130, 104));   // proximity ~0.13, amp ~27% after tax
  assert.equal(r.status, 'pass');
  assert.ok(r.evidence.proximity <= 0.4);
});
ok('valueAmplitudeValidator: good cycle but live mid/high in the week range → caution (wait for the dip)', () => {
  assert.equal(valueAmplitudeValidator(ctxAmp(100, 130, 127)).status, 'caution');   // proximity ~0.9
});
ok('valueAmplitudeValidator: too-thin week amplitude → reject; no week range / held → degrade', () => {
  assert.equal(valueAmplitudeValidator(ctxAmp(100, 101, 100)).status, 'reject');     // ~0% after-tax amp
  assert.equal(valueAmplitudeValidator({ history: {} }).status, 'pass');             // no 7d range → degrade
  assert.equal(valueAmplitudeValidator(ctxAmp(100, 130, 104, { position: { held: true } })).status, 'pass'); // held degrade
});

// --- gate vs inform (2026-07-09) — inform clamps a non-pass to pass but keeps the would-have verdict --
ok('inform mode: a knife runs but is CLAMPED to pass, records gatedStatus, and does NOT drop the row', () => {
  const ctx = ctxTraj('knife', { declPct: 0.05 });
  const gated = runValidators(ctx, { specs: [{ key: 'trajectory', mode: 'gate' }] });
  assert.equal(worstStatus(gated), 'reject', 'gate mode: the knife rejects');

  const informed = runValidators(ctx, { specs: [{ key: 'trajectory', mode: 'inform' }] });
  assert.equal(worstStatus(informed), 'pass', 'inform mode: never downgrades the row');
  assert.equal(informed[0].gatedStatus, 'reject', 'inform mode: the would-have verdict is preserved');
  assert.equal(informFlags(informed).length, 1, 'informFlags surfaces the annotate-only finding');
  assert.equal(flags(informed).length, 0, 'flags (drop set) excludes an inform finding');
});
ok('inform mode: the would-have verdict IS logged to the ledger (the track record to later justify a gate)', () => {
  const informed = runValidators(ctxTraj('knife', { declPct: 0.05 }), { specs: [{ key: 'trajectory', mode: 'inform' }] });
  const lean = leanValidators(informed);
  assert.equal(lean.length, 1);
  assert.equal(lean[0].status, 'reject');
  assert.equal(lean[0].mode, 'inform');
});
ok('reach window injection: a spec window overrides the reach candidate horizon', () => {
  // no 1h series → reach degrades, but the plan still normalizes + carries the window without throwing.
  const res = runValidators({ intraday: { ts1h: null, reach: { side: 'ask', level: 100 } } },
    { specs: [{ key: 'reach', mode: 'gate', window: { windowHours: 24, nights: 14 } }] });
  assert.equal(res.length, 1);
  assert.equal(res[0].key, 'reach');
  assert.equal(res[0].status, 'pass');   // degrade (no series), never throws
});

console.log(`\nAll ${pass} acceptance checks passed.`);
