$activeDatabaseHost = & docker compose exec -T app node -p "new URL(process.env.DATABASE_URL).hostname"
if ($LASTEXITCODE -ne 0) {
  throw "Cannot inspect the running app database; refusing to operate on the Docker database."
}
if ($activeDatabaseHost.Trim() -ne "db") {
  throw "The running app does not use the Docker db service. This helper targets a different database and cannot be used."
}
$activeDatabaseName = & docker compose exec -T app node -p "new URL(process.env.DATABASE_URL).pathname"
if ($LASTEXITCODE -ne 0 -or $activeDatabaseName.Trim() -ne "/saleserp") {
  throw "The running app does not use the expected Docker saleserp database; refusing to continue."
}
$activeDatabasePort = & docker compose exec -T app node -p "new URL(process.env.DATABASE_URL).port"
if ($LASTEXITCODE -ne 0 -or ($activeDatabasePort.Trim() -ne "" -and $activeDatabasePort.Trim() -ne "5432")) {
  throw "The running app does not use the expected Docker PostgreSQL port; refusing to continue."
}
