#!/usr/bin/env node
/* check-daemon-safety.mjs — the zero-git guard for the daemon fleet (PLAN-DAEMON-SUBSYSTEM
 * Phase-1, Hardening finding #1 — the CI half the owner approved for Phase 1).
 *
 * WHY: manager.mjs's `if (!d.local) continue` SAFETY INVARIANT refuses to AUTO-RUN a `local:false`
 * daemon, but is only as good as a hand-set boolean — useless if a chunk mis-registers the one
 * git-writer (`sync-fills.mjs --publish`) as `local:true`, or copies the cache-warm entry shape and
 * points `start()` at the git-push flag. This closes that STRUCTURALLY at build time: a daemon that is
 * (or could be) auto-run may NEVER reach the git-writer. Like lint-docs/lint-skills, it is a cheap
 * DENYLIST structural checker — NEVER a semantic/LLM one.
 *
 * SCOPE is REGISTRY-DERIVED: `pipeline/daemons/*.mjs` (minus *.test.mjs) PLUS every `DAEMONS` entry's
 * implementation, resolved `<name>.mjs` against pipeline/daemons/ then pipeline/commands/. An
 * unresolvable name is a HARD FAILURE, so registering or renaming a daemon cannot silently shrink
 * coverage. ⚠ Do NOT narrow this back to a readdir: scope WAS `readdirSync(pipeline/daemons)` while 3
 * of the 4 registered daemons (sync-fills, watch-log, dev-server) live in pipeline/commands/ — a
 * quarter of the fleet read, a clean run reported, watch-log.mjs's static sync-fills import green.
 *
 * WHAT it forbids — a daemon module must not
 *   (1) IMPORT sync-fills (static `… from '…sync-fills…'` or dynamic `import('…sync-fills…')`). For a
 *       registered implementation OUTSIDE pipeline/daemons/ this narrows to the ZERO_GIT_EXPORTS
 *       ALLOWLIST, since watch-log.mjs legitimately reuses the rebuild core in-process; a module
 *       inside pipeline/daemons/ keeps the blanket ban.
 *   (2) SPAWN/EXEC a git-writer — any `exec`/`execSync`/`execFile`/`execFileSync`/`spawn`/`spawnSync`
 *       whose argument region names `sync-fills` or the `git` binary (NOT a bare `--publish`; see the
 *       PUBLISH_RE note — two unrelated commands spell that flag the same way).
 *   (3) register the git-writer as auto-runnable — `GIT_WRITER` must stay `local:false`.
 *   (4) [sync-fills.mjs itself] lose its invocation guard or export outside ZERO_GIT_EXPORTS. Rules
 *       (1)/(2) cannot apply to it — it IS the writer — so (4) pins what makes importing it safe.
 *
 * HONEST LIMITS (a denylist heuristic, not a proof): it keys off the spawn-family call NAME near a
 * `sync-fills`/`git` token and off the literal `import` construct, so an obfuscated shell-out (a push
 * assembled from fragments, an aliased child_process fn) can slip past — the accepted trade for
 * staying structural, fast and false-positive-free, with manager's runtime `!d.local` as the second
 * line of defence. See the stripComments import for why string literals survive the scan.
 *
 * CLI: bare = the real fleet. `--dir <path>` scans a synthetic copy to PROVE a fail path without
 * committing a fixture; `--commands-dir <path>` redirects the registry-derived half too (a bare
 * `--dir` keeps the dir-only behavior the original proof used). pipeline/test/daemon-safety.test.mjs
 * uses both to drive EVERY rule to RED — its header says why that suite must exist.
 * CONSTRAINTS (checks.yml, /ship §4): fast, offline, deterministic, public-log-safe, no ~/.runelite,
 * no secrets, no network, static-only — never imports the scanned modules, only reads them as text.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Strips comments ONLY — string/regex literals survive on purpose, so a real footgun's flag stays
// visible to the scan: `execFileSync('node', ['…/sync-fills.mjs','--publish'])`. That is also why the
// registry's DESCRIPTION strings, which legitimately spell "sync-fills.mjs --publish" in prose, do not
// trip anything — no spawn-family call sits beside them and they are not `import` constructs.
import { stripComments } from './check-dead-exports.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');                    // pipeline/ci -> repo root
const DEFAULT_DIR = path.join(ROOT, 'pipeline', 'daemons');

// The child_process spawn family — a git-writer can only run in-process by IMPORT or by SHELLING one of these.
const SPAWN_FAMILY = ['execFileSync', 'execFile', 'execSync', 'exec', 'spawnSync', 'spawn'];
// A static OR dynamic import whose specifier names sync-fills. (Descriptions mention "sync-fills.mjs" in
// prose strings, but never inside an `import … from '…'` / `import('…')` construct, so this stays clean.)
const SYNC_IMPORT_RE =
  /\bimport\b[^;\n]*?\bfrom\b\s*['"]([^'"]*sync-fills[^'"]*)['"]|\bimport\s*\(\s*['"]([^'"]*sync-fills[^'"]*)['"]\s*\)/g;
const SYNCFILLS_RE = /sync-fills/;
// ⚠ `--publish` ALONE IS NOT A GIT SIGNAL — do not put a bare /--publish/ back here. The flag is spelled
// the same on two unrelated commands: `sync-fills.mjs --publish` fetch/commit/PUSHES, while
// `screen-flip-niches.mjs --publish` only rewrites the local screen.json and never touches git (the
// registry's dev-server entry says so explicitly). A bare match was harmless only while dev-server sat
// outside this guard's scope; the moment scope became registry-derived it failed dev-server's legitimate
// spawn. So the git-writer is identified by NAME — sync-fills — and `--publish` only sharpens the message.
const PUBLISH_RE = /--publish/;
// A daemon shelling git directly would bypass the sync-fills name entirely, so catch the binary too.
const GIT_SPAWN_RE = /['"`]git['"`]|['"`]git\s+(?:push|commit|fetch|merge|add)\b/;
const SPAWN_WINDOW = 400;   // chars after a spawn-family call name to inspect for the git-push token
const COMMANDS_DIR = path.join(ROOT, 'pipeline', 'commands');
// The git-writer's OWN file. It is registered (as its zero-git `--local` mode) but obviously contains
// every git call in the fleet, so rules (1)/(2) cannot apply to it — GIT_WRITER_RULES replace them.
const GIT_WRITER_FILE = path.join(COMMANDS_DIR, 'sync-fills.mjs');
// The only bindings a daemon may import FROM sync-fills. Both are zero-git: `regenerate` is the pure
// log→artifact rebuild, `REPO_DIR` a path constant re-exported from lib/paths.mjs. Everything that
// touches git (syncMainToRemote, the commit/push block) is module-private and reachable only via
// main() — which the invocation guard confines to direct execution. That chain is what makes
// watch-log.mjs's `import { regenerate, REPO_DIR }` safe, so the guard pins every link of it.
const ZERO_GIT_EXPORTS = ['regenerate', 'REPO_DIR'];
// The invocation guard itself (sync-fills.mjs's last line). Without it, importing the module would run
// main() in the IMPORTER's process — and `PUBLISH` is read from that process's argv, so a daemon run
// with --publish would fetch/commit/push. Pinned because deleting one line silently re-arms that.
const INVOCATION_GUARD_RE =
  /import\.meta\.url\s*===\s*pathToFileURL\(\s*process\.argv\[1\]\s*\)\.href\s*\)\s*main\(\)/;

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** The named bindings an `import { a, b } from '…'` statement pulls in, or null for a default/namespace
 *  import — which exposes the whole module surface and so can never be allowlisted. */
function importedBindings(stmt) {
  const braced = stmt.match(/\{([^}]*)\}/);
  if (!braced) return null;                       // `import x from` / `import * as x from`
  return braced[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
}

/** Scan one daemon module's text for import (1) and spawn/exec (2) violations. Comment-stripped, strings kept.
 *  `narrowImports` relaxes rule (1) from "never import sync-fills" to "import only the ZERO_GIT_EXPORTS".
 *  That relaxation is ONLY for registered implementations outside pipeline/daemons/ (watch-log.mjs), which
 *  legitimately reuse the zero-git rebuild core in-process; a module living in pipeline/daemons/ has no
 *  such need, so it keeps the blanket ban and the stricter rule stays the default. */
function scanFile(file, { narrowImports = false } = {}) {
  const src = stripComments(fs.readFileSync(file, 'utf8'));   // strips comments; string/regex literals survive
  const out = [];

  // (1) sync-fills import — a daemon must NEVER import the git-writer.
  SYNC_IMPORT_RE.lastIndex = 0;
  let m;
  while ((m = SYNC_IMPORT_RE.exec(src)) !== null) {
    const spec = m[1] || m[2];
    if (narrowImports) {
      const names = importedBindings(m[0]);
      if (names === null) {
        out.push({
          line: lineOf(src, m.index), rule: 'sync-fills-wide-import',
          msg: `default/namespace-imports sync-fills ('${spec}') — a daemon may only take the named zero-git bindings {${ZERO_GIT_EXPORTS.join(', ')}}`,
        });
        continue;
      }
      const banned = names.filter(n => !ZERO_GIT_EXPORTS.includes(n));
      if (banned.length) {
        out.push({
          line: lineOf(src, m.index), rule: 'sync-fills-import',
          msg: `imports {${banned.join(', ')}} from sync-fills — only the zero-git bindings {${ZERO_GIT_EXPORTS.join(', ')}} are permitted for a daemon`,
        });
      }
      continue;
    }
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
      const syncFills = SYNCFILLS_RE.test(win);
      const bareGit = GIT_SPAWN_RE.test(win);
      if (syncFills || bareGit) {
        const what = syncFills
          ? `sync-fills${PUBLISH_RE.test(win) ? ' --publish (the git-push flag)' : ''}`
          : 'the git binary';
        out.push({
          line: lineOf(src, mm.index), rule: 'spawn-git-writer',
          msg: `${fn}(...) spawns a command referencing ${what} — a daemon must never shell a git-writer`,
        });
      }
    }
  }
  return out;
}

/** (4) The git-writer's own file. Rules (1)/(2) cannot apply — it IS the writer — so what is pinned here is
 *  the pair of properties that let a daemon import it at all:
 *    (a) the invocation guard, so importing never runs main() in the importer's process; and
 *    (b) its export surface, so the zero-git allowlist above cannot silently rot when a future chunk
 *        exports something that does reach git.
 *  Without (a), `PUBLISH` — read from the IMPORTING process's argv — would let `node watch-log.mjs
 *  --publish` fetch, commit and push. */
function scanGitWriter(file) {
  const src = stripComments(fs.readFileSync(file, 'utf8'));
  const out = [];

  if (!INVOCATION_GUARD_RE.test(src)) {
    out.push({
      line: src.split('\n').length, rule: 'missing-invocation-guard',
      msg: 'the git-writer has no `import.meta.url === pathToFileURL(process.argv[1]).href` guard around main() — importing it would run a real sync (and, with --publish in the importer\'s argv, a git push)',
    });
  }

  const exported = new Set();
  for (const mm of src.matchAll(/\bexport\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) exported.add(mm[1]);
  for (const mm of src.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const part of mm[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) exported.add(name);
    }
  }
  if (/\bexport\s+default\b/.test(src)) exported.add('default');
  const extra = [...exported].filter(n => !ZERO_GIT_EXPORTS.includes(n));
  if (extra.length) {
    out.push({
      line: 1, rule: 'git-writer-export-surface',
      msg: `exports {${extra.join(', ')}} beyond the zero-git allowlist {${ZERO_GIT_EXPORTS.join(', ')}} — either it is zero-git (add it to ZERO_GIT_EXPORTS here, deliberately) or a daemon could now reach git through it`,
    });
  }
  return out;
}

/** (5) Registry-derived scope. Every DAEMONS `name:` resolves to `<name>.mjs` in pipeline/daemons/ or
 *  pipeline/commands/. Registering a daemon therefore ENROLLS its implementation automatically, and a
 *  rename fails the build loudly instead of silently dropping the file from coverage — which is exactly
 *  what had happened: scope was a readdir of pipeline/daemons/, so 3 of the 4 registered daemons
 *  (sync-fills, watch-log, dev-server — all implemented in pipeline/commands/) were never read. */
function registeredDaemonFiles(registryFile, daemonsDir, commandsDir = COMMANDS_DIR) {
  const src = stripComments(fs.readFileSync(registryFile, 'utf8'));
  const body = src.slice(src.indexOf('export const DAEMONS'));
  const names = [...body.matchAll(/\bname:\s*'([^']+)'/g)].map(m => m[1]);
  return names.map(name => {
    const candidates = [path.join(daemonsDir, `${name}.mjs`), path.join(commandsDir, `${name}.mjs`)];
    return { name, file: candidates.find(fs.existsSync) || null, candidates };
  });
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

  // Registered implementations living OUTSIDE the scanned dir. Runs in real-repo mode, or under an
  // explicit `--commands-dir` (which is how the tests drive these rules against synthetic fixtures).
  // A bare `--dir` keeps the legacy dir-only behavior so the original fail-path proof still holds.
  const ci = argv.indexOf('--commands-dir');
  const commandsDir = (ci >= 0 && argv[ci + 1]) ? path.resolve(argv[ci + 1]) : COMMANDS_DIR;
  let extraScanned = 0;
  if (dir === DEFAULT_DIR || ci >= 0) {
    const registryFile = path.join(dir, 'registry.mjs');
    for (const { name, file, candidates } of registeredDaemonFiles(registryFile, dir, commandsDir)) {
      if (!file) {
        violations.push({
          file: path.relative(ROOT, registryFile), line: 1, rule: 'unresolved-daemon',
          msg: `registered daemon '${name}' resolves to no implementation (looked for ${candidates.map(c => path.relative(ROOT, c)).join(' , ')}) — it would be silently uncovered by this guard`,
        });
        continue;
      }
      if (files.includes(path.basename(file)) && path.dirname(file) === dir) continue;   // already scanned above
      extraScanned++;
      const rel = path.relative(ROOT, file);
      // By BASENAME, not full path, so a synthetic --commands-dir fixture routes the same way the real
      // tree does — otherwise the tests would exercise a branch production never takes.
      if (path.basename(file) === path.basename(GIT_WRITER_FILE)) {
        for (const v of scanGitWriter(file)) violations.push({ file: rel, ...v });
      } else {
        for (const v of scanFile(file, { narrowImports: true })) violations.push({ file: rel, ...v });
      }
    }
  }

  const total = files.length + extraScanned;
  if (violations.length) {
    for (const v of violations) console.error(`✗ ${v.file}:${v.line} [${v.rule}] ${v.msg}`);
    console.error(`\n✗ daemon-safety FAILED — ${violations.length} zero-git violation(s) across ${total} daemon module(s). A local/auto-runnable daemon must never import or shell the git-writer (sync-fills --publish).`);
    process.exit(1);
  }
  console.log(`✓ daemon-safety passed — ${total} daemon module(s) (${files.length} in ${relDir}${extraScanned ? `, ${extraScanned} registered implementation(s) elsewhere` : ''}); none reaches the git-writer (sync-fills --publish), GIT_WRITER stays local:false, and the git-writer keeps its invocation guard + zero-git export surface.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
