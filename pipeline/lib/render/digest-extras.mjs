// The numeric rows behind the scan's decision digest and the lines printed under it. Pure.

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
