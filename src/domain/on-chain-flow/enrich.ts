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
import type { OnChainFlowPayloadV1, CexFlowProxyPayloadV1 } from "../../contracts/on-chain-flow.js";

export interface OnChainFlowEnrichmentCandidate {
  readonly id: number;
  readonly source: Source;
  readonly payload: OnChainFlowPayloadV1;
  readonly observedAtUnixMs: number;
  readonly receivedAtUnixMs: number;
  readonly fetchedAtUnixMs: number;
}

export interface EnrichmentInput {
  readonly candidates: readonly OnChainFlowEnrichmentCandidate[];
  readonly nowMs: number;
  readonly codeVersion: string;
  readonly runId: string | null;
}

export interface EnrichedOnChainFlowObservation {
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

export const ON_CHAIN_FLOW_CONFIDENCE_WEIGHTING_VERSION = "on-chain-flow-confidence-v1" as const;

const CEX_CONFIDENCE_CAP = 0.69;

function isCexFlowProxy(payload: OnChainFlowPayloadV1): payload is CexFlowProxyPayloadV1 {
  return payload.eventType === "cex_flow_proxy";
}

function mapEventTypeToKind(eventType: OnChainFlowPayloadV1["eventType"]): ObservationKind {
  switch (eventType) {
    case "whale_transfer":
      return "whale_transfer";
    case "whale_swap":
      return "whale_swap";
    case "stablecoin_flow":
      return "stablecoin_flow";
    case "dex_net_flow":
      return "dex_net_flow";
    case "cex_flow_proxy":
      return "cex_flow_proxy";
    default:
      throw new Error(`Unknown event type: ${eventType}`);
  }
}

function computeDataCompletenessFromQuality(completeness: "full" | "partial"): number {
  return completeness === "full" ? 1.0 : 0.5;
}

function buildDirectProvenance(
  candidate: OnChainFlowEnrichmentCandidate,
  payloadHash: string,
  codeVersion: string,
  runId: string | null,
  collector: string,
  jobName: string
): Provenance {
  const rawRef: ProvenanceRef = {
    refType: "raw_observation",
    id: candidate.id,
    source: candidate.source,
    payloadHash
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

export async function enrichOnChainFlow(
  input: EnrichmentInput
): Promise<readonly EnrichedOnChainFlowObservation[]> {
  const { candidates, nowMs, codeVersion, runId } = input;
  const collector = "on-chain-flow-collector";
  const jobName = "on-chain-flow-intelligence";

  return Promise.all(
    candidates.map(async (candidate) => {
      const { payloadCanonical, payloadHash } = await canonicalizePayload(candidate.payload);

      const kind = mapEventTypeToKind(candidate.payload.eventType);
      const entry = getObservationKindEntry(kind);

      const freshness = computeFreshness(
        {
          observedAtUnixMs: candidate.observedAtUnixMs,
          fetchedAtUnixMs: candidate.fetchedAtUnixMs,
          receivedAtUnixMs: candidate.receivedAtUnixMs
        },
        entry.freshnessPolicy,
        nowMs,
        kind
      );

      const isCex = isCexFlowProxy(candidate.payload);
      const sourceReliability = isCex ? candidate.payload.attributionConfidence : 1.0;
      const dataCompleteness = computeDataCompletenessFromQuality(
        candidate.payload.sourceQuality.completeness
      );

      let confidence = computeConfidence(
        {
          sourceReliability,
          dataCompleteness,
          derivationConfidence: 1,
          llmConfidence: null
        },
        entry.confidencePolicy,
        ON_CHAIN_FLOW_CONFIDENCE_WEIGHTING_VERSION
      );

      if (isCex && confidence.compositeScore > CEX_CONFIDENCE_CAP) {
        const cappedScore = CEX_CONFIDENCE_CAP;
        const cappedLevel =
          cappedScore >= entry.confidencePolicy.thresholds.highAtOrAbove
            ? "high"
            : cappedScore < entry.confidencePolicy.thresholds.lowBelow
              ? "low"
              : "medium";

        confidence = {
          ...confidence,
          compositeScore: cappedScore,
          level: cappedLevel,
          reasons: [...confidence.reasons, "cex_proxy_quality_cap_applied"]
        };
      }

      const provenance = buildDirectProvenance(
        candidate,
        payloadHash,
        codeVersion,
        runId,
        collector,
        jobName
      );

      const provenanceResult = validateProvenance(provenance, entry.provenanceRequirements, kind);

      if (!provenanceResult.valid) {
        throw new Error(
          `Provenance validation failed for ${kind}: ${provenanceResult.reasons.join(", ")}`
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
        kind,
        evidenceFamily: entry.evidenceFamily,
        signalClass: entry.signalClass,
        confidence,
        freshness,
        provenance
      };
    })
  );
}
