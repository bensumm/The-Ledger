# PLAN-THESIS-FRAME — the interpretation layer learns that a declared plan is the frame

**Status:** BUILT 2026-09-09 (owner go + mock sign-off same day: "let's go build it and
test it"; sign-off caveat "unless we're missing critical context or it looks ambiguous" —
deviations recorded in §EXECUTION). Owner-directed: PLAN-WEEKDAY-PHASE-CONFOUND §9
("fix the interpretation layer that runs on scan to not only recommend to cut items like
the crossbow which we are planning to flip over several days"), carrying §6(iv)'s ship
shape along.

## Doctrine ceiling (all chunks)

Presentation/interpretation ONLY. Nothing here gates, sizes, re-ranks, or moves a price.
Three standing pins, restated because every chunk brushes them:
- **VN-4 (item-context.mjs `breakdownThesisAnnotation`):** a Gate-2 breakdown CUT is never
  softened, silenced, or hidden — annotation only, and only while live > tripwire.
- **WPC §6 RESULTS limit:** the falling-label finding covers `{crash-risk, cooling}`
  (quotecore `REGIME_FALLING`) ONLY. mild-cooldown — the ceiling-slope display — is
  UNMEASURED; no chunk may demote, defer, or annotate it.
- **Render-density (owner, 2026-09-09):** do not solve context-fragmentation by writing
  longer lines. New rendered text per chunk is budgeted below; the general problem is
  registered in §DENSITY and stays out of scope.

## TF1 — `declare-thesis` refuses a non-gating path declaration

**The trap (live, 2026-09-09, recorded in WPC §9):** `declare-thesis set ... --path <key>`
with no `--tripwire` prints "declared plan …" and writes a hold-thesis entry that LOOKS
armed — but the convictionGate thesis branch no-ops without a numeric tripwire
(holdthesis.mjs safe-degrade), so the declaration gates nothing and the CUT headline keeps
firing. The tool said "plan recorded"; the machinery heard nothing.

**Change (`pipeline/commands/declare-thesis.mjs`):** a `--path` declaration whose
resulting entry would carry NO numeric tripwire (none passed, none preserved from the
existing entry) **refuses with exit 1** and prints why: the entry would be
declared-but-non-gating, pass `--tripwire "<level>"` to arm it, or `--no-tripwire` to
declare display-frame-only intent deliberately (the §4-crossbow case: failure condition is
time-based, not price-based). `--no-tripwire` writes today's shape unchanged, plus one
stdout line saying the CUT headline stays live. Once TF3 ships, a parseable `--until`
date also satisfies the refusal (a dated failure condition is a real failure condition).
Session-thesis-only `set` (no `--path`) is untouched — it never gated.

**Acceptance:** fixture pinning (a) refusal on bare `--path`, (b) `--no-tripwire`
override writes the pre-TF1 shape byte-identically, (c) `--tripwire` path unchanged.

## TF2 — §6(iv): the falling warning defers to the measured cell (adjacency, not prose)

**What WPC §6 measured (branch iv):** within (class × dislocation-bucket) cells, the
falling label moves forward 4d yield by nothing BH-significant (0/16 registered, 0/48
supplementary) — the warning carries no information the dislocation read doesn't. The
registered ship: where a quotable `DISLOCATION_TABLE` cell exists on the same item, the
warning line defers to it — measured cell rendered BESIDE, not instead of, the ⚠.

**Design — reorder, don't rewrite.** The dislocation note line already renders on all
three surfaces (`quote-items.mjs` quote + positions note blocks, `screen-flip-niches.mjs`
digest via `formatDislocation`). The miss today is adjacency: the falling label sits in
the Regime cell / warning prose while the measured line lands elsewhere in the note stack,
so the reader takes the ⚠ as a veto without seeing the cell. The change, when regime
classification ∈ `{crash-risk, cooling}` AND `dislocationRead` returns non-null:
1. The dislocation note prints DIRECTLY beneath that item's regime/warning line (context
   together — the owner's split-context lesson), on all three surfaces.
2. The warning itself gains only a short pointer suffix, ≤ 25 chars, e.g.
   `⚠ falling → measured cell below`. No new sentence; the long line stays the ONE
   `formatDislocation` line that already exists.
Elevated (sell-side) cells keep full ⚠ semantics — deferral applies to the label, never
to a negative measured number. A falling item whose deviation is neutral (no quotable
cell) renders exactly as today: nothing is invented for it.

**Surface priority (owner, 2026-09-09): the DIGEST is the decision surface** ("I don't
read the scan table hardly ever, I just see the digest") — buy decisions are made there,
so the digest adjacency is the load-bearing half of this chunk and gets the fixture
first. The quote/positions sites follow the same pattern for consistency; positions
context arrives post-entry (exit-decision support only).

**TF2b (WPC §9.3, rides along):** one sentence each in `/scan` + `/positions` SKILL.md
(version bump): on a `{crash-risk, cooling}` item with a rendered dislocation cell or a
declared hold-thesis plan, the label describes the path — read the measured line / the
plan frame before recommending CUT; it is not a standalone veto. mild-cooldown excluded
by name.

**Acceptance:** render fixtures pinning (a) adjacency ordering when both lines exist,
(b) byte-identical output when the label is absent or the read is null, (c) mild-cooldown
rows untouched.

## TF3 — thesis-as-frame verdict rendering (MOCK FIRST — owner sign-off gates the build)

**The problem:** a declared multi-day plan (path + exit + tripwire/horizon) still renders
machinery-first: the Verdict cell leads with CUT and the plan is a parenthetical (VN-4's
annotation fires only on the Gate-2 case). WPC §9.2: the declared thesis should be the
FRAME — progress against the declared exit and failure condition — with the machinery's
read visible beside it, never hidden.

**Piece 1 — `--until <YYYY-MM-DD>`:** `declare-thesis` writes the date into the existing
`horizon` field (today free-text display-only, e.g. "multi-day" — additive back-compat:
render layer duck-types the ISO shape; legacy free text keeps rendering as-is).
**TTL interaction (owner-decided 2026-09-09): the 14d prune stays UNTOUCHED.** Trades
here run ≤2-week cycles, so a horizon date normally lapses LOUDLY (line 3 below) well
before `pruneHoldThesis` (`HOLD_THESIS_TTL_DAYS`, 14d from declaration) could silently
eat the entry — the gating store's prune is not modified, removing what would have been
this chunk's only non-render change. The rare >TTL date is the TF1 trap in a new coat (a
plan that looks armed until its date but dies silently at day 14), so it is guarded at
WRITE time instead: `--until` beyond declaration+14d prints a loud warning naming the
silent-expiry date and the remedy (re-declare mid-hold to extend — a re-declare restamps
`ts`). The constraint is documented in the holdthesis.mjs header alongside the TTL it
belongs to.

**Piece 2 — the frame line (ONE home: `item-context.mjs`, beside VN-4's annotation, so
compact/verbose/watch surfaces cannot disagree).** For a lot whose hold-thesis entry
carries a path, the Verdict cell becomes:

```
PLAN wpc-weekly-cycle · day 5/8 · exit 36.25m · abort 33.0m · until Sun 09-13
PLAN wpc-weekly-cycle · day 5/8 · exit 36.25m · abort 33.0m · until Sun 09-13 (machinery: CUT — 2h breakdown & underwater)
PLAN EXPIRED 09-13 (wpc-weekly-cycle) — reassess; machinery: <verdict>
```

- Line 1: machinery agrees (HOLD-family) → frame alone. `day k/n` = days since `ts` /
  days to the horizon date; omitted when no date. Omitted fields drop their segment.
- Line 2: machinery disagrees → **show both** (owner-approved direction 2026-09-09): the
  machinery verdict + gate reason append in parens, never deleted — the reader always
  sees what the tool would have said. Gate-2 breakdown keeps VN-4's EXISTING annotation
  as the headline (that pin outranks the frame); the frame line renders beneath it.
- Line 3: **hard lapse** (owner-approved direction): past the horizon date the frame
  stops leading and the machinery verdict returns to the front — a plan past its declared
  failure date is exactly when the CUT frame should come back loudly.

**Piece 3 — skill prose (`/positions`, `/scan`):** declared-plan lots are reported in the
frame's terms (progress vs exit/abort/date), the machinery read in parens — extends the
existing "overrode cut, be terse" doctrine from memory into the skills.

**Build gate:** the exact line shapes above ARE the mock. Owner signs off (or amends)
before any TF3 code; amendments edit this section first, then the build follows it.

## §DENSITY — the render-density problem (registered, OUT OF SCOPE — owner, 2026-09-09)

> "We need all the context together and even split by column means we can miss things.
> Maybe we should separately figure out a solution for that."

The per-item note stack now carries several long self-contained sentences (dislocation,
window-read, reach, thesis) plus table cells, and context split across them has caused
real misses. Owner direction shaping the future plan (2026-09-09): **the scan DIGEST is
the surface where decisions are made** — the scan table is hardly read — so
context-together work targets the digest first; positions is post-entry (exit support
only, "not necessarily harmful" but lower value). Candidate directions, in that
priority: a once-per-digest footer legend absorbing the repeated methodology boilerplate
("inform-only, one era, class-conditional") out of every line, a short sigil keeping the
caveat attached; per-item grouped context ON THE DIGEST (each rendered pick's cells +
notes as one visual unit); a positions card layout, optional/later. A note-line budget
was considered and REJECTED — the measured failure mode is fragmentation, not volume,
and a static drop-priority is a machine for recreating missed context. Needs its own
per-topic plan; no chunk in THIS plan may cite §DENSITY as license to add or lengthen
lines.

## Process

Adversarial review per the repo default on every chunk; render changes ship with
fixtures pinning shape (the acceptance lists above), and no derived numbers go into
prose. Chunk order TF1 → TF2 → TF3 (TF1/TF2 independent, TF3 depends on nothing but its
sign-off). Fold into PLAN.md + delete when the last chunk ships, per lifecycle.

## §EXECUTION (2026-09-09 — all three chunks built in one wave)

Code: `declare-thesis.mjs` (TF1 `pathDeclGate` + `--until`/`--no-tripwire`),
`holdthesis.mjs` (`parseHorizonDate`, the ONE horizon-date shape test + the TTL-interaction
header doc), `item-context.mjs` (TF3 `thesisUntil`/`machineryShort`/`expiredPlanWrap` +
the re-shaped frame label + the EXPIRED wrap at both the display layer and the display-less
renderer path), `quote-items.mjs` (TF2 adjacency at the quote + positions note stacks),
`screen-flip-niches.mjs` (TF2 digest per-item note grouping). Fixtures:
`thesisframe.test.mjs` (new, 20 groups) + `verdictpersist.test.mjs` re-pinned to the new
label. Skills `/positions` 1.70, `/scan` 3.11. Pipeline 1.5.0 (displayed verdict
vocabulary changed). CHANGELOG entry `pipeline 1.5.0` is the narrative record.

**Deviations from the registered spec, and why (owner sign-off caveat invoked):**
1. **TF2 on the digest became per-item note GROUPING, not falling-warning deferral** —
   measured before building: the digest renders NO falling warning at all (no Regime
   column; band/churn exclude fallers upstream), so there was nothing to defer. Its
   real context-split was the per-KIND note sections; those became one `per-item notes`
   section grouped by item (note BODY texts identical; the name moved to a group header
   and lines gained kind sigils). This is the §DENSITY digest direction
   pulled forward — justified by the owner's green-light framing (digest-first
   context-together), not by §DENSITY itself; the falling-warning deferral shipped as
   registered on the two quote-items surfaces (regime note + `→ measured cell:` pointer,
   16 chars).
2. **Mock refinements under the ambiguity caveat:** `abort < 33m` keeps the `<` (bare
   `abort 33.0m` reads as "abort AT"); the declared `@ <window>h local` segment is kept
   after the exit; `day k/n` counts from the DECLARATION day (`ts`, day 1 = declared),
   not the position's entry day.
3. **The machinery-parens suppression rule, decided in build:** a bare mv-null
   UNDERWATER never renders in the parens (being underwater IS the plan — re-printing it
   every pass rebuilds the noise the frame exists to silence); every fired momVerdict
   and the mv-null FALLING fallback always render. Encoded in `machineryShort`.

**Render-only limits, stated:** the alert-layer thesis silence (convictionGate 1b) has NO
date awareness — an expired-but-unpruned entry still silences UNDERWATER/CUT-CANDIDATE/
LIST-TO-CLEAR headlines above its tripwire until TTL or an explicit clear (bounded ≤14d
by the untouched prune; making the gate date-aware would be a GATING change needing its
own registration). `renderHeldVerdict` has no `nowMs` seam, so the display-less EXPIRED
wrap reads the wall clock (fixture uses a permanently-past date).

**Live verification:** TF1 refusal exercised on a clean item (exit 1, no hold-thesis
write); the crossbow re-declared with `--until 2026-09-13` (tripwire/exit preserved); the
positions read now renders `PLAN wpc-weekly-cycle · day 1/5 · exit 36.25m · abort < 33m ·
until Sun 09-13` — the signed-off mock line, live. Full suite 137/137 green.

**Adversarial review round 1 (follow-on commit):** five findings, all taken. (1)
watch-positions never threaded `thesis` into the shared verbose renderer (pre-existing —
the VN-4 annotation and the display-less EXPIRED wrap were unreachable on watch's action
line; the frame/EXPIRED synthetic still reached watch via the display path) — fixed by
threading `it._thesis` through `heldAction`. (2) "identical line texts" on the digest
grouping was false as worded (name moved to a group header, lines gained kind sigils —
note BODY texts are what's unchanged) — reworded here, in MARKET-ANALYSIS, and in the
screen-flip-niches comment. (3) TF1's refusal ran AFTER the session-thesis write, so a
refused declaration printed "set thesis for…" and kept the display-store text — gate now
runs before either store is written. (4) `--until` without `--path` was silently dropped
— now warns. (5) two stale comments still named the old `HOLD — per thesis: exit` frame
shape — reworded.

**Adversarial review round 2:** one real finding — the `;` in `— reassess; machinery:`
and inside the VN-4 annotation read as a sentence end to watch's `firstSentence`, so the
note line truncated the machinery clause on an expired plan and the "within plan" tail on
an annotated CUT (masked in practice: the table cell one row up shows the untruncated
label). The `;` was an accidental separator choice, not semantic — both are now ` · `
(`expiredPlanWrap` / `breakdownThesisAnnotation`), a mock deviation under the ambiguity
caveat; fixture pins updated. A "lines gained kind sigils" overstatement (dislocation
lines already carried `◇`; only decay lines gained one) was self-triaged LEAVE IT by the
reviewer — the reader's takeaway is correct and a reword is the regressing-prose class.
