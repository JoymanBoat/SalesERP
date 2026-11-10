\set ON_ERROR_STOP on

SELECT 'CREATE ROLE saleserp_app LOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'saleserp_app')
\gexec

\getenv app_password SALESERP_APP_PASSWORD
ALTER ROLE saleserp_app WITH PASSWORD :'app_password';

SELECT 'CREATE DATABASE saleserp OWNER saleserp_app'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'saleserp')
\gexec
