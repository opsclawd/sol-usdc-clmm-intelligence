import { describe, it, expect } from "vitest";
import type {
  SupportResistanceLevel,
  SupportResistancePayloadV1,
  SupportResistanceWarning,
  SupportResistanceCollectionResult,
  SupportResistanceRawSnapshot
} from "../../src/contracts/support-resistance.js";

function isPointLevel(
  level: SupportResistanceLevel
): level is Extract<SupportResistanceLevel, { levelType: "point" }> {
  return level.levelType === "point";
}

function isZoneLevel(
  level: SupportResistanceLevel
): level is Extract<SupportResistanceLevel, { levelType: "zone" }> {
  return level.levelType === "zone";
}

describe("SupportResistanceLevel", () => {
  describe("represents point and zone levels without silent conversion", () => {
    it("point level has only levelUsdcPerSol and no zone bounds", () => {
      const pointLevel: SupportResistanceLevel = {
        levelType: "point",
        levelUsdcPerSol: 150.5
      };
      expect(pointLevel.levelType).toBe("point");
      expect(isPointLevel(pointLevel)).toBe(true);
      expect(isZoneLevel(pointLevel)).toBe(false);
      expect("zoneLowerUsdcPerSol" in pointLevel).toBe(false);
      expect("zoneUpperUsdcPerSol" in pointLevel).toBe(false);
    });

    it("zone level has only zone bounds and no point value", () => {
      const zoneLevel: SupportResistanceLevel = {
        levelType: "zone",
        zoneLowerUsdcPerSol: 148.0,
        zoneUpperUsdcPerSol: 152.0
      };
      expect(zoneLevel.levelType).toBe("zone");
      expect(isZoneLevel(zoneLevel)).toBe(true);
      expect(isPointLevel(zoneLevel)).toBe(false);
      expect("levelUsdcPerSol" in zoneLevel).toBe(false);
    });

    it("point payload does not include zone fields", () => {
      const pointPayload: SupportResistancePayloadV1 = {
        kind: "support_resistance_level",
        schemaVersion: 1,
        pair: "SOL/USDC",
        unit: "USDC_PER_SOL",
        evidenceSide: "SUPPORT",
        timeframe: "1h",
        thesisCodes: ["TA-001"],
        asOfUnixMs: Date.now(),
        expiresAtUnixMs: Date.now() + 86_400_000,
        invalidationConditions: ["price_below_support"],
        warnings: [],
        sourceReferences: ["https://example.com/ta"],
        sourceQuality: {
          providerId: "ta-provider",
          reliability: 0.85,
          completeness: "complete"
        },
        levelType: "point",
        levelUsdcPerSol: 150.5
      };
      expect(pointPayload.levelType).toBe("point");
      expect(isPointLevel(pointPayload)).toBe(true);
      expect("zoneLowerUsdcPerSol" in pointPayload).toBe(false);
      expect("zoneUpperUsdcPerSol" in pointPayload).toBe(false);
    });

    it("zone payload does not include point field", () => {
      const zonePayload: SupportResistancePayloadV1 = {
        kind: "support_resistance_level",
        schemaVersion: 1,
        pair: "SOL/USDC",
        unit: "USDC_PER_SOL",
        evidenceSide: "RESISTANCE",
        timeframe: "4h",
        thesisCodes: ["TA-002"],
        asOfUnixMs: Date.now(),
        expiresAtUnixMs: Date.now() + 86_400_000,
        invalidationConditions: ["price_above_resistance"],
        warnings: [],
        sourceReferences: ["https://example.com/ta"],
        sourceQuality: {
          providerId: "ta-provider",
          reliability: 0.8,
          completeness: "partial"
        },
        levelType: "zone",
        zoneLowerUsdcPerSol: 148.0,
        zoneUpperUsdcPerSol: 152.0
      };
      expect(zonePayload.levelType).toBe("zone");
      expect(isZoneLevel(zonePayload)).toBe(true);
      expect("levelUsdcPerSol" in zonePayload).toBe(false);
    });
  });
});

describe("SupportResistancePayloadV1", () => {
  it("accepts valid support point payload", () => {
    const payload: SupportResistancePayloadV1 = {
      kind: "support_resistance_level",
      schemaVersion: 1,
      pair: "SOL/USDC",
      unit: "USDC_PER_SOL",
      evidenceSide: "SUPPORT",
      timeframe: "1h",
      thesisCodes: ["TA-001", "TA-003"],
      asOfUnixMs: Date.now(),
      expiresAtUnixMs: Date.now() + 86_400_000,
      invalidationConditions: ["price_below_support", "time_decay"],
      warnings: ["missing_invalidation_conditions"],
      sourceReferences: ["https://example.com/ta", "https://example.com/ta2"],
      sourceQuality: {
        providerId: "ta-provider",
        reliability: 0.85,
        completeness: "complete"
      },
      levelType: "point",
      levelUsdcPerSol: 150.5
    };
    expect(payload.kind).toBe("support_resistance_level");
    expect(payload.evidenceSide).toBe("SUPPORT");
  });

  it("accepts valid resistance zone payload", () => {
    const payload: SupportResistancePayloadV1 = {
      kind: "support_resistance_level",
      schemaVersion: 1,
      pair: "SOL/USDC",
      unit: "USDC_PER_SOL",
      evidenceSide: "RESISTANCE",
      timeframe: "4h",
      thesisCodes: [],
      asOfUnixMs: Date.now(),
      expiresAtUnixMs: Date.now() + 86_400_000,
      invalidationConditions: [],
      warnings: [],
      sourceReferences: [],
      sourceQuality: {
        providerId: "ta-provider",
        reliability: 0.75,
        completeness: "partial"
      },
      levelType: "zone",
      zoneLowerUsdcPerSol: 155.0,
      zoneUpperUsdcPerSol: 160.0
    };
    expect(payload.kind).toBe("support_resistance_level");
    expect(payload.evidenceSide).toBe("RESISTANCE");
  });
});

describe("SupportResistanceWarning", () => {
  const warningCodes: SupportResistanceWarning[] = [
    "ambiguous_source_claim",
    "conflicting_source_claim",
    "duplicate_equivalent_claim",
    "missing_invalidation_conditions",
    "missing_level",
    "missing_source_reference",
    "stale_observation"
  ];

  it("accepts all valid warning codes", () => {
    for (const code of warningCodes) {
      const payload: SupportResistancePayloadV1 = {
        kind: "support_resistance_level",
        schemaVersion: 1,
        pair: "SOL/USDC",
        unit: "USDC_PER_SOL",
        evidenceSide: "SUPPORT",
        timeframe: "1h",
        thesisCodes: [],
        asOfUnixMs: Date.now(),
        expiresAtUnixMs: Date.now() + 86_400_000,
        invalidationConditions: [],
        warnings: [code],
        sourceReferences: [],
        sourceQuality: {
          providerId: "ta-provider",
          reliability: 0.8,
          completeness: "complete"
        },
        levelType: "point",
        levelUsdcPerSol: 150.0
      };
      expect(payload.warnings).toContain(code);
    }
  });
});

describe("SupportResistanceCollectionResult", () => {
  it("accepts accepted status with usable evidence", () => {
    const result: SupportResistanceCollectionResult = {
      status: "accepted",
      hasUsableEvidence: true,
      rawId: null,
      rawCount: 5,
      warnings: [],
      freshness: {
        isStale: false,
        validUntilUnixMs: Date.now() + 86_400_000,
        derivedAt: Date.now(),
        policyKind: "support_resistance_level",
        reasons: []
      },
      confidence: {
        components: {
          sourceReliability: 0.85,
          dataCompleteness: 0.9,
          derivationConfidence: 0.8,
          llmConfidence: null
        },
        compositeScore: 0.85,
        level: "high",
        weightingVersion: "v1",
        reasons: []
      },
      diagnostic: null
    };
    expect(result.status).toBe("accepted");
    expect(result.hasUsableEvidence).toBe(true);
  });

  it("accepts degraded status when warnings present", () => {
    const result: SupportResistanceCollectionResult = {
      status: "degraded",
      hasUsableEvidence: true,
      rawId: null,
      rawCount: 3,
      warnings: ["ambiguous_source_claim", "missing_invalidation_conditions"],
      freshness: {
        isStale: false,
        validUntilUnixMs: Date.now() + 86_400_000,
        derivedAt: Date.now(),
        policyKind: "support_resistance_level",
        reasons: []
      },
      confidence: {
        components: {
          sourceReliability: 0.6,
          dataCompleteness: 0.7,
          derivationConfidence: 0.5,
          llmConfidence: null
        },
        compositeScore: 0.6,
        level: "medium",
        weightingVersion: "v1",
        reasons: ["source_reliability_low"]
      },
      diagnostic: "Ambiguous source claims detected"
    };
    expect(result.status).toBe("degraded");
    expect(result.warnings).toHaveLength(2);
  });

  it("accepts stale status when observation is stale", () => {
    const result: SupportResistanceCollectionResult = {
      status: "stale",
      hasUsableEvidence: false,
      rawId: null,
      rawCount: 1,
      warnings: ["stale_observation"],
      freshness: {
        isStale: true,
        validUntilUnixMs: Date.now() - 1000,
        derivedAt: Date.now(),
        policyKind: "support_resistance_level",
        reasons: ["expired_past_max_observed_age"]
      },
      confidence: {
        components: {
          sourceReliability: 0.5,
          dataCompleteness: 0.5,
          derivationConfidence: 0.5,
          llmConfidence: null
        },
        compositeScore: 0.5,
        level: "medium",
        weightingVersion: "v1",
        reasons: []
      },
      diagnostic: null
    };
    expect(result.status).toBe("stale");
    expect(result.freshness.isStale).toBe(true);
  });

  it("accepts conflict status when claims conflict", () => {
    const result: SupportResistanceCollectionResult = {
      status: "conflict",
      hasUsableEvidence: false,
      rawId: null,
      rawCount: 2,
      warnings: ["conflicting_source_claim"],
      freshness: {
        isStale: false,
        validUntilUnixMs: Date.now() + 86_400_000,
        derivedAt: Date.now(),
        policyKind: "support_resistance_level",
        reasons: []
      },
      confidence: {
        components: {
          sourceReliability: 0.3,
          dataCompleteness: 0.4,
          derivationConfidence: 0.3,
          llmConfidence: null
        },
        compositeScore: 0.3,
        level: "low",
        weightingVersion: "v1",
        reasons: ["source_reliability_low"]
      },
      diagnostic: "Conflicting support/resistance levels detected"
    };
    expect(result.status).toBe("conflict");
    expect(result.hasUsableEvidence).toBe(false);
  });
});

describe("SupportResistanceRawSnapshot", () => {
  it("accepts valid raw snapshot with point claim", () => {
    const snapshot: SupportResistanceRawSnapshot = {
      providerId: "ta-provider",
      providerRunId: "run-123",
      pair: "SOL/USDC",
      asOfUnixMs: Date.now(),
      sourceReferences: ["https://example.com/ta"],
      claims: [
        {
          levelUsdcPerSol: 150.0,
          evidenceSide: "SUPPORT",
          sourceExtract: "Support identified at 150.0 USD"
        }
      ]
    };
    expect(snapshot.claims).toHaveLength(1);
    expect(snapshot.claims[0].levelUsdcPerSol).toBe(150.0);
    expect(snapshot.claims[0].zoneLowerUsdcPerSol).toBeUndefined();
  });

  it("accepts raw snapshot with zone claim", () => {
    const snapshot: SupportResistanceRawSnapshot = {
      providerId: "ta-provider",
      providerRunId: "run-456",
      pair: "SOL/USDC",
      asOfUnixMs: Date.now(),
      sourceReferences: ["https://example.com/ta-zone"],
      claims: [
        {
          zoneLowerUsdcPerSol: 148.0,
          zoneUpperUsdcPerSol: 152.0,
          evidenceSide: "RESISTANCE"
        }
      ]
    };
    expect(snapshot.claims[0].zoneLowerUsdcPerSol).toBe(148.0);
    expect(snapshot.claims[0].zoneUpperUsdcPerSol).toBe(152.0);
  });

  it("accepts raw snapshot with mixed claims", () => {
    const snapshot: SupportResistanceRawSnapshot = {
      providerId: "ta-provider",
      providerRunId: "run-789",
      pair: "SOL/USDC",
      asOfUnixMs: Date.now(),
      sourceReferences: ["https://example.com/ta"],
      claims: [
        {
          levelUsdcPerSol: 150.0,
          evidenceSide: "SUPPORT"
        },
        {
          zoneLowerUsdcPerSol: 155.0,
          zoneUpperUsdcPerSol: 160.0,
          evidenceSide: "RESISTANCE"
        }
      ]
    };
    expect(snapshot.claims).toHaveLength(2);
  });

  it("accepts raw snapshot with claim missing level (for retention)", () => {
    const snapshot: SupportResistanceRawSnapshot = {
      providerId: "ta-provider",
      providerRunId: "run-no-level",
      pair: "SOL/USDC",
      asOfUnixMs: Date.now(),
      sourceReferences: [],
      claims: [
        {
          evidenceSide: "SUPPORT",
          sourceExtract: "Potential support zone identified"
        }
      ]
    };
    expect(snapshot.claims).toHaveLength(1);
    expect(snapshot.claims[0].levelUsdcPerSol).toBeUndefined();
    expect(snapshot.claims[0].zoneLowerUsdcPerSol).toBeUndefined();
  });
});
