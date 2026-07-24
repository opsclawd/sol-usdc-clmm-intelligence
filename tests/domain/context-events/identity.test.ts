import { describe, it, expect } from "vitest";
import { deriveContextSnapshotObservationKey } from "../../../src/domain/context-events/identity.js";

describe("context-events/identity", () => {
  describe("deriveContextSnapshotObservationKey", () => {
    it("derives consistent key for same input", async () => {
      const input = {
        source: "macro-calendar-api" as const,
        providerId: "test-provider",
        sourceObservedAtUnixMs: 1700000000000,
        payloadHash: "abc123def456"
      };
      const key1 = await deriveContextSnapshotObservationKey(input);
      const key2 = await deriveContextSnapshotObservationKey(input);
      expect(key1).toBe(key2);
    });

    it("derives different keys for different inputs", async () => {
      const input1 = {
        source: "macro-calendar-api" as const,
        providerId: "test-provider-1",
        sourceObservedAtUnixMs: 1700000000000,
        payloadHash: "abc123def456"
      };
      const input2 = {
        source: "macro-calendar-api" as const,
        providerId: "test-provider-2",
        sourceObservedAtUnixMs: 1700000000000,
        payloadHash: "abc123def456"
      };
      const key1 = await deriveContextSnapshotObservationKey(input1);
      const key2 = await deriveContextSnapshotObservationKey(input2);
      expect(key1).not.toBe(key2);
    });

    it("derives different keys for different sources", async () => {
      const input1 = {
        source: "macro-calendar-api" as const,
        providerId: "test-provider",
        sourceObservedAtUnixMs: 1700000000000,
        payloadHash: "abc123def456"
      };
      const input2 = {
        source: "solana-status-api" as const,
        providerId: "test-provider",
        sourceObservedAtUnixMs: 1700000000000,
        payloadHash: "abc123def456"
      };
      const key1 = await deriveContextSnapshotObservationKey(input1);
      const key2 = await deriveContextSnapshotObservationKey(input2);
      expect(key1).not.toBe(key2);
    });

    it("derives different keys for different timestamps", async () => {
      const input1 = {
        source: "macro-calendar-api" as const,
        providerId: "test-provider",
        sourceObservedAtUnixMs: 1700000000000,
        payloadHash: "abc123def456"
      };
      const input2 = {
        source: "macro-calendar-api" as const,
        providerId: "test-provider",
        sourceObservedAtUnixMs: 1700000001000,
        payloadHash: "abc123def456"
      };
      const key1 = await deriveContextSnapshotObservationKey(input1);
      const key2 = await deriveContextSnapshotObservationKey(input2);
      expect(key1).not.toBe(key2);
    });

    it("derives different keys for different payloadHashes", async () => {
      const input1 = {
        source: "macro-calendar-api" as const,
        providerId: "test-provider",
        sourceObservedAtUnixMs: 1700000000000,
        payloadHash: "abc123def456"
      };
      const input2 = {
        source: "macro-calendar-api" as const,
        providerId: "test-provider",
        sourceObservedAtUnixMs: 1700000000000,
        payloadHash: "xyz789ghi012"
      };
      const key1 = await deriveContextSnapshotObservationKey(input1);
      const key2 = await deriveContextSnapshotObservationKey(input2);
      expect(key1).not.toBe(key2);
    });

    it("returns a string of expected hash length (64 chars for sha256 hex)", async () => {
      const input = {
        source: "macro-calendar-api" as const,
        providerId: "test-provider",
        sourceObservedAtUnixMs: 1700000000000,
        payloadHash: "abc123def456"
      };
      const key = await deriveContextSnapshotObservationKey(input);
      expect(typeof key).toBe("string");
      expect(key.length).toBe(64);
      expect(/^[a-f0-9]+$/.test(key)).toBe(true);
    });

    it("accepts solana-status-api as source", async () => {
      const input = {
        source: "solana-status-api" as const,
        providerId: "solana-status-api",
        sourceObservedAtUnixMs: 1700000000000,
        payloadHash: "abc123def456"
      };
      const key = await deriveContextSnapshotObservationKey(input);
      expect(typeof key).toBe("string");
      expect(key.length).toBe(64);
    });
  });
});
