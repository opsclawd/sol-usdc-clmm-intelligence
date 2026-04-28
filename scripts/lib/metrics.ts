export type RiskLevel = 'normal' | 'elevated' | 'critical';
export type RecommendedAction = 'hold' | 'watch' | 'tighten_range' | 'widen_range' | 'exit_range' | 'pause_rebalances';
export type DataQuality = 'complete' | 'partial' | 'stale';

export interface PositionSnapshot {
  pair: 'SOL/USDC';
  timestamp: string;
  source: string;
  lowerPrice?: number;
  upperPrice?: number;
  spotPrice?: number;
  inRange: boolean;
  distanceToLowerPercent?: number;
  distanceToUpperPercent?: number;
  unclaimedFeesUsd?: number;
  inventorySolPercent?: number;
  inventoryUsdcPercent?: number;
}

export interface PoolSnapshot {
  pair: 'SOL/USDC';
  timestamp: string;
  source: string;
  spotPrice?: number;
  feeApr?: number;
  volume24hUsd?: number;
  tvlUsd?: number;
  liquidityTrend?: 'rising' | 'flat' | 'falling' | 'unknown';
  volumeTrend?: 'rising' | 'flat' | 'falling' | 'unknown';
  feeAprTrend?: 'rising' | 'flat' | 'falling' | 'unknown';
}

export interface PriceSnapshot {
  pair: 'SOL/USDC';
  timestamp: string;
  source: string;
  priceUsd: number;
  confidence?: 'low' | 'medium' | 'high';
}

export function assessDataQuality(inputs: Record<string, unknown>): { quality: DataQuality; missing: string[] } {
  const missing = Object.entries(inputs)
    .filter(([, value]) => value == null)
    .map(([key]) => key);

  if (missing.length === 0) return { quality: 'complete', missing };
  if (missing.length <= 2) return { quality: 'partial', missing };
  return { quality: 'stale', missing };
}

export function assessRangeStatus(position?: PositionSnapshot): {
  status: 'healthy' | 'near_lower_edge' | 'near_upper_edge' | 'out_of_range' | 'unknown';
  breachRisk: 'low' | 'medium' | 'high' | 'unknown';
  recommendedAction: RecommendedAction;
  riskLevel: RiskLevel;
} {
  if (!position) {
    return { status: 'unknown', breachRisk: 'unknown', recommendedAction: 'watch', riskLevel: 'elevated' };
  }

  if (!position.inRange) {
    return { status: 'out_of_range', breachRisk: 'high', recommendedAction: 'exit_range', riskLevel: 'critical' };
  }

  const lower = position.distanceToLowerPercent;
  const upper = position.distanceToUpperPercent;

  if (lower != null && lower <= 3) {
    return { status: 'near_lower_edge', breachRisk: 'high', recommendedAction: 'widen_range', riskLevel: 'elevated' };
  }

  if (upper != null && upper <= 3) {
    return { status: 'near_upper_edge', breachRisk: 'high', recommendedAction: 'widen_range', riskLevel: 'elevated' };
  }

  if ((lower != null && lower <= 6) || (upper != null && upper <= 6)) {
    return { status: lower != null && lower <= 6 ? 'near_lower_edge' : 'near_upper_edge', breachRisk: 'medium', recommendedAction: 'watch', riskLevel: 'normal' };
  }

  return { status: 'healthy', breachRisk: 'low', recommendedAction: 'hold', riskLevel: 'normal' };
}

export function classifyFeeEnvironment(pool?: PoolSnapshot): 'strong' | 'normal' | 'weak' | 'unknown' {
  if (!pool || pool.feeApr == null) return 'unknown';
  if (pool.feeApr >= 80) return 'strong';
  if (pool.feeApr >= 25) return 'normal';
  return 'weak';
}
