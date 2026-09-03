#!/usr/bin/env node
/**
 * add-manual-fill.mjs — inject a trade the Exchange Logger never saw (mobile fills,
 * pre-logging buys) into the SOURCE the pipeline reconstructs from, so a re-sync makes
 * the record whole instead of desyncing it.
 *
 * It does NOT edit RuneLite's own exchange.log (RuneLite writes that live). Instead it
 * appends a schema-correct JSON line to a sibling `coffer-manual.log` in the same
 * exchange-logger dir. sync-fills.mjs ingests every *.log there and dedupes by content
 * hash, so these lines merge into fills.json / positions.json on the next sync and survive
 * every re-sync — a source input, not a hand-edit of the derived view, kept isolated and
 * auditable apart from plugin-captured ground truth.
 *
 * Usage:
 *   node pipeline/commands/add-manual-fill.mjs --item "Abyssal bludgeon" --type buy  --qty 3 --price 18052000
 *   node pipeline/commands/add-manual-fill.mjs --id 13263 --type sell --qty 2 --price 18375000 --net
 *   node pipeline/commands/add-manual-fill.mjs --item "Crystal seed" --type sell --qty 2 --price 3439800 --net --time "2026-07-02T14:30"
 *   node pipeline/commands/add-manual-fill.mjs --item "Abyssal bludgeon" --type withdraw --qty 1 --time "2026-07-03T12:00"
 *   node pipeline/commands/add-manual-fill.mjs --item "Dragon claws" --type banked --qty 1 --price 40.2m
 *   node pipeline/commands/add-manual-fill.mjs --id 566 --type buy --qty 25000 --price 381 --time "2026-07-09T12:00"            # window 1 (slot 8)
 *   node pipeline/commands/add-manual-fill.mjs --id 566 --type buy --qty 25000 --price 381 --time "2026-07-09T16:00" --slot 9  # window 2 — distinct slot so it survives the re-emit guard
 *   node pipeline/commands/add-manual-fill.mjs --remove a1b2c3d4e5f60718
 *
 * Flags:
 *   --item <name>    item name (resolved via the wiki mapping); OR
 *   --id <n>         item id directly (skips the lookup)
 *   --type buy|sell|withdraw|banked
 *                    withdraw = inventory taken for personal use (no sale; the pipeline
 *                    consumes open lots FIFO into a realised-0 closed row; no --price).
 *                    banked   = pre-owned inventory entering the flip flow; --price is the
 *                    declared basis each (convention: market instasell when committed to
 *                    flipping; 0 allowed for windfall accounting).
 *   --qty <n>        quantity filled
 *   --price <gp>     price EACH. Default is the pre-tax GE listing price (what the offer
 *                    screen shows). Shorthand ok: 18.05m, 3439800, 450k.
 *   --net            (sells) the --price is the AFTER-TAX gp you received; convert to the
 *                    gross listing the log records (reconstruction re-applies the 2% tax).
 *   --time <iso>     local wall-clock of the fill (default: now). MUST be when the trade
 *                    actually happened — FIFO matching is timestamp-ordered, so a "now"
 *                    timestamp on a backdated trade mis-pairs lots (the phantom-bludgeons
 *                    incident, 2026-07-03). A sell must timestamp AFTER its buy.
 *   --slot <n>       synthetic GE slot (default 8; must be ≥ 8, live slots 0-7 are reserved).
 *                    Give each window a DISTINCT slot when backfilling repeated identical fills —
 *                    the re-emit guard silently collapses identical same-slot terminals.
 *   --remove <eventId>  append a tombstone {"state":"REMOVE","target":"<id>"} instead of
 *                    a fill — the next sync deletes that event id from the merged set,
 *                    INCLUDING events already persisted in fills.json.
 *   --revive <item|id> [--sell-ts <epoch|iso>]   append a REVIVE marker: that open short stops aging
 *                    out and its next rebuy closes the round trip regardless of the H1 gate. Without
 *                    --sell-ts it targets the item's ONE open short; more prints them and exits 1.
 *   --dry            print the line, don't write it.
 *
 * After writing, run:  node pipeline/commands/sync-fills.mjs --dry   (verify), then without --dry.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tax as GE_TAX, breakEven } from '../../js/quotecore.js'; // the ONE tax impl (chunk 4.1) + shared tax-capped inverse — no private copy
import { parseArgs, parseGp } from '../lib/render/cli.mjs';
import { loadMapping } from '../lib/market/marketfetch.mjs'; // shared 24h-cached mapping loader (X1) — id/name resolve()
import { REPO_DIR } from '../lib/paths.mjs';                 // --revive reads positions.json's awaitingRebuy to disambiguate

const LOG_DIR = path.join(os.homedir(), '.runelite', 'exchange-logger');
const OUT = path.join(LOG_DIR, 'coffer-manual.log'); // sibling file; ingested by sync-fills.mjs, never written by RuneLite
const MANUAL_SLOT = 8; // real GE slots are 0-7; 8 keeps synthetic events clear of live-slot cancel inference
// Distinct synthetic slots (8, 9, 10, …) let two otherwise-identical manual terminals coexist. The
// TRAP: reconstruct.mjs's SILENT `dedupeSnapshots` keys purely on slot and — unlike the LOUD ingest
// `validateSlotTransitions` — has NO manual-slot exempt, so two identical `complete` terminals on the
// SAME slot silently collapse to one. A same-item/qty/price multi-window backfill must therefore put
// each window on a DISTINCT slot. --slot picks one; must stay ≥ 8 to avoid live-slot cancel inference
// (8 = desktop/CLI, 9 = mobile by convention).

// --- args (parseArgs/parseGp shared via cli.mjs, chunk 10.2) ---
const A = parseArgs(process.argv.slice(2));
const die = m => { console.error('error: ' + m + '\n\nrun with no args mangled; see header for usage.'); process.exit(1); };

// --remove: append a tombstone line and exit (no item/qty/price needed).
if (A.remove) {
  const target = String(A.remove).trim();
  if (!/^[0-9a-f]{8,40}$/i.test(target)) die('--remove expects an event id (hex, from fills.json)');
  const line = JSON.stringify({ state: 'REMOVE', target });
  console.log('tombstone:', line);
  if (A.dry) { console.log('\n[dry] not written.'); process.exit(0); }
  if (!fs.existsSync(LOG_DIR)) die('log dir not found: ' + LOG_DIR);
  fs.appendFileSync(OUT, line + '\n');
  console.log(`\nappended to ${OUT}`);
  console.log('next: node pipeline/commands/sync-fills.mjs --dry   (verify the event disappears), then run it without --dry.');
  process.exit(0);
}

// --revive: append a REVIVE exemption marker for an open short (positions.json awaitingRebuy) — it
// then never ages out and its next rebuy closes regardless of the H1 gate. Idempotent across resyncs.
if (A.revive !== undefined) {
  if (A.revive === true) die('--revive expects an item name or id');
  const map = await loadMapping();
  const hit = map.resolve(String(A.revive));
  if (!hit) die(`no item named "${A.revive}" in the mapping — check spelling or pass the id`);
  let target = null;
  if (A['sell-ts'] !== undefined && A['sell-ts'] !== true) {
    const v = String(A['sell-ts']);
    target = /^\d+$/.test(v) ? Number(v) : Math.floor(Date.parse(v) / 1000);
    if (!Number.isFinite(target)) die('--sell-ts must be epoch seconds or a parseable date/time');
  } else {
    const posPath = path.join(REPO_DIR, 'positions.json');
    let shorts = [];
    try { shorts = (JSON.parse(fs.readFileSync(posPath, 'utf8')).awaitingRebuy || []).filter(s => s.itemId === hit.id); }
    catch { die('could not read positions.json — run sync-fills.mjs first, or pass --sell-ts'); }
    if (!shorts.length) die(`no open short for ${hit.name} (#${hit.id}) in positions.json awaitingRebuy — pass --sell-ts to revive a settled one`);
    if (shorts.length > 1) {
      console.error(`error: ${shorts.length} open shorts for ${hit.name} (#${hit.id}) — pass --sell-ts to pick one:`);
      for (const s of shorts) console.error(`  --sell-ts ${s.sellTs}   qty ${s.qty} sold @${s.sellEach} (beRebuy ${s.beRebuy}, ${new Date(s.sellTs * 1000).toISOString()})`);
      process.exit(1);
    }
    target = shorts[0].sellTs;
  }
  const line = JSON.stringify({ state: 'REVIVE', item: hit.id, target });
  console.log(`\nREVIVE ${hit.name} (#${hit.id}) short sold at ${target == null ? '(any)' : new Date(target * 1000).toISOString()}`);
  console.log('line:', line);
  if (A.dry) { console.log('\n[dry] not written.'); process.exit(0); }
  if (!fs.existsSync(LOG_DIR)) die('log dir not found: ' + LOG_DIR);
  fs.appendFileSync(OUT, line + '\n');
  console.log(`\nappended to ${OUT}`);
  console.log('next: node pipeline/commands/sync-fills.mjs   (the short stops aging and its next rebuy closes the round trip).');
  process.exit(0);
}

const type = String(A.type || '').toLowerCase();
if (!['buy', 'sell', 'withdraw', 'banked'].includes(type)) die('--type must be buy, sell, withdraw or banked');
// --slot: synthetic GE slot for this line (default MANUAL_SLOT). Must be ≥ 8 so it never collides with
// the live slots 0-7 (cancel inference). Use a distinct slot per window when backfilling repeated
// identical fills, so the re-emit guard doesn't collapse them (see MANUAL_SLOT note above).
const slot = A.slot === undefined ? MANUAL_SLOT : parseInt(A.slot, 10);
if (!Number.isFinite(slot) || slot < MANUAL_SLOT) die(`--slot must be an integer ≥ ${MANUAL_SLOT} (live slots 0-7 are reserved for real offers)`);
const qty = parseInt(A.qty, 10);
if (!Number.isFinite(qty) || qty <= 0) die('--qty must be a positive integer');
let priceEach;
if (type === 'withdraw') {
  if (A.price !== undefined) die('--price does not apply to withdraw (no sale happens; cost basis comes from the consumed lot)');
  priceEach = 0;
} else if (type === 'banked') {
  priceEach = A.price === undefined ? NaN : parseGp(A.price);
  if (!Number.isFinite(priceEach) || priceEach < 0) die('--price (declared basis each) is required for banked; 0 is allowed for windfalls');
} else {
  priceEach = parseGp(A.price);
  if (!Number.isFinite(priceEach) || priceEach <= 0) die('--price must be a positive number (e.g. 18.05m, 3439800)');
}

// --net: the given price is after-tax proceeds -> recover the gross listing the log stores
if (A.net) {
  if (type !== 'sell') die('--net only applies to sells');
  const gross = breakEven(priceEach);                   // shared tax-capped inverse: smallest gross listing whose after-tax proceeds ≥ this net
  console.log(`  net ${priceEach.toLocaleString()} -> gross listing ${gross.toLocaleString()} (tax ${GE_TAX(gross).toLocaleString()}/ea)`);
  priceEach = gross;
}

// timestamp
const when = A.time ? new Date(A.time) : new Date();
if (isNaN(when.getTime())) die('--time is not a valid date/time');
const pad = n => String(n).padStart(2, '0');
const date = `${when.getFullYear()}-${pad(when.getMonth()+1)}-${pad(when.getDate())}`;
const time = `${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}`;

// resolve item id + name via the shared mapping loader (loadMapping().resolve() handles both a
// numeric id and a case-insensitive name, and tolerates whichever cache shape another script last
// wrote — chunk 4.5's flat-vs-rich cache hazard is handled inside loadMapping now).
let itemId, itemName;
if (A.id) { itemId = parseInt(A.id, 10); if (!Number.isFinite(itemId)) die('--id must be a number');
  const map = await loadMapping(); itemName = map.byId[itemId]?.name || ('#'+itemId); }
else if (A.item) { const map = await loadMapping();
  const hit = map.resolve(A.item);
  if (!hit) die(`no item named "${A.item}" in the mapping — check spelling or pass --id`);
  itemId = hit.id; itemName = hit.name;
} else die('pass --item <name> or --id <n>');

// build the schema-correct completed-offer line (see sync-fills.mjs ADAPTER):
//   item->itemId, offer->price each, max->offer size, qty->cumulative filled, worth->gross spent
const state = type === 'buy' ? 'BOUGHT' : type === 'sell' ? 'SOLD'
            : type === 'withdraw' ? 'WITHDRAWN' : 'BANKED';
const line = JSON.stringify({
  date, time, state, slot,
  item: itemId, qty, worth: priceEach * qty, max: qty, offer: priceEach
});

console.log(`\n${type.toUpperCase()} ${qty} × ${itemName} (#${itemId}) @ ${priceEach.toLocaleString()} ea  [${date} ${time}]${slot !== MANUAL_SLOT ? ` (slot ${slot})` : ''}`);
console.log('line:', line);
if (A.dry) { console.log('\n[dry] not written.'); process.exit(0); }
if (!fs.existsSync(LOG_DIR)) die('log dir not found: ' + LOG_DIR);
fs.appendFileSync(OUT, line + '\n');
console.log(`\nappended to ${OUT}`);
// A bare sync is LOCAL/ZERO-GIT (default since 2026-07-15) — it writes the artifacts and pushes NOTHING.
// This line used to say "write + push", which would have someone inject a fill, sync, and believe the
// deployed book had updated. Publishing is the once-a-day `/overnight` `--publish` run, and only that.
console.log('next: node pipeline/commands/sync-fills.mjs --dry   (verify), then without --dry to write the');
console.log('      artifacts LOCALLY (zero-git). The deployed book updates only at the once-a-day');
console.log('      /overnight `sync-fills.mjs --publish`.');
