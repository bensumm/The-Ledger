# PLAN — executor rules, standing exclusions, shipped shas

Open work: `docs/BACKLOG.md` (no plan) and `plans/` (active plans). Process: `docs/PLANNING.md`. This file was a
255 KB scoreboard until 2026-11-24; every old Status row, chunk spec and Discovered entry is in
`git show a3e08de:PLAN.md`, and where each one went is in `git show LN1SHA:pipeline/experiments/LN1-FATES.md`.

## Executor rules (apply to every chunk)

- End each chunk with: `node --check` on touched JS; `node pipeline/ci/run-tests.mjs`; the CI guards
  (`.github/workflows/checks.yml`); a real browser or Playwright pass for any app change (`serve.cmd`);
  `APP_VERSION` / skill `version:` bumps per CLAUDE.md rule 5; a descriptive commit; landing per `/ship`. If the
  deployed app changed, watch `pages-build-deployment` to success.
- No PII in any tracked file or commit message.
- NEVER edit RuneLite's own `exchange.log`; the writable source is the sibling `coffer-manual.log`.
- `positions.json` / `fills.json` are pipeline outputs: only `sync-fills.mjs` writes them.
- `git add` only the files you changed; rebase if `main` moved.
- Unrelated debt goes to `docs/BACKLOG.md` as one line; don't fix drive-by.
- Spec style: the rule plus one cheap named anchor. No pasted live data; it rots.
- Every chunk carries its own reconciling docs pass (CLAUDE.md rule 8): fix superseded statements in place; move,
  never copy.

## Dispatch

- The coordinator hands one chunk per subagent. Chunks run in parallel only when their primary files are disjoint
  (different functions of one file is acceptable, the same function is not). Parallel lanes use worktrees; the
  coordinator rebases and lands each one, never force-pushing `main`.
- At the start of each wave after the first, a separate agent sweeps the docs for drift the previous wave left.

## Out of scope (standing decisions — don't re-open without Ben)

- App-native offer polling loop — the agent-run `watch-positions.mjs` + `/loop` routine stays.
- RuneLite-Android / mobile auto-capture — wrong client.
- Cloud backend / PC-as-server — GitHub-as-backend chosen.
- `momVerdict`/cut-trigger changes from T1 — momentum strength is display-only for now.
- Rating cutoff/weight calibration — placeholder values stay until the validation study.
- Converting skills to subagents — scripts do the heavy lifting; skills encode judgment.

## Shipped shas (for CLAUDE.md rule 9; ids whose recorded sha no longer resolves are omitted)

BSH H2+H3 bddf12f 08ebb20 · SLT C1–C4 dc07707 · DL2 73eb65e · DL4 6c9abf2 · DP1 597f132 · PM1 6aba80b · TG1 b2634a1 · T1 c7b53e7 · T2 70633f6 · O1 b0749bf · K1 283e12a · K3 ec02495 · S1 5ad72a9 · S2 12e8a86 · S3 3a38018 · Q1 23deba0 · E1 4c433d0 · L1 3404681 · G1 553c3a6 b57fbe8 · M1 6789859 d3df7fe · N1 033318e · OR1 1822ad9 · OR2 94781cc · TD1 d147bab · TD2 e442367 · TD3 a1110c7 · LW3 8ad3a45 · V1+V2 8a5d160 · V3 692baee · V4 2a87269 · V5 825469f · FC1 0e48b2c · YF1 2ab0139 · YS1 92ffa1c · YS2 27f0baa · YV1 1ea914d 7502889 2fdae81 · YT1 5439fed · YP2 9f60c15 · YP1 a93da6a · YA1 a7fd785 · PM2 5ca4f95 · SR1 457a7bd · GA1 3a7f68f · D0 7e0e962 · V2-P0 a6dc7d1 · V2-P1 f02fbf5 8db97bf · V2-P2 910bea1 · V2-P3 b55f895 · V2-P4a e2eed20 · V2-P4b ec425f7 · V2-P4c cfcc624 · V2-P5 fe46f2e · V2-P6a 6c3f1b5 · V2-P6b a21f1bc · V2-P6c 6432a05 · V2-P7 105326a f8de508 · ARCH-1 a24d456 · COD-1 55861d1 · DL1 ef239dc · COD-2 81d9049 · COD-3 5b91d10 · COD-4 a923496 · DOC-1..4 e45cd7b 560b28b 1619ff6 0c9ecca · ARCH-3 6808c58 · SWEEP ef68792 · SF-2 fe57a3b · SF-1 2cbca38 · SF-3 3a36a1e · DT1–DT6 7756706 63d5863 aeab7d1 369f059 f642fef 296332d · DAEMON P1–P10 8a372df df86759 c1c7080 167c439 9540d25 937a687 · HT0–HT5 51da206 746da1b 89bfdde e1d8c1a · RF0–RF6 0dc43ca 665e22e 5df6987 8d9f348 89bfdde e1d8c1a · CAP-DEP L1–L3, C1 ecbc5de 10856ab · LIB-SUBDIRS 0–7 36ee38c 0193801 0e0b5f9 2424834 d527217 49792ac · CLEANUP C1–C11 5f3ac4b · MT1–MT3 86e4aa6 · FC1 c8fee6b · CT1 ecbc5de · WX1 9aeaf7a · PARITY PV/AP1/AP4/CL/TV/SIG-DEL 1df4352 143d7c9 a794f99 a214f4e 9921c91 2e1a110 · AR1–AR4 2b7af60 4c8973a ceb538b · A1–A6 4acd1bb c50626f · FPS 1–4 5e7e9d9 0763dbc · VOL24 1/2/2b/3/4 bd3f254 42ce665 69696fc 195c074 5851e18 · OUTPUT-TABLE 3b50b7b · BL1–BL4 b8fc8f2 9e5a9e3 · DL-0/DL-1–3 20a45f9 03fb76e · BLINDSPOT #1–#7 746da1b · RVA 5e7e9d9 · MWO 5e7e9d9 2d3b21f · CV1–CV14 19c3682 219192d · RDP 1–3 (4 declined) fce5974 · REACH-SURFACE 0–4, 8 (5 cancelled; 6/7/9 unscheduled) 88f7df7 27dd25d dcf26d4 18e53c5 e927dd4 1cfc5ea
