#!/usr/bin/env node
/**
 * modules.test.mjs — the PM1 probe-module system (loader + stage runner + the four seed probes).
 *
 * BUSINESS REQUIREMENTS (what an agent can rely on — diff against this):
 *   LOADER / REMOVABILITY
 *     - An empty/absent modules dir loads ZERO probes and runProbes() returns [] → the empty-passthrough
 *       guarantee (no module present or none fire ⇒ output byte-identical, nothing appends).
 *     - Before any load, runProbes() returns [] (never throws).
 *     - The real pipeline/modules/ dir groups probes BY STAGE: dip/froth/decant → observe, anchor → price.
 *   INVARIANTS (non-negotiable)
 *     - An 'observe' probe TOUCHES NO NUMBER: the row object is byte-identical (deep-equal) after
 *       runProbes(). Its output is ONLY a {tag, note} annotation.
 *     - A 'price' probe returns ONLY a {price, reason} advisory; a price probe runs only when ctx.price
 *       is present (an advisory recommendation exists to refine).
 *     - No probe output is ever a verdict/gate/rating — runProbes returns display annotations only.
 *   SEED PROBES
 *     - dip: fires quickBuy<avgLow24 on a flat/rising non-decay/non-spike reliable non-thin row, ≥1%;
 *       silent on a thin/decay/spike/falling/at-floor row; owned ⇒ average-down framing.
 *     - froth: on a spike/rising row, holding-or-rising lows ⇒ healthy-reprice, falling lows ⇒ knife;
 *       silent on a flat/base row.
 *     - anchor: an ask just above a round wall ⇒ nudge to anchor−1; a clear-of-wall ask ⇒ null.
 *     - decant: bestDecant picks the cheapest lower-dose variant that beats the 4-dose by ≥ the discount;
 *       the probe reads siblings off ctx.v24all + declares them via needs().
 *   FIRING LOG (PM2)
 *     - logFirings appends ONE well-formed JSONL line per fired annotation to modules/<module>.log,
 *       carrying {ts, module, version, stage, surface, id, name, tag, price(price-stage), quote context}.
 *     - No firing (empty/non-array) ⇒ NO write ⇒ NO file created.
 *     - A write failure is swallowed — logFirings never throws (a broken log can't break a render).
 *
 * Run: node pipeline/modules.test.mjs   (auto-discovered by run-tests.mjs).
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadModules, runProbes, logFirings, collectNeeds, loadedModules, resetModules, MODULES_DIR } from './lib/modules.mjs';
import dip, { DIP_MIN_PCT } from './modules/dip.mjs';
import froth from './modules/froth.mjs';
import anchor, { anchorNudge, nearestAnchors } from './modules/anchor.mjs';
import decant, { bestDecant } from './modules/decant.mjs';

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); passed++; };

// a reliable, flat, in-band row skeleton (probes read these fields).
const baseRow = () => ({
  quickBuy: 1000, quickSell: 1050, optBuy: 990, optSell: 1060, mid: 1025,
  guide: 1020, volDay: 5000, mom: 'clean', momPct: 0, rawBandLo: 990, rawBandHi: 1060,
  regimeLabel: 'flat', rising: false, falling: false, reliable: true, ordered: true,
  band: { lo: 990, hi: 1060, n: 24 },
});

// ---- LOADER / EMPTY-PASSTHROUGH ----------------------------------------------------------------
resetModules();
ok(runProbes(baseRow(), 'screen', {}).length === 0, 'runProbes before any load → [] (never throws)');

const emptyDir = mkdtempSync(join(tmpdir(), 'coffer-modules-empty-'));
await loadModules(emptyDir);
const g0 = loadedModules();
ok(g0 && g0.all.length === 0, 'empty modules dir → zero probes loaded');
ok(runProbes(baseRow(), 'screen', { avgLow24: 2000 }).length === 0, 'empty dir → runProbes [] (empty-passthrough)');

await loadModules(join(MODULES_DIR, 'does-not-exist'));
ok(loadedModules().all.length === 0, 'absent modules dir → zero probes (no throw)');

// load the REAL seed modules and check stage grouping
await loadModules();
const g = loadedModules();
ok(g.observe.map(m => m.name).sort().join(',') === 'decant,dip,froth', 'observe stage = dip/froth/decant');
ok(g.price.map(m => m.name).join(',') === 'anchor', 'price stage = anchor');

// ---- INVARIANT: observe probes touch NO number -------------------------------------------------
{
  const row = baseRow();
  const before = JSON.parse(JSON.stringify(row));
  const fired = runProbes(row, 'screen', {
    surface: 'screen', id: 1, name: 'x', thin: false, avgLow24: 2000,
    phase: { phase: 'base', lowSlope: 0 }, v24all: {}, map: { resolve: () => null },
    price: { side: 'ask', proposed: row.optSell },
  });
  eq(row, before, 'INVARIANT: row object is byte-identical after runProbes (observe touches no number)');
  for (const f of fired) ok(f.stage === 'observe' ? ('tag' in f) : ('price' in f), 'each fired annotation carries its stage shape');
}

// ---- INVARIANT: price probe runs only when ctx.price present -----------------------------------
{
  // an ask that is 3 above a 10,700 wall → anchor nudges to 10,699
  const row = { ...baseRow(), reliable: true, optSell: 10703 };
  const withPrice = runProbes(row, 'screen', { price: { side: 'ask', proposed: 10703 } });
  ok(withPrice.some(f => f.stage === 'price' && f.price === 10699), 'anchor fires via runProbes when ctx.price present');
  const noPrice = runProbes(row, 'screen', {});   // no advisory price → no price stage
  ok(!noPrice.some(f => f.stage === 'price'), 'no ctx.price → price probes are skipped');
}

// ---- DIP ---------------------------------------------------------------------------------------
{
  const ctx = { thin: false, phase: { phase: 'base' }, avgLow24: 1000 };
  ok(dip.probe({ ...baseRow(), quickBuy: 980, reliable: true }, ctx)?.tag?.startsWith('⬇DIP -2.0%'), 'dip fires quickBuy 980 vs avgLow24 1000 (−2.0%)');
  ok(dip.probe({ ...baseRow(), quickBuy: 995 }, ctx) === null, 'dip silent at −0.5% (< DIP_MIN_PCT)');
  ok(DIP_MIN_PCT === 1.0, 'DIP_MIN_PCT is the 1% noise floor');
  ok(dip.probe({ ...baseRow(), quickBuy: 980 }, { ...ctx, thin: true }) === null, 'dip silent on a thin book');
  ok(dip.probe({ ...baseRow(), quickBuy: 980, reliable: false }, ctx) === null, 'dip silent on an unreliable quote');
  ok(dip.probe({ ...baseRow(), quickBuy: 980, regimeLabel: 'falling', falling: true }, ctx) === null, 'dip silent on a faller (not a knife)');
  ok(dip.probe({ ...baseRow(), quickBuy: 980 }, { ...ctx, phase: { phase: 'decay' } }) === null, 'dip silent mid-decay');
  ok(dip.probe({ ...baseRow(), quickBuy: 980 }, { ...ctx, phase: { phase: 'spike' } }) === null, 'dip silent mid-spike');
  ok(dip.probe({ ...baseRow(), quickBuy: 980, rising: true, regimeLabel: 'rising' }, ctx)?.tag != null, 'dip fires on a rising regime');
  ok(dip.probe({ ...baseRow(), quickBuy: 980 }, { ...ctx, owned: true })?.tag.includes('avg-down'), 'dip owned ⇒ average-down framing (surface-semantics inversion)');
}

// ---- FROTH -------------------------------------------------------------------------------------
{
  const spike = { phase: { phase: 'spike', lowSlope: 0.03 } };
  ok(froth.probe(baseRow(), spike)?.tag.includes('healthy-reprice'), 'froth: spike + rising lows ⇒ healthy-reprice');
  ok(froth.probe(baseRow(), { phase: { phase: 'spike', lowSlope: -0.05 } })?.tag.includes('knife'), 'froth: spike + falling lows ⇒ knife');
  ok(froth.probe({ ...baseRow(), rising: true }, { phase: { phase: 'base', lowSlope: 0.01 } })?.tag.includes('healthy'), 'froth: rising regime is frothy too');
  ok(froth.probe(baseRow(), { phase: { phase: 'base', lowSlope: -0.05 } }) === null, 'froth silent on a flat/base non-rising row');
  ok(froth.probe(baseRow(), { phase: { phase: 'spike', lowSlope: null } }) === null, 'froth silent with no low-trajectory read (positive-evidence)');
}

// ---- ANCHOR ------------------------------------------------------------------------------------
{
  const n = nearestAnchors(10703);
  ok(n.below === 10700 && n.above === 10800, 'nearestAnchors(10703) → 10700/10800 on a ~100 grid');
  eq(anchorNudge('ask', 10703), { price: 10699, reason: '⚓ ask 10,699 (under 10,700)' }, 'ask 10,703 just above 10,700 ⇒ nudge to 10,699');
  ok(anchorNudge('ask', 10770) === null, 'ask well clear of the wall (70 > 0.5%) ⇒ no nudge');
  ok(anchor.probe({ ...baseRow(), reliable: true }, { side: 'ask', proposed: 10703 })?.price === 10699, 'anchor module returns the price-stage {price} shape');
  ok(anchor.stage === 'price', 'anchor registers at the price stage');
  const bid = anchorNudge('bid', 4998);
  ok(bid && bid.price === 5001, 'bid 4,998 just under 5,000 ⇒ nudge to 5,001 (lead the queue)');
}

// ---- DECANT (multi-item / needs) ---------------------------------------------------------------
{
  // 4-dose costs 1000; only the (2)-dose@460 → per-4 = (4/2)*460 = 920 (−8%) qualifies (1-dose@260 ⇒
  // 1040 dearer, 3-dose@760 ⇒ ~1013 dearer), so it wins.
  const best = bestDecant({ four: 1000, variants: [{ dose: 1, buy: 260 }, { dose: 2, buy: 460 }, { dose: 3, buy: 760 }] });
  ok(best && best.dose === 2 && best.per4 === 920, 'bestDecant picks the (2)-dose (the only qualifying variant)');
  eq(bestDecant({ four: 1000, variants: [{ dose: 2, buy: 460 }] }), { dose: 2, per4: 920, four: 1000, discountPct: 8 }, 'bestDecant: (2)-dose@460 ⇒ per4 920, −8%');
  ok(bestDecant({ four: 1000, variants: [{ dose: 2, buy: 495 }] }) === null, 'bestDecant: a <3% discount does not qualify');
  // picks the CHEAPEST qualifying per-4 across variants
  const b2 = bestDecant({ four: 1000, variants: [{ dose: 2, buy: 470 }, { dose: 1, buy: 220 }] });
  ok(b2.dose === 1 && b2.per4 === 880, 'bestDecant picks the cheapest per-4 (1-dose@220 ⇒ 880)');

  // probe off ctx.v24all + a mapping that resolves the dose siblings
  const map = { resolve: (name) => {
    const m = { 'Prayer potion(1)': 101, 'Prayer potion(2)': 102, 'Prayer potion(3)': 103, 'Prayer potion(4)': 104 };
    return m[name] != null ? { id: m[name], name } : null;
  } };
  const v24all = { 101: { avgLowPrice: 220 }, 102: { avgLowPrice: 470 }, 103: { avgLowPrice: 760 } };
  const fired = decant.probe(baseRow(), { name: 'Prayer potion(4)', map, v24all, avgLow24: 1000 });
  ok(fired && fired.tag.startsWith('⚗decant (1)-dose'), 'decant probe fires off the whole-market map (cheapest sibling)');
  ok(decant.probe(baseRow(), { name: 'Prayer potion(4)', map, avgLow24: 1000 }) === null, 'decant silent with no v24all (per-item surface)');
  ok(decant.probe(baseRow(), { name: 'Dragon dagger', map, v24all, avgLow24: 1000 }) === null, 'decant silent on a non-potion (no dose siblings)');
  eq(decant.needs(baseRow(), { name: 'Prayer potion(4)', map }).sort(), [101, 102, 103], 'decant needs() declares the 1/2/3-dose sibling ids');
  eq(collectNeeds([{ id: 104, row: baseRow() }], 'screen', () => ({ name: 'Prayer potion(4)', map })).sort(), [101, 102, 103], 'collectNeeds unions the declared sibling ids (minus ids already present)');
}

// ---- FIRING LOG (PM2) --------------------------------------------------------------------------
{
  await loadModules();   // ensure the real seed set is loaded so version lookup resolves
  const logDir = mkdtempSync(join(tmpdir(), 'coffer-modules-log-'));

  // a fired observe annotation + a fired price annotation, as runProbes would return them
  const fired = [
    { module: 'dip', stage: 'observe', tag: '⬇DIP -2.0%', note: null },
    { module: 'anchor', stage: 'price', tag: '⚓ ask 10,699 (under 10,700)', price: 10699, note: null },
  ];
  logFirings(fired, { surface: 'screen', id: 4151, name: 'Abyssal whip', quickBuy: 980, quickSell: 1050, guide: 1020, regimeLabel: 'flat', phase: 'base' }, logDir);

  const dipLog = join(logDir, 'dip.log');
  const anchorLog = join(logDir, 'anchor.log');
  ok(existsSync(dipLog) && existsSync(anchorLog), 'logFirings writes one <module>.log per fired module');

  const dipLine = JSON.parse(readFileSync(dipLog, 'utf8').trim());
  ok(dipLine.module === 'dip' && dipLine.stage === 'observe' && dipLine.tag === '⬇DIP -2.0%', 'dip line carries module/stage/tag');
  ok(dipLine.version === 1, 'firing line carries the probe DECLARED version (looked up from the loaded set)');
  ok(dipLine.surface === 'screen' && dipLine.id === 4151 && dipLine.name === 'Abyssal whip', 'firing line carries surface/id/name context');
  ok(dipLine.quickBuy === 980 && dipLine.quickSell === 1050 && dipLine.guide === 1020 && dipLine.regimeLabel === 'flat' && dipLine.phase === 'base', 'firing line carries the live quote context (to score without re-fetching)');
  ok(typeof dipLine.ts === 'number' && dipLine.ts > 0, 'firing line carries an epoch-second ts');
  ok(!('price' in dipLine), 'an observe firing carries NO price field');

  const anchorLine = JSON.parse(readFileSync(anchorLog, 'utf8').trim());
  ok(anchorLine.stage === 'price' && anchorLine.price === 10699, 'a price firing carries the nudged price');

  // appends, not overwrites
  logFirings([{ module: 'dip', stage: 'observe', tag: '⬇DIP -3.0%', note: null }], { surface: 'quote', id: 4151, name: 'Abyssal whip' }, logDir);
  ok(readFileSync(dipLog, 'utf8').trim().split('\n').length === 2, 'a second firing APPENDS (does not overwrite)');

  // no firing ⇒ no write ⇒ no file created
  const emptyLogDir = mkdtempSync(join(tmpdir(), 'coffer-modules-nolog-'));
  logFirings([], { surface: 'screen', id: 1 }, emptyLogDir);
  logFirings(null, { surface: 'screen', id: 1 }, emptyLogDir);
  ok(readdirSync(emptyLogDir).length === 0, 'no firing (empty/null) ⇒ NO file created');

  // failure-safe: a non-existent dir cannot write → swallowed, never throws
  assert.doesNotThrow(() => logFirings(fired, { surface: 'screen', id: 1 }, join(logDir, 'no', 'such', 'nested', 'dir')), 'a write failure is swallowed — logFirings never throws');
  passed++;
}

console.log(`\n✓ modules.test.mjs — ${passed} checks passed.`);
