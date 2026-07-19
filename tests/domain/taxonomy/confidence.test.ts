import { describe, it, expect } from "vitest";
import {
  computeConfidence,
  ConfidenceValidationError
} from "../../../src/domain/taxonomy/confidence.js";

const DEFAULT_THRESHOLDS = { lowBelow: 0.4, highAtOrAbove: 0.7 };

describe("computeConfidence", () => {
  it("computes weighted composite score from all components", () => {
    const components = {
      sourceReliability: 0.9,
      dataCompleteness: 0.8,
      derivationConfidence: 0.7,
      llmConfidence: null as number | null
    };
    const policy = {
      weights: {
        sourceReliability: 0.4,
        dataCompleteness: 0.3,
        derivationConfidence: 0.3,
        llmConfidence: 0
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: true
    };
    const result = computeConfidence(components, policy, "v1");
    expect(result.compositeScore).toBeCloseTo(0.4 * 0.9 + 0.3 * 0.8 + 0.3 * 0.7, 10);
    expect(result.level).toBe("high");
  });

  it("redistributes llmConfidence weight when null and redistributeLlmWeight is true", () => {
    const components = {
      sourceReliability: 0.9,
      dataCompleteness: 0.8,
      derivationConfidence: 0.7,
      llmConfidence: null as number | null
    };
    const policy = {
      weights: {
        sourceReliability: 0.3,
        dataCompleteness: 0.3,
        derivationConfidence: 0.2,
        llmConfidence: 0.2
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: true
    };
    const result = computeConfidence(components, policy, "v1");
    expect(result.reasons).toContain("llm_weight_redistributed");
    const scale = 1 / 0.8;
    const expected = 0.3 * scale * 0.9 + 0.3 * scale * 0.8 + 0.2 * scale * 0.7;
    expect(result.compositeScore).toBeCloseTo(expected, 10);
  });

  it("throws when llmConfidence is null, llm weight > 0, and redistributeLlmWeight is false", () => {
    const components = {
      sourceReliability: 0.9,
      dataCompleteness: 0.8,
      derivationConfidence: 0.7,
      llmConfidence: null as number | null
    };
    const policy = {
      weights: {
        sourceReliability: 0.3,
        dataCompleteness: 0.3,
        derivationConfidence: 0.2,
        llmConfidence: 0.2
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: false
    };
    expect(() => computeConfidence(components, policy, "v1")).toThrow(ConfidenceValidationError);
  });

  it("derives level from thresholds", () => {
    const policy = {
      weights: {
        sourceReliability: 0.4,
        dataCompleteness: 0.3,
        derivationConfidence: 0.3,
        llmConfidence: 0
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: true
    };

    const high = computeConfidence(
      {
        sourceReliability: 0.9,
        dataCompleteness: 0.8,
        derivationConfidence: 0.7,
        llmConfidence: null
      },
      policy,
      "v1"
    );
    expect(high.level).toBe("high");

    const medium = computeConfidence(
      {
        sourceReliability: 0.5,
        dataCompleteness: 0.6,
        derivationConfidence: 0.5,
        llmConfidence: null
      },
      policy,
      "v1"
    );
    expect(medium.level).toBe("medium");

    const low = computeConfidence(
      {
        sourceReliability: 0.2,
        dataCompleteness: 0.2,
        derivationConfidence: 0.2,
        llmConfidence: null
      },
      policy,
      "v1"
    );
    expect(low.level).toBe("low");
  });

  it("applies stale degradation factor", () => {
    const components = {
      sourceReliability: 0.9,
      dataCompleteness: 0.8,
      derivationConfidence: 0.7,
      llmConfidence: null as number | null
    };
    const policy = {
      weights: {
        sourceReliability: 0.4,
        dataCompleteness: 0.3,
        derivationConfidence: 0.3,
        llmConfidence: 0
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: true
    };
    const result = computeConfidence(components, policy, "v1", { factor: 0.5 });
    expect(result.reasons).toContain("stale_input_degraded");
    expect(result.compositeScore).toBeCloseTo((0.4 * 0.9 + 0.3 * 0.8 + 0.3 * 0.7) * 0.5, 10);
  });

  it("adds low component reason when any component < 0.3", () => {
    const components = {
      sourceReliability: 0.2,
      dataCompleteness: 0.8,
      derivationConfidence: 0.7,
      llmConfidence: null as number | null
    };
    const policy = {
      weights: {
        sourceReliability: 0.4,
        dataCompleteness: 0.3,
        derivationConfidence: 0.3,
        llmConfidence: 0
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: true
    };
    const result = computeConfidence(components, policy, "v1");
    expect(result.reasons).toContain("source_reliability_low");
  });

  it("throws when component value is out of [0,1] range", () => {
    const components = {
      sourceReliability: 1.5,
      dataCompleteness: 0.8,
      derivationConfidence: 0.7,
      llmConfidence: null as number | null
    };
    const policy = {
      weights: {
        sourceReliability: 0.4,
        dataCompleteness: 0.3,
        derivationConfidence: 0.3,
        llmConfidence: 0
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: true
    };
    expect(() => computeConfidence(components, policy, "v1")).toThrow(ConfidenceValidationError);
  });

  it("clamps composite to [0, 1] after stale degradation", () => {
    const components = {
      sourceReliability: 1.0,
      dataCompleteness: 1.0,
      derivationConfidence: 1.0,
      llmConfidence: null as number | null
    };
    const policy = {
      weights: {
        sourceReliability: 0.4,
        dataCompleteness: 0.3,
        derivationConfidence: 0.3,
        llmConfidence: 0
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: true
    };
    const result = computeConfidence(components, policy, "v1", { factor: 1.0 });
    expect(result.compositeScore).toBeLessThanOrEqual(1.0);
    expect(result.compositeScore).toBeGreaterThanOrEqual(0);
  });

  it("throws when weights do not sum to 1.0", () => {
    const components = {
      sourceReliability: 0.9,
      dataCompleteness: 0.8,
      derivationConfidence: 0.7,
      llmConfidence: null as number | null
    };
    const policy = {
      weights: {
        sourceReliability: 0.5,
        dataCompleteness: 0.3,
        derivationConfidence: 0.3,
        llmConfidence: 0
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: true
    };
    expect(() => computeConfidence(components, policy, "v1")).toThrow(ConfidenceValidationError);
  });

  it("uses weights as-is when llmConfidence is provided and redistributeLlmWeight is false", () => {
    const components = {
      sourceReliability: 0.8,
      dataCompleteness: 0.7,
      derivationConfidence: 0.6,
      llmConfidence: 0.9
    };
    const policy = {
      weights: {
        sourceReliability: 0.3,
        dataCompleteness: 0.2,
        derivationConfidence: 0.2,
        llmConfidence: 0.3
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: false
    };
    const result = computeConfidence(components, policy, "v1");
    expect(result.compositeScore).toBeCloseTo(0.3 * 0.8 + 0.2 * 0.7 + 0.2 * 0.6 + 0.3 * 0.9, 10);
    expect(result.reasons).not.toContain("llm_weight_redistributed");
  });

  it("adds required_component_missing when llmConfidence is null and weight is 0 with no redistribution", () => {
    const components = {
      sourceReliability: 0.9,
      dataCompleteness: 0.8,
      derivationConfidence: 0.7,
      llmConfidence: null as number | null
    };
    const policy = {
      weights: {
        sourceReliability: 0.4,
        dataCompleteness: 0.3,
        derivationConfidence: 0.3,
        llmConfidence: 0
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: false
    };
    const result = computeConfidence(components, policy, "v1");
    expect(result.reasons).toContain("required_component_missing");
    expect(result.compositeScore).toBeCloseTo(0.4 * 0.9 + 0.3 * 0.8 + 0.3 * 0.7, 10);
  });

  it("includes all components when llmConfidence is non-null", () => {
    const components = {
      sourceReliability: 0.8,
      dataCompleteness: 0.7,
      derivationConfidence: 0.6,
      llmConfidence: 0.9
    };
    const policy = {
      weights: {
        sourceReliability: 0.3,
        dataCompleteness: 0.2,
        derivationConfidence: 0.2,
        llmConfidence: 0.3
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: true
    };
    const result = computeConfidence(components, policy, "v1");
    expect(result.compositeScore).toBeCloseTo(0.3 * 0.8 + 0.2 * 0.7 + 0.2 * 0.6 + 0.3 * 0.9, 10);
  });

  it("degrades source quality without conflating provider uncertainty with completeness", () => {
    const components = {
      sourceReliability: 0.2,
      dataCompleteness: 1.0,
      derivationConfidence: 1.0,
      llmConfidence: null as number | null
    };
    const policy = {
      weights: {
        sourceReliability: 0.4,
        dataCompleteness: 0.3,
        derivationConfidence: 0.3,
        llmConfidence: 0
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: true
    };
    const result = computeConfidence(components, policy, "v1");
    expect(result.components.dataCompleteness).toBe(1.0);
    expect(result.components.sourceReliability).toBe(0.2);
    expect(result.reasons).toContain("source_reliability_low");
  });

  it("accepts additionalReasons and deduplicates without changing completeness semantics", () => {
    const components = {
      sourceReliability: 0.8,
      dataCompleteness: 0.9,
      derivationConfidence: 0.7,
      llmConfidence: null as number | null
    };
    const policy = {
      weights: {
        sourceReliability: 0.4,
        dataCompleteness: 0.3,
        derivationConfidence: 0.3,
        llmConfidence: 0
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: true
    };
    const additionalReasons: import("../../../src/contracts/taxonomy.js").ConfidenceReason[] = [
      "oracle_confidence_wide",
      "high_price_impact"
    ];
    const result = computeConfidence(components, policy, "v1", undefined, additionalReasons);
    expect(result.reasons).toContain("oracle_confidence_wide");
    expect(result.reasons).toContain("high_price_impact");
    expect(result.components.dataCompleteness).toBe(0.9);
  });
});
