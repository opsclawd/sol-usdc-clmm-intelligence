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
import type { ClmmNormalizedCandidate } from "../../contracts/normalized-clmm-observation.js";

export interface ClmmEnrichmentCandidate {
  readonly id: number;
  readonly source: Source;
  readonly payloadHash: string;
  readonly receivedAtUnixMs: number;
  readonly fetchedAtUnixMs: number;
  readonly observedAtUnixMs: number;
  readonly kind: ObservationKind;
  readonly payload: ClmmNormalizedCandidate;
}

export interface EnrichmentInput {
  readonly candidates: readonly ClmmEnrichmentCandidate[];
  readonly nowMs: number;
  readonly codeVersion: string;
  readonly runId: string | null;
}

export interface EnrichedClmmObservation {
  readonly id: number;
  readonly source: Source;
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

export const COMPLETENESS_WEIGHTING_VERSION = "clmm-bundle-completeness-v1" as const;

export const ENRICHED_CLMM_OBSERVATION_KIND_COMPLETENESS_FIELDS: Record<
  ObservationKind,
  readonly string[]
> = {
  pool_state: ["currentPrice", "sqrtPrice", "tickCurrentIndex", "feeRate", "poolLiquidity"],
  position_state: [
    "rangeState",
    "lowerTick",
    "upperTick",
    "currentTick",
    "positionLiquidity",
    "poolLiquidity"
  ],
  price_quote: ["price", "priceLabel", "quotedAt"],
  fee_metrics: [
    "feeOwedA",
    "feeOwedB",
    "unclaimedRewards",
    "unclaimedFeesUsd",
    "unclaimedRewardsUsd"
  ],
  volume_metrics: ["volume24h", "volume7d", "volume30d"],
  trigger_event: ["triggerId", "positionId", "breachDirection", "triggeredAt"],
  data_quality: ["warnings", "isPartial", "missingSources"]
};

function computeDataCompleteness(kind: ObservationKind, payload: ClmmNormalizedCandidate): number {
  const fields = ENRICHED_CLMM_OBSERVATION_KIND_COMPLETENESS_FIELDS[kind];
  if (!fields || fields.length === 0) return 1;

  let presentCount = 0;
  for (const field of fields) {
    const value = (payload as unknown as Record<string, unknown>)[field];
    if (value !== null && value !== undefined) {
      presentCount++;
    }
  }
  return presentCount / fields.length;
}

function buildDirectProvenance(
  candidate: ClmmEnrichmentCandidate,
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

export function enrichClmmCandidates(input: EnrichmentInput): readonly EnrichedClmmObservation[] {
  const { candidates, nowMs, codeVersion, runId } = input;
  const collector = "clmm-v2-bundle";
  const jobName = "clmm-intelligence-enrichment";

  return candidates.map((candidate) => {
    const entry = getObservationKindEntry(candidate.kind);

    const freshness = computeFreshness(
      {
        observedAtUnixMs: candidate.observedAtUnixMs,
        fetchedAtUnixMs: candidate.fetchedAtUnixMs,
        receivedAtUnixMs: candidate.receivedAtUnixMs
      },
      entry.freshnessPolicy,
      nowMs,
      candidate.kind
    );

    const dataCompleteness = computeDataCompleteness(candidate.kind, candidate.payload);

    const confidence = computeConfidence(
      {
        sourceReliability: 1,
        dataCompleteness,
        derivationConfidence: 1,
        llmConfidence: null
      },
      entry.confidencePolicy,
      COMPLETENESS_WEIGHTING_VERSION
    );

    const provenance = buildDirectProvenance(candidate, codeVersion, runId, collector, jobName);

    const provenanceResult = validateProvenance(
      provenance,
      entry.provenanceRequirements,
      candidate.kind
    );

    if (!provenanceResult.valid) {
      throw new Error(
        `Provenance validation failed for ${candidate.kind}: ${provenanceResult.reasons.join(", ")}`
      );
    }

    return {
      id: candidate.id,
      source: candidate.source,
      payloadHash: candidate.payloadHash,
      receivedAtUnixMs: candidate.receivedAtUnixMs,
      fetchedAtUnixMs: candidate.fetchedAtUnixMs,
      observedAtUnixMs: candidate.observedAtUnixMs,
      kind: candidate.kind,
      evidenceFamily: entry.evidenceFamily,
      signalClass: entry.signalClass,
      confidence,
      freshness,
      provenance
    };
  });
}
