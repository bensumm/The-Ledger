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

export const LOG_DIR = path.join(os.homedir(), '.runelite', 'exchange-logger');

/** Read every exchange-logger log file in mtime order (captures rotated logs).
 *  Returns { logLines, rows, lastLog, staleMin } or throws if the dir is unreadable. */
export function readExchangeLog() {
  const logFiles = fs.readdirSync(LOG_DIR).filter(f => /\.(log|txt|json)$/i.test(f))
    .map(f => path.join(LOG_DIR, f)).sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
  const logLines = logFiles.flatMap(f => fs.readFileSync(f, 'utf8').split('\n')).filter(Boolean);
  const rows = [];
  for (const raw of logLines) { try { rows.push(JSON.parse(raw)); } catch {} }
  const ep = l => Date.parse(l.date + 'T' + l.time);        // local wall-clock -> epoch
  const now = Date.now();                                    // real wall clock — detects a stalled log
  // manual REMOVE tombstone lines carry no date/time → ep() is NaN; drop them before the max
  const validEps = rows.map(ep).filter(Number.isFinite);
  const lastLog = validEps.length ? Math.max(...validEps) : now;
  return { logLines, rows, lastLog, staleMin: Math.round((now - lastLog) / 60000) };
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
