import type {
  ScheduledEventPayloadV1,
  ProtocolIncidentPayloadV1,
  ContextEventWarning
} from "../../contracts/context-events.js";
import type { BoundedScheduledEventSnapshot, BoundedProtocolIncidentSnapshot } from "./validate.js";

const MAX_EXPIRY_MS = 86400000;
const RECOVERY_EXPIRY_MS = 900000;
const STALE_THRESHOLD_MS = 900000;

function sortAndDeduplicateStrings(arr: readonly string[]): readonly string[] {
  return [...new Set(arr)].sort();
}

function computeScheduledEventExpiry(
  scheduledStartUnixMs: number,
  retrievedAtUnixMs: number,
  nowMs: number
): number {
  const scheduledExpiry = scheduledStartUnixMs + MAX_EXPIRY_MS;
  const retrievedExpiry = retrievedAtUnixMs + MAX_EXPIRY_MS;
  const minExpiry = Math.min(scheduledExpiry, retrievedExpiry);
  return Math.min(minExpiry, nowMs + MAX_EXPIRY_MS);
}

function normalizeScheduledEvent(
  snapshot: BoundedScheduledEventSnapshot,
  retrievedAtUnixMs: number,
  nowMs: number
): ScheduledEventPayloadV1 {
  const { snapshot: snap } = snapshot;
  const expiresAtUnixMs = computeScheduledEventExpiry(
    snap.scheduledStartUnixMs,
    retrievedAtUnixMs,
    nowMs
  );

  const warnings: ContextEventWarning[] = [];

  if (
    snap.sourceQuality.confirmation === "none" &&
    !warnings.includes("missing_qualifying_confirmation")
  ) {
    warnings.push("missing_qualifying_confirmation");
  }

  const isStale = nowMs - snapshot.sourceObservedAtUnixMs >= STALE_THRESHOLD_MS;
  if (isStale && !warnings.includes("stale_observation")) {
    warnings.push("stale_observation");
  }

  return {
    sourceEventId: snap.providerSourceEventId,
    eventFamily: "macro_protocol_risk",
    eventType: "scheduled_event",
    title: snap.title,
    description: snap.description.slice(0, 5000),
    asOfUnixMs: snap.sourceObservedAtUnixMs,
    expiresAtUnixMs,
    scheduledStartUnixMs: snap.scheduledStartUnixMs,
    scheduledEndUnixMs: snap.scheduledEndUnixMs,
    severity: snap.severity,
    status: snap.status,
    affectedScope: sortAndDeduplicateStrings(snap.affectedScope),
    sourceReferences: [...snap.sourceReferences].slice(0, 50),
    sourceQuality: snap.sourceQuality,
    rawProvenance: {
      sourceObservedAtUnixMs: snapshot.sourceObservedAtUnixMs,
      retrievedAtUnixMs,
      retentionMode: "bounded_factual_extract",
      license: "CC0-1.0"
    },
    warnings
  };
}

function computeIncidentExpiry(
  resolvedAtUnixMs: number | null,
  detectedAtUnixMs: number,
  nowMs: number
): number {
  if (resolvedAtUnixMs !== null) {
    return Math.max(nowMs, resolvedAtUnixMs + RECOVERY_EXPIRY_MS);
  }
  return nowMs + MAX_EXPIRY_MS;
}

function determineIncidentStatus(
  snapshotStatus: ProtocolIncidentPayloadV1["status"],
  confirmation: ProtocolIncidentPayloadV1["sourceQuality"]["confirmation"]
): ProtocolIncidentPayloadV1["status"] {
  if (snapshotStatus === "UNCONFIRMED") {
    if (confirmation === "official" || confirmation === "primary") {
      return "ACTIVE";
    }
    return "UNCONFIRMED";
  }
  return snapshotStatus;
}

function normalizeProtocolIncident(
  snapshot: BoundedProtocolIncidentSnapshot,
  retrievedAtUnixMs: number,
  nowMs: number
): ProtocolIncidentPayloadV1 {
  const { snapshot: snap } = snapshot;
  const status = determineIncidentStatus(snap.status, snap.sourceQuality.confirmation);
  const expiresAtUnixMs = computeIncidentExpiry(
    snap.resolvedAtUnixMs,
    snap.detectedAtUnixMs,
    nowMs
  );

  const warnings: ContextEventWarning[] = [];

  if (
    snap.sourceQuality.confirmation === "none" &&
    !warnings.includes("missing_qualifying_confirmation")
  ) {
    warnings.push("missing_qualifying_confirmation");
  }

  if (
    snap.sourceQuality.completeness === "partial" &&
    !warnings.includes("incomplete_information")
  ) {
    warnings.push("incomplete_information");
  }

  const isStale = nowMs - snapshot.sourceObservedAtUnixMs >= STALE_THRESHOLD_MS;
  if (isStale && !warnings.includes("stale_observation")) {
    warnings.push("stale_observation");
  }

  return {
    sourceEventId: snap.providerSourceEventId,
    eventFamily: "macro_protocol_risk",
    eventType: "protocol_incident",
    title: snap.title,
    description: snap.description.slice(0, 5000),
    asOfUnixMs: snap.sourceObservedAtUnixMs,
    expiresAtUnixMs,
    detectedAtUnixMs: snap.detectedAtUnixMs,
    resolvedAtUnixMs: snap.resolvedAtUnixMs,
    severity: snap.severity,
    status,
    affectedScope: sortAndDeduplicateStrings(snap.affectedScope),
    sourceReferences: [...snap.sourceReferences].slice(0, 50),
    sourceQuality: snap.sourceQuality,
    rawProvenance: {
      sourceObservedAtUnixMs: snapshot.sourceObservedAtUnixMs,
      retrievedAtUnixMs,
      retentionMode: "bounded_factual_extract",
      license: "CC0-1.0"
    },
    warnings
  };
}

export function normalizeScheduledEvents(
  snapshot: BoundedScheduledEventSnapshot,
  retrievedAtUnixMs: number
): readonly ScheduledEventPayloadV1[] {
  const nowMs = Date.now();
  return [normalizeScheduledEvent(snapshot, retrievedAtUnixMs, nowMs)];
}

export function normalizeProtocolIncidents(
  snapshot: BoundedProtocolIncidentSnapshot,
  retrievedAtUnixMs: number
): readonly ProtocolIncidentPayloadV1[] {
  const nowMs = Date.now();
  return [normalizeProtocolIncident(snapshot, retrievedAtUnixMs, nowMs)];
}
