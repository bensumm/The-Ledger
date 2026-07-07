#!/usr/bin/env node
/* thesis.mjs — CLI to record / clear / list the #4 SESSION THESIS per item (PLAN-YIELD). The SOLE
   writer of .cache/session-thesis.json (gitignored); watch.mjs is a read-only consumer that prints
   the reminder under each held lot. A thesis is INTENT — never a verdict/alert input, decides nothing.
   NO PII in a thesis string (the repo is public; the store is local but the discipline stands).

     node pipeline/thesis.mjs set "<item|id>" "<thesis>" [--tripwire "<level>"] [--window "<h-h>"]
     node pipeline/thesis.mjs clear "<item|id>"
     node pipeline/thesis.mjs list */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadMapping } from './lib/marketfetch.mjs';
import { loadThesis, saveThesis, upsertThesis, clearThesis, pruneThesis, thesisLine } from './lib/sessionthesis.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const THESIS_PATH = path.join(HERE, '.cache', 'session-thesis.json');

function usage() {
  console.log('Usage:\n' +
    '  node pipeline/thesis.mjs set "<item|id>" "<thesis>" [--tripwire "<level>"] [--window "<h-h>"]\n' +
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

  // split positionals from the --tripwire/--window flags
  const flags = {}, pos = [];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tripwire') flags.tripwire = argv[++i];
    else if (a === '--window') flags.window = argv[++i];
    else pos.push(a);
  }

  if (cmd === 'clear') {
    if (!pos.length) { usage(); process.exit(1); }
    const { id, name } = await resolveId(pos[0]);
    saveThesis(THESIS_PATH, clearThesis(pruneThesis(loadThesis(THESIS_PATH)), id));
    console.log(`cleared thesis for ${name} (${id}).`);
    return;
  }

  if (cmd === 'set') {
    if (pos.length < 2) { usage(); process.exit(1); }
    const { id, name } = await resolveId(pos[0]);
    const thesis = pos.slice(1).join(' ');
    const store = upsertThesis(pruneThesis(loadThesis(THESIS_PATH)), id, { thesis, tripwire: flags.tripwire, window: flags.window });
    saveThesis(THESIS_PATH, store);
    console.log(`set thesis for ${name} (${id}): ${thesisLine(store[id])}`);
    return;
  }

  usage(); process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
