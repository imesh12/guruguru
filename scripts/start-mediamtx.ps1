param(
  [string]$BinaryPath = "",
  [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $repoRoot "mediamtx\mediamtx.yml"

if (-not (Test-Path -LiteralPath $configPath)) {
  throw "MediaMTX config not found: $configPath"
}

$candidates = @()

if ($BinaryPath) {
  $candidates += $BinaryPath
}

if ($env:MEDIAMTX_BIN) {
  $candidates += $env:MEDIAMTX_BIN
}

$candidates += @(
  (Join-Path $repoRoot "mediamtx\mediamtx.exe"),
  (Join-Path $repoRoot "tools\mediamtx\mediamtx.exe")
)

try {
  $command = Get-Command mediamtx.exe -ErrorAction Stop
  $candidates += $command.Source
} catch {
  try {
    $command = Get-Command mediamtx -ErrorAction Stop
    $candidates += $command.Source
  } catch {
  }
}

$resolvedBinary = $null
foreach ($candidate in $candidates | Where-Object { $_ } | Select-Object -Unique) {
  if (Test-Path -LiteralPath $candidate) {
    $resolvedBinary = (Resolve-Path -LiteralPath $candidate).Path
    break
  }
}

if (-not $resolvedBinary) {
  throw @"
Unable to locate mediamtx.exe.

Looked in:
- MEDIAMTX_BIN environment variable
- script -BinaryPath argument
- $repoRoot\mediamtx\mediamtx.exe
- $repoRoot\tools\mediamtx\mediamtx.exe
- PATH
"@
}

Write-Host "MediaMTX binary: $resolvedBinary"
Write-Host "MediaMTX config:  $configPath"

if ($CheckOnly) {
  exit 0
}

& $resolvedBinary $configPath
