@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul || (
  echo [Modeo] Node.js not found. Please install Node.js 20 or newer, then run this file again.
  pause
  exit /b 1
)

echo [Modeo] Starting Modeo at http://localhost:8787
node server.js
pause
