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

function mapOutcomeToStatus(outcome: SelectedFeatureSlot["outcome"]): "available" | "unavailable" {
  switch (outcome) {
    case "selected_available":
    case "selected_partial":
      return "available";
    case "selected_unavailable":
    case "missing":
    case "expired_only":
    case "unsupported_version_only":
      return "unavailable";
  }
}

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

function buildDeterministicFeature(
  slot: SelectedFeatureSlot,
  featureKind: string
): DeterministicFeature {
  const family = mapFeatureKindToFamily(featureKind);
  const featureKindType = mapFeatureKindToKind(featureKind);
  const status = mapOutcomeToStatus(slot.outcome);
  const normalizedWarnings = normalizeWarnings(slot.warnings ?? []);

  const baseFeature = {
    featureId:
      `feat-${featureKind}-${slot.rowId ?? 0}` as import("../../contracts/generated/evidence-bundle-v1.js").Identifier128,
    family: family as DeterministicFeature extends { family: infer F } ? F : never,
    featureKind: featureKindType as DeterministicFeature extends { featureKind: infer K }
      ? K
      : never,
    calculator: {
      name: "mvp-calculator" as import("../../contracts/generated/evidence-bundle-v1.js").Identifier128,
      version: "1.0" as import("../../contracts/generated/evidence-bundle-v1.js").Identifier128
    },
    inputLineage: [`row-${slot.rowId ?? 0}`] as [
      import("../../contracts/generated/evidence-bundle-v1.js").Identifier128,
      ...import("../../contracts/generated/evidence-bundle-v1.js").Identifier128[]
    ]
  };

  if (status === "available") {
    const value = hasValue(slot) ? slot.value : 0;
    const confidenceBps = getConfidenceBps(slot);
    const freshUntil =
      slot.outcome === "selected_available" || slot.outcome === "selected_partial"
        ? String(slot.provenance?.processRef?.collector ?? "50000003600000")
        : "0";

    return {
      ...baseFeature,
      status: "available" as const,
      value,
      unit: "percent" as const,
      observedAt: String(slot.provenance?.processRef?.collector ?? slot.rowId ?? 0),
      freshUntil,
      confidenceBps,
      warnings: normalizedWarnings.slice(0, 16) as DeterministicFeature extends {
        warnings: infer W;
      }
        ? W
        : never
    };
  }

  return {
    ...baseFeature,
    status: "unavailable" as const,
    value: null,
    unit: null,
    observedAt: null,
    freshUntil: null,
    confidenceBps: 0,
    warnings:
      normalizedWarnings.length > 0
        ? (normalizedWarnings.slice(0, 16) as DeterministicFeature extends { warnings: infer W }
            ? W
            : never)
        : (["unavailable"] as DeterministicFeature extends { warnings: infer W } ? W : never)
  };
}

function hasValue(slot: SelectedFeatureSlot): slot is SelectedAvailableSlot | SelectedPartialSlot {
  return slot.outcome === "selected_available" || slot.outcome === "selected_partial";
}

interface SelectedAvailableSlot {
  readonly featureKind: string;
  readonly outcome: "selected_available";
  readonly rowId: number;
  readonly value: number;
  readonly confidence: import("../../contracts/taxonomy.js").Confidence;
  readonly provenance: import("../../contracts/taxonomy.js").Provenance;
  readonly warnings: readonly string[];
  readonly reasons: readonly string[];
}

interface SelectedPartialSlot {
  readonly featureKind: string;
  readonly outcome: "selected_partial";
  readonly rowId: number;
  readonly value: number;
  readonly confidence: import("../../contracts/taxonomy.js").Confidence;
  readonly provenance: import("../../contracts/taxonomy.js").Provenance;
  readonly warnings: readonly string[];
  readonly reasons: readonly string[];
}

function getConfidenceBps(slot: SelectedFeatureSlot): number {
  if (
    slot.outcome === "missing" ||
    slot.outcome === "expired_only" ||
    slot.outcome === "unsupported_version_only"
  ) {
    return 0;
  }
  return slot.confidence.compositeScore;
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
