import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CollectionRunContext } from "../../src/application/create-collection-run-context.js";
import type { NormalizedObservationRepo } from "../../src/ports/normalized-observation-repo.js";
import type { RawObservationRepo } from "../../src/ports/observation-repo.js";
import type { NewsSourcePort } from "../../src/ports/news-source.js";
import type { NewsEvidenceCollectionResult } from "../../src/application/collect-news-evidence.js";

const mockCreateCollectionRunContext = vi.fn();
vi.mock("../../src/application/create-collection-run-context.js", () => {
  return {
    createCollectionRunContext: (args: unknown) => mockCreateCollectionRunContext(args)
  };
});

const mockCollectNewsEvidence = vi.fn();
vi.mock("../../src/application/collect-news-evidence.js", () => {
  return {
    collectNewsEvidence: (deps: unknown, context: unknown, source: unknown) =>
      mockCollectNewsEvidence(deps, context, source)
  };
});

import {
  newsEvidenceJob,
  runNewsEvidenceJob,
  type ConfiguredNewsSource
} from "../../src/jobs/news-evidence-job.js";

const VALID_CONTEXT: CollectionRunContext = Object.freeze({
  runId: "run-context-123",
  startedAtUnixMs: 1704067200000
});

function makeNewsSource(): NewsSourcePort {
  return {
    collect: vi.fn()
  } as unknown as NewsSourcePort;
}

function makeJobDeps(sources: readonly ConfiguredNewsSource[]) {
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
    }
  };
}

const ACCEPTED_RESULT: NewsEvidenceCollectionResult = {
  source: "crypto-news-api",
  status: "accepted",
  rawObservationIds: [1],
  normalizedCount: 1,
  failedArticleIds: [],
  warnings: [],
  diagnostic: null
};

const DEGRADED_RESULT: NewsEvidenceCollectionResult = {
  source: "crypto-news-api",
  status: "degraded",
  rawObservationIds: [2],
  normalizedCount: 0,
  failedArticleIds: [],
  warnings: ["stale_observation"],
  diagnostic: null
};

const IDENTICAL_REPLAY_RESULT: NewsEvidenceCollectionResult = {
  source: "crypto-news-api",
  status: "identical_replay",
  rawObservationIds: [],
  normalizedCount: 0,
  failedArticleIds: [],
  warnings: [],
  diagnostic: null
};

const PARTIAL_RESULT: NewsEvidenceCollectionResult = {
  source: "crypto-news-api",
  status: "partial",
  rawObservationIds: [3],
  normalizedCount: 1,
  failedArticleIds: ["article-1"],
  warnings: [],
  diagnostic: null
};

const TIMEOUT_RESULT: NewsEvidenceCollectionResult = {
  source: "crypto-news-api",
  status: "timeout",
  rawObservationIds: [],
  normalizedCount: 0,
  failedArticleIds: [],
  warnings: [],
  diagnostic: "Request timed out"
};

const NETWORK_RESULT: NewsEvidenceCollectionResult = {
  source: "crypto-news-api",
  status: "network",
  rawObservationIds: [],
  normalizedCount: 0,
  failedArticleIds: [],
  warnings: [],
  diagnostic: "Network error"
};

const UNAVAILABLE_RESULT: NewsEvidenceCollectionResult = {
  source: "crypto-news-api",
  status: "unavailable",
  rawObservationIds: [],
  normalizedCount: 0,
  failedArticleIds: [],
  warnings: [],
  diagnostic: "Service unavailable"
};

const MALFORMED_RESULT: NewsEvidenceCollectionResult = {
  source: "crypto-news-api",
  status: "malformed",
  rawObservationIds: [],
  normalizedCount: 0,
  failedArticleIds: [],
  warnings: [],
  diagnostic: "Malformed response"
};

const CONFLICT_RESULT: NewsEvidenceCollectionResult = {
  source: "crypto-news-api",
  status: "conflict",
  rawObservationIds: [],
  normalizedCount: 0,
  failedArticleIds: [],
  warnings: [],
  diagnostic: "Data conflict"
};

const FAILED_RESULT: NewsEvidenceCollectionResult = {
  source: "crypto-news-api",
  status: "failed",
  rawObservationIds: [],
  normalizedCount: 0,
  failedArticleIds: [],
  warnings: [],
  diagnostic: "Collection failed"
};

describe("newsEvidenceJob", () => {
  beforeEach(() => {
    mockCreateCollectionRunContext.mockReset();
    mockCollectNewsEvidence.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("runs configured sources once with a shared collection context", () => {
    it("creates exactly one collection run context regardless of source count", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectNewsEvidence.mockResolvedValue(ACCEPTED_RESULT);

      const sources: ConfiguredNewsSource[] = [
        { source: "crypto-news-api", adapter: makeNewsSource() },
        { source: "regulatory-monitor-api", adapter: makeNewsSource() }
      ];
      const deps = makeJobDeps(sources);
      const job = newsEvidenceJob(deps);
      await job();

      expect(mockCreateCollectionRunContext).toHaveBeenCalledTimes(1);
    });

    it("calls each configured source exactly once", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectNewsEvidence.mockResolvedValue(ACCEPTED_RESULT);

      const sources: ConfiguredNewsSource[] = [
        { source: "crypto-news-api", adapter: makeNewsSource() },
        { source: "regulatory-monitor-api", adapter: makeNewsSource() }
      ];
      const deps = makeJobDeps(sources);
      const job = newsEvidenceJob(deps);
      await job();

      expect(mockCollectNewsEvidence).toHaveBeenCalledTimes(2);
    });

    it("passes the same context to all source collections", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectNewsEvidence.mockResolvedValue(ACCEPTED_RESULT);

      const sources: ConfiguredNewsSource[] = [
        { source: "crypto-news-api", adapter: makeNewsSource() },
        { source: "regulatory-monitor-api", adapter: makeNewsSource() }
      ];
      const deps = makeJobDeps(sources);
      const job = newsEvidenceJob(deps);
      await job();

      const allCalls = mockCollectNewsEvidence.mock.calls;
      expect(allCalls.every((call) => call[1] === VALID_CONTEXT)).toBe(true);
    });

    it("executes all configured sources concurrently", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);

      let resolveFirst: (value: NewsEvidenceCollectionResult) => void;
      let resolveSecond: (value: NewsEvidenceCollectionResult) => void;

      const firstPromise = new Promise<NewsEvidenceCollectionResult>((resolve) => {
        resolveFirst = resolve;
      });
      const secondPromise = new Promise<NewsEvidenceCollectionResult>((resolve) => {
        resolveSecond = resolve;
      });

      mockCollectNewsEvidence
        .mockResolvedValueOnce(firstPromise)
        .mockResolvedValueOnce(secondPromise);

      const sources: ConfiguredNewsSource[] = [
        { source: "crypto-news-api", adapter: makeNewsSource() },
        { source: "regulatory-monitor-api", adapter: makeNewsSource() }
      ];
      const deps = makeJobDeps(sources);
      const job = newsEvidenceJob(deps);

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
      mockCollectNewsEvidence
        .mockResolvedValueOnce({ ...ACCEPTED_RESULT, source: "crypto-news-api" })
        .mockResolvedValueOnce({ ...DEGRADED_RESULT, source: "regulatory-monitor-api" });

      const sources: ConfiguredNewsSource[] = [
        { source: "crypto-news-api", adapter: makeNewsSource() },
        { source: "regulatory-monitor-api", adapter: makeNewsSource() }
      ];
      const deps = makeJobDeps(sources);
      const result = await runNewsEvidenceJob(deps);

      const sourceKeys = result.outcomes.map((o) => o.source);
      expect(sourceKeys).toEqual(["crypto-news-api", "regulatory-monitor-api"]);
    });

    it("catches thrown source calls and converts to failed outcomes with redacted diagnostics", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectNewsEvidence.mockImplementation((_, __, source) => {
        if (source === "crypto-news-api") {
          return Promise.reject(new Error("API key invalid secret123"));
        }
        return Promise.resolve(ACCEPTED_RESULT);
      });

      const sources: ConfiguredNewsSource[] = [
        { source: "crypto-news-api", adapter: makeNewsSource() },
        { source: "regulatory-monitor-api", adapter: makeNewsSource() }
      ];
      const deps = makeJobDeps(sources);
      const result = await runNewsEvidenceJob(deps);

      const failedOutcome = result.outcomes.find((o) => o.source === "crypto-news-api");
      expect(failedOutcome).toMatchObject({
        status: "failed",
        hasUsableEvidence: false
      });
      expect(failedOutcome?.diagnostic).not.toContain("secret123");
      expect(failedOutcome?.diagnostic).toContain("[REDACTED]");
    });
  });

  describe("reduces source outcomes with the news evidence truth table", () => {
    it("returns COMPLETE when all configured sources are usable (all accepted)", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectNewsEvidence
        .mockResolvedValueOnce({ ...ACCEPTED_RESULT, source: "crypto-news-api" })
        .mockResolvedValueOnce({ ...ACCEPTED_RESULT, source: "regulatory-monitor-api" });

      const sources: ConfiguredNewsSource[] = [
        { source: "crypto-news-api", adapter: makeNewsSource() },
        { source: "regulatory-monitor-api", adapter: makeNewsSource() }
      ];
      const deps = makeJobDeps(sources);
      const result = await runNewsEvidenceJob(deps);

      expect(result.status).toBe("COMPLETE");
      expect(result.shouldFailCommand).toBe(false);
    });

    it("returns COMPLETE when all configured sources are usable (mixed accepted/degraded)", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectNewsEvidence
        .mockResolvedValueOnce({ ...ACCEPTED_RESULT, source: "crypto-news-api" })
        .mockResolvedValueOnce({ ...DEGRADED_RESULT, source: "regulatory-monitor-api" });

      const sources: ConfiguredNewsSource[] = [
        { source: "crypto-news-api", adapter: makeNewsSource() },
        { source: "regulatory-monitor-api", adapter: makeNewsSource() }
      ];
      const deps = makeJobDeps(sources);
      const result = await runNewsEvidenceJob(deps);

      expect(result.status).toBe("COMPLETE");
      expect(result.shouldFailCommand).toBe(false);
    });

    it("returns COMPLETE when all configured sources are usable (identical_replay)", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectNewsEvidence
        .mockResolvedValueOnce({ ...IDENTICAL_REPLAY_RESULT, source: "crypto-news-api" })
        .mockResolvedValueOnce({ ...ACCEPTED_RESULT, source: "regulatory-monitor-api" });

      const sources: ConfiguredNewsSource[] = [
        { source: "crypto-news-api", adapter: makeNewsSource() },
        { source: "regulatory-monitor-api", adapter: makeNewsSource() }
      ];
      const deps = makeJobDeps(sources);
      const result = await runNewsEvidenceJob(deps);

      expect(result.status).toBe("COMPLETE");
      expect(result.shouldFailCommand).toBe(false);
    });

    it("returns PARTIAL when at least one source is usable and at least one is non-usable", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectNewsEvidence
        .mockResolvedValueOnce({ ...ACCEPTED_RESULT, source: "crypto-news-api" })
        .mockResolvedValueOnce({ ...TIMEOUT_RESULT, source: "regulatory-monitor-api" });

      const sources: ConfiguredNewsSource[] = [
        { source: "crypto-news-api", adapter: makeNewsSource() },
        { source: "regulatory-monitor-api", adapter: makeNewsSource() }
      ];
      const deps = makeJobDeps(sources);
      const result = await runNewsEvidenceJob(deps);

      expect(result.status).toBe("PARTIAL");
      expect(result.shouldFailCommand).toBe(false);
    });

    it("returns PARTIAL when one usable and one unavailable", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectNewsEvidence
        .mockResolvedValueOnce({ ...ACCEPTED_RESULT, source: "crypto-news-api" })
        .mockResolvedValueOnce({ ...UNAVAILABLE_RESULT, source: "regulatory-monitor-api" });

      const sources: ConfiguredNewsSource[] = [
        { source: "crypto-news-api", adapter: makeNewsSource() },
        { source: "regulatory-monitor-api", adapter: makeNewsSource() }
      ];
      const deps = makeJobDeps(sources);
      const result = await runNewsEvidenceJob(deps);

      expect(result.status).toBe("PARTIAL");
      expect(result.shouldFailCommand).toBe(false);
    });

    it("returns UNAVAILABLE when all sources are timeout", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectNewsEvidence
        .mockResolvedValueOnce({ ...TIMEOUT_RESULT, source: "crypto-news-api" })
        .mockResolvedValueOnce({ ...TIMEOUT_RESULT, source: "regulatory-monitor-api" });

      const sources: ConfiguredNewsSource[] = [
        { source: "crypto-news-api", adapter: makeNewsSource() },
        { source: "regulatory-monitor-api", adapter: makeNewsSource() }
      ];
      const deps = makeJobDeps(sources);
      const result = await runNewsEvidenceJob(deps);

      expect(result.status).toBe("UNAVAILABLE");
      expect(result.shouldFailCommand).toBe(true);
    });

    it("returns UNAVAILABLE when all sources are network errors", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectNewsEvidence
        .mockResolvedValueOnce({ ...NETWORK_RESULT, source: "crypto-news-api" })
        .mockResolvedValueOnce({ ...NETWORK_RESULT, source: "regulatory-monitor-api" });

      const sources: ConfiguredNewsSource[] = [
        { source: "crypto-news-api", adapter: makeNewsSource() },
        { source: "regulatory-monitor-api", adapter: makeNewsSource() }
      ];
      const deps = makeJobDeps(sources);
      const result = await runNewsEvidenceJob(deps);

      expect(result.status).toBe("UNAVAILABLE");
      expect(result.shouldFailCommand).toBe(true);
    });

    it("returns UNAVAILABLE when all sources are unavailable", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectNewsEvidence
        .mockResolvedValueOnce({ ...UNAVAILABLE_RESULT, source: "crypto-news-api" })
        .mockResolvedValueOnce({ ...UNAVAILABLE_RESULT, source: "regulatory-monitor-api" });

      const sources: ConfiguredNewsSource[] = [
        { source: "crypto-news-api", adapter: makeNewsSource() },
        { source: "regulatory-monitor-api", adapter: makeNewsSource() }
      ];
      const deps = makeJobDeps(sources);
      const result = await runNewsEvidenceJob(deps);

      expect(result.status).toBe("UNAVAILABLE");
      expect(result.shouldFailCommand).toBe(true);
    });

    it("returns FAILED when zero usable with all malformed", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectNewsEvidence
        .mockResolvedValueOnce({ ...MALFORMED_RESULT, source: "crypto-news-api" })
        .mockResolvedValueOnce({ ...MALFORMED_RESULT, source: "regulatory-monitor-api" });

      const sources: ConfiguredNewsSource[] = [
        { source: "crypto-news-api", adapter: makeNewsSource() },
        { source: "regulatory-monitor-api", adapter: makeNewsSource() }
      ];
      const deps = makeJobDeps(sources);
      const result = await runNewsEvidenceJob(deps);

      expect(result.status).toBe("FAILED");
      expect(result.shouldFailCommand).toBe(true);
    });

    it("returns FAILED when zero usable with all conflict", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectNewsEvidence
        .mockResolvedValueOnce({ ...CONFLICT_RESULT, source: "crypto-news-api" })
        .mockResolvedValueOnce({ ...CONFLICT_RESULT, source: "regulatory-monitor-api" });

      const sources: ConfiguredNewsSource[] = [
        { source: "crypto-news-api", adapter: makeNewsSource() },
        { source: "regulatory-monitor-api", adapter: makeNewsSource() }
      ];
      const deps = makeJobDeps(sources);
      const result = await runNewsEvidenceJob(deps);

      expect(result.status).toBe("FAILED");
      expect(result.shouldFailCommand).toBe(true);
    });

    it("returns FAILED when zero usable with all failed", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectNewsEvidence
        .mockResolvedValueOnce({ ...FAILED_RESULT, source: "crypto-news-api" })
        .mockResolvedValueOnce({ ...FAILED_RESULT, source: "regulatory-monitor-api" });

      const sources: ConfiguredNewsSource[] = [
        { source: "crypto-news-api", adapter: makeNewsSource() },
        { source: "regulatory-monitor-api", adapter: makeNewsSource() }
      ];
      const deps = makeJobDeps(sources);
      const result = await runNewsEvidenceJob(deps);

      expect(result.status).toBe("FAILED");
      expect(result.shouldFailCommand).toBe(true);
    });

    it("returns FAILED when zero usable with mixed malformed/conflict/failed", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectNewsEvidence
        .mockResolvedValueOnce({ ...MALFORMED_RESULT, source: "crypto-news-api" })
        .mockResolvedValueOnce({ ...FAILED_RESULT, source: "regulatory-monitor-api" });

      const sources: ConfiguredNewsSource[] = [
        { source: "crypto-news-api", adapter: makeNewsSource() },
        { source: "regulatory-monitor-api", adapter: makeNewsSource() }
      ];
      const deps = makeJobDeps(sources);
      const result = await runNewsEvidenceJob(deps);

      expect(result.status).toBe("FAILED");
      expect(result.shouldFailCommand).toBe(true);
    });

    it("treats partial status as usable", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectNewsEvidence
        .mockResolvedValueOnce({ ...PARTIAL_RESULT, source: "crypto-news-api" })
        .mockResolvedValueOnce({ ...TIMEOUT_RESULT, source: "regulatory-monitor-api" });

      const sources: ConfiguredNewsSource[] = [
        { source: "crypto-news-api", adapter: makeNewsSource() },
        { source: "regulatory-monitor-api", adapter: makeNewsSource() }
      ];
      const deps = makeJobDeps(sources);
      const result = await runNewsEvidenceJob(deps);

      expect(result.status).toBe("PARTIAL");
      expect(result.shouldFailCommand).toBe(false);
    });

    it("does not convert absence into evidence (empty results treated as no usable evidence)", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectNewsEvidence
        .mockResolvedValueOnce({
          source: "crypto-news-api",
          status: "accepted",
          rawObservationIds: [],
          normalizedCount: 0,
          failedArticleIds: [],
          warnings: [],
          diagnostic: null
        })
        .mockResolvedValueOnce({
          source: "regulatory-monitor-api",
          status: "accepted",
          rawObservationIds: [],
          normalizedCount: 0,
          failedArticleIds: [],
          warnings: [],
          diagnostic: null
        });

      const sources: ConfiguredNewsSource[] = [
        { source: "crypto-news-api", adapter: makeNewsSource() },
        { source: "regulatory-monitor-api", adapter: makeNewsSource() }
      ];
      const deps = makeJobDeps(sources);
      const result = await runNewsEvidenceJob(deps);

      expect(result.status).toBe("COMPLETE");
      expect(result.shouldFailCommand).toBe(false);
    });
  });

  describe("rejects invalid configurations", () => {
    it("throws on empty source list", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);

      const sources: ConfiguredNewsSource[] = [];
      const deps = makeJobDeps(sources);

      await expect(runNewsEvidenceJob(deps)).rejects.toThrow(
        "At least one news source must be configured"
      );
    });

    it("throws on duplicate source names", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);

      const sources: ConfiguredNewsSource[] = [
        { source: "crypto-news-api", adapter: makeNewsSource() },
        { source: "crypto-news-api", adapter: makeNewsSource() }
      ];
      const deps = makeJobDeps(sources);

      await expect(runNewsEvidenceJob(deps)).rejects.toThrow("Duplicate news source");
    });
  });
});
