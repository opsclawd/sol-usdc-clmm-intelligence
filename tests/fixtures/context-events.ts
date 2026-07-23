import type {
  ContextEventStatus,
  ContextEventSeverity,
  ContextEventSourceQuality,
  ContextEventRawProvenance,
  ScheduledEventPayloadV1,
  ProtocolIncidentPayloadV1
} from "../../src/contracts/context-events.js";

export interface ScheduledEventSnapshot {
  providerId: string;
  providerSourceEventId: string;
  title: string;
  description: string;
  scheduledStartUnixMs: number;
  scheduledEndUnixMs: number | null;
  severity: ContextEventSeverity;
  status: ContextEventStatus;
  sourceReferences: readonly unknown[];
  affectedScope: readonly string[];
  sourceQuality: ContextEventSourceQuality;
  sourceObservedAtUnixMs: number;
}

export interface ProtocolIncidentSnapshot {
  providerId: string;
  providerSourceEventId: string;
  title: string;
  description: string;
  detectedAtUnixMs: number;
  resolvedAtUnixMs: number | null;
  severity: ContextEventSeverity;
  status: ContextEventStatus;
  sourceReferences: readonly unknown[];
  affectedScope: readonly string[];
  sourceQuality: ContextEventSourceQuality;
  sourceObservedAtUnixMs: number;
}

export function makeSourceQuality(
  overrides?: Partial<ContextEventSourceQuality>
): ContextEventSourceQuality {
  return {
    providerId: "test-provider",
    reliability: 0.85,
    completeness: "complete",
    confirmation: "primary",
    ...overrides
  };
}

export function makeRawProvenance(
  overrides?: Partial<ContextEventRawProvenance>
): ContextEventRawProvenance {
  return {
    sourceObservedAtUnixMs: 1700000000000,
    retrievedAtUnixMs: 1700000001000,
    retentionMode: "bounded_factual_extract",
    license: "CC0-1.0",
    ...overrides
  };
}

export function makeScheduledEventPayload(
  overrides?: Partial<ScheduledEventPayloadV1>
): ScheduledEventPayloadV1 {
  const now = Date.now();
  return {
    sourceEventId: "sched-event-001",
    eventFamily: "macro_protocol_risk",
    eventType: "scheduled_event",
    title: "Test Scheduled Event",
    description: "A test scheduled event for unit testing",
    asOfUnixMs: now,
    expiresAtUnixMs: now + 86400000,
    scheduledStartUnixMs: now + 3600000,
    scheduledEndUnixMs: null,
    severity: "MEDIUM",
    status: "SCHEDULED",
    affectedScope: ["SOL", "USDC"],
    sourceReferences: [],
    sourceQuality: makeSourceQuality(),
    rawProvenance: makeRawProvenance(),
    warnings: [],
    ...overrides
  };
}

export function makeProtocolIncidentPayload(
  overrides?: Partial<ProtocolIncidentPayloadV1>
): ProtocolIncidentPayloadV1 {
  const now = Date.now();
  return {
    sourceEventId: "protocol-incident-001",
    eventFamily: "macro_protocol_risk",
    eventType: "protocol_incident",
    title: "Test Protocol Incident",
    description: "A test protocol incident for unit testing",
    asOfUnixMs: now,
    expiresAtUnixMs: now + 86400000,
    detectedAtUnixMs: now - 3600000,
    resolvedAtUnixMs: null,
    severity: "HIGH",
    status: "ACTIVE",
    affectedScope: ["SOL", "USDC"],
    sourceReferences: [],
    sourceQuality: makeSourceQuality(),
    rawProvenance: makeRawProvenance(),
    warnings: [],
    ...overrides
  };
}

export function makeScheduledEventSnapshot(
  overrides?: Partial<ScheduledEventSnapshot>
): ScheduledEventSnapshot {
  const now = Date.now();
  return {
    providerId: "macro-calendar-api",
    providerSourceEventId: "macro-cal-001",
    title: "Test Scheduled Event",
    description: "A test scheduled event for unit testing",
    scheduledStartUnixMs: now + 86400000,
    scheduledEndUnixMs: null,
    severity: "MEDIUM",
    status: "SCHEDULED",
    sourceReferences: [],
    affectedScope: ["SOL"],
    sourceQuality: makeSourceQuality({ providerId: "macro-calendar-api" }),
    sourceObservedAtUnixMs: now,
    ...overrides
  };
}

export function makeProtocolIncidentSnapshot(
  overrides?: Partial<ProtocolIncidentSnapshot>
): ProtocolIncidentSnapshot {
  const now = Date.now();
  return {
    providerId: "solana-status-api",
    providerSourceEventId: "solana-status-001",
    title: "Test Protocol Incident",
    description: "A test protocol incident for unit testing",
    detectedAtUnixMs: now - 3600000,
    resolvedAtUnixMs: null,
    severity: "HIGH",
    status: "UNCONFIRMED",
    sourceReferences: [],
    affectedScope: ["SOL"],
    sourceQuality: makeSourceQuality({ providerId: "solana-status-api" }),
    sourceObservedAtUnixMs: now,
    ...overrides
  };
}

export interface BoundedScheduledEventSnapshot {
  providerId: string;
  providerSourceEventId: string;
  source: "macro-calendar-api";
  payloadHash: string;
  snapshot: ScheduledEventSnapshot;
  sourceObservedAtUnixMs: number;
  retrievedAtUnixMs: number;
}

export interface BoundedProtocolIncidentSnapshot {
  providerId: string;
  providerSourceEventId: string;
  source: "solana-status-api";
  payloadHash: string;
  snapshot: ProtocolIncidentSnapshot;
  sourceObservedAtUnixMs: number;
  retrievedAtUnixMs: number;
}

export function makeBoundedScheduledEventSnapshot(
  overrides?: Partial<BoundedScheduledEventSnapshot>
): BoundedScheduledEventSnapshot {
  const now = Date.now();
  const snapshot = makeScheduledEventSnapshot();
  return {
    providerId: "macro-calendar-api",
    providerSourceEventId: snapshot.providerSourceEventId,
    source: "macro-calendar-api",
    payloadHash: "abc123def456",
    snapshot,
    sourceObservedAtUnixMs: now,
    retrievedAtUnixMs: now + 100,
    ...overrides
  };
}

export function makeBoundedProtocolIncidentSnapshot(
  overrides?: Partial<BoundedProtocolIncidentSnapshot>
): BoundedProtocolIncidentSnapshot {
  const now = Date.now();
  const snapshot = makeProtocolIncidentSnapshot();
  return {
    providerId: "solana-status-api",
    providerSourceEventId: snapshot.providerSourceEventId,
    source: "solana-status-api",
    payloadHash: "xyz789ghi012",
    snapshot,
    sourceObservedAtUnixMs: now,
    retrievedAtUnixMs: now + 100,
    ...overrides
  };
}
