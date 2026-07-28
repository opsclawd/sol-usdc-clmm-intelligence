import { describe, it, expect } from "vitest";
import { makeHeliusTransactionFlowEvent } from "../../fixtures/on-chain-flow.js";
import type { StablecoinFlowPayloadV1 } from "../../../src/contracts/on-chain-flow.js";
import { normalizeOnChainFlow } from "../../../src/domain/on-chain-flow/normalize.js";

describe("normalizeOnChainFlow", () => {
  describe("normalizes transaction direction from explicit asset deltas only", () => {
    it("whale swap with SOL delta > 0 and USDC delta < 0 produces inbound direction", () => {
      const event = {
        eventKind: "whale_swap" as const,
        sourceEventId: "ws_001",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "50000000",
        direction: "outbound" as const,
        venue: "solana" as const,
        addressContext: { addressType: "wallet" as const, address: "abc123" },
        sourceReferences: ["https://helius.xyz/txn/abc123"],
        sourceQuality: {
          provider: "helius-api" as const,
          freshness: "realtime" as const,
          completeness: "full" as const
        },
        freshnessContext: { slot: 123456789, blockTimestampUnixMs: 1700000000000 },
        transactionSignature: "txn_abc123",
        eventIndex: 0,
        slot: 123456789,
        stablecoinOperation: "transfer" as const,
        solDelta: 1000000000,
        usdcDelta: -50000000
      };
      const result = normalizeOnChainFlow(event, Date.now());
      expect(result.eventType).toBe("whale_swap");
      expect(result.direction).toBe("inbound");
    });

    it("whale swap with SOL delta < 0 and USDC delta > 0 produces outbound direction", () => {
      const event = {
        eventKind: "whale_swap" as const,
        sourceEventId: "ws_001",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "50000000",
        direction: "inbound" as const,
        venue: "solana" as const,
        addressContext: { addressType: "wallet" as const, address: "abc123" },
        sourceReferences: ["https://helius.xyz/txn/abc123"],
        sourceQuality: {
          provider: "helius-api" as const,
          freshness: "realtime" as const,
          completeness: "full" as const
        },
        freshnessContext: { slot: 123456789, blockTimestampUnixMs: 1700000000000 },
        transactionSignature: "txn_abc123",
        eventIndex: 0,
        slot: 123456789,
        stablecoinOperation: "transfer" as const,
        solDelta: -1000000000,
        usdcDelta: 50000000
      };
      const result = normalizeOnChainFlow(event, Date.now());
      expect(result.eventType).toBe("whale_swap");
      expect(result.direction).toBe("outbound");
    });

    it("whale swap direction never uses address intent", () => {
      const event = {
        eventKind: "whale_swap" as const,
        sourceEventId: "ws_001",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "50000000",
        direction: "outbound" as const,
        venue: "solana" as const,
        addressContext: { addressType: "wallet" as const, address: "Mwallet123_swap" },
        sourceReferences: ["https://helius.xyz/txn/abc123"],
        sourceQuality: {
          provider: "helius-api" as const,
          freshness: "realtime" as const,
          completeness: "full" as const
        },
        freshnessContext: { slot: 123456789, blockTimestampUnixMs: 1700000000000 },
        transactionSignature: "txn_abc123",
        eventIndex: 0,
        slot: 123456789,
        stablecoinOperation: "transfer" as const,
        solDelta: 1000000000,
        usdcDelta: -50000000
      };
      const result = normalizeOnChainFlow(event, Date.now());
      expect(result.eventType).toBe("whale_swap");
      expect(result.direction).toBe("inbound");
    });
  });

  describe("normalizes stablecoin mint burn and transfer as separate operations", () => {
    it("mint operation is retained as mint", () => {
      const event = {
        eventKind: "stablecoin_flow" as const,
        sourceEventId: "sf_001",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "1000000",
        direction: "inbound" as const,
        venue: "solana" as const,
        addressContext: { addressType: "contract" as const, address: "mint_authority" },
        sourceReferences: ["https://helius.xyz/txn/abc123"],
        sourceQuality: {
          provider: "helius-api" as const,
          freshness: "realtime" as const,
          completeness: "full" as const
        },
        freshnessContext: { slot: 123456789, blockTimestampUnixMs: 1700000000000 },
        transactionSignature: "txn_abc123",
        eventIndex: 0,
        slot: 123456789,
        stablecoinOperation: "mint" as const
      };
      const result = normalizeOnChainFlow(event, Date.now());
      expect(result.eventType).toBe("stablecoin_flow");
      expect((result as StablecoinFlowPayloadV1).stablecoinOperation).toBe("mint");
    });

    it("burn operation is retained as burn", () => {
      const event = {
        eventKind: "stablecoin_flow" as const,
        sourceEventId: "sf_001",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "1000000",
        direction: "outbound" as const,
        venue: "solana" as const,
        addressContext: { addressType: "contract" as const, address: "burn_authority" },
        sourceReferences: ["https://helius.xyz/txn/abc123"],
        sourceQuality: {
          provider: "helius-api" as const,
          freshness: "realtime" as const,
          completeness: "full" as const
        },
        freshnessContext: { slot: 123456789, blockTimestampUnixMs: 1700000000000 },
        transactionSignature: "txn_abc123",
        eventIndex: 0,
        slot: 123456789,
        stablecoinOperation: "burn" as const
      };
      const result = normalizeOnChainFlow(event, Date.now());
      expect(result.eventType).toBe("stablecoin_flow");
      expect((result as StablecoinFlowPayloadV1).stablecoinOperation).toBe("burn");
    });

    it("transfer operation is retained as transfer", () => {
      const event = {
        eventKind: "stablecoin_flow" as const,
        sourceEventId: "sf_001",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "1000000",
        direction: "inbound" as const,
        venue: "solana" as const,
        addressContext: { addressType: "wallet" as const, address: "user_wallet" },
        sourceReferences: ["https://helius.xyz/txn/abc123"],
        sourceQuality: {
          provider: "helius-api" as const,
          freshness: "realtime" as const,
          completeness: "full" as const
        },
        freshnessContext: { slot: 123456789, blockTimestampUnixMs: 1700000000000 },
        transactionSignature: "txn_abc123",
        eventIndex: 0,
        slot: 123456789,
        stablecoinOperation: "transfer" as const
      };
      const result = normalizeOnChainFlow(event, Date.now());
      expect(result.eventType).toBe("stablecoin_flow");
      expect((result as StablecoinFlowPayloadV1).stablecoinOperation).toBe("transfer");
    });

    it("mint and burn are never conflated even if semantically similar", () => {
      const mintEvent = {
        eventKind: "stablecoin_flow" as const,
        sourceEventId: "sf_001",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "1000000",
        direction: "inbound" as const,
        venue: "solana" as const,
        addressContext: { addressType: "contract" as const, address: "mint_authority" },
        sourceReferences: ["https://helius.xyz/txn/abc123"],
        sourceQuality: {
          provider: "helius-api" as const,
          freshness: "realtime" as const,
          completeness: "full" as const
        },
        freshnessContext: { slot: 123456789, blockTimestampUnixMs: 1700000000000 },
        transactionSignature: "txn_abc123",
        eventIndex: 0,
        slot: 123456789,
        stablecoinOperation: "mint" as const
      };
      const burnEvent = {
        eventKind: "stablecoin_flow" as const,
        sourceEventId: "sf_002",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "1000000",
        direction: "outbound" as const,
        venue: "solana" as const,
        addressContext: { addressType: "contract" as const, address: "burn_authority" },
        sourceReferences: ["https://helius.xyz/txn/def456"],
        sourceQuality: {
          provider: "helius-api" as const,
          freshness: "realtime" as const,
          completeness: "full" as const
        },
        freshnessContext: { slot: 123456790, blockTimestampUnixMs: 1700000000000 },
        transactionSignature: "txn_def456",
        eventIndex: 0,
        slot: 123456790,
        stablecoinOperation: "burn" as const
      };
      const mintResult = normalizeOnChainFlow(mintEvent, Date.now());
      const burnResult = normalizeOnChainFlow(burnEvent, Date.now());
      expect((mintResult as StablecoinFlowPayloadV1).stablecoinOperation).not.toBe(
        (burnResult as StablecoinFlowPayloadV1).stablecoinOperation
      );
    });
  });

  describe("normalizes DEX net flow with a signed net equal to buy minus sell", () => {
    it("dex_net_flow strips negative sign from amountUsdc and derives direction from net flow sign", () => {
      const event = {
        eventKind: "dex_net_flow" as const,
        sourceEventId: "dex_nf_001",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "20000000000",
        direction: "inbound" as const,
        venue: "solana" as const,
        addressContext: { addressType: "wallet" as const, address: "dex-wallet" },
        sourceReferences: ["https://dex.example/txn/abc"],
        sourceQuality: {
          provider: "helius-api" as const,
          freshness: "realtime" as const,
          completeness: "full" as const
        },
        freshnessContext: { slot: 123, blockTimestampUnixMs: 1700000000000 },
        windowStartUnixMs: 1699913600000,
        windowEndUnixMs: 1700000000000,
        buyVolumeUsdc: "50000000000",
        sellVolumeUsdc: "30000000000",
        netFlowUsdc: "20000000000"
      };
      const result = normalizeOnChainFlow(event, Date.now());
      expect(result.eventType).toBe("dex_net_flow");
      expect((result as Record<string, unknown>).amountUsdc).toBe("20000000000");
      expect((result as Record<string, unknown>).direction).toBe("inbound");
      expect((result as Record<string, unknown>).netFlowUsdc).toBe("20000000000");
    });

    it("dex_net_flow with negative net flow strips sign from amountUsdc and sets outbound direction", () => {
      const event = {
        eventKind: "dex_net_flow" as const,
        sourceEventId: "dex_nf_002",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "20000000000",
        direction: "outbound" as const,
        venue: "solana" as const,
        addressContext: { addressType: "wallet" as const, address: "dex-wallet-2" },
        sourceReferences: ["https://dex.example/txn/def"],
        sourceQuality: {
          provider: "helius-api" as const,
          freshness: "realtime" as const,
          completeness: "full" as const
        },
        freshnessContext: { slot: 124, blockTimestampUnixMs: 1700000000000 },
        windowStartUnixMs: 1699913600000,
        windowEndUnixMs: 1700000000000,
        buyVolumeUsdc: "30000000000",
        sellVolumeUsdc: "50000000000",
        netFlowUsdc: "-20000000000"
      };
      const result = normalizeOnChainFlow(event, Date.now());
      expect(result.eventType).toBe("dex_net_flow");
      expect((result as Record<string, unknown>).amountUsdc).toBe("20000000000");
      expect((result as Record<string, unknown>).direction).toBe("outbound");
      expect((result as Record<string, unknown>).netFlowUsdc).toBe("-20000000000");
    });
  });

  describe("always attaches CEX proxy noise caveats and never upgrades it to deterministic", () => {
    it("CEX proxy result always has caveats array", () => {
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
        attributionConfidence: 0.8,
        attributionProvider: "helius-api" as const,
        caveats: ["proxy_address_attribution"]
      };
      const result = normalizeOnChainFlow(event, Date.now());
      expect(result.eventType).toBe("cex_flow_proxy");
      expect((result as Record<string, unknown>).caveats).toBeDefined();
      expect(((result as Record<string, unknown>).caveats as string[]).length).toBeGreaterThan(0);
    });

    it("CEX proxy never has attribution upgraded to deterministic even with confidence 1.0", () => {
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
        attributionConfidence: 1.0,
        attributionProvider: "helius-api" as const,
        caveats: ["proxy_address_attribution"]
      };
      const result = normalizeOnChainFlow(event, Date.now());
      expect(result.eventType).toBe("cex_flow_proxy");
      expect((result as Record<string, unknown>).quality).toBe("proxy");
      expect((result as Record<string, unknown>).attributionConfidence).toBe(1.0);
    });

    it("CEX proxy retains original caveats without adding deterministic markers", () => {
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
        attributionConfidence: 0.95,
        attributionProvider: "helius-api" as const,
        caveats: ["proxy_address_attribution", "wallet_exchange_proximity"]
      };
      const result = normalizeOnChainFlow(event, Date.now());
      expect(result.eventType).toBe("cex_flow_proxy");
      expect((result as Record<string, unknown>).caveats).toContain("proxy_address_attribution");
      expect((result as Record<string, unknown>).quality).toBe("proxy");
    });
  });

  describe("sorts and deduplicates source references", () => {
    it("deduplicates and sorts source references", () => {
      const event = makeHeliusTransactionFlowEvent({
        sourceReferences: [
          "https://b.example.com",
          "https://a.example.com",
          "https://c.example.com",
          "https://a.example.com"
        ]
      });
      const result = normalizeOnChainFlow(event, Date.now());
      expect(result.sourceReferences).toEqual([
        "https://a.example.com",
        "https://b.example.com",
        "https://c.example.com"
      ]);
    });
  });

  describe("builds freshness context from source and retrieval timestamps", () => {
    it("freshness context includes source and retrieval timestamps", () => {
      const sourceObserved = 1700000000000;
      const retrievedAt = 1700000005000;
      const event = makeHeliusTransactionFlowEvent({
        timestampUnixMs: sourceObserved
      });
      const result = normalizeOnChainFlow(event, retrievedAt);
      expect(result.freshnessContext.blockTimestampUnixMs).toBe(sourceObserved);
    });
  });
});
