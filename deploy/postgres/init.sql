-- Runs once, when the data volume is first created. The application connects as
-- an ordinary role: superusers ignore row-level security.
CREATE ROLE delios LOGIN PASSWORD 'delios-dev' NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE delios OWNER delios;
