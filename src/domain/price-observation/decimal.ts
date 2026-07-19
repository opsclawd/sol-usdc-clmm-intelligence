export function atomicToDecimalString(atomicValue: string, exponent: number): string {
  const value = BigInt(atomicValue);
  const absExponent = Math.abs(exponent);

  if (exponent >= 0) {
    const multiplied = value * BigInt(10 ** exponent);
    return String(multiplied) + ".0";
  }

  const divisor = BigInt(10 ** absExponent);
  const integerPart = value / divisor;
  const fractionalPart = value % divisor;

  if (fractionalPart === BigInt(0)) {
    return String(integerPart) + ".0";
  }

  const fractionalStr = String(fractionalPart).padStart(absExponent, "0");
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
  const divisor = exponent >= 0 ? BigInt(10 ** exponent) : BigInt(10 ** absExponent);

  const lowerPrice = price - confidence;
  const upperPrice = price + confidence;

  const scale = exponent >= 0 ? BigInt(10 ** exponent) : BigInt(1);

  const lowerInteger = (lowerPrice * scale) / divisor;
  const upperInteger = (upperPrice * scale) / divisor;

  const lowerDecimal = (lowerPrice * scale) % divisor;
  const upperDecimal = (upperPrice * scale) % divisor;

  const formatDecimal = (intPart: bigint, fracPart: bigint, fracDigits: number): string => {
    const intStr = String(intPart);
    const fracStr = String(fracPart).padStart(fracDigits, "0");
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
