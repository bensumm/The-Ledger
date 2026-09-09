#!/usr/bin/env node
/**
 * wk3-class-cycle-study.mjs — WK3 (plans/PLAN-WEEKLY-CYCLE.md, owner directives 2026-09-08):
 * "Was the WK2 analysis done by item class? We should investigate which kinds of items fail and
 * which kinds of items succeed." — AMENDED before any run by a second owner message (2026-09-08,
 * verbatim, folded into this same pre-registration commit): "The end goal is to be able to judge
 * if an item is advantageous to buy and determine the yield as it fluctuates, we don't need to
 * define or identify a concrete cycle necessarily." So the PRIMARY measurement is TEST Y below —
 * a per-class DEVIATION-CONDITIONED FORWARD-YIELD profile (is a dislocated price advantageous,
 * and by how much, after tax?) — and the cycle tests (A/B/C) are SECONDARY/descriptive: a
 * confirmed class cycle would explain a yield profile's shape, but the program's branches hang
 * on yield, not periodicity. WK2 context: per-item cycles → zero FDR discoveries (corrected
 * null); universe basket p=0.586; class-level baskets never tested — and §1's finding was
 * precisely a class-basket effect (five gear items individually noisy, collectively t=4.48).
 * Failures are first-class output: classes where deep deviations predict CONTINUED FALL are the
 * knife classes (DT1's adverse-selection lesson, measured directly).
 * DIAGNOSTIC / INFORM-ONLY: nothing here gates, sizes, or auto-prices.
 *
 * ── TEST Y (PRIMARY) — deviation-conditioned forward yield, per class ───────────────────────────
 * REFERENCE IS STRICTLY TRAILING — the lookahead trap, stated up front: WK2's 15d CENTERED
 * detrend uses future data; fine for describing cycles, DISQUALIFYING for a buy-signal
 * measurement (a yield profile off the centered reference is the §2a saturation trap in new
 * clothes). Here dev_t = mid_t / trailMean15_t − 1, trailMean15 = mean of the item's daily mids
 * over di−15..di−1, requiring ≥12 of 15 days present; else the day is skipped.
 * BUCKETS (fixed edges, %): ≤−7 | (−7,−4] | (−4,−2] | (−2,−0.5] | (−0.5,+0.5) neutral |
 * [+0.5,+2) | [+2,+4) | ≥+4.
 * FORWARD YIELD at h ∈ {2,4,7}d: net_h(t) = (0.98·mid_{t+h} − mid_t)/mid_t (buy the mid, sell
 * the mid h days later, 2% tax; mid at EXACTLY di+h required, else the (t,h) sample is skipped).
 * Also P(profitable exit ≤ h) = share of samples with any s ∈ (t, t+h] where 0.98·mid_s > mid_t.
 * SERIAL DEPENDENCE (WK1's ρ≈0.61 lesson): the UNIT IS THE ITEM, paired within item — per item
 * i and cell (bucket b, horizon h): adv_i = mean(net_h | its days in b) − mean(net_h | all its
 * days); class advantage = mean of adv_i over items with ≥5 days in b; se/t across items.
 * Pairing removes item drift; item-level aggregation removes overlapping-window dependence.
 * Cross-ITEM same-day correlation remains and is a stated limit (common market days make the
 * across-item se optimistic).
 * DECISION CELLS + MULTIPLICITY: branch decisions read ONLY the three deep-negative buckets
 * (≤−7, (−7,−4], (−4,−2]) at h=4d (the lane's horizon) — ~10 named classes × 3 buckets, BH-FDR
 * q=0.05, two-sided (the NEGATIVE tail names knife classes). Everything else descriptive.
 * A class SUCCEEDS iff some decision cell is BH-significant with mean advantage ≥ +1.0% after
 * tax on ≥15 contributing items. A class is a KNIFE class iff a decision cell is BH-significant
 * with NEGATIVE advantage (deep deviation predicts continued fall).
 * LANE-INCREMENT CHECK (must run before outcome (i) may fire): within each succeeding class,
 * split decision-cell days by whether the day's deviation is below that item's own full-era p10
 * of trailing deviation (proxy for "the amplitude lane's trough-touch entry would already have
 * fired"; in-sample percentile, stated). If the advantage lives ONLY in the sub-p10 split, the
 * lane already captures it → outcome (ii), not (i).
 *
 * ── REFRAMED PRE-REGISTERED OUTCOMES (thresholds fixed before any run) ──────────────────────────
 *  (i)  ≥1 named class SUCCEEDS (per TEST Y) with advantage NOT confined to the sub-p10 split →
 *       next chunk designs the inform-only surface: "current deviation + measured conditional
 *       yield", connected to the amplitude lane's estimator frame.
 *  (ii) advantage exists but only where the lane already fires (sub-p10-confined, per the
 *       increment check) → "the lane already captures it"; document and close.
 *  (iii) no class shows a positive conditional advantage → the plan closes for good, class
 *       question answered.
 *  Knife classes are reported under every outcome.
 *
 * Detection/series machinery is COPIED from wk2-period-phase-universe.mjs as of commit 9fb2cd9
 * (the CORRECTED instrument: surrogate mids through the same deviations()/MA15 pipeline — C1;
 * weekday from the date string — C2). WK2 is a top-level script, not importable; a copy with this
 * provenance note was the pre-registered fallback. Do NOT re-introduce the unfiltered-surrogate
 * bug: every null series in this file passes through deviations() before scoring.
 *
 * ── PRE-REGISTERED TAXONOMY + DECISION RULE (committed BEFORE any class-level result is
 *    computed; smoke mode below is structurally unable to print class results) ──────────────────
 *
 * TAXONOMY. Metadata only: item NAME + GE buy LIMIT (pipeline/.cache/mapping.cache.json — the
 * cache holds nothing else) + archive-derived ERA-MEAN daily mid and gp/day. No rule references
 * any specific item's WK2 result; the §1 five must qualify for the gear class by METADATA (they
 * do: all limit 8, all era-mean ≥ 5m), never by enumeration. Ordered rules, FIRST MATCH WINS,
 * every tested item lands in exactly one class; "unclassified" is legitimate and its size is
 * reported. Audit: 10 seeded-random members per class are printed so misassignments are visible.
 *   1 bigticket-lowlimit  era-mean mid ≥ 5m AND limit ≤ 15         (the big-ticket gear proxy;
 *                         §3's confirmation class)
 *   2 potion-dose         name ends "(1)".."(9)"
 *   3 rune                name ends " rune"
 *   4 ammo                name matches bolt/arrow/dart/javelin/cannonball/tips forms
 *   5 seed-sapling        name contains " seed"/" sapling"
 *   6 herb                "Grimy X" or a clean-herb name (14-name list)
 *   7 bones-ashes         name ends "bones"/"ashes"
 *   8 raw-material        ore/bar/logs/plank/Uncut/Raw/hide/leather name forms
 *   9 midvalue-lowlimit   era-mean mid ≥ 100k AND limit ≤ 70       (mid-tier gear proxy)
 *  10 bulk-commodity      limit ≥ 1000
 *  11 unclassified        everything else (reported, EXCLUDED from branch counting — it is not a
 *                         "kind of item", it is the absence of a rule)
 * Stated limit: heuristic classes; misassignment DILUTES real class effects (biases toward null).
 *
 * TEST A — CLASS-BASKET periodicity, per class × two families:
 *   RAW basket_c(t) = equal-weighted mean over tested members' deviation series d_t;
 *   SUB basket_c(t) = same over d_t − universeBasket_t (universe basket per WK2: tested ∧ gp/d
 *   ≥ 1m, equal-weighted). Statistic S = max-R² sinusoid over P = 3–14d step 0.25 (WK2's grid).
 *   NULL, persistence-matched on the BASKET series itself: the basket's observed FILTERED lag-1
 *   r1 decides the family — r1 ≤ 0.61 → WK2's AR(1)-mid family (φ via the same inverse lookup);
 *   r1 > 0.61 (above the AR(1) family's measured ceiling, WK2 C1 stated limit) → an
 *   MA-innovation family: boxcar-smoothed white noise of width w, w BISECTION-TUNED so the
 *   surrogate's filtered lag-1 matches the basket's, mids 100·(1+0.01·y) through the SAME
 *   deviations() pipeline. 10,000 draws, seeded; p = (1+#{S*≥S})/(1+N).
 *   WHY NOT the member-surrogate basket null (a deliberate, pre-registered deviation from the
 *   chunk brief): members are cross-correlated (§1 measured hilt~staff r=0.776), independent
 *   member surrogates average toward a WHITER basket than the real one, so that null is
 *   anti-conservative exactly where it matters. Matching the basket's OWN filtered persistence
 *   is the honest instrument; the member-null runs anyway as a LABELED SENSITIVITY (1,000
 *   draws, classes with primary p ≤ 0.10 only, decides nothing).
 *   MULTIPLICITY: BH-FDR q=0.05 across named classes, each family (RAW/SUB) corrected
 *   separately; expected false ≈ 0.05 × discoveries, stated in the output.
 *
 * TEST B — per-item ENRICHMENT, per class: Mann–Whitney rank-sum (normal approx, tie-corrected,
 *   two-sided) of the class's tested members' per-item RAW p-values (recomputed here with WK2's
 *   corrected per-item instrument, same seed) against all other tested items; repeated on the
 *   SUB family. BH q=0.05 across named classes — DESCRIPTIVE ONLY, fires no branch (per-item
 *   p-values share the phiMap saturation limit: a class of high-persistence items gets
 *   systematically smaller p's, so each class's median filtered r1 is printed beside its
 *   enrichment p and any r1-median > 0.61 carries that caveat). DEAD classes — enrichment
 *   pointing the WRONG way or median member p ≥ 0.5 — are named explicitly: the owner asked
 *   which kinds fail, and "reliably nothing here" is a first-class answer.
 *
 * TEST C — the §1 CONFIRMATION, single pre-specified hypothesis (no class multiplicity: §1's
 *   gear-basket weekend effect predates WK1 and is a genuine prior): on class 1's tested
 *   members, §1's EXACT statistic generalized — per member 7d-centered detrend, equal-weighted
 *   class-day mean, weeks Mon–Sun local; per week with a Tuesday AND ≥1 weekend day present,
 *   gap_w = mean(Sat/Sun deviations) − Tuesday deviation; t = mean(gap)/se across weeks.
 *   CONFIRMS iff t ≥ one-sided t crit at α=0.05 (direction weekend > Tue, §1's). The same
 *   statistic prints for every class as DESCRIPTIVE columns, and for the literal §1 five as a
 *   REPRODUCTION row (plan §5 bullet 1 — expect t ≈ 4.48; a failure to reproduce is reported,
 *   not reconciled).
 *
 * TESTS A/B/C ARE SECONDARY under the owner amendment (they explain, they do not decide): a
 * class-basket FDR discovery (A, p2t ≥ 2%) or a Test C gear confirmation is REPORTED as
 * descriptive support beside the yield profile, fires no branch on its own, and Test C keeps
 * its single pre-specified α=0.05 one-sided status as §1's genuine prior.
 * Honesty: ONE era (~104d, one season); heuristic classes dilute; basket amplitudes carry the
 * same MA15 filter gain (≤ ~22% in-band, WK2 C3) and winner's-curse selection as WK2's; Test C
 * weeks n ≈ 14 — significance ≠ tradeable size; TEST Y mid-to-mid yields assume fills AT the
 * daily mean mid on both legs (no depth/queue claim — inform-only measurement, not a backtest).
 *
 * Smoke: `--audit` prints ONLY the taxonomy audit (class sizes + seeded member samples) and
 * exits before any detection; `--limit N` caps the universe for wiring checks and prints NO
 * class tests and NO branch. Full run: `node pipeline/experiments/wk3-class-cycle-study.mjs`
 * (`--json <path>` dumps machine output).
 */
import { pathToFileURL } from 'node:url';
import * as path from 'node:path';
import * as fs from 'node:fs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const imp = rel => import(pathToFileURL(path.join(ROOT, rel)).href);
const { open } = await imp('pipeline/lib/market/archive.mjs');

const SEED = 20260908;
const PERIODS = []; for (let p = 3; p <= 14.0001; p += 0.25) PERIODS.push(Number(p.toFixed(2)));
const SURR_N = 10_000, MEMBER_NULL_N = 1_000, MEMBER_NULL_PMAX = 0.10;
const FDR_Q = 0.05;
const MIN_DAYS = 70, MIN_COVERAGE = 0.85;
const MA_W = 15, MA_HALF = 7;
const BASKET_MIN_GPD = 1e6;
const R1_CEILING = 0.61;               // AR(1)-mid family's measured filtered-lag1 ceiling (WK2 C1)
const CLS_MIN_MEMBERS = 8;             // classes below this are reported but not tested (power floor)
const BR_I_MIN_P2T = 2.0;              // basket peak-to-trough support floor (secondary Test A), %
// TEST Y (primary) — all fixed pre-run
const Y_BUCKETS = [[-Infinity, -7], [-7, -4], [-4, -2], [-2, -0.5], [-0.5, 0.5], [0.5, 2], [2, 4], [4, Infinity]];
const Y_LBL = ['<=-7%', '(-7,-4]', '(-4,-2]', '(-2,-.5]', 'neutral', '[+.5,+2)', '[+2,+4)', '>=+4%'];
const Y_H = [2, 4, 7], Y_DECIDE_H = 4, Y_DECIDE_BUCKETS = [0, 1, 2];
const Y_TRAIL = 15, Y_TRAIL_MIN = 12, Y_MIN_DAYS_BUCKET = 5, Y_MIN_ITEMS = 15, Y_ADV_MIN = 1.0;
const TAX = 0.98;
const DAYS_LBL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const argAt = f => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : null; };
const auditOnly = process.argv.includes('--audit');
const limitN = argAt('--limit') ? Number(argAt('--limit')) : null;
const smoke = limitN != null;

// ---- daily series (bulk, read-only — copied from WK2 @ 9fb2cd9) --------------------------------
const mapping = JSON.parse(fs.readFileSync(path.join(ROOT, 'pipeline', '.cache', 'mapping.cache.json'), 'utf8'));
const h = open(undefined, { readonly: true });
const now = new Date(); now.setHours(0, 0, 0, 0);
const eraEnd = Math.floor(now.getTime() / 1000) - 1;
const rows = h.db.prepare(`
  SELECT itemId, date(ts, 'unixepoch', 'localtime') AS d,
         AVG((avgHighPrice + avgLowPrice) / 2.0) AS mid,
         SUM(COALESCE(highPriceVolume,0)*COALESCE(avgHighPrice,0)
           + COALESCE(lowPriceVolume,0)*COALESCE(avgLowPrice,0)) AS gp
    FROM observations
   WHERE grain = '1h' AND ts <= ? AND avgHighPrice IS NOT NULL AND avgLowPrice IS NOT NULL
   GROUP BY itemId, d ORDER BY itemId, d`).all(eraEnd);
h.close?.();

const dayIdx = dstr => Math.round(Date.parse(dstr + 'T12:00:00') / 86400000);
const byItem = new Map();
for (const r of rows) {
  let it = byItem.get(r.itemId); if (!it) byItem.set(r.itemId, it = []);
  it.push({ di: dayIdx(r.d), d: r.d, mid: r.mid, gp: r.gp });
}

function deviations(days) {
  const byDi = new Map(days.map(x => [x.di, x]));
  const out = [];
  for (const x of days) {
    let s = 0, n = 0;
    for (let k = -MA_HALF; k <= MA_HALF; k++) { const y = byDi.get(x.di + k); if (y) { s += y.mid; n++; } }
    if (n === MA_W && x.mid > 0) out.push({ di: x.di, d: x.d, v: x.mid / (s / n) - 1 });
  }
  return out;
}

// ---- fit machinery (copied from WK2 @ 9fb2cd9) --------------------------------------------------
function fitPeriod(ts, vs, P) {
  const w = 2 * Math.PI / P;
  let Ss = 0, Sc = 0, Sss = 0, Scc = 0, Ssc = 0, Sv = 0, Svs = 0, Svc = 0;
  const n = ts.length;
  for (let i = 0; i < n; i++) {
    const s = Math.sin(w * ts[i]), c = Math.cos(w * ts[i]), v = vs[i];
    Ss += s; Sc += c; Sss += s * s; Scc += c * c; Ssc += s * c; Sv += v; Svs += v * s; Svc += v * c;
  }
  const M = [[n, Ss, Sc, Sv], [Ss, Sss, Ssc, Svs], [Sc, Ssc, Scc, Svc]];
  for (let col = 0; col < 3; col++) {
    let piv = col; for (let r2 = col + 1; r2 < 3; r2++) if (Math.abs(M[r2][col]) > Math.abs(M[piv][col])) piv = r2;
    [M[col], M[piv]] = [M[piv], M[col]];
    if (Math.abs(M[col][col]) < 1e-12) return { r2: 0, a: 0, b: 0 };
    for (let r2 = 0; r2 < 3; r2++) if (r2 !== col) {
      const f = M[r2][col] / M[col][col];
      for (let c2 = col; c2 < 4; c2++) M[r2][c2] -= f * M[col][c2];
    }
  }
  const c0 = M[0][3] / M[0][0], a = M[1][3] / M[1][1], b = M[2][3] / M[2][2];
  let sse = 0, sst = 0; const vbar = Sv / n;
  for (let i = 0; i < n; i++) {
    const s = Math.sin(w * ts[i]), c = Math.cos(w * ts[i]);
    const e = vs[i] - (c0 + a * s + b * c);
    sse += e * e; sst += (vs[i] - vbar) * (vs[i] - vbar);
  }
  return { r2: sst > 0 ? 1 - sse / sst : 0, a, b };
}
const maxR2 = (ts, vs) => {
  let best = { r2: -1, P: null, a: 0, b: 0 };
  for (const P of PERIODS) { const f = fitPeriod(ts, vs, P); if (f.r2 > best.r2) best = { ...f, P }; }
  return best;
};
function lag1(devs) {
  let sxy = 0, sxx = 0, syy = 0, sx = 0, sy = 0, n = 0;
  for (let i = 1; i < devs.length; i++) if (devs[i].di === devs[i - 1].di + 1) {
    const x = devs[i - 1].v, y = devs[i].v; sxy += x * y; sxx += x * x; syy += y * y; sx += x; sy += y; n++;
  }
  if (n < 10) return 0;
  const cov = sxy / n - (sx / n) * (sy / n), vx = sxx / n - (sx / n) ** 2, vy = syy / n - (sy / n) ** 2;
  return vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : 0;
}
function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(SEED);
function gauss() { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// C1-corrected AR(1)-mid null family (copied from WK2 @ 9fb2cd9)
function filteredDevs(phi, n) {
  const need = n + MA_W - 1;
  let x = 0; for (let i = 0; i < 50; i++) x = phi * x + gauss();
  const days = [];
  for (let i = 0; i < need; i++) { x = phi * x + gauss(); days.push({ di: i, mid: 100 * (1 + 0.01 * x) }); }
  return deviations(days);
}
const phiMap = [];
for (let phi = 0; phi <= 0.9901; phi += 0.01) {
  let s = 0; const R = 60;
  for (let k = 0; k < R; k++) s += lag1(filteredDevs(phi, 90));
  phiMap.push({ phi: Number(phi.toFixed(2)), r1f: s / R });
}
const phiFor = r1 => phiMap.reduce((b, e) => Math.abs(e.r1f - r1) < Math.abs(b.r1f - r1) ? e : b).phi;

const surrCache = new Map();
function surrDraws(r1, n) {
  const phib = Math.round(phiFor(r1) / 0.02) * 0.02;
  const nb = Math.max(MIN_DAYS, Math.round(n / 5) * 5);
  const key = `${phib.toFixed(2)}|${nb}`;
  if (surrCache.has(key)) return surrCache.get(key);
  const draws = new Float64Array(SURR_N);
  for (let k = 0; k < SURR_N; k++) {
    const devs = filteredDevs(phib, nb);
    draws[k] = maxR2(devs.map(z => z.di), devs.map(z => z.v)).r2;
  }
  draws.sort();
  surrCache.set(key, draws);
  return draws;
}
const pOf = (draws, S) => { let lo = 0, hi = draws.length; while (lo < hi) { const m = (lo + hi) >> 1; if (draws[m] < S) lo = m + 1; else hi = m; } return (1 + (draws.length - lo)) / (1 + draws.length); };

// MA-innovation family for basket series ABOVE the AR(1) ceiling (WK2 C1 stated limit): boxcar
// width w (real-valued via fractional last tap), bisection-tuned so filtered lag-1 matches.
function maFilteredDevs(w, n) {
  const need = n + MA_W - 1, wi = Math.floor(w), frac = w - wi;
  const raw = []; for (let i = 0; i < need + wi + 1; i++) raw.push(gauss());
  const days = [];
  for (let i = 0; i < need; i++) {
    let s = 0; for (let k = 0; k < wi; k++) s += raw[i + k];
    s += frac * raw[i + wi];
    days.push({ di: i, mid: 100 * (1 + 0.01 * (s / (wi + frac || 1))) });
  }
  return deviations(days);
}
function maWidthFor(r1, n) {
  let lo = 1, hi = 60;
  const meanR1 = w => { let s = 0; const R = 40; for (let k = 0; k < R; k++) s += lag1(maFilteredDevs(w, n)); return s / R; };
  for (let it = 0; it < 18; it++) {
    const mid = (lo + hi) / 2;
    if (meanR1(mid) < r1) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
function basketNullDraws(r1, n, tag) {
  if (r1 <= R1_CEILING) return { fam: 'AR1', draws: surrDraws(r1, n) };
  const key = `MA|${tag}`;
  if (surrCache.has(key)) return { fam: 'MA', draws: surrCache.get(key) };
  const w = maWidthFor(r1, n);
  // W5a (round-1 review): the family RAILS at w=60 for the highest-r1 baskets — persistence is
  // not fully matched at the top (WK2 R2-1's sibling); harmless while nothing is significant.
  const railed = w >= 59.5;
  const draws = new Float64Array(SURR_N);
  for (let k = 0; k < SURR_N; k++) {
    const devs = maFilteredDevs(w, n);
    draws[k] = maxR2(devs.map(z => z.di), devs.map(z => z.v)).r2;
  }
  draws.sort();
  surrCache.set(key, draws);
  return { fam: `MA(w=${w.toFixed(1)}${railed ? ' RAIL — persistence under-matched' : ''})`, draws };
}

function phaseDrift(devs, P) {
  const half = Math.floor(devs.length / 2);
  const fit = part => { const f = fitPeriod(part.map(x => x.di), part.map(x => x.v), P); return Math.atan2(f.b, f.a); };
  let d = fit(devs.slice(half)) - fit(devs.slice(0, half));
  while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d) * P / (2 * Math.PI);
}
function troughWeekday(devs) {           // C2-corrected: wd0 from the date string
  const f = fitPeriod(devs.map(x => x.di), devs.map(x => x.v), 7);
  const phi = Math.atan2(f.b, f.a);
  const tMin = ((-phi - Math.PI / 2) / (2 * Math.PI)) * 7;
  const anchor = devs[0].di;
  const wd0 = new Date(devs[0].d + 'T12:00:00').getDay();
  const off = ((tMin - anchor) % 7 + 7) % 7;
  return (wd0 + Math.round(off)) % 7;
}

// ---- universe -----------------------------------------------------------------------------------
let universe = [];
for (const [id, days] of byItem) {
  const span = days.length ? days[days.length - 1].di - days[0].di + 1 : 0;
  const devs = deviations(days);
  const gpd = days.length ? days.reduce((s, x) => s + (x.gp || 0), 0) / days.length : 0;
  const eraMid = days.length ? days.reduce((s, x) => s + x.mid, 0) / days.length : 0;
  universe.push({
    id, name: mapping[id]?.name || `#${id}`, limit: mapping[id]?.limit ?? null,
    days, devs, gpd, eraMid,
    tested: devs.length >= MIN_DAYS && span > 0 && days.length / span >= MIN_COVERAGE,
  });
}
if (limitN != null) universe = universe.slice(0, limitN);

// ---- taxonomy (ordered, first match wins — pre-registered above) -------------------------------
const CLEAN_HERBS = ['Guam leaf', 'Marrentill', 'Tarromin', 'Harralander', 'Ranarr weed', 'Toadflax',
  'Irit leaf', 'Avantoe', 'Kwuarm', 'Snapdragon', 'Cadantine', 'Lantadyme', 'Dwarf weed', 'Torstol'];
function classify(u) {
  const n = u.name;
  if (u.eraMid >= 5e6 && u.limit != null && u.limit <= 15) return 'bigticket-lowlimit';
  if (/\(\d\)$/.test(n)) return 'potion-dose';
  if (/ rune$/i.test(n)) return 'rune';
  if (/(bolts?( ?\(e\))?$|arrows?( ?\(p\+*\))?$|darts?$|javelins?$|cannonball$|bolt tips$|arrowtips$|dart tips?$)/i.test(n)) return 'ammo';
  if (/( seed| sapling)s?$/i.test(n)) return 'seed-sapling';
  if (/^grimy /i.test(n) || CLEAN_HERBS.includes(n)) return 'herb';
  if (/(bones|ashes)$/i.test(n)) return 'bones-ashes';
  if (/( ore$| bar$|logs$| plank$|^uncut |^raw )/i.test(n) || /(hide$|leather$)/i.test(n)) return 'raw-material';
  if (u.eraMid >= 1e5 && u.limit != null && u.limit <= 70) return 'midvalue-lowlimit';
  if (u.limit != null && u.limit >= 1000) return 'bulk-commodity';
  return 'unclassified';
}
for (const u of universe) u.cls = classify(u);
const tested = universe.filter(u => u.tested);
const CLASSES = ['bigticket-lowlimit', 'potion-dose', 'rune', 'ammo', 'seed-sapling', 'herb',
  'bones-ashes', 'raw-material', 'midvalue-lowlimit', 'bulk-commodity', 'unclassified'];
const members = c => tested.filter(u => u.cls === c);

// taxonomy audit (always printed; the ONLY output in --audit mode)
console.log(`WK3 class-cycle study — ${universe.length} archive items, ${tested.length} tested; era to ${new Date(eraEnd * 1000).toISOString().slice(0, 10)}${smoke ? '  [SMOKE — no class tests, no branch]' : ''}`);
console.log('\nTAXONOMY (tested members; 10 seeded-random samples each):');
const auditRnd = mulberry32(SEED + 1);
for (const c of CLASSES) {
  const ms = members(c);
  const sample = [...ms].map(u => ({ u, k: auditRnd() })).sort((a, b) => a.k - b.k).slice(0, 10).map(x => x.u.name);
  console.log(`  ${c.padEnd(20)} n=${String(ms.length).padStart(4)}  ${sample.join(' · ')}`);
}
if (auditOnly) { console.log('\n(--audit: stopping before any detection — pre-registration smoke)'); process.exit(0); }

// ---- per-item detection (raw + universe-basket-subtracted; WK2 instrument) ---------------------
const basketMembers = tested.filter(u => u.gpd >= BASKET_MIN_GPD);
const basketAcc = new Map();
for (const u of basketMembers) for (const x of u.devs) {
  const e = basketAcc.get(x.di) || { s: 0, n: 0 }; e.s += x.v; e.n++; basketAcc.set(x.di, e);
}
const uBasket = new Map([...basketAcc].map(([di, e]) => [di, e.s / e.n]));

function detect(devs) {
  const ts = devs.map(x => x.di), vs = devs.map(x => x.v);
  const best = maxR2(ts, vs);
  const r1 = lag1(devs);
  const p = pOf(surrDraws(r1, devs.length), best.r2);
  return { p, P: best.P, r2: best.r2, r1, p2t: 200 * Math.hypot(best.a, best.b), drift: phaseDrift(devs, best.P) };
}
const t0 = Date.now();
for (const u of tested) {
  u.raw = detect(u.devs);
  const sub = u.devs.filter(x => uBasket.has(x.di)).map(x => ({ di: x.di, d: x.d, v: x.v - uBasket.get(x.di) }));
  u.sub = sub.length >= MIN_DAYS ? detect(sub) : null;
  u.subDevs = sub;
}
console.log(`\n(per-item detection done: ${tested.length} items, ${surrCache.size} surrogate bins, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
if (smoke) { console.log('[SMOKE mode ends here — class tests suppressed by design]'); process.exit(0); }

// ---- TEST Y (PRIMARY): deviation-conditioned forward yield, strictly trailing reference --------
function ibetacf(a, b, x) { let m2, aa, c = 1, d = 1 - (a + b) * x / (a + 1); if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d; let h2 = d; for (let mm = 1; mm <= 200; mm++) { m2 = 2 * mm; aa = mm * (b - mm) * x / ((a + m2 - 1) * (a + m2)); d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30; c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30; d = 1 / d; h2 *= d * c; aa = -(a + mm) * (a + b + mm) * x / ((a + m2) * (a + m2 + 1)); d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30; c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30; d = 1 / d; const del = d * c; h2 *= del; if (Math.abs(del - 1) < 3e-7) break; } return h2; }
function lgamma(x) { const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]; let y = x, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp); let ser = 1.000000000190015; for (let j = 0; j < 6; j++) ser += g[j] / ++y; return -tmp + Math.log(2.5066282746310005 * ser / x); }
function ibeta(a, b, x) { if (x <= 0) return 0; if (x >= 1) return 1; const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x)); return x < (a + 1) / (a + b + 2) ? bt * ibetacf(a, b, x) / a : 1 - bt * ibetacf(b, a, 1 - x) / b; }
const tTwoSided = (t, df) => df > 0 ? ibeta(df / 2, 0.5, df / (df + t * t)) : 1;

const bucketOf = pct => Y_BUCKETS.findIndex(([lo, hi]) => pct > lo && pct <= hi) !== -1
  ? Y_BUCKETS.findIndex(([lo, hi]) => pct > lo && pct <= hi)
  : (pct <= -7 ? 0 : Y_BUCKETS.length - 1);
for (const u of tested) {
  const midBy = new Map(u.days.map(x => [x.di, x.mid]));
  u.ySamples = [];                       // {b, dev, net: {h: net}, hit: {h: bool}}
  const devsArr = [];
  for (const x of u.days) {
    let s = 0, n = 0;
    for (let k = 1; k <= Y_TRAIL; k++) { const m0 = midBy.get(x.di - k); if (m0 != null) { s += m0; n++; } }
    if (n < Y_TRAIL_MIN || x.mid <= 0) continue;
    const dev = (x.mid / (s / n) - 1) * 100;
    devsArr.push(dev);
    const smp = { b: bucketOf(dev), dev, di: x.di, gp: x.gp || 0, net: {}, hit: {} };
    let any = false;
    for (const h2 of Y_H) {
      const fm = midBy.get(x.di + h2);
      if (fm != null) { smp.net[h2] = (TAX * fm - x.mid) / x.mid * 100; any = true; }
      let hit = false;
      for (let s2 = 1; s2 <= h2; s2++) { const m2 = midBy.get(x.di + s2); if (m2 != null && TAX * m2 > x.mid) { hit = true; break; } }
      smp.hit[h2] = hit;
    }
    if (any) u.ySamples.push(smp);
  }
  devsArr.sort((a, b) => a - b);
  u.yP10 = devsArr.length ? devsArr[Math.floor(0.1 * (devsArr.length - 1))] : null;
}
// per class × bucket × horizon: item-paired advantage
function yCell(ms, b, h2, filter) {      // filter(smp) optional extra condition on bucket days
  const advs = [];
  for (const u of ms) {
    const all = u.ySamples.filter(s => s.net[h2] != null);
    const inB = all.filter(s => s.b === b && (!filter || filter(u, s)));
    if (inB.length < Y_MIN_DAYS_BUCKET || all.length < 20) continue;
    const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
    advs.push({
      adv: mean(inB.map(s => s.net[h2])) - mean(all.map(s => s.net[h2])),
      cond: mean(inB.map(s => s.net[h2])), base: mean(all.map(s => s.net[h2])),
      hit: mean(inB.map(s => s.hit[h2] ? 1 : 0)), baseHit: mean(all.map(s => s.hit[h2] ? 1 : 0)),
      nDays: inB.length,
    });
  }
  if (!advs.length) return null;
  const mean = advs.reduce((s, a) => s + a.adv, 0) / advs.length;
  const sd = advs.length > 1 ? Math.sqrt(advs.reduce((s, a) => s + (a.adv - mean) ** 2, 0) / (advs.length - 1)) : 0;
  const se = sd / Math.sqrt(advs.length);
  const t = se > 0 ? mean / se : 0;
  return {
    nItems: advs.length, nDays: advs.reduce((s, a) => s + a.nDays, 0),
    adv: mean, se, t, p: tTwoSided(t, advs.length - 1),
    cond: advs.reduce((s, a) => s + a.cond, 0) / advs.length,
    base: advs.reduce((s, a) => s + a.base, 0) / advs.length,
    hit: advs.reduce((s, a) => s + a.hit, 0) / advs.length,
    baseHit: advs.reduce((s, a) => s + a.baseHit, 0) / advs.length,
  };
}
console.log('\nTEST Y (PRIMARY) — deviation-conditioned forward yield, trailing-15d reference, item-paired (adv = conditional − item unconditional, % after tax):');
const yRows = [];
for (const c of CLASSES) {
  const ms = members(c); if (ms.length < CLS_MIN_MEMBERS) continue;
  for (let b = 0; b < Y_BUCKETS.length; b++) for (const h2 of Y_H) {
    const cell = yCell(ms, b, h2);
    if (cell) yRows.push({ c, b, h: h2, ...cell });
  }
}
const decideCells = yRows.filter(r => r.c !== 'unclassified' && r.h === Y_DECIDE_H && Y_DECIDE_BUCKETS.includes(r.b) && r.nItems >= Y_MIN_ITEMS);
const yCut = bhCut(decideCells.map(r => r.p));
for (const r of decideCells) r.sig = yCut > 0 && r.p <= yCut;
for (const c of CLASSES) {
  const rows4 = yRows.filter(r => r.c === c && r.h === Y_DECIDE_H);
  if (!rows4.length) continue;
  console.log(`  ${c} (h=4d; base = class-mean per-item unconditional net):`);
  for (const r of rows4) {
    const deepB = Y_DECIDE_BUCKETS.includes(r.b);
    const dec = deepB && r.nItems >= Y_MIN_ITEMS && r.c !== 'unclassified';
    console.log(`    ${Y_LBL[r.b].padEnd(9)} adv ${r.adv >= 0 ? '+' : ''}${r.adv.toFixed(2)}% ±${r.se.toFixed(2)} t=${r.t.toFixed(2).padStart(6)} p=${r.p.toFixed(4)}${r.sig ? ' BH✓' : '    '} cond ${r.cond >= 0 ? '+' : ''}${r.cond.toFixed(2)}% base ${r.base >= 0 ? '+' : ''}${r.base.toFixed(2)}% Phit ${(100 * r.hit).toFixed(0)}% (base ${(100 * r.baseHit).toFixed(0)}%) items ${r.nItems} days ${r.nDays}${dec ? '' : deepB && r.c !== 'unclassified' ? '  (below items floor — non-decision)' : '  (descriptive)'}`);
  }
}
console.log(`  decision cells: ${decideCells.length} (deep buckets × h=4d, named classes, ≥${Y_MIN_ITEMS} items), BH cut ${yCut || '—'}`);

const succeeds = [];
const knives = [];
for (const c of new Set(decideCells.map(r => r.c))) {
  const cells = decideCells.filter(r => r.c === c);
  if (cells.some(r => r.sig && r.adv >= Y_ADV_MIN)) succeeds.push(c);
  if (cells.some(r => r.sig && r.adv < 0)) knives.push(c);
}
// lane-increment check for succeeding classes: does advantage survive OUTSIDE sub-p10 days?
const laneIncrement = {};
for (const c of succeeds) {
  const ms = members(c);
  const sigBuckets = decideCells.filter(r => r.c === c && r.sig && r.adv >= Y_ADV_MIN).map(r => r.b);
  let best = null;
  for (const b of sigBuckets) {
    const cell = yCell(ms, b, Y_DECIDE_H, (u, s) => u.yP10 == null || s.dev >= u.yP10);
    if (cell && (!best || cell.t > best.t)) best = { b, ...cell };
  }
  laneIncrement[c] = best;               // advantage on bucket-days the lane would NOT already catch
}

// ---- TEST A: class baskets ----------------------------------------------------------------------
function classBasket(ms, key) {          // key: 'devs' | 'subDevs'
  const acc = new Map();
  for (const u of ms) for (const x of u[key]) {
    const e = acc.get(x.di) || { s: 0, n: 0, d: x.d }; e.s += x.v; e.n++; e.d = e.d || x.d; acc.set(x.di, e);
  }
  return [...acc].sort((a, b) => a[0] - b[0]).map(([di, e]) => ({ di, d: e.d, v: e.s / e.n }));
}
function meanPairCorr(ms, key) {         // mean pairwise Pearson r over up to 30 members (report only)
  const take = ms.slice(0, 30);
  let s = 0, n = 0;
  for (let i = 0; i < take.length; i++) for (let j = i + 1; j < take.length; j++) {
    const A = new Map(take[i][key].map(x => [x.di, x.v]));
    const pairs = take[j][key].filter(x => A.has(x.di));
    if (pairs.length < 30) continue;
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (const x of pairs) { const a = A.get(x.di), b = x.v; sx += a; sy += b; sxx += a * a; syy += b * b; sxy += a * b; }
    const m = pairs.length, cov = sxy / m - (sx / m) * (sy / m), va = sxx / m - (sx / m) ** 2, vb = syy / m - (sy / m) ** 2;
    if (va > 0 && vb > 0) { s += cov / Math.sqrt(va * vb); n++; }
  }
  return n ? s / n : null;
}
const classRows = [];
for (const c of CLASSES) {
  const ms = members(c);
  if (ms.length < CLS_MIN_MEMBERS) { classRows.push({ c, n: ms.length, skipped: true }); continue; }
  const row = { c, n: ms.length, skipped: false };
  for (const [famKey, key] of [['raw', 'devs'], ['sub', 'subDevs']]) {
    const bd = classBasket(ms, key);
    if (bd.length < MIN_DAYS) { row[famKey] = null; continue; }
    const best = maxR2(bd.map(x => x.di), bd.map(x => x.v));
    const r1 = lag1(bd);
    const { fam, draws } = basketNullDraws(r1, bd.length, `${c}|${famKey}`);
    row[famKey] = {
      p: pOf(draws, best.r2), P: best.P, r2: best.r2, r1, fam,
      p2t: 200 * Math.hypot(best.a, best.b), drift: phaseDrift(bd, best.P),
      wd: best.P >= 6.5 && best.P <= 7.5 ? troughWeekday(bd) : null, len: bd.length,
    };
    row[famKey + 'Devs'] = bd;
  }
  row.pairCorr = meanPairCorr(ms, 'devs');
  classRows.push(row);
}
// BH within family across named (non-unclassified, tested) classes
function bhCut(ps) {
  const s = [...ps].sort((a, b) => a - b);
  let cut = 0;
  for (let i = 0; i < s.length; i++) if (s[i] <= FDR_Q * (i + 1) / s.length) cut = s[i];
  return cut;
}
const namedRows = classRows.filter(r => !r.skipped && r.c !== 'unclassified');
const rawCutC = bhCut(namedRows.filter(r => r.raw).map(r => r.raw.p));
const subCutC = bhCut(namedRows.filter(r => r.sub).map(r => r.sub.p));
for (const r of namedRows) {
  r.rawDisc = !!r.raw && rawCutC > 0 && r.raw.p <= rawCutC;
  r.subDisc = !!r.sub && subCutC > 0 && r.sub.p <= subCutC;
}
// member-null sensitivity (labeled, decides nothing): classes with primary p ≤ 0.10
for (const r of namedRows) {
  for (const famKey of ['raw', 'sub']) {
    const b = r[famKey];
    if (!b || b.p > MEMBER_NULL_PMAX) continue;
    const ms = members(r.c), key = famKey === 'raw' ? 'devs' : 'subDevs';
    let ge = 0;
    for (let k = 0; k < MEMBER_NULL_N; k++) {
      const acc = new Map();
      for (const u of ms) {
        const devs = filteredDevs(phiFor(famKey === 'raw' ? u.raw.r1 : (u.sub?.r1 ?? u.raw.r1)), u[key].length);
        for (const x of devs) { const e = acc.get(x.di) || { s: 0, n: 0 }; e.s += x.v; e.n++; acc.set(x.di, e); }
      }
      const bd = [...acc].sort((a, b2) => a[0] - b2[0]).map(([di, e]) => ({ di, v: e.s / e.n }));
      if (maxR2(bd.map(x => x.di), bd.map(x => x.v)).r2 >= b.r2) ge++;
    }
    b.memberNullP = (1 + ge) / (1 + MEMBER_NULL_N);
  }
}

console.log('\nTEST A — class baskets (persistence-matched null; BH q=0.05 per family across named classes):');
console.log(`  BH cuts: raw ${rawCutC || '—'} sub ${subCutC || '—'}; expected false ≈ 0.05 × discoveries per family`);
for (const r of classRows) {
  if (r.skipped) { console.log(`  ${r.c.padEnd(20)} n=${String(r.n).padStart(4)}  [< ${CLS_MIN_MEMBERS} members — not tested]`); continue; }
  for (const famKey of ['raw', 'sub']) {
    const b = r[famKey]; if (!b) continue;
    const disc = famKey === 'raw' ? r.rawDisc : r.subDisc;
    console.log(`  ${r.c.padEnd(20)} ${famKey.padEnd(3)} n=${String(r.n).padStart(4)} p=${b.p.toFixed(4)}${disc ? ' FDR✓' : '     '} P*${String(b.P).padStart(5)}d p2t ${b.p2t.toFixed(2).padStart(5)}% drift ${b.drift.toFixed(1)}d r1 ${b.r1.toFixed(2)} null=${b.fam}${b.wd != null ? ' trough ' + DAYS_LBL[b.wd] : ''}${b.memberNullP != null ? ` memberNull p=${b.memberNullP.toFixed(3)} (sensitivity, decides nothing)` : ''}${r.c !== 'unclassified' ? '' : '  [unclassified: excluded from branches]'}`);
  }
  if (r.pairCorr != null) console.log(`  ${''.padEnd(20)}     mean member pair-corr ${r.pairCorr.toFixed(3)} (why the member-null is anti-conservative)`);
}

// ---- TEST B: enrichment -------------------------------------------------------------------------
function mannWhitney(xs, ys) {           // two-sided, normal approx with tie correction
  const all = [...xs.map(v => ({ v, g: 0 })), ...ys.map(v => ({ v, g: 1 }))].sort((a, b) => a.v - b.v);
  let i = 0; const N = all.length;
  while (i < N) {
    let j = i; while (j < N - 1 && all[j + 1].v === all[i].v) j++;
    const rank = (i + j + 2) / 2;
    for (let k = i; k <= j; k++) all[k].rank = rank;
    i = j + 1;
  }
  const n1 = xs.length, n2 = ys.length;
  const R1 = all.filter(a => a.g === 0).reduce((s, a) => s + a.rank, 0);
  const U = R1 - n1 * (n1 + 1) / 2;
  let tieSum = 0; i = 0;
  while (i < N) { let j = i; while (j < N - 1 && all[j + 1].v === all[i].v) j++; const t = j - i + 1; tieSum += t * t * t - t; i = j + 1; }
  const mu = n1 * n2 / 2;
  const sig = Math.sqrt(n1 * n2 / 12 * ((N + 1) - tieSum / (N * (N - 1))));
  if (!sig) return { z: 0, p: 1 };
  const z = (U - mu) / sig;
  const Phi = x => 0.5 * (1 + erf(x / Math.SQRT2));
  return { z, p: 2 * Math.min(Phi(z), 1 - Phi(z)) };
}
function erf(x) { const s = x < 0 ? -1 : 1; x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return s * y; }

console.log('\nTEST B — per-item enrichment (Mann–Whitney vs rest; descriptive, fires NO branch; median member r1 beside p — >0.61 = saturation caveat):');
const enrich = [];
for (const r of namedRows) {
  const ms = members(r.c), rest = tested.filter(u => u.cls !== r.c);
  const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[(s.length - 1) >> 1] : null; };
  const e = {
    c: r.c, n: ms.length,
    raw: mannWhitney(ms.map(u => u.raw.p), rest.map(u => u.raw.p)),
    sub: mannWhitney(ms.filter(u => u.sub).map(u => u.sub.p), rest.filter(u => u.sub).map(u => u.sub.p)),
    medP: med(ms.map(u => u.raw.p)), medR1: med(ms.map(u => u.raw.r1)),
  };
  enrich.push(e);
}
const enrichCut = bhCut(enrich.map(e => e.raw.p));
for (const e of enrich.sort((a, b) => a.raw.p - b.raw.p)) {
  const dir = e.raw.z < 0 ? 'toward-cycle' : 'away';         // lower p-ranks in class = negative z
  const dead = e.medP >= 0.5 || (e.raw.z > 0 && e.raw.p < 0.5);
  console.log(`  ${e.c.padEnd(20)} n=${String(e.n).padStart(4)} MW p=${e.raw.p.toFixed(3)}${enrichCut > 0 && e.raw.p <= enrichCut ? ' BH✓' : '    '} z=${e.raw.z.toFixed(2).padStart(6)} (${dir.padEnd(12)}) medianItemP=${e.medP?.toFixed(3)} medianR1=${e.medR1?.toFixed(2)}${Number(e.medR1) > R1_CEILING ? '⚠' : ' '} subMW p=${e.sub.p.toFixed(3)}${dead ? '  DEAD at this resolution' : ''}`);
}

// ---- TEST C: §1 confirmation on the gear class + descriptive per-class weekend stat ------------
const T_CRIT = [[4, 2.132], [5, 2.015], [6, 1.943], [7, 1.895], [8, 1.860], [9, 1.833], [10, 1.812],
  [11, 1.796], [12, 1.782], [13, 1.771], [14, 1.761], [15, 1.753], [17, 1.740], [20, 1.725],
  [25, 1.708], [30, 1.697], [40, 1.684], [60, 1.671]];
const tCrit = df => { let c = 1.671; for (const [d, v] of T_CRIT) if (df <= d) { c = v; break; } return c; };

function s1Detrend(days) {               // §1's EXACT method: 7d centered mean
  const byDi = new Map(days.map(x => [x.di, x]));
  const out = [];
  for (const x of days) {
    let s = 0, n = 0;
    for (let k = -3; k <= 3; k++) { const y = byDi.get(x.di + k); if (y) { s += y.mid; n++; } }
    if (n === 7 && x.mid > 0) out.push({ di: x.di, d: x.d, v: x.mid / (s / 7) - 1 });
  }
  return out;
}
function weekendStat(ms) {               // class-day mean → weekly weekend-minus-Tue gaps → t
  const acc = new Map();
  for (const u of ms) for (const x of s1Detrend(u.days)) {
    const e = acc.get(x.di) || { s: 0, n: 0, d: x.d }; e.s += x.v; e.n++; acc.set(x.di, e);
  }
  const weeks = new Map();               // key = Monday di of the local week
  for (const [di, e] of acc) {
    const wd = new Date(e.d + 'T12:00:00').getDay();
    const monDi = di - ((wd + 6) % 7);
    let w = weeks.get(monDi); if (!w) weeks.set(monDi, w = { we: [], tue: null });
    const v = e.s / e.n;
    if (wd === 6 || wd === 0) w.we.push(v);
    if (wd === 2) w.tue = v;
  }
  const gaps = [];
  for (const w of weeks.values()) if (w.tue != null && w.we.length) gaps.push(w.we.reduce((a, b) => a + b, 0) / w.we.length - w.tue);
  if (gaps.length < 4) return null;
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const sd = Math.sqrt(gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / (gaps.length - 1));
  const t = sd > 0 ? mean / (sd / Math.sqrt(gaps.length)) : 0;
  const pos = gaps.filter(g => g > 0).length;
  return { gapPct: mean * 100, t, W: gaps.length, pos };
}
console.log('\nTEST C — §1 weekend-minus-Tuesday statistic (gear class = the REGISTERED confirmation, one-sided α=0.05; all other rows descriptive):');
const FIVE_NAMES = ['Avernic defender hilt', 'Nightmare staff', 'Armadyl crossbow', 'Venator ring', "Osmumten's fang"];
const fiveMs = tested.filter(u => FIVE_NAMES.includes(u.name));
const fiveStat = weekendStat(fiveMs);
console.log(`  §1 five REPRODUCTION      ${fiveStat ? `gap ${fiveStat.gapPct >= 0 ? '+' : ''}${fiveStat.gapPct.toFixed(3)}%  t=${fiveStat.t.toFixed(2)}  W=${fiveStat.W}  ${fiveStat.pos}/${fiveStat.W} weeks positive  (§1 reported +1.395%, t 4.48, 13/14)` : 'insufficient weeks'}`);
let gearConfirm = null;
for (const c of CLASSES) {
  const ms = members(c); if (ms.length < CLS_MIN_MEMBERS) continue;
  const st = weekendStat(ms); if (!st) continue;
  const isGear = c === 'bigticket-lowlimit';
  const crit = tCrit(st.W - 1);
  const conf = st.t >= crit;
  if (isGear) gearConfirm = { ...st, crit, conf };
  console.log(`  ${c.padEnd(25)} gap ${st.gapPct >= 0 ? '+' : ''}${st.gapPct.toFixed(3)}%  t=${st.t.toFixed(2).padStart(6)}  W=${st.W}  ${st.pos}/${st.W}+  ${isGear ? (conf ? `CONFIRMS (t ≥ ${crit}, one-sided)` : `does NOT confirm (needs t ≥ ${crit})`) : '(descriptive)'}`);
}

// ---- OUTCOME (reframed per the owner amendment — decided by TEST Y alone) ----------------------
const winners = namedRows.filter(r => (r.rawDisc && r.raw.p2t >= BR_I_MIN_P2T) || (r.subDisc && r.sub.p2t >= BR_I_MIN_P2T));
const incrementOk = c => { const li = laneIncrement[c]; return !!li && li.adv >= Y_ADV_MIN && li.nItems >= Y_MIN_ITEMS && tTwoSided(li.t, li.nItems - 1) / 2 <= 0.05 && li.t > 0; };
const succeedsBeyondLane = succeeds.filter(incrementOk);
let outcome;
if (succeedsBeyondLane.length) outcome = `(i) ADVANTAGE BEYOND THE LANE — ${succeedsBeyondLane.join(', ')}: next chunk designs the inform-only "current deviation + measured conditional yield" surface`;
else if (succeeds.length) outcome = `(ii) LANE ALREADY CAPTURES IT — ${succeeds.join(', ')} show advantage only on sub-p10 days; document and close`;
else outcome = '(iii) NO CLASS SHOWS POSITIVE CONDITIONAL ADVANTAGE — the plan closes for good, class question answered';
console.log(`\nPRE-REGISTERED OUTCOME (TEST Y decides): ${outcome}`);
if (knives.length) console.log(`KNIFE classes (deep deviation predicts continued fall — significant NEGATIVE advantage): ${knives.join(', ')}`);
for (const c of succeeds) { const li = laneIncrement[c]; console.log(`  lane-increment check ${c}: beyond-p10 adv ${li ? `${li.adv >= 0 ? '+' : ''}${li.adv.toFixed(2)}% t=${li.t.toFixed(2)} items ${li.nItems} (bucket ${Y_LBL[li.b]})` : 'no computable cell'} → ${incrementOk(c) ? 'beyond the lane' : 'lane-confined'}`); }
console.log(`secondary support (fires nothing): class-basket FDR ${winners.length ? winners.map(r => r.c).join(', ') : 'none'}; §1 gear confirmation ${gearConfirm ? (gearConfirm.conf ? 'CONFIRMS' : 'does not confirm') : 'n/a'}`);

// ── POST-REGISTRATION ENCODED CHECKS (added with the round-1 review fix commit; labeled — they
// decide nothing by themselves, but they GOVERN the honest write-up: W1 the in-sample era-p10
// lane split flatters some classes, so the honest beyond-lane label uses a TRAILING p10 (each
// day classified against the item's PRIOR deviations only, ≥30 required); W2 the deep-dip edge
// is VOLUME-fragile (day-t traded gp ≥ the item's own median); W4 same-day capture is the upper
// bound — a human acting on a surface enters next day (lag-1d entry). ─────────────────────────
const pctl10 = arr => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(0.1 * (s.length - 1))]; };
function checkCell(ms, b, variant) {     // variant: 'trail' | 'vol' | 'lag'
  const advs = [];
  for (const u of ms) {
    if (!u.trailP10ByDi) {
      u.trailP10ByDi = new Map(); const prior = [];
      for (const s of u.ySamples) { if (prior.length >= 30) u.trailP10ByDi.set(s.di, pctl10(prior)); prior.push(s.dev); }
      const gps = u.ySamples.map(s => s.gp).sort((a, b) => a - b);
      u.gpMedian = gps.length ? gps[(gps.length - 1) >> 1] : 0;
      u.midBy = new Map(u.days.map(x => [x.di, x.mid]));
    }
    let all, inB;
    if (variant === 'lag') {
      const lagNet = s => { const m1 = u.midBy.get(s.di + 1), m2 = u.midBy.get(s.di + 1 + Y_DECIDE_H); return m1 != null && m2 != null && m1 > 0 ? (TAX * m2 - m1) / m1 * 100 : null; };
      all = u.ySamples.map(lagNet).filter(v => v != null);
      inB = u.ySamples.filter(s => s.b === b).map(lagNet).filter(v => v != null);
    } else {
      const keep = variant === 'trail'
        ? s => { const p = u.trailP10ByDi.get(s.di); return p != null && s.dev >= p; }
        : s => s.gp >= u.gpMedian;
      all = u.ySamples.filter(s => s.net[Y_DECIDE_H] != null).map(s => s.net[Y_DECIDE_H]);
      inB = u.ySamples.filter(s => s.b === b && s.net[Y_DECIDE_H] != null && keep(s)).map(s => s.net[Y_DECIDE_H]);
    }
    if (inB.length < Y_MIN_DAYS_BUCKET || all.length < 20) continue;
    const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
    advs.push(mean(inB) - mean(all));
  }
  if (advs.length < 2) return null;
  const mean = advs.reduce((s, a) => s + a, 0) / advs.length;
  const sd = Math.sqrt(advs.reduce((s, a) => s + (a - mean) ** 2, 0) / (advs.length - 1));
  const t = sd > 0 ? mean / (sd / Math.sqrt(advs.length)) : 0;
  return { adv: mean, t, n: advs.length };
}
console.log('\nPOST-REGISTRATION checks (labeled; the write-up quotes these, not the flattered variants):');
console.log('  class × deep bucket        trailing-p10 beyond-lane | volume≥median | lag-1d entry');
for (const c of succeeds) {
  const ms = members(c);
  for (const b of Y_DECIDE_BUCKETS) {
    const base = decideCells.find(r => r.c === c && r.b === b);
    if (!base) continue;
    const fmt = x => x ? `${x.adv >= 0 ? '+' : ''}${x.adv.toFixed(2)}pp t=${x.t.toFixed(1)} n=${x.n}` : 'n/a';
    console.log(`  ${c.padEnd(20)} ${Y_LBL[b].padEnd(9)}${base.sig ? ' SIG' : '    '} ${fmt(checkCell(ms, b, 'trail')).padEnd(26)}| ${fmt(checkCell(ms, b, 'vol')).padEnd(22)}| ${fmt(checkCell(ms, b, 'lag'))}`);
  }
}
console.log(`(surrogate bins ${surrCache.size}, total ${((Date.now() - t0) / 1000).toFixed(0)}s)`);

const jsonAt = argAt('--json');
if (jsonAt) {
  fs.writeFileSync(jsonAt, JSON.stringify({
    generatedAt: new Date().toISOString(),
    params: { SEED, SURR_N, FDR_Q, MIN_DAYS, MIN_COVERAGE, MA_W, R1_CEILING, CLS_MIN_MEMBERS, BR_I_MIN_P2T, MEMBER_NULL_N, MEMBER_NULL_PMAX },
    classes: classRows.map(r => ({ c: r.c, n: r.n, skipped: r.skipped, raw: r.raw && { ...r.raw }, sub: r.sub && { ...r.sub }, rawDisc: r.rawDisc, subDisc: r.subDisc, pairCorr: r.pairCorr })),
    yield: { rows: yRows, decideCut: yCut, succeeds, knives, laneIncrement },
    enrich, fiveStat, gearConfirm, outcome,
  }, (k, v) => k.endsWith('Devs') ? undefined : v, 1));
  console.log(`json → ${jsonAt}`);
}
