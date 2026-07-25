import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockRunPerpLiquidationJob = vi.fn();

vi.mock("../../src/jobs/perp-liquidation-job.js", () => {
  return {
    runPerpLiquidationJob: (...args: unknown[]) => mockRunPerpLiquidationJob(...args)
  };
});

const mockCreateNodeRuntime = vi.fn();
vi.mock("../../src/adapters/node/composition-root.js", () => {
  return {
    createNodeRuntime: () => mockCreateNodeRuntime()
  };
});

vi.mock("../../src/adapters/node/http-binance-liquidation-source.js", () => {
  return {
    HttpBinanceLiquidationSource: vi.fn().mockImplementation(() => ({}))
  };
});

vi.mock("../../src/adapters/node/http-drift-liquidation-source.js", () => {
  return {
    HttpDriftLiquidationSource: vi.fn().mockImplementation(() => ({}))
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
        if (name === "BINANCE_SOL_PERP_SYMBOL") return "SOLUSDT";
        if (name === "DRIFT_DATA_API_BASE_URL") return "https://mainnet-beta.api.drift.trade";
        if (name === "DRIFT_SOL_PERP_MARKET_INDEX") return "0";
        throw new Error(`Unexpected env var: ${name}`);
      }),
      getOptional: vi.fn((name: string) => {
        switch (name) {
          case "BINANCE_FAPI_BASE_URL":
            return "https://fapi.binance.com";
          case "BINANCE_SOL_PERP_SYMBOL":
            return "SOLUSDT";
          case "DRIFT_DATA_API_BASE_URL":
            return "https://mainnet-beta.api.drift.trade";
          case "DRIFT_SOL_PERP_MARKET_INDEX":
            return "0";
          case "DRIFT_PRICE_PRECISION":
            return "1000000";
          case "DRIFT_BASE_PRECISION":
            return "1000000000";
          case "DRIFT_QUOTE_PRECISION":
            return "1000000";
          case "PERP_LIQUIDATION_LOOKBACK_MS":
            return "14400000";
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
    getContract: vi.fn(),
    getPerpLiquidationSources: vi.fn().mockResolvedValue([
      { source: "binance-fapi", adapter: {} },
      { source: "drift-api", adapter: {} }
    ])
  };
}

const COMPLETE_RESULT = {
  context: { runId: "test-run-id", startedAtUnixMs: 1704067200000 },
  outcomes: [
    {
      source: "binance-fapi",
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
      source: "drift-api",
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

import { runPerpLiquidationCollect } from "../../scripts/collectors/perp-liquidation.js";

describe("perp-liquidation script", () => {
  let mockConsoleLog: ReturnType<typeof vi.spyOn>;
  let mockConsoleError: ReturnType<typeof vi.spyOn>;
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    vi.resetAllMocks();
    mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    originalExitCode = process.exitCode;
    process.exitCode = undefined;

    mockClose.mockResolvedValue(undefined);
    mockGetPersistence.mockResolvedValue({
      rawObservationRepo: {},
      normalizedObservationRepo: {},
      derivedFeatureRepo: {},
      connection: {
        close: mockClose
      }
    });

    mockCreateNodeRuntime.mockReturnValue(createMockRuntime());
  });

  afterEach(() => {
    mockConsoleLog.mockRestore();
    mockConsoleError.mockRestore();
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("closes persistence exactly once after success or failure", async () => {
    mockRunPerpLiquidationJob.mockResolvedValue(COMPLETE_RESULT);

    await runPerpLiquidationCollect();

    expect(mockClose).toHaveBeenCalledTimes(1);

    mockClose.mockClear();
    mockRunPerpLiquidationJob.mockRejectedValue(new Error("Job execution failed"));

    await runPerpLiquidationCollect();

    expect(mockClose).toHaveBeenCalledTimes(1);
  });
});
