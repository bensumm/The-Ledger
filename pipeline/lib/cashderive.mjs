/* cashderive.mjs — DERIVE idle cash from the log + an anchor, instead of asking Ben to re-state it.
 *
 * PLAN-CASH-TRACKING: cash is conserved (zero-sum) — it only moves when a buy fills (out), a sell
 * fills (in, after the 2% tax), or Ben injects/withdraws. The fills log records the first two with
 * the full offer lifecycle, so idle cash is a DERIVED balance off a starting anchor, not a figure to
 * poll a human for. This supersedes cashstate.mjs's old "the cash stack can only be stated" premise:
 * a stated `{cashGp, statedAt}` is now the ANCHOR the derivation runs forward from, not the answer.
 *
 * The accounting model (relative to anchor {cashGp0, statedAt}):
 *   liquidCapital = cashGp0 + Σ sellNet(settled after statedAt) − Σ buySpent(settled after statedAt)
 *                   ── every coin you'd have if all resting bids were cancelled (the redeployable pool;
 *                      what "scan at N capital" should use).
 *   availableCash = liquidCapital − Σ restingBuyEscrow(active unfilled bids)
 *                   ── coins free to commit right now without cancelling anything (the in-game stack;
 *                      what the idle-cash footer should show).
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
import { readCash } from './cashstate.mjs';
import { readOffersSnapshot } from './offers.mjs';
import { REPO_DIR } from '../sync-fills.mjs';

/* restingBuyEscrow(liveOffers) -> gp reserved by currently-resting BUY offers = Σ (qty−filled)×price on
 * the buy side. Sourced from the LIVE offers.json snapshot, NOT from the fills-log collapse: fills.json
 * is the historical FILL record and goes stale on current offer-open state (an old placement whose
 * cancel/expire terminal was never logged reads as a phantom open bid). offers.json is the live book
 * (written by sync/watch-log from the exchange log), so it is the authoritative escrow source. */
export function restingBuyEscrow(liveOffers) {
  let reserved = 0, restingN = 0;
  for (const o of liveOffers || []) {
    if (!o || o.side !== 'buy') continue;
    const rem = Math.max(0, (o.qty || 0) - (o.filled || 0)) * (o.price || 0);
    if (rem > 0) { reserved += rem; restingN++; }
  }
  return { reserved, restingN };
}

/* deriveCash(events, anchor, liveOffers) -> the derived-cash record. PURE.
 *   events     — the fills.json event stream (each { ts:epochSec, type, state, price, qty, filled, spent, ... });
 *                source of the REALIZED cash flow (completed + open-partial fills).
 *   anchor     — {cashGp, statedAt}|null; null → known:false (liquid/available null; flow + escrow still reported).
 *   liveOffers — the live offers.json array ([{ side, price, qty, filled, ... }]); source of resting-bid ESCROW.
 *                Omitted/[] → escrow 0 (availableCash == liquidCapital; correct when nothing is resting). */
export function deriveCash(events, anchor, liveOffers = null) {
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
  const { reserved, restingN } = restingBuyEscrow(liveOffers);

  const netFlow = Math.round(sellIn - buyOut);
  const base = { netFlow, reserved: Math.round(reserved), buyOut: Math.round(buyOut),
    sellIn: Math.round(sellIn), buyN, sellN, restingN, inferredInjection: 0 };
  if (cashGp0 == null) {
    return { known: false, cashGp0: null, statedAt: null, liquidCapital: null, availableCash: null, ...base };
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
  return { known: true, cashGp0, statedAt: anchor.statedAt,
    liquidCapital: Math.round(liquidCapital), availableCash: Math.round(availableCash),
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

/* loadDerivedCash(repoDir) -> deriveCash over the committed fills.json (flow) + the live offers.json
 * (escrow) + the stored anchor. The impure seam the consumers (cash.mjs, watch.mjs footer,
 * screen.mjs --capital) call. */
export function loadDerivedCash(repoDir = REPO_DIR) {
  const liveOffers = readOffersSnapshot(path.join(repoDir, 'offers.json'));
  return deriveCash(loadEvents(repoDir), readCash(repoDir), liveOffers);
}
