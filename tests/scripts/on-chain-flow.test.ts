import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockRunOnChainFlowJob = vi.fn();

vi.mock("../../src/jobs/on-chain-flow-job.js", () => {
  return {
    runOnChainFlowJob: (...args: unknown[]) => mockRunOnChainFlowJob(...args)
  };
});

const mockCreateNodeRuntime = vi.fn();
vi.mock("../../src/adapters/node/composition-root.js", () => {
  return {
    createNodeRuntime: () => mockCreateNodeRuntime()
  };
});

vi.mock("../../src/adapters/node/http-helius-flow-source.js", () => {
  return {
    HttpHeliusFlowSource: vi.fn().mockImplementation(() => ({}))
  };
});

vi.mock("../../src/adapters/node/http-birdeye-flow-source.js", () => {
  return {
    HttpBirdeyeFlowSource: vi.fn().mockImplementation(() => ({}))
  };
});

const mockClose = vi.fn();
const mockGetPersistence = vi.fn();

function createMockRuntime() {
  return {
    http: { getJson: vi.fn(), postJsonRaw: vi.fn() },
    jsonStore: { readJson: vi.fn(), writeJson: vi.fn() },
    textReader: { readText: vi.fn() },
    env: {
      get: vi.fn((name: string) => {
        if (name === "HELIUS_FLOW_API_URL") return "https://api.helius.xyz/v0/transactions";
        if (name === "BIRDEYE_FLOW_API_URL") return "https://api.birdeye.xyz/v1/defi/portfolio";
        if (name === "HELIUS_API_KEY") return "helius-secret-key-123";
        if (name === "BIRDEYE_API_KEY") return "birdeye-secret-key-456";
        throw new Error(`Unexpected env var: ${name}`);
      }),
      getOptional: vi.fn((name: string) => {
        switch (name) {
          case "ON_CHAIN_WHALE_TRANSFER_MIN_USDC":
            return "1000000";
          case "ON_CHAIN_WHALE_SWAP_MIN_USDC":
            return "1000000";
          case "ON_CHAIN_STABLECOIN_FLOW_MIN_USDC":
            return "1000000";
          case "ON_CHAIN_DEX_NET_FLOW_MIN_USDC":
            return "5000000";
          case "ON_CHAIN_CEX_PROXY_MIN_USDC":
            return "1000000";
          case "ON_CHAIN_CEX_MIN_ATTRIBUTION_CONFIDENCE":
            return "0.8";
          case "ON_CHAIN_FLOW_LOOKBACK_MS":
            return "900000";
          default:
            return undefined;
        }
      })
    },
    clock: { now: vi.fn(() => new Date("2024-01-01T00:00:00.000Z")) },
    commandRunner: { run: vi.fn() },
    runIdFactory: { nextRunId: vi.fn(() => "test-run-id") },
    retryControl: { sleep: vi.fn(), jitterUnit: vi.fn(() => 0.1) },
    getPersistence: mockGetPersistence,
    getContract: vi.fn()
  };
}

const COMPLETE_RESULT = {
  context: { runId: "test-run-id", startedAtUnixMs: 1704067200000 },
  outcomes: [
    {
      source: "helius-api",
      status: "accepted",
      hasUsableEvidence: true,
      accepted: 5,
      filtered: 2,
      replayed: 0,
      failed: 0,
      conflict: 0,
      sourceObservationId: 1,
      sourceObservationKey: "key1",
      diagnostic: null
    },
    {
      source: "birdeye-api",
      status: "accepted",
      hasUsableEvidence: true,
      accepted: 3,
      filtered: 1,
      replayed: 0,
      failed: 0,
      conflict: 0,
      sourceObservationId: 2,
      sourceObservationKey: "key2",
      diagnostic: null
    }
  ],
  status: "COMPLETE",
  shouldFailCommand: false
};

const PARTIAL_RESULT = {
  context: { runId: "test-run-id", startedAtUnixMs: 1704067200000 },
  outcomes: [
    {
      source: "helius-api",
      status: "accepted",
      hasUsableEvidence: true,
      accepted: 5,
      filtered: 2,
      replayed: 0,
      failed: 0,
      conflict: 0,
      sourceObservationId: 1,
      sourceObservationKey: "key1",
      diagnostic: null
    },
    {
      source: "birdeye-api",
      status: "unavailable",
      hasUsableEvidence: false,
      accepted: 0,
      filtered: 0,
      replayed: 0,
      failed: 0,
      conflict: 0,
      sourceObservationId: null,
      sourceObservationKey: null,
      diagnostic: "Service unavailable"
    }
  ],
  status: "PARTIAL",
  shouldFailCommand: false
};

const UNAVAILABLE_RESULT = {
  context: { runId: "test-run-id", startedAtUnixMs: 1704067200000 },
  outcomes: [
    {
      source: "helius-api",
      status: "unavailable",
      hasUsableEvidence: false,
      accepted: 0,
      filtered: 0,
      replayed: 0,
      failed: 0,
      conflict: 0,
      sourceObservationId: null,
      sourceObservationKey: null,
      diagnostic: "Service unavailable"
    },
    {
      source: "birdeye-api",
      status: "unavailable",
      hasUsableEvidence: false,
      accepted: 0,
      filtered: 0,
      replayed: 0,
      failed: 0,
      conflict: 0,
      sourceObservationId: null,
      sourceObservationKey: null,
      diagnostic: "Service unavailable"
    }
  ],
  status: "UNAVAILABLE",
  shouldFailCommand: true
};

const FAILED_RESULT = {
  context: { runId: "test-run-id", startedAtUnixMs: 1704067200000 },
  outcomes: [
    {
      source: "helius-api",
      status: "failed",
      hasUsableEvidence: false,
      accepted: 0,
      filtered: 0,
      replayed: 0,
      failed: 1,
      conflict: 0,
      sourceObservationId: null,
      sourceObservationKey: null,
      diagnostic: "Error with HELIUS_API_KEY=helius-secret-key-123"
    },
    {
      source: "birdeye-api",
      status: "failed",
      hasUsableEvidence: false,
      accepted: 0,
      filtered: 0,
      replayed: 0,
      failed: 1,
      conflict: 0,
      sourceObservationId: null,
      sourceObservationKey: null,
      diagnostic: "Error with BIRDEYE_API_KEY=birdeye-secret-key-456"
    }
  ],
  status: "FAILED",
  shouldFailCommand: true
};

import { runOnChainFlowCollect } from "../../scripts/collectors/on-chain-flow.js";

describe("on-chain-flow collector script", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
    mockRunOnChainFlowJob.mockReset();
    mockClose.mockReset();
    mockGetPersistence.mockReset();
    mockGetPersistence.mockResolvedValue({
      connection: { close: mockClose },
      rawObservationRepo: {},
      normalizedObservationRepo: {}
    });
    mockCreateNodeRuntime.mockReturnValue(createMockRuntime());
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    vi.clearAllMocks();
  });

  describe("missing provider URL or API key fails before opening persistence", () => {
    it("fails when HELIUS_FLOW_API_URL is missing", async () => {
      mockCreateNodeRuntime.mockReturnValue({
        ...createMockRuntime(),
        env: {
          ...createMockRuntime().env,
          get: vi.fn((name: string) => {
            if (name === "HELIUS_FLOW_API_URL")
              throw new Error("Missing required environment variable: HELIUS_FLOW_API_URL");
            if (name === "BIRDEYE_FLOW_API_URL") return "https://api.birdeye.xyz/v1/defi/portfolio";
            if (name === "HELIUS_API_KEY") return "helius-secret-key-123";
            if (name === "BIRDEYE_API_KEY") return "birdeye-secret-key-456";
            throw new Error(`Unexpected env var: ${name}`);
          })
        }
      });

      await runOnChainFlowCollect();

      expect(process.exitCode).toBe(1);
      expect(mockClose).not.toHaveBeenCalled();
    });

    it("fails when HELIUS_API_KEY is missing", async () => {
      mockCreateNodeRuntime.mockReturnValue({
        ...createMockRuntime(),
        env: {
          ...createMockRuntime().env,
          get: vi.fn((name: string) => {
            if (name === "HELIUS_FLOW_API_URL") return "https://api.helius.xyz/v0/transactions";
            if (name === "BIRDEYE_FLOW_API_URL") return "https://api.birdeye.xyz/v1/defi/portfolio";
            if (name === "HELIUS_API_KEY")
              throw new Error("Missing required environment variable: HELIUS_API_KEY");
            if (name === "BIRDEYE_API_KEY") return "birdeye-secret-key-456";
            throw new Error(`Unexpected env var: ${name}`);
          })
        }
      });

      await runOnChainFlowCollect();

      expect(process.exitCode).toBe(1);
      expect(mockClose).not.toHaveBeenCalled();
    });

    it("fails when BIRDEYE_FLOW_API_URL is missing", async () => {
      mockCreateNodeRuntime.mockReturnValue({
        ...createMockRuntime(),
        env: {
          ...createMockRuntime().env,
          get: vi.fn((name: string) => {
            if (name === "HELIUS_FLOW_API_URL") return "https://api.helius.xyz/v0/transactions";
            if (name === "BIRDEYE_FLOW_API_URL")
              throw new Error("Missing required environment variable: BIRDEYE_FLOW_API_URL");
            if (name === "HELIUS_API_KEY") return "helius-secret-key-123";
            if (name === "BIRDEYE_API_KEY") return "birdeye-secret-key-456";
            throw new Error(`Unexpected env var: ${name}`);
          })
        }
      });

      await runOnChainFlowCollect();

      expect(process.exitCode).toBe(1);
      expect(mockClose).not.toHaveBeenCalled();
    });

    it("fails when BIRDEYE_API_KEY is missing", async () => {
      mockCreateNodeRuntime.mockReturnValue({
        ...createMockRuntime(),
        env: {
          ...createMockRuntime().env,
          get: vi.fn((name: string) => {
            if (name === "HELIUS_FLOW_API_URL") return "https://api.helius.xyz/v0/transactions";
            if (name === "BIRDEYE_FLOW_API_URL") return "https://api.birdeye.xyz/v1/defi/portfolio";
            if (name === "HELIUS_API_KEY") return "helius-secret-key-123";
            if (name === "BIRDEYE_API_KEY")
              throw new Error("Missing required environment variable: BIRDEYE_API_KEY");
            throw new Error(`Unexpected env var: ${name}`);
          })
        }
      });

      await runOnChainFlowCollect();

      expect(process.exitCode).toBe(1);
      expect(mockClose).not.toHaveBeenCalled();
    });
  });

  describe("invalid threshold fails before HTTP and persistence", () => {
    it("fails for negative threshold", async () => {
      mockCreateNodeRuntime.mockReturnValue({
        ...createMockRuntime(),
        env: {
          ...createMockRuntime().env,
          getOptional: vi.fn((name: string) => {
            if (name === "ON_CHAIN_WHALE_TRANSFER_MIN_USDC") return "-1000000";
            return undefined;
          })
        }
      });

      await runOnChainFlowCollect();

      expect(process.exitCode).toBe(1);
      expect(mockClose).not.toHaveBeenCalled();
    });

    it("fails for non-decimal threshold", async () => {
      mockCreateNodeRuntime.mockReturnValue({
        ...createMockRuntime(),
        env: {
          ...createMockRuntime().env,
          getOptional: vi.fn((name: string) => {
            if (name === "ON_CHAIN_WHALE_TRANSFER_MIN_USDC") return "not-a-number";
            return undefined;
          })
        }
      });

      await runOnChainFlowCollect();

      expect(process.exitCode).toBe(1);
      expect(mockClose).not.toHaveBeenCalled();
    });

    it("fails for unsafe confidence threshold (above 1)", async () => {
      mockCreateNodeRuntime.mockReturnValue({
        ...createMockRuntime(),
        env: {
          ...createMockRuntime().env,
          getOptional: vi.fn((name: string) => {
            if (name === "ON_CHAIN_CEX_MIN_ATTRIBUTION_CONFIDENCE") return "1.5";
            return undefined;
          })
        }
      });

      await runOnChainFlowCollect();

      expect(process.exitCode).toBe(1);
      expect(mockClose).not.toHaveBeenCalled();
    });

    it("fails for unsafe confidence threshold (negative)", async () => {
      mockCreateNodeRuntime.mockReturnValue({
        ...createMockRuntime(),
        env: {
          ...createMockRuntime().env,
          getOptional: vi.fn((name: string) => {
            if (name === "ON_CHAIN_CEX_MIN_ATTRIBUTION_CONFIDENCE") return "-0.1";
            return undefined;
          })
        }
      });

      await runOnChainFlowCollect();

      expect(process.exitCode).toBe(1);
      expect(mockClose).not.toHaveBeenCalled();
    });
  });

  describe("configured values create both adapters and pass explicit thresholds to the job", () => {
    it("passes correct thresholds to the job", async () => {
      mockRunOnChainFlowJob.mockResolvedValue(COMPLETE_RESULT);

      await runOnChainFlowCollect();

      expect(mockRunOnChainFlowJob).toHaveBeenCalledTimes(1);
      const callArgs = mockRunOnChainFlowJob.mock.calls[0]![0];

      expect(callArgs).toHaveProperty("sources");
      expect(callArgs.sources).toHaveLength(2);
      expect(callArgs).toHaveProperty("thresholds");
      expect(callArgs.thresholds.whaleTransferMinUsdc).toBe("1000000");
      expect(callArgs.thresholds.whaleSwapMinUsdc).toBe("1000000");
      expect(callArgs.thresholds.stablecoinFlowMinUsdc).toBe("1000000");
      expect(callArgs.thresholds.dexNetFlowMinUsdc).toBe("5000000");
      expect(callArgs.thresholds.cexFlowProxyMinUsdc).toBe("1000000");
      expect(callArgs.thresholds.cexMinAttributionConfidence).toBe(0.8);
      expect(callArgs).toHaveProperty("lookbackMs");
      expect(callArgs.lookbackMs).toBe(900000);
    });
  });

  describe("COMPLETE and PARTIAL exit zero while UNAVAILABLE and FAILED exit nonzero", () => {
    it("exits zero for COMPLETE status", async () => {
      mockRunOnChainFlowJob.mockResolvedValue(COMPLETE_RESULT);

      await runOnChainFlowCollect();

      expect(logSpy).toHaveBeenCalled();
      const printed = JSON.parse(logSpy.mock.calls[0]![0] as string);
      expect(printed.status).toBe("COMPLETE");
      expect(process.exitCode).toBe(0);
    });

    it("exits zero for PARTIAL status", async () => {
      mockRunOnChainFlowJob.mockResolvedValue(PARTIAL_RESULT);

      await runOnChainFlowCollect();

      expect(logSpy).toHaveBeenCalled();
      const printed = JSON.parse(logSpy.mock.calls[0]![0] as string);
      expect(printed.status).toBe("PARTIAL");
      expect(process.exitCode).toBe(0);
    });

    it("exits nonzero for UNAVAILABLE status", async () => {
      mockRunOnChainFlowJob.mockResolvedValue(UNAVAILABLE_RESULT);

      await runOnChainFlowCollect();

      expect(logSpy).toHaveBeenCalled();
      const printed = JSON.parse(logSpy.mock.calls[0]![0] as string);
      expect(printed.status).toBe("UNAVAILABLE");
      expect(process.exitCode).toBe(1);
    });

    it("exits nonzero for FAILED status", async () => {
      mockRunOnChainFlowJob.mockResolvedValue(FAILED_RESULT);

      await runOnChainFlowCollect();

      expect(logSpy).toHaveBeenCalled();
      const printed = JSON.parse(logSpy.mock.calls[0]![0] as string);
      expect(printed.status).toBe("FAILED");
      expect(process.exitCode).toBe(1);
    });
  });

  describe("provider keys are redacted from logs and close failures", () => {
    it("redacts HELIUS_API_KEY from diagnostic output", async () => {
      mockRunOnChainFlowJob.mockResolvedValue(FAILED_RESULT);

      await runOnChainFlowCollect();

      expect(logSpy).toHaveBeenCalled();
      const printed = JSON.stringify(logSpy.mock.calls);
      expect(printed).not.toContain("helius-secret-key-123");
      expect(printed).not.toContain("HELIUS_API_KEY");
    });

    it("redacts BIRDEYE_API_KEY from diagnostic output", async () => {
      mockRunOnChainFlowJob.mockResolvedValue(FAILED_RESULT);

      await runOnChainFlowCollect();

      expect(logSpy).toHaveBeenCalled();
      const printed = JSON.stringify(logSpy.mock.calls);
      expect(printed).not.toContain("birdeye-secret-key-456");
      expect(printed).not.toContain("BIRDEYE_API_KEY");
    });

    it("redacts secrets from close failure errors", async () => {
      mockRunOnChainFlowJob.mockResolvedValue(COMPLETE_RESULT);
      mockClose.mockRejectedValueOnce(
        new Error("Close failed with HELIUS_API_KEY=helius-secret-key-123")
      );

      await runOnChainFlowCollect();

      expect(errorSpy).toHaveBeenCalled();
      const errorOutput = errorSpy.mock.calls.map((c) => c.join(" ")).join(" ");
      expect(errorOutput).not.toContain("helius-secret-key-123");
      expect(errorOutput).not.toContain("HELIUS_API_KEY");
    });
  });

  describe("database connection closes exactly once after a started run", () => {
    it("closes the database connection exactly once on success", async () => {
      mockRunOnChainFlowJob.mockResolvedValue(COMPLETE_RESULT);

      await runOnChainFlowCollect();

      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it("closes the database connection exactly once on failure", async () => {
      mockRunOnChainFlowJob.mockRejectedValue(new Error("Job failed"));

      await runOnChainFlowCollect();

      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it("closes the database connection exactly once when close throws", async () => {
      mockRunOnChainFlowJob.mockResolvedValue(COMPLETE_RESULT);
      mockClose.mockRejectedValueOnce(new Error("Close failed"));

      await runOnChainFlowCollect();

      expect(mockClose).toHaveBeenCalledTimes(1);
    });
  });
});
