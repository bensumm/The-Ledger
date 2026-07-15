#!/usr/bin/env node
/* check-imports.mjs — CI import-RESOLUTION guard (PLAN-VOL24 follow-up, 2026-07-13).
 *
 * WHY: the cheap `checks` job only proves SYNTAX (`node --check` never resolves imports), no test
 * imports the pipeline entrypoints, and the smoke job loads only the browser app — so an entrypoint that
 * imports a name a shared module does NOT export sits UNDETECTED on main (exactly how screen.mjs's
 * `import { … dayHighFrom5m }` rode a whole-file commit while estimators.mjs stayed behind, ESM-erroring
 * on a clean checkout). This check closes that gap.
 *
 * WHAT: for each pipeline ENTRYPOINT it STATICALLY parses the `import { … } from './rel.mjs'` statements
 * and verifies every named/default import actually exists in the TARGET module's exports. It dynamic-
 * imports only the TARGET modules (pipeline/lib/*, js/*, pipeline/modules/* — all pure, DOM-free, side-
 * effect-free on import) to read their export lists; it NEVER imports the entrypoints themselves, so no
 * entrypoint main()/fetch/git/argv side effect can fire. That import of the targets ALSO transitively
 * loads the shared graph, so a missing export DEEPER in the dependency chain throws here too.
 *
 * CONSTRAINTS (checks.yml, /ship §4): fast, offline, deterministic, public-log-safe, no ~/.runelite,
 * no secrets, no network. Exits non-zero (and prints the offending entrypoint→module→name) on any
 * unresolved import; exits 0 when every entrypoint's imports resolve.
 *
 * Run: `node pipeline/check-imports.mjs`   (CI wires it into checks.yml).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// The pipeline CLI entrypoints. Their imports are checked; the files themselves are NEVER executed
// (guarded ones like screen.mjs/sync-fills.mjs AND unguarded ones like quote/watch/analyze alike — the
// static parse means guardedness is irrelevant to safety here).
const ENTRYPOINTS = [
  'screen.mjs', 'quote.mjs', 'watch.mjs', 'loop-tick.mjs', 'analyze.mjs',
  'monitor.mjs', 'limits.mjs', 'windowrange.mjs', 'sync-fills.mjs', 'add-manual-fill.mjs',
].map(f => path.join(HERE, f)).filter(p => fs.existsSync(p));

// Extract [{ specifier, names:Set, wantDefault:bool, nsOnly:bool }] for every RELATIVE from-import in src.
// Handles single- and multi-line braces, `as` renames (checks the EXPORTED name), default + namespace,
// and side-effect-only `import './x.mjs'` (resolved but no name check). Skips node:/bare specifiers.
function parseRelativeImports(src) {
  const out = [];
  // strip block + line comments so a commented-out import isn't parsed (the `[^:]` guard keeps `://` in URLs)
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  // ONE statement at a time: `[^;]` cannot cross a `;`, so a preceding `import … from 'node:x';` can't
  // bleed into the clause of a later relative import (every import in this repo ends with `;`).
  const re = /\bimport\b([^;]*?)\bfrom\b\s*['"](\.[^'"]+)['"]/g;     // named/default/namespace … from './rel'
  let m;
  while ((m = re.exec(clean)) !== null) {
    const clause = m[1].trim(), specifier = m[2];
    const rec = { specifier, names: new Set(), wantDefault: false, nsOnly: false };
    if (/^\*\s+as\s+\w+$/.test(clause)) { rec.nsOnly = true; out.push(rec); continue; }   // import * as NS
    const brace = clause.match(/\{([\s\S]*)\}/);
    if (brace) {
      for (const part of brace[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();       // the EXPORTED name (before `as`)
        if (name) rec.names.add(name);
      }
    }
    const beforeBrace = clause.split('{')[0];
    if (/(^|,)\s*\w+\s*(,|$)/.test(beforeBrace) && /\w/.test(beforeBrace.replace(/[{}*]/g, '')))
      rec.wantDefault = true;                                       // a leading `Def` before the brace / alone
    out.push(rec);
  }
  // bare side-effect imports: import './x.mjs';  (resolve the module, no name check)
  const reBare = /\bimport\s*['"](\.[^'"]+)['"]/g;
  while ((m = reBare.exec(clean)) !== null) out.push({ specifier: m[1], names: new Set(), wantDefault: false, nsOnly: false });
  return out;
}

let failures = 0, checkedImports = 0;
const targetCache = new Map();   // absPath -> exports keys Set | Error

async function exportsOf(absPath) {
  if (targetCache.has(absPath)) return targetCache.get(absPath);
  let val;
  try { val = new Set(Object.keys(await import(pathToFileURL(absPath).href))); }
  catch (err) { val = err instanceof Error ? err : new Error(String(err)); }
  targetCache.set(absPath, val);
  return val;
}

for (const entry of ENTRYPOINTS) {
  const rel = path.relative(HERE, entry);
  let src; try { src = fs.readFileSync(entry, 'utf8'); } catch { continue; }
  for (const imp of parseRelativeImports(src)) {
    // resolve the specifier relative to the entrypoint's directory
    let target = path.resolve(path.dirname(entry), imp.specifier);
    if (!fs.existsSync(target)) {
      // allow extensionless (unlikely in this repo — all imports carry .mjs/.js — but be safe)
      const withMjs = target + '.mjs', withJs = target + '.js';
      target = fs.existsSync(withMjs) ? withMjs : fs.existsSync(withJs) ? withJs : target;
    }
    if (!fs.existsSync(target)) { console.error(`✗ ${rel}: cannot resolve module '${imp.specifier}'`); failures++; continue; }
    const ex = await exportsOf(target);
    if (ex instanceof Error) { console.error(`✗ ${rel}: importing '${imp.specifier}' FAILED — ${ex.message}`); failures++; continue; }
    if (imp.nsOnly) { checkedImports++; continue; }                // namespace import — nothing to name-check
    if (imp.wantDefault && !ex.has('default')) { console.error(`✗ ${rel}: '${imp.specifier}' has no DEFAULT export`); failures++; }
    for (const name of imp.names) {
      checkedImports++;
      if (!ex.has(name)) { console.error(`✗ ${rel}: '${imp.specifier}' does not export '${name}'`); failures++; }
    }
  }
}

if (failures) { console.error(`\n✗ import-check FAILED — ${failures} unresolved import(s) across ${ENTRYPOINTS.length} entrypoint(s).`); process.exit(1); }
console.log(`✓ import-check passed — ${checkedImports} named/default import(s) across ${ENTRYPOINTS.length} entrypoint(s) all resolve.`);
