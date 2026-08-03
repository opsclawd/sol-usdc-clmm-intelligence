import type {
  EvidenceBundleV1,
  DeterministicFeature,
  SourceReference,
  ContextualEvidence,
  EventClaim,
  FlowClaim,
  SupportResistanceClaim,
  NewsRegulatoryClaim,
  Identifier128,
  Scope
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
import type { OnChainFlowPayloadV1 } from "../../contracts/on-chain-flow.js";
import type { SelectedSupportResistance } from "../support-resistance/select.js";
import type { SelectedNewsEvidence } from "../news-events/select.js";
import { toCanonicalTimestamp } from "./timestamp.js";
import { buildDerivativeClaims } from "./derivatives.js";

const FEATURE_UNAVAILABLE_REFERENCE_ID = "feature_unavailable" as Identifier128;

export const EVIDENCE_BUNDLE_ASSEMBLE_VERSION = "mvp-evidence-bundle-assemble/v1";

export interface AssembleEvidenceBundleInput {
  readonly scope: Scope;
  readonly slots: readonly SelectedFeatureSlot[];
  readonly quality: EvidenceBundleQuality;
  readonly lineage: VerifiedEvidenceLineage["lineage"];
  readonly runId: string;
  readonly correlationId: string;
  readonly createdAt: number;
  readonly asOf: number;
  readonly freshUntil: number;
  readonly expiresAt: number;
  readonly briefPresent: boolean;
  readonly pipelineVersion: string;
  readonly gitCommit: string;
  readonly environment: "production" | "staging" | "development" | "test";
  readonly contextualEvents: readonly SelectedContextEvent[];
  readonly selectedSupportResistance?: readonly SelectedSupportResistance[];
  readonly selectedNewsEvidence?: readonly SelectedNewsEvidence[];
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
    case "oi_trend_4h":
    case "liquidation_cluster_1h":
    case "funding_rate_annualized":
    case "basis_spread_bps":
      return "risk";
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
    case "oi_trend_4h":
    case "liquidation_cluster_1h":
    case "funding_rate_annualized":
    case "basis_spread_bps":
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
  featureKind: FeatureKind,
  availableInputLineage: [Identifier128, ...Identifier128[]]
): DeterministicFeature {
  const family = mapFeatureKindToFamily(featureKind);
  const featureKindType = mapFeatureKindToKind(featureKind);
  const rowId = getRowIdFromSlot(slot);
  const warnings = getWarningsFromSlot(slot);
  const asOfUnixMs = getAsOfUnixMsFromSlot(slot);
  const validUntilUnixMs = getValidUntilUnixMsFromSlot(slot);
  const unit = mapFeatureKindToUnit(featureKind);

  const unavailableInputLineage = [FEATURE_UNAVAILABLE_REFERENCE_ID] as [Identifier128];

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
      inputLineage: unavailableInputLineage,
      warnings: ["missing_slot"] as [string, ...string[]]
    };
    return result as unknown as DeterministicFeature;
  }

  const normalizedWarnings = normalizeWarnings([...warnings]);
  const baseFeature = {
    featureId: `feat-${featureKind}-${rowId}`,
    family,
    featureKind: featureKindType,
    calculator: {
      name: "mvp-calculator",
      version: "1.0"
    }
  };

  if (slot.outcome === "selected_available" || slot.outcome === "selected_partial") {
    const result = {
      ...baseFeature,
      status: "available" as const,
      value: slot.value,
      unit: unit,
      observedAt: asOfUnixMs !== null ? toCanonicalTimestamp(asOfUnixMs) : null,
      freshUntil: validUntilUnixMs !== null ? toCanonicalTimestamp(validUntilUnixMs) : null,
      confidenceBps: slot.confidence.compositeScore,
      warnings: normalizedWarnings.slice(0, 16) as [string, ...string[]],
      inputLineage: availableInputLineage
    };
    return result as unknown as DeterministicFeature;
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
      warnings: unavailableWarnings,
      inputLineage: unavailableInputLineage
    };
    return result as unknown as DeterministicFeature;
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
    warnings: expiredWarnings,
    inputLineage: unavailableInputLineage
  };
  return result as unknown as DeterministicFeature;
}

function buildSupportResistanceClaims(
  selectedSR: readonly SelectedSupportResistance[]
): SupportResistanceClaim[] {
  const claims: SupportResistanceClaim[] = [];
  for (const item of selectedSR.slice(0, 16)) {
    const { row, payload } = item;
    const kind: "support_zone" | "resistance_zone" =
      payload.evidenceSide === "SUPPORT" ? "support_zone" : "resistance_zone";

    let baseClaim: string;
    if (payload.levelType === "point") {
      const sideText = payload.evidenceSide === "SUPPORT" ? "Support at" : "Resistance at";
      baseClaim = `${sideText} ${payload.levelUsdcPerSol} USDC/SOL (${payload.timeframe})`;
    } else {
      const sideText = payload.evidenceSide === "SUPPORT" ? "Support zone" : "Resistance zone";
      baseClaim = `${sideText} ${payload.zoneLowerUsdcPerSol}-${payload.zoneUpperUsdcPerSol} USDC/SOL (${payload.timeframe})`;
    }

    if (payload.thesisCodes && payload.thesisCodes.length > 0) {
      baseClaim += `; thesis: ${payload.thesisCodes.join(", ")}`;
    }
    if (payload.invalidationConditions && payload.invalidationConditions.length > 0) {
      baseClaim += `; invalidation: ${payload.invalidationConditions.join(", ")}`;
    }

    const claim = baseClaim.length > 512 ? baseClaim.slice(0, 512) : baseClaim;
    const confidenceBps = Math.max(0, Math.min(10_000, Math.round(row.confidence.compositeScore)));

    claims.push({
      evidenceId: `normalized-${row.id}` as Identifier128,
      kind,
      claim,
      direction: "unknown",
      confidenceBps,
      observedAt: toCanonicalTimestamp(payload.asOfUnixMs),
      expiresAt: toCanonicalTimestamp(payload.expiresAtUnixMs),
      sourceReferenceIds: [`raw-${row.rawObservationId}`] as [Identifier128, ...Identifier128[]],
      provenanceMethod: "collected"
    });
  }
  return claims;
}

function buildNewsRegulatoryClaims(
  selectedNews: readonly SelectedNewsEvidence[]
): NewsRegulatoryClaim[] {
  const claims: NewsRegulatoryClaim[] = [];
  for (const item of selectedNews.slice(0, 16)) {
    const { row, payload } = item;
    const kind: "ecosystem_news" | "regulatory_update" =
      payload.evidenceKind === "ecosystem_news" ? "ecosystem_news" : "regulatory_update";

    let baseClaim = `${payload.title}: ${payload.factualSummary}`;
    if (payload.corroborationState) {
      baseClaim += `; corroboration: ${payload.corroborationState}`;
    }
    if (payload.warnings && payload.warnings.length > 0) {
      baseClaim += `; warnings: ${payload.warnings.join(", ")}`;
    }

    const claim = baseClaim.length > 512 ? baseClaim.slice(0, 512) : baseClaim;
    const confidenceBps = Math.max(0, Math.min(10_000, Math.round(row.confidence.compositeScore)));

    claims.push({
      evidenceId: `normalized-${row.id}` as Identifier128,
      kind,
      claim,
      direction: "unknown",
      confidenceBps,
      observedAt: toCanonicalTimestamp(payload.asOfUnixMs),
      expiresAt: toCanonicalTimestamp(payload.expiresAtUnixMs),
      sourceReferenceIds: [`raw-${row.rawObservationId}`] as [Identifier128, ...Identifier128[]],
      provenanceMethod: "collected"
    });
  }
  return claims;
}

function buildContextualEvidence(
  contextualEvents: readonly SelectedContextEvent[],
  selectedSupportResistance: readonly SelectedSupportResistance[] = [],
  selectedNewsEvidence: readonly SelectedNewsEvidence[] = [],
  slots: readonly SelectedFeatureSlot[] = []
): ContextualEvidence {
  const events: EventClaim[] = [];
  const flows: FlowClaim[] = [];

  for (const selectedEvent of contextualEvents) {
    const { row, payload, eventFamily } = selectedEvent;

    if (eventFamily === "on_chain_flow") {
      const flowPayload = payload as OnChainFlowPayloadV1;
      const onChainFlowKind = flowPayload.eventType as
        | "whale_transfer"
        | "whale_swap"
        | "stablecoin_flow"
        | "dex_net_flow"
        | "cex_flow_proxy";

      let direction: "bullish" | "bearish" | "neutral" | "mixed" | "unknown" = "unknown";
      if (flowPayload.direction === "inbound") {
        direction = "bullish";
      } else if (flowPayload.direction === "outbound") {
        direction = "bearish";
      }

      const claim = `${onChainFlowKind}: ${flowPayload.amountUsdc} USDC ${flowPayload.direction} for ${flowPayload.venue}`;

      flows.push({
        evidenceId:
          `normalized-${row.id}` as import("../../contracts/generated/evidence-bundle-v1.js").Identifier128,
        kind: onChainFlowKind,
        claim,
        direction,
        confidenceBps: Math.max(0, Math.min(10_000, Math.round(row.confidence.compositeScore))),
        observedAt: toCanonicalTimestamp(
          flowPayload.observedAtUnixMs
        ) as import("../../contracts/generated/evidence-bundle-v1.js").CanonicalTimestamp,
        expiresAt: toCanonicalTimestamp(
          flowPayload.observedAtUnixMs + 900000
        ) as import("../../contracts/generated/evidence-bundle-v1.js").CanonicalTimestamp,
        sourceReferenceIds: [`raw-${row.rawObservationId}`] as [
          import("../../contracts/generated/evidence-bundle-v1.js").Identifier128,
          ...import("../../contracts/generated/evidence-bundle-v1.js").Identifier128[]
        ],
        provenanceMethod: "collected" as const
      });
    } else {
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

      events.push({
        evidenceId:
          `normalized-${row.id}` as import("../../contracts/generated/evidence-bundle-v1.js").Identifier128,
        kind,
        claim,
        direction: "unknown" as const,
        confidenceBps: Math.max(0, Math.min(10_000, Math.round(row.confidence.compositeScore))),
        observedAt: toCanonicalTimestamp(
          typedPayload.asOfUnixMs
        ) as import("../../contracts/generated/evidence-bundle-v1.js").CanonicalTimestamp,
        expiresAt: toCanonicalTimestamp(
          typedPayload.expiresAtUnixMs
        ) as import("../../contracts/generated/evidence-bundle-v1.js").CanonicalTimestamp,
        sourceReferenceIds: [`raw-${row.rawObservationId}`] as [
          import("../../contracts/generated/evidence-bundle-v1.js").Identifier128,
          ...import("../../contracts/generated/evidence-bundle-v1.js").Identifier128[]
        ],
        provenanceMethod: "collected" as const
      });
    }
  }

  const supportResistance = buildSupportResistanceClaims(selectedSupportResistance);
  const newsRegulatory = buildNewsRegulatoryClaims(selectedNewsEvidence);

  return {
    supportResistance,
    flows,
    derivatives: buildDerivativeClaims(slots),
    events,
    newsRegulatory
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
      observedAt: toCanonicalTimestamp(
        0
      ) as import("../../contracts/generated/evidence-bundle-v1.js").CanonicalTimestamp
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
    scope,
    slots,
    quality,
    lineage,
    runId,
    correlationId,
    createdAt,
    asOf,
    freshUntil,
    expiresAt,
    contextualEvents,
    selectedSupportResistance = [],
    selectedNewsEvidence = []
  } = input;

  const sourceReferences = buildSourceReferences(lineage);
  const availableInputLineage = sourceReferences.map((reference) => reference.referenceId) as [
    Identifier128,
    ...Identifier128[]
  ];

  const deterministicFeatures: DeterministicFeature[] = MVP_FEATURE_KINDS.map((featureKind) => {
    const slot = slots.find((s) => s.featureKind === featureKind);
    if (!slot) {
      const missingSlot: SelectedFeatureSlot = { featureKind, outcome: "missing" };
      return buildDeterministicFeature(missingSlot, featureKind, availableInputLineage);
    }
    return buildDeterministicFeature(slot, featureKind, availableInputLineage);
  });

  const needsUnavailableReference = deterministicFeatures.some((feature) =>
    feature.inputLineage.includes(FEATURE_UNAVAILABLE_REFERENCE_ID)
  );

  if (needsUnavailableReference) {
    sourceReferences.push({
      referenceId: FEATURE_UNAVAILABLE_REFERENCE_ID,
      sourceType: "internal_bundle",
      locator: "unavailable",
      observedAt: toCanonicalTimestamp(asOf)
    });
  }

  const source = {
    publisher: "sol-usdc-clmm-intelligence" as const,
    sourceId:
      "source-001" as import("../../contracts/generated/evidence-bundle-v1.js").Identifier128,
    sourceVersion:
      "1.0.0" as import("../../contracts/generated/evidence-bundle-v1.js").Identifier128
  };

  const contextualEvidence = buildContextualEvidence(
    contextualEvents,
    selectedSupportResistance,
    selectedNewsEvidence,
    slots
  );

  const researchBrief = input.briefPresent ? null : null;

  return {
    schemaVersion: "evidence-bundle.v1",
    pair: "SOL/USDC",
    scope,
    source,
    runId: runId as import("../../contracts/generated/evidence-bundle-v1.js").Identifier256,
    correlationId:
      correlationId as import("../../contracts/generated/evidence-bundle-v1.js").Identifier256,
    createdAt: toCanonicalTimestamp(createdAt),
    asOf: toCanonicalTimestamp(asOf),
    freshUntil: toCanonicalTimestamp(freshUntil),
    expiresAt: toCanonicalTimestamp(expiresAt),
    deterministicFeatures: deterministicFeatures as [
      DeterministicFeature,
      ...DeterministicFeature[]
    ],
    contextualEvidence,
    researchBrief,
    sourceReferences: sourceReferences as [SourceReference, ...SourceReference[]],
    assessment: buildBundleAssessment(quality),
    provenance: buildBundleProvenance(input, lineage)
  };
}
