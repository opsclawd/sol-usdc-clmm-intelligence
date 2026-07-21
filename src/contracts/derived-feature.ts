import { z } from "zod";
import type {
  FeatureKind,
  SignalClass,
  EvidenceFamily,
  Confidence,
  StaleBehavior,
  Provenance
} from "./taxonomy.js";

export const MVP_FEATURE_KINDS = [
  "range_location",
  "distance_to_lower",
  "distance_to_upper",
  "oracle_dex_divergence",
  "oracle_confidence_width",
  "realized_volatility_1h",
  "volume_liquidity_ratio_24h"
] as const;

export type FeatureStatus = "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
export type FeatureUnit = "BPS" | "PPM";

const FEATURE_KIND_SET = new Set(MVP_FEATURE_KINDS);

export function isCanonicalFeatureKind(kind: string): kind is FeatureKind {
  return FEATURE_KIND_SET.has(kind as FeatureKind);
}

const BPS_KINDS = new Set([
  "oracle_dex_divergence",
  "oracle_confidence_width",
  "realized_volatility_1h"
]);

const PPM_KINDS = new Set([
  "range_location",
  "distance_to_lower",
  "distance_to_upper",
  "volume_liquidity_ratio_24h"
]);

const POSITION_KINDS = new Set(["range_location", "distance_to_lower", "distance_to_upper"]);

const ProvenanceRefSchema = z.object({
  refType: z.enum([
    "raw_observation",
    "normalized_observation",
    "derived_feature",
    "evidence_bundle",
    "research_brief"
  ]),
  id: z.number(),
  source: z.string(),
  payloadHash: z.string()
});

const ProcessRefSchema = z.object({
  collector: z.string(),
  jobName: z.string(),
  pipelineRunId: z.string().nullable(),
  codeVersion: z.string().nullable(),
  modelVersion: z.string().nullable()
});

const ProvenanceSchema = z.object({
  sourceRefs: z.array(ProvenanceRefSchema),
  rawObservationRefs: z.array(ProvenanceRefSchema),
  derivedFromRefs: z.array(ProvenanceRefSchema),
  processRef: ProcessRefSchema,
  codeVersion: z.string(),
  runId: z.string().nullable()
});

const ConfidenceComponentsSchema = z.object({
  sourceReliability: z.number(),
  dataCompleteness: z.number(),
  derivationConfidence: z.number(),
  llmConfidence: z.number().nullable()
});

const ConfidenceSchema = z.object({
  components: ConfidenceComponentsSchema,
  compositeScore: z.number(),
  level: z.enum(["low", "medium", "high"]),
  weightingVersion: z.string(),
  reasons: z.array(z.string())
});

const FreshnessSchema = z.object({
  isStale: z.boolean(),
  validUntilUnixMs: z.number(),
  derivedAt: z.number(),
  policyKind: z.string(),
  reasons: z.array(z.string())
});

const DerivedFeatureV1BaseSchema = z.object({
  schemaVersion: z.literal(1),
  featureKind: z.string(),
  status: z.enum(["AVAILABLE", "PARTIAL", "UNAVAILABLE"]),
  value: z.number().nullable(),
  unit: z.enum(["BPS", "PPM"]),
  pair: z.literal("SOL/USDC"),
  poolId: z.string().nullable(),
  positionId: z.string().nullable(),
  asOfUnixMs: z.number().int().nonnegative(),
  expiresAtUnixMs: z.number().int().nonnegative(),
  confidence: ConfidenceSchema,
  freshness: FreshnessSchema,
  inputObservationIds: z.array(z.number().int().nonnegative()),
  rejectedObservationIds: z.array(z.number().int().nonnegative()),
  provenance: ProvenanceSchema,
  warnings: z.array(z.string()),
  reasons: z.array(z.string()),
  calculatorVersion: z.string(),
  selectionVersion: z.string(),
  calculationMetadata: z.record(z.unknown())
});

export type DerivedFeatureV1 = z.infer<typeof DerivedFeatureV1BaseSchema>;

const DerivedFeatureV1InputSchema = DerivedFeatureV1BaseSchema;

function validateSortedUnique<T>(arr: readonly T[], name: string): void {
  for (let i = 1; i < arr.length; i++) {
    const prev = arr[i - 1]!;
    const curr = arr[i]!;
    if (prev >= curr) {
      throw new Error(`${name} must be strictly sorted and unique`);
    }
  }
}

function validateCanonicalUnit(kind: string, unit: FeatureUnit): void {
  if (BPS_KINDS.has(kind) && unit !== "BPS") {
    throw new Error(`${kind} requires BPS unit`);
  }
  if (PPM_KINDS.has(kind) && unit !== "PPM") {
    throw new Error(`${kind} requires PPM unit`);
  }
}

function validateScopeIdentity(
  kind: string,
  poolId: string | null,
  positionId: string | null
): void {
  if (POSITION_KINDS.has(kind)) {
    if (poolId === null || positionId === null) {
      throw new Error(`${kind} requires both poolId and positionId`);
    }
  } else if (kind === "volume_liquidity_ratio_24h") {
    if (poolId === null || positionId !== null) {
      throw new Error(`volume_liquidity_ratio_24h requires poolId and no positionId`);
    }
  } else {
    if (poolId !== null || positionId !== null) {
      throw new Error(`${kind} requires neither poolId nor positionId`);
    }
  }
}

function validateStatusValue(status: FeatureStatus, value: number | null): void {
  if (status === "AVAILABLE" || status === "PARTIAL") {
    if (value === null) {
      throw new Error(`${status} requires a non-null value`);
    }
    if (!Number.isFinite(value)) {
      throw new Error(`${status} requires a finite value`);
    }
    if (!Number.isSafeInteger(value)) {
      throw new Error(`${status} requires a safe integer value`);
    }
  } else if (status === "UNAVAILABLE") {
    if (value !== null) {
      throw new Error("UNAVAILABLE requires null value");
    }
  }
}

function validateStatusAwareProvenance(
  status: FeatureStatus,
  inputObservationIds: readonly number[],
  provenance: unknown,
  reasons: readonly string[]
): void {
  const prov = provenance as { rawObservationRefs: readonly unknown[] };

  if (status === "UNAVAILABLE") {
    if (inputObservationIds.length === 0 && prov.rawObservationRefs.length === 0) {
      if (reasons.length === 0) {
        throw new Error("UNAVAILABLE with no input requires at least one reason");
      }
    }
  } else {
    if (inputObservationIds.length === 0 && prov.rawObservationRefs.length === 0) {
      throw new Error(`${status} requires at least one input observation reference`);
    }
  }
}

export function parseDerivedFeatureV1(value: unknown): DerivedFeatureV1 {
  const parsed = DerivedFeatureV1InputSchema.parse(value);

  if (!isCanonicalFeatureKind(parsed.featureKind)) {
    throw new Error(`Invalid featureKind: ${parsed.featureKind}`);
  }

  validateStatusValue(parsed.status, parsed.value);

  validateCanonicalUnit(parsed.featureKind, parsed.unit);

  validateScopeIdentity(parsed.featureKind, parsed.poolId, parsed.positionId);

  validateSortedUnique(parsed.inputObservationIds, "inputObservationIds");
  for (let i = 1; i < parsed.inputObservationIds.length; i++) {
    if (parsed.inputObservationIds[i] === parsed.inputObservationIds[i - 1]) {
      throw new Error("inputObservationIds must be unique");
    }
  }

  validateSortedUnique(parsed.rejectedObservationIds, "rejectedObservationIds");
  for (let i = 1; i < parsed.rejectedObservationIds.length; i++) {
    if (parsed.rejectedObservationIds[i] === parsed.rejectedObservationIds[i - 1]) {
      throw new Error("rejectedObservationIds must be unique");
    }
  }

  validateSortedUnique(parsed.warnings, "warnings");
  const warningSet = new Set<string>();
  for (const w of parsed.warnings) {
    if (warningSet.has(w)) throw new Error("warnings must be unique");
    warningSet.add(w);
  }

  validateSortedUnique(parsed.reasons, "reasons");
  const reasonSet = new Set<string>();
  for (const r of parsed.reasons) {
    if (reasonSet.has(r)) throw new Error("reasons must be unique");
    reasonSet.add(r);
  }

  validateStatusAwareProvenance(
    parsed.status,
    parsed.inputObservationIds,
    parsed.provenance,
    parsed.reasons
  );

  return parsed as DerivedFeatureV1;
}

export interface DerivedFeatureRow {
  id: number;
  featureKind: FeatureKind;
  signalClass: SignalClass;
  evidenceFamily: EvidenceFamily;
  value: number | null;
  structuredPayload: unknown;
  asOfUnixMs: number;
  confidence: Confidence;
  confidenceComposite: number | null;
  confidenceLevel: string | null;
  validUntilUnixMs: number | null;
  isStale: boolean;
  staleBehavior: StaleBehavior | null;
  provenance: Provenance;
  payloadHash: string;
  receivedAtUnixMs: number;
  status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
  unit: "BPS" | "PPM";
  pair: string;
  calculatorVersion: string;
  selectionVersion: string;
  inputObservationIds: number[];
  rejectedObservationIds: number[];
  derivationKey: string;
  poolId: string | null;
  positionId: string | null;
  warnings: readonly string[];
  reasons: readonly string[];
}
