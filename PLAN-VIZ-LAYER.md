# PLAN-VIZ-LAYER — one render layer between the data and the reader

Drafted 2026-07-16. Research-only draft (nothing here is implemented). Follows `docs/PLANNING.md`.
Scope: **presentation only** — this plan must never change a gate, verdict, grade, rank, price, or
break-even number. Any chunk that would is out of scope and flagged, not done.

## Context / diagnosis

The three market-read scripts each hand-format their own console output, smearing three concerns
into one pass: **data** (facts: quotes, verdicts, fired gates, notes), **visualization** (markdown
tables / formatted text), and **interpretation** (the judgment the reader — Ben or the session
agent — layers on top). Because there is no single render path, the same fact renders differently
per script and per relay, and this session hit three concrete bugs:

1. **The code-fence table bug.** Scripts emit raw markdown tables; when the relaying agent wraps
   one in a fenced code block, chat clients render literal `|`/`-` characters instead of a table.
   There is no canonical relay rule, so each response re-decides how to present the table.
2. **Headline vs per-item verdict staleness (the anchor incident).** `watch-positions.mjs` can
   print a headline banner (e.g. `⚠ CUT — structural break …`) that contradicts the per-item
   verdict a few lines below (already persistence-downgraded to HOLD). Confirmed in code — two
   independent render sources for the same lot:
   - the headline alert text is built in `heldAlert()`
     (`pipeline/commands/watch-positions.mjs:418–473`) from the **raw** `momVerdict` +
     `convictionGate` state (e.g. the structural-break CUT string at `:456–457`), with the verdict
     word and prices interpolated inline into the message string;
   - the table's Verdict cell renders the **persistence-gated display label**
     (`it._display.label`, `watch-positions.mjs:875–877`) via `verdictPersistence`/`heldDisplay`
     (`pipeline/lib/item-context.mjs:152`, the VN-1 machinery whose whole point was "the table and
     the armed note can never disagree" — the headline was never brought under it).
   Two gating systems, two format sites, no shared render source.
3. **Inconsistent surfacing of "extra" context.** Each script computes a different pile of
   inform-only notes (quote: diurnal, forecast, ask-headroom, asym-fill, window-clear, reach-relief,
   stale-exit, pressure-exit, rebid advisory…; screen: caution, trajectory/reach, headroom,
   window-clear, asym, demand, diurnal, entry-paths, velocity, WATCH CLOSELY, Dip pool, WATCHLIST;
   watch: the V5 note block + thesis/guide-anchor riders). How much of that survives into the chat
   relay varies by script and by how much the reader truncates that pass — there is no declared
   tier ("always relay" vs "context on request" vs "shadow/log-only").

Supporting duplication evidence (why "one canonical render path per shape" is not yet true):

- `watch-positions.mjs:844–847` defines a **local** `quoteCells` producing `buy → sell` cells
  WITHOUT the `· +net (roi)` suffix — a different Quick/Optimistic cell format than the canonical
  `quoteCells` in `js/quotecore.js:722` that quote-items and screen ship (via `stdCells`,
  `pipeline/lib/cli.mjs:61`). MONITORING.md says the watch table is "on the canonical table-v2
  basis" — it is close, but not the same cells.
- `watch-positions.mjs:1018–1020` hand-builds its markdown table with string concatenation instead
  of `mdTable` (`pipeline/lib/cli.mjs:53`), which quote-items and screen both use.
- `quote-items.mjs` accumulates untyped prose strings into a flat `lines[]`
  (`pipeline/commands/quote-items.mjs:138` on), each note hand-prefixed with its own sigil
  (`⚠`/`↳`/`ℹ`/`⤴`/`◆`/`◇`/`↥`) at the push site — the note "type" exists only as a string prefix.
- `screen-flip-niches.mjs` prints ~10 distinct footer/info section types, each with its own inline
  `console.log` loop and its own header wording (`:764–883`, `:1112–1180`, `:1295–1301`).

Root cause, one sentence: **the facts are computed once but formatted at every emission site**, so
consistency depends on every site independently agreeing — and they've drifted.

## Rulings (owner decisions, 2026-07-16 — encode, don't re-litigate)

- **R1. Three clean layers.** Data (facts) → Visualization (a peer render module — not nested in
  either neighbor) → Interpretation (judgment/prose by whoever reads the render).
- **R2. One canonical render path per data shape.** "Held positions table", "scan BAND table",
  etc. each get exactly ONE formatter used by every consumer.
- **R3. The three bugs above are the proof-of-value.** Fix the code-fence relay rule, the
  headline-vs-verdict mismatch, and the undeclared surfacing tiers as part of landing the layer.
- **R4. Structured data is the source of truth.** The render layer consumes a plain JS data
  structure (JSON-serializable), never re-parsed text.
- **R5. Hard boundary: presentation only.** Gates, verdicts, break-even, grades, rating math are
  untouchable. A chunk that changes a number or a verdict is flagged and NOT done here.
- **R6. Two stages.** Stage 1 (this plan): a consistent markdown render layer for console/chat.
  Stage 2 (out of scope, must not be precluded): a live HTML dashboard in the deployed app fed by
  the SAME data structures. Seams are noted where they arise; nothing Stage-2 is built.

Judgment calls, confirmed by Ben 2026-07-16 (were proposed defaults; now Rulings, not open):

- **R7 (was PD1). Render home: `pipeline/lib/render.mjs`** (new file), which *delegates to* — not
  duplicates — the existing pure formatters (`mdTable`/`stdCells` in `cli.mjs`, `heldNoteBlock` in
  `emit.mjs`, `renderHeldVerdict`/`renderPathLine`/`staleBookBanner` in `item-context.mjs`).
  Ben's call: no strong preference on the exact file, only that it makes sense for its consumers
  and lives in its own dedicated area — `pipeline/lib/render.mjs` as the one conceptual home
  satisfies that; existing formatters stay where they are as its delegates (avoids a churn-only
  file move), each header cross-referencing render.mjs as the entry point.
- **R8 (was PD2). Visual format is explicitly ALLOWED to change and adapt (Ben, 2026-07-16):**
  the watch table adopts the canonical `quoteCells` composite cells (net/roi included) in VZ2b —
  a deliberate, visible stdout change on the watch surface, not preserved-by-default. More
  generally: future render tuning may keep adapting the format as we learn what's useful — this
  is not a one-time migration to a frozen shape.
- **R9 (was PD3). Headline alert wording re-sources to the shared display state** (VZ3): the
  alert *set* (which items alert, when — convictionGate's decision) is untouched; only the verdict
  word and prices in the message come from the same `heldDisplay`/`mvDisplay` the table cell
  renders. **Confirmed (Ben, 2026-07-16): if the two gating systems genuinely disagree on a lot's
  state (escalate-while-display-says-HOLD), that's flagged for investigation as a separate
  judgment-layer issue** (likely a watchstate.mjs reconciliation) — the renderer must never
  silently paper over a real disagreement between convictionGate and the display state.
- **R10 (was PD4, REVISED — Ben, 2026-07-16). Default to showing extra info, tune down by
  iteration, not by pre-guessed tiers.** Ben's call: "include extra info by default and can
  analyze what is useful and what is not and iterate" — this REPLACES the original PD4 plan of
  three tiers with a `context` tier that's optional-by-relevance. Revised design: every note
  section still carries a `tier` label for TRACKING purposes (so we can later see which tiers
  are actually read vs skipped), but **`core` and `context` both render AND relay by default** —
  there is no default-hidden middle tier. `shadow` (log-only, e.g. suggestions.jsonl) is
  unchanged — that data was never rendered and stays that way. The iteration loop: run with
  everything surfaced, watch which sections actually get used/asked-about vs ignored over
  subsequent sessions, and demote specific note KINDS (not whole tiers) to shadow only once
  that's evidenced — never speculatively upfront.

## Existing scaffolding (not greenfield — build on, don't rebuild)

- **T1 structured cells `{t, c, title}`** — the structured-cell shape already shared by console
  and app: `js/quotecore.js:721–734` (`cellText`, `quoteCells`), `pipeline/lib/cli.mjs:53–61`
  (`mdTable` renders text; the app keeps the class). This IS R4 for table cells, already shipped.
- **screen.json schema 2** (`screen-flip-niches.mjs:1308–1333`, repo-root `screen.json`) — a
  self-describing published payload (headers travel with rows, structured cells) that the deployed
  app's Scan tab already renders generically. This is the **proven Stage-2 seam**: pipeline builds
  a plain data payload → app renders it. The report objects this plan introduces follow the same
  discipline (JSON-serializable, headers/types travel with the data).
- **`pipeline/lib/emit.mjs` (`heldNoteBlock`, V5)** — an existing PURE, fixture-pinned
  (`pipeline/test/emit.test.mjs`) order-and-format contract for the per-held note block that
  "consumes already-computed pieces and decides NOTHING". This is the render layer's pattern,
  already proven on one block; the plan generalizes it, it does not invent it.
- **`pipeline/lib/item-context.mjs`** — shared renderers (`renderHeldVerdict`, `renderPathLine`,
  `staleBookBanner`) already de-duplicate wording across watch/quote surfaces; `heldDisplay` is
  the persistence-gated display state VZ3 re-sources the headline to.
- **`briefLine` (watchcore)** — a fixture-pinned, script-owned one-line format (`--brief`) that
  already demonstrates "stable format, agent relays verbatim + adds judgment".
- **Fixture/test harness** — `pipeline/test/` has 60+ test files incl. `emit.test.mjs`,
  `table.test.mjs`, `watchcore.test.mjs`, `verdictpersist.test.mjs`; byte-identity refactors here
  are an established verification pattern (PLANNING.md chunk rules).
- **CI** — `.github/workflows/checks.yml` runs the test sweep + `check-imports.mjs`; new modules
  get covered automatically once imported by an entrypoint and tested.

Checked for prior art: no `PLAN-VIZ*` file exists or existed; CHANGELOG/git-log show render-layer
*pieces* (T1 cells, V5 emit contract, VN-1 display gating, schema-2 publish) but no prior attempt
at the unified layer itself. The pieces shipped; the layer is the missing top.

## Target architecture

```
DATA (per script, already computed)          VISUALIZATION (peer layer)         INTERPRETATION
─────────────────────────────────────        ───────────────────────────        ─────────────────
quotecore/estimators/validators/...    →     pipeline/lib/render.mjs      →     Ben / the session
build ONE plain "report object"              renderReport(report) →             agent (skills):
per run:                                     markdown string(s)                 judgment, prose,
  { kind, generatedAt, sections: [           - one formatter per section        action plan.
      {type:'headline', ...},                  type (table, alerts, notes,      Relay rule: tables
      {type:'table', headers, rows},           summary), delegating to          raw (never fenced),
      {type:'notes', tier, items},             mdTable/heldNoteBlock/etc.       core tier always,
      {type:'summary', ...} ] }              - NO judgment, NO numbers          context tier by
  JSON-serializable, cells are T1              computed here — format only      relevance.
  {t,c,title}; every note item is
  typed {kind, tier, itemId?, data, text?}
```

- **One home per concern:** report-object *builders* live beside each script's existing compute
  (the facts are already in hand there); the *render* entry point is `pipeline/lib/render.mjs`;
  the existing pure formatters (`cli.mjs`, `emit.mjs`, `item-context.mjs` render fns) stay where
  they are as render.mjs's delegates (R7). No formatter logic remains inline in a script's
  `console.log` loop once its chunk lands.
- **The headline and the table render from the same per-item state** (R9): alert objects become
  `{level, itemId, name, display, data}` and the renderer interpolates the verdict word/prices
  from the SAME `heldDisplay` source as the Verdict cell — one source, two projections.
- **Tiers travel with the data, for tracking, not gating** (R10): every notes section carries
  `tier: 'core'|'context'`, but both render AND relay by default — `context` is not
  default-hidden. shadow data never enters a report object (it already rides suggestions.jsonl).
- **Stage-2 seam (noted, not built):** because a report object is plain JSON, a later chunk can
  write it to a root artifact (the screen.json pattern) and an app module can render it with an
  HTML section-renderer instead of the markdown one. What Stage 1 must therefore NOT do: put
  pre-rendered markdown inside report objects as the only representation of a fact (text-only
  `notes` items carry `data` alongside `text` wherever the fact is structured); bake
  console-widths/ANSI into cells; or make render.mjs import anything browser-hostile into the
  data shape. render.mjs itself is pipeline-only; the SHAPE is the contract.
- **What this plan does NOT unify:** inputs. The three scripts legitimately read different state
  (watch reads offers/watch-state; screen reads the bulk /24h; quote is per-item). The
  PLANNING.md anti-pattern "unifying prose without unifying inputs" is dodged by unifying only
  the *presentation of already-shared inputs* (verdict display state, quote rows) — where two
  surfaces already read the same state (VN-1, item-context), the renderer makes them *display*
  it identically; where they don't, the renderer does not pretend they agree.

## Staged chunks

**Status (2026-07-16): ALL CHUNKS ✅ landed — VZ1, VZ2a, VZ2b, VZ3, VZ4a, VZ4b, VZ5, VZ6.** VZ2a's
fixture confirmed a genuine convictionGate-vs-heldDisplay disagreement (see R9); Ben's ruling was
heldDisplay stays authoritative for the verdict word, structural break surfaces as an appended
warning clause — landed in `heldAlert()` directly since the fix was small and well-scoped once the
ruling was made. VZ3-VZ6 followed the same pattern established by VZ1/VZ2b, extended to
`quote-items.mjs` and `screen-flip-niches.mjs`; all byte-identity-verified. Stage 1 of this plan
(console/chat markdown render layer) is complete; Stage 2 (the live HTML dashboard, R6) remains
unbuilt and out of scope.

Order: prove the pattern on watch-positions (the script with the live bug), then quote-items
(smallest), then screen (largest surface). Mechanical moves are separate from visible changes;
every chunk is independently shippable and fixture-pinned.

- **VZ1 — render.mjs skeleton + the watch report object (mechanical, byte-identical).**
  Add `pipeline/lib/render.mjs`: report-object shape (documented in the header — the ONE shape
  spec), `renderReport()`, section renderers for `headline`, `alerts`, `table`, `notes`,
  `summary`, each delegating to existing formatters. Refactor `watch-positions.mjs`'s output pass
  (`:787–1086`) to build a `watch-report` object and print `renderReport(report)`; the hand-built
  table (`:1018–1020`) goes through `mdTable`; the local `quoteCells` (`:844–847`) moves into the
  report builder UNCHANGED (cell format not unified yet — that's VZ2b). `--brief` keeps
  `briefLine` (already script-owned + pinned) as a report projection.
  *Primary files:* `pipeline/lib/render.mjs` (new), `pipeline/commands/watch-positions.mjs`,
  `pipeline/test/render.test.mjs` (new).
  *Verification:* golden-fixture stdout diff — extract the output pass into a pure
  `buildWatchReport(items, …)` testable off fixture item objects (no live fetch); pin that
  `renderReport(buildWatchReport(fixture))` is byte-identical to the pre-chunk output captured on
  the same fixture. Run the real loop once locally and eyeball-diff a live pass.
- **VZ2a — headline/table consistency (the bug fix).**
  Alert objects become structured (`{level, itemId, display, data}`); `heldAlert()` returns data,
  not a formatted string; the renderer builds the headline line's verdict word + list-at from the
  SAME `it._display`/`mvDisplay` state the Verdict cell uses (R9). The alert *set* and firing
  conditions are byte-identical (R5 — convictionGate untouched).
  *Primary files:* `watch-positions.mjs` (`heldAlert`, `bidAlert`, `flushAlert` return shapes),
  `pipeline/lib/render.mjs`.
  *Verification:* a fixture reproducing the anchor incident — a lot whose raw `momVerdict` says
  CUT (structural escalate) while `verdictPersistence` still displays HOLD-family — pins that the
  rendered headline and the rendered table cell carry the same verdict word. A second fixture pins
  that every pre-existing alert still fires with unchanged level + item. If the fixture exposes a
  genuine gate-state disagreement (escalate fired but display never adopts), STOP and report to
  Ben — that reconciliation is a watchstate/judgment change, out of scope (R9).
- **VZ2b — canonical held-row cells (deliberate visible change, confirmed R8).**
  The watch table's Quick/Optimistic cells adopt `js/quotecore.js` `quoteCells` (net/roi
  included). One formatter for the table-v2 cell everywhere; MONITORING.md's "canonical table-v2
  basis" claim becomes literally true.
  *Primary files:* `watch-positions.mjs`, possibly `js/quotecore.js` (additive mode only — if
  touched, note it's shared with the app: no existing call-path change, no APP_VERSION bump
  needed for an unused-by-app additive export; smoke test still run).
  *Verification:* fixture pins the new cells; a before/after sample table pasted in the ship note.
- **VZ3 — quote-items.mjs onto the report path.**
  Both modes build report objects; the flat `lines[]` becomes typed note items
  (`{kind:'diurnal'|'forecast'|'validator'|'askHeadroom'|'asym'|'windowClear'|'reachRelief'|
  'staleExit'|'pressureExit'|'rebid'|'conviction'|'path'|…, tier, itemId, data, text}`), each
  keeping its exact current wording via a per-kind formatter in render.mjs (the sigil prefix moves
  from the push site to the formatter — the kind stops being a string prefix). Mechanical:
  byte-identical stdout.
  *Primary files:* `pipeline/commands/quote-items.mjs`, `pipeline/lib/render.mjs`.
  *Verification:* golden-fixture diff on both modes (pure `buildQuoteReport` off fixture rows).
- **VZ4a — screen-flip-niches.mjs: niche tables + footer notes.**
  The per-niche table blocks (`printNiche`, incl. sub-floor fallback headers) and the
  rejected/caution/inform/headroom/window-clear/asym/demand footer loops (`:764–783`) build one
  `screen-report` per niche. Byte-identical. The `--publish` screen.json payload continues to be
  built from the SAME cells (it already is — `:1308–1333`); its shape is FROZEN (schema 2,
  additive-only) — this chunk must not touch it.
  *Primary files:* `pipeline/commands/screen-flip-niches.mjs`, `pipeline/lib/render.mjs`.
  *Verification:* golden-fixture stdout diff per mode + a byte-diff of screen.json produced by a
  pinned fixture run before/after.
- **VZ4b — screen's loose info sections.**
  Diurnal timing, overnight accumulation table, velocity tags, entry paths, stats line, WATCH
  CLOSELY, Dip pool, WATCHLIST (`:812–878`, `:1112–1113`, `:1178–1179`, `:1295–1301`) become typed
  report sections. Byte-identical. Split from VZ4a because this is 8+ section types (the
  two-concerns rule).
  *Primary files:* same as VZ4a.
  *Verification:* golden-fixture diff, `--mode all` fixture included (the widest output).
- **VZ5 — the surfacing-tier registry (tracking-only) + the relay rules (skills chunk).**
  Declare the tier of every note kind (a table in render.mjs's header — the ONE registry; R10
  defaults: V5 guaranteed fields, verdicts, alerts, WATCHLIST = core; all inform-only families =
  context; suggestions.jsonl fields = shadow — tier here is a TRACKING label, not a
  render/relay gate). Renderer prints tier markers on section headers (e.g. `ℹ context —`…
  already ~true via sigils; make it uniform) so a later iteration pass can see which kinds are
  actually being read. Then the skills pass: `/scan`, `/positions`, `/morning`, `/overnight` get
  the TWO relay rules — (1) never wrap a script's markdown table in a code fence; relay tables as
  raw markdown; (2) **both core and context tiers render AND relay by default (R10)** — nothing
  is hidden or trimmed speculatively; a note kind only moves toward shadow (log-only, unrendered)
  once real sessions show it's consistently unused, and that's a separate future ruling, not
  something this chunk decides. Bump each SKILL.md `version:`; run the SKILL-TRIAGE disposition
  (both rules are `judgment:`-tagged prose — they govern the interpretation layer's relay
  behavior, which no script can enforce; the tier *registry* is the encoded half).
  *Primary files:* `.claude/skills/*/SKILL.md`, `pipeline/lib/render.mjs` (tier registry),
  `docs/MARKET-ANALYSIS.md` (output section pointer).
  *Verification:* `pipeline/ci/lint-skills.mjs` passes; tier registry covers every note kind
  emitted by VZ1–VZ4 (a test enumerates report-object kinds against the registry).
- **VZ6 (optional, cheap) — MONITORING.md / docs reconciliation sweep.**
  Rule-8 reconciliation ride-alongs happen per-chunk; VZ6 is the final grep for superseded
  statements ("hand-built table", the V5 wording, the watch cell format claim) + README inventory
  confirmation. No code.

Out of scope, explicitly (R5/R6): any convictionGate/verdictPersistence reconciliation VZ2a
surfaces; Stage-2 app dashboard (report-object publish artifact, app renderer, APP_VERSION bump);
changing which notes are computed; retiring any note family.

## Encoding boundary

- **Encoded (scripts):** the report-object shape; every section/note formatter; the tier registry;
  the headline↔cell single-source rule (a fixture, not prose).
- **Stays judgment (skills, `judgment:`-tagged):** which context-tier notes matter this pass; the
  action plan built on top of the render; the no-code-fence + relay-tier rules (they instruct the
  reader, who is outside any script's reach). Disposition table ships with VZ5.
- **Retired prose:** any skill/doc sentence that currently re-describes a script's output format
  in its own words gets replaced by a pointer to render.mjs's header (grep in VZ5/VZ6).

## Bookkeeping & compatibility checklist (per-chunk, not deferred)

- `pipeline/lib/render.mjs` + `pipeline/test/render.test.mjs`: README "Map of the repo" entries at
  creation (VZ1). This PLAN file: registered per the PLAN-*.md root-file convention (folded into
  PLAN.md + deleted when the last chunk ships).
- **screen.json shape freeze:** schema 2, additive-only; VZ4a pins byte-identity. The app
  (`js/ui.js` generic header rendering) must keep working unmodified — no APP_VERSION bump
  anywhere in this plan (all chunks are pipeline stdout/skills-only; VZ2b's quotecore touch, if
  any, is an additive export with the smoke test as the guard).
- **suggestions.jsonl untouched:** every chunk logs the same ledger rows (the O1 contract) — the
  report object is built beside, not instead of, the ledger emit.
- **skills versioning:** VZ5 bumps SKILL.md `version:` frontmatter (never APP_VERSION).
- **CI:** render.test.mjs joins the existing sweep automatically; no workflow edits expected.
- **`.gitignore`:** nothing new (no new artifacts; report objects are in-memory in Stage 1).
- **Docs per chunk:** MONITORING.md "What each tick surfaces" re-pointed at render.mjs when VZ1
  lands (reconcile, don't append); CLAUDE.md needs no new section (the ask→command table is
  unchanged) beyond a Done pointer.

## Honesty (process rule 4)

- **Byte-identity claims are only as good as the fixtures.** The scripts' output depends on live
  fetches; the golden diffs run on extracted pure builders over fixture inputs, so a live pass can
  still differ in ways the fixture doesn't cover (new note families appearing under live data).
  Mitigation: fixtures chosen to exercise every section type; one attended live-run eyeball per
  chunk. This is stated as the residual risk, not hidden.
- **The tier assignments (R10) are unvalidated labels, but that's lower-stakes than before.**
  Since `context` no longer gates default visibility (Ben's 2026-07-16 call: show by default,
  iterate down from evidence, not up from a guess), a wrong tier label doesn't hide anything —
  it only mis-tracks which section a future demote-to-shadow decision would target. The data
  that would validate a demotion is which notes Ben actually asks about vs skims past across
  sessions; there's no ledger for that yet, so no note kind should be demoted off this plan's
  say-so — only off Ben's observed usage over time.
- **VZ2a may reveal, not create, a gate disagreement.** If convictionGate and verdictPersistence
  genuinely diverge on a fixture, the render layer cannot fix that honestly — it gets reported,
  and the headline renders the display label with the raw state in parentheses only if Ben rules
  that's wanted (a follow-up decision, not assumed).
- **No numbers change anywhere in this plan.** If any golden diff shows a numeric delta, that
  chunk is broken by definition — stop and investigate, never re-baseline the fixture.
- The code-fence rule is prose for the interpretation layer; nothing in the repo can *enforce*
  how an agent formats a chat reply. VZ5 makes the rule exist in exactly one place; it cannot
  make it unbreakable.

## Verification (per-chunk acceptance)

- **VZ1:** `renderReport(buildWatchReport(fixture)) === <pinned pre-chunk stdout>` byte-for-byte
  on a fixture covering: held (listed/NOT LISTED/suspect), orphan ask, bid, target, alerts of each
  level, `--brief`. `node --check` + full test sweep green; one live watch pass eyeballed.
- **VZ2a:** the anchor-incident fixture renders headline verdict word == table cell verdict word;
  the alert-set fixture shows identical alert levels/items before/after. verdictpersist.test.mjs
  untouched and green.
- **VZ2b:** new-cell fixture pinned; before/after table in the ship note; smoke job green
  (quotecore is app-shared).
- **VZ3:** golden diff both modes; every `lines.push` site in quote-items.mjs is gone or routed
  through a typed note (grep `console.log` count in the script drops to the report print + errors).
- **VZ4a/b:** golden diff per mode incl. `--mode all`; screen.json byte-diff empty on the pinned
  fixture run; the app Scan tab renders the freshly published screen.json unmodified (manual check
  via `serve.cmd`).
- **VZ5:** lint-skills green; the kinds-vs-registry test green; a sample relay of each table type
  renders as a real table (not fenced text) in the chat client — attended check with Ben.
- **Overall done-ness:** zero inline table-building `console.log` loops remain in the three
  scripts; MONITORING.md/docs contain no superseded output-format description (VZ6 grep list
  empty).
