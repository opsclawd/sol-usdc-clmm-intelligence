import { describe, it, expect } from "vitest";
import { parseDerivedFeatureV1 } from "../../../src/contracts/derived-feature.js";
import type { DerivedFeatureV1 } from "../../../src/contracts/derived-feature.js";
import { parseFeatureKind } from "../../../src/domain/taxonomy/validation.js";
import { TaxonomyValidationError } from "../../../src/domain/taxonomy/validation.js";

function buildMinimalFeature(overrides: Partial<DerivedFeatureV1> = {}): DerivedFeatureV1 {
  const base: DerivedFeatureV1 = {
    schemaVersion: 1,
    featureKind: "range_location",
    status: "AVAILABLE",
    value: 500000,
    unit: "PPM",
    pair: "SOL/USDC",
    poolId: "pool123",
    positionId: "pos456",
    asOfUnixMs: Date.now(),
    expiresAtUnixMs: Date.now() + 60000,
    confidence: {
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
    },
    freshness: {
      isStale: false,
      validUntilUnixMs: Date.now() + 60000,
      derivedAt: Date.now(),
      policyKind: "range_location",
      reasons: []
    },
    inputObservationIds: [1, 2, 3],
    rejectedObservationIds: [],
    provenance: {
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
      codeVersion: "test-v1",
      runId: null
    },
    warnings: [],
    reasons: [],
    calculatorVersion: "1.0.0",
    selectionVersion: "1.0.0",
    calculationMetadata: {}
  };
  return { ...base, ...overrides };
}

describe("DerivedFeatureV1 contract", () => {
  describe("MVP_FEATURE_KINDS contains exactly seven canonical members", () => {
    it("has seven members", async () => {
      const { MVP_FEATURE_KINDS } = await import("../../../src/contracts/derived-feature.js");
      expect(MVP_FEATURE_KINDS).toHaveLength(7);
    });

    it("contains range_location", async () => {
      const { MVP_FEATURE_KINDS } = await import("../../../src/contracts/derived-feature.js");
      expect(MVP_FEATURE_KINDS).toContain("range_location");
    });

    it("contains distance_to_lower", async () => {
      const { MVP_FEATURE_KINDS } = await import("../../../src/contracts/derived-feature.js");
      expect(MVP_FEATURE_KINDS).toContain("distance_to_lower");
    });

    it("contains distance_to_upper", async () => {
      const { MVP_FEATURE_KINDS } = await import("../../../src/contracts/derived-feature.js");
      expect(MVP_FEATURE_KINDS).toContain("distance_to_upper");
    });

    it("contains oracle_dex_divergence", async () => {
      const { MVP_FEATURE_KINDS } = await import("../../../src/contracts/derived-feature.js");
      expect(MVP_FEATURE_KINDS).toContain("oracle_dex_divergence");
    });

    it("contains oracle_confidence_width", async () => {
      const { MVP_FEATURE_KINDS } = await import("../../../src/contracts/derived-feature.js");
      expect(MVP_FEATURE_KINDS).toContain("oracle_confidence_width");
    });

    it("contains realized_volatility_1h", async () => {
      const { MVP_FEATURE_KINDS } = await import("../../../src/contracts/derived-feature.js");
      expect(MVP_FEATURE_KINDS).toContain("realized_volatility_1h");
    });

    it("contains volume_liquidity_ratio_24h", async () => {
      const { MVP_FEATURE_KINDS } = await import("../../../src/contracts/derived-feature.js");
      expect(MVP_FEATURE_KINDS).toContain("volume_liquidity_ratio_24h");
    });
  });

  describe("accepts an AVAILABLE feature only with a finite safe-integer value", () => {
    it("accepts finite positive integer for AVAILABLE", () => {
      const feature = buildMinimalFeature({ status: "AVAILABLE", value: 500000 });
      expect(() => parseDerivedFeatureV1(feature)).not.toThrow();
    });

    it("accepts zero for AVAILABLE", () => {
      const feature = buildMinimalFeature({ status: "AVAILABLE", value: 0 });
      expect(() => parseDerivedFeatureV1(feature)).not.toThrow();
    });

    it("rejects null value for AVAILABLE", () => {
      const feature = buildMinimalFeature({ status: "AVAILABLE", value: null });
      expect(() => parseDerivedFeatureV1(feature)).toThrow();
    });

    it("rejects Infinity for AVAILABLE", () => {
      const feature = buildMinimalFeature({ status: "AVAILABLE", value: Infinity });
      expect(() => parseDerivedFeatureV1(feature)).toThrow();
    });

    it("rejects NaN for AVAILABLE", () => {
      const feature = buildMinimalFeature({ status: "AVAILABLE", value: NaN });
      expect(() => parseDerivedFeatureV1(feature)).toThrow();
    });

    it("rejects non-integer float for AVAILABLE", () => {
      const feature = buildMinimalFeature({ status: "AVAILABLE", value: 1.5 });
      expect(() => parseDerivedFeatureV1(feature)).toThrow();
    });

    it("accepts null value for UNAVAILABLE", () => {
      const feature = buildMinimalFeature({
        status: "UNAVAILABLE",
        value: null,
        reasons: ["insufficient_data"]
      });
      expect(() => parseDerivedFeatureV1(feature)).not.toThrow();
    });

    it("rejects non-null value for UNAVAILABLE", () => {
      const feature = buildMinimalFeature({
        status: "UNAVAILABLE",
        value: 500000,
        reasons: ["insufficient_data"]
      });
      expect(() => parseDerivedFeatureV1(feature)).toThrow();
    });

    it("accepts finite integer for PARTIAL", () => {
      const feature = buildMinimalFeature({
        status: "PARTIAL",
        value: 250000,
        reasons: ["degraded_confidence"]
      });
      expect(() => parseDerivedFeatureV1(feature)).not.toThrow();
    });

    it("rejects null value for PARTIAL", () => {
      const feature = buildMinimalFeature({ status: "PARTIAL", value: null });
      expect(() => parseDerivedFeatureV1(feature)).toThrow();
    });
  });

  describe("enforces the canonical unit for every feature kind", () => {
    const bpsKinds = ["oracle_dex_divergence", "oracle_confidence_width", "realized_volatility_1h"];
    const ppmKinds = [
      "range_location",
      "distance_to_lower",
      "distance_to_upper",
      "volume_liquidity_ratio_24h"
    ];

    for (const kind of bpsKinds) {
      it(`${kind} requires BPS unit`, () => {
        const feature = buildMinimalFeature({
          featureKind: kind as DerivedFeatureV1["featureKind"],
          unit: "BPS",
          poolId: null,
          positionId: null
        });
        expect(() => parseDerivedFeatureV1(feature)).not.toThrow();
      });

      it(`${kind} rejects PPM unit`, () => {
        const feature = buildMinimalFeature({
          featureKind: kind as DerivedFeatureV1["featureKind"],
          unit: "PPM",
          poolId: null,
          positionId: null
        });
        expect(() => parseDerivedFeatureV1(feature)).toThrow();
      });
    }

    for (const kind of ppmKinds) {
      it(`${kind} requires PPM unit`, () => {
        const scope =
          kind === "volume_liquidity_ratio_24h"
            ? { poolId: "pool123", positionId: null }
            : { poolId: "pool123", positionId: "pos456" };
        const feature = buildMinimalFeature({
          featureKind: kind as DerivedFeatureV1["featureKind"],
          unit: "PPM",
          ...scope
        });
        expect(() => parseDerivedFeatureV1(feature)).not.toThrow();
      });

      it(`${kind} rejects BPS unit`, () => {
        const scope =
          kind === "volume_liquidity_ratio_24h"
            ? { poolId: "pool123", positionId: null }
            : { poolId: "pool123", positionId: "pos456" };
        const feature = buildMinimalFeature({
          featureKind: kind as DerivedFeatureV1["featureKind"],
          unit: "BPS",
          ...scope
        });
        expect(() => parseDerivedFeatureV1(feature)).toThrow();
      });
    }
  });

  describe("enforces feature scope identity by kind", () => {
    it("position features require both poolId and positionId", () => {
      const positionKinds = ["range_location", "distance_to_lower", "distance_to_upper"];
      for (const kind of positionKinds) {
        const withBoth = buildMinimalFeature({
          featureKind: kind as DerivedFeatureV1["featureKind"],
          poolId: "pool123",
          positionId: "pos456"
        });
        expect(() => parseDerivedFeatureV1(withBoth)).not.toThrow();

        const withPoolOnly = buildMinimalFeature({
          featureKind: kind as DerivedFeatureV1["featureKind"],
          poolId: "pool123",
          positionId: null
        });
        expect(() => parseDerivedFeatureV1(withPoolOnly)).toThrow();

        const withNeither = buildMinimalFeature({
          featureKind: kind as DerivedFeatureV1["featureKind"],
          poolId: null,
          positionId: null
        });
        expect(() => parseDerivedFeatureV1(withNeither)).toThrow();
      }
    });

    it("pool ratio feature (volume_liquidity_ratio_24h) requires poolId and no positionId", () => {
      const withPoolOnly = buildMinimalFeature({
        featureKind: "volume_liquidity_ratio_24h",
        poolId: "pool123",
        positionId: null
      });
      expect(() => parseDerivedFeatureV1(withPoolOnly)).not.toThrow();

      const withPosition = buildMinimalFeature({
        featureKind: "volume_liquidity_ratio_24h",
        poolId: "pool123",
        positionId: "pos456"
      });
      expect(() => parseDerivedFeatureV1(withPosition)).toThrow();

      const withNeither = buildMinimalFeature({
        featureKind: "volume_liquidity_ratio_24h",
        poolId: null,
        positionId: null
      });
      expect(() => parseDerivedFeatureV1(withNeither)).toThrow();
    });

    it("pair features require neither poolId nor positionId", () => {
      const pairKinds = [
        "oracle_dex_divergence",
        "oracle_confidence_width",
        "realized_volatility_1h"
      ];
      for (const kind of pairKinds) {
        const withNeither = buildMinimalFeature({
          featureKind: kind as DerivedFeatureV1["featureKind"],
          unit: "BPS",
          poolId: null,
          positionId: null
        });
        expect(() => parseDerivedFeatureV1(withNeither)).not.toThrow();

        const withPool = buildMinimalFeature({
          featureKind: kind as DerivedFeatureV1["featureKind"],
          unit: "BPS",
          poolId: "pool123",
          positionId: null
        });
        expect(() => parseDerivedFeatureV1(withPool)).toThrow();

        const withBoth = buildMinimalFeature({
          featureKind: kind as DerivedFeatureV1["featureKind"],
          unit: "BPS",
          poolId: "pool123",
          positionId: "pos456"
        });
        expect(() => parseDerivedFeatureV1(withBoth)).toThrow();
      }
    });
  });

  describe("rejects unsorted duplicate observation ids and reason codes", () => {
    it("rejects unsorted inputObservationIds", () => {
      const feature = buildMinimalFeature({
        inputObservationIds: [3, 1, 2]
      });
      expect(() => parseDerivedFeatureV1(feature)).toThrow();
    });

    it("rejects duplicate inputObservationIds", () => {
      const feature = buildMinimalFeature({
        inputObservationIds: [1, 1, 2]
      });
      expect(() => parseDerivedFeatureV1(feature)).toThrow();
    });

    it("accepts sorted unique inputObservationIds", () => {
      const feature = buildMinimalFeature({
        inputObservationIds: [1, 2, 3]
      });
      expect(() => parseDerivedFeatureV1(feature)).not.toThrow();
    });

    it("rejects unsorted rejectedObservationIds", () => {
      const feature = buildMinimalFeature({
        rejectedObservationIds: [3, 1]
      });
      expect(() => parseDerivedFeatureV1(feature)).toThrow();
    });

    it("rejects duplicate rejectedObservationIds", () => {
      const feature = buildMinimalFeature({
        rejectedObservationIds: [1, 1]
      });
      expect(() => parseDerivedFeatureV1(feature)).toThrow();
    });

    it("accepts sorted unique rejectedObservationIds", () => {
      const feature = buildMinimalFeature({
        rejectedObservationIds: [1, 2]
      });
      expect(() => parseDerivedFeatureV1(feature)).not.toThrow();
    });

    it("rejects unsorted warnings", () => {
      const feature = buildMinimalFeature({
        warnings: ["z_warning", "a_warning"]
      });
      expect(() => parseDerivedFeatureV1(feature)).toThrow();
    });

    it("rejects duplicate warnings", () => {
      const feature = buildMinimalFeature({
        warnings: ["same_warning", "same_warning"]
      });
      expect(() => parseDerivedFeatureV1(feature)).toThrow();
    });

    it("accepts sorted unique warnings", () => {
      const feature = buildMinimalFeature({
        warnings: ["a_warning", "z_warning"]
      });
      expect(() => parseDerivedFeatureV1(feature)).not.toThrow();
    });

    it("rejects unsorted reasons", () => {
      const feature = buildMinimalFeature({
        status: "UNAVAILABLE",
        value: null,
        reasons: ["z_reason", "a_reason"]
      });
      expect(() => parseDerivedFeatureV1(feature)).toThrow();
    });

    it("rejects duplicate reasons", () => {
      const feature = buildMinimalFeature({
        status: "UNAVAILABLE",
        value: null,
        reasons: ["same_reason", "same_reason"]
      });
      expect(() => parseDerivedFeatureV1(feature)).toThrow();
    });

    it("accepts sorted unique reasons", () => {
      const feature = buildMinimalFeature({
        status: "UNAVAILABLE",
        value: null,
        reasons: ["a_reason", "z_reason"]
      });
      expect(() => parseDerivedFeatureV1(feature)).not.toThrow();
    });
  });

  describe("accepts unavailable no-input provenance only with a stable reason", () => {
    it("accepts UNAVAILABLE with no input refs but has reasons", () => {
      const feature = buildMinimalFeature({
        status: "UNAVAILABLE",
        value: null,
        inputObservationIds: [],
        provenance: {
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
          codeVersion: "test-v1",
          runId: null
        },
        reasons: ["insufficient_data"]
      });
      expect(() => parseDerivedFeatureV1(feature)).not.toThrow();
    });

    it("rejects AVAILABLE with no input refs and no provenance", () => {
      const feature = buildMinimalFeature({
        status: "AVAILABLE",
        value: 500000,
        inputObservationIds: [],
        provenance: {
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
          codeVersion: "test-v1",
          runId: null
        }
      });
      expect(() => parseDerivedFeatureV1(feature)).toThrow();
    });

    it("rejects UNAVAILABLE with no input refs and no reasons", () => {
      const feature = buildMinimalFeature({
        status: "UNAVAILABLE",
        value: null,
        inputObservationIds: [],
        provenance: {
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
          codeVersion: "test-v1",
          runId: null
        },
        reasons: []
      });
      expect(() => parseDerivedFeatureV1(feature)).toThrow();
    });
  });

  describe("rejects removed placeholder feature kinds", () => {
    it("fee_apr is no longer a valid feature kind", () => {
      expect(() => parseFeatureKind("fee_apr")).toThrow(TaxonomyValidationError);
    });

    it("oracle_divergence is no longer a valid feature kind", () => {
      expect(() => parseFeatureKind("oracle_divergence")).toThrow(TaxonomyValidationError);
    });

    it("volatility_24h is no longer a valid feature kind", () => {
      expect(() => parseFeatureKind("volatility_24h")).toThrow(TaxonomyValidationError);
    });

    it("liquidity_depth is no longer a valid feature kind", () => {
      expect(() => parseFeatureKind("liquidity_depth")).toThrow(TaxonomyValidationError);
    });
  });

  describe("FeatureStatus type", () => {
    it("has AVAILABLE status", () => {
      const feature = buildMinimalFeature({ status: "AVAILABLE" });
      expect(() => parseDerivedFeatureV1(feature)).not.toThrow();
    });

    it("has PARTIAL status", () => {
      const feature = buildMinimalFeature({ status: "PARTIAL" });
      expect(() => parseDerivedFeatureV1(feature)).not.toThrow();
    });

    it("has UNAVAILABLE status", () => {
      const feature = buildMinimalFeature({
        status: "UNAVAILABLE",
        value: null,
        reasons: ["test"]
      });
      expect(() => parseDerivedFeatureV1(feature)).not.toThrow();
    });
  });

  describe("FeatureUnit type", () => {
    it("has BPS unit", () => {
      const feature = buildMinimalFeature({
        featureKind: "oracle_dex_divergence",
        unit: "BPS",
        poolId: null,
        positionId: null
      });
      expect(() => parseDerivedFeatureV1(feature)).not.toThrow();
    });

    it("has PPM unit", () => {
      const feature = buildMinimalFeature({ featureKind: "range_location", unit: "PPM" });
      expect(() => parseDerivedFeatureV1(feature)).not.toThrow();
    });
  });

  describe("schema version", () => {
    it("rejects undefined schemaVersion", () => {
      const feature = buildMinimalFeature() as unknown as Record<string, unknown>;
      delete (feature as Partial<DerivedFeatureV1>).schemaVersion;
      expect(() => parseDerivedFeatureV1(feature)).toThrow();
    });

    it("rejects schemaVersion other than 1", () => {
      const feature = buildMinimalFeature({ schemaVersion: 2 as unknown as 1 });
      expect(() => parseDerivedFeatureV1(feature)).toThrow();
    });
  });

  describe("timestamps", () => {
    it("requires asOfUnixMs to be a number", () => {
      const feature = buildMinimalFeature({ asOfUnixMs: "not-a-number" as unknown as number });
      expect(() => parseDerivedFeatureV1(feature)).toThrow();
    });

    it("requires expiresAtUnixMs to be a number", () => {
      const feature = buildMinimalFeature({ expiresAtUnixMs: "not-a-number" as unknown as number });
      expect(() => parseDerivedFeatureV1(feature)).toThrow();
    });

    it("rejects negative timestamps", () => {
      const feature = buildMinimalFeature({ asOfUnixMs: -1 });
      expect(() => parseDerivedFeatureV1(feature)).toThrow();
    });
  });

  describe("confidence and freshness", () => {
    it("requires valid confidence object", () => {
      const feature = buildMinimalFeature({
        confidence: { not: "valid" }
      } as unknown as DerivedFeatureV1["confidence"]);
      expect(() => parseDerivedFeatureV1(feature)).toThrow();
    });

    it("requires valid freshness object", () => {
      const feature = buildMinimalFeature({
        freshness: { not: "valid" }
      } as unknown as DerivedFeatureV1["freshness"]);
      expect(() => parseDerivedFeatureV1(feature)).toThrow();
    });
  });

  describe("version strings", () => {
    it("requires calculatorVersion to be a string", () => {
      const feature = buildMinimalFeature({ calculatorVersion: 123 as unknown as string });
      expect(() => parseDerivedFeatureV1(feature)).toThrow();
    });

    it("requires selectionVersion to be a string", () => {
      const feature = buildMinimalFeature({ selectionVersion: 123 as unknown as string });
      expect(() => parseDerivedFeatureV1(feature)).toThrow();
    });
  });

  describe("calculationMetadata", () => {
    it("requires calculationMetadata to be a plain object", () => {
      const feature = buildMinimalFeature({
        calculationMetadata: "not-an-object" as unknown as Readonly<Record<string, unknown>>
      });
      expect(() => parseDerivedFeatureV1(feature)).toThrow();
    });

    it("accepts empty object metadata", () => {
      const feature = buildMinimalFeature({ calculationMetadata: {} });
      expect(() => parseDerivedFeatureV1(feature)).not.toThrow();
    });

    it("accepts metadata with nested values", () => {
      const feature = buildMinimalFeature({
        calculationMetadata: { nested: { value: 42 }, arr: [1, 2, 3] }
      });
      expect(() => parseDerivedFeatureV1(feature)).not.toThrow();
    });
  });

  describe("pair field", () => {
    it("requires pair to be SOL/USDC", () => {
      const feature = buildMinimalFeature({ pair: "SOL/USDC" });
      expect(() => parseDerivedFeatureV1(feature)).not.toThrow();
    });

    it("rejects other pair values", () => {
      const feature = buildMinimalFeature({ pair: "ETH/USDC" } as unknown as "SOL/USDC");
      expect(() => parseDerivedFeatureV1(feature)).toThrow();
    });
  });
});
