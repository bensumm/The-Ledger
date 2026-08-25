#!/usr/bin/env node
/* join-reach-basis.mjs — PLAN-REACH-BASIS-DECISION. Scores the digest's RECENT-3 ask-reach basis
 * against the FULL-WINDOW basis at the production 0.5 threshold, by forward-replaying every logged
 * ask level against the 1h archive.
 *
 * ── READ THIS BEFORE QUOTING ANY NUMBER ───────────────────────────────────────────────────────
 * 1. `reached ≠ filled`. The outcome is "did a 1h bucket print avgHighPrice ≥ the ask", NOT "did
 *    the ask fill". No queue position, no partial fills, no competition at the level. Every
 *    absolute rate here is an UPPER BOUND on filling. The bias is identical across the two bases,
 *    so the PAIRED contrast (M) holds; the absolute rates DO NOT.
 * 2. Counter-direction, so the bound is not one-way: 1h `avgHighPrice` is a trade-side AVERAGE, so
 *    `avg ≥ ask` implies a print at or above, but `avg < ask` does NOT imply no print. The outcome
 *    therefore UNDERCOUNTS prints, partially offsetting (1). Predictor and outcome share the
 *    1h-avgHigh basis deliberately.
 * 3. M(1) IS NOT THE HEADLINE. Accuracy rewards predicting the majority class, and the base rate
 *    moves with the horizon (measured at the shipped default spec: 60.6% at 24h, 43.9% at 8h). The
 *    same data gave M(1)=+2.3pp at 24h and +0.2pp at 8h, while r* moved only 1.76 → 1.04.
 *    **r* is the headline** — it is what does not move.
 * 4. One era, one update cycle. The pool is ~80% July and band/churn dominated; `amplitude`/`value`
 *    rows largely lack the fields. Findings do not transfer to those lanes.
 * 5. SCOPE LIMIT: stale-guarded rows. `digestReachAndPlacement` recomputes the production digest
 *    column at the fresher `quickBuy` on stale-live rows, where that column is not `reachFraction`
 *    output at all. Those rows are not identifiable from the log. This scores THE BASIS QUESTION —
 *    the actual open question — not a byte-exact replay of the production column.
 * 6. Item-day clustering ⇒ effective n is well below nominal. Every CI here resamples ITEMS.
 *
 * WHY THIS EXISTS: `screen-flip-niches.mjs:800-816` flags the digest's recent-preferring basis as a
 * KNOWN, UNDECIDED split against the fold and the rank, and forbids "fixing" it either way without
 * a measurement. This is that measurement. Any flip goes at the one shared `reachFraction` call.
 *
 * PRIOR ART, NOT A BASELINE: the "+9.8pp within-item, p=0.0001, n=6,016" result quoted across many
 * files in this tree has NO recorded method and no surviving script. It is context, not something to
 * beat. (No count is stated here on purpose — two reviewers counted the citing files and disagreed,
 * and a hand-maintained count in this repo has gone stale in exactly this way before.)
 *
 * A NOTE ON A REJECTED ESTIMATOR (kept per the join-depth convention of recording what failed):
 * the first design used Δ = P(Y|D_B) − P(Y|D_A), the outcome-rate gap between the two discordant
 * cells. It is WRONG — it compares rates across disjoint cells and never sees the cell WEIGHTS.
 * With w_A=0.9, p_A=0.6, w_B=0.1, p_B=0.9, recent's accuracy is 0.45 and full's is 0.55, yet
 * Δ=+0.30 declares recent the winner. `mcnemarCost` below is the paired replacement.
 */
import { fileURLToPath } from 'node:url';
import * as archive from '../lib/market/archive.mjs';
import { readSuggestionLines } from '../lib/render/suggestlog.mjs';
import { parseArgs } from '../lib/render/cli.mjs';
import { loadMapping } from '../lib/market/marketfetch.mjs';
import { reachFraction } from '../../js/estimators/reach.mjs';
import { REACH_GRADE_CAP_FRAC } from '../../js/rating.mjs';

// NOW A REAL IMPORT. This was a hand-copied duplicate for as long as the constant lived as a bare
// module-private `const` inside a 3,000-line command, unimportable — so a change at the source could
// not propagate here and the blast-radius bound would silently drift. The warning comment even cited
// a line number that had itself gone stale. The constant moved to `pipeline/lib/signal/digest.mjs`
// precisely so the script that SCORES this threshold can read the one the screen actually applies.
// Re-exported because this module's own consumers expect the name here. F1 owns the value.
// IMPORT then re-export, not `export … from`: a bare re-export creates NO local binding, and this
// module USES the name below (the blast-radius branch-2 count). check-imports caught exactly that.
import { MIRAGE_REACH_FRAC } from '../lib/signal/digest.mjs';
export { MIRAGE_REACH_FRAC };
// The decisive spec (PLAN §3.2) — LOCKED before the run so a favourable subset cannot become the
// headline. Everything else is a sensitivity row.
export const DECISIVE_HORIZON_H = 24;
export const DECISIVE_MIN_DAYS = 7;
export const SENSITIVITY_HORIZONS_H = [8, 24, 48, 72];
// The fold flipped basis on 2026-08-09, mid-pool (PLAN §3.4). A sign flip across these strata
// invalidates the pooled headline.
export const FOLD_FLIP_TS = Date.UTC(2026, 7, 9) / 1000;
export const LEVEL_BUCKET_PCT = 0.005;   // dedup grid — RELATIVE, not absolute gp (PLAN guard 7)
export const BOOTSTRAP_ITERS = 2000;
export const BOOTSTRAP_SEED = 12345;
export const MIN_DISCORDANT_ITEMS = 5;

/* readRows() → the candidate pool, with every field-level guard applied.
 * Guards 4/5/6/9/10: ask side only; askDays ≥ minDays; askRecDays === 3; `ask === optSell`.
 * Two honesty notes about these guards, both measured against the real ledger:
 *  - GUARD 4 (degradation) fires on an ABSENT recent window, not a zero one. Census of askRecDays:
 *    {1: 6, 2: 1, 3: 37801, absent: 2101} — the field is never literally 0, so `!(undefined > 0)`
 *    is what actually does the work. 2,101 rows (5.3% of candidates) are dropped here; without it
 *    `reachFraction` would silently serve them a FULL-window value inside the "recent" arm.
 *  - GUARD 5 (askRecDays === 3) is UNREACHABLE at the decisive spec and is a future-proofing pin,
 *    not an active filter. `recencySplit` sets recentDays = min(fullN, 3), and guard 6 runs first
 *    with minDays = 7, so every surviving row already has 3. All 7 partial rows in the ledger have
 *    askDays < 3 and die on shortWindow. It only binds below `--min-days 3`. (`partialRecent: 0` in
 *    the printed funnel is therefore expected, NOT evidence the guard is broken.)
 *  - GUARD 10 pins the scored level to the COUNTED level: `ask === optSell` on 39,909/39,909 rows
 *    today. The assert is what stops a future logging change from silently scoring one level while
 *    the reach counts were measured at another. */
export function readRows({ minDays = DECISIVE_MIN_DAYS, lines = null } = {}) {
  const src = lines || readSuggestionLines();
  const rows = [];
  const drop = { noEc: 0, noAsk: 0, shortWindow: 0, degraded: 0, partialRecent: 0, levelMismatch: 0 };
  for (const line of src) {
    let r; try { r = JSON.parse(line); } catch { continue; }
    const ec = r.estConfidence;
    if (!ec || r.itemId == null) { drop.noEc++; continue; }
    if (r.ask == null) { drop.noAsk++; continue; }
    const { askHit, askDays, askRecHit, askRecDays } = ec;
    if (!(askDays >= minDays)) { drop.shortWindow++; continue; }
    if (!(askRecDays > 0)) { drop.degraded++; continue; }        // guard 4: recent→full degradation
    if (askRecDays !== 3) { drop.partialRecent++; continue; }    // guard 5: full recent window only
    if (r.optSell != null && r.optSell !== r.ask) { drop.levelMismatch++; continue; }  // guard 10
    rows.push({ ts: r.ts, itemId: r.itemId, ask: r.ask, mode: r.mode, grade: r.grade ?? r.verdict ?? null,
                askHit, askDays, askRecHit, askRecDays });
  }
  return { rows, drop };
}

/* basisPair(row) → { full, rec } via the SHARED reachFraction — never a local re-fork (the header
 * at screen-flip-niches.mjs:800-816 requires this). The remap is load-bearing: reachFraction reads
 * `reachedDays`/`nDays`, while estConfidence logs `askHit`/`askDays`. */
export function basisPair(row) {
  const full = reachFraction({ reachedDays: row.askHit, nDays: row.askDays }, { prefer: 'full' });
  const rec = reachFraction({ reachedDays: row.askHit, nDays: row.askDays,
                              recentHit: row.askRecHit, recentDays: row.askRecDays }, { prefer: 'recent' });
  return { full, rec };
}

/* dedupRows(rows) → one row per (itemId, LOCAL day, ~0.5% RELATIVE level bucket), keep-first.
 * The grid is relative, not round(gp): an absolute grid lets a 19.25m item re-logged at 19.26m
 * survive as "distinct" precisely on the big-ticket rows where the mirage question matters most.
 * Measured impact at the shipped default spec: 37,769 kept rows → 7,904 deduped. (An earlier note
 * here said 12,454 — that was the v1 spike's ABSOLUTE-gp grid, left stale after the grid went
 * relative. The relative grid collapses substantially harder, which is the point.)
 * Without this every CI is far too narrow. */
export function dedupRows(rows) {
  const seen = new Set(), out = [];
  for (const r of [...rows].sort((a, b) => a.ts - b.ts)) {
    const d = new Date(r.ts * 1000);                       // LOCAL day (repo time convention)
    const bucket = Math.round(Math.log(Math.max(1, r.ask)) / Math.log(1 + LEVEL_BUCKET_PCT));
    const key = `${r.itemId}|${d.getFullYear()}-${d.getMonth()}-${d.getDate()}|${bucket}`;
    if (seen.has(key)) continue;
    seen.add(key); out.push(r);
  }
  return out;
}

/* scoreForward(series, ts, level, horizonH) → { resolved, hit }.
 * Guard 2 (no look-ahead): strictly ts < bucket.ts ≤ ts + H.
 * Guard 3 (coverage): unresolved when the archive does not reach the horizon end — EXCLUDED from
 * the denominator, never counted as a miss.
 * Guard 11 (hit rule): any bucket with avgHighPrice ≥ level. */
export function scoreForward(series, ts, level, horizonH) {
  if (!series || !series.length) return { resolved: false, hit: false };
  const end = ts + horizonH * 3600;
  const last = series[series.length - 1].ts;
  if (last < end) return { resolved: false, hit: false };
  let lo = 0, hi = series.length;                          // first index with ts > the suggestion
  while (lo < hi) { const m = (lo + hi) >> 1; if (series[m].ts <= ts) lo = m + 1; else hi = m; }
  for (let i = lo; i < series.length && series[i].ts <= end; i++) {
    const h = series[i].avgHighPrice;
    if (h != null && h >= level) return { resolved: true, hit: true };
  }
  return { resolved: true, hit: false };
}

/* mcnemarCost(scored, r) → the PRIMARY estimator (PLAN §3.1).
 * Two error types: falseGate  = predicted unreliable but it printed (a good row silently dropped);
 *                  falseGreen = predicted reliable but it did not print (an ask that won't fill).
 * r = cost(falseGreen) / cost(falseGate).
 *   M(r) = [cost(full) − cost(recent)] / n     M>0 ⇒ recent cheaper, M<0 ⇒ full cheaper.
 * Concordant rows contribute identically to BOTH arms and cancel EXACTLY — that is what makes this
 * a genuine paired statistic (item, era and time-of-day composition cancel by construction), and
 * it is precisely what the rejected Δ threw away.
 *   rStar solves M(r)=0: (gateFull − gateRec) + r(greenFull − greenRec) = 0. */
export function mcnemarCost(scored, r = 1) {
  const res = scored.filter(s => s.resolved);
  const n = res.length;
  if (!n) return null;
  let gateRec = 0, greenRec = 0, gateFull = 0, greenFull = 0, discordant = 0, printed = 0;
  for (const s of res) {
    if (s.hit) printed++;
    if (s.unrelRec !== s.unrelFull) discordant++;
    if (s.unrelRec && s.hit) gateRec++;
    if (!s.unrelRec && !s.hit) greenRec++;
    if (s.unrelFull && s.hit) gateFull++;
    if (!s.unrelFull && !s.hit) greenFull++;
  }
  const costRec = gateRec + r * greenRec;
  const costFull = gateFull + r * greenFull;
  // r* solves M(r)=0, i.e. A + r·B = 0 with A = gateFull−gateRec, B = greenFull−greenRec.
  // A root only MEANS something at r > 0. When the root is negative or absent the two cost lines
  // never cross in the feasible region: one basis DOMINATES at every positive cost ratio, and
  // printing the negative root as if it were a crossover is nonsense (churn printed r* = −6.17
  // before this guard). Report dominance instead of a number in that case.
  const A = gateFull - gateRec, B = greenFull - greenRec;
  const root = B !== 0 ? -A / B : null;
  const rStar = (root != null && root > 0) ? root : null;
  const dominance = rStar != null ? null
    : ((A !== 0 ? A : B) > 0 ? 'recent' : (A !== 0 ? A : B) < 0 ? 'full' : 'tie');
  // WHICH SIDE OF r* BELONGS TO WHICH BASIS DEPENDS ON sign(B), NOT on a fixed sentence.
  // Since A = −B·r*, M·n = B·(r − r*). So B < 0 ⇒ recent is cheaper BELOW r*; B > 0 ⇒ full is.
  // The shipped data happens to have B < 0, so a hard-coded "recent below r*" legend was
  // accidentally right and would have silently inverted on other data.
  const cheaperBelowRStar = rStar == null ? null : (B < 0 ? 'recent' : 'full');
  // Crossovers against the NULL models. The never-gate verdict REVERSES with r, so quoting it at
  // r=1 alone — in a script whose own header disowns r=1 as the headline — hides that the answer is
  // r-dependent. There are FOUR regimes, not three: never-gate → recent → full → gate-all.
  const nY0 = n - printed, nY1 = printed;
  const cross = (num, den) => (den > 0 ? num / den : null);
  const crossovers = {
    recentVsNeverGate: cross(gateRec, nY0 - greenRec),
    fullVsNeverGate: cross(gateFull, nY0 - greenFull),
    recentVsGateAll: cross(nY1 - gateRec, greenRec),
    fullVsGateAll: cross(nY1 - gateFull, greenFull),
  };
  return {
    n, discordant, printed, baseRate: printed / n,
    gateRec, greenRec, gateFull, greenFull, A, B,
    costRec, costFull, M: (costFull - costRec) / n, rStar, dominance, cheaperBelowRStar, crossovers,
    // Null models (PLAN §3.3) — an all-rows expected-cost comparison, since "always reliable"
    // produces no discordant set and cannot be compared via M.
    costNeverGate: r * nY0, costGateAll: nY1,
  };
}

/* bootstrapM(scored, r, {iters, seed}) → 95% CI on M, resampling ITEMS with replacement.
 * NOT clusterBootstrapCI: that one computes median() per arm, and the median of a {0,1} variable is
 * degenerate; its two-arm nesting refusal would also fire here, since the discordant cells nest
 * almost perfectly inside items. Same seeded LCG and item-resampling, different statistic.
 * Refuses when too few items contribute a DISCORDANT row — M is identically 0 without them, so a
 * CI built on concordant-only draws would look tight while carrying no information. */
export function bootstrapM(scored, r = 1, { iters = BOOTSTRAP_ITERS, seed = BOOTSTRAP_SEED } = {}) {
  const res = scored.filter(s => s.resolved);
  if (res.length < 4) return null;
  const byItem = new Map();
  for (const s of res) { const k = s.itemId ?? 0; if (!byItem.has(k)) byItem.set(k, []); byItem.get(k).push(s); }
  const items = [...byItem.values()];
  if (items.length < 2) return null;
  const discItems = items.filter(rows => rows.some(x => x.unrelRec !== x.unrelFull));
  if (discItems.length < MIN_DISCORDANT_ITEMS) return null;
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const ms = [];
  for (let i = 0; i < iters; i++) {
    const draw = [];
    for (let k = 0; k < items.length; k++) draw.push(...items[Math.floor(rnd() * items.length)]);
    const m = mcnemarCost(draw, r);
    if (m) ms.push(m.M);
  }
  if (ms.length < iters / 4) return null;
  ms.sort((a, b) => a - b);
  return { lo: ms[Math.floor(ms.length * 0.025)], hi: ms[Math.floor(ms.length * 0.975)],
           n: ms.length, items: items.length, discordantItems: discItems.length };
}

/* blastRadius(rows) → an UPPER BOUND on how many rows change digest verdict WORD under a basis
 * flip (PLAN §5, chunk 0 — the DON'T-BUILD gate). Zero archive access.
 * Only branches 1 and 2 of digestVerdict read the basis; everything below them is basis-independent.
 *   branch 1  reachFrac < REACH_GRADE_CAP_FRAC          → 'sell unreliable'
 *   branch 2  askPlacement > 0.85 (families.mjs MIRAGE_PLACEMENT) && reachFrac < MIRAGE_REACH_FRAC
 *             → 'mirage top'
 * `crossable` is absent from the lean row, so we assume it NEVER preempts (upper bound). Branch 2
 * needs `askPlacement`, which IS logged but only on a minority of rows (~18% of a 3,000-row sample),
 * so its term assumes the placement condition always holds rather than filtering on a field most
 * rows lack — a deliberately loose bound, reported SEPARATELY from the exact branch-1 term rather than mixed
 * into it. Churn rows are largely symmetric-EXEMPT in production (reachFrac null ⇒ the tag can
 * never fire), which the raw counts do not reveal, so they are reported separately too. */
export function blastRadius(rows) {
  let b1 = 0, b2 = 0, band = 0, bandB1 = 0;
  for (const row of rows) {
    const { full, rec } = basisPair(row);
    if (full == null || rec == null) continue;
    const uF = full < REACH_GRADE_CAP_FRAC, uR = rec < REACH_GRADE_CAP_FRAC;
    const isBand = row.mode === 'band';
    if (isBand) band++;
    if (uF !== uR) { b1++; if (isBand) bandB1++; }
    else if (!uF && ((full < MIRAGE_REACH_FRAC) !== (rec < MIRAGE_REACH_FRAC))) b2++;
  }
  const n = rows.length;
  return { n, branch1: b1, branch2UpperBound: b2, band, bandBranch1: bandB1,
           fracExact: n ? b1 / n : 0, fracUpperBound: n ? (b1 + b2) / n : 0,
           fracBandExact: band ? bandB1 / band : 0 };
}

// ── CLI (guarded; the pure core above is what the tests import) ─────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const asJson = process.argv.includes('--json');
  const horizonH = args.horizon != null ? Number(args.horizon) : DECISIVE_HORIZON_H;
  const minDays = args['min-days'] != null ? Number(args['min-days']) : DECISIVE_MIN_DAYS;
  const costRatio = args['cost-ratio'] != null ? Number(args['cost-ratio']) : 1;
  const iters = args.iters != null ? Number(args.iters) : BOOTSTRAP_ITERS;
  const onlyItem = args.item != null ? String(args.item) : null;

  const { rows: raw, drop } = readRows({ minDays });
  let rows = dedupRows(raw);
  const dedupedAll = rows.length;                        // before --item, so the funnel reads honestly
  // --item resolution goes through the mapping's OWN resolver. An earlier hand-rolled lookup read
  // `mapping.byId.get(id)` — but byId is a plain OBJECT, not a Map, so every name-based --item
  // resolved to undefined and silently filtered the pool to ZERO while still printing a clean
  // report. Fail loudly on an unresolvable token instead.
  if (onlyItem) {
    let mapping = null; try { mapping = await loadMapping(); } catch {}
    const hit = mapping?.resolve?.(onlyItem);
    if (!hit) { console.error(`--item: could not resolve "${onlyItem}" to an item id`); process.exit(1); }
    rows = rows.filter(r => r.itemId === hit.id);
  }

  const blast = blastRadius(rows);                       // chunk 0 — the DON'T-BUILD gate

  const db = archive.open(archive.DEFAULT_DB, { readonly: true });
  const byItem = new Map();
  for (const r of rows) { if (!byItem.has(r.itemId)) byItem.set(r.itemId, []); byItem.get(r.itemId).push(r); }

  const seriesCache = new Map();                          // fetch each item's series ONCE, reuse across horizons
  for (const itemId of byItem.keys()) seriesCache.set(itemId, db.seriesFor(itemId, '1h', {}));

  const runHorizon = (H) => {
    const scored = [];
    for (const [itemId, rs] of byItem) {
      const series = seriesCache.get(itemId);
      for (const r of rs) {
        const { full, rec } = basisPair(r);
        if (full == null || rec == null) continue;
        const f = scoreForward(series, r.ts, r.ask, H);
        scored.push({ itemId, ts: r.ts, ask: r.ask, mode: r.mode, resolved: f.resolved, hit: f.hit,
                      full, rec, unrelFull: full < REACH_GRADE_CAP_FRAC, unrelRec: rec < REACH_GRADE_CAP_FRAC });
      }
    }
    return scored;
  };

  const decisiveScored = runHorizon(horizonH);
  const decisive = mcnemarCost(decisiveScored, costRatio);
  const ci = bootstrapM(decisiveScored, costRatio, { iters });
  const sensitivity = SENSITIVITY_HORIZONS_H.filter(h => h !== horizonH).map(h => {
    const m = mcnemarCost(runHorizon(h), costRatio);
    return { horizonH: h, M: m?.M ?? null, rStar: m?.rStar ?? null, dominance: m?.dominance ?? null, baseRate: m?.baseRate ?? null, n: m?.n ?? 0 };
  });
  // MODE strata: churn rows are largely reach-EXEMPT in production (reachFrac null ⇒ the tag can
  // never fire), so the band-only row is the production-relevant one; pooling churn measures a
  // gate the digest does not actually apply there.
  const modeStrata = ['band', 'churn'].map(k => {
    const m = mcnemarCost(decisiveScored.filter(s => s.mode === k), costRatio);
    return { mode: k, M: m?.M ?? null, rStar: m?.rStar ?? null, dominance: m?.dominance ?? null, n: m?.n ?? 0,
             costRec: m?.costRec ?? null, costFull: m?.costFull ?? null, costNeverGate: m?.costNeverGate ?? null };
  });
  const bandCi = bootstrapM(decisiveScored.filter(s => s.mode === 'band'), costRatio, { iters });
  const strata = ['pre', 'post'].map(k => {
    const sub = decisiveScored.filter(s => (k === 'pre' ? s.ts < FOLD_FLIP_TS : s.ts >= FOLD_FLIP_TS));
    const m = mcnemarCost(sub, costRatio);
    return { era: k, M: m?.M ?? null, rStar: m?.rStar ?? null, dominance: m?.dominance ?? null, n: m?.n ?? 0 };
  });
  try { db.db.close(); } catch {}

  if (asJson) {
    console.log(JSON.stringify({
      app: 'the-coffer-reach-basis', version: 1, horizonH, minDays, costRatio,
      caveat: 'reached != filled — every absolute rate is an UPPER BOUND on filling; r* is the headline, not M(1)',
      drop, blastRadius: blast, decisive, ci, sensitivity, strata, modeStrata, bandCi,
    }, null, 2));
    return;
  }

  const pct = x => x == null ? '—' : (100 * x).toFixed(1) + '%';
  // r* only means something at a POSITIVE crossing; otherwise one basis dominates at every cost
  // ratio and a negative root must not be printed as if it were a crossover.
  // ⚠ THE EMPTY CASE IS THE ONE THIS KEEPS GETTING WRONG (three iterations: `-6.17`, then
  // `undefined dominates`, then `null dominates`). The strata wrappers are NEVER null — they are
  // objects carrying `{rStar: null, dominance: null, n: 0}` when mcnemarCost declined — so guarding
  // only `o == null` falls straight through to interpolating a null. Guard the FIELDS, not the box.
  // A stratum below this many rows is printed with a ⚠ thin marker — a hard -33.3pp off n=3 reads
  // as a finding otherwise, while the primary correctly refuses its CI at the same n.
  const THIN_N = 30;
  const thin = o => (o && o.n && o.n < THIN_N) ? ' ⚠thin' : '';
  const rs = (o) => {
    if (o == null || !o.n) return '—';
    if (o.rStar != null) return o.rStar.toFixed(2);
    if (o.dominance == null) return '—';
    return o.dominance === 'tie' ? 'tie' : `${o.dominance} dominates ∀r>0`;
  };
  console.log(`\njoin-reach-basis — recent-3 vs full-window at the ${REACH_GRADE_CAP_FRAC} gate`);
  console.log(`decisive spec: horizon ${horizonH}h · askDays ≥ ${minDays} · askRecDays == 3 · r = ${costRatio}`);
  // Print the WHOLE funnel. The drop counts are pre-dedup and pre---item, so showing them beside a
  // post-dedup pool invites reading degraded/pool as a rate (2101/7904 = 27%, which is wrong — the
  // real degradation rate is against the candidate pool).
  const candidates = drop.shortWindow + drop.degraded + drop.partialRecent + drop.levelMismatch + raw.length;
  const degPct = candidates ? (100 * drop.degraded / candidates).toFixed(1) : '—';
  console.log(`funnel: ${candidates} candidates → ${raw.length} kept → ${dedupedAll} deduped${onlyItem ? ` → ${blast.n} after --item "${onlyItem}"` : ''}`);
  console.log(`  dropped — degraded(recent→full) ${drop.degraded} = ${degPct}% of candidates · shortWindow ${drop.shortWindow} · partialRecent ${drop.partialRecent} · levelMismatch ${drop.levelMismatch}`);

  console.log(`\n── BLAST RADIUS (zero-archive; the don't-build gate) ──`);
  console.log(`  branch-1 verdict-word changes (exact): ${blast.branch1} / ${blast.n} = ${pct(blast.fracExact)}`);
  console.log(`  + branch-2 mirage upper bound:         ${blast.branch2UpperBound}  ⇒ ≤ ${pct(blast.fracUpperBound)} overall`);
  console.log(`  band-mode only (churn is largely reach-EXEMPT in production): ${pct(blast.fracBandExact)}`);

  if (!decisive) { console.log('\nno resolved rows — nothing to score'); return; }
  console.log(`\n── PRIMARY (paired McNemar cost contrast) ──`);
  console.log(`  resolved ${decisive.n} · discordant ${decisive.discordant} · base rate P(printed) ${pct(decisive.baseRate)}`);
  console.log(`  recent errors: falseGate ${decisive.gateRec}  falseGreen ${decisive.greenRec}`);
  console.log(`  full   errors: falseGate ${decisive.gateFull}  falseGreen ${decisive.greenFull}`);
  console.log(`  M(${costRatio}) = ${(100 * decisive.M).toFixed(1)}pp   (>0 favours recent-3, <0 favours full-window)`);
  console.log(`  95% CI (item-clustered): ${ci ? `[${(100 * ci.lo).toFixed(1)}, ${(100 * ci.hi).toFixed(1)}]pp over ${ci.items} items (${ci.discordantItems} discordant)` : 'REFUSED — too few discordant items'}`);
  const below = decisive.cheaperBelowRStar, above = below === 'recent' ? 'full' : 'recent';
  console.log(`  ★ r* = ${rs(decisive)}${below ? `  — ${below} cheaper BELOW r*, ${above} above it (direction follows sign(B)=${decisive.B < 0 ? '−' : '+'}, not a fixed sentence)` : ''}`);
  console.log(`  null models @ r=${costRatio}: never-gate ${decisive.costNeverGate.toFixed(0)} · gate-all ${decisive.costGateAll.toFixed(0)} · recent ${decisive.costRec.toFixed(0)} · full ${decisive.costFull.toFixed(0)}`);
  // The null-model verdict REVERSES with r, so a single-r snapshot hides that the answer is
  // r-dependent. Print the crossovers and let the reader place their own cost ratio.
  const cx = decisive.crossovers, f2 = v => v == null ? '—' : v.toFixed(2);
  console.log(`  ⤷ crossovers: recent beats never-gate above r=${f2(cx.recentVsNeverGate)} · full above r=${f2(cx.fullVsNeverGate)}`);
  console.log(`                gate-all takes over above r=${f2(cx.recentVsGateAll)} (recent) / ${f2(cx.fullVsGateAll)} (full)`);
  const regimes = [
    [cx.recentVsNeverGate, 'never-gate'], [decisive.rStar, 'recent-3'],
    [cx.fullVsGateAll, 'full-window'],
  ].filter(([v]) => v != null);
  if (regimes.length) {
    const parts = regimes.map(([v, label], i) => `${label} < ${f2(v)}`).join(' · ');
    console.log(`  ⤷ regime map (r ascending): ${parts} · gate-all above`);
  }

  console.log(`\n── SENSITIVITY (printed regardless of outcome) ──`);
  for (const s of sensitivity) console.log(`  ${String(s.horizonH).padStart(3)}h  M ${s.M == null ? '—' : (100 * s.M).toFixed(1) + 'pp'}  r* ${rs(s)}  base ${pct(s.baseRate)}  n ${s.n}${thin(s)}`);
  console.log(`── MODE STRATA (band is the production-relevant row — churn is largely reach-EXEMPT) ──`);
  for (const s of modeStrata) console.log(`  ${s.mode.padEnd(5)} M ${s.M == null ? '—' : (100 * s.M).toFixed(1) + 'pp'}  r* ${rs(s)}  n ${s.n}${thin(s)}  cost rec/full/never ${s.costRec?.toFixed(0) ?? '—'}/${s.costFull?.toFixed(0) ?? '—'}/${s.costNeverGate?.toFixed(0) ?? '—'}`);
  if (bandCi) console.log(`  band 95% CI: [${(100 * bandCi.lo).toFixed(1)}, ${(100 * bandCi.hi).toFixed(1)}]pp over ${bandCi.items} items (${bandCi.discordantItems} discordant)`);
  console.log(`── ERA STRATA (fold flipped basis 2026-08-09; a sign flip invalidates the pooled headline) ──`);
  for (const s of strata) console.log(`  ${s.era.padEnd(4)}  M ${s.M == null ? '—' : (100 * s.M).toFixed(1) + 'pp'}  r* ${rs(s)}  n ${s.n}${thin(s)}`);

  console.log(`\nHONESTY: reached ≠ filled — absolute rates are an UPPER BOUND on filling; the paired`);
  console.log(`contrast is what holds. One era, one update cycle, ~80% July, band/churn dominated.`);
  console.log(`M(1) moves with the horizon via class imbalance — quote r*, not M(1).\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => { console.error(e); process.exit(1); });
}
