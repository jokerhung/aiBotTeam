@echo off
rem Frees the ports first, then starts BotTeam:
rem   start.bat           API + web app together (pnpm dev)
rem   start.bat server    the API server only (pnpm dev:server), with reload
rem   start.bat web       the web app only (pnpm dev:web)
rem   start.bat one       the built web app and the API as one program (botteam serve); run `pnpm build:static` once first
setlocal
cd /d "%~dp0"
set MODE=%~1
if "%MODE%"=="" set MODE=all
set ONLY=all
if /i "%MODE%"=="server" set ONLY=server
if /i "%MODE%"=="one" set ONLY=server
if /i "%MODE%"=="web" set ONLY=web
if /i not "%MODE%"=="all" if /i not "%MODE%"=="server" if /i not "%MODE%"=="web" if /i not "%MODE%"=="one" (
  echo Usage: start.bat [server^|web^|one]   ^(no argument: API and web app together^)
  exit /b 2
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\free-ports.ps1" -Only %ONLY%
if errorlevel 1 (
  echo Could not free every port. Close what uses them and run start.bat again.
  exit /b 1
)
rem pnpm installed with npm lives in %APPDATA%
pm, which a terminal opened before the install does not have on its PATH yet
where pnpm >nul 2>&1
if errorlevel 1 if exist "%APPDATA%
pm\pnpm.cmd" set "PATH=%APPDATA%
pm;%PATH%"
where pnpm >nul 2>&1
if errorlevel 1 (
  echo pnpm was not found. Run install.ps1 first, or open a new terminal window if it was just installed.
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies...
  call pnpm run setup || exit /b 1
)
if /i "%MODE%"=="server" call pnpm dev:server & goto :eof
if /i "%MODE%"=="web" call pnpm dev:web & goto :eof
if /i "%MODE%"=="one" call pnpm start:one & goto :eof
call pnpm dev
