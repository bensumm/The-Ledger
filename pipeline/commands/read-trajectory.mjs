#!/usr/bin/env node
/**
 * read-trajectory.mjs — one-word preset for the recency-weighted forward trajectory read
 * (PLAN-SIGNAL-RECENCY R1). A THIN wrapper that re-execs read-window-range.mjs with the
 * `--trajectory` flag preset, so the fetch/bucketing plumbing (loadMapping/fetchTs/windowStats)
 * lives in exactly ONE place — the anti-pattern this whole plan exists to stop is re-deriving
 * that per surface.
 *
 * Answers "how's <item> trending / where's it likely to be tomorrow": the per-day full-day
 * low/high table, the shared floor/ceiling slope-asymmetry classification (drift vs crash), and a
 * forward-projected next-day low/high band (the projectTrajectory primitive's new forward read).
 *
 * All flags are forwarded verbatim to read-window-range.mjs (so --nights / --json / --out work):
 *   node pipeline/commands/read-trajectory.mjs "<item or id>" [...more] [--nights 14] [--json]
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, 'read-window-range.mjs');
const args = process.argv.slice(2);
if (!args.length || args.every(a => a.startsWith('--'))) {
  console.error('usage: node pipeline/commands/read-trajectory.mjs "<item or id>" [...more] [--nights 14] [--json]');
  process.exit(1);
}
// --trajectory is appended AFTER the forwarded args (not prepended): read-window-range's positional
// walk treats the token after a bare --flag as that flag's value, so a leading --trajectory would
// swallow the item name. As a trailing bare flag it has no following token to consume.
const r = spawnSync(process.execPath, [target, ...args, '--trajectory'], { stdio: 'inherit' });
process.exit(r.status ?? 0);
