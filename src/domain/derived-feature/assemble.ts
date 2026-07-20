import type {
  FeatureKind,
  ProvenanceRef,
  Confidence,
  ConfidenceReason
} from "../../contracts/taxonomy.js";
import type { NormalizedObservationRow } from "../../ports/normalized-observation-repo.js";
import type { DerivedFeatureV1, FeatureStatus } from "../../contracts/derived-feature.js";
import { canonicalHash } from "../content-hash.js";

export interface FeatureCalculation {
  readonly status: FeatureStatus;
  readonly value: number | null;
  readonly warnings: readonly string[];
  readonly reasons: readonly string[];
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface AssembledFeature {
  readonly result: DerivedFeatureV1;
  readonly derivationKey: string;
  readonly payloadHash: string;
}

export interface AssembleFeatureInput {
  readonly featureKind: FeatureKind;
  readonly status: FeatureStatus;
  readonly value: number | null;
  readonly unit: "BPS" | "PPM";
  readonly pair: "SOL/USDC";
  readonly poolId: string | null;
  readonly positionId: string | null;
  readonly asOfUnixMs: number;
  readonly expiresAtUnixMs: number;
  readonly confidence: Confidence;
  readonly freshness: {
    readonly isStale: boolean;
    readonly validUntilUnixMs: number;
    readonly derivedAt: number;
    readonly policyKind: string;
    readonly reasons: readonly string[];
  };
  readonly inputObservationIds: readonly number[];
  readonly rejectedObservationIds: readonly number[];
  readonly provenance: {
    readonly sourceRefs: readonly ProvenanceRef[];
    readonly rawObservationRefs: readonly ProvenanceRef[];
    readonly derivedFromRefs: readonly ProvenanceRef[];
    readonly processRef: {
      readonly collector: string;
      readonly jobName: string;
      readonly pipelineRunId: string | null;
      readonly codeVersion: string | null;
      readonly modelVersion: string | null;
    };
    readonly codeVersion: string;
    readonly runId: string | null;
  };
  readonly warnings: readonly string[];
  readonly reasons: readonly string[];
  readonly calculatorVersion: string;
  readonly selectionVersion: string;
  readonly calculationMetadata: Readonly<Record<string, unknown>>;
}

export interface AssembleDerivedFeatureOptions {
  readonly input: AssembleFeatureInput;
  readonly selectedRows: readonly NormalizedObservationRow[];
  readonly rejectedRows: readonly NormalizedObservationRow[];
  readonly evaluationAsOfUnixMs: number;
  readonly runId: string;
  readonly codeVersion: string;
}

function computeComponentWiseMinima(selectedRows: readonly NormalizedObservationRow[]): {
  sourceReliability: number;
  dataCompleteness: number;
  derivationConfidence: number;
  llmConfidence: number | null;
} {
  if (selectedRows.length === 0) {
    return {
      sourceReliability: 1,
      dataCompleteness: 1,
      derivationConfidence: 1,
      llmConfidence: null
    };
  }
  let minSourceReliability = Infinity;
  let minDataCompleteness = Infinity;
  let minDerivationConfidence = Infinity;
  let minLlmConfidence: number | null = null;

  for (const row of selectedRows) {
    const components = row.confidence?.components;
    if (components) {
      if (components.sourceReliability < minSourceReliability) {
        minSourceReliability = components.sourceReliability;
      }
      if (components.dataCompleteness < minDataCompleteness) {
        minDataCompleteness = components.dataCompleteness;
      }
      if (components.derivationConfidence < minDerivationConfidence) {
        minDerivationConfidence = components.derivationConfidence;
      }
      if (components.llmConfidence !== null) {
        if (minLlmConfidence === null || components.llmConfidence < minLlmConfidence) {
          minLlmConfidence = components.llmConfidence;
        }
      }
    }
  }

  return {
    sourceReliability: minSourceReliability === Infinity ? 1 : minSourceReliability,
    dataCompleteness: minDataCompleteness === Infinity ? 1 : minDataCompleteness,
    derivationConfidence: minDerivationConfidence === Infinity ? 1 : minDerivationConfidence,
    llmConfidence: minLlmConfidence
  };
}

const DEFAULT_CONFIDENCE_WEIGHTS = {
  sourceReliability: 0.4,
  dataCompleteness: 0.3,
  derivationConfidence: 0.3,
  llmConfidence: 0.0
};

const PARTIAL_DEGRADATION_FACTOR = 0.9;

function computeMinimumExpiry(
  selectedRows: readonly NormalizedObservationRow[],
  status: FeatureStatus,
  evaluationAsOfUnixMs: number
): number {
  if (status === "UNAVAILABLE") {
    return evaluationAsOfUnixMs;
  }
  if (selectedRows.length === 0) {
    return evaluationAsOfUnixMs;
  }
  let earliest: number | null = null;
  for (const row of selectedRows) {
    const validUntil = row.validUntilUnixMs;
    if (validUntil !== null) {
      if (earliest === null || validUntil < earliest) {
        earliest = validUntil;
      }
    }
  }
  return earliest ?? evaluationAsOfUnixMs;
}

function buildLineage(
  selectedRows: readonly NormalizedObservationRow[],
  rejectedRows: readonly NormalizedObservationRow[]
): {
  sourceRefs: ProvenanceRef[];
  rawObservationRefs: ProvenanceRef[];
} {
  const allRows = [...selectedRows, ...rejectedRows];

  const normalizedRefMap = new Map<number, ProvenanceRef>();
  const rawRefMap = new Map<number, ProvenanceRef>();

  for (const row of allRows) {
    if (!normalizedRefMap.has(row.id)) {
      normalizedRefMap.set(row.id, {
        refType: "normalized_observation",
        id: row.id,
        source: row.source,
        payloadHash: row.payloadHash
      });
    }

    if (!rawRefMap.has(row.rawObservationId)) {
      let payloadHash = `raw-hash-${row.rawObservationId}`;
      const rawRef = row.provenance.rawObservationRefs.find(
        (ref) => ref.id === row.rawObservationId
      );
      if (rawRef) {
        payloadHash = rawRef.payloadHash;
      }
      rawRefMap.set(row.rawObservationId, {
        refType: "raw_observation",
        id: row.rawObservationId,
        source: row.source,
        payloadHash
      });
    }
  }

  const sourceRefs = Array.from(normalizedRefMap.values()).sort((a, b) => a.id - b.id);
  const rawObservationRefs = Array.from(rawRefMap.values()).sort((a, b) => a.id - b.id);

  return { sourceRefs, rawObservationRefs };
}

function buildConfidence(
  status: FeatureStatus,
  inputConfidence: Confidence,
  componentMinima: {
    sourceReliability: number;
    dataCompleteness: number;
    derivationConfidence: number;
    llmConfidence: number | null;
  }
): Confidence {
  if (status === "UNAVAILABLE") {
    const components = {
      sourceReliability: inputConfidence.components.sourceReliability,
      dataCompleteness: inputConfidence.components.dataCompleteness,
      derivationConfidence: 0,
      llmConfidence: inputConfidence.components.llmConfidence
    };
    const compositeScore = 0;
    const level: Confidence["level"] = "low";
    const reasons: ConfidenceReason[] = ["required_component_missing"];
    return {
      components,
      compositeScore,
      level,
      weightingVersion: inputConfidence.weightingVersion,
      reasons
    };
  }

  const effectiveWeights = { ...DEFAULT_CONFIDENCE_WEIGHTS };

  if (componentMinima.llmConfidence === null) {
    if (effectiveWeights.llmConfidence > 0) {
      const remainingTotal =
        effectiveWeights.sourceReliability +
        effectiveWeights.dataCompleteness +
        effectiveWeights.derivationConfidence;
      if (remainingTotal > 0) {
        const scale = 1 / (1 - effectiveWeights.llmConfidence);
        effectiveWeights.sourceReliability *= scale;
        effectiveWeights.dataCompleteness *= scale;
        effectiveWeights.derivationConfidence *= scale;
        effectiveWeights.llmConfidence = 0;
      }
    }
  }

  let rawComposite =
    componentMinima.sourceReliability * effectiveWeights.sourceReliability +
    componentMinima.dataCompleteness * effectiveWeights.dataCompleteness +
    componentMinima.derivationConfidence * effectiveWeights.derivationConfidence;

  if (componentMinima.llmConfidence !== null && effectiveWeights.llmConfidence > 0) {
    rawComposite += componentMinima.llmConfidence * effectiveWeights.llmConfidence;
  } else {
    const nonZeroDenom =
      effectiveWeights.sourceReliability +
      effectiveWeights.dataCompleteness +
      effectiveWeights.derivationConfidence;
    if (nonZeroDenom > 0) {
      rawComposite = rawComposite / nonZeroDenom;
    }
  }

  if (status === "PARTIAL") {
    rawComposite = rawComposite * PARTIAL_DEGRADATION_FACTOR;
  }

  const level: Confidence["level"] =
    rawComposite >= 0.7 ? "high" : rawComposite < 0.4 ? "low" : "medium";

  return {
    components: { ...inputConfidence.components },
    compositeScore: rawComposite,
    level,
    weightingVersion: inputConfidence.weightingVersion,
    reasons: [...inputConfidence.reasons]
  };
}

async function computeDerivationKey(
  featureKind: FeatureKind,
  status: FeatureStatus,
  poolId: string | null,
  positionId: string | null,
  calculatorVersion: string,
  selectionVersion: string,
  codeVersion: string,
  inputObservationIds: readonly number[],
  rejectedObservationIds: readonly number[],
  reasons: readonly string[]
): Promise<string> {
  const identity = {
    schemaVersion: 1,
    featureKind,
    status,
    poolId,
    positionId,
    calculatorVersion,
    selectionVersion,
    codeVersion,
    inputObservationIds: [...inputObservationIds].sort((a, b) => a - b),
    rejectedObservationIds: [...rejectedObservationIds].sort((a, b) => a - b),
    reasons: [...reasons].sort()
  };
  const hash = await canonicalHash(identity);
  return `dk-${hash}`;
}

export async function assembleDerivedFeature(
  options: AssembleDerivedFeatureOptions
): Promise<AssembledFeature> {
  const { input, selectedRows, rejectedRows, evaluationAsOfUnixMs, runId, codeVersion } = options;

  if (input.status === "AVAILABLE" || input.status === "PARTIAL") {
    if (selectedRows.length === 0) {
      throw new Error(`Cannot assemble ${input.status} feature with no selectedRows`);
    }
    const selectedIds = new Set(selectedRows.map((r) => r.id));
    for (const id of input.inputObservationIds) {
      if (!selectedIds.has(id)) {
        throw new Error(`inputObservationIds contains ${id} which is not in selectedRows`);
      }
    }
  }

  const componentMinima = computeComponentWiseMinima(selectedRows);
  const expiresAtUnixMs = computeMinimumExpiry(selectedRows, input.status, evaluationAsOfUnixMs);
  const lineage = buildLineage(selectedRows, rejectedRows);

  const confidence = buildConfidence(input.status, input.confidence, componentMinima);

  const processRef = {
    collector: "deterministic-feature-derivation",
    jobName: "derive-mvp-features",
    pipelineRunId: runId,
    codeVersion: codeVersion,
    modelVersion: null
  };

  const result: DerivedFeatureV1 = {
    schemaVersion: 1,
    featureKind: input.featureKind,
    status: input.status,
    value: input.value,
    unit: input.unit,
    pair: input.pair,
    poolId: input.poolId,
    positionId: input.positionId,
    asOfUnixMs: input.asOfUnixMs,
    expiresAtUnixMs,
    confidence: {
      components: {
        sourceReliability: confidence.components.sourceReliability,
        dataCompleteness: confidence.components.dataCompleteness,
        derivationConfidence: confidence.components.derivationConfidence,
        llmConfidence: confidence.components.llmConfidence
      },
      compositeScore: confidence.compositeScore,
      level: confidence.level,
      weightingVersion: confidence.weightingVersion,
      reasons: [...confidence.reasons]
    },
    freshness: {
      isStale: input.freshness.isStale,
      validUntilUnixMs: expiresAtUnixMs,
      derivedAt: input.freshness.derivedAt,
      policyKind: input.freshness.policyKind,
      reasons: [...input.freshness.reasons]
    },
    inputObservationIds: [...input.inputObservationIds].sort((a, b) => a - b),
    rejectedObservationIds: [...input.rejectedObservationIds].sort((a, b) => a - b),
    provenance: {
      sourceRefs: [...lineage.sourceRefs],
      rawObservationRefs: [...lineage.rawObservationRefs],
      derivedFromRefs: [...input.provenance.derivedFromRefs],
      processRef,
      codeVersion,
      runId
    },
    warnings: [...input.warnings].sort(),
    reasons: [...input.reasons].sort(),
    calculatorVersion: input.calculatorVersion,
    selectionVersion: input.selectionVersion,
    calculationMetadata: input.calculationMetadata
  };

  const derivationKey = await computeDerivationKey(
    input.featureKind,
    input.status,
    input.poolId,
    input.positionId,
    input.calculatorVersion,
    input.selectionVersion,
    codeVersion,
    input.inputObservationIds,
    input.rejectedObservationIds,
    input.reasons
  );

  const payloadHash = await canonicalHash(result);

  return {
    result,
    derivationKey,
    payloadHash
  };
}
