# PLAN-MULTIUSER-ONBOARDING — from personal instance to cloneable tool

**Status: shape-of-the-problem doc, nothing scheduled.** Read-only investigation, 2026-07-19.
The question: what would it take for a stranger to clone this repo and configure it for
their own personal usage? What's the onboarding process? This is the high-level list of
things that DEFINITELY need to happen, not a spec.

---

## A) The coupling inventory — where the tool assumes it's Ben's instance

### A1. Identity / deploy coupling
| Where | What's hardcoded |
| --- | --- |
| `README.md` :3, `CLAUDE.md` :7 | Live-app URL `https://bensumm.github.io/The-Ledger/` |
| `js/marketfetch.js` :13, `pipeline/lib/marketfetch.mjs` :30 | Wiki-API User-Agent strings: `TheCoffer/0.30 (bensumm; github.com/bensumm/The-Ledger)` — the wiki asks for a contactable UA, so a fork shipping Ben's identity is both wrong attribution and a courtesy violation |
| `pipeline/commands/sync-fills.mjs` `--publish` path | Assumes push access to `origin/main` of *this* repo, the admin-bypass ruleset arrangement (PR+checks required, admin always bypass), and the phone-writer/`mobile-fills.log` multi-writer contract |
| `CLAUDE.md`, `/ship` skill | Git author `bensumm`/`benlsummers@gmail.com` documented as "already configured"; the whole ship flow narrates Ben's ruleset id, Ben's token-blocked PR state, `C:\dev\The-Ledger` desk checkout |
| GitHub Pages | Deploy-from-`main`/root is a repo Setting the new user must flip themselves; the app's mobile write-back (`js/github.js`) needs a fine-grained PAT on *their* repo |
| `docs/LORE.md`, `CHANGELOG.md`, many module headers | `bensumm.github.io` named as "the deployed origin" (mostly narrative, not functional) |

Already portable (worth noting): `js/github.js` derives owner/repo from the Pages
origin (`<owner>.github.io/<repo>/`) with localStorage overrides — deliberately no
hardcoded account. `IS_LOCALHOST` gating is origin-based, not name-based. This is the
pattern the rest should follow.

### A2. Local environment paths (Windows-shaped)
| Where | What's hardcoded |
| --- | --- |
| `pipeline/commands/sync-fills.mjs` :73, `pipeline/commands/ensure-server.mjs` :32 | `REPO_DIR` default `C:\\dev\\The-Ledger` (flag-overridable via `--repo-dir`, but the default is Ben's machine) |
| `sync-fills.mjs` :72, `pipeline/lib/offers.mjs` :21, `add-manual-fill.mjs` :64 | RuneLite log dir `~/.runelite/exchange-logger` (homedir-relative — portable across users, but assumes desktop RuneLite + the Exchange Logger plugin in JSON mode) |
| `serve.cmd`, `watch-log.cmd` | Windows batch launchers (`.cmd`, `py` launcher fallback) — no POSIX equivalent |
| `/overnight` + `/ship` skills | Name `C:\dev\The-Ledger` as "the MAIN checkout" |
| `pipeline/.market-archive.sqlite`, `pipeline/.cache/`, `.capital-state.json`, `heartbeat.json`, `outcomes.json` | Machine-local artifacts — correctly gitignored already, but never documented as "you will grow these" |

### A3. Personal DATA committed as if it were code
The repo is **public** and Ben's entire trade history is tracked:

- `fills.json` (~527KB, 3,600+ real GE offer events), `positions.json`, `offers.json`,
  `suggestions.jsonl` (**39MB** of logged suggestions), `screen.json` +
  `pipeline/screen.json`, `watchlist.json`, `dip-watchlist.json`, `ignored-items.json`,
  `hold-thesis.json`, `alerts.json`, `mobile-fills.log`, `pipeline/.guide-history.jsonl`.
- These are ROOT-LOCKED by design (the app fetches them same-origin), so they can't just
  be gitignored without breaking the deployed app — the app *needs* files at those paths.
  A new user needs **empty/seed versions**, not Ben's book.
- A fork inherits all of it, including in git history. `/analyze`, buy-limit windows,
  F1 calibration, and the retro loop would all compute against Ben's trades until the
  first real sync overwrites them.

### A4. Config surface — there isn't one
There is **no central config file**. The tunables live scattered as in-code defaults and
skill prose:

- `screen-flip-niches.mjs`: `--capital` default falls back to a derived pool or a bare
  `100_000_000`; `--gp-floor` default `4_500_000_000`; the 500k gp/d attention floor;
  slots; grade cutoffs.
- `sync-fills.mjs`: `GIT_PUSH = true` is a code constant; `REPO_DIR` a code default.
- The 4h buy-limit model, tax model, band parameters — fine as doctrine, but thresholds
  calibrated to Ben's bankroll (~100m-scale) and risk tolerance are presented as facts.
- **Timezone**: the `/overnight` skill hard-codes Ben's time-geography ("Ben is
  US-Pacific; OSRS demand is UK-centric", sleep window ~01–09 local mapped onto GMT
  windows). A user in Europe has an inverted overnight thesis. The app's local-time
  display convention is portable; the *trading-posture* timezone math is not.
- Capital state: `.capital-state.json` (gitignored, desk-side) is the stated-bankroll
  anchor — undocumented for a newcomer.

### A5. The `.claude/` layer — half the product is prose about Ben
- Skills (`/scan`, `/positions`, `/overnight`, `/morning`, `/analyze`, `/ship`) carry the
  entire judgment layer and are written **about Ben in the second person** — his risk
  tolerance, his posture, his timezone, his capital, his ship mechanics (admin bypass,
  ruleset id, token-blocked PRs).
- `CLAUDE.md` is a personal operating manual (process rules, "describe the change to Ben",
  Ben's machine notes) — plus the user-level memory system (not in the repo at all)
  carries load-bearing preferences (sync-before-read, output format, veto lists).
- **Can the pipeline run without Claude Code? Mostly yes**: every script is a plain
  `node pipeline/commands/*.mjs` CLI, the app is static HTML/JS, and `serve.cmd` +
  `watch-log.mjs` give the live desk with zero AI involvement. What's lost without the
  skills is the *judgment pass* (verdict interpretation, sizing, posture) and the
  conversational routing — the scripts print tables; the skills decide. So the honest
  framing: **the pipeline + app are the product; the `.claude/` layer is a bundled
  copilot configuration** that a new user could adopt, adapt, or ignore.
- `pipeline/ci/lint-skills.mjs` / `lint-docs.mjs` enforce Ben's doc doctrine in CI — a
  fork inherits CI that polices prose the new user may rewrite.

### A6. Docs / onboarding gap
- README "Local development" tells you how to serve the app — it does NOT tell a stranger
  how to: install the RuneLite Exchange Logger plugin (JSON mode), verify the log path,
  run a first sync, reset the data files, set up Pages, create the mobile PAT, or
  configure a branch ruleset. Those exist only as history in `pipeline/FILLS-PIPELINE.md`
  §9/§10 and CLAUDE.md, written as notes-to-self.
- No first-run experience: cloning and opening the app shows **Ben's book**.
- Node version, `npm`-less setup (no package.json workflow documented), Playwright for
  smoke tests — all implicit.

---

## B) The high-level "definitely needs to happen" list

1. **Separate personal data from program logic — seed empties + a data-reset path.**
   Ship empty/schema-valid versions of `fills.json`, `positions.json`, `offers.json`,
   `suggestions.jsonl`, `screen.json`, `watchlist.json`, `dip-watchlist.json`,
   `ignored-items.json`, `hold-thesis.json`, `alerts.json`, `mobile-fills.log` (a
   `reset-data` script or template dir), because ROOT-LOCKED same-origin fetching means
   the files must exist — they just shouldn't be Ben's. *Why:* a new user must start with
   their own empty book, and today they inherit a stranger's trade history.

2. **Externalize a single config file (e.g. `coffer.config.json` / `.env`, gitignored,
   with a committed `.example`).** Repo dir, RuneLite log dir, deploy repo/URL, wiki-API
   User-Agent contact string, timezone/locale posture, capital defaults, gp/d + gp-flow
   floors, publish on/off. Every script default (`REPO_DIR`, `GIT_PUSH`, `--capital`,
   `--gp-floor`) reads config-first, flag-override. *Why:* today the knobs are code
   constants and skill prose scattered across ~10 files; a new user can't find them, let
   alone set them.

3. **Decouple deploy + publish from Ben's repo arrangement.** The `--publish` flow,
   `/ship`, and the docs must stop assuming `bensumm/The-Ledger`, the admin-bypass
   ruleset, and the phone-writer contract; make publish opt-in (default local/zero-git —
   already true) and document "your fork + your Pages + your optional PAT" as the
   deployment story. `js/github.js`'s origin-derivation is the model. *Why:* a new user
   has a different repo, URL, auth state, and probably no branch ruleset.

4. **A first-run setup/onboarding script + a real QUICKSTART doc.** One command (or
   checklist) that: verifies node, writes the config from prompts/example, resets the
   data files, checks for the RuneLite Exchange Logger log dir, runs a dry sync, starts
   the dev server. Plus a written path: clone → serve → (optional) RuneLite plugin setup
   → first sync → (optional) fork + Pages deploy. *Why:* today the setup knowledge lives
   in design-doc history (§9/§10) and CLAUDE.md, addressed to Ben.

5. **Document the RuneLite Exchange Logger dependency as a formal prerequisite.**
   Plugin install, JSON output mode, the verified field mapping, the log-path assumption,
   desktop-only capture (mobile trades need the manual log), Windows-vs-other-OS notes
   (`serve.cmd` needs a POSIX sibling or a node launcher). *Why:* the entire fills loop
   is dead without it, and nothing tells a newcomer it exists.

6. **De-personalize the prose layer — split "how the tool works" from "how Ben runs it".**
   Rewrite skills/CLAUDE.md so user-specific facts (timezone geography in `/overnight`,
   capital scale, risk tolerance, ship mechanics) read from the config or a clearly-marked
   "operator profile" section the new user fills in; scrub `bensumm` from UA strings and
   any functional path. *Why:* the judgment layer is genuinely valuable, but today it's
   unusable-as-shipped for anyone who isn't a US-Pacific trader named Ben with ~100m gp.

7. **Deal with the already-public personal history (decision + mechanics).** Even after
   1–6, Ben's trade data remains in this repo's git history and every fork of it. Options
   range from "accept it, it's only game trades" to a history rewrite or a fresh template
   repo (see C1/C4). *Why:* gitignoring forward doesn't un-publish the past.

---

## C) Open questions / decisions for Ben

1. **What is this becoming?** A self-hosted personal clone ("template repo" model — each
   user forks/uses-template and owns their instance), vs. a shared/hosted product
   (multi-user server, accounts — a totally different architecture). Everything above
   assumes the template-repo model; a hosted product would invalidate the
   static-Pages/same-origin design and is a much bigger lift.
2. **Does the `.claude/` layer ship as part of the product?** Is "clone + Claude Code +
   the skills" the intended experience (in which case the skills need the operator-profile
   rework), or is the pipeline/app the product and the skills stay Ben's personal copilot
   config (in which case document them as optional/example)? The user-level memory can't
   ship at all — anything load-bearing in it must migrate into repo docs/skills first.
3. **What about the personal data already in public history?** Keep (it's pseudonymous
   game data — the no-PII rule already held), rewrite history (breaks every clone, loses
   the changelog's audit trail), or cut a clean template repo and let The-Ledger remain
   Ben's instance? The template-repo option also neatly answers Q1.
4. **How much calibration is personal?** The floors/grades/thresholds were tuned on Ben's
   bankroll and fill history. Do defaults ship as "Ben's calibration, restate for your
   capital", or does the config derive them from stated capital? (F1/calibration work is
   n-gated on *his* data; a new user starts at n=0.)
5. **Support surface.** A public "clone me" README implies issues/questions from
   strangers. Is Ben willing to own that, or should the doc explicitly say "as-is, no
   support"?

---

## D) Difficulty / risk read per B-item

| B-item | Difficulty | Nature | Risk notes |
| --- | --- | --- | --- |
| B1 seed-empty data files | **Low–Medium** | Mechanical | Empty artifacts must still parse everywhere (CI already checks parse); risk is a script assuming non-empty (probes, /analyze, limit windows) — needs a one-pass empty-book smoke test. The 39MB `suggestions.jsonl` also wants a size story. |
| B2 central config | **Medium** | Mechanical but wide | Touches ~10 scripts' arg/default plumbing + the skills that quote defaults; low design risk, high grep-discipline (rule-8 doc reconciliation applies in force). |
| B3 deploy decoupling | **Low–Medium** | Mechanical | `--publish` already isolated and opt-in; mostly defaults + docs. The multi-writer/phone contract is the only subtle bit — make it explicitly optional. |
| B4 setup script + quickstart | **Medium** | New surface | Pure addition, no regression risk to Ben's flow; the work is making it honest on a machine that isn't Ben's (needs testing on a clean env, ideally non-Windows). |
| B5 RuneLite prereq docs | **Low** | Docs only | Knowledge already exists in §9/§10; it's a rewrite-for-strangers, not research. |
| B6 de-personalize prose/skills | **Medium–High** | Architectural-ish | The judgment layer is deeply first-person; separating doctrine from operator profile is a real editorial redesign, and `lint-skills`/`lint-docs` CI must evolve with it. Timezone-posture generalization (`/overnight`) is genuinely new logic, not find-replace. |
| B7 public-history decision | **Low effort, High consequence** | Decision | The template-repo route is cheap and clean; a history rewrite is destructive and interacts with the protected-branch setup — decide before doing anything. |

**Overall shape:** nothing here threatens the architecture — the static-app + local-pipeline
design is already close to portable (origin-derived GitHub target, homedir-relative log
path, zero-git defaults). The two genuinely hard parts are **B6** (the prose/judgment
layer is the most personal artifact in the repo) and the **C1/C3 decision** (template repo
vs. transform-in-place), which should be made first because it changes what B1/B7 even mean.
