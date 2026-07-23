import { describe, it, expect } from "vitest";
import {
  makeBoundedScheduledEventSnapshot,
  makeBoundedProtocolIncidentSnapshot,
  makeScheduledEventSnapshot,
  makeProtocolIncidentSnapshot,
  makeSourceQuality
} from "../../fixtures/context-events.js";
import {
  normalizeScheduledEvents,
  normalizeProtocolIncidents
} from "../../../src/domain/context-events/normalize.js";

describe("context-events/normalize", () => {
  describe("normalizeScheduledEvents", () => {
    it("normalizes a first scheduled state as SCHEDULED", () => {
      const now = Date.now();
      const snapshot = makeScheduledEventSnapshot({
        status: "SCHEDULED",
        scheduledStartUnixMs: now + 86400000,
        severity: "MEDIUM"
      });
      const bounded = makeBoundedScheduledEventSnapshot({
        snapshot,
        sourceObservedAtUnixMs: now,
        retrievedAtUnixMs: now + 100
      });
      const result = normalizeScheduledEvents(bounded, now + 50);
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe("SCHEDULED");
      expect(result[0].eventType).toBe("scheduled_event");
      expect(result[0].eventFamily).toBe("macro_protocol_risk");
    });

    it("appends a postponed scheduled state without changing sourceEventId", () => {
      const now = Date.now();
      const originalStartMs = now + 86400000;
      const postponedStartMs = now + 172800000;

      const originalSnapshot = makeScheduledEventSnapshot({
        status: "SCHEDULED",
        scheduledStartUnixMs: originalStartMs,
        providerSourceEventId: "event-001"
      });
      const postponedSnapshot = makeScheduledEventSnapshot({
        status: "SCHEDULED",
        scheduledStartUnixMs: postponedStartMs,
        providerSourceEventId: "event-001"
      });

      const bounded1 = makeBoundedScheduledEventSnapshot({
        snapshot: originalSnapshot,
        sourceObservedAtUnixMs: now,
        retrievedAtUnixMs: now + 100
      });
      const bounded2 = makeBoundedScheduledEventSnapshot({
        snapshot: postponedSnapshot,
        sourceObservedAtUnixMs: now + 200,
        retrievedAtUnixMs: now + 300
      });

      const result1 = normalizeScheduledEvents(bounded1, now + 50);
      const result2 = normalizeScheduledEvents(bounded2, now + 250);

      expect(result1).toHaveLength(1);
      expect(result2).toHaveLength(1);
      expect(result1[0].sourceEventId).toBe(result2[0].sourceEventId);
      expect(result1[0].scheduledStartUnixMs).toBe(originalStartMs);
      expect(result2[0].scheduledStartUnixMs).toBe(postponedStartMs);
    });

    it("produces bounded expiry for first scheduled event", () => {
      const now = Date.now();
      const scheduledStart = now + 86400000;
      const snapshot = makeScheduledEventSnapshot({
        status: "SCHEDULED",
        scheduledStartUnixMs: scheduledStart,
        expiresAtUnixMs: null as unknown as number
      });
      const bounded = makeBoundedScheduledEventSnapshot({
        snapshot,
        sourceObservedAtUnixMs: now,
        retrievedAtUnixMs: now + 100
      });
      const result = normalizeScheduledEvents(bounded, now + 50);
      expect(result[0].expiresAtUnixMs).toBeGreaterThan(now);
      expect(result[0].expiresAtUnixMs).toBeLessThanOrEqual(scheduledStart + 86400000);
    });

    it("sorts and deduplicates affectedScope", () => {
      const now = Date.now();
      const snapshot = makeScheduledEventSnapshot({
        affectedScope: ["SOL", "USDC", "SOL", "BTC"]
      });
      const bounded = makeBoundedScheduledEventSnapshot({
        snapshot,
        sourceObservedAtUnixMs: now,
        retrievedAtUnixMs: now + 100
      });
      const result = normalizeScheduledEvents(bounded, now + 50);
      expect(result[0].affectedScope).toEqual(["BTC", "SOL", "USDC"]);
    });

    it("source and retrieval timestamps remain separate", () => {
      const now = Date.now();
      const sourceObserved = now - 5000;
      const retrievedAt = now;
      const snapshot = makeScheduledEventSnapshot();
      const bounded = makeBoundedScheduledEventSnapshot({
        snapshot,
        sourceObservedAtUnixMs: sourceObserved,
        retrievedAtUnixMs: retrievedAt
      });
      const result = normalizeScheduledEvents(bounded, now);
      expect(result[0].rawProvenance.sourceObservedAtUnixMs).toBe(sourceObserved);
      expect(result[0].rawProvenance.retrievedAtUnixMs).toBe(retrievedAt);
    });

    it("bounded description length", () => {
      const now = Date.now();
      const longDescription = "A".repeat(5000);
      const snapshot = makeScheduledEventSnapshot({
        description: longDescription
      });
      const bounded = makeBoundedScheduledEventSnapshot({
        snapshot,
        sourceObservedAtUnixMs: now,
        retrievedAtUnixMs: now + 100
      });
      const result = normalizeScheduledEvents(bounded, now + 50);
      expect(result[0].description.length).toBeLessThanOrEqual(5000);
    });

    it("sorted sourceReferences output", () => {
      const now = Date.now();
      const snapshot = makeScheduledEventSnapshot({
        sourceReferences: [
          { id: 3, type: "source" },
          { id: 1, type: "source" },
          { id: 2, type: "source" }
        ]
      });
      const bounded = makeBoundedScheduledEventSnapshot({
        snapshot,
        sourceObservedAtUnixMs: now,
        retrievedAtUnixMs: now + 100
      });
      const result = normalizeScheduledEvents(bounded, now + 50);
      expect(result[0].sourceReferences).toHaveLength(3);
    });
  });

  describe("normalizeProtocolIncidents", () => {
    it("unconfirmed incident cannot become active without qualifying confirmation", () => {
      const now = Date.now();
      const snapshot = makeProtocolIncidentSnapshot({
        status: "UNCONFIRMED",
        sourceQuality: makeSourceQuality({
          confirmation: "secondary"
        })
      });
      const bounded = makeBoundedProtocolIncidentSnapshot({
        snapshot,
        sourceObservedAtUnixMs: now,
        retrievedAtUnixMs: now + 100
      });
      const result = normalizeProtocolIncidents(bounded, now + 50);
      expect(result[0].status).toBe("UNCONFIRMED");
    });

    it("qualified incident activation preserves history", () => {
      const now = Date.now();
      const unconfirmedSnapshot = makeProtocolIncidentSnapshot({
        status: "UNCONFIRMED",
        sourceQuality: makeSourceQuality({
          confirmation: "primary"
        })
      });
      const confirmedSnapshot = makeProtocolIncidentSnapshot({
        status: "ACTIVE",
        sourceQuality: makeSourceQuality({
          confirmation: "official"
        })
      });

      const bounded1 = makeBoundedProtocolIncidentSnapshot({
        snapshot: unconfirmedSnapshot,
        sourceObservedAtUnixMs: now - 1000,
        retrievedAtUnixMs: now - 900
      });
      const bounded2 = makeBoundedProtocolIncidentSnapshot({
        snapshot: confirmedSnapshot,
        sourceObservedAtUnixMs: now,
        retrievedAtUnixMs: now + 100
      });

      const result1 = normalizeProtocolIncidents(bounded1, now - 850);
      const result2 = normalizeProtocolIncidents(bounded2, now + 50);

      expect(result1[0].status).toBe("ACTIVE");
      expect(result2[0].status).toBe("ACTIVE");
      expect(result2[0].sourceEventId).toBe(result1[0].sourceEventId);
    });

    it("incident resolution replaces active state until recovery expiry", () => {
      const now = Date.now();
      const detectedAt = now - 3600000;
      const resolvedAt = now - 1800000;

      const activeSnapshot = makeProtocolIncidentSnapshot({
        status: "ACTIVE",
        detectedAtUnixMs: detectedAt,
        resolvedAtUnixMs: null
      });
      const resolvedSnapshot = makeProtocolIncidentSnapshot({
        status: "RESOLVED",
        detectedAtUnixMs: detectedAt,
        resolvedAtUnixMs: resolvedAt
      });

      const bounded1 = makeBoundedProtocolIncidentSnapshot({
        snapshot: activeSnapshot,
        sourceObservedAtUnixMs: now - 100,
        retrievedAtUnixMs: now - 50
      });
      const bounded2 = makeBoundedProtocolIncidentSnapshot({
        snapshot: resolvedSnapshot,
        sourceObservedAtUnixMs: now,
        retrievedAtUnixMs: now + 50
      });

      const result1 = normalizeProtocolIncidents(bounded1, now - 25);
      const result2 = normalizeProtocolIncidents(bounded2, now + 25);

      expect(result1[0].status).toBe("ACTIVE");
      expect(result2[0].status).toBe("RESOLVED");
      expect(result2[0].expiresAtUnixMs).toBeGreaterThanOrEqual(now);
      expect(result2[0].expiresAtUnixMs).toBeLessThanOrEqual(now + 900000);
    });

    it("detects incomplete information warning", () => {
      const now = Date.now();
      const snapshot = makeProtocolIncidentSnapshot({
        sourceQuality: makeSourceQuality({ completeness: "partial" })
      });
      const bounded = makeBoundedProtocolIncidentSnapshot({
        snapshot,
        sourceObservedAtUnixMs: now,
        retrievedAtUnixMs: now + 100
      });
      const result = normalizeProtocolIncidents(bounded, now + 50);
      expect(result[0].warnings).toContain("incomplete_information");
    });

    it("detects missing qualifying confirmation warning", () => {
      const now = Date.now();
      const snapshot = makeProtocolIncidentSnapshot({
        status: "UNCONFIRMED",
        sourceQuality: makeSourceQuality({ confirmation: "none" })
      });
      const bounded = makeBoundedProtocolIncidentSnapshot({
        snapshot,
        sourceObservedAtUnixMs: now,
        retrievedAtUnixMs: now + 100
      });
      const result = normalizeProtocolIncidents(bounded, now + 50);
      expect(result[0].warnings).toContain("missing_qualifying_confirmation");
    });

    it("resolves confidence caps for unconfirmed/partial evidence", () => {
      const now = Date.now();
      const snapshot = makeProtocolIncidentSnapshot({
        status: "UNCONFIRMED",
        sourceQuality: makeSourceQuality({
          confirmation: "secondary",
          completeness: "partial"
        })
      });
      const bounded = makeBoundedProtocolIncidentSnapshot({
        snapshot,
        sourceObservedAtUnixMs: now,
        retrievedAtUnixMs: now + 100
      });
      const result = normalizeProtocolIncidents(bounded, now + 50);
      expect(result[0].sourceQuality.confirmation).toBe("secondary");
      expect(result[0].sourceQuality.completeness).toBe("partial");
    });

    it("stale warning when sourceObservedAt is old", () => {
      const now = Date.now();
      const oldObservation = now - 900000;
      const snapshot = makeProtocolIncidentSnapshot({});
      const bounded = makeBoundedProtocolIncidentSnapshot({
        snapshot,
        sourceObservedAtUnixMs: oldObservation,
        retrievedAtUnixMs: oldObservation + 100
      });
      const result = normalizeProtocolIncidents(bounded, now);
      expect(result[0].warnings).toContain("stale_observation");
    });
  });
});
