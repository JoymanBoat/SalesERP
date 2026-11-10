$ErrorActionPreference = "Stop"

$taskName = "SalesERP Local Notifications"
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  throw "Scheduled task '$taskName' already exists; inspect it before changing it."
}
$zone = Get-TimeZone
if ($zone.BaseUtcOffset -ne [TimeSpan]::FromHours(8) -or $zone.SupportsDaylightSavingTime) {
  throw "This task expects a fixed UTC+08:00 timezone. Configure the schedule for 00:15 UTC separately."
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $PSScriptRoot "run-local-notifications.ps1"
$powershellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$scriptPath`""
$action = New-ScheduledTaskAction -Execute $powershellPath -Argument $arguments -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -Daily -At "8:15AM"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Runs local SalesERP daily notifications at 00:15 UTC." | Out-Null
Write-Output "Registered '$taskName' for $identity at 08:15 local time (00:15 UTC)."
