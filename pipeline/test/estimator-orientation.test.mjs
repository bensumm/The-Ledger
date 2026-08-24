/**
 * estimator-orientation.test.mjs — the LIVE-PAIR ORIENTATION contract for estimatePair's callers.
 *
 * WHY THIS EXISTS. `js/quotecore.js` defines quickBuy = latest.low (the INSTASELL — where your buy fills)
 * and quickSell = latest.high (the INSTABUY — where your sell fills). estimatePair's ordering clamps are
 * written for exactly that. `read-window-range.mjs` builds a SYNTHETIC row instead of a computeQuote row,
 * and it had the two reversed — because pair.mjs's own comments had the labels backwards in three places.
 *
 * The swap is silent: no crash, no null, every CI gate green. It just raises estBuy to the instabuy,
 * carries break-even up with it, and reports `beFloored` — "nothing to price above break-even" — on rows
 * the screen prices as profitable, while the file's own comment claims byte-parity with the screen.
 *
 * Each case names the mutant it kills. Run: `node pipeline/test/estimator-orientation.test.mjs`.
 * Auto-discovered by run-tests.mjs. PURE/synthetic — no fetch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { estimatePair } from '../../js/estimators.mjs';
import { FLIP_NICHES } from '../../js/flip-niches.mjs';
import fs from 'node:fs';
import { computeQuote } from '../../js/quotecore.js';
import { driftExitFrom } from '../../js/forecast.mjs';

// A real non-inverted shape: instasell 19,236,849 / instabuy 19,300,000, ask level 19,763,111.
const LOW = 19_236_849, HIGH = 19_300_000, ASK = 19_763_111;
const EXTRA = { askReach: { reachedDays: 8, nDays: 14, recentHit: 3, recentDays: 3 } };
const est = row => estimatePair(FLIP_NICHES.band, row, EXTRA, { sellModel: 'reach-fold' });

const correct = { quickBuy: LOW, quickSell: HIGH, optBuy: LOW, optSell: ASK };
const swapped = { quickBuy: HIGH, quickSell: LOW, optBuy: HIGH, optSell: ASK };

test('quotecore is the ORIENTATION AUTHORITY: quickBuy is latest.low, quickSell is latest.high', () => {
  // MUTANT: swap the two in quotecore — red. Pins the definition every synthetic row must match, read
  // from the real function rather than restated, so it cannot drift away from the source.
  const q = computeQuote({ latest: { low: LOW, high: HIGH } }, {});
  assert.equal(q.quickBuy, LOW, 'quickBuy must be the instasell (latest.low)');
  assert.equal(q.quickSell, HIGH, 'quickSell must be the instabuy (latest.high)');
});

test('the swap is not cosmetic — it moves estBuy UP to the instabuy and carries break-even with it', () => {
  // MUTANT: restore `quickBuy: latest.high` in read-window-range — this asserts the DIRECTION of the
  // damage, so a future swap fails here with a diagnosis rather than an opaque number change.
  const a = est(correct), b = est(swapped);
  assert.equal(a.estBuy, LOW, 'a correct row buys at the instasell');
  assert.equal(b.estBuy, HIGH, 'the swapped row buys at the instabuy');
  assert.ok(b.be > a.be, 'a higher buy raises break-even');
});

test('the swap MANUFACTURES beFloored — "no trade" on a row the correct orientation prices as profitable', () => {
  // MUTANT: any change that lets the swapped row read beFloored:false — red. This is the whole reason
  // the bug mattered: the fold line reported a market fact that was an artifact of its own input.
  assert.equal(est(correct).confidence.beFloored, false);
  assert.equal(est(swapped).confidence.beFloored, true);
});

test('estSell floors at the INSTABUY, never below what a sell fills at now', () => {
  // MUTANT: clamp estSell to qb instead of qs — red. A sell estimate under the live instabuy would be
  // advising a worse price than the market already offers.
  const cheapAsk = est({ quickBuy: LOW, quickSell: HIGH, optBuy: LOW, optSell: LOW });
  assert.ok(cheapAsk.estSell >= HIGH, `estSell ${cheapAsk.estSell} must not sit below the instabuy ${HIGH}`);
});

test('estBuy caps at the INSTASELL, never above what a buy fills at now', () => {
  // MUTANT: clamp estBuy to qs instead of qb — red. The mirror of the case above.
  const richBid = est({ quickBuy: LOW, quickSell: HIGH, optBuy: HIGH, optSell: ASK });
  assert.ok(richBid.estBuy <= LOW, `estBuy ${richBid.estBuy} must not exceed the instasell ${LOW}`);
});

test('read-window-range\'s SYNTHETIC row obeys the orientation — the site the bug actually lived at', () => {
  // MUTANT: restore `quickBuy: latest.high, quickSell: latest.low` — red. The cases above pin the
  // CONTRACT; this pins the one caller that hand-builds a row instead of passing a computeQuote one, so
  // a reappearance is caught at the site rather than inferred. Source-scanned because the surrounding
  // block does live fetches and is not callable in a unit test.
  const src = fs.readFileSync(new URL('../commands/read-window-range.mjs', import.meta.url), 'utf8');
  const m = src.match(/quickBuy:\s*latest\.(\w+),\s*quickSell:\s*latest\.(\w+)/);
  assert.ok(m, 'the synthetic row must still assign quickBuy/quickSell from `latest`');
  assert.equal(m[1], 'low', 'quickBuy must come from latest.low (the instasell)');
  assert.equal(m[2], 'high', 'quickSell must come from latest.high (the instabuy)');
});

test('an INVERTED real feed still produces a pair — the clamps must not throw or invert the result', () => {
  // MUTANT: assume quickBuy <= quickSell and skip the clamp — red. 16% of live rows are crossed
  // (quotecore flags `feed-inversion`), so the shell has to stay total on them rather than assume order.
  const e = est({ quickBuy: 6600, quickSell: 6487, optBuy: 6600, optSell: 6685 });
  assert.ok(e != null, 'a crossed feed must still return an estimate, not null');
  assert.ok(Number.isFinite(e.estBuy) && Number.isFinite(e.estSell));
});

test('the SHELL\'s forward ctx obeys it too — liveLo is the instasell, liveHi the instabuy', () => {
  // MUTANT: restore `liveLo: qs, liveHi: qb` in pair.mjs — red. Same reversed labels, a second site: the
  // whole codebase passes `liveLo: row.quickBuy, liveHi: row.quickSell` (15+ call sites, and forecast.mjs's
  // own @param says "live instasell/instabuy"); this one shell was the exception. It only bites on
  // forecast's TREND-ONLY branches, which anchor the trough to liveLo and the peak to liveHi — so the
  // swap moved each by exactly one spread, the bid up and the exit down. A trend-dominated falling
  // profile is what makes the two orientations differ at all, hence the fixture.
  const prof = {
    nights: 10, amplitude: 100, trendPerDay: -200_000, trendDominates: true,
    dip: { startH: 3, endH: 5, level: LOW }, peak: { startH: 14, endH: 16, level: HIGH },
    hours: Array.from({ length: 24 }, (_, h) => ({
      h, devLow: -40, devHi: -30, devMid: -35, devLowSpread: 10, devHiSpread: 10 })),
  };
  const now = new Date(2026, 6, 22, 10);
  const days = Array.from({ length: 10 }, (_, i) => [`d${i}`, { low: LOW - i * 50_000, hi: HIGH - i * 50_000 }]);
  const row = { quickBuy: LOW, quickSell: HIGH, optBuy: LOW, optSell: ASK };
  const e = estimatePair(FLIP_NICHES.band, row, { ...EXTRA, forward: { profile: prof, days, now } },
    { sellModel: 'reach-fold' });
  const ctx = { mom: null, reliable: undefined, phase: null, now };
  const right = driftExitFrom(prof, days, { liveLo: row.quickBuy, liveHi: row.quickSell, ...ctx });
  const wrong = driftExitFrom(prof, days, { liveLo: row.quickSell, liveHi: row.quickBuy, ...ctx });
  assert.notEqual(right.driftAdjustedPeak, wrong.driftAdjustedPeak, 'fixture premise: the orientations differ here');
  assert.equal(e.forwardPeak, Math.round(right.driftAdjustedPeak), 'the shell anchors its peak to the INSTABUY');
});
