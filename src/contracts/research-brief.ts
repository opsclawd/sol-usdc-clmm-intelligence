import type { ProvenanceRef } from "./taxonomy.js";

export type ResearchBriefGenerationStatus = "complete" | "degraded";

export type SupportsCurrentRegime = "supports" | "contradicts" | "unclear" | "not_applicable";

export type ResearchBriefDegradationReason =
  | "missing_inputs"
  | "stale_data"
  | "low_confidence_inputs"
  | "conflicting_evidence"
  | "model_error"
  | "schema_validation_failed";

export interface LlmResearchBriefOutput {
  readonly summary: string;
  readonly keyTakeaways: readonly string[];
  readonly supportsCurrentRegime: SupportsCurrentRegime;
  readonly regimeAssessmentReasoning: string;
  readonly confidenceScore: number;
  readonly confidenceReasoning: string;
  readonly sourceEvidenceIds: readonly string[];
  readonly unsupportedOrMissingInputs: readonly string[];
  readonly degradationReason?: ResearchBriefDegradationReason;
}

export interface ResearchBriefProviderMetadata {
  readonly provider: string;
  readonly model: string;
  readonly temperature?: number;
}

export interface ResearchBriefSourceBundleRef {
  readonly bundleId: string | number;
  readonly bundleHash: string;
}

export interface ResearchBriefPriorBriefRef {
  readonly briefId: string | number;
  readonly payloadHash: string;
}

export interface PersistedResearchBrief {
  readonly briefId: string;
  readonly pair: "SOL/USDC";
  readonly generationStatus: ResearchBriefGenerationStatus;
  readonly llmOutput: LlmResearchBriefOutput;
  readonly sourceRefs: readonly ProvenanceRef[];
  readonly providerMetadata: ResearchBriefProviderMetadata;
  readonly sourceBundleRef: ResearchBriefSourceBundleRef;
  readonly inputContextHash: string;
  readonly priorBriefRef: ResearchBriefPriorBriefRef | null;
  readonly generatedAt: string;
  readonly promptVersion: string;
}
