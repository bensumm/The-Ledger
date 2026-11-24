#!/usr/bin/env node
/* build-registry.mjs — generates the CLAUDE.md ask table and the README command list from the tag lines at the top of
 * each pipeline/commands/*.mjs.
 *
 *   node pipeline/ci/build-registry.mjs           check (CI): fails when stale, untagged or malformed
 *   node pipeline/ci/build-registry.mjs --write   regenerate both
 *
 *   // @does <one line>                           required, exactly one
 *   // @ask <phrases> => <arguments>              any number; the phrases that should run this command
 *   // @read <caveat>                             at most one; shown beside every ask
 *
 * Generated text sits between `<!-- registry:NAME -->` and `<!-- /registry:NAME -->`. lint-comments.mjs does not count
 * tag lines, so MAX_TAG keeps them one-liners. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const at = process.argv.indexOf('--root');   // fixture tests only
const ROOT = at > 0 ? process.argv[at + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMMANDS = 'pipeline/commands';
export const MAX_TAG = 220;
const HEAD_LINES = 12;
const TAG_RE = /^\/\/ @(does|ask|read) (.+)$/;

/* parseTags(text) → { does, asks:[{ask,args}], read, errors[] }. Tags must sit in the first HEAD_LINES lines. */
export function parseTags(text) {
  const out = { does: null, asks: [], read: null, errors: [] };
  text.split(/\r?\n/).forEach((line, i) => {
    const m = TAG_RE.exec(line.trimEnd());
    if (!m) { if (/^\s*\/\/\s*@(does|ask|read)\b/.test(line)) out.errors.push(`line ${i + 1}: malformed tag`); return; }
    if (i >= HEAD_LINES) { out.errors.push(`line ${i + 1}: tag below the header`); return; }
    if (line.length > MAX_TAG) out.errors.push(`line ${i + 1}: tag over ${MAX_TAG} characters`);
    const [, kind, body] = m;
    if (kind === 'ask') {
      const j = body.indexOf('=>');
      if (j < 1) out.errors.push(`line ${i + 1}: @ask needs "phrases => arguments"`);
      else out.asks.push({ ask: body.slice(0, j).trim(), args: body.slice(j + 2).trim() });
    } else if (out[kind] != null) out.errors.push(`line ${i + 1}: second @${kind}`);
    else out[kind] = body.trim();
  });
  if (!out.does) out.errors.push('no @does line');
  const code = text.split(/\r?\n/).filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
  for (const a of out.asks) for (const [, flag] of a.args.matchAll(/--([a-z][a-z-]*)/g))
    if (!new RegExp('(^|[^\\w-])(--)?' + flag + '(?![\\w-])').test(code)) out.errors.push(`@ask names --${flag}, which the code never reads`);
  return out;
}

const cell = s => s.replace(/\|/g, '\\|');
export function askTable(reg) {
  const rows = reg.flatMap(r => r.asks.map((a, i) => `| ${cell(a.ask)} | \`${cell(`${r.name} ${a.args}`.trim())}\`${r.read ? ' — ' + (i ? 'caveat above' : cell(r.read)) : ''} |`));
  return ['| Ask | `node pipeline/commands/…` |', '| --- | --- |', ...rows].join('\n');
}
export const commandList = reg => reg.map(r => `- \`${r.name}\` — ${r.does}`).join('\n');

/* splice(text, name, body) → text with the marked region replaced; null when the markers are missing or repeated. */
export function splice(text, name, body) {
  const a = `<!-- registry:${name} -->`, b = `<!-- /registry:${name} -->`;
  if (text.split(a).length !== 2 || text.split(b).length !== 2 || text.indexOf(a) > text.indexOf(b)) return null;
  return text.slice(0, text.indexOf(a) + a.length) + '\n' + body + '\n' + text.slice(text.indexOf(b));
}

function main() {
  const write = process.argv.includes('--write');
  const names = fs.readdirSync(path.join(ROOT, COMMANDS)).filter(f => f.endsWith('.mjs')).sort();
  const bad = [], reg = [];
  for (const name of names) {
    const t = parseTags(fs.readFileSync(path.join(ROOT, COMMANDS, name), 'utf8'));
    bad.push(...t.errors.map(e => `${COMMANDS}/${name}: ${e}`));
    reg.push({ name, ...t });
  }
  if (!names.length || !reg.some(r => r.asks.length)) bad.push('no commands or no asks found — refusing an empty registry');
  if (!bad.length) for (const [file, name, body] of [['CLAUDE.md', 'asks', askTable(reg)], ['README.md', 'commands', commandList(reg)]]) {
    const raw = fs.readFileSync(path.join(ROOT, file), 'utf8'), cur = raw.replace(/\r\n/g, '\n'), next = splice(cur, name, body);
    if (next == null) bad.push(`${file}: registry:${name} markers missing or repeated`);
    else if (next !== cur && write) fs.writeFileSync(path.join(ROOT, file), raw.includes('\r\n') ? next.replace(/\n/g, '\r\n') : next);
    else if (next !== cur) bad.push(`${file}: registry:${name} is stale — run: node pipeline/ci/build-registry.mjs --write`);
  }
  if (bad.length) { console.error('✗ registry FAILED\n  ' + bad.join('\n  ')); process.exit(1); }
  console.log(`✓ registry ${write ? 'written' : 'current'} — ${reg.length} commands, ${reg.reduce((n, r) => n + r.asks.length, 0)} asks.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
