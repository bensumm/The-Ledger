# PLAN — executor rules, standing exclusions, shipped shas

Open work: `docs/BACKLOG.md` (no plan) and `plans/` (active plans). Process: `docs/PLANNING.md`. This file was a
255 KB scoreboard until 2026-11-24; every old Status row, chunk spec and Discovered entry is in
`git show a3e08de:PLAN.md`, and where each one went is in `git show a27dc01:pipeline/experiments/LN1-FATES.md`.

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

## Chunk ids already used (read by `lint-plan-refs.mjs --collisions`; never reuse)

Used ids: A1 A2 A3 A4 A5 A6 A7 A8 AB4 AB5 AB6 AB7 AB8 AB9 AC-0 AC1 AC2 AC3 AC4 AC4a AC4b AC5 AC6 AC7 AC8 AC9 AF1/AF2 AF1b AF3 AF3b AF4 AF5 AF6 AF7 AF8 AF9 AL1 AL2 AL3 AL4 AL5 AO1 AP1 AP2 AP3 AP4 AP5 ARCH-1 ARCH-2 ARCH-3 AZ1 AZ2 AZ3 B1 B2 B3 B4 B5 BD1 BD2 BD3 BD4 BD5 BD6 BE1 CI1 COD-1 COD-2 COD-3 COD-4 CT1 D0 D1 D2 D3 D4 D5 DL1 DL2 DL3 DL4 DOC-1 DOC-2 DOC-3 DOC-4 DOC-5 DP1 DS0 DS1 DS2 DS3 DS4 DS5 DS6 DS7 DS8 DS9 DT1 DT1b DT2 DT3 DT4 DT4b DT4c DT5 DT6 E1 E2 E3 E4 EC5 EF-0a EF0 EF1 EF2 EF3 F1 F2 F3 F4 F5 F6 F7 F8 FA1 FA2 FA3 FA4 FA5 FA6 FA7 FC1 FD1 FD2 FD3 FD4 FD5 FD6 FD7 FX1 G1 G2 G3 G4 G5 G6 G7 GA1 GC1 GN-0 GN-1 GN-2 H1 H2 H3 H4 HYB1 HYB2 HYB3 K1 K2 K3 L1 LH1 LH2 LH3 LU1 LW1 LW2 LW3 M1 M2 M3 M4 M5 M6 MCP0 MCP1 MCP2 N1 NY1 NY2 O1 O2 O3 O4 O5 O6 OR1 OR2 P1 P8 PC1 PC2 PC3 PC4 PF1 PF1b PF2 PF3 PF4 PF5 PF6 PF7 PF8 PM1 PM2 Q1 Q2 Q3 Q4 Q5 R1 R2 R3 R3b R4 R4b R5 R6 R7 R8 RB-0 RB-1 RB-2 RB-3 RB-4 RB-5 RC-S1 RC-S2 RC-S3 RC1 RC2 RC3 Rule-8 S1 S2 S3 SC0 SC1 SC2 SC3 SC4 SC5 SC6 SEP10 SEP11a SEP11b SEP12 SEP13 SEP14 SEP15 SEP16 SEP16a SEP16b SEP16c SEP16d SEP16e SEP1a SEP1b SEP2 SEP3 SEP4 SEP5 SEP6 SEP7 SEP8 SEP9 SF-1 SF-2 SF-3 SL1 SM0 SM1 SM2 SM3 SM4 SM5 SP1 SP2 SP3 SP4 SP5 SP5-code SR1 SY1 T1 T2 TB1 TC1 TD1 TD2 TD3 TG1 TR1 TR2 TR3 TR4 TR5 TV1 V1 V2 V2-P0 V2-P1 V2-P2 V2-P3 V2-P4a V2-P4b V2-P4c V2-P5 V2-P6a V2-P6b V2-P6c V2-P7 V2-P8 V3 V4 V5 V6 W1 W3-1 W3-2 W3-3 WC1 WC2 WC3 WC4 WX1 X1 X2 YA1 YF1 YP1 YP2 YS1 YS2 YT1 YV1

## Shipped shas (for CLAUDE.md rule 9; partial)

BSH H2+H3 bddf12f 08ebb20 · SLT C1–C4 dc07707 · DL2 73eb65e · DL4 6c9abf2 · DP1 597f132 · PM1 6aba80b · TG1 b2634a1 · T1 c7b53e7 · T2 70633f6 · O1 b0749bf · K1 283e12a · K3 ec02495 · S1 5ad72a9 · S2 12e8a86 · S3 3a38018 · Q1 23deba0 · E1 4c433d0 · L1 3404681 · G1 553c3a6 b57fbe8 · M1 6789859 d3df7fe · N1 033318e · OR1 1822ad9 · OR2 94781cc · TD1 d147bab · TD2 e442367 · TD3 a1110c7 · LW3 8ad3a45 · V1+V2 8a5d160 · V3 692baee · V4 2a87269 · V5 825469f · FC1 0e48b2c · YF1 2ab0139 · YS1 92ffa1c · YS2 27f0baa · YV1 1ea914d 7502889 2fdae81 · YT1 5439fed · YP2 9f60c15 · YP1 a93da6a · YA1 a7fd785 · PM2 5ca4f95 · SR1 457a7bd · GA1 3a7f68f · D0 7e0e962 · V2-P0 a6dc7d1 · V2-P1 f02fbf5 8db97bf · V2-P2 910bea1 · V2-P3 b55f895 · V2-P4a e2eed20 · V2-P4b ec425f7 · V2-P4c cfcc624 · V2-P5 fe46f2e · V2-P6a 6c3f1b5 · V2-P6b a21f1bc · V2-P6c 6432a05 · V2-P7 105326a f8de508 · ARCH-1 a24d456 · COD-1 55861d1 · DL1 ef239dc · COD-2 81d9049 · COD-3 5b91d10 · COD-4 a923496 · DOC-1..4 e45cd7b 560b28b 1619ff6 0c9ecca · ARCH-3 6808c58 · SWEEP ef68792 · SF-2 fe57a3b · SF-1 2cbca38 · SF-3 3a36a1e · DT1–DT6 7756706 63d5863 aeab7d1 369f059 f642fef 296332d · DAEMON P1–P10 8a372df df86759 c1c7080 167c439 9540d25 937a687 · HT0–HT5 51da206 746da1b 89bfdde e1d8c1a · RF0–RF6 0dc43ca 665e22e 5df6987 8d9f348 89bfdde e1d8c1a · CAP-DEP L1–L3, C1 ecbc5de 10856ab · LIB-SUBDIRS 0–7 36ee38c 0193801 0e0b5f9 2424834 d527217 49792ac · CLEANUP C1–C11 5f3ac4b · MT1–MT3 86e4aa6 · FC1 c8fee6b · CT1 ecbc5de · WX1 9aeaf7a · PARITY PV/AP1/AP4/CL/TV/SIG-DEL 1df4352 143d7c9 a794f99 a214f4e 9921c91 2e1a110 · AR1–AR4 2b7af60 4c8973a ceb538b · A1–A6 4acd1bb c50626f · FPS 1–4 5e7e9d9 0763dbc · VOL24 1/2/2b/3/4 bd3f254 42ce665 69696fc 195c074 5851e18 · OUTPUT-TABLE 3b50b7b · BL1–BL4 b8fc8f2 9e5a9e3 · DL-0/DL-1–3 20a45f9 03fb76e · BLINDSPOT #1–#7 746da1b · RVA 5e7e9d9 · MWO 5e7e9d9 2d3b21f · CV1–CV14 19c3682 219192d · RDP 1–3 (4 declined) fce5974 · REACH-SURFACE 0–4, 8 (5 cancelled; 6/7/9 unscheduled) 88f7df7 27dd25d dcf26d4 18e53c5 e927dd4 1cfc5ea
