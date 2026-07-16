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
import { offerQuarantined } from './ignored.mjs';   // MERCH-book quarantine for resting farm/loot offers

const HERE = path.dirname(fileURLToPath(import.meta.url)); // pipeline/lib/
export const LOG_DIR = path.join(os.homedir(), '.runelite', 'exchange-logger');

/** Read every log file in `dir` (mtime order, so rotated logs are captured) and return the
 *  raw JSON rows (one per parseable line). The lowest-level shared reader — readExchangeLog()
 *  and the offers.json emitter both go through this so log discovery can't drift. A `dir`
 *  override (defaults to LOG_DIR) lets the offers snapshot / fixture tests point at a temp dir. */
export function readOfferRows(dir = LOG_DIR) {
  const logFiles = fs.readdirSync(dir).filter(f => /\.(log|txt|json)$/i.test(f))
    .map(f => path.join(dir, f)).sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
  const rows = [];
  for (const f of logFiles) for (const raw of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!raw) continue;
    try { rows.push(JSON.parse(raw)); } catch {}
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
  // manual REMOVE tombstone lines carry no date/time → ep() is NaN; drop them before the max
  const validEps = rows.map(ep).filter(Number.isFinite);
  const lastLog = validEps.length ? Math.max(...validEps) : now;
  return { logLines, rows, lastLog, staleMin: Math.round((now - lastLog) / 60000) };
}

/** Best-effort synchronous id→name lookup from the shared 24h mapping cache
 *  (pipeline/.cache/mapping.cache.json, written by marketfetch.loadMapping). NO network — if the
 *  cache is absent / unreadable, the offer's display name falls back to '#<id>'. Kept sync + offline
 *  so the offers.json emitter (sync-fills --local, watch-log.mjs) never blocks on the API. */
export function nameLookupFromCache() {
  try {
    const obj = JSON.parse(fs.readFileSync(path.join(HERE, '..', '.cache', 'mapping.cache.json'), 'utf8'));
    return id => { const v = obj[id]; return v && typeof v === 'object' ? v.name : (typeof v === 'string' ? v : undefined); };
  } catch { return () => undefined; }
}

/** Build the flat offers.json snapshot from parsed log `rows`. Source of truth for the deployed
 *  app's future Watch tab; keep it DUMB and FLAT — presentation lives in the app. Field mapping:
 *  side BUYING→'buy' / SELLING→'sell'; itemId/item from the raw item id + `nameFor` lookup;
 *  price = offer price each; qty = TOTAL offer size (max); filled = cumulative filled so far (qty
 *  field); lastUpdateTs = the offer line's epoch ms. EMPTY / terminal / cancelled slots are already
 *  excluded by activeOffers(). `nameFor(id)` is best-effort (falls back to '#<id>'). */
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

/** Latest line per slot = that slot's current state; BUYING/SELLING = an open offer.
 *  Returns [{ slot, state, item, qty, max, offer, ts }] (qty = filled so far). */
export function activeOffers(rows, ignoredCfg = null) {
  const bySlot = new Map();
  for (const r of rows) bySlot.set(r.slot, r);
  const out = [];
  for (const [, r] of bySlot) {
    if (r.state === 'BUYING' || r.state === 'SELLING') {
      // MERCH-book quarantine: a resting offer on an ignored item (farming/loot, ignored-items.json)
      // is not a flip — drop it from the merch offer view unless its price matches a live greenlist
      // entry. Keeps farm bids off watch's CANCEL-BID rows. Absent cfg → unchanged (monitor passes none).
      if (ignoredCfg && offerQuarantined(ignoredCfg, r.item, r.offer)) continue;
      out.push({ ...r, ts: Date.parse(r.date + 'T' + r.time) }); // raw fields kept (date/time/worth) — monitor prints them
    }
  }
  return out;
}

/** LH2.4 — restart-blindness for slots the WHOLE-log staleness check (logblind.mjs) can't see.
 *  THE GAP (2026-07-16): the Exchange Logger plugin only emits on a slot state change, so after a
 *  client restart/relog it silently reports EMPTY for every slot it hasn't seen touched since — even
 *  though the underlying GE offer is still resting in-game (LH2's original finding). logblind.mjs
 *  catches this when the WHOLE log goes stale, but a live probe/flip touching even ONE slot keeps the
 *  log looking fresh while OTHER slots go dark right alongside it (the 2026-07-16 ladder-probe
 *  incident: 4 bulk sells vanished from monitor-offers.mjs while 2 micro-clip slots kept the log
 *  "fresh").
 *
 *  THE INVARIANT (simpler than the first cut of this fix, and strictly more general): the GE offer
 *  state machine has exactly one path into EMPTY — through a TERMINAL row (CANCELLED_BUY /
 *  CANCELLED_SELL / BOUGHT / SOLD). A real fill always logs partial -> complete before EMPTY; a real
 *  cancel always logs CANCELLED_* before EMPTY. There is no legitimate transition straight from
 *  BUYING/SELLING to EMPTY. So the check needs no cross-slot corroboration ("did N other slots also go
 *  empty at this instant") at all — just walk each slot backward past any run of trailing EMPTY rows
 *  (a slot can go blind more than once before ever being re-touched) to the last REAL row. If that row
 *  is BUYING/SELLING rather than a terminal state, the EMPTY has no explanation and the offer is
 *  presumed still resting in-game. This is both simpler than (and a superset of) the original
 *  same-timestamp-multi-slot heuristic — it also catches a SINGLE slot going blind on its own, which a
 *  "3+ slots at once" threshold would have missed.
 *  Returns the SUSPECT slots' pre-wipe offer, `{ ...row, ts, resetTs, suspectRestartBlind:true }` —
 *  ONLY for slots whose wipe is still the LAST thing logged for that slot (a later real placement or
 *  cancel supersedes the suspicion). Never mutates `activeOffers()`'s own semantics — this is an
 *  ADDITIONAL, separately-rendered list a caller merges in beside the confirmed-active ones. */
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
