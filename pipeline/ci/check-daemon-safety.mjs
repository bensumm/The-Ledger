#!/usr/bin/env node
/* check-daemon-safety.mjs — the zero-git guard for the daemon fleet (PLAN-DAEMON-SUBSYSTEM
 * Phase-1, Hardening finding #1 — the CI half the owner approved for Phase 1).
 *
 * WHY: the manager's `if (!d.local) continue` branch (manager.mjs SAFETY INVARIANT) refuses to
 * AUTO-RUN a daemon flagged `local:false`, but it is only as good as the boolean someone set by hand.
 * It does nothing if a future chunk mis-registers `sync-fills.mjs --publish` (the one git-writer) as
 * `local:true`, or copy-pastes the cache-warm entry shape and points its `start()` at the git-push
 * flag. This guard closes that hole STRUCTURALLY at build time — a daemon that is (or could be
 * auto-run) may NEVER touch the git-writer. Same philosophy as lint-docs.mjs / lint-skills.mjs: a
 * cheap, DENYLIST-style structural checker — NEVER a semantic/LLM one.
 *
 * WHAT it forbids, across `pipeline/daemons/registry.mjs` + every `pipeline/daemons/*.mjs`
 * (excluding *.test.mjs): a daemon module must not
 *   (1) IMPORT sync-fills (static `import … from '…sync-fills…'` OR dynamic `import('…sync-fills…')`);
 *   (2) SPAWN/EXEC a git-writer — any `exec`/`execSync`/`execFile`/`execFileSync`/`spawn`/`spawnSync`
 *       call whose argument region references `--publish` (the sync-fills git-push flag) or `sync-fills`;
 *   (3) register the known git-writer as auto-runnable — the `GIT_WRITER` const must stay `local:false`.
 * Requirement (from the plan): any `local:true` daemon — or any module the manager could auto-run —
 * must not do (1)/(2); checks (1)+(2) run over the WHOLE registry so a `local:true` entry that shells
 * or imports sync-fills is caught regardless of where in the file it sits, and (3) pins the const.
 *
 * HONEST LIMITS (a denylist heuristic, not a proof): it keys off the spawn-family call NAME sitting
 * near a `--publish`/`sync-fills` token, and off the literal `import` construct — so an exotically
 * obfuscated shell-out (a git push assembled from concatenated fragments, an aliased child_process fn)
 * could slip past. That is the accepted trade for staying structural + fast + false-positive-free; the
 * manager's runtime `!d.local` branch is the second line of defence, and every registration is a
 * reviewed diff. Do NOT grow this into a semantic/LLM check.
 *
 * String literals are PRESERVED (not stripped) so a real footgun's flag — `execFileSync('node',
 * ['…/sync-fills.mjs','--publish'])` — is visible; only comments are stripped (via check-dead-exports'
 * battle-tested stripComments). That is why the registry's DESCRIPTION strings, which legitimately
 * contain the words "sync-fills.mjs --publish", do NOT trip the guard: no spawn-family call sits next
 * to them, and they are not `import` constructs.
 *
 * CLI: `node pipeline/ci/check-daemon-safety.mjs` scans the real pipeline/daemons dir. `--dir <path>`
 * points it at a synthetic copy — used to PROVE the fail path (a temp registry with an evil
 * `local:true` sync-fills --publish spawn) without committing a fixture.
 *
 * CONSTRAINTS (checks.yml, /ship §4): fast, offline, deterministic, public-log-safe, no ~/.runelite,
 * no secrets, no network, static-only (never imports the scanned daemon modules — only reads them as
 * text). Run: node pipeline/ci/check-daemon-safety.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './check-dead-exports.mjs';   // reuse the string/regex-safe comment stripper

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');                    // pipeline/ci -> repo root
const DEFAULT_DIR = path.join(ROOT, 'pipeline', 'daemons');

// The child_process spawn family — a git-writer can only run in-process by IMPORT or by SHELLING one of these.
const SPAWN_FAMILY = ['execFileSync', 'execFile', 'execSync', 'exec', 'spawnSync', 'spawn'];
// A static OR dynamic import whose specifier names sync-fills. (Descriptions mention "sync-fills.mjs" in
// prose strings, but never inside an `import … from '…'` / `import('…')` construct, so this stays clean.)
const SYNC_IMPORT_RE =
  /\bimport\b[^;\n]*?\bfrom\b\s*['"]([^'"]*sync-fills[^'"]*)['"]|\bimport\s*\(\s*['"]([^'"]*sync-fills[^'"]*)['"]\s*\)/g;
const PUBLISH_RE = /--publish/;
const SYNCFILLS_RE = /sync-fills/;
const SPAWN_WINDOW = 400;   // chars after a spawn-family call name to inspect for the git-push token

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** Scan one daemon module's text for import (1) and spawn/exec (2) violations. Comment-stripped, strings kept. */
function scanFile(file) {
  const src = stripComments(fs.readFileSync(file, 'utf8'));   // strips comments; string/regex literals survive
  const out = [];

  // (1) sync-fills import — a daemon must NEVER import the git-writer.
  SYNC_IMPORT_RE.lastIndex = 0;
  let m;
  while ((m = SYNC_IMPORT_RE.exec(src)) !== null) {
    const spec = m[1] || m[2];
    out.push({
      line: lineOf(src, m.index), rule: 'sync-fills-import',
      msg: `imports the git-writer sync-fills (specifier '${spec}') — a daemon must never import sync-fills.mjs`,
    });
  }

  // (2) spawn/exec of a --publish (or any sync-fills) command — a daemon must never shell a git-writer.
  for (const fn of SPAWN_FAMILY) {
    const re = new RegExp(`\\b${fn}\\s*\\(`, 'g');   // \bexec\s*\( matches exec( but NOT execSync( / execFileSync(
    let mm;
    while ((mm = re.exec(src)) !== null) {
      const win = src.slice(mm.index, mm.index + SPAWN_WINDOW);
      if (PUBLISH_RE.test(win) || SYNCFILLS_RE.test(win)) {
        const what = PUBLISH_RE.test(win) ? '--publish (the sync-fills git-push flag)' : 'sync-fills';
        out.push({
          line: lineOf(src, mm.index), rule: 'spawn-git-writer',
          msg: `${fn}(...) spawns a command referencing ${what} — a daemon must never shell a git-writer`,
        });
      }
    }
  }
  return out;
}

/** (3) Registry-only: the GIT_WRITER const (sync-fills --publish) must stay local:false, never auto-runnable. */
function scanRegistryLocalFlags(file) {
  const src = stripComments(fs.readFileSync(file, 'utf8'));
  const out = [];
  const gw = src.match(/GIT_WRITER[\s\S]{0,800}?local:\s*(true|false)/);
  if (gw && gw[1] === 'true') {
    out.push({
      line: lineOf(src, gw.index), rule: 'git-writer-local-true',
      msg: 'GIT_WRITER (sync-fills --publish) is marked local:true — the git-writer must stay local:false and never be auto-runnable',
    });
  }
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const di = argv.indexOf('--dir');
  const dir = (di >= 0 && argv[di + 1]) ? path.resolve(argv[di + 1]) : DEFAULT_DIR;

  if (!fs.existsSync(dir)) {
    console.error(`✗ daemon-safety: daemons dir not found: ${dir}`);
    process.exit(1);
  }
  const files = fs.readdirSync(dir)
    .filter(f => /\.mjs$/.test(f) && !/\.test\.mjs$/.test(f))
    .sort();

  const relDir = path.relative(ROOT, dir) || dir;
  const violations = [];
  for (const f of files) {
    const file = path.join(dir, f);
    const rel = path.relative(ROOT, file);
    for (const v of scanFile(file)) violations.push({ file: rel, ...v });
    if (f === 'registry.mjs') for (const v of scanRegistryLocalFlags(file)) violations.push({ file: rel, ...v });
  }

  if (violations.length) {
    for (const v of violations) console.error(`✗ ${v.file}:${v.line} [${v.rule}] ${v.msg}`);
    console.error(`\n✗ daemon-safety FAILED — ${violations.length} zero-git violation(s) across ${files.length} daemon module(s) in ${relDir}. A local/auto-runnable daemon must never import or shell the git-writer (sync-fills --publish).`);
    process.exit(1);
  }
  console.log(`✓ daemon-safety passed — ${files.length} daemon module(s) in ${relDir}; none imports or spawns the git-writer (sync-fills --publish), and GIT_WRITER stays local:false.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
