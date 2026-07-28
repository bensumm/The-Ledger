@echo off
REM run-cache-warm.cmd — the stable, args-free Windows Task Scheduler TARGET for the cache-warm guard.
REM (PLAN-DAEMON-SUBSYSTEM Phase-1 Chunk 6.) Registered as "TheCofferCacheWarm" (every 4h) by
REM install-cache-warm-task.cmd; removed by uninstall-cache-warm-task.cmd.
REM
REM ZERO-GIT by construction: cache-warm.mjs only READS + FETCHES-INTO-THE-LOCAL-SQLITE-ARCHIVE
REM (loadAll24hRolling + loadBands) and stamps pipeline\.cache\daemon-state.json. It never imports
REM sync-fills.mjs and never touches git — provably (pipeline\ci\check-daemon-safety.mjs enforces it).
REM This is the read-only cousin of the ELIMINATED CofferFillsSync job, NOT a revival of it.
REM
REM This file lives in pipeline\daemons\ ; "%~dp0..\.." is the repo root. `cd /d` also switches drive.
REM Runs the ENSURE-THEN-WARM path (--warm): cheap check of the newest /1h bucket age; warm ONLY if
REM stale (newest /1h bucket older than WARM_THRESHOLD_HOURS = 3h — deliberately BELOW this job's 4h
REM tick so the lag stays bounded; the two numbers are coupled, so retune the threshold if you change
REM the interval here). (NOT --check-only, which reports health but warms nothing.)
REM Repairing holes ALREADY in the archive is a separate, deliberate job — this guard only keeps the
REM leading edge current: node pipeline\commands\backfill-archive.mjs --days 60
cd /d "%~dp0..\.."
node pipeline\daemons\cache-warm.mjs --warm
