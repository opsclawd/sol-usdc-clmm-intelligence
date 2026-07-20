import type {
  Source,
  ObservationKind,
  SignalClass,
  EvidenceFamily,
  Provenance,
  Confidence,
  Freshness,
  FeatureKind,
  ConfidenceComponents,
  FreshnessReason,
  ConfidenceReason
} from "../../src/contracts/taxonomy.js";
import type { NormalizedObservationRow } from "../../src/contracts/index.js";
import type { FeatureStatus, DerivedFeatureV1 } from "../../src/contracts/derived-feature.js";
import type { AssembleFeatureInput } from "../../src/domain/derived-feature/assemble.js";
import { SELECTION_VERSION } from "../../src/domain/derived-feature/select.js";

export const DEFAULT_CONFIDENCE: Confidence = {
  components: {
    sourceReliability: 1,
    dataCompleteness: 1,
    derivationConfidence: 1,
    llmConfidence: null
  },
  compositeScore: 1,
  level: "high",
  weightingVersion: "v1",
  reasons: []
};

export const DEFAULT_PROVENANCE: Provenance = {
  sourceRefs: [],
  rawObservationRefs: [],
  derivedFromRefs: [],
  processRef: {
    collector: "deterministic-feature-derivation",
    jobName: "derive-mvp-features",
    pipelineRunId: null,
    codeVersion: null,
    modelVersion: null
  },
  codeVersion: "test-v1",
  runId: null
};

export interface ConfidenceInput {
  sourceReliability?: number;
  dataCompleteness?: number;
  derivationConfidence?: number;
  llmConfidence?: number | null;
}

export function makeConfidence(components: ConfidenceInput, weightingVersion = "v1"): Confidence {
  const comp: ConfidenceComponents = {
    sourceReliability: components.sourceReliability ?? 1,
    dataCompleteness: components.dataCompleteness ?? 1,
    derivationConfidence: components.derivationConfidence ?? 1,
    llmConfidence: components.llmConfidence ?? null
  };
  const compositeScore =
    comp.sourceReliability * 0.4 + comp.dataCompleteness * 0.3 + comp.derivationConfidence * 0.3;
  const level: Confidence["level"] =
    compositeScore >= 0.7 ? "high" : compositeScore < 0.4 ? "low" : "medium";
  return {
    components: comp,
    compositeScore,
    level,
    weightingVersion,
    reasons: [] as readonly ConfidenceReason[]
  };
}

export function makeFreshness(
  isStale: boolean,
  validUntilUnixMs: number,
  derivedAt: number,
  policyKind: FeatureKind = "range_location",
  reasons: readonly string[] = []
): Freshness {
  return {
    isStale,
    validUntilUnixMs,
    derivedAt,
    policyKind,
    reasons: [...reasons] as readonly FreshnessReason[]
  };
}

export function makeNormalizedRow(
  overrides: Partial<NormalizedObservationRow> & {
    id: number;
    source: Source;
    observationKind: ObservationKind;
    receivedAtUnixMs: number;
  }
): NormalizedObservationRow {
  return {
    id: overrides.id,
    rawObservationId: overrides.rawObservationId ?? 0,
    source: overrides.source,
    observationKind: overrides.observationKind,
    signalClass: (overrides.signalClass ?? "deterministic") as SignalClass,
    evidenceFamily: (overrides.evidenceFamily ?? "clmm_state") as EvidenceFamily,
    payload: overrides.payload ?? { price: 100 },
    payloadHash: overrides.payloadHash ?? `hash-${overrides.id}`,
    confidence: overrides.confidence ?? DEFAULT_CONFIDENCE,
    confidenceComposite: overrides.confidenceComposite ?? null,
    confidenceLevel: overrides.confidenceLevel ?? null,
    validUntilUnixMs: overrides.validUntilUnixMs ?? null,
    isStale: overrides.isStale ?? false,
    staleBehavior: overrides.staleBehavior ?? null,
    provenance: overrides.provenance ?? DEFAULT_PROVENANCE,
    receivedAtUnixMs: overrides.receivedAtUnixMs
  };
}

export function makeAssembleInput(
  overrides: Partial<AssembleFeatureInput> & {
    featureKind: FeatureKind;
    status: FeatureStatus;
    value: number | null;
  }
): AssembleFeatureInput {
  return {
    unit: overrides.unit ?? "PPM",
    pair: "SOL/USDC",
    poolId: overrides.poolId ?? null,
    positionId: overrides.positionId ?? null,
    asOfUnixMs: overrides.asOfUnixMs ?? 1000000000000,
    expiresAtUnixMs: overrides.expiresAtUnixMs ?? 1000000060000,
    confidence: overrides.confidence ?? DEFAULT_CONFIDENCE,
    freshness: overrides.freshness ?? makeFreshness(false, 1000000060000, 1000000000000),
    inputObservationIds: overrides.inputObservationIds ?? [],
    rejectedObservationIds: overrides.rejectedObservationIds ?? [],
    provenance: overrides.provenance ?? DEFAULT_PROVENANCE,
    warnings: overrides.warnings ?? [],
    reasons: overrides.reasons ?? [],
    calculatorVersion: overrides.calculatorVersion ?? "1.0.0",
    selectionVersion: overrides.selectionVersion ?? SELECTION_VERSION,
    calculationMetadata: overrides.calculationMetadata ?? {},
    ...overrides
  };
}

export function buildDerivedFeatureV1(overrides: Partial<DerivedFeatureV1> = {}): DerivedFeatureV1 {
  const base: DerivedFeatureV1 = {
    schemaVersion: 1,
    featureKind: "range_location",
    status: "AVAILABLE",
    value: 500000,
    unit: "PPM",
    pair: "SOL/USDC",
    poolId: "pool123",
    positionId: "pos456",
    asOfUnixMs: 1000000000000,
    expiresAtUnixMs: 1000000060000,
    confidence: {
      components: {
        sourceReliability: 1,
        dataCompleteness: 1,
        derivationConfidence: 1,
        llmConfidence: null
      },
      compositeScore: 1,
      level: "high",
      weightingVersion: "v1",
      reasons: [] as string[]
    },
    freshness: {
      isStale: false,
      validUntilUnixMs: 1000000060000,
      derivedAt: 1000000000000,
      policyKind: "range_location",
      reasons: [] as string[]
    },
    inputObservationIds: [1, 2, 3],
    rejectedObservationIds: [] as number[],
    provenance: {
      sourceRefs: [] as Array<{
        id: number;
        source: string;
        payloadHash: string;
        refType:
          | "raw_observation"
          | "normalized_observation"
          | "derived_feature"
          | "evidence_bundle"
          | "research_brief";
      }>,
      rawObservationRefs: [] as Array<{
        id: number;
        source: string;
        payloadHash: string;
        refType:
          | "raw_observation"
          | "normalized_observation"
          | "derived_feature"
          | "evidence_bundle"
          | "research_brief";
      }>,
      derivedFromRefs: [] as Array<{
        id: number;
        source: string;
        payloadHash: string;
        refType:
          | "raw_observation"
          | "normalized_observation"
          | "derived_feature"
          | "evidence_bundle"
          | "research_brief";
      }>,
      processRef: {
        collector: "deterministic-feature-derivation",
        jobName: "derive-mvp-features",
        pipelineRunId: null,
        codeVersion: null,
        modelVersion: null
      },
      codeVersion: "test-v1",
      runId: null
    },
    warnings: [] as string[],
    reasons: [] as string[],
    calculatorVersion: "1.0.0",
    selectionVersion: SELECTION_VERSION,
    calculationMetadata: {}
  };
  return { ...base, ...overrides };
}
