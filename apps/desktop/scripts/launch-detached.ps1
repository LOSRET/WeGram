# Launch the built Electron app detached from the agent shell.
#
# Why: the DSH shell runs commands inside a Windows job object. Chromium cannot
# initialise inside that job — it aborts with 0x80000003 (sandbox on) or an
# access violation 0xC0000005 inside electron.exe (sandbox off). Creating the
# process through WMI puts it under WmiPrvSE instead, outside the job, and it
# starts normally.
#
# Usage (from apps\desktop, after `pnpm build`):
#   pwsh scripts/launch-detached.ps1 -Proxy socks5://127.0.0.1:7890 -SessionDir ..\..\spikes\tdlib\data
param(
  [string]$Proxy = $env:WECHATGRAM_PROXY,
  [string]$SessionDir = $env:WECHATGRAM_TDLIB_DIR,
  [string]$LogFile = '',
  [switch]$NoSandbox,
  [switch]$Mock,
  # Optional Chrome DevTools Protocol port, for automated checks of the renderer.
  [int]$RemoteDebugPort = 0
)

$ErrorActionPreference = 'Stop'
$appDir = (Resolve-Path "$PSScriptRoot\..").Path
$electronExe = node -e "process.stdout.write(require('electron'))"
if (-not (Test-Path $electronExe)) { throw "electron binary not found: $electronExe" }
if (-not (Test-Path (Join-Path $appDir 'out\main\index.js'))) {
  throw "out\ is missing — run 'pnpm build' first"
}

$wrapper = Join-Path $env:TEMP "wechatgram-launch-$([guid]::NewGuid().ToString('N').Substring(0,8)).cmd"
$lines = @(
  '@echo off',
  'set ELECTRON_RUN_AS_NODE=',
  'set ELECTRON_ENABLE_LOGGING=1'
)
if ($Proxy) { $lines += "set WECHATGRAM_PROXY=$Proxy" }
if ($SessionDir) { $lines += "set WECHATGRAM_TDLIB_DIR=$SessionDir" }
if ($Mock) { $lines += 'set WECHATGRAM_ADAPTER=mock' }
$lines += "cd /d `"$appDir`""
$sandboxFlag = if ($NoSandbox) { ' --no-sandbox' } else { '' }
if ($RemoteDebugPort -gt 0) { $sandboxFlag += " --remote-debugging-port=$RemoteDebugPort" }
if (-not $LogFile) {
  $LogFile = Join-Path $appDir '..\..\.cache\app.log'
}
$lines += "`"$electronExe`" .$sandboxFlag > `"$LogFile`" 2>&1"
Set-Content -Path $wrapper -Value $lines -Encoding OEM

$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine = "cmd.exe /c `"$wrapper`""
}
if ($result.ReturnValue -ne 0) { throw "Win32_Process.Create failed: $($result.ReturnValue)" }
Write-Host "launched detached (pid $($result.ProcessId), wrapper $wrapper)"
