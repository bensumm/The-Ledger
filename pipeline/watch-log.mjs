#!/usr/bin/env node
/**
 * watch-log.mjs — the local log-watcher daemon (LW1).
 *
 * While Ben is at the PC with RuneLite running, this watches the Exchange Logger directory and
 * regenerates fills.json / positions.json / offers.json locally within ~seconds of every
 * fill/cancel/reprice — so the locally-served app (serve.cmd → localhost) shows fresh positions
 * AND live offers with no keystrokes. It does **ZERO git operations, ever** — no fetch/ff, no
 * commit, no push. That is the whole point: it preserves the FILLS-PIPELINE.md §12 invariant (no
 * unattended writer to `main`). Publishing to Pages (and therefore the phone) stays attended and
 * on-demand via `sync-fills.mjs` (no flag), exactly as before.
 *
 * It calls the SAME regenerate() core that `sync-fills.mjs --local` runs, imported in-process — so
 * the artifacts are byte-compatible with an attended sync (shared tombstones, dedupe, FIFO matcher)
 * and there is no second copy of the pipeline to drift.
 *
 * Started manually (`node pipeline/watch-log.mjs`, or the watch-log.cmd wrapper); dies with the
 * terminal. NO Task Scheduler job — that would reintroduce an unattended writer. Ctrl+C to stop.
 *
 * What it watches:
 *   - The Exchange Logger DIRECTORY (~/.runelite/exchange-logger), not a single file, so log
 *     ROTATION (exchange.log → exchange_YYYY-MM-DD.log) is caught.
 *   - coffer-manual.log lives INSIDE that same directory (add-manual-fill.mjs writes it as a
 *     sibling of exchange.log), so manual-fill / REMOVE-tombstone edits already fire the same
 *     watcher — no second fs.watch is needed. (mobile-fills.log lives at the repo root and is only
 *     as fresh as the local checkout; folding un-pulled phone writes is the ATTENDED sync's job,
 *     never this daemon's — see regenerate()'s --local note.)
 *
 * Windows fs.watch fires duplicate/rename events per change; a debounce coalesces the burst into
 * ONE regeneration. Deliberately NO polling fallback (per the plan) — keep it simple first.
 */
import fs from 'node:fs';
import { LOG_DIR } from './lib/offers.mjs';
import { regenerate } from './sync-fills.mjs';

const DEBOUNCE_MS = 10_000; // coalesce a burst of fs.watch events (and Windows rename dupes) into one run

// Optional --log-dir / --repo-dir overrides (same spelling as sync-fills.mjs): production runs use
// the defaults (the real ~/.runelite/exchange-logger + the repo clone regenerate() resolves), but
// an override lets a smoke test point the daemon at a temp dir so it never writes the live repo.
const argVal = name => { const i = process.argv.indexOf(name); return (i >= 0 && i + 1 < process.argv.length) ? process.argv[i + 1] : undefined; };
const watchDir = argVal('--log-dir') || LOG_DIR;
const repoDir = argVal('--repo-dir'); // undefined → regenerate() uses its module default

const hhmm = () => new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

function runRegen() {
  try {
    const r = regenerate({ write: true, logDir: watchDir, warn: false, ...(repoDir ? { repoDir } : {}) }); // write fills/positions/offers.json; ZERO git. warn:false — the daemon re-reads the whole log each change, so it stays quiet on historical re-emits (attended sync is the loud one).
    console.log(`${hhmm()} regenerated — ${r.merged.length} events, ${r.offersSnap.offers.length} open offers${r.changed ? '' : ' (no change)'}`);
  } catch (e) {
    console.error(`${hhmm()} regeneration FAILED: ${e && e.message || e}`);
  }
}

if (!fs.existsSync(watchDir)) {
  console.error(`Log dir not found: ${watchDir}\nIs the Exchange Logger plugin installed and has it logged at least one trade?`);
  process.exit(1);
}

console.log(`watch-log: watching ${watchDir}`);
console.log('watch-log: regenerating fills/positions/offers.json locally on every change — NO git, NO push. Ctrl+C to stop.');

let timer = null;
const schedule = () => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; runRegen(); }, DEBOUNCE_MS);
};

// Initial pass so the artifacts are fresh the moment the daemon starts.
runRegen();

// fs.watch on the directory (recursive not needed — the logs are flat in LOG_DIR, and
// coffer-manual.log is a sibling there). Every create/rename/write in the dir schedules a debounced
// regeneration; the debounce absorbs Windows' duplicate/rename event storms.
fs.watch(watchDir, { persistent: true }, () => schedule());

process.on('SIGINT', () => { console.log('\nwatch-log: stopped.'); process.exit(0); });
