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
