-- Runs once, when the data volume is first created.

-- The application connects as an ordinary role: superusers ignore row-level security.
CREATE ROLE delios LOGIN PASSWORD 'delios-dev' NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE delios OWNER delios;

-- Reads statistics for monitoring; sees no table data.
CREATE ROLE delios_monitor LOGIN PASSWORD 'monitor-dev' IN ROLE pg_monitor;

-- Streams the write-ahead log to a standby.
CREATE ROLE replicator LOGIN REPLICATION PASSWORD 'replicator-dev';
