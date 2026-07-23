import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupportResistanceCollectionResult } from "../../src/contracts/support-resistance.js";
import type { NodeRuntime, Persistence } from "../../src/adapters/node/composition-root.js";

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

const mockRunSupportResistanceJob = vi.fn();
vi.mock("../../src/jobs/support-resistance-job.js", () => {
  return {
    runSupportResistanceJob: (deps: unknown) => mockRunSupportResistanceJob(deps)
  };
});

const mockClose = vi.fn();

vi.mock("../../src/adapters/node/composition-root.js", () => {
  return {
    createNodeRuntime: vi.fn(
      (): NodeRuntime => ({
        http: {
          getJson: vi.fn(),
          postJsonRaw: vi.fn()
        },
        jsonStore: {
          readJson: vi.fn(),
          writeJson: vi.fn()
        },
        textReader: {
          readText: vi.fn()
        },
        env: {
          get: vi.fn((name: string) => {
            if (name === "DATABASE_URL") return "postgresql://localhost";
            return "";
          }),
          getOptional: vi.fn((name: string) => {
            if (name === "SUPPORT_RESISTANCE_API_URL") return "https://api.example.com/sr";
            if (name === "SUPPORT_RESISTANCE_API_KEY") return "secret-api-key-123";
            if (name === "INTELLIGENCE_PIPELINE_RUN_ID") return undefined;
            return undefined;
          })
        },
        clock: {
          now: vi.fn(() => "2024-01-01T00:00:00.000Z")
        },
        commandRunner: {
          run: vi.fn()
        },
        runIdFactory: {
          nextRunId: vi.fn(() => "test-run-id")
        },
        retryControl: {
          sleep: vi.fn(),
          jitterUnit: vi.fn(() => 0.1)
        },
        getDb: vi.fn(),
        getPersistence: vi.fn(
          async (): Promise<Persistence> => ({
            connection: { close: mockClose },
            rawObservationRepo: {
              insertOrClassify: vi.fn(),
              findById: vi.fn(),
              findByIds: vi.fn(),
              findByIdentity: vi.fn(),
              findByHash: vi.fn(),
              findBySource: vi.fn(),
              updateParseStatus: vi.fn()
            },
            normalizedObservationRepo: {
              insert: vi.fn(),
              insertMany: vi.fn(),
              findBySource: vi.fn(),
              findFreshByKind: vi.fn(),
              findLatestByKind: vi.fn(),
              findByRawObservation: vi.fn(),
              listCandidates: vi.fn(),
              findByIds: vi.fn()
            },
            featureRepo: {
              insert: vi.fn(),
              findById: vi.fn(),
              findByIds: vi.fn()
            },
            bundleRepo: {
              insert: vi.fn(),
              findById: vi.fn()
            },
            briefRepo: {
              insert: vi.fn()
            },
            publishAttemptRepo: {
              insert: vi.fn()
            }
          })
        ),
        getContract: vi.fn()
      })
    )
  };
});

import { runSupportResistanceCollect } from "../../scripts/collectors/support-resistance.js";

const ACCEPTED_RESULT: SupportResistanceCollectionResult = {
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

const IDENTICAL_REPLAY_RESULT: SupportResistanceCollectionResult = {
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

const STALE_RESULT: SupportResistanceCollectionResult = {
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

const DEGRADED_RESULT: SupportResistanceCollectionResult = {
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

const DEGRADED_MISSING_LEVEL_RESULT: SupportResistanceCollectionResult = {
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

const MALFORMED_RESULT: SupportResistanceCollectionResult = {
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
  diagnostic: "Error with SUPPORT_RESISTANCE_API_KEY=secret-api-key-123 and Bearer token"
};

const TIMEOUT_RESULT: SupportResistanceCollectionResult = {
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

const NETWORK_RESULT: SupportResistanceCollectionResult = {
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

const UNAVAILABLE_RESULT: SupportResistanceCollectionResult = {
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

const FAILED_RESULT: SupportResistanceCollectionResult = {
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

describe("support-resistance collector script", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
    mockCreateCollectionRunContext.mockReset();
    mockCollectSupportResistance.mockReset();
    mockRunSupportResistanceJob.mockReset();
    mockClose.mockReset();
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    vi.clearAllMocks();
  });

  describe("creates one collection run context and delegates to the support resistance use case", () => {
    it("creates one context and delegates once", async () => {
      mockRunSupportResistanceJob.mockResolvedValue(ACCEPTED_RESULT);

      await runSupportResistanceCollect();

      expect(mockRunSupportResistanceJob).toHaveBeenCalledTimes(1);
    });

    it("passes runtime HTTP and persistence to the job", async () => {
      mockRunSupportResistanceJob.mockResolvedValue(ACCEPTED_RESULT);

      await runSupportResistanceCollect();

      expect(mockRunSupportResistanceJob).toHaveBeenCalledTimes(1);
      const callArgs = mockRunSupportResistanceJob.mock.calls[0]![0];
      expect(callArgs).toHaveProperty("supportResistanceSource");
      expect(callArgs).toHaveProperty("rawObservationRepo");
      expect(callArgs).toHaveProperty("normalizedObservationRepo");
    });
  });

  describe("prints a structured accepted result and exits zero when usable contextual evidence exists", () => {
    it("exits zero for accepted status", async () => {
      mockRunSupportResistanceJob.mockResolvedValue(ACCEPTED_RESULT);

      await runSupportResistanceCollect();

      expect(logSpy).toHaveBeenCalled();
      const printed = JSON.parse(logSpy.mock.calls[0]![0] as string);
      expect(printed.status).toBe("accepted");
      expect(process.exitCode).toBe(0);
    });

    it("exits zero for identical_replay status", async () => {
      mockRunSupportResistanceJob.mockResolvedValue(IDENTICAL_REPLAY_RESULT);

      await runSupportResistanceCollect();

      expect(logSpy).toHaveBeenCalled();
      const printed = JSON.parse(logSpy.mock.calls[0]![0] as string);
      expect(printed.status).toBe("identical_replay");
      expect(process.exitCode).toBe(0);
    });

    it("exits zero for stale status", async () => {
      mockRunSupportResistanceJob.mockResolvedValue(STALE_RESULT);

      await runSupportResistanceCollect();

      expect(logSpy).toHaveBeenCalled();
      const printed = JSON.parse(logSpy.mock.calls[0]![0] as string);
      expect(printed.status).toBe("stale");
      expect(process.exitCode).toBe(0);
    });

    it("exits zero for degraded status", async () => {
      mockRunSupportResistanceJob.mockResolvedValue(DEGRADED_RESULT);

      await runSupportResistanceCollect();

      expect(logSpy).toHaveBeenCalled();
      const printed = JSON.parse(logSpy.mock.calls[0]![0] as string);
      expect(printed.status).toBe("degraded");
      expect(process.exitCode).toBe(0);
    });
  });

  describe("prints a structured degraded result and exits zero when raw evidence is retained but no level is usable", () => {
    it("exits zero when raw evidence exists but normalized count is zero", async () => {
      mockRunSupportResistanceJob.mockResolvedValue(DEGRADED_MISSING_LEVEL_RESULT);

      await runSupportResistanceCollect();

      expect(logSpy).toHaveBeenCalled();
      const printed = JSON.parse(logSpy.mock.calls[0]![0] as string);
      expect(printed.status).toBe("degraded");
      expect(process.exitCode).toBe(0);
    });
  });

  describe("exits nonzero for conflict malformed timeout network unavailable and failed outcomes without printing secrets", () => {
    it("exits 1 for conflict status", async () => {
      mockRunSupportResistanceJob.mockRejectedValue(new Error("RawObservationConflictError"));

      await runSupportResistanceCollect();

      expect(process.exitCode).toBe(1);
    });

    it("exits 1 for malformed status", async () => {
      mockRunSupportResistanceJob.mockResolvedValue(MALFORMED_RESULT);

      await runSupportResistanceCollect();

      expect(process.exitCode).toBe(1);
    });

    it("exits 1 for timeout status", async () => {
      mockRunSupportResistanceJob.mockResolvedValue(TIMEOUT_RESULT);

      await runSupportResistanceCollect();

      expect(process.exitCode).toBe(1);
    });

    it("exits 1 for network status", async () => {
      mockRunSupportResistanceJob.mockResolvedValue(NETWORK_RESULT);

      await runSupportResistanceCollect();

      expect(process.exitCode).toBe(1);
    });

    it("exits 1 for unavailable status", async () => {
      mockRunSupportResistanceJob.mockResolvedValue(UNAVAILABLE_RESULT);

      await runSupportResistanceCollect();

      expect(process.exitCode).toBe(1);
    });

    it("exits 1 for failed status", async () => {
      mockRunSupportResistanceJob.mockResolvedValue(FAILED_RESULT);

      await runSupportResistanceCollect();

      expect(process.exitCode).toBe(1);
    });

    it("redacts secret keys in diagnostic output", async () => {
      mockRunSupportResistanceJob.mockResolvedValue(MALFORMED_RESULT);

      await runSupportResistanceCollect();

      expect(logSpy).toHaveBeenCalled();
      const printed = logSpy.mock.calls[0]![0] as string;
      expect(printed).not.toContain("SUPPORT_RESISTANCE_API_KEY");
      expect(printed).not.toContain("secret123");
      expect(printed).not.toContain("Bearer");
    });
  });

  describe("reads SUPPORT_RESISTANCE_API_URL and optional SUPPORT_RESISTANCE_API_KEY from env", () => {
    it("reads API URL from env", async () => {
      mockRunSupportResistanceJob.mockResolvedValue(ACCEPTED_RESULT);

      await runSupportResistanceCollect();

      expect(mockRunSupportResistanceJob).toHaveBeenCalledTimes(1);
    });
  });

  describe("closes the database once after the job completes", () => {
    it("calls close on the database connection once", async () => {
      mockRunSupportResistanceJob.mockResolvedValue(ACCEPTED_RESULT);

      await runSupportResistanceCollect();

      expect(mockClose).toHaveBeenCalledTimes(1);
    });
  });
});
