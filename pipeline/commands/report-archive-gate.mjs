#!/usr/bin/env node
/**
 * report-archive-gate.mjs — AF5 (PLAN-ARCHIVE-FIRST-FUNNEL): does the LOCAL archive reproduce the
 * gate verdicts we currently pay a per-item `/timeseries` call for?
 *
 * READ-ONLY EVIDENCE, NOT A BEHAVIOUR CHANGE. This changes nothing about the scan. It runs
 * `reachValidator` TWICE per item — once on the live 1h series the scan fetches today, once on the
 * same window read out of `pipeline/.market-archive.sqlite` — and reports how often the two agree.
 * A promotion decision (AF6) needs this number first; shipping the swap on the strength of AF4's
 * shape-match alone would be assuming the answer.
 *
 * WHY reachValidator SPECIFICALLY. Of the three per-item series the survivor pool fetches (5m/6h/1h),
 * `floorValidator` already reads the archive (`loadDaily`, no fetch) and the 6h consumers are AF5b's
 * problem. The 1h "Leg B" series exists solely to score reach — so it is the one live fetch AF5 can
 * retire, and `reachValidator(ctx)` is a PURE function of `ctx.intraday.ts1h`, which makes an exact
 * shadow possible.
 *
 * METHODOLOGY — the comparison is deliberately apples-to-apples on everything except the series:
 *   - the SAME candidate level and side feed both runs. The level is the item's live instabuy, chosen
 *     because it is stable and external to both series; letting each side pick its own level would
 *     measure level-choice divergence rather than series divergence, and would flatter whichever
 *     source produced the level.
 *   - the SAME `now` feeds both, so the wall-clock window (`wStart`/`wEnd`) is identical.
 *   - the archive read is trimmed to the live series' own time span, so the archive's extra depth
 *     (~718 pts vs the live endpoint's 365-point cap) cannot by itself change the verdict. Depth is a
 *     real advantage, but it is NOT what this run is testing.
 *
 * Usage:
 *   node pipeline/commands/report-archive-gate.mjs                 # the watchlist
 *   node pipeline/commands/report-archive-gate.mjs 27232 561 …     # explicit ids
 *   node pipeline/commands/report-archive-gate.mjs --limit 25
 */
import { open } from '../lib/market/archive.mjs';
import { archiveSeries } from '../lib/market/archive-series.mjs';
import { fetchTs, fetchLatest, loadMapping, sleep } from '../lib/market/marketfetch.mjs';
import { reachValidator } from '../../js/validate.mjs';
import { loadWatchlistEntries } from '../lib/config/watchlist.mjs';
import { REPO_DIR } from '../lib/paths.mjs';

const argv = process.argv.slice(2);
const limitAt = argv.indexOf('--limit');
const LIMIT = limitAt >= 0 ? +argv[limitAt + 1] : 40;
// skip the VALUE that follows --limit, else `--limit 25` is read as "scan item #25" (it was).
const ids = argv.filter((a, i) => /^\d+$/.test(a) && i !== limitAt + 1).map(Number);

const run = (series, level, now) =>
  reachValidator({ intraday: { ts1h: series, reach: { side: 'ask', level, now } } });

(async () => {
  const map = await loadMapping();
  let targets = ids;
  if (!targets.length) {
    targets = loadWatchlistEntries({ map, root: REPO_DIR, tolerant: true }).map(e => e.id);   // REPO_DIR (the clone root, not this worktree) is this command's pre-existing choice, preserved
  }
  targets = targets.slice(0, LIMIT);
  if (!targets.length) { console.log('no targets resolved — pass ids explicitly'); return; }

  const h = open(undefined, { readonly: true });
  const now = new Date();
  let agree = 0, differ = 0, skipped = 0;
  const rows = [];

  for (const id of targets) {
    const name = map.byId?.[id]?.name || ('#' + id);
    const live = await fetchTs(id, '1h'); await sleep(40);
    const lt = await fetchLatest(id); await sleep(40);
    const level = lt && (lt.high ?? lt.avgHighPrice);
    if (!live.length || !level) { skipped++; continue; }

    // trim the archive read to the live series' own span — depth is not what we're testing here.
    const from = live[0].timestamp, to = live[live.length - 1].timestamp;
    const arch = archiveSeries(h, id, '1h', { from, to });
    if (!arch.length) { skipped++; continue; }

    const L = run(live, level, now), A = run(arch, level, now);
    const same = L.status === A.status
      && (L.evidence?.hit ?? null) === (A.evidence?.hit ?? null)
      && (L.evidence?.days ?? null) === (A.evidence?.days ?? null);
    same ? agree++ : differ++;
    rows.push({ name, live: L, arch: A, same, nLive: live.length, nArch: arch.length });
  }
  h.close();

  console.log(`\nAF5 — reachValidator: LIVE 1h vs ARCHIVE 1h (same level, same now, same span)\n`);
  console.log('item                            live verdict          archive verdict       ');
  console.log('-'.repeat(84));
  for (const r of rows) {
    const f = v => `${v.status}${v.evidence ? ` ${v.evidence.hit}/${v.evidence.days}` : ''}`;
    console.log(`${r.same ? ' ' : '≠'} ${r.name.slice(0, 28).padEnd(29)} ${f(r.live).padEnd(21)} ${f(r.arch).padEnd(21)} ${r.nLive}/${r.nArch} pts`);
  }
  console.log('-'.repeat(84));
  const n = agree + differ;
  console.log(`agreement ${agree}/${n} (${n ? ((agree / n) * 100).toFixed(1) : '—'}%) · ${skipped} skipped (no live series / no archive / no live price)`);
  if (differ) console.log(`⚠ ${differ} disagreement(s) — inspect before AF6 promotes anything.`);
  console.log('(READ-ONLY. n is small and one-shot; this is a go/no-go signal, not a calibration.)');
})();
