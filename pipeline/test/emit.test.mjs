#!/usr/bin/env node
/**
 * emit.test.mjs — the watch-positions.mjs per-HELD-item emit contract (chunk V5).
 *
 * emit.mjs orders + formats the already-computed pieces of a held-lot note block into ONE stable,
 * consistently-ordered shape. It decides nothing (V5 is output-format-only). This pins the contract
 * so a future editor can't silently drop the guaranteed sell field or re-order the block.
 *
 * BUSINESS REQUIREMENTS (what must not break):
 *   - The block ALWAYS emits a sell line (`sell: list @ X · break-even Y`) on a held lot — the
 *     standing user rule (Ben, 2026-07-06): always state the sell price for every held item.
 *   - Field ORDER is fixed: verdict → conviction → Δ → tripwire → sell. Optional fields drop out
 *     when null, WITHOUT shifting the sell line off the end.
 *   - `heldListAt` prefers the shared momVerdict's listAt; falls back to band-top-floored-at-BE,
 *     else max(instabuy, BE), else BE — never null when the lot is priceable.
 *
 * Synthetic fixtures only. Run: `node pipeline/test/emit.test.mjs` (exits non-zero on any failure).
 */
import assert from 'node:assert/strict';
import { heldNoteBlock, heldListAt, depthReachClause, formatAsymFill } from '../lib/render/emit.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

const sellLine = lines => lines.find(l => l.includes('sell: list @'));

/* --- the sell line is ALWAYS present, and is always LAST -------------------------------------- */
ok('a quiet held lot (no conviction/delta/tripwire) still emits the sell line, last', () => {
  const lines = heldNoteBlock({
    name: 'Bandos chestplate', verdict: 'HOLD — list @ 21.1m (break-even-floored).',
    window: null, reliableReason: null,
    conviction: null, delta: null, tripwire: null,
    listAt: 21_100_000, breakEven: 20_500_000, fillProgress: 'NOT LISTED',
  });
  assert.equal(lines.length, 2);                 // header + guaranteed sell line only
  assert.ok(lines[0].startsWith('- Bandos chestplate:'));
  assert.equal(lines[1], '    sell: list @ 21.10m · break-even 20.50m · NOT LISTED');
});

ok('the sell line survives even when every optional field is present, and stays LAST', () => {
  const lines = heldNoteBlock({
    name: 'Twisted bow', verdict: 'CUT-CANDIDATE @ 1.63b — underwater.',
    window: 'ask 1.7b reached 3/7d', reliableReason: null,
    conviction: 'CUT-CANDIDATE armed — 1st underwater pass…',
    delta: 'Δ instabuy -12m (5m) · 2nd pass underwater',
    tripwire: 'support 1.60b · cut-trigger 1.59b (context — not a verdict)',
    listAt: 1_670_000_000, breakEven: 1_640_000_000, fillProgress: 'ask 5/10 @ 1.7b',
  });
  // order: header, conviction, delta, tripwire, sell
  assert.equal(lines.length, 5);
  assert.ok(lines[0].includes('CUT-CANDIDATE'));
  assert.ok(lines[1].includes('armed'));
  assert.ok(lines[2].startsWith('    Δ instabuy'));
  assert.ok(lines[3].startsWith('    support'));
  assert.equal(lines[4], '    sell: list @ 1.67b · break-even 1.64b · ask 5/10 @ 1.7b');
  assert.equal(sellLine(lines), lines[lines.length - 1]);  // ALWAYS last
});

ok('P4b: an optional path line slots between recovery and the sell line; omitted when null', () => {
  const base = {
    name: 'Decay knife', verdict: 'CUT-CANDIDATE @ 39.5k — underwater.',
    window: null, reliableReason: null,
    conviction: null, delta: null, tripwire: null, recovery: 'recovery-read: likely drops — decay',
    listAt: 42_000, breakEven: 42_000, fillProgress: null,
  };
  const withPath = heldNoteBlock({ ...base, path: 'path MIGRATED hold-recovery → cut 0.89 (support, not a verdict)' });
  assert.equal(withPath.length, 4);                       // header, recovery, path, sell
  assert.ok(withPath[1].includes('recovery-read'));
  assert.ok(withPath[2].includes('path MIGRATED'), 'the path line rides after recovery');
  assert.equal(sellLine(withPath), withPath[withPath.length - 1], 'the sell line is STILL last');
  // no path → byte-identical to the pre-P4b block
  const noPath = heldNoteBlock(base);
  assert.deepEqual(noPath, [withPath[0], withPath[1], withPath[3]]);
});

ok('window + reliability flag ride the header line; a null fillProgress drops from the sell line', () => {
  const lines = heldNoteBlock({
    name: 'Dragon bones', verdict: 'HOLD — list @ 2.5k.',
    window: 'ask 2.6k reached 5/7d', reliableReason: 'feed-inversion',
    conviction: null, delta: null, tripwire: null,
    listAt: 2500, breakEven: 2450, fillProgress: null,
  });
  assert.ok(lines[0].includes('· window ask 2.6k reached 5/7d'));
  assert.ok(lines[0].includes('· ⚠ feed-inversion'));
  assert.equal(lines[1], '    sell: list @ 2,500 · break-even 2,450');   // no trailing fill-progress
});

ok('optional pressure rides the header line between window and the reliability flag; omitted when null', () => {
  const base = {
    name: 'Dragon bones', verdict: 'HOLD — list @ 2.5k.',
    window: 'ask 2.6k reached 5/7d', reliableReason: 'feed-inversion',
    conviction: null, delta: null, tripwire: null,
    listAt: 2500, breakEven: 2450, fillProgress: null,
  };
  const withPress = heldNoteBlock({ ...base, pressure: 'buy 1.4×' });
  assert.ok(withPress[0].includes('· window ask 2.6k reached 5/7d · pressure buy 1.4× · ⚠ feed-inversion'));
  // no pressure → byte-identical to the pre-pressure block
  assert.deepEqual(heldNoteBlock(base), heldNoteBlock({ ...base, pressure: null }));
});

/* --- heldListAt precedence ------------------------------------------------------------------- */
ok('heldListAt prefers the momVerdict listAt when present', () => {
  const mv = { listAt: 18_550_000 };
  assert.equal(heldListAt({ quickSell: 18_100_000, optSell: 18_900_000 }, 18_000_000, mv), 18_550_000);
});

ok('no mv → band top when it clears break-even, else max(instabuy, BE), else BE', () => {
  // band top ≥ BE → band top
  assert.equal(heldListAt({ quickSell: 100, optSell: 130 }, 110, null), 130);
  // band top < BE → max(instabuy, BE) = BE here (instabuy 100 < BE 120)
  assert.equal(heldListAt({ quickSell: 100, optSell: 105 }, 120, null), 120);
  // band top < BE, instabuy > BE → instabuy
  assert.equal(heldListAt({ quickSell: 125, optSell: 105 }, 120, null), 125);
  // nothing priceable → degrade to BE (never null)
  assert.equal(heldListAt({ quickSell: null, optSell: null }, 120, null), 120);
});

/* --- depthReachClause (PLAN-DEPTH-EXIT DE3): the two-lens depth/pressure clause ---------------- */
// The golden diff of the two paths: a NON-NULL depth read renders the size-honest floor (framed as
// a floor, never "the" price) beside the pressure-reachable; a COLLAPSED read renders its REASON —
// never a bare fallback (Ben's hard requirement: a silent degrade is a defect).
ok('DE3: a non-null depth read renders the floor + the pressure-reachable beside it (two lenses)', () => {
  const ca = { price: 394, clearFrac: 0.7857, nDays: 14, competition: 4, qty: 25000 };
  const rb = { ask: 401, bid: 383, pressure: 1.66, reliability: 1 };
  const s = depthReachClause({ ca, rb, qty: 25000 });
  assert.equal(s, 'depth floor: book 25ku @ ≤394 on ~79% of 14d (est ×4 comp — size-honest, smoothing-conservative) · reachable ask ~401 / bid ~383 (pressure 1.7× buy-heavy)');
});

ok('DE3: a collapsed depth read prints its REASON (never a silent fallback), per reason', () => {
  const insuff = depthReachClause({ ca: { price: null, reason: 'insufficient-depth', competition: 4, qty: 100 }, qty: 100 });
  assert.equal(insuff, 'depth n/a — book absorbs <4× your 100u lot; reach fallback');
  const thin = depthReachClause({ ca: { price: null, reason: 'thin-history', competition: 4 }, qty: 50 });
  assert.equal(thin, 'depth n/a — too little day history; reach fallback');
  const none = depthReachClause({ ca: { price: null, reason: 'no-prints', competition: 4 }, qty: 50 });
  assert.equal(none, 'depth n/a — no traded buckets; reach fallback');
});

ok('DE3: reachable alone renders (depth read absent); sub-1 reliability is stated; nothing → null', () => {
  const rbOnly = depthReachClause({ rb: { ask: 1104, bid: 968, pressure: 0.5, reliability: 0.4 } });
  assert.equal(rbOnly, 'reachable ask ~1,104 / bid ~968 (pressure 0.5× sell-heavy, rel 0.40)');
  assert.equal(depthReachClause({}), null, 'no reads → null (the caller keeps its current line)');
  assert.equal(depthReachClause({ rb: { ask: null } }), null);
});

/* formatAsymFill — the ◆ asym fill clause pair. The BUSINESS REQUIREMENT: a reach count must never be
   printed as though it described a price it was not measured at. asymEstimate's ordering guards can
   move bid/ask off the quantile levels pAsk/pBid were counted at, and when they do the quoted price is
   a live transact-now one — so the clause has to name the measured LEVEL beside its count. (The counts
   stay honest either way: a bound guard means that leg fills now, so the count is a floor. It was the
   sentence that lied, not the number — see the formatAsymFill header.) */
const AP = { deepBid: 100, highReachAsk: 140, nDays: 14, nAsk: 14, nBid: 14 };
const AE = { bid: 100, ask: 140, pAsk: 12 / 14, pBid: 5 / 14, nDays: 14 };

ok('formatAsymFill: neither guard binds ⇒ the count attaches to the quoted price directly', () => {
  const af = formatAsymFill(AE, AP);
  assert.equal(af.askTxt, 'ask 140 (printed 12/14d)');
  assert.equal(af.bidTxt, 'deep-bid 100 (touched 5/14d — rest as optionality)');
});

ok('formatAsymFill: ask guard BINDS ⇒ names the live price AND the level the count belongs to', () => {
  const af = formatAsymFill({ ...AE, ask: 150 }, AP);
  assert.equal(af.askTxt, 'ask 150 (= live instabuy, above the 140 level that printed 12/14d)');
  // the regression this pins: the OLD wording rendered `ask 150 (prints ~12/14d)`, asserting a reach
  // for 150 that was measured at 140. The quoted price must never sit directly against the count.
  assert.ok(!/150 \(printed/.test(af.askTxt), 'the count must not be attached to the guarded price');
});

ok('formatAsymFill: bid guard BINDS ⇒ same treatment, and it stays resting optionality', () => {
  const af = formatAsymFill({ ...AE, bid: 90 }, AP);
  assert.equal(af.bidTxt, 'deep-bid 90 (= live instasell, below the 100 level that touched 5/14d — rest as optionality)');
});

ok('formatAsymFill: states no EXECUTION claim — the repo measured quickBuy/quickSell as not click-prices', () => {
  // quotecore.js's header records n=4 real round trips coming out REVERSED against the model's
  // quick legs. A draft of this clause said "clears now"/"buys now"; that verb must not return.
  const bound = formatAsymFill({ ...AE, ask: 150, bid: 90 }, AP);
  for (const t of [bound.askTxt, bound.bidTxt]) {
    assert.ok(!/clears now|buys now|fills now/.test(t), `execution claim leaked: ${t}`);
    assert.ok(!/\bprints\b|\bfills ~/.test(t), `present-tense reach claim leaked: ${t}`);
  }
});

ok('formatAsymFill: the tally uses pAsk\'s OWN denominator, never nDays', () => {
  // windowStats drops days with no print, so his/lows can be shorter than nDays. Rendering
  // pAsk × nDays printed a count over days the fraction never scored (10/12 → "12/14d").
  const af = formatAsymFill({ ...AE, pAsk: 10 / 12, pBid: 3 / 11 }, { ...AP, nAsk: 12, nBid: 11 });
  assert.equal(af.askTxt, 'ask 140 (printed 10/12d)');
  assert.equal(af.bidTxt, 'deep-bid 100 (touched 3/11d — rest as optionality)');
  const legacy = formatAsymFill(AE, { deepBid: 100, highReachAsk: 140, nDays: 14 });
  assert.equal(legacy.askTxt, 'ask 140 (printed 12/14d)', 'a pair without nAsk/nBid falls back to nDays');
});

ok('formatAsymFill: full-gp resolution — a sub-bucket guard gap must not render as two equal prices', () => {
  // `fmt` buckets to 0.1k above 1e3, which collapsed `ask 5,240 … 5,220` into "5.2k … 5.2k" —
  // a self-contradicting sentence. Same class d37e818 fixed for offer prices in read-schedule.
  const af = formatAsymFill({ ...AE, bid: 5000, ask: 5240 }, { ...AP, deepBid: 5000, highReachAsk: 5220 });
  assert.equal(af.askTxt, 'ask 5,240 (= live instabuy, above the 5,220 level that printed 12/14d)');
  assert.ok(!/5\.2k/.test(af.askTxt), 'bucketed rendering would make the two prices indistinguishable');
});

ok('formatAsymFill: above fmtP\'s 100k full-gp cutoff, a sub-bucket gap drops the level clause', () => {
  // fmtP falls back to fmt (0.1k buckets) at/above 100k, so a big-ticket guard binding by a few gp
  // renders both prices identically. Naming a level that displays the same as the price is nonsense;
  // at that resolution they ARE the same level, so the plain form is the honest one.
  const af = formatAsymFill({ ...AE, bid: 219_910, ask: 219_940 }, { ...AP, deepBid: 219_950, highReachAsk: 219_910 });
  assert.equal(af.askTxt, 'ask 219.9k (printed 12/14d)', 'collapsed pair ⇒ no self-contradicting clause');
  assert.ok(!/above the/.test(af.askTxt) && !/below the/.test(af.bidTxt));
  // but a gap the display CAN resolve is still named
  const wide = formatAsymFill({ ...AE, ask: 220_200 }, { ...AP, highReachAsk: 218_500 });
  assert.equal(wide.askTxt, 'ask 220.2k (= live instabuy, above the 218.5k level that printed 12/14d)');
});

ok('formatAsymFill: degrades to null rather than inventing a count', () => {
  assert.equal(formatAsymFill(null, AP), null);
  assert.equal(formatAsymFill(AE, null), null);
  assert.equal(formatAsymFill({ ...AE, ask: null }, AP), null, 'no ask ⇒ nothing to say');
  assert.equal(formatAsymFill(AE, { ...AP, nAsk: 0, nBid: 0, nDays: 0 }), null, 'no scored days ⇒ no denominator');
});

console.log(`\nAll ${pass} checks passed.`);
