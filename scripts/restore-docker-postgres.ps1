param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$BackupFile
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$backupDirectory = Join-Path $projectRoot "backups"
$resolvedBackupPath = (Resolve-Path -LiteralPath $BackupFile).Path
$resolvedBackupDirectory = (Resolve-Path -LiteralPath $backupDirectory).Path

if (-not $resolvedBackupPath.StartsWith(
  $resolvedBackupDirectory + [IO.Path]::DirectorySeparatorChar,
  [StringComparison]::OrdinalIgnoreCase
)) {
  throw "The backup file must be inside the repository's backups directory."
}
if ([IO.Path]::GetExtension($resolvedBackupPath) -ne ".dump") {
  throw "The backup file must use the .dump custom-format extension."
}
$backupFileName = [IO.Path]::GetFileName($resolvedBackupPath)
if ($backupFileName -notmatch '^saleserp-[A-Za-z0-9._-]+\.dump$') {
  throw "The backup filename must start with saleserp- and contain only letters, numbers, dots, dashes, or underscores."
}
if ((Get-Item -LiteralPath $resolvedBackupPath).Length -eq 0) {
  throw "The backup file is empty."
}

$safeRelativePath = Join-Path "backups" $backupFileName
$verifyCommand = "docker compose exec -T db pg_restore --list < `"$safeRelativePath`" > nul"

Push-Location $projectRoot
try {
  & $env:ComSpec /d /s /c $verifyCommand
  if ($LASTEXITCODE -ne 0) {
    throw "The backup archive could not be validated. No database changes were made."
  }

  Write-Output "Restore target: Compose service db, database saleserp"
  Write-Output "Backup archive: $resolvedBackupPath"
  Write-Output "This operation replaces database objects contained in the backup."
  $confirmation = Read-Host "Type RESTORE saleserp to continue"
  if ($confirmation -cne "RESTORE saleserp") {
    throw "Restore cancelled. No database changes were made."
  }

  & docker compose stop app
  if ($LASTEXITCODE -ne 0) {
    throw "Could not stop the app service; restore was not started."
  }

  $restoreCommand = "docker compose exec -T db pg_restore --username=saleserp_app --dbname=saleserp --clean --if-exists < `"$safeRelativePath`""
  & $env:ComSpec /d /s /c $restoreCommand
  if ($LASTEXITCODE -ne 0) {
    throw "PostgreSQL restore failed. The app remains stopped; inspect database state before restarting."
  }

  Write-Output "Restore completed. Restart services with: docker compose up -d"
}
finally {
  Pop-Location
}
