param(
  [switch]$SkipTypecheck,
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$PortableBaseDir = Join-Path $RepoRoot 'dist-portable'
$PortableFolderName = 'kurukuru-monitor-windows-portable'
$PortableRoot = Join-Path $PortableBaseDir $PortableFolderName
$PortableScriptsDir = Join-Path $PortableRoot 'scripts'
$PortableDataDir = Join-Path $PortableRoot 'data'
$PortableLogsDir = Join-Path $PortableDataDir 'logs'
$PortableDiagnosticsDir = Join-Path $PortableDataDir 'diagnostics'
$PortableUserDataDir = Join-Path $PortableDataDir 'electron-user-data'
$PortableCacheDir = Join-Path $PortableDataDir 'electron-cache'

function Assert-PathExists {
  param(
    [string]$Path,
    [string]$Label
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Missing required $Label at $Path"
  }
}

function Invoke-LoggedCommand {
  param(
    [string]$Label,
    [scriptblock]$Command
  )

  Write-Host ("==> {0}" -f $Label)
  & $Command
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

function Invoke-NativePortableCommand {
  param(
    [string]$Label,
    [string]$FilePath,
    [string[]]$ArgumentList,
    [string]$WorkingDirectory,
    [hashtable]$Environment = @{}
  )

  Write-Host ("==> {0}" -f $Label)
  Write-Host ("    {0}" -f (Format-CommandForLog -FilePath $FilePath -ArgumentList $ArgumentList))

  $stdoutPath = Join-Path $PortableLogsDir ("build-{0}.stdout.log" -f ([System.Guid]::NewGuid().ToString('N')))
  $stderrPath = Join-Path $PortableLogsDir ("build-{0}.stderr.log" -f ([System.Guid]::NewGuid().ToString('N')))
  $previousEnvironment = @{}
  foreach ($key in $Environment.Keys) {
    $previousEnvironment[$key] = [System.Environment]::GetEnvironmentVariable($key, 'Process')
    [System.Environment]::SetEnvironmentVariable($key, [string]$Environment[$key], 'Process')
  }

  try {
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
          Write-Host ("    {0}" -f $line)
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

function Copy-PortableItem {
  param(
    [string]$SourcePath,
    [string]$DestinationPath
  )

  $parent = Split-Path -Parent $DestinationPath
  if ($parent) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }

  if (Test-Path -LiteralPath $SourcePath -PathType Container) {
    New-Item -ItemType Directory -Force -Path $DestinationPath | Out-Null

    $robocopyArgs = @(
      $SourcePath,
      $DestinationPath,
      '/E',
      '/R:1',
      '/W:1',
      '/NFL',
      '/NDL',
      '/NJH',
      '/NJS',
      '/NP'
    )

    & robocopy @robocopyArgs | Out-Null
    $exitCode = $LASTEXITCODE
    if ($exitCode -ge 8) {
      throw "robocopy failed while copying directory $SourcePath to $DestinationPath (exit code $exitCode)."
    }
  } else {
    Copy-Item -LiteralPath $SourcePath -Destination $DestinationPath -Force
  }
}

function Remove-PortableDirectory {
  param([string]$TargetPath)

  if (-not (Test-Path -LiteralPath $TargetPath)) {
    return
  }

  try {
    Remove-Item -LiteralPath $TargetPath -Recurse -Force -ErrorAction Stop
    return
  } catch {
    & cmd.exe /c "rmdir /s /q `"$TargetPath`"" | Out-Null
  }

  if (Test-Path -LiteralPath $TargetPath) {
    throw "Failed to remove existing portable directory: $TargetPath"
  }
}

function Get-PortableBuildRoot {
  param(
    [string]$BaseDirectory,
    [string]$PreferredName
  )

  $preferredPath = Join-Path $BaseDirectory $PreferredName
  if (-not (Test-Path -LiteralPath $preferredPath)) {
    return $preferredPath
  }

  try {
    Remove-PortableDirectory -TargetPath $preferredPath
    return $preferredPath
  } catch {
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $fallbackName = '{0}-{1}' -f $PreferredName, $timestamp
    return (Join-Path $BaseDirectory $fallbackName)
  }
}

function New-DeploymentReadme {
  param(
    [string]$DestinationPath,
    [bool]$MediaMtxIncluded
  )

  $mediaMtxNote = if ($MediaMtxIncluded) {
@'
- MediaMTX files are included under `mediamtx\`.
- Confirm `mediamtx\mediamtx.exe` exists before first use.
'@
  } else {
@'
- MediaMTX executable was not included in this package build.
- Install or copy `mediamtx.exe` into `mediamtx\` before first use.
'@
  }

  $content = @"
Kurukuru Monitor - Windows Portable Package
===========================================

1. Extract or copy this whole folder to a fixed local path such as:
   C:\KurukuruMonitor

2. Create your live environment file:
   - Copy .env.template to .env
   - Edit .env with the site-specific settings
   - Do NOT leave production tokens or passwords inside .env.template

3. Required manual setup on the client PC:
   - Install Node.js 22 or newer
   - Confirm corepack is available
   - Install mpv separately
   - Set MPV_PATH inside .env
   $mediaMtxNote

4. First startup:
   - Open PowerShell
   - Run:
     powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-kurukuru.ps1

5. What start-kurukuru.ps1 does:
   - validates .env exists
   - validates packaged runtime dependencies already exist
   - starts the API
   - starts the desktop after API health is available

6. Stop the system:
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-kurukuru.ps1

7. Auto-start at user logon:
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-windows-tasks.ps1

8. Remove auto-start tasks:
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\uninstall-windows-tasks.ps1

9. Important data path:
   - SQLite database: data\kurukuru.db
   - Logs: data\logs
   - Diagnostics: data\diagnostics

10. Backup instructions:
   - Stop Kurukuru Monitor first
   - Back up at least:
     - .env
     - data\kurukuru.db
     - data\logs
   - The minimum critical backup file is:
     data\kurukuru.db

11. SE220 configuration:
   - Edit .env and set the correct SE220 direct polling or receiver values
   - Confirm router reachability before field use

12. Validation:
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-system.ps1

"@

  Set-Content -LiteralPath $DestinationPath -Value $content -Encoding UTF8
}

function Assert-PortableRendererAssetPaths {
  param([string]$IndexHtmlPath)

  Assert-PathExists -Path $IndexHtmlPath -Label 'renderer index.html'
  $content = Get-Content -LiteralPath $IndexHtmlPath -Raw

  if ($content -match 'src="/assets' -or $content -match 'href="/assets') {
    throw "Renderer index.html contains absolute /assets paths: $IndexHtmlPath"
  }

  if ($content -notmatch '\./assets') {
    throw "Renderer index.html does not contain ./assets paths: $IndexHtmlPath"
  }
}

Assert-PathExists -Path (Join-Path $RepoRoot '.env.example') -Label '.env.example'
Assert-PathExists -Path (Join-Path $RepoRoot 'package.json') -Label 'root package.json'
Assert-PathExists -Path (Join-Path $RepoRoot 'pnpm-lock.yaml') -Label 'pnpm-lock.yaml'
Assert-PathExists -Path (Join-Path $RepoRoot 'pnpm-workspace.yaml') -Label 'pnpm-workspace.yaml'
Assert-PathExists -Path (Join-Path $RepoRoot 'apps\api\package.json') -Label 'API package.json'
Assert-PathExists -Path (Join-Path $RepoRoot 'apps\desktop\package.json') -Label 'desktop package.json'
Assert-PathExists -Path (Join-Path $RepoRoot 'apps\desktop\node_modules\electron\dist\electron.exe') -Label 'desktop Electron runtime'
Assert-PathExists -Path (Join-Path $RepoRoot 'prisma\dev.db') -Label 'SQLite template database'
Assert-PathExists -Path (Join-Path $RepoRoot 'prisma\schema.prisma') -Label 'Prisma schema'
Assert-PathExists -Path (Join-Path $RepoRoot 'scripts\start-api.ps1') -Label 'start-api script'
Assert-PathExists -Path (Join-Path $RepoRoot 'scripts\start-desktop.ps1') -Label 'start-desktop script'
Assert-PathExists -Path (Join-Path $RepoRoot 'scripts\install-windows-tasks.ps1') -Label 'install-windows-tasks script'
Assert-PathExists -Path (Join-Path $RepoRoot 'scripts\uninstall-windows-tasks.ps1') -Label 'uninstall-windows-tasks script'

if (-not $SkipTypecheck) {
  Invoke-LoggedCommand -Label 'Desktop typecheck' -Command { corepack pnpm --filter @kurukuru-monitor/desktop typecheck }
  Invoke-LoggedCommand -Label 'API typecheck' -Command { corepack pnpm --filter @kurukuru-monitor/api typecheck }
}

if (-not $SkipBuild) {
  Invoke-LoggedCommand -Label 'Workspace build' -Command { corepack pnpm build }
}

Assert-PathExists -Path (Join-Path $RepoRoot 'apps\api\dist\server.js') -Label 'built API server'
Assert-PathExists -Path (Join-Path $RepoRoot 'apps\desktop\dist-electron\main\main.js') -Label 'built desktop main'
Assert-PathExists -Path (Join-Path $RepoRoot 'apps\desktop\out\renderer\index.html') -Label 'built desktop renderer'
Assert-PortableRendererAssetPaths -IndexHtmlPath (Join-Path $RepoRoot 'apps\desktop\out\renderer\index.html')

$PortableRoot = Get-PortableBuildRoot -BaseDirectory $PortableBaseDir -PreferredName $PortableFolderName
$PortableScriptsDir = Join-Path $PortableRoot 'scripts'
$PortableDataDir = Join-Path $PortableRoot 'data'
$PortableLogsDir = Join-Path $PortableDataDir 'logs'
$PortableDiagnosticsDir = Join-Path $PortableDataDir 'diagnostics'
$PortableUserDataDir = Join-Path $PortableDataDir 'electron-user-data'
$PortableCacheDir = Join-Path $PortableDataDir 'electron-cache'

New-Item -ItemType Directory -Force -Path $PortableRoot | Out-Null
New-Item -ItemType Directory -Force -Path $PortableScriptsDir | Out-Null
New-Item -ItemType Directory -Force -Path $PortableLogsDir | Out-Null
New-Item -ItemType Directory -Force -Path $PortableDiagnosticsDir | Out-Null
New-Item -ItemType Directory -Force -Path $PortableUserDataDir | Out-Null
New-Item -ItemType Directory -Force -Path $PortableCacheDir | Out-Null

$itemsToCopy = @(
  @{ Source = 'package.json'; Destination = 'package.json' },
  @{ Source = 'pnpm-lock.yaml'; Destination = 'pnpm-lock.yaml' },
  @{ Source = 'pnpm-workspace.yaml'; Destination = 'pnpm-workspace.yaml' },
  @{ Source = 'prisma.config.ts'; Destination = 'prisma.config.ts' },
  @{ Source = '.npmrc'; Destination = '.npmrc' },
  @{ Source = 'apps\api\package.json'; Destination = 'apps\api\package.json' },
  @{ Source = 'apps\api\dist'; Destination = 'apps\api\dist' },
  @{ Source = 'apps\desktop\package.json'; Destination = 'apps\desktop\package.json' },
  @{ Source = 'apps\desktop\out\renderer'; Destination = 'apps\desktop\out\renderer' },
  @{ Source = 'apps\desktop\dist-electron'; Destination = 'apps\desktop\dist-electron' },
  @{ Source = 'apps\desktop\resources'; Destination = 'apps\desktop\resources' },
  @{ Source = 'prisma'; Destination = 'prisma' },
  @{ Source = 'scripts\check-system.ps1'; Destination = 'scripts\check-system.ps1' },
  @{ Source = 'scripts\start-api.ps1'; Destination = 'scripts\start-api.ps1' },
  @{ Source = 'scripts\start-desktop.ps1'; Destination = 'scripts\start-desktop.ps1' },
  @{ Source = 'scripts\start-mediamtx.ps1'; Destination = 'scripts\start-mediamtx.ps1' },
  @{ Source = 'scripts\install-windows-tasks.ps1'; Destination = 'scripts\install-windows-tasks.ps1' },
  @{ Source = 'scripts\uninstall-windows-tasks.ps1'; Destination = 'scripts\uninstall-windows-tasks.ps1' },
  @{ Source = 'scripts\start-kurukuru.ps1'; Destination = 'scripts\start-kurukuru.ps1' },
  @{ Source = 'scripts\stop-kurukuru.ps1'; Destination = 'scripts\stop-kurukuru.ps1' },
  @{ Source = 'scripts\launcher\KurukuruLauncher.ps1'; Destination = 'scripts\launcher\KurukuruLauncher.ps1' }
)

foreach ($item in $itemsToCopy) {
  $sourcePath = Join-Path $RepoRoot $item.Source
  if (Test-Path -LiteralPath $sourcePath) {
    Copy-PortableItem -SourcePath $sourcePath -DestinationPath (Join-Path $PortableRoot $item.Destination)
  }
}

$mediaMtxIncluded = $false
$mediaMtxRoot = Join-Path $RepoRoot 'mediamtx'
if (Test-Path -LiteralPath $mediaMtxRoot) {
  Copy-PortableItem -SourcePath $mediaMtxRoot -DestinationPath (Join-Path $PortableRoot 'mediamtx')
  $mediaMtxIncluded = Test-Path -LiteralPath (Join-Path $mediaMtxRoot 'mediamtx.exe')
}

Copy-Item -LiteralPath (Join-Path $RepoRoot '.env.example') -Destination (Join-Path $PortableRoot '.env.template') -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot 'prisma\dev.db') -Destination (Join-Path $PortableRoot 'data\kurukuru.db') -Force

$portableEnv = @{
  CI = 'true'
  PNPM_HOME = (Join-Path $PortableRoot 'data\pnpm-home')
}

Invoke-NativePortableCommand `
  -Label 'Installing portable workspace dependencies.' `
  -FilePath 'corepack' `
  -ArgumentList @('pnpm', 'install', '--prefer-offline', '--frozen-lockfile', '--config.confirmModulesPurge=false') `
  -WorkingDirectory $PortableRoot `
  -Environment $portableEnv

$portablePrismaCli = Join-Path $PortableRoot 'node_modules\prisma\build\index.js'
Assert-PathExists -Path $portablePrismaCli -Label 'portable Prisma CLI entry'

Invoke-NativePortableCommand `
  -Label 'Generating portable Prisma client.' `
  -FilePath 'node' `
  -ArgumentList @($portablePrismaCli, 'generate', '--schema', (Join-Path $PortableRoot 'prisma\schema.prisma')) `
  -WorkingDirectory $PortableRoot `
  -Environment $portableEnv

$launcherExeSource = Join-Path $RepoRoot 'dist-portable\KurukuruMonitor.exe'
if (Test-Path -LiteralPath $launcherExeSource) {
  Copy-Item -LiteralPath $launcherExeSource -Destination (Join-Path $PortableRoot 'KurukuruMonitor.exe') -Force
}

New-DeploymentReadme -DestinationPath (Join-Path $PortableRoot 'README_DEPLOY.txt') -MediaMtxIncluded:$mediaMtxIncluded

Assert-PathExists -Path (Join-Path $PortableRoot '.env.template') -Label 'portable .env.template'
Assert-PathExists -Path (Join-Path $PortableRoot 'README_DEPLOY.txt') -Label 'portable README_DEPLOY.txt'
Assert-PathExists -Path (Join-Path $PortableRoot 'scripts\start-kurukuru.ps1') -Label 'portable start-kurukuru script'
Assert-PathExists -Path (Join-Path $PortableRoot 'scripts\stop-kurukuru.ps1') -Label 'portable stop-kurukuru script'
Assert-PathExists -Path (Join-Path $PortableRoot 'scripts\launcher\KurukuruLauncher.ps1') -Label 'portable launcher script'
Assert-PathExists -Path (Join-Path $PortableRoot 'apps\api\dist\server.js') -Label 'portable built API server'
Assert-PathExists -Path (Join-Path $PortableRoot 'apps\desktop\dist-electron\main\main.js') -Label 'portable built desktop main'
Assert-PathExists -Path (Join-Path $PortableRoot 'apps\desktop\out\renderer\index.html') -Label 'portable built renderer index'
Assert-PathExists -Path (Join-Path $PortableRoot 'node_modules') -Label 'portable node_modules'
Assert-PathExists -Path (Join-Path $PortableRoot 'apps\desktop\node_modules\electron\dist\electron.exe') -Label 'portable Electron binary'
Assert-PathExists -Path (Join-Path $PortableRoot 'data\kurukuru.db') -Label 'portable SQLite database'
if (Test-Path -LiteralPath $launcherExeSource) {
  Assert-PathExists -Path (Join-Path $PortableRoot 'KurukuruMonitor.exe') -Label 'portable launcher executable'
}
Assert-PortableRendererAssetPaths -IndexHtmlPath (Join-Path $PortableRoot 'apps\desktop\out\renderer\index.html')

Write-Host ''
Write-Host 'Windows portable package created successfully.'
Write-Host ("Package path: {0}" -f $PortableRoot)
