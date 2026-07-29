export interface OnChainFlowSourceRequest {
  readonly pair: "SOL/USDC";
  readonly walletAddress?: string;
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

export type OnChainFlowSourceEvent =
  | HeliusTransactionFlowEvent
  | BirdeyeWhaleSwapEvent
  | BirdeyeDexNetFlowEvent;

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
