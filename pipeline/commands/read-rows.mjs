#!/usr/bin/env node
// @does Prints rows from the last saved screen/quote/watch report, no fetch
// @ask "is X in the last scan?", "what grade was X?", "why isn't X in the scan?", "what got crowded out?" => [screen|quote|watch] --item "<item>" [--mode band] [--cols a,b] [--limit N] [--drops] [--digest] [--list]
// @read reads the saved report only, never the market: check the printed age and re-run the read when it says STALE
/* read-rows.mjs — usage: read-rows.mjs [report=screen] [--item <substr>]... [--mode band] [--cols a,b] [--limit N] [--drops] [--digest] [--list]
 * Reads pipeline/.cache/last-report/<report>.json (writeLastReport's dump). --dir overrides the folder (tests). Exit 1 on no match. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ageLine, tablesOf, rowLines, listLines, dropLines, digestLines } from '../lib/render/last-report-rows.mjs';

const argv = process.argv.slice(2), items = [], flags = new Set();
let report = 'screen', mode = null, cols = null, limit = null, dir = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--item') items.push(argv[++i]);
  else if (a === '--mode') mode = argv[++i];
  else if (a === '--cols') cols = String(argv[++i]).split(',').map(s => s.trim()).filter(Boolean);
  else if (a === '--limit') limit = Number(argv[++i]);
  else if (a === '--dir') dir = argv[++i];
  else if (a.startsWith('--')) flags.add(a.slice(2));
  else report = a;
}
if (limit != null && !(limit > 0)) { console.error('--limit takes a positive number'); process.exit(1); }
const HERE = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(dir || path.join(HERE, '..', '.cache', 'last-report'), report + '.json');
let payload;
try { payload = JSON.parse(fs.readFileSync(file, 'utf8')); }
catch { console.error(`no saved ${report} report (${file}) - run the read first`); process.exit(1); }

console.log(ageLine(report, payload.generatedAt));
const opts = { items, mode, cols, limit };
const res = flags.has('list') ? { lines: listLines(payload) }
  : flags.has('drops') ? { lines: dropLines(payload) }
  : flags.has('digest') ? digestLines(payload, opts)
  : rowLines(tablesOf(payload), opts);
if (res.error) { console.error(res.error); process.exit(1); }
console.log(res.lines.length ? res.lines.join('\n') : '(nothing to show)');
