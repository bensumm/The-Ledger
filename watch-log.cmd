@echo off
rem Local log-watcher for The Coffer (LW1). Watches the RuneLite Exchange Logger dir and
rem regenerates fills/positions/offers.json locally on every fill/cancel/reprice -- so the
rem locally-served app (serve.cmd) shows fresh positions + live offers with no keystrokes.
rem ZERO git: no fetch, no commit, no push. Publishing to Pages stays attended (sync-fills.mjs).
rem Dies with this terminal -- Ctrl+C to stop. NO Task Scheduler job (that's the point).
cd /d "%~dp0"
node pipeline/watch-log.mjs
