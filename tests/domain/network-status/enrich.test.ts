import { describe, it, expect } from "vitest";
import { enrichNetworkStatus } from "../../../src/domain/network-status/enrich.js";
import type { NetworkStatusPayloadV1 } from "../../../src/contracts/normalized-network-status.js";

describe("network-status enrichment", () => {
  it("enriches network status with fresh deterministic direct provenance", async () => {
    const payload: NetworkStatusPayloadV1 = {
      kind: "network_status",
      schemaVersion: 1,
      network: "solana-mainnet-beta",
      observedAtUnixMs: 1700000000000,
      health: "ok",
      slot: 250000000,
      slotsBehind: null,
      warnings: []
    };

    const enriched = await enrichNetworkStatus({
      rawObservationId: 42,
      sourceObservationKey: "key-123",
      rawPayloadHash: "hash-456",
      observedAtUnixMs: 1700000000000,
      fetchedAtUnixMs: 1700000001000,
      receivedAtUnixMs: 1700000002000,
      payload,
      nowMs: 1700000003000,
      codeVersion: "1.0.0",
      runId: "run-789"
    });

    expect(enriched.signalClass).toBe("deterministic");
    expect(enriched.evidenceFamily).toBe("execution_safety");
    expect(enriched.kind).toBe("network_status");
    expect(enriched.provenance.rawObservationRefs).toHaveLength(1);
    expect(enriched.provenance.rawObservationRefs[0]).toEqual({
      refType: "raw_observation",
      id: 42,
      source: "solana-rpc",
      payloadHash: "hash-456"
    });
    expect(enriched.provenance.codeVersion).toBe("1.0.0");
    expect(enriched.provenance.runId).toBe("run-789");
    expect(enriched.freshness.validUntilUnixMs).toBeGreaterThan(1700000000000);
    expect(enriched.confidence.compositeScore).toBeGreaterThan(0);
  });
});
