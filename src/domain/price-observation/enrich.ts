import type {
  OraclePricePayloadV1,
  ExecutableQuotePayloadV1
} from "../../contracts/normalized-price-observation.js";
import type {
  Source,
  ObservationKind,
  SignalClass,
  EvidenceFamily,
  Confidence,
  StaleBehavior,
  Provenance,
  ConfidenceComponents,
  ConfidenceReason
} from "../../contracts/taxonomy.js";
import { canonicalizePayload } from "../content-hash.js";
import { computeFreshness } from "../taxonomy/freshness.js";
import { computeConfidence } from "../taxonomy/confidence.js";
import { getObservationKindEntry } from "../taxonomy/registry.js";

export interface EnrichPriceObservationInput {
  readonly rawObservationId: number;
  readonly source: "pyth-hermes" | "jupiter-price" | "jupiter-price-v3" | "jupiter-quote";
  readonly sourceObservationKey: string;
  readonly payloadHash: string;
  readonly observedAtUnixMs: number;
  readonly fetchedAtUnixMs: number;
  readonly receivedAtUnixMs: number;
  readonly payload: OraclePricePayloadV1 | ExecutableQuotePayloadV1;
  readonly nowMs: number;
  readonly codeVersion: string;
  readonly pipelineRunId: string;
  readonly collector?: string;
  readonly jobName?: string;
}

function deriveSourceReliabilityDegradation(
  payload: OraclePricePayloadV1 | ExecutableQuotePayloadV1
): { sourceReliability: number; reasons: ConfidenceReason[] } {
  const reasons: ConfidenceReason[] = [];

  if (payload.kind === "oracle_price") {
    const ratioBps = parseInt(payload.confidenceRatio, 10);
    if (ratioBps > 100) {
      const degradation = Math.min(1, 100 / ratioBps);
      reasons.push("oracle_confidence_wide");
      return { sourceReliability: degradation, reasons };
    }
  } else if (payload.kind === "executable_quote") {
    const impactBps = parseInt(payload.priceImpactRatio, 10);
    if (impactBps > 100) {
      const degradation = Math.min(1, 100 / impactBps);
      reasons.push("high_price_impact");
      return { sourceReliability: degradation, reasons };
    }
  }

  return { sourceReliability: 1, reasons };
}

export interface EnrichedPriceObservation {
  readonly rawObservationId: number;
  readonly source: Source;
  readonly observationKind: ObservationKind;
  readonly signalClass: SignalClass;
  readonly evidenceFamily: EvidenceFamily;
  readonly payload: unknown;
  readonly payloadHash: string;
  readonly confidence: Confidence;
  readonly confidenceComposite: string;
  readonly confidenceLevel: string;
  readonly validUntilUnixMs: number;
  readonly isStale: boolean;
  readonly staleBehavior: StaleBehavior | null;
  readonly provenance: Provenance;
  readonly receivedAtUnixMs: number;
}

export async function enrichPriceObservation(
  input: EnrichPriceObservationInput
): Promise<EnrichedPriceObservation> {
  const {
    rawObservationId,
    source,
    sourceObservationKey: _sourceObservationKey,
    payloadHash: _rawPayloadHash,
    observedAtUnixMs,
    fetchedAtUnixMs,
    receivedAtUnixMs,
    payload,
    nowMs,
    codeVersion,
    pipelineRunId,
    collector = "unknown-collector",
    jobName = "unknown-job"
  } = input;
  void _sourceObservationKey;
  void _rawPayloadHash;

  const observationKind = payload.kind;
  const entry = getObservationKindEntry(observationKind);
  const { freshnessPolicy, confidencePolicy } = entry;

  let freshnessTimestamps: {
    observedAtUnixMs: number;
    fetchedAtUnixMs: number;
    receivedAtUnixMs: number;
    sourceValidUntilUnixMs?: number;
  };

  if (source === "pyth-hermes" || source === "jupiter-price" || source === "jupiter-price-v3") {
    freshnessTimestamps = {
      observedAtUnixMs,
      fetchedAtUnixMs,
      receivedAtUnixMs,
      sourceValidUntilUnixMs: observedAtUnixMs + freshnessPolicy.maxObservedAgeMs
    };
  } else {
    freshnessTimestamps = {
      observedAtUnixMs: receivedAtUnixMs,
      fetchedAtUnixMs,
      receivedAtUnixMs,
      sourceValidUntilUnixMs: receivedAtUnixMs + freshnessPolicy.maxObservedAgeMs
    };
  }

  const freshness = computeFreshness(freshnessTimestamps, freshnessPolicy, nowMs, observationKind);

  const { sourceReliability, reasons: degradationReasons } =
    deriveSourceReliabilityDegradation(payload);

  const baseComponents: ConfidenceComponents = {
    sourceReliability,
    dataCompleteness: 1.0,
    derivationConfidence: 1.0,
    llmConfidence: null
  };

  const staleDegradation =
    freshness.isStale && freshnessPolicy.staleBehavior === "degrade_confidence"
      ? { factor: 0.5 }
      : undefined;

  const confidence = computeConfidence(
    baseComponents,
    confidencePolicy,
    "v1",
    staleDegradation,
    degradationReasons
  );

  const { payloadHash: canonicalPayloadHash } = await canonicalizePayload(payload);

  const provenance = {
    sourceRefs: [
      {
        refType: "raw_observation" as const,
        id: rawObservationId,
        source,
        payloadHash: canonicalPayloadHash
      }
    ],
    rawObservationRefs: [
      {
        refType: "raw_observation" as const,
        id: rawObservationId,
        source,
        payloadHash: canonicalPayloadHash
      }
    ],
    derivedFromRefs: [] as readonly {
      refType: "derived_feature";
      id: number;
      source: Source;
      payloadHash: string;
    }[],
    processRef: {
      collector,
      jobName,
      pipelineRunId,
      codeVersion,
      modelVersion: null as string | null
    },
    codeVersion,
    runId: pipelineRunId
  };

  return {
    rawObservationId,
    source,
    observationKind,
    signalClass: entry.signalClass,
    evidenceFamily: entry.evidenceFamily,
    payload,
    payloadHash: canonicalPayloadHash,
    confidence,
    confidenceComposite: String(confidence.compositeScore),
    confidenceLevel: confidence.level,
    validUntilUnixMs: freshness.validUntilUnixMs,
    isStale: freshness.isStale,
    staleBehavior: freshnessPolicy.staleBehavior,
    provenance,
    receivedAtUnixMs
  };
}
