/**
 * reverseflip.mjs — PURE gate + edge math for the `--mode reverse` HARVEST-AN-OWNED-ITEM niche
 * (PLAN-REVERSE-FLIP chunk RF1). Mirrors js/valuescreen.mjs / js/amplitudescreen.mjs's shape exactly:
 * DOM-free, fetch-free, fs-free ESM, importable from BOTH node (screen-flip-niches.mjs /
 * gatecandidates.mjs, wired in RF2) AND — later — the app. The caller hands in an already-computed
 * `classifyTrajectory` shape (js/termstructure.mjs) + the sell/rebuy reference prices + per-leg
 * liquidity — no fetch here.
 *
 * THE NICHE (PLAN-REVERSE-FLIP, Ben 2026-07-24). Normal flipping deploys capital and treats the SELL
 * as the risky mandatory leg (stranding = can't sell). Reverse-flip INVERTS this for an item Ben
 * already owns and wants to keep: sell into the diurnal/multi-day PEAK, then rebuy at the DIP. It is
 * capital-free (monetizes an owned asset, nothing deployed to enter) and its failure mode is bounded
 * ("can't rebuy cheap enough" — wait for the next dip). No deadline for the STRATEGY; the BOOK settles an UNDECLARED short at SHORT_MAX_AGE_DAYS (H1), so declare the cycle.
 *
 * THE REGIME INVERSION (the load-bearing idea — see the Regime-asymmetry table in PLAN-REVERSE-FLIP).
 * Every OTHER flip-niche reads `classifyTrajectory`'s shape with `rising` = good (upside) and a decline
 * = stranding risk. Reverse-flip inverts that mapping (`invertedRegimeGate` below):
 *   rising     → REJECT — sell now, rebuy at a HIGHER floor tomorrow; the cycle loses by construction.
 *   elevated   → REJECT — top of range; the same "buy back higher" risk on the rebuy leg.
 *   knife      → PASS   — the monotone-decline case: sell high off a hold you'd otherwise ride DOWN,
 *                         rebuy lower. This PROTECTS the hold's value instead of bleeding it. `knife` is
 *                         `classifyTrajectory`'s "falling" analog — there is NO `falling`/`cooling` shape.
 *   oscillating/based → PASS — a repeatable peak→dip lap, the exact shape the strategy wants.
 *   flat       → PASS   — neutral; no clear lap but not disqualifying.
 *   unknown / missing / short data → CAUTION — degrade, never throw (the momVerdict precedent).
 * `classifyTrajectory` emits `knife|oscillating|based|rising|elevated|flat|unknown` and NEVER `falling`
 * or `cooling`; a `case 'falling'`/`case 'cooling'` branch here would be a silent dead gate (it was the
 * plan's original bug, fixed in Ruling §7 — do NOT reintroduce it).
 *
 * WHY THE REBUY LEG IS THE BINDING CONSTRAINT (Anchor incident, 2026-07-24). Selling 1 Ancestral hat
 * @57m FILLED INSTANTLY on live demand — a WANTED thin item clears its SELL leg immediately, falsifying
 * the naive "thin ⇒ the sell is risky" read. The risk is the REBUY: a deep rebuy bid can strand while
 * you're out of the position and price ranges/rises away. So `reverseFlipGate` weights liquidity
 * asymmetrically — a thin SELL leg is CAUTION-not-reject (live demand clears it), a thin REBUY leg is a
 * real risk (reject). Honesty (rule 4): the thin-rebuy read is a screening posture, never a block on Ben
 * placing the bid — the strategy's own risk framing is that the rebuy miss is BOUNDED.
 *
 * HONESTY (rule 4 — n≈0). Every threshold below is a NAMED PLACEHOLDER; this lane has no record yet. Do
 * NOT cite any constant here as validated.
 */
import { tax } from './money-math.js';
import { BIG_TICKET_GP } from './quotecore.js';   // RF6 — the ONE big-ticket threshold (10m), reused for isThinBigTicket (never reinvented)

const num = x => (typeof x === 'number' && Number.isFinite(x)) ? x : null;

// --- PLACEHOLDER constants (rule 4 — unvalidated; the reverse-flip suggestions accrual would tune them) --
// The peak→dip amplitude (as a fraction of the sell reference) a lap must clear to be worth harvesting.
// A reverse-flip pays the 2% GE tax ONCE (on the sell) and rebuys strictly below `beRebuy`, so the swing
// must clear roughly the tax fraction plus a working margin. PLACEHOLDER (n≈0) — starting hypothesis only.
// @provisional-api: PLAN-REVERSE-FLIP — consumed by RF2's `--mode reverse` gate wiring (screen-flip-niches.mjs / gatecandidates.mjs); node-only until then.
export const REVERSE_MIN_SWING_PCT = 0.03;
// Per-leg daily-volume floor below which a leg is "thin". The reverse-flip population IS mostly thin
// big-ticket owned gear (the hat trades ~135/d), so this is deliberately LOW — its ROLE is asymmetric
// (see reverseFlipGate): thin SELL leg = caution, thin REBUY leg = reject. PLACEHOLDER (n≈0).
export const REVERSE_MIN_LEG_VOL = 50;

// decision severity ordering, so a later check can only DOWNGRADE (pass → caution → reject), never upgrade.
const RANK = { pass: 0, caution: 1, reject: 2 };
const worse = (a, b) => (RANK[b] > RANK[a] ? b : a);

/* invertedRegimeGate(trajectory) → { decision, shape, reason }. Re-maps `classifyTrajectory`'s existing
   shape per the Regime-asymmetry table (this does NOT recompute shape — it re-reads the one already in
   hand). Accepts EITHER a bare shape string OR a classifyTrajectory result object ({ shape, ... }).
   decision ∈ 'pass' | 'reject' | 'caution'; reason is null on a clean pass. Never throws — a missing /
   unknown / short-data shape degrades to caution (the momVerdict optional-degradation precedent). */
export function invertedRegimeGate(trajectory) {
  const shape = typeof trajectory === 'string'
    ? trajectory
    : (trajectory && typeof trajectory.shape === 'string' ? trajectory.shape : null);
  switch (shape) {
    // sell now, rebuy at a HIGHER floor tomorrow → loses by construction.
    case 'rising':   return { decision: 'reject', shape, reason: 'regime-rising' };
    // top of range; the "buy back higher" risk on the rebuy leg → reject the surfacing.
    case 'elevated': return { decision: 'reject', shape, reason: 'regime-elevated' };
    // knife IS the "falling" case the strategy wants (sell high, rebuy lower — protect the hold).
    case 'knife':       return { decision: 'pass', shape, reason: null };
    // ideal — a repeatable peak→dip lap.
    case 'oscillating': return { decision: 'pass', shape, reason: null };
    case 'based':       return { decision: 'pass', shape, reason: null };
    // neutral — no clear lap but not disqualifying.
    case 'flat':        return { decision: 'pass', shape, reason: null };
    // 'unknown', null, or any unrecognized value → degrade, never assert a harvest off thin data.
    case 'unknown': return { decision: 'caution', shape, reason: 'regime-unknown' };
    default:        return { decision: 'caution', shape: shape || null, reason: shape ? 'regime-unrecognized' : 'no-trajectory' };
  }
}

/* reverseFlipEdge(ctx) → the edge fields, or { hasData:false }. DIRECTION-AGNOSTIC.
   ctx — { sellRef, rebuyRef?, swingPct? }:
     sellRef  — the peak / sell reference price (the level the owned item is sold into).
     rebuyRef — (optional) the expected rebuy / dip level; if given, the peak→dip swing is derived from it.
     swingPct — (optional) the peak→dip amplitude as a fraction of sellRef, handed in directly; wins over
                a derived one.
   Computes:
     beRebuy — sellRef − tax(sellRef) via the CANONICAL js/money-math.js tax() (floored, 5m-capped —
               Ruling §1, NOT a "×0.98" approximation). Any rebuy STRICTLY BELOW beRebuy profits after tax.
     swingPct — swingPct ?? (sellRef>0 && rebuyRef!=null ? (sellRef − rebuyRef)/sellRef : null).
     amplitudeFloorMet — swingPct != null && swingPct ≥ REVERSE_MIN_SWING_PCT (a null/unknown swing is NOT
               "unmet" — it's unknown; the gate treats it as no-signal, not a caution).
   Missing/invalid sellRef ⇒ { hasData:false } (degrade, never throw). */
export function reverseFlipEdge(ctx = {}) {
  const sellRef = num(ctx.sellRef);
  if (sellRef == null || sellRef <= 0) return { hasData: false };
  const beRebuy = sellRef - tax(sellRef);
  const rebuyRef = num(ctx.rebuyRef);
  const givenSwing = num(ctx.swingPct);
  const swingPct = givenSwing != null
    ? givenSwing
    : (rebuyRef != null ? (sellRef - rebuyRef) / sellRef : null);
  const amplitudeFloorMet = swingPct != null && swingPct >= REVERSE_MIN_SWING_PCT;
  return { hasData: true, sellRef, beRebuy, rebuyRef, swingPct, amplitudeFloorMet };
}

/* reverseFlipGate(ctx) → { decision, reasons, regime, edge }. Composes the inverted regime gate + the
   amplitude floor + a REBUY-LEG-WEIGHTED liquidity check into ONE structured decision. Never throws.
   ctx — { trajectory, sellRef, rebuyRef?, swingPct?, sellLegVol?, rebuyLegVol? }:
     trajectory                — classifyTrajectory shape/result (→ invertedRegimeGate).
     sellRef/rebuyRef/swingPct — → reverseFlipEdge.
     sellLegVol / rebuyLegVol  — per-leg daily volume (units/day) for the liquidity asymmetry.
   Composition (severity can only DOWNGRADE — pass → caution → reject):
     1. Regime dominates: a `reject` regime (rising/elevated — loses by construction) is a hard reject.
     2. Amplitude floor: a KNOWN sub-floor swing → caution ('swing-below-floor'); a null swing is
        no-signal, not a caution (degrade-friendly).
     3. Liquidity, rebuy-leg-binding (the Anchor incident): a thin REBUY leg → reject ('rebuy-leg-thin');
        a thin SELL leg (rebuy leg OK) → caution-not-reject ('sell-leg-thin', live demand clears the sell);
        an UNKNOWN rebuy leg → caution ('rebuy-liquidity-unknown', can't confirm the binding leg).
   reasons[] collects every fired reason (empty on a clean pass). */
// @provisional-api: PLAN-REVERSE-FLIP — RF2's gateReverseFlipCandidates (screen-flip-niches.mjs / gatecandidates.mjs, `--mode reverse`) is the consumer; node-only until RF2 wires it.
export function reverseFlipGate(ctx = {}) {
  const regime = invertedRegimeGate(ctx.trajectory);
  const edge = reverseFlipEdge(ctx);
  const reasons = [];

  // 1. regime dominates — a rising/elevated item loses by construction; short-circuit to reject.
  if (regime.decision === 'reject') {
    return { decision: 'reject', reasons: [regime.reason], regime, edge };
  }
  let decision = regime.decision;                 // 'pass' or 'caution'
  if (regime.reason) reasons.push(regime.reason); // carries 'regime-unknown'/'no-trajectory' forward

  // 2. amplitude floor — a KNOWN sub-floor swing is no worthwhile lap (caution, never a hard reject on a
  //    wanted item). A null/unknown swing is treated as no-signal (degrade), not a caution.
  if (edge.hasData && edge.swingPct != null && !edge.amplitudeFloorMet) {
    decision = worse(decision, 'caution');
    reasons.push('swing-below-floor');
  }

  // 3. liquidity — the rebuy leg is the binding constraint (Anchor incident). A thin rebuy leg is a real
  //    risk (reject); a thin sell leg is not (live demand clears it → caution); an unknown rebuy leg
  //    degrades to caution because the binding leg can't be confirmed.
  const rebuyVol = num(ctx.rebuyLegVol);
  const sellVol = num(ctx.sellLegVol);
  if (rebuyVol != null && rebuyVol < REVERSE_MIN_LEG_VOL) {
    decision = worse(decision, 'reject');
    reasons.push('rebuy-leg-thin');
  } else {
    if (rebuyVol == null) {
      decision = worse(decision, 'caution');
      reasons.push('rebuy-liquidity-unknown');
    }
    if (sellVol != null && sellVol < REVERSE_MIN_LEG_VOL) {
      decision = worse(decision, 'caution');
      reasons.push('sell-leg-thin');
    }
  }

  return { decision, reasons, regime, edge };
}

/* =============================================================================================
 * RF6 — THIN BIG-TICKET READ HANDLING (PLAN-REVERSE-FLIP chunk RF6, Ruling §6)
 *
 * The reverse-flip population IS mostly thin big-ticket owned gear (the Ancestral hat: guide ~55m,
 * trades ~135/d, buy limit 8, tranche ~1 unit), and the STANDARD reads mislead on exactly that shape
 * (Ruling §6, the live hat case): a lone standing ask reached only 2/14d gets mistaken for "the price";
 * the 3-day hourly slope whipsaws (hat 3d +1.47m UP vs 7d flat) because each hourly median on a thin
 * book is a handful of trades; and a point recommendation ("list 56.5m") is false precision on an item
 * that wobbles 54–58m intraday. RF6 is a set of INFORM-ONLY, THIN-ITEM-ONLY display guards — none gate,
 * drop, or move a quoted number; each degrades to the existing output on a non-thin (liquid) item so the
 * liquid path renders BYTE-IDENTICALLY (the zero-ripple contract). RF2's `--mode reverse` table is the
 * first live consumer; RF4 imports these same helpers for quote-items / `/schedule` / `/book`.
 *
 * HONESTY (rule 4 — n≈0). Every threshold below is a NAMED PLACEHOLDER; this lane has no record yet.
 * ============================================================================================= */

// --- PLACEHOLDER constants (rule 4 — unvalidated; reverse-flip suggestions accrual would tune them) --
// A clearable tranche at/under this many units is "thin" (the hat clears ~1/window). PLACEHOLDER (n≈0).
export const THIN_TRANCHE_UNITS = 2;
// Daily two-sided volume (min-side Vol/d) under this floor is "thin" — the OR fallback when no tranche is
// in hand. Deliberately generous: big-ticket owned gear trades in the low hundreds/day (hat ~135/d) while
// a liquid big-ticket clears thousands. PLACEHOLDER (n≈0) — a starting hypothesis, not a validated cut.
export const THIN_VOL_FLOOR = 500;
// DELETED 2026-08-09 (PLAN-DIURNAL-TRIAGE DT3): `THIN_DRIFT_DAYS = 7` — the longer drift window a THIN
// item defaulted to, "because a thin book's 3-day slope whipsaws (Ruling §6)". The whipsaw was real, but
// it was the n=2 least-squares FIT, not the window: at days=3 the slope was frequently a two-point
// difference. Widening the window did not fix it (days=7 still loses to predict-no-change), so the slope
// itself was deleted and this constant died with its only consumer. See hourly-lmh.mjs's tombstone.
// A standing ask must sit at least this fraction ABOVE the traded guide to be a "lone optimistic ask" and
// not "the price" (the 55m-trades vs 58m-ask gap). PLACEHOLDER (n≈0).
export const SPREAD_MATERIAL_PCT = 0.03;
// …AND be reached on at most this fraction of the last N days to count as "rarely reached" (2/14 ≈ 0.14).
// PLACEHOLDER (n≈0).
export const SPREAD_RARE_FRAC = 0.30;

/* isThinBigTicket(row, { tranche? }) → boolean. THE ONE thin-detection predicate every RF6 guard reads —
   no per-surface re-derivation. TRUE when the item is BIG-TICKET (guide ≥ BIG_TICKET_GP, 10m — note this
   is the 10m big-ticket line, NOT the 5m reverse-flip candidate cutoff) AND liquidity-THIN (a clearable
   `tranche` ≤ THIN_TRANCHE_UNITS if one is handed in, OR min-side Vol/d < THIN_VOL_FLOOR). Pure, off
   fields already on a computeQuote `row` (guide, volDay). A null/unknown guide or volume degrades to
   FALSE (not thin ⇒ no guards ⇒ standard read) — conservative, never throws. */
export function isThinBigTicket(row, { tranche = null } = {}) {
  if (!row) return false;
  const guide = num(row.guide);
  if (guide == null || guide < BIG_TICKET_GP) return false;   // not big-ticket → never "thin big-ticket"
  const vol = num(row.volDay);
  const t = num(tranche);
  const trancheThin = t != null && t <= THIN_TRANCHE_UNITS;
  const volThin = vol != null && vol < THIN_VOL_FLOOR;
  return trancheThin || volThin;
}

/* reverseListBand(sellRef, reachable) → { lo, hi, center } | null. RANGE-NOT-A-POINT support: a thin
   big-ticket's list/sell recommendation is a false-precise single number on an item that wobbles intraday,
   so surface a BAND off the pressure-driven reachable-band read (js/windowread.mjs reachableBand). The band
   spans the recent central daily-high (reachable.baseHigh) → the pressure-reachable top (reachable.ask),
   always widened to CONTAIN `sellRef` (today's point stays available as the band's reachable center). Off
   data already in hand — no new fetch. Returns null when there's no sellRef or no usable reachable band
   (⇒ the caller keeps the existing single-number render — the byte-identical degrade). */
export function reverseListBand(sellRef, reachable) {
  const s = num(sellRef);
  if (s == null || s <= 0) return null;
  const base = reachable ? num(reachable.baseHigh) : null;
  const top = reachable ? num(reachable.ask) : null;
  if (base == null && top == null) return null;
  let lo = Math.min(...[base, top, s].filter(v => v != null));
  let hi = Math.max(...[base, top, s].filter(v => v != null));
  if (!(hi > lo)) return null;   // degenerate (band collapsed to a point) → no band, keep the point
  return { lo, hi, center: s };
}

/* reverseListBandCell(sellRef, reachable, { fmt }) → the Sold-ref/Peak cell TEXT. On a real band → the
   range `~<lo>–<hi>`; otherwise the plain `<sellRef>` (the exact existing render, byte-identical). The
   caller only reaches here for a THIN item — a liquid row keeps its own single-number rendering untouched. */
export function reverseListBandCell(sellRef, reachable, { fmt = String } = {}) {
  const band = reverseListBand(sellRef, reachable);
  const s = num(sellRef);
  if (!band) return s != null ? fmt(s) : '—';
  return `~${fmt(band.lo)}–${fmt(band.hi)}`;
}

/* askSpreadFlag({ guide, askLevel, reachedDays, nDays }) → the flag object | null. TRADED-MID vs
   STANDING-ASK guard: on a thin item a lone optimistic ask sitting materially above where the item
   actually TRADES must never be mistaken for "the price". Fires only when the ask is BOTH materially
   above the traded guide (≥ SPREAD_MATERIAL_PCT) AND rarely reached (≤ SPREAD_RARE_FRAC of the last
   nDays). Off the reach/placement data already computed (reachedDays over the daily-HIGH series). Pure. */
export function askSpreadFlag({ guide, askLevel, reachedDays, nDays } = {}) {
  const g = num(guide), a = num(askLevel);
  if (g == null || g <= 0 || a == null) return null;
  const abovePct = (a - g) / g;
  if (abovePct < SPREAD_MATERIAL_PCT) return null;             // ask not materially above the traded guide
  const rd = num(reachedDays), nd = num(nDays);
  const frac = (rd != null && nd != null && nd > 0) ? rd / nd : null;
  if (frac == null || frac > SPREAD_RARE_FRAC) return null;    // reached often (or unknown) → not a lone ask
  return { guide: g, askLevel: a, reachedDays: rd, nDays: nd, abovePct, frac };
}

/* askSpreadNote(flag, { fmt }) → the compact note TEXT (no sigil — the caller's note-kind owns that), or
   null. `trades ~<guide>; lone asks to <askLevel>, reached <N/nD>d`. */
export function askSpreadNote(flag, { fmt = String } = {}) {
  if (!flag) return null;
  return `trades ~${fmt(flag.guide)}; lone asks to ${fmt(flag.askLevel)}, reached ${flag.reachedDays}/${flag.nDays}d`;
}

/* rebuyStrandNote({ volDay, fmt }) → the REVERSE-FLIP-SPECIFIC rebuy-reliability caution TEXT. Thin items
   are the RISKIEST reverse-flip because the REBUY leg is the unreliable one (a deep rebuy bid can strand
   while you're out of the position and price ranges/rises away — the live hat 54.05m→cancelled case). This
   is inform-only — it NEVER blocks Ben placing the bid (the strategy's own framing is that the rebuy miss
   is BOUNDED; the book keeps the leg open only while the cycle is declared — H1). RF2 wires it; RF4 reuses it. */
export function rebuyStrandNote({ volDay = null, fmt = String } = {}) {
  const v = num(volDay);
  return `⚠ rebuy may strand (thin, ${v != null ? `${fmt(v)}/d` : 'thin book'})`;
}

/* =============================================================================================
 * RF4 — CYCLE-STATE SURFACING helpers (PLAN-REVERSE-FLIP chunk RF4).
 *
 * PURE, app-safe (no fs / no fetch — the declared-cycle store IO lives in the node-only
 * pipeline/lib/reverseflipstate.mjs). These fold the DECLARED in-flight cycle (awaiting-rebuy /
 * rebuy-armed) into the three READ surfaces — /schedule (read-schedule.mjs), /book (read-book.mjs via
 * book-model.mjs), /positions (quote-items.mjs --positions) — so a capital-free BETWEEN-legs cycle
 * (no open FIFO lot, no GE-slot commitment) stays visible instead of silently vanishing. Additive,
 * INFORM-ONLY, ZERO-RIPPLE: an EMPTY store yields NOTHING extra on every surface (each caller guards on
 * a non-empty pending-entry list — an empty list renders no header, not an empty one). n≈0 throughout —
 * nothing here gates, sizes, or moves a quoted number.
 *
 * NO NEW FETCH (Ruling — reuse existing reads): the live mark + quote `row` (guide/volDay for the thin
 * read) + a pre-rendered drift note are passed in BY THE CALLER from what it already fetched; an item
 * with no in-hand data (e.g. an awaiting-rebuy cycle that isn't an open offer this pass) simply degrades
 * to the store-only fields (sold/BE-rebuy/days-pending) with no thin/drift note.
 * ============================================================================================= */

// REBUY_STALE_DAYS — a rebuy leg (awaiting-rebuy / rebuy-armed) pending longer than this many days is
// "stale intent" worth a display NUDGE (revisit the resting bid; the dip may have passed). SOFTER and far
// shorter than reverseflipstate.mjs's 30-day TTL prune — a nudge, never a delete. PLACEHOLDER (n≈0).
export const REBUY_STALE_DAYS = 3;

/* daysPending(entry, now) → days since the sell leg (soldTs), or the declaration (declaredTs) when there's
   no sell ts, or null when neither is known. `now` is unix-MS (injected so tests are clock/TZ-hermetic). */
export function daysPending(entry, now = Date.now()) {
  const anchor = (entry && entry.soldTs != null) ? entry.soldTs
    : (entry && entry.declaredTs != null ? entry.declaredTs : null);
  if (anchor == null) return null;
  return (now / 1000 - anchor) / 86400;
}

/* rebuyStaleNote(entry, now, { staleDays }) → the REBUY_STALE_DAYS nudge TEXT, or null when the cycle is
   younger than the placeholder floor / undated. No sigil — the caller's note-kind owns it. PURE. */
export function rebuyStaleNote(entry, now = Date.now(), { staleDays = REBUY_STALE_DAYS } = {}) {
  const d = daysPending(entry, now);
  if (d == null || d < staleDays) return null;
  return `⚠ rebuy pending ~${d.toFixed(1)}d (> REBUY_STALE_DAYS ${staleDays}d placeholder — revisit the dip/bid)`;
}

/* reverseFlipPendingEntries(state, { marks, infoById, now }) → the awaiting-rebuy / rebuy-armed entries of
   the declared store, each folded with any ALREADY-IN-HAND live mark + quote `row` the caller passes (NO
   fetch here). `holding` (pre-sell) is excluded — no rebuy leg is in flight yet. PURE; returns [] on an
   empty / all-holding store (the zero-ripple guard every surface leans on).
     marks    — Map<id,{mark,...}> or {id:{mark}} (read-book/quote already build this); mark = live sell price.
     infoById — { [id]: { row?, live?, driftNote? } } — the in-hand computeQuote row (guide/volDay → thin
                read), a live fallback, and an optional pre-rendered note for the `driftNote` slot. All
                optional per id. (DT3: no caller currently populates `driftNote` — see below.) */
export function reverseFlipPendingEntries(state, { marks = new Map(), infoById = {}, now = Date.now() } = {}) {
  const markFor = id => (marks instanceof Map ? marks.get(id) : (marks && marks[id])) || null;
  const out = [];
  for (const e of state || []) {
    if (!e || e.id == null) continue;
    if (e.state !== 'awaiting-rebuy' && e.state !== 'rebuy-armed') continue;
    const info = infoById[e.id] || {};
    const m = markFor(e.id);
    const live = (m && m.mark != null) ? m.mark : (info.live != null ? info.live : null);
    out.push({
      id: e.id,
      name: e.name || ('#' + e.id),
      state: e.state,
      soldQty: e.soldQty ?? null,
      soldEach: e.soldEach ?? null,
      beRebuy: e.beRebuy ?? null,
      rebuyBidPrice: e.rebuyBidPrice ?? null,
      live,
      daysPending: daysPending(e, now),
      thin: isThinBigTicket(info.row || null),
      row: info.row || null,
      // carried so reverseFlipCycleNotes can recompute the stale nudge off the store timestamps.
      soldTs: e.soldTs ?? null,
      declaredTs: e.declaredTs ?? null,
    });
  }
  return out;
}

/* reverseFlipCycleNotes(entry, { row, driftNote, now, fmt }) → the shared inform-only note lines a surfaced
   reverse-flip cycle carries, in order: the thin-item rebuy-may-strand caution (RF6 — thin big-ticket only),
   an optional pre-rendered note in the `driftNote` slot, and the REBUY_STALE_DAYS nudge. PURE; returns []
   when none fire. `entry` may be a raw store entry OR a reverseFlipPendingEntries row (both carry
   soldTs/declaredTs for the stale read and `row`/`thin` context is passed explicitly).
   DT3 (2026-08-09): `driftNote` is a GENERIC pre-rendered note slot and is currently UNFED by every
   caller. It used to carry hourlyDriftNote under the HT4 rationale "a RISING hourly drift is the
   reverse-flip's own bad signal, since you'd rebuy into strength" — that rationale is dead with the slope
   (direction was a coin flip; see hourly-lmh.mjs's tombstone). The slot is kept, not removed, because the
   rebuy side wants a BID-decay read that doesn't exist yet; wire one in here rather than inventing a new
   slot. Until then it stays null and no note prints — an honest absence. */
export function reverseFlipCycleNotes(entry, { row = null, driftNote = null, now = Date.now(), fmt = String } = {}) {
  const notes = [];
  if (isThinBigTicket(row)) notes.push(rebuyStrandNote({ volDay: row ? row.volDay : null, fmt }));
  if (driftNote) notes.push(driftNote);
  const stale = rebuyStaleNote(entry, now);
  if (stale) notes.push(stale);
  return notes;
}
