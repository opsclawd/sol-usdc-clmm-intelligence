import { describe, it, expect } from "vitest";
import type { PositionStatePayloadV1 } from "../../../src/contracts/normalized-clmm-observation.js";
import {
  calculateRangeLocation,
  calculateDistanceToLower,
  calculateDistanceToUpper,
  RANGE_CALCULATOR_VERSIONS,
  type RangeClassification
} from "../../../src/domain/derived-feature/range.js";

function makePositionState(overrides: Partial<PositionStatePayloadV1>): PositionStatePayloadV1 {
  return {
    kind: "position_state",
    schemaVersion: 1,
    pair: "SOL/USDC",
    positionId: "pos123",
    poolId: "pool456",
    observedAtUnixMs: 1000000000000,
    rangeState: "in-range",
    lowerTick: 1000,
    upperTick: 2000,
    currentTick: 1500,
    lowerPriceLabel: "100",
    upperPriceLabel: "200",
    currentPrice: 150,
    currentPriceLabel: "150",
    rangeDistance: {
      belowLowerTickPercent: 10,
      aboveUpperTickPercent: 20,
      belowLowerPricePercent: 10,
      aboveUpperPricePercent: 20
    },
    feeRateLabel: "0.03%",
    positionLiquidity: "1000000",
    poolLiquidity: "10000000",
    hasActionableTrigger: false,
    triggerId: null,
    breachDirection: null,
    unclaimedFeesUsd: null,
    unclaimedRewardsUsd: null,
    ...overrides
  };
}

describe("range calculators", () => {
  describe("RANGE_CALCULATOR_VERSIONS", () => {
    it("exports correct version strings", () => {
      expect(RANGE_CALCULATOR_VERSIONS.range_location).toBe("range-location/v1");
      expect(RANGE_CALCULATOR_VERSIONS.distance_to_lower).toBe("distance-to-lower/v1");
      expect(RANGE_CALCULATOR_VERSIONS.distance_to_upper).toBe("distance-to-upper/v1");
    });
  });

  describe("classifies and clamps range location without hiding market state", () => {
    it("returns 0 PPM with below_range_clamped when current is below lower", () => {
      const pos = makePositionState({
        currentPrice: 50,
        currentPriceLabel: "50",
        lowerPriceLabel: "100",
        upperPriceLabel: "200",
        rangeState: "below-range"
      });
      const result = calculateRangeLocation(pos);
      expect(result.status).toBe("AVAILABLE");
      expect(result.value).toBe(0);
      expect(result.metadata.classification).toBe("below_range_clamped");
      expect(result.metadata.rangeState).toBe("below-range");
    });

    it("returns 1_000_000 PPM with above_range_clamped when current is above upper", () => {
      const pos = makePositionState({
        currentPrice: 250,
        currentPriceLabel: "250",
        lowerPriceLabel: "100",
        upperPriceLabel: "200",
        rangeState: "above-range"
      });
      const result = calculateRangeLocation(pos);
      expect(result.status).toBe("AVAILABLE");
      expect(result.value).toBe(1_000_000);
      expect(result.metadata.classification).toBe("above_range_clamped");
      expect(result.metadata.rangeState).toBe("above-range");
    });

    it("returns exact midpoint PPM with in_range when current is inside range", () => {
      const pos = makePositionState({
        currentPrice: 150,
        currentPriceLabel: "150",
        lowerPriceLabel: "100",
        upperPriceLabel: "200",
        rangeState: "in-range"
      });
      const result = calculateRangeLocation(pos);
      expect(result.status).toBe("AVAILABLE");
      expect(result.value).toBe(500_000);
      expect(result.metadata.classification).toBe("in_range");
      expect(result.metadata.rangeState).toBe("in-range");
    });

    it("returns 0 PPM with at_lower_boundary when current equals lower", () => {
      const pos = makePositionState({
        currentPrice: 100,
        currentPriceLabel: "100",
        lowerPriceLabel: "100",
        upperPriceLabel: "200",
        rangeState: "in-range"
      });
      const result = calculateRangeLocation(pos);
      expect(result.status).toBe("AVAILABLE");
      expect(result.value).toBe(0);
      expect(result.metadata.classification).toBe("at_lower_boundary");
    });

    it("returns 1_000_000 PPM with at_upper_boundary when current equals upper", () => {
      const pos = makePositionState({
        currentPrice: 200,
        currentPriceLabel: "200",
        lowerPriceLabel: "100",
        upperPriceLabel: "200",
        rangeState: "in-range"
      });
      const result = calculateRangeLocation(pos);
      expect(result.status).toBe("AVAILABLE");
      expect(result.value).toBe(1_000_000);
      expect(result.metadata.classification).toBe("at_upper_boundary");
    });
  });

  describe("preserves signed distance outside the position range", () => {
    it("returns negative distance-to-lower when current is below lower", () => {
      const pos = makePositionState({
        currentPrice: 50,
        currentPriceLabel: "50",
        lowerPriceLabel: "100",
        upperPriceLabel: "200",
        rangeState: "below-range"
      });
      const result = calculateDistanceToLower(pos);
      expect(result.status).toBe("AVAILABLE");
      expect(result.value).toBeLessThan(0);
      expect(result.metadata.classification).toBe("below_range_clamped");
    });

    it("returns negative distance-to-upper when current is above upper", () => {
      const pos = makePositionState({
        currentPrice: 250,
        currentPriceLabel: "250",
        lowerPriceLabel: "100",
        upperPriceLabel: "200",
        rangeState: "above-range"
      });
      const result = calculateDistanceToUpper(pos);
      expect(result.status).toBe("AVAILABLE");
      expect(result.value).toBeLessThan(0);
      expect(result.metadata.classification).toBe("above_range_clamped");
    });

    it("returns positive distance-to-lower when current is above lower (in-range)", () => {
      const pos = makePositionState({
        currentPrice: 150,
        currentPriceLabel: "150",
        lowerPriceLabel: "100",
        upperPriceLabel: "200",
        rangeState: "in-range"
      });
      const result = calculateDistanceToLower(pos);
      expect(result.status).toBe("AVAILABLE");
      expect(result.value).toBeGreaterThan(0);
    });

    it("returns positive distance-to-upper when current is below upper (in-range)", () => {
      const pos = makePositionState({
        currentPrice: 150,
        currentPriceLabel: "150",
        lowerPriceLabel: "100",
        upperPriceLabel: "200",
        rangeState: "in-range"
      });
      const result = calculateDistanceToUpper(pos);
      expect(result.status).toBe("AVAILABLE");
      expect(result.value).toBeGreaterThan(0);
    });

    it("distance-to-lower is zero when current equals lower", () => {
      const pos = makePositionState({
        currentPrice: 100,
        currentPriceLabel: "100",
        lowerPriceLabel: "100",
        upperPriceLabel: "200",
        rangeState: "in-range"
      });
      const result = calculateDistanceToLower(pos);
      expect(result.status).toBe("AVAILABLE");
      expect(result.value).toBe(0);
    });

    it("distance-to-upper is zero when current equals upper", () => {
      const pos = makePositionState({
        currentPrice: 200,
        currentPriceLabel: "200",
        lowerPriceLabel: "100",
        upperPriceLabel: "200",
        rangeState: "in-range"
      });
      const result = calculateDistanceToUpper(pos);
      expect(result.status).toBe("AVAILABLE");
      expect(result.value).toBe(0);
    });
  });

  describe("rejects invalid prices ranges and contradictory range state", () => {
    it("returns UNAVAILABLE when currentPrice is zero", () => {
      const pos = makePositionState({
        currentPrice: 0,
        currentPriceLabel: "0",
        lowerPriceLabel: "100",
        upperPriceLabel: "200"
      });
      const result = calculateRangeLocation(pos);
      expect(result.status).toBe("UNAVAILABLE");
      expect(result.value).toBeNull();
      expect(result.reasons.length).toBeGreaterThan(0);
    });

    it("returns UNAVAILABLE when currentPrice is negative", () => {
      const pos = makePositionState({
        currentPrice: -50,
        currentPriceLabel: "-50",
        lowerPriceLabel: "100",
        upperPriceLabel: "200"
      });
      const result = calculateRangeLocation(pos);
      expect(result.status).toBe("UNAVAILABLE");
      expect(result.value).toBeNull();
    });

    it("returns UNAVAILABLE when lowerPrice is zero", () => {
      const pos = makePositionState({
        currentPrice: 100,
        currentPriceLabel: "100",
        lowerPriceLabel: "0",
        upperPriceLabel: "200"
      });
      const result = calculateRangeLocation(pos);
      expect(result.status).toBe("UNAVAILABLE");
      expect(result.value).toBeNull();
    });

    it("returns UNAVAILABLE when lowerPrice is negative", () => {
      const pos = makePositionState({
        currentPrice: 100,
        currentPriceLabel: "100",
        lowerPriceLabel: "-100",
        upperPriceLabel: "200"
      });
      const result = calculateRangeLocation(pos);
      expect(result.status).toBe("UNAVAILABLE");
      expect(result.value).toBeNull();
    });

    it("returns UNAVAILABLE when upperPrice equals lowerPrice (zero-width range)", () => {
      const pos = makePositionState({
        currentPrice: 100,
        currentPriceLabel: "100",
        lowerPriceLabel: "100",
        upperPriceLabel: "100"
      });
      const result = calculateRangeLocation(pos);
      expect(result.status).toBe("UNAVAILABLE");
      expect(result.value).toBeNull();
    });

    it("returns UNAVAILABLE when upperPrice is less than lowerPrice (inverted range)", () => {
      const pos = makePositionState({
        currentPrice: 150,
        currentPriceLabel: "150",
        lowerPriceLabel: "200",
        upperPriceLabel: "100"
      });
      const result = calculateRangeLocation(pos);
      expect(result.status).toBe("UNAVAILABLE");
      expect(result.value).toBeNull();
    });

    it("returns UNAVAILABLE when lowerPriceLabel is malformed", () => {
      const pos = makePositionState({
        currentPrice: 100,
        currentPriceLabel: "100",
        lowerPriceLabel: "not-a-number",
        upperPriceLabel: "200"
      });
      const result = calculateRangeLocation(pos);
      expect(result.status).toBe("UNAVAILABLE");
      expect(result.value).toBeNull();
    });

    it("returns UNAVAILABLE when upperPriceLabel is malformed", () => {
      const pos = makePositionState({
        currentPrice: 100,
        currentPriceLabel: "100",
        lowerPriceLabel: "100",
        upperPriceLabel: "also-not-a-number"
      });
      const result = calculateRangeLocation(pos);
      expect(result.status).toBe("UNAVAILABLE");
      expect(result.value).toBeNull();
    });

    it("returns UNAVAILABLE when rangeState disagrees with price position (below-range but price above upper)", () => {
      const pos = makePositionState({
        currentPrice: 300,
        currentPriceLabel: "300",
        lowerPriceLabel: "100",
        upperPriceLabel: "200",
        rangeState: "below-range"
      });
      const result = calculateRangeLocation(pos);
      expect(result.status).toBe("UNAVAILABLE");
      expect(result.value).toBeNull();
      expect(
        result.reasons.some((r) => r.includes("contradictory") || r.includes("disagree"))
      ).toBe(true);
    });

    it("returns UNAVAILABLE when rangeState disagrees with price position (above-range but price below lower)", () => {
      const pos = makePositionState({
        currentPrice: 50,
        currentPriceLabel: "50",
        lowerPriceLabel: "100",
        upperPriceLabel: "200",
        rangeState: "above-range"
      });
      const result = calculateRangeLocation(pos);
      expect(result.status).toBe("UNAVAILABLE");
      expect(result.value).toBeNull();
    });

    it("returns UNAVAILABLE when currentPriceLabel is malformed", () => {
      const pos = makePositionState({
        currentPrice: 100,
        currentPriceLabel: "not-a-number",
        lowerPriceLabel: "100",
        upperPriceLabel: "200"
      });
      const result = calculateRangeLocation(pos);
      expect(result.status).toBe("UNAVAILABLE");
      expect(result.value).toBeNull();
    });
  });

  describe("preserves decimal precision with fractional prices", () => {
    it("range_location: correctly distinguishes narrow range with fractional prices", () => {
      const pos = makePositionState({
        currentPrice: 150.2,
        currentPriceLabel: "150.2",
        lowerPriceLabel: "150.123",
        upperPriceLabel: "150.456",
        rangeState: "in-range"
      });
      const result = calculateRangeLocation(pos);
      expect(result.status).toBe("AVAILABLE");
      expect(result.value).toBeGreaterThan(0);
      expect(result.value).toBeLessThan(1_000_000);
    });

    it("range_location: correctly classifies when currentPrice is below narrow fractional range", () => {
      const pos = makePositionState({
        currentPrice: 150.0,
        currentPriceLabel: "150.0",
        lowerPriceLabel: "150.123",
        upperPriceLabel: "150.456",
        rangeState: "below-range"
      });
      const result = calculateRangeLocation(pos);
      expect(result.status).toBe("AVAILABLE");
      expect(result.value).toBe(0);
      expect(result.metadata.classification).toBe("below_range_clamped");
    });

    it("range_location: correctly classifies when currentPrice is above narrow fractional range", () => {
      const pos = makePositionState({
        currentPrice: 150.5,
        currentPriceLabel: "150.5",
        lowerPriceLabel: "150.123",
        upperPriceLabel: "150.456",
        rangeState: "above-range"
      });
      const result = calculateRangeLocation(pos);
      expect(result.status).toBe("AVAILABLE");
      expect(result.value).toBe(1_000_000);
      expect(result.metadata.classification).toBe("above_range_clamped");
    });

    it("distance_to_lower: preserves precision with fractional prices", () => {
      const pos = makePositionState({
        currentPrice: 150.2,
        currentPriceLabel: "150.2",
        lowerPriceLabel: "150.123",
        upperPriceLabel: "150.456",
        rangeState: "in-range"
      });
      const result = calculateDistanceToLower(pos);
      expect(result.status).toBe("AVAILABLE");
      expect(result.value).toBeGreaterThan(0);
    });

    it("distance_to_upper: preserves precision with fractional prices", () => {
      const pos = makePositionState({
        currentPrice: 150.2,
        currentPriceLabel: "150.2",
        lowerPriceLabel: "150.123",
        upperPriceLabel: "150.456",
        rangeState: "in-range"
      });
      const result = calculateDistanceToUpper(pos);
      expect(result.status).toBe("AVAILABLE");
      expect(result.value).toBeGreaterThan(0);
    });

    it("range_location: correctly rejects inverted range with fractional prices", () => {
      const pos = makePositionState({
        currentPrice: 150.2,
        currentPriceLabel: "150.2",
        lowerPriceLabel: "150.456",
        upperPriceLabel: "150.123",
        rangeState: "in-range"
      });
      const result = calculateRangeLocation(pos);
      expect(result.status).toBe("UNAVAILABLE");
      expect(result.value).toBeNull();
    });

    it("range_location: correctly rejects zero-width fractional range", () => {
      const pos = makePositionState({
        currentPrice: 150.2,
        currentPriceLabel: "150.2",
        lowerPriceLabel: "150.2",
        upperPriceLabel: "150.2",
        rangeState: "in-range"
      });
      const result = calculateRangeLocation(pos);
      expect(result.status).toBe("UNAVAILABLE");
      expect(result.value).toBeNull();
    });

    it("range_location: handles sub-integer currentPrice correctly", () => {
      const pos = makePositionState({
        currentPrice: 0.5,
        currentPriceLabel: "0.5",
        lowerPriceLabel: "0.1",
        upperPriceLabel: "0.9",
        rangeState: "in-range"
      });
      const result = calculateRangeLocation(pos);
      expect(result.status).toBe("AVAILABLE");
      expect(result.value).toBe(500_000);
      expect(result.metadata.classification).toBe("in_range");
    });
  });

  describe("applies nearest integer ties away from zero after the full formula", () => {
    it("range_location: exact 0.5 position becomes 500000 PPM", () => {
      const pos = makePositionState({
        currentPrice: 150,
        currentPriceLabel: "150",
        lowerPriceLabel: "100",
        upperPriceLabel: "200",
        rangeState: "in-range"
      });
      const result = calculateRangeLocation(pos);
      expect(result.status).toBe("AVAILABLE");
      expect(result.value).toBe(500_000);
    });

    it("distance_to_lower: exact 0.3333... becomes 3333 BPS (1/3 of 10000)", () => {
      const pos = makePositionState({
        currentPrice: 150,
        currentPriceLabel: "150",
        lowerPriceLabel: "100",
        upperPriceLabel: "200",
        rangeState: "in-range"
      });
      const result = calculateDistanceToLower(pos);
      expect(result.status).toBe("AVAILABLE");
      const diff = 150 - 100;
      const expectedBps = (diff / 150) * 10000;
      expect(result.value).toBe(Math.round(expectedBps));
    });

    it("distance_to_upper: exact 0.25 becomes 2500 BPS (50/200 * 10000)", () => {
      const pos = makePositionState({
        currentPrice: 150,
        currentPriceLabel: "150",
        lowerPriceLabel: "100",
        upperPriceLabel: "200",
        rangeState: "in-range"
      });
      const result = calculateDistanceToUpper(pos);
      expect(result.status).toBe("AVAILABLE");
      const diff = 200 - 150;
      const expectedBps = (diff / 150) * 10000;
      expect(result.value).toBe(Math.round(expectedBps));
    });

    it("handles fractional BPS that rounds up (0.5 BPS rounds to 1)", () => {
      const pos = makePositionState({
        currentPrice: 101,
        currentPriceLabel: "101",
        lowerPriceLabel: "100",
        upperPriceLabel: "200",
        rangeState: "in-range"
      });
      const result = calculateDistanceToLower(pos);
      expect(result.status).toBe("AVAILABLE");
      const diff = 101 - 100;
      const expectedBps = (diff / 101) * 10000;
      const rounded = Math.round(expectedBps);
      expect(result.value).toBe(rounded);
    });

    it("handles negative fractional BPS that rounds away from zero", () => {
      const pos = makePositionState({
        currentPrice: 99,
        currentPriceLabel: "99",
        lowerPriceLabel: "100",
        upperPriceLabel: "200",
        rangeState: "below-range"
      });
      const result = calculateDistanceToLower(pos);
      expect(result.status).toBe("AVAILABLE");
      const diff = 99 - 100;
      const expectedBps = (diff / 99) * 10000;
      const rounded = Math.round(expectedBps);
      expect(result.value).toBe(rounded);
      expect(rounded).toBeLessThan(0);
    });
  });

  describe("golden fixtures", () => {
    it("golden fixture 1: below-range position", () => {
      const pos = makePositionState({
        currentPrice: 50,
        currentPriceLabel: "50",
        lowerPriceLabel: "100",
        upperPriceLabel: "200",
        rangeState: "below-range"
      });

      const locationResult = calculateRangeLocation(pos);
      expect(locationResult.status).toBe("AVAILABLE");
      expect(locationResult.value).toBe(0);
      expect(locationResult.metadata.classification).toBe("below_range_clamped");

      const lowerResult = calculateDistanceToLower(pos);
      expect(lowerResult.status).toBe("AVAILABLE");
      expect(lowerResult.value).toBeLessThan(0);
      expect(lowerResult.metadata.classification).toBe("below_range_clamped");

      const upperResult = calculateDistanceToUpper(pos);
      expect(upperResult.status).toBe("AVAILABLE");
      expect(upperResult.value).toBeGreaterThan(0);
      expect(upperResult.metadata.classification).toBe("below_range_clamped");
    });

    it("golden fixture 2: in-range position at midpoint", () => {
      const pos = makePositionState({
        currentPrice: 150,
        currentPriceLabel: "150",
        lowerPriceLabel: "100",
        upperPriceLabel: "200",
        rangeState: "in-range"
      });

      const locationResult = calculateRangeLocation(pos);
      expect(locationResult.status).toBe("AVAILABLE");
      expect(locationResult.value).toBe(500_000);
      expect(locationResult.metadata.classification).toBe("in_range");

      const lowerResult = calculateDistanceToLower(pos);
      expect(lowerResult.status).toBe("AVAILABLE");
      expect(lowerResult.value).toBeGreaterThan(0);

      const upperResult = calculateDistanceToUpper(pos);
      expect(upperResult.status).toBe("AVAILABLE");
      expect(upperResult.value).toBeGreaterThan(0);
    });

    it("golden fixture 3: above-range position", () => {
      const pos = makePositionState({
        currentPrice: 250,
        currentPriceLabel: "250",
        lowerPriceLabel: "100",
        upperPriceLabel: "200",
        rangeState: "above-range"
      });

      const locationResult = calculateRangeLocation(pos);
      expect(locationResult.status).toBe("AVAILABLE");
      expect(locationResult.value).toBe(1_000_000);
      expect(locationResult.metadata.classification).toBe("above_range_clamped");

      const lowerResult = calculateDistanceToLower(pos);
      expect(lowerResult.status).toBe("AVAILABLE");
      expect(lowerResult.value).toBeGreaterThan(0);
      expect(lowerResult.metadata.classification).toBe("above_range_clamped");

      const upperResult = calculateDistanceToUpper(pos);
      expect(upperResult.status).toBe("AVAILABLE");
      expect(upperResult.value).toBeLessThan(0);
      expect(upperResult.metadata.classification).toBe("above_range_clamped");
    });
  });

  describe("classification is exactly one of the valid values", () => {
    const validClassifications: RangeClassification[] = [
      "below_range_clamped",
      "in_range",
      "above_range_clamped",
      "at_lower_boundary",
      "at_upper_boundary"
    ];

    it("below-range state yields below_range_clamped", () => {
      const pos = makePositionState({
        currentPrice: 50,
        currentPriceLabel: "50",
        lowerPriceLabel: "100",
        upperPriceLabel: "200",
        rangeState: "below-range"
      });
      const result = calculateRangeLocation(pos);
      expect(
        validClassifications.includes(result.metadata.classification as RangeClassification)
      ).toBe(true);
    });

    it("above-range state yields above_range_clamped", () => {
      const pos = makePositionState({
        currentPrice: 250,
        currentPriceLabel: "250",
        lowerPriceLabel: "100",
        upperPriceLabel: "200",
        rangeState: "above-range"
      });
      const result = calculateRangeLocation(pos);
      expect(
        validClassifications.includes(result.metadata.classification as RangeClassification)
      ).toBe(true);
    });

    it("in-range state yields in_range or boundary classification", () => {
      const pos = makePositionState({
        currentPrice: 150,
        lowerPriceLabel: "100",
        upperPriceLabel: "200",
        rangeState: "in-range"
      });
      const result = calculateRangeLocation(pos);
      expect(
        validClassifications.includes(result.metadata.classification as RangeClassification)
      ).toBe(true);
    });
  });

  describe("boundary clamping remains AVAILABLE when all inputs are sound", () => {
    it("at exact lower boundary is AVAILABLE", () => {
      const pos = makePositionState({
        currentPrice: 100,
        currentPriceLabel: "100",
        lowerPriceLabel: "100",
        upperPriceLabel: "200",
        rangeState: "in-range"
      });
      const result = calculateRangeLocation(pos);
      expect(result.status).toBe("AVAILABLE");
    });

    it("at exact upper boundary is AVAILABLE", () => {
      const pos = makePositionState({
        currentPrice: 200,
        currentPriceLabel: "200",
        lowerPriceLabel: "100",
        upperPriceLabel: "200",
        rangeState: "in-range"
      });
      const result = calculateRangeLocation(pos);
      expect(result.status).toBe("AVAILABLE");
    });

    it("far below range is AVAILABLE", () => {
      const pos = makePositionState({
        currentPrice: 1,
        currentPriceLabel: "1",
        lowerPriceLabel: "100",
        upperPriceLabel: "200",
        rangeState: "below-range"
      });
      const result = calculateRangeLocation(pos);
      expect(result.status).toBe("AVAILABLE");
    });

    it("far above range is AVAILABLE", () => {
      const pos = makePositionState({
        currentPrice: 10000,
        currentPriceLabel: "10000",
        lowerPriceLabel: "100",
        upperPriceLabel: "200",
        rangeState: "above-range"
      });
      const result = calculateRangeLocation(pos);
      expect(result.status).toBe("AVAILABLE");
    });
  });
});
