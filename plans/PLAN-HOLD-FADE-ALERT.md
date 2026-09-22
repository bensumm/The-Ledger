# PLAN-HOLD-FADE-ALERT — a held lot whose day is under-printing its profile must ALERT, not annotate

Drafted 2026-09-21 (Ben: "We should be catching stuff like this automatically. What's the biggest
predictor/indicator of this situation?"). Executor: Fable — harden, take over, fold. Chunk prefix
`HF*` (checked free with `lint-plan-refs.mjs --collisions`). Status: DRAFT — diagnosis verified
against code and the 19:43 `watch.json`; the chunk list and the two placeholder thresholds are the
parts to harden.

## 1. Context / diagnosis

**What happened (the Diamond dragon bolts, 2026-09-21).** 11,000 Diamond dragon bolts (e) bought
2,655 (BE 2,710) at what read as `@floor`; listed 2,735 for the 02:00–07:00 PDT peak (reached 13/14d,
recent 3/3). Through the afternoon the instasell side stepped 2,651 → 2,612 → 2,620 and, on RuneLite's
live tile at ~20:00, **2,575**, while the instabuy side gave up only 2,717 → 2,690. `watch-positions.mjs`
raised `CUT` at 17:43 and `CUT-CANDIDATE` at 18:43 and 19:43. Each was relayed to Ben as a HOLD with
the label "the 1–6 gp flicker class we've been overriding all day". It was not that class: the sell
side was 40–80 gp through cost.

**The leading indicator was printed all day and never promoted.** The `--hourly` grid
(`read-window-range.mjs --hourly --days 3`, `pipeline/lib/market/hourly-lmh.mjs hourlyLMH`) shows
09-21's HIGH under its 7d-average HIGH for **twelve consecutive hours, 05:00–16:00, by 30–50 gp**,
before the 17:00 hour broke by 95. The same read compressed to one line — `ask-reach decay: ask 2.7k
reached 100%→100%→89% of each day's hours (sliding under)` (`askReachDecay`, hourly-lmh.mjs:139) — was
in the 19:43 `watch.json` **notes**, together with `cushion ⚠ fading +146→+88 (7d) · pace −85 vs 19:00
median ⚠ lagging` (`reachMargin`, `js/windowread.mjs:786`, formatted at `watch-positions.mjs:780`).
The loop-tick relay reads the `alerts` and `table` sections of `watch.json` and does not read `notes`,
so the tick output to Ben carried none of it.

**Root causes, confirmed in code:**

1. **Promotion.** The fade read is a NOTE, never an ALERT. `watch-positions.mjs`'s alert builder
   (`:371–:491`) emits CANCEL-BID / FLUSH / CUT / CUT-CANDIDATE / LIST-TO-CLEAR / NO-READ / DIURNAL /
   SHOCK and the support-break annotation; nothing in it consults `reachMargin` or `askReachDecay`.
   `read-window-range.mjs`'s `logReachMargin` (`:485`) is the ONLY place that composes the two halves
   into the `⚠⚠ cushion FADING + pace lagging today — price-to-sell-EARLY trigger`; watch prints the two
   halves separately as a compact clause and never composes them. So the one surface the loop runs
   every hour cannot fire the trigger, and the one surface that can fire it is run by hand.
2. **Magnitude.** `momVerdict()`'s `CUT`/`CUT-CANDIDATE` carry the list-at price but not the gap
   between the quick-sell and cost/BE, so a −3 gp flicker and a −76 gp break print the same word.
   The override was a judgment call with no numeric bound, and the judgment was wrong.
3. **Override discipline was violated, not missing.** `/positions` SKILL.md `:403` ("name a tripwire,
   then obey it") already exists. The 17:43 note named `cut-trigger 2,624`; the 18:50 read printed
   instasell 2,612 — through the tripwire — and the relay still said flicker. A rule that lives in prose
   and is obeyed by the relay is a rule that fails exactly when the relay is wrong.
4. **Entry.** The buy at 2,655 read `@floor`, but it was the floor of a day already trading a full step
   under its 7d profile. The scan's `softBuyRead` cue (`@floor · buy now` / `▽ caution` branches) has
   no "today's highs are under-printing" branch. The EC2 branch (`today already printed under the
   last completed low`) reads LOWS and is gated to rising-flavoured labels
   (`js/windowread.mjs:574` — `floor.dir==='rising' || healthy-trend || compressing-up`); the bolts
   were `ranging` with a flat floor, so it was structurally silent even though 09-21's lows
   (2,657–2,668) sat 5–16 gp under 09-20's (2,673). The HIGH deficit (−30 to −50, twelve hours) was
   the larger, earlier, cleaner signal and nothing reads it at entry on any label.

**Anchor:** "the Diamond bolts 12-hour under-print" (2026-09-21, highs −30…−50 vs profile 05:00–16:00,
sell side broke at 17:00, three CUT alerts overridden as flicker).

**Related, not duplicated:** PLAN-LADDERED-STEPDOWN (SD*) owns the step-DOWN ladder once an ask has
failed; this plan owns detecting the fade BEFORE the window and promoting it. `falling-item-exit-certain-clear`
(memory) already says "leading indicator = stepping-DOWN daily HIGHS" — this plan encodes that sentence.

## 2. Rulings (decided / proposed-for-veto)

- **R-HF-1 (decided, Ben 2026-09-21):** this class must be caught automatically — an hourly loop tick
  that has the signal in hand and does not surface it is a defect of the tool, not of the reader.
- **R-HF-2 (proposed default — veto?):** the predictor to encode is the **hours-under-profile count**:
  consecutive local hours today whose HIGH < the 7d-avg HIGH for that hour by ≥ `FADE_MIN_GP`, off
  `hourlyLMH`'s existing 7d-avg block. Reported with its gp magnitude. `askReachDecay` (a per-DAY rate
  of hours reaching the ask) stays as the second read; it is coarser (needs a day boundary to move)
  and is already shipped.
- **R-HF-3 (proposed default — veto?):** a `FADE` alert level in `watch-positions.mjs`, held lots
  only, firing when EITHER (a) hours-under-profile ≥ `FADE_MIN_HOURS` (placeholder 4) OR (b) the
  composed `reachMargin` trigger (cushion fading AND pace lagging — the same predicate
  `logReachMargin` prints as `⚠⚠`) is true. Inform-level alert: it never changes `momVerdict`, never
  gates, never places. It prints the magnitude, the hours, and the fold's early list-at.
- **R-HF-4 (proposed default — veto?):** `CUT` / `CUT-CANDIDATE` alert text carries the quick-sell gap
  to cost and to BE, and a `flicker` tag when |gap to BE| ≤ `FLICKER_GP` (placeholder 6, the band Ben
  actually overrode). The `/positions` override rule is amended: an override is permitted only on a
  `flicker`-tagged alert; anything else requires the named tripwire and stops being an override the
  pass the tripwire prints through.
- **R-HF-5 (proposed default — veto?):** the scan's `softBuyRead` gains a branch:
  `@floor · ▽ caution — today's highs under-printing the 7d profile N h (−X gp)`. Caution, not a veto
  (falling-exclusion is per-strategy; a churn dip into a fading day is still a legitimate scalp if the
  ask is priced to the fading level).
- **R-HF-6 (decided, process rule 11):** HF2/HF4 do not ship until HF1 has measured whether
  hours-under-profile predicts anything. If it does not beat the shipped 2h-momentum breakdown on the
  pre-registered criterion, R-HF-2 is dropped and HF2 ships on the `reachMargin` composite alone.
- **R-HF-7 (decided):** the loop-tick relay reads `watch.json` `alerts` — that stays. The fix is to put
  the signal IN `alerts` (HF2), not to teach the relay to read notes. One promotion, one home.

## 3. Existing scaffolding (not greenfield)

- `pipeline/lib/market/hourly-lmh.mjs` — `hourlyLMH(series1h,{days})` returns the 7d-avg L/M/H block
  per local hour plus the per-date columns; `askReachDecay` returns `{perDay:[{frac}], decaying}`.
  The hours-under-profile count is a fold over data `hourlyLMH` already returns. No new fetch.
- `js/windowread.mjs reachMargin(days, side, level, {profile, live, now})` — returns
  `{trend, cushionNow, cushionFrom, cushionTo, reachedRecent, pace:{…}}`; the `⚠⚠` predicate is
  `trend==='fading' && pace.lagging` (verify the exact field names at `read-window-range.mjs:485`
  `logReachMargin` before encoding — the plan does not restate them, the code is the home).
- `pipeline/commands/watch-positions.mjs` — held-lot pass already calls both (`:780–:781`) for the
  notes; `askExitRead` (`aer`) already carries `ask.reachMargin`. The alert builder at `:371–:491`
  is where a new level lands; `pipeline/lib/thesis/watchstate.mjs` holds the cross-pass persistence
  (`breakdownSince` etc.) — a `fadeSince` slot follows the same pattern if HF1 says persistence
  matters.
- `js/quotecore.js momVerdict()` — verdict + gate; `lotCtx` threaded on every production call
  (`check-verdict-guards.mjs` pins it). The quick-sell/cost gap is available there.
- `pipeline/lib/signal/softbuy*.mjs` (`softBuyRead`, ONE implementation shared by scan + positions)
  — the `@floor` cue branches; HF4 adds one.
- `pipeline/lib/market/archive-series.mjs` — the 1h archive HF1 measures against;
  `join-reach-basis.mjs` is the template for a cost-regime scorer (four regimes, r\*, no raw
  accuracy).
- `pipeline/MONITORING.md` "What each tick surfaces" — the alert vocabulary table to reconcile.

## 4. Target architecture

- **One computation, one home:** `hoursUnderProfile(series1h, {minGp})` lives in `hourly-lmh.mjs`
  beside `hourlyLMH`/`askReachDecay` (pure, returns `{hours, maxDeficit, firstHour, lastHour}`).
- **One composition:** the `⚠⚠` predicate moves OUT of `read-window-range.mjs`'s renderer into
  `js/windowread.mjs` as `reachMarginTrigger(rm) → boolean|null` so `read-window-range`, `watch`,
  and `quote-items --positions` all ask the same function. Byte-identical stdout on
  `read-window-range` is the proof.
- **One promotion:** `watch-positions.mjs` alert builder gains `FADE` (held lots), and `CUT`/
  `CUT-CANDIDATE` text gains the gap + `flicker` tag. `watch.json` `alerts[].level` grows by one
  value; MONITORING.md's table grows by one row.
- **One entry cue:** `softBuyRead` gains the under-printing branch; scan + positions get it for free.
- Nothing new in the app (`js/`) beyond the shared `windowread.mjs` helper; no APP_VERSION bump
  unless a `js/` file changes behaviour (the helper move is behaviour-neutral by construction).

## 5. Staged chunks

### HF1 — measure hours-under-profile (foundation; gates HF2's R-HF-2 half)
- **Files:** new `pipeline/commands/join-fade-outcomes.mjs`; README entry.
- **Pre-registered question:** at each archive origin (1h, every item in the 1h archive with ≥ 14
  days), does `hoursUnderProfile ≥ k` at origin predict **instabuy at origin+4h < instabuy at origin
  − FADE_MIN_GP** better than (a) `mom==='breakdown'` at origin and (b) predict-no-change? Report
  per-class (big-ticket / sub) and per k ∈ {2,3,4,6}. Cost-regime output like `join-reach-basis.mjs`
  (never a raw accuracy). Secondary: same for `askReachDecay.decaying` and for the `reachMargin`
  composite, so HF2 can cite which half carries the signal.
- **Null branch, pre-registered:** if no k beats (a) at any cost ratio in [1, 3], R-HF-2 is dropped
  and HF2 ships on the composite alone; HF4's branch then keys on the composite too.
- **Verification:** fixture with a synthetic 3-day series where day 3's highs sit 40 under the 7d
  profile for 6 hours → `hours=6, maxDeficit=40`; fixture where today is partial (5 hours logged)
  → count caps at 5 and no false "consecutive" across the unlogged tail.
- **Honesty:** n = the archive's item-days; state it in the header and in the README entry. The
  predictor is measured on the archive's smoothed 1h highs, not on 5m prints (AC2 lower-bound caveat
  applies — cite it, don't restate the number).

### HF2 — `FADE` alert + `reachMarginTrigger` composition (the live-pain fix)
- **Files:** `js/windowread.mjs` (+`reachMarginTrigger`), `pipeline/commands/read-window-range.mjs`
  (consume it — byte-identical stdout), `pipeline/commands/watch-positions.mjs` (alert), `pipeline/lib/
  thesis/watchstate.mjs` (only if HF1 shows persistence matters — else untouched), `pipeline/MONITORING.md`,
  README.
- **Alert text (one line, magnitude-first):**
  `FADE <item> — today's highs under the 7d profile <N>h (−<X> gp) · cushion <from>→<to> fading · pace −<p> lagging · price-to-sell-EARLY: list @ <fold list-at> (BE <be>)`.
  Any half that did not fire is omitted, never printed as "ok".
- **Verification:** golden stdout diff on `read-window-range.mjs` for three items before/after the
  helper move; a watch fixture (`pipeline/test/`) with a held lot whose `ts1h` is the Diamond-bolts
  09-21 shape → `alerts` contains one `FADE` with `hours=12`; the same fixture with the 09-20 shape →
  no `FADE`. `check-verdict-guards.mjs` stays green (no new `momVerdict` call).
- **Relay:** the loop tick prints `alerts`; nothing else to change. The `/loop` prose in
  `pipeline/MONITORING.md` gets the new row and nothing more.

### HF3 — CUT magnitude + `flicker` tag + override rule amendment
- **Files:** `pipeline/commands/watch-positions.mjs` (`:451`, `:457` alert text), `.claude/skills/
  positions/SKILL.md` (`:403` override-discipline paragraph — amend in place, not append),
  `pipeline/MONITORING.md`, `docs/SKILL-TRIAGE.md` disposition row.
- **Text:** `CUT-CANDIDATE <item> @ <list> — quick-sell <qs> is −<g> vs cost / −<gb> vs BE [flicker]`.
  `flicker` iff |gb| ≤ `FLICKER_GP`. The `cut-trigger` context line becomes part of the alert when
  the quick-sell is through it: `· through cut-trigger <t>`.
- **Skill amendment (judgment, tagged):** an override is permitted only on a `flicker`-tagged alert; a
  named tripwire that prints through ends the override that pass. `lint-skills.mjs` must pass (the
  rule keeps its `judgment:` tag; the tag/threshold is encoded).
- **Verification:** two watch fixtures — gap −3 → `[flicker]` present; gap −45 → absent and
  `through cut-trigger` present when the trigger is set.

### HF4 — `@floor` under-printing caution in `softBuyRead`
- **Files:** the `softBuyRead` module, `pipeline/test/` fixture, `/scan` + `/positions` SKILL.md
  soft-buy sections (one sentence each, in place), `docs/MARKET-ANALYSIS.md` §timing.
- **Branch:** `@floor · ▽ caution — today's highs under-printing the 7d profile Nh (−X gp)` when
  `hoursUnderProfile ≥ FADE_MIN_HOURS` (or the composite, per HF1's branch). Sits after the EC2
  branch in priority (EC2 is the monotone-certain one; this is the earlier, softer one).
- **Verification:** fixture with the 09-21 shape at 14:00 → caution branch; 09-20 shape → `buy now`.
  Scan stdout diff on a bare `--digest` run shows only cue-text changes.

### HF5 — fold
- Fold HF1's measured result + the shipped thresholds into `PLAN.md` (Status row per chunk, Discovered
  entry for the measurement), delete this file (`lint-plan-refs.mjs --refs PLAN-HOLD-FADE-ALERT`
  first), CHANGELOG entry, memory pointer update (`falling-item-exit-certain-clear` → "encoded as
  FADE, HF2").

## 6. Encoding boundary

| Rule | Today | Disposition |
| --- | --- | --- |
| "leading indicator = stepping-down daily highs" | memory prose | **encode** (HF1 measures, HF2 alerts, HF4 cautions) |
| `⚠⚠` sell-early composite | encoded in ONE renderer | **move to shared helper**, consumed by three surfaces |
| "1–6 gp flicker may be overridden" | unwritten session judgment | **encode** the tag (HF3); the override itself stays judgment, tagged |
| "name a tripwire, then obey it" | skill prose `:403` | **keep as judgment**, but the tripwire-through fact prints in the alert (HF3) so obeying it is reading, not remembering |
| `FADE_MIN_HOURS`, `FADE_MIN_GP`, `FLICKER_GP` | — | named placeholders, printed beside every use, HF1 sets the first two |

## 7. Bookkeeping & compatibility

- README inventory: `join-fade-outcomes.mjs` at creation (HF1); `hoursUnderProfile` +
  `reachMarginTrigger` noted in the `hourly-lmh.mjs` / `windowread.mjs` entries (HF2).
- `watch.json` shape: `alerts[].level` gains `'FADE'`; the app does not read `watch.json` (console
  surface) — confirm with a grep before claiming it, and say so in the commit.
- `screen.json`: HF4 changes cue TEXT only inside an existing cell; shape frozen.
- `lint-docs.mjs` constant-drift: the three new constants must be quoted in docs only beside their
  SCREAMING_SNAKE name or not at all.
- `check-forecast-guards.mjs` / `check-verdict-guards.mjs`: no new `diurnalForecast`/`momVerdict`
  call sites intended; if HF2 adds one, thread `phase`/`lotCtx` per the guards.
- APP_VERSION: no bump unless a `js/` behaviour changes; the helper move is stdout-diff-proven
  neutral. Pipeline version note in the commit message per rule 5.
- Adversarial review (rule 10): one pass briefed to attack HF2's "byte-identical" claim and the
  fixture's reachability; one pass scoped AWAY from watch — at HF4's scan cue and the skill prose.

## 8. Honesty (process rule 4)

- `FADE_MIN_HOURS` 4 and `FADE_MIN_GP` (proposed: max(1% of price, 1 tick)) are placeholders until
  HF1; they are printed beside every use so a wrong value is visible when acted on
  (`gate-on-error-cost-not-n`).
- `FLICKER_GP` 6 is the band that was actually overridden on 2026-09-21; it is a description of what
  happened, not a measured boundary. HF1 does not measure it; `join-outcomes` over future CUT alerts
  with the tag logged would.
- One anchor incident. The 12-hour under-print is one item on one day; HF1 is what turns it into a
  claim. Until HF1 reports, HF2's R-HF-2 half is a hypothesis with a fixture, not a finding.
- The predictor is defined on 1h-archive highs; 5m prints run below/above them (AC2). A live 5m dump
  (the 2,575 tile) will still lead the 1h read by up to an hour — FADE is an early-warning on the
  DAY, not a tick-level stop.

## 9. Verification (whole plan)

- After HF2: re-run the 2026-09-21 19:43 pass from the archived `ts1h` (fixture) → the tick output
  contains a `FADE` line for Diamond dragon bolts (e) with `12h`; the 17:43 pass → `CUT … −76 vs cost`
  without `[flicker]`.
- After HF3: a synthetic −3 gp pass → `[flicker]`; `/positions` SKILL.md diff is in-place.
- After HF4: the 09-21 14:00 scan fixture prints the caution branch for the bolts.
- After HF5: `lint-plan-refs.mjs`, `lint-docs.mjs`, `lint-skills.mjs`, `run-tests.mjs` green;
  `plans/PLAN-HOLD-FADE-ALERT.md` gone; PLAN.md Status rows carry the shas.
