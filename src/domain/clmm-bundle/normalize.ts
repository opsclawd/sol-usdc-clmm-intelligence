import type { ClmmBundle, PositionData, AlertData } from "../../contracts/clmm-bundle.js";
import type {
  ClmmNormalizedCandidate,
  PoolStatePayloadV1,
  PositionStatePayloadV1,
  FeeMetricsPayloadV1,
  TriggerEventPayloadV1,
  DataQualityPayloadV1
} from "../../contracts/normalized-clmm-observation.js";

export function normalizeClmmBundle(bundle: ClmmBundle): readonly ClmmNormalizedCandidate[] {
  const candidates: ClmmNormalizedCandidate[] = [];

  candidates.push(mapPoolState(bundle));

  for (const position of bundle.positions) {
    candidates.push(mapPositionState(bundle.pair, position));
    candidates.push(mapFeeMetrics(bundle.pair, position));
  }

  for (const alert of bundle.alerts) {
    candidates.push(mapTriggerEvent(bundle.pair, alert, bundle.pool.observedAtUnixMs));
  }

  candidates.push(mapDataQuality(bundle.pair, bundle.dataQuality, bundle.pool.observedAtUnixMs));

  return candidates;
}

function mapPoolState(bundle: ClmmBundle): PoolStatePayloadV1 {
  const pool = bundle.pool;
  return {
    kind: "pool_state",
    schemaVersion: 1,
    pair: pool.pair,
    poolId: pool.poolId,
    observedAtUnixMs: pool.observedAtUnixMs,
    currentPrice: pool.currentPrice,
    currentPriceLabel: pool.currentPriceLabel,
    sqrtPrice: pool.sqrtPrice,
    tickCurrentIndex: pool.tickCurrentIndex,
    tickSpacing: pool.tickSpacing,
    feeRate: pool.feeRate,
    feeRateLabel: pool.feeRateLabel,
    poolLiquidity: pool.poolLiquidity,
    priceSource: pool.priceSource
  };
}

function mapPositionState(pair: "SOL/USDC", position: PositionData): PositionStatePayloadV1 {
  return {
    kind: "position_state",
    schemaVersion: 1,
    pair,
    positionId: position.positionId,
    poolId: position.poolId,
    observedAtUnixMs: position.observedAtUnixMs,
    rangeState: position.rangeState,
    lowerTick: position.lowerTick,
    upperTick: position.upperTick,
    currentTick: position.currentTick,
    lowerPriceLabel: position.lowerPriceLabel,
    upperPriceLabel: position.upperPriceLabel,
    currentPrice: position.currentPrice,
    currentPriceLabel: position.currentPriceLabel,
    rangeDistance: {
      belowLowerTickPercent: position.rangeDistance.belowLowerTickPercent,
      aboveUpperTickPercent: position.rangeDistance.aboveUpperTickPercent,
      ...(position.rangeDistance.belowLowerPricePercent !== undefined && {
        belowLowerPricePercent: position.rangeDistance.belowLowerPricePercent
      }),
      ...(position.rangeDistance.aboveUpperPricePercent !== undefined && {
        aboveUpperPricePercent: position.rangeDistance.aboveUpperPricePercent
      })
    },
    feeRateLabel: position.feeRateLabel,
    positionLiquidity: position.positionLiquidity,
    poolLiquidity: position.poolLiquidity,
    hasActionableTrigger: position.hasActionableTrigger,
    triggerId: position.triggerId ?? null,
    breachDirection: position.breachDirection ?? null,
    unclaimedFeesUsd: position.unclaimedFeesUsd,
    unclaimedRewardsUsd: position.unclaimedRewardsUsd
  };
}

function mapFeeMetrics(pair: "SOL/USDC", position: PositionData): FeeMetricsPayloadV1 {
  return {
    kind: "fee_metrics",
    schemaVersion: 1,
    pair,
    positionId: position.positionId,
    observedAtUnixMs: position.observedAtUnixMs,
    feeOwedA: {
      raw: position.unclaimedFees.feeOwedA.raw,
      decimals: position.unclaimedFees.feeOwedA.decimals,
      symbol: position.unclaimedFees.feeOwedA.symbol,
      mint: position.unclaimedFees.feeOwedA.mint
    },
    feeOwedB: {
      raw: position.unclaimedFees.feeOwedB.raw,
      decimals: position.unclaimedFees.feeOwedB.decimals,
      symbol: position.unclaimedFees.feeOwedB.symbol,
      mint: position.unclaimedFees.feeOwedB.mint
    },
    unclaimedRewards: position.unclaimedRewards.map((r) => ({
      mint: r.mint,
      raw: r.raw,
      decimals: r.decimals,
      symbol: r.symbol
    })),
    unclaimedFeesUsd: position.unclaimedFeesUsd,
    unclaimedRewardsUsd: position.unclaimedRewardsUsd
  };
}

function mapTriggerEvent(
  pair: "SOL/USDC",
  alert: AlertData,
  observedAtUnixMs: number
): TriggerEventPayloadV1 {
  return {
    kind: "trigger_event",
    schemaVersion: 1,
    pair,
    triggerId: alert.triggerId,
    positionId: alert.positionId,
    observedAtUnixMs,
    breachDirection: alert.breachDirection,
    triggeredAt: alert.triggeredAt
  };
}

function mapDataQuality(
  pair: "SOL/USDC",
  dataQuality: ClmmBundle["dataQuality"],
  observedAtUnixMs: number
): DataQualityPayloadV1 {
  return {
    kind: "data_quality",
    schemaVersion: 1,
    pair,
    observedAtUnixMs,
    warnings: [...dataQuality.warnings],
    isPartial: dataQuality.isPartial,
    missingSources: [...dataQuality.missingSources]
  };
}
