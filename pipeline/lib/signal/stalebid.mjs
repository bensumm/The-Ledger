/* stalebid.mjs — FD4: staleness read on an UNDECLARED resting bid (INFORM-ONLY n≈0, gates nothing).
 * Triggers, either fires: episode age past STALE_BID_HOURS, or the daily buy-dip window PASSED in
 * full while the bid rested unfilled. The caller silences declared bids (bidthesis.mjs) BEFORE the
 * read; the line names the window + level, never a chase-bid reprice; CANCEL stays Ben's call.
 * Full contract + dedupe policy pinned in stalebid.test.mjs / README's entry. */
import { fmtP, fmt, fmtHourRange } from '../../../js/money-format.js';
import { diurnalTimedLap } from '../../../js/windowread.mjs';
import { restingAge } from '../reconstruct/offers.mjs';
import { bidThesisFor } from '../thesis/bidthesis.mjs';

/* PLACEHOLDER (n≈0, uncalibrated): one full daily diurnal lap — a bid this old outlived every buy
 * window on its item's daily clock. The age fallback when no dip window is derivable. */
export const STALE_BID_HOURS = 24;

const spanHours = (startH, endH) => ((endH - startH) % 24 + 24) % 24;

/* buyWindowPassed — a FULL dip-window [startH,endH) occurrence elapsed while the bid rested
 * (placedTs ≤ its start, end ≤ now). Mid-window placement gets its next full window; a
 * degenerate full-day cluster (startH === endH) never passes. PURE. */
export function buyWindowPassed(placedTs, w, now = new Date()) {
  if (!Number.isFinite(placedTs) || !w || w.startH == null || w.endH == null) return false;
  const span = spanHours(w.startH, w.endH);
  if (span === 0) return false;
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), w.endH, 0, 0, 0);
  if (end.getTime() > now.getTime()) end.setDate(end.getDate() - 1);   // latest completed occurrence
  const start = end.getTime() - span * 3600e3;
  return placedTs <= start;
}

/* staleBidRead — null (not stale / null placedTs), or { reason: 'window-passed'|'age'|'window+age', ageH }. PURE. */
export function staleBidRead({ placedTs, dipWindow = null, nowMs = Date.now() } = {}) {
  if (!Number.isFinite(placedTs)) return null;
  const ageH = (nowMs - placedTs) / 3600e3;
  const aged = ageH >= STALE_BID_HOURS;
  const passed = buyWindowPassed(placedTs, dipWindow, new Date(nowMs));
  if (!aged && !passed) return null;
  return { reason: passed && aged ? 'window+age' : passed ? 'window-passed' : 'age', ageH };
}

/* staleBidState — the compact cross-pass dedupe record for one flagged bid. */
export function staleBidState(read, off) {
  return { reason: read.reason, filled: off.qty ?? 0, ageDay: Math.floor(read.ageH / 24) };
}

/* shouldResurfaceStale — print on first firing or any state change (the documented policy above). */
export function shouldResurfaceStale(prior, cur) {
  return !prior || prior.reason !== cur.reason || prior.filled !== cur.filled || prior.ageDay !== cur.ageDay;
}

/* staleBidLine — THE one line: item, remainder, resting time, reclaimable escrow gp (the
 * suspectBidEscrow max(0,max−qty)×offer formula), both options. window/level nullable.
 * levelBasis 'live' (deriveDiurnalRange repriced the dip to the live instasell) SUPPRESSES the
 * level — quoting live as a "window level" is a chase pitch (the windowread repriced-bid gate,
 * fourth consumer); the re-read fallback prints instead. */
export function staleBidLine({ name, off, read, ageTxt, window: w = null, level = null, levelBasis = null }) {
  const remainder = Math.max(0, (off.max || 0) - (off.qty || 0));
  const escrow = remainder * (off.offer || 0);
  const lvl = levelBasis === 'live' ? null : level;
  const winTxt = (w && w.startH != null && w.endH != null) ? fmtHourRange(w.startH, w.endH) : null;
  const why = read.reason === 'age'
    ? `past the ${STALE_BID_HOURS}h placeholder (n≈0)`
    : `buy window ${winTxt} passed unfilled${read.reason === 'window+age' ? ` + past the ${STALE_BID_HOURS}h placeholder` : ''}`;
  const reprice = (winTxt && lvl != null)
    ? `reprice into the buy window ${winTxt} @ ~${fmtP(lvl)}`
    : `re-read the window for a reprice level (read-window-range.mjs --profile)`;
  return `⏳ stale bid — ${name}: ${fmt(off.qty)}/${fmt(off.max)} filled @ ${fmtP(off.offer)} · resting ${ageTxt || '?'} (${why}) · ${fmtP(escrow)} gp escrow reclaimable · ${reprice} · or cancel & redeploy — your call (declare deep/long to silence: declare-thesis.mjs bid "${name}")`;
}

/* staleBidNotes — the ONE per-item flag pass shared by watch's standalone-bid, HELD (accumulate-
 * while-holding, own-partial-fill included) and TARGET rows: declaration check → staleness read per
 * offer → V1-state dedupe (stalebid:<id>:<offer> keys written into newState). Returns rendered
 * lines (unindented). opts.lap injects a prebuilt lap (tests); default derives it from it.ts1h. */
export function staleBidNotes(it, offs, { store, priorState = {}, newState = {}, nowMs = Date.now(), lap } = {}) {
  const out = [];
  try {
    if (!offs || !offs.length || bidThesisFor(store, it.id, 'buy')) return out;
    if (lap === undefined) {
      lap = null;
      try {
        const l = diurnalTimedLap(it.ts1h, { nights: 14, liveLo: it.row?.quickBuy ?? null, liveHi: it.row?.quickSell ?? null });
        if (!l.degraded) lap = l;
      } catch { /* no lap → age-only trigger, no level named */ }
    }
    for (const off of offs) {
      const read = staleBidRead({ placedTs: off.placedTs, dipWindow: lap ? lap.dipWindow : null, nowMs });
      if (!read) continue;
      const key = `stalebid:${it.id}:${off.offer}`;
      const cur = staleBidState(read, off);
      if (shouldResurfaceStale(priorState[key], cur))
        out.push(staleBidLine({ name: it.name, off, read, ageTxt: restingAge(off.placedTs, nowMs),
          window: lap ? lap.dipWindow : null, level: lap ? lap.bid : null, levelBasis: lap ? lap.bidBasis : null }));
      newState[key] = cur;
    }
  } catch { /* inform-only — never block a watch pass */ }
  return out;
}
