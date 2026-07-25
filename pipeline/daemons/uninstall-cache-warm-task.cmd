@echo off
REM uninstall-cache-warm-task.cmd — the reversibility half of the cache-warm installer.
REM (PLAN-DAEMON-SUBSYSTEM Phase-1 Chunk 6.) Deletes the "TheCofferCacheWarm" scheduled job.
REM Safe to run any time: removing the schedule only stops the every-4h EXTERNAL warm tick — the
REM opportunistic manager.ensure() hook still warms the archive during active scan/positions/loop use.
setlocal
set "TASK=TheCofferCacheWarm"

schtasks /delete /tn "%TASK%" /f
if errorlevel 1 (
  echo.
  echo [uninstall-cache-warm-task] Could not delete "%TASK%" ^(it may never have been installed^) — see above.
  endlocal
  exit /b 1
)

echo.
echo [uninstall-cache-warm-task] Deleted scheduled task "%TASK%". The every-4h external warm tick is gone;
echo     re-install any time with install-cache-warm-task.cmd.
endlocal
