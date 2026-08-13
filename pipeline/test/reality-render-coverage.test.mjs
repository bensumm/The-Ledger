#!/usr/bin/env node
/**
 * reality-render-coverage.test.mjs — PLAN-DIURNAL-RECENCY-GUARD Chunk 2b coverage guard.
 *
 * WHY THIS FILE EXISTS. Chunk 2 shipped `realityClause` and enumerated three surfaces to render it
 * on. That enumeration was incomplete in a way no existing test could see: on the screen surface it
 * tagged the RECOMMENDATION (`formatTimedLap`'s ASK/BID bits), and on read-window-range it tagged the
 * WINDOW HEADER (`PEAK window … ⚠ spike-top`) — leaving that surface's own `→ BID … · ASK …`
 * recommendation line, and `/schedule`'s Level column, bare. The live cost (2026-08-12): a
 * `Green dragon leather` exit of 1,904 was quoted off two different bare lines while the profile
 * block two screens up already tagged 1,904 `⚠ spike-top (3/14d · p86 · typical ~1,828)`. The ask
 * never printed and the lot went underwater.
 *
 * So the failure mode is a MISSED CALL SITE, not wrong logic — and the only thing that catches a
 * missed call site is a coverage assertion over the call sites. §A is that structural scan (same
 * philosophy as check-daemon-safety.mjs / check-imports.mjs: a cheap source-level guard over a class
 * of omission). §B pins the pure behaviour the render depends on, using the real GDL shape.
 *
 * §A is deliberately a SOURCE SCAN and not a render assertion: these are console commands that do
 * live fetches, so there is no fixture path to their stdout in CI. A source scan cannot prove the
 * clause renders correctly — §B and the manual run do that — but it does prove the call site was not
 * deleted or "simplified", which is the regression this file is here to prevent.
 *
 * WHAT THIS FILE DOES **NOT** COVER — read before trusting it. It is a fixed set of regexes over four
 * named files. It cannot ENUMERATE the surfaces that print a diurnal level, so it cannot notice a new
 * one, and it does not today reach `emit.mjs:203-204`'s `also ASK`/`also BID` secondary clause or
 * `js/trends.js`'s Trends-tab reference lines (both of which still render a level with no clause —
 * logged in plans/PLAN-DIURNAL-RECENCY-GUARD.md §10 "Still bare"). Do not describe this guard as
 * proving every surface is covered; it proves the call sites listed BELOW were not removed.
 *
 * NON-VACUITY. Every §A assertion that targets a NEW call site fails against `git show HEAD:` copies
 * of the four files §A scans. Exactly three §A assertions are before/after invariants that pass on
 * both sides by design — they exist to catch a FUTURE deletion, not this diff — and they are named,
 * not counted: (1) the `→ BID/ASK` line exists at all; (2) the ASK-leg ⚠⚠ wording survived the BID-leg
 * fix; (3) Chunk 2's own `formatTimedLap` clauses are intact. §B exercises `computeReality` /
 * `realityClause`, which this diff does not modify, so it passes either way; its job is pinning the
 * live numbers, not proving non-vacuity.
 *
 * The count is deliberately ABSENT from this paragraph. Three consecutive review rounds found a
 * hard-coded assertion count here wrong — it was re-derived by hand each time the section changed and
 * drifted every time (most recently "ten … three" when §A had grown to fourteen assertions). A number
 * maintained by hand in prose next to code that changes is a claim that will keep going stale; naming
 * the exceptions is stable because adding an assertion cannot silently invalidate it.
 *
 * Run: `node pipeline/test/reality-render-coverage.test.mjs` (exits non-zero on any failure).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeReality, realityClause } from '../../js/windowread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let n = 0;
function ok(name, fn) { fn(); n++; console.log('  ✓ ' + name); }

// ── §A — call-site coverage ────────────────────────────────────────────────────────────────────
const rwr = read('pipeline/commands/read-window-range.mjs');
const sched = read('pipeline/commands/read-schedule.mjs');
const emit = read('pipeline/lib/render/emit.mjs');

ok('read-window-range: the → BID/ASK recommendation line carries both reality clauses', () => {
  const line = rwr.split('\n').find(l => l.includes('→ BID ${fmt(dr.bid)}'));
  assert.ok(line, 'the → BID/ASK recommendation line moved or was renamed — re-point this guard');
  assert.ok(/askRCShort/.test(line), '→ ASK lost its reality clause (Chunk 2b regression)');
  assert.ok(/bidRCShort/.test(line), '→ BID lost its reality clause (Chunk 2b regression)');
});

ok('read-window-range: the BID clause stays gated on bidBasis (the repriced-bid guard)', () => {
  // LOAD-BEARING, not defensive. deriveDiurnalRange reprices `bid` to the live instasell when the dip
  // is not below live (js/windowread.mjs:1367-1372) while `ask` passes through untouched (:1376). The
  // dip's `reality` describes profile.dip.level, so on a repriced row attaching it would label the
  // live price with the dip level's conditions — the very defect this guard exists to prevent.
  assert.ok(/bidBasis === 'live'\s*\?\s*''/.test(rwr),
    "the bidBasis === 'live' gate on the BID reality clause was removed — a repriced bid would be tagged with the dip level's reality");
});

ok('read-window-range: the ⚠⚠ cushion composite is side-aware', () => {
  // Anchor on the emitted STRINGS, not on a slice around a phrase — the first draft of this guard
  // anchored on `indexOf('price-to-sell-EARLY trigger')`, which matched the explanatory COMMENT above
  // the code and then scanned the wrong window. A guard that reads a comment and calls it coverage is
  // the same class of error this whole chunk is about.
  assert.ok(/rm\.side === 'bid'/.test(rwr),
    "the ⚠⚠ composite lost its side branch — it would print a price-to-sell-EARLY instruction under a --bid (reachMargin's cushion is side-flipped, js/windowread.mjs:756)");
  assert.ok(/FILL-side warning, not a sell trigger/.test(rwr),
    'the bid-leg wording is gone — a negative cushion on a bid means the low never reached your bid, not "sell early"');
  assert.ok(/this is the price-to-sell-EARLY trigger \("ACT on the fade"\)/.test(rwr),
    'the ask-leg wording was lost while fixing the bid leg');
});

ok('read-window-range: the recent-N menu level carries its reality clause on BOTH sides', () => {
  // Only the recent-N level is annotated: `~50% of days` / `~75%` / `every day` ARE quantiles of the
  // same distribution (quantHigh header, js/windowread.mjs:31-32), so tagging them would restate the
  // label. The recent-N level is fitted over a different window and can be a spike-top against the
  // full one — which is the level that was actually misquoted.
  assert.ok(/recent-\$\{RECENT_NIGHTS\} ~50%: \$\{fmt\(v\)\}\$\{rc/.test(rwr), 'BID-side recent-N level lost its reality clause');
  assert.ok(/recent-\$\{RECENT_NIGHTS\} ~50%: \$\{fmt\(as\.recent50\)\}\$\{rqaRC/.test(rwr), 'ASK-side recent-N level lost its reality clause');
});

ok('read-schedule: the Level column is reality-marked, and the mark skips repriced dips', () => {
  assert.ok(/levelFlagged\(r\) \? ' \*'/.test(sched), "/schedule's Level column lost its reality mark");
  assert.ok(/const levelFlagged = r => [^\n]*!r\.repriced/.test(sched),
    'levelFlagged dropped the !r.repriced term — a repriced dip level would be tagged with the un-repriced level\'s reality');
  assert.ok(/quote the typical, not the level/.test(sched),
    'the /schedule legend no longer names each flagged level with its typical — the number must travel with its condition');
});

ok('emit.mjs formatTimedLap keeps the Chunk 2 clauses it already shipped', () => {
  assert.ok(/realityClause\(lap\.peakReality/.test(emit) && /realityClause\(lap\.dipReality/.test(emit),
    'formatTimedLap lost a reality clause (Chunk 2 regression)');
});

ok('hourProfile attaches reality to the SECONDARY windows, not just the primaries', () => {
  // The `·2` rows were structurally unflaggable until 2026-08-12: only peakObj/dipObj got a `reality`,
  // so every consumer that marks flagged levels certified the secondary as clean. /schedule printed
  // `SELL peak·2 1,916` bare next to `SELL peak 1,904 *` while 1,916 was ALSO a spike-top. A partial
  // mark is worse than none — it converts "unknown" into "checked and fine".
  const wr = read('js/windowread.mjs');
  assert.ok(/prominenceFrac: cand\.prominenceFrac,[\s\S]{0,200}?reality: computeReality\(clusterDays\(c\.set\)/.test(wr),
    'buildSecondary stopped attaching `reality` — every ·2 row becomes permanently unflaggable');
});

// ── §B — behaviour, on the REAL 2026-08-12 Green dragon leather daily highs ─────────────────────
// These are the verbatim per-day window HIGHS from the live run that produced the miss (oldest→newest),
// not a representative synthetic. That distinction matters: an earlier cut of this fixture used a
// monotone ramp with a constant 60gp range, which reached `spikeTop` for a SIMILAR reason rather than
// the real one and put typicalLevel at 1,860 instead of the real 1,828. A fixture that is merely
// spike-top-shaped cannot tell you the guard would have caught THIS case.
// ASK-SIDE ONLY: `low` is a filler (computeReality reads only `hi` for side 'ask'), so nothing here
// pins bid-side behaviour — windowread.test.mjs owns that.
const gdlHighs = [1864, 1890, 1812, 1979, 1855, 1880, 1854, 1817, 1808, 1807, 1889, 1904, 1910, 1828];
const gdlDays = gdlHighs.map((hi, i) => [`2026-07-${String(29 + i).padStart(2, '0')}`, { low: null, hi }]);

ok('computeReality reproduces the live 1,904 spike-top read exactly', () => {
  const r = computeReality(gdlDays, 1904, 'ask');
  // Pinned against what the SHIPPED console line printed on 2026-08-12:
  //   "recent level 1,904 ⚠ spike-top (reached 3/14d · p86 · typical ~1,828)"
  // Pinning the exact numbers (not just `spikeTop === true`) is what makes this a regression fixture
  // rather than a shape test — a constant drift that moved typical off 1,828 would pass the weaker form.
  assert.equal(r.reachedDays, 3, 'fixture drifted: 1,904 was reached on exactly 3 of 14 days');
  assert.equal(r.nDays, 14);
  assert.equal(Math.round(r.placement * 100), 86, 'placement must reproduce the live p86');
  assert.equal(r.typicalLevel, 1828, 'typicalLevel must reproduce the live ~1,828');
  assert.equal(r.spikeTop, true, '1,904 on the real series must flag spikeTop — this is the live miss');
});

ok('realityClause short style renders the level AND its typical (the form the fix pastes)', () => {
  const txt = realityClause(computeReality(gdlDays, 1904, 'ask'), { side: 'ask', fmt: String, style: 'short' });
  assert.ok(/spike-top/.test(txt), 'short clause must name the flag');
  assert.ok(/~\d/.test(txt), 'short clause must carry the typical level — the number is the point');
});

ok('a clean level renders NOTHING, so every caller stays byte-identical', () => {
  // The whole design depends on this: every call site appends unconditionally and the clause
  // self-suppresses. If this ever returns a non-empty string for a clean level, all five call sites
  // above start emitting noise on every row.
  const clean = computeReality(gdlDays, 1820, 'ask');
  assert.equal(clean.spikeTop, false);
  assert.equal(realityClause(clean, { side: 'ask', fmt: String, style: 'short' }), '');
  assert.equal(realityClause(null, { side: 'ask', fmt: String, style: 'short' }), '');
});

console.log(`\n✓ reality-render-coverage: all ${n} checks passed.`);
