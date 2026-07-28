export type OnChainFlowDirection = "inbound" | "outbound";

export type OnChainAddressContext =
  | {
      readonly addressType: "wallet";
      readonly address: string;
    }
  | {
      readonly addressType: "contract";
      readonly address: string;
    };

export type OnChainFlowFreshnessContext = {
  readonly slot?: number;
  readonly blockTimestampUnixMs: number;
};

export type OnChainFlowSourceQuality =
  | {
      readonly provider: "helius-api";
      readonly freshness: "realtime";
      readonly completeness: "full" | "partial";
    }
  | {
      readonly provider: "birdeye-api";
      readonly freshness: "windowed";
      readonly completeness: "full" | "partial";
    };

export type StablecoinOperation = "mint" | "burn" | "transfer";

export type WhaleTransferPayloadV1 = {
  readonly schemaVersion: 1;
  readonly eventFamily: "on_chain_flow";
  readonly eventType: "whale_transfer";
  readonly sourceEventId: string;
  readonly observedAtUnixMs: number;
  readonly amountUsdc: string;
  readonly direction: OnChainFlowDirection;
  readonly venue: "solana";
  readonly addressContext: OnChainAddressContext;
  readonly sourceReferences: readonly string[];
  readonly sourceQuality: OnChainFlowSourceQuality;
  readonly freshnessContext: OnChainFlowFreshnessContext;
  readonly transactionSignature: string;
  readonly eventIndex: number;
  readonly slot: number;
  readonly stablecoinOperation: StablecoinOperation;
};

export type WhaleSwapPayloadV1 = {
  readonly schemaVersion: 1;
  readonly eventFamily: "on_chain_flow";
  readonly eventType: "whale_swap";
  readonly sourceEventId: string;
  readonly observedAtUnixMs: number;
  readonly amountUsdc: string;
  readonly direction: OnChainFlowDirection;
  readonly venue: "solana";
  readonly addressContext: OnChainAddressContext;
  readonly sourceReferences: readonly string[];
  readonly sourceQuality: OnChainFlowSourceQuality;
  readonly freshnessContext: OnChainFlowFreshnessContext;
  readonly transactionSignature: string;
  readonly eventIndex: number;
  readonly slot?: number;
  readonly stablecoinOperation: StablecoinOperation;
};

export type StablecoinFlowPayloadV1 = {
  readonly schemaVersion: 1;
  readonly eventFamily: "on_chain_flow";
  readonly eventType: "stablecoin_flow";
  readonly sourceEventId: string;
  readonly observedAtUnixMs: number;
  readonly amountUsdc: string;
  readonly direction: OnChainFlowDirection;
  readonly venue: "solana";
  readonly addressContext: OnChainAddressContext;
  readonly sourceReferences: readonly string[];
  readonly sourceQuality: OnChainFlowSourceQuality;
  readonly freshnessContext: OnChainFlowFreshnessContext;
  readonly transactionSignature: string;
  readonly eventIndex: number;
  readonly slot: number;
  readonly stablecoinOperation: StablecoinOperation;
};

export type DexNetFlowPayloadV1 = {
  readonly schemaVersion: 1;
  readonly eventFamily: "on_chain_flow";
  readonly eventType: "dex_net_flow";
  readonly sourceEventId: string;
  readonly observedAtUnixMs: number;
  readonly amountUsdc: string;
  readonly direction: OnChainFlowDirection;
  readonly venue: string;
  readonly addressContext: OnChainAddressContext;
  readonly sourceReferences: readonly string[];
  readonly sourceQuality: OnChainFlowSourceQuality;
  readonly freshnessContext: OnChainFlowFreshnessContext;
  readonly windowStartUnixMs: number;
  readonly windowEndUnixMs: number;
  readonly buyVolumeUsdc: string;
  readonly sellVolumeUsdc: string;
  readonly netFlowUsdc: string;
};

export type CexFlowProxyPayloadV1 = {
  readonly schemaVersion: 1;
  readonly eventFamily: "on_chain_flow";
  readonly eventType: "cex_flow_proxy";
  readonly sourceEventId: string;
  readonly observedAtUnixMs: number;
  readonly amountUsdc: string;
  readonly direction: OnChainFlowDirection;
  readonly venue: "cex";
  readonly addressContext: OnChainAddressContext;
  readonly sourceReferences: readonly string[];
  readonly sourceQuality: OnChainFlowSourceQuality;
  readonly freshnessContext: OnChainFlowFreshnessContext;
  readonly quality: "proxy";
  readonly attributionConfidence: number;
  readonly attributionProvider: "helius-api";
  readonly caveats: readonly string[];
};

export type OnChainFlowPayloadV1 =
  | WhaleTransferPayloadV1
  | WhaleSwapPayloadV1
  | StablecoinFlowPayloadV1
  | DexNetFlowPayloadV1
  | CexFlowProxyPayloadV1;

export interface OnChainFlowThresholds {
  readonly whaleTransferMinUsdc: string;
  readonly whaleSwapMinUsdc: string;
  readonly stablecoinFlowMinUsdc: string;
  readonly dexNetFlowMinUsdc: string;
  readonly cexFlowProxyMinUsdc: string;
  readonly cexMinAttributionConfidence: number;
}
