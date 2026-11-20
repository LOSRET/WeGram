@echo off
setlocal EnableExtensions
rem ---------------------------------------------------------------------------
rem One-click launcher for the TEST data centers (Telegram's test network).
rem
rem - Sets WEGRAM_TDLIB_TEST_DC=1, so TDLib talks to the test DCs: a separate
rem   account space where send / edit / delete can never reach a real chat.
rem - Reuses the authorized test session in spikes\tdlib\test-data (the one
rem   "pnpm tdlib:test-dc" writes). If that folder has no session you sign in
rem   once inside the app, and the login needs an account created by an
rem   official app first (see CLAUDE.md, test-DC section).
rem - Never point this at spikes\tdlib\data: that is the real account.
rem - Proxy: the test DCs answer without one, but the launcher keeps the same
rem   default as start-real.cmd because this machine's route needs it; override
rem   by setting WEGRAM_PROXY first (set WEGRAM_PROXY= to go direct).
rem - Kills any running electron.exe first: the single-instance lock would
rem   otherwise silently keep the OLD bundle on screen.
rem - Builds once when out\ is missing; pass "build" to force a rebuild:
rem     start-test.cmd build
rem
rem Logs land in .cache\app.log (repo root).
rem ---------------------------------------------------------------------------

set "ROOT=%~dp0.."
set "APP=%ROOT%\apps\desktop"
set "WEGRAM_TDLIB_TEST_DC=1"
if not defined WEGRAM_PROXY set "WEGRAM_PROXY=socks5://127.0.0.1:7890"
set "SESSION_DIR=%ROOT%\spikes\tdlib\test-data"

if not exist "%APP%\out\main\index.js" set "NEED_BUILD=1"
if /i "%~1"=="build" set "NEED_BUILD=1"
if defined NEED_BUILD (
  echo [start-test] building renderer + main ...
  pushd "%APP%"
  call pnpm build
  if errorlevel 1 (
    popd
    echo [start-test] build failed - aborting.
    exit /b 1
  )
  popd
)

if not exist "%APP%\.env" (
  echo [start-test] WARNING: apps\desktop\.env is missing - TELEGRAM_API_ID / TELEGRAM_API_HASH absent.
  echo [start-test] Without credentials the app silently falls back to the mock adapter.
)

if not exist "%SESSION_DIR%\db\db_test.sqlite" (
  echo [start-test] WARNING: no authorized test session in %SESSION_DIR%
  echo [start-test] The app will ask you to sign in on the test DCs; see CLAUDE.md for the
  echo [start-test] official-app recipe, or run "pnpm tdlib:test-dc" first.
)

echo [start-test] closing any running electron.exe ...
taskkill /IM electron.exe /F >nul 2>&1
ping -n 2 127.0.0.1 >nul

set "PS=pwsh"
where pwsh >nul 2>&1 || set "PS=powershell"

echo [start-test] launching detached against the TEST DCs ^(proxy %WEGRAM_PROXY%^) ...
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%APP%\scripts\launch-detached.ps1" -NoSandbox -TestDc -Proxy "%WEGRAM_PROXY%" -SessionDir "%SESSION_DIR%"
if errorlevel 1 (
  echo [start-test] launch failed - WMI process creation refused. Run this from a normal terminal, not a sandboxed shell.
  exit /b 1
)
echo [start-test] done. Logs: %ROOT%\.cache\app.log
endlocal
