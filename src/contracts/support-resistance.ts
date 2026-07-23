import type { Freshness } from "./taxonomy.js";
import type { Confidence } from "./taxonomy.js";

export type SupportResistanceWarning =
  | "ambiguous_source_claim"
  | "conflicting_source_claim"
  | "duplicate_equivalent_claim"
  | "missing_invalidation_conditions"
  | "missing_level"
  | "missing_source_reference"
  | "stale_observation";

export type SupportResistanceLevel =
  | {
      readonly levelType: "point";
      readonly levelUsdcPerSol: number;
    }
  | {
      readonly levelType: "zone";
      readonly zoneLowerUsdcPerSol: number;
      readonly zoneUpperUsdcPerSol: number;
    };

export type SupportResistancePayloadV1 = SupportResistanceLevel & {
  readonly kind: "support_resistance_level";
  readonly schemaVersion: 1;
  readonly pair: "SOL/USDC";
  readonly unit: "USDC_PER_SOL";
  readonly evidenceSide: "SUPPORT" | "RESISTANCE";
  readonly timeframe: string;
  readonly thesisCodes: readonly string[];
  readonly asOfUnixMs: number;
  readonly expiresAtUnixMs: number;
  readonly invalidationConditions: readonly string[];
  readonly warnings: readonly SupportResistanceWarning[];
  readonly sourceReferences: readonly string[];
  readonly sourceQuality: {
    readonly providerId: string;
    readonly reliability: number;
    readonly completeness: "complete" | "partial";
  };
};

export type SupportResistanceRawClaim = {
  readonly levelUsdcPerSol?: number | undefined;
  readonly zoneLowerUsdcPerSol?: number | undefined;
  readonly zoneUpperUsdcPerSol?: number | undefined;
  readonly evidenceSide?: "SUPPORT" | "RESISTANCE" | undefined;
  readonly sourceExtract?: string | undefined;
};

export type SupportResistanceRawSnapshot = {
  readonly providerId: string;
  readonly providerRunId: string;
  readonly pair: string;
  readonly asOfUnixMs: number;
  readonly sourceReferences: readonly string[];
  readonly claims: readonly SupportResistanceRawClaim[];
};

export type SupportResistanceCollectionStatus =
  | "accepted"
  | "degraded"
  | "stale"
  | "identical_replay"
  | "conflict"
  | "malformed"
  | "timeout"
  | "network"
  | "unavailable"
  | "failed";

export type SupportResistanceCollectionResult = {
  readonly status: SupportResistanceCollectionStatus;
  readonly hasUsableEvidence: boolean;
  readonly rawId: string | null;
  readonly rawCount: number;
  readonly warnings: readonly SupportResistanceWarning[];
  readonly freshness: Freshness;
  readonly confidence: Confidence;
  readonly diagnostic: string | null;
};
