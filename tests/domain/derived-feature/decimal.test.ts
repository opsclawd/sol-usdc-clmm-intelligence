import { describe, it, expect } from "vitest";
import {
  parseDecimal,
  subtract,
  multiply,
  divide,
  compare,
  roundToSafeInteger,
  type Rational
} from "../../../src/domain/derived-feature/decimal.js";

describe("decimal arithmetic", () => {
  describe("parses plain signed decimals without binary floating-point conversion", () => {
    it("parses integer form", () => {
      const result = parseDecimal("42");
      expect(result.numerator).toBe(42n);
      expect(result.denominator).toBe(1n);
    });

    it("parses negative integer", () => {
      const result = parseDecimal("-42");
      expect(result.numerator).toBe(-42n);
      expect(result.denominator).toBe(1n);
    });

    it("parses fractional form", () => {
      const result = parseDecimal("3.14");
      expect(result.numerator).toBe(314n);
      expect(result.denominator).toBe(100n);
    });

    it("parses negative fractional", () => {
      const result = parseDecimal("-3.14");
      expect(result.numerator).toBe(-314n);
      expect(result.denominator).toBe(100n);
    });

    it("normalizes trailing zeroes", () => {
      const result = parseDecimal("2.5000");
      expect(result.numerator).toBe(25n);
      expect(result.denominator).toBe(10n);
    });

    it("parses zero", () => {
      const result = parseDecimal("0");
      expect(result.numerator).toBe(0n);
      expect(result.denominator).toBe(1n);
    });

    it("parses leading zeroes", () => {
      const result = parseDecimal("007");
      expect(result.numerator).toBe(7n);
      expect(result.denominator).toBe(1n);
    });

    it("parses 0.1 exactly", () => {
      const result = parseDecimal("0.1");
      expect(result.numerator).toBe(1n);
      expect(result.denominator).toBe(10n);
    });
  });

  describe("rejects empty exponent and non-finite decimal syntax", () => {
    it("rejects empty string", () => {
      const result = parseDecimal("");
      expect(result).toBe("invalid_decimal");
    });

    it("rejects whitespace only", () => {
      const result = parseDecimal("   ");
      expect(result).toBe("invalid_decimal");
    });

    it("rejects exponent notation", () => {
      const result = parseDecimal("1e10");
      expect(result).toBe("invalid_decimal");
    });

    it("rejects negative exponent notation", () => {
      const result = parseDecimal("1.5e-3");
      expect(result).toBe("invalid_decimal");
    });

    it("rejects NaN", () => {
      const result = parseDecimal("NaN");
      expect(result).toBe("invalid_decimal");
    });

    it("rejects Infinity", () => {
      const result = parseDecimal("Infinity");
      expect(result).toBe("invalid_decimal");
    });

    it("rejects negative Infinity", () => {
      const result = parseDecimal("-Infinity");
      expect(result).toBe("invalid_decimal");
    });

    it("rejects just a sign", () => {
      const result = parseDecimal("-");
      expect(result).toBe("invalid_decimal");
    });

    it("rejects decimal with no digits", () => {
      const result = parseDecimal(".5");
      expect(result).toBe("invalid_decimal");
    });

    it("rejects decimal ending with dot", () => {
      const result = parseDecimal("5.");
      expect(result).toBe("invalid_decimal");
    });
  });

  describe("rounds rational ties away from zero", () => {
    it("1/2 becomes 1", () => {
      const rational: Rational = { numerator: 1n, denominator: 2n };
      expect(roundToSafeInteger(rational)).toBe(1);
    });

    it("-1/2 becomes -1", () => {
      const rational: Rational = { numerator: -1n, denominator: 2n };
      expect(roundToSafeInteger(rational)).toBe(-1);
    });

    it("3/2 becomes 2", () => {
      const rational: Rational = { numerator: 3n, denominator: 2n };
      expect(roundToSafeInteger(rational)).toBe(2);
    });

    it("-3/2 becomes -2", () => {
      const rational: Rational = { numerator: -3n, denominator: 2n };
      expect(roundToSafeInteger(rational)).toBe(-2);
    });

    it("1/4 rounds to 0 (not a tie)", () => {
      const rational: Rational = { numerator: 1n, denominator: 4n };
      expect(roundToSafeInteger(rational)).toBe(0);
    });

    it("3/4 rounds to 1 (not a tie)", () => {
      const rational: Rational = { numerator: 3n, denominator: 4n };
      expect(roundToSafeInteger(rational)).toBe(1);
    });

    it("-1/4 rounds to 0 (not a tie)", () => {
      const rational: Rational = { numerator: -1n, denominator: 4n };
      expect(roundToSafeInteger(rational)).toBe(0);
    });

    it("-3/4 rounds to -1 (not a tie)", () => {
      const rational: Rational = { numerator: -3n, denominator: 4n };
      expect(roundToSafeInteger(rational)).toBe(-1);
    });
  });

  describe("rejects zero divisors and unsafe integer outputs", () => {
    it("division by zero returns division_by_zero", () => {
      const zero: Rational = { numerator: 0n, denominator: 1n };
      const one: Rational = { numerator: 1n, denominator: 1n };
      const result = divide(one, zero);
      expect(result).toBe("division_by_zero");
    });

    it("result above MAX_SAFE_INTEGER returns numeric_overflow", () => {
      const big: Rational = { numerator: BigInt(Number.MAX_SAFE_INTEGER) + 1n, denominator: 1n };
      const result = roundToSafeInteger(big);
      expect(result).toBe("numeric_overflow");
    });

    it("result below MIN_SAFE_INTEGER returns numeric_overflow", () => {
      const small: Rational = { numerator: BigInt(Number.MIN_SAFE_INTEGER) - 1n, denominator: 1n };
      const result = roundToSafeInteger(small);
      expect(result).toBe("numeric_overflow");
    });

    it("MAX_SAFE_INTEGER is valid", () => {
      const max: Rational = { numerator: BigInt(Number.MAX_SAFE_INTEGER), denominator: 1n };
      expect(roundToSafeInteger(max)).toBe(Number.MAX_SAFE_INTEGER);
    });

    it("MIN_SAFE_INTEGER is valid", () => {
      const min: Rational = { numerator: BigInt(Number.MIN_SAFE_INTEGER), denominator: 1n };
      expect(roundToSafeInteger(min)).toBe(Number.MIN_SAFE_INTEGER);
    });
  });

  describe("rounds only after the complete scaled formula", () => {
    it("BPS case: 1.005 * 10000 = 10050 (not 10049)", () => {
      const value = parseDecimal("1.005");
      expect(value).toEqual({ numerator: 1005n, denominator: 1000n });

      const scaled = multiply(value, { numerator: 10000n, denominator: 1n });
      expect(scaled).toEqual({ numerator: 10050000n, denominator: 1000n });

      const result = roundToSafeInteger(scaled);
      expect(result).toBe(10050);
    });

    it("PPM case: 1.0005 * 1000000 = 1000500 (not 1000499)", () => {
      const value = parseDecimal("1.0005");
      expect(value).toEqual({ numerator: 10005n, denominator: 10000n });

      const scaled = multiply(value, { numerator: 1000000n, denominator: 1n });
      expect(scaled).toEqual({ numerator: 10005000000n, denominator: 10000n });

      const result = roundToSafeInteger(scaled);
      expect(result).toBe(1000500);
    });

    it("subtraction then multiply: (1.006 - 1.005) * 10000 = 10", () => {
      const a = parseDecimal("1.006");
      const b = parseDecimal("1.005");
      const diff = subtract(a, b);
      expect(diff).toEqual({ numerator: 1n, denominator: 1000n });

      const scaled = multiply(diff, { numerator: 10000n, denominator: 1n });
      expect(scaled).toEqual({ numerator: 10000n, denominator: 1000n });

      const result = roundToSafeInteger(scaled);
      expect(result).toBe(10);
    });

    it("near half-way boundary: 0.005 * 10000 = 50 (exact)", () => {
      const value = parseDecimal("0.005");
      const scaled = multiply(value, { numerator: 10000n, denominator: 1n });
      const result = roundToSafeInteger(scaled);
      expect(result).toBe(50);
    });

    it("near half-way boundary negative: -0.005 * 10000 = -50", () => {
      const value = parseDecimal("-0.005");
      const scaled = multiply(value, { numerator: 10000n, denominator: 1n });
      const result = roundToSafeInteger(scaled);
      expect(result).toBe(-50);
    });
  });

  describe("arithmetic operations", () => {
    it("subtracts two rationals", () => {
      const a: Rational = { numerator: 3n, denominator: 4n };
      const b: Rational = { numerator: 1n, denominator: 4n };
      expect(subtract(a, b)).toEqual({ numerator: 1n, denominator: 2n });
    });

    it("subtracts with different denominators", () => {
      const a: Rational = { numerator: 1n, denominator: 2n };
      const b: Rational = { numerator: 1n, denominator: 3n };
      const result = subtract(a, b);
      expect(result).toEqual({ numerator: 1n, denominator: 6n });
    });

    it("multiplies two rationals", () => {
      const a: Rational = { numerator: 2n, denominator: 3n };
      const b: Rational = { numerator: 3n, denominator: 4n };
      expect(multiply(a, b)).toEqual({ numerator: 6n, denominator: 12n });
    });

    it("divides two rationals", () => {
      const a: Rational = { numerator: 1n, denominator: 2n };
      const b: Rational = { numerator: 1n, denominator: 4n };
      expect(divide(a, b)).toEqual({ numerator: 2n, denominator: 1n });
    });

    it("divides by zero returns division_by_zero", () => {
      const a: Rational = { numerator: 1n, denominator: 2n };
      const b: Rational = { numerator: 0n, denominator: 1n };
      expect(divide(a, b)).toBe("division_by_zero");
    });

    it("compare returns -1 when left < right", () => {
      const a: Rational = { numerator: 1n, denominator: 2n };
      const b: Rational = { numerator: 3n, denominator: 4n };
      expect(compare(a, b)).toBe(-1);
    });

    it("compare returns 1 when left > right", () => {
      const a: Rational = { numerator: 3n, denominator: 4n };
      const b: Rational = { numerator: 1n, denominator: 2n };
      expect(compare(a, b)).toBe(1);
    });

    it("compare returns 0 when left == right", () => {
      const a: Rational = { numerator: 1n, denominator: 2n };
      const b: Rational = { numerator: 2n, denominator: 4n };
      expect(compare(a, b)).toBe(0);
    });

    it("negative rational comparison", () => {
      const a: Rational = { numerator: -3n, denominator: 4n };
      const b: Rational = { numerator: -1n, denominator: 2n };
      expect(compare(a, b)).toBe(-1);
    });
  });
});
