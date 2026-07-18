import { describe, it, expect } from "vitest";
import { enrichClmmCandidates } from "../../../src/domain/clmm-bundle/enrich.js";

describe("enrichment derives family class and freshness exclusively from the registry entry", () => {
  const nowMs = 1_000_000_000_000;

  it("uses registry entry for evidenceFamily", () => {
    const candidates = [
      {
        id: 1 as const,
        source: "clmm-v2-bundle" as const,
        payloadHash: "abc",
        receivedAtUnixMs: nowMs - 1000,
        fetchedAtUnixMs: nowMs - 2000,
        observedAtUnixMs: nowMs - 5000,
        kind: "trigger_event" as const,
        payload: {
          kind: "trigger_event",
          schemaVersion: 1,
          pair: "SOL/USDC" as const,
          triggerId: "t1",
          positionId: "p1",
          observedAtUnixMs: nowMs - 5000,
          breachDirection: "lower-bound-breach" as const,
          triggeredAt: nowMs - 5000
        }
      }
    ];

    const result = enrichClmmCandidates({
      candidates,
      nowMs,
      codeVersion: "1.0.0",
      runId: null
    });

    expect(result[0].confidence.components.sourceReliability).toBe(1);
    expect(result[0].freshness.isStale).toBe(false);
    expect(result[0].evidenceFamily).toBe("execution_safety");
  });

  it("uses registry entry for signalClass", () => {
    const candidates = [
      {
        id: 1 as const,
        source: "clmm-v2-bundle" as const,
        payloadHash: "abc",
        receivedAtUnixMs: nowMs - 1000,
        fetchedAtUnixMs: nowMs - 2000,
        observedAtUnixMs: nowMs - 5000,
        kind: "data_quality" as const,
        payload: {
          kind: "data_quality",
          schemaVersion: 1,
          pair: "SOL/USDC" as const,
          observedAtUnixMs: nowMs - 5000,
          warnings: [],
          isPartial: false,
          missingSources: []
        }
      }
    ];

    const result = enrichClmmCandidates({
      candidates,
      nowMs,
      codeVersion: "1.0.0",
      runId: null
    });

    expect(result[0].signalClass).toBe("deterministic");
  });
});

describe("completeness counts zero false and empty arrays as present and null as absent under weighting version clmm-bundle-completeness-v1", () => {
  const nowMs = 1_000_000_000_000;

  it("treats zero as present (dataCompleteness = 1)", () => {
    const candidates = [
      {
        id: 1 as const,
        source: "clmm-v2-bundle" as const,
        payloadHash: "abc",
        receivedAtUnixMs: nowMs - 1000,
        fetchedAtUnixMs: nowMs - 2000,
        observedAtUnixMs: nowMs - 5000,
        kind: "trigger_event" as const,
        payload: {
          kind: "trigger_event",
          schemaVersion: 1,
          pair: "SOL/USDC" as const,
          triggerId: "t1",
          positionId: "p1",
          observedAtUnixMs: nowMs - 5000,
          breachDirection: "lower-bound-breach" as const,
          triggeredAt: nowMs - 5000
        }
      }
    ];

    const result = enrichClmmCandidates({
      candidates,
      nowMs,
      codeVersion: "1.0.0",
      runId: null
    });

    expect(result[0].confidence.weightingVersion).toBe("clmm-bundle-completeness-v1");
  });

  it("treats empty array as present", () => {
    const candidates = [
      {
        id: 1 as const,
        source: "clmm-v2-bundle" as const,
        payloadHash: "abc",
        receivedAtUnixMs: nowMs - 1000,
        fetchedAtUnixMs: nowMs - 2000,
        observedAtUnixMs: nowMs - 5000,
        kind: "data_quality" as const,
        payload: {
          kind: "data_quality",
          schemaVersion: 1,
          pair: "SOL/USDC" as const,
          observedAtUnixMs: nowMs - 5000,
          warnings: [],
          isPartial: false,
          missingSources: []
        }
      }
    ];

    const result = enrichClmmCandidates({
      candidates,
      nowMs,
      codeVersion: "1.0.0",
      runId: null
    });

    expect(result[0].confidence.components.dataCompleteness).toBe(1);
  });

  it("treats null as absent", () => {
    const candidates = [
      {
        id: 1 as const,
        source: "clmm-v2-bundle" as const,
        payloadHash: "abc",
        receivedAtUnixMs: nowMs - 1000,
        fetchedAtUnixMs: nowMs - 2000,
        observedAtUnixMs: nowMs - 5000,
        kind: "trigger_event" as const,
        payload: {
          kind: "trigger_event",
          schemaVersion: 1,
          pair: "SOL/USDC" as const,
          triggerId: "t1",
          positionId: "p1",
          observedAtUnixMs: nowMs - 5000,
          breachDirection: "lower-bound-breach" as const,
          triggeredAt: nowMs - 5000
        }
      }
    ];

    const result = enrichClmmCandidates({
      candidates,
      nowMs,
      codeVersion: "1.0.0",
      runId: null
    });

    expect(result[0].confidence.components.llmConfidence).toBeNull();
  });
});

describe("direct facts use reliability 1 derivation 1 llm null and validated direct raw provenance", () => {
  const nowMs = 1_000_000_000_000;

  it("trigger_event has reliability 1 derivation 1 llm null", () => {
    const candidates = [
      {
        id: 1 as const,
        source: "clmm-v2-bundle" as const,
        payloadHash: "abc",
        receivedAtUnixMs: nowMs - 1000,
        fetchedAtUnixMs: nowMs - 2000,
        observedAtUnixMs: nowMs - 5000,
        kind: "trigger_event" as const,
        payload: {
          kind: "trigger_event",
          schemaVersion: 1,
          pair: "SOL/USDC" as const,
          triggerId: "t1",
          positionId: "p1",
          observedAtUnixMs: nowMs - 5000,
          breachDirection: "lower-bound-breach" as const,
          triggeredAt: nowMs - 5000
        }
      }
    ];

    const result = enrichClmmCandidates({
      candidates,
      nowMs,
      codeVersion: "1.0.0",
      runId: null
    });

    expect(result[0].confidence.components.sourceReliability).toBe(1);
    expect(result[0].confidence.components.derivationConfidence).toBe(1);
    expect(result[0].confidence.components.llmConfidence).toBeNull();
  });

  it("data_quality has reliability 1 derivation 1 llm null", () => {
    const candidates = [
      {
        id: 1 as const,
        source: "clmm-v2-bundle" as const,
        payloadHash: "abc",
        receivedAtUnixMs: nowMs - 1000,
        fetchedAtUnixMs: nowMs - 2000,
        observedAtUnixMs: nowMs - 5000,
        kind: "data_quality" as const,
        payload: {
          kind: "data_quality",
          schemaVersion: 1,
          pair: "SOL/USDC" as const,
          observedAtUnixMs: nowMs - 5000,
          warnings: [],
          isPartial: false,
          missingSources: []
        }
      }
    ];

    const result = enrichClmmCandidates({
      candidates,
      nowMs,
      codeVersion: "1.0.0",
      runId: null
    });

    expect(result[0].confidence.components.sourceReliability).toBe(1);
    expect(result[0].confidence.components.derivationConfidence).toBe(1);
    expect(result[0].confidence.components.llmConfidence).toBeNull();
  });

  it("has validated direct raw provenance", () => {
    const candidates = [
      {
        id: 1 as const,
        source: "clmm-v2-bundle" as const,
        payloadHash: "abc",
        receivedAtUnixMs: nowMs - 1000,
        fetchedAtUnixMs: nowMs - 2000,
        observedAtUnixMs: nowMs - 5000,
        kind: "trigger_event" as const,
        payload: {
          kind: "trigger_event",
          schemaVersion: 1,
          pair: "SOL/USDC" as const,
          triggerId: "t1",
          positionId: "p1",
          observedAtUnixMs: nowMs - 5000,
          breachDirection: "lower-bound-breach" as const,
          triggeredAt: nowMs - 5000
        }
      }
    ];

    const result = enrichClmmCandidates({
      candidates,
      nowMs,
      codeVersion: "1.0.0",
      runId: null
    });

    expect(result[0].provenance.rawObservationRefs).toHaveLength(1);
    expect(result[0].provenance.rawObservationRefs[0].refType).toBe("raw_observation");
    expect(result[0].provenance.rawObservationRefs[0].source).toBe("clmm-v2-bundle");
  });

  it("has empty derivedFromRefs for direct facts", () => {
    const candidates = [
      {
        id: 1 as const,
        source: "clmm-v2-bundle" as const,
        payloadHash: "abc",
        receivedAtUnixMs: nowMs - 1000,
        fetchedAtUnixMs: nowMs - 2000,
        observedAtUnixMs: nowMs - 5000,
        kind: "data_quality" as const,
        payload: {
          kind: "data_quality",
          schemaVersion: 1,
          pair: "SOL/USDC" as const,
          observedAtUnixMs: nowMs - 5000,
          warnings: [],
          isPartial: false,
          missingSources: []
        }
      }
    ];

    const result = enrichClmmCandidates({
      candidates,
      nowMs,
      codeVersion: "1.0.0",
      runId: null
    });

    expect(result[0].provenance.derivedFromRefs).toHaveLength(0);
  });
});

describe("future or out-of-order timestamps fail before persistence", () => {
  const nowMs = 1_000_000_000_000;

  it("future observedAt fails with FreshnessValidationError", () => {
    const candidates = [
      {
        id: 1 as const,
        source: "clmm-v2-bundle" as const,
        payloadHash: "abc",
        receivedAtUnixMs: nowMs,
        fetchedAtUnixMs: nowMs,
        observedAtUnixMs: nowMs + 100_000,
        kind: "trigger_event" as const,
        payload: {
          kind: "trigger_event",
          schemaVersion: 1,
          pair: "SOL/USDC" as const,
          triggerId: "t1",
          positionId: "p1",
          observedAtUnixMs: nowMs + 100_000,
          breachDirection: "lower-bound-breach" as const,
          triggeredAt: nowMs + 100_000
        }
      }
    ];

    expect(() =>
      enrichClmmCandidates({
        candidates,
        nowMs,
        codeVersion: "1.0.0",
        runId: null
      })
    ).toThrow();
  });

  it("out-of-order fetchedAt before observedAt fails", () => {
    const candidates = [
      {
        id: 1 as const,
        source: "clmm-v2-bundle" as const,
        payloadHash: "abc",
        receivedAtUnixMs: nowMs - 1000,
        fetchedAtUnixMs: nowMs - 50_000,
        observedAtUnixMs: nowMs - 5000,
        kind: "trigger_event" as const,
        payload: {
          kind: "trigger_event",
          schemaVersion: 1,
          pair: "SOL/USDC" as const,
          triggerId: "t1",
          positionId: "p1",
          observedAtUnixMs: nowMs - 5000,
          breachDirection: "lower-bound-breach" as const,
          triggeredAt: nowMs - 5000
        }
      }
    ];

    expect(() =>
      enrichClmmCandidates({
        candidates,
        nowMs,
        codeVersion: "1.0.0",
        runId: null
      })
    ).toThrow();
  });

  it("out-of-order receivedAt before fetchedAt fails", () => {
    const candidates = [
      {
        id: 1 as const,
        source: "clmm-v2-bundle" as const,
        payloadHash: "abc",
        receivedAtUnixMs: nowMs - 50_000,
        fetchedAtUnixMs: nowMs - 1000,
        observedAtUnixMs: nowMs - 5000,
        kind: "trigger_event" as const,
        payload: {
          kind: "trigger_event",
          schemaVersion: 1,
          pair: "SOL/USDC" as const,
          triggerId: "t1",
          positionId: "p1",
          observedAtUnixMs: nowMs - 5000,
          breachDirection: "lower-bound-breach" as const,
          triggeredAt: nowMs - 5000
        }
      }
    ];

    expect(() =>
      enrichClmmCandidates({
        candidates,
        nowMs,
        codeVersion: "1.0.0",
        runId: null
      })
    ).toThrow();
  });
});

describe("enrichClmmCandidates output shape", () => {
  const nowMs = 1_000_000_000_000;

  it("returns readonly EnrichedClmmObservation array", () => {
    const candidates = [
      {
        id: 1 as const,
        source: "clmm-v2-bundle" as const,
        payloadHash: "abc",
        receivedAtUnixMs: nowMs - 1000,
        fetchedAtUnixMs: nowMs - 2000,
        observedAtUnixMs: nowMs - 5000,
        kind: "trigger_event" as const,
        payload: {
          kind: "trigger_event",
          schemaVersion: 1,
          pair: "SOL/USDC" as const,
          triggerId: "t1",
          positionId: "p1",
          observedAtUnixMs: nowMs - 5000,
          breachDirection: "lower-bound-breach" as const,
          triggeredAt: nowMs - 5000
        }
      }
    ];

    const result = enrichClmmCandidates({
      candidates,
      nowMs,
      codeVersion: "1.0.0",
      runId: null
    });

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
    expect(result[0]).toHaveProperty("id");
    expect(result[0]).toHaveProperty("source");
    expect(result[0]).toHaveProperty("payloadHash");
    expect(result[0]).toHaveProperty("confidence");
    expect(result[0]).toHaveProperty("freshness");
    expect(result[0]).toHaveProperty("provenance");
  });

  it("preserves id, source, and payloadHash from input", () => {
    const candidates = [
      {
        id: 42 as const,
        source: "clmm-v2-bundle" as const,
        payloadHash: "hash123",
        receivedAtUnixMs: nowMs - 1000,
        fetchedAtUnixMs: nowMs - 2000,
        observedAtUnixMs: nowMs - 5000,
        kind: "data_quality" as const,
        payload: {
          kind: "data_quality",
          schemaVersion: 1,
          pair: "SOL/USDC" as const,
          observedAtUnixMs: nowMs - 5000,
          warnings: [],
          isPartial: false,
          missingSources: []
        }
      }
    ];

    const result = enrichClmmCandidates({
      candidates,
      nowMs,
      codeVersion: "1.0.0",
      runId: null
    });

    expect(result[0].id).toBe(42);
    expect(result[0].source).toBe("clmm-v2-bundle");
    expect(result[0].payloadHash).toBe("hash123");
  });

  it("includes codeVersion and runId in provenance processRef", () => {
    const candidates = [
      {
        id: 1 as const,
        source: "clmm-v2-bundle" as const,
        payloadHash: "abc",
        receivedAtUnixMs: nowMs - 1000,
        fetchedAtUnixMs: nowMs - 2000,
        observedAtUnixMs: nowMs - 5000,
        kind: "trigger_event" as const,
        payload: {
          kind: "trigger_event",
          schemaVersion: 1,
          pair: "SOL/USDC" as const,
          triggerId: "t1",
          positionId: "p1",
          observedAtUnixMs: nowMs - 5000,
          breachDirection: "lower-bound-breach" as const,
          triggeredAt: nowMs - 5000
        }
      }
    ];

    const result = enrichClmmCandidates({
      candidates,
      nowMs,
      codeVersion: "2.0.0",
      runId: "run-123"
    });

    expect(result[0].provenance.codeVersion).toBe("2.0.0");
    expect(result[0].provenance.runId).toBe("run-123");
  });
});
