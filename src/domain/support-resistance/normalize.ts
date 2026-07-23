import type {
  SupportResistanceWarning,
  SupportResistancePayloadV1,
  SupportResistanceLevel
} from "../../contracts/support-resistance.js";
import type { BoundedSupportResistanceSnapshot } from "./validate.js";
import { deriveSupportResistanceEquivalenceKey } from "./identity.js";

export interface ClaimRejection {
  readonly index: number;
  readonly reason: "missing_level" | "malformed_level";
  readonly detail?: string;
}

export interface NormalizationResult {
  readonly accepted: readonly SupportResistancePayloadV1[];
  readonly rejected: readonly ClaimRejection[];
  readonly warnings: readonly SupportResistanceWarning[];
}

function normalizeStringArray(arr: readonly string[] | undefined): string[] {
  if (!arr || arr.length === 0) return [];
  const trimmed = arr.map((s) => s.trim()).filter((s) => s.length > 0);
  return [...new Set(trimmed)].sort();
}

function normalizeClaimLevel(
  claim: BoundedSupportResistanceSnapshot["claims"][number],
  index: number
):
  | { level: SupportResistanceLevel; warnings: SupportResistanceWarning[] }
  | { rejected: ClaimRejection } {
  const hasPoint = claim.levelUsdcPerSol !== undefined;
  const hasZone =
    claim.zoneLowerUsdcPerSol !== undefined || claim.zoneUpperUsdcPerSol !== undefined;

  if (hasPoint && hasZone) {
    return {
      rejected: {
        index,
        reason: "malformed_level",
        detail: "cannot supply both point and zone fields"
      }
    };
  }

  if (hasPoint) {
    const level = claim.levelUsdcPerSol!;
    if (!Number.isFinite(level) || level <= 0) {
      return {
        rejected: {
          index,
          reason: "malformed_level",
          detail: "point level must be finite positive"
        }
      };
    }
    return {
      level: {
        levelType: "point",
        levelUsdcPerSol: level
      },
      warnings: []
    };
  }

  if (hasZone) {
    const lower = claim.zoneLowerUsdcPerSol!;
    const upper = claim.zoneUpperUsdcPerSol!;

    if (!Number.isFinite(lower) || !Number.isFinite(upper)) {
      return {
        rejected: {
          index,
          reason: "malformed_level",
          detail: "zone bounds must be finite"
        }
      };
    }

    if (lower <= 0 || upper <= 0) {
      return {
        rejected: {
          index,
          reason: "malformed_level",
          detail: "zone bounds must be positive"
        }
      };
    }

    if (lower >= upper) {
      return {
        rejected: {
          index,
          reason: "malformed_level",
          detail: "zone lower must be less than upper"
        }
      };
    }

    return {
      level: {
        levelType: "zone",
        zoneLowerUsdcPerSol: lower,
        zoneUpperUsdcPerSol: upper
      },
      warnings: []
    };
  }

  return {
    rejected: {
      index,
      reason: "missing_level"
    }
  };
}

export async function normalizeSupportResistanceClaims(
  snapshot: BoundedSupportResistanceSnapshot
): Promise<NormalizationResult> {
  const accepted: SupportResistancePayloadV1[] = [];
  const rejected: ClaimRejection[] = [];
  const warningsSet = new Set<SupportResistanceWarning>();

  if (!snapshot.sourceReferences || snapshot.sourceReferences.length === 0) {
    warningsSet.add("missing_source_reference");
  }

  let hasDuplicateLevels = false;
  const levelKeys = new Set<string>();

  for (let i = 0; i < snapshot.claims.length; i++) {
    const claim = snapshot.claims[i]!;
    const result = normalizeClaimLevel(claim, i);

    if ("rejected" in result) {
      rejected.push(result.rejected);
      continue;
    }

    const levelKey = JSON.stringify(result.level);
    if (levelKeys.has(levelKey)) {
      hasDuplicateLevels = true;
    } else {
      levelKeys.add(levelKey);
    }

    const thesisCodes = normalizeStringArray(claim.thesisCodes);
    const invalidationConditions = normalizeStringArray(claim.invalidationConditions);
    const sourceReferences = normalizeStringArray(snapshot.sourceReferences);

    accepted.push({
      kind: "support_resistance_level",
      schemaVersion: 1,
      pair: snapshot.pair,
      unit: "USDC_PER_SOL",
      evidenceSide: claim.evidenceSide,
      timeframe: "1h",
      thesisCodes,
      asOfUnixMs: snapshot.asOfUnixMs,
      expiresAtUnixMs: claim.expiresAtUnixMs ?? snapshot.asOfUnixMs + 86400000,
      invalidationConditions,
      warnings: [...result.warnings],
      sourceReferences,
      sourceQuality: {
        providerId: snapshot.providerId,
        reliability: snapshot.sourceReliability,
        completeness: snapshot.sourceReferences.length > 0 ? "complete" : "partial"
      },
      ...result.level
    });
  }

  if (accepted.length > 1 && hasDuplicateLevels) {
    warningsSet.add("ambiguous_source_claim");
  }

  if (accepted.length > 0 && accepted.every((c) => c.invalidationConditions.length === 0)) {
    warningsSet.add("missing_invalidation_conditions");
  }

  const dedupedAccepted = await deduplicateByEquivalence(accepted, snapshot.providerRunId);

  return {
    accepted: dedupedAccepted,
    rejected,
    warnings: [...warningsSet]
  };
}

async function deduplicateByEquivalence(
  accepted: SupportResistancePayloadV1[],
  providerRunId: string
): Promise<SupportResistancePayloadV1[]> {
  if (accepted.length <= 1) {
    return accepted;
  }

  const claimIdentities = accepted.map((claim) => {
    const identity: {
      providerId: string;
      providerRunId: string;
      pair: string;
      evidenceSide: "SUPPORT" | "RESISTANCE";
      levelType: "point" | "zone";
      levelUsdcPerSol: number | undefined;
      zoneLowerUsdcPerSol: number | undefined;
      zoneUpperUsdcPerSol: number | undefined;
      timeframe: string;
      thesisCodes: readonly string[];
    } = {
      providerId: claim.sourceQuality.providerId,
      providerRunId,
      pair: claim.pair,
      evidenceSide: claim.evidenceSide,
      levelType: claim.levelType,
      levelUsdcPerSol: claim.levelType === "point" ? claim.levelUsdcPerSol : undefined,
      zoneLowerUsdcPerSol: claim.levelType === "zone" ? claim.zoneLowerUsdcPerSol : undefined,
      zoneUpperUsdcPerSol: claim.levelType === "zone" ? claim.zoneUpperUsdcPerSol : undefined,
      timeframe: claim.timeframe,
      thesisCodes: claim.thesisCodes
    };
    return identity;
  });

  const keys = await Promise.all(
    claimIdentities.map((identity) => deriveSupportResistanceEquivalenceKey(identity))
  );

  const equivalenceKeyToFirstIndex = new Map<string, number>();
  const duplicateKeys = new Set<string>();

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    if (equivalenceKeyToFirstIndex.has(key)) {
      duplicateKeys.add(key);
    } else {
      equivalenceKeyToFirstIndex.set(key, i);
    }
  }

  if (duplicateKeys.size === 0) {
    return accepted;
  }

  return accepted.map((claim, i) => {
    const key = keys[i]!;
    if (!duplicateKeys.has(key)) {
      return claim;
    }
    return {
      ...claim,
      warnings: [...claim.warnings, "duplicate_equivalent_claim"]
    };
  });
}
