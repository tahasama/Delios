#!/bin/sh
# Runs once, when the data volume is first created. Passwords come from the
# environment (deploy/.env), never from the repository.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v app_password="$DB_APP_PASSWORD" \
  -v monitor_password="$DB_MONITOR_PASSWORD" \
  -v replication_password="$DB_REPLICATION_PASSWORD" <<'SQL'
-- The application connects as an ordinary role: superusers ignore row-level security.
CREATE ROLE delios LOGIN PASSWORD :'app_password' NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE delios OWNER delios;

-- Reads statistics for monitoring; sees no table data.
CREATE ROLE delios_monitor LOGIN PASSWORD :'monitor_password' IN ROLE pg_monitor;

-- Streams the write-ahead log to a standby.
CREATE ROLE replicator LOGIN REPLICATION PASSWORD :'replication_password';
SQL
