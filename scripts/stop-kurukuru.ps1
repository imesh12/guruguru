$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$logDir = Join-Path $RepoRoot 'data\logs'
$shutdownLog = Join-Path $logDir 'portable-shutdown.log'

New-Item -ItemType Directory -Force -Path (Join-Path $RepoRoot 'data') | Out-Null
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-ShutdownLog {
  param([string]$Message)

  $line = "[{0}] {1}" -f (Get-Date).ToString('s'), $Message
  Add-Content -LiteralPath $shutdownLog -Value $line
  Write-Host $line
}

function Stop-ProcessTreeByPid {
  param([int]$Pid)

  Start-Process -FilePath 'taskkill.exe' -ArgumentList '/PID', $Pid, '/T', '/F' -WindowStyle Hidden -Wait | Out-Null
}

function Find-KurukuruProcesses {
  param([string]$RootPath)

  $normalizedRoot = $RootPath.Replace('/', '\')
  $matchFragments = @(
    'apps\api\dist\server.js',
    'apps\desktop\dist-electron\main\main.js',
    'pnpm start:api',
    'pnpm start:desktop'
  )

  Get-CimInstance Win32_Process | Where-Object {
    $commandLine = $_.CommandLine
    if (-not $commandLine) {
      return $false
    }

    $normalizedCommand = $commandLine.Replace('/', '\')
    if ($normalizedCommand -notlike "*$normalizedRoot*") {
      return $false
    }

    foreach ($fragment in $matchFragments) {
      if ($normalizedCommand -like "*$fragment*") {
        return $true
      }
    }

    return $false
  }
}

Write-ShutdownLog 'Portable shutdown beginning.'

$processes = Find-KurukuruProcesses -RootPath $RepoRoot | Sort-Object ProcessId -Unique

if (-not $processes -or $processes.Count -eq 0) {
  Write-ShutdownLog 'No matching Kurukuru Monitor API or desktop processes were found.'
  exit 0
}

foreach ($process in $processes) {
  Write-ShutdownLog ("Stopping PID {0}: {1}" -f $process.ProcessId, $process.Name)
  try {
    Stop-ProcessTreeByPid -Pid $process.ProcessId
  } catch {
    Write-ShutdownLog ("Failed to stop PID {0}: {1}" -f $process.ProcessId, $_.Exception.Message)
  }
}

Write-ShutdownLog 'Portable shutdown completed.'
