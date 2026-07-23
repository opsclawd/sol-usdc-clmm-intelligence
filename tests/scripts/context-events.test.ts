import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NodeRuntime, Persistence } from "../../src/adapters/node/composition-root.js";
import { createNodeRuntime } from "../../src/adapters/node/composition-root.js";
import type { ContextEventCollectionResult } from "../../src/application/collect-context-events.js";

const mockCreateCollectionRunContext = vi.fn();
vi.mock("../../src/application/create-collection-run-context.js", () => {
  return {
    createCollectionRunContext: (args: unknown) => mockCreateCollectionRunContext(args)
  };
});

const mockCollectScheduledEvents = vi.fn();
vi.mock("../../src/application/collect-scheduled-events.js", () => {
  return {
    collectScheduledEvents: (deps: unknown, context: unknown) =>
      mockCollectScheduledEvents(deps, context)
  };
});

const mockCollectProtocolIncidents = vi.fn();
vi.mock("../../src/application/collect-protocol-incidents.js", () => {
  return {
    collectProtocolIncidents: (deps: unknown, context: unknown) =>
      mockCollectProtocolIncidents(deps, context)
  };
});

const mockClose = vi.fn();

vi.mock("../../src/adapters/node/composition-root.js", () => {
  return {
    createNodeRuntime: vi.fn(
      (): NodeRuntime => ({
        http: {
          getJson: vi.fn()
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
            if (name === "MACRO_CALENDAR_API_URL") return "https://api.example.com/events";
            if (name === "MACRO_CALENDAR_API_KEY") return "secret-api-key-123";
            if (name === "SOLANA_STATUS_API_URL") return "https://api.example.com/incidents";
            if (name === "SOLANA_STATUS_API_KEY") return "secret-status-key-456";
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
              insertMany: vi.fn(),
              findByDerivationKey: vi.fn(),
              findByKind: vi.fn(),
              listBundleCandidates: vi.fn()
            },
            bundleRepo: {
              insertOrClassify: vi.fn(),
              findByPair: vi.fn(),
              findLatestByPair: vi.fn()
            },
            briefRepo: {
              insert: vi.fn(),
              findByBundleId: vi.fn(),
              findByHash: vi.fn()
            },
            publishAttemptRepo: {
              insert: vi.fn(),
              findByTargetAndKey: vi.fn(),
              findByBundle: vi.fn(),
              findRecentByStatus: vi.fn()
            }
          })
        ),
        getContract: vi.fn()
      })
    )
  };
});

import { runContextEventsCollect } from "../../scripts/collectors/context-events.js";

const ACCEPTED_RESULT: ContextEventCollectionResult = {
  status: "accepted",
  rawObservationId: 1,
  normalizedCount: 1,
  warnings: [],
  diagnostic: null
};

const PARTIAL_RESULT: ContextEventCollectionResult = {
  status: "degraded",
  rawObservationId: 1,
  normalizedCount: 0,
  warnings: ["stale_observation"],
  diagnostic: null
};

const UNAVAILABLE_RESULT: ContextEventCollectionResult = {
  status: "unavailable",
  rawObservationId: null,
  normalizedCount: 0,
  warnings: [],
  diagnostic: "Service unavailable"
};

const FAILED_RESULT: ContextEventCollectionResult = {
  status: "failed",
  rawObservationId: null,
  normalizedCount: 0,
  warnings: [],
  diagnostic: "Normalization failed"
};

const DIAGNOSTIC_WITH_SECRET_RESULT: ContextEventCollectionResult = {
  status: "malformed",
  rawObservationId: null,
  normalizedCount: 0,
  warnings: [],
  diagnostic: "Error with MACRO_CALENDAR_API_KEY=secret-api-key-123 and Bearer token"
};

describe("context-events collector script", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
    mockCreateCollectionRunContext.mockReset();
    mockCollectScheduledEvents.mockReset();
    mockCollectProtocolIncidents.mockReset();
    mockClose.mockReset();
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    vi.clearAllMocks();
  });

  describe("creates one collection run context and delegates to both context event use cases", () => {
    it("creates one context and delegates to both sources", async () => {
      mockCollectScheduledEvents.mockResolvedValue(ACCEPTED_RESULT);
      mockCollectProtocolIncidents.mockResolvedValue(ACCEPTED_RESULT);
      mockCreateCollectionRunContext.mockReturnValue({ runId: "test-run-id" });

      await runContextEventsCollect();

      expect(mockCreateCollectionRunContext).toHaveBeenCalledTimes(1);
      expect(mockCollectScheduledEvents).toHaveBeenCalledTimes(1);
      expect(mockCollectProtocolIncidents).toHaveBeenCalledTimes(1);
    });

    it("passes runtime HTTP and persistence to the job", async () => {
      mockCollectScheduledEvents.mockResolvedValue(ACCEPTED_RESULT);
      mockCollectProtocolIncidents.mockResolvedValue(ACCEPTED_RESULT);
      mockCreateCollectionRunContext.mockReturnValue({ runId: "test-run-id" });

      await runContextEventsCollect();

      expect(mockCollectScheduledEvents).toHaveBeenCalledTimes(1);
      const scheduledCall = mockCollectScheduledEvents.mock.calls[0];
      expect(scheduledCall[0]).toHaveProperty("eventSource");
      expect(scheduledCall[0]).toHaveProperty("rawObservationRepo");
      expect(scheduledCall[0]).toHaveProperty("normalizedObservationRepo");

      expect(mockCollectProtocolIncidents).toHaveBeenCalledTimes(1);
      const incidentCall = mockCollectProtocolIncidents.mock.calls[0];
      expect(incidentCall[0]).toHaveProperty("incidentSource");
    });
  });

  describe("exits zero for PARTIAL and COMPLETE aggregate outcomes", () => {
    it("returns partial success when exactly one contextual source is usable", async () => {
      mockCollectScheduledEvents.mockResolvedValue(ACCEPTED_RESULT);
      mockCollectProtocolIncidents.mockResolvedValue(UNAVAILABLE_RESULT);
      mockCreateCollectionRunContext.mockReturnValue({ runId: "test-run-id" });

      await runContextEventsCollect();

      expect(logSpy).toHaveBeenCalled();
      const printed = JSON.parse(logSpy.mock.calls[0]![0] as string);
      expect(printed.status).toBe("PARTIAL");
      expect(process.exitCode).toBe(0);
    });

    it("returns partial success when protocol incidents unavailable and scheduled events succeed", async () => {
      mockCollectScheduledEvents.mockResolvedValue(UNAVAILABLE_RESULT);
      mockCollectProtocolIncidents.mockResolvedValue(ACCEPTED_RESULT);
      mockCreateCollectionRunContext.mockReturnValue({ runId: "test-run-id" });

      await runContextEventsCollect();

      expect(logSpy).toHaveBeenCalled();
      const printed = JSON.parse(logSpy.mock.calls[0]![0] as string);
      expect(printed.status).toBe("PARTIAL");
      expect(process.exitCode).toBe(0);
    });

    it("exits zero for complete status when both sources succeed", async () => {
      mockCollectScheduledEvents.mockResolvedValue(ACCEPTED_RESULT);
      mockCollectProtocolIncidents.mockResolvedValue(ACCEPTED_RESULT);
      mockCreateCollectionRunContext.mockReturnValue({ runId: "test-run-id" });

      await runContextEventsCollect();

      expect(logSpy).toHaveBeenCalled();
      const printed = JSON.parse(logSpy.mock.calls[0]![0] as string);
      expect(printed.status).toBe("COMPLETE");
      expect(process.exitCode).toBe(0);
    });

    it("exits zero for partial status with degraded evidence", async () => {
      mockCollectScheduledEvents.mockResolvedValue(PARTIAL_RESULT);
      mockCollectProtocolIncidents.mockResolvedValue(ACCEPTED_RESULT);
      mockCreateCollectionRunContext.mockReturnValue({ runId: "test-run-id" });

      await runContextEventsCollect();

      expect(logSpy).toHaveBeenCalled();
      const printed = JSON.parse(logSpy.mock.calls[0]![0] as string);
      expect(printed.status).toBe("COMPLETE");
      expect(process.exitCode).toBe(0);
    });
  });

  describe("exits nonzero for UNAVAILABLE and FAILED aggregate outcomes", () => {
    it("fails when both contextual sources are unavailable", async () => {
      mockCollectScheduledEvents.mockResolvedValue(UNAVAILABLE_RESULT);
      mockCollectProtocolIncidents.mockResolvedValue(UNAVAILABLE_RESULT);
      mockCreateCollectionRunContext.mockReturnValue({ runId: "test-run-id" });

      await runContextEventsCollect();

      expect(logSpy).toHaveBeenCalled();
      const printed = JSON.parse(logSpy.mock.calls[0]![0] as string);
      expect(printed.status).toBe("UNAVAILABLE");
      expect(process.exitCode).toBe(1);
    });

    it("fails when both sources fail", async () => {
      mockCollectScheduledEvents.mockResolvedValue(FAILED_RESULT);
      mockCollectProtocolIncidents.mockResolvedValue(FAILED_RESULT);
      mockCreateCollectionRunContext.mockReturnValue({ runId: "test-run-id" });

      await runContextEventsCollect();

      expect(logSpy).toHaveBeenCalled();
      const printed = JSON.parse(logSpy.mock.calls[0]![0] as string);
      expect(printed.status).toBe("FAILED");
      expect(process.exitCode).toBe(1);
    });

    it("fails when no usable evidence is collected", async () => {
      mockCollectScheduledEvents.mockResolvedValue({
        status: "failed" as const,
        rawObservationId: null,
        normalizedCount: 0,
        warnings: [],
        diagnostic: "Normalization failed"
      });
      mockCollectProtocolIncidents.mockResolvedValue(UNAVAILABLE_RESULT);
      mockCreateCollectionRunContext.mockReturnValue({ runId: "test-run-id" });

      await runContextEventsCollect();

      expect(process.exitCode).toBe(1);
    });
  });

  describe("redacts API keys in diagnostic output", () => {
    it("redacts secret keys in diagnostic output", async () => {
      mockCollectScheduledEvents.mockResolvedValue(DIAGNOSTIC_WITH_SECRET_RESULT);
      mockCollectProtocolIncidents.mockResolvedValue(ACCEPTED_RESULT);
      mockCreateCollectionRunContext.mockReturnValue({ runId: "test-run-id" });

      await runContextEventsCollect();

      expect(logSpy).toHaveBeenCalled();
      const printed = logSpy.mock.calls[0]![0] as string;
      expect(printed).not.toContain("MACRO_CALENDAR_API_KEY");
      expect(printed).not.toContain("secret-api-key-123");
      expect(printed).not.toContain("secret-status-key-456");
    });
  });

  describe("closes persistence after contextual event collection", () => {
    it("closes persistence after contextual event collection", async () => {
      mockCollectScheduledEvents.mockResolvedValue(ACCEPTED_RESULT);
      mockCollectProtocolIncidents.mockResolvedValue(ACCEPTED_RESULT);
      mockCreateCollectionRunContext.mockReturnValue({ runId: "test-run-id" });

      await runContextEventsCollect();

      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it("closes persistence even when job throws", async () => {
      mockCollectScheduledEvents.mockRejectedValue(new Error("Unexpected error"));
      mockCreateCollectionRunContext.mockReturnValue({ runId: "test-run-id" });

      await runContextEventsCollect();

      expect(mockClose).toHaveBeenCalledTimes(1);
      expect(process.exitCode).toBe(1);
    });
  });

  describe("handles missing URL configuration", () => {
    it("exits with error when MACRO_CALENDAR_API_URL is missing", async () => {
      vi.mocked(createNodeRuntime as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
        http: { getJson: vi.fn() },
        jsonStore: { readJson: vi.fn(), writeJson: vi.fn() },
        textReader: { readText: vi.fn() },
        env: {
          get: vi.fn((name: string) => {
            if (name === "DATABASE_URL") return "postgresql://localhost";
            return "";
          }),
          getOptional: vi.fn((name: string) => {
            if (name === "MACRO_CALENDAR_API_URL") return undefined;
            if (name === "SOLANA_STATUS_API_URL") return "https://api.example.com/incidents";
            return undefined;
          })
        },
        clock: { now: vi.fn(() => "2024-01-01T00:00:00.000Z") },
        commandRunner: { run: vi.fn() },
        runIdFactory: { nextRunId: vi.fn(() => "test-run-id") },
        retryControl: { sleep: vi.fn(), jitterUnit: vi.fn(() => 0.1) },
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
              insertMany: vi.fn(),
              findByDerivationKey: vi.fn(),
              findByKind: vi.fn(),
              listBundleCandidates: vi.fn()
            },
            bundleRepo: {
              insertOrClassify: vi.fn(),
              findByPair: vi.fn(),
              findLatestByPair: vi.fn()
            },
            briefRepo: { insert: vi.fn(), findByBundleId: vi.fn(), findByHash: vi.fn() },
            publishAttemptRepo: {
              insert: vi.fn(),
              findByTargetAndKey: vi.fn(),
              findByBundle: vi.fn(),
              findRecentByStatus: vi.fn()
            }
          })
        ),
        getContract: vi.fn()
      }));

      await runContextEventsCollect();

      expect(process.exitCode).toBe(1);
    });
  });
});
