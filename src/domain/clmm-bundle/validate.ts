import { z } from "zod";
import type {
  ClmmBundle,
  PoolData,
  PositionData,
  AlertData,
  FeeAmount,
  RewardAmount,
  SrLevels,
  SrLevel,
  DataQuality
} from "../../contracts/clmm-bundle.js";

function finiteNumber(): z.ZodType<number> {
  return z.number().refine(Number.isFinite, {
    message: "must be a finite number"
  });
}

function nullableFiniteNumber(): z.ZodType<number | null> {
  return z
    .number()
    .nullable()
    .refine((val) => val === null || Number.isFinite(val), {
      message: "must be a finite number or null"
    });
}

function optionalFiniteNumber(): z.ZodType<number | undefined> {
  return z
    .number()
    .optional()
    .refine((val) => val === undefined || Number.isFinite(val), {
      message: "must be a finite number or undefined"
    });
}

const feeAmountSchema: z.ZodType<FeeAmount> = z.object({
  raw: z.string(),
  decimals: nullableFiniteNumber(),
  symbol: z.string(),
  mint: z.string()
});

const rewardAmountSchema: z.ZodType<RewardAmount> = z.object({
  mint: z.string(),
  raw: z.string(),
  decimals: nullableFiniteNumber(),
  symbol: z.string()
});

const srLevelSchema: z.ZodType<SrLevel> = z.object({
  price: finiteNumber(),
  rank: z.string().optional(),
  timeframe: z.string().optional(),
  invalidation: finiteNumber().optional(),
  notes: z.string().optional()
});

const srLevelsSchema: z.ZodType<SrLevels> = z.object({
  briefId: z.string(),
  sourceRecordedAtIso: z.string().nullable(),
  summary: z.string().nullable(),
  capturedAtUnixMs: finiteNumber(),
  supports: z.array(srLevelSchema),
  resistances: z.array(srLevelSchema)
});

const rangeDistanceSchema = z.object({
  belowLowerTickPercent: finiteNumber(),
  aboveUpperTickPercent: finiteNumber(),
  belowLowerPricePercent: optionalFiniteNumber(),
  aboveUpperPricePercent: optionalFiniteNumber()
});

const unclaimedFeesSchema = z.object({
  feeOwedA: feeAmountSchema,
  feeOwedB: feeAmountSchema
});

const positionDataSchema: z.ZodType<PositionData> = z.object({
  walletId: z.string(),
  positionId: z.string(),
  poolId: z.string(),
  pair: z.literal("SOL/USDC"),
  source: z.literal("orca"),
  observedAtUnixMs: finiteNumber(),
  rangeState: z.enum(["in-range", "below-range", "above-range"]),
  lowerTick: finiteNumber(),
  upperTick: finiteNumber(),
  currentTick: finiteNumber(),
  lowerPriceLabel: z.string(),
  upperPriceLabel: z.string(),
  currentPrice: finiteNumber(),
  currentPriceLabel: z.string(),
  rangeDistance: rangeDistanceSchema,
  feeRateLabel: z.string(),
  unclaimedFees: unclaimedFeesSchema,
  unclaimedRewards: z.array(rewardAmountSchema),
  unclaimedFeesUsd: nullableFiniteNumber(),
  unclaimedRewardsUsd: nullableFiniteNumber(),
  positionLiquidity: z.string(),
  poolLiquidity: z.string(),
  hasActionableTrigger: z.boolean(),
  triggerId: z.string().optional(),
  breachDirection: z.enum(["lower-bound-breach", "upper-bound-breach"]).optional()
});

const alertDataSchema: z.ZodType<AlertData> = z.object({
  triggerId: z.string(),
  positionId: z.string(),
  breachDirection: z.enum(["lower-bound-breach", "upper-bound-breach"]),
  triggeredAt: finiteNumber()
});

const dataQualitySchema: z.ZodType<DataQuality> = z.object({
  warnings: z.array(z.string()),
  isPartial: z.boolean(),
  missingSources: z.array(z.string())
});

const poolDataSchema: z.ZodType<PoolData> = z.object({
  poolId: z.string(),
  pair: z.literal("SOL/USDC"),
  source: z.literal("orca"),
  observedAtUnixMs: finiteNumber(),
  tokenPairLabel: z.string(),
  currentPrice: finiteNumber(),
  currentPriceLabel: z.string(),
  sqrtPrice: z.string(),
  tickCurrentIndex: finiteNumber(),
  tickSpacing: finiteNumber(),
  feeRate: finiteNumber(),
  feeRateLabel: z.string(),
  poolLiquidity: z.string(),
  priceSource: z.literal("orca_whirlpool_sqrt_price")
});

export const clmmBundleSchema: z.ZodType<ClmmBundle> = z.object({
  pair: z.literal("SOL/USDC"),
  source: z.literal("orca"),
  observedAtUnixMs: finiteNumber(),
  pool: poolDataSchema,
  srLevels: srLevelsSchema.nullable(),
  positions: z.array(positionDataSchema),
  alerts: z.array(alertDataSchema),
  dataQuality: dataQualitySchema
});

function validatePositionPoolConsistency(positions: PositionData[], pool: PoolData): void {
  for (const position of positions) {
    if (position.poolId !== pool.poolId) {
      throw new ClmmBundleValidationError(
        "position.poolId mismatch",
        `position ${position.positionId} has poolId "${position.poolId}" but expected "${pool.poolId}"`
      );
    }
    if (position.pair !== pool.pair) {
      throw new ClmmBundleValidationError(
        "position.pair mismatch",
        `position ${position.positionId} has pair "${position.pair}" but expected "${pool.pair}"`
      );
    }
    if (position.source !== pool.source) {
      throw new ClmmBundleValidationError(
        "position.source mismatch",
        `position ${position.positionId} has source "${position.source}" but expected "${pool.source}"`
      );
    }
  }
}

function validateAlertPositionConsistency(
  alerts: AlertData[],
  positions: PositionData[],
  pool: PoolData
): void {
  const positionIds = new Set(positions.map((p) => p.positionId));

  for (const alert of alerts) {
    if (!positionIds.has(alert.positionId)) {
      throw new ClmmBundleValidationError(
        "alert.positionId reference",
        `alert ${alert.triggerId} references non-existent positionId "${alert.positionId}"`
      );
    }

    const position = positions.find((p) => p.positionId === alert.positionId);
    if (position && position.poolId !== pool.poolId) {
      throw new ClmmBundleValidationError(
        "alert.positionId pool mismatch",
        `alert ${alert.triggerId} position ${position.positionId} has poolId "${position.poolId}" but bundle pool is "${pool.poolId}"`
      );
    }
  }
}

export class ClmmBundleValidationError extends Error {
  constructor(
    public readonly field: string,
    public readonly message: string
  ) {
    super(`[${field}] ${message}`);
    this.name = "ClmmBundleValidationError";
  }
}

export function acceptClmmBundleEnvelope(response: unknown): {
  bundle: ClmmBundle;
  status: string;
} {
  const envelopeSchema = z.object({
    bundle: clmmBundleSchema,
    status: z.string()
  });

  const parsed = envelopeSchema.parse(response);

  validatePositionPoolConsistency(parsed.bundle.positions, parsed.bundle.pool);
  validateAlertPositionConsistency(
    parsed.bundle.alerts,
    parsed.bundle.positions,
    parsed.bundle.pool
  );

  return parsed;
}

export function acceptClmmBundle(bundle: unknown): ClmmBundle {
  const parsed = clmmBundleSchema.parse(bundle);

  validatePositionPoolConsistency(parsed.positions, parsed.pool);
  validateAlertPositionConsistency(parsed.alerts, parsed.positions, parsed.pool);

  return parsed;
}
