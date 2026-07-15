# FLOW.md — how data & control move through The Coffer

The connective tissue the other docs don't cover. This is the **end-to-end flow**: how a
price, a trade, a suggestion, and a verdict move through the system. It POINTS to the
authoritative homes rather than restating them:

- **What each file is + who writes/reads it** → `README.md` ("Root data artifacts", "Map of
  the repo", "Shared logic modules"). This doc names entities but never re-tabulates that inventory.
- **The load-bearing invariants** (🔒 guarded vs ⚖️ judgment) → `docs/ARCHITECTURE.md`.
- **Plain-English term / codename lookup** → `docs/GLOSSARY.md`.
- **Per-mechanism spec** → the header of the module/test that governs it.
- **Why it evolved this way** → `docs/LORE.md`.

---

## 0. Two runtimes, one shared core

```
        ┌─────────────────────────────┐        ┌──────────────────────────────┐
        │  BROWSER APP (GitHub Pages) │        │  NODE PIPELINE (local)       │
        │  index.html + styles.css    │        │  pipeline/commands/  (run)   │
        │  js/ (entry js/main.js)     │        │  pipeline/ci/        (guards)│
        │  Finder · Trends · Watch ·  │        │  pipeline/lib/       (import)│
        │  Ledger · Scan tabs         │        │  pipeline/probes/ · test/    │
        └──────────────┬──────────────┘        └───────────────┬──────────────┘
                       │        both import the SHARED CORE      │
                       └───────────────►  js/  ◄─────────────────┘
   js/quotecore.js (the ONE quote model) · money-math · money-format · windowread ·
   validate · termstructure · flip-niches · held-item-strategy · estimators · forecast
```

The single most important fact in the whole system: **`js/quotecore.js` is the ONE quote
model, imported by BOTH runtimes** (the app renders from it; ~13 pipeline files import it).
That is *why* the app's tables and the CLI tables are byte-identical — there is no second
implementation to drift. A change to a shared-core module ripples into the pipeline AND the
app; the `js/` shared-module map in `README.md` is the ripple list, and editing one is why
`APP_VERSION` (in `js/state.js`) exists. Node-only modules (`pipeline/lib/*`, the CLIs) never
bump it; app-imported shared modules do.

Everything below is a flow THROUGH this core.

---

## Flow A — the market read (the spine every surface sits on)

```
wiki API                    marketfetch                 quotecore                 SURFACES
/latest  ─┐                                                                    ┌─ app Finder/Trends
/1h      ─┼─►  loadAll* + rolling-24h  ──►  computeQuote(row)  ──►  row model ─┼─ quote-items.mjs
/24h     ─┘    (PLAN-VOL24 correction)      (the ONE model)                    ├─ screen-flip-niches.mjs
                                                                               └─ watch-positions.mjs
```

- The wiki's `/24h` endpoint is **broken** as a trailing-24h source (frozen stale slice); the
  true rolling-24h is composed from the healthy `/1h` grain at the fetch layer
  (`pipeline/lib/marketfetch.mjs` `loadAll24hRolling`, `js/quotecore.js` consumers). Every
  volume-denominated gate/floor is calibrated to that corrected scale. Full story:
  `docs/GLOSSARY.md` "/24h broken", `PLAN-VOL24.md` (working doc).
- `computeQuote` turns raw prices + the 2h band + the 24h stats into the **row model** — Guide,
  Quick/Optimistic (robust `robustBand` edges), momentum tell, pressure, break-even, regime.
  Every surface renders that row; none re-derives prices. The canonical rendered shape is the
  **table v2** column set (`CLAUDE.md` "Market analysis workflow").

---

## Flow B — the opportunity screen (`screen-flip-niches.mjs`)

```
fetch liquid universe (/latest + /1h + rolling-24h)
      │
      ▼
gateCandidates ──► per flip-niche SPEC (js/flip-niches.mjs: gate·edge·rank·confirm·falling·validators)
      │            band / churn / scalp / value  — declarative, driven by mode lookup (P4c)
      ▼
two-sided liquidity + --min-gpd attention floor + per-spec falling doctrine   (S1, P5)
      │
      ▼
validators (js/validate.mjs: reach · floor · trajectory · limit · dip-posture)  ── gate|inform per spec
      │
      ▼
rank + grade (js/estimators.mjs P(fill)/TTF  ·  js/rating.mjs letter)   ── subFloorFallback if empty (P6c)
      │
      ├──►  STDOUT table  (Est. buy/sell reconciliation pair by default; --raw = Quick/Optimistic)
      ├──►  screen.json   (only on --publish → app Scan tab; also dev-server POST /api/scan)
      ├──►  suggestions.jsonl  (every surfaced row logged with shadow fields — see Flow E)
      └──►  dip-watchlist.json (DL4 nominateDip appends flush-suitable items — "B feeds A")
```

The flip-niche is a **data spec**, not a code branch: adding a niche registers a
`{key,pool,edge,rank,confirm,falling,gate,validators,defaultPath}` object. The `--mode` flag
selects which specs run (`all` = band+churn+value). Doctrine home: `js/flip-niches.mjs` header
+ the `/scan` skill.

---

## Flow C — held-position judgment (`quote-items.mjs --positions`, `watch-positions.mjs`)

```
positions.json OPEN lots ─┐
offers.json book          ├─►  buildItemContext (pipeline/lib/item-context.mjs)
hold-thesis.json          │        │
.cache/watch-state.json ──┘        ▼
                            momVerdict gate tree (js/quotecore.js)  ── NO-READ · DIURNAL/SHOCK-WATCH ·
                                   │                                    CUT · LIST-TO-CLEAR · HOLD · …
                                   ▼
                            verdictPersistence (arm-then-confirm; Gate-2 CUT immediate)   (VN-1)
                                   │
                                   ▼
                            renderHeldVerdict → ONE label on BOTH surfaces (table cell + note)
```

- `momVerdict` is a **stateless gate tree** — it reads the market and emits a verdict. The
  RENDERED label is persistence-gated so a per-print flicker can't whiplash it. Vocabulary +
  gate order live in `pipeline/MONITORING.md` step 4 (the ONE home); the `/positions` skill
  interprets each verdict into an action.
- `watch-positions.mjs` is the **only writer** of `.cache/watch-state.json` (cross-pass memory:
  conviction, path weights, armed escalations). `quote-items.mjs` reads it READ-ONLY so the two
  surfaces can't disagree. A declared thesis (`declare-thesis.mjs` → `hold-thesis.json`)
  reframes the verdict as "exit / abort per plan" instead of band-flip churn (VN-2).

---

## Flow D — the fill loop (the closed loop between suggestion and reality)

```
RuneLite Exchange Logger  ~/.runelite/exchange-logger/*.log ─┐
coffer-manual.log (add-manual-fill.mjs inject/tombstone)     ├─►  sync-fills.mjs
mobile-fills.log (phone, contents API)                       ┘        │
                                                                      ▼
                          readLog → parseJsonLine → buildEvents → reconstruct
                                                                      │  collapseOffers + matchTrades (FIFO)
                                                                      ▼
                          fills.json          positions.json            offers.json
                          (event log)         closed=realised P/L        (live GE slots, LW1)
                                              open=inventory@avg cost
                                                    │
              DEFAULT: written to the working tree, ZERO git ──► localhost desk + every node surface read fresh
                                                    │
              --publish (once a day, /overnight): fetch/ff (fold phone) + commit + push to main ──► deployed app fetches same-origin
```

- `sync-fills.mjs` is **on-demand only** (the scheduler was eliminated — `pipeline/FILLS-PIPELINE.md`
  §12), and the **DEFAULT is LOCAL / zero-git** (Ben 2026-07-15): a bare run rebuilds the artifacts in
  the working tree with no fetch/commit/push — the cheap in-session read run at the top of every
  `/scan`/`/positions` (the `run-loop.mjs` watch pass does it every tick). **Publishing to the deployed
  app is once a day at `/overnight` via `sync-fills.mjs --publish`** — the only path that fetches/ff-pulls
  (folding phone trades) + commits + pushes. So the deployed book updates nightly, the desk reads fresh
  all day.
- `positions.json` is the FIFO-reconstructed truth: `closed` = after-tax realised P/L, `open` =
  inventory at real average cost, `unmatched` = pre-log sells. The reconstruction is shared so
  `monitor-offers.mjs` and `sync-fills.mjs` agree. Read `pipeline/FILLS-PIPELINE.md` §5.1 before
  touching it. `fills.json`/`positions.json`/`offers.json` are **ROOT-LOCKED** (app fetches them
  same-origin — README "Root data artifacts").

---

## Flow E — the learning loop (suggestion → outcome → retro → calibration)

```
every surfaced rec ──► suggestions.jsonl        (suggestlog.mjs; shadow fields: est*, asym,
   (screen / quote / watch)   │                  reachRelief, volDayRolling, path, validators, …)
                              ▼
                    join-outcomes.mjs  ── joins each suggestion to the fill that realised it
                              │           → outcomes.json (fill-time × band-percentile × liquidity)
                              ▼
                    analyze-record.mjs  ── read-only retro: per-flip-niche rollup + n-gated
                              │             tuning CANDIDATES (never retunes a constant itself)
                              ▼
                    F1 calibration  ── GATED on O1 sample thresholds (n≥30/cell, ≥5 cells);
                                        the many PLACEHOLDER constants graduate here, not before
```

This loop is *why* so many thresholds are labelled PLACEHOLDER: the system records what it
recommended (`suggestions.jsonl`, append-only, month-rotated) and what actually happened
(`fills.json`), and `analyze-record.mjs` surfaces the gap — but calibration (F1) stays gated
until the sample is large enough to be honest (process rule 4). The `/analyze` skill drives
this. Homes: `pipeline/lib/suggestlog.mjs`, the `/analyze` skill, `pipeline/FILLS-PIPELINE.md`.

---

## Entities in flow order (pointer — full inventory in README)

The **writer → reader** relationships, ordered by the flows above. Each file's authoritative
"what locks it / tracked?" row is in `README.md` ("Root data artifacts" + "Map of the repo");
this table is the flow view, not a second inventory.

| Entity | Written by | Read by | Flow |
| --- | --- | --- | --- |
| `latest/all24h/all24h-rolling/guide/mapping.cache.json` | `marketfetch` (pipeline `.cache`-style) | every read surface | A |
| `screen.json` | `screen-flip-niches.mjs --publish` / dev-server `/api/scan` | app Scan tab | B |
| `dip-watchlist.json` | `screen-flip-niches.mjs` DL4 + manual | `watch-positions.mjs --dip` | B→C |
| `positions.json` · `fills.json` · `offers.json` | `sync-fills.mjs` (ROOT-LOCKED) | app + all node surfaces | D |
| `hold-thesis.json` | `declare-thesis.mjs` | quote/watch verdict frame | C |
| `.cache/watch-state.json` | `watch-positions.mjs` (ONLY writer) | quote-items (read-only) | C |
| `.guide-history.jsonl` | `watch-positions.mjs` | quote-items (advisory) | C |
| `ignored-items.json` | app / manual | monitor/positions quarantine | C/D |
| `watchlist.json` | app + phone (contents API) | app + `screen-flip-niches.mjs` watchlist section | B |
| `suggestions.jsonl` | `lib/suggestlog.mjs` (every surface) | `join-outcomes` / `analyze-record` | E |
| `outcomes.json` | `join-outcomes.mjs` | `analyze-record.mjs` | E |
| `alerts.json` | `trigger-alerts.mjs` | trigger engine (N1) | — |
| `.market-archive.sqlite` | passive Tier-1 archive append (loadSnapshot) | replay / retro | D/E |

---

## Control surfaces — who invokes what

- **Ben's plain-language asks route to ONE command** via the ask→command table in `CLAUDE.md`,
  most wrapped in a **skill** (`/scan`, `/positions`, `/overnight`, `/morning`, `/analyze`) that
  adds the judgment layer the script can't encode.
- **`run-loop.mjs`** is the multiplexer: one loop runs `watch-positions.mjs` + `screen-flip-niches.mjs
  --mode all` on independent cadences, gated on deployable capital, with a local book-refresh
  each watch pass. Driven by `/loop`.
- **`dev-server.mjs`** (LW4, localhost) serves the static app AND exposes `POST /api/scan`, so the
  app's Scan-tab "Refresh scan" runs a REAL local `screen-flip-niches.mjs --publish` (zero git).
- **CI** (`.github/workflows/checks.yml`) runs the `pipeline/ci/` guards on every push/PR: the
  cheap `checks` job (syntax, `run-tests`, `check-imports`, `check-dead-exports`, `lint-arch`,
  `lint-docs`, `lint-skills`) + the `smoke` job (headless-chromium app load).
