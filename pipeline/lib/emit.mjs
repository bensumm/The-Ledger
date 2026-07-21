/**
 * emit.mjs — the watch-positions.mjs per-HELD-item EMIT CONTRACT (chunk V5). PURE, console-only.
 *
 * V1–V4 grew watch-positions.mjs's per-held note block organically (a verdict note, then a Δ line, a
 * support/cut-trigger line, armed-conviction notes). V5 makes it ONE stable, predictable,
 * consistently-ordered block so a reader (human or LLM) always gets the same fields in the same
 * order. The fields, in contract order:
 *
 *   1. verdict          — the momVerdict action's first sentence (already computed by heldAction),
 *                         + window context + optional compact buy/sell pressure on the same line
 *   2. conviction-state — the V4 arm-then-confirm note, when armed (confirmed escalations live in
 *                         the HEADLINE, not here — this block surfaces the ARMED state)
 *   3. Δ-since-last     — the V1 cross-pass delta line, when a signal is informative
 *   4. structural tripwire — the V2 `support X · cut-trigger Y` line, when computable
 *   4a. recovery-read   — the V6 ADVISORY recover-vs-drop lean, when the trigger surfaces it (a
 *                         non-clean position); distinct from the verdict — decision SUPPORT, not a
 *                         verdict/alert input
 *   5. sell/list-at (+ break-even) + fill-progress — ALWAYS on a held lot
 *
 * Field 5 is the load-bearing guarantee: EVERY held lot surfaces its list-at sell price + break-even
 * unconditionally. Standing user rule (Ben, 2026-07-06): "always state the sell price for every item
 * we summarize, because I may have logged a fill you didn't see; it saves me re-asking." The other
 * fields are optional (omitted when not applicable / not informative); the sell line is not.
 *
 * PURE: this consumes already-computed pieces (the caller ran momVerdict / computeDeltas /
 * structuralSupport / convictionGate) and decides NOTHING — it just orders + formats them. It
 * changes no verdict, no alert, no row selection (V5 is output-format-only).
 */
import { fmtP, fmt } from '../../js/money-format.js';

/**
 * depthReachClause — PLAN-DEPTH-EXIT DE3: the held-lot depth/pressure clause for the window line.
 * PURE formatter over an already-computed clearableAsk result (`ca`) + reachableBand result (`rb`)
 * (both js/windowread.mjs; either may be null). Returns one compact clause string, or null when
 * there is nothing to say. THE TWO-LENS CONTRACT (the Soul-rune 394 lesson): the depth read is a
 * strictly-conservative, size-honest FLOOR (bucket AVERAGES smooth away the peaks a resting ask
 * fills at), so on a liquid book it under-reads — it must NEVER render alone as "the" exit price.
 * When the pressure-driven reachable band is readable it renders BESIDE the floor; and a collapsed
 * depth read ALWAYS prints its REASON (a silent degrade is a defect — Ben's hard requirement).
 * Inform-only: this line changes no verdict, alert, or price.
 */
export function depthReachClause({ ca = null, rb = null, qty = null } = {}) {
  const bits = [];
  if (ca && ca.price != null) {
    bits.push(`depth floor: book ${fmt(qty ?? ca.qty)}u @ ≤${fmtP(ca.price)} on ~${Math.round(ca.clearFrac * 100)}% of ${ca.nDays}d (est ×${ca.competition} comp — size-honest, smoothing-conservative)`);
  } else if (ca) {
    const why = ca.reason === 'insufficient-depth'
      ? `book absorbs <${ca.competition}× your ${fmt(qty ?? ca.qty)}u lot`
      : ca.reason === 'thin-history' ? 'too little day history' : 'no traded buckets';
    bits.push(`depth n/a — ${why}; reach fallback`);
  }
  if (rb && rb.ask != null) {
    const regime = rb.pressure >= 1.1 ? 'buy-heavy' : rb.pressure <= 0.9 ? 'sell-heavy' : 'balanced';
    bits.push(`reachable ask ~${fmtP(rb.ask)} / bid ~${fmtP(rb.bid)} (pressure ${rb.pressure.toFixed(1)}× ${regime}${rb.reliability < 1 ? `, rel ${rb.reliability.toFixed(2)}` : ''})`);
  }
  return bits.length ? bits.join(' · ') : null;
}

/**
 * The canonical list-at sell price for a held lot. Prefers the shared momVerdict's `listAt` (the
 * one price the gate tree already chose); falls back — for the verdicts that carry none (NO_READ,
 * HOLD_WATCH, or no verdict at all) — to the SAME band-top-floored-at-break-even rule heldAction
 * uses, so the guaranteed sell field never drifts from the action prose. Always returns a number
 * when the lot is priceable; degrades to break-even (never null) so the field is unconditional.
 */
export function heldListAt(row, be, mv) {
  if (mv && mv.listAt != null) return mv.listAt;
  const instabuy = row ? row.quickSell : null;
  if (row && row.optSell != null && row.optSell >= be) return row.optSell;
  if (instabuy != null) return Math.max(instabuy, be);
  return be;
}

/**
 * Build the ordered note-block lines for one held lot. Returns string[] (the caller pushes them
 * onto its notes list). The header line is `- <name>: …`; every other field is a nested (4-space)
 * sub-line. Optional fields are dropped when null/empty; the sell line is ALWAYS emitted last.
 */
export function heldNoteBlock({
  name, verdict, window: win, reliableReason, pressure, staleLive,
  conviction, delta, tripwire, recovery, path, marginBudget,
  listAt, breakEven, fillProgress,
}) {
  const lines = [];
  // 1. VERDICT — action first sentence, + window context + buy/sell pressure (the compact
  //    pressureText string, OPTIONAL — trailing-24h flow imbalance, display-only context; see
  //    the SHORTCOMINGS comment in js/quotecore.js computeQuote) + a reliability flag when soft
  //    + a stale-live-print flag (QUICK_FRESH_MIN): the displayed live instabuy/instasell is an old
  //    /latest print, not a live tick (below the 90-min reliableReason floor — the 64-min godsword).
  lines.push(`- ${name}: ${verdict}`
    + (win ? ` · window ${win}` : '')
    + (pressure ? ` · pressure ${pressure}` : '')
    + (reliableReason ? ` · ⚠ ${reliableReason}` : '')
    + (staleLive ? ` · ⚠ ${staleLive}` : ''));
  // 2. CONVICTION-STATE (V4) — the armed note, when applicable.
  if (conviction) lines.push(`    ${conviction}`);
  // 3. Δ-SINCE-LAST (V1) — when a cross-pass signal is informative.
  if (delta) lines.push(`    ${delta}`);
  // 4. STRUCTURAL TRIPWIRE (V2) — support/cut-trigger, when computable.
  if (tripwire) lines.push(`    ${tripwire}`);
  // 4a. RECOVERY-READ (V6) — the ADVISORY recover-vs-drop lean, when the trigger surfaces it.
  if (recovery) lines.push(`    ${recovery}`);
  // 4b. DOMINANT PATH (V2-P4b) — the persistence-gated path read (renderPathLine, lib/item-context.mjs).
  //     Decision SUPPORT alongside the verdict — never an alert input; omitted when no path read.
  if (path) lines.push(`    ${path}`);
  // 4c. MARGIN-REDUCTION BUDGET (PB-COPILOT-1) — how much of the original ask has been given back
  //     across reprices this hold (watchstate.mjs marginBudgetNote). ADVISORY only — never an alert
  //     input; surfaced so a chase doesn't silently surrender its whole edge one small step at a time.
  if (marginBudget) lines.push(`    ${marginBudget}`);
  // 5. SELL/LIST-AT (+ break-even) + fill-progress — GUARANTEED (the standing user rule above).
  const sellBits = [`sell: list @ ${fmtP(listAt)}`, `break-even ${fmtP(breakEven)}`];
  if (fillProgress) sellBits.push(fillProgress);
  lines.push(`    ${sellBits.join(' · ')}`);
  return lines;
}
