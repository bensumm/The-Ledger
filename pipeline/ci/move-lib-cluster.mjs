#!/usr/bin/env node
/* move-lib-cluster.mjs — PLAN-LIB-SUBDIRS chunk 0: the mechanical cluster-mover.
 *
 * WHY: `pipeline/lib/` is being regrouped into concept subdirectories one cluster at a time. Each move
 * rewrites every import specifier that names a moved file — across ~30 commands, ~50 libs, ~120 test
 * references, PLUS a `../../js/` depth-bump on ~24 lib files. Doing that by hand, six more times, is the
 * highest-volume error source in the plan, and `check-imports.mjs` only covers 11 of ~30 entrypoints
 * (and never parses `export … from`), so a missed rewrite CAN reach main undetected. This script does the
 * `git mv` + the rewrite mechanically.
 *
 * THE KEY DESIGN CHOICE — rewrite by RESOLVED PATH, never by pattern-matching import "cases". For every
 * relative specifier in the tree we resolve it to an absolute path and compare against the moved set. If it
 * names a moved file, we recompute the specifier from the importer's (possibly also-moved) directory to the
 * file's new location. That is correct-by-construction for all six edge cases the plan enumerates —
 * in-cluster siblings, outside-in, moved-importing-stayed, the external `js/` depth-bump, and the
 * second depth-bump when an already-moved file's target moves in a LATER chunk — with no case-specific
 * logic that could miss one by omission.
 *
 * Handles `export … from` / `export * from` as well as `import … from` (the two barrel shims
 * pipeline/lib/estimators.mjs + rating.mjs are re-export-only — check-imports.mjs's import-only parser
 * has exactly this blind spot).
 *
 * SCOPE: moves files, rewrites specifiers, runs the two mechanical guards, prints a review summary.
 * It NEVER commits, and it never infers cluster membership — the file list is a human decision per the
 * plan's "Ambiguous calls" section. Doc/skill prose pointers (README, ARCHITECTURE, GLOSSARY, skills)
 * stay a manual step — they're judgment about what to SAY, not path substitution.
 *
 * Run: node pipeline/ci/move-lib-cluster.mjs <cluster> <file.mjs> [...more]
 *      node pipeline/ci/move-lib-cluster.mjs --dry-run render cli.mjs emit.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');            // HERE=pipeline/ci
const LIB = path.join(ROOT, 'pipeline', 'lib');

// Trees walked for importers. Covers lib (incl. already-created cluster subdirs — the second-depth-bump
// case), every command/test/ci/probe/daemon, and js/ (an app module could in principle name a lib file).
const SCAN_ROOTS = ['js', 'pipeline'].map(d => path.join(ROOT, d));
const SKIP_DIRS = new Set(['node_modules', '.cache', '.git']);
const SRC_EXT = /\.(mjs|js)$/;

function walk(dir, out = []) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, out); }
    else if (e.isFile() && SRC_EXT.test(e.name)) out.push(p);
  }
  return out;
}

/* Every relative `from '…'` specifier in src, as {specifier, index, length} against the ORIGINAL string.
   Matches `import … from`, `export … from`, `export * from`, and bare side-effect `import '…'`.
   Comments are stripped for DETECTION only (offsets are preserved by blanking, never by deleting) so a
   commented-out import is not rewritten but every real offset still lines up with the source. */
export function relativeSpecifiers(src) {
  // blank out comments in-place (same length) so indices stay valid against the original source
  const clean = src
    .replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
  const out = [];
  const push = (spec, idx) => out.push({ specifier: spec, index: idx, length: spec.length });
  // `import … from '…'` / `export … from '…'` / `export * from '…'`. The specifier is the LAST thing in
  // each match, so its offset within the match is an exact lastIndexOf — no re-scan of the source needed.
  const re = /\b(?:import|export)\b[^;]*?\bfrom\b\s*['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(clean)) !== null) push(m[1], m.index + m[0].lastIndexOf(m[1]));
  // bare side-effect import: import '…';
  const reBare = /\bimport\s*['"](\.[^'"]+)['"]/g;
  while ((m = reBare.exec(clean)) !== null) push(m[1], m.index + m[0].lastIndexOf(m[1]));
  // de-dupe: the bare-import regex also matches the head of a `import x from '…'` statement in some shapes
  const seen = new Set();
  return out.filter(s => { const k = s.index + ':' + s.specifier; if (seen.has(k)) return false; seen.add(k); return true; });
}

// POSIX-style relative specifier from a file's DIRECTORY to a target file, always './'- or '../'-prefixed.
export function specifierFrom(fromDir, toAbs) {
  let rel = path.relative(fromDir, toAbs).split(path.sep).join('/');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const rest = argv.filter(a => a !== '--dry-run');
  const [cluster, ...files] = rest;

  if (!cluster || !files.length) {
    console.error('usage: node pipeline/ci/move-lib-cluster.mjs [--dry-run] <cluster> <file.mjs> [...more]');
    process.exit(2);
  }
  if (!/^[a-z][a-z0-9-]*$/.test(cluster)) {
    console.error(`✗ cluster name '${cluster}' must be lowercase kebab (it becomes pipeline/lib/<cluster>/).`);
    process.exit(2);
  }

  // --- Step 1: validate the move set BEFORE touching anything -------------------------------------
  const destDir = path.join(LIB, cluster);
  const moves = [];   // { base, oldAbs, newAbs }
  let bad = 0;
  for (const f of files) {
    const base = path.basename(f);
    if (base !== f) { console.error(`✗ '${f}' — pass a bare basename (the file must be at pipeline/lib/ root).`); bad++; continue; }
    const oldAbs = path.join(LIB, base);
    const newAbs = path.join(destDir, base);
    if (!fs.existsSync(oldAbs)) { console.error(`✗ pipeline/lib/${base} does not exist (already moved?).`); bad++; continue; }
    if (fs.existsSync(newAbs)) { console.error(`✗ pipeline/lib/${cluster}/${base} already exists — refusing to overwrite.`); bad++; continue; }
    moves.push({ base, oldAbs, newAbs });
  }
  if (bad) { console.error(`\n✗ aborted — ${bad} invalid file argument(s); nothing moved.`); process.exit(1); }

  const byOldAbs = new Map(moves.map(m => [m.oldAbs, m]));

  console.log(`PLAN-LIB-SUBDIRS — moving ${moves.length} file(s) into pipeline/lib/${cluster}/${dryRun ? '  [DRY RUN]' : ''}`);
  for (const m of moves) console.log(`  lib/${m.base}  ->  lib/${cluster}/${m.base}`);

  // --- Step 2: compute every specifier rewrite (resolve-and-compare, not case-matching) -----------
  // Done BEFORE the move so resolution is against the pre-move tree; the map above is the source of truth
  // for where each moved file ENDS UP.
  const allFiles = SCAN_ROOTS.flatMap(r => walk(r));
  const edits = [];   // { file, updated, changes:[{from,to}] }

  for (const file of allFiles) {
    const src = fs.readFileSync(file, 'utf8');
    const specs = relativeSpecifiers(src);
    if (!specs.length) continue;

    // If this importer is itself moving, its future directory is the new one.
    const selfMove = byOldAbs.get(file);
    const importerDirAfter = selfMove ? path.dirname(selfMove.newAbs) : path.dirname(file);

    const changes = [];
    // Apply right-to-left so earlier indices stay valid.
    let updated = src;
    const ordered = specs.slice().sort((a, b) => b.index - a.index);
    for (const s of ordered) {
      if (s.index < 0) continue;
      // Resolve against the importer's CURRENT directory (pre-move) — that's what the specifier means today.
      let targetAbs = path.resolve(path.dirname(file), s.specifier);
      if (!fs.existsSync(targetAbs)) {
        const withMjs = targetAbs + '.mjs', withJs = targetAbs + '.js';
        targetAbs = fs.existsSync(withMjs) ? withMjs : fs.existsSync(withJs) ? withJs : targetAbs;
      }
      // Where will that target live after this move?
      const targetMove = byOldAbs.get(targetAbs);
      const targetAbsAfter = targetMove ? targetMove.newAbs : targetAbs;

      const want = specifierFrom(importerDirAfter, targetAbsAfter);
      if (want === s.specifier) continue;
      // Sanity: only rewrite when the resolved target is real (a pre-existing broken specifier is not ours to fix).
      if (!fs.existsSync(targetAbs)) continue;

      updated = updated.slice(0, s.index) + want + updated.slice(s.index + s.length);
      changes.push({ from: s.specifier, to: want });
    }
    if (changes.length) edits.push({ file, updated, changes });
  }

  // --- Report -------------------------------------------------------------------------------------
  const totalChanges = edits.reduce((n, e) => n + e.changes.length, 0);
  console.log(`\nSpecifier rewrites: ${totalChanges} across ${edits.length} file(s).`);
  for (const e of edits) {
    console.log(`  ${path.relative(ROOT, e.file).split(path.sep).join('/')}`);
    for (const c of e.changes) console.log(`      ${c.from}  ->  ${c.to}`);
  }

  if (dryRun) { console.log('\n[DRY RUN] nothing written. Re-run without --dry-run to apply.'); return; }

  // --- Step 3: apply — git mv first, then write the rewrites ---------------------------------------
  fs.mkdirSync(destDir, { recursive: true });
  for (const m of moves) {
    const r = spawnSync('git', ['mv', path.relative(ROOT, m.oldAbs), path.relative(ROOT, m.newAbs)], { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) {
      console.error(`✗ git mv failed for ${m.base}: ${(r.stderr || '').trim()}`);
      console.error('  Working tree may be partially moved — inspect with `git status` before retrying.');
      process.exit(1);
    }
  }
  for (const e of edits) fs.writeFileSync(e.file, e.updated);
  console.log(`\n✓ moved ${moves.length} file(s) and rewrote ${totalChanges} specifier(s).`);

  // --- Step 4: verification (mechanical guards only; the rest is the recipe's step 3) --------------
  let failed = 0;
  for (const guard of ['check-imports.mjs', 'run-tests.mjs']) {
    console.log(`\n--- ${guard} ---`);
    const r = spawnSync(process.execPath, [path.join(HERE, guard)], { cwd: ROOT, encoding: 'utf8' });
    process.stdout.write(r.stdout || '');
    process.stderr.write(r.stderr || '');
    if (r.status !== 0) failed++;
  }

  console.log('\nNEXT (manual, same commit — no guard enforces these):');
  console.log('  · README.md "Map of the repo" entries -> the new lib/' + cluster + '/ paths');
  console.log('  · docs/ARCHITECTURE.md + docs/GLOSSARY.md path references (lint-arch DOES enforce these)');
  console.log('  · grep .claude/skills/*.md for the moved basenames (no guard checks these)');
  console.log('  · spot-run any touched command outside check-imports\' 11 entrypoints');

  if (failed) {
    console.error(`\n✗ ${failed} guard(s) FAILED — tree left as-is for inspection (not auto-reverted).`);
    process.exit(1);
  }
  console.log('\n✓ mechanical guards green. Still run: check-dead-exports, check-daemon-safety, lint-arch, lint-skills, lint-docs.');
}

// main-guard: the pure helpers above are imported by pipeline/test/move-lib-cluster.test.mjs, which must
// NOT trigger a move. Same shape as lint-arch.mjs.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
