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

const mdCells = l => l.trim().replace(/^\||\|$/g, '').split(/\s\|\s/).map(c => c.trim());
const isMdRow = l => /^\s*\|/.test(String(l));
const isSep = l => /^\s*\|[\s|:-]+\|\s*$/.test(String(l));

/* Markdown tables inside `lines` sections (amplitude, watchlist, digest) → [{headers, rows}]. */
function mdTables(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!(isMdRow(lines[i]) && isSep(lines[i + 1] ?? ''))) continue;
    const headers = mdCells(lines[i]), rows = [];
    for (i += 2; i < lines.length && isMdRow(lines[i]); i++) rows.push(mdCells(lines[i]));
    out.push({ headers, rows });
  }
  return out;
}

const modeFor = (payload, r, i) => { const head = headOf(r); return head ? modeOf(head) : `${payload.kind || 'report'}${i}`; };

/* One entry per table (real or markdown-in-lines): { mode, headers, rows:[string[]] }. mode = first word of the report's `## ` heading. */
export function tablesOf(payload) {
  const out = [];
  (payload.reports || []).forEach((r, i) => {
    const mode = modeFor(payload, r, i);
    (r.sections || []).forEach(s => {
      if (s.type === 'table' && Array.isArray(s.headers)) out.push({ mode, headers: s.headers, rows: (s.rows || []).map(row => row.map(cellText)) });
      else if (s.type === 'lines') for (const t of mdTables(s.lines || [])) out.push({ mode, ...t });
    });
  });
  return out;
}

/* Every free-text line of the dump → [{mode, text, owner}]; a block note's continuation lines inherit the item they follow. */
export function notesOf(payload) {
  const out = [];
  (payload.reports || []).forEach((r, i) => {
    const mode = modeFor(payload, r, i);
    (r.sections || []).forEach(s => {
      if (s.type === 'lines') (s.lines || []).forEach(l => { if (l && !isMdRow(l)) out.push({ mode, text: String(l) }); });
      else if (s.type === 'alerts') (s.items || []).forEach(a => out.push({ mode, text: String(a.msg ?? a) }));
      else if (s.type === 'notes') {
        const names = new Map();
        for (const n of s.items || []) { const m = typeof n === 'object' && n.itemId != null && /^- ([^:]+):/.exec(n.text || ''); if (m) names.set(n.itemId, m[1]); }
        let owner = null;
        for (const n of s.items || []) {
          const text = typeof n === 'string' ? n : String(n.text ?? '');
          if (typeof n === 'object' && n.itemId != null) owner = names.get(n.itemId) ?? null;
          else { const m = /^- ([^:]+):/.exec(text); if (m) owner = m[1]; }
          out.push({ mode, text, owner });
        }
      }
    });
  });
  return out;
}

export function noteLines(payload, { items = [], mode = null } = {}) {
  const seen = new Set(), lines = [];
  for (const n of notesOf(payload)) {
    if (mode && n.mode !== lc(mode)) continue;
    if (items.length && !(matches(n.text, items) || (n.owner && matches(n.owner, items)))) continue;
    const t = n.text.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    lines.push(`note: ${t}`);
  }
  return lines;
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

export function dropLines(payload, { items = [] } = {}) {
  const out = [];
  if (items.length) {
    for (const r of payload.reports || []) {
      const d = r.drops;
      if (!d) continue;
      const head = headOf(r), m = head ? modeOf(head) : 'report';
      for (const x of d.rejected || []) if (matches(x.name, items)) out.push(`${m}: ${x.name} REJECTED - ${x.reason}`);
      for (const w of d.winnersFiltered || []) if (matches(w.name, items)) out.push(`${m}: ${w.name} filtered (shown net ${w.net})`);
      for (const n of d.skippedUnprofitable || []) if (matches(n, items)) out.push(`${m}: ${n} skipped unprofitable at the shown pair`);
    }
    if (!out.length) out.push(`no drop record names ${items.map(s => `"${s}"`).join(' / ')} (reject names are kept per niche, capped at 100, in dumps written after they landed; crowded-out candidates are count-only)`);
    return out;
  }
  for (const r of payload.reports || []) {
    const d = r.drops;
    if (!d) continue;
    const head = headOf(r);
    out.push(`# ${head ? modeOf(head) : 'report'}: ${d.reject ?? 0} rejected`);
    if ((d.rejected || []).length) out.push(`  rejected names kept: ${d.rejected.length} (--drops --item <name>)`);
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
