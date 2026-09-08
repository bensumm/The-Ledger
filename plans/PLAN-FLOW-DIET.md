# PLAN-FLOW-DIET — winners-only surfaces, stale-bid flagging, reclaimable capital

Drafted 2026-09-03 (Ben's ask, verbatim intent): make the general scan/positions flow more
efficient and smooth — less context waste, less noise ("I don't care about losers and why they
are losers, just tell me about the winners"), both legs checked on winners, stale bids that
aren't explicitly declared deep/long flagged for cancel/reprice, and capital tracking that
auto-updates and counts stale/cancellable bids (partial fills included) when the money has a
better home.

Chunk prefix **FD** (checked free of collisions 2026-09-03, `lint-plan-refs.mjs --collisions`).

## Context / diagnosis (verified 2026-09-03)

Three confirmed gaps; several of the asks turned out to already exist.

**1. The scan's context cost is self-inflicted by the skill.** Quiet is the script default
(`screen-flip-niches.mjs:329-335`, AO1) and the full report always lands in
`pipeline/.cache/last-report/screen.json` (`:2941-2943`), but `/scan` SKILL.md mandates
`--verbose` so the table can be pasted — a measured **910 lines / ~155k chars (~40k tokens)**
per `--mode all` run (re-rendered from the live 2026-09-02 `screen.json`). Of that, only ~56k
chars are tables; **~100k chars are per-row prose** (band footer/notes 40.8k, Diurnal-timing
stanzas 32.4k, churn notes 28.2k, Base position, Entry paths, the amplitude doctrine preamble
that prints 5 paragraphs to surface one row). On the measured run **49 of 65 band rows were
grade C/D** — rows the skill itself calls "noise, not a candidate" — and the skill then
instructs the agent to trim *after* everything has entered context (`SKILL.md:22-43`), while
other clauses countermand the trim ("relay both surfacing tiers — nothing trimmed
speculatively", `SKILL.md:52-59`). The winners-only ruling (Ben 2026-09-02) exists only as
session memory — nothing in the repo encodes it.

**2. Resting bids are second-class.** `quote-items.mjs --positions` is held-inventory only
(`runPositions`, `quote-items.mjs:635,694`); a bid on an unheld item produces no row anywhere
on that surface. The skill patches it in prose gated on "prints *no* open lots"
(`.claude/skills/positions/SKILL.md:237-240`) — with one held lot the bid side is silently
skipped. Offers carry **no placement timestamp**: `offersSnapshot` emits `lastUpdateTs`
(`pipeline/lib/reconstruct/offers.mjs:80-92`), which a partial fill resets, so "how long has
this bid rested" is unrecoverable. `/morning`'s "re-verdict stale bids" is pure judgment with
no data behind it (`.claude/skills/morning/SKILL.md:66-82` admits the gap). No declared-deep
mechanism exists for a bid — `hold-thesis.json` silences held-lot nags only.

**3. Capital already does most of what was asked.** `derive-cash-tiers.mjs:124` counts a
partially-filled bid's *unfilled remainder* as escrow, classifies exactly that remainder
deep-vs-committed (`classifyBid`, `:90-100`, `DEEP_BID_PCT = 0.05` placeholder), and folds deep
remainders into `deployablePool` (`:179`). Every scan/watch/book/run-loop pass auto-derives it.
What's missing: **age/staleness is not an input** — a week-old bid 1% under live classifies
COMMITTED forever, its escrow invisible to `deployablePool`.

Anchor incident: the 2026-09-02 scan relay that prompted the winners-only ruling — the full
C/D tail pasted every pass is what made replies unreadable (same failure the skill's own
2026-07-19 ruling at `SKILL.md:22-43` describes).

## Rulings (Ben, dated)

- **2026-09-02:** winners only — "still run the full both-leg verification, but report only the
  surviving picks; drop the 'what failed and why' section."
- **2026-09-03:** "Don't implement a grade based filter; grade is notoriously inaccurate and
  will be tuned later. Positive net seems safe." → the render filter keys on the **displayed
  net** cell, never grade. (Consistent with `SKILL.md:31-38`: grade is explicitly not a
  profitability check.)
- **2026-09-03:** "Agreed on killing prose" — the per-row stanza families leave the common
  stdout.
- **2026-09-03:** "we need to be able to reference the full set of data for debugging/analysis
  purposes but on the common run we should read cache json." → cache JSON stays complete
  always; a debug flag restores the full stdout; the skill's judgment pass reads the cache.
- **Standing (2026-07-26, re-affirmed here):** capital stays SHOWN + composed at point of use,
  never modelled/auto-corrected — the three-bucket automated redesign stays SHELVED. FD6 adds a
  shown line item, not a model change. Err on the HIGH side (Ben 2026-08-15).
- **Standing:** patience-on-cancel + never-pitch-a-chase-bid — FD4's flag is inform-only,
  frames the bid as reclaimable capital with a window-priced reprice, and a *declared* deep bid
  is silent.

## Existing scaffolding (build on, don't rebuild)

- Quiet default + `captureReport`/`writeLastReport` (`screen-flip-niches.mjs:329-360,
  2941-2943`) — the cache seam is already complete under quiet.
- The 11-line decision digest (`--digest`, prints independently of `--verbose`) — already the
  compact cross-niche winners view; untouched by this plan.
- `admitMinNet` (`js/flip-niches.mjs:215,279`) — the existing displayed-net floor and its
  named `skipped N unprofitable…` line (`screen-flip-niches.mjs:1737-1740`, "a filter you
  cannot see is a filter you cannot check") — FD1 generalizes this pattern to the render.
- `verify.json` `--out` dump pattern (`/scan` SKILL.md §2) — the read-cache-not-stdout pattern
  FD2 extends.
- `restingBuyEscrow` partial-fill handling + `suspectBidEscrow` surfacing — FD6 composes on
  these, no reconstruction changes.
- `hold-thesis.json` / `declare-thesis.mjs` — the declare-and-silence shape FD4 mirrors for
  bids.
- `offerVerdict` (BID-OK/BID-BEHIND/CROSSING/CANCEL-BID) + V1 cross-pass delta keys
  (`watch-positions.mjs:1161-1167`) — FD4's dedupe rides the same cross-pass state.

## Target architecture

One home per concern:
- **Render filtering lives in the script** (`screen-flip-niches.mjs` + `pipeline/lib/render/`),
  never in skill prose — the trim happens before stdout, not in the agent's head.
- **Full data lives in the cache** (`pipeline/.cache/last-report/*.json`), the single
  debugging/analysis surface; stdout is the human/agent triage surface.
- **Bid age lives in reconstruction** (`pipeline/lib/reconstruct/offers.mjs`) as a first-class
  field, derived once.
- **Bid declarations live beside hold-thesis** (`pipeline/lib/thesis/`), one declaration store
  pattern, not two.
- **Capital stays in `pipeline/lib/capital/`**, composed at point of use.

## Staged chunks

### FD1 — winners-only stdout render (SHIPPED 2026-09-03, `d3bc21c`)

**Execution record (supersedes two spec lines below — the shipped behavior is the contract):**
- The "thin it for survivors" clause was AMENDED in execution (Ben's kill-prose + read-the-cache
  rulings): the stanza families (Diurnal timing, Base position, Entry paths, velocity,
  accumulation) print for NO rows under `--verbose` — they are cache-only behind one pointer
  line per flip-niche; only the compact one-line `⚠`/`ℹ` notes print, for surviving rows.
  Amplitude's two honesty banners print as one-line briefs (a warning attached to a winner is
  triage signal).
- The row filter gained the HELD/WATCHLIST exemption mirrored from `admitMinNet` (review r1 —
  dropping them re-did the drop the documented load-bearing exemption exists to prevent), and
  with it the filter is **effectively unreachable by construction on band/churn/scalp**
  (`admitMinNet: 0` pre-drops non-positive rows; the exempt rows stay). It ships as defensive
  depth; the entire measured ~50% stdout cut is the stanza diet. Full analysis: README's
  `screen-flip-niches.mjs` entry.
- Landed through four review-round commits (base, amendment, r1, r2 — squashed); r2 also
  deleted the superseded R10 relay assertions from `render.mjs`'s tier-registry header.

`screen-flip-niches.mjs` (+ `pipeline/lib/render/render.mjs` as needed). Under `--verbose`:

- Per-niche tables render only rows whose **displayed net is positive** (the same net the
  `Net/u` / shown-pair cell carries — NO grade term anywhere in the predicate). Filtered rows
  collapse to ONE visible line per niche: `Skipped: N rows non-positive net at the shown pair:
  Item (net −x), Item (net −y), … (+K more)` — name up to ~10, count the rest. The existing
  `rejected:` / `crowded out:` / `skipped unprofitable` single-liners stay (already compact).
- **Kill the prose for non-survivors, thin it for survivors:** Diurnal-timing stanzas, Base
  position, Entry paths, per-row `ℹ trajectory/reach` and `⚠ caution` lines print for
  SURVIVING rows only. The amplitude doctrine preamble collapses to one pointer line.
- **New flag `--full`** restores today's complete render (all rows, all prose) for
  debugging/analysis. `--verbose` = winners view; bare = quiet one-liner (unchanged).
- **Cache contract (pinned):** `pipeline/.cache/last-report/screen.json` content is identical
  across quiet / `--verbose` / `--full` (modulo `generatedAt`) and keeps carrying every row and
  every note family — the filter is render-only. Repo-root `screen.json` (app publish) is
  untouched.
- Watchlist section and digest are OUT of scope (own doctrines; digest already compact).

Verification: (a) diff-prove the cache contract (run twice, compare `last-report/screen.json`
modulo timestamp); (b) assert the `--verbose` table row set equals the positive-net subset of
the `--full` row set on a live run; (c) `--full` output ≡ today's `--verbose` output modulo the
new flag plumbing; (d) all CI guards green, any render fixtures under `pipeline/test/` updated
in the same commit; (e) the Skipped line appears whenever ≥1 row was filtered (the
visible-filter doctrine). Pipeline/console-only — no APP_VERSION bump.

### FD2 — skill reconciliation to winners-only (SHIPPED 2026-09-03, `e41db14`)

**Execution record:** scope grew, sanctioned, to `/overnight` (its relay-both-tiers block
actively countermanded the children it invokes) and the doctrine homes (`docs/MARKET-ANALYSIS.md`
tier paragraph, README tier line) — all reconciled in place with the HELD/WATCHLIST exemption
caveat carried verbatim from the skill so the doctrine home and skill cannot drift apart.
Landed through four review-round commits (base, r1, r2, r3 — squashed). Final versions:
scan 3.8 · positions 1.68 · overnight 1.28 · morning 1.20.

`.claude/skills/scan/SKILL.md`, `.claude/skills/positions/SKILL.md`,
`.claude/skills/morning/SKILL.md`. Grep-and-fix in place (rule 8), not append:

- `/scan`: the trim-in-your-head rule (`:22-43`) becomes "paste the winners-only `--verbose`
  table as printed"; DELETE the countermanding relay-everything clauses (`:52-59` "nothing
  trimmed speculatively / surface every footer note"); encode winners-only reporting (losers
  and gate chatter are never re-narrated — the script's Skipped/rejected lines are the whole
  story). The per-niche one-line coverage rule (`:950-960`) STAYS (guards the
  salient-subtask-crowds-out-mandate failure). Watchlist honesty rules STAY.
- **Common-run data contract:** the judgment pass reads `pipeline/.cache/last-report/screen.json`
  (and `verify.json`) for anything beyond the pasted table; `--full` stdout is a debugging tool
  the skill names but never runs by default.
- `/positions`: delete the self-superseding blocks (`:40-72` corrected-then-continues,
  `:168-170` superseded-kept-"for context"); align the display contract with winners-first —
  actionable rows rendered fully, quiet/no-change rows ONE line each (the ONE-LINE-PER-ITEM
  hard rule stands unchanged).
- `/morning`: reconcile R10 ("both render AND relay by default", `:24-28`) to the same
  actionable-first shape — it currently countermands trimming wholesale.
- Every stated behavior must match FD1's actual flags/output (contract pinned above — if FD1
  landed first, verify against it; if not, cite this plan's pinned contract).

Verification: `lint-skills.mjs`, `lint-docs.mjs`, full cheap-CI green; grep CLAUDE.md + docs
for now-contradicted relay phrasing and fix in place; bump each edited SKILL.md `version:`
frontmatter (never APP_VERSION). Ship the encode/keep-as-judgment/retire disposition table for
every prose rule touched (PLANNING.md improvement-loop requirement).

**FD2 disposition table (shipped)** — every prose rule touched:

| Skill · rule | Disposition | Note |
| --- | --- | --- |
| `/scan` trim-in-your-head (grade-based row trim, 2026-07-19) | **RETIRE → ENCODE** | Superseded by FD1's positive-net render filter + its `Skipped:` line; the skill now says "paste the `--verbose` table as printed". |
| `/scan` grade-is-not-a-profitability-check (2026-08-18) | KEEP-AS-JUDGMENT (repurposed) | Kept as the *reason* the filter keys on displayed net, never grade (Ben 2026-09-03). |
| `/scan` R10 relay-both-tiers / "nothing trimmed speculatively" | **RETIRE** | Countermanded the trim; deleted. Winners-only replaces it; the tier registry pointer stays in `render.mjs`. |
| `/scan` quiet-default + cache read (AO1) | KEEP + EXTEND | Now names `--full` as debug-only and pins the common-run contract to `last-report/screen.json` + `verify.json`. |
| `/scan` §4 "note how many candidates the floor eliminated / point at a skipped high-grade row" | **RETIRE** | This *was* the "what failed and why" section Ben dropped; the script's own footer lines carry it. |
| `/scan` "Skip despite high grade" | KEEP-AS-JUDGMENT (narrowed) | The skip is now silent — reason on request only. |
| `/scan` per-niche coverage (2026-07-07) · watchlist honesty (S3) | KEEP-AS-JUDGMENT | Untouched — guards the salient-subtask failure and watchlist honesty. |
| `/positions` asym-fill CORRECTED-then-describes block | **RETIRE (collapse)** | Self-superseding; collapsed to one scope note + the measured pair. |
| `/positions` "Superseded, kept for context" 2026-07-16 verbose rule | **RETIRE** | Deleted outright; the live contract is two paragraphs above it. |
| `/positions` display contract (`table`/`alerts`/`lines`/`notes`) | KEEP + EXTEND | Adds actionable-first: actionable lots rendered fully, quiet lots ONE line. |
| ONE-LINE-PER-ITEM · `list @ X (BE Y)` per line | KEEP-AS-JUDGMENT | Unchanged, and restated inside the new bullet so the diet can't erode them. |
| `/morning` R10 "both render AND relay by default" | **RETIRE → reshape** | Now read-both-tiers / relay-actionable-first, matching `/positions`. |

### FD3 — `placedTs` on offers (SHIPPED 2026-09-03, `b9f993c` + r1 `884854c`)

**Execution record:**
- Episode identity as shipped is same-(state·item·price·max) over the slot's STAMPED rows —
  a deliberate tightening of the spec line below ("price/item change or EMPTY→offer"): `state`
  is what makes a terminal row break the run, `max` makes a re-place-at-new-size a new episode.
  Both deviations only SHORTEN age — the safe direction for a floor and for FD4 (understated
  age delays a flag; overstated would false-fire). The age is a floor over stamped rows only
  (an unstamped terminal between identical stamped runs would be invisible — measured 0 of
  ~15.3k real log rows; slotless REMOVE tombstones never enter a slot's stamped list).
- Shared `restingAge()` ('47m'/'26h'/'3.2d', `''` on null) renders on `monitor-offers.mjs`
  active-offer lines and watch's bid notes; the schema note landed in FILLS-PIPELINE **§14.2**
  (the offers.json home — the "§5.1 area" gesture below was approximate).
- Review round 1 (fuzz + mutation): the sorted-last-stamped anchor matched `supersedes()`'s
  winner in 20k random-order trials; the `state`/`max` identity checks were individually
  unpinned → fixtures amended in r1, mutations verified KILLED. Round 2 (narrow, over the r1
  diff): empty — every r1 prose claim verified at code level; its one below-threshold note
  (`item` still unpinned) was encoded with the bookkeeping commit, so all four identity
  fields are now individually mutation-killed.

`pipeline/lib/reconstruct/offers.mjs`: derive per-offer placement time (first log line of the
slot's current offer episode — a price/item change or EMPTY→offer transition starts a new
episode; a partial fill does NOT). Emit `placedTs` beside `lastUpdateTs` in `offers.json`;
schema is additive (back-compat note in FILLS-PIPELINE §5.1 area). Surfaces render age where
offers print (`monitor-offers.mjs`, `watch-positions.mjs` bid section). Foundation for FD4;
inform-only.

### FD4 — bid declaration + stale-bid flag (SHIPPED 2026-09-03, `33e8a87` + r1 `0c13296`)

**Execution record (deviations + shipped specifics):**
- Store: `pipeline/lib/thesis/bidthesis.mjs` + tracked root `bid-thesis.json` (committed `[]`,
  mirrors hold-thesis exactly), keyed item+side, `BID_THESIS_TTL_DAYS = 14`; CLI extends
  `declare-thesis.mjs` (`bid` / `bid-clear`; `list` shows both stores). Sell-side declarations
  STORE but have NO consumer yet — the flag is bid-only; the CLI says so honestly (r1 F4).
- Staleness: `pipeline/lib/signal/stalebid.mjs`, `STALE_BID_HOURS = 24` (named placeholder,
  n≈0) OR buy-dip window passed per the shared `diurnalTimedLap`, zero new fetch. By design
  most overnight bids flag their first morning (one survived dip window suffices); the calming
  lever if chatty — require N passed windows, or `reliable`-only windows — is a one-line change.
- Coverage is THREE call sites via one shared `staleBidNotes` composition: standalone-bid,
  HELD-row (accumulate-while-holding — a bid part-filled into a held lot still flags; r1 F1,
  found in review: the base commit skipped held/target ids), and CLI-target loops.
- Never-chase gate: `levelBasis === 'live'` suppresses the level (prints the re-read fallback)
  — FD4 is the FOURTH consumer of `windowread.mjs`'s repriced-bid gate (r1 F2, review-found:
  64% of a 25-item sample would have quoted live as a "window" level).
- Dedupe: V1 state key `stalebid:<id>:<offer>`; first firing prints, re-surface only on further
  fill / new whole-day age bucket / trigger-reason change. Fires on QUIET passes too (the line
  lands in `last-report/watch.json` notes), so an overnight run-loop consumes the first firing —
  `/morning` v1.22 reads the cache and says so (r1 F3).
- `bid-thesis.json` joined the nightly `--publish` add-list (NINE files; §13.3 the one home) —
  same rationale as hold-thesis (r1 F5).
- Review: round 1 five findings (above); round 2 EMPTY on code (6/6 mutations re-killed
  independently, target site live-verified). Round 2's one substantive finding was PROCESS:
  the executor's faked-home fixture runs let a manual-log-blind auto-sync corrupt the derived
  book transiently, and its "restored" claims were false twice — the reviewer healed + verified
  (fills clean via 6 content-hash REMOVE tombstones, crossbow lot intact, 466/6/4). Lesson
  encoded in agent memory: a faked-home live check must copy the real `coffer-manual.log` in,
  and must END with a real-home bare sync + a known-lot verification of `positions.json`.

### FD5 — bids always on the positions surface (NOT YET DISPATCHED)

`quote-items.mjs --positions` gains an open-offers section (winners format, one line per
offer + verdict + FD4 flag when firing) regardless of held-lot count; the prose patch in
`/positions` SKILL.md `:237-240` is deleted in the same commit.

### FD6 — reclaimable-stale capital line (NOT YET DISPATCHED, needs FD4)

Beside every `deployablePool` print (watch footer, `/book`, run-loop gate, `screen --capital`):
`+Y reclaimable from N flagged stale bid(s)` — SHOWN, composed at point of use, never folded
into the pool silently (the shelved three-bucket redesign stays shelved). Optionally the
run-loop scan gate counts it toward `--min-idle` (flagged for Ben's veto at dispatch time).

### FD7 — the drop-accounting footers behind `--full` (SHIPPED 2026-09-08)

**Execution record (the problem statement below stands as the dispatch record; every open question
is answered here, none assumed):**
- **Mechanism:** exported pure `dropAccounting()` beside `buildScreenNicheReport` — the ONE home for
  the four families' wording, the diet gate, and a structured `drops` summary; `buildNicheReport`
  pushes its `footer`/`extra` (empty under diet, byte-identical pre-FD7 lines under `--full`) and
  attaches `drops` to the report object, which rides `writeLastReport` into the dump on every run,
  identically across views (renderReport reads only `.sections`, so printing is untouched).
- **Where the accounting goes / how a suspicious removal is caught** (the doctrinal tension,
  answered with mechanism not assertion): (1) `drops` is directly addressable in the cache —
  the answer to "is a footer buried in a big JSON dump checkable?" is that a *footer* isn't but a
  named top-level key is, which is why the summary is structured rather than the serialized lines;
  (2) the diet pointer line ends `· drop accounting` whenever a pass dropped anything, so the
  surface itself says something was dropped and where it lives without naming a loser; (3) `/scan`
  v3.9 replaces the relay mandate with the recipe (read `drops` when an expected row is missing /
  Ben names an item; `--full` to debug); (4) "if the filter silently started dropping a good row
  tomorrow, what would tell us?" — the pointer suffix appears on that pass, the row + its net land
  in `drops.winnersFiltered` (or the relevant family) that same pass, and
  `pipeline/test/drop-accounting.test.mjs` pins that the accounting can never thin with the render
  (drops identical across views — a mutant computing drops only under `--full` is confirmed red).
- **`rejected:` ruled INTO the cut, with the argument made explicit** (not lumped): it IS a
  different failure mode (a candidate that never appeared vs a bad row), but the winners-only
  reader doesn't audit absent candidates off stdout — the absent-candidate question arrives as
  "why isn't X showing?", which is exactly the recipe's entry point; the validator still rejects
  identically, the count + reasons land in `drops.reject`/`rejectReasons` every pass, and the line
  prints under `--full` unchanged. Suppressing the *print* does not remove the *record*.
- **Open questions answered:** `--full` restores drop accounting on the SAME switch as the stanza
  families (`DIET = !FULL`) — one seam, not separable, matching the ruling's "no new flag". App
  `screen.json` untouched (payload built from `pubNiches`; footers never enter it — verified at the
  publish site). `read-watchlist.mjs` and `--digest` carry none of the four families (grepped all
  emission sites; watchlist rows are gate-exempt by design). The reverse-flip `(N rejected: …)`
  header is OUT of the ruling: different surface, different reader — it names Ben's OWN owned items
  that failed the harvest gate (actionable per-item inventory info on a tiny pool), not scan losers.
- **The FD1 stdout `Skipped:` line was DELETED** (it printed on no remaining path: diet suppresses
  it by ruling, full has no filtered rows) — its line-of-record is `drops.winnersFiltered`
  (name + shown net, full list, no 10-name cap). `SKIPPED_NAME_MAX` removed with it.
- **Regression test:** `drop-accounting.test.mjs`, presence AND absence off the same builder (the
  anti-renamed-string shape the problem statement demanded); 4 named mutants (gate flip, family
  rename, view-dependent drops, reintroduced Skipped line) each confirmed RED then restored green.
- **Honesty (rule 4), measured as demanded:** on a live band pass the printed families totalled
  **722 chars of a 68k `--verbose` output (~1%)** — trivially small, said plainly; the shipped case
  is Ben's thrice-stated preference + surface coherence, not tokens. (The live `rejected:` reasons
  are full sentences — ~511 chars of the 722 was that one line — so the worst case is bigger than
  the shape suggests, but still ~1%.)
- Skill/doc reconciliation in the same change: scan 3.8→3.9 (§1 winners paragraph, the crowded-out
  bullet, §4 Output, the honest-limit note), overnight 1.29→1.30, README `screen-flip-niches.mjs`
  entry, MARKET-ANALYSIS MT3 note, the in-code SC1/FD1 comments.
- **Found while here, NOT fixed (Ben's call):** `PIPELINE_VERSION` (`pipeline/lib/version.mjs`) is
  `1.3.0` but CHANGELOG carries entries titled pipeline 1.4.0–1.6.0 — the constant was never
  bumped alongside those entries (CHANGELOG is exempt from lint-docs' constant-drift check, so CI
  cannot see it). Either the constant catches up or the headers were aspirational; flagged in the
  FD7 report.

**This section deliberately does NOT contain a solution.** It states the problem, the evidence,
the ruling that constrains it, and the doctrinal tension any fix has to resolve. The executor
designs the mechanism; nothing below should be read as a prescribed implementation.

**The problem.** FD1 stopped the scan from *rendering* losing rows, but it did not stop the scan
from *talking about* them. Four footer lines survive on stdout whose entire subject is rows the
reader will never act on — what was dropped, how many, why, and by name. On a `--mode all`
`--verbose` pass these are the last thing printed under each niche, so the surface FD1 made
winners-only still ends every section with a roll-call of losers. Ben's standing instruction
("do not waste time explaining to me about the losers, let's focus on the winners", 2026-09-07 —
the third restatement of the FD1 ruling) is not satisfied by the row filter alone.

**The four sites** (all currently pushing into the same `footerLines` array consumed by
`buildScreenNicheReport`, `screen-flip-niches.mjs:1040`):

| Site | Emits | What it is accounting for |
| --- | --- | --- |
| `:1755` | `rejected: N (floor×3, reach×1)` | P2/P3 **validator** rejects |
| `:1760` | `skipped N unprofitable at the shown pair: …` | the `admitMinNet` drop |
| `:1766` | `Skipped: N rows non-positive net at the shown pair: …` | FD1's own winners filter |
| `:1947` | `crowded out: N gated candidate(s) never got a fetch slot…` | fetch-budget exclusion |

Everything else in `footerLines` concerns **surviving** rows and is out of scope: the `⚠ caution`
block already filters through `keepIds` (`:1782`), and the `ℹ` / `⤴` / `◆` / `↻` / `⚠ exemption
dropped` families only carry notes for printed rows. The scope of this chunk is those four lines
and no others — an executor that widens it has changed the ask.

**Ben's ruling (2026-09-08): it goes behind `--full`.** `--full` already means "the complete
render, debugging and analysis only, never a common pass" (`/scan` SKILL.md §1), so the restore
path is an existing seam and no new flag is introduced. `--verbose` — the flag `/scan` mandates
so a table can be pasted — must come back clean.

**The doctrinal tension the executor must resolve, not paper over.** Each of those four lines
carries an in-repo comment stating why it exists, in nearly the same words: *"A filter you cannot
see is a filter you cannot check"* (`:1758-1759`, `:1764`). That is not decoration — it is the
stated justification for why FD1's filter was safe to ship on n≈0 evidence at all: a wrong
removal is visible the moment it happens. Any change that makes a drop unobservable retroactively
removes FD1's own safety argument. The chunk therefore has to answer, with evidence rather than
assertion, *where the accounting goes and how a suspicious removal is actually caught*, and the
answer has to survive the question "if the filter silently started dropping a good row tomorrow,
what would tell us?" A design whose honest answer is "nothing would" is a failed design, even if
the console looks right.

Relevant fact, verified 2026-09-08 and offered as evidence rather than as the answer: the
per-niche report objects are written to `pipeline/.cache/last-report/screen.json` on **every**
invocation regardless of verbosity (`:2974`, AO1), and `footerLines` is a serialised part of that
object (`:1049`). Whether that is a sufficient home for drop accounting — and whether a footer
buried in a large JSON dump is meaningfully "checkable" or only nominally so — is an open
question for the executor, not a settled one.

**`rejected:` is not the same animal as the other three and should not be assumed to share their
fate.** The other three all mean "this row's shown pair does not make money" — pure loser noise
under the FD1 ruling. `rejected:` is **validator** output: a `floorValidator` reject means the
buy price sits above the durable multi-week floor, which is the falling-knife guard (the fang
anchor, and the Snape-grass entry that motivated `FLOOR_CAUTION_RANGES`). Suppressing it hides
not "a bad row" but *the reason a candidate a reader might expect to see never appeared at all* —
a different failure mode, and a silent one. Whether it belongs in this cut, belongs in it with
distinct handling, or belongs outside it is a question this chunk has to answer explicitly.
Lumping it in without argument is the specific error to avoid.

**The script change alone will regress — the skill is half the defect.** `.claude/skills/scan/SKILL.md`
(v3.8) does not merely tolerate these footers, it *mandates relaying them*: "the script's own
Skipped/rejected lines ARE the whole story, and relaying them unedited is what keeps a wrong
removal catchable", plus the `rejected:` / `crowded out:` / `skipped:` footers named in the §1
winners-only paragraph. If the script stops printing them while the skill still instructs an
agent to relay them, the next agent goes and digs them out of the cache — strictly worse than
today, because it pays the context cost *and* an extra read. Script and skill must move together
or the chunk has not shipped. The skill's prose quotes the footer wording verbatim, so
`lint-docs.mjs`'s duplicate-phrase and denylist checks are in the blast radius.

**What "done" looks like, as an outcome rather than a mechanism.** A `--verbose --mode all` pass
prints no drop accounting; a `--full` pass prints all four families as they read today; the
last-report dump is unchanged or richer, never poorer; `/scan` SKILL.md no longer instructs
relaying them and says instead what a reader should do when they *do* suspect a wrong removal;
and there is a regression test that fails if any of the four families reappears on the
`--verbose` path. Note that a test asserting absence is exactly the kind that passes for the
wrong reason (a renamed string is also an absent string) — process rule 10's mutation-check
applies with force here.

**Open questions for the executor to answer, not assume.**
- Does `--full` mean "restore these four" or "restore everything FD1 removed"? Today `--full`
  also restores the per-row stanza families; whether drop accounting rides that same switch or
  needs to be separable is undetermined.
- Is `screen.json` (the published app artifact) affected at all, or is this strictly the
  console/last-report path? The FD1 filter was render-only; this should be established, not
  presumed to match.
- `read-watchlist.mjs` and the `--digest` block are separate render paths. Do they carry any of
  the same four families, and does the ruling reach them?
- Does the reverse-flip surface's own `(N rejected: …)` header (`:2660`) fall inside this ruling
  or outside it? It is a different surface with a different reader.

**Honesty (rule 4).** Nothing here is measured. The claim that these four lines cost meaningful
context is not quantified in this write-up — FD1's ~40k-token measurement covered rows and
stanzas, not footers, and the footer families are plausibly a small fraction of that. The case
for this chunk is Ben's stated preference and surface coherence (a winners-only surface that ends
in a loser roll-call is incoherent), **not** a token saving, and it should not be sold as one. An
executor that finds the four lines to be trivially small should say so plainly rather than
inflating the benefit.

## Encoding boundary

Winners-only + prose-kill are ENCODED in the script (FD1); the skills keep only judgment
(which winner to pitch, sizing, posture) and the paste/read contract (FD2). Staleness
thresholds and `DEEP_BID_PCT` stay named placeholders — inform-only until F1-grade evidence
exists. Grade is excluded from every predicate by ruling; revisiting that is F1-tagged tuning
work, not this plan.

## Bookkeeping & compatibility

- This file cited from PLAN.md "Other unscheduled notes" (lint-plan-refs existence guard).
- `plans/` has a directory-level README entry (`README.md:1116`) — no per-file entry needed.
- FD1: no schema changes; app `screen.json` publish untouched. FD3: additive `offers.json`
  field + FILLS-PIPELINE note. FD4: new declaration store → README inventory entry at creation.
- APP_VERSION: none of FD1–FD6 touch the deployed app except FD5 only if it ripples into
  shared modules (executor states explicitly). SKILL.md `version:` bumps per edit.
- Adversarial review per process rule 10 on both dispatched chunks before they're called done.

## Honesty (rule 4)

- The positive-net render filter changes what a human sees, not what is computed — but a
  candidate whose displayed net is negative while its *patient* economics are positive would be
  hidden from stdout (it stays in the cache and the digest). Accepted by ruling; the Skipped
  line keeps it auditable.
- FD4's staleness threshold and the 5% deep line are uncalibrated placeholders (n≈0) and ship
  inform-only.
- The ~40k-token measurement is one run (2026-09-02 `--mode all`); treat as order-of-magnitude.
- **OPEN QUESTION for Ben (post-FD1) — ANALYZED 2026-09-03, awaiting ruling; not built.** The
  winners table stays large (65 band rows this pass; the FD1 filter removed ZERO — "winners" ≠
  "few"). The candidate rank-based row cap was measured and the data is AGAINST it:
  (a) rank concentration flatters the cap (top-10 = 98.0% of Σrank, 88.1% of Σnet/u, a cliff
  after #9-10) — but that cliff is a multiplicative-score artifact, not tail worthlessness;
  (b) the revealed-behavior join (124 BUY fills 08-20→09-03 → 26 items → 19 joined to a prior
  same-pass screen row): **7 of 19 real buys (37%) sat at rank position 16+** on their pre-buy
  row (Soiled page 18 · Efh salt 27 · Ironwood plank 32 · Fine fish offcuts 39 · Ironwood
  repair kit 44 · Nature rune 49 · Mist rune 56) — a top-15 cap hides over a third of what Ben
  actually trades (cheap-commodity tail; caveat: 3 of the 7 joined to rows >180h stale, so
  screen-attribution is imperfect);
  (c) rank's inputs are UNMEASURED where it matters: TTF is always the volume-scaled prior
  (`families.mjs:343` "Flaw 5: in production it's always a prior, never a measured velocity"),
  the bid-leg P(fill) counterfactual is unbuilt (EF0(c)), and the ask-leg factor's study
  settled no winner — so a rank visibility gate repeats the grade mistake (gating on an
  uncalibrated composite) with extra steps. Recommendation on record: NO row cap; residual
  band table ≈ 15k chars post-FD1 (the stanza diet was the real win); revisit only with
  F1-grade P/TTF measurement, same stance as the grade-tuning deferral.
