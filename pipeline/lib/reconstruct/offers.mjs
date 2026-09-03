#!/usr/bin/env node
/**
 * offers.mjs — shared exchange-log reader: raw lines, parsed rows, and ACTIVE offers.
 *
 * One owner for "what offers are open right now" so monitor-offers.mjs (log-state snapshot) and
 * watch-positions.mjs (market-side read) can't drift apart on log discovery or slot semantics.
 * Read-only: never writes anything.
 *
 * Position terminology (Ben, 2026-07-04): a POSITION is any committed capital — held
 * inventory PLUS every active GE offer. A resting BUY is capital committed to buying;
 * a resting SELL is held inventory being sold. positions.json only knows booked fills,
 * so the active-offer view here is what closes the gap.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { offerQuarantined } from '../ignored.mjs';   // MERCH-book quarantine for resting farm/loot offers
import { isNetWorthSource } from './reconstruct.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)); // pipeline/lib/
export const LOG_DIR = path.join(os.homedir(), '.runelite', 'exchange-logger');

/** Read every log file in `dir` (mtime order, so rotated logs are captured) and return the
 *  raw JSON rows (one per parseable line). The lowest-level shared reader — readExchangeLog()
 *  and the offers.json emitter both go through this so log discovery can't drift. A `dir`
 *  override (defaults to LOG_DIR) lets the offers snapshot / fixture tests point at a temp dir.
 *  Rows from a `.json` (net-worth) source are stamped `worthNet: true` — PLAN-SALE-LOG-TAX. */
export function readOfferRows(dir = LOG_DIR) {
  const logFiles = fs.readdirSync(dir).filter(f => /\.(log|txt|json)$/i.test(f))
    .map(f => path.join(dir, f)).sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
  const rows = [];
  for (const f of logFiles) {
    const worthNet = isNetWorthSource(f);
    for (const raw of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!raw) continue;
      try { const r = JSON.parse(raw); if (worthNet) r.worthNet = true; rows.push(r); } catch {}
    }
  }
  return rows;
}

/** Read every exchange-logger log file in mtime order (captures rotated logs).
 *  Returns { logLines, rows, lastLog, staleMin } or throws if the dir is unreadable. */
export function readExchangeLog() {
  const rows = readOfferRows(LOG_DIR);
  const logLines = rows.map(r => JSON.stringify(r)); // kept for callers that want the raw-line count
  const ep = l => Date.parse(l.date + 'T' + l.time);        // local wall-clock -> epoch
  const now = Date.now();                                    // real wall clock — detects a stalled log
  // REMOVE tombstones carry no date/time → ep() is NaN, dropped before the max. reduce, not
  // Math.max(...spread): `rows` is unbounded and a spread crashes past V8's ~65k-argument ceiling.
  const validEps = rows.map(ep).filter(Number.isFinite);
  const lastLog = validEps.reduce((m, x) => (x > m ? x : m), -Infinity);
  if (!Number.isFinite(lastLog)) return { logLines, rows, lastLog: now, staleMin: 0 };
  return { logLines, rows, lastLog, staleMin: Math.round((now - lastLog) / 60000) };
}

/** Best-effort synchronous id→name lookup from the shared 24h mapping cache
 *  (pipeline/.cache/mapping.cache.json, written by marketfetch.loadMapping). NO network — if the
 *  cache is absent / unreadable, the offer's display name falls back to '#<id>'. Kept sync + offline
 *  so the offers.json emitter (sync-fills --local, watch-log.mjs) never blocks on the API. */
export function nameLookupFromCache() {
  try {
    // pipeline/.cache/ — TWO up from lib/reconstruct/. The read is try/caught into a no-op fallback, so
    // a wrong depth silently degrades name lookup — re-count by hand on any move; tests will NOT catch it.
    const obj = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', '.cache', 'mapping.cache.json'), 'utf8'));
    return id => { const v = obj[id]; return v && typeof v === 'object' ? v.name : (typeof v === 'string' ? v : undefined); };
  } catch { return () => undefined; }
}

/** Build the flat offers.json snapshot from parsed log `rows`. Source of truth for the deployed
 *  app's future Watch tab; keep it DUMB and FLAT — presentation lives in the app. Field mapping:
 *  side BUYING→'buy' / SELLING→'sell'; itemId/item from the raw item id + `nameFor` lookup;
 *  price = offer price each; qty = TOTAL offer size (max); filled = cumulative filled so far (qty
 *  field); lastUpdateTs = the offer line's epoch ms; placedTs = the offer-episode start (FD3 —
 *  additive + NULLABLE, readers must tolerate absence; semantics at episodePlacedTs). EMPTY /
 *  terminal / cancelled slots are excluded by activeOffers(). `nameFor(id)` is best-effort. */
export function offersSnapshot(rows, nameFor = () => undefined, ignoredCfg = null) {
  const offers = activeOffers(rows, ignoredCfg).map(r => ({   // same MERCH-book quarantine as watch's live view
    slot: r.slot,
    side: r.state === 'BUYING' ? 'buy' : 'sell',
    itemId: r.item,
    item: nameFor(r.item) || ('#' + r.item),
    price: r.offer,
    qty: r.max,
    filled: r.qty,
    lastUpdateTs: r.ts,
    placedTs: r.placedTs ?? null,
  }));
  return { app: 'the-coffer-offers', version: 1, generatedAt: new Date().toISOString(), offers };
}

/** Read the flat repo-root offers.json snapshot (the app-fetched LW1 file written by
 *  sync-fills.mjs / watch-log.mjs from THIS same reader). Returns the `offers` array
 *  ([{ slot, side:'buy'|'sell', itemId, item, price, qty, filled, lastUpdateTs }]) or [] on
 *  ANY failure (missing / stale / corrupt) — a bad snapshot must never break a caller (the
 *  loadState degrade-not-throw precedent). This is the OTHER-machine-safe book source: unlike
 *  readExchangeLog (which needs the local ~/.runelite log dir), quote-items.mjs reads offers.json so
 *  its position stage can see live asks/bids anywhere the file is present. */
export function readOffersSnapshot(offersPath) {
  try {
    const o = JSON.parse(fs.readFileSync(offersPath, 'utf8'));
    return Array.isArray(o && o.offers) ? o.offers : [];
  } catch { return []; }
}

/** The active ask (side 'sell') / bid (side 'buy') for one item id in an offers.json `offers`
 *  array, NORMALIZED to the position-stage shape `{ price, filled, total }` (or null). This is the
 *  shape context.positionStage's `ask`/`bid` want, so a caller sourcing the book from offers.json
 *  and one sourcing it from the live exchange log feed the position stage identically. */
export function normalizeSnapshotOffer(offer) {
  return offer ? { price: offer.price, filled: offer.filled, total: offer.qty } : null;
}
export function askFromSnapshot(offers, itemId) {
  return normalizeSnapshotOffer((offers || []).find(o => o && o.itemId === itemId && o.side === 'sell') || null);
}
export function bidFromSnapshot(offers, itemId) {
  return normalizeSnapshotOffer((offers || []).find(o => o && o.itemId === itemId && o.side === 'buy') || null);
}

/** Latest line per slot BY WALL-CLOCK = that slot's current state; BUYING/SELLING = an open offer.
 *  Returns [{ slot, state, item, qty, max, offer, ts, placedTs }] (qty = filled so far; placedTs — FD3, see episodePlacedTs).
 *
 *  WALL-CLOCK, NOT READ ORDER. `readOfferRows` concatenates log files in FILE-MTIME order, so read order
 *  says which FILE was appended to last, not when a line happened: a manual CANCELLED_BUY beat the live
 *  log's stale BUYING row only until RuneLite appended anything, then the phantom offer resurrected.
 *  Ties and unstamped rows fall back to read order (later wins) so re-emits and REMOVE-shaped lines still
 *  resolve; an unstamped row never displaces a stamped one. */
const offerEpoch = r => Date.parse(r.date + 'T' + r.time);
function supersedes(cand, prev) {
  const a = offerEpoch(cand), b = offerEpoch(prev);
  if (!Number.isFinite(a) && !Number.isFinite(b)) return true;
  if (!Number.isFinite(a)) return false;
  if (!Number.isFinite(b)) return true;
  return a >= b;
}

/** FD3 (PLAN-FLOW-DIET) — a slot's current offer-EPISODE start: the contiguous same-
 *  (state·item·price·max) run of its stamped rows in (wall-clock, read-order) order — the same total
 *  order supersedes() resolves to, so the anchor is the row activeOffers picked. A partial fill
 *  CONTINUES the episode; EMPTY / terminal / any identity-field change breaks it (a restart-blind
 *  wipe resets the clock — age is a floor, never overstated). Unstamped winner → null, not a throw.
 *  Takes `stamped` = [{ r, ep, idx }] sorted by (ep, idx) and `cur` = the slot's winning row. */
function episodePlacedTs(stamped, cur) {
  let i = stamped.length - 1;
  if (i < 0 || stamped[i].r !== cur) return null;
  const same = x => x.r.state === cur.state && x.r.item === cur.item && x.r.offer === cur.offer && x.r.max === cur.max;
  while (i > 0 && same(stamped[i - 1])) i--;
  return stamped[i].ep;
}

export function activeOffers(rows, ignoredCfg = null) {
  const bySlot = new Map();
  const stampedBySlot = new Map();
  rows.forEach((r, idx) => {
    const prev = bySlot.get(r.slot);
    if (prev === undefined || supersedes(r, prev)) bySlot.set(r.slot, r);
    const ep = offerEpoch(r);
    if (Number.isFinite(ep)) {
      let a = stampedBySlot.get(r.slot);
      if (!a) stampedBySlot.set(r.slot, a = []);
      a.push({ r, ep, idx });
    }
  });
  const out = [];
  for (const [slot, r] of bySlot) {
    if (r.state === 'BUYING' || r.state === 'SELLING') {
      // MERCH-book quarantine: a resting offer on an ignored item (farming/loot, ignored-items.json)
      // is not a flip — drop it from the merch offer view unless its price matches a live greenlist
      // entry. Keeps farm bids off watch's CANCEL-BID rows. Absent cfg → unchanged (monitor passes none).
      if (ignoredCfg && offerQuarantined(ignoredCfg, r.item, r.offer)) continue;
      const stamped = (stampedBySlot.get(slot) || []).sort((a, b) => (a.ep - b.ep) || (a.idx - b.idx));
      out.push({ ...r, ts: offerEpoch(r), placedTs: episodePlacedTs(stamped, r) }); // raw fields kept (date/time/worth) — monitor prints them
    }
  }
  return out;
}

/** Compact offer-episode age ('47m' / '26h' / '3.2d'); '' on null/absent placedTs so every surface
 *  degrades to its pre-FD3 render. ONE owner — monitor / watch / the FD4 stale-bid flag share it. */
export function restingAge(placedTs, nowMs = Date.now()) {
  if (!Number.isFinite(placedTs)) return '';
  const m = Math.max(0, Math.round((nowMs - placedTs) / 60000));
  if (m < 60) return m + 'm';
  if (m < 48 * 60) return Math.round(m / 60) + 'h';
  return (m / 1440).toFixed(1) + 'd';
}

/** LH2.4 — restart-blindness for slots the WHOLE-log staleness check (logblind.mjs) can't see: the
 *  plugin only emits on a slot state change, so after a client restart/relog it silently reports EMPTY
 *  for every slot not touched since — while the GE offer still rests in-game; one live slot keeps the
 *  log looking fresh while others go dark beside it. THE INVARIANT: the only legitimate path into
 *  EMPTY is through a TERMINAL row (CANCELLED_BUY / CANCELLED_SELL / BOUGHT / SOLD) — so walk each
 *  slot backward past any run of trailing EMPTY rows to the last REAL row; if that row is
 *  BUYING/SELLING the EMPTY has no explanation and the offer is presumed still resting (a superset of
 *  the old same-timestamp-multi-slot heuristic — also catches a single slot going blind alone).
 *  Returns the suspects' pre-wipe offer `{ ...row, ts, resetTs, suspectRestartBlind:true }`, ONLY
 *  while the wipe is still the slot's LAST logged line (a later real placement/cancel supersedes the
 *  suspicion). Never mutates activeOffers() semantics — an ADDITIONAL, separately-rendered list a
 *  caller merges in beside the confirmed-active ones. */
export function restartBlindSuspects(rows, ignoredCfg = null) {
  const bySlotRows = new Map();
  for (const r of rows) { if (!bySlotRows.has(r.slot)) bySlotRows.set(r.slot, []); bySlotRows.get(r.slot).push(r); }
  const suspects = [];
  for (const srows of bySlotRows.values()) {
    if (!srows.length) continue;
    let i = srows.length - 1;
    if (srows[i].state !== 'EMPTY') continue;   // slot's current state isn't even EMPTY — not a suspect
    let earliestEmpty = srows[i];
    while (i >= 0 && srows[i].state === 'EMPTY') { earliestEmpty = srows[i]; i--; }
    if (i < 0) continue;                        // no row before the EMPTY run at all — nothing to be suspicious of
    const cur = srows[i];
    if (cur.state !== 'BUYING' && cur.state !== 'SELLING') continue;   // preceded by a real terminal state — a genuine cancel/fill
    if (ignoredCfg && offerQuarantined(ignoredCfg, cur.item, cur.offer)) continue;
    suspects.push({ ...cur, ts: Date.parse(cur.date + 'T' + cur.time), resetTs: Date.parse(earliestEmpty.date + 'T' + earliestEmpty.time), suspectRestartBlind: true });
  }
  return suspects;
}

/** suspectBidEscrow(rows, ignoredCfg) -> { n, gp } — count + total unfilled escrow (Σ (max−qty)×offer) of
 *  restart-blind suspect BUY offers (restartBlindSuspects, filtered to state 'BUYING'). WHY it matters to
 *  the CAPITAL surface (PLAN-CAPITAL-DEPLOYABILITY L2): a restart-blind slot reads EMPTY, so its bid is
 *  DROPPED from offers.json and thus from derive-cash-tiers' restingBuyEscrow — its escrow is never
 *  subtracted, so the derived deployable/available figure is INFLATED by ~gp if that bid is in fact still
 *  resting in-game. Surfaced (never subtracted — the number is Ben's to correct at source) beside the
 *  deployable figure so a phantom-inflated pool is flagged for a manual check, not silently trusted.
 *  INFORM-ONLY. */
export function suspectBidEscrow(rows, ignoredCfg = null) {
  let n = 0, gp = 0;
  for (const s of restartBlindSuspects(rows, ignoredCfg)) {
    if (s.state !== 'BUYING') continue;
    const rem = Math.max(0, (s.max || 0) - (s.qty || 0)) * (s.offer || 0);
    if (rem <= 0) continue;
    n++; gp += rem;
  }
  return { n, gp };
}

/** loadSuspectBidEscrow(ignoredCfg) -> { n, gp } — the impure seam: read the LOCAL exchange log and
 *  compute suspectBidEscrow. Degrades to { n:0, gp:0 } on ANY failure (no local ~/.runelite log dir /
 *  off-machine), so an off-machine caller simply shows no suspect note (same graceful-degrade posture as
 *  the deployablePool marketRef). */
export function loadSuspectBidEscrow(ignoredCfg = null) {
  try { return suspectBidEscrow(readExchangeLog().rows, ignoredCfg); }
  catch { return { n: 0, gp: 0 }; }
}

/** suspectBidNote(esc, fmtGp) -> the ONE shared note string (or '' when no suspects), so the three
 *  capital surfaces (read-book, run-loop scan gate, screen --capital) render an identical flag. `fmtGp`
 *  is the caller's own gp formatter (fmtP / the loop's fmtGp) — kept out so the surfaces don't drift on
 *  wording while each keeps its native number format. */
export function suspectBidNote(esc, fmtGp) {
  return esc && esc.n > 0
    ? ` ⚠ ${esc.n} restart-suspect bid${esc.n > 1 ? 's' : ''} (~${fmtGp(esc.gp)}) may be included — verify in-game`
    : '';
}
