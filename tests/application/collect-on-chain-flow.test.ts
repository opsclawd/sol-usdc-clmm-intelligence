import { describe, expect, it, vi } from "vitest";
import type { OnChainFlowThresholds } from "../../src/contracts/on-chain-flow.js";
import type {
  OnChainFlowSourceSnapshot,
  OnChainFlowSourceEvent
} from "../../src/ports/on-chain-flow-source.js";
import { FakeOnChainFlowSource } from "../fakes/fake-on-chain-flow-source.js";
import { FakeObservationRepo } from "../fakes/fake-observation-repo.js";
import { FakeNormalizedObservationRepo } from "../fakes/fake-normalized-observation-repo.js";
import { collectOnChainFlow } from "../../src/application/collect-on-chain-flow.js";
import type { CollectionRunContext } from "../../src/contracts/collection-run.js";

const VALID_CONTEXT: CollectionRunContext = Object.freeze({
  runId: "run-123",
  startedAtUnixMs: 1700000000000
});

const LOOKBACK_MS = 3_600_000;

const VALID_THRESHOLDS: OnChainFlowThresholds = Object.freeze({
  whaleSwapMinUsdc: "100000",
  stablecoinFlowMinUsdc: "1000",
  dexNetFlowMinUsdc: "50000",
  cexFlowProxyMinUsdc: "50000",
  cexMinAttributionConfidence: 0.5
});

function makeWhaleSwapEvent(
  overrides?: Partial<{
    sourceEventId: string;
    observedAtUnixMs: number;
    amountUsdc: string;
    transactionSignature: string;
    slot: number;
    attributionConfidence?: number;
  }>
): Record<string, unknown> {
  return {
    eventKind: "whale_swap",
    sourceEventId: overrides?.sourceEventId ?? "tx_abc123_sig_0",
    observedAtUnixMs: overrides?.observedAtUnixMs ?? 1699999990000,
    amountUsdc: overrides?.amountUsdc ?? "500000",
    direction: "inbound",
    venue: "solana",
    addressContext: { addressType: "wallet", address: "Wallet123" },
    sourceReferences: ["https://helius.xyz/txn/tx_abc123"],
    sourceQuality: { provider: "birdeye-api", freshness: "windowed", completeness: "full" },
    freshnessContext: {
      slot: overrides?.slot ?? 123456789,
      blockTimestampUnixMs: overrides?.observedAtUnixMs ?? 1699999990000
    },
    transactionSignature: overrides?.transactionSignature ?? "tx_abc123",
    eventIndex: 0,
    slot: overrides?.slot ?? 123456789,
    stablecoinOperation: "transfer"
  };
}

function makeCexFlowProxyEvent(
  overrides?: Partial<{
    sourceEventId: string;
    observedAtUnixMs: number;
    amountUsdc: string;
    attributionConfidence: number;
  }>
): Record<string, unknown> {
  return {
    eventKind: "cex_flow_proxy",
    sourceEventId: overrides?.sourceEventId ?? "cex_abc123",
    observedAtUnixMs: overrides?.observedAtUnixMs ?? 1699999990000,
    amountUsdc: overrides?.amountUsdc ?? "500000",
    direction: "inbound",
    venue: "cex",
    addressContext: { addressType: "wallet", address: "CexWallet123" },
    sourceReferences: ["https://helius.xyz/txn/cex_abc123"],
    sourceQuality: { provider: "helius-api", freshness: "realtime", completeness: "full" },
    freshnessContext: {
      slot: 123456789,
      blockTimestampUnixMs: overrides?.observedAtUnixMs ?? 1699999990000
    },
    quality: "proxy",
    attributionConfidence: overrides?.attributionConfidence ?? 0.75,
    attributionProvider: "helius-api",
    caveats: ["estimated_from_related_addresses"]
  };
}

function makeValidSnapshot(events?: readonly unknown[]): OnChainFlowSourceSnapshot {
  return {
    source: "helius-api",
    providerId: "test-provider",
    providerRunId: "run-001",
    asOfUnixMs: 1700000000000,
    license: "CC0-1.0",
    retention: "bounded",
    events: (events ?? [makeWhaleSwapEvent()]) as unknown as readonly OnChainFlowSourceEvent[]
  };
}

function makeDeps() {
  return {
    source: new FakeOnChainFlowSource(),
    rawObservationRepo: new FakeObservationRepo(),
    normalizedObservationRepo: new FakeNormalizedObservationRepo()
  };
}

describe("collectOnChainFlow", () => {
  describe("large event transitions absent to raw pending to normalized and raw parsed", () => {
    it("enforces durable boundary: raw insert precedes normalized insert and the result is accepted", async () => {
      const { source, rawObservationRepo, normalizedObservationRepo } = makeDeps();
      source.setResponse(makeValidSnapshot());

      const events: string[] = [];
      const originalInsertOrClassify = rawObservationRepo.insertOrClassify.bind(rawObservationRepo);
      rawObservationRepo.insertOrClassify = async (row) => {
        events.push("raw_insert");
        return originalInsertOrClassify(row);
      };
      const originalInsertMany =
        normalizedObservationRepo.insertMany.bind(normalizedObservationRepo);
      normalizedObservationRepo.insertMany = async (rows) => {
        events.push("normalized_batch");
        return originalInsertMany(rows);
      };
      const originalUpdateParseStatus =
        rawObservationRepo.updateParseStatus.bind(rawObservationRepo);
      rawObservationRepo.updateParseStatus = async (id, status) => {
        events.push(`parse_status_${status}`);
        return originalUpdateParseStatus(id, status);
      };

      const result = await collectOnChainFlow(
        { source, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT,
        { source: "helius-api", thresholds: VALID_THRESHOLDS, lookbackMs: LOOKBACK_MS }
      );

      expect(result.status).toBe("accepted");
      expect(events).toContain("raw_insert");
      expect(events.indexOf("raw_insert")).toBeLessThan(events.indexOf("normalized_batch"));
      expect(events).toContain("parse_status_parsed");
      expect(result.accepted).toBe(1);
      expect(result.filtered).toBe(0);
      expect(result.failed).toBe(0);
    });
  });

  describe("identical duplicate transitions parsed to identical replay without normalized insert", () => {
    it("replay produces no duplicate raw or normalized row", async () => {
      const { source, rawObservationRepo, normalizedObservationRepo } = makeDeps();
      const snapshot = makeValidSnapshot();
      source.setResponse(snapshot);

      const result1 = await collectOnChainFlow(
        { source, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT,
        { source: "helius-api", thresholds: VALID_THRESHOLDS, lookbackMs: LOOKBACK_MS }
      );
      expect(result1.status).toBe("accepted");
      expect(result1.accepted).toBe(1);

      const countAfterFirst = normalizedObservationRepo.count;

      const result2 = await collectOnChainFlow(
        { source, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT,
        { source: "helius-api", thresholds: VALID_THRESHOLDS, lookbackMs: LOOKBACK_MS }
      );
      expect(result2.status).toBe("identical_replay");
      expect(result2.replayed).toBe(1);
      expect(normalizedObservationRepo.count).toBe(countAfterFirst);
    });
  });

  describe("same identity with changed payload transitions to conflict and failed", () => {
    it("the existing immutable row is preserved and new attempt fails", async () => {
      const { source, rawObservationRepo, normalizedObservationRepo } = makeDeps();
      const snapshot1 = makeValidSnapshot([makeWhaleSwapEvent()]);
      source.setResponse(snapshot1);

      const result1 = await collectOnChainFlow(
        { source, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT,
        { source: "helius-api", thresholds: VALID_THRESHOLDS, lookbackMs: LOOKBACK_MS }
      );
      expect(result1.status).toBe("accepted");
      const originalRow = await rawObservationRepo.findByIdentity(
        "helius-api",
        result1.results![0]!.sourceObservationKey
      );
      expect(originalRow).toBeDefined();
      const originalHash = originalRow!.payloadHash;

      const snapshot2 = makeValidSnapshot([makeWhaleSwapEvent({ amountUsdc: "999999999" })]);
      source.setResponse(snapshot2);

      const result2 = await collectOnChainFlow(
        { source, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT,
        { source: "helius-api", thresholds: VALID_THRESHOLDS, lookbackMs: LOOKBACK_MS }
      );
      expect(result2.status).toBe("failed");
      expect(result2.conflict).toBe(1);

      const unchangedRow = await rawObservationRepo.findByIdentity(
        "helius-api",
        result1.results![0]!.sourceObservationKey
      );
      expect(unchangedRow!.payloadHash).toBe(originalHash);
    });
  });

  describe("below-threshold event remains absent", () => {
    it("returns empty when every valid event is filtered below threshold", async () => {
      const { source, rawObservationRepo, normalizedObservationRepo } = makeDeps();
      source.setResponse(makeValidSnapshot([makeWhaleSwapEvent({ amountUsdc: "100" })]));

      const insertOrClassifySpy = vi.spyOn(rawObservationRepo, "insertOrClassify");
      const insertManySpy = vi.spyOn(normalizedObservationRepo, "insertMany");

      const result = await collectOnChainFlow(
        { source, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT,
        { source: "helius-api", thresholds: VALID_THRESHOLDS, lookbackMs: LOOKBACK_MS }
      );

      expect(result.status).toBe("empty");
      expect(result.filtered).toBe(1);
      expect(result.accepted).toBe(0);
      expect(insertOrClassifySpy).not.toHaveBeenCalled();
      expect(insertManySpy).not.toHaveBeenCalled();
    });

    it("accepts Helius net flow at the existing DEX threshold and filters a balanced window", async () => {
      const { source, rawObservationRepo, normalizedObservationRepo } = makeDeps();

      const qualifyingHeliusFlow = {
        eventKind: "dex_net_flow",
        sourceEventId: "helius-address-history:Pool123:1699999000000:1700000000000",
        observedAtUnixMs: 1700000000000,
        amountUsdc: "50000",
        direction: "inbound",
        venue: "solana",
        addressContext: { addressType: "contract", address: "Pool123" },
        sourceReferences: ["https://api.helius.xyz/v0/addresses/Pool123/transactions"],
        sourceQuality: { provider: "helius-api", freshness: "windowed", completeness: "full" },
        freshnessContext: { blockTimestampUnixMs: 1700000000000 },
        windowStartUnixMs: 1699999000000,
        windowEndUnixMs: 1700000000000,
        buyVolumeUsdc: "300000",
        sellVolumeUsdc: "250000",
        netFlowUsdc: "50000"
      };

      source.setResponse(makeValidSnapshot([qualifyingHeliusFlow]));

      const acceptedResult = await collectOnChainFlow(
        { source, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT,
        { source: "helius-api", thresholds: VALID_THRESHOLDS, lookbackMs: LOOKBACK_MS }
      );

      expect(acceptedResult.status).toBe("accepted");
      expect(acceptedResult.accepted).toBe(1);

      const balancedHeliusFlow = {
        ...qualifyingHeliusFlow,
        buyVolumeUsdc: "500000",
        sellVolumeUsdc: "500000",
        netFlowUsdc: "0",
        amountUsdc: "0"
      };

      source.setResponse(makeValidSnapshot([balancedHeliusFlow]));

      const filteredResult = await collectOnChainFlow(
        { source, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT,
        { source: "helius-api", thresholds: VALID_THRESHOLDS, lookbackMs: LOOKBACK_MS }
      );

      expect(filteredResult.status).toBe("empty");
      expect(filteredResult.filtered).toBe(1);
    });
  });

  describe("malformed-only snapshot remains absent and returns malformed", () => {
    it("no raw row is written when all events are malformed", async () => {
      const { source, rawObservationRepo, normalizedObservationRepo } = makeDeps();
      source.setResponse(makeValidSnapshot([{ eventKind: "unknown_event" }]));

      const result = await collectOnChainFlow(
        { source, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT,
        { source: "helius-api", thresholds: VALID_THRESHOLDS, lookbackMs: LOOKBACK_MS }
      );

      expect(result.status).toBe("malformed");
      expect(rawObservationRepo["store"].size).toBe(0);
    });
  });

  describe("valid event followed by malformed event preserves the valid write and returns partial", () => {
    it("per-event failures do not roll back earlier immutable facts", async () => {
      const { source, rawObservationRepo, normalizedObservationRepo } = makeDeps();
      source.setResponse(
        makeValidSnapshot([
          makeWhaleSwapEvent({ sourceEventId: "valid_tx" }),
          { eventKind: "malformed_event" }
        ])
      );

      const result = await collectOnChainFlow(
        { source, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT,
        { source: "helius-api", thresholds: VALID_THRESHOLDS, lookbackMs: LOOKBACK_MS }
      );

      expect(result.status).toBe("partial");
      expect(result.accepted).toBe(1);
      expect(result.failed).toBe(1);

      const rawRows = [...rawObservationRepo["store"].values()];
      expect(rawRows.length).toBe(1);
      expect(rawRows[0]!.parseStatus).toBe("parsed");
    });
  });

  describe("empty snapshot remains absent and returns empty", () => {
    it("returns empty when the source snapshot contains no events", async () => {
      const { source, rawObservationRepo, normalizedObservationRepo } = makeDeps();
      source.setResponse(makeValidSnapshot([]));

      const result = await collectOnChainFlow(
        { source, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT,
        { source: "helius-api", thresholds: VALID_THRESHOLDS, lookbackMs: LOOKBACK_MS }
      );

      expect(result).toMatchObject({
        status: "empty",
        accepted: 0,
        filtered: 0,
        replayed: 0,
        failed: 0,
        conflict: 0,
        sourceObservationId: null,
        sourceObservationKey: null,
        results: []
      });
      expect(rawObservationRepo["store"].size).toBe(0);
      expect(normalizedObservationRepo.count).toBe(0);
    });
  });

  describe("forwards the configured wallet and inclusive lookback window to the source", () => {
    it("includes walletAddress and correct time range in source request", async () => {
      const { source, rawObservationRepo, normalizedObservationRepo } = makeDeps();
      source.setResponse(makeValidSnapshot([]));

      await collectOnChainFlow(
        { source, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT,
        {
          source: "helius-api",
          thresholds: VALID_THRESHOLDS,
          lookbackMs: LOOKBACK_MS,
          walletAddress: "Wallet123"
        }
      );

      expect(source.calls[0]?.request).toEqual({
        pair: "SOL/USDC",
        walletAddress: "Wallet123",
        fromUnixMs: VALID_CONTEXT.startedAtUnixMs - LOOKBACK_MS,
        toUnixMs: VALID_CONTEXT.startedAtUnixMs
      });
    });
  });

  describe("stale qualifying event is retained raw and normalized but returns degraded", () => {
    it("stale context is visible and cannot masquerade as fresh evidence", async () => {
      const { source, rawObservationRepo, normalizedObservationRepo } = makeDeps();
      const staleTimestamp = VALID_CONTEXT.startedAtUnixMs - 10_000_000;
      source.setResponse(
        makeValidSnapshot([makeWhaleSwapEvent({ observedAtUnixMs: staleTimestamp })])
      );

      const result = await collectOnChainFlow(
        { source, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT,
        { source: "helius-api", thresholds: VALID_THRESHOLDS, lookbackMs: LOOKBACK_MS }
      );

      expect(result.status).toBe("degraded");
      expect(result.accepted).toBe(1);
      expect(result.filtered).toBe(0);

      const rawRows = [...rawObservationRepo["store"].values()];
      expect(rawRows.length).toBe(1);
      expect(rawRows[0]!.parseStatus).toBe("parsed");
    });
  });

  describe("CEX proxy below address-quality threshold remains absent", () => {
    it("defensibility gate runs before persistence", async () => {
      const { source, rawObservationRepo, normalizedObservationRepo } = makeDeps();
      source.setResponse(
        makeValidSnapshot([makeCexFlowProxyEvent({ attributionConfidence: 0.1 })])
      );

      const result = await collectOnChainFlow(
        { source, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT,
        { source: "helius-api", thresholds: VALID_THRESHOLDS, lookbackMs: LOOKBACK_MS }
      );

      expect(result.status).toBe("empty");
      expect(result.filtered).toBe(1);
      expect(result.accepted).toBe(0);
      expect(rawObservationRepo["store"].size).toBe(0);
    });
  });

  describe("source timeout returns timeout status", () => {
    it("handles timeout error from source", async () => {
      const { source, rawObservationRepo, normalizedObservationRepo } = makeDeps();
      source.setError({ kind: "timeout", diagnostic: "Connection timed out" });

      const result = await collectOnChainFlow(
        { source, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT,
        { source: "helius-api", thresholds: VALID_THRESHOLDS, lookbackMs: LOOKBACK_MS }
      );

      expect(result.status).toBe("timeout");
    });
  });

  describe("source unavailable returns unavailable status", () => {
    it("handles unavailable error from source", async () => {
      const { source, rawObservationRepo, normalizedObservationRepo } = makeDeps();
      source.setError({ kind: "unavailable", diagnostic: "Service unavailable" });

      const result = await collectOnChainFlow(
        { source, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT,
        { source: "helius-api", thresholds: VALID_THRESHOLDS, lookbackMs: LOOKBACK_MS }
      );

      expect(result.status).toBe("unavailable");
    });
  });

  describe("processes events in deterministic order", () => {
    it("events are sorted by sourceEventId before processing", async () => {
      const { source, rawObservationRepo, normalizedObservationRepo } = makeDeps();
      source.setResponse(
        makeValidSnapshot([
          makeWhaleSwapEvent({ sourceEventId: "tx_ccc", transactionSignature: "sig_ccc" }),
          makeWhaleSwapEvent({ sourceEventId: "tx_aaa", transactionSignature: "sig_aaa" }),
          makeWhaleSwapEvent({ sourceEventId: "tx_bbb", transactionSignature: "sig_bbb" })
        ])
      );

      const result = await collectOnChainFlow(
        { source, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT,
        { source: "helius-api", thresholds: VALID_THRESHOLDS, lookbackMs: LOOKBACK_MS }
      );

      expect(result.status).toBe("accepted");
      expect(result.results).toBeDefined();
      if (result.results) {
        const eventIds = result.results.map((r) => r.sourceEventId);
        expect(eventIds).toEqual(["tx_aaa", "tx_bbb", "tx_ccc"]);
      }
    });
  });
});
