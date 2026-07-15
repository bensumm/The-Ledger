#!/usr/bin/env node
/**
 * lint-docs.mjs — a STRUCTURAL, offline doc-drift linter (DL1). The CI-encoded half of process
 * rule 8 ("grep the docs for statements the change now supersedes and fix them in place"), which
 * was itself only prose. Two deterministic checks, no semantics, no LLM, no network:
 *
 *   CHECK 1 — DENYLIST (recurrence of NAMED drift). A maintained table of {pattern, files, reason}:
 *     superseded terms/commands banned in the operating docs where they'd mislead. When a ruling
 *     DELETES a concept, the executor adds a line here and CI then catches every future doc that
 *     resurrects it. `xfail` records a KNOWN live violation owned by another plan chunk (so CI stays
 *     green while the finding stays visible) — none currently outstanding (the index.html Scan-intro
 *     copy that PLAN-APP-PARITY AP1 owned has been fixed, so its xfails were retired; index.html now
 *     sits in the `files` list as an actively-guarded home, not an exception).
 *
 *   CHECK 2 — SINGLE-SOURCE / DUPLICATE-PHRASE (the copy-not-move failure on NOVEL rulings). Flags a
 *     distinctive normalized word-shingle that appears VERBATIM in more than one doc on the
 *     CLAUDE.md ⇆ README.md axis (where the "point, don't restate" rule is sharpest) — the "same ruling
 *     in 3-4 homes" pattern (Bar D/E, value rulings) the move-never-copy policy forbids. STRUCTURAL only
 *     (an n-gram fingerprint match),
 *     so it is deterministic with zero false-positive flakiness. `DUP_ALLOWLIST` exempts legitimately
 *     shared boilerplate + the KNOWN pre-existing duplications owned by the later DOC-2/DOC-3 diet
 *     chunks (with a pointer), so CI passes now while the check is LIVE for any new copy-not-move.
 *
 * HONEST LIMITS (rule 4 — do not oversell; this is a lint, not a semantic checker):
 *   - CHECK 1 catches only recurrence of drift its denylist NAMES; it prevents re-introducing a KNOWN
 *     superseded term, never a novel contradiction.
 *   - CHECK 2 catches a novel COPY (verbatim restatement across homes), NOT a novel CONTRADICTION
 *     (two homes that say opposite things in different words). Nothing here replaces the wave-start
 *     Sonnet semantic drift scan — it narrows what that scan must find, it doesn't retire it.
 *
 * Run: `node pipeline/ci/lint-docs.mjs`  (CI runs it in the cheap `checks` job; pinned by lint-docs.test.mjs).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');   // pipeline/ci -> repo root
const read = rel => { try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return null; } };

// CHECK 2's corpus — the CLAUDE.md ⇆ README.md axis, where the single-source rule is sharpest (both
// are meant to POINT to a module header, never restate its spec — the "same ruling in 3-4 homes"
// failure the audit named). Deliberately EXCLUDES: PLAN.md / CHANGELOG.md / docs/LORE.md (history +
// narrative — restatement is their job); the module headers themselves (the legitimate ONE home); and
// the SKILL.md files (they share process-boilerplate + trigger scaffolding BY DESIGN, and are governed
// separately by lint-skills.mjs + the DOC-5 anchor-compression chunk — folding them in here is almost
// all legitimate-shared-boilerplate noise). The DENYLIST (CHECK 1) still scans skills + index.html.
export const POINTER_DOCS = [
  'CLAUDE.md',
  'README.md',
];

/* =============================== CHECK 1 — DENYLIST ==================================== */
// Each entry: { id, pattern, files, reason, xfail? }. `pattern` is a RegExp tested against RAW file
// text (NOT code-stripped — a backticked `--mode spread` presented as runnable IS the drift we want to
// catch). `files` = relpaths the term is BANNED in. `xfail` = { relpath: 'owner — why' } marks a KNOWN
// live violation that must NOT fail CI (owned elsewhere) but is still reported.
// SELF-REFERENCE CAVEAT: because matching is raw, a prose doc that REPRODUCES a banned literal to
// DESCRIBE the denylist will self-trip. So in the human docs (README/CLAUDE.md) describe these by
// CONCEPT ("the deleted spread/rising niches", "the removed mode flags") — the exact literals live
// here in the source, which is in no `files` list.
export const DENYLIST = [
  {
    id: 'niche-spread-rising-live',
    // The deleted niches listed AS LIVE niches (the capitalized "Spread / Rising" niche-enumeration
    // form). Case-sensitive so it does NOT match prose narrating the deletion ("spread/rising were
    // DELETED"). Steps 3+4 (Ben 2026-07-09) deleted both niches.
    pattern: /Spread\s*\/\s*Rising|Rising\s*\/\s*Churn|Band\s*\/\s*Spread/,
    files: ['CLAUDE.md', 'README.md', 'index.html',
            '.claude/skills/scan/SKILL.md', '.claude/skills/positions/SKILL.md',
            '.claude/skills/overnight/SKILL.md', '.claude/skills/morning/SKILL.md'],
    reason: 'spread + rising niches were DELETED (Steps 3+4, 2026-07-09) — do not list them as live niches',
  },
  {
    id: 'falling-excluded-unqualified',
    // The UNQUALIFIED global-exclusion framing, superseded by the per-strategy falling doctrine
    // (Ben 2026-07-08, P5): band/churn exclude, scalp accepts+requires, value knife-guards.
    pattern: /Falling items are excluded/i,
    files: ['CLAUDE.md', 'README.md', 'index.html',
            '.claude/skills/scan/SKILL.md', '.claude/skills/positions/SKILL.md',
            '.claude/skills/overnight/SKILL.md', '.claude/skills/morning/SKILL.md'],
    reason: 'falling-exclusion is PER-STRATEGY now (P5), not global — an unqualified "excluded" is stale',
  },
  // The --mode {spread,rising} bans are scoped to the ROUTING/operating docs + the deployed page —
  // NOT the skills. The scan skill's ONE mention ("`--mode spread` / `--mode rising` now error
  // cleanly") is a CORRECT statement documenting the deletion; banning it there would force deleting a
  // true fact. A doc that PRESENTS either as a runnable command is the drift this catches.
  {
    id: 'mode-spread-cmd',
    pattern: /--mode\s+spread\b/,
    files: ['CLAUDE.md', 'README.md', 'index.html'],
    reason: '`--mode spread` is a DELETED command (Steps 3+4) — the live modes are band|churn|scalp|value|all',
  },
  {
    id: 'mode-rising-cmd',
    pattern: /--mode\s+rising\b/,
    files: ['CLAUDE.md', 'README.md', 'index.html'],
    reason: '`--mode rising` is a DELETED command (Steps 3+4) — the live modes are band|churn|scalp|value|all',
  },
  {
    id: 'value-absgp-rank',
    // The abs-gp value-rank constant (`VALUE_ABSGP_*`) was SUPERSEDED the same day (Ben 2026-07-09) by the
    // deployable-capital multiplier folded into `valueScore` (js/valuescreen.mjs). abs-gp just rewarded
    // "expensive" over the deployable mid-ticket class it was meant to surface. Resurrecting the constant
    // as a live ranking term in an operating doc is the drift. The concept-level history is narrated in
    // docs/LORE.md (not in `files`, so it doesn't self-trip).
    pattern: /VALUE_ABSGP/,
    files: ['CLAUDE.md', 'README.md'],
    reason: '`VALUE_ABSGP_*` is a DELETED value-rank constant — value ranks by the deployable-capital multiplier (js/valuescreen.mjs); history lives in docs/LORE.md',
  },
  {
    id: 'niche-concept-word',
    // R1 rename (2026-07-14, PLAN-RENAME.md): the screen niches band/churn/scalp/value are FLIP-NICHES
    // now; the bare word "niche" is retired as the concept word in the operating docs. ("strategy" is
    // reserved for the held-item level, js/held-item-strategy.mjs.) The lookbehind matches the STANDALONE
    // prose word only — `(?<![\w-])` spares any larger token: `flip-niche`, `flip-niches.mjs`, the
    // `FLIP_NICHES` identifier (underscore), AND camelCase like `validateNicheSpec` (preceding letter).
    // Scoped to the DOCS only — the ~600 code-comment uses are swept opportunistically, so the source
    // tree is NOT listed. The definition + full codename history live in docs/GLOSSARY.md (not in
    // `files`, so it doesn't self-trip). Case-insensitive so a capitalized "Niche" heading is caught too.
    pattern: /(?<![\w-])niche/i,
    files: ['CLAUDE.md', 'README.md', 'docs/ARCHITECTURE.md',
            '.claude/skills/scan/SKILL.md', '.claude/skills/positions/SKILL.md',
            '.claude/skills/overnight/SKILL.md', '.claude/skills/morning/SKILL.md'],
    reason: 'the screen niches are "flip-niches" now (R1 rename, PLAN-RENAME.md) — say flip-niche; "strategy" is the held-item level. Definition: docs/GLOSSARY.md',
  },
];

// Returns [{ id, file, reason, xfail }] — every denylist match. `xfail` is truthy (the owner string)
// when the match is a known-owned live violation that must not fail CI.
export function runDenylist(files = DENYLIST) {
  const hits = [];
  for (const entry of files) {
    for (const rel of entry.files) {
      const text = read(rel);
      if (text == null) continue; // a doc that doesn't exist here can't drift
      if (entry.pattern.test(text)) {
        hits.push({ id: entry.id, file: rel, reason: entry.reason, xfail: entry.xfail?.[rel] || null });
      }
    }
  }
  return hits;
}

/* ==================== CHECK 2 — SINGLE-SOURCE / DUPLICATE-PHRASE ======================= */
export const SHINGLE_WORDS = 14; // a 14-word verbatim run is distinctive enough that incidental
                                 // overlaps (short stock phrases) don't collide; a copied spec
                                 // paragraph produces many overlapping 14-grams.

// Normalized substrings that EXEMPT a flagged duplicate: legitimately-shared boilerplate, plus the
// KNOWN pre-existing 3-4-home duplications owned by the later diet chunks (DOC-2 CLAUDE.md, DOC-3
// README). A flagged shingle whose text CONTAINS any of these is suppressed — keyed on a stable,
// distinctive phrase from each duplicate group so the allowlist stays small and readable.
export const DUP_ALLOWLIST = [
  // --- legitimately shared boilerplate ---
  'co authored by claude',
  'claude session https claude ai code',
  // NOTE: the KNOWN pre-existing Bar D/E + value-ruling + P0/P4b/P6c duplications that used to live here
  // were RESOLVED by DOC-2 (CLAUDE.md diet round 3) + DOC-3 (README compaction) — CLAUDE.md now points to
  // the module headers instead of restating them, so those shingles no longer appear in >1 pointer doc and
  // their allowlist entries were removed. If a future copy-not-move re-introduces one, fix it in place
  // (point, don't restate) rather than re-allowlisting.
];

// Lowercase, strip markdown/backticks/punctuation, collapse whitespace → a flat word array.
export function normalizeWords(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')     // drop fenced code
    .replace(/`[^`]*`/g, ' ')            // drop inline code spans (they carry paths/commands, not prose)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')         // punctuation/markdown → space
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function shingles(words, n = SHINGLE_WORDS) {
  const out = [];
  for (let i = 0; i + n <= words.length; i++) out.push(words.slice(i, i + n).join(' '));
  return out;
}

function isAllowlisted(shingle) {
  return DUP_ALLOWLIST.some(a => shingle.includes(a));
}

// PURE core of CHECK 2: given [{ name, text }], returns [{ shingle, files:[name,...] }] — each
// distinctive word-shingle appearing verbatim in MORE THAN ONE doc and not allowlisted. De-duplicated
// to one representative shingle per contiguous overlapping run per file-set (report the FIRST shingle
// of each run) to keep output terse. File-free so it's unit-testable on synthetic docs.
export function findDuplicateShingles(docs) {
  const shingleToFiles = new Map();     // shingle -> Set(name)
  const perFileShingles = new Map();    // name -> ordered shingle list
  for (const { name, text } of docs) {
    if (text == null) continue;
    const sh = shingles(normalizeWords(text));
    perFileShingles.set(name, sh);
    for (const s of sh) {
      if (!shingleToFiles.has(s)) shingleToFiles.set(s, new Set());
      shingleToFiles.get(s).add(name);
    }
  }
  // Collect cross-file shingles, then collapse contiguous runs (a shingle and the NEXT shingle in the
  // same file that share the same file-set are one copied passage) to a single representative.
  const violations = [];
  const seen = new Set();
  for (const [, sh] of perFileShingles) {
    for (let i = 0; i < sh.length; i++) {
      const s = sh[i];
      const files = shingleToFiles.get(s);
      if (!files || files.size < 2) continue;      // not cross-file
      if (isAllowlisted(s)) continue;
      const key = [...files].sort().join('|') + '::' + s;
      if (seen.has(key)) continue;
      // collapse the run: skip forward while the next shingle shares the exact same file-set
      const fileSetKey = [...files].sort().join('|');
      let j = i;
      while (j + 1 < sh.length) {
        const next = shingleToFiles.get(sh[j + 1]);
        if (next && next.size >= 2 && [...next].sort().join('|') === fileSetKey) j++;
        else break;
      }
      // mark every shingle in the run seen for this file-set so we report it ONCE
      for (let k = i; k <= j; k++) seen.add(fileSetKey + '::' + sh[k]);
      violations.push({ shingle: s, files: [...files].sort() });
      i = j;
    }
  }
  return violations;
}

// File-reading wrapper: read each doc and delegate to the pure core.
export function runDuplicatePhrase(docs = POINTER_DOCS) {
  return findDuplicateShingles(docs.map(rel => ({ name: rel, text: read(rel) })));
}

/* ================================== CLI / main ======================================= */
function main() {
  let failed = 0;

  // CHECK 1
  const denyHits = runDenylist();
  const hardDeny = denyHits.filter(h => !h.xfail);
  const xfailDeny = denyHits.filter(h => h.xfail);
  console.log(`CHECK 1 — denylist: ${DENYLIST.length} rule(s), ${denyHits.length} match(es) (${xfailDeny.length} xfail).`);
  for (const h of xfailDeny) console.log(`  ~ xfail  ${h.file}: [${h.id}] ${h.reason}  (owned: ${h.xfail})`);
  for (const h of hardDeny) console.error(`  ✗ DENY   ${h.file}: [${h.id}] ${h.reason}`);
  if (hardDeny.length) failed += hardDeny.length;

  // CHECK 2
  const dups = runDuplicatePhrase();
  console.log(`CHECK 2 — single-source: ${POINTER_DOCS.length} pointer doc(s) scanned, ${dups.length} non-allowlisted duplicate passage(s).`);
  for (const d of dups) console.error(`  ✗ DUP    in ${d.files.join(' + ')}: "${d.shingle}…"`);
  if (dups.length) failed += dups.length;

  if (failed) {
    console.error(`\n✗ doclint FAILED — ${failed} violation(s). Denylist: a deleted concept resurfaced; add the fix in place. ` +
      `Duplicate: a spec was COPIED into >1 pointer doc — keep ONE home (the module header) + pointers, or allowlist legit shared boilerplate.`);
    process.exit(1);
  }
  console.log('\n✓ doclint passed — no resurrected drift, no copy-not-move duplication in the pointer docs.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
