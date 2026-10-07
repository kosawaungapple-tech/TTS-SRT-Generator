#!/usr/bin/env bash
# VBS FFmpeg Worker (Mac & Linux 1-Click Runner)

echo "========================================================"
echo "       🎬 VBS FFmpeg Dedicated Local Worker Engine       "
echo "========================================================"
echo ""

echo "[1/3] Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed! Please install Node.js from https://nodejs.org or via brew/apt."
    exit 1
fi
node -v
echo "[OK] Node.js is ready."
echo ""

echo "[2/3] Checking FFmpeg..."
if ! command -v ffmpeg &> /dev/null; then
    echo "[WARNING] FFmpeg is not installed or not in PATH."
    echo "Mac (Homebrew): brew install ffmpeg"
    echo "Linux (Ubuntu/Debian): sudo apt install ffmpeg"
else
    ffmpeg -version | head -n 1
    echo "[OK] FFmpeg is ready."
fi
echo ""

echo "[3/3] Starting VBS Worker on port 5005..."
if [ ! -f "package.json" ]; then
    echo '{"name":"vbs-ffmpeg-worker","type":"commonjs"}' > package.json
fi
echo "Keep this terminal running. VlogsBySaw App will detect: ONLINE 🟢"
echo "========================================================"

node vbs-ffmpeg-worker.js
