$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$logDir = Join-Path $RepoRoot 'data\logs'
$startupLog = Join-Path $logDir 'desktop-startup.log'
$stdoutLog = Join-Path $logDir 'desktop-service.stdout.log'
$stderrLog = Join-Path $logDir 'desktop-service.stderr.log'

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

function Assert-RequiredPath {
  param(
    [string]$Path,
    [string]$Label
  )

  if (Test-Path -LiteralPath $Path) {
    return
  }

  Write-StartupLog ("Missing required {0}: {1}" -f $Label, $Path)
  throw 'node_modules is missing. Rebuild the portable package.'
}

function Test-ApiHealth {
  try {
    $response = Invoke-WebRequest -Uri 'http://127.0.0.1:4000/health' -UseBasicParsing -TimeoutSec 5
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

Write-StartupLog 'Desktop startup script beginning.'

$electronBinary = Join-Path $RepoRoot 'apps\desktop\node_modules\electron\dist\electron.exe'
$desktopMain = Join-Path $RepoRoot 'apps\desktop\dist-electron\main\main.js'

Assert-RequiredPath -Path (Join-Path $RepoRoot 'node_modules') -Label 'node_modules'
Assert-RequiredPath -Path $electronBinary -Label 'Electron binary'
Assert-RequiredPath -Path $desktopMain -Label 'desktop main entry'

$maxAttempts = 20
for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
  if (Test-ApiHealth) {
    Write-StartupLog ("API health check passed on attempt {0}." -f $attempt)
    break
  }

  Write-StartupLog ("API health check failed on attempt {0}/{1}. Retrying in 3 seconds." -f $attempt, $maxAttempts)
  Start-Sleep -Seconds 3

  if ($attempt -eq $maxAttempts) {
    Write-StartupLog 'API did not become healthy. Desktop launch aborted.'
    exit 1
  }
}

if (Test-Path -LiteralPath $stdoutLog) {
  Remove-Item -LiteralPath $stdoutLog -Force
}

if (Test-Path -LiteralPath $stderrLog) {
  Remove-Item -LiteralPath $stderrLog -Force
}

Write-StartupLog 'Starting desktop process.'
$commandText = Format-CommandForLog -FilePath $electronBinary -ArgumentList @($desktopMain)
Write-StartupLog ("Command: {0}" -f $commandText)
$process = Start-Process `
  -FilePath $electronBinary `
  -ArgumentList @($desktopMain) `
  -WorkingDirectory $RepoRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -PassThru

Write-StartupLog ("Desktop process launched with PID {0}." -f $process.Id)
exit 0
