import { describe, it, expect } from "vitest";
import {
  makeSupportResistanceRawSnapshot,
  makeSupportResistancePointClaim,
  makeSupportResistanceZoneClaim,
  makeSupportResistanceRawClaim
} from "../../fixtures/support-resistance.js";
import { normalizeSupportResistanceClaims } from "../../../src/domain/support-resistance/normalize.js";

describe("normalizeSupportResistanceClaims", () => {
  describe("point-preservation", () => {
    it("normalizes an explicit point without zone fields", () => {
      const snapshot = makeSupportResistanceRawSnapshot({
        claims: [makeSupportResistancePointClaim(150.5, "RESISTANCE")]
      });

      const result = normalizeSupportResistanceClaims(snapshot);

      expect(result.accepted).toHaveLength(1);
      const claim = result.accepted[0];
      expect(claim.levelType).toBe("point");
      expect((claim as { levelUsdcPerSol: number }).levelUsdcPerSol).toBe(150.5);
      expect((claim as { zoneLowerUsdcPerSol: unknown }).zoneLowerUsdcPerSol).toBeUndefined();
      expect((claim as { zoneUpperUsdcPerSol: unknown }).zoneUpperUsdcPerSol).toBeUndefined();
    });
  });

  describe("zone-preservation", () => {
    it("normalizes ordered zone bounds without a point field", () => {
      const snapshot = makeSupportResistanceRawSnapshot({
        claims: [makeSupportResistanceZoneClaim(145.0, 155.0, "SUPPORT")]
      });

      const result = normalizeSupportResistanceClaims(snapshot);

      expect(result.accepted).toHaveLength(1);
      const claim = result.accepted[0];
      expect(claim.levelType).toBe("zone");
      expect((claim as { zoneLowerUsdcPerSol: number }).zoneLowerUsdcPerSol).toBe(145.0);
      expect((claim as { zoneUpperUsdcPerSol: number }).zoneUpperUsdcPerSol).toBe(155.0);
      expect((claim as { levelUsdcPerSol: unknown }).levelUsdcPerSol).toBeUndefined();
    });
  });

  describe("missing-level-unavailable", () => {
    it("does not fabricate a normalized claim when a source claim has no numeric level", () => {
      const snapshot = makeSupportResistanceRawSnapshot({
        claims: [
          makeSupportResistanceRawClaim({
            evidenceSide: "RESISTANCE"
          })
        ]
      });

      const result = normalizeSupportResistanceClaims(snapshot);

      expect(result.accepted).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0]?.reason).toBe("missing_level");
    });

    it("does not fabricate a normalized claim when zone has only one bound", () => {
      const snapshot = makeSupportResistanceRawSnapshot({
        claims: [
          makeSupportResistanceRawClaim({
            zoneLowerUsdcPerSol: 145.0,
            evidenceSide: "SUPPORT"
          })
        ]
      });

      const result = normalizeSupportResistanceClaims(snapshot);

      expect(result.accepted).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
    });
  });

  describe("malformed-level-rejection", () => {
    it("rejects mixed point and zone fields", () => {
      const snapshot = makeSupportResistanceRawSnapshot({
        claims: [
          makeSupportResistanceRawClaim({
            levelUsdcPerSol: 150.5,
            zoneLowerUsdcPerSol: 145.0,
            zoneUpperUsdcPerSol: 155.0,
            evidenceSide: "RESISTANCE"
          })
        ]
      });

      const result = normalizeSupportResistanceClaims(snapshot);

      expect(result.accepted).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
    });

    it("rejects inverted zone bounds", () => {
      const snapshot = makeSupportResistanceRawSnapshot({
        claims: [makeSupportResistanceZoneClaim(155.0, 145.0, "RESISTANCE")]
      });

      const result = normalizeSupportResistanceClaims(snapshot);

      expect(result.accepted).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
    });

    it("rejects non-positive point value", () => {
      const snapshot = makeSupportResistanceRawSnapshot({
        claims: [makeSupportResistancePointClaim(0, "RESISTANCE")]
      });

      const result = normalizeSupportResistanceClaims(snapshot);

      expect(result.accepted).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
    });

    it("rejects negative point value", () => {
      const snapshot = makeSupportResistanceRawSnapshot({
        claims: [makeSupportResistancePointClaim(-10, "RESISTANCE")]
      });

      const result = normalizeSupportResistanceClaims(snapshot);

      expect(result.accepted).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
    });
  });

  describe("explicit-ambiguity", () => {
    it("adds explicit warnings for missing references", () => {
      const snapshot = makeSupportResistanceRawSnapshot({
        claims: [makeSupportResistancePointClaim(150.5, "RESISTANCE")],
        sourceReferences: []
      });

      const result = normalizeSupportResistanceClaims(snapshot);

      expect(result.warnings).toContain("missing_source_reference");
    });

    it("adds explicit warnings for missing invalidation conditions", () => {
      const snapshot = makeSupportResistanceRawSnapshot({
        claims: [makeSupportResistancePointClaim(150.5, "RESISTANCE")],
        sourceReferences: ["https://example.com"]
      });

      const result = normalizeSupportResistanceClaims(snapshot);

      expect(result.warnings).toContain("missing_invalidation_conditions");
    });

    it("adds explicit warnings for ambiguous source claims", () => {
      const snapshot = makeSupportResistanceRawSnapshot({
        claims: [
          makeSupportResistancePointClaim(150.5, "RESISTANCE"),
          makeSupportResistancePointClaim(150.5, "RESISTANCE")
        ],
        sourceReferences: ["https://example.com"]
      });

      const result = normalizeSupportResistanceClaims(snapshot);

      expect(result.warnings).toContain("ambiguous_source_claim");
    });

    it("normalizes duplicate thesis codes by sorting and deduplication", () => {
      const snapshot = makeSupportResistanceRawSnapshot({
        claims: [makeSupportResistancePointClaim(150.5, "RESISTANCE")],
        sourceReferences: ["https://example.com"]
      });

      const result = normalizeSupportResistanceClaims(snapshot);

      const claim = result.accepted[0] as { thesisCodes: readonly string[] };
      const sortedCodes = [...claim.thesisCodes].sort();
      expect(claim.thesisCodes).toEqual(sortedCodes);
    });
  });
});
