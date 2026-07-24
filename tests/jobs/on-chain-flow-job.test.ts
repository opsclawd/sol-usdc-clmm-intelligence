import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CollectionRunContext } from "../../src/application/create-collection-run-context.js";
import type { NormalizedObservationRepo } from "../../src/ports/normalized-observation-repo.js";
import type { RawObservationRepo } from "../../src/ports/observation-repo.js";
import type { OnChainFlowSourcePort } from "../../src/ports/on-chain-flow-source.js";
import type { OnChainFlowCollectionResult } from "../../src/application/collect-on-chain-flow.js";
import type { OnChainFlowThresholds } from "../../src/contracts/on-chain-flow.js";

const mockCreateCollectionRunContext = vi.fn();
vi.mock("../../src/application/create-collection-run-context.js", () => {
  return {
    createCollectionRunContext: (args: unknown) => mockCreateCollectionRunContext(args)
  };
});

const mockCollectOnChainFlow = vi.fn();
vi.mock("../../src/application/collect-on-chain-flow.js", () => {
  return {
    collectOnChainFlow: (
      deps: unknown,
      context: unknown,
      input: { source: string; thresholds: unknown; lookbackMs: number }
    ) => mockCollectOnChainFlow(deps, context, input)
  };
});

import {
  onChainFlowJob,
  runOnChainFlowJob,
  type ConfiguredOnChainFlowSource
} from "../../src/jobs/on-chain-flow-job.js";

const VALID_CONTEXT: CollectionRunContext = Object.freeze({
  runId: "run-context-123",
  startedAtUnixMs: 1704067200000
});

const VALID_THRESHOLDS: OnChainFlowThresholds = Object.freeze({
  whaleTransferMinUsdc: "10000",
  whaleSwapMinUsdc: "10000",
  stablecoinFlowMinUsdc: "100000",
  dexNetFlowMinUsdc: "100000",
  cexFlowProxyMinUsdc: "100000",
  cexMinAttributionConfidence: 0.8
});

const LOOKBACK_MS = 3_600_000;

function makeOnChainFlowSource(): OnChainFlowSourcePort {
  return {
    collect: vi.fn()
  } as unknown as OnChainFlowSourcePort;
}

function makeJobDeps(sources: readonly ConfiguredOnChainFlowSource[]) {
  return {
    sources,
    rawObservationRepo: {
      insertOrClassify: vi.fn(),
      findById: vi.fn(),
      updateParseStatus: vi.fn()
    } as unknown as RawObservationRepo,
    normalizedObservationRepo: {
      insertMany: vi.fn(),
      findBySource: vi.fn()
    } as unknown as NormalizedObservationRepo,
    env: {
      get: vi.fn(),
      getOptional: vi.fn()
    },
    clock: {
      now: vi.fn()
    },
    runIdFactory: {
      nextRunId: vi.fn()
    },
    thresholds: VALID_THRESHOLDS,
    lookbackMs: LOOKBACK_MS
  };
}

const ACCEPTED_RESULT: OnChainFlowCollectionResult = {
  status: "accepted",
  accepted: 5,
  filtered: 2,
  replayed: 0,
  failed: 0,
  conflict: 0,
  sourceObservationId: 1,
  sourceObservationKey: "key-1",
  results: []
};

const DEGRADED_RESULT: OnChainFlowCollectionResult = {
  status: "degraded",
  accepted: 3,
  filtered: 1,
  replayed: 0,
  failed: 0,
  conflict: 0,
  sourceObservationId: 2,
  sourceObservationKey: "key-2",
  results: []
};

const PARTIAL_RESULT: OnChainFlowCollectionResult = {
  status: "partial",
  accepted: 2,
  filtered: 1,
  replayed: 0,
  failed: 1,
  conflict: 0,
  sourceObservationId: 3,
  sourceObservationKey: "key-3",
  results: []
};

const IDENTICAL_REPLAY_RESULT: OnChainFlowCollectionResult = {
  status: "identical_replay",
  accepted: 0,
  filtered: 0,
  replayed: 5,
  failed: 0,
  conflict: 0,
  sourceObservationId: null,
  sourceObservationKey: null,
  results: []
};

const TIMEOUT_RESULT: OnChainFlowCollectionResult = {
  status: "timeout",
  accepted: 0,
  filtered: 0,
  replayed: 0,
  failed: 0,
  conflict: 0,
  sourceObservationId: null,
  sourceObservationKey: null,
  results: []
};

const NETWORK_RESULT: OnChainFlowCollectionResult = {
  status: "network",
  accepted: 0,
  filtered: 0,
  replayed: 0,
  failed: 0,
  conflict: 0,
  sourceObservationId: null,
  sourceObservationKey: null,
  results: []
};

const UNAVAILABLE_RESULT: OnChainFlowCollectionResult = {
  status: "unavailable",
  accepted: 0,
  filtered: 0,
  replayed: 0,
  failed: 0,
  conflict: 0,
  sourceObservationId: null,
  sourceObservationKey: null,
  results: []
};

const MALFORMED_RESULT: OnChainFlowCollectionResult = {
  status: "malformed",
  accepted: 0,
  filtered: 0,
  replayed: 0,
  failed: 0,
  conflict: 0,
  sourceObservationId: null,
  sourceObservationKey: null,
  results: []
};

describe("onChainFlowJob", () => {
  beforeEach(() => {
    mockCreateCollectionRunContext.mockReset();
    mockCollectOnChainFlow.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("runs configured sources once with a shared collection context", () => {
    it("creates exactly one collection run context regardless of source count", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectOnChainFlow.mockResolvedValue(ACCEPTED_RESULT);

      const sources: ConfiguredOnChainFlowSource[] = [
        { source: "helius-api", adapter: makeOnChainFlowSource() },
        { source: "birdeye-api", adapter: makeOnChainFlowSource() }
      ];
      const deps = makeJobDeps(sources);
      const job = onChainFlowJob(deps);
      await job();

      expect(mockCreateCollectionRunContext).toHaveBeenCalledTimes(1);
    });

    it("calls each configured source exactly once", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectOnChainFlow.mockResolvedValue(ACCEPTED_RESULT);

      const sources: ConfiguredOnChainFlowSource[] = [
        { source: "helius-api", adapter: makeOnChainFlowSource() },
        { source: "birdeye-api", adapter: makeOnChainFlowSource() }
      ];
      const deps = makeJobDeps(sources);
      const job = onChainFlowJob(deps);
      await job();

      expect(mockCollectOnChainFlow).toHaveBeenCalledTimes(2);
    });

    it("passes the same context to all source collections", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectOnChainFlow.mockResolvedValue(ACCEPTED_RESULT);

      const sources: ConfiguredOnChainFlowSource[] = [
        { source: "helius-api", adapter: makeOnChainFlowSource() },
        { source: "birdeye-api", adapter: makeOnChainFlowSource() }
      ];
      const deps = makeJobDeps(sources);
      const job = onChainFlowJob(deps);
      await job();

      const allCalls = mockCollectOnChainFlow.mock.calls;
      expect(allCalls.every((call) => call[1] === VALID_CONTEXT)).toBe(true);
    });

    it("passes the same explicit thresholds and lookback to all sources", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectOnChainFlow.mockResolvedValue(ACCEPTED_RESULT);

      const sources: ConfiguredOnChainFlowSource[] = [
        { source: "helius-api", adapter: makeOnChainFlowSource() },
        { source: "birdeye-api", adapter: makeOnChainFlowSource() }
      ];
      const deps = makeJobDeps(sources);
      const job = onChainFlowJob(deps);
      await job();

      const allCalls = mockCollectOnChainFlow.mock.calls;
      expect(allCalls.every((call) => call[2].thresholds === VALID_THRESHOLDS)).toBe(true);
      expect(allCalls.every((call) => call[2].lookbackMs === LOOKBACK_MS)).toBe(true);
    });

    it("executes all configured sources concurrently", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);

      let resolveFirst: (value: OnChainFlowCollectionResult) => void;
      let resolveSecond: (value: OnChainFlowCollectionResult) => void;

      const firstPromise = new Promise<OnChainFlowCollectionResult>((resolve) => {
        resolveFirst = resolve;
      });
      const secondPromise = new Promise<OnChainFlowCollectionResult>((resolve) => {
        resolveSecond = resolve;
      });

      mockCollectOnChainFlow
        .mockResolvedValueOnce(firstPromise)
        .mockResolvedValueOnce(secondPromise);

      const sources: ConfiguredOnChainFlowSource[] = [
        { source: "helius-api", adapter: makeOnChainFlowSource() },
        { source: "birdeye-api", adapter: makeOnChainFlowSource() }
      ];
      const deps = makeJobDeps(sources);
      const job = onChainFlowJob(deps);

      const startTime = Date.now();
      const jobPromise = job();

      await new Promise((r) => setTimeout(r, 10));

      resolveFirst!(ACCEPTED_RESULT);
      resolveSecond!(ACCEPTED_RESULT);

      await jobPromise;
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(100);
    });

    it("preserves configured source ordering in outcomes", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectOnChainFlow
        .mockResolvedValueOnce({ ...ACCEPTED_RESULT, source: "helius-api" })
        .mockResolvedValueOnce({ ...ACCEPTED_RESULT, source: "birdeye-api" });

      const sources: ConfiguredOnChainFlowSource[] = [
        { source: "helius-api", adapter: makeOnChainFlowSource() },
        { source: "birdeye-api", adapter: makeOnChainFlowSource() }
      ];
      const deps = makeJobDeps(sources);
      const result = await runOnChainFlowJob(deps);

      const sourceKeys = result.outcomes.map((o) => o.source);
      expect(sourceKeys).toEqual(["birdeye-api", "helius-api"]);
    });

    it("catches thrown source calls and converts to failed outcomes with redacted diagnostics", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectOnChainFlow.mockImplementation((_, __, input: { source: string }) => {
        if (input.source === "helius-api") {
          return Promise.reject(new Error("API key invalid secret123"));
        }
        return Promise.resolve(ACCEPTED_RESULT);
      });

      const sources: ConfiguredOnChainFlowSource[] = [
        { source: "helius-api", adapter: makeOnChainFlowSource() },
        { source: "birdeye-api", adapter: makeOnChainFlowSource() }
      ];
      const deps = makeJobDeps(sources);
      const result = await runOnChainFlowJob(deps);

      const failedOutcome = result.outcomes.find((o) => o.source === "helius-api");
      expect(failedOutcome).toMatchObject({
        source: "helius-api",
        status: "failed",
        hasUsableEvidence: false
      });
      expect(failedOutcome?.diagnostic).not.toContain("secret123");
      expect(failedOutcome?.diagnostic).toContain("[REDACTED]");
    });
  });

  describe("reduces source outcomes with the on-chain flow truth table", () => {
    it("all usable sources reduce to COMPLETE without command failure", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectOnChainFlow
        .mockResolvedValueOnce({ ...ACCEPTED_RESULT, source: "helius-api" })
        .mockResolvedValueOnce({ ...ACCEPTED_RESULT, source: "birdeye-api" });

      const sources: ConfiguredOnChainFlowSource[] = [
        { source: "helius-api", adapter: makeOnChainFlowSource() },
        { source: "birdeye-api", adapter: makeOnChainFlowSource() }
      ];
      const deps = makeJobDeps(sources);
      const result = await runOnChainFlowJob(deps);

      expect(result.status).toBe("COMPLETE");
      expect(result.shouldFailCommand).toBe(false);
    });

    it("one usable and one unavailable source reduce to PARTIAL without command failure", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectOnChainFlow
        .mockResolvedValueOnce({ ...ACCEPTED_RESULT, source: "helius-api" })
        .mockResolvedValueOnce({ ...UNAVAILABLE_RESULT, source: "birdeye-api" });

      const sources: ConfiguredOnChainFlowSource[] = [
        { source: "helius-api", adapter: makeOnChainFlowSource() },
        { source: "birdeye-api", adapter: makeOnChainFlowSource() }
      ];
      const deps = makeJobDeps(sources);
      const result = await runOnChainFlowJob(deps);

      expect(result.status).toBe("PARTIAL");
      expect(result.shouldFailCommand).toBe(false);
    });

    it("all unavailable sources reduce to UNAVAILABLE with command failure", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectOnChainFlow
        .mockResolvedValueOnce({ ...TIMEOUT_RESULT, source: "helius-api" })
        .mockResolvedValueOnce({ ...NETWORK_RESULT, source: "birdeye-api" });

      const sources: ConfiguredOnChainFlowSource[] = [
        { source: "helius-api", adapter: makeOnChainFlowSource() },
        { source: "birdeye-api", adapter: makeOnChainFlowSource() }
      ];
      const deps = makeJobDeps(sources);
      const result = await runOnChainFlowJob(deps);

      expect(result.status).toBe("UNAVAILABLE");
      expect(result.shouldFailCommand).toBe(true);
    });

    it("zero usable sources with malformed or persistence failure reduce to FAILED with command failure", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectOnChainFlow
        .mockResolvedValueOnce({ ...MALFORMED_RESULT, source: "helius-api" })
        .mockResolvedValueOnce({ ...MALFORMED_RESULT, source: "birdeye-api" });

      const sources: ConfiguredOnChainFlowSource[] = [
        { source: "helius-api", adapter: makeOnChainFlowSource() },
        { source: "birdeye-api", adapter: makeOnChainFlowSource() }
      ];
      const deps = makeJobDeps(sources);
      const result = await runOnChainFlowJob(deps);

      expect(result.status).toBe("FAILED");
      expect(result.shouldFailCommand).toBe(true);
    });

    it("treats degraded status as usable", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectOnChainFlow
        .mockResolvedValueOnce({ ...DEGRADED_RESULT, source: "helius-api" })
        .mockResolvedValueOnce({ ...TIMEOUT_RESULT, source: "birdeye-api" });

      const sources: ConfiguredOnChainFlowSource[] = [
        { source: "helius-api", adapter: makeOnChainFlowSource() },
        { source: "birdeye-api", adapter: makeOnChainFlowSource() }
      ];
      const deps = makeJobDeps(sources);
      const result = await runOnChainFlowJob(deps);

      expect(result.status).toBe("PARTIAL");
      expect(result.shouldFailCommand).toBe(false);
    });

    it("treats identical_replay status as usable", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectOnChainFlow
        .mockResolvedValueOnce({ ...IDENTICAL_REPLAY_RESULT, source: "helius-api" })
        .mockResolvedValueOnce({ ...ACCEPTED_RESULT, source: "birdeye-api" });

      const sources: ConfiguredOnChainFlowSource[] = [
        { source: "helius-api", adapter: makeOnChainFlowSource() },
        { source: "birdeye-api", adapter: makeOnChainFlowSource() }
      ];
      const deps = makeJobDeps(sources);
      const result = await runOnChainFlowJob(deps);

      expect(result.status).toBe("COMPLETE");
      expect(result.shouldFailCommand).toBe(false);
    });

    it("treats partial status as usable", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectOnChainFlow
        .mockResolvedValueOnce({ ...PARTIAL_RESULT, source: "helius-api" })
        .mockResolvedValueOnce({ ...TIMEOUT_RESULT, source: "birdeye-api" });

      const sources: ConfiguredOnChainFlowSource[] = [
        { source: "helius-api", adapter: makeOnChainFlowSource() },
        { source: "birdeye-api", adapter: makeOnChainFlowSource() }
      ];
      const deps = makeJobDeps(sources);
      const result = await runOnChainFlowJob(deps);

      expect(result.status).toBe("PARTIAL");
      expect(result.shouldFailCommand).toBe(false);
    });

    it("does not convert absence into evidence (empty results treated as accepted with no evidence)", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectOnChainFlow
        .mockResolvedValueOnce({
          status: "accepted",
          accepted: 0,
          filtered: 0,
          replayed: 0,
          failed: 0,
          conflict: 0,
          sourceObservationId: null,
          sourceObservationKey: null,
          results: []
        })
        .mockResolvedValueOnce({
          status: "accepted",
          accepted: 0,
          filtered: 0,
          replayed: 0,
          failed: 0,
          conflict: 0,
          sourceObservationId: null,
          sourceObservationKey: null,
          results: []
        });

      const sources: ConfiguredOnChainFlowSource[] = [
        { source: "helius-api", adapter: makeOnChainFlowSource() },
        { source: "birdeye-api", adapter: makeOnChainFlowSource() }
      ];
      const deps = makeJobDeps(sources);
      const result = await runOnChainFlowJob(deps);

      expect(result.status).toBe("COMPLETE");
      expect(result.shouldFailCommand).toBe(false);
    });
  });

  describe("validates source configuration", () => {
    it("throws on empty source list", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);

      const sources: ConfiguredOnChainFlowSource[] = [];
      const deps = makeJobDeps(sources);

      await expect(runOnChainFlowJob(deps)).rejects.toThrow(
        "At least one on-chain flow source must be configured"
      );
    });

    it("duplicate configured source names abort before collection", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);

      const sources: ConfiguredOnChainFlowSource[] = [
        { source: "helius-api", adapter: makeOnChainFlowSource() },
        { source: "helius-api", adapter: makeOnChainFlowSource() }
      ];
      const deps = makeJobDeps(sources);

      await expect(runOnChainFlowJob(deps)).rejects.toThrow("Duplicate on-chain flow source");
      expect(mockCollectOnChainFlow).not.toHaveBeenCalled();
    });

    it("requires exactly two sources", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);

      const sources: ConfiguredOnChainFlowSource[] = [
        { source: "birdeye-api", adapter: makeOnChainFlowSource() }
      ];
      const deps = makeJobDeps(sources);

      await expect(runOnChainFlowJob(deps)).rejects.toThrow(
        "Exactly two on-chain flow sources (helius-api and birdeye-api) must be configured"
      );
    });

    it("rejects duplicate source names", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);

      const sources: ConfiguredOnChainFlowSource[] = [
        { source: "helius-api", adapter: makeOnChainFlowSource() },
        { source: "helius-api", adapter: makeOnChainFlowSource() }
      ];
      const deps = makeJobDeps(sources);

      await expect(runOnChainFlowJob(deps)).rejects.toThrow(
        "Duplicate on-chain flow source names are not allowed"
      );
    });

    it("rejects two birdeye-api sources (duplicate check before heliusCount validation)", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);

      const sources: ConfiguredOnChainFlowSource[] = [
        { source: "birdeye-api", adapter: makeOnChainFlowSource() },
        { source: "birdeye-api", adapter: makeOnChainFlowSource() }
      ];
      const deps = makeJobDeps(sources);

      await expect(runOnChainFlowJob(deps)).rejects.toThrow(
        "Duplicate on-chain flow source names are not allowed"
      );
    });

    it("rejects more than two sources", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);

      const sources: ConfiguredOnChainFlowSource[] = [
        { source: "helius-api", adapter: makeOnChainFlowSource() },
        { source: "birdeye-api", adapter: makeOnChainFlowSource() },
        { source: "helius-api", adapter: makeOnChainFlowSource() }
      ];
      const deps = makeJobDeps(sources);

      await expect(runOnChainFlowJob(deps)).rejects.toThrow(
        "Exactly two on-chain flow sources (helius-api and birdeye-api) must be configured"
      );
    });
  });

  describe("returns outcomes in stable source-name order", () => {
    it("birdeye-api comes before helius-api alphabetically", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectOnChainFlow
        .mockResolvedValueOnce({ ...ACCEPTED_RESULT, source: "helius-api" })
        .mockResolvedValueOnce({ ...ACCEPTED_RESULT, source: "birdeye-api" });

      const sources: ConfiguredOnChainFlowSource[] = [
        { source: "helius-api", adapter: makeOnChainFlowSource() },
        { source: "birdeye-api", adapter: makeOnChainFlowSource() }
      ];
      const deps = makeJobDeps(sources);
      const result = await runOnChainFlowJob(deps);

      expect(result.outcomes[0]?.source).toBe("birdeye-api");
      expect(result.outcomes[1]?.source).toBe("helius-api");
    });

    it("outcomes are returned in stable source-name order regardless of completion order", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);

      let resolveHelius: (value: OnChainFlowCollectionResult) => void;
      let resolveBirdeye: (value: OnChainFlowCollectionResult) => void;

      const heliusPromise = new Promise<OnChainFlowCollectionResult>((resolve) => {
        resolveHelius = resolve;
      });
      const birdeyePromise = new Promise<OnChainFlowCollectionResult>((resolve) => {
        resolveBirdeye = resolve;
      });

      mockCollectOnChainFlow
        .mockResolvedValueOnce(heliusPromise)
        .mockResolvedValueOnce(birdeyePromise);

      const sources: ConfiguredOnChainFlowSource[] = [
        { source: "helius-api", adapter: makeOnChainFlowSource() },
        { source: "birdeye-api", adapter: makeOnChainFlowSource() }
      ];
      const deps = makeJobDeps(sources);
      const job = onChainFlowJob(deps);

      const jobPromise = job();

      await new Promise((r) => setTimeout(r, 10));

      resolveBirdeye!(ACCEPTED_RESULT);
      resolveHelius!(ACCEPTED_RESULT);

      const result = await jobPromise;

      expect(result.outcomes[0]?.source).toBe("birdeye-api");
      expect(result.outcomes[1]?.source).toBe("helius-api");
    });
  });
});
