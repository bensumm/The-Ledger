# PLAN-LEAN — cut the instruction text, generate the registry

Status: ACTIVE. Prefix `LN`. LN1–LN5 shipped 2026-11-24 (bug 4 measured null, bug 9 dropped: `docs/BACKLOG.md`). LN0 metrics done; the frozen snapshot is captured (2026-11-24 10:51).

**Decision it changes:** what an agent reads before every scan (about 42k tokens) and what every code change must
also edit. **If it has no effect** (agents still hand-write `node -e`, or errors rise): revert the skill commits.

## Rules

- Behaviour is preserved first, shortened second. Every removed rule is one of: ENCODED (name the test or output),
  DUPLICATE (name its home), HISTORY (git), or RETIRED (owner approved). The executor ships that table per chunk.
- One chunk per commit, each reviewed by a separate agent that gets the old text and is asked what a reader would
  now do differently. Continue until a round finds nothing real, five at most.
- Edits are exact-match, never a range delete between anchors. Read the whole diff for collateral loss.
- `lint-budget.mjs --bless` after each chunk so the ceiling locks in.

## Baseline (LN0, before anything else)

Record the 5 real asks below with the current text, and from session transcripts the share of shell calls that are
`node -e` and the tokens per `/scan` and `/positions`. Prior sample: 37% of 309 calls.

Measured 2026-11-24 over the 7 session files on disk: 89 of 278 shell calls were `node -e` (32%; two files share an
opening, so some calls count twice). Only two distinct `/scan` turns exist: 18 and 8 tool calls, `node -e` 9 and 0,
context +74k and +69k tokens. No `/positions` sample. Skill text: scan 102,976 bytes, positions 60,372.

Freeze: `pipeline/experiments/frozen-market.mjs`. Snapshot, isolated home and scripts: `<home>/The-Ledger-frozen`
(`record.mjs`, `replay.sh`, `ask.sh`, `cmp.mjs`, `out/`; copy `archive.sqlite` to `<run>/pipeline/.market-archive.sqlite`).
Replay of the scan is identical to the recording except its own since-last-scan lines.

LN4 check, 5 asks, headless Sonnet, old against new CLAUDE.md, one run each: same skill or command, same verdicts and
the same main prices on all five; final context 39→34k (quote), 82→82k (scan), 67→63k (positions), 78→73k (overnight),
38→34k (reverse). One run per arm, so wording differences are noise. These runs are the LN6 baseline: the skills still
send agents to `node -e` over the saved reports, and no run used `verify-pick` because no skill names it yet.

## Chunks, in order

| Id | What | Target | Who |
| --- | --- | --- | --- |
| LN1 | Fold `PLAN.md` to executor rules, out-of-scope, the sha table rule 9 needs, and a pointer to `docs/BACKLOG.md`. Ship a table giving every Discovered and open item its fate (BACKLOG line, dropped, done); re-home measured negatives from Status rows first; repoint code citations of PLAN.md sections | 255 → ≤ 40 KB | Sonnet extracts, Opus lands |
| LN2 | Backlog bugs 1–9. Tests first; bugs 1 and 2 change booked numbers, so show before/after to the owner and wait. Bug 7 is tested only with a temp repo dir | 9 bugs | Sonnet per bug |
| LN3 | Command header format (`ask`, `usage`, `one line`) + `build-registry.mjs` generating the CLAUDE.md ask table and a README command list; CI fails when stale | table 15 → ≤ 5 KB | Sonnet |
| LN4 | CLAUDE.md rules 8–12 to imperatives; remove what LN3 generates | 42 → ≤ 20 KB | **Fable** drafts, owner approves the text |
| LN5 | Script output for deterministic scan steps: buy-limit sizing, crowded-out, capEff reading, verdict diff against the last pass, `--rows` reader for last-report files | enables LN6 | Sonnet |
| LN6 | Rewrite scan and positions skills around LN5 output | 104 → ≤ 35, 60 → ≤ 25 KB | **Fable** |
| LN7 | README `## Files` to one line per file (generated where LN3 covers it); history stays in git | 383 → ≤ 80 KB | Sonnet |
| LN8 | Memory: delete expired and encoded entries, index lines ≤ 120 chars | 16 → ≤ 7 KB | Opus, owner approves list |

Fable is used where the risk is losing meaning (LN4, LN6) and for the final review of those two. Sonnet does
mechanical and code work. LN1–LN2 first because they remove live wrongness; LN3 and LN5 precede the rewrites so
prose is replaced by something.

## Verification

- The 5 asks: scan, positions, quote, overnight, reverse-flip, on one frozen market snapshot. After LN4 and LN6 the
  same asks run by a fresh agent, compared on commands run, prices, verdicts, tool calls and tokens. A changed
  recommendation must be explained by a RETIRED row.
- Success: `/scan` prompt ≤ 18k tokens, `/positions` ≤ 14k, hand-written `node -e` under 10% of shell calls in the
  next five sessions.
- CI green and the browser smoke test on any `js/` change.

## Honesty

Five asks is a small sample: it catches a dropped rule that fires often, not a rare one. The DUPLICATE/ENCODED table
is the real protection. Token targets are estimates from file sizes.
