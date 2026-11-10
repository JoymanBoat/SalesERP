$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $projectRoot "backups"
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$logPath = Join-Path $logDirectory "active-backup.log"

Push-Location $projectRoot
try {
  Add-Content -LiteralPath $logPath -Encoding UTF8 -Value "[$(Get-Date -Format o)] Starting active database backup."
  & node (Join-Path $PSScriptRoot "backup-active-postgres.mjs") 2>&1 | ForEach-Object {
    Add-Content -LiteralPath $logPath -Encoding UTF8 -Value "$_"
    Write-Output "$_"
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Active database backup failed. See $logPath."
  }
  Add-Content -LiteralPath $logPath -Encoding UTF8 -Value "[$(Get-Date -Format o)] Backup completed successfully."
}
catch {
  Add-Content -LiteralPath $logPath -Encoding UTF8 -Value "[$(Get-Date -Format o)] Backup FAILED: $_"
  throw
}
finally {
  Pop-Location
}
