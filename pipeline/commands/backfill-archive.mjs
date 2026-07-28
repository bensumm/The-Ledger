#!/usr/bin/env node
/* backfill-archive.mjs — the DELIBERATE hole-repair job for the Tier-1 SQLite market archive.
 *
 * WHY THIS EXISTS (audit 2026-07-27). Every ROUTINE path that writes /1h buckets is capped:
 *   • `loadAll24hRolling` (marketfetch.mjs) walks only the trailing 24 windows — anything older than
 *     a day is outside its reach forever.
 *   • `loadDaily` walks 17 days back but on a 6-HOURLY grid (`stepHours = 6`), so it stores 1 bucket
 *     in every 6 — which is exactly the 1-in-6 sawtooth the archive shows older than a day.
 *   • The `cache-warm` guard only keeps the LEADING EDGE current; it never looks backwards.
 * So a stretch with no scan leaves a hole that nothing subsequently repairs. At the time this was
 * written the archive held 428/1441 buckets (30%) over its span, with 50 holes older than 24h.
 *
 * THE HOLES ARE REPAIRABLE — the premise that they were not was measured and found false. Bulk
 * `/1h?timestamp=<w>` serves real, distinct whole-market buckets at least 365 DAYS back (probed at
 * 2025-07-28: id 560 hi=144, highPriceVolume=2.11m). Nothing was ever lost; it just was not requested.
 * This command is the request. Run it after an idle stretch, or once to repair accumulated history.
 *
 * ── ZERO-GIT by construction ──
 * READ + FETCH-INTO-THE-LOCAL-ARCHIVE only. It never imports the book sync, never touches git, and
 * writes nothing outside `pipeline/.market-archive.sqlite`. Safe to interrupt at any point: every
 * bucket is appended in its own transaction under an idempotent composite PK, so a re-run simply
 * skips what already landed (check-before-fetch) and resumes.
 *
 * ── COST, because this one is not free ──
 * One bulk request per MISSING bucket, spaced `--pace` ms apart (default 80). A 60-day 1h repair is
 * up to ~1440 requests ≈ 2-4 min wall time and ~3200 rows per bucket. `--limit` caps a single run so
 * the work can be split; `--dry-run` reports the holes and fetches nothing. Prefer `--dry-run` first.
 *
 * CLI:
 *   node pipeline/commands/backfill-archive.mjs                      # 30 days of /1h, repair
 *   node pipeline/commands/backfill-archive.mjs --days 60 --dry-run  # report holes only, no fetch
 *   node pipeline/commands/backfill-archive.mjs --days 60 --limit 300
 *   node pipeline/commands/backfill-archive.mjs --grain 5m --days 3  # 5m grain (288 buckets/day!)
 *
 * Node-only, no APP_VERSION bump.
 */
import { open as openArchive } from '../lib/market/archive.mjs';
import { API, jget, sleep } from '../lib/market/marketfetch.mjs';

const GRAIN_STEP = { '1h': 3600, '5m': 300 };   // bucket spacing per grain (mirrors archive.GRAINS)

function parseArgs(argv) {
  const a = { days: 30, grain: '1h', dryRun: false, limit: Infinity, pace: 80 };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--dry-run') a.dryRun = true;
    else if (t === '--days') a.days = Number(argv[++i]);
    else if (t === '--grain') a.grain = String(argv[++i]);
    else if (t === '--limit') a.limit = Number(argv[++i]);
    else if (t === '--pace') a.pace = Number(argv[++i]);
    else if (t === '--help' || t === '-h') a.help = true;
  }
  return a;
}

/* windowsFor(grain, days, now) → the descending list of bucket timestamps to CHECK: every grid slot
   from the last COMPLETE bucket back `days` days. Aligned to the same grid the wiki serves (floor to
   the step, minus one step) so a requested ts always maps to a real bucket, never a partial one. */
export function windowsFor(grain, days, now = Date.now()) {
  const step = GRAIN_STEP[grain];
  if (!step) throw new Error(`unknown grain '${grain}' (want ${Object.keys(GRAIN_STEP).join('/')})`);
  const anchor = Math.floor(now / 1000 / step) * step - step;   // last COMPLETE bucket
  const n = Math.max(1, Math.round((days * 86400) / step));
  const out = [];
  for (let i = 0; i < n; i++) out.push(anchor - i * step);
  return out;
}

/* holeRuns(missing) → contiguous runs over a DESCENDING missing list, as [{from, to, n}] ascending
   by time. Purely for a legible report — the repair itself walks bucket by bucket. */
export function holeRuns(missing, step) {
  const asc = [...missing].sort((x, y) => x - y);
  const runs = [];
  for (const ts of asc) {
    const last = runs[runs.length - 1];
    if (last && ts === last.to + step) { last.to = ts; last.n++; }
    else runs.push({ from: ts, to: ts, n: 1 });
  }
  return runs;
}

const iso = ts => new Date(ts * 1000).toISOString().replace('.000Z', 'Z');

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help) {
    console.log('usage: backfill-archive.mjs [--days N] [--grain 1h|5m] [--dry-run] [--limit N] [--pace ms]');
    return 0;
  }
  const step = GRAIN_STEP[a.grain];
  if (!step) { console.error(`unknown --grain '${a.grain}' (want 1h or 5m)`); return 1; }
  if (!Number.isFinite(a.days) || a.days <= 0) { console.error('--days must be a positive number'); return 1; }

  const windows = windowsFor(a.grain, a.days, Date.now());
  const db = openArchive();
  let filled = 0, empty = 0, failed = 0, skipped = 0;

  try {
    const missing = windows.filter(w => !db.hasBucket(a.grain, w));
    const runs = holeRuns(missing, step);

    console.log(`# archive backfill — /${a.grain}, last ${a.days}d (${windows.length} buckets checked)`);
    console.log(`present ${windows.length - missing.length}/${windows.length}  ·  MISSING ${missing.length}  ·  ${runs.length} hole(s)`);
    if (!missing.length) { console.log('\nnothing to repair — the archive is complete over this window.'); return 0; }

    console.log('');
    for (const r of runs) {
      const span = r.n === 1 ? iso(r.from) : `${iso(r.from)} → ${iso(r.to)}`;
      console.log(`  ${String(r.n).padStart(4)} ${a.grain}  ${span}`);
    }

    if (a.dryRun) {
      console.log(`\n--dry-run: fetched nothing. Repair with: node pipeline/commands/backfill-archive.mjs --days ${a.days}${a.grain === '1h' ? '' : ` --grain ${a.grain}`}`);
      return 0;
    }

    // Repair OLDEST-FIRST: the leading edge is what the cache-warm guard + any scan will refill on
    // their own, so spending a capped run on the old holes nothing else can reach is worth more.
    const todo = [...missing].sort((x, y) => x - y).slice(0, Number.isFinite(a.limit) ? a.limit : undefined);
    skipped = missing.length - todo.length;
    // ~1.9s/bucket MEASURED on the first full 60d repair (2026-07-27), not the pace alone: each bucket
    // is a ~3200-item payload plus a ~3200-row insert transaction, and that dominates `--pace` by ~20x.
    // Quoting pace-only here would under-promise by an order of magnitude on a long run.
    const est = Math.round((todo.length * (a.pace + 1800)) / 1000 / 60);
    console.log(`\nfetching ${todo.length} bucket(s) oldest-first at ${a.pace}ms pace (~${est} min at the measured ~1.9s/bucket)…`);

    let done = 0;
    for (const w of todo) {
      let resp = null;
      try { resp = await jget(`${API}/${a.grain}?timestamp=${w}`); }
      catch { resp = null; }
      await sleep(a.pace);

      if (!resp || !resp.data || !Object.keys(resp.data).length) {
        // Distinguish "the wiki genuinely has no data for this slot" from "the request failed" — the
        // first is a real historical gap we must stop re-requesting, the second is worth a re-run.
        if (resp && resp.data) empty++; else failed++;
      } else {
        // Trust the API-supplied bucket ts when present (archive invariant 3: store the real key).
        const bts = Number.isFinite(resp.timestamp) ? resp.timestamp : w;
        try { db.append(a.grain, bts, resp.data); filled++; }
        catch { failed++; }
      }

      if (++done % 25 === 0 || done === todo.length) {
        process.stdout.write(`\r  ${done}/${todo.length}  filled ${filled} · empty ${empty} · failed ${failed}   `);
      }
    }
    console.log('');

    const after = windows.filter(w => !db.hasBucket(a.grain, w)).length;
    console.log(`\ndone — filled ${filled}, wiki-empty ${empty}, failed ${failed}${skipped ? `, deferred ${skipped} (--limit)` : ''}`);
    console.log(`coverage now ${windows.length - after}/${windows.length} over the last ${a.days}d`);
    if (failed) console.log('re-run to retry the failed buckets (already-stored ones are skipped).');
    if (skipped) console.log(`re-run to continue the remaining ${skipped}.`);
    return 0;
  } finally {
    db.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('backfill-archive.mjs')) {
  main().then(c => process.exit(c || 0)).catch(e => { console.error('backfill-archive failed:', e?.message || e); process.exit(1); });
}
