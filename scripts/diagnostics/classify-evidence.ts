export interface ClockSkewEvidence {
  db: {
    skewFailedRows: number;
    providerCount: number;
  } | null;
  logs: {
    matchingErrorsPresent: boolean;
    confirmedWindowAndService: boolean;
    providersWithLogErrors: string[];
  } | null;
  hostClock: {
    ntpSynchronized: boolean;
    ntpHealthy: boolean;
  } | null;
}

export type ClockSkewDisposition =
  | "NO_SKEW"
  | "HOST_CLOCK_DRIFT"
  | "PROVIDER_TIMESTAMP_SEMANTICS"
  | "INCONCLUSIVE"
  | "BLOCKED";

export function classifyClockSkewEvidence(evidence: ClockSkewEvidence): ClockSkewDisposition {
  if (!evidence.db || !evidence.logs || !evidence.hostClock) {
    return "BLOCKED";
  }

  if (!evidence.logs.confirmedWindowAndService) {
    return "INCONCLUSIVE";
  }

  const { db, logs, hostClock } = evidence;

  if (
    db.skewFailedRows === 0 &&
    !logs.matchingErrorsPresent &&
    hostClock.ntpSynchronized &&
    hostClock.ntpHealthy
  ) {
    return "NO_SKEW";
  }

  if (
    db.skewFailedRows > 0 &&
    db.providerCount >= 2 &&
    logs.matchingErrorsPresent &&
    logs.providersWithLogErrors.length >= 2 &&
    (!hostClock.ntpSynchronized || !hostClock.ntpHealthy)
  ) {
    return "HOST_CLOCK_DRIFT";
  }

  if (
    db.skewFailedRows > 0 &&
    db.providerCount === 1 &&
    logs.matchingErrorsPresent &&
    logs.providersWithLogErrors.length === 1 &&
    hostClock.ntpSynchronized &&
    hostClock.ntpHealthy
  ) {
    return "PROVIDER_TIMESTAMP_SEMANTICS";
  }

  return "INCONCLUSIVE";
}
