@echo off
title VBS - phone render (keep this window open)
cd /d "%~dp0"
netstat -ano | findstr ":5006" | findstr "LISTENING" >nul && (echo VBS worker is already running. & timeout /t 3 >nul & exit /b 0)
if not exist "%~dp0worker.env.cmd" (echo Run VBS-Install-Worker.bat once first. & pause & exit /b 1)
call "%~dp0worker.env.cmd"
set PORT=5006
set "PATH=%PATH%;C:\Program Files (x86)\cloudflared;C:\Program Files\cloudflared"
where node >nul 2>nul || (echo Node.js is not installed. Install it from https://nodejs.org then start again. & pause & exit /b 1)
where cloudflared >nul 2>nul || (echo Installing cloudflared... & winget install -e --id Cloudflare.cloudflared --accept-source-agreements --accept-package-agreements)
echo Getting the latest worker...
curl -L -s -o vbs-ffmpeg-worker.js %SITE_URL%/worker/vbs-ffmpeg-worker.js
:loop
node vbs-ffmpeg-worker.js
echo Worker stopped. Restarting in 5 seconds (close this window to quit)...
timeout /t 5 >nul
goto loop
