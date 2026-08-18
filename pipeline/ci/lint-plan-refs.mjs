#!/usr/bin/env node
/* lint-plan-refs.mjs — the PLAN REFERENCE gate.
 *
 * WHY: `plans/` is the one doc tree with NO existence guard — lint-arch.mjs skips every `PLAN-*.md`
 * token as a transient working doc, so a plan can be deleted while live source and governed docs
 * still point at it and every check stays green.
 *
 * WHAT it enforces — a RATCHET over deletions, not a verdict on past ones. Every plan token in a
 * scanned file must resolve to a file in `plans/` or be listed in the FOLDED baseline
 * (`plan-folded.json`); names dangling when the baseline was seeded are grandfathered as provenance
 * tags. What the guard stops is the NEXT one.
 *
 * NOT SCANNED: CHANGELOG.md and docs/LORE.md (the dated record, where naming a folded plan is the
 * job), `pipeline/test/` and `pipeline/experiments/` (synthetic fixture names), and this file.
 *
 * HONEST LIMITS: a token match, not a link checker — it answers "is anything still pointing here?",
 * never "does this plan still matter?". That judgement is the reader's, which is what `--refs` is
 * for: run it BEFORE deleting. `--collisions` reads HEADINGS, TABLE CELLS and dashed-or-numbered
 * BULLETS across `plans/` + the root `PLAN.md`, and requires a digit in the id, so alphabetic ids
 * (`F-A`) are invisible to it. UNDER-REPORTING is the failure mode to watch, and it has bitten this
 * mode TWICE: reading two of the declaration forms hid a three-way clash on `AC1`, and scanning only
 * `plans/` hid five more (incl. `O1`) by skipping the corpus's biggest declarer. Widen the reader
 * before trusting a clean run — the count is a floor, never a total.
 * Full design + limits: README's `lint-plan-refs.mjs` entry, the ONE home.
 *
 * CLI:
 *   node pipeline/ci/lint-plan-refs.mjs                   every reference resolves (CI mode)
 *   node pipeline/ci/lint-plan-refs.mjs --refs X          every file referencing plan X
 *   node pipeline/ci/lint-plan-refs.mjs --unused          plans nothing outside plans/ points at
 *   node pipeline/ci/lint-plan-refs.mjs --collisions      chunk ids reused across plans (report)
 *   node pipeline/ci/lint-plan-refs.mjs --bless --force   record folds into the baseline
 *
 * `--bless` refuses to add a name without `--force` and lists each it would add: otherwise the
 * reflex fix for a red build is to re-bless, which is how a bad deletion gets laundered green.
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
export const unwrap = txt => txt.replace(/-[ \t]*\r?\n[ \t]*(?:\*|\/\/|#)?[ \t]*/g, '-');

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

// A chunk id as PLANS actually write them: AC1, DT4b, AF5b, V2-P4a, MT-V2/2. The DIGIT requirement is
// the false-positive filter — it drops prose headings ("Status", "Chunks", "Wave") without a wordlist,
// at the cost of the purely alphabetic ids the header names as invisible.
const CHUNK_ID = '[A-Z][A-Za-z0-9]*(?:[-/][A-Za-z0-9]+)*';
const HEADING_RE = new RegExp(`^#{2,5}\\s+\\**\\s*(${CHUNK_ID})\\b`);
// Leading cell OR a later one: PLAN-DIGEST-SIGNAL-AND-SCAN-PERF writes `| | **SP5-code** | …`, so
// anchoring on the FIRST cell alone misses a declaration table whose first column is a spacer.
const TABLE_RE = new RegExp(`^\\|(?:\\s*\\|)*\\s*\\**\\s*(${CHUNK_ID})\\s*\\**\\s*\\|`);
// Chunk lists are written FOUR ways in this corpus, and a guard that reads a subset under-reports
// while its own header claims coverage: PLAN-PERF-1H-ARCHIVE declares AC1–AC6 as dashed bullets
// alone, so omitting that form hid a genuine three-way clash on AC1, and PLAN-REACH-CALIBRATION
// numbers its list (`5. **AC4a — …`). The trailing dash is the filter that keeps both bullet forms
// from matching ordinary prose.
const BULLET_RE = new RegExp(`^\\s*(?:[-*]|\\d+\\.)\\s*\\**\\s*(${CHUNK_ID})\\**\\s*[—–-]\\s`);
const isChunkId = id => id.length <= 14 && /[0-9]/.test(id) && !id.startsWith('PLAN-');

/** Every chunk id ONE plan's text declares, in any of the four declaration forms. */
export function chunkIdsIn(text) {
  const out = new Set();
  for (const line of text.split('\n')) {
    const m = HEADING_RE.exec(line) || TABLE_RE.exec(line) || BULLET_RE.exec(line);
    if (m && isChunkId(m[1])) out.add(m[1]);
  }
  return out;
}

/**
 * id -> Set(plan names declaring it), across every plan on disk PLUS the root `PLAN.md`.
 * PLAN.md is the master plan + scoreboard and the single biggest declarer of chunk ids (~99 of
 * them), and it is precisely the document the collision footer tells you cannot disambiguate a bare
 * id — so scanning only `plans/` answered the question against a corpus it had not read, and hid
 * five genuine cross-document clashes including `O1`, which CLAUDE.md cites bare as F1's gate.
 * Memoised: the report needs the map twice (the clash list and the id total).
 */
let CHUNK_IDS_CACHE = null;
function chunkIds() {
  if (CHUNK_IDS_CACHE) return CHUNK_IDS_CACHE;
  const byId = new Map();
  const declare = (plan, text) => {
    for (const id of chunkIdsIn(text)) {
      if (!byId.has(id)) byId.set(id, new Set());
      byId.get(id).add(plan);
    }
  };
  for (const f of fs.readdirSync(PLANS).filter(f => f.endsWith('.md'))) {
    declare(f.slice(0, -3), fs.readFileSync(path.join(PLANS, f), 'utf8'));
  }
  try { declare('PLAN.md (root)', fs.readFileSync(path.join(ROOT, 'PLAN.md'), 'utf8')); } catch { /* absent → plans/ only */ }
  CHUNK_IDS_CACHE = byId;
  return byId;
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

  if (argv.includes('--collisions')) {
    const clashes = [...chunkIds()].filter(([, plans]) => plans.size > 1)
      .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
    console.log(`chunk ids declared by more than one plan — ${clashes.length} of ${chunkIds().size} ids, across ${exist.size} plans + the root PLAN.md\n`);
    for (const [id, plans] of clashes) console.log(`  ${id.padEnd(10)} ${plans.size}x  ${[...plans].sort().join(' · ')}`);
    if (!clashes.length) console.log('  (none — every chunk id is unique across plans/)');
    console.log('\nReport only, never gating. A bare id in a commit message or a PLAN.md row cannot');
    console.log('disambiguate these; pick a plan-unique prefix (docs/PLANNING.md, chunk design rules).');
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
