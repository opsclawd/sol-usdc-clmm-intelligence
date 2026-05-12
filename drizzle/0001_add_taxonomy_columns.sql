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

-- Backfill evidence_family from observation_kind for existing rows
UPDATE intelligence.normalized_observations SET evidence_family = 'price_quality' WHERE observation_kind IN ('price_quote');
UPDATE intelligence.normalized_observations SET evidence_family = 'clmm_economics' WHERE observation_kind IN ('fee_metrics', 'volume_metrics');

-- Backfill empty confidence for existing rows with valid medium-confidence default
UPDATE intelligence.normalized_observations SET
  confidence = jsonb_build_object(
    'components', jsonb_build_object(
      'sourceReliability', 1,
      'dataCompleteness', 1,
      'derivationConfidence', 1,
      'llmConfidence', null
    ),
    'compositeScore', 0.6,
    'level', 'medium',
    'weightingVersion', 'v0_legacy',
    'reasons', '[]'::jsonb
  ),
  confidence_composite = 0.6,
  confidence_level = 'medium'
WHERE confidence = '{}'::jsonb;

-- Backfill empty provenance for existing rows with valid legacy structure
-- sourceRefs and rawObservationRefs use ProvenanceRef contract fields (refType, id, source, payloadHash)
-- JOIN raw_observations to get the correct payload_hash and source for raw refs
UPDATE intelligence.normalized_observations n
SET provenance = jsonb_build_object(
    'sourceRefs', jsonb_build_array(jsonb_build_object(
      'refType', 'raw_observation',
      'id', n.raw_observation_id,
      'source', COALESCE(r.source, n.source),
      'payloadHash', COALESCE(r.payload_hash, n.payload_hash)
    )),
    'rawObservationRefs', jsonb_build_array(jsonb_build_object(
      'refType', 'raw_observation',
      'id', n.raw_observation_id,
      'source', COALESCE(r.source, n.source),
      'payloadHash', COALESCE(r.payload_hash, n.payload_hash)
    )),
    'derivedFromRefs', '[]'::jsonb,
    'processRef', jsonb_build_object(
      'collector', COALESCE(r.source, n.source),
      'jobName', 'legacy',
      'pipelineRunId', null,
      'codeVersion', null,
      'modelVersion', null
    ),
    'codeVersion', 'legacy',
    'runId', null
  )
FROM intelligence.raw_observations r
WHERE n.provenance = '{}'::jsonb
  AND r.id = n.raw_observation_id;

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

-- Preserve legacy confidence value into new JSONB confidence, confidence_level, and confidence_composite
-- Map legacy levels to composite scores: low→0.3, medium→0.6, high→1.0
UPDATE intelligence.derived_features SET
  confidence = jsonb_build_object(
    'components', jsonb_build_object(
      'sourceReliability', 1,
      'dataCompleteness', 1,
      'derivationConfidence', 1,
      'llmConfidence', null
    ),
    'compositeScore', CASE LOWER(confidence_legacy)
      WHEN 'low' THEN 0.3
      WHEN 'medium' THEN 0.6
      WHEN 'high' THEN 1.0
      ELSE 0.6
    END,
    'level', CASE LOWER(confidence_legacy)
      WHEN 'low' THEN 'low'
      WHEN 'medium' THEN 'medium'
      WHEN 'high' THEN 'high'
      ELSE 'medium'
    END,
    'weightingVersion', 'v0_legacy',
    'reasons', '[]'::jsonb
  ),
  confidence_level = CASE LOWER(confidence_legacy)
    WHEN 'low' THEN 'low'
    WHEN 'medium' THEN 'medium'
    WHEN 'high' THEN 'high'
    ELSE 'medium'
  END,
  confidence_composite = CASE LOWER(confidence_legacy)
    WHEN 'low' THEN 0.3
    WHEN 'medium' THEN 0.6
    WHEN 'high' THEN 1.0
    ELSE 0.6
  END
WHERE confidence_legacy IS NOT NULL;

-- Preserve input_lineage into provenance before dropping
UPDATE intelligence.derived_features SET provenance = jsonb_build_object(
  'sourceRefs', '[]'::jsonb,
  'rawObservationRefs', '[]'::jsonb,
  'derivedFromRefs', '[]'::jsonb,
  'processRef', jsonb_build_object(
    'collector', 'legacy',
    'jobName', 'legacy',
    'pipelineRunId', null,
    'codeVersion', null,
    'modelVersion', null
  ),
  'codeVersion', 'legacy',
  'runId', null,
  'legacyInputLineage', COALESCE(input_lineage, 'null'::jsonb)
)
WHERE input_lineage IS NOT NULL;

-- Backfill empty provenance for derived_features rows with null input_lineage
UPDATE intelligence.derived_features SET provenance = jsonb_build_object(
  'sourceRefs', '[]'::jsonb,
  'rawObservationRefs', '[]'::jsonb,
  'derivedFromRefs', '[]'::jsonb,
  'processRef', jsonb_build_object(
    'collector', 'legacy',
    'jobName', 'legacy',
    'pipelineRunId', null,
    'codeVersion', null,
    'modelVersion', null
  ),
  'codeVersion', 'legacy',
  'runId', null
)
WHERE input_lineage IS NULL AND provenance = '{}'::jsonb;

-- Replace input_lineage with provenance (already added above); drop input_lineage
ALTER TABLE intelligence.derived_features DROP COLUMN IF EXISTS input_lineage;

ALTER TABLE intelligence.derived_features
  ADD CONSTRAINT chk_features_signal_class CHECK (signal_class IN ('deterministic', 'probabilistic', 'contextual')),
  ADD CONSTRAINT chk_features_evidence_family CHECK (evidence_family IN ('clmm_state', 'price_quality', 'clmm_economics', 'execution_safety', 'market_regime', 'support_resistance', 'on_chain_flow', 'perp_liquidation', 'macro_protocol_risk')),
  ADD CONSTRAINT chk_features_confidence_composite CHECK (confidence_composite IS NULL OR (confidence_composite >= 0 AND confidence_composite <= 1)),
  ADD CONSTRAINT chk_features_confidence_level CHECK (confidence_level IS NULL OR confidence_level IN ('low', 'medium', 'high')),
  ADD CONSTRAINT chk_features_stale_behavior CHECK (stale_behavior IS NULL OR stale_behavior IN ('exclude', 'degrade_confidence', 'allow_context_only'));

-- Backfill evidence_family from feature_kind for existing rows
UPDATE intelligence.derived_features SET evidence_family = 'clmm_economics' WHERE feature_kind IN ('fee_apr', 'fee-apr');
UPDATE intelligence.derived_features SET evidence_family = 'price_quality' WHERE feature_kind IN ('price_quote', 'oracle_divergence', 'volatility_24h');

-- Drop old confidence(varchar) column and its index
DROP INDEX IF EXISTS intelligence.idx_features_kind_confidence;
ALTER TABLE intelligence.derived_features DROP COLUMN IF EXISTS confidence_legacy;

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

-- Preserve input_lineage into provenance before dropping
UPDATE intelligence.evidence_bundles SET provenance = jsonb_build_object(
  'sourceRefs', '[]'::jsonb,
  'rawObservationRefs', '[]'::jsonb,
  'derivedFromRefs', '[]'::jsonb,
  'processRef', jsonb_build_object(
    'collector', 'legacy',
    'jobName', 'legacy',
    'pipelineRunId', null,
    'codeVersion', null,
    'modelVersion', null
  ),
  'codeVersion', 'legacy',
  'runId', null,
  'legacyInputLineage', COALESCE(input_lineage, 'null'::jsonb)
)
WHERE input_lineage IS NOT NULL;

-- Backfill empty provenance for evidence_bundles rows with null input_lineage
UPDATE intelligence.evidence_bundles SET provenance = jsonb_build_object(
  'sourceRefs', '[]'::jsonb,
  'rawObservationRefs', '[]'::jsonb,
  'derivedFromRefs', '[]'::jsonb,
  'processRef', jsonb_build_object(
    'collector', 'legacy',
    'jobName', 'legacy',
    'pipelineRunId', null,
    'codeVersion', null,
    'modelVersion', null
  ),
  'codeVersion', 'legacy',
  'runId', null
)
WHERE input_lineage IS NULL AND provenance = '{}'::jsonb;

ALTER TABLE intelligence.evidence_bundles DROP COLUMN IF EXISTS input_lineage;

-- Backfill empty confidence for existing bundle rows with a valid low-confidence default
UPDATE intelligence.evidence_bundles SET
  confidence = jsonb_build_object(
    'components', jsonb_build_object(
      'sourceReliability', 1,
      'dataCompleteness', 1,
      'derivationConfidence', 1,
      'llmConfidence', null
    ),
    'compositeScore', 0.6,
    'level', 'medium',
    'weightingVersion', 'v0_legacy',
    'reasons', '[]'::jsonb
  ),
  confidence_composite = 0.6,
  confidence_level = 'medium'
WHERE confidence = '{}'::jsonb;

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

-- Preserve legacy confidence value into new JSONB confidence, confidence_level, and confidence_composite
-- Map legacy levels to composite scores: low→0.3, medium→0.6, high→1.0
UPDATE intelligence.research_briefs SET
  confidence = jsonb_build_object(
    'components', jsonb_build_object(
      'sourceReliability', 1,
      'dataCompleteness', 1,
      'derivationConfidence', 1,
      'llmConfidence', null
    ),
    'compositeScore', CASE LOWER(confidence_legacy)
      WHEN 'low' THEN 0.3
      WHEN 'medium' THEN 0.6
      WHEN 'high' THEN 1.0
      ELSE 0.6
    END,
    'level', CASE LOWER(confidence_legacy)
      WHEN 'low' THEN 'low'
      WHEN 'medium' THEN 'medium'
      WHEN 'high' THEN 'high'
      ELSE 'medium'
    END,
    'weightingVersion', 'v0_legacy',
    'reasons', '[]'::jsonb
  ),
  confidence_level = CASE LOWER(confidence_legacy)
    WHEN 'low' THEN 'low'
    WHEN 'medium' THEN 'medium'
    WHEN 'high' THEN 'high'
    ELSE 'medium'
  END,
  confidence_composite = CASE LOWER(confidence_legacy)
    WHEN 'low' THEN 0.3
    WHEN 'medium' THEN 0.6
    WHEN 'high' THEN 1.0
    ELSE 0.6
  END
WHERE confidence_legacy IS NOT NULL;

-- Preserve source_refs into provenance before dropping
UPDATE intelligence.research_briefs SET provenance = jsonb_build_object(
  'sourceRefs', COALESCE(source_refs, '[]'::jsonb),
  'rawObservationRefs', '[]'::jsonb,
  'derivedFromRefs', '[]'::jsonb,
  'processRef', jsonb_build_object(
    'collector', 'legacy',
    'jobName', 'legacy',
    'pipelineRunId', null,
    'codeVersion', null,
    'modelVersion', null
  ),
  'codeVersion', 'legacy',
  'runId', null
)
WHERE source_refs IS NOT NULL;

-- Backfill empty provenance for research_briefs rows with null source_refs
UPDATE intelligence.research_briefs SET provenance = jsonb_build_object(
  'sourceRefs', '[]'::jsonb,
  'rawObservationRefs', '[]'::jsonb,
  'derivedFromRefs', '[]'::jsonb,
  'processRef', jsonb_build_object(
    'collector', 'legacy',
    'jobName', 'legacy',
    'pipelineRunId', null,
    'codeVersion', null,
    'modelVersion', null
  ),
  'codeVersion', 'legacy',
  'runId', null
)
WHERE source_refs IS NULL AND provenance = '{}'::jsonb;

-- Drop old columns
ALTER TABLE intelligence.research_briefs DROP COLUMN IF EXISTS confidence_legacy;
ALTER TABLE intelligence.research_briefs DROP COLUMN IF EXISTS source_refs;

ALTER TABLE intelligence.research_briefs
  ADD CONSTRAINT chk_brief_signal_class CHECK (signal_class IN ('deterministic', 'probabilistic', 'contextual')),
  ADD CONSTRAINT chk_brief_evidence_family CHECK (evidence_family IS NULL OR evidence_family IN ('clmm_state', 'price_quality', 'clmm_economics', 'execution_safety', 'market_regime', 'support_resistance', 'on_chain_flow', 'perp_liquidation', 'macro_protocol_risk')),
  ADD CONSTRAINT chk_brief_confidence_composite CHECK (confidence_composite IS NULL OR (confidence_composite >= 0 AND confidence_composite <= 1)),
  ADD CONSTRAINT chk_brief_confidence_level CHECK (confidence_level IS NULL OR confidence_level IN ('low', 'medium', 'high')),
  ADD CONSTRAINT chk_brief_stale_behavior CHECK (stale_behavior IS NULL OR stale_behavior IN ('exclude', 'degrade_confidence', 'allow_context_only'));

-- Backfill evidence_family for existing briefs (contextual briefs get the default family)
UPDATE intelligence.research_briefs SET evidence_family = 'clmm_state' WHERE evidence_family IS NULL AND taxonomy_summary IS NULL;

-- Add the taxonomy_summary constraint as NOT VALID so it doesn't fail on existing rows,
-- then validate after backfill
ALTER TABLE intelligence.research_briefs
  ADD CONSTRAINT chk_brief_taxonomy_summary_required CHECK (evidence_family IS NOT NULL OR taxonomy_summary IS NOT NULL) NOT VALID;
ALTER TABLE intelligence.research_briefs VALIDATE CONSTRAINT chk_brief_taxonomy_summary_required;

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