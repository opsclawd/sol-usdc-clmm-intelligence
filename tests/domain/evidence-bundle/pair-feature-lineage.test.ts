import { describe, it, expect } from "vitest";
import type {
  FeatureKind,
  SignalClass,
  EvidenceFamily,
  Confidence,
  Provenance,
  ProvenanceRef
} from "../../../src/contracts/taxonomy.js";
import type { NormalizedObservationRow } from "../../../src/ports/index.js";
import type { RawObservationRow } from "../../../src/ports/observation-repo.js";
import {
  verifyPairEvidenceLineage,
  type VerifyPairEvidenceLineageInput
} from "../../../src/domain/evidence-bundle/index.js";

const DEFAULT_CONFIDENCE: Confidence = {
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
};

const DEFAULT_PROVENANCE: Provenance = {
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
  codeVersion: "test",
  runId: null
};

function makeRawObservationRow(
  overrides: Partial<RawObservationRow> & { id: number }
): RawObservationRow {
  return {
    id: overrides.id,
    source: (overrides.source ?? "jupiter-price") as RawObservationRow["source"],
    sourceObservationKey: overrides.sourceObservationKey ?? `key-${overrides.id}`,
    observedAtUnixMs: overrides.observedAtUnixMs ?? 1000000,
    fetchedAtUnixMs: overrides.fetchedAtUnixMs ?? 1000000,
    payloadHash: overrides.payloadHash ?? `raw-hash-${overrides.id}`,
    payloadCanonical: overrides.payloadCanonical ?? JSON.stringify({ pair: "SOL/USDC" }),
    parseStatus: overrides.parseStatus ?? "parsed",
    sourceRequestMeta: overrides.sourceRequestMeta ?? null,
    receivedAtUnixMs: overrides.receivedAtUnixMs ?? 1000000
  };
}

function makeNormalizedRow(
  overrides: Partial<NormalizedObservationRow> & { id: number; rawObservationId: number }
): NormalizedObservationRow {
  const rawId = overrides.rawObservationId;
  const source = overrides.source ?? "jupiter-price";
  const rawHash = overrides.payloadHash ?? `raw-hash-${rawId}`;

  const provenance: Provenance = overrides.provenance ?? {
    ...DEFAULT_PROVENANCE,
    rawObservationRefs: [
      {
        refType: "raw_observation",
        id: rawId,
        source: source as ProvenanceRef["source"],
        payloadHash: rawHash
      }
    ]
  };

  return {
    id: overrides.id,
    rawObservationId: rawId,
    source: source as NormalizedObservationRow["source"],
    observationKind: (overrides.observationKind ??
      "pool_state") as NormalizedObservationRow["observationKind"],
    signalClass: (overrides.signalClass ?? "deterministic") as SignalClass,
    evidenceFamily: (overrides.evidenceFamily ?? "clmm_state") as EvidenceFamily,
    payload: overrides.payload ?? { pair: "SOL/USDC" },
    payloadHash: overrides.payloadHash ?? `norm-hash-${overrides.id}`,
    confidence: overrides.confidence ?? DEFAULT_CONFIDENCE,
    confidenceComposite: overrides.confidenceComposite ?? null,
    confidenceLevel: overrides.confidenceLevel ?? null,
    validUntilUnixMs: overrides.validUntilUnixMs ?? null,
    isStale: overrides.isStale ?? false,
    staleBehavior: overrides.staleBehavior ?? null,
    provenance,
    receivedAtUnixMs: overrides.receivedAtUnixMs ?? 1000000
  };
}

function makeSlot(
  featureKind: FeatureKind,
  normId: number,
  normSource: string,
  normHash: string,
  outcome: string = "selected_available"
): VerifyPairEvidenceLineageInput["slots"][number] {
  return {
    featureKind,
    outcome,
    provenance: {
      sourceRefs: [],
      rawObservationRefs: [
        {
          refType: "normalized_observation",
          id: normId,
          source: normSource as ProvenanceRef["source"],
          payloadHash: normHash
        }
      ],
      derivedFromRefs: [],
      processRef: {
        collector: "test",
        jobName: "test",
        pipelineRunId: null,
        codeVersion: null,
        modelVersion: null
      },
      codeVersion: "1.0",
      runId: null
    }
  };
}

describe("verifyPairEvidenceLineage", () => {
  it("combines deterministic and contextual lineage without CLMM scope validation", () => {
    const detRaw = makeRawObservationRow({
      id: 5,
      source: "jupiter-price",
      payloadHash: "raw-hash-5"
    });
    const detNorm = makeNormalizedRow({
      id: 15,
      rawObservationId: 5,
      source: "jupiter-price",
      payloadHash: "norm-hash-15",
      provenance: {
        ...DEFAULT_PROVENANCE,
        rawObservationRefs: [
          { refType: "raw_observation", id: 5, source: "jupiter-price", payloadHash: "raw-hash-5" }
        ]
      }
    });

    const ctxRaw = makeRawObservationRow({
      id: 2,
      source: "macro-calendar-api",
      payloadHash: "raw-hash-2"
    });
    const ctxNorm = makeNormalizedRow({
      id: 10,
      rawObservationId: 2,
      source: "macro-calendar-api",
      observationKind: "scheduled_event",
      signalClass: "contextual",
      evidenceFamily: "macro_protocol_risk",
      payloadHash: "norm-hash-10",
      provenance: {
        ...DEFAULT_PROVENANCE,
        rawObservationRefs: [
          {
            refType: "raw_observation",
            id: 2,
            source: "macro-calendar-api",
            payloadHash: "raw-hash-2"
          }
        ]
      }
    });

    const slot = makeSlot("realized_volatility_1h", 15, "jupiter-price", "norm-hash-15");

    const input: VerifyPairEvidenceLineageInput = {
      slots: [slot],
      rawObservations: new Map<number, RawObservationRow>([
        [5, detRaw],
        [2, ctxRaw]
      ]),
      normalizedObservations: new Map<number, NormalizedObservationRow>([[15, detNorm]]),
      contextualObservations: [ctxNorm]
    };

    const result = verifyPairEvidenceLineage(input);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lineage.rawObservationIds).toEqual([2, 5]);
      expect(result.lineage.normalizedObservationIds).toEqual([10, 15]);
      expect(result.lineage.sourceReferences).toHaveLength(2);
      const refIds = result.lineage.sourceReferences.map((r) => r.referenceId);
      expect(refIds).toContain("raw-5");
      expect(refIds).toContain("raw-2");
    }
  });

  it("accepts valid deterministic lineage when contextual observations are empty", () => {
    const detRaw = makeRawObservationRow({
      id: 1,
      source: "jupiter-price",
      payloadHash: "raw-hash-1"
    });
    const detNorm = makeNormalizedRow({
      id: 10,
      rawObservationId: 1,
      source: "jupiter-price",
      payloadHash: "norm-hash-10",
      provenance: {
        ...DEFAULT_PROVENANCE,
        rawObservationRefs: [
          { refType: "raw_observation", id: 1, source: "jupiter-price", payloadHash: "raw-hash-1" }
        ]
      }
    });

    const slot = makeSlot("realized_volatility_1h", 10, "jupiter-price", "norm-hash-10");

    const input: VerifyPairEvidenceLineageInput = {
      slots: [slot],
      rawObservations: new Map<number, RawObservationRow>([[1, detRaw]]),
      normalizedObservations: new Map<number, NormalizedObservationRow>([[10, detNorm]])
    };

    const result = verifyPairEvidenceLineage(input);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lineage.rawObservationIds).toEqual([1]);
      expect(result.lineage.normalizedObservationIds).toEqual([10]);
      expect(result.lineage.sourceReferences).toHaveLength(1);
    }
  });

  it("returns MISSING_NORMALIZED_REFERENCE when pair deterministic lineage cannot be resolved", () => {
    const slot = makeSlot("realized_volatility_1h", 99, "jupiter-price", "norm-hash-99");

    const input: VerifyPairEvidenceLineageInput = {
      slots: [slot],
      rawObservations: new Map<number, RawObservationRow>(),
      normalizedObservations: new Map<number, NormalizedObservationRow>()
    };

    const result = verifyPairEvidenceLineage(input);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("MISSING_NORMALIZED_REFERENCE");
    }
  });
});
