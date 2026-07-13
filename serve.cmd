@echo off
rem Local dev server for The Coffer. ES module scripts (js/main.js) can't load
rem over file://, so index.html must be served over real HTTP for local testing.
rem GitHub Pages deploys are unaffected either way -- that's always real HTTP.
cd /d "%~dp0"
rem Start the LW1 log-watcher daemon alongside the server (same console via start /b,
rem so one Ctrl+C stops both) -- the localhost app polls its regenerated
rem positions/offers.json (LW2), making serve.cmd the live desk experience.
rem Running serve.cmd twice would start a second (harmless, idempotent) watcher.
start /b node pipeline/watch-log.mjs
echo Serving http://localhost:8000/ -- Ctrl+C to stop (also stops the log-watcher)
rem LW4: the node dev-server serves the repo-root static files (ES modules, correct MIME) AND
rem exposes POST /api/scan (bound 127.0.0.1 only) so the app's "Refresh scan" button runs a REAL
rem local scan -- screen.mjs --mode all --publish rewrites screen.json with ZERO git, then the app
rem re-reads it. If node is unavailable, fall back to a static-only server (no local scan endpoint).
node pipeline/dev-server.mjs
if errorlevel 1 (
  echo dev-server failed to start -- falling back to a static-only server (no /api/scan endpoint).
  py -m http.server 8000 2>nul
)
if errorlevel 1 (
  python3 -m http.server 8000 2>nul
)
if errorlevel 1 (
  npx --yes serve -l 8000 .
)
