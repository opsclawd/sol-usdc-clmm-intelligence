import { describe, it, expect } from "vitest";
import type {
  SignalClass,
  EvidenceFamily,
  Confidence,
  Provenance,
  ProvenanceRef
} from "../../../src/contracts/taxonomy.js";
import type { NormalizedObservationRow } from "../../../src/ports/index.js";
import type { RawObservationRow } from "../../../src/ports/observation-repo.js";
import { verifyContextualEvidenceLineage } from "../../../src/domain/evidence-bundle/lineage.js";

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
    source: (overrides.source ?? "macro-calendar-api") as RawObservationRow["source"],
    sourceObservationKey: overrides.sourceObservationKey ?? `key-${overrides.id}`,
    observedAtUnixMs: overrides.observedAtUnixMs ?? 1000000,
    fetchedAtUnixMs: overrides.fetchedAtUnixMs ?? 1000000,
    payloadHash: overrides.payloadHash ?? `raw-hash-${overrides.id}`,
    payloadCanonical: overrides.payloadCanonical ?? JSON.stringify({ title: "FOMC Meeting" }),
    parseStatus: overrides.parseStatus ?? "parsed",
    sourceRequestMeta: overrides.sourceRequestMeta ?? null,
    receivedAtUnixMs: overrides.receivedAtUnixMs ?? 1000000
  };
}

function makeNormalizedRow(
  overrides: Partial<NormalizedObservationRow> & { id: number; rawObservationId: number }
): NormalizedObservationRow {
  const rawId = overrides.rawObservationId;
  const source = overrides.source ?? "macro-calendar-api";
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
      "scheduled_event") as NormalizedObservationRow["observationKind"],
    signalClass: (overrides.signalClass ?? "contextual") as SignalClass,
    evidenceFamily: (overrides.evidenceFamily ?? "macro_events") as EvidenceFamily,
    payload: overrides.payload ?? { title: "FOMC Meeting" },
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

describe("verifyContextualEvidenceLineage", () => {
  it("verifies a valid selected normalized/raw contextual pair", () => {
    const rawRow = makeRawObservationRow({
      id: 1,
      source: "macro-calendar-api",
      payloadHash: "hash-1"
    });
    const normRow = makeNormalizedRow({
      id: 10,
      rawObservationId: 1,
      source: "macro-calendar-api",
      observationKind: "scheduled_event",
      provenance: {
        ...DEFAULT_PROVENANCE,
        rawObservationRefs: [
          { refType: "raw_observation", id: 1, source: "macro-calendar-api", payloadHash: "hash-1" }
        ]
      }
    });

    const rawMap = new Map<number, RawObservationRow>([[1, rawRow]]);
    const result = verifyContextualEvidenceLineage({
      contextualObservations: [normRow],
      rawObservations: rawMap
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lineage.rawObservationIds).toEqual([1]);
      expect(result.lineage.normalizedObservationIds).toEqual([10]);
      expect(result.lineage.sourceReferences).toHaveLength(1);
      expect(result.lineage.sourceReferences[0]).toMatchObject({
        referenceId: "raw-1",
        sourceType: "api",
        locator: "key-1"
      });
    }
  });

  it("verifies a valid Helius dex_net_flow contextual observation with raw parent", () => {
    const rawRow = makeRawObservationRow({
      id: 2,
      source: "helius-api",
      payloadHash: "hash-helius-dex"
    });
    const normRow = makeNormalizedRow({
      id: 20,
      rawObservationId: 2,
      source: "helius-api",
      observationKind: "dex_net_flow",
      provenance: {
        ...DEFAULT_PROVENANCE,
        rawObservationRefs: [
          {
            refType: "raw_observation",
            id: 2,
            source: "helius-api",
            payloadHash: "hash-helius-dex"
          }
        ]
      }
    });

    const rawMap = new Map<number, RawObservationRow>([[2, rawRow]]);
    const result = verifyContextualEvidenceLineage({
      contextualObservations: [normRow],
      rawObservations: rawMap
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lineage.rawObservationIds).toEqual([2]);
      expect(result.lineage.normalizedObservationIds).toEqual([20]);
    }
  });

  it("records MISSING_RAW_PARENT in excludedObservations when raw parent observation is missing", () => {
    const normRow = makeNormalizedRow({
      id: 10,
      rawObservationId: 1,
      source: "macro-calendar-api",
      observationKind: "scheduled_event"
    });

    const result = verifyContextualEvidenceLineage({
      contextualObservations: [normRow],
      rawObservations: new Map()
    });

    expect(result.ok).toBe(true);
    expect(result.validObservations).toHaveLength(0);
    expect(result.excludedObservations).toHaveLength(1);
    expect(result.excludedObservations[0]?.error.code).toBe("MISSING_RAW_PARENT");
  });

  it("records PROVENANCE_SOURCE_MISMATCH in excludedObservations when raw source disagrees with normalized source", () => {
    const rawRow = makeRawObservationRow({
      id: 1,
      source: "crypto-news-api",
      payloadHash: "hash-1"
    });
    const normRow = makeNormalizedRow({
      id: 10,
      rawObservationId: 1,
      source: "macro-calendar-api",
      observationKind: "scheduled_event"
    });

    const rawMap = new Map<number, RawObservationRow>([[1, rawRow]]);
    const result = verifyContextualEvidenceLineage({
      contextualObservations: [normRow],
      rawObservations: rawMap
    });

    expect(result.ok).toBe(true);
    expect(result.validObservations).toHaveLength(0);
    expect(result.excludedObservations).toHaveLength(1);
    expect(result.excludedObservations[0]?.error.code).toBe("PROVENANCE_SOURCE_MISMATCH");
  });

  it("records PROVENANCE_HASH_MISMATCH in excludedObservations when provenance payload hash disagrees", () => {
    const rawRow = makeRawObservationRow({
      id: 1,
      source: "macro-calendar-api",
      payloadHash: "raw-hash-1"
    });
    const normRow = makeNormalizedRow({
      id: 10,
      rawObservationId: 1,
      source: "macro-calendar-api",
      observationKind: "scheduled_event",
      provenance: {
        ...DEFAULT_PROVENANCE,
        rawObservationRefs: [
          {
            refType: "raw_observation",
            id: 1,
            source: "macro-calendar-api",
            payloadHash: "wrong-hash"
          }
        ]
      }
    });

    const rawMap = new Map<number, RawObservationRow>([[1, rawRow]]);
    const result = verifyContextualEvidenceLineage({
      contextualObservations: [normRow],
      rawObservations: rawMap
    });

    expect(result.ok).toBe(true);
    expect(result.validObservations).toHaveLength(0);
    expect(result.excludedObservations).toHaveLength(1);
    expect(result.excludedObservations[0]?.error.code).toBe("PROVENANCE_HASH_MISMATCH");
  });

  it("records UNSUPPORTED_CONTEXTUAL_KIND in excludedObservations for an observation kind outside the pair-safe matrix", () => {
    const rawRow = makeRawObservationRow({
      id: 1,
      source: "clmm-v2-bundle",
      payloadHash: "hash-1"
    });
    const normRow = makeNormalizedRow({
      id: 10,
      rawObservationId: 1,
      source: "clmm-v2-bundle",
      observationKind: "pool_state" as NormalizedObservationRow["observationKind"]
    });

    const rawMap = new Map<number, RawObservationRow>([[1, rawRow]]);
    const result = verifyContextualEvidenceLineage({
      contextualObservations: [normRow],
      rawObservations: rawMap
    });

    expect(result.ok).toBe(true);
    expect(result.validObservations).toHaveLength(0);
    expect(result.excludedObservations).toHaveLength(1);
    expect(result.excludedObservations[0]?.error.code).toBe("UNSUPPORTED_CONTEXTUAL_KIND");
  });

  it("sorts raw and normalized observation IDs deterministically", () => {
    const rawRow1 = makeRawObservationRow({
      id: 5,
      source: "macro-calendar-api",
      payloadHash: "hash-5"
    });
    const rawRow2 = makeRawObservationRow({
      id: 2,
      source: "solana-status-api",
      payloadHash: "hash-2"
    });
    const rawRow3 = makeRawObservationRow({
      id: 8,
      source: "crypto-news-api",
      payloadHash: "hash-8"
    });

    const normRow1 = makeNormalizedRow({
      id: 30,
      rawObservationId: 5,
      source: "macro-calendar-api",
      observationKind: "scheduled_event",
      provenance: {
        ...DEFAULT_PROVENANCE,
        rawObservationRefs: [
          { refType: "raw_observation", id: 5, source: "macro-calendar-api", payloadHash: "hash-5" }
        ]
      }
    });
    const normRow2 = makeNormalizedRow({
      id: 10,
      rawObservationId: 2,
      source: "solana-status-api",
      observationKind: "protocol_incident",
      provenance: {
        ...DEFAULT_PROVENANCE,
        rawObservationRefs: [
          { refType: "raw_observation", id: 2, source: "solana-status-api", payloadHash: "hash-2" }
        ]
      }
    });
    const normRow3 = makeNormalizedRow({
      id: 20,
      rawObservationId: 8,
      source: "crypto-news-api",
      observationKind: "ecosystem_news",
      provenance: {
        ...DEFAULT_PROVENANCE,
        rawObservationRefs: [
          { refType: "raw_observation", id: 8, source: "crypto-news-api", payloadHash: "hash-8" }
        ]
      }
    });

    const rawMap = new Map<number, RawObservationRow>([
      [5, rawRow1],
      [2, rawRow2],
      [8, rawRow3]
    ]);

    const result = verifyContextualEvidenceLineage({
      contextualObservations: [normRow1, normRow2, normRow3],
      rawObservations: rawMap
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lineage.rawObservationIds).toEqual([2, 5, 8]);
      expect(result.lineage.normalizedObservationIds).toEqual([10, 20, 30]);
    }
  });

  it("handles duplicate raw references across multiple normalized rows gracefully", () => {
    const rawRow = makeRawObservationRow({ id: 1, source: "helius-api", payloadHash: "hash-1" });
    const normRow1 = makeNormalizedRow({
      id: 10,
      rawObservationId: 1,
      source: "helius-api",
      observationKind: "whale_transfer",
      provenance: {
        ...DEFAULT_PROVENANCE,
        rawObservationRefs: [
          { refType: "raw_observation", id: 1, source: "helius-api", payloadHash: "hash-1" }
        ]
      }
    });
    const normRow2 = makeNormalizedRow({
      id: 11,
      rawObservationId: 1,
      source: "helius-api",
      observationKind: "whale_swap",
      provenance: {
        ...DEFAULT_PROVENANCE,
        rawObservationRefs: [
          { refType: "raw_observation", id: 1, source: "helius-api", payloadHash: "hash-1" }
        ]
      }
    });

    const rawMap = new Map<number, RawObservationRow>([[1, rawRow]]);
    const result = verifyContextualEvidenceLineage({
      contextualObservations: [normRow1, normRow2],
      rawObservations: rawMap
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lineage.rawObservationIds).toEqual([1]);
      expect(result.lineage.normalizedObservationIds).toEqual([10, 11]);
      expect(result.lineage.sourceReferences).toHaveLength(1);
    }
  });
});
