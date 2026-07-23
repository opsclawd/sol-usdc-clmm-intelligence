import type {
  ObservationKind,
  EvidenceFamily,
  SignalClass,
  Source,
  Confidence,
  Freshness,
  Provenance
} from "../../contracts/taxonomy.js";
import { getObservationKindEntry } from "../taxonomy/registry.js";
import { computeFreshness } from "../taxonomy/freshness.js";
import { computeConfidence } from "../taxonomy/confidence.js";
import { validateProvenance } from "../taxonomy/provenance.js";
import { canonicalizePayload } from "../content-hash.js";
import type {
  ScheduledEventPayloadV1,
  ProtocolIncidentPayloadV1
} from "../../contracts/context-events.js";

export interface EnrichedContextEventObservation {
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

const COLLECTOR = "context-events-collector";
const JOB_NAME = "context-events-intelligence";
const CONTEXTUAL_COMPLETENESS_VERSION = "context-events-completeness-v1" as const;

const SEVERITY_WEIGHT: Record<string, number> = {
  CRITICAL: 1.0,
  HIGH: 0.8,
  MEDIUM: 0.5,
  LOW: 0.2
};

function computeDataCompleteness(completeness: "complete" | "partial"): number {
  return completeness === "complete" ? 1.0 : 0.5;
}

function buildProvenance(
  rawId: number,
  source: Source,
  payloadHash: string,
  codeVersion: string,
  runId: string | null
): Provenance {
  const rawRef = {
    refType: "raw_observation" as const,
    id: rawId,
    source,
    payloadHash
  };

  return {
    sourceRefs: [rawRef],
    rawObservationRefs: [rawRef],
    derivedFromRefs: [],
    processRef: {
      collector: COLLECTOR,
      jobName: JOB_NAME,
      pipelineRunId: runId,
      codeVersion,
      modelVersion: null
    },
    codeVersion,
    runId
  };
}

async function enrichEvent(
  payload: ScheduledEventPayloadV1 | ProtocolIncidentPayloadV1,
  source: "macro-calendar-api" | "solana-status-api",
  rawId: number,
  nowMs: number,
  codeVersion: string,
  runId: string | null
): Promise<EnrichedContextEventObservation> {
  const kind = payload.eventType as ObservationKind;
  const entry = getObservationKindEntry(kind);

  const { payloadCanonical, payloadHash } = await canonicalizePayload(payload);

  const freshness = computeFreshness(
    {
      observedAtUnixMs: payload.rawProvenance.sourceObservedAtUnixMs,
      fetchedAtUnixMs: payload.rawProvenance.retrievedAtUnixMs,
      receivedAtUnixMs: payload.rawProvenance.retrievedAtUnixMs
    },
    entry.freshnessPolicy,
    nowMs,
    kind
  );

  const dataCompleteness = computeDataCompleteness(payload.sourceQuality.completeness);

  const severityWeight = SEVERITY_WEIGHT[payload.severity] ?? 0.5;
  const reliabilityScore = payload.sourceQuality.reliability * severityWeight;

  const confidence = computeConfidence(
    {
      sourceReliability: reliabilityScore,
      dataCompleteness,
      derivationConfidence: 1,
      llmConfidence: null
    },
    entry.confidencePolicy,
    CONTEXTUAL_COMPLETENESS_VERSION
  );

  const provenance = buildProvenance(rawId, source, payloadHash, codeVersion, runId);

  const provenanceResult = validateProvenance(provenance, entry.provenanceRequirements, kind);

  if (!provenanceResult.valid) {
    throw new Error(
      `Provenance validation failed for ${kind}: ${provenanceResult.reasons.join(", ")}`
    );
  }

  return {
    id: rawId,
    source,
    payloadCanonical,
    payloadHash,
    receivedAtUnixMs: payload.rawProvenance.retrievedAtUnixMs,
    fetchedAtUnixMs: payload.rawProvenance.retrievedAtUnixMs,
    observedAtUnixMs: payload.rawProvenance.sourceObservedAtUnixMs,
    kind,
    evidenceFamily: entry.evidenceFamily,
    signalClass: entry.signalClass,
    confidence,
    freshness,
    provenance
  };
}

export async function enrichContextEvent(input: {
  payload: ScheduledEventPayloadV1 | ProtocolIncidentPayloadV1;
  source: "macro-calendar-api" | "solana-status-api";
  rawId: number;
  nowMs: number;
  codeVersion: string;
  runId: string | null;
}): Promise<EnrichedContextEventObservation> {
  return enrichEvent(
    input.payload,
    input.source,
    input.rawId,
    input.nowMs,
    input.codeVersion,
    input.runId
  );
}
