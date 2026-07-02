# The Coffer / The-Ledger — instructions for Claude Code

This repo is the primary, ongoing place where this tool gets built and iterated on.
Expect repeated sessions here, not one-offs — check git log and this file for
context before assuming something is new.

## What this is
- **The Coffer**: OSRS Grand Exchange flipping tool. `index.html` is markup only;
  `styles.css` holds all styles; logic is split into ES modules under `js/`
  (`state.js` = shared mutable state as one exported `STATE` object + constants +
  persistence + diagnostics; `format.js` = formatting/tax helpers; `charts.js` =
  inline SVG rendering; `market.js` = price/guide fetch + scoring; `trends.js` =
  archive + seasonal analysis; `ui.js` = Finder/Watchlist/Signals/Ledger/Coffer
  rendering; `backup.js` = export/import; `main.js` = entry point, event wiring +
  init). No build step, no framework, no bundler — deployed to GitHub Pages at
  bensumm.github.io/The-Ledger/ exactly as these files sit on disk. See `README.md`
  for the full file inventory and deploy mechanics.
- Split out of one 1375-line `index.html` file in 2026-07 once development moved
  from mobile-only Claude sessions to Claude Code on a PC — the single-file
  constraint was about zero-build Pages deploys, not mobile editing, so the split
  keeps zero-build while making the code far more reviewable/diffable. Local testing
  needs `serve.cmd` now (ES modules don't load over `file://`); see README.
- **Fill-data pipeline**: closes the loop between the tool's trade suggestions and
  real GE trades, captured client-side via RuneLite's Exchange Logger plugin. Lives
  in `pipeline/` (kept separate from the deployed app root): full design doc
  `pipeline/FILLS-PIPELINE.md`, sync script `pipeline/sync-fills.mjs` (runs on Ben's
  Windows machine via a Task Scheduler job `CofferFillsSync`, reads
  `.runelite/exchange-logger/*`, writes/commits/pushes `fills.json` at the repo
  root — `fills.json` itself stays at root since the app fetches it same-origin).
  Read `pipeline/FILLS-PIPELINE.md` top to bottom before touching either.

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
5. Bump `APP_VERSION` (in `js/state.js`) on every shipped change.
6. Before running `git commit`/`git push` (including via `sync-fills.mjs`), it's fine
   to just do it once the change has been described to Ben — but for the *pipeline
   script's own* automated commits (via Task Scheduler), no confirmation loop is
   possible or expected; that's by design (§4.7 of `pipeline/FILLS-PIPELINE.md`).
7. Ben doesn't have a separate git GUI client on the Windows machine — git CLI + SSH
   auth to GitHub is already working and is the only tool needed; don't suggest
   installing anything else for git operations.

## The `STATE` object (js/state.js) — read before editing shared state
Almost all app-wide mutable state (`ITEMS`, `watchlist`, `trades`, `bankroll`,
`sortKey`, `LOG`, etc.) lives as properties on one exported object,
`export const STATE = {...}` in `js/state.js`, accessed everywhere as
`STATE.xxx` — not as bare imported `let` bindings. This is a hard ES module
constraint, not a style choice: a module can `export let x` and other modules can
*read* `x`, but only the declaring module can *reassign* `x` — any other module
trying `x = newValue` on an imported binding is a SyntaxError. Since `market.js`,
`ui.js`, `trends.js`, `main.js`, and `backup.js` all reassign things like `ITEMS`,
`watchlist`, `bankroll` (not just mutate them in place), those had to become
properties of one shared object instead (`STATE.ITEMS = ...` is a property
mutation on an object all modules hold the same reference to — always legal).
When adding new shared mutable state, put it on `STATE`, not as a new bare
`export let`. Constants that are never reassigned (`API`, `APP_VERSION`, weight
constants, etc.) stay as plain `export const` — no need to route those through
`STATE`.

## Environment notes (Windows machine)
- RuneLite config lives under `~/.runelite/profiles2/*.properties`. Changes made
  in-game only flush to disk on client close/restart — if a just-changed setting
  still reads the old value, ask Ben to restart the client before re-checking.
- Exchange Logger plugin log: `~/.runelite/exchange-logger/exchange.log`, JSON mode.
  Real field names differ from the plugin's own naming conventions in the schema —
  see the ADAPTER comment block at the top of `pipeline/sync-fills.mjs` for the
  verified mapping (`item`→itemId, `offer`→price, `max`→qty, `qty`→filled,
  `worth`→spent). Don't re-guess field names; that mapping was verified against real
  log output.
- No distinct "cancelled" state exists in the log — a cancelled offer just goes
  straight to `EMPTY`. `pipeline/sync-fills.mjs`'s `buildEvents()` does a
  sequence-aware pass to infer cancellation; don't revert to pure line-by-line
  parsing.
- Task Scheduler job `CofferFillsSync` runs `wscript.exe
  pipeline\run-fills-sync.vbs` every 20 min (hidden window). If any pipeline file
  moves again, that task's registered path needs re-creating too — it's not
  automatically kept in sync with the repo (`schtasks /Delete` + `/Create`, see
  `pipeline/FILLS-PIPELINE.md` §4.7).
