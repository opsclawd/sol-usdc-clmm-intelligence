import { describe, expect, it } from "vitest";
import type { CollectionRunContext } from "../../src/application/create-collection-run-context.js";
import { FakeObservationRepo } from "../fakes/fake-observation-repo.js";
import { FakeNormalizedObservationRepo } from "../fakes/fake-normalized-observation-repo.js";
import { FakeScheduledEventSource, FakeProtocolIncidentSource } from "../fakes/index.js";
import { collectScheduledEvents } from "../../src/application/collect-scheduled-events.js";
import { collectProtocolIncidents } from "../../src/application/collect-protocol-incidents.js";
import { collectContextEvents } from "../../src/application/collect-context-events.js";
import {
  enrichContextEvent,
  type EnrichedContextEventObservation
} from "../../src/domain/context-events/enrich.js";
import type { ScheduledEventPayloadV1 } from "../../src/contracts/context-events.js";

const VALID_CONTEXT: CollectionRunContext = Object.freeze({
  runId: "run-context-events-test",
  startedAtUnixMs: 1704067200000
});

describe("collectContextEvents", () => {
  describe("exact source snapshot replay writes no duplicate normalized rows", () => {
    it("identical bounded snapshot reuses raw row and inserts no normalized duplicates", async () => {
      const rawRepo = new FakeObservationRepo();
      const normRepo = new FakeNormalizedObservationRepo();
      const eventSource = new FakeScheduledEventSource();

      const snapshot = {
        providerId: "macro-calendar-api",
        providerRunId: "run-001",
        sourceId: "macro-cal",
        pair: "SOL/USDC" as const,
        asOfUnixMs: 1704067200000,
        license: "CC0-1.0",
        retention: "bounded" as const,
        confirmationLevel: "explicit" as const,
        events: [
          {
            eventId: "macro-cal-001",
            eventType: "scheduled_event",
            scheduledUnixMs: 1704153600000,
            sourceReferences: []
          }
        ]
      };

      eventSource.setResponse(snapshot);

      const firstResult = await collectScheduledEvents(
        { eventSource, rawObservationRepo: rawRepo, normalizedObservationRepo: normRepo },
        VALID_CONTEXT
      );

      expect(firstResult.status).toBe("accepted");
      expect(firstResult.rawObservationId).toBeDefined();
      const firstNormalizedCount = normRepo.count;

      const secondResult = await collectScheduledEvents(
        { eventSource, rawObservationRepo: rawRepo, normalizedObservationRepo: normRepo },
        VALID_CONTEXT
      );

      expect(secondResult.status).toBe("identical_replay");
      expect(secondResult.rawObservationId).toBe(firstResult.rawObservationId);
      expect(normRepo.count).toBe(firstNormalizedCount);
    });
  });

  describe("changed snapshot appends raw and normalized history", () => {
    it("changed provider snapshot receives distinct raw key and appends normalized lifecycle states", async () => {
      const rawRepo = new FakeObservationRepo();
      const normRepo = new FakeNormalizedObservationRepo();
      const eventSource = new FakeScheduledEventSource();

      const snapshotV1 = {
        providerId: "macro-calendar-api",
        providerRunId: "run-001",
        sourceId: "macro-cal",
        pair: "SOL/USDC" as const,
        asOfUnixMs: 1704067200000,
        license: "CC0-1.0",
        retention: "bounded" as const,
        confirmationLevel: "explicit" as const,
        events: [
          {
            eventId: "macro-cal-001",
            eventType: "scheduled_event",
            scheduledUnixMs: 1704153600000,
            sourceReferences: []
          }
        ]
      };

      eventSource.setResponse(snapshotV1);

      const firstResult = await collectScheduledEvents(
        { eventSource, rawObservationRepo: rawRepo, normalizedObservationRepo: normRepo },
        VALID_CONTEXT
      );

      expect(firstResult.status).toBe("accepted");
      const firstRawId = firstResult.rawObservationId;
      const firstNormCount = normRepo.count;

      const snapshotV2 = {
        ...snapshotV1,
        providerRunId: "run-002",
        asOfUnixMs: 1704067300000,
        events: [
          {
            eventId: "macro-cal-001",
            eventType: "scheduled_event",
            scheduledUnixMs: 1704153600000,
            sourceReferences: []
          }
        ]
      };

      eventSource.setResponse(snapshotV2);

      const contextForV2: CollectionRunContext = {
        ...VALID_CONTEXT,
        startedAtUnixMs: 1704067300000
      };

      const secondResult = await collectScheduledEvents(
        { eventSource, rawObservationRepo: rawRepo, normalizedObservationRepo: normRepo },
        contextForV2
      );

      expect(secondResult.status).toBe("accepted");
      expect(secondResult.rawObservationId).not.toBe(firstRawId);
      expect(normRepo.count).toBeGreaterThan(firstNormCount);
    });
  });

  describe("unavailable source creates no absence claim", () => {
    it("unavailable source creates no raw or normalized observation claiming no events", async () => {
      const rawRepo = new FakeObservationRepo();
      const normRepo = new FakeNormalizedObservationRepo();
      const eventSource = new FakeScheduledEventSource();

      eventSource.setError({ kind: "unavailable", diagnostic: "Service temporarily unavailable" });

      const result = await collectScheduledEvents(
        { eventSource, rawObservationRepo: rawRepo, normalizedObservationRepo: normRepo },
        VALID_CONTEXT
      );

      expect(result.status).toBe("unavailable");
      expect(result.rawObservationId).toBeNull();
      expect(result.normalizedCount).toBe(0);

      const rawRows = [...rawRepo["store"].values()];
      expect(rawRows.length).toBe(0);
      expect(normRepo.count).toBe(0);
    });

    it("unavailable protocol incident source creates no absence claim", async () => {
      const rawRepo = new FakeObservationRepo();
      const normRepo = new FakeNormalizedObservationRepo();
      const incidentSource = new FakeProtocolIncidentSource();

      incidentSource.setError({
        kind: "unavailable",
        diagnostic: "Service temporarily unavailable"
      });

      const result = await collectProtocolIncidents(
        { incidentSource, rawObservationRepo: rawRepo, normalizedObservationRepo: normRepo },
        VALID_CONTEXT
      );

      expect(result.status).toBe("unavailable");
      expect(result.rawObservationId).toBeNull();
      expect(result.normalizedCount).toBe(0);

      const rawRows = [...rawRepo["store"].values()];
      expect(rawRows.length).toBe(0);
      expect(normRepo.count).toBe(0);
    });
  });

  describe("persists bounded raw evidence before normalized candidates", () => {
    it("accepted bounded source data is inserted into raw_observations before normalized inserts", async () => {
      const rawRepo = new FakeObservationRepo();
      const normRepo = new FakeNormalizedObservationRepo();
      const eventSource = new FakeScheduledEventSource();

      const snapshot = {
        providerId: "macro-calendar-api",
        providerRunId: "run-001",
        sourceId: "macro-cal",
        pair: "SOL/USDC" as const,
        asOfUnixMs: 1704067200000,
        license: "CC0-1.0",
        retention: "bounded" as const,
        confirmationLevel: "explicit" as const,
        events: [
          {
            eventId: "macro-cal-001",
            eventType: "scheduled_event",
            scheduledUnixMs: 1704153600000,
            sourceReferences: []
          }
        ]
      };

      eventSource.setResponse(snapshot);

      const events: string[] = [];
      const originalInsertOrClassify = rawRepo.insertOrClassify.bind(rawRepo);
      rawRepo.insertOrClassify = async (row) => {
        events.push("raw_insert");
        return originalInsertOrClassify(row);
      };

      const originalInsertMany = normRepo.insertMany.bind(normRepo);
      normRepo.insertMany = async (rows) => {
        events.push("normalized_batch");
        return originalInsertMany(rows);
      };

      await collectScheduledEvents(
        { eventSource, rawObservationRepo: rawRepo, normalizedObservationRepo: normRepo },
        VALID_CONTEXT
      );

      expect(events).toEqual(["raw_insert", "normalized_batch"]);
    });

    it("each normalized row points to its raw parent", async () => {
      const rawRepo = new FakeObservationRepo();
      const normRepo = new FakeNormalizedObservationRepo();
      const eventSource = new FakeScheduledEventSource();

      const snapshot = {
        providerId: "macro-calendar-api",
        providerRunId: "run-001",
        sourceId: "macro-cal",
        pair: "SOL/USDC" as const,
        asOfUnixMs: 1704067200000,
        license: "CC0-1.0",
        retention: "bounded" as const,
        confirmationLevel: "explicit" as const,
        events: [
          {
            eventId: "macro-cal-001",
            eventType: "scheduled_event",
            scheduledUnixMs: 1704153600000,
            sourceReferences: []
          }
        ]
      };

      eventSource.setResponse(snapshot);

      await collectScheduledEvents(
        { eventSource, rawObservationRepo: rawRepo, normalizedObservationRepo: normRepo },
        VALID_CONTEXT
      );

      const rawRows = [...rawRepo["store"].values()];
      expect(rawRows.length).toBe(1);
      const rawId = rawRows[0]!.id;

      const normRows = [...normRepo["store"]];
      expect(normRows.length).toBeGreaterThan(0);
      for (const normRow of normRows) {
        expect(normRow.rawObservationId).toBe(rawId);
      }
    });

    it("multiple events from one snapshot insert atomically through insertMany", async () => {
      const rawRepo = new FakeObservationRepo();
      const normRepo = new FakeNormalizedObservationRepo();
      const eventSource = new FakeScheduledEventSource();

      const snapshot = {
        providerId: "macro-calendar-api",
        providerRunId: "run-001",
        sourceId: "macro-cal",
        pair: "SOL/USDC" as const,
        asOfUnixMs: 1704067200000,
        license: "CC0-1.0",
        retention: "bounded" as const,
        confirmationLevel: "explicit" as const,
        events: [
          {
            eventId: "event-001",
            eventType: "scheduled_event",
            scheduledUnixMs: 1704153600000,
            sourceReferences: []
          },
          {
            eventId: "event-002",
            eventType: "scheduled_event",
            scheduledUnixMs: 1704240000000,
            sourceReferences: []
          }
        ]
      };

      eventSource.setResponse(snapshot);

      const normInsertCounts: number[] = [];
      const originalInsertMany = normRepo.insertMany.bind(normRepo);
      normRepo.insertMany = async (rows) => {
        normInsertCounts.push(rows.length);
        return originalInsertMany(rows);
      };

      await collectScheduledEvents(
        { eventSource, rawObservationRepo: rawRepo, normalizedObservationRepo: normRepo },
        VALID_CONTEXT
      );

      expect(normInsertCounts.length).toBe(1);
      expect(normInsertCounts[0]).toBeGreaterThanOrEqual(2);
    });
  });

  describe("source timestamps differ from retrieval timestamps", () => {
    it("sourceObservedAtUnixMs differs from fetchedAtUnixMs in raw observation", async () => {
      const rawRepo = new FakeObservationRepo();
      const normRepo = new FakeNormalizedObservationRepo();
      const eventSource = new FakeScheduledEventSource();

      const sourceObservedAt = 1704067200000;
      const retrievedAt = 1704067200100;

      const snapshot = {
        providerId: "macro-calendar-api",
        providerRunId: "run-001",
        sourceId: "macro-cal",
        pair: "SOL/USDC" as const,
        asOfUnixMs: sourceObservedAt,
        license: "CC0-1.0",
        retention: "bounded" as const,
        confirmationLevel: "explicit" as const,
        events: [
          {
            eventId: "macro-cal-001",
            eventType: "scheduled_event",
            scheduledUnixMs: 1704153600000,
            sourceReferences: []
          }
        ]
      };

      eventSource.setResponse(snapshot);

      const contextWithDifferentRetrievalTime: CollectionRunContext = {
        ...VALID_CONTEXT,
        startedAtUnixMs: retrievedAt
      };

      await collectScheduledEvents(
        { eventSource, rawObservationRepo: rawRepo, normalizedObservationRepo: normRepo },
        contextWithDifferentRetrievalTime
      );

      const rawRows = [...rawRepo["store"].values()];
      expect(rawRows.length).toBe(1);
      expect(rawRows[0]!.observedAtUnixMs).toBe(sourceObservedAt);
      expect(rawRows[0]!.fetchedAtUnixMs).toBe(retrievedAt);
      expect(rawRows[0]!.observedAtUnixMs).not.toBe(rawRows[0]!.fetchedAtUnixMs);
    });
  });

  describe("malformed snapshots write nothing", () => {
    it("malformed snapshot throws and writes no raw or normalized rows", async () => {
      const rawRepo = new FakeObservationRepo();
      const normRepo = new FakeNormalizedObservationRepo();
      const eventSource = new FakeScheduledEventSource();

      eventSource.setError({ kind: "malformed", diagnostic: "Invalid JSON schema" });

      const result = await collectScheduledEvents(
        { eventSource, rawObservationRepo: rawRepo, normalizedObservationRepo: normRepo },
        VALID_CONTEXT
      );

      expect(result.status).toBe("malformed");
      expect([...rawRepo["store"].values()].length).toBe(0);
      expect(normRepo.count).toBe(0);
    });
  });

  describe("partial-invalid records retain accepted bounded snapshot", () => {
    it("partial-invalid records return warnings without fabricating normalized data", async () => {
      const rawRepo = new FakeObservationRepo();
      const normRepo = new FakeNormalizedObservationRepo();

      const context: CollectionRunContext = {
        runId: "run-001",
        startedAtUnixMs: 1704067200000
      };

      const result = await collectContextEvents(
        { rawObservationRepo: rawRepo, normalizedObservationRepo: normRepo },
        context,
        {
          source: "macro-calendar-api",
          sourceObservationKey: "key-partial-invalid-1",
          observedAtUnixMs: 1704067200000,
          fetchedAtUnixMs: 1704067200000,
          payloadCanonical: "{}",
          payloadHash: "hash123",
          validatePayload: (canonical: string) => JSON.parse(canonical) as unknown,
          buildCandidates: () => [
            {
              sourceEventId: "event-001",
              eventFamily: "macro_protocol_risk",
              eventType: "scheduled_event",
              title: "Test Event",
              description: "Desc",
              asOfUnixMs: 1704067200000,
              expiresAtUnixMs: 1704153600000,
              scheduledStartUnixMs: 1704153600000,
              scheduledEndUnixMs: null,
              severity: "MEDIUM",
              status: "SCHEDULED",
              affectedScope: ["SOL/USDC"],
              sourceReferences: [],
              sourceQuality: {
                providerId: "test-provider",
                reliability: 0.85,
                completeness: "partial",
                confirmation: "none"
              },
              rawProvenance: {
                sourceObservedAtUnixMs: 1704067200000,
                retrievedAtUnixMs: 1704067200000,
                retentionMode: "bounded_factual_extract",
                license: "CC0-1.0"
              },
              warnings: ["missing_qualifying_confirmation", "incomplete_information"]
            }
          ],
          enrichCandidates: async (candidates, rawRow) => {
            const enriched: EnrichedContextEventObservation[] = [];
            for (const candidate of candidates) {
              const e = await enrichContextEvent({
                payload: candidate as ScheduledEventPayloadV1,
                source: "macro-calendar-api",
                rawId: rawRow.id,
                nowMs: 1704067200000,
                codeVersion: "v1",
                runId: "run-001"
              });
              enriched.push(e);
            }
            return enriched;
          }
        }
      );

      expect(result.status).toBe("degraded");
      expect(result.normalizedCount).toBe(1);
      expect(result.warnings).toEqual([
        "missing_qualifying_confirmation",
        "incomplete_information"
      ]);
    });

    it("stale snapshot returns stale status with warnings", async () => {
      const rawRepo = new FakeObservationRepo();
      const normRepo = new FakeNormalizedObservationRepo();
      const eventSource = new FakeScheduledEventSource();

      const staleAsOfMs = VALID_CONTEXT.startedAtUnixMs - 16 * 60 * 1000;

      const snapshot = {
        providerId: "macro-calendar-api",
        providerRunId: "run-001",
        sourceId: "macro-cal",
        pair: "SOL/USDC" as const,
        asOfUnixMs: staleAsOfMs,
        license: "CC0-1.0",
        retention: "bounded" as const,
        confirmationLevel: "explicit" as const,
        events: [
          {
            eventId: "macro-cal-001",
            eventType: "scheduled_event",
            scheduledUnixMs: 1704153600000,
            sourceReferences: []
          }
        ]
      };

      eventSource.setResponse(snapshot);

      const result = await collectScheduledEvents(
        { eventSource, rawObservationRepo: rawRepo, normalizedObservationRepo: normRepo },
        VALID_CONTEXT
      );

      expect(result.status).toBe("stale");
      expect(result.normalizedCount).toBeGreaterThan(0);
      expect(result.warnings).toContain("stale_observation");
    });
  });
});
