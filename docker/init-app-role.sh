#!/bin/bash
set -euo pipefail

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=ON_ERROR_STOP=1 \
  --set=app_password="$POSTGRES_APP_PASSWORD" <<'EOSQL'
CREATE ROLE saleserp_app LOGIN PASSWORD :'app_password';
GRANT CONNECT ON DATABASE saleserp TO saleserp_app;
GRANT USAGE, CREATE ON SCHEMA public TO saleserp_app;
EOSQL
