import { describe, it, expect } from "vitest";
import {
  makeSupportResistanceRawSnapshot,
  makeSupportResistancePointClaim,
  makeSupportResistanceZoneClaim,
  makeLongExtract
} from "../../fixtures/support-resistance.js";
import { acceptSupportResistanceSnapshot } from "../../../src/domain/support-resistance/validate.js";
import { normalizeSupportResistanceClaims } from "../../../src/domain/support-resistance/normalize.js";

describe("acceptSupportResistanceSnapshot", () => {
  describe("bounded-retention", () => {
    it("accepts a bounded SOL/USDC snapshot and trims retained extracts to 500 characters", () => {
      const longExtract = makeLongExtract(1000);
      const snapshot = makeSupportResistanceRawSnapshot({
        claims: [
          makeSupportResistancePointClaim(150.5, "RESISTANCE", { sourceExtract: longExtract })
        ],
        sourceReferences: ["https://example.com/analysis"]
      });

      const result = acceptSupportResistanceSnapshot(snapshot);

      expect(result.claims[0]).toBeDefined();
      const claim = result.claims[0] as { sourceExtract?: string };
      expect(claim.sourceExtract).toBeDefined();
      expect(claim.sourceExtract!.length).toBeLessThanOrEqual(500);
    });

    it("does not retain arbitrary extra fields from the input", () => {
      const snapshot = makeSupportResistanceRawSnapshot({
        claims: [makeSupportResistancePointClaim(150.5)],
        extraField: "should not be retained"
      });

      const result = acceptSupportResistanceSnapshot(snapshot);

      expect((result as unknown as Record<string, unknown>).extraField).toBeUndefined();
    });
  });

  describe("invalid-snapshot-rejection", () => {
    it("rejects wrong pair", () => {
      const snapshot = makeSupportResistanceRawSnapshot({ pair: "ETH/USDC" });
      expect(() => acceptSupportResistanceSnapshot(snapshot)).toThrow();
    });

    it("rejects invalid asOfUnixMs (NaN)", () => {
      const snapshot = makeSupportResistanceRawSnapshot({ asOfUnixMs: NaN });
      expect(() => acceptSupportResistanceSnapshot(snapshot)).toThrow();
    });

    it("rejects invalid asOfUnixMs (Infinity)", () => {
      const snapshot = makeSupportResistanceRawSnapshot({ asOfUnixMs: Infinity });
      expect(() => acceptSupportResistanceSnapshot(snapshot)).toThrow();
    });

    it("rejects source reliability out of range (> 1)", () => {
      const snapshot = makeSupportResistanceRawSnapshot({ sourceReliability: 1.5 });
      expect(() => acceptSupportResistanceSnapshot(snapshot)).toThrow();
    });

    it("rejects source reliability out of range (< 0)", () => {
      const snapshot = makeSupportResistanceRawSnapshot({ sourceReliability: -0.1 });
      expect(() => acceptSupportResistanceSnapshot(snapshot)).toThrow();
    });

    it("rejects empty providerId", () => {
      const snapshot = makeSupportResistanceRawSnapshot({ providerId: "" });
      expect(() => acceptSupportResistanceSnapshot(snapshot)).toThrow();
    });

    it("rejects empty providerRunId", () => {
      const snapshot = makeSupportResistanceRawSnapshot({ providerRunId: "" });
      expect(() => acceptSupportResistanceSnapshot(snapshot)).toThrow();
    });

    it("rejects claims with invalid level (NaN)", () => {
      const snapshot = makeSupportResistanceRawSnapshot({
        claims: [makeSupportResistancePointClaim(NaN)]
      });
      expect(() => acceptSupportResistanceSnapshot(snapshot)).toThrow();
    });

    it("rejects zone with lower >= upper", async () => {
      const snapshot = makeSupportResistanceRawSnapshot({
        claims: [makeSupportResistanceZoneClaim(160, 150)]
      });
      const bounded = acceptSupportResistanceSnapshot(snapshot);
      const result = await normalizeSupportResistanceClaims(bounded);
      expect(result.accepted).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
    });

    it("rejects zone with non-positive bounds", async () => {
      const snapshot = makeSupportResistanceRawSnapshot({
        claims: [makeSupportResistanceZoneClaim(-10, 150)]
      });
      const bounded = acceptSupportResistanceSnapshot(snapshot);
      const result = await normalizeSupportResistanceClaims(bounded);
      expect(result.accepted).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
    });
  });
});
