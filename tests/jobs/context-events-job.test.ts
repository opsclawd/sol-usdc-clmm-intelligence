import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CollectionRunContext } from "../../src/application/create-collection-run-context.js";
import type { NormalizedObservationRepo } from "../../src/ports/normalized-observation-repo.js";
import type { RawObservationRepo } from "../../src/ports/observation-repo.js";
import type { ScheduledEventSourcePort } from "../../src/ports/scheduled-event-source.js";
import type { ProtocolIncidentSourcePort } from "../../src/ports/protocol-incident-source.js";
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

import { contextEventsJob, runContextEventsJob } from "../../src/jobs/context-events-job.js";

const VALID_CONTEXT: CollectionRunContext = Object.freeze({
  runId: "run-context-123",
  startedAtUnixMs: 1704067200000
});

function makeJobDeps() {
  return {
    scheduledEventSource: {
      collect: vi.fn()
    } as unknown as ScheduledEventSourcePort,
    protocolIncidentSource: {
      collect: vi.fn()
    } as unknown as ProtocolIncidentSourcePort,
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

const ACCEPTED_RESULT: ContextEventCollectionResult = {
  status: "accepted",
  rawObservationId: 1,
  normalizedCount: 1,
  warnings: [],
  diagnostic: null
};

const UNAVAILABLE_RESULT: ContextEventCollectionResult = {
  status: "unavailable",
  rawObservationId: null,
  normalizedCount: 0,
  warnings: [],
  diagnostic: "Service unavailable"
};

const DEGRADED_RESULT: ContextEventCollectionResult = {
  status: "degraded",
  rawObservationId: 1,
  normalizedCount: 0,
  warnings: ["stale_observation"],
  diagnostic: null
};

describe("contextEventsJob", () => {
  beforeEach(() => {
    mockCreateCollectionRunContext.mockReset();
    mockCollectScheduledEvents.mockReset();
    mockCollectProtocolIncidents.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("creates one collection run context and delegates to both context event use cases", () => {
    it("creates exactly one context", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectScheduledEvents.mockResolvedValue(ACCEPTED_RESULT);
      mockCollectProtocolIncidents.mockResolvedValue(ACCEPTED_RESULT);

      const deps = makeJobDeps();
      const job = contextEventsJob(deps);
      await job();

      expect(mockCreateCollectionRunContext).toHaveBeenCalledTimes(1);
    });

    it("calls both collectScheduledEvents and collectProtocolIncidents once each", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectScheduledEvents.mockResolvedValue(ACCEPTED_RESULT);
      mockCollectProtocolIncidents.mockResolvedValue(ACCEPTED_RESULT);

      const deps = makeJobDeps();
      const job = contextEventsJob(deps);
      await job();

      expect(mockCollectScheduledEvents).toHaveBeenCalledTimes(1);
      expect(mockCollectProtocolIncidents).toHaveBeenCalledTimes(1);
    });

    it("passes correct dependencies to both collection functions", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectScheduledEvents.mockResolvedValue(ACCEPTED_RESULT);
      mockCollectProtocolIncidents.mockResolvedValue(ACCEPTED_RESULT);

      const deps = makeJobDeps();
      const job = contextEventsJob(deps);
      await job();

      const scheduledCall = mockCollectScheduledEvents.mock.calls[0];
      expect(scheduledCall[0]).toHaveProperty("eventSource");
      expect(scheduledCall[0]).toHaveProperty("rawObservationRepo");
      expect(scheduledCall[0]).toHaveProperty("normalizedObservationRepo");
      expect(scheduledCall[1]).toBe(VALID_CONTEXT);

      const incidentCall = mockCollectProtocolIncidents.mock.calls[0];
      expect(incidentCall[0]).toHaveProperty("incidentSource");
      expect(incidentCall[0]).toHaveProperty("rawObservationRepo");
      expect(incidentCall[0]).toHaveProperty("normalizedObservationRepo");
      expect(incidentCall[1]).toBe(VALID_CONTEXT);
    });
  });
});

describe("runContextEventsJob", () => {
  beforeEach(() => {
    mockCreateCollectionRunContext.mockReset();
    mockCollectScheduledEvents.mockReset();
    mockCollectProtocolIncidents.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("returns PARTIAL when exactly one contextual source is usable", () => {
    it("returns partial success when exactly one contextual source is usable", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectScheduledEvents.mockResolvedValue(ACCEPTED_RESULT);
      mockCollectProtocolIncidents.mockResolvedValue(UNAVAILABLE_RESULT);

      const deps = makeJobDeps();
      const result = await runContextEventsJob(deps);

      expect(result.status).toBe("PARTIAL");
      expect(result.shouldFailCommand).toBe(false);
    });

    it("returns partial success when scheduled events unavailable and protocol incidents succeed", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectScheduledEvents.mockResolvedValue(UNAVAILABLE_RESULT);
      mockCollectProtocolIncidents.mockResolvedValue(ACCEPTED_RESULT);

      const deps = makeJobDeps();
      const result = await runContextEventsJob(deps);

      expect(result.status).toBe("PARTIAL");
      expect(result.shouldFailCommand).toBe(false);
    });
  });

  describe("returns COMPLETE when both sources return usable evidence", () => {
    it("returns complete when both sources succeed with accepted status", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectScheduledEvents.mockResolvedValue(ACCEPTED_RESULT);
      mockCollectProtocolIncidents.mockResolvedValue(ACCEPTED_RESULT);

      const deps = makeJobDeps();
      const result = await runContextEventsJob(deps);

      expect(result.status).toBe("COMPLETE");
      expect(result.shouldFailCommand).toBe(false);
    });

    it("returns complete when both sources succeed with degraded but usable evidence", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectScheduledEvents.mockResolvedValue(DEGRADED_RESULT);
      mockCollectProtocolIncidents.mockResolvedValue(ACCEPTED_RESULT);

      const deps = makeJobDeps();
      const result = await runContextEventsJob(deps);

      expect(result.status).toBe("COMPLETE");
      expect(result.shouldFailCommand).toBe(false);
    });
  });

  describe("fails when both contextual sources are unavailable", () => {
    it("fails when both contextual sources are unavailable", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectScheduledEvents.mockResolvedValue(UNAVAILABLE_RESULT);
      mockCollectProtocolIncidents.mockResolvedValue(UNAVAILABLE_RESULT);

      const deps = makeJobDeps();
      const result = await runContextEventsJob(deps);

      expect(result.status).toBe("UNAVAILABLE");
      expect(result.shouldFailCommand).toBe(true);
    });

    it("fails when both sources return no usable evidence", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectScheduledEvents.mockResolvedValue({
        status: "failed" as const,
        rawObservationId: null,
        normalizedCount: 0,
        warnings: [],
        diagnostic: "Normalization failed"
      });
      mockCollectProtocolIncidents.mockResolvedValue({
        status: "failed" as const,
        rawObservationId: null,
        normalizedCount: 0,
        warnings: [],
        diagnostic: "Normalization failed"
      });

      const deps = makeJobDeps();
      const result = await runContextEventsJob(deps);

      expect(result.status).toBe("FAILED");
      expect(result.shouldFailCommand).toBe(true);
    });
  });

  describe("returns FAILED on error", () => {
    it("returns failed result on collection error", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectScheduledEvents.mockResolvedValue({
        status: "failed" as const,
        rawObservationId: null,
        normalizedCount: 0,
        warnings: [],
        diagnostic: "Normalization failed"
      });
      mockCollectProtocolIncidents.mockResolvedValue(ACCEPTED_RESULT);

      const deps = makeJobDeps();
      const result = await runContextEventsJob(deps);

      expect(result.status).toBe("FAILED");
      expect(result.shouldFailCommand).toBe(true);
    });
  });

  describe("includes context and source outcomes in result", () => {
    it("includes the collection run context in result", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectScheduledEvents.mockResolvedValue(ACCEPTED_RESULT);
      mockCollectProtocolIncidents.mockResolvedValue(ACCEPTED_RESULT);

      const deps = makeJobDeps();
      const result = await runContextEventsJob(deps);

      expect(result.context).toBe(VALID_CONTEXT);
    });

    it("includes both source outcomes in result", async () => {
      mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
      mockCollectScheduledEvents.mockResolvedValue(ACCEPTED_RESULT);
      mockCollectProtocolIncidents.mockResolvedValue(DEGRADED_RESULT);

      const deps = makeJobDeps();
      const result = await runContextEventsJob(deps);

      expect(result.scheduledEvents).toMatchObject({
        status: "accepted",
        hasUsableEvidence: true
      });
      expect(result.protocolIncidents).toMatchObject({
        status: "degraded",
        hasUsableEvidence: true
      });
    });
  });
});
