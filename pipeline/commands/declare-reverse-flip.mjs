#!/usr/bin/env node
/* declare-reverse-flip.mjs — RF0 CLI to record / advance / clear / list a declared reverse-flip CYCLE
   (reverse-flip-state.json, PLAN-REVERSE-FLIP). The SOLE agent-writer of the TRACKED repo-root store;
   /schedule, /book, /positions (RF4) are READ-ONLY consumers that keep the in-flight cycle visible
   between the sell and the rebuy. Mirrors declare-thesis.mjs's resolve-token → upsert → save shape.
   The agent declares/advances when Ben reports what happened — never a script inferring intent from
   raw fills. NO PII (item ids/prices/timestamps only; repo is public).

   Subcommands:
     set "<item|id>" --state awaiting-rebuy --sold-each <gp> --qty N [--sold-ts <iso>]
                                    — record the sell leg; beRebuy = soldEach − tax(soldEach) (canonical
                                      js/money-math.js tax(), the one-home E8 rule, NOT a flat ×0.98)
     advance "<item|id>" --state rebuy-armed --bid <gp>
                                    — a rebuy bid is now resting; stamps rebuyBidPrice + rebuyBidTs
     clear "<item|id>"              — the cycle is done / abandoned
     list                           — show the declared cycles */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadMapping } from '../lib/marketfetch.mjs';
import { parseGp } from '../lib/cli.mjs';
import { tax } from '../../js/money-math.js';   // the ONE tax impl — beRebuy = soldEach − tax(soldEach)
import {
  loadReverseFlip, saveReverseFlip, reverseFlipFor, upsertReverseFlip, clearReverseFlip, pruneReverseFlip,
  REVERSE_FLIP_STATES,
} from '../lib/reverseflipstate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// TRACKED repo-root store. COFFER_REVERSE_FLIP_PATH env override exists ONLY so the round-trip test
// can point at a TEMP store (never the real root file); production runs leave it unset.
const STATE_PATH = process.env.COFFER_REVERSE_FLIP_PATH || path.join(HERE, '..', '..', 'reverse-flip-state.json');

function usage() {
  console.log('Usage:\n' +
    '  node pipeline/commands/declare-reverse-flip.mjs set "<item|id>" --state awaiting-rebuy --sold-each <gp> --qty N [--sold-ts <iso>]\n' +
    '  node pipeline/commands/declare-reverse-flip.mjs advance "<item|id>" --state rebuy-armed --bid <gp>\n' +
    '  node pipeline/commands/declare-reverse-flip.mjs clear "<item|id>"\n' +
    '  node pipeline/commands/declare-reverse-flip.mjs list');
}

async function resolveId(token) {
  if (/^\d+$/.test(token)) return { id: +token, name: '#' + token };
  const map = await loadMapping();
  const r = map.resolve(token);
  if (!r) { console.error(`! unknown item "${token}"`); process.exit(1); }
  return r;
}

function parseTsArg(s) {
  if (s == null) return null;
  const t = Math.floor(Date.parse(s) / 1000);
  return Number.isFinite(t) ? t : null;
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === 'help' || cmd === '--help') { usage(); return; }

  if (cmd === 'list') {
    const store = pruneReverseFlip(loadReverseFlip(STATE_PATH));
    if (!store.length) { console.log('(no reverse-flip cycles declared)'); return; }
    for (const e of store) {
      const bid = e.rebuyBidPrice != null ? ` · bid ${e.rebuyBidPrice}` : '';
      console.log(`- ${e.name || ('#' + e.id)} (${e.id}): ${e.state} · sold ${e.soldQty}×@${e.soldEach} · BE-rebuy ${e.beRebuy}${bid}`);
    }
    return;
  }

  // split positionals from flags
  const flags = {}, pos = [];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--state') flags.state = argv[++i];
    else if (a === '--sold-each') flags.soldEach = argv[++i];
    else if (a === '--qty') flags.qty = argv[++i];
    else if (a === '--sold-ts') flags.soldTs = argv[++i];
    else if (a === '--bid') flags.bid = argv[++i];
    else pos.push(a);
  }

  if (cmd === 'clear') {
    if (!pos.length) { usage(); process.exit(1); }
    const { id, name } = await resolveId(pos[0]);
    const store = pruneReverseFlip(loadReverseFlip(STATE_PATH));
    const had = reverseFlipFor(store, id) != null;
    if (had) saveReverseFlip(STATE_PATH, clearReverseFlip(store, id));
    console.log(`cleared reverse-flip cycle for ${name} (${id})${had ? '' : ' (none was declared)'}.`);
    return;
  }

  if (cmd === 'set' || cmd === 'advance') {
    if (!pos.length) { usage(); process.exit(1); }
    const { id, name } = await resolveId(pos[0]);
    if (flags.state && !REVERSE_FLIP_STATES.includes(flags.state)) {
      console.error(`! --state must be one of ${REVERSE_FLIP_STATES.join(' | ')}`); process.exit(1);
    }
    const store = pruneReverseFlip(loadReverseFlip(STATE_PATH));

    if (cmd === 'set') {
      const soldEach = flags.soldEach != null ? parseGp(flags.soldEach) : NaN;
      if (!Number.isFinite(soldEach)) { console.error('! set requires --sold-each <gp>'); process.exit(1); }
      const soldQty = flags.qty != null && Number.isFinite(parseGp(flags.qty)) ? parseGp(flags.qty) : 1;
      const beRebuy = soldEach - tax(soldEach);   // canonical tax() — the E8 one-home rule
      const soldTs = parseTsArg(flags.soldTs) ?? Math.floor(Date.now() / 1000);
      const next = upsertReverseFlip(store, {
        id, name, state: flags.state || 'awaiting-rebuy',
        soldQty, soldEach, soldTs, beRebuy, targetQty: soldQty,
      });
      saveReverseFlip(STATE_PATH, next);
      console.log(`declared reverse-flip for ${name} (${id}): ${flags.state || 'awaiting-rebuy'} · sold ${soldQty}×@${soldEach} · BE-rebuy ${beRebuy} (reverse-flip-state.json)`);
      return;
    }

    // advance
    const prev = reverseFlipFor(store, id);
    if (!prev) { console.error(`! no declared reverse-flip cycle for ${name} (${id}) — run \`set\` first`); process.exit(1); }
    const bid = flags.bid != null ? parseGp(flags.bid) : null;
    const next = upsertReverseFlip(store, {
      id, name, state: flags.state || 'rebuy-armed',
      rebuyBidPrice: Number.isFinite(bid) ? bid : null,
      rebuyBidTs: Number.isFinite(bid) ? Math.floor(Date.now() / 1000) : null,
    });
    saveReverseFlip(STATE_PATH, next);
    console.log(`advanced reverse-flip for ${name} (${id}): ${flags.state || 'rebuy-armed'}${Number.isFinite(bid) ? ` · bid ${bid}` : ''} (reverse-flip-state.json)`);
    return;
  }

  usage(); process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
