import { describe, it, expect } from "vitest";
import {
  makeHeliusTransactionFlowEvent,
  makeBirdeyeNetFlowEvent
} from "../../fixtures/on-chain-flow.js";
import {
  acceptOnChainFlowSourceEvent,
  OnChainFlowValidationError
} from "../../../src/domain/on-chain-flow/validate.js";

describe("acceptOnChainFlowSourceEvent", () => {
  describe("accepts canonical factual events and rejects unknown or narrative fields", () => {
    it("accepts valid Helius transaction flow event", () => {
      const event = makeHeliusTransactionFlowEvent();
      const result = acceptOnChainFlowSourceEvent(event);
      expect(result).toBeDefined();
      expect(result.eventKind).toBe("helius_transaction");
    });

    it("accepts valid Birdeye net flow event", () => {
      const event = makeBirdeyeNetFlowEvent();
      const result = acceptOnChainFlowSourceEvent(event);
      expect(result).toBeDefined();
      expect(result.eventKind).toBe("birdeye_net_flow");
    });

    it("rejects event with motive field (narrative)", () => {
      const event = {
        ...makeHeliusTransactionFlowEvent(),
        motive: "This is a whale accumulating"
      };
      expect(() => acceptOnChainFlowSourceEvent(event)).toThrow(OnChainFlowValidationError);
    });

    it("rejects event with recommendation field (narrative)", () => {
      const event = {
        ...makeHeliusTransactionFlowEvent(),
        recommendation: "buy more SOL"
      };
      expect(() => acceptOnChainFlowSourceEvent(event)).toThrow(OnChainFlowValidationError);
    });

    it("rejects event with NaN amount", () => {
      const event = {
        ...makeHeliusTransactionFlowEvent(),
        nativeAmount: NaN
      };
      expect(() => acceptOnChainFlowSourceEvent(event)).toThrow(OnChainFlowValidationError);
    });

    it("rejects event with negative unsigned amount", () => {
      const event = makeHeliusTransactionFlowEvent({
        nativeAmount: -1000000
      } as Record<string, unknown>);
      expect(() => acceptOnChainFlowSourceEvent(event)).toThrow(OnChainFlowValidationError);
    });

    it("rejects event with Infinity timestamp", () => {
      const event = {
        ...makeHeliusTransactionFlowEvent(),
        timestampUnixMs: Infinity
      };
      expect(() => acceptOnChainFlowSourceEvent(event)).toThrow(OnChainFlowValidationError);
    });

    it("rejects Birdeye event with invalid time window (windowEnd before windowStart)", () => {
      const event = {
        eventKind: "birdeye_net_flow" as const,
        timestampUnixMs: 1700000000000,
        buyVolume: "50000000000",
        sellVolume: "30000000000",
        netFlow: "20000000000",
        sourceReferences: ["https://birdeye.xyz/token/SOL"],
        windowStartUnixMs: 1700000000000,
        windowEndUnixMs: 1699999999000
      };
      expect(() => acceptOnChainFlowSourceEvent(event)).toThrow(OnChainFlowValidationError);
    });

    it("rejects event with missing sourceReferences", () => {
      const event = {
        eventKind: "helius_transaction" as const,
        transactionHash: "txn_abc123",
        slot: 123456789,
        timestampUnixMs: 1700000000000,
        flowSide: "buy" as const,
        nativeAmount: 1000000000
      };
      expect(() => acceptOnChainFlowSourceEvent(event)).toThrow(OnChainFlowValidationError);
    });

    it("rejects event with empty sourceReferences", () => {
      const event = makeHeliusTransactionFlowEvent({
        sourceReferences: []
      });
      expect(() => acceptOnChainFlowSourceEvent(event)).toThrow(OnChainFlowValidationError);
    });

    it("rejects scientific notation in amount string", () => {
      const event = {
        eventKind: "whale_transfer" as const,
        sourceEventId: "wt_001",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "1e6",
        direction: "inbound" as const,
        venue: "solana" as const,
        addressContext: { addressType: "wallet" as const, address: "abc123" },
        sourceReferences: ["https://helius.xyz/txn/abc"],
        sourceQuality: {
          provider: "helius-api" as const,
          freshness: "realtime" as const,
          completeness: "full" as const
        },
        freshnessContext: { slot: 123, blockTimestampUnixMs: 1700000000000 },
        transactionSignature: "txn_abc",
        eventIndex: 0,
        slot: 123,
        stablecoinOperation: "transfer" as const
      };
      expect(() => acceptOnChainFlowSourceEvent(event)).toThrow(OnChainFlowValidationError);
    });

    it("rejects Infinity in amount string", () => {
      const event = {
        eventKind: "whale_transfer" as const,
        sourceEventId: "wt_001",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "Infinity",
        direction: "inbound" as const,
        venue: "solana" as const,
        addressContext: { addressType: "wallet" as const, address: "abc123" },
        sourceReferences: ["https://helius.xyz/txn/abc"],
        sourceQuality: {
          provider: "helius-api" as const,
          freshness: "realtime" as const,
          completeness: "full" as const
        },
        freshnessContext: { slot: 123, blockTimestampUnixMs: 1700000000000 },
        transactionSignature: "txn_abc",
        eventIndex: 0,
        slot: 123,
        stablecoinOperation: "transfer" as const
      };
      expect(() => acceptOnChainFlowSourceEvent(event)).toThrow(OnChainFlowValidationError);
    });

    it("rejects non-canonical leading sign (e.g. + prefix) in transactionHash", () => {
      const event = {
        ...makeHeliusTransactionFlowEvent(),
        transactionHash: "+txn_abc123"
      };
      expect(() => acceptOnChainFlowSourceEvent(event)).toThrow(OnChainFlowValidationError);
    });

    it("rejects CEX attribution confidence outside [0, 1] range (> 1)", () => {
      const event = {
        eventKind: "cex_flow_proxy" as const,
        sourceEventId: "cex_001",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "5000000",
        direction: "inbound" as const,
        venue: "cex" as const,
        addressContext: { addressType: "wallet" as const, address: "abc123" },
        sourceReferences: ["https://cex.example/txn/abc"],
        sourceQuality: {
          provider: "helius-api" as const,
          freshness: "realtime" as const,
          completeness: "full" as const
        },
        freshnessContext: { slot: 123, blockTimestampUnixMs: 1700000000000 },
        attributionConfidence: 1.5,
        attributionProvider: "helius-api",
        caveats: []
      };
      expect(() => acceptOnChainFlowSourceEvent(event)).toThrow(OnChainFlowValidationError);
    });

    it("rejects CEX attribution confidence outside [0, 1] range (< 0)", () => {
      const event = {
        eventKind: "cex_flow_proxy" as const,
        sourceEventId: "cex_001",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "5000000",
        direction: "inbound" as const,
        venue: "cex" as const,
        addressContext: { addressType: "wallet" as const, address: "abc123" },
        sourceReferences: ["https://cex.example/txn/abc"],
        sourceQuality: {
          provider: "helius-api" as const,
          freshness: "realtime" as const,
          completeness: "full" as const
        },
        freshnessContext: { slot: 123, blockTimestampUnixMs: 1700000000000 },
        attributionConfidence: -0.1,
        attributionProvider: "helius-api",
        caveats: []
      };
      expect(() => acceptOnChainFlowSourceEvent(event)).toThrow(OnChainFlowValidationError);
    });

    it("accepts CEX attribution confidence of exactly 0", () => {
      const event = {
        eventKind: "cex_flow_proxy" as const,
        sourceEventId: "cex_001",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "5000000",
        direction: "inbound" as const,
        venue: "cex" as const,
        addressContext: { addressType: "wallet" as const, address: "abc123" },
        sourceReferences: ["https://cex.example/txn/abc"],
        sourceQuality: {
          provider: "helius-api" as const,
          freshness: "realtime" as const,
          completeness: "full" as const
        },
        freshnessContext: { slot: 123, blockTimestampUnixMs: 1700000000000 },
        quality: "proxy" as const,
        attributionConfidence: 0,
        attributionProvider: "helius-api" as const,
        caveats: [] as string[]
      };
      const result = acceptOnChainFlowSourceEvent(event);
      expect(result).toBeDefined();
    });

    it("accepts CEX attribution confidence of exactly 1", () => {
      const event = {
        eventKind: "cex_flow_proxy" as const,
        sourceEventId: "cex_001",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "5000000",
        direction: "inbound" as const,
        venue: "cex" as const,
        addressContext: { addressType: "wallet" as const, address: "abc123" },
        sourceReferences: ["https://cex.example/txn/abc"],
        sourceQuality: {
          provider: "helius-api" as const,
          freshness: "realtime" as const,
          completeness: "full" as const
        },
        freshnessContext: { slot: 123, blockTimestampUnixMs: 1700000000000 },
        quality: "proxy" as const,
        attributionConfidence: 1,
        attributionProvider: "helius-api" as const,
        caveats: [] as string[]
      };
      const result = acceptOnChainFlowSourceEvent(event);
      expect(result).toBeDefined();
    });
  });

  describe("precision beyond JavaScript safe integer range", () => {
    it("handles amount exceeding Number.MAX_SAFE_INTEGER with exact string comparison", () => {
      const event = {
        eventKind: "whale_transfer" as const,
        sourceEventId: "wt_001",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "9007199254740993",
        direction: "inbound" as const,
        venue: "solana" as const,
        addressContext: { addressType: "wallet" as const, address: "abc123" },
        sourceReferences: ["https://helius.xyz/txn/abc"],
        sourceQuality: {
          provider: "helius-api" as const,
          freshness: "realtime" as const,
          completeness: "full" as const
        },
        freshnessContext: { slot: 123, blockTimestampUnixMs: 1700000000000 },
        transactionSignature: "txn_abc",
        eventIndex: 0,
        slot: 123,
        stablecoinOperation: "transfer" as const
      };
      const result = acceptOnChainFlowSourceEvent(event);
      expect(result).toBeDefined();
      expect(result.eventKind).toBe("whale_transfer");
    });

    it("handles boundary case at Number.MAX_SAFE_INTEGER", () => {
      const event = {
        eventKind: "whale_transfer" as const,
        sourceEventId: "wt_001",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "9007199254740991",
        direction: "inbound" as const,
        venue: "solana" as const,
        addressContext: { addressType: "wallet" as const, address: "abc123" },
        sourceReferences: ["https://helius.xyz/txn/abc"],
        sourceQuality: {
          provider: "helius-api" as const,
          freshness: "realtime" as const,
          completeness: "full" as const
        },
        freshnessContext: { slot: 123, blockTimestampUnixMs: 1700000000000 },
        transactionSignature: "txn_abc",
        eventIndex: 0,
        slot: 123,
        stablecoinOperation: "transfer" as const
      };
      const result = acceptOnChainFlowSourceEvent(event);
      expect(result).toBeDefined();
    });
  });
});
