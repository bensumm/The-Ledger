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
 * validated EXCEPT floorValidator's FLOOR_CAUTION_RANGES, set from the forward-scoring study recorded in
 * its own MEASURED block (and dip-posture's reverting branch, whose POLICY that same study falsified —
 * see the recentDirection header in js/quotecore.js). Everything else is still un-scored.
 * reachValidator REUSES js/windowread.mjs's existing quantile/recency logic and constants
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
/* The RC1 stale-flag bump, CAPPED AT CAUTION. It only ever raises a pass to caution; a caution stays a
   caution and a reject stays a reject.
   WHY THE CAP (forward-scored over 6,016 ask-reach rows with a real 8h outcome, base rate 40.3%):
     · staleOptimistic DOES carry signal at matched reach fraction — stale rows print −4.0pp less often
       (frac-weighted; −6.6pp and −8.8pp in the 0.2–0.3 and 0.3–0.4 bands, though 0.4–0.5 reverses +9.1pp).
       Weak and not uniform, but real in direction — which is why the flag is KEPT.
     · What it did NOT support is the reject arm. The rows this bump pushed caution→reject (n=676 scored)
       still printed their level 43.3% of the time within 8h — ABOVE the population base rate. "Never
       reachable" is the wrong label for a level that prints on nearly half of scored windows, and a ~4pp
       effect cannot carry a severity tier that names a level out of range.
   A caution is the honest ceiling for a 4pp signal. Keeping pass→caution also matters for VISIBILITY:
   the screen renders a reach reason only via flags() (non-pass) or informFlags() (has gatedStatus), so a
   stale row demoted all the way to pass would print its warning NOWHERE. The bump is what surfaces it. */
function staleFlagBump(status) { return status === 'pass' ? 'caution' : status; }

const round2 = x => (x == null ? null : Math.round(x * 100) / 100);
/* degrade-to-pass (never a reject on missing input); abstain marks the non-answer for leanValidators. */
function degrade(key, note) { return { key, status: 'pass', reason: note, abstain: true, evidence: { note } }; }

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
 * stale-optimistic flag (the full count concentrated in an OLDER, higher/cheaper price regime) raises a
 * pass to CAUTION and stops there (the cap is measured — see staleFlagBump above), because a reach the
 * recent nights don't confirm is worth a flag but not an out-of-range verdict — reusing recencySplit's
 * existing staleOptimistic semantics, no new threshold.
 *
 * ⚠ THRESHOLD HONESTY (measured, n=6,016 ask rows with a real 8h outcome). REACH_CAUTION_FRAC
 * is deliberately NOT tuned, and the reason is worth recording: no cut point earns much. The base miss rate is
 * 60.0%, and moving the line from 0.5 down to 0.2 buys precision 60.0% → 64.6% while recall falls to
 * 62.7% — a ~5pp lift at best anywhere in the range, and 0.1/0.15 are no better. The underlying signal is
 * REAL but CONTINUOUS: within-item (composition cancelled) a higher reach fraction prints 9.8pp more
 * often, 78 items vs 36, p=0.0001. A continuous weak signal belongs in the RANK as a continuous term —
 * which is exactly where it already is (askReachFactor scales P(fill) smoothly) — not in a binary flag
 * that a threshold move can meaningfully improve. Do not "tune" this constant expecting a win; the
 * honest read is that the caution tier is decoration and the rank term is where reach does its work.
 *
 * ⚠ WINDOW SCOPE — THIS IS A CLOCK-ANCHORED "COMING-HOURS" READ, NOT A FULL-DAY ONE (EF1(d),
 * PLAN-ESTIMATOR-FIDELITY — the diagnosed screen-vs-quote reach divergence). The scored window is
 * `[now.getHours(), +REACH_WINDOW_HOURS)` (default 8h) repeated over REACH_NIGHTS nights: "will this
 * level print in the SAME coming-8h window it's about to rest through?" — so the count MOVES with the
 * clock. quote-items.mjs scores the same level over the FULL DAY (windowStats wStart 0, wEnd 0):
 * "does this level print at some point in a day?" Both are legitimate questions and they legitimately
 * DISAGREE (the neitiznot bid anchor: 0/3 here vs 2/3 full-day, minutes apart — the dip printed
 * outside the coming-8h window). INTENTIONAL DIFFERENCE, kept: the screen's rank P(fill) is built on
 * this window read (unifying it to full-day would re-score every board — its own chunk, EF0-gated).
 * Cross-surface comparison of raw reach tokens is invalid without naming the window basis.
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
  if (n < REACH_MIN_DAYS) return { key, status: 'pass', reason: 'thin-sample', abstain: true, evidence: { ...evidence, note: 'thin-sample' } };

  // base status off the full-window reach fraction, then the RC1 stale bump.
  let status = frac <= REACH_REJECT_FRAC ? 'reject'
             : frac < REACH_CAUTION_FRAC ? 'caution'
             : 'pass';
  if (rc.staleOptimistic) status = staleFlagBump(status);

  const verb = side === 'bid' ? 'touched' : 'reached';
  const staleTail = rc.staleOptimistic ? ` (recent ${rc.recentHit}/${rc.recentDays} — stale-optimistic)` : '';
  // staleTail rides on BOTH branches. With the bump capped at caution a stale row is never `pass`, so in
  // practice the pass branch never carries it — but if the cap is ever loosened, the marker must not
  // silently vanish with the severity (the reason only reaches stdout on a non-pass, so a stale row that
  // scores pass would warn nowhere). Belt and braces, deliberately.
  const reason = (status === 'pass'
    ? `${side} ${level} ${verb} ${hit}/${n}d`
    : `${side} ${level} ${verb} only ${hit}/${n}d`) + staleTail;
  return { key, status, reason, evidence };
}

// --- floorValidator ---------------------------------------------------------------------------
// The floor + typical-swing math itself lives in js/termstructure.mjs (its own PLACEHOLDERs); these
// govern how far above the durable floor a BUY is allowed to sit before we caution/reject it.
//
// MEASURED — the F1/P6 study this header once asked for has been run. 4,121 band/churn
// firings forward-scored against the 5m archive; drawdown measured below the buy over 48h and expressed
// in the item's OWN typical-swing units (recoverable per row as (level − floor) / ranges):
//     ranges 1.00–1.25  n=1,734 — median drawdown 0.34 swing · P(drawdown ≥ 1 swing)  9.6%
//     ranges 1.25–1.50  n=1,075 — median drawdown 0.37 swing · P(drawdown ≥ 1 swing) 16.2%
//     ranges 1.50–2.00  n=1,227 — median drawdown 0.58 swing · P(drawdown ≥ 1 swing) 30.5%
// ⚠ EFFECT SIZE, CORRECTED on re-measure: the swing-unit outcome above shares terms with the
// `ranges` bucketing (both divide by the same typicalSwing off the same level), so part of that
// 9.6→30.5 spread is mechanical, not market. Re-scored with the threshold FIXED IN PERCENT (8% depth —
// `ranges` cannot enter the outcome) and outlier-resistant depth statistics (n=4,079 windows, median 221
// 5m buckets each): P(depth ≥ 8%) rises 12.9%→15.3%→23.9% on the raw minimum and 10.2%→11.7%→18.6% on
// the 3rd-lowest bucket. The honest dose-response is ~8–11pp across the range, NOT the ~21pp the
// swing-unit table suggests. Still monotonic on every statistic, and 0.0% of windows show the junk-print
// signature (min < 0.5× the q02 depth level) — real, just half the size.
// Spearman rho 0.151 over n=4,121; within-item (each item split at its OWN median ranges, so
// item composition cancels) +7.0pp in this validator's direction, 28 items vs 15, p=0.066.
// SO `ranges` DOES CARRY INFORMATION — but about DRAWDOWN, not LOSS. Median 7-day return is flat across
// every bucket (+0.26% / +1.35% / −0.27%). Buying elevated means you will probably see red before green;
// it does NOT mean you lose. Do not restate this as a loss/bleed prediction.
// TWO THINGS THE PREVIOUS SHAPE GOT WRONG:
//   (1) The caution line sat at 1.0, but the separation concentrates at ~1.5: on the fixed-8% robust
//       statistic, P(depth ≥ 8%) is 10.8% below the line vs 18.6% at/above it. Moving the line to 1.5 is
//       a PRECISION/RECALL TRADE, not a free win: it silences 69.6% of firings AND with them 48.0% of the
//       real DD ≥ 1-swing events (recall kept 52.0%); precision improves 17.4% → 29.8%. Accepted
//       deliberately — floor is caution-only in the ledger, and a flag on 2/3 of the board was wallpaper.
//       That is why FLOOR_CAUTION_RANGES is now 1.5. Do NOT restate this as "keeps all the signal".
//   (2) The reason asserted the buy was "not near durable support". The floor it names actually prints
//       only 6–8.5% of the time within 48h, NON-monotonically — the DISTANCE carries the information,
//       the DESTINATION does not. The reason no longer asserts the destination.
export const FLOOR_CAUTION_RANGES = 1.5;   // buy > this many typical swings above the durable floor ⇒ caution (MEASURED; was 1.0)
// UNMEASURED IN BAND/CHURN — CENSORED BY ITS OWN GATE (an earlier note here called
// this tier "inert", which was circular): floor runs mode:'gate' in band/churn, and a reject row is
// `continue`d out of screen-flip-niches.mjs BEFORE it reaches the suggestions ledger — so the ledger
// CANNOT contain a band/churn row above 2.0 by construction. The distribution shows the wall (a dense
// 1.95–2.00 shoulder, then a hard zero above), and the 14 ledgered floor rejects all came from surfaces
// that don't drop (13 via quote-items' mode-null registry run; 1 via scalp, where floor is inform; 3 of
// the 14 are R3 escalations at ranges 1.13–1.33). Items DO exceed 2.0 in the wild — the screen's own
// `rejected:` footer names them; they just never reach the ledger, so this tier has NO outcome evidence
// either way. Left at 2.0 DELIBERATELY — lowering it would drop MORE rows on an unmeasured tier. Do not
// cite the ledger as proof this tier is inert, and do not "fix" it by making it reachable.
export const FLOOR_REJECT_RANGES = 2.0;    // buy > this many typical swings above the durable floor ⇒ reject
// R3 (PLAN-SIGNAL-RECENCY): a falling recentTrend TIGHTENS the level check (additive-only — never relaxes).
// A `pass` only escalates to caution once the bid is already within this fraction of the caution line
// (borderline-elevated); a clean low pass with real headroom is NEVER touched by the trend alone.
// UNMEASURABLE FROM THE LEDGER — THE ARM IS CENSORED (an earlier note here read the
// n=60 comparison as evidence AGAINST the rule, which was a composition artifact): R3's own escalation
// destroys its evidence. falling + already-caution ⇒ reject ⇒ the row is dropped before logging in
// band/churn, so the ledgered falling-note arm is ONLY the borderline pass→caution band — ranges
// [0.75, 1.00], median 0.87 — while the plain-caution comparison group sits at 1.00+, median 1.30.
// Ranges-matched there are ZERO overlapping rows: the old 8.3%-vs-17.6% drawdown comparison was comparing
// lower-elevation rows against higher-elevation ones and calling the difference evidence. The rule stands
// UNMEASURED (neither supported nor falsified), and it is the ONLY path by which floor drops rows (3 in
// 35 days). Do not widen it; a real measurement needs a replay with the escalation disabled, not the
// ledger. Its band tracks FLOOR_CAUTION_RANGES, so it moved up with the line — the borderline band is
// now 1.125–1.5, a DIFFERENT population from the censored 0.75–1.0 arm described above, so even that
// artifact-laden n=60 says nothing about the rows the rule escalates today.
export const FLOOR_TREND_BORDERLINE_FRAC = 0.75;
// MEASURED: the MEDIAN drawdown below a buy sitting at/above the caution line, in typical-swing
// units (n=1,227 at ranges 1.50–2.00). Used ONLY to state the expected dip in the reason. It is a
// POPULATION MEDIAN, not a per-item forecast — the per-item gp figure comes from that item's own
// typicalSwing, which is why the message multiplies it rather than quoting a flat percentage.
export const FLOOR_TYPICAL_DRAWDOWN_SWINGS = 0.6;

/**
 * floorValidator(ctx) — BUY-SIDE ONLY. Answers: how far above its durable multi-week floor does this buy
 * sit, measured in units of the item's TYPICAL fluctuation (the 28d daily-mid IQR)? Within ~1.5 normal
 * swings of the floor → pass; beyond that → caution (an elevated entry that tends to dip below you first).
 *
 * WHAT IT IS NOT (measured — the MEASURED block above carries the numbers). It is NOT a loss
 * predictor and NOT a "support is down there" claim. Elevation predicts DRAWDOWN, not a bleed: 7-day
 * returns are flat across every elevation bucket, and the floor it names prints only 6–8.5% of the time
 * within 48h. The reject tier is UNMEASURED in band/churn — its own gate censors the evidence (see the
 * FLOOR_REJECT_RANGES note above); in the ledger this validator is caution-only in practice.
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
 * DEGRADES to pass (never rejects on absence — the archive has a finite start, so a null /
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
  // The non-pass text states what the measurement supports — an expected DIP BELOW THE ENTRY, scaled to
  // this item's own swing — and no longer asserts "not near durable support" (that floor prints only
  // 6–8.5% of the time within 48h; see the MEASURED block above).
  const dipGp = Math.round(FLOOR_TYPICAL_DRAWDOWN_SWINGS * swing);
  const reason = (status === 'pass'
    ? `buy ${level} near ${ts.floorLookback}d floor ${Math.round(floor)} (${round2(ranges)}× swing)`
    : `buy ${level} sits ${round2(ranges)}× typical swing above the ${ts.floorLookback}d floor ${Math.round(floor)}`
      + ` — elevated entry: expect a dip below it first (median ${FLOOR_TYPICAL_DRAWDOWN_SWINGS}× swing ≈ ${dipGp.toLocaleString()} gp)`) + trendNote;
  return { key, status, reason, evidence };
}

// --- trajectoryValidator ----------------------------------------------------------------------
// The SHAPE check (the encoded windowrange trajectory read) — DISTINCT from floorValidator's LEVEL
// check. floorValidator asks "is the buy elevated ABOVE durable support?"; this asks "what SHAPE is the
// recent multi-week path?" — a knife still stepping down (Nightmare staff), an OSCILLATING faller you buy
// at the local min (Hydra leather), a flat base at the floor (Berserker ring), or bought high. The
// classification math lives in js/termstructure.mjs (classifyTrajectory, attached as ts.trajectory);
// this validator is only the buy-side POLICY over the shape. Ben’s rule: it runs on EVERY thesis
// (the analysis is universally useful for entry timing) but its GATE-vs-INFORM action is per-thesis —
// on scalp it INFORMS (scalp accepts a falling wide band by thesis), on band/value it can gate. Started
// INFORM-ONLY everywhere (rule 4 — n≈0) until the suggestions accrual gives the knife/oscillating split
// a track record; the ledger logs the WOULD-HAVE status so that record accrues (see leanValidators).
/**
 * durableFloorRead(vres) — pull `floorValidator`'s verdict out of a runValidators() result in ONE
 * canonical shape, so a consumer that needs the LEVEL read (is this near durable support?) never
 * re-derives the floor, the typical swing, or the thresholds.
 *
 * WHY IT EXISTS (the Snape grass entry): `softBuyFloorCue` in js/windowread.mjs answers
 * buy-timing off `floorCeilingTrack`'s 5-DAY shape only, so on a 4-day-old spike — where the 5d window
 * sits entirely inside the spike and the floor "rises" BECAUSE of it — it said `▲ favorable — dip in
 * uptrend` on the same pass this validator said "1.68× typical swing above the 28d floor 960 — not near
 * durable support". Ben's ask was explicitly NOT to add a fourth implementation of the same question, so
 * the cue now composes THIS verdict rather than re-deriving one; the whole policy (FLOOR_CAUTION_RANGES,
 * FLOOR_REJECT_RANGES, the recent-trend tightening) stays here, its one home. windowread cannot import
 * this module (validate.mjs imports windowread — the arrow is one-way), so the CALLER passes it down.
 *
 * @param {Array} vres  a runValidators() result array
 * @returns {null | { status, ranges, lookback }}  null when the floor validator did not run/degraded.
 */
export function durableFloorRead(vres) {
  const f = (vres || []).find(v => v && v.key === 'floor');
  if (!f || !f.status) return null;
  const ev = f.evidence || {};
  return { status: f.status, ranges: ev.ranges ?? null, lookback: ev.floorLookback ?? null };
}

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
// Value's "intraday swings against the recent WEEK" check (Ben's rule). Value buys a good ENTRY
// TIME near a recent-week low and holds for the cycle — so the question is: is there a real week cycle
// to harvest AND is live near its low right now? Reads the 7d lookback of the SAME term structure
// floorValidator/trajectoryValidator read (no new fetch). Complementary to valuescreen.mjs's valueGate
// (that is the MULTI-WEEK 14/28d cycle gate; this is the recent-WEEK amplitude + proximity read). BUY-side.
export const VALAMP_MIN_PCT  = 0.04;   // PLACEHOLDER (rule 4): after-tax week amplitude below this ⇒ no cycle to harvest → reject
export const VALAMP_NEAR_LOW = 0.40;   // PLACEHOLDER: live above this fraction up the week range ⇒ not at the low yet → caution (wait for the dip)
// BAR E's LOW-SIDE TWIN (Ben's rule): the week edges are the ROBUST q15/q85 of the 7d daily mids, not
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
// LM1 (Ben: "limits.mjs ... a part of every flow that suggests items ie we can flag as
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
// DP1 — dip DIRECTION, not just depth. BUY-SIDE · INFORM-ONLY · NEVER-REJECT.
// The ⬇DIP probe (pipeline/probes/dip.mjs) says a row is a dip (live instasell under the 24h avg
// low = DEPTH). This validator adds the missing question: is that dip still FALLING, or has it
// already REVERTED (bounced off its low)? The direction read, the mechanic, the n=2 anchor incidents
// and the MEASUREMENT that rewrote this policy all live in the recentDirection header in
// js/quotecore.js — this validator is only the buy-side POLICY over that read.
//
// REFRAMED — READ THE quotecore MEASURED BLOCK BEFORE TOUCHING THE REVERTING BRANCH.
// This used to claim a reverting dip's resting bid "likely misses" and recommend crossing the spread
// or passing. Forward-scoring falsified it: the reverting bid is reached MORE often than the falling
// one this blessed (85.7% vs 82.6% within 8h, n=5,535), because the level quoted is quickBuy — the
// LIVE instasell, which rose with the bounce and sat ABOVE the low being warned about in 92.4% of
// 7,886 firings. NOTE THE SCOPE (corrected): what failed is the claim AT THE QUOTED LEVEL.
// The underlying rest-at-the-low mechanic is UNRESOLVED — it scores both ways depending on how the
// level is defined, and direction is not separable from level because recentDirection is DEFINED by
// where live sits relative to the low (the quotecore "GEOMETRY TRAP" note — read it before proposing
// a re-test at the low). The branch now reports ENTRY QUALITY ("past the bottom by X%") and makes NO
// fill-probability claim and NO cross-or-pass recommendation.
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
    // the "fills as it drops" arm is REMOVED: it measured the LEAST-reached of the three
    // (82.6% @8h vs reverting's 85.7%), because here quickBuy really is pinned at a fresh 3h low, so a
    // fill needs price to revisit it. State the position, not a fill promise.
    return { key, status: 'pass', reason: `dip still falling — the bid @ ${quickBuy.toLocaleString()} sits at/near the ${DIR_LOOKBACK_H}h low`, evidence };
  if (dir === 'flat')
    return { key, status: 'pass', reason: `dip flat — resting bid @ ${quickBuy.toLocaleString()} viable`, evidence };
  // dir === 'reverting' — the local bottom is IN. ENTRY-QUALITY ONLY: no fill-probability claim and no
  // cross-or-pass recommendation (both falsified — see the header + the quotecore MEASURED
  // block). crossNet is still computed and kept in `evidence` as DATA for anyone studying the question,
  // but is deliberately NOT surfaced in the reason; do not turn it back into advice without a fresh
  // measurement at the level actually quoted.
  const bopt = row.bond ? { bond: true, guide: row.guide } : undefined;
  const crossNet = (quickSell != null && row.optSell != null) ? netMargin(quickSell, row.optSell, bopt) : null;
  evidence.crossNet = crossNet;
  const overLowPct = minLow > 0 ? (quickBuy - minLow) / minLow * 100 : null;
  evidence.overLowPct = overLowPct == null ? null : round2(overLowPct);
  const bounceTxt = `+${(bouncePct * 100).toFixed(1)}% off the ${DIR_LOOKBACK_H}h low ${minLow.toLocaleString()} ~${Math.round(minAgeMin)}min ago`;
  // Sign matters: in 92.4% of real firings the quoted bid sits ABOVE the low (median +1.24%) — the case
  // that falsified the old claim. The ~3.6% BELOW-low tail is the one where the original rest-a-bid
  // mechanic would apply — but that mechanic is UNRESOLVED (it scores both ways depending on how the
  // level is defined; quotecore's GEOMETRY TRAP note) and the tail firings' own fill outcomes are
  // unscored — so state the fact neutrally rather than re-asserting a claim either way.
  const overTxt = overLowPct == null ? ''
    : ` the bid @ ${quickBuy.toLocaleString()} is ${Math.abs(overLowPct).toFixed(1)}% ${overLowPct >= 0 ? 'above' : 'below'} that low —`;
  // reason omits a leading ⚠ — the surface prefixes it (the `⚠ ${key}: ${reason}` convention).
  return {
    key, status: 'caution',
    reason: `past the bottom — bounced ${bounceTxt};${overTxt} still ${dipPct.toFixed(1)}% under the 24h avg. `
      + `Entry quality, NOT a fill risk — the bid sits at the live market`,
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

/* GATE vs INFORM (Ben’s rule). A validator's COMPUTATION is thesis-agnostic (the swing/local-min/
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
    // A THROWING validator DEGRADES TO PASS — deliberate (a crash must never start REJECTING rows), but
    // it must not be SILENT: fail-open plus invisible means a gating validator can stop gating forever
    // with nothing anywhere to show for it. So it is logged loudly here and carried into the ledger by
    // leanValidators below. Kept as `status:'pass'` so no consumer's drop logic changes.
    catch (err) {
      const note = String((err && err.message) || err);
      console.error(`validator '${p.key}' THREW — degrading to pass (it is not gating this row): ${note}`);
      res = { key: p.key, status: 'pass', reason: 'validator-error', validatorError: true, evidence: { note } };
    }
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
   undefined when nothing fired, so a clean row's logged shape is unchanged). Includes GATE flags
   (status !== pass), INFORM findings that would-have gated (gatedStatus set, mode:'inform'), and
   pass-shaped NON-ANSWERS (`validatorError`/`abstain` — unlabeled these inflated every hit-rate
   denominator). A plain inform pass with no gatedStatus is still not logged. */
export function leanValidators(results) {
  const out = [];
  for (const r of results || []) {
    if (r.status !== 'pass') out.push({ key: r.key, status: r.status, reason: r.reason });
    // A crashed validator is 'pass' by policy, so both branches below would skip it — log it explicitly.
    // It fires only when a validator actually throws, so a healthy row's logged shape is unchanged.
    else if (r.validatorError) out.push({ key: r.key, status: 'pass', reason: r.reason, validatorError: true });
    else if (r.abstain) out.push({ key: r.key, status: 'pass', reason: r.reason, abstain: true });
    else if (r.mode === 'inform' && r.gatedStatus) out.push({ key: r.key, status: r.gatedStatus, reason: r.reason, mode: 'inform' });
  }
  return out.length ? out : undefined;
}
