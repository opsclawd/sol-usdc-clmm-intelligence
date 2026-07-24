export interface HeliusTransactionFlowEvent {
  readonly eventKind: "helius_transaction";
  readonly transactionHash: string;
  readonly slot: number;
  readonly timestampUnixMs: number;
  readonly flowSide: "buy" | "sell";
  readonly nativeAmount: number;
  readonly sourceReferences: readonly string[];
}

export interface BirdeyeNetFlowEvent {
  readonly eventKind: "birdeye_net_flow";
  readonly timestampUnixMs: number;
  readonly buyVolume: number;
  readonly sellVolume: number;
  readonly netFlow: number;
  readonly sourceReferences: readonly string[];
}

export type OnChainFlowSourceEvent = HeliusTransactionFlowEvent | BirdeyeNetFlowEvent;

export function makeHeliusTransactionFlowEvent(
  overrides?: Partial<HeliusTransactionFlowEvent>
): HeliusTransactionFlowEvent {
  return {
    eventKind: "helius_transaction",
    transactionHash: "txn_abc123",
    slot: 123456789,
    timestampUnixMs: 1700000000000,
    flowSide: "buy",
    nativeAmount: 1000000000,
    sourceReferences: ["https://helius.xyz/txn/txn_abc123"],
    ...overrides
  };
}

export function makeBirdeyeNetFlowEvent(
  overrides?: Partial<BirdeyeNetFlowEvent>
): BirdeyeNetFlowEvent {
  return {
    eventKind: "birdeye_net_flow",
    timestampUnixMs: 1700000000000,
    buyVolume: 50000000000,
    sellVolume: 30000000000,
    netFlow: 20000000000,
    sourceReferences: ["https://birdeye.xyz/token/SOL"],
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
    source: overrides?.source ?? "helius-api",
    providerId: overrides?.providerId ?? "test-provider",
    providerRunId: overrides?.providerRunId ?? "run-001",
    asOfUnixMs: overrides?.asOfUnixMs ?? 1700000000000,
    license: overrides?.license ?? "CC0-1.0",
    retention: "bounded",
    events: overrides?.events ?? [makeHeliusTransactionFlowEvent()],
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
