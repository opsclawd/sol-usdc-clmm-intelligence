import type { NewsEvidencePayload } from "../../contracts/news-events.js";
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

const DEGRADATION_FACTORS = {
  unconfirmed: 0.6,
  partial: 0.75,
  paywalled: 0.8,
  conflicting: 0.6,
  stale: 0.5
} as const;

const CONFIDENCE_CAP = 0.69;

export interface NewsEnrichmentInput {
  readonly payload: NewsEvidencePayload;
  readonly source: "crypto-news-api" | "regulatory-monitor-api";
  readonly rawId: number;
  readonly nowMs: number;
  readonly codeVersion: string;
  readonly runId: string | null;
}

export interface EnrichedNewsEvidenceObservation {
  readonly payload: NewsEvidencePayload;
  readonly payloadHash: string;
  readonly freshness: Freshness;
  readonly confidence: Confidence;
  readonly provenance: Provenance;
}

export const NEWS_CONFIDENCE_WEIGHTING_VERSION = "news-confidence-v1" as const;

function computeDataCompleteness(payload: NewsEvidencePayload): number {
  let presentCount = 0;
  const totalCount = 4;

  if (payload.sourceReferences.length > 0) presentCount++;
  if (payload.topicTags.length > 0) presentCount++;
  if (payload.factualSummary.length > 0) presentCount++;
  if (payload.extractedClaims.length > 0) presentCount++;

  return presentCount / totalCount;
}

function computeDegradationFactor(payload: NewsEvidencePayload): number {
  let factor = 1.0;

  if (payload.sourceQuality.confirmation === "unconfirmed") {
    factor *= DEGRADATION_FACTORS.unconfirmed;
  }

  if (payload.sourceQuality.completeness === "partial") {
    factor *= DEGRADATION_FACTORS.partial;
  }

  if (payload.sourceQuality.isPaywalled) {
    factor *= DEGRADATION_FACTORS.paywalled;
  }

  if (payload.warnings.includes("stale_observation")) {
    factor *= DEGRADATION_FACTORS.stale;
  }

  if (payload.corroborationState === "conflicting") {
    factor *= DEGRADATION_FACTORS.conflicting;
  }

  return factor;
}

function buildNewsProvenance(input: NewsEnrichmentInput, payloadHash: string): Provenance {
  const rawRef: ProvenanceRef = {
    refType: "raw_observation",
    id: input.rawId,
    source: input.source,
    payloadHash
  };

  const processRef: ProcessRef = {
    collector: "sol-usdc-clmm-intelligence",
    jobName: "news-evidence",
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

export async function enrichNewsEvidence(
  input: NewsEnrichmentInput
): Promise<EnrichedNewsEvidenceObservation> {
  const entry = getObservationKindEntry(input.payload.evidenceKind);

  const freshness = computeFreshness(
    {
      observedAtUnixMs: input.payload.asOfUnixMs,
      fetchedAtUnixMs: input.payload.retrievedAtUnixMs,
      receivedAtUnixMs: input.nowMs
    },
    entry.freshnessPolicy,
    input.nowMs,
    input.payload.evidenceKind
  );

  const dataCompleteness = computeDataCompleteness(input.payload);
  const degradationFactor = computeDegradationFactor(input.payload);

  const staleDegradation = freshness.isStale ? { factor: DEGRADATION_FACTORS.stale } : undefined;

  const confidence = computeConfidence(
    {
      sourceReliability: input.payload.sourceQuality.reliability,
      dataCompleteness,
      derivationConfidence: 1,
      llmConfidence: null
    },
    entry.confidencePolicy,
    NEWS_CONFIDENCE_WEIGHTING_VERSION,
    staleDegradation
  );

  let finalConfidence = confidence;
  let wasCapped = false;

  if (degradationFactor < 1.0) {
    const degradedScore = confidence.compositeScore * degradationFactor;
    if (degradedScore < confidence.compositeScore) {
      const additionalReasons = ["contextual_source_quality_cap_applied"] as const;
      finalConfidence = computeConfidence(
        {
          sourceReliability: input.payload.sourceQuality.reliability,
          dataCompleteness,
          derivationConfidence: 1,
          llmConfidence: null
        },
        entry.confidencePolicy,
        NEWS_CONFIDENCE_WEIGHTING_VERSION,
        staleDegradation,
        additionalReasons
      );
      const cappedScore = Math.min(degradedScore, CONFIDENCE_CAP);
      finalConfidence = {
        ...finalConfidence,
        compositeScore: cappedScore,
        level:
          cappedScore >= entry.confidencePolicy.thresholds.highAtOrAbove
            ? ("high" as const)
            : cappedScore < entry.confidencePolicy.thresholds.lowBelow
              ? ("low" as const)
              : ("medium" as const)
      };
      wasCapped = true;
    }
  }

  if (finalConfidence.compositeScore > CONFIDENCE_CAP) {
    const additionalReasons = wasCapped
      ? finalConfidence.reasons
      : ([...finalConfidence.reasons, "contextual_source_quality_cap_applied"] as const);
    const cappedScore = CONFIDENCE_CAP;
    finalConfidence = {
      ...finalConfidence,
      compositeScore: cappedScore,
      level:
        cappedScore >= entry.confidencePolicy.thresholds.highAtOrAbove
          ? ("high" as const)
          : cappedScore < entry.confidencePolicy.thresholds.lowBelow
            ? ("low" as const)
            : ("medium" as const),
      reasons: additionalReasons
    };
  }

  const warnings = [...input.payload.warnings];
  if (freshness.isStale && !warnings.includes("stale_observation")) {
    warnings.push("stale_observation");
  }

  const enrichedPayload: NewsEvidencePayload = {
    ...input.payload,
    warnings
  };

  const { payloadHash } = await canonicalizePayload(enrichedPayload);

  const provenance = buildNewsProvenance(input, payloadHash);

  const provenanceResult = validateProvenance(
    provenance,
    entry.provenanceRequirements,
    input.payload.evidenceKind
  );

  if (!provenanceResult.valid) {
    throw new Error(`Provenance validation failed: ${provenanceResult.reasons.join(", ")}`);
  }

  return {
    payload: enrichedPayload,
    payloadHash,
    freshness,
    confidence: finalConfidence,
    provenance
  };
}
