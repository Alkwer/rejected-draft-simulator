@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 20+ and run this file again.
  echo Alternatively, run manually: npm.cmd run dev
  pause
  exit /b 1
)

echo Starting Rejected Draft Simulator...
echo Keep this window open while using the UI.
echo.

node "%~dp0src\dev-server.js" --open
set EXIT_CODE=%ERRORLEVEL%

echo.
echo Server stopped.
if not "%EXIT_CODE%"=="0" echo Error code: %EXIT_CODE%
pause
exit /b %EXIT_CODE%
