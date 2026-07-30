import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

const mockClose = vi.fn();
const mockGetPersistence = vi.fn();

// We mock the job module before importing the collector script
vi.mock("../../src/jobs/price-observations-job.js", () => {
  return {
    runPriceObservationsJob: vi.fn()
  };
});

// Mock the composition root to return dummy runtime and persistence
vi.mock("../../src/adapters/node/composition-root.js", () => {
  return {
    createNodeRuntime: vi.fn(() => ({
      http: {},
      jsonStore: {},
      env: {},
      clock: {},
      runIdFactory: {},
      getPersistence: mockGetPersistence
    }))
  };
});

import { runCollector } from "../../scripts/collectors/jupiter-price.js";
import { runPriceObservationsJob } from "../../src/jobs/price-observations-job.js";

describe("jupiter-price CLI script", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;

    mockClose.mockReset();
    mockClose.mockResolvedValue(undefined);

    mockGetPersistence.mockReset();
    mockGetPersistence.mockResolvedValue({
      connection: { close: mockClose },
      rawObservationRepo: {},
      normalizedObservationRepo: {}
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("prints structured result and exits 0 on complete usable success", async () => {
    const mockResult = {
      pyth: { status: "accepted", rawObservationId: 101, normalizedCount: 1, warnings: [] },
      jupiter: { status: "accepted", rawObservationId: 102, normalizedCount: 1, warnings: [] },
      warnings: [],
      isPartial: false,
      usableSourceCount: 2,
      shouldFailCommand: false
    };
    (runPriceObservationsJob as Mock).mockResolvedValue(mockResult);

    await runCollector();

    expect(logSpy).toHaveBeenCalled();
    const calls1 = logSpy.mock.calls;
    expect(calls1[0]).toBeDefined();
    const printed = JSON.parse(calls1[0]![0] as string);
    expect(printed.usableSourceCount).toBe(2);
    expect(printed.shouldFailCommand).toBe(false);
    expect(process.exitCode).toBe(0);
  });

  it("prints structured result and exits 0 on partial usable success", async () => {
    const mockResult = {
      pyth: { status: "accepted", rawObservationId: 101, normalizedCount: 1, warnings: [] },
      jupiter: { status: "timeout", summary: "Request timed out" },
      warnings: ["jupiter: quote collection timed out"],
      isPartial: true,
      usableSourceCount: 1,
      shouldFailCommand: false
    };
    (runPriceObservationsJob as Mock).mockResolvedValue(mockResult);

    await runCollector();

    expect(logSpy).toHaveBeenCalled();
    const calls2 = logSpy.mock.calls;
    expect(calls2[0]).toBeDefined();
    const printed = JSON.parse(calls2[0]![0] as string);
    expect(printed.isPartial).toBe(true);
    expect(printed.usableSourceCount).toBe(1);
    expect(process.exitCode).toBe(0);
  });

  it("prints structured result and exits non-zero on total failure", async () => {
    const mockResult = {
      pyth: { status: "timeout", summary: "Pyth timeout" },
      jupiter: { status: "network", summary: "Jupiter network error" },
      warnings: ["pyth: Hermestimeout", "jupiter: quote network error"],
      isPartial: true,
      usableSourceCount: 0,
      shouldFailCommand: true
    };
    (runPriceObservationsJob as Mock).mockResolvedValue(mockResult);

    await runCollector();

    expect(logSpy).toHaveBeenCalled();
    const calls3 = logSpy.mock.calls;
    expect(calls3[0]).toBeDefined();
    const printed = JSON.parse(calls3[0]![0] as string);
    expect(printed.usableSourceCount).toBe(0);
    expect(printed.shouldFailCommand).toBe(true);
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
  });

  it("prints structured result and exits non-zero on conflict", async () => {
    const mockResult = {
      pyth: { status: "conflict", summary: "Hash mismatch" },
      jupiter: { status: "accepted", rawObservationId: 102, normalizedCount: 1, warnings: [] },
      warnings: ["pyth: Hash mismatch"],
      isPartial: true,
      usableSourceCount: 1,
      shouldFailCommand: true
    };
    (runPriceObservationsJob as Mock).mockResolvedValue(mockResult);

    await runCollector();

    expect(logSpy).toHaveBeenCalled();
    const calls4 = logSpy.mock.calls;
    expect(calls4[0]).toBeDefined();
    const printed = JSON.parse(calls4[0]![0] as string);
    expect(printed.shouldFailCommand).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it("closes the acquired database connection once after a successful run", async () => {
    (runPriceObservationsJob as Mock).mockResolvedValue({
      pyth: { status: "accepted" },
      jupiter: { status: "accepted" },
      warnings: [],
      isPartial: false,
      usableSourceCount: 2,
      shouldFailCommand: false
    });

    await runCollector();

    expect((runPriceObservationsJob as Mock).mock.invocationCallOrder[0]).toBeLessThan(
      mockClose.mock.invocationCallOrder[0]!
    );
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(0);
  });

  it("closes the acquired database connection when collection throws", async () => {
    (runPriceObservationsJob as Mock).mockRejectedValue(
      new Error("collection failed with token=do-not-log")
    );

    await runCollector();

    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy.mock.calls.flat().join(" ")).not.toContain("do-not-log");
    expect(process.exitCode).toBe(1);
  });

  it("surfaces a redacted close failure as a non-zero exit without rewriting the result", async () => {
    (runPriceObservationsJob as Mock).mockResolvedValue({
      pyth: { status: "accepted" },
      jupiter: { status: "accepted" },
      warnings: [],
      isPartial: false,
      usableSourceCount: 2,
      shouldFailCommand: false
    });
    mockClose.mockRejectedValue(new Error("database secret=do-not-log"));

    await runCollector();

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls.flat().join(" ")).toContain("Failed to close database connection");
    expect(errorSpy.mock.calls.flat().join(" ")).not.toContain("do-not-log");
    expect(process.exitCode).toBe(1);
  });

  it("fails safely when persistence initialization does not yield a connection", async () => {
    mockGetPersistence.mockRejectedValue(new Error("DATABASE_URL secret=do-not-log"));

    await runCollector();

    expect(runPriceObservationsJob).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
    expect(errorSpy.mock.calls.flat().join(" ")).not.toContain("do-not-log");
    expect(process.exitCode).toBe(1);
  });
});
