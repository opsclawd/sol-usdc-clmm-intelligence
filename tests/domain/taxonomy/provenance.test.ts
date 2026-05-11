import { describe, it, expect } from "vitest";
import { validateProvenance } from "../../../src/domain/taxonomy/provenance.js";

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
    const result = validateProvenance(baseProvenance, requirements, "fee_apr");
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
    const result = validateProvenance(baseProvenance, requirements, "price_quote");
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
});
