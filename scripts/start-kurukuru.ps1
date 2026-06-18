$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$envPath = Join-Path $RepoRoot '.env'
$envTemplatePath = Join-Path $RepoRoot '.env.template'
$logDir = Join-Path $RepoRoot 'data\logs'
$bootstrapLog = Join-Path $logDir 'portable-bootstrap.log'

New-Item -ItemType Directory -Force -Path (Join-Path $RepoRoot 'data') | Out-Null
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-BootstrapLog {
  param([string]$Message)

  $line = "[{0}] {1}" -f (Get-Date).ToString('s'), $Message
  Add-Content -LiteralPath $bootstrapLog -Value $line
  Write-Host $line
}

function Assert-Command {
  param([string]$CommandName)

  if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $CommandName"
  }
}

function Assert-PortableRuntimeReady {
  $requiredPaths = @(
    (Join-Path $RepoRoot 'node_modules'),
    (Join-Path $RepoRoot 'apps\api\dist\server.js'),
    (Join-Path $RepoRoot 'apps\desktop\dist-electron\main\main.js'),
    (Join-Path $RepoRoot 'apps\desktop\node_modules\electron\dist\electron.exe')
  )

  $missingPaths = @($requiredPaths | Where-Object { -not (Test-Path -LiteralPath $_) })
  if ($missingPaths.Count -eq 0) {
    Write-BootstrapLog 'Portable runtime dependencies detected.'
    return
  }

  foreach ($missingPath in $missingPaths) {
    Write-BootstrapLog ("Missing runtime dependency path: {0}" -f $missingPath)
  }

  $message = 'node_modules is missing. Rebuild the portable package. Do not run interactive install on client startup.'
  Write-BootstrapLog $message
  throw $message
}

Write-BootstrapLog 'Portable startup beginning.'

Assert-Command -CommandName 'node'

if (-not (Test-Path -LiteralPath $envPath)) {
  $message = if (Test-Path -LiteralPath $envTemplatePath) {
    "Missing .env. Copy .env.template to .env, then edit the site-specific values before starting Kurukuru Monitor."
  } else {
    'Missing .env and .env.template.'
  }

  Write-BootstrapLog $message
  throw $message
}

Assert-PortableRuntimeReady

Write-BootstrapLog 'Starting API through scripts\start-api.ps1.'
& (Join-Path $PSScriptRoot 'start-api.ps1')

Write-BootstrapLog 'Starting desktop through scripts\start-desktop.ps1.'
& (Join-Path $PSScriptRoot 'start-desktop.ps1')

Write-BootstrapLog 'Portable startup completed.'
