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
 * Honesty (inform-only, never a gate): on the per-lot P&L BOARD a live mark is age-labelled via the
 * shared `liveAgeTag`, so a stale number is never rendered as live (decision 3). SCOPED deliberately —
 * this file's own SIZER line (`net if cycled once (sell …)`, below) renders its mark UNLABELLED, as does
 * `book-model.mjs`'s reverse-flip `liveTxt`. Both are inform-only and off the board; don't read this
 * sentence as tool-wide coverage (it used to be worded that way, and was false at two sites). The free-slot count is a log-derived UPPER bound — a just-completed,
 * not-yet-collected slot reads as free (decision 4, stated once). Times rendered LOCAL (repo rule).
 * Auto-runs the LOCAL zero-git sync first (SY1) so it reads a fresh book. Pipeline-only: no APP_VERSION.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runLocalSync } from '../lib/reconstruct/sync-invoke.mjs';
import { loadMapping, loadGuide, fetchItemInputs, vol24FromInputs } from '../lib/market/marketfetch.mjs';
import { computeQuote, breakEven, QUICK_FRESH_MIN } from '../../js/quotecore.js';
import { liveAgeTag } from '../../js/windowread.mjs';   // 2026-08-09: the ONE live-print age suffix (always renders the age; ⚠ escalation past QUICK_FRESH_MIN)
import { readOpenPositions } from '../lib/reconstruct/positions.mjs';
import { readOffersSnapshot, loadSuspectBidEscrow, suspectBidNote } from '../lib/reconstruct/offers.mjs';
import { loadDerivedCash } from '../lib/capital/derive-cash-tiers.mjs';
import { buysByItem, limitWindow } from '../lib/capital/limits.mjs';
import { buildBook, buildReverseFlipPending, CLEARABILITY_FRAC } from '../lib/capital/book-model.mjs';
import { parseGp } from '../lib/render/cli.mjs';
import { loadReverseFlip, pruneReverseFlip } from '../lib/thesis/reverseflipstate.mjs';   // RF0 store — RF4 "Reverse-flip pending" section
import { fmt, fmtP } from '../../js/money-format.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const POSITIONS = path.join(HERE, '..', '..', 'positions.json');
const OFFERS = path.join(HERE, '..', '..', 'offers.json');
const FILLS = path.join(HERE, '..', '..', 'fills.json');
const REVERSE_FLIP = path.join(HERE, '..', '..', 'reverse-flip-state.json');

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
const capitalRaw = flagVal('--capital');
const capitalOverride = capitalRaw != null ? Math.max(0, parseGp(capitalRaw)) : null;
if (capitalOverride != null && !Number.isFinite(capitalOverride)) {
  console.error(`could not parse --capital "${capitalRaw}" as a gp amount (try 20m, 500k, 2.5b, or a plain number).`);
  process.exit(1);
}

// age label for a mark — ALWAYS names the age via the shared liveAgeTag (2026-08-09): `(Nm ago)` when
// fresh, `⚠ Nm old` past QUICK_FRESH_MIN. Silent-when-fresh made an unchanged-but-current mark
// indistinguishable from a stale one. No mark at all ⇒ still empty (nothing to date).
function ageLabel(m) {
  if (!m || m.mark == null) return '';
  return liveAgeTag(m.ageMin, { freshMin: QUICK_FRESH_MIN });
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
    // PLAN-VOL24 parity: correct vol24 BEFORE computeQuote, so the row's volDay/pressure and the sizer's
    // clearability below can never be two different answers off the same `inp` (they were: the sizer path
    // corrected at its own call site while this row kept the raw /24h read). Same ordering as the
    // quote-items.mjs / watch-positions.mjs paths — the reassign-then-quote pattern is the convention.
    // COVERAGE LIMIT, stated plainly: only the sizer target fetches a 1h series (`wantTs1h`, Risk 3), and
    // vol24FromInputs DEGRADES to the raw /24h value without one. So for every other id this is a no-op
    // and `row.volDay` stays the raw PER-ITEM /24h read — which the reverse-flip thin read below consumes.
    // The raw and corrected values DIFFER for most of the day (the per-item endpoint is a UTC-DAY
    // aggregate, not a trailing window), so this reorder fixes a real figure, not just an ordering
    // smell. Do NOT restate it as consistency-only — see the loadAll24hRolling ONE HOME block.
    inp.vol24 = vol24FromInputs(inp, now).vol24;
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
      // RAW, deliberately un-rounded (2026-08-09). Pre-rounding here defeated `liveAgeTag`'s raw-age
      // comparison: a true 15.4m age stored as 15 rendered ' (15m ago)' (fresh) while the `stale` flag
      // above — computed from the RAW age via row.quickStale — said stale, on the same line. The tag owns
      // its own rounding (and ceilings the stale side); callers must hand it the unrounded age.
      ageMin: row.quoteAgeMin && row.quoteAgeMin.sell != null ? row.quoteAgeMin.sell : null,
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
    const v = inp ? inp.vol24 : null;   // already the corrected value (assigned pre-computeQuote above)
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
      markAgeTag: ageLabel(marks.get(sizerId)),
      breakEven: unitCost != null ? breakEven(unitCost) : null,
    };
  }

  const book = buildBook({ groups: openGroups, offers, cash, marks, sizer, now });

  // RF4 — the "Reverse-flip pending" section. Loaded/built here (impure shell), rendered off the PURE
  // book-model builder. infoById reuses the SAME per-id quote row already fetched above (guide/volDay → the
  // thin read) — NO new fetch. An empty store → buildReverseFlipPending returns [] → the section is skipped
  // entirely (byte-identical to a pre-RF4 read).
  const rfState = pruneReverseFlip(loadReverseFlip(REVERSE_FLIP));
  const rfInfoById = {};
  for (const [id, row] of quoteById) rfInfoById[id] = { row, live: row.quickSell ?? null };
  const reverseFlip = buildReverseFlipPending(rfState, { marks, infoById: rfInfoById, now, fmt, fmtP });

  // L2 — restart-blind suspect BIDS may inflate the derived deployable figure (their escrow drops out of
  // offers.json, so it's never subtracted). Read off the LOCAL log; off-machine → { n:0 } → no note.
  const suspectEsc = loadSuspectBidEscrow();

  render(book, { cash, capitalSource: (capitalOverride != null ? 'override' : 'deployablePool'), reverseFlip, suspectEsc });
}

function render(book, { cash, capitalSource, reverseFlip = [], suspectEsc = null }) {
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
    out.push(`- deployable ${fmtP(c.deployablePool)} (free ${fmtP(c.availableCash)} · ${reclaim}) · liquid ${fmtP(c.liquidCapital)}${suspectBidNote(suspectEsc, fmtP)}`);
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
    {
      const capTxt = capitalSource === 'override' ? `${fmtP(s.capital)} (--capital)` : `${fmtP(s.capital)} (deployablePool)`;
      out.push(`- capital ${capTxt} · unit ${fmtP(s.unitCost)} (BE ${fmtP(s.breakEven)})`);
      const b = (label, v, unit) => `${label} ${v == null ? '—' : v.toLocaleString()}${unit || ''}`;
      out.push(`- bounds: ${b('buy-limit', s.buyLimitBound)} · ${b('clearability', s.clearabilityBound)} (${(CLEARABILITY_FRAC * 100).toFixed(1)}% of day vol) · ${b('capital', s.capitalBound)}`);
      out.push(`- RECOMMEND ${s.recommendedQty == null ? '—' : s.recommendedQty.toLocaleString()} units · BINDING: ${s.binding || '—'}`);
      if (s.buyLimitBound == null) out.push('  ⚠ buy limit not in mapping — this size is NOT limit-checked (unknown is not unlimited)');
      if (s.netIfCycled != null) out.push(`  net if cycled once AT THE TOUCH ~${s.netIfCycled >= 0 ? '+' : ''}${fmtP(s.netIfCycled)} (sell ${fmtP(s.mark)}${s.markAgeTag || ''} vs BE ${fmtP(s.breakEven)})`);
    }
  }

  // === REVERSE-FLIP PENDING (RF4) === — declared in-flight cycles with no open lot / no GE slot (capital-free
  // between the sell + rebuy legs). Printed ONLY when the store has awaiting-rebuy/rebuy-armed entries; an
  // empty store renders NOTHING here (zero-ripple). INFORM-ONLY, n≈0.
  if (reverseFlip.length) {
    out.push('=== REVERSE-FLIP PENDING ===');
    out.push('  (declared cycles between legs — sold a keep, rebuy at the dip; capital-free, no lot/slot. Inform-only, n≈0)');
    for (const e of reverseFlip) {
      out.push(`- ${e.name} [${e.state}]: sold ${e.soldTxt} · BE-rebuy <${e.beRebuyTxt} · live ${e.liveTxt} · pending ${e.daysPendingTxt}`);
      for (const n of e.notes) out.push(`    ${n}`);
    }
  }

  console.log(out.join('\n'));
}

await main();
