$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot ".env"
$databaseUrlLine = Get-Content $envFile | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
$databaseUrlMatch = [regex]::Match(
  $databaseUrlLine,
  '^DATABASE_URL="postgresql://saleserp_app:([^"@]+)@localhost:5432/saleserp\?schema=public"$'
)

if (-not $databaseUrlMatch.Success) {
  throw "DATABASE_URL in .env must use the local saleserp_app/saleserp connection from .env.example."
}

$appPassword = [uri]::UnescapeDataString($databaseUrlMatch.Groups[1].Value)
$psqlPath = Join-Path $env:ProgramFiles "PostgreSQL\17\bin\psql.exe"

if (-not (Test-Path $psqlPath)) {
  throw "PostgreSQL 17 psql.exe was not found at $psqlPath."
}

$adminPassword = Read-Host "Enter the local PostgreSQL postgres administrator password" -AsSecureString
$adminPasswordPointer = [IntPtr]::Zero

try {
  $adminPasswordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($adminPassword)
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($adminPasswordPointer)
  $env:SALESERP_APP_PASSWORD = $appPassword

  & $psqlPath --no-password --username postgres --host localhost --port 5432 --dbname postgres --set ON_ERROR_STOP=1 --file (Join-Path $PSScriptRoot "setup-database.sql")
  if ($LASTEXITCODE -ne 0) {
    throw "PostgreSQL setup failed. Check the error above and confirm the administrator password."
  }

  $env:PGPASSWORD = $appPassword
  & $psqlPath --no-password --username saleserp_app --host localhost --port 5432 --dbname saleserp --command "SELECT current_user, current_database();"
  if ($LASTEXITCODE -ne 0) {
    throw "The saleserp_app connection check failed. Verify DATABASE_URL in .env."
  }

  Write-Output "Local PostgreSQL role and database are ready."
}
finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:SALESERP_APP_PASSWORD -ErrorAction SilentlyContinue
  if ($adminPasswordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($adminPasswordPointer)
  }
}
