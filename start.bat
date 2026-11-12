@echo off
rem Frees the ports (server, web, webhooks), then starts the API and the web app together with pnpm dev.
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\free-ports.ps1"
if errorlevel 1 (
  echo Could not free every port. Close what uses them and run start.bat again.
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies...
  call pnpm setup || exit /b 1
)
call pnpm dev
