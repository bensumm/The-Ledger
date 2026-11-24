// The numeric rows behind the scan's decision digest and the lines printed under it. Pure.
import { sizeTranche, CLEARABILITY_FRAC } from '../capital/book-model.mjs';
import { fmtP } from '../../../js/money-format.js';

const num = x => (typeof x === 'number' && Number.isFinite(x)) ? x : null;

const NO_SIZE = { units: null, gp: null, windows: null, bound: null };

export function buildDigestRows(rows, { sizeOf = () => NO_SIZE, prevOf = () => null } = {}) {
  return rows.map(r => ({
    itemId: r.id, name: r.name, mode: r.nicheKey ?? null, grade: r.grade ?? null, verdict: r.verdict ?? null,
    bid: num(r.bid), ask: num(r.ask), netEach: num(r.netEach),
    roi: (num(r.netEach) != null && num(r.bid) > 0) ? Math.round(r.netEach / r.bid * 10000) / 100 : null,
    be: num(r.be), reachHit: num(r.reachHit), reachDays: num(r.reachDays), reachBasis: r.reachBasis ?? null, limit: num(r.limit),
    ...sizeOf(r),
    prev: prevOf(r.id),
  }));
}

/* One 4h window. `bought` comes off this window only, later windows get the full limit. sizeTranche
 * drops a zero-capital bound, so it is applied here as 0. */
export function sizeDigestRow(r, { capital = null, bought = 0 } = {}) {
  if (!(num(r.bid) > 0)) return NO_SIZE;
  const at = limitRemaining => {
    if (capital != null && !(capital > 0)) return { units: 0, bound: 'capital' };
    const s = sizeTranche({ capital, unitCost: r.bid, limitRemaining, dailyVol: r.volDay });
    return { units: s.recommendedQty, bound: s.binding };
  };
  const limit = num(r.limit);
  const full = at(limit), now = at(limit == null ? null : Math.max(0, limit - bought));
  const want = Math.floor(num(r.deployUnits) ?? 0);
  const windows = want < 1 || !(full.units > 0) ? null
    : want <= now.units ? 1
    : (now.units > 0 ? 1 : 0) + Math.ceil((want - now.units) / full.units);
  return { units: now.units, gp: now.units == null ? null : Math.round(now.units * r.bid), windows, bound: now.bound };
}

const BOUND_WORD = { 'buy-limit': 'limit', clearability: 'clear', capital: 'capital' };
export function sizeLine(digestRows) {
  if (!digestRows.length) return null;
  const cell = d => {
    const why = [BOUND_WORD[d.bound], d.limit == null ? 'limit unknown' : null].filter(Boolean).join(', ');
    if (d.units == null) return `${d.name} ?${why ? ' ' + why : ''}`;
    if (d.units === 0) return `${d.name} ${d.bound === 'clearability' ? '<1u' : '0u'} ${why}`;
    return `${d.name} ${d.units.toLocaleString('en-US')}u ${fmtP(d.gp)}${d.windows ? ` x${d.windows}w` : ''} ${why}`;
  };
  return `size per 4h window (smallest of buy limit, clear = ${CLEARABILITY_FRAC * 100}% of day volume, whole-pool capital; xNw = windows to reach the deploy column, which is the 2-day model): ${digestRows.map(cell).join(' | ')}`;
}
