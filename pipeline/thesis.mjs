#!/usr/bin/env node
/* thesis.mjs — CLI to record / clear / list the #4 SESSION THESIS per item (PLAN-YIELD). The SOLE
   writer of .cache/session-thesis.json (gitignored); watch.mjs is a read-only consumer that prints
   the reminder under each held lot. A thesis is INTENT — never a verdict/alert input, decides nothing.
   NO PII in a thesis string (the repo is public; the store is local but the discipline stands).

   P4a — `--path <key>` also DECLARES the path-engine entry path for the lot into the TRACKED
   hold-thesis store (repo-root hold-thesis.json, the path-carrying store js/paths.mjs' enteredUnder
   feeds off — NOT the gitignored session-thesis file). VN-2 widened that write: with `--path` the
   hold-thesis entry now ALSO takes a NUMERIC `--tripwire` (parseGp — the TG1 gating level),
   `--exit <gp>` (the declared target sell, the VN-2 render frame's exit price), and `--window`
   (the declared exit window, "h-h" local hours) — each preserved from the existing entry when the
   flag is omitted or unparseable. enteredUnder defaults to the declared path on FIRST declaration
   (override with `--entered-under <key>`). A path key is one of js/paths.mjs' PATH_KEYS
   ('value-hold'/'hold-recovery'/'scalp'/'be-escape'/'list-to-clear'/'cut').
   (Two-store note: session-thesis = free-text INTENT/reminder; hold-thesis = the declared, gating,
   path-carrying plan. `--path` is what routes the flags into the latter. `clear` removes the id from
   BOTH stores — FIX 2, 2026-07-13 — so a cleared plan can't leave a gating exit/tripwire behind.)

     node pipeline/thesis.mjs set "<item|id>" "<thesis>" [--tripwire "<level>"] [--exit "<gp>"] [--window "<h-h>"] [--path <key>] [--entered-under <key>]
     node pipeline/thesis.mjs clear "<item|id>"
     node pipeline/thesis.mjs list */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadMapping } from './lib/marketfetch.mjs';
import { loadThesis, saveThesis, upsertThesis, clearThesis, pruneThesis, thesisLine } from './lib/sessionthesis.mjs';
import { loadHoldThesis, saveHoldThesis, pruneHoldThesis, thesisFor as holdThesisFor, upsertThesis as upsertHoldThesis, clearThesis as clearHoldThesis } from './lib/holdthesis.mjs';
import { parseGp } from './lib/cli.mjs';   // VN-2 — numeric tripwire/exit for the hold-thesis write

const HERE = path.dirname(fileURLToPath(import.meta.url));
const THESIS_PATH = path.join(HERE, '.cache', 'session-thesis.json');
const HOLD_THESIS_PATH = path.join(HERE, '..', 'hold-thesis.json');   // TRACKED repo-root store (P4a path decl)

function usage() {
  console.log('Usage:\n' +
    '  node pipeline/thesis.mjs set "<item|id>" "<thesis>" [--tripwire "<level>"] [--window "<h-h>"] [--path <key>] [--entered-under <key>]\n' +
    '  node pipeline/thesis.mjs clear "<item|id>"\n' +
    '  node pipeline/thesis.mjs list');
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
    if (!ids.length) { console.log('(no session theses recorded)'); return; }
    const map = await loadMapping();
    for (const id of ids) console.log(`- ${map.byId[id]?.name || ('#' + id)} (${id}): ${thesisLine(store[id])}`);
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
    else pos.push(a);
  }

  if (cmd === 'clear') {
    if (!pos.length) { usage(); process.exit(1); }
    const { id, name } = await resolveId(pos[0]);
    // clear the session-thesis store (free-text INTENT/reminder)…
    saveThesis(THESIS_PATH, clearThesis(pruneThesis(loadThesis(THESIS_PATH)), id));
    // …AND the TRACKED hold-thesis store (the declared, GATING, path-carrying plan `set --path` writes).
    // FIX 2 (2026-07-13): `clear` used to leave the hold-thesis entry behind, so a cleared plan kept
    // gating (its exit/tripwire lingered — the stale Masori body / Lightbearer / fury pollution). Reach
    // BOTH stores; only write hold-thesis.json when an entry actually existed (else it's untouched).
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
    // P4a: `--path` ALSO declares the path-engine entry path into the tracked hold-thesis store,
    // preserving any existing declared plan fields (exitPrice/tripwire/horizon/enteredUnder). This
    // is the ONLY store js/paths.mjs reads enteredUnder off; the session thesis above is display-only.
    if (flags.path) {
      const hstore = pruneHoldThesis(loadHoldThesis(HOLD_THESIS_PATH));
      const prev = holdThesisFor(hstore, id) || {};
      const enteredUnder = flags.enteredUnder != null ? flags.enteredUnder
        : (prev.enteredUnder != null ? prev.enteredUnder : flags.path);   // first declaration = entered under this path
      // VN-2: the declared plan's NUMERIC levels + exit window ride the hold-thesis entry too —
      // a parseable --tripwire/--exit updates the gating/frame levels; --window updates the exit
      // window; an omitted/unparseable flag preserves the existing value (never clobbers to null).
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

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
