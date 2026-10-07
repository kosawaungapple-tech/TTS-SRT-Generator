@echo off
setlocal enabledelayedexpansion
title VBS FFmpeg Worker (Dedicated Video Engine)
color 0A
cd /d "%~dp0"
cls

echo ======================================================================
echo        🎬 VBS FFmpeg Dedicated Local Worker Engine
echo            Automated Setup & Launcher for Windows
echo ======================================================================
echo.

:: 1. Check Node.js
echo [1/3] Checking Node.js installation...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Node.js is NOT installed on this PC!
    echo [သတိပေးချက်] Node.js မရှိသေးပါသဖြင့် Setup ကို ဆက်လက်လုပ်ဆောင်၍ မရပါ။
    echo.
    echo 1. Please download and install Node.js (LTS version) from:
    echo    👉 https://nodejs.org
    echo 2. After installing Node.js, run this file again!
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do echo [OK] Node.js is ready: %%v
echo.

:: 2. Check FFmpeg
echo [2/3] Checking FFmpeg installation...
where ffmpeg >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [NOTICE] FFmpeg is not found in your Windows PATH!
    echo [သတိပေးချက်] FFmpeg ကို Windows PATH ထဲ မတွေ့ရှိရသေးပါ။
    echo.
    echo [*] Attempting automated installation via winget...
    winget install Gyan.FFmpeg --accept-source-agreements --accept-package-agreements >nul 2>&1
    where ffmpeg >nul 2>&1
    if !errorlevel! equ 0 (
        echo [OK] FFmpeg was successfully installed via winget!
    ) else (
        echo [MANUAL SETUP GUIDE / ကိုယ်တိုင်ထည့်သွင်းရန် လမ်းညွှန်]
        echo 1. Download FFmpeg from: https://www.gyan.dev/ffmpeg/builds/
        echo 2. Extract the zip file to: C:\ffmpeg
        echo 3. Add C:\ffmpeg\bin to Windows System Environment Variables (PATH).
        echo.
    )
) else (
    for /f "tokens=*" %%f in ('ffmpeg -version ^| findstr /i "ffmpeg version"') do echo [OK] %%f
)
echo.

:: 3. Check / Download Worker Script
echo [3/3] Checking Worker Script (vbs-ffmpeg-worker.js)...
if not exist "vbs-ffmpeg-worker.js" (
    echo [*] Downloading latest vbs-ffmpeg-worker.js...
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object System.Net.WebClient).DownloadFile('http://localhost:3000/worker/vbs-ffmpeg-worker.js', 'vbs-ffmpeg-worker.js')" >nul 2>&1
    if not exist "vbs-ffmpeg-worker.js" (
        curl -s -O "http://localhost:3000/worker/vbs-ffmpeg-worker.js" >nul 2>&1
    )
)

if not exist "package.json" (
    (
        echo {
        echo   "name": "vbs-ffmpeg-worker",
        echo   "version": "1.0.0",
        echo   "type": "commonjs"
        echo }
    ) > package.json
)

echo.
echo ======================================================================
echo   🎉 VBS FFmpeg Worker Engine is READY!
echo   Launching on Port 5005...
echo   ⚠️ Keep this terminal window OPEN while using VlogsBySaw!
echo   VlogsBySaw will automatically show: 🟢 Local PC Engine: ONLINE
echo ======================================================================
echo.

if not exist "vbs-ffmpeg-worker.js" (
    echo [ERROR] Could not find or download vbs-ffmpeg-worker.js!
    echo Please make sure vbs-ffmpeg-worker.js is in the same folder as this .bat file.
    pause
    exit /b 1
)

node vbs-ffmpeg-worker.js

echo.
echo [Worker process stopped]
pause

