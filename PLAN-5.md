# PLAN-5 — Project-skill architecture for the market-analysis workflow + CLAUDE.md slimming (2026-07-04)

Sequel to `PLAN-4.md`, written against main @ **0.33.0**. This plan is a departure from PLAN-2/3/4: it ships **no app code** (one small optional pipeline stdout addition, see chunk 3a). It encodes the recurring session workflow (screen → positions → judgment) as committed **project skills** under `.claude/skills/`, and *moves* per-workflow doctrine out of the always-loaded `CLAUDE.md` into those scoped skill files.

Same executor contract as prior plans: **read `CLAUDE.md` fully, then `PLAN.md`'s "Executor rules"**. Process rule 8 (reconciling doc pass — *move*, never copy; grep for superseded statements) is the load-bearing rule for the back half of this plan.

## Guardrail governing every skill (Ben, 2026-07-04)
A skill file must encode **judgment beyond the bare script call** or it does not deserve to exist. No 1:1 script wrappers — `CLAUDE.md`'s ask→command table already routes bare asks like "quote item X" to `quote.mjs`. Each skill below earns its file by adding an interpretation layer, an interactive flow, or a composition the scripts don't do themselves.

---

## Findings that shape the plan (verified 2026-07-04 — don't re-derive)

- **`.claude/` is entirely untracked.** `git status` shows `?? .claude/`; `git ls-files .claude/` is empty. `.gitignore` does not mention `.claude/`. Consequences (chunk 0): committing `.claude/skills/` is a deliberate `git add`; `.claude/settings.local.json` and `.claude/worktrees/` must be **added to `.gitignore`** so the skills commit doesn't drag local-only files (permission allowlist, worktrees) into the public repo.
- **One orphaned skill stub exists:** `.claude/skills/coffer-flip/scripts/lib.mjs` — a standalone market-fetch/tax/trend helper with **no `SKILL.md`**, duplicating logic now canonical in `js/quotecore.js` + `pipeline/marketfetch.mjs`. Nothing imports it. **Delete it in chunk 0** — it violates the "scripts are canonical" rule.
- **No `SKILL.md` exists anywhere yet.** These four are the first. Format: `.claude/skills/<name>/SKILL.md`, YAML frontmatter (`name`, `description`) + markdown instructions. The `description` is the trigger surface — pack it with Ben's real phrasings.
- **The scripts are stable and already the canonical workflow.** `quote.mjs` (`--positions`), `screen.mjs` (`--mode band|spread|rising|churn|all`, `--floor/--min-roi/--min-price/--max-price/--band-hours/--min-active/--top/--publish`), `watch.mjs`. All import `js/quotecore.js` — numbers byte-identical to the app. Skills reference these as canonical and never hand-roll a fetch.
- **Gate-tree verdict vocabulary is `MONITORING.md` step 4**, emitted by `momVerdict()`: NO-READ / DIURNAL-WATCH / SHOCK-WATCH / CUT / LIST-TO-CLEAR / HOLD / CUT-CANDIDATE. The tooling emits these; the skills *interpret*, never re-derive.
- **Buy limits are already in the pipeline, just not printed.** `marketfetch.mjs` `loadMapping()` returns `{byId:{id:{name,limit}}}` (24h cache, `mapping.cache.json`); `quote.mjs`/`screen.mjs`/`watch.mjs` all pass `limit` into `computeQuote`; `screen.mjs` line ~96 has the exact accumulation formula: `expUnits(limit, volDay) = min(limit×6, 0.10×volDay)` — buy limit refreshes ~every 4h → 6 windows/day, capped at a 10% share of limiting-side daily volume. For /overnight's ~8h sizing that's **2 windows**: `min(limit×2, 8/24 × 0.10 × volDay)`. No new fetch is needed; see chunk 3a for the surfacing decision.
- **Data cadence for /morning:** `positions.json` (open lots + closed realized after-tax P/L) and `fills.json` re-sync every 20 min via Task Scheduler (`CofferFillsSync` → `sync-fills.mjs`). `monitor.mjs` reads the live exchange log (~0 lag) — how "what filled overnight" is observed before the sync catches up.
- **Live Gate-0 datapoint (tonight's session):** `quote.mjs --positions` printed "⚠ feed inversion — quote basis unreliable" footnotes on two items, yet one (Defence potion) still received **CUT-CANDIDATE** rather than NO-READ — a possible gap where the reliability footnote doesn't gate the verdict. See chunk 1 (skill-side mitigation) and Out of scope (quotecore investigation).
- **Standing rule already in user memory (`gpd-floor-500k`):** never surface flip opportunities with `Exp gp/d` < 500k. PLAN-4 chunk B2 plans `--min-gpd` on `screen.mjs` as the structural home; until that ships, the filter lives in /scan's judgment layer.

---

## Chunk 0 — Repo hygiene + skill scaffolding (do first, one commit)

1. **Delete the orphan:** remove `.claude/skills/coffer-flip/`.
2. **`.gitignore` additions** so only skills get tracked:
   ```
   .claude/settings.local.json
   .claude/worktrees/
   ```
3. Create four skill directories, each with a `SKILL.md`: `.claude/skills/{positions,scan,overnight,morning}/SKILL.md`.
4. **Skill-versioning convention (decision — state in each SKILL.md and in CLAUDE.md):** skills-only changes **do NOT bump `APP_VERSION`** (`js/state.js`) — that's the deployed-app version marker; skills are repo-shipped doctrine, never reach the Pages build. Convention: (a) `version:` in SKILL.md frontmatter (start `1.0`), bumped on material behavior change; (b) skill changes get a one-line pointer in CLAUDE.md's "Done" list (process rule 8). Record explicitly so a future session doesn't reflexively bump `APP_VERSION`. (Exception: the optional chunk-3a pipeline stdout addition is script code — a pipeline-only stdout tweak may ship without a bump, noted in the commit message; executor's call per existing practice.)

Frontmatter template:
```yaml
---
name: <positions|scan|overnight|morning>
version: 1.0
description: <trigger phrasing — Ben's real asks; per-skill below>
---
```

---

## Chunk 1 — `/positions` (the anchor — build first)

**Why it earns a file:** interprets the PLAN-3 gate-tree verdicts into a prioritized action plan, filters incidental inventory, and runs an interactive tail the script cannot.

**`description` triggers:** "how are my positions", "check the market against what I hold", "am I underwater", "should I cut/hold anything", "review my holds", "positions".

**Body — behavior spec:**
1. **Run** `node pipeline/quote.mjs --positions`. Never hand-fetch. If `positions.json` age (printed by the script) > ~25 min, say so before interpreting.
2. **Separate flip targets from incidental inventory (new — Ben, tonight).** Open lots include loot/supplies that are not flip targets (tonight: a Defence potion, molten glass). Do **not** spend verdict/action lines on sub-noise lots. Tests, in order: (a) **watchlist membership** is the natural positive signal (same idea as the planned Ledger watchlist filter in CLAUDE.md's open followups — cite it); (b) absent watchlist data in-session, use judgment: tiny total lot value (well under any sizing threshold), consumable/loot character, never traded as a flip in `fills.json` history. Report these in one collapsed line ("incidental inventory, ignored: X, Y") and exclude them from the action plan. Never CUT-recommend an incidental lot.
3. **Interpret each verdict** (vocabulary = `MONITORING.md` step 4; the script already ran the gates):
   - NO-READ → no action; keep any ask ≥ break-even, re-check next liquid window.
   - DIURNAL-WATCH → hold ≥ break-even; don't cut into the trough.
   - SHOCK-WATCH → one more cycle.
   - CUT → clear now at instabuy (controlled loss-taking, not "staying ahead" — cite MONITORING.md's sell-side framing).
   - LIST-TO-CLEAR → list at instabuy to clear.
   - HOLD → stay listed at the 2h top / patient edge.
   - CUT-CANDIDATE → persistence-underwater; list to clear before a bigger loss.
   - **Reliability override (new — tonight's Gate-0 datapoint):** any row carrying the "⚠ feed inversion — quote basis unreliable" footnote is treated as **NO-READ-equivalent regardless of its printed verdict** (tonight a footnoted Defence potion still printed CUT-CANDIDATE). No price action off an unreliable basis. This is a skill-side mitigation pending the quotecore fix (Out of scope).
4. **Render an action plan**, grouped by urgency (cuts → list-to-clear → holds), each line: item · held@ · break-even · verdict · exact action price. Preserve the standard 9-column table as printed. Hard rules cited, not recomputed: never list below break-even `ceil(buy/0.98)`; held fallers ARE shown (screen-exclusion exception); Guide ≠ wiki `value`.
5. **Interactive tail (standalone use):**
   - Ask **available capital** → sizing against the action plan (big-ticket caution, `BIG_TICKET_GP` framing).
   - Cuts freeing GE slots → **offer `/scan`**.
   - **Offer the watch loop:** print the ready-to-paste `node pipeline/watch.mjs …` + `/loop` command per MONITORING.md (surface watch.mjs's own cadence suggestion).
   - **Composition note:** when invoked from `/overnight`, the capital question is NOT asked here — `/overnight` owns the pause-for-capital as its phase boundary (chunk 3). The tail is for standalone invocations.

**Validation (live dry-run):** invoke `/positions`; confirm it runs the script, filters incidental inventory into one line, applies the reliability override to any footnoted row, maps every verdict correctly, floors at break-even, and reaches the capital→sizing→scan→loop tail without inventing prices.

---

## Chunk 2 — `/scan`

**Why it earns a file:** `screen.mjs` gates + grades; the skill encodes the tribal judgment layer over its output.

**`description` triggers:** "find me flips", "any opportunities", "what should I buy", "screen the market", "anything in `<niche>`", "scan".

**Body — behavior spec:**
1. **Run** `node pipeline/screen.mjs` with args mapped from Ben's ask: mode → `--mode band|spread|rising|churn|all` (default `band`); price cap → `--max-price`; niche/keyword → no script flag exists — the skill filters the output rows by niche; `--publish` only if Ben wants the app Scan tab updated.
2. **Judgment pass over the rated rows** (content moved out of CLAUDE.md lines 125–140 + 186–208 — see chunk 5):
   - **500k gp/day attention floor (standing rule `gpd-floor-500k`):** drop every row with `Exp gp/d` < 500k as a **post-gate filter** — below the floor a row isn't worth Ben's time regardless of grade. Held/asked items exempt as always. Structural home is a future `--min-gpd` flag on `screen.mjs` (PLAN-4 chunk B2) — **out of scope here, like `--posture`**; the skill applies the filter to the output until it ships, then switches to passing the flag.
   - **Band-top artifact detection:** a single outlier print inflating the band (a lone 100k print vs a 59k mid) makes ROI look absurd — flag and discount; never recommend off one print.
   - **Fresh-repricer flag:** a large multi-day regime move (recently repriced) = overnight-retrace risk — Tier-B treatment, size small, skip for unattended holds.
   - **Big-ticket caution:** high per-unit capital → expensive per fill; require real gp-flow, not a unit count.
   - **"Skip despite high grade":** grade cutoffs are placeholders (`rating.mjs`); a good letter on a ghost-spread / thin / tax-eaten row is still a skip — state why.
   - **Two-sided liquidity discipline:** `/volumes` overstates tradability; `lowPriceVolume>0 && highPriceVolume>0`, ~100/day practical floor; need meaningfully >~0.5% after-tax.
   - **Band-is-the-edge pricing:** liquid + stable regime + wide band → ladder band lows/tops; never below break-even.
3. **Hard rules (cited):** falling items are silently excluded by the script — never re-add or mention (exception: held/asked items). Preserve the 9-column table.
4. Output the judgment-filtered shortlist with a one-line rationale per pick, noting how many candidates the 500k floor eliminated (tonight it cut six).

**Validation:** invoke `/scan` and `/scan <niche> spread`; confirm the script runs, the 500k floor and each judgment filter apply (point at a row skipped-despite-grade), no falling item surfaces, no hand-written fetch.

---

## Chunk 3 — `/overnight` (two-phase interactive composer)

**Why it earns a file:** composition + the overnight filter + accumulation sizing. It invokes `/positions` and `/scan` **via the Skill tool** — tweaks to the children propagate automatically; restate nothing from them.

**`description` triggers:** "set up for overnight", "what should I leave running overnight", "overnight offers", "going to bed", "overnight".

**Body — behavior spec. Explicitly TWO-PHASE and interactive, not a batch read (Ben, tonight):**

**Phase 1 — resolve positions, then PAUSE.**
1. **Invoke `/positions`** (Skill tool) → cut/hold action plan (with prices).
2. **STOP and wait.** Ben executes the cuts/re-lists in-game, then states **how much capital he has free to commit overnight**. Resolving current positions is what determines free capital + free GE slots — the capital question is the **phase boundary of /overnight**, not `/positions`' generic tail (which is suppressed when composed; see chunk 1 step 5).

**Phase 2 — scan, filter, size against stated capital.**
3. **Invoke `/scan`** (Skill tool) → candidate flips (500k floor already applied by the child).
4. **Apply the overnight filter** — revised per Ben tonight (**"stable preferred but not required"**):
   - **Hard-exclude only:** fresh repricers (large multi-day regime moves — overnight retrace risk) and falling regimes.
   - **Do NOT hard-exclude big-ticket or mildly-rising items** — optimistic buys on big tickets ARE a good overnight option. Instead **size them** (units × capital at risk) and **flag the retrace risk** explicitly on the line.
   - Prefer clean Momentum (no `↓`); an optimistic bid must plausibly fill in ~8h unattended and not be stale/underwater by morning. Lean on `diurnalRead` reasoning (PLAN-3); honesty rule (process rule 4): one prior night is one sample — prefer existing edges, don't manufacture predictions.
5. **Accumulation-and-capital table (required output — Ben's exact ask tonight: "how many can I accumulate in 8h and how much capital does that require").** For each recommended bid, the table must show:
   - **Bid price** (the optimistic buy) **and the sell price the calculation assumes** (the optimistic 2h-band sell target used for Net/u — Ben, tonight: the table "needs to include the sell price that the calculations are using"). Both on the standard quote basis; never below break-even.
   - **Expected units over ~8h** = `min(buyLimit × 2, 8/24 × 0.10 × volDay)` — buy limit refreshes ~every 4h → 2 windows overnight, capped by a realistic fill share of daily volume (the same 10%-share convention as `screen.mjs`'s `expUnits`; cite it, keep the constants aligned).
   - **Capital required** = expected units × bid price.
   - **Net/u and total if fully cycled** at the stated sell price (after 2% tax).
   - **Prioritize top-down** (best risk-adjusted edge first) so Ben takes lines until the stated Phase-1 capital runs out; show a running capital subtotal.
6. **Output the cut / hold / slot plan:** which positions were cut (Phase 1), which holds stay listed at what break-even-floored price, and the prioritized bid table with exact prices, expected units, capital per line.

**Chunk 3a — buy-limit surfacing (small decision, executor's call, state it in the commit):** the `limit` data is already fetched (`loadMapping()`) and inside `computeQuote`'s inputs, but **no table prints it**. Options: (a) **no code change** — the skill reads `pipeline/mapping.cache.json` locally (gitignored but always present after any script run) for the limits of the shortlisted items; (b) **small in-scope pipeline addition** — print the buy limit in `quote.mjs`'s per-item regime line or a `screen.mjs` footnote. Recommendation: **(b)**, one-line stdout change in `quote.mjs` (`limit` is already on hand at line ~64), because (a) makes the skill depend on a cache file's shape. It's pipeline-only script code: no `APP_VERSION` bump required (chunk 0 convention), `node --check` + a smoke run suffice. If the executor picks (a), note the cache-shape dependency in the SKILL.md.

Note (align with PLAN-4 chunk D, unbuilt): when `screen.mjs --posture overnight` ships, `/overnight` prefers it and this filter prose thins accordingly. Flag; don't block.

**Validation — the worked reference run is tonight's session:** cuts freed slots; holds re-listed (snapdragon **53,998**, mystic smoke staff **2.02m**, enhanced crystal teleport seed **3.47m**); the 500k gp/d floor eliminated **six** lower-gp/d candidates; surviving bids **soul rune 371 → 394** (50,000 units / 18.6m) and **death rune 176 → 188** (50,000 units / 8.8m), with big-ticket options (Abyssal bludgeon 17.43m → 18.46m, Toxic blowpipe 10.46m → 11.06m) sized at 1–2 fills rather than dropped. A dry-run of `/overnight` against a comparable evening state should reproduce this shape: Phase-1 plan → pause → capital stated → prioritized bid table with bid + assumed sell price + units/8h + capital per line. Confirm it actually invokes both child skills, pauses at the phase boundary, does not hard-exclude a big-ticket candidate (sizes + flags it instead), and hard-excludes a fresh repricer.

---

## Chunk 4 — `/morning` (the counterpart)

**Why it earns a file:** reads a specific set of data sources to reconstruct "what happened while I was away" and re-verdicts stale bids — a distinct judgment flow, not any single script.

**`description` triggers:** "what happened overnight", "morning review", "what filled", "catch me up", "morning".

**Body — behavior spec (data sources + judgment):**
1. **What filled vs didn't:**
   - **Realized fills** ← `positions.json` `closed` (after-tax realized P/L) + new `fills.json` events. Synced every 20 min; note the ≤20-min lag.
   - **Live truth** ← `node pipeline/monitor.mjs` (exchange log, ~0 lag): resting offers still open (didn't fill), recent fills/cancels. Monitor for freshness; positions.json for booked numbers.
   - **Honest gap:** skills are stateless — no memory of last night's placed bids. Reconstruct intent from current open offers + Ben's recollection; never fabricate what "was supposed to" fill. If PLAN-4 chunk F action-logging lands, that log becomes the memory source — flag as future input. (An `/overnight`-written summary note is another possible future input; out of scope — skills stay read-only this plan.)
2. **Re-verdict stale unfilled bids:** for each still-open offer, `node pipeline/quote.mjs "<item>"` (or `--positions` for held) → fresh gate-tree verdict; recommend keep / reprice / cancel. Never frame a sell-reprice-down as "outrunning a drop" (MONITORING.md framing).
3. **Review new positions:** `node pipeline/quote.mjs --positions` → verdict + price-to-clear for anything acquired overnight (incidental-inventory filter applies via the shared /positions doctrine).
4. **Book the realized P/L narrative:** summarize `closed` trades since last session (after-tax), what the overnight offers achieved, what to redeploy freed capital into (offer `/scan`).

**Validation:** invoke `/morning` the morning after a real `/overnight` run; confirm it reads positions.json/fills.json + monitor.mjs (no hand log-parse), re-verdicts open bids via `quote.mjs`, and books realized P/L without inventing prior-night intent.

---

## Chunk 5 — CLAUDE.md reconciliation (explicit final step — *move*, not copy)

The point of the skills is to shrink the always-loaded CLAUDE.md. This is a *move* (process rule 8: two copies drift).

### Precise section map (line numbers @ current CLAUDE.md)

**MOVE OUT (into skills):**
- **Lines 125–140 "Flipping strategy lessons"** — 24h-drift pre-filter, two-sided/ghost-spread, tax-dominates, band-is-the-edge → detail moves into `/scan` SKILL.md (band-is-edge + pricing also cited by `/positions`).
- **Lines 186–208 (per-item detail prose under the ask→command table)** → `/scan` gets the screen-flags detail; `/positions` gets the gate-tree-verdict detail. **The one-line mapping table itself (179–184) STAYS**, gaining pointers to the skills.

**KEEP IN CLAUDE.md (do NOT over-move):**
- **Lines 142–169 "standard output format" — split it.** The **table contract** (9-column layout, Quick/Optimistic definitions, the `optBuy ≤ quickBuy ≤ quickSell ≤ optSell` ordering invariant, `Mom` semantics, Guide ≠ wiki `value`, Vol/d = limiting side, after-tax Net/u, falling-excluded rule, break-even `ceil(buy/0.98)`) is **app-code canon** — it governs `js/quotecore.js` and PLAN-4 requires code changes to update it in the same commit. **It stays.** What moves is the behavioral/interpretation prose around it. Resolution rule: *if a sentence constrains the app's rendered numbers/columns, it stays; if it describes how the agent judges or presents a market read, it moves.*
- Repo structure/"What this is" (10–38), Trends structure (40–63), Done list (65–123, append a skills pointer), no-PII (231–236), process rules (238–272), STATE object (274–289), environment notes (291–316), open followups (210–229). **All stay.**

**Replace moved blocks** with a short pointer: *"The screen/positions judgment layer (500k gp/d floor, band-top artifacts, fresh-repricer flag, liquidity discipline, overnight/morning posture) lives in the committed project skills `/scan`, `/positions`, `/overnight`, `/morning` (`.claude/skills/*/SKILL.md`). The ask→command table below still routes bare asks."* Add table rows routing the workflow asks ("positions", "scan/find flips", "overnight", "morning") to the skills.

### Grep checklist (run after moving — no contradicting copy may remain)
Grep `CLAUDE.md` **and** `pipeline/MONITORING.md`; each concept survives in exactly ONE canonical home:
- `two-sided` / `ghost-spread` → canonical in `/scan`
- `24h-drift` / `pre-filter` → `/scan`
- `band IS the edge` / `band low` → `/scan` (+ `/positions` cites)
- `500k` / `gp/day floor` / `min-gpd` → `/scan` owns the behavior; PLAN-4 B2 owns the future flag — verify the two references agree
- `Falling-regime items are excluded` → stays in the CLAUDE.md contract; `/scan` cites, doesn't restate
- `Tier A` / `Tier B` → still coherent after the lessons move
- `break-even` / `ceil(buy/0.98)` → app-canon in CLAUDE.md; skills cite, never redefine
- `big-ticket` → check no leftover blanket-exclusion phrasing contradicts /overnight's "size, don't exclude" rule
- ask→command table rows → each resolves and cross-references the skills
- `standard output format` → contract half intact; no orphaned interpretation prose
Cross-check `MONITORING.md` step 4's verdict set matches what `/positions`/`/overnight` reference (no stale verdict names), and that the /positions reliability-override note doesn't contradict MONITORING.md's Gate-0 text (it extends it pending the fix — say so).

---

## Chunk 6 — User-memory overlap (flag only — NOT part of this file plan)

Skills supersede memory lessons that duplicate this doctrine:
- **`gpd-floor-500k`** — superseded once `/scan` owns the 500k post-gate filter; the memory should become a pointer to `/scan` (or be deleted when `--min-gpd` ships).
- **`opportunity-cost-can-beat-patient-hold`** (cited in MONITORING.md "Exit discipline") — encoded in `/positions` + `/overnight`.
- Any flipping-strategy memories mirroring CLAUDE.md lines 125–140 (two-sided liquidity, tax-dominates, band-is-edge) — superseded by `/scan`.

**Leave memory edits as a listed follow-up, not a file change in this plan.** A later pass enumerates the Claude memory dir and, per memory now owned by a skill, deletes it or replaces it with a pointer — avoiding the same drift the CLAUDE.md move fixes.

---

## Suggested order

**0 → 1 → 2 → 3(+3a) → 4 → 5**, memory (6) deferred.

1. **Chunk 0** — hygiene, `.gitignore`, version convention, shells.
2. **`/positions`** — the anchor; live-dry-run before anything composes it.
3. **`/scan`** — second leaf; live-dry-run.
4. **`/overnight`** (+ the 3a buy-limit surfacing decision) — only after both leaves validate; validate against tonight's reference run.
5. **`/morning`** — validate the morning after a real overnight run.
6. **Chunk 5 reconciliation LAST** — move doctrine only once the receiving skills exist and validate; run the grep checklist. Moving first leaves the doctrine homeless.

Each skill validates via a **live session dry-run**. Commits: skills + `.gitignore` in one; the optional 3a pipeline tweak in its own; the CLAUDE.md move in its own with the grep checklist evidenced in the message. **No `APP_VERSION` bump** for skills-only changes (chunk 0 convention). Work lands directly on main (Ben, 2026-07-04).

## Out of scope
App code; **the Gate-0 reliability gap** — tonight's live datapoint (feed-inversion-footnoted Defence potion still verdicted CUT-CANDIDATE instead of NO-READ) needs a `js/quotecore.js` investigation: does the `ordered`/reliability flag actually gate `momVerdict`'s output path? That's a quotecore + fixtures change (extend `pipeline/quotecore.test.mjs`), listed as a followup for a code session — the /positions skill's NO-READ-equivalent override is the interim mitigation; `screen.mjs --min-gpd` and `--posture` (PLAN-4 chunks B2/D — the skills adopt both when shipped); `rating.mjs` calibration; converting skills to subagents (rejected — scripts do the heavy lifting, skills encode judgment); skills writing any state/notes (read-only this plan); memory-file edits (chunk 6 follow-up).

## Discovered
**Open:** Gate-0 reliability-footnote-vs-verdict gap (above); no niche-filter flag on `screen.mjs` (skill filters output; a `--niche` flag is a possible future convenience).

### Critical Files for Implementation
- `CLAUDE.md` (move source; lines 125–208 are the surgical target; table contract at 142–169 stays)
- `pipeline/MONITORING.md` (gate-tree verdict vocabulary + sell-side framing the skills cite)
- `pipeline/quote.mjs` (canonical for /positions and /morning; chunk-3a buy-limit stdout addition lands here, `limit` already in scope at ~line 64)
- `pipeline/screen.mjs` (canonical for /scan; `expUnits` formula at ~line 96 is the accumulation-sizing reference)
- `.gitignore` + `.claude/skills/` (new SKILL.md files; delete the orphaned coffer-flip/ stub; exclude settings.local.json + worktrees/)
