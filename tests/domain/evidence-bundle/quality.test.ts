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

function makeSlotsAllAvailable(): SelectedFeatureSlot[] {
  return MVP_FEATURE_KINDS.map((featureKind, i) => ({
    featureKind,
    outcome: "selected_available" as const,
    rowId: i + 1,
    value: 1000 + i,
    confidence: { ...DEFAULT_CONFIDENCE, compositeScore: 1 - i * 0.01 },
    provenance: DEFAULT_PROVENANCE,
    warnings: [] as readonly string[],
    reasons: [] as readonly string[],
    asOfUnixMs: 5000000000000 + i,
    validUntilUnixMs: null
  }));
}

function makeQualityInput(
  slots: SelectedFeatureSlot[],
  overrides?: Partial<EvidenceQualityInput>
): EvidenceQualityInput {
  return {
    slots,
    ...(overrides?.featureKinds !== undefined ? { featureKinds: overrides.featureKinds } : {}),
    runId: overrides?.runId ?? "run-123",
    correlationId: overrides?.correlationId ?? "corr-456",
    createdAt: overrides?.createdAt ?? 5000000000000,
    asOf: overrides?.asOf ?? 5000000000000,
    freshUntil: overrides?.freshUntil ?? 50000003600000,
    expiresAt: overrides?.expiresAt ?? 50000864000000,
    hasSupportResistance: overrides?.hasSupportResistance ?? false,
    hasFlows: overrides?.hasFlows ?? false,
    hasDerivatives: overrides?.hasDerivatives ?? false,
    hasEvents: overrides?.hasEvents ?? false,
    hasNewsRegulatory: overrides?.hasNewsRegulatory ?? false,
    hasResearchBrief: overrides?.hasResearchBrief ?? false,
    allowNoUsableFeatures: overrides?.allowNoUsableFeatures ?? false
  };
}

describe("classifyEvidenceBundleQuality", () => {
  describe("classifies all seven fresh available slots as complete deterministic coverage", () => {
    it("seven fresh available slots = partial while context and brief are absent overall", () => {
      const slots = makeSlotsAllAvailable();
      const input = makeQualityInput(slots);

      const result = classifyEvidenceBundleQuality(input);

      expect(result.quality).toBe("partial");
      expect(result.coverage.deterministic).toBe("available");
      expect(result.coverage.supportResistance).toBe("unavailable");
      expect(result.coverage.flows).toBe("unavailable");
      expect(result.coverage.derivatives).toBe("unavailable");
      expect(result.coverage.events).toBe("unavailable");
      expect(result.coverage.newsRegulatory).toBe("unavailable");
      expect(result.coverage.researchBrief).toBe("unavailable");
    });

    it("seven fresh available slots = complete even when context and brief are present", () => {
      const slots = makeSlotsAllAvailable();
      const input = makeQualityInput(slots, {
        hasSupportResistance: true,
        hasFlows: true,
        hasDerivatives: true,
        hasEvents: true,
        hasNewsRegulatory: true,
        hasResearchBrief: true
      });

      const result = classifyEvidenceBundleQuality(input);

      expect(result.quality).toBe("complete");
      expect(result.coverage.deterministic).toBe("available");
    });

    const contextualFamilyCases = [
      ["supportResistance", "hasSupportResistance"],
      ["flows", "hasFlows"],
      ["derivatives", "hasDerivatives"],
      ["events", "hasEvents"],
      ["newsRegulatory", "hasNewsRegulatory"],
      ["researchBrief", "hasResearchBrief"]
    ] as const;

    it.each(contextualFamilyCases)(
      "caps complete deterministic quality at partial when %s is unavailable",
      (coverageFamily, inputFlag) => {
        const input = makeQualityInput(makeSlotsAllAvailable(), {
          hasSupportResistance: true,
          hasFlows: true,
          hasDerivatives: true,
          hasEvents: true,
          hasNewsRegulatory: true,
          hasResearchBrief: true,
          [inputFlag]: false
        });

        const result = classifyEvidenceBundleQuality(input);

        expect(result.quality).toBe("partial");
        expect(result.coverage.deterministic).toBe("available");
        expect(result.coverage[coverageFamily]).toBe("unavailable");
      }
    );
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
        reasons: ["actual_zero_value"],
        asOfUnixMs: 5000000000000,
        validUntilUnixMs: null
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
        confidence: { ...DEFAULT_CONFIDENCE, compositeScore: 0.5 },
        provenance: DEFAULT_PROVENANCE,
        warnings: ["partial_input"],
        reasons: ["degraded_confidence"],
        asOfUnixMs: 5000000000000,
        validUntilUnixMs: null
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
        reasons: ["input_exhausted"],
        asOfUnixMs: 5000000000000,
        validUntilUnixMs: null
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
        reasons: ["exhausted"],
        asOfUnixMs: 5000000000000,
        validUntilUnixMs: null
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
    it("bundle confidence equals the weakest scaled usable evidence", () => {
      const slots = makeSlotsAllAvailable();
      slots[0] = {
        featureKind: "range_location",
        outcome: "selected_available",
        rowId: 1,
        value: 1000,
        confidence: { ...DEFAULT_CONFIDENCE, compositeScore: 0.3 },
        provenance: DEFAULT_PROVENANCE,
        warnings: [],
        reasons: [],
        asOfUnixMs: 5000000000000,
        validUntilUnixMs: null
      };
      slots[1] = {
        featureKind: "distance_to_lower",
        outcome: "selected_available",
        rowId: 2,
        value: 500,
        confidence: { ...DEFAULT_CONFIDENCE, compositeScore: 0.5 },
        provenance: DEFAULT_PROVENANCE,
        warnings: [],
        reasons: [],
        asOfUnixMs: 5000000000000,
        validUntilUnixMs: null
      };

      const input = makeQualityInput(slots);
      const result = classifyEvidenceBundleQuality(input);

      expect(result.slotQualitySummaries[0]!.confidenceBps).toBe(3000);
      expect(result.slotQualitySummaries[1]!.confidenceBps).toBe(5000);
      expect(result.overallConfidenceBps).toBe(3000);
    });

    it("scales available and partial slot confidence from fractions to basis points", () => {
      const slots = makeSlotsAllAvailable();
      slots[0] = {
        featureKind: "range_location",
        outcome: "selected_partial",
        rowId: 1,
        value: 1000,
        confidence: { ...DEFAULT_CONFIDENCE, compositeScore: 0.625 },
        provenance: DEFAULT_PROVENANCE,
        warnings: ["partial_input"],
        reasons: ["degraded_confidence"],
        asOfUnixMs: 5_000_000_000_000,
        validUntilUnixMs: null
      };

      const result = classifyEvidenceBundleQuality(makeQualityInput(slots));

      expect(result.slotQualitySummaries[0]!.confidenceBps).toBe(6250);
    });

    it("missing expired and unsupported slots keep zero confidence", () => {
      const slots: SelectedFeatureSlot[] = [
        { featureKind: "range_location", outcome: "missing" },
        { featureKind: "distance_to_lower", outcome: "expired_only", rowId: 2 },
        { featureKind: "distance_to_upper", outcome: "unsupported_version_only", rowId: 3 }
      ];

      const result = classifyEvidenceBundleQuality(
        makeQualityInput(slots, { allowNoUsableFeatures: true })
      );

      expect(result.slotQualitySummaries.map((summary) => summary.confidenceBps)).toEqual(
        Array(MVP_FEATURE_KINDS.length).fill(0)
      );
    });

    it("all high confidence features yields high bundle confidence", () => {
      const slots = makeSlotsAllAvailable();
      const input = makeQualityInput(slots);
      const result = classifyEvidenceBundleQuality(input);

      expect(result.overallConfidenceBps).toBeGreaterThan(0);
    });

    it("clamps a slot composite score above one to 10,000 basis points", () => {
      const slots = makeSlotsAllAvailable();
      slots[0] = {
        featureKind: "range_location",
        outcome: "selected_available",
        rowId: 1,
        value: 1000,
        confidence: { ...DEFAULT_CONFIDENCE, compositeScore: 1.5 },
        provenance: DEFAULT_PROVENANCE,
        warnings: [],
        reasons: [],
        asOfUnixMs: 5000000000000,
        validUntilUnixMs: null
      };

      const input = makeQualityInput(slots);
      const result = classifyEvidenceBundleQuality(input);

      expect(result.slotQualitySummaries[0]?.confidenceBps).toBe(10000);
      expect(result.overallConfidenceBps).toBeLessThanOrEqual(10000);
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
        reasons: [],
        asOfUnixMs: 5000000000000,
        validUntilUnixMs: null
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
        reasons: [],
        asOfUnixMs: 5000000000000,
        validUntilUnixMs: null
      };

      const inputA = makeQualityInput(slotsA);
      const inputB = makeQualityInput(slotsB);

      const resultA = classifyEvidenceBundleQuality(inputA);
      const resultB = classifyEvidenceBundleQuality(inputB);

      expect(resultA.warnings.map((w) => w.code)).toEqual(resultB.warnings.map((w) => w.code));
    });
  });

  describe("per contextual family coverage and warnings", () => {
    it("reports only event coverage for an event only bundle", () => {
      const slots = makeSlotsAllAvailable();
      const input = makeQualityInput(slots, {
        hasEvents: true
      });

      const result = classifyEvidenceBundleQuality(input);

      expect(result.coverage.events).toBe("partial");
      expect(result.coverage.supportResistance).toBe("unavailable");
      expect(result.coverage.flows).toBe("unavailable");
      expect(result.coverage.derivatives).toBe("unavailable");
      expect(result.coverage.newsRegulatory).toBe("unavailable");
      expect(result.coverage.researchBrief).toBe("unavailable");
    });

    it("reports only news coverage for a news only bundle", () => {
      const slots = makeSlotsAllAvailable();
      const input = makeQualityInput(slots, {
        hasNewsRegulatory: true
      });

      const result = classifyEvidenceBundleQuality(input);

      expect(result.coverage.newsRegulatory).toBe("partial");
      expect(result.coverage.supportResistance).toBe("unavailable");
      expect(result.coverage.flows).toBe("unavailable");
      expect(result.coverage.derivatives).toBe("unavailable");
      expect(result.coverage.events).toBe("unavailable");
      expect(result.coverage.researchBrief).toBe("unavailable");
    });

    it("reports only support resistance coverage for a levels only bundle", () => {
      const slots = makeSlotsAllAvailable();
      const input = makeQualityInput(slots, {
        hasSupportResistance: true
      });

      const result = classifyEvidenceBundleQuality(input);

      expect(result.coverage.supportResistance).toBe("partial");
      expect(result.coverage.flows).toBe("unavailable");
      expect(result.coverage.derivatives).toBe("unavailable");
      expect(result.coverage.events).toBe("unavailable");
      expect(result.coverage.newsRegulatory).toBe("unavailable");
      expect(result.coverage.researchBrief).toBe("unavailable");
    });

    it("keeps empty contextual families unavailable", () => {
      const slots = makeSlotsAllAvailable();
      const input = makeQualityInput(slots, {
        hasSupportResistance: false,
        hasFlows: false,
        hasDerivatives: false,
        hasEvents: false,
        hasNewsRegulatory: false,
        hasResearchBrief: false
      });

      const result = classifyEvidenceBundleQuality(input);

      expect(result.coverage.supportResistance).toBe("unavailable");
      expect(result.coverage.flows).toBe("unavailable");
      expect(result.coverage.derivatives).toBe("unavailable");
      expect(result.coverage.events).toBe("unavailable");
      expect(result.coverage.newsRegulatory).toBe("unavailable");
      expect(result.coverage.researchBrief).toBe("unavailable");
    });

    it("emits one unavailable warning for each missing contextual family", () => {
      const result = classifyEvidenceBundleQuality(
        makeQualityInput(makeSlotsAllAvailable(), {
          hasSupportResistance: false,
          hasFlows: false,
          hasDerivatives: false,
          hasEvents: false,
          hasNewsRegulatory: false,
          hasResearchBrief: false
        })
      );

      const codes = result.warnings.map((warning) => warning.code);
      expect(codes).toContain("SUPPORT_RESISTANCE_UNAVAILABLE");
      expect(codes).toContain("FLOWS_UNAVAILABLE");
      expect(codes).toContain("DERIVATIVES_UNAVAILABLE");
      expect(codes).toContain("EVENTS_UNAVAILABLE");
      expect(codes).toContain("NEWS_REGULATORY_UNAVAILABLE");
      expect(codes).toContain("RESEARCH_BRIEF_UNAVAILABLE");

      expect(result.warnings.find((w) => w.code === "SUPPORT_RESISTANCE_UNAVAILABLE")).toEqual({
        code: "SUPPORT_RESISTANCE_UNAVAILABLE",
        message: "Support/resistance evidence family is unavailable",
        affectedFamilies: ["supportResistance"]
      });
      expect(result.warnings.find((w) => w.code === "FLOWS_UNAVAILABLE")).toEqual({
        code: "FLOWS_UNAVAILABLE",
        message: "On-chain flows evidence family is unavailable",
        affectedFamilies: ["flows"]
      });
      expect(result.warnings.find((w) => w.code === "DERIVATIVES_UNAVAILABLE")).toEqual({
        code: "DERIVATIVES_UNAVAILABLE",
        message: "Derivatives evidence family is unavailable",
        affectedFamilies: ["derivatives"]
      });
      expect(result.warnings.find((w) => w.code === "EVENTS_UNAVAILABLE")).toEqual({
        code: "EVENTS_UNAVAILABLE",
        message: "Contextual events evidence family is unavailable",
        affectedFamilies: ["events"]
      });
      expect(result.warnings.find((w) => w.code === "NEWS_REGULATORY_UNAVAILABLE")).toEqual({
        code: "NEWS_REGULATORY_UNAVAILABLE",
        message: "News and regulatory evidence family is unavailable",
        affectedFamilies: ["newsRegulatory"]
      });
      expect(result.warnings.find((w) => w.code === "RESEARCH_BRIEF_UNAVAILABLE")).toEqual({
        code: "RESEARCH_BRIEF_UNAVAILABLE",
        message: "Research brief is unavailable",
        affectedFamilies: ["researchBrief"]
      });
    });

    it("does not emit an unavailable warning for a populated family", () => {
      const result = classifyEvidenceBundleQuality(
        makeQualityInput(makeSlotsAllAvailable(), {
          hasSupportResistance: true,
          hasFlows: false,
          hasDerivatives: false,
          hasEvents: false,
          hasNewsRegulatory: false,
          hasResearchBrief: false
        })
      );

      const codes = result.warnings.map((w) => w.code);
      expect(codes).not.toContain("SUPPORT_RESISTANCE_UNAVAILABLE");
      expect(codes).toContain("FLOWS_UNAVAILABLE");
    });

    it("reports research brief coverage independently", () => {
      const result = classifyEvidenceBundleQuality(
        makeQualityInput(makeSlotsAllAvailable(), {
          hasSupportResistance: false,
          hasFlows: false,
          hasDerivatives: false,
          hasEvents: false,
          hasNewsRegulatory: false,
          hasResearchBrief: true
        })
      );

      expect(result.coverage.researchBrief).toBe("available");
      expect(result.coverage.supportResistance).toBe("unavailable");
      expect(result.warnings.map((w) => w.code)).not.toContain("RESEARCH_BRIEF_UNAVAILABLE");
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

      expect(result.slotQualitySummaries).toHaveLength(MVP_FEATURE_KINDS.length);
      expect(result.slotQualitySummaries.map((s) => s.featureKind)).toEqual([...MVP_FEATURE_KINDS]);
    });

    it("scores only explicitly requested feature kinds without inventing omitted missing slots", () => {
      const requestedKinds = ["oracle_dex_divergence", "volume_liquidity_ratio_24h"] as const;
      const slots: SelectedFeatureSlot[] = [
        {
          featureKind: "oracle_dex_divergence",
          outcome: "selected_available",
          rowId: 1,
          value: 10,
          confidence: DEFAULT_CONFIDENCE,
          provenance: DEFAULT_PROVENANCE,
          warnings: [],
          reasons: [],
          asOfUnixMs: 5000000000000,
          validUntilUnixMs: null
        },
        {
          featureKind: "volume_liquidity_ratio_24h",
          outcome: "selected_available",
          rowId: 2,
          value: 200,
          confidence: DEFAULT_CONFIDENCE,
          provenance: DEFAULT_PROVENANCE,
          warnings: [],
          reasons: [],
          asOfUnixMs: 5000000000000,
          validUntilUnixMs: null
        }
      ];
      const input = makeQualityInput(slots, {
        featureKinds: requestedKinds
      } as Partial<EvidenceQualityInput>);

      const result = classifyEvidenceBundleQuality(input);

      expect(result.slotQualitySummaries).toHaveLength(2);
      expect(result.slotQualitySummaries.map((s) => s.featureKind)).toEqual([...requestedKinds]);
      expect(result.coverage.deterministic).toBe("available");
      expect(result.warnings.map((w) => w.code)).not.toContain("missing_slots");
    });
  });

  describe("does not include payload hash recursively unless the contract requires an envelope", () => {
    it("quality output contains no payloadHash field", () => {
      const slots = makeSlotsAllAvailable();
      const input = makeQualityInput(slots);

      const result = classifyEvidenceBundleQuality(input);

      expect((result as unknown as Record<string, unknown>).payloadHash).toBeUndefined();
    });

    it("slot quality summaries contain no recursive payload hash", () => {
      const slots = makeSlotsAllAvailable();
      const input = makeQualityInput(slots);

      const result = classifyEvidenceBundleQuality(input);

      result.slotQualitySummaries.forEach((slot) => {
        expect((slot as unknown as Record<string, unknown>).payloadHash).toBeUndefined();
      });
    });
  });
});
