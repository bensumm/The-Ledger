#!/usr/bin/env node
/**
 * monitor.mjs — live GE position monitor (read-only companion to sync-fills.mjs).
 *
 * Parses the RuneLite Exchange Logger for (a) offers open RIGHT NOW, (b) recent
 * fills/cancels, and (c) HELD positions with cost basis + break-even — reconstructed
 * IN-MEMORY from the live log via the shared pipeline FIFO (reconstruct.mjs), so the
 * held count is real-time and correct (no positions.json ~20m lag, and no naive-log-sum
 * double-count of re-logged BOUGHT lines). REMOVE tombstones in coffer-manual.log ARE
 * applied (ARCH-1) — the same correction sync-fills.mjs/positions.json honor — so a
 * purged/mobile-corrected lot never reappears here as a phantom hold. Print-only — it
 * never writes trade data.
 * It's the data source for the deterioration-watch polling routine documented in
 * pipeline/MONITORING.md (HOLD / WATCH / CUT with the evidence-gated 24h-cycle guard).
 *
 * Usage:  node pipeline/commands/monitor-offers.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconstruct, buildTombstonedEvents } from '../lib/reconstruct.mjs';
import { readExchangeLog, activeOffers } from '../lib/offers.mjs'; // shared log discovery + open-offer semantics
import { breakEven } from '../../js/quotecore.js'; // shared tax-capped break-even (chunk 4.1 / BE1)
import { loadMapping } from '../lib/marketfetch.mjs'; // shared 24h-cached mapping loader (X1) — tolerates the flat cache shape
import { blindWarningLine } from '../lib/logblind.mjs'; // LH2 restart-blindness header line
import { loadIgnored, quarantineEvents, offerQuarantined } from '../lib/ignored.mjs'; // MERCH-book quarantine (shared with positions.json/watch)

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..');

// MERCH-book quarantine (Ben, 2026-07-12): the live-log reconstruction below double-counts farming
// inputs / loot / personal-use consumables as "held" and their offers/fills as merch activity, so a
// morning review reads them back as phantom positions (the Snapdragon/Battlestaff false-bug reports).
// positions.json + watch already filter these via ignored.mjs; monitor was the ONE derived view that
// didn't. Apply the SAME quarantine here by default — held, active offers, and recent fills all skip a
// non-greenlisted ignored-item line — so the merch views agree. `--all` shows the full raw log for the
// rare "let me see everything" ask (a greenlisted confirmed flip is never hidden — that's the audit path).
const SHOW_IGNORED = process.argv.includes('--all');
const ignoreCfg = loadIgnored(REPO);
const quarantined = (id, price) => !SHOW_IGNORED && offerQuarantined(ignoreCfg, id, price);

// item id -> name via the shared mapping loader (24h-cached, tolerates whichever cache shape
// another script last wrote). Reduce its byId to the {id:name} lookup this snapshot needs.
const map = await loadMapping();
const name = {}; for (const id in map.byId) name[id] = map.byId[id].name;
const nm = id => name[id] || ('#'+id);

// shared log discovery + open-offer semantics (offers.mjs — one owner, also used by watch.mjs)
const { logLines, rows, staleMin } = readExchangeLog();
const ep = l => Date.parse(l.date+'T'+l.time);            // local wall-clock -> epoch
const now = Date.now();                                    // real wall clock — detects a stalled log
const activeAll = activeOffers(rows);
const active = activeAll.filter(r => !quarantined(r.item, r.offer)); // merch-view: hide ignored-item offers by default

const WIN_MIN = 30;
const terminalAll = rows.filter(r => /BOUGHT|SOLD|CANCELLED/.test(r.state) && (now-ep(r)) <= WIN_MIN*60000);
const terminal = terminalAll.filter(r => !quarantined(r.item, r.offer)); // merch-view: hide ignored-item fills/cancels

const ago = t => { const m = Math.round((now-ep(t))/60000); return m<=0?'just now':m+'m ago'; };
const gp = n => Number(n).toLocaleString('en-US');

// held positions reconstructed IN-MEMORY from the live log (shared FIFO). Computed up here so the
// LH2 restart-blindness heuristic (below) can weigh held inventory against visible offers in the
// header. LH1: validate the slot state machine (drops impossible same-slot double-terminals loudly)
// before the reconstruction, same as the pipeline does before its fills.json merge. parseJsonLine
// emits { remove } markers for REMOVE tombstone lines; ARCH-1 now ROUTES those the same way
// sync-fills.mjs does via the shared buildTombstonedEvents() helper — collect their targets, stamp
// each surviving event's content-hash id, then drop any event whose id was tombstoned. Without this
// the monitor's live-log FIFO re-materializes lots that positions.json has already purged → phantom
// holds + wrong listing advice (observed live 2026-07-05). warn:false keeps the LH1 re-emit chatter
// quiet on this frequently-re-run poll.
const eventsRaw = buildTombstonedEvents(logLines, { warn: false });
// merch-view: quarantine non-greenlisted ignored-item events out of the held reconstruction (same
// filter positions.json applies). eventsRaw is kept for the hidden-count footer below.
const events = SHOW_IGNORED ? eventsRaw : quarantineEvents(eventsRaw, ignoreCfg);
const pos = reconstruct(events);
let held = pos.open.map(o => ({ item:o.itemId, qty:o.qty, cost:o.buyEach, be:breakEven(o.buyEach) }));
// Manual overrides. The Exchange Logger drops some SOLD events during fast same-second flipping, so
// the log can hold more buys than sells → the reconstruction over-counts held (confirmed: seeds
// logged 57 bought / 52 sold, but real held was 0). No FIFO fixes missing input, so
// held-override.json lets you reconcile to ground truth:
//   { "<itemId>": "<ISO-or-unix since>" }  — "I hold 0 of this as of <since>; count only its log
//   fills AFTER that time." Set it when you know a position is phantom; new trades after <since>
//   still track normally.
let ov = {}; try { ov = JSON.parse(fs.readFileSync(path.join(HERE, '..', '.cache','held-override.json'),'utf8')); } catch {}
for (const [idStr, since] of Object.entries(ov)) {
  const id = +idStr, sinceTs = typeof since==='number' ? since : Math.floor(Date.parse(since)/1000);
  held = held.filter(h => h.item !== id);
  for (const o of reconstruct(events.filter(e => e.itemId===id && e.ts >= sinceTs)).open)
    held.push({ item:o.itemId, qty:o.qty, cost:o.buyEach, be:breakEven(o.buyEach) });
}

console.log(`log freshness: newest line ${staleMin}m ago (wall-clock)`);
// LH2: restart-blindness heads-up — a stale log with held inventory but no visible offers is the
// post-restart blind state (the plugin re-emits nothing until a slot next changes). No behavioral
// change; just names the failure so a session doesn't chase "vanished" offers.
const blind = blindWarningLine({ staleMin, activeOfferCount: active.length, openLotCount: held.length });
if (blind) console.log(blind);
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
console.log('\n=== HELD POSITIONS (in-memory pipeline FIFO from live log · REMOVE tombstones applied · break-even = shared tax-capped breakEven) ===');
// (held + held-override reconciliation are computed near the top so the LH2 blindness check can use
// the held count in the header; see that block.)
if (Object.keys(ov).length) console.log('(held-override active — reconciling: ' + Object.keys(ov).map(id=>nm(+id)).join(', ') + ')');
if (!held.length) console.log('(no open positions)');
for (const h of held) {
  const sell = active.find(a => a.item===h.item && a.state==='SELLING');
  const listed = sell ? `listed ${sell.qty}/${sell.max} @ ${gp(sell.offer)}` : 'NOT LISTED';
  console.log(`${nm(h.item)} (#${h.item})  qty ${h.qty} @ cost ${gp(h.cost)}  · break-even ${gp(h.be)}  · ${listed}`);
}

console.log('\nactive_item_ids:', active.map(r=>r.item).join(',') || '(none)');
console.log('held_item_ids:', held.map(h=>h.item).join(',') || '(none)');

// merch-view footer: name how many raw-log lines the quarantine hid this pass, so the filter is
// visible (never silent) and the `--all` escape is discoverable. Held-hidden = the extra open lots the
// unfiltered reconstruction would have shown (farming/loot/personal-use phantoms).
if (!SHOW_IGNORED) {
  const hiddenHeld = Math.max(0, reconstruct(eventsRaw).open.length - pos.open.length);
  const hiddenOffers = activeAll.length - active.length;
  const hiddenFills = terminalAll.length - terminal.length;
  if (hiddenHeld + hiddenOffers + hiddenFills > 0)
    console.log(`\n(quarantined from this merch view — held ${hiddenHeld}, offers ${hiddenOffers}, fills ${hiddenFills}; farming/loot/personal-use per ignored-items.json — pass --all to show)`);
}
