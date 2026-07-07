#!/usr/bin/env node
/* cash.mjs — state / read the idle-cash balance the total-capital footer uses (watch.mjs).
 *
 *   node pipeline/cash.mjs 16m      set idle cash to 16,000,000 (accepts k/m/b + commas)
 *   node pipeline/cash.mjs          print the current stated cash + how long ago it was stated
 *   node pipeline/cash.mjs clear    forget it (footer reverts to committed-absolute only)
 *
 * The GE cash stack isn't in any log, so this is the ONE way total-capital sees idle GP. The figure
 * is a STATED snapshot: it ages the moment you trade, so watch.mjs staleness-banners it and it is
 * NEVER a verdict/alert input — purely the denominator for the idle-vs-working picture. */
import { parseGp, fmtP } from '../js/format.js';
import { readCash, writeCash, clearCash } from './lib/cashstate.mjs';

const arg = process.argv[2];

function ageStr(statedAt) {
  if (!statedAt) return '';
  const min = Math.round((Date.now() - new Date(statedAt).getTime()) / 60000);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  return `${h}h${min % 60 ? ' ' + (min % 60) + 'm' : ''} ago`;
}

if (arg == null) {
  const cur = readCash();
  if (!cur) { console.log('no idle-cash balance stated — set one with:  node pipeline/cash.mjs <amount>  (e.g. 16m)'); process.exit(0); }
  console.log(`idle cash ${fmtP(cur.cashGp)} · stated ${ageStr(cur.statedAt)}`);
  process.exit(0);
}

if (arg.toLowerCase() === 'clear') {
  console.log(clearCash() ? 'idle-cash balance cleared.' : 'no idle-cash balance to clear.');
  process.exit(0);
}

const gp = parseGp(arg);
if (!Number.isFinite(gp) || gp < 0) {
  console.error(`could not parse "${arg}" as a gp amount (try 16m, 500k, 2.5b, or a plain number).`);
  process.exit(1);
}
const rec = writeCash(gp);
console.log(`idle cash set to ${fmtP(rec.cashGp)} · stated just now. watch.mjs will show it in the SUMMARY total-capital line.`);
