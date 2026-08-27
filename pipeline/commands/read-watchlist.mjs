#!/usr/bin/env node
// read-watchlist.mjs — the watchlist's OWN surface (SEP16b). Fetches context and emits; rows come
// from the ONE shared builder in lib/signal/watchlist-report.mjs.
//
// TWO KNOWN DIVERGENCES from the scan's watchlist pass, both deliberate: no `--archive-regime` seam
// (6h is always live) and no `--vol-source`/config resolution (always rolling). Full note: README.
//
// Usage: node pipeline/commands/read-watchlist.mjs
//          [--verbose] [--json] [--band-hours N]
//          [--floor N] [--gp-floor <gp>] [--min-gpd <gp>]

import { fileURLToPath } from 'node:url';
import { parseArgs, parseGp, writeLastReport } from '../lib/render/cli.mjs';
import { loadMapping, loadGuide, loadAllLatest, loadAll24hRolling, loadBands, fetchTsCached } from '../lib/market/marketfetch.mjs';
import { loadWatchlistEntries } from '../lib/config/watchlist.mjs';
import { buildWatchlistReport } from '../lib/signal/watchlist-report.mjs';
import { renderReport } from '../lib/render/render.mjs';

const A = parseArgs(process.argv.slice(2));
const AS_JSON = !!A.json;
const VERBOSE = !!A.verbose;
const BAND_HOURS = A['band-hours'] != null ? +A['band-hours'] : 2;
const FLOOR = A.floor != null ? +A.floor : 3500;
const GP_FLOOR = A['gp-floor'] != null ? parseGp(A['gp-floor']) : 4_500_000_000;
const MIN_GPD = A['min-gpd'] != null ? parseGp(A['min-gpd']) : 250_000;
const FETCH_CONCURRENCY = 5;
const TS_TTL_5M = 3 * 60 * 1000, TS_TTL_6H = 30 * 60 * 1000;

// The shared reader banners malformed entries on STDOUT by design; under --json that would corrupt
// the document, so divert to stderr for the read.
function loadEntries(map) {
  if (!AS_JSON) return loadWatchlistEntries({ map, tolerant: true });
  const real = process.stdout.write.bind(process.stdout);
  process.stdout.write = chunk => process.stderr.write(chunk);
  try { return loadWatchlistEntries({ map, tolerant: true }); }
  finally { process.stdout.write = real; }
}

async function main() {
  const map = await loadMapping();
  const entries = loadEntries(map);
  if (!entries.length) {
    // Absent/empty/garbled is a normal state, not an error. The dump is still written: a reader is
    // told to prefer it over stdout, so leaving the previous run's rows there would read as live.
    writeLastReport('watchlist', { sections: [{ type: 'headline', text: '## WATCHLIST — 0 item(s)' }] });
    if (AS_JSON) console.log(JSON.stringify({ kind: 'watchlist', tracked: 0, headers: [], rows: [] }));
    else console.log('no watchlist entries — add ids to watchlist.json to track items here');
    return;
  }

  const [latest, guide, v24, bands] = await Promise.all([
    loadAllLatest(), loadGuide(), loadAll24hRolling(), loadBands(BAND_HOURS),
  ]);

  const { headers, rows } = await buildWatchlistReport({
    entries, map, v24, bands, guide, latest,
    fetchSeries: id => Promise.all([fetchTsCached(id, '5m', TS_TTL_5M), fetchTsCached(id, '6h', TS_TTL_6H)]),
    concurrency: FETCH_CONCURRENCY,
    floor: FLOOR, gpFloor: GP_FLOOR, minGpd: MIN_GPD,
    volSrcLabel: 'rolling', posture: 'active',   // reaches suggestionEntry only, whose output this command drops
  });

  // Nothing is logged to suggestions.jsonl: an explicit read must not move the retro population.
  const report = {
    sections: [
      { type: 'headline', text: `## WATCHLIST — ${rows.length} item(s) (always shown; exempt from floors/gates; falling items shown with a warning)` },
      { type: 'table', headers, rows: rows.map(r => r.cells) },
    ],
  };
  // EVERY path, --json and the empty case included — no caller leaves a stale dump behind.
  const rel = writeLastReport('watchlist', report);

  if (AS_JSON) { console.log(JSON.stringify({ kind: 'watchlist', tracked: rows.length, headers, rows })); return; }
  if (VERBOSE) console.log(renderReport(report));
  else console.log(`# watchlist (quiet default; --verbose for the table) — ${rows.length} item(s) → ${rel}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(err => { console.error(err && err.stack || err); process.exit(1); });
}

export { main };
