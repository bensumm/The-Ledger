/* capitalutil.mjs — #3 capital-utilization analytics (PLAN-YIELD). Yield is often lost to IDLE
   capital (gp parked in unfilled bids) and slow fills more than to bad picks; this makes that
   visible. PURE — output-only, never a verdict/alert input.

   Two reads:
     bookUtilization — a POINT-IN-TIME split of committed capital (working = held inventory able to
       profit; parked = resting unfilled bids). watch.mjs feeds it the live exposure/bid totals.
     parkedStats    — a HISTORICAL "how long bids sat" read over outcomes campaigns, off the MEASURED
       parkedSec/velocityClass YS1 records. Honest: a per-item read off a handful of lots is a LABEL,
       not a rate (the ~116-lot concentration caveat applies). */
import { median } from './cli.mjs';

/* bookUtilization({ workingGp, parkedGp }) -> { workingGp, parkedGp, committed, utilizationPct }.
   utilizationPct = working / (working + parked), null when no capital is committed. */
export function bookUtilization({ workingGp = 0, parkedGp = 0 } = {}) {
  const w = workingGp || 0, p = parkedGp || 0;
  const committed = w + p;
  const utilizationPct = committed > 0 ? Math.round((w / committed) * 100) : null;
  return { workingGp: w, parkedGp: p, committed, utilizationPct };
}

/* totalCapital({ workingGp, parkedGp, cashGp }) -> the WHOLE pool, not just the committed split.
   committedGp = working + parked (capital in offers/inventory). cashGp = idle bank GP that earns
   nothing — the biggest efficiency leak, but NOT derivable from any log (the GE cash stack isn't in
   fills/positions/offers), so it is a STATED figure (pipeline/cash.mjs) or null when unknown.
   cashGp null  -> totalGp/committedPct/idlePct all null (we only know the committed absolute; never
     fake an idle % we can't measure).
   cashGp given (incl. 0) -> totalGp = committed + cash; committedPct = committed/total; idlePct =
     cash/total (rounded, summing to 100). */
export function totalCapital({ workingGp = 0, parkedGp = 0, cashGp = null } = {}) {
  const committedGp = (workingGp || 0) + (parkedGp || 0);
  if (cashGp == null) return { committedGp, cashGp: null, totalGp: null, committedPct: null, idlePct: null };
  const cash = cashGp || 0;
  const totalGp = committedGp + cash;
  if (totalGp <= 0) return { committedGp, cashGp: cash, totalGp, committedPct: null, idlePct: null };
  const committedPct = Math.round((committedGp / totalGp) * 100);
  return { committedGp, cashGp: cash, totalGp, committedPct, idlePct: 100 - committedPct };
}

/* parkedStats(campaigns) -> distribution + idle read over the outcomes campaign records.
   nBids / nFilledBids / nNeverFilled, medianParkedSec (of FILLED bids), and the velocityClass mix. */
export function parkedStats(campaigns) {
  const cs = campaigns || [];
  const bids = cs.filter(c => c.side === 'buy');
  const filled = bids.filter(c => c.everFilled && c.parkedSec != null);
  const neverFilled = bids.filter(c => !c.everFilled);
  const parkedSecs = filled.map(c => c.parkedSec).filter(s => s != null);
  const velocityDist = {};
  for (const c of cs) { const v = c.velocityClass || 'n/a'; velocityDist[v] = (velocityDist[v] || 0) + 1; }
  return {
    nBids: bids.length,
    nFilledBids: filled.length,
    nNeverFilled: neverFilled.length,
    medianParkedSec: parkedSecs.length ? median(parkedSecs) : null,
    velocityDist,
  };
}
