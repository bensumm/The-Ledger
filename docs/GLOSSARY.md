# GLOSSARY — what the names mean

The plain-English lookup for The Coffer's vocabulary. Two parts: the **core concepts** (the words the
system reasons in — read this to understand a table, a verdict, or a module header) and the
**codename dictionary** (the plan-chunk shorthand like `Bar E` / `DL4` that appears in comments —
here's the concept each one stands for).

This is the ONE home for term definitions. A module header may *use* a term; it points here for the
definition rather than re-explaining it. When a term's meaning changes, fix it here.

---

## Part 1 · Core concepts

### The two "strategy" levels
These are different things at different levels — kept as two words on purpose.

- **flip-niche** — a *screen-level* style for finding & flipping items. The four are:
  - **band** — flip the 2h intraday price band: bid the band low, ask the band top on a liquid item
    with a stable regime. The default niche.
  - **churn** — high-volume commodity flipping (runes, etc.): thin per-unit edge × huge volume ×
    fast turns; ranked by the whole *lap* (a full buy-limit's worth), not per unit.
  - **scalp** — a deliberate intraday flip on a *falling* market; flip-only, hard stop, no hold.
    Provisional, off by default.
  - **value** — buy-and-hold near a multi-week low, sell one big move up the cycle. Provisional.
- **held-item strategy** — a *position-level* approach for a lot you already hold, produced by the
  path engine (`held-item-strategy.mjs`, "compare strategies"). The options: **hold-recovery** (wait for the
  thesis to play out), **cut** (take the loss, redeploy), **break-even-escape** (get out at cost),
  **list-to-clear** (step the ask down to the printing price), **value-hold** (ride the multi-week
  cycle).

### Prices & the market table
- **Guide** — the real GE guide price (never the wiki `value`/alch field).
- **Quick** — transact-now prices: buy at live instasell, sell at live instabuy.
- **Optimistic** — patient 2h-band edges (bid the band low, ask the band top).
- **Est. buy / Est. sell** — the strategy-aware reconciliation estimate (console default): where a
  given strategy would actually place, folding band + diurnal + reach + break-even.
- **band** — the price range traded over the last ~2h (24×5m points).
- **robust band** — the band with lone fliers trimmed: p10/p90 on a dense side, raw extremum on a
  sparse one, so one outlier print can't inflate the edge. *(codename: Bar E.)*
- **traded band** — the check that a band edge was actually traded, not a one-spike artifact.
  *(codename: Bar D.)*
- **break-even** — the smallest sell price that still nets the buy cost after the 2% GE tax. Piecewise
  (sub-50 tax-exempt / big-ticket tax-capped / normal). Never list a held item below it.
- **tax** — the 2% GE sell tax. The **bond exception**: the Old School Bond is tax-exempt but a
  GP-bought bond costs 10% of guide to make re-tradeable.

### Timing & shape
- **reach** — how often a price actually *prints* across days (vs. **touched**, which is weaker). A
  price you can't reach won't fill. Split into recent-3 vs. full-window to catch stale reads.
- **diurnal** — hour-of-day pattern: the recurring dip window (cheap hours) and peak window (dear
  hours), de-trended so a multi-day trend can't fake the shape. The basis of **diurnal timing** and
  the **forward forecast**.
- **asymmetric fill** — the ideal flip shape: a *rare deep* entry bid + a *near-certain* high-reach
  exit, vs. a symmetric 50/50 band pair. *(abbrev `asym` → asymmetric.)*
- **regime** — the multi-day trend: flat / rising / falling. The real trend signal (a 24h-drift read
  is only a pre-filter).
- **phase** — where in a move an item is: **spike** / **decay** / **basing**. Display-only.
- **momentum** — the last-2h directional tell: the live price leaving its own 2h band (breaking
  down / breaking up / ranging). Drives the position cut-trigger.
- **term structure** — the durable multi-week price shape: **floor** (where support prints),
  **ceiling**, **typical fluctuation**, and **trajectory** (knife / basing / oscillating / elevated).

### Liquidity & flow
- **two-sided liquidity** — a real market trades on *both* sides daily (`hpv>0 && lpv>0`). One-sided
  = a **ghost spread** (uncrossable; the margin is a mirage).
- **Vol/d** — limiting-side daily volume, `min(hpv, lpv)`, from the corrected rolling-24h source (the
  wiki `/24h` endpoint is broken — see `docs/ARCHITECTURE.md` / `PLAN-VOL24`).
- **pressure** — the realized buy/sell flow imbalance (a flow proxy, not an order book).
- **flush** — a liquid book actively *dumping* (live instasell well below the 24h floor, still
  falling); the **dip loop** fires a reactive bid-into-the-fall alert.
- **thin / gp-flow** — a big-ticket item that fails the unit-volume floor but clears on gp turnover
  (`mid × vol`); admitted flagged `thin`, grade-capped.

### Sizing, ranking & capital
- **rank** — the per-thesis score that orders picks: `net after tax × P(fill) ÷ TTF`, evaluated at the
  price pair the thesis posts. Replaced gp/day as the ranking metric.
- **P(fill)** — probability the flip fills, two legs: `P(bid) × ask-reach factor`.
- **TTF** — time-to-fill (kept abbreviated; standard).
- **expected gp/day** (`expGpDay`) — the cheap pre-fetch pool orderer + the 500k attention-floor
  input. Capital-aware (caps by what the deployable pool affords).
- **cash tiers** — `available` ≤ `deployable` ≤ `liquid`: the free coin stack, + reclaimable deep-bid
  escrow, + all resting-bid escrow. The scan-gate uses `deployable`.
- **posture** — active (at the desk, price to fill) vs. overnight (walk away, deep bids only).

### Verdicts & validation
- **verdict** — the gate-tree call on a held lot: NO-READ / DIURNAL-WATCH / SHOCK-WATCH / CUT /
  LIST-TO-CLEAR / HOLD / CUT-CANDIDATE, plus display states PARKED (at break-even) and HOLD — per
  thesis. Persistence-gated (escalations arm-then-confirm). The ONE home is `pipeline/MONITORING.md`.
- **validator** — a pure check run on every surface returning pass / caution / reject. Its *action* is
  per-thesis: **gate** (verdict stands — reject drops the row) vs. **inform** (annotate only). Examples:
  reach, durable-floor, trajectory, buy-limit, dip-direction.
- **thesis** — a declared plan for a held lot (tripwire / exit / window), so verdicts frame against the
  plan instead of re-litigating band-flip churn every pass.

### Data & retro
- **suggestions ledger** (`suggestions.jsonl`) — every recommendation the scripts emit, for the retro.
- **retro-join / outcomes** — join each suggestion to its realized fill (fill-time distributions).
- **F1** — the calibration retro (still gated on sample size). *Live forward-reference* — the one
  codename that isn't archaeology; most placeholder thresholds await it.
- **ROOT-LOCKED** — the data artifacts the app fetches same-origin (`fills.json`, `positions.json`,
  `screen.json`, `suggestions.jsonl`…): fixed at the repo root, cannot move, field names are a wire
  contract.

---

## Part 2 · Codename dictionary

Plan-chunk shorthand that appears in code comments, and the concept each stands for. Format in code:
lead with the concept, keep the codename as a parenthetical cross-ref to the changelog — e.g.
`band-edge robustness (Bar E)`. **`F1` is the exception** (a live forward-reference, kept prominent).

### Screen / pricing
| Codename | Concept |
| --- | --- |
| Bar D | traded-band gate |
| Bar E | band-edge robustness |
| S1 | liquidity + attention gate |
| S2 | posture tuning |
| S3 | watchlist section |
| Q1 | feed-inversion NO-READ |
| BE1 | tax-capped break-even |
| P6 | rank by P(fill)/TTF |
| P6a | retro-join foundation |
| P6b | two-leg fill probability |
| P6c | sub-floor fallback |

### Strategies, paths, validators
| Codename | Concept |
| --- | --- |
| P0 | item-context chain |
| P1 | replay acceptance goldens |
| P2 | validator registry |
| P3 | term-structure validators |
| P4a | held-item strategy engine ("compare strategies") |
| P4b | persistence-gated path |
| P4c | declarative flip-niche specs |
| P5 | per-niche falling doctrine |
| DP1 | dip-direction posture |

### Verdict / held-lot display
| Codename | Concept |
| --- | --- |
| VN-0 | declare-thesis-at-entry |
| VN-1 | verdict persistence |
| VN-2 | declared-thesis frame |
| VN-3 | parked-at-break-even |
| LM1 | buy-limit window |

### Dip loop
| Codename | Concept |
| --- | --- |
| DL2 | flush alert |
| DL3 | standing-bid backlog |
| DL4 | dip-pool auto-nomination |

### Local desk / mobile / infra
| Codename | Concept |
| --- | --- |
| LW1 | offers snapshot |
| LW2 | log-watcher daemon |
| LW3 | heartbeat liveness |
| LW4 | dev-server + /api/scan |
| M1 | mobile GitHub backend |
| N1 | alerts trigger engine |
| N2 | flip-niche-spec conformance |
| N3 | app-import blast radius |
| CI1 | headless smoke |
| G1 | branch protection |

### App-parity / extraction
| Codename | Concept |
| --- | --- |
| TB1 | sortable-table helper |
| TC1 | trend-core extraction |
| TD2 | ledger-core extraction |
| TD3 | ledger UX rework |
| A2 | shared browser fetch |
| A3 | ledger split |
| AP4 | finder desirability grade |
| PV | published-version stamp |
| TV | Trends app-parity |
| TV1 | trajectory validator |
| K3 | CLAUDE.md slimming |

### Data / retro plumbing
| Codename | Concept |
| --- | --- |
| O1 | outcomes sample gate |
| SF-1 | one quantile home |
| SF-3 | vol-source flag |
| SR1 | suggestions-ledger rotation |
| COD-2 | overnight accumulation table |
| COD-3 | rebid-friction encode |
| COD-4 | quote 1h-fetch budget |
| RC-A/B/C | root-cause taxonomy (vestigial / unread-field / drifted-convention) |
| YV1 / YP2 / PLAN-YIELD | yield experiments |

### Forecast waves
| Codename | Concept |
| --- | --- |
| PF1 | forecast model |
| PF2 | quote forecast |
| PF3 | screen forecast |
| PF4 | windowrange forecast |
| PF5 | positions forecast |
| PF6 | estimator forecast |
| PF7 | forecast validator |
| PF8 | forecast backtest |

---

*Maintenance: this file's file-path references are guarded by `archlint` (they must resolve on disk).
When the R1 vocabulary sweep retires a term from prose, `doclint` gains a denylist entry so it can't
creep back — see `PLAN-RENAME.md`.*
