import type {
  ObservationKind,
  EvidenceFamily,
  SignalClass,
  Source,
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
import type { PoolStatisticsPayloadV1 } from "../../contracts/normalized-pool-statistics.js";

export interface PoolStatisticsEnrichmentCandidate {
  readonly id: number;
  readonly source: Source;
  readonly payloadHash: string;
  readonly receivedAtUnixMs: number;
  readonly fetchedAtUnixMs: number;
  readonly observedAtUnixMs: number;
  readonly kind: ObservationKind;
  readonly payload: PoolStatisticsPayloadV1;
}

export interface EnrichPoolStatisticsInput {
  readonly candidate: PoolStatisticsEnrichmentCandidate;
  readonly nowMs: number;
  readonly codeVersion: string;
  readonly runId: string | null;
}

export interface EnrichedPoolStatisticsObservation {
  readonly id: number;
  readonly source: Source;
  readonly payloadCanonical: string;
  readonly payloadHash: string;
  readonly receivedAtUnixMs: number;
  readonly fetchedAtUnixMs: number;
  readonly observedAtUnixMs: number;
  readonly kind: ObservationKind;
  readonly evidenceFamily: EvidenceFamily;
  readonly signalClass: SignalClass;
  readonly confidence: Confidence;
  readonly freshness: Freshness;
  readonly provenance: Provenance;
}

function buildDirectProvenance(
  candidate: PoolStatisticsEnrichmentCandidate,
  codeVersion: string,
  runId: string | null,
  collector: string,
  jobName: string
): Provenance {
  const rawRef: ProvenanceRef = {
    refType: "raw_observation",
    id: candidate.id,
    source: candidate.source,
    payloadHash: candidate.payloadHash
  };

  const processRef: ProcessRef = {
    collector,
    jobName,
    pipelineRunId: runId,
    codeVersion,
    modelVersion: null
  };

  return {
    sourceRefs: [rawRef],
    rawObservationRefs: [rawRef],
    derivedFromRefs: [],
    processRef,
    codeVersion,
    runId
  };
}

export async function enrichPoolStatistics(
  input: EnrichPoolStatisticsInput
): Promise<EnrichedPoolStatisticsObservation> {
  const { candidate, nowMs, codeVersion, runId } = input;
  const collector = "orca-public-api";
  const jobName = "orca-pool-statistics-enrichment";

  const entry = getObservationKindEntry("pool_statistics");

  const freshness = computeFreshness(
    {
      observedAtUnixMs: candidate.observedAtUnixMs,
      fetchedAtUnixMs: candidate.fetchedAtUnixMs,
      receivedAtUnixMs: candidate.receivedAtUnixMs
    },
    entry.freshnessPolicy,
    nowMs,
    "pool_statistics"
  );

  // Clone/update the payload warnings to include stale_observation if stale
  const warnings = [...candidate.payload.warnings];
  if (freshness.isStale && !warnings.includes("stale_observation")) {
    warnings.push("stale_observation");
    warnings.sort();
  }

  const updatedPayload: PoolStatisticsPayloadV1 = {
    ...candidate.payload,
    warnings
  };

  const { payloadCanonical, payloadHash } = await canonicalizePayload(updatedPayload);

  let presentCount = 0;
  if (updatedPayload.tvlUsdc !== null) presentCount++;
  if (updatedPayload.volume24hUsdc !== null) presentCount++;
  if (updatedPayload.fees24hUsdc !== null) presentCount++;
  const dataCompleteness = presentCount / 3;

  const confidence = computeConfidence(
    {
      sourceReliability: updatedPayload.sourceQuality.providerWarning ? 0.75 : 1.0,
      dataCompleteness,
      derivationConfidence: 1.0,
      llmConfidence: null
    },
    entry.confidencePolicy,
    "pool-statistics-completeness-v1",
    freshness.isStale ? { factor: 0.5 } : undefined
  );

  const provenance = buildDirectProvenance(candidate, codeVersion, runId, collector, jobName);

  const provenanceResult = validateProvenance(
    provenance,
    entry.provenanceRequirements,
    "pool_statistics"
  );

  if (!provenanceResult.valid) {
    throw new Error(
      `Provenance validation failed for pool_statistics: ${provenanceResult.reasons.join(", ")}`
    );
  }

  return {
    id: candidate.id,
    source: candidate.source,
    payloadCanonical,
    payloadHash,
    receivedAtUnixMs: candidate.receivedAtUnixMs,
    fetchedAtUnixMs: candidate.fetchedAtUnixMs,
    observedAtUnixMs: candidate.observedAtUnixMs,
    kind: "pool_statistics",
    evidenceFamily: entry.evidenceFamily,
    signalClass: entry.signalClass,
    confidence,
    freshness,
    provenance
  };
}
