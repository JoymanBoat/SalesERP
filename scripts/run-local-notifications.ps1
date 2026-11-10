$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $projectRoot "backups"
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$logPath = Join-Path $logDirectory "notifications-scheduler.log"

Push-Location $projectRoot
try {
  Add-Content -LiteralPath $logPath -Encoding UTF8 -Value "[$(Get-Date -Format o)] Starting scheduled notifications."
  & node (Join-Path $PSScriptRoot "run-local-notifications.mjs") 2>&1 | ForEach-Object {
    Add-Content -LiteralPath $logPath -Encoding UTF8 -Value "$_"
    Write-Output "$_"
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Scheduled notifications failed. See $logPath and the app logs."
  }
  Add-Content -LiteralPath $logPath -Encoding UTF8 -Value "[$(Get-Date -Format o)] Scheduled notifications completed successfully."
}
catch {
  Add-Content -LiteralPath $logPath -Encoding UTF8 -Value "[$(Get-Date -Format o)] Scheduled notifications FAILED: $_"
  throw
}
finally {
  Pop-Location
}
