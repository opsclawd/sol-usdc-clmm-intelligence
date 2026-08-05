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
  Identifier256,
  Hex64,
  CanonicalTimestamp,
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
import { confidenceFractionToBps } from "./confidence-bps.js";

const FEATURE_UNAVAILABLE_REFERENCE_ID = "feature_unavailable" as Identifier128;

export const EVIDENCE_BUNDLE_ASSEMBLE_VERSION = "mvp-evidence-bundle-assemble/v1";

export interface AssembleEvidenceBundleInput {
  readonly scope: Scope;
  readonly slots: readonly SelectedFeatureSlot[];
  readonly featureKinds?: readonly FeatureKind[];
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

const PPM_KINDS: readonly FeatureKind[] = [];

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
  availableInputLineage: [Identifier128, ...Identifier128[]],
  fallbackFreshUntil: number,
  fallbackAsOf: number
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
      observedAt: toCanonicalTimestamp(asOfUnixMs ?? fallbackAsOf),
      freshUntil: toCanonicalTimestamp(validUntilUnixMs ?? fallbackFreshUntil),
      confidenceBps: confidenceFractionToBps(slot.confidence.compositeScore),
      warnings: normalizedWarnings.slice(0, 16),
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
    const confidenceBps = confidenceFractionToBps(row.confidence.compositeScore);

    claims.push({
      evidenceId: `normalized-${row.id}` as Identifier128,
      kind,
      claim,
      direction: "unknown",
      confidenceBps,
      observedAt: toCanonicalTimestamp(payload.asOfUnixMs),
      expiresAt: toCanonicalTimestamp(payload.expiresAtUnixMs),
      sourceReferenceIds: ([`raw-${row.rawObservationId}`] as Identifier128[]).slice(0, 64) as [
        Identifier128,
        ...Identifier128[]
      ],
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
    const confidenceBps = confidenceFractionToBps(row.confidence.compositeScore);

    claims.push({
      evidenceId: `normalized-${row.id}` as Identifier128,
      kind,
      claim,
      direction: "unknown",
      confidenceBps,
      observedAt: toCanonicalTimestamp(payload.asOfUnixMs),
      expiresAt: toCanonicalTimestamp(payload.expiresAtUnixMs),
      sourceReferenceIds: ([`raw-${row.rawObservationId}`] as Identifier128[]).slice(0, 64) as [
        Identifier128,
        ...Identifier128[]
      ],
      provenanceMethod: "collected"
    });
  }
  return claims;
}

function mapOnChainFlowKindToPublishedKind(
  kind: OnChainFlowPayloadV1["eventType"]
): FlowClaim["kind"] | null {
  switch (kind) {
    case "dex_net_flow":
    case "whale_swap":
      return "spot_flow";
    case "cex_flow_proxy":
      return "exchange_flow";
    case "stablecoin_flow":
      return "stablecoin_flow";
    case "whale_transfer":
      return null;
  }
}

interface ContextualEvidenceBuildResult {
  readonly evidence: ContextualEvidence;
  readonly droppedFlowKinds: readonly OnChainFlowPayloadV1["eventType"][];
}

function buildContextualEvidence(
  contextualEvents: readonly SelectedContextEvent[],
  selectedSupportResistance: readonly SelectedSupportResistance[] = [],
  selectedNewsEvidence: readonly SelectedNewsEvidence[] = [],
  slots: readonly SelectedFeatureSlot[] = []
): ContextualEvidenceBuildResult {
  const events: EventClaim[] = [];
  const flows: FlowClaim[] = [];
  const droppedFlowKinds: OnChainFlowPayloadV1["eventType"][] = [];

  for (const selectedEvent of contextualEvents) {
    const { row, payload, eventFamily } = selectedEvent;

    if (eventFamily === "on_chain_flow") {
      const flowPayload = payload as OnChainFlowPayloadV1;
      const mappedKind = mapOnChainFlowKindToPublishedKind(flowPayload.eventType);
      if (mappedKind === null) {
        droppedFlowKinds.push(flowPayload.eventType);
        continue;
      }

      let direction: "bullish" | "bearish" | "neutral" | "mixed" | "unknown" = "unknown";
      if (flowPayload.direction === "inbound") {
        direction = "bullish";
      } else if (flowPayload.direction === "outbound") {
        direction = "bearish";
      }

      const claim = `${flowPayload.eventType}: ${flowPayload.amountUsdc} USDC ${flowPayload.direction} for ${flowPayload.venue}`;

      flows.push({
        evidenceId: `normalized-${row.id}` as Identifier128,
        kind: mappedKind,
        claim,
        direction,
        confidenceBps: confidenceFractionToBps(row.confidence.compositeScore),
        observedAt: toCanonicalTimestamp(flowPayload.observedAtUnixMs) as CanonicalTimestamp,
        expiresAt: toCanonicalTimestamp(
          flowPayload.observedAtUnixMs + 900000
        ) as CanonicalTimestamp,
        sourceReferenceIds: ([`raw-${row.rawObservationId}`] as Identifier128[]).slice(0, 64) as [
          Identifier128,
          ...Identifier128[]
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
        evidenceId: `normalized-${row.id}` as Identifier128,
        kind,
        claim,
        direction: "unknown" as const,
        confidenceBps: confidenceFractionToBps(row.confidence.compositeScore),
        observedAt: toCanonicalTimestamp(typedPayload.asOfUnixMs) as CanonicalTimestamp,
        expiresAt: toCanonicalTimestamp(typedPayload.expiresAtUnixMs) as CanonicalTimestamp,
        sourceReferenceIds: ([`raw-${row.rawObservationId}`] as Identifier128[]).slice(0, 64) as [
          Identifier128,
          ...Identifier128[]
        ],
        provenanceMethod: "collected" as const
      });
    }
  }

  const supportResistance = buildSupportResistanceClaims(selectedSupportResistance);
  const newsRegulatory = buildNewsRegulatoryClaims(selectedNewsEvidence);

  return {
    evidence: {
      supportResistance,
      flows,
      derivatives: buildDerivativeClaims(slots),
      events,
      newsRegulatory
    },
    droppedFlowKinds
  };
}

function buildSourceReferences(lineage: VerifiedEvidenceLineage["lineage"]): SourceReference[] {
  const refs: SourceReference[] = [];

  for (const ref of lineage.sourceReferences) {
    refs.push({
      referenceId: ref.referenceId as Identifier128,
      sourceType: ref.sourceType,
      locator: ref.locator,
      observedAt: ref.observedAt
    });
  }

  if (refs.length === 0) {
    refs.push({
      referenceId: "no_sources_available" as Identifier128,
      sourceType: "internal_bundle",
      locator: "no_sources_available",
      observedAt: toCanonicalTimestamp(0) as CanonicalTimestamp
    });
  }

  return refs;
}

function buildBundleAssessment(
  quality: EvidenceBundleQuality,
  contextualResult: ContextualEvidenceBuildResult
) {
  let coverage = quality.coverage;
  const warnings = quality.warnings.map((w) => ({
    code: w.code as Identifier128,
    message: w.message,
    affectedFamilies: [...w.affectedFamilies]
  }));

  const { evidence, droppedFlowKinds } = contextualResult;

  if (droppedFlowKinds.length > 0) {
    const uniqueDroppedKinds = [...new Set(droppedFlowKinds)].sort();
    for (const droppedKind of uniqueDroppedKinds) {
      warnings.push({
        code: "unmappable_flow_kind" as Identifier128,
        message: `Dropped unmappable on-chain flow kind: ${droppedKind}`,
        affectedFamilies: ["flows"]
      });
    }

    if (evidence.flows.length === 0) {
      coverage = {
        ...coverage,
        flows: "unavailable"
      };

      const hasFlowsUnavailable = warnings.some((w) => w.code === "FLOWS_UNAVAILABLE");
      if (!hasFlowsUnavailable) {
        warnings.push({
          code: "FLOWS_UNAVAILABLE" as Identifier128,
          message: "On-chain flows evidence family is unavailable",
          affectedFamilies: ["flows"]
        });
      }
    }
  }

  return {
    overallConfidenceBps: quality.overallConfidenceBps,
    quality: quality.quality,
    coverage,
    warnings
  };
}

function buildBundleProvenance(
  input: AssembleEvidenceBundleInput,
  lineage: VerifiedEvidenceLineage["lineage"]
) {
  return {
    pipelineVersion: input.pipelineVersion as Identifier128,
    gitCommit: input.gitCommit as Hex64,
    environment: input.environment,
    upstreamRunIds: lineage.rawObservationIds.map((id) => String(id) as Identifier128)
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
  const availableInputLineage = sourceReferences
    .map((reference) => reference.referenceId)
    .slice(0, 64) as [Identifier128, ...Identifier128[]];

  const featureKinds = input.featureKinds ?? MVP_FEATURE_KINDS;

  const deterministicFeatures: DeterministicFeature[] = featureKinds.map((featureKind) => {
    const slot = slots.find((s) => s.featureKind === featureKind);
    if (!slot) {
      const missingSlot: SelectedFeatureSlot = { featureKind, outcome: "missing" };
      return buildDeterministicFeature(
        missingSlot,
        featureKind,
        availableInputLineage,
        freshUntil,
        asOf
      );
    }
    return buildDeterministicFeature(slot, featureKind, availableInputLineage, freshUntil, asOf);
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
    sourceId: "source-001" as Identifier128,
    sourceVersion: "1.0.0" as Identifier128
  };

  const contextualResult = buildContextualEvidence(
    contextualEvents,
    selectedSupportResistance,
    selectedNewsEvidence,
    slots
  );

  const researchBrief = null;

  return {
    schemaVersion: "evidence-bundle.v1",
    pair: "SOL/USDC",
    scope,
    source,
    runId: runId as Identifier256,
    correlationId: correlationId as Identifier256,
    createdAt: toCanonicalTimestamp(createdAt),
    asOf: toCanonicalTimestamp(asOf),
    freshUntil: toCanonicalTimestamp(freshUntil),
    expiresAt: toCanonicalTimestamp(expiresAt),
    deterministicFeatures: deterministicFeatures as [
      DeterministicFeature,
      ...DeterministicFeature[]
    ],
    contextualEvidence: contextualResult.evidence,
    researchBrief,
    sourceReferences: sourceReferences as [SourceReference, ...SourceReference[]],
    assessment: buildBundleAssessment(quality, contextualResult),
    provenance: buildBundleProvenance(input, lineage)
  };
}
