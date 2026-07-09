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
 * mid-price archive (whole-market /1h @6h spacing, backed by the D0 Tier-1 SQLite archive) → a regime PROXY (proxyDrift, same
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
 *   rising          — rising regime + mom ≠ breakdown, entry priced at the band low. Frothy. Its
 *                     candidate pool carries a NY2.1 noise floor (risingPoolFloor): a rising
 *                     candidate must be a big ticket (mid ≥ RISE_MID_FLOOR) OR liquid enough to
 *                     move (limitVol ≥ RISE_LIQUID_VOL), which keeps the big-ticket momentum names
 *                     AND the cheap-but-liquid risers (Dragon arrowtips / Cake) while dropping the
 *                     cheap thin/mid teleport-tab D-flood that used to burn the fetch budget.
 *   churn           — buy-limit-cycle commodities: volDay ≥ 2000 && limit > 0, tiny ROI accepted
 *                     (no --min-roi gate), the high-frequency small-margin niche. NY2.2: DEMOTED to
 *                     off-by-default — run `--mode churn` explicitly; `--mode all` no longer includes it.
 *   all             — run band, spread, rising in sequence (shared fetch cache). Churn excluded (NY2.2).
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
import { computeQuote, QUOTE_HEADERS, isOvernightNow, phase } from '../js/quotecore.js';
import { tax, fmtP } from '../js/format.js';
import { loadMapping, loadGuide, loadAll24h, loadAllLatest, loadBands, loadDaily, fetchTsCached, pruneCache, sleep } from './lib/marketfetch.mjs';
import { parseArgs, parseGp, mdTable, stdCells } from './lib/cli.mjs';
// P1: the pure candidate-selection + survival doctrine moved to lib/gatecandidates.mjs (was inline
// here: gateCandidates/risingPoolFloor/expUnits/proxyDrift/softFactor/rankAndSlice + the extracted
// renderMode post-fetch doctrine surviveMode). Logic byte-identical; screen.mjs passes its CLI
// THRESHOLDS / sizing explicitly. Fixtures drive them in gatecandidates.test.mjs + survivemode.test.mjs.
import { gateCandidates, rankAndSlice, surviveMode, expUnits, VALUE_TOP_DEFAULT } from './lib/gatecandidates.mjs';
import { valueRanges, valueScore, valueGate, valueTier } from '../js/valuescreen.mjs';   // P5 — value niche gate/rank/tier
// P4c: the four niches are DECLARATIVE strategy specs now. screen.mjs derives its mode-name lists from
// the registry (the names live in ONE place — strategies.mjs) and reads each spec's inferred default
// entry path for the suggestions ledger + the per-row path annotation.
import { STRATEGIES, MODE_KEYS, ALL_MODE_KEYS } from '../js/strategies.mjs';
import { enumeratePaths, weighPaths } from '../js/paths.mjs';   // P4c: weighed entry-path menu per surfaced row (display-only)
import { rateItem, GRADE_CUTOFFS, capGrade } from './lib/rating.mjs';
import { logSuggestions, suggestionEntry, liqClass } from './lib/suggestlog.mjs';
import { runValidators, flags, leanValidators, worstStatus } from '../js/validate.mjs';   // P2 — validator registry: DROP reject, FLAG caution
import { termStructure } from '../js/termstructure.mjs';   // P3 — term structure / durable floor for floorValidator (fed the loadDaily proxy series)
import { stateTransition } from './lib/statetransition.mjs';   // YP2 (#2) — watch-closely transition scan
import { buildVelocityIndex, velocityTag } from './lib/velocitytag.mjs';   // Build 2 — per-item velocity footnote from outcomes.json
import { loadModules, runProbes, logFirings } from './lib/modules.mjs';   // PM1 — probe-module system (dip/froth/anchor/decant); PM2 — firing log
import { writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// --- args ---
const A = parseArgs(process.argv.slice(2));
const MODES = MODE_KEYS;         // P4c: valid explicit --mode values, from the strategy registry (band/spread/rising/churn)
const ALL_MODES = ALL_MODE_KEYS; // P4c: --mode all runs the inAll specs — NY2.2 keeps churn DEMOTED off-by-default
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
// --- NY2.1: rising-pool NOISE FLOOR (rising niche only — does NOT touch the shared stack) --------
// NY1 found the rising niche's blind fetch pool flooded with cheap teleport-tab/consumable
// candidates (a trending evening surfaced 33 D-grade froth rows, zero worth an offer, all sub-~100k
// mid) that burned the expensive per-item fetch budget. This is a rising-POOL pre-fetch floor; the
// other niches and the shared gates are untouched.
//
// MEASURE CHOSEN — keep a rising candidate iff it is a BIG TICKET (mid ≥ RISE_MID_FLOOR) OR LIQUID
// enough to move (limitVol ≥ RISE_LIQUID_VOL). Rationale (why not a naive price floor): the named
// keepers span BOTH classes and a price-only floor would kill the cheap ones —
//   • big-ticket momentum names (Armadyl crossbow ~42.6m, Twisted buckler ~22.9m, Webweaver bow
//     ~18.9m, Abyssal bludgeon ~17.4m, Basilisk jaw ~17.1m, Toxic blowpipe ~10.6m) all clear the
//     mid floor;
//   • cheap-but-liquid risers (Dragon arrowtips ~4.9k, Cake ~617 — both graded S WHILE liquid)
//     would be wrongly dropped by a price floor but sail through the liquid-volume arm.
// The teleport-tab D-flood is cheap AND thin/mid (below BOTH arms) → it drops. RISE_LIQUID_VOL=1000
// matches suggestlog's liqClass 'liquid' cutoff (one vocabulary; volDay == limitVol == min(hpv,lpv)).
// HONESTY: one evening of data (NY1); rising was re-judged on a trending day — re-check on a flat one.
// (The pure `risingPoolFloor` predicate moved to lib/gatecandidates.mjs with the gate stack, P1.)
const RISE_MID_FLOOR = A['rise-mid-floor'] != null ? parseGp(A['rise-mid-floor']) : 1_000_000;
const RISE_LIQUID_VOL = A['rise-liquid-vol'] != null ? +A['rise-liquid-vol'] : 1000;
// GC1: the CLI-derived thresholds gateCandidates consumes, grouped into ONE object so the gate stack
// takes them as an argument (fixtures can drive it) instead of closing over module-level CLI state.
// main() passes THRESHOLDS; nothing about the values or ordering changed — this is a pure refactor.
const THRESHOLDS = {
  FLOOR, MIN_ROI, MIN_PRICE, MAX_PRICE, MIN_NET_GP, MIN_ACTIVE, MIN_ACTIVE_THIN, MIN_GPD, GP_FLOOR,
  RISE_MID_FLOOR, RISE_LIQUID_VOL,
};
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
// --- Part B (opt-in): basing-rescue. OFF by default → default output is byte-identical (the only
// default change is Part A's display annotation, which only APPENDS phase text to an existing Regime
// cell — it never changes which rows are selected/excluded). When ON, an item the falling-exclusion
// would normally DROP but whose phase()==='basing' (decayed off a spike, lows flattened) is instead
// SURFACED, capped to PHASE_BASING_GRADE_CAP and flagged provisional. Conservative, gated trial —
// thresholds are unvalidated placeholders. capGrade is reused from rating.mjs (no rating.mjs change).
const PHASE_RESCUE = A['phase-rescue'] === true;
const PHASE_BASING_GRADE_CAP = 'B';   // named ceiling for a provisional basing-rescue surface
// snapshot of the run params logged with each suggestion (O1) — mirrors the --publish payload's params
const SCREEN_PARAMS = { floor: FLOOR, gpFloor: GP_FLOOR, minRoi: MIN_ROI, minNetGp: MIN_NET_GP, minGpd: MIN_GPD, minPrice: MIN_PRICE, maxPrice: MAX_PRICE, top: TOP, bandHours: BAND_HOURS, minActive: MIN_ACTIVE, posture: POSTURE };

const RUN_MODES = MODE === 'all' ? ALL_MODES : [MODE];   // NY2.2: churn omitted from `all`; P5: scalp/value explicit-only
const NEED_BANDS = RUN_MODES.some(m => m !== 'spread');
const IS_VALUE = RUN_MODES.includes('value');                    // P5 — the value niche needs the 28d term structure
const N_WIN = Math.max(1, Math.ceil(BAND_HOURS * 3600 / 300));   // 5m windows in the band (confidence denom)
// regime-proxy archive lookback / spacing. P5: value's term structure needs ~28d (§C); extend ONLY when
// value is requested so every other mode (incl. --mode all) keeps the 17d archive byte-identical.
const DAILY_DAYS = IS_VALUE ? 28 : 17, DAILY_STEP_H = 6;
const DAILY_COLD = 10 * 24 / DAILY_STEP_H;                       // < this many windows ⇒ cold archive, degraded proxy
const TS_TTL_5M = 3 * 60 * 1000, TS_TTL_6H = 30 * 60 * 1000;     // per-item series cache TTLs (screen re-fetch avoidance)

// P1: the gate stack (`gateCandidates`), the fetch-pool ranker (`rankAndSlice` + `proxyDrift` +
// `softFactor`), the `risingPoolFloor` predicate, and `expUnits` all live in lib/gatecandidates.mjs
// now (imported above). main() passes screen's CLI THRESHOLDS to gateCandidates and { thinReserve,
// top } to rankAndSlice explicitly (the lib defaults to the same values via DEFAULT_THRESHOLDS /
// THIN_RESERVE_DEFAULT / TOP_DEFAULT). expUnits is reused below by roughExpGpDay (the watchlist path).

const PLAYBOOK = {
  band:   'Playbook: ladder BUYS at the band low, SELL at the band top; never list below break-even (tax-capped; shared breakEven).',
  spread: 'Playbook: mid-liquidity wide-spread flips (bludgeon-style). Buy the 24h avg low, sell the avg high.',
  rising: 'Playbook: rising + not-breaking-down; enter at the band low. FROTHY — size small, these are mid-reprice moves.',
  churn:  'Playbook: high-frequency buy-limit-cycle commodities. Thin per-unit, volume does the work — buy every limit, flip fast.',
  scalp:  'Playbook (PROVISIONAL, n≈0): a DELIBERATE intraday flip on a falling market — buy a wide FRESH band edge, sell at today\'s high, HARD intraday stop. Flip-only/no-hold: an unsold lap is a CUT, not a hold. Falling is the thesis, not a veto.',
};
const HEADERS = ['Item', 'Grade', ...QUOTE_HEADERS.slice(1), 'Score gp/d'];

// grade-distribution footer, in GRADE_CUTOFFS (best→worst) order, present grades only
function gradeDist(dist) {
  const parts = GRADE_CUTOFFS.map(([g]) => g).filter(g => dist[g]).map(g => `${g}×${dist[g]}`);
  return parts.length ? parts.join('  ') : '—';
}

// YP2 (#2): items in a transition state worth watching, collected across all niches' fetched pools
// (deduped by id). Populated in renderMode BEFORE the falling-exclusion so a basing faller is caught.
const watchClosely = new Map();   // id -> { name, state, note }

// P4c: the weighed ENTRY-path menu for a surfaced (unheld) candidate. Builds the DERIVED path-scoring
// ctx from the computeQuote row + phase (the same shape context.mjs's pathsStage derives for held lots,
// minus the position/floor fields a screen candidate doesn't have — those degrade in js/paths.mjs), then
// enumerates + weighs the unheld theses (scalp / value-hold / avoid). Display-only, DECISION SUPPORT —
// never a gate, never reorders/hides a row (the P4c contract). Viabilities are the P4a PLACEHOLDER
// heuristics (shape, not calibration). Returns the weighPaths() `weighed` array (sorted by viability).
function weighEntryPaths(row, ph) {
  const derived = {
    held: false,
    regime: row.falling ? 'falling' : row.rising ? 'rising' : (row.regime && row.regime.ok ? 'flat' : null),
    phase: ph ? (ph.phase ?? null) : null,
    mom: row.mom ?? null,
    quickBuy: row.quickBuy, quickSell: row.quickSell, optBuy: row.optBuy, optSell: row.optSell,
    reliable: row.reliable,
    bandWidthPct: (row.optBuy > 0 && row.optSell != null) ? (row.optSell - row.optBuy) / row.optBuy : null,
  };
  return weighPaths(enumeratePaths(derived), derived).weighed;
}
// One compact path line for a surfaced row: the niche's inferred DEFAULT entry path (marked `*`) plus
// the weighed alternatives, e.g. `Cake — scalp* 0.60 · value-hold 0.30 · avoid 0.30`. One line per item
// (no `·`-join across items). The `↳` prefix makes the block trivially greppable for the byte-identity
// proof (the ONE intended stdout addition — strip these lines and the rest is byte-identical).
function pathLine(name, weighed, defaultPath) {
  const menu = weighed.map(w => `${w.key}${w.key === defaultPath ? '*' : ''} ${w.viability.toFixed(2)}`).join(' · ');
  return `  ↳ ${name} — ${menu}`;
}

// render one niche: filter the fetched pool, rate, sort by grade/score, print table + footer.
// v24 (the whole-market 24h map) is passed through for the PM1 probe ctx (dip's avgLow24, decant's
// sibling dose prices) — read-only, never a gate/verdict input.
function renderMode(mode, { cand, survivors }, qcache, map, series5m, series6h, v24, daily) {
  const rows = [];
  const dist = {};
  const disc = { falling: 0, notRising: 0, breakdown: 0, posture: 0, rescued: 0, reject: 0, caution: 0 };  // post-fetch discard reasons (--stats)
  const rejReasons = {};   // P2: reject reason → count, for the `rejected: N (top reasons)` footer
  const cautionNotes = []; // P2: one flagged-caution note per item (the row still shows)
  for (const s of survivors) {
    const row = qcache.get(s.id);
    if (!row) continue;
    // Part A: phase() over the SAME ts6h this row was already quoted from (zero new fetch) —
    // observational trajectory shape, folded into the Regime cell below when informative.
    const ph = phase(series6h && series6h.get(s.id));
    // YP2 (#2): collect a transition-state item (basing faller / spike on rising vs falling lows)
    // BEFORE the falling-exclusion below drops it — a basing faller is exactly the case we want to
    // watch. Descriptive prompt only; deduped across niches; never a buy signal.
    const trans = stateTransition(ph);
    if (trans && trans.watch && !watchClosely.has(s.id))
      watchClosely.set(s.id, { name: map.byId[s.id]?.name || ('#' + s.id), state: trans.state, note: trans.note });
    // P1: the post-fetch survival doctrine (falling-exclusion + --phase-rescue basing rescue,
    // rising-mode confirm, overnight-posture filters) is the pure surviveMode() in gatecandidates.mjs.
    // Byte-identical to the old inline chain: `rescued` still increments disc.rescued at the point of
    // rescue (even if a later gate drops the row), and discardReason maps 1:1 onto the disc counters.
    const sv = surviveMode(mode, row, ph, { phaseRescue: PHASE_RESCUE, posture: POSTURE, thin: s.thin, series5m: series5m && series5m.get(s.id) });
    if (sv.rescued) disc.rescued++;
    if (!sv.keep) { disc[sv.discardReason]++; continue; }
    const rescued = sv.rescued;
    const name = map.byId[s.id]?.name || ('#' + s.id);
    // P2/P3 validators. reachValidator scores the patient ask (optSell) against the reach window, but
    // screen does NOT fetch the 1h series (only ts5m/ts6h) → it DEGRADES to pass/no-data here. P3's
    // floorValidator scores the patient BUY (optBuy) against the durable multi-week floor from the
    // loadDaily {ts,mid} regime-proxy series ALREADY loaded at gate time (daily[id]) — no new fetch.
    // A buy parked well above where the 14/28d structure says support prints (the decay-knife shape) is
    // REJECTED (dropped + counted + footer); a marginally-elevated buy is CAUTIONed (row still shows).
    // A cold/absent daily series degrades to pass (the common case until the archive warms). Explicit
    // asks/held/watchlist are handled on their own surfaces where nothing is ever hidden.
    const ts = termStructure(daily && daily[s.id]);
    const vres = runValidators({
      market: { row },
      history: { termStructure: ts },
      intraday: { ts1h: null, reach: row.optSell != null ? { side: 'ask', level: row.optSell } : null },
      floor: { level: row.optBuy != null ? row.optBuy : null },
    });
    const vworst = worstStatus(vres);
    if (vworst === 'reject') {
      disc.reject++;
      for (const f of flags(vres)) if (f.status === 'reject') rejReasons[f.reason] = (rejReasons[f.reason] || 0) + 1;
      continue;
    }
    if (vworst === 'caution') {
      disc.caution++;
      cautionNotes.push(`${name}: ` + flags(vres).filter(f => f.status === 'caution').map(f => `${f.key} ${f.reason}`).join('; '));
    }
    const r = rateItem({ row, expGpDay: s.expGpDay, activeWin: s.activeWin, nWin: s.activeWin != null ? N_WIN : null, thin: s.thin });
    // Part B: a rescued basing faller is capped to PHASE_BASING_GRADE_CAP (reuses rating.mjs capGrade)
    // — a provisional surface must not advertise a headline grade off a still-declining regime.
    const grade = rescued ? capGrade(r.grade, PHASE_BASING_GRADE_CAP) : r.grade;
    const std = stdCells(name, row);                        // structured cells: [item, guide, quick, optimistic, vol, momentum, regime]
    // Part A: fold an informative phase into the existing Regime cell (no new column — the canonical
    // width/contract is untouched). A rescued row gets an explicit provisional note; other spike/decay/
    // basing rows get a ` · <phase>` suffix; base/unknown add nothing. Mutates only this call's fresh
    // std copy (quoteCells returns a new array each call) — the shared `row` model is not touched.
    const rc = std[std.length - 1];
    if (rescued) rc.t = rc.t + ' · basing after decay — provisional';
    else if (ph.phase === 'spike' || ph.phase === 'decay' || ph.phase === 'basing') rc.t = rc.t + ' · ' + ph.phase;
    // insert Grade after Item, append Score gp/d — both structured {t} so the app publish path is
    // uniform (Grade rendered as a pill app-side by header name; Score right-aligned num). A thin
    // (gp-flow-only) row carries a `title` on the Grade cell — the honesty tooltip (rendered app-side;
    // cellText ignores it so stdout stays clean). `row`/`grade` kept on the pushed object — the O1
    // suggestions ledger reads them below.
    const gradeCell = rescued
      ? { t: grade, title: 'basing after decay — provisional (falling-exclusion overridden by --phase-rescue); grade capped at ' + PHASE_BASING_GRADE_CAP }
      : s.thin
        ? { t: grade, title: `thin: ~${s.limitVol}/day two-sided — size in units, expect slow fills` }
        : { t: grade };
    const cells = [std[0], gradeCell, ...std.slice(1), { t: fmtP(r.score), c: 'num' }];
    // PM1: run the loaded probes over this row. OUTPUT-ONLY — a probe reads the row/ctx and returns a
    // display tag (observe) or an advisory price nudge (price); it NEVER touched `grade`/`r`/the cells
    // above (all already computed). ctx carries the 24h avg (dip), the phase trajectory (froth), the
    // whole-market map (decant siblings) and an advisory ask price (anchor). Empty when no probe fired.
    const d24 = v24 && (v24[s.id] || v24[String(s.id)]);
    const fired = runProbes(row, 'screen', {
      surface: 'screen', owned: false, id: s.id, name, thin: s.thin,
      phase: ph, avgLow24: d24?.avgLowPrice ?? null, avgHigh24: d24?.avgHighPrice ?? null,
      series5m: series5m && series5m.get(s.id), series6h: series6h && series6h.get(s.id),
      v24all: v24, map,
      price: row.optSell != null ? { side: 'ask', proposed: row.optSell } : undefined,
    });
    // PM2: record every firing to pipeline/modules/<module>.log (failure-safe, stdout-untouched).
    logFirings(fired, { surface: 'screen', id: s.id, name, quickBuy: row.quickBuy, quickSell: row.quickSell, guide: row.guide, regimeLabel: row.regimeLabel, phase: ph?.phase ?? null });
    const probeStr = fired.map(f => f.tag).join(' · ');
    // P4c: the weighed entry-path menu for this surfaced candidate (display-only; computed off the
    // already-derived row + phase, no new fetch). Stored on the row so the post-table block prints in
    // the same sorted order as the table.
    const pathWeighed = weighEntryPaths(row, ph);
    rows.push({ id: s.id, row, grade, cells, score: r.score, probeStr, validators: leanValidators(vres), pathWeighed });
    dist[grade] = (dist[grade] || 0) + 1;
  }
  // sort: active weights the risk-adjusted score (velocity-inclusive); overnight weights NET EDGE per
  // unit (patient band-edge net/u) over velocity — you want the fattest unattended margin, not churn.
  if (POSTURE === 'overnight') rows.sort((a, b) => (b.row.optNet || 0) - (a.row.optNet || 0) || b.score - a.score);
  else rows.sort((a, b) => b.score - a.score);

  // O1 suggestions ledger: log every rated (surfaced) row at emit time, unconditionally. The niche
  // is `mode`; the emitted "verdict" is the letter grade the row was surfaced under.
  // P4c: log the surfacing spec's inferred DEFAULT entry path on each row so a later fill can infer the
  // thesis a position was entered under when no explicit thesis.mjs --path was declared.
  const defaultPath = STRATEGIES[mode].defaultPath;
  logSuggestions('screen', { mode, params: SCREEN_PARAMS },
    rows.map(r => suggestionEntry(r.row, { itemId: r.id, cls: liqClass(r.row), verdict: r.grade, posture: POSTURE, validators: r.validators, path: defaultPath })));

  // P5: the falling note is per-spec — a 'accept' niche (scalp) deliberately INCLUDES fallers.
  const fallNote = STRATEGIES[mode].falling === 'accept' ? 'fallers INCLUDED (the thesis)' : 'fallers excluded';
  console.log(`## ${mode.toUpperCase()} — ${rows.length} rated (from ${cand.length} gated, top ${survivors.length} fetched; ${fallNote})`);
  console.log(PLAYBOOK[mode]);
  console.log(mode !== 'spread' ? `(band basis: ${BAND_HOURS}h, ≥${MIN_ACTIVE} traded 5m windows)` : '(basis: 24h-average spread)');
  // PM1: the dedicated `Probes` column is appended to the PRINTED table ONLY when at least one row
  // fired a probe — so with no module present (or none firing) the table is BYTE-IDENTICAL to pre-PM1
  // (the removability guarantee). It is deliberately NOT added to the published cells (screen.json /
  // the app render) — an app Probes column is a separate, APP_VERSION-bumping step (out of PM1 scope).
  const anyProbe = rows.some(r => r.probeStr);
  const printHeaders = anyProbe ? [...HEADERS, 'Probes'] : HEADERS;
  const printCells = anyProbe ? rows.map(r => [...r.cells, { t: r.probeStr, c: 'mini' }]) : rows.map(r => r.cells);
  console.log(rows.length ? mdTable(printHeaders, printCells) : '_none_');
  console.log(`Grades: ${gradeDist(dist)}`);
  // P2: the coordinator-ruled reject footer — printed whenever any row was validator-REJECTED, naming
  // the count + the top-3 reasons. reachValidator still degrades to pass here (no 1h series fetched);
  // P3's floorValidator CAN reject (a buy parked well above the durable multi-week floor) once the
  // loadDaily archive has enough history — until it warms, floor also degrades to pass and this line is
  // absent (default output byte-identical). Caution rows still show; each is flagged on its own line.
  if (disc.reject > 0) {
    const top = Object.entries(rejReasons).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([why, n]) => `${why}×${n}`).join(', ');
    console.log(`rejected: ${disc.reject}${top ? ` (${top})` : ''}`);
  }
  for (const c of cautionNotes) console.log(`⚠ caution — ${c}`);
  // Build 2 — per-row velocity tag: descriptive per-item velocity (fast/slow · median fill · %
  // unfilled) from the gitignored outcomes.json for rows in THIS niche with enough trade history.
  // STDOUT-ONLY — deliberately NOT in the published cells, so the canonical table + screen.json/app
  // contract stay byte-identical (same discipline as the phase fold into the Regime cell). A label,
  // never a sort/gate; absent/empty outcomes.json → silent.
  if (VEL && VEL.byItem.size && rows.length) {
    const tags = [];
    for (const r of rows) {
      const t = velocityTag(VEL.byItem.get(r.id));
      if (t) tags.push(`${map.byId[r.id]?.name || ('#' + r.id)} ${t}`);
    }
    if (tags.length) {
      const ageH = VEL.generatedAt ? Math.round((Date.now() - new Date(VEL.generatedAt).getTime()) / 3600000) : null;
      console.log(`velocity (outcomes.json${ageH != null ? `, ${ageH}h old` : ''}; descriptive per-item history, not a rate): ${tags.join(' · ')}`);
    }
  }
  // P4c: the weighed ENTRY-PATH menu per surfaced row — the surfacing spec's inferred default path
  // (marked `*`) + the weighed alternatives from js/paths.mjs (scalp / value-hold / avoid). Decision
  // SUPPORT, not a gate: it never hides or reorders a row (the block prints in the SAME sorted order as
  // the table above). STDOUT-ONLY — deliberately NOT in the published screen.json cells, so the
  // canonical table + app contract stay byte-identical (same discipline as the phase/velocity folds).
  if (rows.length) {
    console.log(`Entry paths (surfacing default \`*\` + weighed menu; support, not a gate — placeholder weights):`);
    for (const r of rows) console.log(pathLine(map.byId[r.id]?.name || ('#' + r.id), r.pathWeighed, defaultPath));
  }
  if (STATS) {
    const fetched = survivors.length, kept = rows.length;
    const reasons = `falling ${disc.falling}` + (mode === 'rising' ? `, not-rising ${disc.notRising}, breakdown ${disc.breakdown}` : '') + (POSTURE === 'overnight' ? `, posture ${disc.posture}` : '') + (PHASE_RESCUE ? `, basing-rescued ${disc.rescued}` : '') + `, validator-reject ${disc.reject}, validator-caution ${disc.caution}`;
    console.log(`stats: gated ${cand.length} | fetched ${fetched} | survivors ${kept} | yield ${fetched ? Math.round(kept / fetched * 100) : 0}% | discarded: ${reasons}`);
  }
  console.log('');
  // publishable rows (sorted-by-grade, byte-identical cells + itemId for the app's deep link)
  return rows.map(r => ({ id: r.id, cells: r.cells }));
}

// --- P5 VALUE niche render (PLAN-VALUE §D) -----------------------------------------------------
// A dedicated table: the value niche does NOT use the fast-flip grade/verdict/rating stack (§E — value
// picks are ISOLATED, never feed another niche's verdicts/alerts). It prints the term-structure read
// (multi-week range, live-vs-low, after-tax cycle amplitude, floor phase·stability) split into buy-now
// vs watch tiers, with the hold horizon stated at entry and an admitted-vs-shown footer (§F). Every row
// is flagged PROVISIONAL (unproven theory, n≈0). Picks accrue via the O1 suggestions ledger (mode
// 'value', path value-hold) — the firing-log convention for surfaced picks. OFF by default (--mode value).
const VALUE_HEADERS = ['Item', 'Guide', 'Live', 'Multi-wk range (low→high)', 'Live vs low', 'Cycle net/u (after-tax)', 'Floor (phase · stability)', 'Hold horizon'];
function renderValueMode({ cand, survivors }, qcache, map, series6h, guide, daily) {
  const buyNow = [], watch = [];
  const sugg = [];
  let droppedKnife = 0;   // post-fetch phase() decay-knife drops
  for (const s of survivors) {
    const row = qcache.get(s.id);
    if (!row) continue;
    const name = map.byId[s.id]?.name || ('#' + s.id);
    const live = row.quickBuy ?? row.mid ?? s.mid;
    // recompute the term structure off the LIVE price (better proximity than the pre-fetch mid) and
    // re-run the value gate WITH the fetched phase() — a decay shape is the knife the pre-fetch
    // term-structure delta may miss (§A "buy the base, never the knife").
    const ts = termStructure(daily && daily[s.id]);
    const vr = valueRanges(ts, live);
    const ph = phase(series6h && series6h.get(s.id));
    const g = valueGate(vr, { phase: ph && ph.phase });
    if (!g.pass) { if (g.reason === 'decay') droppedKnife++; continue; }
    const tier = valueTier(vr);
    const netU = Math.round((vr.durableHigh - tax(vr.durableHigh)) - vr.buyLow);
    const ampPct = (vr.afterTaxAmpPct * 100);
    const stabPct = vr.stability != null ? Math.round(vr.stability * 100) : null;
    const phaseTag = (ph && (ph.phase === 'basing' || ph.phase === 'base' || ph.phase === 'spike' || ph.phase === 'decay')) ? ph.phase : 'flat';
    const rangeCell = `${fmtP(vr.durableLow)} → ${fmtP(vr.durableHigh)}`;
    const liveVsLow = vr.liveVsLowPct != null ? `+${(vr.liveVsLowPct * 100).toFixed(1)}%` : '—';
    const cells = [
      { t: name }, { t: guide && guide[s.id] != null ? fmtP(guide[s.id]) : '—' }, { t: fmtP(live) },
      { t: rangeCell }, { t: liveVsLow, c: 'mini' },
      { t: `+${fmtP(netU)} (${ampPct.toFixed(1)}%)`, c: 'gain' },
      { t: `${phaseTag} · ${stabPct != null ? stabPct + '% stable' : 'n/a'}`, c: 'mini' },
      { t: 'multi-wk hold', c: 'mini' },
    ];
    (tier === 'buy-now' ? buyNow : watch).push({ id: s.id, cells, score: s.valueScore });
    sugg.push(suggestionEntry(row, { itemId: s.id, cls: liqClass(row), verdict: tier === 'buy-now' ? 'VALUE-BUY' : 'VALUE-WATCH', posture: POSTURE, path: 'value-hold' }));
  }
  buyNow.sort((a, b) => b.score - a.score); watch.sort((a, b) => b.score - a.score);
  // §E — value picks are logged in ISOLATION (mode 'value'); they never touch the fast-flip ledger rows.
  logSuggestions('screen', { mode: 'value', params: SCREEN_PARAMS }, sugg);

  const shown = buyNow.length + watch.length;
  console.log(`## VALUE — ${shown} buy-hold candidate(s) near a multi-week low (PROVISIONAL — unproven theory, n≈0)`);
  console.log('Playbook: buy near the multi-week low, HOLD for the range to cycle up; the edge is ONE tax-paid sell of a big move, not fast churn. State the hold horizon at entry — this is a multi-day/week HOLD, not a flip.');
  console.log(`(term structure: 1/3/7/14/28d low·high; ranked by valueScore = after-tax cycle amplitude × proximity-to-low × floor-stability — PLACEHOLDER weights, n≈0)`);
  if (buyNow.length) {
    console.log(`\n### BUY-NOW — live at/near the multi-week low (${buyNow.length})`);
    console.log(mdTable(VALUE_HEADERS, buyNow.map(r => r.cells)));
  }
  if (watch.length) {
    console.log(`\n### WATCH — good range, mid-cycle; wait for the dip (${watch.length})`);
    console.log(mdTable(VALUE_HEADERS, watch.map(r => r.cells)));
  }
  if (!shown) console.log('_none_');
  // §F admitted-vs-shown footer — never dump the full pool; say how many the gate admitted.
  console.log(`\nadmitted ${cand.length} (gate) · fetched ${survivors.length} (top ${VALUE_TOP_DEFAULT} by valueScore) · shown ${shown}${droppedKnife ? ` · dropped ${droppedKnife} post-fetch decay-knife` : ''}`);
  console.log('');
  // publishable rows: buy-now first, then watch (isolated; the app has no VALUE tab yet → console-only)
  return [...buyNow, ...watch].map(r => ({ id: r.id, cells: r.cells }));
}

// --- S3: watchlist always scanned -------------------------------------------------------------
// The pipeline can't read the browser's localStorage, so the watchlist source of truth is tracked
// repo-root watchlist.json (array of item names/ids). Every scan ALWAYS quotes every watchlisted
// item as a full standard row, EXEMPT from all floors/gates, graded, with the reason a gate WOULD
// have hidden it as a Note — and FALLING watchlist items ARE shown (the held/asked falling-exception
// now extends to watchlisted items). The app takes union(localStorage, repo file); write-back is M1.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Build 2: per-item velocity index from the gitignored outcomes.json (YV1 campaigns), loaded ONCE.
// Descriptive footnote source only — absent/unreadable/empty file → null → the footnote stays silent
// (never a fetch, never a fabricated tag). Refreshed by `outcomes.mjs --report`.
function loadVelocityIndex() {
  try { return buildVelocityIndex(JSON.parse(readFileSync(join(REPO_ROOT, 'outcomes.json'), 'utf8'))); }
  catch { return null; }
}
const VEL = loadVelocityIndex();
function loadWatchlist(map) {
  let raw;
  try { raw = JSON.parse(readFileSync(join(REPO_ROOT, 'watchlist.json'), 'utf8')); }
  catch { return []; }                                    // absent/unreadable → no watchlist section
  if (!Array.isArray(raw)) return [];
  const seen = new Set(), out = [];
  for (const entry of raw) {
    const hit = map.resolve(typeof entry === 'number' ? String(entry) : entry);
    if (!hit || seen.has(hit.id)) continue;
    seen.add(hit.id); out.push(hit);
  }
  return out;
}
// best-effort realistic gp/day for a watchlist grade (no mode context) — band edge if we have one,
// else the 24h-avg spread; same expUnits basis as the niches. Informational only.
function roughExpGpDay(d, bands, id, limit) {
  if (!d) return 0;
  const b = bands && bands[id];
  let net;
  if (b && b.bandHi != null && b.bandLo != null) net = (b.bandHi - tax(b.bandHi)) - b.bandLo;
  else if (d.avgHighPrice && d.avgLowPrice) net = (d.avgHighPrice - tax(d.avgHighPrice)) - d.avgLowPrice;
  else return 0;
  if (net <= 0) return 0;
  return Math.round(expUnits(limit, Math.min(d.highPriceVolume || 0, d.lowPriceVolume || 0)) * net);
}
// the reason a gate WOULD have hidden this row (empty = it'd pass a normal scan) — surfaced as a Note.
function watchlistNote(row, d, bands, id, limit) {
  const hpv = d?.highPriceVolume || 0, lpv = d?.lowPriceVolume || 0;
  if (hpv <= 0 || lpv <= 0) return 'one-sided book — uncrossable (ghost-spread)';
  if (row.falling) return 'falling — price to clear, do not accumulate';
  const limitVol = Math.min(hpv, lpv), mid = row.mid || ((d.avgHighPrice + d.avgLowPrice) / 2);
  if (limitVol < FLOOR) return limitVol * mid >= GP_FLOOR ? `thin (~${limitVol}/day — size in units)` : 'thin/illiquid — few trades/day';
  if (roughExpGpDay(d, bands, id, limit) < MIN_GPD) return `below ${(MIN_GPD/1e3).toLocaleString()}k/day attention floor`;
  return '';                                               // would surface in a normal scan on merit
}
async function runWatchlist(map, ctx, guide, latest, qcache, series5m) {
  const wl = loadWatchlist(map);
  if (!wl.length) return null;
  const { v24, bands } = ctx;
  const rows = [], sugg = [];
  for (const { id, name } of wl) {
    let row = qcache.get(id);
    if (!row) {                                           // not in any niche fetch pool → fetch it now
      const ts5m = await fetchTsCached(id, '5m', TS_TTL_5M); await sleep(30);
      const ts6h = await fetchTsCached(id, '6h', TS_TTL_6H); await sleep(30);
      row = computeQuote({ latest: latest[id] || latest[String(id)] || null, ts5m, ts6h, vol24: v24[id], guide: guide[id] ?? null, limit: map.byId[id]?.limit ?? null, asked: true, held: true });
    }
    const d = v24[id], limit = map.byId[id]?.limit ?? null;
    const limitVol = d ? Math.min(d.highPriceVolume || 0, d.lowPriceVolume || 0) : 0;
    const thin = d ? (limitVol > 0 && limitVol < FLOOR) : false;
    const r = rateItem({ row, expGpDay: roughExpGpDay(d, bands, id, limit), thin });
    const std = stdCells(name, row);
    const gradeCell = thin ? { t: r.grade, title: `thin: ~${limitVol}/day two-sided — size in units, expect slow fills` } : { t: r.grade };
    const cells = [std[0], gradeCell, ...std.slice(1), { t: fmtP(r.score), c: 'num' }, { t: watchlistNote(row, d, bands, id, limit), c: 'mini' }];
    rows.push({ id, cells });
    sugg.push(suggestionEntry(row, { itemId: id, cls: liqClass(row), verdict: r.grade, posture: POSTURE }));
  }
  logSuggestions('screen', { mode: 'watchlist', params: SCREEN_PARAMS }, sugg);
  const headers = [...HEADERS, 'Note'];
  console.log(`## WATCHLIST — ${rows.length} item(s) (always shown; exempt from floors/gates; falling items shown with a warning)`);
  console.log(mdTable(headers, rows.map(r => r.cells)));
  console.log('');
  return { headers, rows };
}

async function main() {
  pruneCache('ts', 24 * 3600 * 1000);                     // bound the per-item series cache
  const map = await loadMapping();
  const [v24, latest, guide] = [await loadAll24h(), await loadAllLatest(), await loadGuide()];
  const bands = NEED_BANDS ? await loadBands(BAND_HOURS) : null;
  const { series: daily, coverageWindows } = await loadDaily(DAILY_DAYS, DAILY_STEP_H);  // bulk regime-proxy archive
  const ctx = { v24, map, bands, daily };   // P5: `daily` rides the ctx so the value gate can read the term structure

  // gate every mode, then proxy-rank its gated pool and take the top-N fetch pool. P5 value ranks by
  // valueScore and takes a HARD top-N (VALUE_TOP_DEFAULT §F) — a bounded shortlist off a large pool.
  const gated = {};
  for (const m of RUN_MODES) {
    const cand = gateCandidates(m, ctx, THRESHOLDS);
    const top = STRATEGIES[m].gate === 'value' ? VALUE_TOP_DEFAULT : TOP;
    gated[m] = { cand, survivors: rankAndSlice(m, cand, daily, { thinReserve: THIN_RESERVE, top }) };
  }

  // fetch each unique survivor's series ONCE (shared across modes in --mode all; cached on disk), quote it
  const ids = new Set();
  for (const m of RUN_MODES) for (const s of gated[m].survivors) ids.add(s.id);
  const qcache = new Map(), series5m = new Map(), series6h = new Map();
  for (const id of ids) {
    const ts5m = await fetchTsCached(id, '5m', TS_TTL_5M); await sleep(30);
    const ts6h = await fetchTsCached(id, '6h', TS_TTL_6H); await sleep(30);
    const lt = latest[id] || latest[String(id)] || null;
    const limit = map.byId[id]?.limit ?? null;
    qcache.set(id, computeQuote({ latest: lt, ts5m, ts6h, vol24: v24[id], guide: guide[id] ?? null, limit }));
    series5m.set(id, ts5m);   // kept raw for the overnight-posture staleness read (overnightStaleRisk)
    series6h.set(id, ts6h);   // kept raw for the Part A phase() trajectory read (same ts6h as the quote)
  }

  console.log(`# Opportunity screen — mode ${MODE.toUpperCase()}, posture ${POSTURE.toUpperCase()}, liquidity ${FLOOR}/d OR ${(GP_FLOOR/1e6).toLocaleString()}m gp-flow, min ROI ${MIN_ROI}% (thin: ${(MIN_NET_GP/1e3).toLocaleString()}k net/u), attention floor ${(MIN_GPD/1e3).toLocaleString()}k gp/d, ${MIN_PRICE.toLocaleString()}–${MAX_PRICE.toLocaleString()} gp, top ${TOP} fetched/niche`);
  console.log(`(${ids.size} unique items fetched; grade cutoffs are PLACEHOLDERS pending the validation study)`);
  if (coverageWindows < DAILY_COLD) console.log(`(⚠ regime-proxy archive is COLD — only ${coverageWindows}/${Math.round(DAILY_DAYS * 24 / DAILY_STEP_H)} windows; fetch-pool ordering is degraded until it warms up)`);
  console.log('');
  await loadModules();   // PM1: discover pipeline/modules/*.mjs once (empty/absent dir → zero probes → byte-identical)
  const niches = {};
  for (const m of RUN_MODES) niches[m] = STRATEGIES[m].gate === 'value'
    ? renderValueMode(gated[m], qcache, map, series6h, guide, daily)   // P5 — the value niche's own term-structure table
    : renderMode(m, gated[m], qcache, map, series5m, series6h, v24, daily);
  // YP2 (#2) WATCH CLOSELY — items entering a transition state (basing faller / spike on rising vs
  // falling lows), collected across the fetched pool. Descriptive prompts, NOT buy signals;
  // deliberately stdout-only (no screen.json / app render — that surfacing is #5).
  if (watchClosely.size) {
    console.log(`## WATCH CLOSELY — ${watchClosely.size} item(s) in a transition state (descriptive, not a buy signal)`);
    for (const e of watchClosely.values()) console.log(`- ${e.name}: ${e.state} — ${e.note}`);
    console.log('');
  }
  const watchlist = await runWatchlist(map, ctx, guide, latest, qcache, series5m);   // S3: always-scanned watchlist

  // --publish: self-describing per-niche snapshot for the app's Scan tab. `headers` travels WITH the
  // rows so a stale published file can never mismatch app-side header code; cells are byte-identical
  // to the tables above (same stdCells / rating path) so the app renders exactly what the scan said.
  if (PUBLISH) {
    const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'screen.json');
    // P5: the VALUE niche has its OWN column set (VALUE_HEADERS) + is console-only (PLAN-VALUE decision
    // 4 — no app tab yet), so it is EXCLUDED from screen.json (which carries a single HEADERS set). An
    // app VALUE surface is a later, APP_VERSION-bumping step.
    const pubNiches = {};
    for (const m of RUN_MODES) if (STRATEGIES[m].gate !== 'value') pubNiches[m] = niches[m];
    const payload = {
      app: 'the-coffer-screen',
      schema: 2,                       // 2 = T1 structured cells ({t,c}); 1 = legacy plain-string cells (app reads both)
      generatedAt: new Date().toISOString(),
      mode: MODE,
      posture: POSTURE,                // S2: the Scan banner reads this to say which posture it shows
      params: { floor: FLOOR, gpFloor: GP_FLOOR, minRoi: MIN_ROI, minNetGp: MIN_NET_GP, minGpd: MIN_GPD, minPrice: MIN_PRICE, maxPrice: MAX_PRICE, top: TOP, bandHours: BAND_HOURS, minActive: MIN_ACTIVE, posture: POSTURE },
      headers: HEADERS,
      niches: pubNiches,
      // S3 watchlist section — its own headers (adds a Note column) travel with it so the app renders
      // it as a distinct always-shown section; null when watchlist.json is empty/absent.
      watchlist: watchlist ? { headers: watchlist.headers, rows: watchlist.rows } : null,
    };
    writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');
    console.log(`(published → screen.json: ${Object.keys(pubNiches).map(m => `${m} ${pubNiches[m].length}`).join(', ') || 'none'}${IS_VALUE ? ' — value niche is console-only, excluded from screen.json' : ''}${watchlist ? `, watchlist ${watchlist.rows.length}` : ''})`);
  }
}

// Run only when invoked directly (`node pipeline/screen.mjs …`); importing the module (e.g. the
// NY2.1 risingPoolFloor unit check) must NOT fire a full screen / hit the API. process.argv[1] is
// undefined under `node -e`, so guard it (an eval context is never a direct invocation).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
