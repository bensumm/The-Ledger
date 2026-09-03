#!/usr/bin/env node
/* declare-thesis.mjs — CLI to record / clear / list the #4 SESSION THESIS per item (PLAN-YIELD). The SOLE
   writer of .cache/session-thesis.json (gitignored); watch-positions.mjs is a read-only consumer that prints
   the reminder under each held lot. A thesis is INTENT — never a verdict/alert input, decides nothing.
   NO PII in a thesis string (the repo is public; the store is local but the discipline stands).

   P4a — `--path <key>` also DECLARES the path-engine entry path for the lot into the TRACKED
   hold-thesis store (repo-root hold-thesis.json, the path-carrying store js/held-item-strategy.mjs' enteredUnder
   feeds off — NOT the gitignored session-thesis file). VN-2 widened that write: with `--path` the
   hold-thesis entry now ALSO takes a NUMERIC `--tripwire` (parseGp — the TG1 gating level),
   `--exit <gp>` (the declared target sell, the VN-2 render frame's exit price), and `--window`
   (the declared exit window, "h-h" local hours) — each preserved from the existing entry when the
   flag is omitted or unparseable. enteredUnder defaults to the declared path on FIRST declaration
   (override with `--entered-under <key>`). A path key is one of js/held-item-strategy.mjs' PATH_KEYS
   ('value-hold'/'hold-recovery'/'scalp'/'be-escape'/'list-to-clear'/'cut').
   (Two-store note: session-thesis = free-text INTENT/reminder; hold-thesis = the declared, gating,
   path-carrying plan. `--path` is what routes the flags into the latter. `clear` removes the id from
   BOTH stores — FIX 2, 2026-07-13 — so a cleared plan can't leave a gating exit/tripwire behind.)

   FD4 — `bid`/`bid-clear` declare/clear a DEEP/LONG resting-bid intent into TRACKED root bid-thesis.json (bidthesis.mjs): silences watch's stale-bid flag until TTL, gates nothing else.

     node pipeline/commands/declare-thesis.mjs set "<item|id>" "<thesis>" [--tripwire "<level>"] [--exit "<gp>"] [--window "<h-h>"] [--path <key>] [--entered-under <key>]
     node pipeline/commands/declare-thesis.mjs clear "<item|id>"
     node pipeline/commands/declare-thesis.mjs bid "<item|id>" ["<note>"] [--side buy|sell]
     node pipeline/commands/declare-thesis.mjs bid-clear "<item|id>" [--side buy|sell]
     node pipeline/commands/declare-thesis.mjs list */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadMapping } from '../lib/market/marketfetch.mjs';
import { loadThesis, saveThesis, upsertThesis, clearThesis, pruneThesis, thesisLine } from '../lib/thesis/sessionthesis.mjs';
import { loadHoldThesis, saveHoldThesis, pruneHoldThesis, thesisFor as holdThesisFor, upsertThesis as upsertHoldThesis, clearThesis as clearHoldThesis } from '../lib/thesis/holdthesis.mjs';
import { loadBidThesis, saveBidThesis, pruneBidThesis, upsertBidThesis, clearBidThesis, BID_THESIS_TTL_DAYS } from '../lib/thesis/bidthesis.mjs';   // FD4 — declared deep/long-bid store
import { parseGp } from '../lib/render/cli.mjs';   // VN-2 — numeric tripwire/exit for the hold-thesis write

const HERE = path.dirname(fileURLToPath(import.meta.url));
const THESIS_PATH = path.join(HERE, '..', '.cache', 'session-thesis.json');
const HOLD_THESIS_PATH = path.join(HERE, '..', '..', 'hold-thesis.json');   // TRACKED repo-root store (P4a path decl)
const BID_THESIS_PATH = path.join(HERE, '..', '..', 'bid-thesis.json');     // TRACKED repo-root store (FD4 bid decl)

function usage() {
  console.log('Usage:\n' +
    '  node pipeline/commands/declare-thesis.mjs set "<item|id>" "<thesis>" [--tripwire "<level>"] [--window "<h-h>"] [--path <key>] [--entered-under <key>]\n' +
    '  node pipeline/commands/declare-thesis.mjs clear "<item|id>"\n' +
    '  node pipeline/commands/declare-thesis.mjs bid "<item|id>" ["<note>"] [--side buy|sell]\n' +
    '  node pipeline/commands/declare-thesis.mjs bid-clear "<item|id>" [--side buy|sell]\n' +
    '  node pipeline/commands/declare-thesis.mjs list');
}

async function resolveId(token) {
  if (/^\d+$/.test(token)) return { id: +token, name: '#' + token };
  const map = await loadMapping();
  const r = map.resolve(token);
  if (!r) { console.error(`! unknown item "${token}"`); process.exit(1); }
  return r;
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === 'help' || cmd === '--help') { usage(); return; }

  if (cmd === 'list') {
    const store = pruneThesis(loadThesis(THESIS_PATH));
    const ids = Object.keys(store);
    const bstore = pruneBidThesis(loadBidThesis(BID_THESIS_PATH));   // FD4: bid declarations list too
    if (!ids.length && !bstore.length) { console.log('(no session theses or bid declarations recorded)'); return; }
    const map = await loadMapping();
    for (const id of ids) console.log(`- ${map.byId[id]?.name || ('#' + id)} (${id}): ${thesisLine(store[id])}`);
    for (const e of bstore) console.log(`- ${map.byId[e.id]?.name || ('#' + e.id)} (${e.id}): declared ${e.side || 'buy'}-side deep/long bid${e.note ? ` — ${e.note}` : ''} (stale-bid flag silent; TTL ${BID_THESIS_TTL_DAYS}d)`);
    return;
  }

  // split positionals from the --tripwire/--exit/--window/--path/--entered-under flags
  const flags = {}, pos = [];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tripwire') flags.tripwire = argv[++i];
    else if (a === '--exit') flags.exit = argv[++i];
    else if (a === '--window') flags.window = argv[++i];
    else if (a === '--path') flags.path = argv[++i];
    else if (a === '--entered-under') flags.enteredUnder = argv[++i];
    else if (a === '--side') flags.side = argv[++i];
    else pos.push(a);
  }

  if (cmd === 'bid' || cmd === 'bid-clear') {
    if (!pos.length) { usage(); process.exit(1); }
    const side = flags.side || 'buy';
    if (side !== 'buy' && side !== 'sell') { console.error(`! --side must be buy or sell (got "${flags.side}")`); process.exit(1); }
    const { id, name } = await resolveId(pos[0]);
    const bstore = pruneBidThesis(loadBidThesis(BID_THESIS_PATH));
    if (cmd === 'bid-clear') {
      saveBidThesis(BID_THESIS_PATH, clearBidThesis(bstore, id, side));
      console.log(`cleared ${side}-side bid declaration for ${name} (${id}) — the stale-bid flag re-arms (bid-thesis.json).`);
      return;
    }
    const note = pos.slice(1).join(' ') || null;
    saveBidThesis(BID_THESIS_PATH, upsertBidThesis(bstore, { id, side, note }));
    console.log(`declared ${side}-side deep/long bid for ${name} (${id})${note ? `: ${note}` : ''} — stale-bid flag silent for ${BID_THESIS_TTL_DAYS}d (bid-thesis.json).`);
    return;
  }

  if (cmd === 'clear') {
    if (!pos.length) { usage(); process.exit(1); }
    const { id, name } = await resolveId(pos[0]);
    // clear BOTH stores (FIX 2 — a cleared plan must not leave a gating exit/tripwire behind)
    saveThesis(THESIS_PATH, clearThesis(pruneThesis(loadThesis(THESIS_PATH)), id));
    const hstore = pruneHoldThesis(loadHoldThesis(HOLD_THESIS_PATH));
    const hadHold = holdThesisFor(hstore, id) != null;
    if (hadHold) saveHoldThesis(HOLD_THESIS_PATH, clearHoldThesis(hstore, id));
    console.log(`cleared thesis for ${name} (${id}) — session-thesis.json`
      + `${hadHold ? ' + hold-thesis.json (declared plan removed)' : ' (no declared plan in hold-thesis.json)'}.`);
    return;
  }

  if (cmd === 'set') {
    if (pos.length < 2) { usage(); process.exit(1); }
    const { id, name } = await resolveId(pos[0]);
    const thesis = pos.slice(1).join(' ');
    const store = upsertThesis(pruneThesis(loadThesis(THESIS_PATH)), id, { thesis, tripwire: flags.tripwire, window: flags.window });
    saveThesis(THESIS_PATH, store);
    console.log(`set thesis for ${name} (${id}): ${thesisLine(store[id])}`);
    // P4a: `--path` ALSO declares the path-engine entry path into the tracked hold-thesis store
    // (the ONLY store js/held-item-strategy.mjs reads enteredUnder off), preserving existing fields.
    if (flags.path) {
      const hstore = pruneHoldThesis(loadHoldThesis(HOLD_THESIS_PATH));
      const prev = holdThesisFor(hstore, id) || {};
      const enteredUnder = flags.enteredUnder != null ? flags.enteredUnder
        : (prev.enteredUnder != null ? prev.enteredUnder : flags.path);   // first declaration = entered under this path
      // VN-2: parseable --tripwire/--exit/--window ride the entry; omitted/unparseable preserves (never clobbers to null).
      const trip = flags.tripwire != null && Number.isFinite(parseGp(flags.tripwire)) ? parseGp(flags.tripwire) : (prev.tripwire ?? null);
      const exit = flags.exit != null && Number.isFinite(parseGp(flags.exit)) ? parseGp(flags.exit) : (prev.exitPrice ?? null);
      const win = flags.window != null ? flags.window : (prev.window ?? null);
      const next = upsertHoldThesis(hstore, {
        id, exitPrice: exit, tripwire: trip,
        horizon: prev.horizon ?? null, window: win, path: flags.path, enteredUnder,
      });
      saveHoldThesis(HOLD_THESIS_PATH, next);
      console.log(`declared plan for ${name} (${id}): path=${flags.path} enteredUnder=${enteredUnder}`
        + `${trip != null ? ` tripwire=${trip}` : ''}${exit != null ? ` exit=${exit}` : ''}${win != null ? ` window=${win}` : ''} (hold-thesis.json)`);
    }
    return;
  }

  usage(); process.exit(1);
}

// `process.argv[1] &&` guard (chunk 5) — matches sync-fills/screen-flip-niches/trigger-alerts: an
// import from a context with no argv[1] (some test/embed harnesses) would otherwise crash in pathToFileURL.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
