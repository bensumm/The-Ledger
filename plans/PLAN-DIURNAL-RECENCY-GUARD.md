# PLAN-DIURNAL-RECENCY-GUARD — flag/de-contaminate the diurnal PROFILE peak & dip levels

**Status:** Chunks 1+2 SHIPPED (2026-07-24). **Chunk 2b SHIPPED 2026-08-12** — see §10; it closes a
coverage gap Chunk 2's own surface list left open. Chunk 3 stays deferred. This plan stays in
`plans/` only until Chunk 3 is resolved (kept or dropped).
**Owner surface:** `js/windowread.mjs` `hourProfile` (level emit) + its render surfaces — **five since
Chunk 2b** (`--profile` window headers, `--profile`'s `→ BID/ASK` recommendation, `formatTimedLap`,
positions `windowExit`, `/schedule`'s Level column), not the three Chunk 2 enumerated.
**Bump — SETTLED: Chunk 2b DOES bump (`APP_VERSION` 0.74.3 → 0.74.4).** R5 puts a new returned field
and two extra `computeReality` calls into `js/windowread.mjs`, which is an **APP-IMPORTED deployed
module** (`js/trends.js` imports `hourProfile`/`deriveDiurnalRange`), and `js/trends.js` itself is
edited — there is no build step, so those bytes ship. The precedent is one CHANGELOG entry away and
identical in every input: **0.74.3 bumped for `js/windowread.mjs` (`asymPair` now returns
`nAsk`/`nBid`) on the stated grounds that these "are deployed modules … pure passthrough — no
existing number changes."** Chunk 2b is the same file, the same passthrough shape, the same day.

_An earlier draft of this line asserted the opposite — "the rule keys on whether the DEPLOYED app's
RENDER changed; it has not" — and that test is invented. CLAUDE.md rule 5 says "on every shipped
change **to the deployed app**", not to what the app renders. The rewrite happened because R5 moved
the change into `js/` and keeping the old "no bump" conclusion then required a new rule. Redefining a
rule inside a plan file to preserve a conclusion is the failure this plan exists to guard against,
committed while documenting it._

## 1. The problem (live anchor, 2026-07-24)

Reading Primordial boots' diurnal profile, the tool reported **PEAK 01:00–03:00 PDT, level
19.36m** (and the hour-of-day highs implied ~19.44m). Ben pushed back: the probe capped **<19.15m**
this week (couldn't sell above it; it eventually cleared at 18.989m). The scored `--ask 19.15m`
read confirmed him — recent daily highs `07-21: 19.57m · 07-22: 19.44m · 07-23: 19.15m`: **two
anomalous spike days (21st/22nd) followed by reversion to ~19.15m.** The 19.36m "peak" is those
two spike days; the current-regime high is ~18.9–19.15m.

**The failure:** a stale/spike-inflated peak level was quoted to Ben as the exit target with **no
guard flag**, exactly the DHCB/RC1 failure shape the recency work was built to prevent — but on a
surface that work never covered.

**Second anchor — Black dragon leather (the CURRENT held position, same bug, days earlier).**
The declared leather hold-recovery thesis carries **exit 4,375**. Verified this session:
`--ask 4375` → **`reached 1/14d · placement p93 · recent 1/3`**; the per-day 19:00–20:00 high
extremes were `3972 · 3964 · 4350 · 4279 · 4419 · 4271 · 4208` — **4,375 printed on exactly one
day (07-21's 4,419 spike)** and the ceiling has since reverted (4,419 → 4,271 → 4,208). The exit
was almost certainly quoted at declaration time off a recent-window peak read while the 07-21/22
spike sat INSIDE the recent-3 window — the identical `recent-3 median dragged up by a fresh spike`
mechanism. So this bug didn't just misread boots in conversation; **it put real capital into a
position anchored to an unreachable exit** (leather is currently ×3,757 held, marked below BE,
waiting on a 4,375 print that has happened once in two weeks). The guard, run at declaration time,
would have flagged `spikeTop` and quoted the typical ~4,270. This is the n=2 that makes the fix
worth building, and both are known-answer cases for the validation harness (§5).

## 2. Root cause — the recency guard doesn't reach the profile LEVEL

Two facts, both verified in code:

- **The primitive exists and works.** `recencySplit` (`js/windowread.mjs:74`) + `reachedDays` +
  `placement` catch stale/spike levels, and they ARE wired into the **scored `--ask`/`--bid`
  reads** (`read-window-range.mjs:387–420`) and into `amplitudeRanges` (`:1314–1321`, which runs
  `recencySplit` against the profile's own dip/peak levels). When I ran `--ask 19.15m` the flag
  fired correctly (`placement p38 · reached 10/16d`); a `--ask 19.36m` would have shown ~p90 /
  ~2-of-16.

- **The profile LEVEL is emitted raw, unguarded.** `hourProfile`'s peak/dip `level`
  (`:1058–1059`) is `median` of each cluster hour's `hiRecent`/`lowRecent`, where
  `hiRecent = median(recent-3 days' highs at that hour)` (`:1024–1025`, `RECENT_NIGHTS = 3`).
  **The recent-3 window is the contamination vector:** when 2 of the last 3 days are an anomalous
  spike (boots 21st/22nd), the median is dragged up and **nothing attaches a reach/placement
  signal to the emitted level.** The `--profile` printer, the screen diurnal-timing note
  (`formatTimedLap`), and the positions `windowExit` note all quote this raw level.

**Subtlety that shapes the fix:** `staleOptimistic` (full-window rosier than recent) is the WRONG
detector here — boots' spike is *recent*, so recent looks *better* than full (`recentFrac 0.67 >
fullFrac 0.14`). The signal that catches a recent-spike top is **low absolute reach + extreme
placement** (`reached ≤~30% of days` AND `placement ≥ ~p85`), not `staleOptimistic`. A complete
"is this level real in the current regime" guard needs **both directions**:
- `staleOptimistic` → old-high-now-crashed (blood-rune shape).
- `spikeTop` (low reach + high placement) → recent-spike-inflated (boots shape). **NEW.**

## 3. Design — attach a level-reality read, flag + show both (never silent-swap)

Per the gate-on-error-cost doctrine (memory `gate-on-error-cost-not-n`) and Ben's "trust recent"
stance: this MOVES a decision number (the quoted peak/dip), the error is VISIBLE at the point of
action, and it's cheap — so **ship it ON, showing the number and what it changed** (a visible
comparison), NOT a silent replacement of the level.

**Chunk 1 — the pure guard (`js/windowread.mjs`).**
Attach a `reality` object to each emitted `peak`/`dip` (and each element of `peaks[]`/`dips[]`).
For a peak: run `reachedDays`/`placement`/`recencySplit` of the level against that cluster's
per-day HIGHS over the full `nights` window; for a dip, against per-day LOWS. Shape:
```
reality: {
  reachedDays, nDays, recentHit, recentDays,     // absolute reach, both windows
  placement,                                      // where the level sits in the daily hi/lo distribution
  staleOptimistic,                                // crash-shape (from recencySplit)
  spikeTop,                                        // reached ≤ SPIKE_REACH_FRAC days AND placement EXTREME (direction
                                                    // flips by side — see below) AND it printed at least once
                                                    // recently AND the gap vs typicalLevel clears SPIKE_MIN_GAP_FRAC
  typicalLevel                                    // recency-honest fallback = RECENT-window quantile — the level to quote when a flag fires
}
```
Pure, reuses existing primitives, **zero new fetch** (the per-hour cluster days are already in
hand). `peaks[0]/dips[0]` must stay deep-equal to `peak`/`dip` on every field EXCEPT the additive
`reality` (keep the multi-peak invariant; extend the fixture proof — see the invariant note below).
Constants `SPIKE_REACH_FRAC` / `SPIKE_PLACEMENT_PCTILE` / `SPIKE_MIN_GAP_FRAC` / the `typicalLevel`
quantile+window are **labeled PLACEHOLDERS** (n≈0) — this is inform-only, it never gates.

**HARDENED VALUES (Fable, 2026-07-24 — validated against both known anchors + a 145-item
over-flag sweep; see §7 VALIDATION RESULTS for the numbers):**

- **`SPIKE_REACH_FRAC = 0.25`** — reached/touched on ≤25% of the scored window days. Boots
  clears at 2/14 = 0.143; leather (hourProfile's own peak, window 02:00–06:00, level 4,337)
  clears at 3/14 = 0.214. Both sit comfortably under the bar; 0.25 was picked as the tightest
  value that still admits leather's 0.214 with headroom (not shaved to the exact anchor value —
  a threshold pinned to the knife-edge of its one calibration case is a placeholder in name only).
- **`SPIKE_PLACEMENT_PCTILE = 0.75`, DIRECTION FLIPS BY SIDE** — this is the one correctness bug
  the abstract spec in the original draft would have shipped silently: an ASK-side spike sits at
  the TOP of the daily-HIGH distribution (`placement ≥ 0.75`), but a BID-side spike (an anomalous
  flash-crash low dragging the recent-3 median dip DOWN) sits at the BOTTOM of the daily-LOW
  distribution (`placement ≤ 1 − 0.75 = 0.25`). Applying the same `≥ 0.75` test unconditionally to
  both sides (what a literal reading of "placement ≥ SPIKE_PLACEMENT_PCTILE" implies) makes the
  bid-side test nearly unsatisfiable — the prototype's first pass showed exactly this: 0% dip-side
  flags across a 60-item volatile-item sweep where 30% of PEAKS flagged. Fixed by testing
  `side === 'bid' ? placement ≤ 1 − p : placement ≥ p`. 0.75 (not 0.85, the original draft's
  informal guess) is the tightest value that still admits leather's p79 placement (0.7857) —
  boots' p93 clears with room to spare.
- **`SPIKE_MIN_GAP_FRAC = 0.01`** — **NEW, not in the original scope**, added because reach+
  placement alone flagged several watchlist rows where `typicalLevel` landed within ~0–2% of the
  raw level (e.g. Bandos d'hide boots, Moonclan teleport, Ape atoll teleport — `typical === level`
  exactly in the first sweep pass) — a technically-true-by-the-numbers flag with nothing
  actionable to report. Requires `|level − typicalLevel| / typicalLevel ≥ 0.01` before firing.
  Boots' real gap is only 1.36% (19.36m vs 19.10m) — a BIG-TICKET item where a spike moves the
  level by a smaller PERCENTAGE than on a cheap item, so 1% (not the initially-tried 2%, which
  excluded boots) is the floor that keeps both anchors passing.
- **`recentHit > 0` gate** — the level must have actually printed at least once in the recent-N
  window. This is what separates `spikeTop` (a level that happened recently, rarely, and is being
  over-generalized into "typical") from a plain old-high-that-never-happens-anymore level
  (`recentHit === 0` is `staleOptimistic`'s territory, the opposite failure shape — never let one
  flag steal the other's cases).
- **`typicalLevel` quantile: `recentQuant(days, side, 0.55, recentN=7)`, NOT a full-14-day
  quantile.** This is the second correctness finding: a full-window q55 stays contaminated by a
  PRE-regime-shift tail exactly like the disease this guard exists to cure. Verified on leather:
  the full-14-day q55 of daily highs in the peak window is **4,104** (dragged down by the
  07-10…07-18 cheap days, before the item repriced up around 07-19), while the recent-7 q55 is
  **4,249** — and the actual 07-23 print in that window was **4,270**. The recent-7 read is far
  closer to what's actually printing; the naive full-window quantile would have quoted a level
  that's ALSO wrong, just wrong in the other direction. `recentN=7` (half the 14-night default)
  balances "recent enough to reflect the current regime" against "enough days to not just echo
  the 1–2 spike days themselves back out." Degrades to the full-window quantile when
  `recentQuant` returns null (too few recent days) — never a crash, never a fabricated number.

**Chunk 2 — render on all three surfaces.**
1. `read-window-range.mjs --profile` — the existing line is left **byte-identical when no flag
   fires**; a flag appends a clause:
   ```
   PEAK window 01:00–03:00 — recent level 19.36m ⚠ spike-top (reached 2/14d · p93 · typical ~19.10m)
   DIP window 14:00–16:00 — recent level 371 ⚠ spike-top (touched 2/14d · p14 · typical ~387)
   PEAK window 05:00–09:00 — recent level 388 ⚠ stale (reached 12/14d full · 1/3 recent · typical ~402)
   ```
   (`spike-top` for the ask/bid-extreme-placement case, `stale` for `staleOptimistic` — same
   sigil `⚠`, the word after it is the only thing that changes; `typical ~X` always trails so the
   eye lands there last, per the plan's "lead the eye to typicalLevel" intent.)
2. Screen diurnal-timing note (`formatTimedLap`, `pipeline/lib/emit.mjs`) — append the same
   compact clause to the existing `ASK …`/`BID …` bits (which today read
   `` `ASK ${fmtFn(lap.ask)} (peak ${win(lap.peakWindow)})` ``):
   ```
   ASK 19.36m (peak 01:00–03:00) ⚠ spike-top ~19.10m
   BID 371 (dip 14:00–16:00) ⚠ spike-top ~387
   ```
   Omitted entirely (no trailing clause, byte-identical to today) when `reality` is absent/clean —
   this is an APPEND, never a replacement of the existing bit text.
3. Positions `windowExit` note (`js/windowread.mjs` `askExitRead` → `quote-items.mjs`'s big-ticket
   block) — append to the existing `parts` array (which already pushes the `list … reached …
   placement …` line):
   ```
   ⚠ spike-top — typical ~19.10m
   ```
   joined into the same `parts.join(' · ')` line as every other clause (no new note line — the
   one-line-per-item house rule holds).

Text is the only change on 2–3; no number that gates moves.

**Chunk 3 (optional, defer unless trivial) — widen the level's own recent window.** Consider
computing `hiRecent`/`lowRecent` as a robust quantile over recent-N rather than a bare median, so a
2-of-3 spike doesn't set the level in the first place. RISK: this changes the trend-accuracy
behavior the current design intends (`:994` comment). Default = DON'T touch the level computation;
the flag + `typicalLevel` (Chunks 1–2) is the honest fix. Only pursue if Fable's validation shows
the flag alone leaves the primary number misleading.

## 4. Honesty / guardrails (process rule 4)

- Inform-only, n≈0, never gates — the flag is a prompt, the `typicalLevel` a suggestion.
- Thresholds are PLACEHOLDERS; state that in the render and the module header.
- Keep `lint-docs` denylist clean; this is structural, not semantic.
- The multi-peak deep-equal invariant (`peaks[0]===peak` on all non-`reality` fields) is a hard
  test, not a judgment call.

**Deep-equal invariant test spec (hardened):** `hourProfile`'s existing code builds
`peaks: secondPeak ? [peakObj, secondPeak] : [peakObj]` — `peaks[0]` is the SAME OBJECT REFERENCE
as `peakObj` (not a structural copy), and `dip`/`dips[0]` mirror this. As long as Chunk 1 attaches
`reality` onto `peakObj`/`dipObj` BEFORE the `return` statement builds `peaks`/`dips` (the natural
place to do it — right after `peakObj`/`dipObj` are constructed at :1058-1059), the invariant is
satisfied FOR FREE by referential identity: `peaks[0].reality === peak.reality` because they are
literally the same object. The test still needs to assert this explicitly (not just trust it),
because a future refactor could clone the object before pushing to the array and silently break
the sharing:
```js
// pipeline/test/windowread.test.mjs (extend the existing PLAN-MULTI-PEAK-WINDOWS fixture)
const prof = hourProfile(series, opts);
assert.strictEqual(prof.peaks[0], prof.peak);   // same reference, not just deep-equal
assert.strictEqual(prof.dips[0], prof.dip);
// AND, for a refactor-resilient regression guard even if referential sharing is ever dropped:
const { reality: _r1, ...peakRest } = prof.peaks[0];
const { reality: _r2, ...peakBase } = prof.peak;
assert.deepStrictEqual(peakRest, peakBase);   // every OTHER field stays identical
assert.ok(prof.peak.reality === undefined || typeof prof.peak.reality === 'object');
```

## 5. How we validate the solution (Ben's explicit ask, 2026-07-24)

Three layers, weakest-to-strongest. The point is not "tests pass" — it's **does the guard catch
the two real cases that fooled us, without crying wolf across the universe.**

**Layer A — unit fixtures (mechanics).**
- Synthetic 14-day series: flat ~19.0m regime + a 2-day spike to 19.5m in the most-recent-3 window
  → assert peak `reality.spikeTop === true`, `typicalLevel ≈ 19.0m`, and the raw `level` still ≈
  the (contaminated) median (proves we FLAG, don't silently change it).
- Mirror: old-high-then-crash series → `staleOptimistic === true`, `spikeTop === false`.
- Clean stable series → both flags false, `typicalLevel ≈ level` (the anti-cry-wolf floor case).
- Deep-equal invariant: `peaks[0]` equals `peak` on every field except `reality`.

**Layer B — retrospective replay on the two KNOWN failures (the real validation).**
Build a small replay harness (`pipeline/test/diurnal-recency-replay.mjs` or a `--replay` mode on an
existing tool) that runs `hourProfile` against the ACTUAL archived series for:
- **Primordial boots** as of 2026-07-24 → assert the peak `reality.spikeTop === true`, and
  `typicalLevel` lands ~19.0–19.15m (the level that actually printed 07-23), NOT ~19.36m.
- **Black dragon leather** at/near the thesis-declaration window → assert the 4,375-neighbourhood
  peak flags `spikeTop` and `typicalLevel ≈ 4,250–4,290` (the reachable ceiling), NOT 4,375.
These are known-answer cases — the market already told us the right answer (what printed the
following days). A guard that doesn't flag these two is not shipping. Honesty: **n=2** — this
validates "catches the failures we've seen," it is NOT a calibrated hit-rate.

**Layer C — over-flag sweep (does it cry wolf?).**
Run the guard across the whole current watchlist + scan universe and count how many peaks/dips get
`spikeTop`/`staleOptimistic`. An inform-only flag Ben has to trust dies if it fires on everything.
Success = it flags the genuine spike-tops (boots/leather class) and stays quiet on stable
oscillators (the boots-cohort amplitude items whose highs print consistently). Report the flagged
list for eyeball review; if >~25% of the universe flags, the thresholds are too loose — tighten
before shipping. Also spot-check `typicalLevel` vs the next-day actual high on a handful
(`|typical − actual|` should beat `|rawLevel − actual|`) — the accuracy claim, stated with its n.

**Green-before-done:** `node --check` + `run-tests.mjs` + `check-imports.mjs` + `lint-docs.mjs`;
app smoke if the render path bumps `APP_VERSION`.

## 7. VALIDATION RESULTS (Fable, 2026-07-24)

A throwaway prototype (`scratch-diurnal-reality.mjs`, deleted after this pass — not a repo file)
implemented Chunk 1's `computeReality` exactly as hardened in §3 above, importing the REAL
`hourProfile`/`windowStats`/`recencySplit`/`reachedDays`/`touchedDays`/`placement`/`quantHigh`/
`quantLow`/`recentQuant` from `js/windowread.mjs` (zero duplicated math) against LIVE-fetched 1h
archive series (via `pipeline/lib/marketfetch.mjs`'s `fetchTs`/`loadMapping`, `COFFER_FETCH_CACHE`
enabled to be polite to the wiki API across the sweep).

**Layer A (unit fixtures):** not built as formal fixture files in the prototype (the prototype ran
directly against live data instead) — Opus's implementation still owes the synthetic-series
fixtures from §5 (flat+spike, old-high-then-crash, clean-stable) as the CI-pinned regression guard;
the live replay below is a superset proof for the two known cases but doesn't replace unit
fixtures for the mechanics.

**Layer B (retrospective replay, the real test) — PASS on both anchors:**

| Item | hourProfile's own peak | reach/placement | `spikeTop` | `typicalLevel` | actual next print |
| --- | --- | --- | --- | --- | --- |
| Primordial boots (13239) | 19.36m, window 01:00–03:00 | 2/14d (recent 1/3) · p93 | **true** ✓ | 19.10m | 19.10m (07-23, exact) |
| Black dragon leather (2509) | 4,337, window 02:00–06:00 | 3/14d (recent 2/3) · p79 | **true** ✓ | 4,249 | 4,270 (07-23) |

Both fire correctly. `|typical − actual|` beats `|raw − actual|` on both: boots 0 vs 263,698 (the
recent-7 q55 landed on the EXACT print); leather 21 vs 67. **n=2 — this is "catches the two cases
that fooled us," not a calibrated hit-rate** (rule 4 honesty).

Note: the leather anchor's originally-declared thesis exit (4,375) was a single-hour `hiRecent`
read (hour 5 specifically), not `hourProfile`'s own CLUSTER level (4,337, the median across hours
02:00–05:00) — re-verifying the exact 4,375/window-19:00-20:00 manual read (a different window,
scored via `read-window-range.mjs`-style scoring rather than `hourProfile`'s own peak) ALSO
reproduces the plan's stated `reached 1/14 · p93 · recent 1/3` numbers exactly and ALSO fires
`spikeTop` under the hardened thresholds — so the guard catches the bug at both the thesis's
manually-read level AND at `hourProfile`'s own automatically-clustered level. Both are shown for
completeness; the CLUSTER read is what Chunk 1 actually attaches `reality` to in production.

**Layer C (over-flag sweep) — two populations, different expected base rates:**

- **`dip-watchlist.json` (60 auto-nominated dip/flush candidates — a population that is, BY
  CONSTRUCTION, selected because it recently moved):** peaks 18/60 flagged `spikeTop` (30.0%),
  1/60 `staleOptimistic`; dips 4/60 flagged `spikeTop` (6.7%). Combined 22/120 = **18.3%**. A high
  rate here is expected, not evidence of over-firing — several flagged rows are extreme, obviously
  genuine spikes (Green d'hide vambraces: level 15,000 vs typical 1,700, an 8× gap; Unfired plant
  pot: level 39,960 vs typical 96 — almost certainly a real one-off print the guard SHOULD flag).
- **`watchlist.json` (25 curated, actively-traded liquid flip items — the closer analogue to "a
  stable oscillator Ben actually trades"):** peaks 4/25 (16.0%), dips 4/25 (16.0%), 0
  `staleOptimistic`. **8/50 = 16%, under the ~25% bar**, and every flagged gap is modest (1.6%–7.6%
  — Black chinchompa, Coal, Dragon claws, Webweaver bow, Crystal armour seed, Dragon boots, Dragon
  warhammer, Osmumten's fang) — plausible real signal on liquid items with a genuine recent wobble,
  not wild crying-wolf.

**Two design bugs found ONLY by prototyping against real data (not visible from the abstract spec
in §3's first draft) — both are now folded into the hardened values above:**
1. **Placement direction must flip by side.** A literal `placement ≥ SPIKE_PLACEMENT_PCTILE` test
   applied unconditionally made the bid-side test nearly unsatisfiable (0% dip flags on the
   60-item volatile sweep, vs 30% on peaks) — an ask-side spike sits at the TOP of the distribution,
   a bid-side spike at the BOTTOM. Fixed: `bid` tests `placement ≤ 1 − p`.
2. **`typicalLevel` needs a RECENT-window quantile, not a full-14-day one.** The full-window q55
   stays contaminated by a pre-regime-shift tail — the EXACT disease this guard exists to cure,
   just relocated into the "fix." Fixed: `recentQuant(days, side, 0.55, recentN=7)`.

A third addition beyond the original scope, `SPIKE_MIN_GAP_FRAC` (≥1% gap between `level` and
`typicalLevel`), was needed to suppress technically-true-by-the-numbers flags with nothing
actionable to report (several watchlist rows where `typicalLevel` landed within 0–2% of the raw
level).

## 8. GO / NO-GO

**GO**, with the three amendments above folded into the spec (§3's hardened values already reflect
them — Opus should implement from THIS document, not the original draft). Both known-failure
anchors fire correctly with an honest n=2; the over-flag rate on the population that actually
matters (the curated, actively-traded watchlist) is 16%, under the ~25% bar; and the accuracy claim
(`typicalLevel` beats the raw level) holds on both anchors with the caveat stated at its true n.
The design's core idea — attach reach/placement/typicalLevel to the emitted level rather than
silently swapping it — survives contact with real data. The one thing that did NOT survive
unchanged is the exact shape of `spikeTop`'s test (placement direction, gap floor, recency-window
for `typicalLevel`) — all three are now pinned in §3 with the data that justifies each number.

## 9. Dispatch

**HISTORICAL — Chunks 1+2 shipped 2026-07-24 and Chunk 2b shipped 2026-08-12 (§10); this section is
the original dispatch note, kept for the reasoning.** Its touched-files list predates Chunk 2b and
omits `read-schedule.mjs` (where 2b's headline change lives) and `js/windowread.mjs`'s secondary-window
`reality`. Only Chunk 3 remains open.

Scope (this doc, hardened) → **Opus** implements Chunks 1+2 (Chunk 3 still deferred — the flag+
typicalLevel fix is sufficient per the validation above; no evidence surfaced that the level
computation itself needs to change). Single lane; touches `windowread.mjs` + `emit.mjs` +
`read-window-range.mjs` + `quote-items.mjs` (the `windowExit` block) + tests (`windowread.test.mjs`
extended per §6's invariant spec, plus the §5 Layer-A synthetic fixtures still owed) + docs
(README inventory unchanged — no new file; `docs/MARKET-ANALYSIS.md` §timing gets a line, and the
`js/windowread.mjs` `hourProfile` header documents `reality`).

## 10. Chunk 2b — the surface-coverage gap (SHIPPED 2026-08-12)

**What Chunk 2 missed, and why no test saw it.** Chunk 2 enumerated three surfaces. On the screen
surface it tagged the RECOMMENDATION (`formatTimedLap`'s `ASK …`/`BID …` bits). On
`read-window-range --profile` it tagged the WINDOW HEADER (`PEAK window … ⚠ spike-top`). That left
two levels bare, both of which a reader quotes from:

1. `read-window-range.mjs`'s own `→ BID … · ASK …` recommendation line — the surface's actual
   "here is the price" line, printing two lines under the tagged window header. It fell between
   Chunk 2's items 1 and 2.
2. `read-schedule.mjs`'s **Level** column — the `/schedule` agenda, whose column `d37e818` defines
   as *"a price you place an offer at"*. Chunk 2 never listed this surface at all.

**Live cost (2026-08-12).** A Green dragon leather exit of **1,904** was quoted off the bare lines
while the profile block already tagged 1,904 `⚠ spike-top (reached 3/14d · p86 · typical ~1,828)`.
The ask never printed; the lot went underwater and the exit was repriced to 1,869.

**Shipped:**
- **R1** — `realityClause(style:'short')` on the `→ BID/ASK` line. The ASK clause is
  unconditional; **the BID clause is gated on `bidBasis !== 'live'`** because `deriveDiurnalRange`
  reprices the bid to the live instasell when the dip is not below live (`js/windowread.mjs:1367-1372`)
  while the ask passes through verbatim (`:1376`). Tagging a repriced bid with `profile.dip.reality`
  would label one price with another's conditions — the defect this plan exists to prevent. Do not
  "simplify" that gate.
- **R2** — a `*` mark on `/schedule`'s Level column, skipped on repriced dips for the same reason,
  with the legend naming each flagged row **and its typical** (the number must travel with the
  condition; a bare mark just relocates the problem).
- **R3** — the `⚠⚠` cushion+pace composite is now **side-aware**. It runs on both legs but its text
  was hardcoded to the ask reading, and `reachMargin`'s cushion is side-flipped (`:756`), so it was
  shipping a *price-to-sell-EARLY* instruction under a `--bid`. **Wording only — the AND threshold
  is deliberately unchanged** (see below).
- **R4** — the `BID side —`/`ASK side —` menu lines tag the **recent-N level only**. The `~50% of
  days` / `~75%` / `every day` levels ARE quantiles of the same distribution (`quantHigh` header,
  `:31-32`), so annotating them would restate their own labels; the recent-N level is fitted over a
  different window and can be a spike-top against the full one — which is the level that was misquoted.
- **R5 (added after review) — `reality` on the SECONDARY windows.** `hourProfile` attached it only to
  the primary peak/dip, so every `·2` row was structurally unflaggable. Harmless while nothing marked
  levels; actively harmful the moment R2 did — `/schedule` printed `SELL peak·2 1,916` bare beside
  `SELL peak 1,904 *` under a legend teaching that flagged levels get named, while 1,916 is ALSO a
  spike-top (3/14 · p79 · typical ~1,879). **A partial mark is worse than no mark: it converts
  "unknown" into "checked and fine."** `read-schedule.mjs:128-131` had already warned about exactly
  this split for the Ghrazi guard — "the obvious partial fix … would have left ·2 unguarded and
  recreated the same split one level down" — and the first cut of Chunk 2b did it anyway.
- **Coverage guard** — `pipeline/test/reality-render-coverage.test.mjs`. Because the failure mode is
  a MISSED CALL SITE, the guard is a source-level scan over the call sites (same philosophy as
  `check-daemon-safety.mjs`), plus behavioural pins built from the REAL 14 daily highs of the miss
  (they reproduce the shipped `reached 3/14 · p86 · typical ~1,828` exactly; the first cut used a
  synthetic ramp that flagged for a similar reason rather than the real one, with typical at 1,860).
  **Non-vacuity, scoped precisely:** every §A assertion that targets a NEW call site fails against `git show HEAD:` copies of the four files §A scans; exactly three §A assertions are before/after invariants guarding a FUTURE deletion, named rather than counted (the `→ BID/ASK` line existing at all, the ASK-leg ⚠⚠ wording surviving the BID-leg fix, and Chunk 2's own `formatTimedLap` clauses); §B pins `computeReality`, which the diff does not touch. _A hard-coded COUNT was wrong here three review rounds running — it was re-derived by hand each time §A changed and drifted every time (latest: "ten … three" when §A held fourteen assertions, of which eleven fail pre-fix). The count is gone; naming the exceptions is stable because adding an assertion cannot silently invalidate it._ Superseded text follows for the record: the ten §A assertions targeting the NEW call sites fail against
  `git show HEAD:` copies of the pre-fix files. Three further §A assertions are before-and-after
  invariants that exist to catch a future deletion, and §B exercises `computeReality`, which this diff
  does not modify. The guard is a fixed regex set over four named files — it **cannot enumerate**
  surfaces and does not prove full coverage. _(The first draft of this bullet, and of the CHANGELOG and
  README entries, claimed "all 10 of its assertions fail against the pre-fix files" — the file has 23
  `assert.` calls in 10 blocks, so that number described an ad-hoc mutation script, not the guard.
  Corrected; it is the same class of unearned verification claim rule 10 names.)_

**Measured and REJECTED — widening the `⚠⚠` trigger.** The obvious "fix" for R3 was to fire on
either signal alone rather than both. Measured over 25 scored legs: cushion-only **56%**,
fading-only **44%**, union **60%**, against the current AND at 16%. A ~40% fire rate is wallpaper
(cf. `b499608`), so the threshold was left alone and only the wording corrected. Honesty: 25 legs is
a small, self-selected sample from one session — enough to reject a 60% trigger, not enough to
calibrate one.

**Still bare (logged, not silently dropped):**
- `emit.mjs:112`'s `sell: list @ X · break-even Y` — the most-repeated price line in the tool and
  mandated on every item by the `state-sell-price-in-loop` rule. It is a held-lot exit rather than a
  diurnal level, so `reality` does not apply **on the default path** (`heldListAt` resolves
  `mv.listAt` → `row.optSell` → instabuy → BE, none diurnal). Under the opt-in `--pressure-exit`,
  `watch-positions.mjs` overrides it with `estimatePair`'s result, which IS fed
  `diurnal:{bid,ask}` — i.e. `profile.peak.level` — so the exemption is path-scoped, not absolute.
  Needs `askExitRead` data; separate chunk.
- `emit.mjs:203-204`'s `also ASK …`/`also BID …` secondary-window clause. **NOT a render-only append,
  despite an earlier draft of this bullet saying so.** It does not read `peaks[1]`/`dips[1]`; it reads
  `lap.askReaches[1]`, which `diurnalTimedLap` builds with a fixed four-key shape
  (`level`/`window`/`reach`/`pool`, `js/windowread.mjs:2065-2066`) that drops `reality`, and the lap
  carries `peakReality`/`dipReality` for the PRIMARIES only (`:2087`). R5 made the data exist; it did
  not make it arrive. Fixing this site needs a transport change in `diurnalTimedLap` first.
  _(The retracted claim assumed a value was in scope at an emit site because it existed upstream —
  the same assumption that caused the original Chunk 2 defect, written into the plan while
  documenting that defect.)_
- `watch-positions.mjs`'s `HOLD — per thesis: exit X` / `FLUSH … list @` / `LIST-TO-CLEAR … @`, and
  `quote-items.mjs:826`'s pressure-exit pair.
- **The deployed app.** `js/trends.js:317-325` plots `deriveDiurnalRange`'s bid/ask as chart reference
  lines with no clause, so the Trends tab still shows an unqualified 1,904. Its readout comment
  asserted parity with the console's Diurnal block — true before Chunk 2b, false after — and has been
  corrected in place rather than left standing (rule 8). This is the one still-bare site that reaches
  a non-console surface, so it is the highest-priority follow-up and it WOULD carry an `APP_VERSION`
  bump when it ships.
