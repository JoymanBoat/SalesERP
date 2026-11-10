$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$backupDirectory = Join-Path $projectRoot "backups"
New-Item -ItemType Directory -Force -Path $backupDirectory | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$suffix = [guid]::NewGuid().ToString("N").Substring(0, 8)
$fileName = "saleserp-$timestamp-$suffix.dump"
$backupPath = Join-Path $backupDirectory $fileName
$relativePath = Join-Path "backups" $fileName

if (Test-Path -LiteralPath $backupPath) {
  throw "The backup file already exists; refusing to overwrite it."
}

Push-Location $projectRoot
try {
  . (Join-Path $PSScriptRoot "assert-docker-postgres-target.ps1")
  $dumpCommand = "docker compose exec -T db pg_dump --username=saleserp_app --dbname=saleserp --format=custom > $relativePath"
  & $env:ComSpec /d /s /c "`"$dumpCommand`""
  if ($LASTEXITCODE -ne 0) {
    throw "PostgreSQL backup failed with exit code $LASTEXITCODE."
  }
  if (-not (Test-Path -LiteralPath $backupPath) -or (Get-Item -LiteralPath $backupPath).Length -eq 0) {
    throw "PostgreSQL backup did not produce a non-empty archive."
  }

  $verifyCommand = "docker compose exec -T db pg_restore --list < $relativePath > nul"
  & $env:ComSpec /d /s /c "`"$verifyCommand`""
  if ($LASTEXITCODE -ne 0) {
    throw "The generated PostgreSQL backup could not be validated."
  }

  Write-Output "Verified PostgreSQL backup: $backupPath"
}
catch {
  if (Test-Path -LiteralPath $backupPath) {
    Remove-Item -LiteralPath $backupPath -Force
  }
  throw
}
finally {
  Pop-Location
}
