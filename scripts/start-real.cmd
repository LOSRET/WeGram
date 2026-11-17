@echo off
setlocal EnableExtensions
rem ---------------------------------------------------------------------------
rem One-click launcher for the REAL Telegram environment (real TDLib adapter).
rem
rem - Reuses the real-account session in spikes\tdlib\data; if that folder is
rem   empty you log in once inside the app.
rem - The SOCKS proxy is mandatory (without it getChats hangs). Default is the
rem   local Clash mixed port; override by setting WEGRAM_PROXY first.
rem - Kills any running electron.exe first: the single-instance lock would
rem   otherwise silently keep the OLD bundle on screen.
rem - Builds once when out\ is missing; pass "build" to force a rebuild:
rem     start-real.cmd build
rem
rem Logs land in .cache\app.log (repo root).
rem ---------------------------------------------------------------------------

set "ROOT=%~dp0.."
set "APP=%ROOT%\apps\desktop"
if "%WEGRAM_PROXY%"=="" set "WEGRAM_PROXY=socks5://127.0.0.1:7890"
set "SESSION_DIR=%ROOT%\spikes\tdlib\data"

if not exist "%APP%\out\main\index.js" set "NEED_BUILD=1"
if /i "%~1"=="build" set "NEED_BUILD=1"
if defined NEED_BUILD (
  echo [start-real] building renderer + main ...
  pushd "%APP%"
  call pnpm build
  if errorlevel 1 (
    popd
    echo [start-real] build failed - aborting.
    exit /b 1
  )
  popd
)

if not exist "%APP%\.env" (
  echo [start-real] WARNING: apps\desktop\.env is missing - TELEGRAM_API_ID / TELEGRAM_API_HASH absent.
  echo [start-real] Without credentials the app silently falls back to the mock adapter.
)

echo [start-real] closing any running electron.exe ...
taskkill /IM electron.exe /F >nul 2>&1
ping -n 2 127.0.0.1 >nul

set "PS=pwsh"
where pwsh >nul 2>&1 || set "PS=powershell"

echo [start-real] launching detached ^(proxy %WEGRAM_PROXY%^) ...
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%APP%\scripts\launch-detached.ps1" -NoSandbox -Proxy "%WEGRAM_PROXY%" -SessionDir "%SESSION_DIR%"
if errorlevel 1 (
  echo [start-real] launch failed - WMI process creation refused. Run this from a normal terminal, not a sandboxed shell.
  exit /b 1
)
echo [start-real] done. Logs: %ROOT%\.cache\app.log
endlocal
