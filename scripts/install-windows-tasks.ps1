$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$apiScript = Join-Path $PSScriptRoot 'start-api.ps1'
$desktopScript = Join-Path $PSScriptRoot 'start-desktop.ps1'

$apiTaskName = 'Kurukuru Monitor API'
$desktopTaskName = 'Kurukuru Monitor Desktop'
$currentUser = '{0}\{1}' -f $env:USERDOMAIN, $env:USERNAME

function New-TaskActionForScript {
  param([string]$ScriptPath)

  New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $ScriptPath)
}

function Register-KurukuruTask {
  param(
    [string]$TaskName,
    [Microsoft.Management.Infrastructure.CimInstance]$Trigger,
    [Microsoft.Management.Infrastructure.CimInstance]$Action
  )

  $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType InteractiveToken -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

  $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }

  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Principal $principal `
    -Settings $settings | Out-Null
}

$apiTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$desktopTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$desktopTrigger.Delay = 'PT25S'

Register-KurukuruTask -TaskName $apiTaskName -Trigger $apiTrigger -Action (New-TaskActionForScript -ScriptPath $apiScript)
Register-KurukuruTask -TaskName $desktopTaskName -Trigger $desktopTrigger -Action (New-TaskActionForScript -ScriptPath $desktopScript)

Write-Host ("Installed scheduled tasks: '{0}', '{1}'" -f $apiTaskName, $desktopTaskName)
Write-Host ("Repo root: {0}" -f $RepoRoot)
