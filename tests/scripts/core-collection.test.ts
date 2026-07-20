import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CoreCollectionJobDeps } from "../../src/jobs/core-collection-job.js";

// Define mocks first
const mockCreateCollectionRunContext = vi.fn();
vi.mock("../../src/application/create-collection-run-context.js", () => {
  return {
    createCollectionRunContext: (args: unknown) => mockCreateCollectionRunContext(args)
  };
});

const mockCollectCore = vi.fn();
vi.mock("../../src/application/collect-core.js", () => {
  return {
    collectCore: (deps: unknown, context: unknown) => mockCollectCore(deps, context)
  };
});

const mockCollectClmmBundle = vi.fn();
vi.mock("../../src/application/collect-clmm-bundle.js", () => {
  return {
    collectClmmBundle: (deps: unknown, context: unknown) => mockCollectClmmBundle(deps, context),
    CLMM_BUNDLE_PATH: "data/latest-clmm-bundle.json"
  };
});

const mockCollectPythPrice = vi.fn();
vi.mock("../../src/application/collect-pyth-price.js", () => {
  return {
    collectPythPrice: (deps: unknown, context: unknown) => mockCollectPythPrice(deps, context)
  };
});

const mockCollectJupiterQuote = vi.fn();
vi.mock("../../src/application/collect-jupiter-quote.js", () => {
  return {
    collectJupiterQuote: (deps: unknown, context: unknown) => mockCollectJupiterQuote(deps, context)
  };
});

const mockCollectOrcaPoolStatistics = vi.fn();
vi.mock("../../src/application/collect-orca-pool-statistics.js", () => {
  return {
    collectOrcaPoolStatistics: (deps: unknown, context: unknown) =>
      mockCollectOrcaPoolStatistics(deps, context)
  };
});

// We will import core-collection-job and the script after mock setup
import { coreCollectionJob } from "../../src/jobs/core-collection-job.js";
import { runCoreCollection } from "../../scripts/collectors/core-collection.js";

// Mock composition root
const mockClose = vi.fn();
const mockGetPersistence = vi.fn().mockResolvedValue({
  connection: { close: mockClose },
  rawObservationRepo: {},
  normalizedObservationRepo: {}
});

vi.mock("../../src/adapters/node/composition-root.js", () => {
  return {
    createNodeRuntime: vi.fn(() => ({
      http: {},
      jsonStore: {},
      env: {
        get: vi.fn((name: string) => {
          if (name === "DATABASE_URL") return "postgresql://localhost";
          return "";
        }),
        getOptional: vi.fn()
      },
      clock: {},
      runIdFactory: {},
      getPersistence: () => mockGetPersistence()
    }))
  };
});

interface MockCollectCoreDeps {
  clmmV2: (ctx: unknown) => Promise<unknown>;
  pyth: (ctx: unknown) => Promise<unknown>;
  jupiter: (ctx: unknown) => Promise<unknown>;
  orca: (ctx: unknown) => Promise<unknown>;
}

describe("Core Collection", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
    mockCreateCollectionRunContext.mockReset();
    mockCollectCore.mockReset();
    mockCollectClmmBundle.mockReset();
    mockCollectPythPrice.mockReset();
    mockCollectJupiterQuote.mockReset();
    mockCollectOrcaPoolStatistics.mockReset();
    mockClose.mockReset();
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    vi.clearAllMocks();
  });

  describe("coreCollectionJob", () => {
    it("creates one context then binds clmm pyth jupiter and orca leaves", async () => {
      const mockContext = { runId: "test-run-id" };
      mockCreateCollectionRunContext.mockReturnValue(mockContext);

      // Make collectCore return a mock result
      mockCollectCore.mockResolvedValue({
        status: "COMPLETE",
        shouldFailCommand: false
      });

      const deps = {
        http: {},
        jsonStore: {},
        env: {},
        clock: {},
        rawObservationRepo: {},
        normalizedObservationRepo: {},
        runIdFactory: {}
      } as unknown as CoreCollectionJobDeps;

      const job = coreCollectionJob(deps);
      await job();

      expect(mockCreateCollectionRunContext).toHaveBeenCalledTimes(1);
      expect(mockCollectCore).toHaveBeenCalledTimes(1);

      // Extract the leaf functions passed to collectCore
      const [passedDeps] = mockCollectCore.mock.calls[0] as [MockCollectCoreDeps];
      expect(passedDeps.clmmV2).toBeTypeOf("function");
      expect(passedDeps.pyth).toBeTypeOf("function");
      expect(passedDeps.jupiter).toBeTypeOf("function");
      expect(passedDeps.orca).toBeTypeOf("function");

      // Verify they pass the SAME context
      mockCollectClmmBundle.mockResolvedValue({ rawOutcome: { outcome: "accepted" } });
      await passedDeps.clmmV2(mockContext);
      expect(mockCollectClmmBundle).toHaveBeenCalledWith(deps, mockContext);

      mockCollectPythPrice.mockResolvedValue({ status: "accepted" });
      await passedDeps.pyth(mockContext);
      expect(mockCollectPythPrice).toHaveBeenCalledWith(deps, mockContext);

      mockCollectJupiterQuote.mockResolvedValue({ status: "accepted" });
      await passedDeps.jupiter(mockContext);
      expect(mockCollectJupiterQuote).toHaveBeenCalledWith(deps, mockContext);

      mockCollectOrcaPoolStatistics.mockResolvedValue({ status: "accepted" });
      await passedDeps.orca(mockContext);
      expect(mockCollectOrcaPoolStatistics).toHaveBeenCalledWith(deps, mockContext);
    });
  });

  describe("core-collection script", () => {
    it("prints every source outcome and exits by derived overall status", async () => {
      // 1. COMPLETE status -> exit code 0 (or undefined/0)
      mockCollectCore.mockResolvedValue({
        status: "COMPLETE",
        shouldFailCommand: false,
        clmmV2: { status: "accepted", warnings: [] },
        pyth: { status: "accepted", warnings: [] },
        jupiter: { status: "accepted", warnings: [] },
        orca: { status: "accepted", warnings: [] }
      });
      mockCreateCollectionRunContext.mockReturnValue({ runId: "test-run-id" });

      await runCoreCollection();
      expect(logSpy).toHaveBeenCalled();
      let printed = JSON.parse(logSpy.mock.calls[0]![0] as string);
      expect(printed.status).toBe("COMPLETE");
      expect(process.exitCode).toBe(0);

      // Reset and test FAILED status -> exit code 1
      logSpy.mockClear();
      mockCollectCore.mockResolvedValue({
        status: "FAILED",
        shouldFailCommand: true,
        clmmV2: { status: "failed", diagnostic: "Error API_KEY=secret" },
        pyth: { status: "failed" },
        jupiter: { status: "failed" },
        orca: { status: "failed" }
      });

      await runCoreCollection();
      expect(logSpy).toHaveBeenCalled();
      printed = JSON.parse(logSpy.mock.calls[0]![0] as string);
      expect(printed.status).toBe("FAILED");
      // Assert no secret keys or api keys in unredacted diagnostic
      expect(JSON.stringify(printed)).not.toContain("API_KEY=secret");
      expect(JSON.stringify(printed)).not.toContain("secret");
      expect(process.exitCode).toBe(1);
    });

    it("closes the database once after all source outcomes settle", async () => {
      mockCollectCore.mockResolvedValue({
        status: "COMPLETE",
        shouldFailCommand: false
      });
      mockCreateCollectionRunContext.mockReturnValue({ runId: "test-run-id" });

      await runCoreCollection();
      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it("reports cleanup failure without rewriting committed source outcomes", async () => {
      mockCollectCore.mockResolvedValue({
        status: "COMPLETE",
        shouldFailCommand: false
      });
      mockCreateCollectionRunContext.mockReturnValue({ runId: "test-run-id" });
      mockClose.mockRejectedValueOnce(new Error("Database close failed with secret=xyz"));

      await runCoreCollection();
      expect(logSpy).toHaveBeenCalled();
      const printed = JSON.parse(logSpy.mock.calls[0]![0] as string);
      expect(printed.status).toBe("COMPLETE"); // Still printed successfully

      expect(errorSpy).toHaveBeenCalled();
      expect(process.exitCode).toBe(1); // Exits non-zero due to cleanup failure

      // Check error text is redacted
      const errorLogs = errorSpy.mock.calls.map((c) => c.join(" ")).join(" ");
      expect(errorLogs).toContain("Database close failed");
      expect(errorLogs).not.toContain("secret=xyz");
      expect(errorLogs).not.toContain("xyz");
    });
  });
});
