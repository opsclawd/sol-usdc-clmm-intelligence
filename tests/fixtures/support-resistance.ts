import type {
  SupportResistanceRawSnapshot,
  SupportResistanceRawClaim
} from "../../src/contracts/support-resistance.js";

export function makeSupportResistanceRawClaim(
  overrides?: Partial<SupportResistanceRawClaim>
): SupportResistanceRawClaim {
  return {
    levelUsdcPerSol: undefined,
    zoneLowerUsdcPerSol: undefined,
    zoneUpperUsdcPerSol: undefined,
    evidenceSide: undefined,
    sourceExtract: undefined,
    ...overrides
  };
}

export interface SupportResistanceSnapshotOverrides {
  providerId?: string;
  providerRunId?: string;
  pair?: string;
  asOfUnixMs?: number;
  sourceReferences?: readonly string[];
  claims?: readonly Partial<SupportResistanceRawClaim>[];
  sourceReliability?: number;
  extraField?: unknown;
}

export function makeSupportResistanceRawSnapshot(
  overrides?: SupportResistanceSnapshotOverrides
): SupportResistanceRawSnapshot & { sourceReliability?: number; extraField?: unknown } {
  const providerId = overrides?.providerId ?? "technical-analysis-api";
  const providerRunId = overrides?.providerRunId ?? "run-001";
  const pair = overrides?.pair ?? "SOL/USDC";
  const asOfUnixMs = overrides?.asOfUnixMs ?? 1705315800000;
  const sourceReferences = overrides?.sourceReferences ?? ["https://example.com/analysis"];
  const claimsOverrides = overrides?.claims ?? [{}];

  const claims: SupportResistanceRawClaim[] = claimsOverrides.map((c) =>
    makeSupportResistanceRawClaim(c as SupportResistanceRawClaim)
  );

  return {
    providerId,
    providerRunId,
    pair,
    asOfUnixMs,
    sourceReferences,
    claims,
    sourceReliability: overrides?.sourceReliability,
    ...(overrides?.extraField !== undefined ? { extraField: overrides.extraField } : {})
  };
}

export function makeSupportResistancePointClaim(
  levelUsdcPerSol: number,
  side: "SUPPORT" | "RESISTANCE" = "RESISTANCE",
  overrides?: Partial<SupportResistanceRawClaim>
): SupportResistanceRawClaim {
  return makeSupportResistanceRawClaim({
    levelUsdcPerSol,
    evidenceSide: side,
    ...overrides
  });
}

export function makeSupportResistanceZoneClaim(
  lower: number,
  upper: number,
  side: "SUPPORT" | "RESISTANCE" = "RESISTANCE",
  overrides?: Partial<SupportResistanceRawClaim>
): SupportResistanceRawClaim {
  return makeSupportResistanceRawClaim({
    zoneLowerUsdcPerSol: lower,
    zoneUpperUsdcPerSol: upper,
    evidenceSide: side,
    ...overrides
  });
}

export function makeLongExtract(length: number): string {
  return "x".repeat(length);
}
