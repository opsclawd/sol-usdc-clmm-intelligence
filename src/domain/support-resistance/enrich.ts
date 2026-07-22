import type { SupportResistancePayloadV1 } from "../../contracts/support-resistance.js";
import type {
  Confidence,
  Freshness,
  Provenance,
  ProvenanceRef,
  ProcessRef
} from "../../contracts/taxonomy.js";
import { getObservationKindEntry } from "../taxonomy/registry.js";
import { computeFreshness } from "../taxonomy/freshness.js";
import { computeConfidence } from "../taxonomy/confidence.js";
import { validateProvenance } from "../taxonomy/provenance.js";
import { canonicalizePayload } from "../content-hash.js";

export interface SupportResistanceEnrichmentInput {
  readonly payload: SupportResistancePayloadV1;
  readonly nowMs: number;
  readonly codeVersion: string;
  readonly runId: string | null;
  readonly rawId: number;
  readonly sourceValidUntilUnixMs?: number;
}

export interface EnrichedSupportResistanceObservation {
  readonly payload: SupportResistancePayloadV1;
  readonly payloadHash: string;
  readonly freshness: Freshness;
  readonly confidence: Confidence;
  readonly provenance: Provenance;
}

export const COMPLETENESS_WEIGHTING_VERSION = "support-resistance-completeness-v1" as const;

function computeDataCompleteness(payload: SupportResistancePayloadV1): number {
  let presentCount = 0;
  let totalCount = 0;

  if (payload.sourceReferences.length > 0) {
    presentCount++;
  }
  totalCount++;

  if (payload.invalidationConditions.length > 0) {
    presentCount++;
  }
  totalCount++;

  if (payload.thesisCodes.length > 0) {
    presentCount++;
  }
  totalCount++;

  if (totalCount === 0) return 1;
  return presentCount / totalCount;
}

function buildDirectProvenance(input: SupportResistanceEnrichmentInput): Provenance {
  const rawRef: ProvenanceRef = {
    refType: "raw_observation",
    id: input.rawId,
    source: "technical-analysis-api",
    payloadHash: ""
  };

  const processRef: ProcessRef = {
    collector: "http-support-resistance-source",
    jobName: "support-resistance-enrichment",
    pipelineRunId: input.runId,
    codeVersion: input.codeVersion,
    modelVersion: null
  };

  return {
    sourceRefs: [rawRef],
    rawObservationRefs: [rawRef],
    derivedFromRefs: [],
    processRef,
    codeVersion: input.codeVersion,
    runId: input.runId
  };
}

export async function enrichSupportResistanceClaim(
  input: SupportResistanceEnrichmentInput
): Promise<EnrichedSupportResistanceObservation> {
  const entry = getObservationKindEntry("support_resistance_level");

  const { payloadHash } = await canonicalizePayload(input.payload);

  const freshness = computeFreshness(
    {
      observedAtUnixMs: input.payload.asOfUnixMs,
      fetchedAtUnixMs: input.payload.asOfUnixMs,
      receivedAtUnixMs: input.nowMs,
      sourceValidUntilUnixMs: input.sourceValidUntilUnixMs
    },
    entry.freshnessPolicy,
    input.nowMs,
    "support_resistance_level"
  );

  const dataCompleteness = computeDataCompleteness(input.payload);

  const staleDegradation = freshness.isStale ? { factor: 0.5 } : undefined;

  const confidence = computeConfidence(
    {
      sourceReliability: input.payload.sourceQuality.reliability,
      dataCompleteness,
      derivationConfidence: 1,
      llmConfidence: null
    },
    entry.confidencePolicy,
    COMPLETENESS_WEIGHTING_VERSION,
    staleDegradation
  );

  const compositeCap = Math.min(input.payload.sourceQuality.reliability, dataCompleteness);
  let finalConfidence = confidence;
  if (confidence.compositeScore > compositeCap) {
    const additionalReasons = ["contextual_source_quality_cap_applied"] as const;
    finalConfidence = computeConfidence(
      {
        sourceReliability: input.payload.sourceQuality.reliability,
        dataCompleteness,
        derivationConfidence: 1,
        llmConfidence: null
      },
      entry.confidencePolicy,
      COMPLETENESS_WEIGHTING_VERSION,
      staleDegradation,
      additionalReasons
    );
    finalConfidence = {
      ...finalConfidence,
      compositeScore: compositeCap
    };
  }

  const provenance = buildDirectProvenance(input);
  provenance.sourceRefs[0]!.payloadHash = payloadHash;

  const provenanceResult = validateProvenance(
    provenance,
    entry.provenanceRequirements,
    "support_resistance_level"
  );

  if (!provenanceResult.valid) {
    throw new Error(`Provenance validation failed: ${provenanceResult.reasons.join(", ")}`);
  }

  const warnings = [...input.payload.warnings];
  if (freshness.isStale && !warnings.includes("stale_observation")) {
    warnings.push("stale_observation");
  }

  const enrichedPayload: SupportResistancePayloadV1 = {
    ...input.payload,
    warnings
  };

  return {
    payload: enrichedPayload,
    payloadHash,
    freshness,
    confidence: finalConfidence,
    provenance
  };
}
