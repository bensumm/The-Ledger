#!/usr/bin/env node
/* range-persistence-study.mjs — does conditioning on a DEMONSTRATED, PERSISTENT trading range make
 * "at the bottom of the range" a buy signal? (2026-08-11)
 *
 * Ben's ask: "if an item typically oscillates between two ranges and then is at the bottom, isn't it
 * reasonable to suspect that it will rise again?" — framed by him as "effectively the value strategy
 * but with less speculation": value bets an item WILL recover (one-shot); this bets an item that has
 * ALREADY recovered N times will recover again.
 *
 * Companion report: RANGE-PERSISTENCE-FINDINGS.md. Removable per this directory's README — nothing in
 * the pipeline imports it and it writes nothing the pipeline reads.
 *
 * READ-ONLY over the local `/1h` SQLite archive via the shipped handle `pipeline/lib/market/archive.mjs`.
 * Tax is the canonical `tax()` from `js/money-math.js`; break-even is the canonical `breakEven()` from
 * `js/quotecore.js`. Range quantiles reuse `quantileSorted` from `js/quotecore.js` and the SAME
 * FLOOR_QUANTILE/CEIL_QUANTILE (q15/q85) `js/termstructure.mjs` ships, so the fitted band here is the
 * band the tool already talks about. NOT runnable on a clean checkout — it needs the local archive and
 * (for the item-class segment) `pipeline/.cache/mapping.cache.json`; both failures are reported loudly.
 *
 * ── THE CIRCULARITY RULE (the single most likely way this study produces a false positive) ──
 * `pipeline/experiments/amp-cycle-reproduction.mjs` established that fitting levels on the SAME days you
 * then score inflates completion from ~0-13% to ~86-100%: a median-of-the-scored-days level is cleared by
 * ~50% of those days BY DEFINITION and a multi-day horizon compounds it to ~94%. Therefore, here:
 *   fit window  = days [T-FIT_DAYS, T-1]   (STRICTLY before the origin; asserted in code)
 *   read        = day T's mid              (the position-in-range that triggers the decision)
 *   entry       = day T+1's low-side VWAP  (no same-day lookahead on the entry price)
 *   exit        = day T+1+H                (the scored horizon)
 * Section D ships an IN-SAMPLE arm on purpose, so the inflation this design avoids is visible as a number
 * rather than asserted as a discipline.
 *
 * ── THE REFUTING TESTS, NAMED BEFORE THE RUN (CLAUDE.md rule 11) ──
 *   R1  the oscillator criterion adds nothing   → falsified if OOS containment for qualified items
 *                                                 ≈ containment for all items (section B)
 *   R2  persistence adds nothing over "bottom"  → falsified if arm A ≤ arm B (section C)
 *   R3  persistence adds nothing over value     → falsified if arm A ≤ arm C (section C)
 *   R4  it is the POSITION, not the range       → arm E (oscillator, NOT at bottom) isolates it
 *   R5  the label is noise                      → placebo: shuffle the oscillator label within tier;
 *                                                 if the "edge" survives the shuffle it is not the label
 * Each of R1-R5 has an outcome that would kill the hypothesis. None is algebraically guaranteed to confirm.
 *
 * Sections:  --section a  gate/depth + how SELECTIVE the range criterion is (vs oscillationVsKnife)
 *            --section b  PERSISTENCE: does the fitted range bound out-of-sample behaviour?
 *            --section c  PAYOFF: five arms x horizons x price tiers, after tax
 *            --section d  refuting tests: in-sample circularity exhibit, placebo shuffle, arm E
 *            --section e  independence accounting, survivorship, gear-vs-commodity
 * Default: all five.  --json <path> writes the machine-readable rollup.
 */
import { open } from '../lib/market/archive.mjs';
import { tax } from '../../js/money-math.js';
import { breakEven, quantileSorted } from '../../js/quotecore.js';
import { termStructure, FLOOR_QUANTILE, CEIL_QUANTILE } from '../../js/termstructure.mjs';
import { valueRanges, valueGate, valueTier } from '../../js/valuescreen.mjs';
import { oscillationVsKnife } from '../../js/forecast.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ── knobs (ALL fixed before any result was seen) ──────────────────────────────────────────────────
const FIT_DAYS = 28;             // = termstructure FLOOR_LOOKBACK_DAYS; 4 cycles at Ben's ~7d period
const HORIZONS = [4, 7, 14];     // forward hold, days (4 = the shipped amplitude lane's re-horizon)
const MAXH = Math.max(...HORIZONS);
const BOTTOM_PIR = 0.15;         // "at the bottom of the range": mid in the lowest 15% of floor->ceiling
const TOUCH_LO = 0.15, TOUCH_HI = 0.85;   // what counts as a floor / ceiling TOUCH inside the fit window
const OSC_MIN_FLOOR = 3;         // >=3 separate visits to the floor band
const OSC_MIN_CEIL = 3;          // >=3 separate visits to the ceiling band
const OSC_MIN_TRAVERSALS = 4;    // >=4 alternations floor<->ceiling (i.e. the range is actually traversed)
const MIN_AMP = 0.06;            // after-tax floor->ceiling amplitude; mirrors VALUE_MIN_CYCLE_PCT so the
                                 // range arm and the value arm are held to the SAME economic bar
const FIT_COVERAGE = 0.90;       // >= this share of fit days must be present (survivorship guard)
const CONTAIN_TOL = 0.15;        // out-of-sample containment tolerance, in units of the fitted range
const PERSIST_THRESH = 0.80;     // "the range persists" = >= this share of test days inside the band
const PRICE_FLOOR = 1000;        // gp; penny-item artifact guard (same as the floor study)
// Liquidity gates. STRICT reproduces the shipped units-based screen (and its big-ticket censoring);
// FLOW is price-NEUTRAL so the 1m-10m / >10m tiers can be represented at all; UNGATED is price-only.
const GATE_STRICT_UNITS = 3500;  // median daily min-side units (PLAN-VOL24's FLOOR, applied to a daily median)
const GATE_FLOW_UNITS = 10;      // a real two-sided market, not a units threshold
const GATE_FLOW_GP = 1_000_000;  // median daily min-side gp flow
const TIERS = [
  ['1k-10k', 1e3, 1e4], ['10k-100k', 1e4, 1e5], ['100k-1m', 1e5, 1e6],
  ['1m-10m', 1e6, 1e7], ['>10m', 1e7, Infinity],
];

const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SECTION = argOf('--section', 'abcde');
const want = s => SECTION.includes(s);
const JSON_OUT = argOf('--json', null);
const OUT = {};

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────
const q = (arr, p) => quantileSorted([...arr].sort((a, b) => a - b), p);
const median = a => (a.length ? q(a, 0.5) : null);
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const pct = (x, d = 2) => (x == null ? '    —  ' : ((x >= 0 ? '+' : '') + (x * 100).toFixed(d) + '%').padStart(8));
const pc0 = (x, d = 1) => (x == null ? '  — ' : (x * 100).toFixed(d) + '%');
const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);
function tstat(xs) {
  const n = xs.length; if (n < 3) return null;
  const m = mean(xs), sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1));
  return sd > 0 ? m / (sd / Math.sqrt(n)) : null;
}
/* Item-CLUSTERED statistics: consecutive origins for one item are not independent, so the honest
   cross-item statistic aggregates within item first, then across items (n = items, not item-days).
   BOTH weightings are returned and BOTH are printed, always — the forward-return distribution here is
   violently right-skewed (a handful of item-days double), so `mean` (mean of per-item means) and
   `medMed` (median of per-item medians) can differ by an order of magnitude and disagree in SIGN.
   FLOOR-STRATEGY-FINDINGS had a headline retracted for silently switching between the two; showing
   only one of these numbers is the single easiest way to mislead with this data. */
function clustered(rows, key) {
  const byItem = new Map();
  for (const r of rows) {
    const v = r[key]; if (v == null || !Number.isFinite(v)) continue;
    let a = byItem.get(r.id); if (!a) { a = []; byItem.set(r.id, a); }
    a.push(v);
  }
  const perItemMean = [...byItem.values()].map(mean);
  const perItemMed = [...byItem.values()].map(median);
  return {
    nItems: perItemMean.length, nRows: rows.length,
    mean: mean(perItemMean), t: tstat(perItemMean),
    medMed: median(perItemMed), tMed: tstat(perItemMed),
  };
}
function tierOf(price) { for (const [nm, lo, hi] of TIERS) if (price >= lo && price < hi) return nm; return null; }

// ── panel ────────────────────────────────────────────────────────────────────────────────────────
const h = open(undefined, { readonly: true });
const cov = h.db.prepare(
  `SELECT date(ts,'unixepoch') d, COUNT(*) n FROM buckets WHERE grain='1h' GROUP BY d ORDER BY d`).all();
const PARTIAL = cov.filter(r => r.n < 23).map(r => r.d);
const DAYS = cov.filter(r => r.n >= 23).map(r => r.d);   // only FULL days: a partial day fakes a low/high
const dayIdx = new Map(DAYS.map((d, i) => [d, i]));
const dayTs = DAYS.map(d => Math.floor(Date.parse(d + 'T00:00:00Z') / 1000));

const vw = h.db.prepare(`
  SELECT itemId, date(ts,'unixepoch') AS d,
    SUM(CASE WHEN avgLowPrice  IS NOT NULL AND lowPriceVolume  > 0 THEN avgLowPrice  * lowPriceVolume  ELSE 0 END) loNum,
    SUM(CASE WHEN avgLowPrice  IS NOT NULL AND lowPriceVolume  > 0 THEN lowPriceVolume  ELSE 0 END) loVol,
    SUM(CASE WHEN avgHighPrice IS NOT NULL AND highPriceVolume > 0 THEN avgHighPrice * highPriceVolume ELSE 0 END) hiNum,
    SUM(CASE WHEN avgHighPrice IS NOT NULL AND highPriceVolume > 0 THEN highPriceVolume ELSE 0 END) hiVol,
    MIN(avgLowPrice) AS dayLo, MAX(avgHighPrice) AS dayHi
  FROM observations WHERE grain='1h' GROUP BY itemId, d`).all();
h.close();

/* panel: itemId -> array indexed by day-index.
   buy  = the day's LOW-side VWAP  — what a patient bid would have averaged.
   sell = the day's HIGH-side VWAP — what a patient ask would have averaged.
   mid  = (buy+sell)/2. NOTE (trap): mid is NOT spread-free — it is the mean of the two side VWAPs, so
   spread compression drags it down. mid is used ONLY as a LEVEL (range fitting + position-in-range),
   never as a return or edge metric; every payoff number below is computed from buy/sell directly. */
const panel = new Map();
for (const r of vw) {
  const di = dayIdx.get(r.d); if (di == null) continue;
  const buy = r.loVol > 0 ? r.loNum / r.loVol : null;
  const sell = r.hiVol > 0 ? r.hiNum / r.hiVol : null;
  if (buy == null || sell == null) continue;   // a one-sided day cannot support a round trip either way
  let a = panel.get(r.itemId); if (!a) { a = new Array(DAYS.length).fill(null); panel.set(r.itemId, a); }
  a[di] = { buy, sell, mid: (buy + sell) / 2, lo: r.dayLo, hi: r.dayHi, loVol: r.loVol, hiVol: r.hiVol };
}

// ── item classification (the "outside factors" PROXY — suggestive, never controlled) ──────────────
let mapping = {}, mappingOk = false;
try {
  mapping = JSON.parse(fs.readFileSync(path.join(HERE, '..', '.cache', 'mapping.cache.json'), 'utf8'));
  mappingOk = Object.keys(mapping).length > 0;
} catch { /* reported below, never silent */ }
if (!mappingOk) console.log('⚠ mapping.cache.json missing/empty — every item classifies `unknown`; the '
  + 'section-E gear-vs-commodity segment is NOT reproducible on this machine.');
const GEAR_RE = /\b(sword|scimitar|longsword|dagger|rapier|whip|tentacle|maul|hammer|claws|halberd|spear|hasta|battleaxe|axe|mace|bow|blowpipe|crossbow|staff|wand|trident|shield|defender|helm|coif|hood|platebody|chestplate|platelegs|plateskirt|chainbody|body|top|legs|chaps|robe|boots|gloves|vambraces|bracers|cape|ring|amulet|necklace|bracelet|kiteshield|godsword|fang|armour|armor|torso|faceguard|assembler|blessing)\b/i;
const CONSUM_RE = /\b(potion|brew|restore|antidote|antifire|seed|sapling|herb|grimy|ore|bar|log|plank|rune|essence|coal|arrow|bolt|dart|javelin|bones|ashes|scale|dust|feather|nail|fish|shark|karambwan|pie|pizza|stew|bait|charge|vial|tar|blood|soul|death|nature|law|chaos|astral|cosmic|wrath)\b/i;
const nameOf = id => (mapping[id] && mapping[id].name) || '';
function itemClass(id) {
  const n = nameOf(id); if (!n) return 'unknown';
  if (GEAR_RE.test(n)) return 'gear';         // the noun wins over the material ("Rune platebody" = gear)
  if (CONSUM_RE.test(n)) return 'consumable';
  return 'other';
}

// ── the range fit (STRICTLY pre-origin) ──────────────────────────────────────────────────────────
/* fitRange(mids) -> { floor, ceiling, amp } using the SAME q15/q85 the shipped termStructure uses.
   amp = the after-tax floor->ceiling cycle amplitude, the same shape valueRanges computes. */
function fitRange(mids) {
  if (mids.length < 2) return null;
  const floor = q(mids, FLOOR_QUANTILE), ceiling = q(mids, CEIL_QUANTILE);
  if (!(floor > 0) || !(ceiling > floor)) return null;
  const amp = (ceiling - tax(Math.round(ceiling)) - floor) / floor;
  return { floor, ceiling, amp };
}

/* oscFeatures(series, floor, ceiling) — the SELECTIVE criterion `oscillationVsKnife` lacks.
   oscillationVsKnife counts detrended direction REVERSALS against a noise floor: that fires on any
   non-monotone item (measured 22/23 big-ticket items in PLAN.md's `MWO` Status row, i.e. it
   discriminates nothing). This instead demands the series REPEATEDLY RETURN TO THE SAME TWO LEVELS:
     - a floor TOUCH is a maximal run of days with pir <= TOUCH_LO (a run counts once, not per day)
     - a ceiling TOUCH is a maximal run with pir >= TOUCH_HI
     - a TRAVERSAL is an alternation floor->ceiling or ceiling->floor
   plus leg-length statistics (median leg days, CV of leg lengths) — the period-regularity axis that
   the shipped detector reports nothing about. */
function oscFeatures(mids, floor, ceiling) {
  const span = ceiling - floor;
  const pirs = mids.map(m => (m - floor) / span);
  let nFloor = 0, nCeil = 0, nTrav = 0, last = null, prevState = null;
  const legs = [];   // days between successive ALTERNATING extreme visits
  let lastTouchIdx = null;
  for (let i = 0; i < pirs.length; i++) {
    const st = pirs[i] <= TOUCH_LO ? 'lo' : pirs[i] >= TOUCH_HI ? 'hi' : null;
    if (st && st !== prevState) {                   // entering an extreme band from outside/other side
      if (st === 'lo') nFloor++; else nCeil++;
      if (last && last !== st) { nTrav++; if (lastTouchIdx != null) legs.push(i - lastTouchIdx); }
      lastTouchIdx = i;   // update on EVERY touch (a v1 bug updated only on a side CHANGE, so a
                          // re-touch of the same side left the leg measured from the group's FIRST
                          // visit and inflated every leg/period figure)
      last = st;
    }
    prevState = st;
  }
  const legMed = legs.length ? median(legs) : null;
  const legMean = legs.length ? mean(legs) : null;
  const legSd = legs.length > 1
    ? Math.sqrt(legs.reduce((s, x) => s + (x - legMean) ** 2, 0) / (legs.length - 1)) : null;
  return {
    nFloor, nCeil, nTrav, legs: legs.length,
    legMedDays: legMed, legCv: (legSd != null && legMean > 0) ? legSd / legMean : null,
    periodDays: legMed != null ? legMed * 2 : null,   // one full cycle = down-leg + up-leg
  };
}

// ── observation build ────────────────────────────────────────────────────────────────────────────
/* One row per (item, origin day T). Every field is derived from data strictly BEFORE the entry price,
   and the entry price itself (day T+1's low-side VWAP) is strictly before every exit price. */
const rows = [];
const dropped = { shortHistory: 0, fitGaps: 0, noEntry: 0, degenerateRange: 0, subFloorPrice: 0 };
const itemsSeen = new Set();

for (const [id, a] of panel) {
  itemsSeen.add(id);
  const cls = itemClass(id);
  for (let T = FIT_DAYS; T + 1 + MAXH < DAYS.length; T++) {
    // --- fit window: [T-FIT_DAYS, T-1], STRICTLY before the origin ---
    const fit = [];
    for (let k = T - FIT_DAYS; k <= T - 1; k++) if (a[k]) fit.push({ i: k, d: a[k] });
    if (fit.length < FIT_DAYS * FIT_COVERAGE) { dropped.fitGaps++; continue; }
    const fitMids = fit.map(f => f.d.mid);
    const rg = fitRange(fitMids);
    if (!rg) { dropped.degenerateRange++; continue; }

    const d0 = a[T]; if (!d0) continue;
    if (d0.mid < PRICE_FLOOR) { dropped.subFloorPrice++; continue; }
    const entryDay = a[T + 1]; if (!entryDay) { dropped.noEntry++; continue; }

    const span = rg.ceiling - rg.floor;
    const pir = (d0.mid - rg.floor) / span;          // position-in-range of the DECISION day
    const osc = oscFeatures(fitMids, rg.floor, rg.ceiling);
    const qualifies = osc.nFloor >= OSC_MIN_FLOOR && osc.nCeil >= OSC_MIN_CEIL
      && osc.nTrav >= OSC_MIN_TRAVERSALS && rg.amp >= MIN_AMP;

    // shipped detector, same window, for the selectivity comparison (section A)
    const oscDays = fit.map(f => [String(f.i), { low: f.d.lo, hi: f.d.hi }]);
    const ovk = oscillationVsKnife(oscDays);

    // --- liquidity / price characterisation, from the FIT window only ---
    const minSide = fit.map(f => Math.min(f.d.loVol, f.d.hiVol));
    const medUnits = median(minSide);
    const medPrice = median(fitMids);
    const gpFlow = medUnits * medPrice;
    const gateStrict = medUnits >= GATE_STRICT_UNITS && medPrice >= PRICE_FLOOR;
    const gateFlow = medUnits >= GATE_FLOW_UNITS && gpFlow >= GATE_FLOW_GP && medPrice >= PRICE_FLOOR;

    // --- out-of-sample containment (persistence), over the MAXH-day test window ---
    /* Starts at T+1, NOT T. A v1 bug started the loop at T — the DECISION day, which is conditioned to
       be at the bottom — and so scored a 15-day window it called 14-day, inflating persistence by
       ~4-5pp. It was never a fitting leak (`qualifies` never reads day T, so the lift was unaffected),
       but the LEVEL was wrong and the window length was misdescribed. */
    let inBand = 0, testDays = 0, touchedLo = false, touchedHi = false;
    for (let k = T + 1; k <= T + MAXH && k < DAYS.length; k++) {
      const dd = a[k]; if (!dd) continue;
      testDays++;
      const p = (dd.mid - rg.floor) / span;
      if (p >= -CONTAIN_TOL && p <= 1 + CONTAIN_TOL) inBand++;
      if (p <= TOUCH_LO) touchedLo = true;
      if (p >= TOUCH_HI) touchedHi = true;
    }
    const contain = testDays >= 8 ? inBand / testDays : null;

    // --- payoff, per horizon. entry = day T+1 low-side VWAP (patient bid) ---
    const entry = entryDay.buy;
    const be = breakEven(Math.round(entry));
    /* SPREAD CONTROL (the decomposition that makes this study falsifiable). netPatient buys the low-side
       VWAP and sells the high-side VWAP, so with ZERO price movement it still returns spread − tax. Any
       filter that selects wide-band items therefore RAISES netPatient mechanically, with no forecasting
       content whatsoever — the exact algebraic-tautology failure CLAUDE.md rule 11 names, and the one
       that got FLOOR-STRATEGY-FINDINGS §4 retracted. spreadOnly is the SAME round trip executed inside
       the entry day (buy the low-side VWAP, sell the high-side VWAP on day T+1): the no-drift baseline.
       excessNet = netPatient − spreadOnly is what WAITING H days added, and it can be negative. */
    const spreadOnly = (entryDay.sell - tax(Math.round(entryDay.sell)) - entry) / entry;
    const perH = {};
    for (const H of HORIZONS) {
      const ex = a[T + 1 + H];
      let netPatient = null, netCross = null, bestNet = null, reach = null,
        excessNet = null, driftLo = null, driftHi = null;
      if (ex) {
        netPatient = (ex.sell - tax(Math.round(ex.sell)) - entry) / entry;   // patient bid -> patient ask
        netCross = (ex.buy - tax(Math.round(ex.buy)) - entryDay.sell) / entryDay.sell; // instabuy -> instasell
        excessNet = netPatient - spreadOnly;
        // SAME-SIDE level drifts: spread-free by construction (low-side vs low-side, high-side vs
        // high-side). These are the only pure "did the price go up" measures in this study.
        driftLo = (ex.buy - entry) / entry;
        driftHi = (ex.sell - entryDay.sell) / entryDay.sell;
        let best = -Infinity, hitCeil = false;
        for (let k = T + 2; k <= T + 1 + H; k++) {
          const dd = a[k]; if (!dd) continue;
          const n = (dd.sell - tax(Math.round(dd.sell)) - entry) / entry;
          if (n > best) best = n;
          if (dd.sell >= rg.ceiling) hitCeil = true;
        }
        bestNet = Number.isFinite(best) ? best : null;
        reach = hitCeil ? 1 : 0;                       // did the fitted CEILING actually print, after entry?
      }
      perH[H] = { netPatient, netCross, bestNet, reach, excessNet, driftLo, driftHi };
    }
    /* ENTRY-LAG CONTROL (refuting test R6). Day T's "at the bottom" read and day T+1's entry price are
       adjacent and highly correlated, so part of any forward gain can be ordinary bid-ask-bounce
       mean-reversion in a noisily-low print rather than a multi-day recovery. Re-run the SAME entry
       two days later (enter T+3, exit T+3+7). A real ~week-cycle recovery should still be there; a
       one-print bounce should be gone. */
    let lagNet = null, lagExcess = null, lagDriftLo = null;
    const le = a[T + 3], lx = a[T + 3 + 7];
    if (le && lx) {
      lagNet = (lx.sell - tax(Math.round(lx.sell)) - le.buy) / le.buy;
      lagExcess = lagNet - (le.sell - tax(Math.round(le.sell)) - le.buy) / le.buy;
      lagDriftLo = (lx.buy - le.buy) / le.buy;
    }

    rows.push({
      id, T, cls, tier: tierOf(medPrice), medPrice, medUnits, gpFlow, gateStrict, gateFlow,
      floor: rg.floor, ceiling: rg.ceiling, amp: rg.amp, pir, qualifies, spreadOnly,
      ovk: ovk ? ovk.shape || (ovk.oscillating ? 'oscillating' : 'knife') : null,
      ovkOsc: ovk ? !!(ovk.oscillating ?? (ovk.shape === 'oscillating')) : null,
      nFloor: osc.nFloor, nCeil: osc.nCeil, nTrav: osc.nTrav,
      legMedDays: osc.legMedDays, legCv: osc.legCv, periodDays: osc.periodDays,
      contain, touchedLo, touchedHi, entry, be, perH, lagNet, lagExcess, lagDriftLo,
    });
  }
}

// ── the value-lane arm (arm C), computed on the SAME rows ─────────────────────────────────────────
/* The shipped Invest/value lane already selects "near a multi-week low". Score it HERE, on the same
   items and the same forward windows, by calling the REAL js/valuescreen.mjs functions against a
   termStructure built from the SAME strictly-pre-origin fit window. `live` = day T's mid (the same
   decision-day read every other arm uses). No re-implementation of the gate. */
function attachValueArm(rowsIn) {
  let evaluated = 0, passed = 0, buyNow = 0, noData = 0;
  const byItem = new Map();
  for (const r of rowsIn) { let s = byItem.get(r.id); if (!s) { s = panel.get(r.id); byItem.set(r.id, s); } }
  for (const r of rowsIn) {
    const a = panel.get(r.id);
    const series = [];
    for (let k = r.T - FIT_DAYS; k <= r.T - 1; k++) if (a[k]) series.push({ ts: dayTs[k], mid: a[k].mid });
    if (series.length < 2) { r.valuePass = false; noData++; continue; }
    evaluated++;
    const ts = termStructure(series, { now: dayTs[r.T - 1] });
    const vr = valueRanges(ts, a[r.T].mid);
    if (!vr.hasData) { r.valuePass = false; r.valueBuyNow = false; noData++; continue; }
    const g = valueGate(vr);                     // phase omitted: the PRE-FETCH path, as the screen runs it
    r.valuePass = !!g.pass; r.valueReason = g.reason;
    r.valueBuyNow = g.pass && valueTier(vr) === 'buy-now';
    if (g.pass) passed++;
    if (r.valueBuyNow) buyNow++;
  }
  return { evaluated, passed, buyNow, noData };
}
const valueStats = attachValueArm(rows);

// ── arms ─────────────────────────────────────────────────────────────────────────────────────────
/* ARM F is the load-bearing control. Arm A bundles TWO conditions — a ≥6% after-tax amplitude AND ≥4
   demonstrated traversals of that band. Arm B has neither, so A>B could be entirely the amplitude half
   (and amplitude is spread-correlated, which netPatient pays for free). F holds amplitude FIXED at the
   same 6% bar and removes ONLY the repetition condition, which is the half Ben's hypothesis is about.
   A vs F is therefore the study's actual question; A vs B and A vs D are context. */
const ARMS = {
  A: { label: 'osc-bottom  (traversals + amp + at bottom)', f: r => r.qualifies && r.pir <= BOTTOM_PIR },
  F: { label: 'amp-bottom  (amp only, NO traversals, bot.)', f: r => !r.qualifies && r.amp >= MIN_AMP && r.pir <= BOTTOM_PIR },
  B: { label: 'bottom-only (at bottom, no range cond.)', f: r => r.pir <= BOTTOM_PIR },
  C: { label: 'value-lane  (valueGate pass + buy-now)', f: r => !!r.valueBuyNow },
  E: { label: 'osc-any     (traversals + amp, NOT bottom)', f: r => r.qualifies && r.pir > BOTTOM_PIR },
  D: { label: 'all-days    (base rate)', f: () => true },
};
const ARM_ORDER = ['A', 'F', 'B', 'C', 'E', 'D'];

const gateFn = { strict: r => r.gateStrict, flow: r => r.gateFlow, ungated: () => true };
let CELLS = 0;   // multiplicity counter — EVERY cell examined, not just the ones discussed

function armRows(gate, armKey, tier = null) {
  const gf = gateFn[gate], af = ARMS[armKey].f;
  return rows.filter(r => gf(r) && af(r) && (tier == null || r.tier === tier));
}
function summarize(rs, H, key, countCell = true) {
  const flat = rs.map(r => ({ id: r.id, v: r.perH[H][key] })).filter(x => x.v != null)
    .map(x => ({ id: x.id, [key]: x.v }));
  if (countCell) CELLS++;   // placebo resamples are NOT cells examined — they are one cell's null
  return clustered(flat, key);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
const L = [];
const say = s => { L.push(s); console.log(s); };

say('');
say('══ RANGE-PERSISTENCE STUDY ' + '═'.repeat(62));
say(`   archive: ${DAYS.length} FULL days (${DAYS[0]} → ${DAYS[DAYS.length - 1]}), `
  + `${PARTIAL.length} partial day(s) dropped: ${PARTIAL.join(', ') || 'none'}`);
say(`   fit ${FIT_DAYS}d (strictly pre-origin) · read day T · enter day T+1 · exit T+1+H, H ∈ {${HORIZONS.join(',')}}`);
say('');

// ── SECTION A — gate + selectivity ────────────────────────────────────────────────────────────────
if (want('a')) {
  say('── A. GATE: what the archive supports, and how SELECTIVE the range criterion is ' + '─'.repeat(12));
  const perItemDays = [...panel.values()].map(a => a.filter(Boolean).length);
  say(`   items with any two-sided daily data : ${panel.size.toLocaleString()}`);
  say(`   median two-sided days per item      : ${median(perItemDays)}  (max ${Math.max(...perItemDays)})`);
  const nOrigins = DAYS.length - FIT_DAYS - 1 - MAXH;
  say(`   origins available per item          : ${nOrigins}  (day index ${FIT_DAYS} … ${DAYS.length - 2 - MAXH})`);
  say('');
  say('   CYCLE ARITHMETIC (Ben\'s hypothesised period ~6–8 days):');
  say(`     fit slice  ${FIT_DAYS}d  → ${(FIT_DAYS / 8).toFixed(1)}–${(FIT_DAYS / 6).toFixed(1)} cycles to fit the range on (period 6–8d)`);
  for (const H of HORIZONS) {
    const no = Math.floor(nOrigins / H);
    say(`     test  ${String(H).padStart(2)}d  → ${(H / 7).toFixed(2)} cycles per window · ${no} NON-OVERLAPPING windows per item`);
  }
  say(`   → a single 50/50 split-half of ${DAYS.length}d would give ~${Math.floor(DAYS.length / 2 / 7)} cycles per side. The rolling`);
  say('     origin (step 1, honest n reported de-overlapped in §E) is used instead: same data, many more');
  say('     test windows, at the cost of overlap that §E accounts for explicitly.');
  say('');

  const uniq = new Map();   // per-item: does it EVER qualify / does oscillationVsKnife EVER say OSC
  for (const r of rows) {
    let s = uniq.get(r.id);
    if (!s) { s = { q: 0, o: 0, n: 0, tier: r.tier, gateFlow: false, gateStrict: false }; uniq.set(r.id, s); }
    s.n++; if (r.qualifies) s.q++; if (r.ovkOsc) s.o++;
    if (r.gateFlow) s.gateFlow = true; if (r.gateStrict) s.gateStrict = true;
  }
  const all = [...uniq.values()];
  say('   SELECTIVITY — share of item-origins each criterion fires on (the MWO scoping');
  say('   problem: the shipped detector read OSCILLATING on 22/23 big-ticket items, i.e. discriminates nothing)');
  say('');
  say('     criterion                                   item-origins   items ever');
  const nRowsQ = rows.filter(r => r.qualifies).length;
  const nRowsO = rows.filter(r => r.ovkOsc).length;
  const nRowsT = rows.filter(r => r.nFloor >= OSC_MIN_FLOOR && r.nCeil >= OSC_MIN_CEIL && r.nTrav >= OSC_MIN_TRAVERSALS).length;
  const nRowsA = rows.filter(r => r.amp >= MIN_AMP).length;
  const itemsT = new Set(rows.filter(r => r.nFloor >= OSC_MIN_FLOOR && r.nCeil >= OSC_MIN_CEIL && r.nTrav >= OSC_MIN_TRAVERSALS).map(r => r.id)).size;
  say(`     oscillationVsKnife → OSCILLATING            ${pc0(nRowsO / rows.length).padStart(10)}   ${pc0(all.filter(s => s.o > 0).length / all.length).padStart(8)}`);
  say(`     traversal condition ALONE (like-for-like)   ${pc0(nRowsT / rows.length).padStart(10)}   ${pc0(itemsT / all.length).padStart(8)}`);
  say(`     amplitude ≥ ${(MIN_AMP * 100).toFixed(0)}% ALONE                        ${pc0(nRowsA / rows.length).padStart(10)}`);
  say(`     BOTH (the arm-A qualifying criterion)       ${pc0(nRowsQ / rows.length).padStart(10)}   ${pc0(all.filter(s => s.q > 0).length / all.length).padStart(8)}`);
  say(`       (≥${OSC_MIN_FLOOR} floor touches, ≥${OSC_MIN_CEIL} ceiling touches, ≥${OSC_MIN_TRAVERSALS} traversals, amp ≥ ${(MIN_AMP * 100).toFixed(0)}%)`);
  say('     NOTE: `oscillationVsKnife` counts an ABSOLUTE number of legs (OSC_MIN_LEGS=3) over whatever');
  say('     window it is handed, with no normalisation — so its rate SATURATES with series length and the');
  say('     figure above is a property of THIS study\'s 28d fit window, not of the shipped gate (which is');
  say('     fed a ~15d endpoint-capped series). The length sweep is printed below; read it before quoting.');
  for (const W of [14, 15, 21, 28, 42, 60]) {
    let o = 0, t = 0;
    for (const [id, a2] of panel) {
      const days = [];
      for (let k = DAYS.length - 1 - W; k < DAYS.length - 1; k++) { const dd = a2[k]; if (dd) days.push([String(k), { low: dd.lo, hi: dd.hi }]); }
      if (days.length < W * 0.9) continue;
      const r = oscillationVsKnife(days); if (!r) continue;
      t++; if (r.oscillating) o++;
    }
    CELLS++;
    say(`       oscillationVsKnife over a ${String(W).padStart(2)}d window → OSCILLATING ${pc0(o / t).padStart(6)}  (n=${t})`);
  }
  CELLS += 4;
  say('');
  say('   by price tier (share of item-origins qualifying), GATE = flow:');
  say('     tier         n item-origins   ovk OSC   range crit   median period (d)   median legCV');
  for (const [nm] of TIERS) {
    const rs = rows.filter(r => r.gateFlow && r.tier === nm);
    if (!rs.length) { say(`     ${pad(nm, 12)} ${rpad(0, 14)}        —          —                  —              —`); CELLS++; continue; }
    const qs = rs.filter(r => r.qualifies);
    say(`     ${pad(nm, 12)} ${rpad(rs.length, 14)}   ${rpad(pc0(rs.filter(r => r.ovkOsc).length / rs.length), 7)}   ${rpad(pc0(qs.length / rs.length), 10)}   `
      + `${rpad(qs.length ? median(qs.map(r => r.periodDays).filter(v => v != null))?.toFixed(1) ?? '—' : '—', 17)}   `
      + `${rpad(qs.length ? median(qs.map(r => r.legCv).filter(v => v != null))?.toFixed(2) ?? '—' : '—', 12)}`);
    CELLS++;
  }
  say('');
  OUT.selectivity = { rows: rows.length, items: uniq.size, ovkRows: nRowsO, qualRows: nRowsQ };
}

// ── SECTION B — persistence ───────────────────────────────────────────────────────────────────────
if (want('b')) {
  say('── B. PERSISTENCE — does the fitted range still bound behaviour OUT OF SAMPLE? ' + '─'.repeat(14));
  say(`   "persists" := ≥${(PERSIST_THRESH * 100).toFixed(0)}% of the ${MAXH}-day test window's daily mids lie inside`);
  say(`   [floor − ${(CONTAIN_TOL * 100).toFixed(0)}%·range, ceiling + ${(CONTAIN_TOL * 100).toFixed(0)}%·range]. The fitted band is q15→q85, so an`);
  say('   IN-SAMPLE band contains ~70% of its own days by construction — the interesting number is not');
  say('   the level but the DIFFERENCE between qualified and unqualified items (refuting test R1: if');
  say('   they are equal, the criterion selects nothing and the hypothesis dies here).');
  say('');
  for (const gate of ['flow', 'strict', 'ungated']) {
    const base = rows.filter(r => gateFn[gate](r) && r.contain != null);
    if (!base.length) continue;
    const Qy = base.filter(r => r.qualifies), Qn = base.filter(r => !r.qualifies);
    const pf = rs => (rs.length ? rs.filter(r => r.contain >= PERSIST_THRESH).length / rs.length : null);
    say(`   GATE = ${pad(gate, 8)}  n item-origins = ${base.length.toLocaleString()}   items = ${new Set(base.map(r => r.id)).size}`);
    say(`     qualified   n=${rpad(Qy.length, 7)}  median containment ${rpad(pc0(median(Qy.map(r => r.contain))), 6)}   persists ${rpad(pc0(pf(Qy)), 6)}`);
    say(`     unqualified n=${rpad(Qn.length, 7)}  median containment ${rpad(pc0(median(Qn.map(r => r.contain))), 6)}   persists ${rpad(pc0(pf(Qn)), 6)}`);
    const lift = pf(Qy) != null && pf(Qn) ? pf(Qy) / pf(Qn) : null;
    say(`     → persistence LIFT (qualified ÷ unqualified) = ${lift == null ? '—' : lift.toFixed(3)}`);
    /* CONFOUND, stated because it cuts against the criterion's favour in one direction and for it in
       the other: containment is partly a VOLATILITY measure — a flat or dead item stays inside any
       band trivially, and the unqualified pool is full of them. The amplitude-matched row below is
       the honest comparison: both sides carry a ≥6% band, and only the repetition condition differs. */
    const Ay = Qy, An = Qn.filter(r => r.amp >= MIN_AMP);
    const liftA = pf(Ay) != null && pf(An) ? pf(Ay) / pf(An) : null;
    say(`     → AMPLITUDE-MATCHED (both sides amp ≥ ${(MIN_AMP * 100).toFixed(0)}%): qualified ${pc0(pf(Ay))} (n=${Ay.length}) vs `
      + `amp-only ${pc0(pf(An))} (n=${An.length})  LIFT = ${liftA == null ? '—' : liftA.toFixed(3)}`);
    /* Ben's premise is "…AND THEN IT IS AT THE BOTTOM". The unconditional rate above answers a question
       he did not ask. This is the rate for the population the hypothesis is actually about. */
    const By = Ay.filter(r => r.pir <= BOTTOM_PIR), Bn = An.filter(r => r.pir <= BOTTOM_PIR);
    const liftB = pf(By) != null && pf(Bn) ? pf(By) / pf(Bn) : null;
    say(`     → CONDITIONED ON "at the bottom" (pir ≤ ${BOTTOM_PIR}), amplitude-matched: qualified ${pc0(pf(By))} (n=${By.length}) vs `
      + `amp-only ${pc0(pf(Bn))} (n=${Bn.length})  LIFT = ${liftB == null ? '—' : liftB.toFixed(3)}`);
    CELLS += 9;
    say('');
    if (gate === 'flow') {
      say('     by price tier:');
      say('       tier          qual n   qual persists   unqual n   unqual persists   lift');
      for (const [nm] of TIERS) {
        const y = Qy.filter(r => r.tier === nm), n = Qn.filter(r => r.tier === nm);
        const py = pf(y), pn = pf(n);
        say(`       ${pad(nm, 12)}  ${rpad(y.length, 6)}   ${rpad(pc0(py), 13)}   ${rpad(n.length, 8)}   ${rpad(pc0(pn), 15)}   ${py != null && pn ? (py / pn).toFixed(3) : '—'}`);
        CELLS += 2;
      }
      say('');
      OUT.persistence = { gate, qualified: { n: Qy.length, persists: pf(Qy) }, unqualified: { n: Qn.length, persists: pf(Qn) } };
    }
  }
  say('   SENSITIVITY of the definition (GATE = flow, all tiers):');
  say('     thresh   tol    qual persists   unqual persists   lift');
  for (const th of [0.70, 0.80, 0.90, 1.00]) {
    for (const tol of [0.05, 0.15, 0.30]) {
      const base = rows.filter(r => r.gateFlow && r.contain != null);
      // recompute containment at this tolerance
      const cAt = r => {
        const a = panel.get(r.id); const span = r.ceiling - r.floor;
        let inb = 0, n = 0;
        for (let k = r.T + 1; k <= r.T + MAXH && k < DAYS.length; k++) {
          const dd = a[k]; if (!dd) continue; n++;
          const p = (dd.mid - r.floor) / span;
          if (p >= -tol && p <= 1 + tol) inb++;
        }
        return n >= 8 ? inb / n : null;
      };
      const y = base.filter(r => r.qualifies).map(cAt).filter(v => v != null);
      const nn = base.filter(r => !r.qualifies).map(cAt).filter(v => v != null);
      const py = y.length ? y.filter(v => v >= th).length / y.length : null;
      const pn = nn.length ? nn.filter(v => v >= th).length / nn.length : null;
      say(`     ${th.toFixed(2)}   ${tol.toFixed(2)}   ${rpad(pc0(py), 13)}   ${rpad(pc0(pn), 15)}   ${py != null && pn ? (py / pn).toFixed(3) : '—'}`);
      CELLS += 2;
    }
  }
  say('');
}

// ── SECTION C — payoff ────────────────────────────────────────────────────────────────────────────
if (want('c')) {
  say('── C. PAYOFF — what a bottom-of-range entry actually pays, after tax ' + '─'.repeat(22));
  say('   entry = day T+1 LOW-side VWAP (a patient bid) · exit = day T+1+H HIGH-side VWAP (a patient ask).');
  say('   This is the MOST GENEROUS execution assumption available in this data — it books the full');
  say('   bid-ask spread as profit on both legs. netCross (instabuy → instasell) is the pessimistic');
  say('   bracket. Every number is an item-CLUSTERED mean (average within item, then across items);');
  say('   n is reported as ITEMS, which is the independent unit for a cross-sectional claim.');
  say('');
  say('   BOTH weightings are shown for every cell: `mean` = mean of per-item means, `med` = median of');
  say('   per-item medians. They disagree by a lot here — the forward-return distribution is violently');
  say('   right-skewed — so a claim that holds on only one of them is not a finding.');
  say('');
  for (const gate of ['flow', 'strict']) {
    say(`   GATE = ${gate}`);
    say('     arm                                        H    items   netPat mean     t   netPat med   netCross med    reach');
    for (const armKey of ARM_ORDER) {
      for (const H of HORIZONS) {
        const rs = armRows(gate, armKey);
        const np = summarize(rs, H, 'netPatient');
        const nc = summarize(rs, H, 'netCross');
        const rc = summarize(rs, H, 'reach');
        say(`     ${pad(ARMS[armKey].label, 42)} ${rpad(H, 2)}  ${rpad(np.nItems, 6)}   ${pct(np.mean)}  ${rpad(np.t == null ? '—' : np.t.toFixed(1), 6)}    ${pct(np.medMed)}       ${pct(nc.medMed)}   ${rpad(pc0(rc.mean), 6)}`);
      }
    }
    say('');
  }

  // ── THE SPREAD DECOMPOSITION — read this BEFORE any netPatient number above ────────────────────
  say('   C2. SPREAD DECOMPOSITION. netPatient above is NOT a forecast statistic: with zero price');
  say('   movement it still returns (spread − tax), so ANY filter that selects wide-band items raises it');
  say('   mechanically. spreadOnly = the same round trip closed INSIDE the entry day (the no-drift');
  say('   baseline). excessNet = netPatient − spreadOnly = what waiting H days actually added, and it');
  say('   CAN be negative. driftLo / driftHi are same-side level changes and are spread-free by');
  say('   construction. If arm A\'s advantage lives in spreadOnly and dies in excessNet/drift, the');
  say('   hypothesis is refuted and the headline above is an artifact.');
  say('');
  for (const gate of ['flow', 'strict']) {
    say(`     GATE = ${pad(gate, 6)}                             H    items   spread med   excess mean      t   excess med   driftLo med`);
    for (const armKey of ARM_ORDER) {
      for (const H of HORIZONS) {
        const rs = armRows(gate, armKey);
        const so = clustered(rs.map(r => ({ id: r.id, spreadOnly: r.spreadOnly })), 'spreadOnly');
        const ex = summarize(rs, H, 'excessNet');
        const dl = summarize(rs, H, 'driftLo');
        CELLS++;
        say(`     ${pad(ARMS[armKey].label, 42)} ${rpad(H, 2)}  ${rpad(ex.nItems, 6)}   ${pct(so.medMed)}    ${pct(ex.mean)}  ${rpad(ex.t == null ? '—' : ex.t.toFixed(1), 6)}    ${pct(ex.medMed)}     ${pct(dl.medMed)}`);
      }
    }
    say('');
  }

  // ── WITHIN-ITEM PAIRED TEST — kills item-composition confounding ────────────────────────────────
  say('   C3. WITHIN-ITEM PAIRED TEST. Every arm above is a different SET of items, so an arm-to-arm');
  say('   gap confounds the signal with item composition. Here each item is its OWN control: for items');
  say('   that have BOTH qualifying-bottom origins and at-least-one comparison origin, the paired');
  say('   difference is computed inside the item and then averaged across items. n = paired items.');
  say('');
  say('   ⚠ The groups are made DISJOINT (a row in arm k1 never also serves as its own control). For the');
  say('   A−D / B−D contrasts that is exactly right. For an arm-vs-arm contrast it MATTERS: arms B and C');
  say('   overlap heavily, so "B − C" removes from C precisely the rows that are also deep bottoms, and');
  say('   the control it actually uses is C\\B, not C. The overlap and the control group\'s real entry');
  say('   depth are printed below so the gap can be attributed correctly.');
  for (const gate of ['flow', 'strict']) {
    const B = armRows(gate, 'B'), C = armRows(gate, 'C');
    const Bset = new Set(B.map(r => r.id + '|' + r.T));
    const ov = C.filter(r => Bset.has(r.id + '|' + r.T));
    const CminusB = C.filter(r => !Bset.has(r.id + '|' + r.T));
    CELLS += 3;
    say(`     gate=${pad(gate, 7)} arm C rows ${C.length}, of which also arm B: ${ov.length} (${pc0(ov.length / C.length)}). `
      + `median pir — arm C ${(median(C.map(r => r.pir)) ?? 0).toFixed(3)}, C\\B (the actual control) ${(median(CminusB.map(r => r.pir)) ?? 0).toFixed(3)}, arm B ${(median(B.map(r => r.pir)) ?? 0).toFixed(3)}`);
  }
  say('');
  say('     comparison                                    H   pairs   Δ netPatient       t   Δ excessNet       t   Δ driftLo       t');
  const pairTests = [
    ['A − F (repetition, amplitude held fixed)', 'A', 'F'],
    ['A − B (repetition+amp vs bottom alone)', 'A', 'B'],
    ['A − C (repetition vs the shipped value lane)', 'A', 'C'],
    ['A − D (vs the item\'s own all-day base rate)', 'A', 'D'],
    ['B − C (bottom alone vs the value lane)', 'B', 'C'],
    ['B − D (is "at the bottom" itself worth it?)', 'B', 'D'],
  ];
  const pairOut = {};
  for (const gate of ['flow', 'strict']) {
  say(`     ── GATE = ${gate} ──`);
  for (const [lbl, k1, k2] of pairTests) {
    for (const H of HORIZONS) {
      const g1 = new Map(), g2 = new Map();
      for (const r of rows) {
        if (!gateFn[gate](r)) continue;
        const p = r.perH[H];
        // The two groups are made DISJOINT (a row in arm A never also counts as its own control),
        // so the difference is a genuine within-item contrast rather than a partly-shared average.
        const inA = ARMS[k1].f(r);
        if (inA) { let a = g1.get(r.id); if (!a) { a = []; g1.set(r.id, a); } a.push(p); }
        else if (ARMS[k2].f(r)) { let a = g2.get(r.id); if (!a) { a = []; g2.set(r.id, a); } a.push(p); }
      }
      const dN = [], dE = [], dL = [];
      for (const [id, aa] of g1) {
        const bb = g2.get(id); if (!bb || !bb.length) continue;
        const m = (arr, k) => mean(arr.map(x => x[k]).filter(v => v != null));
        const a1 = m(aa, 'netPatient'), b1 = m(bb, 'netPatient');
        const a2 = m(aa, 'excessNet'), b2 = m(bb, 'excessNet');
        const a3 = m(aa, 'driftLo'), b3 = m(bb, 'driftLo');
        if (a1 != null && b1 != null) dN.push(a1 - b1);
        if (a2 != null && b2 != null) dE.push(a2 - b2);
        if (a3 != null && b3 != null) dL.push(a3 - b3);
      }
      CELLS += 3;
      say(`     ${pad(lbl, 44)} ${rpad(H, 2)}  ${rpad(dN.length, 6)}    ${pct(mean(dN))}  ${rpad(tstat(dN) == null ? '—' : tstat(dN).toFixed(1), 6)}    ${pct(mean(dE))}  ${rpad(tstat(dE) == null ? '—' : tstat(dE).toFixed(1), 6)}   ${pct(mean(dL))}  ${rpad(tstat(dL) == null ? '—' : tstat(dL).toFixed(1), 6)}   med Δexc ${pct(median(dE))}`);
      if (H === 7) pairOut[`${gate}|${lbl}`] = { pairs: dN.length, dNet: mean(dN), dExcess: mean(dE), medExcess: median(dE), tExcess: tstat(dE), dDriftLo: mean(dL), tDriftLo: tstat(dL) };
    }
  }
  say('');
  }
  OUT.paired = pairOut;
  /* ENTRY-DEPTH DIAGNOSTIC. B−C says plain "bottom of the fitted band" beat the shipped value lane
     within the same items. The obvious rival explanation is not gate QUALITY but entry DEPTH:
     valueTier's buy-now fires at proximity ≥ 0.75 (the bottom ~25% of its recency-anchored range),
     which is a shallower entry than pir ≤ 0.15. Print the depths so the reader can decide, rather
     than asserting the gate is worse. */
  say('   C3b. ENTRY-DEPTH DIAGNOSTIC for the B−C gap (median position-in-range at the decision day):');
  for (const gate of ['flow', 'strict']) {
    const dOf = k => median(armRows(gate, k).map(r => r.pir));
    CELLS += 3;
    say(`        gate=${pad(gate, 7)}  arm A ${(dOf('A') ?? 0).toFixed(3)}   arm B ${(dOf('B') ?? 0).toFixed(3)}   arm C ${(dOf('C') ?? 0).toFixed(3)}   `
      + `(pir is on THIS study's fitted band; arm C's own gate uses its recency-anchored range)`);
  }
  say('');
  say('   C4. BY PRICE TIER (GATE = flow, H = 7d) — MANDATORY, and up front in the verdict: Ben trades');
  say('   big-ticket, and the shipped units gate excludes that class outright. `exc` is excessNet (the');
  say('   spread-free part) as a MEDIAN of per-item medians — the robust, non-tautological number.');
  say('     tier          ── arm A ──────────   ── arm F ──────────   ── arm B ──────────   ── arm C ──────────   ── arm D ──────────');
  say('                   items  net_med exc_md   items  net_med exc_md   items  net_med exc_md   items  net_med exc_md   items  net_med exc_md');
  for (const [nm] of TIERS) {
    const cell = k => {
      const rs = armRows('flow', k, nm);
      const s = summarize(rs, 7, 'netPatient');
      const e = summarize(rs, 7, 'excessNet');
      return `${rpad(s.nItems, 5)} ${pct(s.medMed)} ${pct(e.medMed)}`;
    };
    say(`     ${pad(nm, 12)}  ${cell('A')}  ${cell('F')}  ${cell('B')}  ${cell('C')}  ${cell('D')}`);
  }
  say('');
  say('   C5. SAME TIER TABLE, GATE = strict (the shipped units screen) — note how few items survive:');
  say('     tier          ── arm A ──────────   ── arm F ──────────   ── arm B ──────────   ── arm C ──────────   ── arm D ──────────');
  for (const [nm] of TIERS) {
    const cell = k => {
      const rs = armRows('strict', k, nm);
      const s = summarize(rs, 7, 'netPatient');
      const e = summarize(rs, 7, 'excessNet');
      return `${rpad(s.nItems, 5)} ${pct(s.medMed)} ${pct(e.medMed)}`;
    };
    say(`     ${pad(nm, 12)}  ${cell('A')}  ${cell('F')}  ${cell('B')}  ${cell('C')}  ${cell('D')}`);
  }
  say('');
  // headline rollup for the JSON + the doc
  OUT.payoff = {};
  for (const gate of ['flow', 'strict']) {
    OUT.payoff[gate] = {};
    for (const armKey of ARM_ORDER) {
      OUT.payoff[gate][armKey] = {};
      for (const H of HORIZONS) {
        const rs = armRows(gate, armKey);
        // countCell:false — these are the SAME statistics already printed in C1, re-emitted for the
        // JSON rollup. A v1 counted them again, adding 36 phantom "cells examined" that print nothing.
        OUT.payoff[gate][armKey][H] = summarize(rs, H, 'netPatient', false);
      }
    }
  }
}

// ── SECTION D — refuting tests ────────────────────────────────────────────────────────────────────
if (want('d')) {
  say('── D. REFUTING TESTS ' + '─'.repeat(68));
  say('   D1. IN-SAMPLE CIRCULARITY EXHIBIT (the amp-cycle-reproduction defect, reproduced deliberately).');
  say('       Fit the SAME q15/q85 band on the days being scored, then ask "did the ceiling print?".');
  say('       If the out-of-sample and in-sample reach numbers are close, the pre-origin discipline is');
  say('       not doing any work; if in-sample is far higher, it is the whole ballgame.');
  const H = 7;
  const oos = [], ins = [];
  for (const r of rows) {
    if (!r.gateFlow) continue;
    const a = panel.get(r.id);
    if (r.perH[H].reach != null) oos.push({ id: r.id, reach: r.perH[H].reach });
    const w = [];
    for (let k = r.T + 1; k <= r.T + 1 + H; k++) if (a[k]) w.push(a[k]);
    if (w.length < H) continue;
    const rg2 = fitRange(w.map(x => x.mid));
    if (!rg2) continue;
    ins.push({ id: r.id, reach: w.some(x => x.sell >= rg2.ceiling) ? 1 : 0 });
  }
  const co = clustered(oos, 'reach'), ci = clustered(ins, 'reach');
  CELLS += 2;
  say(`       out-of-sample (band fitted on days T-${FIT_DAYS}…T-1) : reach@${H}d = ${pc0(co.mean)}   (items ${co.nItems})`);
  say(`       IN-sample     (band fitted on the scored days)   : reach@${H}d = ${pc0(ci.mean)}   (items ${ci.nItems})`);
  say('');

  say('   D2. PLACEBO — shuffle the `qualifies` label across items, holding the origin-day distribution');
  say('       fixed. Two things matter about HOW it is shuffled. Shuffling within PRICE TIER alone is');
  say('       NOT a clean null: real qualified items carry a ≥6% amplitude (and therefore a wide spread)');
  say('       that random tier-mates do not, so such a placebo would "confirm" on spread selection and');
  say('       could not fail for the right reason. The strata here are therefore TIER × AMPLITUDE');
  say('       DECILE, and the metric is excessNet (spread already removed), not netPatient.');
  say('       200 shuffles; reported as the real value\'s percentile in the null.');
  say('       ⚠ ESTIMAND MISMATCH, disclosed rather than hidden: the null draws EVERY bottom-of-range');
  say('       origin of a fake-labelled item, while real arm A additionally requires the ORIGIN to');
  say('       qualify. The null therefore carries ~3x the rows per item and answers "all bottom days of');
  say('       amplitude-matched items", not "a random subset of the same size". A low percentile is');
  say('       consistent with the label being worthless AND with qualifying origins being a selected');
  say('       subset of an item\'s bottom days. It cannot separate them. Do not read it as "worse than');
  say('       random"; the within-item A−F contrast in C3 is the test that can.');
  const real = {};
  for (const Hh of HORIZONS) {
    const rs = armRows('flow', 'A');
    real[Hh] = summarize(rs, Hh, 'excessNet').mean;
  }
  // strata = tier × amplitude decile, so the placebo cannot win on amplitude/spread selection alone
  const ampByItem = new Map();
  for (const r of rows) if (r.gateFlow) { const p = ampByItem.get(r.id) || []; p.push(r.amp); ampByItem.set(r.id, p); }
  const itemAmp = new Map([...ampByItem].map(([id, v]) => [id, median(v)]));
  const ampSorted = [...itemAmp.values()].sort((a, b) => a - b);
  const ampDec = v => { for (let i = 1; i <= 10; i++) if (v <= q(ampSorted, i / 10)) return i; return 10; };
  const byTier = new Map();
  for (const r of rows) {
    if (!r.gateFlow) continue;
    const k = `${r.tier}|${ampDec(itemAmp.get(r.id))}`;
    let m = byTier.get(k); if (!m) { m = new Set(); byTier.set(k, m); }
    m.add(r.id);
  }
  const rng = (() => { let s = 12345; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  const nullDist = {}; for (const Hh of HORIZONS) nullDist[Hh] = [];
  const qualByItem = new Map();
  for (const r of rows) if (r.gateFlow) qualByItem.set(r.id, (qualByItem.get(r.id) || 0) + (r.qualifies ? 1 : 0));
  const bottomPool = rows.filter(r => r.gateFlow && r.pir <= BOTTOM_PIR);   // arm B under gate=flow
  for (let s = 0; s < 200; s++) {
    const fake = new Set();
    for (const [, ids] of byTier) {
      const arr = [...ids];
      const k = arr.filter(i => (qualByItem.get(i) || 0) > 0).length;
      for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
      for (let i = 0; i < k; i++) fake.add(arr[i]);
    }
    const rs = bottomPool.filter(r => fake.has(r.id));
    for (const Hh of HORIZONS) nullDist[Hh].push(summarize(rs, Hh, 'excessNet', false).mean);
  }
  say('       H   real excessNet   null mean   null p05   null p95   percentile of real');
  for (const Hh of HORIZONS) {
    const nd = nullDist[Hh].filter(v => v != null).sort((a, b) => a - b);
    const rv = real[Hh];
    const pctile = (rv == null || !nd.length) ? null : nd.filter(v => v < rv).length / nd.length;
    CELLS++;
    say(`       ${rpad(Hh, 2)}  ${pct(rv)}     ${pct(mean(nd))}   ${pct(q(nd, 0.05))}  ${pct(q(nd, 0.95))}   ${pctile == null ? '—' : pc0(pctile)}`);
  }
  say(`       real arm A rows/items = ${armRows('flow', 'A').length}/${new Set(armRows('flow', 'A').map(r => r.id)).size}; `
    + `all bottom rows of those same items = ${bottomPool.filter(r => new Set(armRows('flow', 'A').map(x => x.id)).has(r.id)).length}`
    + ` — the ratio IS the estimand mismatch above.`);
  say('');
  say('   D3. ENTRY-LAG CONTROL. Day T\'s "at the bottom" read and day T+1\'s entry price are adjacent and');
  say('       highly correlated, so part of any gain can be ordinary bid-ask-bounce mean reversion in a');
  say('       noisily-low print rather than a week-scale recovery. Re-enter TWO DAYS LATER (T+3) and hold');
  say('       the same 7 days. A real cycle survives the lag; a one-print bounce does not.');
  say('       CAVEAT: the lagged arm requires days T+3 and T+10 where the base arm requires T+1 and T+8,');
  say('       so the lag shifts the SAMPLE as well as the entry. Both weightings are printed.');
  say('       arm    items   excess@T+1 mean / med   excess@T+3 mean / med');
  for (const armKey of ARM_ORDER) {
    const rs = armRows('flow', armKey);
    const e1 = summarize(rs, 7, 'excessNet');
    const e3 = clustered(rs.map(r => ({ id: r.id, lagExcess: r.lagExcess })), 'lagExcess');
    CELLS += 4;
    say(`       ${pad(armKey, 6)} ${rpad(e1.nItems, 6)}      ${pct(e1.mean)} / ${pct(e1.medMed)}      ${pct(e3.mean)} / ${pct(e3.medMed)}`);
  }
  say('');
  say('   D4. ARM E ISOLATION — is the effect the RANGE or just the POSITION? (arms A vs E vs B above)');
  for (const Hh of HORIZONS) {
    const a = summarize(armRows('flow', 'A'), Hh, 'netPatient');
    const e = summarize(armRows('flow', 'E'), Hh, 'netPatient');
    const b = summarize(armRows('flow', 'B'), Hh, 'netPatient');
    const d = summarize(armRows('flow', 'D'), Hh, 'netPatient');
    say(`       H=${rpad(Hh, 2)}  A(osc+bottom) ${pct(a.mean)}   E(osc, not bottom) ${pct(e.mean)}   B(bottom only) ${pct(b.mean)}   D(base) ${pct(d.mean)}`);
  }
  say('');
  OUT.refuting = { inSampleReach: ci.mean, oosReach: co.mean, placeboReal: real };
}

// ── SECTION E — independence, survivorship, item class ────────────────────────────────────────────
if (want('e')) {
  say('── E. INDEPENDENCE, SURVIVORSHIP, AND THE "OUTSIDE FACTORS" PROXY ' + '─'.repeat(23));
  const nOrigins = DAYS.length - FIT_DAYS - 1 - MAXH;
  say('   HONEST n. Consecutive origins for one item share almost all of their fit window and overlap');
  say('   in their test window; they are NOT independent observations.');
  say(`     archive spans ${DAYS.length} full days = ONE market regime. Every number in this study is`);
  say('     conditioned on that single regime — the deepest independence limit here, and unfixable');
  say('     with the data on hand.');
  for (const Hh of HORIZONS) {
    say(`     H=${rpad(Hh, 2)}  non-overlapping windows per item = floor(${nOrigins}/${Hh}) = ${Math.floor(nOrigins / Hh)}`);
  }
  say('');
  for (const gate of ['flow', 'strict']) {
    const rs = armRows(gate, 'A');
    const items = new Set(rs.map(r => r.id));
    // de-overlapped: greedily take entries at least MAXH apart per item
    let deOverlap = 0;
    const byI = new Map();
    for (const r of rs) { let a = byI.get(r.id); if (!a) { a = []; byI.set(r.id, a); } a.push(r.T); }
    for (const [, ts] of byI) { ts.sort((a, b) => a - b); let last = -Infinity; for (const t of ts) if (t - last >= MAXH) { deOverlap++; last = t; } }
    say(`   ARM A, gate=${pad(gate, 8)}: ${rs.length.toLocaleString()} item-origins · ${items.size} distinct items · ${deOverlap} NON-OVERLAPPING entries (≥${MAXH}d apart)`);
  }
  say('');
  say('   BIG-TICKET COVERAGE — the class Ben actually trades. Distinct ITEMS reaching arm A, by tier:');
  say('     tier          gate=strict   gate=flow   ungated');
  for (const [nm] of TIERS) {
    const c = g => new Set(armRows(g, 'A', nm).map(r => r.id)).size;
    say(`     ${pad(nm, 12)}  ${rpad(c('strict'), 11)}   ${rpad(c('flow'), 9)}   ${rpad(c('ungated'), 7)}`);
    CELLS += 3;
  }
  say('');
  say('   SURVIVORSHIP / drop accounting (item-origin candidates rejected before scoring):');
  for (const [k, v] of Object.entries(dropped)) say(`     ${pad(k, 20)} ${v.toLocaleString()}`);
  say(`     ${pad('scored rows', 20)} ${rows.length.toLocaleString()}`);
  say('     An item that DELISTS or goes one-sided mid-window is dropped by the fit-coverage guard and by');
  say('     the per-horizon null exit, so it never enters a payoff mean. That censoring is SURVIVORSHIP-');
  say('     FAVOURABLE: the reported payoffs describe items that kept trading two-sided throughout.');
  say('');
  say(`   VALUE-ARM diagnostics: evaluated ${valueStats.evaluated.toLocaleString()} · valueGate pass `
    + `${valueStats.passed.toLocaleString()} · buy-now ${valueStats.buyNow.toLocaleString()} · no-data ${valueStats.noData.toLocaleString()}`);
  say('');
  say('   "OUTSIDE FACTORS" PROXY (Ben\'s own caveat; SUGGESTIVE, NOT CONTROLLED — there is no game-update');
  say('   calendar in the archive). His `update-cycle-timing` note: combat/PvM GEAR pumps before an update');
  say('   and DUMPS after; seeds/runes/consumables are update-insensitive. If persistence failures cluster');
  say('   in gear, that is consistent with (not proof of) the update mechanism.');
  say(`   name-keyword classifier coverage: ${mappingOk ? pc0(rows.filter(r => r.cls !== 'unknown').length / rows.length) : 'N/A (mapping missing)'}`);
  say('     class        qual n   persists   unqual n   persists   lift');
  for (const cls of ['gear', 'consumable', 'other', 'unknown']) {
    const base = rows.filter(r => r.gateFlow && r.contain != null && r.cls === cls);
    const y = base.filter(r => r.qualifies), n = base.filter(r => !r.qualifies);
    const pf = rs => (rs.length ? rs.filter(r => r.contain >= PERSIST_THRESH).length / rs.length : null);
    say(`     ${pad(cls, 12)} ${rpad(y.length, 6)}   ${rpad(pc0(pf(y)), 8)}   ${rpad(n.length, 8)}   ${rpad(pc0(pf(n)), 8)}   ${pf(y) != null && pf(n) ? (pf(y) / pf(n)).toFixed(3) : '—'}`);
    CELLS += 2;
  }
  say('');
  say('   ARM A payoff by item class (GATE=flow, H=7d), robust medians + the spread-free part:');
  for (const cls of ['gear', 'consumable', 'other', 'unknown']) {
    const rs = armRows('flow', 'A').filter(r => r.cls === cls);
    const s = summarize(rs, 7, 'netPatient');
    const e = summarize(rs, 7, 'excessNet');
    say(`     ${pad(cls, 12)} items ${rpad(s.nItems, 5)}   netPatient med ${pct(s.medMed)}   excessNet med ${pct(e.medMed)}`);
  }
  say('');
}

say('── MULTIPLICITY ' + '─'.repeat(73));
say(`   Cells examined and reported in this run: ${CELLS}. Every cell above is printed; none was`);
say('   computed and dropped. With this many cells a single favourable cell at p<0.05 is expected by');
say('   chance alone — read the GRID, never one cell.');
say('');

OUT.meta = {
  builtAt: new Date().toISOString(), days: DAYS.length, first: DAYS[0], last: DAYS[DAYS.length - 1],
  fitDays: FIT_DAYS, horizons: HORIZONS, rows: rows.length, items: panel.size, cells: CELLS,
  knobs: { BOTTOM_PIR, TOUCH_LO, TOUCH_HI, OSC_MIN_FLOOR, OSC_MIN_CEIL, OSC_MIN_TRAVERSALS, MIN_AMP,
    CONTAIN_TOL, PERSIST_THRESH, GATE_STRICT_UNITS, GATE_FLOW_UNITS, GATE_FLOW_GP },
};
if (JSON_OUT) { fs.writeFileSync(JSON_OUT, JSON.stringify(OUT, null, 2)); console.log(`→ wrote ${JSON_OUT}`); }
