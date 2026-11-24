/* chores.mjs — recurring upkeep the tool tracks itself, so no agent has to remember it from prose.
 * The backup is cheap and zero-git, so it is RUN (detached) when due. The outcomes rebuild is slow and
 * networked, so it is only ANNOUNCED. Announcements go to stderr: callers stub console.log. */
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PIPELINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(PIPELINE, '.cache');
export const BACKUP_STAMP = join(CACHE, 'last-backup');
const ATTEMPT_STAMP = join(CACHE, 'last-backup-attempt');
const ANNOUNCE_STAMP = join(CACHE, 'last-chore-notice');
const OUTCOMES = join(PIPELINE, '..', 'outcomes.json');

const HOUR = 3600e3;
const BACKUP_EVERY = 20 * HOUR;
const BACKUP_RETRY = 1 * HOUR;
const BACKUP_OVERDUE = 72 * HOUR;
const OUTCOMES_STALE = 7 * 24 * HOUR;
const ANNOUNCE_EVERY = 6 * HOUR;

/* PURE. Ages in ms, null = never. → { runBackup, notices[] } */
export function dueChores({ backupAge, attemptAge, outcomesAge, noticeAge }) {
  const over = (age, lim) => age == null || age > lim;
  const notices = [];
  if (over(noticeAge, ANNOUNCE_EVERY)) {
    const days = ms => Math.floor(ms / (24 * HOUR));
    if (backupAge == null ? attemptAge > BACKUP_RETRY : backupAge > BACKUP_OVERDUE) notices.push(`private backup ${backupAge == null ? 'has never succeeded' : `last succeeded ${days(backupAge)}d ago`} — run: node pipeline/commands/backup-data.mjs`);
    if (over(outcomesAge, OUTCOMES_STALE)) notices.push(`outcomes.json is ${outcomesAge == null ? 'missing' : days(outcomesAge) + 'd old'} — run when idle: node pipeline/commands/join-outcomes.mjs`);
  }
  return { runBackup: over(backupAge, BACKUP_EVERY) && over(attemptAge, BACKUP_RETRY), notices };
}

const mtimeAge = (f, now) => { try { return now - fs.statSync(f).mtimeMs; } catch { return null; } };
const stamp = f => { fs.mkdirSync(dirname(f), { recursive: true }); fs.writeFileSync(f, String(Date.now())); };

/* Never throws and never blocks the read. Skipped under CI and test runs. */
export function runChores({ now = Date.now(), env = process.env } = {}) {
  if (env.CI || env.COFFER_NO_CHORES) return;
  try {
    const r = dueChores({ backupAge: mtimeAge(BACKUP_STAMP, now), attemptAge: mtimeAge(ATTEMPT_STAMP, now), outcomesAge: mtimeAge(OUTCOMES, now), noticeAge: mtimeAge(ANNOUNCE_STAMP, now) });
    if (r.runBackup) {
      stamp(ATTEMPT_STAMP);
      const p = spawn(process.execPath, [join(PIPELINE, 'commands', 'backup-data.mjs')], { detached: true, stdio: 'ignore', windowsHide: true });
      p.on('error', () => {});
      p.unref();
    }
    if (r.notices.length) { stamp(ANNOUNCE_STAMP); for (const n of r.notices) console.error('chore · ⚠ ' + n); }
  } catch { /* upkeep must never cost a market read */ }
}
