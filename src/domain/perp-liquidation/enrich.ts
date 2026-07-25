import type {
  ObservationKind,
  EvidenceFamily,
  SignalClass,
  Source,
  Confidence,
  Freshness,
  Provenance,
  ProvenanceRef,
  ProcessRef,
  StaleBehavior,
  ConfidenceComponents
} from "../../contracts/taxonomy.js";
import type { PerpObservationPayloadV1 } from "../../contracts/perp-liquidation.js";
import { getObservationKindEntry } from "../taxonomy/registry.js";
import { computeFreshness } from "../taxonomy/freshness.js";
import { computeConfidence } from "../taxonomy/confidence.js";
import { validateProvenance } from "../taxonomy/provenance.js";
import { canonicalizePayload } from "../content-hash.js";

export interface EnrichPerpObservationInput {
  readonly rawObservationId: number;
  readonly source: Source;
  readonly payload: PerpObservationPayloadV1;
  readonly observedAtUnixMs: number;
  readonly fetchedAtUnixMs: number;
  readonly receivedAtUnixMs: number;
  readonly nowMs: number;
  readonly codeVersion: string;
  readonly runId: string | null;
  readonly collector?: string;
  readonly jobName?: string;
}

export interface EnrichedPerpObservation {
  readonly rawObservationId: number;
  readonly source: Source;
  readonly observationKind: ObservationKind;
  readonly signalClass: SignalClass;
  readonly evidenceFamily: EvidenceFamily;
  readonly payload: PerpObservationPayloadV1;
  readonly payloadCanonical: string;
  readonly payloadHash: string;
  readonly confidence: Confidence;
  readonly validUntilUnixMs: number;
  readonly isStale: boolean;
  readonly staleBehavior: StaleBehavior | null;
  readonly freshness: Freshness;
  readonly provenance: Provenance;
  readonly receivedAtUnixMs: number;
  readonly fetchedAtUnixMs: number;
  readonly observedAtUnixMs: number;
}

export async function enrichPerpObservation(
  input: EnrichPerpObservationInput
): Promise<EnrichedPerpObservation> {
  const {
    rawObservationId,
    source,
    payload,
    observedAtUnixMs,
    fetchedAtUnixMs,
    receivedAtUnixMs,
    nowMs,
    codeVersion,
    runId,
    collector = "perp-liquidation-collector",
    jobName = "perp-liquidation-enrichment"
  } = input;

  const observationKind = payload.kind;
  const entry = getObservationKindEntry(observationKind);
  const { freshnessPolicy, confidencePolicy, provenanceRequirements } = entry;

  const freshness = computeFreshness(
    {
      observedAtUnixMs,
      fetchedAtUnixMs,
      receivedAtUnixMs
    },
    freshnessPolicy,
    nowMs,
    observationKind
  );

  const baseComponents: ConfidenceComponents = {
    sourceReliability: 1.0,
    dataCompleteness: 1.0,
    derivationConfidence: 1.0,
    llmConfidence: null
  };

  const isDegradeStale =
    freshness.isStale && freshnessPolicy.staleBehavior === "degrade_confidence";
  const staleDegradation = isDegradeStale ? { factor: 0.5 } : undefined;

  let confidence = computeConfidence(
    baseComponents,
    confidencePolicy,
    "perp-confidence-v1",
    staleDegradation
  );

  if (isDegradeStale && confidence.level === "high") {
    confidence = {
      ...confidence,
      level: "medium"
    };
  }

  const { payloadCanonical, payloadHash } = await canonicalizePayload(payload);

  const rawRef: ProvenanceRef = {
    refType: "raw_observation",
    id: rawObservationId,
    source,
    payloadHash
  };

  const processRef: ProcessRef = {
    collector,
    jobName,
    pipelineRunId: runId,
    codeVersion,
    modelVersion: null
  };

  const provenance: Provenance = {
    sourceRefs: [rawRef],
    rawObservationRefs: [rawRef],
    derivedFromRefs: [],
    processRef,
    codeVersion,
    runId
  };

  const provenanceResult = validateProvenance(provenance, provenanceRequirements, observationKind);

  if (!provenanceResult.valid) {
    throw new Error(
      `Provenance validation failed for ${observationKind}: ${provenanceResult.reasons.join(", ")}`
    );
  }

  return {
    rawObservationId,
    source,
    observationKind,
    signalClass: entry.signalClass,
    evidenceFamily: entry.evidenceFamily,
    payload,
    payloadCanonical,
    payloadHash,
    confidence,
    validUntilUnixMs: freshness.validUntilUnixMs,
    isStale: freshness.isStale,
    staleBehavior: freshnessPolicy.staleBehavior,
    freshness,
    provenance,
    receivedAtUnixMs,
    fetchedAtUnixMs,
    observedAtUnixMs
  };
}
