#!/usr/bin/env node
// @does Private off-repo backup of the trading record; runs itself when due
// @ask "back up my data", "is the backup current?" => [--status]
/* backup-data.mjs — PRIVATE off-repo copy of the trading record. Zero-git, zero-network.
 *
 *   node pipeline/commands/backup-data.mjs [--dest <dir>] [--status]
 *
 * Destination: --dest, else $COFFER_BACKUP_DIR, else <home>/The-Ledger-backup (same disk). Layout:
 *   latest/            every data file, overwritten each run
 *   weekly/<Monday>/   the same small files, written once per week (survives a corrupted book)
 *   archive/           gzipped monthly suggestion files, rewritten only when the source changed
 * A root JSON file that does not parse is NOT copied, so a torn write never replaces a good copy.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from '../lib/render/cli.mjs';
import { BACKUP_STAMP, isLinkedWorktree } from '../lib/config/chores.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT_SKIP = new Set(['manifest.json', 'package.json', 'package-lock.json', 'heartbeat.json']);
const DATA_RE = /\.(json|jsonl|log)$/;

export function defaultDest(env = process.env, home = os.homedir()) {
  return env.COFFER_BACKUP_DIR || path.join(home, 'The-Ledger-backup');
}

function mondayKey(now) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function put(dest, buf) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, dest);
}

export function runBackup({ root = ROOT, dest, logDir = path.join(os.homedir(), '.runelite', 'exchange-logger'), now = new Date() }) {
  const small = [];
  for (const f of fs.readdirSync(root)) if (DATA_RE.test(f) && !ROOT_SKIP.has(f)) small.push([path.join(root, f), f]);
  const guide = path.join(root, 'pipeline', '.guide-history.jsonl');
  if (fs.existsSync(guide)) small.push([guide, 'guide-history.jsonl']);
  if (fs.existsSync(logDir)) for (const f of fs.readdirSync(logDir)) if (fs.statSync(path.join(logDir, f)).isFile()) small.push([path.join(logDir, f), path.join('exchange-logger', f)]);

  const weekly = path.join(dest, 'weekly', mondayKey(now));
  const firstThisWeek = !fs.existsSync(path.join(weekly, 'COMPLETE'));
  const skipped = [];
  let copied = 0;
  for (const [src, rel] of small) {
    const buf = fs.readFileSync(src);
    if (rel.endsWith('.json') && !rel.startsWith('exchange-logger')) {   // the logger's .json files are line-delimited
      try { JSON.parse(buf.toString('utf8')); } catch { skipped.push(rel); continue; } }
    put(path.join(dest, 'latest', rel), buf);
    if (firstThisWeek) put(path.join(weekly, rel), buf);
    copied++;
  }

  if (firstThisWeek && !skipped.length) put(path.join(weekly, 'COMPLETE'), Buffer.from(''));

  const arch = path.join(root, 'pipeline', 'suggestions-archive');
  let archived = 0;
  if (fs.existsSync(arch)) for (const f of fs.readdirSync(arch)) {
    if (!f.endsWith('.jsonl')) continue;
    const src = path.join(arch, f), out = path.join(dest, 'archive', f + '.gz');
    if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs) continue;
    put(out, zlib.gzipSync(fs.readFileSync(src)));
    archived++;
  }
  return { copied, archived, skipped, firstThisWeek };
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (isLinkedWorktree(ROOT)) { console.error('backup refused: this is a worktree, not the live checkout'); process.exit(1); }
  const dest = typeof a.dest === 'string' ? a.dest : defaultDest();
  if (a.status) {
    let s = null; try { s = fs.readFileSync(BACKUP_STAMP, 'utf8').trim(); } catch {}
    console.log(`backup: ${dest} · last success ${s ? new Date(Number(s)).toLocaleString() : 'never'}`);
    return;
  }
  if (!fs.existsSync(path.dirname(dest))) { console.error(`error: backup parent folder missing: ${path.dirname(dest)} — set COFFER_BACKUP_DIR`); process.exit(1); }
  const r = runBackup({ dest });
  if (r.skipped.length) { console.error(`error: not copied (unparseable): ${r.skipped.join(', ')}`); process.exit(1); }
  fs.mkdirSync(path.dirname(BACKUP_STAMP), { recursive: true });
  fs.writeFileSync(BACKUP_STAMP, String(Date.now()));
  console.log(`backup: ${r.copied} file(s)${r.archived ? `, ${r.archived} archive(s) gzipped` : ''}${r.firstThisWeek ? ', weekly snapshot' : ''} → ${dest}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
