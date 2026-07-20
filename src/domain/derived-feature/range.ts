import type { PositionStatePayloadV1 } from "../../contracts/normalized-clmm-observation.js";
import type { FeatureCalculation } from "./assemble.js";
import { parseDecimal, divide, subtract, multiply, roundToSafeInteger } from "./decimal.js";

export const RANGE_CALCULATOR_VERSIONS = {
  range_location: "range-location/v1",
  distance_to_lower: "distance-to-lower/v1",
  distance_to_upper: "distance-to-upper/v1"
} as const;

export type RangeClassification =
  | "below_range_clamped"
  | "in_range"
  | "above_range_clamped"
  | "at_lower_boundary"
  | "at_upper_boundary";

function parsePriceLabel(label: string): number | null {
  const result = parseDecimal(label);
  if (typeof result === "string") {
    return null;
  }
  const num = roundToSafeInteger(result);
  if (typeof num === "string") {
    return null;
  }
  return num;
}

function classifyRangePosition(
  current: number,
  lower: number,
  upper: number,
  rangeState: PositionStatePayloadV1["rangeState"]
): {
  classification: RangeClassification;
  rangeState: PositionStatePayloadV1["rangeState"];
} | null {
  if (current < lower) {
    if (rangeState !== "below-range") {
      return null;
    }
    return { classification: "below_range_clamped", rangeState };
  }
  if (current > upper) {
    if (rangeState !== "above-range") {
      return null;
    }
    return { classification: "above_range_clamped", rangeState };
  }
  if (current === lower && current === upper) {
    return { classification: "at_lower_boundary", rangeState };
  }
  if (current === lower) {
    if (rangeState !== "in-range" && rangeState !== "below-range") {
      return null;
    }
    return { classification: "at_lower_boundary", rangeState };
  }
  if (current === upper) {
    if (rangeState !== "in-range" && rangeState !== "above-range") {
      return null;
    }
    return { classification: "at_upper_boundary", rangeState };
  }
  if (rangeState !== "in-range") {
    return null;
  }
  return { classification: "in_range", rangeState };
}

function makeUnavailable(reasons: string[]): FeatureCalculation {
  return {
    status: "UNAVAILABLE",
    value: null,
    warnings: [],
    reasons,
    metadata: {}
  };
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function calculateRangeLocation(position: PositionStatePayloadV1): FeatureCalculation {
  const lowerPrice = parsePriceLabel(position.lowerPriceLabel);
  const upperPrice = parsePriceLabel(position.upperPriceLabel);
  const currentPrice = position.currentPrice;

  if (lowerPrice === null) {
    return makeUnavailable(["invalid lowerPriceLabel"]);
  }
  if (upperPrice === null) {
    return makeUnavailable(["invalid upperPriceLabel"]);
  }
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    return makeUnavailable(["invalid currentPrice"]);
  }
  if (!Number.isFinite(lowerPrice) || lowerPrice <= 0) {
    return makeUnavailable(["invalid lowerPrice"]);
  }
  if (!Number.isFinite(upperPrice) || upperPrice <= 0) {
    return makeUnavailable(["invalid upperPrice"]);
  }
  if (upperPrice <= lowerPrice) {
    return makeUnavailable(["upperPrice must be greater than lowerPrice"]);
  }

  const classificationResult = classifyRangePosition(
    currentPrice,
    lowerPrice,
    upperPrice,
    position.rangeState
  );
  if (classificationResult === null) {
    return makeUnavailable(["contradictory rangeState"]);
  }

  const { classification, rangeState } = classificationResult;

  const rangeSpan = upperPrice - lowerPrice;
  const currentOffset = currentPrice - lowerPrice;
  const rationalLocation = divide(
    { numerator: BigInt(currentOffset), denominator: 1n },
    { numerator: BigInt(rangeSpan), denominator: 1n }
  );
  if (typeof rationalLocation === "string") {
    return makeUnavailable(["numeric failure in range location calculation"]);
  }

  const scaledLocation = multiply(rationalLocation, { numerator: 1_000_000n, denominator: 1n });
  const roundedLocation = roundToSafeInteger(scaledLocation);
  if (typeof roundedLocation === "string") {
    return makeUnavailable(["numeric overflow in range location"]);
  }

  const clampedLocation = clamp(roundedLocation, 0, 1_000_000);

  return {
    status: "AVAILABLE",
    value: clampedLocation,
    warnings: [],
    reasons: [],
    metadata: {
      classification,
      rangeState
    }
  };
}

export function calculateDistanceToLower(position: PositionStatePayloadV1): FeatureCalculation {
  const lowerPrice = parsePriceLabel(position.lowerPriceLabel);
  const upperPrice = parsePriceLabel(position.upperPriceLabel);
  const currentPrice = position.currentPrice;

  if (lowerPrice === null) {
    return makeUnavailable(["invalid lowerPriceLabel"]);
  }
  if (upperPrice === null) {
    return makeUnavailable(["invalid upperPriceLabel"]);
  }
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    return makeUnavailable(["invalid currentPrice"]);
  }
  if (!Number.isFinite(lowerPrice) || lowerPrice <= 0) {
    return makeUnavailable(["invalid lowerPrice"]);
  }

  const rangeState = position.rangeState;
  const classification =
    currentPrice < lowerPrice
      ? "below_range"
      : currentPrice > upperPrice
        ? "above_range"
        : "in_range";

  const offset = subtract(
    { numerator: BigInt(currentPrice), denominator: 1n },
    { numerator: BigInt(lowerPrice), denominator: 1n }
  );
  const rationalDistance = divide(offset, { numerator: BigInt(currentPrice), denominator: 1n });
  if (typeof rationalDistance === "string") {
    return makeUnavailable(["numeric failure in distance-to-lower calculation"]);
  }

  const scaledDistance = multiply(rationalDistance, { numerator: 10_000n, denominator: 1n });
  const roundedDistance = roundToSafeInteger(scaledDistance);
  if (typeof roundedDistance === "string") {
    return makeUnavailable(["numeric overflow in distance-to-lower"]);
  }

  return {
    status: "AVAILABLE",
    value: roundedDistance,
    warnings: [],
    reasons: [],
    metadata: {
      classification,
      rangeState
    }
  };
}

export function calculateDistanceToUpper(position: PositionStatePayloadV1): FeatureCalculation {
  const upperPrice = parsePriceLabel(position.upperPriceLabel);
  const lowerPrice = parsePriceLabel(position.lowerPriceLabel);
  const currentPrice = position.currentPrice;

  if (upperPrice === null) {
    return makeUnavailable(["invalid upperPriceLabel"]);
  }
  if (lowerPrice === null) {
    return makeUnavailable(["invalid lowerPriceLabel"]);
  }
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    return makeUnavailable(["invalid currentPrice"]);
  }
  if (!Number.isFinite(upperPrice) || upperPrice <= 0) {
    return makeUnavailable(["invalid upperPrice"]);
  }

  const rangeState = position.rangeState;
  const classification =
    currentPrice < lowerPrice
      ? "below_range"
      : currentPrice > upperPrice
        ? "above_range"
        : "in_range";

  const offset = subtract(
    { numerator: BigInt(upperPrice), denominator: 1n },
    { numerator: BigInt(currentPrice), denominator: 1n }
  );
  const rationalDistance = divide(offset, { numerator: BigInt(currentPrice), denominator: 1n });
  if (typeof rationalDistance === "string") {
    return makeUnavailable(["numeric failure in distance-to-upper calculation"]);
  }

  const scaledDistance = multiply(rationalDistance, { numerator: 10_000n, denominator: 1n });
  const roundedDistance = roundToSafeInteger(scaledDistance);
  if (typeof roundedDistance === "string") {
    return makeUnavailable(["numeric overflow in distance-to-upper"]);
  }

  return {
    status: "AVAILABLE",
    value: roundedDistance,
    warnings: [],
    reasons: [],
    metadata: {
      classification,
      rangeState
    }
  };
}
