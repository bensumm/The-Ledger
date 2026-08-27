/* book-model.mjs — the PURE aggregation layer for the /book capital & book dashboard (PLAN-DASHBOARD).
 *
 * A READER's model: it takes already-loaded state (open-lot groups, the live offers snapshot, the
 * derived-cash record, and a caller-built per-item live-mark map) and folds it into three rendered
 * views — (1) capital & GE slots, (2) per-lot P&L board, (5) tranche sizer. It invents NO market
 * model and does NO I/O: no fetch, no fs, no network. Every impure seam (reading the three repo-root
 * JSON files, the per-id fetch union, loadDerivedCash, loadMapping) lives in the command shell
 * pipeline/commands/read-book.mjs — this file is fixture-tested off canned inputs.
 *
 * INFORM-ONLY, never a gate/verdict/alert input — the same honesty class as quote-items.mjs /
 * watch-positions.mjs's read side. Two owner-decided honesty simplifications are carried as data,
 * not silently hidden:
 *   - a just-completed-but-uncollected GE slot reads as FREE (decision 4) — slots.caveat states this;
 *   - a live mark is age-labelled from computeQuote's row.quickStale.sell / row.quoteAgeMin.sell
 *     (decision 3) — on the per-lot P&L BOARD, a stale number is never rendered unlabelled (the caller
 *     builds `marks`, and since 2026-08-09 labels them via the shared `liveAgeTag`).
 *     SCOPE, precisely (the claim above used to be stated tool-wide and was false as written): TWO live
 *     prices on other surfaces are still rendered UNLABELLED — `liveTxt` on reverse-flip pending rows
 *     (below), and `read-book.mjs`'s SIZER `net if cycled once (sell …)` mark. Both are inform-only and
 *     neither feeds the P&L board, but neither carries an age either. Don't cite this header as
 *     tool-wide coverage; label those two if they ever inform a placement.
 *
 * CAPITAL MATH IS NOT RE-DERIVED HERE (decision 5): the working/parked/idle split delegates to
 * capital-utilization.mjs's bookUtilization/totalCapital, and the three-tier deployable pool comes
 * verbatim from the loadDerivedCash record. book-model.test.mjs pins the split byte-identical to
 * watch-positions.mjs's SUMMARY footer for the same input, so the two capital surfaces can't drift.
 * Break-even is the ONE tax-capped breakEven() from js/quotecore.js — never a second tax-math home. */
import { breakEven } from '../../../js/quotecore.js';
import { tax } from '../../../js/money-math.js';   // the ONE tax fn — the sizer only READS it to explain its own sign
import { bookUtilization, totalCapital } from './capital-utilization.mjs';
import { reverseFlipPendingEntries, reverseFlipCycleNotes } from '../../../js/reverseflip.mjs';   // RF4 — declared reverse-flip cycle surfacing (pure)

export const TOTAL_SLOTS = 8;   // members' GE has 8 offer slots

/* CLEARABILITY_FRAC — the sizer's "don't be the whole day's flow" bound: a tranche at or under this
 * fraction of the item's smaller-side daily volume reliably clears close to the quoted price. NOT a
 * fresh constant — it is /scan's own 0.5%-of-daily-volume knee (SKILL.md: "below ~0.5% of daily
 * volume a tranche reliably clears close"; docs/MARKET-ANALYSIS.md's 0.5%/1% reach-relief knee).
 * PLACEHOLDER (n≈0, borrowed judgment), F1-routed like every other sizing threshold. */
export const CLEARABILITY_FRAC = 0.005;

/* sizeTranche(inp) -> the tranche-sizer result (view 5). PURE: takes the already-fetched/derived
 * ingredients and folds them into three independent bounds, the min, and the net-if-cycled. The
 * three bounds:
 *   buy-limit    = limitRemaining (limits.mjs limitWindow().remaining). NULL = UNKNOWN, never
 *                  unlimited: the bound drops out, the size is NOT limit-checked, the render says so.
 *   clearability = floor(dailyVol × clearFrac) — the smaller-side corrected trailing-24h volume × the
 *                  0.5% knee. null when no volume is known (bound simply drops out).
 *   capital      = floor(capital / unitCost) — how many units the deployable gp buys at the acquire price.
 * recommendedQty = min of the present bounds; `binding` names which one is the min (the single most
 *   useful line of the sizer). netIfCycled = recommendedQty × (mark − breakEven) — the SAME after-tax
 *   per-unit margin view (2) shows (breakEven already bakes in the 2% GE tax + TAXCAP).
 *
 * WHAT netIfCycled IS, stated because it HAS been misread: unitCost is quickBuy (latest.low) and mark
 * is quickSell (latest.high), so on a WELL-ORDERED feed it is the impatient round trip and goes
 * negative when the spread is thinner than the tax. A negative means "too thin to flip impatiently",
 * NEVER "this flip loses money" — the patient exit is a different number and lives in the screen's
 * Est. sell. An agent read one of these as a verdict on the flip and rejected six real candidates.
 *
 * `netPerUnit` / `spreadPct` / `taxPct` / `spreadVsTax` are computed and DELIBERATELY NOT RENDERED.
 * A labelled render was written and pulled after review found three defects that make the obvious
 * wording false, and they are recorded here so the next attempt does not repeat them:
 *   (1) quickBuy <= quickSell is NOT an invariant. `js/quotecore.js` only DETECTS the violation
 *       (`inverted` -> reliableReason='feed-inversion'); 16% of the live snapshot and ~9-10% at the
 *       liquidity gate have low > high, and this file never consults `row.reliable`. On those rows the
 *       round trip really does cross the spread, and spreadPct goes negative.
 *   (2) taxPct is wrong for BONDS, which are exempt from the 2% tax and pay a 10%-of-guide retrade fee
 *       (`js/money-math.js`). `tax(mark)` here is bond-blind, as is the `breakEven(unitCost)` the
 *       caller passes, so a bond's figures are wrong by roughly 6x and a rendered "2% tax" is a lie.
 *   (3) The two percentages have DIFFERENT DENOMINATORS — spread over the buy, tax over the sell — so
 *       the true crossover is tax/(1-tax) ~= 2.041%, not 2%. Any row whose spread lands in that band
 *       reads "spread 2% < 2% tax". This is a band, not a rounding edge.
 * What survives review, and the reason the tests below are kept: `spreadVsTax` is derived from
 * netPerUnit's SIGN, never from comparing the two percentages, so the comparator cannot contradict the
 * number it sits beside. That distinction is the whole lesson and it is pinned by 6 cases in
 * book-model.test.mjs, each verified RED against its named mutant. */
export function sizeTranche({
  itemId, name, capital, unitCost, limit, limitRemaining, dailyVol, mark, markAgeTag = '', breakEven: be,
  clearFrac = CLEARABILITY_FRAC,
} = {}) {
  const base = { itemId, name, capital, unitCost, mark, markAgeTag, breakEven: be };
  // Unknown limit: not unlimited, but no reason to withhold a size — the other bounds still apply.
  const buyLimitBound = (limitRemaining == null) ? null : Math.max(0, limitRemaining);
  const clearabilityBound = (dailyVol != null && dailyVol > 0) ? Math.floor(dailyVol * clearFrac) : null;
  const capitalBound = (unitCost > 0 && capital > 0) ? Math.floor(capital / unitCost) : null;

  const bounds = [
    ['buy-limit', buyLimitBound],
    ['clearability', clearabilityBound],
    ['capital', capitalBound],
  ].filter(([, v]) => v != null);

  let recommendedQty = null, binding = null;
  for (const [label, v] of bounds) {
    if (recommendedQty == null || v < recommendedQty) { recommendedQty = v; binding = label; }
  }
  const netPerUnit = (mark != null && be != null) ? mark - be : null;
  const netIfCycled = (recommendedQty != null && netPerUnit != null)
    ? Math.round(recommendedQty * netPerUnit) : null;
  // The REASON for netIfCycled's sign (see header): spread captured vs tax paid — the spread as a % of
  // the buy, the tax as a % of the sell. Null whenever a leg is missing; never a fabricated 0%. NOT
  // RENDERED — see the header's three defects before wiring these to any surface. spreadPct is
  // NEGATIVE on a crossed feed and taxPct is bond-blind; neither is guarded here.
  const spreadPct = (mark != null && unitCost > 0) ? ((mark - unitCost) / unitCost) * 100 : null;
  const taxPct    = (mark != null && mark > 0) ? (tax(mark) / mark) * 100 : null;
  // spreadVsTax is derived from netPerUnit's SIGN, never from comparing spreadPct to taxPct. Those two
  // disagree across a whole BAND, not merely at a rounding edge: the percentages have different
  // denominators (header defect 3), so every spread in (taxPct, ~2.041%] reads above the tax while the
  // net is <= 0. breakEven()'s ceil(buy/0.98) adds a second source of the same disagreement — unitCost
  // 100 gives be 103, so a mark of 103 is a netPerUnit of ZERO while spreadPct (3.00%) reads above
  // taxPct (1.94%). Comparing the percentages would print "spread 3% > 1.9% tax" beside a net of 0.
  // The sign cannot. That is the ONE property of this block that survived review — keep it.
  const spreadVsTax = (netPerUnit == null || spreadPct == null || taxPct == null) ? null
    : netPerUnit > 0 ? '>' : netPerUnit < 0 ? '<' : '=';

  return { ...base, buyLimitBound, clearabilityBound, capitalBound,
    recommendedQty, binding, netPerUnit, netIfCycled, spreadPct, taxPct, spreadVsTax,
    refuse: false, refuseReason: null };
}

/* buildBook({ groups, offers, cash, marks, sizer, now }) -> { slots, capital, lots, sizer? }. PURE.
 *   groups  — readOpenPositions().groups: [{ itemId, qty, cost, avgCost, buyTs }]
 *   offers  — readOffersSnapshot() array: [{ slot, side, itemId, item, price, qty, filled, ... }] (active only)
 *   cash    — loadDerivedCash() record: { availableCash, deployablePool, liquidCapital, reservedDeep,
 *             reservedCommitted, ... }
 *   marks   — Map<itemId, { mark, stale, ageMin, name? }>, ONE entry per id in the caller's fetch union,
 *             built from fetchLatest + computeQuote's row.quickStale.sell / row.quoteAgeMin.sell
 *             (decision 3). A missing / null-mark item yields null unrealPL/pctToBE (never a fabricated P&L).
 *   sizer   — optional sizeTranche() input (view 5 runs only with --size). */
export function buildBook({ groups = [], offers = [], cash = {}, marks = new Map(), sizer = null, now = Date.now() } = {}) {
  const markFor = id => (marks instanceof Map ? marks.get(id) : (marks && marks[id])) || null;

  // --- (1) slots -------------------------------------------------------------------------------
  // offers is already latest-per-slot ACTIVE offers (BUYING/SELLING only — activeOffers semantics),
  // so each entry is one occupied slot. Decision 4: a just-completed BOUGHT/SOLD (not-yet-collected)
  // slot is absent from this array and reads as free — an accepted simplification. That makes `free`
  // an UPPER bound and `occupied` the LOWER one: the miss can only ever UNDERCOUNT occupancy, so a
  // caller sizing new offers against `free` must treat it as "at most", never "at least".
  const occupants = offers.map(o => ({
    slot: o.slot, side: o.side, itemId: o.itemId, name: o.item,
    price: o.price, qty: o.qty, filled: o.filled,
  }));
  const occupied = Math.min(TOTAL_SLOTS, occupants.length);
  const slots = {
    total: TOTAL_SLOTS,
    occupied,
    free: Math.max(0, TOTAL_SLOTS - occupied),
    occupants,
    caveat: 'free-slot count is a log-derived UPPER bound (occupancy is the lower bound) — a just-completed, not-yet-collected slot reads as free, so read it as "at most N free" (accepted simplification, not a bug)',
  };

  // --- (1) capital -----------------------------------------------------------------------------
  // workingGp = capital tied in held inventory (Σ group cost). parkedGp = resting-BUY escrow (from the
  // derived-cash record's reservedDeep+reservedCommitted). The %-split delegates to capital-utilization.mjs
  // (decision 5) — never recomputed inline; the deployable tiers come verbatim from `cash`.
  const workingGp = groups.reduce((s, g) => s + (g.cost || 0), 0);
  const parkedGp = (cash.reservedDeep || 0) + (cash.reservedCommitted || 0);
  const capital = {
    workingGp,
    parkedGp,
    ...bookUtilization({ workingGp, parkedGp }),
    ...totalCapital({ workingGp, parkedGp, cashGp: (cash.availableCash == null ? null : cash.availableCash) }),
    deployablePool: cash.deployablePool ?? null,
    availableCash: cash.availableCash ?? null,
    liquidCapital: cash.liquidCapital ?? null,
    reserved: cash.reserved ?? null,
    reservedDeep: cash.reservedDeep ?? null,
    restingDeepN: cash.restingDeepN ?? null,
    cashKnown: !!cash.known,
  };

  // --- (2) lots (per-item P&L board) -----------------------------------------------------------
  const lots = groups.map(g => {
    const m = markFor(g.itemId);
    const be = breakEven(g.avgCost);
    const mark = m && m.mark != null ? m.mark : null;
    const unrealPL = mark != null ? Math.round(g.qty * (mark - be)) : null;
    const pctToBE = mark != null ? (mark - be) / be : null;
    return {
      itemId: g.itemId,
      name: (m && m.name) || g.name || ('#' + g.itemId),
      qty: g.qty,
      avgCost: g.avgCost,
      breakEven: be,
      mark,
      stale: m ? !!m.stale : null,
      ageMin: m && m.ageMin != null ? m.ageMin : null,
      unrealPL,
      pctToBE,
      capTied: g.cost != null ? g.cost : g.qty * g.avgCost,
      daysHeld: g.buyTs != null ? (now / 1000 - g.buyTs) / 86400 : null,
    };
  });

  const out = { slots, capital, lots };
  if (sizer) out.sizer = sizeTranche(sizer);
  return out;
}

/* buildReverseFlipPending(state, { marks, infoById, now, fmt, fmtP }) -> the "Reverse-flip pending" section
 * rows (RF4). A PURE render block (fixture-tested, no fs/fetch — read-book.mjs loads the store + builds the
 * in-hand marks/infoById and calls this): each awaiting-rebuy / rebuy-armed declared cycle → a display row
 * { id, name, state, soldEach, beRebuy, live, daysPending, soldTxt, beRebuyTxt, liveTxt, daysPendingTxt,
 *   thin, notes[] }. Returns [] on an EMPTY / all-holding store — read-book renders NOTHING then (the
 * zero-ripple guard; the section header only prints when this is non-empty). A between-legs cycle owns no
 * open FIFO lot and no GE slot, so it never appears in the SLOTS/BOOK sections — this is its only home.
 * `live` reuses the caller's already-built marks (mark = live sell price); no new fetch. INFORM-ONLY, n≈0. */
export function buildReverseFlipPending(state, { marks = new Map(), infoById = {}, now = Date.now(), fmt = String, fmtP = String } = {}) {
  const entries = reverseFlipPendingEntries(state, { marks, infoById, now });
  return entries.map(e => ({
    id: e.id,
    name: e.name,
    state: e.state,
    soldQty: e.soldQty,
    soldEach: e.soldEach,
    beRebuy: e.beRebuy,
    rebuyBidPrice: e.rebuyBidPrice,
    live: e.live,
    daysPending: e.daysPending,
    thin: e.thin,
    soldTxt: e.soldEach != null ? fmtP(e.soldEach) : '—',
    beRebuyTxt: e.beRebuy != null ? fmtP(e.beRebuy) : '—',
    liveTxt: e.live != null ? fmtP(e.live) : '—',
    daysPendingTxt: e.daysPending != null ? `${e.daysPending.toFixed(1)}d` : '—',
    notes: reverseFlipCycleNotes(e, { row: e.row, driftNote: (infoById[e.id] && infoById[e.id].driftNote) || null, now, fmt }),
  }));
}
