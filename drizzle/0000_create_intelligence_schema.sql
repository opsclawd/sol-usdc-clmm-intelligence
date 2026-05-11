-- INT-PERSIST #5: Schema, table creation, and grants for intelligence schema
-- Role provisioning is in scripts/db-provision-roles.ts (requires CREATEROLE)
-- This migration assumes roles already exist; run db:provision-roles first.

CREATE SCHEMA IF NOT EXISTS intelligence;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'intelligence_reader') AND
     EXISTS (SELECT FROM pg_roles WHERE rolname = 'intelligence_writer') THEN
    GRANT USAGE ON SCHEMA intelligence TO intelligence_reader, intelligence_writer;
  ELSIF EXISTS (SELECT FROM pg_roles WHERE rolname = 'intelligence_reader') THEN
    GRANT USAGE ON SCHEMA intelligence TO intelligence_reader;
  ELSIF EXISTS (SELECT FROM pg_roles WHERE rolname = 'intelligence_writer') THEN
    GRANT USAGE ON SCHEMA intelligence TO intelligence_writer;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS intelligence.raw_observations (
  id SERIAL PRIMARY KEY,
  source VARCHAR(64) NOT NULL,
  observed_at_unix_ms BIGINT NOT NULL,
  fetched_at_unix_ms BIGINT NOT NULL,
  payload_hash VARCHAR(64) NOT NULL,
  payload_canonical TEXT NOT NULL,
  parse_status VARCHAR(16) NOT NULL DEFAULT 'pending',
  source_request_meta JSONB,
  received_at_unix_ms BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_raw_obs_source_payload_hash
  ON intelligence.raw_observations (source, payload_hash);
CREATE INDEX IF NOT EXISTS idx_raw_obs_source_observed
  ON intelligence.raw_observations (source, observed_at_unix_ms, id);

CREATE TABLE IF NOT EXISTS intelligence.normalized_observations (
  id SERIAL PRIMARY KEY,
  raw_observation_id INTEGER NOT NULL,
  source VARCHAR(64) NOT NULL,
  observation_kind VARCHAR(64) NOT NULL,
  payload JSONB NOT NULL,
  payload_hash VARCHAR(64) NOT NULL,
  is_fresh BOOLEAN NOT NULL DEFAULT TRUE,
  received_at_unix_ms BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_norm_obs_source_kind_hash
  ON intelligence.normalized_observations (source, observation_kind, payload_hash);
CREATE INDEX IF NOT EXISTS idx_norm_obs_source_kind_fresh
  ON intelligence.normalized_observations (source, observation_kind, is_fresh, received_at_unix_ms);

CREATE TABLE IF NOT EXISTS intelligence.derived_features (
  id SERIAL PRIMARY KEY,
  feature_kind VARCHAR(64) NOT NULL,
  value DOUBLE PRECISION,
  structured_payload JSONB,
  as_of_unix_ms BIGINT NOT NULL,
  confidence VARCHAR(16) NOT NULL DEFAULT 'medium',
  input_lineage JSONB,
  received_at_unix_ms BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_features_kind_as_of
  ON intelligence.derived_features (feature_kind, as_of_unix_ms, id);
CREATE INDEX IF NOT EXISTS idx_features_kind_confidence
  ON intelligence.derived_features (feature_kind, confidence, received_at_unix_ms);

CREATE TABLE IF NOT EXISTS intelligence.evidence_bundles (
  id SERIAL PRIMARY KEY,
  schema_version VARCHAR(16) NOT NULL,
  pair VARCHAR(32) NOT NULL,
  as_of_unix_ms BIGINT NOT NULL,
  expires_at_unix_ms BIGINT NOT NULL,
  payload JSONB NOT NULL,
  payload_hash VARCHAR(64) NOT NULL,
  input_lineage JSONB,
  version INTEGER NOT NULL DEFAULT 1,
  received_at_unix_ms BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_bundle_pair_hash
  ON intelligence.evidence_bundles (pair, payload_hash);
CREATE INDEX IF NOT EXISTS idx_bundle_pair_as_of
  ON intelligence.evidence_bundles (pair, as_of_unix_ms, id);
CREATE INDEX IF NOT EXISTS idx_bundle_pair_latest
  ON intelligence.evidence_bundles (pair, received_at_unix_ms, id);

CREATE TABLE IF NOT EXISTS intelligence.research_briefs (
  id SERIAL PRIMARY KEY,
  evidence_bundle_id INTEGER NOT NULL,
  prompt_version VARCHAR(32) NOT NULL,
  model_provider VARCHAR(64) NOT NULL,
  structured_output JSONB NOT NULL,
  confidence VARCHAR(16) NOT NULL DEFAULT 'medium',
  source_refs JSONB,
  payload_hash VARCHAR(64) NOT NULL,
  received_at_unix_ms BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_brief_bundle_hash
  ON intelligence.research_briefs (evidence_bundle_id, payload_hash);
CREATE INDEX IF NOT EXISTS idx_brief_bundle_id
  ON intelligence.research_briefs (evidence_bundle_id, received_at_unix_ms);
CREATE INDEX IF NOT EXISTS idx_brief_model_provider
  ON intelligence.research_briefs (model_provider, received_at_unix_ms);

ALTER TABLE intelligence.normalized_observations
  ADD CONSTRAINT fk_normalized_observations_raw_observation
  FOREIGN KEY (raw_observation_id) REFERENCES intelligence.raw_observations(id)
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE intelligence.research_briefs
  ADD CONSTRAINT fk_research_briefs_evidence_bundle
  FOREIGN KEY (evidence_bundle_id) REFERENCES intelligence.evidence_bundles(id)
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'intelligence_reader') THEN
    GRANT SELECT ON ALL TABLES IN SCHEMA intelligence TO intelligence_reader;
    ALTER DEFAULT PRIVILEGES IN SCHEMA intelligence GRANT SELECT ON TABLES TO intelligence_reader;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'intelligence_writer') THEN
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA intelligence TO intelligence_writer;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA intelligence TO intelligence_writer;
    ALTER DEFAULT PRIVILEGES IN SCHEMA intelligence GRANT SELECT, INSERT, UPDATE ON TABLES TO intelligence_writer;
    ALTER DEFAULT PRIVILEGES IN SCHEMA intelligence GRANT USAGE ON SEQUENCES TO intelligence_writer;
  END IF;
END
$$;