#!/usr/bin/env node
/* check-imports.mjs — CI import-RESOLUTION guard (PLAN-VOL24 follow-up, 2026-07-13).
 *
 * WHY: the cheap `checks` job only proves SYNTAX (`node --check` never resolves imports), no test
 * imports the pipeline entrypoints, and the smoke job loads only the browser app — so an entrypoint that
 * imports a name a shared module does NOT export sits UNDETECTED on main (exactly how screen-flip-niches.mjs's
 * `import { … dayHighFrom5m }` rode a whole-file commit while estimators.mjs stayed behind, ESM-erroring
 * on a clean checkout). This check closes that gap.
 *
 * WHAT: for each pipeline ENTRYPOINT it STATICALLY parses the `import { … } from './rel.mjs'` statements
 * and verifies every named/default import actually exists in the TARGET module's exports. It dynamic-
 * imports only the TARGET modules (pipeline/lib/*, js/*, pipeline/probes/* — all pure, DOM-free, side-
 * effect-free on import) to read their export lists; it NEVER imports the entrypoints themselves, so no
 * entrypoint main()/fetch/git/argv side effect can fire. That import of the targets ALSO transitively
 * loads the shared graph, so a missing export DEEPER in the dependency chain throws here too.
 *
 * CONSTRAINTS (checks.yml, /ship §4): fast, offline, deterministic, public-log-safe, no ~/.runelite,
 * no secrets, no network. Exits non-zero (and prints the offending entrypoint→module→name) on any
 * unresolved import; exits 0 when every entrypoint's imports resolve.
 *
 * Run: `node pipeline/ci/check-imports.mjs`   (CI wires it into checks.yml).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// The pipeline CLI entrypoints. Their imports are checked; the files themselves are NEVER executed
// (guarded ones like screen-flip-niches.mjs/sync-fills.mjs AND unguarded ones like quote/watch/analyze alike — the
// static parse means guardedness is irrelevant to safety here).
// PLAN-LIB-SUBDIRS chunk 0: this was a hardcoded list of 11 commands, so the other ~19 (read-book.mjs,
// read-schedule.mjs, derive-cash.mjs, …) had NO static import check — a broken import in one could reach
// main and only surface when Ben ran the command. The lib-subdir reorg rewrites specifiers across every
// command, which makes that gap far likelier to bite, so the list is now the whole directory: any new
// command is covered automatically and never needs registering here.
const ENTRYPOINTS = fs.readdirSync(path.join(HERE, '..', 'commands'))   // HERE=pipeline/ci; '..' -> pipeline/
  .filter(f => f.endsWith('.mjs')).sort()
  .map(f => path.join(HERE, '..', 'commands', f));

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

/* ---------------------------------------------------------------------------------------------
 * PART 2 — the UNBOUND-CONSTANT check (2026-08-09, the QUICK_FRESH_MIN crash).
 *
 * WHY: Part 1 proves every name an entrypoint IMPORTS exists. It says nothing about the reverse —
 * a name the entrypoint USES but never imported or declared. That is a `ReferenceError` at RUNTIME,
 * invisible to `node --check` (syntax-only), invisible to Part 1, and invisible to the suite when no
 * test executes the function. It shipped exactly that way: `quote-items.mjs` used `QUICK_FRESH_MIN`
 * in the big-ticket windowExit block with no import, every CI guard green. The throw was swallowed by
 * the block's own `catch`, which rendered it as `window read unavailable (QUICK_FRESH_MIN is not
 * defined)` — destroying the whole ask-exit read (typical-exit quantiles, 5m reach, and the reach-margin
 * FADE clause that carries the price-to-sell-EARLY trigger) and disguising a crash as missing data.
 *
 * WHAT: a deliberately NARROW structural check — SCREAMING_SNAKE identifiers only (`[A-Z][A-Z0-9]*`
 * plus at least one `_[A-Z0-9]+`). That is the repo's universal convention for module constants, and
 * requiring the underscore keeps prose/verdict tokens (`NOT LISTED`, `CUT`, `BID-BEHIND`) out. Comments
 * and string literals are stripped first; template-literal `${…}` interiors are KEPT (real code). Member
 * accesses (`obj.MAX_X`, `process.env.COFFER_FETCH_CACHE`) and object-literal keys are excluded — only
 * BARE identifier references are checked, which is precisely the binding-error class.
 *
 * It is a structural checker in the same spirit as lint-docs/check-daemon-safety, NOT a type system:
 * it will not catch a misspelled camelCase local. It closes the one class that has actually bitten.
 * -------------------------------------------------------------------------------------------- */
const CONST_RE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;

// Strip comments and string literals, PRESERVING template `${…}` interiors (they hold real code).
// This is a character scanner, not a regex sweep, because `${…}` interiors NEST braces — the very first
// version used /\$\{[^{}]*\}/ and silently dropped `${liveAgeTag(x, { freshMin: QUICK_FRESH_MIN })}`,
// i.e. it failed to see the exact expression whose crash prompted this guard. A nested-brace template
// call is the single most common shape in this repo's render code; it must be scanned, not matched.
function codeOnly(src) {
  let out = '', i = 0;
  const n = src.length;
  const scanTemplate = () => {                 // at src[i] === '`'
    i++;
    while (i < n) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { i++; return; }
      if (c === '$' && src[i + 1] === '{') {    // keep the interior verbatim, brace-depth aware
        i += 2; let depth = 1;
        while (i < n && depth > 0) {
          const d = src[i];
          if (d === '{') depth++;
          else if (d === '}') { depth--; if (depth === 0) { i++; break; } }
          else if (d === '`') { const s = i; scanTemplate(); out += src.slice(s, i); continue; }
          out += d; i++;
        }
        out += ' ';
        continue;
      }
      i++;                                      // static text — dropped
    }
  };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; out += ' '; continue; }
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); i = e < 0 ? n : e; out += ' '; continue; }
    if (c === "'" || c === '"') {               // string literal — dropped entirely
      const q = c; i++;
      while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      i++; out += ' '; continue;
    }
    if (c === '`') { scanTemplate(); continue; }
    out += c; i++;
  }
  return out;
}

// every SCREAMING_SNAKE name this module BINDS: imports (local alias), const/let/var, function/class,
// destructured bindings, and function parameters written in that style.
function boundConstants(src) {
  const bound = new Set();
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  // import clauses — take the LOCAL name (after `as` when renamed)
  const reImp = /\bimport\b([^;]*?)\bfrom\b\s*['"][^'"]+['"]/g;
  let m;
  while ((m = reImp.exec(clean)) !== null) {
    for (const part of m[1].replace(/[{}]/g, ',').split(',')) {
      const t = part.trim(); if (!t) continue;
      const local = t.split(/\s+as\s+/).pop().replace(/^\*\s*/, '').trim();
      if (local) bound.add(local);
    }
  }
  for (const d of clean.matchAll(/\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) bound.add(d[1]);
  // const/let/var declarations. A declaration is a COMMA-SEPARATED LIST (`const A = 1, B = 2;`) and the
  // list may destructure (`const { a, b } = x`), so walk to the terminating depth-0 `;`, split on depth-0
  // commas, and bind every identifier on each declarator's LEFT of `=`. (Reading only the first declarator
  // is what made this check's own first run report six false positives — every one a multi-declarator list.)
  for (const kw of clean.matchAll(/\b(?:const|let|var)\s/g)) {
    let i = kw.index + kw[0].length, depth = 0, body = '';
    for (; i < clean.length && body.length < 4000; i++) {
      const ch = clean[i];
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) { if (depth === 0) break; depth--; }
      else if (ch === ';' && depth === 0) break;
      body += ch;
    }
    let seg = '', segDepth = 0;
    const flush = () => {
      // the BINDING PATTERN only: everything left of the first `=`, and — for `for (const x of expr)` /
      // `for (const k in obj)`, which have no `=` at all — everything left of the `of`/`in`. Without that
      // second cut the whole iterated expression counts as bindings, so `for (const h of f(SOME_CONST))`
      // would "declare" SOME_CONST and this guard would wave through the very errors it exists to catch.
      let lhs = seg.split('=')[0];
      const kwd = lhs.match(/\s(?:of|in)\s/);
      if (kwd) lhs = lhs.slice(0, kwd.index);
      for (const id of lhs.matchAll(/[A-Za-z_$][\w$]*/g)) bound.add(id[0]);
      seg = '';
    };
    for (const ch of body) {
      if ('([{'.includes(ch)) segDepth++;
      else if (')]}'.includes(ch)) segDepth--;
      if (ch === ',' && segDepth === 0) { flush(); continue; }
      seg += ch;
    }
    flush();
  }
  return bound;
}

let unbound = 0, checkedConsts = 0;
for (const entry of ENTRYPOINTS) {
  const rel = path.relative(HERE, entry);
  let src; try { src = fs.readFileSync(entry, 'utf8'); } catch { continue; }
  const bound = boundConstants(src);
  // drop the import statements themselves — an imported name appearing in its own clause is a BINDING,
  // not a reference, and counting it would inflate the reported total.
  const code = codeOnly(src).replace(/\bimport\b[^;]*?\bfrom\b[^;]*;/g, ' ');
  const seen = new Set();
  for (const hit of code.matchAll(CONST_RE)) {
    const name = hit[0];
    if (seen.has(name)) continue;
    // skip member accesses (`x.MAX_Y`, `x?.MAX_Y`) and object-literal keys (`MAX_Y:`)
    const before = code.slice(Math.max(0, hit.index - 2), hit.index);
    if (/\.$/.test(before)) continue;
    if (code[hit.index + name.length] === ':') continue;
    seen.add(name);
    checkedConsts++;
    if (!bound.has(name)) { console.error(`✗ ${rel}: uses '${name}' but never imports or declares it (ReferenceError at runtime)`); unbound++; }
  }
}

if (failures || unbound) {
  if (failures) console.error(`\n✗ import-check FAILED — ${failures} unresolved import(s) across ${ENTRYPOINTS.length} entrypoint(s).`);
  if (unbound) console.error(`\n✗ unbound-constant check FAILED — ${unbound} SCREAMING_SNAKE name(s) used without a binding.`);
  process.exit(1);
}
console.log(`✓ import-check passed — ${checkedImports} named/default import(s) across ${ENTRYPOINTS.length} entrypoint(s) all resolve.`);
console.log(`✓ unbound-constant check passed — ${checkedConsts} SCREAMING_SNAKE reference(s) all bound.`);
