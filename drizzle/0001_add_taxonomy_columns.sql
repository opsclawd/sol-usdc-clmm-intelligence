-- INT-TAXONOMY #6: Add taxonomy columns, CHECK constraints, migrate deprecated columns
-- Adds: signal_class, evidence_family, confidence (jsonb), confidence_composite, confidence_level,
--       valid_until_unix_ms, is_stale, stale_behavior, provenance (jsonb)
-- Migrates: is_fresh → is_stale (inverted), input_lineage → provenance, confidence(varchar) → confidence(jsonb)
-- Drops: is_fresh, input_lineage, confidence(varchar on briefs), source_refs

-- ═══════════════════════════════════════════════════
-- normalized_observations
-- ═══════════════════════════════════════════════════

ALTER TABLE intelligence.normalized_observations
  ADD COLUMN IF NOT EXISTS signal_class VARCHAR(16) NOT NULL DEFAULT 'deterministic',
  ADD COLUMN IF NOT EXISTS evidence_family VARCHAR(32) NOT NULL DEFAULT 'clmm_state',
  ADD COLUMN IF NOT EXISTS confidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS confidence_composite NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS confidence_level VARCHAR(8),
  ADD COLUMN IF NOT EXISTS valid_until_unix_ms BIGINT,
  ADD COLUMN IF NOT EXISTS is_stale BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stale_behavior VARCHAR(24),
  ADD COLUMN IF NOT EXISTS provenance JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE intelligence.normalized_observations
  ADD CONSTRAINT chk_norm_obs_signal_class CHECK (signal_class IN ('deterministic', 'probabilistic', 'contextual')),
  ADD CONSTRAINT chk_norm_obs_evidence_family CHECK (evidence_family IN ('clmm_state', 'price_quality', 'clmm_economics', 'execution_safety', 'market_regime', 'support_resistance', 'on_chain_flow', 'perp_liquidation', 'macro_protocol_risk')),
  ADD CONSTRAINT chk_norm_obs_confidence_composite CHECK (confidence_composite IS NULL OR (confidence_composite >= 0 AND confidence_composite <= 1)),
  ADD CONSTRAINT chk_norm_obs_confidence_level CHECK (confidence_level IS NULL OR confidence_level IN ('low', 'medium', 'high')),
  ADD CONSTRAINT chk_norm_obs_stale_behavior CHECK (stale_behavior IS NULL OR stale_behavior IN ('exclude', 'degrade_confidence', 'allow_context_only'));

-- Migrate is_fresh → is_stale (inverted)
UPDATE intelligence.normalized_observations SET is_stale = NOT is_fresh;

-- Drop old index and column
DROP INDEX IF EXISTS intelligence.idx_norm_obs_source_kind_fresh;
ALTER TABLE intelligence.normalized_observations DROP COLUMN IF EXISTS is_fresh;

-- New index on is_stale
CREATE INDEX IF NOT EXISTS idx_norm_obs_source_kind_stale
  ON intelligence.normalized_observations (source, observation_kind, is_stale, received_at_unix_ms);

-- ═══════════════════════════════════════════════════
-- derived_features
-- ═══════════════════════════════════════════════════

ALTER TABLE intelligence.derived_features
  ADD COLUMN IF NOT EXISTS signal_class VARCHAR(16) NOT NULL DEFAULT 'deterministic',
  ADD COLUMN IF NOT EXISTS evidence_family VARCHAR(32) NOT NULL DEFAULT 'clmm_state',
  ADD COLUMN IF NOT EXISTS valid_until_unix_ms BIGINT,
  ADD COLUMN IF NOT EXISTS is_stale BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stale_behavior VARCHAR(24),
  ADD COLUMN IF NOT EXISTS confidence_composite NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS confidence_level VARCHAR(8),
  ADD COLUMN IF NOT EXISTS provenance JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Replace confidence(varchar) with confidence(jsonb): rename old, add new
ALTER TABLE intelligence.derived_features RENAME COLUMN confidence TO confidence_legacy;
ALTER TABLE intelligence.derived_features ADD COLUMN IF NOT EXISTS confidence JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Replace input_lineage with provenance (already added above); drop input_lineage
ALTER TABLE intelligence.derived_features DROP COLUMN IF EXISTS input_lineage;

ALTER TABLE intelligence.derived_features
  ADD CONSTRAINT chk_features_signal_class CHECK (signal_class IN ('deterministic', 'probabilistic', 'contextual')),
  ADD CONSTRAINT chk_features_evidence_family CHECK (evidence_family IN ('clmm_state', 'price_quality', 'clmm_economics', 'execution_safety', 'market_regime', 'support_resistance', 'on_chain_flow', 'perp_liquidation', 'macro_protocol_risk')),
  ADD CONSTRAINT chk_features_confidence_composite CHECK (confidence_composite IS NULL OR (confidence_composite >= 0 AND confidence_composite <= 1)),
  ADD CONSTRAINT chk_features_confidence_level CHECK (confidence_level IS NULL OR confidence_level IN ('low', 'medium', 'high')),
  ADD CONSTRAINT chk_features_stale_behavior CHECK (stale_behavior IS NULL OR stale_behavior IN ('exclude', 'degrade_confidence', 'allow_context_only'));

-- Drop old confidence(varchar) column and its index
DROP INDEX IF EXISTS intelligence.idx_features_kind_confidence;
ALTER TABLE intelligence.derived_features DROP COLUMN IF EXISTS confidence_legacy;

-- Add confidence_composite and confidence_level columns were added in the first ALTER TABLE block above

-- ═══════════════════════════════════════════════════
-- evidence_bundles
-- ═══════════════════════════════════════════════════

ALTER TABLE intelligence.evidence_bundles
  ADD COLUMN IF NOT EXISTS taxonomy_summary JSONB,
  ADD COLUMN IF NOT EXISTS dominant_signal_class VARCHAR(16) NOT NULL DEFAULT 'deterministic',
  ADD COLUMN IF NOT EXISTS confidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS confidence_composite NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS confidence_level VARCHAR(8),
  ADD COLUMN IF NOT EXISTS valid_until_unix_ms BIGINT,
  ADD COLUMN IF NOT EXISTS is_stale BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stale_behavior VARCHAR(24),
  ADD COLUMN IF NOT EXISTS provenance JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE intelligence.evidence_bundles DROP COLUMN IF EXISTS input_lineage;

ALTER TABLE intelligence.evidence_bundles
  ADD CONSTRAINT chk_bundle_dominant_signal_class CHECK (dominant_signal_class IN ('deterministic', 'probabilistic', 'contextual')),
  ADD CONSTRAINT chk_bundle_confidence_composite CHECK (confidence_composite IS NULL OR (confidence_composite >= 0 AND confidence_composite <= 1)),
  ADD CONSTRAINT chk_bundle_confidence_level CHECK (confidence_level IS NULL OR confidence_level IN ('low', 'medium', 'high')),
  ADD CONSTRAINT chk_bundle_stale_behavior CHECK (stale_behavior IS NULL OR stale_behavior IN ('exclude', 'degrade_confidence', 'allow_context_only'));

-- ═══════════════════════════════════════════════════
-- research_briefs
-- ═══════════════════════════════════════════════════

ALTER TABLE intelligence.research_briefs
  ADD COLUMN IF NOT EXISTS signal_class VARCHAR(16) NOT NULL DEFAULT 'contextual',
  ADD COLUMN IF NOT EXISTS evidence_family VARCHAR(32),
  ADD COLUMN IF NOT EXISTS taxonomy_summary JSONB,
  ADD COLUMN IF NOT EXISTS valid_until_unix_ms BIGINT,
  ADD COLUMN IF NOT EXISTS is_stale BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stale_behavior VARCHAR(24),
  ADD COLUMN IF NOT EXISTS provenance JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Replace confidence(varchar) with confidence(jsonb)
ALTER TABLE intelligence.research_briefs RENAME COLUMN confidence TO confidence_legacy;
ALTER TABLE intelligence.research_briefs ADD COLUMN IF NOT EXISTS confidence JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE intelligence.research_briefs ADD COLUMN IF NOT EXISTS confidence_composite NUMERIC(5,4);
ALTER TABLE intelligence.research_briefs ADD COLUMN IF NOT EXISTS confidence_level VARCHAR(8);

-- Drop old columns
ALTER TABLE intelligence.research_briefs DROP COLUMN IF EXISTS confidence_legacy;
ALTER TABLE intelligence.research_briefs DROP COLUMN IF EXISTS source_refs;

ALTER TABLE intelligence.research_briefs
  ADD CONSTRAINT chk_brief_signal_class CHECK (signal_class IN ('deterministic', 'probabilistic', 'contextual')),
  ADD CONSTRAINT chk_brief_evidence_family CHECK (evidence_family IS NULL OR evidence_family IN ('clmm_state', 'price_quality', 'clmm_economics', 'execution_safety', 'market_regime', 'support_resistance', 'on_chain_flow', 'perp_liquidation', 'macro_protocol_risk')),
  ADD CONSTRAINT chk_brief_confidence_composite CHECK (confidence_composite IS NULL OR (confidence_composite >= 0 AND confidence_composite <= 1)),
  ADD CONSTRAINT chk_brief_confidence_level CHECK (confidence_level IS NULL OR confidence_level IN ('low', 'medium', 'high')),
  ADD CONSTRAINT chk_brief_stale_behavior CHECK (stale_behavior IS NULL OR stale_behavior IN ('exclude', 'degrade_confidence', 'allow_context_only')),
  ADD CONSTRAINT chk_brief_taxonomy_summary_required CHECK (evidence_family IS NOT NULL OR taxonomy_summary IS NOT NULL);

-- ═══════════════════════════════════════════════════
-- Kind name migration: kebab-case → snake_case
-- ═══════════════════════════════════════════════════

UPDATE intelligence.normalized_observations SET observation_kind = 'pool_state' WHERE observation_kind = 'pool-snapshot';
UPDATE intelligence.derived_features SET feature_kind = 'fee_apr' WHERE feature_kind = 'fee-apr';

-- ═══════════════════════════════════════════════════
-- GRANT on new columns (conditional on role existence)
-- ═══════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'intelligence_writer') THEN
    GRANT ALL ON ALL TABLES IN SCHEMA intelligence TO intelligence_writer;
  END IF;
END$$;