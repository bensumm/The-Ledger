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
import { fmtP, fmt, fmtHourRange } from '../../../js/money-format.js';
import { fmtHoldHorizon, realityClause } from '../../../js/windowread.mjs';   // PLAN-DIURNAL-TIMING DT2 — formatTimedLap's hold-horizon renderer; PLAN-DIURNAL-RECENCY-GUARD — realityClause: the spike-top/stale clause appended to the ASK/BID bits

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
 * LEVELS ALWAYS RENDER; the HOURS are gated (DT4, PLAN-DIURNAL-TRIAGE, 2026-08-10 — Ben's option B).
 * Every row prints BID/ASK levels, timed net/roi, same-hour instant net (both ALWAYS shown — the
 * blowpipe divergence is the point, never averaged away), the ask−bid range, bid/ask level-reach and
 * the base floor trend. What varies is the HOURS, off `lap.reliable` (js/windowread.mjs
 * windowReliability — split-half r ≥ 0.6 on the de-trended 24h shape):
 *   reliable===true  → the dip/peak window spans, the hold horizon, any secondary window, and a
 *                      closing "hours repeat most days".
 *   reliable===false → no hour spans, closing "levels only — no reliable hours".
 *   reliable==null   → could not be measured (needs ~14 days); "levels only — hours unverified".
 *                      Deliberately distinct from `false`: not-checked is not the same claim as
 *                      checked-and-failed, and collapsing them would assert one of them falsely.
 *
 * THIS REPLACED A `lap.clean` BRANCH, and the replacement is the point rather than a refactor.
 * Until 2026-08-10 the render keyed on `hourConcentration`'s `clean` verdict: clean===false printed
 * "range-churn — no timing edge" and dropped the dip/peak hours AND the BID/ASK levels with them.
 * `clean` was then measured against held-out days over the 1h archive and does not discriminate —
 * clean=true (n=60) dip +5.0pp / peak +4.4pp versus clean=false (n=1919) dip +3.6pp / peak +4.7pp, no
 * gap and marginally backwards on the peak side — while the split-half gate separates strongly inside
 * both strata. So the levels were being withheld from ~97% of items on the strength of a statistic
 * that selects nothing. `clean` is still computed and shadow-logged (suggestlog) for calibration, but it
 * no longer decides what ANY surface shows. (This block said it "still drives the app's Trends ★ badge
 * (js/trends.js — NOT re-verdicted here, flagged as follow-up)" until 2026-08-10; DT4c re-verdicted that
 * badge onto `windowReliability` and REMOVED `hourConcentration` from js/trends.js entirely, which made
 * this sentence false the moment it shipped — caught by adversarial review, not by the doc pass that
 * should have swept it.) See DT4-WINDOW-GATE-FINDINGS.md.
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
  // DT4 (PLAN-DIURNAL-TRIAGE, 2026-08-10) — the HOURS are gated, the LEVELS are not. `hoursOk` is the
  // windowReliability tri-state; everything derived from a dip/peak HOUR (the two window spans, the
  // hold horizon, the secondary-window clauses) renders only when it's true, and every LEVEL-derived
  // figure renders unconditionally.
  const reliable = lap.reliable ?? null;
  const hoursOk = reliable === true;
  // PLAN-DIURNAL-RECENCY-GUARD — append the compact spike-top/stale clause (empty string ⇒
  // byte-identical) so a recent-spike-inflated peak/dip level shows its typical alongside.
  // Chunk 2c — reaches transport (2026-08-12) — the BID clause is GATED on `bidBasis`, the ASK clause is
  // not. The BID bit below prints `lap.bid`, which `deriveDiurnalRange` REPRICES to the live instasell
  // when the dip is not below live — while `lap.dipReality` describes `profile.dip.level`. On a repriced
  // row the ungated form labelled the LIVE price with the DIP level's reach/typical, i.e. one number
  // wearing another's conditions: the exact defect this guard exists to prevent, shipped by the guard
  // itself. Rendered against HEAD it printed `BID 1.9k (live, …) ⚠ spike-top ~2.9k` — a "typical" 53%
  // ABOVE the bid it qualified. Chunk 2b fixed this shape on read-window-range's `→ BID` line and on
  // /schedule's Level column (`!r.repriced`) but not here, because this site was believed already covered.
  // The ask needs no gate: `ask` passes through deriveDiurnalRange verbatim.
  // Same conservative-boundary caveat as the producer's (js/windowread.mjs, the askReaches/bidReaches
  // block): the reprice test is inclusive, so the rare row where live sits exactly ON the dip level also
  // loses a clause that would have been correct. Read that comment before "fixing" it here alone.
  const bidRC = lap.bidBasis === 'live' ? ''
    : realityClause(lap.dipReality, { side: 'bid', fmt: fmtFn, style: 'short' });
  const askRC = realityClause(lap.peakReality, { side: 'ask', fmt: fmtFn, style: 'short' });
  bits.push(`BID ${fmtFn(lap.bid)} (${lap.bidBasis}${hoursOk ? `, dip ${win(lap.dipWindow)}` : ''})${bidRC ? ' ' + bidRC : ''}`);
  bits.push(`ASK ${fmtFn(lap.ask)}${hoursOk ? ` (peak ${win(lap.peakWindow)})` : ''}${askRC ? ' ' + askRC : ''}`);
  bits.push(`timed ${netTxt(lap.net)}${roiTxt(lap.roi)}`);
  bits.push(`same-hour ${netTxt(lap.instantNet)}`);
  bits.push(`range ${range}`);
  bits.push(`reach bid ${reachTxt(lap.bidReach)}·ask ${reachTxt(lap.askReach)}`);
  // hold horizon = peak.atHour − dip.atHour, i.e. an HOURS claim — it goes with the windows.
  if (hoursOk) bits.push(`hold ~${fmtHoldHorizon((lap.holdHrs ?? 0) / 24)}`);
  bits.push(`base ${trendTxt(lap.lowTrend)}`);

  // PLAN-MULTI-PEAK-WINDOWS — a SECOND genuinely-prominent window per side (askReaches[1]/bidReaches[1],
  // present only when it cleared the prominence gate) rides as a trailing clause on the SAME joined line —
  // NEVER a second note line (the one-line-per-item house rule). 0/1/2 clauses: bits.join doesn't care how
  // many, so this is just "push one bit per side present." INFORM-only, n≈0 — extends the diurnal note, no
  // new NOTE_KIND / render tier.
  // DT4: a SECOND window is a pure hours claim — if the primary window didn't earn its hours, a
  // secondary one certainly hasn't, so these ride the same gate rather than sneaking hours back in.
  const ar2 = hoursOk && lap.askReaches && lap.askReaches[1];
  const br2 = hoursOk && lap.bidReaches && lap.bidReaches[1];
  // PLAN-DIURNAL-RECENCY-GUARD Chunk 2c — reaches transport (2026-08-12) — the secondary levels carry their reality clause
  // too. These two lines were the last diurnal-LEVEL renders in this file with no clause, and the reason
  // was upstream: `diurnalTimedLap` built the reaches entries with a fixed four-key shape that dropped
  // `reality`, so there was nothing here to render (logged as "still bare" while that was true). The
  // producer now ships it per entry (js/windowread.mjs, `diurnalTimedLap`'s askReaches/bidReaches block —
  // ALL FOUR entries, both primaries and both secondaries), gated on the bid side so a repriced
  // level never wears another level's conditions — read that invariant before touching either end. No
  // gate is needed HERE: a secondary dip is never repriced, and `realityClause` self-suppresses to ''
  // (absent OR clean reality), so a lap without the field renders byte-identically to before.
  const ar2RC = ar2 ? realityClause(ar2.reality, { side: 'ask', fmt: fmtFn, style: 'short' }) : '';
  const br2RC = br2 ? realityClause(br2.reality, { side: 'bid', fmt: fmtFn, style: 'short' }) : '';
  if (ar2) bits.push(`also ASK ${fmtFn(ar2.level)} (peak ${win(ar2.window)}, reach ${reachTxt(ar2.reach)})${ar2RC ? ' ' + ar2RC : ''} — second elevated window (n≈0, inform)`);
  if (br2) bits.push(`also BID ${fmtFn(br2.level)} (dip ${win(br2.window)}, reach ${reachTxt(br2.reach)})${br2RC ? ' ' + br2RC : ''} — second depressed window (n≈0, inform)`);

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
  // DT4 — the verdict on the hours, LAST so it qualifies the whole timing read rather than reading as
  // one more datum. Three states because "measured unreliable" and "not measurable" are different
  // claims (windowReliability): a 14-day history is needed to judge, and ~22% of items can't supply it.
  // "MAY repeat" (Ben, 2026-08-10): the gate correlates SHAPE VECTORS, never the hours themselves — the
  // two parity halves agree on the dip hour only 25.8% of the time. State what was established and let
  // the reader investigate; do not vouch for hours nothing checked. Same wording as softBuyHoursClause.
  bits.push(hoursOk ? 'hours MAY repeat most days'
    : reliable === false ? 'levels only — no reliable hours'
    : 'levels only — hours unverified');

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

/**
 * formatAsymFill(ae, ap, { fmt }) → { bidTxt, askTxt } | null — the shared clause pair for the
 * ◆ asym fill inform line. Both quote-items.mjs and screen-flip-niches.mjs emit that line, so the
 * wording lives HERE (one home) rather than being written twice and drifting apart.
 *
 * WHY THE MEASURED LEVEL IS NAMED SEPARATELY (2026-08-12). asymEstimate's ordering guards set
 * bid = min(quickBuy, deepBid) and ask = max(quickSell, highReachAsk), so a BOUND guard moves the
 * quoted price OFF the quantile level pAsk/pBid were counted at (asymEstimate header §II.2). The old
 * wording — `ask 871 (prints ~12/14d)` — read as "871 printed on 12 of 14 days" when 12/14 was
 * measured at 846. So when a guard binds, name the quoted price and the measured level SEPARATELY.
 *
 * WHY NO EXECUTION VERB. An earlier draft of this clause said "live instabuy — clears now", on the
 * argument that a bound guard means the leg transacts immediately and the count is therefore a floor.
 * That verb was REMOVED after review, for two reasons, and must not come back without new evidence:
 *   (1) quotecore.js's own header (lines ~17-33) records Ben running five real 1-unit round trips —
 *       the model's quickBuy/quickSell came out REVERSED against the true fill order, round-trip loss
 *       3-5x worse than quoted. `latest.high` is the price recent BUYERS paid; selling there is a
 *       passive limit ask, not a click. So "clears now" is an execution claim the repo already
 *       measured as false, and the freshness caveat (QUICK_FRESH_MIN, quickStale.sell) makes it worse
 *       rather than rescuing it — this clause has no staleness input at all.
 *   (2) It was unnecessary. On a bound row the ⊙ reach/placement note one line below ALREADY prints
 *       reach at the guarded price on the same 1h daily-high basis (Dragon boots 2026-08-12: this
 *       clause said 218.5k printed 12/14d; the next line said ask 220.2k reached 11/14d). Whether
 *       pAsk is a floor or an overstatement at the quoted price is UNRESOLVED — so this clause states
 *       only what is measured and leaves the reader the adjacent number, rather than asserting either.
 *
 * PAST TENSE is deliberate (Ben, 2026-08-12): every count is IN-SAMPLE over the days that fitted the
 * quantiles — backward-looking, never a forward fill rate. DENOMINATORS come from asymPair's nAsk/nBid
 * (pAsk's own denominator), NOT nDays: windowStats drops days with no print, so pAsk 10/12 rendered
 * against nDays printed "12/14d" — a tally over days the fraction never scored. fmtP (full gp), never
 * fmt: a guard binding by less than fmt's bucket rendered both prices identically ("ask 5.2k … 5.2k
 * printed 12/14d"), the same resolution bug d37e818 fixed for offer prices. Null-degrades like the
 * rest of this module (no pair / no days ⇒ null ⇒ the caller prints nothing, never a fabricated count).
 */
export function formatAsymFill(ae, ap, { fmt: fmtFn = fmtP } = {}) {
  if (!ae || !ap || ae.bid == null || ae.ask == null) return null;
  const nA = ap.nAsk ?? ap.nDays, nB = ap.nBid ?? ap.nDays;
  if (!nA || !nB) return null;                                  // no denominator ⇒ no honest tally
  const hB = Math.round((ae.pBid ?? 0) * nB), hA = Math.round((ae.pAsk ?? 0) * nA);
  // A guard only gets NAMED when the two prices actually RENDER differently. fmtP is full-gp under
  // 100k but falls back to fmt's 0.1k buckets above it, so a big-ticket guard binding by a few gp
  // would otherwise print "ask 219.9k (= live instabuy, above the 219.9k level …)" — nonsense. When
  // they collapse at display resolution they ARE the same level as shown, so the plain form is honest.
  const px = (price, level, guarded) => {
    const p = fmtFn(price);
    return { p, named: guarded && level != null && fmtFn(level) !== p ? fmtFn(level) : null };
  };
  const b = px(ae.bid, ap.deepBid, ap.deepBid != null && ae.bid < ap.deepBid);
  const a = px(ae.ask, ap.highReachAsk, ap.highReachAsk != null && ae.ask > ap.highReachAsk);
  const bidTxt = b.named
    ? `deep-bid ${b.p} (= live instasell, below the ${b.named} level that touched ${hB}/${nB}d — rest as optionality)`
    : `deep-bid ${b.p} (touched ${hB}/${nB}d — rest as optionality)`;
  const askTxt = a.named
    ? `ask ${a.p} (= live instabuy, above the ${a.named} level that printed ${hA}/${nA}d)`
    : `ask ${a.p} (printed ${hA}/${nA}d)`;
  return { bidTxt, askTxt };
}
