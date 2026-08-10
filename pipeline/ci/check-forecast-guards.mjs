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
 *
 * ---- 2026-08-10: THIS GUARD WAS ITSELF FAIL-OPEN, and this header used to say the opposite ----
 * The paragraph above ended with: "The other four call sites (screen-flip-niches ×2, quote-items ×2)
 * had always passed the fields." That was FALSE, and it is the single most dangerous kind of comment —
 * a verification claim a future reader trusts instead of re-checking. Those sites passed the TEXT
 * `phase: row.phase`, and `computeQuote()` returns no `phase` field (js/quotecore.js `row={…}`, 32
 * keys, none of them `phase`). So the value was `undefined`, `ctx.phase === 'spike'` was false by
 * absence, and the refusal was dead at SEVEN sites — including `screen-flip-niches.mjs`'s amplitude
 * lane, where the projection fed `amplitudeGate({driftMargin})`, i.e. a REAL GATE and not an
 * inform-only note. The v1 guard passed all seven green, because it asked whether the WORD `phase`
 * appeared in the argument region, and `phase: row.phase` contains it twice.
 *
 * WHAT this forbids, in two rules:
 *   (1) MISSING  — a `diurnalForecast(`/`driftExitFrom(` call whose ctx never mentions `phase`.
 *   (2) DEAD     — a ctx that passes `phase: X.phase` where `X` is a QUOTE ROW. This is the value
 *       check the v1 text match could not make. It duck-types `X` by the OTHER properties the file
 *       reads off it: if any of them is a real `computeQuote` key while `phase` is not, then `X.phase`
 *       is provably `undefined` and the guard is dead. Deriving phase is free off the in-hand 6h
 *       series (js/quotecore.js `phase()`), so there is no honest reason to read it off a row.
 *
 * The producer's key set is obtained by CALLING `computeQuote` here, not by parsing or hardcoding it —
 * so if a `phase` field is ever legitimately added to the row, this guard stops objecting on its own
 * rather than becoming the next stale assertion. If that call ever throws, this guard EXITS NONZERO
 * instead of skipping the rule: a probe that cannot see is not a probe that passes. That is the whole
 * lesson of the bug it was built for.
 *
 * Same philosophy as lint-docs.mjs / lint-skills.mjs / check-daemon-safety.mjs: a cheap, STRUCTURAL
 * checker over source text — NEVER a semantic/LLM one. A spread of a prepared ctx object
 * (`...guardCtx`) counts for rule 1, since that is the read-window-range pattern; the object it
 * spreads is resolved one level so the escape hatch can't smuggle an empty object through.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeQuote } from '../../js/quotecore.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/* The REAL shape of a quote row, obtained by calling the producer (see the header: never parsed, never
 * hardcoded, so it self-heals if `phase` is ever genuinely added). computeQuote is pure and tolerates an
 * empty-series input — the values are irrelevant here, only the key set is. A throw is FATAL by design:
 * a probe that cannot see must not report a pass. */
let QUOTE_ROW_KEYS;
try {
  QUOTE_ROW_KEYS = new Set(Object.keys(computeQuote({ id: 0, latest: {}, ts5m: [], ts6h: [], ts1h: [] })));
  if (!QUOTE_ROW_KEYS.size) throw new Error('computeQuote returned no keys');
} catch (err) {
  console.error(`✗ forecast-guards CANNOT RUN — probing computeQuote's shape threw: ${(err && err.message) || err}`);
  console.error('  The dead-phase rule needs the producer\'s real key set. Fix the probe input above; do NOT');
  console.error('  weaken this to skip the rule — a guard that silently stops guarding is the bug it exists for.');
  process.exit(1);
}

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

/** RULE 2 — the VALUE check. Given a call's argument region, find any `phase:` whose value is read off
 *  another object (`X.phase` / `X?.phase`) and decide whether that read is provably dead.
 *
 *  `X` is duck-typed against the producer: gather every property the FILE reads off `X`, and if any of
 *  them is a genuine `computeQuote` key while `phase` is not, `X` is a quote row and `X.phase` is
 *  `undefined`. Duck-typing rather than tracking the binding is deliberate — a row arrives by several
 *  routes (`const row = computeQuote(…)`, `qcache.get(id)`, a `qrow` handed down through three call
 *  layers in the app), and all of them read `.quickBuy`/`.optSell`/`.mom` off the same object.
 *
 *  Anything it cannot positively identify PASSES (e.g. `fwd.phase`, where `fwd` is a forward bundle a
 *  caller built): rule 1 already required the field to be present, and P1's runtime `guardsUnchecked`
 *  marker remains the backstop. This rule's job is to make the ONE proven-dead shape impossible. */
/** the VALUE expression of a `key:` — from after the colon to the next comma/brace at depth 0. Needed
 *  because the value is not always a bare member read: `js/trends.js` shipped the dead read inside a
 *  TERNARY (`phase: qrow ? qrow.phase : null`). A regex anchored right after `phase:` sees nothing
 *  there and passes — which is exactly how the first draft of this rule scored a false green on the
 *  app's own call site, in a guard written to stop false greens. Parse the value, then scan inside it. */
function valueExpr(args, colonIdx) {
  let depth = 0;
  for (let i = colonIdx + 1; i < args.length; i++) {
    const c = args[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) return args.slice(colonIdx + 1, i); depth--; }
    else if (c === ',' && depth === 0) return args.slice(colonIdx + 1, i);
  }
  return args.slice(colonIdx + 1);
}

/** the balanced `{ … }` body of a ctx built AWAY from the call (`const ctx = { … }` / `ctx: { … }`).
 *  Rule 2 has to follow this for the same reason rule 1 does: `js/trends.js` builds its ctx on its own
 *  line and calls `diurnalForecast(prof, ctx)`, so the call's argument region contains no `phase:` at
 *  all and a rule that only scanned the region reported a false PASS on the app's own dead read.
 *
 *  Returns EVERY literal bound to that name in the file, not the first: `js/trends.js` has an unrelated
 *  `const ctx={ history:… }` at :374 and the forecast's real one at :411, and a first-match lookup
 *  resolved to the decoy and reported a false PASS — the second false green this rule produced against
 *  the same call site. A name is not unique in a file; do not assume it is. */
function objLiteralsFor(src, id) {
  const out = [];
  const re = new RegExp(`\\b${id}\\s*[:=]\\s*\\{`, 'g');
  let m;
  while ((m = re.exec(src)) !== null) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { out.push(src.slice(open + 1, i)); break; } }
    }
  }
  return out;
}

function deadPhaseReads(args, src) {
  const out = [];
  const reads = [];
  // scan the call's own argument region AND, one level deep, any ctx object it references by name
  const regions = [args];
  for (const id of new Set([...args.matchAll(/[A-Za-z_$][\w$]*/g)].map(m => m[0]))) {
    for (const body of objLiteralsFor(src, id)) regions.push(body);
  }
  for (const region of regions) {
    for (const k of region.matchAll(/\bphase\s*:/g)) {
      const val = valueExpr(region, k.index + k[0].length - 1);
      for (const r of val.matchAll(/([A-Za-z_$][\w$]*)\s*\??\.\s*phase\b/g)) reads.push(r[1]);
    }
  }
  for (const base of new Set(reads)) {
    const props = new Set();
    for (const p of src.matchAll(new RegExp(`\\b${base}\\s*\\??\\.\\s*([A-Za-z_$][\\w$]*)`, 'g'))) props.add(p[1]);
    props.delete('phase');
    const rowish = [...props].filter(p => QUOTE_ROW_KEYS.has(p));
    if (rowish.length && !QUOTE_ROW_KEYS.has('phase')) out.push({ base, evidence: rowish.slice(0, 3) });
  }
  return out;
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
      const line = src.slice(0, m.index).split('\n').length;
      if (!ctxMentionsPhase(args, src)) {
        violations.push({ line, rule: 'missing-phase-guard', msg: `${fn}(…) ctx does not pass \`phase\` — diurnalForecast's post-shock-shape refusal cannot fire (fail-open)` });
      }
      // rule 2: present but PROVABLY UNDEFINED — the shape that shipped green under the v1 text match
      for (const d of deadPhaseReads(args, src)) {
        violations.push({ line, rule: 'dead-phase-value', msg: `${fn}(…) passes \`phase: ${d.base}.phase\`, but \`${d.base}\` is a quote row (it is also read for ${d.evidence.map(e => '`.' + e + '`').join(', ')}) and computeQuote emits no \`phase\` field — the value is undefined, so the post-shock-shape refusal is dead. Derive it: \`phase(ts6h)?.phase ?? null\`` });
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
    console.error(`\n✗ forecast-guards FAILED — ${violations.length} fail-open call site(s). Pass \`phase\` as a REAL VALUE (js/quotecore.js \`phase()\` derives it free off the in-hand 6h series) so the post-shock-shape refusal can fire.`);
    process.exit(1);
  }
  // The count is deliberately explicit about the value rule: "passes `phase`" was the v1 wording, and it
  // was true of seven call sites that passed `undefined`. Say what was actually verified.
  console.log(`✓ forecast-guards passed — ${calls} guarded call(s) across ${files.length} module(s); every diurnalForecast/driftExitFrom ctx passes \`phase\`, and none reads it off a quote row (checked against computeQuote's ${QUOTE_ROW_KEYS.size} real keys).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
