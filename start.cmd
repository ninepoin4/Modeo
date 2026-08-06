@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul || (
  echo [Modeo] Node.js not found. Please install Node.js 20 or newer, then run this file again.
  pause
  exit /b 1
)

if not exist "desktop\node_modules" (
  echo [Modeo] First run: installing desktop dependencies...
  pushd desktop
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [Modeo] Dependency install failed.
    popd
    pause
    exit /b 1
  )
  popd
)

echo [Modeo] Starting Modeo desktop client...
pushd desktop
call npm start
popd
