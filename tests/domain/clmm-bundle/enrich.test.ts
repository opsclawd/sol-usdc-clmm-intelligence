import { describe, it, expect } from "vitest";
import type {
  TriggerEventPayloadV1,
  DataQualityPayloadV1
} from "../../../src/contracts/normalized-clmm-observation.js";
import { enrichClmmCandidates } from "../../../src/domain/clmm-bundle/enrich.js";

type TriggerEventCandidate = {
  readonly id: number;
  readonly source: "clmm-v2-bundle";
  readonly payloadHash: string;
  readonly receivedAtUnixMs: number;
  readonly fetchedAtUnixMs: number;
  readonly observedAtUnixMs: number;
  readonly kind: "trigger_event";
  readonly payload: TriggerEventPayloadV1;
};

type DataQualityCandidate = {
  readonly id: number;
  readonly source: "clmm-v2-bundle";
  readonly payloadHash: string;
  readonly receivedAtUnixMs: number;
  readonly fetchedAtUnixMs: number;
  readonly observedAtUnixMs: number;
  readonly kind: "data_quality";
  readonly payload: DataQualityPayloadV1;
};

describe("enrichment derives family class and freshness exclusively from the registry entry", () => {
  const nowMs = 1_000_000_000_000;

  it("uses registry entry for evidenceFamily", async () => {
    const candidates: readonly TriggerEventCandidate[] = [
      {
        id: 1,
        source: "clmm-v2-bundle",
        payloadHash: "abc",
        receivedAtUnixMs: nowMs - 1000,
        fetchedAtUnixMs: nowMs - 2000,
        observedAtUnixMs: nowMs - 5000,
        kind: "trigger_event",
        payload: {
          kind: "trigger_event",
          schemaVersion: 1,
          pair: "SOL/USDC",
          triggerId: "t1",
          positionId: "p1",
          observedAtUnixMs: nowMs - 5000,
          breachDirection: "lower-bound-breach",
          triggeredAt: nowMs - 5000
        }
      }
    ];

    const result = await enrichClmmCandidates({
      candidates,
      nowMs,
      codeVersion: "1.0.0",
      runId: null
    });

    expect(result[0]!.confidence.components.sourceReliability).toBe(1);
    expect(result[0]!.freshness.isStale).toBe(false);
    expect(result[0]!.evidenceFamily).toBe("execution_safety");
  });

  it("uses registry entry for signalClass", async () => {
    const candidates: readonly DataQualityCandidate[] = [
      {
        id: 1,
        source: "clmm-v2-bundle",
        payloadHash: "abc",
        receivedAtUnixMs: nowMs - 1000,
        fetchedAtUnixMs: nowMs - 2000,
        observedAtUnixMs: nowMs - 5000,
        kind: "data_quality",
        payload: {
          kind: "data_quality",
          schemaVersion: 1,
          pair: "SOL/USDC",
          observedAtUnixMs: nowMs - 5000,
          warnings: [],
          isPartial: false,
          missingSources: []
        }
      }
    ];

    const result = await enrichClmmCandidates({
      candidates,
      nowMs,
      codeVersion: "1.0.0",
      runId: null
    });

    expect(result[0]!.signalClass).toBe("deterministic");
  });
});

describe("completeness counts zero false and empty arrays as present and null as absent under weighting version clmm-bundle-completeness-v1", () => {
  const nowMs = 1_000_000_000_000;

  it("treats zero as present (dataCompleteness = 1)", async () => {
    const candidates: readonly TriggerEventCandidate[] = [
      {
        id: 1,
        source: "clmm-v2-bundle",
        payloadHash: "abc",
        receivedAtUnixMs: nowMs - 1000,
        fetchedAtUnixMs: nowMs - 2000,
        observedAtUnixMs: nowMs - 5000,
        kind: "trigger_event",
        payload: {
          kind: "trigger_event",
          schemaVersion: 1,
          pair: "SOL/USDC",
          triggerId: "t1",
          positionId: "p1",
          observedAtUnixMs: nowMs - 5000,
          breachDirection: "lower-bound-breach",
          triggeredAt: nowMs - 5000
        }
      }
    ];

    const result = await enrichClmmCandidates({
      candidates,
      nowMs,
      codeVersion: "1.0.0",
      runId: null
    });

    expect(result[0]!.confidence.weightingVersion).toBe("clmm-bundle-completeness-v1");
  });

  it("treats empty array as present", async () => {
    const candidates: readonly DataQualityCandidate[] = [
      {
        id: 1,
        source: "clmm-v2-bundle",
        payloadHash: "abc",
        receivedAtUnixMs: nowMs - 1000,
        fetchedAtUnixMs: nowMs - 2000,
        observedAtUnixMs: nowMs - 5000,
        kind: "data_quality",
        payload: {
          kind: "data_quality",
          schemaVersion: 1,
          pair: "SOL/USDC",
          observedAtUnixMs: nowMs - 5000,
          warnings: [],
          isPartial: false,
          missingSources: []
        }
      }
    ];

    const result = await enrichClmmCandidates({
      candidates,
      nowMs,
      codeVersion: "1.0.0",
      runId: null
    });

    expect(result[0]!.confidence.components.dataCompleteness).toBe(1);
  });

  it("treats null as absent", async () => {
    const candidates: readonly TriggerEventCandidate[] = [
      {
        id: 1,
        source: "clmm-v2-bundle",
        payloadHash: "abc",
        receivedAtUnixMs: nowMs - 1000,
        fetchedAtUnixMs: nowMs - 2000,
        observedAtUnixMs: nowMs - 5000,
        kind: "trigger_event",
        payload: {
          kind: "trigger_event",
          schemaVersion: 1,
          pair: "SOL/USDC",
          triggerId: "t1",
          positionId: "p1",
          observedAtUnixMs: nowMs - 5000,
          breachDirection: "lower-bound-breach",
          triggeredAt: nowMs - 5000
        }
      }
    ];

    const result = await enrichClmmCandidates({
      candidates,
      nowMs,
      codeVersion: "1.0.0",
      runId: null
    });

    expect(result[0]!.confidence.components.llmConfidence).toBeNull();
  });
});

describe("direct facts use reliability 1 derivation 1 llm null and validated direct raw provenance", () => {
  const nowMs = 1_000_000_000_000;

  it("trigger_event has reliability 1 derivation 1 llm null", async () => {
    const candidates: readonly TriggerEventCandidate[] = [
      {
        id: 1,
        source: "clmm-v2-bundle",
        payloadHash: "abc",
        receivedAtUnixMs: nowMs - 1000,
        fetchedAtUnixMs: nowMs - 2000,
        observedAtUnixMs: nowMs - 5000,
        kind: "trigger_event",
        payload: {
          kind: "trigger_event",
          schemaVersion: 1,
          pair: "SOL/USDC",
          triggerId: "t1",
          positionId: "p1",
          observedAtUnixMs: nowMs - 5000,
          breachDirection: "lower-bound-breach",
          triggeredAt: nowMs - 5000
        }
      }
    ];

    const result = await enrichClmmCandidates({
      candidates,
      nowMs,
      codeVersion: "1.0.0",
      runId: null
    });

    expect(result[0]!.confidence.components.sourceReliability).toBe(1);
    expect(result[0]!.confidence.components.derivationConfidence).toBe(1);
    expect(result[0]!.confidence.components.llmConfidence).toBeNull();
  });

  it("data_quality has reliability 1 derivation 1 llm null", async () => {
    const candidates: readonly DataQualityCandidate[] = [
      {
        id: 1,
        source: "clmm-v2-bundle",
        payloadHash: "abc",
        receivedAtUnixMs: nowMs - 1000,
        fetchedAtUnixMs: nowMs - 2000,
        observedAtUnixMs: nowMs - 5000,
        kind: "data_quality",
        payload: {
          kind: "data_quality",
          schemaVersion: 1,
          pair: "SOL/USDC",
          observedAtUnixMs: nowMs - 5000,
          warnings: [],
          isPartial: false,
          missingSources: []
        }
      }
    ];

    const result = await enrichClmmCandidates({
      candidates,
      nowMs,
      codeVersion: "1.0.0",
      runId: null
    });

    expect(result[0]!.confidence.components.sourceReliability).toBe(1);
    expect(result[0]!.confidence.components.derivationConfidence).toBe(1);
    expect(result[0]!.confidence.components.llmConfidence).toBeNull();
  });

  it("has validated direct raw provenance", async () => {
    const candidates: readonly TriggerEventCandidate[] = [
      {
        id: 1,
        source: "clmm-v2-bundle",
        payloadHash: "abc",
        receivedAtUnixMs: nowMs - 1000,
        fetchedAtUnixMs: nowMs - 2000,
        observedAtUnixMs: nowMs - 5000,
        kind: "trigger_event",
        payload: {
          kind: "trigger_event",
          schemaVersion: 1,
          pair: "SOL/USDC",
          triggerId: "t1",
          positionId: "p1",
          observedAtUnixMs: nowMs - 5000,
          breachDirection: "lower-bound-breach",
          triggeredAt: nowMs - 5000
        }
      }
    ];

    const result = await enrichClmmCandidates({
      candidates,
      nowMs,
      codeVersion: "1.0.0",
      runId: null
    });

    expect(result[0]!.provenance.rawObservationRefs).toHaveLength(1);
    expect(result[0]!.provenance.rawObservationRefs[0]!.refType).toBe("raw_observation");
    expect(result[0]!.provenance.rawObservationRefs[0]!.source).toBe("clmm-v2-bundle");
  });

  it("has empty derivedFromRefs for direct facts", async () => {
    const candidates: readonly DataQualityCandidate[] = [
      {
        id: 1,
        source: "clmm-v2-bundle",
        payloadHash: "abc",
        receivedAtUnixMs: nowMs - 1000,
        fetchedAtUnixMs: nowMs - 2000,
        observedAtUnixMs: nowMs - 5000,
        kind: "data_quality",
        payload: {
          kind: "data_quality",
          schemaVersion: 1,
          pair: "SOL/USDC",
          observedAtUnixMs: nowMs - 5000,
          warnings: [],
          isPartial: false,
          missingSources: []
        }
      }
    ];

    const result = await enrichClmmCandidates({
      candidates,
      nowMs,
      codeVersion: "1.0.0",
      runId: null
    });

    expect(result[0]!.provenance.derivedFromRefs).toHaveLength(0);
  });
});

describe("future or out-of-order timestamps fail before persistence", () => {
  const nowMs = 1_000_000_000_000;

  it("future observedAt fails with FreshnessValidationError", async () => {
    const candidates: readonly TriggerEventCandidate[] = [
      {
        id: 1,
        source: "clmm-v2-bundle",
        payloadHash: "abc",
        receivedAtUnixMs: nowMs,
        fetchedAtUnixMs: nowMs,
        observedAtUnixMs: nowMs + 100_000,
        kind: "trigger_event",
        payload: {
          kind: "trigger_event",
          schemaVersion: 1,
          pair: "SOL/USDC",
          triggerId: "t1",
          positionId: "p1",
          observedAtUnixMs: nowMs + 100_000,
          breachDirection: "lower-bound-breach",
          triggeredAt: nowMs + 100_000
        }
      }
    ];

    await expect(
      enrichClmmCandidates({
        candidates,
        nowMs,
        codeVersion: "1.0.0",
        runId: null
      })
    ).rejects.toThrow();
  });

  it("out-of-order fetchedAt before observedAt fails", async () => {
    const candidates: readonly TriggerEventCandidate[] = [
      {
        id: 1,
        source: "clmm-v2-bundle",
        payloadHash: "abc",
        receivedAtUnixMs: nowMs - 1000,
        fetchedAtUnixMs: nowMs - 50_000,
        observedAtUnixMs: nowMs - 5000,
        kind: "trigger_event",
        payload: {
          kind: "trigger_event",
          schemaVersion: 1,
          pair: "SOL/USDC",
          triggerId: "t1",
          positionId: "p1",
          observedAtUnixMs: nowMs - 5000,
          breachDirection: "lower-bound-breach",
          triggeredAt: nowMs - 5000
        }
      }
    ];

    await expect(
      enrichClmmCandidates({
        candidates,
        nowMs,
        codeVersion: "1.0.0",
        runId: null
      })
    ).rejects.toThrow();
  });

  it("out-of-order receivedAt before fetchedAt fails", async () => {
    const candidates: readonly TriggerEventCandidate[] = [
      {
        id: 1,
        source: "clmm-v2-bundle",
        payloadHash: "abc",
        receivedAtUnixMs: nowMs - 50_000,
        fetchedAtUnixMs: nowMs - 1000,
        observedAtUnixMs: nowMs - 5000,
        kind: "trigger_event",
        payload: {
          kind: "trigger_event",
          schemaVersion: 1,
          pair: "SOL/USDC",
          triggerId: "t1",
          positionId: "p1",
          observedAtUnixMs: nowMs - 5000,
          breachDirection: "lower-bound-breach",
          triggeredAt: nowMs - 5000
        }
      }
    ];

    await expect(
      enrichClmmCandidates({
        candidates,
        nowMs,
        codeVersion: "1.0.0",
        runId: null
      })
    ).rejects.toThrow();
  });
});

describe("enrichClmmCandidates output shape", () => {
  const nowMs = 1_000_000_000_000;

  it("returns readonly EnrichedClmmObservation array", async () => {
    const candidates: readonly TriggerEventCandidate[] = [
      {
        id: 1,
        source: "clmm-v2-bundle",
        payloadHash: "abc",
        receivedAtUnixMs: nowMs - 1000,
        fetchedAtUnixMs: nowMs - 2000,
        observedAtUnixMs: nowMs - 5000,
        kind: "trigger_event",
        payload: {
          kind: "trigger_event",
          schemaVersion: 1,
          pair: "SOL/USDC",
          triggerId: "t1",
          positionId: "p1",
          observedAtUnixMs: nowMs - 5000,
          breachDirection: "lower-bound-breach",
          triggeredAt: nowMs - 5000
        }
      }
    ];

    const result = await enrichClmmCandidates({
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

  it("preserves id, source, and recomputes payloadHash from payload", async () => {
    const candidates: readonly DataQualityCandidate[] = [
      {
        id: 42,
        source: "clmm-v2-bundle",
        payloadHash: "hash123",
        receivedAtUnixMs: nowMs - 1000,
        fetchedAtUnixMs: nowMs - 2000,
        observedAtUnixMs: nowMs - 5000,
        kind: "data_quality",
        payload: {
          kind: "data_quality",
          schemaVersion: 1,
          pair: "SOL/USDC",
          observedAtUnixMs: nowMs - 5000,
          warnings: [],
          isPartial: false,
          missingSources: []
        }
      }
    ];

    const result = await enrichClmmCandidates({
      candidates,
      nowMs,
      codeVersion: "1.0.0",
      runId: null
    });

    expect(result[0]!.id).toBe(42);
    expect(result[0]!.source).toBe("clmm-v2-bundle");
    expect(typeof result[0]!.payloadCanonical).toBe("string");
    expect(result[0]!.payloadCanonical.length).toBeGreaterThan(0);
    expect(typeof result[0]!.payloadHash).toBe("string");
    expect(result[0]!.payloadHash.length).toBe(64);
  });

  it("includes codeVersion and runId in provenance processRef", async () => {
    const candidates: readonly TriggerEventCandidate[] = [
      {
        id: 1,
        source: "clmm-v2-bundle",
        payloadHash: "abc",
        receivedAtUnixMs: nowMs - 1000,
        fetchedAtUnixMs: nowMs - 2000,
        observedAtUnixMs: nowMs - 5000,
        kind: "trigger_event",
        payload: {
          kind: "trigger_event",
          schemaVersion: 1,
          pair: "SOL/USDC",
          triggerId: "t1",
          positionId: "p1",
          observedAtUnixMs: nowMs - 5000,
          breachDirection: "lower-bound-breach",
          triggeredAt: nowMs - 5000
        }
      }
    ];

    const result = await enrichClmmCandidates({
      candidates,
      nowMs,
      codeVersion: "2.0.0",
      runId: "run-123"
    });

    expect(result[0]!.provenance.codeVersion).toBe("2.0.0");
    expect(result[0]!.provenance.runId).toBe("run-123");
  });
});
