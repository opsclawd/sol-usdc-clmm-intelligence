import { describe, it, expect } from "vitest";
import type {
  WhaleSwapPayloadV1,
  DexNetFlowPayloadV1,
  CexFlowProxyPayloadV1
} from "../../../src/contracts/on-chain-flow.js";
import type { Source } from "../../../src/contracts/taxonomy.js";
import { enrichOnChainFlow } from "../../../src/domain/on-chain-flow/enrich.js";

function getFirst<T>(arr: readonly T[]): T {
  expect(arr.length).toBeGreaterThan(0);
  return arr[0] as T;
}

function getAt<T>(arr: readonly T[], index: number): T {
  expect(arr.length).toBeGreaterThan(index);
  return arr[index] as T;
}

function makeWhaleSwapCandidate(
  overrides?: Partial<{
    id: number;
    source: Source;
    observedAtUnixMs: number;
    receivedAtUnixMs: number;
    fetchedAtUnixMs: number;
    payload: WhaleSwapPayloadV1;
  }>
) {
  const payload: WhaleSwapPayloadV1 = {
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
    sourceQuality: { provider: "birdeye-api", freshness: "windowed", completeness: "full" },
    freshnessContext: { slot: 123456789, blockTimestampUnixMs: 1700000000000 },
    transactionSignature: "txn_abc123",
    eventIndex: 0,
    slot: 123456789,
    stablecoinOperation: "transfer"
  };

  return {
    id: overrides?.id ?? 1,
    source: overrides?.source ?? ("birdeye-api" as Source),
    observedAtUnixMs: overrides?.observedAtUnixMs ?? 1700000000000,
    receivedAtUnixMs: overrides?.receivedAtUnixMs ?? 1700000001000,
    fetchedAtUnixMs: overrides?.fetchedAtUnixMs ?? 1700000000500,
    payload: overrides?.payload ?? payload
  };
}

function makeDexNetFlowCandidate(
  overrides?: Partial<{
    id: number;
    source: Source;
    observedAtUnixMs: number;
    receivedAtUnixMs: number;
    fetchedAtUnixMs: number;
    payload: DexNetFlowPayloadV1;
  }>
) {
  const payload: DexNetFlowPayloadV1 = {
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

  return {
    id: overrides?.id ?? 2,
    source: overrides?.source ?? ("birdeye-api" as Source),
    observedAtUnixMs: overrides?.observedAtUnixMs ?? 1700000000000,
    receivedAtUnixMs: overrides?.receivedAtUnixMs ?? 1700000001000,
    fetchedAtUnixMs: overrides?.fetchedAtUnixMs ?? 1700000000500,
    payload: overrides?.payload ?? payload
  };
}

function makeCexFlowProxyCandidate(
  overrides?: Partial<{
    id: number;
    source: Source;
    observedAtUnixMs: number;
    receivedAtUnixMs: number;
    fetchedAtUnixMs: number;
    payload: CexFlowProxyPayloadV1;
  }>
) {
  const payload: CexFlowProxyPayloadV1 = {
    schemaVersion: 1,
    eventFamily: "on_chain_flow",
    eventType: "cex_flow_proxy",
    sourceEventId: "cex_001",
    observedAtUnixMs: 1700000000000,
    amountUsdc: "5000000",
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

  return {
    id: overrides?.id ?? 3,
    source: overrides?.source ?? ("helius-api" as Source),
    observedAtUnixMs: overrides?.observedAtUnixMs ?? 1700000000000,
    receivedAtUnixMs: overrides?.receivedAtUnixMs ?? 1700000001000,
    fetchedAtUnixMs: overrides?.fetchedAtUnixMs ?? 1700000000500,
    payload: overrides?.payload ?? payload
  };
}

describe("enrichOnChainFlow", () => {
  describe("enrichment computes freshness from source time and retrieval time", () => {
    it("fresh data is marked as not stale", async () => {
      const candidate = makeWhaleSwapCandidate({
        observedAtUnixMs: 1700000000000,
        fetchedAtUnixMs: 1700000000500,
        receivedAtUnixMs: 1700000001000
      });

      const nowMs = 1700000005000;
      const result = await enrichOnChainFlow({
        candidates: [candidate],
        nowMs,
        codeVersion: "test-v1",
        runId: null
      });

      expect(getFirst(result).freshness.isStale).toBe(false);
    });

    it("expired data is marked stale under the taxonomy policy", async () => {
      const candidate = makeWhaleSwapCandidate({
        observedAtUnixMs: 1700000000000,
        fetchedAtUnixMs: 1700000000500,
        receivedAtUnixMs: 1700000001000
      });

      const nowMs = 1700000910000;

      const result = await enrichOnChainFlow({
        candidates: [candidate],
        nowMs,
        codeVersion: "test-v1",
        runId: null
      });

      expect(getFirst(result).freshness.isStale).toBe(true);
    });

    it("freshness derives validUntil from maxObservedAgeMs policy", async () => {
      const candidate = makeWhaleSwapCandidate({
        observedAtUnixMs: 1700000000000,
        fetchedAtUnixMs: 1700000000500,
        receivedAtUnixMs: 1700000001000
      });

      const nowMs = 1700000005000;

      const result = await enrichOnChainFlow({
        candidates: [candidate],
        nowMs,
        codeVersion: "test-v1",
        runId: null
      });

      expect(getFirst(result).freshness.validUntilUnixMs).toBe(1700000000000 + 900000);
    });

    it("freshness reason includes expired_past_max_observed_age when stale", async () => {
      const candidate = makeWhaleSwapCandidate({
        observedAtUnixMs: 1700000000000,
        fetchedAtUnixMs: 1700000000500,
        receivedAtUnixMs: 1700000001000
      });

      const nowMs = 1700000910000;

      const result = await enrichOnChainFlow({
        candidates: [candidate],
        nowMs,
        codeVersion: "test-v1",
        runId: null
      });

      expect(getFirst(result).freshness.reasons).toContain("expired_past_max_observed_age");
    });
  });

  describe("enrichment validates raw-first provenance", () => {
    it("provenance sourceRefs point to the actual raw row", async () => {
      const candidate = makeWhaleSwapCandidate({ id: 42 });

      const result = await enrichOnChainFlow({
        candidates: [candidate],
        nowMs: 1700000005000,
        codeVersion: "test-v1",
        runId: "run-123"
      });

      expect(getFirst(result).provenance.rawObservationRefs).toHaveLength(1);
      expect(getAt(getFirst(result).provenance.rawObservationRefs, 0).id).toBe(42);
      expect(getAt(getFirst(result).provenance.rawObservationRefs, 0).source).toBe("birdeye-api");
    });

    it("provenance sourceRefs point to allowed provider helius-api", async () => {
      const candidate = makeWhaleSwapCandidate({ source: "helius-api" });

      const result = await enrichOnChainFlow({
        candidates: [candidate],
        nowMs: 1700000005000,
        codeVersion: "test-v1",
        runId: null
      });

      expect(getFirst(result).provenance.sourceRefs).toHaveLength(1);
      expect(getAt(getFirst(result).provenance.sourceRefs, 0).source).toBe("helius-api");
    });

    it("provenance sourceRefs point to allowed provider birdeye-api", async () => {
      const candidate = makeDexNetFlowCandidate({ source: "birdeye-api" });

      const result = await enrichOnChainFlow({
        candidates: [candidate],
        nowMs: 1700000005000,
        codeVersion: "test-v1",
        runId: null
      });

      expect(getFirst(result).provenance.sourceRefs).toHaveLength(1);
      expect(getAt(getFirst(result).provenance.sourceRefs, 0).source).toBe("birdeye-api");
    });

    it("provenance processRef includes collector and jobName", async () => {
      const candidate = makeWhaleSwapCandidate();

      const result = await enrichOnChainFlow({
        candidates: [candidate],
        nowMs: 1700000005000,
        codeVersion: "test-v1",
        runId: "run-123"
      });

      expect(getFirst(result).provenance.processRef.collector).toBe("on-chain-flow-collector");
      expect(getFirst(result).provenance.processRef.jobName).toBe("on-chain-flow-intelligence");
      expect(getFirst(result).provenance.processRef.pipelineRunId).toBe("run-123");
      expect(getFirst(result).provenance.codeVersion).toBe("test-v1");
    });

    it("provenance validates successfully for birdeye-api whale_swap", async () => {
      const candidate = makeWhaleSwapCandidate();

      const result = await enrichOnChainFlow({
        candidates: [candidate],
        nowMs: 1700000005000,
        codeVersion: "test-v1",
        runId: null
      });

      expect(getFirst(result).provenance.sourceRefs.length).toBeGreaterThan(0);
    });

    it("provenance validates successfully for birdeye-api dex_net_flow", async () => {
      const candidate = makeDexNetFlowCandidate();

      const result = await enrichOnChainFlow({
        candidates: [candidate],
        nowMs: 1700000005000,
        codeVersion: "test-v1",
        runId: null
      });

      expect(getFirst(result).provenance.sourceRefs.length).toBeGreaterThan(0);
    });
  });

  describe("CEX confidence is capped by attribution quality and records the cap reason", () => {
    it("CEX confidence is capped at 0.69 composite score", async () => {
      const candidate = makeCexFlowProxyCandidate({
        payload: {
          ...makeCexFlowProxyCandidate().payload,
          attributionConfidence: 1.0
        }
      });

      const result = await enrichOnChainFlow({
        candidates: [candidate],
        nowMs: 1700000005000,
        codeVersion: "test-v1",
        runId: null
      });

      expect(getFirst(result).confidence.compositeScore).toBeLessThanOrEqual(0.69);
    });

    it("CEX confidence cap reason is recorded when cap is applied", async () => {
      const candidate = makeCexFlowProxyCandidate({
        payload: {
          ...makeCexFlowProxyCandidate().payload,
          attributionConfidence: 1.0
        }
      });

      const result = await enrichOnChainFlow({
        candidates: [candidate],
        nowMs: 1700000005000,
        codeVersion: "test-v1",
        runId: null
      });

      expect(getFirst(result).confidence.reasons).toContain("cex_proxy_quality_cap_applied");
    });

    it("CEX confidence level is capped at medium even if score would be high", async () => {
      const candidate = makeCexFlowProxyCandidate({
        payload: {
          ...makeCexFlowProxyCandidate().payload,
          attributionConfidence: 1.0
        }
      });

      const result = await enrichOnChainFlow({
        candidates: [candidate],
        nowMs: 1700000005000,
        codeVersion: "test-v1",
        runId: null
      });

      expect(getFirst(result).confidence.level).toBe("medium");
    });

    it("CEX confidence with high attribution still gets capped", async () => {
      const candidate = makeCexFlowProxyCandidate({
        payload: {
          ...makeCexFlowProxyCandidate().payload,
          attributionConfidence: 0.95
        }
      });

      const result = await enrichOnChainFlow({
        candidates: [candidate],
        nowMs: 1700000005000,
        codeVersion: "test-v1",
        runId: null
      });

      expect(getFirst(result).confidence.compositeScore).toBeLessThanOrEqual(0.69);
      expect(getFirst(result).confidence.reasons).toContain("cex_proxy_quality_cap_applied");
    });

    it("sourceReliability is capped at attributionConfidence for CEX", async () => {
      const candidate = makeCexFlowProxyCandidate({
        payload: {
          ...makeCexFlowProxyCandidate().payload,
          attributionConfidence: 0.6
        }
      });

      const result = await enrichOnChainFlow({
        candidates: [candidate],
        nowMs: 1700000005000,
        codeVersion: "test-v1",
        runId: null
      });

      expect(getFirst(result).confidence.components.sourceReliability).toBeLessThanOrEqual(0.6);
    });
  });

  describe("non-CEX confidence does not receive the CEX cap", () => {
    it("whale_swap confidence is not capped at 0.69", async () => {
      const candidate = makeWhaleSwapCandidate();

      const result = await enrichOnChainFlow({
        candidates: [candidate],
        nowMs: 1700000005000,
        codeVersion: "test-v1",
        runId: null
      });

      expect(getFirst(result).confidence.compositeScore).toBeGreaterThan(0.69);
    });

    it("whale_swap confidence does not include cex_proxy_quality_cap_applied", async () => {
      const candidate = makeWhaleSwapCandidate();

      const result = await enrichOnChainFlow({
        candidates: [candidate],
        nowMs: 1700000005000,
        codeVersion: "test-v1",
        runId: null
      });

      expect(getFirst(result).confidence.reasons).not.toContain("cex_proxy_quality_cap_applied");
    });

    it("dex_net_flow confidence is not capped at 0.69", async () => {
      const candidate = makeDexNetFlowCandidate();

      const result = await enrichOnChainFlow({
        candidates: [candidate],
        nowMs: 1700000005000,
        codeVersion: "test-v1",
        runId: null
      });

      expect(getFirst(result).confidence.compositeScore).toBeGreaterThan(0.69);
    });

    it("dex_net_flow confidence does not include cex_proxy_quality_cap_applied", async () => {
      const candidate = makeDexNetFlowCandidate();

      const result = await enrichOnChainFlow({
        candidates: [candidate],
        nowMs: 1700000005000,
        codeVersion: "test-v1",
        runId: null
      });

      expect(getFirst(result).confidence.reasons).not.toContain("cex_proxy_quality_cap_applied");
    });

    it("deterministic facts retain ordinary component weighting", async () => {
      const candidate = makeWhaleSwapCandidate();

      const result = await enrichOnChainFlow({
        candidates: [candidate],
        nowMs: 1700000005000,
        codeVersion: "test-v1",
        runId: null
      });

      expect(getFirst(result).signalClass).toBe("deterministic");
      expect(getFirst(result).evidenceFamily).toBe("on_chain_flow");
    });
  });

  describe("enrichment returns correct output structure", () => {
    it("returns all required fields for NormalizedObservationInsert", async () => {
      const candidate = makeWhaleSwapCandidate();

      const result = await enrichOnChainFlow({
        candidates: [candidate],
        nowMs: 1700000005000,
        codeVersion: "test-v1",
        runId: null
      });

      expect(result[0]).toHaveProperty("id");
      expect(result[0]).toHaveProperty("source");
      expect(result[0]).toHaveProperty("payloadCanonical");
      expect(result[0]).toHaveProperty("payloadHash");
      expect(result[0]).toHaveProperty("receivedAtUnixMs");
      expect(result[0]).toHaveProperty("fetchedAtUnixMs");
      expect(result[0]).toHaveProperty("observedAtUnixMs");
      expect(result[0]).toHaveProperty("kind");
      expect(result[0]).toHaveProperty("evidenceFamily");
      expect(result[0]).toHaveProperty("signalClass");
      expect(result[0]).toHaveProperty("confidence");
      expect(result[0]).toHaveProperty("freshness");
      expect(result[0]).toHaveProperty("provenance");
    });

    it("computes completeness from required context availability", async () => {
      const candidate = makeWhaleSwapCandidate({
        payload: {
          ...makeWhaleSwapCandidate().payload,
          sourceQuality: { provider: "helius-api", freshness: "realtime", completeness: "full" }
        }
      });

      const result = await enrichOnChainFlow({
        candidates: [candidate],
        nowMs: 1700000005000,
        codeVersion: "test-v1",
        runId: null
      });

      expect(getFirst(result).confidence.components.dataCompleteness).toBe(1);
    });

    it("handles partial completeness correctly", async () => {
      const candidate = makeWhaleSwapCandidate({
        payload: {
          ...makeWhaleSwapCandidate().payload,
          sourceQuality: { provider: "helius-api", freshness: "realtime", completeness: "partial" }
        }
      });

      const result = await enrichOnChainFlow({
        candidates: [candidate],
        nowMs: 1700000005000,
        codeVersion: "test-v1",
        runId: null
      });

      expect(getFirst(result).confidence.components.dataCompleteness).toBeLessThan(1);
    });

    it("returns empty array when given empty candidates", async () => {
      const result = await enrichOnChainFlow({
        candidates: [],
        nowMs: 1700000005000,
        codeVersion: "test-v1",
        runId: null
      });

      expect(result).toEqual([]);
    });

    it("enriches multiple candidates correctly", async () => {
      const whaleSwap = makeWhaleSwapCandidate({ id: 1 });
      const dexNetFlow = makeDexNetFlowCandidate({ id: 2 });
      const cexFlowProxy = makeCexFlowProxyCandidate({ id: 3 });

      const result = await enrichOnChainFlow({
        candidates: [whaleSwap, dexNetFlow, cexFlowProxy],
        nowMs: 1700000005000,
        codeVersion: "test-v1",
        runId: null
      });

      expect(result).toHaveLength(3);
      expect(getFirst(result).kind).toBe("whale_swap");
      expect(getAt(result, 1).kind).toBe("dex_net_flow");
      expect(getAt(result, 2).kind).toBe("cex_flow_proxy");
    });
  });
});
