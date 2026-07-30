import { describe, it, expect } from "vitest";
import type { DerivedFeatureRow } from "../../src/ports/feature-repo.js";
import {
  REQUIRED_POSITION_FEATURE_KINDS,
  buildPositionCorrelationId,
  evaluatePositionFeatureGate,
  aggregatePipelineStatus
} from "../../src/application/core-evidence-pipeline-policy.js";

function makeFeatureRow(
  kind: (typeof REQUIRED_POSITION_FEATURE_KINDS)[number],
  overrides: Partial<DerivedFeatureRow> = {}
): DerivedFeatureRow {
  return {
    id: 1,
    featureKind: kind,
    signalClass: "deterministic",
    evidenceFamily: "clmm_state",
    value: 500000,
    structuredPayload: {},
    asOfUnixMs: 1000,
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
    confidenceComposite: 1,
    confidenceLevel: "high",
    validUntilUnixMs: 2000,
    isStale: false,
    staleBehavior: null,
    provenance: {
      sourceRefs: [],
      rawObservationRefs: [],
      derivedFromRefs: [],
      processRef: {
        collector: "test",
        jobName: "test",
        pipelineRunId: null,
        codeVersion: null,
        modelVersion: null
      },
      codeVersion: "1.0.0",
      runId: null
    },
    payloadHash: "hash-123",
    receivedAtUnixMs: 1000,
    status: "AVAILABLE",
    unit: "PPM",
    pair: "SOL/USDC",
    calculatorVersion: "1.0.0",
    selectionVersion: "v1",
    inputObservationIds: [100],
    rejectedObservationIds: [],
    derivationKey: `key-${kind}`,
    poolId: "pool-1",
    positionId: "pos-1",
    warnings: [],
    reasons: [],
    ...overrides
  };
}

describe("core-evidence-pipeline-policy", () => {
  it("passes only three exact fresh usable position features with persisted inputs", () => {
    const evaluationTimeUnixMs = 1000;
    const rows = REQUIRED_POSITION_FEATURE_KINDS.map((kind) =>
      makeFeatureRow(kind, {
        asOfUnixMs: evaluationTimeUnixMs,
        validUntilUnixMs: evaluationTimeUnixMs + 1000
      })
    );

    const result = evaluatePositionFeatureGate({
      rows,
      poolId: "pool-1",
      positionId: "pos-1",
      evaluationTimeUnixMs
    });

    expect(result).toEqual({
      usable: true,
      reasons: []
    });
  });

  it("fails with stable reasons for missing unavailable stale wrong-scope wrong-time and duplicate rows", () => {
    const evaluationTimeUnixMs = 1000;

    // Test missing rows
    const missingResult = evaluatePositionFeatureGate({
      rows: [],
      poolId: "pool-1",
      positionId: "pos-1",
      evaluationTimeUnixMs
    });
    expect(missingResult).toEqual({
      usable: false,
      reasons: ["missing:distance_to_lower", "missing:distance_to_upper", "missing:range_location"]
    });

    // Test unavailable, stale, wrong scope, wrong time, missing input, and duplicate rows
    const rows: DerivedFeatureRow[] = [
      // range_location: duplicate candidates
      makeFeatureRow("range_location", { id: 1 }),
      makeFeatureRow("range_location", { id: 2 }),
      // distance_to_lower: multiple faults (UNAVAILABLE, stale, wrong_scope, wrong_evaluation_time, missing_input)
      makeFeatureRow("distance_to_lower", {
        status: "UNAVAILABLE",
        validUntilUnixMs: evaluationTimeUnixMs, // stale (validUntilUnixMs <= evalTime)
        poolId: "wrong-pool",
        asOfUnixMs: 500, // wrong eval time
        inputObservationIds: [] // missing input
      }),
      // distance_to_upper: valid kind but stale
      makeFeatureRow("distance_to_upper", {
        validUntilUnixMs: evaluationTimeUnixMs - 100
      })
    ];

    const result = evaluatePositionFeatureGate({
      rows,
      poolId: "pool-1",
      positionId: "pos-1",
      evaluationTimeUnixMs
    });

    expect(result.usable).toBe(false);
    expect(result.reasons).toEqual([
      "duplicate:range_location",
      "missing_input:distance_to_lower",
      "stale:distance_to_lower",
      "stale:distance_to_upper",
      "unusable:distance_to_lower",
      "wrong_evaluation_time:distance_to_lower",
      "wrong_scope:distance_to_lower"
    ]);
  });

  it("builds stable per-position correlation IDs without cross-position collisions", () => {
    const id1 = buildPositionCorrelationId("run-123", "pos-1");
    const id2 = buildPositionCorrelationId("run-123", "pos-2");
    const id3 = buildPositionCorrelationId("run-456", "pos-1");

    expect(id1).toBe("run:run-123:position:pos-1");
    expect(id2).toBe("run:run-123:position:pos-2");
    expect(id3).toBe("run:run-456:position:pos-1");

    expect(id1).not.toBe(id2);
    expect(id1).not.toBe(id3);

    expect(() => buildPositionCorrelationId("", "pos-1")).toThrow();
    expect(() => buildPositionCorrelationId("   ", "pos-1")).toThrow();
    expect(() => buildPositionCorrelationId("run-123", "")).toThrow();
    expect(() => buildPositionCorrelationId("run-123", "   ")).toThrow();
  });

  it("returns failed when no position published", () => {
    expect(aggregatePipelineStatus("COMPLETE", [])).toBe("failed");
    expect(aggregatePipelineStatus("COMPLETE", [{ status: "failed" }, { status: "failed" }])).toBe(
      "failed"
    );
    expect(aggregatePipelineStatus("PARTIAL", [{ status: "failed" }])).toBe("failed");
  });

  it("returns partial_failure when published and failed positions coexist", () => {
    expect(
      aggregatePipelineStatus("COMPLETE", [{ status: "complete" }, { status: "failed" }])
    ).toBe("partial_failure");
    expect(
      aggregatePipelineStatus("COMPLETE", [{ status: "degraded" }, { status: "failed" }])
    ).toBe("partial_failure");
    expect(aggregatePipelineStatus("PARTIAL", [{ status: "complete" }, { status: "failed" }])).toBe(
      "partial_failure"
    );
  });

  it("returns degraded for partial collection or a degraded published position", () => {
    expect(aggregatePipelineStatus("PARTIAL", [{ status: "complete" }])).toBe("degraded");
    expect(aggregatePipelineStatus("COMPLETE", [{ status: "degraded" }])).toBe("degraded");
    expect(aggregatePipelineStatus("PARTIAL", [{ status: "degraded" }])).toBe("degraded");
  });

  it("returns complete only when complete collection and every position are complete", () => {
    expect(
      aggregatePipelineStatus("COMPLETE", [{ status: "complete" }, { status: "complete" }])
    ).toBe("complete");
  });
});
