/* derive-cash-tiers.mjs — DERIVE idle cash from the log + an anchor, instead of asking Ben to re-state it.
 *
 * PLAN-CASH-TRACKING: cash is conserved (zero-sum) — it only moves when a buy fills (out), a sell
 * fills (in, after the 2% tax), or Ben injects/withdraws. The fills log records the first two with
 * the full offer lifecycle, so idle cash is a DERIVED balance off a starting anchor, not a figure to
 * poll a human for. This supersedes cash-anchor.mjs's old "the cash stack can only be stated" premise:
 * a stated `{cashGp, statedAt}` is now the ANCHOR the derivation runs forward from, not the answer.
 *
 * The THREE-TIER accounting model (relative to anchor {cashGp0, statedAt}) — Ben's insight: not all
 * resting bids are equally reclaimable, so "how much can I deploy?" has three honest answers, and they
 * always order availableCash ≤ deployablePool ≤ liquidCapital:
 *   liquidCapital  = cashGp0 + Σ sellNet(settled after statedAt) − Σ buySpent(settled after statedAt)
 *                    ── every coin you'd have if ALL resting bids were cancelled (the loosest "everything
 *                       is cancellable in principle" pool). Too loose to size a fresh commitment against:
 *                       it treats a near-live flip bid you EXPECT to fill as freely reclaimable.
 *   deployablePool = availableCash + Σ escrow of DEEP/reclaimable resting bids only
 *                    ── coins free now PLUS the escrow of bids priced so far below the market they're
 *                       designed to mostly-not-fill (an asym/flush optionality bid ~10% under live) —
 *                       genuinely cancellable without abandoning an imminent fill. THE deploy denominator:
 *                       the scan-gate (loop-tick) and the value niche's --capital default use this.
 *   availableCash  = liquidCapital − Σ restingBuyEscrow(ALL active unfilled bids)
 *                    ── coins free to commit right now without cancelling anything (the literal in-game
 *                       stack; what the idle-cash footer's stack figure shows).
 *
 * The DEEP-vs-COMMITTED classifier (classifyBid): a resting BUY is DEEP (reclaimable) when its price
 * sits at least DEEP_BID_PCT below a MARKET REFERENCE (the item's live instasell or its 2h band low);
 * otherwise COMMITTED (semi-committed — at/near the band low, expected to fill imminently, so counting
 * its escrow as free deployable would over-count). PURITY: cashderive does NOT fetch the market — the
 * reference is SUPPLIED BY THE CALLER as `{ marketRef }` (a Map/object of itemId → {live, bandLow}, or a
 * classifier callback). CONSERVATIVE DEFAULT (honest): when NO reference is available for a bid (caller
 * passed none, or the item is missing from the ref), the bid is classified COMMITTED — so a missing ref
 * can only shrink deployablePool toward availableCash, NEVER inflate the deployable figure. DEEP_BID_PCT
 * is a PLACEHOLDER (n≈0) pending calibration (process rule 4).
 *
 * Escrow / double-count guard: a partially-filled buy has its FILLED leg in buySpent (spent) and its
 * UNFILLED remainder ((qty−filled)×price) in escrow — summed once each, never the whole qty×price twice.
 * banked (pre-owned stock declared at a basis) and withdraw (inventory taken for personal use) carry
 * NO cash flow — excluded from both legs.
 *
 * The INJECTION DETECTOR (Ben's "auto-detect added capital"): the model self-heals in ONE direction.
 * If availableCash < 0 (equivalently restingEscrow > liquidCapital) the books are contradictory — Ben
 * committed more gp than the anchor knew he had, only possible if he INJECTED capital the anchor missed.
 * Resting escrow is therefore a HARD LOWER BOUND on the true balance: raise the anchor to fit and report
 * the inferred injection. It cannot self-heal the other way — an off-ledger WITHDRAWAL or a MISSED LOG
 * (RuneLite off / an untracked device — a missed sell looks like an injection, a missed buy looks like an
 * over-estimate) leaves the derived cash too HIGH. Ben's rule collapses that whole class to one rare
 * manual DOWN signal ("I'm short") = a re-anchor via cash.mjs. HONEST LIMIT (process rule 4): this is
 * DETERMINISTIC ACCOUNTING, exactly as correct as the log is complete — the injection detector is a
 * convenience, not a proof of correctness.
 *
 * Known v1 assumption (the one genuine subtlety): a BUY placed before statedAt but filling after is
 * counted as a full post-anchor outflow even though its reservation was already excluded from a
 * coin-stack anchor — a small straddle error. Mitigated by stating the anchor between trades, the
 * injection detector, and the manual re-anchor. Documented, not yet modelled.
 *
 * PURE (deriveCash) + a thin fs loader (loadDerivedCash). Never a verdict/alert input — output-only,
 * like the cashstate figure it derives from. Node-only consumer → no APP_VERSION concern. */
import fs from 'node:fs';
import path from 'node:path';
import { collapseOffers, dedupeSnapshots, GE_TAX } from './reconstruct.mjs';
import { readCash } from './cash-anchor.mjs';
import { readOffersSnapshot } from './offers.mjs';
import { REPO_DIR } from '../sync-fills.mjs';

/* DEEP_BID_PCT — a resting BUY is DEEP (reclaimable) when its price is at least this fraction below the
 * market reference. PLACEHOLDER (start 5%, n≈0) pending calibration against realized fill data (process
 * rule 4): we have no evidence yet on where "designed to mostly-not-fill" actually starts. */
export const DEEP_BID_PCT = 0.05;

/* classifyBid(price, ref) -> 'deep' | 'committed'. PURE. `ref` is the supplied market reference for this
 * item: a number, or `{ live, bandLow }` (live instasell / robust 2h band low), or null. When both a live
 * and a band-low are present we take the LOWER as the reference (the most conservative anchor — a bid must
 * clear DEEP_BID_PCT below even the lower of the two to count as DEEP). No usable reference → 'committed'
 * (the conservative default: a missing ref must never inflate deployablePool). */
export function classifyBid(price, ref) {
  if (!(price > 0)) return 'committed';
  let refPrice = null;
  if (typeof ref === 'number') refPrice = ref > 0 ? ref : null;
  else if (ref && typeof ref === 'object') {
    const cands = [ref.live, ref.bandLow].filter(v => typeof v === 'number' && v > 0);
    refPrice = cands.length ? Math.min(...cands) : null;
  }
  if (refPrice == null) return 'committed';          // no reference → conservative
  return price <= refPrice * (1 - DEEP_BID_PCT) ? 'deep' : 'committed';
}

/* Resolve the reference for one offer from a marketRef (Map | object keyed by itemId | classifier
 * callback). A callback returns the class directly ('deep'/'committed'); a map/object yields the
 * {live,bandLow} record classifyBid consumes. Missing key / null marketRef → 'committed'. */
function classifyOfferBid(offer, marketRef) {
  if (typeof marketRef === 'function') return marketRef(offer) === 'deep' ? 'deep' : 'committed';
  let ref = null;
  if (marketRef instanceof Map) ref = marketRef.get(offer.itemId) ?? marketRef.get(String(offer.itemId)) ?? null;
  else if (marketRef && typeof marketRef === 'object') ref = marketRef[offer.itemId] ?? marketRef[String(offer.itemId)] ?? null;
  return classifyBid(offer.price, ref);
}

/* restingBuyEscrow(liveOffers, marketRef) -> gp reserved by currently-resting BUY offers = Σ (qty−filled)×
 * price on the buy side, SPLIT into DEEP (reclaimable) vs COMMITTED via classifyOfferBid + the supplied
 * marketRef. Sourced from the LIVE offers.json snapshot, NOT from the fills-log collapse: fills.json is the
 * historical FILL record and goes stale on current offer-open state (an old placement whose cancel/expire
 * terminal was never logged reads as a phantom open bid). offers.json is the live book (written by
 * sync/watch-log from the exchange log), so it is the authoritative escrow source. Omitted marketRef →
 * every resting bid classifies COMMITTED (reservedDeep 0) — the conservative default. */
export function restingBuyEscrow(liveOffers, marketRef = null) {
  let reserved = 0, reservedDeep = 0, reservedCommitted = 0, restingN = 0, restingDeepN = 0;
  for (const o of liveOffers || []) {
    if (!o || o.side !== 'buy') continue;
    const rem = Math.max(0, (o.qty || 0) - (o.filled || 0)) * (o.price || 0);
    if (rem <= 0) continue;
    reserved += rem; restingN++;
    if (classifyOfferBid(o, marketRef) === 'deep') { reservedDeep += rem; restingDeepN++; }
    else reservedCommitted += rem;
  }
  return { reserved, reservedDeep, reservedCommitted, restingN, restingDeepN };
}

/* deriveCash(events, anchor, liveOffers, { marketRef }) -> the derived-cash record. PURE.
 *   events     — the fills.json event stream (each { ts:epochSec, type, state, price, qty, filled, spent, ... });
 *                source of the REALIZED cash flow (completed + open-partial fills).
 *   anchor     — {cashGp, statedAt}|null; null → known:false (liquid/available/deployable null; flow + escrow still reported).
 *   liveOffers — the live offers.json array ([{ side, price, qty, filled, itemId, ... }]); source of resting-bid ESCROW.
 *                Omitted/[] → escrow 0 (availableCash == deployablePool == liquidCapital; correct when nothing is resting).
 *   marketRef  — SUPPLIED market reference (Map | object itemId→{live,bandLow} | classifier callback) used to split
 *                resting-bid escrow into DEEP (reclaimable) vs COMMITTED. Absent / a bid's item missing → that bid is
 *                COMMITTED (conservative: deployablePool falls toward availableCash, never over-counts). NO fetch here. */
export function deriveCash(events, anchor, liveOffers = null, { marketRef = null } = {}) {
  const cashGp0 = anchor && typeof anchor.cashGp === 'number' ? anchor.cashGp : null;
  const anchorSec = anchor && anchor.statedAt ? Date.parse(anchor.statedAt) / 1000 : 0;
  const offers = collapseOffers(dedupeSnapshots(events || []));

  let buyOut = 0, sellIn = 0, buyN = 0, sellN = 0;
  for (const o of offers) {
    const each = o.filled > 0 ? o.spent / o.filled : 0;
    // settled = the fill closed after the anchor (cash moved since we last knew the balance). A currently-
    // resting partial buy still counts its FILLED spend here (those units are bought); its UNFILLED
    // remainder is the escrow leg below — summed once each, never the whole qty×price twice.
    if (o.filled > 0 && o.tsClose > anchorSec) {
      if (o.type === 'buy') { buyOut += o.spent; buyN++; }
      else if (o.type === 'sell') { sellIn += o.spent - GE_TAX(each) * o.filled; sellN++; }
      // banked / withdraw → no cash flow (pre-owned stock / personal-use withdrawal)
    }
  }
  const { reserved, reservedDeep, reservedCommitted, restingN, restingDeepN } = restingBuyEscrow(liveOffers, marketRef);

  const netFlow = Math.round(sellIn - buyOut);
  const base = { netFlow, reserved: Math.round(reserved), reservedDeep: Math.round(reservedDeep),
    reservedCommitted: Math.round(reservedCommitted), buyOut: Math.round(buyOut),
    sellIn: Math.round(sellIn), buyN, sellN, restingN, restingDeepN, inferredInjection: 0 };
  if (cashGp0 == null) {
    return { known: false, cashGp0: null, statedAt: null, liquidCapital: null, deployablePool: null, availableCash: null, ...base };
  }

  let liquidCapital = cashGp0 + netFlow;
  let availableCash = liquidCapital - base.reserved;
  let inferredInjection = 0;
  // INJECTION DETECTOR: reserved bids exceed the tracked balance → capital was added the anchor missed.
  if (availableCash < 0) {
    inferredInjection = -availableCash;      // raise the anchor to make the books consistent
    liquidCapital += inferredInjection;
    availableCash = 0;
  }
  // deployablePool = free stack + the escrow of DEEP (reclaimable) bids only. Computed AFTER the injection
  // clamp so the ordering availableCash ≤ deployablePool ≤ liquidCapital always holds (reservedDeep ≤ reserved).
  const deployablePool = availableCash + base.reservedDeep;
  return { known: true, cashGp0, statedAt: anchor.statedAt,
    liquidCapital: Math.round(liquidCapital), deployablePool: Math.round(deployablePool),
    availableCash: Math.round(availableCash),
    ...base, inferredInjection: Math.round(inferredInjection) };
}

/* loadEvents(repoDir) -> the fills.json event array (handles a bare array or {events}/{fills} wrapper). */
export function loadEvents(repoDir = REPO_DIR) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(repoDir, 'fills.json'), 'utf8'));
    if (Array.isArray(j)) return j;
    return j.events || j.fills || [];
  } catch { return []; }
}

/* loadDerivedCash(repoDir, { marketRef }) -> deriveCash over the committed fills.json (flow) + the live
 * offers.json (escrow) + the stored anchor. The impure seam the consumers (cash.mjs, watch.mjs footer,
 * loop-tick scan-gate, screen.mjs --capital) call. `marketRef` is threaded through unchanged so a caller
 * that has live prices in hand can classify deep-vs-committed bids; absent it, deployablePool == availableCash. */
export function loadDerivedCash(repoDir = REPO_DIR, { marketRef = null } = {}) {
  const liveOffers = readOffersSnapshot(path.join(repoDir, 'offers.json'));
  return deriveCash(loadEvents(repoDir), readCash(repoDir), liveOffers, { marketRef });
}
