#!/usr/bin/env node
/**
 * monitor.mjs — live GE position monitor (read-only companion to sync-fills.mjs).
 *
 * Parses the RuneLite Exchange Logger for (a) offers open RIGHT NOW and (b) recent
 * fills/cancels, and reads positions.json (pipeline-reconstructed FIFO) for HELD
 * positions with cost basis + break-even. Print-only — it never writes trade data.
 * It's the data source for the deterioration-watch polling routine documented in
 * pipeline/MONITORING.md (HOLD / WATCH / CUT with the evidence-gated 24h-cycle guard).
 *
 * Usage:  node pipeline/monitor.mjs
 *
 * Why held positions come from positions.json, not the log: a naive re-sum of terminal
 * log events double-counts re-logged/duplicate BOUGHT lines (found live 2026-07-02: an
 * 11:01 buy was re-logged identically at 11:15 → +5 phantom). The pipeline's
 * collapseOffers + matchTrades already handle dedup / cancels / partial fills / pre-log
 * inventory, so we trust its output and accept its ~20m freshness (cost basis is static).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');
const LOG = path.join(os.homedir(), '.runelite', 'exchange-logger', 'exchange.log');
const POS = path.join(REPO, 'positions.json');
const MAP_CACHE = path.join(HERE, 'mapping.cache.json'); // gitignored; refreshed every 24h
const MAP_URL = 'https://prices.runescape.wiki/api/v1/osrs/mapping';

// item id -> name, fetched from the wiki mapping and cached 24h so the tool is self-contained
async function loadNames() {
  try { if (Date.now() - fs.statSync(MAP_CACHE).mtimeMs < 24*3600*1000) return JSON.parse(fs.readFileSync(MAP_CACHE,'utf8')); } catch {}
  try {
    const arr = await (await fetch(MAP_URL, { headers: { 'user-agent': 'the-coffer-monitor/1.0' } })).json();
    const m = {}; for (const it of arr) m[it.id] = it.name;
    fs.writeFileSync(MAP_CACHE, JSON.stringify(m)); return m;
  } catch { try { return JSON.parse(fs.readFileSync(MAP_CACHE,'utf8')); } catch { return {}; } }
}
const name = await loadNames();
const nm = id => name[id] || ('#'+id);

const rows = [];
for (const raw of fs.readFileSync(LOG,'utf8').split('\n').filter(Boolean)) { try { rows.push(JSON.parse(raw)); } catch {} }
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

// --- held positions from positions.json (pipeline FIFO; see header note) ---
console.log('\n=== HELD POSITIONS (positions.json · pipeline FIFO · break-even = ceil(cost/0.98)) ===');
let held = [], pos = null;
try { pos = JSON.parse(fs.readFileSync(POS, 'utf8')); } catch {}
if (!pos || !Array.isArray(pos.open)) {
  console.log('(positions.json unavailable — run sync-fills.mjs)');
} else {
  const genMin = pos.generatedAt ? Math.round((now - Date.parse(pos.generatedAt))/60000) : null;
  console.log('(positions.json ' + (genMin!=null ? genMin+'m old' : 'age ?') + ' — pipeline syncs ~every 20m; very recent trades may lag)');
  held = pos.open.map(o => ({ item:o.itemId, qty:o.qty, cost:o.buyEach, be:Math.ceil(o.buyEach/0.98) }));
  if (!held.length) console.log('(no open positions)');
  for (const h of held) {
    const sell = active.find(a => a.item===h.item && a.state==='SELLING');
    const listed = sell ? `listed ${sell.qty}/${sell.max} @ ${gp(sell.offer)}` : 'NOT LISTED';
    console.log(`${nm(h.item)} (#${h.item})  qty ${h.qty} @ cost ${gp(h.cost)}  · break-even ${gp(h.be)}  · ${listed}`);
  }
}

console.log('\nactive_item_ids:', active.map(r=>r.item).join(',') || '(none)');
console.log('held_item_ids:', held.map(h=>h.item).join(',') || '(none)');
