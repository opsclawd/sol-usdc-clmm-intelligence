export interface OnChainFlowSourceRequest {
  readonly pair: "SOL/USDC";
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

export interface BirdeyeNetFlowEvent {
  readonly eventKind: "birdeye_net_flow";
  readonly timestampUnixMs: number;
  readonly buyVolume: number;
  readonly sellVolume: number;
  readonly netFlow: number;
  readonly sourceReferences: readonly string[];
}

export type OnChainFlowSourceEvent = HeliusTransactionFlowEvent | BirdeyeNetFlowEvent;

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
