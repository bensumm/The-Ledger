/**
 * emit.mjs — the watch.mjs per-HELD-item EMIT CONTRACT (chunk V5). PURE, console-only.
 *
 * V1–V4 grew watch.mjs's per-held note block organically (a verdict note, then a Δ line, a
 * support/cut-trigger line, armed-conviction notes). V5 makes it ONE stable, predictable,
 * consistently-ordered block so a reader (human or LLM) always gets the same fields in the same
 * order. The fields, in contract order:
 *
 *   1. verdict          — the momVerdict action's first sentence (already computed by heldAction)
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
import { fmtP } from '../../js/format.js';

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
  name, verdict, window: win, reliableReason,
  conviction, delta, tripwire, recovery,
  listAt, breakEven, fillProgress,
}) {
  const lines = [];
  // 1. VERDICT — action first sentence, + window context + a reliability flag when the quote is soft.
  lines.push(`- ${name}: ${verdict}`
    + (win ? ` · window ${win}` : '')
    + (reliableReason ? ` · ⚠ ${reliableReason}` : ''));
  // 2. CONVICTION-STATE (V4) — the armed note, when applicable.
  if (conviction) lines.push(`    ${conviction}`);
  // 3. Δ-SINCE-LAST (V1) — when a cross-pass signal is informative.
  if (delta) lines.push(`    ${delta}`);
  // 4. STRUCTURAL TRIPWIRE (V2) — support/cut-trigger, when computable.
  if (tripwire) lines.push(`    ${tripwire}`);
  // 4a. RECOVERY-READ (V6) — the ADVISORY recover-vs-drop lean, when the trigger surfaces it.
  if (recovery) lines.push(`    ${recovery}`);
  // 5. SELL/LIST-AT (+ break-even) + fill-progress — GUARANTEED (the standing user rule above).
  const sellBits = [`sell: list @ ${fmtP(listAt)}`, `break-even ${fmtP(breakEven)}`];
  if (fillProgress) sellBits.push(fillProgress);
  lines.push(`    ${sellBits.join(' · ')}`);
  return lines;
}
