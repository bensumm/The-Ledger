#!/usr/bin/env node
/* check-dead-exports.mjs — RC-A guard: no export kept alive ONLY by its own test (2026-07-14).
 *
 * WHY (the root cause, PLAN-ARCH-DOCS-AUDIT Part 5 RC-A): the repo's recurring drift is vestigial
 * "kept for future re-add / until torn out" code — a concept's last real consumer gets deleted but the
 * exported function + its test are left behind, against CLAUDE.md's "git history is the reference" rule.
 * It then rots and inflates every later read/rename. `check-imports.mjs` proves imports RESOLVE (forward:
 * entrypoint → target); this proves the INVERSE — that every export still has a real (non-test) consumer.
 * The motivating instance was `risingPoolFloor` (rising niche deleted, its predicate + RISE_* consts + test
 * left behind) — this guard flags exactly that residue once the last production caller goes, so the fn + its
 * test get removed together. (It drove the 2026-07-14 cleanup, then was itself deleted.)
 *
 * WHAT: a NAME-BASED, comment-stripped, deliberately CONSERVATIVE static scan (a false-positive guard
 * gets disabled, so it biases toward NOT flagging). An owned export E is DEAD iff:
 *   (a) NO non-test file imports E (named import from a relative specifier), AND
 *   (b) E appears at most ONCE in comment-stripped non-test source — i.e. only its own declaration
 *       (any internal use, registry reference, or re-export mention is a 2nd occurrence ⇒ treated LIVE).
 * Split into two buckets: `orphan` = also imported by ≥1 test (kept alive only by its test — the RC-A
 * target) and `unused` = imported by nothing at all. Both fail CI. `export default` and `export * from`
 * are skipped (name-agnostic / pass-through). Name collisions bias toward LIVE (a used name anywhere
 * marks every same-named export live) — a conservative MISS, never a false alarm.
 *
 * ACKNOWLEDGEMENT — inline `@test-only` marker (Ben 2026-07-14): an export intentionally present ONLY
 * for its unit test (a conformance validator, a replay/test harness, a fetch-cache shim) declares that
 * NEXT TO ITSELF — a `// @test-only: <reason>` line immediately above the export, or an inline block
 * comment carrying `@test-only: <reason>` on the export line. The guard skips a marked export. The
 * marker travels with the code on any move/rename (unlike a central list), and the reason is visible
 * to the next reader. A rare case that can't take an inline marker (e.g. a re-export) uses ALLOW below.
 *
 * CONSTRAINTS (checks.yml, /ship §4): fast, offline, deterministic, public-log-safe, no ~/.runelite,
 * no secrets, no network, static-only (never imports the scanned files). Run: node pipeline/check-dead-exports.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SCAN_DIRS = [path.join(ROOT, 'js'), HERE];   // walk() recurses, so `pipeline/` already covers pipeline/lib

// Exports intentionally kept without a current non-test consumer. Each needs a reason; adding a line
// here is the deliberate acknowledgement that this symbol is a public/future API, not accidental residue.
const ALLOW = new Map([
  // (name) => reason. Empty today — populate only with a justification.
]);

const isTest = f => /\.test\.(mjs|js)$/.test(f);

// Robust comment stripper for occurrence-COUNTING over whole source bodies. A naive regex strip
// (fine for import-check, which only ever sees top-of-file import lines) CORRUPTS function bodies: a
// `/*`, `*/`, or `//` inside a string / template / regex literal is not a comment, and template/string
// CONTENTS must survive so an identifier used in code or inside a `${…}` interpolation still counts
// (the STAGES-in-`${STAGES.join('|')}` false-positive that motivated this). Char state machine: strips
// only real comments; passes string/template/regex literals through UNCHANGED.
const REGEX_PREV_OK = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', ';', '+', '-', '*', '%', '<', '>', '~', '^', 'return']);
export function stripComments(src) {
  let out = '', i = 0, prevSig = ''; const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }              // line comment → drop
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; } // block → drop
    if (c === '"' || c === "'" || c === '`') {                                                    // string / template — keep verbatim
      out += c; i++;
      while (i < n) { const e = src[i]; out += e; i++; if (e === '\\') { if (i < n) { out += src[i]; i++; } continue; } if (e === c) break; }
      prevSig = ')'; continue;                                                                    // a literal ends an expression (division, not regex, follows)
    }
    if (c === '/' && REGEX_PREV_OK.has(prevSig)) {                                                // regex literal — keep verbatim
      out += c; i++; let inClass = false;
      while (i < n) { const e = src[i]; out += e; i++; if (e === '\\') { if (i < n) { out += src[i]; i++; } continue; } if (e === '[') inClass = true; else if (e === ']') inClass = false; else if (e === '/' && !inClass) break; }
      prevSig = ')'; continue;
    }
    out += c; if (!/\s/.test(c)) prevSig = c; i++;
  }
  return out;
}
const boundExpr = name => new RegExp(`(?<![\\w$])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`, 'g');

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (ent.name !== 'node_modules' && ent.name !== '.cache') out.push(...walk(p)); }
    else if (/\.(mjs|js)$/.test(ent.name)) out.push(p);
  }
  return out;
}

// Owned NAMED exports of a source file: export const/let/var/function/class NAME, and export { a, b as c }
// (records the EXPORTED name — what an importer uses). Skips `export default`, `export * from`, and
// re-exports `export { … } from '…'` (the name is OWNED by the re-exported module, not here).
export function ownedExports(src) {
  const clean = stripComments(src);
  const names = new Set();
  const declRe = /\bexport\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/g;
  let m; while ((m = declRe.exec(clean)) !== null) names.add(m[1]);
  // export { a, b as c };  — but NOT  export { … } from '…'  (re-export, owned elsewhere)
  const braceRe = /\bexport\s*\{([^}]*)\}(?!\s*from)/g;
  while ((m = braceRe.exec(clean)) !== null) {
    for (const part of m[1].split(',')) {
      const seg = part.trim(); if (!seg) continue;
      const as = seg.split(/\s+as\s+/);
      const exported = (as[1] || as[0]).trim();
      if (/^[A-Za-z_$][\w$]*$/.test(exported)) names.add(exported);
    }
  }
  return names;
}

// Names declared with an inline `@test-only` marker (on the export line, or a comment line just above).
// Scanned from RAW source (markers live in comments, which ownedExports strips). Associates each marker
// with the NEXT export-declaration name within a short window.
// Recognized markers: `@test-only` (exists solely for its unit test) and `@provisional-api` (an intended
// API not yet wired to a surface — MUST cite a tracking item in its reason, else it's just RC-A rot).
export function testOnlyNames(rawSrc) {
  const names = new Set();
  // non-greedy to the NEAREST export after the marker; the window is generous enough for a multi-line
  // reason (markers sit in the comment block immediately above their export, so the nearest export is it).
  const re = /@(?:test-only|provisional-api)\b[\s\S]{0,700}?\bexport\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/g;
  let m; while ((m = re.exec(rawSrc)) !== null) names.add(m[1]);
  return names;
}

// Named imports from RELATIVE specifiers (reuses import-check's clause parse — the EXPORTED name before `as`).
export function namedImports(src) {
  const clean = stripComments(src);
  const names = new Set();
  const re = /\bimport\b([^;]*?)\bfrom\b\s*['"](\.[^'"]+)['"]/g;
  let m; while ((m = re.exec(clean)) !== null) {
    const brace = m[1].match(/\{([\s\S]*)\}/);
    if (!brace) continue;
    for (const part of brace[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  return names;
}

function main() {
const files = [...new Set(SCAN_DIRS.flatMap(walk).map(f => path.resolve(f)))];
const nonTest = files.filter(f => !isTest(f));
const tests = files.filter(isTest);

// per-file cached comment-stripped source (for occurrence counting) + import sets
const stripped = new Map(nonTest.map(f => [f, stripComments(fs.readFileSync(f, 'utf8'))]));
const importedByNonTest = new Set();
for (const f of nonTest) for (const n of namedImports(fs.readFileSync(f, 'utf8'))) importedByNonTest.add(n);
const importedByTest = new Set();
for (const f of tests) for (const n of namedImports(fs.readFileSync(f, 'utf8'))) importedByTest.add(n);

// occurrence count of a bare identifier across all non-test comment-stripped source
function nonTestOccurrences(name) {
  const re = boundExpr(name);
  let total = 0;
  for (const s of stripped.values()) { const mm = s.match(re); if (mm) total += mm.length; }
  return total;
}

const orphan = [], unused = [];
for (const f of nonTest) {
  const rel = path.relative(ROOT, f);
  const raw = fs.readFileSync(f, 'utf8');
  const testOnly = testOnlyNames(raw);
  for (const name of ownedExports(raw)) {
    if (ALLOW.has(name) || testOnly.has(name)) continue;   // acknowledged (inline @test-only marker or ALLOW)
    if (importedByNonTest.has(name)) continue;          // (a) a real consumer imports it → live
    if (nonTestOccurrences(name) > 1) continue;          // (b) referenced beyond its own declaration → live
    (importedByTest.has(name) ? orphan : unused).push({ name, rel });
  }
}

if (orphan.length || unused.length) {
  for (const o of orphan) console.error(`✗ ORPHAN export '${o.name}' (${o.rel}) — imported ONLY by a test; no production consumer. Wire it, delete it (+ its test), or mark it '@test-only: <reason>' if it exists solely for its test.`);
  for (const u of unused) console.error(`✗ UNUSED export '${u.name}' (${u.rel}) — imported by nothing and referenced nowhere in non-test source. Delete it, un-export it, or mark it '@test-only: <reason>'.`);
  console.error(`\n✗ dead-export-check FAILED — ${orphan.length} orphan + ${unused.length} unused export(s) across ${nonTest.length} source file(s).`);
  process.exit(1);
}
console.log(`✓ dead-export-check passed — every export across ${nonTest.length} source file(s) has a non-test consumer.`);
}

// Run the scan only when invoked directly, so a test can import the pure helpers above (stripComments,
// ownedExports, namedImports, testOnlyNames) without triggering a full-tree scan / process.exit.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
