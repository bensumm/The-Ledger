/* modules/dip.mjs — the ⬇DIP probe (PM1 reference migration).
 *
 * THEORY (under test — a firing is DATA to score, never a validated edge; rule 4). The live instasell
 * (row.quickBuy) sitting BELOW the item's own 24h AVERAGE LOW (avgLow24) means the item is trading
 * under its recent floor — the super-restore / bludgeon "buyable dip to support" pattern. GATED to a
 * flat/rising, NON-decay/NON-spike, reliable, non-thin quote so it flags a dip-to-support, NOT a
 * falling knife. A market-STATE 'observe' tag; touches no number, feeds no verdict.
 *
 * PROVENANCE. This is the migration of the uncommitted `⬇DIP` prototype that lived inline in
 * screen.mjs (appended to the Regime cell). PM1 lifts it into a probe and moves the tag to the
 * dedicated `Probes` column — same gates, cleaner home, now deletable in one `rm`.
 *
 * SURFACE SEMANTICS. On screen/quote (items you don't own) ⬇DIP reads as a BUY candidate. When
 * owned (watch — a deliberate follow-on, not wired here) the SAME signal inverts to an
 * "average-down window" on a position you already hold; the owned framing is coded below so the
 * follow-on is a one-line surfaces change, not a re-fork.
 */
export const DIP_MIN_PCT = 1.0;   // ignore a sub-1% dip below the 24h avg low as noise
// TWIN CONSTANT (DP1): js/validate.mjs's DIPPOST_MIN_PCT deliberately mirrors this (js/ cannot import
// pipeline/). If this depth threshold moves, move that one too. This probe stays the DEPTH flag only;
// the DIRECTION read (falling vs reverting) is dipPostureValidator + quotecore's recentDirection.

export default {
  name: 'dip',
  version: 1,
  theory: 'live instasell under the 24h avg low, on a flat/rising non-decay reliable book = a buyable dip to support',
  stage: 'observe',
  surfaces: ['screen', 'quote'],   // watch (owned → average-down) is the deliberate follow-on
  probe(row, ctx = {}) {
    if (!row || !row.reliable) return null;              // need a trustworthy price
    if (ctx.thin) return null;                           // a thin band is noisy — don't call a dip off it
    if (!(row.regimeLabel === 'flat' || row.rising)) return null;   // dips-to-support, not fallers
    const ph = ctx.phase && ctx.phase.phase;
    if (ph === 'decay' || ph === 'spike') return null;   // not mid-collapse, not mid-spike
    const avgLow24 = ctx.avgLow24;
    if (avgLow24 == null || row.quickBuy == null) return null;
    if (row.quickBuy >= avgLow24) return null;           // not under its own floor → no dip
    const dipPct = (avgLow24 - row.quickBuy) / avgLow24 * 100;
    if (dipPct < DIP_MIN_PCT) return null;
    const pct = dipPct.toFixed(1);
    // owned → average-down framing (watch follow-on); else the buy-candidate tag (screen/quote).
    const tag = ctx.owned ? `⬇DIP -${pct}% (avg-down window)` : `⬇DIP -${pct}%`;
    return { tag, note: `live instasell under 24h avg low by ${pct}%` };
  },
};
