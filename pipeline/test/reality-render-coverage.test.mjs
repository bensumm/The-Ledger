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
 * CHUNK 2c (2026-08-12) EXTENDS THIS FILE IN TWO DIRECTIONS.
 *   • One more missed RENDER site. Chunk 2 tagged read-window-range's `--profile` window headers and
 *     Chunk 2b its `→ BID/ASK` recommendation — but both of those live inside `if (A.profile !==
 *     undefined)`, while the `diurnal: dip … · peak …` summary only renders when `A.profile ===
 *     undefined`. Mutually exclusive branches: every fix so far missed the one a plain
 *     `--ask`/`--bid`/`--exit` run actually takes, which is the branch the 1,904 exit was read off.
 *     The lesson generalises past this file — "the surface is covered" was true of a branch nobody
 *     had checked was the same branch.
 *   • The WRITE side, which no earlier chunk touched at all. The flag was rendered and then discarded:
 *     `timedLapShadow` and `result.diurnalRange` both serialised the level while copying every SIBLING
 *     qualifier (bidBasis, notes, fitNights, reach splits) and dropping this one. A guard whose firings
 *     are never recorded cannot be scored — no retro could segment flagged rows out, so "is this guard
 *     worth anything" was unanswerable BY CONSTRUCTION, not for want of sample size. §C covers it.
 *
 * WHAT THIS FILE DOES **NOT** COVER — read before trusting it. It is a fixed set of regexes over six
 * named files. It cannot ENUMERATE the surfaces that print a diurnal level, so it cannot notice a new
 * one, and it does not today reach `js/trends.js`'s Trends-tab reference lines (which still render a
 * level with no clause — logged in plans/PLAN-DIURNAL-RECENCY-GUARD.md §10 "Still bare"). Do not
 * describe this guard as proving every surface is covered; it proves the call sites listed BELOW were
 * not removed.
 *   • `emit.mjs`'s `also ASK`/`also BID` secondary clause (cited as `:203-204` in Chunk 2b's write-up;
 *     the fix moved it down the file, which is why this bullet names the SYMBOL and not the line — every
 *     line-number citation added on 2026-08-12 was stale by the end of the same day) was on that
 *     not-covered list until
 *     the reaches-transport fix (2026-08-12) and is now scanned below. Worth reading for the shape of
 *     the bug rather than the fix: the renderer was never the defect. `diurnalTimedLap` built its
 *     `askReaches`/`bidReaches` entries with a fixed four-key shape (level/window/reach/pool) that
 *     dropped `reality`, so R5's secondary read EXISTED on `profile.peaks[1]` and never ARRIVED at the
 *     emit site. A render-site audit could not have found it, which is why the assertion for it scans
 *     BOTH ends — the producer's per-entry field and the consumer's clause.
 * §C is likewise a source scan over the two WRITE sites plus one behavioural assertion on
 * `timedLapShadow`; it does not prove suggestions.jsonl rows in the wild carry the fields (the scan
 * that writes them does live fetches and appends to a pipeline-owned artifact, so it is not run here —
 * that check is the manual run, recorded in the chunk's report).
 *
 * NON-VACUITY. Every §A and §C assertion that targets a NEW call site fails against `git show HEAD:`
 * copies of the files they scan — re-verified for Chunk 2c against `HEAD` = 3b3c72d (EVERY one of its
 * source-scan regexes misses there, in §A and §C alike, and in the emit.mjs/js/windowread.mjs pair the
 * reaches-transport lane added; and HEAD's `timedLapShadow` return has no `peakReality` key at all, so
 * §C's behavioural reshape assertion throws there rather than passing. A count of them stood here for
 * one edit and was already wrong when the next lane landed — see the paragraph below, which forbids
 * exactly that number and had it re-introduced four lines above itself). The before/after invariants that
 * pass on BOTH sides by design — they exist to catch a FUTURE deletion, not the diff that added them —
 * are named, not counted: (1) the `→ BID/ASK` line exists at all; (2) the ASK-leg ⚠⚠ wording survived
 * the BID-leg fix; (3) Chunk 2's own `formatTimedLap` clauses are intact; (4) §C's degraded-lap shape
 * assertion, whose whole point is that the new fields did NOT leak into that branch. §B exercises
 * `computeReality` / `realityClause`, which neither diff modifies, so it passes either way; its job is
 * pinning the live numbers, not proving non-vacuity.
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
import { timedLapShadow } from '../lib/render/suggestlog.mjs';

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
  // is not below live (js/windowread.mjs `deriveDiurnalRange`'s `bid >= liveLo` reprice branch) while `ask` passes through untouched (`deriveDiurnalRange`'s `const ask = profile.peak.level` passthrough). The
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

ok('read-window-range: the non---profile `diurnal:` summary carries both reality clauses', () => {
  // Chunk 2c. This line and the `→ BID/ASK` line above are on OPPOSITE sides of the same condition
  // (`A.profile === undefined` vs `!== undefined`), so a scored run that does not pass --profile sees
  // ONLY this one. It printed `peak … 1,904` bare while --profile printed the same level flagged.
  const line = rwr.split('\n').find(l => l.includes('diurnal: dip ${fmtHourRange('));
  assert.ok(line, 'the `diurnal:` summary line moved or was renamed — re-point this guard');
  assert.ok(/dipRCShort/.test(line), 'the `diurnal:` summary dip level lost its reality clause');
  assert.ok(/peakRCShort/.test(line), 'the `diurnal:` summary peak level lost its reality clause');
});

ok('read-window-range: the `diurnal:` summary clauses read the PROFILE levels, never a derived bid', () => {
  // The reason this line needs no `bidBasis` gate is that it prints `profMargin.dip.level` verbatim —
  // the exact level hourProfile computed `dip.reality` against — rather than deriveDiurnalRange's
  // possibly-repriced `dr.bid`. That is a property of the SOURCE, so pin the source: if someone swaps
  // the printed number to `dr.bid` without bringing the gate along, this fails and says why.
  assert.ok(/const dipRCShort = realityClause\(profMargin\.dip\.reality/.test(rwr),
    'the `diurnal:` dip clause no longer reads profMargin.dip.reality — if the printed level became dr.bid, the bidBasis gate must come with it');
  assert.ok(/const peakRCShort = realityClause\(profMargin\.peak\.reality/.test(rwr),
    'the `diurnal:` peak clause no longer reads profMargin.peak.reality');
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

ok('emit.mjs: the PRIMARY bid clause is gated on bidBasis (the same repriced-bid guard as the other two surfaces)', () => {
  // Chunk 2 shipped this clause UNGATED while Chunk 2b gated the identical shape on read-window-range's
  // `→ BID` line and /schedule's Level column. `formatTimedLap` prints `lap.bid`, which
  // deriveDiurnalRange reprices to the live instasell (js/windowread.mjs :1376-1380) — so on a repriced
  // row it was printing the LIVE price wearing the DIP level's reach and typical. Verified by rendering
  // it: HEAD prints `BID 2.8k (live, …) ⚠ spike-top ~2.9k` — a "typical" ABOVE the bid it qualifies.
  assert.ok(/lap\.bidBasis === 'live' \? ''/.test(emit),
    "formatTimedLap's BID reality clause lost its bidBasis gate — a repriced bid gets tagged with the dip level's reality");
});

ok('the secondary `also ASK`/`also BID` clause is rendered — and the producer actually ships it', () => {
  // BOTH ends, deliberately. The render half alone would have passed for weeks while the clause was
  // structurally always empty: the emit site reads `lap.askReaches[1]`, and `diurnalTimedLap` built
  // those entries with a four-key shape that dropped `reality`. A guard that scans only the renderer
  // cannot tell "renders the field" from "renders a field nothing populates".
  assert.ok(/also ASK \$\{fmtFn\(ar2\.level\)\}[^\n]*\$\{ar2RC/.test(emit),
    'the secondary ASK level lost its reality clause — it renders bare beside a flagged primary');
  assert.ok(/also BID \$\{fmtFn\(br2\.level\)\}[^\n]*\$\{br2RC/.test(emit),
    'the secondary BID level lost its reality clause');
  const wr2 = read('js/windowread.mjs');
  assert.ok(/reach: askReach, pool: peakPool,\s*\n?\s*reality: profile\.peak\.reality/.test(wr2),
    'askReaches[0] stopped carrying reality — the emit clause silently renders nothing');
  assert.ok(/reality: dr\.bidBasis === 'live' \? null : profile\.dip\.reality/.test(wr2),
    "bidReaches[0] lost the repriced-bid suppression — a repriced level would ship another level's reality to every consumer of the arrays");
  assert.ok(/reality: pk\.reality \?\? null/.test(wr2) && /reality: dp\.reality \?\? null/.test(wr2),
    'a secondary reaches entry stopped transporting the reality buildSecondary already computed');
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

// ── §C — the WRITE side (Chunk 2c) ─────────────────────────────────────────────────────────────
// The render sections above only prove the flag reaches a human. These prove it reaches the RECORD,
// which is the half that decides whether the guard can ever be scored. Both write sites copy every
// other qualifier on the row (bidBasis, notes, fitNights, the reach splits) and dropped this one.
const suggestlog = read('pipeline/lib/render/suggestlog.mjs');

ok('timedLapShadow logs peakReality/dipReality — the retro-log write site', () => {
  assert.ok(/peakReality: reality\(lap\.peakReality\), dipReality: reality\(lap\.dipReality\)/.test(suggestlog),
    'timedLapShadow stopped logging the level-reality read — flagged rows become unsegmentable in suggestions.jsonl and the guard reverts to unmeasurable');
});

ok('timedLapShadow logs bidBasis — without it dipReality cannot be joined to bid', () => {
  // Not decoration. deriveDiurnalRange reprices `bid` to the live instasell when the dip is not below
  // live (js/windowread.mjs `deriveDiurnalRange`'s `bid >= liveLo` reprice branch) — on that row `bid` is the live price and `dipReality` describes
  // profile.dip.level, a different number. `...dr` puts bidBasis on the lap object; this reshaper
  // dropped it, so the record was the one consumer with no way to tell the two populations apart.
  assert.ok(/bidBasis: lap\.bidBasis \?\? null/.test(suggestlog),
    'timedLapShadow stopped logging bidBasis — a retro joining dipReality→bid now silently mixes repriced and un-repriced rows');
});

ok('read-window-range: the --json payload carries the realities ONCE, on result.profile', () => {
  // Chunk 2c, corrected by review. A draft added `peakReality`/`dipReality` to `result.diurnalRange`
  // on the premise that verify.json recorded the levels stripped of their condition. That premise was
  // FALSE for this file: `result.profile = { … dip: prof.dip, peak: prof.peak … }` already serialises
  // the full `reality` object one field above, and has since Chunk 1. The added keys were a literal
  // duplicate of one object inside one payload — two homes — and were removed.
  //
  // So this asserts the OPPOSITE of the draft: the profile block is the ONE home, and `diurnalRange`
  // must NOT re-add them. A consumer joins reality→level via `profile.*.reality` + `diurnalRange.bidBasis`
  // (needed because `bid` is repriced on a 'live' row while `ask` passes through verbatim).
  assert.ok(/result\.profile = \{[^}]*dip: prof\.dip, peak: prof\.peak/.test(rwr),
    'result.profile stopped serialising prof.dip/prof.peak — that is the ONE home of the level-reality read in the --json payload');
  assert.ok(!/diurnalRange = dr \? \{[^}]*peakReality/.test(rwr),
    'result.diurnalRange re-added peakReality/dipReality — they already ride on result.profile in the same payload; two homes for one object is the bug class this repo names repeatedly');
});

ok('timedLapShadow: the reality reshape keeps both flags, the typical, and the evidence', () => {
  // Behavioural, not a source scan. The FLAGS alone are not scoreable: the retro question is "was the
  // flagged level worse than the typical it named", which needs typicalLevel as a number. placement is
  // rounded like every other percentile on the row (r2), and a null reality must stay null rather than
  // become an object of nulls — an absent read and a clean read are different facts.
  const lap = {
    degraded: false, bid: 1795, ask: 1904, bidBasis: 'live',
    peakReality: computeReality(gdlDays, 1904, 'ask'),
    dipReality: null,
  };
  const s = timedLapShadow(lap);
  assert.equal(s.peakReality.spikeTop, true, 'the spikeTop flag must survive the reshape');
  assert.equal(s.peakReality.staleOptimistic, false, 'the second, orthogonal flag must survive too');
  assert.equal(s.peakReality.typicalLevel, 1828, 'typicalLevel must survive — the flag without the honest alternative is unscoreable');
  assert.equal(s.peakReality.reachedDays, 3);
  assert.equal(s.peakReality.nDays, 14);
  assert.equal(s.peakReality.placement, 0.86, 'placement must be r2-rounded like every other percentile on this row');
  assert.equal(s.dipReality, null, 'an ABSENT reality must log as null, never as an object of nulls');
  assert.equal(s.bidBasis, 'live', 'bidBasis must ride so dipReality is interpretable against bid');
});

ok('timedLapShadow: a degraded lap is still {degraded, reason} — §C added no fields to that branch', () => {
  // The §7 data guarantee: a degraded read is logged as its own shape, never faked into zeros. Adding
  // fields to the real branch must not leak into this one.
  assert.deepEqual(timedLapShadow({ degraded: true, reason: 'no-window' }), { degraded: true, reason: 'no-window' });
});

console.log(`\n✓ reality-render-coverage: all ${n} checks passed.`);
