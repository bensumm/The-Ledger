/* last-report-rows.mjs — PURE reader over a pipeline/.cache/last-report/<kind>.json payload (no fetch, no fs).
 * Cells are display cells ({t,c,title}) or strings; there are no numeric fields, only the text the table printed.
 * digestRows (top-level array, written by the scan) is the structured exception. Consumer: commands/read-rows.mjs. */
export const STALE_MIN = 30;
export const cellText = c => (c == null ? '' : typeof c === 'string' ? c : c.t != null ? String(c.t) : '');
const lc = s => String(s).toLowerCase();
const headOf = r => (r.sections || []).flatMap(s => s.lines || []).find(l => /^##\s/.test(String(l)));
const modeOf = head => lc(String(head).replace(/^##\s+/, '').split(/[\s—-]/)[0]);

export function ageMin(generatedAt, now = Date.now()) {
  const t = Date.parse(generatedAt);
  return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 60000)) : null;
}

export function ageLine(kind, generatedAt, now) {
  const a = ageMin(generatedAt, now);
  if (a == null) return `${kind} age unknown (no generatedAt) - STALE?`;
  return `${kind} ${a}m old${a > STALE_MIN ? ` - STALE (>${STALE_MIN}m), re-run the read` : ''}`;
}

/* One entry per table section: { mode, headers, rows:[string[]] }. mode = first word of the report's `## ` heading. */
export function tablesOf(payload) {
  const out = [];
  (payload.reports || []).forEach((r, i) => {
    const head = headOf(r);
    const mode = head ? modeOf(head) : `${payload.kind || 'report'}${i}`;
    (r.sections || []).forEach(s => {
      if (s.type === 'table' && Array.isArray(s.headers)) out.push({ mode, headers: s.headers, rows: (s.rows || []).map(row => row.map(cellText)) });
    });
  });
  return out;
}

export function digestRowsOf(payload) {
  if (Array.isArray(payload.digestRows)) return payload.digestRows;
  const r = (payload.reports || []).find(x => Array.isArray(x.digestRows));
  return r ? r.digestRows : null;
}

/* resolveCols(headers, wanted) → { idx, bad }; a name matches a header exactly, else by unique substring (case-insensitive). */
export function resolveCols(headers, wanted) {
  const idx = [], bad = [];
  for (const w of wanted) {
    let i = headers.findIndex(h => lc(h) === lc(w));
    if (i < 0) { const m = headers.map((h, k) => (lc(h).includes(lc(w)) ? k : -1)).filter(k => k >= 0); if (m.length === 1) i = m[0]; }
    if (i < 0) bad.push(w); else idx.push(i);
  }
  return { idx, bad };
}

const matches = (name, items) => !items.length || items.some(s => lc(name).includes(lc(s)));
const fmtVal = v => (v == null ? '—' : String(v));

/* rowLines(tables, {items, mode, cols, limit}) → { lines } | { error } — the error names what IS available. */
export function rowLines(tables, { items = [], mode = null, cols = null, limit = null } = {}) {
  const pool = tables.filter(t => !mode || t.mode === lc(mode));
  if (!pool.length) return { error: `no table for mode "${mode}". available: ${[...new Set(tables.map(t => t.mode))].join(', ') || '(none)'}` };
  const lines = [];
  for (const t of pool) {
    const ic = Math.max(0, t.headers.findIndex(h => lc(h) === 'item'));
    const want = cols && cols.length ? resolveCols(t.headers, cols) : { idx: t.headers.map((_, i) => i).filter(i => i !== ic), bad: [] };
    if (want.bad.length) return { error: `unknown column ${want.bad.join(', ')} in ${t.mode}. available: ${t.headers.join(', ')}` };
    let hit = t.rows.filter(r => matches(r[ic], items));
    if (limit != null) hit = hit.slice(0, limit);
    if (hit.length) lines.push(`# ${t.mode} (${hit.length} of ${t.rows.length} rows)`);
    for (const r of hit) lines.push([r[ic], ...want.idx.map(i => `${t.headers[i]}=${r[i]}`)].join(' | '));
  }
  if (!lines.length) {
    const names = pool.flatMap(t => t.rows.map(r => r[Math.max(0, t.headers.findIndex(h => lc(h) === 'item'))]));
    return { error: `no row matches ${items.map(s => `"${s}"`).join(' / ')}. ${names.length} items available: ${names.slice(0, 25).join(', ')}${names.length > 25 ? ', …' : ''}` };
  }
  return { lines };
}

export function listLines(payload) {
  const out = tablesOf(payload).map(t => `${t.mode}: ${t.rows.length} rows | columns: ${t.headers.join(', ')}`);
  (payload.reports || []).forEach(r => { if (r.drops) out.push(`drops: present${r.drops.crowdedOut ? ' (with crowdedOut)' : ''}`); });
  const d = digestRowsOf(payload);
  out.push(d ? `digestRows: ${d.length} rows` : 'digestRows: absent');
  return out;
}

export function dropLines(payload) {
  const out = [];
  for (const r of payload.reports || []) {
    const d = r.drops;
    if (!d) continue;
    const head = headOf(r);
    out.push(`# ${head ? modeOf(head) : 'report'}: ${d.reject ?? 0} rejected`);
    for (const [reason, n] of Object.entries(d.rejectReasons || {}).sort((a, b) => b[1] - a[1])) out.push(`  ${n}x ${reason.length > 150 ? reason.slice(0, 147) + '...' : reason}`);
    if ((d.skippedUnprofitable || []).length) out.push(`  skippedUnprofitable: ${d.skippedUnprofitable.join(', ')}`);
    for (const w of d.winnersFiltered || []) out.push(`  winnerFiltered: ${w.name} net ${w.net}`);
    if (d.crowdedOut) out.push(`  crowdedOut: ${d.crowdedOut.count} never fetched | best ${d.crowdedOut.bestName ?? '—'} ${d.crowdedOut.bestGpDay ?? '—'}/d | ${d.crowdedOut.reason ?? '—'}`);
  }
  return out;
}

export function digestLines(payload, { items = [], mode = null, cols = null, limit = null } = {}) {
  const d = digestRowsOf(payload);
  if (!d) return { error: 'no digestRows in this dump (the scan has not written them yet)' };
  let rows = d.filter(r => matches(r.name ?? '', items) && (!mode || lc(r.mode ?? '') === lc(mode)));
  if (!rows.length) return { error: `no digest row matches. ${d.length} rows; items: ${d.slice(0, 25).map(r => r.name).join(', ')}` };
  const keys = Object.keys(d[0]).filter(k => k !== 'name');
  const use = cols && cols.length ? cols : keys;
  const bad = use.filter(c => !keys.includes(c));
  if (bad.length) return { error: `unknown column ${bad.join(', ')}. available: ${keys.join(', ')}` };
  if (limit != null) rows = rows.slice(0, limit);
  return { lines: rows.map(r => [r.name, ...use.map(k => `${k}=${fmtVal(r[k])}`)].join(' | ')) };
}
