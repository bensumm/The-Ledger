#!/usr/bin/env node
/* join-fade-outcomes.mjs — PLAN-HOLD-FADE-ALERT HF1: the pre-registered measurement gating R-HF-2
 * (the FADE alert's hours-under-profile half). RESULT + full caveats: README's entry, the ONE home.
 *
 * ── PRE-REGISTRATION (locked before the decisive run; everything else is a sensitivity row) ────
 * QUESTION: at each origin, does `hoursUnderProfile ≥ k` predict
 *   Y = instabuy(origin+4h) < instabuy(origin) − FADE_MIN_GP (max(1 gp, 1%))
 * cheaper (paired cost) than (a) the shipped 2h-momentum breakdown replay and (b) never-alert?
 * k ∈ {2,3,4,6}. ORIGINS: local hours {12,14,16,18,20,22} on dates with ≥14 prior 1h dates, over a
 * SEEDED --items sample (the composite secondary needs per-origin windowStats+hourProfile).
 * INSTABUY READS: h0 = avgHigh of the last COMPLETED bucket [t−1h,t); h4 = avgHigh of [t+3h,t+4h);
 * missing/uncovered ⇒ UNRESOLVED, excluded, never a miss. NO LOOK-AHEAD: predictors read only
 * completed buckets ≤ t−1h; hoursUnderProfile gets now = t.
 * BASELINE REPLAY (approximation, stated): low(t0) < min(5m lows over [t0−2h,t0)), t0 = last
 * completed 5m low-bucket ≤ t−5m, fresh ≤ LIVE_FRESH_5M_MIN (stale ⇒ Gate-0 analogue: declines),
 * band two-sided + ≥ MIN_BAND_WINDOWS. Origins with NO evaluable band DROP from every arm.
 * COST MODEL: cost = FA + r·miss, r = cost(miss)/cost(FA). "k BEATS" ⇔ M(r) > 0 with the
 * item-clustered 95% CI excluding 0 at some r ∈ {1,1.5,2,3}, POOLED (class strata never decide).
 * NULL BRANCH (named): no k beats ⇒ R-HF-2 dropped, HF2/HF4 key on the composite alone.
 * SECONDARIES (inform only, own evaluable subpools): askReachDecay.decaying + reachMarginTrigger,
 * each at a synthetic patient ask = quantHigh(trailing-14-completed-day highs, 0.75).
 */
import { fileURLToPath } from 'node:url';
import * as archive from '../lib/market/archive.mjs';
import { archiveSeries } from '../lib/market/archive-series.mjs';
import { parseArgs } from '../lib/render/cli.mjs';
import { loadMapping } from '../lib/market/marketfetch.mjs';
import { hoursUnderProfile, fadeMinGp, askReachDecay } from '../lib/market/hourly-lmh.mjs';
import { windowStats, hourProfile, reachMargin, reachMarginTrigger, quantHigh } from '../../js/windowread.mjs';
import { BIG_TICKET_GP, MIN_BAND_WINDOWS } from '../../js/quotecore.js';

// The pre-registered spec (see header). K_GRID/COST_RATIOS/ORIGIN_HOURS are the locked grids.
export const OUTCOME_HORIZON_H = 4;
export const K_GRID = [2, 3, 4, 6];
export const COST_RATIOS = [1, 1.5, 2, 3];
export const ORIGIN_HOURS = [12, 14, 16, 18, 20, 22];
export const MIN_TRAIL_DAYS = 14;
export const PRED_TRAIL_DAYS = 16;        // predictor slice depth: windowStats nights=14 + headroom
export const SAMPLE_ITEMS = 400;   // NOT `DEFAULT_ITEMS` — join-exit-ev.mjs owns that name and a duplicate makes lint-docs' constant-drift check skip both as ambiguous
export const SAMPLE_SEED = 20260921;      // the plan's anchor date — seeded, stated, boring
export const SYNTH_ASK_QUANT = 0.75;      // the secondaries' patient-quartile ask
export const SYNTH_ASK_MIN_DAYS = 5;      // thinner completed-day sample ⇒ no synthetic ask
export const LIVE_FRESH_5M_MIN = 60;      // baseline "live" older than this ⇒ declines (Gate-0 analogue)
export const BOOTSTRAP_ITERS = 2000;
export const BOOTSTRAP_SEED = 12345;
export const MIN_DISCORDANT_ITEMS = 5;

/* breakdownAt(rows5m, t) → { ok, fired } — the 2h-momentum-breakdown replay at origin t.
 * ok=false ⇒ no evaluable band read at t (origin excluded from EVERY comparison — see header);
 * fired ⇒ the replayed signal: last completed 5m low under the min of the trailing-2h band. */
export function breakdownAt(rows5m, t, { freshMin = LIVE_FRESH_5M_MIN, minWindows = MIN_BAND_WINDOWS } = {}) {
  if (!Array.isArray(rows5m) || !rows5m.length) return { ok: false, fired: false };
  // last completed bucket ≤ t−300 that carries a low print (the replay's "live instasell")
  let lo = 0, hi = rows5m.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (rows5m[m].timestamp <= t - 300) lo = m + 1; else hi = m; }
  let i0 = lo - 1;
  while (i0 >= 0 && rows5m[i0].avgLowPrice == null) i0--;
  if (i0 < 0) return { ok: false, fired: false };
  const t0 = rows5m[i0].timestamp;
  if ((t - t0) / 60 > freshMin) return { ok: false, fired: false };   // stale live ⇒ Gate 0 would block
  let pop = 0, bandMin = null, twoSided = false, sawHi = false;
  for (let i = i0 - 1; i >= 0 && rows5m[i].timestamp >= t0 - 7200; i--) {
    const p = rows5m[i];
    if (p.avgLowPrice != null || p.avgHighPrice != null) pop++;
    if (p.avgLowPrice != null && (bandMin == null || p.avgLowPrice < bandMin)) bandMin = p.avgLowPrice;
    if (p.avgHighPrice != null) sawHi = true;
  }
  twoSided = bandMin != null && sawHi;
  if (!twoSided || pop < minWindows) return { ok: false, fired: false };
  return { ok: true, fired: rows5m[i0].avgLowPrice < bandMin };
}

/* pairedCost(rows, r) → the paired cost contrast between predictor a (candidate) and b (baseline)
 * over rows {a, b, y}. cost(x) = FA + r·miss; M(r) = [cost(b) − cost(a)]/n — M>0 ⇒ a cheaper.
 * Concordant rows cancel exactly (the McNemar property — join-reach-basis.mjs owns the full
 * rationale, incl. why a raw rate-gap estimator was rejected). r* solves M(r)=0 and only means
 * something at a POSITIVE crossing; otherwise one arm dominates at every r>0 (report dominance,
 * never a negative root). cheaperBelowRStar follows sign(B), not a fixed sentence. */
export function pairedCost(rows, r = 1) {
  const n = rows.length;
  if (!n) return null;
  let faA = 0, msA = 0, faB = 0, msB = 0, drops = 0, disc = 0;
  for (const s of rows) {
    if (s.y) drops++;
    if (s.a !== s.b) disc++;
    if (s.a && !s.y) faA++; else if (!s.a && s.y) msA++;
    if (s.b && !s.y) faB++; else if (!s.b && s.y) msB++;
  }
  const costA = faA + r * msA, costB = faB + r * msB;
  const A = faB - faA, B = msB - msA;                    // M(r)·n = A + r·B
  const root = B !== 0 ? -A / B : null;
  const rStar = (root != null && root > 0) ? root : null;
  const lead = A !== 0 ? A : B;
  const dominance = rStar != null ? null : (lead > 0 ? 'a' : lead < 0 ? 'b' : 'tie');
  const cheaperBelowRStar = rStar == null ? null : (B < 0 ? 'a' : 'b');
  const nY0 = n - drops;
  const cross = (num, den) => (den > 0 ? num / den : null);
  return {
    n, drops, baseRate: drops / n, disc, faA, msA, faB, msB, A, B,
    costA, costB, M: (costB - costA) / n, rStar, dominance, cheaperBelowRStar,
    costNever: r * drops, costAll: nY0,
    crossovers: {
      aBeatsNeverAbove: cross(faA, drops - msA),         // costA < r·drops ⇔ r > faA / hitsA
      bBeatsNeverAbove: cross(faB, drops - msB),
      aBeatsAllBelow: cross(nY0 - faA, msA),             // costA < nY0 ⇔ r < (nY0 − faA) / missA
      bBeatsAllBelow: cross(nY0 - faB, msB),
    },
  };
}

/* bootstrapM(rows, r) → item-clustered 95% CI on M via per-item sufficient statistics (M is linear
 * in the four error cells, so item-level aggregation is exact — O(items) per draw). Refuses (null)
 * when fewer than MIN_DISCORDANT_ITEMS items contribute a discordant row: M is identically 0
 * without them, and a concordant-only CI would look tight while carrying nothing. */
export function bootstrapM(rows, r = 1, { iters = BOOTSTRAP_ITERS, seed = BOOTSTRAP_SEED } = {}) {
  if (rows.length < 4) return null;
  const byItem = new Map();
  for (const s of rows) {
    let c = byItem.get(s.itemId);
    if (!c) { c = { faA: 0, msA: 0, faB: 0, msB: 0, n: 0, disc: 0 }; byItem.set(s.itemId, c); }
    c.n++;
    if (s.a !== s.b) c.disc++;
    if (s.a && !s.y) c.faA++; else if (!s.a && s.y) c.msA++;
    if (s.b && !s.y) c.faB++; else if (!s.b && s.y) c.msB++;
  }
  const items = [...byItem.values()];
  if (items.length < 2) return null;
  const discItems = items.filter(c => c.disc > 0).length;
  if (discItems < MIN_DISCORDANT_ITEMS) return null;
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const ms = [];
  for (let i = 0; i < iters; i++) {
    let faA = 0, msA = 0, faB = 0, msB = 0, n = 0;
    for (let k = 0; k < items.length; k++) {
      const c = items[Math.floor(rnd() * items.length)];
      faA += c.faA; msA += c.msA; faB += c.faB; msB += c.msB; n += c.n;
    }
    if (n) ms.push(((faB + r * msB) - (faA + r * msA)) / n);
  }
  ms.sort((a, b) => a - b);
  return { lo: ms[Math.floor(ms.length * 0.025)], hi: ms[Math.floor(ms.length * 0.975)],
           items: items.length, discordantItems: discItems };
}

/* beats(rows) → the pre-registered criterion over COST_RATIOS: the list of r where M(r) > 0 with
 * the item-clustered CI excluding 0. Empty ⇒ this candidate does not beat the baseline. */
export function beats(rows, { ratios = COST_RATIOS } = {}) {
  const out = [];
  for (const r of ratios) {
    const m = pairedCost(rows, r);
    if (!m || !(m.M > 0)) continue;
    const ci = bootstrapM(rows, r);
    if (ci && ci.lo > 0) out.push({ r, M: m.M, ci });
  }
  return out;
}

const localDateKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/* scoreItem(rows1h, rows5m, itemId) → { scored, drop } — every origin for one item, with the whole
 * guard funnel counted. Pure over the two adapted series (fixture-testable, no db). */
export function scoreItem(rows1h, rows5m, itemId) {
  const scored = [];
  const drop = { noOutcome: 0, unresolved: 0, noBand: 0, noFade: 0 };
  if (!Array.isArray(rows1h) || rows1h.length < MIN_TRAIL_DAYS * 12) return { scored, drop };
  const byTs = new Map(rows1h.map(r => [r.timestamp, r]));
  const lastTs = rows1h[rows1h.length - 1].timestamp;
  const dates = [];
  const seen = new Set();
  for (const r of rows1h) {
    const k = localDateKey(new Date(r.timestamp * 1000));
    if (!seen.has(k)) { seen.add(k); dates.push(k); }
  }
  let sliceLo = 0;
  for (let di = MIN_TRAIL_DAYS; di < dates.length; di++) {
    const [y, mo, dd] = dates[di].split('-').map(Number);
    for (const h of ORIGIN_HOURS) {
      const t = Math.floor(new Date(y, mo - 1, dd, h).getTime() / 1000);
      const h0row = byTs.get(t - 3600), h4row = byTs.get(t + (OUTCOME_HORIZON_H - 1) * 3600);
      if (!h0row || h0row.avgHighPrice == null) { drop.noOutcome++; continue; }
      if (t + (OUTCOME_HORIZON_H - 1) * 3600 > lastTs) { drop.unresolved++; continue; }
      if (!h4row || h4row.avgHighPrice == null) { drop.noOutcome++; continue; }
      const h0 = h0row.avgHighPrice, minGp = fadeMinGp(h0);
      const brk = breakdownAt(rows5m, t);
      if (!brk.ok) { drop.noBand++; continue; }
      while (sliceLo < rows1h.length && rows1h[sliceLo].timestamp < t - PRED_TRAIL_DAYS * 86400) sliceLo++;
      let hiIdx = sliceLo;                                // predictor slice: completed buckets ≤ t−1h
      while (hiIdx < rows1h.length && rows1h[hiIdx].timestamp <= t - 3600) hiIdx++;
      const pred = rows1h.slice(sliceLo, hiIdx);
      const originD = new Date(t * 1000);
      const hup = hoursUnderProfile(pred, { minGp, now: originD });
      if (!hup) { drop.noFade++; continue; }
      // Secondaries at the synthetic patient ask (evaluable-subpool semantics — see header).
      const dayHighs = [];
      {
        const today = localDateKey(originD);
        const byDate = new Map();
        for (const r of pred) {
          if (r.avgHighPrice == null) continue;
          const k = localDateKey(new Date(r.timestamp * 1000));
          if (k === today) continue;                      // completed dates only
          if (!byDate.has(k) || r.avgHighPrice > byDate.get(k)) byDate.set(k, r.avgHighPrice);
        }
        dayHighs.push(...[...byDate.entries()].sort((a, b2) => a[0].localeCompare(b2[0])).slice(-14).map(e => e[1]));
      }
      const ask = dayHighs.length >= SYNTH_ASK_MIN_DAYS ? quantHigh([...dayHighs].sort((a, b2) => a - b2), SYNTH_ASK_QUANT) : null;
      let sDecay = null, sMargin = null;
      if (ask != null) {
        const dec = askReachDecay(pred, { days: 3, ask });
        sDecay = dec ? dec.decaying : null;
        try {
          const stats = windowStats(pred, { nights: 14, wStart: 0, wEnd: 0, now: originD });
          const prof = hourProfile(pred, { nights: 14, now: originD });
          if (stats && prof) {
            // The composite is evaluated as of the last completed bucket's close: that bucket is the
            // "live" print and the pace clock reads its hour (t−1h), matching the predictor cutoff.
            const live = { lo: h0row.avgLowPrice ?? null, hi: h0row.avgHighPrice ?? null, staleLo: false, staleHi: false };
            const rm = reachMargin(stats.days, 'ask', ask, { profile: prof, live, now: new Date((t - 3600) * 1000) });
            sMargin = reachMarginTrigger(rm);
          }
        } catch { sMargin = null; }
      }
      scored.push({ itemId, ts: t, big: h0 >= BIG_TICKET_GP, y: h4row.avgHighPrice < h0 - minGp,
                    fadeHours: hup.hours, brk: brk.fired, sDecay, sMargin });
    }
  }
  return { scored, drop };
}

// ── CLI (guarded; the pure core above is what the tests import) ─────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const asJson = process.argv.includes('--json');
  const nItems = args.items != null ? Number(args.items) : SAMPLE_ITEMS;
  const rShow = args['cost-ratio'] != null ? Number(args['cost-ratio']) : 1;
  const onlyItem = args.item != null ? String(args.item) : null;

  const db = archive.open(archive.DEFAULT_DB, { readonly: true });
  // Qualifying pool: enough 1h history, plus presence in the newest 5m bucket (a cheap indexed proxy
  // for 5m coverage — the per-origin band guard does the exact work).
  const oneH = db.db.prepare(`SELECT itemId, COUNT(*) n FROM observations WHERE grain='1h' GROUP BY itemId HAVING n >= ?`)
    .all(MIN_TRAIL_DAYS * 12).map(r => Number(r.itemId));
  const last5m = db.db.prepare(`SELECT MAX(ts) t FROM buckets WHERE grain='5m'`).get();
  const with5m = last5m && last5m.t != null ? new Set(Object.keys(db.marketAt('5m', last5m.t)).map(Number)) : new Set();
  let pool = oneH.filter(id => with5m.has(id));
  if (onlyItem) {
    let mapping = null; try { mapping = await loadMapping(); } catch {}
    const hit = mapping?.resolve?.(onlyItem);
    if (!hit) { console.error(`--item: could not resolve "${onlyItem}" to an item id`); process.exit(1); }
    pool = pool.filter(id => id === hit.id);
    if (!pool.length) { console.error(`--item: "${onlyItem}" (#${hit.id}) is not in the qualifying pool`); process.exit(1); }
  }
  // Seeded uniform sample (Fisher–Yates on the sorted pool, LCG — reproducible and stated).
  pool.sort((a, b) => a - b);
  let s = SAMPLE_SEED >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const sample = pool.slice(0, Math.max(1, nItems));

  const scored = [];
  const drop = { noOutcome: 0, unresolved: 0, noBand: 0, noFade: 0 };
  let itemsWithRows = 0;
  for (const id of sample) {
    const rows1h = archiveSeries(db, id, '1h', {});
    const rows5m = archiveSeries(db, id, '5m', {});
    const r = scoreItem(rows1h, rows5m, id);
    if (r.scored.length) itemsWithRows++;
    scored.push(...r.scored);
    for (const k of Object.keys(drop)) drop[k] += r.drop[k];
  }
  try { db.db.close(); } catch {}

  const rowsFor = (sel, base) => scored.filter(base).map(x => ({ itemId: x.itemId, a: sel(x), b: x.brk, y: x.y }));
  const primary = K_GRID.map(k => {
    const rows = rowsFor(x => x.fadeHours >= k, () => true);
    return { k, rows,
      at: COST_RATIOS.map(r => ({ r, m: pairedCost(rows, r), ci: bootstrapM(rows, r) })),
      show: pairedCost(rows, rShow), beat: beats(rows) };
  });
  const classes = ['big-ticket', 'sub'].map(cls => ({
    cls,
    perK: K_GRID.map(k => {
      const rows = rowsFor(x => x.fadeHours >= k, x => (cls === 'big-ticket') === x.big);
      const m = pairedCost(rows, rShow);
      return { k, n: m?.n ?? 0, M: m?.M ?? null, rStar: m?.rStar ?? null, dominance: m?.dominance ?? null };
    }),
  }));
  const secondaries = [
    { name: 'askReachDecay.decaying', rows: rowsFor(x => x.sDecay === true, x => x.sDecay != null) },
    { name: 'reachMargin composite (reachMarginTrigger)', rows: rowsFor(x => x.sMargin === true, x => x.sMargin != null) },
  ].map(sd => ({ ...sd, show: pairedCost(sd.rows, rShow), beat: beats(sd.rows),
                 at: COST_RATIOS.map(r => ({ r, m: pairedCost(sd.rows, r), ci: bootstrapM(sd.rows, r) })) }));
  const winners = primary.filter(p => p.beat.length);
  const nullBranch = winners.length === 0;

  if (asJson) {
    const lean = p => p == null ? null : { ...p, crossovers: p.crossovers };
    console.log(JSON.stringify({
      app: 'the-coffer-fade-outcomes', version: 1,
      spec: { horizonH: OUTCOME_HORIZON_H, kGrid: K_GRID, costRatios: COST_RATIOS, originHours: ORIGIN_HOURS,
              items: sample.length, seed: SAMPLE_SEED, synthAskQuant: SYNTH_ASK_QUANT },
      caveat: 'archive-smoothed 1h basis; baseline is a stated replay approximation; quote M(r)/r*, never a raw rate',
      funnel: { itemsSampled: sample.length, itemsWithRows, scored: scored.length, drop },
      primary: primary.map(p => ({ k: p.k, show: lean(p.show), at: p.at.map(a => ({ r: a.r, M: a.m?.M ?? null, rStar: a.m?.rStar ?? null, ci: a.ci })), beat: p.beat })),
      classes, secondaries: secondaries.map(sd => ({ name: sd.name, n: sd.rows.length, show: lean(sd.show), at: sd.at.map(a => ({ r: a.r, M: a.m?.M ?? null, rStar: a.m?.rStar ?? null, ci: a.ci })), beat: sd.beat })),
      nullBranch,
    }, null, 2));
    return;
  }

  const pp = v => v == null ? '—' : (100 * v).toFixed(2) + 'pp';
  const pct = v => v == null ? '—' : (100 * v).toFixed(1) + '%';
  const THIN_N = 30;
  const rs = m => {
    if (!m || !m.n) return '—';
    if (m.rStar != null) return m.rStar.toFixed(2);
    return m.dominance === 'tie' ? 'tie' : m.dominance === 'a' ? 'fade dominates ∀r>0' : 'baseline dominates ∀r>0';
  };
  console.log(`\njoin-fade-outcomes — hoursUnderProfile ≥ k vs the shipped 2h breakdown (replayed)`);
  console.log(`spec: outcome instabuy drop ≥ max(1gp, 1%) over ${OUTCOME_HORIZON_H}h · origins local ${ORIGIN_HOURS.join('/')}h · ${sample.length} seeded items`);
  console.log(`funnel: ${sample.length} items (${itemsWithRows} contributed) → ${scored.length} scored origins`);
  console.log(`  dropped — noOutcome ${drop.noOutcome} · unresolved(horizon) ${drop.unresolved} · noBand(baseline unevaluable) ${drop.noBand} · noFade(today unlogged) ${drop.noFade}`);
  const anyM = primary[0]?.show;
  if (!anyM) { console.log('\nno scored origins — nothing to measure'); return; }
  console.log(`  base rate P(drop) ${pct(anyM.baseRate)} · pool item-days cluster hard — CIs resample items\n`);
  console.log(`── PRIMARY (paired cost, r = cost(miss)/cost(falseAlarm); M>0 ⇒ fade_k cheaper than baseline) ──`);
  for (const p of primary) {
    const m = p.show;
    console.log(`  k=${p.k}  fade errors FA ${m.faA} / miss ${m.msA} · baseline FA ${m.faB} / miss ${m.msB} · discordant ${m.disc}`);
    const cells = p.at.map(a => {
      const ci = a.ci ? ` [${pp(a.ci.lo)},${pp(a.ci.hi)}]` : ' [CI refused]';
      return `r=${a.r}: M ${pp(a.m?.M)}${ci}`;
    });
    console.log(`       ${cells.join(' · ')}`);
    console.log(`       r* ${rs(m)}${m.rStar != null ? ` — ${m.cheaperBelowRStar === 'a' ? 'fade' : 'baseline'} cheaper BELOW r*` : ''} · never-alert beaten above r=${m.crossovers.aBeatsNeverAbove == null ? '—' : m.crossovers.aBeatsNeverAbove.toFixed(2)} (fade) / ${m.crossovers.bBeatsNeverAbove == null ? '—' : m.crossovers.bBeatsNeverAbove.toFixed(2)} (baseline)`);
  }
  console.log(`\n── THE PRE-REGISTERED VERDICT ──`);
  if (nullBranch) {
    console.log(`  ✗ NULL BRANCH FIRED: no k beats the 2h-breakdown replay (CI-supported M>0) at any r ∈ {${COST_RATIOS.join(', ')}}.`);
    console.log(`    ⇒ R-HF-2 is DROPPED. HF2 ships the FADE alert on the reachMargin composite alone; HF4 keys on the composite.`);
  } else {
    for (const w of winners)
      console.log(`  ✓ k=${w.k} beats the baseline at ${w.beat.map(b => `r=${b.r} (M ${pp(b.M)}, CI [${pp(b.ci.lo)},${pp(b.ci.hi)}])`).join(' · ')}`);
    console.log(`    ⇒ R-HF-2 stands; FADE_MIN_HOURS should be set from the winning k set (smallest CI-supported k is the conservative pick).`);
  }
  console.log(`\n── CLASS STRATA (reported, never deciding; r=${rShow}) ──`);
  for (const c of classes) {
    const cells = c.perK.map(x => `k=${x.k}: M ${pp(x.M)} r* ${x.rStar != null ? x.rStar.toFixed(2) : (x.dominance === 'a' ? 'fade dom' : x.dominance === 'b' ? 'base dom' : '—')} n ${x.n}${x.n && x.n < THIN_N ? '⚠thin' : ''}`);
    console.log(`  ${c.cls.padEnd(10)} ${cells.join(' · ')}`);
  }
  console.log(`\n── SECONDARIES (each on its OWN evaluable subpool — which half carries the signal) ──`);
  for (const sd of secondaries) {
    const m = sd.show;
    if (!m) { console.log(`  ${sd.name}: no evaluable origins`); continue; }
    const cells = sd.at.map(a => `r=${a.r}: M ${pp(a.m?.M)}${a.ci ? ` [${pp(a.ci.lo)},${pp(a.ci.hi)}]` : ''}`);
    console.log(`  ${sd.name} — n ${m.n} (subpool) · fired ${m.faA + (m.drops - m.msA)} · ${cells.join(' · ')} · r* ${rs(m)}${sd.beat.length ? ' · BEATS baseline at r=' + sd.beat.map(b => b.r).join(',') : ''}`);
  }
  console.log(`\nHONESTY: predictor+outcome live on smoothed archive 1h highs (a live 5m dump leads by up to`);
  console.log(`an hour — day-level early warning, not a tick stop). Baseline is a stated replay approximation.`);
  console.log(`One era, ~30d 5m window, item-day clustering ⇒ effective n ≪ nominal. Quote M(r)/r*, never a rate.\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => { console.error(e); process.exit(1); });
}
