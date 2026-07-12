#!/usr/bin/env node
/* cash.mjs — DERIVE / re-anchor the idle-cash balance the total-capital footer uses (watch.mjs).
 *
 *   node pipeline/cash.mjs          DERIVE cash now = anchor + Σ(sells after tax) − Σ(buys) − resting escrow
 *   node pipeline/cash.mjs 16m      RE-ANCHOR to 16,000,000 (accepts k/m/b + commas) — the manual reset:
 *                                   your first anchor, or the one DOWN correction when you're short / spent
 *                                   gp off-ledger (the only case the log can't see — PLAN-CASH-TRACKING)
 *   node pipeline/cash.mjs clear    forget the anchor (footer reverts to committed-absolute only)
 *
 * Cash is conserved (zero-sum): it only moves when a buy fills (out), a sell fills (in, after the 2% tax),
 * or you inject/withdraw. The fills log records the first two, so idle cash is DERIVED from a stored anchor
 * (lib/cashderive.mjs), not a figure to re-state every pass — this supersedes the old "the cash stack can
 * only be stated" model (cashstate.mjs). The INJECTION DETECTOR auto-raises the anchor when resting bids
 * exceed the tracked balance (you clearly added capital); the ONE thing it can't see is an off-ledger
 * outflow / missed log, which you correct with a bare re-anchor. Output-only — NEVER a verdict/alert input. */
import { parseGp, fmtP } from '../js/format.js';
import { writeCash, clearCash } from './lib/cashstate.mjs';
import { loadDerivedCash } from './lib/cashderive.mjs';

const arg = process.argv[2];

function ageStr(statedAt) {
  if (!statedAt) return '';
  const min = Math.round((Date.now() - new Date(statedAt).getTime()) / 60000);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  return `${h}h${min % 60 ? ' ' + (min % 60) + 'm' : ''} ago`;
}

if (arg == null) {
  const d = loadDerivedCash();
  if (!d.known) {
    console.log('no cash anchor set — set one with:  node pipeline/cash.mjs <amount>  (e.g. 16m)');
    process.exit(0);
  }
  // headline: available now (coin stack) + liquid (incl. cancellable bids) when they differ
  const head = d.availableCash === d.liquidCapital
    ? `idle cash ${fmtP(d.availableCash)}`
    : `idle cash ${fmtP(d.availableCash)} available · ${fmtP(d.liquidCapital)} liquid (incl. ${fmtP(d.reserved)} in ${d.restingN} resting bid${d.restingN === 1 ? '' : 's'})`;
  // provenance: how the derivation got here from the anchor
  const flow = d.netFlow === 0 ? 'no fills since'
    : `${d.netFlow > 0 ? '+' : ''}${fmtP(d.netFlow)} since (${d.sellN} sell${d.sellN === 1 ? '' : 's'} / ${d.buyN} buy${d.buyN === 1 ? '' : 's'})`;
  console.log(`${head}\n  derived from anchor ${fmtP(d.cashGp0)} stated ${ageStr(d.statedAt)} · ${flow}`);
  if (d.inferredInjection > 0) {
    console.log(`  ⤴ inferred +${fmtP(d.inferredInjection)} capital added — resting bids exceeded the tracked balance; re-anchor to confirm.`);
  }
  process.exit(0);
}

if (arg.toLowerCase() === 'clear') {
  console.log(clearCash() ? 'cash anchor cleared.' : 'no cash anchor to clear.');
  process.exit(0);
}

const gp = parseGp(arg);
if (!Number.isFinite(gp) || gp < 0) {
  console.error(`could not parse "${arg}" as a gp amount (try 16m, 500k, 2.5b, or a plain number).`);
  process.exit(1);
}
const rec = writeCash(gp);
console.log(`cash anchor set to ${fmtP(rec.cashGp)} · stated just now. Cash is now DERIVED forward from here (buys/sells/escrow); re-anchor only when you're short or spent gp off-ledger.`);
