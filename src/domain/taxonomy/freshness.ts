import type {
  FreshnessPolicy,
  Freshness,
  FreshnessReason,
  ObservationKind,
  FeatureKind
} from "../../contracts/taxonomy.js";

export class FreshnessValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FreshnessValidationError";
  }
}

export function computeFreshness(
  timestamps: {
    observedAtUnixMs: number;
    fetchedAtUnixMs: number;
    receivedAtUnixMs: number;
    sourceValidUntilUnixMs?: number;
  },
  policy: FreshnessPolicy,
  nowMs: number,
  policyKind: ObservationKind | FeatureKind
): Freshness {
  const { observedAtUnixMs, fetchedAtUnixMs, receivedAtUnixMs, sourceValidUntilUnixMs } =
    timestamps;
  const { clockSkewToleranceMs } = policy;

  if (observedAtUnixMs > nowMs + clockSkewToleranceMs) {
    throw new FreshnessValidationError(
      `observedAt (${observedAtUnixMs}) is in the future beyond clock skew tolerance`
    );
  }

  if (fetchedAtUnixMs < observedAtUnixMs - clockSkewToleranceMs) {
    throw new FreshnessValidationError(
      `fetchedAt (${fetchedAtUnixMs}) precedes observedAt (${observedAtUnixMs}) beyond clock skew tolerance`
    );
  }

  if (receivedAtUnixMs < fetchedAtUnixMs - clockSkewToleranceMs) {
    throw new FreshnessValidationError(
      `receivedAt (${receivedAtUnixMs}) precedes fetchedAt (${fetchedAtUnixMs}) beyond clock skew tolerance`
    );
  }

  const reasons: FreshnessReason[] = [];

  const validUntilCandidates = [observedAtUnixMs + policy.maxObservedAgeMs];

  if (policy.validForMs !== null && policy.validForMs !== undefined) {
    validUntilCandidates.push(fetchedAtUnixMs + policy.validForMs);
  }

  if (sourceValidUntilUnixMs !== undefined && sourceValidUntilUnixMs !== null) {
    validUntilCandidates.push(sourceValidUntilUnixMs);
  }

  const validUntilUnixMs = Math.min(...validUntilCandidates);

  const isStale = nowMs > validUntilUnixMs;

  if (isStale) {
    if (
      sourceValidUntilUnixMs !== undefined &&
      sourceValidUntilUnixMs !== null &&
      nowMs > sourceValidUntilUnixMs
    ) {
      reasons.push("expired_past_source_valid_until");
    } else if (
      policy.validForMs !== null &&
      policy.validForMs !== undefined &&
      nowMs > fetchedAtUnixMs + policy.validForMs
    ) {
      reasons.push("expired_past_valid_for");
    } else {
      reasons.push("expired_past_max_observed_age");
    }
  }

  if (
    policy.maxFetchLagMs !== null &&
    policy.maxFetchLagMs !== undefined &&
    fetchedAtUnixMs - observedAtUnixMs > policy.maxFetchLagMs
  ) {
    reasons.push("fetch_lag_exceeded");
  }

  return {
    isStale: isStale || reasons.includes("fetch_lag_exceeded"),
    validUntilUnixMs,
    derivedAt: nowMs,
    policyKind,
    reasons
  };
}
