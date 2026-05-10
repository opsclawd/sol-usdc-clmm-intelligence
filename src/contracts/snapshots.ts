export interface PriceSnapshot {
  pair: "SOL/USDC";
  timestamp: string;
  source: string;
  priceUsd: number;
  confidence?: "low" | "medium" | "high";
  raw?: unknown;
}

export interface PoolSnapshot {
  pair: "SOL/USDC";
  timestamp: string;
  source: string;
  spotPrice?: number;
  feeApr?: number;
  volume24hUsd?: number;
  tvlUsd?: number;
  liquidityTrend?: "rising" | "flat" | "falling" | "unknown";
  volumeTrend?: "rising" | "flat" | "falling" | "unknown";
  feeAprTrend?: "rising" | "flat" | "falling" | "unknown";
}

export interface PositionSnapshot {
  pair: "SOL/USDC";
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

export type PerformanceSnapshot = Record<string, unknown>;
