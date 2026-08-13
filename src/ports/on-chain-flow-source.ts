export interface OnChainFlowSourceRequest {
  readonly pair: "SOL/USDC";
  readonly walletAddress?: string;
  // What `walletAddress` actually is. The deployed collector observes the
  // whirlpool, so events must not be labelled as wallet activity. Defaults to
  // "wallet" for callers that predate pool routing.
  readonly addressType?: "wallet" | "contract";
  readonly fromUnixMs: number;
  readonly toUnixMs: number;
}

export interface HeliusTransactionFlowEvent {
  readonly eventKind: "helius_transaction";
  readonly transactionHash: string;
  readonly slot: number;
  readonly timestampUnixMs: number;
  readonly flowSide: "buy" | "sell";
  readonly nativeAmount: number;
  readonly sourceReferences: readonly string[];
}

export interface BirdeyeWhaleSwapEvent {
  readonly eventKind: "whale_swap";
  readonly sourceEventId: string;
  readonly observedAtUnixMs: number;
  readonly amountUsdc: string;
  readonly direction: "inbound" | "outbound";
  readonly venue: "solana";
  readonly addressContext: { readonly addressType: "wallet"; readonly address: string };
  readonly sourceReferences: readonly string[];
  readonly sourceQuality: {
    readonly provider: "birdeye-api";
    readonly freshness: "windowed";
    readonly completeness: "full";
  };
  readonly freshnessContext: { readonly blockTimestampUnixMs: number };
  readonly transactionSignature: string;
  readonly eventIndex: 0;
  readonly stablecoinOperation: "transfer";
}

export interface BirdeyeDexNetFlowEvent {
  readonly eventKind: "dex_net_flow";
  readonly sourceEventId: string;
  readonly observedAtUnixMs: number;
  readonly amountUsdc: string;
  readonly direction: "inbound" | "outbound";
  readonly venue: "solana";
  readonly addressContext: { readonly addressType: "contract"; readonly address: string };
  readonly sourceReferences: readonly string[];
  readonly sourceQuality: {
    readonly provider: "birdeye-api";
    readonly freshness: "windowed";
    readonly completeness: "full";
  };
  readonly freshnessContext: { readonly blockTimestampUnixMs: number };
  readonly windowStartUnixMs: number;
  readonly windowEndUnixMs: number;
  readonly buyVolumeUsdc: string;
  readonly sellVolumeUsdc: string;
  readonly netFlowUsdc: string;
}

export interface HeliusDexNetFlowEvent {
  readonly eventKind: "dex_net_flow";
  readonly sourceEventId: string;
  readonly observedAtUnixMs: number;
  readonly amountUsdc: string;
  readonly direction: "inbound" | "outbound";
  readonly venue: "solana";
  readonly addressContext: { readonly addressType: "contract"; readonly address: string };
  readonly sourceReferences: readonly string[];
  readonly sourceQuality: {
    readonly provider: "helius-api";
    readonly freshness: "windowed";
    readonly completeness: "full" | "partial";
  };
  readonly freshnessContext: { readonly blockTimestampUnixMs: number };
  readonly windowStartUnixMs: number;
  readonly windowEndUnixMs: number;
  readonly buyVolumeUsdc: string;
  readonly sellVolumeUsdc: string;
  readonly netFlowUsdc: string;
}

export interface HeliusWhaleTransferEvent {
  readonly eventKind: "whale_transfer";
  readonly sourceEventId: string;
  readonly observedAtUnixMs: number;
  readonly amountUsdc: string;
  readonly direction: "inbound" | "outbound";
  readonly venue: "solana";
  // "contract" when the observed address is the whirlpool (market flow, the
  // deployed configuration); "wallet" when it is an ordinary account.
  readonly addressContext: {
    readonly addressType: "wallet" | "contract";
    readonly address: string;
  };
  readonly sourceReferences: readonly string[];
  readonly sourceQuality: {
    readonly provider: "helius-api";
    readonly freshness: "realtime";
    readonly completeness: "full" | "partial";
  };
  readonly freshnessContext: {
    readonly slot: number;
    readonly blockTimestampUnixMs: number;
  };
  readonly transactionSignature: string;
  readonly eventIndex: number;
  readonly slot: number;
  readonly stablecoinOperation: "transfer";
}

export type OnChainFlowSourceEvent =
  | HeliusTransactionFlowEvent
  | BirdeyeWhaleSwapEvent
  | BirdeyeDexNetFlowEvent
  | HeliusDexNetFlowEvent
  | HeliusWhaleTransferEvent;

export interface OnChainFlowSourceSnapshot {
  readonly source: "helius-api" | "birdeye-api";
  readonly providerId: string;
  readonly providerRunId: string;
  readonly asOfUnixMs: number;
  readonly license: string;
  readonly retention: "bounded";
  readonly events: readonly OnChainFlowSourceEvent[];
}

export type OnChainFlowSourceError =
  | { kind: "timeout"; diagnostic: string }
  | { kind: "network"; diagnostic: string }
  | { kind: "unavailable"; diagnostic: string }
  | { kind: "malformed"; diagnostic: string };

export interface OnChainFlowSourcePort {
  collect(request: OnChainFlowSourceRequest): Promise<OnChainFlowSourceSnapshot>;
}
