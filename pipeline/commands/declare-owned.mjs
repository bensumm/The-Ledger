#!/usr/bin/env node
/* declare-owned.mjs — RF0 CLI to maintain the owned-item registry (owned-items.json, PLAN-REVERSE-FLIP).
   The SOLE agent-writer of the TRACKED repo-root owned-items.json; RF1/RF2's screen and the surfacing
   skills are READ-ONLY consumers. Ben states ownership intent in conversation, the agent writes here —
   the same "Ben declares, the agent writes a small tracked JSON store" pattern as declare-thesis.mjs.
   NO PII (item ids/names only; repo is public).

   Subcommands:
     seed "<item|id>" [--qty N]                     — register a pre-log-owned item (source:'seed'),
                                                       classification defaults to 'keep'
     classify "<item|id>" flip|keep|consumable      — set/move classification (from pending or in place)
     list                                           — show the registry + live computed qty (computeOwnedQty)

   No per-item eligibility flag (Ruling 8): classification:'keep' IS the reverse-flip candidate pool;
   RF1's oscillator filter + Ben's per-run table selection pick the actual candidates from the kept set.

   qty is NEVER hand-typed as a running field — `list` recomputes each item's live owned balance off
   fills.json via ownedledger.computeOwnedQty (the seed only pins the pre-log baseline). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadMapping } from '../lib/market/marketfetch.mjs';
import {
  loadOwned, saveOwned, ownedFor, upsertOwnedItem, removePending, computeOwnedQty,
} from '../lib/ownedledger.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// TRACKED repo-root stores. COFFER_OWNED_PATH / COFFER_FILLS_PATH env overrides exist ONLY so the
// round-trip test can point at a TEMP store (it must never touch the real root files) — production
// runs leave them unset and hit the repo root.
const OWNED_PATH = process.env.COFFER_OWNED_PATH || path.join(HERE, '..', '..', 'owned-items.json');
const FILLS_PATH = process.env.COFFER_FILLS_PATH || path.join(HERE, '..', '..', 'fills.json');

const CLASSES = ['flip', 'keep', 'consumable'];

function usage() {
  console.log('Usage:\n' +
    '  node pipeline/commands/declare-owned.mjs seed "<item|id>" [--qty N]\n' +
    '  node pipeline/commands/declare-owned.mjs classify "<item|id>" flip|keep|consumable\n' +
    '  node pipeline/commands/declare-owned.mjs list');
}

async function resolveId(token) {
  if (/^\d+$/.test(token)) return { id: +token, name: '#' + token };
  const map = await loadMapping();
  const r = map.resolve(token);
  if (!r) { console.error(`! unknown item "${token}"`); process.exit(1); }
  return r;
}

function loadFillsEvents() {
  try { const o = JSON.parse(fs.readFileSync(FILLS_PATH, 'utf8')); return Array.isArray(o?.events) ? o.events : []; }
  catch { return []; }
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === 'help' || cmd === '--help') { usage(); return; }

  if (cmd === 'list') {
    const store = loadOwned(OWNED_PATH);
    if (!store.items.length && !(store.pendingClassification || []).length) { console.log('(no owned items registered)'); return; }
    const events = loadFillsEvents();
    for (const it of store.items) {
      const qty = computeOwnedQty(it, events);
      console.log(`- ${it.name} (${it.id}): ${it.classification} · qty ${qty} (seed ${it.seedQty}) [${it.source}]`);
    }
    for (const p of (store.pendingClassification || [])) {
      console.log(`  pending: ${p.name || ('#' + p.id)} ×${p.qty} @ ${p.buyEach} — flip / keep / consumable?`);
    }
    return;
  }

  // split positionals from flags
  const flags = {}, pos = [];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--qty') flags.qty = argv[++i];
    else pos.push(a);
  }

  if (cmd === 'seed') {
    if (!pos.length) { usage(); process.exit(1); }
    const { id, name } = await resolveId(pos[0]);
    const seedQty = flags.qty != null && Number.isFinite(+flags.qty) ? Math.round(+flags.qty) : 1;
    const store = loadOwned(OWNED_PATH);
    const prev = ownedFor(store, id);
    const next = removePending(upsertOwnedItem(store, {
      id, name, seedQty, seedTs: Math.floor(Date.now() / 1000),
      classification: prev?.classification ?? 'keep', source: 'seed',
    }), id);
    saveOwned(OWNED_PATH, next);
    console.log(`seeded ${name} (${id}): qty ${seedQty}, classification ${prev?.classification ?? 'keep'} (owned-items.json)`);
    return;
  }

  if (cmd === 'classify') {
    if (pos.length < 2) { usage(); process.exit(1); }
    const { id, name } = await resolveId(pos[0]);
    const cls = String(pos[1]).toLowerCase();
    if (!CLASSES.includes(cls)) { console.error(`! classification must be one of ${CLASSES.join(' | ')}`); process.exit(1); }
    const store = loadOwned(OWNED_PATH);
    const prev = ownedFor(store, id);
    const pending = (store.pendingClassification || []).find(p => p && p.id === id);
    // seedQty comes from the fold (a captured buy's qty) or an existing entry — never re-typed.
    const seedQty = prev?.seedQty ?? pending?.qty ?? 1;
    const next = removePending(upsertOwnedItem(store, {
      id, name, seedQty, seedTs: prev?.seedTs ?? Math.floor(Date.now() / 1000),
      classification: cls, source: prev?.source ?? (pending ? 'capture' : 'seed'),
    }), id);
    saveOwned(OWNED_PATH, next);
    console.log(`classified ${name} (${id}): ${cls}${pending ? ' (moved from pending)' : ''} (owned-items.json)`);
    return;
  }

  usage(); process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
