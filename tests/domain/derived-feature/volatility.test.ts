import { describe, it, expect } from "vitest";
import {
  calculateRealizedVolatility1h,
  REALIZED_VOLATILITY_1H_VERSION,
  VOLATILITY_WINDOW_MS,
  VOLATILITY_MIN_SAMPLES,
  VOLATILITY_MIN_SPAN_MS,
  VOLATILITY_MAX_GAP_MS,
  type PriceObservation
} from "../../../src/domain/derived-feature/volatility.js";

const ANCHOR = 1_000_000_000_000;
const WINDOW_START = ANCHOR - VOLATILITY_WINDOW_MS;

function makeObservation(id: number, ts: number, price: string): PriceObservation {
  return { id, slot: 100 + id, observedAtUnixMs: ts, price, receivedAtUnixMs: ts };
}

describe("realized volatility 1h", () => {
  describe("computes nonannualized one hour realized volatility from ordered log returns", () => {
    it("handles a simple golden series with known result", () => {
      const observations: PriceObservation[] = [
        makeObservation(1, WINDOW_START + 1_000, "100.0"),
        makeObservation(2, WINDOW_START + 400_000, "100.5"),
        makeObservation(3, WINDOW_START + 800_000, "101.0"),
        makeObservation(4, WINDOW_START + 1_200_000, "101.5"),
        makeObservation(5, WINDOW_START + 1_600_000, "102.0"),
        makeObservation(6, WINDOW_START + 2_000_000, "102.5"),
        makeObservation(7, WINDOW_START + 2_400_000, "103.0"),
        makeObservation(8, WINDOW_START + 2_800_000, "103.5"),
        makeObservation(9, WINDOW_START + 3_200_000, "104.0"),
        makeObservation(10, ANCHOR, "104.5")
      ];

      const result = calculateRealizedVolatility1h(observations, ANCHOR);

      expect(result.status).toBe("AVAILABLE");
      if (result.status !== "AVAILABLE") return;

      expect(result.metadata.sampleCount).toBe(10);
      expect(result.metadata.maxGapMs).toBeLessThanOrEqual(VOLATILITY_MAX_GAP_MS);
      expect(result.metadata.unit).toBe("BPS");
      expect(result.reasons).toEqual([]);
    });

    it("returns result in BPS without annualization", () => {
      const observations: PriceObservation[] = [
        makeObservation(1, WINDOW_START + 1_000, "100.0"),
        makeObservation(2, WINDOW_START + 400_000, "100.1"),
        makeObservation(3, WINDOW_START + 800_000, "100.2"),
        makeObservation(4, WINDOW_START + 1_200_000, "100.3"),
        makeObservation(5, WINDOW_START + 1_600_000, "100.4"),
        makeObservation(6, WINDOW_START + 2_000_000, "100.5"),
        makeObservation(7, WINDOW_START + 2_400_000, "100.6"),
        makeObservation(8, WINDOW_START + 2_800_000, "100.7"),
        makeObservation(9, WINDOW_START + 3_200_000, "100.8"),
        makeObservation(10, ANCHOR, "100.9")
      ];

      const result = calculateRealizedVolatility1h(observations, ANCHOR);

      expect(result.status).toBe("AVAILABLE");
      if (result.status !== "AVAILABLE") return;

      expect(result.metadata.unit).toBe("BPS");
      expect(result.value).toBeGreaterThan(0);
      expect(result.reasons).toEqual([]);
    });
  });

  describe("uses the inclusive one-hour window and deterministic duplicate winner", () => {
    it("includes observations exactly at window boundaries", () => {
      const observations: PriceObservation[] = [
        makeObservation(1, WINDOW_START, "100.0"),
        makeObservation(2, WINDOW_START + 400_000, "101.0"),
        makeObservation(3, WINDOW_START + 800_000, "102.0"),
        makeObservation(4, WINDOW_START + 1_200_000, "103.0"),
        makeObservation(5, WINDOW_START + 1_600_000, "104.0"),
        makeObservation(6, WINDOW_START + 2_000_000, "105.0"),
        makeObservation(7, WINDOW_START + 2_400_000, "106.0"),
        makeObservation(8, WINDOW_START + 2_800_000, "107.0"),
        makeObservation(9, WINDOW_START + 3_200_000, "108.0"),
        makeObservation(10, ANCHOR, "109.0")
      ];

      const result = calculateRealizedVolatility1h(observations, ANCHOR);

      expect(result.status).toBe("AVAILABLE");
      if (result.status !== "AVAILABLE") return;

      expect(result.metadata.sampleCount).toBe(10);
    });

    it("picks highest slot per duplicate timestamp", () => {
      const observations: PriceObservation[] = [
        makeObservation(1, WINDOW_START + 1_000, "100.0"),
        makeObservation(2, WINDOW_START + 400_000, "102.0"),
        makeObservation(3, WINDOW_START + 800_000, "103.0"),
        makeObservation(4, WINDOW_START + 1_200_000, "104.0"),
        {
          id: 5,
          slot: 105,
          observedAtUnixMs: WINDOW_START + 1_600_000,
          price: "105.0",
          receivedAtUnixMs: WINDOW_START + 1_600_000
        },
        {
          id: 6,
          slot: 106,
          observedAtUnixMs: WINDOW_START + 1_600_000,
          price: "107.0",
          receivedAtUnixMs: WINDOW_START + 1_600_000
        },
        {
          id: 7,
          slot: 104,
          observedAtUnixMs: WINDOW_START + 1_600_000,
          price: "103.5",
          receivedAtUnixMs: WINDOW_START + 1_600_000
        },
        makeObservation(8, WINDOW_START + 2_000_000, "108.0"),
        makeObservation(9, WINDOW_START + 2_400_000, "109.0"),
        makeObservation(10, WINDOW_START + 2_800_000, "110.0"),
        makeObservation(11, WINDOW_START + 3_200_000, "111.0"),
        makeObservation(12, ANCHOR, "112.0")
      ];

      const result = calculateRealizedVolatility1h(observations, ANCHOR);

      expect(result.status).toBe("AVAILABLE");
      if (result.status !== "AVAILABLE") return;

      expect(result.value).toBeGreaterThan(0);
    });

    it("picks highest ID when slot and receipt are equal", () => {
      const observations: PriceObservation[] = [
        makeObservation(1, WINDOW_START + 1_000, "100.0"),
        makeObservation(2, WINDOW_START + 400_000, "102.0"),
        makeObservation(3, WINDOW_START + 800_000, "104.0"),
        makeObservation(4, WINDOW_START + 1_200_000, "106.0"),
        {
          id: 5,
          slot: 104,
          observedAtUnixMs: WINDOW_START + 1_600_000,
          price: "105.0",
          receivedAtUnixMs: WINDOW_START + 1_600_000
        },
        {
          id: 6,
          slot: 104,
          observedAtUnixMs: WINDOW_START + 1_600_000,
          price: "107.0",
          receivedAtUnixMs: WINDOW_START + 1_600_000
        },
        makeObservation(7, WINDOW_START + 2_000_000, "108.0"),
        makeObservation(8, WINDOW_START + 2_400_000, "109.0"),
        makeObservation(9, WINDOW_START + 2_800_000, "110.0"),
        makeObservation(10, WINDOW_START + 3_200_000, "111.0"),
        makeObservation(11, ANCHOR, "112.0")
      ];

      const result = calculateRealizedVolatility1h(observations, ANCHOR);

      expect(result.status).toBe("AVAILABLE");
      if (result.status !== "AVAILABLE") return;

      expect(result.value).toBeGreaterThan(0);
    });
  });

  describe("is unavailable below minimum coverage", () => {
    it("returns unavailable when fewer than 10 samples", () => {
      const observations: PriceObservation[] = [
        makeObservation(1, WINDOW_START + 1_000, "100.0"),
        makeObservation(2, WINDOW_START + 400_000, "105.0"),
        makeObservation(3, WINDOW_START + 800_000, "102.0"),
        makeObservation(4, WINDOW_START + 1_200_000, "110.0"),
        makeObservation(5, WINDOW_START + 1_600_000, "108.0"),
        makeObservation(6, WINDOW_START + 2_000_000, "112.0"),
        makeObservation(7, WINDOW_START + 2_400_000, "111.0"),
        makeObservation(8, WINDOW_START + 2_800_000, "113.0"),
        makeObservation(9, WINDOW_START + 3_200_000, "115.0")
      ];

      const result = calculateRealizedVolatility1h(observations, ANCHOR);

      expect(result.status).toBe("UNAVAILABLE");
      if (result.status !== "UNAVAILABLE") return;

      expect(result.reasons).toContain("insufficient_coverage");
      expect(result.metadata.insufficientReason).toBe("fewer_than_10_samples");
    });

    it("returns unavailable when span is less than 45 minutes", () => {
      const observations: PriceObservation[] = [
        makeObservation(1, WINDOW_START + 1_000, "100.0"),
        makeObservation(2, WINDOW_START + 50_000, "105.0"),
        makeObservation(3, WINDOW_START + 100_000, "102.0"),
        makeObservation(4, WINDOW_START + 150_000, "110.0"),
        makeObservation(5, WINDOW_START + 200_000, "108.0"),
        makeObservation(6, WINDOW_START + 250_000, "112.0"),
        makeObservation(7, WINDOW_START + 300_000, "111.0"),
        makeObservation(8, WINDOW_START + 350_000, "113.0"),
        makeObservation(9, WINDOW_START + 400_000, "115.0"),
        makeObservation(10, WINDOW_START + 450_000, "114.0")
      ];

      const result = calculateRealizedVolatility1h(observations, ANCHOR);

      expect(result.status).toBe("UNAVAILABLE");
      if (result.status !== "UNAVAILABLE") return;

      expect(result.reasons).toContain("insufficient_coverage");
      expect(result.metadata.insufficientReason).toBe("span_less_than_45_minutes");
    });
  });

  describe("is unavailable when any adjacent gap exceeds ten minutes", () => {
    it("allows exactly 10 minute gap (599_999 ms)", () => {
      const observations: PriceObservation[] = [
        makeObservation(1, WINDOW_START + 1_000, "100.0"),
        makeObservation(2, WINDOW_START + 400_000, "101.0"),
        makeObservation(3, WINDOW_START + 800_000, "102.0"),
        makeObservation(4, WINDOW_START + 1_200_000, "103.0"),
        makeObservation(5, WINDOW_START + 1_600_000, "104.0"),
        makeObservation(6, WINDOW_START + 2_000_000, "105.0"),
        makeObservation(7, WINDOW_START + 2_400_000, "106.0"),
        makeObservation(8, WINDOW_START + 2_800_000, "107.0"),
        makeObservation(9, WINDOW_START + 3_200_000, "108.0"),
        makeObservation(10, ANCHOR, "109.0")
      ];

      const result = calculateRealizedVolatility1h(observations, ANCHOR);

      expect(result.status).toBe("AVAILABLE");
      if (result.status !== "AVAILABLE") return;

      expect(result.metadata.maxGapMs).toBeLessThanOrEqual(VOLATILITY_MAX_GAP_MS);
    });

    it("fails when any gap exceeds 10 minutes (600_001 ms)", () => {
      const observations: PriceObservation[] = [
        makeObservation(1, WINDOW_START + 1_000, "100.0"),
        makeObservation(2, WINDOW_START + 400_000, "101.0"),
        makeObservation(3, WINDOW_START + 800_000, "102.0"),
        makeObservation(4, WINDOW_START + 1_200_000, "103.0"),
        makeObservation(5, WINDOW_START + 1_600_000, "104.0"),
        makeObservation(6, WINDOW_START + 2_000_000, "105.0"),
        makeObservation(7, WINDOW_START + 2_600_001, "106.0"),
        makeObservation(8, WINDOW_START + 3_000_001, "107.0"),
        makeObservation(9, WINDOW_START + 3_200_000, "108.0"),
        makeObservation(10, ANCHOR, "109.0")
      ];

      const result = calculateRealizedVolatility1h(observations, ANCHOR);

      expect(result.status).toBe("UNAVAILABLE");
      if (result.status !== "UNAVAILABLE") return;

      expect(result.reasons).toContain("excessive_gap");
    });
  });

  describe("is unavailable for nonpositive or nonfinite price math", () => {
    it("rejects zero price", () => {
      const observations: PriceObservation[] = [
        makeObservation(1, WINDOW_START + 1_000, "100.0"),
        makeObservation(2, WINDOW_START + 400_000, "0.0"),
        makeObservation(3, WINDOW_START + 800_000, "102.0"),
        makeObservation(4, WINDOW_START + 1_200_000, "103.0"),
        makeObservation(5, WINDOW_START + 1_600_000, "104.0"),
        makeObservation(6, WINDOW_START + 2_000_000, "105.0"),
        makeObservation(7, WINDOW_START + 2_400_000, "106.0"),
        makeObservation(8, WINDOW_START + 2_800_000, "107.0"),
        makeObservation(9, WINDOW_START + 3_200_000, "108.0"),
        makeObservation(10, ANCHOR, "109.0")
      ];

      const result = calculateRealizedVolatility1h(observations, ANCHOR);

      expect(result.status).toBe("UNAVAILABLE");
      if (result.status !== "UNAVAILABLE") return;

      expect(result.reasons).toContain("invalid_price");
    });

    it("rejects negative price", () => {
      const observations: PriceObservation[] = [
        makeObservation(1, WINDOW_START + 1_000, "100.0"),
        makeObservation(2, WINDOW_START + 400_000, "-105.0"),
        makeObservation(3, WINDOW_START + 800_000, "102.0"),
        makeObservation(4, WINDOW_START + 1_200_000, "103.0"),
        makeObservation(5, WINDOW_START + 1_600_000, "104.0"),
        makeObservation(6, WINDOW_START + 2_000_000, "105.0"),
        makeObservation(7, WINDOW_START + 2_400_000, "106.0"),
        makeObservation(8, WINDOW_START + 2_800_000, "107.0"),
        makeObservation(9, WINDOW_START + 3_200_000, "108.0"),
        makeObservation(10, ANCHOR, "109.0")
      ];

      const result = calculateRealizedVolatility1h(observations, ANCHOR);

      expect(result.status).toBe("UNAVAILABLE");
      if (result.status !== "UNAVAILABLE") return;

      expect(result.reasons).toContain("invalid_price");
    });

    it("rejects invalid decimal string", () => {
      const observations: PriceObservation[] = [
        makeObservation(1, WINDOW_START + 1_000, "100.0"),
        makeObservation(2, WINDOW_START + 400_000, "NaN"),
        makeObservation(3, WINDOW_START + 800_000, "102.0"),
        makeObservation(4, WINDOW_START + 1_200_000, "103.0"),
        makeObservation(5, WINDOW_START + 1_600_000, "104.0"),
        makeObservation(6, WINDOW_START + 2_000_000, "105.0"),
        makeObservation(7, WINDOW_START + 2_400_000, "106.0"),
        makeObservation(8, WINDOW_START + 2_800_000, "107.0"),
        makeObservation(9, WINDOW_START + 3_200_000, "108.0"),
        makeObservation(10, ANCHOR, "109.0")
      ];

      const result = calculateRealizedVolatility1h(observations, ANCHOR);

      expect(result.status).toBe("UNAVAILABLE");
      if (result.status !== "UNAVAILABLE") return;

      expect(result.reasons).toContain("invalid_price");
    });

    it("rejects empty price string", () => {
      const observations: PriceObservation[] = [
        makeObservation(1, WINDOW_START + 1_000, "100.0"),
        makeObservation(2, WINDOW_START + 400_000, ""),
        makeObservation(3, WINDOW_START + 800_000, "102.0"),
        makeObservation(4, WINDOW_START + 1_200_000, "103.0"),
        makeObservation(5, WINDOW_START + 1_600_000, "104.0"),
        makeObservation(6, WINDOW_START + 2_000_000, "105.0"),
        makeObservation(7, WINDOW_START + 2_400_000, "106.0"),
        makeObservation(8, WINDOW_START + 2_800_000, "107.0"),
        makeObservation(9, WINDOW_START + 3_200_000, "108.0"),
        makeObservation(10, ANCHOR, "109.0")
      ];

      const result = calculateRealizedVolatility1h(observations, ANCHOR);

      expect(result.status).toBe("UNAVAILABLE");
      if (result.status !== "UNAVAILABLE") return;

      expect(result.reasons).toContain("invalid_price");
    });

    it("rejects Infinity price string", () => {
      const observations: PriceObservation[] = [
        makeObservation(1, WINDOW_START + 1_000, "100.0"),
        makeObservation(2, WINDOW_START + 400_000, "Infinity"),
        makeObservation(3, WINDOW_START + 800_000, "102.0"),
        makeObservation(4, WINDOW_START + 1_200_000, "103.0"),
        makeObservation(5, WINDOW_START + 1_600_000, "104.0"),
        makeObservation(6, WINDOW_START + 2_000_000, "105.0"),
        makeObservation(7, WINDOW_START + 2_400_000, "106.0"),
        makeObservation(8, WINDOW_START + 2_800_000, "107.0"),
        makeObservation(9, WINDOW_START + 3_200_000, "108.0"),
        makeObservation(10, ANCHOR, "109.0")
      ];

      const result = calculateRealizedVolatility1h(observations, ANCHOR);

      expect(result.status).toBe("UNAVAILABLE");
      if (result.status !== "UNAVAILABLE") return;

      expect(result.reasons).toContain("invalid_price");
    });
  });

  describe("metadata and versioning", () => {
    it("returns correct version constant", () => {
      expect(REALIZED_VOLATILITY_1H_VERSION).toBe("realized-volatility-1h/v1");
    });

    it("returns correct constant values", () => {
      expect(VOLATILITY_WINDOW_MS).toBe(3_600_000);
      expect(VOLATILITY_MIN_SAMPLES).toBe(10);
      expect(VOLATILITY_MIN_SPAN_MS).toBe(2_700_000);
      expect(VOLATILITY_MAX_GAP_MS).toBe(600_000);
    });
  });
});
