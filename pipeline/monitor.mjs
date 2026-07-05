#!/usr/bin/env node
/**
 * monitor.mjs — live GE position monitor (read-only companion to sync-fills.mjs).
 *
 * Parses the RuneLite Exchange Logger for (a) offers open RIGHT NOW, (b) recent
 * fills/cancels, and (c) HELD positions with cost basis + break-even — reconstructed
 * IN-MEMORY from the live log via the shared pipeline FIFO (reconstruct.mjs), so the
 * held count is real-time and correct (no positions.json ~20m lag, and no naive-log-sum
 * double-count of re-logged BOUGHT lines). Print-only — it never writes trade data.
 * It's the data source for the deterioration-watch polling routine documented in
 * pipeline/MONITORING.md (HOLD / WATCH / CUT with the evidence-gated 24h-cycle guard).
 *
 * Usage:  node pipeline/monitor.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonLine, buildEvents, reconstruct } from './reconstruct.mjs';
import { readExchangeLog, activeOffers } from './offers.mjs'; // shared log discovery + open-offer semantics
import { breakEven } from '../js/quotecore.js'; // shared tax-capped break-even (chunk 4.1 / BE1)
import { loadMapping } from './marketfetch.mjs'; // shared 24h-cached mapping loader (X1) — tolerates the flat cache shape

const HERE = path.dirname(fileURLToPath(import.meta.url));

// item id -> name via the shared mapping loader (24h-cached, tolerates whichever cache shape
// another script last wrote). Reduce its byId to the {id:name} lookup this snapshot needs.
const map = await loadMapping();
const name = {}; for (const id in map.byId) name[id] = map.byId[id].name;
const nm = id => name[id] || ('#'+id);

// shared log discovery + open-offer semantics (offers.mjs — one owner, also used by watch.mjs)
const { logLines, rows, staleMin } = readExchangeLog();
const ep = l => Date.parse(l.date+'T'+l.time);            // local wall-clock -> epoch
const now = Date.now();                                    // real wall clock — detects a stalled log
const active = activeOffers(rows);

const WIN_MIN = 30;
const terminal = rows.filter(r => /BOUGHT|SOLD|CANCELLED/.test(r.state) && (now-ep(r)) <= WIN_MIN*60000);

const ago = t => { const m = Math.round((now-ep(t))/60000); return m<=0?'just now':m+'m ago'; };
const gp = n => Number(n).toLocaleString('en-US');

console.log(`log freshness: newest line ${staleMin}m ago (wall-clock)`);
console.log('=== ACTIVE OFFERS (open now) ===');
if (!active.length) console.log('(none — no live buy/sell offers)');
for (const r of active) {
  const side = r.state === 'BUYING' ? 'BUY ' : 'SELL';
  console.log(`slot${r.slot} ${side} ${nm(r.item)} (#${r.item})  ${r.qty}/${r.max} @ ${gp(r.offer)}  · last update ${ago(r)}`);
}
console.log('\n=== FILLS / CANCELS (last '+WIN_MIN+'m) ===');
if (!terminal.length) console.log('(none)');
for (const r of terminal) {
  const px = r.qty>0 ? Math.round(r.worth/r.qty) : r.offer;
  console.log(`${r.time} ${r.state} ${nm(r.item)} (#${r.item})  qty ${r.qty} @ ~${gp(px)}  (${ago(r)})`);
}

// --- held positions: reconstructed IN-MEMORY from the live log via the shared pipeline
// FIFO (reconstruct.mjs). Real-time and correct — no positions.json lag, and collapseOffers
// dedups re-logged/duplicate BOUGHT lines so the held count never phantoms. ---
console.log('\n=== HELD POSITIONS (in-memory pipeline FIFO from live log · break-even = shared tax-capped breakEven) ===');
// parseJsonLine emits { remove } markers for REMOVE tombstone lines (the shared chunk-8 chain);
// the monitor doesn't apply tombstones, so drop those markers before sequencing.
const events = buildEvents(logLines.map(parseJsonLine).filter(r => r && r.remove === undefined));
const pos = reconstruct(events);
let held = pos.open.map(o => ({ item:o.itemId, qty:o.qty, cost:o.buyEach, be:breakEven(o.buyEach) }));
// Manual overrides. The Exchange Logger drops some SOLD events during fast same-second
// flipping, so the log can hold more buys than sells → the reconstruction over-counts held
// (confirmed: seeds logged 57 bought / 52 sold, but real held was 0). No FIFO fixes missing
// input, so held-override.json lets you reconcile to ground truth:
//   { "<itemId>": "<ISO-or-unix since>" }  — "I hold 0 of this as of <since>; count only
//   its log fills AFTER that time." Set it when you know a position is phantom; new trades
//   after <since> still track normally.
let ov = {}; try { ov = JSON.parse(fs.readFileSync(path.join(HERE,'held-override.json'),'utf8')); } catch {}
for (const [idStr, since] of Object.entries(ov)) {
  const id = +idStr, sinceTs = typeof since==='number' ? since : Math.floor(Date.parse(since)/1000);
  held = held.filter(h => h.item !== id);
  for (const o of reconstruct(events.filter(e => e.itemId===id && e.ts >= sinceTs)).open)
    held.push({ item:o.itemId, qty:o.qty, cost:o.buyEach, be:breakEven(o.buyEach) });
}
if (Object.keys(ov).length) console.log('(held-override active — reconciling: ' + Object.keys(ov).map(id=>nm(+id)).join(', ') + ')');
if (!held.length) console.log('(no open positions)');
for (const h of held) {
  const sell = active.find(a => a.item===h.item && a.state==='SELLING');
  const listed = sell ? `listed ${sell.qty}/${sell.max} @ ${gp(sell.offer)}` : 'NOT LISTED';
  console.log(`${nm(h.item)} (#${h.item})  qty ${h.qty} @ cost ${gp(h.cost)}  · break-even ${gp(h.be)}  · ${listed}`);
}

console.log('\nactive_item_ids:', active.map(r=>r.item).join(',') || '(none)');
console.log('held_item_ids:', held.map(h=>h.item).join(',') || '(none)');
