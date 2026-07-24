#!/usr/bin/env node
/**
 * read-schedule.mjs — the buy/sell WINDOW AGENDA (PLAN-SCHEDULE).
 *
 * A presentation/aggregation layer over EXISTING diurnal data — NOT a new market model. Every item
 * runs its own daily buy(dip)/sell(peak) clock; these are exactly the `hourProfile` dip/peak that
 * `read-window-range.mjs --profile` already prints. This command consolidates them into ONE
 * time-sorted agenda ("what to buy/sell, and when") across a chosen set of items, and a per-item
 * dip+peak row pair, sorted by the hours-until-next-window-start column (`In (h)`) ascending.
 *
 * Three MUTUALLY-EXCLUSIVE modes of one entrypoint (not combinable flags):
 *   -c / --current-position   the actionable set — open lots in positions.json ∪ open offers in
 *                             offers.json (money in a GE slot). THE DEFAULT when no flag is passed.
 *   -w / --watchlist          watchlist.json (flat array of item-NAME strings), name→id via loadMapping.
 *   --audit                   flipped-but-not-watchlisted review off positions.json `closed` (trade
 *                             count + realised P/L); NO market fetch, short-circuits before the agenda.
 * (-c and -w may be combined to UNION the two lists; each row is tagged C / W / C/W. --audit is alone.)
 *
 * Honesty (process rule 4): windows are `hourProfile` medians, n≈0, INFORM-ONLY — same class as the
 * diurnal notes. The schedule PLANS, it never gates. Pipeline-only: no APP_VERSION concern.
 *
 * Usage:
 *   node pipeline/commands/read-schedule.mjs            # -c (current positions ∪ offers) — the default
 *   node pipeline/commands/read-schedule.mjs -w         # the watchlist
 *   node pipeline/commands/read-schedule.mjs -c -w      # union of both, tagged
 *   node pipeline/commands/read-schedule.mjs --audit    # flipped-but-not-watchlisted review
 *
 * Structure: a PURE row-building layer (`hoursUntil`/`isInsideWindow`/`agendaRowsForItem`/`buildAudit`)
 * plus a thin IO layer (`buildAgenda` does the fetch, the CLI wrapper prints). Chunk 2's loop banner
 * imports `buildAgenda` + `loopHeaderLine` in-process — no subprocess.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadMapping, fetchTs } from '../lib/marketfetch.mjs';
import { readOpenPositions } from '../lib/positions.mjs';
import { readOffersSnapshot } from '../lib/offers.mjs';
import { hourProfile } from '../../js/windowread.mjs';
import { fmt, fmtHour, fmtHourRange, localTzAbbrev } from '../../js/money-format.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..');
const FETCH_CONCURRENCY = 5;   // copy screen-flip-niches.mjs's constant — keep modest (wiki API ≤15 concurrent)
const PROFILE_NIGHTS = 14;     // same window read-window-range.mjs --profile uses (NIGHTS default 14)

// ── PURE `In (h)` math (fixture-tested in read-schedule.test.mjs) ─────────────────────────────────
// hoursUntil(startH, now) — hours from `now` to the NEXT occurrence of local hour-of-day `startH`,
// rounded to the nearest 0.5h. `now` is a Date (or any {getHours,getMinutes}); startH is a LOCAL
// hour integer 0-23 (hourProfile's dip/peak startH, already local). The `+24 then %24` wraps a
// start that already passed today onto tomorrow uniformly — no midnight special-case branch.
export function hoursUntil(startH, now = new Date()) {
  const nowFrac = now.getHours() + now.getMinutes() / 60;
  const deltaH = ((startH - nowFrac) % 24 + 24) % 24;      // 0 ≤ deltaH < 24, wraps past midnight
  return Math.round(deltaH * 2) / 2;                        // round-half-up to nearest 0.5h
}

// isInsideWindow(startH, endH, nowH) — is the current local hour inside the [startH, endH) window?
// Non-wrapping (startH ≤ endH): startH ≤ nowH < endH. Midnight-spanning (startH > endH, e.g. 22→3):
// nowH ≥ startH OR nowH < endH. A degenerate full-day cluster (startH === endH, spanOf's {0,0}) is
// treated as always-inside. `endH` is spanOf's already-wrapped value, read off the same cluster shape
// every other windowread consumer reads — no new span representation.
export function isInsideWindow(startH, endH, nowH) {
  if (startH === endH) return true;                         // full-day cluster (spanOf {0,0})
  if (startH < endH) return nowH >= startH && nowH < endH;  // non-wrapping window
  return nowH >= startH || nowH < endH;                     // midnight-spanning window
}

// windowInH(startH, endH, now) — the agenda's `In (h)` cell for one window: 0.0 when currently INSIDE
// (never negative), else hoursUntil to the next start. Inside-check first — hoursUntil of an in-window
// start returns ~24 (the start already passed today), so the clamp must precede it.
function windowInH(startH, endH, now) {
  return isInsideWindow(startH, endH, now.getHours()) ? 0 : hoursUntil(startH, now);
}

// ── PURE row building ────────────────────────────────────────────────────────────────────────────
// agendaRowsForItem({ name, tags, profile, now }) — up to 4 rows for one item off its hourProfile:
// the BUY(dip) + SELL(peak) windows, EACH up to 2 (primary + a prominence-ranked SECONDARY). A null
// profile (too thin, <4 traded days) yields ZERO rows. PLAN-MULTI-PEAK-WINDOWS: hourProfile now returns
// additive prominence-ranked `dips[]`/`peaks[]` arrays (length 1–2); `dips[0]`/`peaks[0]` are byte-
// identical to the singular `dip`/`peak`, and index-1 (present only when a second local extremum clears
// the prominence bar) is the secondary. We iterate those arrays and mark the secondary (index-1) row's
// Action `·2`, leaving the primary row's appearance UNCHANGED. Falls back to the singular dip/peak when
// the arrays aren't present (older profile shape / a hand-built fixture), so a length-1 case never
// manufactures a row.
export function agendaRowsForItem({ name, tags = [], profile, now = new Date() }) {
  if (!profile) return [];
  const rows = [];
  const mk = (side, w, idx) => {
    if (!w || w.startH == null || w.endH == null) return;
    const base = side === 'dip' ? 'BUY dip' : 'SELL peak';
    rows.push({
      inH: windowInH(w.startH, w.endH, now),
      startH: w.startH, endH: w.endH,
      item: name,
      action: idx >= 1 ? `${base}·2` : base,   // ·2 = the secondary (prominence-ranked) window
      secondary: idx >= 1,
      level: w.level ?? null,
      tags: [...tags],
    });
  };
  const dips = (Array.isArray(profile.dips) && profile.dips.length) ? profile.dips : (profile.dip ? [profile.dip] : []);
  const peaks = (Array.isArray(profile.peaks) && profile.peaks.length) ? profile.peaks : (profile.peak ? [profile.peak] : []);
  dips.slice(0, 2).forEach((w, i) => mk('dip', w, i));
  peaks.slice(0, 2).forEach((w, i) => mk('peak', w, i));
  return rows;
}

// sortRows(rows) — soonest window first (In (h) ascending), stable for ties.
export function sortRows(rows) {
  return rows.map((r, i) => [r, i]).sort((a, b) => (a[0].inH - b[0].inH) || (a[1] - b[1])).map(x => x[0]);
}

// buildAudit({ closed, watchNames, mapping }) — group positions.json `closed` by itemId (count +
// summed realised), resolve each id's NAME, and surface only ids whose name is NOT in watchlist.json.
// The join is NAME-keyed (watchlist has no ids). Sorted by trade count desc (strongest signal first).
export function buildAudit({ closed, watchNames, mapping }) {
  const byItem = new Map();
  for (const c of closed || []) {
    if (c == null || c.itemId == null) continue;
    const g = byItem.get(c.itemId) || { itemId: c.itemId, trades: 0, realised: 0 };
    g.trades += 1;
    g.realised += Number(c.realised) || 0;
    byItem.set(c.itemId, g);
  }
  const watchSet = new Set((watchNames || []).map(n => String(n).toLowerCase()));
  const rows = [];
  for (const g of byItem.values()) {
    const name = (mapping && mapping.byId && mapping.byId[g.itemId] && mapping.byId[g.itemId].name) || ('#' + g.itemId);
    if (watchSet.has(String(name).toLowerCase())) continue;   // already watchlisted → skip
    rows.push({ itemId: g.itemId, item: name, trades: g.trades, realised: g.realised });
  }
  rows.sort((a, b) => (b.trades - a.trades) || (b.realised - a.realised));
  return rows;
}

// resolveWatchlist(names, mapping) — name→id via mapping.resolve; an unresolvable name (typo, delisted)
// is SKIPPED with a warning, never an abort (the degrade-gracefully convention). PURE given a mapping.
export function resolveWatchlist(names, mapping) {
  const items = [], warnings = [];
  for (const nm of names || []) {
    const r = mapping.resolve(nm);
    if (!r) { warnings.push(`watchlist item "${nm}" did not resolve to an id — skipped`); continue; }
    items.push({ id: r.id, name: r.name });
  }
  return { items, warnings };
}

// loopHeaderLine(rows) — the run-loop banner: the single soonest window across all rows (already
// sorted asc, so rows[0]). null when there's nothing to schedule. Local-zone label to stay a one-liner.
export function loopHeaderLine(rows) {
  if (!rows || !rows.length) return null;
  const r = rows[0];
  const win = `${fmtHour(r.startH)}–${fmtHour(r.endH)} ${localTzAbbrev()}`;
  const when = r.inH <= 0 ? 'now' : `~${r.inH}h`;
  return `⏭ next: ${r.item} ${r.action} ${win} (${when})`;
}

// ── IO helpers (degrade-gracefully, never throw a caller) ────────────────────────────────────────
function readWatchlist(repoRoot) {
  try {
    const arr = JSON.parse(fs.readFileSync(path.join(repoRoot, 'watchlist.json'), 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function readClosed(repoRoot) {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(repoRoot, 'positions.json'), 'utf8'));
    return Array.isArray(p.closed) ? p.closed : [];
  } catch { return []; }
}
// currentIds(repoRoot) — the -c id set: open lots (positions.json) ∪ open offers (offers.json).
function currentIds(repoRoot) {
  const rp = readOpenPositions(path.join(repoRoot, 'positions.json'));
  const groups = (rp && rp.groups) ? rp.groups : [];        // {err} on a bad file → no groups
  const offers = readOffersSnapshot(path.join(repoRoot, 'offers.json'));   // [] on a bad file
  return new Set([...groups.map(g => g.itemId), ...offers.map(o => o.itemId)]);
}

// ── the fetch-backed agenda builder (imported in-process by run-loop.mjs) ─────────────────────────
// buildAgenda({ scope, now, repoRoot }) -> { rows, warnings, itemCount }
//   scope: array subset of ['c','w'] (default ['c']). rows are the sorted agenda; warnings are the
//   per-name resolve failures (skip-not-abort). Fetches ts1h + hourProfile per selected id, pooled at
//   FETCH_CONCURRENCY, each fetch served by marketfetch's 15-min disk cache.
export async function buildAgenda({ scope = ['c'], now = new Date(), repoRoot = REPO } = {}) {
  const mapping = await loadMapping();
  const selected = new Map();   // id -> { name, tags:Set<'C'|'W'> }
  const warnings = [];
  const add = (id, name, tag) => {
    const e = selected.get(id) || { name, tags: new Set() };
    e.tags.add(tag);
    selected.set(id, e);
  };
  if (scope.includes('c')) {
    for (const id of currentIds(repoRoot)) {
      const name = (mapping.byId[id] && mapping.byId[id].name) || ('#' + id);
      add(id, name, 'C');
    }
  }
  if (scope.includes('w')) {
    const { items, warnings: w2 } = resolveWatchlist(readWatchlist(repoRoot), mapping);
    for (const it of items) add(it.id, it.name, 'W');
    warnings.push(...w2);
  }
  const ids = [...selected.keys()];
  const profiles = new Map();
  const queue = [...ids];
  const worker = async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      try { profiles.set(id, hourProfile(await fetchTs(id, '1h'), { nights: PROFILE_NIGHTS })); }
      catch { profiles.set(id, null); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, ids.length) || 1 }, worker));
  const rows = [];
  for (const [id, e] of selected) {
    const tags = [...e.tags].sort();   // 'C' before 'W'
    rows.push(...agendaRowsForItem({ name: e.name, tags, profile: profiles.get(id), now }));
  }
  return { rows: sortRows(rows), warnings, itemCount: ids.length };
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  const AUDIT = argv.includes('--audit');
  const wantC = argv.includes('-c') || argv.includes('--current-position');
  const wantW = argv.includes('-w') || argv.includes('--watchlist');

  if (AUDIT) {
    const mapping = await loadMapping();
    const rows = buildAudit({ closed: readClosed(REPO), watchNames: readWatchlist(REPO), mapping });
    console.log('# Watchlist audit — flipped but NOT in watchlist.json (proposed additions; review, never auto-added)\n');
    if (!rows.length) { console.log('(nothing to propose — every flipped item is already watchlisted)'); return; }
    console.log('| Item | Trades | Realised P/L |');
    console.log('| --- | ---: | ---: |');
    for (const r of rows) console.log(`| ${r.item} | ${r.trades} | ${fmt(r.realised)} |`);
    console.log(`\n${rows.length} unwatchlisted item(s) with logged flips.`);
    return;
  }

  const scope = [];
  if (wantC) scope.push('c');
  if (wantW) scope.push('w');
  if (!scope.length) scope.push('c');   // default = -c

  const { rows, warnings, itemCount } = await buildAgenda({ scope, now: new Date(), repoRoot: REPO });
  for (const w of warnings) console.log(`⚠ ${w}`);
  const scopeLabel = scope.map(s => s === 'c' ? 'current positions' : 'watchlist').join(' ∪ ');
  console.log(`# Window agenda — ${scopeLabel} (${itemCount} item${itemCount === 1 ? '' : 's'}; hourProfile medians, INFORM-ONLY n≈0)\n`);
  if (!rows.length) {
    console.log('(nothing to schedule — no items with a profileable dip/peak clock in this scope)');
    return;
  }
  console.log('| In (h) | Window | Item | Action | Level | List |');
  console.log('| ---: | --- | --- | --- | ---: | --- |');
  for (const r of rows) {
    const inTxt = r.inH === 0 ? 'now' : r.inH.toFixed(1);
    console.log(`| ${inTxt} | ${fmtHourRange(r.startH, r.endH)} | ${r.item} | ${r.action} | ${fmt(r.level)} | ${r.tags.join('/')} |`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e && e.stack || e); process.exit(1); });
}
