#!/usr/bin/env node
/**
 * analyze.test.mjs — the PURE analysis core (PLAN-ANALYZE chunk AZ1).
 *
 * BUSINESS REQUIREMENTS (what an agent must not break):
 *   - auditDataset flags a FIELD-DROP: an ALWAYS_FIELD reliably logged in the prior body but collapsed
 *     in the recent tail → a 'warn' flag naming the field (an emit path stopped logging it).
 *   - auditDataset does NOT false-flag a field that was ALWAYS present (no regression).
 *   - auditDataset flags UN-ATTRIBUTED fills (buy offers with no prior suggestion) as info.
 *   - auditDataset flags a positions.json STALER than fills.json past the threshold.
 *   - deriveCandidates NEVER emits a 'candidate' below the n-floor (the honesty gate), and DOES emit one
 *     for a net-negative niche once realisedN clears it.
 *   - deriveCandidates reports the thin-taken-sample 'context' note (a ~0% taken rate is the baseline,
 *     NOT a candidate), and validator reject frequency as 'inform', never 'candidate'.
 *   - DETERMINISTIC: identical fixtures → identical flags/candidates.
 *
 * SYNTHETIC fixtures only — never the live ledger/fills. Run: `node pipeline/test/analyze.test.mjs`.
 */
import assert from 'node:assert/strict';
import {
  auditDataset, deriveCandidates, fieldPresence, askHeadroomAudit,
  MIN_N_CANDIDATE, FIELD_DROP_MIN_WINDOW,
} from '../lib/analyze.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

// --- fixture builders ------------------------------------------------------------------------
// N ledger rows in ascending ts, each with the given fields. `dropField` (if set) is omitted from
// the last `dropTail` rows (the recent tail) to simulate an emit path that stopped logging it.
function ledgerRows(n, { base = {}, dropField = null, dropTail = 0 } = {}) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const r = { ts: 1000 + i, itemId: 100 + (i % 5), script: 'screen', class: 'liquid', regime: 'flat', ...base };
    if (dropField && i >= n - dropTail) delete r[dropField];
    rows.push(r);
  }
  return rows;
}
const NOW = 100000;
const freshMeta = { nSuggestions: 0, nBuyOffers: 0, nClaimed: 0 };

// --- auditDataset: field-drop detection ------------------------------------------------------
ok('flags a field that regressed in the recent tail', () => {
  // 160 rows: recent 25% = 40 rows (≥ FIELD_DROP_MIN_WINDOW), all missing `class`; prior 120 have it.
  const rows = ledgerRows(160, { dropField: 'class', dropTail: 40 });
  const a = auditDataset({ rows }, {}, {}, freshMeta, { nowSec: NOW });
  const f = a.flags.find(x => x.level === 'warn' && x.msg.includes("field 'class'"));
  assert.ok(f, 'expected a field-drop warn for class');
  assert.equal(a.fieldAudit.always.class.prior >= 0.8, true);
  assert.equal(a.fieldAudit.always.class.recent < 0.5, true);
});

ok('does NOT false-flag a field that was always present', () => {
  const rows = ledgerRows(160);   // class present throughout
  const a = auditDataset({ rows }, {}, {}, freshMeta, { nowSec: NOW });
  assert.equal(a.flags.some(x => x.msg.includes("field 'class'")), false);
});

ok('does NOT fire field-drop below the min window (too few rows to judge)', () => {
  // total 20 rows → prior 15, recent 5, both < FIELD_DROP_MIN_WINDOW → no flag even if class missing.
  assert.ok(FIELD_DROP_MIN_WINDOW > 5);
  const rows = ledgerRows(20, { dropField: 'class', dropTail: 5 });
  const a = auditDataset({ rows }, {}, {}, freshMeta, { nowSec: NOW });
  assert.equal(a.flags.some(x => x.msg.includes("field 'class'")), false);
});

// --- auditDataset: fills ⇆ ledger coherence --------------------------------------------------
ok('flags un-attributed buy offers as info', () => {
  const rows = ledgerRows(40);
  const meta = { nSuggestions: 40, nBuyOffers: 100, nClaimed: 10 };   // 90/100 un-attributed
  const a = auditDataset({ rows }, {}, {}, meta, { nowSec: NOW });
  const f = a.flags.find(x => x.level === 'info' && x.msg.includes('un-attributed'));
  assert.ok(f, 'expected an un-attributed info flag');
  assert.equal(a.unattributed, 90);
});

ok('does NOT flag when most fills ARE attributed', () => {
  const rows = ledgerRows(40);
  const meta = { nSuggestions: 40, nBuyOffers: 100, nClaimed: 90 };   // only 10% un-attributed
  const a = auditDataset({ rows }, {}, {}, meta, { nowSec: NOW });
  assert.equal(a.flags.some(x => x.msg.includes('un-attributed')), false);
});

// --- auditDataset: rebuildability proxy ------------------------------------------------------
ok('flags positions.json staler than fills.json past the threshold', () => {
  const rows = ledgerRows(40);
  const fills = { generatedAt: '2026-07-11T00:00:00.000Z', events: [] };
  const pos = { generatedAt: '2026-07-10T20:00:00.000Z' };   // 4h behind
  const a = auditDataset({ rows }, fills, pos, freshMeta, { nowSec: NOW });
  const f = a.flags.find(x => x.msg.includes('behind fills.json'));
  assert.ok(f, 'expected a positions-stale flag');
  assert.equal(a.rebuild.positionsBehindFillsSec, 4 * 3600);
});

ok('flags missing fills/positions', () => {
  const a = auditDataset({ rows: ledgerRows(10) }, null, null, freshMeta, { nowSec: NOW });
  assert.ok(a.flags.some(x => x.msg.includes('fills.json missing')));
  assert.ok(a.flags.some(x => x.msg.includes('positions.json missing')));
});

// --- auditDataset: forward-data recommendations ----------------------------------------------
ok('flags a window predating the lean grade/depth fields (shipped 2026-07-12)', () => {
  const rows = ledgerRows(40, { base: { rank: 1234 } });   // rank present, grade + depth absent (pre-field window)
  const a = auditDataset({ rows }, {}, {}, freshMeta, { nowSec: NOW });
  assert.ok(a.forward.some(f => f.includes('grade LETTER')));
  assert.ok(a.forward.some(f => f.includes('depth snapshot')));
});
ok('is silent once grade + depth are present in the window (the fields now ship)', () => {
  const rows = ledgerRows(40, { base: { rank: 1234, grade: 'A-', depth: { hpv: 300, lpv: 200 } } });
  const a = auditDataset({ rows }, {}, {}, freshMeta, { nowSec: NOW });
  assert.ok(!a.forward.some(f => f.includes('grade LETTER')));
  assert.ok(!a.forward.some(f => f.includes('depth snapshot')));
});

// --- deriveCandidates: the n-floor is the honesty gate ---------------------------------------
const nicheStat = (key, over) => ({ key, n: 100, filled: 0, filledWorse: 0, notTaken: 100, takenRate: 0,
  latencyMedianSec: null, latencyN: 0, realisedN: 0, realisedSum: 0, realisedPerAttention: null, ...over });

ok('never emits a candidate for a net-negative niche BELOW the n-floor', () => {
  const perNiche = [nicheStat('band', { realisedN: MIN_N_CANDIDATE - 1, realisedPerAttention: -500, realisedSum: -9999 })];
  const c = deriveCandidates(perNiche, { rows: [] });
  assert.equal(c.some(x => x.kind === 'candidate'), false);
});

ok('DOES emit a candidate for a net-negative niche AT/ABOVE the n-floor', () => {
  const perNiche = [nicheStat('band', { realisedN: MIN_N_CANDIDATE, realisedPerAttention: -500, realisedSum: -12000 })];
  const c = deriveCandidates(perNiche, { rows: [] });
  const cand = c.find(x => x.kind === 'candidate');
  assert.ok(cand, 'expected a net-negative candidate');
  assert.equal(cand.evidence.niche, 'band');
});

ok('a POSITIVE net-per-attention niche is not a candidate', () => {
  const perNiche = [nicheStat('band', { realisedN: MIN_N_CANDIDATE + 50, realisedPerAttention: 300, realisedSum: 21000 })];
  const c = deriveCandidates(perNiche, { rows: [] });
  assert.equal(c.some(x => x.kind === 'candidate'), false);
});

// --- deriveCandidates: baseline is context, not a finding ------------------------------------
ok('reports thin taken-sample as context (a ~0% taken rate is the baseline, not a candidate)', () => {
  const perNiche = [nicheStat('band', { filled: 1, filledWorse: 0 }), nicheStat('value', { filled: 0 })];
  const c = deriveCandidates(perNiche, { rows: [] });
  const ctx = c.find(x => x.kind === 'context');
  assert.ok(ctx, 'expected a context note for the thin taken sample');
  assert.equal(c.some(x => x.kind === 'candidate'), false);   // no niche flagged off the baseline
});

// --- deriveCandidates: validator reject frequency is inform, never a verdict -----------------
ok('surfaces most-firing reject validators as inform (n-gated), never candidate', () => {
  const rows = [];
  for (let i = 0; i < MIN_N_CANDIDATE + 5; i++) rows.push({ validators: [{ key: 'reach', status: 'reject', reason: 'x' }] });
  for (let i = 0; i < MIN_N_CANDIDATE - 1; i++) rows.push({ validators: [{ key: 'floor', status: 'reject' }] });   // below floor
  const c = deriveCandidates([nicheStat('band', { filled: 30, filledWorse: 30 })], { rows });   // taken high → no context
  const inf = c.filter(x => x.kind === 'inform');
  assert.equal(inf.length, 1, 'only the reach reject cleared the n-floor');
  assert.equal(inf[0].evidence.validator, 'reach');
  assert.equal(c.some(x => x.kind === 'candidate'), false);
});

// --- fieldPresence primitive -----------------------------------------------------------------
ok('fieldPresence returns null for empty and a fraction otherwise', () => {
  assert.equal(fieldPresence([], 'x'), null);
  assert.equal(fieldPresence([{ x: 1 }, { x: null }, { y: 2 }, { x: 3 }], 'x'), 2 / 4);
});

// --- askHeadroomAudit (Bar E ask-headroom retro) ---------------------------------------------
ok('askHeadroomAudit: empty ledger → n=0 (PLACEHOLDER, nothing to flag)', () => {
  const a = askHeadroomAudit([], []);
  assert.equal(a.n, 0);
  assert.equal(a.nTrusted, 0);
  assert.equal(a.gapPctTrusted, null);
});
ok('askHeadroomAudit: segments trusted vs untrusted and joins the retro outcome', () => {
  const sug = [
    { itemId: 566, ts: 100, askHeadroom: { gap: 4, gapPct: 0.01, rawTop: 397, topBucketVol: 1200, netLever: 2, trusted: true } },
    { itemId: 999, ts: 200, askHeadroom: { gap: 3, gapPct: 0.008, rawTop: 200, topBucketVol: 5, netLever: 1, trusted: false } },
    { itemId: 12, ts: 300 },   // no askHeadroom → ignored
  ];
  const retro = [
    { outcome: 'filled', realisedPerUnit: 8, sellEach: 398 },   // trusted row was taken & realized; sold ABOVE rawTop 397
    { outcome: 'not-taken', realisedPerUnit: null },
    { outcome: 'filled', realisedPerUnit: 50 },
  ];
  const a = askHeadroomAudit(sug, retro);
  assert.equal(a.n, 2, 'only rows carrying askHeadroom counted');
  assert.equal(a.nTrusted, 1);
  assert.equal(a.nUntrusted, 1);
  assert.equal(a.nTakenTrusted, 1);
  assert.equal(a.realisedPerUnitTaken, 8, 'realized/u averaged over the taken trusted subset');
  assert.ok(Math.abs(a.gapPctTrusted - 0.01) < 1e-9);
  // strict raw-top-reach join (2026-07-12): sellEach 398 ≥ rawTop 397 → reached; the untrusted row's
  // retro lacks sellEach → unanswerable (null), never a crash.
  assert.equal(a.rows.find(r => r.itemId === 566).rawTopReached, true);
  assert.equal(a.rows.find(r => r.itemId === 999).rawTopReached, null, 'no sellEach → unknown, degrade');
  assert.equal(a.rawTopKnownTrusted, 1);
  assert.equal(a.rawTopReachedTrusted, 1);
});
ok('askHeadroomAudit: a realized sell BELOW the raw top reads rawTopReached=false', () => {
  const sug = [{ itemId: 7, ts: 100, askHeadroom: { gap: 10, gapPct: 0.02, rawTop: 500, topBucketVol: 900, netLever: 3, trusted: true } }];
  const a = askHeadroomAudit(sug, [{ outcome: 'filled', realisedPerUnit: 4, sellEach: 490 }]);
  assert.equal(a.rows[0].rawTopReached, false);
  assert.equal(a.rawTopKnownTrusted, 1);
  assert.equal(a.rawTopReachedTrusted, 0);
});

console.log(`\nanalyze.test: ${pass} assertions passed.`);
