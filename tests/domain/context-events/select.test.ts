import { describe, it, expect } from "vitest";
import type {
  NormalizedObservationRow,
  ScheduledEventPayloadV1,
  ProtocolIncidentPayloadV1
} from "../../../src/contracts/index.js";
import { makeNormalizedRow } from "../../helpers/derived-feature-fixtures.js";
import { selectCurrentContextEvents } from "../../../src/domain/context-events/select.js";

function makeContextRow(
  overrides: Partial<NormalizedObservationRow> & {
    id: number;
    source: "macro-calendar-api" | "solana-status-api";
    observationKind: "scheduled_event" | "protocol_incident";
    receivedAtUnixMs: number;
    payload: ScheduledEventPayloadV1 | ProtocolIncidentPayloadV1;
  }
): NormalizedObservationRow {
  return makeNormalizedRow({
    signalClass: "contextual",
    evidenceFamily: "macro_protocol_risk",
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
    ...overrides
  } as Partial<NormalizedObservationRow> & {
    id: number;
    source: string;
    observationKind: string;
    receivedAtUnixMs: number;
  });
}

describe("context-events/select", () => {
  describe("selection invariants", () => {
    it("cancellation becomes the latest state and suppresses older scheduled evidence", () => {
      const now = 1000000000000;
      const evaluationTime = now + 100;

      const olderScheduled = makeContextRow({
        id: 1,
        source: "macro-calendar-api",
        observationKind: "scheduled_event",
        receivedAtUnixMs: now,
        payload: {
          sourceEventId: "event-001",
          eventFamily: "macro_protocol_risk",
          eventType: "scheduled_event",
          title: "Scheduled",
          description: "Test",
          asOfUnixMs: now,
          expiresAtUnixMs: now + 86400000,
          scheduledStartUnixMs: now + 3600000,
          scheduledEndUnixMs: null,
          severity: "MEDIUM",
          status: "SCHEDULED",
          affectedScope: ["SOL"],
          sourceReferences: [],
          sourceQuality: {
            providerId: "macro-calendar-api",
            reliability: 0.9,
            completeness: "complete",
            confirmation: "primary"
          },
          rawProvenance: {
            sourceObservedAtUnixMs: now,
            retrievedAtUnixMs: now,
            retentionMode: "bounded_factual_extract",
            license: "CC0-1.0"
          },
          warnings: []
        } as ScheduledEventPayloadV1
      });

      const latestCancelled = makeContextRow({
        id: 2,
        source: "macro-calendar-api",
        observationKind: "scheduled_event",
        receivedAtUnixMs: now + 200,
        payload: {
          sourceEventId: "event-001",
          eventFamily: "macro_protocol_risk",
          eventType: "scheduled_event",
          title: "Cancelled",
          description: "Test",
          asOfUnixMs: now + 100,
          expiresAtUnixMs: now + 86400000,
          scheduledStartUnixMs: now + 3600000,
          scheduledEndUnixMs: null,
          severity: "MEDIUM",
          status: "CANCELLED",
          affectedScope: ["SOL"],
          sourceReferences: [],
          sourceQuality: {
            providerId: "macro-calendar-api",
            reliability: 0.9,
            completeness: "complete",
            confirmation: "primary"
          },
          rawProvenance: {
            sourceObservedAtUnixMs: now + 100,
            retrievedAtUnixMs: now + 100,
            retentionMode: "bounded_factual_extract",
            license: "CC0-1.0"
          },
          warnings: []
        } as ScheduledEventPayloadV1
      });

      const result = selectCurrentContextEvents({
        evaluationTimeUnixMs: evaluationTime,
        candidates: [olderScheduled, latestCancelled],
        maxItems: 64
      });

      expect(result).toHaveLength(0);
    });

    it("incident resolution replaces active state until recovery expiry", () => {
      const now = 1000000000000;

      const activeIncident = makeContextRow({
        id: 1,
        source: "solana-status-api",
        observationKind: "protocol_incident",
        receivedAtUnixMs: now,
        payload: {
          sourceEventId: "incident-001",
          eventFamily: "macro_protocol_risk",
          eventType: "protocol_incident",
          title: "Active Incident",
          description: "Test",
          asOfUnixMs: now - 3600000,
          expiresAtUnixMs: now + 86400000,
          detectedAtUnixMs: now - 3600000,
          resolvedAtUnixMs: null,
          severity: "HIGH",
          status: "ACTIVE",
          affectedScope: ["SOL"],
          sourceReferences: [],
          sourceQuality: {
            providerId: "solana-status-api",
            reliability: 0.9,
            completeness: "complete",
            confirmation: "primary"
          },
          rawProvenance: {
            sourceObservedAtUnixMs: now - 3600000,
            retrievedAtUnixMs: now,
            retentionMode: "bounded_factual_extract",
            license: "CC0-1.0"
          },
          warnings: []
        } as ProtocolIncidentPayloadV1
      });

      const recoveryExpiry = now + 900000;
      const resolvedIncident = makeContextRow({
        id: 2,
        source: "solana-status-api",
        observationKind: "protocol_incident",
        receivedAtUnixMs: now + 200,
        validUntilUnixMs: recoveryExpiry,
        payload: {
          sourceEventId: "incident-001",
          eventFamily: "macro_protocol_risk",
          eventType: "protocol_incident",
          title: "Resolved Incident",
          description: "Test",
          asOfUnixMs: now,
          expiresAtUnixMs: recoveryExpiry,
          detectedAtUnixMs: now - 3600000,
          resolvedAtUnixMs: now,
          severity: "HIGH",
          status: "RESOLVED",
          affectedScope: ["SOL"],
          sourceReferences: [],
          sourceQuality: {
            providerId: "solana-status-api",
            reliability: 0.9,
            completeness: "complete",
            confirmation: "primary"
          },
          rawProvenance: {
            sourceObservedAtUnixMs: now,
            retrievedAtUnixMs: now + 100,
            retentionMode: "bounded_factual_extract",
            license: "CC0-1.0"
          },
          warnings: []
        } as ProtocolIncidentPayloadV1
      });

      const resultBeforeExpiry = selectCurrentContextEvents({
        evaluationTimeUnixMs: now + 100,
        candidates: [activeIncident, resolvedIncident],
        maxItems: 64
      });

      expect(resultBeforeExpiry).toHaveLength(1);
      expect((resultBeforeExpiry[0]!.payload as ProtocolIncidentPayloadV1).status).toBe("RESOLVED");

      const resultAfterExpiry = selectCurrentContextEvents({
        evaluationTimeUnixMs: recoveryExpiry + 100,
        candidates: [activeIncident, resolvedIncident],
        maxItems: 64
      });

      expect(resultAfterExpiry).toHaveLength(0);
    });

    it("latest ineligible state never revives older active state", () => {
      const now = 1000000000000;
      const evaluationTime = now + 100;

      const olderActive = makeContextRow({
        id: 1,
        source: "solana-status-api",
        observationKind: "protocol_incident",
        receivedAtUnixMs: now,
        isStale: false,
        payload: {
          sourceEventId: "incident-002",
          eventFamily: "macro_protocol_risk",
          eventType: "protocol_incident",
          title: "Active Incident",
          description: "Test",
          asOfUnixMs: now - 3600000,
          expiresAtUnixMs: now + 86400000,
          detectedAtUnixMs: now - 3600000,
          resolvedAtUnixMs: null,
          severity: "HIGH",
          status: "ACTIVE",
          affectedScope: ["SOL"],
          sourceReferences: [],
          sourceQuality: {
            providerId: "solana-status-api",
            reliability: 0.9,
            completeness: "complete",
            confirmation: "primary"
          },
          rawProvenance: {
            sourceObservedAtUnixMs: now - 3600000,
            retrievedAtUnixMs: now,
            retentionMode: "bounded_factual_extract",
            license: "CC0-1.0"
          },
          warnings: []
        } as ProtocolIncidentPayloadV1
      });

      const latestUnconfirmed = makeContextRow({
        id: 2,
        source: "solana-status-api",
        observationKind: "protocol_incident",
        receivedAtUnixMs: now + 200,
        isStale: false,
        payload: {
          sourceEventId: "incident-002",
          eventFamily: "macro_protocol_risk",
          eventType: "protocol_incident",
          title: "Unconfirmed Incident",
          description: "Test",
          asOfUnixMs: now + 100,
          expiresAtUnixMs: now + 86400000,
          detectedAtUnixMs: now - 3600000,
          resolvedAtUnixMs: null,
          severity: "HIGH",
          status: "UNCONFIRMED",
          affectedScope: ["SOL"],
          sourceReferences: [],
          sourceQuality: {
            providerId: "solana-status-api",
            reliability: 0.9,
            completeness: "complete",
            confirmation: "none"
          },
          rawProvenance: {
            sourceObservedAtUnixMs: now + 100,
            retrievedAtUnixMs: now + 100,
            retentionMode: "bounded_factual_extract",
            license: "CC0-1.0"
          },
          warnings: ["missing_qualifying_confirmation"]
        } as ProtocolIncidentPayloadV1
      });

      const result = selectCurrentContextEvents({
        evaluationTimeUnixMs: evaluationTime,
        candidates: [olderActive, latestUnconfirmed],
        maxItems: 64
      });

      expect(result).toHaveLength(0);
    });

    it("groups by source, kind, and sourceEventId", () => {
      const now = 1000000000000;

      const row1 = makeContextRow({
        id: 1,
        source: "macro-calendar-api",
        observationKind: "scheduled_event",
        receivedAtUnixMs: now,
        payload: {
          sourceEventId: "event-A",
          eventFamily: "macro_protocol_risk",
          eventType: "scheduled_event",
          title: "Event A",
          description: "Test",
          asOfUnixMs: now,
          expiresAtUnixMs: now + 86400000,
          scheduledStartUnixMs: now + 3600000,
          scheduledEndUnixMs: null,
          severity: "LOW",
          status: "SCHEDULED",
          affectedScope: ["SOL"],
          sourceReferences: [],
          sourceQuality: {
            providerId: "macro-calendar-api",
            reliability: 0.9,
            completeness: "complete",
            confirmation: "primary"
          },
          rawProvenance: {
            sourceObservedAtUnixMs: now,
            retrievedAtUnixMs: now,
            retentionMode: "bounded_factual_extract",
            license: "CC0-1.0"
          },
          warnings: []
        } as ScheduledEventPayloadV1
      });

      const row2 = makeContextRow({
        id: 2,
        source: "macro-calendar-api",
        observationKind: "scheduled_event",
        receivedAtUnixMs: now + 100,
        payload: {
          sourceEventId: "event-B",
          eventFamily: "macro_protocol_risk",
          eventType: "scheduled_event",
          title: "Event B",
          description: "Test",
          asOfUnixMs: now + 100,
          expiresAtUnixMs: now + 86400000,
          scheduledStartUnixMs: now + 7200000,
          scheduledEndUnixMs: null,
          severity: "HIGH",
          status: "SCHEDULED",
          affectedScope: ["SOL"],
          sourceReferences: [],
          sourceQuality: {
            providerId: "macro-calendar-api",
            reliability: 0.9,
            completeness: "complete",
            confirmation: "primary"
          },
          rawProvenance: {
            sourceObservedAtUnixMs: now + 100,
            retrievedAtUnixMs: now + 100,
            retentionMode: "bounded_factual_extract",
            license: "CC0-1.0"
          },
          warnings: []
        } as ScheduledEventPayloadV1
      });

      const result = selectCurrentContextEvents({
        evaluationTimeUnixMs: now + 200,
        candidates: [row1, row2],
        maxItems: 64
      });

      expect(result).toHaveLength(2);
    });

    it("sorts by severity rank, event time, source, source event ID, and row ID", () => {
      const now = 1000000000000;

      const lowSeverity = makeContextRow({
        id: 1,
        source: "macro-calendar-api",
        observationKind: "scheduled_event",
        receivedAtUnixMs: now,
        payload: {
          sourceEventId: "event-low",
          eventFamily: "macro_protocol_risk",
          eventType: "scheduled_event",
          title: "Low",
          description: "Test",
          asOfUnixMs: now,
          expiresAtUnixMs: now + 86400000,
          scheduledStartUnixMs: now + 3600000,
          scheduledEndUnixMs: null,
          severity: "LOW",
          status: "SCHEDULED",
          affectedScope: ["SOL"],
          sourceReferences: [],
          sourceQuality: {
            providerId: "macro-calendar-api",
            reliability: 0.9,
            completeness: "complete",
            confirmation: "primary"
          },
          rawProvenance: {
            sourceObservedAtUnixMs: now,
            retrievedAtUnixMs: now,
            retentionMode: "bounded_factual_extract",
            license: "CC0-1.0"
          },
          warnings: []
        } as ScheduledEventPayloadV1
      });

      const highSeverity = makeContextRow({
        id: 2,
        source: "solana-status-api",
        observationKind: "protocol_incident",
        receivedAtUnixMs: now + 100,
        payload: {
          sourceEventId: "incident-high",
          eventFamily: "macro_protocol_risk",
          eventType: "protocol_incident",
          title: "High",
          description: "Test",
          asOfUnixMs: now + 100,
          expiresAtUnixMs: now + 86400000,
          detectedAtUnixMs: now + 100,
          resolvedAtUnixMs: null,
          severity: "HIGH",
          status: "ACTIVE",
          affectedScope: ["SOL"],
          sourceReferences: [],
          sourceQuality: {
            providerId: "solana-status-api",
            reliability: 0.9,
            completeness: "complete",
            confirmation: "primary"
          },
          rawProvenance: {
            sourceObservedAtUnixMs: now + 100,
            retrievedAtUnixMs: now + 100,
            retentionMode: "bounded_factual_extract",
            license: "CC0-1.0"
          },
          warnings: []
        } as ProtocolIncidentPayloadV1
      });

      const result = selectCurrentContextEvents({
        evaluationTimeUnixMs: now + 200,
        candidates: [lowSeverity, highSeverity],
        maxItems: 64
      });

      expect(result).toHaveLength(2);
      expect(result[0]!.row.id).toBe(2);
      expect(result[1]!.row.id).toBe(1);
    });

    it("rejects future observations", () => {
      const now = 1000000000000;
      const evaluationTime = now + 100;

      const futureRow = makeContextRow({
        id: 1,
        source: "macro-calendar-api",
        observationKind: "scheduled_event",
        receivedAtUnixMs: now + 500,
        payload: {
          sourceEventId: "future-event",
          eventFamily: "macro_protocol_risk",
          eventType: "scheduled_event",
          title: "Future",
          description: "Test",
          asOfUnixMs: now + 500,
          expiresAtUnixMs: now + 86400000,
          scheduledStartUnixMs: now + 9000000,
          scheduledEndUnixMs: null,
          severity: "MEDIUM",
          status: "SCHEDULED",
          affectedScope: ["SOL"],
          sourceReferences: [],
          sourceQuality: {
            providerId: "macro-calendar-api",
            reliability: 0.9,
            completeness: "complete",
            confirmation: "primary"
          },
          rawProvenance: {
            sourceObservedAtUnixMs: now + 500,
            retrievedAtUnixMs: now + 500,
            retentionMode: "bounded_factual_extract",
            license: "CC0-1.0"
          },
          warnings: []
        } as ScheduledEventPayloadV1
      });

      const result = selectCurrentContextEvents({
        evaluationTimeUnixMs: evaluationTime,
        candidates: [futureRow],
        maxItems: 64
      });

      expect(result).toHaveLength(0);
    });

    it("rejects stale observations", () => {
      const now = 1000000000000;
      const evaluationTime = now + 100;

      const staleRow = makeContextRow({
        id: 1,
        source: "macro-calendar-api",
        observationKind: "scheduled_event",
        receivedAtUnixMs: now,
        isStale: true,
        payload: {
          sourceEventId: "stale-event",
          eventFamily: "macro_protocol_risk",
          eventType: "scheduled_event",
          title: "Stale",
          description: "Test",
          asOfUnixMs: now - 900000,
          expiresAtUnixMs: now + 86400000,
          scheduledStartUnixMs: now + 3600000,
          scheduledEndUnixMs: null,
          severity: "MEDIUM",
          status: "SCHEDULED",
          affectedScope: ["SOL"],
          sourceReferences: [],
          sourceQuality: {
            providerId: "macro-calendar-api",
            reliability: 0.9,
            completeness: "complete",
            confirmation: "primary"
          },
          rawProvenance: {
            sourceObservedAtUnixMs: now - 900000,
            retrievedAtUnixMs: now - 900000,
            retentionMode: "bounded_factual_extract",
            license: "CC0-1.0"
          },
          warnings: []
        } as ScheduledEventPayloadV1
      });

      const result = selectCurrentContextEvents({
        evaluationTimeUnixMs: evaluationTime,
        candidates: [staleRow],
        maxItems: 64
      });

      expect(result).toHaveLength(0);
    });

    it("respects maxItems limit", () => {
      const now = 1000000000000;

      const rows: NormalizedObservationRow[] = [];
      for (let i = 0; i < 100; i++) {
        rows.push(
          makeContextRow({
            id: i + 1,
            source: "macro-calendar-api",
            observationKind: "scheduled_event",
            receivedAtUnixMs: now + i * 10,
            payload: {
              sourceEventId: `event-${i}`,
              eventFamily: "macro_protocol_risk",
              eventType: "scheduled_event",
              title: `Event ${i}`,
              description: "Test",
              asOfUnixMs: now + i * 10,
              expiresAtUnixMs: now + 86400000,
              scheduledStartUnixMs: now + 3600000 + i * 10,
              scheduledEndUnixMs: null,
              severity: "MEDIUM",
              status: "SCHEDULED",
              affectedScope: ["SOL"],
              sourceReferences: [],
              sourceQuality: {
                providerId: "macro-calendar-api",
                reliability: 0.9,
                completeness: "complete",
                confirmation: "primary"
              },
              rawProvenance: {
                sourceObservedAtUnixMs: now + i * 10,
                retrievedAtUnixMs: now + i * 10,
                retentionMode: "bounded_factual_extract",
                license: "CC0-1.0"
              },
              warnings: []
            } as ScheduledEventPayloadV1
          })
        );
      }

      const result = selectCurrentContextEvents({
        evaluationTimeUnixMs: now + 2000,
        candidates: rows,
        maxItems: 10
      });

      expect(result).toHaveLength(10);
    });

    it("handles resolved recovery evidence correctly", () => {
      const now = 1000000000000;
      const evaluationTime = now + 100;
      const recoveryExpiry = now + 900000;

      const resolvedRow = makeContextRow({
        id: 1,
        source: "solana-status-api",
        observationKind: "protocol_incident",
        receivedAtUnixMs: now + 100,
        payload: {
          sourceEventId: "incident-recovery",
          eventFamily: "macro_protocol_risk",
          eventType: "protocol_incident",
          title: "Resolved",
          description: "Test",
          asOfUnixMs: now,
          expiresAtUnixMs: recoveryExpiry,
          detectedAtUnixMs: now - 3600000,
          resolvedAtUnixMs: now,
          severity: "MEDIUM",
          status: "RESOLVED",
          affectedScope: ["SOL"],
          sourceReferences: [],
          sourceQuality: {
            providerId: "solana-status-api",
            reliability: 0.9,
            completeness: "complete",
            confirmation: "primary"
          },
          rawProvenance: {
            sourceObservedAtUnixMs: now,
            retrievedAtUnixMs: now + 100,
            retentionMode: "bounded_factual_extract",
            license: "CC0-1.0"
          },
          warnings: []
        } as ProtocolIncidentPayloadV1
      });

      const result = selectCurrentContextEvents({
        evaluationTimeUnixMs: evaluationTime,
        candidates: [resolvedRow],
        maxItems: 64
      });

      expect(result).toHaveLength(1);
      expect((result[0]!.payload as ProtocolIncidentPayloadV1).status).toBe("RESOLVED");
    });
  });
});
