/* capeff-digest.test.mjs — PLAN-CAPITAL-EFFICIENCY-AND-DIGEST business requirements pinned here.
 *
 * Everything under test is INFORM-ONLY, PLACEHOLDER (n≈0) and NEVER gates a row — these fixtures pin the
 * SHAPE of the judgment, not a calibrated cutoff (process rule 4). CONSOLE-ONLY (no APP_VERSION surface).
 *
 * 1. capEfficiency = after-tax ROI%/day of capital tied up (roiPct ÷ holdDays). A single-turn family ties
 *    capital up for its whole TTF (floored at 1h); a churn lane frees + re-commits it up to 6×/day, bounded
 *    ALSO by how long one lap takes to sell (min(6, 86400/ttf)) → holdDays is the reciprocal. null (no throw)
 *    when roiPct is unavailable; ttf=0 floors, never divides by zero.
 * 2. weakDeploy flags a BIG-TICKET (mid ≥ BIG_TICKET_GP) single-turn pick under WEAK_DEPLOY_ROI_PCT (0.5%)
 *    per TURN. Fires for ALL non-churn families ALIKE (band/amplitude/…) — churn is the ONLY exempt lane
 *    (its recycling is rewarded in capEff's ranking, not by exempting the flag). Sub-big-ticket never flags.
 * 3. digestVerdict is the ONE new computed field — a deterministic triage WORD, first-match-wins over the
 *    §3.2 rule table; ORDER matters (a row matching rule 1 AND rule 3 reports rule 1).
 * 4. buildDigestBlock is a VIEW: top-8 cap, capEff-desc sort (null last), and an honest empty fallback.
 */
import assert from 'node:assert/strict';
import { capEfficiency, weakDeploy, digestVerdict, buildDigestBlock } from '../commands/screen-flip-niches.mjs';
import { FLIP_NICHES } from '../../js/flip-niches.mjs';
import { BIG_TICKET_GP } from '../../js/quotecore.js';
import { deployUnits } from '../../js/valuescreen.mjs';

let n = 0;
function ok(name, fn) { fn(); n++; console.log('  ✓ ' + name); }
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

const BAND = FLIP_NICHES.band;        // estimator 'intraday' (non-churn, single-turn)
const CHURN = FLIP_NICHES.churn;      // estimator 'churn'
const AMP = FLIP_NICHES.amplitude;    // estimator 'amplitude' (non-churn, single-turn)

// er with roiPct = net/bid*100. bid=1000, net=50 → roiPct 5%.
const er = (net, bid, ttfSec) => ({ pair: { bid, ask: bid + net }, net, ttf: { value: ttfSec }, rank: 100 });

// --- 1. capEfficiency ---------------------------------------------------------------------------
ok('single-turn band, ttf 12h → holdDays 0.5 → capEff = roiPct / 0.5', () => {
  const c = capEfficiency(BAND, er(50, 1000, 43200));   // roiPct 5, holdDays 0.5
  assert.ok(approx(c, 10), `expected 10, got ${c}`);
});
ok('churn ttf 30m/lap → laps min(6,48)=6 → holdDays 1/6 → capEff = roiPct * 6', () => {
  const c = capEfficiency(CHURN, er(50, 1000, 1800));   // roiPct 5 → 30
  assert.ok(approx(c, 30), `expected 30, got ${c}`);
});
ok('churn slow lap ttf 6h → laps min(6,4)=4 → holdDays 0.25 → capEff = roiPct * 4', () => {
  const c = capEfficiency(CHURN, er(50, 1000, 21600));  // roiPct 5 → 20
  assert.ok(approx(c, 20), `expected 20, got ${c}`);
});
ok('null roiPct (bid 0 / net null) → capEff null, no throw', () => {
  assert.equal(capEfficiency(BAND, er(50, 0, 43200)), null);
  assert.equal(capEfficiency(BAND, { pair: { bid: 1000 }, net: null, ttf: { value: 43200 } }), null);
});
ok('ttf 0 single-turn floors at 1h — no divide-by-zero', () => {
  const c = capEfficiency(BAND, er(50, 1000, 0));       // holdDays = 3600/86400
  assert.ok(Number.isFinite(c) && c > 0, `expected finite > 0, got ${c}`);
  assert.ok(approx(c, 5 / (3600 / 86400)), `expected ${5 / (3600 / 86400)}, got ${c}`);
});

// --- 2. weakDeploy ------------------------------------------------------------------------------
const bigMid = { mid: 50_000_000 };
const hugeMid = { mid: 85_000_000 };
const smallMid = { mid: 5_000_000 };
ok('Magus-shaped: 50m mid, ~0.3%/turn, band → weak-deploy TRUE', () => {
  assert.equal(weakDeploy(BAND, bigMid, er(3, 1000, 43200)), true);   // roiPct 0.3 < 0.5
});
ok('blowpipe-shaped: 85m mid, ~1.1%/turn, band → FALSE (clears on margin alone, no recycling exemption)', () => {
  assert.equal(weakDeploy(BAND, hugeMid, er(11, 1000, 43200)), false);  // roiPct 1.1 ≥ 0.5
});
ok('sub-10m item at any thin roiPct → FALSE (not big-ticket)', () => {
  assert.equal(weakDeploy(BAND, smallMid, er(1, 1000, 43200)), false);  // roiPct 0.1, but mid < 10m
});
ok('churn big-ticket at 0.3%/turn → FALSE (churn is the ONE exempt lane)', () => {
  assert.equal(weakDeploy(CHURN, bigMid, er(3, 1000, 1800)), false);
});
ok('amplitude big-ticket at 0.3%/turn → TRUE (amplitude is NOT exempt — resolution 1)', () => {
  assert.equal(weakDeploy(AMP, bigMid, er(3, 1000, 86400)), true);
});
ok('threshold is BIG_TICKET_GP, reused not reinvented', () => {
  assert.equal(BIG_TICKET_GP, 10_000_000);
  assert.equal(weakDeploy(BAND, { mid: BIG_TICKET_GP }, er(3, 1000, 43200)), true);           // exactly at threshold, thin → flags
  assert.equal(weakDeploy(BAND, { mid: BIG_TICKET_GP - 1 }, er(3, 1000, 43200)), false);      // just under → not big-ticket
});

// --- 3. digestVerdict rule table (first-match-wins, ORDER matters) -------------------------------
// each row engineered so exactly ONE condition fires (except the ORDER test, which fires two).
ok('rule 1 — recent reach < 0.5 → "sell unreliable"', () => {
  assert.equal(digestVerdict({ spec: BAND, row: smallMid, er: er(50, 1000, 43200), grade: 'A', reachFrac: 0.3, askPlacement: 0.9, phase: 'in-peak' }), 'sell unreliable');
});
ok('rule 2 — placement > 0.85 AND 0.5 ≤ reach < 0.7 → "mirage top"', () => {
  assert.equal(digestVerdict({ spec: BAND, row: smallMid, er: er(50, 1000, 43200), grade: 'A', reachFrac: 0.6, askPlacement: 0.9, phase: 'in-peak' }), 'mirage top');
});
ok('rule 2 does NOT fire on a high placement with GOOD reach (well-tested top, not a mirage)', () => {
  assert.equal(digestVerdict({ spec: BAND, row: smallMid, er: er(50, 1000, 43200), grade: 'A', reachFrac: 0.9, askPlacement: 0.95, phase: 'in-peak' }), 'fill-now');
});
ok('rule 3 — weak-deploy big-ticket (reach exempt/null) → "weak deploy"', () => {
  assert.equal(digestVerdict({ spec: BAND, row: bigMid, er: er(3, 1000, 43200), grade: 'A', reachFrac: null, askPlacement: null, phase: 'in-peak' }), 'weak deploy');
});
ok('rule 4 — post-peak with nothing worse → "starter / hold-to-next-peak"', () => {
  assert.equal(digestVerdict({ spec: BAND, row: smallMid, er: er(50, 1000, 43200), grade: 'A', reachFrac: 0.9, askPlacement: 0.2, phase: 'post-peak' }), 'starter / hold-to-next-peak');
});
ok('rule 5 — clean, grade ≥ B- → "fill-now"', () => {
  assert.equal(digestVerdict({ spec: BAND, row: smallMid, er: er(50, 1000, 43200), grade: 'A', reachFrac: 0.9, askPlacement: 0.2, phase: 'in-peak' }), 'fill-now');
});
ok('rule 6 — nothing positive cleared (grade < B-) → "low-conviction"', () => {
  assert.equal(digestVerdict({ spec: BAND, row: smallMid, er: er(50, 1000, 43200), grade: 'D', reachFrac: null, askPlacement: null, phase: 'in-peak' }), 'low-conviction');
});
ok('ORDER: a row matching rule 1 AND rule 3 reports rule 1 (bad sell beats thin margin)', () => {
  // big-ticket + 0.3%/turn (rule 3 true) AND recent reach 0.3 (rule 1 true) → rule 1 wins
  assert.equal(digestVerdict({ spec: BAND, row: bigMid, er: er(3, 1000, 43200), grade: 'A', reachFrac: 0.3, askPlacement: 0.9, phase: 'in-peak' }), 'sell unreliable');
});

// --- 4. deployUnits reuse (the shared value-niche three-way min) ---------------------------------
ok('deployUnits reuses the value three-way min: capGp/buyLow when the bankroll binds', () => {
  // capGp 140m / buyLow 50m = 2.8 units (bankroll bound); vol-share 0.1×50×2=10, limit 8×6×2=96 — both above
  assert.ok(approx(deployUnits({ buyLow: 50_000_000, limitVol: 50, limit: 8, capGp: 140_000_000 }), 2.8, 1e-3));
});
ok('deployUnits → null when buyLow is missing (degrade, no throw)', () => {
  assert.equal(deployUnits({ buyLow: null, capGp: 140_000_000 }), null);
});

// --- 5. buildDigestBlock (the VIEW: ranked by deployable throughput = capEff × deployable) -------
// rankKey = capEff × deployable capital ≈ after-tax deployable gp/day (the follow-up fix — raw capEff is
// scale-free, so dust-tier cheap high-% items swept the top). mkRow keeps deployable EQUAL by default so the
// legacy capEff-order + rank tie-break assertions still hold (rankKey ∝ capEff when deployable is constant).
const mkRow = (name, capEff, rank = 0, deployable = 1) =>
  ({ name, capEff, deployable, rankKey: (capEff != null && deployable != null) ? capEff * deployable : null, rank, reachFrac: 0.9, phase: 'in-peak', grade: 'A', verdict: 'fill-now' });
ok('empty pool → the honest one-liner, not an empty table', () => {
  const out = buildDigestBlock([]);
  assert.match(out, /\(no candidates this pass\)/);
  assert.doesNotMatch(out, /\| Item \|/);
});
ok('caps the display at 8 rows (a VIEW, not a data cap)', () => {
  const pool = Array.from({ length: 15 }, (_, i) => mkRow(`Item${i}`, 100 - i));
  const out = buildDigestBlock(pool);
  const dataRows = out.split('\n').filter(l => l.startsWith('| ') && !/\| Item \|/.test(l) && !/---/.test(l));
  assert.equal(dataRows.length, 8, `expected 8 rendered rows, got ${dataRows.length}`);
});
ok('at equal deployable, sorts by capEff descending, null last', () => {
  const pool = [mkRow('Low', 5), mkRow('High', 100), mkRow('Mid', 50), mkRow('Null', null)];
  const out = buildDigestBlock(pool);
  const order = ['High', 'Mid', 'Low', 'Null'].map(nm => out.indexOf(nm));
  assert.ok(order[0] < order[1] && order[1] < order[2] && order[2] < order[3], `bad order: ${order}`);
});
ok('tie on the rank key breaks by capEff then rank descending', () => {
  const pool = [mkRow('Alpha', 10, 1), mkRow('Bravo', 10, 9)];   // equal capEff+deployable → equal rankKey → rank breaks
  const out = buildDigestBlock(pool);
  assert.ok(out.indexOf('Bravo') < out.indexOf('Alpha'), 'higher rank should sort first on a rank-key tie');
});
ok('DEPLOYABLE WEIGHT demotes a cheap high-% row below a big-ticket at large deployable capital', () => {
  // the exact failure the follow-up fixes: Lead-ore-shaped dust (capEff 1072%/d, but only ~60k deployable)
  // must sort BELOW a Magus-shaped big-ticket (capEff 2.1%/d, but the whole 140m bankroll deployable).
  const dust = mkRow('Dust', 1072, 0, 60_000);          // rankKey ≈ 1072 × 60k = 64.3M
  const big  = mkRow('BigTicket', 2.1, 0, 140_000_000); // rankKey ≈ 2.1 × 140m = 294M
  const out = buildDigestBlock([dust, big]);
  assert.ok(out.indexOf('BigTicket') < out.indexOf('Dust'), 'big-ticket deployable must out-rank dust despite far lower capEff');
  // and capEff is STILL a displayed column (not dropped) — the dust's raw % is visible, just not the sort
  assert.match(out, /1072\.00%\/d/);
});
ok('the deploy column renders the deployable capital (legibility)', () => {
  const out = buildDigestBlock([mkRow('Big', 5, 0, 140_000_000)]);
  assert.match(out, /\| deploy \|/);           // the new column header
  assert.match(out, /140m/);                    // the deployable capital cell
});

console.log(`\n${n} assertions passed.`);
