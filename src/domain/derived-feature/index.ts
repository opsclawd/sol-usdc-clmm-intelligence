export {
  parseDecimal,
  add,
  subtract,
  multiply,
  divide,
  compare,
  roundToSafeInteger,
  type Rational,
  type NumericFailure
} from "./decimal.js";

export {
  selectLatestBySourceAndKind,
  selectVolatilityTimestamps,
  selectWithExpiryCheck,
  type CandidateRejection,
  type Selection,
  type SourceKindFilter,
  SELECTION_VERSION
} from "./select.js";

export {
  assembleDerivedFeature,
  type AssembleFeatureInput,
  type AssembleDerivedFeatureOptions,
  type FeatureCalculation,
  type AssembledFeature
} from "./assemble.js";

export {
  calculateRangeLocation,
  calculateDistanceToLower,
  calculateDistanceToUpper,
  RANGE_CALCULATOR_VERSIONS,
  type RangeClassification
} from "./range.js";

export {
  calculateOracleDexDivergence,
  calculateOracleConfidenceWidth,
  calculateVolumeLiquidityRatio24h,
  MARKET_CALCULATOR_VERSIONS,
  type DivergenceResult,
  type ConfidenceWidthResult,
  type VolumeRatioResult
} from "./market.js";
