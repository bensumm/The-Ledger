# SKILL-TRIAGE.md — three-way triage of the market skills + memory index (Pipeline-v2 P7)

Ben's standing rule (2026-07-08, memory `docs-small-encode-in-scripts`): *"CLAUDE.md small,
no fluff, lore in a separate file; prefer encoding judgment rules in scripts/validators over
prose in skills/docs."* This file is the P7 deliverable Ben reviews: EVERY prose rule-block in
the four market skills (`/scan`, `/positions`, `/overnight`, `/morning`) and every memory-index
entry, sorted into one of three dispositions.

**Dispositions**
- **ENCODE** — a script/validator now enforces this (or a small, named code change would).
  The prose should point at that code, not restate the rule. Where already enforced, the skill
  bullet now carries the `` `code-pointer` `` tag; the "Change" column names the code.
- **KEEP-AS-JUDGMENT** — genuinely a call Ben/the LLM makes (taste, novel events, a threshold
  still in its placeholder era, or a lean off a small sample). Tagged `judgment:` in the skill.
- **RETIRE (PROPOSAL)** — superseded or duplicated; cite what supersedes it. **These are
  PROPOSALS only** — nothing is deleted in P7 beyond mechanical tagging. The prose stays until
  Ben signs off; this table records the case for removal.

**How the tags relate.** `pipeline/ci/lint-skills.mjs` (CI, cheap `checks` job) fails on any
top-level `- **…**` rule-block that carries neither a `` `code-pointer` `` nor a `judgment:`
tag. The linter is a growth-visibility heuristic, NOT a semantic checker (it cannot tell whether
a cited script actually enforces the rule) — this table is the semantic record, hand-maintained.
When a rule is added to a skill, add its row here and tag it, or CI goes red.

Counts (2026-07-09): 56 rule-blocks across the four skills — 9 ENCODE (enforced today; +1
buy-limit sizing, now `limitValidator`), 44 KEEP-AS-JUDGMENT, 1 RETIRED (the lone retire-proposal,
signed off & executed by Ben 2026-07-09 — see below), 2 F1-gated HYPOTHESIS blocks (flagged for
revisit at F1, NOT retires — see the notable list at the bottom). All 30 memory entries triaged below.

---

## /scan — `.claude/skills/scan/SKILL.md`

| Rule-block | Disposition | Change / supersession |
| --- | --- | --- |
| `--mode scalp` / `--mode value` provisional niches | KEEP-AS-JUDGMENT | Spec is coded (`js/flip-niches.mjs`); "only chase at the desk" is the judgment. |
| Niche set (NY2 — band/spread/rising in `--mode all`) | ENCODE | `js/flip-niches.mjs` `inAll` + `pipeline/commands/screen-flip-niches.mjs`; the ruling itself is a Ben decision recorded in `PLAN.md`. |
| Sync first (SY1) / run-from-main (SY1.2) | ENCODE | `pipeline/commands/sync-fills.mjs`; the run-location rule is operational, stays as prose. |
| 500k gp/day attention floor | ENCODE | `pipeline/commands/screen-flip-niches.mjs` `--min-gpd` (default 500_000). |
| SUB-FLOOR FALLBACK not qualified picks (P6c) | KEEP-AS-JUDGMENT | Mechanic in `pipeline/lib/gatecandidates.mjs`; the relay-honestly rule is judgment. |
| 24h-drift is a pre-filter only | KEEP-AS-JUDGMENT | Regime column is coded; "never recommend off 24h alone" is interpretation. |
| Two-sided liquidity discipline | ENCODE | Two-sided gate in `pipeline/lib/gatecandidates.mjs`; the ~100/day floor stays judgment. |
| Tax dominates thin flips | KEEP-AS-JUDGMENT | The >~0.5% after-tax bar is a taste threshold. |
| Band-is-the-edge pricing | KEEP-AS-JUDGMENT | Pricing call. |
| Anchor pricing — fillable side of a round number | KEEP-AS-JUDGMENT | n=2; the `anchor.mjs` probe is output-only, never a gate. |
| Entry aggression follows posture (+ new-lane, liquidity-scaling exceptions) | KEEP-AS-JUDGMENT | Posture call; `--posture` tunes screens but the entry-price taste is the LLM's. |
| Parked-capital leak (HYPOTHESIS) | KEEP-AS-JUDGMENT | Unproven lean off ~116 concentrated lots; F1-gated. Revisit at F1. |
| Velocity beats magnitude (HYPOTHESIS) | KEEP-AS-JUDGMENT | Unproven lean; crossover unmeasured. Revisit at F1. |
| Band-top artifact detection | KEEP-AS-JUDGMENT | `--min-active` supports; spotting the lone print is judgment. |
| Asymmetric ask-reach read + RC1 recency split | KEEP-AS-JUDGMENT | Method over `pipeline/commands/read-window-range.mjs` / `js/windowread.mjs`; the `⚠ stale` flag is coded, the read is judgment. Partial-ENCODE candidate → `reachValidator` once screen/quote fetch ts1h (PLAN.md P2 follow-on). |
| MANDATORY verify SELL leg before quoting profit | KEEP-AS-JUDGMENT | ENCODE candidate: `reachValidator` (`js/validate.mjs`) would enforce it, but screen/quote don't fetch ts1h yet (PLAN.md P2 follow-on). Until then it's a hard checklist step. |
| Fresh-repricer flag | KEEP-AS-JUDGMENT | Sizing call. |
| Phase tag on the Regime cell | ENCODE | `phase()` in `js/quotecore.js`, folded by `pipeline/commands/screen-flip-niches.mjs`; the "spike ≠ retrace" reading is judgment. |
| Froth entry — CLASSIFIER not PREDICTOR | KEEP-AS-JUDGMENT | `froth.mjs` probe classifies (output-only); n≈0 own trades. |
| Big-ticket caution | KEEP-AS-JUDGMENT | gp-flow gate in `pipeline/commands/screen-flip-niches.mjs`; "size in units, never chase" is judgment. |
| Skip despite high grade | KEEP-AS-JUDGMENT | Grade cutoffs are placeholders (`pipeline/lib/rating.mjs`). |
| Lane management — scale/rotate | KEEP-AS-JUDGMENT | Exposure call. |
| Peak-throughput sizing — one-window vs multi-day | KEEP-AS-JUDGMENT | Labeling discipline. |
| Buy-limit-aware sizing | ENCODE | LM1 (2026-07-09): `pipeline/lib/limits.mjs` `limitWindow` (rolling-4h math) → `js/validate.mjs` `limitValidator` (BUY-side: reject exhausted, caution near) on every suggesting surface (`screen-flip-niches.mjs`/`quote-items.mjs`); `quote-items.mjs` regime line shows bought/left/next-frees; `node pipeline/commands/read-buy-limits.mjs "<item>"` is the direct ask. The tranche-vs-multi-window framing stays judgment. Memory `buy-limit-caps-every-size`. |
| Thin CURRENT 2h band ≠ no edge | KEEP-AS-JUDGMENT | Read via `pipeline/commands/read-window-range.mjs`; the "proven lane" call is judgment. |
| Hard rules §3 (falling exclusion / watchlist section / preserve columns) | ENCODE | Falling doctrine per-spec in `js/flip-niches.mjs`; watchlist section + Note in `pipeline/commands/screen-flip-niches.mjs` (S3); columns pinned in `js/quotecore.js`. |
| Cover every niche each pass | KEEP-AS-JUDGMENT | Output-coverage discipline (memory `salient-subtask-crowds-out-mandate`). |
| Every recommended price states its timing target | KEEP-AS-JUDGMENT | Tool `pipeline/commands/read-window-range.mjs`; binding a number to a window is judgment. |
| Position-context pass §5 (stale-bid / overlap / held-ask) | KEEP-AS-JUDGMENT | Cross-check over `pipeline/commands/watch-positions.mjs`. |
| Encode-learnings boilerplate (Timing/Prompt/Routing/Execution/Honesty) | KEEP-AS-JUDGMENT | Shared self-improvement process across all four skills (see note below). |

## /positions — `.claude/skills/positions/SKILL.md`

| Rule-block | Disposition | Change / supersession |
| --- | --- | --- |
| Run the script / sync-first (SY1, SY1.2) / stale-book banner | ENCODE | `pipeline/commands/quote-items.mjs --positions`, `pipeline/commands/sync-fills.mjs`, `pipeline/commands/watch-positions.mjs` banner. |
| Reading watch-positions.mjs per-held note block (V5 EMIT CONTRACT) | ENCODE | `pipeline/lib/emit.mjs` `heldNoteBlock()`; the block shape is the code's, the doc points at it (see MONITORING.md). |
| Verdict-vocabulary table (interpret each verdict) | ENCODE | Verdicts emitted by `momVerdict()` (`js/quotecore.js`) / `renderHeldVerdict` (`pipeline/lib/item-context.mjs`); the skill translates them to actions (judgment). |
| Sell-velocity / HOLD-band-top step-down / rising-item no-underprice / decaying-band-top / trajectory read / entry-age / override-discipline / cut-and-rebid friction / tripwire conviction / limit-blocked CROSSING / fill-progress | KEEP-AS-JUDGMENT | The interpretation layer over the verdicts; several have coded support (`convictionGate` in `lib/watchstate.mjs` for tripwire-conviction; `breakEven()` floor in `js/quotecore.js`), but the step-down/hold taste is the LLM's. |
| Verify SELL leg before quoting profit (MANDATORY) | KEEP-AS-JUDGMENT | Same ENCODE-candidate as /scan's — `reachValidator` blocked on ts1h fetch. |
| Reading recovery-read (V6) as decision support | ENCODE | `pipeline/lib/recovery.mjs`; the "apply judgment on conflict" is the judgment. |
| Encode-learnings boilerplate | KEEP-AS-JUDGMENT | Shared process boilerplate. |

## /overnight — `.claude/skills/overnight/SKILL.md`

| Rule-block | Disposition | Change / supersession |
| --- | --- | --- |
| Overnight ASKS favored / DEEP BIDS disfavored (time-geography) | KEEP-AS-JUDGMENT | Volume asymmetry measured, behavioral sample small (1 win / 2 fails). |
| Weekend→weekday calendar shift (v1.11) | **RETIRED** (Ben, 2026-07-09) | Collapsed to a one-line weekday-basis check pointing at the full-day read (`--window 0-23 --nights 21`); the narrow-slice fade is folded in as an UNCONFIRMED judgment note. `/overnight` v1.15. |
| Phase 1 chase-bid sweep / STOP-and-wait / measurement-spine refresh | ENCODE | `pipeline/commands/watch-positions.mjs`, `pipeline/commands/join-outcomes.mjs`; the pause-for-capital is the interactive boundary (process). |
| Phase 2 posture screen (what it does / does not decide) | ENCODE | `pipeline/commands/screen-flip-niches.mjs --posture overnight` (S2) does the structural filtering; the sizing/retrace judgment stays. |
| Nightly-low trend / decay-trough projection / fill-realism checks | KEEP-AS-JUDGMENT | Read `pipeline/commands/read-window-range.mjs`'s per-day low column; projecting the trough is judgment (small sample). |
| Accumulation-and-capital table | ENCODE | Formula aligned with `pipeline/commands/screen-flip-niches.mjs`'s `expUnits`; the prioritization is judgment. |
| Encode-learnings boilerplate | KEEP-AS-JUDGMENT | Shared process boilerplate. |

## /morning — `.claude/skills/morning/SKILL.md`

| Rule-block | Disposition | Change / supersession |
| --- | --- | --- |
| What filled vs didn't (two sources) / sync-first / honest-gap | ENCODE | `positions.json` + `pipeline/commands/monitor-offers.mjs` + `pipeline/commands/sync-fills.mjs`; "no fabricated intent" is judgment. |
| Re-verdict stale bids / review new positions | ENCODE | `pipeline/commands/quote-items.mjs`; interpretation follows `/positions`. |
| Weekly descriptive-outcomes read (W1) | ENCODE | `pipeline/commands/join-outcomes.mjs --report`; the Monday-trigger cadence is process. |
| Honesty rules — print n / concentration caveat / one-week-one-sample | KEEP-AS-JUDGMENT | `--report` suppresses sub-`MIN_N_REPORT` cells (coded); respecting the caveat when reporting is the honesty discipline (process rule 4). |
| Encode-learnings boilerplate | KEEP-AS-JUDGMENT | Shared process boilerplate. |

**Note on the shared "Encode learnings" boilerplate.** The five bullets (Timing / Prompt /
Routing / Execution / Honesty guard) are near-identical across all four skills — the
self-improvement protocol from `docs/PLANNING.md` "The improvement loop". They are process
judgment (when/how to encode a lesson), tagged `judgment: process`. A future consolidation could
lift them into ONE shared include, but skills have no include mechanism today (they're standalone
Markdown), so duplication is the honest state — noted, not retired.

---

## Memory index — `~/.claude/projects/…/memory/MEMORY.md` (READ-ONLY — proposals only)

Memory files are **not editable in this chunk** (P7 constraint); these are proposed dispositions
for Ben. Many entries are already `→ pointer` rows (the K2 dedupe relocated the content into a
skill); those are effectively already ENCODE-or-relocated and just need to stay as pointers.

| Memory entry | Disposition | Note |
| --- | --- | --- |
| stale-branch-delete-ok | KEEP-AS-JUDGMENT | Process rule; lives in CLAUDE.md process rule 9 too. |
| arrows-on-hold-pending-update | KEEP-AS-JUDGMENT | TEMPORARY veto; retire once arrows settle post-update (Ben re-evaluates). |
| buy-limit-caps-every-size | ENCODE | LM1 (2026-07-09): `limitValidator` (`js/validate.mjs`) off `limitWindow` (`pipeline/lib/limits.mjs`) disqualifies an over-limit buy on every suggesting surface; `pipeline/commands/read-buy-limits.mjs` CLI is the direct read. The multi-window-accumulation framing stays judgment. |
| peak-timing-default-for-pricing | KEEP-AS-JUDGMENT | Method over `read-window-range.mjs`; "encode into skills later" — now in `/scan`+`/overnight` timing-target rules. |
| pricing-ok-on-ignored-items | ENCODE (partial) | `ignored-items.json` + `pipeline/lib/ignored.mjs` implement the view-filter; "pricing OK" is the judgment. |
| gather-before-recommending | KEEP-AS-JUDGMENT | Core discipline; no code gate. |
| size-scales-diligence | KEEP-AS-JUDGMENT | Diligence trigger; the trajectory read is `read-window-range.mjs`. |
| trend-check-overrides-24h-drift | KEEP (pointer) | Already `→ /scan`. |
| two-sided-liquidity-gate | KEEP (pointer) | Already `→ /scan`; gate coded in `gatecandidates.mjs`. |
| banded-liquid-item-beats-stable | KEEP (pointer) | Already `→ /scan`. |
| analysis-output-table-format | ENCODE | Table shape pinned in `js/quotecore.js` `quoteCells`; the pointer row is fine. |
| falling-exclusion-amended | ENCODE | Per-spec `falling` doctrine in `js/flip-niches.mjs` (P5). The authoritative amendment. |
| docs-small-encode-in-scripts | KEEP-AS-JUDGMENT | The meta-rule this whole chunk executes. |
| fix-at-the-source-not-derived-view | KEEP-AS-JUDGMENT | Pipeline discipline; `add-manual-fill.mjs` is the writer. |
| opportunity-cost-can-beat-patient-hold | KEEP (pointer) | Already `→ gate tree + /positions`. |
| remove-tombstones-fix-phantom-lots | ENCODE (partial) | REMOVE tombstones implemented in `sync-fills.mjs`/`add-manual-fill.mjs`; the when-to-use is judgment. |
| execute-plans-off-main | KEEP-AS-JUDGMENT | Dispatch process; mirrors PLAN.md + CLAUDE.md. **Minor drift:** says "no PRs (gh is API-reads/deploy-checks only)" — the PR path is now token-blocked-but-intended (G1); not wrong, just dated. Ben may refresh. |
| gpd-floor-500k | KEEP (pointer) | Already `→ /scan`; `--min-gpd` coded. |
| sell-velocity-over-premium | KEEP (pointer) | Already `→ /positions`. |
| per-item-session-context | KEEP-AS-JUDGMENT | Session-dossier discipline. |
| entry-aggression-follows-posture | KEEP (pointer) | Already `→ /scan`. |
| output-format-compact-lines | KEEP-AS-JUDGMENT | Output discipline; hard "one line per item" rule. |
| risk-tolerance-lean-in | KEEP-AS-JUDGMENT | User risk preference. |
| patience-on-cancel-and-cut | KEEP-AS-JUDGMENT | Partially coded (`convictionGate` arm-then-confirm damps false defensives); the default-leave-it is judgment. |
| fresh-read-before-acting | KEEP-AS-JUDGMENT | Freshness discipline. |
| state-sell-price-every-loop-item | ENCODE (partial) | `lib/emit.mjs` guarantees the sell line on every held lot (V5); the agent-side "every line carries list @ X" is the judgment mirror. |
| salient-subtask-crowds-out-mandate | KEEP-AS-JUDGMENT | Encoded into `/scan`'s per-niche coverage rule (v1.21). |

**RETIRE dispositions:**
1. `/overnight` **Weekend→weekday calendar shift (v1.11)** — **DONE** (Ben, 2026-07-09): collapsed
   to a one-line weekday-basis check pointing at the full-day read; the narrow-slice fade survives
   as an UNCONFIRMED judgment note (`/overnight` v1.15).
2. The two `/scan` **HYPOTHESIS** blocks (parked-capital leak, velocity-beats-magnitude) are NOT
   retire proposals — they're honestly F1-gated leans; flagged here so they get revisited (kept or
   promoted) when F1 opens, not left to rot.
3. No memory entry is proposed for deletion — the `→ pointer` rows are already the deduped form.
