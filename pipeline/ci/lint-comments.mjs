#!/usr/bin/env node
/* lint-comments.mjs — the COMMENT DOCTRINE ratchet.
 *
 * THE DOCTRINE (owner ruling): a comment describes the code AS IT IS NOW, plus whatever context an
 * LLM needs to interpret it efficiently — the contract, the units, the invariant, the one-line
 * "this was measured and failed, don't rebuild it" pointer. HISTORY IS NOT A COMMENT. Dated
 * narratives ("corrected 2026-08-09", "this line used to read X", per-field provenance logs) belong
 * in CHANGELOG.md, which is the ONE home for how the code got here.
 *
 * WHY a guard: prose in this repo outweighs code, and comment bloat is self-reinforcing — each
 * correction appends a dated clause rather than rewriting the claim, so headers grow monotonically
 * and the load-bearing contract gets buried in provenance. Two structural proxies catch that class
 * without any semantic judgement:
 *   (1) DATED REFERENCES — a `YYYY-MM-DD` inside a comment is, essentially always, history.
 *   (2) BLOCK LENGTH — a contiguous comment run past ~40 lines is a document, not a comment.
 *
 * WHAT it enforces — a RATCHET, not a cliff. Existing debt is grandfathered at its current count in
 * `comment-budget.json`; a file may only ever improve. That makes a long cleanup safe (no regression
 * while it proceeds) without blocking work on files nobody is cleaning yet. A file ABSENT from the
 * baseline is NEW code and must meet the doctrine outright (NEW_FILE_CAPS below).
 *
 * HONEST LIMITS (a line-shape heuristic, not a parser). A leading line counts as comment when it
 * matches /^\s*(\/\/|\/\*|\*)/, so a `//`-looking line inside a template literal can be miscounted
 * (measured: zero such lines in this repo). Dated TRAILING comments are counted too — not counting
 * them would make `code(); // 2026-08-09 this used to be 2` the obvious evasion the moment the
 * leading budget bites. Known remaining evasions, none silent-proof:
 *   · narrative with NO date is invisible on the dated axis (block length is the only backstop);
 *   · one genuinely blank line every N lines splits a block and halves the block metric.
 * Neither is worth a parser. This measures MAGNITUDE, never meaning — it cannot tell a good 39-line
 * contract header from a bad one, only stop them growing. Do NOT grow it into a semantic/LLM check
 * (same standing constraint as lint-docs.mjs / check-daemon-safety.mjs).
 *
 * The block cap suits ordinary modules; a schema/ledger module legitimately needs a longer contract
 * block, which the per-file ratchet accommodates but a genuinely NEW such module would not — expect
 * to bless one deliberately rather than shrinking a real contract to fit.
 *
 * CLI:
 *   node pipeline/ci/lint-comments.mjs            check against the baseline (CI mode)
 *   node pipeline/ci/lint-comments.mjs --report   print the worst offenders, never fail
 *   node pipeline/ci/lint-comments.mjs --bless    rewrite the baseline to current counts
 *   node pipeline/ci/lint-comments.mjs --bless --force   also allow ceilings to go UP
 *
 * `--bless` is how a cleanup pass lowers the ratchet: clean a file, re-bless, and the new lower
 * count becomes the ceiling. It only ever writes counts already true on disk, and it REFUSES to
 * raise a ceiling without `--force` — otherwise the instinctive response to a red build (re-bless)
 * would launder the regression that turned it red.
 *
 * CONSTRAINTS (checks.yml, /ship §4): fast, offline, deterministic, public-log-safe, no ~/.runelite,
 * no secrets, no network, static-only (reads sources as text, never imports them).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const BASELINE = path.join(HERE, 'comment-budget.json');

// Production surfaces. Tests carry explanatory prose by design and are not budgeted.
const ROOTS = ['js', 'pipeline/lib', 'pipeline/commands', 'pipeline/ci', 'pipeline/daemons', 'pipeline/probes'];
const SKIP_RE = /\.test\.mjs$/;

// A file absent from the baseline is new: it must meet the doctrine, not inherit someone else's debt.
const NEW_FILE_CAPS = { dated: 2, block: 40 };

const COMMENT_LINE_RE = /^\s*(\/\/|\/\*|\*)/;
const DATED_RE = /20[0-9]{2}-[0-9]{2}-[0-9]{2}/;
// A date inside a QUOTED span in a comment is example data, not narrative — a guard documenting the
// input it declines ("2026-08-08 — `X` does not bind") must be able to quote one. Strings are stripped
// before the date test for the same reason check-daemon-safety.mjs preserves them: quoting is evidence
// about the code, not a claim about when the code changed.
const QUOTED_RE = /"[^"]*"|'[^']*'|`[^`]*`/g;
const hasDate = line => DATED_RE.test(line.replace(QUOTED_RE, ''));

// A trailing `code(); // note` is a comment too, and NOT counting it would make it the obvious place
// to put narrative once the leading-comment budget bites — i.e. the guard would create its own
// evasion. Strings are stripped first so a URL or a date inside a literal is not mistaken for one.
const trailingComment = line => {
  const bare = line.replace(QUOTED_RE, '');
  const i = bare.indexOf('//');
  return i === -1 ? null : bare.slice(i);
};

// DATA PROVENANCE IS NOT HISTORY. A dated line under a `DATA CAVEATS` marker inside the same comment
// block describes the CURRENT contents of a data file on disk — "volDay absent before 2026-08-11" is
// what a joiner needs at the schema to avoid a silently-wrong join, and it cannot move to CHANGELOG
// without losing the reader who needs it. Dates in such a block are exempt; everywhere else a date
// reads as narrative. This is the one place the doctrine's date axis genuinely splits in two.
const CAVEAT_MARKER_RE = /DATA CAVEATS?/;

/** Walk ROOTS for .js/.mjs sources, repo-relative and sorted for deterministic output. */
function sources() {
  const out = [];
  const walk = dir => {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.(js|mjs)$/.test(e.name) && !SKIP_RE.test(e.name)) out.push(rel);
    }
  };
  ROOTS.forEach(walk);
  return out.sort();
}

/** Per-file doctrine metrics: dated history refs in comments, and the longest contiguous comment run. */
function measure(rel) {
  const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
  let dated = 0, block = 0, run = 0, blockAt = 0, runAt = 0, inCaveats = false;
  const datedLines = [];
  lines.forEach((line, i) => {
    if (COMMENT_LINE_RE.test(line)) {
      if (run === 0) { runAt = i + 1; inCaveats = false; }   // a new block clears the caveat scope
      run++;
      if (CAVEAT_MARKER_RE.test(line)) inCaveats = true;
      if (!inCaveats && hasDate(line)) { dated++; datedLines.push(i + 1); }
    } else {
      if (run > block) { block = run; blockAt = runAt; }
      run = 0; inCaveats = false;
      const tail = trailingComment(line);
      if (tail && DATED_RE.test(tail)) { dated++; datedLines.push(i + 1); }
    }
  });
  if (run > block) { block = run; blockAt = runAt; }
  return { dated, block, blockAt, datedLines };
}

const loadBaseline = () =>
  fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : { files: {} };

function main() {
  const argv = process.argv.slice(2);
  const mode = argv.includes('--bless') ? 'bless' : argv.includes('--report') ? 'report' : 'check';

  const files = sources();
  const measured = new Map(files.map(f => [f, measure(f)]));
  const totals = [...measured.values()].reduce(
    (a, m) => ({ dated: a.dated + m.dated, worst: Math.max(a.worst, m.block) }), { dated: 0, worst: 0 });

  if (mode === 'bless') {
    // Record EVERY scanned file, including clean ones — otherwise a file at zero dated refs inherits
    // the looser new-file cap and can silently drift up to it. Dated refs ratchet EXACTLY (a file at
    // zero stays at zero); block length ratchets to max(current, doctrine cap), so an over-budget
    // header is pinned where it is while a compliant file keeps normal room to edit its contract.
    const prev = loadBaseline();
    const out = { files: {} }, raised = [];
    for (const [f, m] of measured) {
      const ceiling = { dated: m.dated, block: Math.max(m.block, NEW_FILE_CAPS.block) };
      const was = prev.files[f];
      if (was && (ceiling.dated > was.dated || ceiling.block > was.block)) {
        raised.push(`${f}: dated ${was.dated}→${ceiling.dated}, block ${was.block}→${ceiling.block}`);
      }
      out.files[f] = ceiling;
    }
    // Refuse to launder a regression. A red build's instinctive fix is to re-bless, which would
    // quietly raise the ceiling past whatever just broke it — so raising is opt-in and always listed.
    if (raised.length && !argv.includes('--force')) {
      for (const r of raised) console.error(`✗ would RAISE ${r}`);
      console.error(`\n✗ bless refused — ${raised.length} ceiling(s) would go UP. The ratchet only lowers. Clean the file, or re-run with --force if the increase is genuinely intended.`);
      process.exit(1);
    }
    fs.writeFileSync(BASELINE, `${JSON.stringify(out, null, 2)}\n`);
    for (const r of raised) console.log(`  ⚠ raised (forced) ${r}`);
    const over = [...measured.values()].filter(m => m.dated || m.block > NEW_FILE_CAPS.block).length;
    console.log(`✓ comment-budget baseline written — ${Object.keys(out.files).length} file(s) pinned, ${over} over doctrine, ${totals.dated} dated ref(s), worst block ${totals.worst}.`);
    return;
  }

  if (mode === 'report') {
    const ranked = [...measured].filter(([, m]) => m.dated || m.block > NEW_FILE_CAPS.block)
      .sort((a, b) => (b[1].dated - a[1].dated) || (b[1].block - a[1].block));
    console.log(`comment-doctrine report — ${ranked.length} file(s) over doctrine of ${files.length} scanned\n`);
    for (const [f, m] of ranked.slice(0, 30)) {
      console.log(`  ${String(m.dated).padStart(3)} dated  block ${String(m.block).padStart(3)} @${m.blockAt}  ${f}`);
    }
    console.log(`\ntotal dated refs in comments: ${totals.dated} · longest block: ${totals.worst}`);
    return;
  }

  const base = loadBaseline();
  const violations = [];
  for (const [f, m] of measured) {
    const b = base.files[f];
    const cap = b ? { dated: b.dated, block: b.block } : NEW_FILE_CAPS;
    const kind = b ? 'ratchet' : 'new-file';
    if (m.dated > cap.dated) violations.push({ f, rule: `${kind}-dated`, msg: `${m.dated} dated history ref(s) in comments, ceiling ${cap.dated} (line${m.datedLines.length > 1 ? 's' : ''} ${m.datedLines.slice(0, 6).join(', ')}${m.datedLines.length > 6 ? ', …' : ''}) — history belongs in CHANGELOG.md` });
    if (m.block > cap.block) violations.push({ f, rule: `${kind}-block`, msg: `longest comment block is ${m.block} lines at :${m.blockAt}, ceiling ${cap.block} — a block this long is a document, not a comment` });
  }

  if (violations.length) {
    for (const v of violations) console.error(`✗ ${v.f} [${v.rule}] ${v.msg}`);
    console.error(`\n✗ comment-doctrine FAILED — ${violations.length} violation(s). Comments describe the code as it is now; dated narrative goes to CHANGELOG.md. After a genuine cleanup, re-baseline with --bless.`);
    process.exit(1);
  }
  const tracked = Object.keys(base.files).length;
  console.log(`✓ comment-doctrine passed — ${files.length} source file(s); ${tracked} grandfathered at or below their ceiling; ${totals.dated} dated ref(s) remain (ratchet only lowers).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
