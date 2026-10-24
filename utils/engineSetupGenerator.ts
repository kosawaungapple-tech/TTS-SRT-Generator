/**
 * Generates tailored, pre-configured setup scripts (.bat for Windows, .sh for Mac/Linux)
 * with the user's current environment credentials for 1-click local FFmpeg installation.
 */

export interface SetupScriptOptions {
  appOrigin: string;
  projectId?: string;
  adminCode?: string;
  port?: number;
  telegramBotToken?: string;
  telegramChatId?: string;
}

export function generateWindowsBatScript(opts: SetupScriptOptions): string {
  const origin = opts.appOrigin || 'http://localhost:3000';
  const proj = opts.projectId || 'ai-studio-remix';
  const port = opts.port || 5005;
  const adminCode = opts.adminCode || 'saw_vlogs_2026';

  return `@echo off
setlocal enabledelayedexpansion
title VBS FFmpeg Engine - Automated Setup & Launcher
color 0A
cd /d "%~dp0"
cls
echo ======================================================================
echo        🎬 VBS FFmpeg Dedicated Local Worker Engine
echo            Automated Setup ^& Self-Configured Launcher
echo ======================================================================
echo [Target App URL] : ${origin}
echo [Project ID]     : ${proj}
echo [Target Port]    : ${port}
echo ======================================================================
echo.

:: 1. Check & Install Node.js
echo [1/3] Checking Node.js installation...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Node.js not detected on this system.
    echo [*] Attempting automated installation via Windows Package Manager (winget)...
    winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    if %errorlevel% neq 0 (
        echo.
        echo [ERROR] Automated Node.js installation could not complete.
        echo [သတိပေးချက်] Node.js မရှိသေးပါသဖြင့် https://nodejs.org မှ LTS version ကို ဒေါင်းလုဒ်ဆွဲပြီး အရင် Install လုပ်ပေးပါ။
        echo Then run this setup file again.
        echo.
        pause
        exit /b 1
    )
    echo [OK] Node.js installed successfully!
) else (
    for /f "tokens=*" %%v in ('node -v') do echo [OK] Node.js is ready: %%v
)

:: 2. Check & Install FFmpeg
echo.
echo [2/3] Checking FFmpeg installation...
where ffmpeg >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] FFmpeg not detected in Windows PATH.
    echo [*] Attempting automated FFmpeg installation via winget...
    winget install Gyan.FFmpeg --accept-source-agreements --accept-package-agreements >nul 2>&1
    where ffmpeg >nul 2>&1
    if !errorlevel! equ 0 (
        echo [OK] FFmpeg installed successfully via winget!
    ) else (
        echo [WARNING] winget could not automatically install FFmpeg.
        echo If you have FFmpeg downloaded, please add its bin folder to your Windows PATH.
        echo You can also download it from: https://www.gyan.dev/ffmpeg/builds/
    )
) else (
    for /f "tokens=*" %%f in ('ffmpeg -version ^| findstr /i "ffmpeg version"') do echo [OK] %%f
)

:: 3. Configure Local Package & Worker Script
echo.
echo [3/3] Configuring Worker Environment for ${origin}...
if not exist "package.json" (
    (
        echo {
        echo   "name": "vbs-ffmpeg-worker",
        echo   "version": "1.0.0",
        echo   "type": "commonjs",
        echo   "description": "VBS FFmpeg Worker Engine"
        echo }
    ) > package.json
)

:: Download latest configured standalone worker
echo [*] Downloading latest VBS Worker Script...
if not exist "vbs-ffmpeg-worker.js" (
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object System.Net.WebClient).DownloadFile('${origin}/worker/vbs-ffmpeg-worker.js', 'vbs-ffmpeg-worker.js')" >nul 2>&1
    if not exist "vbs-ffmpeg-worker.js" (
        echo [!] Direct download had a connection delay. Trying curl...
        curl -s -O "${origin}/worker/vbs-ffmpeg-worker.js" >nul 2>&1
    )
)

echo.
echo ======================================================================
echo   🎉 SETUP COMPLETE! Launching VBS FFmpeg Worker on port ${port}...
echo   Keep this terminal OPEN while using VlogsBySaw!
echo   VlogsBySaw will detect: 🟢 Local PC Engine: ONLINE
echo ======================================================================
echo.

set PORT=${port}
set VBS_APP_ORIGIN=${origin}
set VBS_ADMIN_CODE=${adminCode}
set VBS_PROJECT_ID=${proj}

if not exist "vbs-ffmpeg-worker.js" (
    echo [ERROR] Could not find or download vbs-ffmpeg-worker.js!
    echo Please make sure this file is placed in a folder with internet access.
    pause
    exit /b 1
)

node vbs-ffmpeg-worker.js

echo.
echo [Worker process stopped]
pause
`;
}

export function generateMacLinuxShScript(opts: SetupScriptOptions): string {
  const origin = opts.appOrigin || 'http://localhost:3000';
  const proj = opts.projectId || 'ai-studio-remix';
  const port = opts.port || 5005;
  const adminCode = opts.adminCode || 'saw_vlogs_2026';

  return `#!/usr/bin/env bash
# VBS FFmpeg Engine - Automated Setup & Launcher
# Specifically configured for ${origin}

set -e

echo "======================================================================"
echo "       🎬 VBS FFmpeg Dedicated Local Worker Engine"
echo "           Automated Setup & Self-Configured Launcher"
echo "======================================================================"
echo "[Target App URL] : ${origin}"
echo "[Project ID]     : ${proj}"
echo "[Target Port]    : ${port}"
echo "======================================================================"
echo ""

# 1. Check Node.js
echo "[1/3] Checking Node.js installation..."
if ! command -v node &> /dev/null; then
    echo "[!] Node.js not detected. Attempting automated installation..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        if command -v brew &> /dev/null; then
            echo "[*] Installing Node.js via Homebrew..."
            brew install node
        else
            echo "[ERROR] Homebrew not installed. Please install Node.js from https://nodejs.org"
            exit 1
        fi
    elif [ -f /etc/debian_version ]; then
        echo "[*] Installing Node.js via apt..."
        curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
        sudo apt-get install -y nodejs
    else
        echo "[ERROR] Please install Node.js from https://nodejs.org"
        exit 1
    fi
fi
echo "[OK] Node.js is ready: $(node -v)"
echo ""

# 2. Check FFmpeg
echo "[2/3] Checking FFmpeg installation..."
if ! command -v ffmpeg &> /dev/null; then
    echo "[!] FFmpeg not detected. Attempting automated installation..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        if command -v brew &> /dev/null; then
            echo "[*] Installing FFmpeg via Homebrew..."
            brew install ffmpeg
        else
            echo "[WARNING] Homebrew not found. Please install FFmpeg: brew install ffmpeg"
        fi
    elif [ -f /etc/debian_version ]; then
        echo "[*] Installing FFmpeg via apt..."
        sudo apt-get update && sudo apt-get install -y ffmpeg
    else
        echo "[WARNING] Please install FFmpeg via your package manager."
    fi
fi
if command -v ffmpeg &> /dev/null; then
    echo "[OK] FFmpeg is ready: $(ffmpeg -version | head -n 1)"
fi
echo ""

# 3. Configure package.json and download worker
echo "[3/3] Configuring Worker Environment for ${origin}..."
if [ ! -f "package.json" ]; then
    cat << 'EOF' > package.json
{
  "name": "vbs-ffmpeg-worker",
  "version": "1.0.0",
  "type": "commonjs",
  "description": "VBS FFmpeg Worker Engine"
}
EOF
fi

echo "[*] Fetching latest VBS Worker Script..."
curl -s -O "${origin}/worker/vbs-ffmpeg-worker.js" || wget -q "${origin}/worker/vbs-ffmpeg-worker.js"

echo ""
echo "======================================================================"
echo "  🎉 SETUP COMPLETE! Launching VBS FFmpeg Worker on port ${port}..."
echo "  Keep this terminal OPEN while using VlogsBySaw!"
echo "  VlogsBySaw will detect: 🟢 Local PC Engine: ONLINE"
echo "======================================================================"
echo ""

export PORT="${port}"
export VBS_APP_ORIGIN="${origin}"
export VBS_ADMIN_CODE="${adminCode}"
export VBS_PROJECT_ID="${proj}"

node vbs-ffmpeg-worker.js
`;
}

export function downloadSetupScript(
  type: 'windows' | 'mac' | 'linux',
  options: SetupScriptOptions
): void {
  const isWindows = type === 'windows';
  const content = isWindows
    ? generateWindowsBatScript(options)
    : generateMacLinuxShScript(options);

  const filename = isWindows ? 'setup-vbs-engine.bat' : 'setup-vbs-engine.sh';
  const mimeType = isWindows ? 'application/x-bat' : 'application/x-sh';

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
