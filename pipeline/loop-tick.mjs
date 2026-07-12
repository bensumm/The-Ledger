#!/usr/bin/env node
/**
 * loop-tick.mjs — the MULTI-ACTION monitoring-loop driver (Ben, 2026-07-12).
 *
 * The `/loop` skill fires ONE command per tick. Historically that command was
 * `node pipeline/watch.mjs` — positions only. This driver multiplexes several actions onto a single
 * loop, each on its OWN cadence, so one `/loop` can both watch the book AND periodically re-scan for
 * fresh opportunities. Fire it at the GCD of the action intervals (see the printed recommendation);
 * the driver is TIME-GATED (not tick-counting), so it stays correct even if the cron jitters or the
 * intervals don't divide evenly.
 *
 *   node pipeline/loop-tick.mjs [--watch <min>|off] [--scan <min>|off] [--min-idle <gp>]
 *
 * Defaults: --watch 30  --scan 15  --min-idle 20000000  (Ben's stated example: positions every 30m,
 * opportunity scan every 15m). Recommended cron interval = gcd(watch, scan).
 *
 * Actions (run in this order when both are due — positions before discovery):
 *   watch — `node pipeline/watch.mjs`         : the position/offer deterioration pass (every --watch min).
 *   scan  — `node pipeline/screen.mjs --mode all` : opportunity discovery (every --scan min), GATED on idle
 *           capital — skipped when availableCash < --min-idle (nothing to deploy → don't burn a scan or the
 *           agent's judgment pass). The gate uses the DERIVED available cash (cashderive.mjs — coins free to
 *           commit now without cancelling a resting bid), the same figure watch.mjs footers.
 *
 * A skipped-for-capital scan STILL stamps its lastRun, so the cadence is "re-check whether to scan every
 * --scan min", not "retry every tick until capital appears". State: pipeline/.cache/loop-state.json.
 *
 * This is a pure DRIVER — it execs the existing scripts and streams their stdout (so the agent reads and
 * interprets each action's output exactly as before). It never fetches, writes trade data, or places an
 * offer. Node-only consumer → no APP_VERSION concern. Registry entry: README "Map of the repo".
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadDerivedCash } from './lib/cashderive.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');
const STATE = path.join(HERE, '.cache', 'loop-state.json');
const GRACE_MS = 60_000; // a tick firing up to 60s early still counts an action "due" (cron jitter)

// --- parse args ---
const argv = process.argv.slice(2);
const argOf = (flag, dflt) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : dflt; };
const parseInterval = v => (v === 'off' || v === '0') ? null : Math.max(1, Math.round(Number(v)));
const watchMin = parseInterval(argOf('--watch', '30'));
const scanMin = parseInterval(argOf('--scan', '15'));
const minIdle = Math.max(0, Math.round(Number(argOf('--min-idle', '20000000'))));

const gcd = (a, b) => b ? gcd(b, a % b) : a;
const cronMin = [watchMin, scanMin].filter(Boolean).reduce((a, b) => gcd(a, b), 0) || 15;

// --- load / init state ---
let state = {};
try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { state = {}; }
const now = Date.now();
const due = (key, min) => min != null && (state[key] == null || (now - state[key]) >= min * 60_000 - GRACE_MS);

const fmtGp = n => n == null ? 'n/a' : (Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(2) + 'm' : Math.round(n).toLocaleString('en-US'));
const hhmm = new Date(now).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

const watchDue = due('watch', watchMin);
const scanDue = due('scan', scanMin);

// --- scan capital gate (only evaluated when the scan is actually due) ---
let scanRun = false, scanSkipReason = null, idle = null;
if (scanDue) {
  try { const c = loadDerivedCash(REPO); idle = c && c.known ? c.availableCash : null; } catch { idle = null; }
  // idle unknown (no cash anchor) → don't block discovery; run the scan.
  if (idle != null && idle < minIdle) scanSkipReason = `idle ${fmtGp(idle)} < floor ${fmtGp(minIdle)} — no capital to deploy`;
  else scanRun = true;
}

// --- header ---
const plan = [];
if (watchDue) plan.push('watch');
if (scanDue) plan.push(scanRun ? 'scan' : 'scan(skipped)');
const cad = m => m == null ? 'off' : `${m}m`;
const idleNote = scanSkipReason ? ` · ${scanSkipReason}` : (idle != null ? ` · idle ${fmtGp(idle)}` : '');
console.log(`# loop-tick ${hhmm} — cadence watch ${cad(watchMin)} / scan ${cad(scanMin)} · fire every ${cronMin}m`);
console.log(`# this tick: ${plan.length ? plan.join(', ') : 'nothing due'}${idleNote}\n`);

const runScript = (label, args) => {
  console.log(`\n===== ${label} =====`);
  try {
    execFileSync('node', args, { cwd: REPO, stdio: 'inherit' });
  } catch (e) {
    // a sub-script's non-zero exit shouldn't abort the tick — report and continue to the next action.
    console.log(`(${label} exited non-zero: ${e.status ?? e.message})`);
  }
};

if (watchDue) { runScript('POSITIONS (watch.mjs)', ['pipeline/watch.mjs']); state.watch = now; }
if (scanDue) {
  if (scanRun) runScript('SCAN (screen.mjs --mode all)', ['pipeline/screen.mjs', '--mode', 'all']);
  else console.log(`\n===== SCAN skipped =====\n${scanSkipReason} (re-checks in ${scanMin}m)`);
  state.scan = now; // stamp regardless — the cadence is "decide whether to scan", not "retry until funded"
}

// --- persist state ---
try { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(state)); } catch {}

if (!watchDue && !scanDue) console.log('(nothing due this tick — next action within one interval)');

// --- next-iteration schedule (Ben, 2026-07-12): name the local time each action is next DUE, and the
// earliest of them (the next tick that actually does work). Due = lastRun + interval; an action that just
// ran was stamped `now`, so its next-due is now + interval. The cron fires every `cronMin`, so the real run
// is the first fire at/after the due time — we print the due time (the meaningful "when will it run" answer).
const localHM = ms => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const relMin = ms => Math.max(0, Math.round((ms - now) / 60000));
const dueAt = (key, min) => min == null ? null : (state[key] ?? now) + min * 60_000;
const nextWatch = dueAt('watch', watchMin), nextScan = dueAt('scan', scanMin);
const parts = [];
if (nextWatch != null) parts.push(`watch ~${localHM(nextWatch)} (${relMin(nextWatch)}m)`);
if (nextScan != null) parts.push(`scan ~${localHM(nextScan)} (${relMin(nextScan)}m)`);
const earliest = [nextWatch, nextScan].filter(v => v != null).sort((a, b) => a - b)[0];
if (parts.length) console.log(`\n# next due: ${parts.join(' · ')}${earliest != null ? ` → next work ~${localHM(earliest)} local` : ''}`);
