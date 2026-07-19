import { describe, it, expect } from "vitest";
import {
  computeFreshness,
  FreshnessValidationError
} from "../../../src/domain/taxonomy/freshness.js";

describe("computeFreshness", () => {
  const baseTimestamps = {
    observedAtUnixMs: 1000_000,
    fetchedAtUnixMs: 1000_100,
    receivedAtUnixMs: 1000_200
  };

  const basePolicy = {
    maxObservedAgeMs: 60_000,
    maxFetchLagMs: null as number | null,
    validForMs: null as number | null,
    clockSkewToleranceMs: 5_000,
    staleBehavior: "exclude" as const
  };

  it("returns fresh when within maxObservedAgeMs", () => {
    const nowMs = baseTimestamps.observedAtUnixMs + 30_000;
    const result = computeFreshness(baseTimestamps, basePolicy, nowMs, "pool_state");
    expect(result.isStale).toBe(false);
    expect(result.reasons).toEqual([]);
    expect(result.validUntilUnixMs).toBe(baseTimestamps.observedAtUnixMs + 60_000);
  });

  it("returns stale when past maxObservedAgeMs", () => {
    const nowMs = baseTimestamps.observedAtUnixMs + 70_000;
    const result = computeFreshness(baseTimestamps, basePolicy, nowMs, "pool_state");
    expect(result.isStale).toBe(true);
    expect(result.reasons).toContain("expired_past_max_observed_age");
  });

  it("uses validForMs when provided", () => {
    const policy = { ...basePolicy, validForMs: 30_000 };
    const nowMs = baseTimestamps.fetchedAtUnixMs + 31_000;
    const result = computeFreshness(baseTimestamps, policy, nowMs, "executable_quote");
    expect(result.isStale).toBe(true);
    expect(result.reasons).toContain("expired_past_valid_for");
  });

  it("uses sourceValidUntilUnixMs when provided", () => {
    const timestamps = {
      ...baseTimestamps,
      sourceValidUntilUnixMs: baseTimestamps.observedAtUnixMs + 20_000
    };
    const nowMs = baseTimestamps.observedAtUnixMs + 25_000;
    const result = computeFreshness(timestamps, basePolicy, nowMs, "fee_metrics");
    expect(result.isStale).toBe(true);
    expect(result.reasons).toContain("expired_past_source_valid_until");
  });

  it("picks the earliest validUntil from multiple candidates", () => {
    const policy = { ...basePolicy, validForMs: 20_000 };
    const sourceValidUntil = baseTimestamps.observedAtUnixMs + 10_000;
    const timestamps = { ...baseTimestamps, sourceValidUntilUnixMs: sourceValidUntil };
    const result = computeFreshness(
      timestamps,
      policy,
      baseTimestamps.observedAtUnixMs,
      "pool_state"
    );
    expect(result.validUntilUnixMs).toBe(sourceValidUntil);
  });

  it("detects fetch lag exceeding maxFetchLagMs", () => {
    const policy = { ...basePolicy, maxFetchLagMs: 50 };
    const timestamps = {
      ...baseTimestamps,
      fetchedAtUnixMs: baseTimestamps.observedAtUnixMs + 100
    };
    const result = computeFreshness(
      timestamps,
      policy,
      baseTimestamps.observedAtUnixMs + 200,
      "pool_state"
    );
    expect(result.isStale).toBe(true);
    expect(result.reasons).toContain("fetch_lag_exceeded");
  });

  it("throws FreshnessValidationError when observedAt is in the future", () => {
    const nowMs = baseTimestamps.observedAtUnixMs - 10_000;
    expect(() => computeFreshness(baseTimestamps, basePolicy, nowMs, "pool_state")).toThrow(
      FreshnessValidationError
    );
  });

  it("throws FreshnessValidationError when fetchedAt precedes observedAt beyond tolerance", () => {
    const timestamps = {
      ...baseTimestamps,
      fetchedAtUnixMs: baseTimestamps.observedAtUnixMs - 10_000
    };
    expect(() =>
      computeFreshness(timestamps, basePolicy, baseTimestamps.observedAtUnixMs + 1000, "pool_state")
    ).toThrow(FreshnessValidationError);
  });

  it("throws FreshnessValidationError when receivedAt precedes fetchedAt beyond tolerance", () => {
    const timestamps = {
      ...baseTimestamps,
      receivedAtUnixMs: baseTimestamps.fetchedAtUnixMs - 10_000
    };
    expect(() =>
      computeFreshness(timestamps, basePolicy, baseTimestamps.observedAtUnixMs + 1000, "pool_state")
    ).toThrow(FreshnessValidationError);
  });

  it("ignores undefined validForMs and sourceValidUntilUnixMs", () => {
    const result = computeFreshness(
      baseTimestamps,
      basePolicy,
      baseTimestamps.observedAtUnixMs,
      "pool_state"
    );
    expect(result.validUntilUnixMs).toBe(baseTimestamps.observedAtUnixMs + 60_000);
  });

  it("carries policyKind in result", () => {
    const result = computeFreshness(
      baseTimestamps,
      basePolicy,
      baseTimestamps.observedAtUnixMs,
      "fee_apr"
    );
    expect(result.policyKind).toBe("fee_apr");
  });

  it("carries derivedAt as nowMs", () => {
    const nowMs = baseTimestamps.observedAtUnixMs + 5000;
    const result = computeFreshness(baseTimestamps, basePolicy, nowMs, "pool_state");
    expect(result.derivedAt).toBe(nowMs);
  });
});
