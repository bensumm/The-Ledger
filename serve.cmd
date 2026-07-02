@echo off
rem Local dev server for The Coffer. ES module scripts (js/main.js) can't load
rem over file://, so index.html must be served over real HTTP for local testing.
rem GitHub Pages deploys are unaffected either way -- that's always real HTTP.
cd /d "%~dp0"
echo Serving http://localhost:8000/ -- Ctrl+C to stop
py -m http.server 8000 2>nul
if errorlevel 1 (
  python3 -m http.server 8000 2>nul
)
if errorlevel 1 (
  npx --yes serve -l 8000 .
)
