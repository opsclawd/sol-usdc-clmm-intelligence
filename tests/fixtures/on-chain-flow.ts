export interface HeliusTransactionFlowEvent {
  readonly eventKind: "helius_transaction";
  readonly transactionHash: string;
  readonly slot: number;
  readonly timestampUnixMs: number;
  readonly flowSide: "buy" | "sell";
  readonly nativeAmount: number;
  readonly sourceReferences: string[];
}

export interface BirdeyeWhaleSwapEvent {
  readonly eventKind: "whale_swap";
  readonly sourceEventId: string;
  readonly observedAtUnixMs: number;
  readonly amountUsdc: string;
  readonly direction: "inbound" | "outbound";
  readonly venue: "solana";
  readonly addressContext: {
    readonly addressType: "wallet" | "contract";
    readonly address: string;
  };
  readonly sourceReferences: readonly string[];
  readonly sourceQuality: {
    readonly provider: "birdeye-api";
    readonly freshness: "windowed";
    readonly completeness: "full" | "partial";
  };
  readonly freshnessContext: {
    readonly blockTimestampUnixMs: number;
    readonly slot?: number;
  };
  readonly transactionSignature: string;
  readonly eventIndex: number;
  readonly stablecoinOperation: "mint" | "burn" | "transfer";
  readonly solDelta?: number;
  readonly usdcDelta?: number;
}

export interface BirdeyeDexNetFlowEvent {
  readonly eventKind: "dex_net_flow";
  readonly sourceEventId: string;
  readonly observedAtUnixMs: number;
  readonly amountUsdc: string;
  readonly direction: "inbound" | "outbound";
  readonly venue: string;
  readonly addressContext: {
    readonly addressType: "wallet" | "contract";
    readonly address: string;
  };
  readonly sourceReferences: readonly string[];
  readonly sourceQuality: {
    readonly provider: "birdeye-api";
    readonly freshness: "windowed";
    readonly completeness: "full" | "partial";
  };
  readonly freshnessContext: {
    readonly blockTimestampUnixMs: number;
    readonly slot?: number;
  };
  readonly windowStartUnixMs: number;
  readonly windowEndUnixMs: number;
  readonly buyVolumeUsdc: string;
  readonly sellVolumeUsdc: string;
  readonly netFlowUsdc: string;
}

export type OnChainFlowSourceEvent = BirdeyeWhaleSwapEvent | BirdeyeDexNetFlowEvent;

export function makeBirdeyeWhaleSwapEvent(
  overrides?: Partial<BirdeyeWhaleSwapEvent>
): BirdeyeWhaleSwapEvent {
  return {
    eventKind: "whale_swap",
    sourceEventId: "birdeye-ws-001",
    observedAtUnixMs: 1700000000000,
    amountUsdc: "50000000",
    direction: "inbound",
    venue: "solana",
    addressContext: { addressType: "wallet", address: "WalletXYZ" },
    sourceReferences: ["https://birdeye.xyz/token/SOL"],
    sourceQuality: {
      provider: "birdeye-api",
      freshness: "windowed",
      completeness: "full"
    },
    freshnessContext: { blockTimestampUnixMs: 1700000000000 },
    transactionSignature: "birdeye_tx_sig_001",
    eventIndex: 0,
    stablecoinOperation: "transfer",
    ...overrides
  };
}

export function makeBirdeyeDexNetFlowEvent(
  overrides?: Partial<BirdeyeDexNetFlowEvent>
): BirdeyeDexNetFlowEvent {
  return {
    eventKind: "dex_net_flow",
    sourceEventId: "birdeye-dn-001",
    observedAtUnixMs: 1700000000000,
    amountUsdc: "20000000000",
    direction: "inbound",
    venue: "solana",
    addressContext: { addressType: "wallet", address: "birdeye-aggregated" },
    sourceReferences: ["https://birdeye.xyz/token/SOL"],
    sourceQuality: {
      provider: "birdeye-api",
      freshness: "windowed",
      completeness: "full"
    },
    freshnessContext: { blockTimestampUnixMs: 1700000000000 },
    windowStartUnixMs: 1699913600000,
    windowEndUnixMs: 1700000000000,
    buyVolumeUsdc: "50000000000",
    sellVolumeUsdc: "30000000000",
    netFlowUsdc: "20000000000",
    ...overrides
  };
}

export interface OnChainFlowSourceSnapshotOverrides {
  source?: "helius-api" | "birdeye-api";
  providerId?: string;
  providerRunId?: string;
  asOfUnixMs?: number;
  license?: string;
  events?: readonly OnChainFlowSourceEvent[];
  extraField?: unknown;
}

export function makeOnChainFlowSourceSnapshot(overrides?: OnChainFlowSourceSnapshotOverrides): {
  source: "helius-api" | "birdeye-api";
  providerId: string;
  providerRunId: string;
  asOfUnixMs: number;
  license: string;
  retention: "bounded";
  events: readonly OnChainFlowSourceEvent[];
  extraField?: unknown;
} {
  return {
    source: overrides?.source ?? "birdeye-api",
    providerId: overrides?.providerId ?? "test-provider",
    providerRunId: overrides?.providerRunId ?? "run-001",
    asOfUnixMs: overrides?.asOfUnixMs ?? 1700000000000,
    license: overrides?.license ?? "CC0-1.0",
    retention: "bounded",
    events: overrides?.events ?? [makeBirdeyeDexNetFlowEvent()],
    ...(overrides?.extraField !== undefined ? { extraField: overrides.extraField } : {})
  };
}

export function makeEmptyOnChainFlowSourceSnapshot(
  overrides?: Partial<OnChainFlowSourceSnapshotOverrides>
): {
  source: "helius-api" | "birdeye-api";
  providerId: string;
  providerRunId: string;
  asOfUnixMs: number;
  license: string;
  retention: "bounded";
  events: readonly [];
} {
  return {
    source: overrides?.source ?? "helius-api",
    providerId: overrides?.providerId ?? "test-provider",
    providerRunId: overrides?.providerRunId ?? "run-001",
    asOfUnixMs: overrides?.asOfUnixMs ?? 1700000000000,
    license: overrides?.license ?? "CC0-1.0",
    retention: "bounded",
    events: []
  };
}

export function makeMalformedEnvelope(
  overrides?: Record<string, unknown>
): Record<string, unknown> {
  return {
    providerId: "test-provider",
    providerRunId: "run-001",
    asOfUnixMs: 1700000000000,
    license: "CC0-1.0",
    events: [],
    ...overrides
  };
}
