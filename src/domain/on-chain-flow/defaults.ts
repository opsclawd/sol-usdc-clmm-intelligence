import type { OnChainFlowThresholds } from "../../contracts/on-chain-flow.js";

export const DEFAULT_ON_CHAIN_FLOW_THRESHOLDS = {
  whaleTransferMinUsdc: "100000",
  whaleSwapMinUsdc: "100000",
  stablecoinFlowMinUsdc: "1000000",
  dexNetFlowMinUsdc: "250000",
  cexFlowProxyMinUsdc: "1000000",
  cexMinAttributionConfidence: 0.8
} satisfies OnChainFlowThresholds;

export const DEFAULT_ON_CHAIN_FLOW_LOOKBACK_MS = 15 * 60 * 1000;
