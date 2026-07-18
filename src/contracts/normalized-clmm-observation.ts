export interface PoolStatePayloadV1 {
  readonly kind: "pool_state";
  readonly schemaVersion: 1;
  readonly pair: "SOL/USDC";
  readonly poolId: string;
  readonly observedAtUnixMs: number;
  readonly currentPrice: number;
  readonly currentPriceLabel: string;
  readonly sqrtPrice: string;
  readonly tickCurrentIndex: number;
  readonly tickSpacing: number;
  readonly feeRate: number;
  readonly feeRateLabel: string;
  readonly poolLiquidity: string;
  readonly priceSource: "orca_whirlpool_sqrt_price";
}

export interface PositionStatePayloadV1 {
  readonly kind: "position_state";
  readonly schemaVersion: 1;
  readonly pair: "SOL/USDC";
  readonly positionId: string;
  readonly poolId: string;
  readonly observedAtUnixMs: number;
  readonly rangeState: "in-range" | "below-range" | "above-range";
  readonly lowerTick: number;
  readonly upperTick: number;
  readonly currentTick: number;
  readonly lowerPriceLabel: string;
  readonly upperPriceLabel: string;
  readonly currentPrice: number;
  readonly currentPriceLabel: string;
  readonly rangeDistance: {
    readonly belowLowerTickPercent: number;
    readonly aboveUpperTickPercent: number;
    readonly belowLowerPricePercent: number | null;
    readonly aboveUpperPricePercent: number | null;
  };
  readonly feeRateLabel: string;
  readonly positionLiquidity: string;
  readonly poolLiquidity: string;
  readonly hasActionableTrigger: boolean;
  readonly triggerId: string | null;
  readonly breachDirection: "lower-bound-breach" | "upper-bound-breach" | null;
  readonly unclaimedFeesUsd: number | null;
  readonly unclaimedRewardsUsd: number | null;
}

export interface FeeMetricsPayloadV1 {
  readonly kind: "fee_metrics";
  readonly schemaVersion: 1;
  readonly pair: "SOL/USDC";
  readonly positionId: string;
  readonly observedAtUnixMs: number;
  readonly feeOwedA: {
    readonly raw: string;
    readonly decimals: number | null;
    readonly symbol: string;
    readonly mint: string;
  };
  readonly feeOwedB: {
    readonly raw: string;
    readonly decimals: number | null;
    readonly symbol: string;
    readonly mint: string;
  };
  readonly unclaimedRewards: ReadonlyArray<{
    readonly mint: string;
    readonly raw: string;
    readonly decimals: number | null;
    readonly symbol: string;
  }>;
  readonly unclaimedFeesUsd: number | null;
  readonly unclaimedRewardsUsd: number | null;
}

export interface TriggerEventPayloadV1 {
  readonly kind: "trigger_event";
  readonly schemaVersion: 1;
  readonly pair: "SOL/USDC";
  readonly triggerId: string;
  readonly positionId: string;
  readonly observedAtUnixMs: number;
  readonly breachDirection: "lower-bound-breach" | "upper-bound-breach";
  readonly triggeredAt: number;
}

export interface DataQualityPayloadV1 {
  readonly kind: "data_quality";
  readonly schemaVersion: 1;
  readonly pair: "SOL/USDC";
  readonly observedAtUnixMs: number;
  readonly warnings: readonly string[];
  readonly isPartial: boolean;
  readonly missingSources: readonly string[];
}

export type ClmmNormalizedCandidate =
  | PoolStatePayloadV1
  | PositionStatePayloadV1
  | FeeMetricsPayloadV1
  | TriggerEventPayloadV1
  | DataQualityPayloadV1;
