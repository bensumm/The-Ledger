#!/usr/bin/env node
/**
 * screen-flip-niches.mjs — opportunity screen. ONE command → a finished, RATED table per niche.
 *
 *   node pipeline/commands/screen-flip-niches.mjs [--mode band|churn|scalp|value|all]
 *     [--floor 50] [--min-roi 1.5] [--min-price 0] [--max-price 45m] [--top 40]
 *     [--band-hours 2] [--min-traded 6] [--stats] [--publish] [--verbose]
 *
 *   DEFAULT is quiet: prints ONE summary line + the last-report dump path, not the markdown table.
 *   The per-niche report objects are ALWAYS written to pipeline/.cache/last-report/screen.json
 *   (gitignored, overwritten per run) — read THAT file for the actual data, never the summary line.
 *   Pass --verbose for the markdown table (Ben's terminal read / the "paste this" case). AO1.
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
 * ACCEPTS + REQUIRES, value KNIFE-GUARDS — `js/flip-niches.mjs` `spec.falling`, NOT a global rule).
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
import { computeQuote, QUOTE_HEADERS, isOvernightNow, phase, OVERNIGHT_SPAN_H, nominateDip, reconcileDipPool, flushSignal, askHeadroomText, BIG_TICKET_GP } from '../../js/quotecore.js';   // BIG_TICKET_GP (PLAN-CAPITAL-EFFICIENCY-AND-DIGEST): the ONE big-ticket threshold, reused for the weak-deploy flag's per-unit-mid analogue (never reinvented)
import { tax } from '../../js/money-math.js';
import { fmt, fmtP, fmtHour } from '../../js/money-format.js';
import { hourProfile, deriveDiurnalRange, diurnalPhase, windowStats, asymPair, windowClear, windowClearDiverges, reachableBand, placement, weekdayProfile, reachMargin, RECENCY_DIVERGE, RECENT_NIGHTS } from '../../js/windowread.mjs';   // diurnal peak-timing read + PART II asym pair (both off the in-hand 1h series); PLAN-WINDOW-CLEAR B2 — within-window clear read + divergence flag; RC-S2 — pressure-driven reachable band co-log; PLAN-ESTIMATOR-POSTURE AC1 — placement() = the band-low buy's percentile within the 14-day daily-LOW distribution; A3 (PLAN-AMPLITUDE-SCAN) — weekdayProfile = the day-of-week seasonality read for the 1.5-day amplitude experiment (DC3 demandRegime removed — PLAN-REMOVE-DEPTH-PRESSURE-READS)
// P6b — per-thesis P(fill)+TTF estimators + the ranking composite that REPLACES the demoted expGpDay
// (Ben 2026-07-09: "gp/d is out"). estimateRank returns { pair, net, pFill, ttf, rank } off the row +
// the spec's declared price-basis; rank = net × P(fill) ÷ TTF is the new displayed/graded metric.
import { estimateRank, rankScore, ESTIMATORS, fmtTtf, asymEstimate, estimatePair, estPairCells, estConfLean, EST_HEADERS, dayHighFrom5m, SELL_TOP_MODELS } from '../lib/estimators.mjs';   // PLAN-LIQUIDITY-REACH: dayHighFrom5m = the observed 24h high (Part B de-bias reference) off the in-hand 5m series; PC3: SELL_TOP_MODELS = the named sell-top registry (--est-sell)   // AC9(b): the overnight sort now weights by the rank's own er.pFill (two-leg fill prob), not askReachFactor — see the sort comment below
import { anchorNudge } from '../probes/anchor.mjs';   // PLAN-OUTPUT-TABLE: the ⚓ round-number nudge, injected into estimatePair (final step — nudge, never override)
import { loadMapping, loadGuide, loadAll24h, loadAll24hRolling, rolling24FromTs1h, loadAllLatest, loadBands, loadDaily, fetchTsCached, pruneCache, sleep } from '../lib/marketfetch.mjs';
import { parseArgs, parseGp, mdTable, stdCells, writeLastReport } from '../lib/cli.mjs';   // writeLastReport — AO1 agent-readable dump
import { resolve, loadPipelineConfig, refusePublishIfNonNeutral, shadowModelsOf } from '../lib/compose.mjs';   // PC1 — the flag>config>default precedence resolver + the ONE publish-refusal guard; PC3 — shadowModelsOf pools the default-shadow sell models
import { renderReport, renderHtmlTable } from '../lib/render.mjs';   // VZ4a (PLAN-VIZ-LAYER) — the ONE render layer; a niche's table + footer notes build a screen-report printed via renderReport (byte-identical to the prior console.log sequence); renderHtmlTable (2026-07-16) — the Stage-2 HTML twin published into screen.json for the app's Scan tab
// P1: the pure candidate-selection + survival doctrine moved to lib/gatecandidates.mjs (was inline
// here: gateCandidates/expUnits/proxyDrift/softFactor/rankAndSlice + the extracted
// renderMode post-fetch doctrine surviveMode). Logic byte-identical; screen-flip-niches.mjs passes its CLI
// THRESHOLDS / sizing explicitly. Fixtures drive them in gatecandidates.test.mjs + survivemode.test.mjs.
import { gateCandidates, rankAndSlice, surviveMode, expUnits, expUnitsOvernight, VALUE_TOP_DEFAULT, AMP_TOP_DEFAULT, subFloorFallback, subFloorLabel, SUBFLOOR_TOP, SUBFLOOR_GRADE_CAP } from '../lib/gatecandidates.mjs';
import { pickFetchPool, buildTrackIndex } from '../lib/admission.mjs';
import { valueRanges, valueScore, valueGate, valueTier, deployUnits } from '../../js/valuescreen.mjs';   // P5 — value niche gate/rank/tier; deployUnits (PLAN-CAPITAL-EFFICIENCY-AND-DIGEST follow-up) = the shared three-way-min deployable position size, reused for the digest's deployable-throughput ranking
import { amplitudeRanges, amplitudeGate, amplitudeDriftMargin, AMP_HOLD_DAYS_DEFAULT, AMP_ASK_Q, AMP_BID_Q } from '../../js/amplitudescreen.mjs';   // A2/A3 (PLAN-AMPLITUDE-SCAN) — the 24h-cycle niche's Stage-2 gate + hold-horizon default; PLAN-OSCILLATION-CYCLE Chunk 2 — amplitudeDriftMargin = the shadow-logged drift-adjusted margin; F-E — AMP_ASK_Q/AMP_BID_Q = the DEFAULT reach-vs-margin quantiles the --amp-ask-q/--amp-bid-q flags fall back to
import { driftExitFrom, oscillationVsKnife, OSC_DETECTOR_NIGHTS } from '../../js/forecast.mjs';   // PLAN-OSCILLATION-CYCLE Chunk 2 — driftExitFrom = the ONE slope-sourcing + drift-adjusted-exit composition (Chunk 6 reuses it); off in-hand hourProfile + windowStats().days, NO fetch. Chunk 3 — oscillationVsKnife tempers the knife guard (a drift-riding oscillator is not a false knife). F-H — OSC_DETECTOR_NIGHTS = the detector's OWN longer trailing window, decoupled from the gate's AMP_NIGHTS
import { amplitudeShadow } from '../lib/suggestlog.mjs';   // A5 — the amplitude lane shadow block on suggestions.jsonl
// P4c: the four niches are DECLARATIVE strategy specs now. screen-flip-niches.mjs derives its mode-name lists from
// the registry (the names live in ONE place — flip-niches.mjs) and reads each spec's inferred default
// entry path for the suggestions ledger + the per-row path annotation.
import { FLIP_NICHES, MODE_KEYS, ALL_MODE_KEYS, driftInformNote } from '../../js/flip-niches.mjs';   // PLAN-OSCILLATION-CYCLE Chunk 6 — driftInformNote = the per-thesis drift-adjusted-exit INFORM note (registry-driven, NO if(mode===) branch; off the shared driftExitFrom, NO fetch)
import { enumeratePaths, weighPaths } from '../../js/held-item-strategy.mjs';   // P4c: weighed entry-path menu per surfaced row (display-only)
import { rateItem, GRADE_CUTOFFS, capGrade, REACH_GRADE_CAP, REACH_GRADE_CAP_FRAC } from '../lib/rating.mjs';
import { logSuggestions, suggestionEntry, liqClass, reachableShadow, asymShadow } from '../lib/suggestlog.mjs';   // RC-S2: pressure co-log on survivors (five-way head-to-head off the in-hand 1h series); shared asym reshaper
import { PIPELINE_VERSION } from '../lib/version.mjs';   // PV — stamped into screen.json so the app can display the pipeline version
import { loadDerivedCash } from '../lib/derive-cash-tiers.mjs';   // value niche: DERIVED deployable pool → --capital default (derive-cash.mjs anchor + log flow)
import { readOffersSnapshot } from '../lib/offers.mjs';   // resting-bid item ids for the deployablePool marketRef (deep-vs-committed classification)
import { readOpenPositions } from '../lib/positions.mjs';   // held-item ids — the code-enforced "always show a held item" exception (was prose-only)
import { runValidators, flags, informFlags, leanValidators, worstStatus } from '../../js/validate.mjs';   // P2 — validator registry: DROP reject, FLAG caution, INFORM = annotate-only
import { buysByItem, limitWindow, LIMIT_WINDOW_SEC } from '../lib/limits.mjs';   // LM1 — per-item 4h buy-limit window (limitValidator BUY-side); LIMIT_WINDOW_SEC = the churn laps/day ceiling source (PLAN-CAPITAL-EFFICIENCY-AND-DIGEST capEff)
import { termStructure } from '../../js/termstructure.mjs';   // P3 — term structure / durable floor for floorValidator (fed the loadDaily proxy series)
// COD-4 (2026-07-10): richFrom1h/trajectoryFrom1h were EXTRACTED to lib/warm-term-structure.mjs (byte-identical
// logic) so quote-items.mjs's budgeted-ts1h read shares the IDENTICAL warm-term-structure aggregation and the
// two surfaces can't drift — the loadDaily archive is still young, so both derive the warm trajectory (+
// value-amplitude's recent-week lookbacks) off the 1h /timeseries. See the warm-term-structure.mjs header for why.
import { richFrom1h, trajectoryFrom1h, warmOverride } from '../lib/warm-term-structure.mjs';
import { stateTransition } from '../lib/statetransition.mjs';   // YP2 (#2) — watch-closely transition scan
import { buildVelocityIndex, velocityTag } from '../lib/velocitytag.mjs';   // Build 2 — per-item velocity footnote from outcomes.json
import { loadModules, runProbes, logFirings } from '../lib/probes.mjs';   // PM1 — probe-module system (dip/froth/anchor/decant); PM2 — firing log
import { writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runLocalSync } from '../lib/sync-invoke.mjs';   // AR1 — the ONE shared "always sync first" (SY1) invocation

// --- args ---
const A = parseArgs(process.argv.slice(2));
// PC1 (PLAN-PIPELINE-COMPOSITION): the OPTIONAL pipeline/pipeline-config.json, read once. Absent by
// default ⇒ {} ⇒ every resolve() below falls through to its hardcoded fallback (byte-identical to the
// pre-PC1 inline ternaries). Every flag routed through resolve('<cat>', { flag, config, fallback })
// so a future config file can set the same default without editing each script.
const CONFIG = loadPipelineConfig();
const MODES = MODE_KEYS;         // P4c: valid explicit --mode values, from the strategy registry (band/churn/scalp/value — spread+rising deleted, Steps 3+4)
// --mode all runs the inAll specs — band/churn/value (Ben 2026-07-10 added value; scalp explicit-only).
// PC3 pickup: the niche SET for `--mode all` is config-overridable via pipeline-config.json "modes":[…]
// — an ARRAY, distinct from the scalar `mode` selection above. Resolved through the SAME precedence
// resolver (no CLI flag — `--mode all` is the trigger — so config-or-default only); unknown entries are
// filtered against the registry and an empty/absent list falls through to ALL_MODE_KEYS byte-identically.
const CFG_MODES = Array.isArray(CONFIG.modes) ? CONFIG.modes.map(m => String(m).toLowerCase()).filter(m => MODE_KEYS.includes(m)) : null;
const ALL_MODES = resolve('modes', { flag: undefined, config: (CFG_MODES && CFG_MODES.length) ? CFG_MODES : undefined, fallback: ALL_MODE_KEYS }).active;
// A4 (THE SWAP, PLAN-AMPLITUDE-SCAN §3) — `invest` is the DISPLAY alias for the `value` KEY (value is
// relabelled Invest; the ledger key stays `value` so the suggestions ledger/goldens don't fork). Map the
// alias to the key here so `--mode invest` runs the value niche.
const MODE_ALIASES = { invest: 'value' };
const rawMode = resolve('mode', { flag: A.mode != null && A.mode !== true ? String(A.mode).toLowerCase() : undefined, config: CONFIG.mode, fallback: 'band' }).active;
const MODE = MODE_ALIASES[rawMode] || rawMode;
if (MODE !== 'all' && !MODES.includes(MODE)) { console.error(`! unknown --mode "${A.mode}". Use one of: ${MODES.join(', ')}, invest, all (or omit for band).`); process.exit(1); }
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
// the cash anchor + log flow (lib/derive-cash-tiers.mjs deployablePool = the free coin stack PLUS the escrow of
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
// A3 (PLAN-AMPLITUDE-SCAN §2.4): the amplitude hold horizon — 1 (default: buy the trough, sell the peak
// same local day) or the 1.5-day experiment (fill day-1's trough, sell into day-2's peak). Feeds the
// amplitude family's ttf, the deployable-units accumulation leg, and the §A5 shadow-replay horizon. A
// flag, not a fork. PLACEHOLDER (n≈0).
const AMP_HOLD_DAYS = A['hold-days'] != null ? Math.max(1, +A['hold-days']) : AMP_HOLD_DAYS_DEFAULT;
// F-E (PLAN-OSCILLATION-CYCLE): the amplitude reach-vs-margin DIAL — the daily high/low quantiles the
// peak-ask / trough-bid quote from. Default = the module's KEPT board (AMP_ASK_Q/AMP_BID_Q = 0.5/0.5, the
// median peak/trough — Ben's explicit call, NOT changed by F-E). A HIGHER --amp-ask-q (e.g. 0.75) quotes a
// better-but-less-reachable sell so a later retro (F-G) can compare which quantile nets more; absent flag ⇒
// defaults ⇒ byte-identical to pre-F-E. clamp01 so a fat-fingered arg can't ask for a nonsense quantile.
const AMP_ASK_Q_EFF = A['amp-ask-q'] != null ? Math.min(1, Math.max(0, +A['amp-ask-q'])) : AMP_ASK_Q;
const AMP_BID_Q_EFF = A['amp-bid-q'] != null ? Math.min(1, Math.max(0, +A['amp-bid-q'])) : AMP_BID_Q;
// AMP sizing (PLAN-AMPLITUDE-SCAN sizing fix, Ben 2026-07-19). Amplitude is a big-ticket CONCENTRATION
// lane — the owner would put his whole bankroll into a single ~345m item — NOT a diversify-across-slots
// lane like value. So it does NOT use value's per-position (÷slots) cap: it sizes against TOTAL REALIZABLE
// capital (the "if all lots sold" yardstick = free cash + liquidation value of holds = the LOOSER
// liquidCapital, NOT value's tighter deployablePool), used UNDIVIDED. --slots is IGNORED for amplitude.
// Explicit --capital <gp> overrides as the whole pool. Re-derived in main() with the derived cash record
// (liquidCapital is marketRef-independent, but DERIVED_CASH is reassigned there, so re-read it).
let AMP_CAPITAL = VALUE_CAPITAL_EXPLICIT ? parseGp(A.capital)
  : (VALUE_CAPITAL_DERIVED ? DERIVED_CASH.liquidCapital : 100_000_000);
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
// ADMISSION (PLAN-SCREEN-ARCHITECTURE, 2026-07-18): the fetch-pool admission path. UNIFIED is now the
// default — pickFetchPool (pipeline/lib/admission.mjs) ranks the thin lane on its after-tax realistic
// edge instead of raw gp-flow, adds a bounded rotating exploration reserve, folds in the track-record
// boost, and reports every excluded candidate. `--admission legacy` restores rankAndSlice byte-for-byte
// (gatecandidates.mjs is unchanged and still fixture/golden-pinned) for rollback/comparison.
const ADMISSION = A['admission'] === 'legacy' ? 'legacy' : 'unified';
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
  VALUE_CAP_GP,
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
// --publish (DEFAULT ON, 2026-07-16 — was opt-in): also write repo-root screen.json so the app's
// Scan tab renders the SAME per-niche graded scan a Claude session produces (byte-parity via the
// shared stdCells / rating path). The file is self-describing (its own `headers` travel with the
// rows) and each row keeps its itemId for the Item→Trends deep link. PUBLISHING (this local file
// write) is now the default every run — COMMITTING screen.json to git is a wholly separate,
// deliberate step (nothing here touches git); sync-fills.mjs commits it alongside fills/positions
// only when its own --publish flag runs (once-a-day /overnight). Opt out with --no-publish (e.g. a
// throwaway filtered console read you don't want to leave written to disk).
// AO1 (default flipped post-review — Ben: an agent running the quiet path must read the JSON dump,
// not the summary line, so quiet has to be the DEFAULT or that habit is optional). --verbose opts
// INTO the markdown stdout; the per-niche report objects are ALWAYS accumulated into REPORTS and
// written to the last-report dump either way. Without --verbose main() no-op's console.log;
// emitReport still captures every niche report (the VALUE niche renders raw, has no report object,
// so it's excluded from the dump — same as screen.json).
const VERBOSE = A.verbose === true;
// --digest (PLAN-CAPITAL-EFFICIENCY-AND-DIGEST Workstream C): an ADDITIVE, opt-in decision digest —
// ONE compact cross-niche block (Item | capEff | reach | phase | grade | verdict) printed ONCE after
// the niche tables, ranked by capital-efficiency. OFF by default (protects the AO1 quiet-default + the
// --verbose firehose contract, both untouched). It prints REGARDLESS of --verbose (an agent asking for
// the digest wants stdout) via `realLog` in main(), on its own `if (DIGEST)` gate independent of VERBOSE.
// CONSOLE-ONLY: never written to screen.json / the last-report dump — no APP_VERSION bump (scope lock).
const DIGEST = A.digest === true;
const REPORTS = [];   // per-niche screen-report objects for this pass (renderMode niches only)
function emitReport(report) { REPORTS.push(report); console.log(renderReport(report)); }   // console.log is a no-op unless --verbose
const PUBLISH_EXPLICIT = A.publish === true;
let PUBLISH = A['no-publish'] === true ? false : true;
// PC3 — the SELL-TOP MODEL selection (--est-sell reach-fold|pressure). Replaces the bespoke --pressure-exit
// boolean with a NAMED model routed through the resolver; `--pressure-exit` is kept as LEGACY SUGAR for
// `--est-sell pressure` (an explicit --est-sell wins). shadowPool = the default-shadow models
// (reach-fold), so when pressure is ACTIVE the neutral reach-fold rides `SELL_MODEL.shadow` and still
// logs the unbiased retro co-log (estBuy/estSell/estConfidence). The PB4 pressure model is a TRIAL: its
// number drives the CONSOLE display + rerank only; THE HARD GUARD (refusePublishIfNonNeutral below,
// mirrors --asym) keeps a non-neutral model out of screen.json / the deployed app. Absent flag+config ⇒
// 'reach-fold' (byte-identical to the pre-PC3 default). PRESSURE_EXIT stays the boolean the rest of this
// script branches on (banner/rerank/publish-guard) — now DERIVED from the active model.
const SELL_MODEL = resolve('sellModel', {
  flag: A['est-sell'] != null && A['est-sell'] !== true ? String(A['est-sell']).toLowerCase()
      : (A['pressure-exit'] === true ? 'pressure' : undefined),
  config: CONFIG.sellModel,
  fallback: 'reach-fold',
  shadowPool: shadowModelsOf(SELL_TOP_MODELS),
});
if (!SELL_TOP_MODELS[SELL_MODEL.active]) { console.error(`! unknown --est-sell "${A['est-sell']}". Use one of: ${Object.keys(SELL_TOP_MODELS).join(', ')}.`); process.exit(1); }
const PRESSURE_EXIT = SELL_MODEL.active === 'pressure';
// --- Part B (opt-in): basing-rescue. OFF by default → default output is byte-identical (the only
// default change is Part A's display annotation, which only APPENDS phase text to an existing Regime
// cell — it never changes which rows are selected/excluded). When ON, an item the falling-exclusion
// would normally DROP but whose phase()==='basing' (decayed off a spike, lows flattened) is instead
// SURFACED, capped to PHASE_BASING_GRADE_CAP and flagged provisional. Conservative, gated trial —
// thresholds are unvalidated placeholders. capGrade is reused from rating.mjs (no rating.mjs change).
const PHASE_RESCUE = resolve('phaseRescue', { flag: A['phase-rescue'] === true ? true : undefined, config: CONFIG.phaseRescue, fallback: false }).active;
const PHASE_BASING_GRADE_CAP = 'B';   // named ceiling for a provisional basing-rescue surface
// --- PART II (PLAN-GRADE-REACH, opt-in): --asym flips the 'asym'-fillShape niches (band/scalp) to the
// asymmetric deep-buy/reliable-sell objective AS THE QUOTED PRICES AND SORT — optBuy→the flush bid,
// optSell→the high-reach ask (min/max ordering guards in asymEstimate), rank = net × P_ask ÷ TTF.
// OFF BY DEFAULT and F1-GATED: the quantiles (ASYM_P_LO/ASYM_P_HI) are n≈14 PLACEHOLDERS, so the
// DEFAULT table stays byte-identical (the asym read ships only as the inform line + the shadow
// suggestions.jsonl `asym` field until the shadow A/B graduates it). --publish is refused under --asym
// so uncalibrated prices can never reach screen.json/the app. Estimate/render-stage only — the pinned
// gateCandidates→rankAndSlice→surviveMode funnel (replay goldens) is untouched either way.
const ASYM = resolve('asym', { flag: A.asym === true ? true : undefined, config: CONFIG.asym, fallback: false }).active;
// PC1: the ONE shared publish-refusal guard (replaces the two inline per-flag copies that used to sit
// beside the PUBLISH declaration). An UN-CALIBRATED / F1-ungraduated estimator (--asym, --pressure-exit,
// or a config that enables either) must never reach screen.json / the deployed app: an EXPLICIT
// --publish under one is a hard user error (loud stderr + exit); a default-on publish is quietly
// downgraded to off (so an exploration run needs no --no-publish). Order = asym then pressure (matches
// the removed inline order, so an explicit-publish conflict prints the same first message). Byte-identical
// to the two removed blocks when no config is present.
PUBLISH = refusePublishIfNonNeutral({
  publish: PUBLISH, publishExplicit: PUBLISH_EXPLICIT,
  checks: [
    { on: ASYM, message: '! --asym is experimental (F1-ungraduated) — refusing --publish under it.' },
    { on: PRESSURE_EXIT, message: '! --pressure-exit is an UN-CALIBRATED trial (F1-ungraduated) — refusing --publish under it (the deployed app + screen.json stay on the neutral estimator per PLAN-REACHABILITY-CONSOLIDATION).' },
  ],
});
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
const VOL_SOURCE = resolve('volSource', { flag: A['vol-source'] != null && A['vol-source'] !== true ? String(A['vol-source']).toLowerCase() : undefined, config: CONFIG.volSource, fallback: 'rolling' }).active;
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
// `softFactor`) and `expUnits` all live in lib/gatecandidates.mjs
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

// =====================================================================================================
// PLAN-CAPITAL-EFFICIENCY-AND-DIGEST — capital-efficiency ranking, the weak-deploy flag, and the
// decision-digest verdict rule table. EVERYTHING here is INFORM-ONLY, PLACEHOLDER (n≈0), and NEVER
// gates/drops a row or changes a grade/rank/screen.json: capEff re-orders the DIGEST view only (§1.4 —
// the per-niche table's `rank` sort is untouched); weakDeploy is a lean suggestions.jsonl flag + a
// digest token; the verdict strings are a deterministic (NOT calibrated) triage word. None of these
// thresholds may graduate to a gate without a retro-join measurement first (§7). CONSOLE-ONLY.
// NAMING (W3-1, PLAN-OSCILLATION-CYCLE): the digest-only `liveCrossable`/`crossable` signal below (live
// spread not profitably crossable — `quickRoi <= 0` after tax) is a DIFFERENT concept from the existing
// "ghost spread" (a ONE-SIDED book, `hpv<=0||lpv<=0`, caught upstream by the two-sided-liquidity gate in
// gatecandidates.mjs). A book can be two-sided (real volume both legs) yet have an uncrossable live spread;
// crossable catches THAT, in the digest sort only. Do not conflate the two.
// -----------------------------------------------------------------------------------------------------
const WEAK_DEPLOY_ROI_PCT = 0.5;   // PLACEHOLDER (n≈0) — Magus (~0.3%, flagged) vs blowpipe (~1.1%, clears
                                   // on margin alone) anchor; a real bar needs the big-ticket single-turn
                                   // retro-join (§9). Per-TURN %, deliberately NOT capEff's per-day %.
const LAPS_PER_DAY_CEIL = Math.floor(86400 / LIMIT_WINDOW_SEC);   // = 6 — the 4h buy-limit refill ceiling; a
                                   // churn lane can re-lap at most this many times/day (LIMIT_WINDOW_SEC is the SoT).
const MIRAGE_PLACEMENT = 0.85;     // PLACEHOLDER (n≈0, freshly invented per §10 Q3) — "mirage top" ask-side placement bar
const MIRAGE_REACH_FRAC = 0.70;    // PLACEHOLDER (n≈0, freshly invented) — "still mediocre" recent-reach bar for the mirage rule

// roiPct(er): after-tax per-TURN ROI% off the rank estimate — er.net (per-unit tax-net) ÷ er.pair.bid.
// ONE formula for every price basis (band/churn/amplitude/…), null-guarded; never reads a per-basis row field.
function roiPct(er) {
  return (er && er.net != null && er.pair && er.pair.bid > 0) ? er.net / er.pair.bid * 100 : null;
}
// holdDays(spec, er, lapsCap): the fraction of a day this pick ties capital up. A churn lane frees +
// re-commits the SAME capital up to LAPS_PER_DAY_CEIL (6)×/day, bounded ALSO by how long one lap takes to
// sell (86400/ttf) — the achievable laps/day is the SLOWER of the two constraints; holdDays is its
// reciprocal. Every other family is single-turn: TTF in days, floored at 1h (mirrors TTF_FLOOR_DAYS's
// spirit — no divide-by-tiny).
// POLISH 2 — REALIZABLE-THROUGHPUT bound (buy-limit at the deployed size): a raw 86400/ttf laps/day is a
// FANTASY for a fast-selling cheap item (Sunfire splinters read 198%/d) — you can't cycle the whole
// deployed position that fast because the 4h buy limit caps how many units you can RE-BUY per day. When the
// caller passes `lapsCap` (= limit × windows/day ÷ deployUnits — the position-level buy-limit throughput,
// computed in collectDigestRow off the SAME deployUnits the deployable-capital weight uses), holdDays is
// LENGTHENED to at least 1/lapsCap. It can only ever SLOW the rate, never grant a free speed-up; null (no
// limit / no size, e.g. the lean-log call) → unchanged (backward-compatible — the fixtures pin this).
function holdDays(spec, er, lapsCap = null) {
  const ttfSec = (er && er.ttf && er.ttf.value != null) ? er.ttf.value : 0;
  let hd;
  if (spec && spec.estimator === 'churn') {
    const lapsPerDay = Math.min(LAPS_PER_DAY_CEIL, Math.max(1, 86400 / Math.max(ttfSec, 1)));
    hd = 1 / lapsPerDay;
  } else {
    hd = Math.max(ttfSec, 3600) / 86400;
  }
  if (lapsCap != null && lapsCap > 0) hd = Math.max(hd, 1 / lapsCap);   // more windows to recycle the position ⇒ LONGER holdDays
  return hd;
}
// capEfficiency(spec, er, { lapsCap }) = after-tax ROI% earned per DAY of capital tied up (%/day). The
// digest's DISPLAYED + RANKING metric — it ties efficiency to time so a fast small win can out-rank a slow
// big one, and rewards a recycling churn lane via its small holdDays. With `lapsCap` (POLISH 2) it reads as
// a SUSTAINED rate you could actually hold, not a raw per-day extrapolation off a tiny TTF. null (never
// throws) when roiPct is unavailable. INFORM/lean-only, never a gate. The lean suggestions.jsonl log calls
// it WITHOUT lapsCap (the intrinsic per-turn efficiency, size-independent → calibration-friendly + the
// backward-compatible shape); the digest calls it WITH lapsCap (the realizable, deployed-size-aware rate).
export function capEfficiency(spec, er, { lapsCap = null } = {}) {
  const roi = roiPct(er);
  if (roi == null) return null;
  const hd = holdDays(spec, er, lapsCap);
  return hd > 0 ? roi / hd : null;
}
// isBigTicket(row): the pre-buy per-unit analogue of BIG_TICKET_GP (the lot-value threshold momVerdict uses).
const isBigTicket = row => !!(row && row.mid != null && row.mid >= BIG_TICKET_GP);
// weakDeploy(spec, row, er): a BIG-TICKET single-turn (non-churn) pick whose per-TURN margin barely clears the
// risk of parking that much capital in ONE item — flags at roiPct < WEAK_DEPLOY_ROI_PCT. Fires for ALL
// non-churn families ALIKE (band/scalp/value/amplitude) — churn is the ONLY exempt lane (its recycling is
// rewarded in capEff's RANKING via holdDays, not by exempting the per-turn FLAG). Keyed on roiPct (per-turn),
// deliberately NOT capEff (per-day). INFORM-only: a lean suggestions field + a digest token, never a gate.
export function weakDeploy(spec, row, er) {
  const roi = roiPct(er);
  return !!(isBigTicket(row) && spec && spec.estimator !== 'churn' && roi != null && roi < WEAK_DEPLOY_ROI_PCT);
}
// gradeAtLeast(grade, floor): grade is at least as good as `floor` on the GRADE_CUTOFFS scale (lower index = better).
function gradeAtLeast(grade, floor) {
  const order = GRADE_CUTOFFS.map(([g]) => g);
  const gi = order.indexOf(grade), fi = order.indexOf(floor);
  return gi >= 0 && fi >= 0 && gi <= fi;
}
// liveCrossable(row) (W3-1, PLAN-OSCILLATION-CYCLE): is the LIVE spread profitably crossable RIGHT NOW —
// i.e. does the tax-inclusive live-spread margin (row.quickRoi = quickNet ÷ quickBuy, the ONE tax/margin
// home in js/quotecore.js) clear tax-breakeven? This is the digest's biggest single denoiser: cheap high-%
// "spreads" (Jade necklace, Ironwood plank) whose live instasell ≈ instabuy top the capEff leaderboard yet
// are uncrossable. Returns true (crossable) / false (spread closed now) / null (no live print → UNKNOWN,
// treated as unknown-neutral: NOT demoted, NOT flagged — a missing read is never a punishment). DISTINCT
// from the one-sided-book "ghost spread" (see the header note above). DIGEST-ONLY, inform, never a gate.
const LIVE_CROSSABLE_MIN_ROI = 0;   // n≈0 PLACEHOLDER — anchored to tax-breakeven (quickRoi>0 after tax) for the first cut, NOT an arbitrary bar
export function liveCrossable(row) {
  if (!row || row.quickRoi == null) return null;   // no live print → UNKNOWN, do not punish a missing read
  return row.quickRoi > LIVE_CROSSABLE_MIN_ROI;
}
// digestVerdict(...): the ONE new computed digest field — a deterministic triage WORD, evaluated top-to-bottom,
// first match wins (§3.2 rule table). All thresholds PLACEHOLDER (n≈0), inform-only — the shape of the
// judgment, not a calibrated cutoff. `reachFrac` is the RECENT ask-reach fraction (null for a reach-exempt
// symmetric niche or a no-read row); `askPlacement` is the quoted ask's percentile in the 14-day daily-HIGH
// distribution (null when no read); `phase` is the diurnalPhase phase string (null when no diurnal profile).
// `low-conviction` is the honest fallback — "nothing cleared a positive signal," NOT "bad."
export function digestVerdict({ spec, row, er, grade, reachFrac, askPlacement, marginTrend = null, placementDiverges = false, phase, crossable = null } = {}) {
  // 0 (W3-1): TOP priority — an uncrossable live spread is a HARDER fact than the soft 'mirage top' below.
  // Only `false` (a live print that fails tax-breakeven) fires; `null` (no live read) is unknown-neutral.
  if (crossable === false) return 'spread closed now';
  const reachExists = reachFrac != null;
  if (reachExists && reachFrac < REACH_GRADE_CAP_FRAC) return 'sell unreliable';                       // 1: a bad sell you can't realize beats a thin margin
  // 2: MIRAGE TOP — high in its own distribution AND still-mediocre recent reach. R5 (PLAN-SIGNAL-RECENCY)
  // ESCALATES to a HIGH-confidence 'mirage top!' when BOTH extra confirmations hold: the recent-vs-full
  // placement DIVERGENCE (recent days abandoned the top) AND a `fading` ask cushion trend. Either signal
  // ALONE keeps the base caution word — the escalation never WIDENS what fires mirage top (the base
  // placement/reach condition still gates), it only sharpens confidence within it (don't over-fire, rule 4).
  if (askPlacement != null && askPlacement > MIRAGE_PLACEMENT && reachExists && reachFrac < MIRAGE_REACH_FRAC)
    return (placementDiverges && marginTrend === 'fading') ? 'mirage top!' : 'mirage top';
  if (weakDeploy(spec, row, er)) return 'weak deploy';                                                 // 3: thin per-turn margin on a big-ticket single-turn
  if (phase === 'post-peak') return 'starter / hold-to-next-peak';                                     // 4: cooling → size/entry-timing is the point, never fill-now
  if (gradeAtLeast(grade, 'B-')) return 'fill-now';                                                    // 5: nothing worse fired and the grade holds
  return 'low-conviction';                                                                              // 6: no positive signal cleared — check the full row
}

// PLAN-CAPITAL-EFFICIENCY-AND-DIGEST Workstream C — the cross-niche digest candidate pool, collected during
// each renderMode/renderAmplitudeMode pass (the watchClosely precedent: a Map/array filled while niches
// render, printed ONCE after the RUN_MODES loop in main() via realLog). STDOUT-ONLY, --digest-gated — never
// a screen.json/last-report field. Each entry: { name, capEff, rank, reachFrac, phase, grade, verdict }.
const DIGEST_ROWS = [];
// digestReachFrac(spec, askReachExtra): the RECENT ask-reach fraction for the digest's reach ✓/✗ column and
// verdict rules 1/2. A reach-exempt symmetric niche (churn/amplitude — fillShape 'symmetric') → null (renders
// '—', NOT '✗' — a false alarm, per §3.4); no reach read → null. Prefers the RC1 recent-3 count, full window fallback.
function digestReachFrac(spec, askReachExtra) {
  if (spec && spec.fillShape === 'symmetric') return null;
  if (!askReachExtra) return null;
  if (askReachExtra.recentDays) return askReachExtra.recentHit / askReachExtra.recentDays;
  return askReachExtra.nDays ? askReachExtra.reachedDays / askReachExtra.nDays : null;
}
// POLISH 3 — STALE-LIVE GUARD for the digest's reach ✓/✗ + mirage read. A row's quoted optSell can be
// pinned to a STALE live instabuy print (an old /latest tick, not a live one — the SAME failure quote-
// items.mjs's `staleLiveNote` catches off `row.quickStale`, the QUICK_FRESH_MIN freshness flags computeQuote
// sets). When the SELL-side live print is stale, the ask-reach read (scored at that stale optSell) is a
// FALSE positive — the honest reference is the FRESHER instasell (row.quickBuy). This recomputes reach +
// placement against that fresher level off the 14-day daily-HIGH distribution (rbStats.his, already in hand),
// so a stale-inflated reach ✓ flips to the honest read. DIGEST-SCOPED: it touches ONLY the digest's
// reach/placement/mirage — never the screen's own reach validator notes, screen.json, or quote-items output.
// Non-stale rows fall straight through to the unchanged askReachExtra/optSell path (byte-identical).
// R4b (PLAN-SIGNAL-RECENCY): `days` is rbStats.days (the per-day windowStats buckets already in hand) — it
// feeds the ask-side reachMargin CUSHION-TREND token (fading|stable|extending), the digest-surface wiring of
// R4's rebased reachMargin. It informs the reach ✓/✗ column WITHOUT replacing it: a reach ✓ whose cushion
// over the ask is `fading` is a peak cooling ONTO the quoted sell (the godsword shape). Scored at the SAME
// `refLevel` the reach/placement use, so a stale-guarded row's trend reads at the fresher reference too;
// non-symmetric only (a symmetric churn/amplitude ask trend mismeasures the tight two-sided band → null → '—').
export function digestReachAndPlacement({ spec, row, askReachExtra, his, days } = {}) {
  const symmetric = !!(spec && spec.fillShape === 'symmetric');
  const optSell = (row && row.optSell != null) ? row.optSell : null;
  // reuse row.quickStale (the staleLiveNote source): sell-side live print stale → the fresher instasell is
  // the honest current reference. Only guards when a distinct fresher level exists.
  const staleSell = !!(row && row.quickStale && row.quickStale.sell);
  const fresher = (row && row.quickBuy != null) ? row.quickBuy : null;
  const guarded = staleSell && optSell != null && fresher != null && fresher !== optSell;
  const refLevel = guarded ? fresher : optSell;
  const askPlacement = (his && his.length && refLevel != null) ? placement(his, refLevel) : null;
  let reachFrac;
  if (symmetric) reachFrac = null;
  else if (guarded && his && his.length)
    // recompute reach off the daily-HIGH distribution at the honest (fresher) reference — the validator's
    // recent-3 reach was scored against the stale optSell, so it can't be trusted here.
    reachFrac = his.filter(h => h != null && h >= refLevel).length / his.length;
  else reachFrac = digestReachFrac(spec, askReachExtra);
  // R4b: the ask-side cushion trend at refLevel. reachMargin only needs the per-day buckets + the level for
  // its trend (pace/profile omitted — the digest surfaces trend only), so this is zero new fetch. Degrades
  // to null (→ '—') on a symmetric niche, a thin day sample, or no in-hand buckets — never a fake read.
  const marginTrend = (!symmetric && Array.isArray(days) && days.length && refLevel != null)
    ? (reachMargin(days, 'ask', refLevel)?.trend ?? null) : null;
  // R5: the recent-vs-full placement DIVERGENCE (the whole-window-CDF analogue of RC1's recencySplit hit-count
  // idiom). askPlacement is the level's percentile in the FULL 14-day daily-HIGH distribution; recentPlacement
  // is its percentile in just the recent-3 days' highs. When the level sits HIGHER in the recent CDF than the
  // full one by ≥ RECENCY_DIVERGE (recent days abandoned that top), it's a stale-optimistic top — the SECOND
  // confirming signal the mirage rule ANDs with a falling cushion trend to escalate confidence. Directional
  // (recent − full ≥ threshold), not |diff|: a level that got EASIER recently is the opposite of a mirage.
  let placementDiverges = false;
  if (!symmetric && Array.isArray(days) && days.length && refLevel != null && askPlacement != null) {
    const recentHis = days.slice(-RECENT_NIGHTS).map(([, n]) => n && n.hi).filter(x => x != null).sort((a, b) => a - b);
    if (recentHis.length) {
      const recentPlacement = placement(recentHis, refLevel);
      placementDiverges = (recentPlacement - askPlacement) >= RECENCY_DIVERGE;
    }
  }
  return { reachFrac, askPlacement, staleGuarded: guarded, marginTrend, placementDiverges };
}
// collectDigestRow(...): compute the realizable capEff + the deployable-throughput RANK KEY + the verdict for
// one surfaced candidate and push it into DIGEST_ROWS. Skips sub-floor rows (NOT qualified picks, §3.4) and
// held rows (Workstream B's positions read owns those). rankKey = capEff × deployable capital ≈ after-tax
// deployable gp/day (raw capEff is SCALE-FREE, so dust-tier cheap high-% items swept the top-N and buried the
// big-ticket deploys the digest exists to surface — the SAME failure valueScore's deployable-capital blend
// already solved; we reuse its deployUnits three-way min). deployUnits = valueScore's EXACT min(bankroll ÷
// buy price, 10% market-share over 2 days, buy-limit accumulation), capGp = the FULL deployable pool
// (VALUE_CAPITAL — --capital or the derived deployablePool, NOT ÷slots: the digest triages a single
// concentrated deploy, and ÷slots would push a 50m big-ticket below 1 unit and demote exactly that class).
// POLISH 2: capEff is bounded to a REALIZABLE rate — lapsCap = limit × windows/day ÷ deployUnits, the
// position-level buy-limit throughput (you can only re-buy `limit` units per 4h window, so a big deployed
// position recycles slowly). INFORM-ONLY: it only reorders the presented view. bigTicket (row.mid ≥
// BIG_TICKET_GP) is stored for the guaranteed-visibility slice (POLISH 1) — an ordering AID, never a re-rank.
// SOFT-BUY WINDOW (INFORM-ONLY PLACEHOLDER, n≈0 — same status as phase/reach/verdict): the diurnal DIP
// window (the cheapest hours of day to BUY) + where the LIVE instabuy currently sits vs that dip FLOOR
// (prof.dip.level). The digest is a BUY-triage surface, but its only timing cell was `phase` — which reads
// the PEAK (sell-cycle) window, not the buy window — so a buy decision couldn't see WHEN the item is soft
// or whether NOW is a good entry (the blowpipe miss: bought 10.67m while the 00:00–02:00 dip prints ~10.40m).
// Reuses the footer Diurnal-timing idiom (fmtHour dip window) off the SAME in-hand `prof` — zero new fetch,
// no `dr` threading needed. STDOUT-ONLY: never gates/drops/regrades and never enters screen.json (frozen
// schema 2). Returns null when no diurnal profile / dip window exists (→ '—' cell).
const SOFT_BUY_AT_FLOOR_PCT = 0.5;   // live within 0.5% of (or below) the dip floor → it's soft NOW ("@floor")
function digestSoftBuy(prof, row) {
  if (!prof || !prof.dip || prof.dip.startH == null || prof.dip.endH == null) return null;
  const win = `${fmtHour(prof.dip.startH)}–${fmtHour(prof.dip.endH)}`;
  const floor = prof.dip.level, live = row ? (row.quickBuy ?? null) : null;
  if (floor == null || floor === 0 || live == null) return win;   // window known, live-vs-floor unavailable
  const pct = (live - floor) / floor * 100;
  // @floor = you can buy at/near the dip floor right now; +X% = live sits X% above the dip → wait for the window.
  const mark = pct <= SOFT_BUY_AT_FLOOR_PCT ? '@floor' : `+${pct.toFixed(pct < 10 ? 1 : 0)}%`;
  return `${win} · ${mark}`;
}
function collectDigestRow({ id, name, spec, row, er, grade, reachFrac, askPlacement, marginTrend = null, placementDiverges = false, prof, subFloor }) {
  if (subFloor) return;                       // sub-floor fallback rows are never "top-8 decision" candidates
  if (HELD_IDS.has(id)) return;               // a held item's read belongs to the positions surface, not the buy-triage digest
  const ph = prof ? (diurnalPhase(prof)?.phase ?? null) : null;
  const buyLow = (er && er.pair && er.pair.bid != null) ? er.pair.bid : null;
  const units = deployUnits({ buyLow, limitVol: row ? (row.volDay ?? null) : null, limit: row ? (row.limit ?? null) : null, capGp: VALUE_CAPITAL });
  const deployable = (units != null && buyLow != null) ? units * buyLow : null;
  // POLISH 2 buy-limit lap cap: the deployed position recycles at most limit×(windows/day) units per day, so
  // its laps/day of the WHOLE position is (limit × LAPS_PER_DAY_CEIL) ÷ deployUnits. Only binds when the
  // position is large vs the limit; a small (big-ticket) position keeps its ttf-driven rate. Null → no bound.
  const lapsCap = (row && row.limit != null && units != null && units > 0) ? (row.limit * LAPS_PER_DAY_CEIL) / units : null;
  const capEff = capEfficiency(spec, er, { lapsCap });
  const crossable = liveCrossable(row);   // W3-1: is the live spread profitably crossable now? true/false/null(unknown)
  DIGEST_ROWS.push({
    name,
    capEff,
    deployable,
    rankKey: (capEff != null && deployable != null) ? capEff * deployable : null,
    rank: er && er.rank != null ? er.rank : null,
    reachFrac,
    marginTrend,   // R4b: ask-side cushion trend (fading|stable|extending|null) — informs the reach ✓/✗, stdout-only
    phase: ph,
    softBuy: digestSoftBuy(prof, row),   // inform-only n≈0 diurnal dip window + live-vs-floor marker (stdout-only)
    grade,
    bigTicket: isBigTicket(row),
    crossable,   // W3-1: FLOORS the sort key when === false (uncrossable), NEVER mutates the displayed capEff; null = unknown-neutral
    verdict: digestVerdict({ spec, row, er, grade, reachFrac, askPlacement, marginTrend, placementDiverges, phase: ph, crossable }),
  });
}
// buildDigestBlock(): the rendered digest string. The MAIN block = top ~8 across ALL niches this pass, ranked
// by the DEPLOYABLE-THROUGHPUT rank key (capEff × deployable capital ≈ after-tax deployable gp/day) desc,
// ties broken by capEff then rank. capEff stays a DISPLAYED column (realizable %/day per POLISH 2); a
// `deploy` column shows the deployable capital so the ordering is legible (why a big-ticket you can park 40m
// into out-ranks a dust flip you can only put 100k into, even at a higher raw %).
// POLISH 1 — GUARANTEED BIG-TICKET SLICE (visibility, NOT a re-rank): pure deployable-gp/day tops the digest
// with high-throughput churn, so the low-fuss big-ticket lane (mid ≥ BIG_TICKET_GP) can miss the visible
// top-8 and the judgment layer can't see it to weigh it. If fewer than BIG_TICKET_MIN big-ticket rows made
// the main block, APPEND a small labeled sub-section with the next BIG_TICKET_SLICE big-tickets (same columns,
// same rankKey order within the slice) — additive, mirroring how the value niche surfaces a MIX. The MAIN
// ordering is untouched. A VIEW — every candidate is still in screen.json / the per-niche table.
const DIGEST_TOP = 8;
const BIG_TICKET_MIN = 2;     // if the visible top-8 has fewer than this many big-tickets, append the slice
const BIG_TICKET_SLICE = 3;   // how many extra big-tickets the guaranteed-visibility slice shows
// R4b: the ask-side cushion-trend token beside the reach ✓/✗. fading = the cushion over the quoted sell is
// shrinking (a peak cooling onto the ask — read the ✓ with suspicion); extending = headroom growing; stable
// = holding. null (symmetric niche / thin sample / no read) → '—'. INFORM-ONLY, never re-ranks or gates.
const digestTrendCell = t => t === 'fading' ? '↓ fade' : t === 'extending' ? '↑ ext' : t === 'stable' ? 'stable' : '—';
const digestCells = r => [
  { t: r.name },
  { t: r.capEff != null ? `${round2(r.capEff).toFixed(2)}%/d` : '—' },
  { t: r.deployable != null ? fmtP(Math.round(r.deployable)) : '—' },
  { t: r.reachFrac == null ? '—' : (r.reachFrac >= REACH_GRADE_CAP_FRAC ? '✓' : '✗') },
  { t: digestTrendCell(r.marginTrend) },
  { t: r.phase || '—' },
  { t: r.softBuy || '—' },   // SOFT-BUY WINDOW — inform-only n≈0 dip window + live-vs-floor (sits BESIDE phase: buy-window vs peak-cycle)
  { t: r.grade },
  { t: r.verdict },
];
export function buildDigestBlock(pool = DIGEST_ROWS) {
  const lines = ['## DECISION DIGEST — deployable-throughput triage (INFORM-ONLY, PLACEHOLDER n≈0 — never gates; ranked by capEff × deployable capital ≈ after-tax deployable gp/day, NOT raw %; capEff = realizable ROI%/day, buy-limit-bounded)'];
  if (!pool.length) { lines.push('(no candidates this pass)'); return lines.join('\n'); }
  // W3-1: an uncrossable live spread (crossable === false) is FLOORED to -Infinity in the comparator ONLY so it
  // sinks to the bottom — the stored/displayed `capEff` is NEVER mutated (the column still shows the true number)
  // and the row STILL RENDERS (never silently dropped, mirroring the subFloorLabel doctrine). null (unknown) is
  // unknown-neutral → keeps its natural key.
  const key = r => (r.crossable === false ? -Infinity : (r.rankKey != null ? r.rankKey : (r.capEff != null ? r.capEff : -Infinity)));
  const sorted = [...pool].sort((a, b) =>
    (key(b) - key(a)) || ((b.capEff ?? -Infinity) - (a.capEff ?? -Infinity)) || ((b.rank ?? -Infinity) - (a.rank ?? -Infinity)));
  const main = sorted.slice(0, DIGEST_TOP);
  const tableRows = main.map(digestCells);
  // POLISH 1: guaranteed big-ticket slice, appended only when the main block under-represents them.
  const bigInMain = main.filter(r => r.bigTicket).length;
  if (bigInMain < BIG_TICKET_MIN) {
    const shown = new Set(main);
    const bigExtra = sorted.filter(r => r.bigTicket && !shown.has(r)).slice(0, BIG_TICKET_SLICE);
    if (bigExtra.length) {
      tableRows.push([{ t: '— big-ticket lane (guaranteed visibility) —' }, { t: '' }, { t: '' }, { t: '' }, { t: '' }, { t: '' }, { t: '' }, { t: '' }, { t: '' }]);
      for (const r of bigExtra) tableRows.push(digestCells(r));
    }
  }
  lines.push(mdTable(['Item', 'capEff', 'deploy', 'reach', 'trend', 'phase', 'soft-buy', 'grade', 'verdict'], tableRows));
  return lines.join('\n');
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
// ctx from the computeQuote row + phase (the same shape item-context.mjs's pathsStage derives for held lots,
// minus the position/floor fields a screen candidate doesn't have — those degrade in js/held-item-strategy.mjs), then
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

// VZ4a (PLAN-VIZ-LAYER) — assemble a niche's table + footer notes into ONE plain screen-report object
// (R4), rendered by render.mjs's renderReport. PURE (no fetch/fs/clock): it takes the ALREADY-computed
// header lines, the table (headers+structured cells, or null → '_none_'), the Est. explainer (non-RAW),
// and the footer note lines, and only decides section ORDER + the blank-line contract, so it is testable
// off fixtures. Byte-identical to the pre-VZ4a console.log sequence (every line was its own console.log
// with no inter-blank; the report emits them as flush lines / an mdTable section joined by '\n'). The
// screen footer note families keep their compute-site wording (several carry a mid-string variable or a
// suffix, so the sigil is not a pure prefix like quote's — they route through formatNote unchanged as
// pre-formatted strings). The --publish screen.json payload is built SEPARATELY from `rows` (frozen
// schema 2) and is NOT touched here. Consumed by renderMode; pinned by pipeline/test/render.test.mjs.
// VZ4b extends this to ONE report per niche: `extraSections` (the diurnal / overnight-accumulation /
// velocity / entry-paths / stats blocks + the trailing blank line) are appended AFTER the footer, so the
// whole niche prints through a single renderReport call. Every section is blank:false (the pre-VZ4 output
// was a flush console.log sequence with no inter-blank line); the trailing blank between niches rides as
// the caller's final `{type:'lines', lines:[''] }` extra section.
export function buildScreenNicheReport({ headerLines = [], table = null, estExplainer = null, footerLines = [], extraSections = [] } = {}) {
  const sections = [];
  sections.push({ type: 'lines', lines: headerLines, blank: false });
  if (table) {
    sections.push({ type: 'table', headers: table.headers, rows: table.rows, blank: false });
    if (estExplainer) sections.push({ type: 'lines', lines: [estExplainer], blank: false });
  } else {
    sections.push({ type: 'lines', lines: ['_none_'], blank: false });
  }
  sections.push({ type: 'lines', lines: footerLines, blank: false });
  sections.push(...extraSections);
  return { kind: 'screen', generatedAt: null, sections };
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
function renderMode(mode, { cand, survivors, excluded = [], subFloor = null }, qcache, map, series5m, series6h, series1h, v24, daily, { partition = false } = {}) {
  const rows = [];
  const dist = {};
  const disc = { falling: 0, notRising: 0, breakdown: 0, posture: 0, rescued: 0, reject: 0, caution: 0, negNet: 0, notFalling: 0, partition: 0 };  // post-fetch discard reasons (--stats)
  const rejReasons = {};   // P2: reject reason → count, for the `rejected: N (top reasons)` footer
  const cautionNotes = []; // P2: one flagged-caution note per item (the row still shows)
  const informNotes = [];  // 2026-07-09: inform-mode validator findings (trajectory/reach analysis) — decision support, never a drop
  const headroomNotes = []; // Bar E ask-headroom (PLAN Bar-E-signal): the robust p90 shaved a TRADED in-band top off the quoted ask — sibling inform note, never a gate/drop/grade/screen.json input
  const windowClearNotes = []; // PLAN-WINDOW-CLEAR B2 (churn/scalp): the ask reaches on days but rarely IN its peak window / size ≫ window pool — sibling inform note, never a gate/drop/grade/screen.json input
  const driftNotes = []; // PLAN-OSCILLATION-CYCLE Chunk 6 (band/churn/scalp): the per-thesis drift-adjusted exit — sibling inform note off the shared driftExitFrom, never a gate/drop/grade/screen.json input
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
    const sv = surviveMode(mode, row, ph, { phaseRescue: PHASE_RESCUE, posture: POSTURE, thin: s.thin, series5m: series5m && series5m.get(s.id), held: HELD_IDS.has(s.id) });
    if (sv.rescued) disc.rescued++;
    if (!sv.keep) { disc[sv.discardReason]++; continue; }
    const rescued = sv.rescued;
    const name = map.byId[s.id]?.name || ('#' + s.id);
    if (sv.heldFallingOverride) informNotes.push(`⚠ ${name}: shown despite falling (${mode} normally excludes fallers) — you HOLD this item; price-to-clear, not a buy signal`);
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
    warmOverride(ts, series1h && series1h.get(s.id));   // warm .trajectory AND .recentTrend (R3) off the 1h series while loadDaily is cold
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
    }, { specs: FLIP_NICHES[mode].validators });
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
    if (FLIP_NICHES[mode].fillShape === 'asym' && series1h && series1h.get(s.id)) {
      const st = windowStats(series1h.get(s.id), { nights: ASYM_NIGHTS, wStart: 0, wEnd: 0 });
      asymRead = st ? asymPair(st) : null;
      if (asymRead) asymEr = asymEstimate(FLIP_NICHES[mode], row, asymRead);
    }
    // PLAN-OUTPUT-TABLE: the diurnal profile + the reconciliation estimate (Est. buy/sell) — computed
    // off the DEFAULT row (before any --asym reprice) from data ALREADY in hand (the Leg-B 1h series,
    // the bid/ask reach reads above) — zero new fetch. prof/dr are stored on the row and REUSED by the
    // Diurnal timing block below (same pure math, computed once). The est pair is logged to the
    // suggestions ledger unconditionally (the F1 accrual) and rendered as the DEFAULT table columns
    // (--raw restores Quick/Optimistic); it never touches the published screen.json cells.
    const prof = hourProfile(series1h && series1h.get(s.id), { nights: DIURNAL_NIGHTS });
    const dr = prof ? deriveDiurnalRange(prof, { liveLo: row.quickBuy ?? null, liveHi: row.quickSell ?? null }) : null;
    // RC-S2 (PLAN-REACHABILITY-CONSOLIDATION): the pressure-driven reachable band off the SAME in-hand
    // 1h series (zero new fetch) — extends the five-way exit-estimator head-to-head from held lots to the
    // discovery surface (reachRelief=estSell + asym already log here; reach rides estConfidence). DEPTH
    // stays OFF the screen — a per-row clearableAsk read is the DE7 fetch-budget decision, out of scope.
    // Inform-only: the `reachable` shadow field only (never a gate/drop/grade/screen.json input).
    const rbStats = (series1h && series1h.get(s.id)) ? windowStats(series1h.get(s.id), { nights: 14, wStart: 0, wEnd: 0 }) : null;
    const reachable = rbStats ? reachableBand(rbStats) : null;
    // PLAN-REMOVE-DEPTH-PRESSURE-READS chunk 2 (2026-07-22): the DC3 demand-regime flip-side classifier
    // (`demReg` — the inform note + the `demandRegime` shadow field) was REMOVED along with `demandRegime`
    // itself (narrow removal — the Extension-B demand-cycle read never fed the gate/rank/grade/screen.json).
    // rev2: strategy-aware entry (estimatePair reads STRATEGY[mode]'s falling/priceBasis doctrine).
    // FIX 1 (2026-07-13): declared-exit anchoring is DELIBERATELY NOT applied on the discovery screen —
    // a bare candidate row is a "should I buy this" read, never a held lot, so a declared SELL exit
    // (a held-lot plan) must not inflate its Est. sell/net. Declared-exit anchoring lives ONLY on the
    // held-lot surfaces (quote-items.mjs --positions/watch-positions.mjs verdict frame, and quote-items.mjs per-item ONLY when
    // that id is actually held). So no declaredExit is passed here.
    // PLAN-LIQUIDITY-REACH: dayHigh = the observed trailing-24h 5m-bucket max off the SAME in-hand 5m
    // series (zero new fetch) — Part B's de-bias reference. estimatePair applies it (and the Part-A fold
    // softening) ONLY when reachRelief > 0 (liquid book, small limit÷flow); a thin book is byte-identical.
    // R5 (PLAN-SIGNAL-RECENCY): the ask-side reachMargin CUSHION trend at the quoted band top (row.optSell),
    // off the SAME in-hand per-day rbStats buckets (zero new fetch). estimatePair's reach-fold reads only
    // .trend — a `fading` cushion tightens the sell fold even when the raw reach is a clean 3/3 (the +412k
    // bludgeon / godsword mirage). Null (no buckets / no optSell / thin) ⇒ no fade ⇒ byte-identical. This is
    // a DIFFERENT read from R4b's digest trend (that's scored at the stale-guarded refLevel for the display
    // column; this is scored at the band top the fold actually folds down from).
    const askMargin = (rbStats && rbStats.days && row.optSell != null) ? reachMargin(rbStats.days, 'ask', row.optSell) : null;
    // PLAN-OSCILLATION-CYCLE Chunk 6 — the per-thesis drift-adjusted EXIT inform note (band/churn/scalp).
    // Slopes + the diurnal projection come from data ALREADY in hand — `rbStats.days` (the daily windowStats
    // buckets, ZERO new fetch) → floorCeilingTrack's ceiling/floor slope, `prof` (the hourProfile) →
    // diurnalForecast — composed by the SHARED driftExitFrom (one-home, Chunk 2 established the caller
    // pattern; NOT forked). Direction-agnostic by construction (driftExitFrom passes the slope as a signed
    // number; driftInformNote's arithmetic has NO branch on its sign). INFORM-ONLY: a sibling note, never a
    // gate/drop/grade/screen.json input — the spec's `driftInform` label drives the wording, so this is a
    // registry-line read, not an `if (mode===...)` branch. Passes buy-side `optBuy` as the entry so the note
    // states the drift-adjusted after-tax margin. driftInformNote returns null (no note) when the spec has no
    // driftInform or the projection degraded. F-C (2026-07-22): pass THIS spec's own driftInform.holdDays
    // (band/churn/scalp → DRIFT_INTRADAY_HOLD_DAYS, the ~2h Bar-E hold — was silently defaulting to the
    // amplitude lane's 1.5-DAY horizon, wildly overstating the residual-horizon drift shift on an
    // hours-long flip) — undefined ⇒ driftExitFrom's own generic fallback (unaffected for any future spec
    // that doesn't set it).
    const driftExit = (prof && rbStats && rbStats.days) ? driftExitFrom(prof, rbStats.days, {
      liveLo: row.quickBuy, liveHi: row.quickSell, phase: row.phase, mom: row.mom, reliable: row.reliable,
    }, { holdHorizonDays: FLIP_NICHES[mode].driftInform?.holdDays }) : null;
    const driftNote = driftInformNote(FLIP_NICHES[mode], driftExit, { entry: row.optBuy, fmt });
    if (driftNote) driftNotes.push(`${name}: ${driftNote.text}`);
    const estExtra = {
      bidReach: reachExtra, askReach: askReachExtra,
      diurnal: dr ? { bid: dr.bid, ask: dr.ask } : null,
      asym: asymRead,
      dayHigh: dayHighFrom5m(series5m && series5m.get(s.id)),
      reachable,   // PB4: the pressure-exit price source (ignored unless the flag is on)
      askMargin,   // R5: the ask cushion trend — a fading top tightens the sell fold (mirage fix)
    };
    // PC3: the ACTIVE sell-model drives the DISPLAY/rerank (estShown); every DEFAULT-SHADOW model
    // (SELL_MODEL.shadow — reach-fold today) runs each pass and rides suggestions.jsonl as the unbiased
    // retro co-log. `est` is the neutral reach-fold in BOTH the ledger slot (estBuy/estSell/estConfidence)
    // and the degrade case, whether it is active OR a shadow beside the pressure trial — byte-identical to
    // the pre-PC3 "neutral always logged, pressure only displayed". A future registered shadow (safe-
    // quantile, AC3) loops here off SELL_MODEL.shadow into its own ledger field, no shell change. No
    // declaredExit on the discovery screen (a bare candidate is a buy read).
    const estFor = name => estimatePair(FLIP_NICHES[mode], row, estExtra, { nudge: anchorNudge, sellModel: name });
    const estShown = estFor(SELL_MODEL.active);
    const est = SELL_MODEL.active === 'reach-fold' ? estShown : estFor('reach-fold');
    // PLAN-ESTIMATOR-POSTURE AC1/AC6: the band-low buy carries a PLACEMENT PERCENTILE beside its touch-reach —
    // where estBuy sits in the 14-day daily-LOW distribution (rbStats.lows, already computed above for
    // reachableBand → ZERO new fetch). A low pXX = "below most daily lows" = a deep/patient entry (the
    // js/windowread.mjs placement doctrine). BAND + CHURN (AC6 routed churn's entry to 'band-low' too, so it
    // now qualifies — placement is a distribution position, not the invalidated reach signal; churn's reach
    // token is suppressed by foldExempt but the percentile stays). scalp/value never reach it. Attached to
    // the est confidence so estPairCells renders `(4/14 · p36)` and estConfLean shadows it for the F1 join.
    // estShown (a pressure trial under --est-sell) renders 'pressure' in the cell regardless, so its
    // placement is a harmless shadow.
    if (est && est.confidence.doctrine === 'band-low' && rbStats && rbStats.lows && rbStats.lows.length) {
      est.confidence.buyPlacement = placement(rbStats.lows, est.estBuy);
      if (estShown && estShown !== est && estShown.estBuy != null)
        estShown.confidence.buyPlacement = placement(rbStats.lows, estShown.estBuy);
    }
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
    let er = estimateRank(FLIP_NICHES[mode], row, { reach: reachExtra, askReach: askReachExtra });
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
    // PLAN-REMOVE-DEPTH-PRESSURE-READS chunk 2 (2026-07-22): the DC3 demand-tilt inform note was REMOVED
    // with `demandRegime` (narrow removal — Extension-B demand-cycle read, never a rank/gate input).
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
    // R7 (PLAN-SIGNAL-RECENCY): track WHICH ceiling bound the printed letter (legibility only — never a
    // gate/rank input). The caps apply sequentially (rateItem's THIN first, then these three); the LAST one
    // to actually LOWER the grade is what bounds the visible letter, so each binding cap overwrites cappedBy.
    let cappedBy = r.cappedBy || null;   // THIN (from rateItem) if it bound
    const cap = (g, ceiling, name) => { const c = capGrade(g, ceiling); if (c !== g) cappedBy = name; return c; };
    let grade = rescued ? cap(r.grade, PHASE_BASING_GRADE_CAP, 'phase-basing') : r.grade;
    if (subFloor) grade = cap(grade, SUBFLOOR_GRADE_CAP, 'sub-floor');
    // Proposal B (PLAN-GRADE-REACH): a mirage exit can't advertise a headline letter. When the quoted ASK
    // reaches < REACH_GRADE_CAP_FRAC of recent days, cap the grade (Proposal A already shrank the rank
    // number; this guarantees the LETTER an operator reads can't oversell it). Same capGrade site as above.
    // PART II churn exemption: a 'symmetric'-fillShape niche (churn) is exempt — its lap exit sells into
    // continuous two-sided flow, so the day-high reach read mismeasures it (mirrors estimateRank's askF skip).
    if (FLIP_NICHES[mode].fillShape !== 'symmetric' && askReachExtra && (askReachExtra.reachedDays / askReachExtra.nDays) < REACH_GRADE_CAP_FRAC)
      grade = cap(grade, REACH_GRADE_CAP, 'reach');
    const std = stdCells(name, row);                        // structured cells: [item, guide, quick, optimistic, vol, momentum, regime]
    // AR2 (PLAN-ARCHITECTURE-COHERENCE, MARKER option): if admission.mjs pulled this row into the
    // FETCH pool via its Date.now()-bucketed exploration reserve (s.via==='explore'), it's a rotating
    // "lottery" slot for THIS pass, not a ranked-in pick — surface a small 🎲 token on the Item cell so
    // the reader can tell the two apart (honest about WHY the row appears). Inform-only: the row still
    // went through the identical rate/gate/render path as every other survivor, so this touches no
    // gate/rank/grade/screen.json number. Mutates only this call's fresh std copy (quoteCells returns a
    // new array each call); the app-side tooltip rides on `title` (cellText ignores it — stdout stays clean).
    if (s.via === 'explore') std[0] = { ...std[0], t: std[0].t + ' 🎲', title: 'exploration-rotation slot — pulled into the fetch pool by the rotating reserve this pass (not ranked in); inform-only' };
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
    // R7 (PLAN-SIGNAL-RECENCY): when a ceiling bound the letter but no per-cap title above already named it
    // (the pure REACH-cap case → a plain `{t:grade}` cell), add the legibility tooltip. App-side only —
    // cellText ignores `title`, so stdout stays clean; the structured `cappedBy` on the row is the queryable form.
    if (cappedBy && !gradeCell.title) gradeCell.title = `grade capped by ${cappedBy}`;
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
    // AC9(b): the FILL-PROBABILITY WEIGHT for the overnight sort (below). The overnight board is what
    // Ben sizes UNATTENDED capital on, so it must lead with edges that will actually FILL overnight —
    // P(fill) has to DOMINATE. The first cut multiplied optNet by askReachFactor, but that floors at
    // PFILL_ASKREACH_FLOOR=0.25 and reads the ASK leg ONLY, so a rank-0 / P~0.00 row (its P is driven to
    // zero by the BID-side reach in estimateRank's pFill, not the ask) kept ≥25% of its raw net and still
    // sorted high (Extended stamina(4): rank 0, P~0.00, sorted #2). The fix: use the rank's full two-leg
    // P(fill) — `er.pFill.value` = family/entry (bid) reach × askF (ask reach, churn-exempt per
    // families.mjs:251). A P~0.00 row now weights ~0 and sinks; a reachable high-P edge leads. Symmetric
    // niches (churn) stay EXEMPT at weight 1 — the reach read mismeasures a tight two-sided churn band
    // (Ben 2026-07-12), so churn's overnight order stays raw-optNet, UNCHANGED from the first AC9(b) cut.
    const ovWeight = (FLIP_NICHES[mode].fillShape === 'symmetric') ? 1 : (er.pFill?.value ?? 0);
    // PLAN-CAPITAL-EFFICIENCY-AND-DIGEST (Workstream C): the digest's reach ✓/✗ + verdict inputs, off data
    // ALREADY in hand (zero new fetch) — the RECENT ask-reach fraction (symmetric niches → null → '—') and
    // the quoted ask's placement in the 14-day daily-HIGH distribution (rbStats.his, same rbStats the band-low
    // placement token already reads). Stored on the row; the digest is collected after the sort below.
    // POLISH 3: reach + placement through the stale-live guard (falls back to the fresher instasell as the
    // reference when the sell-side live print is stale, so a stale-pinned optSell can't fake a reach ✓).
    const { reachFrac: digestReach, askPlacement: digestAskPlacement, marginTrend: digestMarginTrend, placementDiverges: digestPlacementDiverges } = digestReachAndPlacement({ spec: FLIP_NICHES[mode], row, askReachExtra, his: rbStats && rbStats.his, days: rbStats && rbStats.days });
    rows.push({ id: s.id, row, grade, cells, score: r.score, er, asymEr, probeStr, validators: leanValidators(vres), pathWeighed, est, estShown, prof, dr, expGpDay: s.expGpDay, expGpDayLegacy: s.expGpDayLegacy, winClear, reachable, ovWeight, digestReach, digestAskPlacement, digestMarginTrend, digestPlacementDiverges, cappedBy });
    dist[grade] = (dist[grade] || 0) + 1;
  }
  // sort: active weights the risk-adjusted score (velocity-inclusive); overnight weights NET EDGE per
  // unit (patient band-edge net/u) over velocity — you want the fattest unattended margin, not churn.
  // AC9(b) (PLAN-ESTIMATOR-POSTURE): the overnight primary key is FILL-PROBABILITY-WEIGHTED net edge —
  // optNet × P(fill) — so the unattended-capital board leads with edges that will actually FILL overnight
  // and a rank-0 / P~0.00 row (a bid that won't reach, a stale-top mirage) sorts to the BOTTOM, not the
  // top. This supersedes the first AC9(b) cut (optNet × askReachFactor), which floored at 0.25 and read
  // the ask leg only, so a P~0.00 row kept ≥25% of its net and still sorted high (Extended stamina(4) #2).
  // Using the rank's full two-leg pFill (bid×ask) makes P(fill) dominate the way the overnight posture
  // needs — you're away, the offer MUST fill. Symmetric niches (churn) carry ovWeight=1 → their order is
  // raw optNet, UNCHANGED (the reach signal is invalid for a tight two-sided churn band). Console-only
  // (POSTURE never enters the published screen.json cells). CAUTION: this INTENTIONALLY reorders overnight.
  if (POSTURE === 'overnight') rows.sort((a, b) => ((b.row.optNet || 0) * (b.ovWeight ?? 1)) - ((a.row.optNet || 0) * (a.ovWeight ?? 1)) || b.score - a.score);
  else rows.sort((a, b) => b.score - a.score);
  // PB4: under the pressure-exit trial, RERANK the CONSOLE by the pressure NET (Est. sell − Est. buy of
  // the reachableBand legs) so pressure-attractive picks surface — the reliability guard already keeps a
  // thin book from getting a bold number. Rows WITHOUT a pressure read fall to the bottom (keep the base
  // order among them). SAFE re screen.json: --publish is refused under --pressure-exit (the hard guard),
  // so screen.json is never written on a pressure run — this reorder is console-only by construction.
  if (PRESSURE_EXIT) {
    const pNet = r => (r.estShown && r.estShown.confidence.pressureExit && r.estShown.estNet != null) ? r.estShown.estNet : -Infinity;
    rows.sort((a, b) => pNet(b) - pNet(a));
  }

  // PLAN-CAPITAL-EFFICIENCY-AND-DIGEST (Workstream C): feed this niche's SORTED, surfaced rows into the
  // cross-niche decision digest (printed ONCE after every niche in main() under --digest). collectDigestRow
  // excludes sub-floor + held rows. This never reorders/alters `rows` — the per-niche table + screen.json
  // are untouched (§1.4: the digest is a DIGEST-ONLY presentation choice, not the table's sort key).
  for (const r of rows) collectDigestRow({ id: r.id, name: map.byId[r.id]?.name || ('#' + r.id), spec: FLIP_NICHES[mode], row: r.row, er: r.er, grade: r.grade, reachFrac: r.digestReach, askPlacement: r.digestAskPlacement, marginTrend: r.digestMarginTrend, placementDiverges: r.digestPlacementDiverges, prof: r.prof, subFloor });

  // O1 suggestions ledger: log every rated (surfaced) row at emit time, unconditionally. The niche
  // is `mode`; the emitted "verdict" is the letter grade the row was surfaced under.
  // P4c: log the surfacing spec's inferred DEFAULT entry path on each row so a later fill can infer the
  // thesis a position was entered under when no explicit declare-thesis.mjs --path was declared.
  const defaultPath = FLIP_NICHES[mode].defaultPath;
  // P6c: sub-floor rows ARE logged (a surfaced row Ben acts on must stay joinable to its fill for the
  // F1 calibration), but each carries a lean `subFloor: <'min-gpd'|'liquidity'>` marker (the YS2
  // absent-field pattern — normal rows stay byte-identical) so calibration can segment or exclude them
  // and a ledger reader can never mistake one for a floor-qualified suggestion.
  logSuggestions('screen', { mode, params: SCREEN_PARAMS },
    rows.map(r => suggestionEntry(r.row, { itemId: r.id, cls: liqClass(r.row), volSrc: 'bulk', verdict: r.grade, grade: r.grade, posture: POSTURE, validators: r.validators, path: defaultPath, subFloor: subFloor ? subFloor.relaxed : null, cappedBy: r.cappedBy, ...estFields(r.er),
      // PART II shadow field: the asymmetric estimate BESIDE the symmetric rank (same row → the F1 A/B join)
      asym: asymShadow(r.asymEr),
      // PLAN-OUTPUT-TABLE shadow pair: the reconciliation estimate the DEFAULT table renders (F1 scores estSell vs the realized sell)
      estBuy: r.est ? r.est.estBuy : null, estSell: r.est ? r.est.estSell : null, estConfidence: estConfLean(r.est),
      // PLAN-VOL24 shadow: the corrected /1h-composed trailing-24h volume beside the active (broken) /24h volDay
      volDayRolling: rollShadow(series1h, r.id),   // SF-3: screen's volDay is bulk /24h (v24) → volSrc 'bulk'. AZ-forward: grade = the rendered letter (verdict keeps it too — legacy readers)
      // PLAN-CAPITAL-THROUGHPUT shadow pair: the ACTIVE (capital-aware, default) expGpDay + the legacy
      // capital-blind expGpDayLegacy, so --stats/analyze/F1 can diff old-vs-new surfacing on real rows.
      expGpDay: r.expGpDay, expGpDayLegacy: r.expGpDayLegacy,
      // PLAN-CAPITAL-EFFICIENCY-AND-DIGEST lean shadow (YS2 absent-field pattern — old rows stay byte-identical):
      // capEff = after-tax ROI%/day of capital tied up; weakDeploy = the big-ticket thin-per-turn flag. INFORM-
      // ONLY (PLACEHOLDER n≈0) — never a gate/screen.json field; here so the retro-join can later calibrate them.
      capEff: (er => er != null ? round2(er) : undefined)(capEfficiency(FLIP_NICHES[mode], r.er)), weakDeploy: weakDeploy(FLIP_NICHES[mode], r.row, r.er) || undefined,
      // PLAN-WINDOW-CLEAR B2 shadow: the within-window clear read (churn/scalp; null elsewhere)
      winClear: r.winClear,
      // RC-S2 shadow: the pressure-driven reachable band (five-way head-to-head on the discovery surface)
      reachable: reachableShadow(r.reachable) })));
      // PLAN-REMOVE-DEPTH-PRESSURE-READS chunk 2: the DC3 `demandRegime` shadow field was REMOVED with demandRegime.

  // P5: the falling note is per-spec — a 'accept' niche (scalp) deliberately INCLUDES fallers.
  const fallNote = FLIP_NICHES[mode].falling === 'accept' ? 'fallers INCLUDED (the thesis)' : 'fallers excluded';
  // P6c: the sub-floor banner replaces the normal header line — it states up front that ZERO candidates
  // cleared the configured floors, WHICH floor was relaxed and its value, the cap, and that these rows
  // are NOT qualified. The bar was re-run beneath the floor, never silently lowered.
  // VZ4a (PLAN-VIZ-LAYER): the niche header + table + footer-note block is collected into ONE
  // screen-report (buildScreenNicheReport) and printed via renderReport — byte-identical to the prior
  // console.log sequence (every line was its own console.log with no inter-blank line). The
  // diurnal/accumulation/velocity/entry-paths/stats blocks below stay inline (VZ4b folds them in).
  const headerLines = [];
  // P6c: the sub-floor banner replaces the normal header line — it states up front that ZERO candidates
  // cleared the configured floors, WHICH floor was relaxed and its value, the cap, and that these rows
  // are NOT qualified. The bar was re-run beneath the floor, never silently lowered.
  if (subFloor) {
    headerLines.push(`## ${mode.toUpperCase()} — SUB-FLOOR FALLBACK — 0 candidates cleared the configured floors`);
    headerLines.push(`⚠ ${subFloorLabel(subFloor)}. Best ${SUBFLOOR_TOP} max, grades capped at ${SUBFLOOR_GRADE_CAP} — these rows did NOT qualify.`);
    headerLines.push(`(${rows.length} rated from ${cand.length} sub-floor gated, top ${survivors.length} fetched; ${fallNote})`);
  } else {
    headerLines.push(`## ${mode.toUpperCase()} — ${rows.length} rated (from ${cand.length} gated, top ${survivors.length} fetched; ${fallNote})`);
  }
  headerLines.push(PLAYBOOK[mode]);
  headerLines.push(`(band basis: ${BAND_HOURS}h, ≥${MIN_TRADED} traded windows any-side + two-sided; thin ≥${MIN_TRADED_THIN})`);
  // PM1: the dedicated `Probes` column is appended to the PRINTED table ONLY when at least one row
  // fired a probe — so with no module present (or none firing) the table is BYTE-IDENTICAL to pre-PM1
  // (the removability guarantee). It is deliberately NOT added to the published cells (screen.json /
  // the app render) — an app Probes column is a separate, APP_VERSION-bumping step (out of PM1 scope).
  const anyProbe = rows.some(r => r.probeStr);
  // PB4 loud trial banner (rule 4 — the prices/rank must never read as the calibrated default).
  if (PRESSURE_EXIT) headerLines.push('⚠ --pressure-exit: Est. buy/sell + the RANK use the UN-CALIBRATED pressure model (TRIAL; retro still scoring — NOT validated, NOT published). Reranked by pressure net. --raw / drop the flag to restore the neutral estimate + sort.');
  // PLAN-OUTPUT-TABLE: the DEFAULT print is the reconciliation-estimate view (Est. buy/sell replace
  // Quick+Optimistic; Grade moves after Regime); --raw (and --asym, which implies it) prints the
  // model-free view exactly as before. STDOUT-ONLY: r.cells (the raw layout) is what --publish ships
  // to screen.json either way, so the app contract is byte-identical regardless of the view.
  let printHeaders, printCells, estExplainer = null;
  if (RAW) {
    printHeaders = anyProbe ? [...HEADERS, 'Probes'] : HEADERS;
    printCells = anyProbe ? rows.map(r => [...r.cells, { t: r.probeStr, c: 'mini' }]) : rows.map(r => r.cells);
  } else {
    printHeaders = anyProbe ? [...HEADERS_EST, 'Probes'] : HEADERS_EST;
    // r.cells layout: [item, grade, guide, quick, opt, vol, mom, regime, rank] — reuse the shared
    // structured cells (phase-suffixed regime, sub-floor grade label) and swap in the est pair cells.
    printCells = rows.map(r => {
      const c = r.cells;
      const base = [c[0], c[2], ...estPairCells(r.estShown), c[5], c[6], c[7], c[1], c[8]];   // PB4: estShown = pressure legs under the flag, else the neutral est
      return anyProbe ? [...base, { t: r.probeStr, c: 'mini' }] : base;
    });
    if (rows.length) estExplainer = `(Est. buy/sell are ESTIMATES — strategy-aware entry (scalp near-live · value trough · band prices the band low + reach/percentile annotation · churn reach-folded to fill-now), reach-folded exit, PLACEHOLDER model n≈3–14. Confidence rides in the cell: the buy carries its RECENT-3 touch-reach and, on band rows, the placement percentile of the band-low bid within the 14-day daily-LOW distribution (e.g. 4/14 · p36 = a deep/patient entry); the sell carries the RECENT-3 reach, full window beside it only when they diverge (0/3 · 12/14 = stale); '–' = no read. This is a DISCOVERY screen — no held-lot declared-exit anchoring here. BE is model-free and floors Est. sell — a "(BE-floored)" ask means no profitable trade at model prices. --raw restores the model-free Quick/Optimistic columns.)`;
  }
  const table = rows.length ? { headers: printHeaders, rows: printCells } : null;   // null → the report renders '_none_'
  const footerLines = [`Grades: ${gradeDist(dist)}`];
  // P2: the coordinator-ruled reject footer — printed whenever any row was validator-REJECTED, naming
  // the count + the top-3 reasons. reachValidator still degrades to pass here (no 1h series fetched);
  // P3's floorValidator CAN reject (a buy parked well above the durable multi-week floor) once the
  // loadDaily archive has enough history — until it warms, floor also degrades to pass and this line is
  // absent (default output byte-identical). Caution rows still show; each is flagged on its own line.
  if (disc.reject > 0) {
    const top = Object.entries(rejReasons).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([why, n]) => `${why}×${n}`).join(', ');
    footerLines.push(`rejected: ${disc.reject}${top ? ` (${top})` : ''}`);
  }
  for (const c of cautionNotes) footerLines.push(`⚠ caution — ${c}`);
  for (const n of informNotes) footerLines.push(`ℹ trajectory/reach — ${n}`);
  for (const n of headroomNotes) footerLines.push(`⤴ ask headroom — ${n}`);
  for (const n of windowClearNotes) footerLines.push(`ℹ window-clear — ${n} — days-reach ≠ lap-clear (placeholder, n≈0)`);
  for (const n of driftNotes) footerLines.push(`ℹ drift-exit — ${n}`);
  // PART II: the asym-fill inform block — decision support only (P_bid = optionality annotation, never a
  // rank input by default; placeholder quantiles n≈14; the shadow `asym` ledger field is the F1 A/B data).
  for (const n of asymNotes) footerLines.push(`◆ asym fill — ${n}`);
  // DC3 (INFORM HALF): the demand-regime flip-side classifier — decision support only (never a rank/gate/
  // grade/screen.json input; the routing/rank half is F1-gated). One line per clearly-tilted survivor.
  // (PLAN-ESTIMATOR-POSTURE AC3 — the interim patient-band-edge divergence footer — was REMOVED once AC1
  // landed: the band buy leg now PRICES the band low natively (doctrine 'band-low'), so the real patient
  // edge shows in the Est. buy/sell/net columns directly and the compensating footer is redundant.)
  // VZ4b: the loose info blocks below (diurnal / overnight accumulation / velocity / entry paths / stats)
  // are collected as report sections and appended to the SAME niche report, printed ONCE at the end —
  // byte-identical to the prior inline console.log sequence (all flush, no inter-blank line).
  const extraSections = [];
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
    // ⏲ diurnal-PHASE entry-timing token (INFORM-ONLY PLACEHOLDER, n≈0 — js/windowread.mjs diurnalPhase):
    // where NOW sits in today's cycle vs the peak window, so a post-peak/cooling entry (the blowpipe miss —
    // maxed the buy limit as the peak closed → 5u stranded ~16h) is flagged AT entry, not discovered hours
    // later. Never gates/drops/regrades — a stdout support token only.
    const ph = diurnalPhase(prof);
    const phaseTok = !ph ? ''
      : ph.phase === 'in-peak' ? ` · ⏲ in-peak (closes ~${ph.hoursToPeakClose}h)`
      : ph.phase === 'pre-peak' ? ` · ⏲ pre-peak (opens ~${ph.hoursToNextPeak}h)`
      : ` · ⏲ post-peak — cooling, next peak ~${ph.hoursToNextPeak}h → starter size / hold-to-next-peak`;
    diurnalLines.push(`${candidate ? '★ ' : ''}${nm} — BID ${fmt(dr.bid)} (${dr.bidBasis}, dip ${win(dr.dipWindow)}) · ASK ${fmt(dr.ask)} (peak ${win(dr.peakWindow)})${edge}${trend}${phaseTok}`);
  }
  if (diurnalLines.length) {
    extraSections.push({ type: 'lines', blank: false, lines: [
      `Diurnal timing (peak-timing bid/ask off the in-hand 1h series — support, not a gate; ★ = clean diurnal candidate):`,
      ...diurnalLines.map(l => `  ↳ ${l}`),
    ] });
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
    extraSections.push({ type: 'lines', blank: false, lines: [`Overnight accumulation & capital (~${OVERNIGHT_SPAN_H}h span; bid→sell + up-to units + running capital — take lines top-down until your stated capital runs out):`] });
    extraSections.push({ type: 'table', blank: false, headers: accHeaders, rows: accCells });
    extraSections.push({ type: 'lines', blank: false, lines: [`(Up-to units = min(buy limit × 2, 8/24 × 10% × Vol/d) — an UPPER BOUND: assumes fills at your bid, prorates daily volume flat across the quiet hours, prices in no fill probability. Pair it with the fill-realism / Diurnal read above. Sell never below break-even.)`] });
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
      extraSections.push({ type: 'lines', blank: false, lines: [`velocity (outcomes.json${ageH != null ? `, ${ageH}h old` : ''}; descriptive per-item history, not a rate): ${tags.join(' · ')}`] });
    }
  }
  // P4c: the weighed ENTRY-PATH menu per surfaced row — the surfacing spec's inferred default path
  // (marked `*`) + the weighed alternatives from js/held-item-strategy.mjs (scalp / value-hold / avoid). Decision
  // SUPPORT, not a gate: it never hides or reorders a row (the block prints in the SAME sorted order as
  // the table above). STDOUT-ONLY — deliberately NOT in the published screen.json cells, so the
  // canonical table + app contract stay byte-identical (same discipline as the phase/velocity folds).
  if (rows.length) {
    extraSections.push({ type: 'lines', blank: false, lines: [
      `Entry paths (surfacing default \`*\` + weighed menu; support, not a gate — placeholder weights):`,
      ...rows.map(r => pathLine(map.byId[r.id]?.name || ('#' + r.id), r.pathWeighed, defaultPath)),
    ] });
  }
  // SC1 (PLAN-SCREEN-ARCHITECTURE, 2026-07-18) — exclusion visibility. UNCONDITIONAL (not behind
  // --stats): the bludgeon/sanguinesti anchor incident was invisible for months because nothing
  // reported that a real edge lost its fetch slot to a higher-gp-flow big ticket; this line exists
  // so that class of silent starvation can't happen again without being named every single pass.
  // Empty under `--admission legacy` (rankAndSlice never returns excluded) and on the value niche
  // (its own §F admitted/shown footer already covers this).
  if (excluded.length) {
    const best = excluded[0];   // pre-sorted desc by expGpDay in admission.mjs
    const bestName = map.byId[best.id]?.name || ('#' + best.id);
    extraSections.push({ type: 'lines', blank: false, lines: [
      `crowded out: ${excluded.length} gated candidate(s) never got a fetch slot (best excluded: ${bestName}, ~${fmt(best.expGpDay || 0)}/d expected net, reason: ${best.reason})`,
    ] });
  }
  if (STATS) {
    const fetched = survivors.length, kept = rows.length;
    const reasons = `falling ${disc.falling}` + (mode === 'scalp' ? `, not-falling ${disc.notFalling}` : '') + (partition ? `, band-lane partition ${disc.partition}` : '') + (POSTURE === 'overnight' ? `, posture ${disc.posture}` : '') + (PHASE_RESCUE ? `, basing-rescued ${disc.rescued}` : '') + `, validator-reject ${disc.reject}, validator-caution ${disc.caution}, neg-net ${disc.negNet}`;
    extraSections.push({ type: 'lines', blank: false, lines: [`stats: gated ${cand.length} | fetched ${fetched} | survivors ${kept} | yield ${fetched ? Math.round(kept / fetched * 100) : 0}% | discarded: ${reasons}`] });
  }
  // The trailing blank line that separated niches (the pre-VZ4 `console.log('')`) rides as a final
  // flush empty line, so the ONE renderReport call reproduces the whole niche's stdout byte-for-byte.
  extraSections.push({ type: 'lines', blank: false, lines: [''] });
  emitReport(buildScreenNicheReport({ headerLines, table, estExplainer, footerLines, extraSections }));   // AO1: accumulate into REPORTS + render (no-op stdout unless --verbose)
  // publishable rows (sorted-by-grade, byte-identical cells + itemId for the app's deep link).
  // P6c: sub-floor rows are STDOUT-ONLY — publish [] so screen.json/the app see exactly what a
  // pre-P6c empty niche published (byte-identical app contract, no APP_VERSION bump).
  if (subFloor) return [];
  // PB4 app-display (2026-07-15): each published row ALSO carries the pressure-driven `reachable` band
  // (reachableShadow — { ask, bid, pressure, reliability, bandLow, bandHigh }, already computed for the
  // RC-S2 co-log on every survivor). This is ADDITIVE DISPLAY DATA ONLY — the `cells`, the Grade, the
  // rank, and the NEUTRAL sort order are byte-unchanged, so screen.json's DECISION surface stays exactly
  // F1-gated. The app renders this band as a `pressure (trial)` column; the console rerank/reprice TRIAL
  // (--pressure-exit) stays a SEPARATE mechanism (still refused under --publish). No reachable read → omit.
  return rows.map(r => { const rb = reachableShadow(r.reachable); return rb ? { id: r.id, cells: r.cells, reachable: rb } : { id: r.id, cells: r.cells }; });
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
  const valueInformSpecs = FLIP_NICHES.value.validators.filter(v => typeof v === 'object' && v.mode === 'inform');
  // trajectory GATES in value (Ben 2026-07-09): a knife DROPS (named in the footer), elevated FLAGS. Scoped
  // to trajectory — the value spec's floor/limit are mode:'gate' too but stay dormant in this console path
  // (their gate home is valueGate + the absent 4h-limit window), so only trajectory is promoted to an
  // active drop here. Spec-driven: the gate fires only because the spec now says trajectory is 'gate'.
  const valueTrajGate = FLIP_NICHES.value.validators.find(v => typeof v === 'object' && v.key === 'trajectory' && v.mode === 'gate') || null;
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
    // PLAN-OSCILLATION-CYCLE Chunk 6 — the drift-adjusted exit informs the value-amplitude proximity read as
    // a NUMBER (does the drift-adjusted after-tax amplitude still clear the value economics against the
    // buy-low?). Sources the ceiling/floor slope + diurnal projection from data ALREADY in hand — a full-day
    // windowStats over the in-hand 1h series → floorCeilingTrack slopes, the same series → hourProfile —
    // composed by the SHARED driftExitFrom (NO new fetch, one-home). INFORM-ONLY: EXPLICITLY not a floor
    // relax/un-gate (R3b stays dropped) — it annotates the pick, never re-gates it. Direction-agnostic.
    const vt1h = series1h && series1h.get(s.id);
    const vStats = vt1h ? windowStats(vt1h, { nights: 14, wStart: 0, wEnd: 0 }) : null;
    const vProf = vt1h ? hourProfile(vt1h, { nights: DIURNAL_NIGHTS }) : null;
    // F-C (2026-07-22): value's own driftInform.holdDays (DRIFT_VALUE_HOLD_DAYS=14, multi-week — was
    // silently defaulting to the amplitude lane's 1.5-day horizon, wildly UNDERSTATING the drift a
    // multi-week hold actually rides).
    const vDae = (vProf && vStats && vStats.days) ? driftExitFrom(vProf, vStats.days, {
      liveLo: row.quickBuy, liveHi: row.quickSell, phase: ph && ph.phase, mom: row.mom, reliable: row.reliable,
    }, { holdHorizonDays: FLIP_NICHES.value.driftInform?.holdDays }) : null;
    const vDriftNote = driftInformNote(FLIP_NICHES.value, vDae, { entry: vr.buyLow, fmt: fmtP });
    if (vDriftNote) valueInformNotes.push(`${name}: ${vDriftNote.text}`);
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
    : (VALUE_CAPITAL_DERIVED ? ' — derived deployablePool from your cash anchor (derive-cash.mjs: free stack + reclaimable deep-bid escrow, deep bids classified off live prices); pass --capital <gp> to override'
      : ' — PLACEHOLDER capital; set an anchor (derive-cash.mjs) or pass --capital <gp> [--slots N] for your real figure');
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

// --- A2 (PLAN-AMPLITUDE-SCAN): the AMPLITUDE niche's own daily-cycle table -----------------------
// A dedicated console-only table (like the value niche): the amplitude lane does NOT use the fast-flip
// grade/verdict stack the same way — it prints the DAILY trough→peak swing, the both-leg recent-3 daily
// reach (the make-or-break viability read, §4), the hold horizon, net-per-cycle, and the deployable
// units, ranked by the EXISTING rank spine (net × P(fill) ÷ TTF via the 'amplitude' estimator family —
// NOT a bespoke composite). Every row is flagged PROVISIONAL (n≈0). Picks accrue via the O1 suggestions
// ledger (mode 'amplitude') with the §A5 shadow both-leg-replay block. OFF the app (excluded from
// screen.json); surfaces under deploy/accumulate, never as act-now rows (patient multi-hour plays).
const AMP_HEADERS = ['Item', 'Guide', 'Live', 'Daily swing (trough→peak)', 'Both-leg reach (recent / full) + phase', 'Net/cycle (after-tax)', 'Hold horizon', 'Deploy units', 'Grade'];
const AMP_NIGHTS = 14;   // the per-item daily windowStats lookback (full-day wStart:0,wEnd:0)

// PLAN-OSCILLATION-CYCLE F-F — the trough-vs-decay DISPLAY annotation for the amplitude reach cell.
// WHY: the "both-leg reach" cell reads recent-3 daily hits, but a 3-day window is SHORTER than the ~7–8d
// oscillation cycle — so a trough-phase oscillator reads a low recent reach (e.g. ask 0/3) at exactly the
// entry you want, over-implying "sell-unreliable". Full-vs-recent divergence ALONE can't tell a trough-phase
// oscillator (will recover) from a genuine decay (won't) — BOTH show full-high/recent-low. The real
// discriminator is slope + amplitude, which the lane ALREADY computes. This is a DISPLAY note, not a
// reach-window change: it touches nothing upstream of the gate.
// The 3-signal classifier (all already in local scope at the gate stage — NO new compute/fetch):
//   osc         = oscillationVsKnife(stats.days)  → osc.oscillating
//   dae         = driftExitFrom(...)              → dae.floorSlope (signed gp/day)
//   driftShadow = amplitudeDriftMargin(dae, ...)  → driftShadow.margin (signed after-tax margin)
// CRITICAL (F-F wording constraint, verified live): the knife bucket must NOT say "decay" or ANY
// floor-direction word. A RISING floor with COLLAPSED amplitude (the Aldarium mirage: rising+hollow →
// {oscillating:false, knife:true}) ALSO lands here — "decay" would be a false direction-label on a rising
// item, exactly the direction-labeling the whole program retired (js/forecast.mjs: "direction is only ever
// an intermediate of the arithmetic"). Keep it generic + direction-agnostic. n≈0 — this doesn't create a
// new claim, it stops an existing display from over-implying "sell-unreliable".
export function reachPhaseNote(osc, dae, driftShadow) {
  if (!(osc && osc.oscillating)) return 'no real cycle to harvest';   // knife — direction-AGNOSTIC (no floor word)
  const floorSlope = (dae && dae.floorSlope != null) ? dae.floorSlope : 0;
  if (floorSlope >= 0) return 'trough phase — floor holding, oscillation intact';
  const clears = !!(driftShadow && driftShadow.margin != null && driftShadow.margin > 0);
  return `oscillating into a falling floor — drift margin ${clears ? 'still clears' : 'does not clear'}`;
}
function renderAmplitudeMode({ cand, survivors }, qcache, map, series1h, guide) {
  const rows = [], sugg = [];
  const informNotes = [];
  const dropped = { noHistory: 0, ampFloor: 0, bidReach: 0, askReach: 0, trend: 0, knife: 0, marginFloor: 0, unaffordable: 0 };
  const DROP_KEY = { 'no-history': 'noHistory', 'amp-below-floor': 'ampFloor', 'bid-unreachable': 'bidReach', 'ask-unreachable': 'askReach', 'trend': 'trend', 'knife': 'knife', 'margin-below-floor': 'marginFloor' };
  for (const s of survivors) {
    const row = qcache.get(s.id);
    if (!row) continue;
    const name = map.byId[s.id]?.name || ('#' + s.id);
    const live = row.quickBuy ?? row.mid ?? s.mid;
    const ts1h = series1h && series1h.get(s.id);
    // Stage 2 (§2.1): the EXACT daily amplitude off ONE full-day windowStats call over the in-hand 1h series.
    const stats = ts1h ? windowStats(ts1h, { nights: AMP_NIGHTS, wStart: 0, wEnd: 0 }) : null;
    const ar = amplitudeRanges(stats, live, { holdDays: AMP_HOLD_DAYS, askQ: AMP_ASK_Q_EFF, bidQ: AMP_BID_Q_EFF });
    if (!ar.hasData) { dropped.noHistory++; continue; }
    // trend / knife guard: hourProfile's trendDominates (the "amplitude is drift" test) + the warm 1h
    // trajectory shape ('knife' = monotone decline). Oscillation around a flat level is the thesis.
    const prof = hourProfile(ts1h, { nights: DIURNAL_NIGHTS });
    const traj = trajectoryFrom1h(ts1h);
    const trendDominates = !!(prof && prof.trendDominates);
    const knife = !!(traj && traj.shape === 'knife');
    // PLAN-OSCILLATION-CYCLE Chunk 3B — the drift-aware oscillation-vs-knife detector. It TEMPERS the raw
    // `knife` above: a drift-riding oscillator (fang/blowpipe) is not a false knife and must reach the
    // margin gate, not die as `knife`.
    // F-H (2026-07-22): the detector reads a SEPARATE, LONGER trailing window (`OSC_DETECTOR_NIGHTS`, >
    // AMP_NIGHTS) — NOT the gate's `stats` — so it gets the ≥1.5 cycles / ≥3 legs of history it needs to
    // fire OSCILLATING WITHOUT widening the gate's own daily-range/reach/recency reads (which stay on the
    // AMP_NIGHTS `stats`). Same in-hand `ts1h`, NO new fetch — just a longer lookback into the SAME series
    // (endpoint-capped ~15d — an honest sample-size fix, see OSC_DETECTOR_NIGHTS in js/forecast.mjs).
    const oscStats = windowStats(ts1h, { nights: OSC_DETECTOR_NIGHTS, wStart: 0, wEnd: 0 });
    const osc = oscillationVsKnife(oscStats.days);
    // PLAN-OSCILLATION-CYCLE Chunk 3A — compute the drift-adjusted margin ONCE, HERE at the gate stage
    // (moved up from the render/shadow-log point below), so the SAME value feeds BOTH the margin-below-floor
    // gate AND the Chunk-2 shadow-log (one compute, reused — never computed twice). Slopes + diurnal
    // projection come from data ALREADY in hand — `stats.days` (daily windowStats) → floorCeilingTrack's
    // ceiling/floor slope, `prof` (the hourProfile) → diurnalForecast — via the shared driftExitFrom
    // pattern (NO new fetch). Direction-agnostic by construction (driftExitFrom passes the slope as a
    // signed number; amplitudeDriftMargin's arithmetic has NO branch on its sign).
    const dae = driftExitFrom(prof, stats.days, {
      liveLo: row.quickBuy, liveHi: row.quickSell, phase: row.phase, mom: row.mom, reliable: row.reliable,
    }, { holdHorizonDays: AMP_HOLD_DAYS });
    const driftShadow = amplitudeDriftMargin(dae, { entry: ar.ampBid });
    const g = amplitudeGate(ar, { trendDominates, knife, oscillating: !!(osc && osc.oscillating), driftMargin: driftShadow });
    if (!g.pass) { dropped[DROP_KEY[g.reason] ?? 'ampFloor']++; continue; }
    // rank via the EXISTING spine: the 'amplitude' estimator family (pFill = two-leg daily reach, ttf =
    // hold horizon, lapUnits = deployable min) → rankScore(net×P÷TTF). capGp = TOTAL REALIZABLE capital
    // (liquidCapital), UNDIVIDED — amplitude is a concentration lane, NOT ÷slots like value (Ben 2026-07-19).
    const capGp = AMP_CAPITAL;
    const lapUnits = ESTIMATORS.amplitude.lapUnits({ capGp, ampBid: ar.ampBid, limitVol: s.limitVol, limit: s.limit, holdDays: AMP_HOLD_DAYS });
    // The ONLY sizing gate that matters (Ben 2026-07-19): can you afford ≥1 unit if all lots were liquid?
    // lapUnits floors to 0 when capGp < the trough-bid → the pick is genuinely UNAFFORDABLE at this capital.
    // DROP it (don't show a phantom ~1u); these thin big-tickets legitimately need a bigger pool.
    if (!(lapUnits >= 1)) { dropped.unaffordable++; continue; }
    const pFill = ESTIMATORS.amplitude.pFill({ amplitudeRanges: ar });
    const ttf = ESTIMATORS.amplitude.ttf({ holdDays: AMP_HOLD_DAYS });
    const rank = rankScore({ net: ar.netPerCycle * lapUnits, pFill: pFill.value, ttfSec: ttf.value });
    const r = rateItem({ row, rank, thin: s.thin });   // thin-class by construction → THIN_GRADE_CAP applies (§2.1)
    const grade = r.grade;
    const ampPct = (ar.ampPct != null) ? (ar.ampPct * 100) : null;
    // F-F: surface the FULL-window reach alongside recent-3 (recencySplit already returns fullHit/fullN —
    // format change only), then annotate the trough-vs-decay phase so a low recent reach on a trough-phase
    // oscillator no longer over-implies "sell-unreliable". `osc`/`dae`/`driftShadow` are already in scope.
    const rf = t => `${t.recentHit}/${t.recentDays || AMP_HOLD_DAYS}·${t.fullHit}/${t.fullN}`;
    const reachCell = `${rf(ar.bidTouch)} · ${rf(ar.askReach)} — ${reachPhaseNote(osc, dae, driftShadow)}`;
    const cells = [
      { t: name }, { t: guide && guide[s.id] != null ? fmtP(guide[s.id]) : '—' }, { t: fmtP(live) },
      { t: `${fmtP(ar.ampBid)} → ${fmtP(ar.ampAsk)}` },
      { t: reachCell, c: 'mini' },
      { t: `+${fmtP(Math.round(ar.netPerCycle))}${ampPct != null ? ` (${ampPct.toFixed(1)}%)` : ''}`, c: 'gain' },
      { t: `~${AMP_HOLD_DAYS}d hold`, c: 'mini' },
      { t: `${lapUnits}u`, c: 'mini' },
      s.thin ? { t: grade, title: `thin: ~${s.limitVol}/day two-sided — big-ticket concentrated position, no fast exit if the thesis breaks; expect slow day-long fills` } : { t: grade },
    ];
    rows.push({ id: s.id, cells, score: rank });
    // PLAN-CAPITAL-EFFICIENCY-AND-DIGEST (Workstream C): feed the amplitude pick into the decision digest.
    // amplitude is the big-ticket CONCENTRATION lane, so its weak-deploy flag (§1.1 resolution 1 — NO
    // recycling carve-out) is exactly where a thin per-turn margin on a huge single-turn hold matters. Build
    // an estimateRank-shaped `er` from the amplitude family's own pair/net/ttf/pFill/rank so capEfficiency +
    // digestVerdict read it uniformly. reach column '—' (fillShape 'symmetric' → reach-exempt, §3.4).
    // W3-2 (PLAN-OSCILLATION-CYCLE): substitute the DRIFT-ADJUSTED margin for the naive netPerCycle in the
    // DIGEST rank basis ONLY (`ampEr.net` → capEff via roiPct), so a fading mirage (Aldarium: amplitude
    // collapses → driftShadow.margin goes NEGATIVE → negative capEff → sinks in the digest naturally). This is
    // DIGEST-ONLY and built AFTER rank(1666)/grade(1667)/cells(1675) — all of which keep ar.netPerCycle
    // untouched. driftShadow.margin can be negative; roiPct/capEfficiency null-guard and sort a negative low.
    // Degrade to ar.netPerCycle when no drift margin is available (null read) so a missing projection never
    // punishes a real amplitude edge.
    const ampEr = { pair: { bid: ar.ampBid, ask: ar.ampAsk }, net: (driftShadow && driftShadow.margin != null) ? driftShadow.margin : ar.netPerCycle, ttf, pFill, rank, lapUnits };
    collectDigestRow({ id: s.id, name, spec: FLIP_NICHES.amplitude, row, er: ampEr, grade, reachFrac: null, askPlacement: null, prof, subFloor: null });
    // A3: the 1.5-day experiment's day-of-week seasonality read (net-new — no day-of-week tooling existed).
    // Only surfaced when the hold crosses a day boundary (holdDays > 1) so leg-2 lands on a different weekday.
    if (AMP_HOLD_DAYS > 1) {
      const wp = weekdayProfile(ts1h, { nights: 28 });
      if (wp && wp.best && wp.worst) informNotes.push(`${name}: weekday amplitude — widest ${wp.best.label} (~${(wp.best.ampPct * 100).toFixed(1)}%, n=${wp.best.n}), thinnest ${wp.worst.label} (~${(wp.worst.ampPct * 100).toFixed(1)}%, n=${wp.worst.n}) — n≈3–4/cell, a lean not a law`);
    }
    // PLAN-OSCILLATION-CYCLE Chunk 2 shadow-log (now GATED by Chunk 3): `driftShadow` was computed ONCE at
    // the gate stage above and is REUSED here (no double-compute). As of Chunk 3 the same margin also DROVE
    // the margin-below-floor gate, so any survivor still standing here already cleared it — the shadow block
    // records the winning row's drift-adjusted margin alongside the naive ampBid/ampAsk.
    // §A5 — log the pick with the amplitude lane shadow block (the printed levels + both-leg recent reach
    // + dip/peak windows + holdDays), so the shadow both-leg replay joiner can measure the would-have-fill
    // rate as an UPPER BOUND, and the retro-join attributes realized round trips.
    sugg.push(suggestionEntry(row, {
      itemId: s.id, cls: liqClass(row), volSrc: 'bulk', verdict: 'AMP-CYCLE', grade, cappedBy: r.cappedBy, posture: POSTURE, path: 'scalp',   // R7: amplitude only applies rateItem's THIN cap → r.cappedBy
      bid: ar.ampBid, ask: ar.ampAsk, pFill: round2(pFill.value), ttfSec: ttf.value, rank: Math.round(rank),
      estBasis: `${pFill.basis}/${ttf.basis}`, estN: ar.nDays,
      amplitude: amplitudeShadow(ar, { holdDays: AMP_HOLD_DAYS, profile: prof, drift: driftShadow }),
      volDayRolling: rollShadow(series1h, s.id),
    }));
  }
  rows.sort((a, b) => b.score - a.score);
  logSuggestions('screen', { mode: 'amplitude', params: SCREEN_PARAMS }, sugg);

  const shown = rows.length;
  console.log(`## AMPLITUDE — ${shown} daily-cycle candidate(s) (PROVISIONAL — unproven 24h-swing theory, n≈0)`);
  console.log('Playbook: buy the daily TROUGH, sell the daily PEAK, hold ~a day, cycle. The edge is a big-ticket that oscillates ~a few % DAILY — the swing the band screen\'s 2h grain + net×P÷TTF rank is structurally blind to. PATIENT: these are multi-hour plays that surface under deploy/accumulate, NEVER as act-now rows.');
  console.log(`(daily amplitude off the per-item 1h windowStats full-day range; ranked by net × P(both-leg daily reach) ÷ hold-horizon — the standard rank at the amplitude estimator family; every threshold PLACEHOLDER, n≈0)`);
  console.log(`(CONCENTRATION lane — sized against ${fmtP(AMP_CAPITAL)} TOTAL REALIZABLE capital (liquidCapital, "if all lots sold"), used UNDIVIDED; --slots is IGNORED · hold horizon ${AMP_HOLD_DAYS}d${AMP_HOLD_DAYS > 1 ? ' (1.5-day experiment — crosses a day boundary; day-of-week read below)' : ''})`);
  // F-E: an EXPERIMENT run (non-default reach-vs-margin quantiles) is flagged so the operator knows the
  // board is NOT the standard median-peak/median-trough basis — and so is the ledger (amplitudeShadow logs askQ/bidQ).
  if (AMP_ASK_Q_EFF !== AMP_ASK_Q || AMP_BID_Q_EFF !== AMP_BID_Q)
    console.log(`(EXPERIMENT — reach-vs-margin dial: peak-ask quantile ${AMP_ASK_Q_EFF} (default ${AMP_ASK_Q}), trough-bid quantile ${AMP_BID_Q_EFF} (default ${AMP_BID_Q}) — a higher ask quantile = a better-but-less-reachable sell; logged to suggestions.jsonl so F-G can compare which quantile nets more)`);
  if (shown) console.log('\n' + mdTable(AMP_HEADERS, rows.map(r => r.cells)));
  else console.log('_none_');
  for (const n of informNotes) console.log(`ℹ weekday seasonality — ${n}`);
  // F-B: report the watchlist reserve honestly (0 when nothing on watchlist.json needed it — byte-identical wording otherwise).
  const watchReserved = survivors.filter(s => s.watched).length;
  console.log(`\nadmitted ${cand.length} (Stage-1 proxy) · fetched ${survivors.length} (top ${AMP_TOP_DEFAULT} by amplitude proxy${watchReserved ? ` + ${watchReserved} watchlist-reserved` : ''}) · shown ${shown} · dropped Stage-2: no-history ${dropped.noHistory}, amp-below-floor ${dropped.ampFloor}, bid-unreachable ${dropped.bidReach}, ask-unreachable ${dropped.askReach}, trend ${dropped.trend}, knife ${dropped.knife}, margin-below-floor ${dropped.marginFloor}, unaffordable ${dropped.unaffordable} (can't afford ≥1 unit at ${fmtP(AMP_CAPITAL)})`);
  console.log('⚠ thin — NO fast exit: these big-tickets are thin BY CONSTRUCTION (that\'s why the band screen misses them), so a large concentrated position can\'t be unwound quickly if the thesis breaks. INFORM, not a gate — size to your risk tolerance.');
  console.log('⚠ make-or-break (§4, n≈0): the gate measures the levels PRINTED; whether BOTH legs actually FILL within the hold horizon is the open question the shadow both-leg replay (join-amplitude-outcomes.mjs) + realized retro-join measure. The NEW `margin-below-floor` drift-adjusted-margin gate (PLAN-OSCILLATION-CYCLE Chunk 3) rides on the SAME n≈0 PLACEHOLDER threshold + the diurnal/drift projection — it is the make-or-break gate itself, not a validated filter. Do not trade on this yet.');
  console.log('');
  return rows.map(r => ({ id: r.id, cells: r.cells }));
}

// --- S3: watchlist always scanned -------------------------------------------------------------
// The pipeline can't read the browser's localStorage, so the watchlist source of truth is tracked
// repo-root watchlist.json (array of item names/ids). Every scan ALWAYS quotes every watchlisted
// item as a full standard row, EXEMPT from all floors/gates, graded, with the reason a gate WOULD
// have hidden it as a Note — and FALLING watchlist items ARE shown (the held/asked falling-exception
// now extends to watchlisted items). The app takes union(localStorage, repo file); write-back is M1.
// REPO ROOT = two levels up from pipeline/commands/ (this file's dir). The R3 rename (2026-07-15)
// moved this CLI pipeline/ → pipeline/commands/ but left REPO_ROOT at ONE `..` (→ pipeline/), so the
// scan silently read fills/watchlist/offers/outcomes from the wrong dir (degrading to empty) AND wrote
// screen.json/dip-watchlist.json to pipeline/ instead of the ROOT the app/sync/dev-server all read —
// the deployed Scan tab froze. Two `..` matches the sibling convention (watch-positions.mjs uses HERE/../..).
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Build 2: per-item velocity index from the gitignored outcomes.json (YV1 campaigns), loaded ONCE.
// Descriptive footnote source only — absent/unreadable/empty file → null → the footnote stays silent
// (never a fetch, never a fabricated tag). Refreshed by `join-outcomes.mjs --report`.
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
    const er = estimateRank(FLIP_NICHES.band, row);
    const r = rateItem({ row, rank: er.rank, thin });
    const std = stdCells(name, row);
    const gradeCell = thin ? { t: r.grade, title: `thin: ~${limitVol}/day two-sided — size in units, expect slow fills` } : { t: r.grade };
    const rankCell = { t: `${fmtP(r.score)} · net ${fmt(er.net || 0)} P~${er.pFill.value.toFixed(2)} ttf~${fmtTtf(er.ttf.value)}`, c: 'mini' };
    const cells = [std[0], gradeCell, ...std.slice(1), rankCell, { t: watchlistNote(row, d, bands, id, limit), c: 'mini' }];
    rows.push({ id, cells });
    sugg.push(suggestionEntry(row, { itemId: id, cls: liqClass(row), volSrc: 'bulk', verdict: r.grade, grade: r.grade, cappedBy: r.cappedBy, posture: POSTURE, ...estFields(er) }));   // SF-3: watchlist row's volDay is bulk /24h (v24). AZ-forward: grade letter logged explicitly · R7: THIN cap only → r.cappedBy
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
// held-item ids (2026-07-16) — same module-level-let-set-in-main pattern as BUYS_BY_ITEM above, so
// renderMode (a separate function) can read what main() loaded. Empty set ⇒ no override ⇒ byte-identical.
let HELD_IDS = new Set();
let TRACK_INDEX = null;   // admission.mjs track-record boost index (built from positions.json closed lots)
// F-B (PLAN-OSCILLATION-CYCLE post-landing follow-up) — the SAME repo-root watchlist.json ids the S3
// always-scanned watchlist pass reads (loadWatchlist below), read ONCE here too so gateAmplitudeCandidates
// can reserve a fetch slot for a watchlisted big-ticket even when it ranks below AMP_TOP_DEFAULT by the
// Stage-1 amplitude proxy. Empty set (absent/unreadable watchlist.json) ⇒ no reserve ⇒ byte-identical.
let WATCHLIST_IDS = new Set();
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
  // quality-ranked, self-pruning set — the bloat fix. Best-effort write (screen-flip-niches.mjs never touches git).
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
  // AO1: unless --verbose, no-op console.log for the whole pass (keeps `realLog` for the closing summary);
  // every renderMode niche is still captured into REPORTS for the dump via emitReport.
  const realLog = console.log;
  if (!VERBOSE) console.log = () => {};
  // ALWAYS sync first (Ben, 2026-07-16 — the /scan skill's "sync first, always" was doctrine an
  // agent could just forget; a real closed position went unnoticed as a result). Local/zero-git,
  // cheap, never blocks the screen on failure — this is the held-item exception's freshness input
  // too (HELD_IDS below reads positions.json right after this). AR1: the ONE shared invocation.
  runLocalSync({ offBookNote: 'screening off the current book' });

  pruneCache('ts', 24 * 3600 * 1000);                     // bound the per-item series cache
  BUYS_BY_ITEM = loadBuysByItem();                        // LM1: buy-limit windows for the validator ctx
  // CODE-ENFORCED held-item exception (2026-07-16 — was a /scan skill prose rule Ben had to remember to
  // apply manually every pass; moved here so a held item can't silently vanish from band/churn the
  // moment its regime flips to falling). Read-only, no fetch — degrades to an empty set on any error so
  // a positions.json problem never breaks the screen itself.
  try {
    const { groups, pos } = readOpenPositions(join(REPO_ROOT, 'positions.json'));
    HELD_IDS = new Set((groups || []).map(g => g.itemId));
    // Track-record admission boost (R4, Ben 2026-07-18): built from the SAME positions.json read —
    // no new fs/fetch. Absent/unparseable positions.json → empty index → boostOf degrades to 1
    // everywhere (byte-identical to no boost at all).
    TRACK_INDEX = buildTrackIndex(pos && pos.closed);
  } catch { /* no positions.json → nothing held, no track record → no override, exactly today's behavior */ }
  const map = await loadMapping();
  // F-B: read watchlist.json ids right after map load (loadWatchlist needs map.resolve). Best-effort —
  // an absent/unreadable file degrades to an empty set (no reserve), never breaks the screen.
  try { WATCHLIST_IDS = new Set(loadWatchlist(map).map(h => h.id)); } catch { /* keep empty */ }
  const [v24legacy, latest, guide] = await Promise.all([loadAll24h(), loadAllLatest(), loadGuide()]);  // independent endpoints — fetch concurrently, not summed round-trips
  // PLAN-VOL24 step 2 (Ben-validated): DEFAULT `rolling` — the corrected whole-market trailing-24h map (24
  // bulk /1h windows, mostly warm from the SQLite archive) is the ACTIVE volume behind every gate/rank/
  // column, with the volume floors count-matched to it in the same change. `--vol-source legacy` restores
  // the broken /24h map (escape hatch / pre-recal repro). loadAll24hRolling is a small extra fetch cost on a
  // cold archive (≤24 bulk /1h, mostly deduped against buckets loadSnapshot/loadDaily already accrue).
  const v24 = VOL_SOURCE === 'rolling' ? await loadAll24hRolling() : v24legacy;

  // Value --capital default = the DERIVED deployablePool (lib/derive-cash-tiers.mjs). Re-derive it here WITH a
  // marketRef built from the bulk /latest already in hand (ZERO extra fetch): each resting bid classifies
  // DEEP (reclaimable → counts toward deployable) vs COMMITTED (near-live, expected to fill → excluded)
  // using its item's live instasell (latest[id].low). A resting-bid item absent from /latest → no ref →
  // COMMITTED (conservative). Only re-derives when value runs on a DERIVED (non-explicit) capital.
  // A2 — amplitude reuses the same derived deployable pool for its lapUnits bankroll cap, so re-derive
  // the market-ref-refined figure when EITHER the value OR the amplitude gate runs.
  if (!VALUE_CAPITAL_EXPLICIT && VALUE_CAPITAL_DERIVED && RUN_MODES.some(m => FLIP_NICHES[m].gate === 'value' || FLIP_NICHES[m].gate === 'amplitude')) {
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
    AMP_CAPITAL = DERIVED_CASH.liquidCapital; // amplitude sizes against the LOOSER total-realizable pool, undivided
  }
  // PLAN-CAPITAL-THROUGHPUT (Ben 2026-07-14): sync the band/churn capital cap to the current deployable
  // pool (the market-ref-refined VALUE_CAPITAL if value ran above; else the conservative pre-derive pool,
  // or the explicit --capital). The FULL pool, NOT ÷slots — the attention floor asks "if I put everything
  // in this ONE lane…". Left null under --throughput legacy → gateCandidates uses the capital-blind value.
  if (THROUGHPUT_MODE !== 'legacy') THRESHOLDS.THROUGHPUT_CAP_GP = VALUE_CAPITAL;
  const bands = NEED_BANDS ? await loadBands(BAND_HOURS) : null;
  const { series: daily, coverageWindows } = await loadDaily(DAILY_DAYS, DAILY_STEP_H);  // bulk regime-proxy archive
  const ctx = { v24, map, bands, daily };   // P5: `daily` rides the ctx so the value gate can read the term structure

  // ADMIT: the fetch-pool admission call — dispatches on ADMISSION (default 'unified', PLAN-SCREEN-
  // ARCHITECTURE). `legacy` calls rankAndSlice exactly as before (excluded always [], byte-identical);
  // `unified` calls pickFetchPool (admission.mjs) — same shape, but the thin lane ranks on realistic
  // after-tax edge instead of raw gp-flow, a bounded exploration reserve rotates in starved candidates,
  // the track-record boost folds into every lane's sort key, and every non-admitted candidate comes
  // back with a reason instead of silently vanishing.
  const admit = (m, cand, opts) => ADMISSION === 'legacy'
    ? { survivors: rankAndSlice(m, cand, daily, opts), excluded: [] }
    : pickFetchPool(m, cand, daily, { ...opts, trackIndex: TRACK_INDEX });

  // gate every mode, then proxy-rank its gated pool and take the top-N fetch pool. P5 value ranks by
  // valueScore and takes a HARD top-N (VALUE_TOP_DEFAULT §F) — a bounded shortlist off a large pool.
  const gated = {};
  for (const m of RUN_MODES) {
    const cand = gateCandidates(m, ctx, THRESHOLDS, HELD_IDS, WATCHLIST_IDS);
    const top = FLIP_NICHES[m].gate === 'value' ? VALUE_TOP_DEFAULT
      : FLIP_NICHES[m].gate === 'amplitude' ? AMP_TOP_DEFAULT : TOP;
    // P6c: EMPTY at the configured floors → re-run the SAME gate stack beneath the floor (subFloorFallback's
    // relaxation ladder) and surface the best SUBFLOOR_TOP honestly labeled — never an empty table with the
    // opportunity silently invisible, never a silently lowered bar. Fires ONLY on a zero-candidate niche
    // (any niche with ≥1 candidate is untouched, byte-identical); if even the relaxed gate is empty (the
    // edge/market, not the floors, emptied it) the normal `_none_` output stands unchanged. The fallback
    // pool rides the same bulk data already loaded at gate time and the same per-item fetch path a normal
    // niche uses, capped at SUBFLOOR_TOP (≤5 — strictly fewer fetches than any non-empty niche's top-N).
    if (!cand.length && FLIP_NICHES[m].gate === 'band') {
      const fb = subFloorFallback(m, ctx, THRESHOLDS);
      if (fb) {
        const { survivors, excluded } = admit(m, fb.cand, { thinReserve: THIN_RESERVE, top: SUBFLOOR_TOP });
        gated[m] = { cand: fb.cand, survivors, excluded, subFloor: fb };
        continue;
      }
    }
    const { survivors, excluded } = admit(m, cand, { thinReserve: THIN_RESERVE, top });
    gated[m] = { cand, survivors, excluded };
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

  console.log(`# Opportunity screen — mode ${MODE.toUpperCase()}, posture ${POSTURE.toUpperCase()}, liquidity ${FLOOR}/d OR ${(GP_FLOOR/1e6).toLocaleString()}m gp-flow, min ROI ${MIN_ROI}% (thin: ${(MIN_NET_GP/1e3).toLocaleString()}k net/u), attention floor ${(MIN_GPD/1e3).toLocaleString()}k gp/d, ${MIN_PRICE.toLocaleString()}–${MAX_PRICE.toLocaleString()} gp, top ${TOP} fetched/niche, admission ${ADMISSION.toUpperCase()}`);
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
  for (const m of RUN_MODES) niches[m] = FLIP_NICHES[m].gate === 'value'
    ? renderValueMode(gated[m], qcache, map, series6h, series1h, guide, daily)   // P5 — the value niche's own term-structure table
    : FLIP_NICHES[m].gate === 'amplitude'
    ? renderAmplitudeMode(gated[m], qcache, map, series1h, guide)                // A2 — the amplitude niche's own daily-cycle table
    : renderMode(m, gated[m], qcache, map, series5m, series6h, series1h, v24, daily, { partition: m === 'churn' && partitionChurn });
  // PLAN-CAPITAL-EFFICIENCY-AND-DIGEST (Workstream C): print the ONE cross-niche decision digest, collected
  // during the niche renders above (the watchClosely precedent). --digest-gated + printed via `realLog` so it
  // appears even under the AO1 quiet default (console.log is a no-op there) — its own gate, independent of
  // --verbose. CONSOLE-ONLY: never written to screen.json / the last-report dump (the console-only scope lock).
  if (DIGEST) realLog('\n' + buildDigestBlock() + '\n');
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
    const outPath = join(REPO_ROOT, 'screen.json');   // the ROOT-LOCKED published snapshot (fixed by the REPO_ROOT R3 correction above)
    // P5: the VALUE niche has its OWN column set (VALUE_HEADERS) + is console-only (PLAN-VALUE decision
    // 4 — no app tab yet), so it is EXCLUDED from screen.json (which carries a single HEADERS set). An
    // app VALUE surface is a later, APP_VERSION-bumping step.
    const pubNiches = {};
    // value + amplitude are console-only (their own column sets; no app tab yet) → excluded from
    // screen.json (which carries a single HEADERS set). An app surface is a later, APP_VERSION-bumping step.
    for (const m of RUN_MODES) if (FLIP_NICHES[m].gate === 'band') pubNiches[m] = niches[m];
    // Stage-2 HTML (2026-07-16): a PRE-RENDERED html string per niche (+ watchlist), the pipeline-side
    // twin of js/ui.js's client-side scanTableHtml — additive sibling to `cells`, never a replacement
    // (an older app build that doesn't know about `html` still works off `cells` unchanged).
    const pubHtml = {};
    for (const m of Object.keys(pubNiches)) pubHtml[m] = renderHtmlTable(HEADERS, pubNiches[m]);
    if (watchlist) pubHtml.watchlist = renderHtmlTable(watchlist.headers, watchlist.rows);
    // Carry forward any existing `analysis` blurb (2026-07-16) — it's a judgment overlay set
    // separately via set-scan-analysis.mjs (the /scan skill's judgment PASS OVER a published
    // scan), not part of this script's own deterministic output, so a routine re-publish (e.g.
    // the recurring /scan loop) must not silently wipe it. Best-effort: a missing/corrupt prior
    // file just means no analysis to carry, never a publish failure.
    let priorAnalysis;
    try { priorAnalysis = JSON.parse(readFileSync(outPath, 'utf8')).analysis; } catch { priorAnalysis = undefined; }
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
      html: pubHtml,                   // Stage-2: pre-rendered per-niche (+watchlist) HTML, additive
      // S3 watchlist section — its own headers (adds a Note column) travel with it so the app renders
      // it as a distinct always-shown section; null when watchlist.json is empty/absent.
      watchlist: watchlist ? { headers: watchlist.headers, rows: watchlist.rows } : null,
      ...(typeof priorAnalysis === 'string' && priorAnalysis ? { analysis: priorAnalysis } : {}),
    };
    writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');
    console.log(`(published → screen.json: ${Object.keys(pubNiches).map(m => `${m} ${pubNiches[m].length}`).join(', ') || 'none'}${IS_VALUE ? ' — value niche is console-only, excluded from screen.json' : ''}${watchlist ? `, watchlist ${watchlist.rows.length}` : ''})`);
  }
  // AO1: always write the pass's report objects to the last-report dump (one file per invocation), then
  // unless --verbose surface the ONE summary line + path in place of the suppressed markdown.
  const rel = writeLastReport('screen', REPORTS);
  if (!VERBOSE) realLog(`# screen (quiet default; --verbose for the table) — mode ${MODE}: ${RUN_MODES.map(m => `${m} ${Array.isArray(niches[m]) ? niches[m].length : 0}`).join(', ')} → ${rel} (value niche is console-only, excluded)`);
}

// Run only when invoked directly (`node pipeline/commands/screen-flip-niches.mjs …`); importing the module (e.g. the
// NY2.1 risingPoolFloor unit check) must NOT fire a full screen / hit the API. process.argv[1] is
// undefined under `node -e`, so guard it (an eval context is never a direct invocation).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
