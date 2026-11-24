// The numeric rows behind the scan's decision digest and the lines printed under it. Pure except digest-prev.json.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
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

const age = ms => ms < 3600e3 ? `${Math.max(0, Math.round(ms / 60e3))}m` : ms < 48 * 3600e3 ? `${(ms / 3600e3).toFixed(1)}h` : `${Math.round(ms / 86400e3)}d`;

/* prev = { ts, rows: { [id]: { name, mode, verdict, grade } } } for the SAME scan scope, or null. */
export function digestDiffLine(prev, digestRows, { now = Date.now(), goneWhy = () => null, partial = [] } = {}) {
  if (partial.length) return `Δ skipped: partial scan (${partial.join('; ')})${prev ? `; baseline from ${age(now - prev.ts)} ago kept` : ''}`;
  if (!prev) return null;
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
