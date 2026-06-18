$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$agentRoot = Join-Path $repoRoot "apps\vehicle-agent"
$pnpmCmd = "C:\Program Files\nodejs\corepack.cmd"

if (-not (Test-Path $pnpmCmd)) {
  throw "corepack.cmd was not found at $pnpmCmd"
}

$env:VEHICLE_ID = "vehicle-001"
$env:ROUTE_ID = "route-001"
$env:ADMIN_API_URL = "http://localhost:4000"
$env:AGENT_TOKEN = "token1"
$env:MOCK_GNSS = "true"
$env:MOCK_LATITUDE = "35.863239"
$env:MOCK_LONGITUDE = "139.658787"
$env:POLL_INTERVAL_MS = "1000"
$env:REQUEST_TIMEOUT_MS = "3000"
$vehicle1 = Start-Process -FilePath $pnpmCmd -ArgumentList "pnpm","--filter","@kurukuru-monitor/vehicle-agent","dev" -WorkingDirectory $repoRoot -PassThru

Start-Sleep -Seconds 1

$env:VEHICLE_ID = "vehicle-002"
$env:ROUTE_ID = "route-002"
$env:ADMIN_API_URL = "http://localhost:4000"
$env:AGENT_TOKEN = "token2"
$env:MOCK_GNSS = "true"
$env:MOCK_LATITUDE = "35.872000"
$env:MOCK_LONGITUDE = "139.660000"
$env:POLL_INTERVAL_MS = "1000"
$env:REQUEST_TIMEOUT_MS = "3000"
$vehicle2 = Start-Process -FilePath $pnpmCmd -ArgumentList "pnpm","--filter","@kurukuru-monitor/vehicle-agent","dev" -WorkingDirectory $repoRoot -PassThru

Write-Host "Started mock vehicle agents:"
Write-Host " vehicle-001 PID=$($vehicle1.Id)"
Write-Host " vehicle-002 PID=$($vehicle2.Id)"
Write-Host ""
Write-Host "API env should include:"
Write-Host ' VEHICLE_AGENT_TOKENS=vehicle-001:token1,vehicle-002:token2'
Write-Host ""
Write-Host "Stop them with:"
Write-Host " Stop-Process -Id $($vehicle1.Id),$($vehicle2.Id)"
