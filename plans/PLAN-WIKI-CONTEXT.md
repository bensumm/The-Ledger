# PLAN-WIKI-CONTEXT — item game-context enrichment (wiki metadata as an inform-only lens)

Untracked planning doc (2026-07-16). Per the fold-out discipline this file folds into
`PLAN.md` when scheduled and is deleted when its last chunk ships. Executor rules =
PLAN.md "Executor rules", verbatim.

## Intent

Today the pipeline is purely quantitative: price bands, volume, momentum, regime drift,
reach/trajectory classifiers. It has no idea what an item IS in the game world — where it
comes from (monster drop / skilling supply / quest reward), how old it is, what skill/
minigame it belongs to, or how exposed it is to botting. Ben wants that lens available
alongside the quant read, concretely motivated by a real macro event: OSRS bots have
recently been largely shut down, so previously bot-flooded commodities (prayer/dragon
bones, gathering-skill raw materials, Mastering Mixology reagents) may be trending up
*structurally*, not as noise — and knowing an item's game-context would let a read say
"this rise may be a supply-side structural shift" instead of just "regime: rising +N%".

Feasibility was checked by a background research pass (2026-07-16, opus subagent) against
the live OSRS Wiki API. Findings below; this doc is the resulting plan, not yet scheduled.

## What was verified (evidence, not theory)

- **No Semantic MediaWiki / Cargo query API on this wiki** — `action=cargoquery` and
  `action=ask` both return `badvalue`. Don't build around a structured-query endpoint; it
  doesn't exist here.
- **`action=parse&prop=wikitext&section=0` works** and returns the infobox as a flat
  `|key = value` list (Dragon bones: `release = [[23 October]] [[2002]]`, `members = Yes`,
  `tradeable = Yes`, `examine = …`, `id = 536`) — trivially regex-parseable, ~3 lines of
  extraction code.
- **`action=query&prop=categories` is the real find, and it batches (≤50 titles/call).**
  One call returned, for Dragon bones / Raw shark / Mox paste (a 2026-Mixology item):
  associated skill (Prayer, Fishing, Herblore), source class ("Items dropped by monster"
  vs pure-skilling categories), item age ("Content released in 2002/2024"), and minigame
  membership (`Category:Mastering Mixology`) — from ONE endpoint, for free.
- **No botting-exposure signal exists anywhere structured** — no `Category:Botted`, no
  reputable machine-readable botted-items list. This has to be a small hand-curated tag
  file, not a derived signal. Auto-inferring "botted" from categories would be a guess
  dressed as data — explicitly ruled out (matches this repo's don't-oversell culture).
- **No meaningful rate-limit risk.** The wiki doesn't hard rate-limit at the volumes this
  would generate (a one-time-per-item, cache-forever fetch, not a live poll); `robots.txt`
  disallows `/*api.php` for *crawlers*, which governs bot scraping, not a low-volume
  cached-fetch tool with a descriptive User-Agent (the pipeline already sends one for the
  prices API).

Full agent report is in this session's transcript if the detail is needed later; the
summary above is what this plan is built on.

## The honesty core (process rule 4 — read before any chunk)

1. **Wiki metadata is a LENS, not a signal.** Source/age/skill/minigame membership are
   facts about the item, not predictions about its price. They inform how to READ a
   regime-drift line ("rising +12%, and it's a 2002 prayer-bone drop during a bot
   crackdown" is a more legible sentence than "rising +12%" alone) — they never gate,
   grade, or rank. Same treatment as the `reachable`/pressure-trial precedent.
2. **Botting exposure is Ben's judgment, encoded as data, not derived.** The tag file is a
   small curated list (`{item: {exposed, reason}}`) that Ben edits; the wiki categories
   support that judgment (skill + source + age are exactly what predicts bot exposure) but
   never auto-produce the tag.
3. **n≈0 on the macro thesis itself.** "Bots got shut down → botted commodities rise" is a
   real, plausible, but UNSCORED hypothesis. This plan makes the context visible; it does
   not claim the pipeline can now detect or confirm the bot-crackdown effect. Any framing
   in scan/quote output must read as context, not as a validated causal claim.
4. **Cache cold, refresh manually.** Source/age/category essentially never change post-
   release — this is the coldest cache in the codebase (contrast with `loadMapping`'s
   24h TTL). Wrong caching direction here (re-fetching often) is the main way to turn a
   cheap feature into an unnecessary wiki-load generator.

## Architecture (sketch, per the agent's recommendation)

- **New `pipeline/lib/wikimeta.mjs`** — mirrors the `loadMapping` cache-loader pattern in
  `pipeline/lib/marketfetch.mjs`, but cached indefinitely (manual refresh, not TTL-based).
  Batches `action=query&prop=categories|revisions&titles=…` (≤50/call) across the mapping's
  known item names, parses category strings into `{skill, source, ageYear, minigame,
  members, tradeable}`.
- **Ben's curated tag file** — a small JSON (e.g. `bot-exposure.json`, sibling to
  `ignored-items.json`/`watchlist.json`) — `{ "Dragon bones": {exposed:true, reason:
  "prayer-bot supply"} }`. Hand-maintained, not derived.
- **Surfacing** — an additive `Context` note on `screen-flip-niches.mjs` output (and
  optionally `quote-items.mjs`), e.g. `ctx: 2002 skilling supply (Prayer) · bot-exposed`,
  rendered as an inform-only footer/column exactly like the reach/trajectory notes today —
  never touching Grade, Rank, or gates. Console-only at rollout (no `APP_VERSION` bump).

## Chunks (not yet scheduled — proposed breakdown)

### WC1 — prototype + coverage check
Throwaway `scratch/wiki-probe.mjs` (not committed): batch-fetch categories for ~12 items
spanning bot-suspect commodities (Dragon bones, Raw shark, a Mixology reagent), a boss
drop, a quest item, and an F2P staple as controls. Eyeball parse cleanliness and category
consistency across item types before committing to the real module. ~1h, zero repo
changes. **Gate for WC2**: coverage/parse quality has to look genuinely clean across a
spread of item types, not just the three items already spot-checked.

### WC2 — `pipeline/lib/wikimeta.mjs` + cache
The real cached loader + category-string parser, tested against the WC1 findings.
Deliverable: `getItemContext(id|name) → {skill, source, ageYear, minigame, members,
tradeable} | null` (null on parse failure — degrade loud, never fabricate a field).

### WC3 — curated bot-exposure tag file + doc
`bot-exposure.json` (Ben-authored) + a short README/CLAUDE.md registry entry per process
rule 8. No code reads it yet — this is Ben's data entry step, decoupled from WC2/WC4 so it
can start any time.

### WC4 — surface the context note
Wire `wikimeta.mjs` + the tag file into `screen-flip-niches.mjs` (and optionally
`quote-items.mjs`) as an inform-only `ctx:` line, following the existing note-family
registry pattern in `pipeline/lib/render.mjs`. No gate/grade/rank change; replay goldens
must stay byte-identical on the numeric columns.

## Docs / registry pass (rule 8, per chunk)

- `README.md` inventory: `pipeline/lib/wikimeta.mjs`, `bot-exposure.json` at creation.
- `CLAUDE.md`: a short pointer alongside the existing market-analysis doctrine table (keep
  it small — full doctrine lives in the module headers, per the docs-small memory).
- `/scan` skill: version bump noting the new `ctx:` note family once WC4 ships.
