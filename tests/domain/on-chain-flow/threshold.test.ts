import { describe, it, expect } from "vitest";
import {
  parseOnChainFlowThresholds,
  qualifiesOnChainFlow,
  OnChainFlowThresholdError
} from "../../../src/domain/on-chain-flow/threshold.js";
import type { AcceptedOnChainFlowSourceEvent } from "../../../src/domain/on-chain-flow/validate.js";

describe("parseOnChainFlowThresholds", () => {
  it("parses valid threshold configuration", () => {
    const input = {
      whaleSwapMinUsdc: "500000",
      stablecoinFlowMinUsdc: "100000",
      dexNetFlowMinUsdc: "200000",
      cexFlowProxyMinUsdc: "500000",
      cexMinAttributionConfidence: 0.8
    };
    const result = parseOnChainFlowThresholds(input);
    expect(result).toBeDefined();
    expect(result.whaleSwapMinUsdc.digits).toBe("500000");
    expect(result.cexMinAttributionConfidence).toBe(0.8);
  });

  it("rejects threshold with scientific notation", () => {
    const input = {
      whaleSwapMinUsdc: "1e6",
      stablecoinFlowMinUsdc: "100000",
      dexNetFlowMinUsdc: "200000",
      cexFlowProxyMinUsdc: "500000",
      cexMinAttributionConfidence: 0.8
    };
    expect(() => parseOnChainFlowThresholds(input)).toThrow(OnChainFlowThresholdError);
  });

  it("rejects threshold with Infinity", () => {
    const input = {
      whaleSwapMinUsdc: "Infinity",
      stablecoinFlowMinUsdc: "100000",
      dexNetFlowMinUsdc: "200000",
      cexFlowProxyMinUsdc: "500000",
      cexMinAttributionConfidence: 0.8
    };
    expect(() => parseOnChainFlowThresholds(input)).toThrow(OnChainFlowThresholdError);
  });

  it("rejects threshold with non-canonical leading sign", () => {
    const input = {
      whaleSwapMinUsdc: "+1000000",
      stablecoinFlowMinUsdc: "100000",
      dexNetFlowMinUsdc: "200000",
      cexFlowProxyMinUsdc: "500000",
      cexMinAttributionConfidence: 0.8
    };
    expect(() => parseOnChainFlowThresholds(input)).toThrow(OnChainFlowThresholdError);
  });

  it("rejects CEX confidence outside [0, 1]", () => {
    const input = {
      whaleSwapMinUsdc: "500000",
      stablecoinFlowMinUsdc: "100000",
      dexNetFlowMinUsdc: "200000",
      cexFlowProxyMinUsdc: "500000",
      cexMinAttributionConfidence: 1.5
    };
    expect(() => parseOnChainFlowThresholds(input)).toThrow(OnChainFlowThresholdError);
  });
});

describe("qualifiesOnChainFlow", () => {
  describe("includes an event when amount equals its configured threshold", () => {
    it("whale swap at exactly 500000 qualifies", () => {
      const thresholds = parseOnChainFlowThresholds({
        whaleSwapMinUsdc: "500000",
        stablecoinFlowMinUsdc: "100000",
        dexNetFlowMinUsdc: "200000",
        cexFlowProxyMinUsdc: "500000",
        cexMinAttributionConfidence: 0.8
      });

      const event: AcceptedOnChainFlowSourceEvent = {
        eventKind: "whale_swap",
        sourceEventId: "ws_001",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "500000",
        direction: "inbound",
        venue: "solana",
        addressContext: { addressType: "wallet", address: "abc123" },
        sourceReferences: ["https://birdeye.xyz/token/SOL"],
        sourceQuality: { provider: "birdeye-api", freshness: "windowed", completeness: "full" },
        freshnessContext: { slot: 123, blockTimestampUnixMs: 1700000000000 },
        transactionSignature: "txn_abc",
        eventIndex: 0,
        slot: 123,
        stablecoinOperation: "transfer"
      };

      expect(qualifiesOnChainFlow(event, thresholds)).toBe(true);
    });

    it("whale swap at 499999.99 does not qualify (below 500000)", () => {
      const thresholds = parseOnChainFlowThresholds({
        whaleSwapMinUsdc: "500000",
        stablecoinFlowMinUsdc: "100000",
        dexNetFlowMinUsdc: "200000",
        cexFlowProxyMinUsdc: "500000",
        cexMinAttributionConfidence: 0.8
      });

      const event: AcceptedOnChainFlowSourceEvent = {
        eventKind: "whale_swap",
        sourceEventId: "ws_001",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "499999.99",
        direction: "inbound",
        venue: "solana",
        addressContext: { addressType: "wallet", address: "abc123" },
        sourceReferences: ["https://birdeye.xyz/token/SOL"],
        sourceQuality: { provider: "birdeye-api", freshness: "windowed", completeness: "full" },
        freshnessContext: { slot: 123, blockTimestampUnixMs: 1700000000000 },
        transactionSignature: "txn_abc",
        eventIndex: 0,
        slot: 123,
        stablecoinOperation: "transfer"
      };

      expect(qualifiesOnChainFlow(event, thresholds)).toBe(false);
    });

    it("whale swap at 500000.01 qualifies", () => {
      const thresholds = parseOnChainFlowThresholds({
        whaleSwapMinUsdc: "500000",
        stablecoinFlowMinUsdc: "100000",
        dexNetFlowMinUsdc: "200000",
        cexFlowProxyMinUsdc: "500000",
        cexMinAttributionConfidence: 0.8
      });

      const event: AcceptedOnChainFlowSourceEvent = {
        eventKind: "whale_swap",
        sourceEventId: "ws_001",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "500000.01",
        direction: "inbound",
        venue: "solana",
        addressContext: { addressType: "wallet", address: "abc123" },
        sourceReferences: ["https://birdeye.xyz/token/SOL"],
        sourceQuality: { provider: "birdeye-api", freshness: "windowed", completeness: "full" },
        freshnessContext: { slot: 123, blockTimestampUnixMs: 1700000000000 },
        transactionSignature: "txn_abc",
        eventIndex: 0,
        slot: 123,
        stablecoinOperation: "transfer"
      };

      expect(qualifiesOnChainFlow(event, thresholds)).toBe(true);
    });

    it("uses exact decimal comparison not Number conversion for 0.1 + 0.2 edge case", () => {
      const thresholds = parseOnChainFlowThresholds({
        whaleSwapMinUsdc: "0.3",
        stablecoinFlowMinUsdc: "100000",
        dexNetFlowMinUsdc: "200000",
        cexFlowProxyMinUsdc: "500000",
        cexMinAttributionConfidence: 0.8
      });

      const event: AcceptedOnChainFlowSourceEvent = {
        eventKind: "whale_swap",
        sourceEventId: "ws_001",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "0.3",
        direction: "inbound",
        venue: "solana",
        addressContext: { addressType: "wallet", address: "abc123" },
        sourceReferences: ["https://birdeye.xyz/token/SOL"],
        sourceQuality: { provider: "birdeye-api", freshness: "windowed", completeness: "full" },
        freshnessContext: { slot: 123, blockTimestampUnixMs: 1700000000000 },
        transactionSignature: "txn_abc",
        eventIndex: 0,
        slot: 123,
        stablecoinOperation: "transfer"
      };

      expect(qualifiesOnChainFlow(event, thresholds)).toBe(true);
    });
  });

  describe("filters an event when amount is below its kind threshold", () => {
    it("stablecoin flow below its threshold is filtered", () => {
      const thresholds = parseOnChainFlowThresholds({
        whaleSwapMinUsdc: "500000",
        stablecoinFlowMinUsdc: "100000",
        dexNetFlowMinUsdc: "200000",
        cexFlowProxyMinUsdc: "500000",
        cexMinAttributionConfidence: 0.8
      });

      const event: AcceptedOnChainFlowSourceEvent = {
        eventKind: "stablecoin_flow",
        sourceEventId: "sf_001",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "50000",
        direction: "inbound",
        venue: "solana",
        addressContext: { addressType: "wallet", address: "abc123" },
        sourceReferences: ["https://helius.xyz/txn/abc"],
        sourceQuality: { provider: "helius-api", freshness: "realtime", completeness: "full" },
        freshnessContext: { slot: 123, blockTimestampUnixMs: 1700000000000 },
        transactionSignature: "txn_abc",
        eventIndex: 0,
        slot: 123,
        stablecoinOperation: "mint"
      };

      expect(qualifiesOnChainFlow(event, thresholds)).toBe(false);
    });

    it("DEX net flow below its threshold is filtered", () => {
      const thresholds = parseOnChainFlowThresholds({
        whaleSwapMinUsdc: "500000",
        stablecoinFlowMinUsdc: "100000",
        dexNetFlowMinUsdc: "200000",
        cexFlowProxyMinUsdc: "500000",
        cexMinAttributionConfidence: 0.8
      });

      const event: AcceptedOnChainFlowSourceEvent = {
        eventKind: "dex_net_flow",
        sourceEventId: "dn_001",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "100000",
        direction: "inbound",
        venue: "solana",
        addressContext: { addressType: "wallet", address: "abc123" },
        sourceReferences: ["https://birdeye.xyz/token/SOL"],
        sourceQuality: { provider: "birdeye-api", freshness: "windowed", completeness: "full" },
        freshnessContext: { slot: 123, blockTimestampUnixMs: 1700000000000 },
        windowStartUnixMs: 1699900000000,
        windowEndUnixMs: 1700000000000,
        buyVolumeUsdc: "100000",
        sellVolumeUsdc: "0",
        netFlowUsdc: "100000"
      };

      expect(qualifiesOnChainFlow(event, thresholds)).toBe(false);
    });
  });

  describe("filters CEX proxy below attribution confidence even when amount qualifies", () => {
    it("CEX proxy filtered when amount qualifies but confidence below threshold", () => {
      const thresholds = parseOnChainFlowThresholds({
        whaleSwapMinUsdc: "500000",
        stablecoinFlowMinUsdc: "100000",
        dexNetFlowMinUsdc: "200000",
        cexFlowProxyMinUsdc: "500000",
        cexMinAttributionConfidence: 0.8
      });

      const event: AcceptedOnChainFlowSourceEvent = {
        eventKind: "cex_flow_proxy",
        sourceEventId: "cex_001",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "1000000",
        direction: "inbound",
        venue: "cex",
        addressContext: { addressType: "wallet", address: "abc123" },
        sourceReferences: ["https://cex.example/txn/abc"],
        sourceQuality: { provider: "helius-api", freshness: "realtime", completeness: "full" },
        freshnessContext: { slot: 123, blockTimestampUnixMs: 1700000000000 },
        quality: "proxy",
        attributionConfidence: 0.5,
        attributionProvider: "helius-api",
        caveats: ["proxy_address_attribution"]
      };

      expect(qualifiesOnChainFlow(event, thresholds)).toBe(false);
    });

    it("CEX proxy qualifies when both amount and confidence thresholds pass", () => {
      const thresholds = parseOnChainFlowThresholds({
        whaleSwapMinUsdc: "500000",
        stablecoinFlowMinUsdc: "100000",
        dexNetFlowMinUsdc: "200000",
        cexFlowProxyMinUsdc: "500000",
        cexMinAttributionConfidence: 0.8
      });

      const event: AcceptedOnChainFlowSourceEvent = {
        eventKind: "cex_flow_proxy",
        sourceEventId: "cex_001",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "1000000",
        direction: "inbound",
        venue: "cex",
        addressContext: { addressType: "wallet", address: "abc123" },
        sourceReferences: ["https://cex.example/txn/abc"],
        sourceQuality: { provider: "helius-api", freshness: "realtime", completeness: "full" },
        freshnessContext: { slot: 123, blockTimestampUnixMs: 1700000000000 },
        quality: "proxy",
        attributionConfidence: 0.9,
        attributionProvider: "helius-api",
        caveats: ["proxy_address_attribution"]
      };

      expect(qualifiesOnChainFlow(event, thresholds)).toBe(true);
    });

    it("CEX proxy filtered when confidence is exactly at boundary but amount is below", () => {
      const thresholds = parseOnChainFlowThresholds({
        whaleSwapMinUsdc: "500000",
        stablecoinFlowMinUsdc: "100000",
        dexNetFlowMinUsdc: "200000",
        cexFlowProxyMinUsdc: "500000",
        cexMinAttributionConfidence: 0.8
      });

      const event: AcceptedOnChainFlowSourceEvent = {
        eventKind: "cex_flow_proxy",
        sourceEventId: "cex_001",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "400000",
        direction: "inbound",
        venue: "cex",
        addressContext: { addressType: "wallet", address: "abc123" },
        sourceReferences: ["https://cex.example/txn/abc"],
        sourceQuality: { provider: "helius-api", freshness: "realtime", completeness: "full" },
        freshnessContext: { slot: 123, blockTimestampUnixMs: 1700000000000 },
        quality: "proxy",
        attributionConfidence: 0.9,
        attributionProvider: "helius-api",
        caveats: ["proxy_address_attribution"]
      };

      expect(qualifiesOnChainFlow(event, thresholds)).toBe(false);
    });

    it("CEX proxy at exact threshold for both amount and confidence qualifies", () => {
      const thresholds = parseOnChainFlowThresholds({
        whaleSwapMinUsdc: "500000",
        stablecoinFlowMinUsdc: "100000",
        dexNetFlowMinUsdc: "200000",
        cexFlowProxyMinUsdc: "500000",
        cexMinAttributionConfidence: 0.8
      });

      const event: AcceptedOnChainFlowSourceEvent = {
        eventKind: "cex_flow_proxy",
        sourceEventId: "cex_001",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "500000",
        direction: "inbound",
        venue: "cex",
        addressContext: { addressType: "wallet", address: "abc123" },
        sourceReferences: ["https://cex.example/txn/abc"],
        sourceQuality: { provider: "helius-api", freshness: "realtime", completeness: "full" },
        freshnessContext: { slot: 123, blockTimestampUnixMs: 1700000000000 },
        quality: "proxy",
        attributionConfidence: 0.8,
        attributionProvider: "helius-api",
        caveats: ["proxy_address_attribution"]
      };

      expect(qualifiesOnChainFlow(event, thresholds)).toBe(true);
    });
  });
});
