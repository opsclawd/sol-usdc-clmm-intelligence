export type ContextEventStatus = "SCHEDULED" | "ACTIVE" | "RESOLVED" | "CANCELLED" | "UNCONFIRMED";

export type ContextEventSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type ContextEventWarning =
  | "conflicting_times"
  | "source_disagreement"
  | "incomplete_information"
  | "missing_qualifying_confirmation"
  | "postponed"
  | "stale_observation";

export type ContextEventSourceQuality = {
  readonly providerId: string;
  readonly reliability: number;
  readonly completeness: "complete" | "partial";
  readonly confirmation: "official" | "primary" | "secondary" | "none";
};

export type ContextEventRawProvenance = {
  readonly sourceObservedAtUnixMs: number;
  readonly retrievedAtUnixMs: number;
  readonly retentionMode: "bounded_factual_extract";
  readonly license: string;
};

export interface ScheduledEventPayloadV1 {
  readonly sourceEventId: string;
  readonly eventFamily: "macro_protocol_risk";
  readonly eventType: "scheduled_event";
  readonly title: string;
  readonly description: string;
  readonly asOfUnixMs: number;
  readonly expiresAtUnixMs: number;
  readonly scheduledStartUnixMs: number;
  readonly scheduledEndUnixMs: number | null;
  readonly severity: ContextEventSeverity;
  readonly status: ContextEventStatus;
  readonly affectedScope: readonly string[];
  readonly sourceReferences: readonly unknown[];
  readonly sourceQuality: ContextEventSourceQuality;
  readonly rawProvenance: ContextEventRawProvenance;
  readonly warnings: readonly ContextEventWarning[];
}

export interface ProtocolIncidentPayloadV1 {
  readonly sourceEventId: string;
  readonly eventFamily: "macro_protocol_risk";
  readonly eventType: "protocol_incident";
  readonly title: string;
  readonly description: string;
  readonly asOfUnixMs: number;
  readonly expiresAtUnixMs: number;
  readonly detectedAtUnixMs: number;
  readonly resolvedAtUnixMs: number | null;
  readonly severity: ContextEventSeverity;
  readonly status: ContextEventStatus;
  readonly affectedScope: readonly string[];
  readonly sourceReferences: readonly unknown[];
  readonly sourceQuality: ContextEventSourceQuality;
  readonly rawProvenance: ContextEventRawProvenance;
  readonly warnings: readonly ContextEventWarning[];
}

export type ContextEventPayload = ScheduledEventPayloadV1 | ProtocolIncidentPayloadV1;
