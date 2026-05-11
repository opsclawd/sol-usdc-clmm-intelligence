-- INT-PERSIST #5: Schema and role provisioning for intelligence schema
-- Run this BEFORE the table migrations.
-- After all migrations, run:
--   GRANT SELECT ON ALL TABLES IN SCHEMA intelligence TO intelligence_reader;
--   GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA intelligence TO intelligence_writer;

CREATE SCHEMA IF NOT EXISTS intelligence;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'intelligence_reader') THEN
    CREATE ROLE intelligence_reader;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'intelligence_writer') THEN
    CREATE ROLE intelligence_writer;
  END IF;
END
$$;