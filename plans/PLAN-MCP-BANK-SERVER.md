# PLAN-MCP-BANK-SERVER — a local MCP server for Ben's live bank/GE state (2026-07-24)

**STATUS: SCOPING ONLY — DEFERRED (Ben, 2026-07-25): finish reverse-flip (RF0-RF6, manual CLI
seeding) FIRST, build this bank source after.** No code shipped by this doc. The `data-export`
source was re-confirmed LIVE on 2026-07-25 (`container_bank.json` last-write 5:37 PM, `container_inventory.json`
6:10 PM that day — the files update mid-session on their own triggers, partial evidence toward MCP0's
open write-cadence question). Follows `docs/PLANNING.md`'s required shape. Per that doc's lifecycle this
file is folded into `PLAN.md` and deleted the moment its last chunk ships (if it's ever built) — do not
leave it at the repo root once done.

## Context / diagnosis

Ben's idea (2026-07-24): an MCP (Model Context Protocol) server could auto-update the tool's
view of his RuneLite bank/GE state, replacing today's manual flow — Ben exports a bank dump,
saves it to `C:\Users\benls\Downloads\bank-dump.json`, and either pastes its path or contents
into the conversation. The fills pipeline already reads `.runelite/exchange-logger/*` on demand
(`pipeline/commands/sync-fills.mjs`); the ask is whether bank state can ride the same pattern.

**The premise was more true than assumed — verified, not guessed.** Investigating the bank-dump
format (a flat `[{id,quantity,name}]` array, 687 items) turned up a live source file already on
disk, unrelated to any manual export step:

```
C:\Users\benls\.runelite\Data Exports\container_bank.json         (35,608 bytes, 687 lines)
C:\Users\benls\.runelite\Data Exports\container_equipment.json    (529 bytes, 10 lines)
C:\Users\benls\.runelite\Data Exports\container_inventory.json    (395 bytes, 8 lines)
```

Each is **NDJSON** (one `{"id":…,"quantity":…,"name":…}` object per line — not a wrapping
array), same three fields as `bank-dump.json`, `container_bank.json`'s content matching the
Downloads dump entry-for-entry. `container_bank.json`'s `LastWriteTime` was 2026-07-24 18:07:30,
same session — this is a **live, already-running local file**, not something Ben has to trigger.

**The producing plugin, identified from `profiles2/default-*.properties` (not a guess):**

```
runelite.externalPlugins=...,data-export,...
runelite.dataexportplugin=true
dataexport.includeBank=true
dataexport.includeEquipment=true
dataexport.includeInventory=true
dataexport.includeSeedVault=false
dataexport.downloadJSON=true
dataexport.downloadCSV=false
dataexport.displayExport=true
dataexport.displayDownload=true
```

The Plugin Hub external plugin id is **`data-export`** ("Data Export"), config-prefixed
`dataexport.*`, already installed and enabled alongside `exchange-logger` in the same
`externalPlugins` list `pipeline/FILLS-PIPELINE.md` §10 already documents. It writes one
`container_<name>.json` NDJSON file per tracked container (bank/equipment/inventory; seed vault
is present as a config toggle but currently OFF) into `~/.runelite/Data Exports/`, sibling to
`~/.runelite/exchange-logger/` — same parent (`~/.runelite/`), same "a RuneLite plugin writes a
local file the pipeline reads" shape `sync-fills.mjs` already uses
(`pipeline/commands/sync-fills.mjs:72`, `LOG_DIR = join(homedir(), '.runelite', 'exchange-logger')`).

**What's unverified: write cadence, not existence.** I did not observe two writes far enough
apart to pin the trigger (bank-interface-close? a periodic tick? both?). This is the one open
unknown before building (see "Honesty" below) — cheap to resolve by watching the file's mtime
across a real play session, exactly the same `--probe` discipline `sync-fills.mjs` already
applies to a new log source (`sync-fills.mjs --probe`, `pipeline/FILLS-PIPELINE.md` §9's
onboarding checklist).

This changes the shape of the ask: it is not "build a bank-export watcher from scratch," it's
"the file-watching half already exists for free — a bank-reading MCP tool is a thin read layer
over a file that updates itself." That collapses tier-a's cost (see "Two tiers" below) and
directly **supersedes** `PLAN-REVERSE-FLIP.md`'s RF5 (see "How it slots into reverse-flip").

## Rulings (owner decisions this session, dated 2026-07-24)

1. **Local-only, never deployed, never network-exposed.** The MCP server is a local Node process
   registered in Claude Code's config on Ben's machine — it reads Ben's private bank contents,
   which must never be committed to this public repo or served by the deployed app. This mirrors
   the existing ROOT-LOCKED-vs-movable / tracked-vs-gitignored split
   (`README.md` "Root data artifacts", `pipeline/FILLS-PIPELINE.md` "DEFAULT IS LOCAL — ZERO GIT")
   — the MCP server sits entirely on the local/gitignored side, with no `--publish`-style
   analogue. Not negotiable in this plan; any future ask to expose it needs its own review.
2. **Read-only tools, no write path.** `get_bank()`/`get_offers()`/`get_fills()` (below) are pure
   reads over already-written local files. The MCP server does not write `fills.json`,
   `positions.json`, `owned-items.json`, or anything else — it is a faster INPUT to the agent,
   never a new writer. `sync-fills.mjs`/`declare-owned.mjs` remain the only writers of tracked
   pipeline state (unchanged).
3. **Tier-a (file-watching) is the recommended build; tier-b (live socket / custom plugin) is
   explicitly NOT recommended now** — see "Two tiers." The `data-export` plugin discovery means
   tier-a's bank half needs no new RuneLite plugin at all, which removes tier-b's only argument
   (today).
4. **Raw bank contents never enter `owned-items.json` un-curated.** Per `PLAN-REVERSE-FLIP.md`'s
   Q1/Q3 design (seed = curated, small, Ben-confirmed subset of owned items worth reverse-flip
   tracking — not a 687-item dump), the MCP `get_bank()` tool is a **read for the agent to look
   at and propose entries from**, not an auto-populator. The distinction that plan already drew
   between "bank truth" and "tracked state" (`PLAN-REVERSE-FLIP.md` Question 3: "bank truth
   never gets injected into fills.json/positions.json... only BANKED lines Ben explicitly
   confirms do that") extends verbatim to `owned-items.json`: `get_bank()` output proposes,
   `declare-owned.mjs seed` still writes.

## Existing scaffolding (what this builds on, not around)

- **The file-watch/on-demand-read pattern** — `sync-fills.mjs`'s `LOG_DIR` constant + `--probe`
  verification discipline (`pipeline/commands/sync-fills.mjs:71-84`) is the exact shape a bank
  reader should copy: a path constant, a `readdirSync`/`readFileSync` pass, a `--probe` mode that
  prints raw-vs-parsed lines once to verify field mapping before trusting it
  (`pipeline/FILLS-PIPELINE.md` §9's onboarding checklist; §10's "ADAPTER comment block... don't
  re-guess field names" rule). A bank-reading module inherits this discipline directly.
- **`pipeline/lib/offers.mjs`** (`readOfferRows`, `offersSnapshot`) — the precedent for "a small
  pure module that reads a RuneLite-plugin-written directory and normalizes it into a snapshot
  object," already used for `get_offers()`-shaped data (offers.json is exactly a live-offers
  snapshot, `README.md:1450`). An MCP `get_offers()` tool would call this module directly, not
  reinvent it.
- **`regenerate()` in `sync-fills.mjs:185-283`** — the reusable, git-free core that already builds
  `fills`/`positions`/`offers` in one call with a `write:false` option available. An MCP
  `get_fills()`/`get_positions()` tool can import and call `regenerate({ write: false })` directly
  — the read-without-side-effects path already exists, it just isn't exposed as an MCP tool today.
- **`PLAN-REVERSE-FLIP.md` RF0/RF5** (Question 1/Question 3) — RF0 already anticipated this exact
  need ("the owned-item registry is maintained by seed + capture-on-buy, never by polling the
  bank... No RuneLite bank-export plugin is required to ship this — it's an OPTIONAL later
  convenience for re-seeding"), and RF5 sketched the exact fallback this plan discovered already
  exists: *"a sibling directory to `.runelite/exchange-logger/` — e.g. `.runelite/bank-export/`
  — can hold a raw JSON snapshot from a small RuneLite plugin (mirrors §8's 'worst case: a
  ~100-line custom plugin' fallback)"* (`PLAN-REVERSE-FLIP.md` lines 323-333). That "~100-line
  custom plugin" is unnecessary — `data-export` already IS that plugin, already installed,
  already writing to `~/.runelite/Data Exports/container_bank.json`.
- **`pipeline/FILLS-PIPELINE.md` §10** — the Windows-environment-notes single home; a future
  build's environment notes (the `data-export` plugin's config keys, container file cadence)
  belong here, not a new doc (rule 8's "single home" discipline).

## What the MCP server would expose

| Tool | Data source | Backing code (new, thin) |
| --- | --- | --- |
| `get_bank()` | `~/.runelite/Data Exports/container_bank.json` (NDJSON, live-written by `data-export`) | new `pipeline/lib/bankexport.mjs` — parse NDJSON → `[{id,quantity,name}]`, `--probe`-verified |
| `get_equipment()` (bonus, same source family) | `container_equipment.json` | same module, different filename constant |
| `get_inventory()` (bonus, same source family) | `container_inventory.json` | same module, different filename constant |
| `get_offers()` | `~/.runelite/exchange-logger/*` via `pipeline/lib/offers.mjs`'s `readOfferRows`/`offersSnapshot` | thin wrapper — **zero new logic**, this module already exists |
| `get_fills()` / `get_positions()` | `regenerate({ write:false })` in `sync-fills.mjs` | thin wrapper — **zero new logic**, this function already exists and already supports a no-write read |

All five are read-only, local-filesystem reads with no network calls and no git operations —
faster and lower-ceremony than today's "run `sync-fills.mjs`, then read `positions.json`/
`fills.json` off disk" two-step, but not functionally different from it. The value isn't new
capability, it's **removing the manual bank-export-and-paste step** and giving the agent a
directly-callable read instead of a file-path handoff.

**Naming caution:** `get_positions()`/`get_fills()` here would NOT replace `sync-fills.mjs`'s
on-demand-sync role (SY1's "auto-run sync themselves before the read" doctrine,
`CLAUDE.md` pipeline-doctrine paragraph) — a bank/offers/fills MCP tool that reads WITHOUT first
regenerating would go stale exactly the way a raw `positions.json` read without sync already can.
Any `get_fills()`/`get_positions()` tool must call `regenerate()` (which itself re-reads
`LOG_DIR` fresh every call — line 186 of `sync-fills.mjs`) rather than just `readFileSync` the
possibly-stale on-disk JSON, or it reintroduces the staleness bug SY1 was built to kill.

## How it slots into `PLAN-REVERSE-FLIP.md`

- **Replaces RF0's manual seed step, doesn't replace RF0 itself.** RF0 (Question 1) still needs a
  human/agent judgment pass — "which of these 687 items does Ben want tracked as a keep/reverse-
  flip candidate" is not mechanical. What this plan removes is the *friction* of getting the raw
  list in front of the agent: today Ben exports + says "here's my bank," tomorrow the agent calls
  `get_bank()` directly, mid-conversation, with no export step. `declare-owned.mjs seed` (RF0)
  still does the writing; `get_bank()` is a faster way to populate the conversation context it
  reads from. **RF0's design does not change** — this plan is an input-convenience layer under
  it, not a replacement for its curation/classification logic.
- **Supersedes RF5 outright.** RF5's entire premise — "if manual re-seeding proves tedious, a
  sibling `.runelite/bank-export/` dir + `sync-bank.mjs` + a small custom RuneLite plugin (~100
  lines) could auto-supply it" — is moot: the plugin already exists (`data-export`), already
  installed, already writing exactly that shape to `~/.runelite/Data Exports/`. If this plan
  ships, `PLAN-REVERSE-FLIP.md`'s RF5 chunk should be marked superseded-by-this-plan rather than
  built as specced (its `sync-bank.mjs --probe/--dry/--apply` diff-and-reconcile idea is still
  sound design, but as an MCP tool call, not a new CLI command with its own gitignored dir).
- **The safety ruling both plans share is unchanged.** RF's Question 3 ruling — "bank truth never
  gets injected into `fills.json`/`positions.json`; only `BANKED` lines Ben explicitly confirms do
  that" — extends unmodified to this plan's `owned-items.json` boundary (Ruling 4 above). Nothing
  about having a live-read tool changes that judgment gate.

## Two tiers

### Tier A — file-watching MCP server (recommended, low-risk, start here)

A local Node MCP server, matching this repo's existing stack and conventions exactly (no
framework, ES modules, `pipeline/lib/`-style pure modules underneath), exposing the five tools
above as thin reads over already-existing local files:

- **Bank/equipment/inventory:** read `~/.runelite/Data Exports/container_*.json` — NDJSON parse,
  same trust level as `exchange-logger`'s files (both are RuneLite-plugin-written, both already
  trusted by the existing pipeline).
- **Offers:** call `pipeline/lib/offers.mjs`'s existing `readOfferRows`/`offersSnapshot` — zero
  new parsing logic.
- **Fills/positions:** call `sync-fills.mjs`'s existing `regenerate({ write:false })` — zero new
  reconstruction logic.
- **Cost:** small. The hard parts (log-format parsing, FIFO reconstruction, offer normalization)
  are ALL already built and tested (`pipeline/test/reconstruct.test.mjs`,
  `pipeline/test/offers.test.mjs` if it exists — verify at build time). What's new is (a) a
  ~50-line NDJSON reader for the `container_*.json` files with its own `--probe` verification
  pass, and (b) the MCP protocol plumbing itself (tool schema declarations + a stdio server loop)
  — the latter is boilerplate, not domain logic.
- **Risk:** low. Read-only, local-only, no git, no network, no write path into any tracked file.

### Tier B — live-socket / custom-plugin version (not recommended now)

A hypothetical push-based version — a custom RuneLite plugin that streams bank/offer/inventory
deltas to the MCP server over a local socket in real time, rather than the MCP server polling a
file on each tool call.

- **Extra cost:** a maintained custom RuneLite plugin (Java, RuneLite plugin API, a build/publish
  pipeline of its own — a materially different skillset and toolchain from this repo's Node/ES-
  module stack), a socket protocol, and ongoing maintenance against RuneLite API changes. This is
  the class of cost `pipeline/FILLS-PIPELINE.md` §8 already weighed and rejected for fills
  ("worst case: a ~100-line custom plugin" was the FALLBACK, not the default, precisely because
  the existing `exchange-logger`/`data-export` plugins already cover the need).
- **What it would actually buy:** lower latency between a real bank/offer change and the MCP tool
  seeing it. Given every consumer here is a conversational agent (not a sub-second trading bot),
  tier-A's "read the file fresh on each tool call" latency (bounded by the `data-export`/
  `exchange-logger` plugins' own write cadence — see the open unknown below) is very likely
  already fast enough. No evidence exists that tier-A's latency is a real problem — building
  tier-B without that evidence would be solving an unconfirmed problem at real ongoing cost.
- **Recommendation:** do not build tier-B unless tier-A ships and Ben reports its lag as an actual
  friction point in real use. Revisit only with evidence, matching this repo's standing "gate on
  error-cost, not on n" / don't-build-ahead-of-real-pain posture.

## The mechanics of an MCP server in this setup

- **What it is:** a local Node process, started and owned by Claude Code (not by this repo's app
  or deployment), speaking the Model Context Protocol over stdio to expose typed tools the agent
  can call mid-conversation — the same shape as any other MCP server, just backed by this repo's
  `pipeline/lib/` modules instead of a SaaS API.
- **Registration:** Claude Code MCP servers are registered locally (project-level `.mcp.json` or
  the `claude mcp add` CLI, pointing at a `node <path-to-server.mjs>` command) — this is Ben's-
  machine configuration, not a file this repo's deployed app or CI ever touches. **Not verified
  against this Claude Code version's exact current config schema in this investigation — confirm
  the precise registration mechanism at build time** (the concept is stable; the exact
  config-file name/CLI flags are worth a quick check against current docs before writing chunk
  RF0-equivalent server-registration steps).
- **Scope:** runs only when Claude Code is running on Ben's machine, reads only local files under
  his home directory, never binds a listening network port, never appears in this repo's deployed
  `index.html`/GitHub Pages surface. It is infrastructure for the AGENT, not a repo feature.
- **No app/CI footprint:** no `APP_VERSION` bump (mirrors `js/reverseflip.mjs`'s "node-only at
  ship time, no app import" precedent, `PLAN-REVERSE-FLIP.md`'s Bookkeeping checklist), no CI
  wiring beyond ordinary `node --check`/fixture tests on the new pure modules, no GitHub Actions
  involvement (`.github/workflows/checks.yml` never sees a bank dump — it has no reason to; the
  server never runs in CI).

## Target architecture (tier A)

```
~/.runelite/Data Exports/container_bank.json  ──┐
~/.runelite/Data Exports/container_equipment.json ─┤   pipeline/lib/bankexport.mjs   (NEW, pure NDJSON
~/.runelite/Data Exports/container_inventory.json ─┘   reader + --probe verification, mirrors
                                                        sync-fills.mjs's LOG_DIR discipline)
~/.runelite/exchange-logger/*  ─────────────────────▶  pipeline/lib/offers.mjs        (EXISTING)
fills.json + sync-fills.mjs regenerate({write:false}) ▶ (EXISTING)
                                                              │
                                                              ▼
                                            pipeline/mcp/bank-server.mjs   (NEW — MCP protocol
                                            plumbing: tool schemas + stdio loop, imports the
                                            above three sources, exposes get_bank/get_equipment/
                                            get_inventory/get_offers/get_fills/get_positions)
                                                              │
                                                    registered in Claude Code's local MCP config
                                                    (Ben's machine only — see mechanics above)
```

`pipeline/mcp/` would be a new directory (mirrors `pipeline/commands/`/`pipeline/lib/`'s existing
split — commands are CLI entrypoints, lib is pure logic, mcp would be the protocol-adapter layer
that imports lib the same way commands does, never duplicating parsing logic that already lives
in `sync-fills.mjs`/`offers.mjs`).

## Staged chunks (if this plan is picked up)

Named for continuity with this doc; renumber into `PLAN.md` at execution time per
`docs/PLANNING.md`'s lifecycle. None of these are built by this scoping pass.

### MCP0 — Resolve the write-cadence unknown (foundation, blocks nothing else from being scoped but should land before MCP1's tool ships)
- Watch `~/.runelite/Data Exports/container_bank.json`'s mtime across a real play session
  (open/close bank a few times, wait between) to confirm the trigger (on bank-interface-close?
  periodic? both?) and whether `includeSeedVault=false` should flip on.
- **Acceptance:** a short written note (this plan's own Honesty section, updated) stating the
  confirmed cadence — no code required for this chunk, purely an observation pass.

### MCP1 — `pipeline/lib/bankexport.mjs` (pure reader, no MCP plumbing yet)
- **New:** `readContainer(name)` → parsed `[{id,quantity,name}]` off
  `~/.runelite/Data Exports/container_<name>.json`, NDJSON-aware (one object per line, not a
  wrapping array — confirmed different from the Downloads `bank-dump.json`'s array-of-objects
  shape, so the parser must NOT assume `JSON.parse(wholeFile)`).
- A `--probe` CLI mode (same discipline as `sync-fills.mjs --probe`) to print raw-vs-parsed lines
  once against the real file before trusting the mapping.
- **Acceptance:** fixture-pinned parse of a synthetic multi-line NDJSON sample; `--probe` output
  reviewed against the real `container_bank.json` once.

### MCP2 — MCP protocol plumbing + tool registration
- **New:** `pipeline/mcp/bank-server.mjs` — stdio MCP server exposing `get_bank`/`get_equipment`/
  `get_inventory` (via MCP1) and `get_offers`/`get_fills`/`get_positions` (thin wrappers over the
  EXISTING `offers.mjs`/`sync-fills.mjs` functions, per "What the MCP server would expose" above).
- Local registration in Claude Code's MCP config (mechanics above — confirm exact schema at build
  time).
- **Acceptance:** each tool callable from a live Claude Code session, output spot-checked against
  a manual read of the same underlying file/function; confirms the `regenerate({write:false})`
  path never writes (diff `git status` before/after a `get_positions()` call — must be empty).

### MCP-DEFER — mark `PLAN-REVERSE-FLIP.md` RF5 superseded
- Not a code chunk — a doc reconciliation. Once MCP1/MCP2 ship, edit `PLAN-REVERSE-FLIP.md`'s RF5
  section to note it's superseded by this plan (per rule 8's "grep and fix contradicting prose in
  place," not append-only) rather than leaving RF5 as an open, now-redundant, "build a custom
  plugin" chunk.

## Encoding boundary

| Concern | Encoded (script) | Judgment (Ben/agent) |
| --- | --- | --- |
| Parsing `container_*.json` / offers / fills correctly | `bankexport.mjs`/`offers.mjs`/`sync-fills.mjs` — mechanical, fixture-pinned | none |
| Whether a `get_bank()` item becomes an `owned-items.json` entry | tool just returns the raw list | **Ben/agent decides** — curation stays exactly as RF0 specced, unchanged by this plan |
| MCP registration itself | one-time local config, mechanical once the schema is confirmed | Ben approves what runs as a local server on his machine |
| Tier-A vs tier-B | this plan recommends tier-A now | **Ben decides** whether tier-B is ever worth building, gated on real observed lag |

## Bookkeeping & compatibility checklist (per chunk, when built — none of this applies to this scoping pass)

- **README.md** "Map of the repo" gets entries, at creation, for: `pipeline/lib/bankexport.mjs`,
  `pipeline/mcp/bank-server.mjs`, and a new "Local-only, non-deployed" note distinguishing the MCP
  server from every other file in the repo's existing ROOT-LOCKED/movable inventory tables (it is
  neither — it never ships to the app or GitHub Pages at all).
- **`pipeline/FILLS-PIPELINE.md` §10** gets the `data-export` plugin's config keys + confirmed
  write cadence (MCP0's finding) added alongside the existing `exchange-logger` field-mapping
  notes — same environment-notes single home, not a new doc.
- **`.gitignore`:** no new entries needed — `~/.runelite/Data Exports/` is outside the repo
  entirely (home directory, not repo-relative), same as `~/.runelite/exchange-logger/` today.
- **`CLAUDE.md`:** if MCP1/MCP2 ship, add a short pointer (not a full ask→command row, since this
  isn't a plain-language market-read ask) noting the MCP tools exist and where they're documented,
  per rule 8.
- **APP_VERSION:** none — no app-imported module touches this (see "mechanics" above).
- **PLAN-REVERSE-FLIP.md:** RF5 superseded-note (MCP-DEFER chunk above).

## Honesty (process rule 4 — name every unknown)

- **Confirmed, not guessed:** the `data-export` plugin's existence, its config keys, its output
  file paths/format, and that `container_bank.json`'s content matches `bank-dump.json` — all
  verified directly from `~/.runelite/Data Exports/*.json` and
  `~/.runelite/profiles2/default-*.properties` during this scoping pass, not inferred from the
  dump's shape alone.
- **The single open unknown: write cadence.** I observed the file exists and is recently written
  (today's session) but did not watch it across multiple bank interactions to confirm the exact
  trigger (on-close? periodic? both? does it also fire on every deposit/withdraw, or only session
  boundaries?). This matters for tier-A's practical freshness — if it only writes on bank-close, a
  `get_bank()` call mid-banking-session would read stale data, same class of staleness
  `sync-fills.mjs`'s "sync before every read" doctrine (`MEMORY.md`'s `sync-before-every-read`
  note) already handles for fills by re-reading fresh every time rather than trusting an on-disk
  snapshot's age. **MCP0 exists specifically to close this gap before MCP1/MCP2 are built on top
  of an assumption.**
- **MCP protocol/registration mechanics were described from general Claude Code MCP conventions,
  not verified against this exact installed version's current config schema** — flagged explicitly
  in "The mechanics of an MCP server in this setup" above. Cheap to confirm at build time (a
  `claude mcp` CLI check or a docs read), not resolved here since this is a scoping pass and no
  server was actually registered.
- **n≈0 on tier-B's latency justification.** There is no evidence tier-A's file-read latency is
  actually a problem — the "don't build tier-B yet" recommendation is a prior based on the
  consumer being a conversational agent, not a measurement. If real use later regresses this,
  timestamp `get_bank()` call turnaround before concluding tier-B is warranted, rather than
  assuming.
