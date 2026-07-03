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
 *   --log-dir <dir> / --repo-dir <dir>   override the source log dir / output
 *                                  repo dir — for isolated fixture tests only
 *                                  (never point a test at the real dirs).
 *
 * Manual-line vocabulary (coffer-manual.log, slot 8 — see PLAN.md chunk 1):
 *   BOUGHT / SOLD                  normal manual fills (add-manual-fill.mjs / the app)
 *   WITHDRAWN                      inventory taken for personal use — consumes open lots
 *                                  FIFO into closed rows with realised 0
 *   BANKED                         pre-owned inventory entering the flip flow at a
 *                                  declared basis (worth/qty); tagged banked:true
 *   {"state":"REMOVE","target":"<eventId>"}   tombstone: deletes that event id from the
 *                                  merged set, including events already persisted in
 *                                  fills.json (source-level corrections propagate).
 *
 * Design: idempotent. Every run re-reads all log files, normalizes, and
 * dedupes by a content-derived event id. No watermark state to corrupt.
 * Personal trade volume is small; simplicity beats incremental cleverness.
 */

import { readFileSync, readdirSync, writeFileSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
// The ONE reconstruction chain (chunk 8): parse/sequence/collapse/FIFO-match + the content-hash
// event id all live in reconstruct.mjs so this pipeline AND monitor.mjs reconstruct positions
// identically (no more stale parallel copy). GE_TAX is imported transitively there — not needed here.
import { parseJsonLine, buildEvents, reconstruct, eventId } from './reconstruct.mjs';

/* ======================= CONFIG — edit these ======================= */
// --log-dir / --repo-dir overrides exist for isolated fixture tests (see the
// Acceptance block in PLAN.md chunk 1): point them at a temp dir so a test run
// never reads/writes Ben's real log or the live fills.json/positions.json.
function argVal(name){ const i = process.argv.indexOf(name); return (i >= 0 && i + 1 < process.argv.length) ? process.argv[i + 1] : undefined; }
const LOG_DIR   = argVal('--log-dir') || join(homedir(), '.runelite', 'exchange-logger'); // plugin output
const REPO_DIR  = argVal('--repo-dir') || 'C:\\dev\\The-Ledger';    // your git clone
const FILLS_REL = 'fills.json';                                    // raw event stream, repo-relative
const POSITIONS_REL = 'positions.json';                            // reconstructed trades/positions (app auto-populates Ledger from this)
const MAX_AGE_DAYS = 180;   // drop events older than this
const MAX_EVENTS   = 20000; // hard cap on stored events
const GIT_PUSH  = true;     // set false to stage commits without pushing
/* =================================================================== */

const args = new Set(process.argv.slice(2));
const PROBE = args.has('--probe'), DRY = args.has('--dry'), AUTO = args.has('--auto');
const AUTO_TRAILER = 'Auto-Fills-Sync: true'; // marks a commit as safe to amend-over on the next --auto run

/* ---------------------------------------------------------------------
 * ADAPTER + reconstruction now live in reconstruct.mjs (chunk 8) — the ONE
 * shared copy this pipeline AND monitor.mjs both reconstruct positions from,
 * so there is no longer a stale parallel copy that mis-handles WITHDRAWN/BANKED.
 * Imported at the top of this file:
 *   parseJsonLine — one line -> normalized event (incl. the REMOVE tombstone
 *     marker + the WITHDRAW/BANK -> 'withdraw'/'banked' type mapping),
 *   buildEvents   — sequence raw parses -> events (incl. the sequence-aware
 *     cancel-inference fallback for offers that drop straight to EMPTY),
 *   reconstruct   — collapseOffers + FIFO matchTrades (incl. the banked/withdraw
 *     branches + banked-aware open-lot keying),
 *   eventId       — the sha1 content-hash id (contract shared with js/fillslog.js).
 * See reconstruct.mjs's ADAPTER block for the verified field mapping. Only
 * runner-specific glue (log reading, tombstone merge, dedup, commit/push) is here.
 * ------------------------------------------------------------------- */
function positionsSig(p) { return JSON.stringify({ closed: p.closed, open: p.open, unmatched: p.unmatched }); } // ignore generatedAt

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
  const removeTargets = new Set(); // event ids tombstoned by REMOVE lines (chunk 1.4)
  for (const f of files) {
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      rawLines++;
      const r = parseJsonLine(line);
      if (r && r.remove !== undefined) { if (r.remove) removeTargets.add(r.remove); continue; }
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
  // Apply tombstones: a REMOVE line deletes its target event id from the merged set even if
  // that event was already persisted in fills.json (byIdMap seeded it from `prior`). Because
  // the REMOVE line itself lives on in coffer-manual.log, this stays idempotent across syncs —
  // a re-parsed source event is filtered out again every run.
  let merged = [...byIdMap.values()]
    .filter(e => e.ts >= cutoff && !removeTargets.has(e.id))
    .sort((a, b) => a.ts - b.ts);
  if (merged.length > MAX_EVENTS) merged = merged.slice(-MAX_EVENTS);
  if (removeTargets.size) console.log(`${removeTargets.size} tombstone target(s); ${[...byIdMap.values()].filter(e => removeTargets.has(e.id)).length} event(s) removed`);

  // Compare against prior *content* (events only), not the full JSON blob —
  // generatedAt always differs run-to-run, so comparing the whole blob would
  // make every run look "changed" and commit even with zero new trade
  // events. Both `merged` and `prior` are independently cutoff-filtered and
  // sorted the same way, so a real diff here means genuinely new/aged-out
  // events, not just a fresh timestamp.
  const eventsChanged = JSON.stringify(merged) !== JSON.stringify(prior);

  // reconstruct trades/positions from the full merged history
  const positionsPath = join(REPO_DIR, POSITIONS_REL);
  const pos = reconstruct(merged);
  let priorPosSig = null;
  if (existsSync(positionsPath)) { try { priorPosSig = positionsSig(JSON.parse(readFileSync(positionsPath, 'utf8'))); } catch { /* rebuild */ } }
  const positionsChanged = positionsSig(pos) !== priorPosSig;
  const changed = eventsChanged || positionsChanged;
  const realisedTotal = pos.closed.reduce((s, t) => s + t.realised, 0);

  console.log(`${files.length} log file(s), ${rawLines} lines (${parsedLines} valid trade line(s)), ${parsed} events after sequencing, ${merged.length} after merge${eventsChanged ? '' : ' (no change)'}`);
  console.log(`positions: ${pos.closed.length} closed lot(s) (realised ${realisedTotal >= 0 ? '+' : ''}${realisedTotal} after tax), ${pos.open.length} open, ${pos.unmatched.length} unmatched sell(s)${positionsChanged ? '' : ' (no change)'}`);
  if (DRY) {
    for (const e of merged) {
      console.log(`  ${new Date(e.ts * 1000).toISOString()} slot${e.slot} ${e.type} ${e.state} item=${e.itemId} price=${e.price} filled=${e.filled}/${e.qty} spent=${e.spent}`);
    }
    console.log('--- reconstructed ---');
    for (const t of pos.closed) console.log(t.withdrawn
      ? `  WITHDRAWN item=${t.itemId} qty=${t.qty} basis=${t.buyEach} (used, realised 0)`
      : `  CLOSED item=${t.itemId} qty=${t.qty} buy=${t.buyEach} sell=${t.sellEach} tax=${t.tax} realised=${t.realised >= 0 ? '+' : ''}${t.realised}${t.banked ? ' [banked basis]' : ''}`);
    for (const o of pos.open) console.log(`  OPEN   item=${o.itemId} qty=${o.qty} @ ${o.buyEach}${o.banked ? ' [banked]' : ''}`);
    for (const u of pos.unmatched) console.log(`  UNMATCHED SELL item=${u.itemId} qty=${u.qty} @ ${u.sellEach} (no logged buy — pre-log inventory)`);
    if (changed) console.log('[dry] would write + push');
    return;
  }
  if (!changed) return;

  if (eventsChanged) writeFileSync(fillsPath, JSON.stringify({
    app: 'the-coffer-fills', version: 1, generatedAt: new Date().toISOString(), events: merged
  }));
  if (positionsChanged) writeFileSync(positionsPath, JSON.stringify(pos));

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
    git(`add ${FILLS_REL} ${POSITIONS_REL}`);
    const status = git(`status --porcelain ${FILLS_REL} ${POSITIONS_REL}`);
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
