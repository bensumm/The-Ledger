# PLAN-SALE-LOG-TAX — the sale log's `worth` field changed meaning and the reconstruction never noticed

**Status:** PLANNED — design decided (§9), chunked (§10), ready for an executor. Owner: unassigned.
**Raised:** 2026-09-01, from a live trading session where three consecutive profitable sales booked as losses.
**Planned:** 2026-09-01 (§9–§12; §1–§8 are the original problem statement, unchanged).

---

## 1. Symptom

`positions.json` reports recent profitable sales as losses. Observed live on three trades in one
session, each of which the trader knew had made money:

| Item | Bought | Sold (gross) | Booked realised | Actual |
| --- | --- | --- | --- | --- |
| Ancestral robe bottom | 60,801,000 | 62,689,000 | **−594,484** | **+634,220** |
| Armadyl crossbow | 36,151,000 | 37,099,995 | **−520,163** | **+206,996** |
| Armadyl crossbow | 36,050,000 | 36,999,993 | **−515,205** | **+209,994** |

In every case the true figure is exactly `realised + tax`. The error equals the row's own stored
`tax` field — the tax is being subtracted twice.

## 2. Where it comes from

`pipeline/lib/reconstruct/reconstruct.mjs:289`:

```js
const each = o.spent / o.filled; // actual executed gross price per item
```

`o.spent` is fed from the source log's `worth` field (`reconstruct.mjs:124`). The comment asserts
that value is **gross**. `matchTrades` then applies `GE_TAX(each)` to it (lines 302–303 for the keep
round-trip path, 323–325 for the ordinary flip path) and computes
`realised = (each − taxEach) − buyEach`.

**That assumption was true for the entire history of this repo, and stopped being true on
2026-08-26.** RuneLite's Exchange Logger changed output format from `exchange_YYYY-MM-DD.log` to
`exchange_YYYY-MM-DD.json` between 2026-08-21 and 2026-08-26, and in the new format `worth` on a
**sell terminal is NET of tax**. So `each` is a net price, and the reconstruction taxes it a second
time.

This is a *source-semantics change*, not an arithmetic mistake. Nothing in the code is wrong on its
own terms; the input changed underneath it, silently, and no guard noticed.

## 3. Evidence

Classify every sell terminal in every log file by whether `worth` equals `offer × qty` (gross) or
`offer × qty − floor(offer × 0.02) × qty` (net):

```
node -e "
const fs=require('fs');
const check=fn=>{
  const txt=fs.readFileSync(fn,'utf8');
  let rows=txt.split(/\r?\n/).filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
  if(!rows.length){ try{const j=JSON.parse(txt); rows=Array.isArray(j)?j:(j.events||[]);}catch{} }
  const sells=rows.filter(r=>/SOLD|SELL/i.test(r.state||'')&&r.worth>0&&r.qty>0&&r.offer>0);
  let g=0,n=0,o=0;
  for(const s of sells){ const G=s.offer*s.qty, N=G-Math.floor(s.offer*0.02)*s.qty;
    if(s.worth===G)g++; else if(s.worth===N)n++; else o++; }
  console.log(fn.padEnd(30),'sells',String(sells.length).padStart(4),'GROSS',String(g).padStart(4),'NET',String(n).padStart(4),'other',o);
};
for(const fn of fs.readdirSync('.').filter(f=>/^exchange_/.test(f)).sort()) check(fn);
check('exchange.json'); check('coffer-manual.log');
"
```
(run from `~/.runelite/exchange-logger`)

Result — a clean, total split with no overlap:

| Source | Files | GROSS | NET |
| --- | --- | --- | --- |
| `exchange_*.log` (2026-07-01 → 2026-08-21) | 51 | all classified sells | **0** |
| `exchange_*.json` + live `exchange.json` (2026-08-26 →) | 7 | **0** | 21 |
| `coffer-manual.log` (written by `add-manual-fill.mjs`) | 1 | 15 | **0** |

Not one file mixes the two conventions. The `other` bucket is sells that filled above the ask (or
mid-partial cumulative rows) and is expected under either convention — it is not evidence of a
third case.

## 4. Blast radius — small today, unbounded forward

Only sales after the format switch are affected. Everything in the `.log` era reconstructs
correctly and must not be touched.

| | Rows | Booked | True |
| --- | --- | --- | --- |
| Sell-leg closed rows **before** the switch | 419 | +38,999,791 | unchanged |
| Sell-leg closed rows **after** the switch (RuneLite-sourced) | 5 | **−2,361,016** | **+1,219,450** |

**Lifetime realised: `36,883,575` booked vs `40,464,041` true — understated by `3,580,466`.**

The five affected rows:

| Sell (UTC) | Item | Qty | Booked | True |
| --- | --- | --- | --- | --- |
| 2026-08-26T17:01 | Magus ring | 1 | −365,582 | +84,120 |
| 2026-08-26T18:02 | Magus ring | 1 | −365,582 | +84,120 |
| 2026-09-01T17:43 | Armadyl crossbow | 1 | −520,163 | +206,996 |
| 2026-09-01T22:38 | Ancestral robe bottom | 1 | −594,484 | +634,220 |
| 2026-09-02T00:44 | Armadyl crossbow | 1 | −515,205 | +209,994 |

Also affected: **1 `unmatched` sell** after the switch, whose `sellEach` and `tax` (18,276) are
computed the same way.

The count is small only because the switch is six days old and most of those days had no sales.
**Every sale from here on is wrong**, and the error scales with trade size — it is ~500k per
big-ticket flip, which is larger than the entire profit on most of them. That is why a profitable
trade reads as a loss.

## 5. Traps — each one has already produced a wrong answer during triage

1. **Discriminate on SOURCE, never on timestamp.** `add-manual-fill.mjs` writes `worth` as
   **gross** (its `--price` default is the pre-tax listing; `--net` converts *to* gross before
   writing). Manual rows are therefore correct as-is and live in the same date range as the buggy
   ones. A `sellTs >= switchDate` rule silently corrupts them — verified: the 2026-09-02T03:55
   Toxic blowpipe row is correct at **+244,800**, and a timestamp rule inflates it to 640,000. This
   is the single easiest way to make the ledger worse than it is now.
2. **Tax is floored PER ITEM, and `spent`/`worth` is CUMULATIVE.** `reconstruct.mjs:256` keeps a
   running `Math.max` across partial-fill snapshots. `qty × floor(g × 0.02) ≠ floor(qty × g × 0.02)`,
   so anything that recovers gross from net has to work per-item, not on the cumulative total.
3. **Old School Bond (13190) is tax-exempt** — `reconstruct.mjs:206–210`, cost model in
   `js/money-math.js`. It is currently quarantined, so it does not bite today; anything unconditional
   breaks it the moment it is un-quarantined. The existing comment already warns about this.
4. **The 5m per-item tax cap.** Items over 250m gp. Soulreaper axe (~408m) is on the live watchlist,
   so this is reachable, not hypothetical. `breakEven()` in `js/quotecore.js` is the repo's ONE
   tax-capped definition — nothing should grow a second one.
5. **Sell-side only.** Buys carry no tax, so gross == net there and the current code is right.
6. **`closed` is not the only consumer.** The same `each`/`taxEach` values feed `unmatched`
   (line 337), `awaitingRebuy` including its `beRebuy` field (lines 358–359), and the `shorts` queue
   of open keep sell legs (line 335) that later closes keep round-trips (lines 302–303). Both
   crossbow rows above came through the `shorts` path, not the ordinary flip path.
7. **Sub-50gp items are invisible to format sniffing** — `floor(price × 0.02) = 0` makes gross and
   net identical. Harmless (the error is 0 there), but any auto-detection will report them as
   ambiguous and must not treat that as a failure.
8. **A sell can fill above its ask**, so `worth` will not always match either formula exactly. Format
   detection cannot depend on an exact match holding for every row.

## 6. Open design questions — for the implementer, deliberately not decided here

- What is the right discriminator: the source filename, the file format, a per-terminal
  self-check, or something recorded at ingest? Each trades robustness against a future logger
  change differently. Note that this bug existed for six days with a green CI and no guard fired.
- Should the correction happen at **ingest** (normalise `worth` to one convention as events are
  read) or at **reconstruction** (interpret it per-source in `matchTrades`)? Ingest keeps
  `matchTrades` pure and IO-free, which its header calls out as a deliberate property.
- Does anything need to guard against this class recurring — i.e. detect that the source's
  semantics have changed rather than silently producing plausible-but-wrong money?

## 7. Acceptance criteria

- [ ] The five rows in §4 produce the stated **True** values.
- [ ] The manual Toxic blowpipe row (2026-09-02T03:55) still reads **+244,800** — the trap-1
      regression guard.
- [ ] All **419** pre-switch sell-leg closed rows are byte-identical before and after.
- [ ] Lifetime realised reads **40,464,041**.
- [ ] The `unmatched` sell after the switch, and any `awaitingRebuy` / keep-round-trip rows, are
      consistent with the same convention.
- [ ] A test that **fails on current `main`** — mutation-verified, per the repo's review doctrine.
      `reconstruct.test.mjs` and `symmetric-matching.test.mjs` are the existing homes.
- [ ] `run-tests.mjs` and the full `checks` job green.
- [ ] `pipeline/FILLS-PIPELINE.md` §5.1 reconciled — it documents the reconstruction and currently
      describes the old assumption.

## 8. Notes

- `fills.json` / `positions.json` are ROOT-LOCKED and rebuilt from source; the fix belongs in the
  reconstruction, never in a hand-edit of the derived artifacts.
- A bare `sync-fills.mjs` is local/zero-git. Do not publish while iterating.
- The trader is actively trading against this book — a correction that lands mid-session should be
  announced before it changes the numbers under him.

---

# The plan (2026-09-01)

## 9. Design decisions — §6's three questions, answered

### 9a. Discriminator: **source-file extension**, decided at file-read time, carried on the event

`isNetWorthSource(filename)` — one exported predicate in `reconstruct.mjs` next to the ADAPTER
block: `.json` sources are NET, everything else (`.log`/`.txt`) is GROSS. This matches the §3
evidence exactly (a clean total split, no file mixing conventions), it is deterministic, and it
discriminates on SOURCE, never timestamp (trap 1: `coffer-manual.log` and `mobile-fills.log` are
`.log` → gross → untouched, which is precisely correct). Per-row sniffing is rejected as the
primary mechanism — traps 7 and 8 make it unreliable row-by-row — but it comes back as the
*cross-check guard* in §9d, which is where its robustness-against-future-change value actually
lives.

The decision is stamped as **`worthNet: true` on sell-type events only** (buys carry no tax —
trap 5; `banked`/`withdraw` are manual-only → gross). Absent flag = gross, so every pre-switch
event, every manual event, and every historical fills.json row means what it always meant.

### 9b. Correction point: **flag at ingest, interpret at reconstruction** — and the event-id contract forces this

§6 framed ingest-normalisation (rewrite `worth` to gross as events are read) vs
reconstruction-interpretation as a style tradeoff. It is not — **ingest normalisation is ruled out
by the `eventId` contract**: the content hash covers `[ts, slot, itemId, type, state, filled,
spent]` (`reconstruct.mjs:379`, mirrored in `js/fillslog.js:83`). Rewriting `spent` changes every
post-switch event's id, so the fills.json merge (`byIdMap` keyed by id) would see the normalised
re-parse as NEW events alongside the already-persisted net-valued ones — duplicated trades — and
every REMOVE tombstone aimed at a post-switch id would silently stop matching.

Carrying a flag instead keeps `spent` as-logged, so ids are stable, and the existing merge order
(`[...prior, ...events]`, later wins — `sync-fills.mjs:228`) **auto-migrates fills.json on the
first bare sync after the fix lands**: the re-parsed, flagged events replace the persisted
unflagged ones id-for-id. No migration script, no tombstones. (All post-switch RuneLite sources
still exist on disk — the switch is 6 days old vs `MAX_AGE_DAYS` 180 — verified as an acceptance
item in §11.) `matchTrades` stays pure/IO-free: the flag arrives on its input like every other
event field.

Flow of the one bit, per reader:

- **`sync-fills.mjs regenerate()`** (also the watch-log daemon + run-loop, which call it
  in-process): its per-file loop knows the filename — pass
  `parseJsonLine(line, { worthNet: isNetWorthSource(f) })`.
- **`offers.mjs readOfferRows()`** — the ONE low-level reader for the whole live side
  (monitor-offers + watch-positions via `readExchangeLog`, trigger-alerts, the offers.json
  emitter) — currently discards the filename. Stamp `worthNet: true` onto raw rows parsed from
  net sources. `readExchangeLog` re-serialises rows into `logLines` via `JSON.stringify`, so the
  stamp rides the string round-trip for free; `parseJsonLine` honours a `worthNet: true` field on
  the raw object as equivalent to the option. Zero call-site changes in monitor-offers.
- **`collapseOffers`** propagates: any flagged event marks its offer (`o.worthNet = true`).
- **fills.json** persists the flag; consumers that read events from there (campaigns/join-outcomes,
  deriveCash) inherit it with no reader changes.

### 9c. Money interpretation — net is primary, gross is recovered for display

For a sell offer, define both prices once:

```
netEach   = o.worthNet ? each : each - GE_TAX(each)     // spendable proceeds per item — EXACT under both conventions
grossEach = o.worthNet ? grossFromNet(each) : each      // the sale price — recovered by inversion when the log gave net
```

**`realised` never needs gross**: `realised = (netEach - buyEach) × take` reproduces every §4 True
value exactly with no inversion in the money path. Gross/tax are display fields
(`sellEach`, `tax`, and the shorts' stored legs), recovered via **`grossFromNet(net)`** — a new
export in `js/quotecore.js` beside `tax()`/`breakEven()` (the ONE tax home; trap 4 forbids a second
tax model growing elsewhere). Spec: smallest integer `g` near `net / 0.98` with
`g - tax(g) === net`, searching the ±2 neighbourhood (per-item flooring, trap 2); above the cap
region `g = net + 5,000,000` falls out of the same search since `tax(g)` saturates. A fractional
`net` (a multi-price cumulative partial averaged per item) has no exact preimage — invert the
rounded value and accept ≤1gp/item error, display-only by construction since realised never touches
it. Bond exemption (trap 3): the bond stays quarantined; extend the existing latent-note comment at
`reconstruct.mjs:206` to say the inverse shares its fate — nothing unconditional ships.

Sites that change, all inside `matchTrades` + one lib (this is the regular-flip AND reverse-flip
coverage — the same two prices thread every path):

| Path | Today | Fixed |
| --- | --- | --- |
| ordinary flip close (:323–325) | `taxEach = GE_TAX(each)`; realised double-taxes net input | `realised = (netEach − buyEach)·take`, `tax = (grossEach − netEach)·take`, `sellEach = round(grossEach)` |
| keep-round-trip short OPEN (:335) — the reverse-flip sell leg | stores `each` (net-in-disguise) + re-taxed `taxEach` | stores `each = grossEach`, `taxEach = grossEach − netEach`; close at :302–303 and `beRebuy` (:358–359, `= s.each − s.taxEach` = net) then need **no formula change** |
| `unmatched` (:337) | same double-tax on `sellEach`/`tax` | same grossEach/tax split |
| `deriveCash` (`derive-cash-tiers.mjs:155`) | `sellIn += o.spent − GE_TAX(each)·filled` — the capital model double-taxes too (a consumer §5 missed) | `sellIn += netEach·filled` via a shared `sellNetEach(offer)` helper exported from `reconstruct.mjs`, so the net-proceeds formula exists ONCE |

Display-only consumers with the flag already at hand after 9b, fixed cheaply with `grossFromNet`
(each is a ~2% understatement on post-switch sell fills, inform-only — ranked accordingly):
`monitor-offers.mjs:119` and `trigger-alerts.mjs:183` (`px = worth/qty` on stamped raw rows),
`retrojoin.mjs:174` (`fillEach` off a flagged collapsed offer). Confirmed NOT affected:
`ownedledger.mjs foldPendingBuys` (buys only, trap 5), `js/fillslog.js` (manual lines, gross by
construction), the app itself (its money arrives via positions.json — no `worth` consumer in `js/`).
`reconcile-reverse-flip.mjs` consumes `unmatched.sellEach` downstream — no code change, but its
printed `--price` advisory is re-checked in §11 once unmatched rows are right.

### 9d. The recurrence guard — cross-check the convention every sync, loudly

The §2 complaint is that six days ran green while money was wrong. Guard:
**`auditWorthConvention(rows, assignedNet, filename)`** — pure, in `reconstruct.mjs`, called
per-file from `regenerate()` (and from `readOfferRows`' callers via the same stamp pass). Over the
file's sell terminals where the two formulas produce *distinct integers* (tax > 0 — trap 7's
ambiguous rows are skipped, not failed; above-ask fills match neither and are skipped — trap 8),
tally exact-gross vs exact-net matches. A file with ≥1 exact match of the OPPOSITE convention and 0
of its assigned one ⇒ `console.warn` LOUDLY every sync + a count in the summary line. **Warn,
never abort and never auto-flip** — an auto-flip is a silent semantics decision, the exact class
being fixed; Ben attends every sync surface. Stated limit: a future change on a file whose rows are
all ambiguous is invisible to this guard (nothing row-level can see it — that residual risk is
accepted and documented in the FILLS-PIPELINE §5.1 pass).

## 10. Execution chunks (each lands reviewable; adversarial review per process rule 10)

- **C1 — the bit.** `isNetWorthSource` + `parseJsonLine` option/field + `readOfferRows` stamping +
  `collapseOffers` propagation + the regenerate() per-file wiring. Tests: flag present via both
  entry routes (option and stamped-field), absent for `.log`/manual/mobile sources, offer-level
  propagation, eventId unchanged by the flag.
- **C2 — the money.** `grossFromNet` in quotecore; the §9c matchTrades table (all four paths);
  `sellNetEach` + deriveCash; the three display sites. Tests in §11 — the failing-on-main fixtures
  land in THIS chunk, written before the fix within it.
- **C3 — the guard.** `auditWorthConvention` + summary wiring + both-direction fixtures
  (a `.json`-named source full of gross rows must warn, and vice versa; a clean file is silent).
- **C4 — acceptance + docs.** Real-book acceptance run (§11), reconciliation pass (§12), CHANGELOG,
  fold this plan into PLAN.md per the plans/ lifecycle (`lint-plan-refs.mjs --refs SALE-LOG-TAX`
  before deletion).

## 11. Tests and acceptance (extends §7 — everything there still binds)

Unit (CI, fixture-driven — `reconstruct.test.mjs` / `symmetric-matching.test.mjs` homes, per §7):

- Net-convention sell through the **ordinary flip** path: books `realised = net − buy` — MUST FAIL
  on current main; mutation-verified.
- Net-convention **keep sell → short → rebuy** (the crossbow path): closed keepRoundTrip realised,
  `awaitingRebuy.beRebuy` = net proceeds, `unmatched` sellEach/tax — the reverse-flip half of the
  ask, exercised end-to-end.
- All existing gross fixtures byte-identical (the 419-row real-data invariant, in miniature).
- `grossFromNet` property sweep: round-trip `g → g−tax(g) → g` for g in {49, 50, 51, mid-range
  randoms, 249,999,999, 250,000,000, 408m} incl. the cap boundary and ±1 neighbourhoods.
- deriveCash: a flagged sell adds `spent` (not `spent − tax`) to sellIn; an unflagged one is
  unchanged.
- Guard fixtures per C3.

Real-book acceptance (run locally with a bare `sync-fills.mjs`; NOT CI — CI never reads
`~/.runelite`, per the `/ship` §4 constraint):

- The five §4 rows produce the stated True values; the 2026-09-02T03:55 Toxic blowpipe manual row
  still reads +244,800; all 419 pre-switch sell-leg closed rows byte-identical; lifetime realised
  40,464,041; the post-switch unmatched sell's tax corrected from 18,276 to the grossEach-derived
  value.
- Every post-switch RuneLite sell event in fills.json carries `worthNet: true` after ONE bare sync
  (the §9b auto-migration actually happened — count flagged events vs a re-parse of the `.json`
  sources).
- `reconcile-reverse-flip.mjs` advisory output sane against the corrected unmatched row.
- One check on the sibling writer: `add-manual-fill.mjs --net`'s to-gross conversion agrees with
  `grossFromNet` on a sample value (they predate each other; a ±1gp divergence is a finding, not
  necessarily a fix).

## 12. Docs, rollout, and the announcement

- **Docs (rule 8, reconciliation not append):** `pipeline/FILLS-PIPELINE.md` §5.1 (reconstruction —
  add the per-source `worth` convention table + the guard's stated limit) and §10 (field mapping —
  the 2026-08-26 format switch); `reconstruct.mjs` ADAPTER header + the now-false comment at :289
  ("actual executed gross price per item"); README inventory entries for `reconstruct.mjs`,
  `offers.mjs`, `quotecore.js` (the new export), `derive-cash-tiers.mjs`; grep the governed docs for
  "gross" claims about `worth`/`spent` and fix in place. CHANGELOG entry.
- **Versioning:** no `APP_VERSION` bump (no app-code change); bump `PIPELINE_VERSION` so the
  corrected pipeline stamps positions.json.
- **Rollout:** the first bare sync after landing moves lifetime realised +3,580,466 and flips five
  rows from loss to profit — per §8, announce that BEFORE the sync that applies it, and do not
  `--publish` until the acceptance list is green; the nightly `/overnight` publish then carries the
  corrected book to the deployed app on its normal schedule.
