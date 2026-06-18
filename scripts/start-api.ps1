$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$logDir = Join-Path $RepoRoot 'data\logs'
$startupLog = Join-Path $logDir 'api-startup.log'
$stdoutLog = Join-Path $logDir 'api-service.stdout.log'
$stderrLog = Join-Path $logDir 'api-service.stderr.log'

New-Item -ItemType Directory -Force -Path (Join-Path $RepoRoot 'data') | Out-Null
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-StartupLog {
  param([string]$Message)

  $line = "[{0}] {1}" -f (Get-Date).ToString('s'), $Message
  Add-Content -LiteralPath $startupLog -Value $line
  Write-Host $line
}

function Format-CommandForLog {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList
  )

  $parts = @($FilePath) + $ArgumentList
  return ($parts | ForEach-Object {
      if ($_ -match '\s') {
        '"{0}"' -f $_
      } else {
        $_
      }
    }) -join ' '
}

function Invoke-NativeLoggedCommand {
  param(
    [string]$Label,
    [string]$FilePath,
    [string[]]$ArgumentList,
    [string]$WorkingDirectory = $RepoRoot,
    [hashtable]$Environment = @{}
  )

  Write-StartupLog $Label
  $commandText = Format-CommandForLog -FilePath $FilePath -ArgumentList $ArgumentList
  Write-StartupLog ("Command: {0}" -f $commandText)

  $stdoutPath = Join-Path $logDir ("native-{0}-{1}.stdout.log" -f ([System.Guid]::NewGuid().ToString('N')), [System.IO.Path]::GetRandomFileName())
  $stderrPath = Join-Path $logDir ("native-{0}-{1}.stderr.log" -f ([System.Guid]::NewGuid().ToString('N')), [System.IO.Path]::GetRandomFileName())
  $previousEnvironment = @{}
  try {
    foreach ($key in $Environment.Keys) {
      $previousEnvironment[$key] = [System.Environment]::GetEnvironmentVariable($key, 'Process')
      [System.Environment]::SetEnvironmentVariable($key, [string]$Environment[$key], 'Process')
    }

    $process = Start-Process `
      -FilePath $FilePath `
      -ArgumentList $ArgumentList `
      -WorkingDirectory $WorkingDirectory `
      -WindowStyle Hidden `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath `
      -Wait `
      -PassThru

    foreach ($path in @($stdoutPath, $stderrPath)) {
      if (Test-Path -LiteralPath $path) {
        foreach ($line in Get-Content -LiteralPath $path) {
          Add-Content -LiteralPath $startupLog -Value ("    {0}" -f $line)
        }
      }
    }

    if ($process.ExitCode -ne 0) {
      throw "{0} failed with exit code {1}." -f $Label, $process.ExitCode
    }
  } finally {
    foreach ($key in $previousEnvironment.Keys) {
      [System.Environment]::SetEnvironmentVariable($key, $previousEnvironment[$key], 'Process')
    }

    foreach ($path in @($stdoutPath, $stderrPath)) {
      if (Test-Path -LiteralPath $path) {
        Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
      }
    }
  }
}

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

function Assert-RequiredPath {
  param(
    [string]$Path,
    [string]$Label,
    [string]$FailureMessage
  )

  if (Test-Path -LiteralPath $Path) {
    return
  }

  Write-StartupLog ("Missing required {0}: {1}" -f $Label, $Path)
  throw $FailureMessage
}

function Test-ApiHealth {
  try {
    $response = Invoke-WebRequest -Uri 'http://127.0.0.1:4000/health' -UseBasicParsing -TimeoutSec 5
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

Import-DotEnv -Path (Join-Path $RepoRoot '.env')
[System.Environment]::SetEnvironmentVariable('CI', 'true', 'Process')
[System.Environment]::SetEnvironmentVariable('PNPM_HOME', (Join-Path $RepoRoot 'data\pnpm-home'), 'Process')

Write-StartupLog 'API startup script beginning.'

if (Test-ApiHealth) {
  Write-StartupLog 'API health endpoint already responded on port 4000. No new process started.'
  exit 0
}

$portListener = Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue
if ($portListener) {
  Write-StartupLog ("Port 4000 is already in use by PID {0}, but /health did not respond. Aborting startup." -f $portListener[0].OwningProcess)
  exit 1
}

$distServer = Join-Path $RepoRoot 'apps\api\dist\server.js'
$databaseFile = Join-Path $RepoRoot 'data\kurukuru.db'

Assert-RequiredPath -Path (Join-Path $RepoRoot 'node_modules') -Label 'node_modules' -FailureMessage 'node_modules is missing. Rebuild the portable package.'
Assert-RequiredPath -Path $distServer -Label 'API dist server' -FailureMessage 'API build output is missing. Rebuild the portable package.'
Assert-RequiredPath -Path (Join-Path $RepoRoot 'node_modules\@prisma\client') -Label 'Prisma client' -FailureMessage 'Prisma client is missing. Rebuild the portable package.'
Assert-RequiredPath -Path $databaseFile -Label 'SQLite database' -FailureMessage 'Portable database is missing. Rebuild the portable package.'

if (Test-Path -LiteralPath $stdoutLog) {
  Remove-Item -LiteralPath $stdoutLog -Force
}

if (Test-Path -LiteralPath $stderrLog) {
  Remove-Item -LiteralPath $stderrLog -Force
}

Write-StartupLog 'Starting production API process.'
$commandText = Format-CommandForLog -FilePath 'node' -ArgumentList @($distServer)
Write-StartupLog ("Command: {0}" -f $commandText)
$process = Start-Process `
  -FilePath 'node' `
  -ArgumentList @($distServer) `
  -WorkingDirectory $RepoRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -PassThru

Write-StartupLog ("API process launched with PID {0}." -f $process.Id)
exit 0
