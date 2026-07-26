#!/usr/bin/env node
/* read-daemons.mjs — the fleet STATUS surface (PLAN-DAEMON-SUBSYSTEM Phase-2 Chunk 8).
 *
 * Prints manager.status()'s one-row-per-daemon health table: residents up/down, guards
 * last-ran/stale, plus each entry's kind / auto-run / git-safety. READ-ONLY — it calls status()
 * (never ensure()), so it starts NOTHING (safe to run any time). Answers the plan's founding
 * question: "how many background things do we have, what do they do, are they up?"
 *
 * NOTE: status() calls each entry's healthCheck() live — so this DOES probe (a localhost fetch for
 * dev-server, an archive read for cache-warm, a stat for sync-fills/watch-log). That is the point of
 * a status read; none of them write or start anything.
 *
 * Usage: node pipeline/commands/read-daemons.mjs [--json]
 * Node-only, pipeline stdout — no APP_VERSION bump.
 */
import { status } from '../daemons/manager.mjs';

function fmtAge(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '—';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
const mark = ok => (ok === true ? '✓ up' : ok === false ? '✗ down' : '· n/a');

const rows = await status();

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  console.log('# Daemon fleet — status (read-only; nothing started)\n');
  const head = ['Daemon', 'Kind', 'Git', 'Auto', 'Health', 'Last ran', 'Detail'];
  const table = rows.map(r => [
    r.name, r.kind,
    r.local ? 'zero-git' : 'git-writer',
    r.autoRun ? 'auto' : 'manual',
    mark(r.ok), fmtAge(r.lastRan), r.detail || '',
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...table.map(t => String(t[i]).length)));
  const line = cols => cols.map((c, i) => String(c).padEnd(widths[i])).join('  ');
  console.log(line(head));
  for (const t of table) console.log(line(t));
  console.log('\n(read-only status — run nothing here; cache-warm is the only auto-run guard. ' +
    'GIT_WRITER sync-fills --publish is attended/on-demand, never listed as auto.)');
}
