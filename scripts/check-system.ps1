$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

function Import-DotEnv {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) {
      continue
    }

    $separatorIndex = $trimmed.IndexOf('=')
    if ($separatorIndex -le 0) {
      continue
    }

    $key = $trimmed.Substring(0, $separatorIndex).Trim()
    if ($key -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
      continue
    }

    $value = $trimmed.Substring($separatorIndex + 1).Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    [System.Environment]::SetEnvironmentVariable($key, $value, 'Process')
  }
}

function Write-CheckResult {
  param(
    [string]$Status,
    [string]$Name,
    [string]$Detail
  )

  "{0,-5} {1,-28} {2}" -f $Status, $Name, $Detail
}

function Test-HttpJson {
  param(
    [string]$Url,
    [int]$TimeoutSec = 5
  )

  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
    return [pscustomobject]@{
      Ok = $true
      StatusCode = $response.StatusCode
      Content = $response.Content
    }
  } catch {
    return [pscustomobject]@{
      Ok = $false
      Error = $_.Exception.Message
    }
  }
}

Import-DotEnv -Path (Join-Path $RepoRoot '.env')

$failures = 0

$requiredCommands = @('node', 'corepack')
foreach ($command in $requiredCommands) {
  $exists = $null -ne (Get-Command $command -ErrorAction SilentlyContinue)
  if ($exists) {
    Write-CheckResult 'OK' $command 'available'
  } else {
    $failures++
    Write-CheckResult 'FAIL' $command 'not found in PATH'
  }
}

$pnpmVersion = $null
try {
  $pnpmVersion = (& corepack pnpm --version 2>$null)
} catch {
  $pnpmVersion = $null
}

if ($pnpmVersion) {
  Write-CheckResult 'OK' 'pnpm' ("available ({0})" -f $pnpmVersion.Trim())
} else {
  $failures++
  Write-CheckResult 'FAIL' 'pnpm' 'not available through corepack'
}

$dbPath = Join-Path $RepoRoot 'data\kurukuru.db'
if (Test-Path -LiteralPath $dbPath) {
  Write-CheckResult 'OK' 'SQLite DB' $dbPath
} else {
  $failures++
  Write-CheckResult 'FAIL' 'SQLite DB' "$dbPath missing"
}

$port4000 = Test-NetConnection 127.0.0.1 -Port 4000 -WarningAction SilentlyContinue
if ($port4000.TcpTestSucceeded) {
  Write-CheckResult 'OK' 'API port 4000' 'reachable'
} else {
  $failures++
  Write-CheckResult 'FAIL' 'API port 4000' 'not reachable'
}

$health = Test-HttpJson -Url 'http://127.0.0.1:4000/health'
if ($health.Ok) {
  Write-CheckResult 'OK' '/health' $health.Content
} else {
  $failures++
  Write-CheckResult 'FAIL' '/health' $health.Error
}

$deepHealth = Test-HttpJson -Url 'http://127.0.0.1:4000/health/deep'
if ($deepHealth.Ok) {
  Write-CheckResult 'OK' '/health/deep' 'reachable'
} else {
  $failures++
  Write-CheckResult 'FAIL' '/health/deep' $deepHealth.Error
}

$whepPort = Test-NetConnection 127.0.0.1 -Port 8889 -WarningAction SilentlyContinue
if ($whepPort.TcpTestSucceeded) {
  Write-CheckResult 'OK' 'MediaMTX WHEP 8889' 'reachable'
} else {
  $failures++
  Write-CheckResult 'FAIL' 'MediaMTX WHEP 8889' 'not reachable'
}

$api9997 = Test-NetConnection 127.0.0.1 -Port 9997 -WarningAction SilentlyContinue
if ($api9997.TcpTestSucceeded) {
  Write-CheckResult 'OK' 'MediaMTX API 9997' 'reachable'
} else {
  Write-CheckResult 'WARN' 'MediaMTX API 9997' 'not reachable (optional)'
}

$mpvPath = [System.Environment]::GetEnvironmentVariable('MPV_PATH', 'Process')
if (-not $mpvPath) {
  $failures++
  Write-CheckResult 'FAIL' 'MPV path' 'MPV_PATH is not set'
} elseif (Test-Path -LiteralPath $mpvPath) {
  Write-CheckResult 'OK' 'MPV path' $mpvPath
} else {
  $failures++
  Write-CheckResult 'FAIL' 'MPV path' "$mpvPath missing"
}

$rtspHosts = @()
$cameraLines = Get-Content -LiteralPath (Join-Path $RepoRoot '.env') | Select-String -Pattern '^CAMERA_.*_RTSP_URL\s*=' | ForEach-Object { $_.Line }
foreach ($line in $cameraLines) {
  $separatorIndex = $line.IndexOf('=')
  if ($separatorIndex -le 0) {
    continue
  }

  $value = $line.Substring($separatorIndex + 1).Trim()
  if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
    $value = $value.Substring(1, $value.Length - 2)
  }

  if (-not $value) {
    continue
  }

  try {
    if ($value -match '^rtsp://') {
      $uri = [System.Uri]$value
      if ($uri.Host) {
        $rtspHosts += $uri.Host
      }
    } else {
      $host = $value.Split('/')[0].Split(':')[0].Trim()
      if ($host) {
        $rtspHosts += $host
      }
    }
  } catch {
    # Ignore malformed values in deployment check output.
  }
}

$rtspHosts = $rtspHosts | Sort-Object -Unique
if (-not $rtspHosts -or $rtspHosts.Count -eq 0) {
  Write-CheckResult 'WARN' 'RTSP hosts' 'no CAMERA_*_RTSP_URL values configured'
} else {
  foreach ($host in $rtspHosts) {
    $result = Test-NetConnection $host -Port 554 -WarningAction SilentlyContinue
    if ($result.TcpTestSucceeded) {
      Write-CheckResult 'OK' ("RTSP {0}" -f $host) 'port 554 reachable'
    } else {
      Write-CheckResult 'WARN' ("RTSP {0}" -f $host) 'port 554 not reachable'
    }
  }
}

if ($failures -gt 0) {
  Write-Host ("Deployment check completed with {0} required failure(s)." -f $failures)
  exit 1
}

Write-Host 'Deployment check passed.'
exit 0
