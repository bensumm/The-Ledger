#!/usr/bin/env node
/**
 * set-scan-analysis.mjs — attaches a short judgment blurb to the published repo-root screen.json,
 * rendered at the TOP of the app's Scan tab (js/ui.js `renderScan`, `#scanAnalysis`), separate from
 * the raw per-niche tables below it.
 *
 * Why a separate command rather than a screen-flip-niches.mjs flag: the analysis is the judgment
 * PASS OVER the scan's output (the /scan skill's §2), so it's naturally written AFTER the scan has
 * already run and been read — patching it in as a second, tiny, zero-refetch step keeps the two
 * concerns (the deterministic scan vs. the session's read of it) in their own places. This never
 * re-runs the scan or touches any gate/rank/grade — it only sets one field.
 *
 * The value is trusted HTML (js/ui.js sets `analysisEl.innerHTML` directly) — this command is
 * CLI-only, invoked deliberately by an agent/owner, never from an untrusted input path.
 *
 * Usage:
 *   node pipeline/commands/set-scan-analysis.mjs "<html>"   # set/replace the blurb
 *   node pipeline/commands/set-scan-analysis.mjs --clear    # remove it (hide the section again)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREEN_JSON = path.join(HERE, '..', '..', 'screen.json');

const arg = process.argv[2];
if (!arg) {
  console.error('usage: node pipeline/commands/set-scan-analysis.mjs "<html>"  |  --clear');
  process.exit(1);
}

let scan;
try { scan = JSON.parse(fs.readFileSync(SCREEN_JSON, 'utf8')); }
catch (e) { console.error('cannot read screen.json: ' + (e.message || e)); process.exit(1); }

if (arg === '--clear') { delete scan.analysis; }
else { scan.analysis = arg; }

fs.writeFileSync(SCREEN_JSON, JSON.stringify(scan, null, 2) + '\n');
console.log(arg === '--clear' ? 'screen.json: analysis cleared' : `screen.json: analysis set (${arg.length} chars)`);
