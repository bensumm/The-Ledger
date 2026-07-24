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
 *     (decision 3) — a stale P&L number is NEVER rendered unlabelled (the caller builds `marks`).
 *
 * CAPITAL MATH IS NOT RE-DERIVED HERE (decision 5): the working/parked/idle split delegates to
 * capital-utilization.mjs's bookUtilization/totalCapital, and the three-tier deployable pool comes
 * verbatim from the loadDerivedCash record. book-model.test.mjs pins the split byte-identical to
 * watch-positions.mjs's SUMMARY footer for the same input, so the two capital surfaces can't drift.
 * Break-even is the ONE tax-capped breakEven() from js/quotecore.js — never a second tax-math home. */
import { breakEven } from '../../js/quotecore.js';
import { bookUtilization, totalCapital } from './capital-utilization.mjs';

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
 *   buy-limit    = limitRemaining (from limits.mjs limitWindow().remaining). A NULL limit is UNKNOWN,
 *                  never unlimited (repo rule) → the sizer REFUSES to recommend a qty.
 *   clearability = floor(dailyVol × clearFrac) — the smaller-side corrected trailing-24h volume × the
 *                  0.5% knee. null when no volume is known (bound simply drops out).
 *   capital      = floor(capital / unitCost) — how many units the deployable gp buys at the acquire price.
 * recommendedQty = min of the present bounds; `binding` names which one is the min (the single most
 *   useful line of the sizer). netIfCycled = recommendedQty × (mark − breakEven) — the SAME after-tax
 *   per-unit margin view (2) shows (breakEven already bakes in the 2% GE tax + TAXCAP). */
export function sizeTranche({
  itemId, name, capital, unitCost, limit, limitRemaining, dailyVol, mark, breakEven: be,
  clearFrac = CLEARABILITY_FRAC,
} = {}) {
  const base = { itemId, name, capital, unitCost, mark, breakEven: be };
  // Repo rule (buy-limit-caps-every-size): a null limit is UNKNOWN — refuse to size, never treat as unlimited.
  if (limit == null) {
    return { ...base, buyLimitBound: null, clearabilityBound: null, capitalBound: null,
      recommendedQty: null, binding: null, netIfCycled: null, refuse: true, refuseReason: 'unknown-limit' };
  }
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
  const netIfCycled = (recommendedQty != null && mark != null && be != null)
    ? Math.round(recommendedQty * (mark - be)) : null;

  return { ...base, buyLimitBound, clearabilityBound, capitalBound,
    recommendedQty, binding, netIfCycled, refuse: false, refuseReason: null };
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
  // slot is absent from this array and correctly reads as free — an accepted log-derived lower bound.
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
    caveat: 'free-slot count is a log-derived lower bound; a just-completed, not-yet-collected slot reads as free (accepted simplification, not a bug)',
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
