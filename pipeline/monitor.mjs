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
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonLine, buildEvents, reconstruct } from './reconstruct.mjs';
import { breakEven } from '../js/quotecore.js'; // shared break-even = ceil(cost/0.98) (chunk 4.1)

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(os.homedir(), '.runelite', 'exchange-logger');
const MAP_CACHE = path.join(HERE, 'mapping.cache.json'); // gitignored; refreshed every 24h
const MAP_URL = 'https://prices.runescape.wiki/api/v1/osrs/mapping';

// item id -> name, fetched from the wiki mapping and cached 24h so the tool is self-contained
// mapping.cache.json is shared with marketfetch.mjs (richer {id:{name,limit}} shape); flatten to
// {id:name} on read so names resolve regardless of which script last wrote the cache (chunk 4.5).
const flattenNames = obj => { const m = {}; for (const k in obj) { const v = obj[k]; m[k] = (v && typeof v === 'object') ? v.name : v; } return m; };
async function loadNames() {
  try { if (Date.now() - fs.statSync(MAP_CACHE).mtimeMs < 24*3600*1000) return flattenNames(JSON.parse(fs.readFileSync(MAP_CACHE,'utf8'))); } catch {}
  try {
    const arr = await (await fetch(MAP_URL, { headers: { 'user-agent': 'the-coffer-monitor/1.0' } })).json();
    const m = {}; for (const it of arr) m[it.id] = it.name;
    fs.writeFileSync(MAP_CACHE, JSON.stringify(m)); return m;
  } catch { try { return flattenNames(JSON.parse(fs.readFileSync(MAP_CACHE,'utf8'))); } catch { return {}; } }
}
const name = await loadNames();
const nm = id => name[id] || ('#'+id);

// read every log file in mtime order (captures rotated logs), same discovery as the pipeline
const logFiles = fs.readdirSync(LOG_DIR).filter(f => /\.(log|txt|json)$/i.test(f))
  .map(f => path.join(LOG_DIR, f)).sort((a,b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
const logLines = logFiles.flatMap(f => fs.readFileSync(f,'utf8').split('\n')).filter(Boolean);
const rows = [];
for (const raw of logLines) { try { rows.push(JSON.parse(raw)); } catch {} }
const ep = l => Date.parse(l.date+'T'+l.time);            // local wall-clock -> epoch
const lastLog = Math.max(...rows.map(ep));                 // newest event time in the log
const now = Date.now();                                    // real wall clock — detects a stalled log
const staleMin = Math.round((now - lastLog)/60000);

// latest line per slot = that slot's current state
const bySlot = new Map();
for (const r of rows) bySlot.set(r.slot, r);
const ACTIVE = s => s === 'BUYING' || s === 'SELLING';
const active = [];
for (const [, r] of bySlot) if (ACTIVE(r.state)) active.push(r);

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
console.log('\n=== HELD POSITIONS (in-memory pipeline FIFO from live log · break-even = ceil(cost/0.98)) ===');
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
