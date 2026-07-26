# PLAN-CAPITAL-EFFICIENCY-AND-DIGEST.md — hardened implementation spec

Status: SPEC ONLY, not yet implemented. Owner review requested before an Opus subagent builds
from this. Folds into `PLAN.md` and is deleted the moment its chunks ship (repo convention).

**Scope lock (owner decision, do not relitigate):** everything here is **CONSOLE-ONLY**. No field
in this plan renders into `screen.json`, so **no `APP_VERSION` bump** (`js/state.js` untouched).
Only `pipeline/commands/screen-flip-niches.mjs` (stdout), `.claude/skills/scan/SKILL.md` (version
bump), and docs change.

## 0. Grounding — what already exists (read before editing)

- `pipeline/commands/screen-flip-niches.mjs` `renderMode()` builds each niche's rows, then prints via
  `pipeline/lib/render.mjs` `renderReport`. Per survivor it already computes `estimateRank(spec, row,
  extra)` → `{ pair, net, pFill, ttf, rank, lapUnits }` (`js/estimators/families.mjs`), a `ph =
  phase(series6h)`, and (via `hourProfile`/`deriveDiurnalRange`/`diurnalPhase`, `js/windowread.mjs`) the
  Diurnal-timing block with its `⏲` phase token. `rateItem({ row, rank, activeWin, nWin, thin })`
  (`js/rating.mjs`) turns the rank into `{ score, grade, riskMult, factors, thin }`.
- **`net`** (per unit, tax-net, from `netMargin`) and **`ttf.value`** (seconds) and **`pFill.value`**
  (0–1) are already on the `estimateRank` result (`er` in the codebase, e.g. `estFields(er)` at
  screen-flip-niches.mjs:390-396). **`roiPct`** is *not* currently attached to `er` — `quickRoi`/`optRoi`
  live on the `computeQuote` row (`js/quotecore.js:407-408`, `net/buy*100`) and are basis-matched to
  `row.quickBuy/quickSell` or `row.optBuy/optSell`. Since `estimateRank`'s default `priceBasis` is
  `'opt'` (`quotedPair` in `js/estimators/families.mjs:238-246`), `row.optRoi` is byte-identical to
  `er.net / er.pair.bid * 100` for every default-basis spec (band/churn/scalp). For `'quick'`/`'term'`/
  `'daily'` bases there is no matching row field, so **compute roiPct directly off `er`** (`er.net /
  er.pair.bid * 100`, null-guarded) rather than reading `row.optRoi` — one formula that works for every
  spec instead of a per-basis lookup.
- **Big-ticket classification already exists — reuse it, do not invent a price cutoff.**
  `BIG_TICKET_GP = 10_000_000` (`js/quotecore.js:93`) is the repo's one big-ticket-lot threshold, already
  used by `momVerdict` to gate the big-ticket cut logic. For a screen candidate (no lot yet — this is
  pre-buy), the per-unit analogue is `row.mid ≥ BIG_TICKET_GP`. Use this, imported, not reimplemented.
- **Recycling-lane classification already exists — `spec.estimator === 'churn'`** (`js/flip-niches.mjs`).
  Churn is the ONE flip-niche whose `ESTIMATORS` entry carries `lapUnits` AND whose thesis is
  "max the buy limit, flip it, buy limit refills in 4h, repeat" (`js/estimators/families.mjs:194-209`,
  `churnLapUnits`). Amplitude also declares a `lapUnits` estimator but its cycle is ~1 day (`hold-days`),
  not multiple laps within a day — it is NOT a same-day recycling lane. Band/scalp/value do not recycle
  intraday. So "recycling churn lane" in the input plan = `spec.estimator === 'churn'` exactly, nothing
  broader.
- **The 4h buy-limit window is `LIMIT_WINDOW_SEC = 4 * 60 * 60`** (`pipeline/lib/limits.mjs:31`). A
  buy-limit-cycle commodity can refill and re-lap at most `86400 / LIMIT_WINDOW_SEC = 6` times/day —
  this is the mechanical cap on churn's laps/day, independent of how fast any one lap sells.
- **`diurnalPhase(profile, { now })`** (`js/windowread.mjs:795-807`) returns `{ phase: 'in-peak' |
  'pre-peak' | 'post-peak', hoursToPeakClose, hoursToNextPeak, startH, endH }` or `null` when no peak
  window was derived (thin/no-band item, or `deriveDiurnalRange` degenerate). It is already computed and
  printed as the `⏲` token in the Diurnal-timing footer line per surfaced row — the digest reads the
  SAME computed value, it does not recompute.
- **`placement()`** (`js/windowread.mjs:47-51`) is the price→percentile function already used for the
  Est.-buy cell's `pXX` token (band-low placement in the 14-day daily-LOW distribution) and for ask-side
  placement checks. The digest's `reach ✓/✗` column reads the SAME reach data already fetched for the
  row's `ℹ reach`/asym notes (`extra.reach` passed into `estimateRank`, sourced from the Leg-B 1h-series
  reach read in `renderMode`) — it does not fetch anything new.
- **Grade** is `rateItem(...).grade` (already computed, possibly capped by `THIN_GRADE_CAP` /
  `REACH_GRADE_CAP` / `PHASE_BASING_GRADE_CAP` / `SUBFLOOR_GRADE_CAP`).
- **The render-object contract** (`pipeline/lib/render.mjs`): a niche's printed report is built by
  `buildScreenNicheReport({ headerLines, table, estExplainer, footerLines, extraSections })` then
  `renderReport()`. The digest is a NEW section type or a new top-level report, not a retrofit of the
  existing per-niche table (see §3).
- **Positions read**: `pipeline/commands/watch-positions.mjs` computes per-held-lot verdicts via
  `heldAction`/`momVerdict`/`renderHeldVerdict` (`pipeline/lib/item-context.mjs`), including `BID-BEHIND`
  (a resting BUY sitting below `row.optBuy`, unlikely to fill — `watch-positions.mjs:372-373`) and the
  `heldAlert`/`bidVerdict` family for resting asks. It already reads `positions.json`/`offers.json` and
  runs the SAME `sync-fills.mjs --local` pre-sync doctrine screen does (SY1).

## 1. Workstream A — capital-efficiency ranking + weak-deploy flag

### 1.1 `capEff` — exact formula

```
roiPct(er)   = er.net != null && er.pair.bid > 0 ? er.net / er.pair.bid * 100 : null
holdDays(spec, er) =
  spec.estimator === 'churn'
    ? 1 / Math.min(6, Math.max(1, 86400 / Math.max(er.ttf.value, 1)))   // laps/day, capped by the 4h-window refill rate (6/day) AND by how long one lap actually takes to sell (86400/ttf.value); holdDays is the RECIPROCAL of that laps/day
    : Math.max(er.ttf.value, 3600) / 86400                              // single-turn: TTF in days, floored at 1h (mirrors TTF_FLOOR_DAYS's spirit; avoids a divide-by-tiny blowup on a near-zero TTF)
capEff(spec, er) = roiPct(er) != null ? roiPct(er) / holdDays(spec, er) : null   // %/day
```

Read this as: **capEff = after-tax ROI% earned per day of capital tied up.** A single-turn big-ticket
ties up capital for its whole TTF (days, maybe a week); a churn lane frees and re-commits the SAME
capital up to 6×/day, so its `holdDays` (and therefore the "day" the % is measured over) is a fraction
of a day.

**Why `laps/day` uses `min(6, 86400/ttf.value)` and not a flat 6:** the 4h window is the *refill* rate
ceiling (you can never re-buy faster than every 4h regardless of how fast the sell clears), but if a
churn lane's own sell TTF is slower than 4h (e.g. a thinner churn item), you can't actually complete 6
laps/day either — the achievable rate is the SLOWER of the two constraints. This is the mechanical
"laps/day bounded by the 4h buy-limit throughput" the input plan asked for, expressed with real fields
(`er.ttf.value`, `LIMIT_WINDOW_SEC`) instead of a new assumption.

**Where it's computed**: a new pure helper — call it `capEfficiency(spec, er)`. For THIS plan
(console-only, one consumer), the simplest correct home is a plain local function in
`screen-flip-niches.mjs` next to `estFields()` (line ~390) that takes `(spec, er)` — no new shared
module needed since nothing else consumes it yet. Import `LIMIT_WINDOW_SEC` from
`pipeline/lib/limits.mjs` if the constant is referenced symbolically, or hardcode the derived `6`
(laps/day ceiling) with a one-line comment pointing at `LIMIT_WINDOW_SEC` as the source of truth — either
is fine; prefer the import for the single source of truth. Promote to `js/estimators/families.mjs`
(beside `rankScore`/`fmtTtf`, which already owns `TTF_FLOOR_DAYS`/`estimateRank`) only if a second
consumer (e.g. the app's Finder) appears later (YAGNI, matches `docs-small-encode-in-scripts`).

### 1.2 "Big-ticket" — reuse, don't invent

```
isBigTicket(row) = row.mid != null && row.mid >= BIG_TICKET_GP   // BIG_TICKET_GP from js/quotecore.js (already imported by screen-flip-niches.mjs's `import { computeQuote, ... }` line — add BIG_TICKET_GP to that same import)
```

### 1.3 `⚠ weak-deploy` — exact rule

```
WEAK_DEPLOY_ROI_PCT = 0.5   // PLACEHOLDER (n≈0) — the Magus (0.3%, flagged) vs blowpipe (1.1%, not
                            // flagged on margin alone) anchor; a real threshold needs the retro-join
                            // once big-ticket single-turn fills accrue (§9)

weakDeploy(spec, row, er) =
  isBigTicket(row) && spec.estimator !== 'churn' && roiPct(er) != null && roiPct(er) < WEAK_DEPLOY_ROI_PCT
```

Note this checks **`roiPct` (per-turn %), not `capEff` (per-day %)** — the input plan's anchor language
("sits below ~0.5%/turn") is explicitly per-turn, and per-turn is also the RIGHT basis for a warning
whose point is "this single round-trip barely clears the risk of parking this much capital in one
item," independent of how long that round-trip takes. `capEff` is the RANKING metric (ties efficiency
to time so a fast small win can outrank a slow big one); `weakDeploy` is a FLAG on the trade's own
per-turn economics regardless of speed. Keep them as two separate fields — do not fold weakDeploy's
threshold into capEff's.

`amplitude` (`spec.estimator === 'amplitude'`) is single-turn-per-cycle (one trough→peak swing per
~day) so it is NOT exempted like churn — a weak-deploy amplitude pick (concentrated in a big illiquid
item per the `/scan` amplitude doctrine) should flag. `value`/`band`/`scalp` are also non-churn so they
flag too when big-ticket + thin margin.

### 1.4 Surfacing

- Add `capEff` (rounded to 2dp, `%/day`) and, when `weakDeploy(...)` is true, a `⚠ weak-deploy` suffix
  token to each surfaced row's **lean fields** (`estFields(er)` at screen-flip-niches.mjs:390-396 — add
  `capEff: round2(capEfficiency(spec, er))` and `weakDeploy: weakDeploy(spec, row, er) || undefined`,
  the `YS2` absent-field pattern so old suggestions.jsonl rows don't need a shape migration).
- Add `capEff`/`weakDeploy` to the **digest** row (Workstream C, §3) — this is the primary surface Ben
  reads it from.
- Do **NOT** add a `Cap Eff` column to the existing per-niche stdout/`--verbose` table or to
  `screen.json` — that table is already wide (`Item | Guide | Est. buy/sell | Net/u | BE | Vol/d |
  Momentum | Regime | Grade | Rank`) and the digest is the intended new home for capital-efficiency
  ordering (this is exactly the firehose problem Workstream C fixes — don't re-add a firehose column
  to solve it).
- **Ordering**: the digest (§3) sorts by `capEff` descending (ties broken by the existing `rank`).
  The existing per-niche table's sort **stays `rank` descending, unchanged** (byte-identity for
  `screen.json`/replay goldens — `rank` is what F1/retro-join calibrates against; re-sorting the
  underlying table by `capEff` would silently change screen.json row order with no version bump to
  flag it, which is the trap). capEff-ordering is a DIGEST-ONLY presentation choice.

### 1.5 SKILL.md judgment bullet (draft; not final prose)

Add under `/scan` §2, near "Velocity vs magnitude" (already covers the churn-vs-big-ticket fuss/risk
framing) and NOT duplicating it:

> **Capital-efficiency ordering — read the digest's `capEff` column, not just Grade/Rank
> (PLACEHOLDER, n≈0).** `capEff` = after-tax ROI%/day of capital tied up (`roiPct ÷ holdDays`, a
> recycling churn lane's `holdDays` reflects its laps/day). A thin big-ticket clearing its sell
> verification can still be a **weak deploy**: `⚠ weak-deploy` flags a BIG-TICKET (≥`BIG_TICKET_GP`,
> 10m) single-turn (non-churn) pick under ~0.5% per turn — Magus (+160k/50m, 0.3%, cancelled) vs
> blowpipe (~+960k/~85m, ~1.1%) is the anchor. This is inform-only ordering/flagging — it never gates
> or drops a row, and the threshold is unvalidated until the retro-join measures real single-turn
> big-ticket fills. See "Velocity vs magnitude" above for the attention/risk framing this complements.

## 2. Workstream B — positions read every loop pass

### 2.1 What exists today

`screen-flip-niches.mjs` already runs `sync-fills.mjs --local` unconditionally as step 1 (SY1). The
"§5 position-context pass" referenced by the input plan is **`/scan`'s own judgment layer**, not a
script section — grep confirms `screen-flip-niches.mjs` has no numbered "§5"; the position-context read
is the **held-item exception** (`readOpenPositions` import, `HELD_IDS` — a held item is always shown
even if it'd otherwise be gated out) plus whatever `/positions` produces on its own separate run.
**There is currently no code path where running `/scan` alone also prints a positions verdict** — Ben
gets that only by separately invoking `/positions` (which itself calls `quote-items.mjs --positions`).

### 2.2 The cheapest correct change

This is **SKILL.md doctrine, not a mechanical script hook** — for one concrete reason: `screen-flip-
niches.mjs` and `quote-items.mjs --positions` are two different Node processes with two different
purposes (screen = find new flips; positions = judge existing holds), and folding one script's
execution into the other's would either (a) force every `/scan` run to also fetch/quote every held
item's live price (extra fetches on a pass that may run every few minutes under `run-loop.mjs --scan`),
or (b) require screen-flip-niches.mjs to import quote-items.mjs's positions-rendering path, coupling
two independently-evolving surfaces the way `render.mjs`'s header explicitly warns against (three
market-read scripts, one shared render layer, but each still owns its own compute).

**Spec**: `.claude/skills/scan/SKILL.md` gets a new mandatory step — **before or immediately after
printing the digest, run a CHEAP positions check** using data already synced this same pass:
`node pipeline/commands/quote-items.mjs --positions --quiet` (quiet/no-verbose — same AO1 discipline as
screen: read `pipeline/.cache/last-report/quote.json`, don't print the full table) and surface **only
status-changed lines**: a `BID-BEHIND` resting BUY, a stalled resting SELL (ask sitting well above
where the item is actually printing), or a fill since the last pass. "Status-changed" compares against
the prior pass's held-item verdict — this is a skill-level "did the verdict word change since I last
looked" comparison the agent makes by eye across two consecutive `/scan` runs in one session, not a new
stored field. This keeps `/scan` a single mandatory extra step (one more Node invocation, reusing the
sync that already ran) without merging two scripts' compute.

**Durable form (explicitly a follow-up, not built here)**: `run-loop.mjs --watch <min> --scan <min>`
already multiplexes `watch-positions.mjs` (the richer, alert-raising positions surface) on its own
cadence alongside the scan cadence (`pipeline/commands/run-loop.mjs`, cited in CLAUDE.md's ask→command
table). The real fix for "positions read every loop pass" is **running `/loop` with both `--watch` and
`--scan` set**, not folding positions logic into the scan script. Note this explicitly in the SKILL.md
addition so it's not silently forgotten.

### 2.3 SKILL.md addition (draft)

Under `/scan` §1, after the sync-is-code-enforced paragraph:

> **Positions check every pass (mandatory, cheap).** After syncing/scanning, run `node
> pipeline/commands/quote-items.mjs --positions` (bare/quiet — read `pipeline/.cache/last-report/
> quote.json`) and surface only lines whose verdict CHANGED since your last look this session: a new
> `BID-BEHIND`, a stalled ask, or a fill. Don't re-paste the whole positions table every scan pass —
> that's `/positions`' job on its own ask. The durable fix is running `run-loop.mjs --watch <min>
> --scan <min>` together so `watch-positions.mjs` rides its own cadence alongside the scan
> (`CLAUDE.md`'s `/loop` row) — prefer that for an unattended session; this step covers a manual
> one-shot `/scan`.

### 2.4 Acceptance

- A `/scan` run followed immediately by another `/scan` run (nothing changed) prints NO positions
  lines (status unchanged → nothing to surface).
- A `/scan` run after a fill or a verdict flip (simulate by editing `offers.json`/`positions.json` in a
  test fixture) surfaces exactly that changed line, not the whole table.
- No change to `screen-flip-niches.mjs` itself — this is pure doctrine, so no test file changes beyond
  whatever `lint-skills.mjs` structural checks already run against SKILL.md.

## 3. Workstream C — the decision digest

### 3.1 Schema

One new console block per `screen-flip-niches.mjs` run (not per niche — ONE digest spanning every
niche run this pass, pulled from the already-rated `rows` arrays before/alongside each niche's
`renderMode` table build). Columns:

```
Item | capEff | reach | phase | grade | verdict
```

- **Item** — same name/link-id shape as the existing table's first column.
- **capEff** — `%/day`, 2dp, from §1.1. `—` when `roiPct`/`ttf` unavailable (degrade, never throw).
- **reach ✓/✗** — `✓` when the row's ask-reach read (`extra.reach`/`row`'s existing reach note data,
  already computed for the `ℹ reach` footer note) shows recent reach ≥ the existing
  `REACH_GRADE_CAP_FRAC` (0.5, `js/rating.mjs:110` — REUSE this constant, don't invent a second
  reach-adequacy threshold) of recent nights; `✗` otherwise; `—` when no reach read exists for this
  spec/row (e.g. churn/value/amplitude rows that are reach-exempt by `fillShape:'symmetric'` — see
  §3.4 edge cases).
- **phase** — the `⏲` token from `diurnalPhase()` (`in-peak`/`pre-peak`/`post-peak`), rendered as the
  existing sigil+word already used in the Diurnal-timing line (don't invent new phase vocabulary); `—`
  when no diurnal profile derived (thin history, degenerate band).
- **grade** — `rateItem(...).grade`, already computed, capped exactly as the per-niche table shows it
  (thin/reach/basing/sub-floor caps all already applied upstream — the digest reads the SAME `grade`
  string, never recomputes).
- **verdict** — the ONE new computed field, §3.2.

Top ~8 rows across ALL niches run this pass, ranked by `capEff` descending (§1.4). "Top ~8" is a display
cap, not a data cap — every candidate is still in `screen.json`'s report dump / the per-niche table;
the digest is a VIEW.

### 3.2 Verdict rule table

Evaluated top-to-bottom, first match wins (a row gets exactly one verdict string). All thresholds
PLACEHOLDER (rule 4, n≈0) — this is the shape of the judgment, not a calibrated cutoff.

| # | Condition (all fields already computed upstream) | Verdict string |
|---|---|---|
| 1 | reach read exists AND recent-reach fraction < `REACH_GRADE_CAP_FRAC` (0.5) | `sell unreliable` |
| 2 | `placement(askSide)` (existing `placement()` call already feeding the Est.-buy `pXX` token) > ~0.85 AND condition 1 is false but recent-reach is still < ~0.7 | `mirage top` |
| 3 | `weakDeploy(spec, row, er)` is true (§1.3) | `weak deploy` |
| 4 | `diurnalPhase(...).phase === 'post-peak'` | `starter / hold-to-next-peak` |
| 5 | none of the above, and grade ≥ `B-` (i.e. not already sub-floor/D-capped) | `fill-now` |
| 6 | none of the above (e.g. grade < `B-`, or every upstream read degraded to null) | `low-conviction` |

Notes:
- Condition 2 ("mirage top") needs BOTH a high placement percentile AND a still-mediocre recent reach —
  a high placement with GOOD recent reach is just "a well-tested top," not a mirage (this mirrors the
  `/scan` "Above-average is not a warning sign" doctrine, `docs/MARKET-ANALYSIS.md` §4 — don't flag a
  level as mirage purely for sitting high in its own distribution). If condition 1 already fired (worse
  than condition 2's bar), condition 1 wins — the ordering in the table matters.
- Condition 3 is checked AFTER 1/2 so a weak-deploy big-ticket whose sell is ALSO unreliable reports the
  more urgent sell-side problem first (a bad sell matters more than a thin margin — you can't collect a
  thin margin you can't realize).
- Condition 4 only fires when nothing worse is true — a post-peak big winner with good reach and good
  margin is still "hold to next peak," not "fill-now," because sizing/entry timing is the point (mirrors
  the existing `/scan` diurnal-phase entry-sizing doctrine, which already treats `post-peak` as a sizing
  cue, never a gate).
- `low-conviction` is the honest fallback — it does NOT mean "bad," it means "nothing about this row
  cleared a positive signal in the rule table above"; a human glancing at the digest should read it as
  "check the full row before acting," not "skip."

### 3.3 Where it's computed and how it's gated (the key design decision)

**Recommendation: a new `--digest` flag, OFF by default; `--verbose` is unaffected; quiet stays the
agent-reasoning default.** Reasoning, against the two alternatives the prompt raised:

- *Digest-becomes-default, `--verbose` restores firehose*: rejected. Quiet is ALREADY the load-bearing
  AO1 default (an agent reads `pipeline/.cache/last-report/screen.json`, never a stdout summary) —
  making the digest the new bare-run stdout output changes what a bare run prints for the first time
  since AO1 shipped, and risks becoming a THIRD thing (quiet-json / digest-stdout / verbose-table) an
  agent has to remember when to read. It also couples "the anti-overwhelm view" to "the default console
  behavior," which means every existing screen invocation across scripts/docs implicitly changes shape.
- *A `--digest` flag* (chosen): additive, zero risk to the existing quiet/`--verbose` contract, and
  matches how every other optional presentation layer in this codebase ships (`--stats`, `--raw`,
  `--asym`, `--phase-rescue` are all opt-in flags layered onto the same base run). `/scan` SKILL.md
  is updated to make `--digest` part of the STANDARD invocation (so in practice Ben sees it every scan
  pass), while the flag itself stays off for a bare/scripted/CI-adjacent invocation that doesn't want
  extra stdout.
- The digest **prints regardless of `--verbose`** when `--digest` is passed (an agent asking for the
  digest explicitly wants console output, unlike the bare/quiet default which suppresses ALL
  console.log via the existing `emitReport`/`VERBOSE` no-op pattern) — so `--digest`'s own print path
  is a separate `if (DIGEST) console.log(...)` gate, independent of `VERBOSE`.
- **Plumbing**: follow the EXISTING `watchClosely` precedent exactly (grep `watchClosely` in
  screen-flip-niches.mjs — a cross-niche `Map` collected during each niche's `renderMode` call, then
  printed ONCE after the `RUN_MODES` loop finishes in `main()`). This is the established pattern for
  "a cross-niche summary printed after every mode's own table" — the digest should follow the SAME
  pattern (collect digest candidates into an array during `renderMode`, print once after the loop)
  rather than inventing a new report-object `kind` or awkwardly attaching to one niche's
  `extraSections`. `writeLastReport`'s AO1 per-kind dump does not need a new `kind: 'digest'` entry —
  the digest is a stdout-only, `--digest`-gated block, not part of the JSON dump contract (consistent
  with the console-only scope lock).
- Coexistence: `screen.json` / the app's Scan tab is **completely untouched** — digest is a stdout-only
  block, never written to the publish payload, matching the "console-only" scope lock at the top of
  this doc. The full note families (diurnal/reach/asym/window-clear/etc.) **stay exactly where they
  are** (the per-niche table + footer, or `verify.json` via the verification trio) — the digest never
  replaces or trims them; it's a NEW, additional, narrower view that sits ABOVE them for the "which N
  do I look closer at" triage pass.

### 3.4 Edge cases

| Case | Handling |
|---|---|
| No diurnal profile (thin history / degenerate band) | `phase` column renders `—`; verdict rule 4 (post-peak) simply never matches — falls through to rule 5/6 on the remaining signals. |
| No TTF (estimator degraded to a pure prior, `ttf.n === 0`) | `capEff` still computes (TTF always returns a value, just a wide prior — `ttfIntraday`/`ttfValue`/`ttfRising` never return null) but is LOW-CONFIDENCE; the digest does not currently carry a confidence marker — **open question, see §10**. |
| Churn / value / amplitude rows (`fillShape: 'symmetric'`, reach-exempt) | `reach` column renders `—` (not `✗`) — these theses are STRUCTURALLY exempt from the ask-reach read (per `js/flip-niches.mjs`'s fillShape doctrine), so `✗` would be a false alarm. Verdict rules 1/2 (which key off the reach read) simply skip these rows — they fall through to rule 3 (weak-deploy) or 5/6. |
| Null buy limit (`limit == null`) | Only matters for `spec.estimator === 'churn'`'s `holdDays` — `churnLapUnits` already degrades to a volume-bounded single lap when `limit` is null (existing code, `js/estimators/families.mjs:203-209`); `capEfficiency`'s laps/day formula is unaffected (it uses `er.ttf.value`, not `limit`, directly) — no special-case needed. |
| Sub-floor fallback rows (`subFloor` active) | Already grade-capped (`SUBFLOOR_GRADE_CAP`) and labeled `(sub-floor)` upstream. The digest should EXCLUDE sub-floor rows entirely (they are explicitly "nothing qualified today" per the existing `/scan` doctrine — surfacing one in a "top 8 decision digest" would contradict "sub-floor fallback tables are NOT qualified picks," §8 supersession list). |
| Held items shown via the `HELD_IDS` exception despite failing a gate | Exclude from the digest — the digest is a NEW-CANDIDATE triage view; a held item's read belongs to Workstream B's positions check, not this digest, to avoid conflating "should I buy this" with "how's my existing lot doing." |
| Fewer than 8 qualifying rows across all niches this pass | Print however many there are (no padding, no "N/A" filler rows) — a short digest is honest, not broken. |
| Zero qualifying rows | Print `(no candidates this pass)` — one line, not an empty table. |

## 4. Doc reconciliation

- **`docs/MARKET-ANALYSIS.md`** — new subsection under "§1 The output" (or a new §1a) describing the
  digest as a THIRD console view alongside the existing per-niche table and `--raw`: point to
  `js/rating.mjs`/`js/estimators/families.mjs` for capEff, `js/windowread.mjs` for phase/placement, and
  state explicitly that the digest NEVER reaches `screen.json` (so a reader doesn't go looking for it
  in the app).
- **`.claude/skills/scan/SKILL.md`** — bump `version:` frontmatter (currently `1.79` → `1.80` or
  higher depending on how many bullets land in one pass); add the §1.5 capEff bullet, the §2.3
  positions-check step, and a §3 pointer for `--digest` under the "Run the script" invocation line
  (`node pipeline/commands/screen-flip-niches.mjs --verbose --digest [...]`).
- **`README.md`** — "Map of the repo" gets NO new file entries (no new files created — capEfficiency
  lives inline in screen-flip-niches.mjs per §1.1's YAGNI call, digest is inline stdout logic in the
  same file). If `capEfficiency`/digest-building code grows past ~50 lines and earns its own file
  (e.g. `pipeline/lib/digest.mjs`), THAT change gets its own README entry at creation time per process
  rule 8 — flagged here so the implementer doesn't skip it if they choose the extracted-file path
  instead of inline.
- **`docs/ARCHITECTURE.md`** — no new load-bearing invariant is created by this plan (capEff/digest are
  both inform-only, never-gate, console-only) — confirm this stays true during implementation; if any
  threshold here is later promoted to a gate, THAT is the point a new invariant entry is warranted, not
  now.
- **Supersession grep — run before landing, reconcile in the same commit:**
  - `actionable-first-dead-last` memory / `/scan` SKILL.md's "actionable-first, dead-last" +
    "Skipped: N D-grade rows" trim rule (SKILL.md lines ~22-32): the digest does NOT replace this
    trim-when-pasting-the-table doctrine — the digest is a SEPARATE, narrower view, and the SKILL.md
    text should say so explicitly (a future reader must not conclude "the digest replaces the trim
    rule for the full table" — they're two different surfaces serving two different reads: digest =
    triage across niches, the trimmed table = the actual per-niche detail Ben reads).
  - The `/scan` "Velocity vs magnitude" bullet (churn-vs-big-ticket fuss/risk framing, SKILL.md
    lines ~303-329) is NOT superseded by capEff — that bullet is about Ben's ATTENTION/RISK preference
    (a judgment call independent of the numbers); capEff is a NEW numeric ranking signal that feeds
    the SAME decision without replacing the judgment framing. Cross-reference, don't duplicate: add
    one sentence in the new capEff bullet pointing at "Velocity vs magnitude" rather than restating it.
  - `docs/MARKET-ANALYSIS.md` §1's table-v2 column list — unaffected (digest is additive, not a column
    change to table v2).
  - No existing doc claims "RANK is the only ordering" in a way that would now read as false — `rank`
    stays the per-niche table's sort key (§1.4); only the NEW digest sorts by capEff. Confirm no doc
    currently states "RANK determines everything shown" in an absolute way that needs softening; if
    found during implementation, add one clause ("the digest additionally orders by capEff — see
    §1a") rather than rewriting the passage.

## 5. Test plan

- **`capEfficiency(spec, er)` unit fixtures** (new, alongside wherever the helper lands —
  `pipeline/test/estimators.test.mjs` if promoted to `js/estimators/families.mjs`, or a new
  `pipeline/test/screen-flip-niches.capeff.test.mjs` if kept local):
  - single-turn (band spec, `ttf.value = 43200` i.e. 12h) → `holdDays = 0.5`, `capEff = roiPct / 0.5`.
  - churn spec, `ttf.value = 1800` (30min/lap) → `laps/day = min(6, 48) = 6` → `holdDays = 1/6` →
    `capEff = roiPct * 6`.
  - churn spec, slow lap `ttf.value = 21600` (6h/lap) → `laps/day = min(6, 4) = 4` → `holdDays = 0.25`.
  - null `roiPct` (missing bid) → `capEff = null`, no throw.
  - `ttf.value = 0` (degenerate) → floors to the 1h floor, no divide-by-zero.
- **`weakDeploy` fixtures**: Magus-shaped row (mid=50m, roiPct≈0.3, estimator≠'churn') → true;
  blowpipe-shaped row (mid≈85m, roiPct≈1.1, estimator≠'churn') → false (clears the bar on margin
  alone, not via a recycling exemption — see §9.2's correction of the input plan's anchor framing) —
  a sub-10m item at any roiPct → false (not big-ticket) — a churn-estimator big-ticket at 0.3% →
  false (recycling exemption).
- **Verdict rule-table fixtures**: one row per rule (1 through 6), each engineered so exactly one
  condition fires, confirming rule ORDER (a row matching both rule 1 and rule 3 must report rule 1's
  verdict).
- **Digest render fixture**: a `screen-flip-niches.test.mjs`-style fixture run with `--mode all
  --digest` (or the equivalent programmatic call into `renderMode`/whatever function builds the
  digest) asserting: (a) at most 8 rows, (b) sorted by capEff descending, (c) sub-floor/held rows
  excluded, (d) the `(no candidates this pass)` fallback when the fixture pool is empty.
- **A real `screen-flip-niches.mjs --mode all --digest --verbose` run** (manual, part of PR review) —
  confirm stdout shows the existing per-niche tables UNCHANGED plus one new digest block, and
  `screen.json` is byte-identical to a `--mode all --verbose` run without `--digest` (diffing the
  file) — this is the hard proof the console-only scope lock held.
- **CI**: `pipeline/ci/check-imports.mjs` (new import of `BIG_TICKET_GP` into screen-flip-niches.mjs's
  existing `js/quotecore.js` import line must resolve), `lint-skills.mjs` (SKILL.md structural check,
  version bump format), `lint-docs.mjs` (denylist/structural — confirm no newly-added prose
  accidentally uses a superseded term; this is a structural/denylist checker, not semantic, so it
  won't catch a doctrine CONTRADICTION — that's why §4's manual supersession grep is still required
  by hand). All three must stay green.

## 6. Sequencing

1. **Workstream C first (the scaffold).** Build the digest's data-collection pass (which rows go in,
   the verdict rule table, the render/print path) before A or B — A's `capEff` field is a COLUMN in
   this digest, so building the digest first gives A a concrete consumer to land into rather than a
   speculative field nobody reads yet. Acceptance: `--digest` prints a correct 8-row (or fewer) table
   with `Item | reach | phase | grade | verdict` (capEff column present but reading `—` until A lands,
   OR land A in the same pass since it's a small pure function — implementer's call, but C's structure
   must exist first).
2. **Workstream A rides C.** Add `capEfficiency`/`weakDeploy`, wire into the digest's capEff column and
   sort, add the lean `suggestions.jsonl` fields, add the SKILL.md bullet. Acceptance: digest sorts by
   capEff; `⚠ weak-deploy` appears on an engineered fixture; existing per-niche table/rank/grade/
   `screen.json` byte-identical to pre-change (capEff is additive-only there).
3. **Workstream B alongside (independent of A/C).** Pure SKILL.md doctrine change — no code dependency
   on A or C, can land in parallel or in either order. Acceptance: §2.4 above.

Each workstream's acceptance criteria are independently checkable — none blocks shipping the others
except the sequencing note in step 1 (C's plumbing existing before A has somewhere to put its number).

## 7. Honesty caveats (rule 4)

- Every threshold introduced here (`WEAK_DEPLOY_ROI_PCT` 0.5, the reach-adequacy reuse of
  `REACH_GRADE_CAP_FRAC` 0.5, the placement >0.85 "mirage top" cutoff, the recent-reach <0.7 "still
  mediocre" cutoff in verdict rule 2) is a **NAMED PLACEHOLDER**, n≈0. None of them may graduate to a
  gate (drop a row, block a suggestion) without a retro-join measurement first — they inform ordering
  and a verdict WORD only.
- `capEff` inherits ALL the honesty caveats of `er.ttf`/`er.pFill` (every TTF/pFill estimator in
  `js/estimators/families.mjs` is itself an unvalidated prior, per that file's own header) — a
  `capEff` computed off a `ttf.n === 0` prior-only estimate is exactly as uncertain as the RANK number
  already is; this plan does not improve TTF's accuracy, it only reframes the SAME estimate as a
  per-day rate.
- The digest's verdict strings are DETERMINISTIC (same inputs → same output every time) but that
  determinism should not be mistaken for validation — "mechanical" and "calibrated" are different
  claims. The digest replaces some of Ben's REPEATED manual pattern-matching (which is a real
  efficiency win — that's the whole point of Workstream C) but does not replace the retro-join as the
  source of truth on whether any given rule is actually predictive.
- Workstream B's "status changed since last look" comparison is SESSION-LOCAL and MEMORY-BASED (the
  agent doing the comparing, not a stored field) — it degrades silently to "nothing to compare against"
  on the FIRST `/scan` of a session, which is correct behavior (no false "nothing changed" claim) but
  should be stated in the SKILL.md text so a future agent doesn't invent a persisted-state mechanism
  that doesn't exist.

## 8. What this plan explicitly does NOT do (scope discipline)

- Does not touch `screen.json`, `js/state.js` `APP_VERSION`, or any app-side file (`js/ui.js`, etc.).
- Does not change the per-niche table's sort key, header set, or grade computation.
- Does not build a persisted "verdict changed since last pass" state store (Workstream B is doctrine +
  a comparison the agent does in its own working memory across the session, not a new JSON field).
- Does not calibrate any threshold — every number here is provisional pending real fills.
- Does not extend `run-loop.mjs` — the "durable form" note in §2.2 is a POINTER to existing
  functionality (`--watch`/`--scan` multiplexing already exists), not new work.

## 9. Critique of the input plan (where it was underspecified or needed a fix)

1. **"laps/day bounded by the 4h buy-limit throughput" was directionally right but not a formula** —
   the input plan named the constraint without deriving it from `LIMIT_WINDOW_SEC`/`ttf.value`. §1.1
   fixes this with `min(6, 86400/ttf.value)`, grounded in two fields that already exist.
2. **The blowpipe anchor for `weakDeploy` is internally inconsistent** — the plan's own text says
   blowpipe "recycles," but blowpipe is priced/ranked under the `band`/`amplitude` niches in this
   codebase (a Masori-class big-ticket, `spec.estimator` is `'intraday'` or `'amplitude'`, never
   `'churn'`) — see the `/scan` amplitude doctrine's own blowpipe-as-amplitude-example language
   (SKILL.md §"`--mode amplitude`"). So under the exact rule in §1.3 (`spec.estimator !== 'churn'`),
   blowpipe WOULD still be checked against `WEAK_DEPLOY_ROI_PCT` — it just clears the bar (1.1% > 0.5%)
   on its own per-turn margin, not because it's exempted as "recycling." The input plan's phrase
   "AND recycles" describes blowpipe's AMPLITUDE cycle (buy the trough, sell the peak, ~daily), which
   is a single-turn-per-day pattern, not intraday churn-style relapping. **Fix applied**: `weakDeploy`
   exempts ONLY `estimator === 'churn'` (true intraday relapping), and the blowpipe anchor is correctly
   explained as "clears the bar on margin alone," not "exempted by recycling." Flagged as an
   open question below in case the owner actually meant something looser by "recycles."
3. **"Big-ticket" needed a precise definition and the plan asked to reuse existing classification** —
   there wasn't one single existing "big-ticket screen candidate" flag (the `thin` flag is gp-flow-
   admission-based, a DIFFERENT concept — a low-unit-count high-value item that got IN via the gp-flow
   path, not "any item over N gp"). §1.2 uses `BIG_TICKET_GP` (10m, `js/quotecore.js`) since it's the
   one existing per-unit-price big-ticket threshold in the codebase (used by `momVerdict`'s lot-value
   check) — closest fit to "reuse, don't invent," flagged as a judgment call since it's not a byte-for-
   byte perfect match (lot value vs per-unit mid) but the exact analogue for a pre-buy candidate.
4. **Workstream C's digest-vs-verbose coexistence needed a recommendation, not just options** — §3.3
   picks `--digest` as an additive flag over "digest becomes default" and explains why (protects the
   already-load-bearing AO1 quiet-default contract).
5. **The digest's render-object plumbing was unspecified** — §3.3 grounds it in the EXISTING
   `watchClosely` precedent (a cross-niche collection printed once after the mode loop) rather than
   inventing a new report `kind` or awkwardly attaching to one niche's `extraSections`.

## 10. Open questions for owner approval

1. **Does "AND recycles" in the blowpipe weak-deploy anchor mean something other than
   `spec.estimator === 'churn'`?** If the owner meant "any item whose position gets re-entered/re-
   cycled repeatedly over days" (i.e. amplitude's daily trough→peak cycle also counts as "recycling"
   for weak-deploy-exemption purposes), the exemption in §1.3 should read `spec.estimator !== 'churn'
   && spec.estimator !== 'amplitude'` instead. As specified now (§9.2), amplitude is NOT exempted and
   the blowpipe anchor clears purely on its 1.1% margin. Need a yes/no before implementation, since it
   changes which rows get flagged.
2. **Should `capEff` ever move from the digest into the standing per-niche table/`suggestions.jsonl`
   as a first-class (non-lean) field once it's proven useful?** Out of scope now (console-only,
   lean-field-only) but worth flagging since a useful ranking signal tends to get requested more
   broadly — decide the promotion bar (e.g. "after N real fills confirm capEff-ordering beat rank-
   ordering on a Ben-judged sample") before it happens organically without a decision point.
3. **Verdict rule 2's ("mirage top") two-threshold combination (`placement > 0.85` AND `recent-reach <
   0.7`) has no existing precedent threshold to reuse — both numbers are freshly invented for this
   plan**, unlike `WEAK_DEPLOY_ROI_PCT` reusing a documented anchor and the reach check reusing
   `REACH_GRADE_CAP_FRAC`. Flagging so the owner can veto/adjust before these are the first thing an
   agent hardcodes into working code — the "mirage top" concept is real and well-evidenced (DHCB, the
   band-top-artifact lessons throughout `/scan` SKILL.md) but this specific numeric combination is a
   guess at how to detect it mechanically, not a transcription of an existing rule.
4. **Should the digest carry a confidence/n marker** (e.g. a `low-n` suffix when `er.ttf.n === 0` or
   `er.pFill.n === 0`, mirroring how `estFields`/`estBasis` already carries `estN`/`estBasis` into
   suggestions.jsonl)? Table §3.1 currently omits this for column-count/readability reasons (the whole
   point of the digest is compactness), but it means a fully-degraded-prior row can look exactly as
   confident in the digest as a row backed by real reach data. Leaning toward NO (keep the digest
   terse; the full row in the per-niche table already carries the honesty basis for anyone who drills
   in) but flagging since it's a real tension with process rule 4 ("be honest about statistical
   limits") applied to a DELIBERATELY terse new surface.
5. **Workstream B's "status-changed" comparison being purely in-session agent memory (§7) — is that
   actually sufficient, or does Ben want it to survive across separate Claude Code sessions** (e.g. a
   new session picking up mid-day)? If cross-session persistence matters, this becomes a small stored-
   state feature (a `pipeline/.cache/last-report/positions-verdict-snapshot.json` diffed on each
   `/scan` positions-check step) rather than pure doctrine — a bigger change than §2 currently specs.
   Flagging because the input plan's "cheapest correct change" framing suggested doctrine-only, but a
   genuinely "every loop pass" requirement (as opposed to "every session's first few passes") may need
   the mechanical form the input plan explicitly deferred to `run-loop.mjs`.
