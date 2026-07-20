export const SCHEMA_SHA256 = "0146b073cc607b47e52c615f6299294b1fd8f133d8a4b128bd2a95dc20f77b17";

export type EvidenceBundleV1 = {
  schemaVersion: "evidence-bundle.v1";
  pair: "SOL/USDC";
  scope: Scope;
  source: SourceIdentity;
  runId: string;
  correlationId: string;
  createdAt: string;
  asOf: string;
  freshUntil: string;
  expiresAt: string;
  deterministicFeatures: DeterministicFeature[];
  contextualEvidence: ContextualEvidence;
  researchBrief: ResearchBrief | null;
  sourceReferences: SourceReference[];
  assessment: BundleAssessment;
  provenance: BundleProvenance;
};

export type Scope =
  | { kind: "pair" }
  | { kind: "whirlpool"; network: "solana-mainnet"; whirlpoolAddress: string }
  | { kind: "wallet"; network: "solana-mainnet"; walletAddress: string }
  | {
      kind: "position";
      network: "solana-mainnet";
      walletAddress: string;
      whirlpoolAddress: string;
      positionId: string;
    };

export type SourceIdentity = {
  publisher: "sol-usdc-clmm-intelligence";
  sourceId: string;
  sourceVersion: string;
};

export type DeterministicFeature =
  | DeterministicFeatureAvailableNumber
  | DeterministicFeatureAvailableBoolean
  | DeterministicFeatureAvailableCategory
  | DeterministicFeatureUnavailable
  | DeterministicFeatureInvalid;

export type DeterministicFeatureAvailableNumber = {
  featureId: string;
  family:
    | "market_state"
    | "price_quality"
    | "clmm_economics"
    | "position_state"
    | "liquidity"
    | "risk";
  featureKind: "number";
  status: "available";
  value: number;
  unit:
    | "usd"
    | "sol"
    | "usdc"
    | "percent"
    | "basis_points"
    | "ratio"
    | "seconds"
    | "milliseconds"
    | "count"
    | "price_usdc_per_sol";
  observedAt: string;
  freshUntil: string;
  confidenceBps: number;
  calculator: Calculator;
  inputLineage: string[];
  warnings: string[];
};

export type DeterministicFeatureAvailableBoolean = {
  featureId: string;
  family:
    | "market_state"
    | "price_quality"
    | "clmm_economics"
    | "position_state"
    | "liquidity"
    | "risk";
  featureKind: "boolean";
  status: "available";
  value: boolean;
  unit: "boolean";
  observedAt: string;
  freshUntil: string;
  confidenceBps: number;
  calculator: Calculator;
  inputLineage: string[];
  warnings: string[];
};

export type DeterministicFeatureAvailableCategory = {
  featureId: string;
  family:
    | "market_state"
    | "price_quality"
    | "clmm_economics"
    | "position_state"
    | "liquidity"
    | "risk";
  featureKind: "category";
  status: "available";
  value: string;
  unit: "category";
  observedAt: string;
  freshUntil: string;
  confidenceBps: number;
  calculator: Calculator;
  inputLineage: string[];
  warnings: string[];
};

export type DeterministicFeatureUnavailable = {
  featureId: string;
  family:
    | "market_state"
    | "price_quality"
    | "clmm_economics"
    | "position_state"
    | "liquidity"
    | "risk";
  featureKind: "number" | "boolean" | "category";
  status: "unavailable";
  value: null;
  unit: null;
  observedAt: null;
  freshUntil: null;
  confidenceBps: 0;
  calculator: Calculator;
  inputLineage: string[];
  warnings: string[];
};

export type DeterministicFeatureInvalid = {
  featureId: string;
  family:
    | "market_state"
    | "price_quality"
    | "clmm_economics"
    | "position_state"
    | "liquidity"
    | "risk";
  featureKind: "number" | "boolean" | "category";
  status: "invalid";
  value: null;
  unit: null;
  observedAt: string | null;
  freshUntil: string | null;
  confidenceBps: 0;
  calculator: Calculator;
  inputLineage: string[];
  warnings: string[];
};

export type Calculator = {
  name: string;
  version: string;
};

export type ContextualEvidence = {
  supportResistance: SupportResistanceClaim[];
  flows: FlowClaim[];
  derivatives: DerivativesClaim[];
  events: EventClaim[];
  newsRegulatory: NewsRegulatoryClaim[];
};

export type SupportResistanceClaim = {
  evidenceId: string;
  kind: "support_zone" | "resistance_zone" | "breakout_level";
  claim: string;
  direction: "bullish" | "bearish" | "neutral" | "mixed" | "unknown";
  confidenceBps: number;
  observedAt: string;
  expiresAt: string | null;
  sourceReferenceIds: string[];
  provenanceMethod: "collected" | "derived" | "human_authored";
};

export type FlowClaim = {
  evidenceId: string;
  kind: "spot_flow" | "stablecoin_flow" | "exchange_flow";
  claim: string;
  direction: "bullish" | "bearish" | "neutral" | "mixed" | "unknown";
  confidenceBps: number;
  observedAt: string;
  expiresAt: string | null;
  sourceReferenceIds: string[];
  provenanceMethod: "collected" | "derived" | "human_authored";
};

export type DerivativesClaim = {
  evidenceId: string;
  kind: "funding" | "open_interest" | "liquidation" | "options_skew";
  claim: string;
  direction: "bullish" | "bearish" | "neutral" | "mixed" | "unknown";
  confidenceBps: number;
  observedAt: string;
  expiresAt: string | null;
  sourceReferenceIds: string[];
  provenanceMethod: "collected" | "derived" | "human_authored";
};

export type EventClaim = {
  evidenceId: string;
  kind: "scheduled_event" | "protocol_incident" | "network_incident";
  claim: string;
  direction: "bullish" | "bearish" | "neutral" | "mixed" | "unknown";
  confidenceBps: number;
  observedAt: string;
  expiresAt: string | null;
  sourceReferenceIds: string[];
  provenanceMethod: "collected" | "derived" | "human_authored";
};

export type NewsRegulatoryClaim = {
  evidenceId: string;
  kind: "ecosystem_news" | "regulatory_update";
  claim: string;
  direction: "bullish" | "bearish" | "neutral" | "mixed" | "unknown";
  confidenceBps: number;
  observedAt: string;
  expiresAt: string | null;
  sourceReferenceIds: string[];
  provenanceMethod: "collected" | "derived" | "human_authored";
};

export type ResearchBrief = {
  briefId: string;
  generatedAt: string;
  summary: string;
  keyFindings: string[];
  uncertainties: string[];
  model: ModelInfo;
  promptVersion: string;
  sourceEvidenceIds: string[];
};

export type ModelInfo = {
  provider: string;
  modelId: string;
  modelVersion: string;
};

export type SourceReference = {
  referenceId: string;
  sourceType: "api" | "database" | "chain" | "document" | "internal_bundle";
  locator: string;
  publishedAt: string | null;
  observedAt: string;
  contentHash: string | null;
};

export type BundleAssessment = {
  overallConfidenceBps: number;
  quality: "complete" | "partial" | "degraded";
  coverage: FamilyCoverage;
  warnings: BundleWarning[];
};

export type FamilyCoverage = {
  deterministic: "available" | "partial" | "unavailable" | "not_applicable";
  supportResistance: "available" | "partial" | "unavailable" | "not_applicable";
  flows: "available" | "partial" | "unavailable" | "not_applicable";
  derivatives: "available" | "partial" | "unavailable" | "not_applicable";
  events: "available" | "partial" | "unavailable" | "not_applicable";
  newsRegulatory: "available" | "partial" | "unavailable" | "not_applicable";
  researchBrief: "available" | "partial" | "unavailable" | "not_applicable";
};

export type BundleWarning = {
  code: string;
  message: string;
  affectedFamilies: string[];
};

export type BundleProvenance = {
  pipelineVersion: string;
  gitCommit: string;
  environment: "production" | "staging" | "development" | "test";
  upstreamRunIds: string[];
};
