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
import type { NetworkStatusPayloadV1 } from "../../contracts/normalized-network-status.js";

export interface EnrichNetworkStatusInput {
  readonly rawObservationId: number;
  readonly sourceObservationKey: string;
  readonly rawPayloadHash: string;
  readonly observedAtUnixMs: number;
  readonly fetchedAtUnixMs: number;
  readonly receivedAtUnixMs: number;
  readonly payload: NetworkStatusPayloadV1;
  readonly nowMs: number;
  readonly codeVersion: string;
  readonly runId: string | null;
}

export interface EnrichedNetworkStatusObservation {
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
  input: EnrichNetworkStatusInput,
  source: Source,
  collector: string,
  jobName: string
): Provenance {
  const rawRef: ProvenanceRef = {
    refType: "raw_observation",
    id: input.rawObservationId,
    source,
    payloadHash: input.rawPayloadHash
  };

  const processRef: ProcessRef = {
    collector,
    jobName,
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

export async function enrichNetworkStatus(
  input: EnrichNetworkStatusInput
): Promise<EnrichedNetworkStatusObservation> {
  const source: Source = "solana-rpc";
  const collector = "collect-solana-network-status";
  const jobName = "core-collection-job";

  const entry = getObservationKindEntry("network_status");

  const freshness = computeFreshness(
    {
      observedAtUnixMs: input.observedAtUnixMs,
      fetchedAtUnixMs: input.fetchedAtUnixMs,
      receivedAtUnixMs: input.receivedAtUnixMs
    },
    entry.freshnessPolicy,
    input.nowMs,
    "network_status"
  );

  const { payloadCanonical, payloadHash } = await canonicalizePayload(input.payload);

  const dataCompleteness = input.payload.slot !== null ? 1.0 : 0.7;

  const confidence = computeConfidence(
    {
      sourceReliability: 0.95,
      dataCompleteness,
      derivationConfidence: 1.0,
      llmConfidence: null
    },
    entry.confidencePolicy,
    "network-status-completeness-v1",
    freshness.isStale ? { factor: 0.5 } : undefined
  );

  const provenance = buildDirectProvenance(input, source, collector, jobName);

  const provenanceResult = validateProvenance(
    provenance,
    entry.provenanceRequirements,
    "network_status"
  );

  if (!provenanceResult.valid) {
    throw new Error(
      `Provenance validation failed for network_status: ${provenanceResult.reasons.join(", ")}`
    );
  }

  return {
    id: input.rawObservationId,
    source,
    payloadCanonical,
    payloadHash,
    receivedAtUnixMs: input.receivedAtUnixMs,
    fetchedAtUnixMs: input.fetchedAtUnixMs,
    observedAtUnixMs: input.observedAtUnixMs,
    kind: "network_status",
    evidenceFamily: entry.evidenceFamily,
    signalClass: entry.signalClass,
    confidence,
    freshness,
    provenance
  };
}
