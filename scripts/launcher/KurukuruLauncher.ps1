$ErrorActionPreference = 'Stop'

function Get-SafePathString {
  param([object]$Value)

  if ($null -eq $Value) {
    return $null
  }

  $text = [string]$Value
  if ([string]::IsNullOrWhiteSpace($text)) {
    return $null
  }

  return $text
}

function Get-LauncherContext {
  $scriptRoot = Get-SafePathString $PSScriptRoot
  $invocationPath = Get-SafePathString $MyInvocation.MyCommand.Path
  $exePath = $null
  $currentDirectory = $null

  try {
    $exePath = Get-SafePathString ([System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName)
  } catch {
    $exePath = $null
  }

  try {
    $currentDirectory = Get-SafePathString ((Get-Location).Path)
  } catch {
    $currentDirectory = $null
  }

  $appRoot = $null
  if ($scriptRoot) {
    $parent = Split-Path -Parent $scriptRoot
    if ($parent) {
      $appRoot = $parent
    } else {
      $appRoot = $scriptRoot
    }
  } elseif ($exePath) {
    $appRoot = Split-Path -Parent $exePath
  } elseif ($currentDirectory) {
    $appRoot = $currentDirectory
  }

  return [pscustomobject]@{
    ScriptRoot = $scriptRoot
    InvocationPath = $invocationPath
    ExePath = $exePath
    CurrentDirectory = $currentDirectory
    AppRoot = $appRoot
  }
}

function Format-ResolvedPath {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return '[null]'
  }

  return $Value
}

$Context = Get-LauncherContext
$AppRoot = Get-SafePathString $Context.AppRoot
if (-not $AppRoot) {
  throw 'Unable to resolve application root.'
}

$DataDir = Join-Path $AppRoot 'data'
$LogDir = Join-Path $DataDir 'logs'
$LauncherLog = Join-Path $LogDir 'launcher.log'
$StartupScript = Join-Path $AppRoot 'scripts\start-kurukuru.ps1'

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-LauncherLog {
  param([string]$Message)

  $line = "[{0}] {1}" -f (Get-Date).ToString('s'), $Message
  Add-Content -LiteralPath $LauncherLog -Value $line
}

try {
  Set-Location $AppRoot
  Write-LauncherLog 'Launcher started.'
  Write-LauncherLog ("Script root: {0}" -f (Format-ResolvedPath $Context.ScriptRoot))
  Write-LauncherLog ("Invocation path: {0}" -f (Format-ResolvedPath $Context.InvocationPath))
  Write-LauncherLog ("EXE path: {0}" -f (Format-ResolvedPath $Context.ExePath))
  Write-LauncherLog ("Current directory: {0}" -f (Format-ResolvedPath $Context.CurrentDirectory))
  Write-LauncherLog ("App root: {0}" -f $AppRoot)
  Write-LauncherLog ("Startup script path: {0}" -f $StartupScript)

  if (-not (Test-Path -LiteralPath $StartupScript)) {
    throw @"
Startup script not found.
EXE path: $(Format-ResolvedPath $Context.ExePath)
Current directory: $(Format-ResolvedPath $Context.CurrentDirectory)
Attempted app root: $AppRoot
Attempted start script path: $StartupScript
"@
  }

  Write-LauncherLog ("Running startup script: {0}" -f $StartupScript)

  $process = Start-Process `
    -FilePath 'powershell.exe' `
    -ArgumentList @(
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', $StartupScript
    ) `
    -WorkingDirectory $AppRoot `
    -WindowStyle Hidden `
    -Wait `
    -PassThru

  Write-LauncherLog ("Startup script exit code: {0}" -f $process.ExitCode)

  if ($process.ExitCode -ne 0) {
    throw "Kurukuru Monitor startup failed with exit code $($process.ExitCode). Check data\\logs for details."
  }

  Write-LauncherLog 'Launcher completed successfully.'
} catch {
  $message = $_.Exception.Message
  Write-LauncherLog ("Launcher failed: {0}" -f $message)
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show(
    "Kurukuru Monitor could not start.`r`n`r`n$message`r`n`r`nSee data\logs\launcher.log for details.",
    'Kurukuru Monitor Launcher',
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Error
  ) | Out-Null
  exit 1
}

exit 0
