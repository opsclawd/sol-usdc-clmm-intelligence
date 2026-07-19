export function atomicToDecimalString(atomicValue: string, exponent: number): string {
  const value = BigInt(atomicValue);
  const absExponent = Math.abs(exponent);

  if (exponent >= 0) {
    const divisor = 10n ** BigInt(exponent);
    const integerPart = value / divisor;
    const fractionalPart = value % divisor;
    if (fractionalPart === 0n) {
      return String(integerPart) + ".0";
    }
    const fractionalAbs = fractionalPart < 0n ? -fractionalPart : fractionalPart;
    const fractionalStr = String(fractionalAbs).padStart(exponent, "0");
    return String(integerPart) + "." + fractionalStr;
  }

  const divisor = 10n ** BigInt(absExponent);
  const integerPart = value / divisor;
  const fractionalPart = value % divisor;

  if (fractionalPart === 0n) {
    return String(integerPart) + ".0";
  }

  const fractionalAbs = fractionalPart < 0n ? -fractionalPart : fractionalPart;
  const fractionalStr = String(fractionalAbs).padStart(absExponent, "0");
  return String(integerPart) + "." + fractionalStr;
}

export function computeConfidenceBounds(
  priceAtomic: string,
  confidenceAtomic: string,
  exponent: number
): { lowerBound: string; upperBound: string } {
  const price = BigInt(priceAtomic);
  const confidence = BigInt(confidenceAtomic);
  const absExponent = Math.abs(exponent);
  const divisor = 10n ** BigInt(absExponent);

  const lowerPrice = price - confidence;
  const upperPrice = price + confidence;

  const scale = 1n;

  const lowerInteger = (lowerPrice * scale) / divisor;
  const upperInteger = (upperPrice * scale) / divisor;

  const lowerDecimal = (lowerPrice * scale) % divisor;
  const upperDecimal = (upperPrice * scale) % divisor;

  const formatDecimal = (intPart: bigint, fracPart: bigint, fracDigits: number): string => {
    const intStr = String(intPart);
    const fracAbs = fracPart < 0n ? -fracPart : fracPart;
    const fracStr = String(fracAbs).padStart(fracDigits, "0");
    return intStr + "." + fracStr;
  };

  return {
    lowerBound: formatDecimal(lowerInteger, lowerDecimal, absExponent),
    upperBound: formatDecimal(upperInteger, upperDecimal, absExponent)
  };
}

export function computeConfidenceRatioBps(confidenceAtomic: string, priceAtomic: string): string {
  const confidence = BigInt(confidenceAtomic);
  const price = BigInt(priceAtomic);

  const ratio = (confidence * BigInt(10000)) / price;

  if (ratio === BigInt(0)) {
    return "0";
  }

  return String(ratio);
}

export function isValidIntegerString(value: string): boolean {
  if (value === "") return false;
  if (value === "-") return false;
  if (value.startsWith("-")) {
    return /^-[0-9]+$/.test(value);
  }
  return /^[0-9]+$/.test(value);
}

export function isValidExponent(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
}

export function isValidTimestamp(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
