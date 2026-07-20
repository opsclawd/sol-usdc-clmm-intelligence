import { describe, it, expect } from "vitest";
import type { ProvenanceRef } from "../../../src/contracts/taxonomy.js";
import type { NormalizedObservationRow } from "../../../src/contracts/index.js";
import {
  makeAssembleInput,
  makeNormalizedRow,
  makeConfidence,
  DEFAULT_PROVENANCE
} from "../../helpers/derived-feature-fixtures.js";

const EVAL_AS_OF_MS = 1000000000000;
const CODE_VERSION = "calc-v1";
const RUN_ID = "run-123";

function makeProvenanceRef(
  refType: ProvenanceRef["refType"],
  id: number,
  source: string = "clmm-v2-bundle"
): ProvenanceRef {
  return {
    refType,
    id,
    source: source as ProvenanceRef["source"],
    payloadHash: `hash-${id}`
  };
}

function makeNormalizedRowsWithConfidence(
  ids: number[],
  composite: number
): NormalizedObservationRow[] {
  return ids.map((id) =>
    makeNormalizedRow({
      id,
      source: "clmm-v2-bundle",
      observationKind: "pool_state",
      receivedAtUnixMs: EVAL_AS_OF_MS - 1000,
      validUntilUnixMs: EVAL_AS_OF_MS + 60000,
      confidence: makeConfidence(
        {
          sourceReliability: composite,
          dataCompleteness: composite,
          derivationConfidence: composite
        },
        "v1"
      )
    })
  );
}

describe("assembleDerivedFeature", () => {
  describe("derived confidence never exceeds the weakest selected input", () => {
    it("caps composite at lowest input composite after policy application", async () => {
      const { assembleDerivedFeature } =
        await import("../../../src/domain/derived-feature/assemble.js");
      const inputs = makeNormalizedRowsWithConfidence([1, 2, 3], 0.9);
      inputs[0]!.confidence = makeConfidence({
        sourceReliability: 0.9,
        dataCompleteness: 0.9,
        derivationConfidence: 0.9
      });
      inputs[1]!.confidence = makeConfidence({
        sourceReliability: 0.5,
        dataCompleteness: 0.5,
        derivationConfidence: 0.5
      });
      inputs[2]!.confidence = makeConfidence({
        sourceReliability: 0.3,
        dataCompleteness: 0.3,
        derivationConfidence: 0.3
      });

      const input = makeAssembleInput({
        featureKind: "range_location",
        status: "AVAILABLE",
        value: 500000,
        poolId: "pool123",
        positionId: "pos456",
        inputObservationIds: [1, 2, 3],
        provenance: {
          ...DEFAULT_PROVENANCE,
          sourceRefs: [makeProvenanceRef("normalized_observation", 1)],
          rawObservationRefs: [makeProvenanceRef("raw_observation", 1)]
        }
      });

      const result = await assembleDerivedFeature({
        input,
        selectedRows: inputs,
        rejectedRows: [],
        evaluationAsOfUnixMs: EVAL_AS_OF_MS,
        runId: RUN_ID,
        codeVersion: CODE_VERSION
      });

      const lowestInputComposite = 0.3 * 0.4 + 0.3 * 0.3 + 0.3 * 0.3;
      expect(result.result.confidence.compositeScore).toBeLessThanOrEqual(
        lowestInputComposite + 1e-9
      );
    });

    it("applies partial factor and still caps at lowest input", async () => {
      const { assembleDerivedFeature } =
        await import("../../../src/domain/derived-feature/assemble.js");
      const inputs = makeNormalizedRowsWithConfidence([1, 2], 0.8);
      inputs[0]!.confidence = makeConfidence({
        sourceReliability: 0.8,
        dataCompleteness: 0.8,
        derivationConfidence: 0.8
      });
      inputs[1]!.confidence = makeConfidence({
        sourceReliability: 0.6,
        dataCompleteness: 0.6,
        derivationConfidence: 0.6
      });

      const input = makeAssembleInput({
        featureKind: "range_location",
        status: "PARTIAL",
        value: 250000,
        poolId: "pool123",
        positionId: "pos456",
        inputObservationIds: [1, 2],
        provenance: {
          ...DEFAULT_PROVENANCE,
          sourceRefs: [makeProvenanceRef("normalized_observation", 1)],
          rawObservationRefs: [makeProvenanceRef("raw_observation", 1)]
        },
        reasons: ["degraded_confidence"]
      });

      const result = await assembleDerivedFeature({
        input,
        selectedRows: inputs,
        rejectedRows: [],
        evaluationAsOfUnixMs: EVAL_AS_OF_MS,
        runId: RUN_ID,
        codeVersion: CODE_VERSION
      });

      const lowestInputComposite = 0.6 * 0.4 + 0.6 * 0.3 + 0.6 * 0.3;
      expect(result.result.confidence.compositeScore).toBeLessThanOrEqual(
        lowestInputComposite + 1e-9
      );
      expect(result.result.status).toBe("PARTIAL");
    });
  });

  describe("unavailable confidence has zero derivation confidence", () => {
    it("sets derivation confidence to zero for unavailable results", async () => {
      const { assembleDerivedFeature } =
        await import("../../../src/domain/derived-feature/assemble.js");
      const input = makeAssembleInput({
        featureKind: "range_location",
        status: "UNAVAILABLE",
        value: null,
        poolId: "pool123",
        positionId: "pos456",
        inputObservationIds: [],
        rejectedObservationIds: [],
        provenance: {
          ...DEFAULT_PROVENANCE,
          sourceRefs: [],
          rawObservationRefs: [],
          derivedFromRefs: []
        },
        reasons: ["insufficient_data"]
      });

      const result = await assembleDerivedFeature({
        input,
        selectedRows: [],
        rejectedRows: [],
        evaluationAsOfUnixMs: EVAL_AS_OF_MS,
        runId: RUN_ID,
        codeVersion: CODE_VERSION
      });

      expect(result.result.confidence.components.derivationConfidence).toBe(0);
    });

    it("sets confidence level to low for unavailable", async () => {
      const { assembleDerivedFeature } =
        await import("../../../src/domain/derived-feature/assemble.js");
      const input = makeAssembleInput({
        featureKind: "range_location",
        status: "UNAVAILABLE",
        value: null,
        poolId: "pool123",
        positionId: "pos456",
        inputObservationIds: [],
        reasons: ["insufficient_data"]
      });

      const result = await assembleDerivedFeature({
        input,
        selectedRows: [],
        rejectedRows: [],
        evaluationAsOfUnixMs: EVAL_AS_OF_MS,
        runId: RUN_ID,
        codeVersion: CODE_VERSION
      });

      expect(result.result.confidence.level).toBe("low");
    });

    it("includes required_component_missing reason for unavailable", async () => {
      const { assembleDerivedFeature } =
        await import("../../../src/domain/derived-feature/assemble.js");
      const input = makeAssembleInput({
        featureKind: "range_location",
        status: "UNAVAILABLE",
        value: null,
        poolId: "pool123",
        positionId: "pos456",
        inputObservationIds: [],
        reasons: ["insufficient_data"]
      });

      const result = await assembleDerivedFeature({
        input,
        selectedRows: [],
        rejectedRows: [],
        evaluationAsOfUnixMs: EVAL_AS_OF_MS,
        runId: RUN_ID,
        codeVersion: CODE_VERSION
      });

      expect(result.result.confidence.reasons).toContain("required_component_missing");
    });
  });

  describe("feature expiry is the minimum selected input expiry", () => {
    it("sets expiresAtUnixMs to earliest validUntil among selected inputs for AVAILABLE", async () => {
      const { assembleDerivedFeature } =
        await import("../../../src/domain/derived-feature/assemble.js");
      const inputs = [
        makeNormalizedRow({
          id: 1,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: EVAL_AS_OF_MS - 1000,
          validUntilUnixMs: 1000000060000
        }),
        makeNormalizedRow({
          id: 2,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: EVAL_AS_OF_MS - 1000,
          validUntilUnixMs: 1000000030000
        }),
        makeNormalizedRow({
          id: 3,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: EVAL_AS_OF_MS - 1000,
          validUntilUnixMs: 1000000050000
        })
      ];

      const input = makeAssembleInput({
        featureKind: "range_location",
        status: "AVAILABLE",
        value: 500000,
        poolId: "pool123",
        positionId: "pos456",
        inputObservationIds: [1, 2, 3],
        provenance: {
          ...DEFAULT_PROVENANCE,
          sourceRefs: inputs.map((r) => makeProvenanceRef("normalized_observation", r.id)),
          rawObservationRefs: inputs.map((r) =>
            makeProvenanceRef("raw_observation", r.rawObservationId)
          )
        }
      });

      const result = await assembleDerivedFeature({
        input,
        selectedRows: inputs,
        rejectedRows: [],
        evaluationAsOfUnixMs: EVAL_AS_OF_MS,
        runId: RUN_ID,
        codeVersion: CODE_VERSION
      });

      expect(result.result.expiresAtUnixMs).toBe(1000000030000);
    });

    it("sets expiresAtUnixMs to evaluation time for UNAVAILABLE", async () => {
      const { assembleDerivedFeature } =
        await import("../../../src/domain/derived-feature/assemble.js");
      const input = makeAssembleInput({
        featureKind: "range_location",
        status: "UNAVAILABLE",
        value: null,
        poolId: "pool123",
        positionId: "pos456",
        inputObservationIds: [],
        reasons: ["insufficient_data"]
      });

      const result = await assembleDerivedFeature({
        input,
        selectedRows: [],
        rejectedRows: [],
        evaluationAsOfUnixMs: EVAL_AS_OF_MS,
        runId: RUN_ID,
        codeVersion: CODE_VERSION
      });

      expect(result.result.expiresAtUnixMs).toBe(EVAL_AS_OF_MS);
    });

    it("uses earliest validUntil for PARTIAL status", async () => {
      const { assembleDerivedFeature } =
        await import("../../../src/domain/derived-feature/assemble.js");
      const inputs = [
        makeNormalizedRow({
          id: 1,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: EVAL_AS_OF_MS - 1000,
          validUntilUnixMs: 1000000100000
        }),
        makeNormalizedRow({
          id: 2,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: EVAL_AS_OF_MS - 1000,
          validUntilUnixMs: 1000000020000
        })
      ];

      const input = makeAssembleInput({
        featureKind: "range_location",
        status: "PARTIAL",
        value: 250000,
        poolId: "pool123",
        positionId: "pos456",
        inputObservationIds: [1, 2],
        provenance: {
          ...DEFAULT_PROVENANCE,
          sourceRefs: inputs.map((r) => makeProvenanceRef("normalized_observation", r.id)),
          rawObservationRefs: inputs.map((r) =>
            makeProvenanceRef("raw_observation", r.rawObservationId)
          )
        },
        reasons: ["partial_data"]
      });

      const result = await assembleDerivedFeature({
        input,
        selectedRows: inputs,
        rejectedRows: [],
        evaluationAsOfUnixMs: EVAL_AS_OF_MS,
        runId: RUN_ID,
        codeVersion: CODE_VERSION
      });

      expect(result.result.expiresAtUnixMs).toBe(1000000020000);
    });
  });

  describe("lineage contains every outcome-determining selected or rejected row", () => {
    it("includes all selected normalized rows in lineage", async () => {
      const { assembleDerivedFeature } =
        await import("../../../src/domain/derived-feature/assemble.js");
      const inputs = [
        makeNormalizedRow({
          id: 3,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: EVAL_AS_OF_MS - 1000,
          validUntilUnixMs: 1000000060000
        }),
        makeNormalizedRow({
          id: 1,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: EVAL_AS_OF_MS - 1000,
          validUntilUnixMs: 1000000060000
        }),
        makeNormalizedRow({
          id: 2,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: EVAL_AS_OF_MS - 1000,
          validUntilUnixMs: 1000000060000
        })
      ];

      const input = makeAssembleInput({
        featureKind: "range_location",
        status: "AVAILABLE",
        value: 500000,
        poolId: "pool123",
        positionId: "pos456",
        inputObservationIds: [1, 2, 3],
        provenance: {
          ...DEFAULT_PROVENANCE,
          sourceRefs: inputs.map((r) => makeProvenanceRef("normalized_observation", r.id)),
          rawObservationRefs: inputs.map((r) =>
            makeProvenanceRef("raw_observation", r.rawObservationId)
          )
        }
      });

      const result = await assembleDerivedFeature({
        input,
        selectedRows: inputs,
        rejectedRows: [],
        evaluationAsOfUnixMs: EVAL_AS_OF_MS,
        runId: RUN_ID,
        codeVersion: CODE_VERSION
      });

      const normalizedRefs = result.result.provenance.sourceRefs.filter(
        (r) => r.refType === "normalized_observation"
      );
      const normalizedIds = normalizedRefs.map((r) => r.id).sort((a, b) => a - b);
      expect(normalizedIds).toEqual([1, 2, 3]);
    });

    it("sorts normalized refs by ID", async () => {
      const { assembleDerivedFeature } =
        await import("../../../src/domain/derived-feature/assemble.js");
      const inputs = [
        makeNormalizedRow({
          id: 5,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: EVAL_AS_OF_MS - 1000,
          validUntilUnixMs: 1000000060000
        }),
        makeNormalizedRow({
          id: 2,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: EVAL_AS_OF_MS - 1000,
          validUntilUnixMs: 1000000060000
        })
      ];

      const input = makeAssembleInput({
        featureKind: "range_location",
        status: "AVAILABLE",
        value: 500000,
        poolId: "pool123",
        positionId: "pos456",
        inputObservationIds: [2, 5],
        provenance: {
          ...DEFAULT_PROVENANCE,
          sourceRefs: inputs.map((r) => makeProvenanceRef("normalized_observation", r.id)),
          rawObservationRefs: inputs.map((r) =>
            makeProvenanceRef("raw_observation", r.rawObservationId)
          )
        }
      });

      const result = await assembleDerivedFeature({
        input,
        selectedRows: inputs,
        rejectedRows: [],
        evaluationAsOfUnixMs: EVAL_AS_OF_MS,
        runId: RUN_ID,
        codeVersion: CODE_VERSION
      });

      const normalizedRefs = result.result.provenance.sourceRefs.filter(
        (r) => r.refType === "normalized_observation"
      );
      expect(normalizedRefs.map((r) => r.id)).toEqual([2, 5]);
    });

    it("flattens and de-duplicates raw/source refs from selected rows", async () => {
      const { assembleDerivedFeature } =
        await import("../../../src/domain/derived-feature/assemble.js");
      const inputs = [
        makeNormalizedRow({
          id: 1,
          rawObservationId: 100,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: EVAL_AS_OF_MS - 1000,
          validUntilUnixMs: 1000000060000
        }),
        makeNormalizedRow({
          id: 2,
          rawObservationId: 100,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: EVAL_AS_OF_MS - 1000,
          validUntilUnixMs: 1000000060000
        })
      ];

      const input = makeAssembleInput({
        featureKind: "range_location",
        status: "AVAILABLE",
        value: 500000,
        poolId: "pool123",
        positionId: "pos456",
        inputObservationIds: [1, 2],
        provenance: {
          ...DEFAULT_PROVENANCE,
          sourceRefs: inputs.map((r) => makeProvenanceRef("normalized_observation", r.id)),
          rawObservationRefs: [makeProvenanceRef("raw_observation", 100)]
        }
      });

      const result = await assembleDerivedFeature({
        input,
        selectedRows: inputs,
        rejectedRows: [],
        evaluationAsOfUnixMs: EVAL_AS_OF_MS,
        runId: RUN_ID,
        codeVersion: CODE_VERSION
      });

      const rawRefs = result.result.provenance.rawObservationRefs;
      const rawIds = rawRefs.map((r) => r.id).sort((a, b) => a - b);
      expect(rawIds).toEqual([100]);
    });

    it("includes outcome-determining rejected rows in lineage", async () => {
      const { assembleDerivedFeature } =
        await import("../../../src/domain/derived-feature/assemble.js");
      const inputs = [
        makeNormalizedRow({
          id: 1,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: EVAL_AS_OF_MS - 1000,
          validUntilUnixMs: 1000000060000
        })
      ];
      const rejected = [
        makeNormalizedRow({
          id: 2,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: EVAL_AS_OF_MS - 1000,
          validUntilUnixMs: 1000000060000
        })
      ];

      const input = makeAssembleInput({
        featureKind: "range_location",
        status: "AVAILABLE",
        value: 500000,
        poolId: "pool123",
        positionId: "pos456",
        inputObservationIds: [1],
        rejectedObservationIds: [2],
        provenance: {
          ...DEFAULT_PROVENANCE,
          sourceRefs: [makeProvenanceRef("normalized_observation", 1)],
          rawObservationRefs: [
            makeProvenanceRef("raw_observation", 1),
            makeProvenanceRef("raw_observation", 2)
          ]
        }
      });

      const result = await assembleDerivedFeature({
        input,
        selectedRows: inputs,
        rejectedRows: rejected,
        evaluationAsOfUnixMs: EVAL_AS_OF_MS,
        runId: RUN_ID,
        codeVersion: CODE_VERSION
      });

      const allNormalizedRefs = result.result.provenance.sourceRefs.filter(
        (r) => r.refType === "normalized_observation"
      );
      const allNormalizedIds = allNormalizedRefs.map((r) => r.id).sort((a, b) => a - b);
      expect(allNormalizedIds).toEqual([1, 2]);
    });
  });

  describe("derivation identity changes only when its canonical identity fields change", () => {
    it("derivationKey is stable when non-identity fields change", async () => {
      const { assembleDerivedFeature } =
        await import("../../../src/domain/derived-feature/assemble.js");
      const inputs = [
        makeNormalizedRow({
          id: 1,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: EVAL_AS_OF_MS - 1000,
          validUntilUnixMs: 1000000060000
        })
      ];

      const baseInput = makeAssembleInput({
        featureKind: "range_location",
        status: "AVAILABLE",
        value: 500000,
        poolId: "pool123",
        positionId: "pos456",
        inputObservationIds: [1],
        provenance: {
          ...DEFAULT_PROVENANCE,
          sourceRefs: [makeProvenanceRef("normalized_observation", 1)],
          rawObservationRefs: [makeProvenanceRef("raw_observation", 1)]
        }
      });

      const result1 = await assembleDerivedFeature({
        input: baseInput,
        selectedRows: inputs,
        rejectedRows: [],
        evaluationAsOfUnixMs: EVAL_AS_OF_MS,
        runId: RUN_ID,
        codeVersion: CODE_VERSION
      });

      const changedInput = makeAssembleInput({
        ...baseInput,
        warnings: ["some_warning"],
        calculationMetadata: { extra: "data" }
      });

      const result2 = await assembleDerivedFeature({
        input: changedInput,
        selectedRows: inputs,
        rejectedRows: [],
        evaluationAsOfUnixMs: EVAL_AS_OF_MS,
        runId: RUN_ID,
        codeVersion: CODE_VERSION
      });

      expect(result1.derivationKey).toBe(result2.derivationKey);
      expect(result1.payloadHash).not.toBe(result2.payloadHash);
    });

    it("derivationKey changes when schema changes", async () => {
      const { assembleDerivedFeature } =
        await import("../../../src/domain/derived-feature/assemble.js");
      const inputs = [
        makeNormalizedRow({
          id: 1,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: EVAL_AS_OF_MS - 1000,
          validUntilUnixMs: 1000000060000
        })
      ];

      const input1 = makeAssembleInput({
        featureKind: "range_location",
        status: "AVAILABLE",
        value: 500000,
        poolId: "pool123",
        positionId: "pos456",
        inputObservationIds: [1],
        provenance: {
          ...DEFAULT_PROVENANCE,
          sourceRefs: [makeProvenanceRef("normalized_observation", 1)],
          rawObservationRefs: [makeProvenanceRef("raw_observation", 1)]
        }
      });

      const input2 = makeAssembleInput({
        featureKind: "distance_to_lower",
        status: "AVAILABLE",
        value: 500000,
        poolId: "pool123",
        positionId: "pos456",
        inputObservationIds: [1],
        provenance: {
          ...DEFAULT_PROVENANCE,
          sourceRefs: [makeProvenanceRef("normalized_observation", 1)],
          rawObservationRefs: [makeProvenanceRef("raw_observation", 1)]
        }
      });

      const result1 = await assembleDerivedFeature({
        input: input1,
        selectedRows: inputs,
        rejectedRows: [],
        evaluationAsOfUnixMs: EVAL_AS_OF_MS,
        runId: RUN_ID,
        codeVersion: CODE_VERSION
      });

      const result2 = await assembleDerivedFeature({
        input: input2,
        selectedRows: inputs,
        rejectedRows: [],
        evaluationAsOfUnixMs: EVAL_AS_OF_MS,
        runId: RUN_ID,
        codeVersion: CODE_VERSION
      });

      expect(result1.derivationKey).not.toBe(result2.derivationKey);
    });

    it("derivationKey changes when selected IDs change", async () => {
      const { assembleDerivedFeature } =
        await import("../../../src/domain/derived-feature/assemble.js");
      const inputs1 = [
        makeNormalizedRow({
          id: 1,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: EVAL_AS_OF_MS - 1000,
          validUntilUnixMs: 1000000060000
        })
      ];
      const inputs2 = [
        makeNormalizedRow({
          id: 2,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: EVAL_AS_OF_MS - 1000,
          validUntilUnixMs: 1000000060000
        })
      ];

      const input1 = makeAssembleInput({
        featureKind: "range_location",
        status: "AVAILABLE",
        value: 500000,
        poolId: "pool123",
        positionId: "pos456",
        inputObservationIds: [1],
        provenance: {
          ...DEFAULT_PROVENANCE,
          sourceRefs: [makeProvenanceRef("normalized_observation", 1)],
          rawObservationRefs: [makeProvenanceRef("raw_observation", 1)]
        }
      });

      const input2 = makeAssembleInput({
        featureKind: "range_location",
        status: "AVAILABLE",
        value: 500000,
        poolId: "pool123",
        positionId: "pos456",
        inputObservationIds: [2],
        provenance: {
          ...DEFAULT_PROVENANCE,
          sourceRefs: [makeProvenanceRef("normalized_observation", 2)],
          rawObservationRefs: [makeProvenanceRef("raw_observation", 2)]
        }
      });

      const result1 = await assembleDerivedFeature({
        input: input1,
        selectedRows: inputs1,
        rejectedRows: [],
        evaluationAsOfUnixMs: EVAL_AS_OF_MS,
        runId: RUN_ID,
        codeVersion: CODE_VERSION
      });

      const result2 = await assembleDerivedFeature({
        input: input2,
        selectedRows: inputs2,
        rejectedRows: [],
        evaluationAsOfUnixMs: EVAL_AS_OF_MS,
        runId: RUN_ID,
        codeVersion: CODE_VERSION
      });

      expect(result1.derivationKey).not.toBe(result2.derivationKey);
    });

    it("derivationKey changes when rejected IDs change", async () => {
      const { assembleDerivedFeature } =
        await import("../../../src/domain/derived-feature/assemble.js");
      const inputs = [
        makeNormalizedRow({
          id: 1,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: EVAL_AS_OF_MS - 1000,
          validUntilUnixMs: 1000000060000
        })
      ];
      const rejected1 = [
        makeNormalizedRow({
          id: 2,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: EVAL_AS_OF_MS - 1000,
          validUntilUnixMs: 1000000060000
        })
      ];
      const rejected2 = [
        makeNormalizedRow({
          id: 3,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: EVAL_AS_OF_MS - 1000,
          validUntilUnixMs: 1000000060000
        })
      ];

      const baseInput = makeAssembleInput({
        featureKind: "range_location",
        status: "AVAILABLE",
        value: 500000,
        poolId: "pool123",
        positionId: "pos456",
        inputObservationIds: [1],
        provenance: {
          ...DEFAULT_PROVENANCE,
          sourceRefs: [makeProvenanceRef("normalized_observation", 1)],
          rawObservationRefs: [makeProvenanceRef("raw_observation", 1)]
        }
      });

      const input1 = makeAssembleInput({
        ...baseInput,
        rejectedObservationIds: [2]
      });

      const input2 = makeAssembleInput({
        ...baseInput,
        rejectedObservationIds: [3]
      });

      const result1 = await assembleDerivedFeature({
        input: input1,
        selectedRows: inputs,
        rejectedRows: rejected1,
        evaluationAsOfUnixMs: EVAL_AS_OF_MS,
        runId: RUN_ID,
        codeVersion: CODE_VERSION
      });

      const result2 = await assembleDerivedFeature({
        input: input2,
        selectedRows: inputs,
        rejectedRows: rejected2,
        evaluationAsOfUnixMs: EVAL_AS_OF_MS,
        runId: RUN_ID,
        codeVersion: CODE_VERSION
      });

      expect(result1.derivationKey).not.toBe(result2.derivationKey);
    });

    it("payloadHash changes when complete result content changes", async () => {
      const { assembleDerivedFeature } =
        await import("../../../src/domain/derived-feature/assemble.js");
      const inputs = [
        makeNormalizedRow({
          id: 1,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: EVAL_AS_OF_MS - 1000,
          validUntilUnixMs: 1000000060000
        })
      ];

      const input1 = makeAssembleInput({
        featureKind: "range_location",
        status: "AVAILABLE",
        value: 500000,
        poolId: "pool123",
        positionId: "pos456",
        inputObservationIds: [1],
        provenance: {
          ...DEFAULT_PROVENANCE,
          sourceRefs: [makeProvenanceRef("normalized_observation", 1)],
          rawObservationRefs: [makeProvenanceRef("raw_observation", 1)]
        }
      });

      const input2 = makeAssembleInput({
        featureKind: "range_location",
        status: "AVAILABLE",
        value: 600000,
        poolId: "pool123",
        positionId: "pos456",
        inputObservationIds: [1],
        provenance: {
          ...DEFAULT_PROVENANCE,
          sourceRefs: [makeProvenanceRef("normalized_observation", 1)],
          rawObservationRefs: [makeProvenanceRef("raw_observation", 1)]
        }
      });

      const result1 = await assembleDerivedFeature({
        input: input1,
        selectedRows: inputs,
        rejectedRows: [],
        evaluationAsOfUnixMs: EVAL_AS_OF_MS,
        runId: RUN_ID,
        codeVersion: CODE_VERSION
      });

      const result2 = await assembleDerivedFeature({
        input: input2,
        selectedRows: inputs,
        rejectedRows: [],
        evaluationAsOfUnixMs: EVAL_AS_OF_MS,
        runId: RUN_ID,
        codeVersion: CODE_VERSION
      });

      expect(result1.payloadHash).not.toBe(result2.payloadHash);
    });

    it("derivationKey is stable across identical runs with same inputs", async () => {
      const { assembleDerivedFeature } =
        await import("../../../src/domain/derived-feature/assemble.js");
      const inputs = [
        makeNormalizedRow({
          id: 1,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: EVAL_AS_OF_MS - 1000,
          validUntilUnixMs: 1000000060000
        })
      ];

      const input = makeAssembleInput({
        featureKind: "range_location",
        status: "AVAILABLE",
        value: 500000,
        poolId: "pool123",
        positionId: "pos456",
        inputObservationIds: [1],
        provenance: {
          ...DEFAULT_PROVENANCE,
          sourceRefs: [makeProvenanceRef("normalized_observation", 1)],
          rawObservationRefs: [makeProvenanceRef("raw_observation", 1)]
        }
      });

      const result1 = await assembleDerivedFeature({
        input,
        selectedRows: inputs,
        rejectedRows: [],
        evaluationAsOfUnixMs: EVAL_AS_OF_MS,
        runId: RUN_ID,
        codeVersion: CODE_VERSION
      });

      const result2 = await assembleDerivedFeature({
        input,
        selectedRows: inputs,
        rejectedRows: [],
        evaluationAsOfUnixMs: EVAL_AS_OF_MS,
        runId: RUN_ID,
        codeVersion: CODE_VERSION
      });

      expect(result1.derivationKey).toBe(result2.derivationKey);
      expect(result1.payloadHash).toBe(result2.payloadHash);
    });
  });

  describe("process ref", () => {
    it("uses deterministic-feature-derivation collector", async () => {
      const { assembleDerivedFeature } =
        await import("../../../src/domain/derived-feature/assemble.js");
      const input = makeAssembleInput({
        featureKind: "range_location",
        status: "AVAILABLE",
        value: 500000,
        poolId: "pool123",
        positionId: "pos456",
        inputObservationIds: [1],
        provenance: {
          ...DEFAULT_PROVENANCE,
          sourceRefs: [makeProvenanceRef("normalized_observation", 1)],
          rawObservationRefs: [makeProvenanceRef("raw_observation", 1)]
        }
      });

      const result = await assembleDerivedFeature({
        input,
        selectedRows: [
          makeNormalizedRow({
            id: 1,
            source: "clmm-v2-bundle",
            observationKind: "pool_state",
            receivedAtUnixMs: EVAL_AS_OF_MS - 1000,
            validUntilUnixMs: 1000000060000
          })
        ],
        rejectedRows: [],
        evaluationAsOfUnixMs: EVAL_AS_OF_MS,
        runId: RUN_ID,
        codeVersion: CODE_VERSION
      });

      expect(result.result.provenance.processRef.collector).toBe(
        "deterministic-feature-derivation"
      );
      expect(result.result.provenance.processRef.jobName).toBe("derive-mvp-features");
    });

    it("includes pipelineRunId and codeVersion in process ref", async () => {
      const { assembleDerivedFeature } =
        await import("../../../src/domain/derived-feature/assemble.js");
      const input = makeAssembleInput({
        featureKind: "range_location",
        status: "AVAILABLE",
        value: 500000,
        poolId: "pool123",
        positionId: "pos456",
        inputObservationIds: [1],
        provenance: {
          ...DEFAULT_PROVENANCE,
          sourceRefs: [makeProvenanceRef("normalized_observation", 1)],
          rawObservationRefs: [makeProvenanceRef("raw_observation", 1)]
        }
      });

      const result = await assembleDerivedFeature({
        input,
        selectedRows: [
          makeNormalizedRow({
            id: 1,
            source: "clmm-v2-bundle",
            observationKind: "pool_state",
            receivedAtUnixMs: EVAL_AS_OF_MS - 1000,
            validUntilUnixMs: 1000000060000
          })
        ],
        rejectedRows: [],
        evaluationAsOfUnixMs: EVAL_AS_OF_MS,
        runId: RUN_ID,
        codeVersion: CODE_VERSION
      });

      expect(result.result.provenance.processRef.pipelineRunId).toBe(RUN_ID);
      expect(result.result.provenance.processRef.codeVersion).toBe(CODE_VERSION);
      expect(result.result.provenance.processRef.modelVersion).toBeNull();
    });
  });

  describe("hash stability", () => {
    it("produces deterministic derivationKey across invocations", async () => {
      const { assembleDerivedFeature } =
        await import("../../../src/domain/derived-feature/assemble.js");
      const inputs = [
        makeNormalizedRow({
          id: 1,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: EVAL_AS_OF_MS - 1000,
          validUntilUnixMs: 1000000060000
        })
      ];

      const input = makeAssembleInput({
        featureKind: "range_location",
        status: "AVAILABLE",
        value: 500000,
        poolId: "pool123",
        positionId: "pos456",
        inputObservationIds: [1],
        provenance: {
          ...DEFAULT_PROVENANCE,
          sourceRefs: [makeProvenanceRef("normalized_observation", 1)],
          rawObservationRefs: [makeProvenanceRef("raw_observation", 1)]
        }
      });

      const keys = new Set<string>();
      for (let i = 0; i < 5; i++) {
        const result = await assembleDerivedFeature({
          input,
          selectedRows: inputs,
          rejectedRows: [],
          evaluationAsOfUnixMs: EVAL_AS_OF_MS,
          runId: RUN_ID,
          codeVersion: CODE_VERSION
        });
        keys.add(result.derivationKey);
      }
      expect(keys.size).toBe(1);
    });

    it("produces deterministic payloadHash across invocations", async () => {
      const { assembleDerivedFeature } =
        await import("../../../src/domain/derived-feature/assemble.js");
      const inputs = [
        makeNormalizedRow({
          id: 1,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: EVAL_AS_OF_MS - 1000,
          validUntilUnixMs: 1000000060000
        })
      ];

      const input = makeAssembleInput({
        featureKind: "range_location",
        status: "AVAILABLE",
        value: 500000,
        poolId: "pool123",
        positionId: "pos456",
        inputObservationIds: [1],
        provenance: {
          ...DEFAULT_PROVENANCE,
          sourceRefs: [makeProvenanceRef("normalized_observation", 1)],
          rawObservationRefs: [makeProvenanceRef("raw_observation", 1)]
        }
      });

      const hashes = new Set<string>();
      for (let i = 0; i < 5; i++) {
        const result = await assembleDerivedFeature({
          input,
          selectedRows: inputs,
          rejectedRows: [],
          evaluationAsOfUnixMs: EVAL_AS_OF_MS,
          runId: RUN_ID,
          codeVersion: CODE_VERSION
        });
        hashes.add(result.payloadHash);
      }
      expect(hashes.size).toBe(1);
    });
  });
});

describe("FeatureCalculation", () => {
  describe("status-aware provenance checks", () => {
    it("returns AVAILABLE with valid input references", async () => {
      const { assembleDerivedFeature } =
        await import("../../../src/domain/derived-feature/assemble.js");
      const inputs = [
        makeNormalizedRow({
          id: 1,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          receivedAtUnixMs: EVAL_AS_OF_MS - 1000,
          validUntilUnixMs: 1000000060000
        })
      ];

      const input = makeAssembleInput({
        featureKind: "range_location",
        status: "AVAILABLE",
        value: 500000,
        poolId: "pool123",
        positionId: "pos456",
        inputObservationIds: [1],
        provenance: {
          ...DEFAULT_PROVENANCE,
          sourceRefs: [makeProvenanceRef("normalized_observation", 1)],
          rawObservationRefs: [makeProvenanceRef("raw_observation", 1)]
        }
      });

      const result = await assembleDerivedFeature({
        input,
        selectedRows: inputs,
        rejectedRows: [],
        evaluationAsOfUnixMs: EVAL_AS_OF_MS,
        runId: RUN_ID,
        codeVersion: CODE_VERSION
      });

      expect(result.result.status).toBe("AVAILABLE");
      expect(result.result.value).toBe(500000);
    });

    it("rejects UNAVAILABLE without input references but with reasons", async () => {
      const { assembleDerivedFeature } =
        await import("../../../src/domain/derived-feature/assemble.js");
      const input = makeAssembleInput({
        featureKind: "range_location",
        status: "UNAVAILABLE",
        value: null,
        poolId: "pool123",
        positionId: "pos456",
        inputObservationIds: [],
        provenance: {
          ...DEFAULT_PROVENANCE,
          sourceRefs: [],
          rawObservationRefs: [],
          derivedFromRefs: []
        },
        reasons: ["insufficient_data"]
      });

      const result = await assembleDerivedFeature({
        input,
        selectedRows: [],
        rejectedRows: [],
        evaluationAsOfUnixMs: EVAL_AS_OF_MS,
        runId: RUN_ID,
        codeVersion: CODE_VERSION
      });

      expect(result.result.status).toBe("UNAVAILABLE");
      expect(result.result.value).toBeNull();
    });
  });
});
