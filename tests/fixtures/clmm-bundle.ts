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
} from "../../src/contracts/clmm-bundle.js";

export function makeFeeAmount(overrides?: Partial<FeeAmount>): FeeAmount {
  return {
    raw: "1000000",
    decimals: 6,
    symbol: "USDC",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    ...overrides
  };
}

export function makeRewardAmount(overrides?: Partial<RewardAmount>): RewardAmount {
  return {
    mint: "So11111111111111111111111111111111111111112",
    raw: "500000000",
    decimals: 9,
    symbol: "SOL",
    ...overrides
  };
}

export function makeSrLevel(overrides?: Partial<SrLevel>): SrLevel {
  return {
    price: 150.5,
    rank: "1h",
    timeframe: "1h",
    invalidation: 149.0,
    notes: "key level",
    ...overrides
  };
}

export function makeSrLevels(overrides?: Partial<SrLevels>): SrLevels {
  return {
    briefId: "brief-001",
    sourceRecordedAtIso: "2024-01-15T10:30:00.000Z",
    summary: "SOL/USDC resistance at 150.5",
    capturedAtUnixMs: 1705315800000,
    supports: [makeSrLevel({ price: 140.0, rank: undefined, timeframe: undefined })],
    resistances: [makeSrLevel()],
    ...overrides
  };
}

export function makePoolData(overrides?: Partial<PoolData>): PoolData {
  return {
    poolId: "pool-solusdc-123",
    pair: "SOL/USDC",
    source: "orca",
    observedAtUnixMs: 1705315800000,
    tokenPairLabel: "SOL/USDC",
    currentPrice: 149.85,
    currentPriceLabel: "149.85",
    sqrtPrice: "122345678901234567890",
    tickCurrentIndex: 49800,
    tickSpacing: 60,
    feeRate: 0.0005,
    feeRateLabel: "0.05%",
    poolLiquidity: "9876543210",
    priceSource: "orca_whirlpool_sqrt_price",
    ...overrides
  };
}

export function makePositionData(overrides?: Partial<PositionData>): PositionData {
  return {
    walletId: "wallet-abc-456",
    positionId: "position-001",
    poolId: "pool-solusdc-123",
    pair: "SOL/USDC",
    source: "orca",
    observedAtUnixMs: 1705315800000,
    rangeState: "in-range",
    lowerTick: 49500,
    upperTick: 50100,
    currentTick: 49800,
    lowerPriceLabel: "145.20",
    upperPriceLabel: "155.80",
    currentPrice: 149.85,
    currentPriceLabel: "149.85",
    rangeDistance: {
      belowLowerTickPercent: -3.1,
      aboveUpperTickPercent: 3.97,
      belowLowerPricePercent: 3.1,
      aboveUpperPricePercent: undefined
    },
    feeRateLabel: "0.05%",
    unclaimedFees: {
      feeOwedA: makeFeeAmount({
        mint: "So11111111111111111111111111111111111111112",
        symbol: "SOL"
      }),
      feeOwedB: makeFeeAmount()
    },
    unclaimedRewards: [makeRewardAmount()],
    unclaimedFeesUsd: 12.34,
    unclaimedRewardsUsd: 56.78,
    positionLiquidity: "1234567890",
    poolLiquidity: "9876543210",
    hasActionableTrigger: true,
    triggerId: "trigger-001",
    breachDirection: undefined,
    ...overrides
  };
}

export function makeAlertData(overrides?: Partial<AlertData>): AlertData {
  return {
    triggerId: "trigger-001",
    positionId: "position-001",
    breachDirection: "lower-bound-breach",
    triggeredAt: 1705315800000,
    ...overrides
  };
}

export function makeDataQuality(overrides?: Partial<DataQuality>): DataQuality {
  return {
    warnings: [],
    isPartial: false,
    missingSources: [],
    ...overrides
  };
}

export interface ClmmBundleOverrides {
  pool?: Partial<PoolData>;
  positions?: Array<Partial<PositionData>>;
  alerts?: Array<Partial<AlertData>>;
  srLevels?: Partial<SrLevels> | null;
  dataQuality?: Partial<DataQuality>;
  observedAtUnixMs?: number;
}

export function makeClmmBundle(overrides?: ClmmBundleOverrides): ClmmBundle {
  const observedAtUnixMs = overrides?.observedAtUnixMs ?? 1705315800000;

  const poolOverrides = overrides?.pool ?? {};
  const pool = makePoolData({
    observedAtUnixMs,
    ...poolOverrides
  });

  const positionOverrides = overrides?.positions ?? [{}];
  const positions: PositionData[] = positionOverrides.map((posOverride) =>
    makePositionData({
      observedAtUnixMs,
      poolId: pool.poolId,
      ...posOverride
    })
  );

  const alertOverrides = overrides?.alerts ?? [{}];
  const alerts: AlertData[] = alertOverrides.map((alertOverride) =>
    makeAlertData({
      ...alertOverride
    })
  );

  const srLevels = overrides?.srLevels !== undefined ? overrides.srLevels : makeSrLevels();

  return {
    pair: "SOL/USDC",
    source: "orca",
    observedAtUnixMs,
    pool,
    srLevels,
    positions,
    alerts,
    dataQuality: makeDataQuality(overrides?.dataQuality)
  };
}

export function makeClmmBundleEnvelope(bundle: ClmmBundle): { bundle: ClmmBundle; status: string } {
  return {
    bundle,
    status: "ok"
  };
}
