#!/usr/bin/env node
/**
 * sync-fills.mjs — The Coffer fill-data pipeline (Windows / RuneLite side)
 *
 * Reads Exchange Logger plugin output (.runelite/exchange-logger/*),
 * normalizes GE offer events into fills.json, commits and pushes to the
 * repo that GitHub Pages serves. The Coffer fetches fills.json same-origin.
 *
 * Usage:
 *   node sync-fills.mjs            manual run: parse -> merge -> new commit -> push
 *   node sync-fills.mjs --auto     scheduled run: same, but amends the previous
 *                                  commit (force-push) if it was itself an --auto
 *                                  commit, so Task Scheduler doesn't pile up a new
 *                                  commit every 15-30 min forever. Use this from
 *                                  Task Scheduler; use the no-flag form for one-off
 *                                  manual/Claude-driven syncs, which stay as their
 *                                  own distinct checkpoint commits.
 *   node sync-fills.mjs --probe    print first raw lines of each log file
 *                                  (use this ONCE to verify field mapping)
 *   node sync-fills.mjs --dry      parse + merge + report, no git push
 *
 * Design: idempotent. Every run re-reads all log files, normalizes, and
 * dedupes by a content-derived event id. No watermark state to corrupt.
 * Personal trade volume is small; simplicity beats incremental cleverness.
 */

import { readFileSync, readdirSync, writeFileSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

/* ======================= CONFIG — edit these ======================= */
const LOG_DIR   = join(homedir(), '.runelite', 'exchange-logger'); // plugin output
const REPO_DIR  = 'C:\\dev\\The-Ledger';                            // your git clone
const FILLS_REL = 'fills.json';                                    // output, repo-relative
const MAX_AGE_DAYS = 180;   // drop events older than this
const MAX_EVENTS   = 20000; // hard cap on stored events
const GIT_PUSH  = true;     // set false to stage commits without pushing
/* =================================================================== */

const args = new Set(process.argv.slice(2));
const PROBE = args.has('--probe'), DRY = args.has('--dry'), AUTO = args.has('--auto');
const AUTO_TRAILER = 'Auto-Fills-Sync: true'; // marks a commit as safe to amend-over on the next --auto run

/* ---------------------------------------------------------------------
 * ADAPTER — verified against a real log (2026-07-01, one buy + one
 * cancel). Exchange Logger (JSON mode) writes one line per slot-state
 * change, shaped like:
 *   {"date":"2026-07-01","time":"20:02:55","state":"BUYING","slot":3,
 *    "item":12695,"qty":0,"worth":0,"max":10,"offer":12600}
 * Field names are NOT what the schema calls them:
 *   item -> itemId, offer -> price, max -> qty (total offer size),
 *   qty -> filled (cumulative filled so far), worth -> spent (cumulative).
 * date+time are separate local-time strings, combined below.
 *
 * The plugin never emits a distinct "cancelled" state — a cancelled
 * offer just goes straight to state:"EMPTY" without ever reaching
 * BOUGHT/SOLD. Detecting cancellation requires looking at the sequence
 * of events per slot, not a single line in isolation — see
 * buildEvents() below, which does that pass. parseJsonLine() here only
 * normalizes one line; it returns `{ empty: true }` markers for
 * EMPTY/unrecognized lines so the sequencer can see slot-clear events.
 *
 * Normalized trade event: { ts, type:'buy'|'sell',
 *   state:'placed'|'partial'|'complete'|'cancelled', itemId, slot,
 *   price, qty, filled, spent }
 * ------------------------------------------------------------------- */
function pick(o, ...names) {
  for (const n of names) {
    if (o[n] !== undefined && o[n] !== null) return o[n];
    // case-insensitive fallback
    const k = Object.keys(o).find(k => k.toLowerCase() === n.toLowerCase());
    if (k !== undefined && o[k] !== null) return o[k];
  }
  return undefined;
}

function normalizeStateStr(s) {
  s = String(s || '').toUpperCase();
  if (s.includes('CANCEL')) return 'cancelled'; // not observed in practice, kept as a safety net
  if (s.includes('BOUGHT') || s.includes('SOLD') || s === 'COMPLETE' || s.includes('COMPLETED')) return 'complete';
  if (s.includes('BUYING') || s.includes('SELLING')) return 'partial'; // in-progress update; may be refined to 'placed' below
  return null;
}

function parseTs(o) {
  const dateStr = pick(o, 'date');
  const timeStr = pick(o, 'time');
  if (dateStr && timeStr) {
    const t = Math.floor(Date.parse(`${dateStr}T${timeStr}`) / 1000);
    if (Number.isFinite(t)) return t;
  }
  let raw = pick(o, 'time', 'timestamp', 'date', 'dateTime');
  if (typeof raw === 'string') return Math.floor(Date.parse(raw) / 1000);
  if (typeof raw === 'number') return raw > 1e12 ? Math.floor(raw / 1000) : raw;
  return NaN;
}

// Parses one JSON log line. Returns null for garbage/non-JSON lines,
// { empty: true, ts, slot } for EMPTY/unrecognized slot states (needed
// by the sequencer to detect cancellations), or a full trade-event
// candidate { empty: false, ts, slot, type, state, itemId, price, qty,
// filled, spent } otherwise.
function parseJsonLine(line) {
  line = line.trim();
  if (!line || line[0] !== '{') return null; // JSON mode expected; skip non-JSON (e.g. legacy TEXT lines)
  let o;
  try { o = JSON.parse(line); } catch { return null; }

  const ts = parseTs(o);
  if (!Number.isFinite(ts)) return null;
  const slot = Number(pick(o, 'slot'));

  const rawState = String(pick(o, 'state', 'status', 'offerState') ?? '').toUpperCase();
  const rawType = rawState;
  const type = rawType.includes('BUY') || rawType.includes('BOUGHT') ? 'buy'
             : rawType.includes('SELL') || rawType.includes('SOLD') ? 'sell' : null;

  const itemId = Number(pick(o, 'itemId', 'item_id', 'id', 'item'));

  if (rawState === 'EMPTY' || !type || !Number.isFinite(itemId) || itemId === 0) {
    return { empty: true, ts, slot };
  }

  const filled = Number(pick(o, 'qty', 'quantitySold', 'qtySold', 'filled', 'sold')) || 0;
  let state = normalizeStateStr(rawState);
  if (state === 'partial' && filled === 0) state = 'placed'; // just placed, nothing filled yet

  return {
    empty: false,
    ts,
    slot,
    type,
    state,
    itemId,
    price:  Number(pick(o, 'offer', 'price', 'offerPrice', 'pricePerItem')) || 0, // offer price each
    qty:    Number(pick(o, 'max', 'quantity', 'totalQuantity', 'amount')) || 0,   // total offer size
    filled,                                                                       // cumulative filled
    spent:  Number(pick(o, 'worth', 'spent', 'totalSpent', 'total_price', 'value')) || 0 // cumulative gp
  };
}

// Sequences raw per-line parses into final trade events, resolving
// cancellations: if a slot's last trade event never reached 'complete'
// before the slot goes EMPTY (or a different item appears in the same
// slot), that last event is retroactively marked 'cancelled'.
function buildEvents(rawLinesParsed) {
  const sorted = [...rawLinesParsed].sort((a, b) => a.ts - b.ts);
  const lastBySlot = new Map(); // slot -> last trade event object (mutated in place)
  const events = [];
  for (const r of sorted) {
    const prev = lastBySlot.get(r.slot);
    const slotChangedItem = prev && !r.empty && r.itemId !== prev.itemId;
    if ((r.empty || slotChangedItem) && prev && prev.state !== 'complete' && prev.state !== 'cancelled') {
      prev.state = 'cancelled';
    }
    if (r.empty || slotChangedItem) lastBySlot.delete(r.slot);
    if (r.empty) continue;
    events.push(r);
    lastBySlot.set(r.slot, r);
  }
  for (const e of events) delete e.empty;
  return events;
}
/* ------------------------- end adapter ---------------------------- */

function eventId(e) {
  return createHash('sha1')
    .update([e.ts, e.slot, e.itemId, e.type, e.state, e.filled, e.spent].join('|'))
    .digest('hex').slice(0, 16);
}

function readLogFiles() {
  if (!existsSync(LOG_DIR)) {
    console.error(`Log dir not found: ${LOG_DIR}\nIs the Exchange Logger plugin installed and has it logged at least one trade?`);
    process.exit(1);
  }
  return readdirSync(LOG_DIR)
    .filter(f => /\.(log|txt|json)$/i.test(f))
    .map(f => join(LOG_DIR, f))
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
}

function main() {
  const files = readLogFiles();
  if (!files.length) { console.log('No log files found in ' + LOG_DIR); return; }

  if (PROBE) {
    for (const f of files.slice(-3)) {
      console.log('\n=== ' + f + ' (last 10 lines) ===');
      const lines = readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).slice(-10);
      for (const l of lines) {
        console.log('RAW    :', l.slice(0, 300));
        console.log('PARSED :', JSON.stringify(parseJsonLine(l)));
      }
    }
    console.log('\nIf PARSED shows empty:true for real trade lines, or wrong itemId/price/qty/filled/spent, fix parseJsonLine()/pick() names to match RAW.');
    console.log('Note: cancellation is resolved across lines by buildEvents(), not visible per-line here — a cancelled offer\'s last line will show state:"partial"/"placed" here even though it ends up "cancelled" in fills.json.');
    return;
  }

  // parse everything
  let rawLines = 0, parsedLines = 0;
  const rawParsed = [];
  for (const f of files) {
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      rawLines++;
      const r = parseJsonLine(line);
      if (r) { rawParsed.push(r); parsedLines++; }
    }
  }
  const events = buildEvents(rawParsed);
  const parsed = events.length;
  for (const e of events) e.id = eventId(e);

  // merge with existing fills.json (keeps events whose source logs rotated away)
  const fillsPath = join(REPO_DIR, FILLS_REL);
  let prior = [];
  if (existsSync(fillsPath)) {
    try { prior = JSON.parse(readFileSync(fillsPath, 'utf8')).events || []; }
    catch { console.warn('Existing fills.json unreadable — rebuilding from logs only.'); }
  }
  const byIdMap = new Map();
  for (const e of [...prior, ...events]) byIdMap.set(e.id, e);

  const cutoff = Math.floor(Date.now() / 1000) - MAX_AGE_DAYS * 86400;
  let merged = [...byIdMap.values()]
    .filter(e => e.ts >= cutoff)
    .sort((a, b) => a.ts - b.ts);
  if (merged.length > MAX_EVENTS) merged = merged.slice(-MAX_EVENTS);

  // Compare against prior *content* (events only), not the full JSON blob —
  // generatedAt always differs run-to-run, so comparing the whole blob would
  // make every run look "changed" and commit even with zero new trade
  // events. Both `merged` and `prior` are independently cutoff-filtered and
  // sorted the same way, so a real diff here means genuinely new/aged-out
  // events, not just a fresh timestamp.
  const eventsChanged = JSON.stringify(merged) !== JSON.stringify(prior);
  console.log(`${files.length} log file(s), ${rawLines} lines, ${parsed} parsed, ${merged.length} events after merge${eventsChanged ? '' : ' (no change)'}`);
  if (DRY) {
    for (const e of merged) {
      console.log(`  ${new Date(e.ts * 1000).toISOString()} slot${e.slot} ${e.type} ${e.state} item=${e.itemId} price=${e.price} filled=${e.filled}/${e.qty} spent=${e.spent}`);
    }
    if (eventsChanged) console.log('[dry] would write + push');
    return;
  }
  if (!eventsChanged) return;

  const out = {
    app: 'the-coffer-fills',
    version: 1,
    generatedAt: new Date().toISOString(),
    events: merged
  };
  writeFileSync(fillsPath, JSON.stringify(out));

  // commit + push
  //
  // --auto (Task Scheduler) runs collapse into a single rolling commit via
  // --amend + --force-with-lease, instead of piling up a new commit every
  // 15-30 min forever. This is only safe because we check the marker below:
  // we only amend when HEAD is itself a prior auto-sync commit (identified
  // by the AUTO_TRAILER footer), so a manual/Claude-driven commit always
  // starts a fresh chain rather than getting silently absorbed. Manual runs
  // (no --auto) never amend — every manual run is its own checkpoint.
  const git = cmd => execSync(`git ${cmd}`, { cwd: REPO_DIR, stdio: 'pipe' }).toString().trim();
  try {
    git(`add ${FILLS_REL}`);
    const status = git('status --porcelain ' + FILLS_REL);
    if (!status) { console.log('Nothing to commit.'); return; }

    const nowIso = new Date().toISOString().slice(0, 16) + 'Z';
    let amend = false, sinceIso = nowIso;
    if (AUTO) {
      let headMsg = '';
      try { headMsg = git('log -1 --pretty=%B'); } catch { /* no commits yet */ }
      const sinceMatch = headMsg.match(/Auto-Fills-Sync-Since:\s*(\S+)/);
      if (headMsg.includes(AUTO_TRAILER) && sinceMatch) {
        amend = true;
        sinceIso = sinceMatch[1];
      }
    }

    const summary = AUTO
      ? `fills: auto-sync ${amend ? `${sinceIso}–${nowIso}` : nowIso} (${merged.length} events)`
      : `fills: sync ${nowIso} (${merged.length} events)`;
    const message = AUTO ? `${summary}\n\n${AUTO_TRAILER}\nAuto-Fills-Sync-Since: ${sinceIso}` : summary;

    const tmpMsgFile = join(REPO_DIR, '.fills-commit-msg.tmp');
    writeFileSync(tmpMsgFile, message);
    try {
      git(`commit ${amend ? '--amend' : ''} -F "${tmpMsgFile}"`);
    } finally {
      unlinkSync(tmpMsgFile);
    }

    if (GIT_PUSH) {
      git(amend ? 'push --force-with-lease' : 'push');
      console.log(amend ? 'Amended + force-pushed.' : 'Pushed.');
    } else {
      console.log(`Committed${amend ? ' (amended)' : ''} (push disabled).`);
    }
  } catch (err) {
    console.error('Git step failed:', err.message);
    console.error('fills.json was written locally; resolve git manually or re-run.');
    process.exit(1);
  }
}

main();
