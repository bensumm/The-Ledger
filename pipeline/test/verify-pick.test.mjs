/* verify-pick.test.mjs — each rule flips on its own field; one definition of each number; the CLI's usage errors. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parsePick, judge, formatLine, formatWhy, fieldsFrom, RULES, staleLivePrint, sellEarlyTrigger, bidPullingAway, foldUnderBreakEven,
  fadingBidAboveTodaysLow, exitRarelyPrints, noMarginAfterTax, bidAboveMaxBuy, askAbovePeakLevel, staleReach, bidNotTouched, buyLimitSpent, peakWindowMissing, bondFee, noListedLimit, trioArgs, nicheUnfolded, WARN_RULES, dumpRefusal, scanCandidates, scanReport, mapLimit } from '../commands/verify-pick.mjs';
import { breakEven, maxBuyForExit, QUICK_FRESH_MIN } from '../../js/quotecore.js';
import { netMargin } from '../../js/money-math.js';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

const rm = (o = {}) => ({ trend: 'stable', cushionNow: 10, cushionFrom: 12, cushionTo: 10, pace: { onPace: true, liveNow: 1000, medianAtHour: 1000 }, ...o });
const rec = (o = {}) => ({ fullHit: 12, fullN: 14, recentHit: 3, recentDays: 3, staleOptimistic: false, ...o });
const leg = (o = {}) => ({ hit: 12, n: 14, recency: rec(), rm: rm(), ...o });
const base = (o = {}) => ({
  name: 'Test rune', bid: 1000, ask: 1100, be: breakEven(1000), net: netMargin(1000, 1100), maxBuy: maxBuyForExit(1100, 0),
  live: { low: 1005, high: 1095, lowAgeMin: 2, highAgeMin: 3 },
  day: { bid: leg(), ask: leg(), todayLow: 1010 },
  peak: { resolved: true, window: { start: 18, end: 22 }, bid: leg(), ask: leg(), rarelyPrints: false, gap: -5, level: 1105 },
  fold: { estSell: 1080, estSellForward: 1085.4, confidence: { beFloored: false } },
  limit: { limit: 10000, boughtInWindow: 0, remaining: 10000 },
  ...o,
});
const peak = o => ({ ...base().peak, ...o });
const day = o => ({ ...base().day, ...o });
const bad = rm({ trend: 'fading', pace: { onPace: false, liveNow: 980, medianAtHour: 1000 } });
const noPace = rm({ pace: null });

ok('the clean fixture passes every rule', () => { assert.deepEqual(judge(base()), { status: 'PASS', fails: [], unknowns: [], warns: [] }); });
ok('a skill caution warns and never changes the status', () => {
  const f = base({ peak: peak({ gap: 5, level: 1095 }) }), j = judge(f);
  assert.equal(j.status, 'PASS'); assert.equal(j.warns.length, 1); assert.match(formatLine(f, j), /warn: ask 5 above/);
  assert.deepEqual([...WARN_RULES].map(r => r.name).sort(), ['askAbovePeakLevel', 'bidNotTouched', 'bidPullingAway', 'nicheUnfolded', 'noListedLimit', 'staleReach']);
  assert.equal(judge(base({ day: day({ bid: leg({ recency: null }) }) })).status, 'PASS');
});
ok('a bid out of reach at the peak is not a warning: only the all-day bid counts', () => { assert.deepEqual(bidPullingAway(base({ peak: peak({ bid: leg({ rm: bad }) }) })), {}); });
ok('an item with no listed limit warns and can still PASS; an unreadable log cannot', () => {
  const j = judge(base({ limit: { limit: null, boughtInWindow: 0, remaining: null } }));
  assert.equal(j.status, 'PASS'); assert.match(j.warns[0], /no buy limit listed/);
  assert.equal(judge(base({ limit: null })).status, 'UNKNOWN');
});
ok('the trio argv: ask, bid and exit in place, peak window', () => { assert.deepEqual(trioArgs(566, { bid: 371, ask: 395 }), ['566', '--ask', '395', '--bid', '371', '--exit', '395', '--window', 'peak', '--profile', '--json']); });
ok('a bond is UNKNOWN: its retrade fee is not modelled', () => { assert.equal(judge(base({ bond: true })).status, 'UNKNOWN'); assert.deepEqual(bondFee(base()), {}); });

// [rule, name, fields that must FAIL, text, fields that must be UNKNOWN]
const cases = [
  [staleLivePrint, 'instasell print older than the bar', { live: { ...base().live, lowAgeMin: QUICK_FRESH_MIN + 0.1 } }, /stale live print: instasell 16m old/, { live: { ...base().live, highAgeMin: null } }],
  [staleLivePrint, 'instabuy print older than the bar', { live: { ...base().live, highAgeMin: 64 } }, /instabuy 64m old/, { live: null }],
  [sellEarlyTrigger, 'ask trigger in the peak window', { peak: peak({ ask: leg({ rm: bad }) }) }, /⚠⚠ sell-early.*peak/, { peak: peak({ ask: leg({ rm: noPace }) }) }],
  [sellEarlyTrigger, 'ask trigger all-day', { day: day({ ask: leg({ rm: bad }) }) }, /⚠⚠ sell-early.*all-day/, { day: day({ ask: leg({ rm: null }) }) }],
  [sellEarlyTrigger, 'negative cushion that is not fading', { peak: peak({ ask: leg({ rm: rm({ cushionNow: -4, pace: { onPace: false } }) }) }) }, /cushion now −4/, { peak: peak({ ask: null }) }],
  [bidPullingAway, 'bid trigger all-day', { day: day({ bid: leg({ rm: bad }) }) }, /⚠⚠ market pulling away.*all-day/, { day: day({ bid: null }) }],
  [foldUnderBreakEven, 'forward list-at under break-even', { fold: { estSell: 1080, estSellForward: 1019, confidence: {} } }, /list at 1,019 under BE 1,021/, { fold: { estSell: 1080, estSellForward: null, confidence: {} } }],
  [foldUnderBreakEven, 'reach-fold under break-even', { fold: { estSell: 1000, estSellForward: 1085, confidence: {} } }, /reach-fold 1,000 under BE/, { fold: null }],
  [foldUnderBreakEven, 'reach-fold floored to break-even', { fold: { estSell: 1080, estSellForward: 1085, confidence: { beFloored: true } } }, /floored/, { fold: { estSellForward: 1085, confidence: {} } }],
  [foldUnderBreakEven, 'no confidence bundle', { fold: { estSell: 1000, estSellForward: 1085 } }, /reach-fold/, { fold: { estSell: 1080, estSellForward: 1085 } }],
  [fadingBidAboveTodaysLow, 'fading bid under today’s low (all-day)', { day: day({ bid: leg({ rm: rm({ trend: 'fading' }) }) }) }, /today's low 1,010 is above the bid 1,000/, { day: day({ bid: leg({ rm: rm({ trend: 'fading' }) }), todayLow: null }) }],
  [fadingBidAboveTodaysLow, 'fading bid under today’s low (peak)', { peak: peak({ bid: leg({ rm: rm({ trend: 'fading' }) }) }) }, /FADING/, { day: day({ bid: leg({ rm: rm({ trend: null }) }) }) }],
  [exitRarelyPrints, 'exit rarely prints in-window', { peak: peak({ rarelyPrints: true, ask: leg({ hit: 6, n: 14 }) }) }, /rarely prints in-window \(6\/14\)/, { peak: peak({ rarelyPrints: undefined }) }],
  [noMarginAfterTax, 'no net after tax', { net: 0 }, /no margin after tax/, { net: null }],
  [noMarginAfterTax, 'ask under break-even', { ask: 1020, net: -1 }, /ask 1,020 vs BE 1,021/, { be: null }],
  [bidAboveMaxBuy, 'bid above the back-solved buy', { maxBuy: 999 }, /bid 1,000 above max profitable buy 999/, { maxBuy: undefined }],
  [bidAboveMaxBuy, 'exit carries no profitable buy', { maxBuy: null }, /no profitable buy/, { maxBuy: undefined }],
  [askAbovePeakLevel, 'ask above the peak level', { peak: peak({ gap: 5, level: 1095 }) }, /ask 5 above the peak window's level 1,095/, { peak: peak({ gap: null }) }],
  [staleReach, 'stale bid reach', { day: day({ bid: leg({ recency: rec({ staleOptimistic: true, recentHit: 0 }) }) }) }, /bid reach ⚠ stale all-day \(recent 0\/3/, { day: day({ bid: leg({ recency: null }) }) }],
  [staleReach, 'stale ask reach in the peak window', { peak: peak({ ask: leg({ recency: rec({ staleOptimistic: true, recentHit: 0 }) }) }) }, /ask reach ⚠ stale in peak/, { peak: peak({ ask: leg({ recency: rec({ fullN: 4 }) }) }) }],
  [bidNotTouched, 'no recent touch and live above the bid', { day: day({ bid: leg({ recency: rec({ recentHit: 0 }) }) }) }, /touched on 0\/3 recent days and live 1,005/, { day: day({ bid: leg({ recency: rec({ recentDays: 0 }) }) }) }],
  [buyLimitSpent, 'limit exhausted', { limit: { limit: 100, boughtInWindow: 100, remaining: 0 } }, /buy limit exhausted \(100\/100/, { limit: { limit: 100, boughtInWindow: 0, remaining: null } }],
  [buyLimitSpent, 'more bought than the limit', { limit: { limit: 100, boughtInWindow: 120, remaining: 0 } }, /exhausted/, { limit: null }],
];
for (const [rule, name, f, re, u] of cases) {
  ok(`${rule.name}: FAIL — ${name}`, () => {
    assert.match(rule(base(f)).fail ?? '', re);
    if (WARN_RULES.has(rule)) assert.ok(judge(base(f)).warns.length && !judge(base(f)).fails.includes(rule(base(f)).fail));
    else assert.equal(judge(base(f)).status, 'FAIL');
  });
  ok(`${rule.name}: UNKNOWN when its input is missing (${name})`, () => {
    const r = rule(base(u));
    assert.ok(r.unknown && !r.fail, JSON.stringify(r));
    if (!WARN_RULES.has(rule)) assert.notEqual(judge(base(u)).status, 'PASS');
  });
  ok(`${rule.name}: silent on the clean fixture (${name})`, () => assert.deepEqual(rule(base()), {}));
}
ok('every rule in RULES has a flipping case or the window case', () => {
  const tested = new Set([...cases.map(c => c[0]), peakWindowMissing, bondFee, noListedLimit, nicheUnfolded]);
  for (const r of RULES) assert.ok(tested.has(r), r.name);
  assert.equal(tested.size, RULES.length);
});
ok('peakWindowMissing: a fallback window is UNKNOWN, never a pass', () => {
  assert.match(peakWindowMissing(base({ peak: peak({ resolved: false }) })).unknown, /peak window/);
  assert.equal(judge(base({ peak: peak({ resolved: false }) })).status, 'UNKNOWN');
  assert.deepEqual(peakWindowMissing(base()), {});
});
ok('a stale pace (unevaluable trigger) is UNKNOWN, not a quiet pass', () => {
  assert.equal(judge(base({ day: day({ ask: leg({ rm: rm({ pace: { stale: true, ageMin: 40 } }) }) }) })).status, 'UNKNOWN');
});
ok('an exactly-at-bar print is fresh; a fading bid at today’s low is not a fail', () => {
  assert.deepEqual(staleLivePrint(base({ live: { ...base().live, lowAgeMin: QUICK_FRESH_MIN } })), {});
  assert.deepEqual(fadingBidAboveTodaysLow(base({ day: day({ bid: leg({ rm: rm({ trend: 'fading' }) }), todayLow: 1000 }) })), {});
});
ok('a bid live or today already reached is not an untouched bid', () => {
  const bid = leg({ recency: rec({ recentHit: 0 }) });
  assert.deepEqual(bidNotTouched(base({ day: day({ bid, todayLow: 1000 }) })), {});
  assert.deepEqual(bidNotTouched(base({ day: day({ bid }), live: { ...base().live, low: 1000 } })), {});
});
ok('both stale sides are named', () => {
  assert.equal(staleLivePrint(base({ live: { ...base().live, lowAgeMin: 40, highAgeMin: 50 } })).fail, 'stale live print: instasell 40m old, stale live print: instabuy 50m old');
});
ok('a fail in one window outranks an unknown in the other', () => {
  assert.ok(sellEarlyTrigger(base({ peak: null, day: day({ ask: leg({ rm: bad }) }) })).fail);
  assert.ok(staleLivePrint(base({ live: { ...base().live, lowAgeMin: null, highAgeMin: 90 } })).fail);
});
ok('FAIL outranks UNKNOWN and both are listed; nothing at all is UNKNOWN', () => {
  const j = judge(base({ maxBuy: 5, limit: null }));
  assert.equal(j.status, 'FAIL'); assert.equal(j.unknowns.length, 1);
  assert.equal(judge({ name: 'x', bid: 1, ask: 2 }).status, 'UNKNOWN');
});
ok('bid above ask on real numbers fails', () => {
  const f = base({ bid: 1100, ask: 1000, be: breakEven(1100), net: netMargin(1100, 1000), maxBuy: maxBuyForExit(1000, 0) });
  assert.ok(noMarginAfterTax(f).fail && bidAboveMaxBuy(f).fail);
});

ok('parsePick accepts k/m/b, decimals, commas and an id', () => {
  assert.deepEqual(parsePick('Soul rune@371:395'), { item: 'Soul rune', bid: 371, ask: 395, niche: 'band' });
  assert.deepEqual(parsePick('566@1.2k:1.25k'), { item: '566', bid: 1200, ask: 1250, niche: 'band' });
  assert.deepEqual(parsePick('Twisted bow@1.5b:1.61b'), { item: 'Twisted bow', bid: 1.5e9, ask: 1.61e9, niche: 'band' });
  assert.deepEqual(parsePick('Fang@30.1m:31,200,000'), { item: 'Fang', bid: 30100000, ask: 31200000, niche: 'band' });
});
ok('parsePick takes a niche suffix and refuses an unknown one', () => {
  assert.equal(parsePick('Soul rune@371:395@Churn').niche, 'churn');
  assert.equal(parsePick('Fang@30m:31m@amplitude').niche, 'amplitude');
  assert.equal(parsePick('Fang@30m:31m@nope'), null);
});
ok('trioArgs passes --niche only where read-window-range has that fold; the rest is a warn', () => {
  assert.deepEqual(trioArgs(566, { bid: 371, ask: 395, niche: 'churn' }).slice(-2), ['--niche', 'churn']);
  assert.ok(!trioArgs(566, { bid: 371, ask: 395, niche: 'amplitude' }).includes('--niche'));
  assert.match(nicheUnfolded(base({ niche: 'amplitude' })).fail, /no amplitude fold/);
  assert.deepEqual(nicheUnfolded(base({ niche: 'churn' })), {});
});
for (const s of ['', 'Soul rune', 'Soul rune@371', '@371:395', 'Soul rune@x:395', 'Soul rune@371:', 'Soul rune@0:395', 'Soul rune@-5:395', 'Soul rune@371:395:400', 'a@b@1:2'])
  ok(`parsePick refuses ${JSON.stringify(s)}`, () => assert.equal(parsePick(s), null));

ok('one line per pick, with the fields in order', () => {
  assert.equal(formatLine(base(), judge(base())), 'PASS Test rune 1,000→1,100 +78 BE 1,021 · reach bid 12/14 ask 12/14 (peak ask 12/14) · 10,000 left');
  const f = base({ maxBuy: 999 }), x = formatLine(f, judge(f));
  assert.match(x, /^FAIL /); assert.ok(!x.includes('\n'));
  const u = formatLine({ name: 'x', bid: 1, ask: 2 }, judge({ name: 'x', bid: 1, ask: 2 }));
  assert.match(u, /^UNKNOWN x 1→2 — BE — · reach bid — ask —/); assert.ok(!u.includes('\n'));
});
ok('--why survives a missing block and names every rule', () => {
  for (const f of [base(), { name: 'x', bid: 1, ask: 2 }]) for (const r of RULES) assert.ok(formatWhy(f).includes(r.name), r.name);
});

const now = new Date(2026, 5, 20, 15, 30);
const series = [];
for (let d = 14; d >= 0; d--) for (let h = 0; h < 24; h++) {
  const t = new Date(2026, 5, 20 - d, h);
  if (t <= now) series.push({ timestamp: t / 1000, avgLowPrice: 1000 + (d ? 0 : 7) + h, avgHighPrice: 1100 + h, lowPriceVolume: 50, highPriceVolume: 50 });
}
const trio = {
  item: 'Test rune', window: { start: 18, end: 22, resolvedFrom: 'peak' }, windowScored: { peak: { level: 1105, user: { gap: -5 } } },
  bid: { touchedDays: 9, nDays: 14, recency: rec(), reachMargin: rm() }, ask: { reachedDays: 8, nDays: 14, recency: rec(), reachMargin: rm() },
  exit: { maxBuy: 1078, rarelyPrints: false }, fold: base().fold,
};
const nowSec = now / 1000;
const inputs = { name: 'Test rune', bid: 1000, ask: 1100, trio, series, latest: { low: 1005, high: 1095, lowTime: nowSec - 120, highTime: nowSec - 1800 }, limit: base().limit, now };
ok('fieldsFrom reads the trio and scores the full local day, hour 23 included', () => {
  const f = fieldsFrom(inputs);
  assert.deepEqual([f.peak.resolved, f.peak.rarelyPrints, f.peak.gap, f.peak.level, f.peak.ask.hit, f.peak.ask.n, f.maxBuy], [true, false, -5, 1105, 8, 14, 1078]);
  assert.equal(f.day.todayLow, 1007);
  assert.equal(f.day.bid.n, 14); assert.equal(f.day.bid.hit, 14);
  assert.equal(fieldsFrom({ ...inputs, ask: 1123 }).day.ask.hit, 14);
  assert.equal(f.live.lowAgeMin, 2); assert.equal(f.live.highAgeMin, 30);
  assert.equal(f.day.ask.rm.pace.stale, true);
  assert.equal(f.be, breakEven(1000)); assert.equal(f.net, netMargin(1000, 1100));
});
for (const [name, o] of [['trio', { trio: null }], ['series', { series: null }], ['points in the series', { series: [] }], ['latest', { latest: null }], ['limit', { limit: null }]])
  ok(`fieldsFrom with no ${name}: never PASS, never throws`, () => { assert.notEqual(judge(fieldsFrom({ ...inputs, ...o })).status, 'PASS'); });
ok('an exit with no profitable buy is null, a missing exit block undefined', () => {
  assert.equal(fieldsFrom({ ...inputs, trio: { ...trio, exit: { maxBuy: null } } }).maxBuy, null);
  assert.equal(fieldsFrom({ ...inputs, trio: { ...trio, exit: undefined } }).maxBuy, undefined);
});

const T = Date.parse('2026-06-20T12:00:00Z'), dump = min => ({ generatedAt: new Date(T - min * 60000).toISOString(), laneRows: [] });
ok('--scan refuses a dump over 30 min old, undated, or without laneRows', () => {
  assert.equal(dumpRefusal(dump(30), T), null);
  assert.match(dumpRefusal(dump(30.3), T), /30m old \(limit 30m\)/);
  assert.match(dumpRefusal({ ...dump(5), laneRows: undefined }, T), /no laneRows.*5m old/);
  assert.match(dumpRefusal({ laneRows: [] }, T), /no readable age/);
  assert.match(dumpRefusal(null, T), /no laneRows/);
});
const L = (itemId, mode, o = {}) => ({ itemId, name: 'i' + itemId, mode, grade: 'B', bid: 100, ask: 110, netEach: 8, units: 10, ...o });
ok('--scan candidates: digest, all churn, top N band by net × units, one per item+mode', () => {
  const c = scanCandidates({ digestRows: [L(1, 'band'), L(7, 'amplitude')], laneRows: [L(1, 'band', { units: 1 }), L(2, 'band', { units: 50 }), L(3, 'band', { units: 20 }),
    L(4, 'churn', { units: 0 }), L(5, 'churn'), L(1, 'churn'), L(7, 'amplitude'), L(8, 'amplitude')] }, 1);
  assert.deepEqual(c.picks.map(r => r.itemId + r.mode), ['1band', '4churn', '5churn', '1churn', '2band']);
  assert.deepEqual([c.amplitude, c.bonds, c.unpriced, c.bandTotal], [2, 0, 0, 3]);
});
ok('--scan counts bonds and unpriced rows instead of checking them; no size keeps table order', () => {
  const c = scanCandidates({ laneRows: [L(13190, 'band'), L(2, 'churn', { ask: null }), L(3, 'band', { bid: 0 })] });
  assert.deepEqual([c.picks.length, c.bonds, c.unpriced], [0, 1, 2]);
  assert.deepEqual(scanCandidates({ laneRows: [L(1, 'band', { units: null }), L(2, 'band', { units: 0, netEach: 9 })] }, 1).picks.map(r => r.itemId), [1]);
});
const res = (o, row) => { const f = base(o); return { row: L(1, 'churn', row), f, j: judge(f) }; };
ok('--scan report: clean PASS, PASS ⚠, then one tally line; --all adds the FAIL lines', () => {
  const rs = [res({ maxBuy: 999, name: 'F1' }), res({ peak: peak({ gap: 5, level: 1095 }), name: 'W' }), res({ limit: null, name: 'U' }), res({ name: 'P' }, { grade: null, mode: 'band' }), res({ maxBuy: null, net: 0, name: 'F2' })];
  const out = scanReport(rs);
  assert.match(out[0], /^PASS P .* · band —$/); assert.match(out[1], /^PASS ⚠ W .*warn: .* · churn B$/);
  assert.equal(out[2], 'FAIL 2: bid above max buy 1, no margin after tax 1 · UNKNOWN 1: U'); assert.equal(out.length, 3);
  assert.equal(scanReport(rs, { all: true }).filter(l => /^FAIL F/.test(l)).length, 2);
});
ok('--scan says so when nothing passes', () => {
  assert.match(scanReport([res({ net: 0 })])[0], /nothing clears at screen prices \(1 checked\)/);
  assert.match(scanReport([res({ limit: null })])[0], /1 checked, 1 UNKNOWN/);
  assert.match(scanReport([])[0], /0 checked/);
});
{
  let live = 0, max = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async x => { max = Math.max(max, ++live); await new Promise(r => setTimeout(r, 5)); live--; return x * 2; });
  ok('mapLimit keeps order and its bound', () => { assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14]); assert.equal(max, 3); });
}

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'commands', 'verify-pick.mjs');
for (const a of [[], ['Soul rune'], ['Soul rune@371:395', 'junk'], ['--why'], ['Soul rune@371:395', '--wat'], ['--all'], ['--scan', '0'], ['--scan', 'x'], ['--scan', 'Soul rune@371:395'], ['--scan', '5', '6']])
  ok(`usage error exits 1: ${JSON.stringify(a)}`, () => {
    const r = spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8' });
    assert.equal(r.status, 1); assert.match(r.stderr, /usage/);
  });
console.log(`verify-pick: ${pass} passed`);
