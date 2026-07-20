import type {
  EvidenceBundleV1,
  DeterministicFeature,
  SourceReference,
  ContextualEvidence
} from "../../contracts/generated/evidence-bundle-v1.js";
import type { SelectedFeatureSlot } from "./select.js";
import type { EvidenceBundleQuality } from "./quality.js";
import type { VerifiedEvidenceLineage } from "./lineage.js";
import { MVP_FEATURE_KINDS } from "../../contracts/derived-feature.js";

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
}

type FeatureFamily =
  | "market_state"
  | "price_quality"
  | "clmm_economics"
  | "position_state"
  | "liquidity"
  | "risk";

function mapFeatureKindToFamily(featureKind: string): FeatureFamily {
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

function mapFeatureKindToKind(featureKind: string): "number" | "boolean" | "category" {
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

function getProvenanceFromSlot(slot: SelectedFeatureSlot) {
  if ("provenance" in slot) {
    return slot.provenance;
  }
  return null;
}

function buildDeterministicFeature(
  slot: SelectedFeatureSlot,
  featureKind: string
): DeterministicFeature {
  const family = mapFeatureKindToFamily(featureKind);
  const featureKindType = mapFeatureKindToKind(featureKind);
  const rowId = getRowIdFromSlot(slot);
  const warnings = getWarningsFromSlot(slot);
  const provenance = getProvenanceFromSlot(slot);

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
      unit: "percent" as const,
      observedAt: String(provenance?.processRef?.collector ?? rowId),
      freshUntil: String(provenance?.processRef?.collector ?? "50000003600000"),
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

function buildEmptyContextualEvidence(): ContextualEvidence {
  return {
    supportResistance: [],
    flows: [],
    derivatives: [],
    events: [],
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
    expiresAt
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

  const contextualEvidence = input.contextPresent
    ? buildEmptyContextualEvidence()
    : buildEmptyContextualEvidence();

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
    researchBrief: input.briefPresent ? null : null,
    sourceReferences: buildSourceReferences(lineage) as [SourceReference, ...SourceReference[]],
    assessment: buildBundleAssessment(quality),
    provenance: buildBundleProvenance(input, lineage)
  };
}
