import type {
  OraclePricePayloadV1,
  ExecutableQuotePayloadV1
} from "../../contracts/normalized-price-observation.js";
import type { PoolStatisticsPayloadV1 } from "../../contracts/normalized-pool-statistics.js";
import type { FeatureCalculation } from "./assemble.js";
import { parseDecimal, divide, subtract, multiply, roundToSafeInteger } from "./decimal.js";

export const MARKET_CALCULATOR_VERSIONS = {
  oracle_dex_divergence: "oracle-dex-divergence/v1",
  oracle_confidence_width: "oracle-confidence-width/v1",
  volume_liquidity_ratio_24h: "volume-liquidity-ratio-24h/v1"
} as const;

const MAX_SKEW_MS = 30_000;

export type DivergenceResult = FeatureCalculation;
export type ConfidenceWidthResult = FeatureCalculation;
export type VolumeRatioResult = FeatureCalculation;

function makeUnavailable(reasons: string[]): FeatureCalculation {
  return {
    status: "UNAVAILABLE",
    value: null,
    warnings: [],
    reasons,
    metadata: {}
  };
}

function isPositiveRational(value: { numerator: bigint; denominator: bigint }): boolean {
  return value.numerator > 0n;
}

function hasWideConfidence(oracle: OraclePricePayloadV1): boolean {
  return oracle.warnings.includes("wide_confidence_interval");
}

function hasNonFatalWarning(quote: ExecutableQuotePayloadV1): boolean {
  return quote.warnings.some((w) => w !== "route_unavailable");
}

function checkOracleFreshness(oracle: OraclePricePayloadV1, evaluationAsOfUnixMs: number): boolean {
  const oracleTime = oracle.observedSource.observedAtUnixMs;
  return Math.abs(evaluationAsOfUnixMs - oracleTime) <= MAX_SKEW_MS;
}

function checkQuoteFreshness(
  quote: ExecutableQuotePayloadV1,
  evaluationAsOfUnixMs: number
): boolean {
  const quoteTime = quote.observedSource.observedAtUnixMs;
  return Math.abs(evaluationAsOfUnixMs - quoteTime) <= MAX_SKEW_MS;
}

export function calculateOracleDexDivergence(
  oracle: OraclePricePayloadV1,
  dex: ExecutableQuotePayloadV1,
  evaluationAsOfUnixMs: number
): DivergenceResult {
  const warnings: string[] = [];

  if (!checkOracleFreshness(oracle, evaluationAsOfUnixMs)) {
    return makeUnavailable(["oracle_price_stale"]);
  }

  if (!checkQuoteFreshness(dex, evaluationAsOfUnixMs)) {
    return makeUnavailable(["dex_quote_stale"]);
  }

  if (dex.routeSummary.routeAvailable === false) {
    return makeUnavailable(["route_unavailable"]);
  }

  const oraclePriceStr = oracle.priceData.price;
  const dexPriceStr = dex.quoteData.price;

  if (dexPriceStr === null) {
    return makeUnavailable(["dex_price_null"]);
  }

  const oraclePrice = parseDecimal(oraclePriceStr);
  if (typeof oraclePrice === "string") {
    return makeUnavailable(["invalid_oracle_price"]);
  }

  const dexPrice = parseDecimal(dexPriceStr);
  if (typeof dexPrice === "string") {
    return makeUnavailable(["invalid_dex_price"]);
  }

  if (!isPositiveRational(oraclePrice)) {
    return makeUnavailable(["nonpositive_oracle_price"]);
  }

  if (!isPositiveRational(dexPrice)) {
    return makeUnavailable(["nonpositive_dex_price"]);
  }

  const diff = subtract(dexPrice, oraclePrice);
  const absDiff = {
    numerator: diff.numerator < 0n ? -diff.numerator : diff.numerator,
    denominator: diff.denominator
  };
  const rationalDivergence = divide(absDiff, oraclePrice);
  if (typeof rationalDivergence === "string") {
    return makeUnavailable(["numeric_failure"]);
  }

  const scaledDivergence = multiply(rationalDivergence, { numerator: 10_000n, denominator: 1n });
  const roundedDivergence = roundToSafeInteger(scaledDivergence);
  if (typeof roundedDivergence === "string") {
    return makeUnavailable(["numeric_overflow"]);
  }

  if (hasWideConfidence(oracle)) {
    warnings.push("wide_confidence_interval");
  }

  if (hasNonFatalWarning(dex)) {
    warnings.push(...dex.warnings);
  }

  if (warnings.length > 0) {
    return {
      status: "PARTIAL",
      value: roundedDivergence,
      warnings,
      reasons: [],
      metadata: { unit: "BPS" as const }
    };
  }

  return {
    status: "AVAILABLE",
    value: roundedDivergence,
    warnings: [],
    reasons: [],
    metadata: { unit: "BPS" as const }
  };
}

export function calculateOracleConfidenceWidth(
  oracle: OraclePricePayloadV1,
  evaluationAsOfUnixMs: number
): ConfidenceWidthResult {
  if (!checkOracleFreshness(oracle, evaluationAsOfUnixMs)) {
    return makeUnavailable(["oracle_price_stale"]);
  }

  const status = oracle.priceData.status;
  if (status !== "trading") {
    return makeUnavailable([`oracle_status_${status}`]);
  }

  const confidenceStr = oracle.priceData.confidence;
  const priceStr = oracle.priceData.price;

  const confidence = parseDecimal(confidenceStr);
  if (typeof confidence === "string") {
    return makeUnavailable(["invalid_confidence"]);
  }

  const price = parseDecimal(priceStr);
  if (typeof price === "string") {
    return makeUnavailable(["invalid_price"]);
  }

  if (price.numerator <= 0n) {
    return makeUnavailable(["nonpositive_price"]);
  }

  if (confidence.numerator < 0n) {
    return makeUnavailable(["negative_confidence"]);
  }

  const rationalWidth = divide(confidence, price);
  if (typeof rationalWidth === "string") {
    return makeUnavailable(["numeric_failure"]);
  }

  const scaledWidth = multiply(rationalWidth, { numerator: 10_000n, denominator: 1n });
  const roundedWidth = roundToSafeInteger(scaledWidth);
  if (typeof roundedWidth === "string") {
    return makeUnavailable(["numeric_overflow"]);
  }

  const isWide = hasWideConfidence(oracle);

  if (isWide) {
    return {
      status: "PARTIAL",
      value: roundedWidth,
      warnings: ["wide_confidence_interval"],
      reasons: [],
      metadata: { unit: "BPS" as const }
    };
  }

  return {
    status: "AVAILABLE",
    value: roundedWidth,
    warnings: [],
    reasons: [],
    metadata: { unit: "BPS" as const }
  };
}

export function calculateVolumeLiquidityRatio24h(pool: PoolStatisticsPayloadV1): VolumeRatioResult {
  const warnings: string[] = [];

  if (pool.sourceQuality.providerWarning) {
    warnings.push("provider_warning");
  }

  const volumeStr = pool.volume24hUsdc;
  const tvlStr = pool.tvlUsdc;

  if (volumeStr === null) {
    return makeUnavailable(["volume_missing"]);
  }

  if (tvlStr === null) {
    return makeUnavailable(["tvl_missing"]);
  }

  const volume = parseDecimal(volumeStr);
  if (typeof volume === "string") {
    return makeUnavailable(["invalid_volume"]);
  }

  const tvl = parseDecimal(tvlStr);
  if (typeof tvl === "string") {
    return makeUnavailable(["invalid_tvl"]);
  }

  if (tvl.numerator <= 0n) {
    return makeUnavailable(["nonpositive_tvl"]);
  }

  const rationalRatio = divide(volume, tvl);
  if (typeof rationalRatio === "string") {
    return makeUnavailable(["numeric_failure"]);
  }

  const scaledRatio = multiply(rationalRatio, { numerator: 1_000_000n, denominator: 1n });
  const roundedRatio = roundToSafeInteger(scaledRatio);
  if (typeof roundedRatio === "string") {
    return makeUnavailable(["numeric_overflow"]);
  }

  if (warnings.length > 0) {
    return {
      status: "PARTIAL",
      value: roundedRatio,
      warnings,
      reasons: [],
      metadata: { unit: "PPM" as const }
    };
  }

  return {
    status: "AVAILABLE",
    value: roundedRatio,
    warnings: [],
    reasons: [],
    metadata: { unit: "PPM" as const }
  };
}
