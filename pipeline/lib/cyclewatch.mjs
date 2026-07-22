// cyclewatch.mjs — the ADAPTIVE cycle-expectation monitoring loop (PLAN-OSCILLATION-CYCLE Chunk 4).
//
// The multi-week oscillator lane (fang/blowpipe: a ~6–8-day ~10% swing riding a slowly drifting
// floor/ceiling) has, per item, a drift-adjusted PRIOR of where its next trough/peak will land —
// Chunk 1's `driftAdjustedTrough`/`driftAdjustedPeak` (`js/forecast.mjs` `driftExitFrom`). This module
// is the layer that REMEMBERS that prior across `watch-positions.mjs` passes and CORRECTS it against the
// live read: a tracking-error update that says "the dip came in shallower than we expected — bid the
// shallower level" or "the peak is printing weaker — step the ask DOWN to the confident-reachable
// level", and appends an `{expected, actual, adjustment}` triple per side for later calibration.
//
// ── WHAT THIS IS AND IS NOT (the two hard guarantees — read before editing) ───────────────────────
//  • INFORM-ONLY, n≈0. The recorded expectation is a PRIOR, not a validated forecast. Every constant
//    below is a NAMED PLACEHOLDER (no F1 retro yet); every emitted note carries the n≈0 caveat. Nothing
//    here gates a verdict, moves a price, or grades a row — it emits NOTES a human reads.
//  • ALERTS-never-places. Like the `--dip`/`flushSignal` reactive alert (js/quotecore.js) and the whole
//    watch-positions.mjs surface, this NEVER places or cancels a GE offer — not even a band-breach ABORT,
//    which is a NOTE the operator reads, never an auto-cancel at first landing. You click; it advises.
//
// ── SYMMETRY (the load-bearing design invariant, PLAN "corrected mechanism") ──────────────────────
// The multi-week drift is consumed as a NUMBER, never a direction LABEL: it is already baked into the
// recorded `expected*` levels by Chunk 1. So the tracking-error code compares `actual` to `expected`
// and branches ONLY on the sign of `(actual − expected)` — NEVER on the sign of the drift. An up-drift
// cycle and a down-drift cycle run the IDENTICAL code path through `trackError()`; they differ only in
// the numbers the prior was recorded with. There is no `if (drift < 0)` anywhere in this file, by
// construction — that is exactly what pins the fang down-leg and an up-leg to one formula.
//
// ── PERSISTENCE (mirror watchstate.mjs — do NOT invent a new pattern) ─────────────────────────────
// State is a keyed map (one entry per item id) persisted via watchstate.mjs's generic loadState/
// saveState (the SAME thin IO those pure functions use — reused, not forked). The watch loop rebuilds
// the map FRESH each pass (so a vanished item drops out) and saves once at pass end — the arm-then-
// confirm "rebuild + save at pass end" idiom convictionGate/pathPersistence use. The reset policy
// (identity change / a gap beyond the stale window RE-RECORDS the cycle) mirrors watchstate.shouldReset,
// scaled to the cycle horizon (days, not minutes).

import { fmtP } from '../../js/money-format.js';

// --- named PLACEHOLDER tunables (n≈0, F1 owns calibration — honesty rule 4) ------------------------
// A cycle spans DAYS, so "the same cycle continues" tolerates a much larger inter-pass gap than the
// 15-min watch-state gap. Beyond this the cycle continuity is lost and the prior is RE-RECORDED.
export const CYCLE_STALE_GAP_MS = 2 * 24 * 60 * 60 * 1000;   // 2 days
// The confidence-band HALF-WIDTH as a fraction of the expected level, before the confidence multiplier.
// This is BOTH the "within tolerance" band AND the abort threshold: a live read that diverges past it
// is treated as the cycle having rolled over (an inform-only ABORT note). PLACEHOLDER.
export const CYCLE_CONF_BAND_FRAC = 0.05;    // ±5% of the expected level (× the confidence multiplier)
// The confidence ordinal from driftAdjustedExit widens the band: a softer prior tolerates more drift
// before it calls a revision / a breach. PLACEHOLDER shape (softer ⇒ wider), not a calibrated magnitude.
export const CYCLE_CONF_BAND_MULT = { high: 1, med: 1.5, low: 2 };
// The minimum relative deviation (|actual−expected|/expected) that COUNTS as a material tracking error
// worth a revision note — inside it the read is "on the prior" and no note fires (noise discipline).
export const CYCLE_TRACK_ERR_FRAC = 0.015;   // 1.5%
// Cap on the retained {expected, actual, adjustment} calibration triples per item (bounded state).
export const CYCLE_HISTORY_MAX = 20;

// The n≈0 caveat every cycle note family carries (honesty rule 4). ONE string, appended once per block.
export const CYCLE_CAVEAT = 'cycle expectation is a PRIOR, not a validated forecast (n≈0, placeholder thresholds) — do not trade on it yet; inform-only, this loop never places/cancels an offer.';

// The confidence-band half-width (absolute gp) around an expected level, widened by the prior's
// confidence ordinal. PURE. A null/≤0 level ⇒ null (can't band an absent level).
export function bandHalf(level, confidence) {
  if (level == null || !(level > 0)) return null;
  const mult = CYCLE_CONF_BAND_MULT[confidence] ?? CYCLE_CONF_BAND_MULT.low;
  return Math.abs(level) * CYCLE_CONF_BAND_FRAC * mult;
}

/* PURE. The ONE direction-agnostic comparator — the symmetry pin. Compares an `actual` read to an
   `expected` prior and classifies the error purely by the SIGN of (actual − expected) and its size
   vs the confidence band. It does NOT know or care whether the underlying cycle drifts up or down —
   the drift is already inside `expected`. Returns:
     { err, relErr, half, dir, material, breach }
   dir = +1 (actual above expected) / −1 (below) / 0 (equal); material = |relErr| ≥ trackErrFrac;
   breach = |err| > half (diverged beyond the confidence band → the cycle likely rolled over). */
export function trackError(expected, actual, half, { trackErrFrac = CYCLE_TRACK_ERR_FRAC } = {}) {
  if (expected == null || actual == null || !(expected > 0)) return null;
  const err = actual - expected;
  const relErr = err / expected;
  const dir = Math.sign(err);
  const material = Math.abs(relErr) >= trackErrFrac;
  const breach = half != null && Math.abs(err) > half;
  return { err, relErr, half, dir, material, breach };
}

// Round for display without importing more than money-format needs.
const r = v => (v == null ? null : Math.round(v));

/* PURE. Record the initial per-item cycle expectation from a driftAdjustedExit result (`dae` —
   `js/forecast.mjs` driftExitFrom/driftAdjustedExit output: { driftAdjustedTrough, driftAdjustedPeak,
   confidence, … }). This is the "prior recorded at first observation of a cycle". Returns the
   expectation fields folded into a state entry, or null when the dae has no usable levels (degrade,
   never a fake prior). `observed*` seed the running realized extremes with the first live actuals. */
export function recordExpectation(dae, { troughActual = null, peakActual = null } = {}) {
  if (!dae) return null;
  const expectedTrough = dae.driftAdjustedTrough ?? null;
  const expectedPeak = dae.driftAdjustedPeak ?? null;
  if (expectedTrough == null && expectedPeak == null) return null;
  const confidence = dae.confidence ?? 'low';
  return {
    expectedTrough, expectedPeak, confidence,
    bandTroughHalf: bandHalf(expectedTrough, confidence),
    bandPeakHalf: bandHalf(expectedPeak, confidence),
    holdHorizonDays: dae.holdHorizonDays ?? null,
    observedTrough: troughActual ?? expectedTrough,
    observedPeak: peakActual ?? expectedPeak,
  };
}

// Reset policy (mirrors watchstate.shouldReset, cycle-scaled): a changed identity (a different lot /
// a re-declared cycle) OR a gap beyond the cycle stale window means the prior no longer describes THIS
// cycle → re-record. A missing prior is first-seen (handled by the caller), not a reset.
export function shouldRecycle(prior, identity, now) {
  if (!prior) return false;
  if (prior.identity != null && identity != null && prior.identity !== identity) return true;
  if (prior.ts != null && now != null && (now - prior.ts) > CYCLE_STALE_GAP_MS) return true;
  return false;
}

// Build one revision {note, triple} for a side, given the side's expected/observed levels + the
// trackError result. `side` ∈ 'trough'|'peak' selects PHRASING only (never a drift-sign branch); the
// classification is trackError.dir, shared by both sides. Returns null when the error is immaterial.
// `revisedExpected` (trough side only) is the level the prior is nudged TO on a shallower dip so a
// resting bid there still fills (the "revise Te up" correction). PLACEHOLDER prose; n≈0.
function sideRevision(side, expected, observed, te) {
  if (!te || (!te.material && !te.breach)) return null;
  const exp = fmtP(r(expected)), act = fmtP(r(observed));
  // BAND BREACH — the cycle likely rolled over. Inform-only ABORT note; the SAME on both sides and
  // both drift directions. NEVER an auto-cancel (ALERTS-never-places) — a NOTE the operator reads.
  if (te.breach) {
    return {
      adjustment: 'abort-band-breach',
      note: `⚠ ABORT-WATCH (${side}): live ${act} diverged beyond the ±${fmtP(r(te.half))} confidence band around the ${exp} prior — the cycle likely rolled over. Re-read; don't lean on the stale prior. (inform-only — no offer is placed/cancelled)`,
      revisedExpected: null,
    };
  }
  if (side === 'trough') {
    // dir > 0 ⇒ the realized dip is ABOVE the expected trough = SHALLOWER; dir < 0 ⇒ DEEPER.
    if (te.dir > 0) return {
      adjustment: 'bid-shallower',
      note: `dip SHALLOWER than the ${exp} prior (realized ~${act}) — bid the shallower level ~${act} to still fill; revising the expected trough up.`,
      revisedExpected: observed,   // revise Te UP toward the level that actually printed
    };
    return {
      adjustment: 'drop-bid-deeper',
      note: `dip DEEPER than the ${exp} prior (realized ~${act}) — drop the bid toward ~${act} to catch the flush.`,
      revisedExpected: null,
    };
  }
  // peak side: dir < 0 ⇒ realized peak BELOW the expected = WEAKER; dir > 0 ⇒ STRONGER.
  if (te.dir < 0) return {
    adjustment: 'step-down-weaker-peak',
    note: `peak WEAKER than the ${exp} prior (realized ~${act}) — sell-velocity step the ask DOWN to the confident-reachable ~${act} (the /positions step-down doctrine); a certain clear beats defending a fading peak.`,
    revisedExpected: null,
  };
  return {
    adjustment: 'ladder-up-stronger-peak',
    note: `peak STRONGER than the ${exp} prior (realized ~${act}) — ladder the ask UP toward ~${act} (the Bar-E ask-headroom read); real demand printed above the prior, laddering is cheap.`,
    revisedExpected: null,
  };
}

/* PURE. The per-tick cycle-expectation update — the heart of Chunk 4. Never mutates its inputs.
   @param prior   the stored cycle-watch entry for this item (or undefined/null on first sight)
   @param obs {
     identity,                 // stable cycle key (e.g. "cyc:<id>"); a change RE-RECORDS the cycle
     troughActual, peakActual, // this tick's live low/high read (row.quickBuy / row.quickSell)
     dae,                      // a driftAdjustedExit result — CONSUMED only when (re)recording a cycle
     now,                      // ms
   }
   @param opts { trackErrFrac }  // threshold override (tests pin it)
   @returns {
     state,        // the NEW entry to persist (rebuilt fresh, never a mutated input)
     notes,        // string[] — revision/abort notes (empty on a first-seen or on-prior pass)
     triples,      // [{ expected, actual, adjustment, side }] — the calibration record for this tick
     firstSeen,    // true when this pass (re)recorded the prior (no revision emitted)
     recycled,     // true when a reset re-recorded the cycle
   }
   The revision logic is SYMMETRIC: trough and peak both flow through trackError()+sideRevision(),
   which branch on the error sign, never on the drift sign. An up-drift and a down-drift cycle are
   the same code path with different numbers. */
export function cycleTick(prior, { identity = null, troughActual = null, peakActual = null, dae = null, now = null } = {}, opts = {}) {
  const recycled = shouldRecycle(prior, identity, now);
  const firstSeen = !prior || recycled;

  // (RE)RECORD a cycle — first sight, or a reset. Consume the dae prior; emit NO revision (nothing
  // consecutive to compare against yet). If no dae is available we cannot record an expectation, so
  // we still seed a minimal entry (running extremes only) so the next dae-bearing pass can record.
  if (firstSeen) {
    const rec = recordExpectation(dae, { troughActual, peakActual });
    const base = rec || {
      expectedTrough: null, expectedPeak: null, confidence: 'low',
      bandTroughHalf: null, bandPeakHalf: null, holdHorizonDays: null,
      observedTrough: troughActual, observedPeak: peakActual,
    };
    return {
      state: { ts: now ?? null, identity, ...base, history: [] },
      notes: [], triples: [], firstSeen: true, recycled,
    };
  }

  // TRACK against the stored (possibly already-revised) expectation. dae is ignored here on purpose —
  // the prior is corrected via tracking error, not re-recorded every pass (recorded once per cycle).
  // Update the running realized extremes: the deepest low / highest high seen this cycle.
  const observedTrough = (prior.observedTrough != null && troughActual != null)
    ? Math.min(prior.observedTrough, troughActual) : (troughActual ?? prior.observedTrough ?? null);
  const observedPeak = (prior.observedPeak != null && peakActual != null)
    ? Math.max(prior.observedPeak, peakActual) : (peakActual ?? prior.observedPeak ?? null);

  const notes = [];
  const triples = [];
  let expectedTrough = prior.expectedTrough ?? null;
  let expectedPeak = prior.expectedPeak ?? null;

  // TROUGH side and PEAK side both flow through the SAME trackError()+sideRevision() — the symmetry pin.
  const troughTe = trackError(expectedTrough, observedTrough, prior.bandTroughHalf, opts);
  const troughRev = sideRevision('trough', expectedTrough, observedTrough, troughTe);
  if (troughRev) {
    notes.push(troughRev.note);
    triples.push({ expected: expectedTrough, actual: observedTrough, adjustment: troughRev.adjustment, side: 'trough' });
    if (troughRev.revisedExpected != null) expectedTrough = troughRev.revisedExpected;   // revise Te up
  }

  const peakTe = trackError(expectedPeak, observedPeak, prior.bandPeakHalf, opts);
  const peakRev = sideRevision('peak', expectedPeak, observedPeak, peakTe);
  if (peakRev) {
    notes.push(peakRev.note);
    triples.push({ expected: expectedPeak, actual: observedPeak, adjustment: peakRev.adjustment, side: 'peak' });
  }

  const history = [...(prior.history || []), ...triples].slice(-CYCLE_HISTORY_MAX);
  const state = {
    ts: now ?? null, identity,
    expectedTrough, expectedPeak,
    confidence: prior.confidence ?? 'low',
    bandTroughHalf: prior.bandTroughHalf ?? null,
    bandPeakHalf: prior.bandPeakHalf ?? null,
    holdHorizonDays: prior.holdHorizonDays ?? null,
    observedTrough, observedPeak,
    history,
  };
  return { state, notes, triples, firstSeen: false, recycled: false };
}

/* PURE. Render the cycle-tick notes into the nested watch note-block lines (4-space indented, like
   the YT1 thesis / YP1 guide-anchor lines pushed after heldNoteBlock). Prepends a `cycle:` header
   line and appends the n≈0 caveat ONCE. Returns string[] (empty when there is nothing to say — a
   first-seen or on-prior pass). Output-format-only; decides nothing. */
export function cycleNoteLines(name, tick) {
  if (!tick || !tick.notes || !tick.notes.length) return [];
  const lines = [`    cycle — ${name}:`];
  for (const n of tick.notes) lines.push(`      ${n}`);
  lines.push(`      (${CYCLE_CAVEAT})`);
  return lines;
}
