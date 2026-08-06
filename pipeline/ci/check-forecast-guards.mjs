#!/usr/bin/env node
/* check-forecast-guards.mjs — the fail-open-guard pin for diurnalForecast (2026-08-06, the Snape
 * grass miss).
 *
 * WHY: `diurnalForecast` (js/forecast.mjs) opens with three REFUSALS that exist to stop it projecting
 * a shape it cannot model —
 *     ctx.reliable === false                       → 'unreliable-quote'
 *     ctx.phase === 'spike' | 'decay'              → 'post-shock-shape'
 *     ctx.mom === 'breakdown' | 'breakup'          → 'band-violation-live'
 * Every one of those is FAIL-OPEN by construction: `ctx.phase === 'spike'` is simply false when the
 * caller never passed `phase`, so a blind call yields an UNGUARDED projection that renders
 * byte-identically to a guarded one. There is no runtime error and nothing looks wrong.
 *
 * The real cost, 2026-08-06: `read-window-range.mjs` — the MANDATORY verification trio the market-read
 * doctrine routes every quoted price through — passed only `liveLo`/`liveHi` at both of its
 * `driftExitFrom` call sites, so all three refusals were dead there. Snape grass (classified `spike`,
 * mid-decay, exactly the shape 'post-shock-shape' exists to refuse) printed a drift-adjusted peak that
 * marched 1,090 → 1,024 across one day, and it was quoted as decision evidence on a 13.66m position.
 * The other four call sites (screen-flip-niches ×2, quote-items ×2) had always passed the fields; the
 * defect was invisible precisely because the surfaces agreed in FORMAT while disagreeing in RIGOUR.
 *
 * WHAT this forbids: any call to `diurnalForecast(` or `driftExitFrom(` whose ctx argument does not
 * mention `phase`. `phase` is the load-bearing one — it is the guard that fires on the shape class we
 * actually got wrong, and it is derivable for free off a 1h series (js/quotecore.js `phase()`), so
 * there is no honest reason for a caller to omit it. `mom`/`reliable` are NOT required here: some
 * surfaces genuinely do not compute them, and their absence is surfaced at RUNTIME instead by the
 * forecast's `guardsUnchecked` field rendering `⚠ guards unchecked: …` on the drift clause (P1).
 *
 * Same philosophy as lint-docs.mjs / lint-skills.mjs / check-daemon-safety.mjs: a cheap, STRUCTURAL
 * checker over source text — NEVER a semantic/LLM one. It reads the call's argument region and asks
 * one question: does the word `phase` appear in it? A spread of a prepared ctx object (`...guardCtx`)
 * counts, since that is the read-window-range pattern; the object it spreads is checked by the
 * `guardCtx`-shape rule below so the escape hatch can't be used to smuggle an empty object through.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// every source tree that may call the forecast (tests are exempt — they deliberately exercise the
// degrade paths, including the blind-ctx one this guard exists to make visible)
const SCAN_DIRS = ['js', 'pipeline/commands', 'pipeline/lib'];
const GUARDED_CALLS = ['diurnalForecast', 'driftExitFrom'];

// forecast.mjs is where the guards LIVE — its own internal `diurnalForecast(profile, ctx)` call inside
// driftExitFrom forwards a ctx it received, so requiring the literal word there is meaningless.
const EXEMPT = new Set(['js/forecast.mjs']);

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(mjs|js)$/.test(e.name) && !/\.test\.mjs$/.test(e.name)) out.push(p);
  }
  return out;
}

/** the argument region of a call: from the open paren to its matching close (depth-tracked, so nested
 *  object/call parens don't truncate it). Returns '' when unbalanced (a parse we won't guess at). */
function argRegion(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return src.slice(openIdx + 1, i); }
  }
  return '';
}

/** Does this call's ctx carry `phase`? Two accepted forms, because a ctx is legitimately prepared away
 *  from the call:
 *    (a) INLINE  — the literal word appears in the argument region (`{ …, phase: row.phase, … }`, or a
 *        spread of a prepared object `{ ...guardCtx }` whose definition carries it);
 *    (b) BY NAME — the region references an identifier (a spread `...guardCtx`, or a bare `ctx`
 *        parameter as in quote-items' pushTrajectory helper) that is BUILT with `phase` somewhere in the
 *        same file, i.e. `guardCtx = { … phase … }` or `ctx: { … phase … }`.
 *  One level of resolution only — deliberately shallow. This is a structural checker, not a
 *  dataflow analysis; the runtime `guardsUnchecked` marker (P1) is the backstop for anything it
 *  cannot see, so a false PASS here still surfaces on the rendered line rather than vanishing. */
function ctxMentionsPhase(args, src) {
  if (/\bphase\b/.test(args)) return true;
  // every identifier token in the region — a spread (`...guardCtx`) and a bare positional (`ctx`) both
  // land here. Deliberately loose: a spurious identifier can only cause a false PASS, and P1's runtime
  // `guardsUnchecked` marker is the backstop for exactly that.
  const idents = new Set();
  for (const m of args.matchAll(/[A-Za-z_$][\w$]*/g)) idents.add(m[0]);
  for (const id of idents) {
    // `const id = { … phase … }` or `id: { … phase … }` — the two ways a ctx gets built in this repo
    const built = new RegExp(`\\b${id}\\s*[:=]\\s*\\{[^{}]*\\bphase\\b`);
    if (built.test(src)) return true;
  }
  return false;
}

/** blank out comment BODIES, preserving byte offsets and newlines so reported line numbers stay true.
 *  Needed because this repo's doc comments legitimately quote call shapes in prose (`js/estimators/
 *  pair.mjs` documents `driftExitFrom(profile, days, <ctx built from the live pair>, …)` mid-paragraph),
 *  and a prefix-only heuristic can't see that a continuation line sits inside an open block. */
function stripComments(src) {
  let out = '', i = 0;
  while (i < src.length) {
    if (src[i] === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (let k = i; k < stop; k++) out += src[k] === '\n' ? '\n' : ' ';
      i = stop;
    } else if (src[i] === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
    } else { out += src[i]; i++; }
  }
  return out;
}

function scanFile(file) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (EXEMPT.has(rel)) return [];
  const src = stripComments(fs.readFileSync(file, 'utf8'));
  const violations = [];
  for (const fn of GUARDED_CALLS) {
    const re = new RegExp(`\\b${fn}\\s*\\(`, 'g');
    let m;
    while ((m = re.exec(src)) !== null) {
      const openIdx = m.index + m[0].length - 1;
      // skip the definition/import/comment lines — only real CALLS carry a ctx
      const lineStart = src.lastIndexOf('\n', m.index) + 1;
      const linePrefix = src.slice(lineStart, m.index);
      if (/(export\s+)?function\s*$|\*|\/\/|import\s|from\s/.test(linePrefix)) continue;
      const args = argRegion(src, openIdx);
      if (!args) continue;
      if (!ctxMentionsPhase(args, src)) {
        const line = src.slice(0, m.index).split('\n').length;
        violations.push({ line, rule: 'missing-phase-guard', msg: `${fn}(…) ctx does not pass \`phase\` — diurnalForecast's post-shock-shape refusal cannot fire (fail-open)` });
      }
    }
  }
  return violations;
}

function main() {
  const files = SCAN_DIRS.flatMap(d => walk(path.join(ROOT, d)));
  const violations = [];
  let calls = 0;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const fn of GUARDED_CALLS) calls += (src.match(new RegExp(`\\b${fn}\\s*\\(`, 'g')) || []).length;
    for (const v of scanFile(f)) violations.push({ file: path.relative(ROOT, f).replace(/\\/g, '/'), ...v });
  }

  if (violations.length) {
    for (const v of violations) console.error(`✗ ${v.file}:${v.line} [${v.rule}] ${v.msg}`);
    console.error(`\n✗ forecast-guards FAILED — ${violations.length} fail-open call site(s). Pass \`phase\` (js/quotecore.js \`phase()\` derives it free off the in-hand 1h series) so the post-shock-shape refusal can fire.`);
    process.exit(1);
  }
  console.log(`✓ forecast-guards passed — ${calls} guarded call(s) across ${files.length} module(s); every diurnalForecast/driftExitFrom ctx passes \`phase\`.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
