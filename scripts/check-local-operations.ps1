$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $projectRoot "backups"
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$logPath = Join-Path $logDirectory "operations-monitor.log"
$problems = New-Object System.Collections.Generic.List[string]
$notes = New-Object System.Collections.Generic.List[string]

try {
  $port = & node -e "const fs=require('fs');const d=require('dotenv').parse(fs.readFileSync(process.argv[1]));process.stdout.write(d.APP_PORT||'3000')" (Join-Path $projectRoot ".env")
  if ($LASTEXITCODE -ne 0 -or $port -notmatch '^\d+$' -or [int]$port -lt 1 -or [int]$port -gt 65535) {
    throw "Unable to determine a valid application port from .env."
  }
  $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 10
  if ($response.StatusCode -ne 200) { $problems.Add("Application health check did not return HTTP 200.") }
}
catch {
  $problems.Add("Application health check failed: $($_.Exception.Message)")
}

$backup = Get-ChildItem -LiteralPath $logDirectory -File -Filter "saleserp-active-*.dump" |
  Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
if (-not $backup -or $backup.LastWriteTimeUtc -lt [DateTime]::UtcNow.AddHours(-30)) {
  $problems.Add("No active-database backup has been created in the past 30 hours.")
}
foreach ($taskName in @("SalesERP Active Database Backup", "SalesERP Local Notifications")) {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if (-not $task) {
    $problems.Add("Scheduled task '$taskName' is missing.")
    continue
  }
  if ($task.State -eq "Disabled") { $problems.Add("Scheduled task '$taskName' is disabled.") }
  $info = Get-ScheduledTaskInfo -TaskName $taskName
  if ($info.LastTaskResult -eq 267011) {
    $notes.Add("Scheduled task '$taskName' has not run yet.")
  }
  if ($info.LastTaskResult -ne 267011 -and $task.State -ne "Running" -and $info.LastTaskResult -ne 0) {
    $problems.Add("Scheduled task '$taskName' last failed with result $($info.LastTaskResult).")
  }
}

if ($problems.Count -gt 0) {
  $message = "[$(Get-Date -Format o)] FAILED: $($problems -join ' ')"
  Add-Content -LiteralPath $logPath -Encoding UTF8 -Value $message
  try {
    & node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON (Join-Path $PSScriptRoot "operations-alert.mjs") 2>&1 | ForEach-Object {
      Add-Content -LiteralPath $logPath -Encoding UTF8 -Value "$_"
    }
    if ($LASTEXITCODE -ne 0) { throw "Operations alert process exited with code $LASTEXITCODE." }
  }
  catch {
    Add-Content -LiteralPath $logPath -Encoding UTF8 -Value "[$(Get-Date -Format o)] Operations alert email FAILED: $($_.Exception.Message)"
  }
  Write-Error $message
}
$message = "[$(Get-Date -Format o)] Health checks passed; recent backup found. $($notes -join ' ')"
Add-Content -LiteralPath $logPath -Encoding UTF8 -Value $message
Write-Output $message
