# The Coffer / The-Ledger — instructions for Claude Code

This repo is the primary, ongoing place where this tool gets built and iterated on.
Expect repeated sessions here, not one-offs — check git log and this file for
context before assuming something is new.

**Live app: https://bensumm.github.io/The-Ledger/** (bookmarkable; auto-deploys on
push to `main`).

## What this is
- **The Coffer**: OSRS Grand Exchange flipping tool. `index.html` is markup only; `styles.css`
  holds all styles; logic is split into ES modules under `js/`. **No build step, no framework, no
  bundler** — deployed to GitHub Pages exactly as the files sit on disk. The **full module/file
  inventory is `README.md`** ("Files" + "Map of the repo") — the ONE registry; don't duplicate it
  here. Why it's split out of the old single `index.html`, and how localhost differs (the LW2/LW3
  live desk): `docs/LORE.md`. Local testing needs `serve.cmd` (ES modules don't load over
  `file://`); see README "Local development".
- **Fill-data pipeline**: closes the loop between the tool's suggestions and real GE trades,
  captured client-side via RuneLite's Exchange Logger. Lives in `pipeline/` (separate from the
  deployed app root); design doc `pipeline/FILLS-PIPELINE.md`, sync script `pipeline/sync-fills.mjs`
  (**on-demand only** — the `CofferFillsSync` scheduler was eliminated 2026-07-04, §12). It reads
  `.runelite/exchange-logger/*` and writes/commits/pushes `fills.json` + the derived `positions.json`
  (+ `offers.json`, LW1). `positions.json` is the FIFO-reconstructed view (`collapseOffers` +
  `matchTrades`): `closed` after-tax realised P/L, `open` inventory at real avg cost, `unmatched`
  pre-log sells. **`fills.json` and the derived artifacts are ROOT-LOCKED** (app fetches them
  same-origin — README "Map of the repo" has the full ROOT-LOCKED vs movable split + the
  `js/quotecore.js`/`js/format.js` shared-module ripple map). **Read `pipeline/FILLS-PIPELINE.md`
  §5.1 before touching the reconstruction, and the whole doc before either script path.** History of
  the pipeline's evolution: `docs/LORE.md`.

## Trends tab structure
The per-item Trends view's decision-priority tier structure (plan card → "Why this trend?"
→ price history → timing/seasonality, and the regime-guard/backtest-gate lesson) is a
**header comment at the top of `js/trends.js`** — read it before editing `runTrends`, since
that's where every editor of the view already is. (Moved out of CLAUDE.md by chunk K3.)

## Where shipped work is documented (check before assuming something is new)
Shipped changes + the "why" live in **`CHANGELOG.md`** + `git log`; the file/artifact registry is
**`README.md`**; narrative/history + superseded-approach stories are **`docs/LORE.md`**; each
load-bearing "don’t-rebuild" invariant lives in the header of the module/test that governs it (e.g.
the Gate-2-`CUT`-exempt rule in `pipeline/lib/watchstate.mjs`, the daemon’s zero-git rule in
`pipeline/watch-log.mjs`, the probe empty-passthrough contract in `pipeline/lib/modules.mjs`).
Skill-prose disposition (what's encoded vs judgment) is **`docs/SKILL-TRIAGE.md`**, enforced by
`pipeline/skill-lint.mjs` in CI. Before building something that feels new, check `git log` +
`CHANGELOG.md` — much of it already exists; don’t work from a stale assumption that a capability is
missing.

## Market judgment layer — lives in the project skills (moved by PLAN-5)
The screen/positions judgment layer (500k gp/d floor, 24h-drift-is-a-pre-filter-only,
two-sided liquidity / ghost-spread discipline, tax-dominates-thin-flips, band-is-the-edge
pricing, band-top artifacts, fresh-repricer flag, overnight/morning posture) lives in the
committed project skills `/scan`, `/positions`, `/overnight`, `/morning`
(`.claude/skills/*/SKILL.md`) — *moved* there, not copied, so it loads only when the
workflow runs. The ask→command table below still routes bare asks.

## Market analysis workflow — standard output format
Every market read presented to Ben (screen, per-item quote, position review) is ONE table
(the **table v2** column set, T1):
`Item | Guide | Quick | Optimistic | Vol/d | Momentum | Regime`
- **Quick** and **Optimistic** are each SELF-CONTAINED cells reading `buy → sell · net/u (ROI)`
  (net after 2% tax; the cell is colored gain/loss in the app). Quick = transact now (buy at live
  instasell, sell at live instabuy). Optimistic = patient 2h-band edges (last 24×5m points: min
  avgLow / max avgHigh). Mid is dropped from the table (redundant next to Guide + the live prices;
  the row model still exposes `row.mid` for `rating.mjs`/`watch.mjs`).
- **Ordering + the `Momentum` (last-2h momentum) column.** On ONE consistent basis (live `/latest` +
  2h 5m-band), optBuy ≤ quickBuy ≤ quickSell ≤ optSell holds normally; a break on MIXED bases is a bug
  (fix the script). On consistent bases the break is a real momentum tell — the live price left its own
  2h band: `quickBuy < optBuy` (instasell below the floor) = **breaking down / active pullback** (don't
  buy in; a held big-ticket flashing this is a CUT trigger that fires *before* the multi-day regime
  confirms); `quickSell > optSell` (instabuy above the top) = **breaking up / fresh high**; in-band =
  ranging. The price columns clamp opt so this is surfaced as the `Momentum` column off the *pre-clamp*
  comparison, strength-graded: `–` · `↑`/`↓` (amber) · `↑↑`/`↓↓` (≥ `MOM_STRONG_PCT`, green/red). It
  drives the position cut-trigger via `momVerdict`; deliberately NOT wired into the bulk Finder rating.
- Guide = real GE guide price, NEVER the wiki mapping `value` field (that's base/alch value).
- Vol/d = limiting side, `min(highPriceVolume, lowPriceVolume)` from the 24h endpoint.
- **Liquidity gate (S1):** two-sided (`hpv>0 && lpv>0`, the non-negotiable ghost-spread lesson) AND
  `limitVol ≥ --floor` **OR** gp-flow `limitVol×mid ≥ --gp-floor` (250m). The gp-flow path admits big
  tickets, flagged `thin`, grade-capped **A-** (`THIN_GRADE_CAP`), bounded to `--thin-reserve`. Full
  rationale in `/scan`.
- **500k attention floor (S1):** `--min-gpd` (500k) drops sub-floor `expGpDay` pre-rating — Ben's
  "never surface sub-500k" rule. Thin gp-flow qualifiers and held/asked items exempt.
- Net/u is after 2% tax. Regime = multi-day `regimeDrift` (flat/rising/falling); `screen.mjs` folds a
  **phase tag** (`spike`/`decay`/`basing`, from shared `phase()`, zero extra fetch) into the Regime
  cell — display-only, NOT a gate, pipeline-only. `--phase-rescue` (OFF by default) is an opt-in
  base-buy trial (grade-capped B, unvalidated placeholders). Full method: `/positions`, `/scan`.
- Break-even = the smallest sell price that still nets the buy cost after the 2% GE tax, computed by
  the shared `breakEven()` in `js/quotecore.js` — **tax-capped, piecewise** (BE1): `buy` when `buy<50`
  (sub-50gp sells are tax-exempt), `buy + TAXCAP` (5m) once the cap binds at `buy > 245m` (`ceil(buy/0.98)`
  overstates a big-ticket break-even by up to 5m), else the uncapped `ceil(buy/0.98)`. Never list a held
  item below it. This is the ONE definition — every other doc/skill points here.
- **Falling-regime handling is PER-STRATEGY, not global (Ben's 2026-07-08 amendment; P5).** A faller is
  not necessarily a poor buy — "we cannot judge falling without its history and typical fluctuations."
  Each niche declares its own `falling` doctrine (`js/strategies.mjs`): **band/spread/rising/churn EXCLUDE
  fallers** (the default — don't show or mention them; the exception below still applies); **scalp ACCEPTS
  them** (a deliberate intraday flip EXPECTS a falling wide band — its stop lives in the path
  engine/offerVerdict, not a blanket exclusion); **value KNIFE-GUARDS** (reject a decay/downtrend knife,
  accept a flat/basing value-low — the term-structure `valueGate`). Likewise resting bids: `offerVerdict`
  is path-aware — a bid declared under a scalp/value-hold thesis no longer CANCEL-BIDs off the falling
  regime alone, only its own tripwire (scalp: a live 2h breakdown; value-hold: a floor break).
  Exception (for the EXCLUDE niches): items Ben holds, asks about, **or watchlists** (S3) → always show, with price-to-clear
  guidance. `screen.mjs` appends a **Watchlist** section (from tracked repo-root `watchlist.json`)
  quoting every watchlisted item as a full standard row — exempt from every floor/gate, graded, with
  the reason a gate *would* have hidden it as a Note (below-floor / thin / one-sided / falling).
  Falling watchlist items ARE shown there, with the falling warning.
- Screens: `screen.mjs` prints one table per niche, adding a Grade + a per-thesis `Rank net·P/ttf`
  column to the canonical layout (P6b — Ben 2026-07-09: gp/d is OUT as the ranking metric; rank =
  `net after tax × P(fill at the quoted pair) ÷ TTF` from `pipeline/lib/estimators.mjs`, evaluated at
  the ONE price pair the thesis posts. `expGpDay` survives ONLY as the cheap pre-fetch pool orderer +
  the 500k `--min-gpd` pre-filter. Grade cutoffs in `rating.mjs` are placeholders pending validation).
- **Time-of-day context on every price recommendation (Ben, 2026-07-05).** Whenever a specific buy/sell
  price is suggested, run a `windowrange.mjs` read for the relevant local-hours window and read the level
  against the last ~14 same-window lows/highs (the NARROW-WINDOW *timing* check — "touched ≠ filled",
  ~14d is a small sample, it shifts a price a few ticks, never overrides band/regime). For a marginal/
  big-ticket hold-or-cut, the FULL-DAY multi-week *trajectory* read (`--window 0-23 --nights 21`,
  phase-mapped) is the distinct confidence tool — see `/positions` "trajectory read for confidence".
**How to generate these tables — each canonical ask maps to a skill or an exact command.
These scripts exist and ARE the workflow.** ALWAYS use them; NEVER hand-write a `node -e`
fetch for a market read (each ad-hoc script also burns ~1–2k tokens to author + parse — the
scripts exist specifically to kill that cost). All the scripts import `js/quotecore.js`, so
the numbers are byte-identical to the app's tables.

**Plain-language → command (match Ben's ask to ONE of these and run it immediately — don't
deliberate):**

| When Ben says something like… | Run |
| --- | --- |
| "how's **`<item>`**?", "quote **X**", "what's **X** doing?", "check **X** [and **Y**]" | `node pipeline/quote.mjs "<item or id>" [...more]` |
| "find me flips", "any **opportunities**?", "what should I **buy**?", "**screen** the market", "anything in **`<niche>`**?", "**scan**" | **`/scan` skill** — runs `node pipeline/screen.mjs [--mode band\|spread\|rising\|churn\|scalp\|value\|all]` + the judgment pass (scalp/value are OFF-by-default, provisional) |
| "how are my **positions**?", "check the market against **what I hold**", "am I **underwater**?", "should I **cut/hold** anything?", "review my **holds**" | **`/positions` skill** — runs `node pipeline/quote.mjs --positions` + verdict interpretation → action plan |
| "set up for **overnight**", "what should I leave running overnight", "**going to bed**" | **`/overnight` skill** — two-phase: `/positions` → pause for stated capital → `/scan` + accumulation sizing |
| "what happened **overnight**?", "**morning** review", "what **filled**?", "catch me up" | **`/morning` skill** — positions.json/fills.json + `monitor.mjs` + re-verdict stale bids |
| "watch/**monitor** my positions", "run a flipping **session**", "poll/keep an eye on **X**" | `node pipeline/watch.mjs ["<target>" …]`  (drive with `/loop`, see `pipeline/MONITORING.md`) |
| "can I **buy more** X?", "how much **buy limit** left [on X]?", "have I hit my **limit**?", "when does X's limit **reset**?" | `node pipeline/limits.mjs "<item or id>" [...]` (no args → every item bought in the last 4h) |

Script facts the skills rely on (current behavior, not doctrine):
- `quote.mjs` takes multiple items in one call; prints one combined table + a regime line
  per item that includes the **buy limit** (`· buy limit N/4h`; **LM1**: when `fills.json` shows
  logged buys inside the rolling 4h window it appends `(bought X this window — Y left, next frees
  ~HH:MM)`, local time — zero in-window buys ⇒ byte-identical to before), the **buy/sell pressure**
  (`· pressure buy 1.4× (hpv 3.05m / lpv 1.91m)` — realized trailing-24h hpv/lpv flow imbalance
  off the SAME /24h fetch; display-only, never a gate/verdict input; a flow proxy, NOT an order
  book — cite it with the shortcomings documented at the derivation in `js/quotecore.js`
  `computeQuote`; the Momentum column stays the LIVE directional tell), and a `⚠ feed inversion`
  footnote when the quote basis is unreliable. watch.mjs held/bid/target note lines carry the
  same pressure token in compact form.
- `quote.mjs --positions` adds Held@/Break-even/Verdict columns; the verdict vocabulary is
  the PLAN-3 gate tree (`MONITORING.md` step 4, emitted by the shared `momVerdict()`):
  NO-READ / DIURNAL-WATCH / SHOCK-WATCH / CUT / LIST-TO-CLEAR / HOLD / CUT-CANDIDATE, plus the
  V3 Gate-D softenings WATCH — fresh entry (fresh lot) / HOLD — ask filling (own ask filling
  above the clear). **P0** wired it through the shared `pipeline/lib/context.mjs` chain: it now
  reads the root `offers.json` book (so `HOLD — ask filling` actually prints — quote lacked an
  offer read before), reads the watch loop's `.cache/watch-state.json` READ-ONLY for a conviction
  line, renders the verdict via the ONE shared `renderHeldVerdict`, and runs one `loadSnapshot()`
  per pass for the passive Tier-1 archive append. **P4b** adds a `Paths` block per held lot — the
  persistence-gated dominant thesis-path + weighed menu (shared `renderPathLine`, placeholder
  weights; a confirmed migration prints `path MIGRATED a → b`) — decision support, never an alert;
  read-only off the shared watch-state (only watch.mjs persists it). Interpretation of those
  verdicts lives in `/positions`.
- `screen.mjs` shares one gate stack (two-sided liquidity **OR** `--gp-floor` gp-flow, price window,
  `--min-gpd` 500k attention floor, per-spec falling doctrine); `--mode` swaps the step-3 edge (+ the
  gate stack for value). **Six niches** — `band` / `spread` / `rising` / `churn` / `scalp` / `value` —
  but per Ben's **NY2** ruling (2026-07-05) + **P5** **`--mode all` runs band/spread/rising only;
  churn/scalp/value are off-by-default** (reach each with an explicit `--mode <name>`). `rising`'s
  candidate pool carries a NY2.1 noise floor (big-ticket **OR** liquid, `risingPoolFloor`) that drops the
  cheap teleport-tab flood while keeping cheap-but-liquid risers. Thin gp-flow big tickets ride a bounded
  `--thin-reserve`. **P5 scalp** (provisional, n≈0): a DELIBERATE intraday flip on a FALLING market
  (`spec.falling='accept'`) — a wide fresh band clearing tax+scalp-margin (`SCALP_MIN_ROI`), reach-
  validated on today's high, flip-only/no-hold (an unsold lap migrates to `cut`, never `hold-recovery` —
  encoded in `js/paths.mjs`). **P5 value** (provisional, n≈0): a buy-hold niche with its OWN
  term-structure gate (`js/valuescreen.mjs` + `js/termstructure.mjs` — after-tax cycle-amplitude floor
  replaces the 500k gp/day throughput floor, lowered liquidity, decay/downtrend knife-guard), ranked by
  `valueScore` (amplitude × proximity-to-low × floor-stability) with a HARD top-N + buy-now/watch tiers
  (§F flood control); console-only, its own table, NOT in `screen.json` (no app tab yet → no APP_VERSION).
  **P4c**: the niches are DECLARATIVE
  strategy specs (`js/strategies.mjs` — `{key,pool,edge,rank,confirm,falling,gate,validators,defaultPath}`) that
  `gatecandidates.mjs` drives by `mode` lookup instead of `if (mode===…)` branches (byte-identical — the
  P1 replay goldens pin it; a new niche registers a spec, no gatecandidates/screen edit). Each surfaced
  row gains a compact stdout entry-path annotation (`↳ <item> — scalp* 0.60 · …`: the spec's inferred
  default entry path `*` + the weighed js/paths.mjs menu) — decision SUPPORT, display-only, NOT in
  `screen.json`; and the spec's `defaultPath` is logged to `suggestions.jsonl` as a lean `path` field so a
  later fill can infer the entry thesis. The default-path map (band/spread/churn→`scalp`, rising→
  `value-hold`) is a Ben-vetoable judgment proposal, not a gate. **P6c**: a niche whose gate is EMPTY at
  the configured floors re-runs beneath the floor (`subFloorFallback` — a min-gpd→liquidity relaxation
  ladder; the two-sided gate + the thesis edge are NEVER relaxed) and prints the best ≤5 rows labeled
  `sub-floor — shown because nothing cleared <floor>`, grades capped `C (sub-floor)` — stdout-only,
  never in `screen.json`, ledger rows carry a lean `subFloor` marker; a non-empty niche is untouched.
- **P2/P3 validators (`js/validate.mjs`, run on EVERY surface):** a registry of PURE
  `(ctx)→{status:pass|caution|reject,reason,evidence}` validators. Screens DROP `reject` rows (counted
  in `--stats` + a `rejected: N (top reasons)` footer) and FLAG `caution`; explicit asks / held /
  watchlist rows are NEVER hidden (a fired flag is a NOTE + a lean `validators` field on the
  suggestions ledger). **Per-thesis GATE vs INFORM (2026-07-09):** a validator's COMPUTATION is
  thesis-agnostic (the swing/local-min/knife/reach analysis is useful to every buy) but its ACTION is
  declared per-thesis in `spec.validators` (`js/strategies.mjs`) as `{key,mode,window}` — `gate` (the
  verdict stands: caution flags, reject drops) or `inform` (COMPUTED + annotated as a `ℹ trajectory/reach`
  note, status clamped to pass, the would-have verdict logged for the track record; **never drops a row**).
  `screen.mjs` drives `runValidators(ctx,{specs})` off that plan (was: the whole registry). This is the
  noise reconciliation — only a thesis that GATES on a key lets it hide a row (so `scalp` INFORMS on
  trajectory: it accepts a falling wide band by thesis). ROLLOUT (rule 4, n≈0): the newly-activated
  `reach`/`trajectory`/`value-amplitude` start **inform everywhere**; only the already-live `floor`+`limit`
  gate. `reachValidator` (P2) wraps `js/windowread.mjs`'s reach/touch + RC1 stale split (a rarely-reached
  level → caution, never-reached → reject, stale-optimistic bumps one step); it needs the 1h series —
  **`screen.mjs` now fetches it for surfaced SURVIVORS** (Leg B, 2026-07-09: `TS_TTL_1H`, survivor-only so
  ~one 1h fetch per surfaced row, not per candidate) so reach FIRES on the screen; `quote.mjs` still
  doesn't fetch it, so reach degrades there. `trajectoryValidator` (2026-07-09, BUY-side) is the SHAPE
  read (distinct from floor's LEVEL read): `js/termstructure.mjs`'s `classifyTrajectory` off the daily-mid
  series labels **knife** (spike + monotone-down lows — the Nightmare-staff catch → reject), **oscillating**
  (repeating local minima around a flat/declining mean — a falling-BUT-buyable rhythm like Hydra leather →
  pass, buy the local min), **based** (flat at the floor → pass), **elevated** (bought high → caution).
  `screen.mjs` feeds it a trajectory derived from the fetched **1h series** (`trajectoryFrom1h`, off the
  shared `richFrom1h` helper) so it fires NOW while the `loadDaily` archive is still cold.
  `valueAmplitudeValidator` (2026-07-09, value niche, BUY-side) reads the recent-WEEK (7d) after-tax
  amplitude + proximity-to-low off that **same warm 1h-derived term structure** (`richFrom1h`, `current`
  overridden to the live price so proximity is "is live near the week low right now?") — so it, too, fires
  now instead of degrading on the cold `loadDaily` 7d slice; `valueRanges`/`valueGate`/`floor` keep the
  `loadDaily` proxy (their tuned multi-week basis). `floorValidator` (P3, BUY-side only) wraps
  `js/termstructure.mjs`'s durable multi-week **floor** + **typical fluctuation** (the 1/3/7/14/28d term
  structure over the daily-mid series): a buy parked well above where the 14/28d structure says support
  durably prints (the decay-knife shape) → reject, marginally-elevated → caution, at/below the floor → pass.
  It reads the `loadDaily` regime-proxy series ALREADY at gate time on `screen.mjs` and the read-only
  archived daily mids (`loadDaily …{noFetch:true}`) on a per-item `quote.mjs` buy read — no fetch-semantics
  change; a HELD lot (`quote --positions`) is a sell decision so it degrades. The archive only began
  accruing 2026-07-08, so a thin/cold series DEGRADES to pass (a real reject needs a warm multi-week
  series). Thresholds are named PLACEHOLDERS. **`limitValidator` (LM1, BUY-side)** wraps the rolling-4h
  `limitWindow` (`pipeline/lib/limits.mjs`, fed per-item buys from `fills.json` via `buysByItem`): a
  suggested buy whose 4h window is EXHAUSTED (`remaining === 0`) → **reject** (screen drops + counts it,
  naming when it next frees; quote/held/watchlist NOTE it), nearly-spent (`< LIMIT_CAUTION_FRAC` of the
  limit) → **caution**. Absent stage (the browser app supplies none) or a null/UNKNOWN limit → degrade
  to pass (a null limit is never "unlimited"). Honesty: logged fills only, so it can UNDER-count buys —
  a pass is never a guarantee. No app module imports `validate.mjs`, so no APP_VERSION bump.
- `screen.mjs --posture overnight|active|auto` (S2) TUNES that stack (not a new niche): **overnight**
  keeps only flat/rising + confident-band + non-thin + non-breakdown rows, ranks by net edge over
  velocity, and drops items whose *yesterday overnight window* printed below the current bid
  (`overnightStaleRisk`); **auto** picks by the local clock (~22:00–06:00); **active** (default) =
  current behavior. Posture is recorded in `screen.json` so the Scan banner names it. `/overnight`
  runs `--posture overnight`. `quote.mjs --positions` prints an informational late-night morning-
  staleness line (verdict logic unchanged).
- `watch.mjs` watches every **position** = *any committed capital*: held inventory PLUS every active GE
  offer (Ben's definition; shared reader `pipeline/lib/offers.mjs`). Output is headline (alerts up front)
  → one numbers-only table → a per-item note block → summary footer (full shape + the V5 held-lot EMIT
  CONTRACT and the V6 `recovery-read`/freed-capital advisories are documented in `MONITORING.md` "What
  each tick surfaces"). Load-bearing: the **sell/list-at + break-even line is ALWAYS emitted on a held
  lot** (a fill you didn't see may have happened); the V6 advisories are decision SUPPORT, never a
  verdict/alert input. Bids get their own rows (BID-OK / BID-BEHIND / CROSSING / CANCEL-BID — only
  CANCEL-BID alerts); sub-100k offers collapse to one line; bid/listed rows print a `window` context line.
  **P5**: the bid verdict (`offerVerdict`) is PATH-AWARE — a bid on an item with a declared scalp/value-hold
  thesis (via `thesis.mjs set --path`) no longer CANCEL-BIDs off the falling regime alone; it cancels only
  on its own tripwire (scalp: a live 2h breakdown; value-hold: a floor break). Absent a declared thesis
  (and in the deployed app Watch tab, which calls `offerVerdict(row, price)` with no path arg), the verdict
  is byte-identical to before — so no app behavior changed and APP_VERSION did not bump.
  **P0**: the held verdict prose is now the SHARED `renderHeldVerdict` (verbose) from
  `pipeline/lib/context.mjs` — the ONE home `quote.mjs --positions` renders from too (byte-identical to
  the old inline `heldAction`, diff-verified) — and each pass runs one `loadSnapshot()` for the passive
  Tier-1 archive append (per-item live fetch semantics unchanged). **P4b**: each held note block gains
  a persistence-gated dominant-path line (`path <key> 0.62 · menu: …`; a confirmed migration prints
  `path MIGRATED a → b`) — the path engine's weighed read through the `pathPersistence`
  arm-then-confirm + hysteresis gate (`PATH_PERSIST_MS`/`PATH_HYSTERESIS_MARGIN`, placeholders), so
  flapping weights never whiplash the headline path; decision support only, no path-driven alert
  class. watch.mjs is the ONE writer of the path fields on watch-state.
  `quote.mjs --positions` remains the booked-lots view (now with an offers.json + watch-state overlay
  for askFilling + conviction + the same read-only path line; the booked FIFO lots are still the basis).
- `windowrange.mjs "<item>" [--nights 14] [--window 0-8] [--bid <gp>] [--ask <gp>]` (bucketing/quantile
  math in `js/windowread.mjs` — moved out of `pipeline/lib/` by P2 so it's node- AND app-importable,
  shared with `watch.mjs`'s window line + `js/validate.mjs`'s `reachValidator`) scores the last ~14 local
  days: per-day window low/high + volume, bid/ask levels touched/reached on ~50%/~75%/all days, `--bid`/
  `--ask` candidate scoring, and the **RC1 recency split** — the recent-3-night hit rate + a `recent-3
  ~50%` quantile beside the full-window ones, with a `⚠ stale` flag when the full count is concentrated
  in an older price regime (the reach-contamination guard; see `windowread.mjs` header). `/overnight`'s
  fill-realism check runs it on every candidate bid ("touched/reached" ≠ filled; ~14d is a small sample).

## Open followups (not yet built)
- **The master plan: `PLAN.md`** (single plan file since 2026-07-04) — the plan + the
  scoreboard. Waves 1–4 have **all shipped** (T1/T2, O1, K1–K3, S1–S3, Q1, E1, L1, G1, M1, N1,
  and the Wave-4 cleanup D1/R1/P1/X1/X2/A1–A3/BE1/W1/CI1) — see PLAN.md's Status table for the
  per-chunk shas. **The active program is the Pipeline-v2 wave (D0→P8)** — snapshot+SQLite
  archive, context chain, validators on every surface, path engine (verdict = item × thesis),
  declarative strategy specs — specs in PLAN.md "Pipeline v2"; note the **falling-exclusion
  doctrine is AMENDED** (per-strategy, not global — encoded at P5). Also open: **F1** (GATED on
  O1's sample thresholds) plus PLAN.md's **Discovered** list. Planning process: `docs/PLANNING.md`. `main` is protected by a PR+`checks` ruleset (G1, 2026-07-04); no merge queue on this
  user-owned repo and PR creation is token-blocked for now, so chunks land via attended
  direct-push under the admin bypass (parallel lanes still use worktree subagents,
  hand-serialized) until `gh auth refresh` enables the PR path. The historical plan docs
  (`PLAN-2/3/4/5.md`, and the folded `PLAN-LOCAL-WATCH.md`/`PLAN-LOG-HARDENING.md`) are
  **deleted** — full text via `git show <sha>:PLAN-4.md` (etc.). A per-topic `PLAN-*.md` is
  folded into `PLAN.md` and deleted the moment its last chunk ships — don't leave shipped plan
  files at the repo root.
- **Per-item "recommend price adjustment" button** on the Trends page: pull fresh GE
  state + item info on demand and recommend a price tweak (ties into patient pricing
  and eventually the fills pipeline's realized-vs-suggested calibration; tracked in
  PLAN.md's unscheduled notes).
- ~~**Ledger redesign — grouped, watchlist-filtered, period P&L**~~ — **BUILT** (watchlist
  filter, per-item grouping + drill-in, period P&L bucketed by SELL date — `renderLedger` /
  `periodKey` in `js/ledger.js`, A3 — were `js/ui.js`). The local-timezone day-boundary verification lives in PLAN.md
  chunk E1. **Ledger UX rework** (0.45.0, LU1) refined the surface: the grouped-row item name is now a
  Trends link (`linkname`→`openTrends`) and multi-lot expansion moved to an explicit `.expbtn` chevron
  (the old whole-row `data-grp` click is gone); the P&L period control (`#ledgerPeriod`) moved from the
  top bar onto the "Closed flips" label; clicking a `#periodStrip` bucket filters the closed table to that
  bucket's sell date (`STATE.ledgerBucket`, session-only — active bucket shows an `×`, "All" pill or
  re-click clears, changing granularity clears); the manual-entry form is a collapsed-by-default
  `<details id="ledgerFormD">` (persisted `ledgerFormOpen`); and the closed-flips columns sort via TB1's
  `makeSortable` on group aggregates (default `last`-close desc = unchanged order).

## Repo is public — no PII
This repo is public on GitHub. Never commit account names, RSNs, real names, emails,
or other personally identifying info into tracked files (code, comments, commit
messages, `fills.json`, docs). Git author identity (`user.name`/`user.email`) is
already configured locally as `bensumm` / `benlsummers@gmail.com` — that's expected
metadata, not a leak; the concern is content, not commit authorship.

## Process rules (carried over from prior sessions — keep following these)
1. The repo's `index.html` + `styles.css` + `js/*.js` are canonical. Confirm the
   current version before editing; don't work from a stale copy (a rollback incident
   happened this way once, back when it was one file — same principle now applies
   across the split files together).
2. Validate every JS edit: `node --check` the touched file(s) (each `js/*.js` is
   valid ESM on its own now, no more single-blob extraction needed). That only
   catches syntax — also actually run the app (`serve.cmd` + a real browser, or the
   Playwright/chromium approach used in the 2026-07 restructuring session) before
   calling a change done, since cross-module import/export mismatches and DOM
   logic bugs don't show up in a syntax check. Prefer exact-string-match patches
   that fail loudly over fuzzy ones.
3. Ben wants prose explanations of what changed and why, alongside code — not just
   a diff.
4. Be honest about statistical limits in any calibration/analytics work. Never
   oversell signal quality from small samples.
5. Bump `APP_VERSION` (in `js/state.js`) on every shipped change **to the deployed app**.
   Skills-only changes bump the SKILL.md `version:` frontmatter instead (never
   `APP_VERSION`); pipeline-only stdout tweaks may ship without a bump, noted in the
   commit message.
6. **`main` is protected by a ruleset** (G1, 2026-07-04 — PR + `checks` required, no
   force-push/deletion; repository-admin **always** bypass). Two live caveats: no merge
   queue (user-owned repo — unavailable) and PR *creation* is currently token-blocked
   (`createPullRequest` → `FORBIDDEN`; needs `gh auth refresh -s repo`, Ben-only). **So the
   practical path today is attended direct-push under the admin bypass** (`git fetch &&
   rebase origin/main && push`); the PR-for-everything flow is the intent once the token is
   refreshed — full state in `/ship` §2/§6. Describe the change to Ben before landing it.
   On-demand `sync-fills.mjs` pushes of `fills.json`/`positions.json`/`suggestions.jsonl`
   go direct to `main` too (pipeline-owned; clobber-guard reconciles). No unattended writer
   remains (the schedule was eliminated — `pipeline/FILLS-PIPELINE.md` §12).
7. Ben doesn't have a separate git GUI client on the Windows machine — git CLI + SSH
   auth to GitHub is already working and is the only tool needed for git operations;
   don't suggest installing anything else for those. The GitHub CLI (`gh`) IS
   installed (2026-07-04); it is the API + **PR/merge-queue management** layer, not a git
   transport (git stays on SSH) — see the "GitHub CLI (`gh`), Actions CI, and shipping"
   section and the `/ship` skill.
8. **A documentation pass is part of every change — not optional, and not append-only.**
   Before calling a change done, update the docs the change touches: this `CLAUDE.md`
   (a "Done" pointer, plus any workflow/section it affects), and any affected doc
   (`pipeline/MONITORING.md`, `pipeline/FILLS-PIPELINE.md`, `README.md`). Crucially, this is
   a *reconciliation* pass, not just new prose: **grep the docs for statements the change now
   supersedes or contradicts and fix them in place** (e.g. a superseded matrix/table, a stale
   "verdict set", a now-inaccurate trigger condition). Adding a new section while leaving an
   old one that says the opposite is the failure mode to avoid — the 0.30.0→0.33.0
   `momVerdict` reconciliation is the anchor (story in `docs/LORE.md`). If a plain-language ask should map to a specific
   script/flow, make that mapping explicit in the relevant CLAUDE.md section so a future agent
   runs the right thing immediately.
   **The file inventory is part of this pass (Ben, 2026-07-06):** `README.md`'s repo
   inventory + "Map of the repo" is the file registry. Every NEW file — source, doc, data
   artifact, even a gitignored one — gets an entry there at creation: its purpose, what it
   contains, and who produces/consumes it. Every change that alters a file's purpose or
   contract updates its entry in the same commit. A file with no inventory entry is
   undocumented by definition — don't leave one behind.
9. **Post-wave cleanup.** When a wave's chunks are all shipped: `git branch -D` the
   squash-landed lane branches — they read as "unmerged" to git (squash rewrites history), so
   verify each landed against **PLAN.md's Status table**, NOT `git branch --merged`. A
   CONFIRMED-stale branch (tip is an ancestor of `origin/main`, or squash-landed per PLAN.md's
   Status table) may be deleted without asking, local or remote (Ben, 2026-07-08); if staleness
   can't be confirmed, still ask before `git push origin --delete …`. Check `git status` for
   orphan untracked artifacts a chunk left behind. Multi-lane dispatch mechanics are `/ship` §7.

## GitHub CLI (`gh`), Actions CI, and shipping — mechanics live in `/ship`
- **`main` is protected by a ruleset** (G1, 2026-07-04): PR + `checks` required, no
  force-push/deletion, repository-admin **always** bypass (ruleset id `18520289`). Two live
  caveats — **no merge queue** (user-owned repo → unavailable) and **PR creation is
  token-blocked** (`createPullRequest` → `FORBIDDEN`; fix = `gh auth refresh -s repo`,
  interactive/Ben-only). So today changes land by **attended direct-push under the admin
  bypass** (verified working, incl. the sync); the `gh pr create` → `gh pr merge --squash`
  flow is the intent once the token is refreshed. Full honest state: `/ship` §2/§6.
- `gh` (installed + authed 2026-07-04) is the API + ruleset/PR management layer; git
  operations stay on git-over-SSH. **Never run `gh auth setup-git`** (details in `/ship` §5).
- **On-demand `sync-fills.mjs` pushes go direct to `main`** riding the admin bypass
  (pipeline-owned artifacts; clobber-guard reconciles). No unattended writer / machine
  bypass identity exists — the schedule was eliminated (`pipeline/FILLS-PIPELINE.md` §12).
- **CI: `.github/workflows/checks.yml`** — a cheap `checks` job (JS syntax sweep, quotecore
  + reconstruct acceptance fixtures, `fills.json`/`positions.json` parse) plus a separate
  **`smoke` job** (CI1) that loads `index.html` in headless Playwright chromium with all
  external network stubbed and fails on any page error / app console error / empty pane —
  the "syntax passed but the app broke" class the process rules warn about (`pipeline/smoke.mjs`).
  Both run on push, PR, and `merge_group`; the cheap job is split out so it fails fast. Agents
  may add/improve workflows within the constraints in `/ship` §4 (public logs, no `~/.runelite`,
  seconds-fast, no secrets).

## The `STATE` object (js/state.js) — read before editing shared state
The rule (all app-wide mutable state lives as properties on one exported `STATE` object,
because a module can't reassign an imported bare `let` binding — that's a SyntaxError) is a
**header comment at the top of `js/state.js`**, next to the object it governs. Read it
before adding shared mutable state: put new mutable state on `STATE`, not a new bare
`export let`; never-reassigned constants stay `export const`. (Moved out of CLAUDE.md by
chunk K3; this pointer stays with the process rules above.)

## Time display convention — displayed times are LOCAL
Every timestamp the app *renders* (Ledger day/week/month buckets via `periodKey`, "synced"
stamps, fills-log entries, the Logs view, Trends hour-of-day/`getHours()` markers, quote
freshness) is derived with the local-time `Date` getters (`getHours`/`getMonth`/`getDate`/
`getDay`, `toLocaleTimeString`) — never `getUTC*`/`toISOString`. `UTC`/`ISO` is **storage and
wire format only**: epoch-second `ts` fields, backup metadata (`exportedAt`), the backup
filename slug. The manual-log `date`/`time` strings are written in local wall-clock time by
both `fillsLogLine` (`js/fillslog.js`) and `pipeline/add-manual-fill.mjs`, so rendering them
raw (e.g. the synced-line list in `editManualLog`, `js/ledger.js` — A3, was `js/ui.js`) is already local. Verified by
the E1 audit (2026-07-04) with a near-midnight `periodKey` fixture — a local 23:55 dip buckets
to that day, not the UTC-rolled next day. When adding a rendered timestamp, use the local
getters; only reach for UTC when writing something that leaves the app.

## Environment notes (Windows machine)
The Windows-machine environment notes (RuneLite `profiles2` flush-on-restart, the Exchange
Logger field mapping, cancel semantics, the manual-fill `--time` timestamp rule + `REMOVE`
tombstones, the on-demand sync cadence — the `CofferFillsSync` schedule was eliminated,
§12) are consolidated in **`pipeline/FILLS-PIPELINE.md` §10** (single home). Read that before touching the pipeline
or a source log. (Moved out of CLAUDE.md by chunk K3.)
