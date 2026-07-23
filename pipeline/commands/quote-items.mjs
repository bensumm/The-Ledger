#!/usr/bin/env node
/**
 * quote-items.mjs — the canonical market read for a Claude session. ONE command, finished table.
 * NEVER hand-write a `node -e` fetch for a market read again — this is the workflow.
 *
 * Two modes:
 *   node pipeline/commands/quote-items.mjs "Abyssal bludgeon" 23959 "Crystal seed" ...
 *       Per-item read: resolves each name/id, fetches latest/5m/6h/24h + GE guide, and
 *       prints the standard Quick/Optimistic market table (one combined table, one regime
 *       line per item).
 *   node pipeline/commands/quote-items.mjs --positions
 *       Positions-vs-market: reads OPEN lots from repo-root positions.json, groups by item
 *
 *   DEFAULT is now quiet: prints ONE summary line + the last-report dump path, not the markdown
 *       table. The report object is ALWAYS written to pipeline/.cache/last-report/quote.json
 *       (gitignored, overwritten per run) — read THAT file for the actual data; the summary line
 *       carries none. Pass --verbose for the markdown table (the "paste this to Ben" case). AO1,
 *       default flipped after Ben's correction: an agent must not treat the summary line as the
 *       read — quiet-by-default forces the JSON to be the only source, so it can't be skipped.
 *       at weighted-avg cost, quotes each held item live, and prints the standard table
 *       PLUS Held@ / Break-even columns + a HOLD / list-at-X / CUT verdict per row.
 *
 * ALL quote/tax/regime math comes from js/quotecore.js (imported) — this file only fetches
 * and formats. The ordering invariant optBuy ≤ quickBuy ≤ quickSell ≤ optSell is guaranteed
 * by computeQuote; a ⚠ basis flag prints if a feed inversion ever breaks it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runLocalSync } from '../lib/sync-invoke.mjs';   // AR1 — the ONE shared "always sync first" (SY1) invocation
import { computeQuote, QUOTE_HEADERS, isOvernightNow, phase, pressureText, askHeadroomText, rebidAdvice, maxBuyForExit, BIG_TICKET_GP } from '../../js/quotecore.js';   // BIG_TICKET_GP (PLAN-POSITIONS-WINDOW-READ) — the ≥10m whole-lot bar that gates the auto ask-side window-clear read
import { diurnalForecast, whenBuyable, whenSellable, fmtEta, driftExitFrom } from '../../js/forecast.mjs';   // #6 (PF1) — the "buyable/sellable in ~Xh" forecast lines off the in-hand hourProfile; driftExitFrom (PLAN-OSCILLATION-CYCLE Chunk 5) — the drift-adjusted exit LEVEL folded into the trajectory note
import { tax } from '../../js/money-math.js';
import { fmtP, fmt, fmtHour, fmtHourRange } from '../../js/money-format.js';
import { hourProfile, deriveDiurnalRange, softBuyRead, formatSoftBuy, windowStats, trajectoryRead, floorCeilingTrack, formatFloorCeiling, asymPair, touchedDays, reachedDays, recencySplit, windowClear, windowClearDiverges, reachableBand, clearableAsk, placement, askExitRead } from '../../js/windowread.mjs';   // softBuyRead/formatSoftBuy — per-held-lot ⏳ soft-buy timing (ADD-while-holding); PLAN-DRIFT-VS-CRASH — floorCeilingTrack/formatFloorCeiling: the phase-aligned floor+ceiling slope-asymmetry read folded under the trajectory line (both quote surfaces); COD-4 — diurnal BID/ASK timing off the now-in-hand 1h series; PART II — asym deep-bid/high-reach-ask pair off the same series; PLAN-OUTPUT-TABLE — touch/reach counts (+ RC1 recent-3 split) feed the est confidence; PLAN-WINDOW-CLEAR B2 — within-window clear read + divergence flag; RC-S2 — pressure/depth co-log; placement — the percentile read read-window-range.mjs surfaces (PLAN-QUOTE-PLACEMENT: fold it onto the quote itself, zero new fetch)
import { asymEstimate, estimatePair, estPairCells, estConfLean, EST_HEADERS, dayHighFrom5m, SELL_TOP_MODELS } from '../lib/estimators.mjs';   // PART II — the asymmetric-fill inform read (P_ask weight / P_bid optionality); PLAN-OUTPUT-TABLE — the reconciliation Est. buy/sell pair (default view; --raw restores Quick/Optimistic); PC3 — SELL_TOP_MODELS validates --est-sell
import { anchorNudge } from '../probes/anchor.mjs';   // PLAN-OUTPUT-TABLE — the ⚓ round-number nudge injected into estimatePair (final step; nudge, never override)
import { FLIP_NICHES } from '../../js/flip-niches.mjs';     // PART II — the neutral band thesis for the asym read (same convention as screen's watchlist rank)
import { warmOverride } from '../lib/warm-term-structure.mjs';   // COD-4 + R3 — warm .trajectory AND .recentTrend off ts1h so trajectoryValidator + floorValidator's recency gate FIRE on the explicit-ask surface
import { loadMapping, loadGuide, fetchItemInputs, loadSnapshot, loadDaily, loadAll24hWarm, fetchTsCached, vol24FromInputs } from '../lib/marketfetch.mjs';   // SF-3 — warm-only bulk /24h read (fetch-free class convergence); fetchTsCached — Proposal C's targeted 1h read; vol24FromInputs (PLAN-VOL24) — corrected per-item rolling-24h volume off the in-hand ts1h
import { staleExitRead, STALE_EXIT_RECENT_FRAC } from '../lib/staleexit.mjs';   // Proposal C — stale declared-exit auto-flag (inform-only)
import { readOpenPositions } from '../lib/positions.mjs';
import { readOffersSnapshot, askFromSnapshot, bidFromSnapshot } from '../lib/offers.mjs';   // P0 — offers.json book (the askFilling source quote lacked)
import { stdCells, writeLastReport } from '../lib/cli.mjs';   // mdTable is no longer called here — the table now renders via render.mjs's `table` section (VZ3); writeLastReport — AO1 agent-readable dump
import { resolve, loadPipelineConfig } from '../lib/compose.mjs';   // PC1 — the flag>config>default precedence resolver (routes --pressure-exit here)
import { renderReport } from '../lib/render.mjs';   // VZ3 (PLAN-VIZ-LAYER) — the ONE render layer; both modes build a report object and print renderReport(buildQuoteReport(...)); the flat lines[] is now typed note items (the sigil moved from the push site into render.mjs's per-kind formatter)
import { loadModules, runProbes, logFirings } from '../lib/probes.mjs';   // PM1 — probe-module system (per-item read surface); PM2 — firing log
import { logSuggestions, suggestionEntry, classAndSource, reachableShadow, depthExitShadow, asymShadow, windowExitShadow } from '../lib/suggestlog.mjs';   // SF-3 — classAndSource picks class + volSrc from a warm bulk map (or per-item fallback); RC-S2 — shared reachable/depthExit/asym ledger-shadow reshapers; WC1 — windowExitShadow (the window-clear ask-rung forward record)
import { runValidators, flags, leanValidators } from '../../js/validate.mjs';   // P2 — validator registry (reachValidator); quote NEVER hides a row, only annotates
import { buysByItem, limitWindow } from '../lib/limits.mjs';   // LM1 — per-item 4h buy-limit window (regime-line + limitValidator)
import { termStructure } from '../../js/termstructure.mjs';   // P3 — term structure / durable floor for floorValidator
import { loadGuideHistory, guideUpdates, guideAnchorModel, guideAnchorLine } from '../lib/guideanchor.mjs';   // YP1 advisory
import { buildItemContext, renderHeldVerdict, renderPathLine, staleBookBanner } from '../lib/item-context.mjs';   // P0 — the shared context chain + held-verdict renderer; P4b — the shared dominant-path line; COD-4 — the shared positions.json-age banner
import { depthReachClause } from '../lib/emit.mjs';   // PB4 — the shared two-lens depth-floor/pressure clause (rendered beside the pressure prices)
import { loadState, ALERT_PERSIST_MS } from '../lib/watchstate.mjs';   // P0 — READ the watch loop's cross-pass state (conviction timers; quote never writes it)
import { loadHoldThesis, pruneHoldThesis, thesisFor } from '../lib/holdthesis.mjs';   // P0 — declared-hold-thesis (silences expected-underwater), READ-ONLY

const HERE = path.dirname(fileURLToPath(import.meta.url));
const POSITIONS = path.join(HERE, '..', '..', 'positions.json');
const OFFERS = path.join(HERE, '..', '..', 'offers.json');   // P0: flat live-offer snapshot (LW1); the book for askFilling
const GUIDE_HISTORY = path.join(HERE, '..', '.guide-history.jsonl');   // YP1: watch-positions.mjs writes it, we read it advisory
const WATCH_STATE = path.join(HERE, '..', '.cache', 'watch-state.json');   // P0: gitignored cross-pass state written by watch-positions.mjs (read-only here)
const HOLD_THESIS_PATH = path.join(HERE, '..', '..', 'hold-thesis.json');   // P0: tracked declared-hold-thesis store (read-only here)
const FILLS = path.join(HERE, '..', '..', 'fills.json');   // LM1: RuneLite-logged fills → per-item 4h buy-limit windows (no fetch)

// Proposal C: the stale declared-exit read needs the 1h series, which this booked-lots view doesn't
// otherwise fetch. The fetch is TARGETED (only lots with a declared numeric thesis exit — typically
// 0–2 items) and TTL-cached (same fetchTsCached mechanism as screen-flip-niches.mjs's Leg-B survivor fetch), so
// a re-run inside the TTL is fetch-free. Same 15-min TTL as screen's TS_TTL_1H.
const TS_TTL_1H_EXIT = 15 * 60 * 1000;
// Incidental-inventory filter — shared threshold + watchlist exemption with watch-positions.mjs
// (the /positions skill's incidental-inventory rule, code-enforced 2026-07-16).
const NOISE_OFFER_GP = 100_000;
const WATCHLIST_PATH_Q = path.join(HERE, '..', '..', 'watchlist.json');
function loadWatchlistIds(map) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(WATCHLIST_PATH_Q, 'utf8')); } catch { return new Set(); }
  if (!Array.isArray(raw)) return new Set();
  const ids = new Set();
  for (const entry of raw) {
    const hit = map.resolve(typeof entry === 'number' ? String(entry) : entry);
    if (hit) ids.add(hit.id);
  }
  return ids;
}

const args = process.argv.slice(2);
const POSITIONS_MODE = args.includes('--positions');
// PLAN-OUTPUT-TABLE (2026-07-13): the per-item table's DEFAULT view is the reconciliation-estimator
// pair (Est. buy/sell/Net/BE, confidence in the cells — estimatePair, PLACEHOLDER model n≈14);
// --raw restores the model-free Quick + Optimistic columns. --positions is INTENT-DIFFERENT (the
// held-lot clear-price/list-at frame) and keeps Quick/Optimistic unconditionally — see runPositions.
const RAW = args.includes('--raw');
// PB4 (PLAN-DEPTH-EXIT / PLAN-REACHABILITY-CONSOLIDATION) — the pressure-exit TRIAL flag (opt-in,
// owner early-adopt). When set, Est. buy/sell are the pressure-driven reachableBand legs (still
// BE-floored + clamped + nudged); the conservative depth floor renders beside as the reference; the
// retro co-log stays on the NEUTRAL estimate (unbiased). Console-only — never touches screen.json/app.
// PC3: routed through the shared flag>config>default resolver as a NAMED sell-top model
// (--est-sell reach-fold|pressure); `--pressure-exit` is LEGACY SUGAR for `--est-sell pressure` (explicit
// --est-sell wins). Absent flag+config ⇒ 'reach-fold' (byte-identical to the old `--pressure-exit`
// boolean). PRESSURE_EXIT stays the boolean this script branches on, DERIVED from the active model.
// --est-sell takes the `=value` form (a bare positional would be swallowed as an item target by `tokens`
// below); `--pressure-exit` stays the space-free legacy sugar.
const estSellArg = args.find(a => a.startsWith('--est-sell='));
const SELL_MODEL = resolve('sellModel', {
  flag: estSellArg ? estSellArg.slice('--est-sell='.length).toLowerCase() : (args.includes('--pressure-exit') ? 'pressure' : undefined),
  config: loadPipelineConfig().sellModel, fallback: 'reach-fold',
}).active;
if (!SELL_TOP_MODELS[SELL_MODEL]) { console.error(`! unknown --est-sell. Use one of: ${Object.keys(SELL_TOP_MODELS).join(', ')}.`); process.exit(1); }
const PRESSURE_EXIT = SELL_MODEL === 'pressure';
// LOUD trial banner (rule 4 — the prices must never read as the calibrated default).
const PRESSURE_BANNER = '⚠ --pressure-exit: Est. buy/sell + rank use the UN-CALIBRATED pressure model (TRIAL; retro still scoring — not validated). --raw / drop the flag to restore the neutral estimate.';
const tokens = args.filter(a => !a.startsWith('--'));
// AO1 (PLAN-REACH-CALIBRATION Part 2; default flipped post-review — Ben: an agent running the quiet
// path must read the JSON dump, not the summary line, so quiet has to be the DEFAULT or that habit
// is optional). --verbose opts INTO the markdown stdout (the "paste this to Ben" case); the report
// object is ALWAYS written to the last-report dump either way. Implemented by no-op'ing console.log
// unless --verbose (keeps `realLog` for the summary); the report is captured for the dump at the
// single renderReport emission point.
const VERBOSE = args.includes('--verbose');
const realLog = console.log;
if (!VERBOSE) console.log = () => {};

// LM1: per-item 4h buy-limit windows, built ONCE per run from the repo-root fills.json (local file, no
// fetch). Empty map (absent/unreadable) ⇒ every item has zero in-window buys ⇒ byte-identical output.
function loadBuysByItem() {
  try { return buysByItem(JSON.parse(fs.readFileSync(FILLS, 'utf8')).events || []); }
  catch { return new Map(); }
}
// LOCAL wall-clock HH:MM for a unix-SECONDS instant (repo rule: rendered times are local).
function hhmm(tsSec) { return tsSec == null ? '—' : new Date(tsSec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

// STALE-LIVE guard note (QUICK_FRESH_MIN, quotecore): fires on ANY lot whose displayed "live"
// instabuy/instasell is an OLD /latest print rather than a live tick — the class of error where a
// 64-min-old godsword instabuy (39.75m) rendered as live and drove a false pace read while the true
// price had fallen ~500k (2026-07-21). Names the stale side + its age and points at the fresher side
// as the truer current level, so no surface can quote a stale number without the age attached.
function staleLiveNote(name, itemId, row) {
  const qs = row.quickStale; if (!qs || (!qs.buy && !qs.sell)) return null;
  const age = s => Math.round(s ?? 0);
  const bits = [];
  if (qs.sell) bits.push(`instabuy ${fmt(row.quickSell)} is ${age(row.quoteAgeMin?.sell)}m old`);
  if (qs.buy)  bits.push(`instasell ${fmt(row.quickBuy)} is ${age(row.quoteAgeMin?.buy)}m old`);
  const fresher = (!qs.sell && row.quickSell != null) ? `instabuy ${fmt(row.quickSell)}`
                : (!qs.buy && row.quickBuy != null) ? `instasell ${fmt(row.quickBuy)}` : null;
  return { kind: 'staleLive', itemId, text: `${name}: ⚠ stale live print — ${bits.join(', ')}; an old print, not a live tick — ${fresher ? `read the fresher ${fresher} as the current level and ` : ''}re-quote before pricing off it.` };
}

function regimeLine(name, row, limit, win) {
  const r = row.regime;
  const drift = (r && r.ok) ? `${r.driftPct >= 0 ? '+' : ''}${r.driftPct.toFixed(1)}% (3d vs prior ~2wk median)` : 'insufficient history';
  // buy limit per ~4h window — already fetched (loadMapping); /overnight sizing reads it here. LM1: when
  // there ARE in-window logged buys, append what's been bought / left / when capacity next frees (local).
  let lim = limit != null ? ` · buy limit ${limit.toLocaleString()}/4h` : '';
  if (win && win.boughtInWindow > 0) {
    const left = win.remaining == null ? 'limit unknown' : `${win.remaining.toLocaleString()} left`;
    lim += ` (bought ${win.boughtInWindow.toLocaleString()} this window — ${left}, next frees ~${hhmm(win.nextFreeAt)})`;
  }
  // buy/sell pressure — realized trailing-24h flow imbalance (zero extra fetch; see the
  // SHORTCOMINGS comment in computeQuote — flow proxy, not an order book, lags intraday shifts)
  const pt = pressureText(row.pressure);
  const press = pt ? ` · pressure ${pt}` : '';
  const inv = row.ordered ? '' : '  ⚠ feed inversion — quote basis unreliable';
  // BOND note: bonds are tax-exempt but cost 10% of guide to make re-tradeable, so the net already
  // shown reflects sell − (buy + fee). Surface the fee so the tax-free-but-fee'd basis is explicit.
  const bnd = row.bond ? `  · bond: TAX-EXEMPT, but +${fmtP(row.retradeFee || 0)} retrade fee (10% guide) on buy — net = sell − (buy + fee)` : '';
  return `- ${name}: regime ${row.regimeLabel} ${drift}${lim}${press}${bnd}${inv}`;
}

// PLAN-OUTPUT-TABLE: the standing explainer under the estimated (non-RAW) items table (was an inline
// string literal at the emission site; hoisted so buildQuoteReport can reference it as the estExplainer).
const EST_EXPLAINER = `(Est. buy/sell are ESTIMATES — reach-folded, PLACEHOLDER model n≈3–14. Confidence rides in the cell as the RECENT-3 reach (e.g. 0/3), full window beside it only when they diverge (0/3 · 12/14 = stale); '–' = no read. Est. sell is the HONEST reach-fold price (recency-weighted, phase-blind) shown with its P(fill) beside the net; when it sits below break-even the cell ANNOTATES that ("recency-fold floored to BE X") rather than substituting BE — the real (possibly-negative) net is shown, never a "+1". "list ~X (~Nd hold, conf)" is the forward-projected exit (phase-aware, n≈0 inform). Est. sell anchors to a DECLARED thesis exit when one exists ("(declared)"). --raw restores the model-free Quick/Optimistic columns.)`;

// VZ3 (PLAN-VIZ-LAYER) — assemble the quote output pass into ONE plain report object (R4), rendered by
// render.mjs's renderReport. PURE (no fetch/fs/clock): it takes ALREADY-computed pieces (the table
// headers/rows, the typed note items, the banner/explainer flags) and only decides section ORDER + the
// blank-line contract, so it is testable off fixtures. Byte-identical to the pre-VZ3 console.log
// sequence (pinned by pipeline/test/render.test.mjs). `notes` are typed {kind,tier,text} items — the
// per-kind sigil now lives in render.mjs's formatNote (NOTE_KINDS), not at the push site. The
// keepEmpty:true notes section reproduces the pre-VZ3 pattern where the block was always two
// unconditional console.log calls (a blank then the joined lines) even with zero notes.
// Fold the multi-day trajectory read onto EVERY quote surface (Ben 2026-07-21 — the fang under-read
// fix). The exact under-read the fang exposed: reach/placement read "fill-now A-" while the
// `days` array (already in hand from windowStats) showed an oscillator sitting at its 2-week floor.
// Renders the full DAILY TRAJECTORY block (per-day low/high, oldest→newest) + ONE combined floor/ceiling
// note. R6 (PLAN-SIGNAL-RECENCY): the trajectoryRead SHAPE synthesis line is RETIRED — its blended-mid
// rising/falling/based/elevated verdict was weaker than (and could visibly contradict) floorCeilingTrack's
// independent-slope classification, which uses the same inputs. Its UNIQUE fields survive: floor/ceiling +
// livePos fold into the fcTrack note (via formatFloorCeiling's `live` opt), and the oscillation-density read
// rides fc.oscillating (the one signal fc's classifier can't otherwise express). Data rows ride as plain
// strings (the V5-block pattern). ZERO new fetch — `days` is already in hand. `label` prefixes the header
// on the multi-item positions surface so each block stays tied to its item.
// PLAN-OSCILLATION-CYCLE Chunk 5: `prof`+`ctx` (the in-hand hourProfile + the diurnalForecast ctx bits the
// caller already has — liveLo/liveHi/phase/mom/reliable) fold the drift-adjusted exit LEVEL into the SAME
// combined note (driftExitFrom off the in-hand `prof`+`days` — NO fetch; forecast degrades ⇒ dae null ⇒ the
// clause is simply omitted). Display-only, direction-agnostic — never a verdict/gate.
function pushTrajectory(notes, days, { liveRef = null, label = '', prof = null, ctx = null } = {}) {
  const tr = trajectoryRead(days, { liveRef });
  if (!tr) return;
  notes.push(`  ${label ? label + ': ' : ''}trajectory (14d window low/high, oldest→newest):`);
  for (const [key, n] of tr.scored) notes.push(`    ${key}  low ${fmt(n.low)}  high ${fmt(n.hi)}`);
  // PLAN-DRIFT-VS-CRASH + R6: the floor/ceiling slope-asymmetry + floor-break read, now ALSO carrying
  // trajectoryRead's retired floor/ceiling band + livePos + the oscillation qualifier — one combined note.
  const fc = floorCeilingTrack(days, { todayKey: localDayKey() });
  // Chunk 5: the drift-adjusted exit level, off the in-hand prof+days (zero fetch); null when no profile/ctx
  // or the forecast degrades — formatFloorCeiling then omits the clause (honest degrade).
  const dae = (prof && ctx) ? driftExitFrom(prof, days, ctx) : null;
  const fcText = formatFloorCeiling(fc, fmt, { label, live: { ref: tr.liveRef, pos: tr.livePos, floor: tr.floor, ceiling: tr.ceiling }, drift: dae });
  if (fcText) notes.push({ kind: 'fcTrack', text: fcText });
}
// local 'YYYY-MM-DD' of now — matches windowStats' dayKey (wStart=0) so the forming-day guard lines up.
function localDayKey(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
// The ADD-while-holding SOFT-BUY timing note — "when is it cheapest to add, and is now that time?" off the
// SAME hourProfile the diurnal note derives. SHARED so BOTH surfaces push it identically: runItems passes the
// already-computed `prof` (zero new fetch); runPositions passes `ts1h` (in hand from the vol24 parity fetch)
// and this computes the profile. This helper exists because the note originally lived ONLY in runItems, so
// `--positions` — the held-lot surface the whole feature is FOR — silently never rendered it; centralizing the
// push is what keeps the two surfaces from drifting again (the same shared-helper discipline as pushTrajectory).
// `live` = the live buy-side (the instabuy Ben would pay to add now). Inform-only, never a gate; null profile → no note.
function pushSoftBuy(notes, { prof = null, ts1h = null, live = null, itemId = null } = {}) {
  const p = prof || (ts1h ? hourProfile(ts1h, { nights: 7 }) : null);
  if (!p) return;
  const sbTxt = formatSoftBuy(softBuyRead(p, { live }), { fmtHour });
  if (sbTxt) notes.push({ kind: 'softBuy', itemId, text: sbTxt });
}

export function buildQuoteReport({
  mode = 'items',
  header = null,          // positions: the '# Open positions …\n' line (with its trailing \n)
  pressureBanner = null,  // the loud --pressure-exit trial banner (already includes no trailing \n)
  staleBanner = null,     // positions: the shared stale-book banner (with its trailing \n)
  headers = [], rows = [],
  estExplainer = null,    // items non-RAW: the standing Est. explainer line
  notes = [],             // flat, ordered typed note items (strings also accepted)
  convLines = [], pathLines = [], rebidLines = [], lateNightLine = null,   // positions extra blocks
} = {}) {
  const sections = [];
  if (mode === 'positions') {
    if (header) sections.push({ type: 'lines', lines: [header], blank: false });
    if (pressureBanner) sections.push({ type: 'lines', lines: [pressureBanner + '\n'], blank: false });
    if (staleBanner) sections.push({ type: 'lines', lines: [staleBanner + '\n'], blank: false });
    sections.push({ type: 'table', headers, rows, blank: false });
    sections.push({ type: 'notes', items: notes, blank: true, keepEmpty: true });
    if (convLines.length) sections.push({ type: 'lines', lines: ['', 'Conviction (shared watch-state):', ...convLines], blank: false });
    if (pathLines.length) sections.push({ type: 'lines', lines: ['', 'Paths (persistence-gated dominant per held lot — decision support, placeholder weights):', ...pathLines], blank: false });
    if (rebidLines.length) sections.push({ type: 'lines', lines: ['', 'Rebid advisory (cut-and-rebid friction bar + multi-week trajectory — support, never overrides the verdict):', ...rebidLines], blank: false });
    if (lateNightLine) sections.push({ type: 'lines', lines: ['', lateNightLine], blank: false });
  } else {
    if (pressureBanner) sections.push({ type: 'lines', lines: [pressureBanner + '\n'], blank: false });
    sections.push({ type: 'table', headers, rows, blank: false });
    if (estExplainer) sections.push({ type: 'lines', lines: [estExplainer], blank: false });
    sections.push({ type: 'notes', items: notes, blank: true, keepEmpty: true });
  }
  return { kind: 'quote', generatedAt: null, sections };
}

async function runItems() {
  if (!tokens.length) { console.error('usage: node pipeline/commands/quote-items.mjs "<item or id>" [...more]  |  node pipeline/commands/quote-items.mjs --positions'); process.exit(1); }
  const map = await loadMapping();
  const guide = await loadGuide();
  const resolved = [];
  for (const t of tokens) {
    const hit = map.resolve(t);
    if (!hit) { console.error(`! no item named "${t}" — check spelling or pass a numeric id`); continue; }
    resolved.push(hit);
  }
  const hist = loadGuideHistory(GUIDE_HISTORY);   // YP1 advisory (gated → silent until history accrues)
  const buysByItemMap = loadBuysByItem();   // LM1: per-item 4h buy-limit windows (regime-line + limitValidator)
  const holdThesisStore = pruneHoldThesis(loadHoldThesis(HOLD_THESIS_PATH));   // PLAN-OUTPUT-TABLE rev2: declared exits anchor Est. sell (READ-ONLY)
  // FIX 1 (2026-07-13): a declared exit is a HELD-LOT plan, so an ad-hoc per-item read anchors Est. sell
  // to it ONLY when that id is actually held (an open lot in positions.json) — never on a bare "how's X"
  // read of an item we don't hold. Build the open-position id set once (read-only; degrades to empty).
  const heldIds = new Set();
  const heldQty = new Map();   // itemId → total open qty (PLAN-LIQUIDITY-REACH: real lot size feeds reachRelief, not the buy-limit proxy)
  try { const { groups } = readOpenPositions(POSITIONS); for (const g of (groups || [])) { heldIds.add(g.itemId); heldQty.set(g.itemId, g.qty); } } catch { /* no positions.json → nothing held → no anchoring */ }
  await loadModules();   // PM1: discover pipeline/modules/*.mjs once (empty/absent dir → zero probes → byte-identical)
  // P3: read-only daily mids from whatever the Tier-1 archive already holds (noFetch → zero network,
  // no fetch-semantics change on this surface) → floorValidator's term structure. Cold archive → empty
  // series → floorValidator degrades to pass. Best-effort: any archive error leaves daily empty.
  let daily = {};
  try { ({ series: daily } = await loadDaily(28, 6, { noFetch: true })); } catch { daily = {}; }
  // SF-3: warm-ONLY bulk /24h map (null unless a recent screen wrote all24h.json within its TTL). When
  // warm, the logged liquidity `class` converges with screen-flip-niches.mjs (both read the bulk snapshot) and tags
  // volSrc:'bulk'; when cold it's null → classAndSource keeps the per-item volume, tags volSrc:'peritem'.
  // NEVER fetches — loadAll24hWarm is a pure file read; a 1-item ask never triggers the ~4000-item dump.
  const warm24h = loadAll24hWarm();
  const rows = [], notes = [], sugg = [], probeStrs = [];
  for (const { id, name } of resolved) {
    // COD-4: BUDGETED ts1h fetch (1–2 items/invocation — cheap). Fixes the A4 asymmetry: the explicit-ask
    // surface used to fetch NO 1h series, so reach/trajectory DEGRADED to pass on exactly the surface Ben
    // uses most ("how's X?"). Now the 1h series is in hand, so reachValidator FIRES (real window read) and
    // trajectoryValidator fires off the warm 1h-derived term structure, and we print the diurnal timing line.
    // SF-2 (2026-07-10): this ts1h fetch is UNCAPPED — the "1–2 items/invocation" budget is a usage
    // convention, NOT enforced, so `quote A B C … J` amplifies the 1h fetch count one-per-item linearly.
    // Fine at the intended handful; if large-batch quotes ever become routine, add a soft cap here
    // (skip the ts1h enrichment past N items, degrading reach/diurnal to "not fetched — batch too large").
    const inp = await fetchItemInputs(id, { ts1h: true });
    // PLAN-VOL24: the /24h per-item endpoint is BROKEN (frozen stale ~1–3h slice). Correct vol24 from the
    // in-hand 1h series (rolling24, zero new fetch); degrades to the /24h read when the series is too short.
    // Reassigned on inp so EVERY downstream use — computeQuote's Vol/d + pressure, avgLow24/avgHigh24 dip
    // reference, reach-relief input — reads the corrected value. computeQuote itself is untouched (app-safe).
    const _cv = vol24FromInputs(inp); inp.vol24 = _cv.vol24;
    const row = computeQuote({ ...inp, id, guide: guide[id] ?? null, limit: map.byId[id]?.limit ?? null, asked: true });
    const std = stdCells(name, row);   // PLAN-OUTPUT-TABLE: the row is pushed AFTER the est pair is computed below (view-dependent cells)
    const limWin = limitWindow({ buys: buysByItemMap.get(id) || [], limit: map.byId[id]?.limit ?? null });
    notes.push({ kind: 'regime', itemId: id, text: regimeLine(name, row, map.byId[id]?.limit ?? null, limWin) });
    { const s = staleLiveNote(name, id, row); if (s) notes.push(s); }
    const gl = guideAnchorLine(guideAnchorModel(guideUpdates(hist, id)), guide[id] ?? null);
    if (gl) notes.push({ kind: 'guideAnchor', itemId: id, text: gl });
    // P2/P3 validators. reachValidator scores the patient ask (optSell) against the reach window — NOW it
    // FIRES because ts1h is fetched above (COD-4). P3's floorValidator scores the patient BUY (optBuy) —
    // a per-item quote IS a buy-interest read — against the durable multi-week floor from the read-only
    // daily mids (cold archive → degrade); its .trajectory is OVERRIDDEN with the WARM 1h-derived shape
    // (trajectoryFrom1h, the same warm-term-structure.mjs helper screen-flip-niches.mjs uses) so trajectoryValidator fires too.
    // An explicit ask is NEVER hidden: a fired flag is a NOTE + logged; the table row is untouched.
    const ts = termStructure(daily[id]);
    warmOverride(ts, inp.ts1h);   // warm .trajectory AND .recentTrend (R3) off the 1h series while loadDaily is cold
    const vres = runValidators({
      market: { row },
      history: { termStructure: ts },
      intraday: {
        ts1h: inp.ts1h ?? null,
        ts5m: inp.ts5m ?? null,                          // DP1: dip-posture reads the 5m direction shape
        avgLow24: inp.vol24?.avgLowPrice ?? null,        // DP1: dip-depth reference (24h avg low)
        reach: row.optSell != null ? { side: 'ask', level: row.optSell } : null,
      },
      floor: { level: row.optBuy != null ? row.optBuy : null },
      limits: { window: limWin },   // LM1: a buy read — limitValidator flags an exhausted/near buy limit as a NOTE (never hides the row)
    });
    for (const f of flags(vres)) notes.push({ kind: 'validator', itemId: id, text: `${f.key}: ${f.reason}` });
    // COD-4: diurnal BID/ASK timing line — the SAME hourProfile/deriveDiurnalRange the screen's Diurnal
    // block uses, now feasible on quote because the 1h series is in hand. Support, not a gate; the bid is
    // stale-guarded to live (the Ghrazi lesson lives in deriveDiurnalRange). tax() nets the after-tax swing.
    const prof = hourProfile(inp.ts1h, { nights: 7 });
    const dr = prof ? deriveDiurnalRange(prof, { liveLo: row.quickBuy ?? null, liveHi: row.quickSell ?? null }) : null;
    if (dr && dr.bid != null && dr.ask != null) {
      const win = w => `${fmtHour(w.startH)}–${fmtHour(w.endH)}`;
      const net = Math.round(dr.ask - tax(dr.ask) - dr.bid);
      const roi = dr.bid ? (net / dr.bid * 100) : null;
      const trend = prof.trendDominates ? ' ⚠ trend-dominates → bid to live' : '';
      notes.push({ kind: 'diurnal', itemId: id, text: `diurnal: BID ${fmt(dr.bid)} (${dr.bidBasis}, dip ${win(dr.dipWindow)}) · ASK ${fmt(dr.ask)} (peak ${win(dr.peakWindow)})${net != null ? ` · ~${fmt(net)}/u${roi != null ? ` (${roi.toFixed(1)}%)` : ''}` : ''}${trend}` });
    }
    // The ADD-while-holding SOFT-BUY timing read — pushed via the shared pushSoftBuy so the bare-quote and
    // --positions surfaces stay identical (reuse the prof already computed for the diurnal note; zero new fetch).
    pushSoftBuy(notes, { prof, live: row.quickBuy ?? null, itemId: id });
    // #6 (PF1 forecast, Ben 2026-07-15): the module's motivating ask — "not buyable/sellable at a good
    // price NOW, but ~Xh from now." whenBuyable/whenSellable over ONE diurnalForecast (all js/forecast.mjs).
    // Inform-only, provisional (n≈0, diurnal+trend only) — zero new fetch (reuses the in-hand prof); never
    // a table/verdict/price input. The projection is computed ONCE and shared by both timing lines.
    const { forecast: fc } = prof
      ? diurnalForecast(prof, { liveLo: row.quickBuy, liveHi: row.quickSell, phase: row.phase, mom: row.mom, reliable: row.reliable })
      : { forecast: null };
    // BUY timing (any item): profitable target = maxBuyForExit(optSell,0), the tax-exact inverse of
    // breakEven; optSell OVER-states the in-window exit, so the ceiling is conservative and "not buyable
    // now" fires less often (PLAN-WINDOW-CLEAR caveat; #9's read-window-range --exit is the exact form).
    if (fc && row.quickBuy != null && row.optSell != null) {
      const bondOpts = row.bond ? { bond: true, guide: row.guide } : undefined;
      const targetBid = maxBuyForExit(row.optSell, 0, bondOpts);
      if (targetBid != null && row.quickBuy > targetBid) {            // live buy doesn't clear BE at the reachable exit
        const wb = whenBuyable(fc, targetBid);
        const head = `not profitably buyable now (live ${fmt(row.quickBuy)} > ~${fmt(targetBid)} to clear BE at ${fmt(row.optSell)})`;
        if (wb) notes.push({ kind: 'forecast', itemId: id, text: `forecast: ${head} → buyable ${fmtEta(wb.etaH)} (${fmtHour(wb.atHours[0])}) @ ~${fmt(wb.projLevel)} [${fmt(wb.band.lo)}–${fmt(wb.band.hi)}] (provisional, n≈0 — diurnal+trend)` });
        else notes.push({ kind: 'forecast', itemId: id, text: `forecast: ${head} — NOT projected buyable within ${fc.horizonH}h on this model (provisional, n≈0)` });
      }
    }
    // SELL timing (HELD lot only — a non-held read is a buy decision): when does the projected high reach
    // your target ask? Target = the DECLARED thesis exit if set, else the reachable band top (optSell).
    // "not sellable now" = the live instabuy sits below the target. whenSellable's held-lot home (was the
    // #6 follow-up marker) — zero new fetch, the same shared fc.
    if (fc && heldIds.has(id) && row.quickSell != null) {
      const targetAsk = (thesisFor(holdThesisStore, id)?.exitPrice ?? null) ?? row.optSell;
      if (targetAsk != null && row.quickSell < targetAsk) {          // can't sell at the target at the live instabuy now
        const ws = whenSellable(fc, targetAsk);
        const head = `not sellable at ${fmt(targetAsk)} now (live instabuy ${fmt(row.quickSell)})`;
        if (ws) notes.push({ kind: 'forecast', itemId: id, text: `forecast: ${head} → sellable ${fmtEta(ws.etaH)} (${fmtHour(ws.atHours[0])}) @ ~${fmt(ws.projLevel)} [${fmt(ws.band.lo)}–${fmt(ws.band.hi)}] (provisional, n≈0 — diurnal+trend)` });
        else notes.push({ kind: 'forecast', itemId: id, text: `forecast: ${head} — NOT projected sellable within ${fc.horizonH}h on this model (provisional, n≈0)` });
      }
    }
    // Bar E ask-headroom (inform-only): the robust p90 shaved a TRADED in-band top off the quoted ask —
    // ladder up, don't relist down (the GE better-price rule makes the ladder cheap). Null unless trusted.
    const ah = askHeadroomText(row);
    if (ah) notes.push({ kind: 'askHeadroom', itemId: id, text: `ask headroom: ${ah}` });
    // PART II (PLAN-GRADE-REACH): the asym-fill inform line — deep flush bid → high-reach ask off the
    // day-level quantiles of the SAME in-hand ts1h (zero new fetch; full-day window, ~14 nights). Same
    // inform pattern as the diurnal line above: decision support, never a table/verdict/price input.
    // P_bid is "rest it as optionality", NEVER a rank weight (doctrine: js/estimators.mjs asymEstimate).
    const ast = inp.ts1h ? windowStats(inp.ts1h, { nights: 14, wStart: 0, wEnd: 0 }) : null;
    const ap = ast ? asymPair(ast) : null;
    const ae = ap ? asymEstimate(FLIP_NICHES.band, row, ap) : null;
    if (ae) {
      const hB = Math.round(ae.pBid * ap.nDays), hA = Math.round(ae.pAsk * ap.nDays);
      const roi = ae.bid > 0 ? (ae.net / ae.bid * 100).toFixed(1) : null;
      notes.push({ kind: 'asym', itemId: id, text: `asym fill: deep-bid ${fmt(ae.bid)} (fills ~${hB}/${ap.nDays}d — rest as optionality) → ask ${fmt(ae.ask)} (prints ~${hA}/${ap.nDays}d) · net ${fmt(ae.net)}/u${roi != null ? ` (${roi}%)` : ''} (placeholder quantiles, n≈${ap.nDays})` });
    }
    // PLAN-OUTPUT-TABLE: the reconciliation estimate off the SAME in-hand reads (windowStats touch/
    // reach at the patient pair, the diurnal dip/peak levels, the asym high-reach ask) — zero new
    // fetch. Rendered as the DEFAULT table columns (--raw restores Quick/Optimistic) and logged as
    // the estBuy/estSell/estConfidence shadow fields either way (the F1 accrual).
    // rev1: the RC1 recent-3 split (recencySplit over ast.days) rides alongside the full-window count so
    // estimatePair folds on recent-3 and the confidence token shows it (with the full window on divergence).
    const bidRc = (ast && ast.days && row.optBuy != null) ? recencySplit(ast.days, 'bid', row.optBuy) : null;
    const askRc = (ast && ast.days && row.optSell != null) ? recencySplit(ast.days, 'ask', row.optSell) : null;
    const bidReach = (ast && ast.lows && ast.lows.length && row.optBuy != null)
      ? { reachedDays: touchedDays(ast.lows, row.optBuy), nDays: ast.lows.length, recentHit: bidRc?.recentHit, recentDays: bidRc?.recentDays } : null;
    const askReach = (ast && ast.his && ast.his.length && row.optSell != null)
      ? { reachedDays: reachedDays(ast.his, row.optSell), nDays: ast.his.length, recentHit: askRc?.recentHit, recentDays: askRc?.recentDays } : null;
    // PLAN-QUOTE-PLACEMENT (Ben 2026-07-17): fold read-window-range.mjs's --bid/--ask placement percentile
    // onto the quote itself — Ben had to fall back to a manual read-window-range.mjs run for this on every
    // overnight-listing decision. Zero new fetch: reuses the SAME ast.lows/ast.his + bidReach/askReach
    // already computed above for the patient pair (row.optBuy/row.optSell). Mirrors read-window-range.mjs's
    // wording exactly (touched/reached k/N · recent m/3 · placement pXX of the N-day daily-LOW/HIGH
    // distribution); degrades to whichever side has usable data, and is skipped entirely when neither does
    // (same guard shape as the asym-fill note above). Inform-only — never a table/verdict/price input.
    const bidPlace = bidReach ? placement(ast.lows, row.optBuy) : null;
    const askPlace = askReach ? placement(ast.his, row.optSell) : null;
    if (bidPlace != null || askPlace != null) {
      const pct = f => 'p' + Math.round(f * 100);
      const parts = [];
      if (bidPlace != null) parts.push(`bid ${fmt(row.optBuy)} touched ${bidReach.reachedDays}/${bidReach.nDays}d (recent ${bidReach.recentHit ?? '—'}/${bidReach.recentDays ?? '—'}) · placement ${pct(bidPlace)} of the ${bidReach.nDays}-day daily-LOW distribution`);
      if (askPlace != null) parts.push(`ask ${fmt(row.optSell)} reached ${askReach.reachedDays}/${askReach.nDays}d (recent ${askReach.recentHit ?? '—'}/${askReach.recentDays ?? '—'}) · placement ${pct(askPlace)} of the ${askReach.nDays}-day daily-HIGH distribution`);
      notes.push({ kind: 'reachPlacement', itemId: id, text: `reach/placement: ${parts.join(' — ')}` });
    }
    // multi-day trajectory (shape + floor/ceiling + live position) — the fang under-read fix; zero fetch.
    // Chunk 5: prof (line 330) + the diurnalForecast ctx bits (already used for the forecast lines above)
    // fold the drift-adjusted exit level into the note — all in-hand, no new fetch.
    pushTrajectory(notes, ast && ast.days, { liveRef: row.quickBuy ?? row.quickSell,
      prof, ctx: { liveLo: row.quickBuy, liveHi: row.quickSell, phase: row.phase, mom: row.mom, reliable: row.reliable } });
    // PLAN-WINDOW-CLEAR B2: the within-window CLEAR read — does the quoted ask actually PRINT inside its
    // diurnal PEAK window (not just on N/M days), and does that window's volume absorb a buy-limit tranche?
    // Inform-only (the ⤴ ask-headroom / ◆ asym pattern): a divergence — healthy all-day reach but the ask
    // rarely prints IN the peak window, or size ≫ the window pool — is the days-reach ≠ lap-clear trap.
    // Zero new fetch (reuses the in-hand ts1h + the peak window the diurnal line already derived). Never a
    // table/verdict/price input; a lean `winClear` rides suggestions.jsonl for F1. Placeholders (n≈0).
    let winClear = null;
    if (dr && dr.peakWindow && row.optSell != null && inp.ts1h) {
      const units = map.byId[id]?.limit ?? null;
      const wc = windowClear(inp.ts1h, { ask: row.optSell, units, wStart: dr.peakWindow.startH, wEnd: dr.peakWindow.endH, nights: 14 });
      const dayFrac = askReach && askReach.nDays ? askReach.reachedDays / askReach.nDays : null;
      const div = windowClearDiverges(wc, dayFrac);
      // NOTE on the WINDOW-REACH divergence only (the clean days-reach ≠ lap-clear signal); the sizeShort
      // leg stays shadow-only for now — a narrow peak window mis-reads size on a continuously-clearing lap
      // (PLAN-WINDOW-CLEAR open question). clearRatio/diverges still ride suggestions.jsonl for F1.
      if (wc && div.windowShort) {
        const dayTxt = dayFrac != null ? ` (vs ${askReach.reachedDays}/${askReach.nDays} all-day)` : '';
        notes.push({ kind: 'windowClear', itemId: id, text: `window-clear: ask ${fmt(row.optSell)} prints ${wc.reachedDays}/${wc.nDays} in the ${fmtHour(dr.peakWindow.startH)}–${fmtHour(dr.peakWindow.endH)} peak window${dayTxt} — days-reach ≠ lap-clear (placeholder, n≈0)` });
      }
      if (wc) winClear = { windowReach: wc.windowReach, reachedDays: wc.reachedDays, nDays: wc.nDays, pool: wc.pool, clearRatio: wc.clearRatio, wStart: wc.wStart, wEnd: wc.wEnd, diverges: div.diverges };
    }
    // rev2 + FIX 1: a declared thesis exit anchors Est. sell ONLY when the id is an actual open lot
    // (a declared exit is a held-lot SELL plan; it must not inflate an ad-hoc read of an item we don't
    // hold). spec stays FLIP_NICHES.band — an explicit "how's X" is a generic flip read.
    const declaredExit = heldIds.has(id) ? (thesisFor(holdThesisStore, id)?.exitPrice ?? null) : null;
    // RC-S2 (PLAN-REACHABILITY-CONSOLIDATION): the pressure-driven reachable band + (held) depth floor off
    // the SAME in-hand windowStats (`ast`)/1h series — the five-way head-to-head co-log AND (PB4) the
    // pressure-exit price source. Computed BEFORE estimatePair so it can ride the est's extra.
    const reachable = ast ? reachableBand(ast) : null;
    const depthExit = (heldIds.has(id) && inp.ts1h && heldQty.get(id) != null)
      ? clearableAsk(inp.ts1h, { qty: heldQty.get(id), wStart: 0, wEnd: 0, nights: 14 }) : null;
    // PLAN-LIQUIDITY-REACH: dayHigh = the observed trailing-24h 5m-bucket max off the in-hand ts5m —
    // Part B's de-bias reference; applied only when reachRelief > 0 (liquid + small limit÷flow).
    const extraEst = {
      bidReach, askReach,
      diurnal: dr ? { bid: dr.bid, ask: dr.ask } : null,
      asym: ap, declaredExit,
      dayHigh: dayHighFrom5m(inp.ts5m),
      // PLAN-LIQUIDITY-REACH: on a held lot, the reach relief sizes off the REAL lot qty, not the buy-limit
      // proxy (absent → estimatePair degrades to row.limit, byte-identical for a bare "how's X" read).
      intendedUnits: heldIds.has(id) ? (heldQty.get(id) ?? null) : null,
      reachable,   // PB4: the pressure-exit price source (ignored unless the flag is on)
      // PLAN-ESTIMATOR-HONEST-SELL E4: the FORWARD "list at X" inputs — the SAME in-hand hourProfile (prof)
      // + daily windowStats series (ast.days) this file already computes for its trajectory/diurnal notes
      // (ZERO new fetch). The shell computes driftExitFrom off these; absent them → forward fields null (degrade).
      forward: (prof && ast && ast.days && ast.days.length) ? { profile: prof, days: ast.days } : null,
    };
    // The NEUTRAL est is what the retro co-log scores (unbiased); PB4's pressure est is DISPLAY-ONLY.
    // PC3: `est` = the NEUTRAL reach-fold (the retro co-log, per-item read has no verdict); `estShown` =
    // the ACTIVE model (pressure trial when --est-sell pressure / --pressure-exit, else the same neutral).
    const est = estimatePair(FLIP_NICHES.band, row, extraEst, { nudge: anchorNudge, sellModel: 'reach-fold' });
    const estShown = SELL_MODEL === 'reach-fold' ? est : estimatePair(FLIP_NICHES.band, row, extraEst, { nudge: anchorNudge, sellModel: SELL_MODEL });
    // PLAN-LIQUIDITY-REACH inform line (never a table/verdict/price-column input): the relief that
    // counterweights the ⚠ reach caution above on a liquid small-relative-size book.
    if (est && est.confidence.relief) {
      const rl = est.confidence.relief;
      notes.push({ kind: 'reachRelief', itemId: id, text: `reach relief: liquid book (${fmt(row.volDay)}/d, buy limit ~${(rl.sizeRatio * 100).toFixed(1)}% of flow) softens the ask-reach fold ${Math.round(rl.relief * 100)}%${rl.debiasedTop != null ? `; top de-biased to ${fmt(rl.debiasedTop)} (≤ observed 24h high)` : ''} (PLACEHOLDER, n=1)` });
    }
    // PB4: under the flag, a HELD item renders the conservative DEPTH FLOOR beside the pressure prices
    // (the reference — don't drop it). depthReachClause is the shared two-lens formatter (emit.mjs).
    if (PRESSURE_EXIT && estShown && estShown.confidence.pressureExit) {
      const clause = depthReachClause({ ca: depthExit, rb: reachable, qty: heldQty.get(id) });
      if (clause) notes.push({ kind: 'pressureExit', itemId: id, text: clause });
    }
    rows.push(RAW ? std : [std[0], std[1], ...estPairCells(estShown), std[4], std[5], std[6]]);
    const cs = classAndSource(row, id, warm24h);   // SF-3: class + volSrc ('bulk' when warm24h had it, else 'peritem')
    sugg.push(suggestionEntry(row, { itemId: id, cls: cs.cls, volSrc: cs.volSrc, verdict: null, posture: isOvernightNow() ? 'overnight' : 'active', validators: leanValidators(vres),
      estBuy: est ? est.estBuy : null, estSell: est ? est.estSell : null, estConfidence: estConfLean(est), winClear,
      reachable: reachableShadow(reachable), depthExit: depthExitShadow(depthExit, { qty: heldQty.get(id), volDay: row.volDay }), asym: asymShadow(ae) }));  // per-item read has no verdict; PLAN-OUTPUT-TABLE shadow pair + PLAN-WINDOW-CLEAR winClear + RC-S2 reachable/depthExit/asym ride the row
    // PM1: probes over this per-item read (OUTPUT-ONLY — no verdict/gate/rating input). ctx carries the
    // 24h avg (dip) + the phase trajectory (froth) + an advisory ask price (anchor). decant stays silent
    // here (no whole-market map on the per-item surface — see probes.mjs NEEDS).
    const ph = phase(inp.ts6h);
    const fired = runProbes(row, 'quote', {
      surface: 'quote', owned: false, id, name, thin: false,
      phase: ph, avgLow24: inp.vol24?.avgLowPrice ?? null, avgHigh24: inp.vol24?.avgHighPrice ?? null,
      series5m: inp.ts5m, series6h: inp.ts6h, map,
      price: row.optSell != null ? { side: 'ask', proposed: row.optSell } : undefined,
    });
    // PM2: record every firing to pipeline/modules/<module>.log (failure-safe, stdout-untouched).
    logFirings(fired, { surface: 'quote', id, name, quickBuy: row.quickBuy, quickSell: row.quickSell, guide: row.guide, regimeLabel: row.regimeLabel, phase: ph?.phase ?? null });
    probeStrs.push(fired.map(f => f.tag).join(' · '));
  }
  // O1 suggestions ledger: log every emitted read at emit time, unconditionally (analytics only).
  logSuggestions('quote', { mode: null, params: { positions: false } }, sugg);
  if (!rows.length) process.exit(1);
  // PM1: append the `Probes` column ONLY when a probe fired (byte-identical table otherwise — the
  // removability guarantee). stdout-only; no app/publish path on the per-item quote surface.
  const anyProbe = probeStrs.some(Boolean);
  // PLAN-OUTPUT-TABLE: default = the estimated view; --raw = the model-free Quick/Optimistic set.
  const baseHeaders = RAW ? QUOTE_HEADERS : ['Item', 'Guide', ...EST_HEADERS, 'Vol/d', 'Momentum', 'Regime'];
  const headers = anyProbe ? [...baseHeaders, 'Probes'] : baseHeaders;
  const outRows = anyProbe ? rows.map((r, i) => [...r, { t: probeStrs[i], c: 'mini' }]) : rows;
  // VZ3: build the report + render it ONCE — the ONE emission point (byte-identical to the prior
  // console.log sequence: optional pressure banner, mdTable, the Est. explainer (non-RAW), then the
  // typed note block; pinned by pipeline/test/render.test.mjs).
  const report = buildQuoteReport({
    mode: 'items',
    pressureBanner: (PRESSURE_EXIT && !RAW) ? PRESSURE_BANNER : null,
    headers, rows: outRows,
    estExplainer: RAW ? null : EST_EXPLAINER,
    notes,
  });
  console.log(renderReport(report));   // no-op unless --verbose
  const rel = writeLastReport('quote', report);   // AO1: always dump the report object for an agent read
  if (!VERBOSE) realLog(`# quote (quiet default; --verbose for the table) — ${outRows.length} item(s) → ${rel}`);
}

async function runPositions() {
  // ALWAYS sync first (Ben, 2026-07-16 — prose "sync before every read" was skipped repeatedly
  // because it was only a doctrine, never enforced; a real position closed unnoticed as a result,
  // see the anglerfish anchor incident). Local/zero-git, cheap, never blocks the read on failure.
  // AR1: the ONE shared invocation (pipeline/lib/sync-invoke.mjs).
  runLocalSync({ offBookNote: 'reading off the current book' });

  const { err, groups: allGroups, openLots, ageMin } = readOpenPositions(POSITIONS);
  if (err) { console.error('cannot read positions.json: ' + err); process.exit(1); }
  if (!allGroups.length) { console.log('No open positions in positions.json.'); return; }
  // P0: one loadSnapshot() per pass — the position surface's mapping/guide + the passive Tier-1
  // archive append (quote-items.mjs is, with watch-positions.mjs, loadSnapshot's first consumer). Robust fallback:
  // if the archive/snapshot can't open, degrade to the plain loaders so the read never breaks.
  const ids = allGroups.map(g => g.itemId);
  let snap = null;
  try { snap = await loadSnapshot({ budgetIds: ids }); } catch { snap = null; }
  const map = snap ? snap.mapping : await loadMapping();
  const guide = snap ? snap.guide : await loadGuide();
  // Incidental-inventory filter (code-enforced 2026-07-16, matches watch-positions.mjs — was
  // /positions skill prose only): a lot worth < NOISE_OFFER_GP and NOT on the watchlist never
  // reaches the table/verdict loop at all. Collapsed into one summary line instead.
  const watchlistIds = loadWatchlistIds(map);
  const incidentalNames = [];
  const groups = allGroups.filter(g => {
    if (g.cost < NOISE_OFFER_GP && !watchlistIds.has(g.itemId)) {
      incidentalNames.push(map.byId[g.itemId]?.name || ('#' + g.itemId)); return false;
    }
    return true;
  });
  if (!groups.length) { console.log('Only incidental inventory in positions.json — ignored: ' + incidentalNames.join(', ')); return; }
  const getInputs = async id => (snap ? (await snap.series(id)) : null) ?? await fetchItemInputs(id);
  // SF-3: the bulk /24h map for the logged liquidity `class` (converges with screen-flip-niches.mjs). On the normal
  // path loadSnapshot ALREADY fetched the whole-market /24h (snap.v24) — reusing it adds ZERO fetch and
  // tags volSrc:'bulk'; on the degraded no-snapshot path fall back to the warm-only file read (still
  // fetch-free — never forces the bulk dump), null → classAndSource keeps per-item volume, volSrc:'peritem'.
  const warm24h = snap ? snap.v24 : loadAll24hWarm();
  // P0: the live book (offers.json) + the watch loop's cross-pass state + declared hold theses —
  // the inputs quote-items.mjs never read before, so it can now print HOLD — ask filling + conviction.
  const offers = readOffersSnapshot(OFFERS);
  const nowMs = Date.now();
  const priorState = loadState(WATCH_STATE);   // READ-ONLY: quote never persists (only the watch loop owns the write)
  const holdThesisStore = pruneHoldThesis(loadHoldThesis(HOLD_THESIS_PATH));
  const headers = [...QUOTE_HEADERS, 'Held@', 'Break-even', 'Verdict'];
  const hist = loadGuideHistory(GUIDE_HISTORY);   // YP1 advisory (gated → silent until history accrues)
  const buysByItemMap = loadBuysByItem();   // LM1: per-item 4h buy-limit windows (regime-line + limitValidator — accumulation awareness on a held lot)
  // COD-3: read-only daily mids (noFetch — zero network) → the multi-week trajectory SHAPE the rebid
  // advisory reads. Cold archive → { hasData:false } → trajectory 'unknown' → the friction-bar branch
  // (the arithmetic still governs). Best-effort: any archive error leaves it empty.
  let dailyPos = {};
  try { ({ series: dailyPos } = await loadDaily(28, 6, { noFetch: true })); } catch { dailyPos = {}; }
  const rows = [], notes = [], sugg = [], staleRisk = [], convLines = [], pathLines = [], rebidLines = [];
  for (const { itemId, qty, cost, avgCost, buyTs } of groups) {
    const name = map.byId[itemId]?.name || ('#' + itemId);
    const inp = await getInputs(itemId);
    // PLAN-VOL24 parity fix: this booked-lots view was computing Vol/d + pressure off the raw, BROKEN
    // /24h read (never corrected), while the single-item path above corrects it from a live 1h series —
    // the two surfaces disagreed by ~10x on the same item. Budgeted, TTL-cached 1h fetch (same
    // fetchTsCached mechanism the stale-exit/pressure-exit reads below already pay for on this lot;
    // reused via inp.ts1h so this doesn't double the fetch) before computeQuote ever sees vol24.
    if (!inp.ts1h) { try { inp.ts1h = await fetchTsCached(itemId, '1h', TS_TTL_1H_EXIT); } catch { inp.ts1h = null; } }
    inp.vol24 = vol24FromInputs(inp).vol24;
    const thesisEntry = thesisFor(holdThesisStore, itemId);   // Proposal C reads it too (declared exit)
    // Build the shared item context: identity → market → history → intraday → position. The position
    // stage folds in the live ask (askFilling), the cross-pass state (conviction), and any hold thesis.
    const ctx = buildItemContext({
      identity: { id: itemId, name },
      market: { inp, guide: guide[itemId] ?? null, limit: map.byId[itemId]?.limit ?? null, held: true, asked: true },
      history: { ts6h: inp.ts6h },
      intraday: { ts5m: inp.ts5m, ts6h: inp.ts6h, ts1h: inp.ts1h ?? null },
      position: {
        held: true, qty, avgCost, buyTs,
        ask: askFromSnapshot(offers, itemId), bid: bidFromSnapshot(offers, itemId),
        // support/cutTrigger need the 1h window series (not fetched on this booked-lots view) → null;
        // conviction still covers underwater/breakdown/thesis persistence off the shared state.
        watchStatePrior: priorState['held:' + itemId] || null, nowMs, thesisEntry,
      },
      // P4b: the path stage — weigh the lot's thesis-paths + run the persistence gate off the SAME
      // shared watch-state entry watch-positions.mjs persists. READ-ONLY here (P0 contract): quote renders the
      // armed/current path state but never saves it — only the watch loop writes the state file.
      paths: { watchStatePrior: priorState['held:' + itemId] || null, nowMs },
    });
    const row = ctx.market.row;
    const be = ctx.position.be;
    const v = renderHeldVerdict(ctx, { mode: 'compact' });   // the shared held-verdict renderer (P0)
    // P2 validators — the level we'd list the held lot at (patient band top). Set the reach candidate
    // on the built ctx (row now available) and run the registry. ts1h is NOT fetched here → degrade to
    // pass/no-data; a held lot is NEVER hidden, a fired flag is a NOTE + logged (verdict unchanged).
    ctx.intraday.reach = row.optSell != null ? { side: 'ask', level: row.optSell } : null;
    // LM1: buy-limit window overlay — accumulation awareness on a held lot (if you'd top up, how much
    // room is left this 4h window). limitValidator flags an exhausted/near limit as a NOTE (never hides).
    const limWin = limitWindow({ buys: buysByItemMap.get(itemId) || [], limit: map.byId[itemId]?.limit ?? null });
    ctx.limits = { window: limWin };
    const vres = runValidators(ctx);
    rows.push([...stdCells(name + ` ×${qty}`, row), fmtP(Math.round(avgCost)), fmtP(be), v]);
    notes.push({ kind: 'regime', itemId, text: regimeLine(name, row, map.byId[itemId]?.limit ?? null, limWin) });
    { const s = staleLiveNote(name, itemId, row); if (s) notes.push(s); }
    const gl = guideAnchorLine(guideAnchorModel(guideUpdates(hist, itemId)), guide[itemId] ?? null);
    if (gl) notes.push({ kind: 'guideAnchor', itemId, text: gl });
    for (const f of flags(vres)) notes.push({ kind: 'validator', itemId, text: `${name} ${f.key}: ${f.reason}` });
    // WC1 (PLAN-WINDOW-CLEAR-OUTCOMES): this held lot's O1 suggestion push is DEFERRED to after the
    // big-ticket windowExit note block below, so the window-clear ask-rung shadow (`windowExit`) can ride
    // the SAME row — the note block computes the askExitRead the shadow reshapes (zero extra fetch). The
    // deferral moves NO stdout and reads nothing from `sugg` in between; windowExitShadowVal stays null for
    // a non-big-ticket lot (→ byte-identical row).
    let windowExitShadowVal = null;
    // P0: conviction timers — surfaced as an informational line (the table's Verdict column is
    // unchanged). Mirrors watch-positions.mjs's armed/escalated read off the SAME shared watch-state, so the
    // two surfaces agree on how long a lot has been underwater / whether an escalation has confirmed.
    const g = ctx.position.gate, d = ctx.position.deltas;
    const persistMin = Math.round(ALERT_PERSIST_MS / 60000);
    const heldMin = ms => Math.max(0, Math.round((ms || 0) / 60000));
    if (g && g.armed && g.reason === 'cut-candidate-armed')
      convLines.push(`  ${name}: CUT-CANDIDATE armed — underwater ~${heldMin(d && d.underwaterMs)}m through a liquid window; confirms once it persists ~${persistMin}m (per shared watch-state).`);
    else if (g && g.armed && g.reason === 'thesis-armed')
      convLines.push(`  ${name}: expected-underwater — silenced above declared tripwire ${fmtP(ctx.position.thesis?.tripwire)} (per hold thesis).`);
    else if (g && g.escalate && g.reason === 'cut-candidate')
      convLines.push(`  ${name}: CUT-CANDIDATE confirmed — underwater sustained ~${heldMin(d && d.underwaterMs)}m (≥ ${persistMin}m) through a liquid window.`);
    // P4b: the shared dominant-path line (same renderPathLine watch-positions.mjs's note block uses) — the
    // persistence-gated path read off the SAME state, so the two surfaces agree on the current path.
    const pl = renderPathLine(ctx);
    if (pl) pathLines.push(`  ${name}: ${pl}`);
    // Bar E ask-headroom (inform-only, PLAN Bar-E-signal): on a HELD lot the verdict's "list @ X" is a
    // FLOOR, not a ceiling — surface upside above it so the ask ladders UP, not down. Class 1 = the robust
    // p90 shaved a TRADED in-band top (askHeadroomText); Class 2 = a live breakup above the 2h band (the
    // EXISTING mom tell re-voiced as ladder guidance, no new number). Sibling line off the verdict (the
    // renderPathLine pattern) — the verdict string + momVerdict are UNTOUCHED (no APP_VERSION, no
    // byte-identity break); never an alert/reprice input. The lean askHeadroom field is logged via suggestionEntry.
    // Proposal C (2026-07-12): stale declared-exit auto-flag — INFORM-ONLY. When the hold thesis
    // declares a numeric exit, score it against the recent full-day reach history (lib/staleexit.mjs
    // — windowread's own windowStats/recencySplit/recentQuant, the reachValidator machinery). A
    // declared exit recent nights no longer print gets a NOTE naming the reachable level (the
    // 44.34m-Masori / 3.24m-Berserker miss). NEVER moves a quoted number, verdict, gate, or the
    // break-even floor; the thesis stays as declared until Ben re-declares it. The 1h fetch is
    // targeted (declared-exit lots only) + TTL-cached — see TS_TTL_1H_EXIT above.
    if (thesisEntry && typeof thesisEntry.exitPrice === 'number' && Number.isFinite(thesisEntry.exitPrice)) {
      let ts1hExit = inp.ts1h ?? null;                       // reuse a series if one is ever in hand
      if (!ts1hExit) { try { ts1hExit = await fetchTsCached(itemId, '1h', TS_TTL_1H_EXIT); } catch { ts1hExit = null; } }
      const se = staleExitRead({ ts1h: ts1hExit, exitLevel: thesisEntry.exitPrice, now: new Date(nowMs) });
      if (se && se.stale) {
        const reach = se.reachable != null ? `; recent reachable peak ~${fmtP(se.reachable)}` : '';
        notes.push({ kind: 'staleExit', itemId, text: `${name}: declared exit ${fmtP(thesisEntry.exitPrice)} looks STALE on reach — printed ${se.recentHit}/${se.recentDays} recent nights (${se.fullHit}/${se.fullN} over ~14d, bar <${Math.round(STALE_EXIT_RECENT_FRAC * 3)}/3 recent)${reach}. Inform-only (PLACEHOLDER threshold, n≈0; touched ≠ filled) — verdict/thesis unchanged; re-declare via declare-thesis.mjs if you agree.` });
      }
    }
    // PB4 (PLAN-DEPTH-EXIT / PLAN-REACHABILITY-CONSOLIDATION) — the pressure-exit TRIAL line on a held
    // lot: the pressure-driven list-at (Est. sell) + deep re-buy bid, BE-floored, WITH the conservative
    // depth floor beside it (the reference). INFORM-ONLY — the Verdict column + the shared renderHeldVerdict
    // are UNTOUCHED (app-parity safe); this is opt-in decision support. This booked-lots view doesn't fetch
    // the 1h series by default, so under the flag we do a TARGETED, TTL-cached 1h fetch (the same pattern
    // the declared-exit staleness read uses) — the cost the owner opts into with the flag. The retro
    // co-log is unaffected (runPositions logs the neutral verdict; no est is logged here).
    if (PRESSURE_EXIT) {
      let ts1hP = inp.ts1h ?? null;
      if (!ts1hP) { try { ts1hP = await fetchTsCached(itemId, '1h', TS_TTL_1H_EXIT); } catch { ts1hP = null; } }
      const astP = ts1hP ? windowStats(ts1hP, { nights: 14, wStart: 0, wEnd: 0 }) : null;
      const reachableP = astP ? reachableBand(astP) : null;
      const depthP = ts1hP ? clearableAsk(ts1hP, { qty, wStart: 0, wEnd: 0, nights: 14 }) : null;
      const estP = reachableP ? estimatePair(FLIP_NICHES.band, row, {
        reachable: reachableP, dayHigh: dayHighFrom5m(inp.ts5m), intendedUnits: qty,
        declaredExit: thesisEntry?.exitPrice ?? null,
      }, { nudge: anchorNudge, sellModel: 'pressure' }) : null;
      if (estP && estP.confidence.pressureExit) {
        const pe = estP.confidence.pressureExit;
        const clause = depthReachClause({ ca: depthP, rb: reachableP, qty });
        notes.push({ kind: 'pressureExit', itemId, text: `${name}: pressure-exit — list @ ${fmtP(estP.estSell)}${estP.confidence.beFloored ? ` (below BE ${fmtP(estP.be)} — cut/damage-control price, not a profit)` : ''} · re-buy bid ${fmtP(estP.estBuy)} (pressure ${pe.pressure.toFixed(1)}×${pe.reliability != null && pe.reliability < 1 ? ` rel ${pe.reliability.toFixed(2)}` : ''}, BE ${fmtP(estP.be)})${clause ? ` · ${clause}` : ''} — TRIAL, un-calibrated (n≈0)` });
      } else if (!ts1hP) {
        notes.push({ kind: 'pressureExit', itemId, text: `${name}: pressure-exit — no 1h series available this pass (targeted fetch failed); re-run watch for the pressure read.` });
      }
    }
    const ahHeld = askHeadroomText(row);
    if (ahHeld) notes.push({ kind: 'askHeadroom', itemId, text: `${name}: ask headroom — ${ahHeld}` });
    else if (row.mom === 'breakup' && row.optSell != null) notes.push({ kind: 'askHeadroom', itemId, text: `${name}: list @ ${fmtP(row.optSell)} is a FLOOR, not a target — live broke +${(row.momPct * 100).toFixed(1)}% above the 2h band; step the ask above the live print (the GE better-price rule fills higher if depth is there). Inform-only, n=1.` });
    // PLAN-QUOTE-PLACEMENT (Ben 2026-07-17): the same reach/placement fold as the plain-quote path above,
    // on the held-lot view — inp.ts1h is already fetched unconditionally for this booked-lots row (the
    // PLAN-VOL24 parity fix above), so this is zero new fetch. Degrades/skips the same way.
    const astHeld = inp.ts1h ? windowStats(inp.ts1h, { nights: 14, wStart: 0, wEnd: 0 }) : null;
    const bidReachHeld = (astHeld && astHeld.lows && astHeld.lows.length && row.optBuy != null)
      ? { reachedDays: touchedDays(astHeld.lows, row.optBuy), nDays: astHeld.lows.length, ...recencySplit(astHeld.days, 'bid', row.optBuy) } : null;
    const askReachHeld = (astHeld && astHeld.his && astHeld.his.length && row.optSell != null)
      ? { reachedDays: reachedDays(astHeld.his, row.optSell), nDays: astHeld.his.length, ...recencySplit(astHeld.days, 'ask', row.optSell) } : null;
    const bidPlaceHeld = bidReachHeld ? placement(astHeld.lows, row.optBuy) : null;
    const askPlaceHeld = askReachHeld ? placement(astHeld.his, row.optSell) : null;
    const pct = f => 'p' + Math.round(f * 100);
    // PLAN-POSITIONS-WINDOW-READ (Ben, 2026-07-18): for a BIG-TICKET held lot (lot value ≥ BIG_TICKET_GP,
    // or a watchlist member — the same force-include the incidental filter uses), auto-surface the full
    // ask-side window-clear / "typical exit" read that used to require a manual `read-window-range.mjs
    // "<item>" --ask <level>` — the daily-HIGH typical-exit levels, the list-price reach/placement, the
    // less-smoothed 5m-grain reach, live-instabuy-vs-list, and which diurnal window the level prints in.
    // ONE assembly via the shared askExitRead (byte-parity with read-window-range's --ask block); ZERO new
    // fetch (inp.ts1h is already in hand; the 5m grain is a best-effort local archive read via snap). The
    // whole block is fetch-resilient: a null 1h series (its fetch failed above) or any throw degrades to a
    // single "window read unavailable" note — the table/verdict is the critical output, this is enrichment.
    // The ask-side placement is folded into this richer note, so reachPlacement drops its ASK clause here
    // (kept for non-big-ticket lots); the BID clause still rides on reachPlacement (ask-side-only per the plan).
    const bigTicket = cost >= BIG_TICKET_GP || watchlistIds.has(itemId);
    let windowExitDone = false;
    if (bigTicket) {
      try {
        const list = (thesisEntry?.exitPrice ?? null) ?? (row.optSell ?? null);   // the intended list-at level
        // 5m-grain window stats off the read-only archive snap already open this pass (best-effort, null-safe).
        let stats5m = null;
        try {
          const rows5 = (snap && snap.archive) ? snap.archive.seriesFor(itemId, '5m') : null;
          if (rows5 && rows5.length) {
            const mapped = rows5.map(x => ({ timestamp: x.ts, avgLowPrice: x.avgLowPrice, avgHighPrice: x.avgHighPrice, lowPriceVolume: x.lowPriceVolume, highPriceVolume: x.highPriceVolume }));
            stats5m = windowStats(mapped, { nights: 14, wStart: 0, wEnd: 0 });
          }
        } catch { stats5m = null; }
        // which diurnal window the level prints in + the pace read (zero-fetch off the in-hand series);
        // profH is computed BEFORE askExitRead so the reach-margin pace read has the hour profile in hand.
        const profH = hourProfile(inp.ts1h, { nights: 14 });
        const drH = profH ? deriveDiurnalRange(profH, {}) : null;
        // thread the /latest print AGE + staleness (row.quoteAgeMin/row.quickStale) into the live object so
        // the reach-margin pace read refuses to run off a stale tick (the 64-min godsword anchor, 2026-07-21).
        const aerLive = { lo: row.quickBuy ?? null, hi: row.quickSell ?? null,
          staleLo: !!row.quickStale?.buy, staleHi: !!row.quickStale?.sell,
          loAgeMin: row.quoteAgeMin?.buy ?? null, hiAgeMin: row.quoteAgeMin?.sell ?? null };
        const aer = astHeld ? askExitRead(astHeld, { ask: list, stats5m, profile: profH, live: aerLive }) : null;
        if (!aer) {
          notes.push({ kind: 'windowExit', itemId, text: `${name}: window read unavailable — no 1h series this pass` });
        } else {
          const peakTxt = (drH && drH.peakWindow) ? ` · peak window ${fmtHourRange(drH.peakWindow.startH, drH.peakWindow.endH)}` : '';
          const as = aer.askSide;
          const parts = [];
          if (aer.ask) {
            const rc = aer.ask.recency || {};
            parts.push(`list ${fmt(aer.ask.level)} reached ${aer.ask.reachedDays}/${aer.ask.nDays}d (recent ${rc.recentHit ?? '—'}/${rc.recentDays ?? '—'}) · placement ${pct(aer.ask.placement)} of the ${aer.ask.nDays}-day daily-HIGH distribution`);
          }
          parts.push(`typical exit ~50% ${fmt(as.q50)} / ~75% ${fmt(as.q75)} / every-day ${fmt(as.everyDay)}${as.recent50 != null ? ` · recent-3 ~50% ${fmt(as.recent50)}` : ''}`);
          // live instabuy — carry its AGE when the print is stale (past QUICK_FRESH_MIN), so the number is
          // never read as a live tick when it's an hour-old print (the godsword 39.75m@64m lesson).
          if (row.quickSell != null) parts.push(`live instabuy ${fmt(row.quickSell)}${row.quickStale?.sell ? ` ⚠ ${Math.round(row.quoteAgeMin?.sell ?? 0)}m old` : ''}`);
          if (aer.grain5m) parts.push(`5m-grain reached ${aer.grain5m.reachedDays}/${aer.grain5m.nDays} · ${pct(aer.grain5m.placement)}`);
          // reach-margin FADE clause — the cushion trend + today's pace, compact (full per-day read is read-window-range's job)
          const rm = aer.ask && aer.ask.reachMargin;
          if (rm && (rm.trend || rm.pace)) {
            const sg = v => v == null ? '—' : (v >= 0 ? '+' : '') + fmt(v);
            let c = `margin ${sg(rm.cushionNow)} today`;
            if (rm.trend) c += ` · cushion ${rm.trend === 'fading' ? '⚠ ' : ''}${rm.trend} ${sg(rm.cushionFrom)}→${sg(rm.cushionTo)} (${rm.nRecent}d)`;
            if (rm.pace && rm.pace.stale) c += ` · pace n/a (live ${rm.pace.ageMin != null ? Math.round(rm.pace.ageMin) + 'm' : ''} stale)`;
            else if (rm.pace) c += ` · pace ${sg(rm.pace.gap)} vs ${fmtHour(rm.pace.hour)} median${rm.pace.onPace ? '' : ' ⚠ lagging'}`;
            parts.push(c);
          }
          notes.push({ kind: 'windowExit', itemId, text: `${name}: window-clear — ${parts.join(' · ')}${peakTxt}  (touched ≠ filled, ~${aer.nDays}d — a guide)`,
            data: { list, live: row.quickSell ?? null, peakWindow: (drH && drH.peakWindow) ? drH.peakWindow : null, ...aer } });
          // WC1: the lean forward record for F1 — the surfaced rung + both reach signals off the SAME aer.
          windowExitShadowVal = windowExitShadow(aer, {
            list, live: row.quickSell ?? null,
            peakWindow: (drH && drH.peakWindow) ? [drH.peakWindow.startH, drH.peakWindow.endH] : null,
          });
          windowExitDone = true;
        }
      } catch (e) {
        notes.push({ kind: 'windowExit', itemId, text: `${name}: window read unavailable (${(e && e.message || 'error').split('\n')[0]})` });
      }
    }
    // WC1: the deferred O1 suggestion push (moved down from above so the big-ticket `windowExit` rung shadow
    // rides this row). windowExitShadowVal is null for a non-big-ticket lot → byte-identical to the prior row.
    const cs = classAndSource(row, itemId, warm24h);   // SF-3: class + volSrc ('bulk' via snap.v24 on the normal path)
    sugg.push(suggestionEntry(row, { itemId, cls: cs.cls, volSrc: cs.volSrc, verdict: v, posture: isOvernightNow() ? 'overnight' : 'active', validators: leanValidators(vres), windowExit: windowExitShadowVal }));  // the emitted per-position verdict string
    // reachPlacement — the existing bid+ask percentile note. For a big-ticket lot the ASK clause is now
    // carried by the richer windowExit note above, so keep only the BID clause here (no redundancy); a
    // non-big-ticket lot keeps both, unchanged.
    {
      const parts = [];
      if (bidPlaceHeld != null) parts.push(`bid ${fmt(row.optBuy)} touched ${bidReachHeld.reachedDays}/${bidReachHeld.nDays}d (recent ${bidReachHeld.recentHit ?? '—'}/${bidReachHeld.recentDays ?? '—'}) · placement ${pct(bidPlaceHeld)} of the ${bidReachHeld.nDays}-day daily-LOW distribution`);
      if (!windowExitDone && askPlaceHeld != null) parts.push(`ask ${fmt(row.optSell)} reached ${askReachHeld.reachedDays}/${askReachHeld.nDays}d (recent ${askReachHeld.recentHit ?? '—'}/${askReachHeld.recentDays ?? '—'}) · placement ${pct(askPlaceHeld)} of the ${askReachHeld.nDays}-day daily-HIGH distribution`);
      if (parts.length) notes.push({ kind: 'reachPlacement', itemId, text: `${name}: reach/placement — ${parts.join(' — ')}` });
    }
    // multi-day trajectory (shape + floor/ceiling + live position) — the fang under-read fix; zero fetch.
    // Chunk 5: the drift-adjusted exit level off the in-hand ts1h (the profile is computed from the series
    // already fetched this pass — NO new fetch; the bigTicket block's profH is scoped there, so compute a
    // profile here for the general held-lot path) + the row's diurnalForecast ctx bits.
    const profT = inp.ts1h ? hourProfile(inp.ts1h, { nights: 14 }) : null;
    pushTrajectory(notes, astHeld && astHeld.days, { liveRef: row.quickBuy ?? row.quickSell, label: name,
      prof: profT, ctx: { liveLo: row.quickBuy, liveHi: row.quickSell, phase: row.phase, mom: row.mom, reliable: row.reliable } });
    // ADD-while-holding SOFT-BUY timing — the held-lot surface is exactly where the "should I add at the dip?"
    // decision lives. inp.ts1h is in hand (fetched at the vol24 parity step above), so this is zero new fetch.
    pushSoftBuy(notes, { ts1h: inp.ts1h, live: row.quickBuy ?? null, itemId });
    // COD-3: on a CUT-family verdict (CUT / CUT-CANDIDATE / LIST-TO-CLEAR), surface the cut-and-rebid
    // advisory so the agent stops re-deriving the friction arithmetic. TRAJECTORY-AWARE (Ben 2026-07-10):
    // rebidAdvice reads the multi-week shape — a KNIFE says don't rebid; an OSCILLATING faller says rebid
    // at the diurnal trough & sell the daily peak; else the friction bar (tax + ½-spread below the clear)
    // governs. diurnal is null here (this booked-lots view doesn't fetch the 1h series) → the oscillating
    // branch names the diurnal dip/peak qualitatively; the friction bar (the SOLID half) is always exact.
    // Inform-grade decision SUPPORT — it never overrides momVerdict.
    if (/^(CUT|LIST-TO-CLEAR)/.test(v) && row.quickSell != null) {
      const trajectory = (termStructure(dailyPos[itemId]) || {}).trajectory || null;
      const spread = (row.quickSell != null && row.quickBuy != null) ? row.quickSell - row.quickBuy : 0;
      const adv = rebidAdvice({ clear: row.quickSell, spread, trajectory, diurnal: null });
      rebidLines.push(`  ${name}: ${adv.why}`);
    }
    // S2 morning-staleness watch (informational only — the Verdict column above is UNCHANGED). A resting
    // SELL is at risk of being stale/underwater by morning if it can't clear at profit now (instabuy <
    // break-even) or the market is weakening (falling regime / live 2h breakdown).
    if (row.reliable && ((row.quickSell != null && row.quickSell < be) || row.falling || row.mom === 'breakdown')) staleRisk.push(name);
  }
  // O1 suggestions ledger: log the position verdicts at emit time, unconditionally.
  logSuggestions('quote', { mode: null, params: { positions: true } }, sugg);
  if (snap) { try { snap.archive.close(); } catch {} }   // P0: loadSnapshot leaves the archive open when it owns it
  // VZ3: build the report + render it ONCE (byte-identical to the prior console.log sequence). The
  // header, the loud pressure banner, the SHARED stale-book banner (item-context.mjs staleBookBanner —
  // COD-4, so watch/quote word the stale-book warning identically), the table, the typed note block,
  // and the conviction/paths/rebid/late-night blocks all become ordered report sections.
  const lateNightLine = (isOvernightNow() && staleRisk.length)
    ? `ℹ Late-night: ${staleRisk.length} held position(s) may be stale/underwater by morning — re-verdict at the morning liquid window (${staleRisk.join(', ')}).`
    : null;
  const report = buildQuoteReport({
    mode: 'positions',
    header: `# Open positions vs market (${groups.length} items, ${openLots} lots)\n`
      + (incidentalNames.length ? `incidental inventory, ignored: ${incidentalNames.join(', ')}\n` : ''),
    pressureBanner: PRESSURE_EXIT ? PRESSURE_BANNER : null,
    staleBanner: staleBookBanner(ageMin),
    headers, rows,
    notes,
    convLines, pathLines, rebidLines, lateNightLine,
  });
  console.log(renderReport(report));   // no-op unless --verbose
  const rel = writeLastReport('quote', report);   // AO1: always dump the report object for an agent read
  if (!VERBOSE) realLog(`# positions (quiet default; --verbose for the table) — ${groups.length} item(s), ${openLots} lot(s) → ${rel}`);
}

// Entrypoint guard (matches watch-positions.mjs / screen-flip-niches.mjs): importing this module for a
// unit test (buildQuoteReport off fixtures) must NOT fire a live market read / hit the API.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (POSITIONS_MODE) await runPositions();
  else await runItems();
}
