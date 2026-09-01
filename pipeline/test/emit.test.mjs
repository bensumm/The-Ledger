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
import fs from 'node:fs';
import { heldNoteBlock, heldListAt, formatAsymFill, asymClassRateNote,
  ASYM_RT_24H_PCT, ASYM_RT_24H_BIG_PCT, ASYM_MEASURED_ROWS } from '../lib/render/emit.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

const sellLine = lines => lines.find(l => l.includes('sell: list @'));

/* --- reachRead — its position in the note contract ---------------------------------------------- */
ok('reachRead renders after marginBudget and before the guaranteed sell line', () => {
  // MUTANT: reorder reachRead before marginBudget — red. (After the sell line is already covered by
  // the sell-line-is-LAST case below; this case earns its keep on the marginBudget ordering alone.)
  const lines = heldNoteBlock({
    name: 'Dragon warhammer', verdict: 'HOLD.',
    marginBudget: 'margin budget: given back 6.2% of the original ask',
    reachRead: 'reach: margin +275 today · cushion fading +49→+275 (7d)',
    listAt: 30_000_000, breakEven: 29_000_000,
  });
  assert.equal(lines.length, 4);
  assert.ok(lines[1].includes('margin budget'));
  assert.ok(lines[2].includes('reach: margin'));
  assert.ok(lines[3].startsWith('    sell: list @'));
});

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

/* --- depthReachClause: DELETED 2026-08-30 with the pressure exit retirement -------------------- */
// Its only render path was gated on the retired --pressure-exit trial. The retirement pin: the
// retired clause and its trial flag must not resurface in the two commands that carried them.
ok('RETIRED: depthReachClause and the --pressure-exit gate are gone from watch/quote', () => {
  const watch = fs.readFileSync('pipeline/commands/watch-positions.mjs', 'utf8');
  const quote = fs.readFileSync('pipeline/commands/quote-items.mjs', 'utf8');
  for (const [name, src] of [['watch-positions', watch], ['quote-items', quote]]) {
    assert.ok(!src.includes('depthReachClause('), name + ' no longer calls the deleted clause');
    assert.ok(!src.includes('PRESSURE_EXIT'), name + ' no longer branches on the retired trial flag');
  }
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


/* asymClassRateNote — the ONE-TIME class-rate footer (PLAN-PATIENT-PAIR §7). It exists because the
   per-row counts are in-sample tallies and a reader had to supply "so how often does this complete?"
   from nowhere. The measured answer is ~4.3%, so the wording has to survive being read by someone
   who wants it to be good news. */
ok('asymClassRateNote: names the measured rate, both strata, and refuses to be a per-row number', () => {
  const t = asymClassRateNote();
  assert.match(t, /4\.3%/, 'the pooled round trip is named');
  assert.match(t, /1\.5%/, 'the big-ticket stratum is named — it is the class the plan was written about');
  assert.match(t, /CLASS rate, not this row/, 'MUTANT: drop the class-vs-row disclaimer — red. 766 items, not this item');
  assert.match(t, /touched\/reached ≠ filled/, 'MUTANT: drop the upper-bound caveat — red');
  assert.match(t, /IN-SAMPLE/, 'MUTANT: call the per-row counts a fill rate — red');
  assert.doesNotMatch(t, /placeholder/i, 'they are no longer placeholders; they are measured, and measured wrong');
});

ok('asymClassRateNote: the numbers come from the exported constants, never a restated literal', () => {
  // This assertion was WRONG before, and green: it claimed "MUTANT: hardcode 4.3 in the template" would
  // go red, and hardcoding it left all checks passing — because interpolating a constant and pasting its
  // current value produce the identical STRING. A false mutant claim in a guard's own comment is the
  // failure class the repo's rule 10 anchors on, so the check is now on the SOURCE, where the difference
  // actually lives. MUTANT: replace either \${ASYM_RT_24H_PCT} or \${ASYM_RT_24H_BIG_PCT} in emit.mjs's
  // template with its literal value — red. Verified by applying exactly that.
  const src = fs.readFileSync(new URL('../lib/render/emit.mjs', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export function asymClassRateNote'));
  const fn = body.slice(0, body.indexOf('\n}'));
  assert.ok(fn.includes('${ASYM_RT_24H_PCT}'), 'the pooled rate must be INTERPOLATED, not pasted');
  assert.ok(fn.includes('${ASYM_RT_24H_BIG_PCT}'), 'the big-ticket rate must be INTERPOLATED, not pasted');
  assert.doesNotMatch(fn, /\d+\.\d+%/, 'no bare decimal percentage literal may appear in the template');
  // and the rendered text still carries them (escaped — an unescaped '.' here matched "~4X3%").
  const esc = x => String(x).replace('.', '\\.');
  assert.match(asymClassRateNote(), new RegExp(`~${esc(ASYM_RT_24H_PCT)}% within 24h`));
  assert.match(asymClassRateNote(), new RegExp(`~${esc(ASYM_RT_24H_BIG_PCT)}% on`));
  assert.ok(ASYM_RT_24H_BIG_PCT < ASYM_RT_24H_PCT,
    'the big-ticket stratum converts WORSE than pooled — that ordering is the finding, not a typo');
});

console.log(`\nAll ${pass} checks passed.`);
