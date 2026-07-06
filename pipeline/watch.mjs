#!/usr/bin/env node
/**
 * watch.mjs — ADAPTIVE, item-type-aware live-session monitor (chunk 7).
 *
 * A market-aware companion to monitor.mjs. Where monitor.mjs is a LOG-STATE snapshot
 * (active offers / recent fills / held count from the exchange log, no market fetch),
 * watch.mjs is the MARKET side of the loop: it re-quotes every held/target item live via
 * js/quotecore.js, classifies it by item TYPE, and drives a human-executed polling session
 * (the /loop skill, ~1–3 min) with:
 *   - per-item CLASS  → recommended attention cadence + which playbook applies
 *   - live re-quoted buy-at / list-at prices (list-at is ALWAYS break-even-floored)
 *   - DROP / CUT alerts via the SHARED chunk-6 cut-trigger momVerdict()
 *   - a compact per-item RISK read (spread · two-sided liquidity · regime · ticket/exposure)
 *     with an adverse-selection warning, and the scalp/market-make playbook gated to
 *     ranging-wide-spread items ONLY.
 *
 * Why a sibling and not an edit to monitor.mjs: monitor.mjs is the raw log-state snapshot
 * (no market fetch); watch.mjs owns market fetch + quotecore classification. Log discovery
 * and open-offer semantics are SHARED via offers.mjs (one owner, both import it).
 * Run monitor.mjs for the raw log state; run watch.mjs to decide what to do.
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
 *   node pipeline/watch.mjs                       # every position: held lots + active offers
 *   node pipeline/watch.mjs "Crystal seed" 23959  # also watch these target items (buy-side)
 *   node pipeline/watch.mjs --targets-only "Ranarr weed"   # skip held+offers, watch only these
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeQuote, breakEven, momVerdict, offerVerdict, BIG_TICKET_GP, FRESH_HOURS } from '../js/quotecore.js';
import { fmtP, fmt } from '../js/format.js';
import { loadMapping, loadGuide, fetchItemInputs } from './lib/marketfetch.mjs';
import { readOpenPositions } from './lib/positions.mjs';
import { readExchangeLog, activeOffers } from './lib/offers.mjs';
import { logSuggestions, suggestionEntry } from './lib/suggestlog.mjs';
import { windowStats, quantLow, quantHigh, touchedDays, reachedDays } from './lib/windowread.mjs';
import { blindWarningLine } from './lib/logblind.mjs'; // LH2 restart-blindness header line
import { loadState, saveState, computeDeltas, advanceState, convictionGate } from './lib/watchstate.mjs'; // V1 cross-pass memory + V4 conviction gating
import { structuralSupport, cutTrigger, SUPPORT_LOOKBACK_DAYS } from './lib/levels.mjs';   // V2 support/cut-trigger

const HERE = path.dirname(fileURLToPath(import.meta.url));
const POSITIONS = path.join(HERE, '..', 'positions.json');
const GUIDE_HISTORY = path.join(HERE, '.guide-history.jsonl'); // gitignored, change-only guide log
const WATCH_STATE = path.join(HERE, '.cache', 'watch-state.json'); // gitignored, V1 cross-pass state (.cache/ ignored)

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
// windowrange.mjs call. This prints the same quantiles inline, scored over the COMING 8
// machine-local hours across the last 7 days. Same honesty bound as windowrange.mjs:
// touched/reached ≠ filled, ~7 days is a small sample — context, never a verdict input.
const WINDOW_HOURS = 8;
const WINDOW_DAYS = 7;
function windowLine(ts1h, { bid = null, ask = null, compact = false } = {}) {
  if (!ts1h || !ts1h.length) return null;
  const h = new Date().getHours();
  const wStart = h, wEnd = (h + WINDOW_HOURS) % 24;
  const stats = windowStats(ts1h, { nights: WINDOW_DAYS, wStart, wEnd });
  if (!stats) return null;
  const { lows, his } = stats;
  if (compact) { // one short clause for the notes list (same numbers, no label/caveat prose)
    if (bid != null && lows.length) return `bid ${fmtP(bid)} touched ${touchedDays(lows, bid)}/${lows.length}d`;
    if (ask != null && his.length) return `ask ${fmtP(ask)} reached ${reachedDays(his, ask)}/${his.length}d`;
    if (his.length) return `${WINDOW_HOURS}h highs ~75% ${fmtP(quantHigh(his, 0.75))} / ~50% ${fmtP(quantHigh(his, 0.5))}`;
    return null;
  }
  const label = `next ${WINDOW_HOURS}h window (${String(wStart).padStart(2, '0')}–${String(wEnd).padStart(2, '0')}h × last ${stats.days.length}d)`;
  const bits = [];
  if (bid != null && lows.length)
    bits.push(`bid ${fmtP(bid)} touched ${touchedDays(lows, bid)}/${lows.length}d · lows ~50% ${fmtP(quantLow(lows, 0.5))} / ~75% ${fmtP(quantLow(lows, 0.75))}`);
  if (ask != null && his.length)
    bits.push(`ask ${fmtP(ask)} reached ${reachedDays(his, ask)}/${his.length}d`);
  if (his.length)
    bits.push(`highs reached ~75% ${fmtP(quantHigh(his, 0.75))} / ~50% ${fmtP(quantHigh(his, 0.5))}`);
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


// --- ACTION line for a HELD lot. Sell-side framing is HONEST (clear-vs-hold), never
// "out-run the drop". List-at is break-even-floored. momVerdict() (chunk 6) runs FIRST so a
// 2h breakdown escalates before the lagging multi-day regime confirms.
function heldAction(row, be, lotValue, ts5m, lotCtx) {
  const instabuy = row.quickSell;
  const mv = momVerdict(row, be, lotValue, ts5m, undefined, lotCtx);
  if (mv) {
    // PLAN-3 gate-tree verdicts (each says WHICH gate fired + the evidence, in one line).
    if (mv.action === 'NO_READ')
      return `NO-READ (${row.reliableReason}) — the quote isn't a reliable price right now (Gate 0). No price action; keep any ask ≥ break-even ${fmtP(be)} and re-check at the next liquid window.`;
    if (mv.action === 'DIURNAL_WATCH')
      return `DIURNAL-WATCH @ ${fmtP(mv.listAt)} — underwater at a quiet hour that dipped & recovered yesterday (Gate 1). Hold ≥ break-even; do NOT cut into the trough. If still underwater at a liquid hour, the defense is spent → re-assess.`;
    if (mv.action === 'SHOCK_WATCH')
      return `SHOCK-WATCH @ ${fmtP(mv.listAt)} — a one-off volume-spike shock that stabilized, not a bleed, on a small lot with an intact regime (Gate 2). Hold one more cycle; a fresh low next tick = bleed → cut.`;
    if (mv.action === 'HOLD_FILLING')
      return `HOLD — ask filling @ ${fmtP(mv.listAt)} — your own ask is filling above the clear price (Gate D, V3); an ask transacting above the clear beats repricing down. Hold it; let it keep filling.`;
    if (mv.action === 'HOLD_FRESH')
      return `WATCH — fresh entry @ ${fmtP(mv.listAt)} — a fresh (<${FRESH_HOURS}h) patient fill is definitionally underwater on the instant read (Gate D, V3). Hold the ask ≥ break-even and give the thesis its window; don't cut a brand-new lot.`;
    if (mv.action === 'CUT')
      return `${mv.verdict} @ ${fmtP(mv.listAt)} — ${mv.gate === 'D' ? 'underwater through a liquid window: persistence, not the clock' : 'controlled loss-taking: stop the bleed, free the capital'}. This is NOT out-running the drop; chasing the ask lower just sells cheaper.`;
    if (mv.action === 'CLEAR')
      return `LIST-TO-CLEAR @ ${fmtP(mv.listAt)} — bank it; a softening market won't pay the patient premium. Repricing down realizes the current price, it does not beat the market.`;
    if (mv.action === 'HOLD_STRONG')
      return `HOLD — list high @ ${fmtP(mv.listAt)} (2h top); don't sell into strength.`;
    if (mv.action === 'HOLD_WATCH')
      return `HOLD — watch; a lone 2h dip vs an uptrend on a small lot is usually noise.`;
  }
  if (instabuy == null) return 'NO QUOTE — cannot price; do not act blind.';
  if (row.falling) {
    return instabuy >= be
      ? `SELL @ ${fmtP(instabuy)} — falling regime, clear in profit. Not out-running the drop; taking the exit while it's still green.`
      : `CUT @ ${fmtP(instabuy)} — falling & underwater; take the small loss to free capital before a bigger one.`;
  }
  // stable / rising: patient list at the band top if it clears break-even, else floor at break-even
  const listAt = (row.optSell != null && row.optSell >= be) ? row.optSell : Math.max(instabuy, be);
  const banded = row.optSell != null && row.optSell > instabuy;
  return `HOLD — list @ ${fmtP(listAt)} (break-even-floored${banded ? ', band top' : ''}). ` +
    `Only in THIS ranging case does listing at the band top earn a premium; if it flips to breakdown, momVerdict switches to clear-vs-hold — don't defend the ask down.`;
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
function bidAction(row, off) {
  const filled = `${off.qty}/${fmt(off.max)} filled`;
  // decision via the SHARED offerVerdict (js/quotecore.js) so the console and the app Watch tab
  // can never disagree on a bid's state; the strings below are watch.mjs's own (byte-identical).
  switch (offerVerdict(row, off.offer)) {
    case 'CANCEL-BID':
      return `CANCEL-BID — ${row.falling ? `falling regime (${row.regimeLabel})` : '2h breakdown'}; a fill at ${fmtP(off.offer)} means the market dropped to meet you. Cancel unless you are deliberately pricing the fall.`;
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
  if (offerVerdict(row, bid.offer) === 'CANCEL-BID')
    return { level: 'CANCEL-BID', msg: `CANCEL-BID ${name} @ ${fmtP(bid.offer)} — ${row.falling ? `falling regime (${row.regimeLabel})` : '2h breakdown'}; a fill here is adverse selection. Cancel unless you want the falling price.` };
  return null;
}

async function buildItem({ id, name, qty, avgCost, buyTs }, map, guide) {
  const inp = await fetchItemInputs(id, { ts1h: true }); // ts1h feeds the window-context line
  const held = qty != null;
  const row = computeQuote({ ...inp, guide: guide[id] ?? null, limit: map.byId[id]?.limit ?? null, held, asked: true });
  const cls = classify(row);
  const meta = CLASSES[cls];
  const be = held ? breakEven(avgCost) : (row.quickBuy != null ? breakEven(row.quickBuy) : null);
  const lotValue = held ? qty * avgCost : null;
  // V3 lot-context: buyTs (oldest lot's buy time, unix s) enables the entry-age softening;
  // askFilling is set later in main() once the live asks are known (needs both this row + asks).
  return { id, name, qty, avgCost, buyTs: buyTs ?? null, held, row, cls, meta, be, lotValue, ts5m: inp.ts5m, ts1h: inp.ts1h, askFilling: false };
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
        const pu = (it._deltas && it._deltas.passesUnderwater) || 2;
        return { level: mv.verdict, msg: `${mv.verdict} ${name} @ ${fmtP(mv.listAt)} — underwater through a liquid window, confirmed over ${pu} consecutive passes; free the capital.` };
      }
      // armed Gate-D (or masked by a structural escalation handled just below) — no headline here.
    } else {
      if (mv.action === 'CLEAR')
        return { level: 'CLEAR', msg: `LIST-TO-CLEAR ${name} @ ${fmtP(mv.listAt)} — 2h breakdown; bank it, don't hold for the premium.` };
      if (mv.action === 'NO_READ')
        return { level: 'NO-READ', msg: `NO-READ ${name} (${row.reliableReason}) — can't price a decision off this quote. Keep any ask ≥ break-even ${fmtP(be)}; re-check at a liquid window.` };
      if (mv.action === 'DIURNAL_WATCH')
        return { level: 'DIURNAL', msg: `DIURNAL-WATCH ${name} — underwater at a quiet hour that recovered yesterday. Hold ≥ break-even ${fmtP(be)}; don't cut into the trough.` };
      if (mv.action === 'SHOCK_WATCH')
        return { level: 'SHOCK', msg: `SHOCK-WATCH ${name} @ ${fmtP(mv.listAt)} — one-off shock, not a bleed; hold one more cycle.` };
    }
  }
  // Structural-break escalation (V4) — a CONVINCING break of the V2 tripwire (≥δ below support, or
  // 2 consecutive passes below support). Independent of the mom verdict; not gated by underwater.
  if (gate && gate.escalate && gate.reason === 'structural')
    return { level: 'CUT', msg: `CUT — structural break ${name} @ ${fmtP(instabuy)} — broke below structural support ${fmtP(it._support)} (cut-trigger ${fmtP(Math.round(it._cutTrigger))}); the level that held gave way. Price to clear at the instabuy.` };
  // An ARMED Gate-D candidate must NOT fall through to the immediate UNDERWATER alert — that would
  // defeat arm-then-confirm (an armed CUT-CANDIDATE is by definition underwater). A structural-armed
  // graze is purely additive and does NOT suppress the softer underwater/falling signals.
  if (gate && gate.armed && gate.reason === 'cut-candidate-armed') return null;
  if (instabuy != null && be != null && instabuy < be)
    return { level: 'UNDERWATER', msg: `UNDERWATER ${name} — live sell ${fmtP(instabuy)} < break-even ${fmtP(be)}. Hold ≥ break-even only if regime is flat/rising; cut if it turns.` };
  if (row.falling)
    return { level: 'FALLING', msg: `FALLING ${name} — multi-day regime ${row.regimeLabel} ${row.regime.driftPct.toFixed(0)}%. Price to clear at the instabuy ${fmtP(instabuy)}; don't defend the ask down.` };
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const TARGETS_ONLY = args.includes('--targets-only');
  const tokens = args.filter(a => !a.startsWith('--'));

  const map = await loadMapping();
  const guide = await loadGuide();

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
  if (!TARGETS_ONLY) {
    try {
      const { rows, staleMin } = readExchangeLog();
      offersInfo = { staleMin };
      for (const o of activeOffers(rows)) {
        if (o.max * o.offer < NOISE_OFFER_GP) { noise.push(o); continue; }
        (o.state === 'BUYING' ? bids : asks).push(o);
      }
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
  const newState = {};
  for (const it of held) {
    it.gate = { escalate: false, armed: false, reason: null };
    it._deltas = null; it._support = null; it._cutTrigger = null;
    try {
      const key = 'held:' + it.id;
      const support = structuralSupport(dayLowsFrom(it.ts1h));
      const trig = support != null ? cutTrigger(support) : null;
      const cur = { identity: `hld:${it.qty}:${Math.round(it.avgCost)}`,
        instabuy: it.row.quickSell, mom: it.row.mom, bandTop: it.row.rawBandHi, breakEven: it.be, support };
      const d = computeDeltas(priorState[key], cur, nowMs);
      newState[key] = advanceState(priorState[key], cur, nowMs);
      it._deltas = d; it._support = support; it._cutTrigger = trig;
      const mv = momVerdict(it.row, it.be, it.lotValue, it.ts5m, undefined, lotCtxOf(it));
      it.gate = convictionGate({
        verdict: mv && mv.verdict, gate: mv && mv.gate,
        passesUnderwater: d.passesUnderwater,
        price: it.row.quickSell, support, cutTrigger: trig,
        passesBelowSupport: d.passesBelowSupport,
      });
    } catch { /* gating/state are observability-adjacent — degrade to no-escalation, never break a pass */ }
  }

  const targets = [];
  for (const s of targetSpecs) targets.push(await buildItem(s, map, guide));
  const bidItems = [];
  for (const s of bidSpecs) {
    const it = await buildItem({ id: s.id, name: s.name }, map, guide);
    it.bid = s.offers[0]; it.bids = s.offers; // primary + all (multi-slot same-item bids)
    bidItems.push(it);
  }

  const all = [...held, ...targets, ...bidItems];
  logGuideChanges(all, guide); // pin guide-update timing/magnitude for watched items
  const loopMin = Math.min(...all.map(it => it.meta.cadence));

  // O1 suggestions ledger: log every held/target read at emit time, unconditionally. `class` is
  // watch's richer classify() taxonomy label; verdict is the concise action token for the read.
  const heldVerdict = it => {
    const mv = momVerdict(it.row, it.be, it.lotValue, it.ts5m, undefined, lotCtxOf(it));
    if (mv) return mv.verdict;
    if (it.row.falling) return 'FALLING';
    if (it.row.quickSell != null && it.be != null && it.row.quickSell < it.be) return 'UNDERWATER';
    return it.row.quickSell != null ? 'HOLD' : 'NO-QUOTE';
  };
  const targetVerdict = it => it.cls === 'FALLING' ? 'SKIP'
    : it.row.quickBuy == null ? 'NO-QUOTE'
    : it.cls === 'LIQUID_RANGING_WIDE' ? 'SCALP-BUY' : 'BUY';
  const bidVerdict = it => offerVerdict(it.row, it.bid.offer);   // SHARED with the app Watch tab (js/quotecore.js)
  logSuggestions('watch', { mode: null, params: { targetsOnly: TARGETS_ONLY } }, [
    ...held.map(it => suggestionEntry(it.row, { itemId: it.id, cls: it.cls, verdict: heldVerdict(it) })),
    ...targets.map(it => suggestionEntry(it.row, { itemId: it.id, cls: it.cls, verdict: targetVerdict(it) })),
    ...bidItems.map(it => suggestionEntry(it.row, { itemId: it.id, cls: it.cls, verdict: bidVerdict(it) })),
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

  // ---- HEADLINE: the whole state in one line; alert details right under it ----
  const alerts = [...held.map(heldAlert), ...bidItems.map(bidAlert)].filter(Boolean);
  const bidCount = bidItems.reduce((n, it) => n + it.bids.length, 0);
  const orphanAsks = asks.filter(a => !held.some(h => h.id === a.item));
  const counts = [];
  if (held.length) counts.push(`${held.length} held`);
  if (bidCount) counts.push(`${bidCount} bid${bidCount > 1 ? 's' : ''}`);
  if (orphanAsks.length) counts.push(`${orphanAsks.length} unbooked ask${orphanAsks.length > 1 ? 's' : ''}`);
  if (targets.length) counts.push(`${targets.length} target${targets.length > 1 ? 's' : ''}`);
  console.log(`# watch ${stamp} — ${alerts.length ? `⚠ ${alerts.length} ALERT${alerts.length > 1 ? 'S' : ''}` : 'all quiet'} · ${counts.join(' · ') || 'empty board'}`);
  for (const a of alerts) console.log(`  ⚠ ${a.msg}`);
  // LH2: restart-blindness heads-up — a stale log with held inventory but no visible offers is the
  // post-restart blind state (the plugin re-emits nothing until a slot next changes). No behavioral
  // change; just names the failure so a session doesn't chase "vanished" offers.
  if (!TARGETS_ONLY && offersInfo && !offersInfo.err) {
    const blind = blindWarningLine({ staleMin: offersInfo.staleMin, activeOfferCount: asks.length + bids.length, openLotCount: heldSpecs.length });
    if (blind) console.log(`  ${blind}`);
  }

  // ---- TABLE: numbers only (one row per item/offer), notes carry the words ----
  // Cell conventions match the canonical table v2 (CLAUDE.md): Quick/Optimistic are
  // self-contained buy → sell cells on one basis; Mom is the arrow display of row.mom.
  const momArrow = row => row.mom === 'breakup' ? '↑' : row.mom === 'breakdown' ? '↓' : '–';
  const regimeCell = row => (row.regime && row.regime.ok)
    ? `${row.regimeLabel} ${row.regime.driftPct >= 0 ? '+' : ''}${row.regime.driftPct.toFixed(0)}%` : '—';
  const volCell = row => row.volDay != null
    ? `${fmt(row.volDay)}/d${row.volDay < LIQUID_FLOOR_PER_DAY ? ' (thin)' : ''}` : '—';
  const quoteCells = row => [
    `${fmtP(row.quickBuy)} → ${fmtP(row.quickSell)}`,
    `${fmtP(row.optBuy)} → ${fmtP(row.optSell)}`,
  ];
  const firstSentence = s => { const m = s.match(/^.*?[.;](?=\s|$)/); return m ? m[0] : s; };

  const tableRows = [];   // [verdict, item, position, quick, opt, vol, mom, regime, be]
  const notes = [];       // one compact line per item: action first-sentence + window read

  // V1/V4 cross-pass memory: priorState/newState/nowMs are computed above (held conviction loop),
  // so held rows only RENDER from it._deltas / it.gate here; bid deltas are still computed inline
  // (bids carry no conviction gating). newState is persisted once at pass end.

  for (const it of held) {
    const { row, be, qty, avgCost, lotValue, ts5m, name } = it;
    // pair with the live ask (exit-discipline visibility: an unlisted hold is a stranded lot)
    const ask = asks.find(a => a.item === it.id);
    const listed = ask ? `ask ${ask.qty}/${fmt(ask.max)} @ ${fmtP(ask.offer)}`
      : (offersInfo && !offersInfo.err ? 'NOT LISTED' : '');
    // a held item's still-open BUY must stay visible (2026-07-05: a filled-then-booked lot
    // swallowed its live bid row and the bid looked cancelled) — annotate it here instead
    const openBid = bids.find(b => b.item === it.id);
    const bidNote = openBid ? ` · bid ${openBid.qty}/${fmt(openBid.max)} @ ${fmtP(openBid.offer)}` : '';
    tableRows.push([heldVerdict(it), name,
      `×${qty} @ ${fmtP(Math.round(avgCost))}${listed ? ' · ' + listed : ''}${bidNote}`,
      ...quoteCells(row), volCell(row), momArrow(row), regimeCell(row), fmtP(be)]);
    const wl = windowLine(it.ts1h, { ask: ask ? ask.offer : null, compact: true });
    notes.push(`- ${name}: ${firstSentence(heldAction(row, be, lotValue, ts5m, lotCtxOf(it)))}${wl ? ` · window ${wl}` : ''}${row.reliable ? '' : ` · ⚠ ${row.reliableReason}`}`);
    // V1/V2 output-only context: cross-pass deltas + structural-support levels (computed in the
    // held conviction loop above — RENDER only here). Guarded so a render failure never breaks a pass.
    try {
      const dl = it._deltas ? deltaLine(it._deltas) : null;
      if (dl) notes.push(`    ${dl}`);
      const sl = supportLine(it.ts1h);
      if (sl) notes.push(`    ${sl}`);
      // V4 arm-then-confirm: an armed-but-unconfirmed escalation stays VISIBLE here (never a headline
      // ⚠ alert — that only fires once convictionGate escalates). Two armed shapes, distinct notes.
      if (it.gate && it.gate.armed && it.gate.reason === 'cut-candidate-armed')
        notes.push(`    CUT-CANDIDATE armed — ${ordinal((it._deltas && it._deltas.passesUnderwater) || 1)} underwater pass through a liquid window; headline alert on the next consecutive underwater pass.`);
      else if (it.gate && it.gate.armed && it.gate.reason === 'structural-armed')
        notes.push(`    approaching cut-trigger — armed: live sell ${fmtP(row.quickSell)} below support ${fmtP(it._support)}; headline alert if it breaks the cut-trigger ${fmtP(Math.round(it._cutTrigger))} or holds below support next pass.`);
    } catch { /* state/levels are observability only — never block a watch pass */ }
  }

  // asks with no booked lot yet (fresh buy still inside the sync window) — honest gap, no fake basis
  for (const a of orphanAsks) {
    const nm = map.byId[a.item]?.name || ('#' + a.item);
    tableRows.push(['UNBOOKED-ASK', nm, `ask ${a.qty}/${fmt(a.max)} @ ${fmtP(a.offer)}`, '—', '—', '—', '—', '—', '—']);
    notes.push(`- ${nm}: not booked in positions.json yet (sync lag); break-even unknown — run sync-fills.mjs to book it.`);
  }

  for (const it of bidItems) {
    const { row, name } = it;
    for (const off of it.bids) {
      tableRows.push([offerVerdict(row, off.offer), name,
        `bid ${off.qty}/${fmt(off.max)} @ ${fmtP(off.offer)}`,
        ...quoteCells(row), volCell(row), momArrow(row), regimeCell(row),
        row.quickBuy != null ? fmtP(breakEven(off.offer)) : '—']);
      const wl = windowLine(it.ts1h, { bid: off.offer, compact: true });
      notes.push(`- ${name} bid @ ${fmtP(off.offer)}: ${firstSentence(bidAction(row, off))}${wl ? ` · window ${wl}` : ''}${row.reliable ? '' : ` · ⚠ ${row.reliableReason}`}`);
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
    tableRows.push([targetVerdict(it), name, 'watched',
      ...quoteCells(row), volCell(row), momArrow(row), regimeCell(row), be != null ? fmtP(be) : '—']);
    notes.push(`- ${name}: ${firstSentence(targetAction(row, cls, be))}`);
  }

  console.log('\n| Verdict | Item | Position | Quick | Optimistic | Vol/d | Mom | Regime | Break-even |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of tableRows) console.log(`| ${r.join(' | ')} |`);

  if (notes.length) {
    console.log('');
    for (const n of notes) console.log(n);
  }

  // V1: persist THIS pass's state (rebuilt fresh from current items) for the next pass's deltas.
  // Guarded — a save failure is silent; it must never break the pass output.
  try { saveState(WATCH_STATE, newState); } catch { /* observability only */ }

  // ---- SUMMARY: totals + provenance + loop + discipline ----
  const exposure = held.reduce((n, it) => n + (it.lotValue || 0), 0);
  const committed = bidItems.reduce((n, it) => n + it.bids.reduce((m, o) => m + o.max * o.offer, 0), 0);
  console.log('\n=== SUMMARY ===');
  const sumBits = [];
  if (held.length) sumBits.push(`held exposure ${fmtP(exposure)} (${held.length} lot${held.length > 1 ? 's' : ''}${asks.length ? `, ${asks.length} listed` : ''})`);
  if (bidCount) sumBits.push(`bid capital ${fmtP(committed)} (${bidCount} offer${bidCount > 1 ? 's' : ''})`);
  sumBits.push(alerts.length ? `⚠ ${alerts.length} alert${alerts.length > 1 ? 's need' : ' needs'} action` : 'no alerts');
  console.log(`  ${sumBits.join(' · ')}`);
  if (!TARGETS_ONLY) {
    console.log(posAge != null
      ? `  held basis positions.json ${posAge}m old${posAge > 25 ? ' ⚠ stale — a very recent trade may not show yet' : ''}` +
        (offersInfo && !offersInfo.err
          ? ` · offer basis live log, newest line ${offersInfo.staleMin}m ago${noise.length ? ` · noise ignored: ${noise.length} offer(s) under ${fmtP(NOISE_OFFER_GP)} total` : ''}`
          : ` · offer basis unavailable (${offersInfo ? offersInfo.err : 'skipped'}) — active offers not covered this pass`)
      : '  held basis positions.json unavailable');
  }
  console.log(`  loop /loop ${loopMin}m node pipeline/watch.mjs${tokens.length ? ' ' + tokens.map(t => `"${t}"`).join(' ') : ''}  (tightest cadence across ${all.length} item${all.length > 1 ? 's' : ''})`);
  console.log('  READ-ONLY decision support — exit at entry · never a stranded ask · cut on breakdown, not hope · you place every offer.');
}

await main();
