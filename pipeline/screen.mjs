#!/usr/bin/env node
/**
 * screen.mjs — opportunity screen. ONE command → a finished, RATED table per niche.
 *
 *   node pipeline/screen.mjs [--mode band|churn|scalp|value|all]
 *     [--floor 50] [--min-roi 1.5] [--min-price 0] [--max-price 45m] [--top 40]
 *     [--band-hours 2] [--min-traded 6] [--stats] [--publish]
 *
 *   --publish ALSO writes repo-root screen.json: a self-describing per-niche graded snapshot
 *   { app, generatedAt, mode, params, headers, niches:{band,churn} } that the app's
 *   Scan tab renders. Each row is { id (for the Item→Trends deep link), cells } byte-identical to
 *   the printed table. sync-fills.mjs commits screen.json alongside fills/positions when present.
 *
 * The screen has ONE shared gate stack for every mode; --mode only swaps the step-3 EDGE
 * DEFINITION + ranking. Shared gates: two-sided liquidity (highPriceVolume>0 && lowPriceVolume>0,
 * limiting side ≥ --floor — the ghost-spread lesson), --min-price/--max-price on mid, top-N per-item
 * regime confirm via computeQuote, per-spec falling doctrine (P5: band/churn EXCLUDE fallers, scalp
 * ACCEPTS + REQUIRES, value KNIFE-GUARDS — `js/strategies.mjs` `spec.falling`, NOT a global rule).
 *
 * Fetch-pool ordering (the pre-filter rework): the expensive step is the per-item timeseries fetch,
 * so WHICH gated items make the top-N fetch pool matters. loadDaily() builds a BULK multi-day
 * mid-price archive (whole-market /1h @6h spacing, backed by the D0 Tier-1 SQLite archive) → a regime PROXY (proxyDrift, same
 * 3d-vs-~2wk shape as computeQuote's regimeDrift) that is NEVER displayed and only ORDERS the pool:
 * probable fallers are deprioritized (they'd be discarded post-fetch anyway), and a bounded rising
 * reserve front-loads the highest-proxy risers so they aren't buried below flats (the absorbed `rising`
 * mechanism, Steps 3+4). The real regime + falling-exclusion still run post-fetch on computeQuote. Per-item
 * series are cached (fetchTsCached) so re-running the screen doesn't re-hammer the API, and the survivor
 * fetch runs through a bounded worker pool (FETCH_CONCURRENCY items at once, each item's 5m/6h/1h in
 * parallel — the pool bound is the politeness throttle, not per-fetch sleeps). --stats prints
 * a per-niche footer: gated / fetched / survivors / yield / discard reasons.
 *
 * Output (chunk 0 rework): ONE table PER niche (no more Tier A / Tier B split), each sorted by a
 * letter GRADE. The grade is a desirability heuristic — "which of these do I actually put offers in
 * for?" — that blends the PER-THESIS RANK with a risk-quality multiplier (regime, momentum, liquidity,
 * capital, band confidence). See rating.mjs for the full rationale; the grade cutoffs + factor weights
 * there are PLACEHOLDERS pending calibration. P6b (Ben 2026-07-09: "gp/d is out as the ranking metric"):
 * the last column is `Rank net·P/ttf` — the risk-adjusted `net after tax × P(fill at the quoted pair) ÷
 * TTF` (pipeline/lib/estimators.mjs), rendered with its components (net · P~ · ttf~) so the honesty
 * travels with the number. expGpDay survives ONLY as the cheap pre-fetch pool orderer (rankAndSlice) +
 * the 500k --min-gpd attention pre-filter — never again the displayed "best" number or the grade basis.
 * `--mode all` runs all four niches and shares one per-item fetch cache (items common to several niches
 * are fetched once). A grade-distribution footer per table lets us SEE whether the score separates
 * best-from-good (if a batch clumps at one grade, the factors — not the letter scale — need work).
 *
 * Modes (step-3 edge). Steps 3+4 (Ben 2026-07-09): the `spread` and `rising` niches are DELETED — spread's
 * 24h-average edge is narrower than the band + surfaced ≈0 clean flips once the net>0 gate landed (its thin
 * big-ticket lane is already caught by band's thin path), and rising ⊆ band with its proxy-ordering absorbed
 * into rankAndSlice's rising reserve. Remaining:
 *   band  (DEFAULT) — the crystal-teleport-seed niche: a liquid, regime-stable item with a wide
 *                     INTRADAY band. Edge = after-tax net of bandLo→bandHi from loadBands
 *                     (--band-hours, default 2); gate bandRoi ≥ --min-roi AND the band must be
 *                     TRADED — Bar D: ≥ --min-traded windows with ANY trade (density) AND both sides
 *                     printed ≥1× across the window (two-sided), NOT the old same-5m-window count.
 *   churn           — buy-limit-cycle commodities: volDay ≥ 2000 && limit > 0, tiny ROI accepted
 *                     (no --min-roi gate), the high-frequency small-margin niche.
 *   scalp           — provisional, OFF-by-default (explicit --mode only): a deliberate flip on a FALLING
 *                     wide band (fallers only).
 *   value           — a term-structure buy-hold (own table); provisional (n≈0) but IN --mode all as of
 *                     2026-07-10 (Ben) — console-only (excluded from screen.json).
 *   all             — run band + churn + value in sequence (shared fetch cache). scalp explicit-only.
 *
 *   --mode dip is DESIGNED-NOT-BUILT (flat regime + mom↓ wick-bids). Out of scope here on purpose.
 *
 * Ranking: the fetch POOL is still picked by realistic expected gp/day (expUnits/day = min(limit×6,
 * 10% × volDay); expGpDay = expUnits × the mode's net/u) — the ONLY surviving use of expGpDay, as the
 * cheap pre-fetch orderer + the 500k --min-gpd pre-filter (P6b demotion). The DISPLAYED table is then
 * sorted by the risk-adjusted per-thesis RANK (net × P(fill) ÷ TTF) from rating.mjs/estimators.mjs.
 *
 * ALL quote/tax/regime math is js/quotecore.js (imported); rating math is rating.mjs. This file only
 * fetches + gates + rates + renders.
 */
import { computeQuote, QUOTE_HEADERS, isOvernightNow, phase, OVERNIGHT_SPAN_H, nominateDip, reconcileDipPool, flushSignal, askHeadroomText } from '../js/quotecore.js';
import { tax, fmt, fmtP, fmtHour } from '../js/format.js';
import { hourProfile, deriveDiurnalRange, windowStats, asymPair, windowClear, windowClearDiverges } from '../js/windowread.mjs';   // diurnal peak-timing read + PART II asym pair (both off the in-hand 1h series); PLAN-WINDOW-CLEAR B2 — within-window clear read + divergence flag
// P6b — per-thesis P(fill)+TTF estimators + the ranking composite that REPLACES the demoted expGpDay
// (Ben 2026-07-09: "gp/d is out"). estimateRank returns { pair, net, pFill, ttf, rank } off the row +
// the spec's declared price-basis; rank = net × P(fill) ÷ TTF is the new displayed/graded metric.
import { estimateRank, rankScore, ESTIMATORS, fmtTtf, asymEstimate, estimatePair, estPairCells, estConfLean, EST_HEADERS, dayHighFrom5m } from './lib/estimators.mjs';   // PLAN-LIQUIDITY-REACH: dayHighFrom5m = the observed 24h high (Part B de-bias reference) off the in-hand 5m series
import { anchorNudge } from './modules/anchor.mjs';   // PLAN-OUTPUT-TABLE: the ⚓ round-number nudge, injected into estimatePair (final step — nudge, never override)
import { loadMapping, loadGuide, loadAll24h, loadAll24hRolling, rolling24FromTs1h, loadAllLatest, loadBands, loadDaily, fetchTsCached, pruneCache, sleep } from './lib/marketfetch.mjs';
import { parseArgs, parseGp, mdTable, stdCells } from './lib/cli.mjs';
// P1: the pure candidate-selection + survival doctrine moved to lib/gatecandidates.mjs (was inline
// here: gateCandidates/risingPoolFloor/expUnits/proxyDrift/softFactor/rankAndSlice + the extracted
// renderMode post-fetch doctrine surviveMode). Logic byte-identical; screen.mjs passes its CLI
// THRESHOLDS / sizing explicitly. Fixtures drive them in gatecandidates.test.mjs + survivemode.test.mjs.
import { gateCandidates, rankAndSlice, surviveMode, expUnits, expUnitsOvernight, VALUE_TOP_DEFAULT, subFloorFallback, subFloorLabel, SUBFLOOR_TOP, SUBFLOOR_GRADE_CAP } from './lib/gatecandidates.mjs';
import { valueRanges, valueScore, valueGate, valueTier } from '../js/valuescreen.mjs';   // P5 — value niche gate/rank/tier
// P4c: the four niches are DECLARATIVE strategy specs now. screen.mjs derives its mode-name lists from
// the registry (the names live in ONE place — strategies.mjs) and reads each spec's inferred default
// entry path for the suggestions ledger + the per-row path annotation.
import { STRATEGIES, MODE_KEYS, ALL_MODE_KEYS } from '../js/strategies.mjs';
import { enumeratePaths, weighPaths } from '../js/paths.mjs';   // P4c: weighed entry-path menu per surfaced row (display-only)
import { rateItem, GRADE_CUTOFFS, capGrade, REACH_GRADE_CAP, REACH_GRADE_CAP_FRAC } from './lib/rating.mjs';
import { logSuggestions, suggestionEntry, liqClass } from './lib/suggestlog.mjs';
import { PIPELINE_VERSION } from './lib/version.mjs';   // PV — stamped into screen.json so the app can display the pipeline version
import { loadDerivedCash } from './lib/cashderive.mjs';   // value niche: DERIVED deployable pool → --capital default (cash.mjs anchor + log flow)
import { readOffersSnapshot } from './lib/offers.mjs';   // resting-bid item ids for the deployablePool marketRef (deep-vs-committed classification)
import { runValidators, flags, informFlags, leanValidators, worstStatus } from '../js/validate.mjs';   // P2 — validator registry: DROP reject, FLAG caution, INFORM = annotate-only
import { buysByItem, limitWindow } from './lib/limits.mjs';   // LM1 — per-item 4h buy-limit window (limitValidator BUY-side)
import { termStructure } from '../js/termstructure.mjs';   // P3 — term structure / durable floor for floorValidator (fed the loadDaily proxy series)
// COD-4 (2026-07-10): richFrom1h/trajectoryFrom1h were EXTRACTED to lib/richterm.mjs (byte-identical
// logic) so quote.mjs's budgeted-ts1h read shares the IDENTICAL warm-term-structure aggregation and the
// two surfaces can't drift — the loadDaily archive is still young, so both derive the warm trajectory (+
// value-amplitude's recent-week lookbacks) off the 1h /timeseries. See the richterm.mjs header for why.
import { richFrom1h, trajectoryFrom1h } from './lib/richterm.mjs';
import { stateTransition } from './lib/statetransition.mjs';   // YP2 (#2) — watch-closely transition scan
import { buildVelocityIndex, velocityTag } from './lib/velocitytag.mjs';   // Build 2 — per-item velocity footnote from outcomes.json
import { loadModules, runProbes, logFirings } from './lib/modules.mjs';   // PM1 — probe-module system (dip/froth/anchor/decant); PM2 — firing log
import { writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// --- args ---
const A = parseArgs(process.argv.slice(2));
const MODES = MODE_KEYS;         // P4c: valid explicit --mode values, from the strategy registry (band/churn/scalp/value — spread+rising deleted, Steps 3+4)
const ALL_MODES = ALL_MODE_KEYS; // --mode all runs the inAll specs — band/churn/value (Ben 2026-07-10 added value; scalp explicit-only)
const MODE = A.mode != null && A.mode !== true ? String(A.mode).toLowerCase() : 'band';
if (MODE !== 'all' && !MODES.includes(MODE)) { console.error(`! unknown --mode "${A.mode}". Use one of: ${MODES.join(', ')}, all (or omit for band).`); process.exit(1); }
const FLOOR = A.floor != null ? +A.floor : 3500;   // PLAN-VOL24 step 2: recalibrated 50 → 3500 against the CORRECTED rolling-24h volume distribution (count-matched to the old 50/legacy selectivity; the /24h endpoint under-read ~10–27×, so the old 50 was ~18× too loose in corrected units). Band `thin` (limitVol < FLOOR) auto-follows.
const MIN_ROI = A['min-roi'] != null ? +A['min-roi'] : 1.5;
const MIN_PRICE = A['min-price'] != null ? parseGp(A['min-price']) : 0;
const MAX_PRICE = A['max-price'] != null ? parseGp(A['max-price']) : 45e6;
const TOP = A.top != null ? +A.top : 40;
const BAND_HOURS = A['band-hours'] != null ? +A['band-hours'] : 2;
// Bar D (Ben 2026-07-09) DENSITY floor for dense (non-thin) bands — # of windows with ANY trade (one-
// sided OK) the band must show; two-sidedness is a separate check (sawLow && sawHigh) in bandCore. This
// replaces the old active5m (both-sided-in-the-same-5m) gate that structurally culled big tickets.
// --min-traded is the flag; --min-active is kept as a back-compat alias for the same knob.
const MIN_TRADED = A['min-traded'] != null ? +A['min-traded'] : (A['min-active'] != null ? +A['min-active'] : 6);
const STATS = !!A.stats;
// --- value niche: deployable-capital inputs (Ben 2026-07-09). The per-position capital cap that bounds
// valueScore's deployable-units is NOT a fixed constant — it's Ben's current capital ÷ how many positions
// (slots) we'd spread it across. --capital <gp> is the input (his real bankroll); --slots N is how many
// concurrent value holds to size for (≈ the count of quality candidates). VALUE_CAP_GP = capital ÷ slots.
// The default is no longer a bare 100m placeholder: absent --capital we DERIVE the deployable pool from
// the cash anchor + log flow (lib/cashderive.mjs deployablePool = the free coin stack PLUS the escrow of
// DEEP/reclaimable resting bids — NOT liquidCapital, which would over-count a near-live flip bid you
// expect to fill as freely redeployable into a multi-week value hold). We fall back to the 100m
// placeholder only when no anchor is set. The eager figure here has NO market reference (so a resting bid
// classifies COMMITTED → deployablePool == availableCash, the conservative floor); main() RE-DERIVES it
// with a marketRef built from the bulk /latest it fetches (zero extra fetch) so deep bids count. The value
// niche always reads the re-derived figure. NOTE (PLAN-CAPITAL-THROUGHPUT, 2026-07-14): the band/churn
// THROUGHPUT_CAP_GP also reads VALUE_CAPITAL — after the re-derive when value runs, else this eager
// CONSERVATIVE (no-marketRef) figure. That's intentional (a smaller pool binds the throughput cap a touch
// harder = more conservative demotion); it is no longer true that the eager value is "never surfaced".
const VALUE_CAPITAL_EXPLICIT = A.capital != null;
let DERIVED_CASH = VALUE_CAPITAL_EXPLICIT ? null : loadDerivedCash();
const VALUE_CAPITAL_DERIVED = !!(DERIVED_CASH && DERIVED_CASH.known);   // derived from the cash anchor (not a placeholder)
let VALUE_CAPITAL = VALUE_CAPITAL_EXPLICIT ? parseGp(A.capital)
  : (VALUE_CAPITAL_DERIVED ? DERIVED_CASH.deployablePool : 100_000_000);
const VALUE_SLOTS = A.slots != null ? Math.max(1, +A.slots) : 5;
let VALUE_CAP_GP = VALUE_CAPITAL / VALUE_SLOTS;
// --- S1 screening economics (gp-flow gate + 500k attention floor) ------------------------------
// GP_FLOOR: the alternative liquidity path. The two-sided gate (hpv>0 && lpv>0 — the ghost-spread
// lesson) is NON-NEGOTIABLE and untouched; but the UNIT floor (--floor 50/d) was the wrong UNIVERSAL
// measure — it hides an Avernic-class big ticket (single-digit units/day yet hundreds of millions of
// gp of real two-sided daily flow, a genuine ~six-figure-net/u edge). An item clears liquidity on
// EITHER limitVol ≥ FLOOR OR limitVol×mid ≥ GP_FLOOR. 250m is picked to admit that profile with margin.
const GP_FLOOR = A['gp-floor'] != null ? parseGp(A['gp-floor']) : 4_500_000_000;   // PLAN-VOL24 step 2: 250m → 4.5b, count-matched (~18×) to the corrected rolling-24h gp-flow (mid×volDay) distribution.
// MIN_NET_GP: the absolute-gp ROI alternative for thin items — a thin big ticket rarely clears the
// percentage --min-roi bar (its spread is a small % of a huge price) but a six-figure net/u is still
// worth one offer, so a thin item passes on modeRoi ≥ MIN_ROI OR modeNet ≥ MIN_NET_GP.
const MIN_NET_GP = A['min-net-gp'] != null ? parseGp(A['min-net-gp']) : 100_000;
// MIN_TRADED_THIN: the DENSITY floor a thin (gp-flow) item's band must show under Bar D — # of windows
// with ANY trade. 2 rejects a literal single-spike band while admitting a big ticket that trades a
// couple+ times in the 2h; the sawLow && sawHigh two-sided check (bandCore) does the rest. Non-thin
// items keep the full MIN_TRADED gate.
const MIN_TRADED_THIN = 2;
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
// --- NY2.1: rising-pool NOISE FLOOR — NOW VESTIGIAL (Steps 3+4, Ben 2026-07-09: the `rising` niche was
// DELETED, and it was the ONLY spec that set pool.risingFloor:true, so this floor no longer fires on any
// shipped niche). The constants + the risingPoolFloor predicate are KEPT so a future re-add of a rising
// niche is a one-flag change, and because the CLI flags/THRESHOLDS still thread them harmlessly. Original
// rationale (kept for that eventual re-add):
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
// PLAN-CAPITAL-THROUGHPUT (Ben 2026-07-14): --throughput capital|legacy toggles the capital-aware
// expGpDay (default capital). THROUGHPUT_CAP_GP is set from the DERIVED deployablePool after main()
// re-derives the cash anchor (below); the build-time default is the pre-derive VALUE_CAPITAL (which is
// itself the derived pool unless --capital was passed). 'legacy' or a null pool → capital-blind expGpDay.
const THROUGHPUT_MODE = (A.throughput === 'legacy') ? 'legacy' : 'capital';
const THRESHOLDS = {
  FLOOR, MIN_ROI, MIN_PRICE, MAX_PRICE, MIN_NET_GP, MIN_TRADED, MIN_TRADED_THIN, MIN_GPD, GP_FLOOR,
  RISE_MID_FLOOR, RISE_LIQUID_VOL, VALUE_CAP_GP,
  THROUGHPUT_MODE, THROUGHPUT_CAP_GP: THROUGHPUT_MODE === 'legacy' ? null : VALUE_CAPITAL,
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
// PART II safety: uncalibrated --asym prices must never reach screen.json/the app (F1 gates that step).
if (PUBLISH && A.asym === true) { console.error('! --asym is experimental (F1-ungraduated) — refusing --publish under it.'); process.exit(1); }
// --- Part B (opt-in): basing-rescue. OFF by default → default output is byte-identical (the only
// default change is Part A's display annotation, which only APPENDS phase text to an existing Regime
// cell — it never changes which rows are selected/excluded). When ON, an item the falling-exclusion
// would normally DROP but whose phase()==='basing' (decayed off a spike, lows flattened) is instead
// SURFACED, capped to PHASE_BASING_GRADE_CAP and flagged provisional. Conservative, gated trial —
// thresholds are unvalidated placeholders. capGrade is reused from rating.mjs (no rating.mjs change).
const PHASE_RESCUE = A['phase-rescue'] === true;
const PHASE_BASING_GRADE_CAP = 'B';   // named ceiling for a provisional basing-rescue surface
// --- PART II (PLAN-GRADE-REACH, opt-in): --asym flips the 'asym'-fillShape niches (band/scalp) to the
// asymmetric deep-buy/reliable-sell objective AS THE QUOTED PRICES AND SORT — optBuy→the flush bid,
// optSell→the high-reach ask (min/max ordering guards in asymEstimate), rank = net × P_ask ÷ TTF.
// OFF BY DEFAULT and F1-GATED: the quantiles (ASYM_P_LO/ASYM_P_HI) are n≈14 PLACEHOLDERS, so the
// DEFAULT table stays byte-identical (the asym read ships only as the inform line + the shadow
// suggestions.jsonl `asym` field until the shadow A/B graduates it). --publish is refused under --asym
// so uncalibrated prices can never reach screen.json/the app. Estimate/render-stage only — the pinned
// gateCandidates→rankAndSlice→surviveMode funnel (replay goldens) is untouched either way.
const ASYM = A.asym === true;
// --- PLAN-VOL24 (2026-07-13): --vol-source rolling|legacy. The wiki /24h endpoint is BROKEN (it serves a
// frozen ~1–3h slice of a stale UTC day, under-reporting the true rolling 24h ~10–27× — see PLAN-VOL24.md).
// The DEFAULT is now `rolling` (step 2, Ben-validated): the corrected trailing-24h volume composed from the
// healthy /1h grain (loadAll24hRolling — 24 bulk /1h windows, mostly warm from the SQLite 1h archive) is the
// ACTIVE volDay behind every gate/rank/column, and the volume-denominated floors (FLOOR/GP_FLOOR/VALUE_LIQ_
// FLOOR/CHURN_MIN_VOL/DIP_LOOP_LIQUID_FLOOR/DL4_MIN_GP_FLOW) were count-matched to the corrected distribution
// in the same change. `--vol-source legacy` restores the broken /24h value (kept as an escape hatch / for
// reproducing pre-recal output). Every published row also logs the corrected per-item volume as the lean
// `volDayRolling` shadow field regardless of this flag (from the in-hand 1h series → no new fetch).
// NOTE: MIN_GPD (the 500k gp/day ATTENTION floor) was deliberately KEPT at 500k (Ben's call) — it is a
// real-world NET-throughput quantity, so 500k of TRUE throughput is the honest floor; it now admits more.
const VOL_SOURCE = A['vol-source'] != null && A['vol-source'] !== true ? String(A['vol-source']).toLowerCase() : 'rolling';
if (!['legacy', 'rolling'].includes(VOL_SOURCE)) { console.error(`! unknown --vol-source "${A['vol-source']}". Use rolling (default) or legacy.`); process.exit(1); }
// --- PLAN-OUTPUT-TABLE (2026-07-13): the DEFAULT niche-table stdout view is the reconciliation-
// estimator pair — Est. buy / Est. sell / Net/u (ROI) / BE with confidence riding in the price cells
// (js/estimators.mjs estimatePair — reach-folded, BE-floored, PLACEHOLDER model n≈14). `--raw`
// restores the model-free Quick + Optimistic columns (the honest arithmetic underneath). --asym
// IMPLIES --raw: under --asym the QUOTED Quick/Optimistic prices ARE the experimental asym pair, so
// the raw view is the one that shows them (blending two experimental reprices in one cell would be
// unreadable; the est pair is still computed off the DEFAULT row + logged for F1 either way).
// STDOUT-ONLY: the --publish screen.json cells are built from the SAME raw stdCells path as before,
// byte-identical regardless of this flag — the app contract is untouched (no APP_VERSION bump).
const RAW = A.raw === true || ASYM;
// PART II asym-pair read parameters: full-local-day window (wStart 0 → wEnd 0 wraps to all 24h — the
// day-level deep-low/high-reach read, distinct from reachValidator's coming-8h window) over ~14 nights.
const ASYM_NIGHTS = 14;
// snapshot of the run params logged with each suggestion (O1) — mirrors the --publish payload's params
const SCREEN_PARAMS = { floor: FLOOR, gpFloor: GP_FLOOR, minRoi: MIN_ROI, minNetGp: MIN_NET_GP, minGpd: MIN_GPD, minPrice: MIN_PRICE, maxPrice: MAX_PRICE, top: TOP, bandHours: BAND_HOURS, minActive: MIN_TRADED, posture: POSTURE, volSource: VOL_SOURCE };

const RUN_MODES = MODE === 'all' ? ALL_MODES : [MODE];   // `all` = band/churn/value (Ben 2026-07-10 added value); scalp explicit-only
const NEED_BANDS = true;   // every remaining niche prices its edge off the 2h band (spread, the one 24h-avg niche, is deleted)
const IS_VALUE = RUN_MODES.includes('value');                    // P5 — the value niche needs the 28d term structure
const N_WIN = Math.max(1, Math.ceil(BAND_HOURS * 3600 / 300));   // 5m windows in the band (confidence denom)
// regime-proxy archive lookback / spacing. P5: value's term structure needs ~28d (§C); extend ONLY when
// value is requested so every other mode (incl. --mode all) keeps the 17d archive byte-identical.
const DAILY_DAYS = IS_VALUE ? 28 : 17, DAILY_STEP_H = 6;
const DAILY_COLD = 10 * 24 / DAILY_STEP_H;                       // < this many windows ⇒ cold archive, degraded proxy
const TS_TTL_5M = 3 * 60 * 1000, TS_TTL_6H = 30 * 60 * 1000;     // per-item series cache TTLs (screen re-fetch avoidance)
const TS_TTL_1H = 15 * 60 * 1000;                                // Leg B (2026-07-09): the 1h series reachValidator scores — fetched for SURVIVORS only
const DIURNAL_NIGHTS = 7;                                        // recent local days the hour-of-day profile aggregates over
// (no top-N cap: the read is FREE — the 1h series is already in hand and the survivor set is already
//  gate-bounded — so it runs on EVERY surfaced pick, same coverage as the Entry-paths block below.)

// P1: the gate stack (`gateCandidates`), the fetch-pool ranker (`rankAndSlice` + `proxyDrift` +
// `softFactor`), the `risingPoolFloor` predicate, and `expUnits` all live in lib/gatecandidates.mjs
// now (imported above). main() passes screen's CLI THRESHOLDS to gateCandidates and { thinReserve,
// top } to rankAndSlice explicitly (the lib defaults to the same values via DEFAULT_THRESHOLDS /
// THIN_RESERVE_DEFAULT / TOP_DEFAULT). expUnits is reused below by roughExpGpDay (the watchlist path).

const PLAYBOOK = {
  band:   'Playbook: ladder BUYS at the band low, SELL at the band top; never list below break-even (tax-capped; shared breakEven).',
  churn:  'Playbook: high-frequency buy-limit-cycle commodities. Thin per-unit, volume does the work — buy every limit, flip fast.',
  scalp:  'Playbook (PROVISIONAL, n≈0): a DELIBERATE intraday flip on a falling market — buy a wide FRESH band edge, sell at today\'s high, HARD intraday stop. Flip-only/no-hold: an unsold lap is a CUT, not a hold. Falling is the thesis, not a veto.',
};
// P6b: the last column is the per-thesis RANK (net × P(fill) ÷ TTF), NOT the demoted `Score gp/d`.
// The app renders screen.json headers generically (only 'Grade' is special-cased in js/ui.js), and
// the headers TRAVEL with the payload, so renaming is app-safe (no APP_VERSION bump).
const HEADERS = ['Item', 'Grade', ...QUOTE_HEADERS.slice(1), 'Rank net·P/ttf'];
// PLAN-OUTPUT-TABLE: the DEFAULT stdout column set — Est. buy/sell REPLACE Quick+Optimistic on the
// printed niche tables only (Grade moves after Regime per the plan's row layout; the Rank column is
// kept — it's the sort key's honesty readout). HEADERS above stays the --raw AND --publish set.
const HEADERS_EST = ['Item', 'Guide', ...EST_HEADERS, 'Vol/d', 'Momentum', 'Regime', 'Grade', 'Rank net·P/ttf'];

const round2 = x => Math.round(x * 100) / 100;   // P6b: pFill logged to 2dp (lean ledger)
// P6b: the compact honest lean fields for a rank estimate `er` (estimateRank result) — the quoted pair
// the thesis posts + the rank components + n/basis so the retro-join can later calibrate estimate-vs-
// realized. Lean-included by suggestionEntry (absent-field rows stay byte-identical — the YS2 pattern).
function estFields(er) {
  return {
    bid: er.pair.bid, ask: er.pair.ask,
    pFill: round2(er.pFill.value), ttfSec: er.ttf.value, rank: Math.round(er.rank),
    estBasis: `${er.pFill.basis}/${er.ttf.basis}`, estN: Math.min(er.pFill.n, er.ttf.n),
  };
}

// PLAN-VOL24 shadow: the CORRECTED trailing-24h volume {hpv,lpv} for one surfaced row, composed from its
// ALREADY-FETCHED 1h series (series1h map) → ZERO new fetch. Logged beside the active legacy volDay for the
// floor-recalibration retro-join. Null (→ lean-omitted) when no 1h series is in hand.
function rollShadow(series1h, id) {
  const rr = rolling24FromTs1h(series1h && series1h.get(id));
  return rr ? { hpv: rr.highPriceVolume, lpv: rr.lowPriceVolume } : null;
}

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
// P6c: `subFloor` (from subFloorFallback, set by main() ONLY when the niche's gated pool was EMPTY at
// the configured floors) switches this render into the honestly-labeled sub-floor fallback: banner names
// the relaxed floor + its value, every grade is capped at SUBFLOOR_GRADE_CAP and suffixed `(sub-floor)`,
// the suggestions-ledger rows carry a lean `subFloor` marker, and NOTHING is published to screen.json
// (the app contract stays byte-identical — a previously-empty niche still publishes []). Everything else
// — validators (reject still DROPS), per-spec falling doctrine, posture — runs UNCHANGED on the fallback
// rows: a sub-floor pass relaxes floors, never doctrine. subFloor==null ⇒ byte-identical to pre-P6c.
function renderMode(mode, { cand, survivors, subFloor = null }, qcache, map, series5m, series6h, series1h, v24, daily, { partition = false } = {}) {
  const rows = [];
  const dist = {};
  const disc = { falling: 0, notRising: 0, breakdown: 0, posture: 0, rescued: 0, reject: 0, caution: 0, negNet: 0, notFalling: 0, partition: 0 };  // post-fetch discard reasons (--stats)
  const rejReasons = {};   // P2: reject reason → count, for the `rejected: N (top reasons)` footer
  const cautionNotes = []; // P2: one flagged-caution note per item (the row still shows)
  const informNotes = [];  // 2026-07-09: inform-mode validator findings (trajectory/reach analysis) — decision support, never a drop
  const headroomNotes = []; // Bar E ask-headroom (PLAN Bar-E-signal): the robust p90 shaved a TRADED in-band top off the quoted ask — sibling inform note, never a gate/drop/grade/screen.json input
  const windowClearNotes = []; // PLAN-WINDOW-CLEAR B2 (churn/scalp): the ask reaches on days but rarely IN its peak window / size ≫ window pool — sibling inform note, never a gate/drop/grade/screen.json input
  const asymNotes = [];     // PART II asym-fill (PLAN-GRADE-REACH): deep-bid → high-reach-ask realizable pair + P_ask/P_bid split — sibling inform note, never a gate/drop/grade/screen.json input
  for (const s of survivors) {
    let row = qcache.get(s.id);   // PART II: reassigned to a repriced CLONE only under --asym (qcache never mutated)
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
    // P2/P3 validators. reachValidator (via the spec plan) scores the patient ask (optSell) against the
    // reach window off the Leg-B 1h series; a SECOND inform-only reach call below scores the patient BID
    // (optBuy) reachability — the 2h band min is an artifact-prone floor and an unreachable bid inflates
    // the grade (2026-07-09 bid-leg fix). P3's
    // floorValidator scores the patient BUY (optBuy) against the durable multi-week floor from the
    // loadDaily {ts,mid} regime-proxy series ALREADY loaded at gate time (daily[id]) — no new fetch.
    // A buy parked well above where the 14/28d structure says support prints (the decay-knife shape) is
    // REJECTED (dropped + counted + footer); a marginally-elevated buy is CAUTIONed (row still shows).
    // A cold/absent daily series degrades to pass (the common case until the archive warms). Explicit
    // asks/held/watchlist are handled on their own surfaces where nothing is ever hidden.
    const ts = termStructure(daily && daily[s.id]);
    const richTraj = trajectoryFrom1h(series1h && series1h.get(s.id));   // warm trajectory off the 1h series while loadDaily is cold
    if (richTraj) ts.trajectory = richTraj;
    // LM1: the buy-limit window for this candidate — limitValidator DISQUALIFIES a suggested buy with
    // no room left in the rolling 4h window (reject → dropped + counted) and CAUTIONs a nearly-spent
    // one. Zero in-window buys ⇒ remaining==limit ⇒ pass (byte-identical). Absent limit ⇒ degrade.
    const limWin = limitWindow({ buys: BUYS_BY_ITEM.get(s.id) || [], limit: map.byId[s.id]?.limit ?? null });
    // DP1: the 24h /24h record (avgLowPrice = the dip-depth reference) — HOISTED above runValidators so
    // both the dip-posture validator ctx and the probe ctx below read the ONE lookup (not computed twice).
    const d24 = v24 && (v24[s.id] || v24[String(s.id)]);
    // Ben 2026-07-09: drive the registry off the THESIS's own validator PLAN (spec.validators — modes +
    // reach horizon), not the whole registry. Leg B feeds the real 1h series now (was null → reach
    // degraded); trajectory reads the term structure's shape classification (no new fetch). Inform-mode
    // validators annotate but never drop (informFlags); only gate-mode caution/reject flag/drop the row.
    const vres = runValidators({
      market: { row },
      history: { termStructure: ts },
      intraday: {
        ts1h: series1h && series1h.get(s.id),
        ts5m: series5m && series5m.get(s.id),                     // DP1: dip-posture reads the 5m direction shape
        avgLow24: d24?.avgLowPrice ?? null,                       // DP1: dip-depth reference (from the hoisted d24)
        reach: row.optSell != null ? { side: 'ask', level: row.optSell } : null,
      },
      floor: { level: row.optBuy != null ? row.optBuy : null },
      limits: { window: limWin },
    }, { specs: STRATEGIES[mode].validators });
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
    // inform-mode findings (the analysis that WOULD have gated under a stricter thesis) — surfaced as a
    // decision-support note, never a drop. This is where the trajectory/reach read lands on a surfaced row.
    // Bid-leg reach (2026-07-09): the spec's `reach` validator scores only the ASK (optSell); the
    // optimistic BID is the 2h band min, so a single artifact-low 5m print (touched 0/Nd) inflates the
    // grade off an UNREACHABLE buy with no warning (the Primordial-boots S- catch — estimateRank prices
    // optBuy→optSell). Score the bid leg the same INFORM way (mirrors renderValueMode's side:'bid' call),
    // reusing the 1h series already fetched for the ask reach — zero new fetch, never drops a row.
    let bidReach = [];
    // Step 1 (2026-07-09): the BID-side reach also FEEDS the rank estimate's P(fill). estimateRank's
    // intraday estimator prefers a real reach read (reach.reachedDays/nDays) over the band-depth prior;
    // before this it was called with no extra, so P(fill) fell to a ~uniform 0.50 band-depth number.
    // P(fill) here is a BID-FILL probability → it MUST use the bid-side reach (bidRes, optBuy), NOT the
    // ask-side spec-plan reach (vres, optSell). NOTE the field remap: estimators reads reach.nDays /
    // reach.reachedDays; the validator emits evidence.days / evidence.hit.
    let reachExtra = null;
    if (row.optBuy != null && series1h && series1h.get(s.id)) {
      const bidRes = runValidators(
        { intraday: { ts1h: series1h.get(s.id), reach: { side: 'bid', level: row.optBuy } } },
        { specs: [{ key: 'reach', mode: 'inform' }] },
      );
      bidReach = informFlags(bidRes);
      const reachRes = bidRes.find(r => r.key === 'reach');
      const ev = reachRes && reachRes.evidence;
      // rev1: carry the RC1 recent-3 counts (evidence.recentHit/recentDays) alongside the full window so
      // estimatePair folds on recent-3 and the confidence token surfaces it.
      reachExtra = (ev && ev.days >= 1) ? { reachedDays: ev.hit, nDays: ev.days, recentHit: ev.recentHit, recentDays: ev.recentDays } : null;
    }
    // reachExtra stays null when the 1h series is absent (the block above is skipped) → estimateRank
    // keeps its honest band-depth/prior degrade (the existing no-fetch contract). Only the ASK-side reach
    // feeds renderValueMode's estimate (proximity-based), so this bid wiring is renderMode-local.
    const informed = [...informFlags(vres), ...bidReach];
    if (informed.length)
      informNotes.push(`${name}: ` + informed.map(f => `${f.key} ${f.reason} (would ${f.gatedStatus})`).join('; '));
    // Bar E ask-headroom (inform-only, PLAN Bar-E-signal): surfaced as a sibling note so Ben ladders the
    // ask up instead of relisting down. NEVER a gate/drop/grade/screen.json input; the lean askHeadroom
    // field is logged to suggestions.jsonl (off row.askHeadroom, in suggestionEntry) for the analyze/F1 join.
    { const ah = askHeadroomText(row); if (ah) headroomNotes.push(`${name}: ${ah}`); }
    // Proposal A (PLAN-GRADE-REACH): the ASK-side reach already scored in `vres` (side:'ask', optSell,
    // line ~379) feeds the rank's TWO-LEG P — the rank's net silently assumed the exit prints; now a
    // mirage exit (a p90 band top reaching 2/14 days) discounts P instead of ranking full. Zero new
    // fetch (the number is in hand); field remap mirrors reachExtra (validator emits evidence.hit/days).
    const askReachRes = vres.find(r => r.key === 'reach');
    const askEv = askReachRes && askReachRes.evidence;
    const askReachExtra = (askEv && askEv.days >= 1) ? { reachedDays: askEv.hit, nDays: askEv.days, recentHit: askEv.recentHit, recentDays: askEv.recentDays } : null;
    // PART II (PLAN-GRADE-REACH §II.1-II.3): the ASYMMETRIC realizable pair — deep flush bid → high-reach
    // ask off the day-level quantiles (js/windowread.mjs asymPair, full-day window, ~14 nights) of the 1h
    // series ALREADY in hand (zero new fetch). 'asym'-fillShape niches only (band/scalp — churn fills
    // every lap, value prices its own term pair). By DEFAULT this is inform+shadow ONLY: an `◆ asym fill`
    // note (same pattern as askHeadroom/diurnal — never a gate/drop/grade/screen.json input) + the lean
    // `asym` field on suggestions.jsonl beside the symmetric rank (the F1 shadow A/B). P_bid is surfaced
    // as "rest it as optionality", NEVER a rank multiplier (asymEstimate header is the doctrine home).
    let asymRead = null, asymEr = null;
    if (STRATEGIES[mode].fillShape === 'asym' && series1h && series1h.get(s.id)) {
      const st = windowStats(series1h.get(s.id), { nights: ASYM_NIGHTS, wStart: 0, wEnd: 0 });
      asymRead = st ? asymPair(st) : null;
      if (asymRead) asymEr = asymEstimate(STRATEGIES[mode], row, asymRead);
    }
    // PLAN-OUTPUT-TABLE: the diurnal profile + the reconciliation estimate (Est. buy/sell) — computed
    // off the DEFAULT row (before any --asym reprice) from data ALREADY in hand (the Leg-B 1h series,
    // the bid/ask reach reads above) — zero new fetch. prof/dr are stored on the row and REUSED by the
    // Diurnal timing block below (same pure math, computed once). The est pair is logged to the
    // suggestions ledger unconditionally (the F1 accrual) and rendered as the DEFAULT table columns
    // (--raw restores Quick/Optimistic); it never touches the published screen.json cells.
    const prof = hourProfile(series1h && series1h.get(s.id), { nights: DIURNAL_NIGHTS });
    const dr = prof ? deriveDiurnalRange(prof, { liveLo: row.quickBuy ?? null, liveHi: row.quickSell ?? null }) : null;
    // rev2: strategy-aware entry (estimatePair reads STRATEGY[mode]'s falling/priceBasis doctrine).
    // FIX 1 (2026-07-13): declared-exit anchoring is DELIBERATELY NOT applied on the discovery screen —
    // a bare candidate row is a "should I buy this" read, never a held lot, so a declared SELL exit
    // (a held-lot plan) must not inflate its Est. sell/net. Declared-exit anchoring lives ONLY on the
    // held-lot surfaces (quote.mjs --positions/watch.mjs verdict frame, and quote.mjs per-item ONLY when
    // that id is actually held). So no declaredExit is passed here.
    // PLAN-LIQUIDITY-REACH: dayHigh = the observed trailing-24h 5m-bucket max off the SAME in-hand 5m
    // series (zero new fetch) — Part B's de-bias reference. estimatePair applies it (and the Part-A fold
    // softening) ONLY when reachRelief > 0 (liquid book, small limit÷flow); a thin book is byte-identical.
    const est = estimatePair(STRATEGIES[mode], row, {
      bidReach: reachExtra, askReach: askReachExtra,
      diurnal: dr ? { bid: dr.bid, ask: dr.ask } : null,
      asym: asymRead,
      dayHigh: dayHighFrom5m(series5m && series5m.get(s.id)),
    }, { nudge: anchorNudge });
    // PLAN-WINDOW-CLEAR B2 (churn/scalp only): does the quoted ask PRINT inside its diurnal peak window
    // (not just on N/M DAYS), and does that window absorb a buy-limit tranche? Inform-only (the askHeadroom/
    // asym pattern — never a gate/drop/grade/screen.json input); a divergence is the days-reach ≠ lap-clear
    // trap. Zero new fetch (reuses dr + the in-hand 1h series + the all-day askReach). A lean `winClear`
    // rides suggestions.jsonl for the F1 join. Placeholders (n≈0).
    let winClear = null;
    if ((mode === 'churn' || mode === 'scalp') && dr && dr.peakWindow && row.optSell != null && series1h && series1h.get(s.id)) {
      const wc = windowClear(series1h.get(s.id), { ask: row.optSell, units: s.limit ?? null, wStart: dr.peakWindow.startH, wEnd: dr.peakWindow.endH, nights: 14 });
      const dayFrac = askReachExtra && askReachExtra.nDays ? askReachExtra.reachedDays / askReachExtra.nDays : null;
      const div = windowClearDiverges(wc, dayFrac);
      // NOTE fires on the WINDOW-REACH divergence only (the clean days-reach ≠ lap-clear signal). The
      // sizeShort leg is DELIBERATELY not surfaced yet: churn's peak window is often a narrow 1–2h slice
      // and a lap sells into a CONTINUOUS two-sided book, so the peak-window absorption pool mis-reads size
      // (PLAN-WINDOW-CLEAR open question). clearRatio/diverges still ride the shadow field for F1 to settle it.
      if (wc && div.windowShort) {
        const dayTxt = dayFrac != null ? ` vs ${askReachExtra.reachedDays}/${askReachExtra.nDays} all-day` : '';
        windowClearNotes.push(`${name}: ask ${fmt(row.optSell)} prints ${wc.reachedDays}/${wc.nDays} in the ${fmtHour(dr.peakWindow.startH)}–${fmtHour(dr.peakWindow.endH)} peak window${dayTxt}`);
      }
      if (wc) winClear = { windowReach: wc.windowReach, reachedDays: wc.reachedDays, nDays: wc.nDays, pool: wc.pool, clearRatio: wc.clearRatio, wStart: wc.wStart, wEnd: wc.wEnd, diverges: div.diverges };
    }
    // PLAN-LIQUIDITY-REACH stdout note (inform-only — never a gate/drop/grade/screen.json input): when
    // the liquidity/size relief changed the Est. sell, say so beside the reach note it counterweights,
    // instead of letting the raw reach caution discourage a viable top ask on a liquid small-size book.
    if (est && est.confidence.relief) {
      const rl = est.confidence.relief;
      informNotes.push(`${name}: reach-relief — liquid book (${fmt(row.volDay)}/d, buy limit ~${(rl.sizeRatio * 100).toFixed(1)}% of flow) softens the ask-reach fold ${Math.round(rl.relief * 100)}%${rl.debiasedTop != null ? `; top de-biased to ${fmt(rl.debiasedTop)} (≤ observed 24h high)` : ''} (PLACEHOLDER, n=1)`);
    }
    // --asym (F1-GATED, off by default): the asym pair BECOMES the quoted prices — a repriced CLONE
    // (ordering guards already applied by asymEstimate; qcache and the raw momentum tell untouched).
    if (ASYM && asymEr) row = { ...row, optBuy: asymEr.bid, optSell: asymEr.ask, optNet: asymEr.net };
    // P6b: the per-thesis RANK at the thesis's OWN quoted pair (spec.priceBasis) — net, P(fill), TTF all
    // evaluated at that same pair. reach = the BID-fill prob (entry); askReach = the two-leg exit discount.
    let er = estimateRank(STRATEGIES[mode], row, { reach: reachExtra, askReach: askReachExtra });
    // --asym sort flip: rank = net(asym pair) × P_ask ÷ TTF — P_ask is the ONLY fill weight (§II.1; the
    // bid-reach P and the Part-I ask-reach discount both step aside), and r.score/sort follow the rank.
    if (ASYM && asymEr) er = { ...er, pFill: { value: asymEr.pAsk, n: asymRead.nDays, basis: 'ask-reach-asym' }, rank: rankScore({ net: er.net * er.lapUnits, pFill: asymEr.pAsk, ttfSec: er.ttf.value }) };
    // the ◆ asym fill inform line (one line per item — the compact-output rule). Shows the realizable
    // asymmetric pair + both reach fractions; the deep bid is FREE OPTIONALITY (rest it, expect ~pBid×n
    // fills), the ask is the near-certain exit. Under --asym these ARE the quoted numbers (say so).
    if (asymEr) {
      const nD = asymRead.nDays;
      const hB = Math.round(asymEr.pBid * nD), hA = Math.round(asymEr.pAsk * nD);
      const roi = asymEr.bid > 0 ? (asymEr.net / asymEr.bid * 100).toFixed(1) : null;
      asymNotes.push(`${name}: deep-bid ${fmt(asymEr.bid)} (fills ~${hB}/${nD}d — rest as optionality) → ask ${fmt(asymEr.ask)} (prints ~${hA}/${nD}d) · net ${fmt(asymEr.net)}/u${roi != null ? ` (${roi}%)` : ''} · asym-rank ${fmtP(Math.round(asymEr.rank))}${ASYM ? ' — QUOTED (--asym)' : ''}`);
    }
    // Step 2 (2026-07-09): a RENDER-stage net>0 surface gate. er.net is the after-tax net at the thesis's
    // OWN posted price pair (spec.priceBasis; the BOND 10%-guide-retrade exception rides through via
    // netMargin). A non-positive net means the thesis can't make money at the pair it would post — a bond
    // whose retrade fee eats the spread, a spread niche's 24h-avg pair underwater after tax, a ZGS-style
    // ROI-bind. Drop it silently (counted in --stats). This is a RENDER drop, NOT a gate/survive stage, so
    // the pinned gateCandidates→rankAndSlice→surviveMode funnel + the replay goldens are unaffected.
    // Held/asked/watchlist rows never reach renderMode (their surfaces never hide), so they're auto-exempt.
    if (er.net <= 0) { disc.negNet++; continue; }
    // Step 6a (Ben 2026-07-09): partition churn from band in --mode all so they don't show identical
    // rows. band is the PER-UNIT lane — its gate already requires ROI ≥ MIN_ROI; churn is the VOLUME /
    // low-margin lane. When BOTH run, drop from churn any row whose after-tax per-unit ROI (at the same
    // opt pair the rank uses) clears MIN_ROI — band surfaces those, so churn keeps only the sub-MIN_ROI
    // high-volume commodities. Disjoint by margin, ZERO loss (band's gate never showed a sub-MIN_ROI row).
    // Render-stage + --mode-all-only (the `partition` flag) → standalone --mode churn is unchanged and the
    // gate-stage replay goldens are unaffected.
    if (partition && er.pair.bid > 0 && (er.net / er.pair.bid * 100) >= MIN_ROI) { disc.partition++; continue; }
    const r = rateItem({ row, rank: er.rank, activeWin: s.activeWin, nWin: s.activeWin != null ? N_WIN : null, thin: s.thin });
    // Part B: a rescued basing faller is capped to PHASE_BASING_GRADE_CAP (reuses rating.mjs capGrade)
    // — a provisional surface must not advertise a headline grade off a still-declining regime.
    // P6c: a sub-floor fallback row is capped harder still (SUBFLOOR_GRADE_CAP) — it did NOT clear the
    // configured floors, so it must never print a grade a qualified row could.
    let grade = rescued ? capGrade(r.grade, PHASE_BASING_GRADE_CAP) : r.grade;
    if (subFloor) grade = capGrade(grade, SUBFLOOR_GRADE_CAP);
    // Proposal B (PLAN-GRADE-REACH): a mirage exit can't advertise a headline letter. When the quoted ASK
    // reaches < REACH_GRADE_CAP_FRAC of recent days, cap the grade (Proposal A already shrank the rank
    // number; this guarantees the LETTER an operator reads can't oversell it). Same capGrade site as above.
    // PART II churn exemption: a 'symmetric'-fillShape niche (churn) is exempt — its lap exit sells into
    // continuous two-sided flow, so the day-high reach read mismeasures it (mirrors estimateRank's askF skip).
    if (STRATEGIES[mode].fillShape !== 'symmetric' && askReachExtra && (askReachExtra.reachedDays / askReachExtra.nDays) < REACH_GRADE_CAP_FRAC)
      grade = capGrade(grade, REACH_GRADE_CAP);
    const std = stdCells(name, row);                        // structured cells: [item, guide, quick, optimistic, vol, momentum, regime]
    // Part A: fold an informative phase into the existing Regime cell (no new column — the canonical
    // width/contract is untouched). A rescued row gets an explicit provisional note; other spike/decay/
    // basing rows get a ` · <phase>` suffix; base/unknown add nothing. Mutates only this call's fresh
    // std copy (quoteCells returns a new array each call) — the shared `row` model is not touched.
    const rc = std[std.length - 1];
    if (rescued) rc.t = rc.t + ' · basing after decay — provisional';
    else if (ph.phase === 'spike' || ph.phase === 'decay' || ph.phase === 'basing') rc.t = rc.t + ' · ' + ph.phase;
    // insert Grade after Item, append the Rank net·P/ttf cell — both structured {t} so the app publish path is
    // uniform (Grade rendered as a pill app-side by header name; Score right-aligned num). A thin
    // (gp-flow-only) row carries a `title` on the Grade cell — the honesty tooltip (rendered app-side;
    // cellText ignores it so stdout stays clean). `row`/`grade` kept on the pushed object — the O1
    // suggestions ledger reads them below.
    const gradeCell = rescued
      ? { t: grade, title: 'basing after decay — provisional (falling-exclusion overridden by --phase-rescue); grade capped at ' + PHASE_BASING_GRADE_CAP }
      : s.thin
        ? { t: grade, title: `thin: ~${s.limitVol}/day two-sided — size in units, expect slow fills` }
        : { t: grade };
    // P6c: every sub-floor row carries the label ON THE ROW (not just the banner) — grade prints as
    // `C (sub-floor)` so a copied/quoted row can never pass for a qualified one. (These rows are never
    // published, so the title is stdout-inert, but it keeps the cell honest if that ever changes.)
    if (subFloor) { gradeCell.t = grade + ' (sub-floor)'; gradeCell.title = subFloorLabel(subFloor) + (gradeCell.title ? '; ' + gradeCell.title : `; grade capped at ${SUBFLOOR_GRADE_CAP}`); }
    // P6b: the last cell is the risk-adjusted per-thesis rank + its honest components (net · P~ · ttf~)
    // instead of the demoted `Score gp/d`. The numeric r.score (risk-adjusted rank) is the sort key.
    const rankCell = { t: `${fmtP(r.score)} · net ${fmt(er.net || 0)} P~${er.pFill.value.toFixed(2)} ttf~${fmtTtf(er.ttf.value)}`, c: 'mini' };
    const cells = [std[0], gradeCell, ...std.slice(1), rankCell];
    // PM1: run the loaded probes over this row. OUTPUT-ONLY — a probe reads the row/ctx and returns a
    // display tag (observe) or an advisory price nudge (price); it NEVER touched `grade`/`r`/the cells
    // above (all already computed). ctx carries the 24h avg (dip), the phase trajectory (froth), the
    // whole-market map (decant siblings) and an advisory ask price (anchor). Empty when no probe fired.
    // (d24 was hoisted above the runValidators call so dip-posture + the probe share the one lookup.)
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
    rows.push({ id: s.id, row, grade, cells, score: r.score, er, asymEr, probeStr, validators: leanValidators(vres), pathWeighed, est, prof, dr, expGpDay: s.expGpDay, expGpDayLegacy: s.expGpDayLegacy, winClear });
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
  // P6c: sub-floor rows ARE logged (a surfaced row Ben acts on must stay joinable to its fill for the
  // F1 calibration), but each carries a lean `subFloor: <'min-gpd'|'liquidity'>` marker (the YS2
  // absent-field pattern — normal rows stay byte-identical) so calibration can segment or exclude them
  // and a ledger reader can never mistake one for a floor-qualified suggestion.
  logSuggestions('screen', { mode, params: SCREEN_PARAMS },
    rows.map(r => suggestionEntry(r.row, { itemId: r.id, cls: liqClass(r.row), volSrc: 'bulk', verdict: r.grade, grade: r.grade, posture: POSTURE, validators: r.validators, path: defaultPath, subFloor: subFloor ? subFloor.relaxed : null, ...estFields(r.er),
      // PART II shadow field: the asymmetric estimate BESIDE the symmetric rank (same row → the F1 A/B join)
      asym: r.asymEr ? { bid: r.asymEr.bid, ask: r.asymEr.ask, pAsk: round2(r.asymEr.pAsk), pBid: round2(r.asymEr.pBid), n: r.asymEr.nDays, rank: Math.round(r.asymEr.rank) } : null,
      // PLAN-OUTPUT-TABLE shadow pair: the reconciliation estimate the DEFAULT table renders (F1 scores estSell vs the realized sell)
      estBuy: r.est ? r.est.estBuy : null, estSell: r.est ? r.est.estSell : null, estConfidence: estConfLean(r.est),
      // PLAN-VOL24 shadow: the corrected /1h-composed trailing-24h volume beside the active (broken) /24h volDay
      volDayRolling: rollShadow(series1h, r.id),   // SF-3: screen's volDay is bulk /24h (v24) → volSrc 'bulk'. AZ-forward: grade = the rendered letter (verdict keeps it too — legacy readers)
      // PLAN-CAPITAL-THROUGHPUT shadow pair: the ACTIVE (capital-aware, default) expGpDay + the legacy
      // capital-blind expGpDayLegacy, so --stats/analyze/F1 can diff old-vs-new surfacing on real rows.
      expGpDay: r.expGpDay, expGpDayLegacy: r.expGpDayLegacy,
      // PLAN-WINDOW-CLEAR B2 shadow: the within-window clear read (churn/scalp; null elsewhere)
      winClear: r.winClear })));

  // P5: the falling note is per-spec — a 'accept' niche (scalp) deliberately INCLUDES fallers.
  const fallNote = STRATEGIES[mode].falling === 'accept' ? 'fallers INCLUDED (the thesis)' : 'fallers excluded';
  // P6c: the sub-floor banner replaces the normal header line — it states up front that ZERO candidates
  // cleared the configured floors, WHICH floor was relaxed and its value, the cap, and that these rows
  // are NOT qualified. The bar was re-run beneath the floor, never silently lowered.
  if (subFloor) {
    console.log(`## ${mode.toUpperCase()} — SUB-FLOOR FALLBACK — 0 candidates cleared the configured floors`);
    console.log(`⚠ ${subFloorLabel(subFloor)}. Best ${SUBFLOOR_TOP} max, grades capped at ${SUBFLOOR_GRADE_CAP} — these rows did NOT qualify.`);
    console.log(`(${rows.length} rated from ${cand.length} sub-floor gated, top ${survivors.length} fetched; ${fallNote})`);
  } else {
    console.log(`## ${mode.toUpperCase()} — ${rows.length} rated (from ${cand.length} gated, top ${survivors.length} fetched; ${fallNote})`);
  }
  console.log(PLAYBOOK[mode]);
  console.log(`(band basis: ${BAND_HOURS}h, ≥${MIN_TRADED} traded windows any-side + two-sided; thin ≥${MIN_TRADED_THIN})`);
  // PM1: the dedicated `Probes` column is appended to the PRINTED table ONLY when at least one row
  // fired a probe — so with no module present (or none firing) the table is BYTE-IDENTICAL to pre-PM1
  // (the removability guarantee). It is deliberately NOT added to the published cells (screen.json /
  // the app render) — an app Probes column is a separate, APP_VERSION-bumping step (out of PM1 scope).
  const anyProbe = rows.some(r => r.probeStr);
  // PLAN-OUTPUT-TABLE: the DEFAULT print is the reconciliation-estimate view (Est. buy/sell replace
  // Quick+Optimistic; Grade moves after Regime); --raw (and --asym, which implies it) prints the
  // model-free view exactly as before. STDOUT-ONLY: r.cells (the raw layout) is what --publish ships
  // to screen.json either way, so the app contract is byte-identical regardless of the view.
  if (RAW) {
    const printHeaders = anyProbe ? [...HEADERS, 'Probes'] : HEADERS;
    const printCells = anyProbe ? rows.map(r => [...r.cells, { t: r.probeStr, c: 'mini' }]) : rows.map(r => r.cells);
    console.log(rows.length ? mdTable(printHeaders, printCells) : '_none_');
  } else {
    const printHeaders = anyProbe ? [...HEADERS_EST, 'Probes'] : HEADERS_EST;
    // r.cells layout: [item, grade, guide, quick, opt, vol, mom, regime, rank] — reuse the shared
    // structured cells (phase-suffixed regime, sub-floor grade label) and swap in the est pair cells.
    const printCells = rows.map(r => {
      const c = r.cells;
      const base = [c[0], c[2], ...estPairCells(r.est), c[5], c[6], c[7], c[1], c[8]];
      return anyProbe ? [...base, { t: r.probeStr, c: 'mini' }] : base;
    });
    console.log(rows.length ? mdTable(printHeaders, printCells) : '_none_');
    if (rows.length) console.log(`(Est. buy/sell are ESTIMATES — strategy-aware entry (scalp near-live · value trough · band reach-folded), reach-folded exit, PLACEHOLDER model n≈3–14. Confidence rides in the cell as the RECENT-3 reach (e.g. 0/3), full window beside it only when they diverge (0/3 · 12/14 = stale); '–' = no read. This is a DISCOVERY screen — no held-lot declared-exit anchoring here. BE is model-free and floors Est. sell — a "(BE-floored)" ask means no profitable trade at model prices. --raw restores the model-free Quick/Optimistic columns.)`);
  }
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
  for (const n of informNotes) console.log(`ℹ trajectory/reach — ${n}`);
  for (const n of headroomNotes) console.log(`⤴ ask headroom — ${n}`);
  for (const n of windowClearNotes) console.log(`ℹ window-clear — ${n} — days-reach ≠ lap-clear (placeholder, n≈0)`);
  // PART II: the asym-fill inform block — decision support only (P_bid = optionality annotation, never a
  // rank input by default; placeholder quantiles n≈14; the shadow `asym` ledger field is the F1 A/B data).
  for (const n of asymNotes) console.log(`◆ asym fill — ${n}`);
  // Diurnal timing (2026-07-09) — the peak-timing read auto-run on the top surfaced picks. FREE: the 1h
  // series is already in hand (Leg B fetched it per survivor), so this adds NO fetch. For each top pick it
  // derives the stale-guarded bid (dip-window level, priced to LIVE when a dominating trend erases the dip
  // — the Ghrazi lesson) and the ask (peak-window level) via the shared js/windowread.mjs engine — the
  // same one `windowrange --profile` uses, so the numbers match. Decision SUPPORT / stdout-only, never in
  // screen.json. This is the encoded form of the per-pick windowrange dance the pricing doctrine required;
  // a CLEAN pick (concentrated, trend-quiet, positive after-tax swing) is flagged as a diurnal candidate.
  const diurnalLines = [];
  for (const r of rows) {
    // PLAN-OUTPUT-TABLE: prof/dr were computed once in the loop above (same pure math, same inputs)
    // and stored on the row — reused here instead of recomputing.
    const prof = r.prof;
    if (!prof) continue;
    const dr = r.dr;
    if (!dr) continue;
    const nm = map.byId[r.id]?.name || ('#' + r.id);
    const win = w => `${fmtHour(w.startH)}–${fmtHour(w.endH)}`;
    // after-tax swing at the derived pair — the honest edge; a positive, non-trend-dominated, concentrated
    // read is a diurnal candidate (★). tax() nets the ask; bond exemption not modelled here (support line).
    const net = (dr.bid != null && dr.ask != null) ? Math.round(dr.ask - tax(dr.ask) - dr.bid) : null;
    const roi = (net != null && dr.bid) ? net / dr.bid * 100 : null;
    const concentrated = dr.dipWindow.startH !== dr.dipWindow.endH && dr.peakWindow.startH !== dr.peakWindow.endH;
    const candidate = net != null && net > 0 && !prof.trendDominates && concentrated && roi != null && roi >= MIN_ROI;
    const trend = prof.trendDominates ? ' ⚠ trend-dominates → bid to live' : '';
    const edge = net != null ? ` · ~${fmt(net)}/u (${roi.toFixed(1)}%)` : '';
    diurnalLines.push(`${candidate ? '★ ' : ''}${nm} — BID ${fmt(dr.bid)} (${dr.bidBasis}, dip ${win(dr.dipWindow)}) · ASK ${fmt(dr.ask)} (peak ${win(dr.peakWindow)})${edge}${trend}`);
  }
  if (diurnalLines.length) {
    console.log(`Diurnal timing (peak-timing bid/ask off the in-hand 1h series — support, not a gate; ★ = clean diurnal candidate):`);
    for (const l of diurnalLines) console.log(`  ↳ ${l}`);
  }
  // COD-2 (2026-07-10) — the OVERNIGHT accumulation-and-capital table. Encoded from /overnight §6's
  // hand-computed sizing (the prose formula min(buyLimit×2, 8/24×0.10×volDay), now the shared
  // expUnitsOvernight so its constants can't drift from screen's expUnits). Ben's exact ask: "how many
  // can I accumulate in 8h and how much capital does that require." Prints ONLY under --posture overnight
  // (the surfaced rows are already the overnight-filtered set), top-down by the overnight sort with a
  // running capital subtotal so Ben takes lines until his stated capital runs out. Each line binds the
  // bid to the assumed SELL price (never leave the sell side implicit) and its after-tax net/u + total.
  // stdout-only (never in screen.json). Up-to units is an UPPER BOUND (assumes fills at your price;
  // prorates daily volume flat across the quiet hours, no fill probability) — labeled "up to" + the note.
  if (POSTURE === 'overnight' && rows.length) {
    const accHeaders = ['#', 'Item', 'Bid', 'Ask (sell)', 'Up-to units/8h', 'Capital', 'Cum capital', 'Net/u', 'Total if cycled'];
    const accCells = [];
    let cum = 0;
    rows.forEach((r, i) => {
      const bid = r.row.optBuy, ask = r.row.optSell, netU = r.row.optNet;
      const units = bid != null ? Math.floor(expUnitsOvernight(r.row.limit, r.row.volDay)) : null;
      const capital = (units != null && bid != null) ? units * bid : null;
      if (capital != null) cum += capital;
      const total = (units != null && netU != null) ? units * netU : null;
      accCells.push([
        { t: String(i + 1) },
        { t: map.byId[r.id]?.name || ('#' + r.id) },
        { t: bid != null ? fmtP(bid) : '—' },
        { t: ask != null ? fmtP(ask) : '—' },
        { t: units != null ? `up to ${fmt(units)}` : '—', c: 'mini' },
        { t: capital != null ? fmtP(capital) : '—' },
        { t: fmtP(cum), c: 'mini' },
        { t: netU != null ? (netU >= 0 ? '+' : '') + fmtP(netU) : '—', c: netU != null && netU >= 0 ? 'gain' : 'loss' },
        { t: total != null ? (total >= 0 ? '+' : '') + fmtP(total) : '—' },
      ]);
    });
    console.log(`Overnight accumulation & capital (~${OVERNIGHT_SPAN_H}h span; bid→sell + up-to units + running capital — take lines top-down until your stated capital runs out):`);
    console.log(mdTable(accHeaders, accCells));
    console.log(`(Up-to units = min(buy limit × 2, 8/24 × 10% × Vol/d) — an UPPER BOUND: assumes fills at your bid, prorates daily volume flat across the quiet hours, prices in no fill probability. Pair it with the fill-realism / Diurnal read above. Sell never below break-even.)`);
  }
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
    const reasons = `falling ${disc.falling}` + (mode === 'scalp' ? `, not-falling ${disc.notFalling}` : '') + (partition ? `, band-lane partition ${disc.partition}` : '') + (POSTURE === 'overnight' ? `, posture ${disc.posture}` : '') + (PHASE_RESCUE ? `, basing-rescued ${disc.rescued}` : '') + `, validator-reject ${disc.reject}, validator-caution ${disc.caution}, neg-net ${disc.negNet}`;
    console.log(`stats: gated ${cand.length} | fetched ${fetched} | survivors ${kept} | yield ${fetched ? Math.round(kept / fetched * 100) : 0}% | discarded: ${reasons}`);
  }
  console.log('');
  // publishable rows (sorted-by-grade, byte-identical cells + itemId for the app's deep link).
  // P6c: sub-floor rows are STDOUT-ONLY — publish [] so screen.json/the app see exactly what a
  // pre-P6c empty niche published (byte-identical app contract, no APP_VERSION bump).
  if (subFloor) return [];
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
function renderValueMode({ cand, survivors }, qcache, map, series6h, series1h, guide, daily) {
  const buyNow = [], watch = [];
  const sugg = [];
  const valueInformNotes = [];   // 2026-07-09: value's reach-TIMING + trajectory/amplitude inform notes (never a drop — valueGate still selects)
  // value KEEPS reach as a daily-min TIMING read (Ben 2026-07-09): run ONLY the spec's inform validators
  // here so the note is added WITHOUT re-gating the value table (valueGate already selected these rows).
  const valueInformSpecs = STRATEGIES.value.validators.filter(v => typeof v === 'object' && v.mode === 'inform');
  // trajectory GATES in value (Ben 2026-07-09): a knife DROPS (named in the footer), elevated FLAGS. Scoped
  // to trajectory — the value spec's floor/limit are mode:'gate' too but stay dormant in this console path
  // (their gate home is valueGate + the absent 4h-limit window), so only trajectory is promoted to an
  // active drop here. Spec-driven: the gate fires only because the spec now says trajectory is 'gate'.
  const valueTrajGate = STRATEGIES.value.validators.find(v => typeof v === 'object' && v.key === 'trajectory' && v.mode === 'gate') || null;
  let droppedKnife = 0;   // post-fetch phase() decay-knife drops
  let droppedArtifact = 0;   // post-fetch artifact-low drops (live implausibly below the durable floor)
  const droppedTrajKnife = [];   // trajectory-classified knife drops (named in the §F footer for auditability)
  for (const s of survivors) {
    const row = qcache.get(s.id);
    if (!row) continue;
    const name = map.byId[s.id]?.name || ('#' + s.id);
    const live = row.quickBuy ?? row.mid ?? s.mid;
    // recompute the term structure off the LIVE price (better proximity than the pre-fetch mid) and
    // re-run the value gate WITH the fetched phase() — a decay shape is the knife the pre-fetch
    // term-structure delta may miss (§A "buy the base, never the knife").
    const ts = termStructure(daily && daily[s.id]);
    // value-amplitude ("intraday swings against the recent WEEK") + trajectory read the WARM 1h-derived
    // term structure (Leg B) so BOTH fire NOW while the loadDaily archive is cold — value-amplitude was
    // degrading to no-week-range off the cold lookbacks[7]. `current := live` so its proximity is measured
    // against the live price ("is live near the week low right now?"), not a stale daily mid. valueRanges/
    // valueGate keep the loadDaily proxy (their tuned multi-week basis); this warm structure only feeds the
    // INFORM validators below. Falls back to the loadDaily ts when the 1h series is thin.
    const rich1h = richFrom1h(series1h && series1h.get(s.id));
    const informTs = rich1h ? { ...rich1h, current: live } : ts;
    const vr = valueRanges(ts, live);
    const ph = phase(series6h && series6h.get(s.id));
    const g = valueGate(vr, { phase: ph && ph.phase });
    if (!g.pass) { if (g.reason === 'decay') droppedKnife++; else if (g.reason === 'artifact-low') droppedArtifact++; continue; }
    // trajectory GATE (value only): a KNIFE drops here (named in the footer) before it can rank in buy-now
    // — the encoded "buy the base, not the knife" gate, catching the shapes valueGate's knifeDelta misses.
    // Runs on the SAME warm 1h-derived informTs the inform validators use. `elevated` → a caution flag note
    // (timing, not a thesis break); oscillating/based/rising pass through.
    if (valueTrajGate) {
      const tg = runValidators({ market: { row }, history: { termStructure: informTs }, intraday: { ts1h: series1h && series1h.get(s.id) } }, { specs: [valueTrajGate] });
      const rej = tg.find(r => r.status === 'reject');
      if (rej) { droppedTrajKnife.push(name); continue; }
      const caut = tg.find(r => r.status === 'caution');
      if (caut) valueInformNotes.push(`${name}: trajectory ${caut.reason} (flagged)`);
    }
    let tier = valueTier(vr);
    // value's reach as a daily-min TIMING read: is the buy-low actually TOUCHED in the recent week+ (a
    // full-day window over 14 nights, from the spec)? Plus trajectory (oscillating/based/knife) + the
    // recent-week amplitude — all inform, so they annotate the value pick, never re-gate it.
    const vres = runValidators({
      market: { row },
      history: { termStructure: informTs },
      intraday: { ts1h: series1h && series1h.get(s.id), reach: vr.buyLow != null ? { side: 'bid', level: vr.buyLow } : null },
    }, { specs: valueInformSpecs });
    const informed = informFlags(vres);
    if (informed.length) valueInformNotes.push(`${name}: ` + informed.map(f => `${f.key} ${f.reason} (would ${f.gatedStatus})`).join('; '));
    // BUY-NOW / value-amplitude reconciliation (Ben 2026-07-10, Rank 1). The BUY-NOW tier reads proximity
    // off the durable multi-week range (valueRanges, loadDaily); value-amplitude reads it off the recent
    // WEEK (1h-derived). They can disagree, so a "wait for the dip" caution could sit inside BUY-NOW
    // (Extreme energy). If value-amplitude WOULD caution/reject (its inform-clamped gatedStatus), DEMOTE
    // the pick BUY-NOW → WATCH — a tier demotion, NOT a drop (the note still prints), and value-amplitude
    // STAYS mode:inform in the spec. Mirrors trajectory already gating in value: BUY-NOW must satisfy BOTH
    // the durable-floor proximity AND the recent-week-not-elevated read before we call it "buy now".
    const ampGate = (vres.find(r => r.key === 'value-amplitude') || {}).gatedStatus;
    if (tier === 'buy-now' && (ampGate === 'caution' || ampGate === 'reject')) {
      tier = 'watch';
      valueInformNotes.push(`${name}: demoted BUY-NOW → WATCH (value-amplitude would ${ampGate} — live not near the recent-week low)`);
    }
    // RC1 recency anchor: when the durable q15/q85 range spans a prior regime, the cycle was scored on the
    // recent window instead — say so, so the anchored range isn't mistaken for the full multi-week one.
    if (vr.ceilingStale || vr.floorStale) valueInformNotes.push(`${name}: range recency-anchored — durable ${fmtP(vr.rawDurableLow)}→${fmtP(vr.rawDurableHigh)} spans a prior regime; cycle scored on the recent ${fmtP(vr.durableLow)}→${fmtP(vr.durableHigh)}`);
    const netU = Math.round((vr.durableHigh - tax(vr.durableHigh)) - vr.buyLow);
    const ampPct = (vr.afterTaxAmpPct * 100);
    const stabPct = vr.stability != null ? Math.round(vr.stability * 100) : null;
    const phaseTag = (ph && (ph.phase === 'basing' || ph.phase === 'base' || ph.phase === 'spike' || ph.phase === 'decay')) ? ph.phase : 'flat';
    const rangeCell = `${fmtP(vr.durableLow)} → ${fmtP(vr.durableHigh)}`;
    const liveVsLow = vr.liveVsLowPct != null ? `${vr.liveVsLowPct >= 0 ? '+' : ''}${(vr.liveVsLowPct * 100).toFixed(1)}%` : '—';
    const cells = [
      { t: name }, { t: guide && guide[s.id] != null ? fmtP(guide[s.id]) : '—' }, { t: fmtP(live) },
      { t: rangeCell }, { t: liveVsLow, c: 'mini' },
      { t: `+${fmtP(netU)} (${ampPct.toFixed(1)}%)`, c: 'gain' },
      { t: `${phaseTag} · ${stabPct != null ? stabPct + '% stable' : 'n/a'}`, c: 'mini' },
      { t: 'multi-wk hold', c: 'mini' },
    ];
    (tier === 'buy-now' ? buyNow : watch).push({ id: s.id, cells, score: s.valueScore });
    // P6b: the value niche's own rank estimate — pair = the durable floor→recovery pair (NOT the raw
    // ceiling); P(fill) = floor-proximity, TTF = the multi-day trough→recovery prior. Logged to the
    // suggestions ledger (the value table already SHOWS cycle net/u + hold horizon, so no column change).
    const vpFill = ESTIMATORS.value.pFill({ valueRanges: vr });
    const vttf = ESTIMATORS.value.ttf({ valueRanges: vr });
    const vrank = rankScore({ net: netU, pFill: vpFill.value, ttfSec: vttf.value });
    sugg.push(suggestionEntry(row, { itemId: s.id, cls: liqClass(row), volSrc: 'bulk', verdict: tier === 'buy-now' ? 'VALUE-BUY' : 'VALUE-WATCH', posture: POSTURE, path: 'value-hold',   // SF-3: bulk /24h volume
      bid: vr.buyLow, ask: vr.durableHigh, pFill: round2(vpFill.value), ttfSec: vttf.value, rank: Math.round(vrank), estBasis: `${vpFill.basis}/${vttf.basis}`, estN: Math.min(vpFill.n, vttf.n),
      volDayRolling: rollShadow(series1h, s.id) }));   // PLAN-VOL24 shadow: corrected /1h-composed 24h volume
  }
  buyNow.sort((a, b) => b.score - a.score); watch.sort((a, b) => b.score - a.score);
  // §E — value picks are logged in ISOLATION (mode 'value'); they never touch the fast-flip ledger rows.
  logSuggestions('screen', { mode: 'value', params: SCREEN_PARAMS }, sugg);

  const shown = buyNow.length + watch.length;
  console.log(`## VALUE — ${shown} buy-hold candidate(s) near a multi-week low (PROVISIONAL — unproven theory, n≈0)`);
  console.log('Playbook: buy near the multi-week low, HOLD for the range to cycle up; the edge is ONE tax-paid sell of a big move, not fast churn. State the hold horizon at entry — this is a multi-day/week HOLD, not a flip.');
  console.log(`(term structure: 1/3/7/14/28d low·high; ranked by valueScore = after-tax cycle amplitude × proximity-to-low × floor-stability × deployable-capital multiplier — PLACEHOLDER weights, n≈0)`);
  const capSource = VALUE_CAPITAL_EXPLICIT ? ''
    : (VALUE_CAPITAL_DERIVED ? ' — derived deployablePool from your cash anchor (cash.mjs: free stack + reclaimable deep-bid escrow, deep bids classified off live prices); pass --capital <gp> to override'
      : ' — PLACEHOLDER capital; set an anchor (cash.mjs) or pass --capital <gp> [--slots N] for your real figure');
  console.log(`(deployable-capital cap ${fmtP(VALUE_CAP_GP)}/position = ${fmtP(VALUE_CAPITAL)} capital ÷ ${VALUE_SLOTS} slots${capSource}. ${buyNow.length} buy-now surfaced — re-run --slots ${buyNow.length || 1} to size the cap to that.)`);
  if (buyNow.length) {
    console.log(`\n### BUY-NOW — live at/near the multi-week low (${buyNow.length})`);
    console.log(mdTable(VALUE_HEADERS, buyNow.map(r => r.cells)));
  }
  if (watch.length) {
    console.log(`\n### WATCH — good range, mid-cycle; wait for the dip (${watch.length})`);
    console.log(mdTable(VALUE_HEADERS, watch.map(r => r.cells)));
  }
  if (!shown) console.log('_none_');
  for (const n of valueInformNotes) console.log(`ℹ timing/trajectory — ${n}`);
  // §F admitted-vs-shown footer — never dump the full pool; say how many the gate admitted.
  console.log(`\nadmitted ${cand.length} (gate) · fetched ${survivors.length} (top ${VALUE_TOP_DEFAULT} by valueScore) · shown ${shown}${droppedKnife ? ` · dropped ${droppedKnife} post-fetch decay-knife` : ''}${droppedArtifact ? ` · dropped ${droppedArtifact} artifact-low (live below the durable floor)` : ''}${droppedTrajKnife.length ? ` · dropped ${droppedTrajKnife.length} trajectory-knife: ${droppedTrajKnife.join(', ')}` : ''}`);
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
      row = computeQuote({ id, latest: latest[id] || latest[String(id)] || null, ts5m, ts6h, vol24: v24[id], guide: guide[id] ?? null, limit: map.byId[id]?.limit ?? null, asked: true, held: true });
    }
    const d = v24[id], limit = map.byId[id]?.limit ?? null;
    const limitVol = d ? Math.min(d.highPriceVolume || 0, d.lowPriceVolume || 0) : 0;
    const thin = d ? (limitVol > 0 && limitVol < FLOOR) : false;
    // P6b: a watchlist row has no niche context, so rank it under the neutral band thesis (intraday
    // estimator, patient 2h-band pair) — a standard flip read. Same rank basis as the niche tables.
    const er = estimateRank(STRATEGIES.band, row);
    const r = rateItem({ row, rank: er.rank, thin });
    const std = stdCells(name, row);
    const gradeCell = thin ? { t: r.grade, title: `thin: ~${limitVol}/day two-sided — size in units, expect slow fills` } : { t: r.grade };
    const rankCell = { t: `${fmtP(r.score)} · net ${fmt(er.net || 0)} P~${er.pFill.value.toFixed(2)} ttf~${fmtTtf(er.ttf.value)}`, c: 'mini' };
    const cells = [std[0], gradeCell, ...std.slice(1), rankCell, { t: watchlistNote(row, d, bands, id, limit), c: 'mini' }];
    rows.push({ id, cells });
    sugg.push(suggestionEntry(row, { itemId: id, cls: liqClass(row), volSrc: 'bulk', verdict: r.grade, grade: r.grade, posture: POSTURE, ...estFields(er) }));   // SF-3: watchlist row's volDay is bulk /24h (v24). AZ-forward: grade letter logged explicitly
  }
  logSuggestions('screen', { mode: 'watchlist', params: SCREEN_PARAMS }, sugg);
  const headers = [...HEADERS, 'Note'];
  console.log(`## WATCHLIST — ${rows.length} item(s) (always shown; exempt from floors/gates; falling items shown with a warning)`);
  console.log(mdTable(headers, rows.map(r => r.cells)));
  console.log('');
  return { headers, rows };
}

// LM1: per-item 4h buy-limit windows. Built ONCE per run from the repo-root fills.json (cheap local
// file, no fetch) and read by renderMode's validator ctx (`limits` stage). Empty map ⇒ every item has
// zero in-window buys ⇒ limitValidator passes ⇒ byte-identical output (the degrade contract).
let BUYS_BY_ITEM = new Map();
function loadBuysByItem() {
  try { return buysByItem(JSON.parse(readFileSync(join(REPO_ROOT, 'fills.json'), 'utf8')).events || []); }
  catch { return new Map(); }   // absent/unreadable fills.json → no limit context (validator degrades to pass)
}


// DL4: the "B feeds A" nomination pass — the SCAN feeds the DL2 dip-loop pool. Off the ALREADY-in-hand
// gate-tier data (v24 + bands for the whole liquid universe) + the survivors' already-fetched series5m,
// it runs nominateDip over the universe, bonuses any survivor that flushSignal says is flushing NOW
// (zero extra fetch — both tiers are in hand), dedups against dip-watchlist.json, caps the new picks, and
// APPENDS them as { id, name, source:'auto', track, addedTs } objects. A nomination is a PROPOSAL TO
// WATCH (not a validated pick, not "trade this"); n=2, thresholds are PLACEHOLDERS (F1 owns calibration).
// Whole pass is best-effort try/caught by the caller — a nomination failure NEVER breaks the scan output.
const DIP_WATCHLIST_PATH = join(REPO_ROOT, 'dip-watchlist.json');
function runDipNominations(v24, bands, map, qcache, series5m) {
  const now = Date.now();
  // 1) breadth: nominate over the whole liquid universe off zero-fetch gate-tier data only.
  const cands = [];
  for (const key of Object.keys(v24)) {
    const id = Number(key);
    if (!Number.isFinite(id)) continue;
    const nom = nominateDip(v24[key], bands ? (bands[key] || bands[id]) : null, { now });
    if (!nom) continue;
    const name = map.byId[id]?.name || ('#' + id);
    let score = nom.score, flushingNow = false;
    // 2) survivor flush-now bonus (zero-fetch): a nominee already fetched as a survivor gets its fresh
    // 5m series read by flushSignal; a real flush (or at least still-falling with depth) wins the cap.
    if (qcache.has(id) && series5m.has(id)) {
      try {
        const fs2 = flushSignal(qcache.get(id), series5m.get(id), v24[key]?.avgLowPrice ?? v24[id]?.avgLowPrice, { now: new Date(now) });
        if (fs2 && (fs2.flush || fs2.signal || fs2.dir === 'falling')) { flushingNow = !!(fs2.flush || fs2.signal); score = score * 2 + (fs2.dipScore || 0); }
      } catch { /* best-effort bonus — a survivor read failure never drops the base nomination */ }
    }
    cands.push({ id, name, track: nom.track, score, amplitude: nom.amplitude, limitVol: nom.limitVol, flushingNow });
  }
  if (!cands.length) return;
  // 3) dedup vs the current file + cap. Preserve existing entries verbatim (polymorphic legacy/object).
  let existing = [];
  try { const raw = JSON.parse(readFileSync(DIP_WATCHLIST_PATH, 'utf8')); if (Array.isArray(raw)) existing = raw; } catch { /* absent/garbled → treat as empty */ }
  // 4) reconcile: re-score EVERY qualifier into the pool, age out non-qualifiers, keep top-N by score per
  // track (liquid = the --dip live-watch set, illiquid = DL3 backlog). Runs every scan so the pool stays a
  // quality-ranked, self-pruning set — the bloat fix. Best-effort write (screen.mjs never touches git).
  const qualifiers = cands.map(c => ({ id: c.id, name: c.name, track: c.track, score: c.score }));
  const existingIds = new Set(existing.filter(e => e && typeof e === 'object' && e.id != null).map(e => Number(e.id)));
  const nextPool = reconcileDipPool(existing, qualifiers, { now });
  try { writeFileSync(DIP_WATCHLIST_PATH, JSON.stringify(nextPool, null, 2) + '\n'); }
  catch (err) { console.error('(dip-nominate: could not write dip-watchlist.json — ' + ((err && err.message) || err) + ')'); }
  // 5) the /scan surface line — report the pool honestly + the items newly ADDED to it this scan (those that
  // survived the score cap). flushingNow comes from the survivor bonus computed above.
  const flushNow = new Set(cands.filter(c => c.flushingNow).map(c => c.id));
  const liqPool = nextPool.filter(e => e && e.source === 'auto' && e.track === 'liquid');
  const illiqPool = nextPool.filter(e => e && e.source === 'auto' && e.track === 'illiquid');
  const added = nextPool.filter(e => e && e.source === 'auto' && !existingIds.has(Number(e.id)));
  console.log(`## Dip pool — ${liqPool.length} liquid (watched live by --dip) / ${illiqPool.length} illiquid (DL3 backlog); ${added.length} added this scan → dip-watchlist.json (flush-suitability PROPOSALS, quality-capped; n=2 placeholders)`);
  for (const p of added.slice(0, 10)) console.log(`- ${p.name} — ${p.track}${flushNow.has(p.id) ? ' ⚡flushing-now' : ''}`);
  console.log('');
}

async function main() {
  pruneCache('ts', 24 * 3600 * 1000);                     // bound the per-item series cache
  BUYS_BY_ITEM = loadBuysByItem();                        // LM1: buy-limit windows for the validator ctx
  const map = await loadMapping();
  const [v24legacy, latest, guide] = await Promise.all([loadAll24h(), loadAllLatest(), loadGuide()]);  // independent endpoints — fetch concurrently, not summed round-trips
  // PLAN-VOL24 step 2 (Ben-validated): DEFAULT `rolling` — the corrected whole-market trailing-24h map (24
  // bulk /1h windows, mostly warm from the SQLite archive) is the ACTIVE volume behind every gate/rank/
  // column, with the volume floors count-matched to it in the same change. `--vol-source legacy` restores
  // the broken /24h map (escape hatch / pre-recal repro). loadAll24hRolling is a small extra fetch cost on a
  // cold archive (≤24 bulk /1h, mostly deduped against buckets loadSnapshot/loadDaily already accrue).
  const v24 = VOL_SOURCE === 'rolling' ? await loadAll24hRolling() : v24legacy;

  // Value --capital default = the DERIVED deployablePool (lib/cashderive.mjs). Re-derive it here WITH a
  // marketRef built from the bulk /latest already in hand (ZERO extra fetch): each resting bid classifies
  // DEEP (reclaimable → counts toward deployable) vs COMMITTED (near-live, expected to fill → excluded)
  // using its item's live instasell (latest[id].low). A resting-bid item absent from /latest → no ref →
  // COMMITTED (conservative). Only re-derives when value runs on a DERIVED (non-explicit) capital.
  if (!VALUE_CAPITAL_EXPLICIT && VALUE_CAPITAL_DERIVED && RUN_MODES.some(m => STRATEGIES[m].gate === 'value')) {
    const bidMarketRef = {};
    for (const o of readOffersSnapshot(join(REPO_ROOT, 'offers.json'))) {
      if (!o || o.side !== 'buy' || ((o.qty || 0) - (o.filled || 0)) <= 0) continue;
      const lt = latest[o.itemId] || latest[String(o.itemId)] || null;
      if (lt && lt.low) bidMarketRef[o.itemId] = { live: lt.low };
    }
    DERIVED_CASH = loadDerivedCash(REPO_ROOT, { marketRef: bidMarketRef });
    VALUE_CAPITAL = DERIVED_CASH.deployablePool;
    VALUE_CAP_GP = VALUE_CAPITAL / VALUE_SLOTS;
    THRESHOLDS.VALUE_CAP_GP = VALUE_CAP_GP;   // gateCandidates/valueScore read the cap from THRESHOLDS
  }
  // PLAN-CAPITAL-THROUGHPUT (Ben 2026-07-14): sync the band/churn capital cap to the current deployable
  // pool (the market-ref-refined VALUE_CAPITAL if value ran above; else the conservative pre-derive pool,
  // or the explicit --capital). The FULL pool, NOT ÷slots — the attention floor asks "if I put everything
  // in this ONE lane…". Left null under --throughput legacy → gateCandidates uses the capital-blind value.
  if (THROUGHPUT_MODE !== 'legacy') THRESHOLDS.THROUGHPUT_CAP_GP = VALUE_CAPITAL;
  const bands = NEED_BANDS ? await loadBands(BAND_HOURS) : null;
  const { series: daily, coverageWindows } = await loadDaily(DAILY_DAYS, DAILY_STEP_H);  // bulk regime-proxy archive
  const ctx = { v24, map, bands, daily };   // P5: `daily` rides the ctx so the value gate can read the term structure

  // gate every mode, then proxy-rank its gated pool and take the top-N fetch pool. P5 value ranks by
  // valueScore and takes a HARD top-N (VALUE_TOP_DEFAULT §F) — a bounded shortlist off a large pool.
  const gated = {};
  for (const m of RUN_MODES) {
    const cand = gateCandidates(m, ctx, THRESHOLDS);
    const top = STRATEGIES[m].gate === 'value' ? VALUE_TOP_DEFAULT : TOP;
    // P6c: EMPTY at the configured floors → re-run the SAME gate stack beneath the floor (subFloorFallback's
    // relaxation ladder) and surface the best SUBFLOOR_TOP honestly labeled — never an empty table with the
    // opportunity silently invisible, never a silently lowered bar. Fires ONLY on a zero-candidate niche
    // (any niche with ≥1 candidate is untouched, byte-identical); if even the relaxed gate is empty (the
    // edge/market, not the floors, emptied it) the normal `_none_` output stands unchanged. The fallback
    // pool rides the same bulk data already loaded at gate time and the same per-item fetch path a normal
    // niche uses, capped at SUBFLOOR_TOP (≤5 — strictly fewer fetches than any non-empty niche's top-N).
    if (!cand.length && STRATEGIES[m].gate !== 'value') {
      const fb = subFloorFallback(m, ctx, THRESHOLDS);
      if (fb) {
        gated[m] = { cand: fb.cand, survivors: rankAndSlice(m, fb.cand, daily, { thinReserve: THIN_RESERVE, top: SUBFLOOR_TOP }), subFloor: fb };
        continue;
      }
    }
    gated[m] = { cand, survivors: rankAndSlice(m, cand, daily, { thinReserve: THIN_RESERVE, top }) };
  }

  // fetch each unique survivor's series ONCE (shared across modes in --mode all; cached on disk), quote it.
  // Bounded worker pool: the 3 per-item series (5m/6h/1h — independent endpoints) fetch in parallel, and
  // FETCH_CONCURRENCY items run at once. The pool bound IS the API-politeness throttle (it replaced the old
  // serialized per-fetch sleep(30)); results land in id-keyed Maps, so scheduling order can't change output.
  const FETCH_CONCURRENCY = 5;   // max in-flight items — keep modest; the wiki API sees ≤15 concurrent requests
  const ids = new Set();
  for (const m of RUN_MODES) for (const s of gated[m].survivors) ids.add(s.id);
  const qcache = new Map(), series5m = new Map(), series6h = new Map(), series1h = new Map();
  {
    const queue = [...ids];
    const worker = async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        // Leg B (2026-07-09): the 1h series for reachValidator — the sell-leg "windowrange --ask" reach + the
        // value niche's daily-min TIMING read. SURVIVOR-ONLY (this pool is the union of mode survivors, not
        // the top-40 gated pool), so a scan adds ~one 1h fetch per surfaced row, never per candidate.
        const [ts5m, ts6h, ts1h] = await Promise.all([
          fetchTsCached(id, '5m', TS_TTL_5M),
          fetchTsCached(id, '6h', TS_TTL_6H),
          fetchTsCached(id, '1h', TS_TTL_1H),
        ]);
        const lt = latest[id] || latest[String(id)] || null;
        const limit = map.byId[id]?.limit ?? null;
        qcache.set(id, computeQuote({ id, latest: lt, ts5m, ts6h, vol24: v24[id], guide: guide[id] ?? null, limit }));
        series5m.set(id, ts5m);   // kept raw for the overnight-posture staleness read (overnightStaleRisk)
        series6h.set(id, ts6h);   // kept raw for the Part A phase() trajectory read (same ts6h as the quote)
        series1h.set(id, ts1h);   // Leg B — reachValidator's window series (was null → reach degraded to pass)
      }
    };
    await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, ids.size) || 1 }, worker));
  }

  console.log(`# Opportunity screen — mode ${MODE.toUpperCase()}, posture ${POSTURE.toUpperCase()}, liquidity ${FLOOR}/d OR ${(GP_FLOOR/1e6).toLocaleString()}m gp-flow, min ROI ${MIN_ROI}% (thin: ${(MIN_NET_GP/1e3).toLocaleString()}k net/u), attention floor ${(MIN_GPD/1e3).toLocaleString()}k gp/d, ${MIN_PRICE.toLocaleString()}–${MAX_PRICE.toLocaleString()} gp, top ${TOP} fetched/niche`);
  console.log(`(${ids.size} unique items fetched; grade cutoffs are PLACEHOLDERS pending the validation study)`);
  // PART II: --asym is loudly experimental — repriced quotes + asym sort on the 'asym'-fillShape niches.
  if (ASYM) console.log(`⚠ --asym EXPERIMENTAL (F1-ungraduated): band/scalp QUOTED prices are the asymmetric deep-bid → high-reach-ask pair and the sort is net × P_ask ÷ TTF — placeholder quantiles (n≈14), NOT the calibrated default. churn/value unchanged.`);
  if (coverageWindows < DAILY_COLD) console.log(`(⚠ regime-proxy archive is COLD — only ${coverageWindows}/${Math.round(DAILY_DAYS * 24 / DAILY_STEP_H)} windows; fetch-pool ordering is degraded until it warms up)`);
  console.log('');
  await loadModules();   // PM1: discover pipeline/modules/*.mjs once (empty/absent dir → zero probes → byte-identical)
  // Step 6a: churn is partitioned from band (drops the band-lane ROI ≥ MIN_ROI rows) ONLY when both
  // niches run together (--mode all) — so the two tables are disjoint. Standalone --mode churn is unpartitioned.
  const partitionChurn = RUN_MODES.includes('band') && RUN_MODES.includes('churn');
  const niches = {};
  for (const m of RUN_MODES) niches[m] = STRATEGIES[m].gate === 'value'
    ? renderValueMode(gated[m], qcache, map, series6h, series1h, guide, daily)   // P5 — the value niche's own term-structure table
    : renderMode(m, gated[m], qcache, map, series5m, series6h, series1h, v24, daily, { partition: m === 'churn' && partitionChurn });
  // YP2 (#2) WATCH CLOSELY — items entering a transition state (basing faller / spike on rising vs
  // falling lows), collected across the fetched pool. Descriptive prompts, NOT buy signals;
  // deliberately stdout-only (no screen.json / app render — that surfacing is #5).
  if (watchClosely.size) {
    console.log(`## WATCH CLOSELY — ${watchClosely.size} item(s) in a transition state (descriptive, not a buy signal)`);
    for (const e of watchClosely.values()) console.log(`- ${e.name}: ${e.state} — ${e.note}`);
    console.log('');
  }
  // DL4: nominate flush-suitable dip candidates into dip-watchlist.json — only in the routine `--mode all`
  // scan Ben runs (not a single-niche run), best-effort so a failure never breaks the scan output.
  if (MODE === 'all') { try { runDipNominations(v24, bands, map, qcache, series5m); } catch (err) { console.error('(dip-nominate: pass failed — ' + ((err && err.message) || err) + ')'); } }
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
      pipeline: PIPELINE_VERSION,      // PV — the app renders "pipeline vX" from this (additive; old apps ignore it)
      generatedAt: new Date().toISOString(),
      mode: MODE,
      posture: POSTURE,                // S2: the Scan banner reads this to say which posture it shows
      params: { floor: FLOOR, gpFloor: GP_FLOOR, minRoi: MIN_ROI, minNetGp: MIN_NET_GP, minGpd: MIN_GPD, minPrice: MIN_PRICE, maxPrice: MAX_PRICE, top: TOP, bandHours: BAND_HOURS, minActive: MIN_TRADED, posture: POSTURE },
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
