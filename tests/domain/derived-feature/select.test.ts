import { describe, it, expect } from "vitest";
import type {
  Source,
  ObservationKind,
  SignalClass,
  EvidenceFamily,
  Provenance,
  Confidence
} from "../../../src/contracts/taxonomy.js";
import {
  selectLatestBySourceAndKind,
  selectVolatilityTimestamps,
  selectWithExpiryCheck,
  SELECTION_VERSION
} from "../../../src/domain/derived-feature/select.js";
import type { NormalizedObservationRow } from "../../../src/ports/normalized-observation-repo.js";

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

function makeRow(
  overrides: Partial<NormalizedObservationRow> & {
    id: number;
    source: Source;
    observationKind: ObservationKind;
    receivedAtUnixMs: number;
  }
): NormalizedObservationRow {
  return {
    id: overrides.id,
    rawObservationId: overrides.rawObservationId ?? 0,
    source: overrides.source,
    observationKind: overrides.observationKind,
    signalClass: (overrides.signalClass ?? "deterministic") as SignalClass,
    evidenceFamily: (overrides.evidenceFamily ?? "clmm_state") as EvidenceFamily,
    payload: overrides.payload ?? { price: 100 },
    payloadHash: overrides.payloadHash ?? `hash-${overrides.id}`,
    confidence: overrides.confidence ?? DEFAULT_CONFIDENCE,
    confidenceComposite: overrides.confidenceComposite ?? null,
    confidenceLevel: overrides.confidenceLevel ?? null,
    validUntilUnixMs: overrides.validUntilUnixMs ?? null,
    isStale: overrides.isStale ?? false,
    staleBehavior: overrides.staleBehavior ?? null,
    provenance: overrides.provenance ?? DEFAULT_PROVENANCE,
    receivedAtUnixMs: overrides.receivedAtUnixMs
  };
}

describe("selectors", () => {
  describe("SELECTION_VERSION", () => {
    it("is a valid non-empty string", () => {
      expect(typeof SELECTION_VERSION).toBe("string");
      expect(SELECTION_VERSION.length).toBeGreaterThan(0);
    });

    it("is deterministic across calls", () => {
      expect(SELECTION_VERSION).toBe(SELECTION_VERSION);
    });
  });

  describe("selectLatestBySourceAndKind", () => {
    it("returns empty selection when no candidates provided", () => {
      const result = selectLatestBySourceAndKind([], 1000);
      expect(result.selected).toHaveLength(0);
      expect(result.rejected).toHaveLength(0);
    });

    it("selects single candidate as latest", () => {
      const candidates = [
        makeRow({
          id: 1,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: 1000
        })
      ];
      const result = selectLatestBySourceAndKind(candidates, 2000);
      expect(result.selected).toHaveLength(1);
      expect(result.selected[0]!.id).toBe(1);
      expect(result.rejected).toHaveLength(0);
    });

    it("selects latest by receivedAtUnixMs ascending then id", () => {
      const candidates = [
        makeRow({
          id: 3,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: 1000
        }),
        makeRow({
          id: 1,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: 3000
        }),
        makeRow({
          id: 2,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: 2000
        })
      ];
      const result = selectLatestBySourceAndKind(candidates, 5000);
      expect(result.selected).toHaveLength(1);
      expect(result.selected[0]!.id).toBe(1);
      expect(result.selected[0]!.receivedAtUnixMs).toBe(3000);
    });

    it("rejects a persisted-fresh row that expired by evaluation time", () => {
      const candidates = [
        makeRow({
          id: 1,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: 1000,
          isStale: false,
          validUntilUnixMs: 1500
        })
      ];
      const result = selectLatestBySourceAndKind(candidates, 2000);
      expect(result.selected).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0]!.reason).toContain("expired");
    });

    it("accepts a row that is fresh at evaluation time even if isStale is true", () => {
      const candidates = [
        makeRow({
          id: 1,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: 1000,
          isStale: true,
          validUntilUnixMs: 5000
        })
      ];
      const result = selectLatestBySourceAndKind(candidates, 3000);
      expect(result.selected).toHaveLength(1);
      expect(result.rejected).toHaveLength(0);
    });

    it("records wrong-source candidates deterministically", () => {
      const candidates = [
        makeRow({
          id: 1,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: 1000
        }),
        makeRow({
          id: 2,
          source: "jupiter-price",
          observationKind: "pool_state",
          receivedAtUnixMs: 1000
        })
      ];
      const result = selectLatestBySourceAndKind(candidates, 2000, {
        allowedSources: [{ source: "clmm-v2-bundle", observationKind: "pool_state" }]
      });
      expect(result.selected).toHaveLength(1);
      expect(result.selected[0]!.id).toBe(1);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0]!.observationId).toBe(2);
    });

    it("records wrong-kind candidates deterministically", () => {
      const candidates = [
        makeRow({
          id: 1,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: 1000
        }),
        makeRow({
          id: 2,
          source: "clmm-v2-bundle",
          observationKind: "position_state",
          receivedAtUnixMs: 1000
        })
      ];
      const result = selectLatestBySourceAndKind(candidates, 2000, {
        allowedSources: [{ source: "clmm-v2-bundle", observationKind: "pool_state" }]
      });
      expect(result.selected).toHaveLength(1);
      expect(result.selected[0]!.id).toBe(1);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0]!.observationId).toBe(2);
    });

    it("produces stable results regardless of input order", () => {
      const candidatesA = [
        makeRow({
          id: 2,
          source: "jupiter-price",
          observationKind: "pool_state",
          receivedAtUnixMs: 1000
        }),
        makeRow({
          id: 1,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: 1000
        })
      ];
      const candidatesB = [
        makeRow({
          id: 1,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: 1000
        }),
        makeRow({
          id: 2,
          source: "jupiter-price",
          observationKind: "pool_state",
          receivedAtUnixMs: 1000
        })
      ];

      const resultA = selectLatestBySourceAndKind(candidatesA, 2000, {
        allowedSources: [{ source: "clmm-v2-bundle", observationKind: "pool_state" }]
      });
      const resultB = selectLatestBySourceAndKind(candidatesB, 2000, {
        allowedSources: [{ source: "clmm-v2-bundle", observationKind: "pool_state" }]
      });

      expect(resultA.selected).toEqual(resultB.selected);
      expect(resultA.rejected).toEqual(resultB.rejected);
    });
  });

  describe("selectVolatilityTimestamps", () => {
    it("returns empty when no candidates", () => {
      const result = selectVolatilityTimestamps([], 1000, 3600000);
      expect(result.selected).toHaveLength(0);
      expect(result.rejected).toHaveLength(0);
    });

    it("selects highest slot then receipt time then id for duplicates", () => {
      const candidates = [
        makeRow({
          id: 1,
          source: "pyth-hermes",
          observationKind: "oracle_price",
          receivedAtUnixMs: 1000,
          payload: { observedSource: { slot: 100 } }
        }),
        makeRow({
          id: 2,
          source: "pyth-hermes",
          observationKind: "oracle_price",
          receivedAtUnixMs: 1000,
          payload: { observedSource: { slot: 100 } }
        }),
        makeRow({
          id: 3,
          source: "pyth-hermes",
          observationKind: "oracle_price",
          receivedAtUnixMs: 2000,
          payload: { observedSource: { slot: 100 } }
        })
      ];
      const result = selectVolatilityTimestamps(candidates, 3000, 3600000);
      expect(result.selected).toHaveLength(1);
      expect(result.selected[0]!.id).toBe(2);
      expect(result.rejected).toHaveLength(2);
    });

    it("accepts historical volatility samples while requiring a fresh anchor", () => {
      const now = 5000000000;
      const oneHourAgo = now - 3600000;

      const anchorRow = makeRow({
        id: 1,
        source: "pyth-hermes",
        observationKind: "oracle_price",
        receivedAtUnixMs: now - 60000,
        validUntilUnixMs: now + 300000,
        payload: { observedSource: { slot: 300 } }
      });

      const oldSample = makeRow({
        id: 2,
        source: "pyth-hermes",
        observationKind: "oracle_price",
        receivedAtUnixMs: oneHourAgo + 60000,
        validUntilUnixMs: oneHourAgo,
        payload: { observedSource: { slot: 200 } }
      });

      const candidates = [oldSample, anchorRow];
      const result = selectVolatilityTimestamps(candidates, now, 3600000);

      expect(result.selected).toHaveLength(2);
      const selectedIds = result.selected.map((r) => r.id);
      expect(selectedIds).toContain(1);
      expect(selectedIds).toContain(2);
    });

    it("rejects expired anchor even if within window", () => {
      const now = 5000000000;
      const oneHourAgo = now - 3600000;

      const expiredAnchor = makeRow({
        id: 1,
        source: "pyth-hermes",
        observationKind: "oracle_price",
        receivedAtUnixMs: now - 1000,
        validUntilUnixMs: oneHourAgo,
        payload: { observedSource: { slot: 300 } }
      });

      const freshSample = makeRow({
        id: 2,
        source: "pyth-hermes",
        observationKind: "oracle_price",
        receivedAtUnixMs: now - 60000,
        validUntilUnixMs: now + 300000,
        payload: { observedSource: { slot: 200 } }
      });

      const candidates = [expiredAnchor, freshSample];
      const result = selectVolatilityTimestamps(candidates, now, 3600000);

      expect(result.selected).toHaveLength(1);
      expect(result.selected[0]!.id).toBe(2);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0]!.observationId).toBe(1);
    });

    it("sorts timestamps ascending with discarded IDs auditable", () => {
      const candidates = [
        makeRow({
          id: 3,
          source: "pyth-hermes",
          observationKind: "oracle_price",
          receivedAtUnixMs: 1000,
          payload: { observedSource: { slot: 100 } }
        }),
        makeRow({
          id: 1,
          source: "pyth-hermes",
          observationKind: "oracle_price",
          receivedAtUnixMs: 3000,
          payload: { observedSource: { slot: 300 } }
        }),
        makeRow({
          id: 2,
          source: "pyth-hermes",
          observationKind: "oracle_price",
          receivedAtUnixMs: 2000,
          payload: { observedSource: { slot: 200 } }
        })
      ];
      const result = selectVolatilityTimestamps(candidates, 5000, 3600000);

      expect(result.selected).toHaveLength(3);
      expect(result.selected[0]!.id).toBe(3);
      expect(result.selected[1]!.id).toBe(2);
      expect(result.selected[2]!.id).toBe(1);

      expect(result.rejected).toHaveLength(0);
    });
  });

  describe("selectWithExpiryCheck", () => {
    it("returns empty when no candidates", () => {
      const result = selectWithExpiryCheck([], 1000);
      expect(result.selected).toHaveLength(0);
      expect(result.rejected).toHaveLength(0);
    });

    it("accepts valid candidate", () => {
      const candidates = [
        makeRow({
          id: 1,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: 1000,
          validUntilUnixMs: null
        })
      ];
      const result = selectWithExpiryCheck(candidates, 2000);
      expect(result.selected).toHaveLength(1);
      expect(result.rejected).toHaveLength(0);
    });

    it("rejects expired candidate", () => {
      const candidates = [
        makeRow({
          id: 1,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: 1000,
          validUntilUnixMs: 1500
        })
      ];
      const result = selectWithExpiryCheck(candidates, 2000);
      expect(result.selected).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0]!.reason).toContain("expired");
    });
  });
});
