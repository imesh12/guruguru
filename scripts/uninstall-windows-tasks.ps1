$ErrorActionPreference = 'Stop'

$taskNames = @(
  'Kurukuru Monitor API',
  'Kurukuru Monitor Desktop'
)

foreach ($taskName in $taskNames) {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($task) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host ("Removed scheduled task: {0}" -f $taskName)
  } else {
    Write-Host ("Scheduled task not found: {0}" -f $taskName)
  }
}
