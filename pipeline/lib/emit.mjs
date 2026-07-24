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
import { fmtP, fmt, fmtHourRange } from '../../js/money-format.js';
import { fmtHoldHorizon, realityClause } from '../../js/windowread.mjs';   // PLAN-DIURNAL-TIMING DT2 — formatTimedLap's hold-horizon renderer; PLAN-DIURNAL-RECENCY-GUARD — realityClause: the spike-top/stale clause appended to the ASK/BID bits

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

/**
 * formatTimedLap(lap, { fmt }) — PLAN-DIURNAL-TIMING DT2, the ONE shared renderer for a
 * js/windowread.mjs `diurnalTimedLap` result. This SUPERSEDES the three call sites' own hand-rolled
 * diurnal text (screen's inline block, quote-items' `kind:'diurnal'` push, watch-positions' shadow
 * lines) — same `diurnal` NOTE_KIND/sigil, richer text, ONE call site so the numbers can never drift
 * apart (the plan's §0 "two-homes" warning). Returns a plain TEXT string, or null when there is
 * nothing worth flagging (a `degraded` lap, or one with no priceable bid/ask) — the §7 SOFTENED
 * render guarantee: every row is COMPUTED (the CI-enforced data guarantee lives at the call site /
 * DT4's shadow-log), but only a row with something to say PRINTS a line, so a cold/thin/new item
 * doesn't flood the screen with a content-free "n/a".
 *
 * `lap` is the `diurnalTimedLap` return value, optionally carrying two extra fields the pure fn
 * itself doesn't return (it only takes them as INPUTS): `volDay` (for the liquidity segment) and
 * `buyLimit` (the "caller-relevant size" the §4 tranche-ceiling caveat checks against). Callers
 * that want those segments merge them onto the lap object before calling — e.g.
 * `{ ...diurnalTimedLap(series, { buyLimit, volDay, ... }), volDay, buyLimit }`.
 *
 * Renders TWO shapes off `lap.clean` (hourConcentration's verdict, §3):
 *   clean===true  → the full timed-lap line: BID/ASK + windows, timed net/roi, same-hour instant
 *                   net (both ALWAYS shown — the blowpipe divergence is the point, never averaged
 *                   away), the ask−bid range, bid/ask window-reach, hold horizon, and the base
 *                   floor trend direction.
 *   clean===false → "range-churn — no timing edge": the specific dip/peak HOURS are omitted (the
 *                   whole reason `clean` exists — a scattered per-day trough/peak means those hours
 *                   aren't reliable), but net/instantNet/base still render.
 * A second liquidity/sizing segment (vol/d, dip/peak pool depth, tranche comfort/ceiling) appends
 * when the caller supplied `volDay`; the §4 caveat appends when `buyLimit` exceeds `trancheCeiling`.
 */
export function formatTimedLap(lap, { fmt: fmtFn = fmt } = {}) {
  if (!lap || lap.degraded) return null;              // §7 — a degrade carries nothing to flag by default
  if (lap.bid == null || lap.ask == null) return null; // no priceable pair — nothing to say
  const win = w => (w && w.startH != null && w.endH != null) ? fmtHourRange(w.startH, w.endH) : '?';
  const netTxt = n => (n == null ? 'n/a' : `${n >= 0 ? '+' : ''}${fmtFn(n)}/u`);
  const roiTxt = r => (r == null ? '' : ` (${r.toFixed(1)}%)`);
  const trendTxt = t => (t == null || !Number.isFinite(t)) ? '—' : `${t >= 0 ? '↑' : '↓'}${fmtFn(Math.round(Math.abs(t)))}/d`;
  const reachTxt = r => (r && r.fullN) ? `${r.fullHit}/${r.fullN}` : '–';
  const range = fmtFn(lap.ask - lap.bid);

  const bits = [];
  if (lap.clean === true) {
    // PLAN-DIURNAL-RECENCY-GUARD — append the compact spike-top/stale clause (empty string ⇒
    // byte-identical) so a recent-spike-inflated peak/dip level shows its typical alongside.
    const bidRC = realityClause(lap.dipReality, { side: 'bid', fmt: fmtFn, style: 'short' });
    const askRC = realityClause(lap.peakReality, { side: 'ask', fmt: fmtFn, style: 'short' });
    bits.push(`BID ${fmtFn(lap.bid)} (${lap.bidBasis}, dip ${win(lap.dipWindow)})${bidRC ? ' ' + bidRC : ''}`);
    bits.push(`ASK ${fmtFn(lap.ask)} (peak ${win(lap.peakWindow)})${askRC ? ' ' + askRC : ''}`);
    bits.push(`timed ${netTxt(lap.net)}${roiTxt(lap.roi)}`);
    bits.push(`same-hour ${netTxt(lap.instantNet)}`);
    bits.push(`range ${range}`);
    bits.push(`reach bid ${reachTxt(lap.bidReach)}·ask ${reachTxt(lap.askReach)}`);
    bits.push(`hold ~${fmtHoldHorizon((lap.holdHrs ?? 0) / 24)}`);
    bits.push(`base ${trendTxt(lap.lowTrend)}`);
  } else {
    bits.push('range-churn — no timing edge');
    bits.push(`range ${range}`);
    bits.push(`timed ${netTxt(lap.net)}`);
    bits.push(`same-hour ${netTxt(lap.instantNet)}`);
    bits.push(`base ${trendTxt(lap.lowTrend)}`);
  }

  // PLAN-MULTI-PEAK-WINDOWS — a SECOND genuinely-prominent window per side (askReaches[1]/bidReaches[1],
  // present only when it cleared the prominence gate) rides as a trailing clause on the SAME joined line —
  // NEVER a second note line (the one-line-per-item house rule). 0/1/2 clauses: bits.join doesn't care how
  // many, so this is just "push one bit per side present." INFORM-only, n≈0 — extends the diurnal note, no
  // new NOTE_KIND / render tier.
  const ar2 = lap.askReaches && lap.askReaches[1];
  const br2 = lap.bidReaches && lap.bidReaches[1];
  if (ar2) bits.push(`also ASK ${fmtFn(ar2.level)} (peak ${win(ar2.window)}, reach ${reachTxt(ar2.reach)}) — second elevated window (n≈0, inform)`);
  if (br2) bits.push(`also BID ${fmtFn(br2.level)} (dip ${win(br2.window)}, reach ${reachTxt(br2.reach)}) — second depressed window (n≈0, inform)`);

  // liquidity/sizing segment — only when the caller merged volDay onto the lap (see doc comment).
  if (lap.volDay != null) {
    const sizeBits = [`${fmtFn(lap.volDay)}/d`];
    if (lap.dipPool != null) sizeBits.push(`dip-pool ~${fmtFn(lap.dipPool)}`);
    if (lap.peakPool != null) sizeBits.push(`peak-pool ~${fmtFn(lap.peakPool)}`);
    if (lap.trancheComfort != null) sizeBits.push(`tranche ~${fmtFn(lap.trancheComfort)} comfortable`);
    if (lap.trancheCeiling != null) sizeBits.push(`~${fmtFn(lap.trancheCeiling)} ceiling`);
    bits.push(sizeBits.join(' · '));
  }
  // §4 caveat — a caller-relevant size (buyLimit — the natural per-window accumulation unit) sized
  // past the ceiling means expect a materially worse realized net than quoted (the n≈6 reach-relief
  // finding, BORROWED from a different feature's calibration, not validated for diurnal tranches).
  if (lap.buyLimit != null && lap.trancheCeiling != null && lap.buyLimit > lap.trancheCeiling) {
    bits.push(`⚠ buy limit ${fmtFn(lap.buyLimit)} exceeds tranche ceiling — expect a worse realized net than quoted at this size (n≈6 reach-relief, not validated for diurnal)`);
  }

  return bits.join(' · ');
}

/**
 * formatBasePosition(bp) → "base pXX of the <N>d range · <label>" or null — PLAN-DIURNAL-TIMING DT6.
 * PURE formatter over an already-computed `basePosition()` result (js/termstructure.mjs). Mirrors
 * formatTimedLap's split: the caller computes once (off the SAME `termStructure(...)` already in
 * hand for floorValidator), this only renders text — never recomputed, never a second structure read.
 * `bp == null` (degraded/thin/unknown-shape) → null, so a cold/new item prints nothing (never a fake
 * percentile) — same §7 "compute always, print only when there's something to say" contract DT1-DT5
 * use for the diurnal note.
 */
export function formatBasePosition(bp) {
  if (!bp) return null;
  return `base p${bp.pct} of the ${bp.days}d range · ${bp.label}`;
}
