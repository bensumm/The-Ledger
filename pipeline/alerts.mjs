#!/usr/bin/env node
/**
 * alerts.mjs — the PUSH-NOTIFICATION TRIGGER ENGINE (PLAN chunk N1, design-first).
 *
 * DELIVERY-AGNOSTIC by design. This script only DETECTS market events worth a buzz and
 * EMITS them as structured JSON lines (plus a human-readable line) on stdout. It NEVER
 * sends a notification itself — the scheduled Claude Code background session (delivery
 * option (a), see pipeline/MONITORING.md "Push notifications") runs `node pipeline/alerts.mjs`
 * and calls ITS OWN PushNotification tool on this output. That keeps zero new infra in the
 * repo while the delivery mechanism is trialed live.
 *
 * Three trigger classes (spec'd in MONITORING.md):
 *   1. POSITION — a held position's verdict escalates to CUT / CUT-CANDIDATE, or Momentum
 *      hits ↓↓ (a strong 2h breakdown) on a held item. Verdict comes from the SHARED
 *      momVerdict() gate tree in js/quotecore.js — identical to `quote.mjs --positions`,
 *      never re-implemented here.
 *   2. FILL — a resting GE offer filled/completed (read from the exchange log via offers.mjs,
 *      the same source monitor.mjs uses).
 *   3. PRICE — a live price crosses an explicit named alert ("tell me if X breaks Y"), read
 *      from the tracked repo-root alerts.json.
 *
 * TRANSITION-ONLY: every class fires on a STATE CHANGE vs the last run, never on a level.
 * Last-run state lives in a small gitignored file (.alerts-state.json); the first run seeds
 * it and emits nothing new, a second run with an unchanged market emits nothing at all, and
 * only a genuine transition (a new verdict, a new fill, a fresh price cross) prints a line.
 *
 * Quiet hours (S2 posture clock, 22:00–06:00 local via isOvernightNow) SUPPRESS position and
 * price alerts so the phone doesn't buzz overnight — but a suppressed transition is NOT
 * committed to state, so it re-surfaces (fires once) at the first run after 06:00. FILLS are
 * exempt from quiet hours: a completed trade always notifies.
 *
 * Read-only w.r.t. trade data: never touches positions.json / fills.json / the exchange log
 * except to READ. The only file it writes is its own gitignored state file.
 *
 * Usage:  node pipeline/alerts.mjs            # detect + emit transitions
 *         node pipeline/alerts.mjs --dry-run  # detect + emit WITHOUT updating the state file
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeQuote, momVerdict, breakEven, isOvernightNow, MOM_STRONG_PCT } from '../js/quotecore.js';
import { fmtP } from '../js/format.js';
import { loadMapping, loadGuide, fetchLatest, fetchTs, fetch24hOne, sleep } from './marketfetch.mjs';
import { readExchangeLog } from './offers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const POSITIONS = path.join(HERE, '..', 'positions.json');
const ALERTS = path.join(HERE, '..', 'alerts.json');          // TRACKED — named price alerts, edited in sessions
const STATE_FILE = path.join(HERE, '.alerts-state.json');     // GITIGNORED — last-run state per item/offer/alert

const DRY_RUN = process.argv.includes('--dry-run');

/* ---- Named dedupe / cooldown constants (tune here, never inline) --------------------------
 * ALERT_COOLDOWN_MIN — a POSITION or PRICE alert for the same (class, item) won't re-fire
 *   within this window even if the state keeps oscillating (anti-flap). A genuine NEW
 *   transition is still required; the cooldown just throttles a chattering signal.
 * FILL_WINDOW_MIN    — how far back each run scans the exchange log for terminal fill events.
 * FILL_DEDUPE_TTL_MIN— how long a fired fill-event key is remembered so a still-in-window
 *   terminal line isn't re-alerted on the next run (must exceed FILL_WINDOW_MIN with margin).
 */
export const ALERT_COOLDOWN_MIN = 60;
export const FILL_WINDOW_MIN = 60;
export const FILL_DEDUPE_TTL_MIN = 720;   // 12h

const now = Date.now();
const nowIso = new Date(now).toISOString();
const minsSince = ms => (now - ms) / 60000;

/* ---- state I/O ---------------------------------------------------------------------------- */
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { version: 1, held: {}, fills: {}, price: {} }; }
}
function saveState(st) {
  if (DRY_RUN) return;
  st.version = 1; st.updatedAt = nowIso;
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 0)); }
  catch (e) { console.error('! could not write alert state: ' + (e && e.message || e)); }
}

/* ---- emit: one JSON line + one human line per alert, ONLY on a transition ----------------- */
const emitted = [];
function emit(obj, human) {
  emitted.push({ obj, human });
  console.log(JSON.stringify({ type: 'alert', ts: nowIso, ...obj }));
  console.log('ALERT [' + obj.class + '] ' + human);
}

/* ---- per-item live inputs (same primitives quote.mjs uses; a 4-line fetch helper, not a
 *      re-implementation of the quote math — that all lives in computeQuote/momVerdict) ------ */
async function fetchInputs(id) {
  const latest = await fetchLatest(id); await sleep(60);
  const ts5m = await fetchTs(id, '5m'); await sleep(60);
  const ts6h = await fetchTs(id, '6h'); await sleep(60);
  const vol24 = await fetch24hOne(id);
  return { latest, ts5m, ts6h, vol24 };
}

/* ==========================================================================================
 * CLASS 1 — POSITION verdict escalation / strong breakdown
 * ========================================================================================== */
// Returns the alertable signal for a held row, or null. `sig` is the transition key stored in
// state; a change in sig (and cooldown clear) is what fires. Verdict text is sourced from the
// shared momVerdict() so it can't drift from the app / quote.mjs.
function positionSignal(row, be, lotValue, ts5m) {
  const mv = momVerdict(row, be, lotValue, ts5m);
  const strongDown = row.mom === 'breakdown' && (row.momPct || 0) >= MOM_STRONG_PCT;
  const underwater = be != null && row.quickSell != null && row.quickSell < be;
  // (a) momVerdict escalated to a CUT-class decision (CUT or CUT-CANDIDATE both carry action CUT)
  if (mv && mv.action === 'CUT') {
    return { sig: mv.verdict + (strongDown ? '+↓↓' : ''), verdict: mv.verdict, why: mv.why, mom: strongDown ? '↓↓' : null };
  }
  // (b) falling regime + underwater with a clean/na mom (momVerdict returns null here) — this is
  // the CUT quote.mjs --positions prints from its falling branch; surface it as a push too.
  if (!mv && row.falling && underwater && row.reliable !== false) {
    return { sig: 'CUT-FALLING', verdict: 'CUT', why: 'falling regime & underwater — free capital (0.20.0 clear rule).', mom: null };
  }
  // (c) strong 2h breakdown (↓↓) on a held lot is itself a trigger even before the verdict flips
  if (strongDown && row.reliable !== false) {
    return { sig: '↓↓' + (mv ? '+' + mv.verdict : ''), verdict: mv ? mv.verdict : 'HOLD', why: 'live 2h strong breakdown (↓↓) on a held lot — the live sell has pushed >' + Math.round(MOM_STRONG_PCT * 100) + '% below its own 2h floor.', mom: '↓↓' };
  }
  return null;
}

async function runPositions(st) {
  let pos;
  try { pos = JSON.parse(fs.readFileSync(POSITIONS, 'utf8')); }
  catch { console.error('! cannot read positions.json — skipping position alerts'); return; }
  const open = (pos.open || []).filter(l => l.qty > 0);
  if (!open.length) return;
  // group by itemId at weighted-avg cost (same as quote.mjs --positions)
  const byItem = new Map();
  for (const l of open) {
    const g = byItem.get(l.itemId) || { qty: 0, cost: 0 };
    g.qty += l.qty; g.cost += l.qty * l.buyEach; byItem.set(l.itemId, g);
  }
  const map = await loadMapping();
  const guide = await loadGuide();
  const quiet = isOvernightNow();
  const seen = new Set();
  for (const [itemId, g] of byItem) {
    seen.add(String(itemId));
    const name = map.byId[itemId]?.name || ('#' + itemId);
    const avgCost = g.cost / g.qty;
    const be = breakEven(avgCost);
    const inp = await fetchInputs(itemId);
    const row = computeQuote({ ...inp, guide: guide[itemId] ?? null, limit: map.byId[itemId]?.limit ?? null, held: true, asked: true });
    const s = positionSignal(row, be, g.cost, inp.ts5m);
    const prev = st.held[String(itemId)] || null;
    if (!s) { st.held[String(itemId)] = { sig: null }; continue; }   // no longer alerting → clear baseline
    const transitioned = !prev || prev.sig !== s.sig;
    const cooldownOk = !prev || !prev.alertedAt || minsSince(prev.alertedAt) >= ALERT_COOLDOWN_MIN;
    if (transitioned && cooldownOk) {
      if (quiet) { /* suppressed overnight: DO NOT commit — leave prev so it re-fires after 06:00 */ continue; }
      emit(
        { class: 'position', itemId, item: name, qty: g.qty, verdict: s.verdict, mom: s.mom, instabuy: row.quickSell, breakEven: be, why: s.why },
        `${name} ×${g.qty} — ${s.verdict}${s.mom ? ' ' + s.mom : ''} · live ${fmtP(row.quickSell)} vs break-even ${fmtP(be)}. ${s.why}`
      );
      st.held[String(itemId)] = { sig: s.sig, alertedAt: now };
    } else {
      // same signal (or cooling down): keep the stored sig/alertedAt current, don't re-fire
      st.held[String(itemId)] = { sig: s.sig, alertedAt: prev && prev.alertedAt ? prev.alertedAt : (prev && prev.sig === s.sig ? now : undefined) };
    }
  }
  // drop state for items no longer held
  for (const k of Object.keys(st.held)) if (!seen.has(k)) delete st.held[k];
}

/* ==========================================================================================
 * CLASS 2 — FILL: a resting offer filled/completed (exchange log, via offers.mjs)
 * ========================================================================================== */
// Terminal fill events in the last FILL_WINDOW_MIN, keyed by a stable identity so the same
// log line is alerted exactly once. FILLS bypass quiet hours (a completed trade always buzzes).
function runFills(st, names) {
  let logRead;
  try { logRead = readExchangeLog(); }
  catch { return; }   // no exchange log on this machine → no fill alerts (e.g. running off-PC)
  const { rows } = logRead;
  const ep = r => Date.parse(r.date + 'T' + r.time);
  const cutoff = now - FILL_WINDOW_MIN * 60000;
  const terminal = rows.filter(r => /BOUGHT|SOLD/.test(r.state) && Number.isFinite(ep(r)) && ep(r) >= cutoff);
  // prune expired dedupe keys first
  for (const k of Object.keys(st.fills)) if (minsSince(st.fills[k]) > FILL_DEDUPE_TTL_MIN) delete st.fills[k];
  for (const r of terminal) {
    const key = `${r.slot}:${r.item}:${r.state}:${r.date}T${r.time}`;
    if (st.fills[key]) continue;                       // already alerted this exact terminal line
    st.fills[key] = now;                               // remember it (transition = a new key)
    const side = /BOUGHT/.test(r.state) ? 'BUY' : 'SELL';
    const px = r.qty > 0 ? Math.round(r.worth / r.qty) : r.offer;
    const nm = names[r.item] || ('#' + r.item);
    emit(
      { class: 'fill', itemId: r.item, item: nm, side, qty: r.qty, price: px, slot: r.slot },
      `${side} filled — ${nm} ×${r.qty} @ ${fmtP(px)} (slot ${r.slot})`
    );
  }
}

/* ==========================================================================================
 * CLASS 3 — PRICE: an explicit named alert crosses ("tell me if X breaks Y")
 * ========================================================================================== */
// alerts.json (tracked): [{ itemId, direction: "above"|"below", price, note? }].
// Basis: the live mid ((instabuy+instasell)/2 from /latest) — a single symmetric reference.
// Transition: fires only when the mid CROSSES from the not-triggered side to the triggered
// side (below→above for "above", above→below for "below"); a persistent breach doesn't re-fire.
async function runPriceAlerts(st, map, names) {
  let defs = [];
  try { defs = JSON.parse(fs.readFileSync(ALERTS, 'utf8')); } catch { return; }
  if (!Array.isArray(defs) || !defs.length) return;
  const quiet = isOvernightNow();
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i]; if (!d || d.itemId == null || d.price == null) continue;
    const dir = d.direction === 'above' ? 'above' : 'below';
    const id = String(d.itemId);
    const key = `${id}:${dir}:${d.price}`;             // identity survives reordering of the array
    const latest = await fetchLatest(d.itemId); await sleep(60);
    const hi = latest && latest.high, lo = latest && latest.low;
    const mid = (hi != null && lo != null) ? (hi + lo) / 2 : (hi ?? lo ?? null);
    if (mid == null) continue;
    const triggered = dir === 'above' ? mid >= d.price : mid <= d.price;
    const prev = st.price[key] || null;
    const wasTriggered = prev && prev.crossed;
    if (triggered && !wasTriggered) {
      const cooldownOk = !prev || !prev.alertedAt || minsSince(prev.alertedAt) >= ALERT_COOLDOWN_MIN;
      if (cooldownOk && !quiet) {
        const nm = names[d.itemId] || map.byId[d.itemId]?.name || ('#' + d.itemId);
        emit(
          { class: 'price', itemId: d.itemId, item: nm, direction: dir, threshold: d.price, price: Math.round(mid), note: d.note || null },
          `${nm} ${dir === 'above' ? 'rose above' : 'fell below'} ${fmtP(d.price)} — now ~${fmtP(Math.round(mid))}${d.note ? ' (' + d.note + ')' : ''}`
        );
        st.price[key] = { crossed: true, alertedAt: now };
      } else if (quiet) {
        /* suppressed overnight — leave prev (or absent) so the cross re-fires after 06:00 */
      } else {
        st.price[key] = { crossed: true, alertedAt: prev && prev.alertedAt ? prev.alertedAt : now };
      }
    } else {
      st.price[key] = { crossed: triggered, alertedAt: prev && prev.alertedAt ? prev.alertedAt : undefined };
    }
  }
  // prune state for alerts removed from alerts.json
  const live = new Set(defs.filter(d => d && d.itemId != null).map(d => `${d.itemId}:${d.direction === 'above' ? 'above' : 'below'}:${d.price}`));
  for (const k of Object.keys(st.price)) if (!live.has(k)) delete st.price[k];
}

/* ---- main -------------------------------------------------------------------------------- */
const st = loadState();
const map = await loadMapping();
const names = {}; for (const id in map.byId) names[id] = map.byId[id].name;

await runPositions(st);
runFills(st, names);
await runPriceAlerts(st, map, names);

saveState(st);

// Diagnostics go to STDERR so stdout carries ONLY alert lines (empty stdout = nothing fired).
console.error(`alerts: ${emitted.length} transition(s)${DRY_RUN ? ' [dry-run: state not written]' : ''}${isOvernightNow() ? ' [quiet hours: position/price suppressed, fills exempt]' : ''} @ ${nowIso}`);
