#!/usr/bin/env node
/**
 * read-book.mjs — the BOOK / CAPITAL DASHBOARD (/book skill; PLAN-DASHBOARD).
 *
 *   node pipeline/commands/read-book.mjs
 *       The standing "state of the book right now" read: (1) GE slots + capital split,
 *       (2) per-lot P&L board (grouped, at weighted-avg cost).
 *   node pipeline/commands/read-book.mjs --size "<item or id>" [--capital <gp>]
 *       Adds (5) the tranche sizer: given free capital + an item, the recommended buy size bounded by
 *       buy-limit × clearability(volume) × capital, plus which bound is BINDING and the net-if-cycled.
 *       --capital defaults to THIS run's own deployablePool (the three-tier deploy denominator).
 *
 * IMPURE SHELL ONLY. Reads the three repo-root JSON files (positions/offers/fills), does the ONE
 * per-invocation live fetch (fetchItemInputs per id in the held ∪ resting-bid ∪ {sizer} union), builds
 * the marketRef + age-labelled marks map (via computeQuote's row.quickStale.sell/quoteAgeMin.sell),
 * calls loadDerivedCash + book-model.mjs's buildBook, and renders. ALL aggregation math lives in the
 * PURE pipeline/lib/book-model.mjs (fixture-tested). NEVER writes / places / cancels anything.
 *
 * Honesty (inform-only, never a gate): a live mark is age-labelled — a stale P&L number is never
 * rendered as live (decision 3). The free-slot count is a log-derived LOWER bound — a just-completed,
 * not-yet-collected slot reads as free (decision 4, stated once). Times rendered LOCAL (repo rule).
 * Auto-runs the LOCAL zero-git sync first (SY1) so it reads a fresh book. Pipeline-only: no APP_VERSION.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runLocalSync } from '../lib/sync-invoke.mjs';
import { loadMapping, loadGuide, fetchItemInputs, vol24FromInputs } from '../lib/marketfetch.mjs';
import { computeQuote, breakEven } from '../../js/quotecore.js';
import { readOpenPositions } from '../lib/positions.mjs';
import { readOffersSnapshot } from '../lib/offers.mjs';
import { loadDerivedCash } from '../lib/derive-cash-tiers.mjs';
import { buysByItem, limitWindow } from '../lib/limits.mjs';
import { buildBook, CLEARABILITY_FRAC } from '../lib/book-model.mjs';
import { fmt, fmtP } from '../../js/money-format.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const POSITIONS = path.join(HERE, '..', '..', 'positions.json');
const OFFERS = path.join(HERE, '..', '..', 'offers.json');
const FILLS = path.join(HERE, '..', '..', 'fills.json');

// LOCAL wall-clock HH:MM for a unix-SECONDS instant (repo rule: rendered times are local). Copied from
// read-buy-limits.mjs — not worth a shared import for one 3-line helper.
function hhmm(tsSec) {
  if (tsSec == null) return '—';
  return new Date(tsSec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// --- args --------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
function flagVal(name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; }
const sizeToken = flagVal('--size');
const capitalOverride = flagVal('--capital') != null ? Math.max(0, Math.round(+flagVal('--capital'))) : null;

// age label for a mark: "" when fresh, " (Nm old)" when stale past QUICK_FRESH_MIN.
function ageLabel(m) {
  if (!m || m.mark == null) return '';
  if (m.stale && m.ageMin != null) return ` ⚠ ${Math.round(m.ageMin)}m old`;
  return '';
}

function pct(x) { return x == null ? '—' : (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%'; }

async function main() {
  runLocalSync({ offBookNote: 'reading the book off the current on-disk state' });

  const map = await loadMapping();
  const guide = await loadGuide().catch(() => ({}));

  const { groups, err: posErr } = readOpenPositions(POSITIONS);
  if (posErr) console.error('⚠ positions.json: ' + posErr + ' — held book may be incomplete');
  const openGroups = groups || [];
  const offers = readOffersSnapshot(OFFERS);
  let events = [];
  try { const j = JSON.parse(fs.readFileSync(FILLS, 'utf8')); events = j.events || j.fills || (Array.isArray(j) ? j : []); }
  catch { /* no fills → sizer buy-limit window is empty (treated as fully available) */ }

  // --- the ONE per-invocation fetch union: held ∪ resting-bid ∪ {sizer target} -----------------
  let sizerId = null, sizerName = null;
  if (sizeToken != null) {
    const hit = map.resolve(sizeToken);
    if (!hit) { console.error(`! no item named "${sizeToken}" — check spelling or pass a numeric id`); process.exit(1); }
    sizerId = hit.id; sizerName = hit.name;
  }
  const union = new Set([...openGroups.map(g => g.itemId), ...offers.map(o => o.itemId)]);
  if (sizerId != null) union.add(sizerId);

  const now = Date.now();
  const inputsById = new Map();      // id -> fetchItemInputs result
  const quoteById = new Map();       // id -> computeQuote row
  for (const id of union) {
    const wantTs1h = id === sizerId; // clearability needs the 1h series — scope it to ONLY the sizer target (Risk 3)
    let inp;
    try { inp = await fetchItemInputs(id, { ts1h: wantTs1h }); }
    catch (e) { console.error(`⚠ fetch failed for #${id}: ${(e && e.message) || e}`); continue; }
    inputsById.set(id, inp);
    const row = computeQuote({ ...inp, guide: guide[id] ?? null, limit: map.byId[id]?.limit ?? null, now, id });
    quoteById.set(id, row);
  }

  // marks map (mark = quickSell = latest.high; the SELL-side field a held lot's value/underwater read uses),
  // age-labelled from computeQuote's row.quickStale.sell / row.quoteAgeMin.sell (decision 3).
  const marks = new Map();
  for (const [id, row] of quoteById) {
    marks.set(id, {
      mark: row.quickSell ?? null,
      stale: !!(row.quickStale && row.quickStale.sell),
      ageMin: row.quoteAgeMin && row.quoteAgeMin.sell != null ? Math.round(row.quoteAgeMin.sell) : null,
      name: map.byId[id]?.name || ('#' + id),
    });
  }

  // marketRef for the deep-vs-committed bid split — SAME single fetch (decision 3), no second pass.
  const marketRef = {};
  for (const [id, row] of quoteById) marketRef[id] = { live: row.quickBuy ?? null, bandLow: row.band?.lo ?? null };
  const cash = loadDerivedCash(undefined, { marketRef });

  // --- sizer ingredients (view 5) --------------------------------------------------------------
  let sizer = null;
  if (sizerId != null) {
    const row = quoteById.get(sizerId);
    const inp = inputsById.get(sizerId);
    const limit = map.byId[sizerId]?.limit ?? null;
    const w = limitWindow({ buys: buysByItem(events).get(sizerId) || [], limit, now });
    const v = inp ? vol24FromInputs(inp, now).vol24 : null;
    const dailyVol = v ? Math.min(v.highPriceVolume || 0, v.lowPriceVolume || 0) : null;
    // unit cost = the price you pay to acquire (live instasell / quickBuy), falling back to the mark.
    const unitCost = (row && row.quickBuy != null) ? row.quickBuy : (row && row.quickSell != null ? row.quickSell : null);
    const capital = capitalOverride != null ? capitalOverride : (cash.known ? cash.deployablePool : null);
    sizer = {
      itemId: sizerId, name: sizerName || (map.byId[sizerId]?.name) || ('#' + sizerId),
      capital: capital ?? 0,
      unitCost,
      limit,
      limitRemaining: w.remaining,
      dailyVol,
      mark: row ? (row.quickSell ?? null) : null,
      breakEven: unitCost != null ? breakEven(unitCost) : null,
    };
  }

  const book = buildBook({ groups: openGroups, offers, cash, marks, sizer, now });
  render(book, { cash, capitalSource: (capitalOverride != null ? 'override' : 'deployablePool') });
}

function render(book, { cash, capitalSource }) {
  const out = [];

  // === SLOTS ===
  out.push('=== SLOTS ===');
  out.push(`- ${book.slots.occupied}/${book.slots.total} occupied · ${book.slots.free} free`);
  for (const o of book.slots.occupants.sort((a, b) => a.slot - b.slot)) {
    const fillTxt = o.filled != null && o.qty != null ? ` (${o.filled}/${o.qty} filled)` : '';
    out.push(`  · slot ${o.slot}: ${o.side.toUpperCase()} ${o.name} @ ${fmtP(o.price)}${fillTxt}`);
  }
  out.push(`  (${book.slots.caveat})`);

  // === CAPITAL ===
  const c = book.capital;
  out.push('=== CAPITAL ===');
  if (c.utilizationPct != null) out.push(`- working ${fmtP(c.workingGp)} (held) · parked ${fmtP(c.parkedGp)} (resting bids) · ${c.utilizationPct}% working / ${100 - c.utilizationPct}% parked`);
  else out.push(`- working ${fmtP(c.workingGp)} (held) · parked ${fmtP(c.parkedGp)} (resting bids)`);
  if (c.cashKnown && c.totalGp != null) {
    out.push(`- total capital ~${fmtP(c.totalGp)} · committed ${fmtP(c.committedGp)} (${c.committedPct}%) / idle cash ~${fmtP(c.availableCash)} (${c.idlePct}%)`);
    const dn = c.restingDeepN || 0;
    const reclaim = dn > 0 ? `+ reclaimable ${fmtP(c.reservedDeep)} from ${dn} deep bid${dn > 1 ? 's' : ''}` : 'no reclaimable deep bids';
    out.push(`- deployable ${fmtP(c.deployablePool)} (free ${fmtP(c.availableCash)} · ${reclaim}) · liquid ${fmtP(c.liquidCapital)}`);
  } else {
    out.push(`- idle cash not derived — set an anchor: node pipeline/commands/derive-cash.mjs <amount>`);
  }

  // === BOOK (P&L) ===
  out.push('=== BOOK (P&L) ===');
  if (!book.lots.length) out.push('- no open lots');
  const lots = [...book.lots].sort((a, b) => (b.capTied || 0) - (a.capTied || 0));
  for (const l of lots) {
    const mk = l.mark != null ? `${fmtP(l.mark)}${ageLabel(l)}` : 'no live quote';
    const plTxt = l.unrealPL != null ? `${l.unrealPL >= 0 ? '+' : ''}${fmtP(l.unrealPL)} (${pct(l.pctToBE)} to BE)` : 'P&L n/a';
    const dh = l.daysHeld != null ? `${l.daysHeld.toFixed(1)}d` : '—';
    out.push(`- ${l.name}: ${l.qty} @ ${fmtP(l.avgCost)} (BE ${fmtP(l.breakEven)}) · mark ${mk} · ${plTxt} · tied ${fmtP(l.capTied)} · held ${dh}`);
  }

  // === SIZER ===
  if (book.sizer) {
    const s = book.sizer;
    out.push(`=== SIZER: ${s.name} ===`);
    if (s.refuse) {
      out.push(`- cannot size: ${s.refuseReason === 'unknown-limit' ? 'buy limit UNKNOWN (null) — treat as cannot-advise, NOT unlimited' : s.refuseReason}`);
    } else {
      const capTxt = capitalSource === 'override' ? `${fmtP(s.capital)} (--capital)` : `${fmtP(s.capital)} (deployablePool)`;
      out.push(`- capital ${capTxt} · unit ${fmtP(s.unitCost)} (BE ${fmtP(s.breakEven)})`);
      const b = (label, v, unit) => `${label} ${v == null ? '—' : v.toLocaleString()}${unit || ''}`;
      out.push(`- bounds: ${b('buy-limit', s.buyLimitBound)} · ${b('clearability', s.clearabilityBound)} (${(CLEARABILITY_FRAC * 100).toFixed(1)}% of day vol) · ${b('capital', s.capitalBound)}`);
      out.push(`- RECOMMEND ${s.recommendedQty == null ? '—' : s.recommendedQty.toLocaleString()} units · BINDING: ${s.binding || '—'}`);
      if (s.netIfCycled != null) out.push(`  net if cycled once ~${s.netIfCycled >= 0 ? '+' : ''}${fmtP(s.netIfCycled)} (sell ${fmtP(s.mark)} vs BE ${fmtP(s.breakEven)})`);
    }
  }

  console.log(out.join('\n'));
}

await main();
