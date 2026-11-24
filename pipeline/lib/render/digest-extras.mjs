// The numeric rows behind the scan's decision digest and the lines printed under it. Pure except digest-prev.json.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { sizeTranche, CLEARABILITY_FRAC } from '../capital/book-model.mjs';
import { fmtP } from '../../../js/money-format.js';

const num = x => (typeof x === 'number' && Number.isFinite(x)) ? x : null;

const NO_SIZE = { units: null, gp: null, windows: null, bound: null, clear: null };

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

/* One 4h window, bound by buy limit and capital. `bought` comes off this window only. `clear` is sizeTranche's
 * unvalidated clearability knee: shown, never binding. */
export function sizeDigestRow(r, { capital = null, bought = 0 } = {}) {
  if (!(num(r.bid) > 0)) return NO_SIZE;
  if (num(r.limit) == null) return { ...NO_SIZE, clear: num(r.volDay) == null ? null : Math.floor(r.volDay * CLEARABILITY_FRAC) };
  const at = limitRemaining => {
    if (capital != null && !(capital > 0)) return { units: 0, bound: 'capital' };
    const s = sizeTranche({ capital, unitCost: r.bid, limitRemaining, dailyVol: null });
    return { units: s.recommendedQty, bound: s.binding };
  };
  const clear = num(r.volDay) == null ? null : Math.floor(r.volDay * CLEARABILITY_FRAC);
  const limit = num(r.limit);
  const full = at(limit), now = at(limit == null ? null : Math.max(0, limit - bought));
  const want = Math.floor(num(r.deployUnits) ?? 0);
  const windows = want < 1 || !(full.units > 0) ? null
    : want <= now.units ? 1
    : (now.units > 0 ? 1 : 0) + Math.ceil((want - now.units) / full.units);
  return { units: now.units, gp: now.units == null ? null : Math.round(now.units * r.bid), windows, bound: now.bound, clear };
}

const BOUND_WORD = { 'buy-limit': 'limit', capital: 'capital' };
export function sizeLine(digestRows) {
  if (!digestRows.length) return null;
  const cell = d => {
    const why = [BOUND_WORD[d.bound], d.limit == null ? 'limit unknown' : null].filter(Boolean).join(', ');
    if (d.units == null) return `${d.name} ?${why ? ' ' + why : ''}`;
    if (d.units === 0) return `${d.name} 0u ${why}`;
    return `${d.name} ${d.units.toLocaleString('en-US')}u ${fmtP(d.gp)}${d.windows ? ` x${d.windows}w` : ''} ${why}${d.clear == null ? '' : ` ~${d.clear.toLocaleString('en-US')} clear`}`;
  };
  return `size per 4h window (buy limit left or whole-pool capital; xNw = windows to fill the 2-day deploy column; ~clear = ${CLEARABILITY_FRAC * 100}% of day volume, unvalidated): ${digestRows.map(cell).join(' | ')}`;
}

const age = ms => ms < 3600e3 ? `${Math.max(0, Math.round(ms / 60e3))}m` : ms < 48 * 3600e3 ? `${(ms / 3600e3).toFixed(1)}h` : `${Math.round(ms / 86400e3)}d`;

/* prev = { ts, rows: { [id]: { name, mode, verdict, grade } } } for the SAME scan scope, or null. */
export function digestDiffLine(prev, digestRows, { now = Date.now(), goneWhy = () => null, partial = [] } = {}) {
  if (!prev) return null;
  if (partial.length) return `Δ skipped: partial scan (${partial.join('; ')}); baseline from ${age(now - prev.ts)} ago kept`;
  const ids = new Set(digestRows.map(d => String(d.itemId)));
  const fresh = digestRows.filter(d => !prev.rows[d.itemId]).map(d => d.name);
  const turned = digestRows.filter(d => prev.rows[d.itemId] && prev.rows[d.itemId].verdict !== d.verdict)
    .map(d => `${d.name} ${prev.rows[d.itemId].verdict}→${d.verdict}`);
  const gone = Object.entries(prev.rows).filter(([id]) => !ids.has(id))
    .map(([id, p]) => { const why = goneWhy(Number(id), p); return p.name + (why ? ` (${why})` : ''); });
  const parts = [fresh.length ? `NEW ${fresh.join(', ')}` : null, turned.length ? turned.join(', ') : null, gone.length ? `GONE ${gone.join(', ')}` : null].filter(Boolean);
  return `Δ vs ${age(now - prev.ts)} ago: ${parts.join(' · ') || 'no change'}`;
}

export function readDigestPrev(file, scope) {
  try {
    const p = JSON.parse(readFileSync(file, 'utf8')).scopes[scope];
    return p && Number.isFinite(p.ts) && p.rows && typeof p.rows === 'object' ? p : null;
  } catch { return null; }
}

const KEEP_SCOPES = 8;
export function writeDigestPrev(file, scope, digestRows, { now = Date.now(), partial = [] } = {}) {
  if (partial.length || !digestRows.length) return false;
  let scopes = {};
  try { scopes = JSON.parse(readFileSync(file, 'utf8')).scopes || {}; } catch { /* first run or corrupt */ }
  scopes[scope] = { ts: now, rows: Object.fromEntries(digestRows.map(d => [d.itemId, { name: d.name, mode: d.mode, verdict: d.verdict, grade: d.grade }])) };
  scopes = Object.fromEntries(Object.entries(scopes).sort((a, b) => (b[1]?.ts || 0) - (a[1]?.ts || 0)).slice(0, KEEP_SCOPES));
  try {
    writeFileSync(file + '.tmp', JSON.stringify({ scopes }));
    renameSync(file + '.tmp', file);
    return true;
  } catch { return false; }
}

/* s = { mode, gated, fetched, shown, elsewhere, why: [reason…], excluded: [{id,name,expGpDay,reason}],
 *       picks: [{name,expGpDay}] (this niche's digest rows) }. A crowded-out name prints only when its gp/day
 * beats the weakest of this niche's digest rows. */
export function nicheLine(s) {
  const lost = (s.excluded || []).filter(e => e.reason !== 'watch-reserve-full');
  const rejected = Math.max(0, s.fetched - s.shown - (s.elsewhere || 0));
  const bits = [`${s.shown} shown`, `${rejected} rejected`, s.elsewhere ? `${s.elsewhere} shown in band` : null, `${lost.length} crowded out`].filter(Boolean);
  const best = lost.filter(e => num(e.expGpDay) > 0).sort((a, b) => b.expGpDay - a.expGpDay)[0];
  const weak = (s.picks || []).filter(p => num(p.expGpDay) != null).sort((a, b) => a.expGpDay - b.expGpDay)[0];
  if (best && weak && best.expGpDay > weak.expGpDay)
    bits.push(`⚠ ${best.name} ~${fmtP(best.expGpDay)}/d beats digest row ${weak.name} ~${fmtP(weak.expGpDay)}/d (${best.reason}, never fetched)`);
  if (!s.shown) bits.push('nothing: ' + (s.subFloor || (!s.gated ? 'gate empty' : topReason(s.why) || 'no row survived')));
  return `${s.mode}: ${bits.join(' · ')}`;
}
function topReason(why = []) {
  const n = new Map();
  for (const w of why) n.set(w, (n.get(w) || 0) + 1);
  const [top] = [...n].sort((a, b) => b[1] - a[1]);
  return top ? `${top[0]} x${top[1]}` : null;
}

/* Every lane gets a slot. lanes = [{ label, n, top, note }]; n null = the lane did not run. */
export function coverageLine(lanes) {
  return 'coverage: ' + lanes.map(l => l.n == null ? `${l.label} NOT RUN` : `${l.label} ${l.n}${l.top ? ` (top ${l.top})` : ''}${l.note ? ` ${l.note}` : ''}`).join(' · ');
}
