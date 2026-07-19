import { describe, it, expect } from "vitest";
import {
  parseObservationKind,
  parseFeatureKind,
  parseSource,
  parseSignalClass,
  parseEvidenceFamily,
  parseConfidenceLevel,
  parseStaleBehavior,
  parseParseStatus,
  TaxonomyValidationError
} from "../../../src/domain/taxonomy/validation.js";

describe("parseObservationKind", () => {
  it("returns typed value for valid kinds", () => {
    expect(parseObservationKind("pool_state")).toBe("pool_state");
    expect(parseObservationKind("oracle_price")).toBe("oracle_price");
    expect(parseObservationKind("executable_quote")).toBe("executable_quote");
  });

  it("throws TaxonomyValidationError for unknown kind", () => {
    expect(() => parseObservationKind("unknown")).toThrow(TaxonomyValidationError);
  });
});

describe("parseFeatureKind", () => {
  it("returns typed value for valid kinds", () => {
    expect(parseFeatureKind("fee_apr")).toBe("fee_apr");
    expect(parseFeatureKind("volatility_24h")).toBe("volatility_24h");
  });

  it("throws for unknown kind", () => {
    expect(() => parseFeatureKind("unknown")).toThrow(TaxonomyValidationError);
  });
});

describe("parseSource", () => {
  it("returns typed value for valid sources", () => {
    expect(parseSource("clmm-v2-bundle")).toBe("clmm-v2-bundle");
    expect(parseSource("jupiter-price-v3")).toBe("jupiter-price-v3");
  });

  it("throws for unknown source", () => {
    expect(() => parseSource("unknown")).toThrow(TaxonomyValidationError);
  });
});

describe("parseSignalClass", () => {
  it("returns typed value for valid classes", () => {
    expect(parseSignalClass("deterministic")).toBe("deterministic");
    expect(parseSignalClass("contextual")).toBe("contextual");
  });

  it("throws for unknown class", () => {
    expect(() => parseSignalClass("unknown")).toThrow(TaxonomyValidationError);
  });
});

describe("parseEvidenceFamily", () => {
  it("returns typed value for valid families", () => {
    expect(parseEvidenceFamily("clmm_state")).toBe("clmm_state");
    expect(parseEvidenceFamily("macro_protocol_risk")).toBe("macro_protocol_risk");
  });

  it("throws for unknown family", () => {
    expect(() => parseEvidenceFamily("unknown")).toThrow(TaxonomyValidationError);
  });
});

describe("parseConfidenceLevel", () => {
  it("returns typed value for valid levels", () => {
    expect(parseConfidenceLevel("low")).toBe("low");
    expect(parseConfidenceLevel("medium")).toBe("medium");
    expect(parseConfidenceLevel("high")).toBe("high");
  });

  it("throws for unknown level", () => {
    expect(() => parseConfidenceLevel("unknown")).toThrow(TaxonomyValidationError);
  });
});

describe("parseStaleBehavior", () => {
  it("returns typed value for valid behaviors", () => {
    expect(parseStaleBehavior("exclude")).toBe("exclude");
    expect(parseStaleBehavior("degrade_confidence")).toBe("degrade_confidence");
    expect(parseStaleBehavior("allow_context_only")).toBe("allow_context_only");
  });

  it("throws for unknown behavior", () => {
    expect(() => parseStaleBehavior("unknown")).toThrow(TaxonomyValidationError);
  });
});

describe("parseParseStatus", () => {
  it("returns typed value for valid statuses", () => {
    expect(parseParseStatus("pending")).toBe("pending");
    expect(parseParseStatus("parsed")).toBe("parsed");
    expect(parseParseStatus("failed")).toBe("failed");
  });

  it("throws for unknown status", () => {
    expect(() => parseParseStatus("unknown")).toThrow(TaxonomyValidationError);
  });
});

describe("TaxonomyValidationError", () => {
  it("includes kind and value in message", () => {
    try {
      parseObservationKind("bad-value");
    } catch (e) {
      expect(e).toBeInstanceOf(TaxonomyValidationError);
      const err = e as TaxonomyValidationError;
      expect(err.kind).toBe("ObservationKind");
      expect(err.value).toBe("bad-value");
      expect(err.message).toContain("ObservationKind");
      expect(err.message).toContain("bad-value");
    }
  });
});
