@echo off
REM install-cache-warm-task.cmd — the REVERSIBLE, one-time installer for the cache-warm Task Scheduler job.
REM (PLAN-DAEMON-SUBSYSTEM Phase-1 Chunk 6.) Run this ONCE, attended, on the desk machine (Ben's call —
REM CLAUDE.md treats registering an OS scheduled task like a destructive git op: an agent ships this file,
REM a human runs it). It registers "TheCofferCacheWarm" to run run-cache-warm.cmd every 4 hours at the
REM "limited" (non-admin) run level — no elevation needed because the job only touches gitignored LOCAL
REM files (the SQLite archive + .cache). Undo any time with uninstall-cache-warm-task.cmd.
setlocal
set "TASK=TheCofferCacheWarm"
REM %~dp0 ends with a backslash -> this is the absolute path to the wrapper next to this installer.
set "TARGET=%~dp0run-cache-warm.cmd"

schtasks /create /tn "%TASK%" /tr "%TARGET%" /sc hourly /mo 4 /rl limited /f
if errorlevel 1 (
  echo.
  echo [install-cache-warm-task] FAILED to register "%TASK%" — see the schtasks error above.
  endlocal
  exit /b 1
)

echo.
echo [install-cache-warm-task] Registered scheduled task "%TASK%":
echo     target   : "%TARGET%"
echo     schedule : every 4 hours ^(/sc hourly /mo 4^)
echo     run level: limited ^(non-admin; zero-git, local files only^)
echo.
echo     To UNDO: run uninstall-cache-warm-task.cmd   ^(schtasks /delete /tn "%TASK%" /f^)
endlocal
