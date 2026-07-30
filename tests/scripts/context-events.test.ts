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

const {
  mockHttpScheduledEventSource,
  mockUnavailableScheduledEventSource,
  mockHttpProtocolIncidentSource
} = vi.hoisted(() => ({
  mockHttpScheduledEventSource: vi.fn(),
  mockUnavailableScheduledEventSource: vi.fn(),
  mockHttpProtocolIncidentSource: vi.fn()
}));

vi.mock("../../src/adapters/node/http-scheduled-event-source.js", () => {
  return {
    HttpScheduledEventSource: class {
      constructor(...args: unknown[]) {
        mockHttpScheduledEventSource(...args);
      }
    }
  };
});

vi.mock("../../src/adapters/node/unavailable-scheduled-event-source.js", () => {
  return {
    UnavailableScheduledEventSource: class {
      constructor(...args: unknown[]) {
        mockUnavailableScheduledEventSource(...args);
      }
    }
  };
});

vi.mock("../../src/adapters/node/http-protocol-incident-source.js", () => {
  return {
    HttpProtocolIncidentSource: class {
      constructor(...args: unknown[]) {
        mockHttpProtocolIncidentSource(...args);
      }
    }
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
              findByBundleIds: vi.fn(),
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

function mockRuntimeWithEnv(overrides: Record<string, string | undefined>) {
  vi.mocked(createNodeRuntime as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
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
        if (name in overrides) return overrides[name] ?? "";
        if (name === "DATABASE_URL") return "postgresql://localhost";
        return "";
      }),
      getOptional: vi.fn((name: string) => {
        if (name in overrides) return overrides[name];
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
          findByBundleIds: vi.fn(),
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
  }));
}

describe("context-events collector script", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.exitCode = undefined;
    mockCreateCollectionRunContext.mockReset();
    mockCollectScheduledEvents.mockReset();
    mockCollectProtocolIncidents.mockReset();
    mockClose.mockReset();
    mockHttpScheduledEventSource.mockReset();
    mockUnavailableScheduledEventSource.mockReset();
    mockHttpProtocolIncidentSource.mockReset();
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
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
      const scheduledCall = mockCollectScheduledEvents.mock.calls[0]!;
      expect(scheduledCall[0]).toHaveProperty("eventSource");
      expect(scheduledCall[0]).toHaveProperty("rawObservationRepo");
      expect(scheduledCall[0]).toHaveProperty("normalizedObservationRepo");

      expect(mockCollectProtocolIncidents).toHaveBeenCalledTimes(1);
      const incidentCall = mockCollectProtocolIncidents.mock.calls[0]!;
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

  describe("handles missing or default URL configuration and graceful degradation", () => {
    it("uses the configured macro source when MACRO_CALENDAR_API_URL is present", async () => {
      mockCollectScheduledEvents.mockResolvedValue(ACCEPTED_RESULT);
      mockCollectProtocolIncidents.mockResolvedValue(ACCEPTED_RESULT);
      mockCreateCollectionRunContext.mockReturnValue({ runId: "test-run-id" });

      await runContextEventsCollect();

      expect(mockHttpScheduledEventSource).toHaveBeenCalledWith(
        expect.objectContaining({ url: "https://api.example.com/events" })
      );
      expect(mockUnavailableScheduledEventSource).not.toHaveBeenCalled();
    });

    it("uses the deferred source and warns once when MACRO_CALENDAR_API_URL is missing", async () => {
      mockRuntimeWithEnv({ MACRO_CALENDAR_API_URL: undefined });
      mockCollectScheduledEvents.mockResolvedValue(UNAVAILABLE_RESULT);
      mockCollectProtocolIncidents.mockResolvedValue(ACCEPTED_RESULT);
      mockCreateCollectionRunContext.mockReturnValue({ runId: "test-run-id" });

      await runContextEventsCollect();

      expect(mockUnavailableScheduledEventSource).toHaveBeenCalledWith(
        "scheduled_event collection is deferred pending source verification"
      );
      expect(mockHttpScheduledEventSource).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy).toHaveBeenCalledWith(
        "scheduled_event collection is deferred pending source verification"
      );
      expect(process.exitCode).toBe(0);
      expect(mockClose).toHaveBeenCalledOnce();
    });

    it("treats a whitespace-only macro URL as deferred", async () => {
      mockRuntimeWithEnv({ MACRO_CALENDAR_API_URL: "   " });
      mockCollectScheduledEvents.mockResolvedValue(UNAVAILABLE_RESULT);
      mockCollectProtocolIncidents.mockResolvedValue(ACCEPTED_RESULT);
      mockCreateCollectionRunContext.mockReturnValue({ runId: "test-run-id" });

      await runContextEventsCollect();

      expect(mockUnavailableScheduledEventSource).toHaveBeenCalledWith(
        "scheduled_event collection is deferred pending source verification"
      );
      expect(mockHttpScheduledEventSource).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy).toHaveBeenCalledWith(
        "scheduled_event collection is deferred pending source verification"
      );
    });

    it("defaults SOLANA_STATUS_API_URL to https://status.solana.com", async () => {
      mockRuntimeWithEnv({ SOLANA_STATUS_API_URL: undefined });
      mockCollectScheduledEvents.mockResolvedValue(ACCEPTED_RESULT);
      mockCollectProtocolIncidents.mockResolvedValue(ACCEPTED_RESULT);
      mockCreateCollectionRunContext.mockReturnValue({ runId: "test-run-id" });

      await runContextEventsCollect();

      expect(mockHttpProtocolIncidentSource).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://status.solana.com",
          apiKey: "secret-status-key-456"
        })
      );
    });

    it("honors an explicit SOLANA_STATUS_API_URL override", async () => {
      mockRuntimeWithEnv({ SOLANA_STATUS_API_URL: "https://custom-status.example.com" });
      mockCollectScheduledEvents.mockResolvedValue(ACCEPTED_RESULT);
      mockCollectProtocolIncidents.mockResolvedValue(ACCEPTED_RESULT);
      mockCreateCollectionRunContext.mockReturnValue({ runId: "test-run-id" });

      await runContextEventsCollect();

      expect(mockHttpProtocolIncidentSource).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://custom-status.example.com"
        })
      );
    });

    it("exits zero when deferred scheduled events and protocol incidents produce PARTIAL", async () => {
      mockRuntimeWithEnv({ MACRO_CALENDAR_API_URL: undefined });
      mockCollectScheduledEvents.mockResolvedValue(UNAVAILABLE_RESULT);
      mockCollectProtocolIncidents.mockResolvedValue(ACCEPTED_RESULT);
      mockCreateCollectionRunContext.mockReturnValue({ runId: "test-run-id" });

      await runContextEventsCollect();

      expect(logSpy).toHaveBeenCalled();
      const printed = JSON.parse(logSpy.mock.calls[0]![0] as string);
      expect(printed.status).toBe("PARTIAL");
      expect(process.exitCode).toBe(0);
    });

    it("exits nonzero when deferred scheduled events and protocol incidents are unavailable", async () => {
      mockRuntimeWithEnv({ MACRO_CALENDAR_API_URL: undefined });
      mockCollectScheduledEvents.mockResolvedValue(UNAVAILABLE_RESULT);
      mockCollectProtocolIncidents.mockResolvedValue(UNAVAILABLE_RESULT);
      mockCreateCollectionRunContext.mockReturnValue({ runId: "test-run-id" });

      await runContextEventsCollect();

      expect(logSpy).toHaveBeenCalled();
      const printed = JSON.parse(logSpy.mock.calls[0]![0] as string);
      expect(printed.status).toBe("UNAVAILABLE");
      expect(process.exitCode).toBe(1);
    });

    it("closes persistence once after a deferred scheduled-event run", async () => {
      mockRuntimeWithEnv({ MACRO_CALENDAR_API_URL: undefined });
      mockCollectScheduledEvents.mockResolvedValue(UNAVAILABLE_RESULT);
      mockCollectProtocolIncidents.mockResolvedValue(ACCEPTED_RESULT);
      mockCreateCollectionRunContext.mockReturnValue({ runId: "test-run-id" });

      await runContextEventsCollect();

      expect(mockClose).toHaveBeenCalledOnce();
    });
  });
});
