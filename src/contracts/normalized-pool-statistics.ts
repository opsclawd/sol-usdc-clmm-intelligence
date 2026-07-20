export type PoolStatisticsWarning =
  | "tvl_unavailable"
  | "volume_24h_unavailable"
  | "fees_24h_unavailable"
  | "provider_warning"
  | "stale_observation";

export interface PoolStatisticsPayloadV1 {
  readonly kind: "pool_statistics";
  readonly schemaVersion: 1;
  readonly pair: "SOL/USDC";
  readonly poolId: string;
  readonly observedAtUnixMs: number;
  readonly observedSlot: number;
  readonly window: "24h";
  readonly tvlUsdc: string | null;
  readonly volume24hUsdc: string | null;
  readonly fees24hUsdc: string | null;
  readonly warnings: readonly PoolStatisticsWarning[];
  readonly sourceQuality: {
    readonly providerWarning: boolean;
    readonly completeness: "complete" | "partial";
  };
}

export type PoolStatisticsNormalizedCandidate = PoolStatisticsPayloadV1;
