#!/usr/bin/env node
/**
 * offers.mjs — shared exchange-log reader: raw lines, parsed rows, and ACTIVE offers.
 *
 * One owner for "what offers are open right now" so monitor.mjs (log-state snapshot) and
 * watch.mjs (market-side read) can't drift apart on log discovery or slot semantics.
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
export function offersSnapshot(rows, nameFor = () => undefined) {
  const offers = activeOffers(rows).map(r => ({
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

/** Latest line per slot = that slot's current state; BUYING/SELLING = an open offer.
 *  Returns [{ slot, state, item, qty, max, offer, ts }] (qty = filled so far). */
export function activeOffers(rows) {
  const bySlot = new Map();
  for (const r of rows) bySlot.set(r.slot, r);
  const out = [];
  for (const [, r] of bySlot) {
    if (r.state === 'BUYING' || r.state === 'SELLING') {
      out.push({ ...r, ts: Date.parse(r.date + 'T' + r.time) }); // raw fields kept (date/time/worth) — monitor prints them
    }
  }
  return out;
}
