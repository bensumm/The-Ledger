#!/usr/bin/env node
/* lint-plan-refs.mjs — the PLAN REFERENCE gate.
 *
 * WHY: `plans/` is the one doc tree with NO existence guard. lint-arch.mjs governs only
 * ARCHITECTURE.md/GLOSSARY.md, and it explicitly skips every `PLAN-*.md` token as a transient
 * working doc — so a plan can be deleted while live source and governed docs still point at it,
 * and every check stays green. Deleting a shipped plan is the routine end of its lifecycle
 * (docs/PLANNING.md), which is exactly why the dangling pointer is easy to leave behind.
 *
 * WHAT it enforces — a RATCHET over deletions, not a verdict on past ones. Every plan token in a
 * scanned file must resolve to a file in `plans/`, or already be listed in the FOLDED baseline
 * (`plan-folded.json`). Names dangling when the baseline was seeded are grandfathered: those plans
 * shipped and folded, and their names survive in code as provenance tags. What the guard stops is
 * the NEXT one — delete a plan something still points at and its name is not in the baseline, so
 * the build goes red naming every referencing file.
 *
 * NOT SCANNED, and why: CHANGELOG.md and docs/LORE.md are the dated record, where naming a folded
 * plan is the job. `pipeline/test/` and `pipeline/experiments/` hold synthetic fixture names
 * (PLAN-OPEN, PLAN-X) and dated findings. This file is skipped too — its own prose names plans.
 *
 * HONEST LIMITS: a token match, not a link checker. It cannot tell a load-bearing pointer from a
 * passing mention, so it answers "is anything still pointing here?", never "does this plan still
 * matter?" — that judgement stays with the reader, which is what `--refs` is for: run it before
 * deleting and read what comes back. A bare prefix written on purpose ("the PLAN-REACH family")
 * reads as its own plan name and needs a baseline line like any other. Chunk ids inside a plan
 * (AC1, DT3) are NOT checked; ids collide across plans and resolving them needs semantics this
 * guard lacks.
 *
 * CLI:
 *   node pipeline/ci/lint-plan-refs.mjs             every reference resolves (CI mode)
 *   node pipeline/ci/lint-plan-refs.mjs --refs X    list every file referencing plan X
 *   node pipeline/ci/lint-plan-refs.mjs --unused    plans nothing outside plans/ points at
 *   node pipeline/ci/lint-plan-refs.mjs --bless --force   record folds into the baseline
 *
 * `--bless` refuses to add a name without `--force`, and lists each one it would add. Folding a
 * plan is deliberate, so acknowledging it should be too — otherwise the reflex fix for a red
 * build is to re-bless, which is precisely how a bad deletion would get laundered green.
 *
 * CONSTRAINTS (checks.yml, /ship §4): fast, offline, deterministic, public-log-safe, no
 * ~/.runelite, no secrets, no network, static-only (reads sources as text, never imports them).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const PLANS = path.join(ROOT, 'plans');
const BASELINE = path.join(HERE, 'plan-folded.json');

// Directories with no authority over what must exist: caches, deps, agent scratch, worktrees.
const SKIP_DIRS = new Set(['.git', 'node_modules', '.cache', 'jobs', 'worktrees', 'test', 'experiments']);
const UNSCANNED = new Set(['CHANGELOG.md', 'docs/LORE.md', 'pipeline/ci/lint-plan-refs.mjs']);

const PLAN_RE = /PLAN-[A-Z0-9]+(?:-[A-Z0-9]+)*/g;
const TEXT_RE = /\.(mjs|js|md|json|ya?ml|cmd|html)$/;
// A long name wraps mid-token in a comment ("PLAN-SCREEN-" / " * ARCHITECTURE"), and each half
// then reads as its own plan. Rejoin across the break before matching, so the token seen is the
// one the author wrote. Only PLAN- prefixed matches are kept, so joining every trailing hyphen is
// harmless — no other wrapped word can become a plan name.
const unwrap = txt => txt.replace(/-[ \t]*\r?\n[ \t]*(?:\*|\/\/|#)?[ \t]*/g, '-');

/** Every scannable repo file, repo-relative and sorted for deterministic output. */
function sources() {
  const out = [];
  const walk = dir => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(rel); }
      else if (TEXT_RE.test(e.name) && !UNSCANNED.has(rel)) out.push(rel);
    }
  };
  walk('');
  return out.sort();
}

/** name -> Set(files referencing it), across every scanned file. */
function referenceGraph(files) {
  const refs = new Map();
  for (const f of files) {
    const txt = unwrap(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    for (const name of txt.match(PLAN_RE) || []) {
      if (!refs.has(name)) refs.set(name, new Set());
      refs.get(name).add(f);
    }
  }
  return refs;
}

const onDisk = () => new Set(fs.readdirSync(PLANS).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)));
const loadFolded = () =>
  new Set(fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')).folded : []);

function main() {
  const argv = process.argv.slice(2);
  const files = sources();
  const refs = referenceGraph(files);
  const exist = onDisk();
  const folded = loadFolded();

  const wanted = argv[argv.indexOf('--refs') + 1];
  if (argv.includes('--refs') && wanted) {
    const name = wanted.replace(/^plans\//, '').replace(/\.md$/, '');
    const cited = [...(refs.get(name) || [])].filter(f => f !== `plans/${name}.md`).sort();
    const outside = cited.filter(f => !f.startsWith('plans/'));
    console.log(`${name} — ${exist.has(name) ? 'on disk' : 'NOT on disk'} · ${cited.length} referencing file(s), ${outside.length} outside plans/`);
    for (const f of cited) console.log(`  ${f.startsWith('plans/') ? ' ' : '!'} ${f}`);
    if (!cited.length) console.log('  (nothing references it — safe to delete)');
    return;
  }

  if (argv.includes('--unused')) {
    const dead = [...exist].sort().filter(n =>
      ![...(refs.get(n) || [])].some(f => !f.startsWith('plans/')));
    console.log(`plans with no reference outside plans/ — ${dead.length} of ${exist.size}\n`);
    for (const n of dead) {
      const peers = [...(refs.get(n) || [])].filter(f => f !== `plans/${n}.md`).length;
      console.log(`  ${n.padEnd(38)} cited by ${peers} peer plan(s)`);
    }
    console.log('\nNot a delete list — a shortlist. Read each with --refs before removing it.');
    return;
  }

  const dangling = [...refs.keys()].filter(n => !exist.has(n) && !folded.has(n)).sort();

  if (argv.includes('--bless')) {
    if (dangling.length && !argv.includes('--force')) {
      for (const n of dangling) console.error(`✗ would ADD ${n} — referenced by ${[...refs.get(n)].sort().join(', ')}`);
      console.error(`\n✗ bless refused — ${dangling.length} name(s) would be recorded as folded. Confirm each plan really is folded (its content re-homed), then re-run with --force.`);
      process.exit(1);
    }
    const out = [...new Set([...folded, ...dangling])].sort();
    fs.writeFileSync(BASELINE, `${JSON.stringify({ folded: out }, null, 2)}\n`);
    for (const n of dangling) console.log(`  + folded ${n}`);
    console.log(`✓ plan-folded baseline written — ${out.length} folded name(s), ${dangling.length} added.`);
    return;
  }

  if (dangling.length) {
    for (const n of dangling) {
      console.error(`✗ ${n} — no plans/${n}.md, not in the folded baseline · referenced by: ${[...refs.get(n)].sort().join(', ')}`);
    }
    console.error(`\n✗ plan-refs FAILED — ${dangling.length} dangling plan reference(s). Restore the plan, re-home the reference, or (once its content genuinely lives elsewhere) record the fold with --bless --force.`);
    process.exit(1);
  }
  const cited = [...refs.keys()].filter(n => exist.has(n)).length;
  console.log(`✓ plan-refs passed — ${refs.size} plan reference(s) across ${files.length} file(s) all resolve (${cited} of ${exist.size} plans cited, ${folded.size} folded).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
