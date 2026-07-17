#!/usr/bin/env node
/**
 * watch-positions.mjs — ADAPTIVE, item-type-aware live-session monitor (chunk 7).
 *
 * A market-aware companion to monitor-offers.mjs. Where monitor-offers.mjs is a LOG-STATE snapshot
 * (active offers / recent fills / held count from the exchange log, no market fetch),
 * watch-positions.mjs is the MARKET side of the loop: it re-quotes every held/target item live via
 * js/quotecore.js, classifies it by item TYPE, and drives a human-executed polling session
 * (the /loop skill, ~1–3 min) with:
 *   - per-item CLASS  → recommended attention cadence + which playbook applies
 *   - live re-quoted buy-at / list-at prices (list-at is ALWAYS break-even-floored)
 *   - DROP / CUT alerts via the SHARED chunk-6 cut-trigger momVerdict()
 *   - a compact per-item RISK read (spread · two-sided liquidity · regime · ticket/exposure)
 *     with an adverse-selection warning, and the scalp/market-make playbook gated to
 *     ranging-wide-spread items ONLY.
 *
 * Why a sibling and not an edit to monitor-offers.mjs: monitor-offers.mjs is the raw log-state snapshot
 * (no market fetch); watch-positions.mjs owns market fetch + quotecore classification. Log discovery
 * and open-offer semantics are SHARED via offers.mjs (one owner, both import it).
 * Run monitor-offers.mjs for the raw log state; run watch-positions.mjs to decide what to do.
 *
 * DEFAULT is quiet: prints ONE summary line + the last-report dump path, not the markdown table.
 * The report object is ALWAYS written to pipeline/.cache/last-report/watch.json (gitignored,
 * overwritten per run) — read THAT file for the actual data, never the summary line. Pass
 * --verbose for the markdown table (Ben's terminal read / the "paste this" case). AO1.
 *
 * GUARDRAILS (hard):
 *   - HUMAN-EXECUTED DECISION SUPPORT ONLY. This tool NEVER places or cancels a GE offer —
 *     automating GE interaction is botting and bannable. It tells you WHEN to act; you click.
 *   - READ-ONLY w.r.t. the MARKET and POSITIONS: it never places/cancels a GE offer and never
 *     writes fills.json / positions.json / any market file. It DOES append each read to the
 *     analytics suggestions.jsonl ledger (O1) — that's a passive record of what was recommended,
 *     not a market action.
 *   - No reimplemented quote/tax/regime/momentum math — ALL of it is js/quotecore.js.
 *
 * POSITION = any committed capital (Ben's definition, 2026-07-04): held inventory PLUS
 * every active GE offer — a resting BUY is capital committed to buying, a resting SELL is
 * held inventory being sold. The default run therefore watches BOTH:
 *   - held basis = repo-root positions.json OPEN lots (the pipeline's WITHDRAWN/BANKED-aware
 *     FIFO from reconstruct.mjs, written by sync-fills.mjs — the booked view, ~20m sync lag,
 *     printed so a very recent trade's lag is visible);
 *   - active offers = the live exchange log via offers.mjs (~0 lag): asks annotate their held
 *     row (listed n/m @ X, or NOT LISTED as an exit-discipline nudge); bids get their own
 *     section + verdicts (BID-OK / BID-BEHIND / CROSSING / CANCEL-BID — the last also alerts:
 *     a bid filling into a breakdown/falling market is adverse selection, cancel it).
 *   Noise guard: offers under NOISE_OFFER_GP total value are collapsed to one ignored line.
 *
 * Usage:
 *   node pipeline/commands/watch-positions.mjs                       # every position: held lots + active offers
 *   node pipeline/commands/watch-positions.mjs "Crystal seed" 23959  # also watch these target items (buy-side)
 *   node pipeline/commands/watch-positions.mjs --targets-only "Ranarr weed"   # skip held+offers, watch only these
 *   node pipeline/commands/watch-positions.mjs --dip "Searing page"  # DL2: also watch dip-watchlist.json for LIQUID flushes (bid-into-the-fall)
 * Every run syncs fills first, unconditionally (2026-07-16) — local/zero-git, never blocks the pass
 * on failure. `--sync` still parses (harmless no-op) for any external caller that still passes it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { renderReport } from '../lib/render.mjs';   // VZ1 (PLAN-VIZ-LAYER) — the ONE render layer; this output pass builds a report object and prints renderReport(buildWatchReport(...))
import { writeLastReport } from '../lib/cli.mjs';   // AO1 — agent-readable last-report dump (pipeline/.cache/last-report/watch.json)
import { computeQuote, breakEven, momVerdict, offerVerdict, BIG_TICKET_GP,
  diurnalRead, phase, underwaterHours, isOvernightNow, pressureText, flushSignal,
  quoteCells as canonicalQuoteCells, cellText } from '../../js/quotecore.js';   // VZ2b — the ONE canonical table-v2 cell format for the watch Quick/Optimistic cells
import { limitWindow, buysByItem } from '../lib/limits.mjs';   // DL2 — buy-limit-aware FLUSH clause
import { fmtP, fmt } from '../../js/money-format.js';
import { briefLine } from '../../js/watchcore.js';   // --brief compact book: format owned by the script
import { renderHeldVerdict, pathsStage, renderPathLine, rawHeldToken, heldDisplay } from '../lib/item-context.mjs';   // P0 — the ONE shared held-verdict renderer (verbose mode = this surface); P4b — path stage + shared dominant-path line; VN-1 — persistence-gated display layer
import { loadIgnored } from '../lib/ignored.mjs';   // MERCH-book quarantine (farming/loot) for the live-offer view
import { loadMapping, loadGuide, fetchItemInputs, loadSnapshot, vol24FromInputs } from '../lib/marketfetch.mjs';   // vol24FromInputs (PLAN-VOL24) — corrected per-item rolling-24h volume off the in-hand ts1h
import { readOpenPositions } from '../lib/positions.mjs';
import { readExchangeLog, activeOffers, restartBlindSuspects } from '../lib/offers.mjs';
import { logSuggestions, suggestionEntry, reachableShadow, depthExitShadow, asymShadow } from '../lib/suggestlog.mjs';   // DE3/RC-S1: shared reachable/depthExit/asym ledger-shadow reshapers (one home, no drift across watch/screen/quote)
import { windowStats, quantLow, quantHigh, touchedDays, reachedDays, recencySplit, RECENT_NIGHTS, hourProfile, deriveDiurnalRange, clearableAsk, reachableBand, asymPair } from '../../js/windowread.mjs';   // VN-2: hourProfile/deriveDiurnalRange feed the thesis frame's diurnal-ask fallback (zero extra fetch — ts1h already in hand); DE3: clearableAsk depth floor + reachableBand pressure read on held lots; RC-S1: asymPair for the head-to-head co-log
import { estimatePair, asymEstimate, estConfLean, dayHighFrom5m } from '../lib/estimators.mjs';   // RC-S1 (PLAN-REACHABILITY-CONSOLIDATION): the reachRelief-family estSell + asym pair, co-logged beside depthExit/reachable for the head-to-head
import { FLIP_NICHES } from '../../js/flip-niches.mjs';   // RC-S1: the neutral band thesis for the held-lot est/asym shadow (same convention as quote-items --positions)
import { blindWarningLine } from '../lib/logblind.mjs'; // LH2 restart-blindness header line
import { reachRelief, askReachFactor } from '../lib/estimators.mjs'; // PLAN-LIQUIDITY-REACH: size/liquidity-conditioned ask-reach relief on a held lot
import { resolve, loadPipelineConfig } from '../lib/compose.mjs';   // PC1 — the flag>config>default precedence resolver (routes --pressure-exit here)
import { loadState, saveState, computeDeltas, advanceState, convictionGate, ALERT_PERSIST_MS, marginBudgetNote } from '../lib/watchstate.mjs'; // V1 cross-pass memory + V4/V7 conviction gating; PB-COPILOT-1 margin-reduction budget
import { structuralSupport, cutTrigger, SUPPORT_LOOKBACK_DAYS } from '../lib/levels.mjs';   // V2 support/cut-trigger
import { heldNoteBlock, heldListAt, depthReachClause } from '../lib/emit.mjs';   // V5 standardized per-held emit contract; DE3 depth/pressure clause
import { recoveryRead, recoveryLine, recoveryTrigger } from '../lib/recovery.mjs';   // V6 advisory recover-vs-drop forecast
import { freedCapital } from '../lib/freed-capital.mjs';   // V6 companion — freed-capital redeploy prompt
import { bookUtilization, totalCapital } from '../lib/capital-utilization.mjs';   // YV1 (#3) — working-vs-parked capital line
import { loadDerivedCash } from '../lib/derive-cash-tiers.mjs';    // total-capital: DERIVED idle-cash denominator (derive-cash.mjs anchor + log flow)
import { loadThesis, pruneThesis, thesisLine } from '../lib/sessionthesis.mjs';   // YT1 (#4) — read-only session-thesis reminder
import { loadHoldThesis, pruneHoldThesis, thesisFor } from '../lib/holdthesis.mjs';   // TG1 — read-only declared-hold-thesis store (gates the expected-underwater headline)
import { loadGuideHistory, guideUpdates, guideAnchorModel, guideAnchorLine } from '../lib/guideanchor.mjs';   // YP1 (#2) advisory guide re-anchor line

const HERE = path.dirname(fileURLToPath(import.meta.url));
const POSITIONS = path.join(HERE, '..', '..', 'positions.json');
const FILLS = path.join(HERE, '..', '..', 'fills.json');   // DL2 — logged buys for the FLUSH buy-limit clause
const DIP_WATCHLIST = path.join(HERE, '..', '..', 'dip-watchlist.json'); // DL2 tracked pool of LIQUID flush candidates (--dip)
const GUIDE_HISTORY = path.join(HERE, '..', '.guide-history.jsonl'); // TRACKED change-only guide log (accruing record; kept OUTSIDE .cache/)
const WATCH_STATE = path.join(HERE, '..', '.cache', 'watch-state.json'); // gitignored, V1 cross-pass state (.cache/ ignored)
const THESIS_PATH = path.join(HERE, '..', '.cache', 'session-thesis.json'); // gitignored, YT1 session thesis (read-only here; declare-thesis.mjs writes)
const HOLD_THESIS_PATH = path.join(HERE, '..', '..', 'hold-thesis.json'); // TRACKED at repo root, TG1 declared-hold-thesis store (agent-written; read-only here)

/* Append one line per watched item whose GE guide price CHANGED since the last logged value
   (first sighting logs too). Each line is an observed guide-update event: pinning WHEN an
   item's ~daily guide refresh lands + its magnitude is the raw material for pricing around
   the guide-anchored buyer re-anchor (Ben, 2026-07-06). Local, best-effort, never throws. */
function logGuideChanges(items, guide) {
  try {
    const last = {};
    if (fs.existsSync(GUIDE_HISTORY)) {
      for (const line of fs.readFileSync(GUIDE_HISTORY, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { const r = JSON.parse(line); last[r.id] = r.guide; } catch { /* skip bad line */ }
      }
    }
    const out = [];
    const seen = new Set();
    for (const it of items) {
      const g = guide[it.id];
      if (g == null || seen.has(it.id)) continue;
      seen.add(it.id);
      if (last[it.id] === g) continue;
      out.push(JSON.stringify({ ts: Math.floor(Date.now() / 1000), id: it.id, name: it.name, guide: g, prev: last[it.id] ?? null }));
    }
    if (out.length) fs.appendFileSync(GUIDE_HISTORY, out.join('\n') + '\n');
  } catch { /* observability only — never block a watch pass */ }
}

// ---------------------------------------------------------------------------
// CLASSIFICATION taxonomy — tunable named constants, NOT magic numbers.
// Boundaries are justified in pipeline/MONITORING.md ("Item-type classes"); the
// short version:
//   LIQUID_FLOOR_PER_DAY — two-sided daily volume below which a book is "thin". 100/d is
//     the practical floor codified in CLAUDE.md (below it is ghost-spreads / no reliable
//     exit); Vol/d here is already the limiting side (min hi/lo vol) from computeQuote.
//   BIG_TICKET_UNIT_GP — per-UNIT price at/above which a single unit is large capital, so a
//     drop is expensive per fill (bludgeon/lightbearer territory). Distinct from the chunk-6
//     BIG_TICKET_GP, which is a whole-LOT (qty×cost) capital-at-risk threshold — momVerdict
//     still uses that one; this one only steers cadence/class.
//   WIDE_SPREAD_PCT — (instabuy−instasell)/instasell at/above which the intraday band is wide
//     enough to be the edge (ladder the band). Tax is 2% on the sell, and CLAUDE.md wants
//     meaningfully >~0.5% AFTER tax → ~3% gross spread is the smallest band worth scalping.
// ---------------------------------------------------------------------------
const LIQUID_FLOOR_PER_DAY = 100;
const BIG_TICKET_UNIT_GP   = 1_000_000;
const WIDE_SPREAD_PCT      = 3;
// Offers below this TOTAL value (max × price) are noise, not positions — collapsed to one
// ignored line so a stray 2k-gp supply order never earns a verdict (the /positions skill's
// incidental-inventory rule, applied to offers).
const NOISE_OFFER_GP       = 100_000;

// Attention cadence (minutes) the /loop should re-check an item at. The loop runs at ONE
// interval; we recommend the TIGHTEST cadence across everything monitored so the most urgent
// item is polled often enough. 1–3 min matches the plan (GE fills over minutes→hours).
const CADENCE_TIGHT = 1;   // hair-trigger: falling, or thin big-ticket volatile
const CADENCE_MED   = 2;   // active watch: ranging scalp, thin, or unconfirmed regime
const CADENCE_LOOSE = 3;   // glance: stable liquid narrow-band

// class -> {cadence, scalp(is market-making the playbook?), label}
const CLASSES = {
  FALLING:                    { cadence: CADENCE_TIGHT, scalp: false, label: 'FALLING' },
  THIN_BIG_TICKET_VOLATILE:   { cadence: CADENCE_TIGHT, scalp: false, label: 'THIN_BIG_TICKET_VOLATILE' },
  LIQUID_RANGING_WIDE:        { cadence: CADENCE_MED,   scalp: true,  label: 'LIQUID_RANGING_WIDE' },
  STABLE_LIQUID:              { cadence: CADENCE_LOOSE, scalp: false, label: 'STABLE_LIQUID' },
  THIN_OTHER:                 { cadence: CADENCE_MED,   scalp: false, label: 'THIN_OTHER' },
  UNKNOWN:                    { cadence: CADENCE_MED,   scalp: false, label: 'UNKNOWN' },
};

/* Assign an item TYPE from its quotecore row. Priority order matters: the hazard classes
   (falling, thin-big-ticket) win first, and the scalp class is only reachable on a liquid,
   flat-regime, wide-band item — so the market-make playbook can NEVER attach to a trending
   item. All inputs come from quotecore (regime/rising/falling/volDay/mom); no local math. */
function classify(row) {
  const unit = row.mid ?? row.quickBuy ?? row.quickSell ?? null;
  const liquid = row.volDay != null && row.volDay >= LIQUID_FLOOR_PER_DAY;
  const spreadPct = (row.quickBuy && row.quickSell != null)
    ? (row.quickSell - row.quickBuy) / row.quickBuy * 100 : null;
  // hazard first. The mom==='breakdown' → FALLING route is GATED on reliability (PLAN-3 Gate 0):
  // a breakdown derived from a stale / one-sided / sparse quote isn't trustworthy, so don't route
  // it to the 1-minute FALLING cut playbook. Multi-day row.falling stands on its own (regime, not mom).
  if (row.falling || (row.mom === 'breakdown' && row.reliable)) return 'FALLING';
  if (!liquid && unit != null && unit >= BIG_TICKET_UNIT_GP) return 'THIN_BIG_TICKET_VOLATILE';
  // scalp only on a confirmed-flat, liquid, wide-band item
  if (liquid && row.regime && row.regime.ok && !row.rising && spreadPct != null && spreadPct >= WIDE_SPREAD_PCT)
    return 'LIQUID_RANGING_WIDE';
  if (liquid && row.regime && row.regime.ok) return 'STABLE_LIQUID';
  if (!liquid) return 'THIN_OTHER';
  return 'UNKNOWN'; // liquid but regime unconfirmed, or volume unknown
}


// --- WINDOW CONTEXT line (2026-07-05, the ring lesson): the stateless 2h verdicts kept
// firing on a bid whose real question was time-of-day ("does this window print my level,
// and what does tomorrow recover to?") — evidence that previously needed a manual
// read-window-range.mjs call. This prints the same quantiles inline, scored over the COMING 8
// machine-local hours across the last 7 days. Same honesty bound as read-window-range.mjs:
// touched/reached ≠ filled, ~7 days is a small sample — context, never a verdict input.
const WINDOW_HOURS = 8;
const WINDOW_DAYS = 7;
function windowLine(ts1h, { bid = null, ask = null, compact = false, heldQty = null, volDay = null, depth = null, reachable = null } = {}) {
  if (!ts1h || !ts1h.length) return null;
  const h = new Date().getHours();
  const wStart = h, wEnd = (h + WINDOW_HOURS) % 24;
  const stats = windowStats(ts1h, { nights: WINDOW_DAYS, wStart, wEnd });
  if (!stats) return null;
  const { lows, his } = stats;
  // DE3 (PLAN-DEPTH-EXIT): the held-lot depth floor + pressure-reachable clause (whole-day reads the
  // caller computed off this same ts1h). When the depth read is NON-NULL it SUPERSEDES the Task-2
  // reliefSuffix (the depth read measures directly what relief only proxied); a COLLAPSED read prints
  // its reason and keeps the relief fallback. The two-lens framing lives in emit.depthReachClause.
  const depthOk = depth && depth.price != null;
  const depthClause = (heldQty != null && (depth || reachable))
    ? depthReachClause({ ca: depth, rb: reachable, qty: heldQty }) : null;
  const depthSuffix = depthClause ? ` · ${depthClause}` : '';
  // recency-split guard: a ⚠ marker when the full touched/reached count is concentrated in an
  // older price regime (recent nights don't dip to the bid / reach the ask) — see windowread.mjs
  const stale = (side, level) => recencySplit(stats.days, side, level, RECENT_NIGHTS).staleOptimistic ? ' ⚠stale' : '';
  // PLAN-LIQUIDITY-REACH: the raw N/Md ask-reach count measures how OFTEN the band top prints, NOT whether
  // YOUR size clears there — on a deep book a lot that is a small fraction of daily flow realistically fills
  // a higher percentile than the flat count implies. reachRelief (js/estimators.mjs) softens the discount when
  // BOTH the book is liquid AND the lot is small vs flow (intendedUnits = the REAL held qty here, not a proxy).
  // Surface it only when it has an EFFECT (relief > 0 AND the raw reach is a discount) — lean discipline; a thin
  // book / large lot / absent inputs ⇒ relief 0 ⇒ the bare count stands (the mirage guard is untouched).
  const reliefSuffix = (askLevel) => {
    if (heldQty == null || volDay == null || !his.length) return '';
    const rel = reachRelief({ intendedUnits: heldQty, volDay });
    if (!(rel > 0)) return '';
    const aR = { reachedDays: reachedDays(his, askLevel), nDays: his.length };
    const base = askReachFactor(aR, 0), relieved = askReachFactor(aR, rel);
    if (!(relieved > base)) return '';
    const pct = heldQty / volDay * 100;
    return ` · size-relieved fill ~${Math.round(relieved * 100)}% (${fmt(heldQty)}≈${pct < 0.1 ? '<0.1' : pct.toFixed(1)}% of ${fmt(volDay)}/d — deep book)`;
  };
  if (compact) { // one short clause for the notes list (same numbers, no label/caveat prose)
    if (bid != null && lows.length) return `bid ${fmtP(bid)} touched ${touchedDays(lows, bid)}/${lows.length}d${stale('bid', bid)}`;
    if (ask != null && his.length) return `ask ${fmtP(ask)} reached ${reachedDays(his, ask)}/${his.length}d${stale('ask', ask)}${depthOk ? '' : reliefSuffix(ask)}${depthSuffix}`;
    if (his.length) return `${WINDOW_HOURS}h highs ~75% ${fmtP(quantHigh(his, 0.75))} / ~50% ${fmtP(quantHigh(his, 0.5))}${depthSuffix}`;
    return depthClause;   // an unlisted lot with no window read still surfaces its depth/pressure read
  }
  const label = `next ${WINDOW_HOURS}h window (${String(wStart).padStart(2, '0')}–${String(wEnd).padStart(2, '0')}h × last ${stats.days.length}d)`;
  const bits = [];
  if (bid != null && lows.length)
    bits.push(`bid ${fmtP(bid)} touched ${touchedDays(lows, bid)}/${lows.length}d${stale('bid', bid)} · lows ~50% ${fmtP(quantLow(lows, 0.5))} / ~75% ${fmtP(quantLow(lows, 0.75))}`);
  if (ask != null && his.length)
    bits.push(`ask ${fmtP(ask)} reached ${reachedDays(his, ask)}/${his.length}d${stale('ask', ask)}${depthOk ? '' : reliefSuffix(ask)}`);
  if (his.length)
    bits.push(`highs reached ~75% ${fmtP(quantHigh(his, 0.75))} / ~50% ${fmtP(quantHigh(his, 0.5))}`);
  if (depthClause) bits.push(depthClause);
  if (!bits.length) return null;
  return `${label}: ${bits.join(' · ')}  (touched ≠ filled; small sample)`;
}

// --- V1 CROSS-PASS DELTA line (OUTPUT-ONLY temporal memory) ---------------------------------
// Renders the deltas from watchstate.computeDeltas() into one nested context line, e.g.
//   Δ instabuy -220k (5m) · mom clean→clean · 3rd pass underwater · band-top decaying 18.9m→18.8m
// Emitted ONLY when at least one signal is informative (a real Δ, a mom transition, ≥2 consecutive
// underwater passes, or a non-flat band-top drift) — a first-seen/reset pass or an all-quiet pass
// prints nothing. This changes NO verdict and raises NO alert; it is pure observability.
const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
function deltaLine(d) {
  if (!d || d.firstSeen) return null;
  const informative = (d.instabuyDelta != null && d.instabuyDelta !== 0)
    || d.momChanged || d.passesUnderwater >= 2
    || (d.bandTopTrend && d.bandTopTrend !== 'flat');
  if (!informative) return null;
  const bits = [];
  if (d.instabuyDelta != null && d.instabuyDelta !== 0) {
    const g = d.gapMs != null ? ` (${Math.max(1, Math.round(d.gapMs / 60000))}m)` : '';
    bits.push(`Δ instabuy ${d.instabuyDelta > 0 ? '+' : ''}${fmtP(d.instabuyDelta)}${g}`);
  }
  if (d.momTransition) bits.push(`mom ${d.momTransition}`);
  if (d.passesUnderwater >= 2) bits.push(`${ordinal(d.passesUnderwater)} pass underwater`);
  if (d.bandTopTrend && d.bandTopTrend !== 'flat' && d.bandTopFrom != null)
    bits.push(`band-top ${d.bandTopTrend} ${fmtP(d.bandTopFrom)}→${fmtP(d.bandTopTo)}`);
  return bits.length ? bits.join(' · ') : null;
}

// --- V2 STRUCTURAL-SUPPORT line (OUTPUT-ONLY context) ---------------------------------------
// Recent daily lows → structural support + a cut-trigger below it, off the SAME 1h series the
// window line already uses (windowStats with a full-day window; no new fetch). Context on held
// rows; it drives NO verdict and raises NO alert (conviction gating is V4).
function dayLowsFrom(ts1h) {
  if (!ts1h || !ts1h.length) return [];
  const stats = windowStats(ts1h, { nights: SUPPORT_LOOKBACK_DAYS, wStart: 0, wEnd: 0 }); // wStart==wEnd ⇒ full day
  if (!stats) return [];
  return stats.days.map(([, n]) => n.low).filter(v => v != null); // oldest→newest complete-day lows
}
function supportLine(ts1h) {
  const support = structuralSupport(dayLowsFrom(ts1h));
  if (support == null) return null;
  return `support ${fmtP(support)} · cut-trigger ${fmtP(Math.round(cutTrigger(support)))} (context — not a verdict)`;
}

// --- V6 RECOVERY-READ (ADVISORY, OUTPUT-ONLY — recover-vs-drop forecast) ---------------------
// COMPOSES signals momVerdict already computed (diurnal seasonal · regime/phase trend · underwater
// persistence · position vs the V2 support level) into a LEAN via the pure lib/recovery.mjs. It is
// NEVER a verdict/alert input — it surfaces a forecast line for the human/LLM, and the cut-trigger
// (V2/V4) stays the mechanical backstop. No new fetch (reuses each item's already-fetched series).
// Support prefers the item's already-computed it._support (held rows); else derived from ts1h.
function recoveryReadFor(it) {
  const { row, be, ts5m, ts6h } = it;
  const regime = { label: row.regimeLabel, rising: row.rising, falling: row.falling };
  const diurnal = ts5m ? diurnalRead(ts5m) : null;
  const ph = ts6h ? phase(ts6h) : null;
  const uw = (ts5m && be != null) ? underwaterHours(ts5m, be) : null;
  const support = (it._support != null) ? it._support : structuralSupport(dayLowsFrom(it.ts1h));
  return recoveryRead({ diurnal, regime, phase: ph, underwater: uw, price: row.quickSell, support: support ?? null });
}


// --- ACTION line for a HELD lot. Sell-side framing is HONEST (clear-vs-hold), never
// "out-run the drop". List-at is break-even-floored. momVerdict() (chunk 6) runs FIRST so a
// 2h breakdown escalates before the lagging multi-day regime confirms.
// P0: the prose is now the SHARED renderer (renderHeldVerdict verbose) in pipeline/lib/item-context.mjs —
// the ONE home quote-items.mjs --positions renders from too, so the two surfaces can't disagree on a held
// verdict. Output is byte-identical to the pre-P0 inline heldAction() (same mv, same strings). The
// caller passes the ALREADY-computed mv (off lotCtxOf(it)) via a minimal ctx so nothing recomputes.
// VN-1: the caller also passes the persistence-gated display read (it._display) so the note's
// verdict line renders the SAME label as the table cell (RC4 — the two can never disagree).
function heldAction(row, be, lotValue, ts5m, mv, display = null) {
  return renderHeldVerdict({ market: { row }, intraday: { ts5m }, position: { be, lotValue, mv, display } }, { mode: 'verbose' });
}

// --- ACTION line for a WATCHED (not held) target. Buy-side, with the scalp entry gated.
function targetAction(row, cls, be) {
  if (cls === 'FALLING') return `SKIP — falling / breaking down; don't buy into a drop.`;
  if (row.quickBuy == null) return `NO QUOTE — skip.`;
  if (cls === 'LIQUID_RANGING_WIDE') {
    const exit = row.optSell != null ? fmtP(row.optSell) : 'the band top';
    return `SCALP-BUY @ ${fmtP(row.optBuy)} (band low); set the EXIT AT ENTRY → sell @ ${exit}. Don't leave a stranded ask if the band shifts.`;
  }
  const lowBid = row.optBuy != null && row.optBuy < row.quickBuy;
  const asel = lowBid ? ` (adverse-selection: a fill at ${fmtP(row.optBuy)} likely means it dropped to you — confirm exit margin)` : '';
  return `BUY @ ${fmtP(row.quickBuy)} now / ${fmtP(row.optBuy)} patient${asel}. Set the exit ≥ break-even ${fmtP(be)} at entry.`;
}

// --- ACTION line for an ACTIVE BID (resting buy offer). The hazard case is a fill you no
// longer want: a bid filling into a breakdown/falling market IS adverse selection — the market
// dropped to meet you. Everything else is placement feedback (behind the band / inside / crossing).
function bidAction(row, off, pathCtx) {
  const filled = `${off.qty}/${fmt(off.max)} filled`;
  // decision via the SHARED offerVerdict (js/quotecore.js) so the console and the app Watch tab
  // can never disagree on a bid's state; the strings below are watch-positions.mjs's own (byte-identical).
  // P5: pathCtx (a declared scalp/value-hold thesis, or null) makes CANCEL-BID PATH-AWARE — a
  // deliberate thesis expects a soft tape, so falling alone no longer cancels its bid.
  switch (offerVerdict(row, off.offer, pathCtx)) {
    case 'CANCEL-BID':
      return `CANCEL-BID — ${pathCtx ? `${(typeof pathCtx==='object'?pathCtx.path:pathCtx)} tripwire hit (${row.mom==='breakdown'?'2h breakdown':'floor break'})` : row.falling ? `falling regime (${row.regimeLabel})` : '2h breakdown'}; a fill at ${fmtP(off.offer)} means the market dropped to meet you. Cancel unless you are deliberately pricing the fall.`;
    case 'NO-QUOTE':
      return `NO QUOTE — can't judge the bid; leave it and re-check at a liquid window.`;
    case 'CROSSING':
      return `CROSSING (${filled}) — bid ${fmtP(off.offer)} ≥ live instasell ${fmtP(row.quickBuy)}; expect fills about now. Have the exit priced before they land.`;
    case 'BID-BEHIND':
      return `BID-BEHIND (${filled}) — bid ${fmtP(off.offer)} is below the 2h band low ${fmtP(row.optBuy)}${row.mom === 'breakup' ? ', and mom ↑ is moving the market further away' : ''}; unlikely to fill soon. Nudge up only while the exit still clears break-even; never chase past the edge.`;
    default:
      return `BID-OK (${filled}) — resting inside the band (${fmtP(row.optBuy)} band low · ${fmtP(row.quickBuy)} live)${row.mom === 'breakup' ? '; note mom ↑ — fills get less likely as it runs' : ''}. Patience is the plan.`;
  }
}

// A bid is an ALERT only in the adverse-selection case (breakdown/falling) — the one state
// where a RESTING order needs action. Placement feedback never alerts.
function bidAlert(it) {
  const { row, name, bid } = it;
  // P5: path-aware — a bid declared under a scalp/value-hold thesis only CANCEL-BIDs on its OWN
  // tripwire (scalp: a live 2h breakdown; value-hold: a floor break), never on the falling regime alone.
  if (offerVerdict(row, bid.offer, it._bidPathCtx) === 'CANCEL-BID')
    return { level: 'CANCEL-BID', msg: `CANCEL-BID ${name} @ ${fmtP(bid.offer)} — ${it._bidPathCtx ? `${(typeof it._bidPathCtx==='object'?it._bidPathCtx.path:it._bidPathCtx)} tripwire hit` : row.falling ? `falling regime (${row.regimeLabel})` : '2h breakdown'}; a fill here is adverse selection. Cancel unless you want the falling price.` };
  return null;
}

// --- DL2 FLUSH alert: a REACTIVE liquid-flush bid-into-the-fall carve-out. Deliberately NOT routed
// through classify()/targetAction — those emit "FALLING → SKIP", correct for a multi-day faller but
// WRONG for a fresh liquid flush (the whole point of DL2). It reads flushSignal (js/quotecore.js) on the
// buy-side row; when flush:true it returns a headline alert telling Ben to bid INTO the fall + list at
// the band top (break-even-floored), buy-limit aware. It ALERTS, never places (the read-only guardrail
// stands). `buys` is the per-item logged-buy list (fills.json via buysByItem, or [] when unavailable) so
// the 4h window can gate the bid clause; a missing/null limit degrades to the normal bid clause.
function flushAlert(it, sig, buysByItemMap) {
  const { row, name } = it;
  if (!sig || !sig.flush) return null;
  const bondOpts = row.bond ? { bond: true, guide: row.guide } : undefined;
  const be = breakEven(row.quickBuy, bondOpts);
  const listAt = row.optSell != null ? Math.max(row.optSell, be) : be;   // list at the band top, NEVER below break-even
  // BUY-LIMIT clause: if the 4h window is exhausted, the bid-into-the-fall clause is replaced by a
  // "buy limit exhausted — frees ~HH:MM" note. A null limit / no buys degrades to the normal bid clause.
  const limit = row.limit ?? null;
  const buys = (buysByItemMap && buysByItemMap.get(it.id)) || [];
  let actionClause = `bid-into-the-fall @ ${fmtP(row.quickBuy)} now`;
  try {
    const lw = limitWindow({ buys, limit });
    if (limit != null && lw.remaining === 0) {
      const free = lw.nextFreeAt != null ? new Date(lw.nextFreeAt * 1000) : null;
      const hhmm = free ? `${String(free.getHours()).padStart(2, '0')}:${String(free.getMinutes()).padStart(2, '0')}` : '?';
      actionClause = `buy limit exhausted — frees ~${hhmm}`;
    }
  } catch { /* limit read is best-effort — never suppress the flush alert */ }
  const depthTxt = (sig.depthPct * 100).toFixed(1) + '%';
  return { level: 'FLUSH', dipScore: sig.dipScore, sig,
    msg: `FLUSH — ${name} dumping (${depthTxt} below 24h floor, ${fmt(sig.bucketVol)} units this bucket) · ${actionClause} · list @ ${fmtP(listAt)} (BE ${fmtP(be)}) · window closing — reverts fast.` };
}

async function buildItem({ id, name, qty, avgCost, buyTs }, map, guide) {
  const inp = await fetchItemInputs(id, { ts1h: true }); // ts1h feeds the window-context line
  // PLAN-VOL24: correct vol24 from the in-hand 1h series (rolling24, zero new fetch) — the /24h per-item
  // endpoint is broken (frozen stale ~1–3h slice); degrades to the /24h read when the series is too short.
  // Reassigned so Vol/d + pressure + the avgLow24 dip reference all read the corrected value; computeQuote untouched.
  const _cv = vol24FromInputs(inp); inp.vol24 = _cv.vol24;
  const held = qty != null;
  const row = computeQuote({ ...inp, guide: guide[id] ?? null, limit: map.byId[id]?.limit ?? null, held, asked: true });
  const cls = classify(row);
  const meta = CLASSES[cls];
  const be = held ? breakEven(avgCost) : (row.quickBuy != null ? breakEven(row.quickBuy) : null);
  const lotValue = held ? qty * avgCost : null;
  // V3 lot-context: buyTs (oldest lot's buy time, unix s) enables the entry-age softening;
  // askFilling is set later in main() once the live asks are known (needs both this row + asks).
  return { id, name, qty, avgCost, buyTs: buyTs ?? null, held, row, cls, meta, be, lotValue, ts5m: inp.ts5m, ts6h: inp.ts6h, ts1h: inp.ts1h, askFilling: false,
    // DL2 — the 24h avg low (the flush DEPTH reference); the row doesn't carry it (DP1 confirmed), so stash it here.
    _avgLow24: inp.vol24?.avgLowPrice ?? null };
}

// V3 lot-context for momVerdict's Gate-D softening — { buyTs, askFilling } off a built held item.
// Pure read; every held momVerdict call routes through this so the app/console share one lotCtx.
const lotCtxOf = it => ({ buyTs: it.buyTs, askFilling: it.askFilling });

// A held item is an ALERT if the shared cut-trigger says CUT/CLEAR, or it's underwater
// (instabuy < break-even), or its multi-day regime is falling. Reuses momVerdict — no
// separate escalation logic. V4: the Gate-D clean-momentum CUT-CANDIDATE and a structural break
// are ARM-THEN-CONFIRM (they become a headline alert only once convictionGate — computed in main
// and stored on `it.gate` — says escalate; until then they are visible armed NOTES, not headlines).
// The Gate-2 breakdown CUT is EXEMPT: immediate on pass 1, byte-identically as before (the invariant).
function heldAlert(it) {
  const { row, be, lotValue, ts5m, name, gate } = it;
  const instabuy = row.quickSell;
  const mv = momVerdict(row, be, lotValue, ts5m, undefined, lotCtxOf(it));
  if (mv) {
    if (mv.action === 'CUT') {
      if (mv.gate === 2)
        // Gate-2 breakdown CUT — EXEMPT from conviction gating: escalate immediately (the invariant).
        return { level: mv.verdict, msg: `${mv.verdict} ${name} @ ${fmtP(mv.listAt)} — 2h breakdown & underwater; free the capital.` };
      // Gate-D CUT-CANDIDATE — headline only once conviction confirms (2 consecutive underwater
      // passes). Until then it's armed: fall through so no headline fires (the armed note is emitted
      // in the table loop). If it just escalated, alert with the confirmation count.
      if (gate && gate.escalate && gate.reason === 'cut-candidate') {
        const um = Math.max(0, Math.round(((it._deltas && it._deltas.underwaterMs) || 0) / 60000));
        return { level: mv.verdict, msg: `${mv.verdict} ${name} @ ${fmtP(mv.listAt)} — underwater through a liquid window, sustained ~${um}m; free the capital.` };
      }
      // armed Gate-D (or masked by a structural escalation handled just below) — no headline here.
    } else {
      // LIST-TO-CLEAR — V7 arm-then-confirm on TIME: headline only once the 2h breakdown has PERSISTED
      // (gate.reason==='clear'). A single-pass momentum flicker only arms (no headline) — fall through
      // (the armed note is emitted in the table loop; a genuine structural break below still fires).
      if (mv.action === 'CLEAR' && gate && gate.escalate && gate.reason === 'clear')
        return { level: 'CLEAR', msg: `LIST-TO-CLEAR ${name} @ ${fmtP(mv.listAt)} — 2h breakdown held; bank it, don't hold for the premium.` };
      if (mv.action === 'CLEAR') { /* armed flicker or structural — no CLEAR headline; fall through */ }
      if (mv.action === 'NO_READ') {
        // VN-1 (RC3): a NO-READ against an established display incumbent is a feed artifact, not
        // news — demoted to the "(read unreliable this pass)" note on the label; no headline.
        if (it._display && it._display.unreliableThisPass) return null;
        return { level: 'NO-READ', msg: `NO-READ ${name} (${row.reliableReason}) — can't price a decision off this quote. Keep any ask ≥ break-even ${fmtP(be)}; re-check at a liquid window.` };
      }
      if (mv.action === 'DIURNAL_WATCH')
        return { level: 'DIURNAL', msg: `DIURNAL-WATCH ${name} — underwater at a quiet hour that recovered yesterday. Hold ≥ break-even ${fmtP(be)}; don't cut into the trough.` };
      if (mv.action === 'SHOCK_WATCH')
        return { level: 'SHOCK', msg: `SHOCK-WATCH ${name} @ ${fmtP(mv.listAt)} — one-off shock, not a bleed; hold one more cycle.` };
    }
  }
  // Structural-break escalation (V4) — a CONVINCING break of the V2 tripwire (≥δ below support, or
  // 2 consecutive passes below support). Independent of the mom verdict; not gated by underwater.
  // R9 (PLAN-VIZ-LAYER VZ2a, Ben ruling 2026-07-16): convictionGate (raw price vs. support/cut-trigger)
  // and heldDisplay/momVerdict (the full persistence-gated judgment) are TWO SEPARATE state machines
  // that can genuinely disagree — this branch used to hardcode the headline word to CUT regardless of
  // what the table verdict said, which is exactly the mismatch bug watched live repeatedly (Water orb,
  // 2026-07-16). Fix: heldDisplay stays authoritative for the verdict WORD (never overridden here); the
  // structural break is real and must still surface, as an appended warning clause, not a contradicting
  // verdict. `it._display` is set earlier this same pass (before `held.map(heldAlert)` runs), so the
  // fallback to the raw mv token only matters if display computation itself failed.
  if (gate && gate.escalate && gate.reason === 'structural') {
    const label = (it._display && it._display.label) || (mv && mv.verdict) || 'WATCH';
    return { level: label, msg: `${label} ${name} @ ${fmtP(instabuy)} — ⚠ also broke structural support ${fmtP(it._support)} (cut-trigger ${fmtP(Math.round(it._cutTrigger))}); verdict unchanged, watch closely.` };
  }
  // An ARMED Gate-D candidate must NOT fall through to the immediate UNDERWATER alert — that would
  // defeat arm-then-confirm (an armed CUT-CANDIDATE is by definition underwater). A structural-armed
  // graze is purely additive and does NOT suppress the softer underwater/falling signals.
  // TG1: a thesis-armed lot is expected-underwater above its declared tripwire — same suppression as
  // the Gate-D armed case (else it would fall straight to the plain UNDERWATER headline TG1 silences).
  if (gate && gate.armed && (gate.reason === 'cut-candidate-armed' || gate.reason === 'thesis-armed')) return null;
  // VN-3 (F2): inside the break-even dead-band the HOLD↔UNDERWATER flip is noise — the display
  // reads PARKED and the ungated UNDERWATER headline is suppressed (falling-regime alert unchanged:
  // PARKED requires a non-falling row, so a falling lot never reaches this suppression).
  if (it._display && it._display.parked) return null;
  if (instabuy != null && be != null && instabuy < be)
    return { level: 'UNDERWATER', msg: `UNDERWATER ${name} — live sell ${fmtP(instabuy)} < break-even ${fmtP(be)}. Hold ≥ break-even only if regime is flat/rising; cut if it turns.` };
  if (row.falling)
    return { level: 'FALLING', msg: `FALLING ${name} — multi-day regime ${row.regimeLabel} ${row.regime.driftPct.toFixed(0)}%. Price to clear at the instabuy ${fmtP(instabuy)}; don't defend the ask down.` };
  return null;
}

// VZ1 (PLAN-VIZ-LAYER) — assemble the watch output pass into ONE plain report object (R4), rendered by
// render.mjs's renderReport. PURE: it takes ALREADY-computed, already-formatted pieces (the facts are
// in hand in main(); the capital/derived-cash math + fs stays there) and only decides section ORDER +
// the blank-line contract, so it is testable off fixtures with no live fetch. Byte-identical to the
// pre-VZ1 console.log sequence (pinned by pipeline/test/render.test.mjs). The alert items keep the
// pre-VZ1 {level, msg} shape here (VZ2a restructures them to render the verdict word from the shared
// display state); the table goes through mdTable via render.mjs (was a hand-built string at :1018);
// the local quoteCells cell format is UNCHANGED (VZ2b adopts the canonical composite cells).
export function buildWatchReport({
  generatedAt, headline, alerts = [], pressureExitWarning = null,
  freedLine = null, blindLine = null,
  brief = false, briefLines = [],
  tableHeaders = null, tableRows = [], notes = [],
  summaryLines = [],
} = {}) {
  const sections = [{ type: 'headline', text: headline }];
  const pre = pressureExitWarning ? [pressureExitWarning] : [];
  const post = [];
  if (freedLine) post.push(freedLine);
  if (blindLine) post.push(blindLine);
  sections.push({ type: 'alerts', pre, items: alerts, post });
  if (brief) {
    sections.push({ type: 'lines', lines: briefLines, blank: true });
  } else {
    sections.push({ type: 'table', headers: tableHeaders, rows: tableRows });
    if (notes.length) sections.push({ type: 'notes', items: notes });
  }
  sections.push({ type: 'lines', lines: summaryLines, blank: true });
  return { kind: 'watch', generatedAt, sections };
}

async function main() {
  const args = process.argv.slice(2);
  const TARGETS_ONLY = args.includes('--targets-only');
  const BRIEF = args.includes('--brief');   // compact one-line-per-item book (stable, script-owned format)
  const DIP = args.includes('--dip');       // DL2 — also watch dip-watchlist.json for LIQUID flushes (bid-into-the-fall)
  // PB4 (PLAN-DEPTH-EXIT / PLAN-REACHABILITY-CONSOLIDATION) — the pressure-exit TRIAL flag (opt-in, owner
  // early-adopt). When set, a held lot's list-at is the pressure-driven reachableBand ask (still BE-floored
  // + clamped; declared exit still wins); the depth floor + reachable clause still renders beside it. The
  // retro co-log stays on the NEUTRAL estimate (unbiased). Console-only; no screen.json/app path here.
  // PC1: routed through the shared flag>config>default resolver (the OPTIONAL pipeline-config.json can
  // set the same default). Absent config ⇒ byte-identical to the old `args.includes('--pressure-exit')`.
  const PRESSURE_EXIT = resolve('pressureExit', { flag: args.includes('--pressure-exit') ? true : undefined, config: loadPipelineConfig().pressureExit, fallback: false }).active;
  // AO1 (default flipped post-review — see quote-items.mjs header for why): --verbose opts INTO the
  // markdown stdout; the report object is ALWAYS written to the last-report dump either way, and quiet
  // (the default) is what forces the JSON dump to be the actual read rather than an optional extra.
  const VERBOSE = args.includes('--verbose');
  const realLog = console.log;
  if (!VERBOSE) console.log = () => {};
  const tokens = args.filter(a => !a.startsWith('--'));

  // ALWAYS sync first (Ben, 2026-07-16 — this was opt-in behind --sync, and "run sync-fills before
  // every read" stayed a doctrine an agent could just forget; a real position (anglerfish) closed
  // unnoticed as a result — see the anchor incident in CHANGELOG). Runs sync-fills.mjs as a child;
  // NEVER blocks the watch pass on failure (a network/git hiccup must not stop monitoring). The bare
  // (no --publish) call is LOCAL/ZERO-GIT by default since 2026-07-15 (FILLS-PIPELINE §12) — no
  // commit/push here, so there's no reason this should ever have been opt-in. Quiet: only the sync's
  // summary line is surfaced. `--sync` is kept as a harmless no-op alias for any external caller.
  {
    try {
      const out = execFileSync(process.execPath, [path.join(HERE, 'sync-fills.mjs')],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const summary = out.trim().split('\n').filter(l => /^positions:|^Pushed|nothing to/.test(l));
      if (summary.length) console.log('sync · ' + summary.join(' · ') + '\n');
    } catch (e) { console.log('sync · ⚠ skipped (' + (e.message || 'failed').split('\n')[0] + ') — watching off the current book\n'); }
  }

  const map = await loadMapping();
  const guide = await loadGuide();

  // P0: passive Tier-1 accrual — one loadSnapshot() per pass appends the current complete bulk /5m
  // and /1h buckets to the SQLite archive (check-before-fetch, so a fast loop re-entering the same 5m
  // window does zero extra network). watch-positions.mjs + quote-items.mjs are loadSnapshot's first consumers; the
  // running loop is how P6's broad intraday history accrues. budgetIds:[] → NO per-item fan-out: the
  // per-item reads below keep their exact live fetch semantics (fetchItemInputs). Guarded so an
  // archive/sqlite failure can never break a watch pass.
  try { const snap = await loadSnapshot({ budgetIds: [] }); snap.archive.close(); } catch { /* archive accrual is best-effort — never block a pass */ }

  // held items from positions.json (grouped at weighted-avg cost) unless --targets-only
  const heldSpecs = [];
  let posAge = null;
  if (!TARGETS_ONLY) {
    const { groups, ageMin, err } = readOpenPositions(POSITIONS);
    if (err) { console.error('cannot read positions.json: ' + err); }
    else {
      posAge = ageMin;
      for (const { itemId, qty, avgCost, buyTs } of groups)
        heldSpecs.push({ id: itemId, name: map.byId[itemId]?.name || ('#' + itemId), qty, avgCost, buyTs });
    }
  }

  // active offers from the live exchange log (the other half of the position set).
  // Degrades gracefully: no log dir (other machine) → note it and watch held lots only.
  let asks = [], bids = [], noise = [], offersInfo = null;
  let suspectAsks = [], suspectBids = [];   // LH2.4: restart-blindness wipes — never merged into asks/bids
  if (!TARGETS_ONLY) {
    try {
      const { rows, staleMin } = readExchangeLog();
      offersInfo = { staleMin };
      const ignoreCfgLocal = loadIgnored(path.join(HERE, '..', '..'));
      for (const o of activeOffers(rows, ignoreCfgLocal)) {   // quarantine farm/loot offers (ignored-items.json)
        if (o.max * o.offer < NOISE_OFFER_GP) { noise.push(o); continue; }
        (o.state === 'BUYING' ? bids : asks).push(o);
      }
      // LH2.4: a held lot's ask/bid that vanished in a mass log reset (not a real cancel) reads as
      // "NOT LISTED" below otherwise — a false exit-discipline nudge to relist a lot that's still
      // resting in-game. Kept in SEPARATE arrays, never folded into asks/bids (those stay "confirmed").
      for (const o of restartBlindSuspects(rows, ignoreCfgLocal)) (o.state === 'BUYING' ? suspectBids : suspectAsks).push(o);
    } catch (e) { offersInfo = { err: (e && e.message) || String(e) }; }
  }

  // target items from CLI (buy-side watch)
  const targetSpecs = [];
  for (const t of tokens) {
    const hit = map.resolve(t);
    if (!hit) { console.error(`! no item named "${t}" — skipping`); continue; }
    if (heldSpecs.some(h => h.id === hit.id)) continue; // already covered as a held lot
    targetSpecs.push({ id: hit.id, name: hit.name });
  }
  // DL2 --dip: fold the tracked dip-watchlist.json pool into the buy-side target set (deduped against
  // held lots + CLI tokens). Best-effort: a missing/garbled file degrades to no dip pool.
  // DL4 (2026-07-11): the schema evolved and screen-fed AUTO-POPULATION now landed (screen-flip-niches.mjs's
  // nomination pass appends flush-SUITABLE candidates). The reader is POLYMORPHIC — an entry is either
  // a LEGACY plain item name / numeric id (mirrors watchlist.json's simple shape) OR a NEW object
  // { id, name, source:'auto'|'manual', track:'liquid'|'illiquid', addedTs }. A mixed array works; we
  // resolve an object by id ?? name (prefer id, the stable key).
  if (DIP) {
    let pool = [];
    try { const raw = JSON.parse(fs.readFileSync(DIP_WATCHLIST, 'utf8')); if (Array.isArray(raw)) pool = raw; }
    catch { /* no dip pool — degrade */ }
    for (const entry of pool) {
      // DL4 (2026-07-12): only the LIQUID track is watched live — it's the FLUSH-alert set, and each target
      // is a live fetch every ~5m pass, so the illiquid track (DL3's standing-bid backlog, not yet consumed
      // for alerts) is skipped here to keep the loop's per-pass cost bounded. A legacy entry has no track →
      // watched (back-compat: hand-curated entries were always liquid flush candidates).
      if (entry && typeof entry === 'object' && entry.track === 'illiquid') continue;
      const token = (entry && typeof entry === 'object') ? (entry.id ?? entry.name) : entry;
      const hit = map.resolve(String(token));
      if (!hit) { console.error(`! dip-watchlist: no item named "${token}" — skipping`); continue; }
      if (heldSpecs.some(h => h.id === hit.id)) continue;      // covered as a held lot
      if (targetSpecs.some(t => t.id === hit.id)) continue;    // already a CLI target
      targetSpecs.push({ id: hit.id, name: hit.name });
    }
  }

  // bid items get a market read of their own (skip ones already held/targeted — those rows cover it)
  const bidSpecs = [];
  for (const b of bids) {
    if (heldSpecs.some(h => h.id === b.item) || targetSpecs.some(t => t.id === b.item)) continue;
    if (bidSpecs.some(s => s.id === b.item)) { bidSpecs.find(s => s.id === b.item).offers.push(b); continue; }
    bidSpecs.push({ id: b.item, name: map.byId[b.item]?.name || ('#' + b.item), offers: [b] });
  }

  if (!heldSpecs.length && !targetSpecs.length && !bidSpecs.length && !asks.length) {
    console.log('Nothing to watch — no open positions, no active GE offers, and no target items passed.');
    if (noise.length) console.log(`(noise ignored: ${noise.length} offer(s) under ${fmtP(NOISE_OFFER_GP)} total)`);
    return;
  }

  const held = [];
  for (const s of heldSpecs) held.push(await buildItem(s, map, guide));
  // V3 askFilling: the held lot's own ask is actively transacting ABOVE the clear price. Simple,
  // honest heuristic (no cross-pass state) — an active SELLING offer on the item with filled units
  // (qty>0) priced above the live instabuy (row.quickSell). Feeds momVerdict's Gate-D fill-progress
  // softening: an ask filling above the clear beats repricing down.
  for (const it of held) {
    const ask = asks.find(a => a.item === it.id);
    it.askFilling = !!(ask && ask.qty > 0 && it.row.quickSell != null && ask.offer > it.row.quickSell);
  }

  // V1/V4 cross-pass memory + CONVICTION GATING — computed HERE (before the headline) so each held
  // item carries its arm-then-confirm decision (it.gate) into both the alert list and the notes.
  // Load the prior pass's state (loadState degrades to {} on any failure — a state read must never
  // break a pass), compute per-held deltas + the escalation decision, rebuild state fresh from THIS
  // pass (so vanished positions drop out), and save at pass end. now = ms; guarded per item.
  const nowMs = Date.now();
  const priorState = loadState(WATCH_STATE);
  const thesisStore = pruneThesis(loadThesis(THESIS_PATH));   // YT1 (#4) read-only: the agent's recorded intent per lane
  const holdThesisStore = pruneHoldThesis(loadHoldThesis(HOLD_THESIS_PATH));   // TG1 read-only: agent-declared hold plans (gate the expected-underwater headline)
  const guideHist = loadGuideHistory(GUIDE_HISTORY);          // YP1 (#2) advisory: guide re-anchor history (gated → silent until it accrues)
  const newState = {};
  for (const it of held) {
    it.gate = { escalate: false, armed: false, reason: null };
    it._deltas = null; it._support = null; it._cutTrigger = null; it._thesis = null; it._pathCtx = null; it._display = null;
    it._depthExit = null; it._reachable = null; it._estShadow = null; it._asymShadow = null; it._estPressure = null;
    // DE3 (PLAN-DEPTH-EXIT): the held lot's WHOLE-DAY depth floor (clearableAsk — what this qty can
    // book at, the plan's v1 whole-day decision) + pressure-driven reachable band (reachableBand),
    // both off the ALREADY-fetched ts1h (zero new fetch). Inform-only: they feed the window-line
    // clause + the suggestions.jsonl shadow fields, never a verdict/alert/price. Guarded separately
    // from the gating try so a depth failure can't cost the conviction read (and vice versa).
    // RC-S1 (PLAN-REACHABILITY-CONSOLIDATION): the same block ALSO computes the two OLDER reachability
    // estimators — the reachRelief-family estSell (estimatePair) and the fixed-quantile asym pair —
    // so all FIVE competing exit estimators co-log on THIS row (the head-to-head accrual surface). The
    // shadow est deliberately passes declaredExit:null so the scored number is the MODEL's intrinsic
    // ask (reachRelief's prediction), not the operator's declared plan; the declared exit is logged
    // separately via the thesis. Zero new fetch (reuses ts1h/ts5m). Inform-only — nothing rendered.
    try {
      const dayStats = windowStats(it.ts1h, { nights: 14, wStart: 0, wEnd: 0 });
      it._depthExit = clearableAsk(it.ts1h, { qty: it.qty, wStart: 0, wEnd: 0, nights: 14 });
      it._reachable = dayStats ? reachableBand(dayStats) : null;
      if (dayStats) {
        const ap = asymPair(dayStats);
        const askRc = it.row.optSell != null ? recencySplit(dayStats.days, 'ask', it.row.optSell) : null;
        const bidRc = it.row.optBuy != null ? recencySplit(dayStats.days, 'bid', it.row.optBuy) : null;
        const askReach = (dayStats.his.length && it.row.optSell != null)
          ? { reachedDays: reachedDays(dayStats.his, it.row.optSell), nDays: dayStats.his.length, recentHit: askRc?.recentHit, recentDays: askRc?.recentDays } : null;
        const bidReach = (dayStats.lows.length && it.row.optBuy != null)
          ? { reachedDays: touchedDays(dayStats.lows, it.row.optBuy), nDays: dayStats.lows.length, recentHit: bidRc?.recentHit, recentDays: bidRc?.recentDays } : null;
        const prof = hourProfile(it.ts1h, { nights: 14 });
        const dr = prof ? deriveDiurnalRange(prof, { liveLo: it.row.quickBuy ?? null, liveHi: it.row.quickSell ?? null }) : null;
        const estBase = {
          bidReach, askReach,
          diurnal: dr ? { bid: dr.bid, ask: dr.ask } : null,
          asym: ap, dayHigh: dayHighFrom5m(it.ts5m),
          intendedUnits: it.qty, reachable: it._reachable,   // reachable ignored unless pressureExit is on
        };
        // NEUTRAL shadow (declaredExit:null → the model's intrinsic ask) — the retro co-log scores this.
        it._estShadow = estimatePair(FLIP_NICHES.band, it.row, { ...estBase, declaredExit: null });
        // PB4: the DISPLAY pressure est (only when the trial flag is on) — declared exit still wins the
        // sell leg (operator plan), so it passes the REAL declared exit; drives the held list-at below.
        if (PRESSURE_EXIT)
          it._estPressure = estimatePair(FLIP_NICHES.band, it.row, { ...estBase, declaredExit: thesisFor(holdThesisStore, it.id)?.exitPrice ?? null }, { pressureExit: true });
        it._asymShadow = ap ? asymEstimate(FLIP_NICHES.band, it.row, ap) : null;
      }
    } catch { /* inform-only — never block a pass */ }
    try {
      const key = 'held:' + it.id;
      const support = structuralSupport(dayLowsFrom(it.ts1h));
      const trig = support != null ? cutTrigger(support) : null;
      // PB-COPILOT-1: the resting ask price feeds the margin-reduction-budget tracker (advanceState) —
      // a restart-blind suspect ask counts too (it's still the price you're chasing down from).
      const restingAsk = (asks.find(a => a.item === it.id) || suspectAsks.find(a => a.item === it.id) || {}).offer ?? null;
      const cur = { identity: `hld:${it.qty}:${Math.round(it.avgCost)}`,
        instabuy: it.row.quickSell, mom: it.row.mom, bandTop: it.row.rawBandHi, breakEven: it.be, support, restingAsk };
      const d = computeDeltas(priorState[key], cur, nowMs);
      newState[key] = advanceState(priorState[key], cur, nowMs);
      it._deltas = d; it._support = support; it._cutTrigger = trig;
      it._thesis = thesisFor(holdThesisStore, it.id);   // TG1: the agent-declared hold plan for this lot (or null)
      const mv = momVerdict(it.row, it.be, it.lotValue, it.ts5m, undefined, lotCtxOf(it));
      it.gate = convictionGate({
        verdict: mv && mv.verdict, gate: mv && mv.gate,
        price: it.row.quickSell, support, cutTrigger: trig,
        // V7: TIME-based arm-then-confirm — elapsed persistence, not pass count (cadence-independent).
        underwaterMs: d.underwaterMs, belowSupportMs: d.belowSupportMs, breakdownMs: d.breakdownMs,
        // TG1: the declared-hold-thesis silence (expected-underwater not news above the tripwire).
        thesis: it._thesis, underwater: d.underwater,
      });
      // VN-1: the persistence-gated DISPLAY read (shared heldDisplay, lib/item-context.mjs) — what the
      // table/brief/note render; the raw verdict stays what the ledger logs. Fields ride
      // newState[key] ADDITIVELY (this loop stays the ONE writer of the state file).
      // VN-2: the declared thesis activates the render frame; when the plan declares no exitPrice,
      // the diurnal ASK off the already-in-hand 1h series is the fallback exit (zero extra fetch).
      let diurnalAsk = null;
      if (it._thesis && it._thesis.tripwire != null && it._thesis.exitPrice == null) {
        try {
          const prof = hourProfile(it.ts1h, { nights: 7 });
          const dr = prof ? deriveDiurnalRange(prof, { liveLo: it.row.quickBuy ?? null, liveHi: it.row.quickSell ?? null }) : null;
          diurnalAsk = dr && dr.ask != null ? dr.ask : null;
        } catch { /* fallback only — the frame degrades to "exit per plan" */ }
      }
      it._display = heldDisplay({ row: it.row, be: it.be, mv,
        prior: (d.firstSeen || d.reset) ? null : priorState[key], nowMs,
        thesis: it._thesis, diurnalAsk });
      newState[key].displayVerdict = it._display.state.displayVerdict;
      newState[key].verdictArmedKey = it._display.state.verdictArmedKey;
      newState[key].verdictArmedSince = it._display.state.verdictArmedSince;
      // V2-P4b: weigh the lot's thesis-paths + persistence-gate dominance flips (arm-then-confirm +
      // hysteresis, pathPersistence via pathsStage) against the prior state entry. pathsStage folds
      // currentPath/pathArmedKey/pathArmedSince/enteredUnder ADDITIVELY into newState[key] — this
      // loop stays the ONE writer of the state file. Decision SUPPORT only: it renders a note line
      // (renderPathLine) and raises NO alert (path-aware CANCEL-BID semantics are P5, not here).
      it._pathCtx = pathsStage({
        market: { row: it.row },
        history: { phase: it.ts6h ? phase(it.ts6h) : null, termStructure: null },
        position: { held: true, be: it.be, deltas: d, thesis: it._thesis, newStateEntry: newState[key] },
      }, { watchStatePrior: priorState[key], nowMs, fresh: d.firstSeen || d.reset });
    } catch { /* gating/state are observability-adjacent — degrade to no-escalation, never break a pass */ }
  }

  const targets = [];
  for (const s of targetSpecs) targets.push(await buildItem(s, map, guide));
  const bidItems = [];
  for (const s of bidSpecs) {
    const it = await buildItem({ id: s.id, name: s.name }, map, guide);
    it.bid = s.offers[0]; it.bids = s.offers; // primary + all (multi-slot same-item bids)
    // P5: the DECLARED thesis for this bid (declare-thesis.mjs set --path), read-only. When present, its path
    // key + floor tripwire make the shared offerVerdict PATH-AWARE — a scalp/value-hold bid no longer
    // CANCEL-BIDs off the falling regime alone (Ben's 2026-07-08 amendment). null when undeclared.
    const th = thesisFor(holdThesisStore, s.id);
    it._bidPathCtx = (th && th.path) ? { path: th.path, tripwire: th.tripwire ?? null } : null;
    bidItems.push(it);
  }

  const all = [...held, ...targets, ...bidItems];
  logGuideChanges(all, guide); // pin guide-update timing/magnitude for watched items
  const loopMin = Math.min(...all.map(it => it.meta.cadence));

  // DL2 — flushSignal per buy-side target, computed ONCE (pure) as the single source for BOTH the FLUSH
  // ledger rows below and the FLUSH alert pass. LOGGING is DECOUPLED FROM ALERTING (2026-07-11): the map
  // holds every target with a genuine flush SIGNAL (deep + falling; gates ii+iii) — liquid OR NOT — so the
  // illiquid signal-only rows are logged too (their depth/frequency history is the standing-bid evidence
  // basis / DL3's input). Only the LIQUID + exit-clearing subset (sig.flush) produces a headline alert.
  const sigByTarget = new Map();
  for (const it of targets) {
    try { const sig = flushSignal(it.row, it.ts5m, it._avgLow24, {}); if (sig && sig.signal) sigByTarget.set(it.id, sig); }
    catch { /* flush detection is additive — never break a pass */ }
  }
  // DL2 — the durable FLUSH record (Ben's hard condition on the placeholders): every SIGNAL logs ALL
  // components so the DL2 retro-join (analyze.mjs §4) can join it against fills.json and, over enough
  // history, surface a re-fit CANDIDATE to F1 (analyze never mutates a constant). `alerted` = the row also
  // passed the fillability + exit gates → headline FLUSH; `gatedReason` names WHY a signal-only row was
  // held back ('liquid-floor' = volDay < DIP_LOOP_LIQUID_FLOOR · 'exit-not-clear' = liquid but the after-tax
  // exit didn't clear). Alerted rows carry gatedReason:null.
  const dipLoopOf = (it, sig) => ({ volDay: it.row.volDay, price: it.row.quickBuy, limit: it.row.limit ?? null,
    depthPct: sig.depthPct, bucketVol: sig.bucketVol, quickBuy: it.row.quickBuy, optSell: it.row.optSell,
    afterTaxMargin: sig.afterTaxMargin, dipScore: sig.dipScore,
    alerted: !!sig.flush, gatedReason: sig.flush ? null : (!sig.liquid ? 'liquid-floor' : 'exit-not-clear') });

  // O1 suggestions ledger: log every held/target read at emit time, unconditionally. `class` is
  // watch's richer classify() taxonomy label; verdict is the concise action token for the read.
  const heldVerdict = it =>   // the RAW token (rawHeldToken, shared home — byte-identical to the old inline chain); the ledger logs this, the display layer gates what renders
    rawHeldToken(it.row, it.be, momVerdict(it.row, it.be, it.lotValue, it.ts5m, undefined, lotCtxOf(it)));
  const targetVerdict = it => it.cls === 'FALLING' ? 'SKIP'
    : it.row.quickBuy == null ? 'NO-QUOTE'
    : it.cls === 'LIQUID_RANGING_WIDE' ? 'SCALP-BUY' : 'BUY';
  const bidVerdict = it => offerVerdict(it.row, it.bid.offer, it._bidPathCtx);   // SHARED with the app Watch tab (js/quotecore.js); P5 path-aware
  const wPosture = isOvernightNow() ? 'overnight' : 'active';   // YS2: the posture this live read was made under
  // DE3 (PLAN-DEPTH-EXIT) — lean shadow objects for the F1 retro-join (the estConfLean absent-field
  // pattern: present only when a read was computed; normal rows byte-identical). depthExit ALWAYS
  // carries either the booked ask or the collapse REASON + the liquidity class — that pair is exactly
  // what F1 needs to measure whether the flat ×4 competition bar systematically nulls a class we'd
  // want to price (the predicted liquidity bias). reachable carries the PB pressure-priced band so
  // the retro can score it against realized fills beside the depth floor and the reach/relief lines.
  // RC-S1 — all five competing exit estimators co-log on ONE held row via the SHARED reshapers
  // (lib/suggestlog.mjs — one home, no drift across watch/screen/quote): depthExit (depth) · reachable
  // (pressure) · estSell (reachRelief) · asym (fixed-quantile); reach rides estConfidence.
  logSuggestions('watch', { mode: null, params: { targetsOnly: TARGETS_ONLY } }, [
    ...held.map(it => suggestionEntry(it.row, { itemId: it.id, cls: it.cls, verdict: heldVerdict(it), posture: wPosture,
      depthExit: depthExitShadow(it._depthExit, { qty: it.qty, volDay: it.row.volDay }), reachable: reachableShadow(it._reachable),
      estBuy: it._estShadow ? it._estShadow.estBuy : null,
      estSell: it._estShadow ? it._estShadow.estSell : null,
      estConfidence: estConfLean(it._estShadow),
      asym: asymShadow(it._asymShadow) })),
    ...targets.map(it => { const sig = sigByTarget.get(it.id); return suggestionEntry(it.row, {
      itemId: it.id, cls: it.cls,
      // verdict: FLUSH (alerted) or FLUSH-SIGNAL (logged silently, gated out) or the normal target verdict.
      verdict: sig ? (sig.flush ? 'FLUSH' : 'FLUSH-SIGNAL') : targetVerdict(it),
      posture: wPosture, dipLoop: sig ? dipLoopOf(it, sig) : undefined }); }),
    ...bidItems.map(it => suggestionEntry(it.row, { itemId: it.id, cls: it.cls, verdict: bidVerdict(it), posture: wPosture })),
  ]);

  // ---------------------------------------------------------------------------
  // OUTPUT (2026-07-05 format, Ben's ask): HEADLINE (state + alerts up front) →
  // one verdict-first block PER ITEM → SUMMARY footer (exposure/committed totals,
  // provenance, loop, exit discipline). Same facts as before, reframed.
  // ---------------------------------------------------------------------------
  // LOCAL wall-clock, per the CLAUDE.md time-display convention (the old toISOString stamp
  // printed UTC and mislabeled a 22:09 local session as 05:09 — 2026-07-05 confusion)
  const d = new Date(), p2 = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;

  // DL2 FLUSH pass — reactive liquid-flush ALERTS over the buy-side targets (sigByTarget, the single
  // source shared with the ledger rows). flushAlert returns null unless sig.flush (all four gates), so the
  // illiquid signal-only rows in the map are logged above but stay silent here — alerting is UNCHANGED,
  // only the LOG was widened. Per-item logged buys feed the buy-limit clause; fills.json is read once,
  // best-effort (a missing log → empty map → the normal bid clause).
  let buysMap = new Map();
  try { const fd = JSON.parse(fs.readFileSync(FILLS, 'utf8')); buysMap = buysByItem(fd && Array.isArray(fd.events) ? fd.events : []); }
  catch { /* no fills log (other machine) — buy-limit clause degrades to the normal bid clause */ }
  const flushAlerts = targets.map(it => flushAlert(it, sigByTarget.get(it.id), buysMap)).filter(Boolean)
    .sort((a, b) => (b.dipScore || 0) - (a.dipScore || 0));   // highest-priority flush first

  // ---- HEADLINE: the whole state in one line; alert details right under it ----
  const alerts = [...flushAlerts, ...held.map(heldAlert), ...bidItems.map(bidAlert)].filter(Boolean);
  const bidCount = bidItems.reduce((n, it) => n + it.bids.length, 0);
  const orphanAsks = asks.filter(a => !held.some(h => h.id === a.item));
  const counts = [];
  if (held.length) counts.push(`${held.length} held`);
  if (bidCount) counts.push(`${bidCount} bid${bidCount > 1 ? 's' : ''}`);
  if (orphanAsks.length) counts.push(`${orphanAsks.length} unbooked ask${orphanAsks.length > 1 ? 's' : ''}`);
  if (targets.length) counts.push(`${targets.length} target${targets.length > 1 ? 's' : ''}`);
  // VZ1: the whole output pass is now collected into a report object (buildWatchReport) and printed
  // ONCE via renderReport at pass end — byte-identical to the prior console.log sequence. Each piece
  // below is COLLECTED into a local instead of printed inline; the report is assembled + rendered last.
  const headlineText = `# watch ${stamp} — ${alerts.length ? `⚠ ${alerts.length} ALERT${alerts.length > 1 ? 'S' : ''}` : 'all quiet'} · ${counts.join(' · ') || 'empty board'}`;
  const pressureExitWarning = PRESSURE_EXIT ? '⚠ --pressure-exit: held list-at uses the UN-CALIBRATED pressure model (TRIAL; retro still scoring — not validated). The depth floor renders beside as the conservative reference.' : null;
  let freedLine = null, blindLine = null;
  // V6 COMPANION — capital awareness: a SELL that FREED ≥ threshold since last pass (a held lot's
  // qty dropped, detected via V1's prior-pass state) surfaces a redeploy prompt. Surface-ONLY — it
  // never auto-places and never runs the scan (Ben places every offer; the LLM/Ben runs /scan).
  // Guarded like every other state use; a fresh/stale prior yields no event (no startup misfire).
  try {
    const freed = freedCapital(priorState, held.map(it => ({ id: it.id, qty: it.qty, sellPrice: it.row.quickSell })), { now: nowMs });
    if (freed.prompt)
      freedLine = `  ⋯ freed ~${fmtP(freed.totalFreed)} this pass — consider a scan to redeploy (${freed.events.length} lot${freed.events.length > 1 ? 's' : ''} sold since last pass)`;
  } catch { /* companion is surface-only observability — never break a pass */ }
  // LH2: restart-blindness heads-up — a stale log with held inventory but no visible offers is the
  // post-restart blind state (the plugin re-emits nothing until a slot next changes). No behavioral
  // change; just names the failure so a session doesn't chase "vanished" offers.
  if (!TARGETS_ONLY && offersInfo && !offersInfo.err) {
    const blind = blindWarningLine({ staleMin: offersInfo.staleMin, activeOfferCount: asks.length + bids.length, openLotCount: heldSpecs.length });
    if (blind) blindLine = `  ${blind}`;
  }

  // ---- TABLE: numbers only (one row per item/offer), notes carry the words ----
  // Cell conventions match the canonical table v2 (CLAUDE.md): Quick/Optimistic are
  // self-contained buy → sell cells on one basis; Mom is the arrow display of row.mom.
  const momArrow = row => row.mom === 'breakup' ? '↑' : row.mom === 'breakdown' ? '↓' : '–';
  const regimeCell = row => (row.regime && row.regime.ok)
    ? `${row.regimeLabel} ${row.regime.driftPct >= 0 ? '+' : ''}${row.regime.driftPct.toFixed(0)}%` : '—';
  const volCell = row => row.volDay != null
    ? `${fmt(row.volDay)}/d${row.volDay < LIQUID_FLOOR_PER_DAY ? ' (thin)' : ''}` : '—';
  // VZ2b (PLAN-VIZ-LAYER, R8 — deliberate, confirmed VISIBLE change): the Quick/Optimistic cells now
  // adopt the CANONICAL composite cells from js/quotecore.js (`buy → sell · +net (roi)`) — the SAME
  // cells quote-items/screen ship via stdCells. This makes MONITORING.md's "canonical table-v2 basis"
  // claim literally true: ONE table-v2 cell format on every surface, net/roi included. canonicalQuoteCells
  // returns the full T1 cell array; index 2 = Quick composite, index 3 = Optimistic composite (cellText
  // → the plain markdown text, so stdout stays colorless while the app keeps the class).
  const quoteCells = row => { const c = canonicalQuoteCells('', row); return [cellText(c[2]), cellText(c[3])]; };
  const firstSentence = s => { const m = s.match(/^.*?[.;](?=\s|$)/); return m ? m[0] : s; };

  const tableRows = [];   // [verdict, item, position, quick, opt, vol, mom, regime, be]
  const briefRows = [];   // parallel {verdict,name,position,listAt,breakEven} for the --brief book (script-owned format)
  const notes = [];       // one compact line per item: action first-sentence + window read

  // V1/V4 cross-pass memory: priorState/newState/nowMs are computed above (held conviction loop),
  // so held rows only RENDER from it._deltas / it.gate here; bid deltas are still computed inline
  // (bids carry no conviction gating). newState is persisted once at pass end.

  for (const it of held) {
    const { row, be, qty, avgCost, lotValue, ts5m, name } = it;
    // pair with the live ask (exit-discipline visibility: an unlisted hold is a stranded lot)
    const ask = asks.find(a => a.item === it.id);
    // LH2.4: before reporting NOT LISTED, check for a suspected restart-blindness wipe of THIS item's
    // ask — a real cancel logs a terminal row first; a client restart skips straight to EMPTY, so the
    // pre-wipe ask is still probably resting in-game. Never presented as confirmed — always ⚠-flagged.
    const suspectAsk = !ask && suspectAsks.find(a => a.item === it.id);
    const listed = ask ? `ask ${ask.qty}/${fmt(ask.max)} @ ${fmtP(ask.offer)}`
      : suspectAsk ? `ask possibly still @ ${fmtP(suspectAsk.offer)} ⚠ vanished without a cancel in a mass log reset, verify in-game`
      : (offersInfo && !offersInfo.err ? 'NOT LISTED' : '');
    // a held item's still-open BUY must stay visible (2026-07-05: a filled-then-booked lot
    // swallowed its live bid row and the bid looked cancelled) — annotate it here instead
    const openBid = bids.find(b => b.item === it.id);
    const suspectBid = !openBid && suspectBids.find(b => b.item === it.id);
    const bidNote = openBid ? ` · bid ${openBid.qty}/${fmt(openBid.max)} @ ${fmtP(openBid.offer)}`
      : suspectBid ? ` · bid possibly still @ ${fmtP(suspectBid.offer)} ⚠ mass log reset, verify in-game` : '';
    // VN-1: the TABLE cell renders the persistence-gated display label (falls back to the raw
    // token when the display read is unavailable); the ledger above logged the raw token.
    const heldVer = it._display ? it._display.label : heldVerdict(it);
    const heldPos = `×${qty} @ ${fmtP(Math.round(avgCost))}${listed ? ' · ' + listed : ''}${bidNote}`;
    tableRows.push([heldVer, name, heldPos,
      ...quoteCells(row), volCell(row), momArrow(row), regimeCell(row), fmtP(be)]);
    // V5 EMIT CONTRACT: one standard, consistently-ordered per-held block — verdict · conviction ·
    // Δ-since-last · structural tripwire · sell/list-at (+ break-even) · fill-progress. The
    // guaranteed pieces (verdict, list-at, break-even, fill-progress) are computed OUTSIDE the
    // try so a context-field failure never drops the load-bearing sell line; the optional context
    // fields (V1 delta / V2 tripwire / V4 conviction) are computed inside, defaulting to null.
    const wl = windowLine(it.ts1h, { ask: ask ? ask.offer : null, compact: true, heldQty: it.qty, volDay: it.row.volDay,
      depth: it._depthExit, reachable: it._reachable });   // DE3: depth floor + pressure read ride the window clause
    const mvHeld = momVerdict(row, be, lotValue, ts5m, undefined, lotCtxOf(it));
    const verdictText = firstSentence(heldAction(row, be, lotValue, ts5m, mvHeld, it._display));
    let conviction = null, delta = null, tripwire = null, recovery = null;
    try {
      delta = it._deltas ? deltaLine(it._deltas) : null;
      tripwire = supportLine(it.ts1h);
      // V6 recovery-read — computed on every held lot, SURFACED only when the naive action isn't
      // obviously right (underwater / thin-margin / ask not filling / lean conflicts with verdict).
      // ADVISORY: it changes no verdict and raises no alert.
      const read = recoveryReadFor(it);
      const askListedNotFilling = !!(ask && (ask.qty === 0 || ask.qty == null));
      const trig = recoveryTrigger({ kind: 'held', instabuy: row.quickSell, breakEven: be,
        lean: read.lean, verdict: heldVerdict(it), askListedNotFilling });
      if (trig.surface) recovery = recoveryLine(read);
      // V4 arm-then-confirm: an armed-but-unconfirmed escalation is VISIBLE here as the conviction
      // field (never a headline ⚠ alert — that only fires once convictionGate escalates, in the
      // headline block). Two armed shapes, distinct notes. Confirmed escalations live in the headline.
      const persistMin = Math.round(ALERT_PERSIST_MS / 60000);
      const heldMin = ms => Math.max(0, Math.round((ms || 0) / 60000));
      if (it.gate && it.gate.armed && it.gate.reason === 'thesis-armed') {
        // TG1: expected-underwater silenced per the declared hold plan while live holds above the tripwire.
        const th = it._thesis || {};
        const exitBit = th.exitPrice != null ? `, exit ${fmtP(th.exitPrice)}` : '';
        const horizonBit = th.horizon ? ` (${th.horizon})` : '';
        conviction = `per thesis${horizonBit}: expected-underwater — silent above tripwire ${fmtP(th.tripwire)}${exitBit}; headline only on a break below.`;
      }
      else if (it.gate && it.gate.armed && it.gate.reason === 'cut-candidate-armed')
        conviction = `CUT-CANDIDATE armed — underwater ~${heldMin(it._deltas && it._deltas.underwaterMs)}m through a liquid window; headline only once it persists ~${persistMin}m (time-based, not per-pass).`;
      else if (it.gate && it.gate.armed && it.gate.reason === 'clear-armed')
        conviction = `LIST-TO-CLEAR armed — 2h breakdown ~${heldMin(it._deltas && it._deltas.breakdownMs)}m so far (a flicker at this cadence); headline only if the breakdown HOLDS ~${persistMin}m.`;
      else if (it.gate && it.gate.armed && it.gate.reason === 'structural-armed')
        conviction = `approaching cut-trigger — armed: live sell ${fmtP(row.quickSell)} below support ${fmtP(it._support)}; headline if it breaks the cut-trigger ${fmtP(Math.round(it._cutTrigger))} or holds below support ~${persistMin}m.`;
    } catch { /* state/levels are observability only — never block a watch pass */ }
    // PB4: under the pressure-exit trial, the list-at is the pressure-driven est-sell (BE-floored,
    // declared-exit-respecting — all in _estPressure); else the shared momVerdict list-at (unchanged).
    // The depth floor still renders in the window clause beside it (depthReachClause — the reference).
    const heldLa = (PRESSURE_EXIT && it._estPressure && it._estPressure.confidence.pressureExit)
      ? it._estPressure.estSell : heldListAt(row, be, mvHeld);
    // V2-P4b: the persistence-gated dominant-path line (shared renderPathLine) — decision support
    // rendered ALONGSIDE the verdict in the note block; a CONFIRMED migration surfaces prominently
    // here as `path MIGRATED <enteredUnder> → <current>` (never a new alert class).
    let pathLine = null;
    try { pathLine = it._pathCtx ? renderPathLine(it._pathCtx) : null; } catch { /* support-only */ }
    // PB-COPILOT-1: the margin-reduction-budget note (watchstate.mjs) — reads the SAME newState[key]
    // entry advanceState just persisted for this lot's conviction pass; never a fresh computation here.
    let marginBudget = null;
    try { marginBudget = marginBudgetNote(newState['held:' + it.id]); } catch { /* support-only */ }
    notes.push(...heldNoteBlock({
      name, verdict: verdictText, window: wl,
      pressure: pressureText(row.pressure, { compact: true }),
      reliableReason: row.reliable ? null : row.reliableReason,
      conviction, delta, tripwire, recovery, path: pathLine, marginBudget,
      listAt: heldLa, breakEven: be,
      fillProgress: listed || null,
    }));
    briefRows.push({ verdict: heldVer, name, position: heldPos, listAt: heldLa, breakEven: be });
    // YT1 (#4): the recorded session thesis for this lane, as an ADDITIONAL nested reminder AFTER the
    // guaranteed emit-contract fields (never displaces the sell/list-at line; never a verdict input).
    const th = thesisLine(thesisStore[it.id]);
    if (th) notes.push(`    ${th}`);
    // YP1 (#2): advisory guide re-anchor line — gated (silent below GUIDE_MIN_UPDATES observed
    // updates), output-only, never a verdict input. Price asks against the POST-update guide.
    const ga = guideAnchorLine(guideAnchorModel(guideUpdates(guideHist, it.id)), guide[it.id] ?? null);
    if (ga) notes.push(`    ${ga}`);
  }

  // asks with no booked lot yet (fresh buy still inside the sync window) — honest gap, no fake basis
  for (const a of orphanAsks) {
    const nm = map.byId[a.item]?.name || ('#' + a.item);
    const orphanPos = `ask ${a.qty}/${fmt(a.max)} @ ${fmtP(a.offer)}`;
    tableRows.push(['UNBOOKED-ASK', nm, orphanPos, '—', '—', '—', '—', '—', '—']);
    briefRows.push({ verdict: 'UNBOOKED-ASK', name: nm, position: orphanPos, listAt: a.offer, breakEven: null });
    notes.push(`- ${nm}: not booked in positions.json yet (sync lag); break-even unknown — run sync-fills.mjs to book it.`);
  }

  for (const it of bidItems) {
    const { row, name } = it;
    for (const off of it.bids) {
      const bidVer = offerVerdict(row, off.offer, it._bidPathCtx);   // P5 path-aware
      const bidPos = `bid ${off.qty}/${fmt(off.max)} @ ${fmtP(off.offer)}`;
      const bidBe = row.quickBuy != null ? breakEven(off.offer) : null;
      // intended sell if the bid fills: the band top, floored at the fill's own break-even (state-sell-price-in-loop)
      const bidListAt = (bidBe != null && row.optSell != null) ? Math.max(row.optSell, bidBe) : null;
      tableRows.push([bidVer, name, bidPos,
        ...quoteCells(row), volCell(row), momArrow(row), regimeCell(row),
        bidBe != null ? fmtP(bidBe) : '—']);
      briefRows.push({ verdict: bidVer, name, position: bidPos, listAt: bidListAt, breakEven: bidBe });
      const wl = windowLine(it.ts1h, { bid: off.offer, compact: true });
      const bidPress = pressureText(row.pressure, { compact: true });
      notes.push(`- ${name} bid @ ${fmtP(off.offer)}: ${firstSentence(bidAction(row, off, it._bidPathCtx))}${wl ? ` · window ${wl}` : ''}${bidPress ? ` · pressure ${bidPress}` : ''}${row.reliable ? '' : ` · ⚠ ${row.reliableReason}`}`);
      // V6 recovery-read on a resting bid — surfaced only when the fill hinges on direction
      // (BID-BEHIND: below the band, it fills only if the price drops to it). ADVISORY context:
      // a drop-lean means it's likely to fill, a recover-lean that it drifts away. No verdict input.
      try {
        const bidDirectional = offerVerdict(row, off.offer, it._bidPathCtx) === 'BID-BEHIND';
        if (recoveryTrigger({ kind: 'bid', bidDirectional }).surface) {
          const line = recoveryLine(recoveryReadFor(it));
          if (line) notes.push(`    ${line}`);
        }
      } catch { /* advisory only — never block a watch pass */ }
      // V1 cross-pass deltas for a resting bid. breakEven is left null (underwater is a held-lot
      // concept), so a bid only surfaces Δ instabuy / mom transition / band-top drift. Identity
      // carries the offer price → a re-priced bid resets its counters. Guarded (observability only).
      try {
        const key = `bid:${it.id}:${off.offer}`;
        const cur = { identity: `bid:${off.offer}:${off.max}`, instabuy: row.quickSell, mom: row.mom, bandTop: row.rawBandHi, breakEven: null };
        const dl = deltaLine(computeDeltas(priorState[key], cur, nowMs));
        newState[key] = advanceState(priorState[key], cur, nowMs);
        if (dl) notes.push(`    ${dl}`);
      } catch { /* observability only — never block a watch pass */ }
    }
  }

  for (const it of targets) {
    const { row, cls, be, name } = it;
    const tgtVer = targetVerdict(it);
    tableRows.push([tgtVer, name, 'watched',
      ...quoteCells(row), volCell(row), momArrow(row), regimeCell(row), be != null ? fmtP(be) : '—']);
    briefRows.push({ verdict: tgtVer, name, position: 'watched', listAt: row.optSell ?? null, breakEven: be ?? null });
    const tgtPress = pressureText(row.pressure, { compact: true });
    notes.push(`- ${name}: ${firstSentence(targetAction(row, cls, be))}${tgtPress ? ` · pressure ${tgtPress}` : ''}`);
  }

  // --brief: the compact one-line-per-item book. Format is OWNED BY watchcore.briefLine (stable,
  // fixture-pinned) — the agent relays this verbatim and only ADDS judgment notes. Headline
  // (alerts) above and SUMMARY below still render; the verbose table + per-item notes are skipped.
  const briefLines = BRIEF ? briefRows.map(briefLine) : [];

  // V1: persist THIS pass's state (rebuilt fresh from current items) for the next pass's deltas.
  // Guarded — a save failure is silent; it must never break the pass output. (VZ1: no output ordering
  // dependence — the whole report is rendered once below, after this side-effecting save.)
  try { saveState(WATCH_STATE, newState); } catch { /* observability only */ }

  // ---- SUMMARY: totals + provenance + loop + discipline ---- (collected into summaryLines; the
  // capital/derived-cash math + fs read stay HERE, in main's I/O; the report renders it as text)
  const exposure = held.reduce((n, it) => n + (it.lotValue || 0), 0);
  const committed = bidItems.reduce((n, it) => n + it.bids.reduce((m, o) => m + o.max * o.offer, 0), 0);
  const summaryLines = ['=== SUMMARY ==='];
  const sumBits = [];
  if (held.length) sumBits.push(`held exposure ${fmtP(exposure)} (${held.length} lot${held.length > 1 ? 's' : ''}${asks.length ? `, ${asks.length} listed` : ''})`);
  if (bidCount) sumBits.push(`bid capital ${fmtP(committed)} (${bidCount} offer${bidCount > 1 ? 's' : ''})`);
  // YV1 (#3): point-in-time capital utilization — working (held, able to profit) vs parked (resting
  // bids). Output-only context; never a verdict/alert input. Idle capital is a yield leak too.
  const util = bookUtilization({ workingGp: exposure, parkedGp: committed });
  if (util.utilizationPct != null) sumBits.push(`capital ${util.utilizationPct}% working / ${100 - util.utilizationPct}% parked`);
  sumBits.push(alerts.length ? `⚠ ${alerts.length} alert${alerts.length > 1 ? 's need' : ' needs'} action` : 'no alerts');
  summaryLines.push(`  ${sumBits.join(' · ')}`);
  // Total capital = committed (working+parked) + DERIVED idle cash (lib/derive-cash-tiers.mjs, PLAN-CASH-TRACKING).
  // Idle GP isn't in any log, so it's DERIVED FORWARD from a stored anchor (anchor + Σsells−Σbuys−escrow),
  // not a stated snapshot that ages the moment you trade. We feed `availableCash` (the FREE coin stack,
  // resting-bid ESCROW excluded) as the idle figure — the escrow is already counted in `committed` above,
  // so using liquidCapital here would double-count the parked bids. NEVER a verdict/alert input; purely the
  // idle-vs-working denominator. Absent an anchor we show the committed absolute and nudge how to set one.
  // Three-tier capital (lib/derive-cash-tiers.mjs): classify each resting bid DEEP (reclaimable) vs COMMITTED
  // using the rows we ALREADY computed this pass (row.quickBuy = live instasell, row.band.lo = robust 2h
  // band low) — ZERO extra fetch. A bid not in this map (none here — every bidItem has a row) would
  // classify COMMITTED. availableCash stays the literal free coin stack the idle-cash line shows.
  const bidMarketRef = {};
  for (const it of bidItems) if (it.row) bidMarketRef[it.id] = { live: it.row.quickBuy ?? null, bandLow: it.row.band?.lo ?? null };
  const dc = loadDerivedCash(undefined, { marketRef: bidMarketRef });
  const tc = totalCapital({ workingGp: exposure, parkedGp: committed, cashGp: dc.known ? dc.availableCash : null });
  if (tc.totalGp != null) {
    const min = dc.statedAt ? Math.round((Date.now() - new Date(dc.statedAt).getTime()) / 60000) : null;
    const ageTxt = min == null ? '' : (min < 60 ? `${min}m` : `${Math.floor(min / 60)}h${min % 60 ? ' ' + (min % 60) + 'm' : ''}`);
    const flowTxt = dc.netFlow ? ` ${dc.netFlow > 0 ? '+' : ''}${fmtP(dc.netFlow)} since` : '';
    const prov = min != null ? ` · idle derived from anchor ${ageTxt} ago${flowTxt}` : '';
    const inj = dc.inferredInjection > 0 ? ` ⚠ +${fmtP(dc.inferredInjection)} inferred injection — re-anchor to confirm (derive-cash.mjs)` : '';
    summaryLines.push(`  total capital ~${fmtP(tc.totalGp)} · committed ${fmtP(tc.committedGp)} (${tc.committedPct}%) / idle cash ~${fmtP(tc.cashGp)} (${tc.idlePct}%)${prov}${inj}`);
    // Three-tier deployable capital — never a silent binary. Printed only when something is resting (else all
    // three tiers equal availableCash). deployablePool = free stack + reclaimable DEEP-bid escrow; liquid =
    // + every resting bid's escrow (the loosest "cancel everything" pool). NEVER a verdict/alert input.
    if (dc.reserved > 0) {
      const dn = dc.restingDeepN || 0;
      const reclaim = dn > 0 ? `+ reclaimable ${fmtP(dc.reservedDeep)} from ${dn} deep bid${dn > 1 ? 's' : ''}` : '· no reclaimable deep bids';
      summaryLines.push(`  deployable ${fmtP(dc.deployablePool)} (free ${fmtP(dc.availableCash)} ${reclaim}) · liquid ${fmtP(dc.liquidCapital)} (all ${fmtP(dc.reserved)} bid escrow reclaimable)`);
    }
  } else if (exposure > 0 || committed > 0) {
    summaryLines.push(`  committed capital ${fmtP(tc.committedGp)} · idle cash not derived — set an anchor: node pipeline/commands/derive-cash.mjs <amount>`);
  }
  if (!TARGETS_ONLY) {
    summaryLines.push(posAge != null
      ? `  held basis positions.json ${posAge}m old${posAge > 25 ? ' ⚠ stale — a very recent trade may not show yet' : ''}` +
        (offersInfo && !offersInfo.err
          ? ` · offer basis live log, newest line ${offersInfo.staleMin}m ago${noise.length ? ` · noise ignored: ${noise.length} offer(s) under ${fmtP(NOISE_OFFER_GP)} total` : ''}`
          : ` · offer basis unavailable (${offersInfo ? offersInfo.err : 'skipped'}) — active offers not covered this pass`)
      : '  held basis positions.json unavailable');
  }
  summaryLines.push(`  loop /loop ${loopMin}m node pipeline/commands/watch-positions.mjs${tokens.length ? ' ' + tokens.map(t => `"${t}"`).join(' ') : ''}  (tightest cadence across ${all.length} item${all.length > 1 ? 's' : ''})`);
  summaryLines.push('  READ-ONLY decision support — exit at entry · never a stranded ask · cut on breakdown, not hope · you place every offer.');

  // VZ1: assemble the report object + render it ONCE — the ONE emission point (byte-identical to the
  // prior console.log sequence, pinned by pipeline/test/render.test.mjs).
  const report = buildWatchReport({
    generatedAt: stamp, headline: headlineText, alerts, pressureExitWarning, freedLine, blindLine,
    brief: BRIEF, briefLines,
    tableHeaders: ['Verdict', 'Item', 'Position', 'Quick', 'Optimistic', 'Vol/d', 'Mom', 'Regime', 'Break-even'],
    tableRows, notes, summaryLines,
  });
  console.log(renderReport(report));   // no-op unless --verbose
  const rel = writeLastReport('watch', report);   // AO1: always dump the report object for an agent read
  if (!VERBOSE) realLog(`# watch (quiet default; --verbose for the table) — ${tableRows.length} row(s) → ${rel}`);
}

// Entrypoint guard (matches screen-flip-niches.mjs / quote-items.mjs): importing this module for a
// unit test (buildWatchReport off fixtures) must NOT fire a full watch pass / hit the API.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
