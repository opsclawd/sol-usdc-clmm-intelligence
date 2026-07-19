function test2() {
  const priceAtomic = "5";
  const confidenceAtomic = "1";
  const exponent = 2;

  const price = BigInt(priceAtomic);
  const confidence = BigInt(confidenceAtomic);
  const absExponent = Math.abs(exponent);
  const divisor = exponent >= 0 ? BigInt(10 ** exponent) : BigInt(10 ** absExponent);

  const lowerPrice = price - confidence;
  const scale = exponent >= 0 ? BigInt(10 ** exponent) : BigInt(1);

  const lowerInteger = (lowerPrice * scale) / divisor;
  const lowerDecimal = (lowerPrice * scale) % divisor;

  const formatDecimal = (intPart, fracPart, fracDigits) => {
    const intStr = String(intPart);
    const fracStr = String(fracPart).padStart(fracDigits, "0");
    return intStr + "." + fracStr;
  };

  console.log(formatDecimal(lowerInteger, lowerDecimal, absExponent));
}
test2();
