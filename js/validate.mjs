/**
 * validate.mjs — the Pipeline-v2 VALIDATOR REGISTRY (chunk P2). Lives in js/ so it is BOTH
 * node-importable (every pipeline surface) AND future app-importable, exactly like js/quotecore.js
 * and js/windowread.mjs.
 *
 * WHAT A VALIDATOR IS. A validator is a PURE function `(ctx) → { key, status, reason, evidence }`
 * where `status ∈ 'pass' | 'caution' | 'reject'`. It reads an already-built ItemContext (the P0
 * chain, pipeline/lib/context.mjs) and answers ONE question about a candidate — "is this level
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

// --- status algebra ---------------------------------------------------------------------------
export const STATUS = { PASS: 'pass', CAUTION: 'caution', REJECT: 'reject' };
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
export const REACH_WINDOW_HOURS = 8;    // default coming-hours window scored (matches watch.mjs's line)
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
  const evidence = {
    level, floor: round2(floor), typicalSwing: round2(swing),
    floorLookback: ts.floorLookback, ranges: round2(ranges), current: ts.current,
  };
  const status = ranges > FLOOR_REJECT_RANGES ? 'reject'
               : ranges > FLOOR_CAUTION_RANGES ? 'caution'
               : 'pass';
  const reason = status === 'pass'
    ? `buy ${level} near ${ts.floorLookback}d floor ${Math.round(floor)} (${round2(ranges)}× swing)`
    : `buy ${level} is ${round2(ranges)}× typical swing above the ${ts.floorLookback}d floor ${Math.round(floor)} — not near durable support`;
  return { key, status, reason, evidence };
}

// --- the registry -----------------------------------------------------------------------------
// keyed so a declarative strategy spec (P4c) can name the validators it runs by key. REGISTRY_ORDER
// is the display/priority order (worst-first is computed via worstStatus, not the array order).
export const VALIDATORS = { reach: reachValidator, floor: floorValidator };
export const REGISTRY_ORDER = ['reach', 'floor'];

/* runValidators(ctx, {only}) — run the registry (or the named subset) over one ctx. Each call is
   try/caught so a throwing validator degrades to pass (never breaks a market read). Returns an array
   of { key, status, reason, evidence }. */
export function runValidators(ctx, { only = null } = {}) {
  const keys = only || REGISTRY_ORDER;
  const out = [];
  for (const k of keys) {
    const v = VALIDATORS[k];
    if (!v) continue;
    try { out.push(v(ctx)); }
    catch (err) { out.push({ key: k, status: 'pass', reason: 'validator-error', evidence: { note: String((err && err.message) || err) } }); }
  }
  return out;
}

/* worstStatus(results) — the most severe status across a row's validator results. */
export function worstStatus(results) {
  let s = 'pass';
  for (const r of results || []) s = worseOf(s, r.status);
  return s;
}

/* flags(results) — the non-pass results only (what a surface annotates / drops on). */
export function flags(results) { return (results || []).filter(r => r.status !== 'pass'); }

/* leanValidators(results) — the compact {key,status,reason} list for the suggestions ledger (YS2
   lean-include: returns undefined when nothing fired, so a clean row's logged shape is unchanged). */
export function leanValidators(results) {
  const f = flags(results);
  return f.length ? f.map(r => ({ key: r.key, status: r.status, reason: r.reason })) : undefined;
}
