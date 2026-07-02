# The Coffer / The-Ledger — instructions for Claude Code

This repo is the primary, ongoing place where this tool gets built and iterated on.
Expect repeated sessions here, not one-offs — check git log and this file for
context before assuming something is new.

## What this is
- **The Coffer**: single-file OSRS Grand Exchange flipping tool. Everything lives in
  `index.html` (vanilla JS, no build step, no framework), deployed via GitHub Pages
  at bensumm.github.io/The-Ledger/. See `README.md` for the file inventory and deploy
  mechanics.
- **Fill-data pipeline**: closes the loop between the tool's trade suggestions and
  real GE trades, captured client-side via RuneLite's Exchange Logger plugin. Full
  design doc: `FILLS-PIPELINE.md`. Sync script: `sync-fills.mjs` (runs on Ben's
  Windows machine, reads `.runelite/exchange-logger/*`, writes/commits/pushes
  `fills.json`). Read `FILLS-PIPELINE.md` top to bottom before touching either.

## Repo is public — no PII
This repo is public on GitHub. Never commit account names, RSNs, real names, emails,
or other personally identifying info into tracked files (code, comments, commit
messages, `fills.json`, docs). Git author identity (`user.name`/`user.email`) is
already configured locally as `bensumm` / `benlsummers@gmail.com` — that's expected
metadata, not a leak; the concern is content, not commit authorship.

## Process rules (carried over from prior sessions — keep following these)
1. `index.html` in the repo is canonical. Confirm the current version before editing;
   don't work from a stale copy (a rollback incident happened this way once).
2. Validate every edit to `index.html`: extract the `<script>` body, `node --check`
   it, verify brace/paren/bracket balance. Prefer exact-string-match patches that
   fail loudly over fuzzy ones.
3. Ben wants prose explanations of what changed and why, alongside code — not just
   a diff.
4. Be honest about statistical limits in any calibration/analytics work. Never
   oversell signal quality from small samples.
5. Bump `APP_VERSION` and the `BUILD` date constant in `index.html` on every shipped
   change.
6. Before running `git commit`/`git push` (including via `sync-fills.mjs`), it's fine
   to just do it once the change has been described to Ben — but for the *pipeline
   script's own* automated commits (via Task Scheduler), no confirmation loop is
   possible or expected; that's by design (§4.7 of FILLS-PIPELINE.md).
7. Ben doesn't have a separate git GUI client on the Windows machine — git CLI + SSH
   auth to GitHub is already working and is the only tool needed; don't suggest
   installing anything else for git operations.

## Environment notes (Windows machine)
- RuneLite config lives under `~/.runelite/profiles2/*.properties`. Changes made
  in-game only flush to disk on client close/restart — if a just-changed setting
  still reads the old value, ask Ben to restart the client before re-checking.
- Exchange Logger plugin log: `~/.runelite/exchange-logger/exchange.log`, JSON mode.
  Real field names differ from the plugin's own naming conventions in the schema —
  see the ADAPTER comment block at the top of `sync-fills.mjs` for the verified
  mapping (`item`→itemId, `offer`→price, `max`→qty, `qty`→filled, `worth`→spent).
  Don't re-guess field names; that mapping was verified against real log output.
- No distinct "cancelled" state exists in the log — a cancelled offer just goes
  straight to `EMPTY`. `sync-fills.mjs`'s `buildEvents()` does a sequence-aware pass
  to infer cancellation; don't revert to pure line-by-line parsing.
