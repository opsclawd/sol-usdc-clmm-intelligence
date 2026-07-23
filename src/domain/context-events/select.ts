import type {
  NormalizedObservationRow,
  ScheduledEventPayloadV1,
  ProtocolIncidentPayloadV1
} from "../../contracts/index.js";

export interface ContextEventSelectionRequest {
  readonly evaluationTimeUnixMs: number;
  readonly candidates: readonly NormalizedObservationRow[];
  readonly maxItems: number;
}

export interface SelectedContextEvent {
  readonly row: NormalizedObservationRow;
  readonly payload: ScheduledEventPayloadV1 | ProtocolIncidentPayloadV1;
}

const SEVERITY_RANK: Record<string, number> = {
  CRITICAL: 1,
  HIGH: 2,
  MEDIUM: 3,
  LOW: 4
};

interface IdentityKey {
  source: string;
  observationKind: string;
  sourceEventId: string;
}

function deriveIdentityKey(row: NormalizedObservationRow): IdentityKey | null {
  const payload = row.payload as ScheduledEventPayloadV1 | ProtocolIncidentPayloadV1;
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if (payload.eventType !== "scheduled_event" && payload.eventType !== "protocol_incident") {
    return null;
  }
  return {
    source: row.source,
    observationKind: row.observationKind,
    sourceEventId: payload.sourceEventId
  };
}

function isScheduledEventPayload(payload: unknown): payload is ScheduledEventPayloadV1 {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as ScheduledEventPayloadV1).eventType === "scheduled_event"
  );
}

function isProtocolIncidentPayload(payload: unknown): payload is ProtocolIncidentPayloadV1 {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as ProtocolIncidentPayloadV1).eventType === "protocol_incident"
  );
}

function getLatestByIdentity(
  candidates: readonly NormalizedObservationRow[]
): Map<string, NormalizedObservationRow> {
  const groups = new Map<string, NormalizedObservationRow[]>();

  for (const row of candidates) {
    const key = deriveIdentityKey(row);
    if (!key) continue;

    const identityKey = `${key.source}::${key.observationKind}::${key.sourceEventId}`;
    const group = groups.get(identityKey);
    if (group) {
      group.push(row);
    } else {
      groups.set(identityKey, [row]);
    }
  }

  const latestMap = new Map<string, NormalizedObservationRow>();

  for (const [identityKey, rows] of groups) {
    rows.sort((a, b) => {
      const payloadA = a.payload as ScheduledEventPayloadV1 | ProtocolIncidentPayloadV1;
      const payloadB = b.payload as ScheduledEventPayloadV1 | ProtocolIncidentPayloadV1;
      const asOfA = payloadA?.asOfUnixMs ?? 0;
      const asOfB = payloadB?.asOfUnixMs ?? 0;
      if (asOfA !== asOfB) {
        return asOfB - asOfA;
      }
      if (a.receivedAtUnixMs !== b.receivedAtUnixMs) {
        return b.receivedAtUnixMs - a.receivedAtUnixMs;
      }
      return b.id - a.id;
    });
    latestMap.set(identityKey, rows[0]!);
  }

  return latestMap;
}

function isEligible(row: NormalizedObservationRow, evaluationTimeUnixMs: number): boolean {
  const payload = row.payload as ScheduledEventPayloadV1 | ProtocolIncidentPayloadV1;

  if (!payload || typeof payload !== "object") {
    return false;
  }

  if (row.isStale) {
    return false;
  }

  if (payload.asOfUnixMs > evaluationTimeUnixMs) {
    return false;
  }

  if (row.validUntilUnixMs !== null && row.validUntilUnixMs <= evaluationTimeUnixMs) {
    return false;
  }

  if (
    "expiresAtUnixMs" in payload &&
    typeof payload.expiresAtUnixMs === "number" &&
    payload.expiresAtUnixMs <= evaluationTimeUnixMs
  ) {
    return false;
  }

  if (payload.eventType === "protocol_incident") {
    const incident = payload as ProtocolIncidentPayloadV1;
    if (incident.status === "UNCONFIRMED") {
      return false;
    }
  }

  if (
    payload.eventType === "scheduled_event" &&
    (payload as ScheduledEventPayloadV1).status === "CANCELLED"
  ) {
    return false;
  }

  return true;
}

function getSeverityForRow(row: NormalizedObservationRow): number {
  const payload = row.payload as ScheduledEventPayloadV1 | ProtocolIncidentPayloadV1;
  if (!payload || typeof payload !== "object") {
    return 99;
  }
  return SEVERITY_RANK[payload.severity] ?? 99;
}

function getEventTimeForRow(row: NormalizedObservationRow): number {
  const payload = row.payload as ScheduledEventPayloadV1 | ProtocolIncidentPayloadV1;
  if (!payload || typeof payload !== "object") {
    return 0;
  }
  return payload.asOfUnixMs ?? 0;
}

export function selectCurrentContextEvents(
  request: ContextEventSelectionRequest
): readonly SelectedContextEvent[] {
  const { evaluationTimeUnixMs, candidates, maxItems } = request;

  const latestByIdentity = getLatestByIdentity(candidates);

  const eligibleRows: NormalizedObservationRow[] = [];

  for (const [, row] of latestByIdentity) {
    if (!isEligible(row, evaluationTimeUnixMs)) {
      continue;
    }
    eligibleRows.push(row);
  }

  eligibleRows.sort((a, b) => {
    const severityA = getSeverityForRow(a);
    const severityB = getSeverityForRow(b);
    if (severityA !== severityB) {
      return severityA - severityB;
    }

    const eventTimeA = getEventTimeForRow(a);
    const eventTimeB = getEventTimeForRow(b);
    if (eventTimeA !== eventTimeB) {
      return eventTimeB - eventTimeA;
    }

    const payloadA = a.payload as ScheduledEventPayloadV1 | ProtocolIncidentPayloadV1;
    const payloadB = b.payload as ScheduledEventPayloadV1 | ProtocolIncidentPayloadV1;
    const sourceEventIdCompare = (payloadA?.sourceEventId ?? "").localeCompare(
      payloadB?.sourceEventId ?? ""
    );
    if (sourceEventIdCompare !== 0) {
      return sourceEventIdCompare;
    }

    const sourceCompare = a.source.localeCompare(b.source);
    if (sourceCompare !== 0) {
      return sourceCompare;
    }

    if (a.receivedAtUnixMs !== b.receivedAtUnixMs) {
      return b.receivedAtUnixMs - a.receivedAtUnixMs;
    }

    return a.id - b.id;
  });

  const limited = eligibleRows.slice(0, maxItems);

  const result: SelectedContextEvent[] = [];

  for (const row of limited) {
    const payload = row.payload;
    if (isScheduledEventPayload(payload)) {
      result.push({ row, payload });
    } else if (isProtocolIncidentPayload(payload)) {
      result.push({ row, payload });
    }
  }

  return result;
}
