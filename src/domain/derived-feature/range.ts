import type { PositionStatePayloadV1 } from "../../contracts/normalized-clmm-observation.js";
import type { FeatureCalculation } from "./assemble.js";
import type { Rational } from "./decimal.js";
import {
  parseDecimal,
  divide,
  subtract,
  multiply,
  roundToSafeInteger,
  compare
} from "./decimal.js";

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

function parsePriceLabel(label: string): Rational | null {
  const result = parseDecimal(label);
  if (typeof result === "string") {
    return null;
  }
  return result;
}

function classifyRangePosition(
  current: Rational,
  lower: Rational,
  upper: Rational,
  rangeState: PositionStatePayloadV1["rangeState"]
): {
  classification: RangeClassification;
  rangeState: PositionStatePayloadV1["rangeState"];
} | null {
  const cmpLower = compare(current, lower);
  const cmpUpper = compare(current, upper);

  if (cmpLower < 0) {
    if (rangeState !== "below-range") {
      return null;
    }
    return { classification: "below_range_clamped", rangeState };
  }
  if (cmpUpper > 0) {
    if (rangeState !== "above-range") {
      return null;
    }
    return { classification: "above_range_clamped", rangeState };
  }
  if (cmpLower === 0 && cmpUpper === 0) {
    return { classification: "at_lower_boundary", rangeState };
  }
  if (cmpLower === 0) {
    if (rangeState !== "in-range" && rangeState !== "below-range") {
      return null;
    }
    return { classification: "at_lower_boundary", rangeState };
  }
  if (cmpUpper === 0) {
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
  const lowerPriceRational = parsePriceLabel(position.lowerPriceLabel);
  const upperPriceRational = parsePriceLabel(position.upperPriceLabel);
  const currentPriceRational = parseDecimal(position.currentPriceLabel);

  if (lowerPriceRational === null) {
    return makeUnavailable(["invalid lowerPriceLabel"]);
  }
  if (upperPriceRational === null) {
    return makeUnavailable(["invalid upperPriceLabel"]);
  }
  if (typeof currentPriceRational === "string") {
    return makeUnavailable(["invalid currentPriceLabel"]);
  }

  if (compare(lowerPriceRational, { numerator: 0n, denominator: 1n }) <= 0) {
    return makeUnavailable(["invalid lowerPrice"]);
  }
  if (compare(upperPriceRational, { numerator: 0n, denominator: 1n }) <= 0) {
    return makeUnavailable(["invalid upperPrice"]);
  }
  if (compare(upperPriceRational, lowerPriceRational) <= 0) {
    return makeUnavailable(["upperPrice must be greater than lowerPrice"]);
  }
  if (compare(currentPriceRational, { numerator: 0n, denominator: 1n }) <= 0) {
    return makeUnavailable(["invalid currentPrice"]);
  }

  const classificationResult = classifyRangePosition(
    currentPriceRational,
    lowerPriceRational,
    upperPriceRational,
    position.rangeState
  );
  if (classificationResult === null) {
    return makeUnavailable(["contradictory rangeState"]);
  }

  const { classification, rangeState } = classificationResult;

  const rangeSpan = subtract(upperPriceRational, lowerPriceRational);
  const currentOffset = subtract(currentPriceRational, lowerPriceRational);
  const rationalLocation = divide(currentOffset, rangeSpan);
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
  const currentPrice = parseDecimal(position.currentPriceLabel);

  if (lowerPrice === null) {
    return makeUnavailable(["invalid lowerPriceLabel"]);
  }
  if (upperPrice === null) {
    return makeUnavailable(["invalid upperPriceLabel"]);
  }
  if (typeof currentPrice === "string") {
    return makeUnavailable(["invalid currentPriceLabel"]);
  }

  if (compare(lowerPrice, { numerator: 0n, denominator: 1n }) <= 0) {
    return makeUnavailable(["invalid lowerPrice"]);
  }
  if (compare(upperPrice, { numerator: 0n, denominator: 1n }) <= 0) {
    return makeUnavailable(["invalid upperPrice"]);
  }
  if (compare(upperPrice, lowerPrice) <= 0) {
    return makeUnavailable(["upperPrice must be greater than lowerPrice"]);
  }
  if (compare(currentPrice, { numerator: 0n, denominator: 1n }) <= 0) {
    return makeUnavailable(["invalid currentPrice"]);
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

  const offset = subtract(currentPrice, lowerPrice);
  const rationalDistance = divide(offset, currentPrice);
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
  const lowerPrice = parsePriceLabel(position.lowerPriceLabel);
  const upperPrice = parsePriceLabel(position.upperPriceLabel);
  const currentPrice = parseDecimal(position.currentPriceLabel);

  if (lowerPrice === null) {
    return makeUnavailable(["invalid lowerPriceLabel"]);
  }
  if (upperPrice === null) {
    return makeUnavailable(["invalid upperPriceLabel"]);
  }
  if (typeof currentPrice === "string") {
    return makeUnavailable(["invalid currentPriceLabel"]);
  }

  if (compare(lowerPrice, { numerator: 0n, denominator: 1n }) <= 0) {
    return makeUnavailable(["invalid lowerPrice"]);
  }
  if (compare(upperPrice, { numerator: 0n, denominator: 1n }) <= 0) {
    return makeUnavailable(["invalid upperPrice"]);
  }
  if (compare(upperPrice, lowerPrice) <= 0) {
    return makeUnavailable(["upperPrice must be greater than lowerPrice"]);
  }
  if (compare(currentPrice, { numerator: 0n, denominator: 1n }) <= 0) {
    return makeUnavailable(["invalid currentPrice"]);
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

  const offset = subtract(upperPrice, currentPrice);
  const rationalDistance = divide(offset, currentPrice);
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
