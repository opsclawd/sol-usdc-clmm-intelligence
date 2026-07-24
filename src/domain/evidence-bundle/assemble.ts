import type {
  EvidenceBundleV1,
  DeterministicFeature,
  SourceReference,
  ContextualEvidence,
  EventClaim
} from "../../contracts/generated/evidence-bundle-v1.js";
import type { SelectedFeatureSlot } from "./select.js";
import type { EvidenceBundleQuality } from "./quality.js";
import type { VerifiedEvidenceLineage } from "./lineage.js";
import type { FeatureKind } from "../../contracts/taxonomy.js";
import { MVP_FEATURE_KINDS } from "../../contracts/derived-feature.js";
import type { SelectedContextEvent } from "../context-events/select.js";
import type {
  ScheduledEventPayloadV1,
  ProtocolIncidentPayloadV1
} from "../../contracts/context-events.js";

export const EVIDENCE_BUNDLE_ASSEMBLE_VERSION = "mvp-evidence-bundle-assemble/v1";

export interface AssembleEvidenceBundleInput {
  readonly slots: readonly SelectedFeatureSlot[];
  readonly quality: EvidenceBundleQuality;
  readonly lineage: VerifiedEvidenceLineage["lineage"];
  readonly runId: string;
  readonly correlationId: string;
  readonly poolId: string;
  readonly positionId: string;
  readonly walletId: string;
  readonly createdAt: number;
  readonly asOf: number;
  readonly freshUntil: number;
  readonly expiresAt: number;
  readonly contextPresent: boolean;
  readonly briefPresent: boolean;
  readonly pipelineVersion: string;
  readonly gitCommit: string;
  readonly environment: "production" | "staging" | "development" | "test";
  readonly contextualEvents: readonly SelectedContextEvent[];
}

type FeatureFamily =
  | "market_state"
  | "price_quality"
  | "clmm_economics"
  | "position_state"
  | "liquidity"
  | "risk";

const PPM_KINDS: readonly FeatureKind[] = [
  "range_location",
  "distance_to_lower",
  "distance_to_upper",
  "volume_liquidity_ratio_24h"
];

function mapFeatureKindToFamily(featureKind: FeatureKind): FeatureFamily {
  switch (featureKind) {
    case "range_location":
    case "distance_to_lower":
    case "distance_to_upper":
      return "position_state";
    case "oracle_dex_divergence":
    case "oracle_confidence_width":
      return "price_quality";
    case "realized_volatility_1h":
      return "market_state";
    case "volume_liquidity_ratio_24h":
      return "liquidity";
    default:
      return "risk";
  }
}

function mapFeatureKindToKind(featureKind: FeatureKind): "number" | "boolean" | "category" {
  switch (featureKind) {
    case "range_location":
    case "distance_to_lower":
    case "distance_to_upper":
    case "oracle_dex_divergence":
    case "oracle_confidence_width":
    case "realized_volatility_1h":
    case "volume_liquidity_ratio_24h":
      return "number";
    default:
      return "number";
  }
}

function mapFeatureKindToUnit(featureKind: FeatureKind): "basis_points" | "percent" {
  if (PPM_KINDS.includes(featureKind)) {
    return "percent";
  }
  return "basis_points";
}

function normalizeWarnings(warnings: readonly string[]): string[] {
  return [...new Set(warnings)].sort();
}

function getWarningsFromSlot(slot: SelectedFeatureSlot): readonly string[] {
  if ("warnings" in slot) {
    return slot.warnings;
  }
  return [];
}

function getRowIdFromSlot(slot: SelectedFeatureSlot): number {
  if ("rowId" in slot) {
    return slot.rowId;
  }
  return 0;
}

function getAsOfUnixMsFromSlot(slot: SelectedFeatureSlot): number | null {
  if ("asOfUnixMs" in slot) {
    return slot.asOfUnixMs;
  }
  return null;
}

function getValidUntilUnixMsFromSlot(slot: SelectedFeatureSlot): number | null {
  if ("validUntilUnixMs" in slot) {
    return slot.validUntilUnixMs;
  }
  return null;
}

function buildDeterministicFeature(
  slot: SelectedFeatureSlot,
  featureKind: FeatureKind
): DeterministicFeature {
  const family = mapFeatureKindToFamily(featureKind);
  const featureKindType = mapFeatureKindToKind(featureKind);
  const rowId = getRowIdFromSlot(slot);
  const warnings = getWarningsFromSlot(slot);
  const asOfUnixMs = getAsOfUnixMsFromSlot(slot);
  const validUntilUnixMs = getValidUntilUnixMsFromSlot(slot);
  const unit = mapFeatureKindToUnit(featureKind);

  if (slot.outcome === "missing") {
    const result = {
      featureId: `feat-${featureKind}-missing`,
      family,
      featureKind: featureKindType,
      status: "unavailable" as const,
      value: null,
      unit: null,
      observedAt: null,
      freshUntil: null,
      confidenceBps: 0,
      calculator: {
        name: "mvp-calculator",
        version: "1.0"
      },
      inputLineage: ["missing"] as [string, ...string[]],
      warnings: ["missing_slot"] as [string, ...string[]]
    };
    return result as DeterministicFeature;
  }

  const normalizedWarnings = normalizeWarnings([...warnings]);
  const baseFeature = {
    featureId: `feat-${featureKind}-${rowId}`,
    family,
    featureKind: featureKindType,
    calculator: {
      name: "mvp-calculator",
      version: "1.0"
    },
    inputLineage: [`row-${rowId}`] as [string, ...string[]]
  };

  if (slot.outcome === "selected_available" || slot.outcome === "selected_partial") {
    const result = {
      ...baseFeature,
      status: "available" as const,
      value: slot.value,
      unit: unit,
      observedAt: asOfUnixMs !== null ? String(asOfUnixMs) : null,
      freshUntil: validUntilUnixMs !== null ? String(validUntilUnixMs) : null,
      confidenceBps: slot.confidence.compositeScore,
      warnings: normalizedWarnings.slice(0, 16) as [string, ...string[]]
    };
    return result as DeterministicFeature;
  }

  if (slot.outcome === "selected_unavailable") {
    const unavailableWarnings: [string, ...string[]] =
      normalizedWarnings.length > 0
        ? (normalizedWarnings.slice(0, 16) as [string, ...string[]])
        : (["unavailable"] as [string, ...string[]]);
    const result = {
      ...baseFeature,
      status: "unavailable" as const,
      value: null,
      unit: null,
      observedAt: null,
      freshUntil: null,
      confidenceBps: 0,
      warnings: unavailableWarnings
    };
    return result as DeterministicFeature;
  }

  const expiredWarnings: [string, ...string[]] =
    normalizedWarnings.length > 0
      ? (normalizedWarnings.slice(0, 16) as [string, ...string[]])
      : (["slot_unavailable"] as [string, ...string[]]);
  const result = {
    ...baseFeature,
    status: "unavailable" as const,
    value: null,
    unit: null,
    observedAt: null,
    freshUntil: null,
    confidenceBps: 0,
    warnings: expiredWarnings
  };
  return result as DeterministicFeature;
}

function buildContextualEvidence(
  contextualEvents: readonly SelectedContextEvent[]
): ContextualEvidence {
  const events: EventClaim[] = contextualEvents.map((selectedEvent): EventClaim => {
    const { row, payload } = selectedEvent;
    const typedPayload = payload as ScheduledEventPayloadV1 | ProtocolIncidentPayloadV1;

    let kind: "scheduled_event" | "protocol_incident" | "network_incident";
    if (typedPayload.eventType === "scheduled_event") {
      kind = "scheduled_event";
    } else if (typedPayload.eventType === "protocol_incident") {
      kind = "protocol_incident";
    } else {
      kind = "network_incident";
    }

    const claim = `${typedPayload.status}: ${typedPayload.title} — ${typedPayload.description}`;

    return {
      evidenceId:
        `normalized-${row.id}` as import("../../contracts/generated/evidence-bundle-v1.js").Identifier128,
      kind,
      claim,
      direction: "unknown" as const,
      confidenceBps: Math.round(row.confidence.compositeScore * 10000),
      observedAt: String(
        typedPayload.asOfUnixMs
      ) as import("../../contracts/generated/evidence-bundle-v1.js").CanonicalTimestamp,
      expiresAt: String(
        typedPayload.expiresAtUnixMs
      ) as import("../../contracts/generated/evidence-bundle-v1.js").CanonicalTimestamp,
      sourceReferenceIds: [`raw-${row.rawObservationId}`] as [
        import("../../contracts/generated/evidence-bundle-v1.js").Identifier128,
        ...import("../../contracts/generated/evidence-bundle-v1.js").Identifier128[]
      ],
      provenanceMethod: "collected" as const
    };
  });

  return {
    supportResistance: [],
    flows: [],
    derivatives: [],
    events,
    newsRegulatory: []
  };
}

function buildSourceReferences(lineage: VerifiedEvidenceLineage["lineage"]): SourceReference[] {
  const refs: SourceReference[] = [];

  for (const ref of lineage.sourceReferences) {
    refs.push({
      referenceId:
        ref.referenceId as import("../../contracts/generated/evidence-bundle-v1.js").Identifier128,
      sourceType: ref.sourceType,
      locator: ref.locator,
      observedAt: ref.observedAt
    });
  }

  if (refs.length === 0) {
    refs.push({
      referenceId:
        "no_sources_available" as import("../../contracts/generated/evidence-bundle-v1.js").Identifier128,
      sourceType: "internal_bundle",
      locator: "no_sources_available",
      observedAt:
        "0" as import("../../contracts/generated/evidence-bundle-v1.js").CanonicalTimestamp
    });
  }

  return refs;
}

function buildBundleAssessment(quality: EvidenceBundleQuality) {
  return {
    overallConfidenceBps: quality.overallConfidenceBps,
    quality: quality.quality,
    coverage: quality.coverage,
    warnings: quality.warnings.map((w) => ({
      code: w.code as import("../../contracts/generated/evidence-bundle-v1.js").Identifier128,
      message: w.message,
      affectedFamilies: [...w.affectedFamilies]
    }))
  };
}

function buildBundleProvenance(
  input: AssembleEvidenceBundleInput,
  lineage: VerifiedEvidenceLineage["lineage"]
) {
  return {
    pipelineVersion:
      input.pipelineVersion as import("../../contracts/generated/evidence-bundle-v1.js").Identifier128,
    gitCommit: input.gitCommit as import("../../contracts/generated/evidence-bundle-v1.js").Hex64,
    environment: input.environment,
    upstreamRunIds: lineage.rawObservationIds.map(
      (id) => String(id) as import("../../contracts/generated/evidence-bundle-v1.js").Identifier128
    )
  };
}

export function assembleEvidenceBundleCandidate(
  input: AssembleEvidenceBundleInput
): EvidenceBundleV1 {
  const {
    slots,
    quality,
    lineage,
    runId,
    correlationId,
    poolId,
    positionId,
    walletId,
    createdAt,
    asOf,
    freshUntil,
    expiresAt,
    contextualEvents
  } = input;

  const deterministicFeatures: DeterministicFeature[] = MVP_FEATURE_KINDS.map(
    (featureKind, index) => {
      const slot = slots[index];
      if (!slot || slot.featureKind !== featureKind) {
        const missingSlot: SelectedFeatureSlot = { featureKind, outcome: "missing" };
        return buildDeterministicFeature(missingSlot, featureKind);
      }
      return buildDeterministicFeature(slot, featureKind);
    }
  );

  const scope = {
    kind: "position" as const,
    network: "solana-mainnet" as const,
    walletAddress: walletId,
    whirlpoolAddress: poolId,
    positionId: positionId
  };

  const source = {
    publisher: "sol-usdc-clmm-intelligence" as const,
    sourceId:
      "source-001" as import("../../contracts/generated/evidence-bundle-v1.js").Identifier128,
    sourceVersion:
      "1.0.0" as import("../../contracts/generated/evidence-bundle-v1.js").Identifier128
  };

  const contextualEvidence = buildContextualEvidence(contextualEvents);

  const researchBrief = input.briefPresent ? null : null;

  return {
    schemaVersion: "evidence-bundle.v1",
    pair: "SOL/USDC",
    scope,
    source,
    runId: runId as import("../../contracts/generated/evidence-bundle-v1.js").Identifier256,
    correlationId:
      correlationId as import("../../contracts/generated/evidence-bundle-v1.js").Identifier256,
    createdAt: String(createdAt),
    asOf: String(asOf),
    freshUntil: String(freshUntil),
    expiresAt: String(expiresAt),
    deterministicFeatures: deterministicFeatures as [
      DeterministicFeature,
      ...DeterministicFeature[]
    ],
    contextualEvidence,
    researchBrief,
    sourceReferences: buildSourceReferences(lineage) as [SourceReference, ...SourceReference[]],
    assessment: buildBundleAssessment(quality),
    provenance: buildBundleProvenance(input, lineage)
  };
}
