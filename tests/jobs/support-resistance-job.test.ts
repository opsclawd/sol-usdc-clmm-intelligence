import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupportResistanceSourcePort } from "../../src/ports/support-resistance-source.js";
import type { RawObservationRepo } from "../../src/ports/observation-repo.js";
import type { NormalizedObservationRepo } from "../../src/ports/normalized-observation-repo.js";
import type { CollectionRunContext } from "../../src/application/create-collection-run-context.js";
import type { SupportResistanceCollectionResult } from "../../src/contracts/support-resistance.js";

const mockCreateCollectionRunContext = vi.fn();
vi.mock("../../src/application/create-collection-run-context.js", () => {
  return {
    createCollectionRunContext: (args: unknown) => mockCreateCollectionRunContext(args)
  };
});

const mockCollectSupportResistance = vi.fn();
vi.mock("../../src/application/collect-support-resistance.js", () => {
  return {
    collectSupportResistance: (deps: unknown, context: unknown) =>
      mockCollectSupportResistance(deps, context)
  };
});

import {
  supportResistanceJob,
  runSupportResistanceJob
} from "../../src/jobs/support-resistance-job.js";

const VALID_CONTEXT: CollectionRunContext = Object.freeze({
  runId: "run-sr-123",
  startedAtUnixMs: 1704067200000
});

function makeJobDeps() {
  return {
    supportResistanceSource: {
      collect: vi.fn()
    } as unknown as SupportResistanceSourcePort,
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

describe("supportResistanceJob", () => {
  beforeEach(() => {
    mockCreateCollectionRunContext.mockReset();
    mockCollectSupportResistance.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("creates one collection run context and delegates to the support resistance use case", () => {
    it("creates exactly one context and calls collectSupportResistance once", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectSupportResistance.mockResolvedValue({
        status: "accepted",
        hasUsableEvidence: true,
        rawId: "1",
        rawCount: 1,
        warnings: [],
        freshness: {
          isStale: false,
          validUntilUnixMs: 0,
          derivedAt: 0,
          policyKind: "support_resistance_level",
          reasons: []
        },
        confidence: {
          components: {
            sourceReliability: 1,
            dataCompleteness: 1,
            derivationConfidence: 1,
            llmConfidence: null
          },
          compositeScore: 1,
          level: "high",
          weightingVersion: "v1",
          reasons: []
        },
        diagnostic: null
      });

      const deps = makeJobDeps();
      const job = supportResistanceJob(deps);
      await job();

      expect(mockCreateCollectionRunContext).toHaveBeenCalledTimes(1);
      expect(mockCollectSupportResistance).toHaveBeenCalledTimes(1);
    });

    it("passes correct dependencies to collectSupportResistance", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectSupportResistance.mockResolvedValue({
        status: "accepted",
        hasUsableEvidence: true,
        rawId: "1",
        rawCount: 1,
        warnings: [],
        freshness: {
          isStale: false,
          validUntilUnixMs: 0,
          derivedAt: 0,
          policyKind: "support_resistance_level",
          reasons: []
        },
        confidence: {
          components: {
            sourceReliability: 1,
            dataCompleteness: 1,
            derivationConfidence: 1,
            llmConfidence: null
          },
          compositeScore: 1,
          level: "high",
          weightingVersion: "v1",
          reasons: []
        },
        diagnostic: null
      });

      const deps = makeJobDeps();
      const job = supportResistanceJob(deps);
      await job();

      expect(mockCollectSupportResistance).toHaveBeenCalledWith(
        {
          supportResistanceSource: deps.supportResistanceSource,
          rawObservationRepo: deps.rawObservationRepo,
          normalizedObservationRepo: deps.normalizedObservationRepo
        },
        VALID_CONTEXT
      );
    });
  });
});

describe("runSupportResistanceJob", () => {
  beforeEach(() => {
    mockCreateCollectionRunContext.mockReset();
    mockCollectSupportResistance.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("returns the collection result from collectSupportResistance", () => {
    it("returns accepted result", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      const expectedResult: SupportResistanceCollectionResult = {
        status: "accepted",
        hasUsableEvidence: true,
        rawId: "1",
        rawCount: 1,
        warnings: [],
        freshness: {
          isStale: false,
          validUntilUnixMs: 1704153600000,
          derivedAt: 1704067200000,
          policyKind: "support_resistance_level",
          reasons: []
        },
        confidence: {
          components: {
            sourceReliability: 1,
            dataCompleteness: 1,
            derivationConfidence: 1,
            llmConfidence: null
          },
          compositeScore: 1,
          level: "high",
          weightingVersion: "v1",
          reasons: []
        },
        diagnostic: null
      };
      mockCollectSupportResistance.mockResolvedValue(expectedResult);

      const deps = makeJobDeps();
      const result = await runSupportResistanceJob(deps);

      expect(result.status).toBe("accepted");
      expect(result.hasUsableEvidence).toBe(true);
    });

    it("returns identical_replay result", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      const expectedResult: SupportResistanceCollectionResult = {
        status: "identical_replay",
        hasUsableEvidence: true,
        rawId: "1",
        rawCount: 1,
        warnings: [],
        freshness: {
          isStale: false,
          validUntilUnixMs: 1704153600000,
          derivedAt: 1704067200000,
          policyKind: "support_resistance_level",
          reasons: []
        },
        confidence: {
          components: {
            sourceReliability: 1,
            dataCompleteness: 1,
            derivationConfidence: 1,
            llmConfidence: null
          },
          compositeScore: 1,
          level: "high",
          weightingVersion: "v1",
          reasons: []
        },
        diagnostic: null
      };
      mockCollectSupportResistance.mockResolvedValue(expectedResult);

      const deps = makeJobDeps();
      const result = await runSupportResistanceJob(deps);

      expect(result.status).toBe("identical_replay");
    });

    it("returns stale result", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      const expectedResult: SupportResistanceCollectionResult = {
        status: "stale",
        hasUsableEvidence: true,
        rawId: "1",
        rawCount: 1,
        warnings: ["stale_observation"],
        freshness: {
          isStale: true,
          validUntilUnixMs: 1704067200000,
          derivedAt: 1704067200000,
          policyKind: "support_resistance_level",
          reasons: []
        },
        confidence: {
          components: {
            sourceReliability: 1,
            dataCompleteness: 1,
            derivationConfidence: 1,
            llmConfidence: null
          },
          compositeScore: 0.5,
          level: "low",
          weightingVersion: "v1",
          reasons: []
        },
        diagnostic: null
      };
      mockCollectSupportResistance.mockResolvedValue(expectedResult);

      const deps = makeJobDeps();
      const result = await runSupportResistanceJob(deps);

      expect(result.status).toBe("stale");
      expect(result.freshness.isStale).toBe(true);
    });

    it("returns degraded result", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      const expectedResult: SupportResistanceCollectionResult = {
        status: "degraded",
        hasUsableEvidence: true,
        rawId: "1",
        rawCount: 1,
        warnings: ["duplicate_equivalent_claim"],
        freshness: {
          isStale: false,
          validUntilUnixMs: 1704153600000,
          derivedAt: 1704067200000,
          policyKind: "support_resistance_level",
          reasons: []
        },
        confidence: {
          components: {
            sourceReliability: 1,
            dataCompleteness: 1,
            derivationConfidence: 1,
            llmConfidence: null
          },
          compositeScore: 0.8,
          level: "medium",
          weightingVersion: "v1",
          reasons: []
        },
        diagnostic: null
      };
      mockCollectSupportResistance.mockResolvedValue(expectedResult);

      const deps = makeJobDeps();
      const result = await runSupportResistanceJob(deps);

      expect(result.status).toBe("degraded");
    });

    it("returns malformed result", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      const expectedResult: SupportResistanceCollectionResult = {
        status: "malformed",
        hasUsableEvidence: false,
        rawId: null,
        rawCount: 0,
        warnings: [],
        freshness: {
          isStale: false,
          validUntilUnixMs: 0,
          derivedAt: 0,
          policyKind: "support_resistance_level",
          reasons: []
        },
        confidence: {
          components: {
            sourceReliability: 0,
            dataCompleteness: 0,
            derivationConfidence: 0,
            llmConfidence: null
          },
          compositeScore: 0,
          level: "low",
          weightingVersion: "v1",
          reasons: []
        },
        diagnostic: "Invalid payload structure"
      };
      mockCollectSupportResistance.mockResolvedValue(expectedResult);

      const deps = makeJobDeps();
      const result = await runSupportResistanceJob(deps);

      expect(result.status).toBe("malformed");
    });

    it("returns timeout result", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      const expectedResult: SupportResistanceCollectionResult = {
        status: "timeout",
        hasUsableEvidence: false,
        rawId: null,
        rawCount: 0,
        warnings: [],
        freshness: {
          isStale: false,
          validUntilUnixMs: 0,
          derivedAt: 0,
          policyKind: "support_resistance_level",
          reasons: []
        },
        confidence: {
          components: {
            sourceReliability: 0,
            dataCompleteness: 0,
            derivationConfidence: 0,
            llmConfidence: null
          },
          compositeScore: 0,
          level: "low",
          weightingVersion: "v1",
          reasons: []
        },
        diagnostic: "Request timed out"
      };
      mockCollectSupportResistance.mockResolvedValue(expectedResult);

      const deps = makeJobDeps();
      const result = await runSupportResistanceJob(deps);

      expect(result.status).toBe("timeout");
    });

    it("returns network result", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      const expectedResult: SupportResistanceCollectionResult = {
        status: "network",
        hasUsableEvidence: false,
        rawId: null,
        rawCount: 0,
        warnings: [],
        freshness: {
          isStale: false,
          validUntilUnixMs: 0,
          derivedAt: 0,
          policyKind: "support_resistance_level",
          reasons: []
        },
        confidence: {
          components: {
            sourceReliability: 0,
            dataCompleteness: 0,
            derivationConfidence: 0,
            llmConfidence: null
          },
          compositeScore: 0,
          level: "low",
          weightingVersion: "v1",
          reasons: []
        },
        diagnostic: "Network error"
      };
      mockCollectSupportResistance.mockResolvedValue(expectedResult);

      const deps = makeJobDeps();
      const result = await runSupportResistanceJob(deps);

      expect(result.status).toBe("network");
    });

    it("returns unavailable result", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      const expectedResult: SupportResistanceCollectionResult = {
        status: "unavailable",
        hasUsableEvidence: false,
        rawId: null,
        rawCount: 0,
        warnings: [],
        freshness: {
          isStale: false,
          validUntilUnixMs: 0,
          derivedAt: 0,
          policyKind: "support_resistance_level",
          reasons: []
        },
        confidence: {
          components: {
            sourceReliability: 0,
            dataCompleteness: 0,
            derivationConfidence: 0,
            llmConfidence: null
          },
          compositeScore: 0,
          level: "low",
          weightingVersion: "v1",
          reasons: []
        },
        diagnostic: "Service unavailable"
      };
      mockCollectSupportResistance.mockResolvedValue(expectedResult);

      const deps = makeJobDeps();
      const result = await runSupportResistanceJob(deps);

      expect(result.status).toBe("unavailable");
    });

    it("returns failed result", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      const expectedResult: SupportResistanceCollectionResult = {
        status: "failed",
        hasUsableEvidence: false,
        rawId: "1",
        rawCount: 1,
        warnings: [],
        freshness: {
          isStale: false,
          validUntilUnixMs: 0,
          derivedAt: 0,
          policyKind: "support_resistance_level",
          reasons: []
        },
        confidence: {
          components: {
            sourceReliability: 0,
            dataCompleteness: 0,
            derivationConfidence: 0,
            llmConfidence: null
          },
          compositeScore: 0,
          level: "low",
          weightingVersion: "v1",
          reasons: []
        },
        diagnostic: "Normalization failed"
      };
      mockCollectSupportResistance.mockResolvedValue(expectedResult);

      const deps = makeJobDeps();
      const result = await runSupportResistanceJob(deps);

      expect(result.status).toBe("failed");
    });

    it("throws on conflict error", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectSupportResistance.mockRejectedValue(new Error("RawObservationConflictError"));

      const deps = makeJobDeps();
      await expect(runSupportResistanceJob(deps)).rejects.toThrow("RawObservationConflictError");
    });

    it("returns degraded result with missing level when raw evidence is retained but no level is usable", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      const expectedResult: SupportResistanceCollectionResult = {
        status: "degraded",
        hasUsableEvidence: true,
        rawId: "1",
        rawCount: 1,
        warnings: ["missing_level"],
        freshness: {
          isStale: false,
          validUntilUnixMs: 0,
          derivedAt: 1704067200000,
          policyKind: "support_resistance_level",
          reasons: []
        },
        confidence: {
          components: {
            sourceReliability: 1,
            dataCompleteness: 0,
            derivationConfidence: 0,
            llmConfidence: null
          },
          compositeScore: 0,
          level: "low",
          weightingVersion: "v1",
          reasons: []
        },
        diagnostic: null
      };
      mockCollectSupportResistance.mockResolvedValue(expectedResult);

      const deps = makeJobDeps();
      const result = await runSupportResistanceJob(deps);

      expect(result.status).toBe("degraded");
      expect(result.warnings).toContain("missing_level");
    });
  });
});
