#!/usr/bin/env node
/**
 * amplitudescreen.test.mjs — acceptance fixtures for the PURE amplitude niche math (js/amplitudescreen.mjs,
 * PLAN-AMPLITUDE-SCAN chunk A1). Gate/ranges/proxy/deploy are DOM-free + fetch-free, so they're
 * fixture-testable with synthetic windowStats-shaped inputs — NO live data (CLAUDE.md rule 4).
 *
 * BUSINESS REQUIREMENTS pinned here (§2.1/§2.2):
 *   - an oscillating big-ticket with a ≥3% after-tax daily swing PASSES the amplitude gate. (NOTE: the
 *     recent-3 reach clause is NOT what admits it — at default quantiles legOk reduces to
 *     !staleOptimistic; the REPRICED reject case below fires on staleness, not unreachability.)
 *   - a razor-thin daily range (amp below the floor) is REJECTED (amp-below-floor).
 *   - a bid the recent days no longer touch (repriced-up floor) is REJECTED (bid-unreachable).
 *   - the caller's trend/knife flags REJECT (trend / knife) — a trending item's "amplitude" is drift.
 *   - amplitudeProxy reads the 6h-archive daily range; amplitudeDeployUnits is the three-way min().
 * Run: `node pipeline/test/amplitudescreen.test.mjs` (exits non-zero on any failure). Auto-discovered.
 */
import assert from 'node:assert/strict';
import {
  amplitudeProxy, amplitudeRanges, amplitudeGate, amplitudeDeployUnits, amplitudeDriftMargin, cycleCompletion, ampWalkForward,
  AMP_MIN_AMP_PCT, AMP_STAGE1_MIN_PCT, AMP_ASK_Q, AMP_BID_Q, AMP_WINDOWS_PER_DAY, AMP_WF_MIN_JUDGED,
} from '../../js/amplitudescreen.mjs';
import { ACTIONABLE_WINDOWS_PER_DAY } from '../../js/desk-cadence.mjs';
import { pFillAmplitude } from '../../js/estimators/families.mjs';   // DT1 — pin that the estimator does NOT rank on the saturated completion figure; DT1b — pin that it DOES rank on the walk-forward

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

// build a windowStats-shaped result from per-day {low,hi} (oldest→newest).
function makeStats(days) {
  const lows = days.map(d => d.low).filter(v => v != null).sort((a, b) => a - b);
  const his = days.map(d => d.hi).filter(v => v != null).sort((a, b) => a - b);
  return { days: days.map((d, i) => [`2026-06-${String(i + 1).padStart(2, '0')}`, d]), lows, his };
}
// an oscillating big-ticket: low ~1000, hi ~1060 (afterTax(1060)=1039 → ~3.9% after-tax daily amplitude).
const OSC = makeStats(Array.from({ length: 10 }, () => ({ low: 1000, hi: 1060 })));
// razor-thin: hi 1010 → afterTax(1010)=990 < low ⇒ negative net ⇒ below floor.
const THIN = makeStats(Array.from({ length: 10 }, () => ({ low: 1000, hi: 1010 })));
// repriced-up floor: 7 old days floor 1000, recent 3 days floor 1040 (the bid no longer touches).
const REPRICED = makeStats([
  ...Array.from({ length: 7 }, () => ({ low: 1000, hi: 1060 })),
  ...Array.from({ length: 3 }, () => ({ low: 1040, hi: 1120 })),
]);

console.log('amplitudescreen.mjs:');

ok('an oscillating ≥3% after-tax daily swing with both legs reachable PASSES', () => {
  const ar = amplitudeRanges(OSC, 1005, { holdDays: 1 });
  assert.equal(ar.hasData, true);
  assert.ok(ar.medAmpPct >= AMP_MIN_AMP_PCT, `medAmpPct ${ar.medAmpPct} ≥ floor ${AMP_MIN_AMP_PCT}`);
  assert.equal(ar.ampBid, 1000, 'trough-bid = median daily low');
  assert.equal(ar.ampAsk, 1060, 'peak-ask = median daily high');
  assert.ok(ar.netPerCycle > 0, 'positive after-tax net/cycle');
  // DT1: pFill2leg is gone; cycleCompletion is computed as a DISPLAY diagnostic (and is saturated on
  // this fixture by construction — see the dedicated pins below).
  assert.ok(ar.cycle.judged > 0, 'the completion diagnostic reports its own n');
  assert.equal(ar.pFill2leg, undefined, 'the product-of-marginals estimator is gone');
  const g = amplitudeGate(ar, {});
  assert.equal(g.pass, true, `gate passes, got ${g.reason}`);
});

ok('a razor-thin daily range is REJECTED (amp-below-floor)', () => {
  const ar = amplitudeRanges(THIN, 1005, {});
  const g = amplitudeGate(ar, {});
  assert.equal(g.pass, false);
  assert.equal(g.reason, 'amp-below-floor');
});

ok('a bid the recent days no longer touch is REJECTED (bid-unreachable)', () => {
  const ar = amplitudeRanges(REPRICED, 1045, {});
  const g = amplitudeGate(ar, {});
  assert.equal(g.pass, false);
  assert.equal(g.reason, 'bid-unreachable', `got ${g.reason}`);
});

ok('the caller\'s trend/knife flags REJECT (a trending item\'s amplitude is drift)', () => {
  const ar = amplitudeRanges(OSC, 1005, {});
  assert.equal(amplitudeGate(ar, { trendDominates: true }).reason, 'trend');
  assert.equal(amplitudeGate(ar, { knife: true }).reason, 'knife');
});

ok('too-thin a day sample degrades to no-data (never a fake read)', () => {
  const ar = amplitudeRanges(makeStats([{ low: 1000, hi: 1060 }, { low: 1000, hi: 1060 }]), 1005, {});
  assert.equal(ar.hasData, false);
  assert.equal(amplitudeGate(ar, {}).reason, 'no-history');
});

ok('amplitudeProxy reads the 6h-archive daily range (recent-N median), null on a cold slice', () => {
  const DAY = 86400, T = 1_700_000_000;
  // 5 days × 4 mids/day spanning 1000..1060 → each day's range 6%.
  const pts = [];
  for (let d = 0; d < 5; d++) for (const m of [1000, 1020, 1040, 1060]) pts.push({ ts: T + d * DAY + pts.length * 3600, mid: m });
  const p = amplitudeProxy(pts);
  assert.ok(p != null && Math.abs(p - 0.06) < 1e-9, `proxy ~6%, got ${p}`);
  assert.ok(p >= AMP_STAGE1_MIN_PCT, 'clears the Stage-1 proxy floor');
  assert.equal(amplitudeProxy([]), null, 'cold slice → null');
  assert.equal(amplitudeProxy(null), null, 'no data → null');
});

ok('amplitudeProxy day keys are zero-padded — recent-N is the NEWEST days, not the single-digit ones', () => {
  // REGRESSION (2026-08-08). The key was `${y}-${m+1}-${d}` unpadded, and unpadded YYYY-M-D is NOT
  // lexically monotone: "2026-8-14" < "2026-8-4". So keys.sort().slice(-5) returned days 5..9 instead
  // of 10..14 — a stale "recent-5" for ~2/3 of every month, feeding Stage-1 fetch-pool selection.
  const DAY = 86400;
  const T = Math.floor(new Date(2026, 7, 1, 12, 0, 0).getTime() / 1000);   // local Aug 1 2026, noon
  const pts = [];
  for (let d = 0; d < 14; d++) {                      // Aug 1..Aug 14 local
    const wide = d >= 9;                              // Aug 10..14 → 8% range; Aug 1..9 → 1%
    const mids = wide ? [1000, 1040, 1080] : [1000, 1005, 1010];
    for (let i = 0; i < mids.length; i++) pts.push({ ts: T + d * DAY + i * 3600, mid: mids[i] });
  }
  const p = amplitudeProxy(pts, { recentDays: 5 });
  // Padded keys → recent-5 is Aug 10..14, every one of them 8%. The unpadded bug yielded 1%.
  assert.ok(p != null && Math.abs(p - 0.08) < 1e-9, `recent-5 must be the newest days (~8%), got ${p}`);

  // Cross-MONTH: "2026-10-11" < "2026-9-30" unpadded, so October could never enter the tail.
  const T2 = Math.floor(new Date(2026, 8, 20, 12, 0, 0).getTime() / 1000);  // local Sep 20 2026
  const pts2 = [];
  for (let d = 0; d < 22; d++) {                      // Sep 20 .. Oct 11 local
    const oct = d >= 11;
    const mids = oct ? [1000, 1040, 1080] : [1000, 1005, 1010];
    for (let i = 0; i < mids.length; i++) pts2.push({ ts: T2 + d * DAY + i * 3600, mid: mids[i] });
  }
  const p2 = amplitudeProxy(pts2, { recentDays: 5 });
  assert.ok(p2 != null && Math.abs(p2 - 0.08) < 1e-9, `recent-5 must cross the month boundary, got ${p2}`);
});

ok('amplitudeDeployUnits is the three-way min() (bankroll / vol-share / buy-limit), degrades to 1', () => {
  // THE BOUND IS EXPRESSED VIA THE CONSTANT, NOT A LITERAL. This case used to read `100×6×1 = 600`,
  // which silently stopped being the code's arithmetic when the attention haircut moved the windows
  // 6→2 (the suite went red only because the *other* leg happened to change which one bound). A test
  // that hardcodes a constant it doesn't own pins the wrong thing — see the same class flagged on
  // capeff-digest.test.mjs. Both legs are exercised below so the min() still has to actually choose.
  const W = AMP_WINDOWS_PER_DAY;

  // BUY-LIMIT leg binds: bankroll 100m/1000 = 100k; vol-share 0.10×5000×1 = 500; limit 100×W×1.
  const uLimit = amplitudeDeployUnits({ capGp: 100_000_000, buyLow: 1000, limitVol: 5000, limit: 100, holdDays: 1 });
  assert.equal(uLimit, Math.min(100_000, 500, 100 * W * 1), `buy-limit leg should bind, got ${uLimit}`);

  // VOL-SHARE leg binds: same fixture with a limit big enough that limit×W clears the vol-share 500.
  const bigLimit = Math.ceil(600 / W);
  const uVol = amplitudeDeployUnits({ capGp: 100_000_000, buyLow: 1000, limitVol: 5000, limit: bigLimit, holdDays: 1 });
  assert.equal(uVol, 500, `vol-share leg should bind at limit=${bigLimit}, got ${uVol}`);

  assert.equal(amplitudeDeployUnits({}), 1, 'no inputs → a single unit');
});

ok('the amplitude lane shares the ONE windows/day home — no private 6 (the 2026-08-08 drift)', () => {
  // AMP_WINDOWS_PER_DAY and VALUE_WINDOWS_PER_DAY both sat at a bare 6 under a comment claiming to
  // "mirror expUnits" for a day after expUnits took the haircut. This asserts the wiring, and pins
  // the value LOUDLY so a future change to the desk cadence is a deliberate, visible edit.
  assert.equal(AMP_WINDOWS_PER_DAY, ACTIONABLE_WINDOWS_PER_DAY, 'amplitude must not fork its own windows/day');
  assert.equal(ACTIONABLE_WINDOWS_PER_DAY, 2, 'desk cadence is 2 windows/day (Ben 2026-08-09) — change deliberately');
});

// --- PLAN-OSCILLATION-CYCLE F-E — the reach-vs-margin quantile DIAL -------------------------------
// A spread-highs fixture (lows flat at 1000 so ampBid is fixed across bidQ — isolates the ask dial).
// Highs (chronological, oldest→newest); the last-3 tail drives the recent reach. quantHigh treats its
// argument as a REACH FRACTION (ask reached on ~q of days), so a LOWER askQ = a HIGHER, less-reachable
// ask. NOTE: the F-E plan row illustrated this as "0.75 → higher ampAsk", which has the direction
// inverted vs the actual quantHigh semantics (askQ is the reach fraction, not a price percentile) — the
// TRUE dial is askQ DOWN ⇒ higher/less-reachable ask. These pins encode the real direction.
const SPREAD = makeStats([
  { low: 1000, hi: 1120 }, { low: 1000, hi: 1090 }, { low: 1000, hi: 1055 }, { low: 1000, hi: 1050 },
  { low: 1000, hi: 1050 }, { low: 1000, hi: 1060 }, { low: 1000, hi: 1065 }, { low: 1000, hi: 1085 },
  { low: 1000, hi: 1060 }, { low: 1000, hi: 1070 },
]);

ok('F-E: a LOWER askQ (0.25) quotes a strictly HIGHER, less-reachable ask — more margin, less reach', () => {
  const base = amplitudeRanges(SPREAD, 1005);               // default 0.5/0.5 (the KEPT board)
  const dial = amplitudeRanges(SPREAD, 1005, { askQ: 0.25 }); // a better-but-less-reachable sell
  assert.equal(base.ampAsk, 1065, `default median peak-ask, got ${base.ampAsk}`);
  assert.ok(dial.ampAsk > base.ampAsk, `strictly higher ampAsk (${dial.ampAsk} > ${base.ampAsk})`);
  // the MARGIN side of the trade-off: a higher ask ⇒ a strictly higher after-tax ampPct (with ampBid fixed).
  assert.ok(dial.ampPct > base.ampPct, `more margin (ampPct ${dial.ampPct} > ${base.ampPct})`);
  // the REACH side of the trade-off: the higher ask is reached on strictly FEWER recent days.
  // the REACH side, now read through the ORDERED completion: a higher ask completes on fewer entries.
  assert.ok(dial.cycle.frac < base.cycle.frac, `less completion (${dial.cycle.frac} < ${base.cycle.frac})`);
  assert.equal(dial.askQ, 0.25, 'the effective askQ rides on the result (so a shadow-log can record it)');
  assert.equal(dial.bidQ, 0.5, 'bidQ stays default when only askQ is dialed');
  // symmetry check: the OTHER direction (higher askQ = MORE reachable = a lower ask) moves the opposite way.
  const easy = amplitudeRanges(SPREAD, 1005, { askQ: 0.75 });
  assert.ok(easy.ampAsk < base.ampAsk && easy.cycle.frac > base.cycle.frac, 'higher askQ ⇒ lower ask, more completion');
});

ok('F-E: the default is byte-identical to pre-F-E (omitted opts ≡ {} ≡ explicit 0.5/0.5)', () => {
  const omitted  = amplitudeRanges(SPREAD, 1005);
  const empty    = amplitudeRanges(SPREAD, 1005, {});
  const explicit = amplitudeRanges(SPREAD, 1005, { askQ: AMP_ASK_Q, bidQ: AMP_BID_Q });
  assert.deepEqual(omitted, empty, 'omitted opts ≡ {}');
  assert.deepEqual(omitted, explicit, 'omitted opts ≡ explicit default quantiles');
  assert.equal(omitted.askQ, 0.5, 'default askQ = AMP_ASK_Q');
  assert.equal(omitted.bidQ, 0.5, 'default bidQ = AMP_BID_Q');
});

ok('an UNAFFORDABLE big-ticket (price > total capital) sizes to 0 units — the caller drops it', () => {
  // A 345m item on a 100m pool: 100m/345m = 0.29 → honest floor → 0 (NOT a phantom 1u).
  assert.equal(amplitudeDeployUnits({ capGp: 100_000_000, buyLow: 345_000_000 }), 0, 'unaffordable → 0');
});

ok('an affordable big-ticket sizes UNDIVIDED (no ÷slots) and honors the min()', () => {
  // 345m mace on a 400m pool: 400m/345m = 1.16 → floor 1 (a ÷5-slots cap would have given 0 — proves undivided).
  assert.equal(amplitudeDeployUnits({ capGp: 400_000_000, buyLow: 345_000_000 }), 1, 'affordable → 1, undivided');
  // and the min() still binds on the buy-limit accumulation, not the (looser) bankroll.
  const u = amplitudeDeployUnits({ capGp: 400_000_000, buyLow: 345_000_000, limitVol: 40, limit: 2, holdDays: 1 });
  // bankroll 1.16 · vol-share 0.10×40=4 · limit 2×6=12 → min 1.16 → floor 1.
  assert.equal(u, 1, `min bound honored, got ${u}`);
});


// --- cycleCompletion (PLAN-DIURNAL-TRIAGE DT1) acceptance ----------------------------------------
// BUSINESS REQUIREMENTS pinned here. ⚠ this estimator is NOT what the lane ranks on — it was built as
// pFillAmplitude's replacement at DT1, measured CIRCULAR, and rejected the same day; DT1b's
// ampWalkForward took the slot. The pins below cover its ordering contract AND (further down) the two
// pins that keep it OUT of the rank. Do not read this block as describing the live estimator:
//   - completion is ORDERED: an entry day's ask must be reached on a STRICTLY LATER day.
//   - SAME-DAY completion never counts (day buckets can't prove low-preceded-high within a day).
//   - an entry whose horizon runs past the window edge is PENDING, never a scored miss.
//   - zero judged entries ⇒ frac null (no claim), never 0.
//   - a row whose ask is never reached after entry reports frac 0 with judged > 0 — it SELF-INDICTS.
ok('cycleCompletion: ordered completion — entry then a LATER day reaching the ask', () => {
  const days = [
    ['d0', { low: 1000, hi: 1010 }],   // entry; d1 reaches 1060 → completes
    ['d1', { low: 1050, hi: 1060 }],
    ['d2', { low: 1050, hi: 1060 }],
    ['d3', { low: 1050, hi: 1060 }],
    ['d4', { low: 1050, hi: 1060 }],
  ];
  const c = cycleCompletion(days, { bid: 1000, ask: 1060, horizonDays: 2 });
  assert.equal(c.entries, 1); assert.equal(c.judged, 1); assert.equal(c.completed, 1); assert.equal(c.frac, 1);
});

ok('cycleCompletion: SAME-DAY reach does NOT count (the ordering assumption stays removed)', () => {
  // d0 both enters (low 1000) and reaches the ask (hi 1060) on the same day; nothing later does.
  const days = [
    ['d0', { low: 1000, hi: 1060 }],
    ['d1', { low: 1050, hi: 1055 }],
    ['d2', { low: 1050, hi: 1055 }],
    ['d3', { low: 1050, hi: 1055 }],
  ];
  const c = cycleCompletion(days, { bid: 1000, ask: 1060, horizonDays: 2 });
  assert.equal(c.entries, 1);
  assert.equal(c.completed, 0, 'same-day high is not a completed round trip at day grain');
  assert.equal(c.frac, 0);
});

ok('cycleCompletion: an entry whose horizon runs past the window edge is PENDING, not a miss', () => {
  const days = [
    ['d0', { low: 1050, hi: 1055 }],
    ['d1', { low: 1050, hi: 1055 }],
    ['d2', { low: 1000, hi: 1010 }],   // entry with only 1 day left but a 3-day horizon → pending
    ['d3', { low: 1050, hi: 1055 }],
  ];
  const c = cycleCompletion(days, { bid: 1000, ask: 1060, horizonDays: 3 });
  assert.equal(c.entries, 1);
  assert.equal(c.pending, 1, 'incomplete horizon at the edge ⇒ pending');
  assert.equal(c.judged, 0);
  assert.equal(c.frac, null, 'no judged entry ⇒ no claim, never a 0');
});

ok('cycleCompletion: a Saturated-heart-shaped row (entries that never complete) SELF-INDICTS at frac 0', () => {
  // enters every day, ask never reached by any later day inside the horizon.
  const days = Array.from({ length: 10 }, (_, i) => [`d${i}`, { low: 1000, hi: 1020 }]);
  const c = cycleCompletion(days, { bid: 1000, ask: 5000, horizonDays: 4 });
  assert.ok(c.judged > 0, 'entries ARE judged — the horizon fits inside the window');
  assert.equal(c.completed, 0);
  assert.equal(c.frac, 0, 'an advertised net/cycle that never completes reads 0, not silence');
});

ok('cycleCompletion: degrades to null on a missing level or a non-array day set', () => {
  const days = [['d0', { low: 1000, hi: 1060 }], ['d1', { low: 1000, hi: 1060 }]];
  assert.equal(cycleCompletion(days, { bid: null, ask: 1060 }), null);
  assert.equal(cycleCompletion(days, { bid: 1000, ask: null }), null);
  assert.equal(cycleCompletion(null, { bid: 1000, ask: 1060 }), null);
});

// DT1: cycleCompletion is DISPLAY-ONLY. It was built as pFillAmplitude's replacement, measured on the
// live board, and rejected the same day — median-bid-vs-median-ask over a multi-day horizon saturates
// (~94% at H=4; the board read 18/19, incl. Saturated heart at 5/5 against a study that measured it at
// 0%/96h). Ranking on it would push every amplitude row's P(fill) toward 1.0. These two pins keep it out
// of the rank AND keep the saturation itself visible, so nobody re-wires it on a casual reading.
ok('cycleCompletion is SATURATED by construction at median levels — the reason it is not a rank input', () => {
  // OSC: every day low=1000 hi=1060, bid=1000 ask=1060 ⇒ every later day clears the ask.
  const ar = amplitudeRanges(OSC, 1005, { holdDays: 4 });
  assert.equal(ar.cycle.frac, 1, 'a median-vs-median pair completes ~always over a multi-day horizon');
});

ok('pFillAmplitude returns the bare PRIOR at n=0 — it must NOT read the saturated completion rate', () => {
  const ar = amplitudeRanges(OSC, 1005, { holdDays: 4 });
  const e = pFillAmplitude({ amplitudeRanges: ar });
  assert.equal(e.basis, 'prior', 'with no walk-forward read, the honest answer is the prior');
  assert.equal(e.n, 0, 'n=0 — we are claiming no observations, honestly');
  assert.notEqual(e.value, ar.cycle.frac, 'and it is emphatically NOT the saturated in-sample figure');
});

// --- DT1b: the WALK-FORWARD round-trip rate ------------------------------------------------------
// These pin the ONE property that separates this from the rejected in-sample figure: the levels are
// fitted STRICTLY BEFORE the day being scored. A synthetic 1h series is the only way to test it —
// the fit window and the scored day have to be genuinely different slices of the same series.
//
// Build `days` days of 24×1h bars at local-midnight alignment (midnightOf in ampWalkForward is local,
// as is windowStats' dayKey — the fixture has to agree with both). Jan/Feb avoids any DST transition.
function series1h(days, priceFor) {
  const base = Math.floor(new Date(2026, 0, 1).getTime() / 1000);
  const out = [];
  for (let d = 0; d < days; d++) {
    const { low, high } = priceFor(d);
    for (let h = 0; h < 24; h++) {
      out.push({ timestamp: base + d * 86400 + h * 3600, avgLowPrice: low, avgHighPrice: high, lowPriceVolume: 50, highPriceVolume: 50 });
    }
  }
  return out;
}

ok('ampWalkForward: a steady DOWNTREND measures ~0% — the pre-origin ask is never reached again', () => {
  // −10/day. The ask fitted from the 14 days BEFORE origin T is the median of higher, older highs, so it
  // sits ~70 above T's own high and is unreachable for the whole horizon. The bid, fitted the same way,
  // sits ABOVE T's low — so entry fires every day. Entries high, completions zero.
  // THIS IS THE PIN: fit the levels in-sample instead and the ask drops onto the scored days, and this
  // reads far above 0. A regression to in-sample fitting fails here.
  const wf = ampWalkForward(series1h(50, d => ({ low: 1000 - 10 * d, high: 1010 - 10 * d })), { horizonDays: 4 });
  assert.ok(wf, 'a 50-day series yields a read');
  assert.ok(wf.entries >= 20, `entry should fire on nearly every day (got ${wf.entries})`);
  assert.equal(wf.completed, 0, 'a falling item never reprints its pre-origin ask');
  assert.equal(wf.frac, 0, 'so the measured round-trip rate is 0, not a saturated ~1');
});

ok('ampWalkForward: a genuine repeating oscillator measures ~100% — it is not merely always-pessimistic', () => {
  // Flat oscillator: the pre-origin ask IS reprinted every day, so a high rate here is CORRECT, not
  // saturation. Pairs with the downtrend pin above — together they show the function discriminates.
  const wf = ampWalkForward(series1h(50, () => ({ low: 1000, high: 1100 })), { horizonDays: 4 });
  assert.ok(wf && wf.judged > 0, 'a read with judged entries');
  assert.equal(wf.frac, 1, 'the ask genuinely reprints every day out-of-sample');
});

ok('ampWalkForward: an unresolved entry at the end of the data is PENDING, never a miss', () => {
  const wf = ampWalkForward(series1h(50, d => ({ low: 1000 - 10 * d, high: 1010 - 10 * d })), { horizonDays: 4 });
  assert.ok(wf.pending >= 1, 'the last few entries have no full horizon inside the series');
  assert.equal(wf.judged + wf.pending, wf.entries, 'every entry is either judged or pending — none dropped');
});

ok('ampWalkForward: too little history is a null read, never a 0% verdict', () => {
  assert.equal(ampWalkForward(series1h(10, () => ({ low: 1000, high: 1100 })), { horizonDays: 4 }), null);
  assert.equal(ampWalkForward([], { horizonDays: 4 }), null);
  assert.equal(ampWalkForward(null, { horizonDays: 4 }), null);
});

ok('pFillAmplitude RANKS on the walk-forward when the sample carries it', () => {
  const wf = ampWalkForward(series1h(50, d => ({ low: 1000 - 10 * d, high: 1010 - 10 * d })), { horizonDays: 4 });
  const e = pFillAmplitude({ walkForward: wf });
  assert.equal(e.basis, 'walkforward', 'basis names the measurement, not a prior');
  assert.equal(e.value, 0, 'a 0% measured round trip must reach the rank as 0 — this is the Saturated-heart case');
  assert.equal(e.n, wf.judged, 'n is the judged-entry count, so thinness self-reports');
});

ok('pFillAmplitude falls BACK to the prior when the walk-forward sample is under the floor', () => {
  const thin = { frac: 0, judged: AMP_WF_MIN_JUDGED - 1, completed: 0, entries: 5, pending: 0, origins: 5 };
  const e = pFillAmplitude({ walkForward: thin });
  assert.equal(e.basis, 'prior', 'a handful of entries is not evidence of a 0% round trip');
  assert.equal(e.n, 0);
});

// ============================================================================================
// PLAN-BOOK-SELF-HEAL H2 — the BOND opt-in. Fixture = the live 2026-09-02 board row for Old school
// bond (guide 11.41m, trough 11.11m, peak 11.81m), which printed +457.8k/cycle and offered 4 units.
// A bond pays NO 2% sell tax but a 10%-of-guide retrade fee, so the real number is fee-dominated and
// NEGATIVE. netMargin cannot see an itemId — the caller opts in with { bond, guide }.
console.log('\nbond opt-in (PLAN-BOOK-SELF-HEAL H2):');
const BOND_GUIDE = 11_410_000;
const BOND = makeStats(Array.from({ length: 10 }, () => ({ low: 11_110_000, hi: 11_810_000 })));

ok('WITHOUT the opt-in the bond row still prints the tax-model fake profit (the pre-fix number)', () => {
  const ar = amplitudeRanges(BOND, 11_260_000, { holdDays: 4 });
  assert.equal(ar.netPerCycle, 463_800, 'tax model: (11.81m − 2%) − 11.11m — the +457.8k-class fake');
  assert.equal(amplitudeGate(ar, {}).pass, true, 'and it sails through the amplitude floor');
});

ok('WITH the opt-in the bond row costs the retrade fee and goes NEGATIVE, so the gate drops it', () => {
  const ar = amplitudeRanges(BOND, 11_260_000, { holdDays: 4, bond: true, guide: BOND_GUIDE });
  assert.equal(ar.netPerCycle, -441_000, 'bond model: 11.81m − 11.11m − 10%×11.41m');
  assert.ok(ar.medAmpPct < 0, 'the daily amplitude is fee-dominated, not a 4.1% swing');
  assert.equal(amplitudeGate(ar, {}).reason, 'amp-below-floor', 'no longer a surfaced pick');
});

ok('a bond with no known guide is REFUSED, never costed fee-free', () => {
  const ar = amplitudeRanges(BOND, 11_260_000, { holdDays: 4, bond: true, guide: null });
  assert.equal(ar.netPerCycle, null, 'unknown retrade fee ⇒ no net, not the fee-free +700k');
  assert.equal(ar.medAmpPct, null);
  assert.equal(amplitudeGate(ar, {}).reason, 'amp-below-floor');
});

ok('amplitudeDriftMargin honours the same opt-in', () => {
  const dae = { driftAdjustedPeak: 11_810_000, driftAdjustedTrough: 11_110_000, naivePeak: 11_810_000, ceilingSlope: 0, floorSlope: 0, confidence: 'low' };
  assert.equal(amplitudeDriftMargin(dae, { entry: 11_110_000 }).margin, 463_800, 'tax model unchanged for every non-bond caller');
  assert.equal(amplitudeDriftMargin(dae, { entry: 11_110_000, bond: true, guide: BOND_GUIDE }).margin, -441_000);
  assert.equal(amplitudeDriftMargin(dae, { entry: 11_110_000, bond: true, guide: null }), null, 'uncostable ⇒ null, not a fake margin');
});

ok('a NON-bond row is byte-identical whether or not the opt-in fields are passed', () => {
  assert.deepEqual(amplitudeRanges(OSC, 1005, { holdDays: 1, bond: false, guide: 1234 }),
    amplitudeRanges(OSC, 1005, { holdDays: 1 }), 'guide is inert without bond:true');
});

console.log(`\namplitudescreen.mjs: ${pass} assertions passed.`);
