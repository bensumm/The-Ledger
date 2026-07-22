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
import { capEfficiency, weakDeploy, digestVerdict, buildDigestBlock, digestReachAndPlacement } from '../commands/screen-flip-niches.mjs';
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

// --- 1b. POLISH 2 — buy-limit-bounded realizable capEff ----------------------------------------
ok('fast-churn item: a tight lapsCap bounds capEff to a realizable rate (198%/d fantasy → ~4%/d)', () => {
  // single-turn band, ttf 1h (floored) → UNBOUNDED holdDays 1/24 → capEff = 8% × 24 = 192%/d (the fantasy)
  const unbounded = capEfficiency(BAND, er(80, 1000, 3600));
  assert.ok(approx(unbounded, 192), `expected 192, got ${unbounded}`);
  // a big deployed position that can only recycle 0.5×/day (lapsCap 0.5) → holdDays 2d → capEff 8/2 = 4%/d
  const bounded = capEfficiency(BAND, er(80, 1000, 3600), { lapsCap: 0.5 });
  assert.ok(approx(bounded, 4), `expected 4, got ${bounded}`);
  assert.ok(bounded < unbounded, 'the buy-limit bound must SLOW the realizable rate, never speed it up');
});
ok('a lapsCap ABOVE the natural rate never speeds it up (only ever lengthens holdDays)', () => {
  const natural = capEfficiency(CHURN, er(50, 1000, 1800));                 // churn laps 6 → capEff 30
  const withLooseCap = capEfficiency(CHURN, er(50, 1000, 1800), { lapsCap: 20 });  // 20 > 6 → no change
  assert.ok(approx(natural, withLooseCap), `loose cap must not change capEff: ${natural} vs ${withLooseCap}`);
});
ok('lapsCap null → unchanged (backward-compatible; the lean suggestions.jsonl log path)', () => {
  assert.ok(approx(capEfficiency(BAND, er(50, 1000, 43200)), capEfficiency(BAND, er(50, 1000, 43200), { lapsCap: null })));
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
const mkRow = (name, capEff, rank = 0, deployable = 1, bigTicket = false) =>
  ({ name, capEff, deployable, rankKey: (capEff != null && deployable != null) ? capEff * deployable : null, rank, reachFrac: 0.9, phase: 'in-peak', grade: 'A', bigTicket, verdict: 'fill-now' });
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

// --- 6. POLISH 1 — guaranteed big-ticket visibility slice ---------------------------------------
ok('big-ticket slice APPEARS when fewer than 2 big-tickets made the main top-8', () => {
  // 8 high-throughput non-big-ticket rows sweep the main block; 2 low-throughput big-tickets miss it
  const main = Array.from({ length: 8 }, (_, i) => mkRow(`Churn${i}`, 100 - i, 0, 100_000_000, false));
  const bigA = mkRow('Osmumtens fang', 4, 0, 140_000_000, true);   // rankKey 560M ≪ any Churn (≥9.3B)
  const bigB = mkRow('Bandos godsword', 3, 0, 140_000_000, true);
  const out = buildDigestBlock([...main, bigA, bigB]);
  assert.match(out, /— big-ticket lane/);                          // the divider appears
  const divIdx = out.indexOf('— big-ticket lane');
  assert.ok(out.indexOf('Osmumtens fang') > divIdx, 'the big-ticket appears in the appended slice, below the divider');
  assert.ok(out.indexOf('Bandos godsword') > divIdx);
  // the main block is UNTOUCHED — a high-throughput churn row still leads
  assert.ok(out.indexOf('Churn0') < divIdx, 'the main throughput ranking is not reordered');
});
ok('NO big-ticket slice when ≥2 big-tickets already made the main top-8 (no redundant section)', () => {
  const bigA = mkRow('BigA', 100, 0, 140_000_000, true);   // huge rankKey → in the top-8
  const bigB = mkRow('BigB', 90, 0, 140_000_000, true);
  const rest = Array.from({ length: 6 }, (_, i) => mkRow(`Mid${i}`, 50 - i, 0, 100_000_000, false));
  const out = buildDigestBlock([bigA, bigB, ...rest]);
  assert.doesNotMatch(out, /— big-ticket lane/);
});
ok('no big-tickets at all → no slice, no divider (nothing to guarantee)', () => {
  const out = buildDigestBlock(Array.from({ length: 5 }, (_, i) => mkRow(`R${i}`, 10 - i)));
  assert.doesNotMatch(out, /— big-ticket lane/);
});

// --- 7. POLISH 3 — stale-live-print guard on the digest's reach/placement -----------------------
// A quoted optSell can be pinned to a STALE live instabuy print; the ask-reach read scored at that stale
// level is a FALSE positive. When the sell-side live print is stale (row.quickStale.sell — the same source
// quote-items.mjs's staleLive note reads), reach + placement recompute against the FRESHER instasell.
const ASYM_SPEC = { fillShape: 'asym' };
const HIS = [50, 51, 52, 53, 54, 55, 56, 57, 58, 59];              // 14-day daily-HIGH distribution (sorted)
const REACH_23 = { recentHit: 2, recentDays: 3, reachedDays: 8, nDays: 14 };   // un-guarded recent → 0.667 = ✓
ok('non-stale row: reach = the validator recent-3 frac, placement off optSell (unchanged path)', () => {
  const r = digestReachAndPlacement({ spec: ASYM_SPEC, row: { optSell: 52, quickStale: { sell: false, buy: false }, quickBuy: 57 }, askReachExtra: REACH_23, his: HIS });
  assert.ok(approx(r.reachFrac, 2 / 3), `expected 0.667, got ${r.reachFrac}`);
  assert.equal(r.staleGuarded, false);
  assert.ok(r.reachFrac >= 0.5, 'non-stale reads ✓');
});
ok('STALE sell-side row: digest reach FLIPS from a false ✓ to the honest ✗ (recomputed at the fresher instasell)', () => {
  // optSell 52 was pinned to a stale instabuy; the fresher instasell is 57, and only 3/10 daily highs reach 57
  const r = digestReachAndPlacement({ spec: ASYM_SPEC, row: { optSell: 52, quickStale: { sell: true, buy: false }, quickBuy: 57 }, askReachExtra: REACH_23, his: HIS });
  assert.equal(r.staleGuarded, true);
  assert.ok(approx(r.reachFrac, 0.3), `expected 0.3, got ${r.reachFrac}`);
  assert.ok(r.reachFrac < 0.5, 'the honest read is ✗ (sell unreliable), not the stale ✓');
  // placement is also recomputed at the fresher reference (mirage-aware): 57 sits high in the daily-HIGH dist
  assert.ok(r.askPlacement > 0.5, `placement should reflect the fresher reference, got ${r.askPlacement}`);
});
ok('stale guard is SCOPED: a symmetric (reach-exempt) niche still reads — even when stale', () => {
  const r = digestReachAndPlacement({ spec: { fillShape: 'symmetric' }, row: { optSell: 52, quickStale: { sell: true }, quickBuy: 57 }, askReachExtra: REACH_23, his: HIS });
  assert.equal(r.reachFrac, null);   // churn/amplitude never assert reach, stale or not (no false '✗')
});
ok('stale guard no-ops when there is no distinct fresher level (degrades to the normal path)', () => {
  const r = digestReachAndPlacement({ spec: ASYM_SPEC, row: { optSell: 52, quickStale: { sell: true }, quickBuy: null }, askReachExtra: REACH_23, his: HIS });
  assert.equal(r.staleGuarded, false);
  assert.ok(approx(r.reachFrac, 2 / 3), 'no fresher instasell → unchanged validator reach');
});

// --- 8. R4b — the ask-side cushion-trend token (reachMargin) on the digest ----------------------
// digestReachAndPlacement now folds reachMargin(days, 'ask', refLevel).trend into the digest row, scored at
// the SAME refLevel the reach ✓/✗ uses (so a stale-guarded row's trend reads at the fresher reference too).
// It INFORMS the reach column, never re-ranks/gates. Degrades to null on a symmetric niche / thin sample /
// no in-hand buckets. days shape = windowStats().days: [[key, {low, hi}], …] oldest→newest.
const mkDays = his => his.map((hi, i) => [`2026-07-${10 + i}`, { low: hi - 40, hi }]);   // ask side reads n.hi
const FADING_HIS   = [130, 125, 120, 115, 110, 105, 102];   // cushion over ask 100 shrinks 30→2 → fading
const EXTEND_HIS   = [102, 105, 110, 115, 120, 125, 130];   // cushion grows 2→30 → extending
const STABLE_HIS   = [110, 110, 110, 110, 110, 110, 110];   // flat cushion 10 → stable
ok('R4b: a shrinking ask cushion reads `fading` (peak cooling onto the quoted sell)', () => {
  const r = digestReachAndPlacement({ spec: ASYM_SPEC, row: { optSell: 100, quickStale: { sell: false }, quickBuy: 100 }, askReachExtra: REACH_23, his: HIS, days: mkDays(FADING_HIS) });
  assert.equal(r.marginTrend, 'fading');
});
ok('R4b: a growing ask cushion reads `extending`', () => {
  const r = digestReachAndPlacement({ spec: ASYM_SPEC, row: { optSell: 100, quickStale: { sell: false }, quickBuy: 100 }, askReachExtra: REACH_23, his: HIS, days: mkDays(EXTEND_HIS) });
  assert.equal(r.marginTrend, 'extending');
});
ok('R4b: a flat ask cushion reads `stable`', () => {
  const r = digestReachAndPlacement({ spec: ASYM_SPEC, row: { optSell: 100, quickStale: { sell: false }, quickBuy: 100 }, askReachExtra: REACH_23, his: HIS, days: mkDays(STABLE_HIS) });
  assert.equal(r.marginTrend, 'stable');
});
ok('R4b: a symmetric niche gets NO ask trend (mismeasures a two-sided band) → null', () => {
  const r = digestReachAndPlacement({ spec: { fillShape: 'symmetric' }, row: { optSell: 100, quickStale: { sell: false }, quickBuy: 100 }, askReachExtra: REACH_23, his: HIS, days: mkDays(FADING_HIS) });
  assert.equal(r.marginTrend, null);
});
ok('R4b: no in-hand day buckets → null (degrade, never a fake trend)', () => {
  const r = digestReachAndPlacement({ spec: ASYM_SPEC, row: { optSell: 100, quickStale: { sell: false }, quickBuy: 100 }, askReachExtra: REACH_23, his: HIS });
  assert.equal(r.marginTrend, null);
});
ok('R4b: the stale guard scores the trend at the FRESHER reference too', () => {
  // optSell 100 is stale; fresher instasell is 130. Cushions over 130 (his − 130) shrink → still fading at the honest level.
  const staleHis = [160, 155, 150, 145, 140, 135, 132];   // cushion over 130 = 30→2
  const r = digestReachAndPlacement({ spec: ASYM_SPEC, row: { optSell: 100, quickStale: { sell: true }, quickBuy: 130 }, askReachExtra: REACH_23, his: HIS, days: mkDays(staleHis) });
  assert.equal(r.staleGuarded, true);
  assert.equal(r.marginTrend, 'fading');
});
ok('R4b: buildDigestBlock renders a `trend` column + the ↓ fade token', () => {
  const row = { ...mkRow('Faller', 5, 0, 140_000_000, false), marginTrend: 'fading' };
  const out = buildDigestBlock([row]);
  assert.match(out, /\| trend \|/);        // the new column header
  assert.match(out, /↓ fade/);             // the fading token renders
});

// --- 9. R5 — the digest mirage-rule ESCALATION (placement divergence + falling trend) ------------
// The base 'mirage top' rule (high placement AND mediocre recent reach) stays. R5 ESCALATES it to a
// HIGH-confidence 'mirage top!' ONLY when BOTH extra confirmations hold: the recent-vs-full placement
// divergence AND a `fading` ask cushion trend. Either alone keeps the base caution word; the base
// placement/reach condition still gates (no wider blast radius).
// mirage base: askPlacement > MIRAGE_PLACEMENT (0.85) AND REACH_GRADE_CAP_FRAC (0.5) ≤ reachFrac < MIRAGE_REACH_FRAC (0.70)
const MIRAGE_BASE = { spec: ASYM_SPEC, grade: 'B', reachFrac: 0.6, askPlacement: 0.9 };
ok('R5 mirage: placement-diverges AND fading → HIGH-confidence "mirage top!"', () => {
  assert.equal(digestVerdict({ ...MIRAGE_BASE, placementDiverges: true, marginTrend: 'fading' }), 'mirage top!');
});
ok('R5 mirage: placement-diverges ALONE (no fade) stays the base "mirage top"', () => {
  assert.equal(digestVerdict({ ...MIRAGE_BASE, placementDiverges: true, marginTrend: 'stable' }), 'mirage top');
});
ok('R5 mirage: fading ALONE (no divergence) stays the base "mirage top"', () => {
  assert.equal(digestVerdict({ ...MIRAGE_BASE, placementDiverges: false, marginTrend: 'fading' }), 'mirage top');
});
ok('R5 mirage: neither confirmation → the base "mirage top" (unchanged from pre-R5)', () => {
  assert.equal(digestVerdict({ ...MIRAGE_BASE, placementDiverges: false, marginTrend: null }), 'mirage top');
});
ok('R5 mirage: the escalation NEVER widens the blast radius — a clean reach never becomes any mirage', () => {
  // reachFrac 0.9 (clean) fails the base mirage condition; even with BOTH confirmations it must NOT fire mirage
  const v = digestVerdict({ spec: ASYM_SPEC, grade: 'A', reachFrac: 0.9, askPlacement: 0.95, placementDiverges: true, marginTrend: 'fading', phase: 'in-peak' });
  assert.ok(v !== 'mirage top' && v !== 'mirage top!', `clean reach must not be a mirage, got ${v}`);
});

// digestReachAndPlacement computes placementDiverges DIRECTIONALLY: recent days' highs sitting BELOW the
// full window (the level is harder to reach recently) → recentPlacement − fullPlacement ≥ RECENCY_DIVERGE.
const FULL_HIS = [85, 86, 87, 120, 121, 122, 123, 124, 125, 126];   // level 100 sits ~30th pct of the full window
ok('R5 placementDiverges TRUE: recent highs abandoned the top (all below the level)', () => {
  const r = digestReachAndPlacement({ spec: ASYM_SPEC, row: { optSell: 100, quickStale: { sell: false }, quickBuy: 100 }, askReachExtra: REACH_23, his: FULL_HIS, days: mkDays([200, 200, 200, 85, 86, 87]) });
  assert.equal(r.placementDiverges, true);
});
ok('R5 placementDiverges FALSE: recent highs still clear the level (no stale-optimism)', () => {
  const r = digestReachAndPlacement({ spec: ASYM_SPEC, row: { optSell: 100, quickStale: { sell: false }, quickBuy: 100 }, askReachExtra: REACH_23, his: FULL_HIS, days: mkDays([200, 200, 200, 120, 121, 122]) });
  assert.equal(r.placementDiverges, false);
});
ok('R5 placementDiverges is FALSE without day buckets (degrade, never a fake divergence)', () => {
  const r = digestReachAndPlacement({ spec: ASYM_SPEC, row: { optSell: 100, quickStale: { sell: false }, quickBuy: 100 }, askReachExtra: REACH_23, his: FULL_HIS });
  assert.equal(r.placementDiverges, false);
});

console.log(`\n${n} assertions passed.`);
