import { describe, it, expect } from "vitest";
import {
  validateProvenance,
  isValidProvenanceRef,
  isValidProvenanceContainer
} from "../../../src/domain/taxonomy/provenance.js";

const validProcessRef = {
  collector: "clmm-collector",
  jobName: "collect-pool-state",
  pipelineRunId: null as string | null,
  codeVersion: "abc123" as string | null,
  modelVersion: null as string | null
};

const baseProvenance = {
  sourceRefs: [
    {
      refType: "raw_observation" as const,
      id: 1,
      source: "clmm-v2-bundle" as const,
      payloadHash: "abc"
    }
  ],
  rawObservationRefs: [
    {
      refType: "raw_observation" as const,
      id: 1,
      source: "clmm-v2-bundle" as const,
      payloadHash: "abc"
    }
  ],
  derivedFromRefs: [],
  processRef: validProcessRef,
  codeVersion: "abc123",
  runId: null as string | null
};

describe("validateProvenance", () => {
  it("returns valid: true when all requirements are met", () => {
    const requirements = {
      minRawObservationRefs: 1,
      minDerivedFromRefs: 0,
      minSourceRefs: 1,
      requireProcessRef: true,
      requireCodeVersion: true,
      requireRunId: false,
      allowedSourceRefs: ["clmm-v2-bundle" as const]
    };
    const result = validateProvenance(baseProvenance, requirements, "pool_state");
    expect(result).toEqual({ valid: true });
  });

  it("returns invalid when insufficient raw observation refs", () => {
    const provenance = {
      ...baseProvenance,
      rawObservationRefs: []
    };
    const requirements = {
      minRawObservationRefs: 1,
      minDerivedFromRefs: 0,
      minSourceRefs: 1,
      requireProcessRef: true,
      requireCodeVersion: true,
      requireRunId: false,
      allowedSourceRefs: ["clmm-v2-bundle" as const]
    };
    const result = validateProvenance(provenance, requirements, "pool_state");
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.reasons).toContain("insufficient_raw_observation_refs");
    }
  });

  it("returns invalid when insufficient derived from refs", () => {
    const requirements = {
      minRawObservationRefs: 1,
      minDerivedFromRefs: 1,
      minSourceRefs: 1,
      requireProcessRef: true,
      requireCodeVersion: true,
      requireRunId: false,
      allowedSourceRefs: ["clmm-v2-bundle" as const]
    };
    const result = validateProvenance(baseProvenance, requirements, "volume_liquidity_ratio_24h");
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.reasons).toContain("insufficient_derived_from_refs");
    }
  });

  it("returns invalid when missing process ref", () => {
    const provenance = {
      ...baseProvenance,
      processRef: {
        collector: "",
        jobName: "",
        pipelineRunId: null,
        codeVersion: null,
        modelVersion: null
      }
    };
    const requirements = {
      minRawObservationRefs: 1,
      minDerivedFromRefs: 0,
      minSourceRefs: 1,
      requireProcessRef: true,
      requireCodeVersion: true,
      requireRunId: false,
      allowedSourceRefs: ["clmm-v2-bundle" as const]
    };
    const result = validateProvenance(provenance, requirements, "pool_state");
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.reasons).toContain("missing_process_ref");
    }
  });

  it("returns invalid when missing code version", () => {
    const provenance = {
      ...baseProvenance,
      codeVersion: ""
    };
    const requirements = {
      minRawObservationRefs: 1,
      minDerivedFromRefs: 0,
      minSourceRefs: 1,
      requireProcessRef: true,
      requireCodeVersion: true,
      requireRunId: false,
      allowedSourceRefs: ["clmm-v2-bundle" as const]
    };
    const result = validateProvenance(provenance, requirements, "pool_state");
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.reasons).toContain("missing_code_version");
    }
  });

  it("returns invalid when missing run id and required", () => {
    const requirements = {
      minRawObservationRefs: 1,
      minDerivedFromRefs: 0,
      minSourceRefs: 1,
      requireProcessRef: true,
      requireCodeVersion: true,
      requireRunId: true,
      allowedSourceRefs: ["clmm-v2-bundle" as const]
    };
    const result = validateProvenance(baseProvenance, requirements, "pool_state");
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.reasons).toContain("missing_run_id");
    }
  });

  it("returns invalid when source is disallowed", () => {
    const requirements = {
      minRawObservationRefs: 1,
      minDerivedFromRefs: 0,
      minSourceRefs: 1,
      requireProcessRef: true,
      requireCodeVersion: true,
      requireRunId: false,
      allowedSourceRefs: ["jupiter-price-v3" as const]
    };
    const result = validateProvenance(baseProvenance, requirements, "oracle_price");
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.reasons).toContain("disallowed_source");
    }
  });

  it("returns invalid with empty_provenance when all ref arrays are empty", () => {
    const provenance = {
      ...baseProvenance,
      sourceRefs: [],
      rawObservationRefs: [],
      derivedFromRefs: []
    };
    const requirements = {
      minRawObservationRefs: 0,
      minDerivedFromRefs: 0,
      minSourceRefs: 0,
      requireProcessRef: true,
      requireCodeVersion: true,
      requireRunId: false,
      allowedSourceRefs: [] as const
    };
    const result = validateProvenance(provenance, requirements, "pool_state");
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.reasons).toContain("empty_provenance");
    }
  });

  it("collects multiple errors at once", () => {
    const provenance = {
      sourceRefs: [],
      rawObservationRefs: [],
      derivedFromRefs: [],
      processRef: {
        collector: "",
        jobName: "",
        pipelineRunId: null,
        codeVersion: null,
        modelVersion: null
      },
      codeVersion: "",
      runId: null
    };
    const requirements = {
      minRawObservationRefs: 1,
      minDerivedFromRefs: 1,
      minSourceRefs: 1,
      requireProcessRef: true,
      requireCodeVersion: true,
      requireRunId: true,
      allowedSourceRefs: ["clmm-v2-bundle" as const]
    };
    const result = validateProvenance(provenance, requirements, "pool_state");
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.reasons.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("returns malformed_ref when a ref is missing required fields", () => {
    const provenance = {
      ...baseProvenance,
      sourceRefs: [
        { source: "clmm-v2-bundle" } as unknown as (typeof baseProvenance.sourceRefs)[number]
      ]
    };
    const requirements = {
      minRawObservationRefs: 1,
      minDerivedFromRefs: 0,
      minSourceRefs: 1,
      requireProcessRef: true,
      requireCodeVersion: true,
      requireRunId: false,
      allowedSourceRefs: [] as const
    };
    const result = validateProvenance(provenance, requirements, "pool_state");
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.reasons).toContain("malformed_ref");
    }
  });
});

describe("isValidProvenanceRef", () => {
  it("returns true for a valid ProvenanceRef", () => {
    expect(
      isValidProvenanceRef({
        refType: "raw_observation",
        id: 1,
        source: "clmm-v2-bundle",
        payloadHash: "abc123"
      })
    ).toBe(true);
  });

  it("returns false when refType is invalid", () => {
    expect(
      isValidProvenanceRef({
        refType: "invalid_type",
        id: 1,
        source: "clmm-v2-bundle",
        payloadHash: "abc123"
      })
    ).toBe(false);
  });

  it("returns false when id is not a number", () => {
    expect(
      isValidProvenanceRef({
        refType: "raw_observation",
        id: "not-a-number",
        source: "clmm-v2-bundle",
        payloadHash: "abc123"
      })
    ).toBe(false);
  });

  it("returns false when payloadHash is missing", () => {
    expect(
      isValidProvenanceRef({
        refType: "raw_observation",
        id: 1,
        source: "clmm-v2-bundle"
      })
    ).toBe(false);
  });

  it("returns false for null input", () => {
    expect(isValidProvenanceRef(null)).toBe(false);
  });

  it("returns false for non-object input", () => {
    expect(isValidProvenanceRef("string")).toBe(false);
  });
});

describe("isValidProvenanceContainer", () => {
  it("returns true for a valid Provenance container", () => {
    expect(isValidProvenanceContainer(baseProvenance)).toBe(true);
  });

  it("returns false when sourceRefs is not an array", () => {
    expect(isValidProvenanceContainer({ ...baseProvenance, sourceRefs: "not-array" })).toBe(false);
  });

  it("returns false when rawObservationRefs is not an array", () => {
    expect(isValidProvenanceContainer({ ...baseProvenance, rawObservationRefs: {} })).toBe(false);
  });

  it("returns false when derivedFromRefs is not an array", () => {
    expect(isValidProvenanceContainer({ ...baseProvenance, derivedFromRefs: null })).toBe(false);
  });

  it("returns false when processRef is not an object", () => {
    expect(isValidProvenanceContainer({ ...baseProvenance, processRef: "bad" })).toBe(false);
  });

  it("returns false for empty object", () => {
    expect(isValidProvenanceContainer({})).toBe(false);
  });

  it("returns false for null", () => {
    expect(isValidProvenanceContainer(null)).toBe(false);
  });
});

describe("validateProvenance with malformed container", () => {
  it("returns invalid_provenance_shape when sourceRefs is not an array", () => {
    const provenance = {
      ...baseProvenance,
      sourceRefs: "not-array" as unknown as (typeof baseProvenance.sourceRefs)[number][]
    };
    const requirements = {
      minRawObservationRefs: 1,
      minDerivedFromRefs: 0,
      minSourceRefs: 1,
      requireProcessRef: true,
      requireCodeVersion: true,
      requireRunId: false,
      allowedSourceRefs: [] as const
    };
    const result = validateProvenance(provenance, requirements, "pool_state");
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.reasons).toContain("invalid_provenance_shape");
    }
  });

  it("returns invalid_provenance_shape for empty object", () => {
    const provenance = {} as unknown as Parameters<typeof validateProvenance>[0];
    const requirements = {
      minRawObservationRefs: 0,
      minDerivedFromRefs: 0,
      minSourceRefs: 0,
      requireProcessRef: false,
      requireCodeVersion: false,
      requireRunId: false,
      allowedSourceRefs: [] as const
    };
    const result = validateProvenance(provenance, requirements, "pool_state");
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.reasons).toContain("invalid_provenance_shape");
    }
  });

  it("does not dereference malformed refs in allowed-source check", () => {
    const provenance = {
      ...baseProvenance,
      sourceRefs: [
        { source: "clmm-v2-bundle" } as unknown as (typeof baseProvenance.sourceRefs)[number]
      ]
    };
    const requirements = {
      minRawObservationRefs: 1,
      minDerivedFromRefs: 0,
      minSourceRefs: 1,
      requireProcessRef: true,
      requireCodeVersion: true,
      requireRunId: false,
      allowedSourceRefs: ["clmm-v2-bundle" as const]
    };
    const result = validateProvenance(provenance, requirements, "pool_state");
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.reasons).toContain("malformed_ref");
      expect(result.reasons).not.toContain("disallowed_source");
    }
  });

  it("flags missing_process_ref when processRef fields are undefined", () => {
    const provenance = {
      ...baseProvenance,
      processRef: {
        collector: undefined as unknown as string,
        jobName: undefined as unknown as string,
        pipelineRunId: null,
        codeVersion: null,
        modelVersion: null
      }
    };
    const requirements = {
      minRawObservationRefs: 1,
      minDerivedFromRefs: 0,
      minSourceRefs: 1,
      requireProcessRef: true,
      requireCodeVersion: true,
      requireRunId: false,
      allowedSourceRefs: [] as const
    };
    const result = validateProvenance(provenance, requirements, "pool_state");
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.reasons).toContain("missing_process_ref");
    }
  });

  it("flags missing_process_ref when processRef is empty object", () => {
    const provenance = {
      ...baseProvenance,
      processRef: {} as unknown as (typeof baseProvenance)["processRef"]
    };
    const requirements = {
      minRawObservationRefs: 1,
      minDerivedFromRefs: 0,
      minSourceRefs: 1,
      requireProcessRef: true,
      requireCodeVersion: true,
      requireRunId: false,
      allowedSourceRefs: [] as const
    };
    const result = validateProvenance(provenance, requirements, "pool_state");
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.reasons).toContain("missing_process_ref");
    }
  });
});
