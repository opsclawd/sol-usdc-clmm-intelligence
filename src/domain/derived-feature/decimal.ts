export interface Rational {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

export type NumericFailure = "invalid_decimal" | "division_by_zero" | "numeric_overflow";

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

export function parseDecimal(value: string): Rational | NumericFailure {
  if (value === "") return "invalid_decimal";
  const trimmed = value.trim();
  if (trimmed !== value) return "invalid_decimal";
  if (trimmed.length === 0) return "invalid_decimal";
  if (/^\s+$/.test(trimmed)) return "invalid_decimal";
  if (/[eE]/.test(trimmed)) return "invalid_decimal";
  if (trimmed === "NaN" || trimmed === "Infinity" || trimmed === "-Infinity")
    return "invalid_decimal";
  if (trimmed === "-" || trimmed === "+") return "invalid_decimal";

  const signRegex = /^[+-]?/;
  const signMatch = trimmed.match(signRegex);
  if (!signMatch) return "invalid_decimal";
  const signPart = signMatch[0];
  const rest = trimmed.slice(signPart.length);

  if (rest === "" || rest === "." || rest.startsWith(".")) return "invalid_decimal";
  if (rest.endsWith(".")) return "invalid_decimal";

  const parts = rest.split(".");
  if (parts.length > 2) return "invalid_decimal";

  const intPart = parts[0];
  const fracPart = parts[1] ?? "";

  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return "invalid_decimal";
  if (intPart.length > 0 && !/^\d+$/.test(intPart)) return "invalid_decimal";
  if (fracPart.length > 0 && !/^\d+$/.test(fracPart)) return "invalid_decimal";

  if (intPart === "" && fracPart === "") return "invalid_decimal";

  const combinedDigits = intPart + fracPart;
  if (combinedDigits === "") return "invalid_decimal";

  const scale = fracPart.length;

  if (scale === 0) {
    return { numerator: BigInt(signPart + combinedDigits), denominator: 1n };
  }

  const trimmedFrac = fracPart.replace(/0+$/, "");
  if (trimmedFrac === "") {
    return { numerator: BigInt(signPart + intPart), denominator: 1n };
  }

  const newScale = trimmedFrac.length;
  const newCoefficient = BigInt(signPart + intPart + trimmedFrac);

  return { numerator: newCoefficient, denominator: 10n ** BigInt(newScale) };
}

export function subtract(left: Rational, right: Rational): Rational {
  const lcm = (left.denominator * right.denominator) / gcd(left.denominator, right.denominator);
  const leftScaled = left.numerator * (lcm / left.denominator);
  const rightScaled = right.numerator * (lcm / right.denominator);
  const num = leftScaled - rightScaled;
  const den = lcm;
  if (num === 0n) {
    return { numerator: 0n, denominator: 1n };
  }
  const sign = num < 0n !== den < 0n ? -1n : 1n;
  const absNum = num < 0n ? -num : num;
  const absDen = den < 0n ? -den : den;
  const div = gcd(absNum, absDen);
  return { numerator: (sign * absNum) / div, denominator: absDen / div };
}

export function multiply(left: Rational, right: Rational): Rational {
  const num = left.numerator * right.numerator;
  const den = left.denominator * right.denominator;
  if (num === 0n) {
    return { numerator: 0n, denominator: 1n };
  }
  const sign = num < 0n !== den < 0n ? -1n : 1n;
  const absNum = num < 0n ? -num : num;
  const absDen = den < 0n ? -den : den;
  return { numerator: sign * absNum, denominator: absDen };
}

export function divide(left: Rational, right: Rational): Rational | NumericFailure {
  if (right.numerator === 0n) return "division_by_zero";
  const num = left.numerator * right.denominator;
  const den = left.denominator * right.numerator;
  if (num === 0n) {
    return { numerator: 0n, denominator: 1n };
  }
  const sign = num < 0n !== den < 0n ? -1n : 1n;
  const absNum = num < 0n ? -num : num;
  const absDen = den < 0n ? -den : den;
  const div = gcd(absNum, absDen);
  return { numerator: (sign * absNum) / div, denominator: absDen / div };
}

export function compare(left: Rational, right: Rational): -1 | 0 | 1 {
  const lcm = (left.denominator * right.denominator) / gcd(left.denominator, right.denominator);
  const leftScaled = left.numerator * (lcm / left.denominator);
  const rightScaled = right.numerator * (lcm / right.denominator);
  if (leftScaled < rightScaled) return -1;
  if (leftScaled > rightScaled) return 1;
  return 0;
}

export function roundToSafeInteger(value: Rational): number | NumericFailure {
  const numerator = value.numerator;
  const denominator = value.denominator;

  if (denominator === 0n) {
    return "numeric_overflow";
  }

  const isNegative = numerator < 0n;
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;

  const absQuotient = absNumerator / absDenominator;
  const absRemainder = absNumerator % absDenominator;

  const halfDenominator = absDenominator / 2n;
  let adjustment = 0n;
  if (absRemainder > halfDenominator) {
    adjustment = 1n;
  } else if (absRemainder === halfDenominator && absDenominator % 2n === 0n) {
    adjustment = 1n;
  }

  const absResult = absQuotient + adjustment;
  const result = isNegative ? -absResult : absResult;

  if (result > BigInt(Number.MAX_SAFE_INTEGER) || result < BigInt(Number.MIN_SAFE_INTEGER)) {
    return "numeric_overflow";
  }

  return Number(result);
}
