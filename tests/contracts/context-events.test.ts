import { describe, it, expect } from "vitest";
import type {
  ContextEventStatus,
  ContextEventSeverity,
  ContextEventWarning,
  ContextEventSourceQuality,
  ContextEventRawProvenance,
  ScheduledEventPayloadV1,
  ProtocolIncidentPayloadV1
} from "../../src/contracts/context-events.js";

describe("Context Events Contract Types", () => {
  describe("ContextEventStatus", () => {
    const validStatuses: ContextEventStatus[] = [
      "SCHEDULED",
      "ACTIVE",
      "RESOLVED",
      "CANCELLED",
      "UNCONFIRMED"
    ];

    it.each(validStatuses)("'%s' is a valid ContextEventStatus", (status) => {
      expect(validStatuses).toContain(status);
    });
  });

  describe("ContextEventSeverity", () => {
    const validSeverities: ContextEventSeverity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

    it.each(validSeverities)("'%s' is a valid ContextEventSeverity", (severity) => {
      expect(validSeverities).toContain(severity);
    });
  });

  describe("ContextEventWarning", () => {
    const validWarnings: ContextEventWarning[] = [
      "conflicting_times",
      "source_disagreement",
      "incomplete_information",
      "missing_qualifying_confirmation",
      "postponed",
      "stale_observation"
    ];

    it.each(validWarnings)("'%s' is a valid ContextEventWarning", (warning) => {
      expect(validWarnings).toContain(warning);
    });
  });

  describe("ContextEventSourceQuality", () => {
    it("has required fields", () => {
      const quality: ContextEventSourceQuality = {
        providerId: "test-provider",
        reliability: 0.95,
        completeness: "complete",
        confirmation: "official"
      };
      expect(quality.providerId).toBe("test-provider");
      expect(quality.reliability).toBe(0.95);
      expect(quality.completeness).toBe("complete");
      expect(quality.confirmation).toBe("official");
    });

    it("accepts partial completeness", () => {
      const quality: ContextEventSourceQuality = {
        providerId: "test-provider",
        reliability: 0.8,
        completeness: "partial",
        confirmation: "primary"
      };
      expect(quality.completeness).toBe("partial");
    });

    it("accepts secondary confirmation", () => {
      const quality: ContextEventSourceQuality = {
        providerId: "test-provider",
        reliability: 0.7,
        completeness: "complete",
        confirmation: "secondary"
      };
      expect(quality.confirmation).toBe("secondary");
    });

    it("accepts no confirmation", () => {
      const quality: ContextEventSourceQuality = {
        providerId: "test-provider",
        reliability: 0.5,
        completeness: "partial",
        confirmation: "none"
      };
      expect(quality.confirmation).toBe("none");
    });

    it("has readonly fields at type level", () => {
      const quality: ContextEventSourceQuality = {
        providerId: "test-provider",
        reliability: 0.95,
        completeness: "complete",
        confirmation: "official"
      };
      expect(quality.providerId).toBe("test-provider");
    });
  });

  describe("ContextEventRawProvenance", () => {
    it("has required fields", () => {
      const provenance: ContextEventRawProvenance = {
        sourceObservedAtUnixMs: 1718900000000,
        retrievedAtUnixMs: 1718900001000,
        retentionMode: "bounded_factual_extract",
        license: "MIT"
      };
      expect(provenance.sourceObservedAtUnixMs).toBe(1718900000000);
      expect(provenance.retrievedAtUnixMs).toBe(1718900001000);
      expect(provenance.retentionMode).toBe("bounded_factual_extract");
      expect(provenance.license).toBe("MIT");
    });

    it("has readonly fields at type level", () => {
      const provenance: ContextEventRawProvenance = {
        sourceObservedAtUnixMs: 1718900000000,
        retrievedAtUnixMs: 1718900001000,
        retentionMode: "bounded_factual_extract",
        license: "MIT"
      };
      expect(provenance.sourceObservedAtUnixMs).toBe(1718900000000);
    });
  });
});

describe("ScheduledEventPayloadV1", () => {
  const createValidScheduledEvent = (overrides = {}): ScheduledEventPayloadV1 => ({
    sourceEventId: "evt-123",
    eventFamily: "macro_protocol_risk",
    eventType: "scheduled_event",
    title: "Test Event",
    description: "A test scheduled event",
    asOfUnixMs: 1718900000000,
    expiresAtUnixMs: 1718986400000,
    scheduledStartUnixMs: 1718900100000,
    scheduledEndUnixMs: null,
    severity: "MEDIUM",
    status: "SCHEDULED",
    affectedScope: ["sol-usdc-clmm"],
    sourceReferences: [],
    sourceQuality: {
      providerId: "test-provider",
      reliability: 0.9,
      completeness: "complete",
      confirmation: "official"
    },
    rawProvenance: {
      sourceObservedAtUnixMs: 1718900000000,
      retrievedAtUnixMs: 1718900001000,
      retentionMode: "bounded_factual_extract",
      license: "MIT"
    },
    warnings: [],
    ...overrides
  });

  it("requires scheduled timestamps for scheduled event payloads", () => {
    const event = createValidScheduledEvent({
      scheduledStartUnixMs: 1718900100000,
      scheduledEndUnixMs: null
    });
    expect(event.scheduledStartUnixMs).toBeDefined();
    expect(typeof event.scheduledStartUnixMs).toBe("number");
  });

  it("accepts null scheduledEndUnixMs", () => {
    const event = createValidScheduledEvent({
      scheduledEndUnixMs: null
    });
    expect(event.scheduledEndUnixMs).toBeNull();
  });

  it("accepts numeric scheduledEndUnixMs", () => {
    const event = createValidScheduledEvent({
      scheduledEndUnixMs: 1718901000000
    });
    expect(event.scheduledEndUnixMs).toBe(1718901000000);
  });

  it("has all required fields", () => {
    const event = createValidScheduledEvent();
    expect(event.sourceEventId).toBe("evt-123");
    expect(event.eventFamily).toBe("macro_protocol_risk");
    expect(event.eventType).toBe("scheduled_event");
    expect(event.title).toBe("Test Event");
    expect(event.description).toBe("A test scheduled event");
    expect(event.asOfUnixMs).toBe(1718900000000);
    expect(event.expiresAtUnixMs).toBe(1718986400000);
    expect(event.severity).toBe("MEDIUM");
    expect(event.status).toBe("SCHEDULED");
    expect(event.affectedScope).toEqual(["sol-usdc-clmm"]);
    expect(event.sourceReferences).toEqual([]);
    expect(event.sourceQuality).toBeDefined();
    expect(event.rawProvenance).toBeDefined();
    expect(event.warnings).toEqual([]);
  });

  it("rejects unknown fields", () => {
    const event = createValidScheduledEvent();
    expect(event).not.toHaveProperty("unknownField");
  });

  it("discriminates by eventType = scheduled_event", () => {
    const event = createValidScheduledEvent();
    expect(event.eventType).toBe("scheduled_event");
  });

  it("accepts all valid status values", () => {
    const statuses: ContextEventStatus[] = [
      "SCHEDULED",
      "ACTIVE",
      "RESOLVED",
      "CANCELLED",
      "UNCONFIRMED"
    ];
    for (const status of statuses) {
      const event = createValidScheduledEvent({ status });
      expect(event.status).toBe(status);
    }
  });

  it("accepts all valid severity values", () => {
    const severities: ContextEventSeverity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
    for (const severity of severities) {
      const event = createValidScheduledEvent({ severity });
      expect(event.severity).toBe(severity);
    }
  });

  it("accepts warning codes", () => {
    const warnings: ContextEventWarning[] = [
      "conflicting_times",
      "source_disagreement",
      "incomplete_information",
      "missing_qualifying_confirmation",
      "postponed",
      "stale_observation"
    ];
    const event = createValidScheduledEvent({ warnings });
    expect(event.warnings).toEqual(warnings);
  });
});

describe("ProtocolIncidentPayloadV1", () => {
  const createValidIncident = (overrides = {}): ProtocolIncidentPayloadV1 => ({
    sourceEventId: "inc-456",
    eventFamily: "macro_protocol_risk",
    eventType: "protocol_incident",
    title: "Test Incident",
    description: "A test protocol incident",
    asOfUnixMs: 1718900000000,
    expiresAtUnixMs: 1718986400000,
    detectedAtUnixMs: 1718900000000,
    resolvedAtUnixMs: null,
    severity: "HIGH",
    status: "ACTIVE",
    affectedScope: ["sol-usdc-clmm"],
    sourceReferences: [],
    sourceQuality: {
      providerId: "test-provider",
      reliability: 0.9,
      completeness: "complete",
      confirmation: "official"
    },
    rawProvenance: {
      sourceObservedAtUnixMs: 1718900000000,
      retrievedAtUnixMs: 1718900001000,
      retentionMode: "bounded_factual_extract",
      license: "MIT"
    },
    warnings: [],
    ...overrides
  });

  it("requires detected timestamps for protocol incident payloads", () => {
    const incident = createValidIncident({
      detectedAtUnixMs: 1718900000000,
      resolvedAtUnixMs: null
    });
    expect(incident.detectedAtUnixMs).toBeDefined();
    expect(typeof incident.detectedAtUnixMs).toBe("number");
  });

  it("accepts null resolvedAtUnixMs", () => {
    const incident = createValidIncident({
      resolvedAtUnixMs: null
    });
    expect(incident.resolvedAtUnixMs).toBeNull();
  });

  it("accepts numeric resolvedAtUnixMs", () => {
    const incident = createValidIncident({
      resolvedAtUnixMs: 1718901000000
    });
    expect(incident.resolvedAtUnixMs).toBe(1718901000000);
  });

  it("has all required fields", () => {
    const incident = createValidIncident();
    expect(incident.sourceEventId).toBe("inc-456");
    expect(incident.eventFamily).toBe("macro_protocol_risk");
    expect(incident.eventType).toBe("protocol_incident");
    expect(incident.title).toBe("Test Incident");
    expect(incident.description).toBe("A test protocol incident");
    expect(incident.asOfUnixMs).toBe(1718900000000);
    expect(incident.expiresAtUnixMs).toBe(1718986400000);
    expect(incident.severity).toBe("HIGH");
    expect(incident.status).toBe("ACTIVE");
    expect(incident.affectedScope).toEqual(["sol-usdc-clmm"]);
    expect(incident.sourceReferences).toEqual([]);
    expect(incident.sourceQuality).toBeDefined();
    expect(incident.rawProvenance).toBeDefined();
    expect(incident.warnings).toEqual([]);
  });

  it("rejects unknown fields", () => {
    const incident = createValidIncident();
    expect(incident).not.toHaveProperty("unknownField");
  });

  it("discriminates by eventType = protocol_incident", () => {
    const incident = createValidIncident();
    expect(incident.eventType).toBe("protocol_incident");
  });

  it("accepts all valid status values", () => {
    const statuses: ContextEventStatus[] = [
      "SCHEDULED",
      "ACTIVE",
      "RESOLVED",
      "CANCELLED",
      "UNCONFIRMED"
    ];
    for (const status of statuses) {
      const incident = createValidIncident({ status });
      expect(incident.status).toBe(status);
    }
  });

  it("accepts all valid severity values", () => {
    const severities: ContextEventSeverity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
    for (const severity of severities) {
      const incident = createValidIncident({ severity });
      expect(incident.severity).toBe(severity);
    }
  });

  it("accepts warning codes", () => {
    const warnings: ContextEventWarning[] = [
      "conflicting_times",
      "source_disagreement",
      "incomplete_information",
      "missing_qualifying_confirmation",
      "postponed",
      "stale_observation"
    ];
    const incident = createValidIncident({ warnings });
    expect(incident.warnings).toEqual(warnings);
  });
});

describe("Discriminated union behavior", () => {
  it("scheduled events have scheduledStartUnixMs but not detectedAtUnixMs", () => {
    const scheduledEvent = {
      sourceEventId: "evt-123",
      eventFamily: "macro_protocol_risk",
      eventType: "scheduled_event" as const,
      title: "Test",
      description: "Test",
      asOfUnixMs: 1718900000000,
      expiresAtUnixMs: 1718986400000,
      scheduledStartUnixMs: 1718900100000,
      scheduledEndUnixMs: null,
      severity: "MEDIUM" as const,
      status: "SCHEDULED" as const,
      affectedScope: ["sol-usdc-clmm"],
      sourceReferences: [],
      sourceQuality: {
        providerId: "test",
        reliability: 0.9,
        completeness: "complete" as const,
        confirmation: "official" as const
      },
      rawProvenance: {
        sourceObservedAtUnixMs: 1718900000000,
        retrievedAtUnixMs: 1718900001000,
        retentionMode: "bounded_factual_extract" as const,
        license: "MIT"
      },
      warnings: []
    };

    expect(scheduledEvent).toHaveProperty("scheduledStartUnixMs");
    expect(scheduledEvent).not.toHaveProperty("detectedAtUnixMs");
  });

  it("protocol incidents have detectedAtUnixMs but not scheduledStartUnixMs", () => {
    const incident = {
      sourceEventId: "inc-456",
      eventFamily: "macro_protocol_risk",
      eventType: "protocol_incident" as const,
      title: "Test",
      description: "Test",
      asOfUnixMs: 1718900000000,
      expiresAtUnixMs: 1718986400000,
      detectedAtUnixMs: 1718900000000,
      resolvedAtUnixMs: null,
      severity: "HIGH" as const,
      status: "ACTIVE" as const,
      affectedScope: ["sol-usdc-clmm"],
      sourceReferences: [],
      sourceQuality: {
        providerId: "test",
        reliability: 0.9,
        completeness: "complete" as const,
        confirmation: "official" as const
      },
      rawProvenance: {
        sourceObservedAtUnixMs: 1718900000000,
        retrievedAtUnixMs: 1718900001000,
        retentionMode: "bounded_factual_extract" as const,
        license: "MIT"
      },
      warnings: []
    };

    expect(incident).toHaveProperty("detectedAtUnixMs");
    expect(incident).not.toHaveProperty("scheduledStartUnixMs");
  });
});
