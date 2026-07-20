import type { FeatureKind } from "../../contracts/taxonomy.js";
import { MVP_FEATURE_KINDS } from "../../contracts/derived-feature.js";
import type { SelectedFeatureSlot } from "./select.js";

export const EVIDENCE_BUNDLE_QUALITY_VERSION = "mvp-evidence-bundle-quality/v1";

export type QualityLevel = "complete" | "partial" | "degraded";
export type CoverageStatus = "available" | "partial" | "unavailable" | "not_applicable";

export interface SlotQualitySummary {
  readonly featureKind: FeatureKind;
  readonly status: "available" | "partial" | "unavailable" | "missing" | "expired" | "unsupported";
  readonly confidenceBps: number;
  readonly hasValue: boolean;
  readonly warnings: readonly string[];
}

export interface FamilyCoverage {
  readonly deterministic: CoverageStatus;
  readonly supportResistance: CoverageStatus;
  readonly flows: CoverageStatus;
  readonly derivatives: CoverageStatus;
  readonly events: CoverageStatus;
  readonly newsRegulatory: CoverageStatus;
  readonly researchBrief: CoverageStatus;
}

export interface BundleWarning {
  readonly code: string;
  readonly message: string;
  readonly affectedFamilies: readonly string[];
}

export interface EvidenceBundleQuality {
  readonly version: string;
  readonly quality: QualityLevel;
  readonly coverage: FamilyCoverage;
  readonly overallConfidenceBps: number;
  readonly slotQualitySummaries: readonly SlotQualitySummary[];
  readonly warnings: readonly BundleWarning[];
  readonly createdAt: number;
  readonly asOf: number;
  readonly freshUntil: number;
  readonly expiresAt: number;
}

export interface EvidenceQualityInput {
  readonly slots: readonly SelectedFeatureSlot[];
  readonly runId: string;
  readonly correlationId: string;
  readonly createdAt: number;
  readonly asOf: number;
  readonly freshUntil: number;
  readonly expiresAt: number;
  readonly contextPresent: boolean;
  readonly briefPresent: boolean;
  readonly allowNoUsableFeatures?: boolean;
}

function getSlotStatus(slot: SelectedFeatureSlot): SlotQualitySummary["status"] {
  switch (slot.outcome) {
    case "selected_available":
      return "available";
    case "selected_partial":
      return "partial";
    case "selected_unavailable":
      return "unavailable";
    case "missing":
      return "missing";
    case "expired_only":
      return "expired";
    case "unsupported_version_only":
      return "unsupported";
  }
}

function getSlotConfidenceBps(slot: SelectedFeatureSlot): number {
  if (
    slot.outcome === "missing" ||
    slot.outcome === "expired_only" ||
    slot.outcome === "unsupported_version_only"
  ) {
    return 0;
  }
  return slot.confidence.compositeScore;
}

function hasSlotValue(slot: SelectedFeatureSlot): boolean {
  return slot.outcome === "selected_available" || slot.outcome === "selected_partial";
}

function normalizeWarnings(warnings: readonly string[]): string[] {
  return [...new Set(warnings)].sort();
}

function computeOverallConfidence(summaries: readonly SlotQualitySummary[]): number {
  const usableSummaries = summaries.filter(
    (s) => s.status === "available" || s.status === "partial"
  );
  if (usableSummaries.length === 0) {
    return 0;
  }
  const minConfidence = Math.min(...usableSummaries.map((s) => s.confidenceBps));
  return minConfidence;
}

function computeQualityLevel(
  summaries: readonly SlotQualitySummary[],
  allowNoUsableFeatures: boolean
): QualityLevel {
  const availableCount = summaries.filter((s) => s.status === "available").length;
  const partialCount = summaries.filter((s) => s.status === "partial").length;
  const unavailableCount = summaries.filter((s) => s.status === "unavailable").length;
  const missingCount = summaries.filter((s) => s.status === "missing").length;
  const expiredCount = summaries.filter((s) => s.status === "expired").length;
  const unsupportedCount = summaries.filter((s) => s.status === "unsupported").length;

  const usableCount = availableCount + partialCount;
  const degradedCount =
    partialCount + unavailableCount + missingCount + expiredCount + unsupportedCount;

  if (usableCount === 0) {
    return allowNoUsableFeatures ? "partial" : "degraded";
  }

  if (degradedCount > 0) {
    return "partial";
  }

  return "complete";
}

function buildWarnings(
  summaries: readonly SlotQualitySummary[],
  contextPresent: boolean,
  briefPresent: boolean,
  noUsableFeatures: boolean
): BundleWarning[] {
  const warnings: BundleWarning[] = [];

  if (noUsableFeatures) {
    warnings.push({
      code: "no_usable_features",
      message: "No usable feature slots available in bundle",
      affectedFamilies: ["clmm_state", "price_quality", "clmm_economics", "liquidity", "risk"]
    });
  }

  const missingCount = summaries.filter((s) => s.status === "missing").length;
  if (missingCount > 0) {
    warnings.push({
      code: "missing_slots",
      message: `${missingCount} slot(s) missing required features`,
      affectedFamilies: ["clmm_state"]
    });
  }

  const expiredCount = summaries.filter((s) => s.status === "expired").length;
  if (expiredCount > 0) {
    warnings.push({
      code: "expired_features",
      message: `${expiredCount} slot(s) have only expired features available`,
      affectedFamilies: ["clmm_state"]
    });
  }

  const unsupportedCount = summaries.filter((s) => s.status === "unsupported").length;
  if (unsupportedCount > 0) {
    warnings.push({
      code: "unsupported_version",
      message: `${unsupportedCount} slot(s) have only unsupported calculator versions`,
      affectedFamilies: ["clmm_state"]
    });
  }

  const partialCount = summaries.filter((s) => s.status === "partial").length;
  if (partialCount > 0) {
    warnings.push({
      code: "partial_features",
      message: `${partialCount} slot(s) operating in partial availability mode`,
      affectedFamilies: ["clmm_state"]
    });
  }

  const unavailableCount = summaries.filter((s) => s.status === "unavailable").length;
  if (unavailableCount > 0) {
    warnings.push({
      code: "unavailable_features",
      message: `${unavailableCount} slot(s) have unavailable features`,
      affectedFamilies: ["clmm_state"]
    });
  }

  return warnings;
}

export function classifyEvidenceBundleQuality(input: EvidenceQualityInput): EvidenceBundleQuality {
  const {
    slots,
    createdAt,
    asOf,
    freshUntil,
    expiresAt,
    contextPresent,
    briefPresent,
    allowNoUsableFeatures = false
  } = input;

  const slotQualitySummaries: SlotQualitySummary[] = MVP_FEATURE_KINDS.map((featureKind, index) => {
    const slot = slots[index];
    if (!slot || slot.featureKind !== featureKind) {
      return {
        featureKind,
        status: "missing" as const,
        confidenceBps: 0,
        hasValue: false,
        warnings: [] as readonly string[]
      };
    }

    const warnings = normalizeWarnings("warnings" in slot ? slot.warnings : []);

    return {
      featureKind,
      status: getSlotStatus(slot),
      confidenceBps: getSlotConfidenceBps(slot),
      hasValue: hasSlotValue(slot),
      warnings
    };
  });

  const usableCount = slotQualitySummaries.filter(
    (s) => s.status === "available" || s.status === "partial"
  ).length;
  const noUsableFeatures = usableCount === 0;

  const quality = computeQualityLevel(slotQualitySummaries, allowNoUsableFeatures);
  const overallConfidenceBps = computeOverallConfidence(slotQualitySummaries);
  const warnings = buildWarnings(
    slotQualitySummaries,
    contextPresent,
    briefPresent,
    noUsableFeatures
  );

  let deterministicCoverage: CoverageStatus = "available";
  const hasPartial = slotQualitySummaries.some((s) => s.status === "partial");
  const hasUnavailable = slotQualitySummaries.some((s) => s.status === "unavailable");
  const hasMissing = slotQualitySummaries.some((s) => s.status === "missing");
  const hasExpired = slotQualitySummaries.some((s) => s.status === "expired");
  const hasUnsupported = slotQualitySummaries.some((s) => s.status === "unsupported");

  if (hasPartial || hasUnavailable || hasMissing || hasExpired || hasUnsupported) {
    deterministicCoverage = "partial";
  }
  if (
    slotQualitySummaries.every(
      (s) =>
        s.status === "unavailable" ||
        s.status === "missing" ||
        s.status === "expired" ||
        s.status === "unsupported"
    )
  ) {
    deterministicCoverage = "unavailable";
  }

  const coverage: FamilyCoverage = {
    deterministic: deterministicCoverage,
    supportResistance: contextPresent ? "partial" : "not_applicable",
    flows: contextPresent ? "partial" : "not_applicable",
    derivatives: contextPresent ? "partial" : "not_applicable",
    events: contextPresent ? "partial" : "not_applicable",
    newsRegulatory: contextPresent ? "partial" : "not_applicable",
    researchBrief: briefPresent ? "available" : "not_applicable"
  };

  return {
    version: EVIDENCE_BUNDLE_QUALITY_VERSION,
    quality,
    coverage,
    overallConfidenceBps,
    slotQualitySummaries,
    warnings,
    createdAt,
    asOf,
    freshUntil,
    expiresAt
  };
}
