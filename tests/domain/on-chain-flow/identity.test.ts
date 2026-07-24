import { describe, it, expect } from "vitest";
import type {
  WhaleTransferPayloadV1,
  WhaleSwapPayloadV1,
  DexNetFlowPayloadV1
} from "../../../src/contracts/on-chain-flow.js";
import { deriveOnChainFlowSourceObservationKey } from "../../../src/domain/on-chain-flow/identity.js";

describe("deriveOnChainFlowSourceObservationKey", () => {
  describe("transaction identity is stable across pagination and collection runs", () => {
    it("same transaction produces same key regardless of pagination cursor", async () => {
      const baseEvent: WhaleTransferPayloadV1 = {
        schemaVersion: 1,
        eventFamily: "on_chain_flow",
        eventType: "whale_transfer",
        sourceEventId: "txn_abc123",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "1000000000",
        direction: "inbound",
        venue: "solana",
        addressContext: { addressType: "wallet", address: "wallet_pubkey_1" },
        sourceReferences: ["https://helius.xyz/txn/txn_abc123"],
        sourceQuality: { provider: "helius-api", freshness: "realtime", completeness: "full" },
        freshnessContext: { slot: 123456789, blockTimestampUnixMs: 1700000000000 },
        transactionSignature: "txn_abc123",
        eventIndex: 0,
        slot: 123456789,
        stablecoinOperation: "transfer"
      };

      const key1 = await deriveOnChainFlowSourceObservationKey(
        baseEvent,
        "helius-api",
        "cursor_page_1"
      );
      const key2 = await deriveOnChainFlowSourceObservationKey(
        baseEvent,
        "helius-api",
        "cursor_page_2"
      );
      const key3 = await deriveOnChainFlowSourceObservationKey(
        baseEvent,
        "helius-api",
        "cursor_page_3"
      );

      expect(key1).toBe(key2);
      expect(key2).toBe(key3);
    });

    it("same transaction produces same key regardless of provider run ID", async () => {
      const baseEvent: WhaleTransferPayloadV1 = {
        schemaVersion: 1,
        eventFamily: "on_chain_flow",
        eventType: "whale_transfer",
        sourceEventId: "txn_abc123",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "1000000000",
        direction: "inbound",
        venue: "solana",
        addressContext: { addressType: "wallet", address: "wallet_pubkey_1" },
        sourceReferences: ["https://helius.xyz/txn/txn_abc123"],
        sourceQuality: { provider: "helius-api", freshness: "realtime", completeness: "full" },
        freshnessContext: { slot: 123456789, blockTimestampUnixMs: 1700000000000 },
        transactionSignature: "txn_abc123",
        eventIndex: 0,
        slot: 123456789,
        stablecoinOperation: "transfer"
      };

      const key1 = await deriveOnChainFlowSourceObservationKey(baseEvent, "helius-api", "run_001");
      const key2 = await deriveOnChainFlowSourceObservationKey(baseEvent, "helius-api", "run_002");
      const key3 = await deriveOnChainFlowSourceObservationKey(baseEvent, "helius-api", "run_003");

      expect(key1).toBe(key2);
      expect(key2).toBe(key3);
    });

    it("retries with different fetched time do not change identity", async () => {
      const baseEvent: WhaleTransferPayloadV1 = {
        schemaVersion: 1,
        eventFamily: "on_chain_flow",
        eventType: "whale_transfer",
        sourceEventId: "txn_abc123",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "1000000000",
        direction: "inbound",
        venue: "solana",
        addressContext: { addressType: "wallet", address: "wallet_pubkey_1" },
        sourceReferences: ["https://helius.xyz/txn/txn_abc123"],
        sourceQuality: { provider: "helius-api", freshness: "realtime", completeness: "full" },
        freshnessContext: { slot: 123456789, blockTimestampUnixMs: 1700000000000 },
        transactionSignature: "txn_abc123",
        eventIndex: 0,
        slot: 123456789,
        stablecoinOperation: "transfer"
      };

      const key1 = await deriveOnChainFlowSourceObservationKey(baseEvent, "helius-api", null);
      const key2 = await deriveOnChainFlowSourceObservationKey(baseEvent, "helius-api", null);

      expect(key1).toBe(key2);
    });

    it("only source, kind, signature, and event index affect the identity key", async () => {
      const eventA: WhaleTransferPayloadV1 = {
        schemaVersion: 1,
        eventFamily: "on_chain_flow",
        eventType: "whale_transfer",
        sourceEventId: "txn_abc123",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "1000000000",
        direction: "inbound",
        venue: "solana",
        addressContext: { addressType: "wallet", address: "wallet_pubkey_1" },
        sourceReferences: ["https://helius.xyz/txn/txn_abc123"],
        sourceQuality: { provider: "helius-api", freshness: "realtime", completeness: "full" },
        freshnessContext: { slot: 123456789, blockTimestampUnixMs: 1700000000000 },
        transactionSignature: "txn_abc123",
        eventIndex: 0,
        slot: 123456789,
        stablecoinOperation: "transfer"
      };

      const eventB: WhaleTransferPayloadV1 = {
        ...eventA,
        observedAtUnixMs: 1800000000000
      };

      const eventC: WhaleTransferPayloadV1 = {
        ...eventA,
        amountUsdc: "9999999999"
      };

      const eventD: WhaleTransferPayloadV1 = {
        ...eventA,
        slot: 999999999
      };

      const keyA = await deriveOnChainFlowSourceObservationKey(eventA, "helius-api", null);
      const keyB = await deriveOnChainFlowSourceObservationKey(eventB, "helius-api", null);
      const keyC = await deriveOnChainFlowSourceObservationKey(eventC, "helius-api", null);
      const keyD = await deriveOnChainFlowSourceObservationKey(eventD, "helius-api", null);

      expect(keyA).toBe(keyB);
      expect(keyA).toBe(keyC);
      expect(keyA).toBe(keyD);
    });
  });

  describe("different events in one transaction have different identities", () => {
    it("different event index produces different identity", async () => {
      const baseEvent: WhaleTransferPayloadV1 = {
        schemaVersion: 1,
        eventFamily: "on_chain_flow",
        eventType: "whale_transfer",
        sourceEventId: "txn_abc123",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "1000000000",
        direction: "inbound",
        venue: "solana",
        addressContext: { addressType: "wallet", address: "wallet_pubkey_1" },
        sourceReferences: ["https://helius.xyz/txn/txn_abc123"],
        sourceQuality: { provider: "helius-api", freshness: "realtime", completeness: "full" },
        freshnessContext: { slot: 123456789, blockTimestampUnixMs: 1700000000000 },
        transactionSignature: "txn_abc123",
        eventIndex: 0,
        slot: 123456789,
        stablecoinOperation: "transfer"
      };

      const eventWithIndex0 = { ...baseEvent, eventIndex: 0 };
      const eventWithIndex1 = { ...baseEvent, eventIndex: 1 };
      const eventWithIndex2 = { ...baseEvent, eventIndex: 2 };

      const key0 = await deriveOnChainFlowSourceObservationKey(eventWithIndex0, "helius-api", null);
      const key1 = await deriveOnChainFlowSourceObservationKey(eventWithIndex1, "helius-api", null);
      const key2 = await deriveOnChainFlowSourceObservationKey(eventWithIndex2, "helius-api", null);

      expect(key0).not.toBe(key1);
      expect(key1).not.toBe(key2);
      expect(key0).not.toBe(key2);
    });

    it("different event kind produces different identity even with same transaction", async () => {
      const whaleTransfer: WhaleTransferPayloadV1 = {
        schemaVersion: 1,
        eventFamily: "on_chain_flow",
        eventType: "whale_transfer",
        sourceEventId: "txn_abc123",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "1000000000",
        direction: "inbound",
        venue: "solana",
        addressContext: { addressType: "wallet", address: "wallet_pubkey_1" },
        sourceReferences: ["https://helius.xyz/txn/txn_abc123"],
        sourceQuality: { provider: "helius-api", freshness: "realtime", completeness: "full" },
        freshnessContext: { slot: 123456789, blockTimestampUnixMs: 1700000000000 },
        transactionSignature: "txn_abc123",
        eventIndex: 0,
        slot: 123456789,
        stablecoinOperation: "transfer"
      };

      const whaleSwap: WhaleSwapPayloadV1 = {
        schemaVersion: 1,
        eventFamily: "on_chain_flow",
        eventType: "whale_swap",
        sourceEventId: "txn_abc123",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "1000000000",
        direction: "inbound",
        venue: "solana",
        addressContext: { addressType: "wallet", address: "wallet_pubkey_1" },
        sourceReferences: ["https://helius.xyz/txn/txn_abc123"],
        sourceQuality: { provider: "helius-api", freshness: "realtime", completeness: "full" },
        freshnessContext: { slot: 123456789, blockTimestampUnixMs: 1700000000000 },
        transactionSignature: "txn_abc123",
        eventIndex: 0,
        slot: 123456789,
        stablecoinOperation: "transfer"
      };

      const keyTransfer = await deriveOnChainFlowSourceObservationKey(
        whaleTransfer,
        "helius-api",
        null
      );
      const keySwap = await deriveOnChainFlowSourceObservationKey(whaleSwap, "helius-api", null);

      expect(keyTransfer).not.toBe(keySwap);
    });

    it("same transaction signature but different source produces different identity", async () => {
      const whaleTransferHelius: WhaleTransferPayloadV1 = {
        schemaVersion: 1,
        eventFamily: "on_chain_flow",
        eventType: "whale_transfer",
        sourceEventId: "txn_abc123",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "1000000000",
        direction: "inbound",
        venue: "solana",
        addressContext: { addressType: "wallet", address: "wallet_pubkey_1" },
        sourceReferences: ["https://helius.xyz/txn/txn_abc123"],
        sourceQuality: { provider: "helius-api", freshness: "realtime", completeness: "full" },
        freshnessContext: { slot: 123456789, blockTimestampUnixMs: 1700000000000 },
        transactionSignature: "txn_abc123",
        eventIndex: 0,
        slot: 123456789,
        stablecoinOperation: "transfer"
      };

      const whaleTransferBirdeye: WhaleTransferPayloadV1 = {
        ...whaleTransferHelius,
        sourceReferences: ["https://birdeye.xyz/txn/txn_abc123"],
        sourceQuality: { provider: "birdeye-api", freshness: "windowed", completeness: "full" }
      };

      const keyHelius = await deriveOnChainFlowSourceObservationKey(
        whaleTransferHelius,
        "helius-api",
        null
      );
      const keyBirdeye = await deriveOnChainFlowSourceObservationKey(
        whaleTransferBirdeye,
        "birdeye-api",
        null
      );

      expect(keyHelius).not.toBe(keyBirdeye);
    });
  });

  describe("DEX window identity changes when venue or window bounds change", () => {
    it("different window start produces different identity", async () => {
      const dexFlow1: DexNetFlowPayloadV1 = {
        schemaVersion: 1,
        eventFamily: "on_chain_flow",
        eventType: "dex_net_flow",
        sourceEventId: "dex_flow_001",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "20000000000",
        direction: "inbound",
        venue: "solana",
        addressContext: { addressType: "wallet", address: "dex-wallet" },
        sourceReferences: ["https://birdeye.xyz/token/SOL"],
        sourceQuality: { provider: "birdeye-api", freshness: "windowed", completeness: "full" },
        freshnessContext: { slot: 123, blockTimestampUnixMs: 1700000000000 },
        windowStartUnixMs: 1699913600000,
        windowEndUnixMs: 1700000000000,
        buyVolumeUsdc: "50000000000",
        sellVolumeUsdc: "30000000000",
        netFlowUsdc: "20000000000"
      };

      const dexFlow2: DexNetFlowPayloadV1 = {
        ...dexFlow1,
        windowStartUnixMs: 1699827200000
      };

      const key1 = await deriveOnChainFlowSourceObservationKey(dexFlow1, "birdeye-api", null);
      const key2 = await deriveOnChainFlowSourceObservationKey(dexFlow2, "birdeye-api", null);

      expect(key1).not.toBe(key2);
    });

    it("different window end produces different identity", async () => {
      const dexFlow1: DexNetFlowPayloadV1 = {
        schemaVersion: 1,
        eventFamily: "on_chain_flow",
        eventType: "dex_net_flow",
        sourceEventId: "dex_flow_001",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "20000000000",
        direction: "inbound",
        venue: "solana",
        addressContext: { addressType: "wallet", address: "dex-wallet" },
        sourceReferences: ["https://birdeye.xyz/token/SOL"],
        sourceQuality: { provider: "birdeye-api", freshness: "windowed", completeness: "full" },
        freshnessContext: { slot: 123, blockTimestampUnixMs: 1700000000000 },
        windowStartUnixMs: 1699913600000,
        windowEndUnixMs: 1700000000000,
        buyVolumeUsdc: "50000000000",
        sellVolumeUsdc: "30000000000",
        netFlowUsdc: "20000000000"
      };

      const dexFlow2: DexNetFlowPayloadV1 = {
        ...dexFlow1,
        windowEndUnixMs: 1700086400000
      };

      const key1 = await deriveOnChainFlowSourceObservationKey(dexFlow1, "birdeye-api", null);
      const key2 = await deriveOnChainFlowSourceObservationKey(dexFlow2, "birdeye-api", null);

      expect(key1).not.toBe(key2);
    });

    it("different venue produces different identity", async () => {
      const dexFlowSolana: DexNetFlowPayloadV1 = {
        schemaVersion: 1,
        eventFamily: "on_chain_flow",
        eventType: "dex_net_flow",
        sourceEventId: "dex_flow_001",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "20000000000",
        direction: "inbound",
        venue: "solana",
        addressContext: { addressType: "wallet", address: "dex-wallet" },
        sourceReferences: ["https://birdeye.xyz/token/SOL"],
        sourceQuality: { provider: "birdeye-api", freshness: "windowed", completeness: "full" },
        freshnessContext: { slot: 123, blockTimestampUnixMs: 1700000000000 },
        windowStartUnixMs: 1699913600000,
        windowEndUnixMs: 1700000000000,
        buyVolumeUsdc: "50000000000",
        sellVolumeUsdc: "30000000000",
        netFlowUsdc: "20000000000"
      };

      const dexFlowJupiter: DexNetFlowPayloadV1 = {
        ...dexFlowSolana,
        venue: "jupiter"
      };

      const key1 = await deriveOnChainFlowSourceObservationKey(dexFlowSolana, "birdeye-api", null);
      const key2 = await deriveOnChainFlowSourceObservationKey(dexFlowJupiter, "birdeye-api", null);

      expect(key1).not.toBe(key2);
    });

    it("separate pressure windows cannot collide - same values different windows", async () => {
      const dexFlow1: DexNetFlowPayloadV1 = {
        schemaVersion: 1,
        eventFamily: "on_chain_flow",
        eventType: "dex_net_flow",
        sourceEventId: "dex_flow_001",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "20000000000",
        direction: "inbound",
        venue: "solana",
        addressContext: { addressType: "wallet", address: "dex-wallet" },
        sourceReferences: ["https://birdeye.xyz/token/SOL"],
        sourceQuality: { provider: "birdeye-api", freshness: "windowed", completeness: "full" },
        freshnessContext: { slot: 123, blockTimestampUnixMs: 1700000000000 },
        windowStartUnixMs: 1699913600000,
        windowEndUnixMs: 1700000000000,
        buyVolumeUsdc: "50000000000",
        sellVolumeUsdc: "30000000000",
        netFlowUsdc: "20000000000"
      };

      const dexFlow2: DexNetFlowPayloadV1 = {
        ...dexFlow1,
        windowStartUnixMs: 1699827200000,
        windowEndUnixMs: 1699913600000
      };

      const key1 = await deriveOnChainFlowSourceObservationKey(dexFlow1, "birdeye-api", null);
      const key2 = await deriveOnChainFlowSourceObservationKey(dexFlow2, "birdeye-api", null);

      expect(key1).not.toBe(key2);
    });
  });

  describe("produces valid SHA-256 hash output", () => {
    it("returns a 64-character hex string", async () => {
      const event: WhaleTransferPayloadV1 = {
        schemaVersion: 1,
        eventFamily: "on_chain_flow",
        eventType: "whale_transfer",
        sourceEventId: "txn_abc123",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "1000000000",
        direction: "inbound",
        venue: "solana",
        addressContext: { addressType: "wallet", address: "wallet_pubkey_1" },
        sourceReferences: ["https://helius.xyz/txn/txn_abc123"],
        sourceQuality: { provider: "helius-api", freshness: "realtime", completeness: "full" },
        freshnessContext: { slot: 123456789, blockTimestampUnixMs: 1700000000000 },
        transactionSignature: "txn_abc123",
        eventIndex: 0,
        slot: 123456789,
        stablecoinOperation: "transfer"
      };

      const key = await deriveOnChainFlowSourceObservationKey(event, "helius-api", null);

      expect(key).toMatch(/^[a-f0-9]{64}$/);
    });

    it("is deterministic - same input always produces same hash", async () => {
      const event: WhaleTransferPayloadV1 = {
        schemaVersion: 1,
        eventFamily: "on_chain_flow",
        eventType: "whale_transfer",
        sourceEventId: "txn_abc123",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "1000000000",
        direction: "inbound",
        venue: "solana",
        addressContext: { addressType: "wallet", address: "wallet_pubkey_1" },
        sourceReferences: ["https://helius.xyz/txn/txn_abc123"],
        sourceQuality: { provider: "helius-api", freshness: "realtime", completeness: "full" },
        freshnessContext: { slot: 123456789, blockTimestampUnixMs: 1700000000000 },
        transactionSignature: "txn_abc123",
        eventIndex: 0,
        slot: 123456789,
        stablecoinOperation: "transfer"
      };

      const keys = await Promise.all([
        deriveOnChainFlowSourceObservationKey(event, "helius-api", null),
        deriveOnChainFlowSourceObservationKey(event, "helius-api", null),
        deriveOnChainFlowSourceObservationKey(event, "helius-api", null)
      ]);

      expect(keys[0]).toBe(keys[1]);
      expect(keys[1]).toBe(keys[2]);
    });
  });
});
