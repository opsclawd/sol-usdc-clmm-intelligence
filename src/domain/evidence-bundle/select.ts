import { MVP_FEATURE_KINDS } from "../../contracts/derived-feature.js";
import type { FeatureKind, Confidence, Provenance } from "../../contracts/taxonomy.js";
import type { DerivedFeatureRow } from "../../ports/feature-repo.js";

export const EVIDENCE_BUNDLE_SELECTION_VERSION = "mvp-evidence-bundle-selection/v1";

export type SlotOutcome =
  | "selected_available"
  | "selected_partial"
  | "selected_unavailable"
  | "missing"
  | "expired_only"
  | "unsupported_version_only";

export interface SelectedAvailableSlot {
  readonly featureKind: FeatureKind;
  readonly outcome: "selected_available";
  readonly rowId: number;
  readonly value: number;
  readonly confidence: Confidence;
  readonly provenance: Provenance;
  readonly warnings: readonly string[];
  readonly reasons: readonly string[];
}

export interface SelectedPartialSlot {
  readonly featureKind: FeatureKind;
  readonly outcome: "selected_partial";
  readonly rowId: number;
  readonly value: number;
  readonly confidence: Confidence;
  readonly provenance: Provenance;
  readonly warnings: readonly string[];
  readonly reasons: readonly string[];
}

export interface SelectedUnavailableSlot {
  readonly featureKind: FeatureKind;
  readonly outcome: "selected_unavailable";
  readonly rowId: number;
  readonly confidence: Confidence;
  readonly provenance: Provenance;
  readonly warnings: readonly string[];
  readonly reasons: readonly string[];
}

export interface MissingSlot {
  readonly featureKind: FeatureKind;
  readonly outcome: "missing";
}

export interface ExpiredOnlySlot {
  readonly featureKind: FeatureKind;
  readonly outcome: "expired_only";
  readonly rowId: number;
}

export interface UnsupportedVersionOnlySlot {
  readonly featureKind: FeatureKind;
  readonly outcome: "unsupported_version_only";
  readonly rowId: number;
}

export type SelectedFeatureSlot =
  | SelectedAvailableSlot
  | SelectedPartialSlot
  | SelectedUnavailableSlot
  | MissingSlot
  | ExpiredOnlySlot
  | UnsupportedVersionOnlySlot;

export interface BundleSelectionRequest {
  readonly evaluationTimeUnixMs: number;
  readonly selectionVersion: string;
  readonly calculatorVersions: Readonly<Record<FeatureKind, string>>;
  readonly candidates: readonly DerivedFeatureRow[];
  readonly poolId: string;
  readonly positionId: string;
}

export interface BundleSelectionResult {
  readonly slots: readonly SelectedFeatureSlot[];
  readonly rejectedIds: readonly number[];
  readonly warnings: readonly string[];
  readonly reasons: readonly string[];
}

const POSITION_KINDS = new Set(["range_location", "distance_to_lower", "distance_to_upper"]);

function getScopeFilter(
  featureKind: FeatureKind,
  requestPoolId: string,
  requestPositionId: string
): { poolId: string | null; positionId: string | null } {
  if (POSITION_KINDS.has(featureKind)) {
    return { poolId: requestPoolId, positionId: requestPositionId };
  }
  if (featureKind === "volume_liquidity_ratio_24h") {
    return { poolId: requestPoolId, positionId: null };
  }
  return { poolId: null, positionId: null };
}

function isEligibleCandidate(
  row: DerivedFeatureRow,
  evaluationTimeUnixMs: number,
  scope: { poolId: string | null; positionId: string | null }
): { eligible: boolean; reason?: string; isVersionMismatch?: boolean } {
  if (row.pair !== "SOL/USDC") {
    return { eligible: false, reason: `wrong_pair: expected SOL/USDC, got ${row.pair}` };
  }

  if (row.poolId !== scope.poolId) {
    return {
      eligible: false,
      reason: `wrong_pool: expected ${scope.poolId ?? "null"}, got ${row.poolId ?? "null"}`
    };
  }

  if (row.positionId !== scope.positionId) {
    return {
      eligible: false,
      reason: `wrong_position: expected ${scope.positionId ?? "null"}, got ${row.positionId ?? "null"}`
    };
  }

  if (row.asOfUnixMs > evaluationTimeUnixMs) {
    return {
      eligible: false,
      reason: `future: asOf=${row.asOfUnixMs} > evaluation=${evaluationTimeUnixMs}`
    };
  }

  if (row.validUntilUnixMs !== null && row.validUntilUnixMs <= evaluationTimeUnixMs) {
    return {
      eligible: false,
      reason: `expired: validUntil=${row.validUntilUnixMs} <= evaluation=${evaluationTimeUnixMs}`
    };
  }

  return { eligible: true };
}

function checkVersionMismatch(row: DerivedFeatureRow, expectedCalculatorVersion: string): boolean {
  return row.calculatorVersion !== expectedCalculatorVersion;
}

function sortCandidatesForSelection(candidates: DerivedFeatureRow[]): void {
  candidates.sort((a, b) => {
    if (b.asOfUnixMs !== a.asOfUnixMs) return b.asOfUnixMs - a.asOfUnixMs;
    if (b.receivedAtUnixMs !== a.receivedAtUnixMs) return b.receivedAtUnixMs - a.receivedAtUnixMs;
    return b.id - a.id;
  });
}

function selectSlot(
  featureKind: FeatureKind,
  candidates: DerivedFeatureRow[],
  evaluationTimeUnixMs: number,
  expectedCalculatorVersion: string,
  scope: { poolId: string | null; positionId: string | null }
): { slot: SelectedFeatureSlot; rejectedIds: number[]; warnings: string[]; reasons: string[] } {
  const eligible: DerivedFeatureRow[] = [];
  const rejectedIds: number[] = [];
  const warnings: string[] = [];
  const reasons: string[] = [];

  for (const candidate of candidates) {
    const versionMismatch = checkVersionMismatch(candidate, expectedCalculatorVersion);
    const eligibilityResult = isEligibleCandidate(candidate, evaluationTimeUnixMs, scope);

    if (!eligibilityResult.eligible) {
      rejectedIds.push(candidate.id);
      if (eligibilityResult.reason) {
        if (eligibilityResult.reason.startsWith("wrong_")) {
          warnings.push(eligibilityResult.reason);
        } else {
          reasons.push(eligibilityResult.reason);
        }
      }
      continue;
    }

    if (versionMismatch) {
      rejectedIds.push(candidate.id);
      continue;
    }

    eligible.push(candidate);
  }

  if (eligible.length === 0) {
    const scopedCandidates = candidates.filter(
      (c) => c.poolId === scope.poolId && c.positionId === scope.positionId
    );

    const hasFutureOrExpired = scopedCandidates.some(
      (c) =>
        (c.validUntilUnixMs !== null && c.validUntilUnixMs <= evaluationTimeUnixMs) ||
        c.asOfUnixMs > evaluationTimeUnixMs
    );

    if (hasFutureOrExpired) {
      const matching = scopedCandidates.filter(
        (c) =>
          (c.validUntilUnixMs !== null && c.validUntilUnixMs <= evaluationTimeUnixMs) ||
          c.asOfUnixMs > evaluationTimeUnixMs
      );
      sortCandidatesForSelection(matching);

      return {
        slot: {
          featureKind,
          outcome: "expired_only",
          rowId: matching[0]!.id
        },
        rejectedIds: rejectedIds.filter((id) => id !== matching[0]!.id),
        warnings,
        reasons
      };
    }

    const hasUnsupportedVersion = scopedCandidates.some((c) =>
      checkVersionMismatch(c, expectedCalculatorVersion)
    );

    if (hasUnsupportedVersion) {
      const matching = scopedCandidates.filter((c) =>
        checkVersionMismatch(c, expectedCalculatorVersion)
      );
      sortCandidatesForSelection(matching);

      return {
        slot: {
          featureKind,
          outcome: "unsupported_version_only",
          rowId: matching[0]!.id
        },
        rejectedIds: rejectedIds.filter((id) => id !== matching[0]!.id),
        warnings,
        reasons
      };
    }

    return {
      slot: { featureKind, outcome: "missing" },
      rejectedIds,
      warnings,
      reasons
    };
  }

  sortCandidatesForSelection(eligible);
  const winner = eligible[0]!;

  if (winner.status === "AVAILABLE") {
    return {
      slot: {
        featureKind,
        outcome: "selected_available",
        rowId: winner.id,
        value: winner.value!,
        confidence: winner.confidence,
        provenance: winner.provenance,
        warnings: [...warnings, ...(winner.warnings ?? [])],
        reasons: [...reasons, ...(winner.reasons ?? [])]
      },
      rejectedIds: [...rejectedIds, ...eligible.slice(1).map((c) => c.id)],
      warnings,
      reasons
    };
  }

  if (winner.status === "PARTIAL") {
    return {
      slot: {
        featureKind,
        outcome: "selected_partial",
        rowId: winner.id,
        value: winner.value!,
        confidence: winner.confidence,
        provenance: winner.provenance,
        warnings: [...warnings, ...(winner.warnings ?? [])],
        reasons: [...reasons, ...(winner.reasons ?? [])]
      },
      rejectedIds: [...rejectedIds, ...eligible.slice(1).map((c) => c.id)],
      warnings,
      reasons
    };
  }

  return {
    slot: {
      featureKind,
      outcome: "selected_unavailable",
      rowId: winner.id,
      confidence: winner.confidence,
      provenance: winner.provenance,
      warnings: [...warnings, ...(winner.warnings ?? [])],
      reasons: [...reasons, ...(winner.reasons ?? [])]
    },
    rejectedIds: [...rejectedIds, ...eligible.slice(1).map((c) => c.id)],
    warnings,
    reasons
  };
}

export function selectEvidenceFeatureSlots(request: BundleSelectionRequest): BundleSelectionResult {
  const { evaluationTimeUnixMs, calculatorVersions, candidates, poolId, positionId } = request;

  const allRejectedIds: number[] = [];
  const allWarnings: string[] = [];
  const allReasons: string[] = [];

  const slots: SelectedFeatureSlot[] = [];

  for (const featureKind of MVP_FEATURE_KINDS) {
    const scope = getScopeFilter(featureKind, poolId, positionId);
    const kindCandidates = candidates.filter((c) => c.featureKind === featureKind);
    const expectedCalculatorVersion = calculatorVersions[featureKind];

    const { slot, rejectedIds, warnings, reasons } = selectSlot(
      featureKind,
      [...kindCandidates],
      evaluationTimeUnixMs,
      expectedCalculatorVersion,
      scope
    );

    slots.push(slot);
    allRejectedIds.push(...rejectedIds);
    allWarnings.push(...warnings);
    allReasons.push(...reasons);
  }

  const uniqueAndSorted = <T>(arr: T[], compareFn?: (a: T, b: T) => number): T[] => {
    const sorted = arr.slice().sort(compareFn ?? ((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    const unique: T[] = [];
    for (const item of sorted) {
      if (unique.length === 0 || unique[unique.length - 1] !== item) {
        unique.push(item);
      }
    }
    return unique;
  };

  return {
    slots,
    rejectedIds: uniqueAndSorted(allRejectedIds, (a, b) => a - b),
    warnings: uniqueAndSorted(allWarnings),
    reasons: uniqueAndSorted(allReasons)
  };
}
