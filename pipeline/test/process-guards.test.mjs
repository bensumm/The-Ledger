/* process-guards.test.mjs — the self-checking chores, the private backup, size/expiry budgets, and the
 * archive query plan. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dueChores, runChores } from '../lib/config/chores.mjs';
import { runBackup, defaultDest } from '../commands/backup-data.mjs';
import { checkDocs, checkProvisional, docBytes } from '../ci/lint-budget.mjs';
import { open as openArchive } from '../lib/market/archive.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };
const H = 3600e3, D = 24 * H;

ok('chores: fresh state does nothing', () => {
  assert.deepEqual(dueChores({ backupAge: H, attemptAge: H, outcomesAge: D, noticeAge: H }), { runBackup: false, notices: [] });
});
ok('chores: never backed up runs; a recent failed attempt is not retried at once', () => {
  assert.equal(dueChores({ backupAge: null, attemptAge: null, outcomesAge: D, noticeAge: H }).runBackup, true);
  assert.equal(dueChores({ backupAge: null, attemptAge: H / 2, outcomesAge: D, noticeAge: H }).runBackup, false);
});
ok('chores: stale outcomes and a failing backup announce, throttled', () => {
  const r = dueChores({ backupAge: 4 * D, attemptAge: 2 * H, outcomesAge: 63 * D, noticeAge: null });
  assert.equal(r.notices.length, 2);
  assert.match(r.notices[1], /63d old/);
  assert.deepEqual(dueChores({ backupAge: 4 * D, attemptAge: 2 * H, outcomesAge: 63 * D, noticeAge: H }).notices, []);
});
ok('chores: a backup that has NEVER succeeded is announced, not silent', () => {
  assert.equal(dueChores({ backupAge: null, attemptAge: 1000, outcomesAge: D, noticeAge: null }).notices.length, 0, 'a first run in flight is not a failure');
  assert.match(dueChores({ backupAge: null, attemptAge: 2 * H, outcomesAge: D, noticeAge: null }).notices[0], /never succeeded/);
});
ok('chores: inert under CI', () => { assert.equal(runChores({ env: { CI: '1' } }), undefined); });

ok('backup: copies data, gzips archives once, refuses a torn JSON over a good copy', () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
  const root = path.join(t, 'root'), dest = path.join(t, 'dest'), logDir = path.join(t, 'logs');
  fs.mkdirSync(path.join(root, 'pipeline', 'suggestions-archive'), { recursive: true }); fs.mkdirSync(logDir);
  fs.writeFileSync(path.join(root, 'fills.json'), '{"a":1}');
  fs.writeFileSync(path.join(root, 'manifest.json'), '{}');
  fs.writeFileSync(path.join(logDir, 'x.log'), 'row');
  fs.writeFileSync(path.join(root, 'pipeline', 'suggestions-archive', 's.jsonl'), 'hello');
  const one = runBackup({ root, dest, logDir });
  assert.deepEqual([one.copied, one.archived, one.firstThisWeek], [2, 1, true]);
  assert.equal(zlib.gunzipSync(fs.readFileSync(path.join(dest, 'archive', 's.jsonl.gz'))).toString(), 'hello');
  fs.writeFileSync(path.join(root, 'fills.json'), '{"a":');
  const two = runBackup({ root, dest, logDir });
  assert.deepEqual([two.archived, two.skipped], [0, ['fills.json']]);
  assert.equal(fs.readFileSync(path.join(dest, 'latest', 'fills.json'), 'utf8'), '{"a":1}', 'the good copy survives');
  assert.equal(two.firstThisWeek, false, 'a complete weekly snapshot is not rewritten');
  const d2 = path.join(t, 'd2');
  runBackup({ root, dest: d2, logDir });
  assert.equal(runBackup({ root, dest: d2, logDir }).firstThisWeek, true, 'an incomplete weekly snapshot is retried');
  assert.ok(!fs.existsSync(path.join(dest, 'latest', 'manifest.json')));
  fs.rmSync(t, { recursive: true, force: true });
});
ok('backup: destination env override', () => { assert.equal(defaultDest({ COFFER_BACKUP_DIR: '/x' }, '/h'), '/x'); });

ok('doc budget: over-ceiling fails, CRLF does not count', () => {
  assert.equal(docBytes('a\r\nb'), docBytes('a\nb'));
  assert.equal(checkDocs({ docs: { a: 10 }, plans: 1 }, () => 10, 1).length, 0);
  assert.equal(checkDocs({ docs: { a: 10 }, plans: 1 }, () => 11, 2).length, 2);
});
ok('provisional: expired, over-long, unregistered and orphaned all fail', () => {
  const now = Date.parse('2026-01-10T00:00:00Z');
  const e = o => ({ id: 'x', decideBy: '2026-01-20', passTest: 'p', files: ['f'], ...o });
  const run = (entry, marked = ['f'], exists = () => true) => checkProvisional([entry], marked, exists, now);
  assert.equal(run(e()).length, 0);
  assert.match(run(e({ decideBy: '2026-01-09' }))[0], /EXPIRED/);
  assert.match(run(e({ decideBy: '2027-01-09' }))[0], /more than/);
  assert.match(run(e(), ['f', 'g'])[0], /no provisional\.json entry/);
  assert.match(run(e(), ['f'], () => false)[0], /no longer exists/);
});

ok('archive: the per-item read uses the item index, never a whole-grain scan', () => {
  const a = openArchive(':memory:');
  let sql = null;
  const real = a.db.prepare.bind(a.db);
  a.db.prepare = s => { sql = s; return real(s); };
  a.seriesFor(1, '5m');
  const plan = real('EXPLAIN QUERY PLAN ' + sql).all('5m', 1, 0, 1).map(r => r.detail).join(' ');
  assert.match(plan, /obs_item \(grain=\? AND itemId=\?/);
  a.db.close();
});

ok('analyze-record output stays small enough to read', () => {
  const cmd = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'commands', 'analyze-record.mjs');
  for (const [args, cap] of [[[], 40_000], [['--json'], 80_000]]) {
    const n = execFileSync(process.execPath, [cmd, ...args], { maxBuffer: 64e6 }).length;
    assert.ok(n < cap, `${args.join(' ') || 'default'} printed ${n} bytes, cap ${cap}`);
  }
});


ok('the read-time sync calls the chores, after the book is written', () => {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'reconstruct', 'sync-invoke.mjs'), 'utf8');
  assert.ok(src.lastIndexOf('runChores()') > src.lastIndexOf('execFileSync('), 'hook missing or before the sync');
});

console.log(`All ${pass} checks passed.`);
