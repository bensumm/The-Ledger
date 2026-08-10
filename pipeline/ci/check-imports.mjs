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
import { stripComments, REGEX_PREV_OK } from './check-dead-exports.mjs';   // ONE home for comment-stripping + the division-vs-regex rule

const HERE = path.dirname(fileURLToPath(import.meta.url));

// The pipeline CLI entrypoints. Their imports are checked; the files themselves are NEVER executed
// (guarded ones like screen-flip-niches.mjs/sync-fills.mjs AND unguarded ones like quote/watch/analyze alike — the
// static parse means guardedness is irrelevant to safety here).
// PLAN-LIB-SUBDIRS chunk 0: this was a hardcoded list of 11 commands, so the other ~19 (read-book.mjs,
// read-schedule.mjs, derive-cash.mjs, …) had NO static import check — a broken import in one could reach
// main and only surface when Ben ran the command. The lib-subdir reorg rewrites specifiers across every
// command, which makes that gap far likelier to bite, so the list is now the whole directory: any new
// command is covered automatically and never needs registering here.
// Run the CLI work ONLY when invoked directly. `unboundConstantsIn` is exported for
// pipeline/test/check-imports-scanner.test.mjs, and importing a guard must not run it (or exit).
const IS_MAIN = pathToFileURL(process.argv[1] || '/').href === import.meta.url;
const ENTRYPOINTS = IS_MAIN ? fs.readdirSync(path.join(HERE, '..', 'commands'))   // HERE=pipeline/ci; '..' -> pipeline/
  .filter(f => f.endsWith('.mjs')).sort()
  .map(f => path.join(HERE, '..', 'commands', f)) : [];

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

/* Reduce a module to the text where a BARE identifier reference can legitimately appear: comments gone,
 * string literals and template STATIC text blanked, regex literals blanked, template `${…}` interiors
 * KEPT (they hold real code) — and recursively cleaned, so a string inside an interpolation is blanked too.
 *
 * THREE DRAFTS, THREE DISTINCT FAILURES — all pinned, because each was invisible without a targeted test:
 *   1. A regex sweep for `${…}` used [^{}]* and could not match NESTED braces, silently dropping
 *      `${liveAgeTag(x, { freshMin: QUICK_FRESH_MIN })}` — the exact expression whose crash motivated
 *      this guard. It passed the defect it was written for.
 *   2. Hand-rolled scanning with NO regex-literal state. A `/` beginning a regex was walked char by char,
 *      so a quote or backtick inside it (`.replace(/"/g, …)`, `/['"]/`, `/https?:\/\//`) opened a phantom
 *      string/template and everything to EOF went unscanned — with no warning, since the reference count
 *      just silently dropped. Shapes that trigger it already exist in tracked code.
 *   3. Template interiors were kept VERBATIM, so a string inside one (`${c ? 'NOT_LISTED' : ''}`) was
 *      read as code and reported as an unbound constant.
 * Failure 2 is why this delegates comment-stripping to check-dead-exports.mjs's regex-aware
 * `stripComments` and imports its `REGEX_PREV_OK` rather than re-deriving the division-vs-regex rule.
 * That module's own header documents the same lesson from its own earlier bug; a second copy of this
 * knowledge is what produced failure 2 in the first place. */
// Keywords after which a `/` starts a REGEX, not a division. `REGEX_PREV_OK`'s single-char entries can
// never express these (see the regex-start branch below).
const KEYWORD_BEFORE_REGEX = new Set(['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'do', 'else', 'yield', 'await']);

function codeOnly(src) {
  const noComments = stripComments(src);       // comments gone; strings/templates/regexes intact & verbatim
  const n = noComments.length;
  let out = '', i = 0, prevSig = '';
  const scanTemplate = () => {                 // at noComments[i] === '`'
    i++;
    while (i < n) {
      const c = noComments[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { i++; return; }
      if (c === '$' && noComments[i + 1] === '{') {
        i += 2; let depth = 1; const start = i;
        while (i < n && depth > 0) {           // find the interior's extent, brace-depth aware
          const d = noComments[i];
          if (d === '`') { scanTemplate(); continue; }          // nested template — skip past it wholesale
          if (d === '{') depth++;
          else if (d === '}') { depth--; if (depth === 0) break; }
          i++;
        }
        out += ' ' + codeOnly(noComments.slice(start, i)) + ' ';  // RECURSE: clean the interior's own literals
        i++;                                                       // consume the closing '}'
        continue;
      }
      i++;                                     // static text — dropped
    }
  };
  while (i < n) {
    const c = noComments[i];
    if (c === "'" || c === '"') {              // string literal — dropped entirely
      const q = c; i++;
      while (i < n && noComments[i] !== q) { if (noComments[i] === '\\') i++; i++; }
      i++; out += ' '; prevSig = ')'; continue;
    }
    if (c === '`') { scanTemplate(); prevSig = ')'; continue; }
    // Regex-start detection. `REGEX_PREV_OK` holds single characters PLUS the word 'return' — but both
    // consumers only ever set `prevSig` to a single char, so the 'return' entry is unreachable there and
    // `return /"/.test(s)` was misread as DIVISION: the `"` then opened a phantom string and the rest of
    // the file went unscanned. That is the same silent-blinding failure the delegation to `stripComments`
    // was supposed to have ended. Keyword-before-regex is therefore checked explicitly, by word.
    if (c === '/' && (REGEX_PREV_OK.has(prevSig) || KEYWORD_BEFORE_REGEX.has((out.match(/([A-Za-z$_][\w$]*)\s*$/) || ['', ''])[1]))) {
      i++; let inClass = false;
      while (i < n) {
        const e = noComments[i]; i++;
        if (e === '\\') { i++; continue; }
        if (e === '[') inClass = true; else if (e === ']') inClass = false;
        else if (e === '/' && !inClass) break;
      }
      out += ' '; prevSig = ')'; continue;
    }
    out += c;
    if (!/\s/.test(c)) prevSig = c;
    i++;
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
  // PARAMETER LISTS, catch params, labels and class fields. None of these existed in the first version,
  // whose header nevertheless CLAIMED to bind parameters — so `function f(MAX_X)`, `catch (SOME_ERR)`,
  // `OUTER: … continue OUTER`, and `static MAX_FIELD = 3` were all reported as unbound. Every one is a
  // FALSE POSITIVE, i.e. a mysterious CI failure on correct code, which is a worse outcome than a missed
  // detection: it trains people to distrust the guard. Deliberately OVER-binding here — a slightly weaker
  // check that never cries wolf beats a sharper one that does.
  for (const d of clean.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) bound.add(d[1]);
  for (const d of clean.matchAll(/(?:^|[;{}])\s*([A-Z][A-Z0-9_]*)\s*:(?!:)/gm)) bound.add(d[1]);   // labels
  for (const d of clean.matchAll(/\bstatic\s+([A-Za-z_$][\w$]*)/g)) bound.add(d[1]);               // class fields
  // Parameter lists: `(…) =>`, `method(…) {`. The lookbehind is LOAD-BEARING — without it this also
  // matched `if (X) {`, `while (X) {`, `switch (X) {`, `for (…) {`, none of which BINDS anything. Because
  // `bound` is one Set per file, a single `if (SOME_CONST > 3) {` anywhere silently bound SOME_CONST for
  // the WHOLE file and masked a genuine unbound use of it — i.e. one `if` could switch this guard off for
  // the exact defect it exists to catch. Verified by probe: masked with the `if` present, detected without.
  for (const d of clean.matchAll(/(?<!\b(?:if|while|switch|for|catch|with)\s*)\(([^()]*)\)\s*(?:=>|\{)/g))
    for (const id of d[1].matchAll(/[A-Za-z_$][\w$]*/g)) bound.add(id[0]);
  for (const d of clean.matchAll(/\bfunction\b[^(]*\(([^()]*)\)/g))
    for (const id of d[1].matchAll(/[A-Za-z_$][\w$]*/g)) bound.add(id[0]);
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

/* unboundConstantsIn(src) → [names] used but never imported/declared. EXPORTED so the guard's own
   behaviour is pinned by a real test (pipeline/test/check-imports-scanner.test.mjs) rather than only by
   the CLI's aggregate pass/fail. Three earlier drafts of this scanner each shipped broken and each was
   "verified" by running the CLI and seeing green — the aggregate says nothing about WHICH shapes are
   detected, so every known failure shape is now an assertion. */
export function unboundConstantsIn(src) {
  const bound = boundConstants(src);
  // Drop `import … from …` AND `export … from …` statements. An imported name in its own clause is a
  // BINDING, not a reference. A RE-EXPORT (`export { X } from './y.mjs'`) is neither — it creates no local
  // binding and is not a use, so counting it produced four false positives in `js/estimators/pair.mjs`
  // the moment this check was pointed outside `pipeline/commands/`.
  const code = codeOnly(src).replace(/\b(?:import|export)\b[^;]*?\bfrom\b[^;]*;/g, ' ');
  const seen = new Set(), out = [];
  for (const hit of code.matchAll(CONST_RE)) {
    const name = hit[0];
    if (seen.has(name)) continue;
    // Skip member accesses (`x.MAX_Y`, `x?.MAX_Y`, and the spaced `x . MAX_Y`) and object-literal keys
    // (`MAX_Y:`, `MAX_Y :`). `case MAX_Y:` looks identical to a key but IS a real reference — it was the
    // one false NEGATIVE in this heuristic, so it is excluded from the key skip explicitly.
    const before = code.slice(Math.max(0, hit.index - 8), hit.index);
    if (/\.\s*$/.test(before)) continue;
    const after = code.slice(hit.index + name.length);
    if (/^\s*:(?!:)/.test(after) && !/\bcase\s+$/.test(before)) continue;
    seen.add(name);
    if (!bound.has(name)) out.push(name);
  }
  return { unbound: out, checked: seen.size };
}

let unbound = 0, checkedConsts = 0;
for (const entry of ENTRYPOINTS) {
  const rel = path.relative(HERE, entry);
  let src; try { src = fs.readFileSync(entry, 'utf8'); } catch { continue; }
  const r = unboundConstantsIn(src);
  checkedConsts += r.checked;
  for (const name of r.unbound) { console.error(`✗ ${rel}: uses '${name}' but never imports or declares it (ReferenceError at runtime)`); unbound++; }
}

if (IS_MAIN) {
  if (failures || unbound) {
    if (failures) console.error(`\n✗ import-check FAILED — ${failures} unresolved import(s) across ${ENTRYPOINTS.length} entrypoint(s).`);
    if (unbound) console.error(`\n✗ unbound-constant check FAILED — ${unbound} SCREAMING_SNAKE name(s) used without a binding.`);
    process.exit(1);
  }
  console.log(`✓ import-check passed — ${checkedImports} named/default import(s) across ${ENTRYPOINTS.length} entrypoint(s) all resolve.`);
  console.log(`✓ unbound-constant check passed — ${checkedConsts} SCREAMING_SNAKE reference(s) all bound.`);
}
