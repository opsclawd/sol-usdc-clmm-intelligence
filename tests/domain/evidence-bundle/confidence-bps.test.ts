import { describe, expect, it } from "vitest";
import {
  confidenceFractionToBps,
  confidenceBpsToFraction
} from "../../../src/domain/evidence-bundle/confidence-bps.js";

describe("confidenceFractionToBps", () => {
  it("scales a fractional composite score to contract basis points", () => {
    expect(confidenceFractionToBps(0.85)).toBe(8500);
  });

  it("rounds only after multiplying the fraction by 10,000", () => {
    expect(confidenceFractionToBps(0.12345)).toBe(1235);
  });

  it("clamps fractional confidence to the contract endpoints", () => {
    expect(confidenceFractionToBps(-0.1)).toBe(0);
    expect(confidenceFractionToBps(0)).toBe(0);
    expect(confidenceFractionToBps(1)).toBe(10_000);
    expect(confidenceFractionToBps(1.5)).toBe(10_000);
  });
});

describe("confidenceBpsToFraction", () => {
  it("scales basis points to a fractional composite score in [0, 1]", () => {
    expect(confidenceBpsToFraction(8500)).toBe(0.85);
    expect(confidenceBpsToFraction(10_000)).toBe(1);
    expect(confidenceBpsToFraction(0)).toBe(0);
  });

  it("clamps basis points to contract bounds [0, 1]", () => {
    expect(confidenceBpsToFraction(-500)).toBe(0);
    expect(confidenceBpsToFraction(15_000)).toBe(1);
  });
});
