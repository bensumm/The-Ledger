#!/usr/bin/env node
/**
 * sync-fills.mjs — The Coffer fill-data pipeline (Windows / RuneLite side)
 *
 * Reads Exchange Logger plugin output (.runelite/exchange-logger/*),
 * normalizes GE offer events into fills.json, commits and pushes to the
 * repo that GitHub Pages serves. The Coffer fetches fills.json same-origin.
 *
 * Sync is ON-DEMAND ONLY. The scheduler-era `--auto` amend/force-push branch (and the
 * CofferFillsSync Task Scheduler job / run-fills-sync wrappers that drove it) was EXCISED
 * 2026-07-05 (chunk X2); it was dead since the schedule was eliminated 2026-07-04
 * (G1 / FILLS-PIPELINE.md §12). Every run is now a fresh checkpoint commit landed via the
 * normal push path; git history is the recovery story if a schedule is ever wanted again.
 *
 * Usage:
 *   node sync-fills.mjs            manual run: parse -> merge -> new commit -> push
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
import { parseJsonLine, buildEvents, reconstruct, eventId } from './lib/reconstruct.mjs';

/* ======================= CONFIG — edit these ======================= */
// --log-dir / --repo-dir overrides exist for isolated fixture tests (see the
// Acceptance block in PLAN.md chunk 1): point them at a temp dir so a test run
// never reads/writes Ben's real log or the live fills.json/positions.json.
function argVal(name){ const i = process.argv.indexOf(name); return (i >= 0 && i + 1 < process.argv.length) ? process.argv[i + 1] : undefined; }
const LOG_DIR   = argVal('--log-dir') || join(homedir(), '.runelite', 'exchange-logger'); // plugin output
const REPO_DIR  = argVal('--repo-dir') || 'C:\\dev\\The-Ledger';    // your git clone
const FILLS_REL = 'fills.json';                                    // raw event stream, repo-relative
const POSITIONS_REL = 'positions.json';                            // reconstructed trades/positions (app auto-populates Ledger from this)
const MOBILE_REL = 'mobile-fills.log';                             // M1: phone-written source log at the repo ROOT (NOT in LOG_DIR) — read, never written here
const MAX_AGE_DAYS = 180;   // drop events older than this
const MAX_EVENTS   = 20000; // hard cap on stored events
const GIT_PUSH  = true;     // set false to stage commits without pushing
/* =================================================================== */

const args = new Set(process.argv.slice(2));
const PROBE = args.has('--probe'), DRY = args.has('--dry');

/* ---------------------------------------------------------------------
 * ADAPTER + reconstruction now live in reconstruct.mjs (chunk 8) — the ONE
 * shared copy this pipeline AND monitor.mjs both reconstruct positions from,
 * so there is no longer a stale parallel copy that mis-handles WITHDRAWN/BANKED.
 * Imported at the top of this file:
 *   parseJsonLine — one line -> normalized event (incl. the REMOVE tombstone
 *     marker + the WITHDRAW/BANK -> 'withdraw'/'banked' type mapping),
 *   buildEvents   — sequence raw parses -> events (EMPTY lines are consumed as
 *     slot boundaries only; the old cancel-to-EMPTY inference was removed
 *     2026-07-05 after a logout EMPTY-burst fabricated phantom cancels),
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

// ONE git runner (cwd = the clone). Hoisted to module scope so the pre-commit clobber-guard and
// the commit/push block share it.
const git = cmd => execSync(`git ${cmd}`, { cwd: REPO_DIR, stdio: 'pipe' }).toString().trim();

// Multi-writer rebase-or-abort (M1 step 1 — the mobile-parity write path). Two writers now
// touch origin/main: this PC sync (fills.json / positions.json / screen.json / suggestions.jsonl)
// and the PHONE (mobile-fills.log, appended via the GitHub contents API). Their file sets are
// DISJOINT by contract, so a phone push only ever moves origin/main *ahead* of this checkout —
// never a real content conflict. This guard therefore:
//   (1) fetches, then FAST-FORWARDS local main onto a moved origin/main BEFORE reading logs, so a
//       phone-pushed mobile-fills.log is on disk and gets READ during reconstruction below. The
//       sync then lands a FRESH commit on top of it (never an amend/force-push over the phone's
//       commit — the scheduler-era --auto amend path was excised in chunk X2, §12).
//   (2) LOUDLY ABORTS on a genuine divergence (local main has commits origin/main lacks). Under the
//       single-writer contract that is a STRUCTURAL bug (an unexpected local commit, a
//       double-writer, or a stale branch), not something to paper over — a plain push would be
//       rejected and a force-push would clobber the phone's commit, so we stop and make the human
//       reconcile. This replaces the old best-effort "warn and continue".
// A fetch/ref failure (offline, no remote) stays best-effort — logged and skipped so an offline
// sync still writes fills.json locally; only a *confirmed* divergence aborts.
function syncMainToRemote() {
  try { git('fetch origin'); }
  catch (e) { console.warn('Multi-writer guard: fetch skipped (' + e.message + ') — proceeding with local state (offline?).'); return; }
  let head, remote;
  try { head = git('rev-parse HEAD'); remote = git('rev-parse origin/main'); }
  catch (e) { console.warn('Multi-writer guard: could not resolve refs (' + e.message + ') — proceeding with local state.'); return; }
  if (head === remote) return;                          // already at the remote tip
  let behind = false;
  try { git(`merge-base --is-ancestor ${head} ${remote}`); behind = true; } catch { behind = false; }
  if (behind) {
    // origin/main moved ahead (typically a phone push to mobile-fills.log). ff so that file is
    // readable below; the sync's own commit lands fresh on top. A ff-only that fails here (dirty
    // tree, a ref race) is not something to paper over — route it into the same loud "reconcile by
    // hand" abort as a genuine divergence, so we never proceed on a half-updated checkout.
    try { git('merge --ff-only origin/main'); }
    catch (e) {
      console.error('Multi-writer guard: fast-forward onto moved origin/main FAILED (' + e.message + ') — ABORTING.');
      console.error('  origin/main moved ahead (a phone push?) but local main could not fast-forward — likely a dirty working tree or a ref race.');
      console.error('  Inspect `git status` and `git log --oneline HEAD..origin/main`, reconcile, then re-run the sync. Nothing was written.');
      process.exit(1);
    }
    console.log('Multi-writer guard: fast-forwarded local main onto moved origin/main (phone-pushed log(s) now readable).');
    return;
  }
  // Diverged — abort loudly. The phone writes ONLY mobile-fills.log; this machine writes ONLY
  // fills.json/positions.json/screen.json/suggestions.jsonl. They must never collide, so a real
  // divergence is a structural bug to fix by hand, not to force through.
  console.error('Multi-writer guard: local main has DIVERGED from origin/main — ABORTING.');
  console.error('  The phone writes only mobile-fills.log; this machine writes only fills.json/positions.json etc.');
  console.error('  A divergence means an unexpected local commit, a double-writer, or a stale branch.');
  console.error('  Inspect `git log --oneline origin/main..HEAD`, reconcile, then re-run the sync. Nothing was written.');
  process.exit(1);
}

function main() {
  const files = readLogFiles();
  // M1: mobile-fills.log lives at the REPO ROOT (tracked, appended by the phone via the GitHub
  // contents API), NOT in LOG_DIR — pull it in as an extra source so mobile trades flow through
  // the same reconstruction. Same line vocabulary as coffer-manual.log; its slot-9 lines sequence
  // independently of the desktop/CLI slot-8 manuals. Only READ here — the phone owns writes to it.
  // (The file is TRACKED, so it exists on disk in every checkout; the ff in syncMainToRemote below
  // only updates its CONTENTS, read by the parse loop afterwards — `sources` membership is stable.)
  const mobilePath = join(REPO_DIR, MOBILE_REL);
  const sources = existsSync(mobilePath) ? [...files, mobilePath] : files;
  if (!sources.length) { console.log('No log files found in ' + LOG_DIR + ' (and no ' + MOBILE_REL + ')'); return; }

  if (PROBE) {
    for (const f of sources.slice(-3)) {
      console.log('\n=== ' + f + ' (last 10 lines) ===');
      const lines = readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).slice(-10);
      for (const l of lines) {
        console.log('RAW    :', l.slice(0, 300));
        console.log('PARSED :', JSON.stringify(parseJsonLine(l)));
      }
    }
    console.log('\nIf PARSED shows empty:true for real trade lines, or wrong itemId/price/qty/filled/spent, fix parseJsonLine()/pick() names to match RAW.');
    console.log('Note: a cancelled offer is only "cancelled" if the log has an explicit CANCELLED_* line — EMPTY never implies a cancel (inference removed 2026-07-05); an offer whose terminal was never logged keeps its last logged state.');
    return;
  }

  // Multi-writer guard: get local main onto origin/main BEFORE reading logs (so a phone-pushed
  // mobile-fills.log is on disk and read below, and we merge onto the freshest committed events)
  // and before any commit/push. Skipped on --dry (no git side effects). Aborts on divergence.
  if (!DRY) syncMainToRemote();

  // parse everything
  let rawLines = 0, parsedLines = 0;
  const rawParsed = [];
  const removeTargets = new Set(); // event ids tombstoned by REMOVE lines (chunk 1.4)
  for (const f of sources) {
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

  console.log(`${sources.length} log source(s)${existsSync(mobilePath) ? ' (incl. ' + MOBILE_REL + ')' : ''}, ${rawLines} lines (${parsedLines} valid trade line(s)), ${parsed} events after sequencing, ${merged.length} after merge${eventsChanged ? '' : ' (no change)'}`);
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
  // On-demand only: every sync is its own fresh checkpoint commit landed via the normal push
  // path. The scheduler-era --auto amend/--force-with-lease rolling-commit branch was excised
  // 2026-07-05 (chunk X2) — it existed only to collapse the eliminated CofferFillsSync job's
  // ~20-min commits (FILLS-PIPELINE.md §12); git history is the recovery story. The
  // syncMainToRemote() clobber-guard above (ff-or-abort) is the live protection against
  // clobbering a phone push or a PR-merged main — a plain push here is safely rejected on any
  // race it didn't already catch.
  try {
    // Commit set: fills + positions always; screen.json (PLAN-2 C1 published scan) and
    // suggestions.jsonl (O1 append-only suggestions ledger) only when they exist on disk — same
    // add-only-these-files discipline, never a blanket `git add -A`. When present but unchanged
    // they simply contribute nothing to the porcelain status below.
    const SCREEN_REL = 'screen.json';
    const SUGGEST_REL = 'suggestions.jsonl';
    const commitFiles = [FILLS_REL, POSITIONS_REL];
    if (existsSync(join(REPO_DIR, SCREEN_REL))) commitFiles.push(SCREEN_REL);
    if (existsSync(join(REPO_DIR, SUGGEST_REL))) commitFiles.push(SUGGEST_REL);
    const fileArgs = commitFiles.join(' ');
    git(`add ${fileArgs}`);
    const status = git(`status --porcelain ${fileArgs}`);
    if (!status) { console.log('Nothing to commit.'); return; }

    const nowIso = new Date().toISOString().slice(0, 16) + 'Z';
    const message = `fills: sync ${nowIso} (${merged.length} events)`;

    const tmpMsgFile = join(REPO_DIR, '.fills-commit-msg.tmp');
    writeFileSync(tmpMsgFile, message);
    try {
      git(`commit -F "${tmpMsgFile}"`);
    } finally {
      unlinkSync(tmpMsgFile);
    }

    if (GIT_PUSH) {
      git('push');
      console.log('Pushed.');
    } else {
      console.log('Committed (push disabled).');
    }
  } catch (err) {
    console.error('Git step failed:', err.message);
    console.error('fills.json was written locally; resolve git manually or re-run.');
    process.exit(1);
  }
}

main();
