#!/usr/bin/env node
/* reconcile-reverse-flip.mjs — RF3 (PLAN-REVERSE-FLIP): the BANKED-backfill reconciliation ADVISORY.
 *
 * The Case-B artifact it reconciles. A reverse-flip on a PRE-LOG owned item (the Ancestral-hat shape:
 * no BUY was ever logged) that gets SOLD-FIRST lands the sell in `positions.json.unmatched` — the
 * reconstruction being honest that it doesn't know the cost basis (Q2). That's SAFE by design (unmatched
 * sells are excluded from every profit sum), just cosmetically incomplete: the realised gain never shows
 * as a `closed` row. The fix-at-the-source doctrine (CLAUDE.md) is to inject a `BANKED` lot at the item's
 * acquisition basis BEFORE the sell in time-order, so the next sync FIFO-matches it into a real `closed`
 * row — the exact same mechanism Ben already uses for boss drops entering the flip flow, NOT a new
 * reconstruction branch (reconstruct.mjs is untouched — Q2's whole point).
 *
 * This script is READ-ONLY and ADVISORY. It touches NO file (no writes to fills/positions/owned/state,
 * no --publish). It reads the declared cycles (reverse-flip-state.json) + owned registry (owned-items.json)
 * + positions.json's `unmatched[]`, and when a DECLARED reverse-flip item has a matching `unmatched` sell
 * it PRINTS — never runs — the exact `add-manual-fill.mjs --type banked …` command to backfill the basis.
 * Ben runs the printed command himself (or doesn't — the gap it leaves is cosmetic, per Q2). It NEVER
 * emits a suggestion for an item with no declaration or no matching unmatched sell.
 *
 * Usage:
 *   node pipeline/commands/reconcile-reverse-flip.mjs                 # every declared reverse-flip item
 *   node pipeline/commands/reconcile-reverse-flip.mjs "Ancestral hat" # one item (name or id)
 *   node pipeline/commands/reconcile-reverse-flip.mjs 21018
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadReverseFlip } from '../lib/thesis/reverseflipstate.mjs';
import { loadOwned, ownedFor } from '../lib/capital/ownedledger.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// TRACKED repo-root stores. The COFFER_*_PATH env overrides exist ONLY so the acceptance test can point
// at TEMP fixtures (never the real root files); production runs leave them unset.
const RF_PATH        = process.env.COFFER_REVERSE_FLIP_PATH || path.join(HERE, '..', '..', 'reverse-flip-state.json');
const OWNED_PATH     = process.env.COFFER_OWNED_PATH        || path.join(HERE, '..', '..', 'owned-items.json');
const POSITIONS_PATH = process.env.COFFER_POSITIONS_PATH    || path.join(HERE, '..', '..', 'positions.json');

/* loadUnmatched — pull just the `unmatched[]` array off positions.json. Degrades to [] on any failure
   (missing / corrupt / wrong shape) so a bad file can never break this read. */
function loadUnmatched(p) {
  try { const o = JSON.parse(fs.readFileSync(p, 'utf8')); return Array.isArray(o?.unmatched) ? o.unmatched : []; }
  catch { return []; }
}

/* bankedCommand — the exact `add-manual-fill.mjs --type banked …` string to backfill one unmatched sell.
   Flag names verified against add-manual-fill.mjs: --item <name> | --id <n>, --type banked, --qty <n>
   (required, positive), --price <gp each>, --time <iso>.

   TIMESTAMP DISCIPLINE (Gaps §5). --time MUST be the ACQUISITION time (pre-sale) = owned-items.json's
   `seedTs` for this item — NOT positions.json.unmatched's `sellTs` (that is the SALE time). FIFO matching
   is timestamp-ordered, so the BANKED lot must timestamp BEFORE the sell it will match; the sale time
   would place the lot AFTER the sell and it would never pair. seedTs is the only acquisition-time source
   on disk (the unmatched row carries only sellTs). Formatted via toISOString() which is TZ-HERMETIC — it
   always renders UTC regardless of the host timezone, so this string is byte-identical on Ben's box and
   in UTC CI.

   PRICE = the acquisition cost BASIS each (owned-items.json `seedBasis`), NOT the sell price — a BANKED
   lot's basis is what the item was acquired for; the sell price is what it left at. */
function bankedCommand({ name, qty, basis, seedTs }) {
  const iso = new Date(seedTs * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return `node pipeline/commands/add-manual-fill.mjs --item "${name}" --type banked --qty ${qty} --price ${basis} --time "${iso}"`;
}

/* parse an optional item filter token: numeric → id; else a case-insensitive name match. */
function parseFilter(token) {
  if (token == null) return null;
  if (/^\d+$/.test(token)) return { id: +token };
  return { name: String(token).toLowerCase() };
}

function main() {
  const arg = process.argv.slice(2).find(a => !a.startsWith('-'));
  const filter = parseFilter(arg);

  const declared  = loadReverseFlip(RF_PATH);   // no prune: reconcile every declared intent regardless of age
  const owned     = loadOwned(OWNED_PATH);
  const unmatched = loadUnmatched(POSITIONS_PATH);

  const entries = declared.filter(e => {
    if (!e || e.id == null) return false;
    if (!filter) return true;
    if (filter.id != null) return e.id === filter.id;
    return String(e.name || '').toLowerCase() === filter.name;
  });

  const suggestions = [];   // { name, id, qty, sellEach, cmd }
  const blocked = [];       // declared + unmatched match, but owned seed (basis/seedTs) is undeclared

  for (const e of entries) {
    const sells = unmatched.filter(u => u && u.itemId === e.id);
    if (!sells.length) continue;   // declared but no Case-B artifact — nothing to reconcile for this item

    const own = ownedFor(owned, e.id);
    const basis = own?.seedBasis ?? own?.basis;   // acquisition cost each (owned-items seed basis)
    const seedTs = own?.seedTs;                   // acquisition time (pre-sale) — see bankedCommand

    for (const u of sells) {
      if (basis == null || seedTs == null) { blocked.push({ e, u, hasOwn: !!own }); continue; }
      const name = e.name || own?.name || ('#' + e.id);
      suggestions.push({
        name, id: e.id, qty: u.qty, sellEach: u.sellEach,
        cmd: bankedCommand({ name, qty: u.qty, basis, seedTs }),
      });
    }
  }

  if (!suggestions.length && !blocked.length) { console.log('nothing to reconcile'); return; }

  if (suggestions.length) {
    console.log(`Reverse-flip reconciliation — ${suggestions.length} Case-B sell(s) to backfill a BANKED basis for:\n`);
    for (const s of suggestions) {
      console.log(`# ${s.name} (${s.id}): unmatched sell ${s.qty}×@${s.sellEach} — inject the acquisition basis BEFORE it:`);
      console.log(s.cmd + '\n');
    }
    console.log('READ-ONLY: this prints the command; run it yourself, then sync. --time is the ACQUISITION/seed time, not the sale time.');
  }

  for (const b of blocked) {
    const lead = suggestions.length ? '\n' : '';
    console.log(`${lead}⚠ ${b.e.name || ('#' + b.e.id)} (${b.e.id}): matching unmatched sell found, but ${b.hasOwn ? 'the owned-items seed has no basis (seedBasis)' : 'no owned-items seed exists'} — declare the acquisition basis + seedTs first (declare-owned seed), then re-run.`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
