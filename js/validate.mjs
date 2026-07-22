/**
 * validate.mjs — the Pipeline-v2 VALIDATOR REGISTRY (chunk P2). Lives in js/ so it is BOTH
 * node-importable (every pipeline surface) AND future app-importable, exactly like js/quotecore.js
 * and js/windowread.mjs.
 *
 * WHAT A VALIDATOR IS. A validator is a PURE function `(ctx) → { key, status, reason, evidence }`
 * where `status ∈ 'pass' | 'caution' | 'reject'`. It reads an already-built ItemContext (the P0
 * chain, pipeline/lib/item-context.mjs) and answers ONE question about a candidate — "is this level
 * reachable?", "is this buy near a durable floor?" (P3), etc. Validators run on EVERY surface so a
 * screen, a per-item quote and a positions review can never disagree on the same gate.
 *
 * PURITY / NO-FETCH / NEVER-THROW (the load-bearing contract — the momVerdict optional-degradation
 * precedent):
 *   - A validator NEVER fetches and NEVER touches fs. The CALLER loads the data (the series, the
 *     archive slice) and feeds it through ctx; a validator only computes over what it is handed.
 *     Pure math over an already-fetched series (windowStats) is allowed — it does no IO.
 *   - MISSING INPUTS DEGRADE TO `pass` with a `no-data` evidence note. A validator NEVER throws and
 *     NEVER rejects on the ABSENCE of data — only affirmative evidence (a level the sample says is
 *     rarely reached) downgrades a status. runValidators additionally wraps each call in a try/catch
 *     that degrades a thrown validator to `pass` (belt-and-suspenders; a validator should not throw).
 *
 * REJECT SEMANTICS (default, Ben-vetoable — enforced by the SURFACES, not here):
 *   - Screens DROP `reject` rows (counted in `--stats` + a `rejected: N (top reasons)` footer) and
 *     FLAG `caution` (a note, the row still shows).
 *   - Explicit asks / held lots / watchlist rows are NEVER hidden — the full result prints with the
 *     validator flag as a note.
 *
 * THRESHOLDS ARE PLACEHOLDERS (process rule 4). Every cutoff below is named + flagged; none is
 * validated. reachValidator REUSES js/windowread.mjs's existing quantile/recency logic and constants
 * (RECENT_NIGHTS, recencySplit's staleOptimistic) rather than inventing parallel ones; floorValidator
 * REUSES js/termstructure.mjs's term-structure math (the durable floor + typical fluctuation) rather
 * than re-deriving it — that module is the ONE home for the multi-week structure read.
 */
import { windowStats, touchedDays, reachedDays, recencySplit, RECENT_NIGHTS } from './windowread.mjs';
import { termStructure } from './termstructure.mjs';
import { recentDirection, DIR_LOOKBACK_H } from './quotecore.js';
import { tax, netMargin } from './money-math.js';

// --- status algebra ---------------------------------------------------------------------------
const SEVERITY = { pass: 0, caution: 1, reject: 2 };
/* the more severe of two statuses (reject > caution > pass) — the worst gate wins on a surface. */
export function worseOf(a, b) { return (SEVERITY[b] ?? 0) > (SEVERITY[a] ?? 0) ? b : a; }
/* one severity step up: the RC1 stale-flag bump — pass→caution, caution→reject, reject stays. */
function bumpSeverity(status) { return status === 'pass' ? 'caution' : 'reject'; }

const round2 = x => (x == null ? null : Math.round(x * 100) / 100);
/* a degrade-to-pass result with a no-data-shaped evidence note (never a reject on missing input). */
function degrade(key, note) { return { key, status: 'pass', reason: note, evidence: { note } }; }

// --- reachValidator ---------------------------------------------------------------------------
// PLACEHOLDER thresholds (rule 4 — none validated; the study that would tune them is F1/P6):
export const REACH_WINDOW_HOURS = 8;    // default coming-hours window scored (matches watch-positions.mjs's line)
export const REACH_NIGHTS = 14;         // same-window nights of history scored (the ~14d small sample)
export const REACH_MIN_DAYS = 5;        // fewer scored nights than this ⇒ too thin to reject → degrade
export const REACH_CAUTION_FRAC = 0.5;  // reached on < this fraction of scored nights ⇒ caution
export const REACH_REJECT_FRAC = 0;     // reached on ≤ this fraction ⇒ reject (DEFINITIONAL out-of-range,
                                        //   not a tuned knob: 0 = never printed in the whole sample)

/**
 * reachValidator(ctx) — wraps js/windowread.mjs's reach/touch scoring + the RC1 recency split into a
 * validator. It answers: does the last ~REACH_NIGHTS same-window nights say this candidate bid/ask is
 * actually reachable? A rarely-reached level → caution; a never-reached level → reject; the RC1
 * stale-optimistic flag (the full count concentrated in an OLDER, higher/cheaper price regime) bumps
 * severity one step (pass→caution, caution→reject), because a reach the recent nights don't confirm
 * is a mirage — reusing recencySplit's existing staleOptimistic semantics, no new threshold.
 *
 * READS (all from the intraday namespace — the P0 chain's Tier-2 stage, its declared extension point):
 *   ctx.intraday.ts1h    the 1h /timeseries the window read buckets (CALLER-fetched; null → degrade)
 *   ctx.intraday.reach   the candidate to score: { side:'ask'|'bid', level, windowHours?, nights?, now? }
 *                        (absent → degrade; the surface sets it from the level it is about to suggest)
 *
 * DEGRADES to pass (never rejects on absence): no ts1h, no candidate, no window history, or a sample
 * thinner than REACH_MIN_DAYS nights.
 */
export function reachValidator(ctx) {
  const key = 'reach';
  const intraday = ctx && ctx.intraday;
  const series = intraday && intraday.ts1h;
  const cand = intraday && intraday.reach;
  if (!series || !series.length) return degrade(key, 'no-1h-series');
  if (!cand || cand.level == null || (cand.side !== 'ask' && cand.side !== 'bid')) return degrade(key, 'no-candidate');

  const side = cand.side, level = cand.level;
  const now = cand.now || new Date();
  const windowHours = cand.windowHours != null ? cand.windowHours : REACH_WINDOW_HOURS;
  const nights = cand.nights != null ? cand.nights : REACH_NIGHTS;
  const wStart = now.getHours(), wEnd = (wStart + windowHours) % 24;
  const stats = windowStats(series, { nights, wStart, wEnd, now });
  if (!stats) return degrade(key, 'no-window-history');

  const { days, lows, his } = stats;
  const vals = side === 'bid' ? lows : his;
  const n = vals.length;
  const hit = side === 'bid' ? touchedDays(lows, level) : reachedDays(his, level);
  const frac = n ? hit / n : 0;
  const rc = recencySplit(days, side, level, RECENT_NIGHTS);
  const evidence = {
    side, level, windowHours, wStart, wEnd,
    hit, days: n, frac: round2(frac),
    recentHit: rc.recentHit, recentDays: rc.recentDays, recentFrac: round2(rc.recentFrac),
    staleOptimistic: rc.staleOptimistic,
  };

  // too little history behind the level → never reject on a thin sample (the degrade rule).
  if (n < REACH_MIN_DAYS) return { key, status: 'pass', reason: 'thin-sample', evidence: { ...evidence, note: 'thin-sample' } };

  // base status off the full-window reach fraction, then the RC1 stale bump.
  let status = frac <= REACH_REJECT_FRAC ? 'reject'
             : frac < REACH_CAUTION_FRAC ? 'caution'
             : 'pass';
  if (rc.staleOptimistic) status = bumpSeverity(status);

  const verb = side === 'bid' ? 'touched' : 'reached';
  const staleTail = rc.staleOptimistic ? ` (recent ${rc.recentHit}/${rc.recentDays} — stale-optimistic)` : '';
  const reason = status === 'pass'
    ? `${side} ${level} ${verb} ${hit}/${n}d`
    : `${side} ${level} ${verb} only ${hit}/${n}d${staleTail}`;
  return { key, status, reason, evidence };
}

// --- floorValidator ---------------------------------------------------------------------------
// PLACEHOLDER thresholds (rule 4 — none validated; the study that would tune them is F1/P6). The
// floor + typical-swing math itself lives in js/termstructure.mjs (its own PLACEHOLDERs); these two
// govern how far above the durable floor a BUY is allowed to sit before we caution/reject it.
export const FLOOR_CAUTION_RANGES = 1.0;   // buy > this many typical swings above the durable floor ⇒ caution
export const FLOOR_REJECT_RANGES = 2.0;    // buy > this many typical swings above the durable floor ⇒ reject
// R3 (PLAN-SIGNAL-RECENCY): a falling recentTrend TIGHTENS the level check (additive-only — never relaxes).
// A `pass` only escalates to caution once the bid is already within this fraction of the caution line
// (borderline-elevated); a clean low pass with real headroom is NEVER touched by the trend alone. PLACEHOLDER.
export const FLOOR_TREND_BORDERLINE_FRAC = 0.75;
//   VALIDATE (F1/P6): the walk-forward loss rate of buying at N typical-swings above the durable
//   floor vs the base rate — the point at which "elevated above support" actually predicts a bleed.

/**
 * floorValidator(ctx) — BUY-SIDE ONLY. Answers: does this buy sit NEAR a durable multi-week floor, or
 * is the bid parked well ABOVE where the 14/28d structure says support durably prints (the decay-knife
 * shape — you'd be buying an elevated price mid-collapse, not a real dip)? It measures the buy level's
 * distance above the durable floor in units of the item's TYPICAL fluctuation (IQR): within ~one normal
 * swing of the floor → pass; several swings above → reject.
 *
 * BUY-SIDE DISCIPLINE (load-bearing — the spec's "must NOT reject/flag held lots' sell decisions"):
 *   - A HELD lot (ctx.position.held) is a SELL decision → this validator DEGRADES to pass immediately.
 *     Held/asked/watchlist rows are never hidden anyway (the surface's job), but floorValidator does not
 *     even form an opinion on them — it only judges a would-be BUY.
 *
 * READS:
 *   ctx.history.termStructure   the js/termstructure.mjs structure (CALLER-fed; { hasData:false } or
 *                               absent → degrade). floor + typicalSwing come from here.
 *   ctx.floor.level             the buy candidate to score (the bid we'd place). Falls back to
 *                               ctx.market.row.optBuy (the patient band-floor bid) when not set.
 *
 * DEGRADES to pass (never rejects on absence — the archive only began accruing 2026-07-08, so a null /
 * thin structure is the COMMON early case): held lot, no term structure, structure with no data, no
 * durable floor (too few multi-week points), no typical swing, or no buy candidate.
 */
export function floorValidator(ctx) {
  const key = 'floor';
  const pos = ctx && ctx.position;
  if (pos && pos.held) return degrade(key, 'held-lot-sell-side');   // BUY-side only — never judge a held sell

  const ts = ctx && ctx.history && ctx.history.termStructure;
  if (!ts || ts.hasData === false) return degrade(key, 'no-term-structure');
  const floor = ts.floor, swing = ts.typicalSwing;
  if (floor == null) return degrade(key, 'no-durable-floor');       // too few multi-week points to assert a floor
  if (!(swing > 0)) return degrade(key, 'no-typical-swing');

  const row = ctx && ctx.market && ctx.market.row;
  const level = (ctx && ctx.floor && ctx.floor.level != null) ? ctx.floor.level
              : (row && row.optBuy != null ? row.optBuy : null);
  if (level == null) return degrade(key, 'no-buy-candidate');

  const ranges = (level - floor) / swing;   // how many typical swings above the durable floor the bid sits
  // R3: the durable floor is recency-BLIND (a q15 over the whole lookback). recentTrend adds "is the level
  // FALLING right now" as a SECOND, additive-only input: it can TIGHTEN an already-elevated buy (elevated
  // INTO a decline = a knife, not a dip) but never relaxes, and never overrides a clean low pass with headroom.
  const trendDir = ts.recentTrend ? ts.recentTrend.dir : null;
  const evidence = {
    level, floor: round2(floor), typicalSwing: round2(swing),
    floorLookback: ts.floorLookback, ranges: round2(ranges), current: ts.current, recentTrend: trendDir,
  };
  let status = ranges > FLOOR_REJECT_RANGES ? 'reject'
             : ranges > FLOOR_CAUTION_RANGES ? 'caution'
             : 'pass';
  let trendNote = '';
  if (trendDir === 'falling') {
    if (status === 'caution') { status = 'reject'; trendNote = ' + recent trend falling (elevated INTO a decline — a knife)'; }
    else if (status === 'pass' && ranges >= FLOOR_CAUTION_RANGES * FLOOR_TREND_BORDERLINE_FRAC) { status = 'caution'; trendNote = ' + recent trend falling (borderline-elevated & softening)'; }
  }
  const reason = (status === 'pass'
    ? `buy ${level} near ${ts.floorLookback}d floor ${Math.round(floor)} (${round2(ranges)}× swing)`
    : `buy ${level} is ${round2(ranges)}× typical swing above the ${ts.floorLookback}d floor ${Math.round(floor)} — not near durable support`) + trendNote;
  return { key, status, reason, evidence };
}

// --- trajectoryValidator ----------------------------------------------------------------------
// The SHAPE check (the encoded windowrange trajectory read) — DISTINCT from floorValidator's LEVEL
// check. floorValidator asks "is the buy elevated ABOVE durable support?"; this asks "what SHAPE is the
// recent multi-week path?" — a knife still stepping down (Nightmare staff), an OSCILLATING faller you buy
// at the local min (Hydra leather), a flat base at the floor (Berserker ring), or bought high. The
// classification math lives in js/termstructure.mjs (classifyTrajectory, attached as ts.trajectory);
// this validator is only the buy-side POLICY over the shape. Ben 2026-07-09: it runs on EVERY thesis
// (the analysis is universally useful for entry timing) but its GATE-vs-INFORM action is per-thesis —
// on scalp it INFORMS (scalp accepts a falling wide band by thesis), on band/value it can gate. Started
// INFORM-ONLY everywhere (rule 4 — n≈0) until the suggestions accrual gives the knife/oscillating split
// a track record; the ledger logs the WOULD-HAVE status so that record accrues (see leanValidators).
export function trajectoryValidator(ctx) {
  const key = 'trajectory';
  const pos = ctx && ctx.position;
  if (pos && pos.held) return degrade(key, 'held-lot-sell-side');   // BUY-side only — a held lot is a sell decision
  const ts = ctx && ctx.history && ctx.history.termStructure;
  const traj = ts && ts.trajectory;
  if (!traj || !traj.shape || traj.shape === 'unknown') return degrade(key, 'no-trajectory');
  const shape = traj.shape, ev = traj.evidence || {};
  const status = shape === 'knife' ? 'reject' : shape === 'elevated' ? 'caution' : 'pass';
  const declTail = ev.declPct != null ? `${(ev.declPct * 100).toFixed(1)}% below the 7d median` : 'declining';
  // reason omits a leading "trajectory" — the surface prefixes the validator key ("trajectory <reason>").
  const reason =
    shape === 'knife'    ? `knife — ${ev.spiked ? 'spike unwinding, ' : ''}lows stepping down (${declTail}) — not a dip` :
    shape === 'elevated' ? `elevated — current in the top of the 14d range — bought high, not a dip` :
    shape === 'oscillating' ? `oscillating (${ev.reversals} reversals) — buyable at the local min` :
    shape === 'based'    ? `based — flat near the durable floor (value-low)` :
    shape === 'rising'   ? `rising — recovering off the recent low` :
                           `${shape}`;
  return { key, status, reason, evidence: { shape, ...ev } };
}

// --- valueAmplitudeValidator ------------------------------------------------------------------
// Value's "intraday swings against the recent WEEK" check (Ben 2026-07-09). Value buys a good ENTRY
// TIME near a recent-week low and holds for the cycle — so the question is: is there a real week cycle
// to harvest AND is live near its low right now? Reads the 7d lookback of the SAME term structure
// floorValidator/trajectoryValidator read (no new fetch). Complementary to valuescreen.mjs's valueGate
// (that is the MULTI-WEEK 14/28d cycle gate; this is the recent-WEEK amplitude + proximity read). BUY-side.
export const VALAMP_MIN_PCT  = 0.04;   // PLACEHOLDER (rule 4): after-tax week amplitude below this ⇒ no cycle to harvest → reject
export const VALAMP_NEAR_LOW = 0.40;   // PLACEHOLDER: live above this fraction up the week range ⇒ not at the low yet → caution (wait for the dip)
// BAR E's LOW-SIDE TWIN (Ben 2026-07-10): the week edges are the ROBUST q15/q85 of the 7d daily mids, not
// the raw min/max — so a LONE recent dip/spike print can't set the week floor/ceiling and fake proximity
// (the Extreme-energy 1,447 artifact: one thin dip dragged the raw week low far below where the item
// actually trades, making "70% up a phantom-wide range → wait" contradict the durable-range BUY-NOW tier).
// Dense side (≥ VALAMP_EDGE_MIN_SAMPLE daily mids) → the quantile edge; sparser than that ⇒ keep the raw
// extremum (a quantile over a handful of points is unreliable) — the same sample-gated fallback discipline
// as robustBand's BAND_EDGE_MIN_SAMPLE. The q15/q85 come from js/termstructure.mjs's lookbackStat (the ONE
// home for the term-structure edge math + the FLOOR_QUANTILE/CEIL_QUANTILE the value tier also uses).
export const VALAMP_EDGE_MIN_SAMPLE = 6;   // PLACEHOLDER (rule 4): min 7d daily mids to trust the q15/q85 edge (mirrors FLOOR_MIN_POINTS)
//   VALIDATE (F1/P6): the week amplitude that actually predicts a profitable timed entry, and the
//   proximity band within which "near the week low" fills at a good price rather than mid-range.
const afterTax = p => p - tax(p);

export function valueAmplitudeValidator(ctx) {
  const key = 'value-amplitude';
  const pos = ctx && ctx.position;
  if (pos && pos.held) return degrade(key, 'held-lot-sell-side');
  const ts = ctx && ctx.history && ctx.history.termStructure;
  const lk7 = ts && ts.lookbacks && ts.lookbacks[7];
  if (!lk7 || lk7.low == null || lk7.high == null || !(lk7.high > lk7.low)) return degrade(key, 'no-week-range');
  // robust edges when the 7d slice is dense enough; else the raw extremum (Bar E's sparse-side fallback).
  const robust = lk7.n != null && lk7.n >= VALAMP_EDGE_MIN_SAMPLE
    && lk7.qlow != null && lk7.qhigh != null && lk7.qhigh > lk7.qlow;
  const weekLow = robust ? lk7.qlow : lk7.low;
  const weekHigh = robust ? lk7.qhigh : lk7.high;
  const cur = ts.current;
  const proximity = cur != null ? (cur - weekLow) / (weekHigh - weekLow) : null;   // 0 = at the week low, 1 = at the week high
  const ampPct = (afterTax(weekHigh) - weekLow) / weekLow;
  const evidence = { weekLow, weekHigh, current: cur, proximity: round2(proximity), ampPct: round2(ampPct), robustEdges: robust };
  if (!(ampPct >= VALAMP_MIN_PCT))
    return { key, status: 'reject', reason: `week after-tax amplitude ${(ampPct * 100).toFixed(1)}% < ${VALAMP_MIN_PCT * 100}% — no cycle to harvest`, evidence };
  if (proximity != null && proximity > VALAMP_NEAR_LOW)
    return { key, status: 'caution', reason: `${(ampPct * 100).toFixed(1)}% week cycle but live is ${Math.round(proximity * 100)}% up the week range — wait for the dip`, evidence };
  return { key, status: 'pass', reason: `at the week low (${Math.round((proximity ?? 0) * 100)}% up range) with a ${(ampPct * 100).toFixed(1)}% after-tax week cycle`, evidence };
}

// --- limitValidator ---------------------------------------------------------------------------
// LM1 (Ben 2026-07-09: "limits.mjs ... a part of every flow that suggests items ie we can flag as
// profitable but disqualify on limits and state when the limit should reset"). BUY-SIDE. Reads a
// caller-supplied 4h buy-limit WINDOW (pipeline/lib/limits.mjs `limitWindow` result) and disqualifies
// a suggested buy that has NO room left in the rolling 4h window — a profitable item Ben has already
// bought his limit of this window is not a buy NOW, it's a buy after the limit frees.
export const LIMIT_CAUTION_FRAC = 0.25;   // PLACEHOLDER (rule 4): remaining < this fraction of the limit ⇒ caution
//   VALIDATE: what fraction-remaining actually predicts "won't fill a full lap before the reset" — a
//   sizing heuristic, not yet a measured one.

// LOCAL wall-clock HH:MM for a unix-SECONDS instant (repo rule: rendered times are local). Kept tiny +
// local so validate.mjs stays DOM-free / node- AND app-importable.
function localHHMM(tsSec) {
  if (tsSec == null) return '—';
  return new Date(tsSec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * limitValidator(ctx) — BUY-SIDE. Answers: does this suggested buy have room left in the item's rolling
 * 4h GE buy limit? Reads ctx.limits.window (a pipeline/lib/limits.mjs `limitWindow` result the PIPELINE
 * callers supply — screen/quote build it from fills.json; the browser app supplies nothing).
 *   remaining === 0                         → REJECT  (buy limit exhausted — states when it next frees)
 *   0 < remaining < LIMIT_CAUTION_FRAC×limit → CAUTION (nearly exhausted — same numbers + reset time)
 *   otherwise                                → pass
 * DEGRADES to pass (never rejects on absence — the P2/P3 precedent): no limits stage (app / a surface
 * that didn't build one), or a null limit (UNKNOWN — never treat unknown as "no limit").
 */
export function limitValidator(ctx) {
  const key = 'limit';
  const w = ctx && ctx.limits && ctx.limits.window;
  if (!w) return degrade(key, 'no-limit-window');
  if (w.limit == null || w.remaining == null) return degrade(key, 'null-limit-unknown');
  const { limit, boughtInWindow, remaining, nextFreeAt } = w;
  const evidence = { limit, boughtInWindow, remaining, nextFreeAt };
  const frees = nextFreeAt != null ? ` — next frees ~${localHHMM(nextFreeAt)}` : '';
  if (remaining === 0)
    return { key, status: 'reject', reason: `buy limit exhausted (bought ${boughtInWindow}/${limit} this 4h window)${frees}`, evidence };
  if (remaining < limit * LIMIT_CAUTION_FRAC)
    return { key, status: 'caution', reason: `buy limit nearly exhausted (bought ${boughtInWindow}/${limit} this 4h window, ${remaining} left)${frees}`, evidence };
  return { key, status: 'pass', reason: `buy limit ok (bought ${boughtInWindow}/${limit} this 4h window, ${remaining} left)`, evidence };
}

// --- dipPostureValidator ----------------------------------------------------------------------
// DP1 (2026-07-10) — dip DIRECTION, not just depth. BUY-SIDE · INFORM-ONLY · NEVER-REJECT.
// The ⬇DIP probe (pipeline/modules/dip.mjs) says a row is a dip (live instasell under the 24h avg
// low = DEPTH). This validator adds the missing question: is that dip still FALLING (a resting bid
// fills as price drops to it) or has it already REVERTED (bounced off its low and run away — a
// resting bid MISSES; cross the spread now or pass)? The direction read + the mechanic + the two
// n=2 anchor incidents (Searing page, Abyssal bludgeon) live in the recentDirection header in
// js/quotecore.js — this validator is only the buy-side POLICY over that read.
//
// NEVER-REJECT INVARIANT (load-bearing): by construction this validator returns ONLY pass or
// caution — it can NEVER emit 'reject', so it can NEVER drop a row on any surface (quote runs the
// full registry in gate mode; a caution there is a printed note, not a drop). INFORM-ONLY discipline:
// it annotates the ENTRY POSTURE; it never auto-changes a recommended price (no graduation to
// auto-repricing — a reverting-dip note says "cross or pass", it does not re-price the bid for you).
export const DIPPOST_MIN_PCT = 1.0;   // PLACEHOLDER (n=2): dip DEPTH % below the 24h avg low to speak on.
//   TWIN CONSTANT — deliberately mirrors pipeline/modules/dip.mjs's DIP_MIN_PCT (js/ cannot import
//   pipeline/, so this is REDEFINED here, not shared). Keep the two in sync: if the ⬇DIP probe's depth
//   threshold moves, move this too. VALIDATE (retro-join, n=2): the depth+bounce combination that
//   actually predicts a resting bid missing vs filling.
export function dipPostureValidator(ctx) {
  const key = 'dip-posture';
  const pos = ctx && ctx.position;
  if (pos && pos.held) return degrade(key, 'held-lot-sell-side');   // BUY-side only (mirrors floor/trajectory)
  const row = ctx && ctx.market && ctx.market.row;
  if (!row || row.quickBuy == null) return degrade(key, 'no-quote');
  const intra = ctx && ctx.intraday;
  const avgLow24 = intra && intra.avgLow24;
  if (avgLow24 == null) return degrade(key, 'no-24h-avg');
  const ts5m = intra && intra.ts5m;
  if (!ts5m) return degrade(key, 'no-5m-series');
  // DEPTH gate — the validator only speaks on a dip row (mirrors the ⬇DIP probe's DIP_MIN_PCT).
  const dipPct = (avgLow24 - row.quickBuy) / avgLow24 * 100;
  if (!(dipPct >= DIPPOST_MIN_PCT)) return degrade(key, 'no-dip');
  const rd = recentDirection(ts5m);
  if (!rd) return degrade(key, 'thin-5m-series');
  const { dir, minLow, minAgeMin, bouncePct } = rd;
  const quickBuy = row.quickBuy, quickSell = row.quickSell;
  const evidence = {
    dir, minLow, minAgeMin: round2(minAgeMin), bouncePct: round2(bouncePct),
    quickBuy, quickSell, crossNet: null, avgLow24, dipPct: round2(dipPct),
  };
  if (dir === 'falling')
    return { key, status: 'pass', reason: `dip still falling — a resting bid @ ${quickBuy.toLocaleString()} fills as it drops`, evidence };
  if (dir === 'flat')
    return { key, status: 'pass', reason: `dip flat — resting bid @ ${quickBuy.toLocaleString()} viable`, evidence };
  // dir === 'reverting' — the bid likely misses; it's a cross-or-pass call. Score the cross: buy at
  // the live instabuy (quickSell) and patiently sell the 2h top (optSell), after tax (bond-aware).
  const bopt = row.bond ? { bond: true, guide: row.guide } : undefined;
  const crossNet = (quickSell != null && row.optSell != null) ? netMargin(quickSell, row.optSell, bopt) : null;
  evidence.crossNet = crossNet;
  const bounceTxt = `+${(bouncePct * 100).toFixed(1)}% off the ${DIR_LOOKBACK_H}h low ${minLow.toLocaleString()} ~${Math.round(minAgeMin)}min ago`;
  const crossTxt = (crossNet != null && crossNet > 0 && row.optSell != null)
    ? `cross @ ${quickSell.toLocaleString()} (net ~${Math.round(crossNet).toLocaleString()}/u after tax to ${row.optSell.toLocaleString()}) or pass`
    : `cross unprofitable at the patient ask — pass`;
  // reason omits a leading ⚠ — the surface prefixes it (the `⚠ ${key}: ${reason}` convention).
  return {
    key, status: 'caution',
    reason: `reverting dip — bounced ${bounceTxt}; a resting bid @ ${quickBuy.toLocaleString()} likely misses — ${crossTxt}`,
    evidence,
  };
}

// --- the registry -----------------------------------------------------------------------------
// keyed so a declarative strategy spec (P4c) can name the validators it runs by key. REGISTRY_ORDER
// is the display/priority order (worst-first is computed via worstStatus, not the array order).
export const VALIDATORS = {
  reach: reachValidator, floor: floorValidator, trajectory: trajectoryValidator,
  'value-amplitude': valueAmplitudeValidator, limit: limitValidator, 'dip-posture': dipPostureValidator,
};
export const REGISTRY_ORDER = ['reach', 'floor', 'trajectory', 'value-amplitude', 'limit', 'dip-posture'];

/* GATE vs INFORM (Ben 2026-07-09). A validator's COMPUTATION is thesis-agnostic (the swing/local-min/
   knife/reach analysis is useful to every buy); what differs per thesis is the ACTION. A spec entry is
   either a bare key string (defaults to gate mode) or an object { key, mode:'gate'|'inform', window }:
     gate   — the validator's natural status stands (a caution/reject downgrades/drops the row).
     inform — the finding is COMPUTED and annotated but NEVER downgrades: status is clamped to pass and
              the natural verdict is preserved as `gatedStatus` (so a surface can still SHOW the note and
              the ledger can log the would-have status — the track record that later justifies a gate).
     window — reach-only: the thesis's reach horizon { windowHours, nights }, merged into the reach
              candidate before scoring (a band/scalp 8h flip window vs value's full-day week+ timing read).
   This is the noise reconciliation: inform-mode validators add intelligence everywhere with ZERO
   spurious drops; only a thesis that explicitly gates on a key can have that key hide a row. */
function normalizePlan(only, specs) {
  if (specs && specs.length) return specs.map(s => (typeof s === 'string' ? { key: s, mode: 'gate' } : { mode: 'gate', ...s }));
  return (only || REGISTRY_ORDER).map(k => ({ key: k, mode: 'gate' }));
}

/* runValidators(ctx, {only|specs}) — run the registry (or a per-thesis plan) over one ctx. `specs` is
   the P4c strategy's validator plan ({key,mode,window}); `only` is the legacy string-subset (all gate).
   Each call is try/caught so a throwing validator degrades to pass. Returns { key, status, reason,
   evidence, mode, gatedStatus? } — gatedStatus is set only when inform mode suppressed a non-pass. */
export function runValidators(ctx, { only = null, specs = null } = {}) {
  const plan = normalizePlan(only, specs);
  const out = [];
  for (const p of plan) {
    const v = VALIDATORS[p.key];
    if (!v) continue;
    // reach-window injection: merge the thesis's horizon into the reach candidate for this call only.
    let useCtx = ctx;
    if (p.key === 'reach' && p.window && ctx && ctx.intraday && ctx.intraday.reach)
      useCtx = { ...ctx, intraday: { ...ctx.intraday, reach: { ...ctx.intraday.reach, ...p.window } } };
    let res;
    try { res = v(useCtx); }
    catch (err) { res = { key: p.key, status: 'pass', reason: 'validator-error', evidence: { note: String((err && err.message) || err) } }; }
    const mode = p.mode === 'inform' ? 'inform' : 'gate';
    if (mode === 'inform' && res.status !== 'pass')
      res = { ...res, status: 'pass', gatedStatus: res.status, mode };   // clamp to pass; keep the would-have verdict
    else
      res = { ...res, mode };
    out.push(res);
  }
  return out;
}

/* informFlags(results) — the inform-mode findings that WOULD have gated (status clamped to pass but a
   gatedStatus recorded). A surface shows these as decision-support notes; they never drop a row. */
export function informFlags(results) { return (results || []).filter(r => r.mode === 'inform' && r.gatedStatus); }

/* worstStatus(results) — the most severe status across a row's validator results. */
export function worstStatus(results) {
  let s = 'pass';
  for (const r of results || []) s = worseOf(s, r.status);
  return s;
}

/* flags(results) — the non-pass results only (what a surface annotates / drops on). */
export function flags(results) { return (results || []).filter(r => r.status !== 'pass'); }

/* leanValidators(results) — the compact list for the suggestions ledger (YS2 lean-include: returns
   undefined when nothing fired, so a clean row's logged shape is unchanged). Includes both GATE flags
   (status !== pass) AND INFORM findings that would-have gated (gatedStatus set, mode:'inform') — the
   latter is the track record that later justifies promoting an inform validator (e.g. trajectory) to
   gate; a plain inform pass with no gatedStatus is not logged (nothing to learn from). */
export function leanValidators(results) {
  const out = [];
  for (const r of results || []) {
    if (r.status !== 'pass') out.push({ key: r.key, status: r.status, reason: r.reason });
    else if (r.mode === 'inform' && r.gatedStatus) out.push({ key: r.key, status: r.gatedStatus, reason: r.reason, mode: 'inform' });
  }
  return out.length ? out : undefined;
}
