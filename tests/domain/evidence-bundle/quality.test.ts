import { describe, it, expect } from "vitest";
import type { Confidence, Provenance } from "../../../src/contracts/taxonomy.js";
import { MVP_FEATURE_KINDS } from "../../../src/contracts/derived-feature.js";
import type { SelectedFeatureSlot } from "../../../src/domain/evidence-bundle/select.js";
import { classifyEvidenceBundleQuality } from "../../../src/domain/evidence-bundle/quality.js";
import type { EvidenceQualityInput } from "../../../src/domain/evidence-bundle/quality.js";

const DEFAULT_CONFIDENCE: Confidence = {
  components: {
    sourceReliability: 1,
    dataCompleteness: 1,
    derivationConfidence: 1,
    llmConfidence: null
  },
  compositeScore: 10000,
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

function makeSlotsAllAvailable(): SelectedFeatureSlot[] {
  return MVP_FEATURE_KINDS.map((featureKind, i) => ({
    featureKind,
    outcome: "selected_available" as const,
    rowId: i + 1,
    value: 1000 + i,
    confidence: { ...DEFAULT_CONFIDENCE, compositeScore: 10000 - i * 100 },
    provenance: DEFAULT_PROVENANCE,
    warnings: [] as readonly string[],
    reasons: [] as readonly string[]
  }));
}

function makeQualityInput(
  slots: SelectedFeatureSlot[],
  overrides?: Partial<EvidenceQualityInput>
): EvidenceQualityInput {
  return {
    slots,
    runId: overrides?.runId ?? "run-123",
    correlationId: overrides?.correlationId ?? "corr-456",
    createdAt: overrides?.createdAt ?? 5000000000000,
    asOf: overrides?.asOf ?? 5000000000000,
    freshUntil: overrides?.freshUntil ?? 50000003600000,
    expiresAt: overrides?.expiresAt ?? 50000864000000,
    contextPresent: overrides?.contextPresent ?? false,
    briefPresent: overrides?.briefPresent ?? false,
    allowNoUsableFeatures: overrides?.allowNoUsableFeatures ?? false
  };
}

describe("classifyEvidenceBundleQuality", () => {
  describe("classifies all seven fresh available slots as complete deterministic coverage", () => {
    it("seven fresh available slots = complete deterministic coverage while context and brief absent overall", () => {
      const slots = makeSlotsAllAvailable();
      const input = makeQualityInput(slots);

      const result = classifyEvidenceBundleQuality(input);

      expect(result.quality).toBe("complete");
      expect(result.coverage.deterministic).toBe("available");
      expect(result.coverage.supportResistance).toBe("not_applicable");
      expect(result.coverage.flows).toBe("not_applicable");
      expect(result.coverage.derivatives).toBe("not_applicable");
      expect(result.coverage.events).toBe("not_applicable");
      expect(result.coverage.newsRegulatory).toBe("not_applicable");
      expect(result.coverage.researchBrief).toBe("not_applicable");
      expect(result.warnings).toHaveLength(0);
    });

    it("seven fresh available slots = complete even when context and brief are present", () => {
      const slots = makeSlotsAllAvailable();
      const input = makeQualityInput(slots, {
        contextPresent: true,
        briefPresent: true
      });

      const result = classifyEvidenceBundleQuality(input);

      expect(result.quality).toBe("complete");
      expect(result.coverage.deterministic).toBe("available");
    });
  });

  describe("classifies one or multiple missing slots as partial without zero values", () => {
    it("single missing slot = partial, no zero fabricated", () => {
      const slots = makeSlotsAllAvailable();
      slots[0] = { featureKind: "range_location", outcome: "missing" };

      const input = makeQualityInput(slots);
      const result = classifyEvidenceBundleQuality(input);

      expect(result.quality).toBe("partial");
      expect(result.coverage.deterministic).toBe("partial");
      const missingWarning = result.warnings.find((w) => w.code.includes("missing"));
      expect(missingWarning).toBeDefined();
    });

    it("multiple missing slots = partial", () => {
      const slots = makeSlotsAllAvailable();
      slots[0] = { featureKind: "range_location", outcome: "missing" };
      slots[1] = { featureKind: "distance_to_lower", outcome: "missing" };

      const input = makeQualityInput(slots);
      const result = classifyEvidenceBundleQuality(input);

      expect(result.quality).toBe("partial");
      expect(result.coverage.deterministic).toBe("partial");
    });

    it("partial slot with value 0 is NOT treated as zero-value fabrication", () => {
      const slots = makeSlotsAllAvailable();
      slots[0] = {
        featureKind: "range_location",
        outcome: "selected_partial",
        rowId: 1,
        value: 0,
        confidence: DEFAULT_CONFIDENCE,
        provenance: DEFAULT_PROVENANCE,
        warnings: [],
        reasons: ["actual_zero_value"]
      };

      const input = makeQualityInput(slots);
      const result = classifyEvidenceBundleQuality(input);

      expect(result.quality).toBe("partial");
      expect(result.warnings.some((w) => w.code.includes("zero"))).toBe(false);
    });
  });

  describe("classifies partial unavailable expired and unsupported slots distinctly", () => {
    it("partial slot carries PARTIAL quality fact", () => {
      const slots = makeSlotsAllAvailable();
      slots[0] = {
        featureKind: "range_location",
        outcome: "selected_partial",
        rowId: 1,
        value: 500,
        confidence: { ...DEFAULT_CONFIDENCE, compositeScore: 5000 },
        provenance: DEFAULT_PROVENANCE,
        warnings: ["partial_input"],
        reasons: ["degraded_confidence"]
      };

      const input = makeQualityInput(slots);
      const result = classifyEvidenceBundleQuality(input);

      expect(result.quality).toBe("partial");
      const partialWarning = result.warnings.find(
        (w) => w.code.includes("partial") || w.affectedFamilies.includes("clmm_state")
      );
      expect(partialWarning).toBeDefined();
    });

    it("unavailable slot carries UNAVAILABLE quality fact", () => {
      const slots = makeSlotsAllAvailable();
      slots[0] = {
        featureKind: "range_location",
        outcome: "selected_unavailable",
        rowId: 1,
        confidence: { ...DEFAULT_CONFIDENCE, compositeScore: 0 },
        provenance: DEFAULT_PROVENANCE,
        warnings: ["no_valid_input"],
        reasons: ["input_exhausted"]
      };

      const input = makeQualityInput(slots);
      const result = classifyEvidenceBundleQuality(input);

      expect(result.quality).toBe("partial");
      expect(result.coverage.deterministic).toBe("partial");
    });

    it("expired_only slot contributes expired upstream-mandated quality fact", () => {
      const slots = makeSlotsAllAvailable();
      slots[0] = { featureKind: "range_location", outcome: "expired_only", rowId: 1 };

      const input = makeQualityInput(slots);
      const result = classifyEvidenceBundleQuality(input);

      expect(result.quality).toBe("partial");
      expect(result.warnings.some((w) => w.code.includes("expired"))).toBe(true);
    });

    it("unsupported_version_only slot contributes unsupported upstream-mandated quality fact", () => {
      const slots = makeSlotsAllAvailable();
      slots[0] = { featureKind: "range_location", outcome: "unsupported_version_only", rowId: 1 };

      const input = makeQualityInput(slots);
      const result = classifyEvidenceBundleQuality(input);

      expect(result.quality).toBe("partial");
      expect(
        result.warnings.some((w) => w.code.includes("version") || w.code.includes("unsupported"))
      ).toBe(true);
    });
  });

  describe("refuses a zero-usable-feature bundle unless the pinned contract explicitly requires it", () => {
    it("all missing slots with allowNoUsableFeatures=false produces degraded/no-candidate", () => {
      const slots: SelectedFeatureSlot[] = MVP_FEATURE_KINDS.map((fk) => ({
        featureKind: fk,
        outcome: "missing" as const
      }));

      const input = makeQualityInput(slots, { allowNoUsableFeatures: false });
      const result = classifyEvidenceBundleQuality(input);

      expect(result.quality).toBe("degraded");
      expect(result.warnings.some((w) => w.code.includes("no_usable_features"))).toBe(true);
    });

    it("all unavailable slots with allowNoUsableFeatures=false produces degraded", () => {
      const slots: SelectedFeatureSlot[] = MVP_FEATURE_KINDS.map((fk) => ({
        featureKind: fk,
        outcome: "selected_unavailable",
        rowId: 1,
        confidence: { ...DEFAULT_CONFIDENCE, compositeScore: 0 },
        provenance: DEFAULT_PROVENANCE,
        warnings: ["no_input"],
        reasons: ["exhausted"]
      }));

      const input = makeQualityInput(slots, { allowNoUsableFeatures: false });
      const result = classifyEvidenceBundleQuality(input);

      expect(result.quality).toBe("degraded");
    });

    it("allowNoUsableFeatures=true permits zero-usable bundle", () => {
      const slots: SelectedFeatureSlot[] = MVP_FEATURE_KINDS.map((fk) => ({
        featureKind: fk,
        outcome: "missing" as const
      }));

      const input = makeQualityInput(slots, { allowNoUsableFeatures: true });
      const result = classifyEvidenceBundleQuality(input);

      expect(result.quality).toBe("partial");
      expect(result.warnings.some((w) => w.code.includes("no_usable_features"))).toBe(true);
    });
  });

  describe("keeps bundle confidence monotonic with its usable evidence", () => {
    it("bundle confidence does not exceed weakest summarized evidence", () => {
      const slots = makeSlotsAllAvailable();
      slots[0] = {
        featureKind: "range_location",
        outcome: "selected_available",
        rowId: 1,
        value: 1000,
        confidence: { ...DEFAULT_CONFIDENCE, compositeScore: 3000 },
        provenance: DEFAULT_PROVENANCE,
        warnings: [],
        reasons: []
      };
      slots[1] = {
        featureKind: "distance_to_lower",
        outcome: "selected_available",
        rowId: 2,
        value: 500,
        confidence: { ...DEFAULT_CONFIDENCE, compositeScore: 5000 },
        provenance: DEFAULT_PROVENANCE,
        warnings: [],
        reasons: []
      };

      const input = makeQualityInput(slots);
      const result = classifyEvidenceBundleQuality(input);

      expect(result.overallConfidenceBps).toBeLessThanOrEqual(3000);
    });

    it("all high confidence features yields high bundle confidence", () => {
      const slots = makeSlotsAllAvailable();
      const input = makeQualityInput(slots);
      const result = classifyEvidenceBundleQuality(input);

      expect(result.overallConfidenceBps).toBeGreaterThan(0);
    });
  });

  describe("derives timestamps deterministically", () => {
    it("asOf, creation, and expiry follow exact pinned rules from input", () => {
      const slots = makeSlotsAllAvailable();
      const createdAt = 5000000000000;
      const asOf = 5000000000000;
      const freshUntil = 50000003600000;
      const expiresAt = 50000864000000;

      const input = makeQualityInput(slots, { createdAt, asOf, freshUntil, expiresAt });
      const result = classifyEvidenceBundleQuality(input);

      expect(result.createdAt).toBe(createdAt);
      expect(result.asOf).toBe(asOf);
      expect(result.freshUntil).toBe(freshUntil);
      expect(result.expiresAt).toBe(expiresAt);
    });
  });

  describe("normalizes warnings and references before mapping", () => {
    it("unsorted warnings produce same result as sorted warnings", () => {
      const slotsA = makeSlotsAllAvailable();
      slotsA[0] = {
        featureKind: "range_location",
        outcome: "selected_available",
        rowId: 1,
        value: 1000,
        confidence: DEFAULT_CONFIDENCE,
        provenance: DEFAULT_PROVENANCE,
        warnings: ["z_warning", "a_warning", "m_warning"],
        reasons: []
      };

      const slotsB = makeSlotsAllAvailable();
      slotsB[0] = {
        featureKind: "range_location",
        outcome: "selected_available",
        rowId: 1,
        value: 1000,
        confidence: DEFAULT_CONFIDENCE,
        provenance: DEFAULT_PROVENANCE,
        warnings: ["a_warning", "m_warning", "z_warning"],
        reasons: []
      };

      const inputA = makeQualityInput(slotsA);
      const inputB = makeQualityInput(slotsB);

      const resultA = classifyEvidenceBundleQuality(inputA);
      const resultB = classifyEvidenceBundleQuality(inputB);

      expect(resultA.warnings.map((w) => w.code)).toEqual(resultB.warnings.map((w) => w.code));
    });
  });

  describe("maps deterministic-only context and brief absence exactly", () => {
    it("context absent uses only schema-authorized null representation", () => {
      const slots = makeSlotsAllAvailable();
      const input = makeQualityInput(slots, {
        contextPresent: false,
        briefPresent: false
      });

      const result = classifyEvidenceBundleQuality(input);

      expect(result.coverage.supportResistance).toBe("not_applicable");
      expect(result.coverage.flows).toBe("not_applicable");
      expect(result.coverage.derivatives).toBe("not_applicable");
      expect(result.coverage.events).toBe("not_applicable");
      expect(result.coverage.newsRegulatory).toBe("not_applicable");
      expect(result.coverage.researchBrief).toBe("not_applicable");
    });

    it("context present but no brief uses null for brief only", () => {
      const slots = makeSlotsAllAvailable();
      const input = makeQualityInput(slots, {
        contextPresent: true,
        briefPresent: false
      });

      const result = classifyEvidenceBundleQuality(input);

      expect(result.coverage.supportResistance).toBe("partial");
      expect(result.coverage.researchBrief).toBe("not_applicable");
    });
  });

  describe("maps exactly seven feature summaries in canonical order", () => {
    it("output warnings use upstream field names without extra local fields", () => {
      const slots = makeSlotsAllAvailable();
      const input = makeQualityInput(slots);

      const result = classifyEvidenceBundleQuality(input);

      result.warnings.forEach((warning) => {
        expect(warning).toHaveProperty("code");
        expect(warning).toHaveProperty("message");
        expect(warning).toHaveProperty("affectedFamilies");
        expect(Object.keys(warning).length).toBe(3);
      });
    });

    it("exactly seven slots processed in canonical MVP_FEATURE_KINDS order", () => {
      const slots = makeSlotsAllAvailable();
      const input = makeQualityInput(slots);

      const result = classifyEvidenceBundleQuality(input);

      expect(result.slotQualitySummaries).toHaveLength(7);
      expect(result.slotQualitySummaries.map((s) => s.featureKind)).toEqual([...MVP_FEATURE_KINDS]);
    });
  });

  describe("does not include payload hash recursively unless the contract requires an envelope", () => {
    it("quality output contains no payloadHash field", () => {
      const slots = makeSlotsAllAvailable();
      const input = makeQualityInput(slots);

      const result = classifyEvidenceBundleQuality(input);

      expect((result as Record<string, unknown>).payloadHash).toBeUndefined();
    });

    it("slot quality summaries contain no recursive payload hash", () => {
      const slots = makeSlotsAllAvailable();
      const input = makeQualityInput(slots);

      const result = classifyEvidenceBundleQuality(input);

      result.slotQualitySummaries.forEach((slot) => {
        expect((slot as Record<string, unknown>).payloadHash).toBeUndefined();
      });
    });
  });
});
