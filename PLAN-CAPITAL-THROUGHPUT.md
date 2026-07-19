# PLAN-CAPITAL-THROUGHPUT — capital-aware expGpDay for band/churn

**Status:** proposed (Ben 2026-07-14). Not started. F1-adjacent — changes what surfaces, so
lands behind a flag + shadow field first, no live default flip without an old-vs-new diff.

## Problem

The band/churn attention floor (`MIN_GPD = 500_000`) and the fetch-pool rank both key off
`expGpDay = round(expUnits(limit, volDay) × modeNet)`, where
`expUnits = min(limit × 6, 0.10 × volDay)` (`pipeline/lib/gatecandidates.mjs` — `expUnits` ~:116,
the gate's expGpDay ~:198–205; pre-change :95,165).

That is a **market-capacity** measure — buy-limit throughput capped at a 10% share of daily
volume — and it is **capital-blind**. Two consequences:

1. The `0.10 × volDay` cap is arbitrary and can represent far more gp than Ben's bankroll —
   90k anglerfish @ ~2,735 ≈ 245m of buying against ~77m idle. So `expGpDay` overstates a
   cheap-commodity lane's realistic throughput and understates nothing on the capital side.
2. It never demotes a **slow big-ticket** for the capital each fill locks. Big-tickets survive
   the floor via the `thin` exemption instead — a separate hack, not the honest number.

Ben's reformulation (2026-07-14): the floor/rank should be *"for this price, how many can I
realistically capture over the next day × profit"* — a **capital-aware** throughput.

## Design — SHIPPED LOCALLY 2026-07-14 (per-window model)

The capital cap enters INSIDE the buy-limit ×6 term (per-window), NOT as a separate whole-day cap.
Rationale (the turns problem, resolved): ttf is not available at gate time, so a whole-day
`(capital/price)×turnsPerDay` needs a turns estimate we don't have — and a naive `turns=1` (capital
deployed once/day) UNDER-credits fast churn and wrongly HID anglerfish/sanfew (seen live in the first
run). The fix: churn RECYCLES intra-day — you deploy a tranche, it sells within the 4h window, freed
capital rebuys next window — so the binding question is *"can I afford ONE buy-limit tranche?"*, which
shares the ×6 cadence with the limit:

```
perWindow      = min(limit, deployablePool / price)   # NEW: capital caps the per-window tranche
capturable/day = min(perWindow × 6, 0.10 × volDay)    # ×6 windows/day; volume-share leg unchanged
expGpDay       = round(capturable/day × modeNet)
```

`pipeline/lib/gatecandidates.mjs`: `expUnits(limit, volDay, capPerWindow)` — a null `capPerWindow`
returns the byte-identical legacy expression (fixtures/overnight/watchlist unchanged); `gateCandidates`
passes `capPerWindow = THROUGHPUT_CAP_GP / mid`. `THROUGHPUT_CAP_GP` = the FULL derived `deployablePool`
(`lib/cashderive.mjs`, the value-niche anchor; NOT ÷slots — the floor asks "if I put everything in this
ONE lane…"). `screen.mjs --throughput capital|legacy` (default capital); legacy or a null pool →
capital-blind. `expGpDay`/`expGpDayLegacy` log as a shadow pair on `suggestions.jsonl`.

- **Self-targeting:** binds ONLY when even one buy-limit tranche > the pool (expensive/big positions).
  Affordable churn (anglerfish, soul rune, chins) → `min(limit, cap)==limit` → byte-identical → never
  hidden.
- **The turnsPerDay term is dropped** (the ×6 window cadence subsumes it for churn; a slow big-ticket's
  ×6 over-credit is harmless — big-tickets are `thin` → floor-exempt, and the thin reserve ranks by
  gp-flow not expGpDay). Absent a cash anchor → legacy, never worse.

## Findings — local run 2026-07-14 (77m deployable pool)

`--mode all --throughput capital` vs `legacy`: **byte-identical surfacing** — 88/88 churn gated,
34/34 band survivors, identical churn list (anglerfish/sanfew/super-combat all preserved). Exactly ONE
logged row bound: **Osmumten's fang** (26219, ~18m/unit, limit 8 → one tranche 144m > the 77m pool) —
expGpDay 4.93m→2.64m, but it's a thin big-ticket (floor-exempt, mirage exit) so surfacing is unchanged;
the number is just honest now. **MIN_GPD stays 500k — recalibration shows nothing crossed the floor.**
Interpretation: at 77m Ben can afford one buy-limit tranche of every liquid churn lane, so capital does
NOT constrain his churn — the buy limit does. The change is a CORRECT latent guard that activates at
smaller capital / larger (big-ticket) positions and makes big-ticket rank numbers honest today. (The
"90k anglerfish" that motivated this was the volume-SHARE ceiling, which never binds anglerfish — the
buy limit already caps it well below that.)

### ÷slots knob — REMOVED from scope (Ben 2026-07-14)
A `deployablePool ÷ slots` cap (like the value niche) was considered and **dropped entirely**: it would
bind affordable churn and demote the fast lanes Ben said not to hide, and the concurrency/spread-across-
lanes concern it reached for is owned properly by the positions-side opportunity-cost read
(`PLAN-CAPITAL-OPCOST.md`), not the discovery floor. The throughput cap stays WHOLE-POOL — the floor
asks "could this ONE lane use my capital". (The value niche's own `--slots` is a separate, untouched
mechanism.)

### Why this encodes Ben's strategy for free

`capturable × net/u` self-selects the right big-tickets (Ben 2026-07-14 — "unless there's a big
flip the smaller churn lanes are generally less risk and similar profit"):

- thin big-ticket (few units × small margin) → sub-floor, correctly dropped;
- real big flip (few capital-limited units × HUGE reachable net/u) → clears the floor on margin;
- churn (many units × tiny margin) → clears on volume×turns.

So it makes the existing "velocity beats magnitude AT CURRENT CAPITAL; crossover comes with
size" hypothesis (in `/scan` SKILL.md) MECHANICAL — the crossover is the point where a
big-ticket's per-unit swing × capital-limited units overtakes the churn lane, which the min()
computes directly. NOTE (reconciled 2026-07-14): as SHIPPED this does NOT retire the `thin`
exemption — thin big-tickets still bypass the floor and ride the gp-flow-ranked reserve; the
capital cap only makes their expGpDay NUMBER honest (it doesn't yet gate them). Folding capital
into the thin path so big-tickets "earn their slot on real throughput" remains a follow-up.

### The capital cap is SELF-TARGETING — it does NOT compress/hide cheap churn (Ben 2026-07-14)

The third cap only pulls the min() below the existing two when `buyPrice × units > deployablePool`
— i.e. only on **expensive** items. On a cheap high-volume commodity, the bankroll buys far more
units than the buy-limit or volume-share allows, so the capital term is slack and `expGpDay` is
**identical to today**. Worked example — Soul rune @ 381 on ~77m idle: 77m / 381 ≈ 202k affordable
units > the ~150k/day buy-limit throughput (25k/4h × 6) → limit still binds → expGpDay unchanged →
NOT demoted, NOT hidden. So the earlier worry that "capital-aware compresses the churn ranking and
could hide a soul-rune-class lane" does NOT hold: compression only occurs where capital binds
(pricey items), which is precisely the intended demotion target. Cheap churn is a no-op.
Belt-and-suspenders: held / asked / watchlisted items are floor-EXEMPT already
(`gatecandidates` never floors them), so a held lane like soul rune bypasses the discovery floor
regardless of this change.

## Rollout — DONE LOCALLY (not pushed), 2026-07-14

1. ✅ `--throughput capital|legacy` (default capital) in `screen.mjs`; the capital-aware `expUnits`
   in `gatecandidates.mjs` behind the derived `THROUGHPUT_CAP_GP` pool. Fixtures pin SLACK/BIND/legacy
   (`gatecandidates.test.mjs`); all 57 test files + import/skill lints green.
2. ✅ `expGpDay` + `expGpDayLegacy` shadow pair logged on `suggestions.jsonl` (`suggestlog.mjs`).
3. ✅ Diff reviewed (Findings above): default flipped ON because the per-window model is byte-identical
   on affordable churn (zero surfacing change), so there was nothing to stage behind a default-off flag —
   the only mover was a thin, floor-exempt big-ticket. **MIN_GPD kept at 500k** — the floor's meaning is
   now "capital-real gp/day", but the number is unchanged because at 77m nothing crossed it.
4. Not pushed (Ben reviews first). App unaffected — `gatecandidates.mjs` is imported ONLY by
   `pipeline/screen.mjs`, `pipeline/lib/replay.mjs`, and tests (the `js/` hits are comments), and
   `renderMode` publishes only `{id, cells}` (`screen.mjs:822`) so `expGpDay` never reaches
   `screen.json` → no `APP_VERSION` bump; replay goldens green (`DEFAULT_THRESHOLDS` cap = null →
   the legacy byte-identical path).

## Open questions / follow-ups (arch review 2026-07-14)

- ~~`turnsPerDay` from `ttf`~~ — RESOLVED by the shipped per-window model: the ×6 window cadence
  subsumes turns; no ttf input at gate time.
- Interaction with the value niche's deployable-capital multiplier — share ONE helper in
  `lib/cashderive.mjs` so the two capital models can't drift.
- Does the rank (not just the floor) adopt it too? Likely yes (same rationale), but the rank
  is `net × P ÷ ttf` per-thesis today — decide whether capital caps the rank's `net` leg or
  rides as a separate multiplier.
- **Stale comment in `screen.mjs` (~:140–144, rule 8):** the VALUE_CAPITAL derivation header still
  says the eager conservative pre-derive pool "is never surfaced … only used after that re-derive".
  Now contradicted: `screen.mjs:1139` assigns `THROUGHPUT_CAP_GP = VALUE_CAPITAL` even when value
  did NOT run (no marketRef re-derive), so a band/churn-only run uses the CONSERVATIVE pool
  (deep bids counted committed → the cap binds slightly more, the safe direction — not a bug).
  Reconcile the comment when next touching screen.mjs.
- **`expUnitsOvernight` stays capital-blind** (calls `expUnits` with no cap — pinned by
  `expunitsovernight.test.mjs` "equals expUnits × span/24"). Intentional (the /overnight skill
  pauses for stated capital), but note the overnight sizing table and the capital-aware floor now
  measure different things.
- **Truthiness nit:** `gatecandidates.mjs:198` gates on `t.THROUGHPUT_CAP_GP &&` — a pool of
  EXACTLY 0 (fully deployed) degrades to capital-BLIND legacy, not "can afford nothing". The
  comment says "null cap degrades"; 0 ≠ null. Defensible (a zero-pool screen would show nothing),
  but document or handle it deliberately.
