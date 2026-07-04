#!/usr/bin/env node
/**
 * screen.mjs — opportunity screen. ONE command → a finished, RATED table per niche.
 *
 *   node pipeline/screen.mjs [--mode band|spread|rising|churn|all]
 *     [--floor 50] [--min-roi 1.5] [--min-price 0] [--max-price 45m] [--top 40]
 *     [--band-hours 2] [--min-active 6] [--stats] [--publish]
 *
 *   --publish ALSO writes repo-root screen.json: a self-describing per-niche graded snapshot
 *   { app, generatedAt, mode, params, headers, niches:{band,spread,rising,churn} } that the app's
 *   Scan tab renders. Each row is { id (for the Item→Trends deep link), cells } byte-identical to
 *   the printed table. sync-fills.mjs commits screen.json alongside fills/positions when present.
 *
 * The screen has ONE shared gate stack for every mode; --mode only swaps the step-3 EDGE
 * DEFINITION + ranking. Shared gates: two-sided liquidity (highPriceVolume>0 && lowPriceVolume>0,
 * limiting side ≥ --floor — the ghost-spread lesson), --min-price/--max-price on mid, top-N per-item
 * regime confirm via computeQuote, falling-regime items SILENTLY excluded (CLAUDE.md screen rule).
 *
 * Fetch-pool ordering (the pre-filter rework): the expensive step is the per-item timeseries fetch,
 * so WHICH gated items make the top-N fetch pool matters. loadDaily() builds a BULK multi-day
 * mid-price archive (whole-market /1h @6h spacing, cached on disk) → a regime PROXY (proxyDrift, same
 * 3d-vs-~2wk shape as computeQuote's regimeDrift) that is NEVER displayed and only ORDERS the pool:
 * probable fallers are deprioritized (they'd be discarded post-fetch anyway), and rising mode
 * pre-ranks by the proxy so its budget isn't spent on flats (rising fill went ~25% → ~100%). The real
 * regime + falling-exclusion + rising-confirm still run post-fetch on the real computeQuote. Per-item
 * series are cached (fetchTsCached) so re-running the screen doesn't re-hammer the API. --stats prints
 * a per-niche footer: gated / fetched / survivors / yield / discard reasons.
 *
 * Output (chunk 0 rework): ONE table PER niche (no more Tier A / Tier B split), each sorted by a
 * letter GRADE. The grade is a desirability heuristic — "which of these do I actually put offers in
 * for?" — that blends the realistic expected gp/day with a risk-quality multiplier (regime, momentum,
 * liquidity, capital, band confidence). See rating.mjs for the full rationale; the grade cutoffs +
 * factor weights there are PLACEHOLDERS pending the validation study. `Score gp/d` = the risk-adjusted
 * gp/day the grade is read off. `--mode all` runs all four niches and shares one per-item fetch cache
 * (items common to several niches are fetched once). A grade-distribution footer per table lets us
 * SEE whether the score separates best-from-good (if a batch clumps at one grade, the factors — not
 * the letter scale — need work).
 *
 * Modes (step-3 edge):
 *   band  (DEFAULT) — the crystal-teleport-seed niche: a liquid, regime-stable item with a wide
 *                     INTRADAY band. Edge = after-tax net of bandLo→bandHi from loadBands
 *                     (--band-hours, default 2); gate bandRoi ≥ --min-roi AND the band must be
 *                     TRADED (≥ --min-active two-sided 5m windows, not one spike).
 *   spread          — the ORIGINAL screen: after-tax ROI of the 24h-average spread (bludgeon-style).
 *   rising          — rising regime + mom ≠ breakdown, entry priced at the band low. Frothy.
 *   churn           — buy-limit-cycle commodities: volDay ≥ 2000 && limit > 0, tiny ROI accepted
 *                     (no --min-roi gate), the high-frequency small-margin niche.
 *   all             — run band, spread, rising, churn in sequence (shared fetch cache).
 *
 *   --mode dip is DESIGNED-NOT-BUILT (flat regime + mom↓ wick-bids). Out of scope here on purpose.
 *
 * Ranking: the fetch pool is still picked by realistic expected gp/day (expUnits/day = min(limit×6,
 * 10% × volDay); expGpDay = expUnits × the mode's net/u). The DISPLAYED table is then sorted by the
 * risk-adjusted grade/score from rating.mjs.
 *
 * ALL quote/tax/regime math is js/quotecore.js (imported); rating math is rating.mjs. This file only
 * fetches + gates + rates + renders.
 */
import { computeQuote, QUOTE_HEADERS, isOvernightNow, overnightStaleRisk } from '../js/quotecore.js';
import { tax, fmtP } from '../js/format.js';
import { loadMapping, loadGuide, loadAll24h, loadAllLatest, loadBands, loadDaily, fetchTsCached, pruneCache, sleep } from './marketfetch.mjs';
import { parseArgs, parseGp, mdTable, stdCells } from './cli.mjs';
import { rateItem, GRADE_CUTOFFS } from './rating.mjs';
import { logSuggestions, suggestionEntry, liqClass } from './suggestlog.mjs';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// --- args ---
const A = parseArgs(process.argv.slice(2));
const MODES = ['band', 'spread', 'rising', 'churn'];
const MODE = A.mode != null && A.mode !== true ? String(A.mode).toLowerCase() : 'band';
if (MODE !== 'all' && !MODES.includes(MODE)) { console.error(`! unknown --mode "${A.mode}". Use one of: ${MODES.join(', ')}, all (or omit for band).`); process.exit(1); }
const FLOOR = A.floor != null ? +A.floor : 50;
const MIN_ROI = A['min-roi'] != null ? +A['min-roi'] : 1.5;
const MIN_PRICE = A['min-price'] != null ? parseGp(A['min-price']) : 0;
const MAX_PRICE = A['max-price'] != null ? parseGp(A['max-price']) : 45e6;
const TOP = A.top != null ? +A.top : 40;
const BAND_HOURS = A['band-hours'] != null ? +A['band-hours'] : 2;
const MIN_ACTIVE = A['min-active'] != null ? +A['min-active'] : 6;
const STATS = !!A.stats;
// --- S1 screening economics (gp-flow gate + 500k attention floor) ------------------------------
// GP_FLOOR: the alternative liquidity path. The two-sided gate (hpv>0 && lpv>0 — the ghost-spread
// lesson) is NON-NEGOTIABLE and untouched; but the UNIT floor (--floor 50/d) was the wrong UNIVERSAL
// measure — it hides an Avernic-class big ticket (single-digit units/day yet hundreds of millions of
// gp of real two-sided daily flow, a genuine ~six-figure-net/u edge). An item clears liquidity on
// EITHER limitVol ≥ FLOOR OR limitVol×mid ≥ GP_FLOOR. 250m is picked to admit that profile with margin.
const GP_FLOOR = A['gp-floor'] != null ? parseGp(A['gp-floor']) : 250_000_000;
// MIN_NET_GP: the absolute-gp ROI alternative for thin items — a thin big ticket rarely clears the
// percentage --min-roi bar (its spread is a small % of a huge price) but a six-figure net/u is still
// worth one offer, so a thin item passes on modeRoi ≥ MIN_ROI OR modeNet ≥ MIN_NET_GP.
const MIN_NET_GP = A['min-net-gp'] != null ? parseGp(A['min-net-gp']) : 100_000;
// MIN_ACTIVE_THIN: the traded-window count a thin item's band must show. 6/2h is impossible at ~12/d
// (≈1 traded window/2h), so gp-flow qualifiers get a relaxed floor of 1 window (still must have traded,
// not a pure phantom band). Non-thin items keep the full --min-active gate.
const MIN_ACTIVE_THIN = 1;
// MIN_GPD: the 500k/day ATTENTION floor (was a /scan post-filter; now the structural --min-gpd flag,
// applied PRE-RATING so grades never advertise sub-floor rows). Realistic expGpDay basis. THIN gp-flow
// qualifiers are EXEMPT — the floor exists to drop sub-attention LIQUID churn, and a thin item is
// surfaced precisely because a unit-count/gp-day measure mismeasures it (a 360k-net/u big ticket is
// worth an offer even at a couple units a day). Held/asked items are exempt too (they don't occur in a
// screen; the S3 watchlist pass bypasses gates entirely).
const MIN_GPD = A['min-gpd'] != null ? parseGp(A['min-gpd']) : 500_000;
// THIN_RESERVE: fetch-pool slots guaranteed to the best thin gp-flow qualifiers. They carry a tiny
// expGpDay (a couple units/day) so the velocity-weighted pool rank buries them below the top-N and
// they'd never get fetched/rated — yet surfacing a big-ticket six-figure-net/u edge is the whole point
// of the gp-flow path. Reserve up to this many (ranked by gp-flow = limitVol×mid) into every niche's pool.
const THIN_RESERVE = A['thin-reserve'] != null ? +A['thin-reserve'] : 6;
// --- S2 posture: overnight vs active. Posture TUNES the shared stack, it is not a new niche.
//   active   (default) — current behavior.
//   overnight          — only flat/rising regimes with a confident (reliable) band, no thin fast-lane,
//                        no breakdown momentum; ranked by NET EDGE (net/u) over velocity; excludes items
//                        whose yesterday-overnight window printed materially below the current optimistic
//                        bid (overnightStaleRisk — the "stale/underwater by morning" test).
//   auto               — pick by the LOCAL clock (isOvernightNow, ~22:00–06:00).
// Honest limit: one prior night is one sample — posture PICKS which existing edges to prefer; real
// overnight fill-time curves are O1/F1's job, not this filter.
const POSTURE_ARG = A.posture != null && A.posture !== true ? String(A.posture).toLowerCase() : 'active';
if (!['overnight', 'active', 'auto'].includes(POSTURE_ARG)) { console.error(`! unknown --posture "${A.posture}". Use overnight, active, or auto.`); process.exit(1); }
const POSTURE = POSTURE_ARG === 'auto' ? (isOvernightNow() ? 'overnight' : 'active') : POSTURE_ARG;
// --publish: also write repo-root screen.json so the app's Scan tab renders the SAME per-niche
// graded scan a Claude session produces (byte-parity via the shared stdCells / rating path). The
// file is self-describing (its own `headers` travel with the rows) and each row keeps its itemId
// for the Item→Trends deep link. sync-fills.mjs commits it alongside fills/positions when present.
const PUBLISH = A.publish === true;
// snapshot of the run params logged with each suggestion (O1) — mirrors the --publish payload's params
const SCREEN_PARAMS = { floor: FLOOR, gpFloor: GP_FLOOR, minRoi: MIN_ROI, minNetGp: MIN_NET_GP, minGpd: MIN_GPD, minPrice: MIN_PRICE, maxPrice: MAX_PRICE, top: TOP, bandHours: BAND_HOURS, minActive: MIN_ACTIVE, posture: POSTURE };

const RUN_MODES = MODE === 'all' ? MODES : [MODE];
const NEED_BANDS = RUN_MODES.some(m => m !== 'spread');
const N_WIN = Math.max(1, Math.ceil(BAND_HOURS * 3600 / 300));   // 5m windows in the band (confidence denom)
const DAILY_DAYS = 17, DAILY_STEP_H = 6;                         // regime-proxy archive lookback / spacing
const DAILY_COLD = 10 * 24 / DAILY_STEP_H;                       // < this many windows ⇒ cold archive, degraded proxy
const TS_TTL_5M = 3 * 60 * 1000, TS_TTL_6H = 30 * 60 * 1000;     // per-item series cache TTLs (screen re-fetch avoidance)

// realistic expected units/day: buy-limit refreshes ~every 4h → 6 limits/day, capped at a 10% share
// of the limiting-side daily volume. Null limit → volume share only.
const expUnits = (limit, volDay) => { const vShare = 0.10 * (volDay || 0); return limit != null ? Math.min(limit * 6, vShare) : vShare; };

// --- regime proxy off loadDaily's bulk {ts,mid} series: SAME 3d-vs-prior-~2wk shape as quotecore's
// regimeDrift, but computed from the whole-market archive and NEVER displayed — it only ORDERS the
// fetch pool so we spend the expensive per-item fetches on likely survivors. The real regime (and the
// falling-exclusion + rising-confirm) is still the post-fetch computeQuote. ---
const median = a => { if (!a || !a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function proxyDrift(points) {
  if (!points || points.length < 2) return null;
  const tEnd = points[points.length - 1].ts;
  const recentCut = tEnd - 3 * 86400, priorCut = tEnd - 17 * 86400;
  const recent = [], prior = [];
  for (const p of points) { if (p.mid == null) continue; if (p.ts >= recentCut) recent.push(p.mid); else if (p.ts >= priorCut) prior.push(p.mid); }
  if (recent.length < 4 || prior.length < 6) return null;       // too little archive → unknown (fall back to raw rank)
  const rm = median(recent), pm = median(prior);
  if (!rm || !pm) return null;
  return (rm - pm) / pm * 100;
}
// PLACEHOLDER fetch-pool ordering weight — deprioritize probable fallers (they'd be discarded
// post-fetch anyway). Chunk-C study sets these numbers; null (unknown regime) = mild trust.
const softFactor = drift => drift == null ? 0.7 : drift <= -8 ? 0.1 : drift <= -5 ? 0.5 : 1;

// --- gate stack + mode-specific step-3 edge, ranked by realistic gp/day (picks the fetch pool) ---
function gateCandidates(mode, { v24, map, bands }) {
  const cand = [];
  for (const idStr in v24) {
    const id = +idStr; const d = v24[idStr]; if (!d) continue;
    const hpv = d.highPriceVolume || 0, lpv = d.lowPriceVolume || 0;
    if (hpv <= 0 || lpv <= 0) continue;                 // two-sided liquidity gate (shared, NON-NEGOTIABLE)
    const limitVol = Math.min(hpv, lpv);
    const avgHigh = d.avgHighPrice, avgLow = d.avgLowPrice;
    if (!avgHigh || !avgLow) continue;
    const mid = (avgHigh + avgLow) / 2;
    if (mid < MIN_PRICE || mid > MAX_PRICE) continue;   // price window (shared)
    // liquidity: raw UNIT floor OR the gp-flow floor (thin big-ticket path). `thin` = qualified via
    // gp-flow only (below the unit floor) → honestly marked downstream (grade cap + tooltip).
    const thin = limitVol < FLOOR;
    if (thin && limitVol * mid < GP_FLOOR) continue;    // fails BOTH the unit floor and the gp-flow floor
    const limit = map.byId[id]?.limit ?? null;

    // --- step 3: mode swaps ONLY the edge definition + gate here ---
    let modeNet, modeRoi, activeWin = null;
    if (mode === 'spread') {
      modeNet = (avgHigh - tax(avgHigh)) - avgLow;      // 24h-avg spread, after tax
      modeRoi = modeNet / avgLow * 100;
      if (modeRoi < MIN_ROI && !(thin && modeNet >= MIN_NET_GP)) continue;   // %-ROI OR (thin & abs-gp)
    } else {
      // band / rising / churn all price the edge off the traded intraday band
      const b = bands[id]; if (!b || b.bandLo == null || b.bandHi == null) continue;
      const minActive = thin ? MIN_ACTIVE_THIN : MIN_ACTIVE;   // 6/2h is impossible at ~12/d — relax for thin
      if (b.active5m < minActive) continue;             // band must be TRADED, not one spike
      activeWin = b.active5m;
      modeNet = (b.bandHi - tax(b.bandHi)) - b.bandLo;  // band low → band top, after tax
      modeRoi = modeNet / b.bandLo * 100;
      if (mode === 'churn') {
        if (!(limitVol >= 2000 && limit != null && limit > 0)) continue;  // buy-limit-cycle commodity
        // tiny ROI accepted for churn — no --min-roi gate; volume does the work
      } else {
        if (modeRoi < MIN_ROI && !(thin && modeNet >= MIN_NET_GP)) continue;   // %-ROI OR (thin & abs-gp)
      }
    }
    if (modeNet <= 0) continue;
    const expGpDay = Math.round(expUnits(limit, limitVol) * modeNet);
    // 500k/day attention floor — pre-rating, so no grade ever advertises a sub-floor row. Thin gp-flow
    // qualifiers are EXEMPT (a unit/gp-day count mismeasures them — see MIN_GPD note).
    if (!thin && expGpDay < MIN_GPD) continue;
    cand.push({ id, limitVol, mid, limit, expGpDay, activeWin, thin });
  }
  return cand;
}

// Rank the gated pool and take the top-N to fetch. The proxy (from the bulk daily archive) orders
// WHICH items we spend the expensive per-item fetch on — deprioritizing probable fallers, and for
// rising mode pushing likely-rising items to the front so its fetch budget isn't wasted on flats.
function rankAndSlice(mode, cand, dailySeries) {
  for (const c of cand) c.proxyDrift = proxyDrift(dailySeries[c.id]);
  // Thin gp-flow qualifiers are held OUT of the main ranking and given a bounded RESERVE instead.
  // Two reasons: (1) their intraday band is priced off a thinly-traded 2h window, so bandNet is noisy
  // and often inflated (the band-top-artifact lesson) → a raw-expGpDay rank lets them CROWD OUT genuine
  // liquid flips; (2) the design intent is "surface the big ticket honestly, don't let it take over".
  // So the main pool is non-thin only; thin items get up to THIN_RESERVE slots, ranked by real gp-flow
  // (limitVol×mid, not the noisy bandNet). Net effect: the non-thin survivor set is materially unchanged
  // (gp-flow ADDS ≤ THIN_RESERVE rows/niche, doesn't reshuffle).
  const nonThin = cand.filter(c => !c.thin);
  if (mode === 'rising') {
    // fetch rising-likely items first: proxy drift desc (unknowns last), expGpDay as tiebreak
    nonThin.sort((a, b) => ((b.proxyDrift ?? -1e12) - (a.proxyDrift ?? -1e12)) || (b.expGpDay - a.expGpDay));
  } else {
    nonThin.sort((a, b) => (b.expGpDay * softFactor(b.proxyDrift)) - (a.expGpDay * softFactor(a.proxyDrift)));
  }
  const reserved = cand.filter(c => c.thin).sort((a, b) => (b.limitVol * b.mid) - (a.limitVol * a.mid)).slice(0, THIN_RESERVE);
  return [...reserved, ...nonThin].slice(0, TOP);
}

const PLAYBOOK = {
  band:   'Playbook: ladder BUYS at the band low, SELL at the band top; never list below break-even (ceil(buy/0.98)).',
  spread: 'Playbook: mid-liquidity wide-spread flips (bludgeon-style). Buy the 24h avg low, sell the avg high.',
  rising: 'Playbook: rising + not-breaking-down; enter at the band low. FROTHY — size small, these are mid-reprice moves.',
  churn:  'Playbook: high-frequency buy-limit-cycle commodities. Thin per-unit, volume does the work — buy every limit, flip fast.',
};
const HEADERS = ['Item', 'Grade', ...QUOTE_HEADERS.slice(1), 'Score gp/d'];

// grade-distribution footer, in GRADE_CUTOFFS (best→worst) order, present grades only
function gradeDist(dist) {
  const parts = GRADE_CUTOFFS.map(([g]) => g).filter(g => dist[g]).map(g => `${g}×${dist[g]}`);
  return parts.length ? parts.join('  ') : '—';
}

// render one niche: filter the fetched pool, rate, sort by grade/score, print table + footer
function renderMode(mode, { cand, survivors }, qcache, map, series5m) {
  const rows = [];
  const dist = {};
  const disc = { falling: 0, notRising: 0, breakdown: 0, posture: 0 };  // post-fetch discard reasons (--stats)
  for (const s of survivors) {
    const row = qcache.get(s.id);
    if (!row) continue;
    if (row.falling) { disc.falling++; continue; }           // screen rule: never surface fallers
    if (mode === 'rising') {                                  // rising-mode confirm
      if (!row.rising) { disc.notRising++; continue; }
      if (row.mom === 'breakdown') { disc.breakdown++; continue; }
    }
    if (POSTURE === 'overnight') {
      // overnight posture: only a confident, patient, non-thin edge that won't be stale by morning.
      if (s.thin) { disc.posture++; continue; }                                      // no thin fast-lane
      if (!(row.regimeLabel === 'flat' || row.rising)) { disc.posture++; continue; } // confident flat/rising only (drops unknown)
      if (!row.reliable) { disc.posture++; continue; }                              // needs a trustworthy band
      if (row.mom === 'breakdown') { disc.posture++; continue; }                    // no active pullback overnight
      if (overnightStaleRisk(series5m && series5m.get(s.id), row.optBuy)) { disc.posture++; continue; }  // stale/underwater by morning
    }
    const name = map.byId[s.id]?.name || ('#' + s.id);
    const r = rateItem({ row, expGpDay: s.expGpDay, activeWin: s.activeWin, nWin: s.activeWin != null ? N_WIN : null, thin: s.thin });
    const std = stdCells(name, row);                        // structured cells: [item, guide, quick, optimistic, vol, momentum, regime]
    // insert Grade after Item, append Score gp/d — both structured {t} so the app publish path is
    // uniform (Grade rendered as a pill app-side by header name; Score right-aligned num). A thin
    // (gp-flow-only) row carries a `title` on the Grade cell — the honesty tooltip (rendered app-side;
    // cellText ignores it so stdout stays clean). `row`/`grade` kept on the pushed object — the O1
    // suggestions ledger reads them below.
    const gradeCell = s.thin
      ? { t: r.grade, title: `thin: ~${s.limitVol}/day two-sided — size in units, expect slow fills` }
      : { t: r.grade };
    const cells = [std[0], gradeCell, ...std.slice(1), { t: fmtP(r.score), c: 'num' }];
    rows.push({ id: s.id, row, grade: r.grade, cells, score: r.score });
    dist[r.grade] = (dist[r.grade] || 0) + 1;
  }
  // sort: active weights the risk-adjusted score (velocity-inclusive); overnight weights NET EDGE per
  // unit (patient band-edge net/u) over velocity — you want the fattest unattended margin, not churn.
  if (POSTURE === 'overnight') rows.sort((a, b) => (b.row.optNet || 0) - (a.row.optNet || 0) || b.score - a.score);
  else rows.sort((a, b) => b.score - a.score);

  // O1 suggestions ledger: log every rated (surfaced) row at emit time, unconditionally. The niche
  // is `mode`; the emitted "verdict" is the letter grade the row was surfaced under.
  logSuggestions('screen', { mode, params: SCREEN_PARAMS },
    rows.map(r => suggestionEntry(r.row, { itemId: r.id, cls: liqClass(r.row), verdict: r.grade })));

  console.log(`## ${mode.toUpperCase()} — ${rows.length} rated (from ${cand.length} gated, top ${survivors.length} fetched; fallers excluded)`);
  console.log(PLAYBOOK[mode]);
  console.log(mode !== 'spread' ? `(band basis: ${BAND_HOURS}h, ≥${MIN_ACTIVE} traded 5m windows)` : '(basis: 24h-average spread)');
  console.log(rows.length ? mdTable(HEADERS, rows.map(r => r.cells)) : '_none_');
  console.log(`Grades: ${gradeDist(dist)}`);
  if (STATS) {
    const fetched = survivors.length, kept = rows.length;
    const reasons = `falling ${disc.falling}` + (mode === 'rising' ? `, not-rising ${disc.notRising}, breakdown ${disc.breakdown}` : '') + (POSTURE === 'overnight' ? `, posture ${disc.posture}` : '');
    console.log(`stats: gated ${cand.length} | fetched ${fetched} | survivors ${kept} | yield ${fetched ? Math.round(kept / fetched * 100) : 0}% | discarded: ${reasons}`);
  }
  console.log('');
  // publishable rows (sorted-by-grade, byte-identical cells + itemId for the app's deep link)
  return rows.map(r => ({ id: r.id, cells: r.cells }));
}

async function main() {
  pruneCache('ts', 24 * 3600 * 1000);                     // bound the per-item series cache
  const map = await loadMapping();
  const [v24, latest, guide] = [await loadAll24h(), await loadAllLatest(), await loadGuide()];
  const bands = NEED_BANDS ? await loadBands(BAND_HOURS) : null;
  const { series: daily, coverageWindows } = await loadDaily(DAILY_DAYS, DAILY_STEP_H);  // bulk regime-proxy archive
  const ctx = { v24, map, bands };

  // gate every mode, then proxy-rank its gated pool and take the top-N fetch pool
  const gated = {};
  for (const m of RUN_MODES) {
    const cand = gateCandidates(m, ctx);
    gated[m] = { cand, survivors: rankAndSlice(m, cand, daily) };
  }

  // fetch each unique survivor's series ONCE (shared across modes in --mode all; cached on disk), quote it
  const ids = new Set();
  for (const m of RUN_MODES) for (const s of gated[m].survivors) ids.add(s.id);
  const qcache = new Map(), series5m = new Map();
  for (const id of ids) {
    const ts5m = await fetchTsCached(id, '5m', TS_TTL_5M); await sleep(30);
    const ts6h = await fetchTsCached(id, '6h', TS_TTL_6H); await sleep(30);
    const lt = latest[id] || latest[String(id)] || null;
    const limit = map.byId[id]?.limit ?? null;
    qcache.set(id, computeQuote({ latest: lt, ts5m, ts6h, vol24: v24[id], guide: guide[id] ?? null, limit }));
    series5m.set(id, ts5m);   // kept raw for the overnight-posture staleness read (overnightStaleRisk)
  }

  console.log(`# Opportunity screen — mode ${MODE.toUpperCase()}, posture ${POSTURE.toUpperCase()}, liquidity ${FLOOR}/d OR ${(GP_FLOOR/1e6).toLocaleString()}m gp-flow, min ROI ${MIN_ROI}% (thin: ${(MIN_NET_GP/1e3).toLocaleString()}k net/u), attention floor ${(MIN_GPD/1e3).toLocaleString()}k gp/d, ${MIN_PRICE.toLocaleString()}–${MAX_PRICE.toLocaleString()} gp, top ${TOP} fetched/niche`);
  console.log(`(${ids.size} unique items fetched; grade cutoffs are PLACEHOLDERS pending the validation study)`);
  if (coverageWindows < DAILY_COLD) console.log(`(⚠ regime-proxy archive is COLD — only ${coverageWindows}/${Math.round(DAILY_DAYS * 24 / DAILY_STEP_H)} windows; fetch-pool ordering is degraded until it warms up)`);
  console.log('');
  const niches = {};
  for (const m of RUN_MODES) niches[m] = renderMode(m, gated[m], qcache, map, series5m);

  // --publish: self-describing per-niche snapshot for the app's Scan tab. `headers` travels WITH the
  // rows so a stale published file can never mismatch app-side header code; cells are byte-identical
  // to the tables above (same stdCells / rating path) so the app renders exactly what the scan said.
  if (PUBLISH) {
    const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'screen.json');
    const payload = {
      app: 'the-coffer-screen',
      schema: 2,                       // 2 = T1 structured cells ({t,c}); 1 = legacy plain-string cells (app reads both)
      generatedAt: new Date().toISOString(),
      mode: MODE,
      posture: POSTURE,                // S2: the Scan banner reads this to say which posture it shows
      params: { floor: FLOOR, gpFloor: GP_FLOOR, minRoi: MIN_ROI, minNetGp: MIN_NET_GP, minGpd: MIN_GPD, minPrice: MIN_PRICE, maxPrice: MAX_PRICE, top: TOP, bandHours: BAND_HOURS, minActive: MIN_ACTIVE, posture: POSTURE },
      headers: HEADERS,
      niches,
    };
    writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');
    console.log(`(published → screen.json: ${RUN_MODES.map(m => `${m} ${niches[m].length}`).join(', ')})`);
  }
}

await main();
