#!/usr/bin/env node
/**
 * add-manual-fill.mjs — inject a trade the Exchange Logger never saw (mobile fills,
 * pre-logging buys) into the SOURCE the pipeline reconstructs from, so a re-sync makes
 * the record whole instead of desyncing it.
 *
 * It does NOT edit RuneLite's own exchange.log (RuneLite writes that live). Instead it
 * appends a schema-correct JSON line to a sibling file `coffer-manual.log` in the same
 * exchange-logger dir. sync-fills.mjs already ingests every *.log there and dedupes by a
 * content hash, so these lines merge into fills.json / positions.json on the next sync
 * and survive every future re-sync (they're a source input, not a hand-edit of the
 * derived view). Hand-authored entries stay isolated in their own file — auditable and
 * removable — separate from plugin-captured ground truth.
 *
 * Usage:
 *   node pipeline/add-manual-fill.mjs --item "Abyssal bludgeon" --type buy  --qty 3 --price 18052000
 *   node pipeline/add-manual-fill.mjs --id 13263 --type sell --qty 2 --price 18375000 --net
 *   node pipeline/add-manual-fill.mjs --item "Crystal seed" --type sell --qty 2 --price 3439800 --net --time "2026-07-02T14:30"
 *   node pipeline/add-manual-fill.mjs --item "Abyssal bludgeon" --type withdraw --qty 1 --time "2026-07-03T12:00"
 *   node pipeline/add-manual-fill.mjs --item "Dragon claws" --type banked --qty 1 --price 40.2m
 *   node pipeline/add-manual-fill.mjs --remove a1b2c3d4e5f60718
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
 *   --remove <eventId>  append a tombstone {"state":"REMOVE","target":"<id>"} instead of
 *                    a fill — the next sync deletes that event id from the merged set,
 *                    INCLUDING events already persisted in fills.json.
 *   --dry            print the line, don't write it.
 *
 * After writing, run:  node pipeline/sync-fills.mjs --dry   (verify), then without --dry.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(os.homedir(), '.runelite', 'exchange-logger');
const OUT = path.join(LOG_DIR, 'coffer-manual.log'); // sibling file; ingested by sync-fills.mjs, never written by RuneLite
const MAP_CACHE = path.join(HERE, 'mapping.cache.json');
const MAP_URL = 'https://prices.runescape.wiki/api/v1/osrs/mapping';
const MANUAL_SLOT = 8; // real GE slots are 0-7; 8 keeps synthetic events clear of live-slot cancel inference
const GE_TAX = each => Math.min(Math.floor(each * 0.02), 5_000_000);

// --- args ---
const A = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) { const k = a.slice(2); const v = process.argv[i+1]; if (v === undefined || v.startsWith('--')) A[k] = true; else { A[k] = v; i++; } }
}
const die = m => { console.error('error: ' + m + '\n\nrun with no args mangled; see header for usage.'); process.exit(1); };

// parse "18.05m" / "3439800" / "450k" -> integer gp
function parseGp(s) {
  if (typeof s === 'number') return Math.round(s);
  const t = String(s).trim().toLowerCase().replace(/,/g, '');
  const m = t.match(/^(-?\d+(?:\.\d+)?)\s*([kmb])?$/);
  if (!m) return NaN;
  const mult = m[2] === 'b' ? 1e9 : m[2] === 'm' ? 1e6 : m[2] === 'k' ? 1e3 : 1;
  return Math.round(parseFloat(m[1]) * mult);
}

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
  console.log('next: node pipeline/sync-fills.mjs --dry   (verify the event disappears), then run it without --dry.');
  process.exit(0);
}

const type = String(A.type || '').toLowerCase();
if (!['buy', 'sell', 'withdraw', 'banked'].includes(type)) die('--type must be buy, sell, withdraw or banked');
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
  let gross = Math.round(priceEach / 0.98);              // uncapped inverse of the 2% tax
  if (gross > 250_000_000) gross = priceEach + 5_000_000; // capped region: flat 5m tax
  console.log(`  net ${priceEach.toLocaleString()} -> gross listing ${gross.toLocaleString()} (tax ${GE_TAX(gross).toLocaleString()}/ea)`);
  priceEach = gross;
}

// timestamp
const when = A.time ? new Date(A.time) : new Date();
if (isNaN(when.getTime())) die('--time is not a valid date/time');
const pad = n => String(n).padStart(2, '0');
const date = `${when.getFullYear()}-${pad(when.getMonth()+1)}-${pad(when.getDate())}`;
const time = `${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}`;

// resolve item id + name
async function loadNames() {
  try { if (Date.now() - fs.statSync(MAP_CACHE).mtimeMs < 24*3600*1000) return JSON.parse(fs.readFileSync(MAP_CACHE,'utf8')); } catch {}
  try {
    const arr = await (await fetch(MAP_URL, { headers: { 'user-agent': 'the-coffer-manual/1.0' } })).json();
    const m = {}; for (const it of arr) m[it.id] = it.name;
    fs.writeFileSync(MAP_CACHE, JSON.stringify(m)); return m;
  } catch { try { return JSON.parse(fs.readFileSync(MAP_CACHE,'utf8')); } catch { return {}; } }
}
let itemId, itemName;
if (A.id) { itemId = parseInt(A.id, 10); if (!Number.isFinite(itemId)) die('--id must be a number');
  const names = await loadNames(); itemName = names[itemId] || ('#'+itemId); }
else if (A.item) { const names = await loadNames();
  const want = String(A.item).toLowerCase();
  const hit = Object.entries(names).find(([, n]) => String(n).toLowerCase() === want);
  if (!hit) die(`no item named "${A.item}" in the mapping — check spelling or pass --id`);
  itemId = Number(hit[0]); itemName = hit[1];
} else die('pass --item <name> or --id <n>');

// build the schema-correct completed-offer line (see sync-fills.mjs ADAPTER):
//   item->itemId, offer->price each, max->offer size, qty->cumulative filled, worth->gross spent
const state = type === 'buy' ? 'BOUGHT' : type === 'sell' ? 'SOLD'
            : type === 'withdraw' ? 'WITHDRAWN' : 'BANKED';
const line = JSON.stringify({
  date, time, state, slot: MANUAL_SLOT,
  item: itemId, qty, worth: priceEach * qty, max: qty, offer: priceEach
});

console.log(`\n${type.toUpperCase()} ${qty} × ${itemName} (#${itemId}) @ ${priceEach.toLocaleString()} ea  [${date} ${time}]`);
console.log('line:', line);
if (A.dry) { console.log('\n[dry] not written.'); process.exit(0); }
if (!fs.existsSync(LOG_DIR)) die('log dir not found: ' + LOG_DIR);
fs.appendFileSync(OUT, line + '\n');
console.log(`\nappended to ${OUT}`);
console.log('next: node pipeline/sync-fills.mjs --dry   (verify), then run it without --dry to write + push.');
