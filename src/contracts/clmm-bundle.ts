export interface ClmmBundle {
  pair: "SOL/USDC";
  source: "orca";
  observedAtUnixMs: number;
  pool: PoolData;
  srLevels: SrLevels | null;
  positions: PositionData[];
  alerts: AlertData[];
  dataQuality: DataQuality;
}

export interface PoolData {
  poolId: string;
  pair: "SOL/USDC";
  source: "orca";
  observedAtUnixMs: number;
  tokenPairLabel: string;
  currentPrice: number;
  currentPriceLabel: string;
  sqrtPrice: string;
  tickCurrentIndex: number;
  tickSpacing: number;
  feeRate: number;
  feeRateLabel: string;
  poolLiquidity: string;
  priceSource: "orca_whirlpool_sqrt_price";
}

export interface PositionData {
  walletId: string;
  positionId: string;
  poolId: string;
  pair: "SOL/USDC";
  source: "orca";
  observedAtUnixMs: number;
  rangeState: "in-range" | "below-range" | "above-range";
  lowerTick: number;
  upperTick: number;
  currentTick: number;
  lowerPriceLabel: string;
  upperPriceLabel: string;
  currentPrice: number;
  currentPriceLabel: string;
  rangeDistance: {
    belowLowerTickPercent: number;
    aboveUpperTickPercent: number;
    belowLowerPricePercent?: number;
    aboveUpperPricePercent?: number;
  };
  feeRateLabel: string;
  unclaimedFees: {
    feeOwedA: FeeAmount;
    feeOwedB: FeeAmount;
  };
  unclaimedRewards: RewardAmount[];
  unclaimedFeesUsd: number | null;
  unclaimedRewardsUsd: number | null;
  positionLiquidity: string;
  poolLiquidity: string;
  hasActionableTrigger: boolean;
  triggerId?: string;
  breachDirection?: "lower-bound-breach" | "upper-bound-breach";
}

export interface FeeAmount {
  raw: string;
  decimals: number | null;
  symbol: string;
  mint: string;
}

export interface RewardAmount {
  mint: string;
  raw: string;
  decimals: number | null;
  symbol: string;
}

export interface SrLevels {
  briefId: string;
  sourceRecordedAtIso: string | null;
  summary: string | null;
  capturedAtUnixMs: number;
  supports: SrLevel[];
  resistances: SrLevel[];
}

export interface SrLevel {
  price: number;
  rank?: string;
  timeframe?: string;
  invalidation?: number;
  notes?: string;
}

export interface AlertData {
  triggerId: string;
  positionId: string;
  breachDirection: "lower-bound-breach" | "upper-bound-breach";
  triggeredAt: number;
}

export interface DataQuality {
  warnings: string[];
  isPartial: boolean;
  missingSources: string[];
}
