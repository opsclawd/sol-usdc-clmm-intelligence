function test() {
  const price = 10n;
  const confidence = 15n;
  const absExponent = 2;
  const divisor = 100n;

  const lowerPrice = price - confidence;
  const scale = 1n;

  const lowerInteger = (lowerPrice * scale) / divisor;
  const lowerDecimal = (lowerPrice * scale) % divisor;

  const formatDecimal = (intPart, fracPart, fracDigits) => {
    const intStr = String(intPart);
    const fracStr = String(fracPart).padStart(fracDigits, "0");
    return intStr + "." + fracStr;
  };

  console.log(formatDecimal(lowerInteger, lowerDecimal, absExponent));
}
test();
