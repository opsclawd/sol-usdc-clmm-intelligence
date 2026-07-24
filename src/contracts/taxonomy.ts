export type EvidenceFamily =
  | "clmm_state"
  | "price_quality"
  | "clmm_economics"
  | "execution_safety"
  | "market_regime"
  | "support_resistance"
  | "on_chain_flow"
  | "perp_liquidation"
  | "macro_protocol_risk";

export type SignalClass = "deterministic" | "probabilistic" | "contextual";

export type ConfidenceLevel = "low" | "medium" | "high";

export type StaleBehavior = "exclude" | "degrade_confidence" | "allow_context_only";

export type ObservationKind =
  | "pool_state"
  | "position_state"
  | "oracle_price"
  | "executable_quote"
  | "fee_metrics"
  | "volume_metrics"
  | "trigger_event"
  | "data_quality"
  | "pool_statistics"
  | "support_resistance_level"
  | "scheduled_event"
  | "protocol_incident";

export type FeatureKind =
  | "range_location"
  | "distance_to_lower"
  | "distance_to_upper"
  | "oracle_dex_divergence"
  | "oracle_confidence_width"
  | "realized_volatility_1h"
  | "volume_liquidity_ratio_24h";

export type Source =
  | "clmm-v2-bundle"
  | "jupiter-price"
  | "jupiter-price-v3"
  | "coingecko"
  | "defillama"
  | "pyth-hermes"
  | "jupiter-quote"
  | "orca-public-api"
  | "technical-analysis-api"
  | "macro-calendar-api"
  | "solana-status-api";

export type ParseStatus = "pending" | "parsed" | "failed";

export type ProvenanceRefType =
  | "raw_observation"
  | "normalized_observation"
  | "derived_feature"
  | "evidence_bundle"
  | "research_brief";

export interface ProvenanceRef {
  readonly refType: ProvenanceRefType;
  readonly id: number;
  readonly source: Source;
  readonly payloadHash: string;
}

export interface ProcessRef {
  readonly collector: string;
  readonly jobName: string;
  readonly pipelineRunId: string | null;
  readonly codeVersion: string | null;
  readonly modelVersion: string | null;
}

export interface Provenance {
  readonly sourceRefs: readonly ProvenanceRef[];
  readonly rawObservationRefs: readonly ProvenanceRef[];
  readonly derivedFromRefs: readonly ProvenanceRef[];
  readonly processRef: ProcessRef;
  readonly codeVersion: string;
  readonly runId: string | null;
}

export interface ConfidenceComponents {
  readonly sourceReliability: number;
  readonly dataCompleteness: number;
  readonly derivationConfidence: number;
  readonly llmConfidence: number | null;
}

export interface ConfidenceWeights {
  readonly sourceReliability: number;
  readonly dataCompleteness: number;
  readonly derivationConfidence: number;
  readonly llmConfidence: number;
}

export interface ConfidenceThresholds {
  readonly lowBelow: number;
  readonly highAtOrAbove: number;
}

export interface ConfidencePolicy {
  readonly weights: ConfidenceWeights;
  readonly thresholds: ConfidenceThresholds;
  readonly redistributeLlmWeight: boolean;
}

export type ConfidenceReason =
  | "llm_weight_redistributed"
  | "source_reliability_low"
  | "data_completeness_low"
  | "derivation_confidence_low"
  | "stale_input_degraded"
  | "required_component_missing"
  | "llm_confidence_required_but_null"
  | "oracle_confidence_wide"
  | "high_price_impact"
  | "contextual_source_quality_cap_applied";

export interface Confidence {
  readonly components: ConfidenceComponents;
  readonly compositeScore: number;
  readonly level: ConfidenceLevel;
  readonly weightingVersion: string;
  readonly reasons: readonly ConfidenceReason[];
}

export interface FreshnessPolicy {
  readonly maxObservedAgeMs: number;
  readonly maxFetchLagMs: number | null;
  readonly validForMs: number | null;
  readonly clockSkewToleranceMs: number;
  readonly staleBehavior: StaleBehavior;
}

export type FreshnessReason =
  | "expired_past_max_observed_age"
  | "expired_past_valid_for"
  | "expired_past_source_valid_until"
  | "fetch_lag_exceeded"
  | "clock_skew_violation";

export interface Freshness {
  readonly isStale: boolean;
  readonly validUntilUnixMs: number;
  readonly derivedAt: number;
  readonly policyKind: ObservationKind | FeatureKind;
  readonly reasons: readonly FreshnessReason[];
}

export interface ProvenanceRequirements {
  readonly minRawObservationRefs: number;
  readonly minDerivedFromRefs: number;
  readonly minSourceRefs: number;
  readonly requireProcessRef: boolean;
  readonly requireCodeVersion: boolean;
  readonly requireRunId: boolean;
  readonly allowedSourceRefs: readonly Source[];
}

export type ProvenanceValidationError =
  | "insufficient_raw_observation_refs"
  | "insufficient_derived_from_refs"
  | "insufficient_source_refs"
  | "missing_process_ref"
  | "missing_code_version"
  | "missing_run_id"
  | "disallowed_source"
  | "empty_provenance"
  | "malformed_ref"
  | "invalid_provenance_shape";

export type ProvenanceValidationResult =
  | { valid: true }
  | { valid: false; reasons: readonly ProvenanceValidationError[] };

export interface ObservationKindEntry {
  readonly kind: ObservationKind;
  readonly evidenceFamily: EvidenceFamily;
  readonly signalClass: SignalClass;
  readonly freshnessPolicy: FreshnessPolicy;
  readonly confidencePolicy: ConfidencePolicy;
  readonly provenanceRequirements: ProvenanceRequirements;
  readonly active: boolean;
  readonly schemaVersion: number;
}

export interface FeatureKindEntry {
  readonly kind: FeatureKind;
  readonly evidenceFamily: EvidenceFamily;
  readonly signalClass: SignalClass;
  readonly freshnessPolicy: FreshnessPolicy;
  readonly confidencePolicy: ConfidencePolicy;
  readonly provenanceRequirements: ProvenanceRequirements;
  readonly active: boolean;
  readonly schemaVersion: number;
}

export interface TaxonomySummary {
  readonly families: Partial<Record<EvidenceFamily, number>>;
  readonly dominantClass: SignalClass;
}
